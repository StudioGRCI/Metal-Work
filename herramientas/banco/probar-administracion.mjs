/**
 * Recorre con clic real lo que DKS pidió para Administración el 2026-10-19
 * (migraciones 20261017400000, 401000 y 402000), con la cuenta de cada puesto
 * (nunca ADMIN):
 *
 *   1. Administración: el menú lleva Códigos internos arriba, ya no lleva
 *      Personal ni Configuración (y por su dirección le dicen «Sin permiso»), y
 *      Clientes va al final de Consultas.
 *   2. Su requerimiento se carga a todos los códigos activos: elige «Todos los
 *      códigos activos», el código no se escribe, y lo que Almacén entrega se
 *      reparte en el costeo de los códigos que trabajaron este mes.
 *   3. Ve Códigos internos en lectura: la lista, el costeo con la parte de cada
 *      uno, y sin el botón de cerrar el costeo.
 *   4. La orden sin cotización no se registra sin su PDF ni con el número de
 *      otra orden; con los dos, nace en borrador con el número de su papel
 *      (migración 20261021110000) y ella ve su PDF en la orden.
 *   5. Gerencia abre la orden y no ve el PDF, pero sabe que lo tiene; Diseño sí lo ve.
 *
 * Arma sus propios datos ficticios (QA_ADM_…) y las cuentas `*.adm@banco.test`
 * con la clave local. Variables: BANCO_CLAVE, BASE (http://localhost:3111),
 * BANCO_BASE (mw_demo), BANCO_ARCHIVOS (el mismo del servidor del banco),
 * CAPTURAS.
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const ARCHIVOS = process.env.BANCO_ARCHIVOS ?? '/tmp/banco-archivos'
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

/**
 * La red quieta, sin colgarse. Con Next 16, Chromium deja a veces para
 * Playwright una precarga del menú «abierta» para siempre: la que el enrutador
 * abandonó al cambiar de página, sin respuesta ni error, aunque el servidor la
 * contesta en milisegundos y el socket ya está cerrado. `networkidle` no llega
 * nunca y el `goto` muere a los 30 s (pasa en una de cada tres navegaciones).
 * Se espera la carga completa y, a lo sumo diez segundos, la red quieta.
 */
const quieta = (pagina) => pagina.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
async function ir(pagina, url) {
  await pagina.goto(url, { waitUntil: 'load' })
  await quieta(pagina)
}

/** Un PDF de una página con estas líneas, como el de una orden de trabajo. */
function pdfConTexto(lineas) {
  const texto = lineas.map((l, i) => `BT /F1 11 Tf 50 ${780 - i * 18} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n')
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(texto, 'latin1')} >>\nstream\n${texto}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  let pdf = '%PDF-1.4\n'
  const posiciones = []
  objetos.forEach((o, i) => {
    posiciones.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  pdf += posiciones.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

// ------------------------------------------------------------------ armazón
const sello = Date.now().toString().slice(-6)
const CUENTAS = {
  administracion: ['ADMINISTRACION', 'ADM'],
  gerencia: ['GERENTE', 'GGE'],
  diseno: ['DISENO', 'DIS'],
  almacen: ['ALMACENERO', 'ALM'],
}
const ids = {}
for (const [clave, [rol, area]] of Object.entries(CUENTAS)) {
  const correo = `${clave}.adm@banco.test`
  let fila = await uno('select id from public.usuarios where correo = $1', [correo])
  if (!fila) {
    fila = await uno(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [correo])
    await consulta(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
       select $1, $2, 'Banco Administración', $3, r.id, (select id from public.areas where codigo = $4) from public.roles r where r.codigo = $2`,
      [fila.id, rol, correo, area],
    )
  }
  await consulta(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where email = $1`, [correo, CLAVE])
  ids[clave] = fila.id
}
await consulta(`insert into public.empresa (ruc, razon_social) select '20100000398', 'PRUEBAS ADMINISTRACION S.A.C.' where not exists (select 1 from public.empresa)`)

/** Corre `sql` dentro de una transacción con la sesión de `quien` y el rol authenticated. */
async function como(quien, sql, valores = []) {
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                             set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [ids[quien]])
    await base.query('set local role authenticated')
    const r = (await base.query(sql, valores)).rows
    await base.query('commit')
    return r
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

// Un cliente, y un material con stock que este mes salió para dos unidades: esas
// dos son las que trabajaron.
const ruc = (await uno(`select n::text as ruc from generate_series(20990039800::bigint, 20990049999::bigint) n
                         where public.ruc_es_valido(n::text) and not exists (select 1 from public.clientes c where c.numero_documento = n::text) limit 1`)).ruc
const cliente = `QA TRANSPORTES ADM ${sello}`
await consulta(`insert into public.clientes (tipo_documento, numero_documento, razon_social) values ('RUC', $1, $2)`, [ruc, cliente])
const A = `QA_ADM_A_${sello}`
const B = `QA_ADM_B_${sello}`
const material = `Guantes de banco ${sello}`
const materialId = (await uno(
  `insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
   values ($1, $2, (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1),
           (select id from public.unidades_medida where codigo = 'UND')) returning id`,
  [`QA-ADM-${sello}`, material],
)).id
await consulta(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, precio_unitario, moneda, registrado_en)
                values (gen_random_uuid(), 'INGRESO', $1, 30, 'INGRESO_GENERAL', 'Compra de banco', $2, 10, 'PEN', now() - interval '1 hour')`, [materialId, ids.almacen])
for (const c of [A, B]) {
  await consulta(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                                             recibido_por_nombre, codigo_unidad, codigo_interno, cantidad_de_stock)
                  values (gen_random_uuid(), 'SALIDA', $1, 1, 'SALIDA_GENERAL', 'Para la unidad', $2, 'Área de banco', $3, $3, 1)`, [materialId, ids.almacen, c])
}

// ------------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(clave) {
  const correo = `${clave}.adm@banco.test`
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
  await ir(pagina, `${BASE}/ingresar`)
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  await quieta(pagina)
  return { pagina, contexto }
}

/** Los títulos de grupo del menú y, por grupo, sus entradas. */
async function menu(pagina) {
  return pagina.locator('nav[aria-label="Menú principal"] > div').evaluateAll((divs) =>
    divs.map((d) => ({ grupo: d.querySelector('p')?.textContent?.trim(), items: [...d.querySelectorAll('a')].map((a) => a.textContent?.trim()) })),
  )
}

let rqa = ''
let ordenId = ''

// ------------------------------------------------ 1. Administración: el menú
{
  const { pagina, contexto } = await entrar('administracion')
  const grupos = await menu(pagina)
  const entradas = grupos.flatMap((g) => g.items)
  console.log(grupos.map((g) => `${g.grupo}: ${g.items.join(', ')}`).join('\n'))
  comprobar(grupos[0]?.items.some((i) => i?.startsWith('Códigos internos')), 'Códigos internos va arriba, en Principal')
  comprobar(!entradas.some((i) => /^(Personal|Configuración)/.test(i ?? '')), 'el menú ya no lleva Personal ni Configuración')
  comprobar(!grupos.some((g) => g.grupo === 'Administración del sistema'), 'ni la sección Administración del sistema')
  const consultas = grupos.find((g) => g.grupo === 'Consultas')
  comprobar(consultas?.items.at(-1)?.startsWith('Clientes'), 'Clientes va al final de Consultas')
  comprobar(!grupos.find((g) => g.grupo === 'Administración')?.items.some((i) => i?.startsWith('Clientes')), 'y ya no en Administración')
  await pagina.screenshot({ path: `${CAPTURAS}/adm-menu.png`, fullPage: true })

  for (const ruta of ['/personal', '/configuracion']) {
    await ir(pagina, `${BASE}${ruta}`)
    const t = limpio(await pagina.locator('main').innerText())
    comprobar(pagina.url().includes('/sin-permiso') || /sin permiso|no tienes permiso/i.test(t), `por su dirección, ${ruta} le dice que no tiene permiso`)
  }

  // ---------------------------------------------- 2. El RQA a todos los activos
  await ir(pagina, `${BASE}/requerimientos`)
  await pagina.getByRole('button', { name: 'Nuevo requerimiento de Administración' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('#rq-area').selectOption({ index: 1 })
  comprobar((await v.locator('#rq-codigo').count()) === 1, 'de entrada pide un código interno')
  await v.locator('#rq-codigo').fill('OFICINA')
  await v.locator('#rq-cargo').selectOption('TODOS')
  await v.locator('#rq-cargo').selectOption('UNO')
  comprobar((await v.locator('#rq-codigo').inputValue()) === 'OFICINA', 'si va y vuelve de «Todos», el código escrito sigue ahí')
  await v.locator('#rq-cargo').selectOption('TODOS')
  comprobar((await v.locator('#rq-codigo').count()) === 0, 'con «Todos los códigos activos» ya no pide el código')
  comprobar(await v.getByText('Partes iguales entre los códigos que trabajaron ese mes.').isVisible(), 'y dice a la vista cómo se reparte')
  await v.locator('#rq-justificacion').fill('Guantes para todas las unidades en fabricación (banco)')
  await v.locator('[aria-haspopup="listbox"]').first().click()
  await pagina.getByRole('searchbox').fill(material)
  await pagina.locator('[role="option"]').first().click()
  await v.locator('input[type="number"]').first().fill('6')
  await v.screenshot({ path: `${CAPTURAS}/adm-rqa-a-todos.png` })
  await v.getByRole('button', { name: 'Registrar y mandar a Almacén' }).click()
  await pagina.locator('[role="status"]').first().waitFor({ timeout: 20000 })
  rqa = ((await pagina.locator('[role="status"]').first().innerText()).match(/RQA-\d{4}-\d{4}/) ?? [''])[0]
  const fila = await uno(`select id, codigo_interno from public.requerimientos where numero = $1`, [rqa])
  comprobar(fila?.codigo_interno === 'TODOS LOS ACTIVOS', `el ${rqa || 'RQA'} queda cargado a TODOS LOS ACTIVOS`)
  await pagina.waitForTimeout(800)
  comprobar(limpio(await pagina.locator('main').innerText()).includes('TODOS LOS ACTIVOS'), 'y la lista lo dice')
  await pagina.screenshot({ path: `${CAPTURAS}/adm-rqa-lista.png`, fullPage: true })
  // En el teléfono la lista no ensancha la página (la ventana del RQA se salía por la derecha).
  await pagina.setViewportSize({ width: 390, height: 844 })
  await ir(pagina, `${BASE}/requerimientos`)
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `en el teléfono la lista de requerimientos cabe en la pantalla (${ancho} px de 390)`)
  await pagina.setViewportSize({ width: 1280, height: 900 })

  // Almacén entrega los seis por el RQ (como en el kardex; aquí por la base, con su cuenta).
  const salida = (await uno('select gen_random_uuid() as id')).id
  const foto = `${ids.almacen}/${salida}.jpg`
  // La foto va también al disco del banco: con la fila sola, el kardex de cualquier
  // puesto pedía esa evidencia y el banco contestaba 500 «No se pudo abrir la foto».
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAA//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z', 'base64')
  mkdirSync(dirname(join(ARCHIVOS, 'evidencias-almacen', foto)), { recursive: true })
  writeFileSync(join(ARCHIVOS, 'evidencias-almacen', foto), jpeg)
  await consulta(`insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ('evidencias-almacen', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'image/jpeg', 'size', $3::bigint))`, [foto, ids.almacen, jpeg.length])
  await como('almacen', `select public.registrar_salida_material($1, $2, 6, null, null, $3, 'Administración', $4,
                           (select l.id from public.requerimiento_lineas l where l.requerimiento_id = $5 and l.item = 1))`,
  [salida, materialId, `${rqa} · ítem 1`, foto, fila?.id])

  // ---------------------------------------------- 3. Códigos internos, en lectura
  await ir(pagina, `${BASE}/codigos-internos`)
  const lista = limpio(await pagina.locator('main').innerText())
  comprobar(lista.includes(A) && lista.includes(B), 've los códigos en la lista de Códigos internos')
  await pagina.screenshot({ path: `${CAPTURAS}/adm-codigos.png`, fullPage: true })
  await ir(pagina, `${BASE}/codigos-internos/detalle?${new URLSearchParams({ codigo: A, vista: 'costeo' })}`)
  const costeo = limpio(await pagina.locator('main').innerText())
  const n = (await uno(`select count(distinct l.codigo)::int as n from public.codigo_interno_lineas(null, true) l where l.referencia_id = $1`, [salida])).n
  comprobar(costeo.includes(`partes iguales entre los ${n} códigos que trabajaron ese mes`), `el costeo de ${A} lleva su parte, entre ${n} códigos`)
  comprobar((await pagina.getByRole('button', { name: 'Cerrar el costeo' }).count()) === 0, 'y no tiene el botón de cerrar el costeo')
  await pagina.screenshot({ path: `${CAPTURAS}/adm-costeo-a.png`, fullPage: true })
  await ir(pagina, `${BASE}/codigos-internos/detalle?${new URLSearchParams({ codigo: 'TODOS LOS ACTIVOS' })}`)
  // Desde el 2026-10-19 (#117) la explicación del reparto va detrás del botón «i» del título.
  await pagina.getByRole('button', { name: 'Para qué sirve: A dónde fue' }).click().catch(() => {})
  const todos = limpio(await pagina.locator('main').innerText())
  comprobar(todos.includes('A dónde fue') && todos.includes('PLANTA y OFICINA no reciben'), 'TODOS LOS ACTIVOS abre en a dónde fue lo repartido')
  comprobar((await pagina.locator(`[data-reparto="${A}"]`).count()) >= 1 && (await pagina.locator('[data-repartido]').count()) === 1,
    `y dice cuánto se repartió y lo que le tocó a ${A}`)
  const mes = await pagina.locator('tbody[data-mes]').first().locator('th').innerText()
  comprobar(/\d{2}\/\d{4} · \d+ salidas?/.test(limpio(mes)), `agrupado por mes, con sus salidas (${limpio(mes)})`)
  const secciones = (await pagina.locator('[role="group"][aria-label="Secciones del código"] a').allInnerTexts()).map(limpio)
  comprobar(secciones.join('|') === 'Reparto|RQ, OT y cotización', `solo Reparto y sus requerimientos, sin las secciones de una unidad (${secciones.join(', ')})`)
  await pagina.screenshot({ path: `${CAPTURAS}/adm-todos-los-activos.png`, fullPage: true })

  // ---------------------------------------------- 4. La orden sin cotización con su PDF
  await ir(pagina, `${BASE}/ordenes/nueva`)
  await pagina.locator('#cliente_id').click()
  await pagina.getByRole('searchbox').fill(cliente)
  await pagina.locator('[role="option"]').first().click()
  await pagina.locator('#tipo_trabajo').selectOption('REPARACION')
  await pagina.locator('#descripcion').fill(`Reparación de la tolva de banco ${sello}`)
  // El número es el del papel (migración 20261021110000): primero uno que ya
  // tiene otra orden, después el bueno.
  const repetido = (await uno(`select numero from public.ordenes_trabajo order by creado_en limit 1`))?.numero ?? ''
  await pagina.locator('#numero').fill(repetido)
  await pagina.getByRole('button', { name: 'Registrar orden' }).click()
  await pagina.locator('[role="alert"]').first().waitFor({ timeout: 10000 })
  comprobar(/Elige el PDF de la orden/.test(await pagina.locator('[role="alert"]').first().innerText()), 'sin el PDF no se registra')
  comprobar((await uno(`select count(*)::int as n from public.ordenes_trabajo where descripcion like $1`, [`%banco ${sello}`])).n === 0, 'y no dejó ninguna orden')

  const archivo = join(CAPTURAS, `OT-banco-${sello}.pdf`)
  writeFileSync(archivo, pdfConTexto([`ORDEN DE TRABAJO de banco ${sello}`, `CLIENTE: ${cliente}`, 'Reparación de tolva']))
  await pagina.locator('input[type="file"]').setInputFiles(archivo)
  await pagina.getByText(`OT-banco-${sello}.pdf`).waitFor({ timeout: 5000 })
  comprobar(await pagina.getByText('Listo · toca para cambiarlo').isVisible(), 'el PDF elegido se distingue de la zona vacía')
  await pagina.screenshot({ path: `${CAPTURAS}/adm-orden-con-pdf.png`, fullPage: true })
  if (repetido) {
    const antesDelRepetido = new Date()
    await pagina.getByRole('button', { name: 'Registrar orden' }).click()
    await pagina.getByText(`Ya hay una orden de trabajo ${repetido}`).waitFor({ timeout: 30000 }).catch(() => {})
    comprobar(limpio(await pagina.locator('main').innerText()).includes(`Ya hay una orden de trabajo ${repetido}`),
      `con el número ${repetido}, que ya es de otra orden, no se registra y lo dice`)
    comprobar((await pagina.locator('#numero').getAttribute('aria-invalid')) === 'true'
              && (await pagina.evaluate(() => document.activeElement?.id)) === 'numero',
      'el rechazo queda en el campo del número, con el cursor ahí')
    // El de su campo también es `role="alert"`: se cuentan los que lo dicen.
    comprobar((await pagina.locator('[role="alert"]', { hasText: 'Ya hay una orden de trabajo' }).count()) === 1,
      'y no se repite en el aviso de abajo')
    comprobar((await uno(`select count(*)::int as n from public.ordenes_trabajo where descripcion like $1`, [`%banco ${sello}`])).n === 0,
      'y no dejó ninguna orden')
    await pagina.waitForTimeout(1500)
    comprobar((await uno(`select count(*)::int as n from storage.objects o where o.bucket_id = 'adjuntos-ot' and o.created_at > $1
                            and not exists (select 1 from public.ot_adjuntos a where a.ruta_storage = o.name)`, [antesDelRepetido])).n === 0,
      'ni su PDF suelto en Storage')
  }
  // Sin ceros adelante: la base los quita («016992» queda 16992).
  const numeroPapel = String(Number(sello) || 1)
  await pagina.locator('#numero').fill(numeroPapel)
  comprobar(limpio(await pagina.locator('main').innerText()).includes(`Se registrará como la OT ${numeroPapel.padStart(4, '0')}-`),
    'antes de registrar, dice cómo va a quedar el número')
  await Promise.all([
    pagina.waitForURL(/\/ordenes\/[0-9a-f-]{36}/, { timeout: 30000 }),
    pagina.getByRole('button', { name: 'Registrar orden' }).click(),
  ])
  await quieta(pagina)
  // La primera vez `next dev` compila la orden: se espera a que se pinte.
  await pagina.getByText('Orden registrada con su PDF').waitFor({ timeout: 60000 }).catch(() => {})
  ordenId = pagina.url().match(/\/ordenes\/([0-9a-f-]{36})/)?.[1] ?? ''
  const orden = await uno(`select o.estado::text, o.numero, a.ruta_storage, a.nombre_archivo from public.ordenes_trabajo o
                            join public.ot_adjuntos a on a.orden_id = o.id and a.tipo = 'ORDEN' where o.id = $1`, [ordenId])
  comprobar(orden?.estado === 'BORRADOR' && Boolean(orden?.ruta_storage), `la orden ${orden?.numero ?? ''} nace en borrador con su PDF`)
  const anio = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric' }).format(new Date())
  comprobar(orden?.numero === `${numeroPapel.padStart(4, '0')}-${anio}`, `y con el número de su papel: ${orden?.numero ?? ''}`)
  let guardado = false
  try {
    guardado = statSync(join(ARCHIVOS, 'adjuntos-ot', orden?.ruta_storage ?? 'x')).size > 0
  } catch {}
  comprobar(guardado, 'el PDF quedó guardado en la carpeta de la orden')
  // El banco borra solo la fila al quitar un archivo: lo que dice si el PDF sigue es storage.objects.
  await pagina.waitForTimeout(1500)
  const objeto = await uno(`select count(*)::int as n from storage.objects where bucket_id = 'adjuntos-ot' and name = $1`, [orden?.ruta_storage ?? ''])
  comprobar(objeto?.n === 1, 'y sigue en Storage después de registrar (nadie lo quitó al ir a la orden)')
  const vista = limpio(await pagina.locator('main').innerText())
  comprobar(vista.includes('Orden registrada con su PDF'), 'la orden dice que se registró con su PDF')
  comprobar(vista.includes(`OT-banco-${sello}.pdf`), 'y Administración ve su PDF en la orden')
  comprobar((await pagina.getByRole('button', { name: `Quitar OT-banco-${sello}.pdf` }).count()) === 0, 'sin botón para quitar el único PDF de la orden')
  comprobar(await pagina.getByText('Para cambiarlo, sube el correcto y después quita este.').isVisible(), 'y dice cómo se cambia')
  await pagina.screenshot({ path: `${CAPTURAS}/adm-orden-registrada.png`, fullPage: true })
  await contexto.close()
}

// ------------------------------------------------ 5. Gerencia no ve el PDF; Diseño sí
{
  const { pagina, contexto } = await entrar('gerencia')
  await ir(pagina, `${BASE}/ordenes/${ordenId}`)
  await pagina.getByText('Orden de trabajo', { exact: true }).first().waitFor({ timeout: 60000 }).catch(() => {})
  const t = limpio(await pagina.locator('main').innerText())
  comprobar(!t.includes(`OT-banco-${sello}.pdf`), 'Gerencia abre la orden y no ve el PDF')
  comprobar(t.includes('La orden tiene su PDF. Lo abren Diseño y Supervisión'), 'pero sabe que la orden tiene su PDF, y quién lo abre')
  comprobar((await pagina.getByText('Subir PDF').count()) === 0, 'y no se le ofrece subir otro')
  await pagina.screenshot({ path: `${CAPTURAS}/adm-orden-gerencia.png`, fullPage: true })
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('diseno')
  await ir(pagina, `${BASE}/ordenes/${ordenId}`)
  await pagina.getByText(`OT-banco-${sello}.pdf`).waitFor({ timeout: 60000 }).catch(() => {})
  comprobar(limpio(await pagina.locator('main').innerText()).includes(`OT-banco-${sello}.pdf`), 'Diseño ve el PDF de la orden')
  await pagina.screenshot({ path: `${CAPTURAS}/adm-orden-diseno.png`, fullPage: true })
  await contexto.close()
}

await navegador.close()
await base.end()
if (errores.length) console.log(`Errores de consola:\n${errores.join('\n')}`)
if (fallas.length || errores.length) {
  console.error(`\n${fallas.length} fallas, ${errores.length} errores de consola.`)
  process.exit(1)
}
console.log('\nTodo en orden.')
