/**
 * Clic real sobre la historia de cada equipo y la lectura de Gerencia (Plan 16,
 * entrega 16.4, migración 20261126995000), con la cuenta de cada puesto y
 * mirando la base después de cada toque.
 *
 *  1. Calidad reporta una avería de la tronzadora de Maestranza; Mantenimiento
 *     la cierra con 5 horas y Calidad confirma. Antes de 30 días, Calidad
 *     reporta otra del mismo equipo (repetida), que Mantenimiento cierra.
 *  2. La cuenta de Calidad se da de baja. El responsable de Maestranza, en el
 *     teléfono, la ve en «¿Quedaron bien?», la confirma (tres toques, un envío)
 *     y el recorrido dice que fue en lugar de quien la reportó.
 *  3. Ventas reporta otra que detiene el trabajo: el equipo queda parado.
 *  4. Gerencia, en el monitor y en el teléfono: «Parados hoy» trae la
 *     tronzadora con su reporte, y «Los que más fallan» la pone primero. Abre su
 *     historia: las cifras son las de la base.
 *  5. Almacén ve las cifras, no los reportes de otra área; Ventas no entra a la
 *     historia. Mantenimiento ve en la bandeja que la última repite la anterior.
 *
 * Deja en el banco lo que crea (un documento numerado no se borra): las averías
 * confirmadas y la última, anulada. La cuenta de Calidad vuelve a quedar activa.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo), CAPTURAS.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { esperarReactAlNavegar } from './con-react.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const ESCALA = Number(process.env.ESCALA ?? 1)
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
/** Da de baja o reactiva una cuenta del banco. La guarda de `usuarios` pide una sesión de Administración; aquí no hay pantalla que probar, así que va sin disparadores. */
async function cuentaActiva(id, activo) {
  await base.query('begin')
  await base.query('set local session_replication_role = replica')
  await base.query('update public.usuarios set activo = $2 where id = $1', [id, activo])
  await base.query('commit')
}

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

/** Corre `sql` con la cuenta de `usuario` y `role authenticated`, como lo haría su pantalla. */
async function como(usuario, sql, valores = []) {
  await base.query('begin')
  try {
    await base.query(
      `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
      [usuario],
    )
    await base.query('set local role authenticated')
    const r = await base.query(sql, valores)
    await base.query('commit')
    return r.rows
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

const EQUIPO = 'TRO-14-01'
const sello = Date.now().toString().slice(-6)
const calidad = await cuenta('calidad.local@metalwork.test')
const ventas = await cuenta('ventas.local@metalwork.test')
const mantenimiento = await cuenta('mantenimiento.local@metalwork.test')
const gerencia = await cuenta('gerencia.local@metalwork.test')
const jefe = (await una(`select a.jefe_id as id from public.areas a where a.codigo = 'MTZ'`)).id
const correoJefe = (await una('select correo from public.usuarios where id = $1', [jefe])).correo
const equipoId = (await una('select id from public.equipos where codigo = $1', [EQUIPO])).id

// El equipo empieza sin reportes por atender: los de una vuelta anterior los
// anula Mantenimiento; los cerrados los confirma Mantenimiento si quien los
// reportó no tiene cuenta, o quien los reportó.
await cuentaActiva(calidad, true)
for (const v of await consulta(
  `select a.id, a.estado, a.registrado_por from public.averias a where a.equipo_id = $1 and a.estado in ('REPORTADA', 'EN_ATENCION', 'CERRADA')`,
  [equipoId],
)) {
  if (v.estado === 'CERRADA') await como(v.registrado_por, `select * from public.averias_confirmar($1, true, 'Limpieza del banco.')`, [v.id])
  else await como(mantenimiento, `select * from public.averias_anular($1, 'Limpieza del banco antes de la prueba.')`, [v.id])
}
await base.query(`update public.equipos set estado = 'OPERATIVO', estado_nota = null where id = $1 and estado <> 'OPERATIVO'`, [equipoId])

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, telefono = false) {
  const contexto = await navegador.newContext({
    viewport: telefono ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    hasTouch: telefono,
    isMobile: telefono,
    deviceScaleFactor: ESCALA,
    timezoneId: 'America/Lima',
  })
  const pagina = esperarReactAlNavegar(await contexto.newPage())
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
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

async function tresToques(boton) {
  await boton.evaluate((b) => {
    b.click()
    b.click()
    b.click()
  })
}
const ventana = (pagina) => pagina.getByRole('dialog')
const cerrada = (pagina) => ventana(pagina).waitFor({ state: 'hidden', timeout: 30000 })
const desborde = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

let idC = null
try {
  // ---------------------------------------------------------------------------
  // 1. Dos averías de Calidad: la segunda repite la primera
  // ---------------------------------------------------------------------------
  const idA = crypto.randomUUID()
  await como(calidad, `select * from public.averias_reportar($1, $2, 'AVERIA', true, false, $3, '[]')`, [idA, equipoId, `No corta parejo y vibra (${sello}).`])
  await como(mantenimiento, `select * from public.averias_atender($1, 'El disco está gastado y el eje tiene juego.')`, [idA])
  await como(mantenimiento, `select * from public.averias_cerrar($1, 'Se cambió el disco y se ajustó el eje.', 5)`, [idA])
  await como(calidad, `select * from public.averias_confirmar($1, true, null)`, [idA])
  const idB = crypto.randomUUID()
  await como(calidad, `select * from public.averias_reportar($1, $2, 'AVERIA', false, false, $3, '[]')`, [idB, equipoId, `Vuelve a vibrar al cortar tubo (${sello}).`])
  const numeroA = (await una('select numero from public.averias where id = $1', [idA])).numero
  const numeroB = (await una('select numero from public.averias where id = $1', [idB])).numero
  await como(mantenimiento, `select * from public.averias_atender($1, 'El eje volvió a soltarse: falta el seguro.')`, [idB])
  const [cierre] = await como(mantenimiento, `select * from public.averias_cerrar($1, 'Se puso el seguro del eje y se probó cortando.', 2)`, [idB])
  comprobar(cierre.confirma === 'QUIEN_REPORTO', `[Mantenimiento] cerró ${numeroB}; con la cuenta de Calidad activa, la confirma ella`)

  // ---------------------------------------------------------------------------
  // 2. Calidad se va: confirma el responsable de Maestranza, en el teléfono
  // ---------------------------------------------------------------------------
  await cuentaActiva(calidad, false)
  {
    const { pagina, contexto, errores, acciones } = await entrar(correoJefe, true)
    await pagina.goto(`${BASE}/averias`, { waitUntil: 'networkidle' })
    comprobar((await pagina.locator(`[data-por-confirmar] tr[data-averia="${numeroB}"]`).count()) === 1, `[Responsable MTZ 390] ve ${numeroB} en «¿Quedaron bien?»`)
    const desc = limpio(await pagina.locator('[data-por-confirmar]').innerText().catch(() => ''))
    comprobar(/ya no tiene cuenta/.test(desc), `[Responsable MTZ 390] dice por qué le toca («${desc.slice(0, 120)}…»)`)
    await pagina.screenshot({ path: join(CAPTURAS, '16.4-responsable-por-confirmar-390.png'), fullPage: true })
    await pagina.goto(`${BASE}/averias/${idB}`, { waitUntil: 'networkidle' })
    const quien = limpio(await pagina.locator('[data-quien-la-tiene]').innerText().catch(() => ''))
    comprobar(/te toca a ti/.test(quien), `[Responsable MTZ 390] la ficha le dice que le toca («${quien}»)`)
    await pagina.locator('[data-confirmar-averia]').click()
    const v = ventana(pagina)
    await v.waitFor()
    comprobar(/ya no tiene cuenta/.test(limpio(await v.innerText())), '[Responsable MTZ 390] la ventana dice en lugar de quién confirma')
    await v.getByLabel('Sí, quedó bien').check()
    await pagina.screenshot({ path: join(CAPTURAS, '16.4-responsable-confirma-390.png') })
    const antes = acciones.n
    await tresToques(v.getByRole('button', { name: 'Enviar' }))
    await cerrada(pagina)
    comprobar(acciones.n - antes === 1, `[Responsable MTZ 390] «Enviar» con tres toques salió una vez (${acciones.n - antes})`)
    const e = await hasta(
      () => una(`select a.estado, (select hecho_por from public.averia_pasos where averia_id = a.id and paso = 'CONFIRMACION') as por from public.averias a where a.id = $1`, [idB]),
      (x) => x.estado === 'CONFIRMADA',
    )
    comprobar(e.estado === 'CONFIRMADA' && e.por === jefe, '[Responsable MTZ 390] queda confirmada a su nombre')
    await pagina.reload({ waitUntil: 'networkidle' })
    const pasos = await pagina.locator('li[data-recorrido-paso]').evaluateAll((lis) => lis.map((l) => l.textContent ?? ''))
    comprobar(pasos.some((t) => /en lugar de quien la reportó/.test(t)), '[Responsable MTZ 390] el recorrido dice que confirmó en lugar de quien la reportó')
    comprobar(/en lugar de quien la reportó/.test(limpio(await pagina.locator('[data-atencion]').innerText())), '[Responsable MTZ 390] y la atención, quién la confirmó')
    await pagina.screenshot({ path: join(CAPTURAS, '16.4-confirmada-en-lugar-390.png'), fullPage: true })
    comprobar((await desborde(pagina)) <= 0, '[Responsable MTZ 390] la ficha no se desliza de costado')
    comprobar(errores.length === 0, `[Responsable MTZ 390] sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }
  await cuentaActiva(calidad, true)

  // ---------------------------------------------------------------------------
  // 3. Ventas reporta otra que detiene el trabajo
  // ---------------------------------------------------------------------------
  idC = crypto.randomUUID()
  const [rC] = await como(ventas, `select * from public.averias_reportar($1, $2, 'AVERIA', true, false, $3, '[]')`, [idC, equipoId, `No arranca: hace un chasquido (${sello}).`])
  comprobar(rC.equipo_parado, `[Ventas] reportó ${rC.numero_averia} y el equipo quedó parado`)
  const numeroC = rC.numero_averia

  // Lo que dice la base, con los ojos de Gerencia.
  const [h] = await como(gerencia, 'select * from public.equipos_historia($1)', [equipoId])
  comprobar(h.averias >= 3 && h.repetidas >= 1 && h.parado_por === numeroC, `[Base] la historia: ${h.averias} averías, ${h.repetidas} repetidas, parado por ${h.parado_por}`)

  // ---------------------------------------------------------------------------
  // 4. Gerencia lee los parados y los que más fallan, y abre la historia
  // ---------------------------------------------------------------------------
  for (const telefono of [false, true]) {
    const etq = telefono ? '390' : '1440'
    const { pagina, contexto, errores } = await entrar('gerencia.local@metalwork.test', telefono)
    await pagina.goto(`${BASE}/equipos`, { waitUntil: 'networkidle' })
    const parado = limpio(await pagina.locator(`[data-parados-hoy] [data-parado="${EQUIPO}"]`).innerText().catch(() => ''))
    comprobar(parado.includes(numeroC), `[Gerencia ${etq}] «Parados hoy» trae ${EQUIPO} con su reporte («${parado}»)`)
    const fallan = await pagina.locator('[data-los-que-mas-fallan] [data-falla]').evaluateAll((lis) => lis.map((l) => l.getAttribute('data-falla')))
    comprobar(fallan[0] === EQUIPO, `[Gerencia ${etq}] «Los que más fallan» lo pone primero (${fallan.join(', ')})`)
    await pagina.screenshot({ path: join(CAPTURAS, `16.4-equipos-gerencia-${etq}.png`), fullPage: true })
    comprobar((await desborde(pagina)) <= 0, `[Gerencia ${etq}] el padrón no se desliza de costado`)
    await pagina.locator(`[data-los-que-mas-fallan] [data-falla="${EQUIPO}"] a`).click()
    await pagina.waitForURL((u) => u.pathname === `/equipos/${equipoId}`)
    await pagina.waitForLoadState('networkidle')
    const cifras = limpio(await pagina.locator('[data-historia-cifras]').innerText())
    comprobar(
      cifras.includes(`Averías ${h.averias}`) && cifras.includes(`Repetidas ${h.repetidas}`),
      `[Gerencia ${etq}] las cifras de la historia son las de la base («${cifras.slice(0, 160)}»)`,
    )
    comprobar((await pagina.locator(`tr[data-averia="${numeroB}"]`).count()) === 1 && (await pagina.locator(`tr[data-averia="${numeroC}"]`).count()) === 1, `[Gerencia ${etq}] ve cada reporte del equipo`)
    const fila = limpio(await pagina.locator(`tr[data-averia="${numeroB}"]`).innerText())
    comprobar(fila.includes(`Repite la ${numeroA}`), `[Gerencia ${etq}] la segunda dice que repite la primera`)
    const hoy = limpio(await pagina.locator('[data-equipo-hoy]').innerText())
    comprobar(hoy.includes(numeroC) && /Lleva .* parado/.test(hoy), `[Gerencia ${etq}] arriba dice qué reporte lo tiene parado y cuánto lleva («${hoy.slice(0, 140)}»)`)
    comprobar((await pagina.locator('[data-confirmar-averia], [data-atender-averia]').count()) === 0, `[Gerencia ${etq}] consulta: ningún botón de atender`)
    await pagina.screenshot({ path: join(CAPTURAS, `16.4-historia-gerencia-${etq}.png`), fullPage: true })
    comprobar((await desborde(pagina)) <= 0, `[Gerencia ${etq}] la historia no se desliza de costado`)
    comprobar(errores.length === 0, `[Gerencia ${etq}] sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // ---------------------------------------------------------------------------
  // 5. Almacén ve las cifras, no los reportes; Ventas no entra; Mantenimiento ve la repetida
  // ---------------------------------------------------------------------------
  {
    const { pagina, contexto, errores } = await entrar('almacen.local@metalwork.test')
    await pagina.goto(`${BASE}/equipos/${equipoId}`, { waitUntil: 'networkidle' })
    const cifras = limpio(await pagina.locator('[data-historia-cifras]').innerText().catch(() => ''))
    comprobar(cifras.includes(`Averías ${h.averias}`), `[Almacén 1440] ve las mismas cifras («${cifras.slice(0, 80)}»)`)
    comprobar((await pagina.locator('tr[data-averia]').count()) === 0, '[Almacén 1440] pero no los reportes de Maestranza')
    await pagina.screenshot({ path: join(CAPTURAS, '16.4-historia-almacen-1440.png'), fullPage: true })
    // El padrón y «Parados hoy» no le muestran lo que escribió Ventas: solo el número del reporte.
    await pagina.goto(`${BASE}/equipos`, { waitUntil: 'networkidle' })
    const html = await pagina.content()
    comprobar(!html.includes(`hace un chasquido (${sello})`), '[Almacén 1440] el padrón no trae lo que escribió Ventas en su reporte, ni en la página ni en lo que va al navegador')
    comprobar(
      limpio(await pagina.locator(`[data-parados-hoy] [data-parado="${EQUIPO}"]`).innerText().catch(() => '')).includes(`por el reporte ${numeroC}`),
      '[Almacén 1440] «Parados hoy» dice solo el número del reporte',
    )
    comprobar(errores.length === 0, `[Almacén 1440] sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }
  {
    const { pagina, contexto } = await entrar('ventas.local@metalwork.test', true)
    await pagina.goto(`${BASE}/equipos/${equipoId}`, { waitUntil: 'networkidle' })
    comprobar(!pagina.url().includes(`/equipos/${equipoId}`) || (await pagina.locator('[data-historia-cifras]').count()) === 0, `[Ventas 390] no entra a la historia (${new URL(pagina.url()).pathname})`)
    await pagina.goto(`${BASE}/averias/${idC}`, { waitUntil: 'networkidle' })
    comprobar((await pagina.locator('[data-historia-del-equipo]').count()) === 0, '[Ventas 390] su reporte no la enlaza')
    await contexto.close()
  }
  {
    const { pagina, contexto, errores } = await entrar('mantenimiento.local@metalwork.test', true)
    await pagina.goto(`${BASE}/averias`, { waitUntil: 'networkidle' })
    const fila = limpio(await pagina.locator(`tr[data-averia="${numeroC}"]`).innerText().catch(() => ''))
    comprobar(fila.includes(`Repite la ${numeroB}`), `[Mantenimiento 390] la bandeja dice que ${numeroC} repite ${numeroB}`)
    await pagina.screenshot({ path: join(CAPTURAS, '16.4-bandeja-repetida-390.png'), fullPage: true })
    await pagina.goto(`${BASE}/averias/${idC}`, { waitUntil: 'networkidle' })
    await pagina.locator('[data-historia-del-equipo]').click()
    await pagina.waitForURL((u) => u.pathname === `/equipos/${equipoId}`)
    comprobar(true, '[Mantenimiento 390] desde el reporte abre la historia del equipo')
    comprobar(errores.length === 0, `[Mantenimiento 390] sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }
} finally {
  // La cuenta de Calidad vuelve a estar activa, y la última avería se anula: el
  // equipo no queda parado en el banco.
  await cuentaActiva(calidad, true)
  if (idC) await como(mantenimiento, `select * from public.averias_anular($1, 'Prueba del banco: la historia del equipo.')`, [idC]).catch((e) => console.error(e.message))
  await navegador.close()
  await base.end()
}
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallan.`)
process.exit(fallas.length === 0 ? 0 : 1)
