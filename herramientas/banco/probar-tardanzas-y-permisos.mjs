/**
 * Recorre con clic real la tardanza por veces y los permisos de RR. HH., con la
 * cuenta de cada puesto (nunca ADMIN):
 *
 *   1. RR. HH. ve Permisos en su menú justo después de Tardanzas. En el mes
 *      anterior, Ana llegó tarde 7 veces (dos grupos de tres: 10 % de S/ 3 000,
 *      S/ 300) y Beto 2 (no descuenta: le falta 1). Ajusta la regla con sus tres
 *      campos.
 *   2. RR. HH. registra un permiso de 4 h para Ana y otro de 2 h para Beto. Ana
 *      tiene 3 h extras reservadas: justifica con lo que propone la ventana (3 h)
 *      y le falta 1 h; Beto no tiene saldo. Horas extras muestra las 3 h usadas
 *      en «Permiso del …». Un tercer permiso se anula con motivo.
 *   3. En el celular, la pantalla de permisos no se desborda.
 *   4. La portería marca el ingreso de quien entra a las 00:00: sale «Tarde»,
 *      sin soles.
 *   5. Gerencia ve el 10 % sin el monto y los permisos sin botones;
 *      Administración ve lo justificado igual que RR. HH. aunque no lee el uso
 *      del saldo. Logística no entra.
 *
 * Necesita en la base del banco las cuentas `*.local@metalwork.test` de RR. HH.,
 * portería, Gerencia, Administración y Logística. El personal, sus marcas del
 * mes anterior y sus horas reservadas los crea el script, inventados y
 * distintos en cada corrida. Variables: BANCO_CLAVE, BASE
 * (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  rrhh: process.env.RRHH ?? 'rrhh.local@metalwork.test',
  porteria: process.env.PORTERIA ?? 'porteria.local@metalwork.test',
  gerencia: process.env.GERENCIA ?? 'gerencia.local@metalwork.test',
  administracion: process.env.ADMINISTRACION ?? 'administracion.local@metalwork.test',
  logistica: process.env.LOGISTICA ?? 'logistica.local@metalwork.test',
}
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

// ------------------------------------------------ los datos de la prueba
const sello = Date.now().toString().slice(-6)
const ana = { id: crypto.randomUUID(), nombres: `Ana ${sello}`, apellidos: 'Prueba Tardía', dni: `5${sello}1` }
const beto = { id: crypto.randomUUID(), nombres: `Beto ${sello}`, apellidos: 'Prueba Casi', dni: `5${sello}2` }
const tomas = { id: crypto.randomUUID(), nombres: `Tomás ${sello}`, apellidos: 'Prueba Madrugada', dni: `5${sello}3` }

const [{ id: rrhhId }] = await consulta('select id from public.usuarios where correo = $1', [CUENTAS.rrhh])
const [{ hoy }] = await consulta(`select to_char((now() at time zone 'America/Lima')::date, 'YYYY-MM-DD') as hoy`)
const [anio, mesHoy] = hoy.split('-').map(Number)
const mesAnterior = mesHoy === 1 ? `${anio - 1}-12` : `${anio}-${String(mesHoy - 1).padStart(2, '0')}`

// La ficha y la remuneración entran por las funciones, con la sesión de RR. HH.
await base.query('begin')
await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)`, [rrhhId])
await base.query('set local role authenticated')
for (const [p, entrada, remuneracion] of [
  [ana, '08:00', 3000],
  [beto, '08:00', 2000],
  [tomas, '00:00', null],
]) {
  await base.query(
    `select public.rrhh_guardar_trabajador($1, $2, $3, $4, 'Soldador', null, $5, '18:00', 'Banco de Pruebas', 'AHORROS', $6, null)`,
    [p.id, p.nombres, p.apellidos, p.dni, entrada, `191-${p.dni}`],
  )
  if (remuneracion) await base.query('select public.rrhh_guardar_remuneracion_trabajador($1, $2)', [p.id, remuneracion])
}
await base.query('commit')

// Las marcas del mes anterior y las horas reservadas se cargan a mano: la
// portería solo marca hoy y las extras salen de reportes validados (eso lo
// recorre probar-planilla-diaria.mjs).
for (let d = 1; d <= 7; d++) {
  await consulta(
    `insert into public.asistencias (trabajador_id, fecha, tipo, hora, tardanza_minutos, es_tardanza, registrado_por)
     values ($1, $2, 'INGRESO', '08:20', 20, true, $3)`,
    [ana.id, `${mesAnterior}-${String(d).padStart(2, '0')}`, rrhhId],
  )
}
for (const d of ['01', '02']) {
  await consulta(
    `insert into public.asistencias (trabajador_id, fecha, tipo, hora, tardanza_minutos, es_tardanza, registrado_por)
     values ($1, $2, 'INGRESO', '08:10', 10, true, $3)`,
    [beto.id, `${mesAnterior}-${d}`, rrhhId],
  )
}
await consulta(
  `insert into public.horas_extras_decisiones (trabajador_id, fecha, horas, horas_tramo1, horas_tramo2, decision, registrado_por)
   values ($1, $2, 3, 2, 1, 'RESERVAR', $3)`,
  [ana.id, `${mesAnterior}-15`, rrhhId],
)

// ------------------------------------------------ el navegador
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

/** Elige una opción en un `SeleccionBuscable` escribiendo parte de su texto. */
async function elegir(pagina, ventana, texto) {
  await ventana.getByRole('combobox').first().click()
  await pagina.keyboard.type(texto)
  await pagina.getByRole('option', { name: new RegExp(texto) }).first().click()
}

const texto = async (localizador) => ((await localizador.first().textContent()) ?? '').replace(/\s+/g, ' ').trim()
/** El texto de cada celda de una fila, para no leer «Soldador77» pegado. */
const celdas = async (fila) => (await fila.first().locator('td').allTextContents()).map((c) => c.replace(/\s+/g, ' ').trim())
/** Espera a que la pantalla se repinte con el texto esperado; la acción vuelve antes que el refresco. */
const esperar = (localizador, conTexto) => localizador.filter({ hasText: conTexto }).first().waitFor({ timeout: 15000 }).catch(() => {})

async function registrarPermiso(pagina, persona, horas, motivo) {
  await pagina.getByRole('button', { name: 'Registrar permiso' }).click()
  const v = pagina.locator('[role="dialog"]')
  await elegir(pagina, v, persona.nombres)
  await v.locator('input[name="horas"]').fill(String(horas))
  await v.locator('textarea[name="motivo"]').fill(motivo)
  await v.getByRole('button', { name: 'Registrar', exact: true }).click()
  await v.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  await esperar(pagina.locator('[data-por-justificar] tr'), persona.nombres)
}

// ------------------------------------------------ 1. RR. HH.: tardanzas del mes
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh)
  const enlaces = await pagina.locator('aside nav[aria-label="Menú principal"] a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  const t = enlaces.indexOf('/rrhh/tardanzas')
  comprobar(t >= 0 && enlaces[t + 1] === '/rrhh/permisos', `Permisos va justo después de Tardanzas en el menú de RR. HH. (${enlaces.slice(t, t + 3).join(' → ')})`)

  await pagina.goto(`${BASE}/rrhh/tardanzas?mes=${mesAnterior}`, { waitUntil: 'networkidle' })
  // Persona | Días | Tardanzas | Minutos | Descuento
  const [, diasAna, vecesAna, , descuentoAna] = await celdas(pagina.locator(`tr[data-tardanzas="${ana.dni}"]`))
  comprobar(
    diasAna === '7' && vecesAna.startsWith('7') && descuentoAna.startsWith('10 %') && /S\/\s?300[.,]00/.test(descuentoAna),
    `Ana: 7 tardanzas, 10 %, S/ 300.00 (${diasAna} · ${vecesAna} · ${descuentoAna})`,
  )
  const [, , vecesBeto, , descuentoBeto] = await celdas(pagina.locator(`tr[data-tardanzas="${beto.dni}"]`))
  comprobar(vecesBeto === '2Le falta 1 para el descuento' && descuentoBeto === '—', `Beto: 2 tardanzas no descuentan (${vecesBeto} · ${descuentoBeto})`)
  const descripcion = await texto(pagina.locator('main p', { hasText: 'Cada 3 tardanzas' }))
  comprobar(descripcion.includes('5 %'), `la pantalla dice la regla (${descripcion.slice(0, 120)})`)

  await pagina.locator('#regla-tolerancia').fill('5')
  await pagina.locator('#regla-veces').fill('3')
  await pagina.locator('#regla-porcentaje').fill('5')
  await pagina.getByRole('button', { name: 'Guardar la regla' }).click()
  await pagina.getByRole('status').filter({ hasText: 'Regla guardada' }).waitFor({ timeout: 15000 }).catch(() => {})
  comprobar((await pagina.getByRole('status').filter({ hasText: 'Regla guardada' }).count()) === 1, 'la regla se guarda con sus tres campos')
  await pagina.screenshot({ path: `${CAPTURAS}/rrhh-tardanzas-por-veces.png`, fullPage: true })

  // ---------------------------------------------- 2. permisos
  await pagina.goto(`${BASE}/rrhh/permisos`, { waitUntil: 'networkidle' })
  await registrarPermiso(pagina, ana, 4, `Cita médica en EsSalud ${sello}`)
  await registrarPermiso(pagina, beto, 2, 'Trámite en la municipalidad a mediodía')
  await registrarPermiso(pagina, tomas, 1, 'Permiso que se registró por error')

  const pendienteAna = pagina.locator('[data-por-justificar] tr', { hasText: ana.nombres })
  await pendienteAna.waitFor({ timeout: 15000 }).catch(() => {})
  comprobar((await texto(pendienteAna)).includes('4 h'), `el permiso de Ana queda por justificar con 4 h (${await texto(pendienteAna)})`)
  const pendienteBeto = pagina.locator('[data-por-justificar] tr', { hasText: beto.nombres })
  comprobar((await pendienteBeto.getByText('Sin horas reservadas').count()) === 1, 'Beto no tiene horas reservadas: no hay botón de justificar')

  await pendienteAna.getByRole('button', { name: 'Justificar' }).click()
  const v = pagina.locator('[role="dialog"]')
  const propuesto = await v.locator('input[name="horas"]').inputValue()
  comprobar(propuesto === '3', `la ventana propone lo que su saldo cubre: 3 h (${propuesto})`)
  await v.getByRole('button', { name: 'Justificar con horas extras' }).click()
  await v.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  await esperar(pagina.locator('[data-por-justificar] tr', { hasText: ana.nombres }), 'ya justificó')
  const tras = await texto(pagina.locator('[data-por-justificar] tr', { hasText: ana.nombres }))
  comprobar(/1 h/.test(tras) && tras.includes('ya justificó 3 h'), `justificado 3 h, le falta 1 h (${tras})`)

  // El tercero se anula con motivo.
  const registroTomas = pagina.locator(`li[data-registro-permiso="${tomas.nombres} ${tomas.apellidos}"]`)
  await registroTomas.getByRole('button', { name: /Anular/ }).click()
  await v.locator('textarea[name="motivo"]').fill('Se registró a la persona equivocada')
  await v.getByRole('button', { name: 'Anular', exact: true }).click()
  await v.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  await esperar(registroTomas, 'Anulado')
  comprobar((await texto(registroTomas)).includes('Anulado'), `el permiso anulado queda con su motivo (${await texto(registroTomas)})`)
  comprobar((await pagina.locator('[data-por-justificar] tr', { hasText: tomas.nombres }).count()) === 0, 'el anulado ya no está por justificar')
  await pagina.screenshot({ path: `${CAPTURAS}/rrhh-permisos.png`, fullPage: true })

  await pagina.goto(`${BASE}/rrhh/horas-extras`, { waitUntil: 'networkidle' })
  const saldo = await texto(pagina.locator(`tr[data-saldo="${ana.nombres} ${ana.apellidos}"]`))
  comprobar(/3 h/.test(saldo) && /0 h/.test(saldo), `Horas extras: Ana reservó 3 h y usó 3 h (${saldo})`)
  comprobar(
    (await pagina.getByText(new RegExp(`Permiso del \\d\\d/\\d\\d/\\d{4}: Cita médica en EsSalud ${sello}`)).count()) === 1,
    'el uso del saldo dice para qué permiso fue',
  )
  comprobar(errores.length === 0, `RR. HH. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------ 3. En el celular
{
  const { pagina, contexto } = await entrar(CUENTAS.rrhh, { width: 390, height: 844 })
  await pagina.goto(`${BASE}/rrhh/permisos`, { waitUntil: 'networkidle' })
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `Permisos no se desborda a lo ancho en el celular (${ancho} px)`)
  await pagina.screenshot({ path: `${CAPTURAS}/rrhh-permisos-celular.png`, fullPage: true })
  await pagina.goto(`${BASE}/rrhh/tardanzas?mes=${mesAnterior}`, { waitUntil: 'networkidle' })
  const anchoT = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(anchoT <= 390, `Tardanzas no se desborda a lo ancho en el celular (${anchoT} px)`)
  await contexto.close()
}

// ------------------------------------------------ 4. La portería
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.porteria, { width: 390, height: 844 })
  await pagina.goto(`${BASE}/rrhh/asistencia`, { waitUntil: 'networkidle' })
  await pagina.getByRole('searchbox', { name: 'Buscar por nombre o DNI' }).fill(tomas.dni)
  const tarjeta = pagina.locator('li', { hasText: tomas.nombres })
  await tarjeta.getByRole('button', { name: /Marcar el ingreso/ }).click()
  await tarjeta.getByText(/^Tarde /).waitFor({ timeout: 15000 }).catch(() => {})
  const marca = await texto(tarjeta)
  comprobar(/Tarde \d/.test(marca) && !marca.includes('S/'), `quien entra a las 00:00 sale tarde, sin soles (${marca.slice(0, 120)})`)
  comprobar(errores.length === 0, `portería sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------ 5. Quien consulta y quien no
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  await pagina.goto(`${BASE}/rrhh/tardanzas?mes=${mesAnterior}`, { waitUntil: 'networkidle' })
  const [, , , , descuentoAna] = await celdas(pagina.locator(`tr[data-tardanzas="${ana.dni}"]`))
  comprobar(descuentoAna === '10 %', `Gerencia ve el 10 % sin el monto (${descuentoAna})`)
  comprobar((await pagina.getByRole('button', { name: 'Guardar la regla' }).count()) === 0, 'Gerencia no cambia la regla')
  await pagina.goto(`${BASE}/rrhh/permisos`, { waitUntil: 'networkidle' })
  comprobar(!pagina.url().includes('/sin-permiso'), 'Gerencia abre Permisos por su dirección')
  comprobar((await pagina.locator('[data-por-justificar] tr', { hasText: ana.nombres }).count()) === 1, 'Gerencia ve el permiso de Ana')
  comprobar(
    (await pagina.getByRole('button', { name: /Registrar permiso|Justificar|Anular/ }).count()) === 0,
    'Gerencia no tiene botones para registrar, justificar ni anular',
  )
  comprobar(errores.length === 0, `Gerencia sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.administracion)
  await pagina.goto(`${BASE}/rrhh/permisos`, { waitUntil: 'networkidle' })
  const fila = await texto(pagina.locator('[data-por-justificar] tr', { hasText: ana.nombres }))
  comprobar(fila.includes('ya justificó 3 h'), `Administración ve lo justificado igual que RR. HH. (${fila})`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/rrhh/permisos`, { waitUntil: 'networkidle' })
  comprobar(pagina.url().includes('/sin-permiso'), 'Logística no entra a Permisos por la URL')
  await contexto.close()
}

await navegador.close()
await base.end()
if (fallas.length) {
  console.error(`\n${fallas.length} comprobaciones fallaron.`)
  process.exit(1)
}
console.log('\nTodo pasa.')
