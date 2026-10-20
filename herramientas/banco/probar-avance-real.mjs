/**
 * Clic real sobre el avance de la unidad por plano y por actividad (migración
 * 20261020100000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Diseño carga tres planos con su % de la unidad: el que pasa del 100 %
 *      no entra y lo escrito no se pierde; después le baja el % a uno con
 *      «Cambiar %» y carga las etapas de siempre.
 *   2. El supervisor de Maestranza, en el teléfono, reporta el plano de su
 *      área y abre su propia actividad «Corte de materia prima» en 9 %.
 *   3. Al día siguiente la continúa: el formulario pide de 10 a 100; un 9 no
 *      pasa ni en el navegador ni en la base, ni abrir otra igual; 10 sí.
 *   4. El supervisor de Producción reporta su subcontrato sin gente propia y
 *      no ve la actividad de Maestranza.
 *   5. Gerencia ve el 22 % y de dónde sale (plano por plano y el resto por
 *      etapas) y la mano de obra en el costeo del código.
 *   6. Gerencia observa el reporte del viernes; el supervisor lo corrige: el
 *      formulario se abre sobre las mismas actividades, contadas sin el
 *      observado.
 *   7. Logística no entra al reporte diario.
 *
 * Necesita las cuentas `*.local@metalwork.test` de cada puesto. El personal,
 * el subcontrato y el código los crea el script, distintos en cada corrida.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  diseno: 'diseno.local@metalwork.test',
  mtz: 'sup.mtz.local@metalwork.test',
  prd: 'sup.prd.local@metalwork.test',
  gerencia: 'gerencia.local@metalwork.test',
  administracion: 'administracion.local@metalwork.test',
  logistica: 'logistica.local@metalwork.test',
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
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const CELULAR = { width: 390, height: 844 }

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const movil = viewport.width < 500
  const contexto = await navegador.newContext({ viewport, isMobile: movil, hasTouch: movil, timezoneId: 'America/Lima' })
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

/** Elige en el `SeleccionBuscable` de nombre accesible `etiqueta` la opción que empieza por `texto`. */
async function elegir(pagina, etiqueta, texto) {
  await pagina.getByRole('combobox', { name: etiqueta }).click()
  await pagina.keyboard.type(texto)
  await pagina.getByRole('option', { name: new RegExp(texto, 'i') }).first().click()
}

const hoy = (await consulta(`select (now() at time zone 'America/Lima')::date::text as d`))[0].d
const dia = (n) => new Date(Date.parse(`${hoy}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10)
const sello = Date.now().toString().slice(-8)
const CODIGO = `AVR${sello.slice(-4)}_SR_O4_1_26/40`
const JUAN = `Juan ${sello}`
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n')
console.log(`  · código de la prueba: ${CODIGO}`)

// ------------------------------------------------------------------ 0. el armazón
// Lo que harían RR. HH. y Administración: Juan en Maestranza con su costo
// (S/ 2,400: S/ 10 la hora) y un subcontrato de Producción para el código.
await consulta(
  `with nuevo as (
     insert into trabajadores (nombres, apellidos, dni, cargo, area_id, creado_por)
     values ($1, 'Habilitador', '7' || right($2, 7), 'Habilitador', (select id from areas where codigo = 'MTZ'),
             (select id from usuarios where correo = $3))
     returning id)
   insert into trabajador_costos (trabajador_id, costo_mensual) select id, 2400 from nuevo`,
  [JUAN, sello, 'rrhh.local@metalwork.test'],
)
const [{ ruc }] = await consulta(
  `select r as ruc from (select '10' || $1 || d as r from generate_series(0, 9) d) x where public.ruc_es_valido(r) limit 1`,
  [sello],
)
await base.query('begin')
await consulta(`select set_config('request.jwt.claim.sub', (select id::text from usuarios where correo = $1), true),
                       set_config('request.jwt.claim.role', 'authenticated', true)`, [CUENTAS.administracion])
const [{ sub }] = await consulta(`select public.guardar_subcontratista(gen_random_uuid(), $1, $2, null, null, null, null, true) as sub`, [
  ruc,
  `Soldador banco ${sello}`,
])
await consulta(
  `select public.registrar_subcontrato(gen_random_uuid(), $1, $2, 'Soldadura de refuerzos del piso', 'PEN', 3000, null, null, 'PRD')`,
  [sub, CODIGO],
)
await base.query('commit')

// ------------------------------------------------------------------ 1. Diseño reparte la unidad
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.diseno)
  const enlace = (vista) => `${BASE}/diseno/codigo?${new URLSearchParams({ codigo: CODIGO, ...(vista ? { vista } : {}) })}`
  await pagina.goto(enlace(), { waitUntil: 'networkidle' })
  comprobar(limpio(await pagina.locator('main').innerText()).includes('Quedan 100 % por repartir'), 'el formulario dice cuánto queda por repartir')

  async function cargarPlano({ numero, nombre, area, peso }) {
    await pagina.fill('#plano-numero', numero)
    await pagina.fill('#plano-nombre', nombre)
    await pagina.selectOption('#plano-area', { label: area })
    await pagina.fill('#plano-peso', peso)
    await pagina.setInputFiles('#plano-pdf', { name: `${numero}.pdf`, mimeType: 'application/pdf', buffer: PDF })
    await pagina.getByRole('button', { name: 'Cargar plano' }).click()
  }
  await cargarPlano({ numero: '001', nombre: 'Estructura del cajón', area: 'Maestranza', peso: '40' })
  await pagina.locator('[role="status"]').filter({ hasText: 'Plano 001 cargado' }).waitFor({ timeout: 30000 })
  await cargarPlano({ numero: '002', nombre: 'Bastidor', area: 'Producción', peso: '30' })
  await pagina.locator('[role="status"]').filter({ hasText: 'Plano 002 cargado' }).waitFor({ timeout: 30000 })
  await pagina.waitForTimeout(1500)
  comprobar(limpio(await pagina.locator('main').innerText()).includes('Quedan 30 % por repartir'), 'después de 40 y 30, quedan 30 %')

  await cargarPlano({ numero: '003', nombre: 'Compuerta', area: 'Acabados', peso: '40' })
  const alerta = pagina.locator('form [role="alert"]').first()
  await alerta.waitFor({ timeout: 30000 })
  comprobar(limpio(await alerta.innerText()).includes('a este le queda como mucho 30 %'), `el 003 en 40 % no entra (${limpio(await alerta.innerText())})`)
  comprobar((await pagina.inputValue('#plano-nombre')) === 'Compuerta', 'y lo escrito no se pierde')
  await pagina.fill('#plano-peso', '30')
  await pagina.setInputFiles('#plano-pdf', { name: '003.pdf', mimeType: 'application/pdf', buffer: PDF })
  await pagina.getByRole('button', { name: 'Cargar plano' }).click()
  await pagina.locator('[role="status"]').filter({ hasText: 'Plano 003 cargado' }).waitFor({ timeout: 30000 })
  await pagina.waitForTimeout(1500)
  const pesos = await consulta(`select numero, peso::float as peso from codigo_planos where codigo_interno = $1 order by numero`, [CODIGO])
  comprobar(pesos.map((p) => `${p.numero}:${p.peso}`).join(' ') === '001:40 002:30 003:30', `en la base: ${pesos.map((p) => `${p.numero} ${p.peso} %`).join(', ')}`)
  const lista = limpio(await pagina.locator('main').innerText())
  comprobar(lista.includes('Repartido entre los planos: 100 % de la unidad'), 'la lista dice que se repartió el 100 %')
  comprobar((await pagina.locator('[data-plano]', { hasText: '40 % de la unidad' }).count()) === 1, 'cada plano muestra su % de la unidad')

  // La compuerta todavía no se reparte: «Cambiar %» a 0.
  await pagina.getByRole('button', { name: 'Cambiar el % de la unidad del plano 003' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('input[name="peso"]').fill('31')
  await ventana.getByRole('button', { name: 'Guardar' }).click()
  await ventana.locator('[role="alert"]').waitFor({ timeout: 30000 })
  comprobar(limpio(await ventana.locator('[role="alert"]').innerText()).includes('como mucho 30 %'), 'cambiarlo a 31 % tampoco pasa del tope')
  await ventana.locator('input[name="peso"]').fill('0')
  await ventana.getByRole('button', { name: 'Guardar' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
  await pagina.waitForTimeout(1500)
  const [c] = await consulta(`select peso::float as peso from codigo_planos where codigo_interno = $1 and numero = '003'`, [CODIGO])
  comprobar(c.peso === 0, `la compuerta queda en 0 % (${c.peso})`)
  comprobar(limpio(await pagina.locator('main').innerText()).includes('el 30 % restante se mide por las etapas'), 'la lista dice que el 30 % restante va por etapas')
  await pagina.screenshot({ path: join(CAPTURAS, 'avance-real-diseno-planos.png'), fullPage: true })

  await pagina.goto(enlace('etapas'), { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Cargar las etapas de siempre' }).click()
  await pagina.locator('[data-etapa="Entrega"]').waitFor({ timeout: 30000 })
  comprobar((await pagina.locator('[data-etapa]').count()) === 6, 'Diseño carga las seis etapas de siempre')
  comprobar(errores.length === 0, `Diseño sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

/** Abre el formulario, pone día y código, y espera lo que se puede elegir. */
async function nuevoReporte(pagina, { fecha, asunto }) {
  await pagina.goto(`${BASE}/reportes-diarios/nuevo`, { waitUntil: 'networkidle' })
  await pagina.fill('#rd-fecha', fecha)
  await pagina.fill('#rd-codigo', CODIGO.toLowerCase())
  await pagina.fill('#rd-asunto', asunto)
  await pagina.fill('#rd-descripcion', 'Lo que se avanzó en el día en la tolva.')
  await pagina.waitForFunction(
    () => /para reportar en tu área|no tiene planos/.test(document.querySelector('[data-opciones]')?.textContent ?? ''),
    null,
    { timeout: 30000 },
  )
  return limpio(await pagina.locator('[data-opciones]').innerText())
}
async function elegirPersona(pagina, n, persona, horas) {
  await elegir(pagina, `Personal del trabajo ${n}: persona 1`, persona)
  await pagina.getByRole('spinbutton', { name: `Personal del trabajo ${n}: horas de la persona 1` }).fill(horas)
}
const avanceDe = (pagina, n) => pagina.locator(`fieldset[data-trabajo="${n}"] input[id^="rd-avance-"]`)
async function subir(pagina, boton = 'Subir reporte') {
  const antes = pagina.url()
  await pagina.getByRole('button', { name: boton }).click()
  await Promise.race([
    pagina.waitForURL(/\/reportes-diarios\/[0-9a-f-]{36}\?subido=1/, { timeout: 30000 }),
    pagina.locator('form > p[role="alert"]').waitFor({ timeout: 30000 }),
  ]).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  const id = pagina.url() !== antes ? (pagina.url().match(/reportes-diarios\/([0-9a-f-]{36})/)?.[1] ?? null) : null
  const error = id ? null : limpio(await pagina.locator('form > p[role="alert"]').innerText().catch(() => ''))
  return { id, error }
}

// ------------------------------------------------------------------ 2. Maestranza, el jueves
let idViernes = null
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.mtz, CELULAR)
  const opciones = await nuevoReporte(pagina, { fecha: dia(3), asunto: `Habilitado ${sello} jueves` })
  comprobar(opciones.includes('1 cosa para reportar'), `Maestranza ve una sola cosa en el código: su plano (${opciones})`)
  await elegir(pagina, 'Trabajo 1: sobre qué', 'Plano 001')
  comprobar(limpio(await pagina.locator('fieldset[data-trabajo="1"] [id^="rd-lleva-"]').innerText()) === 'Todavía nadie lo reportó.', 'el plano dice que nadie lo reportó')
  await avanceDe(pagina, 1).fill('20')
  await elegirPersona(pagina, 1, JUAN, '4')
  await pagina.getByRole('button', { name: 'Agregar trabajo' }).click()
  await elegir(pagina, 'Trabajo 2: sobre qué', 'Actividad nueva')
  await pagina.locator('fieldset[data-trabajo="2"] textarea').fill('Corte de materia prima')
  await avanceDe(pagina, 2).fill('9')
  await elegirPersona(pagina, 2, JUAN, '3')
  await pagina.screenshot({ path: join(CAPTURAS, 'avance-real-reporte-jueves.png'), fullPage: true })
  const r = await subir(pagina)
  comprobar(Boolean(r.id), `el reporte del jueves sube${r.error ? `: ${r.error}` : ''}`)
  const acts = await consulta(`select descripcion, plano_id is not null as de_plano from codigo_actividades where codigo_interno = $1 order by 1`, [CODIGO])
  comprobar(
    acts.length === 2 &&
      acts.some((a) => a.de_plano && a.descripcion === 'Plano 001 · Estructura del cajón') &&
      acts.some((a) => !a.de_plano && a.descripcion === 'Corte de materia prima'),
    `abre dos actividades: ${acts.map((a) => a.descripcion).join(' | ')}`,
  )

  // ---------------------------------------------------------------- 3. el viernes la continúa
  const opciones2 = await nuevoReporte(pagina, { fecha: dia(2), asunto: `Habilitado ${sello} viernes` })
  comprobar(opciones2.includes('2 cosas para reportar'), `el viernes hay dos: el plano y el corte (${opciones2})`)
  await elegir(pagina, 'Trabajo 1: sobre qué', 'Corte de materia prima')
  const lleva = limpio(await pagina.locator('fieldset[data-trabajo="1"] [id^="rd-lleva-"]').innerText())
  comprobar(lleva.includes('Iba en 9 %') && lleva.includes('de 10 a 100'), `el corte dice que iba en 9 % y pide de 10 a 100 (${lleva})`)
  comprobar((await avanceDe(pagina, 1).getAttribute('min')) === '10', 'el campo de avance no baja de 10')
  await avanceDe(pagina, 1).fill('9')
  await elegirPersona(pagina, 1, JUAN, '2')
  await pagina.getByRole('button', { name: 'Subir reporte' }).click()
  await pagina.waitForTimeout(1000)
  comprobar(pagina.url().endsWith('/reportes-diarios/nuevo') && (await avanceDe(pagina, 1).evaluate((e) => e.validity.rangeUnderflow)),
    'con 9 el navegador no deja subir')
  // Aunque se salte el navegador, la base tampoco lo deja.
  await avanceDe(pagina, 1).evaluate((e) => e.removeAttribute('min'))
  const r9 = await subir(pagina)
  comprobar(!r9.id && r9.error.includes('ya iba en 9 %') && r9.error.includes('10 % o más'), `ni la base: «${r9.error}»`)

  // Otra «Corte de materia prima» nueva tampoco: se continúa la que hay.
  await avanceDe(pagina, 1).fill('10')
  await pagina.getByRole('button', { name: 'Agregar trabajo' }).click()
  await elegir(pagina, 'Trabajo 2: sobre qué', 'Actividad nueva')
  await pagina.locator('fieldset[data-trabajo="2"] textarea').fill('corte de MATERIA prima')
  await avanceDe(pagina, 2).fill('15')
  const rDoble = await subir(pagina)
  comprobar(!rDoble.id && rDoble.error.includes('Ya hay una actividad abierta'), `abrir otra igual no entra: «${rDoble.error}»`)

  // Bien: el corte en 10 y el plano en 50.
  await elegir(pagina, 'Trabajo 2: sobre qué', 'Plano 001')
  await avanceDe(pagina, 2).fill('50')
  const rBien = await subir(pagina)
  idViernes = rBien.id
  comprobar(Boolean(rBien.id), `con 10 % el reporte del viernes sube${rBien.error ? `: ${rBien.error}` : ''}`)
  const reportes = await consulta(`select count(*)::int as n from reportes_diarios where asunto = $1`, [`Habilitado ${sello} viernes`])
  comprobar(reportes[0].n === 1, `los intentos rechazados no dejaron reportes (${reportes[0].n})`)
  comprobar(errores.length === 0, `Maestranza sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------------ 4. Producción, su subcontrato
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.prd)
  const opciones = await nuevoReporte(pagina, { fecha: dia(1), asunto: `Armado ${sello}` })
  comprobar(opciones.includes('2 cosas para reportar'), `Producción ve su plano y su subcontrato (${opciones})`)
  await pagina.getByRole('combobox', { name: 'Trabajo 1: sobre qué' }).click()
  const nombres = await pagina.getByRole('option').allInnerTexts()
  comprobar(!nombres.some((t) => t.includes('Corte de materia prima')), 'no ve la actividad de Maestranza')
  await pagina.keyboard.press('Escape')
  await elegir(pagina, 'Trabajo 1: sobre qué', 'Subcontrato')
  comprobar((await pagina.getByText('El subcontratista no va en el personal').count()) === 1, 'el subcontrato avisa que el subcontratista no va en el personal')
  await avanceDe(pagina, 1).fill('26')
  const r = await subir(pagina)
  comprobar(Boolean(r.id), `el subcontrato se reporta sin gente propia${r.error ? `: ${r.error}` : ''}`)
  if (r.id) {
    const [p] = await consulta(`select count(*)::int as n from reporte_diario_personal where reporte_id = $1`, [r.id])
    comprobar(p.n === 0, 'el reporte queda sin horas')
  }
  comprobar(errores.length === 0, `Producción sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------------ 5. Gerencia: el porcentaje y el costo
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  await pagina.goto(`${BASE}/codigos-internos/detalle?${new URLSearchParams({ codigo: CODIGO, vista: 'avance' })}`, { waitUntil: 'networkidle' })
  const como = pagina.locator('[data-como-sale]')
  const texto = limpio(await como.innerText().catch(() => ''))
  // 20 del cajón + 30 % de (0 + 10 + 26 + 0 + 0 + 0) / 6 = 20 + 1,8: el cajón no vuelve a contar en su etapa.
  comprobar(texto.includes('Cómo sale el 22 %'), `la unidad va en 22 % (${texto.slice(0, 120)})`)
  comprobar((await como.locator('[data-plano]').count()) === 3, 'con sus tres planos, cada uno con lo que aporta')
  comprobar(limpio(await como.locator('[data-plano="001"]').innerText()).includes('50%'), 'el cajón va en 50 %')
  comprobar((await como.locator('[data-resto="30"]').count()) === 1, 'y el 30 % restante por las etapas')
  comprobar(
    (await como.locator('[data-etapa="Habilitado"][data-vale="10"]').count()) === 1,
    'en las etapas, el Habilitado vale 10: solo el corte, sin volver a contar el cajón',
  )
  await pagina.screenshot({ path: join(CAPTURAS, 'avance-real-gerencia.png'), fullPage: true })

  await pagina.goto(`${BASE}/codigos-internos/detalle?${new URLSearchParams({ codigo: CODIGO, vista: 'costeo' })}`, { waitUntil: 'networkidle' })
  const [mo] = await consulta(
    `select coalesce(sum(costo), 0)::float as costo, coalesce(sum(horas), 0)::float as horas
       from tareos where public.normalizar_codigo_interno(codigo_interno) = $1 and anulado_en is null`,
    [CODIGO],
  )
  comprobar(mo.horas === 9 && mo.costo === 90, `las horas de Juan van al costo: ${mo.horas} h, S/ ${mo.costo}`)
  comprobar(limpio(await pagina.locator('main').innerText()).includes('90.00'), 'el costeo del código muestra los S/ 90.00 de mano de obra')
  comprobar(errores.length === 0, `Gerencia sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)

  // ---------------------------------------------------------------- 6. observa el viernes
  await pagina.goto(`${BASE}/reportes-diarios/${idViernes}`, { waitUntil: 'networkidle' })
  await pagina.locator('[data-observar="GERENCIA"]').click()
  await pagina.locator('[role="dialog"] textarea').fill('El cajón no llegó a 50 %, revisa el avance del plano.')
  await pagina.locator('[role="dialog"]').getByRole('button', { name: 'Observar' }).click()
  await pagina.locator('[role="dialog"]').waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
  const [o] = await consulta(`select observado_en is not null as obs from reportes_diarios where id = $1`, [idViernes])
  comprobar(o.obs, 'Gerencia observa el reporte del viernes')
  await contexto.close()
}

{
  const { pagina, contexto, errores } = await entrar(CUENTAS.mtz, CELULAR)
  await pagina.goto(`${BASE}/reportes-diarios/${idViernes}`, { waitUntil: 'networkidle' })
  await pagina.getByRole('link', { name: 'Corregir y subir de nuevo' }).click()
  await pagina.waitForURL(/corrige=/, { timeout: 30000 })
  await pagina.waitForLoadState('networkidle')
  const t1 = limpio(await pagina.locator('fieldset[data-trabajo="1"]').innerText())
  const t2 = limpio(await pagina.locator('fieldset[data-trabajo="2"]').innerText())
  comprobar(t1.includes('Corte de materia prima') && t1.includes('Iba en 9 %'), `al corregir, el corte sigue elegido y cuenta sin el observado (${t1.slice(0, 120)})`)
  comprobar(t2.includes('Plano 001') && t2.includes('Iba en 20 %'), `y el plano también, con el 20 % del jueves (${t2.slice(0, 120)})`)
  await avanceDe(pagina, 2).fill('40')
  const r = await subir(pagina, 'Subir el reporte corregido')
  comprobar(Boolean(r.id), `el corregido sube${r.error ? `: ${r.error}` : ''}`)
  const filas = await consulta(
    `select (select anulado_en is not null from reportes_diarios where id = $1) as anulado,
            (select count(distinct actividad_id)::int from reporte_diario_trabajos t join reportes_diarios r on r.id = t.reporte_id
              where r.codigo_interno = $2 and r.registrado_por = (select id from usuarios where correo = $3)) as actividades`,
    [idViernes, CODIGO, CUENTAS.mtz],
  )
  comprobar(filas[0].anulado && filas[0].actividades === 2, `el observado queda anulado y todo sigue en las mismas dos actividades (${filas[0].actividades})`)
  comprobar(errores.length === 0, `la corrección sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// Con el cajón corregido a 40 %: 16 + 30 % de (0 + 10 + 26 + 0 + 0 + 0) / 6 = 16 + 1,8 = 18 %.
{
  const { pagina, contexto } = await entrar(CUENTAS.gerencia)
  await pagina.goto(`${BASE}/codigos-internos/detalle?${new URLSearchParams({ codigo: CODIGO, vista: 'avance' })}`, { waitUntil: 'networkidle' })
  const texto = limpio(await pagina.locator('[data-como-sale]').innerText().catch(() => ''))
  comprobar(texto.includes('Cómo sale el 18 %'), `con la corrección, la unidad va en 18 % (${texto.slice(0, 60)})`)
  await contexto.close()
}

// ------------------------------------------------------------------ 7. Logística no entra
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/reportes-diarios/nuevo`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('#rd-codigo').count()) === 0, `Logística no abre el formulario (${new URL(pagina.url()).pathname})`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo bien.' : `\n${fallas.length} fallas.`)
process.exit(fallas.length === 0 ? 0 : 1)
