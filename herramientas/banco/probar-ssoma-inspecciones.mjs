/**
 * SSOMA: inspecciones con lista de verificación (Plan 15, entrega 15.4), con
 * clic real y la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. SSOMA, en el monitor: ve cuándo se inspeccionó cada área, como la base.
 *      Agrega un punto propio de Maestranza (tres toques, uno solo); el
 *      repetido se rechaza junto al campo; lo retira y lo restituye. Registra
 *      la inspección de Maestranza: sin marcar todo no se puede; la base
 *      rechaza la fecha de mañana junto al campo; corregida, tres toques dan
 *      una sola, con su hallazgo y la acción a cargo de Almacén, que recibe el
 *      aviso con el enlace a la inspección. Con la acción viva no se anula.
 *      Si la lista cambia con la ventana abierta, se pone al día sin cerrarla.
 *   2. Almacén, en el celular: llega por «Acciones» a la inspección y ve solo
 *      su hallazgo; cierra la acción con una foto (tres toques, un envío). La
 *      lista de inspecciones no es suya.
 *   3. SSOMA, en el celular: registra una inspección con todo conforme y la
 *      anula con su motivo: deja de ser la última del área.
 *   4. Gerencia consulta, en el monitor y en el celular: ve la lista, la lista
 *      de verificación y la ficha entera, sin ningún botón.
 *   5. RR. HH. y Ventas no entran ni por el menú ni por la dirección.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
  almacen: 'almacen.local@metalwork.test',
  rrhh: 'rrhh.local@metalwork.test',
  ventas: 'ventas.local@metalwork.test',
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
  // Los envíos de un formulario. Las preguntas que la pantalla hace sola (si un envío anterior entró, los avisos de
  // la campana) van como una lista de argumentos y no cuentan: caían a destiempo y parecían un segundo envío.
  const envios = { n: 0 }
  pagina.on('request', (r) => {
    if (r.method() === 'POST' && r.headers()['next-action'] && !(r.postData() ?? '').startsWith('[')) envios.n++
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
  const [yo] = await consulta(`select id from public.usuarios where correo = $1`, [correo])
  return { pagina, contexto, errores, envios, yo }
}

/** Tres toques seguidos al mismo botón, sin esperar entre ellos. */
async function tresToques(boton) {
  await boton.evaluate((b) => {
    b.click()
    b.click()
    b.click()
  })
}

/** Elige una cuenta en el buscador de responsables. */
async function elegirCuenta(pagina, ventana, campo, texto) {
  await ventana.locator(campo).click()
  await pagina.getByPlaceholder('Nombre, puesto o área…').fill(texto)
  await pagina.getByRole('option', { name: new RegExp(texto) }).first().click()
}

/** Marca un punto de la lista en la ventana de «Nueva inspección». */
const marcar = (ventana, punto, resultado) =>
  ventana.locator(`[data-punto="${punto}"] label`).filter({ hasText: new RegExp(`^${resultado}$`) }).click()

const sello = Date.now().toString().slice(-6)
const foto = join(tmpdir(), `ssoma-inspeccion-${sello}.jpg`)
{
  const p = await (await navegador.newContext()).newPage()
  const b64 = await p.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 800
    c.height = 600
    const g = c.getContext('2d')
    g.fillStyle = '#3d6b4f'
    g.fillRect(0, 0, 800, 600)
    g.fillStyle = '#fff'
    g.font = '32px sans-serif'
    g.fillText(`Pasillo despejado ${Math.random()}`, 30, 80)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
    const b = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return btoa(s)
  })
  writeFileSync(foto, Buffer.from(b64, 'base64'))
  await p.context().close()
}

const [{ hoy, manana }] = await consulta(
  `select (now() at time zone 'America/Lima')::date::text as hoy, ((now() at time zone 'America/Lima')::date + 1)::text as manana`,
)
const [mtz] = await consulta(`select id, nombre from public.areas where codigo = 'MTZ'`)
const [alm] = await consulta(`select id, nombre from public.areas where codigo = 'ALM'`)
const [acb] = await consulta(`select id, nombre from public.areas where codigo = 'ACB'`)
/** La última inspección vigente de un área, como la cuenta la base. */
const ultimaDe = async (area) =>
  (await consulta(`select id, fecha::text as fecha from public.ssoma_inspecciones where area_id = $1 and anulado_en is null order by fecha desc, creado_en desc limit 1`, [area]))[0] ?? null
/** Los puntos con que se inspecciona un área hoy, en el orden de la base. */
const puntosDe = async (area) =>
  consulta(
    `select id, texto from public.ssoma_lista_puntos where activo and (area_id is null or area_id = $1)
      order by (area_id is not null), orden, creado_en, id`,
    [area],
  )
const BOTONES =
  '[data-nueva-inspeccion], [data-agregar-punto], [data-cambiar-punto], [data-anular-inspeccion], [data-agregar-accion], [data-cerrar-accion], [data-reasignar-accion], [data-anular-accion], [data-reabrir-accion]'

// ------------------------------------------------------------ 1. SSOMA en el monitor
const PUNTO = `Tronzadoras con su disco sin fisuras (${sello})`
const HALLAZGO = `Retazos de plancha en el pasillo de la plegadora (${sello}).`
const QUE = `Despejar el pasillo de la plegadora y poner un cajón para los retazos (${sello}).`
const OBSERVACION = `Recorrido con el supervisor del turno (${sello}).`
let inspeccion = null
let accion = null
let respuestas = 0
{
  const { pagina, contexto, errores, envios } = await entrar(CUENTAS.ssoma, MONITOR)
  await ir(pagina, `${BASE}/ssoma`)
  comprobar((await pagina.locator('nav a[href="/ssoma/inspecciones"]').count()) >= 1, '[SSOMA 1440] el menú lleva «Inspecciones de seguridad»')
  await ir(pagina, `${BASE}/ssoma/inspecciones`)
  const areasActivas = Number((await consulta(`select count(*)::int as n from public.areas where activo`))[0].n)
  comprobar(
    (await pagina.locator('[data-area-inspeccionada]').count()) + (await pagina.locator('[data-area-sin-inspeccionar]').count()) === areasActivas,
    `[SSOMA 1440] «Por área» cuenta las ${areasActivas} áreas activas, entre las inspeccionadas y las plegadas`,
  )
  const ultimaMtz = await ultimaDe(mtz.id)
  comprobar(
    (await pagina.locator(`[data-area-${ultimaMtz ? 'inspeccionada' : 'sin-inspeccionar'}="${mtz.id}"]`).count()) === 1,
    `[SSOMA 1440] Maestranza: ${ultimaMtz ? 'con su última inspección' : 'entre las que están sin inspeccionar'}, como la base`,
  )
  const vigentes = Number((await consulta(`select count(*)::int as n from public.ssoma_inspecciones`))[0].n)
  comprobar((await pagina.locator('[data-inspeccion]').count()) === vigentes, `[SSOMA 1440] la lista trae las ${vigentes} inspecciones`)
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-inspecciones-1440.png'), fullPage: true })

  // --- La lista de verificación
  await pagina.getByRole('link', { name: /Lista de verificación/ }).click()
  await pagina.waitForURL('**/ssoma/inspecciones?vista=lista')
  await quieta(pagina)
  await pagina.locator('[data-agregar-punto]').click()
  let ventana = pagina.getByRole('dialog')
  await ventana.waitFor()
  await ventana.locator('#punto-area').selectOption(mtz.id)
  await ventana.locator('#punto-texto').fill(PUNTO)
  const antesPunto = envios.n
  await tresToques(ventana.getByRole('button', { name: 'Agregar', exact: true }))
  const verdePunto = await hasta(() => pagina.locator('p[role="status"]').filter({ hasText: 'Punto agregado' }).first().innerText().catch(() => ''), (t) => /agregado/.test(t), 30000)
  await quieta(pagina)
  const puntos = await consulta(`select id, area_id, activo from public.ssoma_lista_puntos where texto = $1`, [PUNTO])
  comprobar(puntos.length === 1 && puntos[0].area_id === mtz.id && envios.n - antesPunto === 1 && /agregado/.test(verdePunto),
    `[SSOMA 1440] tres toques: ${puntos.length} punto de Maestranza y ${envios.n - antesPunto} envío`)
  const punto = puntos[0]
  const enSuArea = await hasta(() => pagina.locator(`[data-puntos-del-area="${mtz.id}"] [data-punto-de-lista="${punto?.id}"]`).count(), (n) => n === 1, 15000)
  comprobar(enSuArea === 1, '[SSOMA 1440] el punto sale bajo Maestranza sin recargar')

  // El mismo otra vez: lo rechaza la base y se dice junto al campo.
  await pagina.locator('[data-agregar-punto]').click()
  ventana = pagina.getByRole('dialog')
  await ventana.waitFor()
  await ventana.locator('#punto-area').selectOption(mtz.id)
  await ventana.locator('#punto-texto').fill(PUNTO.toUpperCase())
  await ventana.getByRole('button', { name: 'Agregar', exact: true }).click()
  const repetido = await hasta(() => ventana.locator('#punto-texto').getAttribute('aria-invalid'), (v) => v === 'true', 15000)
  comprobar(repetido === 'true' && /ya está en la lista de Maestranza/.test(limpio(await ventana.innerText())), '[SSOMA 1440] el punto repetido se rechaza junto al campo, aunque cambien las mayúsculas')
  comprobar(await pagina.evaluate(() => document.activeElement?.id === 'punto-texto'), '[SSOMA 1440] y el cursor vuelve al campo')
  await ventana.getByRole('button', { name: 'Cancelar' }).click()

  // Retirar pregunta antes; restituir va de un toque.
  await pagina.locator(`[data-cambiar-punto="${punto?.id}"]`).click()
  ventana = pagina.getByRole('dialog')
  await ventana.waitFor()
  comprobar(
    limpio(await ventana.locator('[data-punto-por-retirar]').innerText()) === PUNTO && (await consulta(`select activo from public.ssoma_lista_puntos where id = $1`, [punto?.id]))[0]?.activo === true,
    '[SSOMA 1440] «Retirar» pregunta antes, con el punto a la vista, y todavía no lo retira',
  )
  await ventana.getByRole('button', { name: 'Retirar', exact: true }).click()
  await hasta(async () => (await consulta(`select activo from public.ssoma_lista_puntos where id = $1`, [punto?.id]))[0]?.activo, (a) => a === false, 15000)
  const [retirado] = await consulta(`select activo, retirado_por is not null as quien, retirado_en is not null as cuando from public.ssoma_lista_puntos where id = $1`, [punto?.id])
  comprobar(retirado?.activo === false && retirado?.quien && retirado?.cuando, '[SSOMA 1440] «Retirar» lo retira en la base, con quién y cuándo')
  await hasta(() => pagina.locator('[data-puntos-retirados]').count(), (n) => n === 1, 15000)
  comprobar((await pagina.locator(`[data-puntos-del-area="${mtz.id}"] [data-punto-de-lista="${punto?.id}"]`).count()) === 0, '[SSOMA 1440] deja de salir bajo Maestranza')
  await pagina.locator('[data-puntos-retirados] summary').click()
  await pagina.evaluate(() => window.scrollTo(0, 0))
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-lista-de-verificacion-1440.png'), fullPage: true })
  await pagina.locator(`[data-cambiar-punto="${punto?.id}"]`).click()
  await hasta(async () => (await consulta(`select activo from public.ssoma_lista_puntos where id = $1`, [punto?.id]))[0]?.activo, (a) => a === true, 15000)
  await hasta(() => pagina.locator(`[data-puntos-del-area="${mtz.id}"] [data-punto-de-lista="${punto?.id}"]`).count(), (n) => n === 1, 15000)
  comprobar((await consulta(`select activo from public.ssoma_lista_puntos where id = $1`, [punto?.id]))[0]?.activo === true, '[SSOMA 1440] «Restituir» lo devuelve a la lista')

  // --- La inspección de Maestranza
  await pagina.getByRole('link', { name: /^Inspecciones/ }).first().click()
  await pagina.waitForURL((u) => u.pathname === '/ssoma/inspecciones' && !u.search)
  await quieta(pagina)
  await pagina.locator('[data-nueva-inspeccion]').click()
  ventana = pagina.getByRole('dialog')
  await ventana.waitFor()
  const registrar = ventana.getByRole('button', { name: 'Registrar inspección' })
  comprobar((await registrar.isDisabled()) && /Elige el área/.test(limpio(await ventana.innerText())), '[SSOMA 1440] sin área no se puede registrar, y lo dice')
  await ventana.locator('#inspeccion-area').selectOption(mtz.id)
  const delArea = await puntosDe(mtz.id)
  respuestas = delArea.length
  comprobar((await ventana.locator('[data-punto]').count()) === delArea.length && delArea.at(-1)?.id === punto?.id,
    `[SSOMA 1440] la lista de Maestranza trae sus ${delArea.length} puntos, el propio al final`)
  for (const p of delArea.slice(2)) await marcar(ventana, p.id, 'Conforme')
  await marcar(ventana, delArea[0].id, 'No aplica')
  comprobar((await registrar.isDisabled()) && /Falta 1 punto por marcar: ir al 2/.test(limpio(await ventana.innerText())), '[SSOMA 1440] con un punto sin marcar no se puede registrar, y dice cuál falta')
  await ventana.locator('[data-ir-al-que-falta]').click()
  comprobar(await pagina.evaluate(() => document.activeElement?.id === 'inspeccion-punto-2'), '[SSOMA 1440] la nota lleva el cursor al punto que falta')
  await marcar(ventana, delArea[1].id, 'No conforme')
  await ventana.locator(`#inspeccion-hallazgo-${delArea[1].id}`).fill(HALLAZGO)
  await ventana.locator(`#inspeccion-que-${delArea[1].id}`).fill(QUE)
  comprobar((await registrar.isDisabled()) && /Falta el responsable de la acción del punto 2/.test(limpio(await ventana.innerText())), '[SSOMA 1440] sin responsable en el hallazgo no se puede registrar, y dice en qué punto')
  await elegirCuenta(pagina, ventana, `#inspeccion-responsable-${delArea[1].id}`, 'Almacén Banco')
  await ventana.locator('#inspeccion-observacion').fill(OBSERVACION)
  comprobar(await registrar.isEnabled(), '[SSOMA 1440] con todo marcado y el hallazgo con su acción, se puede registrar')

  // La fecha de mañana: el campo no la deja, así que se le quita el tope para que la rechace la base.
  await ventana.locator('#inspeccion-fecha').evaluate((e, v) => {
    e.removeAttribute('max')
    e.value = v
  }, manana)
  const antesMal = envios.n
  await registrar.click()
  const errorFecha = await hasta(() => ventana.locator('#inspeccion-fecha').getAttribute('aria-invalid'), (v) => v === 'true', 15000)
  comprobar(errorFecha === 'true' && /posterior a hoy/.test(limpio(await ventana.innerText())), '[SSOMA 1440] la base rechaza la fecha de mañana y lo dice junto al campo')
  comprobar(await pagina.evaluate(() => document.activeElement?.id === 'inspeccion-fecha'), '[SSOMA 1440] el cursor vuelve a la fecha')
  comprobar(envios.n - antesMal === 1 && (await consulta(`select 1 from public.ssoma_inspecciones where observacion = $1`, [OBSERVACION])).length === 0, '[SSOMA 1440] no quedó nada registrado')
  comprobar((await ventana.locator(`#inspeccion-hallazgo-${delArea[1].id}`).inputValue()) === HALLAZGO, '[SSOMA 1440] lo escrito sigue en la ventana')
  await ventana.locator('#inspeccion-fecha').fill(hoy)
  await ventana.locator(`[data-punto="${delArea[1].id}"]`).scrollIntoViewIfNeeded()
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-nueva-inspeccion-1440.png'), fullPage: false })

  const antes = envios.n
  await tresToques(registrar)
  const verde = await hasta(() => pagina.locator('p[role="status"]').filter({ hasText: 'Inspección registrada' }).first().innerText().catch(() => ''), (t) => /registrada/.test(t), 30000)
  await quieta(pagina)
  const filas = await consulta(
    `select i.id, i.fecha::text as fecha, i.tipo,
            (select count(*)::int from public.ssoma_inspeccion_respuestas r where r.inspeccion_id = i.id) as respuestas,
            (select count(*)::int from public.ssoma_inspeccion_respuestas r where r.inspeccion_id = i.id and r.resultado = 'NO_CONFORME') as hallazgos
       from public.ssoma_inspecciones i where i.observacion = $1`,
    [OBSERVACION],
  )
  inspeccion = filas[0]
  const acciones = await consulta(
    `select a.id, a.descripcion, a.estado, a.reporte_id, u.correo as responsable, r.hallazgo
       from public.ssoma_acciones a join public.ssoma_inspeccion_respuestas r on r.id = a.respuesta_id join public.usuarios u on u.id = a.responsable_id
      where r.inspeccion_id = $1`,
    [inspeccion?.id],
  )
  accion = acciones[0]
  comprobar(
    filas.length === 1 && inspeccion.respuestas === delArea.length && inspeccion.hallazgos === 1 && inspeccion.fecha === hoy && inspeccion.tipo === 'PLANEADA' && envios.n - antes === 1,
    `[SSOMA 1440] tres toques: ${filas.length} inspección, ${inspeccion?.respuestas} puntos, ${inspeccion?.hallazgos} hallazgo, ${envios.n - antes} envío`,
  )
  comprobar(
    acciones.length === 1 && accion.descripcion === QUE && accion.hallazgo === HALLAZGO && accion.responsable === CUENTAS.almacen && accion.reporte_id === null && accion.estado === 'ABIERTA',
    '[SSOMA 1440] el hallazgo creó su acción correctiva, a cargo de Almacén y sin inventar un reporte',
  )
  comprobar(/con 1 hallazgo: su acción ya está encargada/.test(verde), `[SSOMA 1440] el verde lo dice: «${limpio(verde)}»`)
  const avisos = await consulta(
    `select n.titulo, n.ruta from public.notificaciones n join public.usuarios u on u.id = n.usuario_id where u.correo = $1 and n.ruta like $2`,
    [CUENTAS.almacen, `%${accion?.id}`],
  )
  comprobar(avisos.length === 1 && avisos[0].ruta === `/ssoma/inspecciones/${inspeccion?.id}#accion-${accion?.id}` && /inspección de Maestranza/.test(avisos[0].titulo),
    `[SSOMA 1440] a Almacén le llegó un aviso con el enlace a la inspección: «${avisos[0]?.titulo}»`)
  const enLista = await hasta(() => pagina.locator(`[data-inspeccion="${inspeccion?.id}"]`).count(), (n) => n === 1, 15000)
  comprobar(enLista === 1, '[SSOMA 1440] la inspección nueva sale en la lista sin recargar')
  comprobar(limpio(await pagina.locator(`[data-area-inspeccionada="${mtz.id}"]`).innerText()).includes('hoy'), '[SSOMA 1440] «Por área» dice que Maestranza se inspeccionó hoy')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-inspeccion-registrada-1440.png'), fullPage: true })

  // --- La ficha
  await pagina.getByRole('link', { name: 'Ver la inspección' }).click()
  await pagina.waitForURL(`**/ssoma/inspecciones/${inspeccion?.id}`)
  await quieta(pagina)
  const main = limpio(await pagina.locator('main').innerText())
  comprobar((await pagina.locator('[data-respuesta]').count()) === delArea.length && (await pagina.locator('[data-hallazgo]').count()) === 1, `[SSOMA 1440] la ficha trae los ${delArea.length} puntos y su hallazgo`)
  comprobar(main.includes(HALLAZGO) && main.includes(QUE) && main.includes(OBSERVACION) && main.includes('Almacén Banco'), '[SSOMA 1440] con lo que se encontró, la acción, su responsable y la observación')
  comprobar((await pagina.locator(`[data-accion-ssoma="${accion?.id}"]`).count()) === 1 && (await pagina.locator(`[data-reasignar-accion], [data-anular-accion]`).count()) >= 2, '[SSOMA 1440] la acción lleva los botones de SSOMA: reasignar y anular')
  comprobar((await pagina.locator('[data-anular-inspeccion]').count()) === 0, '[SSOMA 1440] con una acción vigente no se ofrece anular la inspección')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-inspeccion-ficha-1440.png'), fullPage: true })

  // --- La lista cambia con la ventana abierta: se pone al día sin cerrarla y sin perder lo marcado.
  await ir(pagina, `${BASE}/ssoma/inspecciones`)
  await pagina.locator('[data-nueva-inspeccion]').click()
  ventana = pagina.getByRole('dialog')
  await ventana.waitFor()
  await quieta(pagina)
  await ventana.locator('#inspeccion-area').selectOption(acb.id)
  const antesDelCambio = await puntosDe(acb.id)
  for (const p of antesDelCambio) await marcar(ventana, p.id, 'Conforme')
  const OBS_ACB = `La lista cambió mientras se llenaba (${sello}).`
  await ventana.locator('#inspeccion-observacion').fill(OBS_ACB)
  {
    const otra = await contexto.newPage()
    await ir(otra, `${BASE}/ssoma/inspecciones?vista=lista`)
    await otra.locator('[data-agregar-punto]').click()
    const v = otra.getByRole('dialog')
    await v.waitFor()
    await v.locator('#punto-area').selectOption(acb.id)
    await v.locator('#punto-texto').fill(`Cabina de pintura con sus filtros al día (${sello})`)
    await v.getByRole('button', { name: 'Agregar', exact: true }).click()
    await hasta(async () => (await puntosDe(acb.id)).length, (n) => n === antesDelCambio.length + 1, 20000)
    await otra.close()
  }
  const registrarAcb = ventana.getByRole('button', { name: 'Registrar inspección' })
  await registrarAcb.click()
  const alDia = await hasta(() => ventana.locator('[data-punto]').count(), (n) => n === antesDelCambio.length + 1, 20000)
  const textoCambio = limpio(await ventana.innerText())
  comprobar(/cambió mientras llenabas la inspección/.test(textoCambio) && (await consulta(`select 1 from public.ssoma_inspecciones where observacion = $1`, [OBS_ACB])).length === 0,
    '[SSOMA 1440] si la lista cambió con la ventana abierta, la base lo rechaza y lo dice')
  comprobar(
    alDia === antesDelCambio.length + 1 && Number(await ventana.locator('[data-marcados]').getAttribute('data-marcados')) === antesDelCambio.length && (await ventana.locator('#inspeccion-observacion').inputValue()) === OBS_ACB,
    `[SSOMA 1440] la ventana se pone al día sola (${alDia} puntos) y conserva lo marcado y lo escrito`,
  )
  comprobar((await registrarAcb.isDisabled()) && new RegExp(`Falta 1 punto por marcar: ir al ${alDia}`).test(limpio(await ventana.innerText())), '[SSOMA 1440] y pide marcar el punto nuevo')
  const delAreaAhora = await puntosDe(acb.id)
  await marcar(ventana, delAreaAhora.at(-1).id, 'Conforme')
  await registrarAcb.click()
  await hasta(async () => (await consulta(`select 1 from public.ssoma_inspecciones where observacion = $1`, [OBS_ACB])).length, (n) => n === 1, 20000)
  const [deAcb] = await consulta(
    `select (select count(*)::int from public.ssoma_inspeccion_respuestas r where r.inspeccion_id = i.id) as respuestas from public.ssoma_inspecciones i where i.observacion = $1`,
    [OBS_ACB],
  )
  comprobar(deAcb?.respuestas === delAreaAhora.length, `[SSOMA 1440] marcado el que faltaba, entra con sus ${deAcb?.respuestas} puntos`)
  comprobar(errores.length === 0, `[SSOMA 1440] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 2. Almacén, en el celular: su hallazgo
{
  const { pagina, contexto, errores, envios, yo } = await entrar(CUENTAS.almacen, CELULAR)
  await ir(pagina, `${BASE}/ssoma?vista=acciones`)
  const fila = pagina.locator(`a[href="/ssoma/inspecciones/${inspeccion?.id}#accion-${accion?.id}"]`).first()
  comprobar((await fila.count()) === 1, '[Almacén 390] su lista de acciones lleva la del hallazgo, con el enlace a la inspección')
  await fila.click()
  await pagina.waitForURL(`**/ssoma/inspecciones/${inspeccion?.id}#accion-${accion?.id}`)
  await quieta(pagina)
  const main = limpio(await pagina.locator('main').innerText())
  comprobar((await pagina.locator('[data-solo-mi-hallazgo]').count()) === 1 && (await pagina.locator('[data-hallazgo]').count()) === 1 && main.includes(HALLAZGO),
    '[Almacén 390] ve la inspección con su hallazgo, y la pantalla le dice por qué ve solo eso')
  comprobar((await pagina.locator('[data-respuesta]').count()) === 0 && !main.includes(OBSERVACION) && !main.includes('Registró'), '[Almacén 390] no ve los demás puntos, la observación ni quién la registró')
  comprobar((await pagina.locator('[data-reasignar-accion], [data-anular-accion], [data-reabrir-accion], [data-agregar-accion], [data-anular-inspeccion]').count()) === 0,
    '[Almacén 390] no se le ofrece reasignar, anular ni encargar')

  await pagina.locator(`[data-cerrar-accion="${accion?.id}"]`).click()
  const vc = pagina.locator('[role="dialog"]', { has: pagina.locator(`#ssoma-hecho-${accion?.id}`) })
  await vc.waitFor({ timeout: 10000 })
  const cerrar = vc.getByRole('button', { name: 'Cerrar la acción' })
  await vc.locator(`#ssoma-hecho-${accion?.id}`).fill(`Se despejó el pasillo y se puso el cajón de retazos (${sello}).`)
  await vc.locator('input[type="file"]:not([capture])').setInputFiles(foto)
  await pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })
  await hasta(() => cerrar.isEnabled(), Boolean, 30000)
  const antes = envios.n
  await tresToques(cerrar)
  const verde = await hasta(() => pagina.locator('p[role="status"]').filter({ hasText: 'cerrada' }).first().innerText().catch(() => ''), (t) => /cerrada/.test(t), 30000)
  await quieta(pagina)
  const [cerrada] = await consulta(
    `select a.estado, (select count(*)::int from public.ssoma_accion_fotos f where f.accion_id = a.id) as fotos from public.ssoma_acciones a where a.id = $1`,
    [accion?.id],
  )
  comprobar(cerrada?.estado === 'CERRADA' && cerrada?.fotos === 1 && envios.n - antes === 1, `[Almacén 390] tres toques: cerrada con ${cerrada?.fotos} foto y ${envios.n - antes} envío («${limpio(verde)}»)`)
  const [ruta] = await consulta(`select ruta from public.ssoma_accion_fotos where accion_id = $1`, [accion?.id])
  comprobar((ruta?.ruta ?? '').startsWith(`${yo.id}/`), '[Almacén 390] la foto está en su carpeta')
  const avisoSsoma = await consulta(
    `select n.titulo, n.ruta from public.notificaciones n join public.usuarios u on u.id = n.usuario_id
      where u.correo = $1 and n.ruta = $2 and n.titulo ilike '%cerr%'`,
    [CUENTAS.ssoma, `/ssoma/inspecciones/${inspeccion?.id}#accion-${accion?.id}`],
  )
  comprobar(avisoSsoma.length === 1, `[Almacén 390] a SSOMA le llegó el aviso del cierre, con el enlace a la inspección: «${avisoSsoma[0]?.titulo}»`)
  const img = await hasta(() => pagina.locator(`[data-accion-ssoma="${accion?.id}"] img`).first().evaluate((i) => i.naturalWidth).catch(() => 0), (n) => n > 0, 20000)
  comprobar(img > 0, '[Almacén 390] ve su evidencia en la ficha')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-inspeccion-responsable-390.png'), fullPage: true })
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `[Almacén 390] la ficha no se desliza de costado (${ancho} px)`)

  comprobar((await pagina.locator('a[href="/ssoma/inspecciones"]').count()) === 0, '[Almacén 390] su menú no lleva las inspecciones')
  await ir(pagina, `${BASE}/ssoma/inspecciones`)
  comprobar(pagina.url().includes('/sin-permiso'), '[Almacén 390] la lista de inspecciones lo lleva a «sin permiso»')
  const [otra] = await consulta(`select id from public.ssoma_inspecciones where id <> $1 order by creado_en limit 1`, [inspeccion?.id])
  if (otra) {
    await ir(pagina, `${BASE}/ssoma/inspecciones/${otra.id}`)
    comprobar((await pagina.locator('[data-hallazgo], [data-respuesta]').count()) === 0, '[Almacén 390] otra inspección, por su dirección, no se le abre')
  }
  comprobar(errores.filter((e) => !e.includes('404')).length === 0, `[Almacén 390] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 3. SSOMA, en el celular: registra y anula
{
  const { pagina, contexto, errores, envios } = await entrar(CUENTAS.ssoma, CELULAR)
  await ir(pagina, `${BASE}/ssoma/inspecciones`)
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-inspecciones-390.png'), fullPage: true })
  let ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `[SSOMA 390] la lista no se desliza de costado (${ancho} px)`)
  const anterior = await ultimaDe(alm.id)

  await pagina.locator('[data-nueva-inspeccion]').click()
  const ventana = pagina.getByRole('dialog')
  await ventana.waitFor()
  await ventana.locator('#inspeccion-area').selectOption(alm.id)
  const delArea = await puntosDe(alm.id)
  for (const p of delArea) await marcar(ventana, p.id, 'Conforme')
  await ventana.getByText('No planeada', { exact: true }).click()
  const OBS = `Inspección sin aviso, registrada desde el celular (${sello}).`
  await ventana.locator('#inspeccion-observacion').fill(OBS)
  await ventana.locator(`[data-punto="${delArea[0].id}"]`).scrollIntoViewIfNeeded()
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-nueva-inspeccion-390.png'), fullPage: false })
  const registrar = ventana.getByRole('button', { name: 'Registrar inspección' })
  const antes = envios.n
  await tresToques(registrar)
  const verde = await hasta(() => pagina.locator('p[role="status"]').filter({ hasText: 'Inspección registrada' }).first().innerText().catch(() => ''), (t) => /registrada/.test(t), 30000)
  await quieta(pagina)
  const filas = await consulta(`select id, tipo from public.ssoma_inspecciones where observacion = $1`, [OBS])
  comprobar(filas.length === 1 && filas[0].tipo === 'NO_PLANEADA' && envios.n - antes === 1 && /sin hallazgos/.test(verde), `[SSOMA 390] tres toques: ${filas.length} inspección no planeada, ${envios.n - antes} envío («${limpio(verde)}»)`)
  comprobar((await ultimaDe(alm.id))?.id === filas[0]?.id, '[SSOMA 390] es la última de Almacén')

  await pagina.getByRole('link', { name: 'Ver la inspección' }).click()
  await pagina.waitForURL(`**/ssoma/inspecciones/${filas[0]?.id}`)
  await quieta(pagina)
  comprobar((await pagina.locator('[data-sin-hallazgos]').count()) === 1, '[SSOMA 390] la ficha dice «Todo conforme»')
  await pagina.locator('[data-anular-inspeccion]').click()
  const va = pagina.getByRole('dialog')
  await va.waitFor()
  await va.locator('textarea[name="motivo"]').fill('Era una prueba del celular: no se recorrió el área.')
  await va.getByRole('button', { name: 'Anular', exact: true }).click()
  const nota = await hasta(() => pagina.locator('[data-inspeccion-anulada]').innerText().catch(() => ''), (t) => /Anulada/.test(t), 20000)
  comprobar(/Ya no cuenta como la última/.test(nota) && /Motivo: Era una prueba/.test(nota), '[SSOMA 390] anulada: la ficha lo dice con su motivo')
  const [anulada] = await consulta(`select anulado_en is not null as anulada, anulado_por is not null as quien from public.ssoma_inspecciones where id = $1`, [filas[0]?.id])
  comprobar(anulada?.anulada && anulada?.quien, '[SSOMA 390] la base la anotó anulada, con quién')
  comprobar(((await ultimaDe(alm.id))?.id ?? null) === (anterior?.id ?? null), '[SSOMA 390] la última de Almacén vuelve a ser la de antes')
  comprobar((await pagina.locator('[data-anular-inspeccion]').count()) === 0, '[SSOMA 390] ya no se ofrece anularla otra vez')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-inspeccion-anulada-390.png'), fullPage: true })

  // La de Maestranza, con su acción ya cerrada y la evidencia.
  await ir(pagina, `${BASE}/ssoma/inspecciones/${inspeccion?.id}`)
  comprobar((await pagina.locator(`[data-accion-ssoma="${accion?.id}"][data-estado="CERRADA"]`).count()) === 1 && (await pagina.locator('[data-reabrir-accion]').count()) === 1,
    '[SSOMA 390] ve la acción cerrada por Almacén y puede reabrirla')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-inspeccion-ficha-390.png'), fullPage: true })
  ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `[SSOMA 390] la ficha no se desliza de costado (${ancho} px)`)
  await ir(pagina, `${BASE}/ssoma/inspecciones?vista=lista`)
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-lista-de-verificacion-390.png'), fullPage: true })
  ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `[SSOMA 390] la lista de verificación no se desliza de costado (${ancho} px)`)
  comprobar(errores.length === 0, `[SSOMA 390] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 4. Gerencia consulta
for (const viewport of [MONITOR, CELULAR]) {
  const tam = viewport.width
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia, viewport)
  await ir(pagina, `${BASE}/ssoma/inspecciones`)
  comprobar(pagina.url().includes('/ssoma/inspecciones') && (await pagina.locator(`[data-inspeccion="${inspeccion?.id}"]`).count()) === 1, `[Gerencia ${tam}] entra a las inspecciones y ve la de Maestranza`)
  comprobar((await pagina.locator(BOTONES).count()) === 0, `[Gerencia ${tam}] sin «Nueva inspección»`)
  await pagina.screenshot({ path: join(CAPTURAS, `ssoma-inspecciones-gerencia-${tam}.png`), fullPage: true })
  await ir(pagina, `${BASE}/ssoma/inspecciones?vista=lista`)
  comprobar((await pagina.locator('[data-punto-de-lista]').count()) >= 10 && (await pagina.locator(BOTONES).count()) === 0, `[Gerencia ${tam}] ve la lista de verificación, sin agregar ni retirar`)
  await ir(pagina, `${BASE}/ssoma/inspecciones/${inspeccion?.id}`)
  const main = limpio(await pagina.locator('main').innerText())
  comprobar((await pagina.locator('[data-respuesta]').count()) === respuestas && main.includes(HALLAZGO) && main.includes(OBSERVACION), `[Gerencia ${tam}] ve la ficha entera: los ${respuestas} puntos, el hallazgo y la observación`)
  comprobar((await pagina.locator(BOTONES).count()) === 0, `[Gerencia ${tam}] sin ningún botón en la ficha`)
  const img = await hasta(() => pagina.locator(`[data-accion-ssoma="${accion?.id}"] img`).first().evaluate((i) => i.naturalWidth).catch(() => 0), (n) => n > 0, 20000)
  comprobar(img > 0, `[Gerencia ${tam}] ve la evidencia del cierre`)
  await pagina.screenshot({ path: join(CAPTURAS, `ssoma-inspeccion-gerencia-${tam}.png`), fullPage: true })
  comprobar(errores.length === 0, `[Gerencia ${tam}] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 5. Quien no debe entrar
for (const [puesto, correo] of [
  ['RR. HH.', CUENTAS.rrhh],
  ['Ventas', CUENTAS.ventas],
]) {
  const { pagina, contexto } = await entrar(correo, MONITOR)
  await ir(pagina, `${BASE}/ssoma`)
  comprobar((await pagina.locator('a[href="/ssoma/inspecciones"]').count()) === 0, `[${puesto}] el menú no lleva las inspecciones`)
  await ir(pagina, `${BASE}/ssoma/inspecciones`)
  comprobar(pagina.url().includes('/sin-permiso'), `[${puesto}] la lista lo lleva a «sin permiso»`)
  await ir(pagina, `${BASE}/ssoma/inspecciones?vista=lista`)
  comprobar(pagina.url().includes('/sin-permiso'), `[${puesto}] la lista de verificación también`)
  await ir(pagina, `${BASE}/ssoma/inspecciones/${inspeccion?.id}`)
  const texto = limpio(await pagina.locator('body').innerText())
  comprobar(!texto.includes(HALLAZGO) && !texto.includes('Maestranza') && (await pagina.locator('[data-hallazgo], [data-respuesta]').count()) === 0, `[${puesto}] la ficha por su dirección no existe para él`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
