// Plan 13, entrega 13.2: en Costeo por código interno cada importe abre las
// cargas que lo formaron, con su reporte diario; en Reporte diario, los que
// esperan el visto de RR. HH. dicen hace cuántos días.
//
//   BANCO_CLAVE=… BASE=http://localhost:3112 node herramientas/banco/probar-costeo-y-espera-rrhh.mjs
//
// Siembra con las cuentas de cada puesto (supervisor, Gerencia y RR. HH.): una
// persona con costo, tres reportes de un código (uno con los dos vistos, uno con
// el de Gerencia y uno sin ninguno) y una carga a mano de RR. HH. Mira como
// RR. HH. en 1440 y 390, y como Gerencia (que ve el reporte, no el costeo). Al
// terminar anula lo sembrado y da de baja a la persona.

import { mkdirSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  rrhh: 'rrhh.local@metalwork.test',
  supervisor: 'sup.mtz.local@metalwork.test',
  gerencia: 'gerencia.local@metalwork.test',
  almacen: 'almacen.local@metalwork.test',
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
const soles = (n) => `S/ ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function comoPuesto(correo, sql, valores = []) {
  await base.query('begin')
  try {
    const [{ id }] = await consulta('select id from usuarios where correo = $1', [correo])
    await base.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [
      JSON.stringify({ sub: id, role: 'authenticated' }),
      id,
    ])
    await base.query('set local role authenticated')
    const filas = (await base.query(sql, valores)).rows
    await base.query('commit')
    return filas
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

// ------------------------------------------------ los datos de la prueba
const sello = Date.now().toString().slice(-6)
const pedro = { id: crypto.randomUUID(), nombres: `Pedro ${sello}`, apellidos: 'Prueba Costeo', dni: `8${sello}1` }
const CODIGO = `COS${sello}`

const [{ hoy, dia }] = await consulta(`select to_char((now() at time zone 'America/Lima')::date, 'YYYY-MM-DD') as hoy,
                                              extract(day from (now() at time zone 'America/Lima')::date)::int as dia`)
if (dia < 6) throw new Error('La prueba necesita cinco días pasados del mismo mes: córrela después del 5.')
const antes = (n) => {
  const d = new Date(`${hoy}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
const mes = hoy.slice(0, 7)
const [{ id: mtz }] = await consulta(`select id from areas where codigo = 'MTZ'`)

const reportes = {}
const tareoAMano = crypto.randomUUID()

let navegador = null
try {
  // La hora de Pedro vale S/ 10.00 (2 400 entre 240).
  await comoPuesto(
    CUENTAS.rrhh,
    `select public.rrhh_guardar_trabajador($1, $2, $3, $4, 'Armador', $5, '08:00', '17:00', 'Banco de Pruebas', 'AHORROS', $6, null),
            public.rrhh_guardar_costo_trabajador($1, 2400)`,
    [pedro.id, pedro.nombres, pedro.apellidos, pedro.dni, mtz, `191-2222${sello}`],
  )
  // El supervisor reporta tres días; Gerencia y RR. HH. dan su visto a uno, Gerencia a otro, nadie al tercero.
  for (const [clave, fecha, horas, descripcion] of [
    ['validado', antes(5), 8, 'Armado del chasis'],
    ['faltaRrhh', antes(4), 4, 'Forrado de la tolva'],
    ['faltanDos', antes(3), 2, 'Pintura de base'],
  ]) {
    const [{ id }] = await comoPuesto(
      CUENTAS.supervisor,
      `select public.registrar_reporte_diario(gen_random_uuid(), $1::date, $2, $3, 'Trabajo del día (prueba del banco).', $4::jsonb, null, null) as id`,
      [fecha, CODIGO, `Costeo ${clave} ${sello}`, JSON.stringify([{ descripcion, avance: 10, personal: [{ trabajador_id: pedro.id, horas }] }])],
    )
    reportes[clave] = id
  }
  await comoPuesto(CUENTAS.gerencia, `select public.validar_reporte_diario($1, 'GERENCIA')`, [reportes.validado])
  await comoPuesto(CUENTAS.rrhh, `select public.validar_reporte_diario($1, 'RRHH')`, [reportes.validado])
  await comoPuesto(CUENTAS.gerencia, `select public.validar_reporte_diario($1, 'GERENCIA')`, [reportes.faltaRrhh])
  // El que espera a RR. HH. llegó hace tres días (la fecha de creación se corre a mano: no hay otra forma de envejecerlo).
  await base.query('begin')
  await base.query(`set local session_replication_role = replica`)
  await base.query(`update reportes_diarios set creado_en = now() - interval '3 days' where id = $1`, [reportes.faltaRrhh])
  await base.query('commit')
  // Y una carga a mano de RR. HH., sin reporte.
  await comoPuesto(CUENTAS.rrhh, `select public.rrhh_registrar_tareo($1, $2, $3::date, $4, 3, 'Ajuste de puertas')`, [tareoAMano, pedro.id, antes(2), CODIGO])

  const cargas = await consulta(`select horas::float, costo::float from tareos where codigo_interno = $1 and anulado_en is null`, [CODIGO])
  const total = cargas.reduce((n, c) => n + c.costo, 0)
  comprobar(cargas.length === 4 && total === 170, `las cuatro cargas del código suman S/ 170.00 (8 + 4 + 2 + 3 horas a S/ 10): ${cargas.length} · ${total}`)

  // ---------------------------------------------- el navegador
  navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
  async function entrar(correo, viewport) {
    const contexto = await navegador.newContext({ viewport, deviceScaleFactor: 2, ...(viewport.width < 500 ? { isMobile: true, hasTouch: true } : {}) })
    const pagina = await contexto.newPage()
    const errores = []
    pagina.on('console', (m) => {
      if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
    })
    await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
    await pagina.fill('input[type="email"]', correo)
    await pagina.fill('input[type="password"]', CLAVE)
    await Promise.all([pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}), pagina.click('button[type="submit"]')])
    if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
    return { pagina, contexto, errores }
  }
  const texto = async (l) => limpio(await l.first().innerText({ timeout: 5000 }).catch(() => ''))

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const ancho = viewport.width
    const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh, viewport)

    // 1. Costeo: el importe del código abre sus cuatro cargas.
    await pagina.goto(`${BASE}/rrhh/costeo?mes=${mes}`, { waitUntil: 'networkidle' })
    const fila = pagina.locator('details', { hasText: CODIGO }).first()
    await fila.locator('summary').click()
    await pagina.locator(`a[data-importe-codigo="${CODIGO}"]`).click()
    await pagina.waitForURL(/codigo=/, { timeout: 20000 })
    await pagina.locator('#dia').waitFor({ timeout: 20000 })
    const cabecera = await texto(pagina.locator('#dia'))
    comprobar(cabecera.includes(`De dónde sale la mano de obra de ${CODIGO}`), `${ancho}: el importe del código abre sus cargas`)
    comprobar(cabecera.includes(`${soles(total)} · 17 h en 4 cargas · 3 reportes diarios`), `${ancho}: la cabecera suma lo mismo que el importe: «${cabecera.slice(0, 200)}»`)
    comprobar((await pagina.locator('#dia [data-reporte-de-la-carga]').count()) === 3, `${ancho}: tres cargas llevan a su reporte diario`)
    comprobar(cabecera.includes('Cargada a mano por RR. HH.'), `${ancho}: la de RR. HH. dice que se cargó a mano`)
    await pagina.locator('#dia').screenshot({ path: `${CAPTURAS}/13-2-costeo-cargas-del-codigo-rrhh-${ancho}.png` })
    await pagina.screenshot({ path: `${CAPTURAS}/13-2-costeo-rrhh-${ancho}.png`, fullPage: true })

    // La carga lleva a su reporte.
    await pagina.locator(`#dia a[data-reporte-de-la-carga="${reportes.faltaRrhh}"]`).click()
    await pagina.waitForURL(new RegExp(`/reportes-diarios/${reportes.faltaRrhh}`), { timeout: 20000 })
    await pagina.waitForLoadState('networkidle')
    await pagina.locator('h1').first().waitFor({ timeout: 30000 })
    const delReporte = await texto(pagina.locator('main'))
    comprobar(delReporte.includes(`Costeo faltaRrhh ${sello}`), `${ancho}: la carga abre su reporte diario: «${delReporte.slice(0, 160)}»`)

    // El importe de la persona abre solo sus cargas en ese código.
    await pagina.goto(`${BASE}/rrhh/costeo?mes=${mes}`, { waitUntil: 'networkidle' })
    await pagina.locator('details', { hasText: CODIGO }).first().locator('summary').click()
    const bajoElImporte = await texto(pagina.locator(`a[data-importe-persona="${pedro.id}"]`).first().locator('xpath=following-sibling::p[1]'))
    comprobar(bajoElImporte === '3 reportes y 1 a mano', `${ancho}: bajo el importe de la persona se cuentan también las cargas a mano: «${bajoElImporte}»`)
    await pagina.locator(`a[data-importe-persona="${pedro.id}"]`).first().click()
    await pagina.waitForURL(/persona=/, { timeout: 20000 })
    const dePedro = await texto(pagina.locator('#dia'))
    comprobar(dePedro.includes(`${CODIGO} · ${pedro.apellidos}, ${pedro.nombres}`), `${ancho}: el importe de la persona abre sus cargas: «${dePedro.slice(0, 160)}» ${pagina.url()}`)
    if (ancho === 390) {
      const alto = (await pagina.locator('[data-quitar-importe]').boundingBox())?.height ?? 0
      comprobar(alto >= 44, `390: «Volver a los días» mide ${alto} px de alto (44 para el dedo)`)
    }
    await pagina.locator('[data-quitar-importe]').click()
    await pagina.waitForURL((u) => !u.search.includes('codigo='), { timeout: 20000 })
    comprobar(!(await texto(pagina.locator('#dia'))).includes('De dónde sale'), `${ancho}: «Volver a los días» vuelve al detalle por día`)

    // 2. Reporte diario: lo que espera a RR. HH. dice desde cuándo.
    await pagina.goto(`${BASE}/reportes-diarios?mes=${mes}`, { waitUntil: 'networkidle' })
    const espera = pagina.locator(`[data-reporte="${reportes.faltaRrhh}"] [data-dias-en-espera]`)
    comprobar((await espera.getAttribute('data-dias-en-espera').catch(() => null)) === '3', `${ancho}: el reporte que espera a RR. HH. lleva 3 días`)
    comprobar((await texto(espera)).startsWith('hace 3 días'), `${ancho}: la insignia dice solo el tiempo: «${await texto(espera)}»`)
    const renglon = await texto(espera.locator('xpath=..'))
    comprobar(renglon.startsWith('Falta Recursos Humanos') && renglon.includes('hace 3 días'), `${ancho}: lo que falta y desde cuándo van en un renglón: «${renglon}»`)
    const deLosDos = await texto(pagina.locator(`[data-reporte="${reportes.faltanDos}"] [data-dias-en-espera]`).locator('xpath=..'))
    comprobar(deLosDos.startsWith('Faltan Gerencia y Recursos Humanos'), `${ancho}: el que espera a los dos no nombra solo a RR. HH.: «${deLosDos}»`)
    comprobar((await pagina.locator(`[data-reporte="${reportes.faltanDos}"] [data-dias-en-espera]`).count()) === 1, `${ancho}: el que espera a los dos también`)
    comprobar((await pagina.locator(`[data-reporte="${reportes.validado}"] [data-dias-en-espera]`).count()) === 0, `${ancho}: el validado no espera`)
    await pagina.locator(`[data-reporte="${reportes.faltaRrhh}"]`).scrollIntoViewIfNeeded()
    await pagina.screenshot({ path: `${CAPTURAS}/13-2-reportes-diarios-rrhh-${ancho}.png` })
    comprobar(errores.length === 0, `${ancho}: sin errores en la consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
    await contexto.close()
  }

  // 3. Gerencia: ve que el reporte lo tiene RR. HH.; el costeo no es suyo.
  {
    const { pagina, contexto } = await entrar(CUENTAS.gerencia, { width: 1440, height: 900 })
    await pagina.goto(`${BASE}/reportes-diarios?mes=${mes}`, { waitUntil: 'networkidle' })
    const espera = await texto(pagina.locator(`[data-reporte="${reportes.faltaRrhh}"] [data-dias-en-espera]`).locator('xpath=..'))
    comprobar(espera.startsWith('Falta Recursos Humanos') && espera.includes('hace 3 días'), `Gerencia lee en un renglón que falta RR. HH. y desde cuándo: «${espera}»`)
    await pagina.locator(`[data-reporte="${reportes.faltaRrhh}"]`).scrollIntoViewIfNeeded()
    await pagina.screenshot({ path: `${CAPTURAS}/13-2-reportes-diarios-gerencia-1440.png` })
    await pagina.goto(`${BASE}/rrhh/costeo?mes=${mes}`, { waitUntil: 'networkidle' })
    comprobar(pagina.url().includes('/sin-permiso') || (await pagina.locator('[data-importe-codigo]').count()) === 0, `Gerencia no abre el costeo (${pagina.url()})`)
    await contexto.close()
  }
  // 4. Almacén no abre el costeo.
  {
    const { pagina, contexto } = await entrar(CUENTAS.almacen, { width: 1440, height: 900 })
    await pagina.goto(`${BASE}/rrhh/costeo?mes=${mes}&codigo=${CODIGO}`, { waitUntil: 'networkidle' })
    comprobar(pagina.url().includes('/sin-permiso') || (await pagina.locator('[data-importe-codigo]').count()) === 0, `Almacén no abre el costeo (${pagina.url()})`)
    await contexto.close()
  }
} catch (e) {
  fallas.push(`la prueba se cortó: ${e?.message ?? e}`)
  console.error(e)
} finally {
  await navegador?.close()
  const deshacer = (e) => fallas.push(`no se pudo deshacer lo sembrado: ${e?.message ?? e}`)
  // El supervisor anula el suyo mientras no esté validado; el validado lo anula RR. HH.
  for (const [clave, id] of Object.entries(reportes)) {
    const quien = clave === 'validado' ? CUENTAS.rrhh : CUENTAS.supervisor
    await comoPuesto(quien, `select public.anular_reporte_diario($1, 'Prueba del banco: se deja anulado al terminar')`, [id]).catch(deshacer)
  }
  for (const t of await consulta(`select id from tareos where codigo_interno = $1 and anulado_en is null`, [CODIGO])) {
    await comoPuesto(CUENTAS.rrhh, `select public.rrhh_anular_tareo($1, 'Prueba del banco: se deja anulada al terminar')`, [t.id]).catch(deshacer)
  }
  if ((await consulta('select 1 from trabajadores where id = $1', [pedro.id])).length > 0) {
    await comoPuesto(CUENTAS.rrhh, `select public.rrhh_dar_de_baja_trabajador($1, $2::date)`, [pedro.id, hoy]).catch(deshacer)
  }
  await base.end()
}

console.log(fallas.length ? `\n${fallas.length} fallas:\n- ${fallas.join('\n- ')}` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
