/**
 * SSOMA: charlas e inducciones (Plan 15, entrega 15.3), con clic real y la
 * cuenta de cada puesto (nunca ADMIN):
 *
 *   1. SSOMA, en el monitor: ve el mes con «No asistieron»; registra una charla
 *      marcando un área entera y a una persona buscada sin tildes. La base
 *      rechaza una fecha de mañana junto al campo; corregida, tres toques dan
 *      una sola charla, con sus asistentes y su foto en su carpeta, ninguna
 *      suelta; «No asistieron» baja sin recargar a mano.
 *   2. SSOMA, en el celular: registra una inducción de una persona (tres
 *      toques, un envío) y la anula con su motivo: deja de contar.
 *   3. Gerencia consulta, en el monitor y en el celular: ve la lista, la ficha
 *      y la foto, sin «Registrar charla» ni «Anular», y sin ningún DNI.
 *   4. RR. HH. y Ventas no entran ni por el menú ni por la dirección.
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

const sello = Date.now().toString().slice(-6)
const foto = join(tmpdir(), `ssoma-charla-${sello}.jpg`)
{
  const p = await (await navegador.newContext()).newPage()
  const b64 = await p.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 800
    c.height = 600
    const g = c.getContext('2d')
    g.fillStyle = '#34507a'
    g.fillRect(0, 0, 800, 600)
    g.fillStyle = '#fff'
    g.font = '32px sans-serif'
    g.fillText(`Charla de cinco minutos ${Math.random()}`, 30, 80)
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
const mes = hoy.slice(0, 7)
const activos = Number((await consulta(`select count(*)::int as n from public.trabajadores where activo`))[0].n)
const faltanEnLaBase = async () =>
  Number(
    (
      await consulta(
        `select count(*)::int as n from public.trabajadores t where t.activo and not exists (
           select 1 from public.ssoma_charla_asistentes a join public.ssoma_charlas c on c.id = a.charla_id
            where a.trabajador_id = t.id and c.anulado_en is null and to_char(c.fecha, 'YYYY-MM') = $1)`,
        [mes],
      )
    )[0].n,
  )
const deProduccion = (
  await consulta(`select t.id from public.trabajadores t join public.areas a on a.id = t.area_id where t.activo and a.codigo = 'PRD'`)
).map((r) => r.id)
const [oscar] = await consulta(`select id from public.trabajadores where apellidos like 'NÚÑEZ%' and activo`)
const DNIS = (await consulta(`select dni from public.trabajadores where activo`)).map((r) => r.dni)
const sinDni = (texto) => !DNIS.some((d) => texto.includes(d))

// ------------------------------------------------------------ 1. SSOMA en el monitor
const TEMA = `Orden y limpieza en la zona de corte (${sello})`
let charla = null
{
  const { pagina, contexto, errores, envios, yo } = await entrar(CUENTAS.ssoma, MONITOR)
  await ir(pagina, `${BASE}/ssoma`)
  comprobar((await pagina.locator('nav a[href="/ssoma/charlas"]').count()) >= 1, '[SSOMA 1440] el menú lleva «Charlas e inducciones»')
  await ir(pagina, `${BASE}/ssoma/charlas`)
  const faltanAntes = await faltanEnLaBase()
  const tarjeta = pagina.locator('[data-no-asistieron]')
  comprobar(
    Number(await tarjeta.getAttribute('data-no-asistieron')) === faltanAntes &&
      limpio(await tarjeta.innerText()).includes(`${faltanAntes} de ${activos}`),
    `[SSOMA 1440] «No asistieron» dice ${faltanAntes} de ${activos}, como la base`,
  )
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-charlas-mes-1440.png'), fullPage: true })

  await pagina.locator('[data-registrar-charla]').click()
  const ventana = pagina.getByRole('dialog')
  await ventana.waitFor()
  const registrar = ventana.getByRole('button', { name: 'Registrar', exact: true })
  comprobar(await registrar.isDisabled(), '[SSOMA 1440] sin asistentes ni foto, «Registrar» no se puede tocar')
  await ventana.locator('#charla-tema').fill(TEMA)
  // Toda Producción de una vez, y Óscar Núñez buscado sin tildes.
  await ventana.getByRole('button', { name: /Marcar a .* de Producción/ }).click()
  await ventana.getByRole('searchbox').fill('nunez')
  await ventana.locator(`[data-asistente="${oscar?.id}"]`).check()
  await ventana.getByRole('searchbox').fill('')
  const marcados = Number(await ventana.locator('[data-marcados]').getAttribute('data-marcados'))
  comprobar(marcados === deProduccion.length + 1, `[SSOMA 1440] marcó ${marcados}: el área de Producción entera y a Óscar Núñez buscado sin tildes`)
  await ventana.locator('input[type="file"]:not([capture])').setInputFiles(foto)
  await pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })
  await hasta(() => registrar.isEnabled(), Boolean, 30000)

  // La fecha de mañana: el campo no la deja, así que se le quita el tope para que la rechace la base.
  await ventana.locator('#charla-fecha').evaluate((e, v) => {
    e.removeAttribute('max')
    e.value = v
  }, manana)
  const antesMal = envios.n
  await registrar.click()
  const errorFecha = await hasta(
    () => ventana.locator('#charla-fecha').getAttribute('aria-invalid'),
    (v) => v === 'true',
    15000,
  )
  const textoVentana = limpio(await ventana.innerText())
  comprobar(errorFecha === 'true' && /posterior a hoy/.test(textoVentana), '[SSOMA 1440] la base rechaza la fecha de mañana y lo dice junto al campo')
  comprobar(await pagina.evaluate(() => document.activeElement?.id === 'charla-fecha'), '[SSOMA 1440] el cursor vuelve a la fecha')
  comprobar(envios.n - antesMal === 1 && (await consulta(`select 1 from public.ssoma_charlas where tema = $1`, [TEMA])).length === 0, '[SSOMA 1440] no quedó nada registrado')
  await ventana.locator('#charla-fecha').fill(hoy)
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-registrar-charla-1440.png'), fullPage: false })

  const antes = envios.n
  await tresToques(registrar)
  const verde = await hasta(() => pagina.locator('p[role="status"]').filter({ hasText: 'registrada' }).first().innerText().catch(() => ''), (t) => /registrada/.test(t), 30000)
  await quieta(pagina)
  const filas = await consulta(
    `select c.id, (select count(*)::int from public.ssoma_charla_asistentes a where a.charla_id = c.id) as asistentes,
            (select count(*)::int from public.ssoma_charla_fotos f where f.charla_id = c.id) as fotos, c.fecha::text as fecha
       from public.ssoma_charlas c where c.tema = $1`,
    [TEMA],
  )
  charla = filas[0]
  comprobar(
    filas.length === 1 && charla.asistentes === marcados && charla.fotos === 1 && charla.fecha === hoy && envios.n - antes === 1,
    `[SSOMA 1440] tres toques: ${filas.length} charla, ${charla?.asistentes} asistentes, ${charla?.fotos} foto, ${envios.n - antes} envío`,
  )
  comprobar(new RegExp(`Charla registrada con ${marcados} asistentes`).test(verde), `[SSOMA 1440] el verde lo dice: «${limpio(verde)}»`)
  const [ruta] = await consulta(`select ruta from public.ssoma_charla_fotos where charla_id = $1`, [charla?.id])
  comprobar((ruta?.ruta ?? '').startsWith(`${yo.id}/${charla?.id}/`), '[SSOMA 1440] la foto está en su carpeta, con el id de la charla')
  const sueltas = await consulta(
    `select count(*)::int as n from storage.objects o where o.bucket_id = 'fotos-ssoma' and o.name like $1
        and not exists (select 1 from public.ssoma_charla_fotos f where f.ruta = o.name)
        and not exists (select 1 from public.ssoma_reporte_fotos f where f.ruta = o.name)
        and not exists (select 1 from public.ssoma_accion_fotos f where f.ruta = o.name)`,
    [`${yo.id}/%`],
  )
  comprobar(sueltas[0].n === 0, '[SSOMA 1440] ninguna foto suelta')
  const faltanDespues = await faltanEnLaBase()
  const enPantalla = await hasta(() => tarjeta.getAttribute('data-no-asistieron').then(Number), (n) => n === faltanDespues, 15000)
  // En un banco recién preparado baja (Óscar Núñez no tenía charla); en una segunda vuelta ya asistió y queda igual.
  comprobar(enPantalla === faltanDespues && faltanDespues <= faltanAntes, `[SSOMA 1440] «No asistieron» pasa de ${faltanAntes} a ${enPantalla} sin recargar, como la base`)
  const enLista = await hasta(() => pagina.locator(`[data-charla="${charla?.id}"]`).count(), (n) => n === 1, 15000)
  if (enLista !== 1) console.log('   en la lista:', await pagina.locator('[data-charla]').evaluateAll((f) => f.map((e) => e.dataset.charla)), pagina.url())
  comprobar(enLista === 1, '[SSOMA 1440] la charla nueva sale en la lista')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-charla-registrada-1440.png'), fullPage: true })

  await pagina.locator(`[data-charla="${charla?.id}"] a`).click()
  await pagina.waitForURL(`**/ssoma/charlas/${charla?.id}`)
  await quieta(pagina)
  comprobar((await pagina.locator('[data-asistio]').count()) === marcados, '[SSOMA 1440] la ficha lista a todos los asistentes')
  const ancho = await hasta(() => pagina.locator('main img').first().evaluate((i) => i.naturalWidth).catch(() => 0), (n) => n > 0, 15000)
  comprobar(ancho > 0, '[SSOMA 1440] la foto se ve en la ficha')
  comprobar((await pagina.locator('[data-anular-charla]').count()) === 1, '[SSOMA 1440] puede anularla')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-charla-ficha-1440.png'), fullPage: true })
  comprobar(errores.length === 0, `[SSOMA 1440] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 2. SSOMA en el celular
{
  const { pagina, contexto, errores, envios } = await entrar(CUENTAS.ssoma, CELULAR)
  await ir(pagina, `${BASE}/ssoma/charlas`)
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-charlas-mes-390.png'), fullPage: true })
  const TEMA2 = `Inducción al puesto de plegadora (${sello})`
  await pagina.locator('[data-registrar-charla]').click()
  const ventana = pagina.getByRole('dialog')
  await ventana.waitFor()
  await ventana.getByText('Inducción', { exact: true }).click()
  await ventana.locator('#charla-tema').fill(TEMA2)
  await ventana.getByRole('searchbox').fill('vargas')
  await ventana.locator('[data-asistente]').first().check()
  await ventana.locator('input[type="file"]:not([capture])').setInputFiles(foto)
  await pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })
  const registrar = ventana.getByRole('button', { name: 'Registrar', exact: true })
  await hasta(() => registrar.isEnabled(), Boolean, 30000)
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-registrar-induccion-390.png') })
  const antes = envios.n
  await tresToques(registrar)
  const verde = await hasta(() => pagina.locator('p[role="status"]').filter({ hasText: 'registrada' }).first().innerText().catch(() => ''), (t) => /registrada/.test(t), 30000)
  await quieta(pagina)
  const filas = await consulta(`select id, tipo from public.ssoma_charlas where tema = $1`, [TEMA2])
  comprobar(filas.length === 1 && filas[0].tipo === 'INDUCCION' && envios.n - antes === 1, `[SSOMA 390] tres toques: ${filas.length} inducción, ${envios.n - antes} envío`)
  comprobar(/Inducción registrada con 1 asistente\./.test(verde), `[SSOMA 390] el verde lo dice: «${limpio(verde)}»`)
  const faltanConElla = await faltanEnLaBase()

  await ir(pagina, `${BASE}/ssoma/charlas/${filas[0]?.id}`)
  await pagina.locator('[data-anular-charla]').click()
  const anular = pagina.getByRole('dialog')
  await anular.locator('textarea[name="motivo"]').fill(`Era una prueba del banco, no se dio (${sello}).`)
  await anular.getByRole('button', { name: 'Anular', exact: true }).click()
  const nota = await hasta(() => pagina.locator('[data-charla-anulada]').innerText().catch(() => ''), (t) => /Anulada/.test(t), 15000)
  comprobar(/Ya no cuenta como asistencia/.test(nota) && /Motivo: Era una prueba/.test(nota), '[SSOMA 390] anulada: la ficha lo dice con su motivo')
  const [anulada] = await consulta(`select anulado_en is not null as anulada, anulado_por is not null as quien from public.ssoma_charlas where id = $1`, [filas[0]?.id])
  comprobar(anulada?.anulada && anulada?.quien, '[SSOMA 390] la base la anotó anulada, con quién')
  comprobar((await faltanEnLaBase()) === faltanConElla + 1, '[SSOMA 390] la persona de la inducción anulada vuelve a «No asistieron»')
  comprobar((await pagina.locator('[data-anular-charla]').count()) === 0, '[SSOMA 390] ya no se ofrece anularla otra vez')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-charla-anulada-390.png'), fullPage: true })
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `[SSOMA 390] la ficha no se desliza de costado (${ancho} px)`)
  comprobar(errores.length === 0, `[SSOMA 390] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 3. Gerencia consulta
for (const viewport of [MONITOR, CELULAR]) {
  const tam = viewport.width
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia, viewport)
  await ir(pagina, `${BASE}/ssoma/charlas`)
  const texto = limpio(await pagina.locator('main').innerText())
  comprobar(pagina.url().includes('/ssoma/charlas') && texto.includes('No asistieron'), `[Gerencia ${tam}] entra a las charlas y ve «No asistieron»`)
  comprobar((await pagina.locator('[data-registrar-charla]').count()) === 0, `[Gerencia ${tam}] no ve «Registrar charla»`)
  comprobar(sinDni(await pagina.content()), `[Gerencia ${tam}] ningún DNI en la página`)
  await pagina.screenshot({ path: join(CAPTURAS, `ssoma-charlas-gerencia-${tam}.png`), fullPage: true })
  await ir(pagina, `${BASE}/ssoma/charlas/${charla?.id}`)
  comprobar((await pagina.locator('[data-asistio]').count()) === charla?.asistentes, `[Gerencia ${tam}] ve a los ${charla?.asistentes} asistentes`)
  comprobar((await pagina.locator('[data-anular-charla]').count()) === 0, `[Gerencia ${tam}] no puede anular`)
  const ancho = await hasta(() => pagina.locator('main img').first().evaluate((i) => i.naturalWidth).catch(() => 0), (n) => n > 0, 15000)
  comprobar(ancho > 0, `[Gerencia ${tam}] ve la foto`)
  comprobar(sinDni(await pagina.content()), `[Gerencia ${tam}] ningún DNI en la ficha`)
  await pagina.screenshot({ path: join(CAPTURAS, `ssoma-charla-gerencia-${tam}.png`), fullPage: true })
  comprobar(errores.length === 0, `[Gerencia ${tam}] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 4. Quien no debe entrar
for (const [puesto, correo] of [
  ['RR. HH.', CUENTAS.rrhh],
  ['Ventas', CUENTAS.ventas],
]) {
  const { pagina, contexto } = await entrar(correo, MONITOR)
  await ir(pagina, `${BASE}/ssoma`)
  comprobar((await pagina.locator('a[href="/ssoma/charlas"]').count()) === 0, `[${puesto}] el menú no lleva las charlas`)
  await ir(pagina, `${BASE}/ssoma/charlas`)
  comprobar(pagina.url().includes('/sin-permiso'), `[${puesto}] la lista lo lleva a «sin permiso»`)
  await ir(pagina, `${BASE}/ssoma/charlas/${charla?.id}`)
  const texto = limpio(await pagina.locator('body').innerText())
  comprobar(pagina.url().includes('/sin-permiso') && !texto.includes(TEMA), `[${puesto}] la ficha por su dirección tampoco`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
