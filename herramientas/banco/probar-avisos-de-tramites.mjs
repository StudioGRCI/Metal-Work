/**
 * Los avisos de los trámites (migración 20261127003000; plan «El puesto de
 * Tramitador», entrega 3), mirados en la campana con la cuenta de cada puesto
 * (nunca ADMIN):
 *
 *   1. Se registran con la cuenta del Tramitador (por SQL, con su sesión) dos
 *      trámites: AVT-1, de una unidad, que vence en 3 días, y AVT-2, de la
 *      empresa, que venció hace 2. Se corre la revisión diaria como la
 *      correría pg_cron, el primer día laborable desde hoy.
 *   2. El Tramitador ve «Por vencer» y «Venció» en la campana, no se avisó a sí
 *      mismo de lo que registró, y el aviso lo lleva a la ficha (1440 y 390).
 *   3. Gerencia ve solo el vencido, y el aviso abre la ficha.
 *   4. Ventas y Tesorería no ven ninguno.
 *
 * Volver a correrlo reusa AVT-1 y AVT-2 (un trámite numerado no se borra):
 * les vuelve a poner la fecha y quita sus avisos anteriores del banco.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * CAPTURAS, BANCO_CHROMIUM.
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
  v_tra uuid := (select id from public.usuarios where correo = 'tramitador.local@metalwork.test');
  v_unidad uuid := (select id from public.unidades where placa is not null order by creado_en limit 1);
  v_tarjeta uuid := (select id from public.tramite_tipos where nombre = 'Tarjeta de propiedad');
  v_licencia uuid := (select id from public.tramite_tipos where nombre = 'Licencia de funcionamiento');
  v_dia date := (select min(x)::date from generate_series((now() at time zone 'America/Lima')::date, (now() at time zone 'America/Lima')::date + 20, interval '1 day') x
                  where public.es_laborable(x::date));
begin
  if v_tra is null or v_unidad is null then raise exception 'Faltan las cuentas o las unidades del banco: corre preparar.sh'; end if;
  perform set_config('request.jwt.claim.sub', v_tra::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_tra, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.tramites where asunto = 'AVT-1 Tarjeta de la unidad del banco') then
    perform * from public.tramites_registrar(gen_random_uuid(), v_tarjeta, v_unidad, null,
      'AVT-1 Tarjeta de la unidad del banco', 'SUNARP', null, v_dia - 5, v_dia + 3, null);
  end if;
  if not exists (select 1 from public.tramites where asunto = 'AVT-2 Licencia del local del banco') then
    perform * from public.tramites_registrar(gen_random_uuid(), v_licencia, null, null,
      'AVT-2 Licencia del local del banco', 'Municipalidad', null, v_dia - 9, v_dia + 1, null);
  end if;
  -- Las fechas de esta corrida, por debajo: la ficha no deja poner una fecha límite pasada.
  set local session_replication_role = replica;
  update public.tramites set fecha_limite = v_dia + 3, estado = 'EN_TRAMITE' where asunto = 'AVT-1 Tarjeta de la unidad del banco';
  update public.tramites set fecha_limite = v_dia - 2, estado = 'EN_TRAMITE' where asunto = 'AVT-2 Licencia del local del banco';
  delete from public.tramite_avisos a using public.tramites t where t.id = a.tramite_id and t.asunto like 'AVT-_ %';
  delete from public.notificaciones n using public.tramites t where t.id = n.origen_id and t.asunto like 'AVT-_ %' and n.titulo not like 'Trámite nuevo%';
end $$;
`)
const numeros = Object.fromEntries(
  sql(`select string_agg(left(asunto, 5) || '=' || numero || '=' || id, ',') from public.tramites where asunto like 'AVT-_ %'`)
    .split(',')
    .map((x) => x.split('='))
    .map(([clave, numero, id]) => [clave, { numero, id }]),
)
const resultado = sql(`
  select string_agg(tipo || '=' || avisos, ',' order by tipo)
    from public.revisar_tramites((select min(x)::date from generate_series((now() at time zone 'America/Lima')::date, (now() at time zone 'America/Lima')::date + 20, interval '1 day') x where public.es_laborable(x::date)))`)
console.log(`     revisión: ${resultado} · ${numeros['AVT-1'].numero} y ${numeros['AVT-2'].numero}`)
comprobar(/(^|,)POR_VENCER=\d/.test(resultado) && !/(^|,)POR_VENCER=0/.test(resultado), 'la revisión avisa el trámite por vencer')
comprobar(!/(^|,)VENCIDO=0/.test(resultado), 'la revisión avisa el trámite vencido')

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
const textoDe = async (panel) => (await panel.innerText()).replace(/\s+/g, ' ')
const uno = numeros['AVT-1']
const dos = numeros['AVT-2']

// ------------------------------------------------------------------ 1. El Tramitador, 1440
{
  const { pagina, contexto, errores } = await entrar('tramitador.local@metalwork.test')
  const panel = await abrirCampana(pagina)
  const t = await textoDe(panel)
  comprobar(t.includes(`Por vencer: ${uno.numero} · vence en 3 días`), `el Tramitador ve «Por vencer: ${uno.numero} · vence en 3 días»`)
  comprobar(t.includes(`Venció el trámite ${dos.numero}`), `y «Venció el trámite ${dos.numero}»`)
  comprobar(t.includes('Licencia de funcionamiento · de la empresa: AVT-2 Licencia del local del banco'), 'el aviso dice el tipo y qué se tramita')
  comprobar(!t.includes(`Trámite nuevo: ${uno.numero}`) && !t.includes(`Trámite nuevo: ${dos.numero}`), 'no se avisó a sí mismo de lo que registró')
  await pagina.screenshot({ path: `${CAPTURAS}/avisos-tramitador-campana-1440.png` })
  await panel.getByText(`Venció el trámite ${dos.numero}`).first().click()
  await pagina.waitForURL((u) => u.pathname === `/tramites/${dos.id}`, { timeout: 60000 }).catch(() => {})
  comprobar(new URL(pagina.url()).pathname === `/tramites/${dos.id}`, 'el aviso lo lleva a la ficha del trámite')
  comprobar(errores.length === 0, `sin errores de consola como Tramitador (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
}

// ------------------------------------------------------------------ 2. El Tramitador, teléfono
{
  const { pagina, contexto } = await entrar('tramitador.local@metalwork.test', 390, 844)
  const panel = await abrirCampana(pagina)
  comprobar((await textoDe(panel)).includes(`Por vencer: ${uno.numero}`), 'en el teléfono la campana muestra el aviso')
  const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  comprobar(desborde <= 0, 'en el teléfono la campana no se sale de la pantalla')
  await pagina.screenshot({ path: `${CAPTURAS}/avisos-tramitador-campana-390.png` })
  await panel.getByText(`Por vencer: ${uno.numero}`).first().click()
  await pagina.waitForURL((u) => u.pathname === `/tramites/${uno.id}`, { timeout: 60000 }).catch(() => {})
  comprobar(new URL(pagina.url()).pathname === `/tramites/${uno.id}`, 'en el teléfono el aviso abre la ficha')
  await contexto.close()
}

// ------------------------------------------------------------------ 3. Gerencia
{
  const { pagina, contexto, errores } = await entrar('gerencia.local@metalwork.test')
  const panel = await abrirCampana(pagina)
  const t = await textoDe(panel)
  comprobar(t.includes(`Venció el trámite ${dos.numero}`), 'Gerencia ve el trámite vencido')
  comprobar(!t.includes(`Por vencer: ${uno.numero}`), 'y no el que está por vencer')
  await pagina.screenshot({ path: `${CAPTURAS}/avisos-gerencia-campana-1440.png` })
  await panel.getByText(`Venció el trámite ${dos.numero}`).first().click()
  await pagina.waitForURL((u) => u.pathname === `/tramites/${dos.id}`, { timeout: 60000 }).catch(() => {})
  comprobar(new URL(pagina.url()).pathname === `/tramites/${dos.id}` && (await pagina.locator('main').innerText()).includes(dos.numero),
    'el aviso le abre la ficha, que Gerencia puede leer')
  comprobar(errores.length === 0, `sin errores de consola como Gerencia (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
}

// ------------------------------------------------------------------ 4. Ventas y Tesorería
for (const [correo, puesto] of [['ventas.local@metalwork.test', 'Ventas'], ['tesoreria.local@metalwork.test', 'Tesorería']]) {
  const { pagina, contexto } = await entrar(correo)
  const panel = await abrirCampana(pagina)
  const t = await textoDe(panel)
  comprobar(!t.includes(uno.numero) && !t.includes(dos.numero), `${puesto} no recibe avisos de trámites`)
  await contexto.close()
}

await navegador.close()
if (fallas.length) {
  console.error(`\n${fallas.length} comprobación(es) fallan.`)
  process.exit(1)
}
console.log('\nTodo pasa.')
