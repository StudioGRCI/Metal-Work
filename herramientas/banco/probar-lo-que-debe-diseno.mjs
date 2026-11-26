/**
 * Clic real sobre la migración 20261126600000 (plan 6, entrega 6.1): lo que
 * Diseño le debe a cada código. Con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Diseño, en sus listas (Planos, Gestión de materiales, Control de etapas
 *      y Archivos DXF), ve en cada código los cinco puntos con hecho o
 *      pendiente y, del plano, solo lo vencido o por vencer; en el código, la
 *      tarjeta junto a las cifras, con el plano de cada área contra el día en
 *      que lo necesita. Lo esperado sale de las tablas, no de la función.
 *   2. Administración, en Códigos internos y en el detalle, ve los cinco puntos
 *      en lectura donde antes decía «Diseño todavía no cargó planos ni etapas».
 *   3. El supervisor de Maestranza, en Planos y etapas, los ve en lectura, con
 *      el plano solo de su área; el Gerente de producción, en su seguimiento.
 *      Almacén, con el mismo seguimiento, no la ve ni la saca de la base.
 *   4. Logística no entra a ninguna de esas pantallas.
 *   5. En el teléfono (390) nada se sale. Capturas en 390 y 1440.
 *
 * Necesita lo que siembra `sembrar-diseno-por-codigo.sql` (SR-101, SR-102 y
 * SR-103). Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE
 * (mw_demo), BANCO_CHROMIUM, CAPTURAS.
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

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const correoDe = (puesto) => `${puesto}.local@metalwork.test`

/** Lo que da la base con la sesión de esa cuenta y el rol authenticated. */
async function comoCuenta(puesto, sql, valores = []) {
  const [cuenta] = await consulta('select id from public.usuarios where correo = $1', [correoDe(puesto)])
  if (!cuenta) throw new Error(`El banco no tiene la cuenta ${correoDe(puesto)}: corre preparar.sh.`)
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
      set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [cuenta.id])
    await base.query('set local role authenticated')
    return (await base.query(sql, valores)).rows
  } finally {
    await base.query('rollback')
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

async function capturar(pagina, archivo) {
  await pagina.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
  const ventana = pagina.viewportSize()
  const alto = await pagina.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
  await pagina.setViewportSize({ width: ventana.width, height: Math.min(Math.max(alto, ventana.height), 6000) })
  await pagina.evaluate(() => window.scrollTo(0, 0))
  await pagina.screenshot({ path: `${CAPTURAS}/${archivo}` })
  await pagina.setViewportSize(ventana)
}

async function sinDesborde(pagina, donde) {
  const sobra = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  comprobar(sobra <= 0, `${donde}: nada se sale de la pantalla (sobran ${sobra} px)`)
}

/** De cada lista de cinco puntos de la página: el código y qué punto está hecho. */
const listas = (pagina) =>
  pagina.locator('[data-lo-que-debe-diseno]').evaluateAll((es) =>
    es.map((e) => ({
      codigo: e.dataset.loQueDebeDiseno,
      puntos: Object.fromEntries([...e.querySelectorAll('[data-punto]')].map((p) => [p.dataset.punto, p.dataset.hecho === 'true'])),
      compromisos: Object.fromEntries([...e.querySelectorAll('[data-compromiso]')].map((c) => [c.dataset.compromiso, c.dataset.situacion])),
      texto: e.textContent.replace(/\s+/g, ' ').trim(),
    })),
  )

const CODIGOS = ['SR-101', 'SR-102', 'SR-103']
const [{ hay }] = await consulta(`select count(*)::int as hay from public.codigo_planos where codigo_interno = 'SR-101'`)
if (hay === 0) throw new Error('Falta lo sembrado: corre sembrar-diseno-por-codigo.sql.')

/**
 * Lo esperado, sacado de las tablas (como postgres) y no de la función: si la
 * función se equivoca, la pantalla no puede coincidir con el error.
 */
async function esperadoDeLasTablas() {
  const filas = await consulta(
    `with c(codigo) as (select unnest($1::text[]))
     select c.codigo, a.codigo as area,
            exists (select 1 from public.ot_adjuntos x join public.ordenes_trabajo o on o.id = x.orden_id and o.estado <> 'ANULADA'
                      join public.unidades u on u.id = o.unidad_id and u.codigo_interno = c.codigo where x.tipo = 'FICHA_VEHICULO') as ficha,
            exists (select 1 from public.codigo_planos p where p.codigo_interno = c.codigo and p.anulado_en is null) as planos,
            exists (select 1 from public.codigo_materiales m where m.codigo_interno = c.codigo and m.quitado_en is null) as materiales,
            exists (select 1 from public.codigo_dxf d where d.codigo_interno = c.codigo and d.quitado_en is null) as dxf,
            exists (select 1 from public.codigo_etapas e where e.codigo_interno = c.codigo and e.area_id = a.id
                      and e.quitada_en is null and e.padre_id is null and not e.de_area) as etapa,
            (select min(e.inicio_plan) from public.codigo_etapas e where e.codigo_interno = c.codigo and e.area_id = a.id
                      and e.quitada_en is null and e.padre_id is null and not e.de_area)::text as necesita,
            (select min((r.subido_en at time zone 'America/Lima')::date) from public.codigo_planos p
               join public.codigo_plano_revisiones r on r.plano_id = p.id
              where p.codigo_interno = c.codigo and p.area_id = a.id and p.anulado_en is null)::text as subido,
            ((now() at time zone 'America/Lima')::date)::text as hoy, public.limite_por_vencer()::text as limite
       from c cross join public.areas a where a.codigo in ('MTZ', 'PRD')`,
    [CODIGOS],
  )
  const por = new Map()
  for (const f of filas) {
    const c = por.get(f.codigo) ?? { puntos: { ficha: f.ficha, planos: f.planos, materiales: f.materiales, etapas: true, dxf: f.dxf }, areas: {} }
    c.puntos.etapas &&= f.etapa
    const situacion = !f.necesita
      ? f.subido ? 'ENTREGADO_SIN_FECHA' : 'SIN_FECHA'
      : f.subido ? (f.subido <= f.necesita ? 'A_TIEMPO' : 'TARDE') : f.necesita < f.hoy ? 'VENCIDO' : 'PENDIENTE'
    c.areas[f.area] = { situacion, urgente: situacion === 'VENCIDO' || (situacion === 'PENDIENTE' && f.necesita <= f.limite) }
    por.set(f.codigo, c)
  }
  return por
}
/** De las áreas dadas, la más urgente, como la pinta la lista: VENCIDO antes que lo por vencer. */
function urgenteEsperado(c, areas = ['MTZ', 'PRD']) {
  const urg = areas.filter((a) => c.areas[a]?.urgente).sort((a, b) => (c.areas[a].situacion === 'VENCIDO' ? 0 : 1) - (c.areas[b].situacion === 'VENCIDO' ? 0 : 1))
  return urg.length ? { [urg[0]]: c.areas[urg[0]].situacion } : {}
}
const todas = (c) => Object.fromEntries(Object.entries(c.areas).map(([a, x]) => [a, x.situacion]))
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const tablas = await esperadoDeLasTablas()

// ------------------------------------------------ 1. Diseño
comprobar(igual(tablas.get('SR-101')?.puntos, { ficha: true, planos: true, materiales: true, etapas: true, dxf: true }),
  'las tablas dan a SR-101 los cinco puntos hechos')
comprobar(tablas.get('SR-101')?.areas.MTZ.situacion === 'TARDE' && tablas.get('SR-102')?.areas.MTZ.situacion === 'VENCIDO',
  'y el plano de Maestranza de SR-101 tarde, el de SR-102 vencido')
{
  const { pagina, contexto } = await entrar('diseno')
  for (const vista of ['planos', 'materiales', 'etapas', 'dxf']) {
    await ir(pagina, `/diseno/${vista}`)
    const enPantalla = await listas(pagina)
    for (const codigo of CODIGOS) {
      const fila = enPantalla.find((l) => l.codigo === codigo)
      const t = tablas.get(codigo)
      comprobar(fila && igual(fila.puntos, t.puntos) && igual(fila.compromisos, urgenteEsperado(t)),
        `/diseno/${vista}: ${codigo} con los cinco puntos y solo el plano urgente, como dicen las tablas (${JSON.stringify(fila?.puntos)} ${JSON.stringify(fila?.compromisos)})`)
    }
    // La línea va fuera del enlace: el nombre del enlace no la lleva.
    const nombre = await pagina.locator('a[data-codigo="SR-101"]').first().evaluate((a) => a.textContent.length)
    comprobar(nombre < 250 && (await pagina.locator('a[data-codigo] [data-lo-que-debe-diseno]').count()) === 0,
      `/diseno/${vista}: la lista de cinco puntos queda fuera del enlace de la fila (${nombre} caracteres en el enlace)`)
  }
  await ir(pagina, '/diseno/codigo?codigo=SR-101')
  const tarjeta = (await listas(pagina)).find((l) => l.codigo === 'SR-101')
  comprobar(
    tarjeta && /5 de 5/.test(tarjeta.texto) && igual(tarjeta.compromisos, todas(tablas.get('SR-101'))) &&
      /Plano de Maestranza: lo necesita el .*, cuando empieza Habilitado: Chasis y piso; se subió el .*Subido 3 días tarde/.test(tarjeta.texto),
    `el código SR-101 en Diseño dice «5 de 5», las dos áreas y el plano de Maestranza 3 días tarde («${tarjeta?.texto.slice(0, 200)}»)`)
  // Junto a las cifras: va después de ellas y antes de las secciones.
  const orden = await pagina.evaluate(() => {
    const t = document.querySelector('[data-tarjeta-lo-que-debe]')
    const secciones = document.querySelector('[aria-label="Secciones del código"]') ?? [...document.querySelectorAll('nav, [role="tablist"]')].at(-1)
    const cifras = [...document.querySelectorAll('p')].find((p) => p.textContent.trim() === 'Planos')
    return {
      despuesDeCifras: Boolean(cifras && t && cifras.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING),
      antesDeSecciones: Boolean(secciones && t && t.compareDocumentPosition(secciones) & Node.DOCUMENT_POSITION_FOLLOWING),
    }
  })
  comprobar(orden.despuesDeCifras, `la tarjeta va junto a las cifras, después de ellas (${JSON.stringify(orden)})`)
  await ir(pagina, '/diseno/codigo?codigo=SR-103')
  const nada = (await listas(pagina)).find((l) => l.codigo === 'SR-103')
  comprobar(nada && /0 de 5/.test(nada.texto) && /Falta adjuntarla a la OT/.test(nada.texto) && /Faltan Habilitado y Ensamblaje/.test(nada.texto),
    'SR-103 dice «0 de 5», que falta adjuntar la ficha a la OT y las dos etapas')
  // Lo que ya tenía la pantalla sigue: la OT, las cifras y las secciones.
  comprobar((await pagina.getByText('OT 0003-2026').count()) > 0 && (await pagina.getByRole('link', { name: 'Materiales' }).count()) > 0,
    'el código sigue con su OT y sus secciones')
  await contexto.close()
}

// ------------------------------------------------ 2. Administración, en lectura
{
  const { pagina, contexto } = await entrar('administracion')
  await ir(pagina, '/codigos-internos')
  const enPantalla = await listas(pagina)
  for (const codigo of CODIGOS) {
    const fila = enPantalla.find((l) => l.codigo === codigo)
    comprobar(fila && igual(fila.puntos, tablas.get(codigo).puntos), `Códigos internos: ${codigo} con sus cinco puntos (Administración)`)
  }
  comprobar(!enPantalla.some((l) => ['OFICINA', 'PLANTA', 'TODOS LOS ACTIVOS'].includes(l.codigo)), 'ni la oficina ni la planta llevan la lista')
  comprobar((await pagina.getByText('Diseño todavía no cargó planos ni etapas').count()) === 0,
    'ya no dice «Diseño todavía no cargó planos ni etapas»: lo dice la lista')
  comprobar((await pagina.locator('[data-lo-que-debe-diseno] button, [data-lo-que-debe-diseno] form').count()) === 0,
    'y la lista no tiene ningún botón: es lectura')
  await ir(pagina, '/codigos-internos/detalle?codigo=SR-102')
  const detalle = (await listas(pagina)).find((l) => l.codigo === 'SR-102')
  comprobar(detalle && detalle.compromisos.MTZ === 'VENCIDO' && /Plano de Maestranza vencido hace 2 días/.test(detalle.texto),
    `el detalle de SR-102 dice que el plano de Maestranza venció hace 2 días («${detalle?.texto.slice(0, 160)}»)`)
  await contexto.close()
}

// ------------------------------------------------ 3. Supervisión, en lectura
{
  const { pagina, contexto } = await entrar('sup.mtz')
  await ir(pagina, '/planos')
  const enPantalla = await listas(pagina)
  for (const codigo of ['SR-101', 'SR-102']) {
    const fila = enPantalla.find((l) => l.codigo === codigo)
    const t = tablas.get(codigo)
    comprobar(fila && igual(fila.puntos, t.puntos) && igual(fila.compromisos, urgenteEsperado(t, ['MTZ'])),
      `Planos y etapas: el supervisor de Maestranza ve los cinco puntos de ${codigo} y, del plano, solo lo urgente de su área (${JSON.stringify(fila?.compromisos)})`)
  }
  comprobar(enPantalla.length > 0 && enPantalla.every((l) => l.codigo), 'cada tarjeta de código lleva su lista')
  // Va después de su trabajo: los planos que recibe y sus etapas.
  const despues = await pagina.locator('li').filter({ has: pagina.locator('[data-lo-que-debe-diseno="SR-102"]') }).first().evaluate((li) => {
    const l = li.querySelector('[data-lo-que-debe-diseno]')
    const etapas = li.querySelector('[aria-label="Etapas de tu área"]')
    return Boolean(etapas && etapas.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  comprobar(despues, 'en la tarjeta del código, la lista va después de las etapas del supervisor')
  await contexto.close()
}
{
  // Supervisión general la ve en su seguimiento por código, con todas las unidades.
  const { pagina, contexto } = await entrar('gerencia.produccion')
  await ir(pagina, '/seguimiento')
  const enPantalla = await listas(pagina)
  for (const codigo of CODIGOS) {
    const fila = enPantalla.find((l) => l.codigo === codigo)
    comprobar(fila && igual(fila.puntos, tablas.get(codigo).puntos), `Seguimiento por código: ${codigo} con sus cinco puntos (Gerente de producción)`)
  }
  await contexto.close()
}
{
  // Almacén tiene el mismo seguimiento y no la ve: ni en la pantalla ni pidiéndola a la base.
  const { pagina, contexto } = await entrar('almacen')
  await ir(pagina, '/seguimiento?vista=materiales')
  comprobar(new URL(pagina.url()).pathname === '/seguimiento' && (await pagina.locator('[data-lo-que-debe-diseno]').count()) === 0,
    'Almacén entra a su seguimiento sin la lista de lo que debe Diseño')
  await contexto.close()
  const negado = await comoCuenta('almacen', `select public.lo_que_debe_diseno(array['SR-101'])`).then(() => false, (e) => /No tienes permiso/.test(e.message))
  comprobar(negado, 'y la base no se la da')
}

// ------------------------------------------------ 4. Logística no entra
{
  const { pagina, contexto } = await entrar('logistica')
  for (const ruta of ['/diseno/planos', '/codigos-internos', '/planos']) {
    await ir(pagina, ruta)
    comprobar((await pagina.locator('[data-lo-que-debe-diseno]').count()) === 0, `Logística no ve la lista en ${ruta} (${new URL(pagina.url()).pathname})`)
  }
  await contexto.close()
}

// ------------------------------------------------ 5. Capturas, 390 y 1440
for (const ancho of [390, 1440]) {
  for (const [puesto, ruta, archivo] of [
    ['diseno', '/diseno/planos', '6-1-diseno-lista'],
    ['diseno', '/diseno/codigo?codigo=SR-101', '6-1-diseno-codigo'],
    ['administracion', '/codigos-internos', '6-1-administracion-codigos'],
    ['sup.mtz', '/planos', '6-1-sup-mtz-planos'],
  ]) {
    const { pagina, contexto } = await entrar(puesto, ancho)
    await ir(pagina, ruta)
    await sinDesborde(pagina, `${ruta}, ${puesto} a ${ancho}`)
    await capturar(pagina, `${archivo}-${ancho}.png`)
    await contexto.close()
  }
}

comprobar(errores.length === 0, `sin errores de consola ni de hidratación ${errores.slice(0, 5).join(' | ')}`)

await navegador.close()
await base.end()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} cosa(s) no cuadran:\n${fallas.map((f) => ` - ${f}`).join('\n')}`)
  process.exit(1)
}
console.log('\nTodo en orden.')
