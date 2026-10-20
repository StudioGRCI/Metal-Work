/**
 * Recorre con clic real el camino del reporte diario a la planilla diaria, con
 * la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. El supervisor de Maestranza, en el celular, sube dos reportes: en el
 *      primero Elena trabaja 10 h y Mario 6 h; en el segundo Mario 4 h más,
 *      con una foto.
 *   2. Gerencia da su visto bueno al primero y observa el segundo; no tiene
 *      los botones de Recursos Humanos.
 *   3. El supervisor ve el observado, lo corrige (se abre con lo escrito y la
 *      foto) y lo sube de nuevo con 3 h; el observado queda anulado y enlazado.
 *   4. RR. HH. valida el corregido y el primero; Gerencia, el corregido. Los
 *      dos quedan validados, cada uno en otro orden.
 *   5. RR. HH. ve las horas extras de cada uno (Elena 2 h, Mario 1 h), paga las
 *      de Elena y reserva las de Mario, que usa media hora de su saldo.
 *   6. RR. HH. arma la planilla diaria y la manda a Tesorería: 8 h ordinarias a
 *      cada uno y las 2 h extras de Elena con 25 %.
 *   7. Tesorería ve la cuenta de cada persona, registra el pago en lote con su
 *      comprobante y adjunta la boleta de cada una.
 *   8. RR. HH. marca las boletas como entregadas.
 *   9. Gerencia consulta sin cuentas ni botones; la portería, el supervisor y
 *      Tesorería no entran a lo que no es suyo.
 *
 * Necesita en la base del banco las cuentas `*.local@metalwork.test` de cada
 * puesto (supervisores con su área). El personal lo crea el script, inventado
 * y distinto en cada corrida. Variables: BANCO_CLAVE, BASE
 * (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { crearCajaDePrueba, elegirCuenta, movimientosDeLaCaja } from './caja-de-prueba.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  mtz: process.env.SUPERVISOR_MTZ ?? 'sup.mtz.local@metalwork.test',
  rrhh: process.env.RRHH ?? 'rrhh.local@metalwork.test',
  gerencia: process.env.GERENCIA ?? 'gerencia.local@metalwork.test',
  tesoreria: process.env.TESORERIA ?? 'tesoreria.local@metalwork.test',
  porteria: process.env.PORTERIA ?? 'porteria.local@metalwork.test',
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

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const CELULAR = { width: 390, height: 844 }

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, timezoneId: 'America/Lima' })
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

/** Elige a una persona en el `SeleccionBuscable` cuyo nombre accesible se da. */
async function elegirPersona(pagina, etiqueta, texto) {
  await pagina.getByRole('combobox', { name: etiqueta }).click()
  await pagina.keyboard.type(texto)
  await pagina.getByRole('option', { name: new RegExp(texto) }).first().click()
}

/** Espera a que la ventana abierta se cierre (la acción salió bien) o muestre su error. */
async function esperarVentana(pagina) {
  const v = pagina.locator('[role="dialog"]')
  await Promise.race([
    v.waitFor({ state: 'hidden', timeout: 30000 }),
    v.locator('[role="alert"]').waitFor({ timeout: 30000 }),
  ]).catch(() => {})
  const error = limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
  return error
}

// ------------------------------------------------- archivos de prueba
const archivos = join(CAPTURAS, 'archivos-planilla')
mkdirSync(archivos, { recursive: true })
{
  const p = await (await navegador.newContext()).newPage()
  const foto = await p.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 1600
    c.height = 1100
    const g = c.getContext('2d')
    const d = g.createLinearGradient(0, 0, 1600, 1100)
    d.addColorStop(0, '#7a4b2a')
    d.addColorStop(1, '#3a3f44')
    g.fillStyle = d
    g.fillRect(0, 0, 1600, 1100)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
    const b = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return btoa(s)
  })
  writeFileSync(join(archivos, 'pintura.jpg'), Buffer.from(foto, 'base64'))
  // Un PDF de una hoja, inventado: el comprobante y las boletas.
  const pdf = await p.pdf({ format: 'A5' }).catch(() => null)
  const minimo = Buffer.from(
    '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  )
  writeFileSync(join(archivos, 'comprobante.pdf'), pdf ?? minimo)
  writeFileSync(join(archivos, 'boleta.pdf'), pdf ?? minimo)
  await p.context().close()
}

const inicio = new Date()
const sello = Date.now().toString().slice(-5)
// El pago pide la cuenta de la caja de la que salió (migración 20261019100000).
const caja = await crearCajaDePrueba(consulta, CUENTAS.tesoreria)
const codigo = `PRB_SR_O4_1_26/${sello.slice(-2)}`
const asuntoA = `Tolva de volquete ${sello}`
const asuntoB = `Pintura del chasis ${sello}`
const [elena, mario] = [`Elena ${sello}`, `Mario ${sello}`]
const cuentaElena = `191-${sello}-0-11`
const cuentaMario = `191-${sello}-0-22`

// El personal de Maestranza, como lo dejaría RR. HH.: cada uno con su costo
// para el costeo, su remuneración para la planilla (S/ 2,400 y S/ 1,800: S/ 10
// y S/ 7.50 la hora) y su cuenta.
await consulta(
  `with nuevos as (
     insert into trabajadores (nombres, apellidos, dni, cargo, area_id, creado_por)
     select t.nombres, t.apellidos, t.dni, t.cargo, (select id from areas where codigo = 'MTZ'),
            (select id from usuarios where correo = $3)
       from (values ($1, 'Prueba Soldadura', '6' || $4 || '01', 'Soldadora'),
                    ($2, 'Prueba Pintura',   '6' || $4 || '02', 'Pintor')) as t(nombres, apellidos, dni, cargo)
     returning id, nombres),
   costos as (
     insert into trabajador_costos (trabajador_id, costo_mensual)
     select id, case when nombres = $1 then 3000 else 2250 end from nuevos returning trabajador_id),
   remuneraciones as (
     insert into trabajador_remuneraciones (trabajador_id, remuneracion_mensual)
     select id, case when nombres = $1 then 2400 else 1800 end from nuevos returning trabajador_id)
   insert into trabajador_cuentas (trabajador_id, banco, tipo_cuenta, numero_cuenta)
   select id, 'Banco de Pruebas', 'SUELDO', case when nombres = $1 then $5 else $6 end from nuevos`,
  [elena, mario, CUENTAS.rrhh, sello, cuentaElena, cuentaMario],
)
const ids = Object.fromEntries(
  (await consulta(`select nombres, id from trabajadores where nombres = any($1)`, [[elena, mario]])).map((t) => [t.nombres, t.id]),
)

let idA = null
let idB = null
let idB2 = null
let idPlanilla = null
let numeroPlanilla = null

// ------------------------------------- 1. el supervisor sube dos reportes
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.mtz, CELULAR)

  await pagina.goto(`${BASE}/reportes-diarios/nuevo`, { waitUntil: 'networkidle' })
  await pagina.fill('#rd-codigo', codigo)
  await pagina.fill('#rd-asunto', asuntoA)
  await pagina.fill('#rd-descripcion', 'Se soldó la tolva completa; queda listo para pintar.')
  const t1 = pagina.locator('fieldset[data-trabajo="1"]')
  await elegirPersona(pagina, 'Trabajo 1: sobre qué', 'Tarea nueva')
  await t1.locator('textarea').fill('Soldadura de la tolva')
  await t1.locator('input[type="number"]').first().fill('80')
  await elegirPersona(pagina, 'Personal del trabajo 1: persona 1', elena)
  await pagina.getByRole('spinbutton', { name: 'Personal del trabajo 1: horas de la persona 1' }).fill('10')
  await t1.getByRole('button', { name: 'Agregar persona' }).click()
  await elegirPersona(pagina, 'Personal del trabajo 1: persona 2', mario)
  await pagina.getByRole('spinbutton', { name: 'Personal del trabajo 1: horas de la persona 2' }).fill('6')
  await pagina.getByRole('button', { name: 'Subir reporte' }).click()
  await pagina.waitForURL(/\/reportes-diarios\/[0-9a-f-]{36}\?subido=1/, { timeout: 30000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  idA = pagina.url().match(/reportes-diarios\/([0-9a-f-]{36})/)?.[1] ?? null
  comprobar(Boolean(idA), 'sube el primer reporte')
  const aviso = limpio(await pagina.locator('[role="status"]').textContent().catch(() => ''))
  comprobar(aviso.includes('Gerencia y Recursos Humanos lo validan'), `al subir avisa que lo validan Gerencia y RR. HH. (${aviso.slice(0, 90)}…)`)
  const validacion = limpio(await pagina.locator('[data-lado]').allTextContents().then((t) => t.join(' | ')))
  comprobar(
    (validacion.match(/Falta su visto bueno/g) ?? []).length === 2 && (await pagina.locator('[data-validar], [data-observar]').count()) === 0,
    `el supervisor ve que faltan los dos vistos, sin botones para darlos (${validacion})`,
  )

  await pagina.goto(`${BASE}/reportes-diarios/nuevo`, { waitUntil: 'networkidle' })
  await pagina.fill('#rd-codigo', codigo)
  await pagina.fill('#rd-asunto', asuntoB)
  await pagina.fill('#rd-descripcion', 'Base anticorrosiva del chasis.')
  const u1 = pagina.locator('fieldset[data-trabajo="1"]')
  await elegirPersona(pagina, 'Trabajo 1: sobre qué', 'Tarea nueva')
  await u1.locator('textarea').fill('Pintura de base del chasis')
  await u1.locator('input[type="number"]').first().fill('30')
  await elegirPersona(pagina, 'Personal del trabajo 1: persona 1', mario)
  await pagina.getByRole('spinbutton', { name: 'Personal del trabajo 1: horas de la persona 1' }).fill('4')
  await pagina.locator('input[type="file"]:not([capture])').setInputFiles(join(archivos, 'pintura.jpg'))
  await pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })
  await pagina.getByRole('button', { name: 'Subir reporte' }).click()
  await pagina.waitForURL(/\/reportes-diarios\/[0-9a-f-]{36}\?subido=1/, { timeout: 30000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  idB = pagina.url().match(/reportes-diarios\/([0-9a-f-]{36})/)?.[1] ?? null
  comprobar(Boolean(idB) && idB !== idA, 'sube el segundo reporte, con su foto')

  await pagina.goto(`${BASE}/reportes-diarios?estado=por-validar`, { waitUntil: 'networkidle' })
  const porValidar = await pagina.locator('[data-reporte]', { hasText: sello }).count()
  comprobar(porValidar === 2, `en «Por validar» están los dos (${porValidar})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'pd-01-supervisor-por-validar.png'), fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// -------------------------- 2. Gerencia da su visto a uno y observa el otro
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  await pagina.goto(`${BASE}/reportes-diarios/${idA}`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-validar="RRHH"], [data-observar="RRHH"]').count()) === 0, 'Gerencia no tiene los botones de Recursos Humanos')
  await pagina.locator('[data-validar="GERENCIA"]').click()
  await pagina.locator('[data-lado="GERENCIA"]', { hasText: 'Visto bueno el' }).waitFor({ timeout: 15000 }).catch(() => {})
  const lado = limpio(await pagina.locator('[data-lado="GERENCIA"]').textContent())
  comprobar(lado.includes('Visto bueno el') && (await pagina.locator('[data-validar="GERENCIA"]').count()) === 0, `queda el visto de Gerencia (${lado})`)
  const [a] = await consulta(`select visto_gerencia_en is not null as g, visto_rrhh_en is not null as r from reportes_diarios where id = $1`, [idA])
  comprobar(a.g && !a.r, 'en la base: visto de Gerencia, falta RR. HH.')
  await pagina.screenshot({ path: join(CAPTURAS, 'pd-02-gerencia-visto.png'), fullPage: true })

  await pagina.goto(`${BASE}/reportes-diarios/${idB}`, { waitUntil: 'networkidle' })
  await pagina.locator('[data-observar="GERENCIA"]').click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('textarea[name="motivo"]').fill('Mario no estuvo 4 horas en pintura: revisa sus horas.')
  await pagina.screenshot({ path: join(CAPTURAS, 'pd-03-gerencia-observa.png') })
  await v.getByRole('button', { name: 'Observar' }).click()
  const error = await esperarVentana(pagina)
  comprobar(!error, `Gerencia observa el segundo${error ? `: ${error}` : ''}`)
  await pagina.locator('[data-observacion]').waitFor({ timeout: 15000 }).catch(() => {})
  const obs = limpio(await pagina.locator('[data-observacion]').textContent().catch(() => ''))
  comprobar(obs.includes('Observado por Gerencia') && obs.includes('revisa sus horas'), `la observación nombra al área, no a la persona (${obs.slice(0, 80)}…)`)
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ---------------------------------- 3. el supervisor corrige el observado
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.mtz, CELULAR)
  await pagina.goto(`${BASE}/reportes-diarios?estado=observados`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('[data-reporte]', { hasText: asuntoB })
  comprobar((await fila.count()) === 1, 'en «Observados» está el segundo reporte')
  comprobar(limpio(await fila.textContent().catch(() => '')).includes('revisa sus horas'), 'la lista muestra la observación')
  await pagina.goto(`${BASE}/reportes-diarios/${idB}`, { waitUntil: 'networkidle' })
  await pagina.screenshot({ path: join(CAPTURAS, 'pd-04-supervisor-observado.png'), fullPage: true })
  await pagina.getByRole('link', { name: 'Corregir y subir de nuevo' }).click()
  await pagina.waitForURL(`**/reportes-diarios/nuevo?corrige=${idB}`)
  await pagina.waitForLoadState('networkidle')
  comprobar((await pagina.inputValue('#rd-asunto')) === asuntoB, 'el formulario se abre con lo que ya escribió')
  comprobar((await pagina.getByRole('button', { name: 'Quitar la foto 1' }).count()) === 1, 'y con su foto')
  const horas = pagina.getByRole('spinbutton', { name: 'Personal del trabajo 1: horas de la persona 1' })
  comprobar((await horas.inputValue()) === '4', 'y con las horas de antes')
  await horas.fill('3')
  await pagina.screenshot({ path: join(CAPTURAS, 'pd-05-supervisor-corrige.png'), fullPage: true })
  await pagina.getByRole('button', { name: 'Subir el reporte corregido' }).click()
  await pagina.waitForURL(/\/reportes-diarios\/[0-9a-f-]{36}\?subido=1/, { timeout: 30000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  idB2 = pagina.url().match(/reportes-diarios\/([0-9a-f-]{36})/)?.[1] ?? null
  comprobar(Boolean(idB2) && idB2 !== idB, 'sube el corregido')
  const [c] = await consulta(
    `select n.reemplaza_a = o.id as enlaza, o.anulado_en is not null as anulado,
            (select count(*)::int from reporte_diario_fotos f where f.reporte_id = n.id) as fotos,
            (select sum(horas)::float from reporte_diario_personal p where p.reporte_id = n.id) as horas
       from reportes_diarios n, reportes_diarios o where n.id = $1 and o.id = $2`,
    [idB2, idB],
  )
  comprobar(c?.enlaza && c?.anulado && c?.fotos === 1 && c?.horas === 3, `el observado queda anulado y el corregido lo nombra, con la foto y 3 h (${JSON.stringify(c)})`)
  comprobar((await pagina.getByRole('link', { name: 'reporte observado' }).count()) === 1, 'el corregido enlaza al observado')
  await pagina.goto(`${BASE}/reportes-diarios/${idB}`, { waitUntil: 'networkidle' })
  comprobar((await pagina.getByRole('link', { name: 'ver el reporte corregido' }).count()) === 1, 'y el observado enlaza al corregido')
  comprobar((await pagina.getByRole('link', { name: 'Corregir y subir de nuevo' }).count()) === 0, 'el observado ya no ofrece corregirlo otra vez')
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// -------------------------------------- 4. los vistos que faltan, en otro orden
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh)
  comprobar((await pagina.locator('nav a[href="/rrhh/horas-extras"]').count()) >= 1, 'el menú de RR. HH. trae «Horas extras»')
  comprobar((await pagina.locator('nav a[href="/planilla-diaria"]').count()) >= 1, 'el menú de RR. HH. trae «Planilla diaria»')
  for (const id of [idB2, idA]) {
    await pagina.goto(`${BASE}/reportes-diarios/${id}`, { waitUntil: 'networkidle' })
    comprobar((await pagina.locator('[data-validar="GERENCIA"]').count()) === 0, 'RR. HH. no tiene el botón de Gerencia')
    await pagina.locator('[data-validar="RRHH"]').click()
    await pagina.locator('[data-lado="RRHH"]', { hasText: 'Visto bueno el' }).waitFor({ timeout: 15000 }).catch(() => {})
  }
  const estadoA = limpio(await pagina.locator('main').textContent())
  comprobar(estadoA.includes('Validado'), 'con los dos vistos, el primero queda «Validado»')
  await pagina.screenshot({ path: join(CAPTURAS, 'pd-06-rrhh-validado.png'), fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.gerencia)
  await pagina.goto(`${BASE}/reportes-diarios/${idB2}`, { waitUntil: 'networkidle' })
  await pagina.locator('[data-validar="GERENCIA"]').click()
  await pagina.locator('[data-lado="GERENCIA"]', { hasText: 'Visto bueno el' }).waitFor({ timeout: 15000 }).catch(() => {})
  await contexto.close()
}
{
  const filas = await consulta(
    `select id, visto_gerencia_en is not null and visto_rrhh_en is not null and anulado_en is null as validado from reportes_diarios where id = any($1)`,
    [[idA, idB2]],
  )
  comprobar(filas.length === 2 && filas.every((f) => f.validado), 'en la base, los dos reportes vigentes tienen los dos vistos')
}

// ----------------------------------------------- 5. RR. HH. y las horas extras
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh)
  await pagina.goto(`${BASE}/rrhh/horas-extras`, { waitUntil: 'networkidle' })
  const filaElena = pagina.locator('[data-extras]', { hasText: elena })
  const filaMario = pagina.locator('[data-extras]', { hasText: mario })
  const te = limpio(await filaElena.textContent().catch(() => ''))
  const tm = limpio(await filaMario.textContent().catch(() => ''))
  comprobar(te.includes('trabajó 10 h') && te.includes('2 h al 25 %') && te.includes('Pagarlas: S/ 25.00'), `Elena: 10 h en el día, 2 h extras al 25 %, S/ 25.00 si se pagan (${te})`)
  comprobar(tm.includes('trabajó 9 h') && tm.includes('1 h al 25 %'), `Mario: 9 h en el día (6 + 3 del corregido), 1 h extra (${tm})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'pd-07-rrhh-horas-extras.png'), fullPage: true })

  await filaElena.locator('[data-decidir="PAGAR"]').click()
  await filaElena.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  await filaMario.locator('[data-decidir="RESERVAR"]').click()
  await filaMario.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  const decisiones = await consulta(
    `select t.nombres, d.decision, d.horas::float from horas_extras_decisiones d join trabajadores t on t.id = d.trabajador_id
      where d.trabajador_id = any($1) and d.anulado_en is null order by 1`,
    [[ids[elena], ids[mario]]],
  )
  comprobar(
    decisiones.length === 2 && decisiones[0].decision === 'PAGAR' && decisiones[0].horas === 2 && decisiones[1].decision === 'RESERVAR' && decisiones[1].horas === 1,
    `quedan decididas: ${decisiones.map((d) => `${d.nombres.split(' ')[0]} ${d.decision} ${d.horas} h`).join(', ')}`,
  )
  const saldo = pagina.locator('[data-saldo]', { hasText: mario })
  comprobar(limpio(await saldo.textContent().catch(() => '')).includes('1 h'), 'Mario tiene 1 h en su saldo')

  await saldo.locator('[data-usar-saldo]').click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="horas"]').fill('0.5')
  await v.locator('textarea[name="motivo"]').fill('Permiso para un trámite en la mañana.')
  await v.getByRole('button', { name: 'Usar del saldo' }).click()
  const error = await esperarVentana(pagina)
  comprobar(!error, `usa media hora de su saldo${error ? `: ${error}` : ''}`)
  const [s] = await consulta(`select saldo::float from saldo_horas_por_persona($1)`, [ids[mario]]).catch(() => [{}])
  const saldoPantalla = limpio(await pagina.locator('[data-saldo]', { hasText: mario }).textContent().catch(() => ''))
  comprobar(saldoPantalla.includes('0,5 h') || saldoPantalla.includes('0.5 h'), `le queda media hora en pantalla (${saldoPantalla}; base: ${s?.saldo ?? 'sin sesión'})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'pd-08-rrhh-saldo.png'), fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------- 6. RR. HH. manda la planilla diaria
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh)
  await pagina.goto(`${BASE}/planilla-diaria`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator('[data-por-enviar]')
  const fe = limpio(await tarjeta.locator('tr', { hasText: elena }).textContent().catch(() => ''))
  const fm = limpio(await tarjeta.locator('tr', { hasText: mario }).textContent().catch(() => ''))
  comprobar(fe.includes('8 h ordinarias') && fe.includes('2 h extras') && fe.includes('S/ 105.00'), `por enviar, Elena: 8 h + 2 h extras, S/ 105.00 (${fe})`)
  comprobar(fm.includes('8 h ordinarias') && !fm.includes('extras') && fm.includes('S/ 60.00'), `por enviar, Mario: 8 h, sin las extras reservadas, S/ 60.00 (${fm})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'pd-09-rrhh-por-enviar.png'), fullPage: true })

  await pagina.locator('[data-enviar-planilla]').click()
  const v = pagina.locator('[role="dialog"]')
  const boton = v.getByRole('button', { name: 'Enviar', exact: true })
  await boton.click()
  await boton.click({ timeout: 500 }).catch(() => {})
  await pagina.waitForURL(/\/planilla-diaria\/[0-9a-f-]{36}$/, { timeout: 30000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  idPlanilla = pagina.url().match(/planilla-diaria\/([0-9a-f-]{36})/)?.[1] ?? null
  comprobar(Boolean(idPlanilla), `al enviar, abre la planilla (${new URL(pagina.url()).pathname})`)
  const gente = await consulta(
    `select p.nombre, p.horas_ordinarias::float as ord, p.horas_extras::float as ext, p.total::float as total, pl.numero
       from planilla_diaria_personas p join planillas_diarias pl on pl.id = p.planilla_id
      where p.trabajador_id = any($1) and pl.anulado_en is null order by p.nombre`,
    [[ids[elena], ids[mario]]],
  )
  numeroPlanilla = gente[0]?.numero ?? null
  comprobar(
    gente.length === 2 && gente[0].total === 105 && gente[0].ext === 2 && gente[1].total === 60 && gente[1].ext === 0 && gente.every((g) => g.ord === 8),
    `dos toques, una planilla ${numeroPlanilla}: ${gente.map((g) => `${g.nombre.split(' ')[0]} ${g.ord}+${g.ext} h = ${g.total}`).join(', ')}`,
  )
  comprobar((await pagina.locator('[data-cuenta]', { hasText: cuentaElena }).count()) === 1, 'RR. HH. ve la cuenta a la que se paga')
  await pagina.screenshot({ path: join(CAPTURAS, 'pd-10-rrhh-planilla-enviada.png'), fullPage: true })
  const [aviso] = await consulta(
    `select count(*)::int as n from notificaciones n join usuarios u on u.id = n.usuario_id where u.correo = $1 and n.titulo like $2 and n.creado_en >= $3`,
    [CUENTAS.tesoreria, `%${numeroPlanilla}%`, inicio],
  )
  comprobar(aviso.n === 1, `a Tesorería le llega el aviso de ${numeroPlanilla}`)
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// -------------------------- 7. Tesorería paga con comprobante y adjunta boletas
{
  const tel = await entrar(CUENTAS.tesoreria, CELULAR)
  comprobar((await tel.pagina.locator('a[href="/planilla-diaria"]').count()) >= 1, 'Tesorería tiene «Planilla» en su teléfono')
  await tel.contexto.close()

  const { pagina, contexto, errores } = await entrar(CUENTAS.tesoreria)
  comprobar((await pagina.locator('nav a[href="/planilla-diaria"]').count()) >= 1, 'el menú de Tesorería trae «Planilla diaria»')
  await pagina.goto(`${BASE}/planilla-diaria`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-por-enviar]').count()) === 0, 'Tesorería no ve lo que está por enviar')
  const enlace = pagina.locator(`[data-planilla="${numeroPlanilla}"]`)
  comprobar(limpio(await enlace.textContent().catch(() => '')).includes('Por pagar'), `ve ${numeroPlanilla} «Por pagar»`)
  await enlace.click()
  await pagina.waitForURL(`**/planilla-diaria/${idPlanilla}`)
  await pagina.waitForLoadState('networkidle')
  const cuentaE = limpio(await pagina.locator('[data-persona]', { hasText: elena }).locator('[data-cuenta]').textContent().catch(() => ''))
  comprobar(cuentaE.includes(cuentaElena) && cuentaE.includes('Banco de Pruebas'), `ve la cuenta de Elena (${cuentaE})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'pd-11-tesoreria-planilla.png'), fullPage: true })

  await pagina.locator('[data-registrar-pago]').click()
  const v = pagina.locator('[role="dialog"]')
  await elegirCuenta(v, caja)
  await v.locator('input[name="operacion"]').fill(`OP-${sello}`)
  await v.locator('input[name="archivo"]').setInputFiles(join(archivos, 'comprobante.pdf'))
  await pagina.screenshot({ path: join(CAPTURAS, 'pd-12-tesoreria-pago.png') })
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  let error = await esperarVentana(pagina)
  comprobar(!error, `registra el pago en lote${error ? `: ${error}` : ''}`)
  const movs = await movimientosDeLaCaja(consulta, caja)
  comprobar(movs.length === 1 && movs[0].origen === 'PAGO_PLANILLA_DIARIA' && movs[0].tipo === 'EGRESO' && movs[0].monto === 165,
    `el lote sale en un solo egreso de la cuenta elegida (${JSON.stringify(movs)})`)
  const pagos = await consulta(
    `select g.operacion, g.comprobante_ruta as ruta, (select count(*)::int from planilla_diaria_personas p where p.pago_id = g.id) as personas
       from planilla_diaria_pagos g where g.planilla_id = $1 and g.anulado_en is null`,
    [idPlanilla],
  )
  comprobar(pagos.length === 1 && pagos[0].operacion === `OP-${sello}` && pagos[0].personas >= 2 && pagos[0].ruta?.startsWith(`${idPlanilla}/`), `un pago con su comprobante para ${pagos[0]?.personas} personas`)
  const [objeto] = await consulta(`select count(*)::int as n from storage.objects where bucket_id = 'planilla-diaria' and name = $1`, [pagos[0]?.ruta ?? ''])
  comprobar(objeto.n === 1, 'el comprobante quedó en el almacenamiento')

  for (const nombre of [elena, mario]) {
    await pagina.locator('[data-persona]', { hasText: nombre }).locator('[data-subir-boleta]').click()
    await v.locator('input[name="archivo"]').setInputFiles(join(archivos, 'boleta.pdf'))
    await v.getByRole('button', { name: 'Adjuntar' }).click()
    error = await esperarVentana(pagina)
    comprobar(!error, `adjunta la boleta de ${nombre.split(' ')[0]}${error ? `: ${error}` : ''}`)
  }
  const boletas = await consulta(
    `select count(*)::int as n from planilla_diaria_personas where planilla_id = $1 and trabajador_id = any($2) and boleta_ruta is not null`,
    [idPlanilla, [ids[elena], ids[mario]]],
  )
  comprobar(boletas[0].n === 2, 'las dos boletas quedaron anotadas')
  await pagina.reload({ waitUntil: 'networkidle' })
  const cabecera = limpio(await pagina.locator('main').textContent())
  comprobar(cabecera.includes('Pagada') && (await pagina.locator('[data-registrar-pago]').count()) === 0, 'la planilla queda «Pagada» y sin nada más por pagar')
  comprobar((await pagina.locator('[data-entregar-boleta]').count()) === 0, 'Tesorería no marca las entregas: eso es de RR. HH.')
  await pagina.screenshot({ path: join(CAPTURAS, 'pd-13-tesoreria-pagada.png'), fullPage: true })

  await pagina.goto(`${BASE}/rrhh/horas-extras`, { waitUntil: 'networkidle' })
  comprobar(pagina.url().includes('/sin-permiso'), 'Tesorería no entra a «Horas extras»')
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 8. RR. HH. entrega las boletas
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh)
  const avisos = await consulta(
    `select n.titulo from notificaciones n join usuarios u on u.id = n.usuario_id where u.correo = $1 and n.creado_en >= $2 order by n.creado_en`,
    [CUENTAS.rrhh, inicio],
  )
  const titulos = avisos.map((a) => a.titulo)
  comprobar(
    titulos.some((t) => t.startsWith('Planilla diaria pagada')) && titulos.some((t) => t.startsWith('Boletas por entregar')),
    `a RR. HH. le avisan el pago y las boletas (${titulos.filter((t) => /Planilla|Boletas/.test(t)).join(' · ')})`,
  )
  await pagina.goto(`${BASE}/planilla-diaria/${idPlanilla}`, { waitUntil: 'networkidle' })
  for (const nombre of [elena, mario]) {
    const persona = pagina.locator('[data-persona]', { hasText: nombre })
    await persona.locator('[data-entregar-boleta]').click()
    await persona.getByText(/^Boleta entregada el/).waitFor({ timeout: 15000 }).catch(() => {})
  }
  const [e] = await consulta(
    `select count(*)::int as n from planilla_diaria_personas where planilla_id = $1 and trabajador_id = any($2) and boleta_entregada_en is not null`,
    [idPlanilla, [ids[elena], ids[mario]]],
  )
  comprobar(e.n === 2, 'las dos boletas quedan entregadas')
  const [todas] = await consulta(`select bool_and(boleta_entregada_en is not null) as si from planilla_diaria_personas where planilla_id = $1`, [idPlanilla])
  if (todas.si) comprobar(limpio(await pagina.locator('main').textContent()).includes('Boletas entregadas'), 'la planilla queda «Boletas entregadas»')
  await pagina.screenshot({ path: join(CAPTURAS, 'pd-14-rrhh-boletas-entregadas.png'), fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------ 9. Gerencia consulta; los demás no entran
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  // Desde el menú de Gerencia del 15/10 (decisión 17) la planilla no está en su menú: la abre por su dirección.
  comprobar((await pagina.locator('nav a[href="/planilla-diaria"]').count()) === 0, 'el menú de Gerencia ya no trae «Planilla diaria»: la abre por su dirección')
  await pagina.goto(`${BASE}/planilla-diaria/${idPlanilla}`, { waitUntil: 'networkidle' })
  const texto = limpio(await pagina.locator('main').textContent())
  comprobar(texto.includes(elena) && texto.includes('S/ 105.00'), 'Gerencia ve la planilla con lo que se pagó')
  comprobar(
    (await pagina.locator('[data-cuenta], [data-registrar-pago], [data-anular], [data-entregar-boleta], [data-subir-boleta]').count()) === 0 && !texto.includes(cuentaElena),
    'Gerencia la ve sin cuentas bancarias ni botones',
  )
  await pagina.goto(`${BASE}/rrhh/horas-extras`, { waitUntil: 'networkidle' })
  comprobar(
    (await pagina.locator('h1', { hasText: 'Horas extras' }).count()) === 1 && (await pagina.locator('[data-decidir], [data-usar-saldo], [data-anular-extras]').count()) === 0,
    'Gerencia consulta las horas extras sin decidirlas',
  )
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}
for (const [cuenta, quien] of [
  [CUENTAS.mtz, 'el supervisor'],
  [CUENTAS.porteria, 'la portería'],
]) {
  const { pagina, contexto } = await entrar(cuenta, CELULAR)
  for (const ruta of ['/planilla-diaria', '/rrhh/horas-extras', `/planilla-diaria/${idPlanilla}`]) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    comprobar(pagina.url().includes('/sin-permiso'), `${quien} no entra a ${ruta.replace(idPlanilla, '…')}`)
  }
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} comprobaciones fallaron.` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
