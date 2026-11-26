/**
 * SSOMA: clasificar y las acciones correctivas (Plan 15, entrega 15.2), con
 * clic real y la cuenta de cada puesto (nunca ADMIN):
 *
 *   0. Supervisión de Maestranza reporta una condición insegura en su área (por
 *      la función, con su sesión: el reporte se probó con clic en probar-ssoma).
 *   1. SSOMA, en el monitor: clasifica (la base rechaza una causa corta junto al
 *      campo; tres toques dan una sola clasificación) y encarga dos acciones a
 *      Almacén (tres toques, una sola acción; el aviso llega con su ancla).
 *   2. Almacén, en el celular: el globo del menú cuenta lo suyo; «Tus acciones»
 *      pone la vencida arriba; abre la acción y ve el hecho sin quién lo
 *      reportó, sin la clasificación; la cierra con nota y foto (tres toques, un
 *      cierre, la foto en su carpeta, ninguna suelta) y SSOMA recibe el aviso.
 *   3. Maestranza, quien reportó: ve qué se corrige y cómo va, sin la evidencia.
 *   4. SSOMA: «Acciones correctivas» con la vencida arriba; ve la foto de la
 *      evidencia; reabre la cerrada, reasigna la vencida a Producción y anula la
 *      reabierta. Producción cierra la suya: el reporte queda corregido y quien
 *      lo reportó se entera.
 *   5. Gerencia consulta todo sin poder escribir. Ventas no ve nada.
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

/** Elige una cuenta en el buscador de responsables. */
async function elegirCuenta(pagina, ventana, campo, texto) {
  await ventana.locator(campo).click()
  await pagina.getByPlaceholder('Nombre, puesto o área…').fill(texto)
  await pagina.getByRole('option', { name: new RegExp(texto) }).first().click()
}

const sello = Date.now().toString().slice(-6)
const foto = join(tmpdir(), `ssoma-evidencia-${sello}.jpg`)
{
  const p = await (await navegador.newContext()).newPage()
  const b64 = await p.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 800
    c.height = 600
    const g = c.getContext('2d')
    g.fillStyle = '#2f5d3a'
    g.fillRect(0, 0, 800, 600)
    g.fillStyle = '#fff'
    g.font = '32px sans-serif'
    g.fillText(`Tope puesto ${Math.random()}`, 30, 80)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
    const b = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return btoa(s)
  })
  writeFileSync(foto, Buffer.from(b64, 'base64'))
  await p.context().close()
}

const acciones = (reporte) =>
  consulta(
    `select a.id, a.descripcion, a.estado, a.fecha_limite::text as fecha, u.correo as responsable,
            (select count(*)::int from public.ssoma_accion_fotos f where f.accion_id = a.id) as fotos
       from public.ssoma_acciones a join public.usuarios u on u.id = a.responsable_id
      where a.reporte_id = $1 order by a.creado_en`,
    [reporte],
  )
const avisosDe = (correo, origen) =>
  consulta(
    `select n.titulo, n.ruta from public.notificaciones n join public.usuarios u on u.id = n.usuario_id
      where u.correo = $1 and n.origen_id = $2 order by n.creado_en`,
    [correo, origen],
  )

// ------------------------------------------------------------ 0. Maestranza reporta
const [mtz] = await consulta(`select id from public.usuarios where correo = $1`, [CUENTAS.mtz])
const LUGAR = `Plegadora, guarda lateral ${sello}`
await base.query('begin')
await base.query(`select set_config('request.jwt.claim.sub', $1, true)`, [mtz.id])
const [rep] = await consulta(
  `select reporte as id, numero_reporte as numero from public.ssoma_reportar(gen_random_uuid(), 'CONDICION_INSEGURA',
     (select id from public.areas where codigo = 'MTZ'), $1, $2, null, null, null, '[]'::jsonb)`,
  [LUGAR, `A la plegadora le falta la guarda lateral desde el mantenimiento del lunes (${sello}).`],
)
await base.query('commit')
comprobar(Boolean(rep?.numero), `[Maestranza] reporta ${rep?.numero}`)

const DESC_1 = `Poner la guarda lateral de la plegadora (${sello}).`
const DESC_2 = `Revisar las guardas de las otras máquinas de la nave (${sello}).`
let accion1 = null
let accion2 = null

// ------------------------------------------------------------ 1. SSOMA clasifica y encarga
{
  const { pagina, contexto, errores, acciones: envios } = await entrar(CUENTAS.ssoma, MONITOR)
  await ir(pagina, `${BASE}/ssoma/${rep.id}`)
  const tarjeta = limpio(await pagina.locator('[data-clasificacion]').innerText())
  comprobar(/Todavía sin clasificar/.test(tarjeta), '[SSOMA 1440] el reporte nuevo sale sin clasificar')
  comprobar((await pagina.locator('[data-agregar-accion]').count()) === 0 && /Primero clasifica/.test(limpio(await pagina.locator('[data-sin-acciones]').innerText())),
    '[SSOMA 1440] sin clasificar no ofrece acciones: dice que primero va la causa')

  await pagina.locator('[data-clasificar-reporte]').click()
  const v = pagina.locator('[role="dialog"]', { has: pagina.locator(`#ssoma-causa-${rep.id}`) })
  await v.waitFor({ timeout: 10000 })
  comprobar(await v.locator('input[name="clasificacion"][value="CONDICION_INSEGURA"]').isChecked(), '[SSOMA 1440] empieza por la clase de lo que se reportó')
  await v.locator('input[name="clasificacion"][value="ACCIDENTE_INCAPACITANTE"]').check()
  comprobar((await v.locator('input[name="hubo_atencion"]').count()) === 2 && (await v.locator(`#ssoma-dias-${rep.id}`).count()) === 1,
    '[SSOMA 1440] el incapacitante pide la atención médica y los días perdidos')
  await v.locator('input[name="clasificacion"][value="CONDICION_INSEGURA"]').check()
  comprobar((await v.locator('input[name="hubo_atencion"]').count()) === 0 && (await v.locator(`#ssoma-dias-${rep.id}`).count()) === 0,
    '[SSOMA 1440] la condición insegura no los pide')

  // Una causa corta: el navegador la frena; sin el tope del campo, decide la base y lo dice junto a él.
  const causa = v.locator(`#ssoma-causa-${rep.id}`)
  await causa.fill('Descuido')
  await causa.evaluate((el) => el.removeAttribute('minlength'))
  const guardar = v.getByRole('button', { name: 'Guardar la clasificación' })
  const antes = envios.n
  await tresToques(guardar)
  const aviso = await hasta(() => causa.evaluate((el) => {
    const id = el.getAttribute('aria-describedby')
    return id ? (document.getElementById(id)?.textContent ?? '') : ''
  }), (t) => /causa/.test(t))
  comprobar(envios.n - antes === 1 && /Anota la causa/.test(aviso), `[SSOMA 1440] tres toques con la causa corta: ${envios.n - antes} envío, y el rechazo junto al campo: «${limpio(aviso)}»`)
  comprobar(await hasta(() => pagina.evaluate((id) => document.activeElement?.id === id, `ssoma-causa-${rep.id}`), Boolean, 5000), '[SSOMA 1440] el cursor vuelve a la causa')

  const CAUSA = `La guarda se retiró en el mantenimiento y nadie la volvió a poner antes de arrancar (${sello}).`
  await causa.fill(CAUSA)
  const antes2 = envios.n
  await tresToques(guardar)
  await hasta(() => v.isVisible(), (x) => !x, 20000)
  await quieta(pagina)
  const clas = await consulta(`select clasificacion, causa from public.ssoma_clasificaciones where reporte_id = $1`, [rep.id])
  comprobar(envios.n - antes2 === 1 && clas.length === 1 && clas[0].causa === CAUSA, `[SSOMA 1440] tres toques con todo bien: ${envios.n - antes2} envío y ${clas.length} clasificación`)
  const ahora = limpio(await hasta(() => pagina.locator('[data-clasificacion]').innerText(), (t) => t.includes(CAUSA)))
  comprobar(/Condición insegura/.test(ahora) && ahora.includes(CAUSA), '[SSOMA 1440] la ficha muestra la clasificación y la causa sin recargar')

  // La primera acción, con tres toques.
  await pagina.getByRole('button', { name: 'Agregar acción' }).click()
  const va = pagina.locator('[role="dialog"]', { has: pagina.getByRole('button', { name: 'Encargar la acción' }) })
  await va.waitFor({ timeout: 10000 })
  await va.locator('textarea[name="descripcion"]').fill(DESC_1)
  await elegirCuenta(pagina, va, '[id^="ssoma-responsable-"]', 'Almacén Banco')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-accion-nueva-1440.png') })
  const antes3 = envios.n
  await tresToques(va.getByRole('button', { name: 'Encargar la acción' }))
  const verde = await hasta(() => pagina.locator('p[role="status"]').filter({ hasText: 'Acción registrada' }).first().innerText().catch(() => ''), (t) => /registrada/.test(t), 30000)
  await quieta(pagina)
  let lista = await acciones(rep.id)
  comprobar(lista.length === 1 && envios.n - antes3 === 1 && lista[0].responsable === CUENTAS.almacen, `[SSOMA 1440] tres toques: ${lista.length} acción y ${envios.n - antes3} envío, a cargo de Almacén`)
  comprobar(/ya le avisamos al responsable/.test(verde), `[SSOMA 1440] el verde dice que se avisó: «${limpio(verde)}»`)
  accion1 = lista[0]
  const aviso1 = await avisosDe(CUENTAS.almacen, accion1?.id)
  comprobar(aviso1.length === 1 && aviso1[0].ruta === `/ssoma/${rep.id}#accion-${accion1?.id}`, `[SSOMA 1440] a Almacén le llegó el aviso, con su ancla: «${aviso1[0]?.titulo}»`)

  // La segunda, que se pone vencida en la base para ver el orden.
  await pagina.getByRole('button', { name: 'Agregar acción' }).click()
  await va.waitFor({ timeout: 10000 })
  await va.locator('textarea[name="descripcion"]').fill(DESC_2)
  await elegirCuenta(pagina, va, '[id^="ssoma-responsable-"]', 'Almacén Banco')
  await va.getByRole('button', { name: 'Encargar la acción' }).click()
  await hasta(async () => (await acciones(rep.id)).length, (n) => n === 2, 20000)
  lista = await acciones(rep.id)
  accion2 = lista.find((a) => a.descripcion === DESC_2)
  comprobar(Boolean(accion2), '[SSOMA 1440] la segunda acción también quedó')
  await base.query(`update public.ssoma_acciones set fecha_limite = (now() at time zone 'America/Lima')::date - 3 where id = $1`, [accion2?.id])
  await ir(pagina, `${BASE}/ssoma/${rep.id}`)
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-ficha-ssoma-1440.png'), fullPage: true })
  comprobar(errores.length === 0, `[SSOMA 1440] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 2. Almacén, en el celular
{
  const { pagina, contexto, errores, acciones: envios, yo } = await entrar(CUENTAS.almacen, CELULAR)
  await pagina.getByRole('button', { name: /^Más/ }).click()
  const globo = await pagina.locator('a[href="/ssoma"][aria-label*="pendiente"]').first().getAttribute('aria-label').catch(() => null)
  comprobar(/[2-9]\d* pendientes|\d{2,} pendientes/.test(globo ?? ''), `[Almacén 390] el menú cuenta lo suyo en SSOMA: «${globo}»`)
  await ir(pagina, `${BASE}/ssoma`)
  const tus = pagina.locator('[data-tus-acciones]')
  comprobar(await tus.isVisible(), '[Almacén 390] ve «Tus acciones correctivas» arriba')
  const filas = tus.locator('[data-accion-ssoma]')
  const primera = await filas.first().getAttribute('data-vencida')
  comprobar(primera === 'true', '[Almacén 390] la vencida va arriba')
  comprobar(/\d+ abiertas? · \d+ vencidas?/.test(limpio(await tus.innerText())), '[Almacén 390] la cabecera dice cuántas abiertas y vencidas')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-tus-acciones-390.png'), fullPage: true })

  await tus.locator(`[data-accion-ssoma="${accion1?.id}"] a`).first().click()
  await pagina.waitForURL((u) => u.pathname === `/ssoma/${rep.id}`, { timeout: 20000 })
  await quieta(pagina)
  comprobar(pagina.url().endsWith(`#accion-${accion1?.id}`), '[Almacén 390] la fila lleva a la acción dentro del reporte')
  const main = limpio(await pagina.locator('main').innerText())
  comprobar(/tienes a cargo una acción correctiva/.test(main) && !main.includes('Aurelio') && !main.includes('Ramírez'),
    '[Almacén 390] ve el hecho sin quién lo reportó')
  comprobar((await pagina.locator('[data-clasificacion]').count()) === 0 && !main.includes('La guarda se retiró'), '[Almacén 390] no ve la clasificación ni la causa')
  comprobar((await pagina.locator('[data-reasignar-accion], [data-anular-accion], [data-reabrir-accion], [data-agregar-accion]').count()) === 0,
    '[Almacén 390] no se le ofrece reasignar, anular ni encargar')

  await pagina.locator(`[data-cerrar-accion="${accion1?.id}"]`).click()
  const vc = pagina.locator('[role="dialog"]', { has: pagina.locator(`#ssoma-hecho-${accion1?.id}`) })
  await vc.waitFor({ timeout: 10000 })
  const cerrar = vc.getByRole('button', { name: 'Cerrar la acción' })
  comprobar(await cerrar.isDisabled(), '[Almacén 390] sin foto no se puede cerrar')
  comprobar(/Falta al menos una foto/.test(limpio(await vc.innerText())), '[Almacén 390] y lo dice junto al botón')
  const NOTA = `Se puso la guarda lateral y se ajustaron sus pernos (${sello}).`
  await vc.locator(`#ssoma-hecho-${accion1?.id}`).fill(NOTA)
  await vc.locator('input[type="file"]:not([capture])').setInputFiles(foto)
  await pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })
  await hasta(() => cerrar.isEnabled(), Boolean, 30000)
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-cerrar-con-evidencia-390.png'), fullPage: true })
  const antes = envios.n
  await tresToques(cerrar)
  const verde = await hasta(() => pagina.locator('p[role="status"]').filter({ hasText: 'cerrada' }).first().innerText().catch(() => ''), (t) => /cerrada/.test(t), 30000)
  await quieta(pagina)
  const [a1] = (await acciones(rep.id)).filter((a) => a.id === accion1?.id)
  comprobar(a1?.estado === 'CERRADA' && a1?.fotos === 1 && envios.n - antes === 1, `[Almacén 390] tres toques: cerrada con ${a1?.fotos} foto y ${envios.n - antes} envío`)
  comprobar(/ya le avisamos a SSOMA/.test(verde), `[Almacén 390] el verde lo dice: «${limpio(verde)}»`)
  const [ruta] = await consulta(`select ruta from public.ssoma_accion_fotos where accion_id = $1`, [accion1?.id])
  const enStorage = await consulta(`select 1 from storage.objects where bucket_id = 'fotos-ssoma' and name = $1`, [ruta?.ruta ?? ''])
  comprobar(enStorage.length === 1 && (ruta?.ruta ?? '').startsWith(`${yo.id}/`), '[Almacén 390] la foto está en Storage, en su carpeta')
  const sueltas = await consulta(
    `select count(*)::int as n from storage.objects o where o.bucket_id = 'fotos-ssoma' and o.name like $1
        and not exists (select 1 from public.ssoma_accion_fotos f where f.ruta = o.name)
        and not exists (select 1 from public.ssoma_reporte_fotos f where f.ruta = o.name)`,
    [`${yo.id}/%`],
  )
  comprobar(sueltas[0].n === 0, '[Almacén 390] ninguna foto suelta')
  const alSsoma = await avisosDe(CUENTAS.ssoma, accion1?.id)
  comprobar(alSsoma.some((n) => /Acción cerrada con evidencia/.test(n.titulo)), '[Almacén 390] a SSOMA le llegó el aviso del cierre')
  const cerradaEnPantalla = await hasta(() => pagina.locator(`[data-accion-ssoma="${accion1?.id}"]`).getAttribute('data-estado'), (e) => e === 'CERRADA', 15000)
  comprobar(cerradaEnPantalla === 'CERRADA', '[Almacén 390] la acción sale cerrada sin recargar')
  // El verde vive en la fila, no en el botón que se va con la acción cerrada: se sigue leyendo.
  await pagina.waitForTimeout(1500)
  const verdeDespues = await pagina.locator(`[data-accion-ssoma="${accion1?.id}"] p[role="status"]`).innerText().catch(() => '')
  comprobar(/ya le avisamos a SSOMA/.test(verdeDespues), `[Almacén 390] el verde sigue a la vista con la acción ya cerrada: «${limpio(verdeDespues)}»`)
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-accion-cerrada-390.png'), fullPage: true })
  comprobar(errores.length === 0, `[Almacén 390] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 3. Maestranza, quien reportó
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.mtz, CELULAR)
  await ir(pagina, `${BASE}/ssoma/${rep.id}`)
  // El recorrido va plegado: se lee su texto entero, no solo lo que se ve.
  const recorrido = limpio(await pagina.locator('[data-recorrido]').textContent())
  comprobar(/En corrección · 1 de 2 acciones cerradas · 1 vencida/.test(recorrido), `[Maestranza 390] el recorrido dice cómo va: «${recorrido.slice(-120)}»`)
  comprobar((await pagina.locator('[data-accion-ssoma]').count()) === 2, '[Maestranza 390] ve las dos acciones de su reporte')
  comprobar((await pagina.locator('[data-accion-ssoma] img').count()) === 0 && (await pagina.locator('[data-cerrar-accion]').count()) === 0,
    '[Maestranza 390] sin la foto de la evidencia ni el botón de cerrar')
  comprobar((await pagina.locator('[data-clasificacion]').count()) === 0, '[Maestranza 390] sin la clasificación')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-reporte-quien-reporto-390.png'), fullPage: true })
  comprobar(errores.length === 0, `[Maestranza 390] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 4. SSOMA sigue, reabre, reasigna y anula
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.ssoma, MONITOR)
  await ir(pagina, `${BASE}/ssoma`)
  const porClasificar = await consulta(`select count(*)::int as n from public.ssoma_reportes where estado = 'REPORTADO'`)
  if (porClasificar[0].n > 0) {
    const fila = limpio(await pagina.locator('[data-reporte-ssoma]').first().innerText())
    comprobar(/Por clasificar/.test(fila), `[SSOMA 1440] en «Reportes», lo que espera su clasificación va primero: «${fila.slice(0, 80)}»`)
  } else {
    console.log('  -- · [SSOMA 1440] no hay reportes por clasificar en esta base: el orden de «Reportes» no se miró')
  }
  await ir(pagina, `${BASE}/ssoma?vista=acciones`)
  const primera = pagina.locator('[data-accion-ssoma]').first()
  comprobar((await primera.getAttribute('data-vencida')) === 'true', '[SSOMA 1440] en «Acciones correctivas», las vencidas arriba')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-acciones-1440.png'), fullPage: true })

  await ir(pagina, `${BASE}/ssoma/${rep.id}`)
  comprobar((await pagina.locator(`[data-accion-ssoma="${accion1?.id}"] img`).count()) >= 1, '[SSOMA 1440] ve la foto de la evidencia')
  comprobar((await pagina.locator('[data-anular-reporte]').count()) === 0, '[SSOMA 1440] un reporte con acciones no ofrece anularse')

  // Reabre la cerrada.
  await pagina.locator(`[data-reabrir-accion="${accion1?.id}"]`).click()
  const vr = pagina.locator('[role="dialog"]', { has: pagina.locator(`#reabrir-${accion1?.id}`) })
  await vr.waitFor({ timeout: 10000 })
  await vr.locator(`#reabrir-${accion1?.id}`).fill('Falta ajustar el perno de abajo de la guarda.')
  await vr.getByRole('button', { name: 'Reabrir' }).click()
  await hasta(async () => (await acciones(rep.id)).find((a) => a.id === accion1?.id)?.estado, (e) => e === 'ABIERTA', 20000)
  comprobar((await avisosDe(CUENTAS.almacen, accion1?.id)).some((n) => /reabrió/.test(n.titulo)), '[SSOMA 1440] reabre la cerrada y Almacén recibe el aviso')

  // Reasigna la vencida a Producción, con fecha nueva.
  await quieta(pagina)
  await pagina.locator(`[data-reasignar-accion="${accion2?.id}"]`).click()
  const vs = pagina.locator('[role="dialog"]', { has: pagina.locator(`#reasignar-fecha-${accion2?.id}`) })
  await vs.waitFor({ timeout: 10000 })
  await elegirCuenta(pagina, vs, `#reasignar-${accion2?.id}`, 'Teodoro Alva')
  const [{ hoy }] = await consulta(`select ((now() at time zone 'America/Lima')::date + 2)::text as hoy`)
  await vs.locator(`#reasignar-fecha-${accion2?.id}`).fill(hoy)
  await vs.getByRole('button', { name: 'Reasignar' }).click()
  await hasta(async () => (await acciones(rep.id)).find((a) => a.id === accion2?.id)?.responsable, (c) => c === CUENTAS.prd, 20000)
  const a2 = (await acciones(rep.id)).find((a) => a.id === accion2?.id)
  comprobar(a2?.responsable === CUENTAS.prd && a2?.fecha === hoy, '[SSOMA 1440] reasigna la vencida a Producción con fecha nueva')
  comprobar((await avisosDe(CUENTAS.prd, accion2?.id)).length === 1 && (await avisosDe(CUENTAS.almacen, accion2?.id)).some((n) => /otra persona/.test(n.titulo)),
    '[SSOMA 1440] Producción recibe el aviso y Almacén se entera')

  // Anula la reabierta.
  await quieta(pagina)
  await pagina.locator(`[data-anular-accion="${accion1?.id}"]`).click()
  const vn = pagina.locator('[role="dialog"]', { has: pagina.locator(`#anular-accion-${accion1?.id}`) })
  await vn.waitFor({ timeout: 10000 })
  await vn.locator(`#anular-accion-${accion1?.id}`).fill('Se cambió la plegadora: la guarda ya no aplica.')
  await vn.getByRole('button', { name: 'Anular' }).click()
  await hasta(async () => (await acciones(rep.id)).find((a) => a.id === accion1?.id)?.estado, (e) => e === 'ANULADA', 20000)
  comprobar((await acciones(rep.id)).find((a) => a.id === accion1?.id)?.estado === 'ANULADA', '[SSOMA 1440] anula la reabierta con su motivo')
  await quieta(pagina)
  const historia = pagina.locator(`[data-accion-ssoma="${accion1?.id}"] [data-historia-accion]`)
  await historia.locator('summary').click()
  const pasos = limpio(await historia.innerText())
  comprobar(/Encargada/.test(pasos) && /Cerrada con evidencia/.test(pasos) && /Reabierta por SSOMA/.test(pasos) && /Anulada por SSOMA/.test(pasos),
    '[SSOMA 1440] la historia de la acción tiene sus cuatro pasos')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-ficha-historia-1440.png'), fullPage: true })
  comprobar(errores.length === 0, `[SSOMA 1440] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// Producción cierra la suya: el reporte queda corregido.
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.prd, CELULAR)
  await ir(pagina, `${BASE}/ssoma/${rep.id}#accion-${accion2?.id}`)
  await pagina.locator(`[data-cerrar-accion="${accion2?.id}"]`).click()
  const vc = pagina.locator('[role="dialog"]', { has: pagina.locator(`#ssoma-hecho-${accion2?.id}`) })
  await vc.waitFor({ timeout: 10000 })
  await vc.locator(`#ssoma-hecho-${accion2?.id}`).fill(`Se revisaron las guardas de las seis máquinas (${sello}).`)
  await vc.locator('input[type="file"]:not([capture])').setInputFiles(foto)
  await pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })
  const cerrar = vc.getByRole('button', { name: 'Cerrar la acción' })
  await hasta(() => cerrar.isEnabled(), Boolean, 30000)
  await cerrar.click()
  const [r] = await hasta(() => consulta(`select estado from public.ssoma_reportes where id = $1`, [rep.id]), (f) => f[0]?.estado === 'CERRADO', 30000)
  comprobar(r?.estado === 'CERRADO', '[Producción 390] al cerrar la última, el reporte queda corregido')
  comprobar((await avisosDe(CUENTAS.mtz, rep.id)).some((n) => /quedó corregido/.test(n.titulo)), '[Producción 390] y a quien lo reportó le llega el aviso')
  comprobar(errores.length === 0, `[Producción 390] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}
{
  // Otra acción en un reporte ya corregido: SSOMA sabe antes de guardar que lo vuelve a abrir.
  const { pagina, contexto } = await entrar(CUENTAS.ssoma, MONITOR)
  await ir(pagina, `${BASE}/ssoma/${rep.id}`)
  await pagina.getByRole('button', { name: 'Agregar acción' }).click()
  const aviso = pagina.locator('[role="dialog"] [data-aviso-corregido]')
  comprobar(await aviso.isVisible(), '[SSOMA 1440] en un reporte corregido, «Agregar acción» avisa que lo vuelve a abrir')
  await pagina.keyboard.press('Escape')
  await contexto.close()
}

// ------------------------------------------------------------ 5. Gerencia y Ventas
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia, MONITOR)
  await ir(pagina, `${BASE}/ssoma/${rep.id}`)
  const clas = limpio(await pagina.locator('[data-clasificacion]').innerText())
  comprobar(/Condición insegura/.test(clas) && /La guarda se retiró/.test(clas), '[Gerencia 1440] ve la clasificación y la causa')
  comprobar(
    (await pagina.locator('[data-clasificar-reporte], [data-agregar-accion], [data-cerrar-accion], [data-reasignar-accion], [data-anular-accion], [data-reabrir-accion]').count()) === 0,
    '[Gerencia 1440] no se le ofrece clasificar, encargar, cerrar ni cambiar acciones',
  )
  comprobar((await pagina.locator(`[data-accion-ssoma="${accion2?.id}"] img`).count()) >= 1, '[Gerencia 1440] ve la evidencia')
  comprobar(/Corregido/.test(limpio(await pagina.locator('[data-recorrido] summary').innerText())), '[Gerencia 1440] el recorrido dice «Corregido» sin abrirlo')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-ficha-gerencia-1440.png'), fullPage: true })
  await ir(pagina, `${BASE}/ssoma?vista=acciones`)
  comprobar((await pagina.locator(`[data-accion-ssoma="${accion2?.id}"]`).count()) === 1, '[Gerencia 1440] consulta «Acciones correctivas»')
  // SSOMA también le puede encargar una acción a Gerencia: su inicio y su lista se lo dicen.
  const [ssomaYo] = await consulta(`select id from public.usuarios where correo = $1`, [CUENTAS.ssoma])
  const [gerYo] = await consulta(`select id from public.usuarios where correo = $1`, [CUENTAS.gerencia])
  const DESC_G = `Aprobar la compra de guardas para toda la nave (${sello}).`
  await base.query('begin')
  await base.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ssomaYo.id])
  const [ag] = await consulta(`select public.ssoma_crear_accion(gen_random_uuid(), $1, $2, $3, current_date + 7) as id`, [rep.id, DESC_G, gerYo.id])
  await base.query('commit')
  await ir(pagina, `${BASE}/`)
  comprobar(/acción correctiva a tu cargo/.test(limpio(await pagina.locator('main').innerText())), '[Gerencia 1440] su inicio dice que tiene una acción correctiva a su cargo')
  await ir(pagina, `${BASE}/ssoma`)
  comprobar((await pagina.locator(`[data-tus-acciones] [data-accion-ssoma="${ag?.id}"]`).count()) === 1, '[Gerencia 1440] la ve en «Tus acciones correctivas», arriba de la lista')
  await pagina.screenshot({ path: join(CAPTURAS, 'ssoma-gerencia-a-cargo-1440.png'), fullPage: true })
  // Se anula: el reporte vuelve a quedar corregido para lo que sigue.
  await base.query('begin')
  await base.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ssomaYo.id])
  await consulta(`select public.ssoma_anular_accion($1, $2)`, [ag?.id, `Lo compra Logística, no Gerencia (${sello}).`])
  await base.query('commit')
  comprobar(errores.length === 0, `[Gerencia 1440] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.ventas, MONITOR)
  await ir(pagina, `${BASE}/ssoma/${rep.id}`)
  const texto = limpio(await pagina.locator('body').innerText())
  comprobar(/Este reporte ya no está a tu vista/.test(texto) && !texto.includes(LUGAR), '[Ventas 1440] no abre el reporte por su dirección')
  comprobar((await pagina.locator('main a[href="/ssoma"]').count()) === 1, '[Ventas 1440] y se le ofrece volver a Seguridad')
  await ir(pagina, `${BASE}/ssoma`)
  comprobar((await pagina.locator('[data-tus-acciones]').count()) === 0 && (await pagina.locator('[data-accion-ssoma]').count()) === 0, '[Ventas 1440] no ve acciones ajenas')
  comprobar(errores.filter((e) => !/404|Not Found/.test(e)).length === 0, `[Ventas 1440] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
