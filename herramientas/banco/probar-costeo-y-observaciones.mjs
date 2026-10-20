/**
 * Recorre con clic real el costeo por código interno y las observaciones de
 * Recursos Humanos, con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. RR. HH. registra a una persona con su costo mensual y ve lo que vale su hora.
 *   2. RR. HH. le carga horas a dos códigos internos: la ventana se queda abierta
 *      con el mismo día y código, el costo sale de su hora, un día no pasa de
 *      16 horas, tres toques dan una sola carga y una carga mal hecha se anula.
 *   3. RR. HH. registra una amonestación escrita, la ve en el resumen y en el
 *      historial de la persona, y anula una observación.
 *   4. Gerencia consulta las observaciones sin botones, y no entra al costeo ni
 *      ve el costo mensual.
 *   5. La portería no entra a ninguna de las dos.
 *
 * Variables: BANCO_CLAVE (la clave local de las cuentas), BASE
 * (http://localhost:3111), y los correos RRHH, PORTERIA y GERENCIA si no son
 * los de `*.local@metalwork.test`. Los datos son inventados.
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
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, timezoneId: 'America/Lima' })
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

/** Elige una opción en un `SeleccionBuscable` escribiendo parte de su texto. */
async function elegir(pagina, ventana, texto) {
  await ventana.getByRole('combobox').first().click()
  await pagina.keyboard.type(texto)
  await pagina.getByRole('option', { name: new RegExp(texto) }).first().click()
}

const sello = Date.now().toString().slice(-6)
const persona = { nombres: `Martín ${sello}`, apellidos: 'Prueba Costeo', dni: `6${sello}1`, cuenta: `191-${sello}-0-61` }
const nombre = `${persona.nombres} ${persona.apellidos}`
const codigoA = `PRB_SR_O4_1_26/${sello.slice(-2)}`
const codigoB = 'PLANTA'

// ------------------------------------------------ 1. RR. HH. registra con su costo
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh)
  const menu = await pagina.locator('nav a[href="/rrhh/costeo"], nav a[href="/rrhh/observaciones"]').count()
  comprobar(menu >= 2, `el menú de RR. HH. trae Costeo y Observaciones (${menu} enlaces)`)

  await pagina.goto(`${BASE}/rrhh/personal`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Registrar persona' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="nombres"]').fill(persona.nombres)
  await v.locator('input[name="apellidos"]').fill(persona.apellidos)
  await v.locator('input[name="dni"]').fill(persona.dni)
  await v.locator('input[name="cargo"]').fill('Soldador')
  await v.locator('input[name="banco"]').fill('Banco de Pruebas')
  await v.locator('input[name="numero_cuenta"]').fill(persona.cuenta)
  await v.locator('input[name="costo_mensual"]').fill('2400')
  // La fecha de ingreso es obligatoria desde #122.
  await v.locator('input[name="fecha_ingreso"]').fill(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }))
  await v.getByRole('button', { name: 'Registrar' }).click()
  await v.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  const fila = pagina.locator('tbody tr', { hasText: persona.dni })
  await fila.waitFor({ timeout: 15000 }).catch(() => {})
  const texto = limpio(await fila.textContent())
  comprobar(/Cuesta S\/\s?2,400\.00 al mes/.test(texto) && /S\/\s?10\.00 la hora/.test(texto), `RR. HH. ve su costo y su hora (${texto.slice(0, 160)})`)
  comprobar(errores.length === 0, `Personal sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------ 2. RR. HH. carga horas
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh)
  await pagina.goto(`${BASE}/rrhh/costeo`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('h1', { hasText: 'Costeo por código interno' }).count()) === 1, 'abre el costeo por código interno')

  await pagina.getByRole('button', { name: 'Cargar horas' }).click()
  const v = pagina.locator('[role="dialog"]')
  await elegir(pagina, v, persona.nombres)
  await v.locator('input[name="codigo_interno"]').fill(codigoA.toLowerCase())
  await v.locator('input[name="horas"]').fill('6.5')
  await v.locator('input[name="labor"]').fill('Soldadura de largueros')
  const vista = limpio(await v.textContent())
  comprobar(/vale S\/\s?10\.00/.test(vista) && /cuestan S\/\s?65\.00/.test(vista), `la ventana adelanta el costo (${vista.match(/La hora[^.]*\./)?.[0] ?? 'sin texto'})`)
  // Tres toques seguidos: una sola carga.
  const boton = v.getByRole('button', { name: 'Cargar horas' })
  await boton.click()
  await boton.click({ timeout: 500 }).catch(() => {})
  await boton.click({ timeout: 500 }).catch(() => {})
  await v.getByRole('status').filter({ hasText: 'cargadas a' }).waitFor({ timeout: 15000 }).catch(() => {})
  comprobar((await v.getByRole('status').filter({ hasText: codigoA }).count()) === 1, 'la ventana sigue abierta y dice dónde quedaron las horas')
  comprobar((await v.locator('input[name="codigo_interno"]').inputValue()) === codigoA, 'la carga siguiente trae el mismo código')

  // Mismo día: con 10 horas más pasaría de 16.
  await elegir(pagina, v, persona.nombres)
  await v.locator('input[name="codigo_interno"]').fill(codigoB)
  await v.locator('input[name="horas"]').fill('10')
  await v.getByRole('button', { name: 'Cargar horas' }).click()
  await v.getByRole('alert').filter({ hasText: '16 horas' }).waitFor({ timeout: 15000 }).catch(() => {})
  comprobar((await v.getByRole('alert').filter({ hasText: '16 horas' }).count()) === 1, 'un día no pasa de 16 horas')
  await v.locator('input[name="horas"]').fill('2')
  await v.getByRole('button', { name: 'Cargar horas' }).click()
  await v.getByRole('status').filter({ hasText: codigoB }).waitFor({ timeout: 15000 }).catch(() => {})
  await pagina.keyboard.press('Escape')
  await pagina.reload({ waitUntil: 'networkidle' })

  const filas = pagina.locator('tbody tr', { hasText: nombre })
  comprobar((await filas.count()) === 2, `dos cargas, no cuatro, por los toques de más (${await filas.count()})`)
  const grupo = pagina.locator(`details[data-codigo="${codigoA}"]`)
  await grupo.locator('summary').click()
  const textoGrupo = limpio(await grupo.textContent())
  comprobar(textoGrupo.includes('S/ 65.00') || textoGrupo.includes('S/65.00'), `el código suma el costo de sus horas (${textoGrupo.slice(0, 140)})`)
  comprobar(textoGrupo.includes(nombre.split(' ').reverse().join(' ')) || textoGrupo.includes(persona.apellidos), 'dentro del código sale quién trabajó')

  // Anular la de PLANTA.
  const dePlanta = pagina.locator('tbody tr', { hasText: nombre }).filter({ hasText: codigoB })
  await dePlanta.getByRole('button', { name: /^Anular/ }).click()
  const va = pagina.locator('[role="dialog"]')
  await va.locator('textarea[name="motivo"]').fill('Se cargaron por error en la prueba')
  await va.getByRole('button', { name: 'Anular' }).click()
  await va.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  await pagina.locator('tbody tr', { hasText: nombre }).filter({ hasText: 'Anulado:' }).waitFor({ timeout: 15000 }).catch(() => {})
  const anulada = limpio(await pagina.locator('tbody tr', { hasText: nombre }).filter({ hasText: codigoB }).textContent())
  comprobar(anulada.includes('Anulado: Se cargaron por error'), `la carga anulada queda con su motivo (${anulada.slice(0, 120)})`)
  comprobar(errores.length === 0, `Costeo sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await pagina.screenshot({ path: `${CAPTURAS}/rrhh-costeo.png`, fullPage: true })
  await contexto.close()
}

// ------------------------------------------------ 3. RR. HH. registra una amonestación
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh)
  await pagina.goto(`${BASE}/rrhh/observaciones`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Registrar observación' }).click()
  const v = pagina.locator('[role="dialog"]')
  await elegir(pagina, v, persona.nombres)
  await v.locator('select[name="tipo"]').selectOption('AMONESTACION_ESCRITA')
  await v.locator('select[name="motivo"]').selectOption('EPP')
  await v.locator('textarea[name="detalle"]').fill(`Soldaba sin careta en la prueba ${sello}`)
  await v.locator('input[name="codigo_interno"]').fill(codigoA)
  await v.getByRole('button', { name: 'Registrar' }).click()
  await v.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  const fila = limpio(await pagina.locator('tbody tr', { hasText: persona.nombres }).textContent())
  // Observaciones, verbales, escritas y suspensiones.
  comprobar(fila.endsWith('Soldador0010'), `el resumen cuenta la amonestación escrita (${fila.slice(0, 120)})`)
  const registro = limpio(await pagina.locator('li', { hasText: `Soldaba sin careta en la prueba ${sello}` }).textContent())
  comprobar(registro.includes('Amonestación escrita') && registro.includes('No usa su EPP') && registro.includes(codigoA), `el registro trae tipo, motivo y código (${registro.slice(0, 140)})`)

  // La suspensión pide sus días.
  await pagina.getByRole('button', { name: 'Registrar observación' }).click()
  await elegir(pagina, v, persona.nombres)
  await v.locator('select[name="tipo"]').selectOption('SUSPENSION')
  comprobar((await v.locator('input[name="dias_suspension"]').count()) === 1, 'la suspensión muestra el campo de días')
  await pagina.keyboard.press('Escape')

  // El historial de la persona.
  await pagina.locator('tbody tr', { hasText: persona.nombres }).getByRole('link').click()
  await pagina.waitForURL((u) => u.searchParams.has('persona'), { timeout: 15000 }).catch(() => {})
  await pagina.locator('h1', { hasText: 'Historial de' }).waitFor({ timeout: 15000 }).catch(() => {})
  comprobar((await pagina.locator('h1', { hasText: `Historial de ${nombre}` }).count()) === 1, 'el nombre lleva a su historial')

  await pagina.locator('li', { hasText: `Soldaba sin careta en la prueba ${sello}` }).getByRole('button', { name: /^Anular/ }).click()
  const va = pagina.locator('[role="dialog"]')
  await va.locator('textarea[name="motivo"]').fill('Era una prueba del banco local')
  await va.getByRole('button', { name: 'Anular' }).click()
  await va.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  await pagina.locator('li', { hasText: `Soldaba sin careta en la prueba ${sello}` }).filter({ hasText: 'Anulada:' }).waitFor({ timeout: 15000 }).catch(() => {})
  comprobar(limpio(await pagina.locator('li', { hasText: `Soldaba sin careta en la prueba ${sello}` }).textContent()).includes('Anulada: Era una prueba'), 'la observación anulada queda con su motivo')
  comprobar(errores.length === 0, `Observaciones sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------ 4. Gerencia consulta
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  // Desde el 2026-10-15 las observaciones salieron de su menú: las abre por su dirección.
  comprobar((await pagina.locator('nav a[href="/rrhh/observaciones"]').count()) === 0, 'Gerencia ya no tiene Observaciones en su menú')
  comprobar((await pagina.locator('nav a[href="/rrhh/costeo"]').count()) === 0, 'Gerencia no tiene Costeo en su menú')
  await pagina.goto(`${BASE}/rrhh/observaciones`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('h1', { hasText: 'Observaciones y amonestaciones' }).count()) === 1, 'Gerencia abre las observaciones')
  comprobar((await pagina.getByRole('button', { name: 'Registrar observación' }).count()) === 0, 'Gerencia no registra observaciones')
  comprobar((await pagina.getByRole('button', { name: /^Anular/ }).count()) === 0, 'Gerencia no anula observaciones')
  await pagina.goto(`${BASE}/rrhh/costeo`, { waitUntil: 'networkidle' })
  comprobar(pagina.url().includes('/sin-permiso'), `Gerencia no entra al costeo por la URL (${new URL(pagina.url()).pathname})`)
  await pagina.goto(`${BASE}/rrhh/personal`, { waitUntil: 'networkidle' })
  comprobar(!limpio(await pagina.locator('main').textContent()).includes('Cuesta S/'), 'Gerencia no ve el costo mensual')
  comprobar(errores.length === 0, `Gerencia sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------ 5. La portería no entra
{
  const { pagina, contexto } = await entrar(CUENTAS.porteria, { width: 390, height: 844 })
  for (const ruta of ['/rrhh/costeo', '/rrhh/observaciones']) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    comprobar(pagina.url().includes('/sin-permiso'), `la portería no entra a ${ruta}`)
  }
  await contexto.close()
}

await navegador.close()
if (fallas.length) {
  console.error(`\n${fallas.length} comprobaciones fallaron.`)
  process.exit(1)
}
console.log('\nTodo en orden.')
