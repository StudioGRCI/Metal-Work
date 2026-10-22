/**
 * El archivo que se elige o se sube y no queda: lo que quedó pendiente del PR
 * #143, con la cuenta de cada puesto (nunca ADMIN), en el teléfono y en el
 * monitor.
 *
 *   1. Logística, «Nueva OC directa»: el comprobante es opcional y ahora se
 *      puede quitar. «Quitar» nombra el archivo, se alcanza con el teclado,
 *      vacía el campo y lo que se leyó de él, y deja el foco en el campo. Un
 *      campo obligatorio (RR. HH., «Importar del Excel») no lo lleva.
 *      Lo leído se va con el archivo: el número y la fecha de la factura
 *      quitada no se quedan para la siguiente (Logística), ni el total, el
 *      número y la emisión en el registro de Contabilidad; lo que la persona
 *      escribió a mano, sí, y si no calza con lo leído se avisa.
 *   2. Administración, el PDF de una orden, cuando se pierde la conexión al
 *      anotarlo (`anotarSinDejarloSuelto`):
 *      - el pedido no llegó: se pregunta otra vez y queda una sola fila;
 *      - llegó y se perdió la respuesta: la segunda vez la base no lo duplica,
 *        la acción reconoce su propia ruta y responde que quedó, y el archivo
 *        se queda;
 *      - sin señal las dos veces: no queda fila ni archivo suelto en Storage, y
 *        la pantalla dice que no quedó.
 *   3. Administración, «Nueva orden de trabajo», cuando se pierde la respuesta
 *      al registrarla: la segunda vez la acción reconoce su propio PDF, abre la
 *      orden y no hay otra. (En el monitor; deja una orden de banco.)
 *
 * Arma lo suyo con el sello QA-SUELTO-… en la base del banco y lo retira al
 * terminar. Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE
 * (mw_demo), CAPTURAS.
 */
import { mkdirSync } from 'node:fs'
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
const uno = async (sql, valores = []) => (await base.query(sql, valores)).rows[0]

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const quieta = (pagina) => pagina.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
async function esperar(fn, ms = 15000) {
  const hasta = Date.now() + ms
  while (Date.now() < hasta) {
    if (await fn().catch(() => false)) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
const TELEFONO = { width: 390, height: 844 }
const MONITOR = { width: 1440, height: 900 }
const nombreDe = (v) => (v.width < 500 ? '390' : '1440')

async function entrar(correo, viewport) {
  const movil = viewport.width < 500
  const contexto = await navegador.newContext({ viewport, isMobile: movil, hasTouch: movil, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'load' })
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
async function ir(pagina, ruta) {
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'load' })
  await quieta(pagina)
}
/** Lo que dice la caja del campo. Con `innerText`: el «toca» escondido no cuenta. */
const dice = async (input) => limpio(await input.locator('xpath=..').innerText())
const enfocado = (pagina) => pagina.evaluate(() => ({
  id: document.activeElement?.id ?? '',
  etiqueta: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim() ?? '',
}))

/** Un PDF de una página con estas líneas: el detector lo lee como una factura. */
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
const FACTURA_A = pdfConTexto(['FACTURA ELECTRONICA', 'F001-00000111', 'FECHA DE EMISION: 10/10/2026', 'IMPORTE TOTAL: S/ 118.00'])
const FACTURA_B = pdfConTexto(['FACTURA ELECTRONICA', 'F002-00000222', 'FECHA DE EMISION: 12/10/2026', 'IMPORTE TOTAL: S/ 236.00'])

const sello = Date.now().toString().slice(-6)
const PDF_MINIMO = (relleno) =>
  Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n%${'x'.repeat(relleno)}\ntrailer<</Root 1 0 R>>\n%%EOF\n`)

// ------------------------------------------------- 1. «Quitar» el opcional
async function quitarElOpcional(viewport) {
  const tam = nombreDe(viewport)
  const { pagina: p, contexto } = await entrar('logistica.local@metalwork.test', viewport)
  await ir(p, '/compras/ordenes')
  await p.getByRole('button', { name: /Nueva OC directa/ }).first().click()
  const dialogo = p.getByRole('dialog').first()
  await dialogo.waitFor({ timeout: 20000 })
  const campo = dialogo.locator('#ocd-factura')
  await campo.waitFor({ state: 'attached', timeout: 20000 })
  const caja = campo.locator('xpath=..')
  comprobar((await caja.getByRole('button', { name: /^Quitar / }).count()) === 0, `[Logística ${tam}] sin archivo, el campo no ofrece «Quitar»`)

  const nombre = `QA-QUITAR-${sello}.pdf`
  await campo.setInputFiles({ name: nombre, mimeType: 'application/pdf', buffer: PDF_MINIMO(800) })
  const quitar = caja.getByRole('button', { name: `Quitar ${nombre}` })
  comprobar(await esperar(async () => (await quitar.count()) === 1, 10000), `[Logística ${tam}] con el comprobante elegido, «Quitar» lo nombra`)
  comprobar((await dice(campo)).startsWith(nombre), `[Logística ${tam}] el campo muestra el elegido: «${await dice(campo)}»`)
  const alto = (await quitar.boundingBox())?.height ?? 0
  comprobar(viewport.width >= 500 || alto >= 44, `[Logística ${tam}] «Quitar» se toca con el dedo (${Math.round(alto)} px)`)
  const conFactura = (await dialogo.locator('#ocd-factura-numero').count()) > 0
  await caja.scrollIntoViewIfNeeded()
  await p.screenshot({ path: join(CAPTURAS, `suelto-quitar-elegido-${tam}.png`) })

  // Con el teclado: del campo, Tab llega a «Quitar»; Enter lo vacía.
  await campo.focus()
  await p.keyboard.press('Tab')
  comprobar((await enfocado(p)).etiqueta === `Quitar ${nombre}`, `[Logística ${tam}] Tab desde el campo llega a «Quitar»: ${JSON.stringify(await enfocado(p))}`)
  await p.keyboard.press('Enter')
  comprobar(await esperar(async () => (await campo.evaluate((i) => i.files.length)) === 0, 5000), `[Logística ${tam}] «Quitar» vacía el campo`)
  comprobar(await esperar(async () => (await dice(campo)).startsWith('Elegir el PDF'), 5000), `[Logística ${tam}] y vuelve a pedir: «${await dice(campo)}»`)
  comprobar((await quitar.count()) === 0, `[Logística ${tam}] y «Quitar» se va`)
  comprobar((await enfocado(p)).id === 'ocd-factura', `[Logística ${tam}] el foco queda en el campo: ${JSON.stringify(await enfocado(p))}`)
  if (conFactura) {
    comprobar((await dialogo.locator('#ocd-factura-numero').count()) === 0, `[Logística ${tam}] y se van el número y la fecha de la factura que ya no está`)
  }
  await p.screenshot({ path: join(CAPTURAS, `suelto-quitar-vacio-${tam}.png`) })
  const desborde = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  comprobar(desborde <= 0, `[Logística ${tam}] sin desborde (${desborde} px)`)
  await p.keyboard.press('Escape')
  await contexto.close()

  // Un campo obligatorio no lo lleva: para cambiarlo se elige otro.
  const rrhh = await entrar('rrhh.local@metalwork.test', viewport)
  await ir(rrhh.pagina, '/rrhh')
  await rrhh.pagina.getByRole('button', { name: /Importar del Excel/ }).first().click()
  const excel = rrhh.pagina.getByRole('dialog').first().locator('input[type="file"]').first()
  await excel.waitFor({ state: 'attached', timeout: 20000 })
  await excel.setInputFiles({ name: `QA-OBLIGATORIO-${sello}.xlsx`, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('PK\u0003\u0004') })
  await rrhh.pagina.waitForTimeout(600)
  comprobar((await excel.locator('xpath=..').getByRole('button', { name: /^Quitar / }).count()) === 0, `[RR. HH. ${tam}] el obligatorio no ofrece «Quitar»`)
  await rrhh.contexto.close()
}

// ------------------------------------------------- 1b. lo leído se va con el archivo
async function loLeidoSeVaConElArchivo(viewport) {
  const tam = nombreDe(viewport)
  const valor = (pagina, id) => pagina.locator(id).inputValue().catch(() => '—')

  // Logística: la factura A se lee, se quita, y la B trae lo suyo.
  const { pagina: p, contexto } = await entrar('logistica.local@metalwork.test', viewport)
  await ir(p, '/compras/ordenes')
  await p.getByRole('button', { name: /Nueva OC directa/ }).first().click()
  const d = p.getByRole('dialog').first()
  await d.waitFor({ timeout: 20000 })
  const campo = d.locator('#ocd-factura')
  await campo.waitFor({ state: 'attached', timeout: 20000 })
  const caja = campo.locator('xpath=..')
  await campo.setInputFiles({ name: `QA-LEIDA-A-${sello}.pdf`, mimeType: 'application/pdf', buffer: FACTURA_A })
  comprobar(await esperar(async () => (await valor(d, '#ocd-factura-numero')) === 'F001-111', 20000),
    `[Logística ${tam}] la factura A se lee: «${await valor(d, '#ocd-factura-numero')}» del ${await valor(d, '#ocd-factura-fecha')}`)
  await caja.getByRole('button', { name: /^Quitar / }).click()
  await campo.setInputFiles({ name: `QA-LEIDA-B-${sello}.pdf`, mimeType: 'application/pdf', buffer: FACTURA_B })
  comprobar(await esperar(async () => (await valor(d, '#ocd-factura-numero')) === 'F002-222' && (await valor(d, '#ocd-factura-fecha')) === '2026-10-12', 20000),
    `[Logística ${tam}] quitada la A, la B trae su número y su fecha: «${await valor(d, '#ocd-factura-numero')}» del ${await valor(d, '#ocd-factura-fecha')}`)
  // Lo escrito a mano se queda al cambiar de archivo, y si no calza se avisa.
  await d.locator('#ocd-factura-numero').fill('F009-999')
  await caja.getByRole('button', { name: /^Quitar / }).click()
  await campo.setInputFiles({ name: `QA-LEIDA-A2-${sello}.pdf`, mimeType: 'application/pdf', buffer: FACTURA_A })
  const avisa = await esperar(async () => (await d.getByText('La factura es la F001-111 y se anotó como F009-999: revisa el número.').count()) > 0, 20000)
  comprobar(avisa && (await valor(d, '#ocd-factura-numero')) === 'F009-999',
    `[Logística ${tam}] el número escrito a mano se queda y se avisa que no es el de la factura («${await valor(d, '#ocd-factura-numero')}»)`)
  await d.locator('#ocd-factura-numero').scrollIntoViewIfNeeded()
  await p.screenshot({ path: join(CAPTURAS, `suelto-leido-oc-${tam}.png`) })
  await p.keyboard.press('Escape')
  await contexto.close()

  // Contabilidad: lo que llenó el PDF quitado se vacía; lo escrito a mano, no.
  const c = await entrar('contabilidad.local@metalwork.test', viewport)
  await ir(c.pagina, '/adquisiciones')
  const pdf = c.pagina.locator('#adq-pdf')
  await pdf.waitFor({ state: 'attached', timeout: 20000 })
  const datos = async () => [await valor(c.pagina, '#adq-total'), await valor(c.pagina, '#adq-numero'), await valor(c.pagina, '#adq-emision')].join(' · ')
  await pdf.setInputFiles({ name: `QA-LEIDA-A-${sello}.pdf`, mimeType: 'application/pdf', buffer: FACTURA_A })
  comprobar(await esperar(async () => (await datos()) === '118.00 · F001-111 · 2026-10-10', 20000), `[Contabilidad ${tam}] el PDF A llena el total, el número y la emisión: ${await datos()}`)
  await pdf.locator('xpath=..').getByRole('button', { name: /^Quitar / }).click()
  comprobar(await esperar(async () => (await datos()) === ' ·  · ', 5000), `[Contabilidad ${tam}] al quitarlo se vacían: «${await datos()}»`)
  await c.pagina.locator('#adq-total').fill('50.00')
  await pdf.setInputFiles({ name: `QA-LEIDA-B-${sello}.pdf`, mimeType: 'application/pdf', buffer: FACTURA_B })
  comprobar(await esperar(async () => (await datos()) === '50.00 · F002-222 · 2026-10-12', 20000),
    `[Contabilidad ${tam}] con el PDF B, el total escrito a mano se queda y lo demás es de la B: ${await datos()}`)
  await c.pagina.locator('#adq-total').scrollIntoViewIfNeeded()
  await c.pagina.screenshot({ path: join(CAPTURAS, `suelto-leido-adquisiciones-${tam}.png`) })
  await c.contexto.close()
}

// ------------------------------------------------- 2. la conexión que se pierde al anotar
async function conexionQueSePierde(viewport) {
  const tam = nombreDe(viewport)
  // Una orden abierta sin cotización con PDF: la que más tiene, para no tocar
  // la de un solo PDF que usan las otras pruebas.
  const orden = await uno(`select o.id, o.numero from public.ordenes_trabajo o
                            where o.cotizacion_pdf_id is null and o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA', 'BORRADOR')
                            order by (select count(*) from public.ot_adjuntos a where a.orden_id = o.id and a.tipo = 'ORDEN') desc, o.numero
                            limit 1`)
  if (!orden) return comprobar(false, `[Administración ${tam}] hay una orden abierta sin cotización`)
  const { pagina: p, contexto } = await entrar('administracion.local@metalwork.test', viewport)
  await ir(p, `/ordenes/${orden.id}`)
  const campo = p.locator(`#subir-pdf-${orden.id}`)

  for (const caso of ['el pedido no llegó', 'se perdió la respuesta', 'sin señal las dos veces']) {
    if (!(await campo.count())) {
      await p.getByRole('button', { name: 'Cambiar el PDF' }).click()
      await campo.waitFor({ state: 'attached', timeout: 20000 })
    }
    const anotaciones = []
    await p.route((url) => url.pathname.startsWith('/ordenes/'), async (r) => {
      const pedido = r.request()
      const cuerpo = pedido.method() === 'POST' && pedido.headers()['next-action'] ? pedido.postData() ?? '' : ''
      if (!cuerpo.includes('ruta_storage')) return r.continue()
      // El formulario de una acción de servidor lleva los campos con un prefijo («_1_ruta_storage»).
      anotaciones.push(/name="(?:_?\d+_)?ruta_storage"\r?\n\r?\n([^\r\n]+)/.exec(cuerpo)?.[1] ?? '')
      const vez = anotaciones.length
      try {
        if (caso === 'el pedido no llegó' && vez === 1) return await r.abort('failed')
        if (caso === 'se perdió la respuesta' && vez === 1) {
          await r.fetch({ timeout: 60000 })
          return await r.abort('failed')
        }
        if (caso === 'sin señal las dos veces') return await r.abort('failed')
        return await r.continue()
      } catch {
        await r.abort('failed').catch(() => {})
      }
    })
    const nombre = `QA-SUELTO-${sello}-${tam}-${caso.replace(/\W+/g, '-')}.pdf`
    await campo.setInputFiles({ name: nombre, mimeType: 'application/pdf', buffer: PDF_MINIMO(900) })
    const termino = async () => !(await campo.count()) || !/Subiendo/.test(await dice(campo))
    await esperar(async () => anotaciones.length >= 1, 20000)
    await esperar(termino, 30000)
    await p.waitForTimeout(400)
    await p.unrouteAll({ behavior: 'ignoreErrors' })
    const ruta = anotaciones[0]
    const filas = Number((await uno('select count(*) from public.ot_adjuntos where orden_id = $1 and nombre_archivo = $2', [orden.id, nombre])).count)
    const enStorage = Number((await uno(`select count(*) from storage.objects where bucket_id = 'adjuntos-ot' and name = $1`, [ruta])).count)
    comprobar(anotaciones.length === 2 && ruta.startsWith(`ot/${orden.id}/`) && anotaciones[1] === ruta,
      `[Administración ${tam}] ${caso}: se pregunta otra vez con la misma ruta (${anotaciones.length} veces, ${ruta ? 'con ruta' : 'sin ruta'})`)

    if (caso === 'el pedido no llegó') {
      comprobar(filas === 1 && enStorage === 1, `[Administración ${tam}] ${caso}: queda guardado una vez, con su archivo (filas ${filas}, archivo ${enStorage})`)
      const estado = await esperar(async () => (await p.locator('[role=status]').filter({ hasText: /PDF (corregido )?guardado/ }).count()) > 0, 10000)
      comprobar(estado, `[Administración ${tam}] ${caso}: dice que quedó`)
    } else if (caso === 'se perdió la respuesta') {
      comprobar(filas === 1 && enStorage === 1, `[Administración ${tam}] ${caso}: la base no lo duplica y el archivo anotado se queda (filas ${filas}, archivo ${enStorage})`)
      const estado = await esperar(async () => (await p.locator('[role=status]').filter({ hasText: /PDF (corregido )?guardado/ }).count()) > 0, 10000)
      comprobar(estado, `[Administración ${tam}] ${caso}: la segunda vez la acción reconoce lo suyo y dice que quedó`)
    } else {
      comprobar(filas === 0 && enStorage === 0, `[Administración ${tam}] ${caso}: no queda fila ni archivo suelto (filas ${filas}, archivo ${enStorage})`)
      const texto = await dice(campo)
      comprobar(texto.includes('No quedó registrado: no llegó la respuesta. Vuelve a intentar.'), `[Administración ${tam}] ${caso}: dice que no quedó: «${texto}»`)
    }
    await p.screenshot({ path: join(CAPTURAS, `suelto-${caso.replace(/\W+/g, '-')}-${tam}.png`) })
  }
  await contexto.close()
}

// ------------------------------------------------- 3. la orden nueva cuya respuesta se pierde
async function ordenNuevaSinRespuesta(viewport) {
  const tam = nombreDe(viewport)
  const cliente = (await uno('select razon_social from public.clientes order by razon_social limit 1'))?.razon_social
  if (!cliente) return comprobar(false, `[Administración ${tam}] hay un cliente para la orden`)
  const descripcion = `QA-SUELTO orden sin respuesta ${sello}`
  const { pagina: p, contexto } = await entrar('administracion.local@metalwork.test', viewport)
  await ir(p, '/ordenes/nueva')
  await p.locator('#cliente_id').click()
  await p.getByRole('searchbox').fill(cliente)
  await p.locator('[role="option"]').first().click()
  await p.locator('#tipo_trabajo').selectOption('REPARACION')
  await p.locator('#descripcion').fill(descripcion)
  await p.locator('#numero').fill(`9${sello.slice(-3)}`)
  await p.locator('#pdf_orden').setInputFiles({ name: `QA-ORDEN-SIN-RESPUESTA-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`ORDEN DE TRABAJO ${sello}`]) })
  let registros = 0
  await p.route((url) => url.pathname.startsWith('/ordenes/nueva'), async (r) => {
    const pedido = r.request()
    const cuerpo = pedido.method() === 'POST' && pedido.headers()['next-action'] ? pedido.postData() ?? '' : ''
    if (!cuerpo.includes('ruta_pdf')) return r.continue()
    registros += 1
    try {
      if (registros === 1) {
        await r.fetch({ timeout: 60000 })
        return await r.abort('failed')
      }
      return await r.continue()
    } catch {
      await r.abort('failed').catch(() => {})
    }
  })
  await p.getByRole('button', { name: 'Registrar orden' }).click()
  const abrio = await esperar(async () => /\/ordenes\/[0-9a-f-]{36}/.test(p.url()), 40000)
  await p.unrouteAll({ behavior: 'ignoreErrors' })
  const ordenes = await base.query(`select o.id, (select count(*)::int from public.ot_adjuntos a where a.orden_id = o.id and a.tipo = 'ORDEN') as pdfs
                                      from public.ordenes_trabajo o where o.descripcion = $1`, [descripcion])
  comprobar(registros === 2, `[Administración ${tam}] orden nueva sin respuesta: se pregunta otra vez (${registros} veces)`)
  comprobar(ordenes.rows.length === 1 && ordenes.rows[0].pdfs === 1, `[Administración ${tam}] queda una sola orden, con su PDF (${ordenes.rows.length} órdenes, ${ordenes.rows[0]?.pdfs ?? 0} PDF)`)
  comprobar(abrio && p.url().includes(ordenes.rows[0]?.id ?? '—'), `[Administración ${tam}] y la pantalla abre esa orden en vez de decir que no se sabe (${new URL(p.url()).pathname})`)
  await p.screenshot({ path: join(CAPTURAS, `suelto-orden-nueva-${tam}.png`) })
  await contexto.close()
}

try {
  await ordenNuevaSinRespuesta(MONITOR)
  for (const viewport of [MONITOR, TELEFONO]) {
    await quitarElOpcional(viewport)
    await loLeidoSeVaConElArchivo(viewport)
    await conexionQueSePierde(viewport)
  }
} finally {
  // Lo que armó esta prueba no se queda en la orden de las demás.
  await base.query(`delete from storage.objects where bucket_id = 'adjuntos-ot'
                      and name in (select ruta_storage from public.ot_adjuntos where nombre_archivo like $1)`, [`QA-SUELTO-${sello}-%`])
  await base.query('delete from public.ot_adjuntos where nombre_archivo like $1', [`QA-SUELTO-${sello}-%`])
  await navegador.close()
  await base.end()
}

const propios = errores.filter((e) => !/Failed to load resource|net::ERR_FAILED|Failed to fetch|fetch failed/i.test(e))
comprobar(propios.length === 0, `sin errores de consola propios${propios.length ? `: ${propios.join(' | ')}` : ''}`)
console.log(fallas.length ? `\n${fallas.length} fallan.` : '\nTodo en verde.')
process.exit(fallas.length ? 1 : 0)
