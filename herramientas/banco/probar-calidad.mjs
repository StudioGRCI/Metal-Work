/**
 * Calidad inspecciona por código interno y etapa (plan «Las demás áreas»,
 * entrega A.1, migración 20261126700000), con clic real y la cuenta de cada
 * puesto (nunca ADMIN):
 *
 *   1. Calidad, en el monitor: «Inspecciones de calidad» encabeza su menú. Elige
 *      el código, la etapa de Producción, «No conforme» y una observación
 *      corta: tres toques dan un envío, la base lo rechaza junto al campo, el
 *      cursor vuelve ahí y lo escrito sigue. Corrige, pone una foto y envía tres
 *      veces: entra una sola inspección, con su foto en Storage, y el verde dice
 *      a quién le llegó.
 *   2. Supervisión de Producción, en el celular: «Observaciones de calidad»
 *      está en su menú y el aviso en la campana; ve la observación y su foto, y
 *      la marca corregida con una nota (tres toques, un paso). No puede
 *      levantarla.
 *   3. Supervisión de Maestranza: no la ve, ni por su dirección.
 *   4. Calidad: la vuelve a observar y después la levanta; registra un código
 *      sin etapas eligiendo el área, conforme, y la anula con su motivo.
 *   5. Gerencia: consulta todo, sin «Registrar» ni botones en la ficha.
 *   6. Diseño: no tiene Calidad en su menú ni ve nada.
 *
 * Arma lo que el banco no trae: le pone código interno a la unidad de dos OT
 * abiertas que no lo tienen (QA-CAL-1 y QA-CAL-2) y dos etapas al primero. Lo
 * deja en el banco, como las inspecciones: una inspección no se borra.
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
  calidad: 'calidad.local@metalwork.test',
  prd: 'sup.prd.local@metalwork.test',
  mtz: 'sup.mtz.local@metalwork.test',
  gerencia: 'gerencia.local@metalwork.test',
  diseno: 'diseno.local@metalwork.test',
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

// ------------------------------------------------------------ lo que el banco no trae
const CODIGO = 'QA-CAL-1'
const SIN_ETAPAS = 'QA-CAL-2'
{
  const [diseno] = await consulta(`select id from public.usuarios where correo = $1`, [CUENTAS.diseno])
  await base.query('begin')
  // Solo los disparadores de la unidad: el código se pone como si viniera de la orden.
  await base.query(`set local session_replication_role = replica`)
  for (const [codigo, numero] of [
    [CODIGO, '0001-2026'],
    [SIN_ETAPAS, '0003-2026'],
  ]) {
    const ya = await consulta(`select 1 from public.unidades where codigo_interno = $1`, [codigo])
    if (ya.length === 0) {
      const { rowCount } = await base.query(
        `update public.unidades u set codigo_interno = $1
           from public.ordenes_trabajo o
          where o.unidad_id = u.id and o.numero = $2 and nullif(btrim(coalesce(u.codigo_interno, '')), '') is null`,
        [codigo, numero],
      )
      if (rowCount !== 1) throw new Error(`No se pudo dar el código ${codigo} a la unidad de la OT ${numero}`)
    }
  }
  await base.query('commit')
  const etapas = await consulta(`select 1 from public.codigo_etapas where codigo_interno = $1 and quitada_en is null`, [CODIGO])
  if (etapas.length === 0) {
    await base.query(
      `insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_real, creado_por)
       values ($1, 1, 'Ensamblado del chasis', (select id from public.areas where codigo = 'PRD'), current_date - 3, $2),
              ($1, 2, 'Pintura', (select id from public.areas where codigo = 'ACB'), null, $2)`,
      [CODIGO, diseno.id],
    )
  }
  // Como «Entrega» de las etapas de siempre: sin área a cargo, Calidad la elige.
  const sinArea = await consulta(`select 1 from public.codigo_etapas where codigo_interno = $1 and area_id is null and quitada_en is null`, [CODIGO])
  if (sinArea.length === 0) {
    await base.query(
      `insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, creado_por)
       values ($1, (select coalesce(max(orden), 0) + 1 from public.codigo_etapas where codigo_interno = $1), 'Entrega', null, $2)`,
      [CODIGO, diseno.id],
    )
  }
}
const [areaPrd] = await consulta(`select id from public.areas where codigo = 'PRD'`)

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
  // Cada envío de un formulario: la pregunta por los avisos, que sale sola cada
  // minuto, también es una acción de servidor y no se cuenta.
  const acciones = { n: 0 }
  pagina.on('request', (r) => {
    if (r.method() === 'POST' && r.headers()['next-action'] && /operacion_id|motivo/.test(r.postData() ?? '')) acciones.n++
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

async function tresToques(boton) {
  await boton.evaluate((b) => {
    b.click()
    b.click()
    b.click()
  })
}

/** Lo que dice el menú del monitor (la barra) o el cajón del teléfono. */
async function textoDelMenu(pagina) {
  const barra = pagina.locator('nav').first()
  return limpio(await barra.innerText().catch(() => ''))
}

const sello = Date.now().toString().slice(-6)
const foto = join(CAPTURAS, `calidad-foto-${sello}.jpg`)
{
  const p = await (await navegador.newContext()).newPage()
  const b64 = await p.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 800
    c.height = 600
    const g = c.getContext('2d')
    g.fillStyle = '#5b6b78'
    g.fillRect(0, 0, 800, 600)
    g.fillStyle = '#fff'
    g.font = '32px sans-serif'
    g.fillText(`Soldadura con poros ${Math.random()}`, 30, 80)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
    const b = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return btoa(s)
  })
  writeFileSync(foto, Buffer.from(b64, 'base64'))
  await p.context().close()
}

const OBSERVACION = `Soldadura con poros en la unión del larguero trasero, lado izquierdo (${sello}).`
const ventanaDe = (pagina) => pagina.locator('[role="dialog"]', { has: pagina.locator('form') }).last()
const inspecciones = (donde, valores) =>
  consulta(
    `select i.*, (select count(*)::int from public.calidad_fotos f where f.inspeccion_id = i.id and f.paso_id is null) as fotos,
            (select f.ruta from public.calidad_fotos f where f.inspeccion_id = i.id and f.paso_id is null order by f.orden limit 1) as ruta
       from public.calidad_inspecciones i where ${donde}`,
    valores,
  )
let observada = null

// ============================================================ 1. Calidad registra
{
  const { pagina, contexto, errores, acciones, yo } = await entrar(CUENTAS.calidad)
  await ir(pagina, `${BASE}/`)
  const menu = await textoDelMenu(pagina)
  comprobar(/Inspecciones de calidad/.test(menu) && /Seguimiento por código/.test(menu), `[Calidad 1440] su menú trae sus inspecciones y los códigos en consulta: «${menu.slice(0, 160)}»`)
  comprobar(!/Costeo|Gastos generales/.test(menu), '[Calidad 1440] sin montos en su menú')
  await ir(pagina, `${BASE}/calidad`)
  comprobar((await pagina.getByRole('heading', { name: 'Inspecciones de calidad' }).count()) === 1, '[Calidad 1440] abre «Inspecciones de calidad»')
  await pagina.screenshot({ path: join(CAPTURAS, 'a1-calidad-lista-antes-1440.png'), fullPage: true })

  await pagina.getByRole('button', { name: 'Registrar inspección' }).click()
  const v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('#calidad-codigo').click()
  await pagina.getByPlaceholder('Código, OT, cliente o unidad…').fill(CODIGO)
  await pagina.getByRole('option', { name: new RegExp(CODIGO) }).click()
  const opciones = await v.locator('#calidad-etapa option').allInnerTexts()
  comprobar(opciones.some((o) => /Ensamblado del chasis · Producción/.test(o)) && opciones.some((o) => /Pintura · Acabados/.test(o)), `[Calidad 1440] la etapa se elige del código, con su área: ${opciones.join(' | ')}`)
  await v.locator('#calidad-etapa').selectOption({ label: '1. Ensamblado del chasis · Producción' })
  await v.locator('input[name="resultado"][value="NO_CONFORME"]').check()
  // Una observación corta: el navegador la frenaría; se le quita el tope para que decida la base.
  await v.locator('#calidad-observacion').evaluate((el) => el.removeAttribute('minlength'))
  await v.locator('#calidad-observacion').fill('Poros')
  const enviar = v.getByRole('button', { name: 'Registrar', exact: true })
  const antes = acciones.n
  await tresToques(enviar)
  const aviso = await hasta(
    () => v.locator('#calidad-observacion').evaluate((el) => {
      const id = el.getAttribute('aria-describedby')
      return id ? id.split(' ').map((x) => document.getElementById(x)?.textContent ?? '').join(' ') : ''
    }),
    (t) => /al menos 10/.test(t),
  )
  await quieta(pagina)
  comprobar(acciones.n - antes === 1, `[Calidad 1440] tres toques con una observación corta: ${acciones.n - antes} envío`)
  comprobar(/al menos 10/.test(aviso), `[Calidad 1440] el rechazo va junto a la observación: «${limpio(aviso)}»`)
  comprobar(await hasta(() => pagina.evaluate(() => document.activeElement?.id === 'calidad-observacion'), Boolean, 5000), '[Calidad 1440] el cursor vuelve a la observación')
  comprobar((await v.locator('#calidad-observacion').inputValue()) === 'Poros', '[Calidad 1440] lo escrito sigue en el campo')

  await v.locator('#calidad-observacion').fill(OBSERVACION)
  await v.locator('input[type="file"]:not([capture])').setInputFiles(foto)
  await pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })
  await hasta(() => enviar.isEnabled(), Boolean, 30000)
  await pagina.screenshot({ path: join(CAPTURAS, 'a1-calidad-registrar-1440.png') })
  const antesDelBueno = acciones.n
  await tresToques(enviar)
  const verde = await hasta(() => pagina.locator('p[role="status"]').first().innerText().catch(() => ''), (t) => /registrada/.test(t), 30000)
  await quieta(pagina)
  const entraron = await inspecciones('i.observacion = $1', [OBSERVACION])
  observada = entraron[0] ?? null
  comprobar(entraron.length === 1 && acciones.n - antesDelBueno === 1, `[Calidad 1440] tres toques con todo bien: ${entraron.length} inspección y ${acciones.n - antesDelBueno} envío`)
  comprobar(observada?.estado === 'OBSERVADA' && observada?.codigo_interno === CODIGO && observada?.area_id === areaPrd.id && observada?.registrado_por === yo.id, '[Calidad 1440] quedó observada, del código y del área de la etapa, a su nombre')
  comprobar(/Le llegó a/.test(verde), `[Calidad 1440] el verde dice a quién le llegó: «${limpio(verde)}»`)
  const enStorage = await consulta(`select 1 from storage.objects where bucket_id = 'fotos-calidad' and name = $1`, [observada?.ruta ?? ''])
  comprobar(observada?.fotos === 1 && enStorage.length === 1 && (observada?.ruta ?? '').startsWith(`${yo.id}/${observada?.id}/`), '[Calidad 1440] la foto quedó anotada y en Storage, en su carpeta')
  const sueltas = await consulta(
    `select count(*)::int as n from storage.objects o where o.bucket_id = 'fotos-calidad' and o.name like $1
        and not exists (select 1 from public.calidad_fotos f where f.ruta = o.name)`,
    [`${yo.id}/%`],
  )
  comprobar(sueltas[0].n === 0, '[Calidad 1440] ninguna foto suelta en Storage')
  const etapa = await consulta(`select inicio_real, fin_real from public.codigo_etapas where codigo_interno = $1 and orden = 1`, [CODIGO])
  comprobar(etapa[0]?.fin_real === null, '[Calidad 1440] la etapa sigue como estaba: la observación no la bloquea')
  await ir(pagina, `${BASE}/calidad`)
  const fila = pagina.locator(`[data-inspeccion-calidad="${observada?.id}"]`)
  comprobar((await fila.count()) === 1 && /Por corregir/.test(await fila.innerText()), '[Calidad 1440] la lista la muestra «Por corregir» en «Abiertas»')
  await pagina.screenshot({ path: join(CAPTURAS, 'a1-calidad-lista-1440.png'), fullPage: true })
  comprobar(errores.length === 0, `[Calidad 1440] sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

const avisosDe = (correo, id) =>
  consulta(
    `select n.titulo from public.notificaciones n join public.usuarios u on u.id = n.usuario_id
      where u.correo = $1 and n.origen_tabla = 'calidad_inspecciones' and n.origen_id = $2`,
    [correo, id],
  )

// ============================================================ 2. Producción corrige
{
  {
    const { pagina, contexto } = await entrar(CUENTAS.prd)
    await ir(pagina, `${BASE}/`)
    const globo = (await pagina.locator('nav a[aria-label^="Observaciones de calidad, "]').first().getAttribute('aria-label').catch(() => null)) ?? ''
    comprobar(/\d+ pendientes?/.test(globo), `[Producción 1440] su menú dice que tiene observaciones por corregir: «${globo}»`)
    await contexto.close()
  }
  comprobar((await avisosDe(CUENTAS.prd, observada?.id)).length === 1, '[Producción] le llegó un aviso de la observación')
  comprobar((await avisosDe(CUENTAS.mtz, observada?.id)).length === 0, '[Maestranza] a Maestranza no le llegó nada')
  const { pagina, contexto, errores, acciones } = await entrar(CUENTAS.prd, CELULAR)
  await ir(pagina, `${BASE}/calidad`)
  comprobar((await pagina.getByRole('heading', { name: 'Observaciones de calidad' }).count()) === 1, '[Producción 390] abre «Observaciones de calidad»')
  const fila = pagina.locator(`[data-inspeccion-calidad="${observada?.id}"]`)
  comprobar((await fila.count()) === 1, '[Producción 390] ve la observación de su área en «Por corregir»')
  await pagina.screenshot({ path: join(CAPTURAS, 'a1-area-lista-390.png'), fullPage: true })
  await ir(pagina, `${BASE}/calidad/${observada?.id}`)
  const fotoVista = await hasta(() => pagina.locator('main img').first().evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false), Boolean, 15000)
  comprobar(fotoVista, '[Producción 390] ve la foto de la observación')
  comprobar((await pagina.getByRole('button', { name: 'Levantar' }).count()) === 0, '[Producción 390] no puede levantarla')
  await pagina.screenshot({ path: join(CAPTURAS, 'a1-area-ficha-390.png'), fullPage: true })
  await pagina.getByRole('button', { name: 'Marcar corregido' }).click()
  const v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('#calidad-nota').fill(`Se esmeriló y se volvió a soldar la unión (${sello}).`)
  const antes = acciones.n
  await tresToques(v.getByRole('button', { name: 'Marcar corregido' }))
  const verde = await hasta(() => pagina.locator('p[role="status"]').first().innerText().catch(() => ''), (t) => /Corrección registrada/.test(t), 30000)
  await quieta(pagina)
  const [i] = await inspecciones('i.id = $1', [observada?.id])
  const pasos = await consulta(`select tipo from public.calidad_inspeccion_pasos where inspeccion_id = $1`, [observada?.id])
  comprobar(i?.estado === 'CORREGIDA' && pasos.length === 1 && acciones.n - antes === 1, `[Producción 390] tres toques: ${pasos.length} paso y ${acciones.n - antes} envío, y quedó «corregida»`)
  comprobar(/Calidad/.test(verde), `[Producción 390] el verde dice que le llegó a Calidad: «${limpio(verde)}»`)
  comprobar((await avisosDe(CUENTAS.calidad, observada?.id)).length === 1, '[Calidad] le llegó el aviso de la corrección')
  await pagina.screenshot({ path: join(CAPTURAS, 'a1-area-corregida-390.png'), fullPage: true })
  comprobar(errores.length === 0, `[Producción 390] sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================================ 3. Maestranza no la ve
{
  const { pagina, contexto } = await entrar(CUENTAS.mtz, CELULAR)
  await ir(pagina, `${BASE}/calidad`)
  comprobar((await pagina.locator(`[data-inspeccion-calidad="${observada?.id}"]`).count()) === 0, '[Maestranza 390] no ve la observación de Producción')
  await ir(pagina, `${BASE}/calidad/${observada?.id}`)
  // La página de «no existe» sale con 200 cuando el marco ya empezó a enviarse: se mira lo que dice.
  const cuerpo = limpio(await pagina.locator('main').innerText())
  comprobar(!cuerpo.includes(OBSERVACION) && (await pagina.locator('[data-recorrido]').count()) === 0, `[Maestranza 390] ni por su dirección: «${cuerpo.slice(0, 90)}»`)
  await contexto.close()
}

let anuladaId = null
// ============================================================ 4. Calidad vuelve a observar, levanta, registra conforme y anula
{
  const { pagina, contexto, errores, acciones } = await entrar(CUENTAS.calidad)
  await ir(pagina, `${BASE}/`)
  const globo = (await pagina.locator('nav a[aria-label^="Inspecciones de calidad, "]').first().getAttribute('aria-label').catch(() => null)) ?? ''
  comprobar(/\d+ pendientes?/.test(globo), `[Calidad 1440] su menú cuenta lo que espera su revisión: «${globo}»`)
  await ir(pagina, `${BASE}/calidad/${observada?.id}`)
  comprobar((await pagina.getByRole('button', { name: 'Marcar corregido' }).count()) === 0, '[Calidad 1440] no marca corregido por el área')
  await pagina.screenshot({ path: join(CAPTURAS, 'a1-calidad-ficha-corregida-1440.png'), fullPage: true })
  await pagina.getByRole('button', { name: 'Volver a observar' }).click()
  let v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('#calidad-nota').fill(`Quedan dos poros en el extremo (${sello}).`)
  await v.getByRole('button', { name: 'Volver a observar' }).click()
  await hasta(() => pagina.locator('p[role="status"]').first().innerText().catch(() => ''), (t) => /devuelta/.test(t), 30000)
  await quieta(pagina)
  let [i] = await inspecciones('i.id = $1', [observada?.id])
  comprobar(i?.estado === 'OBSERVADA', '[Calidad 1440] vuelve a observarla y queda «por corregir»')
  comprobar((await avisosDe(CUENTAS.prd, observada?.id)).length === 2, '[Producción] le llegó la segunda observación')

  await ir(pagina, `${BASE}/calidad/${observada?.id}`)
  await pagina.getByRole('button', { name: 'Levantar' }).click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  const antes = acciones.n
  await tresToques(v.getByRole('button', { name: 'Levantar' }))
  await hasta(() => pagina.locator('p[role="status"]').first().innerText().catch(() => ''), (t) => /levantada/.test(t), 30000)
  await quieta(pagina)
  ;[i] = await inspecciones('i.id = $1', [observada?.id])
  comprobar(i?.estado === 'LEVANTADA' && acciones.n - antes === 1, `[Calidad 1440] la levanta con un solo envío: ${acciones.n - antes}`)
  await ir(pagina, `${BASE}/calidad/${observada?.id}`)
  const recorrido = limpio(await pagina.locator('[data-recorrido]').innerText())
  comprobar(
    /Revisada: no conforme/.test(recorrido) && /El área la corrigió/.test(recorrido) && /volvió a observar/.test(recorrido) && /la levantó/.test(recorrido),
    `[Calidad 1440] el recorrido cuenta cada paso: «${recorrido.slice(0, 200)}»`,
  )
  await pagina.screenshot({ path: join(CAPTURAS, 'a1-calidad-ficha-levantada-1440.png'), fullPage: true })

  // Una etapa sin área a cargo: se pide el área.
  await ir(pagina, `${BASE}/calidad`)
  await pagina.getByRole('button', { name: 'Registrar inspección' }).click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('#calidad-codigo').click()
  await pagina.getByPlaceholder('Código, OT, cliente o unidad…').fill(CODIGO)
  await pagina.getByRole('option', { name: new RegExp(CODIGO) }).click()
  comprobar((await v.locator('#calidad-area').count()) === 0, '[Calidad 1440] con una etapa de área, no pide el área')
  const entrega = await v.locator('#calidad-etapa option', { hasText: 'Entrega' }).first().getAttribute('value')
  await v.locator('#calidad-etapa').selectOption(entrega ?? '')
  comprobar((await v.locator('#calidad-area').count()) === 1, '[Calidad 1440] la etapa sin área pide el área que hizo el trabajo')
  const areasOfrecidas = await v.locator('#calidad-area option').allInnerTexts()
  comprobar(
    areasOfrecidas.includes('Producción') && !areasOfrecidas.some((a) => /Calidad|Gerencia|Tesorería|Administración/.test(a)),
    `[Calidad 1440] ofrece solo áreas de la planta, sin Calidad: ${areasOfrecidas.join(', ')}`,
  )
  await v.getByRole('button', { name: 'Cancelar' }).click()

  // Un código sin etapas: se elige el área.
  await pagina.getByRole('button', { name: 'Registrar inspección' }).click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('#calidad-codigo').click()
  await pagina.getByPlaceholder('Código, OT, cliente o unidad…').fill(SIN_ETAPAS)
  await pagina.getByRole('option', { name: new RegExp(SIN_ETAPAS) }).click()
  comprobar((await v.locator('#calidad-etapa').count()) === 0 && (await v.locator('#calidad-area').count()) === 1, '[Calidad 1440] un código sin etapas pide el área')
  await v.locator('#calidad-area').selectOption({ label: 'Maestranza' })
  await v.locator('input[name="resultado"][value="CONFORME"]').check()
  const nota = `Habilitado revisado sin observaciones (${sello}).`
  await v.locator('#calidad-observacion').fill(nota)
  await v.getByRole('button', { name: 'Registrar', exact: true }).click()
  await hasta(() => pagina.locator('p[role="status"]').first().innerText().catch(() => ''), (t) => /conforme/.test(t), 30000)
  await quieta(pagina)
  const [conforme] = await inspecciones('i.observacion = $1', [nota])
  comprobar(conforme?.estado === 'CONFORME' && conforme?.codigo_etapa_id === null, '[Calidad 1440] la conforme entra sin etapa, con el área elegida')
  comprobar((await consulta(`select 1 from public.notificaciones where origen_id = $1`, [conforme?.id])).length === 0, '[Calidad 1440] la conforme no avisa a nadie')

  await ir(pagina, `${BASE}/calidad/${conforme?.id}`)
  await pagina.getByRole('button', { name: 'Anular' }).click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('textarea[name="motivo"]').fill('Se registró en el código equivocado.')
  const antesDeAnular = acciones.n
  await tresToques(v.getByRole('button', { name: 'Anular' }))
  await hasta(async () => (await inspecciones('i.id = $1', [conforme?.id]))[0]?.estado, (e) => e === 'ANULADA', 30000)
  await quieta(pagina)
  const [anulada] = await inspecciones('i.id = $1', [conforme?.id])
  comprobar(anulada?.estado === 'ANULADA' && anulada?.motivo_anulacion === 'Se registró en el código equivocado.' && acciones.n - antesDeAnular === 1, `[Calidad 1440] la anula con su motivo, con un solo envío: ${acciones.n - antesDeAnular}`)
  comprobar((await consulta(`select 1 from public.calidad_inspecciones where id = $1`, [conforme?.id])).length === 1, '[Calidad 1440] la anulada sigue en la base: no se borra')
  anuladaId = conforme?.id
  comprobar(errores.length === 0, `[Calidad 1440] sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================================ 4a. El área ve la anulada, en lectura
{
  const { pagina, contexto } = await entrar(CUENTAS.mtz, CELULAR)
  await ir(pagina, `${BASE}/calidad/${anuladaId}`)
  const cuerpo = limpio(await pagina.locator('main').innerText())
  comprobar(
    /Anulada/.test(cuerpo) && /código equivocado/.test(cuerpo) && (await pagina.getByRole('button', { name: /Marcar corregido|Anular/ }).count()) === 0,
    `[Maestranza 390] abre la anulada de su área, con su motivo y sin botones: «${cuerpo.slice(0, 120)}»`,
  )
  await contexto.close()
}

// ============================================================ 4b. Calidad en el teléfono
{
  const { pagina, contexto } = await entrar(CUENTAS.calidad, CELULAR)
  await ir(pagina, `${BASE}/calidad?vista=vigentes`)
  await pagina.screenshot({ path: join(CAPTURAS, 'a1-calidad-lista-390.png'), fullPage: true })
  await pagina.getByRole('button', { name: 'Registrar inspección' }).click()
  const v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('#calidad-codigo').click()
  await pagina.getByPlaceholder('Código, OT, cliente o unidad…').fill(CODIGO)
  await pagina.getByRole('option', { name: new RegExp(CODIGO) }).click()
  await v.locator('input[name="resultado"][value="NO_CONFORME"]').check()
  await pagina.screenshot({ path: join(CAPTURAS, 'a1-calidad-registrar-390.png'), fullPage: true })
  await contexto.close()
}

// ============================================================ 5. Gerencia consulta
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  await ir(pagina, `${BASE}/calidad?vista=vigentes`)
  comprobar((await pagina.locator(`[data-inspeccion-calidad="${observada?.id}"]`).count()) === 1, '[Gerencia 1440] ve las inspecciones')
  comprobar((await pagina.getByRole('button', { name: 'Registrar inspección' }).count()) === 0, '[Gerencia 1440] no registra')
  await ir(pagina, `${BASE}/calidad?vista=vigentes&codigo=${SIN_ETAPAS}`)
  comprobar(
    (await pagina.locator(`[data-inspeccion-calidad="${observada?.id}"]`).count()) === 0 &&
      (await pagina.getByRole('searchbox').or(pagina.getByLabel('Buscar inspecciones')).count()) > 0,
    `[Gerencia 1440] busca por código: con ${SIN_ETAPAS}, la de ${CODIGO} no sale`,
  )
  await ir(pagina, `${BASE}/calidad/${observada?.id}`)
  comprobar(
    (await pagina.getByRole('button', { name: /Anular|Levantar|Volver a observar|Marcar corregido/ }).count()) === 0,
    '[Gerencia 1440] en la ficha, ningún botón: solo consulta',
  )
  await pagina.screenshot({ path: join(CAPTURAS, 'a1-gerencia-ficha-1440.png'), fullPage: true })
  comprobar(errores.length === 0, `[Gerencia 1440] sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================================ 6. Diseño no ve la de otra área
{
  const { pagina, contexto } = await entrar(CUENTAS.diseno)
  await ir(pagina, `${BASE}/`)
  const menu = await textoDelMenu(pagina)
  comprobar(/Observaciones de calidad/.test(menu) && !/Inspecciones de calidad/.test(menu), '[Diseño 1440] tiene las observaciones de su área en el menú, no las inspecciones')
  await ir(pagina, `${BASE}/calidad/${observada?.id}`)
  const cuerpo = limpio(await pagina.locator('main').innerText())
  comprobar(!cuerpo.includes(OBSERVACION) && (await pagina.locator('[data-recorrido]').count()) === 0, `[Diseño 1440] la ficha de otra área no existe para él: «${cuerpo.slice(0, 90)}»`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} comprobación(es) fallaron.` : '\nTodo bien: Calidad inspecciona, el área corrige y cada quien ve lo suyo.')
process.exit(fallas.length ? 1 : 0)
