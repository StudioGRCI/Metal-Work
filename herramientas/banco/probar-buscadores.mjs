/**
 * Recorre con tecleo real los buscadores de las listas, con la cuenta del
 * puesto que usa cada una (nunca ADMIN), en el teléfono y en el monitor:
 *
 *   1. Se busca sin tildes y encuentra con tilde («nunez» → «NÚÑEZ»).
 *   2. Las palabras van en cualquier orden («agua cisterna» → «CISTERNA DE AGUA»).
 *   3. Una coma o un paréntesis escritos no tiran la pantalla (en Materiales
 *      «plancha, a36» la tumbaba).
 *   4. Ningún buscador pide apretar «Buscar»: lo escrito llega solo a la URL.
 *   5. «Limpiar» quita el término y deja los demás filtros puestos.
 *   6. Lo que la pantalla muestra es lo que la base tiene: se cuenta en SQL.
 *   7. El desplegable con buscador (`SeleccionBuscable`) y el buscador de la
 *      asistencia, que filtran en el navegador, buscan igual.
 *
 * Siembra sus propios datos con un sello distinto en cada corrida: un material,
 * un cliente, un proveedor, una unidad y una orden con tildes en el nombre.
 * Necesita las cuentas `*.local@metalwork.test` de Gerencia, Contabilidad,
 * Logística, Requerimientos, Supervisión (sup.mtz), Portería y Administración.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const cuenta = (puesto) => `${puesto}.local@metalwork.test`
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
const PROVEEDOR = `TORNERÍA ÁVILA ${sello} E.I.R.L.`
// El dominio `placa` pide tres y tres: «Q12-345».
const PLACA = `Q${sello.slice(0, 2)}-${sello.slice(3)}`
const OT = `CAMIÓN CISTERNA DE AGUA BUSCA ${sello}`
const CODIGO = `QA_BUS_${sello}`

const almacenero = (await uno(`select id from public.usuarios where correo = $1`, [cuenta('logistica')])).id
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
                  values (gen_random_uuid(), 'INGRESO', $1, 5, 'INGRESO_GENERAL', 'Banco de buscadores', $2, 10, 'PEN', now() - interval '1 hour')`, [id, almacenero])
  await consulta(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                                             recibido_por_nombre, codigo_unidad, codigo_interno, cantidad_de_stock)
                  values (gen_random_uuid(), 'SALIDA', $1, 1, 'SALIDA_GENERAL', 'Banco de buscadores', $2, 'Área de banco', $3, $3, 1)`, [id, almacenero, CODIGO])
}
const clienteId = (await uno(`insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', $1, $2) returning id`, [await rucLibre('clientes'), CLIENTE])).id
await consulta(`insert into public.proveedores (tipo_documento, numero_documento, razon_social, rubro) values ('RUC', $1, $2, 'Tornería y maestranza')`, [await rucLibre('proveedores'), PROVEEDOR])
const unidadId = (await uno(`insert into public.unidades (cliente_id, placa, marca, modelo, tipo_vehiculo) values ($1, $2, 'VOLVO', 'FMX ÚNICO', 'VOLQUETE') returning id`, [clienteId, PLACA])).id
const ot = await uno(
  `insert into public.ordenes_trabajo (sede_id, descripcion, cliente_id, unidad_id) values ((select id from public.sedes order by nombre limit 1), $1, $2, $3) returning numero`,
  [OT, clienteId, unidadId],
)
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
  ['gerencia', '/materiales', 'Buscar material', 'buscar', 'angulo 1/4', MATERIAL],
  ['gerencia', '/materiales', 'Buscar material', 'buscar', 'plancha, a36', PLANCHA],
  ['logistica', '/compras/valorizacion', 'Buscar material', 'q', `busca ${sello} angulo`, MATERIAL],
  ['gerencia', '/clientes', 'Buscar clientes', 'q', `pena nunez ${sello}`, CLIENTE],
  ['contabilidad', '/proveedores', 'Buscar proveedores', 'q', `avila torneria ${sello}`, PROVEEDOR],
  ['gerencia', '/unidades', 'Buscar unidades', 'q', `fmx unico ${sello.slice(3)}`, PLACA],
  ['gerencia', '/ordenes', 'Buscar órdenes', 'q', `agua cisterna camion ${sello}`, ot.numero],
  ['gerencia', '/cotizaciones/pdf', 'Buscar cotizaciones', 'q', 'caja prueba', 'QA-CAJA'],
  ['gerencia', '/codigos-internos', 'Buscar código interno', 'q', 'avm', 'AVM_FG_N2_1_26/44'],
  ['requerimientos', '/requerimientos/gasto-por-codigo', 'Buscar código interno', 'q', `qa_bus_${sello}`, CODIGO],
  ['logistica', '/compras/servicios', 'Buscar por código interno', 'codigo', 'prb_caja', 'PRB-CAJA'],
  ['sup.mtz', '/almacen/stock', 'Buscar en el stock', 'q', `angulo ${sello}`, MATERIAL],
]

for (const ancho of [390, 1280]) {
  const sesiones = new Map()
  const sesion = async (puesto) => {
    if (!sesiones.has(puesto)) sesiones.set(puesto, await entrar(puesto, ancho))
    return sesiones.get(puesto)
  }
  console.log(`\n— A ${ancho} px`)

  for (const [puesto, ruta, etiqueta, clave, texto, espera] of CASOS) {
    const { pagina, errores } = await sesion(puesto)
    errores.length = 0
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    const llego = await buscar(pagina, etiqueta, clave, texto)
    const visto = await hasta(() => textoDe(pagina), (t) => t.includes(espera))
    comprobar(llego === texto && visto.includes(espera), `${puesto} ${ruta}: «${texto}» llega solo a la URL y encuentra «${espera}»`)
    comprobar(!/no se pudo abrir/i.test(visto) && errores.length === 0, `${puesto} ${ruta}: sin pantalla de error ni errores de consola${errores.length ? ` (${errores.join(' | ')})` : ''}`)
    comprobar(await pagina.getByRole('button', { name: /^Buscar$/ }).count() === 0, `${puesto} ${ruta}: no hay botón «Buscar» que apretar`)
    const ancho2 = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(ancho2 <= ancho, `${puesto} ${ruta}: la pantalla no se sale de costado (${ancho2} px)`)
    await pagina.screenshot({ path: join(CAPTURAS, `buscador-${ancho}${ruta.replace(/\//g, '_')}.png`) })
  }

  // Lo que se ve es lo que la base tiene: los materiales con «angulo», contados con y sin tilde.
  {
    const { pagina } = await sesion('gerencia')
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
    await buscar(pagina, 'Buscar por código interno', 'codigo', 'prb')
    await pagina.getByRole('button', { name: 'Limpiar' }).click()
    await pagina.waitForURL((u) => !new URL(u).searchParams.has('codigo'), { timeout: 15000 }).catch(() => {})
    const params = new URL(pagina.url()).searchParams
    comprobar(!params.has('codigo') && params.get('estado') === 'todos', `Subcontratos: «Limpiar» deja estado=todos y quita el código (${pagina.url().replace(BASE, '')})`)
    comprobar((await pagina.getByRole('searchbox', { name: 'Buscar por código interno' }).inputValue()) === '', 'Subcontratos: la caja queda vacía después de «Limpiar»')
  }

  // Un término que no está: el estado vacío lo dice con lo que se escribió.
  {
    const { pagina } = await sesion('gerencia')
    await pagina.goto(`${BASE}/clientes`, { waitUntil: 'networkidle' })
    await buscar(pagina, 'Buscar clientes', 'q', `zzz${sello}`)
    const t = await hasta(() => textoDe(pagina), (x) => x.includes('Ningún cliente coincide'))
    comprobar(t.includes('Ningún cliente coincide') && t.includes(`zzz${sello}`), 'Clientes: sin resultados lo dice, con lo que se escribió')
  }

  // Los que filtran en el navegador: la asistencia de Portería…
  {
    const { pagina } = await sesion('porteria')
    await pagina.goto(`${BASE}/rrhh/asistencia`, { waitUntil: 'networkidle' })
    const caja = pagina.getByLabel('Buscar por nombre o DNI')
    for (const texto of ['kevin alayo', 'rios']) {
      await caja.fill('')
      await caja.pressSequentially(texto, { delay: 15 })
      const t = await textoDe(pagina)
      comprobar(t.includes('Alayo Ríos, Kevin') && !t.includes('Castillo Rebaza'), `Asistencia (portería): «${texto}» deja solo a Alayo Ríos, Kevin`)
    }
  }

  // …y el desplegable con buscador, aquí el del cliente de una orden nueva.
  {
    const { pagina } = await sesion('administracion')
    await pagina.goto(`${BASE}/ordenes/nueva`, { waitUntil: 'networkidle' })
    const disparador = pagina.locator('#cliente_id')
    if (await disparador.count()) {
      await disparador.click()
      await pagina.getByLabel('Razón social o RUC').pressSequentially(`nunez pena ${sello}`, { delay: 15 })
      const opcion = pagina.getByRole('option', { name: new RegExp(sello) })
      comprobar(await hasta(() => opcion.count(), (n) => n === 1) === 1, `Orden nueva (administración): el desplegable de clientes encuentra «${CLIENTE}» con «nunez pena»`)
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
