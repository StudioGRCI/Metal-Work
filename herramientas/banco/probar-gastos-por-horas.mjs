/**
 * Clic real sobre los gastos del mes por horas y el sueldo de la oficina
 * (migración 20261020110000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. RR. HH. carga 8 h de un soldador a una unidad nueva; hay una persona
 *      nueva de Administración, con el pago de su mes registrado (20261020120000).
 *   2. Administración registra la luz del mes: el formulario ya no pregunta
 *      cómo se reparte, la base la guarda POR HORAS, y «Cómo se reparte» lista
 *      la unidad con sus horas y su parte, y el sueldo de la oficina sumado.
 *   3. Gerencia ve en el costeo de la unidad su parte de la luz y de la
 *      oficina, con las horas que la explican, y el total cuadra con la base.
 *      Abre Gastos del mes desde su menú y ve el sueldo de la oficina sumado.
 *   4. Ventas no entra a Gastos del mes.
 *   5. Administración anula la luz con su motivo: deja de sumar en la unidad.
 *
 * Necesita las cuentas `*.local@metalwork.test` de cada puesto. El código y las
 * personas los crea el script, distintos en cada corrida; al final, aunque algo
 * falle, deja la luz y las horas anuladas y las personas de baja.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS.
 */
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  administracion: 'administracion.local@metalwork.test',
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
const soles = (n) => Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima' })
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

/** Corre `sql` con la cuenta del puesto y `set local role authenticated`. */
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

const [{ hoy, mes }] = await consulta(`select (now() at time zone 'America/Lima')::date::text as hoy,
                                              to_char(now() at time zone 'America/Lima', 'YYYY-MM') as mes`)
const sello = Date.now().toString().slice(-8)
const CODIGO = `GPH${sello.slice(-4)}_SR_O4_1_26/41`
const DETALLE = `Recibo de luz del banco ${sello}`
const TAREO = randomUUID()
console.log(`  · código de la prueba: ${CODIGO}`)

try {
  // ------------------------------------------------------------------ 1. el armazón
  // Lo que harían RR. HH.: un soldador de Maestranza (S/ 2,400) y una asistente
  // de Administración (S/ 3,000), los dos con su costo; y 8 h del soldador en la unidad.
  await consulta(
    `with nuevo as (
       insert into trabajadores (nombres, apellidos, dni, cargo, area_id, creado_por)
       select x.nombre, 'Banco', x.dni, x.cargo, (select id from areas where codigo = x.area), (select id from usuarios where correo = $2)
         from (values ('Soldador ' || $1, '6' || right($1, 7), 'Soldador', 'MTZ'),
                      ('Asistente ' || $1, '5' || right($1, 7), 'Asistente', 'ADM')) x(nombre, dni, cargo, area)
       returning id, cargo)
     insert into trabajador_costos (trabajador_id, costo_mensual)
     select id, case when cargo = 'Soldador' then 2400 else 3000 end from nuevo
     returning trabajador_id`,
    [sello, CUENTAS.rrhh],
  )
  const [soldador] = await consulta(`select id from trabajadores where nombres = $1`, [`Soldador ${sello}`])
  const [asistente] = await consulta(`select id from trabajadores where nombres = $1`, [`Asistente ${sello}`])
  // El sueldo de la oficina sale de lo pagado: RR. HH. le registra el mes a la asistente.
  await comoPuesto(CUENTAS.rrhh, `select public.rrhh_registrar_pago_oficina(gen_random_uuid(), $1, $2::date, $3::date, 3000, 0, null)`, [
    asistente.id,
    `${mes}-01`,
    (await consulta(`select ($1::date + interval '1 month' - interval '1 day')::date::text as fin`, [`${mes}-01`]))[0].fin,
  ])
  await comoPuesto(CUENTAS.rrhh, `select public.rrhh_registrar_tareo($4, $1, $2::date, $3, 8, 'Soldadura del piso')`, [
    soldador.id,
    hoy,
    CODIGO,
    TAREO,
  ])
  const [horasUnidad] = await consulta(`select horas::numeric, total::numeric from public.horas_por_codigo_del_mes($1::date) where codigo = $2`, [
    `${mes}-01`,
    CODIGO,
  ])
  comprobar(Number(horasUnidad?.horas) === 8, `la unidad tiene sus 8 h en el mes (de ${horasUnidad?.total} h de todas las unidades)`)

  // ------------------------------------------------- 2. Administración registra la luz
  {
    const { pagina, contexto, errores } = await entrar(CUENTAS.administracion)
    await pagina.goto(`${BASE}/costos/gastos-generales`, { waitUntil: 'networkidle' })
    await pagina.getByRole('button', { name: 'Registrar gasto' }).first().click()
    const v = pagina.locator('[role="dialog"]')
    comprobar((await v.getByRole('button', { name: /Tasa por código|Partes iguales/ }).count()) === 0, 'el formulario ya no pregunta cómo se reparte')
    comprobar(limpio(await v.innerText()).includes('Se reparten por horas entre las unidades'), 'y la ventana dice que se reparte por horas')
    await v.locator('#gg-concepto').selectOption('ELECTRICIDAD')
    await v.locator('#gg-descripcion').fill(DETALLE)
    await v.locator('#gg-monto').fill('1234.56')
    await v.screenshot({ path: `${CAPTURAS}/gph-formulario.png` })
    // Tres toques seguidos: un solo gasto.
    const boton = v.getByRole('button', { name: 'Registrar gasto' })
    await boton.evaluate((b) => { b.click(); b.click(); b.click() })
    await pagina.getByText('Gasto registrado: entra al costo de cada unidad por sus horas').waitFor({ timeout: 20000 })
    const gastos = await consulta(`select id, reparto, tasa from gastos_generales_mes where descripcion = $1`, [DETALLE])
    comprobar(gastos.length === 1, `tres toques, un solo gasto (${gastos.length})`)
    comprobar(gastos[0]?.reparto === 'HORAS' && gastos[0]?.tasa === null, 'la base lo guarda POR HORAS, sin tasa')
    await pagina.reload({ waitUntil: 'networkidle' })
    const fila = pagina.locator('tr', { hasText: DETALLE })
    comprobar(limpio(await fila.innerText()).includes('1,234.56'), 'la lista trae la luz con su importe')

    const tarjeta = pagina.locator('[data-reparto-del-mes]')
    const texto = limpio(await tarjeta.innerText())
    const [parte] = await consulta(`select parte from public.horas_por_codigo_del_mes($1::date) h,
                                           lateral (select round(100 * h.horas / h.total, 2) as parte) p where h.codigo = $2`, [`${mes}-01`, CODIGO])
    const filaUnidad = limpio(await tarjeta.locator('tr', { hasText: CODIGO }).innerText())
    comprobar(filaUnidad.includes('8') && filaUnidad.includes(`${Number(parte.parte).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} %`),
      `«Cómo se reparte» lista la unidad con 8 h y su ${parte.parte} %: «${filaUnidad}»`)
    const [oficina] = await consulta(`select personas, monto from public.sueldos_oficina_del_mes($1::date)`, [`${mes}-01`])
    const ficha = limpio(await pagina.locator('[data-sueldo-oficina]').innerText())
    comprobar(ficha.includes(`S/ ${soles(oficina.monto)}`),
      `arriba, el sueldo de la oficina sumado: «${ficha}» (${oficina.personas} personas, asistente incluida)`)
    comprobar(!texto.includes('persona'), 'sin decir cuántas personas son')
    await pagina.screenshot({ path: `${CAPTURAS}/gph-gastos-del-mes.png`, fullPage: true })

    await pagina.setViewportSize({ width: 390, height: 844 })
    await pagina.reload({ waitUntil: 'networkidle' })
    const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(ancho <= 390, `en el teléfono Gastos del mes cabe en la pantalla (${ancho} px de 390)`)
    await pagina.screenshot({ path: `${CAPTURAS}/gph-gastos-del-mes-telefono.png`, fullPage: true })
    comprobar(errores.length === 0, `sin errores en la consola (${errores.join(' | ')})`)
    await contexto.close()
  }

  // --------------------------------------------- 3. Gerencia lo ve en el costeo de la unidad
  const [gasto] = await consulta(`select id from gastos_generales_mes where descripcion = $1`, [DETALLE])
  const esperado = async () =>
    consulta(
      `select l.concepto, l.monto, l.detalle from public.codigo_interno_lineas($1, true) l
        where l.fuente = 'GASTOS_DEL_MES' and (l.referencia_id = $2 or l.concepto like 'Sueldos de la oficina %')
        order by l.concepto`,
      [CODIGO, gasto.id],
    )
  {
    const lineas = await esperado()
    const luz = lineas.find((l) => !l.concepto.startsWith('Sueldos'))
    const ofi = lineas.find((l) => l.concepto.startsWith('Sueldos'))
    const calculo = Math.round((1234.56 * 8 * 100) / Number(horasUnidad.total)) / 100
    comprobar(Number(luz?.monto) === calculo, `la base le carga S/ ${luz?.monto} de la luz: 1,234.56 × 8 / ${horasUnidad.total} = ${calculo}`)

    const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
    await pagina.goto(`${BASE}/codigos-internos/detalle?${new URLSearchParams({ codigo: CODIGO, vista: 'costeo' })}`, { waitUntil: 'networkidle' })
    const gastos = pagina.locator('[data-gastos-y-caja]')
    const filaLuz = limpio(await gastos.locator('tr', { hasText: DETALLE }).innerText())
    comprobar(filaLuz.includes(`S/ ${soles(luz.monto)}`) && filaLuz.includes(`Por ahora, por horas: 8 de`),
      `Gerencia ve la luz con sus horas, provisional porque el mes no termina: «${filaLuz}»`)
    const filaOfi = limpio(await gastos.locator('tr', { hasText: 'Sueldos de la oficina' }).innerText())
    comprobar(filaOfi.includes(`S/ ${soles(ofi.monto)}`) && filaOfi.includes('pagos de la oficina registrados por RR. HH.') && !/persona/.test(filaOfi),
      `y su parte de la oficina, sin nombres: «${filaOfi}»`)
    await pagina.screenshot({ path: `${CAPTURAS}/gph-costeo.png`, fullPage: true })
    const cierre = limpio(await pagina.locator('[data-cierre="incompleto"]').innerText())
    comprobar(cierre.includes('que termine el mes'), `antes de intentar cerrarla, dice que espera a que termine el mes: «${cierre}»`)

    // Gerencia también abre Gastos del mes desde su menú (Consultas) y ve el sueldo de la oficina sumado.
    const enlace = pagina.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: /Gastos del mes/ })
    comprobar((await enlace.count()) > 0, 'el menú de Gerencia lleva a Gastos del mes')
    await enlace.first().click()
    await pagina.waitForURL('**/costos/gastos-generales**')
    await pagina.waitForLoadState('networkidle')
    const fichaGerencia = limpio(await pagina.locator('[data-sueldo-oficina]').innerText())
    comprobar(fichaGerencia.includes(`S/ ${soles((await consulta(`select monto from public.sueldos_oficina_del_mes($1::date)`, [`${mes}-01`]))[0].monto)}`),
      `y ve el sueldo de la oficina sumado: «${fichaGerencia}»`)
    comprobar(errores.length === 0, `sin errores en la consola (${errores.join(' | ')})`)
    await contexto.close()
  }

  // ----------------------------------------------------------------- 4. Ventas no entra
  {
    const { pagina, contexto } = await entrar(CUENTAS.ventas)
    await pagina.goto(`${BASE}/costos/gastos-generales`, { waitUntil: 'networkidle' })
    const t = limpio(await pagina.locator('main').innerText())
    comprobar(pagina.url().includes('/sin-permiso') || /sin permiso|no tienes permiso/i.test(t), 'Ventas no entra a Gastos del mes')
    await contexto.close()
  }

  // ------------------------------------------------- 5. Administración anula la luz
  {
    const { pagina, contexto } = await entrar(CUENTAS.administracion)
    await pagina.goto(`${BASE}/costos/gastos-generales`, { waitUntil: 'networkidle' })
    await pagina.locator('tr', { hasText: DETALLE }).getByRole('button', { name: /^Anular/ }).click()
    const v = pagina.locator('[role="dialog"]')
    await v.locator('textarea').fill('Prueba del banco: se registró para ver el reparto')
    await v.getByRole('button', { name: 'Anular gasto' }).click()
    await v.waitFor({ state: 'hidden', timeout: 20000 })
    const [g] = await consulta(`select estado from gastos_generales_mes where id = $1`, [gasto.id])
    comprobar(g?.estado === 'ANULADO', 'la luz queda anulada, a la vista')
    comprobar(!(await esperado()).some((l) => !l.concepto.startsWith('Sueldos')), 'y deja de sumar en la unidad')
    await contexto.close()
  }
} finally {
  // Pase lo que pase, la prueba no deja nada sumando en el banco: la luz, el pago de
  // la asistente y las 8 h anulados con su motivo, y las dos personas de baja.
  for (const g of await consulta(`select id from gastos_generales_mes where descripcion = $1 and estado = 'ACTIVO'`, [DETALLE])) {
    await comoPuesto(CUENTAS.administracion, 'select public.anular_gasto_general($1, $2)', [g.id, 'Prueba del banco: se deja anulada al terminar'])
  }
  if ((await consulta(`select 1 from tareos where id = $1 and anulado_en is null`, [TAREO])).length > 0) {
    await comoPuesto(CUENTAS.rrhh, 'select public.rrhh_anular_tareo($1, $2)', [TAREO, 'Prueba del banco: se deja anulada al terminar'])
  }
  for (const p of await consulta(`select p.id from oficina_pagos p join trabajadores w on w.id = p.trabajador_id
                                   where w.nombres = $1 and p.anulado_en is null`, [`Asistente ${sello}`])) {
    await comoPuesto(CUENTAS.rrhh, 'select public.rrhh_anular_pago_oficina($1, $2)', [p.id, 'Prueba del banco: se deja anulado al terminar'])
  }
  await consulta(`update trabajadores set activo = false where nombres = any($1::text[])`, [[`Soldador ${sello}`, `Asistente ${sello}`]])
}

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo bien.' : `\n${fallas.length} fallas.`)
process.exit(fallas.length === 0 ? 0 : 1)
