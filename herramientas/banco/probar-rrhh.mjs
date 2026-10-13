/**
 * Recorre con clic real lo de Recursos Humanos, con la cuenta de cada puesto
 * (nunca ADMIN):
 *
 *   1. RR. HH. registra dos personas (una que siempre llega tarde y otra que
 *      nunca), ve su cuenta bancaria y ajusta la regla de tardanza.
 *   2. La portería, en tamaño de celular, no entra a «Personal», no ve ninguna
 *      cuenta, marca el ingreso de las dos y la salida de una: la tarde sale
 *      con su descuento y la otra «a tiempo».
 *   3. RR. HH. ve la tardanza y el descuento en el resumen del mes.
 *   4. Gerencia consulta la asistencia sin botones de marcar.
 *   5. Logística no ve nada de esto.
 *
 * Variables: BANCO_CLAVE (la clave local de las cuentas), BASE
 * (http://localhost:3111), y los correos RRHH, PORTERIA, GERENCIA y LOGISTICA
 * si no son los de `*.local@metalwork.test`. Los datos son inventados.
 */
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  rrhh: process.env.RRHH ?? 'rrhh.local@metalwork.test',
  porteria: process.env.PORTERIA ?? 'porteria.local@metalwork.test',
  gerencia: process.env.GERENCIA ?? 'gerencia.local@metalwork.test',
  logistica: process.env.LOGISTICA ?? 'logistica.local@metalwork.test',
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

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 })
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
const tarde = { nombres: `Tomás ${sello}`, apellidos: 'Prueba Tardón', dni: `7${sello}1`, cuenta: `191-${sello}-0-11` }
const puntual = { nombres: `Paula ${sello}`, apellidos: 'Prueba Puntual', dni: `7${sello}2`, cuenta: `0011-${sello}-22` }

async function registrar(pagina, p, entrada, salida) {
  await pagina.getByRole('button', { name: 'Registrar persona' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="nombres"]').fill(p.nombres)
  await v.locator('input[name="apellidos"]').fill(p.apellidos)
  await v.locator('input[name="dni"]').fill(p.dni)
  await v.locator('input[name="cargo"]').fill('Soldador')
  await v.locator('input[name="hora_entrada"]').fill(entrada)
  await v.locator('input[name="hora_salida"]').fill(salida)
  await v.locator('input[name="banco"]').fill('Banco de Pruebas')
  await v.locator('input[name="numero_cuenta"]').fill(p.cuenta)
  await v.getByRole('button', { name: 'Registrar' }).click()
  await v.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
}

// ------------------------------------------------ 1. RR. HH. registra
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh)
  const menu = await pagina.locator('nav a[href="/rrhh/personal"], nav a[href="/rrhh/asistencia"], nav a[href="/rrhh/tardanzas"]').count()
  comprobar(menu >= 3, `el menú de RR. HH. trae Personal, Asistencia y Tardanzas (${menu} enlaces)`)

  await pagina.goto(`${BASE}/rrhh/personal`, { waitUntil: 'networkidle' })
  // Entra a las 00:00: cualquier marca de hoy es tardanza. La otra entra a las 23:58.
  await registrar(pagina, tarde, '00:00', '18:00')
  await registrar(pagina, puntual, '23:58', '23:59')
  const fila = pagina.locator('tbody tr', { hasText: tarde.dni })
  await fila.waitFor({ timeout: 15000 }).catch(() => {})
  comprobar((await fila.count()) === 1, 'la persona registrada aparece en la lista')
  comprobar((await fila.textContent())?.includes(tarde.cuenta) ?? false, 'RR. HH. ve su número de cuenta')
  comprobar((await fila.textContent())?.includes('00:00 – 18:00') ?? false, 'RR. HH. ve su horario')

  // Corregir la ficha no la duplica.
  await fila.getByRole('button', { name: /Corregir la ficha/ }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="cargo"]').fill('Soldador homologado')
  await v.getByRole('button', { name: 'Guardar la ficha' }).click()
  await v.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  await pagina.locator('tbody tr', { hasText: tarde.dni }).filter({ hasText: 'Soldador homologado' }).waitFor({ timeout: 15000 }).catch(() => {})
  comprobar((await pagina.locator('tbody tr', { hasText: tarde.dni }).count()) === 1, 'corregir la ficha no duplica a la persona')
  comprobar(((await pagina.locator('tbody tr', { hasText: tarde.dni }).textContent()) ?? '').includes('Soldador homologado'), 'la corrección se ve')

  await pagina.goto(`${BASE}/rrhh/tardanzas`, { waitUntil: 'networkidle' })
  await pagina.locator('#regla-tolerancia').fill('0')
  await pagina.locator('#regla-descuento').fill('0.5')
  await pagina.getByRole('button', { name: 'Guardar la regla' }).click()
  await pagina.getByRole('status').filter({ hasText: 'Regla guardada' }).waitFor({ timeout: 15000 }).catch(() => {})
  await pagina.reload({ waitUntil: 'networkidle' })
  const regla = (await pagina.locator('text=minutos de tolerancia').first().textContent()) ?? ''
  comprobar(/0 minutos de tolerancia/.test(regla) && /0[.,]50/.test(regla), `la regla queda en 0 min y S/ 0,50 (${regla.slice(0, 90)})`)
  comprobar(errores.length === 0, `RR. HH. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await pagina.screenshot({ path: `${CAPTURAS}/rrhh-tardanzas-regla.png`, fullPage: true })
  await contexto.close()
}

// ------------------------------------------------ 2. La portería, en el celular
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.porteria, { width: 390, height: 844 })
  await pagina.goto(`${BASE}/rrhh/personal`, { waitUntil: 'networkidle' })
  comprobar(pagina.url().includes('/sin-permiso'), `la portería no entra a Personal (${new URL(pagina.url()).pathname})`)

  await pagina.goto(`${BASE}/rrhh/asistencia`, { waitUntil: 'networkidle' })
  const pestana = await pagina.locator('a[href="/rrhh/asistencia"]').count()
  comprobar(pestana >= 1, 'la portería tiene Asistencia en su menú')
  const cuerpo = (await pagina.locator('main').textContent()) ?? ''
  comprobar(!cuerpo.includes(tarde.cuenta) && !cuerpo.includes('Banco de Pruebas'), 'la portería no ve ninguna cuenta bancaria')

  await pagina.getByRole('searchbox', { name: 'Buscar por nombre o DNI' }).fill(tarde.dni)
  const tarjetaTarde = pagina.locator('li', { hasText: tarde.nombres })
  comprobar((await tarjetaTarde.count()) === 1, 'el buscador encuentra a la persona por DNI')
  await tarjetaTarde.getByRole('button', { name: /Marcar el ingreso/ }).click()
  await tarjetaTarde.getByText(/^Tarde /).waitFor({ timeout: 15000 }).catch(() => {})
  const textoTarde = (await tarjetaTarde.textContent()) ?? ''
  comprobar(/Tarde .*S\/\s?\d/.test(textoTarde), `el ingreso de quien entra 00:00 sale tarde con descuento (${textoTarde.replace(/\s+/g, ' ').slice(0, 120)})`)
  comprobar(await tarjetaTarde.getByRole('button', { name: /Marcar el ingreso/ }).isDisabled(), 'no se puede marcar un segundo ingreso')

  await tarjetaTarde.getByRole('button', { name: /Marcar la salida/ }).click()
  await tarjetaTarde.getByText(/Salida \d\d:\d\d/).waitFor({ timeout: 15000 }).catch(() => {})
  comprobar(/Salida \d\d:\d\d/.test((await tarjetaTarde.textContent()) ?? ''), 'la salida queda marcada con su hora')

  await pagina.getByRole('searchbox', { name: 'Buscar por nombre o DNI' }).fill(puntual.dni)
  const tarjetaPuntual = pagina.locator('li', { hasText: puntual.nombres })
  comprobar(await tarjetaPuntual.getByRole('button', { name: /Marcar la salida/ }).isDisabled(), 'sin ingreso no se puede marcar la salida')
  await tarjetaPuntual.getByRole('button', { name: /Marcar el ingreso/ }).click()
  await tarjetaPuntual.getByText('A tiempo').waitFor({ timeout: 15000 }).catch(() => {})
  comprobar(((await tarjetaPuntual.textContent()) ?? '').includes('A tiempo'), 'quien entra antes de su hora sale «a tiempo»')

  // Botones grandes, para el dedo: al menos 44 px de alto.
  const caja = await tarjetaPuntual.getByRole('button', { name: /Marcar la salida/ }).boundingBox()
  comprobar((caja?.height ?? 0) >= 44, `los botones de marcar miden ${Math.round(caja?.height ?? 0)} px de alto`)
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `la pantalla no se desborda a lo ancho en el celular (${ancho} px)`)
  comprobar(errores.length === 0, `portería sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await pagina.getByRole('searchbox', { name: 'Buscar por nombre o DNI' }).fill(String(sello))
  await pagina.screenshot({ path: `${CAPTURAS}/rrhh-porteria-celular.png`, fullPage: true })
  await contexto.close()
}

// ------------------------------------------------ 3. RR. HH. ve la tardanza del mes
{
  const { pagina, contexto } = await entrar(CUENTAS.rrhh)
  await pagina.goto(`${BASE}/rrhh/tardanzas`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: tarde.nombres })
  const texto = ((await fila.textContent()) ?? '').replace(/\s+/g, ' ')
  comprobar(/S\/\s?\d/.test(texto), `el resumen del mes trae el descuento de quien llegó tarde (${texto.slice(0, 120)})`)
  const otra = ((await pagina.locator('tbody tr', { hasText: puntual.nombres }).textContent()) ?? '').replace(/\s+/g, ' ')
  comprobar(otra.trim().endsWith('—'), `quien llegó a tiempo no tiene descuento (${otra.slice(0, 120)})`)
  await contexto.close()
}

// ------------------------------------------------ 4. Gerencia consulta
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  await pagina.goto(`${BASE}/rrhh/asistencia`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('li', { hasText: tarde.nombres }).count()) === 1, 'Gerencia ve la asistencia de hoy')
  comprobar((await pagina.getByRole('button', { name: /Marcar el ingreso/ }).count()) === 0, 'Gerencia no tiene botones de marcar')
  await pagina.goto(`${BASE}/rrhh/personal`, { waitUntil: 'networkidle' })
  const cuerpo = (await pagina.locator('main').textContent()) ?? ''
  comprobar(cuerpo.includes(tarde.dni) && !cuerpo.includes(tarde.cuenta), 'Gerencia ve al personal pero no sus cuentas')
  comprobar(errores.length === 0, `Gerencia sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------ 5. Logística no ve nada de esto
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  const menu = await pagina.locator('nav a[href^="/rrhh/"]').count()
  comprobar(menu === 0, `Logística no tiene enlaces de RR. HH. (${menu})`)
  await pagina.goto(`${BASE}/rrhh/asistencia`, { waitUntil: 'networkidle' })
  comprobar(pagina.url().includes('/sin-permiso'), 'Logística no entra a la asistencia por la URL')
  await contexto.close()
}

await navegador.close()
if (fallas.length) {
  console.error(`\n${fallas.length} comprobaciones fallaron.`)
  process.exit(1)
}
console.log('\nTodo pasa.')
