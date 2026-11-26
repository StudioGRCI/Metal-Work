/**
 * Recorre con clic real el «Control de compras» de Almacén (migración
 * 20261126160000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Almacén lo tiene en su menú y ve las OC y OS del día con su destino y
 *      su monto; la tabla trae las mismas filas que la base.
 *   2. Anota la factura escrita en minúsculas y con ceros, y la guía: la fila
 *      dice el número como lo trae el proveedor y la base lo guarda una vez.
 *      Tres toques a «Guardar» dejan una sola anotación.
 *   3. Un comprobante sin serie se rechaza con su motivo en su campo, el cursor
 *      ahí y la ventana abierta con lo escrito. Una segunda pantalla abierta
 *      antes no pisa lo que anotó la primera: dice que recargue.
 *   4. «Pendientes» trae lo que falta de cualquier día; la descarga es un Excel.
 *   5. En el teléfono (390) y en el monitor (1440) entra sin desbordarse.
 *   6. Contabilidad y Tesorería lo leen sin el botón de anotar; Ventas no entra.
 *
 * Necesita en el banco al menos una OC u OS de hoy. Variables: BANCO_CLAVE,
 * BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { esperarReactAlNavegar } from './con-react.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
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

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
async function hasta(leer, cumple, ms = 15000) {
  const fin = Date.now() + ms
  let v = await leer()
  while (!cumple(v) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 250))
    v = await leer()
  }
  return v
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
async function entrar(correo, viewport = { width: 1440, height: 900 }) {
  const contexto = await navegador.newContext({
    viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, timezoneId: 'America/Lima', acceptDownloads: true,
  })
  const pagina = esperarReactAlNavegar(await contexto.newPage())
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
const VENTANA = '[role="dialog"]:not([data-nextjs-dialog])'

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
const delDia = await consulta(
  `select tipo, id, coalesce(numero, 'OC sin número') as nombre from public.control_de_compras_almacen($1::date, $1::date) order by tipo, numero`,
  [hoy],
)
comprobar(delDia.length > 0, `el banco tiene compras de hoy (${delDia.length})`)

try {
  // ============================================ 1. Almacén
  const { pagina, contexto, errores } = await entrar('almacen.local@metalwork.test')
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  comprobar(await pagina.locator('a[href="/almacen/compras"]').first().count() > 0, '1. «Control de compras» está en el menú de Almacén')
  await pagina.goto(`${BASE}/almacen/compras`, { waitUntil: 'networkidle' })
  comprobar(limpio(await pagina.locator('h1').first().textContent()) === 'Control de compras', '1. El título es «Control de compras»')
  const filas = pagina.locator('tbody tr[data-compra]')
  const nombres = await filas.evaluateAll((trs) => trs.map((t) => t.getAttribute('data-compra')))
  console.log('    filas:', nombres.join(', '))
  comprobar(nombres.length === delDia.length && delDia.every((d) => nombres.includes(d.nombre)),
    `1. La tabla trae las ${delDia.length} compras de hoy de la base`)
  await pagina.screenshot({ path: join(CAPTURAS, 'control-compras-1440.png'), fullPage: true })

  // ============================================ 2. Anotar la factura
  const oc = (await consulta(
    `select c.id, c.numero from public.control_de_compras_almacen($1::date, $1::date) c
      where c.tipo = 'OC' and c.recepcion_actualizada_en is null order by c.numero limit 1`, [hoy]))[0]
  comprobar(Boolean(oc), '2. Hay una OC de hoy sin nada anotado')
  if (oc) {
    const fila = pagina.locator(`tbody tr[data-compra="${oc.numero}"]`)
    // La otra pantalla, abierta antes de que esta anote.
    const otra = await entrar('almacen.local@metalwork.test')
    await otra.pagina.goto(`${BASE}/almacen/compras`, { waitUntil: 'networkidle' })
    await otra.pagina.locator(`tbody tr[data-compra="${oc.numero}"]`).getByRole('button', { name: new RegExp(`lo recibido de ${oc.numero}`) }).click()
    const otraVentana = otra.pagina.locator(VENTANA)
    await otraVentana.waitFor()

    await fila.getByRole('button', { name: new RegExp(`Anotar lo recibido de ${oc.numero}`) }).click()
    const ventana = pagina.locator(VENTANA)
    await ventana.waitFor()
    // 3. Primero lo que se rechaza.
    await ventana.locator('input[name="factura"]').fill('factura 12')
    await ventana.getByRole('button', { name: 'Guardar' }).click()
    const aviso = await hasta(async () => limpio(await ventana.locator('[role="alert"]').first().textContent().catch(() => '')), (t) => t.length > 0)
    comprobar(aviso.includes('serie de 4'), `3. El comprobante sin serie se rechaza con su motivo: «${aviso}»`)
    comprobar(await ventana.locator('input[name="factura"]').inputValue() === 'factura 12', '3. La ventana sigue con lo escrito')
    comprobar(await ventana.locator('input[name="factura"]').getAttribute('aria-invalid') === 'true', '3. El campo de la factura queda marcado')
    comprobar(await pagina.evaluate(() => document.activeElement?.getAttribute('name')) === 'factura', '3. El cursor vuelve a la factura')

    await ventana.locator('input[name="factura"]').fill('f001-0009472')
    await ventana.locator('input[name="guia"]').fill('t001-0456')
    await ventana.locator('textarea[name="observacion"]').fill('Llegó con la guía')
    const boton = ventana.getByRole('button', { name: 'Guardar' })
    await Promise.all([boton.click(), boton.click({ timeout: 2000 }).catch(() => {}), boton.click({ timeout: 2000 }).catch(() => {})])
    await ventana.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    const texto = await hasta(async () => limpio(await fila.textContent()), (t) => t.includes('F001-9472'))
    comprobar(texto.includes('F001-9472') && texto.includes('Guía T001-0456'), '2. La fila dice la factura y la guía como las trae el proveedor')
    const guardado = await consulta(`select factura_numero, guia_numero, observacion, factura_recibida_por from public.recepcion_documentos_compra where orden_compra_id = $1`, [oc.id])
    // La tabla tiene un `unique` por orden: lo que dice si entró una vez es la auditoría.
    const cambios = await consulta(`select count(*) filter (where accion = 'INSERT')::int as altas, count(*) filter (where accion = 'UPDATE')::int as cambios
      from public.audit_log where tabla = 'recepcion_documentos_compra' and registro_id = (select id from public.recepcion_documentos_compra where orden_compra_id = $1)`, [oc.id])
    comprobar(cambios[0]?.altas === 1 && cambios[0]?.cambios === 0, `2. Tres toques, una anotación en la auditoría: ${JSON.stringify(cambios[0])}`)
    comprobar(guardado.length === 1 && guardado[0].factura_numero === 'F001-9472' && guardado[0].guia_numero === 'T001-0456',
      `2. La base la guardó una vez: ${JSON.stringify(guardado.map((g) => g.factura_numero))}`)
    const almacen = await consulta(`select id from public.usuarios where correo = 'almacen.local@metalwork.test'`)
    comprobar(guardado[0]?.factura_recibida_por === almacen[0]?.id, '2. Quedó a nombre de la cuenta de Almacén')
    comprobar(texto.includes('Corregir'), '2. El botón pasa a «Corregir»')

    // 3. La otra pantalla no vio esto: guardar no lo pisa.
    await otraVentana.locator('input[name="factura"]').fill('F003-77')
    await otraVentana.getByRole('button', { name: 'Guardar' }).click()
    const avisoOtra = await hasta(async () => limpio(await otraVentana.locator('[role="alert"]').first().textContent().catch(() => '')), (t) => t.length > 0)
    comprobar(avisoOtra.includes('cambió después de que lo abriste'), `3. La pantalla vieja no pisa lo de la otra: «${avisoOtra}»`)
    const despues = await consulta(`select factura_numero from public.recepcion_documentos_compra where orden_compra_id = $1`, [oc.id])
    comprobar(despues[0]?.factura_numero === 'F001-9472', `3. La base sigue con la factura de la primera: ${despues[0]?.factura_numero}`)
    await otra.pagina.screenshot({ path: join(CAPTURAS, 'control-compras-otra-pantalla.png') })
    // «Ver lo de ahora» lee lo anotado sin refrescar la lista ni perder lo escrito.
    await otraVentana.getByRole('button', { name: 'Ver lo de ahora' }).click()
    const alDia = await hasta(async () => limpio(await otraVentana.locator('[role="status"]').first().textContent().catch(() => '')), (t) => t.includes('Ahora dice'))
    comprobar(alDia.includes('F001-9472'), `3. «Ver lo de ahora» dice lo que anotó la otra pantalla: «${alDia}»`)
    comprobar(await otraVentana.locator('input[name="factura"]').inputValue() === 'F003-77', '3. Lo escrito sigue en la ventana')
    await otraVentana.getByRole('button', { name: 'Guardar' }).click()
    await otraVentana.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    const corregido = await hasta(
      async () => (await consulta(`select factura_numero from public.recepcion_documentos_compra where orden_compra_id = $1`, [oc.id]))[0]?.factura_numero,
      (v) => v === 'F003-77')
    comprobar(corregido === 'F003-77', `3. Visto lo de ahora, la corrección sí entra: ${corregido}`)
    await otra.contexto.close()
  }

  // ============================================ 4. Pendientes y Excel
  await pagina.goto(`${BASE}/almacen/compras?vista=pendientes`, { waitUntil: 'networkidle' })
  const pendientes = await consulta(
    `select count(*)::int as n from public.control_de_compras_almacen(null, null)
      where factura_numero is null or material not in ('LLEGO', 'NO_APLICA')`)
  const nPendientes = await pagina.locator('tbody tr[data-compra]').count()
  comprobar(nPendientes === pendientes[0].n, `4. «Pendientes» trae lo que falta de cualquier día (${nPendientes} de ${pendientes[0].n})`)
  const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.getByRole('link', { name: 'Descargar pendientes' }).click()])
  comprobar(descarga.suggestedFilename().endsWith('.xlsx'), `4. La descarga es un Excel: ${descarga.suggestedFilename()}`)
  comprobar(errores.length === 0, `Sin errores de consola en el monitor${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()

  // ============================================ 5. Teléfono
  const tel = await entrar('almacen.local@metalwork.test', { width: 390, height: 844 })
  await tel.pagina.goto(`${BASE}/almacen/compras`, { waitUntil: 'networkidle' })
  const ancho = await tel.pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `5. En el teléfono no se desborda (${ancho} px)`)
  await tel.pagina.screenshot({ path: join(CAPTURAS, 'control-compras-390.png'), fullPage: true })
  comprobar(tel.errores.length === 0, `Sin errores de consola en el teléfono${tel.errores.length ? `: ${tel.errores.join(' | ')}` : ''}`)
  await tel.contexto.close()

  // ============================================ 6. Contabilidad y Ventas
  const con = await entrar('contabilidad.local@metalwork.test')
  await con.pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  comprobar(await con.pagina.locator('nav[aria-label="Menú principal"] a[href="/almacen/compras"]').count() > 0, '6. Contabilidad lo tiene en su menú')
  await con.pagina.goto(`${BASE}/almacen/compras`, { waitUntil: 'networkidle' })
  comprobar(await con.pagina.locator('tbody tr[data-compra]').count() === delDia.length, '6. Contabilidad lee el control')
  comprobar(await con.pagina.getByRole('button', { name: /lo recibido/ }).count() === 0, '6. Contabilidad no tiene el botón de anotar')
  await con.contexto.close()
  const tes = await entrar('tesoreria.local@metalwork.test')
  await tes.pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  comprobar(await tes.pagina.locator('nav[aria-label="Menú principal"] a[href="/almacen/compras"]').count() > 0, '6. Tesorería lo tiene en su menú')
  await tes.pagina.goto(`${BASE}/almacen/compras`, { waitUntil: 'networkidle' })
  comprobar(await tes.pagina.locator('tbody tr[data-compra]').count() === delDia.length, '6. Tesorería lee el control')
  comprobar(await tes.pagina.getByRole('button', { name: /lo recibido/ }).count() === 0, '6. Tesorería no tiene el botón de anotar')
  await tes.contexto.close()
  const ven = await entrar('ventas.local@metalwork.test')
  await ven.pagina.goto(`${BASE}/almacen/compras`, { waitUntil: 'networkidle' })
  comprobar(!ven.pagina.url().includes('/almacen/compras') || (await ven.pagina.locator('tbody tr[data-compra]').count()) === 0,
    `6. Ventas no entra (${new URL(ven.pagina.url()).pathname})`)
  await ven.contexto.close()
} finally {
  await navegador.close()
  await base.end()
}

console.log(fallas.length ? `\n${fallas.length} fallan.` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
