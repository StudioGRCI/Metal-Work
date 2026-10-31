/**
 * Recorre con tecleo real los buscadores de las listas, con la cuenta del
 * puesto que usa cada una, en el teléfono y en el monitor. Nunca ADMIN, salvo
 * en Personal: `usuarios.ver` solo lo tiene el administrador (`docs/PERMISOS.md`).
 *
 *   1. Se busca sin tildes y encuentra con tilde («nunez» → «NÚÑEZ»).
 *   2. Las palabras van en cualquier orden («agua cisterna» → «CISTERNA DE AGUA»).
 *   3. Una coma o un paréntesis escritos no tiran la pantalla (en Materiales
 *      «plancha, a36» la tumbaba).
 *   4. Ningún buscador pide apretar «Buscar»: lo escrito llega solo a la URL.
 *      El filtro del Kardex sí espera «Ver», porque combina cinco filtros.
 *   5. «Limpiar» quita el término y deja los demás filtros puestos.
 *   6. Lo que la pantalla muestra es lo que la base tiene: se cuenta en SQL.
 *   7. El desplegable con buscador (`SeleccionBuscable`) y el buscador de la
 *      asistencia, que filtran en el navegador, buscan igual. (El de las OT del
 *      reparto de la planilla del mes se fue con el reparto, migración
 *      20261026210000: aquí se mira que no vuelva.)
 *   8. Una sigla o un código se encuentran con o sin sus signos: «sac» a
 *      «S.A.C.», una placa sin el guion.
 *
 * Siembra sus propios datos con un sello distinto en cada corrida: materiales,
 * un cliente, un proveedor, una unidad, una orden, una cotización, una orden de
 * servicio, un subcontrato, dos trabajadores y una persona en una planilla en
 * preparación, con tildes en los nombres. Necesita las cuentas
 * `*.local@metalwork.test` de Gerencia, Contabilidad, Logística,
 * Requerimientos, Supervisión (sup.mtz), Portería, RRHH y Administración;
 * las de Ventas, Almacén, Diseño y el administrador las crea.
 * Lo sembrado se queda en el banco (una OT o una cotización numeradas no se
 * borran ni aquí): `preparar.sh` lo deja como nuevo.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import ExcelJS from 'exceljs'
import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
// Los puestos que el banco no trae (Ventas, Almacén, Diseño y el administrador,
// que es quien usa Personal) se crean aquí, como en `probar-correcciones.mjs`.
const PROPIAS = { ventas: ['VENDEDOR', 'GCO'], almacen: ['ALMACENERO', 'ALM'], diseno: ['DISENO', 'DIS'], admin: ['ADMIN', 'ADM'] }
const cuenta = (puesto) => (PROPIAS[puesto] ? `${puesto}.bus@banco.test` : `${puesto}.local@metalwork.test`)
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const base = new pg.Client({
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.BANCO_BASE ?? 'mw_demo',
})
await base.connect()
const consulta = async (sql, valores = []) => (await base.query(sql, valores)).rows
const uno = async (sql, valores = []) => (await consulta(sql, valores))[0]

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------- siembra
const sello = Date.now().toString().slice(-6)
const rucLibre = async (tabla) =>
  (await uno(`select n::text as ruc from generate_series(20990050000::bigint, 20990099999::bigint) n
              where public.ruc_es_valido(n::text) and not exists (select 1 from public.${tabla} t where t.numero_documento = n::text) limit 1`)).ruc

const MATERIAL = `ÁNGULO 2 X 1/4 BUSCA ${sello}`
const PLANCHA = `PLANCHA LAC 3/16, A36 BUSCA ${sello}`
const CLIENTE = `TRANSPORTES PEÑA Y NÚÑEZ ${sello} S.A.C.`
// El gemelo que no tiene que salir cuando se busca la sigla.
const GEMELO = `TRANSPORTES PEÑA Y NÚÑEZ ${sello} E.I.R.L.`
const PROVEEDOR = `TORNERÍA ÁVILA ${sello} E.I.R.L.`
// El dominio `placa` pide tres y tres: «Q12-345».
const PLACA = `Q${sello.slice(0, 2)}-${sello.slice(3)}`
const OT = `CAMIÓN CISTERNA DE AGUA BUSCA ${sello}`
const CODIGO = `QA_BUS_${sello}`

for (const [puesto, [rol, area]] of Object.entries(PROPIAS)) {
  const correo = cuenta(puesto)
  if (!(await uno('select id from public.usuarios where correo = $1', [correo]))) {
    const { id } = await uno(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [correo])
    await consulta(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
       select $1, $2, 'Banco buscadores', $3, r.id, (select id from public.areas where codigo = $4) from public.roles r where r.codigo = $2`,
      [id, rol, correo, area],
    )
  }
  await consulta(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where email = $1`, [correo, CLAVE])
}
const logistico = (await uno(`select id from public.usuarios where correo = $1`, [cuenta('logistica')])).id
// Una ficha de personal que se da de baja y se reactiva con clic, una por ancho.
const BAJA = `BAJA ${sello}`
for (const n of [1, 2]) {
  const { id } = await uno(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [`baja${n}.${sello}@banco.test`])
  await consulta(
    `insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
     select $1, $2, $3, $4, r.id, null from public.roles r where r.codigo = 'OPERARIO'`,
    [id, `PRUEBA${n}`, BAJA, `baja${n}.${sello}@banco.test`],
  )
}
for (const [codigo, descripcion] of [[`BUS-${sello}-1`, MATERIAL], [`BUS-${sello}-2`, PLANCHA]]) {
  const { id } = await uno(
    `insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
     values ($1, $2, (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1),
             (select id from public.unidades_medida where codigo = 'UND')) returning id`,
    [codigo, descripcion],
  )
  // Con saldo, para que aparezca en el stock de Supervisión, y una salida a un
  // código interno, para que ese código tenga gasto.
  await consulta(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, precio_unitario, moneda, registrado_en)
                  values (gen_random_uuid(), 'INGRESO', $1, 5, 'INGRESO_GENERAL', 'Banco de buscadores', $2, 10, 'PEN', now() - interval '1 hour')`, [id, logistico])
  await consulta(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                                             recibido_por_nombre, codigo_unidad, codigo_interno, cantidad_de_stock)
                  values (gen_random_uuid(), 'SALIDA', $1, 1, 'SALIDA_GENERAL', 'Banco de buscadores', $2, 'Área de banco', $3, $3, 1)`, [id, logistico, CODIGO])
}
const GEMELOS = `TUBO GEMELO INGRESO ${sello}`
for (const n of [3, 4]) {
  await consulta(
    `insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
     values ($1, $2, (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1),
             (select id from public.unidades_medida where codigo = 'KG'))`,
    [`BUS-${sello}-${n}`, GEMELOS],
  )
}
const clienteId = (await uno(`insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', $1, $2) returning id`, [await rucLibre('clientes'), CLIENTE])).id
await consulta(`insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', $1, $2)`, [await rucLibre('clientes'), GEMELO])
await consulta(`insert into public.proveedores (tipo_documento, numero_documento, razon_social, rubro) values ('RUC', $1, $2, 'Tornería y maestranza')`, [await rucLibre('proveedores'), PROVEEDOR])
const unidadId = (await uno(`insert into public.unidades (cliente_id, placa, marca, modelo, tipo_vehiculo, codigo_interno) values ($1, $2, 'VOLVO', 'FMX ÚNICO', 'VOLQUETE', $3) returning id`, [clienteId, PLACA, CODIGO])).id
const ot = await uno(
  `insert into public.ordenes_trabajo (sede_id, descripcion, cliente_id, unidad_id) values ((select id from public.sedes order by nombre limit 1), $1, $2, $3) returning numero`,
  [OT, clienteId, unidadId],
)
const proveedorId = (await uno(`select id from public.proveedores where razon_social = $1`, [PROVEEDOR])).id
const COTIZACION = `QA-BUS-${sello}`
await consulta(
  `with c as (select gen_random_uuid() as id)
   insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage)
   select c.id, $1, $2, (select id from public.tipos_carroceria where activo order by orden_secuencia limit 1), 'banco.pdf', 'cot/' || c.id || '/banco.pdf' from c`,
  [COTIZACION, clienteId],
)
// Con su archivo anotado en Storage, como la deja «Subir cotización»: sin él,
// la lista dice «No se pudo abrir el archivo» y el recorrido lo cuenta como
// pantalla de error.
await consulta(
  `insert into storage.objects (bucket_id, name, metadata)
   select 'cotizaciones-pdf', ruta_storage, jsonb_build_object('mimetype', 'application/pdf', 'size', 1024)
   from public.cotizaciones_pdf where numero = $1`,
  [COTIZACION],
)
// Los números los da su serie, como en la pantalla: a mano dejarían un hueco que nadie explica.
const SERVICIO = (await uno(`select public.siguiente_correlativo('ORDEN_SERVICIO', '001', null) as n`)).n
await consulta(`insert into public.ordenes_servicio (numero, proveedor_id, proveedor, descripcion, monto, codigo_interno, creado_por) values ($1, $2, $3, 'Torneado de prueba', 1, $4, $5)`,
  [SERVICIO, proveedorId, PROVEEDOR, CODIGO, logistico])
const SUBCONTRATO = (await uno(`select public.siguiente_correlativo('SUBCONTRATO', '001', null) as n`)).n
// En una base recién preparada no hay subcontratistas: uno inventado, con RUC 10.
if (!(await uno(`select count(*)::int as n from public.subcontratistas`)).n) {
  await consulta(`insert into public.subcontratistas (ruc, nombre)
                  select n::text, 'SUBCONTRATISTA DE BANCO' from generate_series(10990050000::bigint, 10990099999::bigint) n
                  where public.ruc_es_valido(n::text) limit 1`)
}
await consulta(`insert into public.subcontratos (numero, subcontratista_id, codigo_interno, descripcion, moneda, monto, creado_por)
                values ($1, (select id from public.subcontratistas order by nombre limit 1), $2, 'Subcontrato de prueba', 'PEN', 1, $3)`, [SUBCONTRATO, CODIGO, logistico])
// Dos trabajadores inventados que se parecen: la búsqueda deja uno solo.
const DNI = `9${sello}`
const TRABAJADOR = `ZÚÑIGA PEÑA ${sello}, ÁNGEL`
const OTRO = `ZÚÑIGA ROJAS ${sello}, MARÍA`
await consulta(`insert into public.trabajadores (nombres, apellidos, dni, creado_por) values ('ÁNGEL', $1, $2, $5), ('MARÍA', $3, $4, $5)`,
  [`ZÚÑIGA PEÑA ${sello}`, `${DNI}1`, `ZÚÑIGA ROJAS ${sello}`, `${DNI}2`, logistico])
// Una planilla en preparación con alguien que no tiene ficha: ya no sale el reparto entre OT.
// El nombre lleva el sello en letras: la planilla compara los nombres sin sus cifras, y el
// de una tanda anterior chocaba («ya está en la planilla de taller de este mes»).
const PERSONA = `PERSONA BANCO ${[...sello].map((d) => 'ABCDEFGHIJ'[Number(d)]).join('')}`
const planilla = await uno(`insert into public.planillas (tipo, periodo, moneda, registrado_por) values ('TALLER', '2099-12-01', 'PEN', $1)
                            on conflict (tipo, periodo) do update set tipo = excluded.tipo returning id, estado`, [logistico])
await consulta(`insert into public.planilla_personas (planilla_id, nombre, monto, registrado_por) values ($1, $2, 1, $3)`, [planilla.id, PERSONA, logistico])
console.log(`Sembrado con el sello ${sello} (OT ${ot.numero}).`)

// ---------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(puesto, ancho) {
  const telefono = ancho < 500
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: telefono ? 844 : 900 }, isMobile: telefono, hasTouch: telefono, timezoneId: 'America/Lima', locale: 'es-PE' })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', cuenta(puesto))
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${puesto}`)
  return { pagina, contexto, errores }
}

/** Lee hasta que cumpla o pasen 15 s: la lista se rehace un momento después de escribir. */
async function hasta(leer, cumple, ms = 15000) {
  const fin = Date.now() + ms
  let v = await leer()
  while (!cumple(v) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 250))
    v = await leer()
  }
  return v
}

const textoDe = async (pagina) => limpio(await pagina.locator('main').innerText().catch(() => ''))

/**
 * Escribe en el buscador como una persona —tecla por tecla, sin apretar nada
 * más— y espera a que el término llegue a la URL y la lista se rehaga.
 */
async function buscar(pagina, etiqueta, clave, texto) {
  const caja = pagina.getByRole('searchbox', { name: etiqueta })
  await caja.click()
  await caja.fill('')
  await caja.pressSequentially(texto, { delay: 15 })
  await pagina.waitForURL((u) => new URL(u).searchParams.get(clave) === texto, { timeout: 15000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  return new URL(pagina.url()).searchParams.get(clave)
}

const CASOS = [
  // puesto, ruta, etiqueta del buscador, clave en la URL, lo que se escribe, lo que tiene que salir
  // y, a veces, lo que no tiene que salir
  ['diseno', '/materiales', 'Buscar material', 'buscar', 'angulo 1/4', MATERIAL],
  ['diseno', '/materiales', 'Buscar material', 'buscar', 'plancha, a36', PLANCHA],
  // La medida pegada, como se anota en el taller, en la base.
  ['diseno', '/materiales', 'Buscar material', 'buscar', `angulo 2x1/4 ${sello}`, MATERIAL],
  ['logistica', '/compras/valorizacion', 'Buscar material', 'q', `busca ${sello} angulo`, MATERIAL],
  ['ventas', '/clientes', 'Buscar clientes', 'q', `pena nunez ${sello}`, CLIENTE],
  ['ventas', '/clientes', 'Buscar clientes', 'q', `nunez ${sello} s.a.c.`, CLIENTE, GEMELO],
  // Más de veinte letras: la sigla del final sigue contando.
  ['ventas', '/clientes', 'Buscar clientes', 'q', `transportes peña y núñez ${sello} s.a.c.`, CLIENTE, GEMELO],
  ['contabilidad', '/proveedores', 'Buscar proveedores', 'q', `avila torneria ${sello}`, PROVEEDOR],
  ['ventas', '/unidades', 'Buscar unidades', 'q', `fmx unico ${sello.slice(3)}`, PLACA],
  ['gerencia', '/ordenes', 'Buscar órdenes', 'q', `agua cisterna camion ${sello}`, ot.numero],
  ['gerencia', '/clientes', 'Buscar clientes', 'q', `sac ${sello}`, CLIENTE, GEMELO],
  ['gerencia', '/unidades', 'Buscar unidades', 'q', PLACA.replace('-', '').toLowerCase(), PLACA],
  ['ventas', '/cotizaciones/pdf', 'Buscar cotizaciones', 'q', `nunez ${sello}`, COTIZACION],
  ['admin', '/personal', 'Buscar personal', 'q', 'vendedor banco buscadores', 'ventas.bus@banco.test'],
  // El correo escrito tal cual, con su punto: la base lo busca por sus partes.
  ['admin', '/personal', 'Buscar personal', 'q', 'ventas.bus@banco.test', 'ventas.bus@banco.test'],
  ['gerencia', '/codigos-internos', 'Buscar código interno', 'q', `qa bus ${sello}`, CODIGO],
  ['requerimientos', '/requerimientos/gasto-por-codigo', 'Buscar código interno', 'q', `qa_bus_${sello}`, CODIGO],
  ['logistica', '/compras/servicios', 'Buscar por código interno', 'codigo', CODIGO.toLowerCase(), SERVICIO],
  ['gerencia', '/subcontratos', 'Buscar por código interno', 'codigo', CODIGO.toLowerCase(), SUBCONTRATO],
  ['sup.mtz', '/almacen/stock', 'Buscar en el stock', 'q', `angulo ${sello}`, MATERIAL],
]

for (const ancho of [390, 1280]) {
  const sesiones = new Map()
  const sesion = async (puesto) => {
    if (!sesiones.has(puesto)) sesiones.set(puesto, await entrar(puesto, ancho))
    return sesiones.get(puesto)
  }
  console.log(`\n— A ${ancho} px`)

  for (const [puesto, ruta, etiqueta, clave, texto, espera, noDebe] of CASOS) {
    const { pagina, errores } = await sesion(puesto)
    errores.length = 0
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    const llego = await buscar(pagina, etiqueta, clave, texto)
    const visto = await hasta(() => textoDe(pagina), (t) => t.includes(espera))
    comprobar(llego === texto && visto.includes(espera), `${puesto} ${ruta}: «${texto}» llega solo a la URL y encuentra «${espera}»`)
    if (noDebe) comprobar(!visto.includes(noDebe), `${puesto} ${ruta}: «${texto}» deja fuera a «${noDebe}»`)
    comprobar(!/no se pudo abrir/i.test(visto) && errores.length === 0, `${puesto} ${ruta}: sin pantalla de error ni errores de consola${errores.length ? ` (${errores.join(' | ')})` : ''}`)
    comprobar(await pagina.getByRole('button', { name: /^Buscar$/ }).count() === 0, `${puesto} ${ruta}: no hay botón «Buscar» que apretar`)
    // La página puede no correrse y la tabla sí, dentro de su tarjeta: se miden las dos.
    const ancho2 = await pagina.evaluate(() => Math.max(document.documentElement.scrollWidth,
      ...[...document.querySelectorAll('main table')].map((t) => Math.ceil(t.getBoundingClientRect().left + t.scrollWidth))))
    comprobar(ancho2 <= ancho, `${puesto} ${ruta}: ni la pantalla ni su tabla se salen de costado (${ancho2} px)`)
    await pagina.screenshot({ path: join(CAPTURAS, `buscador-${ancho}${ruta.replace(/\//g, '_')}.png`) })
  }

  // Lo que se ve es lo que la base tiene: los materiales con «angulo», contados con y sin tilde.
  // Con Diseño, que es quien usa el catálogo: Gerencia ya no lo abre (#134).
  {
    const { pagina } = await sesion('diseno')
    await pagina.goto(`${BASE}/materiales`, { waitUntil: 'networkidle' })
    await buscar(pagina, 'Buscar material', 'buscar', `busca ${sello}`)
    const filas = await hasta(() => pagina.locator('main tbody tr', { hasText: sello }).count(), (n) => n === 2)
    const enLaBase = (await uno(`select count(*)::int as n from public.materiales where activo and public.unaccent(descripcion) ilike $1`, [`%BUSCA ${sello}%`])).n
    comprobar(filas === enLaBase && filas === 2, `Materiales: «busca ${sello}» muestra ${filas} filas y la base tiene ${enLaBase}`)
  }

  // «Limpiar» quita solo el término: el filtro de estado de Subcontratos se queda.
  {
    const { pagina } = await sesion('gerencia')
    await pagina.goto(`${BASE}/subcontratos?estado=todos`, { waitUntil: 'networkidle' })
    await buscar(pagina, 'Buscar por código interno', 'codigo', 'qa')
    await pagina.getByRole('button', { name: 'Limpiar' }).click()
    await pagina.waitForURL((u) => !new URL(u).searchParams.has('codigo'), { timeout: 15000 }).catch(() => {})
    const params = new URL(pagina.url()).searchParams
    comprobar(!params.has('codigo') && params.get('estado') === 'todos', `Subcontratos: «Limpiar» deja estado=todos y quita el código (${pagina.url().replace(BASE, '')})`)
    comprobar((await pagina.getByRole('searchbox', { name: 'Buscar por código interno' }).inputValue()) === '', 'Subcontratos: la caja queda vacía después de «Limpiar»')
  }

  // El Kardex de Almacén: el material con su buscador y la unidad, que se
  // aplican con «Ver», y el Excel con el mismo filtro.
  {
    const { pagina } = await sesion('almacen')
    await pagina.goto(`${BASE}/almacen/kardex`, { waitUntil: 'networkidle' })
    await pagina.locator('#k-material').click()
    await pagina.getByLabel('Nombre o código del material').pressSequentially(`angulo 2x1/4 ${sello}`, { delay: 15 })
    const opcion = pagina.getByRole('option', { name: new RegExp(sello) })
    const hay = await hasta(() => opcion.count(), (n) => n === 1)
    if (hay === 1) await opcion.click()
    await pagina.locator('#k-unidad').fill(`qa bus ${sello}`)
    await Promise.all([pagina.waitForURL((u) => new URL(u).searchParams.has('unidad'), { timeout: 15000 }).catch(() => {}), pagina.getByRole('button', { name: 'Ver', exact: true }).click()])
    await pagina.waitForLoadState('networkidle')
    const url = new URL(pagina.url())
    const filas = await pagina.locator('main tbody tr', { hasText: CODIGO }).count()
    const enLaBase = (await uno(`select count(*)::int as n from public.v_kardex_almacen k join public.materiales m on m.id = k.material_id
                                 where m.descripcion = $1 and k.codigo_unidad = $2`, [MATERIAL, CODIGO])).n
    comprobar(hay === 1 && url.searchParams.get('material') && filas === enLaBase && filas === 1,
      `Kardex (almacén): el material con «angulo 2x1/4 ${sello}» y la unidad «qa bus ${sello}» muestran ${filas} fila y la base tiene ${enLaBase}`)
    // El Excel con el mismo filtro: se abre y se cuentan las filas con el código.
    const excel = await pagina.request.get(`${BASE}/almacen/kardex/excel${url.search}`)
    let enElExcel = -1
    if (excel.status() === 200) {
      const libro = new ExcelJS.Workbook()
      await libro.xlsx.load(await excel.body())
      enElExcel = 0
      libro.worksheets[0].eachRow((fila) => {
        if (fila.values.some((v) => String(v ?? '').includes(CODIGO))) enElExcel++
      })
    }
    comprobar(excel.status() === 200 && /attachment/.test(excel.headers()['content-disposition'] ?? '') && enElExcel === enLaBase,
      `Kardex (almacén): el Excel con el mismo filtro trae ${enElExcel} fila con ${CODIGO} y la base tiene ${enLaBase}`)
  }

  // «Registrar ingreso» de Almacén sugiere del catálogo sin tildes y con la
  // medida pegada, como se anota en el taller: con «angulo 2x1/4» tiene que
  // ofrecer el «ÁNGULO 2 X 1/4», o entraría como material nuevo.
  {
    const { pagina } = await sesion('almacen')
    await pagina.goto(`${BASE}/almacen/kardex`, { waitUntil: 'networkidle' })
    await pagina.getByRole('button', { name: 'Registrar ingreso' }).click()
    await pagina.locator('#ing-material').pressSequentially(`angulo 2x1/4 ${sello}`, { delay: 15 })
    const sugerida = pagina.getByRole('list', { name: 'Del catálogo' }).getByRole('button', { name: new RegExp(sello) })
    const n = await hasta(() => sugerida.count(), (x) => x === 1)
    if (n === 1) await sugerida.click()
    const dice = await hasta(() => textoDe(pagina).then(() => pagina.locator('form:has(#ing-material)').innerText()), (t) => t.includes('Del catálogo:'))
    comprobar(n === 1 && dice.includes(`Del catálogo: ${MATERIAL}`), `Ingreso a Almacén: «angulo 2x1/4 ${sello}» sugiere «${MATERIAL}» y al elegirlo lo toma del catálogo`)
    // Escrito entero y pegado, sin tocar la sugerencia, también es ese.
    const pegado = MATERIAL.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(' X ', 'X')
    await pagina.locator('#ing-material').fill('')
    await pagina.locator('#ing-material').pressSequentially(pegado, { delay: 10 })
    const tomado = await hasta(() => pagina.locator('form:has(#ing-material)').innerText(), (t) => t.includes('Del catálogo:'))
    comprobar(tomado.includes(`Del catálogo: ${MATERIAL}`), `Ingreso a Almacén: «${pegado}» escrito sin tocar la lista se toma del catálogo`)
    // Con dos iguales en el catálogo no se confirma hasta tocar uno: si no,
    // daba de alta un tercero «por clasificar» con el saldo.
    await pagina.locator('#ing-material').fill('')
    await pagina.locator('#ing-material').pressSequentially(GEMELOS.toLowerCase(), { delay: 10 })
    const confirmar = pagina.getByRole('button', { name: 'Confirmar ingreso' })
    const pide = await hasta(() => pagina.locator('form:has(#ing-material)').innerText(), (t) => t.includes('Hay más de uno'))
    const cerrado = await confirmar.isDisabled()
    const unidadAntes = await pagina.locator('#ing-unidad').count()
    await pagina.getByRole('list', { name: 'Del catálogo' }).getByRole('button').first().click()
    const elegido = await hasta(() => pagina.locator('form:has(#ing-material)').innerText(), (t) => t.includes('Del catálogo:'))
    comprobar(pide.includes('Hay más de uno') && cerrado && unidadAntes === 0 && elegido.includes(`Del catálogo: ${GEMELOS}`) && !(await confirmar.isDisabled()),
      `Ingreso a Almacén: con dos «${GEMELOS}» en el catálogo pide tocar uno (confirmar ${cerrado ? 'cerrado' : 'ABIERTO'}, ${unidadAntes} campo de unidad) y al tocarlo deja confirmar`)
    await pagina.keyboard.press('Escape')
  }

  // Las listas enteras, sin filtro, tampoco se corren: una fila con un texto
  // largo basta para empujar la tabla fuera de su tarjeta.
  for (const [puesto, ruta] of [['almacen', '/almacen/kardex'], ['logistica', '/compras/servicios'], ['ventas', '/unidades'], ['diseno', '/materiales'], ['logistica', '/compras/valorizacion']]) {
    const { pagina } = await sesion(puesto)
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    const medida = await pagina.evaluate(() => Math.max(document.documentElement.scrollWidth,
      ...[...document.querySelectorAll('main table')].map((t) => Math.ceil(t.getBoundingClientRect().left + t.scrollWidth))))
    comprobar(medida <= ancho, `${puesto} ${ruta} sin filtro: ni la pantalla ni su tabla se salen de costado (${medida} px)`)
  }

  // Los códigos de Diseño se filtran en el navegador: el primero de la lista,
  // escrito en minúsculas y sin signos, deja solo los que lo contienen.
  {
    const { pagina } = await sesion('diseno')
    await pagina.goto(`${BASE}/diseno/planos`, { waitUntil: 'networkidle' })
    const codigos = () => pagina.locator('main [data-codigo]:visible').evaluateAll((l) => l.map((a) => a.getAttribute('data-codigo')))
    const antes = await codigos()
    if (antes.length) {
      const texto = antes[0].toLowerCase().replace(/[^a-z0-9]/g, '')
      const llego = await buscar(pagina, 'Buscar código interno', 'q', texto)
      const despues = await hasta(codigos, (v) => v.length > 0 && v.length <= antes.length && v.includes(antes[0]))
      comprobar(llego === texto && despues.includes(antes[0]) && despues.every((c) => c.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/o/g, '0').includes(texto.replace(/o/g, '0'))),
        `Códigos de Diseño (diseño): «${texto}» deja ${despues.length} de ${antes.length}, todos con ${antes[0]}`)
    } else {
      comprobar(false, 'Códigos de Diseño (diseño): la lista está vacía y no hay qué buscar')
    }

    // La fila muestra la placa y el vehículo: buscar la placa sin guion la encuentra.
    await pagina.goto(`${BASE}/diseno/planos`, { waitUntil: 'networkidle' })
    const conUnidad = await pagina.locator('main [data-codigo]:visible').evaluateAll((l) => l
      .map((a) => ({ codigo: a.getAttribute('data-codigo'), unidad: a.querySelector('p.text-xs')?.textContent ?? '' }))
      .find((f) => f.unidad.includes(' · ')))
    if (conUnidad) {
      const placa = conUnidad.unidad.split(' · ')[0].toLowerCase().replace(/[^a-z0-9]/g, '')
      await buscar(pagina, 'Buscar código interno', 'q', placa)
      const despues = await hasta(codigos, (v) => v.includes(conUnidad.codigo))
      comprobar(despues.includes(conUnidad.codigo), `Códigos de Diseño (diseño): la placa «${placa}» encuentra ${conUnidad.codigo} (${despues.length} a la vista)`)
    } else {
      comprobar(false, 'Códigos de Diseño (diseño): ningún código muestra su placa y no hay qué buscar')
    }
  }

  // Un término que no está: el estado vacío lo dice con lo que se escribió.
  {
    const { pagina } = await sesion('gerencia')
    await pagina.goto(`${BASE}/clientes`, { waitUntil: 'networkidle' })
    await buscar(pagina, 'Buscar clientes', 'q', `zzz${sello}`)
    const t = await hasta(() => textoDe(pagina), (x) => x.includes('Ningún cliente coincide'))
    comprobar(t.includes('Ningún cliente coincide') && t.includes(`zzz${sello}`), 'Clientes: sin resultados lo dice, con lo que se escribió')
    comprobar(t.includes(`Ningún cliente con «zzz${sello}»`) && !/\b0 clientes registrados/.test(t), 'Clientes: la cabecera dice «Ningún cliente con…», no que el padrón está vacío')
    // «Ver todos los clientes» cambia la URL por fuera del buscador: la caja la sigue.
    await pagina.getByRole('link', { name: 'Ver todos los clientes' }).first().click()
    await pagina.waitForURL((u) => !new URL(u).searchParams.has('q'), { timeout: 15000 }).catch(() => {})
    const caja = await hasta(() => pagina.getByRole('searchbox', { name: 'Buscar clientes' }).inputValue(), (v) => v === '')
    comprobar(caja === '', `Clientes: «Ver todos los clientes» vacía también la caja («${caja}»)`)
    // Y «atrás» vuelve a la búsqueda: la caja la retoma y no se queda buscando.
    await pagina.goBack()
    await pagina.waitForURL((u) => new URL(u).searchParams.get('q') === `zzz${sello}`, { timeout: 15000 }).catch(() => {})
    const vuelta = await hasta(() => pagina.getByRole('searchbox', { name: 'Buscar clientes' }).inputValue(), (v) => v === `zzz${sello}`)
    await pagina.waitForTimeout(1500)
    const girando = await pagina.locator('main .animate-spin').count()
    comprobar(vuelta === `zzz${sello}` && girando === 0, `Clientes: «atrás» devuelve la búsqueda a la caja («${vuelta}») sin quedarse buscando (${girando} girando)`)
  }

  // Personal: «Dar de baja» y «Reactivar» cambian la ficha en la base. Antes
  // «Dar de baja» respondía bien y dejaba a la persona activa.
  {
    const { pagina } = await sesion('admin')
    const n = ancho < 500 ? 1 : 2
    const correo = `baja${n}.${sello}@banco.test`
    const activo = async () => (await uno('select activo from public.usuarios where correo = $1', [correo])).activo
    await pagina.goto(`${BASE}/personal?q=${encodeURIComponent(`prueba${n} baja ${sello}`)}`, { waitUntil: 'networkidle' })
    await pagina.getByRole('button', { name: `Dar de baja a PRUEBA${n}` }).click()
    // Pregunta antes: el ícono está junto al de la contraseña.
    const ventana = pagina.getByRole('dialog')
    const pregunta = await ventana.innerText().catch(() => '')
    await ventana.getByRole('button', { name: 'Dar de baja', exact: true }).click()
    const tras = await hasta(activo, (v) => v === false)
    // Y lleva a «Dados de baja», con el botón para deshacerlo a la vista.
    await pagina.waitForURL((u) => new URL(u).searchParams.get('estado') === 'bajas', { timeout: 15000 }).catch(() => {})
    const reactivar = pagina.getByRole('button', { name: `Reactivar a PRUEBA${n}` })
    const aLaVista = await hasta(() => reactivar.count(), (c) => c === 1)
    if (aLaVista === 1) await reactivar.click()
    const otraVez = await hasta(activo, (v) => v === true)
    comprobar(pregunta.includes('Deja de entrar') && tras === false && aLaVista === 1 && otraVez === true,
      `Personal (administrador): «Dar de baja» pregunta, deja la ficha inactiva (${tras}), lleva a «Dados de baja» y «Reactivar» la vuelve activa (${otraVez})`)

    // Una pastilla tocada en la pausa de la búsqueda se queda.
    await pagina.goto(`${BASE}/personal`, { waitUntil: 'networkidle' })
    await pagina.getByRole('searchbox', { name: 'Buscar personal' }).pressSequentially('baja', { delay: 10 })
    await pagina.getByRole('link', { name: 'Dados de baja' }).click()
    await pagina.waitForTimeout(2000)
    const url = new URL(pagina.url())
    comprobar(url.searchParams.get('estado') === 'bajas' && url.searchParams.get('q') === 'baja',
      `Personal: la pastilla «Dados de baja» tocada mientras se escribe se queda (${url.search})`)

    // Lo mismo con la búsqueda ya en viaje y el servidor lento, como en un
    // teléfono con datos: la caja no se queda con un término que no filtra.
    await pagina.route(/\/personal(\?|$)/, async (ruta) => {
      if (ruta.request().headers()['rsc']) await new Promise((r) => setTimeout(r, 2000))
      await ruta.continue()
    })
    await pagina.goto(`${BASE}/personal`, { waitUntil: 'networkidle' })
    await pagina.getByRole('searchbox', { name: 'Buscar personal' }).pressSequentially('baja', { delay: 10 })
    await pagina.waitForTimeout(600)
    await pagina.getByRole('link', { name: 'Dados de baja' }).click()
    await pagina.waitForTimeout(7000)
    const lenta = new URL(pagina.url())
    const caja = await pagina.getByRole('searchbox', { name: 'Buscar personal' }).inputValue()
    const girando = await pagina.locator('main .animate-spin').count()
    await pagina.unroute(/\/personal(\?|$)/)
    comprobar(lenta.searchParams.get('estado') === 'bajas' && lenta.searchParams.get('q') === 'baja' && caja === 'baja' && girando === 0,
      `Personal: con la búsqueda en viaje y el servidor lento, la pastilla se queda con lo escrito (${lenta.search}, caja «${caja}», ${girando} girando)`)

    // Al revés: la pastilla en viaje y después se escribe. La búsqueda sale
    // sobre la pastilla y no la deshace.
    await pagina.route(/\/personal(\?|$)/, async (ruta) => {
      if (ruta.request().headers()['rsc']) await new Promise((r) => setTimeout(r, 2000))
      await ruta.continue()
    })
    await pagina.goto(`${BASE}/personal`, { waitUntil: 'networkidle' })
    await pagina.getByRole('link', { name: 'Dados de baja' }).click()
    await pagina.getByRole('searchbox', { name: 'Buscar personal' }).pressSequentially('baja', { delay: 10 })
    await pagina.waitForTimeout(7000)
    const despues = new URL(pagina.url())
    comprobar(despues.searchParams.get('estado') === 'bajas' && despues.searchParams.get('q') === 'baja',
      `Personal: la pastilla en viaje y después lo escrito, se quedan las dos (${despues.search})`)
    // Y «Limpiar» con la pastilla en viaje quita el término y deja la pastilla.
    await pagina.goto(`${BASE}/personal?q=baja`, { waitUntil: 'networkidle' })
    await pagina.getByRole('link', { name: 'Dados de baja' }).click()
    await pagina.getByRole('button', { name: 'Limpiar' }).click()
    await pagina.waitForTimeout(7000)
    const limpia = new URL(pagina.url())
    const vacia = await pagina.getByRole('searchbox', { name: 'Buscar personal' }).inputValue()
    await pagina.unroute(/\/personal(\?|$)/)
    comprobar(limpia.searchParams.get('estado') === 'bajas' && !limpia.searchParams.has('q') && vacia === '',
      `Personal: «Limpiar» con la pastilla en viaje deja la pastilla (${limpia.search}, caja «${vacia}»)`)
  }

  // Escribir despacio con el servidor lento: cada letra sale sola y la
  // respuesta de la anterior llega con otra en viaje. Antes, esa respuesta
  // copiaba a la caja el término viejo y se comía lo escrito entretanto: en
  // producción, «carroceria» quedaba «caroei» (2026-10-20). Se ve con la
  // demora variable de producción y con `next build` + `next start`: con
  // `next dev`, o con una demora fija, las respuestas no se cruzan.
  for (const [puesto, ruta, caja] of [
    ['gerencia', '/ordenes', 'Buscar órdenes'],
    ['ventas', '/clientes', 'Buscar clientes'],
  ]) {
    const { pagina } = await sesion(puesto)
    const patron = new RegExp(`${ruta}(\\?|$)`)
    await pagina.route(patron, async (r) => {
      if (r.request().headers()['rsc']) await new Promise((listo) => setTimeout(listo, 300 + Math.random() * 1500))
      // La respuesta demorada puede llegar con la página ya en otra parte.
      await r.continue().catch(() => {})
    })
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle', timeout: 60000 })
    const entrada = pagina.getByRole('searchbox', { name: caja })
    await entrada.pressSequentially('carroceria', { delay: 450 })
    await pagina.waitForURL((u) => u.searchParams.get('q') === 'carroceria', { timeout: 20000 }).catch(() => {})
    await pagina.waitForTimeout(2000)
    const escrito = await entrada.inputValue()
    const url = new URL(pagina.url())
    await pagina.unroute(patron)
    comprobar(escrito === 'carroceria' && url.searchParams.get('q') === 'carroceria',
      `${ruta} (${puesto}): escribiendo despacio con el servidor lento no se pierden letras (caja «${escrito}», URL «${url.searchParams.get('q')}»)`)
  }

  // «Limpiar», escribir otra cosa y tocar el menú antes de que vuelva nada: el
  // menú se lleva lo escrito, y la caja tiene que decir lo mismo que la URL.
  // Antes, el eco de «Limpiar» dejaba anotada como en viaje una búsqueda que el
  // menú ya había reemplazado: la caja con texto, la lista sin filtrar y el
  // ícono girando sin fin.
  {
    const { pagina } = await sesion('ventas')
    const patron = /\/clientes(\?|$)/
    await pagina.route(patron, async (r) => {
      if (r.request().headers()['rsc']) await new Promise((listo) => setTimeout(listo, 300 + Math.random() * 1500))
      // La respuesta demorada puede llegar con la página ya en otra parte.
      await r.continue().catch(() => {})
    })
    await pagina.goto(`${BASE}/clientes?q=pena`, { waitUntil: 'networkidle', timeout: 60000 })
    const entrada = pagina.getByRole('searchbox', { name: 'Buscar clientes' })
    await pagina.getByRole('button', { name: 'Limpiar' }).click()
    await entrada.pressSequentially('tra', { delay: 120 })
    await pagina.waitForTimeout(400)
    // El menú lateral en el monitor; en el teléfono, las pestañas de abajo.
    await pagina.locator('nav[aria-label="Menú principal"] a[href="/clientes"]:visible, nav[aria-label="Secciones"] a[href="/clientes"]:visible').first().click()
    const asentado = () =>
      pagina.evaluate(() => {
        const caja = document.querySelector('input[aria-label="Buscar clientes"]')
        const q = new URL(location.href).searchParams.get('q') ?? ''
        return { caja: caja?.value, q, gira: Boolean(caja?.closest('.relative')?.querySelector('.animate-spin')) }
      })
    let e = await asentado()
    for (let i = 0; i < 80 && (e.gira || e.caja !== e.q); i++) {
      await pagina.waitForTimeout(250)
      e = await asentado()
    }
    await pagina.unroute(patron)
    comprobar(!e.gira && e.caja === e.q,
      `/clientes (ventas): «Limpiar», escribir y el menú con todo en viaje dejan la caja como la URL (caja «${e.caja}», URL «${e.q}», ${e.gira ? 'gira' : 'quieto'})`)
  }

  // «Ver también…» de Clientes, Unidades y Proveedores se lleva lo que se está
  // escribiendo y el término ya puesto, como una pastilla.
  for (const [puesto, ruta, caja, enlace, estado] of [
    ['ventas', '/clientes', 'Buscar clientes', 'Ver también desactivados', 'inactivas'],
    ['ventas', '/unidades', 'Buscar unidades', 'Ver también desactivadas', 'inactivas'],
    ['contabilidad', '/proveedores', 'Buscar proveedores', 'Ver también los dados de baja', 'inactivos'],
  ]) {
    const { pagina } = await sesion(puesto)
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    await pagina.getByRole('searchbox', { name: caja }).pressSequentially('sac', { delay: 10 })
    await pagina.getByRole('link', { name: enlace }).click()
    await pagina.waitForTimeout(2500)
    const escrita = new URL(pagina.url())
    await pagina.goto(`${BASE}${ruta}?q=sac`, { waitUntil: 'networkidle' })
    await pagina.getByRole('link', { name: enlace }).click()
    await pagina.waitForTimeout(2500)
    const puesta = new URL(pagina.url())
    comprobar([escrita, puesta].every((u) => u.searchParams.get('estado') === estado && u.searchParams.get('q') === 'sac'),
      `${ruta} (${puesto}): «${enlace}» conserva lo escrito (${escrita.search}) y el término puesto (${puesta.search})`)
  }

  // Trabajos sin orden: la caja dice lo que filtra la lista, y la pastilla se
  // lleva lo escrito (D4 de diseño, cuadragésima séptima pasada). Era un
  // formulario sin control: la pastilla, que cambia solo la búsqueda, la
  // dejaba con lo escrito sin buscar, o vacía, sobre una lista con otro filtro.
  {
    const { pagina, errores } = await sesion('sup.mtz')
    errores.length = 0
    const caja = pagina.getByRole('searchbox', { name: 'Buscar un trabajo' })
    const pastilla = (nombre) => pagina.getByRole('group', { name: 'Filtrar por estado' }).getByRole('link', { name: nombre, exact: true })
    await pagina.goto(`${BASE}/avance/trabajos`, { waitUntil: 'networkidle' })
    await caja.pressSequentially('tolva', { delay: 10 })
    await pastilla('Cerrados').click()
    await pagina.waitForURL((u) => u.searchParams.get('estado') === 'SALIO', { timeout: 15000 }).catch(() => {})
    await pagina.waitForLoadState('networkidle')
    const escrita = new URL(pagina.url())
    const conLoEscrito = await caja.inputValue()
    await pagina.goto(`${BASE}/avance/trabajos?buscar=cabina`, { waitUntil: 'networkidle' })
    const alEntrar = await caja.inputValue()
    await caja.fill('')
    await pastilla('Terminados').click()
    await pagina.waitForURL((u) => u.searchParams.get('estado') === 'LISTA', { timeout: 15000 }).catch(() => {})
    await pagina.waitForLoadState('networkidle')
    const vaciada = new URL(pagina.url())
    const trasVaciar = await caja.inputValue()
    comprobar(escrita.searchParams.get('buscar') === 'tolva' && conLoEscrito === 'tolva' && alEntrar === 'cabina' && !vaciada.searchParams.has('buscar') && trasVaciar === '',
      `/avance/trabajos (sup.mtz): la pastilla se lleva lo escrito y la caja dice lo que filtra la lista (${escrita.search} «${conLoEscrito}»; con ?buscar=cabina «${alEntrar}», vaciada ${vaciada.search} «${trasVaciar}»)`)
    comprobar(await pagina.getByRole('button', { name: /^Buscar$/ }).count() === 0 && errores.length === 0,
      `/avance/trabajos (sup.mtz): sin botón «Buscar» que apretar ni errores de consola${errores.length ? ` (${errores.join(' | ')})` : ''}`)
  }

  // Órdenes: «Limpiar» quita la búsqueda y también la prioridad.
  {
    const { pagina } = await sesion('gerencia')
    await pagina.goto(`${BASE}/ordenes?q=zzz&prioridad=ALTA`, { waitUntil: 'networkidle' })
    await pagina.getByRole('button', { name: 'Limpiar' }).click()
    await pagina.waitForTimeout(2000)
    const url = new URL(pagina.url())
    comprobar(url.pathname === '/ordenes' && url.search === '', `Órdenes (gerencia): «Limpiar» quita la búsqueda y la prioridad («${url.search}»)`)
    // Y una prioridad elegida mientras se escribe se queda, con lo escrito.
    await pagina.getByRole('searchbox', { name: 'Buscar órdenes' }).pressSequentially('zzz', { delay: 10 })
    await pagina.getByLabel('Filtrar por prioridad').selectOption('ALTA')
    // Se espera a la URL: con el banco cargado, una respuesta tardó 3,6 s y un
    // plazo fijo de 2,5 s la dio por fallida.
    await pagina.waitForURL((u) => u.searchParams.get('prioridad') === 'ALTA' && u.searchParams.get('q') === 'zzz', { timeout: 15000 }).catch(() => {})
    const otra = new URL(pagina.url())
    comprobar(otra.searchParams.get('prioridad') === 'ALTA' && otra.searchParams.get('q') === 'zzz',
      `Órdenes (gerencia): la prioridad elegida mientras se escribe se queda con lo escrito («${otra.search}»)`)

    // Con el servidor lento: la prioridad en viaje y después lo escrito.
    await pagina.route(/\/ordenes(\?|$)/, async (ruta) => {
      if (ruta.request().headers()['rsc']) await new Promise((r) => setTimeout(r, 2000))
      await ruta.continue()
    })
    await pagina.goto(`${BASE}/ordenes`, { waitUntil: 'networkidle' })
    await pagina.getByLabel('Filtrar por prioridad').selectOption('ALTA')
    await pagina.getByRole('searchbox', { name: 'Buscar órdenes' }).pressSequentially('tolva', { delay: 10 })
    await pagina.waitForTimeout(7000)
    const lenta = new URL(pagina.url())
    // Y «Limpiar», lo escrito y la prioridad antes de que responda; después se
    // borra la caja: la lista no se queda filtrada con la caja vacía.
    await pagina.goto(`${BASE}/ordenes?q=zzz&prioridad=ALTA`, { waitUntil: 'networkidle' })
    await pagina.getByRole('button', { name: 'Limpiar' }).click()
    await pagina.getByRole('searchbox', { name: 'Buscar órdenes' }).pressSequentially('zzz', { delay: 10 })
    await pagina.getByLabel('Filtrar por prioridad').selectOption('ALTA')
    await pagina.waitForTimeout(7000)
    await pagina.getByRole('searchbox', { name: 'Buscar órdenes' }).fill('')
    await pagina.waitForTimeout(7000)
    const borrada = new URL(pagina.url())
    const gira = await pagina.locator('main .animate-spin').count()
    await pagina.unroute(/\/ordenes(\?|$)/)
    comprobar(lenta.searchParams.get('prioridad') === 'ALTA' && lenta.searchParams.get('q') === 'tolva',
      `Órdenes (gerencia): con el servidor lento, la prioridad en viaje y después lo escrito se quedan («${lenta.search}»)`)
    comprobar(!borrada.searchParams.has('q') && borrada.searchParams.get('prioridad') === 'ALTA' && gira === 0,
      `Órdenes (gerencia): tras «Limpiar» y volver a escribir, borrar la caja quita el término («${borrada.search}», ${gira} girando)`)
  }

  // Kardex: lo escrito en «Unidad o código» sin pulsar «Ver» no sobrevive a «Limpiar».
  {
    const { pagina } = await sesion('almacen')
    await pagina.goto(`${BASE}/almacen/kardex?unidad=${encodeURIComponent(`qa bus ${sello}`)}`, { waitUntil: 'networkidle' })
    await pagina.locator('#k-unidad').fill('escrito sin ver')
    await pagina.getByRole('link', { name: 'Limpiar' }).click()
    await pagina.waitForURL((u) => !new URL(u).searchParams.has('unidad'), { timeout: 15000 }).catch(() => {})
    const queda = await hasta(() => pagina.locator('#k-unidad').inputValue(), (v) => v === '')
    comprobar(queda === '', `Kardex (almacén): «Limpiar» vacía también lo escrito sin «Ver» («${queda}»)`)
  }

  // Los que filtran en el navegador: la asistencia de Portería…
  {
    const { pagina } = await sesion('porteria')
    await pagina.goto(`${BASE}/rrhh/asistencia`, { waitUntil: 'networkidle' })
    const caja = pagina.getByLabel('Buscar por nombre o DNI')
    for (const texto of [`angel zuniga ${sello}`, `pena ${sello}`, `${DNI}1`]) {
      await caja.fill('')
      await caja.pressSequentially(texto, { delay: 15 })
      // El DNI entero se busca en el servidor, sin bajar los números (#126): se espera la respuesta.
      const t = await hasta(() => textoDe(pagina), (x) => x.includes(TRABAJADOR) && !x.includes(OTRO))
      comprobar(t.includes(TRABAJADOR) && !t.includes(OTRO), `Asistencia (portería): «${texto}» deja solo a ${TRABAJADOR}`)
    }
  }

  // …la planilla del mes en preparación (RRHH) ya no reparte entre las OT:
  // dice cómo entra cada persona al costo (aquí, sin ficha en Personal)…
  {
    const { pagina } = await sesion('rrhh')
    await pagina.goto(`${BASE}/rrhh`, { waitUntil: 'networkidle' })
    const fila = pagina.locator('details', { hasText: PERSONA })
    const texto = (await fila.first().innerText().catch(() => '')).replace(/\s+/g, ' ')
    comprobar(texto.includes('sin ficha en Personal'), `Planillas (RRHH): la persona sin ficha dice cómo entra al costo («${texto.slice(0, 120)}», estado ${planilla.estado})`)
    comprobar((await pagina.getByText('Repartir en partes iguales').count()) === 0 && !texto.includes('Repartido'), 'Planillas (RRHH): sin reparto entre las OT')
  }

  // …y el desplegable con buscador, aquí el del cliente de una orden nueva.
  {
    const { pagina } = await sesion('administracion')
    await pagina.goto(`${BASE}/ordenes/nueva`, { waitUntil: 'networkidle' })
    const disparador = pagina.locator('#cliente_id')
    if (await disparador.count()) {
      await disparador.click()
      await pagina.getByLabel('Razón social o RUC').pressSequentially(`nunez pena ${sello} sac`, { delay: 15 })
      const opcion = pagina.getByRole('option', { name: new RegExp(sello) })
      comprobar(await hasta(() => opcion.count(), (n) => n === 1) === 1, `Orden nueva (administración): el desplegable de clientes encuentra «${CLIENTE}» con «nunez pena … sac», sin su gemelo E.I.R.L.`)
      // Elegido, el nombre se lee entero: en el teléfono quedaba en «TRANS…».
      await opcion.click()
      const etiqueta = disparador.locator('span').last()
      const cortada = await etiqueta.evaluate((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)
      const visto = await etiqueta.innerText()
      comprobar(ancho > 1000 || (!cortada && visto.includes(sello)), `Orden nueva (administración): el cliente elegido se lee entero en el desplegable («${visto}»)`)
    } else {
      comprobar(false, 'Orden nueva (administración): no se encontró el desplegable de clientes')
    }
  }

  for (const { contexto } of sesiones.values()) await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} fallas` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
