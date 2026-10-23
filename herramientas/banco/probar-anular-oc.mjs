/**
 * Clic real sobre la anulación de una OC aprobada (DKS: «Sí, con motivo», 21/10),
 * con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Logística emite tres compras directas; Gerencia las aprueba y el
 *      conductor recoge la tercera.
 *   2. En «Aprobación de compras», Gerencia ve las dos primeras en «Aprobadas que
 *      se pueden anular» y la tercera aparte, con lo que lo impide.
 *   3. Anula la primera: con un motivo corto la ventana lo dice y no anula; con
 *      el motivo, la OC queda anulada en la base y sale de la lista.
 *   4. En «Órdenes de compra», Logística ve «Anulada: <motivo>», sin «Corregir»,
 *      y su PDF descarga con la marca ANULADA y el motivo.
 *   5. Logística no ve la sección de anular; en el teléfono la de Gerencia no se
 *      corre de costado.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo) y
 * los correos de cada cuenta si no son las `*.local@metalwork.test` que siembra
 * `preparar.sh`. Necesita `pdftotext` (poppler) para leer el PDF.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(['logistica', 'gerencia', 'conductor'].map((p) => [p, cuenta(p)]))
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
const carpeta = join(CAPTURAS, 'anular-oc')
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

// ---------------------------------------------------------------- siembra
const SUFIJO = String(100000 + (Date.now() % 900000))
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)

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
const PROVEEDOR = `PROVEEDOR ANULAR ${SUFIJO}`
const [{ id: proveedor }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. de prueba 456, Trujillo', '999 000 222') returning id`,
  [ruc.n, PROVEEDOR],
)
const [material] = await consulta(`select id from materiales where activo and not coalesce(unidad_pendiente, false) order by codigo limit 1`)
if (!material) throw new Error('El banco no tiene materiales.')

await como('logistica')
const oc = []
for (let i = 1; i <= 3; i++) {
  const [{ id }] = await consulta(
    `select public.emitir_compra_directa(gen_random_uuid(), $1, $2, 'Reposición del almacén, prueba de la anulación', $3::jsonb,
                                         current_date + 5, 'CONTADO', 0, 'PEN', false, 'PLANTA') as id`,
    [proveedor, `COT-ANU-${SUFIJO}-${i}`, JSON.stringify([{ material_id: material.id, cantidad: 2, precio: 150 }])],
  )
  const [{ numero }] = await consulta(`select numero from ordenes_compra_materiales where id = $1`, [id])
  oc.push({ id, numero })
}
await como('gerencia')
for (const o of oc) await consulta(`select public.aprobar_compra($1)`, [o.id])
await como('logistica')
await consulta(`select public.programar_recojo($1, 20, null)`, [oc[2].id])
await como('conductor')
await consulta(`select public.marcar_compra_en_recojo($1)`, [oc[2].id])
await consulta(`select public.marcar_compra_recogida($1)`, [oc[2].id])
console.log(`Sembradas ${oc.map((o) => o.numero).join(', ')} de ${PROVEEDOR}`)

// ---------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, ancho = 1280) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: 900 }, acceptDownloads: true })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto, errores }
}
const anulable = (pagina, numero) => pagina.locator(`tr[data-anulable="${numero}"]`)
const MOTIVO = `El proveedor ya no tiene el material, se compra a otro (${SUFIJO})`

try {
  // ------------------------------------------- 2. Gerencia ve qué se puede anular
  const gerencia = await entrar(CUENTAS.gerencia)
  await gerencia.pagina.goto(`${BASE}/compras/aprobacion`, { waitUntil: 'networkidle' })
  comprobar((await anulable(gerencia.pagina, oc[0].numero).count()) === 1, `${oc[0].numero} está en «Aprobadas que se pueden anular»`)
  comprobar((await anulable(gerencia.pagina, oc[1].numero).count()) === 1, `${oc[1].numero} también`)
  comprobar((await anulable(gerencia.pagina, oc[2].numero).count()) === 0, `${oc[2].numero}, recogida, no tiene botón`)
  const detalle = gerencia.pagina.locator('details', { hasText: 'ya no se anul' })
  await detalle.locator('summary').click()
  const razon = limpio(await detalle.locator('li', { hasText: oc[2].numero }).innerText().catch(() => ''))
  comprobar(razon.includes('ya recogió'), `y aparte dice por qué: «${razon}»`)

  // ------------------------------------------- 3. Anular
  await anulable(gerencia.pagina, oc[0].numero).getByRole('button', { name: `Anular la ${oc[0].numero}` }).click()
  const ventana = gerencia.pagina.getByRole('dialog')
  await ventana.locator('textarea[name="motivo"]').fill('corto')
  // El navegador ataja el `minLength`: se salta para ver el mensaje del servidor.
  await ventana.locator('form').evaluate((f) => f.setAttribute('novalidate', ''))
  await ventana.getByRole('button', { name: 'Anular la compra' }).click()
  await ventana.locator('[role="alert"]').waitFor({ timeout: 15000 }).catch(() => {})
  const aviso = limpio(await ventana.locator('[role="alert"]').innerText().catch(() => ''))
  comprobar(aviso.includes('al menos 10 caracteres'), `con un motivo corto la ventana lo dice: «${aviso}»`)
  comprobar((await ventana.locator('textarea[name="motivo"]').inputValue()) === 'corto', 'y lo escrito se queda en el campo')
  let [fila] = await consulta(`select aprobacion from ordenes_compra_materiales where id = $1`, [oc[0].id])
  comprobar(fila.aprobacion === 'APROBADA', 'y la OC no se anuló')

  await ventana.locator('textarea[name="motivo"]').fill(MOTIVO)
  const boton = ventana.getByRole('button', { name: 'Anular la compra' })
  await boton.click()
  await boton.click({ timeout: 1000 }).catch(() => {})
  await ventana.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  ;[fila] = await consulta(
    `select aprobacion, motivo_anulacion, anulada_por, jsonb_array_length(lineas_anuladas) as lineas
       from ordenes_compra_materiales where id = $1`,
    [oc[0].id],
  )
  comprobar(fila.aprobacion === 'ANULADA' && fila.motivo_anulacion === MOTIVO && fila.anulada_por === ids[CUENTAS.gerencia] && fila.lineas === 1,
    `la OC quedó anulada por Gerencia con su motivo y su línea guardada (${JSON.stringify(fila)})`)
  const [{ n: avisos }] = await consulta(`select count(*)::int as n from notificaciones where origen_id = $1 and titulo like 'Compra anulada:%'`, [oc[0].id])
  comprobar(avisos === 1, `a Logística le llegó un solo aviso de la anulación (${avisos})`)
  // La ventana se cierra con el resultado de la acción; la pantalla repintada
  // llega después. `waitForLoadState('networkidle')` no la esperaba: la página
  // ya había llegado a ese estado al abrirse y vuelve en el acto.
  await anulable(gerencia.pagina, oc[0].numero).waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  comprobar((await anulable(gerencia.pagina, oc[0].numero).count()) === 0, 'la anulada sale de la lista de las que se pueden anular')
  await gerencia.pagina.locator('tr', { hasText: oc[0].numero }).filter({ hasText: 'Anulada' }).first().waitFor({ timeout: 20000 }).catch(() => {})
  const decidida = limpio(await gerencia.pagina.locator('tr', { hasText: oc[0].numero }).last().innerText().catch(() => ''))
  comprobar(decidida.includes('Anulada') && decidida.includes(MOTIVO), `y aparece entre las decididas como anulada: «${decidida.slice(0, 160)}»`)
  comprobar(gerencia.errores.length === 0, `sin errores de consola para Gerencia (${gerencia.errores.join(' | ')})`)
  await gerencia.pagina.screenshot({ path: join(carpeta, 'gerencia.png'), fullPage: true })
  await gerencia.contexto.close()

  // ------------------------------------------- 4. Logística ve la anulada
  const logistica = await entrar(CUENTAS.logistica)
  await logistica.pagina.goto(`${BASE}/compras/ordenes`, { waitUntil: 'networkidle' })
  const suya = logistica.pagina.locator(`tr[data-compra="${oc[0].numero}"]`)
  const texto = limpio(await suya.innerText().catch(() => ''))
  comprobar(texto.includes(`Anulada: ${MOTIVO}`), `en Órdenes de compra dice «Anulada: …» (${texto.slice(0, 160)})`)
  comprobar((await suya.getByRole('button', { name: /Corregir/ }).count()) === 0, 'sin el botón «Corregir»')
  const [descarga] = await Promise.all([
    logistica.pagina.waitForEvent('download', { timeout: 30000 }),
    suya.locator('a[download]', { hasText: 'PDF' }).click(),
  ])
  const ruta = join(carpeta, descarga.suggestedFilename())
  await descarga.saveAs(ruta)
  const pdf = limpio(execFileSync('pdftotext', ['-layout', ruta, '-']).toString())
  comprobar(pdf.includes('ANULADA') && pdf.includes(MOTIVO.slice(0, 40)), 'su PDF sale con la marca ANULADA y el motivo')
  comprobar(pdf.includes('150.00'), 'y con la línea que tenía')

  // ------------------------------------------- 5. Logística no anula
  await logistica.pagina.goto(`${BASE}/compras/aprobacion`, { waitUntil: 'networkidle' })
  comprobar((await logistica.pagina.getByText('Aprobadas que se pueden anular').count()) === 0, 'Logística no ve la sección para anular')
  comprobar(logistica.errores.length === 0, `sin errores de consola para Logística (${logistica.errores.join(' | ')})`)
  await logistica.contexto.close()

  const telefono = await entrar(CUENTAS.gerencia, 390)
  await telefono.pagina.goto(`${BASE}/compras/aprobacion`, { waitUntil: 'networkidle' })
  comprobar(await anulable(telefono.pagina, oc[1].numero).getByRole('button', { name: /Anular/ }).isVisible(), 'en el teléfono «Anular» se ve')
  const ancho = await telefono.pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `y la pantalla no se corre de costado (${ancho} px)`)
  await telefono.pagina.screenshot({ path: join(carpeta, 'gerencia-telefono.png'), fullPage: true })
  await telefono.contexto.close()
} finally {
  await navegador.close()
  await base.end()
}

console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
