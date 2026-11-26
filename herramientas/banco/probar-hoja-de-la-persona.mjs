/**
 * La hoja de cada persona en Recursos Humanos (plan 13, entrega 13.1), con la
 * cuenta de cada puesto y nunca con ADMIN:
 *
 *   1. RR. HH. abre la hoja de Juan (taller) desde Personal: en el mes ve sus
 *      tardanzas una por una, sus permisos, lo que se le observó y su parte de
 *      la planilla diaria, día por día; las cifras de arriba cuadran con la base;
 *      la ficha dice su cuenta, lo que gana y lo que cuesta. El filtro «Pagos»
 *      deja solo los pagos, y el mes anterior sale vacío.
 *   2. La hoja de Lucía (oficina) trae su pago de la oficina.
 *   3. Gerencia y Administración abren la misma hoja desde Tardanzas: ven las
 *      tardanzas, los permisos y las observaciones, sin pagos, sin «S/», sin
 *      cuenta, sin DNI y sin el costo.
 *   4. Almacén, que no consulta al personal, no entra.
 *
 * Las capturas salen en monitor (1440) y en teléfono (390), con datos de
 * prueba. Al terminar deja anulado lo numerado y a las personas de baja.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
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
  administracion: 'administracion.local@metalwork.test',
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
const juan = { id: crypto.randomUUID(), nombres: `Juan ${sello}`, apellidos: 'Prueba Hoja', dni: `7${sello}1` }
const lucia = { id: crypto.randomUUID(), nombres: `Lucía ${sello}`, apellidos: 'Prueba Hoja Oficina', dni: `7${sello}2` }
const CODIGO = `HOJA${sello}`

const [{ hoy, dia }] = await consulta(`select to_char((now() at time zone 'America/Lima')::date, 'YYYY-MM-DD') as hoy,
                                              extract(day from (now() at time zone 'America/Lima')::date)::int as dia`)
if (dia < 6) throw new Error('La prueba necesita cinco días pasados del mismo mes: córrela después del 5.')
const antes = (n) => {
  const d = new Date(`${hoy}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
const [d2, d3, d4, d5] = [antes(2), antes(3), antes(4), antes(5)]
const mes = hoy.slice(0, 7)
const [anio, mm] = mes.split('-').map(Number)
const mesPasado = mm === 1 ? `${anio - 1}-12` : `${anio}-${String(mm - 1).padStart(2, '0')}`

const [{ id: rrhhId }] = await consulta('select id from usuarios where correo = $1', [CUENTAS.rrhh])
const [{ id: mtz }] = await consulta(`select id from areas where codigo = 'MTZ'`)
const [{ id: con }] = await consulta(`select id from areas where codigo = 'CON'`)
let planillaDiaria = null
const reportes = []

await comoPuesto(
  CUENTAS.rrhh,
  `select public.rrhh_guardar_trabajador($1, $2, $3, $4, 'Soldador', $5, '08:00', '17:00', 'Banco de Pruebas', 'AHORROS', $6, null),
          public.rrhh_guardar_remuneracion_trabajador($1, 2400), public.rrhh_guardar_costo_trabajador($1, 3000),
          public.rrhh_guardar_regla_tardanza(5, 3, 5)`,
  [juan.id, juan.nombres, juan.apellidos, juan.dni, mtz, `191-0000${sello}`],
)
await comoPuesto(
  CUENTAS.rrhh,
  `select public.rrhh_guardar_trabajador($1, $2, $3, $4, 'Asistente contable', $5, '08:00', '17:00', 'Banco de Pruebas', 'AHORROS', $6, null),
          public.rrhh_guardar_remuneracion_trabajador($1, 3000), public.rrhh_guardar_planilla_trabajador($1, 'ADMINISTRATIVA'),
          public.rrhh_guardar_ingreso_trabajador($1, $7::date)`,
  [lucia.id, lucia.nombres, lucia.apellidos, lucia.dni, con, `191-1111${sello}`, `${mes}-01`],
)

// Supervisión: dos días de trabajo de Juan, que Gerencia y RR. HH. validan.
for (const [fecha, horas, descripcion] of [
  [d5, 8, 'Soldadura de la tolva'],
  [d4, 8, 'Armado del piso'],
]) {
  const [{ id }] = await comoPuesto(
    CUENTAS.supervisor,
    `select public.registrar_reporte_diario(gen_random_uuid(), $1::date, $2, 'Tolva de prueba', 'Trabajo del día (prueba del banco).', $3::jsonb, null, null) as id`,
    [fecha, CODIGO, JSON.stringify([{ descripcion, avance: 10, personal: [{ trabajador_id: juan.id, horas }] }])],
  )
  reportes.push(id)
  await comoPuesto(CUENTAS.gerencia, `select public.validar_reporte_diario($1, 'GERENCIA')`, [id])
  await comoPuesto(CUENTAS.rrhh, `select public.validar_reporte_diario($1, 'RRHH')`, [id])
}

// Portería: tres tardanzas de Juan (a mano: la portería solo marca hoy).
for (const [d, h, m] of [
  [d5, '08:20', 20],
  [d4, '08:12', 12],
  [d3, '08:35', 35],
]) {
  await consulta(
    `insert into asistencias (trabajador_id, fecha, tipo, hora, tardanza_minutos, es_tardanza, registrado_por)
     values ($1, $2, 'INGRESO', $3, $4, true, $5)`,
    [juan.id, d, h, m, rrhhId],
  )
}

// RR. HH.: un permiso que se descuenta, otro por justificar y una amonestación.
const permisoDescontado = crypto.randomUUID()
await comoPuesto(CUENTAS.rrhh, `select public.rrhh_registrar_permiso($1, $2, $3::date, 2, $4)`, [permisoDescontado, juan.id, d3, `Cita médica ${sello}`])
await comoPuesto(CUENTAS.rrhh, `select public.rrhh_registrar_permiso(gen_random_uuid(), $1, $2::date, 1, $3)`, [juan.id, d2, `Trámite en el banco ${sello}`])
await comoPuesto(CUENTAS.rrhh, `select public.rrhh_descontar_permiso(gen_random_uuid(), $1)`, [permisoDescontado])
await comoPuesto(
  CUENTAS.rrhh,
  `select public.rrhh_registrar_observacion(gen_random_uuid(), $1, $2::date, 'AMONESTACION_VERBAL', 'EPP', $3, $4, null)`,
  [juan.id, d4, `Trabajaba sin careta de soldar ${sello}.`, CODIGO],
)

// La planilla diaria con sus dos días y el pago de la oficina de Lucía.
;[{ id: planillaDiaria }] = await comoPuesto(CUENTAS.rrhh, `select public.enviar_planilla_diaria(gen_random_uuid()) as id`)
await comoPuesto(CUENTAS.rrhh, `select public.rrhh_registrar_pago_oficina(gen_random_uuid(), $1, $2::date, $3::date, 1500, 135, 'Primera quincena')`, [
  lucia.id,
  `${mes}-01`,
  `${mes}-15` < hoy ? `${mes}-15` : antes(1),
])

const [persona] = await consulta(
  `select pp.total::float as total, p.numero from planilla_diaria_personas pp join planillas_diarias p on p.id = pp.planilla_id
    where pp.trabajador_id = $1 and p.anulado_en is null`,
  [juan.id],
)
comprobar(Boolean(persona), `la planilla diaria lleva a Juan: ${JSON.stringify(persona)}`)

// ------------------------------------------------ el navegador
// Se lanza dentro del `try`: si no arranca, el `finally` igual deja anulado lo que se sembró.
let navegador = null

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
const cuenta = (pagina, parte) => pagina.locator(`[data-linea-de-tiempo] [data-suceso="${parte}"]`).count()

try {
  navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
  // ---------------------------------------------- 1. RR. HH., la hoja de Juan
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh, viewport)
    const ancho = viewport.width
    await pagina.goto(`${BASE}/rrhh/personal`, { waitUntil: 'networkidle' })
    await pagina.locator(`a[data-hoja="${juan.id}"]`).click()
    await pagina.waitForURL(new RegExp(`/rrhh/personal/${juan.id}`), { timeout: 20000 })
    await pagina.locator('[data-linea-de-tiempo]').waitFor({ timeout: 20000 })
    comprobar((await texto(pagina.locator('h1'))).includes(`Prueba Hoja, ${juan.nombres}`), `${ancho}: el nombre de Personal abre su hoja`)

    if (ancho === 1440) {
      comprobar((await cuenta(pagina, 'tardanzas')) === 3, '1440: las tres tardanzas, una por una')
      comprobar((await cuenta(pagina, 'permisos')) === 2, '1440: los dos permisos')
      comprobar((await cuenta(pagina, 'observaciones')) === 1, '1440: la amonestación')
      comprobar((await cuenta(pagina, 'pagos')) === 1, '1440: su parte de la planilla diaria')
      const cifras = await texto(pagina.locator('[data-cifras-hoja]'))
      comprobar(cifras.includes('Tardanzas 3') && cifras.includes('1 h 07 min'), `las cifras de tardanzas: «${cifras.slice(0, 160)}»`)
      comprobar(cifras.includes('se descuenta 5 % · S/ 120.00'), 'RR. HH. ve el descuento del mes en soles (5 % de S/ 2,400)')
      comprobar(cifras.includes('1 h por justificar'), 'los permisos dicen lo que falta justificar')
      // Tesorería todavía no la pagó: no es «Pagado», es «por pagar».
      const total = Number(persona.total).toLocaleString('en-US', { minimumFractionDigits: 2 })
      comprobar(cifras.includes('Pagado S/ 0.00') && cifras.includes(`S/ ${total} por pagar`), `lo que falta pagar no cuenta como pagado (${persona.total}): «${cifras.slice(-120)}»`)
      const pago = await texto(pagina.locator('[data-suceso="pagos"]'))
      comprobar(pago.includes(persona.numero) && pago.includes('Por pagar') && pago.includes('16 h'), `el renglón del pago: «${pago}»`)
      const permiso = await texto(pagina.locator('[data-suceso="permisos"]', { hasText: 'Cita médica' }))
      comprobar(permiso.includes('Descontado') && permiso.includes('2 h descontadas'), `el permiso descontado: «${permiso}»`)
      const ficha = await texto(pagina.locator('[data-ficha-hoja]'))
      comprobar(ficha.includes(juan.dni) && ficha.includes('Banco de Pruebas') && ficha.includes('S/ 2,400.00') && ficha.includes('S/ 3,000.00'), `la ficha de RR. HH.: «${ficha}»`)
      await pagina.screenshot({ path: `${CAPTURAS}/13-1-rrhh-1440-hoja.png`, fullPage: true })

      await pagina.locator('nav[aria-label="Qué mostrar"]').getByRole('link', { name: /^Pagos/ }).click()
      await pagina.waitForURL(/ver=pagos/, { timeout: 15000 })
      await pagina.locator('[data-linea-de-tiempo]').waitFor({ timeout: 15000 })
      comprobar((await pagina.locator('[data-linea-de-tiempo] [data-suceso]').count()) === 1 && (await cuenta(pagina, 'pagos')) === 1, 'el filtro «Pagos» deja solo los pagos')
      await pagina.getByRole('link', { name: 'Mes anterior' }).click()
      await pagina.waitForURL(new RegExp(`mes=${mesPasado}`), { timeout: 15000 })
      await pagina.locator('[data-mes-hoja]').filter({ hasText: '' }).first().waitFor()
      comprobar((await pagina.locator('[data-mes-hoja]').getAttribute('data-mes-hoja')) === mesPasado, 'la flecha lleva al mes anterior')
      comprobar((await texto(pagina.locator('[data-hoja-persona]'))).includes('Sin pagos este mes'), 'el mes anterior no tiene pagos')

      await pagina.goto(`${BASE}/rrhh/personal/${lucia.id}`, { waitUntil: 'networkidle' })
      const deLucia = await texto(pagina.locator('[data-suceso="pagos"]'))
      comprobar(deLucia.includes('Pago de la oficina') && deLucia.includes('S/ 1,500.00') && deLucia.includes('Primera quincena'), `el pago de Lucía: «${deLucia}»`)
    } else {
      const anchoPagina = await pagina.evaluate(() => document.documentElement.scrollWidth)
      comprobar(anchoPagina <= 390, `390: la hoja no se sale de la pantalla (${anchoPagina} px)`)
      await pagina.screenshot({ path: `${CAPTURAS}/13-1-rrhh-390-hoja.png`, fullPage: true })
    }
    comprobar(errores.length === 0, `${ancho}: sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
    await contexto.close()
  }

  // ---------------------------------------------- 3. Gerencia y Administración
  for (const [puesto, correo] of [
    ['gerencia', CUENTAS.gerencia],
    ['administracion', CUENTAS.administracion],
  ]) {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const { pagina, contexto, errores } = await entrar(correo, viewport)
      await pagina.goto(`${BASE}/rrhh/tardanzas?mes=${mes}`, { waitUntil: 'networkidle' })
      await pagina.locator(`tr[data-tardanzas="${juan.id}"] a`).click()
      await pagina.waitForURL(new RegExp(`/rrhh/personal/${juan.id}`), { timeout: 20000 })
      await pagina.locator('[data-linea-de-tiempo]').waitFor({ timeout: 20000 })
      const todo = await texto(pagina.locator('main'))
      if (viewport.width === 1440) {
        comprobar((await cuenta(pagina, 'tardanzas')) === 3 && (await cuenta(pagina, 'observaciones')) === 1, `${puesto}: ve las tardanzas y la amonestación`)
        comprobar((await cuenta(pagina, 'permisos')) === 2, `${puesto}: ve los permisos`)
        comprobar((await cuenta(pagina, 'pagos')) === 0, `${puesto}: no ve pagos`)
        comprobar(!todo.includes('S/'), `${puesto}: ni un «S/» en la hoja`)
        comprobar(!todo.includes(juan.dni) && !todo.includes('Banco de Pruebas') && !todo.includes('191-0000'), `${puesto}: sin DNI ni cuenta`)
        comprobar(!todo.includes('Cuesta') && !todo.includes('Gana al mes'), `${puesto}: sin lo que gana ni lo que cuesta`)
        comprobar(todo.includes('se descuenta 5 % de su remuneración'), `${puesto}: el descuento en porcentaje`)
        await pagina.screenshot({ path: `${CAPTURAS}/13-1-${puesto}-1440-hoja.png`, fullPage: true })
      } else {
        comprobar(!todo.includes('S/'), `${puesto} 390: ni un «S/»`)
        await pagina.screenshot({ path: `${CAPTURAS}/13-1-${puesto}-390-hoja.png`, fullPage: true })
      }
      comprobar(errores.length === 0, `${puesto} ${viewport.width}: sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
      await contexto.close()
    }
  }

  // ---------------------------------------------- 4. Almacén no entra
  {
    const { pagina, contexto } = await entrar(CUENTAS.almacen, { width: 1440, height: 900 })
    await pagina.goto(`${BASE}/rrhh/personal/${juan.id}`, { waitUntil: 'networkidle' })
    comprobar(pagina.url().includes('/sin-permiso') || (await pagina.locator('[data-hoja-persona]').count()) === 0, `almacén no abre la hoja (${pagina.url()})`)
    await contexto.close()
  }
} catch (e) {
  fallas.push(`la prueba se cortó: ${e?.message ?? e}`)
} finally {
  await navegador?.close()
  if (planillaDiaria) {
    await comoPuesto(CUENTAS.rrhh, `select public.anular_planilla_diaria($1, 'Prueba del banco: se deja anulada al terminar')`, [planillaDiaria]).catch((e) =>
      fallas.push(`no se pudo anular la planilla diaria: ${e}`),
    )
  }
  for (const p of await consulta(`select id from oficina_pagos where trabajador_id = $1 and anulado_en is null`, [lucia.id])) {
    await comoPuesto(CUENTAS.rrhh, `select public.rrhh_anular_pago_oficina($1, 'Prueba del banco')`, [p.id]).catch((e) => fallas.push(`no se pudo deshacer lo sembrado: ${e?.message ?? e}`))
  }
  for (const p of await consulta(`select id from permisos_personal where trabajador_id = $1 and anulado_en is null`, [juan.id])) {
    await comoPuesto(CUENTAS.rrhh, `select public.rrhh_anular_permiso($1, 'Prueba del banco')`, [p.id]).catch((e) => fallas.push(`no se pudo deshacer lo sembrado: ${e?.message ?? e}`))
  }
  for (const a of await consulta(`select id from asistencias where trabajador_id = $1 and anulado_en is null`, [juan.id])) {
    await comoPuesto(CUENTAS.rrhh, `select public.anular_asistencia($1, 'Prueba del banco')`, [a.id]).catch((e) => fallas.push(`no se pudo deshacer lo sembrado: ${e?.message ?? e}`))
  }
  // Los reportes validados también: si no, la planilla diaria siguiente del banco se lleva a Juan.
  for (const id of reportes) {
    await comoPuesto(CUENTAS.rrhh, `select public.anular_reporte_diario($1, 'Prueba del banco: se deja anulado al terminar')`, [id]).catch((e) =>
      fallas.push(`no se pudo anular el reporte: ${e?.message ?? e}`),
    )
  }
  for (const t of [juan, lucia]) {
    await comoPuesto(CUENTAS.rrhh, `select public.rrhh_dar_de_baja_trabajador($1, $2::date)`, [t.id, hoy]).catch((e) => fallas.push(`no se pudo deshacer lo sembrado: ${e?.message ?? e}`))
  }
  await base.end()
}

console.log(fallas.length ? `\n${fallas.length} fallas:\n- ${fallas.join('\n- ')}` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
