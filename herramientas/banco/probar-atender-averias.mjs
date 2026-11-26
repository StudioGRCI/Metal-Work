/**
 * Clic real sobre la atención de una avería (Plan 16, entrega 16.3, migración
 * 20261126700000), con la cuenta de cada puesto y mirando la base después de
 * cada toque.
 *
 *  1. Ventas reporta (por su función, como lo haría su pantalla) que la
 *     inversora de Maestranza detiene el trabajo, y otra posible avería menos
 *     grave del mismo día.
 *  2. Mantenimiento, en el monitor: la bandeja trae primero la que detiene el
 *     trabajo. Abre la ficha, toca «Atender» y anota el diagnóstico (tres
 *     toques, un envío); enlaza el RQ de los repuestos buscándolo; y la cierra
 *     con el trabajo hecho y las horas que propone la pantalla. El equipo vuelve
 *     a operativo y a Ventas le llega el aviso.
 *  3. Ventas, en el teléfono: ve «¿Quedaron bien?», abre la ficha, ve el RQ y
 *     cómo va, y dice que no quedó bien. Vuelve a Mantenimiento y el equipo,
 *     a parado.
 *  4. Mantenimiento la cierra otra vez y Ventas confirma que quedó bien. El
 *     recorrido cuenta todo.
 *  5. Gerencia la consulta sin ningún botón; el supervisor de Producción (otra
 *     área) no la ve ni por su dirección.
 *
 * Deja en el banco lo que crea (un documento numerado no se borra): la avería
 * confirmada, la posible avería anulada y el RQ de prueba.
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

const EQUIPO = 'MS-03'
const sello = Date.now().toString().slice(-6)
const TEXTO = `Se apaga sola a los cinco minutos de soldar (${sello}).`
const TEXTO_LEVE = `Hace un zumbido raro al encender (${sello}).`
const ventas = await cuenta('ventas.local@metalwork.test')
const mantenimiento = await cuenta('mantenimiento.local@metalwork.test')
const requerimientos = await cuenta('requerimientos.local@metalwork.test')

// El equipo empieza sin reportes por atender: los de una vuelta anterior los
// anula Mantenimiento con su función; los cerrados los confirma quien los reportó.
for (const v of await consulta(
  `select a.id, a.estado, a.registrado_por = $2 as de_ventas from public.averias a join public.equipos e on e.id = a.equipo_id
    where e.codigo = $1 and a.estado in ('REPORTADA', 'EN_ATENCION', 'CERRADA')`,
  [EQUIPO, ventas],
)) {
  // Las cerradas las confirma quien las reportó; si no fue Ventas, quedan (ya no detienen el equipo).
  if (v.estado === 'CERRADA') {
    if (v.de_ventas) await como(ventas, `select * from public.averias_confirmar($1, true, 'Limpieza del banco.')`, [v.id])
  } else await como(mantenimiento, `select * from public.averias_anular($1, 'Limpieza del banco antes de la prueba.')`, [v.id])
}
await base.query(`update public.equipos set estado = 'OPERATIVO', estado_nota = null where codigo = $1 and estado <> 'OPERATIVO'`, [EQUIPO])

// El RQ de los repuestos: lo registra Requerimientos, como siempre; aquí, por debajo.
const NUMERO_RQ = `RQ-BANCO-${sello}`
await base.query(
  `insert into public.requerimientos (id, numero, area_id, codigo_interno, justificacion, creado_por)
   values (gen_random_uuid(), $1, (select id from public.areas where codigo = 'MTZ'), 'PLANTA', 'Relé térmico y ventilador para la inversora', $2)`,
  [NUMERO_RQ, requerimientos],
)

// 1. Ventas reporta dos: la que detiene el trabajo y una posible avería.
const equipoId = (await una('select id from public.equipos where codigo = $1', [EQUIPO])).id
const idLeve = crypto.randomUUID()
const id = crypto.randomUUID()
await como(ventas, `select * from public.averias_reportar($1, $2, 'POSIBLE_AVERIA', false, false, $3, '[]')`, [idLeve, equipoId, TEXTO_LEVE])
const [reporte] = await como(ventas, `select * from public.averias_reportar($1, $2, 'AVERIA', true, false, $3, '[]')`, [id, equipoId, TEXTO])
comprobar(reporte.equipo_parado, `[Ventas] reportó ${reporte.numero_averia} y el equipo quedó parado`)
const NUMERO = reporte.numero_averia
// Que lleve unas horas parado, para que la pantalla proponga algo que no sea 0.
await base.query(`alter table public.equipos disable trigger trg_equipo_normalizar`)
await base.query(`update public.equipos set estado_desde = now() - interval '5 hours 10 minutes' where id = $1`, [equipoId])
await base.query(`alter table public.equipos enable trigger trg_equipo_normalizar`)
await base.query(`alter table public.averias disable trigger trg_averia_guardia`)
await base.query(`update public.averias set equipo_parado_desde = (select estado_desde from public.equipos where id = $2) where id = $1`, [id, equipoId])
await base.query(`alter table public.averias enable trigger trg_averia_guardia`)

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
const estado = async () => una(`select a.estado, a.veces_reabierta, a.horas_parado, a.diagnostico, e.estado as equipo from public.averias a join public.equipos e on e.id = a.equipo_id where a.id = $1`, [id])
const verde = (pagina) => hasta(() => pagina.locator('p[role="status"]').first().innerText().catch(() => ''), (t) => t.trim().length > 0, 30000)

// ---------------------------------------------------------------------------
// 2. Mantenimiento atiende, enlaza el RQ y cierra
// ---------------------------------------------------------------------------
{
  const { pagina, contexto, errores, acciones } = await entrar('mantenimiento.local@metalwork.test')
  await pagina.goto(`${BASE}/averias`, { waitUntil: 'networkidle' })
  const filas = await pagina.locator('tr[data-averia]').evaluateAll((trs) => trs.map((t) => t.getAttribute('data-averia')))
  const iGrave = filas.indexOf(NUMERO)
  const leve = (await una('select numero from public.averias where id = $1', [idLeve])).numero
  const iLeve = filas.indexOf(leve)
  comprobar(iGrave >= 0 && iLeve >= 0 && iGrave < iLeve, `[Mantenimiento 1440] la bandeja trae primero la que detiene el trabajo (${NUMERO}) y después la posible avería (${leve})`)
  await pagina.screenshot({ path: join(CAPTURAS, '16.3-bandeja-mantenimiento-1440.png'), fullPage: true })

  await pagina.goto(`${BASE}/averias/${id}`, { waitUntil: 'networkidle' })
  comprobar(
    /Espera tu diagnóstico/.test(limpio(await pagina.locator('[data-quien-la-tiene]').innerText())),
    '[Mantenimiento] la ficha dice que espera su diagnóstico',
  )
  await pagina.locator('[data-atender-averia]').click()
  let v = ventana(pagina)
  await v.waitFor()
  await v.getByRole('textbox', { name: /^Diagnóstico/ }).fill('Relé térmico que corta antes de tiempo y ventilador trabado.')
  let antes = acciones.n
  await tresToques(v.getByRole('button', { name: 'Atender' }))
  await cerrada(pagina)
  comprobar(acciones.n - antes === 1, `[Mantenimiento] «Atender» con tres toques salió una vez (${acciones.n - antes})`)
  let e = await hasta(estado, (x) => x.estado === 'EN_ATENCION')
  comprobar(e.estado === 'EN_ATENCION' && /Relé térmico/.test(e.diagnostico ?? ''), '[Mantenimiento] la avería queda en atención con su diagnóstico')
  comprobar(/Diagnóstico anotado/.test(await verde(pagina)), '[Mantenimiento] el verde lo dice arriba')

  // El RQ de los repuestos, buscándolo por su número.
  await pagina.locator('[data-enlazar-rq]').click()
  v = ventana(pagina)
  await v.waitFor()
  await v.locator(`[id="rq-${id}"]`).click()
  await pagina.getByPlaceholder('Número, área, código o lo que pide…').fill(NUMERO_RQ)
  await pagina.getByRole('option', { name: new RegExp(NUMERO_RQ) }).click()
  await v.getByRole('textbox', { name: /^Qué repuesto/ }).fill('Relé térmico y ventilador')
  await pagina.screenshot({ path: join(CAPTURAS, '16.3-enlazar-rq-1440.png') })
  antes = acciones.n
  await tresToques(v.getByRole('button', { name: 'Enlazar' }))
  await cerrada(pagina)
  comprobar(acciones.n - antes === 1, `[Mantenimiento] «Enlazar» con tres toques salió una vez (${acciones.n - antes})`)
  const enlaces = await hasta(
    () => consulta('select count(*)::int as n from public.averia_requerimientos where averia_id = $1 and quitado_en is null', [id]),
    (r) => r[0].n > 0,
  )
  comprobar(enlaces[0].n === 1, '[Mantenimiento] el RQ queda enlazado una vez')
  await pagina.locator(`[data-rq-enlazado="${NUMERO_RQ}"]`).waitFor({ timeout: 15000 }).catch(() => {})
  comprobar((await pagina.locator(`[data-rq-enlazado="${NUMERO_RQ}"]`).count()) === 1, '[Mantenimiento] y se ve en la ficha, con cómo va')

  // Cerrar: las horas que propone la pantalla son las que lleva parado.
  await pagina.locator('[data-cerrar-averia]').click()
  v = ventana(pagina)
  await v.waitFor()
  const propuestas = await v.getByRole('textbox', { name: /^Horas parado/ }).inputValue()
  comprobar(propuestas === '5', `[Mantenimiento] al cerrar propone las horas que lleva parado (${propuestas})`)
  await v.getByRole('textbox', { name: /^Trabajo hecho/ }).fill('Se cambió el relé térmico y se destrabó el ventilador; se probó media hora.')
  await v.getByRole('textbox', { name: /^Horas parado/ }).fill('5,5')
  await pagina.screenshot({ path: join(CAPTURAS, '16.3-cerrar-1440.png') })
  antes = acciones.n
  await tresToques(v.getByRole('button', { name: 'Cerrar la avería' }))
  await cerrada(pagina)
  comprobar(acciones.n - antes === 1, `[Mantenimiento] «Cerrar» con tres toques salió una vez (${acciones.n - antes})`)
  e = await hasta(estado, (x) => x.estado === 'CERRADA')
  comprobar(e.estado === 'CERRADA' && Number(e.horas_parado) === 5.5 && e.equipo === 'OPERATIVO', '[Mantenimiento] queda cerrada con 5.5 horas y el equipo vuelve a operativo')
  comprobar(/vuelve a operativo/.test(await verde(pagina)), '[Mantenimiento] el verde dice que el equipo vuelve a operativo')
  await pagina.screenshot({ path: join(CAPTURAS, '16.3-ficha-cerrada-mantenimiento-1440.png'), fullPage: true })
  const aviso = await una(`select count(*)::int as n from public.notificaciones where origen_id = $1 and usuario_id = $2 and titulo like '%confirma si quedó bien'`, [id, ventas])
  comprobar(aviso.n === 1, '[Ventas] le llegó el aviso para confirmar')
  comprobar(errores.length === 0, `[Mantenimiento] sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------------------
// 3. Ventas, en el teléfono: no quedó bien
// ---------------------------------------------------------------------------
{
  const { pagina, contexto, errores, acciones } = await entrar('ventas.local@metalwork.test', true)
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const tetoca = limpio(await pagina.locator('a[href="/averias"]').filter({ hasText: /si quedó bien|si quedaron bien/ }).first().innerText().catch(() => ''))
  comprobar(tetoca.length > 0, `[Ventas 390] su inicio le dice que tiene una avería por confirmar («${tetoca}»)`)
  await pagina.goto(`${BASE}/averias`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator(`[data-por-confirmar] tr[data-averia="${NUMERO}"]`).count()) === 1, '[Ventas 390] ve su avería en «¿Quedaron bien?»')
  await pagina.screenshot({ path: join(CAPTURAS, '16.3-ventas-por-confirmar-390.png'), fullPage: true })
  await pagina.goto(`${BASE}/averias/${id}`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-atender-averia], [data-cerrar-averia], [data-anular-averia], [data-enlazar-rq]').count()) === 0, '[Ventas 390] no ve botones de Mantenimiento')
  const rq = limpio(await pagina.locator(`[data-rq-enlazado="${NUMERO_RQ}"]`).innerText().catch(() => ''))
  comprobar(/Por revisar/.test(rq) && (await pagina.locator(`[data-rq-enlazado="${NUMERO_RQ}"] a`).count()) === 0, `[Ventas 390] ve el RQ y cómo va, sin enlace a la pantalla de RQ («${rq}»)`)
  comprobar((await pagina.locator('[data-horas-parado="5.5"]').count()) === 1, '[Ventas 390] ve el trabajo hecho y las horas parado')
  await pagina.screenshot({ path: join(CAPTURAS, '16.3-ficha-por-confirmar-390.png'), fullPage: true })
  await pagina.locator('[data-confirmar-averia]').click()
  const v = ventana(pagina)
  await v.waitFor()
  await v.getByLabel('No, sigue fallando').check()
  await v.getByRole('textbox', { name: /^Qué sigue fallando/ }).fill('Se volvió a apagar a la media hora de soldar.')
  await pagina.screenshot({ path: join(CAPTURAS, '16.3-no-quedo-bien-390.png') })
  const antes = acciones.n
  await tresToques(v.getByRole('button', { name: 'Devolver a Mantenimiento' }))
  await cerrada(pagina)
  comprobar(acciones.n - antes === 1, `[Ventas 390] «Devolver» con tres toques salió una vez (${acciones.n - antes})`)
  const e = await hasta(estado, (x) => x.estado === 'EN_ATENCION')
  comprobar(e.estado === 'EN_ATENCION' && e.veces_reabierta === 1 && e.equipo === 'PARADO', '[Ventas 390] vuelve a Mantenimiento y el equipo queda parado otra vez')
  comprobar(/Vuelve a Mantenimiento/.test(await verde(pagina)), '[Ventas 390] el verde lo dice')
  comprobar(errores.length === 0, `[Ventas 390] sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------------------
// 4. Se cierra otra vez y Ventas confirma
// ---------------------------------------------------------------------------
await como(mantenimiento, `select * from public.averias_cerrar($1, 'Se cambió también el sensor de temperatura del relé.', 2)`, [id])
{
  const { pagina, contexto, errores } = await entrar('ventas.local@metalwork.test')
  await pagina.goto(`${BASE}/averias/${id}`, { waitUntil: 'networkidle' })
  await pagina.locator('[data-confirmar-averia]').click()
  const v = ventana(pagina)
  await v.waitFor()
  await v.getByLabel('Sí, quedó bien').check()
  await v.getByRole('button', { name: 'Enviar' }).click()
  await cerrada(pagina)
  const e = await hasta(estado, (x) => x.estado === 'CONFIRMADA')
  comprobar(e.estado === 'CONFIRMADA' && e.equipo === 'OPERATIVO', '[Ventas 1440] confirma que quedó bien; el equipo sigue operativo')
  await pagina.reload({ waitUntil: 'networkidle' })
  const pasos = await pagina.locator('li[data-recorrido-paso]').evaluateAll((lis) => lis.map((l) => l.textContent ?? ''))
  comprobar(pasos.some((t) => /No quedó bien/.test(t) && /Se volvió a apagar/.test(t)) && pasos.some((t) => /confirmó que quedó bien/.test(t)), '[Ventas 1440] el recorrido cuenta que no quedó bien, con lo que dijo, y que después lo confirmó')
  await pagina.screenshot({ path: join(CAPTURAS, '16.3-ficha-confirmada-1440.png'), fullPage: true })
  comprobar(errores.length === 0, `[Ventas 1440] sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------------------
// 5. Gerencia consulta; otra área no ve nada
// ---------------------------------------------------------------------------
{
  const { pagina, contexto } = await entrar('gerencia.local@metalwork.test', true)
  await pagina.goto(`${BASE}/averias?vista=cerradas`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator(`tr[data-averia="${NUMERO}"]`).count()) === 1, '[Gerencia 390] la ve en «Quedaron bien»')
  await pagina.screenshot({ path: join(CAPTURAS, '16.3-gerencia-quedaron-bien-390.png'), fullPage: true })
  await pagina.goto(`${BASE}/averias/${idLeve}`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-atender-averia], [data-anular-averia]').count()) === 0, '[Gerencia 390] consulta la posible avería sin «Atender» ni «Anular»')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('sup.prd.local@metalwork.test')
  await pagina.goto(`${BASE}/averias/${id}`, { waitUntil: 'networkidle' })
  const titulo = limpio(await pagina.locator('h1').first().innerText().catch(() => ''))
  comprobar(titulo !== NUMERO, `[Producción] no la ve por su dirección («${titulo}»)`)
  await contexto.close()
}

// La posible avería queda anulada: el banco no se llena de reportes vigentes.
await como(mantenimiento, `select * from public.averias_anular($1, 'Prueba del banco: la posible avería no hacía falta.')`, [idLeve])

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallan.`)
process.exit(fallas.length === 0 ? 0 : 1)
