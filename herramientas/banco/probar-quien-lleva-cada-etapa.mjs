/**
 * Clic real sobre «quién lleva cada etapa» (migración 20261125310000), con la
 * cuenta de cada puesto (nunca ADMIN):
 *
 *   1. RR. HH. abre un código en Tiempos de entrega, asigna a una persona a la
 *      etapa vencida, la cambia por otra y deja otra etapa sin nadie.
 *   2. «Por persona» muestra a cada una con su etapa y su semáforo.
 *   3. En el teléfono (390) la ventana y la vista por persona caben.
 *   4. Gerencia ve quién la lleva y no tiene «Asignar persona».
 *   5. El supervisor de Producción lo ve en «Planos», junto a su etapa, y
 *      Diseño en «Control de etapas».
 *   6. Tesorería no entra a la vista por persona.
 *
 * Siembra su código (QLE_UNO) y dos personas del personal en la base del
 * banco; volver a correrlo los rehace. Variables: BANCO_CLAVE, BASE
 * (http://localhost:3111), BANCO_BASE (mw_demo), CAPTURAS.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const BASE_DE_DATOS = process.env.BANCO_BASE ?? 'mw_demo'
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

function sql(texto) {
  return execFileSync(
    'psql',
    ['-h', process.env.PGHOST ?? '/tmp', '-p', process.env.PGPORT ?? '5433', '-U', process.env.PGUSER ?? 'postgres', '-d', BASE_DE_DATOS, '-AtqX', '-v', 'ON_ERROR_STOP=1', '-c', texto],
    { encoding: 'utf8' },
  ).trim()
}

// ------------------------------------------------------------------ La siembra
sql(`
do $$
declare
  v_dis uuid := (select id from public.usuarios where correo = 'diseno.local@metalwork.test');
  v_rrh uuid := (select id from public.usuarios where correo = 'rrhh.local@metalwork.test');
  v_prd uuid := (select id from public.areas where codigo = 'PRD');
  v_acb uuid := (select id from public.areas where codigo = 'ACB');
begin
  if v_dis is null or v_rrh is null then raise exception 'Faltan las cuentas locales: corre preparar.sh'; end if;
  update public.codigo_etapas set quitada_en = now(), quitada_por = v_dis where codigo_interno = 'QLE_UNO' and quitada_en is null;
  insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, fin_plan, inicio_real, creado_por) values
    ('QLE_UNO', 1, 'Ensamblaje', v_prd, current_date - 1, current_date - 4, v_dis),
    ('QLE_UNO', 2, 'Pintura', v_acb, public.sumar_dias_habiles(current_date, 8), null, v_dis);
  insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id, creado_por) values
    ('ROSA', 'QUISPE PRUEBA', '46250001', 'Soldadora', v_prd, v_rrh),
    ('LUIS', 'MAMANI PRUEBA', '46250002', 'Armador', v_prd, v_rrh)
  on conflict (dni) do update set activo = true;
end $$;
`)

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, ancho = 1440, alto = 900) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, deviceScaleFactor: 2 })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  pagina.on('pageerror', (e) => errores.push(String(e).slice(0, 300)))
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 60000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto, errores }
}

const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim()
const etapa = (pagina, nombre) => pagina.locator(`[data-etapa="${nombre}"]`).first()
const desborda = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const DETALLE = `${BASE}/rrhh/tiempos-de-entrega/codigo?codigo=QLE_UNO`
const PERSONAS = `${BASE}/rrhh/tiempos-de-entrega/personas`

async function elegirPersona(pagina, nombre, boton) {
  const ventana = pagina.getByRole('dialog')
  await ventana.waitFor()
  await ventana.getByRole('combobox').click()
  await pagina.getByPlaceholder('Escribe el nombre o el área').fill(nombre.split(',')[0])
  await pagina.getByRole('option', { name: new RegExp(nombre) }).click()
  await ventana.getByRole('button', { name: boton, exact: true }).click()
  await ventana.waitFor({ state: 'detached', timeout: 30000 })
}

// ------------------------------------------------------------------ 1 y 2. Recursos Humanos, monitor
{
  const { pagina, contexto, errores } = await entrar('rrhh.local@metalwork.test')
  await pagina.goto(DETALLE, { waitUntil: 'networkidle' })
  await etapa(pagina, 'Ensamblaje').waitFor({ timeout: 60000 })
  comprobar(/Nadie a cargo todavía/.test(await texto(etapa(pagina, 'Ensamblaje'))), 'la etapa sin persona dice «Nadie a cargo todavía»')

  await etapa(pagina, 'Ensamblaje').getByRole('button', { name: /Asignar quién lleva/ }).click()
  await pagina.getByRole('dialog').waitFor()
  await pagina.getByRole('dialog').getByRole('combobox').click()
  await pagina.getByPlaceholder('Escribe el nombre o el área').fill('QUISPE')
  await pagina.screenshot({ path: `${CAPTURAS}/5-rrhh-asignar-persona-1440.png` })
  await pagina.getByRole('option', { name: /QUISPE PRUEBA, ROSA/ }).click()
  await pagina.getByRole('dialog').getByRole('button', { name: 'Asignar', exact: true }).click()
  await pagina.getByRole('dialog').waitFor({ state: 'detached', timeout: 30000 })
  await pagina.locator('[data-etapa="Ensamblaje"] [data-responsable="QUISPE PRUEBA, ROSA"]').waitFor({ timeout: 30000 })
  comprobar(/La lleva: QUISPE PRUEBA, ROSA \(Producción\)/.test(await texto(etapa(pagina, 'Ensamblaje'))), 'RR. HH. asigna a Rosa y la etapa dice «La lleva: QUISPE PRUEBA, ROSA (Producción)»')
  comprobar(
    sql(`select count(*) from etapa_responsables r join codigo_etapas e on e.id = r.etapa_id where e.codigo_interno = 'QLE_UNO' and e.quitada_en is null and r.quitado_en is null`) === '1',
    'en la base queda una asignación vigente',
  )

  // Cambiarla por Luis: Rosa queda en el historial.
  await etapa(pagina, 'Ensamblaje').getByRole('button', { name: /Cambiar a quien lleva/ }).click()
  await elegirPersona(pagina, 'MAMANI PRUEBA, LUIS', 'Cambiar')
  await pagina.locator('[data-etapa="Ensamblaje"] [data-responsable="MAMANI PRUEBA, LUIS"]').waitFor({ timeout: 30000 })
  comprobar(true, 'RR. HH. la cambia a Luis')
  comprobar(
    sql(`select count(*) filter (where r.quitado_en is not null) || '/' || count(*) from etapa_responsables r join codigo_etapas e on e.id = r.etapa_id where e.codigo_interno = 'QLE_UNO' and e.quitada_en is null`) === '1/2',
    'Rosa queda en el historial y Luis es el vigente',
  )

  // Pintura: asignar a Rosa y dejarla sin nadie.
  await etapa(pagina, 'Pintura').getByRole('button', { name: /Asignar quién lleva/ }).click()
  await elegirPersona(pagina, 'QUISPE PRUEBA, ROSA', 'Asignar')
  await pagina.locator('[data-etapa="Pintura"] [data-responsable="QUISPE PRUEBA, ROSA"]').waitFor({ timeout: 30000 })
  await etapa(pagina, 'Pintura').getByRole('button', { name: /Cambiar a quien lleva/ }).click()
  await pagina.getByRole('dialog').getByRole('button', { name: 'Dejarla sin nadie' }).click()
  await pagina.getByRole('dialog').waitFor({ state: 'detached', timeout: 30000 })
  await pagina.locator('[data-etapa="Pintura"] [data-responsable=""]').waitFor({ timeout: 30000 })
  comprobar(/Nadie a cargo todavía/.test(await texto(etapa(pagina, 'Pintura'))), '«Dejarla sin nadie» deja Pintura sin persona')
  await pagina.screenshot({ path: `${CAPTURAS}/6-rrhh-quien-lleva-cada-etapa-1440.png`, fullPage: true })

  // 2. Por persona.
  await pagina.goto(`${BASE}/rrhh/tiempos-de-entrega`, { waitUntil: 'networkidle' })
  await pagina.getByRole('link', { name: 'Por persona' }).click()
  await pagina.waitForURL((u) => u.pathname === '/rrhh/tiempos-de-entrega/personas', { timeout: 60000 })
  const luis = pagina.locator('[data-persona="MAMANI PRUEBA, LUIS"]')
  await luis.waitFor({ timeout: 60000 })
  const textoLuis = await texto(luis)
  console.log(`     Luis: ${textoLuis}`)
  comprobar(/QLE_UNO · Ensamblaje/.test(textoLuis) && /Vencida hace 1 día hábil/.test(textoLuis), 'Luis sale con QLE_UNO · Ensamblaje, vencida hace 1 día hábil')
  comprobar((await pagina.locator('[data-persona="QUISPE PRUEBA, ROSA"]').count()) === 0, 'Rosa ya no sale: no tiene etapas a cargo')
  await pagina.screenshot({ path: `${CAPTURAS}/7-rrhh-por-persona-1440.png`, fullPage: true })
  await luis.getByRole('link').first().click()
  await pagina.waitForURL((u) => u.pathname === '/rrhh/tiempos-de-entrega/codigo', { timeout: 60000 })
  comprobar(new URL(pagina.url()).searchParams.get('codigo') === 'QLE_UNO', 'la etapa de Luis abre su código')
  comprobar(errores.length === 0, `sin errores de consola como RR. HH. (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
}

// ------------------------------------------------------------------ 3. Recursos Humanos, teléfono
{
  const { pagina, contexto, errores } = await entrar('rrhh.local@metalwork.test', 390, 844)
  await pagina.goto(DETALLE, { waitUntil: 'networkidle' })
  await etapa(pagina, 'Pintura').waitFor({ timeout: 60000 })
  comprobar((await desborda(pagina)) <= 0, 'en el teléfono el detalle con los botones no se sale de la pantalla')
  await etapa(pagina, 'Pintura').getByRole('button', { name: /Asignar quién lleva/ }).click()
  await pagina.getByRole('dialog').waitFor()
  await pagina.screenshot({ path: `${CAPTURAS}/8-rrhh-asignar-persona-390.png` })
  await pagina.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click()
  await pagina.goto(PERSONAS, { waitUntil: 'networkidle' })
  await pagina.locator('[data-persona="MAMANI PRUEBA, LUIS"]').waitFor({ timeout: 60000 })
  comprobar((await desborda(pagina)) <= 0, 'en el teléfono «Por persona» no se sale de la pantalla')
  await pagina.screenshot({ path: `${CAPTURAS}/9-rrhh-por-persona-390.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola en el teléfono (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
}

// ------------------------------------------------------------------ 4. Gerencia consulta, no asigna
{
  const { pagina, contexto, errores } = await entrar('gerencia.local@metalwork.test')
  await pagina.goto(DETALLE, { waitUntil: 'networkidle' })
  await etapa(pagina, 'Ensamblaje').waitFor({ timeout: 60000 })
  comprobar(/La lleva: MAMANI PRUEBA, LUIS/.test(await texto(etapa(pagina, 'Ensamblaje'))), 'Gerencia ve quién lleva la etapa')
  comprobar((await pagina.getByRole('button', { name: /Asignar quién lleva|Cambiar a quien lleva/ }).count()) === 0, 'Gerencia no tiene «Asignar persona» ni «Cambiar»')
  await pagina.goto(PERSONAS, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-persona="MAMANI PRUEBA, LUIS"]').count()) === 1, 'Gerencia ve la vista por persona')
  comprobar(errores.length === 0, `sin errores de consola como Gerencia (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
}

// ------------------------------------------------------------------ 5. El supervisor y Diseño lo ven junto a sus etapas
{
  const { pagina, contexto, errores } = await entrar('sup.prd.local@metalwork.test')
  await pagina.goto(`${BASE}/planos?q=QLE_UNO`, { waitUntil: 'networkidle' })
  const suya = pagina.locator('[data-etapa="Ensamblaje"] [data-responsable="MAMANI PRUEBA, LUIS"]')
  await suya.first().waitFor({ timeout: 60000 }).catch(() => {})
  comprobar((await suya.count()) >= 1, 'el supervisor de Producción ve «La lleva: MAMANI PRUEBA, LUIS» en su etapa')
  comprobar(errores.length === 0, `sin errores de consola como supervisor (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
}
{
  const { pagina, contexto, errores } = await entrar('diseno.local@metalwork.test')
  await pagina.goto(`${BASE}/diseno/codigo?codigo=QLE_UNO&vista=etapas`, { waitUntil: 'networkidle' })
  await etapa(pagina, 'Ensamblaje').waitFor({ timeout: 60000 })
  comprobar(/La lleva: MAMANI PRUEBA, LUIS/.test(await texto(etapa(pagina, 'Ensamblaje'))), 'Diseño ve quién lleva la etapa en «Control de etapas»')
  comprobar(errores.length === 0, `sin errores de consola como Diseño (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
}

// ------------------------------------------------------------------ 6. Quien no lleva los tiempos no entra
{
  const { pagina, contexto } = await entrar('tesoreria.local@metalwork.test').catch(() => entrar('almacen.local@metalwork.test'))
  await pagina.goto(PERSONAS, { waitUntil: 'networkidle' })
  comprobar(new URL(pagina.url()).pathname === '/sin-permiso', 'un puesto sin el permiso no entra a «Por persona» por su dirección')
  await contexto.close()
}

await navegador.close()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} comprobación(es) fallan:`)
  for (const f of fallas) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\nTodo pasa.')
