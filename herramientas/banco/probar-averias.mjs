/**
 * Clic real sobre «Reportar avería» (Plan 16, entrega 16.2, migración
 * 20261126100100), con la cuenta de cada puesto y mirando la base después de
 * cada toque.
 *
 *  1. Ventas, en el teléfono, sin ningún permiso de equipos: «Reportar avería»
 *     está en su menú. Elige la tronzadora de Maestranza buscándola, marca que
 *     detiene el trabajo, pone una foto y toca «Enviar» tres veces: entra un
 *     solo AV-…, con su foto en Storage, el equipo queda parado y el verde dice
 *     a quién le avisamos. Ve su recorrido y su foto; no puede anular.
 *  2. El supervisor de Maestranza (responsable del área) recibe el aviso y lo
 *     ve en «En tu área». El de Producción no lo ve, ni por su dirección.
 *  3. Gerencia lo consulta, sin «Anular».
 *  4. Mantenimiento, en el monitor: lo ve en su lista y en su inicio, lo anula
 *     con su motivo (tres toques, un envío) y el equipo vuelve a operativo; a
 *     Ventas le llega el aviso.
 *
 * Deja en el banco los reportes que crea (un documento numerado no se borra):
 * anulados, con una marca propia en la descripción.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo), CAPTURAS.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { esperarReactAlNavegar } from './con-react.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()

const base = new pg.Client({ host: '/tmp', port: 5433, user: 'postgres', database: process.env.BANCO_BASE ?? 'mw_demo' })
await base.connect()
const consulta = async (sql, valores = []) => (await base.query(sql, valores)).rows
const una = async (sql, valores = []) => (await consulta(sql, valores))[0]
const cuenta = async (correo) => (await una('select id from public.usuarios where correo = $1', [correo])).id

/** Espera a que `leer` dé algo que cumpla `listo`, o devuelve lo último que leyó. */
async function hasta(leer, listo, ms = 20000) {
  const fin = Date.now() + ms
  let v
  while (Date.now() < fin) {
    v = await leer()
    if (listo(v)) return v
    await new Promise((r) => setTimeout(r, 250))
  }
  return v
}

const EQUIPO = 'TRO-14-01'
const sello = Date.now().toString().slice(-6)
const TEXTO = `El disco se traba al cortar y salen chispas por la guarda (${sello}).`
const ventas = await cuenta('ventas.local@metalwork.test')
const supMtz = await cuenta('sup.mtz.local@metalwork.test')
const mantenimiento = await cuenta('mantenimiento.local@metalwork.test')

// El responsable de Maestranza es su supervisor, como lo pondría el administrador
// en Configuración.
await base.query(`update public.areas set jefe_id = $1 where codigo = 'MTZ'`, [supMtz])
// El equipo empieza sin reportes vigentes: los de una vuelta anterior los anula
// Mantenimiento, con su función, para que el equipo vuelva como lo haría de verdad.
// Ponerlo operativo por debajo dejaba un reporte que dice «detiene» con el equipo
// operativo. Solo si quedó parado por otra cosa se arregla a mano.
await base.query('begin')
await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [
  mantenimiento,
])
await base.query('set local role authenticated')
await base.query(
  `select public.averias_anular(v.id, 'Limpieza del banco antes de la prueba de averías.')
     from public.averias_visibles(null) v where v.equipo_codigo = $1 and v.estado in ('REPORTADA', 'EN_ATENCION')`,
  [EQUIPO],
)
await base.query('commit')
await base.query(`update public.equipos set estado = 'OPERATIVO', estado_nota = null where codigo = $1 and estado <> 'OPERATIVO'`, [EQUIPO])

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, telefono = false) {
  const contexto = await navegador.newContext({
    viewport: telefono ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    hasTouch: telefono,
    isMobile: telefono,
    timezoneId: 'America/Lima',
  })
  const pagina = esperarReactAlNavegar(await contexto.newPage())
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  // Cuántas veces salió una acción de servidor: tres toques tienen que ser un envío.
  const acciones = { n: 0 }
  pagina.on('request', (r) => {
    if (r.method() === 'POST' && r.headers()['next-action']) acciones.n++
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto, errores, acciones }
}

/** Tres toques seguidos al mismo botón, sin esperar entre ellos. */
async function tresToques(boton) {
  await boton.evaluate((b) => {
    b.click()
    b.click()
    b.click()
  })
}

const ventana = (pagina) => pagina.getByRole('dialog')
const cerrada = (pagina) => ventana(pagina).waitFor({ state: 'hidden', timeout: 30000 })
const reportes = () =>
  consulta(
    `select v.id, v.numero, v.tipo, v.detiene_trabajo, v.riesgo_personas, v.registrado_por, v.estado, v.paro_el_equipo,
            (select count(*)::int from public.averia_fotos f where f.averia_id = v.id) as fotos,
            (select f.ruta from public.averia_fotos f where f.averia_id = v.id order by f.orden limit 1) as ruta
       from public.averias v where v.descripcion = $1`,
    [TEXTO],
  )

// Una foto chica en JPEG.
const foto = join(CAPTURAS, `averia-foto-${sello}.jpg`)
{
  const p = await (await navegador.newContext()).newPage()
  const b64 = await p.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 800
    c.height = 600
    const g = c.getContext('2d')
    g.fillStyle = '#3d4a5c'
    g.fillRect(0, 0, 800, 600)
    g.fillStyle = '#fff'
    g.font = '32px sans-serif'
    g.fillText(`Tronzadora ${Math.random()}`, 30, 80)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
    const b = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return btoa(s)
  })
  writeFileSync(foto, Buffer.from(b64, 'base64'))
  await p.context().close()
}

// ---------------------------------------------------------------------------
// 1. Ventas reporta desde el teléfono
// ---------------------------------------------------------------------------
let averia = null
{
  const { pagina, contexto, errores, acciones } = await entrar('ventas.local@metalwork.test', true)
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: /Más|Menú/ }).last().click().catch(() => {})
  const enMenu = await hasta(() => pagina.locator('a[href="/averias"]').count(), (n) => n > 0, 5000)
  comprobar(enMenu > 0, '[Ventas 390] «Reportar avería» está en su menú, sin ningún permiso de equipos')

  await pagina.goto(`${BASE}/averias`, { waitUntil: 'networkidle' })
  comprobar(limpio(await pagina.locator('h1').first().innerText()) === 'Reportar avería', '[Ventas 390] la pantalla se llama «Reportar avería»')
  await pagina.screenshot({ path: join(CAPTURAS, 'averias-ventas-vacia-390.png'), fullPage: true })

  await pagina.locator('[data-reportar-averia]').click()
  const v = ventana(pagina)
  await v.waitFor()
  // El equipo, buscándolo por su código.
  await v.locator('#averia-equipo').click()
  await pagina.getByPlaceholder('Código, nombre o área…').fill('TRO-14-01')
  await pagina.getByRole('option', { name: new RegExp(EQUIPO) }).click()
  await v.getByLabel(/^Avería/).check()
  await v.getByRole('group', { name: /¿Detiene el trabajo\?/ }).getByLabel('Sí').check()
  await v.getByRole('group', { name: /¿Es un riesgo para las personas\?/ }).getByLabel('No').check()
  await v.locator('#averia-descripcion').fill(TEXTO)
  await pagina.screenshot({ path: join(CAPTURAS, 'averias-formulario-390.png'), fullPage: true })

  await v.locator('input[type="file"]:not([capture])').setInputFiles(foto)
  const enviar = v.getByRole('button', { name: 'Enviar el reporte' })
  await hasta(() => enviar.isEnabled(), Boolean, 60000)
  const antes = acciones.n
  await tresToques(enviar)
  const verde = await hasta(() => pagina.locator('p[role="status"]').first().innerText().catch(() => ''), (t) => /registrado/.test(t), 30000)
  await pagina.waitForLoadState('networkidle')
  const entraron = await reportes()
  averia = entraron[0] ?? null
  comprobar(entraron.length === 1 && acciones.n - antes === 1, `[Ventas 390] tres toques: ${entraron.length} reporte y ${acciones.n - antes} envío`)
  comprobar(/^AV-\d{4}-\d{4}$/.test(averia?.numero ?? ''), `[Ventas 390] lleva su número: ${averia?.numero}`)
  comprobar(
    averia?.registrado_por === ventas && averia?.tipo === 'AVERIA' && averia?.detiene_trabajo && !averia?.riesgo_personas,
    '[Ventas 390] quedó a su nombre, como avería que detiene el trabajo y sin riesgo',
  )
  comprobar(
    verde.includes(averia?.numero ?? '—') && /quedó parado/.test(verde) && /Mantenimiento/.test(verde) && /responsable del área/.test(verde),
    `[Ventas 390] el verde dice el número, que el equipo quedó parado y a quién le avisamos: «${limpio(verde)}»`,
  )
  const equipo = await una(`select estado, estado_nota from public.equipos where codigo = $1`, [EQUIPO])
  comprobar(equipo.estado === 'PARADO' && equipo.estado_nota.startsWith(`Avería ${averia?.numero}`), `[base] ${EQUIPO} quedó parado con el número en su nota`)
  const enStorage = await consulta(`select 1 from storage.objects where bucket_id = 'fotos-averias' and name = $1`, [averia?.ruta ?? ''])
  comprobar(
    averia?.fotos === 1 && enStorage.length === 1 && (averia?.ruta ?? '').startsWith(`${ventas}/${averia?.id}/`),
    '[Ventas 390] la foto quedó anotada y está en Storage, en su carpeta',
  )
  const avisados = await consulta(`select usuario_id from public.notificaciones where origen_tabla = 'averias' and origen_id = $1`, [averia?.id])
  const ids = avisados.map((a) => a.usuario_id)
  comprobar(ids.includes(mantenimiento) && ids.includes(supMtz) && !ids.includes(ventas), '[base] avisó a Mantenimiento y al responsable de Maestranza, no a quien reporta')
  await pagina.screenshot({ path: join(CAPTURAS, 'averias-ventas-390.png'), fullPage: true })

  // Su ficha: el recorrido y la foto, sin «Anular».
  await pagina.goto(`${BASE}/averias/${averia?.id}`, { waitUntil: 'networkidle' })
  const resumen = limpio(await pagina.locator('[data-recorrido] summary').innerText().catch(() => ''))
  comprobar(/La tiene Mantenimiento/.test(resumen), `[Ventas 390] su recorrido dice quién la tiene: «${resumen}»`)
  await pagina.locator('[data-recorrido] summary').click()
  const pasos = await pagina.locator('[data-recorrido-paso]').evaluateAll((l) => l.map((e) => `${e.dataset.recorridoPaso}:${e.dataset.situacion}`))
  comprobar(
    pasos.join(' ') === 'REPORTE:HECHO ATENCION:AHORA CIERRE:PENDIENTE CONFIRMACION:PENDIENTE',
    `[Ventas 390] el recorrido: ${pasos.join(' ')}`,
  )
  const fotoVista = await hasta(() => pagina.locator('main img').first().evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false), Boolean, 15000)
  comprobar(fotoVista, '[Ventas 390] ve su foto')
  comprobar((await pagina.locator('[data-anular-averia]').count()) === 0, '[Ventas 390] no puede anular')
  const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  comprobar(desborde <= 0, `[Ventas 390] la ficha no se desliza de costado (${desborde} px)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'averias-ficha-ventas-390.png'), fullPage: true })
  comprobar(errores.length === 0, `[Ventas 390] sin errores en la consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------------------
// 2. El área del equipo lo ve; otra área, no
// ---------------------------------------------------------------------------
{
  const { pagina, contexto } = await entrar('sup.mtz.local@metalwork.test', true)
  await pagina.goto(`${BASE}/averias`, { waitUntil: 'networkidle' })
  const enArea = pagina.locator('section, div').filter({ has: pagina.getByText('En tu área', { exact: true }) }).locator(`[data-averia="${averia?.numero}"]`)
  comprobar((await enArea.count()) > 0, '[Supervisor de Maestranza] lo ve en «En tu área»')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('sup.prd.local@metalwork.test')
  await pagina.goto(`${BASE}/averias`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator(`[data-averia="${averia?.numero}"]`).count()) === 0, '[Supervisor de Producción] no lo ve en la lista')
  // Con loading.tsx la respuesta ya salió en 200 cuando la ficha llama a notFound(): se mira lo que se pinta.
  await pagina.goto(`${BASE}/averias/${averia?.id}`, { waitUntil: 'networkidle' })
  const titulo = limpio(await pagina.locator('h1').first().innerText().catch(() => ''))
  const cuerpo = await pagina.locator('main').innerText().catch(() => '')
  comprobar(
    titulo === 'No encontramos lo que buscas' && !cuerpo.includes(averia?.numero ?? '—') && !cuerpo.includes(TEXTO),
    `[Supervisor de Producción] ni por su dirección: «${titulo}», sin el número ni lo que dice`,
  )
  await contexto.close()
}

// ---------------------------------------------------------------------------
// 3. Gerencia consulta
// ---------------------------------------------------------------------------
{
  const { pagina, contexto } = await entrar('gerencia.local@metalwork.test')
  await pagina.goto(`${BASE}/averias`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator(`[data-averia="${averia?.numero}"]`).count()) > 0, '[Gerencia] lo ve en la lista de todas')
  await pagina.goto(`${BASE}/averias/${averia?.id}`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-anular-averia]').count()) === 0, '[Gerencia] sin «Anular»')
  await contexto.close()
}

// ---------------------------------------------------------------------------
// 4. Mantenimiento lo ve y lo anula
// ---------------------------------------------------------------------------
{
  const { pagina, contexto, errores, acciones } = await entrar('mantenimiento.local@metalwork.test')
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const cifra = limpio(await pagina.locator('a[href="/averias"]').filter({ hasText: 'Averías por atender' }).first().innerText().catch(() => ''))
  comprobar(/Averías por atender/.test(cifra) && /detiene/.test(cifra), `[Mantenimiento 1440] su inicio cuenta las averías por atender: «${cifra}»`)
  await pagina.screenshot({ path: join(CAPTURAS, 'averias-inicio-mantenimiento-1440.png'), fullPage: true })

  await pagina.goto(`${BASE}/averias`, { waitUntil: 'networkidle' })
  const fila = pagina.locator(`[data-averia="${averia?.numero}"]`)
  comprobar((await fila.count()) > 0, '[Mantenimiento 1440] lo ve en su lista')
  const reporto = await una(`select nombres from public.usuarios where id = $1`, [ventas])
  comprobar(limpio(await fila.innerText()).includes(limpio(reporto.nombres)), '[Mantenimiento 1440] con quién lo reportó')
  await pagina.screenshot({ path: join(CAPTURAS, 'averias-lista-mantenimiento-1440.png'), fullPage: true })

  await pagina.goto(`${BASE}/averias/${averia?.id}`, { waitUntil: 'networkidle' })
  await pagina.screenshot({ path: join(CAPTURAS, 'averias-ficha-mantenimiento-1440.png'), fullPage: true })
  await pagina.locator('[data-anular-averia]').click()
  const v = ventana(pagina)
  await v.getByLabel('Motivo').fill(`Reporte de prueba del banco (${sello}), se anula.`)
  const antes = acciones.n
  await tresToques(v.getByRole('button', { name: 'Anular' }))
  await cerrada(pagina)
  const dicho = await hasta(() => pagina.locator('p[role="status"]').filter({ hasText: /anulado/ }).first().innerText().catch(() => ''), (t) => /anulado/.test(t))
  const [despues] = await reportes()
  const equipo = await una(`select estado from public.equipos where codigo = $1`, [EQUIPO])
  comprobar(despues?.estado === 'ANULADA' && acciones.n - antes === 1, `[Mantenimiento 1440] tres toques a «Anular»: ${acciones.n - antes} envío y el reporte anulado`)
  comprobar(equipo.estado === 'OPERATIVO', `[base] ${EQUIPO} vuelve a operativo (${equipo.estado})`)
  comprobar(/vuelve a operativo/.test(dicho), `[Mantenimiento 1440] y lo dice arriba: «${limpio(dicho)}»`)
  const aviso = await una(
    `select titulo from public.notificaciones where origen_tabla = 'averias' and origen_id = $1 and usuario_id = $2 and titulo like 'Mantenimiento anuló%'`,
    [averia?.id, ventas],
  )
  comprobar(Boolean(aviso), '[base] a Ventas le llega que se anuló')
  comprobar(errores.length === 0, `[Mantenimiento 1440] sin errores en la consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()
}

await navegador.close()
await base.end()
if (fallas.length > 0) {
  console.log(`\n${fallas.length} fallas:\n- ${fallas.join('\n- ')}`)
  process.exit(1)
}
console.log('\nTodo bien: cualquiera reporta, Mantenimiento recibe y anula, el área se entera y los demás no lo ven.')
