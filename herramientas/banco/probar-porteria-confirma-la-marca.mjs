/**
 * Recorre con clic real la marca de la portería (Plan 14, entrega 14.1), con la
 * cuenta de cada puesto y nunca ADMIN:
 *
 *   1. La portería, en el teléfono (390), marca el ingreso de Ana: arriba sale
 *      la confirmación en grande con su nombre, «Ingreso marcado» y la hora que
 *      puso la base, la misma de la fila de `asistencias`. Tres toques seguidos
 *      dejan una sola marca.
 *   2. «Dentro ahora» y «Todavía no llegan» cuentan lo que dice la base, se leen
 *      sin botones de marcar y solo llevan nombre, cargo y horario: el DNI de
 *      nadie llega a la página.
 *   3. Desde la confirmación, «Anular esta marca» pide el motivo y la anula: la
 *      confirmación pasa a «Ingreso anulado» con su motivo, y en la base queda
 *      anulada por la portería, sin borrarse.
 *   4. Vuelve a marcar el ingreso y después la salida: la confirmación dice
 *      «Salida marcada» y Ana ya no está en «Dentro ahora».
 *   5. Todo lo que se toca en la pantalla mide al menos 44 px en el teléfono y
 *      la página no se desborda de costado.
 *   6. Gerencia mira las mismas listas sin botones de marcar ni de anular;
 *      Logística no entra.
 *
 * Necesita las cuentas `*.local@metalwork.test` de portería, RR. HH., Gerencia y
 * Logística. El personal lo crea el script, inventado y distinto en cada
 * corrida. Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS,
 * BANCO_BASE, BANCO_CHROMIUM.
 */
import { existsSync, mkdirSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((r) => existsSync(r))
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
// Ana entra a las 23:58 (a tiempo a cualquier hora) y Tomás a las 00:00 (siempre tarde).
const ana = { id: crypto.randomUUID(), nombres: `Ana ${sello}`, apellidos: 'Prueba Puerta', dni: `6${sello}1`, entrada: '23:58', salida: '23:59' }
const beto = { id: crypto.randomUUID(), nombres: `Beto ${sello}`, apellidos: 'Prueba Ausente', dni: `6${sello}2`, entrada: '08:00' }
const tomas = { id: crypto.randomUUID(), nombres: `Tomás ${sello}`, apellidos: 'Prueba Madrugada', dni: `6${sello}3`, entrada: '00:00' }

const [{ id: rrhhId }] = await consulta('select id from public.usuarios where correo = $1', [CUENTAS.rrhh])
const [{ id: porteriaId }] = await consulta('select id from public.usuarios where correo = $1', [CUENTAS.porteria])

await base.query('begin')
await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)`, [rrhhId])
await base.query('set local role authenticated')
for (const p of [ana, beto, tomas]) {
  await base.query(
    `select public.rrhh_guardar_trabajador($1, $2, $3, $4, 'Soldador', null, $5, $7, 'Banco de Pruebas', 'AHORROS', $6, null)`,
    [p.id, p.nombres, p.apellidos, p.dni, p.entrada, `191-${p.dni}`, p.salida ?? '18:00'],
  )
}
await base.query('commit')

const marcasDe = (p) =>
  consulta(
    `select id, tipo, to_char(hora, 'HH24:MI') as hora, anulado_en is not null as anulada, anulado_por, motivo_anulacion, es_tardanza
       from public.asistencias where trabajador_id = $1 and fecha = (now() at time zone 'America/Lima')::date order by marcado_en`,
    [p.id],
  )
const cuentasDeHoy = async () => {
  const [f] = await consulta(
    `with hoy as (select (now() at time zone 'America/Lima')::date as d),
          vig as (select a.trabajador_id, a.tipo from public.asistencias a, hoy where a.fecha = hoy.d and a.anulado_en is null)
     select (select count(*) from public.trabajadores where activo)::int as todos,
            (select count(*) from public.trabajadores t where t.activo
               and exists (select 1 from vig where vig.trabajador_id = t.id and vig.tipo = 'INGRESO')
               and not exists (select 1 from vig where vig.trabajador_id = t.id and vig.tipo = 'SALIDA'))::int as dentro,
            (select count(*) from public.trabajadores t where t.activo
               and not exists (select 1 from vig where vig.trabajador_id = t.id and vig.tipo = 'INGRESO'))::int as faltan`,
  )
  return f
}

// ------------------------------------------------ el navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const TELEFONO = { width: 390, height: 844 }
const MONITOR = { width: 1440, height: 900 }

async function entrar(correo, viewport) {
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, deviceScaleFactor: 2 })
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

const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const tarjetaDe = (pagina, p) => pagina.locator('main li').filter({ hasText: p.nombres }).first()
const confirmacionDe = (pagina) => pagina.locator('[data-confirmacion-de-marca]')
const buscar = async (pagina, texto) => {
  await pagina.getByRole('searchbox').fill(texto)
}
const pastilla = (pagina, nombre) => pagina.getByRole('group', { name: 'Qué lista se ve' }).getByRole('button', { name: new RegExp(`^${nombre}`) })

try {
  // ---------------------------------------------- 1. la portería marca y ve la confirmación
  console.log('\n1. La portería marca el ingreso y lo ve confirmado en grande (390)')
  const puerta = await entrar(CUENTAS.porteria, TELEFONO)
  const { pagina } = puerta
  await pagina.goto(`${BASE}/rrhh/asistencia`, { waitUntil: 'networkidle' })
  comprobar(limpio(await confirmacionDe(pagina).textContent()) === '', 'antes de marcar, la confirmación está montada y vacía')
  await pagina.screenshot({ path: `${CAPTURAS}/porteria-390-1-antes-de-marcar.png` })

  await buscar(pagina, ana.nombres)
  const tarjetaAna = tarjetaDe(pagina, ana)
  await tarjetaAna.waitFor({ timeout: 15000 })
  const ingreso = tarjetaAna.getByRole('button', { name: /Marcar el ingreso/ })
  // Tres toques seguidos: uno solo sale.
  await ingreso.click()
  await ingreso.click({ force: true, timeout: 2000 }).catch(() => {})
  await ingreso.click({ force: true, timeout: 2000 }).catch(() => {})
  await confirmacionDe(pagina).getByText('Ingreso marcado').waitFor({ timeout: 15000 })
  let filas = await marcasDe(ana)
  comprobar(filas.length === 1 && filas[0].tipo === 'INGRESO' && !filas[0].anulada, `tres toques dejan una sola marca de ingreso (hay ${filas.length})`)
  let dicho = limpio(await confirmacionDe(pagina).innerText())
  console.log(`     confirmación: «${dicho}»`)
  comprobar(dicho.includes(`${ana.apellidos}, ${ana.nombres}`), 'la confirmación dice de quién es la marca')
  comprobar(dicho.includes(filas[0]?.hora), `la confirmación dice la hora que puso la base (${filas[0]?.hora})`)
  comprobar(dicho.includes('A tiempo'), 'dice que entró a tiempo')
  const horaGrande = await confirmacionDe(pagina).locator('p.tabular').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize))
  comprobar(horaGrande >= 40, `la hora se lee en grande (${horaGrande} px)`)
  const aLaVista = await confirmacionDe(pagina).evaluate((e) => {
    const r = e.getBoundingClientRect()
    return r.top >= 56 && r.bottom <= innerHeight
  })
  comprobar(aLaVista, 'la confirmación queda a la vista, debajo de la barra de arriba')
  await pagina.screenshot({ path: `${CAPTURAS}/porteria-390-2-ingreso-marcado.png` })

  // ---------------------------------------------- 2. las dos listas en lectura
  console.log('\n2. «Dentro ahora» y «Todavía no llegan», solo para leer')
  await buscar(pagina, '')
  let cuentas = await cuentasDeHoy()
  // La lista llega con la respuesta de la acción, un poco después de la confirmación.
  await pagina.getByRole('group', { name: 'Qué lista se ve' }).getByRole('button', { name: `Dentro ahora (${cuentas.dentro})` }).waitFor({ timeout: 15000 })
  const etiquetas = (await pagina.getByRole('group', { name: 'Qué lista se ve' }).getByRole('button').allTextContents()).map(limpio)
  console.log(`     pastillas: ${etiquetas.join(' | ')}`)
  comprobar(etiquetas.includes(`Todos (${cuentas.todos})`), `«Todos» cuenta al personal activo (${cuentas.todos})`)
  comprobar(etiquetas.includes(`Dentro ahora (${cuentas.dentro})`), `«Dentro ahora» cuenta lo que dice la base (${cuentas.dentro})`)
  comprobar(etiquetas.includes(`Todavía no llegan (${cuentas.faltan})`), `«Todavía no llegan» cuenta lo que dice la base (${cuentas.faltan})`)

  await pastilla(pagina, 'Dentro ahora').click()
  const dentro = pagina.getByRole('region', { name: 'Dentro ahora' })
  await dentro.waitFor({ timeout: 10000 })
  const filasDentro = (await dentro.locator('li').allTextContents()).map(limpio)
  console.log(`     dentro ahora (${filasDentro.length}): ${filasDentro.slice(0, 3).join(' · ')}`)
  comprobar(filasDentro.length === cuentas.dentro, `la lista trae ${cuentas.dentro} filas`)
  comprobar(filasDentro.some((f) => f.includes(ana.nombres) && f.includes(filas[0]?.hora)), 'Ana está dentro, con la hora de su ingreso')
  comprobar(filasDentro.some((f) => f.includes(ana.nombres) && f.includes('A tiempo')), 'y dice si llegó a tiempo')
  comprobar(!filasDentro.some((f) => f.includes(beto.nombres)), 'Beto, que no llegó, no está dentro')
  comprobar((await pagina.locator('main').getByRole('button', { name: /Marcar (el ingreso|la salida)/ }).count()) === 0, 'en la lista de lectura no hay botones de marcar')
  await pagina.waitForTimeout(300) // la pastilla cambia de color con una transición
  await pagina.screenshot({ path: `${CAPTURAS}/porteria-390-3-dentro-ahora.png` })

  await pastilla(pagina, 'Todavía no llegan').click()
  const faltan = pagina.getByRole('region', { name: 'Todavía no llegan' })
  await faltan.waitFor({ timeout: 10000 })
  const filasFaltan = (await faltan.locator('li').allTextContents()).map(limpio)
  console.log(`     todavía no llegan (${filasFaltan.length}): ${filasFaltan.slice(0, 3).join(' · ')}`)
  comprobar(filasFaltan.length === cuentas.faltan, `la lista trae ${cuentas.faltan} filas`)
  comprobar(filasFaltan.some((f) => f.includes(beto.nombres)) && !filasFaltan.some((f) => f.includes(ana.nombres)), 'Beto falta y Ana no')
  comprobar(
    filasFaltan.filter((f) => f.includes(beto.nombres)).every((f) => /(Le toca|Pasó su hora) \d\d:\d\d/.test(f) && !f.includes('Sin ingreso')),
    'la fila de Beto dice a qué hora le toca entrar, no «Sin ingreso» otra vez',
  )
  await pagina.waitForTimeout(300)
  await pagina.screenshot({ path: `${CAPTURAS}/porteria-390-4-todavia-no-llegan.png` })
  const html = await pagina.content()
  comprobar(![ana, beto, tomas].some((p) => html.includes(p.dni)), 'el DNI de nadie llega a la página')
  comprobar(!/191-6\d{7}/.test(html), 'tampoco una cuenta bancaria')

  // La búsqueda por DNI sigue contestando solo con el número completo.
  await pastilla(pagina, 'Todos').click()
  await buscar(pagina, tomas.dni.slice(0, 7))
  comprobar((await tarjetaDe(pagina, tomas).count()) === 0, 'con 7 dígitos del DNI no sale nadie')
  await buscar(pagina, tomas.dni)
  await tarjetaDe(pagina, tomas).waitFor({ timeout: 15000 })
  comprobar((await pagina.locator('main ul > li').count()) === 1, 'con los 8 dígitos queda solo su tarjeta')
  await tarjetaDe(pagina, tomas).getByRole('button', { name: /Marcar el ingreso/ }).click()
  await confirmacionDe(pagina).getByText(tomas.nombres).waitFor({ timeout: 15000 })
  dicho = limpio(await confirmacionDe(pagina).innerText())
  console.log(`     confirmación: «${dicho}»`)
  comprobar(/Tarde/.test(dicho), 'a quien entra después de su hora, la confirmación le dice «Tarde»')

  // ---------------------------------------------- 3. anular desde la confirmación
  console.log('\n3. Anular la marca de hoy desde la confirmación, con motivo')
  await confirmacionDe(pagina).getByRole('button', { name: 'Anular esta marca' }).click()
  const ventana = pagina.getByRole('dialog')
  await ventana.waitFor({ timeout: 10000 })
  const tituloVentana = limpio(await ventana.getByRole('heading').first().innerText())
  console.log(`     ventana: «${tituloVentana}»`)
  comprobar(tituloVentana.includes(tomas.nombres) && /de las \d\d:\d\d/.test(tituloVentana), 'la ventana dice de quién es la marca y de qué hora')
  comprobar((await ventana.getByText('Al menos 10 caracteres.').count()) === 1, 'y que el motivo pide al menos 10 caracteres')
  await ventana.getByRole('button', { name: 'Anular', exact: true }).click()
  comprobar((await marcasDe(tomas)).every((m) => !m.anulada), 'sin motivo no se anula')
  const motivo = `Se marcó a quien no era ${sello}`
  await ventana.getByLabel('Motivo').fill(motivo)
  await pagina.screenshot({ path: `${CAPTURAS}/porteria-390-5-anular-con-motivo.png` })
  await ventana.getByRole('button', { name: 'Anular', exact: true }).click()
  await confirmacionDe(pagina).getByText('Ingreso anulado').waitFor({ timeout: 15000 })
  dicho = limpio(await confirmacionDe(pagina).innerText())
  console.log(`     confirmación: «${dicho}»`)
  comprobar(dicho.includes(motivo), 'la confirmación pasa a «Ingreso anulado» con su motivo')
  const deTomas = await marcasDe(tomas)
  comprobar(deTomas.length === 1 && deTomas[0].anulada && deTomas[0].anulado_por === porteriaId && deTomas[0].motivo_anulacion === motivo, 'en la base la marca sigue, anulada por la portería con su motivo')
  comprobar((await confirmacionDe(pagina).getByRole('button', { name: 'Anular esta marca' }).count()) === 0, 'anulada, ya no ofrece anularla otra vez')
  comprobar(!limpio(await tarjetaDe(pagina, tomas).innerText()).includes('Ingreso marcado.'), 'la tarjeta de Tomás ya no dice «Ingreso marcado.»')
  comprobar(await confirmacionDe(pagina).getByRole('button', { name: 'Marcar a otra persona' }).evaluate((e) => e === document.activeElement), 'el cursor queda en «Marcar a otra persona»')
  await pagina.screenshot({ path: `${CAPTURAS}/porteria-390-6-marca-anulada.png` })

  // ---------------------------------------------- 4. la salida
  console.log('\n4. La salida también se confirma, y la persona deja de estar dentro')
  await confirmacionDe(pagina).getByRole('button', { name: 'Marcar a otra persona' }).click()
  comprobar(limpio(await confirmacionDe(pagina).textContent()) === '', '«Marcar a otra persona» quita la confirmación')
  comprobar(await pagina.getByRole('searchbox').evaluate((e) => e === document.activeElement && e.value === ''), 'y deja el cursor en el buscador, vacío')
  await buscar(pagina, ana.nombres)
  await tarjetaDe(pagina, ana).getByRole('button', { name: /Marcar la salida/ }).click()
  await confirmacionDe(pagina).getByText('Salida marcada').waitFor({ timeout: 15000 })
  filas = await marcasDe(ana)
  const salida = filas.find((m) => m.tipo === 'SALIDA')
  dicho = limpio(await confirmacionDe(pagina).innerText())
  console.log(`     confirmación: «${dicho}»`)
  comprobar(filas.length === 2 && Boolean(salida) && dicho.includes(salida.hora) && dicho.includes(ana.nombres), `la confirmación dice la salida de Ana a las ${salida?.hora}`)
  await pagina.screenshot({ path: `${CAPTURAS}/porteria-390-7-salida-marcada.png` })
  await buscar(pagina, '')
  cuentas = await cuentasDeHoy()
  await pastilla(pagina, 'Dentro ahora').click()
  await pagina.getByRole('group', { name: 'Qué lista se ve' }).getByRole('button', { name: `Dentro ahora (${cuentas.dentro})` }).waitFor({ timeout: 15000 })
  comprobar((await pagina.getByRole('region', { name: 'Dentro ahora' }).getByText(ana.nombres).count()) === 0, 'Ana, que ya salió, no está en «Dentro ahora»')
  await pastilla(pagina, 'Todos').click()

  // ---------------------------------------------- 5. el dedo y el ancho
  console.log('\n5. Todo lo que se toca mide 44 px y la página no se desborda (390)')
  const chicos = await pagina.locator('main').evaluate((main) =>
    [...main.querySelectorAll('button, a[href], input, summary')]
      // La «i» de ayuda se ve de 24 px y su blanco de 44 lo pone un `::after` (`TituloConAyuda`).
      .filter((e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden' && !(e.getAttribute('aria-label') ?? '').startsWith('Para qué sirve'))
      .map((e) => ({ que: (e.getAttribute('aria-label') ?? e.textContent ?? e.tagName).trim().slice(0, 40), alto: Math.round(e.getBoundingClientRect().height), ancho: Math.round(e.getBoundingClientRect().width) }))
      .filter((m) => m.alto < 44 || m.ancho < 44),
  )
  comprobar(chicos.length === 0, `ningún mando de la pantalla mide menos de 44 px${chicos.length ? `: ${JSON.stringify(chicos.slice(0, 5))}` : ''}`)
  const ancho = await pagina.evaluate(() => document.scrollingElement.scrollWidth)
  comprobar(ancho <= 390, `la página mide ${ancho} px de ancho en un teléfono de 390`)
  comprobar(puerta.errores.length === 0, `sin errores de consola${puerta.errores.length ? `: ${puerta.errores[0]}` : ''}`)
  await puerta.contexto.close()

  // En el monitor, con la misma cuenta.
  const puertaAncha = await entrar(CUENTAS.porteria, MONITOR)
  await puertaAncha.pagina.goto(`${BASE}/rrhh/asistencia`, { waitUntil: 'networkidle' })
  await buscar(puertaAncha.pagina, beto.nombres)
  await tarjetaDe(puertaAncha.pagina, beto).getByRole('button', { name: /Marcar el ingreso/ }).click()
  await confirmacionDe(puertaAncha.pagina).getByText('Ingreso marcado').waitFor({ timeout: 15000 })
  await buscar(puertaAncha.pagina, '')
  await puertaAncha.pagina.screenshot({ path: `${CAPTURAS}/porteria-1440-1-ingreso-marcado.png` })
  await pastilla(puertaAncha.pagina, 'Dentro ahora').click()
  await puertaAncha.pagina.getByRole('region', { name: 'Dentro ahora' }).waitFor({ timeout: 10000 })
  await puertaAncha.pagina.waitForTimeout(300)
  await puertaAncha.pagina.screenshot({ path: `${CAPTURAS}/porteria-1440-2-dentro-ahora.png` })
  comprobar((await marcasDe(beto)).length === 1, 'en el monitor también marca una vez')
  comprobar(puertaAncha.errores.length === 0, `sin errores de consola en el monitor${puertaAncha.errores.length ? `: ${puertaAncha.errores[0]}` : ''}`)
  await puertaAncha.contexto.close()

  // ---------------------------------------------- 6. quién mira y quién no entra
  console.log('\n6. Gerencia mira sin botones; Logística no entra')
  const gerencia = await entrar(CUENTAS.gerencia, TELEFONO)
  await gerencia.pagina.goto(`${BASE}/rrhh/asistencia`, { waitUntil: 'networkidle' })
  await gerencia.pagina.getByRole('group', { name: 'Qué lista se ve' }).waitFor({ timeout: 15000 })
  comprobar((await gerencia.pagina.locator('main').getByRole('button', { name: /Marcar (el ingreso|la salida)|Anular/ }).count()) === 0, 'Gerencia no tiene botones de marcar ni de anular')
  await pastilla(gerencia.pagina, 'Dentro ahora').click()
  comprobar((await gerencia.pagina.getByRole('region', { name: 'Dentro ahora' }).getByText(beto.nombres).count()) === 1, 'Gerencia ve a Beto en «Dentro ahora»')
  // Otro día es otra lista: la elegida hoy no se queda puesta.
  await gerencia.pagina.getByRole('link', { name: 'Día anterior' }).click()
  await gerencia.pagina.waitForURL(/fecha=/, { timeout: 15000 })
  await gerencia.pagina.getByRole('heading', { name: 'Asistencia', exact: true }).waitFor({ timeout: 15000 })
  comprobar((await gerencia.pagina.getByRole('region', { name: /Dentro ahora|Todavía no llegan/ }).count()) === 0, 'en el día anterior no queda puesta la lista de hoy')
  comprobar((await gerencia.pagina.locator('main ul > li').count()) === (await cuentasDeHoy()).todos, 'el día anterior lista a todo el personal activo')
  await gerencia.pagina.getByRole('link', { name: 'Día siguiente' }).click()
  await gerencia.pagina.getByRole('group', { name: 'Qué lista se ve' }).waitFor({ timeout: 15000 })
  comprobar((await gerencia.pagina.getByRole('group', { name: 'Qué lista se ve' }).getByRole('button', { pressed: true }).innerText()).startsWith('Todos'), 'al volver a hoy, la lista es «Todos»')
  const htmlGerencia = await gerencia.pagina.content()
  comprobar(![ana, beto, tomas].some((p) => htmlGerencia.includes(p.dni)), 'tampoco a Gerencia le llega el DNI')
  await gerencia.contexto.close()

  const logistica = await entrar(CUENTAS.logistica, TELEFONO)
  await logistica.pagina.goto(`${BASE}/rrhh/asistencia`, { waitUntil: 'networkidle' })
  comprobar(logistica.pagina.url().includes('/sin-permiso'), `Logística no entra a la asistencia (${new URL(logistica.pagina.url()).pathname})`)
  await logistica.contexto.close()
} catch (e) {
  fallas.push(`se cortó: ${e.message.split('\n')[0]}`)
  console.error(e)
} finally {
  await navegador.close()
  // El personal de la prueba no se queda en la lista del banco.
  // Como RR. HH., con su fecha de baja, como lo haría la pantalla de Personal.
  try {
    await base.query('begin')
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)`, [rrhhId])
    await base.query('set local role authenticated')
    for (const id of [ana.id, beto.id, tomas.id]) {
      const [{ activo }] = await consulta('select activo from public.trabajadores where id = $1', [id])
      if (activo) await base.query(`select public.rrhh_dar_de_baja_trabajador($1, (now() at time zone 'America/Lima')::date)`, [id])
    }
    await base.query('commit')
  } catch (e) {
    await base.query('rollback').catch(() => {})
    fallas.push(`no se pudo dar de baja al personal de prueba: ${e.message}`)
  }
  await base.end()
}

console.log(fallas.length ? `\n${fallas.length} FALLAS:\n- ${fallas.join('\n- ')}` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
