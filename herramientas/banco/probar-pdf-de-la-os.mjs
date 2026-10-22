/**
 * Clic real sobre el PDF de la orden de servicio (P1-4 de la revisión de
 * formatos; DKS: «Con su PDF»), con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Logística emite cuatro OS para el mismo código: Gerencia rechaza una,
 *      aprueba dos y deja una por aprobar; Logística anula una de las
 *      aprobadas con su motivo.
 *   2. En «Órdenes de servicio», Logística ve «PDF» solo en la aprobada y en la
 *      anulada después de aprobarse; en el teléfono también.
 *   3. El clic descarga el archivo (no abre otra ventana): la aprobada trae el
 *      número, el contratista con su RUC, la OT, el código, el monto sin IGV,
 *      el IGV, el total, la detracción y quién la emitió y la aprobó; la
 *      anulada, además, la marca ANULADA, su motivo y quién la anuló.
 *   4. Por la dirección, la por aprobar y la rechazada responden 409 con el
 *      motivo en castellano.
 *   5. Almacén, que lee las OS (`compras.ver`) pero no las OT, descarga la
 *      aprobada con la OT igual: sale del listado de las OS.
 *   6. Un supervisor, sin permiso de OS, va a «sin permiso» y no recibe PDF.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo) y
 * los correos de cada cuenta si no son las `*.local@metalwork.test` que siembra
 * `preparar.sh`. Necesita `pdftotext` (poppler) para leer los PDF.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const cuenta = (puesto) => process.env[puesto.toUpperCase().replace('.', '_')] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(['logistica', 'gerencia', 'almacen', 'sup.mtz'].map((p) => [p, cuenta(p)]))
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
const carpeta = join(CAPTURAS, 'pdf-de-la-os')
mkdirSync(carpeta, { recursive: true })

const base = new pg.Client({
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.BANCO_BASE ?? 'mw_demo',
})
await base.connect()
const consulta = async (sql, valores = []) => (await base.query(sql, valores)).rows

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const textoDelPdf = (ruta) => limpio(execFileSync('pdftotext', ['-layout', ruta, '-']).toString())

// ---------------------------------------------------------------- siembra
const SUFIJO = String(100000 + (Date.now() % 900000))
const CODIGO = `PRB_OS_PDF_${SUFIJO}`
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)

/** Lo que hace la sesión de esa cuenta: las funciones leen el usuario de aquí. */
async function como(puesto) {
  const sub = ids[CUENTAS[puesto]]
  await consulta(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                         set_config('request.jwt.claims', $2, false)`, [sub, JSON.stringify({ sub, role: 'authenticated' })])
}

let ruc
while (!ruc) {
  const prefijo = `20${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
  ;[ruc] = await consulta(
    `select n from (select $1 || d as n from generate_series(0, 9) d) x
      where public.ruc_es_valido(n) and not exists (select 1 from proveedores p where p.numero_documento = n) limit 1`,
    [prefijo],
  )
}
const CONTRATISTA = `CONTRATISTA PDF ${SUFIJO}`
const [{ id: proveedor }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. de prueba 123, Trujillo', '999 000 111') returning id`,
  [ruc.n, CONTRATISTA],
)
const [ot] = await consulta(`select id, numero from ordenes_trabajo where estado::text not in ('ANULADA', 'BORRADOR') order by creado_en desc limit 1`)
if (!ot) throw new Error('El banco no tiene una OT vigente para la OS.')
const [{ id: area }] = await consulta(`select id from areas where codigo = 'MTZ'`)

await como('logistica')
const os = {}
for (const clave of ['porAprobar', 'rechazada', 'aprobada', 'anulada']) {
  const [{ id }] = await consulta(
    `select public.emitir_orden_servicio(gen_random_uuid(), $1, $2, $3, $4, $5, 'COT-PDF-1', null, current_date + 7,
                                         'PEN', 2500, 'CREDITO', 30, '025', null) as id`,
    [proveedor, ot.id, area, CODIGO, `Arenado y pintura de la tolva, prueba del PDF (${clave})`],
  )
  const [{ numero }] = await consulta(`select numero from ordenes_servicio where id = $1`, [id])
  os[clave] = { id, numero }
}
await como('gerencia')
await consulta(`select public.rechazar_orden_servicio($1, 'El precio está muy alto para este servicio')`, [os.rechazada.id])
await consulta(`select public.aprobar_orden_servicio($1)`, [os.aprobada.id])
await consulta(`select public.aprobar_orden_servicio($1)`, [os.anulada.id])
await como('logistica')
const MOTIVO = 'El contratista no puede atender en el plazo'
await consulta(`select public.avanzar_orden_servicio($1, 'ANULADA', $2)`, [os.anulada.id, MOTIVO])
const nombre = async (puesto) =>
  (await consulta(`select upper(nombres || ' ' || apellidos) as n from usuarios where id = $1`, [ids[CUENTAS[puesto]]]))[0].n
const LOGISTICA = await nombre('logistica')
const GERENCIA = await nombre('gerencia')
console.log(`Sembradas ${Object.values(os).map((o) => o.numero).join(', ')} con el código ${CODIGO} y la OT ${ot.numero}`)

// ---------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, ancho = 1280) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: 900 }, acceptDownloads: true })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  // Se escucha después de abrir la primera: aquí caen solo las ventanas que abra un clic.
  const ventanas = []
  contexto.on('page', (p) => ventanas.push(p))
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto, errores, ventanas }
}
const fila = (pagina, numero) => pagina.locator(`tr[data-servicio="${numero}"]`)
const enlacePdf = (pagina, numero) => fila(pagina, numero).locator('a[download]', { hasText: 'PDF' })

/** Clic real en «PDF»: tiene que llegar una descarga, no otra ventana. */
async function descargar(sesion, numero) {
  const [descarga] = await Promise.all([sesion.pagina.waitForEvent('download', { timeout: 30000 }), enlacePdf(sesion.pagina, numero).click()])
  const ruta = join(carpeta, descarga.suggestedFilename())
  await descarga.saveAs(ruta)
  return { nombre: descarga.suggestedFilename(), texto: textoDelPdf(ruta) }
}

try {
  // ------------------------------------------- 2 y 3. Logística, en monitor
  const logistica = await entrar(CUENTAS.logistica)
  await logistica.pagina.goto(`${BASE}/compras/servicios?codigo=${CODIGO}`, { waitUntil: 'networkidle' })
  const filas = await logistica.pagina.locator('tbody tr[data-servicio]').count()
  comprobar(filas === 4, `la lista trae las cuatro OS del código (${filas})`)
  for (const [clave, esperado] of [['porAprobar', 0], ['rechazada', 0], ['aprobada', 1], ['anulada', 1]]) {
    const n = await enlacePdf(logistica.pagina, os[clave].numero).count()
    comprobar(n === esperado, `${os[clave].numero} (${clave}) ${esperado ? 'tiene' : 'no tiene'} «PDF» (${n})`)
  }
  await logistica.pagina.screenshot({ path: join(carpeta, 'logistica-lista.png'), fullPage: true })

  const aprobada = await descargar(logistica, os.aprobada.numero)
  comprobar(aprobada.nombre === `MW-Servicio-${os.aprobada.numero}.pdf`, `la aprobada se descarga como ${aprobada.nombre}`)
  for (const [que, t] of [
    ['el título', 'ORDEN DE SERVICIO'],
    ['el número', os.aprobada.numero],
    ['el contratista', CONTRATISTA],
    ['su RUC', ruc.n],
    ['la OT', ot.numero],
    ['el código interno', CODIGO],
    ['el monto sin IGV', '2,500.00'],
    ['el IGV', 'S/ 450.00'],
    ['el total', 'S/ 2,950.00'],
    ['la condición de pago', 'CRÉDITO A 30 DÍAS'],
    ['la detracción', 'SUJETO A DETRACCIÓN'],
    ['quién la emitió', LOGISTICA],
    ['quién la aprobó', GERENCIA],
  ]) {
    comprobar(aprobada.texto.includes(t), `el PDF de la aprobada trae ${que} («${t}»)`)
  }
  comprobar(!aprobada.texto.includes('ANULADA'), 'la aprobada no lleva la marca ANULADA')

  const anulada = await descargar(logistica, os.anulada.numero)
  comprobar(anulada.nombre === `MW-Servicio-${os.anulada.numero}-ANULADA.pdf`, `la anulada se descarga como ${anulada.nombre}`)
  comprobar(anulada.texto.includes('ORDEN DE SERVICIO ANULADA'), 'el PDF de la anulada lleva la marca ANULADA')
  comprobar(anulada.texto.includes(MOTIVO), 'y su motivo')
  comprobar(anulada.texto.includes(`Anulada por ${LOGISTICA}`), 'y quién la anuló')
  comprobar(logistica.ventanas.length === 0, `el clic no abrió otra ventana (${logistica.ventanas.length} nuevas)`)

  // ------------------------------------------- 4. por la dirección, 409
  for (const [clave, motivo] of [['porAprobar', 'espera la aprobación de Gerencia'], ['rechazada', 'Gerencia la rechazó']]) {
    const r = await logistica.pagina.request.get(`${BASE}/compras/servicios/${os[clave].id}/pdf`)
    const cuerpo = await r.json().catch(() => ({}))
    comprobar(r.status() === 409 && (cuerpo.error ?? '').includes(motivo), `${clave}: ${r.status()} «${cuerpo.error ?? ''}»`)
  }
  const torcida = await logistica.pagina.request.get(`${BASE}/compras/servicios/no-es-un-id/pdf`)
  comprobar(torcida.status() === 404, `una dirección con un id que no es uuid responde 404 (${torcida.status()})`)
  comprobar(logistica.errores.length === 0, `sin errores de consola para Logística (${logistica.errores.join(' | ')})`)
  await logistica.contexto.close()

  // ------------------------------------------- 2. en el teléfono
  const telefono = await entrar(CUENTAS.logistica, 390)
  await telefono.pagina.goto(`${BASE}/compras/servicios?codigo=${CODIGO}`, { waitUntil: 'networkidle' })
  comprobar(await enlacePdf(telefono.pagina, os.aprobada.numero).isVisible(), 'en el teléfono «PDF» se ve en la fila de la aprobada')
  const ancho = await telefono.pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `la pantalla no se corre de costado en el teléfono (${ancho} px)`)
  await telefono.pagina.screenshot({ path: join(carpeta, 'logistica-telefono.png'), fullPage: true })
  await telefono.contexto.close()

  // ------------------------------------------- 5. Almacén: la OT sale del listado
  const almacen = await entrar(CUENTAS.almacen)
  const ve = await almacen.pagina.request.get(`${BASE}/compras/servicios/${os.aprobada.id}/pdf`)
  comprobar(ve.status() === 200 && ve.headers()['content-type'] === 'application/pdf', `Almacén descarga la aprobada (${ve.status()} ${ve.headers()['content-type']})`)
  if (ve.status() === 200) {
    const ruta = join(carpeta, 'almacen.pdf')
    writeFileSync(ruta, await ve.body())
    comprobar(textoDelPdf(ruta).includes(ot.numero), `y su PDF trae la OT ${ot.numero} aunque Almacén no lea las OT`)
  }
  await almacen.contexto.close()

  // ------------------------------------------- 6. Un supervisor no recibe PDF
  const supervisor = await entrar(CUENTAS['sup.mtz'])
  const no = await supervisor.pagina.request.get(`${BASE}/compras/servicios/${os.aprobada.id}/pdf`)
  comprobar(no.headers()['content-type'] !== 'application/pdf' && no.url().includes('/sin-permiso'), `el supervisor va a «sin permiso» (${no.status()} ${no.url()})`)
  await supervisor.contexto.close()
} finally {
  await navegador.close()
  await base.end()
}

console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
