/**
 * Clic real sobre la migración 20261126300000: el recorrido del informe
 * semanal de Diseño (Plan 7, entrega 7.1). Con la cuenta de cada puesto, nunca
 * ADMIN:
 *
 *   1. El colaborador anota una actividad, guarda el contenido y envía el
 *      informe de esta semana: el recorrido dice que lo tiene Diseño.
 *   2. Diseño lo devuelve con su motivo.
 *   3. El colaborador abre la semana: el motivo va arriba de todo, el
 *      recorrido dice que lo tiene él y abierto muestra los mismos pasos que da
 *      la base con su sesión; la campana le trajo el aviso con el motivo; «Tus
 *      semanas» la lista como «Devuelto». Lo que la pantalla ya tenía sigue ahí.
 *   4. Lo vuelve a enviar y Diseño lo aprueba: ya no hay aviso de devolución,
 *      el recorrido termina en «Aprobado por Diseño» y conserva el motivo de la
 *      devolución, que la columna ya no tiene; la campana le avisa.
 *   5. Recursos Humanos no entra a la pantalla y la base le niega el recorrido.
 *   6. En el teléfono (390) nada se sale de la pantalla.
 *
 * Usa la semana actual: córrela sobre un banco recién preparado (preparar.sh),
 * porque un informe aprobado ya no vuelve atrás. Si la semana ya tiene informe,
 * lo dice y falla. Deja capturas en CAPTURAS, en 390 y 1440. Variables:
 * BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * BANCO_CHROMIUM, CAPTURAS.
 */
import { mkdirSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { conReact } from './con-react.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
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
const uno = async (sql, valores = []) => (await consulta(sql, valores))[0]

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const correoDe = (puesto) => `${puesto}.local@metalwork.test`

/** Lo que da la base con la sesión de esa cuenta y el rol authenticated, o el error que levanta. */
async function comoCuenta(puesto, sql, valores = []) {
  const cuenta = await uno('select id from public.usuarios where correo = $1', [correoDe(puesto)])
  if (!cuenta) throw new Error(`El banco no tiene la cuenta ${correoDe(puesto)}: corre preparar.sh.`)
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
      set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [cuenta.id])
    await base.query('set local role authenticated')
    return { filas: (await base.query(sql, valores)).rows, error: null }
  } catch (e) {
    return { filas: [], error: e.message }
  } finally {
    await base.query('rollback')
  }
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(puesto, ancho = 1440) {
  const correo = correoDe(puesto)
  const contexto = await navegador.newContext({
    viewport: ancho <= 480 ? { width: ancho, height: 844 } : { width: ancho, height: 900 },
    deviceScaleFactor: 2,
    hasTouch: ancho <= 480,
    isMobile: ancho <= 480,
    timezoneId: 'America/Lima',
  })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
  pagina.on('pageerror', (e) => errores.push(`${correo}: ${String(e).slice(0, 300)}`))
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  await pagina.waitForLoadState('networkidle')
  return { pagina, contexto }
}

async function ir(pagina, ruta) {
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
  await conReact(pagina)
}

/** Los pasos que pinta un recorrido abierto, en orden. */
const pasosEnPantalla = (recorrido) =>
  recorrido.locator('li[data-recorrido-paso]').evaluateAll((lis) =>
    lis.map((li) => ({ paso: li.dataset.recorridoPaso, situacion: li.dataset.situacion, texto: li.innerText.replace(/\s+/g, ' ').trim() })),
  )

/** Abre el recorrido de la pantalla y compara sus pasos con los que da la base a esa cuenta. */
async function recorridoComoLaBase(pagina, puesto, informeId, etiqueta) {
  const recorrido = pagina.locator('details[data-recorrido]').first()
  comprobar(await recorrido.count() === 1, `${etiqueta}: la semana trae «Recorrido»`)
  if (!(await recorrido.evaluate((d) => d.open))) await recorrido.locator('summary').click()
  const enPantalla = await pasosEnPantalla(recorrido)
  const { filas, error } = await comoCuenta(puesto,
    'select paso, situacion, puesto from public.recorrido_de_informes_diseno(array[$1::uuid]) order by orden', [informeId])
  comprobar(!error, `${etiqueta}: la base le da el recorrido a ${puesto}${error ? ` (${error})` : ''}`)
  comprobar(
    JSON.stringify(enPantalla.map((p) => `${p.paso}:${p.situacion}`)) === JSON.stringify(filas.map((f) => `${f.paso}:${f.situacion}`)),
    `${etiqueta}: los pasos en pantalla son los de la base (${enPantalla.map((p) => `${p.paso}:${p.situacion}`).join(' > ')})`,
  )
  return enPantalla
}

const semana = (await uno(`select to_char(d - ((extract(isodow from d)::int + 6) % 7), 'YYYY-MM-DD') as s
                             from (select (now() at time zone 'America/Lima')::date as d) x`)).s
const ruta = `/diseno/informe-semanal?semana=${semana}`
// El puesto de cada cuenta como lo dice la base (su cargo o, sin él, su rol).
const puestoDe = async (p) => (await uno('select public.puesto(u) as p from public.usuarios u where correo = $1', [correoDe(p)])).p
const PUESTO_COLAB = await puestoDe('colaborador')
const PUESTO_DISENO = (await uno(`select nombre from public.roles where codigo = 'DISENO'`)).nombre
const PUESTO_DISENO_CUENTA = await puestoDe('diseno')
const MOTIVO = 'Falta anotar el ploteo del martes y el plano de corte de la tolva.'

// 0. El armazón: una OT con un colaborador de Diseño en su equipo, como lo
//    deja Diseño en la pestaña Planos. La semana tiene que estar libre.
if (await uno('select 1 from public.diseno_informes where semana_inicio = $1', [semana])) {
  console.error(`La semana del ${semana} ya tiene informe en el banco: corre preparar.sh y vuelve a probar.`)
  process.exit(1)
}
const orden = await uno(`select o.id, o.numero from public.ordenes_trabajo o
                          where o.estado not in ('ANULADA', 'TERMINADA', 'ENTREGADA') order by o.creado_en limit 1`)
if (!orden) throw new Error('El banco no tiene una OT abierta.')
let integrante = await uno(`select id from public.ot_equipo_diseno where orden_id = $1 and funcion = 'COLABORADOR' limit 1`, [orden.id])
if (!integrante) {
  integrante = await uno(`insert into public.ot_equipo_diseno (orden_id, nombre, funcion) values ($1, 'Colaborador del banco', 'COLABORADOR') returning id`, [orden.id])
}

// 1. El colaborador anota, guarda y envía.
const colab = await entrar('colaborador')
await ir(colab.pagina, ruta)
await colab.pagina.selectOption('#tarea-ot', orden.id)
await colab.pagina.selectOption('#tarea-persona', integrante.id)
await colab.pagina.selectOption('#tarea-tipo', 'PLOTEO')
await colab.pagina.fill('#tarea-componente', 'Ploteo de la tolva granelera')
await colab.pagina.getByRole('button', { name: 'Anotar actividad' }).click()
await colab.pagina.getByRole('status').filter({ hasText: /anot|registr/i }).first().waitFor({ timeout: 15000 }).catch(() => {})
comprobar(Boolean(await uno(`select 1 from public.diseno_tareas where orden_id = $1 and componente = 'Ploteo de la tolva granelera'`, [orden.id])),
  'el colaborador anota una actividad de la semana')

await colab.pagina.fill('#inf-resumen', 'Avance de modelado y ploteo de la tolva granelera de la semana.')
await colab.pagina.getByRole('button', { name: 'Guardar informe' }).click()
const informe = await (async () => {
  for (let i = 0; i < 30; i++) {
    const f = await uno('select id, numero from public.diseno_informes where semana_inicio = $1', [semana])
    if (f) return f
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
})()
comprobar(Boolean(informe), 'el colaborador guarda el contenido del informe')
if (!informe) throw new Error('Sin informe no hay recorrido que probar.')

await ir(colab.pagina, ruta)
const ahoraBorrador = limpio(await colab.pagina.locator('[data-recorrido-ahora]').first().innerText())
comprobar(ahoraBorrador.includes(`Lo tiene ${PUESTO_COLAB}`), `en borrador, cerrado dice que lo tiene el colaborador («${ahoraBorrador}»)`)
await colab.pagina.getByRole('button', { name: 'Enviar a Diseño' }).click()
await colab.pagina.waitForFunction(() => document.body.innerText.includes('Pendiente de revisión de Diseño'), null, { timeout: 15000 }).catch(() => {})
await ir(colab.pagina, ruta)
const ahoraEnviado = limpio(await colab.pagina.locator('[data-recorrido-ahora]').first().innerText())
comprobar(ahoraEnviado.includes(`Lo tiene ${PUESTO_DISENO}`) && /desde hoy/.test(ahoraEnviado), `enviado, lo tiene Diseño desde hoy («${ahoraEnviado}»)`)

// 2. Diseño lo devuelve con su motivo.
const diseno = await entrar('diseno')
await ir(diseno.pagina, ruta)
comprobar(await diseno.pagina.locator('[data-recorrido]').count() === 1, 'Diseño también ve el recorrido de la semana')
await diseno.pagina.getByText('Devolver con observaciones', { exact: true }).first().click()
await diseno.pagina.fill('#revision-inf', MOTIVO)
await diseno.pagina.getByRole('button', { name: 'Devolver con observaciones' }).click()
await diseno.pagina.waitForFunction(() => document.querySelector('[data-motivo-devolucion]'), null, { timeout: 15000 }).catch(() => {})
comprobar((await uno('select estado from public.diseno_informes where id = $1', [informe.id])).estado === 'OBSERVADO', 'Diseño devuelve el informe')
await ir(diseno.pagina, ruta)
const avisoDiseno = limpio(await diseno.pagina.locator('[data-motivo-devolucion]').innerText().catch(() => ''))
comprobar(avisoDiseno.startsWith('Devuelto al colaborador para corregir') && avisoDiseno.includes(MOTIVO), 'Diseño ve arriba el motivo que dejó, dicho desde su lado')

// 3. El colaborador ve el motivo arriba, el recorrido y el aviso.
for (const ancho of [390, 1440]) {
  const c = ancho === 1440 ? colab : await entrar('colaborador', ancho)
  await ir(c.pagina, ruta)
  const aviso = c.pagina.locator('[data-motivo-devolucion]')
  const texto = limpio(await aviso.innerText().catch(() => ''))
  comprobar(texto.startsWith('Diseño te devolvió este informe para corregir') && texto.includes(MOTIVO) && texto.includes(PUESTO_DISENO_CUENTA),
    `${ancho}: el motivo va arriba, con quién lo devolvió («${texto.slice(0, 90)}…»)`)
  // Lo primero del cuerpo de la pantalla, debajo del encabezado y antes de toda tarjeta.
  const arriba = await aviso.evaluate((el) => el.parentElement?.firstElementChild === el)
  comprobar(arriba, `${ancho}: el aviso es lo primero de la pantalla, antes de las tarjetas`)
  const ahora = limpio(await c.pagina.locator('[data-recorrido-ahora]').first().innerText())
  comprobar(ahora.includes(`Lo tiene ${PUESTO_COLAB}`), `${ancho}: cerrado, el recorrido dice que lo tiene el colaborador («${ahora}»)`)
  const pasos = await recorridoComoLaBase(c.pagina, 'colaborador', informe.id, `${ancho}, devuelto`)
  const devolucion = pasos.find((p) => p.paso === 'DEVOLUCION')
  comprobar(Boolean(devolucion?.texto.includes(MOTIVO)), `${ancho}: el paso de la devolución dice el motivo`)
  comprobar(!pasos.some((p) => /Colaborador del banco|Local/.test(p.texto)), `${ancho}: ningún paso dice el nombre de la persona`)
  const semanas = limpio(await c.pagina.locator('[data-tus-semanas]').innerText().catch(() => ''))
  comprobar(semanas.includes(`semana del ${semana.split('-').reverse().join('/')}`) && semanas.includes('Devuelto'), `${ancho}: «Tus semanas» la lista como devuelta`)
  for (const t of ['Semana del informe', 'Actividades diarias', 'Contenido del informe', 'Descargar Word', 'Enviar a Diseño', 'Ploteo de la tolva granelera']) {
    comprobar(await c.pagina.getByText(t, { exact: false }).count() > 0, `${ancho}: la pantalla conserva «${t}»`)
  }
  const sobra = await c.pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  comprobar(sobra <= 0, `${ancho}: nada se sale de la pantalla (sobran ${sobra} px)`)
  await c.pagina.screenshot({ path: `${CAPTURAS}/7-1-colaborador-${ancho}-1-devuelto.png`, fullPage: true })
  if (ancho === 390) await c.contexto.close()
}
const avisoCampana = await comoCuenta('colaborador',
  `select titulo, cuerpo, ruta from public.notificaciones where usuario_id = public.usuario_actual() and origen_id = $1 order by creado_en desc limit 1`,
  [informe.id])
const n = String(informe.numero).padStart(3, '0')
comprobar(avisoCampana.filas[0]?.titulo === 'Informe de Diseño devuelto para corregir'
  && avisoCampana.filas[0]?.cuerpo.startsWith(`Informe N.º ${n} · semana del `) && avisoCampana.filas[0]?.cuerpo.includes(`Motivo: ${MOTIVO}`)
  && avisoCampana.filas[0]?.ruta === ruta, `la campana le avisó con el motivo («${avisoCampana.filas[0]?.cuerpo}»)`)
await ir(colab.pagina, '/avisos')
comprobar((await colab.pagina.getByText(`Motivo: ${MOTIVO}`).count()) > 0, 'en Avisos se lee el motivo de la devolución')

// 4. Lo reenvía y Diseño lo aprueba.
await ir(colab.pagina, ruta)
await colab.pagina.getByRole('button', { name: 'Enviar a Diseño' }).click()
await colab.pagina.waitForFunction(() => !document.querySelector('[data-motivo-devolucion]'), null, { timeout: 15000 }).catch(() => {})
await ir(diseno.pagina, ruta)
await diseno.pagina.getByRole('button', { name: 'Aprobar informe' }).click()
await diseno.pagina.waitForFunction(() => document.body.innerText.includes('Aprobado por Diseño'), null, { timeout: 15000 }).catch(() => {})
comprobar((await uno('select estado, observacion_revision from public.diseno_informes where id = $1', [informe.id])).estado === 'APROBADO', 'Diseño aprueba el informe reenviado')

for (const ancho of [390, 1440]) {
  const c = ancho === 1440 ? colab : await entrar('colaborador', ancho)
  await ir(c.pagina, ruta)
  comprobar(await c.pagina.locator('[data-motivo-devolucion]').count() === 0, `${ancho}: aprobado, ya no hay aviso de devolución`)
  const pasos = await recorridoComoLaBase(c.pagina, 'colaborador', informe.id, `${ancho}, aprobado`)
  comprobar(pasos.map((p) => p.paso).join(' > ') === 'REGISTRO > ENVIO > DEVOLUCION > ENVIO > APROBACION',
    `${ancho}: las dos vueltas en orden, hasta la aprobación`)
  comprobar(Boolean(pasos.find((p) => p.paso === 'DEVOLUCION')?.texto.includes(MOTIVO)), `${ancho}: el motivo sigue en el recorrido aunque la columna ya no lo tenga`)
  comprobar(pasos.every((p) => p.situacion === 'HECHO'), `${ancho}: aprobado, ya no espera a nadie`)
  const semanas = limpio(await c.pagina.locator('[data-tus-semanas]').innerText().catch(() => ''))
  comprobar(semanas.includes('Aprobado'), `${ancho}: «Tus semanas» la lista como aprobada`)
  comprobar(await c.pagina.getByRole('button', { name: 'Guardar informe' }).count() === 0, `${ancho}: aprobada, la semana se lee y no se edita`)
  const sobra = await c.pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  comprobar(sobra <= 0, `${ancho}: nada se sale de la pantalla (sobran ${sobra} px)`)
  await c.pagina.screenshot({ path: `${CAPTURAS}/7-1-colaborador-${ancho}-2-aprobado.png`, fullPage: true })
  if (ancho === 390) await c.contexto.close()
}
const aprobado = await comoCuenta('colaborador',
  `select titulo, cuerpo from public.notificaciones where usuario_id = public.usuario_actual() and origen_id = $1 order by creado_en desc limit 1`, [informe.id])
comprobar(aprobado.filas[0]?.titulo === 'Informe de Diseño aprobado', 'la campana le avisa que Diseño lo aprobó')

// 5. Recursos Humanos no entra.
const rrhh = await entrar('rrhh')
await rrhh.pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
comprobar(rrhh.pagina.url().includes('/sin-permiso'), 'Recursos Humanos no entra al informe semanal')
const negado = await comoCuenta('rrhh', 'select * from public.recorrido_de_informes_diseno(array[$1::uuid])', [informe.id])
comprobar(Boolean(negado.error?.includes('No tienes permiso')), 'la base le niega el recorrido a Recursos Humanos')

comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
await navegador.close()
await base.end()
if (fallas.length) {
  console.error(`\n${fallas.length} comprobación(es) fallaron.`)
  process.exit(1)
}
console.log('\nTodo bien: el recorrido del informe, el motivo arriba, el aviso y tus semanas.')
