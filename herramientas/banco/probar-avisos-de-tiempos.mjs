/**
 * Los avisos de los tiempos de entrega (migración 20261126310000), mirados en
 * la campana con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Se siembra el código AVI_UNO con una etapa por vencer y una vencida en
 *      Producción, y se corre la revisión diaria como la correría pg_cron.
 *   2. RR. HH. ve los dos avisos en la campana y el de la vencida la lleva al
 *      detalle del código (1440 y 390).
 *   3. El supervisor de Producción los ve y el aviso lo lleva a «Planos».
 *   4. Gerencia ve solo el de la vencida.
 *   5. Tesorería no ve ninguno.
 *
 * Volver a correrlo rehace AVI_UNO y sus avisos. Variables: BANCO_CLAVE, BASE
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

// ------------------------------------------------------------------ La siembra y la revisión
sql(`
do $$
declare
  v_dis uuid := (select id from public.usuarios where correo = 'diseno.local@metalwork.test');
  v_prd uuid := (select id from public.areas where codigo = 'PRD');
begin
  if v_dis is null then raise exception 'Faltan las cuentas locales: corre preparar.sh'; end if;
  delete from public.notificaciones where titulo like '%AVI_UNO%';
  delete from public.tiempos_entrega_avisos a using public.codigo_etapas e where e.id = a.etapa_id and e.codigo_interno = 'AVI_UNO';
  update public.codigo_etapas set quitada_en = now(), quitada_por = v_dis where codigo_interno = 'AVI_UNO' and quitada_en is null;
  insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, fin_plan, inicio_real, creado_por) values
    ('AVI_UNO', 1, 'Armado de chasis', v_prd, current_date - 2, current_date - 6, v_dis),
    ('AVI_UNO', 2, 'Soldadura de paneles', v_prd, public.sumar_dias_habiles(current_date, 2), null, v_dis);
end $$;
`)
// Como pg_cron: sin sesión, el laborable de hoy o el siguiente.
const resultado = sql(`select string_agg(tipo || '=' || avisos, ',' order by tipo) from public.revisar_tiempos_de_entrega(public.sumar_dias_habiles(current_date, 0))`)
console.log(`     revisión: ${resultado}`)
comprobar(/POR_VENCER=1/.test(resultado) && /VENCIDA=1/.test(resultado), 'la revisión avisa la etapa por vencer y la vencida de AVI_UNO')

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

async function abrirCampana(pagina) {
  await pagina.getByRole('button', { name: /^Avisos/ }).first().click()
  const panel = pagina.locator('#panel-avisos')
  await panel.waitFor({ timeout: 30000 })
  await pagina.waitForTimeout(800)
  return panel
}
const deAvi = async (panel) => (await panel.innerText()).replace(/\s+/g, ' ')

// ------------------------------------------------------------------ 1. RR. HH., 1440
{
  const { pagina, contexto, errores } = await entrar('rrhh.local@metalwork.test')
  await pagina.goto(`${BASE}/rrhh/tiempos-de-entrega`, { waitUntil: 'networkidle' })
  const panel = await abrirCampana(pagina)
  const t = await deAvi(panel)
  comprobar(t.includes('Vencida: AVI_UNO · Armado de chasis') && t.includes('Por vencer: AVI_UNO · Soldadura de paneles'), 'RR. HH. ve en la campana la vencida y la por vencer')
  comprobar(t.includes('Nadie la tiene a cargo todavía'), 'el aviso dice que nadie la tiene a cargo')
  await pagina.screenshot({ path: `${CAPTURAS}/10-rrhh-avisos-en-la-campana-1440.png` })
  await panel.getByText('Vencida: AVI_UNO · Armado de chasis').first().click()
  await pagina.waitForURL((u) => u.pathname === '/rrhh/tiempos-de-entrega/codigo', { timeout: 60000 })
  comprobar(new URL(pagina.url()).searchParams.get('codigo') === 'AVI_UNO', 'el aviso lleva a RR. HH. al detalle de AVI_UNO')
  comprobar(errores.length === 0, `sin errores de consola como RR. HH. (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
}

// ------------------------------------------------------------------ 2. RR. HH., teléfono
{
  const { pagina, contexto } = await entrar('rrhh.local@metalwork.test', 390, 844)
  await pagina.goto(`${BASE}/rrhh/tiempos-de-entrega`, { waitUntil: 'networkidle' })
  const panel = await abrirCampana(pagina)
  comprobar((await deAvi(panel)).includes('Por vencer: AVI_UNO'), 'en el teléfono la campana muestra el aviso')
  const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  comprobar(desborde <= 0, 'en el teléfono la campana no se sale de la pantalla')
  await pagina.screenshot({ path: `${CAPTURAS}/11-rrhh-avisos-en-la-campana-390.png` })
  await contexto.close()
}

// ------------------------------------------------------------------ 3. Supervisor de Producción
{
  const { pagina, contexto, errores } = await entrar('sup.prd.local@metalwork.test')
  const panel = await abrirCampana(pagina)
  const t = await deAvi(panel)
  comprobar(t.includes('Vencida: AVI_UNO') && t.includes('Por vencer: AVI_UNO'), 'el supervisor de Producción ve los dos avisos')
  await panel.getByText('Vencida: AVI_UNO · Armado de chasis').first().click()
  await pagina.waitForURL((u) => u.pathname === '/planos', { timeout: 60000 })
  comprobar(new URL(pagina.url()).searchParams.get('q') === 'AVI_UNO', 'el aviso lleva al supervisor a «Planos» con AVI_UNO')
  comprobar(errores.length === 0, `sin errores de consola como supervisor (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
}

// ------------------------------------------------------------------ 4. Gerencia
{
  const { pagina, contexto } = await entrar('gerencia.local@metalwork.test')
  const panel = await abrirCampana(pagina)
  const t = await deAvi(panel)
  comprobar(t.includes('Vencida: AVI_UNO') && !t.includes('Por vencer: AVI_UNO'), 'Gerencia ve la vencida y no la por vencer')
  await contexto.close()
}

// ------------------------------------------------------------------ 5. Tesorería
{
  const { pagina, contexto } = await entrar('tesoreria.local@metalwork.test')
  const panel = await abrirCampana(pagina)
  comprobar(!(await deAvi(panel)).includes('AVI_UNO'), 'Tesorería no ve avisos de tiempos')
  await contexto.close()
}

await navegador.close()
if (fallas.length) {
  console.error(`\n${fallas.length} comprobación(es) fallan.`)
  process.exit(1)
}
console.log('\nTodo pasa.')
