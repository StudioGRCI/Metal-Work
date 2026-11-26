/**
 * SSOMA: entrega de EPP por persona (Plan 15, entrega 15.5), con clic real y la
 * cuenta de cada puesto (nunca ADMIN). Va sobre un banco recién preparado:
 *
 *   1. SSOMA, en el monitor: «Por renovar» dice lo mismo que la base; saca un
 *      equipo con «No se renueva» (tres toques, un envío). En «Salidas de
 *      Almacén» anota a quién le tocó una salida: la base rechaza la fecha que
 *      pasa de cinco años junto al campo; corregida, tres toques dan una sola
 *      entrega por persona. «No va por persona» y «Repartir» van y vuelven. En
 *      la hoja de la persona anula una entrega: lo asignado vuelve a su salida.
 *   2. SSOMA, en el celular: la base rechaza a quien ya tiene anotada esa
 *      salida, junto a la lista; con otra persona y cantidad 2, tres toques
 *      dan un envío.
 *   3. Gerencia consulta, en el monitor y en el celular: ve las tres vistas y
 *      la hoja, sin ningún botón, sin DNI y sin precios.
 *   4. RR. HH., Ventas y Almacén no entran ni por el menú ni por la dirección.
 *   5. El kardex queda igual: ni un movimiento ni un material cambió.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
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
  ssoma: 'ssoma.local@metalwork.test',
  gerencia: 'gerencia.local@metalwork.test',
  rrhh: 'rrhh.local@metalwork.test',
  ventas: 'ventas.local@metalwork.test',
  almacen: 'almacen.local@metalwork.test',
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

/** Lo que la base le contesta a una cuenta: con su sesión y el rol `authenticated`, en una transacción que se deshace. */
async function como(correo, sql, valores = []) {
  const [yo] = await consulta(`select id from public.usuarios where correo = $1`, [correo])
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                             set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [yo.id])
    await base.query('set local role authenticated')
    return (await base.query(sql, valores)).rows
  } finally {
    await base.query('rollback')
  }
}

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const quieta = (pagina) => pagina.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
async function ir(pagina, url) {
  await pagina.goto(url, { waitUntil: 'load' })
  await quieta(pagina)
}
async function hasta(leer, cumple, ms = 20000) {
  const fin = Date.now() + ms
  let ultimo = await leer()
  while (!cumple(ultimo) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 300))
    ultimo = await leer()
  }
  return ultimo
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const CELULAR = { width: 390, height: 844 }
const MONITOR = { width: 1440, height: 1000 }

async function entrar(correo, viewport = MONITOR) {
  const celular = viewport.width < 500
  const contexto = await navegador.newContext({
    viewport,
    isMobile: celular,
    hasTouch: celular,
    deviceScaleFactor: 2,
    timezoneId: 'America/Lima',
    locale: 'es-PE',
  })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' && !t.includes('_next/hmr') && !t.includes('WebSocket')) errores.push(t.slice(0, 300))
  })
  const envios = { n: 0 }
  pagina.on('request', (r) => {
    if (r.method() === 'POST' && r.headers()['next-action']) envios.n++
  })
  await ir(pagina, `${BASE}/ingresar`)
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  await quieta(pagina)
  return { pagina, contexto, errores, envios }
}

/** Tres toques seguidos al mismo botón, sin esperar entre ellos. */
async function tresToques(boton) {
  await boton.evaluate((b) => {
    b.click()
    b.click()
    b.click()
  })
}
const captura = (pagina, nombre, entera = true) => pagina.screenshot({ path: join(CAPTURAS, nombre), fullPage: entera })
/** La página no se desliza de costado. */
const sinDesborde = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
const verde = (pagina) => pagina.locator('[data-estado-epp]').first()
const BOTONES = '[data-asignar-epp], [data-no-se-renueva], [data-anular-epp], [data-no-va-por-persona], [data-repartir-salida]'

const DNIS = (await consulta(`select dni from public.trabajadores`)).map((r) => r.dni)
const sinDni = (texto) => !DNIS.some((d) => texto.includes(d))
/** Ni precios ni costos: la pantalla dice qué y cuánto, nunca cuánto vale. */
const sinPrecio = (texto) => !/S\/\s?\d|US\$|\bprecio|\bcosto\b|\bvalor\b/i.test(texto)

/** El kardex entero y el catálogo, en una huella: tienen que quedar igual. */
const huella = async () =>
  (
    await consulta(
      `select (select md5(coalesce(string_agg(m::text, '|' order by m.id), '')) from public.movimientos_materiales m) as movimientos,
              (select md5(coalesce(string_agg(x::text, '|' order by x.id), '')) from public.materiales x) as materiales`,
    )
  )[0]
const antesDeTodo = await huella()

const SALIDAS = `select movimiento_id, numero, material, cantidad::float8 as cantidad, por_asignar::float8 as por_asignar, asignado::float8 as asignado,
                        sin_reparto, dias_sugeridos, fecha::text as fecha, a_quien, no_estaban
                   from public.ssoma_salidas_de_epp(null)`
const POR_RENOVAR = `select id, trabajador_id, persona, material, situacion from public.ssoma_epp_entregas_a_la_vista(null, null, true)`
const esperan = (salidas) => salidas.filter((s) => s.por_asignar > 0 && !s.sin_reparto)
const [{ en_cinco_anios_y_un_dia: lejos }] = await consulta(
  `select ((now() at time zone 'America/Lima')::date + 1830)::text as en_cinco_anios_y_un_dia`,
)

// La salida A (de hoy, con dos o más por asignar) y la B (otra que espera reparto).
const alEmpezar = await como(CUENTAS.ssoma, SALIDAS)
const salidaA = esperan(alEmpezar).find((s) => s.por_asignar >= 2 && s.asignado === 0)
const salidaB = esperan(alEmpezar).find((s) => s.movimiento_id !== salidaA?.movimiento_id && s.por_asignar >= 3 && s.asignado > 0)
if (!salidaA || !salidaB) {
  console.error('Este recorrido va sobre un banco recién preparado: corre herramientas/banco/preparar.sh y vuelve a intentar.')
  process.exit(1)
}
const personal = await como(CUENTAS.ssoma, `select id, nombre, area, en_planta from public.ssoma_personal_para_epp()`)
const yaTienen = async (movimiento) =>
  (
    await consulta(`select trabajador_id from public.ssoma_epp_entregas where movimiento_id = $1 and anulado_en is null`, [movimiento])
  ).map((r) => r.trabajador_id)
const libresDeA = personal.filter((p) => p.en_planta && p.area === 'Maestranza' && !salidaA.no_estaban.includes(p.id))
const [oscar, carlos] = libresDeA
if (!oscar || !carlos) {
  console.error('Faltan dos personas de Maestranza en la lista de RR. HH. del banco.')
  process.exit(1)
}

// ------------------------------------------------------------ 1. SSOMA en el monitor
{
  const { pagina, contexto, errores, envios } = await entrar(CUENTAS.ssoma, MONITOR)
  const T = '[SSOMA 1440]'
  await ir(pagina, `${BASE}/ssoma`)
  comprobar((await pagina.locator('nav a[href="/ssoma/epp"]').count()) >= 1, `${T} el menú lleva «EPP por persona»`)

  // --- En el inicio, entre lo que le toca: sin entrar a la pantalla ya sabe que hay equipo por anotar.
  const [atender] = await como(CUENTAS.ssoma, `select por_asignar, vencidos from public.ssoma_epp_por_atender()`)
  await ir(pagina, `${BASE}/`)
  const inicio = limpio(await pagina.locator('main').innerText())
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`
  comprobar(
    atender.por_asignar === esperan(alEmpezar).length &&
      inicio.includes(plural(atender.por_asignar, 'salida de EPP por anotar a quién le tocó', 'salidas de EPP por anotar a quién les tocó')) &&
      (await pagina.locator('main a[href="/ssoma/epp?vista=salidas"]').count()) >= 1,
    `${T} el inicio le dice que ${atender.por_asignar} salidas de EPP esperan, con el enlace a esa lista`,
  )
  comprobar(
    atender.vencidos >= 1 &&
      inicio.includes(plural(atender.vencidos, 'equipo de protección vencido por renovar', 'equipos de protección vencidos por renovar')),
    `${T} y que hay ${atender.vencidos} equipos de protección vencidos`,
  )

  // --- Por renovar
  await ir(pagina, `${BASE}/ssoma/epp`)
  const porRenovar = await como(CUENTAS.ssoma, POR_RENOVAR)
  const vencidas = porRenovar.filter((e) => e.situacion === 'VENCIDA').length
  const filas = pagina.locator('tr[data-por-renovar]')
  comprobar(
    (await filas.count()) === porRenovar.length && (await pagina.locator('tr[data-por-renovar][data-situacion="VENCIDA"]').count()) === vencidas,
    `${T} «Por renovar» lista ${porRenovar.length}, ${vencidas} vencidos, como la base`,
  )
  const orden = await filas.evaluateAll((f) => f.map((e) => e.dataset.situacion))
  comprobar(orden.lastIndexOf('VENCIDA') < (orden.indexOf('POR_VENCER') === -1 ? orden.length : orden.indexOf('POR_VENCER')), `${T} lo vencido va primero`)
  const resumen = limpio(await pagina.locator('[data-resumen-epp]').innerText())
  const nEsperan = esperan(alEmpezar).length
  comprobar(
    resumen.includes(`${porRenovar.length} por renovar`) && resumen.includes(`${vencidas} vencido`) && resumen.includes(`${nEsperan} salida`) && atender.vencidos === vencidas,
    `${T} el encabezado lo resume: «${resumen}»`,
  )
  comprobar(
    Number(await pagina.locator('[data-epp-por-asignar]').getAttribute('data-epp-por-asignar')) === nEsperan,
    `${T} avisa que ${nEsperan} salidas de Almacén esperan que se anote a quién`,
  )
  const principal = await pagina.locator('main').innerText()
  comprobar(sinDni(await pagina.content()) && sinPrecio(principal), `${T} ni un DNI ni un precio en la página`)
  await captura(pagina, 'ssoma-epp-por-renovar-1440.png')

  // --- No se renueva, con tres toques
  const sale = porRenovar.find((e) => e.situacion === 'POR_VENCER') ?? porRenovar[0]
  await pagina.locator(`[data-no-se-renueva="${sale.id}"]`).click()
  let ventana = pagina.getByRole('dialog')
  await ventana.waitFor()
  comprobar(limpio(await ventana.innerText()).includes(sale.material), `${T} la ventana «No se renueva» nombra el equipo y a la persona`)
  await ventana.locator('textarea[name="motivo"]').fill('Pasó a oficina y ya no usa ese equipo.')
  let antes = envios.n
  await tresToques(ventana.getByRole('button', { name: 'Guardar', exact: true }))
  let dicho = await hasta(() => verde(pagina).innerText().catch(() => ''), (t) => /ya no sale/.test(t), 30000)
  await quieta(pagina)
  const [fuera] = await consulta(
    `select sin_renovacion_en is not null as fuera, motivo_sin_renovacion as motivo,
            (select correo from public.usuarios u where u.id = e.sin_renovacion_por) as quien
       from public.ssoma_epp_entregas e where id = $1`,
    [sale.id],
  )
  comprobar(
    fuera?.fuera && fuera.motivo === 'Pasó a oficina y ya no usa ese equipo.' && fuera.quien === CUENTAS.ssoma && envios.n - antes === 1,
    `${T} tres toques en «Guardar»: ${envios.n - antes} envío, y en la base queda fuera con su motivo y quién lo dijo`,
  )
  comprobar(/ya no sale en «Por renovar»/.test(dicho), `${T} el verde lo dice: «${limpio(dicho)}»`)
  const quedan = await hasta(() => filas.count(), (n) => n === porRenovar.length - 1, 15000)
  comprobar(
    quedan === porRenovar.length - 1 && (await pagina.locator(`tr[data-por-renovar="${sale.id}"]`).count()) === 0,
    `${T} la fila sale de «Por renovar» sin recargar (${porRenovar.length} → ${quedan})`,
  )

  // --- Salidas de Almacén
  await pagina.locator('[data-epp-por-asignar] a').click()
  await pagina.waitForURL('**/ssoma/epp?vista=salidas')
  await quieta(pagina)
  const filaA = pagina.locator(`tr[data-salida-epp="${salidaA.movimiento_id}"]`)
  const filaB = pagina.locator(`tr[data-salida-epp="${salidaB.movimiento_id}"]`)
  comprobar(
    (await pagina.locator('tr[data-salida-epp]').count()) === alEmpezar.length &&
      Number(await filaA.getAttribute('data-por-asignar')) === salidaA.por_asignar &&
      Number(await filaB.getAttribute('data-por-asignar')) === salidaB.por_asignar,
    `${T} «Salidas de Almacén» lista ${alEmpezar.length}, con lo que queda por asignar de cada una, como la base`,
  )
  const primeras = await pagina.locator('tr[data-salida-epp]').evaluateAll((f) => f.map((e) => [Number(e.dataset.porAsignar) > 0 && !e.dataset.sinReparto, e.dataset.salidaEpp]))
  comprobar(
    primeras.findIndex(([espera]) => !espera) === -1 || primeras.slice(primeras.findIndex(([espera]) => !espera)).every(([espera]) => !espera),
    `${T} las que esperan reparto van primero`,
  )
  const repartida = alEmpezar.find((s) => s.por_asignar === 0)
  if (repartida) {
    const fila = pagina.locator(`tr[data-salida-epp="${repartida.movimiento_id}"]`)
    comprobar(
      (await fila.locator(BOTONES).count()) === 0 && limpio(await fila.innerText()).includes('Asignada'),
      `${T} la salida ya repartida dice «Asignada» y no ofrece nada`,
    )
  }
  const yaSinReparto = alEmpezar.find((s) => s.sin_reparto && s.por_asignar > 0)
  if (yaSinReparto) {
    const fila = pagina.locator(`tr[data-salida-epp="${yaSinReparto.movimiento_id}"]`)
    comprobar(
      (await fila.locator('[data-repartir-salida]').count()) === 1 &&
        (await fila.locator('[data-asignar-epp]').count()) === 0 &&
        (await fila.locator('[data-motivo-sin-reparto]:visible').count()) === 1,
      `${T} la que «no va por persona» dice su motivo y solo ofrece «Repartir»`,
    )
  }
  comprobar(sinPrecio(await pagina.locator('main').innerText()), `${T} las salidas no llevan precio`)
  await captura(pagina, 'ssoma-epp-salidas-1440.png')

  // --- Anotar a quién le tocó la salida A
  await filaA.locator('[data-asignar-epp]').click()
  ventana = pagina.getByRole('dialog')
  await ventana.waitFor()
  const anotar = ventana.getByRole('button', { name: 'Anotar', exact: true })
  comprobar(await anotar.isDisabled(), `${T} sin personas ni fecha, «Anotar» no se puede tocar`)
  comprobar((await ventana.locator('#epp-renovar').inputValue()) === '', `${T} sin entregas anteriores de ese equipo, no propone fecha`)
  // Quien no estaba en la planta el día de la salida no se ofrece: la base lo rechazaría.
  const ofrecidas = await ventana.locator('[data-persona-epp]').evaluateAll((c) => c.map((e) => e.dataset.personaEpp))
  const deLaLista = personal.filter((p) => !salidaA.no_estaban.includes(p.id)).map((p) => p.id)
  comprobar(
    salidaA.no_estaban.length >= 1 &&
      ofrecidas.length === deLaLista.length &&
      deLaLista.every((i) => ofrecidas.includes(i)) &&
      Number(await ventana.locator('[data-no-estaban]').getAttribute('data-no-estaban')) === salidaA.no_estaban.length,
    `${T} la ventana ofrece a ${ofrecidas.length} de ${personal.length} y dice que ${salidaA.no_estaban.length} no estaba en la planta ese día`,
  )
  await ventana.getByRole('searchbox').fill('nunez')
  await ventana.locator(`[data-persona-epp="${oscar.id}"]`).check()
  await ventana.getByRole('searchbox').fill('')
  await ventana.locator(`[data-persona-epp="${carlos.id}"]`).check()
  comprobar(
    Number(await ventana.locator('[data-anotado]').getAttribute('data-anotado')) === 2 && (await ventana.locator('[data-cantidad-epp]').count()) === 2,
    `${T} marcó a dos (una buscada sin tildes): anota 2 de ${salidaA.por_asignar}, con la cantidad de cada una`,
  )
  // Más de lo que salió: lo dice la ventana y no deja enviar.
  await ventana.locator(`[data-cantidad-epp="${oscar.id}"]`).fill('2')
  await ventana.locator('[data-duracion="6"]').click()
  comprobar(
    (await anotar.isDisabled()) && /Anotas 3 y de esta salida quedan 2/.test(limpio(await ventana.innerText())),
    `${T} con 3 anotados de una salida de 2 lo dice y no deja enviar`,
  )
  await ventana.locator(`[data-cantidad-epp="${oscar.id}"]`).fill('1')
  comprobar(await anotar.isEnabled(), `${T} con la duración de «6 meses» y dos personas, «Anotar» se puede tocar`)

  // Más de cinco años: el campo no lo deja, así que se le quita el tope para que lo rechace la base.
  await ventana.locator('#epp-renovar').evaluate((e) => e.removeAttribute('max'))
  await ventana.locator('#epp-renovar').fill(lejos)
  antes = envios.n
  await anotar.click()
  const invalida = await hasta(() => ventana.locator('#epp-renovar').getAttribute('aria-invalid'), (v) => v === 'true', 15000)
  comprobar(
    invalida === 'true' && /hasta cinco años después/.test(limpio(await ventana.innerText())),
    `${T} la base rechaza la renovación a más de cinco años y lo dice junto al campo`,
  )
  comprobar(await pagina.evaluate(() => document.activeElement?.id === 'epp-renovar'), `${T} el cursor vuelve a la fecha`)
  comprobar(
    envios.n - antes === 1 &&
      (await consulta(`select 1 from public.ssoma_epp_entregas where movimiento_id = $1`, [salidaA.movimiento_id])).length === 0 &&
      Number(await ventana.locator('[data-anotado]').getAttribute('data-anotado')) === 2,
    `${T} no quedó nada anotado y las dos personas siguen marcadas`,
  )
  await ventana.locator('[data-duracion="12"]').click()
  comprobar(
    (await ventana.locator('#epp-renovar').getAttribute('aria-invalid')) !== 'true' && !/hasta cinco años después/.test(limpio(await ventana.innerText())),
    `${T} al corregir la fecha con «1 año», el rechazo deja de verse`,
  )
  await captura(pagina, 'ssoma-epp-anotar-a-quien-1440.png', false)

  antes = envios.n
  await tresToques(anotar)
  dicho = await hasta(() => verde(pagina).innerText().catch(() => ''), (t) => /anotada/.test(t), 30000)
  await quieta(pagina)
  const entregas = await consulta(
    `select e.trabajador_id, e.cantidad::float8 as cantidad, e.entregado_el::text as entregado_el, e.renovar_el::text as renovar_el,
            (e.entregado_el + interval '12 months')::date::text as en_un_anio,
            (select correo from public.usuarios u where u.id = e.creado_por) as quien, e.material_id = m.material_id as mismo_material
       from public.ssoma_epp_entregas e join public.movimientos_materiales m on m.id = e.movimiento_id
      where e.movimiento_id = $1 order by e.creado_en`,
    [salidaA.movimiento_id],
  )
  comprobar(
    entregas.length === 2 && envios.n - antes === 1,
    `${T} tres toques en «Anotar»: ${entregas.length} entregas (una por persona), ${envios.n - antes} envío`,
  )
  comprobar(
    entregas.every((e) => e.cantidad === 1 && e.entregado_el === salidaA.fecha && e.renovar_el === e.en_un_anio && e.quien === CUENTAS.ssoma && e.mismo_material) &&
      new Set(entregas.map((e) => e.trabajador_id)).size === 2 &&
      [oscar.id, carlos.id].every((i) => entregas.some((e) => e.trabajador_id === i)),
    `${T} cada una con 1, la fecha de la salida, renovación a un año, el equipo de la salida y quién la anotó`,
  )
  comprobar(new RegExp(`Entrega anotada a 2 personas\\. .*${salidaA.numero}`).test(limpio(dicho)), `${T} el verde lo dice: «${limpio(dicho)}»`)
  const queda = await hasta(() => filaA.getAttribute('data-por-asignar').then(Number), (n) => n === 0, 15000)
  comprobar(
    queda === 0 && (await filaA.locator(BOTONES).count()) === 0 && limpio(await filaA.innerText()).includes('Asignada'),
    `${T} la salida pasa a «Asignada» sin recargar y ya no ofrece nada`,
  )
  comprobar(
    (await filaA.locator(`a[href="/ssoma/epp/${oscar.id}"]:visible`).count()) === 1 && (await filaA.locator(`a[href="/ssoma/epp/${carlos.id}"]:visible`).count()) === 1,
    `${T} «A quién le tocó» nombra a las dos, con el enlace a su hoja`,
  )
  const [deLaBase] = (await como(CUENTAS.ssoma, SALIDAS)).filter((s) => s.movimiento_id === salidaA.movimiento_id)
  comprobar(
    deLaBase?.a_quien?.length === 2 && [oscar.id, carlos.id].every((i) => deLaBase.a_quien.some((q) => q.trabajador_id === i && q.cantidad === 1)),
    `${T} y sale de la misma lectura de la salida, sin tope de filas`,
  )
  await captura(pagina, 'ssoma-epp-salida-asignada-1440.png')

  // --- No va por persona, y de vuelta con «Repartir»
  await filaB.locator('[data-no-va-por-persona]').click()
  ventana = pagina.getByRole('dialog')
  await ventana.waitFor()
  await ventana.locator('textarea[name="motivo"]').fill('Quedan de repuesto en el pañol del área.')
  antes = envios.n
  await tresToques(ventana.getByRole('button', { name: 'Guardar', exact: true }))
  await hasta(() => filaB.getAttribute('data-sin-reparto'), (v) => v === 'true', 30000)
  await quieta(pagina)
  const marcas = await consulta(
    `select motivo, deshecho_en is null as vigente from public.ssoma_epp_sin_reparto where movimiento_id = $1`,
    [salidaB.movimiento_id],
  )
  comprobar(
    marcas.length === 1 && marcas[0].vigente && marcas[0].motivo === 'Quedan de repuesto en el pañol del área.' && envios.n - antes === 1,
    `${T} «No va por persona» con tres toques: ${marcas.length} marca en la base, ${envios.n - antes} envío`,
  )
  comprobar(
    (await filaB.getAttribute('data-sin-reparto')) === 'true' &&
      (await filaB.locator('[data-asignar-epp]').count()) === 0 &&
      limpio(await filaB.innerText()).includes('Quedan de repuesto en el pañol del área.'),
    `${T} la salida deja de esperar, con su motivo a la vista, y solo ofrece «Repartir»`,
  )
  dicho = limpio(await verde(pagina).innerText())
  comprobar(
    dicho.includes(`lo que queda de ${salidaB.material} (`) && dicho.includes(salidaB.numero) && /ya no espera reparto/.test(dicho),
    `${T} el verde nombra el equipo y la salida: «${dicho}»`,
  )
  comprobar(
    (await hasta(() => pagina.evaluate(() => document.activeElement?.getAttribute('data-repartir-salida')), (v) => v === salidaB.movimiento_id, 8000)) ===
      salidaB.movimiento_id,
    `${T} el cursor queda en «Repartir» de esa fila, no cae a la página`,
  )
  await captura(pagina, 'ssoma-epp-no-va-por-persona-1440.png')
  antes = envios.n
  await tresToques(filaB.locator('[data-repartir-salida]'))
  await hasta(() => filaB.locator('[data-asignar-epp]').count(), (n) => n === 1, 30000)
  await quieta(pagina)
  const deshecha = await consulta(
    `select deshecho_en is not null as deshecha, (select correo from public.usuarios u where u.id = s.deshecho_por) as quien
       from public.ssoma_epp_sin_reparto s where movimiento_id = $1`,
    [salidaB.movimiento_id],
  )
  comprobar(
    deshecha.length === 1 && deshecha[0].deshecha && deshecha[0].quien === CUENTAS.ssoma && envios.n - antes === 1,
    `${T} «Repartir» con tres toques: la marca queda deshecha, no borrada, con quién; ${envios.n - antes} envío`,
  )
  comprobar(
    (await filaB.getAttribute('data-sin-reparto')) === null && (await filaB.locator('[data-asignar-epp]').count()) === 1,
    `${T} la salida vuelve a esperar que se anote a quién`,
  )
  dicho = limpio(await verde(pagina).innerText())
  comprobar(dicho.includes(salidaB.material) && /vuelve a esperar/.test(dicho), `${T} el verde lo dice con el equipo: «${dicho}»`)
  comprobar(
    (await hasta(() => pagina.evaluate(() => document.activeElement?.getAttribute('data-asignar-epp')), (v) => v === salidaB.movimiento_id, 10000)) ===
      salidaB.movimiento_id,
    `${T} el cursor sigue a «Anotar a quién» de esa fila`,
  )

  // --- Por persona, y la hoja de una
  await ir(pagina, `${BASE}/ssoma/epp?vista=personas`)
  const porPersona = await como(CUENTAS.ssoma, `select id, vigentes from public.ssoma_epp_por_persona(null)`)
  const enPantalla = await pagina.locator('tr[data-persona-con-epp]').evaluateAll((f) => f.map((e) => [e.dataset.personaConEpp, Number(e.dataset.vigentes)]))
  comprobar(
    enPantalla.length === porPersona.length && porPersona.every((p) => enPantalla.some(([i, v]) => i === p.id && v === p.vigentes)),
    `${T} «Por persona» lista a las ${porPersona.length} de la planta con su EPP vigente, como la base`,
  )
  comprobar(sinDni(await pagina.content()), `${T} ningún DNI en la lista de personas`)
  await captura(pagina, 'ssoma-epp-por-persona-1440.png')

  await pagina.locator(`tr[data-persona-con-epp="${oscar.id}"] a`).click()
  await pagina.waitForURL(`**/ssoma/epp/${oscar.id}`)
  await quieta(pagina)
  const [suya] = await consulta(
    `select id from public.ssoma_epp_entregas where movimiento_id = $1 and trabajador_id = $2 and anulado_en is null`,
    [salidaA.movimiento_id, oscar.id],
  )
  const filaSuya = pagina.locator(`tr[data-entrega-epp="${suya?.id}"]`)
  comprobar(
    (await filaSuya.getAttribute('data-estado')) === 'VIGENTE' &&
      (await filaSuya.locator('[data-no-se-renueva]').count()) === 1 &&
      (await filaSuya.locator('[data-anular-epp]').count()) === 1 &&
      limpio(await filaSuya.innerText()).includes(salidaA.numero),
    `${T} la hoja de la persona lleva lo recién anotado como vigente, con su número de salida`,
  )
  comprobar(sinDni(await pagina.content()) && sinPrecio(await pagina.locator('main').innerText()), `${T} ni un DNI ni un precio en la hoja`)
  await captura(pagina, 'ssoma-epp-hoja-1440.png')

  // --- Anular: no se borra, y lo asignado vuelve a su salida
  await filaSuya.locator('[data-anular-epp]').click()
  ventana = pagina.getByRole('dialog')
  await ventana.waitFor()
  await ventana.locator('textarea[name="motivo"]').fill('Se anotó a otra persona: el respirador lo recibió su compañero.')
  antes = envios.n
  await tresToques(ventana.getByRole('button', { name: 'Anular', exact: true }))
  dicho = await hasta(() => verde(pagina).innerText().catch(() => ''), (t) => /anulada/.test(t), 30000)
  await quieta(pagina)
  const [anulada] = await consulta(
    `select anulado_en is not null as anulada, motivo_anulacion as motivo, (select correo from public.usuarios u where u.id = e.anulado_por) as quien
       from public.ssoma_epp_entregas e where id = $1`,
    [suya?.id],
  )
  comprobar(
    anulada?.anulada && anulada.quien === CUENTAS.ssoma && /lo recibió su compañero/.test(anulada.motivo) && envios.n - antes === 1,
    `${T} tres toques en «Anular»: la entrega sigue en la base, anulada con motivo y quién; ${envios.n - antes} envío`,
  )
  comprobar(
    limpio(dicho).includes(`Entrega anulada: ${salidaA.material}, de `) && /vuelve a quedar por asignar/.test(dicho),
    `${T} el verde nombra el equipo y a la persona: «${limpio(dicho)}»`,
  )
  const estado = await hasta(() => filaSuya.getAttribute('data-estado'), (v) => v === 'ANULADA', 15000)
  comprobar(
    estado === 'ANULADA' && (await filaSuya.locator(BOTONES).count()) === 0 && /lo recibió su compañero/.test(limpio(await filaSuya.innerText())),
    `${T} pasa al historial como anulada, con su motivo, y ya no ofrece nada`,
  )
  const [vuelve] = (await como(CUENTAS.ssoma, SALIDAS)).filter((s) => s.movimiento_id === salidaA.movimiento_id)
  comprobar(vuelve?.por_asignar === 1 && vuelve.asignado === 1, `${T} lo que tenía asignado vuelve a quedar por asignar en su salida (1 de ${salidaA.cantidad})`)
  await captura(pagina, 'ssoma-epp-hoja-anulada-1440.png')

  // Una hoja que no existe no enseña nada.
  await ir(pagina, `${BASE}/ssoma/epp/00000000-0000-4000-8000-000000000000`)
  comprobar(
    /No encontramos lo que buscas/.test(await pagina.locator('main').innerText()) && (await pagina.locator('[data-epp-vigente]').count()) === 0,
    `${T} la hoja de alguien que no está en la lista dice que no se encontró`,
  )
  comprobar(errores.filter((e) => !e.includes('404')).length === 0, `${T} sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 2. SSOMA en el celular
{
  const { pagina, contexto, errores, envios } = await entrar(CUENTAS.ssoma, CELULAR)
  const T = '[SSOMA 390]'
  await ir(pagina, `${BASE}/ssoma/epp`)
  const porRenovar = await como(CUENTAS.ssoma, POR_RENOVAR)
  comprobar((await pagina.locator('tr[data-por-renovar]').count()) === porRenovar.length, `${T} «Por renovar» lista ${porRenovar.length}, como la base`)
  comprobar(
    (await pagina.locator('tr[data-por-renovar] [data-no-se-renueva]:visible').count()) === porRenovar.length,
    `${T} cada ficha lleva su «No se renueva», una sola vez`,
  )
  comprobar(await sinDesborde(pagina), `${T} la página no se desliza de costado`)
  await captura(pagina, 'ssoma-epp-por-renovar-390.png')

  await ir(pagina, `${BASE}/ssoma/epp?vista=salidas`)
  comprobar(await sinDesborde(pagina), `${T} «Salidas de Almacén» tampoco`)
  const altos = await pagina
    .locator('tr[data-salida-epp] a[href^="/ssoma/epp/"]:visible')
    .evaluateAll((a) => a.map((e) => Math.round(e.getBoundingClientRect().height)))
  comprobar(altos.length >= 1 && altos.every((h) => h >= 44), `${T} los ${altos.length} nombres de «A quién le tocó» se tocan con el dedo (${Math.min(...altos)} px el menor)`)
  await captura(pagina, 'ssoma-epp-salidas-390.png')

  // La salida B: tiene gente anotada y propone la duración de la vez anterior.
  const filaB = pagina.locator(`tr[data-salida-epp="${salidaB.movimiento_id}"]`)
  const [conB] = await yaTienen(salidaB.movimiento_id)
  const nuevo = personal.find((p) => p.en_planta && p.area === 'Mantenimiento' && !salidaB.no_estaban.includes(p.id))
  await filaB.locator('[data-asignar-epp]').click()
  const ventana = pagina.getByRole('dialog')
  await ventana.waitFor()
  const propuesta = await ventana.locator('#epp-renovar').inputValue()
  const [{ esperada }] = await consulta(`select ($1::date + $2::int)::text as esperada`, [salidaB.fecha, salidaB.dias_sugeridos])
  comprobar(propuesta === esperada, `${T} propone la renovación de la última vez que se entregó ese equipo (${salidaB.dias_sugeridos} días)`)
  const anotar = ventana.getByRole('button', { name: 'Anotar', exact: true })

  // Quien ya tiene anotada esa salida: la base lo rechaza y se dice junto a la lista.
  await ventana.locator(`[data-persona-epp="${conB}"]`).check()
  let antes = envios.n
  await anotar.click()
  const rechazo = await hasta(() => ventana.locator('#epp-personas-error').innerText().catch(() => ''), (t) => t !== '', 15000)
  comprobar(/ya tiene anotada su entrega/.test(rechazo), `${T} la base rechaza a quien ya la tiene y lo dice junto a la lista: «${limpio(rechazo)}»`)
  comprobar(await pagina.evaluate(() => document.activeElement?.id === 'epp-personas-error'), `${T} el cursor va al rechazo mismo`)
  const aLaVista = await ventana.locator('#epp-personas-error').evaluate((e) => {
    const c = e.getBoundingClientRect()
    return c.top >= 0 && c.bottom <= window.innerHeight
  })
  comprobar(aLaVista, `${T} y el rechazo queda a la vista en el teléfono, sin tener que subir`)
  comprobar(
    (await ventana.locator('li[data-rechazada]').count()) === 1 &&
      (await ventana.locator(`li[data-rechazada] [data-persona-epp="${conB}"]`).getAttribute('aria-invalid')) === 'true',
    `${T} la fila de esa persona queda marcada, para no buscarla en la lista`,
  )
  await captura(pagina, 'ssoma-epp-rechazo-390.png', false)
  comprobar(
    envios.n - antes === 1 &&
      (await yaTienen(salidaB.movimiento_id)).length === salidaB.asignado &&
      (await ventana.locator(`[data-persona-epp="${conB}"]`).isChecked()),
    `${T} no quedó nada anotado y la persona sigue marcada`,
  )
  await ventana.locator(`[data-persona-epp="${conB}"]`).uncheck()
  comprobar((await ventana.locator('#epp-personas-error').count()) === 0, `${T} al quitarla de la lista, el rechazo deja de verse`)
  await ventana.locator(`[data-persona-epp="${nuevo.id}"]`).check()
  await ventana.locator(`[data-cantidad-epp="${nuevo.id}"]`).fill('2')
  comprobar(Number(await ventana.locator('[data-anotado]').getAttribute('data-anotado')) === 2, `${T} una persona con 2: anota 2 de ${salidaB.por_asignar}`)
  await captura(pagina, 'ssoma-epp-anotar-a-quien-390.png', false)
  antes = envios.n
  await tresToques(anotar)
  const dicho = await hasta(() => verde(pagina).innerText().catch(() => ''), (t) => /anotada/.test(t), 30000)
  await quieta(pagina)
  const nuevas = await consulta(
    `select cantidad::float8 as cantidad, renovar_el::text as renovar_el from public.ssoma_epp_entregas
      where movimiento_id = $1 and trabajador_id = $2 and anulado_en is null`,
    [salidaB.movimiento_id, nuevo.id],
  )
  comprobar(
    nuevas.length === 1 && nuevas[0].cantidad === 2 && nuevas[0].renovar_el === esperada && envios.n - antes === 1,
    `${T} tres toques en «Anotar»: ${nuevas.length} entrega de 2, ${envios.n - antes} envío`,
  )
  comprobar(/Entrega anotada a 1 persona\./.test(dicho), `${T} el verde lo dice: «${limpio(dicho)}»`)
  const queda = await hasta(() => filaB.getAttribute('data-por-asignar').then(Number), (n) => n === salidaB.por_asignar - 2, 15000)
  comprobar(queda === salidaB.por_asignar - 2, `${T} a la salida le queda ${queda} por asignar, sin recargar`)
  await captura(pagina, 'ssoma-epp-salida-anotada-390.png')

  await ir(pagina, `${BASE}/ssoma/epp?vista=personas`)
  comprobar(await sinDesborde(pagina), `${T} «Por persona» no se desliza de costado`)
  comprobar(
    /próxima renovación el/.test(limpio(await pagina.locator('tr[data-persona-con-epp]').first().locator('xpath=..').innerText())),
    `${T} cada ficha dice cuándo le toca la próxima renovación`,
  )
  await captura(pagina, 'ssoma-epp-por-persona-390.png')
  await ir(pagina, `${BASE}/ssoma/epp/${nuevo.id}`)
  comprobar(
    (await pagina.locator('tr[data-entrega-epp][data-estado="VIGENTE"]').count()) === 1 && (await sinDesborde(pagina)),
    `${T} la hoja de la persona lleva su equipo vigente y no se desliza de costado`,
  )
  await captura(pagina, 'ssoma-epp-hoja-390.png')
  comprobar(errores.length === 0, `${T} sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 3. Gerencia consulta
for (const [viewport, tam] of [
  [MONITOR, '1440'],
  [CELULAR, '390'],
]) {
  const { pagina, contexto, errores, envios } = await entrar(CUENTAS.gerencia, viewport)
  const T = `[Gerencia ${tam}]`
  if (tam === '1440') {
    await ir(pagina, `${BASE}/ssoma`)
    comprobar((await pagina.locator('nav a[href="/ssoma/epp"]').count()) >= 1, `${T} el menú lleva «EPP por persona»`)
    // Gerencia consulta: el EPP por anotar no se le suma entre lo que le toca.
    await ir(pagina, `${BASE}/`)
    comprobar(!/EPP por anotar|protección vencido/.test(await pagina.locator('main').innerText()), `${T} el inicio no le carga los pendientes de EPP, que son de SSOMA`)
  }
  await ir(pagina, `${BASE}/ssoma/epp`)
  const porRenovar = await como(CUENTAS.gerencia, POR_RENOVAR)
  comprobar(
    porRenovar.length > 0 && (await pagina.locator('tr[data-por-renovar]').count()) === porRenovar.length,
    `${T} ve «Por renovar»: ${porRenovar.length}, como le contesta la base`,
  )
  comprobar(
    (await pagina.locator(BOTONES).count()) === 0 && (await pagina.locator('[data-epp-por-asignar]').count()) === 0,
    `${T} sin botones ni el aviso de lo que falta anotar`,
  )
  comprobar(sinDni(await pagina.content()) && sinPrecio(await pagina.locator('main').innerText()), `${T} ni un DNI ni un precio`)
  await captura(pagina, `ssoma-epp-gerencia-por-renovar-${tam}.png`)

  await ir(pagina, `${BASE}/ssoma/epp?vista=salidas`)
  const salidas = await como(CUENTAS.gerencia, SALIDAS)
  comprobar(
    salidas.length > 0 && (await pagina.locator('tr[data-salida-epp]').count()) === salidas.length && (await pagina.locator(BOTONES).count()) === 0,
    `${T} ve las ${salidas.length} salidas de Almacén, sin botones`,
  )
  comprobar(sinDni(await pagina.content()) && sinPrecio(await pagina.locator('main').innerText()), `${T} las salidas, sin DNI ni precio`)
  if (tam === '390') comprobar(await sinDesborde(pagina), `${T} no se desliza de costado`)
  await captura(pagina, `ssoma-epp-gerencia-salidas-${tam}.png`)

  await ir(pagina, `${BASE}/ssoma/epp?vista=personas`)
  comprobar((await pagina.locator('tr[data-persona-con-epp]').count()) > 0 && sinDni(await pagina.content()), `${T} ve la lista por persona, sin DNI`)
  await ir(pagina, `${BASE}/ssoma/epp/${carlos.id}`)
  comprobar(
    (await pagina.locator('tr[data-entrega-epp]').count()) >= 1 && (await pagina.locator(BOTONES).count()) === 0 && sinDni(await pagina.content()),
    `${T} ve la hoja de una persona, sin botones ni DNI`,
  )
  await captura(pagina, `ssoma-epp-gerencia-hoja-${tam}.png`)
  comprobar(envios.n === 0, `${T} no envió nada`)
  comprobar(errores.length === 0, `${T} sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 4. Quien no debe entrar
for (const [puesto, correo] of [
  ['RR. HH.', CUENTAS.rrhh],
  ['Ventas', CUENTAS.ventas],
  ['Almacén', CUENTAS.almacen],
]) {
  const { pagina, contexto } = await entrar(correo, MONITOR)
  comprobar((await pagina.locator('nav a[href="/ssoma/epp"]').count()) === 0, `[${puesto}] el menú no lleva «EPP por persona»`)
  for (const [que, ruta] of [
    ['la lista', '/ssoma/epp'],
    ['las salidas', '/ssoma/epp?vista=salidas'],
    ['la hoja de una persona', `/ssoma/epp/${carlos.id}`],
  ]) {
    await ir(pagina, `${BASE}${ruta}`)
    const texto = await pagina.content()
    comprobar(
      pagina.url().includes('/sin-permiso') && !texto.includes(carlos.nombre) && !texto.includes('data-salida-epp'),
      `[${puesto}] ${que}, por su dirección, lo lleva a «sin permiso»`,
    )
  }
  const filas = await como(correo, `select count(*)::int as n from public.ssoma_epp_entregas`)
  comprobar(filas[0].n === 0, `[${puesto}] y la base no le deja leer ninguna entrega`)
  await contexto.close()
}

// ------------------------------------------------------------ 5. El kardex, igual
const despuesDeTodo = await huella()
comprobar(
  despuesDeTodo.movimientos === antesDeTodo.movimientos && despuesDeTodo.materiales === antesDeTodo.materiales,
  '[Kardex] ni un movimiento ni un material cambió con todo lo anterior',
)

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} fallas:\n- ${fallas.join('\n- ')}` : '\nTodo bien.')
process.exit(fallas.length ? 1 : 0)
