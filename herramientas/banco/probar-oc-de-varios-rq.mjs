/**
 * Recorre con clic real la OC que junta insumos de varios RQ y la OC que va en
 * varias facturas (migraciones 20261016700000 a 20261016702000), con la cuenta
 * de cada puesto (nunca ADMIN):
 *
 *   1. Logística abre «Por comprar», marca las planchas de dos RQ de códigos
 *      distintos, emite una sola OC y le anexa la factura de la primera entrega:
 *      sin número no la deja; el detector llena el número y la fecha del PDF.
 *   1b. La administradora ve solo su RQA en «Por comprar» y emite su OC.
 *   2. Gerencia la ve con sus dos RQ y sus dos códigos, y la aprueba. La lista
 *      de OC dice los dos códigos y la factura
 *      anexada; su PDF sale. Logística le anexa la factura de la segunda entrega
 *      desde la lista, con su número y su fecha.
 *   3. Contabilidad elige la primera factura de Logística: se llenan su número,
 *      su fecha y su OC. La marca como parcial y la registra; la OC sigue
 *      esperando el resto. Registra la segunda, que la completa.
 *   4. Tesorería ve los documentos de Logística registrados y, en Cuentas por
 *      pagar, las dos facturas, que juntas completan la OC.
 *   5. El costeo de cada código lleva su parte de la orden.
 *
 * Arma sus propios datos ficticios (QA-VRQ-…) y las cuentas `*.vrq@banco.test`
 * con la clave local. Variables: BANCO_CLAVE, BASE (http://localhost:3111),
 * BANCO_BASE (mw_demo), CAPTURAS.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
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
async function recargar(pagina) {
  await pagina.reload({ waitUntil: 'load' })
  await quieta(pagina)
}

/** Un PDF de una página con estas líneas de texto, para que el detector lo lea. */
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
  requerimientos: ['REQUERIMIENTOS', 'REQ'],
  administracion: ['ADMINISTRACION', 'ADM'],
  almacen: ['ALMACENERO', 'ALM'],
  logistica: ['COMPRADOR', 'LOG'],
  gerencia: ['GERENTE', 'GGE'],
  contabilidad: ['CONTABILIDAD', 'CON'],
  tesoreria: ['TESORERIA', 'TES'],
}
const ids = {}
for (const [clave, [rol, area]] of Object.entries(CUENTAS)) {
  const correo = `${clave}.vrq@banco.test`
  let fila = await uno('select id from public.usuarios where correo = $1', [correo])
  if (!fila) {
    fila = await uno(
      `insert into auth.users (id, email, encrypted_password) values (gen_random_uuid(), $1, crypt($2, gen_salt('bf'))) returning id`,
      [correo, CLAVE],
    )
    await consulta(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
       select $1, $2, 'Banco varios RQ', $3, r.id, (select id from public.areas where codigo = $4) from public.roles r where r.codigo = $2`,
      [fila.id, rol, correo, area],
    )
  } else {
    await consulta(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where email = $1`, [correo, CLAVE])
  }
  ids[clave] = fila.id
}
await consulta(`insert into public.empresa (ruc, razon_social) select '20100000382', 'PRUEBAS VARIOS RQ S.A.C.' where not exists (select 1 from public.empresa)`)
// Gerencia aprueba todas las compras, desde S/ 0 (decisión del 12/10).
await consulta(`update public.regla_aprobacion_compras set activa = true, monto_desde = 0,
                       rol_aprobador_id = (select id from public.roles where codigo = 'GERENTE') where unica`)

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

const und = (await uno(`select id from public.unidades_medida where codigo = 'UND'`)).id
const cat = (await uno(`select id from public.categorias_material where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1`)).id
const plancha = `Plancha LAF 2 mm QA ${sello}`
const disco = `Disco de corte QA ${sello}`
const mat = {}
for (const [clave, nombre] of [['plancha', plancha], ['disco', disco]]) {
  mat[clave] = (await uno(
    `insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id, unidad_pendiente, activo)
     values ($1, $2, $3, $4, false, true) returning id`,
    [`QA-VRQ-${sello}-${clave}`, nombre, cat, und],
  )).id
}
// Dos RQ de dos áreas y dos códigos: los dos piden planchas; el segundo, también discos.
const codigoA = `QA_VRQ_A_${sello}`
const codigoB = `QA_VRQ_B_${sello}`
const rqIds = []
for (const [area, codigo, lineas] of [
  ['MTZ', codigoA, [{ material_id: mat.plancha, cantidad: 4 }]],
  ['PRD', codigoB, [{ material_id: mat.plancha, cantidad: 6 }, { material_id: mat.disco, cantidad: 10 }]],
]) {
  const id = (await uno('select gen_random_uuid() as id')).id
  const areaId = (await uno('select id from public.areas where codigo = $1', [area])).id
  await como('requerimientos', `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Trabajo de prueba del banco', null, $4::jsonb)`, [
    id,
    areaId,
    codigo,
    JSON.stringify(lineas),
  ])
  rqIds.push(id)
}
const [rqA, rqB] = await Promise.all(rqIds.map(async (id) => (await uno('select numero from public.requerimientos where id = $1', [id])).numero))
// Y uno de Administración (RQA), que compra la administradora, no Logística.
const rqaId = (await uno('select gen_random_uuid() as id')).id
await como('administracion', `select public.emitir_requerimiento($1, 'ADMINISTRACION', (select id from public.areas where codigo = 'RRH'), 'PLANTA', 'Planchas para la oficina del banco', null, $2::jsonb)`, [
  rqaId,
  JSON.stringify([{ material_id: mat.plancha, cantidad: 1 }]),
])
const rqa = (await uno('select numero from public.requerimientos where id = $1', [rqaId])).numero
// Almacén revisa por insumo: no tiene planchas; de los discos, tiene todos.
await como('almacen', `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 0}]', null)`, [rqIds[0]])
await como('almacen', `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 0}, {"item": 2, "en_stock": 10}]', null)`, [rqIds[1]])
await como('almacen', `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 0}]', null)`, [rqaId])

const ruc = (await uno(`select n::text as ruc from generate_series(20100038300::bigint, 20100038399::bigint) n where public.ruc_es_valido(n::text) limit 1`)).ruc
const proveedor = `ACEROS VARIOS RQ QA ${sello}`
await consulta(
  `insert into public.proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. Argentina 457, Lima', '999 333 447')
   on conflict (tipo_documento, numero_documento) do update set razon_social = excluded.razon_social, activo = true`,
  [ruc, proveedor],
)

// 10 planchas a S/ 50 = 500 sin IGV; con IGV, 590. Dos entregas, dos facturas: 236 (4 planchas) y 354 (6).
const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
const [anio, mes, dia] = hoy.split('-')
const serie = `F${sello.slice(-3)}`
const factura1 = pdfConTexto([proveedor, `FACTURA ELECTRONICA ${serie}-00000071`, `Fecha de emision: ${dia}/${mes}/${anio}`, 'Importe Total : S/ 236.00'])
const factura2 = pdfConTexto([proveedor, `FACTURA ELECTRONICA ${serie}-00000072`, `Fecha de emision: ${dia}/${mes}/${anio}`, 'Importe Total : S/ 354.00'])
writeFileSync(join(CAPTURAS, 'vrq-factura-1.pdf'), factura1)
writeFileSync(join(CAPTURAS, 'vrq-factura-2.pdf'), factura2)

// ------------------------------------------------------------------ navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(clave) {
  const errores = []
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  pagina.on('pageerror', (e) => errores.push(String(e).slice(0, 300)))
  await ir(pagina, `${BASE}/ingresar`)
  await pagina.fill('input[type="email"]', `${clave}.vrq@banco.test`)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 60000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${clave}`)
  return { pagina, contexto, errores }
}

/** Espera a que el detector termine de leer el PDF. */
async function esperarLectura(lugar) {
  // Con el servidor cargado, la lectura puede no haber empezado todavía: se
  // espera a que aparezca (si llega) antes de esperar a que se vaya.
  await lugar.getByText('Leyendo la factura…').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  await lugar.getByText('Leyendo la factura…').waitFor({ state: 'hidden', timeout: 60000 }).catch(() => {})
  await lugar.page().waitForTimeout(500)
}

// ------------------------------------------------ 1. Logística junta los insumos de dos RQ en una OC
let ocId
let ocNumero
{
  const { pagina, contexto, errores } = await entrar('logistica')
  await ir(pagina, `${BASE}/requerimientos/atencion?vista=comprar&rq=${rqIds[0]}`)
  const filas = limpio(await pagina.locator('tbody').innerText())
  comprobar(filas.includes(rqA) && filas.includes(rqB), `«Por comprar» lista los insumos de ${rqA} y ${rqB}`)
  comprobar(!filas.includes(rqa), `y no el ${rqa}, que compra la administradora`)
  comprobar(!filas.includes(disco), 'los discos que Almacén tiene completos no salen por comprar')
  comprobar(
    await pagina.getByRole('checkbox', { name: `Marcar ${plancha} del ${rqA}` }).isChecked(),
    `viene marcado lo de ${rqA}, desde el que se llegó`,
  )
  await pagina.getByRole('checkbox', { name: `Marcar todo lo que falta de ${plancha}` }).check()
  const boton = pagina.getByRole('button', { name: /Generar OC · 2 insumos de 2 RQ/ })
  comprobar((await boton.count()) === 1, 'el botón dice «Generar OC · 2 insumos de 2 RQ»')
  await boton.click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.waitFor()
  const cabecera = limpio(await ventana.innerText())
  comprobar(cabecera.includes(`Atiende 2 requerimientos`) && cabecera.includes(codigoA) && cabecera.includes(codigoB), 'la orden dice los dos RQ con su código')
  comprobar((await ventana.locator('[id^="ocd-cant-"]').count()) === 1, 'una sola línea: las planchas de los dos RQ juntas')
  comprobar((await ventana.locator('[id^="ocd-cant-"]').first().inputValue()) === '10', 'con lo que falta de los dos: 10')
  await ventana.locator('#ocd-proveedor').click()
  await pagina.keyboard.type(ruc)
  await pagina.getByRole('option', { name: new RegExp(proveedor) }).first().click()
  await ventana.locator('[id^="ocd-precio-"]').first().fill('50')
  await ventana.locator('#ocd-factura').setInputFiles(join(CAPTURAS, 'vrq-factura-1.pdf'))
  await esperarLectura(ventana)
  const numeroLeido = await ventana.locator('#ocd-factura-numero').inputValue()
  const fechaLeida = await ventana.locator('#ocd-factura-fecha').inputValue()
  comprobar(numeroLeido === `${serie}-71` && fechaLeida === hoy, `el detector llenó el número (${numeroLeido}) y la fecha (${fechaLeida}) de la factura`)
  // Sin número no sale: el navegador no envía y nada se emite.
  await ventana.locator('#ocd-factura-numero').fill('')
  await ventana.getByRole('button', { name: 'Emitir orden de compra' }).click()
  await pagina.waitForTimeout(1500)
  const antes = await uno('select count(*)::int as n from public.ordenes_compra_materiales where proveedor = $1', [proveedor])

  comprobar(antes.n === 0 && (await ventana.isVisible()), 'sin el número de la factura la orden no sale')
  await ventana.locator('#ocd-factura-numero').fill(`${serie}-00000071`)
  await ventana.getByRole('button', { name: 'Emitir orden de compra' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 60000 }).catch(() => {})
  await pagina.locator('[role="status"]').first().waitFor({ timeout: 20000 }).catch(() => {})
  const aviso = limpio(await pagina.locator('[role="status"]').first().innerText().catch(() => ''))
  comprobar(/OC-\d+-MW/.test(aviso) && aviso.includes('Factura adjunta'), `emitió una OC con su factura: «${aviso}»`)

  const oc = await uno('select id, numero, codigo_interno, motivo, aprobacion from public.ordenes_compra_materiales where proveedor = $1 order by creado_en limit 1', [proveedor])
  ocId = oc?.id
  ocNumero = oc?.numero
  comprobar(Boolean(oc) && oc.codigo_interno === null, 'una sola OC, sin código propio: cada insumo lleva el suyo')
  comprobar(Boolean(oc?.motivo?.includes(rqA) && oc?.motivo?.includes(rqB)), `su motivo nombra ${rqA} y ${rqB}`)
  const enlazados = await uno('select count(*)::int as n from public.requerimiento_lineas where orden_compra_id = $1 and orden_compra_detalle_id is not null', [ocId])
  comprobar(enlazados?.n === 2, 'los dos insumos quedan anexados a la línea de la OC')
  const doc = await uno(`select numero_documento, fecha_emision::text as fecha_emision from public.documentos_compra_material where orden_compra_id = $1 and tipo = 'FACTURA'`, [ocId])
  comprobar(doc?.numero_documento === `${serie}-71` && doc?.fecha_emision === hoy, `la factura quedó con su número sin ceros (${doc?.numero_documento}) y su fecha`)
  await pagina.waitForTimeout(800)
  const despues = limpio(await pagina.locator('main').innerText())
  comprobar(!despues.includes(plancha), 'lo que ya va en la orden sale de «Por comprar»')
  await pagina.screenshot({ path: `${CAPTURAS}/vrq-1-por-comprar.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola como Logística ${errores.join(' | ')}`)
  await contexto.close()
}
if (!ocId) throw new Error('No salió la OC: no se puede seguir.')

// ------------------------------------------------ 1b. La administradora compra lo de su RQA
{
  const { pagina, contexto, errores } = await entrar('administracion')
  await ir(pagina, `${BASE}/requerimientos/atencion?vista=comprar`)
  const texto = limpio(await pagina.locator('main').innerText())
  comprobar(texto.includes('Por comprar · requerimientos de Administración') && texto.includes(rqa), `la administradora ve su ${rqa} por comprar`)
  comprobar(!texto.includes('Por comprar · requerimientos de operación') && !texto.includes(rqA), 'y no los RQ de operación')
  await pagina.getByRole('checkbox', { name: `Marcar ${plancha} del ${rqa}` }).check()
  await pagina.getByRole('button', { name: /Generar OC · 1 insumo/ }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.waitFor()
  await ventana.locator('#ocd-proveedor').click()
  await pagina.keyboard.type(ruc)
  await pagina.getByRole('option', { name: new RegExp(proveedor) }).first().click()
  await ventana.locator('[id^="ocd-precio-"]').first().fill('55')
  await ventana.getByRole('button', { name: 'Emitir orden de compra' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 60000 }).catch(() => {})
  const linea = await uno('select l.orden_compra_id, c.codigo_interno from public.requerimiento_lineas l join public.ordenes_compra_materiales c on c.id = l.orden_compra_id where l.requerimiento_id = $1', [rqaId])
  comprobar(linea?.codigo_interno === 'PLANTA', 'su OC sale con el código de su RQA')
  comprobar(errores.length === 0, `sin errores de consola como la administradora ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 2. Gerencia aprueba; Logística anexa la segunda factura
{
  const { pagina, contexto, errores } = await entrar('gerencia')
  await ir(pagina, `${BASE}/compras/aprobacion`)
  // La tarjeta de la OC: lo más chico que tiene su título y su botón «Aprobar».
  const tarjeta = pagina
    .locator('div')
    .filter({ has: pagina.getByText(`${ocNumero} · ${proveedor}`, { exact: true }) })
    .filter({ has: pagina.getByRole('button', { name: 'Aprobar' }) })
    .last()
  const t = limpio(await tarjeta.innerText().catch(() => ''))
  comprobar(t.includes('De RQ') && !t.includes('Para el almacén'), 'Gerencia la ve como compra de RQ, no para el almacén')
  comprobar(t.includes(codigoA) && t.includes(codigoB) && t.includes(rqA) && t.includes(rqB), 'con los dos códigos y los dos RQ')
  await tarjeta.getByRole('button', { name: 'Aprobar' }).click()
  await pagina.waitForTimeout(2000)
  const aprobada = await uno('select aprobacion from public.ordenes_compra_materiales where id = $1', [ocId])
  comprobar(aprobada?.aprobacion === 'APROBADA', 'Gerencia la aprobó con un clic')
  comprobar(errores.length === 0, `sin errores de consola como Gerencia ${errores.join(' | ')}`)
  await contexto.close()
}
{
  const { pagina, contexto, errores } = await entrar('logistica')
  await ir(pagina, `${BASE}/compras/ordenes`)
  const fila = pagina.locator('tbody tr', { hasText: ocNumero })
  const t = limpio(await fila.innerText())
  comprobar(t.includes(codigoA) && t.includes(codigoB), `la ${ocNumero} dice los dos códigos`)
  comprobar(t.includes(`${serie}-71`), 'y la factura anexada con su número')
  const pdf = await pagina.request.get(`${BASE}/compras/${ocId}/pdf`)
  comprobar(pdf.status() === 200 && (pdf.headers()['content-type'] ?? '').includes('pdf'), 'el PDF de la OC sale')
  await fila.getByRole('button', { name: 'Adjuntar' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.waitFor()
  await ventana.locator('input[type="file"]').setInputFiles(join(CAPTURAS, 'vrq-factura-2.pdf'))
  await esperarLectura(ventana)
  const leido = await ventana.locator('[id^="factura-compra-"][id$="-numero"]').inputValue()
  comprobar(leido === `${serie}-72`, `el detector llenó el número de la segunda factura (${leido})`)
  const avisoParcial = limpio(await ventana.innerText())
  comprobar(avisoParcial.includes('Contabilidad la registra como parcial'), 'el aviso dice que una factura de una parte se adjunta igual')
  await ventana.getByRole('button', { name: 'Adjuntar' }).click()
  await ventana.locator('[role="status"]', { hasText: 'adjuntada' }).waitFor({ timeout: 30000 }).catch(() => {})
  const r = limpio(await ventana.locator('[role="status"]').last().innerText().catch(() => ''))
  comprobar(r.includes(`Factura ${serie}-72 adjuntada`), `la segunda factura entró: «${r}»`)
  await pagina.keyboard.press('Escape')
  await recargar(pagina)
  const t2 = limpio(await pagina.locator('tbody tr', { hasText: ocNumero }).innerText())
  comprobar(t2.includes(`${serie}-71`) && t2.includes(`${serie}-72`), 'la lista dice las dos facturas de la OC')
  await pagina.screenshot({ path: `${CAPTURAS}/vrq-2-ordenes.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola como Logística ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 3. Contabilidad registra las dos facturas
{
  const { pagina, contexto, errores } = await entrar('contabilidad')
  await ir(pagina, `${BASE}/adquisiciones`)
  const espera = limpio(await pagina.locator('tbody tr', { hasText: ocNumero }).innerText())
  comprobar(espera.includes(`Logística anexó ${serie}-71`) && espera.includes(`${serie}-72`), 'la OC que espera dice las dos facturas que anexó Logística')
  comprobar(espera.includes(codigoA) && espera.includes(codigoB), 'con los dos códigos internos')

  const opciones = await pagina.locator('#adq-documento option').allTextContents()
  comprobar(opciones.some((o) => o.includes(`${serie}-71`) && o.includes(ocNumero)), 'el formulario ofrece la factura de Logística con su número y su OC')
  const valor = await pagina.locator('#adq-documento option', { hasText: `${serie}-71` }).getAttribute('value')
  await pagina.locator('#adq-documento').selectOption(valor)
  await pagina.waitForTimeout(800)
  comprobar((await pagina.locator('#adq-numero').inputValue()) === `${serie}-71`, 'se llenó el número')
  comprobar((await pagina.locator('#adq-emision').inputValue()) === hoy, 'se llenó la fecha')
  const oc = pagina.locator('li', { hasText: ocNumero })
  comprobar(await oc.locator('input[name="ordenes_compra"]').isChecked(), 'y se marcó su OC')
  await esperarLectura(pagina.locator('form:has(#adq-total)'))
  await pagina.locator('#adq-total').fill('236')
  await pagina.locator('#adq-vencimiento').fill(hoy)
  const sinParcial = limpio(await pagina.locator('form:has(#adq-total)').innerText())
  comprobar(sinParcial.includes('márcala como parcial'), 'sin marcarla, avisa que faltan y que puede ser parcial')
  await oc.getByRole('checkbox', { name: /cubre solo una parte/ }).check()
  const conParcial = limpio(await pagina.locator('form:has(#adq-total)').innerText())
  comprobar(conParcial.includes('Factura parcial') && conParcial.includes('Quedan S/ 354.00'), 'marcada como parcial: quedan 354 para otra factura')
  await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
  await pagina.locator('[role="status"]', { hasText: 'registrado' }).first().waitFor({ timeout: 30000 }).catch(() => {})
  const r1 = limpio(await pagina.locator('[role="status"]', { hasText: 'registrado' }).first().innerText().catch(() => ''))
  comprobar(r1.includes('factura parcial'), `registró la primera como parcial: «${r1}»`)
  await recargar(pagina)
  const grupo1 = limpio(await pagina.locator('tbody', { hasText: `${serie}-71` }).first().innerText())
  comprobar(grupo1.includes('Factura parcial') && grupo1.includes('quedan S/ 354.00'), 'la tabla la dice «Factura parcial» y lo que queda')
  const espera2 = limpio(await pagina.locator('tbody tr', { hasText: 'Facturada en parte' }).filter({ hasText: ocNumero }).innerText().catch(() => ''))
  comprobar(espera2.includes('Falta S/ 354.00'), 'la OC sigue esperando su factura, con lo que falta')

  const valor2 = await pagina.locator('#adq-documento option', { hasText: `${serie}-72` }).getAttribute('value')
  comprobar((await pagina.locator('#adq-documento option', { hasText: `${serie}-71` }).count()) === 0, 'la factura ya registrada no se vuelve a ofrecer')
  await pagina.locator('#adq-documento').selectOption(valor2)
  await pagina.waitForTimeout(800)
  await esperarLectura(pagina.locator('form:has(#adq-total)'))
  await pagina.locator('#adq-total').fill('354')
  await pagina.locator('#adq-vencimiento').fill(hoy)
  const calza = limpio(await pagina.locator('form:has(#adq-total)').innerText())
  comprobar(calza.includes('Calza con lo que falta facturar') && calza.includes('S/ 354.00'), 'la segunda calza con lo que falta facturar')
  await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
  await pagina.locator('[role="status"]', { hasText: 'registrado' }).first().waitFor({ timeout: 30000 }).catch(() => {})
  await recargar(pagina)
  const grupo2 = limpio(await pagina.locator('tbody', { hasText: `${serie}-72` }).first().innerText())
  comprobar(grupo2.includes('Calza con sus OC') && grupo2.includes(`junto con ${serie}-71`), 'la segunda completa la OC junto con la primera')
  comprobar((await pagina.locator('tbody tr', { hasText: 'Facturada en parte' }).filter({ hasText: ocNumero }).count()) === 0, 'la OC ya no espera factura')
  await pagina.screenshot({ path: `${CAPTURAS}/vrq-3-adquisiciones.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola como Contabilidad ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 4. Tesorería
{
  const { pagina, contexto, errores } = await entrar('tesoreria')
  await ir(pagina, `${BASE}/adquisiciones`)
  // La tarjeta entera: el ancestro más cercano del título que ya trae los
  // documentos. Desde que el título lleva su botón «i» queda un nivel más hondo
  // y el «tercer ancestro» era solo la cabecera, sin ningún documento.
  const docs = limpio(
    await pagina.getByText('Documentos de compras de Logística').locator('xpath=ancestor::*[.//article][1]').innerText().catch(() => ''),
  )
  comprobar(docs.includes(`${serie}-71`) && docs.includes('Registrada por Contabilidad'), 'Tesorería ve las facturas de Logística con su número, ya registradas')
  await ir(pagina, `${BASE}/tesoreria/por-pagar`)
  const porPagar = limpio(await pagina.locator('main').innerText())
  // Con la OC ya completa, cada una calza con lo que le tocaba y dice con cuál la completa.
  comprobar(
    porPagar.includes(`junto con ${serie}-71`) && porPagar.includes(`junto con ${serie}-72`),
    'en Cuentas por pagar están las dos, y cada una completa la OC junto con la otra',
  )
  comprobar(errores.length === 0, `sin errores de consola como Tesorería ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 5. El costeo de cada código
// La función interna del costeo, que Gerencia ve en Códigos internos.
const costo = async (codigo) =>
  Number((await uno(`select coalesce(sum(monto), 0) as m from public.codigo_interno_lineas($1, false) where fuente = 'COMPRAS' and referencia_id = $2`, [codigo, ocId])).m)
const [a, b] = [await costo(codigoA), await costo(codigoB)]
comprobar(a === 200 && b === 300, `el costeo reparte la orden: ${codigoA} ${a} (4 planchas) y ${codigoB} ${b} (6)`)

await navegador.close()
await base.end()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} comprobación(es) fallaron.`)
  process.exit(1)
}
console.log('\nTodo bien: una OC de dos RQ y sus dos facturas, con clic real.')
