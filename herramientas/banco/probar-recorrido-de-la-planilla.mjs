// Plan 13, entrega 13.3: en Planillas, el recorrido de cada mes con quién y
// cuándo, y lo que falta para cerrar (reportes sin el visto de RR. HH., quien no
// tiene cuenta o ficha). Una planilla cerrada no se edita.
//
//   BANCO_CLAVE=… BASE=http://localhost:3113 node herramientas/banco/probar-recorrido-de-la-planilla.mjs
//
// Siembra con la cuenta de cada puesto: RR. HH. arma la planilla de taller del
// mes (un «Excel» con dos personas y una a mano) y la administrativa del mes
// anterior, que cierra; el supervisor deja un reporte del mes sin el visto de
// RR. HH. Mira como RR. HH. en 1440 y 390; Gerencia y Almacén no entran. Al
// terminar quita a la gente de la planilla abierta, anula el reporte y da de
// baja a las personas. Las dos planillas quedan (no se borran): la de taller,
// vacía; la administrativa, cerrada. Si ya existen de una corrida anterior, se
// usan las mismas.

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
const rosa = { id: crypto.randomUUID(), nombres: `Rosa ${sello}`, apellidos: 'Prueba Planilla', dni: `6${sello}1` }
const tito = { id: crypto.randomUUID(), nombres: `Tito ${sello}`, apellidos: 'Prueba Sin Cuenta', dni: `6${sello}2` }
const zeta = `Zeta ${sello} Sin Ficha`
const CODIGO = `PLA${sello}`

const [{ hoy }] = await consulta(`select to_char((now() at time zone 'America/Lima')::date, 'YYYY-MM-DD') as hoy`)
const mes = `${hoy.slice(0, 7)}-01`
const [anio, mm] = hoy.slice(0, 7).split('-').map(Number)
const mesPasado = `${mm === 1 ? anio - 1 : anio}-${String(mm === 1 ? 12 : mm - 1).padStart(2, '0')}-01`
const [{ id: mtz }] = await consulta(`select id from areas where codigo = 'MTZ'`)
const [{ id: rrhhId }] = await consulta('select id from usuarios where correo = $1', [CUENTAS.rrhh])

let reporte = null
let taller = null
let navegador = null
try {
  // Rosa tiene cuenta (la ficha la exige); Tito es una ficha de antes, sin cuenta: se siembra directo.
  await comoPuesto(
    CUENTAS.rrhh,
    `select public.rrhh_guardar_trabajador($1, $2, $3, $4, 'Pintora', $5, '08:00', '17:00', 'Banco de Pruebas', 'AHORROS', $6, null)`,
    [rosa.id, rosa.nombres, rosa.apellidos, rosa.dni, mtz, `191-3333${sello}`],
  )
  await consulta(`insert into trabajadores (id, nombres, apellidos, dni, area_id, creado_por) values ($1, $2, $3, $4, $5, $6)`, [
    tito.id,
    tito.nombres,
    tito.apellidos,
    tito.dni,
    mtz,
    rrhhId,
  ])

  // El supervisor reporta hoy con Rosa; nadie le da el visto.
  ;[{ id: reporte }] = await comoPuesto(
    CUENTAS.supervisor,
    `select public.registrar_reporte_diario(gen_random_uuid(), $1::date, $2, $3, 'Trabajo del día (prueba del banco).', $4::jsonb, null, null) as id`,
    [hoy, CODIGO, `Planilla ${sello}`, JSON.stringify([{ descripcion: 'Pintura de base', avance: 10, personal: [{ trabajador_id: rosa.id, horas: 8 }] }])],
  )

  // La planilla de taller del mes: la de una corrida anterior, si está.
  const existente = await consulta(`select id, estado from planillas where tipo = 'TALLER' and periodo = $1`, [mes])
  if (existente[0]?.estado === 'CERRADA') throw new Error('La planilla de taller del mes ya está cerrada en el banco: esta prueba necesita una abierta.')
  taller =
    existente[0]?.id ??
    (await comoPuesto(CUENTAS.rrhh, `insert into planillas (tipo, periodo, registrado_por) values ('TALLER', $1, public.usuario_actual()) returning id`, [mes]))[0].id
  // Un «Excel» con Rosa y Tito; Zeta, a mano.
  const importacion = crypto.randomUUID()
  await comoPuesto(
    CUENTAS.rrhh,
    `insert into planilla_personas (planilla_id, nombre, documento, monto, registrado_por, importacion_id)
     values ($1, $2, $3, 1800, public.usuario_actual(), $6), ($1, $4, $5, 1700, public.usuario_actual(), $6)`,
    [taller, `${rosa.nombres} ${rosa.apellidos}`, rosa.dni, `${tito.nombres} ${tito.apellidos}`, tito.dni, importacion],
  )
  await comoPuesto(CUENTAS.rrhh, `insert into planilla_personas (planilla_id, nombre, monto, registrado_por) values ($1, $2, 900, public.usuario_actual())`, [taller, zeta])

  // La administrativa del mes pasado, cerrada por RR. HH.
  let [administrativa] = await consulta(`select id, estado from planillas where tipo = 'ADMINISTRATIVA' and periodo = $1`, [mesPasado])
  if (!administrativa) {
    ;[administrativa] = await comoPuesto(
      CUENTAS.rrhh,
      `insert into planillas (tipo, periodo, registrado_por) values ('ADMINISTRATIVA', $1, public.usuario_actual()) returning id, estado`,
      [mesPasado],
    )
  }
  if (administrativa.estado !== 'CERRADA') {
    await comoPuesto(
      CUENTAS.rrhh,
      `insert into planilla_personas (planilla_id, nombre, documento, monto, registrado_por) values ($1, $2, $3, 2500, public.usuario_actual())`,
      [administrativa.id, `${rosa.nombres} ${rosa.apellidos}`, rosa.dni],
    ).catch(() => {}) // una persona por mes entre las tres: si ya estaba de otra corrida, basta
    await comoPuesto(CUENTAS.rrhh, `select public.cerrar_planilla($1)`, [administrativa.id])
  }

  // Lo que dice la base, con el rol real de RR. HH.
  const faltas = await comoPuesto(CUENTAS.rrhh, `select clase, nombre from public.planilla_lo_que_falta($1)`, [taller])
  comprobar(faltas.some((f) => f.clase === 'REPORTE_SIN_VISTO' && f.nombre === `Planilla ${sello}`), 'la base lista el reporte del mes sin el visto de RR. HH.')
  comprobar(faltas.some((f) => f.clase === 'SIN_CUENTA' && f.nombre.startsWith(tito.nombres)), 'la base lista a Tito, sin cuenta')
  comprobar(faltas.some((f) => f.clase === 'SIN_FICHA' && f.nombre === zeta), 'la base lista a Zeta, sin ficha')
  comprobar(!faltas.some((f) => f.nombre?.startsWith(rosa.nombres)), 'Rosa, con cuenta, no falta')

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
    await pagina.goto(`${BASE}/rrhh`, { waitUntil: 'networkidle' })
    const tarjeta = pagina.locator(`[data-planilla="${taller}"]`)
    await tarjeta.waitFor({ timeout: 30000 })

    // Lo que falta, arriba de la tarjeta, plegado por clase.
    const falta = tarjeta.locator('[data-lo-que-falta]')
    comprobar((await falta.count()) === 1, `${ancho}: la planilla abierta dice lo que falta para cerrar`)
    const sinVisto = tarjeta.locator('[data-falta="REPORTE_SIN_VISTO"]')
    comprobar((await texto(sinVisto.locator('summary'))).includes('espera tu visto') || (await texto(sinVisto.locator('summary'))).includes('esperan tu visto'), `${ancho}: los reportes sin visto, con su cuenta`)
    for (const clase of ['REPORTE_SIN_VISTO', 'SIN_CUENTA', 'SIN_FICHA']) await tarjeta.locator(`[data-falta="${clase}"] summary`).click()
    comprobar((await texto(tarjeta.locator(`[data-falta="REPORTE_SIN_VISTO"] [data-reporte-que-falta="${reporte}"]`))).includes(`Planilla ${sello}`), `${ancho}: el reporte del mes aparece con su asunto`)
    comprobar(
      (await tarjeta.locator(`[data-falta="REPORTE_SIN_VISTO"] [data-reporte-que-falta="${reporte}"] [data-dias-en-espera]`).count()) === 1,
      `${ancho}: el reporte dice hace cuántos días espera`,
    )
    comprobar((await texto(tarjeta.locator('[data-falta="SIN_CUENTA"]'))).includes(tito.nombres), `${ancho}: Tito aparece sin cuenta`)
    comprobar(!(await texto(tarjeta.locator('[data-falta="SIN_CUENTA"]'))).includes(rosa.nombres), `${ancho}: Rosa no aparece sin cuenta`)
    comprobar((await texto(tarjeta.locator('[data-falta="SIN_FICHA"]'))).includes(zeta), `${ancho}: Zeta aparece sin ficha`)
    comprobar(!(await texto(falta)).includes(`191-3333${sello}`), `${ancho}: lo que falta no muestra ninguna cuenta`)
    const enlaceReportes = tarjeta.locator('[data-falta="REPORTE_SIN_VISTO"] a', { hasText: 'Darles el visto' })
    comprobar((await enlaceReportes.getAttribute('href'))?.includes(`/reportes-diarios?mes=${hoy.slice(0, 7)}&estado=por-validar`), `${ancho}: «Darles el visto» lleva a los reportes por validar del mes`)
    await falta.screenshot({ path: `${CAPTURAS}/13-3-lo-que-falta-rrhh-${ancho}.png` })

    // El recorrido, al pie: plegado dice quién la tiene; abierto, cada paso.
    const recorrido = tarjeta.locator('[data-recorrido]')
    comprobar((await texto(recorrido.locator('summary'))).includes('La tiene Recursos Humanos'), `${ancho}: plegado, el recorrido dice quién la tiene: «${await texto(recorrido.locator('summary'))}»`)
    await recorrido.locator('summary').click()
    const pasos = await recorrido.locator('[data-recorrido-paso]').evaluateAll((l) => l.map((e) => `${e.getAttribute('data-recorrido-paso')}:${e.getAttribute('data-situacion')}`))
    comprobar(pasos.join(',').endsWith('IMPORTACION:HECHO,A_MANO:HECHO,CIERRE:AHORA') && pasos[0] === 'CREADA:HECHO', `${ancho}: los pasos de la abierta: ${pasos.join(', ')}`)
    comprobar((await texto(recorrido.locator('[data-recorrido-paso="IMPORTACION"]').last())).includes('Entraron 2 personas'), `${ancho}: el Excel dice cuántas personas entraron`)
    comprobar((await texto(recorrido.locator('[data-recorrido-paso="CIERRE"]'))).includes('Revisa lo que falta y la cierra'), `${ancho}: el cierre dice qué se espera`)
    await tarjeta.screenshot({ path: `${CAPTURAS}/13-3-planilla-abierta-rrhh-${ancho}.png` })

    // La cerrada: sin lo que falta, sin botones, y su recorrido termina en el cierre.
    const cerrada = pagina.locator(`[data-planilla="${administrativa.id}"]`)
    comprobar((await cerrada.locator('[data-lo-que-falta]').count()) === 0, `${ancho}: a la cerrada no le falta nada`)
    comprobar((await cerrada.getByRole('button', { name: /Cerrar planilla|Importar|Quitar/ }).count()) === 0, `${ancho}: la cerrada no tiene con qué editarse`)
    await cerrada.locator('[data-recorrido] summary').click()
    const cierre = await texto(cerrada.locator('[data-recorrido-paso="CIERRE"]'))
    comprobar(cierre.includes('Cerrada') && cierre.includes('Recursos Humanos'), `${ancho}: la cerrada dice que la cerró Recursos Humanos: «${cierre}»`)
    if (ancho === 1440) await pagina.screenshot({ path: `${CAPTURAS}/13-3-planillas-rrhh-${ancho}.png`, fullPage: true })
    comprobar(errores.length === 0, `${ancho}: sin errores en la consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
    await contexto.close()
  }

  // Gerencia y Almacén no leen las planillas.
  for (const puesto of ['gerencia', 'almacen']) {
    const { pagina, contexto } = await entrar(CUENTAS[puesto], { width: 1440, height: 900 })
    await pagina.goto(`${BASE}/rrhh`, { waitUntil: 'networkidle' })
    comprobar(pagina.url().includes('/sin-permiso') || (await pagina.locator('[data-planilla]').count()) === 0, `${puesto} no abre Planillas (${pagina.url()})`)
    await contexto.close()
  }
  for (const puesto of ['gerencia', 'almacen']) {
    const negado = await comoPuesto(CUENTAS[puesto], `select * from public.planilla_lo_que_falta($1)`, [taller]).then(
      () => false,
      (e) => /permiso/.test(e.message),
    )
    comprobar(negado, `${puesto} no lee lo que falta por la API`)
  }
} catch (e) {
  fallas.push(`la prueba se cortó: ${e?.message ?? e}`)
  console.error(e)
} finally {
  await navegador?.close()
  const deshacer = (e) => fallas.push(`no se pudo deshacer lo sembrado: ${e?.message ?? e}`)
  if (taller) {
    for (const x of await consulta(`select id from planilla_personas where planilla_id = $1 and nombre like $2`, [taller, `%${sello}%`])) {
      await comoPuesto(CUENTAS.rrhh, `delete from planilla_personas where id = $1`, [x.id]).catch(deshacer)
    }
  }
  if (reporte) {
    await comoPuesto(CUENTAS.supervisor, `select public.anular_reporte_diario($1, 'Prueba del banco: se deja anulado al terminar')`, [reporte]).catch(deshacer)
    for (const t of await consulta(`select id from tareos where codigo_interno = $1 and anulado_en is null`, [CODIGO])) {
      await comoPuesto(CUENTAS.rrhh, `select public.rrhh_anular_tareo($1, 'Prueba del banco: se deja anulada al terminar')`, [t.id]).catch(deshacer)
    }
  }
  for (const t of [rosa, tito]) {
    if ((await consulta('select 1 from trabajadores where id = $1 and activo', [t.id])).length > 0) {
      await comoPuesto(CUENTAS.rrhh, `select public.rrhh_dar_de_baja_trabajador($1, $2::date)`, [t.id, hoy]).catch(deshacer)
    }
  }
  await base.end()
}

console.log(fallas.length ? `\n${fallas.length} fallas:\n- ${fallas.join('\n- ')}` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
