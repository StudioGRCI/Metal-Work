/**
 * Recorre con clic real lo del área de Requerimientos, con la cuenta de cada
 * puesto (nunca ADMIN):
 *
 *   1. Requerimientos registra un RQ con dos insumos y lo ve en su lista.
 *   2. Registra el ingreso de un vehículo, lo ve en planta y marca su salida.
 *   3. Logística ve el RQ por atender, sin el botón de registrar.
 *   4. Gerencia ve el historial de vehículos, sin el botón de registrar.
 *
 * Variables: BANCO_CLAVE (la clave local de las cuentas), BASE
 * (http://localhost:3111), y los correos REQUERIMIENTOS, LOGISTICA y GERENCIA
 * si no son los de `*.local@metalwork.test`.
 */
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  requerimientos: process.env.REQUERIMIENTOS ?? 'requerimientos.local@metalwork.test',
  logistica: process.env.LOGISTICA ?? 'logistica.local@metalwork.test',
  gerencia: process.env.GERENCIA ?? 'gerencia.local@metalwork.test',
}
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo) {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } })
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

const sello = Date.now().toString().slice(-6)
const codigo = `PLA_SR_O4_1_26/${sello.slice(-2)}`

// ------------------------------------------------ 1. Requerimientos: el RQ
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos)
  const menu = await pagina.locator('nav a[href="/requerimientos"], nav a[href="/vehiculos"]').count()
  comprobar(menu >= 2, `el menú de Requerimientos trae RQ y Vehículos (${menu} enlaces)`)

  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  const filasRq = pagina.locator('tbody tr', { hasText: /RQ-\d/ })
  const antes = await filasRq.count()
  await pagina.getByRole('button', { name: 'Nuevo requerimiento' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('#rq-area').selectOption({ label: 'Maestranza' })
  await ventana.locator('#rq-codigo').fill(codigo)
  await ventana.locator('#rq-justificacion').fill('Armado del chasis de la plataforma; no hay planchas en almacén.')
  // Primer insumo
  const descs = ventana.locator('input[name="descripcion"]')
  await descs.nth(0).fill('Plancha LAF 2 mm 4x8')
  await ventana.locator('input[name="cantidad"]').nth(0).fill('3')
  await ventana.locator('select[name="categoria_id"]').nth(0).selectOption({ index: 1 })
  // Segundo insumo
  await ventana.getByRole('button', { name: 'Agregar insumo' }).click()
  await descs.nth(1).fill('Soldadura MIG 0.9 mm')
  await ventana.locator('input[name="cantidad"]').nth(1).fill('12.5')
  await ventana.locator('select[name="unidad_medida_id"]').nth(1).selectOption({ label: 'KG' })
  await ventana.locator('select[name="categoria_id"]').nth(1).selectOption({ index: 2 })
  // Tres toques: un solo RQ.
  const enviar = ventana.getByRole('button', { name: 'Registrar y mandar a Logística' })
  await enviar.click()
  await enviar.click({ timeout: 1000 }).catch(() => {})
  await enviar.click({ timeout: 1000 }).catch(() => {})
  await pagina.locator('[role="status"]').waitFor({ timeout: 20000 })
  const aviso = await pagina.locator('[role="status"]').innerText()
  comprobar(/Requerimiento RQ-\d{4}-\d{4} registrado/.test(aviso), `aviso: «${aviso}»`)
  await filasRq.nth(antes).waitFor({ timeout: 20000 })
  // Un momento más por si un segundo envío colado tardara en pintarse.
  await pagina.waitForTimeout(1500)
  const despues = await filasRq.count()
  comprobar(despues === antes + 1, `la lista suma un solo RQ aunque se tocó tres veces (${antes} → ${despues})`)
  const fila = await pagina.locator('tbody tr').first().innerText()
  comprobar(fila.includes(codigo) && fila.includes('Maestranza') && fila.includes('Plancha LAF') && fila.includes('Soldadura MIG') && fila.includes('Por atender'),
    `la fila trae código, área, los dos insumos y «Por atender»: ${fila.replace(/\s+/g, ' ').slice(0, 220)}`)
  await pagina.screenshot({ path: `${CAPTURAS}/requerimientos.png`, fullPage: true })

  // ---------------------------------------------- 2. Vehículos
  await pagina.goto(`${BASE}/vehiculos`, { waitUntil: 'networkidle' })
  const placa = `T${sello.slice(-2)}-${sello.slice(0, 3)}`
  await pagina.getByRole('button', { name: 'Registrar ingreso' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('#veh-placa').fill(placa.toLowerCase())
  await v.locator('#veh-codigo').fill(codigo)
  await v.locator('#veh-unidad').fill('Tolva 18 m3 Volvo FMX')
  await v.locator('#veh-empresa').fill('ING. Y CONST. ACOSTA')
  await v.locator('#veh-motivo').selectOption('MANTENIMIENTO')
  await v.locator('#veh-obs').fill('Ingresa con llanta baja')
  await v.getByRole('button', { name: 'Registrar ingreso' }).click()
  await pagina.locator('[role="status"]').waitFor({ timeout: 20000 })
  const placaGuardada = placa.replace('-', '').toUpperCase()
  const enPlanta = pagina.locator('tbody tr', { hasText: placaGuardada })
  await enPlanta.first().waitFor({ timeout: 20000 }).catch(() => {})
  comprobar((await enPlanta.count()) === 1, `el vehículo ${placaGuardada} figura en planta`)
  comprobar((await enPlanta.innerText()).includes('En planta'), 'con la insignia «En planta»')

  await enPlanta.getByRole('button', { name: 'Marcar salida' }).click()
  await pagina.locator('[role="dialog"] textarea[name="observacion"]').fill('Sale al arenado externo')
  await pagina.locator('[role="dialog"]').getByRole('button', { name: 'Registrar salida' }).click()
  await pagina.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 20000 })
  await enPlanta.first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  comprobar((await pagina.locator('tbody tr', { hasText: placaGuardada }).count()) === 0, 'al salir deja de figurar en planta')
  await pagina.goto(`${BASE}/vehiculos?vista=historial`, { waitUntil: 'networkidle' })
  const historial = await pagina.locator('tbody tr', { hasText: placaGuardada }).innerText()
  comprobar(historial.includes('Sale al arenado externo') && historial.includes('Mantenimiento'), `en el historial con su salida: ${historial.replace(/\s+/g, ' ').slice(0, 200)}`)
  await pagina.screenshot({ path: `${CAPTURAS}/vehiculos.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola como Requerimientos ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 3. Logística
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: codigo })
  comprobar((await fila.count()) === 1, 'Logística ve el RQ recién registrado')
  comprobar((await pagina.getByRole('button', { name: 'Nuevo requerimiento' }).count()) === 0, 'Logística no tiene «Nuevo requerimiento»')
  comprobar((await fila.getByRole('button', { name: 'Anular' }).count()) === 0, 'ni «Anular»')
  const avisos = await pagina.goto(`${BASE}/avisos`, { waitUntil: 'networkidle' }).then(() => pagina.locator('body').innerText())
  comprobar(avisos.includes('Requerimiento por atender'), 'a Logística le llegó el aviso')
  comprobar(errores.length === 0, `sin errores de consola como Logística ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 4. Gerencia
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  await pagina.goto(`${BASE}/vehiculos?vista=historial`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('tbody tr', { hasText: 'ACOSTA' }).count()) >= 1, 'Gerencia ve el historial de vehículos')
  comprobar((await pagina.getByRole('button', { name: 'Registrar ingreso' }).count()) === 0, 'Gerencia no registra ingresos')
  comprobar(errores.length === 0, `sin errores de consola como Gerencia ${errores.join(' | ')}`)
  await contexto.close()
}

await navegador.close()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} comprobación(es) fallaron.`)
  process.exit(1)
}
console.log('\nTodo bien: RQ y vehículos con clic real.')
