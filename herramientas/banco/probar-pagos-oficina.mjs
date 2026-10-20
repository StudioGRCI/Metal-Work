/**
 * Clic real sobre los pagos de la oficina y la fecha de ingreso y de baja
 * (migración 20261020120000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. RR. HH. registra en Personal a una asistente de Administración, en la
 *      planilla administrativa, con su fecha de ingreso.
 *   2. En Pagos de la oficina la ve con días sin pagar, le registra la primera
 *      quincena (tocando «Registrar» tres veces: entra un pago) y la segunda; el
 *      último día se llena solo y ya no le faltan días. Un pago que cruza otro
 *      no entra y la ventana lo dice.
 *   3. Gerencia ve en el costeo de la unidad la línea de la oficina «pagos de la
 *      oficina registrados por RR. HH.», con lo que dice la base.
 *   4. Administración ve el sueldo de la oficina sumado en Gastos del mes.
 *   5. RR. HH. anula un pago con su motivo; dar de baja con pagos posteriores
 *      se rechaza; sin ellos, queda de baja con su último día y vuelve de alta.
 *   6. Ventas no entra; en el teléfono la pantalla no se sale de ancho.
 *
 * Necesita las cuentas `*.local@metalwork.test`. Las personas y el código los
 * crea el script, distintos en cada corrida; al final, aunque algo falle, deja
 * los pagos y las horas anulados y a las personas de baja.
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

const [{ hoy, mes, fin }] = await consulta(`select (now() at time zone 'America/Lima')::date::text as hoy,
                                                   to_char(now() at time zone 'America/Lima', 'YYYY-MM') as mes,
                                                   (date_trunc('month', now() at time zone 'America/Lima') + interval '1 month' - interval '1 day')::date::text as fin`)
const sello = Date.now().toString().slice(-8)
const CODIGO = `POF${sello.slice(-4)}_SR_O4_1_26/41`
const NOMBRE = `Asistente ${sello}`
const TAREO = randomUUID()
const dd = (fecha) => fecha.split('-').reverse().join('/')
const sumarDias = (fecha, n) => new Date(Date.parse(`${fecha}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
console.log(`  · persona de la prueba: ${NOMBRE} · código: ${CODIGO}`)

try {
  // Que el mes tenga horas en una unidad: 8 h de un soldador, como las cargaría RR. HH.
  await consulta(
    `with nuevo as (
       insert into trabajadores (nombres, apellidos, dni, cargo, area_id, creado_por)
       values ('Soldador ' || $1, 'Banco', '6' || right($1, 7), 'Soldador', (select id from areas where codigo = 'MTZ'), (select id from usuarios where correo = $2))
       returning id)
     insert into trabajador_costos (trabajador_id, costo_mensual) select id, 2400 from nuevo`,
    [sello, CUENTAS.rrhh],
  )
  const [soldador] = await consulta(`select id from trabajadores where nombres = $1`, [`Soldador ${sello}`])
  await comoPuesto(CUENTAS.rrhh, `select public.rrhh_registrar_tareo($4, $1, $2::date, $3, 8, 'Soldadura del piso')`, [soldador.id, hoy, CODIGO, TAREO])

  // ------------------------------------------- 1. RR. HH. registra a la asistente con su ingreso
  const rrhh = await entrar(CUENTAS.rrhh)
  {
    const { pagina } = rrhh
    await pagina.goto(`${BASE}/rrhh/personal`, { waitUntil: 'networkidle' })
    await pagina.getByRole('button', { name: 'Registrar persona' }).click()
    const v = pagina.locator('[role="dialog"]')
    await v.locator('input[name="nombres"]').fill(NOMBRE)
    await v.locator('input[name="apellidos"]').fill('Banco')
    await v.locator('input[name="dni"]').fill(`7${sello.slice(-7)}`)
    await v.locator('select[name="area_id"]').selectOption({ label: 'Administración' })
    // El sueldo de la oficina va por la planilla, no por el área (20261020200000).
    await v.locator('select[name="planilla"]').selectOption('ADMINISTRATIVA')
    await v.locator('input[name="fecha_ingreso"]').fill(`${mes}-01`)
    await v.locator('input[name="banco"]').fill('BCP')
    await v.locator('input[name="numero_cuenta"]').fill(`191-${sello}`)
    await v.locator('input[name="costo_mensual"]').fill('3300')
    await v.getByRole('button', { name: 'Registrar' }).click()
    await pagina.getByRole('status').filter({ hasText: 'queda en el personal' }).waitFor({ timeout: 20000 })
    const [w] = await consulta(`select id, fecha_ingreso::text from trabajadores where nombres = $1`, [NOMBRE])
    comprobar(w?.fecha_ingreso === `${mes}-01`, `la ficha guarda la fecha de ingreso (${w?.fecha_ingreso})`)
    const fila = limpio(await pagina.locator('tr', { hasText: NOMBRE }).innerText())
    comprobar(fila.includes(`Desde el ${dd(`${mes}-01`)}`), `la fila dice desde cuándo trabaja: «${fila.slice(0, 160)}»`)
  }
  const [asistente] = await consulta(`select id from trabajadores where nombres = $1`, [NOMBRE])

  // ---------------------------------------------- 2. RR. HH. registra sus dos quincenas
  {
    const { pagina } = rrhh
    await pagina.goto(`${BASE}/rrhh/pagos-oficina`, { waitUntil: 'networkidle' })
    const faltan = limpio(await pagina.locator('[data-faltan-pagos]').innerText().catch(() => ''))
    comprobar(faltan.includes(NOMBRE), `«Les faltan días pagados» la lista: «${faltan.slice(0, 200)}»`)

    async function registrar(desde, monto, aportes, veces = 1) {
      await pagina.getByRole('button', { name: 'Registrar pago' }).click()
      const v = pagina.locator('[role="dialog"]')
      await v.locator('select[name="trabajador_id"]').selectOption({ label: `${NOMBRE} Banco` })
      await v.getByLabel('Cada cuánto se le paga').selectOption('QUINCENA')
      await v.locator('input[name="desde"]').fill(desde)
      const hasta = await v.locator('input[name="hasta"]').inputValue()
      await v.locator('input[name="monto"]').fill(String(monto))
      await v.locator('input[name="aportes"]').fill(String(aportes))
      const boton = v.getByRole('button', { name: 'Registrar' })
      for (let i = 0; i < veces; i++) await boton.click({ noWaitAfter: true, force: true }).catch(() => {})
      return { v, hasta }
    }

    const primera = await registrar(`${mes}-01`, 1500, 135, 3)
    comprobar(primera.hasta === `${mes}-15`, `con «Una quincena» desde el 1, el último día se llena con el 15 (${primera.hasta})`)
    await pagina.getByRole('status').filter({ hasText: 'Pago registrado' }).waitFor({ timeout: 20000 })
    const [{ n }] = await consulta(`select count(*)::int as n from oficina_pagos where trabajador_id = $1`, [asistente.id])
    comprobar(n === 1, `tres toques en «Registrar» dejan un solo pago (${n})`)

    const segunda = await registrar(`${mes}-16`, 1500, 135)
    comprobar(segunda.hasta === fin, `desde el 16, la quincena llega al fin de mes (${segunda.hasta})`)
    await pagina.getByRole('status').filter({ hasText: 'Pago registrado' }).waitFor({ timeout: 20000 })

    const cruce = await registrar(`${mes}-10`, 700, 0)
    const alerta = limpio(await cruce.v.getByRole('alert').innerText({ timeout: 20000 }).catch(() => ''))
    comprobar(alerta.includes('cruza esas fechas'), `un pago que cruza otro no entra y la ventana lo dice: «${alerta}»`)
    await pagina.keyboard.press('Escape')
    const pagos = await consulta(`select desde::text, hasta::text, monto::numeric, aportes::numeric from oficina_pagos
                                   where trabajador_id = $1 and anulado_en is null order by desde`, [asistente.id])
    comprobar(pagos.length === 2 && pagos[0].hasta === `${mes}-15` && pagos[1].desde === `${mes}-16` && Number(pagos[1].aportes) === 135,
      `en la base, las dos quincenas con sus aportes: ${JSON.stringify(pagos)}`)

    await pagina.reload({ waitUntil: 'networkidle' })
    const lista = limpio(await pagina.locator('[data-faltan-pagos]').innerText().catch(() => ''))
    comprobar(!lista.includes(NOMBRE), 'con las dos quincenas ya no le faltan días')
    const fila = limpio(await pagina.locator('tr', { hasText: NOMBRE }).first().innerText())
    comprobar(fila.includes(`S/ ${soles(1635)}`) && fila.includes('15 días'), `cada pago dice sus días y lo pagado con aportes: «${fila}»`)
  }

  // --------------------------------------- 3. Gerencia ve la línea de la oficina en la unidad
  const [oficina] = await consulta(`select monto, sin_pago from public.sueldos_oficina_del_mes($1::date)`, [`${mes}-01`])
  {
    const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
    await pagina.goto(`${BASE}/codigos-internos/detalle?codigo=${encodeURIComponent(CODIGO)}&vista=costeo`, { waitUntil: 'networkidle' })
    const [linea] = await consulta(`select monto from public.codigo_interno_lineas($1, true) where concepto like 'Sueldos de la oficina %'`, [CODIGO])
    const fila = limpio(await pagina.locator('tr', { hasText: 'Sueldos de la oficina' }).first().innerText().catch(() => ''))
    comprobar(linea && fila.includes(`S/ ${soles(linea.monto)}`) && fila.includes('pagos de la oficina registrados por RR. HH.'),
      `la unidad carga su parte de la oficina (S/ ${soles(linea?.monto ?? 0)} de S/ ${soles(oficina.monto)}) y dice de dónde sale: «${fila}»`)
    comprobar(errores.length === 0, `Gerencia, sin errores de consola (${errores.join(' | ')})`)
    await contexto.close()
  }

  // ------------------------------------------ 4. Administración ve el sueldo de la oficina sumado
  {
    const { pagina, contexto, errores } = await entrar(CUENTAS.administracion)
    await pagina.goto(`${BASE}/costos/gastos-generales`, { waitUntil: 'networkidle' })
    const ficha = limpio(await pagina.locator('[data-sueldo-oficina]').innerText().catch(() => ''))
    comprobar(ficha.includes(`S/ ${soles(oficina.monto)}`), `Gastos del mes dice el sueldo de la oficina de la base: «${ficha}»`)
    const aviso = await pagina.locator('[data-oficina-sin-pago]').count()
    comprobar((aviso > 0) === (oficina.sin_pago > 0), `el aviso de días sin pagar sale solo si la base los tiene (${oficina.sin_pago})`)
    comprobar((await pagina.getByRole('link', { name: /Pagos de la oficina/ }).count()) === 0, 'Administración no tiene la pantalla de pagos en su menú')
    comprobar(errores.length === 0, `Administración, sin errores de consola (${errores.join(' | ')})`)
    await contexto.close()
  }

  // --------------------------------------------------- 5. Anular, y la baja con sus fechas
  {
    const { pagina } = rrhh
    await pagina.goto(`${BASE}/rrhh/pagos-oficina`, { waitUntil: 'networkidle' })
    await pagina.getByRole('button', { name: new RegExp(`Anular El pago de ${NOMBRE} Banco del 16`) }).click()
    const v = pagina.locator('[role="dialog"]')
    await v.locator('textarea[name="motivo"]').fill('Prueba del banco: se anula la segunda quincena')
    await v.getByRole('button', { name: 'Anular' }).click()
    await v.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    const [anulado] = await consulta(`select motivo_anulacion from oficina_pagos where trabajador_id = $1 and desde = $2::date`, [asistente.id, `${mes}-16`])
    comprobar(anulado?.motivo_anulacion?.startsWith('Prueba del banco'), 'anular deja el pago con su motivo en la base')
    await pagina.reload({ waitUntil: 'networkidle' })
    comprobar(limpio(await pagina.locator('[data-faltan-pagos]').innerText().catch(() => '')).includes(NOMBRE), 'sin la segunda quincena, le vuelven a faltar días')

    // Corregir la ficha con un ingreso que deja fuera la primera quincena: el costo
    // nuevo se guarda igual y el aviso dice qué no quedó.
    await pagina.goto(`${BASE}/rrhh/personal`, { waitUntil: 'networkidle' })
    const fila = pagina.locator('tr', { hasText: NOMBRE })
    await fila.getByRole('button', { name: `Corregir la ficha de ${NOMBRE} Banco` }).click()
    const f = pagina.locator('[role="dialog"]')
    await f.locator('input[name="fecha_ingreso"]').fill(`${mes}-05`)
    await f.locator('input[name="costo_mensual"]').fill('2345')
    await f.getByRole('button', { name: /Guardar/ }).click()
    const parcial = limpio(await f.getByRole('alert').innerText({ timeout: 20000 }).catch(() => ''))
    const [costo] = await consulta(`select costo_mensual::numeric as c from trabajador_costos where trabajador_id = $1`, [asistente.id])
    const [sigue] = await consulta(`select fecha_ingreso::text from trabajadores where id = $1`, [asistente.id])
    comprobar(parcial.includes('no se guardó la fecha de ingreso') && Number(costo?.c) === 2345 && sigue.fecha_ingreso === `${mes}-01`,
      `con el ingreso rechazado, el costo se guarda igual y el aviso lo dice: «${parcial}» (costo ${costo?.c}, ingreso ${sigue.fecha_ingreso})`)
    await pagina.keyboard.press('Escape')
    await pagina.reload({ waitUntil: 'networkidle' })

    // La primera quincena llega al 15: una baja el 10 la dejaría fuera.
    await fila.getByRole('button', { name: `Dar de baja a ${NOMBRE} Banco` }).click()
    const b = pagina.locator('[role="dialog"]')
    await b.locator('input[name="fecha_baja"]').fill(`${mes}-10`)
    await b.getByRole('button', { name: 'Dar de baja' }).click()
    const rechazo = limpio(await b.getByRole('alert').innerText({ timeout: 20000 }).catch(() => ''))
    comprobar(rechazo.includes('Tiene pagos de la oficina después'), `la baja que deja fuera un pago se rechaza y lo dice: «${rechazo}»`)
    // La baja, la víspera de hoy si ya pasó la primera quincena: así vuelve hoy y no queda un ingreso en el futuro.
    const ultimo = sumarDias(hoy, -1) < `${mes}-15` ? `${mes}-15` : sumarDias(hoy, -1)
    await b.locator('input[name="fecha_baja"]').fill(ultimo)
    await b.getByRole('button', { name: 'Dar de baja' }).click()
    await b.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    const [w] = await consulta(`select activo, fecha_baja::text from trabajadores where id = $1`, [asistente.id])
    comprobar(w.activo === false && w.fecha_baja === ultimo, `queda de baja con su último día (${w.fecha_baja})`)
    await pagina.goto(`${BASE}/rrhh/personal?estado=todos`, { waitUntil: 'networkidle' })
    // Vuelve a entrar al día siguiente de su baja: el periodo anterior queda anotado.
    const vuelve = sumarDias(w.fecha_baja, 1)
    await pagina.locator('tr', { hasText: NOMBRE }).getByRole('button', { name: `Dar de alta a ${NOMBRE} Banco` }).click()
    const a = pagina.locator('[role="dialog"]')
    await a.locator('input[name="fecha_reingreso"]').fill(vuelve)
    await a.getByRole('button', { name: 'Dar de alta', exact: true }).click()
    await a.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    const [alta] = await consulta(`select activo, fecha_baja, fecha_ingreso::text from trabajadores where id = $1`, [asistente.id])
    const periodos = await consulta(`select ingreso::text, baja::text from trabajador_periodos where trabajador_id = $1`, [asistente.id])
    comprobar(alta.activo && alta.fecha_baja === null && alta.fecha_ingreso === vuelve
              && periodos.length === 1 && periodos[0].ingreso === `${mes}-01` && periodos[0].baja === w.fecha_baja,
      `vuelve de alta con su día de reingreso y el periodo anterior anotado: ${JSON.stringify({ alta, periodos })}`)
    await pagina.reload({ waitUntil: 'networkidle' })
    const filaAntes = limpio(await pagina.locator('tr', { hasText: NOMBRE }).innerText())
    comprobar(filaAntes.includes(`Antes: del ${dd(`${mes}-01`)} al ${dd(w.fecha_baja)}`), `la ficha muestra lo que trabajó antes: «${filaAntes.slice(-140)}»`)
  }

  // ------------------------------------------------------- 6. Ventas fuera; el teléfono
  {
    const { pagina, contexto } = await entrar(CUENTAS.ventas)
    await pagina.goto(`${BASE}/rrhh/pagos-oficina`, { waitUntil: 'networkidle' })
    comprobar(!(await pagina.locator('h1', { hasText: 'Pagos de la oficina' }).count()), `Ventas no entra (${new URL(pagina.url()).pathname})`)
    await contexto.close()
  }
  {
    const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh, { width: 390, height: 844 })
    await pagina.goto(`${BASE}/rrhh/pagos-oficina`, { waitUntil: 'networkidle' })
    const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(ancho <= 390, `en el teléfono la pantalla mide ${ancho} px de ancho`)
    await pagina.screenshot({ path: `${CAPTURAS}/pagos-oficina-telefono.png`, fullPage: true })
    comprobar(errores.length === 0, `RR. HH. en el teléfono, sin errores de consola (${errores.join(' | ')})`)
    await contexto.close()
  }
  await rrhh.pagina.goto(`${BASE}/rrhh/pagos-oficina`, { waitUntil: 'networkidle' })
  await rrhh.pagina.screenshot({ path: `${CAPTURAS}/pagos-oficina.png`, fullPage: true })
  comprobar(rrhh.errores.length === 0, `RR. HH., sin errores de consola (${rrhh.errores.join(' | ')})`)
  await rrhh.contexto.close()
} catch (e) {
  fallas.push(String(e))
  console.log('FALLA', e)
} finally {
  for (const p of await consulta(`select p.id from oficina_pagos p join trabajadores w on w.id = p.trabajador_id
                                   where w.nombres = $1 and p.anulado_en is null`, [NOMBRE])) {
    await comoPuesto(CUENTAS.rrhh, `select public.rrhh_anular_pago_oficina($1, 'Prueba del banco: se deja anulado al terminar')`, [p.id])
  }
  await comoPuesto(CUENTAS.rrhh, `select public.rrhh_anular_tareo($1, 'Prueba del banco: se deja anulada al terminar')`, [TAREO]).catch(() => {})
  // Fuera del personal al terminar. Quien volvió con un día de mañana no puede tener
  // la baja de hoy (iría antes de su ingreso): se le pone la baja en su ingreso.
  for (const w of await consulta(`select id from trabajadores where nombres in ($1, $2) and activo`, [NOMBRE, `Soldador ${sello}`])) {
    try {
      await consulta(`update trabajadores set activo = false, fecha_baja = greatest(fecha_ingreso, (now() at time zone 'America/Lima')::date)
                       where id = $1`, [w.id])
    } catch (e) {
      fallas.push(`no se pudo dar de baja a la persona de la prueba al terminar: ${e}`)
    }
  }
  await navegador.close()
  await base.end()
}
console.log(fallas.length ? `\n${fallas.length} fallas` : '\nTodo bien.')
process.exit(fallas.length ? 1 : 0)
