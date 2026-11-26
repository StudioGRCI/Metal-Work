/**
 * Clic real sobre «Sin reporte de hoy» en /planos (Plan 1, entrega 1.3): el
 * supervisor ve arriba de «Planos y etapas» los códigos con una etapa de su
 * área en marcha que todavía no tienen el reporte diario de hoy, con el plazo
 * del semáforo de la etapa y un botón que abre el reporte con el código puesto.
 * Con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Arma en el banco unidades con etapas: de Maestranza, una vencida y
 *      sin reporte, una ya reportada hoy, una que empieza en tres días, una
 *      con solo la fecha comprometida (vencida, sin «Empezó») y una que
 *      empieza hoy, sin reporte, que se reporta a media prueba; y una de
 *      Acabados en marcha.
 *   2. sup.mtz ve en la bandeja la vencida, la de solo fecha comprometida y la
 *      que empieza hoy, la más atrasada arriba, con el plazo del tablero de
 *      tiempos de entrega en días hábiles (el que da la base); no la
 *      reportada, ni la que no empieza, ni la de Acabados. El código lleva a
 *      su tarjeta.
 *   3. «Subir el reporte» abre /reportes-diarios/nuevo con el código puesto.
 *   4. Reportada la quinta, sale de la bandeja; con búsqueda o en otra pestaña
 *      la bandeja no está.
 *   5. sup.acb ve la suya y ninguna de Maestranza.
 *   6. En el teléfono (390) nada se sale de la pantalla. Capturas en 390 y 1440.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * BANCO_CHROMIUM, CAPTURAS.
 */
import { mkdirSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { conReact } from './con-react.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
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
const correoDe = (puesto) => `${puesto}.local@metalwork.test`

/** Escribe el armazón sin disparadores: lo que la prueba mira es la pantalla, no cómo se registra. */
async function armazon(sql, valores = []) {
  await base.query('begin')
  try {
    await base.query('set local session_replication_role = replica')
    const filas = (await base.query(sql, valores)).rows
    await base.query('commit')
    return filas
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

const [{ hoy }] = await consulta(`select ((now() at time zone 'America/Lima')::date)::text as hoy`)
const [{ taller }] = await consulta('select public.es_laborable($1::date) as taller', [hoy])
if (!taller) {
  console.log(`Hoy (${hoy}) no es día de taller en el banco: la bandeja no sale y no hay qué probar.`)
  process.exit(0)
}
const cuenta = async (puesto) => {
  const [fila] = await consulta('select id, area_id from public.usuarios where correo = $1', [correoDe(puesto)])
  if (!fila) throw new Error(`El banco no tiene la cuenta ${correoDe(puesto)}: corre preparar.sh.`)
  return fila
}
const mtz = await cuenta('sup.mtz')
const acb = await cuenta('sup.acb')

// ------------------------------------------------ el armazón
// Cada unidad: código, placa, área, fechas (días desde hoy) y si ya tiene reporte de hoy.
const UNIDADES = [
  { codigo: 'QA-ETAPA-VENCIDA', placa: 'Q1A-131', de: mtz, etapa: 'Armado de chasis (prueba 1.3)', inicio_real: -5, fin_plan: -2, reportada: false },
  { codigo: 'QA-ETAPA-REPORTADA', placa: 'Q1A-132', de: mtz, etapa: 'Soldadura de piso (prueba 1.3)', inicio_plan: -1, fin_plan: 10, reportada: true },
  { codigo: 'QA-ETAPA-FUTURA', placa: 'Q1A-133', de: mtz, etapa: 'Forrado (prueba 1.3)', inicio_plan: 3, fin_plan: 8, reportada: false },
  { codigo: 'QA-ETAPA-ACABADOS', placa: 'Q1A-134', de: acb, etapa: 'Pintura (prueba 1.3)', inicio_real: -1, fin_plan: 1, reportada: false },
  { codigo: 'QA-ETAPA-LUEGO', placa: 'Q1A-135', de: mtz, etapa: 'Puertas (prueba 1.3)', inicio_plan: 0, fin_plan: 6, reportada: false },
  // Como las carga Diseño muchas veces: solo la fecha comprometida, ya vencida, y nadie marcó «Empezó».
  { codigo: 'QA-ETAPA-SOLOFIN', placa: 'Q1A-136', de: mtz, etapa: 'Ensamblaje (prueba 1.3)', fin_plan: -3, reportada: false },
]
const dia = (n) => (n === undefined ? null : n)
for (const u of UNIDADES) {
  await armazon(
    `insert into public.unidades (placa, marca, modelo, codigo_interno)
     select $1, 'VOLVO', 'FMX 440 (prueba 1.3)', $2 where not exists (select 1 from public.unidades where codigo_interno = $2)`,
    [u.placa, u.codigo],
  )
  // La etapa, con las fechas de hoy aunque la prueba se haya corrido otro día.
  const fechas = [dia(u.inicio_plan), dia(u.fin_plan), dia(u.inicio_real)]
  const hay = await consulta(`select id from public.codigo_etapas where codigo_interno = $1 and quitada_en is null`, [u.codigo])
  if (hay.length === 0) {
    await armazon(
      `insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_plan, fin_plan, inicio_real, creado_por, de_area)
       values ($1, 1, $2, $3, $4::date + $5::int, $4::date + $6::int, $4::date + $7::int, $8, true)`,
      [u.codigo, u.etapa, u.de.area_id, hoy, ...fechas, u.de.id],
    )
  } else {
    await armazon(
      `update public.codigo_etapas set inicio_plan = $2::date + $3::int, fin_plan = $2::date + $4::int, inicio_real = $2::date + $5::int, fin_real = null
        where id = $1`,
      [hay[0].id, hoy, ...fechas],
    )
  }
  // Ninguna lleva reporte de hoy, salvo la que debe: lo de otra corrida se anula.
  await armazon(
    `update public.reportes_diarios set anulado_en = now(), anulado_por = $2, motivo_anulacion = 'Prueba 1.3: se rehace'
      where codigo_interno = $1 and anulado_en is null`,
    [u.codigo, u.de.id],
  )
  if (u.reportada) await reportar(u)
}
async function reportar(u) {
  await armazon(
    `insert into public.reportes_diarios (fecha, codigo_interno, asunto, descripcion, area_id, registrado_por)
     values ($1::date, $2, 'Avance del día (prueba 1.3)', 'Se avanzó la etapa.', $3, $4)`,
    [hoy, u.codigo, u.de.area_id, u.de.id],
  )
}
const de = (codigo) => UNIDADES.find((u) => u.codigo === codigo)

// La base, como la lee la pantalla: el último reporte de cada etapa (`ultimo_reporte`).
const ultimos = await consulta(
  `select codigo, ultimo_reporte::text as ultimo from public.codigo_interno_etapas_calculado(null) where codigo like 'QA-ETAPA-%'`,
)
comprobar(ultimos.find((e) => e.codigo === 'QA-ETAPA-REPORTADA')?.ultimo === hoy, 'la base da el reporte de hoy en la etapa de la reportada')
comprobar(ultimos.find((e) => e.codigo === 'QA-ETAPA-VENCIDA')?.ultimo !== hoy, 'la base no da reporte de hoy en la vencida')

// El semáforo del tablero de RR. HH. para cada etapa: lo que la bandeja tiene que decir, en días hábiles.
const semaforo = Object.fromEntries(
  (
    await consulta(`select codigo, semaforo, dias_habiles from public.tiempos_de_entrega_etapas_calculado(null) where codigo like 'QA-ETAPA-%'`)
  ).map((e) => [e.codigo, e]),
)
const habiles = (n) => `${n} ${n === 1 ? 'día hábil' : 'días hábiles'}`
const plazoDe = (codigo) => {
  const { semaforo: s, dias_habiles: d } = semaforo[codigo]
  return s === 'ROJO' ? `Vencida hace ${habiles(-d)}` : s === 'VERDE' ? `Faltan ${habiles(d)}` : d === 0 ? 'Vence hoy' : `Vence en ${habiles(d)}`
}
// El orden esperado: el peor color y, a igual color, menos días hábiles.
const PESO = { ROJO: 0, AMBAR: 1, VERDE: 2 }
const esperados = ['QA-ETAPA-VENCIDA', 'QA-ETAPA-LUEGO', 'QA-ETAPA-SOLOFIN'].sort(
  (a, b) => PESO[semaforo[a].semaforo] - PESO[semaforo[b].semaforo] || semaforo[a].dias_habiles - semaforo[b].dias_habiles,
)

// ------------------------------------------------ la pantalla
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(puesto, ancho = 1440) {
  const correo = correoDe(puesto)
  const telefono = ancho <= 480
  const contexto = await navegador.newContext({
    viewport: { width: ancho, height: telefono ? 844 : 900 },
    deviceScaleFactor: 2,
    hasTouch: telefono,
    isMobile: telefono,
    timezoneId: 'America/Lima',
  })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
  pagina.on('pageerror', (e) => errores.push(`${correo}: ${String(e).slice(0, 300)}`))
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  await pagina.waitForLoadState('networkidle')
  return { pagina, contexto }
}

async function ir(pagina, ruta) {
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
  await conReact(pagina)
}

async function capturar(pagina, archivo) {
  await pagina.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
  const ventana = pagina.viewportSize()
  const alto = await pagina.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
  await pagina.setViewportSize({ width: ventana.width, height: Math.min(Math.max(alto, ventana.height), 4000) })
  await pagina.evaluate(() => window.scrollTo(0, 0))
  await pagina.screenshot({ path: `${CAPTURAS}/${archivo}` })
  await pagina.setViewportSize(ventana)
}

async function sinDesborde(pagina, donde) {
  const sobra = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  comprobar(sobra <= 0, `${donde}: nada se sale de la pantalla (sobran ${sobra} px)`)
}

const enLaBandeja = async (pagina) =>
  (await pagina.locator('[data-codigo-sin-reporte]').evaluateAll((li) => li.map((l) => l.getAttribute('data-codigo-sin-reporte')))).filter((c) =>
    c.startsWith('QA-ETAPA-'),
  )

for (const ancho of [390, 1440]) {
  // La quinta vuelve a estar sin reporte en cada ancho.
  await armazon(`update public.reportes_diarios set anulado_en = now(), anulado_por = $2, motivo_anulacion = 'Prueba 1.3: se rehace' where codigo_interno = $1 and anulado_en is null`, [
    'QA-ETAPA-LUEGO',
    mtz.id,
  ])
  const { pagina, contexto } = await entrar('sup.mtz', ancho)
  await ir(pagina, '/planos')
  const bandeja = pagina.locator('[data-sin-reporte]')
  comprobar((await bandeja.count()) === 1, `${ancho}: sup.mtz ve «Sin reporte de hoy»`)
  const codigos = await enLaBandeja(pagina)
  comprobar(
    codigos.join(',') === esperados.join(','),
    `${ancho}: salen las que piden reporte, la más atrasada arriba (${codigos.join(', ')}; se esperaba ${esperados.join(', ')})`,
  )
  for (const fuera of ['QA-ETAPA-REPORTADA', 'QA-ETAPA-FUTURA', 'QA-ETAPA-ACABADOS'])
    comprobar(!codigos.includes(fuera), `${ancho}: no sale ${fuera}`)
  // Va antes de la búsqueda: es lo que espera al supervisor.
  const antes = await pagina.evaluate(() => {
    const b = document.querySelector('[data-sin-reporte]')
    const buscar = document.querySelector('input[type="search"], form[role="search"] input')
    return Boolean(b && buscar && b.compareDocumentPosition(buscar) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  comprobar(antes, `${ancho}: la bandeja va antes del buscador`)
  const titulo = (await bandeja.locator('h2, h3').first().textContent())?.trim()
  comprobar(/^Sin reporte de hoy \(\d+\)$/.test(titulo ?? ''), `${ancho}: el título cuenta los códigos (${titulo})`)

  // El plazo es el del semáforo de la etapa: el mismo que la tarjeta del código.
  const vencida = pagina.locator('[data-codigo-sin-reporte="QA-ETAPA-VENCIDA"]')
  const plazo = (await vencida.textContent()) ?? ''
  comprobar(plazo.includes(plazoDe('QA-ETAPA-VENCIDA')), `${ancho}: la vencida dice el plazo del tablero: «${plazoDe('QA-ETAPA-VENCIDA')}»`)
  comprobar(plazo.includes(`Etapa: ${de('QA-ETAPA-VENCIDA').etapa}`) && !plazo.includes('sin marcar'), `${ancho}: dice qué etapa está en marcha`)
  comprobar((await vencida.locator('a[href="/planos?q=QA-ETAPA-VENCIDA"]').count()) === 1, `${ancho}: el código lleva a su tarjeta, con las fechas de sus etapas`)
  const solofin = (await pagina.locator('[data-codigo-sin-reporte="QA-ETAPA-SOLOFIN"]').textContent()) ?? ''
  comprobar(solofin.includes(plazoDe('QA-ETAPA-SOLOFIN')) && solofin.includes('(sin marcar «Empezó»)'),
    `${ancho}: la que solo tiene fecha comprometida, vencida y sin empezar, sale y lo dice (${solofin.slice(0, 140)})`)
  const luego = (await pagina.locator('[data-codigo-sin-reporte="QA-ETAPA-LUEGO"]').textContent()) ?? ''
  comprobar(luego.includes(plazoDe('QA-ETAPA-LUEGO')) && luego.includes('inicio planeado hoy, sin marcar «Empezó»'),
    `${ancho}: la que empieza hoy dice su plazo y que nadie marcó «Empezó» (${luego.slice(0, 140)})`)

  await sinDesborde(pagina, `${ancho} /planos`)
  await capturar(pagina, `1-3-supervisor-${ancho}-planos.png`)

  // «Subir el reporte» abre el reporte con el código puesto.
  const enlace = vencida.getByRole('link', { name: 'Subir el reporte' })
  comprobar((await enlace.getAttribute('href')) === '/reportes-diarios/nuevo?codigo=QA-ETAPA-VENCIDA', `${ancho}: el botón lleva al reporte de ese código`)
  if (ancho === 390) {
    const caja = await enlace.boundingBox()
    comprobar((caja?.height ?? 0) >= 44, `${ancho}: el botón mide al menos 44 px de alto (${caja?.height})`)
  }
  await Promise.all([pagina.waitForURL(/\/reportes-diarios\/nuevo/), enlace.click()])
  // La ida es del lado del navegador: se espera a que el formulario se pinte.
  const puesto = await pagina
    .waitForFunction(() => document.querySelector('#rd-codigo')?.value === 'QA-ETAPA-VENCIDA', null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false)
  comprobar(puesto, `${ancho}: el formulario del reporte abre con QA-ETAPA-VENCIDA puesto`)

  // Reportada la quinta, sale de la bandeja.
  await reportar(de('QA-ETAPA-LUEGO'))
  await ir(pagina, '/planos')
  const despues = await enLaBandeja(pagina)
  comprobar(!despues.includes('QA-ETAPA-LUEGO') && despues.includes('QA-ETAPA-VENCIDA'), `${ancho}: reportada, la quinta sale de la bandeja (${despues.join(', ')})`)

  // Con búsqueda o en otra pestaña no está.
  await ir(pagina, '/planos?q=QA-ETAPA')
  comprobar((await pagina.locator('[data-sin-reporte]').count()) === 0, `${ancho}: con búsqueda no sale la bandeja`)
  await ir(pagina, '/planos?ver=terminados')
  comprobar((await pagina.locator('[data-sin-reporte]').count()) === 0, `${ancho}: en «Terminados» no sale la bandeja`)
  await contexto.close()
}

// Acabados ve la suya y ninguna de Maestranza.
{
  const { pagina, contexto } = await entrar('sup.acb', 1440)
  await ir(pagina, '/planos')
  const codigos = await enLaBandeja(pagina)
  comprobar(codigos.length === 1 && codigos[0] === 'QA-ETAPA-ACABADOS', `sup.acb ve solo la de Acabados (${codigos.join(', ')})`)
  await contexto.close()
}

comprobar(errores.length === 0, `consola limpia${errores.length ? `: ${errores.join(' | ')}` : ''}`)
await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallan.`)
process.exit(fallas.length === 0 ? 0 : 1)
