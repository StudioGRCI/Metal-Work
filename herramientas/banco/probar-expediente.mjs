/**
 * El expediente del trámite (plan «El puesto de Tramitador», entrega 2,
 * migración 20261126998800), con clic real y la cuenta de cada puesto (nunca
 * ADMIN):
 *
 *   1. El Tramitador, en el monitor: la ficha nace con el expediente vacío.
 *      Sube el cargo (tres toques dan una subida y un archivo), lo abre con
 *      «Ver», y un «otro documento» sin decir qué es se rechaza sin dejar nada
 *      suelto en Storage. Anota una gestión (tres toques, una) y otra con fecha
 *      futura no entra. Cierra el trámite con su documento final: queda
 *      «Concluido», sin «Actualizar» ni plazo, en la vista «Concluidos». Desde
 *      otra pestaña que quedó con la ficha de antes no se cierra otra vez.
 *      Retira el documento final con su motivo: el trámite se reabre y el
 *      archivo queda en «Retirados». Lo cierra de nuevo. El que se renueva pide
 *      hasta cuándo vale. Buscar la placa encuentra el concluido sin cambiar de vista.
 *   2. El Tramitador, en el celular: la ficha y la ventana no se deslizan de
 *      costado, y el verde de anotar una gestión se ve junto a su botón.
 *   3. Gerencia y Administración leen todo el expediente, también lo retirado,
 *      sin botones.
 *   4. Ventas lee el del trámite de la unidad, sin lo retirado; el archivo
 *      retirado y el de la empresa, ni por su dirección.
 *   5. Tesorería: la dirección de un archivo la manda a «Sin permiso».
 *
 * Deja en el banco los dos trámites concluidos: un documento numerado no se borra.
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
  tramitador: 'tramitador.local@metalwork.test',
  gerencia: 'gerencia.local@metalwork.test',
  administracion: 'administracion.local@metalwork.test',
  ventas: 'ventas.local@metalwork.test',
  tesoreria: 'tesoreria.local@metalwork.test',
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

/** Lo que hace una cuenta en la base, como ella: con su sesión y el rol `authenticated`, nunca como dueño. */
async function como(correo, sql, valores = []) {
  const [u] = await consulta(`select id from public.usuarios where correo = $1`, [correo])
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                             set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [u.id])
    await base.query('set local role authenticated')
    const r = await base.query(sql, valores)
    await base.query('commit')
    return r
  } catch (e) {
    await base.query('rollback')
    throw e
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

// ------------------------------------------------------------ los dos trámites de la prueba
const [unidad] = await consulta(
  `select u.id, u.placa from public.unidades u
    where u.activo and u.placa is not null and nullif(btrim(u.codigo_interno), '') is distinct from 'TODOS LOS ACTIVOS'
    order by u.placa limit 1`,
)
if (!unidad) throw new Error('El banco no trae ninguna unidad con placa.')
const [{ hoy, ayer, manana, en1a }] = await consulta(
  `select h::text as hoy, (h - 1)::text as ayer, (h + 1)::text as manana, (h + 365)::text as en1a
     from (select (now() at time zone 'America/Lima')::date as h) x`,
)
const [tipoTarjeta] = await consulta(`select id from public.tramite_tipos where nombre = 'Tarjeta de propiedad'`)
const [tipoSoat] = await consulta(`select id from public.tramite_tipos where nombre = 'SOAT'`)
const sello = Date.now().toString().slice(-6)
const ASUNTO_UNIDAD = `Tarjeta de propiedad para el expediente (${sello})`
const ASUNTO_EMPRESA = `SOAT para el expediente (${sello})`
// Los registra el Tramitador, con su sesión: el de la unidad, presentado hace diez días y ya vencido.
const tarjeta = (
  await como(
    CUENTAS.tramitador,
    `select tramite, numero_tramite from public.tramites_registrar(gen_random_uuid(), $1, $2, null, $3, 'SUNARP', $4, $5::date - 10, $5::date - 1, null)`,
    [tipoTarjeta.id, unidad.id, ASUNTO_UNIDAD, `T-${sello}`, hoy],
  )
).rows[0]
const soat = (
  await como(
    CUENTAS.tramitador,
    `select tramite, numero_tramite from public.tramites_registrar(gen_random_uuid(), $1, null, null, $2, 'Aseguradora', null, $3::date - 2, null, null)`,
    [tipoSoat.id, ASUNTO_EMPRESA, hoy],
  )
).rows[0]

const PDF = (texto) => Buffer.from(`%PDF-1.4\n1 0 obj <<>> endobj\n% ${texto}\ntrailer <<>>\n%%EOF\n`)
const archivo = (nombre) => ({ name: nombre, mimeType: 'application/pdf', buffer: PDF(nombre) })

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
  const cuenta = { acciones: 0, subidas: 0 }
  const escuchar = (p) => {
    p.on('console', (m) => {
      const t = m.text()
      if (m.type() === 'error' && !t.includes('_next/hmr') && !t.includes('WebSocket')) errores.push(t.slice(0, 300))
    })
    // Cada envío de un formulario del expediente y cada subida a Storage: la
    // pregunta por los avisos, que sale sola, no lleva ninguno de estos campos.
    p.on('request', (r) => {
      if (r.method() !== 'POST') return
      if (r.url().includes('/storage/v1/object/tramites/')) cuenta.subidas++
      else if (r.headers()['next-action'] && /tramite_id|motivo/.test(r.postData() ?? '')) cuenta.acciones++
    })
  }
  escuchar(pagina)
  await ir(pagina, `${BASE}/ingresar`)
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  await quieta(pagina)
  return { pagina, contexto, errores, cuenta, escuchar }
}

async function tresToques(boton) {
  await boton.evaluate((b) => {
    b.click()
    b.click()
    b.click()
  })
}

/** La captura, sin el indicador de `next dev`. En el celular, lo que se ve en la pantalla. */
async function captura(pagina, nombre, completa = true) {
  await pagina.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
  const entera = completa && (pagina.viewportSize()?.width ?? 0) >= 500
  if (entera) await pagina.evaluate(() => window.scrollTo(0, 0))
  await pagina.screenshot({ path: join(CAPTURAS, nombre), fullPage: entera })
}

const ventanaDe = (pagina) => pagina.locator('[role="dialog"]', { has: pagina.locator('form') }).last()
// El verde sale junto al botón que se tocó: en el encabezado, o en la tarjeta del expediente o de las gestiones.
const verdeDe = async (pagina) => (await pagina.locator('p[role="status"][data-aviso]').allInnerTexts().catch(() => [])).join(' ').trim()
const anchoDe = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth)
const tramite = async (id) => (await consulta(`select * from public.tramites where id = $1`, [id]))[0] ?? null
const archivosDe = (id) => consulta(`select * from public.tramite_archivos where tramite_id = $1 order by creado_en`, [id])
const gestionesDe = (id) => consulta(`select * from public.tramite_gestiones where tramite_id = $1 order by creado_en`, [id])
/** Lo subido a la carpeta del trámite que ninguna fila nombra: tiene que ser cero siempre. */
const sueltos = async (id) =>
  (
    await consulta(
      `select count(*)::int as n from storage.objects o
        where o.bucket_id = 'tramites' and o.name like $1 || '/%'
          and not exists (select 1 from public.tramite_archivos a where a.archivo_ruta = o.name)`,
      [id],
    )
  )[0].n
/** Abre la dirección de un archivo con la sesión de la página y dice en qué terminó. */
async function abrir(contexto, id) {
  const r = await contexto.request.get(`${BASE}/tramites/archivo/${id}`, { maxRedirects: 5 })
  const cuerpo = await r.body().catch(() => Buffer.from(''))
  // Si no se puede, la dirección vuelve a la lista con su aviso (`?archivo=fallo`).
  return { estado: r.status(), url: r.url(), esPdf: cuerpo.subarray(0, 5).toString() === '%PDF-', fallo: r.url().includes('archivo=fallo') }
}
const boton = (pagina, nombre) => pagina.getByRole('button', { name: nombre, exact: true })

let cargoId = null
let finalRetiradoId = null
let finalSoatId = null

// ============================================================ 1. El Tramitador lleva el expediente
{
  const { pagina, contexto, errores, cuenta, escuchar } = await entrar(CUENTAS.tramitador)
  await ir(pagina, `${BASE}/tramites/${tarjeta.tramite}`)
  comprobar((await pagina.getByRole('heading', { name: tarjeta.numero_tramite }).count()) === 1, `[Tramitador 1440] abre la ficha de ${tarjeta.numero_tramite}`)
  const expediente = pagina.locator('#expediente')
  const gestiones = pagina.locator('#gestiones')
  comprobar(/El expediente está vacío/.test(await expediente.innerText()) && /Todavía no hay gestiones/.test(await gestiones.innerText()),
    '[Tramitador 1440] la ficha nace con el expediente vacío y sin gestiones, y lo dice')
  comprobar((await boton(pagina, 'Actualizar').count()) === 1 && (await boton(pagina, 'Cerrar con el documento final').count()) === 1,
    '[Tramitador 1440] presentado, ofrece «Actualizar» y «Cerrar con el documento final»')

  // --- «otro documento» sin decir qué es: se rechaza y no queda nada suelto
  await boton(pagina, 'Subir archivo').click()
  let v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('input[name="clase"][value="OTRO"]').check()
  const descripcion = v.locator('input[name="descripcion"]')
  comprobar((await descripcion.getAttribute('required')) !== null, '[Tramitador 1440] «Otro documento» pide decir qué es')
  await descripcion.evaluate((el) => {
    el.removeAttribute('required')
    el.removeAttribute('minlength')
  })
  await v.locator('input[type="file"]').setInputFiles(archivo('esquela.pdf'))
  await v.getByRole('button', { name: 'Guardar en el expediente' }).click()
  const rechazo = await hasta(() => v.locator('[role="alert"]').first().innerText().catch(() => ''), (t) => t.length > 0)
  comprobar(/qué documento es/.test(rechazo), `[Tramitador 1440] sin la descripción, lo dice en la ventana: «${limpio(rechazo).slice(0, 90)}»`)
  comprobar((await archivosDe(tarjeta.tramite)).length === 0 && (await hasta(() => sueltos(tarjeta.tramite), (n) => n === 0)) === 0,
    '[Tramitador 1440] el rechazo no dejó archivo en el expediente ni suelto en Storage')
  await v.getByRole('button', { name: 'Cancelar' }).click()

  // --- el cargo: tres toques, una subida, un archivo
  await boton(pagina, 'Subir archivo').click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  comprobar(await v.locator('input[name="clase"][value="CARGO"]').isChecked(), '[Tramitador 1440] la ventana propone «Cargo»')
  await v.locator('input[name="descripcion"]').fill('Cargo de mesa de partes')
  await v.locator('input[type="file"]').setInputFiles(archivo(`cargo-${sello}.pdf`))
  if (process.env.CAPTURAS) await captura(pagina, 'expediente-subir-archivo-1440.png', false)
  cuenta.acciones = 0
  cuenta.subidas = 0
  await tresToques(v.getByRole('button', { name: 'Guardar en el expediente' }))
  const verde = await hasta(() => verdeDe(pagina), (t) => /Archivo guardado/.test(t))
  let filas = await archivosDe(tarjeta.tramite)
  comprobar(/Archivo guardado en el expediente/.test(verde) && filas.length === 1 && cuenta.subidas === 1 && cuenta.acciones === 1,
    `[Tramitador 1440] tres toques suben un solo archivo (subidas ${cuenta.subidas}, envíos ${cuenta.acciones}, filas ${filas.length}) y lo dice: «${limpio(verde)}»`)
  cargoId = filas[0]?.id
  comprobar(filas[0]?.clase === 'CARGO' && filas[0]?.descripcion === 'Cargo de mesa de partes' && filas[0]?.archivo_nombre === `cargo-${sello}.pdf`,
    '[Tramitador 1440] quedó como «Cargo», con su descripción y el nombre con que se subió')
  const fila = expediente.locator('[data-archivo="CARGO"]').first()
  await fila.waitFor({ timeout: 15000 })
  comprobar(/Cargo de mesa de partes/.test(await fila.innerText()) && /Lo subió/.test(await fila.innerText()),
    '[Tramitador 1440] la ficha lo lista con quién lo subió')
  const visto = await abrir(contexto, cargoId)
  comprobar(visto.estado === 200 && visto.esPdf, `[Tramitador 1440] «Ver» abre el PDF (estado ${visto.estado})`)

  // --- las gestiones
  await boton(pagina, 'Anotar gestión').click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  comprobar((await v.locator('input[name="fecha"]').inputValue()) === hoy, '[Tramitador 1440] la gestión propone la fecha de hoy')
  await v.locator('input[name="fecha"]').evaluate((el) => el.removeAttribute('max'))
  await v.locator('input[name="fecha"]').fill(manana)
  await v.locator('textarea[name="detalle"]').fill('Se dejó el expediente en mesa de partes.')
  await v.getByRole('button', { name: 'Anotar la gestión' }).click()
  const futura = await hasta(() => v.locator('[role="alert"]').first().innerText().catch(() => ''), (t) => t.length > 0)
  comprobar(/no puede ser futura/.test(futura) && (await v.locator('textarea[name="detalle"]').inputValue()).startsWith('Se dejó'),
    `[Tramitador 1440] una gestión con fecha futura no entra, y lo escrito sigue: «${limpio(futura).slice(0, 80)}»`)
  await v.locator('input[name="fecha"]').fill(ayer)
  cuenta.acciones = 0
  await tresToques(v.getByRole('button', { name: 'Anotar la gestión' }))
  await hasta(() => verdeDe(pagina), (t) => /Gestión anotada/.test(t))
  const anotadas = await gestionesDe(tarjeta.tramite)
  comprobar(anotadas.length === 1 && cuenta.acciones === 1, `[Tramitador 1440] tres toques anotan una sola gestión (envíos ${cuenta.acciones}, filas ${anotadas.length})`)
  await gestiones.locator('[data-gestion]').first().waitFor({ timeout: 15000 })
  comprobar(/Se dejó el expediente en mesa de partes\./.test(await gestiones.innerText()) && /Anotó/.test(await gestiones.innerText()),
    '[Tramitador 1440] la bitácora la muestra con quién la anotó')

  // --- otra pestaña se queda con la ficha de antes de cerrar
  const deAntes = await contexto.newPage()
  escuchar(deAntes)
  await ir(deAntes, `${BASE}/tramites/${tarjeta.tramite}`)

  // --- cerrar con el documento final
  await boton(pagina, 'Cerrar con el documento final').click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  comprobar((await v.locator('input[name="vigente_hasta"]').count()) === 0, '[Tramitador 1440] el que no se renueva no pide vigencia')
  await v.locator('input[type="file"]').setInputFiles(archivo(`tarjeta-${sello}.pdf`))
  if (process.env.CAPTURAS) await captura(pagina, 'expediente-cerrar-1440.png', false)
  cuenta.acciones = 0
  cuenta.subidas = 0
  await tresToques(v.getByRole('button', { name: 'Cerrar el trámite' }))
  await hasta(() => verdeDe(pagina), (t) => /Trámite concluido/.test(t))
  let t = await tramite(tarjeta.tramite)
  filas = await archivosDe(tarjeta.tramite)
  comprobar(t.estado === 'CONCLUIDO' && t.concluido_en !== null && filas.filter((a) => a.clase === 'DOCUMENTO_FINAL').length === 1 && cuenta.subidas === 1 && cuenta.acciones === 1,
    `[Tramitador 1440] tres toques lo cierran una vez, con un solo documento final (subidas ${cuenta.subidas}, envíos ${cuenta.acciones})`)
  await pagina.locator('[data-concluido]').waitFor({ timeout: 15000 })
  comprobar((await pagina.locator('[data-situacion="CONCLUIDO"]').count()) === 1 && (await pagina.locator('[data-plazo]').count()) === 0,
    '[Tramitador 1440] la ficha dice «Concluido» y deja de contar el plazo que había vencido')
  comprobar((await boton(pagina, 'Actualizar').count()) === 0 && (await boton(pagina, 'Cerrar con el documento final').count()) === 0
      && (await boton(pagina, 'Subir archivo').count()) === 1 && (await boton(pagina, 'Anotar gestión').count()) === 1,
    '[Tramitador 1440] concluido: sin «Actualizar» ni «Cerrar», y el expediente sigue abierto')
  comprobar((await pagina.locator('[data-ver-documento-final]').count()) === 1, '[Tramitador 1440] el cierre lleva a su documento final')
  if (process.env.CAPTURAS) await captura(pagina, 'expediente-ficha-concluida-tramitador-1440.png')

  // --- desde la pestaña que quedó abierta no se cierra otra vez
  await boton(deAntes, 'Cerrar con el documento final').click()
  let va = ventanaDe(deAntes)
  await va.waitFor({ timeout: 15000 })
  await va.locator('input[type="file"]').setInputFiles(archivo('otra-tarjeta.pdf'))
  await va.getByRole('button', { name: 'Cerrar el trámite' }).click()
  const yaCerrado = await hasta(() => va.locator('[role="alert"]').first().innerText().catch(() => ''), (x) => x.length > 0)
  comprobar(/ya está concluido/.test(yaCerrado), `[Tramitador 1440] desde la pestaña de antes no se cierra otra vez: «${limpio(yaCerrado).slice(0, 90)}»`)
  comprobar((await archivosDe(tarjeta.tramite)).length === 2 && (await hasta(() => sueltos(tarjeta.tramite), (n) => n === 0)) === 0,
    '[Tramitador 1440] y el archivo de ese intento no quedó suelto en Storage')
  await deAntes.close()

  // --- la lista
  await ir(pagina, `${BASE}/tramites?vista=concluidos`)
  const enLista = pagina.locator(`[data-tramite="${tarjeta.numero_tramite}"]`)
  comprobar((await enLista.count()) === 1 && /Documento del/.test(await enLista.innerText()) && /2 archivos/.test(await enLista.innerText()),
    '[Tramitador 1440] sale en «Concluidos», con la fecha de su documento y sus 2 archivos')
  if (process.env.CAPTURAS) await captura(pagina, 'expediente-lista-concluidos-1440.png')
  await ir(pagina, `${BASE}/tramites`)
  comprobar((await pagina.locator(`[data-tramite="${tarjeta.numero_tramite}"]`).count()) === 0, '[Tramitador 1440] y ya no en «En curso»')
  // Buscar sin elegir vista abre la que tiene resultados: lo concluido también se encuentra.
  await ir(pagina, `${BASE}/tramites?buscar=${encodeURIComponent(`T-${sello}`)}`)
  comprobar((await pagina.locator(`[data-tramite="${tarjeta.numero_tramite}"]`).count()) === 1,
    '[Tramitador 1440] buscar su expediente lo encuentra aunque ya esté concluido, sin cambiar de vista')
  await ir(pagina, `${BASE}/tramites?vista=en-curso&buscar=${encodeURIComponent(`T-${sello}`)}`)
  comprobar(/1 en «Concluidos»/.test(await pagina.locator('main').first().innerText()),
    '[Tramitador 1440] y en «En curso» dice que está en «Concluidos»')

  // --- retirar el documento final lo reabre
  await ir(pagina, `${BASE}/tramites/${tarjeta.tramite}`)
  const final = pagina.locator('#expediente [data-archivo="DOCUMENTO_FINAL"]').first()
  await final.getByRole('button', { name: /^Retirar/ }).click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  comprobar(/se reabre/.test(await v.innerText()), '[Tramitador 1440] retirar el documento final avisa que el trámite se reabre')
  await v.locator('textarea[name="motivo"]').fill('Se subió la tarjeta de otra unidad.')
  cuenta.acciones = 0
  await tresToques(v.getByRole('button', { name: 'Retirar y reabrir el trámite' }))
  const reabierto = await hasta(() => verdeDe(pagina), (x) => /retirado/.test(x))
  t = await tramite(tarjeta.tramite)
  filas = await archivosDe(tarjeta.tramite)
  finalRetiradoId = filas.find((a) => a.clase === 'DOCUMENTO_FINAL' && a.retirado_en)?.id ?? null
  comprobar(t.estado === 'EN_TRAMITE' && t.concluido_en === null && finalRetiradoId !== null && cuenta.acciones === 1,
    `[Tramitador 1440] tres toques lo retiran una vez y el trámite vuelve a «En trámite» (envíos ${cuenta.acciones}): «${limpio(reabierto).slice(0, 80)}»`)
  const retirados = pagina.locator('[data-archivos-retirados]')
  await retirados.waitFor({ timeout: 15000 })
  await retirados.locator('summary').click()
  comprobar(/Retirados \(1\)/.test(await retirados.innerText()) && /Se subió la tarjeta de otra unidad\./.test(await retirados.innerText()),
    '[Tramitador 1440] el retirado queda a la vista en «Retirados», con su motivo')
  comprobar((await boton(pagina, 'Cerrar con el documento final').count()) === 1 && (await pagina.locator('[data-plazo]').count()) === 1,
    '[Tramitador 1440] reabierto, vuelve a ofrecer el cierre y a contar su plazo')
  if (process.env.CAPTURAS) await captura(pagina, 'expediente-ficha-reabierta-tramitador-1440.png')

  // --- y se cierra de nuevo con el correcto
  await boton(pagina, 'Cerrar con el documento final').click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('input[type="file"]').setInputFiles(archivo(`tarjeta-buena-${sello}.pdf`))
  await v.getByRole('button', { name: 'Cerrar el trámite' }).click()
  await hasta(() => verdeDe(pagina), (x) => /Trámite concluido/.test(x))
  t = await tramite(tarjeta.tramite)
  comprobar(t.estado === 'CONCLUIDO' && (await archivosDe(tarjeta.tramite)).filter((a) => a.clase === 'DOCUMENTO_FINAL' && !a.retirado_en).length === 1,
    '[Tramitador 1440] se cierra otra vez con el documento correcto: uno solo en pie')

  // --- el que se renueva pide hasta cuándo vale
  await ir(pagina, `${BASE}/tramites/${soat.tramite}`)
  await boton(pagina, 'Cerrar con el documento final').click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  const vigencia = v.locator('input[name="vigente_hasta"]')
  comprobar((await vigencia.count()) === 1 && (await vigencia.getAttribute('required')) !== null && (await vigencia.getAttribute('min')) === manana,
    '[Tramitador 1440] el que se renueva pide «Vigente hasta», después de la fecha del documento')
  await vigencia.evaluate((el) => el.removeAttribute('min'))
  await vigencia.fill(hoy)
  await v.locator('input[type="file"]').setInputFiles(archivo(`soat-${sello}.pdf`))
  await v.getByRole('button', { name: 'Cerrar el trámite' }).click()
  const corta = await hasta(() => v.locator('[role="alert"]').first().innerText().catch(() => ''), (x) => x.length > 0)
  comprobar(/después de la fecha del documento/.test(corta) && (await tramite(soat.tramite)).estado === 'EN_TRAMITE',
    `[Tramitador 1440] una vigencia que no pasa de la fecha del documento no lo cierra: «${limpio(corta).slice(0, 80)}»`)
  comprobar((await hasta(() => sueltos(soat.tramite), (n) => n === 0)) === 0, '[Tramitador 1440] ni deja el documento suelto en Storage')
  await vigencia.fill(en1a)
  await v.getByRole('button', { name: 'Cerrar el trámite' }).click()
  await hasta(() => verdeDe(pagina), (x) => /Trámite concluido/.test(x))
  t = await tramite(soat.tramite)
  finalSoatId = (await archivosDe(soat.tramite))[0]?.id ?? null
  comprobar(t.estado === 'CONCLUIDO' && t.vigente_hasta !== null && finalSoatId !== null, '[Tramitador 1440] el SOAT queda concluido con su vigencia')
  await pagina.locator('[data-concluido]').waitFor({ timeout: 15000 })
  comprobar(/Vale hasta el/.test(await pagina.locator('[data-concluido]').innerText()), '[Tramitador 1440] y la ficha dice hasta cuándo vale')

  comprobar(errores.length === 0, `[Tramitador 1440] sin errores de consola${errores.length ? `: ${errores.slice(0, 2).join(' | ')}` : ''}`)
  await contexto.close()
}

// ============================================================ 2. El Tramitador en el celular
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.tramitador, CELULAR)
  await ir(pagina, `${BASE}/tramites/${tarjeta.tramite}`)
  comprobar((await anchoDe(pagina)) <= CELULAR.width, `[Tramitador 390] la ficha con su expediente no se desliza de costado (${await anchoDe(pagina)} px)`)
  if (process.env.CAPTURAS) await captura(pagina, 'expediente-ficha-tramitador-390.png')
  await pagina.locator('#expediente').scrollIntoViewIfNeeded()
  await pagina.locator('#expediente').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  if (process.env.CAPTURAS) await captura(pagina, 'expediente-archivos-tramitador-390.png')
  // La «i» de la tarjeta es la de la casa: mide 24 px y su zona de toque la da su propio borde.
  const chicos = await pagina.locator('#expediente a, #expediente button, #gestiones button').evaluateAll((els) =>
    els.filter((e) => !(e.getAttribute('aria-label') ?? '').startsWith('Para qué sirve')).filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 40).map((e) => (e.textContent ?? '').trim().slice(0, 20)),
  )
  comprobar(chicos.length === 0, `[Tramitador 390] los botones del expediente tienen alto para el dedo${chicos.length ? `: ${chicos.join(', ')}` : ''}`)
  await boton(pagina, 'Subir archivo').click()
  const v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  comprobar((await anchoDe(pagina)) <= CELULAR.width, `[Tramitador 390] la ventana de subir tampoco (${await anchoDe(pagina)} px)`)
  if (process.env.CAPTURAS) await captura(pagina, 'expediente-subir-archivo-390.png')
  await v.getByRole('button', { name: 'Cancelar' }).click()
  await pagina.locator('#gestiones').evaluate((el) => el.scrollIntoView({ block: 'start' }))
  // El verde de la gestión sale en su tarjeta: el encabezado queda lejos, arriba.
  await boton(pagina, 'Anotar gestión').click()
  const vg = ventanaDe(pagina)
  await vg.waitFor({ timeout: 15000 })
  await vg.locator('textarea[name="detalle"]').fill('Se entregó la tarjeta al cliente.')
  await vg.getByRole('button', { name: 'Anotar la gestión' }).click()
  const aviso = pagina.locator('#gestiones [data-aviso="gestiones"]')
  await hasta(() => aviso.innerText().catch(() => ''), (x) => /Gestión anotada/.test(x))
  const caja = await aviso.boundingBox()
  comprobar(Boolean(caja) && caja.y >= 0 && caja.y + caja.height <= CELULAR.height,
    `[Tramitador 390] el verde de la gestión se ve sin subir la pantalla (a ${Math.round(caja?.y ?? -1)} px de ${CELULAR.height})`)
  if (process.env.CAPTURAS) await captura(pagina, 'expediente-gestiones-tramitador-390.png')
  await ir(pagina, `${BASE}/tramites?vista=concluidos`)
  comprobar((await anchoDe(pagina)) <= CELULAR.width, `[Tramitador 390] la lista con la vista «Concluidos» no se desliza de costado (${await anchoDe(pagina)} px)`)
  if (process.env.CAPTURAS) await captura(pagina, 'expediente-lista-concluidos-390.png')
  comprobar(errores.length === 0, `[Tramitador 390] sin errores de consola${errores.length ? `: ${errores.slice(0, 2).join(' | ')}` : ''}`)
  await contexto.close()
}

// ============================================================ 3. Gerencia y Administración consultan
for (const [nombre, correo] of [['Gerencia', CUENTAS.gerencia], ['Administración', CUENTAS.administracion]]) {
  const { pagina, contexto, errores } = await entrar(correo)
  await ir(pagina, `${BASE}/tramites/${tarjeta.tramite}`)
  const expediente = pagina.locator('#expediente')
  comprobar((await expediente.locator('[data-archivos] > li').count()) === 2 && (await pagina.locator('[data-archivos-retirados]').count()) === 1,
    `[${nombre}] lee el expediente entero: los 2 archivos en pie y lo retirado`)
  comprobar((await pagina.locator('#gestiones [data-gestion]').count()) === 2, `[${nombre}] lee la bitácora`)
  comprobar((await boton(pagina, 'Subir archivo').count()) === 0 && (await boton(pagina, 'Anotar gestión').count()) === 0
      && (await boton(pagina, 'Cerrar con el documento final').count()) === 0 && (await pagina.getByRole('button', { name: /^Retirar/ }).count()) === 0,
    `[${nombre}] consulta: sin subir, anotar, cerrar ni retirar`)
  const visto = await abrir(contexto, cargoId)
  const retirado = await abrir(contexto, finalRetiradoId)
  comprobar(visto.estado === 200 && visto.esPdf && retirado.estado === 200 && retirado.esPdf, `[${nombre}] abre el cargo y también el documento retirado`)
  if (process.env.CAPTURAS && nombre === 'Gerencia') await captura(pagina, 'expediente-ficha-gerencia-1440.png')
  comprobar(errores.length === 0, `[${nombre}] sin errores de consola${errores.length ? `: ${errores.slice(0, 2).join(' | ')}` : ''}`)
  await contexto.close()
}

// ============================================================ 4. Ventas: el de la unidad, sin lo retirado
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.ventas)
  await ir(pagina, `${BASE}/tramites/${tarjeta.tramite}`)
  comprobar((await pagina.locator('#expediente [data-archivos] > li').count()) === 2 && (await pagina.locator('[data-archivos-retirados]').count()) === 0,
    '[Ventas] lee el expediente del trámite de la unidad, sin lo retirado')
  comprobar((await pagina.locator('#gestiones [data-gestion]').count()) === 2 && (await boton(pagina, 'Subir archivo').count()) === 0,
    '[Ventas] lee la bitácora y no tiene botones')
  const visto = await abrir(contexto, cargoId)
  const retirado = await abrir(contexto, finalRetiradoId)
  const deLaEmpresa = await abrir(contexto, finalSoatId)
  comprobar(visto.estado === 200 && visto.esPdf, '[Ventas] abre el cargo')
  comprobar(retirado.fallo && !retirado.esPdf && deLaEmpresa.fallo && !deLaEmpresa.esPdf,
    '[Ventas] el documento retirado y el de la empresa, ni por su dirección: vuelve a la lista con el aviso')
  await ir(pagina, `${BASE}/tramites/archivo/${finalRetiradoId}`)
  comprobar(/no está disponible/.test(await pagina.locator('[role="alert"]').first().innerText().catch(() => '')),
    '[Ventas] y la lista dice que ese archivo no está disponible')
  if (process.env.CAPTURAS) await captura(pagina, 'expediente-ficha-ventas-1440.png')
  comprobar(errores.length === 0, `[Ventas] sin errores de consola${errores.length ? `: ${errores.slice(0, 2).join(' | ')}` : ''}`)
  await contexto.close()
}

// ============================================================ 5. Tesorería
{
  const { contexto } = await entrar(CUENTAS.tesoreria)
  const visto = await abrir(contexto, cargoId)
  comprobar(/sin-permiso/.test(visto.url) && !visto.esPdf, `[Tesorería] la dirección de un archivo la manda a «Sin permiso» (${new URL(visto.url).pathname})`)
  await contexto.close()
}

// ============================================================ lo que quedó
comprobar((await sueltos(tarjeta.tramite)) === 0 && (await sueltos(soat.tramite)) === 0, 'al final no queda ningún archivo suelto en Storage')

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo bien.' : `\n${fallas.length} FALLA(S):\n- ${fallas.join('\n- ')}`)
process.exit(fallas.length === 0 ? 0 : 1)
