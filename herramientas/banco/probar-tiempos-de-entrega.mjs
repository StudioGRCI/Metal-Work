/**
 * Clic real sobre los tiempos de entrega por código interno que lleva Recursos
 * Humanos (migración 20261125100000), con la cuenta de cada puesto (nunca
 * ADMIN):
 *
 *   1. RR. HH. tiene «Tiempos de entrega» en su menú, ve los códigos sin
 *      entregar con lo vencido primero, cada uno con su color, y los cuenta.
 *   2. Filtra por «Vencidos» y por el área de la etapa en curso; busca por
 *      cliente.
 *   3. Abre un código: la entrega al cliente, cada etapa con su plazo en días
 *      hábiles, las subetapas debajo y lo que reportó el área.
 *   4. En el teléfono (390) la lista y el detalle no se salen de la pantalla.
 *   5. Gerencia lo consulta desde su menú.
 *   6. Almacén y Diseño no entran, ni por la dirección.
 *   7. Diseño sigue viendo su semáforo de etapas, ahora con días hábiles.
 *
 * Siembra sus propios códigos (TDE_…) en la base del banco, con fechas que
 * salen de hoy y del calendario laboral; volver a correrlo los rehace.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * CAPTURAS.
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
// Cuatro códigos: uno vencido con una etapa de cada color y una subetapa, uno a
// tiempo con su OT, uno que solo tiene la entrega por vencer y uno sin fechas.
sql(`
do $$
declare
  v_dis uuid := (select id from public.usuarios where correo = 'diseno.local@metalwork.test');
  v_prd uuid := (select id from public.areas where codigo = 'PRD');
  v_mtz uuid := (select id from public.areas where codigo = 'MTZ');
  v_acb uuid := (select id from public.areas where codigo = 'ACB');
  v_sede uuid := (select id from public.sedes order by creado_en limit 1);
  v_cli uuid; v_uni uuid; v_padre uuid;
begin
  if v_dis is null then raise exception 'Falta la cuenta diseno.local@metalwork.test: corre preparar.sh'; end if;
  -- Volver a correr: lo sembrado antes se va (las etapas se quitan, no se borran).
  update public.codigo_etapas set quitada_en = now(), quitada_por = v_dis where codigo_interno like 'TDE\\_%' and quitada_en is null;

  insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20999461015', 'TRANSPORTES DE PRUEBA TDE S.A.C.')
  on conflict do nothing;
  select id into v_cli from public.clientes where numero_documento = '20999461015';

  insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_plan, fin_plan, inicio_real, fin_real, nota, creado_por)
  values ('TDE_VENCIDO', 1, 'Habilitado', v_mtz, current_date - 20, current_date - 10, current_date - 20, current_date - 6,
          'Llegó tarde la plancha de 3 mm', v_dis),
         ('TDE_VENCIDO', 2, 'Ensamblaje', v_prd, current_date - 9, current_date - 1, current_date - 5, null, null, v_dis),
         ('TDE_VENCIDO', 3, 'Arenado y pintura', v_acb, current_date, current_date, null, null, null, v_dis),
         ('TDE_VENCIDO', 4, 'Acabados finales', v_acb, null, public.sumar_dias_habiles(current_date, 3), null, null, null, v_dis),
         ('TDE_VENCIDO', 5, 'Trámites y entrega', null, null, public.sumar_dias_habiles(current_date, 8), null, null, null, v_dis),
         ('TDE_VENCIDO', 6, 'Prueba de ruta', null, null, null, null, null, null, v_dis);
  select id into v_padre from public.codigo_etapas where codigo_interno = 'TDE_VENCIDO' and nombre = 'Ensamblaje' and quitada_en is null;
  insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, fin_plan, padre_id, de_area, creado_por)
  values ('TDE_VENCIDO', 7, 'Armado del piso', v_prd, current_date - 2, v_padre, true, v_dis);

  insert into public.codigo_etapas (codigo_interno, orden, nombre, area_id, fin_plan, inicio_real, creado_por)
  values ('TDE_A_TIEMPO', 1, 'Habilitado', v_mtz, public.sumar_dias_habiles(current_date, 6), current_date - 1, v_dis),
         ('TDE_A_TIEMPO', 2, 'Ensamblaje', v_prd, public.sumar_dias_habiles(current_date, 15), null, v_dis);

  if not exists (select 1 from public.unidades where codigo_interno like 'TDE\\_%') then
    insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'TDE_VENCIDO', 'Volvo') returning id into v_uni;
    insert into public.ordenes_trabajo (cliente_id, unidad_id, abierta_en_taller, sede_id, descripcion, fecha_entrega_comprometida)
    values (v_cli, v_uni, true, v_sede, 'Semirremolque plataforma · prueba TDE', public.sumar_dias_habiles(current_date, 10));
    insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'TDE_A_TIEMPO', 'Scania') returning id into v_uni;
    insert into public.ordenes_trabajo (cliente_id, unidad_id, abierta_en_taller, sede_id, descripcion, fecha_entrega_comprometida)
    values (v_cli, v_uni, true, v_sede, 'Furgón · prueba TDE', public.sumar_dias_habiles(current_date, 25));
    insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'TDE_ENTREGA', 'Hino') returning id into v_uni;
    insert into public.ordenes_trabajo (cliente_id, unidad_id, abierta_en_taller, sede_id, descripcion, fecha_entrega_comprometida)
    values (v_cli, v_uni, true, v_sede, 'Baranda · prueba TDE', current_date);
    insert into public.unidades (cliente_id, codigo_interno, marca) values (v_cli, 'TDE_SIN_FECHA', 'Isuzu') returning id into v_uni;
    insert into public.ordenes_trabajo (cliente_id, unidad_id, abierta_en_taller, sede_id, descripcion)
    values (v_cli, v_uni, true, v_sede, 'Tolva · prueba TDE');
  end if;
  -- Las fechas de entrega salen de hoy: se rehacen en cada corrida.
  update public.ordenes_trabajo o set fecha_entrega_comprometida = case u.codigo_interno
           when 'TDE_VENCIDO' then public.sumar_dias_habiles(current_date, 10)
           when 'TDE_A_TIEMPO' then public.sumar_dias_habiles(current_date, 25)
           when 'TDE_ENTREGA' then current_date end
    from public.unidades u
   where u.id = o.unidad_id and u.codigo_interno in ('TDE_VENCIDO', 'TDE_A_TIEMPO', 'TDE_ENTREGA');
end $$;
`)
const esperado = sql(`
  select json_build_object(
    'limite', to_char(public.limite_por_vencer(), 'DD/MM/YYYY'),
    'entrega', to_char(public.sumar_dias_habiles(current_date, 10), 'DD/MM/YYYY'),
    'atraso', -public.dias_habiles_entre(current_date, current_date - 1),
    'holgura', public.dias_habiles_entre(current_date, public.sumar_dias_habiles(current_date, 8)))`)
const { entrega, atraso, holgura } = JSON.parse(esperado)

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
const fila = (pagina, codigo) => pagina.locator(`[data-codigo="${codigo}"]`)
const etapa = (pagina, nombre) => pagina.locator(`[data-etapa="${nombre}"]`)
const desborda = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
const RUTA = '/rrhh/tiempos-de-entrega'
const detalle = (codigo) => `${BASE}${RUTA}/codigo?${new URLSearchParams({ codigo })}`

// ------------------------------------------------------------------ 1 a 3. Recursos Humanos, monitor
{
  const { pagina, contexto, errores } = await entrar('rrhh.local@metalwork.test')
  const enMenu = pagina.locator('nav[aria-label="Menú principal"] a', { hasText: 'Tiempos de entrega' })
  comprobar((await enMenu.count()) === 1, 'RR. HH. tiene «Tiempos de entrega» en su menú')
  await enMenu.click()
  await pagina.waitForURL((u) => u.pathname === RUTA, { timeout: 60000 })
  await fila(pagina, 'TDE_VENCIDO').waitFor({ timeout: 60000 })
  comprobar((await texto(pagina.locator('h1'))) === 'Tiempos de entrega', 'abre la pantalla «Tiempos de entrega»')

  const codigos = await pagina.locator('[data-codigo]').evaluateAll((l) => l.map((e) => `${e.dataset.codigo}:${e.dataset.semaforo}`))
  console.log(`     lista: ${codigos.join(' | ')}`)
  const tde = codigos.filter((c) => c.startsWith('TDE_'))
  comprobar(
    tde.join(',') === 'TDE_VENCIDO:ROJO,TDE_ENTREGA:AMBAR,TDE_A_TIEMPO:VERDE,TDE_SIN_FECHA:SIN_FECHA',
    'los cuatro códigos salen en orden: vencido, por vencer, a tiempo y sin fechas',
  )
  comprobar(codigos[0].endsWith(':ROJO'), 'lo vencido va primero en la lista')

  const vencido = await texto(fila(pagina, 'TDE_VENCIDO'))
  console.log(`     TDE_VENCIDO: ${vencido}`)
  comprobar(/Vencido/.test(vencido) && /2 etapas vencidas/.test(vencido) && /2 por vencer/.test(vencido), 'la fila del vencido dice «Vencido», 2 etapas vencidas y 2 por vencer')
  comprobar(/1 de 6 etapas terminadas/.test(vencido) && /Ahora: Ensamblaje \(Producción\)/i.test(vencido), 'dice 1 de 6 etapas terminadas y que va en Ensamblaje (Producción)')
  comprobar(vencido.includes('TRANSPORTES DE PRUEBA TDE S.A.C.') && /OT \d/.test(vencido), 'lleva su OT y su cliente en mayúsculas')
  comprobar(vencido.includes(`Entrega al cliente: ${entrega}`), `la fecha de entrega es la de la OT (${entrega})`)

  const entregaHoy = await texto(fila(pagina, 'TDE_ENTREGA'))
  console.log(`     TDE_ENTREGA: ${entregaHoy}`)
  comprobar(/Por vencer/.test(entregaHoy) && /Vence hoy/.test(entregaHoy) && /Sin etapas cargadas/.test(entregaHoy), 'el que se entrega hoy sale por vencer, «Vence hoy», sin etapas cargadas')
  const sinFecha = await texto(fila(pagina, 'TDE_SIN_FECHA'))
  comprobar(/Sin fechas/.test(sinFecha) && /Sin fecha de entrega al cliente/.test(sinFecha), 'el que no tiene nada dice «Sin fechas» y «Sin fecha de entrega al cliente»')

  await pagina.screenshot({ path: `${CAPTURAS}/1-rrhh-tiempos-de-entrega-1440.png`, fullPage: true })

  // Filtro por color.
  await pagina.getByRole('link', { name: /^Vencidos \(\d+\)$/ }).click()
  await pagina.waitForURL((u) => u.searchParams.get('ver') === 'vencidos', { timeout: 30000 })
  await fila(pagina, 'TDE_A_TIEMPO').waitFor({ state: 'detached', timeout: 30000 })
  const soloRojos = await pagina.locator('[data-codigo]').evaluateAll((l) => l.every((e) => e.dataset.semaforo === 'ROJO'))
  comprobar(soloRojos && (await fila(pagina, 'TDE_VENCIDO').count()) === 1, '«Vencidos» deja solo los rojos, con TDE_VENCIDO')

  // Buscar por cliente conserva lo que hay y encuentra los cuatro.
  await pagina.goto(`${BASE}${RUTA}?q=${encodeURIComponent('transportes de prueba tde')}`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-codigo]').count()) === 4, 'buscar por el cliente encuentra sus cuatro códigos')

  // Filtro por área de la etapa en curso.
  await pagina.getByRole('link', { name: 'Maestranza', exact: true }).click()
  await pagina.waitForURL((u) => u.searchParams.get('area') === 'Maestranza', { timeout: 30000 })
  await fila(pagina, 'TDE_VENCIDO').waitFor({ state: 'detached', timeout: 30000 })
  comprobar(
    (await pagina.locator('[data-codigo]').evaluateAll((l) => l.map((e) => e.dataset.codigo).join(','))) === 'TDE_A_TIEMPO',
    'el área Maestranza deja solo el código que va en Habilitado',
  )

  // 3. El detalle.
  await pagina.goto(`${BASE}${RUTA}`, { waitUntil: 'networkidle' })
  await fila(pagina, 'TDE_VENCIDO').click()
  await pagina.waitForURL((u) => u.pathname === `${RUTA}/codigo`, { timeout: 60000 })
  await etapa(pagina, 'Ensamblaje').waitFor({ timeout: 60000 })
  comprobar((await texto(pagina.locator('h1'))) === 'TDE_VENCIDO', 'la fila abre el detalle del código')
  const semaforos = await pagina.locator('[data-etapa]').evaluateAll((l) => l.map((e) => `${e.dataset.etapa}:${e.dataset.semaforo}`).join(' | '))
  console.log(`     etapas: ${semaforos}`)
  comprobar(
    semaforos ===
      'Habilitado:TERMINADA | Ensamblaje:ROJO | Armado del piso:ROJO | Arenado y pintura:AMBAR | Acabados finales:AMBAR | Trámites y entrega:VERDE | Prueba de ruta:SIN_FECHA',
    'cada etapa con su color, y la subetapa debajo de la suya',
  )
  const habilitado = await texto(etapa(pagina, 'Habilitado'))
  comprobar(/Terminó tarde/.test(habilitado) && /Llegó tarde la plancha/.test(habilitado), 'la terminada después de su fecha dice «Terminó tarde» y muestra su nota')
  const ensamblaje = await texto(etapa(pagina, 'Ensamblaje'))
  console.log(`     Ensamblaje: ${ensamblaje}`)
  comprobar(
    ensamblaje.includes(atraso > 0 ? `Vencida hace ${atraso} ${atraso === 1 ? 'día hábil' : 'días hábiles'}` : 'Vencida') && /En proceso/.test(ensamblaje),
    'la vencida ayer dice hace cuántos días hábiles y que está en proceso',
  )
  comprobar(/Vence hoy/.test(await texto(etapa(pagina, 'Arenado y pintura'))), 'la de hoy dice «Vence hoy»')
  comprobar(/Vence en 3 días hábiles/.test(await texto(etapa(pagina, 'Acabados finales'))), 'la del límite dice «Vence en 3 días hábiles»')
  comprobar((await texto(etapa(pagina, 'Trámites y entrega'))).includes(`Faltan ${holgura} días hábiles`), `la que va a tiempo dice «Faltan ${holgura} días hábiles»`)
  comprobar(/Sin fecha comprometida/.test(await texto(etapa(pagina, 'Prueba de ruta'))), 'la que no tiene fecha lo dice')
  const cabecera = await texto(pagina.locator('main'))
  comprobar(cabecera.includes(entrega) && /Faltan 10 días hábiles/.test(cabecera), 'arriba va la entrega al cliente con sus 10 días hábiles')
  comprobar(/Ningún área reportó trabajo para este código/.test(cabecera), 'sin reportes diarios, las actividades dicen qué falta')
  comprobar((await pagina.locator('main input, main select, main textarea, main form, main button[type="submit"]').count()) === 0, 'el detalle no tiene nada que escribir: es de consulta')
  await pagina.screenshot({ path: `${CAPTURAS}/2-rrhh-tiempos-del-codigo-1440.png`, fullPage: true })

  // Un código que no es de aquí.
  await pagina.goto(detalle('NO_EXISTE_TDE'), { waitUntil: 'networkidle' })
  const noEsta = await texto(pagina.locator('body'))
  console.log(`     código que no existe: ${noEsta.slice(-160)}`)
  comprobar(/no existe|no se encontró|no encontr/i.test(noEsta) && (await pagina.locator('[data-etapa]').count()) === 0, 'un código que no existe dice que no se encontró')
  comprobar(errores.length === 0, `sin errores de consola como RR. HH. (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
}

// ------------------------------------------------------------------ 4. Recursos Humanos, teléfono
{
  const { pagina, contexto, errores } = await entrar('rrhh.local@metalwork.test', 390, 844)
  await pagina.goto(`${BASE}${RUTA}`, { waitUntil: 'networkidle' })
  await fila(pagina, 'TDE_VENCIDO').waitFor({ timeout: 60000 })
  comprobar((await desborda(pagina)) <= 0, 'en el teléfono la lista no se sale de la pantalla')
  await pagina.screenshot({ path: `${CAPTURAS}/3-rrhh-tiempos-de-entrega-390.png`, fullPage: true })
  await pagina.goto(detalle('TDE_VENCIDO'), { waitUntil: 'networkidle' })
  await etapa(pagina, 'Ensamblaje').waitFor({ timeout: 60000 })
  comprobar((await desborda(pagina)) <= 0, 'en el teléfono el detalle no se sale de la pantalla')
  const chica = await pagina.locator('main *').evaluateAll((l) =>
    l.filter((e) => e.children.length === 0 && e.textContent?.trim() && parseFloat(getComputedStyle(e).fontSize) < 12).map((e) => e.textContent?.trim().slice(0, 30)),
  )
  comprobar(chica.length === 0, `ninguna letra menor de 12 px en el detalle (${chica.join(' · ') || 'ninguna'})`)
  await pagina.screenshot({ path: `${CAPTURAS}/4-rrhh-tiempos-del-codigo-390.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola en el teléfono (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
}

// ------------------------------------------------------------------ 5. Gerencia consulta
{
  const { pagina, contexto, errores } = await entrar('gerencia.local@metalwork.test')
  const enMenu = pagina.locator('nav[aria-label="Menú principal"] a', { hasText: 'Tiempos de entrega' })
  comprobar((await enMenu.count()) === 1, 'Gerencia tiene «Tiempos de entrega» en su menú')
  await enMenu.click()
  await fila(pagina, 'TDE_VENCIDO').waitFor({ timeout: 60000 })
  comprobar((await pagina.locator('[data-codigo^="TDE_"]').count()) === 4, 'Gerencia ve los cuatro códigos')
  comprobar(errores.length === 0, `sin errores de consola como Gerencia (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
}

// ------------------------------------------------------------------ 6. Quien no lo lleva no entra
for (const [correo, puesto] of [
  ['almacen.local@metalwork.test', 'Almacén'],
  ['diseno.local@metalwork.test', 'Diseño'],
]) {
  const { pagina, contexto } = await entrar(correo)
  comprobar((await pagina.locator('nav[aria-label="Menú principal"] a', { hasText: 'Tiempos de entrega' }).count()) === 0, `${puesto} no lo tiene en su menú`)
  await pagina.goto(`${BASE}${RUTA}`, { waitUntil: 'networkidle' })
  comprobar(new URL(pagina.url()).pathname === '/sin-permiso', `${puesto} no entra a la lista por su dirección`)
  await pagina.goto(detalle('TDE_VENCIDO'), { waitUntil: 'networkidle' })
  comprobar(new URL(pagina.url()).pathname === '/sin-permiso', `${puesto} no entra al detalle por su dirección`)
  await contexto.close()
}

// ------------------------------------------------------------------ 7. Diseño conserva su semáforo, con días hábiles
{
  const { pagina, contexto, errores } = await entrar('diseno.local@metalwork.test')
  await pagina.goto(`${BASE}/diseno/codigo?${new URLSearchParams({ codigo: 'TDE_VENCIDO', vista: 'etapas' })}`, { waitUntil: 'networkidle' })
  await etapa(pagina, 'Acabados finales').waitFor({ timeout: 60000 })
  const limite = await texto(etapa(pagina, 'Acabados finales'))
  console.log(`     Diseño, Acabados finales: ${limite}`)
  comprobar(/Vence en \d+ días?/.test(limite), 'en Control de etapas, la que vence a 3 días hábiles sale por vencer aunque haya un domingo en medio')
  comprobar(/Vencida hace/.test(await texto(etapa(pagina, 'Ensamblaje'))), 'y la vencida sigue vencida')
  comprobar(errores.length === 0, `sin errores de consola como Diseño (${errores.join(' · ') || 'ninguno'})`)
  await contexto.close()
}

await navegador.close()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} comprobación(es) fallan:`)
  for (const f of fallas) console.error(`  - ${f}`)
  process.exit(1)
}
console.log('\nTodo pasa.')
