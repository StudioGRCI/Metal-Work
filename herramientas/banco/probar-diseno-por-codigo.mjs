/**
 * Clic real sobre lo que Diseño carga por código interno (migración
 * 20261015200000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Diseño ve sus tres entradas primero en el menú, abre un código desde
 *      «Planos», carga el plano 001 para Maestranza y el 002 para Producción
 *      en PDF; un archivo que no es PDF no entra.
 *   2. Diseño arma la lista de materiales (con coma decimal) desde el plano y
 *      la ve contra lo comprado y lo salido.
 *   3. Diseño carga las etapas de siempre y le pone a «Habilitado» una fecha
 *      comprometida que ya pasó: sale vencida.
 *   4. El supervisor de Maestranza tiene «Planos y etapas» en el menú, ve solo
 *      el plano de su área, abre el PDF, lo marca recibido y marca «Habilitado»
 *      terminado: como va tarde, le pide el porqué.
 *   5. El supervisor de Producción no ve el plano de Maestranza.
 *   6. Gerencia ve el código con su etapa, sus planos (recibido por
 *      Maestranza) y su lista en Códigos internos.
 *   7. Logística no entra a nada de esto, ni al PDF por su dirección.
 *
 * Necesita las cuentas `diseno@`, `sup.mtz@`, `sup.prd@`, `gerente@` y
 * `comprador@local.test`, tres materiales del catálogo y un código conocido.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CODIGO.
 */
import { mkdirSync } from 'node:fs'

import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CODIGO = process.env.CODIGO ?? 'BCO_SR_O4_1_26/28'
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

const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ')
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n')
const NO_PDF = Buffer.from('esto no es un pdf')
const enlace = (vista) => `${BASE}/diseno/codigo?${new URLSearchParams({ codigo: CODIGO, ...(vista ? { vista } : {}) })}`

async function cargarPlano(pagina, { numero, nombre, area, archivo, peso = '25' }) {
  await pagina.fill('#plano-numero', numero)
  await pagina.fill('#plano-nombre', nombre)
  await pagina.selectOption('#plano-area', { label: area })
  // Desde 20261020100000 cada plano lleva el % de la unidad que representa.
  await pagina.fill('#plano-peso', peso)
  await pagina.setInputFiles('#plano-pdf', { name: `${numero}.pdf`, mimeType: 'application/pdf', buffer: archivo })
  await pagina.getByRole('button', { name: 'Cargar plano' }).click()
}

// ------------------------------------------------------------------ 1. Diseño: planos
{
  const { pagina, errores } = await entrar('diseno@local.test')
  const m = await menu(pagina)
  const primero = m.find((g) => g.grupo !== 'Principal')
  comprobar(
    primero?.grupo === 'Por código interno' && primero.items.join(' | ') === 'Planos | Gestión de materiales | Control de etapas',
    `Diseño tiene sus tres entradas primero: ${primero?.grupo} › ${primero?.items.join(' | ')}`,
  )

  await pagina.goto(`${BASE}/diseno/planos`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator(`[data-codigo="${CODIGO}"]`).count()) === 1, 'el código del requerimiento sale en la lista de Planos')
  await pagina.fill('#abrir-codigo', CODIGO.toLowerCase())
  await pagina.getByRole('button', { name: 'Abrir código' }).click()
  await pagina.waitForURL((u) => u.pathname === '/diseno/codigo', { timeout: 30000 })
  comprobar((await texto(pagina.locator('h1'))) === CODIGO, 'abre el código escrito en minúsculas como uno solo')

  await cargarPlano(pagina, { numero: '003', nombre: 'Prueba no PDF', area: 'Maestranza', archivo: NO_PDF })
  await pagina.locator('[role="alert"]').first().waitFor({ timeout: 15000 })
  comprobar((await texto(pagina.locator('[role="alert"]').first())).includes('Elige el PDF del plano'), 'un archivo que no es PDF no entra')

  await pagina.goto(enlace(), { waitUntil: 'networkidle' })
  await cargarPlano(pagina, { numero: '001', nombre: 'Estructura del cajón', area: 'Maestranza', archivo: PDF })
  await pagina.locator('[role="status"]').filter({ hasText: 'Plano 001 cargado' }).waitFor({ timeout: 30000 })
  await cargarPlano(pagina, { numero: '002', nombre: 'Bastidor', area: 'Producción', archivo: PDF })
  await pagina.locator('[role="status"]').filter({ hasText: 'Plano 002 cargado' }).waitFor({ timeout: 30000 })
  await pagina.waitForTimeout(1500)
  const maestranza = pagina.locator('section[data-area="Maestranza"]')
  comprobar((await texto(maestranza)).includes('001 · Estructura del cajón') && (await texto(maestranza)).includes('Por recibir'),
    'el plano 001 queda en Maestranza, por recibir')
  comprobar((await pagina.locator('section[data-area="Producción"] [data-plano]').count()) === 1, 'y el 002 en Producción')
  await pagina.screenshot({ path: `${CAPTURAS}/360-diseno-planos.png`, fullPage: true })

  // ---------------------------------------------------------------- 2. materiales
  await pagina.goto(enlace('materiales'), { waitUntil: 'networkidle' })
  await pagina.locator('#material-nueva').click()
  await pagina.getByPlaceholder('Escribe parte del nombre o del código').fill('plancha laf')
  await pagina.locator('[role="option"]').filter({ hasText: 'Plancha LAF 3 mm' }).first().click()
  await pagina.fill('#cantidad-nueva', '4,5')
  await pagina.selectOption('#plano-nueva', { label: '001 · Estructura del cajón (Maestranza)' })
  await pagina.getByRole('button', { name: 'Agregar a la lista' }).click()
  await pagina.locator('[role="status"]').filter({ hasText: 'Material agregado' }).waitFor({ timeout: 30000 })
  await pagina.waitForTimeout(1500)
  const linea = pagina.locator('[data-linea="BCO-PLA3"]')
  comprobar((await linea.count()) === 1 && (await texto(linea)).includes('4.5'), 'la línea entra con 4.5 (escrito 4,5)')
  const comparada = pagina.locator('[data-material="BCO-PLA3"]')
  comprobar((await comparada.count()) === 1 && (await texto(comparada)).includes('Sin pedir'), 'la comparación la muestra sin pedir todavía')
  await pagina.screenshot({ path: `${CAPTURAS}/360-diseno-materiales.png`, fullPage: true })

  // ---------------------------------------------------------------- 3. etapas
  await pagina.goto(enlace('etapas'), { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Cargar las etapas de siempre' }).click()
  await pagina.locator('[data-etapa="Entrega"]').waitFor({ timeout: 30000 })
  comprobar((await pagina.locator('[data-etapa]').count()) === 6, 'seis etapas de siempre')
  await pagina.getByRole('button', { name: 'Corregir la etapa Habilitado' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  const hace = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
  await ventana.locator('input[name="inicio_plan"]').fill(hace(10))
  await ventana.locator('input[name="fin_plan"]').fill(hace(2))
  await ventana.getByRole('button', { name: 'Guardar' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 30000 })
  await pagina.waitForTimeout(1500)
  comprobar((await texto(pagina.locator('[data-etapa="Habilitado"]'))).includes('Vencida hace'), 'Habilitado, con la fecha comprometida pasada, sale vencida')
  await pagina.screenshot({ path: `${CAPTURAS}/360-diseno-etapas.png`, fullPage: true })
  comprobar(errores.length === 0, `Diseño sin errores de consola${errores.length ? `: ${errores.join(' / ')}` : ''}`)
}

// ------------------------------------------------------------------ 4. Supervisor de Maestranza
let revisionMtz = null
{
  const { pagina, contexto, errores } = await entrar('sup.mtz@local.test', 390)
  await pagina.goto(`${BASE}/planos`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator(`li[data-codigo="${CODIGO}"]`)
  comprobar((await tarjeta.locator('[data-plano]').count()) === 1 && (await texto(tarjeta)).includes('Estructura del cajón'),
    'el supervisor de Maestranza ve solo su plano')
  comprobar(!(await texto(tarjeta)).includes('Bastidor'), 'y no el de Producción')
  const href = await tarjeta.getByRole('link', { name: /Abrir PDF/ }).getAttribute('href')
  revisionMtz = href
  const r = await contexto.request.get(`${BASE}${href}`, { maxRedirects: 5 })
  comprobar(r.status() === 200 && (await r.body()).subarray(0, 5).toString() === '%PDF-', 'abre el PDF del plano')
  await tarjeta.getByRole('button', { name: 'Marcar recibido el plano 001' }).click()
  await pagina.waitForTimeout(2500)
  comprobar((await texto(tarjeta)).includes('Recibido por Maestranza'), 'lo marca recibido y queda a nombre del área')

  const etapa = tarjeta.locator('[data-etapa="Habilitado"]')
  comprobar((await tarjeta.locator('[data-etapa]').count()) === 1, 've solo la etapa de su área')
  await etapa.getByRole('button', { name: 'Terminó' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.getByRole('button', { name: 'Marcar terminada' }).click()
  comprobar((await ventana.locator('textarea[name="nota"]:invalid').count()) === 1, 'terminar tarde pide el porqué antes de enviar')
  await ventana.locator('textarea[name="nota"]').fill('Faltó plancha dos días')
  await ventana.getByRole('button', { name: 'Marcar terminada' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 30000 })
  await pagina.waitForTimeout(1500)
  comprobar((await texto(etapa)).includes('Terminada') && (await texto(etapa)).includes('Faltó plancha'), 'Habilitado queda terminada con su porqué')
  const m = await menu(pagina)
  comprobar((m.find((g) => g.grupo === 'Supervisión')?.items ?? []).includes('Planos y etapas'), 'el supervisor tiene «Planos y etapas» en el menú')
  await pagina.screenshot({ path: `${CAPTURAS}/360-supervisor-mtz.png`, fullPage: true })
  comprobar(errores.length === 0, `Maestranza sin errores de consola${errores.length ? `: ${errores.join(' / ')}` : ''}`)
}

// ------------------------------------------------------------------ 5. Supervisor de Producción
{
  const { pagina, contexto } = await entrar('sup.prd@local.test')
  await pagina.goto(`${BASE}/planos`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator(`li[data-codigo="${CODIGO}"]`)
  comprobar(!(await texto(tarjeta)).includes('Estructura del cajón') && (await texto(tarjeta)).includes('Bastidor'),
    'el de Producción ve su plano y no el de Maestranza')
  const r = await contexto.request.get(`${BASE}${revisionMtz}`, { maxRedirects: 0 })
  comprobar(r.status() === 404, `y el PDF de Maestranza por su dirección no abre (${r.status()})`)
}

// ------------------------------------------------------------------ 6. Gerencia
{
  const { pagina, errores } = await entrar('gerente@local.test')
  await pagina.goto(`${BASE}/codigos-internos`, { waitUntil: 'networkidle' })
  const fila = pagina.locator(`[data-codigo="${CODIGO}"]`)
  comprobar((await texto(fila)).includes('2 planos') && (await texto(fila)).includes('Etapa Diseño y planos'), 'en la lista: sus planos y la etapa en curso')
  const detalle = `${BASE}/codigos-internos/detalle?${new URLSearchParams({ codigo: CODIGO })}`
  await pagina.goto(`${detalle}&vista=etapas`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-etapa]').count()) === 6 && (await texto(pagina.locator('[data-etapa="Habilitado"]'))).includes('Terminó'),
    'Gerencia ve las seis etapas y Habilitado terminada tarde')
  await pagina.goto(`${detalle}&vista=planos`, { waitUntil: 'networkidle' })
  comprobar((await texto(pagina.locator('section[data-area="Maestranza"]'))).includes('Recibido por Maestranza'), 've el plano recibido por Maestranza')
  await pagina.goto(`${detalle}&vista=materiales`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-material="BCO-PLA3"]').count()) === 1, 've la lista de materiales contra lo comprado')
  await pagina.screenshot({ path: `${CAPTURAS}/360-gerencia-materiales.png`, fullPage: true })
  comprobar(errores.length === 0, `Gerencia sin errores de consola${errores.length ? `: ${errores.join(' / ')}` : ''}`)
}

// ------------------------------------------------------------------ 7. Logística
{
  const { pagina, contexto } = await entrar('comprador@local.test')
  for (const ruta of ['/diseno/planos', '/planos', `/diseno/codigo?codigo=${encodeURIComponent(CODIGO)}`]) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    comprobar(pagina.url().includes('/sin-permiso'), `Logística no entra a ${ruta}`)
  }
  const r = await contexto.request.get(`${BASE}${revisionMtz}`, { maxRedirects: 0 })
  comprobar(r.status() !== 303 && r.status() !== 200, `ni al PDF por su dirección (${r.status()})`)
}

await navegador.close()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} falla(s).`)
  process.exit(1)
}
console.log('\nTodo pasa.')
