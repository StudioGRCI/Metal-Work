/**
 * El trámite nace de la OT (migración 20261127170000; plan «El puesto de
 * Tramitador», entrega 4), mirado con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Siembra por SQL: una unidad SIN placa y su OT, que se termina por el
 *      camino de siempre (etapa, en proceso, etapa terminada, OT terminada);
 *      la base le abre su tarjeta y sus placas. Y un SOAT de la empresa que el
 *      Tramitador registra y concluye con su vigencia.
 *   2. El Tramitador ve las cifras (por vencer, vencidos, concluidos este mes)
 *      con las cuentas de la base, la marca «Abierto por la OT» en la lista,
 *      la ficha con «Lo abrió: El sistema, al terminar la unidad de la OT…», «Renovar
 *      ahora» en el SOAT y su resultado en las dos fichas, y en el catálogo
 *      los días de «Placas» (1440 y 390).
 *   3. Calidad ve en la OT «Trámites de la OT», sin enlace a fichas que no le
 *      tocan; Ventas los ve con enlace.
 *   4. Gerencia ve las cifras, y «Por vencer» la lleva a su vista.
 *
 * Volver a correrlo reusa la unidad, la OT y el SOAT (un trámite numerado no
 * se borra): si el SOAT ya tiene su renovación, comprueba las dos fichas sin
 * volver a tocar «Renovar ahora».
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

// ------------------------------------------------------------------ La siembra
// El armazón (crear y terminar la OT) va con una cuenta ADMIN del banco, como
// en los checks: no es lo que se prueba. Lo que se prueba se mira después con
// la cuenta de cada puesto.
sql(`
do $$
declare
  v_admin uuid := (select u.id from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'ADMIN' and u.activo order by u.creado_en limit 1);
  v_tra uuid := (select id from public.usuarios where correo = 'tramitador.local@metalwork.test');
  v_cliente uuid := (select cliente_id from public.unidades where cliente_id is not null order by creado_en limit 1);
  v_sede uuid := (select sede_id from public.ordenes_trabajo order by creado_en limit 1);
  v_unidad uuid;
  v_ot uuid;
  v_soat uuid;
  v_hoy date := (now() at time zone 'America/Lima')::date;
  v_ruta text;
begin
  if v_admin is null or v_tra is null or v_cliente is null then raise exception 'Faltan las cuentas o los clientes del banco: corre preparar.sh'; end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  select id into v_unidad from public.unidades where codigo_interno = 'BANCO_TOT_26/90';
  if v_unidad is null then
    insert into public.unidades (cliente_id, codigo_interno, placa, tipo_vehiculo)
    values (v_cliente, 'BANCO_TOT_26/90', null, 'CAMION') returning id into v_unidad;
  end if;

  select id into v_ot from public.ordenes_trabajo where descripcion = 'BANCO · LA OT QUE ABRE SUS TRÁMITES';
  if v_ot is null then
    insert into public.ordenes_trabajo (cliente_id, unidad_id, sede_id, descripcion, tipo_trabajo, estado)
    values (v_cliente, v_unidad, v_sede, 'BANCO · LA OT QUE ABRE SUS TRÁMITES', 'FABRICACION', 'APROBADA') returning id into v_ot;
  end if;
  if (select estado from public.ordenes_trabajo where id = v_ot) = 'APROBADA' then
    insert into public.ot_etapas (orden_id, nombre, orden_secuencia, area_id, peso_pct, fecha_inicio_programada, fecha_fin_programada)
    values (v_ot, 'Fabricación de la tolva', 1, (select id from public.areas where codigo = 'PRD'), 100, v_hoy - 10, v_hoy);
    update public.ordenes_trabajo set estado = 'EN_PROCESO' where id = v_ot;
    update public.ot_etapas set avance_porcentaje = 100, estado = 'TERMINADA' where orden_id = v_ot and estado <> 'OMITIDA';
    update public.ordenes_trabajo set estado = 'TERMINADA' where id = v_ot;
  end if;

  -- El SOAT, con la sesión del Tramitador: lo registra y lo concluye él.
  perform set_config('request.jwt.claim.sub', v_tra::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_tra, 'role', 'authenticated')::text, true);
  select id into v_soat from public.tramites where asunto = 'BANCO · SOAT de la camioneta del taller';
  if v_soat is null then
    v_soat := gen_random_uuid();
    perform * from public.tramites_registrar(v_soat, (select id from public.tramite_tipos where nombre = 'SOAT'), null, null,
      'BANCO · SOAT de la camioneta del taller', 'Aseguradora', null, v_hoy - 1, null, null);
    v_ruta := v_soat::text || '/' || gen_random_uuid()::text || '.pdf';
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('tramites', v_ruta, v_tra::text, jsonb_build_object('mimetype', 'application/pdf', 'size', 2048));
    perform public.tramites_concluir(gen_random_uuid(), v_soat, v_ruta, 'soat.pdf', v_hoy, v_hoy + 200);
  end if;
end $$;
`)
const [otId, otNumero] = sql(`select id || '|' || numero from public.ordenes_trabajo where descripcion = 'BANCO · LA OT QUE ABRE SUS TRÁMITES'`).split('|')
const deLaOt = Object.fromEntries(
  sql(`select string_agg(k.nombre || '=' || t.numero || '=' || t.id, ',') from public.tramites t join public.tramite_tipos k on k.id = t.tipo_id
        where t.orden_id = '${otId}' and t.origen = 'OT'`)
    .split(',')
    .filter(Boolean)
    .map((x) => x.split('='))
    .map(([tipo, numero, id]) => [tipo, { numero, id }]),
)
const [soatId, soatNumero] = sql(`select id || '|' || numero from public.tramites where asunto = 'BANCO · SOAT de la camioneta del taller'`).split('|')
console.log(`     OT ${otNumero} · ${Object.entries(deLaOt).map(([k, v]) => `${k} ${v.numero}`).join(' · ')} · SOAT ${soatNumero}`)
comprobar(Object.keys(deLaOt).sort().join(',') === 'Placas,Tarjeta de propiedad', 'al terminar la OT de la unidad sin placa nacen su tarjeta y sus placas')


// Las cifras que la pantalla tiene que dar, sacadas de la base con la cuenta de cada puesto.
function cifrasDe(correo) {
  const salida = sql(`
begin;
select set_config('request.jwt.claim.sub', (select id::text from public.usuarios where correo = '${correo}'), true),
       set_config('request.jwt.claims', json_build_object('sub', (select id from public.usuarios where correo = '${correo}'), 'role', 'authenticated')::text, true);
set local role authenticated;
select 'CIFRAS=' || (select count(*) from public.tramites_visibles(null) where por_vencer and situacion <> 'POR_ANULAR') || '|' ||
       (select count(*) from public.tramites_visibles(null) where vencido and situacion <> 'POR_ANULAR') || '|' ||
       (select count(*) from public.tramites_visibles(null) where situacion = 'CONCLUIDO'
          and to_char(concluido_en at time zone 'America/Lima', 'YYYY-MM') = to_char(now() at time zone 'America/Lima', 'YYYY-MM'));
rollback;`)
  const [porVencer, vencidos, concluidos] = salida.split('\n').find((l) => l.startsWith('CIFRAS=')).slice(7).split('|').map(Number)
  return { porVencer, vencidos, concluidos }
}

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
const ir = async (pagina, ruta) => {
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle', timeout: 90000 })
}
const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ')
const desborde = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
async function cifrasEnPantalla(pagina) {
  const seccion = pagina.locator('[data-cifras-tramites]')
  await seccion.waitFor({ timeout: 30000 })
  const t = await texto(seccion)
  const de = (titulo) => Number((t.match(new RegExp(`${titulo}\\s*(\\d+)`)) ?? [])[1])
  return { porVencer: de('Por vencer'), vencidos: de('Vencidos'), concluidos: de('Concluidos este mes') }
}
const tarjeta = deLaOt['Tarjeta de propiedad']
const placas = deLaOt['Placas']

// ------------------------------------------------------------------ 1. El Tramitador, 1440
{
  const { pagina, contexto, errores } = await entrar('tramitador.local@metalwork.test')
  await ir(pagina, '/tramites')
  const base = cifrasDe('tramitador.local@metalwork.test')
  const vistas = await cifrasEnPantalla(pagina)
  comprobar(JSON.stringify(vistas) === JSON.stringify(base), `las cifras del Tramitador son las de la base (${JSON.stringify(vistas)} y ${JSON.stringify(base)})`)
  await pagina.screenshot({ path: `${CAPTURAS}/tramite-de-la-ot-lista-tramitador-1440.png` })
  // Buscado por su número: si ya concluyó, la búsqueda abre «Concluidos».
  await ir(pagina, `/tramites?buscar=${tarjeta.numero}`)
  const fila = pagina.locator(`tr[data-tramite="${tarjeta.numero}"]`)
  comprobar((await fila.count()) === 1 && (await texto(fila)).includes('Abierto por la OT'), `en la lista, ${tarjeta.numero} dice «Abierto por la OT»`)
  await ir(pagina, '/tramites')

  // El catálogo: «Placas» se abre al terminar la OT si la unidad no tiene placa.
  await pagina.locator('#tipos-de-tramite > summary').click()
  const placasEnCatalogo = pagina.locator('#tipos-de-tramite li[data-tipo="Placas"]')
  comprobar((await texto(placasEnCatalogo.locator('[data-abre-la-ot]'))).includes('Se abre al terminar la unidad, si no tiene placa: límite a 15 días hábiles'),
    'el catálogo dice que las placas se abren al terminar la OT, si la unidad no tiene placa, a 15 días hábiles')
  await placasEnCatalogo.getByRole('button', { name: 'Editar el tipo Placas' }).click()
  const ventana = pagina.getByRole('dialog', { name: /Editar el tipo «Placas»/ })
  await ventana.waitFor({ timeout: 30000 })
  comprobar((await ventana.locator('[name="dias_ot"]').inputValue()) === '15' && (await ventana.locator('[name="solo_sin_placa"]').isChecked()),
    'al editar «Placas» salen sus 15 días y «solo si la unidad no tiene placa» marcado')
  await pagina.screenshot({ path: `${CAPTURAS}/tramite-de-la-ot-catalogo-placas-1440.png` })
  await pagina.keyboard.press('Escape')

  // La ficha del que abrió la OT.
  await ir(pagina, `/tramites/${tarjeta.id}`)
  const main = pagina.locator('main')
  const t = await texto(main)
  comprobar(t.includes(`El sistema, al terminar la unidad de la OT ${otNumero}`), `la ficha dice «Lo abrió: El sistema, al terminar la unidad de la OT ${otNumero}»`)
  comprobar((await main.locator('[data-origen="OT"]').count()) > 0, 'y lleva la insignia de su origen')
  await pagina.screenshot({ path: `${CAPTURAS}/tramite-de-la-ot-ficha-tramitador-1440.png`, fullPage: true })

  // Renovar ahora, en el SOAT concluido.
  await ir(pagina, `/tramites/${soatId}`)
  const yaRenovado = sql(`select numero from public.tramites where renueva_a = '${soatId}' and estado <> 'ANULADO'`)
  if (!yaRenovado) {
    await pagina.getByRole('button', { name: 'Renovar ahora' }).click()
    const confirmar = pagina.getByRole('dialog', { name: new RegExp(`Renovar el trámite`) })
    await confirmar.waitFor({ timeout: 30000 })
    await pagina.screenshot({ path: `${CAPTURAS}/tramite-de-la-ot-renovar-1440.png` })
    await confirmar.getByRole('button', { name: 'Abrir la renovación' }).click()
    await pagina.getByText(/Renovación TR-\S+ abierta/).first().waitFor({ timeout: 60000 }).catch(() => {})
    comprobar(await pagina.getByText(/Renovación TR-\S+ abierta: está en «En curso», por iniciar\./).first().isVisible().catch(() => false),
      '«Renovar ahora» dice qué renovación abrió')
  } else {
    console.log(`     (el SOAT ya tenía su renovación ${yaRenovado}: no se vuelve a tocar «Renovar ahora»)`)
  }
  const [renovacionId, renovacionNumero] = sql(`select id || '|' || numero from public.tramites where renueva_a = '${soatId}' and estado <> 'ANULADO'`).split('|')
  comprobar(Boolean(renovacionId) && sql(`select count(*) from public.tramites where renueva_a = '${soatId}'`) === '1', 'se abrió una sola renovación')
  await pagina.waitForTimeout(800)
  await ir(pagina, `/tramites/${soatId}`)
  comprobar((await texto(pagina.locator('[data-renovacion]'))).includes(`Se renueva con el ${renovacionNumero}`), `la ficha del SOAT dice «Se renueva con el ${renovacionNumero}»`)
  comprobar((await pagina.getByRole('button', { name: 'Renovar ahora' }).count()) === 0, 'y ya no ofrece «Renovar ahora»')
  await pagina.screenshot({ path: `${CAPTURAS}/tramite-de-la-ot-soat-renovado-1440.png`, fullPage: true })
  await ir(pagina, `/tramites/${renovacionId}`)
  comprobar((await texto(pagina.locator('[data-renovacion]'))).includes(`Renueva el documento del ${soatNumero}`), `la renovación dice «Renueva el documento del ${soatNumero}»`)
  const abrio = sql(`select u.nombres from public.usuarios u where u.correo = 'tramitador.local@metalwork.test'`)
  const tRenovacion = await texto(pagina.locator('main'))
  comprobar(!tRenovacion.includes('El sistema, al acercarse el vencimiento') && tRenovacion.includes(abrio), `la renovación a mano dice quién la abrió (${abrio}), no «el sistema»`)
  await pagina.screenshot({ path: `${CAPTURAS}/tramite-de-la-ot-renovacion-1440.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola como Tramitador (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
}

// ------------------------------------------------------------------ 2. El Tramitador, teléfono
{
  const { pagina, contexto, errores } = await entrar('tramitador.local@metalwork.test', 390, 844)
  await ir(pagina, '/tramites')
  await pagina.locator('[data-cifras-tramites]').waitFor({ timeout: 30000 })
  comprobar((await desborde(pagina)) <= 0, 'en el teléfono la lista con sus cifras no se sale de la pantalla')
  await pagina.screenshot({ path: `${CAPTURAS}/tramite-de-la-ot-lista-tramitador-390.png` })
  await ir(pagina, `/tramites/${tarjeta.id}`)
  comprobar((await desborde(pagina)) <= 0, 'en el teléfono la ficha no se sale de la pantalla')
  await pagina.screenshot({ path: `${CAPTURAS}/tramite-de-la-ot-ficha-tramitador-390.png`, fullPage: true })
  // El Tramitador no ve las OT (no tiene «ordenes.ver»): la ficha dice de qué OT es, sin enlace.
  await ir(pagina, `/ordenes/${otId}`)
  comprobar(!new URL(pagina.url()).pathname.startsWith('/ordenes/'), `el Tramitador no entra a la OT (${new URL(pagina.url()).pathname})`)
  comprobar(errores.length === 0, `sin errores de consola en el teléfono (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
}

// ------------------------------------------------------------------ 3. Calidad y Ventas, en la OT
const yaCumplida = sql(`select count(*) from public.tramites where orden_id = '${otId}' and origen = 'OT' and estado <> 'CONCLUIDO'`) === '0'
for (const [correo, puesto, conEnlace, ancho, alto] of [
  ['calidad.local@metalwork.test', 'Calidad', false, 1440, 900],
  ['ventas.local@metalwork.test', 'Ventas', true, 390, 844],
]) {
  const { pagina, contexto, errores } = await entrar(correo, ancho, alto)
  await ir(pagina, `/ordenes/${otId}`)
  const bloque = pagina.locator('[data-tramites-de-la-ot]')
  const hay = await bloque.waitFor({ timeout: 30000 }).then(() => true).catch(() => false)
  const t = hay ? await texto(bloque) : ''
  comprobar(hay && t.includes(tarjeta.numero) && t.includes(placas.numero) && t.includes('Tarjeta de propiedad') && t.includes('Placas'),
    `${puesto} ve en la OT sus dos trámites con su tipo`)
  comprobar(yaCumplida || /vence el \d\d\/\d\d\/\d{4}/.test(t), `${puesto} ve hasta cuándo hay plazo`)
  // La OT nueva (plan de etapas de Diseño) no tiene «Fechas clave»: va en su propia tarjeta.
  const cumplimiento = pagina.locator('[data-cumplimiento-tarjeta]')
  comprobar((await cumplimiento.count()) === 1 && (yaCumplida ? /Cumplida/ : /Tarjeta de propiedad y placas.*Vence el \d\d\/\d\d\/\d{4}/).test(await texto(cumplimiento)),
    `${puesto} ve si la tarjeta y las placas se cumplieron (${yaCumplida ? '«Cumplida»' : 'todavía no: «Vence el…»'})`)
  comprobar(hay && (await bloque.locator('a').count()) === (conEnlace ? 2 : 0), conEnlace ? `${puesto}, que ve los trámites de las unidades, tiene el enlace a la ficha` : `${puesto} no tiene enlace a fichas que no le tocan`)
  comprobar((await desborde(pagina)) <= 0, `la OT de ${puesto} no se sale de la pantalla (${ancho})`)
  await pagina.locator('[data-cumplimiento-tarjeta]').scrollIntoViewIfNeeded().catch(() => {})
  await pagina.screenshot({ path: `${CAPTURAS}/tramite-de-la-ot-orden-${puesto.toLowerCase()}-${ancho}.png` })
  comprobar(errores.length === 0, `sin errores de consola como ${puesto} (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
}

// ------------------------------------------------------------------ 4. Gerencia
{
  const { pagina, contexto, errores } = await entrar('gerencia.local@metalwork.test')
  await ir(pagina, '/tramites')
  const base = cifrasDe('gerencia.local@metalwork.test')
  const vistas = await cifrasEnPantalla(pagina)
  comprobar(JSON.stringify(vistas) === JSON.stringify(base), `las cifras de Gerencia son las de la base (${JSON.stringify(vistas)} y ${JSON.stringify(base)})`)
  await pagina.screenshot({ path: `${CAPTURAS}/tramite-de-la-ot-lista-gerencia-1440.png` })
  await pagina.locator('[data-cifras-tramites] a[href="/tramites?vista=por-vencer"]').click()
  await pagina.waitForURL((u) => u.search.includes('vista=por-vencer'), { timeout: 60000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  const filas = await pagina.locator('tr[data-tramite]').count()
  comprobar(pagina.url().includes('vista=por-vencer') && filas === base.porVencer, `«Por vencer» la lleva a su vista, con ${base.porVencer} fila(s) (${filas})`)
  comprobar((await pagina.getByRole('button', { name: 'Renovar ahora' }).count()) === 0, 'Gerencia no tiene «Renovar ahora»')
  comprobar(errores.length === 0, `sin errores de consola como Gerencia (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
  const tel = await entrar('gerencia.local@metalwork.test', 390, 844)
  await ir(tel.pagina, '/tramites')
  await tel.pagina.locator('[data-cifras-tramites]').waitFor({ timeout: 30000 })
  comprobar((await desborde(tel.pagina)) <= 0, 'en el teléfono de Gerencia las cifras no se salen de la pantalla')
  await tel.pagina.screenshot({ path: `${CAPTURAS}/tramite-de-la-ot-lista-gerencia-390.png` })
  await tel.contexto.close()
}

// ------------------------------------------------------------------ 5. El Tramitador concluye las dos y la OT lo dice
if (!yaCumplida) {
  sql(`
do $$
declare
  v_tra uuid := (select id from public.usuarios where correo = 'tramitador.local@metalwork.test');
  t record;
  v_ruta text;
begin
  perform set_config('request.jwt.claim.sub', v_tra::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_tra, 'role', 'authenticated')::text, true);
  for t in select id, asunto, fecha_limite from public.tramites where orden_id = '${otId}' and origen = 'OT' and estado <> 'CONCLUIDO' loop
    perform public.tramites_actualizar(t.id, 'EN_TRAMITE', t.asunto, 'SUNARP', 'BANCO-OT', (now() at time zone 'America/Lima')::date,
      t.fecha_limite, null, (select actualizado_en from public.tramites where id = t.id));
    v_ruta := t.id::text || '/' || gen_random_uuid()::text || '.pdf';
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('tramites', v_ruta, v_tra::text, jsonb_build_object('mimetype', 'application/pdf', 'size', 2048));
    perform public.tramites_concluir(gen_random_uuid(), t.id, v_ruta, 'documento.pdf', (now() at time zone 'America/Lima')::date, null);
  end loop;
end $$;`)
}
for (const [ancho, alto] of [[1440, 900], [390, 844]]) {
  const { pagina, contexto, errores } = await entrar('calidad.local@metalwork.test', ancho, alto)
  await ir(pagina, `/ordenes/${otId}`)
  const cumplimiento = pagina.locator('[data-cumplimiento-tarjeta]')
  await cumplimiento.waitFor({ timeout: 30000 }).catch(() => {})
  const t = (await cumplimiento.count()) ? await texto(cumplimiento) : ''
  comprobar(/Cumplida/.test(t) && !/atraso/.test(t), `con las dos concluidas a tiempo, la OT dice «Cumplida» (${ancho})`)
  comprobar((await texto(pagina.locator('[data-tramites-de-la-ot]'))).includes('Concluido el'), `y cada trámite «Concluido el…» (${ancho})`)
  comprobar((await desborde(pagina)) <= 0, `la OT no se sale de la pantalla (${ancho})`)
  await cumplimiento.scrollIntoViewIfNeeded().catch(() => {})
  await pagina.screenshot({ path: `${CAPTURAS}/tramite-de-la-ot-orden-cumplida-calidad-${ancho}.png` })
  comprobar(errores.length === 0, `sin errores de consola como Calidad (${ancho}) (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
}

await navegador.close()
if (fallas.length) {
  console.error(`\n${fallas.length} comprobación(es) fallan.`)
  process.exit(1)
}
console.log('\nTodo pasa.')
