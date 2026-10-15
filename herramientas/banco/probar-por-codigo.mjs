/**
 * Clic real sobre la migración 20261016110000: Supervisión, Almacén y
 * Requerimientos trabajan por código interno, sin la OT. Con la cuenta de cada
 * puesto (nunca ADMIN):
 *
 *   1. Supervisión general tiene «Seguimiento por código» primero en el menú y
 *      en el teléfono, sin la OT; abre el código y ve sus seis etapas, la lista
 *      de materiales con el RQ, y los planos de las dos áreas con su PDF, sin
 *      botón para recibirlos. La OT lo manda a Seguimiento.
 *   2. Almacén tiene «Materiales por código» en lo que atiende y abre el código
 *      directo en materiales. La OT lo manda ahí.
 *   3. El supervisor de Maestranza abre «Materiales y pedidos» desde «Planos y
 *      etapas»: ve la lista y el RQ, y solo su plano. No entra a Seguimiento;
 *      la OT lo manda a Planos.
 *   4. Requerimientos llena la ficha del vehículo, cierra el ingreso y la
 *      salida, la descarga en PDF, adjunta el escaneo firmado (un archivo que
 *      no es PDF no entra) y le pide la revisión a Tesorería. La OT lo manda a
 *      Vehículos.
 *   5. Tesorería tiene el pendiente, ve el pedido con la ficha firmada en
 *      Cuentas por cobrar y lo observa; Requerimientos ve la observación, vuelve
 *      a pedir, y Tesorería la da por revisada.
 *   6. Gerencia ve la ficha y el historial sin poder cambiarlos.
 *   7. Ventas no entra ni al vehículo, ni a su ficha, ni al seguimiento.
 *
 * Necesita las cuentas `sup.general@`, `almacen@`, `sup.mtz@`, `requerimientos@`,
 * `tesoreria@`, `gerente@` y `ventas@local.test`; el código con dos planos
 * (Maestranza y Producción), una línea de materiales, las seis etapas y un RQ; y
 * un vehículo en la planta con ese código, sin ficha.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CODIGO, VEHICULO, PLACA (como la guarda la
 * base: sin guion ni espacios).
 */
import { mkdirSync } from 'node:fs'

import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CODIGO = process.env.CODIGO ?? 'BCO_SR_O4_1_26/31'
const VEHICULO = process.env.VEHICULO ?? '36300000-0000-4000-8000-000000000010'
const PLACA = process.env.PLACA ?? 'BCO363'
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, ancho = 1280) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: 900 } })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  // Cerrar el ingreso o la salida pide confirmar.
  pagina.on('dialog', (d) => d.accept())
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

async function menu(pagina) {
  return pagina.locator('nav[aria-label="Menú principal"] > div').evaluateAll((divs) =>
    divs.map((d) => ({ grupo: d.querySelector('p')?.textContent?.trim(), items: [...d.querySelectorAll('a')].map((a) => a.textContent?.trim()) })),
  )
}
async function pestanas(pagina) {
  return pagina.locator('nav[aria-label="Secciones"] a').evaluateAll((as) => as.map((a) => a.textContent?.trim()))
}

const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ')
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n')
const NO_PDF = Buffer.from('esto no es un pdf')
const seguimiento = (vista) => `${BASE}/seguimiento/codigo?${new URLSearchParams({ codigo: CODIGO, ...(vista ? { vista } : {}) })}`
const vehiculo = `${BASE}/vehiculos/${VEHICULO}`
const hoy = new Date().toISOString().slice(0, 10)
const sinErrores = (quien, errores) =>
  comprobar(errores.length === 0, `${quien} sin errores de consola${errores.length ? `: ${errores.join(' / ')}` : ''}`)

/** La OT, por la lista y por un enlace viejo, lo manda a lo que la reemplaza para su puesto. */
async function sinOt(pagina, quien, destino) {
  await pagina.goto(`${BASE}/ordenes`, { waitUntil: 'networkidle' })
  const lista = new URL(pagina.url())
  await pagina.goto(`${BASE}/ordenes/00000000-0000-4000-8000-000000000001?vista=entrega`, { waitUntil: 'networkidle' })
  const una = new URL(pagina.url())
  comprobar(
    `${lista.pathname}${lista.search}` === destino && `${una.pathname}${una.search}` === destino,
    `${quien}: la OT lo manda a ${destino} (${lista.pathname}${lista.search} y ${una.pathname}${una.search})`,
  )
}

/** Abre las categorías de la ficha y marca cada punto de una fase. */
async function marcarPuntos(pagina, fase, observado) {
  const cerrada = pagina.locator('details[data-categoria]:not([open]) > summary')
  while ((await cerrada.count()) > 0) await cerrada.first().click()
  const puntos = await pagina.locator(`select[name^="${fase}_"]`).all()
  for (const [i, s] of puntos.entries()) await s.selectOption(i === 0 && observado ? 'OBSERVADO' : 'CONFORME')
  return puntos.length
}

// ------------------------------------------------------------------ 1. Supervisión general
{
  const { pagina, contexto, errores } = await entrar('sup.general@local.test')
  const m = await menu(pagina)
  const propio = m.find((g) => g.grupo === 'Supervisión general')
  comprobar(propio?.items[0] === 'Seguimiento por código', `su primer grupo empieza por el seguimiento: ${propio?.items.join(' | ')}`)
  comprobar(!m.flatMap((g) => g.items).includes('Órdenes de trabajo'), 'sin «Órdenes de trabajo» en el menú')

  await pagina.goto(`${BASE}/seguimiento`, { waitUntil: 'networkidle' })
  const fila = pagina.locator(`a[data-codigo="${CODIGO}"]`)
  comprobar((await fila.count()) === 1 && (await texto(fila)).includes('6'), 'el código sale en Seguimiento con sus etapas')
  await fila.click()
  await pagina.waitForURL((u) => u.pathname === '/seguimiento/codigo', { timeout: 30000 })
  await pagina.waitForLoadState('networkidle')
  comprobar((await pagina.locator('[data-etapa]').count()) === 6, 'abre el código en Etapas: las seis')

  await pagina.goto(seguimiento('materiales'), { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-material="BCO-PLA3"]').count()) === 1, 've la lista de Diseño contra lo comprado y lo salido')
  comprobar((await texto(pagina.locator('main'))).includes('RQ-'), 've el RQ que pidió Maestranza')

  await pagina.goto(seguimiento('planos'), { waitUntil: 'networkidle' })
  comprobar(
    (await pagina.locator('section[data-area="Maestranza"] [data-plano]').count()) === 1 &&
      (await pagina.locator('section[data-area="Producción"] [data-plano]').count()) === 1,
    've los planos de Maestranza y de Producción',
  )
  comprobar((await pagina.getByRole('button', { name: /Marcar recibido/ }).count()) === 0, 'sin botón para recibirlos')
  const href = await pagina.getByRole('link', { name: /Abrir PDF/ }).first().getAttribute('href')
  const r = await contexto.request.get(`${BASE}${href}`, { maxRedirects: 5 })
  comprobar(r.status() === 200 && (await r.body()).subarray(0, 5).toString() === '%PDF-', 'abre el PDF del plano')
  await pagina.screenshot({ path: `${CAPTURAS}/363-sg-planos.png`, fullPage: true })
  await sinOt(pagina, 'Supervisión general', '/seguimiento')
  sinErrores('Supervisión general', errores)

  const telefono = await entrar('sup.general@local.test', 390)
  const tabs = await pestanas(telefono.pagina)
  comprobar(tabs[0] === 'Seguimiento' && !tabs.includes('Órdenes'), `en el teléfono: ${tabs.join(' | ')}`)
  await telefono.contexto.close()
}

// ------------------------------------------------------------------ 2. Almacén
{
  const { pagina, errores } = await entrar('almacen@local.test')
  const m = await menu(pagina)
  const atender = m.find((g) => g.grupo === 'Por atender')
  comprobar(atender?.items.join(' | ') === 'Atención de requerimiento | Materiales por código', `lo que atiende: ${atender?.items.join(' | ')}`)
  comprobar(!m.flatMap((g) => g.items).includes('Órdenes de trabajo'), 'sin «Órdenes de trabajo» en el menú')
  await pagina.locator('nav[aria-label="Menú principal"]').getByRole('link', { name: 'Materiales por código' }).click()
  await pagina.waitForURL((u) => u.pathname === '/seguimiento', { timeout: 30000 })
  await pagina.waitForLoadState('networkidle')
  const fila = pagina.locator(`a[data-codigo="${CODIGO}"]`)
  comprobar((await texto(fila)).includes('1 material en la lista'), 'la lista dice cuántos materiales lleva el código')
  await fila.click()
  await pagina.waitForURL((u) => u.pathname === '/seguimiento/codigo' && u.searchParams.get('vista') === 'materiales', { timeout: 30000 })
  await pagina.waitForLoadState('networkidle')
  comprobar((await pagina.locator('[data-material="BCO-PLA3"]').count()) === 1, 'y lo abre directo en Materiales')
  await sinOt(pagina, 'Almacén', '/seguimiento?vista=materiales')
  sinErrores('Almacén', errores)

  const telefono = await entrar('almacen@local.test', 390)
  const tabs = await pestanas(telefono.pagina)
  comprobar(tabs.join(' | ') === 'Atención | Materiales | Kardex | Tablero', `en el teléfono: ${tabs.join(' | ')}`)
  await telefono.contexto.close()
}

// ------------------------------------------------------------------ 3. Supervisor de Maestranza
{
  const { pagina, errores } = await entrar('sup.mtz@local.test', 390)
  await pagina.goto(`${BASE}/planos`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator(`li[data-codigo="${CODIGO}"]`)
  await tarjeta.getByRole('link', { name: 'Materiales y pedidos' }).click()
  await pagina.waitForURL((u) => u.pathname === '/seguimiento/codigo', { timeout: 30000 })
  await pagina.locator('[data-material="BCO-PLA3"]').waitFor({ timeout: 30000 }).catch(() => {})
  comprobar(
    (await pagina.locator('[data-material="BCO-PLA3"]').count()) === 1 && (await texto(pagina.locator('main'))).includes('RQ-'),
    'desde «Planos y etapas» ve los materiales y el RQ del código',
  )
  comprobar((await texto(pagina.locator('nav[aria-label="Ruta de navegación"]'))).includes('Planos y etapas'), 'y vuelve a «Planos y etapas»')
  await pagina.goto(seguimiento('planos'), { waitUntil: 'networkidle' })
  comprobar(
    (await pagina.locator('[data-plano]').count()) === 1 && (await pagina.locator('section[data-area="Producción"]').count()) === 0,
    'en Planos ve solo el de su área',
  )
  await pagina.goto(`${BASE}/seguimiento`, { waitUntil: 'networkidle' })
  comprobar(pagina.url().includes('/sin-permiso'), 'no entra a Seguimiento por código')
  await sinOt(pagina, 'Supervisor de Maestranza', '/planos')
  const tabs = await pestanas(pagina)
  comprobar(!tabs.includes('Órdenes'), `en el teléfono: ${tabs.join(' | ')}`)
  sinErrores('Maestranza', errores)
}

// ------------------------------------------------------------------ 4. Requerimientos: la ficha
{
  const { pagina, contexto, errores } = await entrar('requerimientos@local.test')
  comprobar(!(await menu(pagina)).flatMap((g) => g.items).includes('Órdenes de trabajo'), 'Requerimientos sin «Órdenes de trabajo» en el menú')
  await sinOt(pagina, 'Requerimientos', '/vehiculos')

  await pagina.goto(vehiculo, { waitUntil: 'networkidle' })
  const revision = pagina.locator('#revision-salida')
  comprobar((await texto(revision)).includes('cierra la salida de la ficha'), 'sin ficha cerrada, la revisión dice qué falta')

  // Cerrar el ingreso sin conductor no pasa.
  await pagina.fill('#fv-fi', hoy)
  await marcarPuntos(pagina, 'ingreso')
  await pagina.getByRole('button', { name: 'Cerrar ingreso' }).click()
  await pagina.locator('#ficha [role="alert"]').waitFor({ timeout: 30000 })
  comprobar((await texto(pagina.locator('#ficha [role="alert"]'))).includes('faltan el conductor'), 'cerrar el ingreso sin conductor no pasa')

  await pagina.fill('#fv-marca', 'Volvo')
  await pagina.fill('#fv-ci', 'Conductor de prueba')
  await pagina.fill('#fv-di', '00000000')
  await pagina.fill('#fv-combi', '1/2')
  await pagina.getByRole('button', { name: 'Cerrar ingreso' }).click()
  await pagina.locator('#ficha [role="status"]').filter({ hasText: 'Ingreso cerrado' }).waitFor({ timeout: 30000 })
  await pagina.reload({ waitUntil: 'networkidle' })
  comprobar((await texto(pagina.locator('#ficha'))).includes('Ingreso cerrado el'), 'el ingreso queda cerrado')
  comprobar(await pagina.locator('select[name^="ingreso_"]').first().isDisabled(), 'y sus puntos ya no se cambian')

  await pagina.fill('#fv-cs', 'Conductor de prueba')
  await pagina.fill('#fv-fs', hoy)
  await pagina.fill('#fv-tr', 'Fabricación del cajón')
  const puntos = await marcarPuntos(pagina, 'salida', true)
  await pagina.getByRole('button', { name: 'Cerrar salida' }).click()
  await pagina.locator('#ficha [role="status"]').filter({ hasText: 'Salida cerrada' }).waitFor({ timeout: 30000 })
  await pagina.reload({ waitUntil: 'networkidle' })
  comprobar(
    (await texto(pagina.locator('#ficha'))).includes('Salida cerrada el') && (await pagina.getByRole('button', { name: 'Guardar avance' }).count()) === 0,
    `la salida queda cerrada, con sus ${puntos} puntos, y la ficha ya no se edita`,
  )

  const pdf = await contexto.request.get(`${BASE}/vehiculos/${VEHICULO}/ficha/pdf`)
  comprobar(
    pdf.status() === 200 &&
      (await pdf.body()).subarray(0, 5).toString() === '%PDF-' &&
      (pdf.headers()['content-disposition'] ?? '').includes('attachment'),
    'la ficha se descarga en PDF',
  )

  await pagina.setInputFiles('#fv-escaneo', { name: 'ficha.txt', mimeType: 'application/pdf', buffer: NO_PDF })
  await pagina.getByRole('button', { name: 'Adjuntar escaneo' }).click()
  await pagina.locator('#ficha [role="alert"]').waitFor({ timeout: 15000 })
  comprobar((await texto(pagina.locator('#ficha [role="alert"]'))).includes('en PDF'), 'un escaneo que no es PDF no entra')
  await pagina.setInputFiles('#fv-escaneo', { name: 'ficha-firmada.pdf', mimeType: 'application/pdf', buffer: PDF })
  await pagina.getByRole('button', { name: 'Adjuntar escaneo' }).click()
  await pagina.locator('#ficha [role="status"]').filter({ hasText: 'Escaneo firmado adjunto' }).waitFor({ timeout: 30000 })
  await pagina.reload({ waitUntil: 'networkidle' })
  const escaneo = await pagina.getByRole('link', { name: 'Ver escaneo firmado' }).getAttribute('href')
  const r = escaneo ? await contexto.request.get(escaneo) : null
  comprobar(r?.status() === 200 && (await r.body()).subarray(0, 5).toString() === '%PDF-', 'el escaneo firmado queda adjunto y se abre')
  comprobar((await pagina.locator('#fv-escaneo').count()) === 0, 'y ya no se vuelve a adjuntar')

  await pagina.fill('#fv-concepto', 'Revisar si el cliente pagó el saldo antes de entregarle la unidad')
  await pagina.getByRole('button', { name: 'Pedir revisión a Tesorería' }).click()
  await pagina.locator('#revision-salida [role="status"]').filter({ hasText: 'Pedido enviado' }).waitFor({ timeout: 30000 })
  await pagina.reload({ waitUntil: 'networkidle' })
  comprobar(
    (await texto(pagina.locator('#revision-salida'))).includes('Esperando a Tesorería') && (await pagina.locator('#fv-concepto').count()) === 0,
    'el pedido queda esperando a Tesorería, sin pedir otro',
  )
  await pagina.screenshot({ path: `${CAPTURAS}/363-requerimientos-ficha.png`, fullPage: true })
  sinErrores('Requerimientos', errores)
  await contexto.close()
}

// ------------------------------------------------------------------ 5. Tesorería y la vuelta
async function responder(estado, respuesta, mensaje) {
  const { pagina, contexto, errores } = await entrar('tesoreria@local.test')
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  comprobar(/salida de vehículo por revisar/i.test(await texto(pagina.locator('main'))), 'Tesorería tiene el pendiente en su tablero')
  await pagina.goto(`${BASE}/tesoreria/por-cobrar`, { waitUntil: 'networkidle' })
  const pedido = pagina.locator('#salidas-por-revisar [data-revision]')
  comprobar(
    (await pedido.count()) === 1 && (await texto(pedido)).includes(PLACA) && (await texto(pedido)).includes(CODIGO),
    'en Cuentas por cobrar ve el pedido con la placa y el código',
  )
  const firmada = await pedido.getByRole('link', { name: 'Ver ficha firmada' }).getAttribute('href')
  const r = firmada ? await contexto.request.get(firmada) : null
  comprobar(r?.status() === 200 && (await r.body()).subarray(0, 5).toString() === '%PDF-', 'y abre la ficha firmada')
  await pedido.locator('select[name="estado"]').selectOption(estado)
  await pedido.locator('textarea[name="respuesta"]').fill(respuesta)
  await pedido.getByRole('button', { name: 'Responder' }).click()
  await pagina.locator('[role="status"]').filter({ hasText: mensaje }).waitFor({ timeout: 30000 })
  await pagina.reload({ waitUntil: 'networkidle' })
  comprobar((await pagina.locator('#salidas-por-revisar').count()) === 0, `respondido (${estado}), sale de su lista`)
  if (estado === 'ATENDIDA') await pagina.screenshot({ path: `${CAPTURAS}/363-tesoreria.png`, fullPage: true })
  sinErrores('Tesorería', errores)
  await contexto.close()
}

await responder('OBSERVADA', 'Falta el saldo de la factura', 'Salida observada')
{
  const { pagina, contexto, errores } = await entrar('requerimientos@local.test')
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  comprobar(/salida de vehículo observada por Tesorería/i.test(await texto(pagina.locator('main'))), 'Requerimientos tiene la observación en su tablero')
  await pagina.goto(vehiculo, { waitUntil: 'networkidle' })
  const revision = pagina.locator('#revision-salida')
  comprobar(
    (await texto(revision)).includes('Observada') && (await texto(revision)).includes('Falta el saldo de la factura'),
    've la observación con la respuesta de Tesorería',
  )
  await pagina.fill('#fv-concepto', 'El cliente ya pagó el saldo')
  await pagina.getByRole('button', { name: 'Pedir revisión a Tesorería' }).click()
  await pagina.locator('#revision-salida [role="status"]').filter({ hasText: 'Pedido enviado' }).waitFor({ timeout: 30000 })
  sinErrores('Requerimientos', errores)
  await contexto.close()
}
await responder('ATENDIDA', 'Pagado: voucher del 15/10', 'Salida revisada')
{
  const { pagina, contexto } = await entrar('requerimientos@local.test')
  await pagina.goto(vehiculo, { waitUntil: 'networkidle' })
  const revision = pagina.locator('#revision-salida')
  const estados = await revision.locator('li[data-estado]').evaluateAll((li) => li.map((l) => l.getAttribute('data-estado')))
  comprobar(
    (await texto(revision)).includes('Revisada: puede salir') && estados.join(' | ') === 'ATENDIDA | OBSERVADA',
    `Requerimientos la ve revisada, con los dos pedidos en el historial (${estados.join(' | ')})`,
  )
  comprobar((await pagina.locator('#fv-concepto').count()) === 0, 'revisada, ya no se pide otra')
  await contexto.close()
}

// ------------------------------------------------------------------ 6. Gerencia
{
  const { pagina, errores } = await entrar('gerente@local.test')
  await pagina.goto(vehiculo, { waitUntil: 'networkidle' })
  comprobar(
    (await pagina.locator('#ficha fieldset[disabled]').count()) === 1 &&
      (await pagina.locator('#ficha, #revision-salida').getByRole('button').count()) === 0,
    'Gerencia ve la ficha sin poder cambiarla',
  )
  comprobar(
    (await pagina.getByRole('link', { name: 'Ver escaneo firmado' }).count()) === 1 &&
      (await pagina.locator('#revision-salida li[data-estado]').count()) === 2,
    'y el escaneo y el historial de revisiones',
  )
  sinErrores('Gerencia', errores)
}

// ------------------------------------------------------------------ 7. Ventas
{
  const { pagina, contexto } = await entrar('ventas@local.test')
  for (const ruta of [`/vehiculos/${VEHICULO}`, '/seguimiento', `/seguimiento/codigo?codigo=${encodeURIComponent(CODIGO)}`]) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    comprobar(pagina.url().includes('/sin-permiso'), `Ventas no entra a ${ruta}`)
  }
  const r = await contexto.request.get(`${BASE}/vehiculos/${VEHICULO}/ficha/pdf`, { maxRedirects: 0 })
  comprobar(r.status() !== 200, `ni a la ficha en PDF por su dirección (${r.status()})`)
}

await navegador.close()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} falla(s).`)
  process.exit(1)
}
console.log('\nTodo pasa.')
