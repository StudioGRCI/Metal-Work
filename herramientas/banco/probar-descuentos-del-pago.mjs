/**
 * Recorre con clic real lo que las tardanzas y los permisos restan del pago, y
 * el ajuste de la planilla del mes (migraciones 20261026200000 y
 * 20261026210000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. RR. HH., en Permisos: el permiso justificado muestra lo que marcó en
 *      portería y las horas del reporte. Descuenta el permiso de Juan (taller) y
 *      el de Lucía (oficina), y reporta otro de Lucía como amonestación verbal:
 *      queda en sus observaciones y el permiso dice «Reportado».
 *   2. En Tardanzas, lo que falta restar: S/ 120 a Juan (5 % de S/ 2 400) y
 *      S/ 150 a Lucía (5 % de S/ 3 000).
 *   3. En la planilla diaria por enviar, Juan lleva el permiso justificado que
 *      se paga y las dos líneas que se le restan; lo que dice «A pagar» es lo
 *      que guarda la base al enviarla. Tesorería ve en la planilla lo restado.
 *   4. En Pagos de la oficina, el pago de Lucía muestra antes de registrarlo lo
 *      que se le resta y cuánto se le paga, y la base guarda eso mismo.
 *   5. Tardanzas dice ahora dónde se restó; Costeo por código muestra el recargo
 *      de la hora extra pagada en el código que se trabajó.
 *   6. Planillas: el ajuste empieza en noviembre de 2026 (migración
 *      20261026230000). Antes de esa fecha, la de este mes dice que queda como
 *      registro y el globo no cuenta la del mes pasado. Después la prueba mueve
 *      el inicio al mes pasado (lo restaura al terminar): el globo cuenta la
 *      planilla de taller del mes pasado que sigue en preparación; en la de este
 *      mes, Juan agregado a mano por su DNI dice sus horas y su ajuste; alguien
 *      sin ficha lo dice; al cerrarla, Gerencia ve el ajuste en la mano de obra
 *      del código.
 *
 * Necesita las cuentas `*.local@metalwork.test` de RR. HH., Supervisión de
 * Maestranza, Gerencia y Tesorería. Las personas, sus reportes, marcas y
 * permisos los crea el script, distintos en cada corrida (las planillas del mes
 * de taller, una por mes, se borran al terminar). Al final, aunque algo falle,
 * deja anulados la planilla diaria y el pago, y a las personas de baja.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  rrhh: process.env.RRHH ?? 'rrhh.local@metalwork.test',
  supervisor: process.env.SUPERVISOR ?? 'sup.mtz.local@metalwork.test',
  gerencia: process.env.GERENCIA ?? 'gerencia.local@metalwork.test',
  tesoreria: process.env.TESORERIA ?? 'tesoreria.local@metalwork.test',
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
const dd = (f) => f.split('-').reverse().join('/')
const soles = (n) => `S/ ${Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Una función de la base con la sesión de un puesto, como la llama la pantalla. */
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
const juan = { id: crypto.randomUUID(), nombres: `Juan ${sello}`, apellidos: 'Prueba Descuento', dni: `6${sello}1` }
const lucia = { id: crypto.randomUUID(), nombres: `Lucía ${sello}`, apellidos: 'Prueba Oficina', dni: `6${sello}2` }
const nombre = (p) => `${p.nombres} ${p.apellidos}`
const CODIGO_A = `DSC${sello}_A`
const CODIGO_B = `DSC${sello}_B`
const permiso = { p1: crypto.randomUUID(), p2: crypto.randomUUID(), p3: crypto.randomUUID(), p4: crypto.randomUUID() }

const [{ hoy, dia }] = await consulta(`select to_char((now() at time zone 'America/Lima')::date, 'YYYY-MM-DD') as hoy,
                                              extract(day from (now() at time zone 'America/Lima')::date)::int as dia`)
// Cuatro días seguidos del mismo mes, ya pasados (como el check 445).
const desde = dia >= 7 ? hoy : `${hoy.slice(0, 7)}-01`
const antes = (n) => {
  const d = new Date(`${desde}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}
const [d2, d3, d4, d5] = [antes(2), antes(3), antes(4), antes(5)]
const mes = d2.slice(0, 7)
const [anio, mm] = mes.split('-').map(Number)
const mesPasado = mm === 1 ? `${anio - 1}-12` : `${anio}-${String(mm - 1).padStart(2, '0')}`
if (d5 < '2026-10-01') throw new Error('Los días de la prueba caen antes de octubre de 2026: los descuentos todavía no se restan.')

const [{ id: rrhhId }] = await consulta('select id from usuarios where correo = $1', [CUENTAS.rrhh])
const [{ id: mtz }] = await consulta(`select id from areas where codigo = 'MTZ'`)
const [{ id: con }] = await consulta(`select id from areas where codigo = 'CON'`)

// Las planillas del mes de taller son una por mes: si la del banco ya existe, no se toca.
const [yaEste] = await consulta(`select id from planillas where tipo = 'TALLER' and periodo = $1::date`, [`${mes}-01`])
const [yaPasado] = await consulta(`select id from planillas where tipo = 'TALLER' and periodo = $1::date`, [`${mesPasado}-01`])
if (yaEste) throw new Error(`El banco ya tiene la planilla de taller de ${mes}: bórrala o espera al mes siguiente.`)
const planillaEste = crypto.randomUUID()
const planillaPasado = yaPasado ? null : crypto.randomUUID()
let planillaDiaria = null
// La definición de `planilla_ajuste_desde()` antes de moverla, para restaurarla al terminar.
let ajusteOriginal = null

// RR. HH.: Juan de taller (la hora a S/ 10) y Lucía de la oficina (la hora a S/ 12,50).
await comoPuesto(
  CUENTAS.rrhh,
  `select public.rrhh_guardar_trabajador($1, $2, $3, $4, 'Soldador', $5, '08:00', '17:00', 'Banco de Pruebas', 'AHORROS', $6, null),
          public.rrhh_guardar_remuneracion_trabajador($1, 2400), public.rrhh_guardar_costo_trabajador($1, 2400),
          public.rrhh_guardar_regla_tardanza(5, 3, 5)`,
  [juan.id, juan.nombres, juan.apellidos, juan.dni, mtz, `191-${juan.dni}`],
)
await comoPuesto(
  CUENTAS.rrhh,
  `select public.rrhh_guardar_trabajador($1, $2, $3, $4, 'Asistente contable', $5, '08:00', '17:00', 'Banco de Pruebas', 'AHORROS', $6, null),
          public.rrhh_guardar_remuneracion_trabajador($1, 3000), public.rrhh_guardar_planilla_trabajador($1, 'ADMINISTRATIVA'),
          public.rrhh_guardar_ingreso_trabajador($1, $7::date)`,
  [lucia.id, lucia.nombres, lucia.apellidos, lucia.dni, con, `191-${lucia.dni}`, `${mes}-01`],
)

// Supervisión: d5 9 h en A (1 extra, se paga); d4 8 h en A y 2 en B (2 extras, se
// reservan); d3 6 h en A (y 2 h de permiso); d2 8 h en B (y 2 h de permiso que el
// supervisor también puso).
const reportes = []
for (const [fecha, codigo, unidad, descripcion, horas] of [
  [d5, CODIGO_A, 'Tolva de la unidad A', 'Soldadura', 9],
  [d4, CODIGO_A, 'Tolva de la unidad A', 'Soldadura de refuerzos', 8],
  [d4, CODIGO_B, 'Bastidor de la unidad B', 'Armado', 2],
  [d3, CODIGO_A, 'Tolva de la unidad A', 'Armado de la tolva', 6],
  [d2, CODIGO_B, 'Bastidor de la unidad B', 'Montaje del piso', 8],
]) {
  const [{ id }] = await comoPuesto(
    CUENTAS.supervisor,
    `select public.registrar_reporte_diario(gen_random_uuid(), $1::date, $2, $3, 'Trabajo del día (prueba del banco).', $4::jsonb, null, null) as id`,
    [fecha, codigo, unidad, JSON.stringify([{ descripcion, avance: 10, personal: [{ trabajador_id: juan.id, horas }] }])],
  )
  reportes.push(id)
}
for (const r of reportes) {
  await comoPuesto(CUENTAS.gerencia, `select public.validar_reporte_diario($1, 'GERENCIA')`, [r])
  await comoPuesto(CUENTAS.rrhh, `select public.validar_reporte_diario($1, 'RRHH')`, [r])
}

// Portería: tres tardanzas de cada uno (se cargan a mano: la portería solo marca hoy).
for (const d of [d5, d4, d3]) {
  await consulta(
    `insert into asistencias (trabajador_id, fecha, tipo, hora, tardanza_minutos, es_tardanza, registrado_por)
     values ($1, $3, 'INGRESO', '08:20', 20, true, $4), ($2, $3, 'INGRESO', '08:15', 15, true, $4)`,
    [juan.id, lucia.id, d, rrhhId],
  )
}
await consulta(
  `insert into asistencias (trabajador_id, fecha, tipo, hora, tardanza_minutos, es_tardanza, registrado_por)
   values ($1, $2, 'SALIDA', '15:05', 0, false, $3)`,
  [juan.id, d3, rrhhId],
)

// RR. HH.: las extras y los cuatro permisos; el de Juan del d3 se justifica con lo reservado.
await comoPuesto(
  CUENTAS.rrhh,
  `select public.rrhh_decidir_horas_extras(gen_random_uuid(), $1, $2::date, 'PAGAR'),
          public.rrhh_decidir_horas_extras(gen_random_uuid(), $1, $3::date, 'RESERVAR')`,
  [juan.id, d5, d4],
)
for (const [id, quien, fecha, horas, motivo] of [
  [permiso.p1, juan, d3, 2, `Cita médica en EsSalud ${sello}`],
  [permiso.p2, juan, d2, 2, `Trámite en el banco ${sello}`],
  [permiso.p3, lucia, d3, 4, `Asunto familiar ${sello}`],
  [permiso.p4, lucia, d2, 1, `Salió antes sin avisar ${sello}`],
]) {
  await comoPuesto(CUENTAS.rrhh, `select public.rrhh_registrar_permiso($1, $2, $3::date, $4, $5)`, [id, quien.id, fecha, horas, motivo])
}
await comoPuesto(CUENTAS.rrhh, `select public.rrhh_justificar_permiso(gen_random_uuid(), $1, null)`, [permiso.p1])

// ------------------------------------------------ el navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto, errores }
}

/** Espera a que la ventana se cierre o diga su error, y devuelve el error. */
async function esperarVentana(pagina) {
  const v = pagina.locator('[role="dialog"]')
  await Promise.race([
    v.waitFor({ state: 'hidden', timeout: 30000 }),
    v.locator('[role="alert"]').waitFor({ timeout: 30000 }),
  ]).catch(() => {})
  return limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
}
/** Espera a que la pantalla se repinte con el texto esperado: la acción vuelve antes que el refresco. */
const esperar = (localizador, conTexto) => localizador.filter({ hasText: conTexto }).first().waitFor({ timeout: 15000 }).catch(() => {})
const texto = async (localizador) => limpio(await localizador.first().textContent({ timeout: 5000 }).catch(() => ''))
/** La tarjeta de una planilla del mes, por su título. */
const tarjetaPlanilla = (pagina, periodo) =>
  pagina
    .locator('h2', { hasText: `Planilla de taller · ${periodo.slice(5, 7)}/${periodo.slice(0, 4)}` })
    .locator('xpath=ancestor::div[contains(@class, "shadow-")][1]')
const globoPlanillas = async (pagina) =>
  (await pagina.locator('aside nav[aria-label="Menú principal"] a[href="/rrhh"]').getAttribute('aria-label').catch(() => null)) ?? ''
/** Lo que el globo de Planillas tiene que decir: las de taller de un mes pasado, en preparación, desde que empieza el ajuste. */
async function globoEsperado() {
  const [{ n }] = await consulta(
    `select count(*)::int as n from planillas where tipo = 'TALLER' and moneda = 'PEN' and estado = 'BORRADOR'
        and periodo >= public.planilla_ajuste_desde() and periodo < date_trunc('month', (now() at time zone 'America/Lima')::date)`,
  )
  return { n, texto: n > 0 ? `Planillas, ${n} ${n === 1 ? 'pendiente' : 'pendientes'}` : '' }
}

try {
  const rrhh = await entrar(CUENTAS.rrhh)
  const { pagina } = rrhh

  // ---------------------------------------------- 1. Permisos: descontar y reportar
  {
    await pagina.goto(`${BASE}/rrhh/permisos?mes=${mes}`, { waitUntil: 'networkidle' })
    const justificado = pagina.locator(`li[data-registro-permiso="${nombre(juan)}"]`, { hasText: dd(d3) })
    const porteria = await texto(justificado.locator('[data-porteria]'))
    comprobar(
      porteria.includes('entró 08:20') && porteria.includes('salió 15:05') && porteria.includes('6 h en el reporte'),
      `el permiso justificado dice lo de portería y el reporte: «${porteria}»`,
    )
    comprobar((await pagina.locator(`[data-descontar="${permiso.p1}"]`).count()) === 0, 'lo justificado no se ofrece para descontar')

    async function descontar(id) {
      await pagina.locator(`[data-descontar="${id}"]`).click()
      const v = pagina.locator('[role="dialog"]')
      const descripcion = await texto(v)
      await v.getByRole('button', { name: 'Descontar', exact: true }).click()
      return { error: await esperarVentana(pagina), descripcion }
    }
    const conJuan = await descontar(permiso.p2)
    comprobar(conJuan.error === '', `descontar el permiso de Juan no dio error${conJuan.error ? `: ${conJuan.error}` : ''}`)
    comprobar(conJuan.descripcion.includes('la próxima planilla diaria'), `la ventana de taller dice que se resta en la planilla diaria: «${conJuan.descripcion.slice(0, 200)}»`)
    const conLucia = await descontar(permiso.p3)
    comprobar(conLucia.error === '', `descontar el permiso de Lucía no dio error${conLucia.error ? `: ${conLucia.error}` : ''}`)
    comprobar(conLucia.descripcion.includes('su próximo pago'), `la ventana de la oficina dice que se resta en su próximo pago: «${conLucia.descripcion.slice(0, 200)}»`)
    const descontados = await consulta(
      `select permiso_id, horas::float as horas from permisos_descontados where permiso_id = any($1::uuid[]) and anulado_en is null`,
      [[permiso.p2, permiso.p3]],
    )
    comprobar(
      descontados.length === 2 && descontados.find((d) => d.permiso_id === permiso.p2)?.horas === 2 && descontados.find((d) => d.permiso_id === permiso.p3)?.horas === 4,
      `la base anota los dos descuentos con sus horas: ${JSON.stringify(descontados)}`,
    )

    await pagina.locator(`[data-reportar="${permiso.p4}"]`).click()
    const v = pagina.locator('[role="dialog"]')
    await v.locator('select[name="tipo"]').selectOption('AMONESTACION_VERBAL')
    await v.locator('textarea[name="nota"]').fill('Se le explicó la regla de permisos.')
    await v.getByRole('button', { name: 'Reportar', exact: true }).click()
    const errorReporte = await esperarVentana(pagina)
    comprobar(errorReporte === '', `reportar el permiso no dio error${errorReporte ? `: ${errorReporte}` : ''}`)
    const [obs] = await consulta(`select tipo, motivo, detalle from observaciones_personal where permiso_id = $1`, [permiso.p4])
    comprobar(
      obs?.tipo === 'AMONESTACION_VERBAL' && obs?.motivo === 'PERMISO_SIN_JUSTIFICAR' && obs?.detalle.includes('Se le explicó la regla de permisos.'),
      `queda en sus observaciones como amonestación verbal por permiso sin justificar: ${JSON.stringify(obs)}`,
    )
    const filaReportada = pagina.locator(`[data-por-justificar] tr[data-permiso="${nombre(lucia)}"]`)
    await esperar(filaReportada, 'Reportado')
    comprobar(
      (await filaReportada.filter({ hasText: 'Reportado' }).count()) === 1 && (await pagina.locator(`[data-reportar="${permiso.p4}"]`).count()) === 0,
      'el permiso reportado sigue por justificar, dice «Reportado» y ya no ofrece reportarlo otra vez',
    )
    const registroJuan = pagina.locator(`li[data-registro-permiso="${nombre(juan)}"]`, { hasText: dd(d2) })
    await esperar(registroJuan, 'Descontado')
    const lineaJuan = await texto(registroJuan)
    comprobar(lineaJuan.includes('Descontado') && lineaJuan.includes('8 h en el reporte'), `el registro del permiso descontado de Juan: «${lineaJuan.slice(0, 220)}»`)
    await pagina.screenshot({ path: `${CAPTURAS}/descuentos-permisos.png`, fullPage: true })
  }

  // ---------------------------------------------- 2. Tardanzas: lo que falta restar
  {
    await pagina.goto(`${BASE}/rrhh/tardanzas?mes=${mes}`, { waitUntil: 'networkidle' })
    const deJuan = await texto(pagina.locator(`tr[data-tardanzas="${juan.id}"] [data-restado]`))
    comprobar(deJuan.includes(`Por restar ${soles(120)}`), `Juan: «${deJuan}»`)
    const deLucia = await texto(pagina.locator(`tr[data-tardanzas="${lucia.id}"] [data-restado]`))
    comprobar(deLucia.includes(`Por restar ${soles(150)}`), `Lucía: «${deLucia}»`)
  }

  // ---------------------------------------------- 3. La planilla diaria con lo restado
  {
    await pagina.goto(`${BASE}/planilla-diaria`, { waitUntil: 'networkidle' })
    const fila = pagina.locator('[data-por-enviar] tr', { hasText: nombre(juan) })
    const dias = await texto(fila.locator('td').nth(1))
    comprobar(dias.includes('2 h de permiso justificado con extras'), `Juan cobra el permiso justificado: «${dias.slice(0, 260)}»`)
    const tardanza = await texto(fila.locator('[data-descuento="TARDANZAS"]'))
    const delPermiso = await texto(fila.locator('[data-descuento="PERMISO"]'))
    comprobar(tardanza.startsWith(`− ${soles(120)}`) && tardanza.includes('3 tardanzas'), `la línea de las tardanzas: «${tardanza}»`)
    comprobar(delPermiso.startsWith(`− ${soles(20)}`) && delPermiso.includes(dd(d2)), `la línea del permiso descontado: «${delPermiso}»`)
    const aPagar = await texto(fila.locator('td').nth(2))
    await pagina.screenshot({ path: `${CAPTURAS}/descuentos-planilla-por-enviar.png`, fullPage: true })

    await pagina.locator('[data-enviar-planilla]').click()
    await pagina.locator('[role="dialog"]').getByRole('button', { name: 'Enviar', exact: true }).click()
    await pagina.waitForURL(/\/planilla-diaria\/[0-9a-f-]{36}/, { timeout: 30000 }).catch(() => {})
    const [enviada] = await consulta(
      `select pp.planilla_id, pp.total::float as total, pp.monto_descuentos::float as restado, pp.horas_permiso::float as permiso
         from planilla_diaria_personas pp join planillas_diarias p on p.id = pp.planilla_id
        where pp.trabajador_id = $1 and p.anulado_en is null`,
      [juan.id],
    )
    planillaDiaria = enviada?.planilla_id ?? null
    comprobar(
      enviada?.restado === 140 && enviada?.permiso === 2 && aPagar.startsWith(soles(enviada.total)),
      `lo que la pantalla decía a pagar (${aPagar}) es lo que la base guardó: ${JSON.stringify(enviada)}`,
    )
    const restadoAhi = await texto(pagina.locator(`[data-persona="${nombre(juan)}"] [data-descuentos]`))
    comprobar(restadoAhi.includes(soles(120)) && restadoAhi.includes(soles(20)), `la planilla enviada lista lo restado: «${restadoAhi}»`)
  }
  if (planillaDiaria) {
    const tes = await entrar(CUENTAS.tesoreria)
    await tes.pagina.goto(`${BASE}/planilla-diaria/${planillaDiaria}`, { waitUntil: 'networkidle' })
    const ve = await texto(tes.pagina.locator(`[data-persona="${nombre(juan)}"] [data-descuentos]`))
    comprobar(ve.includes(soles(120)), `Tesorería ve lo restado en la planilla que paga: «${ve}»`)
    comprobar(tes.errores.length === 0, `Tesorería sin errores de consola${tes.errores.length ? `: ${tes.errores[0]}` : ''}`)
    await tes.contexto.close()
  }

  // ---------------------------------------------- 4. El pago de la oficina con lo restado
  {
    await pagina.goto(`${BASE}/rrhh/pagos-oficina?mes=${mes}`, { waitUntil: 'networkidle' })
    await pagina.getByRole('button', { name: 'Registrar pago' }).click()
    const v = pagina.locator('[role="dialog"]')
    await v.locator('select[name="trabajador_id"]').selectOption(lucia.id)
    await v.getByLabel('Cada cuánto se le paga').selectOption('MES')
    await v.locator('input[name="desde"]').fill(`${mes}-01`)
    await v.locator('input[name="monto"]').fill('2600')
    const vista = await texto(v.locator('[data-vista-descuentos]'))
    comprobar(
      vista.includes(`− ${soles(150)}`) && vista.includes(`− ${soles(50)}`) && vista.includes(`Se le paga ${soles(2400)}`),
      `antes de registrar, la ventana dice lo que se resta y cuánto se le paga: «${vista}»`,
    )
    await v.getByRole('button', { name: 'Registrar', exact: true }).click()
    const errorPago = await esperarVentana(pagina)
    comprobar(errorPago === '', `registrar el pago no dio error${errorPago ? `: ${errorPago}` : ''}`)
    const [pago] = await consulta(
      `select p.id, p.monto::float as monto,
              (select sum(d.monto)::float from descuentos_del_pago d where d.oficina_pago_id = p.id) as restado,
              (select count(*)::int from descuentos_del_pago d where d.oficina_pago_id = p.id) as lineas
         from oficina_pagos p where p.trabajador_id = $1 and p.anulado_en is null`,
      [lucia.id],
    )
    comprobar(pago?.monto === 2400 && pago?.restado === 200 && pago?.lineas === 2, `la base guarda S/ 2 400 pagados y S/ 200 restados en dos líneas: ${JSON.stringify(pago)}`)
    const fila = pagina.locator('tr', { hasText: nombre(lucia) }).filter({ has: pagina.locator('[data-descuentos]') })
    await esperar(fila, 'de sueldo')
    const enLaLista = await texto(fila)
    comprobar(enLaLista.includes(`de ${soles(2600)} de sueldo`), `la lista de pagos dice lo restado y el sueldo: «${enLaLista.slice(0, 260)}»`)
  }

  // ---------------------------------------------- 5. Dónde se restó, y el recargo por código
  {
    await pagina.goto(`${BASE}/rrhh/tardanzas?mes=${mes}`, { waitUntil: 'networkidle' })
    const deJuan = await texto(pagina.locator(`tr[data-tardanzas="${juan.id}"] [data-restado]`))
    comprobar(/Restado S\/ 120\.00 en PD-/.test(deJuan) && !deJuan.includes('Por restar'), `Juan, ya restado en la planilla: «${deJuan}»`)
    const deLucia = await texto(pagina.locator(`tr[data-tardanzas="${lucia.id}"] [data-restado]`))
    comprobar(deLucia.includes(`Restado ${soles(150)}`) && !deLucia.includes('Por restar'), `Lucía, ya restado en su pago: «${deLucia}»`)

    const recargo = await comoPuesto(
      CUENTAS.rrhh,
      `select codigo, sum(monto)::float as monto from public.rrhh_recargo_extras_del_mes($1::date) where codigo in ($2, $3) group by codigo`,
      [`${mes}-01`, CODIGO_A, CODIGO_B],
    )
    await pagina.goto(`${BASE}/rrhh/costeo?mes=${mes}`, { waitUntil: 'networkidle' })
    const tarjetaA = await texto(pagina.locator(`[data-recargo="${CODIGO_A}"] summary`))
    comprobar(
      recargo.length === 1 && recargo[0].codigo === CODIGO_A && recargo[0].monto === 2.5 && tarjetaA.includes(soles(2.5)) && tarjetaA.includes('1 h extras'),
      `Costeo por código: el recargo de la hora extra pagada va al código A (${tarjetaA}; base ${JSON.stringify(recargo)})`,
    )
    comprobar((await pagina.locator(`[data-recargo="${CODIGO_B}"]`).count()) === 0, 'las extras reservadas no llevan recargo: B no aparece')
    await pagina.screenshot({ path: `${CAPTURAS}/descuentos-recargo-costeo.png`, fullPage: true })
  }

  // ---------------------------------------------- 6. Planillas: el globo y el ajuste
  {
    await pagina.goto(`${BASE}/rrhh/permisos`, { waitUntil: 'networkidle' })
    const sinPasada = await globoPlanillas(pagina)
    if (planillaPasado) {
      await consulta(`insert into planillas (id, tipo, periodo, moneda, registrado_por) values ($1, 'TALLER', $2::date, 'PEN', $3)`, [
        planillaPasado,
        `${mesPasado}-01`,
        rrhhId,
      ])
    }
    await consulta(`insert into planillas (id, tipo, periodo, moneda, registrado_por) values ($1, 'TALLER', $2::date, 'PEN', $3)`, [
      planillaEste,
      `${mes}-01`,
      rrhhId,
    ])
    const tarjeta = tarjetaPlanilla(pagina, `${mes}-01`)
    const enPlanilla = `${juan.apellidos.toUpperCase()} ${juan.nombres.toUpperCase()}`
    async function agregar(nombrePlanilla, documento, monto) {
      // El pliegue queda abierto tras agregar a alguien: se abre solo si está cerrado.
      const pliegue = tarjeta.locator('details', { has: pagina.locator(`#pl-nom-${planillaEste}`) })
      if (!(await pliegue.evaluate((d) => d.open))) await pliegue.locator('summary').first().click()
      await tarjeta.locator(`#pl-nom-${planillaEste}`).fill(nombrePlanilla)
      await tarjeta.locator(`#pl-doc-${planillaEste}`).fill(documento)
      await tarjeta.locator(`#pl-monto-${planillaEste}`).fill(String(monto))
      await tarjeta.getByRole('button', { name: 'Agregar', exact: true }).click()
      await esperar(tarjeta.locator('summary'), nombrePlanilla)
    }

    // Con la fecha real: antes de noviembre de 2026, la de este mes queda como registro.
    const [{ desde: ajusteReal }] = await consulta(`select to_char(public.planilla_ajuste_desde(), 'YYYY-MM-DD') as desde`)
    comprobar(ajusteReal === '2026-11-01', `el ajuste de la planilla de taller empieza en noviembre de 2026 (base ${ajusteReal})`)
    if (`${mes}-01` < ajusteReal) {
      await pagina.reload({ waitUntil: 'networkidle' })
      const real = await globoEsperado()
      const sinAjuste = await globoPlanillas(pagina)
      comprobar(
        sinAjuste === real.texto && sinAjuste === sinPasada,
        `el globo no cuenta la planilla de taller del mes pasado, que queda como registro («${sinPasada}» → «${sinAjuste}», base ${real.n})`,
      )
      await pagina.goto(`${BASE}/rrhh`, { waitUntil: 'networkidle' })
      await agregar(enPlanilla, juan.dni, 1000)
      const cabecera = await texto(tarjeta.locator('h2 + p'))
      const registro = await texto(tarjeta.locator('[data-solo-registro]'))
      const resumen = await texto(tarjeta.locator('details', { hasText: enPlanilla }).locator('summary'))
      comprobar(
        cabecera.includes('queda como registro') && !cabecera.includes('ajuste') && registro.includes('empieza en noviembre de 2026'),
        `la de este mes dice que queda como registro: «${cabecera}» · «${registro}»`,
      )
      comprobar(resumen.includes('de antes de noviembre de 2026: queda como registro'), `la fila de Juan lo dice: «${resumen}»`)
      comprobar((await tarjeta.locator('[data-espera-cierre]').count()) === 0, 'no pide cerrarla para ajustar nada')
      await tarjeta.getByRole('button', { name: 'Cerrar planilla' }).click()
      const ventana = pagina.locator('[role="dialog"]')
      await ventana.waitFor({ timeout: 10000 })
      const aviso = await texto(ventana)
      comprobar(
        aviso.includes('Queda como registro: el ajuste de la planilla de taller empieza en noviembre de 2026.') &&
          !aviso.includes('de ajuste entran') &&
          !aviso.includes('El mes todavía no termina'),
        `la ventana de cierre no promete ajuste: «${aviso.slice(0, 300)}»`,
      )
      await pagina.screenshot({ path: `${CAPTURAS}/descuentos-planilla-solo-registro.png`, fullPage: true })
      await ventana.getByRole('button', { name: 'Cancelar' }).click()
      await ventana.waitFor({ state: 'hidden', timeout: 10000 })
    }

    // Desde aquí el ajuste empieza en el mes pasado, para probarlo antes de noviembre (se restaura al terminar).
    ;[{ def: ajusteOriginal }] = await consulta(`select pg_get_functiondef('public.planilla_ajuste_desde()'::regprocedure) as def`)
    await consulta(
      `create or replace function public.planilla_ajuste_desde() returns date language sql stable set search_path to 'public' as $f$ select '${mesPasado}-01'::date $f$`,
    )
    await pagina.goto(`${BASE}/rrhh/permisos`, { waitUntil: 'networkidle' })
    const esperado = await globoEsperado()
    const conPasada = await globoPlanillas(pagina)
    comprobar(
      conPasada === esperado.texto && esperado.n > 0,
      `el globo de Planillas cuenta la del mes pasado en preparación y no la de este mes («${sinPasada}» → «${conPasada}», base ${esperado.n})`,
    )

    await pagina.goto(`${BASE}/rrhh`, { waitUntil: 'networkidle' })
    if ((await tarjeta.locator('details', { hasText: enPlanilla }).count()) === 0) await agregar(enPlanilla, juan.dni, 1000)
    await agregar(`Pedro Sinficha ${sello}`, '', 500)
    const [costo] = await consulta(
      `select como, horas::float as horas, ajuste::float as ajuste, codigos from planilla_al_costo($1) where trabajador_id = $2`,
      [planillaEste, juan.id],
    )
    const cabecera = await texto(tarjeta.locator('h2 + p'))
    comprobar(
      // Su costo real (S/ 1,000) ya trae la extra: se descuentan sus horas (S/ 330) y el recargo que ya entró (S/ 2.50).
      costo?.como === 'HORAS' && costo.horas === 33 && costo.ajuste === 667.5 && cabecera.includes(`ajuste ${soles(1167.5)} al cerrar`) && cabecera.includes('1 sin ficha'),
      `la cabecera dice el ajuste que va a entrar y quién no tiene ficha: «${cabecera}» (base ${JSON.stringify(costo)})`,
    )
    const filaJuan = tarjeta.locator('details', { hasText: enPlanilla })
    const resumen = await texto(filaJuan.locator('summary'))
    comprobar(resumen.includes(`33 h en 2 códigos · ajuste ${soles(667.5)}`), `la fila de Juan: «${resumen}»`)
    await filaJuan.locator('summary').click()
    const explicacion = await texto(filaJuan.locator('[data-al-costo]'))
    comprobar(
      explicacion.includes(`ya entraron ${soles(330)}`) && explicacion.includes(`${soles(2.5)} del recargo`) && explicacion.includes('Al cerrar la planilla'),
      `al abrirla, la cuenta, con el recargo que ya entró: «${explicacion}»`,
    )
    // Para comparar con los descuentos del Excel: lo que el sistema ya le restó en el mes.
    const yaRestado = await texto(filaJuan.locator('[data-ya-restado]'))
    comprobar(
      yaRestado.includes(soles(140)) && yaRestado.includes(`tardanzas ${soles(120)}`) && yaRestado.includes(`permisos ${soles(20)}`),
      `la fila dice lo que el sistema ya le restó en el mes: «${yaRestado}»`,
    )
    const filaSinFicha = tarjeta.locator('details', { hasText: `Pedro Sinficha ${sello}` })
    comprobar((await texto(filaSinFicha.locator('summary'))).includes('sin ficha en Personal'), 'quien no tiene ficha lo dice')

    // Se quita al de sin ficha (iría por las horas de todo el banco) y se cierra.
    await filaSinFicha.locator('summary').click()
    await filaSinFicha.getByRole('button', { name: `Quitar a Pedro Sinficha ${sello} de la planilla` }).click()
    await pagina.locator('[role="dialog"]').getByRole('button', { name: 'Quitar de la planilla' }).click()
    const errorQuitar = await esperarVentana(pagina)
    comprobar(errorQuitar === '', `quitar a quien no tiene ficha no dio error${errorQuitar ? `: ${errorQuitar}` : ''}`)
    await tarjeta.locator('details', { hasText: `Pedro Sinficha ${sello}` }).waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
    await tarjeta.getByRole('button', { name: 'Cerrar planilla' }).click()
    // No se cierra de un toque: la ventana dice cuánto entra a los códigos.
    const ventana = pagina.locator('[role="dialog"]')
    await ventana.waitFor({ timeout: 10000 })
    const avisoCierre = await texto(ventana)
    comprobar(
      avisoCierre.includes(`${soles(667.5)} de ajuste entran`) && avisoCierre.includes('no se vuelve a abrir') && avisoCierre.includes('El mes todavía no termina'),
      `la ventana de cierre dice el ajuste y que el mes no terminó: «${avisoCierre.slice(0, 300)}»`,
    )
    comprobar(
      (await consulta(`select estado from planillas where id = $1`, [planillaEste]))[0]?.estado === 'BORRADOR',
      'abrir la ventana todavía no cierra la planilla',
    )
    await ventana.getByRole('button', { name: 'Cerrar planilla' }).click()
    // Al cerrarse, la tarjeta se repinta sin el formulario y su aviso: se espera a la base.
    let cerrada = null
    for (let i = 0; i < 30 && cerrada?.estado !== 'CERRADA'; i++) {
      await pagina.waitForTimeout(500)
      ;[cerrada] = await consulta(`select estado from planillas where id = $1`, [planillaEste])
    }
    comprobar(cerrada?.estado === 'CERRADA', `la planilla se cierra sin pedir el 100 % de ningún reparto (${cerrada?.estado})`)
    await pagina.screenshot({ path: `${CAPTURAS}/descuentos-planilla-del-mes.png`, fullPage: true })
  }
  {
    const ger = await entrar(CUENTAS.gerencia)
    const [ajusteA] = await consulta(
      `select sum(monto)::float as monto from codigo_interno_costeo($1) where fuente = 'MANO_OBRA' and concepto like 'Ajuste de la planilla%'`,
      [CODIGO_A],
    )
    await ger.pagina.goto(`${BASE}/codigos-internos/detalle?${new URLSearchParams({ codigo: CODIGO_A, vista: 'costeo' })}`, { waitUntil: 'networkidle' })
    const linea = await texto(ger.pagina.locator('tr', { hasText: 'Ajuste de la planilla de taller' }))
    comprobar(
      ajusteA?.monto > 0 && linea.includes(soles(ajusteA.monto)),
      `Gerencia ve el ajuste de la planilla en la mano de obra del código A: «${linea.slice(0, 200)}» (base ${ajusteA?.monto})`,
    )
    comprobar(linea.includes('Por ahora: el mes no termina'), `el ajuste del mes en curso dice que es provisional: «${linea.slice(0, 200)}»`)
    await ger.pagina.screenshot({ path: `${CAPTURAS}/descuentos-ajuste-en-el-codigo.png`, fullPage: true })
    // El resumen del código dice cuánto de la mano de obra es el ajuste.
    await ger.pagina.goto(`${BASE}/codigos-internos/detalle?${new URLSearchParams({ codigo: CODIGO_A })}`, { waitUntil: 'networkidle' })
    const manoDeObra = await texto(ger.pagina.getByText(/de personal · /).first()).catch(() => '')
    comprobar(
      manoDeObra.includes(`${soles(ajusteA?.monto ?? 0)} de ajuste de la planilla de taller`),
      `el resumen de la mano de obra dice el ajuste: «${manoDeObra.slice(0, 220)}»`,
    )
    comprobar(ger.errores.length === 0, `Gerencia sin errores de consola${ger.errores.length ? `: ${ger.errores[0]}` : ''}`)
    await ger.contexto.close()
  }

  comprobar(rrhh.errores.length === 0, `RR. HH. sin errores de consola${rrhh.errores.length ? `: ${rrhh.errores[0]}` : ''}`)
  await rrhh.contexto.close()
} catch (e) {
  fallas.push(String(e))
  console.log('FALLA', e)
} finally {
  // Lo numerado se anula; las planillas del mes de la prueba se borran (una por mes); las personas, de baja.
  if (planillaDiaria) {
    await comoPuesto(CUENTAS.rrhh, `select public.anular_planilla_diaria($1, 'Prueba del banco: se deja anulada al terminar')`, [planillaDiaria]).catch(
      (e) => fallas.push(`no se pudo anular la planilla diaria al terminar: ${e}`),
    )
  }
  for (const p of await consulta(`select id from oficina_pagos where trabajador_id = $1 and anulado_en is null`, [lucia.id])) {
    await comoPuesto(CUENTAS.rrhh, `select public.rrhh_anular_pago_oficina($1, 'Prueba del banco: se deja anulado al terminar')`, [p.id]).catch((e) =>
      fallas.push(`no se pudo anular el pago al terminar: ${e}`),
    )
  }
  // Sin esto, los permisos de quien queda de baja seguirían «por justificar» en la pantalla.
  for (const p of await consulta(`select id from permisos_personal where trabajador_id = any($1::uuid[]) and anulado_en is null`, [[juan.id, lucia.id]])) {
    await comoPuesto(CUENTAS.rrhh, `select public.rrhh_anular_permiso($1, 'Prueba del banco: se deja anulado al terminar')`, [p.id]).catch((e) =>
      fallas.push(`no se pudo anular un permiso al terminar: ${e}`),
    )
  }
  // Las tardanzas también: si no, quien queda de baja seguiría con descuentos que esperan.
  // Primero las salidas: la base no deja anular un ingreso con su salida vigente.
  for (const a of await consulta(
    `select id from asistencias where trabajador_id = any($1::uuid[]) and anulado_en is null order by tipo = 'INGRESO'`,
    [[juan.id, lucia.id]],
  )) {
    await comoPuesto(CUENTAS.rrhh, `select public.anular_asistencia($1, 'Prueba del banco: se deja anulada al terminar')`, [a.id]).catch((e) =>
      fallas.push(`no se pudo anular una marca al terminar: ${e}`),
    )
  }
  // Con la planilla diaria anulada, sus horas volverían a «Por enviar»: se anulan
  // las decisiones de las extras y después los reportes (en ese orden lo pide la base).
  try {
    await comoPuesto(
      CUENTAS.rrhh,
      `select count(public.rrhh_anular_decision_horas_extras(d.id, 'Prueba del banco: se deja anulada al terminar'))
         from horas_extras_decisiones d where d.trabajador_id = $1 and d.anulado_en is null`,
      [juan.id],
    )
    await comoPuesto(
      CUENTAS.rrhh,
      `select count(public.anular_reporte_diario(r, 'Prueba del banco: se deja anulado al terminar')) from unnest($1::uuid[]) r`,
      [reportes],
    )
  } catch (e) {
    fallas.push(`no se pudieron anular los reportes de la prueba al terminar: ${e}`)
  }
  // Una planilla cerrada no deja quitar a nadie: vuelve a borrador para borrarla.
  const borrar = [planillaEste, planillaPasado].filter(Boolean)
  try {
    await base.query('begin')
    await base.query(`update planillas set estado = 'BORRADOR', cerrado_por = null, cerrado_en = null where id = any($1::uuid[])`, [borrar])
    await base.query(`delete from planilla_personas where planilla_id = any($1::uuid[])`, [borrar])
    await base.query(`delete from planillas where id = any($1::uuid[])`, [borrar])
    await base.query('commit')
  } catch (e) {
    await base.query('rollback')
    fallas.push(`no se pudieron borrar las planillas del mes de la prueba: ${e}`)
  }
  await consulta(
    `update trabajadores set activo = false, fecha_baja = greatest(fecha_ingreso, (now() at time zone 'America/Lima')::date) where id = any($1::uuid[])`,
    [[juan.id, lucia.id]],
  ).catch((e) => fallas.push(`no se pudo dar de baja a las personas de la prueba: ${e}`))
  // El inicio del ajuste vuelve a ser el de la migración (create or replace conserva los permisos).
  if (ajusteOriginal) {
    await consulta(ajusteOriginal).catch((e) => fallas.push(`no se pudo restaurar planilla_ajuste_desde(): ${e}`))
  }
  await navegador.close()
  await base.end()
}
console.log(fallas.length ? `\n${fallas.length} fallas` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
