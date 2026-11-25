/**
 * SSOMA: el reporte de incidente (Plan 15, entrega 15.1), con clic real y la
 * cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Almacén, en el celular: «Reportar incidente» está en su menú. Toca tres
 *      veces «Enviar el reporte» con una fecha futura: sale un solo envío, la
 *      base lo rechaza, lo escrito sigue en el campo. Corrige, pone una foto y
 *      envía tres veces: entra un solo reporte RI-…, con su foto en Storage, y
 *      le llega el aviso a SSOMA. Ve su recorrido y su foto; no puede anular.
 *   2. Supervisión de Producción (el área donde pasó): lo ve «En tu área», sin
 *      quién lo reportó y sin la foto. Reporta un accidente a nombre de un
 *      trabajador sin cuenta, de la lista de RR. HH.
 *   3. Supervisión de Maestranza (otra área): no lo ve ni por su dirección.
 *   4. SSOMA, en el monitor: tiene el aviso en la campana; ve todos, con quién
 *      reportó y la foto; anula uno con su motivo (un solo envío con tres
 *      toques) y le llega el aviso a quien lo reportó.
 *   5. Gerencia: los ve todos y no puede anular.
 *   6. Ventas: tiene «Reportar incidente» y no ve los de otros.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  almacen: 'almacen.local@metalwork.test',
  prd: 'sup.prd.local@metalwork.test',
  mtz: 'sup.mtz.local@metalwork.test',
  ssoma: 'ssoma.local@metalwork.test',
  gerencia: 'gerencia.local@metalwork.test',
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
  // Cada acción de servidor que sale: para contar los envíos de un triple toque.
  const acciones = { n: 0 }
  pagina.on('request', (r) => {
    if (r.method() === 'POST' && r.headers()['next-action']) acciones.n++
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
  return { pagina, contexto, errores, acciones, yo }
}

/** Tres toques seguidos al mismo botón, sin esperar entre ellos. */
async function tresToques(boton) {
  await boton.evaluate((b) => {
    b.click()
    b.click()
    b.click()
  })
}

const sello = Date.now().toString().slice(-6)
// Una foto chica en JPEG.
const foto = join(CAPTURAS, `ssoma-foto-${sello}.jpg`)
{
  const p = await (await navegador.newContext()).newPage()
  const b64 = await p.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 800
    c.height = 600
    const g = c.getContext('2d')
    g.fillStyle = '#7a4b2a'
    g.fillRect(0, 0, 800, 600)
    g.fillStyle = '#fff'
    g.font = '32px sans-serif'
    g.fillText(`Piso con aceite ${Math.random()}`, 30, 80)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
    const b = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return btoa(s)
  })
  writeFileSync(foto, Buffer.from(b64, 'base64'))
  await p.context().close()
}

// Un trabajador sin cuenta en la lista de RR. HH., para reportar a su nombre.
const [admin] = await consulta(`select u.id from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'ADMIN' order by u.creado_en limit 1`)
const apellido = `OPERARIO SSOMA ${sello}`
const [trabajador] = await consulta(
  `insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id, creado_por)
   values ('JULIO', $1, $2, 'Soldador', (select id from public.areas where codigo = 'PRD'), $3) returning id`,
  [apellido, `7${sello}9`.padEnd(8, '0').slice(0, 8), admin.id],
)

const LUGAR = `Nave 2, pasillo ${sello}`
const TEXTO = `Hay aceite derramado junto a la plegadora y nadie lo ha limpiado (${sello}).`
const ventanaDe = (pagina) => pagina.locator('[role="dialog"]', { has: pagina.locator('#ssoma-descripcion') })
const reportes = (donde, valores) =>
  consulta(
    `select r.id, r.numero, r.tipo, r.estado, r.hubo_atencion, r.trabajador_id, r.registrado_por, r.motivo_anulacion, r.anulado_por,
            (select count(*)::int from public.ssoma_reporte_fotos f where f.reporte_id = r.id) as fotos,
            (select f.ruta from public.ssoma_reporte_fotos f where f.reporte_id = r.id order by f.orden limit 1) as ruta
       from public.ssoma_reportes r where ${donde} order by r.creado_en`,
    valores,
  )

let delAlmacen = null
let delSupervisor = null

// ------------------------------------------------------------ 1. Almacén, en el celular
{
  const { pagina, contexto, errores, acciones, yo } = await entrar(CUENTAS.almacen, CELULAR)
  await pagina.getByRole('button', { name: /^Más/ }).click()
  const enMenu = await pagina.getByRole('link', { name: 'Reportar incidente' }).first().isVisible().catch(() => false)
  comprobar(enMenu, '[Almacén 390] «Reportar incidente» está en su menú')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-menu-almacen-390.png') })

  await ir(pagina, `${BASE}/ssoma`)
  const titulo = limpio(await pagina.locator('h1').innerText())
  comprobar(titulo === 'Reportar a SSOMA', `[Almacén 390] la pantalla se llama «${titulo}»`)
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-lista-almacen-vacia-390.png'), fullPage: true })

  await pagina.locator('[data-reportar-incidente]').click()
  const v = ventanaDe(pagina)
  await v.waitFor({ timeout: 10000 })
  comprobar((await v.locator('#ssoma-trabajador').count()) === 0, '[Almacén 390] sin el permiso, no se le ofrece reportar a nombre de otro')
  await v.locator('input[name="tipo"][value="CONDICION_INSEGURA"]').check()
  comprobar((await v.locator('input[name="hubo_atencion"]').count()) === 0, '[Almacén 390] la atención médica no se pregunta en una condición insegura')
  await v.locator('#ssoma-area').selectOption({ label: 'Producción' })
  await v.locator('#ssoma-lugar').fill(LUGAR)
  await v.locator('#ssoma-descripcion').fill(TEXTO)
  // Una fecha futura: el navegador la deja pasar y la base la rechaza.
  await v.locator('#ssoma-cuando').fill('2099-01-01T10:00')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-formulario-390.png'), fullPage: true })
  const enviar = v.getByRole('button', { name: 'Enviar el reporte' })
  // El campo lleva hasta la hora de ahora: el navegador ni la manda.
  const antesDelTope = acciones.n
  await tresToques(enviar)
  await quieta(pagina)
  comprobar(
    acciones.n === antesDelTope && (await v.locator('#ssoma-cuando').evaluate((el) => el.validity.rangeOverflow)),
    `[Almacén 390] una fecha futura la frena el campo, sin enviar: ${acciones.n - antesDelTope} envío`,
  )
  // Con la hora del teléfono mal puesta el tope no basta: decide la base, y lo dice junto al campo.
  await v.locator('#ssoma-cuando').evaluate((el) => el.removeAttribute('max'))
  const antes = acciones.n
  await tresToques(enviar)
  const aviso = await hasta(() => v.locator('#ssoma-cuando').evaluate((el) => {
    const id = el.getAttribute('aria-describedby')
    return id ? (document.getElementById(id)?.textContent ?? '') : ''
  }), (t) => /futuras/.test(t))
  await quieta(pagina)
  comprobar(acciones.n - antes === 1, `[Almacén 390] tres toques con un dato que la base rechaza: ${acciones.n - antes} envío`)
  comprobar(/no pueden ser futuras/.test(aviso), `[Almacén 390] el rechazo lo dice la base, junto a la fecha: «${limpio(aviso)}»`)
  comprobar(
    await hasta(() => pagina.evaluate(() => document.activeElement?.id === 'ssoma-cuando'), Boolean, 5000),
    '[Almacén 390] el cursor vuelve a la fecha, que es la que está mal',
  )
  comprobar(!/futuras/.test(await v.locator('#ssoma-error').innerText().catch(() => '')), '[Almacén 390] el rechazo de la fecha no se repite abajo')
  comprobar((await v.locator('#ssoma-descripcion').inputValue()) === TEXTO, '[Almacén 390] lo escrito sigue en el campo tras el rechazo')
  comprobar((await reportes('r.lugar = $1', [LUGAR])).length === 0, '[Almacén 390] el rechazado no dejó ningún reporte')

  await v.locator('#ssoma-cuando').fill('')
  await v.locator('input[type="file"]:not([capture])').setInputFiles(foto)
  await pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })
  await hasta(() => enviar.isEnabled(), Boolean, 30000)
  const antesDelBueno = acciones.n
  await tresToques(enviar)
  const verde = await hasta(() => pagina.locator('p[role="status"]').first().innerText().catch(() => ''), (t) => /registrado/.test(t), 30000)
  await quieta(pagina)
  const entraron = await reportes('r.lugar = $1', [LUGAR])
  delAlmacen = entraron[0] ?? null
  comprobar(entraron.length === 1 && acciones.n - antesDelBueno === 1, `[Almacén 390] tres toques con todo bien: ${entraron.length} reporte y ${acciones.n - antesDelBueno} envío`)
  comprobar(/^RI-\d{4}-\d{4}$/.test(delAlmacen?.numero ?? ''), `[Almacén 390] el reporte lleva su número: ${delAlmacen?.numero}`)
  comprobar(verde.includes(delAlmacen?.numero ?? '—'), `[Almacén 390] el aviso verde dice el número: «${limpio(verde)}»`)
  comprobar(delAlmacen?.registrado_por === yo.id && delAlmacen?.tipo === 'CONDICION_INSEGURA' && delAlmacen?.hubo_atencion === null, '[Almacén 390] quedó a su nombre, como condición insegura y sin dato de atención')
  const enStorage = await consulta(`select 1 from storage.objects where bucket_id = 'fotos-ssoma' and name = $1`, [delAlmacen?.ruta ?? ''])
  comprobar(delAlmacen?.fotos === 1 && enStorage.length === 1 && (delAlmacen?.ruta ?? '').startsWith(`${yo.id}/${delAlmacen?.id}/`), '[Almacén 390] la foto quedó anotada y está en Storage, en su carpeta')
  const sueltas = await consulta(
    `select count(*)::int as n from storage.objects o where o.bucket_id = 'fotos-ssoma' and o.name like $1 and not exists (select 1 from public.ssoma_reporte_fotos f where f.ruta = o.name)`,
    [`${yo.id}/%`],
  )
  comprobar(sueltas[0].n === 0, '[Almacén 390] no quedó ninguna foto suelta en Storage')
  const avisos = await consulta(
    `select n.titulo, n.ruta from public.notificaciones n join public.usuarios u on u.id = n.usuario_id where n.origen_id = $1 and u.correo = $2`,
    [delAlmacen?.id, CUENTAS.ssoma],
  )
  comprobar(avisos.length === 1 && avisos[0].ruta === `/ssoma/${delAlmacen?.id}` && avisos[0].titulo.includes(delAlmacen?.numero), `[Almacén 390] a SSOMA le llegó un aviso: «${avisos[0]?.titulo}»`)
  // La lista se pone al día sola tras el envío.
  const enLista = await hasta(() => pagina.locator(`[data-reporte-ssoma="${delAlmacen?.numero}"]`).count(), (n) => n === 1, 15000)
  comprobar(enLista === 1, '[Almacén 390] el reporte aparece en «Tus reportes» sin recargar')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-lista-almacen-390.png'), fullPage: true })

  await pagina.getByRole('link', { name: 'Ver cómo va' }).click()
  await pagina.waitForURL((u) => u.pathname === `/ssoma/${delAlmacen?.id}`, { timeout: 20000 })
  await quieta(pagina)
  const recorrido = limpio(await pagina.locator('[data-recorrido]').innerText())
  comprobar(/Reportado/.test(recorrido) && /Almacén/.test(recorrido) && /Lo tiene SSOMA · desde hoy/.test(recorrido), `[Almacén 390] ve el recorrido de su reporte: «${recorrido.slice(0, 120)}»`)
  const fotoVista = await hasta(() => pagina.locator('main img').first().evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false), Boolean, 15000)
  comprobar(fotoVista, '[Almacén 390] ve la foto de su reporte')
  comprobar((await pagina.locator('[data-anular-reporte]').count()) === 0, '[Almacén 390] no se le ofrece anular')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-detalle-almacen-390.png'), fullPage: true })

  // No llegó la respuesta, «Cancelar» y volver a abrir: la ventana pregunta por
  // el anterior y dice que entró, en vez de dejar que el mismo hecho saque otro RI.
  const lugarPerdido = `Escalera sin pasamanos ${sello}`
  let cortar = true
  await pagina.route('**/*', async (ruta) => {
    const pedido = ruta.request()
    if (cortar && pedido.method() === 'POST' && pedido.headers()['next-action'] && (pedido.postData() ?? '').includes(lugarPerdido)) {
      cortar = false
      // Llega al servidor y la respuesta se pierde en el camino.
      await ruta.fetch().catch(() => {})
      return ruta.abort('failed')
    }
    return ruta.continue()
  })
  await ir(pagina, `${BASE}/ssoma`)
  await pagina.locator('[data-reportar-incidente]').click()
  const v2 = ventanaDe(pagina)
  await v2.waitFor({ timeout: 10000 })
  await v2.locator('input[name="tipo"][value="CONDICION_INSEGURA"]').check()
  await v2.locator('#ssoma-lugar').fill(lugarPerdido)
  await v2.locator('#ssoma-descripcion').fill(`La escalera al altillo no tiene pasamanos (${sello}).`)
  await v2.getByRole('button', { name: 'Enviar el reporte' }).click()
  const perdida = await hasta(() => v2.locator('#ssoma-error').innerText().catch(() => ''), (t) => t.length > 0)
  comprobar(/llegó la respuesta/i.test(perdida), `[Almacén 390] sin respuesta, la ventana lo dice: «${limpio(perdida)}»`)
  await v2.getByRole('button', { name: 'Cancelar' }).click()
  await pagina.locator('[data-reportar-incidente]').click()
  await ventanaDe(pagina).waitFor({ timeout: 10000 })
  const [elPerdido] = await reportes('r.lugar = $1', [lugarPerdido])
  const dice = await hasta(() => pagina.locator('[role="dialog"]').innerText().catch(() => ''), (t) => t.includes(elPerdido?.numero ?? '—'), 15000)
  comprobar(Boolean(elPerdido) && dice.includes(elPerdido.numero), `[Almacén 390] al volver a abrir, la ventana dice que el ${elPerdido?.numero} sí entró: «${limpio(dice).slice(0, 160)}»`)
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-reabrir-tras-respuesta-perdida-390.png'), fullPage: true })
  await ventanaDe(pagina).getByRole('button', { name: 'Cancelar' }).click()
  const yaEnLista = await hasta(() => pagina.locator(`[data-reporte-ssoma="${elPerdido?.numero}"]`).count(), (n) => n === 1, 15000)
  comprobar(yaEnLista === 1, '[Almacén 390] y «Tus reportes» ya lo muestra, sin recargar')
  comprobar((await reportes('r.lugar = $1', [lugarPerdido])).length === 1, '[Almacén 390] el hecho quedó con un solo RI')
  await pagina.unroute('**/*')
  const ajenos = errores.filter((e) => !/Failed to fetch|ERR_FAILED|net::/.test(e))
  comprobar(ajenos.length === 0, `[Almacén 390] sin errores de consola ajenos al corte${ajenos.length ? `: ${ajenos[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 2. Supervisión de Producción
{
  const { pagina, contexto, errores, yo } = await entrar(CUENTAS.prd, CELULAR)
  await ir(pagina, `${BASE}/ssoma`)
  const fila = pagina.locator(`[data-reporte-ssoma="${delAlmacen?.numero}"]`)
  const texto = limpio(await fila.innerText().catch(() => ''))
  comprobar((await fila.count()) === 1 && !/Almacén Banco|Reportó/.test(texto) && !/foto/.test(texto), `[Producción 390] ve el reporte de su área sin quién lo reportó ni fotos: «${texto.slice(0, 100)}»`)
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-lista-area-390.png'), fullPage: true })
  await ir(pagina, `${BASE}/ssoma/${delAlmacen?.id}`)
  const cuerpo = limpio(await pagina.locator('main').innerText())
  comprobar(/Lo ves porque pasó en tu área/.test(cuerpo) && !/Almacén Banco/.test(cuerpo) && (await pagina.locator('main img').count()) === 0, '[Producción 390] en la ficha no sale el nombre de quien reportó ni la foto')
  comprobar((await pagina.locator('[data-anular-reporte]').count()) === 0, '[Producción 390] no se le ofrece anular')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-detalle-area-390.png'), fullPage: true })

  // A nombre de un trabajador sin cuenta.
  await ir(pagina, `${BASE}/ssoma`)
  await pagina.locator('[data-reportar-incidente]').click()
  const v = ventanaDe(pagina)
  await v.waitFor({ timeout: 10000 })
  await v.locator('input[name="tipo"][value="ACCIDENTE"]').check()
  comprobar((await v.locator('#ssoma-area').inputValue()) !== '', '[Producción 390] el área de la cuenta ya viene elegida')
  const lugar = `Mesa de soldadura ${sello}`
  await v.locator('#ssoma-lugar').fill(lugar)
  await v.locator('#ssoma-descripcion').fill(`Una chispa alcanzó al soldador, que trabajaba sin manga (${sello}).`)
  await v.locator('input[name="hubo_atencion"][value="SI"]').check()
  await v.locator('#ssoma-trabajador').click()
  await pagina.getByPlaceholder('Nombre, cargo o área…').fill(apellido)
  await pagina.getByRole('option', { name: new RegExp(apellido) }).click()
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-formulario-a-nombre-390.png'), fullPage: true })
  await v.getByRole('button', { name: 'Enviar el reporte' }).click()
  await hasta(() => pagina.locator('p[role="status"]').first().innerText().catch(() => ''), (t) => /registrado/.test(t), 30000)
  const [r] = await reportes('r.lugar = $1', [lugar])
  delSupervisor = r ?? null
  comprobar(r?.registrado_por === yo.id && r?.trabajador_id === trabajador.id && r?.hubo_atencion === true && r?.tipo === 'ACCIDENTE' && r?.fotos === 0, '[Producción 390] el accidente quedó a nombre del trabajador, con atención médica y sin fotos')
  comprobar(errores.length === 0, `[Producción 390] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 3. Supervisión de Maestranza
{
  const { pagina, contexto } = await entrar(CUENTAS.mtz, CELULAR)
  await ir(pagina, `${BASE}/ssoma`)
  comprobar((await pagina.locator(`[data-reporte-ssoma="${delAlmacen?.numero}"]`).count()) === 0, '[Maestranza 390] no ve el reporte de otra área')
  await ir(pagina, `${BASE}/ssoma/${delAlmacen?.id}`)
  const cuerpo = limpio(await pagina.locator('body').innerText())
  // La página de «no existe» sale con 200 cuando el marco ya empezó a enviarse: se mira lo que dice.
  comprobar(!cuerpo.includes(TEXTO) && !cuerpo.includes(delAlmacen?.numero ?? '—') && (await pagina.locator('[data-recorrido]').count()) === 0,
    `[Maestranza 390] por su dirección tampoco lo abre: «${cuerpo.slice(0, 90)}»`)
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-detalle-otra-area-390.png'), fullPage: true })
  await contexto.close()
}

// ------------------------------------------------------------ 4. SSOMA, en el monitor
{
  const { pagina, contexto, errores, acciones, yo } = await entrar(CUENTAS.ssoma, MONITOR)
  const menu = limpio(await pagina.locator('nav[aria-label="Menú principal"]').innerText())
  comprobar(/Reportes de seguridad/.test(menu) && !/Reportar incidente/.test(menu), '[SSOMA 1440] su menú lleva «Reportes de seguridad», una sola vez')
  const campana = await pagina.getByRole('button', { name: /^Avisos, \d+ sin leer/ }).count()
  comprobar(campana === 1, '[SSOMA 1440] la campana tiene avisos sin leer')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-tablero-ssoma-1440.png'), fullPage: true })
  await ir(pagina, `${BASE}/ssoma`)
  const titulo = limpio(await pagina.locator('h1').innerText())
  const fila = limpio(await pagina.locator(`[data-reporte-ssoma="${delAlmacen?.numero}"]`).innerText().catch(() => ''))
  const filaSup = limpio(await pagina.locator(`[data-reporte-ssoma="${delSupervisor?.numero}"]`).innerText().catch(() => ''))
  comprobar(titulo === 'Reportes de seguridad' && /Almacén Banco/.test(fila), `[SSOMA 1440] ve todos, con quién reportó: «${fila.slice(0, 110)}»`)
  comprobar(new RegExp(apellido).test(filaSup), '[SSOMA 1440] ve a nombre de qué trabajador se reportó el accidente')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-lista-ssoma-1440.png'), fullPage: true })
  await pagina.setViewportSize(CELULAR)
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-lista-ssoma-390.png'), fullPage: true })
  await pagina.setViewportSize(MONITOR)

  await ir(pagina, `${BASE}/ssoma/${delAlmacen?.id}`)
  const fotoVista = await hasta(() => pagina.locator('main img').first().evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false), Boolean, 15000)
  comprobar(fotoVista, '[SSOMA 1440] ve la foto del reporte de otra cuenta')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-detalle-ssoma-1440.png'), fullPage: true })

  // Anula el del supervisor, con tres toques.
  await ir(pagina, `${BASE}/ssoma/${delSupervisor?.id}`)
  await pagina.locator('[data-anular-reporte]').click()
  const v = pagina.getByRole('dialog')
  await v.waitFor({ timeout: 10000 })
  const motivo = `Reporte de prueba ${sello}: se repitió con otro número.`
  await v.locator('textarea[name="motivo"]').fill(motivo)
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-anular-1440.png') })
  const antes = acciones.n
  await tresToques(v.getByRole('button', { name: 'Anular', exact: true }))
  await hasta(() => reportes('r.id = $1', [delSupervisor?.id]).then((x) => x[0]?.estado), (e) => e === 'ANULADO', 20000)
  await quieta(pagina)
  const [anulado] = await reportes('r.id = $1', [delSupervisor?.id])
  comprobar(anulado?.estado === 'ANULADO' && anulado?.motivo_anulacion === motivo && anulado?.anulado_por === yo.id && acciones.n - antes === 1, `[SSOMA 1440] anula con su motivo, en un solo envío (${acciones.n - antes})`)
  const alAutor = await consulta(`select titulo from public.notificaciones where origen_id = $1 and usuario_id = $2 and titulo like 'SSOMA anuló%'`, [delSupervisor?.id, delSupervisor?.registrado_por])
  comprobar(alAutor.length === 1, `[SSOMA 1440] a quien lo reportó le llega el aviso de la anulación: «${alAutor[0]?.titulo}»`)
  const ficha = await hasta(() => pagina.locator('main').innerText().then(limpio), (t) => /Anulado por SSOMA/.test(t), 15000)
  comprobar(/Anulado por SSOMA/.test(ficha) && ficha.includes(motivo) && (await pagina.locator('[data-anular-reporte]').count()) === 0, '[SSOMA 1440] la ficha dice quién lo anuló y por qué, y ya no ofrece anular')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-detalle-anulado-1440.png'), fullPage: true })
  await ir(pagina, `${BASE}/ssoma?vista=anulados`)
  comprobar((await pagina.locator(`[data-reporte-ssoma="${delSupervisor?.numero}"]`).count()) === 1, '[SSOMA 1440] el anulado pasa a la vista «Anulados»')

  // Lo que le contaron tarde: SSOMA lo registra con la fecha de hace 35 días; el campo no le pone el tope de 30.
  await ir(pagina, `${BASE}/ssoma`)
  await pagina.locator('[data-reportar-incidente]').click()
  const vt = ventanaDe(pagina)
  await vt.waitFor({ timeout: 10000 })
  const lugarTarde = `Altillo de planchas ${sello}`
  await vt.locator('input[name="tipo"][value="INCIDENTE"]').check()
  await vt.locator('#ssoma-area').selectOption({ label: 'Almacén' })
  await vt.locator('#ssoma-lugar').fill(lugarTarde)
  await vt.locator('#ssoma-descripcion').fill(`Se cayó una plancha del altillo; nos lo contaron recién (${sello}).`)
  const haceTiempo = new Date(Date.now() - 35 * 86400 * 1000 - 5 * 3600 * 1000).toISOString().slice(0, 16)
  await vt.locator('#ssoma-cuando').fill(haceTiempo)
  comprobar((await vt.locator('#ssoma-cuando').getAttribute('min')) === null, '[SSOMA 1440] la fecha no le pone el tope de 30 días')
  await vt.getByRole('button', { name: 'Enviar el reporte' }).click()
  const verdeTarde = await hasta(() => pagina.locator('p[role="status"]').first().innerText().catch(() => ''), (t) => /registrado/.test(t), 30000)
  await quieta(pagina)
  const tarde = await reportes('r.lugar = $1', [lugarTarde])
  comprobar(tarde.length === 1 && /^Reporte RI-\d{4}-\d{4} registrado\.$/.test(limpio(verdeTarde).replace(/ Ver cómo va$/, '')),
    `[SSOMA 1440] registra un hecho de hace 35 días, y el verde no dice que se avisó a sí misma: «${limpio(verdeTarde)}»`)
  comprobar(errores.length === 0, `[SSOMA 1440] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 5. Gerencia
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia, MONITOR)
  await ir(pagina, `${BASE}/ssoma`)
  const titulo = limpio(await pagina.locator('h1').innerText())
  comprobar(titulo === 'Reportes de seguridad' && (await pagina.locator(`[data-reporte-ssoma="${delAlmacen?.numero}"]`).count()) === 1, '[Gerencia 1440] consulta todos los reportes')
  await ir(pagina, `${BASE}/ssoma/${delAlmacen?.id}`)
  comprobar(/Almacén Banco/.test(limpio(await pagina.locator('main').innerText())) && (await pagina.locator('[data-anular-reporte]').count()) === 0, '[Gerencia 1440] ve quién reportó y no se le ofrece anular')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-detalle-gerencia-1440.png'), fullPage: true })
  comprobar(errores.length === 0, `[Gerencia 1440] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 6. Ventas
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.ventas, MONITOR)
  const menu = limpio(await pagina.locator('nav[aria-label="Menú principal"]').innerText())
  comprobar(/Reportar incidente/.test(menu) && !/Reportes de seguridad/.test(menu), '[Ventas 1440] su menú lleva «Reportar incidente»')
  await ir(pagina, `${BASE}/ssoma`)
  const cuerpo = limpio(await pagina.locator('main').innerText())
  comprobar(/Todavía no has reportado nada/.test(cuerpo) && (await pagina.locator('[data-reporte-ssoma]').count()) === 0, '[Ventas 1440] no ve los reportes de otros')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-lista-ventas-1440.png'), fullPage: true })
  comprobar(errores.length === 0, `[Ventas 1440] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
