/**
 * Clic real sobre el reporte diario con varios códigos y los subcontratos de
 * Maestranza (migración 20261020180000), con la cuenta de cada puesto (nunca
 * ADMIN):
 *
 *   1. Administración ve «Maestranza» entre las áreas del subcontrato.
 *   2. El supervisor de Maestranza, en el teléfono, ve en Subcontratos el suyo
 *      sin montos ni recibos, con inicio, fin y «Todavía nadie reportó su
 *      avance»; «Reportar avance» abre el reporte con el código escrito.
 *   3. En el mismo reporte suma un segundo código buscándolo por partes; un
 *      tercero repetido se marca y no deja subir; lo quita y sube: entran dos
 *      reportes del mismo envío, las horas de Juan van al segundo código y el
 *      detalle enlaza al otro.
 *   4. Subcontratos muestra el avance que reportó.
 *   5. Producción no ve el subcontrato de Maestranza.
 *   6. RR. HH. pasa a Juan a la planilla administrativa en su ficha, y el
 *      supervisor ya no lo encuentra en el personal del reporte.
 *
 * Necesita las cuentas `*.local@metalwork.test`. El personal, el subcontrato y
 * el código los crea el script, distintos en cada corrida.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  mtz: 'sup.mtz.local@metalwork.test',
  prd: 'sup.prd.local@metalwork.test',
  administracion: 'administracion.local@metalwork.test',
  rrhh: 'rrhh.local@metalwork.test',
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
  const movil = viewport.width < 500
  const contexto = await navegador.newContext({ viewport, isMobile: movil, hasTouch: movil, timezoneId: 'America/Lima' })
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

/** Elige en el `SeleccionBuscable` de nombre accesible `etiqueta` la opción que empieza por `texto`. */
async function elegir(pagina, etiqueta, texto) {
  await pagina.getByRole('combobox', { name: etiqueta }).click()
  // Se escribe cuando la caja de búsqueda ya tiene el foco (como en
  // probar-reporte-diario.mjs): el panel la enfoca en el cuadro siguiente y, si
  // no, las primeras letras se pierden en el botón y la opción no aparece.
  await pagina.locator('input[type="search"]:focus').waitFor({ timeout: 10000 })
  await pagina.keyboard.type(texto)
  await pagina.getByRole('option', { name: new RegExp(texto, 'i') }).first().click()
}
/** Espera a que el recuadro `n` termine de leer su código. */
async function esperarOpciones(pagina, n) {
  const caja = pagina.locator(`fieldset[data-codigo-reporte="${n}"] [data-opciones]`)
  await pagina.waitForFunction(
    (el) => /para reportar en tu área|no tiene planos|no lleva avance/.test(el?.textContent ?? ''),
    await caja.elementHandle(),
    { timeout: 30000 },
  )
  return limpio(await caja.innerText())
}

const sello = Date.now().toString().slice(-8)
const CODIGO = `VC${sello.slice(-4)}_SR_O4_1_26/40`
const JUAN = `Juan ${sello}`
const TAREA = `Armado del cajón ${sello}`
console.log(`  · código de la prueba: ${CODIGO}`)

// El segundo código, uno que ya está en la lista de códigos de la empresa.
const [{ codigo: OTRO }] = await consulta(
  `select codigo from public.rrhh_codigos_internos() where codigo <> 'PLANTA' and codigo ~ '_' and char_length(codigo) >= 8 order by codigo limit 1`,
)
console.log(`  · segundo código: ${OTRO}`)

// ------------------------------------------------------------------ 0. el armazón
// Lo que harían RR. HH. y Administración: Juan en Maestranza con su costo
// (S/ 2,400: S/ 10 la hora) y un subcontrato de Maestranza para el código.
await consulta(
  `with nuevo as (
     insert into trabajadores (nombres, apellidos, dni, cargo, area_id, creado_por)
     values ($1, 'Habilitador', '6' || right($2, 7), 'Habilitador', (select id from areas where codigo = 'MTZ'),
             (select id from usuarios where correo = $3))
     returning id)
   insert into trabajador_costos (trabajador_id, costo_mensual) select id, 2400 from nuevo`,
  [JUAN, sello, CUENTAS.rrhh],
)
const [{ ruc }] = await consulta(
  `select r as ruc from (select '10' || $1 || d as r from generate_series(0, 9) d) x where public.ruc_es_valido(r) limit 1`,
  [sello],
)
const [{ hoy }] = await consulta(`select (now() at time zone 'America/Lima')::date::text as hoy`)
await base.query('begin')
await consulta(`select set_config('request.jwt.claim.sub', (select id::text from usuarios where correo = $1), true),
                       set_config('request.jwt.claim.role', 'authenticated', true)`, [CUENTAS.administracion])
await base.query('set local role authenticated')
const [{ sub }] = await consulta(`select public.guardar_subcontratista(gen_random_uuid(), $1, $2, null, null, null, null, true) as sub`, [
  ruc,
  `Soldador banco ${sello}`,
])
const [{ sc }] = await consulta(
  `select public.registrar_subcontrato(gen_random_uuid(), $1, $2, 'Soldadura del piso del cajón', 'PEN', 2000,
     $3::date - 3, $3::date + 10, 'MTZ') as sc`,
  [sub, CODIGO, hoy],
)
await base.query('commit')
const [{ numero: NUMERO }] = await consulta(`select numero from subcontratos where id = $1`, [sc])

// ------------------------------------------------------------------ 1. Administración
{
  const { pagina, contexto } = await entrar(CUENTAS.administracion)
  await pagina.goto(`${BASE}/subcontratos`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Nuevo subcontrato' }).click()
  await pagina.locator('select[data-area-subcontrato]').waitFor({ timeout: 15000 })
  const areas = await pagina.locator('select[data-area-subcontrato] option').allInnerTexts()
  comprobar(areas.map(limpio).includes('Maestranza'), `Administración elige Maestranza para el subcontrato (${areas.map(limpio).join(', ')})`)
  await contexto.close()
}

// ------------------------------------------------------------------ 2. Maestranza ve su subcontrato
let idA = null
let idB = null
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.mtz, CELULAR)
  const menu = await pagina.locator('nav a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  const orden = ['/reportes-diarios', '/planos', '/subcontratos/area', '/requerimientos'].map((r) => menu.indexOf(r))
  comprobar(orden.every((i, k) => i >= 0 && (k === 0 || i > orden[k - 1])), `el menú va Reporte diario, Planos y etapas, Subcontratos, Requerimientos (${orden.join(' ')})`)

  await pagina.goto(`${BASE}/subcontratos/area`, { waitUntil: 'networkidle' })
  const fila = pagina.locator(`[data-subcontrato="${NUMERO}"]`)
  const texto = limpio(await fila.innerText())
  comprobar(texto.includes('Soldadura del piso del cajón') && texto.includes('Inicio') && texto.includes('Fin'), `sale su subcontrato con inicio y fin (${texto.slice(0, 120)})`)
  comprobar(texto.includes('Todavía nadie reportó su avance') && texto.includes('Día 4 de 14'), 'sin avance todavía, en el día 4 de 14 del plazo')
  const pagina_texto = limpio(await pagina.locator('main').innerText())
  comprobar(!/S\/|2,000|2000|Recibo/.test(pagina_texto), 'sin montos ni recibos en toda la pantalla')
  comprobar(!pagina_texto.includes('Tu área no recibe subcontratos'), 'Maestranza ya recibe subcontratos')
  await pagina.screenshot({ path: join(CAPTURAS, 'varios-codigos-subcontratos-mtz.png'), fullPage: true })

  await fila.getByRole('link', { name: 'Reportar avance' }).click()
  await pagina.waitForURL(/reportes-diarios\/nuevo\?codigo=.*&subcontrato=/, { timeout: 30000 })
  await pagina.waitForLoadState('networkidle')
  comprobar((await pagina.inputValue('#rd-codigo')) === CODIGO, 'el reporte se abre con el código del subcontrato')
  const opciones1 = await esperarOpciones(pagina, 1)
  comprobar(opciones1.includes('1 cosa para reportar'), `y su subcontrato para elegir (${opciones1})`)
  const sobre1 = limpio(await pagina.getByRole('combobox', { name: 'Trabajo 1: sobre qué' }).innerText())
  comprobar(sobre1.includes(NUMERO), `y con el subcontrato ya elegido en «Sobre qué» (${sobre1})`)

  await pagina.fill('#rd-asunto', `Avance del día ${sello}`)
  await pagina.fill('#rd-descripcion', 'Soldadura del piso y armado del cajón.')
  await pagina.locator('fieldset[data-codigo-reporte="1"] input[id^="rd-avance-"]').fill('30')

  // Segundo código, buscado por partes y en otro orden.
  await pagina.getByRole('button', { name: 'Agregar otro código interno' }).click()
  const partes = OTRO.toLowerCase().split('_')
  const codigo2 = pagina.locator('fieldset[data-codigo-reporte="2"] input[role="combobox"]')
  await codigo2.click()
  await codigo2.fill(`${partes[1]} ${partes[0]}`)
  const sugerencia = pagina.getByRole('option', { name: OTRO, exact: true })
  comprobar((await sugerencia.count()) === 1, `buscando «${partes[1]} ${partes[0]}» sale ${OTRO}, entero`)
  await sugerencia.click()
  comprobar((await codigo2.inputValue()) === OTRO, 'al tocarlo queda escrito')
  await esperarOpciones(pagina, 2)
  const nombre2 = OTRO.toUpperCase()
  await elegir(pagina, `${nombre2}, trabajo 1: sobre qué`, 'Tarea nueva')
  await pagina.locator('fieldset[data-codigo-reporte="2"] textarea').fill(TAREA)
  await pagina.locator('fieldset[data-codigo-reporte="2"] input[id^="rd-avance-"]').fill('20')
  await elegir(pagina, `Personal de ${nombre2}, trabajo 1: persona 1`, JUAN)
  await pagina.getByRole('spinbutton', { name: `Personal de ${nombre2}, trabajo 1: horas de la persona 1` }).fill('4')

  // Un tercero con el mismo código que el primero: se marca y no deja subir.
  await pagina.getByRole('button', { name: 'Agregar otro código interno' }).click()
  await pagina.locator('fieldset[data-codigo-reporte="3"] input[role="combobox"]').fill(CODIGO.toLowerCase())
  const boton = pagina.getByRole('button', { name: /Subir reporte de 3 códigos/ })
  comprobar(await boton.isDisabled(), 'con un código repetido, «Subir» espera')
  comprobar(limpio(await pagina.locator('fieldset[data-codigo-reporte="3"]').innerText()).includes('Este código ya está más arriba'), 'y el repetido dice por qué')
  await pagina.locator('fieldset[data-codigo-reporte="3"]').getByRole('button', { name: /^Quitar .* del reporte$/ }).click()
  comprobar((await pagina.locator('fieldset[data-codigo-reporte]').count()) === 2, 'al quitarlo quedan dos códigos')
  const resumen = limpio(await pagina.locator('[data-resumen-personal]').innerText())
  comprobar(resumen.includes('1 persona') && resumen.includes('4 h'), `el resumen del día suma la gente de todos los códigos (${resumen})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'varios-codigos-formulario.png'), fullPage: true })

  await pagina.getByRole('button', { name: 'Subir reporte de 2 códigos' }).click()
  await pagina.waitForURL(/\/reportes-diarios\/[0-9a-f-]{36}\?subido=1/, { timeout: 60000 }).catch(() => {})
  idA = pagina.url().match(/reportes-diarios\/([0-9a-f-]{36})/)?.[1] ?? null
  comprobar(Boolean(idA), `sube y abre el reporte (${pagina.url()})`)
  if (idA) {
    const aviso = limpio(await pagina.locator('[role="status"]').filter({ hasText: /\S/ }).first().innerText())
    comprobar(aviso.includes('Reporte subido con 2 códigos'), `el aviso dice que subió con 2 códigos (${aviso})`)
    const enlace = pagina.locator('[data-mismo-envio] a')
    comprobar((await enlace.count()) === 1 && limpio(await enlace.innerText()) === OTRO, 'el detalle enlaza al otro código del envío')
    const filas = await consulta(
      `select r.id, r.codigo_interno, r.creado_en::text as creado
         from reportes_diarios r
        where r.registrado_por = (select registrado_por from reportes_diarios where id = $1)
          and r.creado_en = (select creado_en from reportes_diarios where id = $1)
        order by r.codigo_interno`,
      [idA],
    )
    comprobar(filas.length === 2 && filas.some((f) => f.codigo_interno === CODIGO) && filas.some((f) => f.codigo_interno === OTRO), `en la base, dos reportes del mismo envío (${filas.map((f) => f.codigo_interno).join(', ')})`)
    idB = filas.find((f) => f.id !== idA)?.id ?? null
    const tareos = await consulta(
      `select t.codigo_interno, t.horas::float as horas, t.costo::float as costo from tareos t
         join reporte_diario_personal p on p.id = t.reporte_linea_id
        where p.reporte_id = any($1::uuid[]) and t.anulado_en is null`,
      [filas.map((f) => f.id)],
    )
    comprobar(tareos.length === 1 && tareos[0].codigo_interno === OTRO && tareos[0].horas === 4 && tareos[0].costo === 40, `las 4 h de Juan van al costeo de ${OTRO} y ninguna al del subcontrato (${JSON.stringify(tareos)})`)
    const [act] = await consulta(`select count(*)::int as n from codigo_actividades where codigo_interno = $1 and descripcion = $2`, [OTRO, TAREA])
    comprobar(act.n === 1, 'la tarea nueva queda en su código para los próximos reportes')
    await pagina.locator('[data-mismo-envio] a').click()
    await pagina.waitForURL(new RegExp(`/reportes-diarios/${idB}`), { timeout: 30000 }).catch(() => {})
    comprobar(limpio(await pagina.locator('[data-mismo-envio] a').innerText()) === CODIGO, 'y desde el otro se vuelve al primero')
  }

  // ------------------------------------------------------------------ 4. el avance en Subcontratos
  await pagina.goto(`${BASE}/subcontratos/area`, { waitUntil: 'networkidle' })
  const despues = limpio(await pagina.locator(`[data-subcontrato="${NUMERO}"]`).innerText())
  comprobar(
    (await pagina.locator(`[data-subcontrato="${NUMERO}"] [data-avance="30"]`).count()) === 1 && despues.includes('Último avance reportado el'),
    `Subcontratos muestra el 30 % que reportó (${despues.slice(-80)})`,
  )
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `en el teléfono no hay desplazamiento lateral (${ancho} px)`)
  comprobar(errores.length === 0, `Maestranza sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------------ 5. Producción no lo ve
{
  const { pagina, contexto } = await entrar(CUENTAS.prd)
  await pagina.goto(`${BASE}/subcontratos/area`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator(`[data-subcontrato="${NUMERO}"]`).count()) === 0, 'Producción no ve el subcontrato de Maestranza')
  await contexto.close()
}

// ------------------------------------------------------------------ 6. la planilla de Juan
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh)
  await pagina.goto(`${BASE}/rrhh/personal`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-planilla="TALLER"]').count()) > 0, 'la lista de RR. HH. dice la planilla de cada persona')
  await pagina.getByRole('button', { name: `Corregir la ficha de ${JUAN} Habilitador` }).click()
  const v = pagina.locator('[role="dialog"]')
  comprobar((await v.locator('select[name="planilla"]').inputValue()) === 'TALLER', 'la ficha de Juan abre con su planilla de taller')
  await v.locator('select[name="planilla"]').selectOption('ADMINISTRATIVA')
  if (!(await v.locator('input[name="fecha_ingreso"]').inputValue())) await v.locator('input[name="fecha_ingreso"]').fill('2026-01-05')
  if (!(await v.locator('input[name="banco"]').inputValue())) await v.locator('input[name="banco"]').fill('Banco de Pruebas')
  if (!(await v.locator('input[name="numero_cuenta"]').inputValue())) await v.locator('input[name="numero_cuenta"]').fill('191-00000-0-07')
  await v.getByRole('button', { name: 'Guardar la ficha' }).click()
  await v.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  const [j] = await consulta(`select planilla from trabajadores where nombres = $1`, [JUAN])
  comprobar(j?.planilla === 'ADMINISTRATIVA', `en la base, Juan queda en la planilla administrativa (${j?.planilla})`)
  comprobar(errores.length === 0, `RR. HH. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.mtz, CELULAR)
  await pagina.goto(`${BASE}/reportes-diarios/nuevo`, { waitUntil: 'networkidle' })
  await pagina.getByRole('combobox', { name: 'Personal del trabajo 1: persona 1' }).click()
  await pagina.keyboard.type(JUAN)
  await pagina.waitForTimeout(500)
  comprobar((await pagina.getByRole('option', { name: new RegExp(JUAN) }).count()) === 0, 'el supervisor ya no encuentra a Juan en el personal del reporte')
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo bien.' : `\n${fallas.length} fallas.`)
process.exit(fallas.length === 0 ? 0 : 1)
