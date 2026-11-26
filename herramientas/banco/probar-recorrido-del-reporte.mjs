/**
 * Clic real sobre la migración 20261126331000 (Plan 1, entrega 1.1): el
 * supervisor sabe desde el teléfono qué pasó con su reporte diario. Con la
 * cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Arma, en el banco y sin disparadores, tres reportes del supervisor de
 *      Maestranza: uno recién subido, uno con el visto de RR. HH. y otro
 *      validado. Gerencia de Producción observa uno de verdad, con su función.
 *   2. Al supervisor de Maestranza le llega el aviso por la campana.
 *   3. En /reportes-diarios ve arriba «observados por corregir» con el área que
 *      lo observó, hace cuántos días y el motivo; «Corregir y subir de nuevo»
 *      abre el formulario de corrección de ese reporte.
 *   4. Cada reporte de la lista dice quién lo tiene y hace cuántos días, lo
 *      mismo que da la base con su sesión; abierto, cada paso con su puesto.
 *      El detalle también lo lleva.
 *   5. El supervisor de Acabados y el de Producción no ven los reportes de
 *      Maestranza ni su recorrido; Gerencia de Producción y RR. HH. sí.
 *   6. En el teléfono (390) nada se sale de la pantalla. Capturas en 390 y 1440.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * BANCO_CHROMIUM, CAPTURAS.
 */
import { randomUUID } from 'node:crypto'
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

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const haceDias = (d) => (d <= 0 ? 'desde hoy' : d === 1 ? 'hace 1 día' : `hace ${d} días`)
const correoDe = (puesto) => `${puesto}.local@metalwork.test`

/** Lo que da la base con la sesión de esa cuenta y el rol authenticated. */
async function comoCuenta(puesto, sql, valores = []) {
  const [cuenta] = await consulta('select id from public.usuarios where correo = $1', [correoDe(puesto)])
  if (!cuenta) throw new Error(`El banco no tiene la cuenta ${correoDe(puesto)}: corre preparar.sh.`)
  await base.query('begin')
  try {
    await base.query(
      `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
      set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
      [cuenta.id],
    )
    await base.query('set local role authenticated')
    const filas = (await base.query(sql, valores)).rows
    await base.query('commit')
    return filas
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(puesto, ancho = 1440) {
  const correo = correoDe(puesto)
  const telefono = ancho <= 480
  const contexto = await navegador.newContext({
    viewport: { width: ancho, height: telefono ? 844 : 900 },
    deviceScaleFactor: 2,
    hasTouch: telefono,
    isMobile: telefono,
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

/** La pantalla entera, sin la marca de `next dev`. */
async function capturar(pagina, archivo) {
  await pagina.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
  const ventana = pagina.viewportSize()
  const alto = await pagina.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
  await pagina.setViewportSize({ width: ventana.width, height: Math.max(alto, ventana.height) })
  await pagina.evaluate(() => window.scrollTo(0, 0))
  await pagina.screenshot({ path: `${CAPTURAS}/${archivo}` })
  await pagina.setViewportSize(ventana)
}

async function sinDesborde(pagina, donde) {
  const sobra = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  comprobar(sobra <= 0, `${donde}: nada se sale de la pantalla (sobran ${sobra} px)`)
}

// ------------------------------------------------ armazón: tres reportes del supervisor de Maestranza
const sello = `QA ${Date.now().toString(36).toUpperCase()}`
const [mtz] = await consulta(`select id, area_id from public.usuarios where correo = $1`, [correoDe('sup.mtz')])
const [rrhh] = await consulta(`select id from public.usuarios where correo = $1`, [correoDe('rrhh')])
const [gpr] = await consulta(`select id from public.usuarios where correo = $1`, [correoDe('gerencia.produccion')])
if (!mtz || !rrhh || !gpr) throw new Error('Faltan cuentas del banco: corre preparar.sh.')
const ids = { observado: randomUUID(), faltaGerencia: randomUUID(), validado: randomUUID() }
const asuntos = {
  observado: `${sello} Armado del piso`,
  faltaGerencia: `${sello} Soldadura de parantes`,
  validado: `${sello} Forrado de techo`,
}
await base.query('begin')
await base.query(`set local session_replication_role = replica`)
for (const [clave, dias, vrrhh, vger] of [
  ['observado', 2, null, null],
  ['faltaGerencia', 1, rrhh.id, null],
  ['validado', 3, rrhh.id, gpr.id],
]) {
  await base.query(
    `insert into public.reportes_diarios (id, fecha, codigo_interno, asunto, descripcion, area_id, registrado_por, creado_en,
                                          visto_rrhh_por, visto_rrhh_en, visto_gerencia_por, visto_gerencia_en)
     values ($1, ((now() - make_interval(days => $2)) at time zone 'America/Lima')::date, 'PLANTA', $3, 'Prueba del recorrido', $4, $5,
             now() - make_interval(days => $2), $6::uuid, case when $6::uuid is not null then now() - make_interval(days => $2) + interval '1 hour' end,
             $7::uuid, case when $7::uuid is not null then now() - make_interval(days => $2) + interval '2 hours' end)`,
    [ids[clave], dias, asuntos[clave], mtz.area_id, mtz.id, vrrhh, vger],
  )
  await base.query(
    `insert into public.reporte_diario_trabajos (reporte_id, orden, descripcion, avance) values ($1, 1, 'Trabajo de prueba', 40)`,
    [ids[clave]],
  )
}
await base.query('commit')

// Gerencia de Producción observa con su función, como en la pantalla: así sale el aviso.
const motivo = 'Falta la foto del piso armado y el avance no cuadra.'
await comoCuenta('gerencia.produccion', `select public.observar_reporte_diario($1, 'GERENCIA', $2)`, [ids.observado, motivo])

// ------------------------------------------------ 2. el aviso por la campana
const avisos = await comoCuenta('sup.mtz', `select titulo, ruta from public.notificaciones where origen_id = $1`, [ids.observado])
comprobar(
  avisos.length === 1 && avisos[0].titulo.startsWith('Reporte observado por Gerencia') && avisos[0].ruta === `/reportes-diarios/${ids.observado}`,
  `al supervisor le llega el aviso por la campana: «${avisos[0]?.titulo ?? '(nada)'}»`,
)

// Lo que da la base con la sesión del supervisor, para comparar con la pantalla.
const ahora = Object.fromEntries(
  await Promise.all(
    Object.entries(ids).map(async ([clave, id]) => {
      const filas = await comoCuenta('sup.mtz', `select puesto, dias from public.recorrido_de_reportes_diarios(array[$1::uuid]) where situacion = 'AHORA'`, [id])
      return [clave, filas[0] ?? null]
    }),
  ),
)
comprobar(ahora.observado?.dias === 0 && ahora.faltaGerencia?.puesto === 'Gerencia' && ahora.faltaGerencia?.dias === 1 && ahora.validado === null,
  `la base: el observado lo tiene quien lo subió desde hoy, el otro Gerencia hace 1 día, el validado nadie`)

// ------------------------------------------------ 3 y 4. el supervisor de Maestranza, en el teléfono y en el monitor
for (const ancho of [390, 1440]) {
  const { pagina, contexto } = await entrar('sup.mtz', ancho)
  await ir(pagina, '/avisos')
  comprobar((await pagina.getByText(`Reporte observado por Gerencia: ${asuntos.observado}`).count()) >= 1, `${ancho}: el aviso está en Avisos`)

  await ir(pagina, '/reportes-diarios')
  const bandeja = pagina.locator('[data-observados-por-corregir]')
  const observado = bandeja.locator(`[data-observado="${ids.observado}"]`)
  comprobar((await observado.count()) === 1, `${ancho}: arriba, «observados por corregir» trae el reporte observado`)
  const textoBandeja = limpio(await observado.innerText().catch(() => ''))
  comprobar(textoBandeja.includes('Observado por Gerencia') && textoBandeja.includes(motivo) && textoBandeja.includes(haceDias(ahora.observado?.dias ?? -1)),
    `${ancho}: dice qué área lo observó, hace cuánto y el motivo: «${textoBandeja.slice(0, 160)}»`)
  // Va antes que la lista del mes.
  const arriba = await pagina.evaluate(() => {
    const b = document.querySelector('[data-observados-por-corregir]')
    const l = document.querySelector('[data-reporte]')
    return Boolean(b && l && b.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  comprobar(arriba, `${ancho}: la bandeja va arriba de la lista del mes`)

  for (const [clave, id] of Object.entries(ids)) {
    const tarjeta = pagina.locator(`[data-reporte="${id}"]`)
    const resumen = limpio(await tarjeta.locator('[data-recorrido] summary').innerText().catch(() => ''))
    const espera = ahora[clave]
    if (espera) {
      comprobar(resumen.includes(`Lo ${espera.espera === 'VALIDACION' ? 'tienen' : 'tiene'} ${espera.puesto}`) && resumen.includes(haceDias(espera.dias)),
        `${ancho}: «${asuntos[clave].slice(sello.length + 1)}» dice quién lo tiene y hace cuánto, como la base: «${resumen}»`)
    } else {
      comprobar(resumen.includes('Validado'), `${ancho}: el validado dice su último paso: «${resumen}»`)
    }
  }
  // Abierto, cada paso con su puesto.
  const faltaGerencia = pagina.locator(`[data-reporte="${ids.faltaGerencia}"] [data-recorrido]`)
  await faltaGerencia.locator('summary').click()
  const pasos = await faltaGerencia.locator('[data-recorrido-paso]').evaluateAll((es) => es.map((e) => `${e.dataset.recorridoPaso}:${e.dataset.situacion}`))
  comprobar(pasos.join(' > ') === 'ENVIO:HECHO > VISTO_RRHH:HECHO > VISTO_GERENCIA:AHORA', `${ancho}: abierto, los pasos en orden: ${pasos.join(' > ')}`)
  const textoPasos = limpio(await faltaGerencia.innerText())
  comprobar(textoPasos.includes('Visto bueno de Recursos Humanos') && textoPasos.includes('Recursos Humanos'),
    `${ancho}: cada paso dice quién lo dio`)
  await sinDesborde(pagina, `${ancho} /reportes-diarios`)
  await capturar(pagina, `1-1-supervisor-${ancho}-1-reportes.png`)

  // «Corregir y subir de nuevo» abre la corrección de ese reporte.
  await observado.getByRole('link', { name: 'Corregir y subir de nuevo' }).click()
  await pagina.waitForURL((u) => u.pathname === '/reportes-diarios/nuevo', { timeout: 30000 }).catch(() => {})
  comprobar(pagina.url().endsWith(`/reportes-diarios/nuevo?corrige=${ids.observado}`), `${ancho}: «Corregir y subir de nuevo» abre su corrección`)

  // El detalle también lleva el recorrido.
  await ir(pagina, `/reportes-diarios/${ids.observado}`)
  const detalle = pagina.locator('[data-recorrido]')
  comprobar((await detalle.count()) === 1, `${ancho}: el detalle lleva el recorrido`)
  await detalle.locator('summary').click()
  const pasosDetalle = await detalle.locator('[data-recorrido-paso]').evaluateAll((es) => es.map((e) => `${e.dataset.recorridoPaso}:${e.dataset.situacion}`))
  comprobar(pasosDetalle.join(' > ') === 'ENVIO:HECHO > OBSERVACION:HECHO > CORRECCION:AHORA > VALIDACION:PENDIENTE',
    `${ancho}: el observado, en el detalle: ${pasosDetalle.join(' > ')}`)
  await sinDesborde(pagina, `${ancho} detalle`)
  await capturar(pagina, `1-1-supervisor-${ancho}-2-detalle-observado.png`)
  await contexto.close()
}

// ------------------------------------------------ 5. quién ve qué
for (const puesto of ['sup.acb', 'sup.prd']) {
  const { pagina, contexto } = await entrar(puesto, 390)
  await ir(pagina, '/reportes-diarios')
  comprobar((await pagina.getByText(sello).count()) === 0, `${puesto}: no ve los reportes de Maestranza`)
  const filas = await comoCuenta(puesto, `select count(*)::int as n from public.recorrido_de_reportes_diarios($1::uuid[])`, [Object.values(ids)])
  comprobar(filas[0].n === 0, `${puesto}: la base no le da su recorrido`)
  await contexto.close()
}
for (const puesto of ['gerencia.produccion', 'rrhh']) {
  const { pagina, contexto } = await entrar(puesto, 1440)
  await ir(pagina, '/reportes-diarios')
  const tarjeta = pagina.locator(`[data-reporte="${ids.faltaGerencia}"]`)
  comprobar((await tarjeta.locator('[data-recorrido]').count()) === 1, `${puesto}: ve el reporte con su recorrido`)
  comprobar((await pagina.locator('[data-observados-por-corregir]').count()) === 0, `${puesto}: no tiene bandeja de observados (no sube reportes)`)
  await contexto.close()
}

await navegador.close()
await base.end()

comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.slice(0, 3).join(' | ')}` : ''}`)
if (fallas.length) {
  console.error(`\n${fallas.length} comprobación(es) fallaron.`)
  process.exit(1)
}
console.log(`\nTodo en orden. Capturas en ${CAPTURAS}`)
