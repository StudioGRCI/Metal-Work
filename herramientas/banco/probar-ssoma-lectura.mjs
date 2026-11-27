/**
 * SSOMA: la lectura de Gerencia (Plan 15, entrega 15.6), con clic real y la
 * cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Gerencia, en el monitor: arriba de Seguridad, los días sin accidentes,
 *      los reportes abiertos y las acciones vencidas, como los da la base con su
 *      cuenta. Cada cifra lleva a su pestaña; «Por área» trae cada área como la
 *      base y, debajo, cuáles son las vencidas. Sin botones que escriban.
 *   2. Ventas reporta un accidente en Acabados y la lectura de Gerencia lo cuenta
 *      sin que nadie lo clasifique; SSOMA lo reclasifica como incidente (en la
 *      base, con la cuenta de cada una) y la lectura vuelve a lo de antes, con la
 *      lista diciendo «Incidente · reportado como accidente». Cada corrida crea
 *      su propio accidente: el recorrido se puede repetir sin rehacer el banco.
 *   3. Gerencia y SSOMA, en el celular: las mismas cifras, sin desplazarse de
 *      costado, con las tres cifras de cada área dentro de su fila.
 *   4. RR. HH., Ventas y Almacén (que tiene una acción vencida a su cargo) no
 *      ven las cifras ni la pestaña, ni por la dirección.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
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
  ssoma: 'ssoma.local@metalwork.test',
  gerencia: 'gerencia.local@metalwork.test',
  almacen: 'almacen.local@metalwork.test',
  rrhh: 'rrhh.local@metalwork.test',
  ventas: 'ventas.local@metalwork.test',
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

/** Lo que la base le da a una cuenta, con su rol real; `guardar` deja lo que escribió. */
async function comoCuenta(correo, sql, valores = [], guardar = false) {
  const [yo] = await consulta(`select id from public.usuarios where correo = $1`, [correo])
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                             set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [yo.id])
    await base.query('set local role authenticated')
    const filas = (await base.query(sql, valores)).rows
    await base.query(guardar ? 'commit' : 'rollback')
    return filas
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}
const PLANTA = `select ultimo_accidente::text as ultimo, area_del_ultimo as area, registro_desde::text as desde, dias_sin_accidentes as dias,
                       reportes_abiertos as abiertos, por_clasificar, acciones_abiertas as abiertas, acciones_vencidas as vencidas
                  from public.ssoma_seguridad_de_la_planta()`
const POR_AREA = `select area, activa, ultimo_accidente::text as ultimo, dias_sin_accidentes as dias, reportes_abiertos as abiertos,
                         por_clasificar, acciones_abiertas as abiertas, acciones_vencidas as vencidas
                    from public.ssoma_seguridad_por_area()`

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const quieta = (pagina) => pagina.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
async function ir(pagina, url) {
  await pagina.goto(url, { waitUntil: 'load' })
  await quieta(pagina)
}
const dia = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : null)

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const CELULAR = { width: 390, height: 844 }
const MONITOR = { width: 1440, height: 1000 }
const captura = (pagina, nombre) => pagina.screenshot({ path: join(CAPTURAS, nombre), fullPage: true })

async function entrar(correo, viewport = MONITOR) {
  const celular = viewport.width < 500
  const contexto = await navegador.newContext({
    viewport,
    isMobile: celular,
    hasTouch: celular,
    deviceScaleFactor: 2,
    timezoneId: 'America/Lima',
    locale: 'es-PE',
  })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' && !t.includes('_next/hmr') && !t.includes('WebSocket')) errores.push(t.slice(0, 300))
  })
  await ir(pagina, `${BASE}/ingresar`)
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  await quieta(pagina)
  return { pagina, contexto, errores }
}

/** Las tres cifras de arriba, tal como se leen: rótulo, valor y pie de cada una. */
async function cifras(pagina) {
  return pagina.locator('[data-cifras-ssoma] a').evaluateAll((as) =>
    as.map((a) => ({
      href: a.getAttribute('href'),
      valor: (a.querySelector('.tabular')?.textContent ?? '').trim(),
      texto: (a.textContent ?? '').replace(/\s+/g, ' ').trim(),
    })),
  )
}

/** Compara las tres cifras de la pantalla con lo que la base le da a esa cuenta. */
async function cifrasComoLaBase(pagina, correo, puesto) {
  const [p] = await comoCuenta(correo, PLANTA)
  const c = await cifras(pagina)
  comprobar(c.length === 3, `[${puesto}] arriba van tres cifras (${c.length})`)
  const [dias, reportes, vencidas] = c
  comprobar(
    dias?.valor === String(p.dias ?? '—') && dias.texto.includes('Días sin accidentes'),
    `[${puesto}] días sin accidentes: ${dias?.valor} en pantalla, ${p.dias} en la base`,
  )
  const pieDias = p.ultimo
    ? `Último: ${dia(p.ultimo)}${p.area ? ` · ${p.area}` : ''}`
    : p.desde
      ? `Ningún accidente desde el primer registro, el ${dia(p.desde)}`
      : 'Todavía no hay reportes'
  comprobar(dias?.texto.includes(pieDias), `[${puesto}] y su pie dice «${pieDias}»`)
  comprobar(reportes?.valor === String(p.abiertos) && reportes.texto.includes('Reportes abiertos'), `[${puesto}] reportes abiertos: ${reportes?.valor} y ${p.abiertos}`)
  comprobar(
    p.por_clasificar > 0 ? reportes.texto.includes(`${p.por_clasificar} por clasificar`) : !reportes.texto.includes('por clasificar'),
    `[${puesto}] con ${p.por_clasificar} por clasificar`,
  )
  comprobar(
    vencidas?.valor === String(p.vencidas) && vencidas.texto.includes(`De ${p.abiertas} abierta`),
    `[${puesto}] acciones vencidas: ${vencidas?.valor} de ${p.abiertas} abiertas (base: ${p.vencidas})`,
  )
  comprobar(
    dias?.href === '/ssoma?vista=areas' && reportes?.href === '/ssoma' && vencidas?.href === '/ssoma?vista=areas#vencidas',
    `[${puesto}] cada cifra lleva a su pestaña`,
  )
  return p
}

/** La pestaña «Por área» contra la base: una fila por área, con sus tres cifras. */
async function areasComoLaBase(pagina, correo, puesto, celular = false) {
  const areas = await comoCuenta(correo, POR_AREA)
  const filas = await pagina.locator('[data-seguridad-por-area] [data-area-ssoma]').evaluateAll((trs) =>
    trs.map((tr) => ({
      area: tr.getAttribute('data-area-ssoma'),
      vencidas: tr.getAttribute('data-vencidas'),
      celdas: [...tr.querySelectorAll('td')].map((td) => (td.textContent ?? '').replace(/\s+/g, ' ').trim()),
      visible: (tr.querySelector('td')?.innerText ?? '').replace(/\s+/g, ' ').trim(),
    })),
  )
  // Las que nunca tuvieron un accidente ni tienen nada abierto van plegadas, por nombre.
  const conAlgo = areas.filter((a) => a.ultimo || a.abiertos > 0 || a.abiertas > 0)
  const tranquilas = areas.filter((a) => !conAlgo.includes(a))
  const plegadas = await pagina.locator('[data-seguridad-por-area] [data-area-tranquila]').evaluateAll((lis) => lis.map((l) => l.getAttribute('data-area-tranquila')))
  comprobar(
    filas.length === conAlgo.length && plegadas.length === tranquilas.length && areas.length > 0,
    `[${puesto}] «Por área» trae las ${areas.length} áreas de la base: ${filas.length} a la vista y ${plegadas.length} plegadas`,
  )
  comprobar(
    filas.map((f) => f.area).join('|') === conAlgo.map((a) => a.area).join('|') && plegadas.join('|') === tranquilas.map((a) => a.area).join('|'),
    `[${puesto}] en el orden de la empresa, y plegadas justo las que no tienen nada`,
  )
  if (tranquilas.length > 0) {
    const pie = limpio(await pagina.locator('[data-areas-tranquilas]').innerText().catch(() => ''))
    const susDias = await pagina.locator('[data-seguridad-por-area] [data-area-tranquila]').evaluateAll((lis) =>
      lis.map((l) => (l.textContent ?? '').replace(/\s+/g, ' ').trim()),
    )
    comprobar(
      pie.includes(`Ver las ${tranquilas.length} áreas sin accidentes ni nada abierto`) &&
        tranquilas.every((a, i) => susDias[i]?.endsWith(a.dias === null ? '—' : `${a.dias} ${a.dias === 1 ? 'día' : 'días'}`)),
      `[${puesto}] el pliegue cuenta ${tranquilas.length} áreas, cada una con sus días`,
    )
  }
  let iguales = 0
  for (const a of conAlgo) {
    const f = filas.find((x) => x.area === a.area)
    if (!f) continue
    const ok = celular
      ? f.visible.includes(a.dias === null ? 'Sin registro de accidentes todavía' : `${a.dias} ${a.dias === 1 ? 'día' : 'días'} sin accidentes`) &&
        f.visible.includes(`${a.abiertos} ${a.abiertos === 1 ? 'reporte abierto' : 'reportes abiertos'}`) &&
        f.visible.includes(`${a.vencidas} ${a.vencidas === 1 ? 'acción vencida' : 'acciones vencidas'}`) &&
        (a.ultimo ? f.visible.includes(`último el ${dia(a.ultimo)}`) : a.dias === null || f.visible.includes('desde el primer registro'))
      : f.celdas[1]?.startsWith(String(a.dias ?? '—')) &&
        (a.ultimo ? f.celdas[1].includes(`último el ${dia(a.ultimo)}`) : f.celdas[1].includes(a.dias === null ? 'sin registro todavía' : 'desde el primer registro')) &&
        f.celdas[2]?.startsWith(String(a.abiertos)) &&
        (a.por_clasificar > 0 ? f.celdas[2].includes(`${a.por_clasificar} por clasificar`) : true) &&
        f.celdas[3]?.startsWith(String(a.vencidas)) &&
        (f.vencidas === null) === (a.vencidas === 0) &&
        (a.activa || f.celdas[0].includes('dada de baja'))
    if (ok) iguales++
    else console.log('   distinta:', JSON.stringify({ base: a, pantalla: f }))
  }
  comprobar(iguales === conAlgo.length, `[${puesto}] cada área a la vista dice lo mismo que la base (${iguales} de ${conAlgo.length})`)
  const [p] = await comoCuenta(correo, PLANTA)
  const vencidas = await pagina.locator('[data-vencidas-por-area] [data-accion-ssoma]').count()
  comprobar(vencidas === p.vencidas, `[${puesto}] debajo, las ${p.vencidas} acciones vencidas (${vencidas})`)
  comprobar(
    (await pagina.locator('[data-vencidas-por-area] [data-accion-ssoma]:not([data-vencida])').count()) === 0,
    `[${puesto}] y ninguna que no esté vencida`,
  )
  const areasDeVencidas = await pagina.locator('[data-vencidas-por-area] [data-accion-ssoma]').evaluateAll((trs) =>
    trs.map((tr) => (tr.querySelector('td p.tabular')?.textContent ?? '').split(' · ').pop()?.trim()),
  )
  const ordenTabla = areas.map((a) => a.area)
  const posiciones = areasDeVencidas.map((a) => ordenTabla.indexOf(a))
  comprobar(
    posiciones.every((x, i) => x >= 0 && (i === 0 || x >= posiciones[i - 1])),
    `[${puesto}] las vencidas van agrupadas por área, en el orden de la tabla (${areasDeVencidas.join(', ')})`,
  )
  return areas
}

// ------------------------------------------------------------ 1. Gerencia, en el monitor
let antes
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia, MONITOR)
  await ir(pagina, `${BASE}/ssoma`)
  antes = await cifrasComoLaBase(pagina, CUENTAS.gerencia, 'Gerencia 1440')
  await captura(pagina, 'ssoma-lectura-gerencia-1440.png')
  // La cifra de los días lleva a «Por área».
  await Promise.all([pagina.waitForURL(/vista=areas/), pagina.locator('[data-cifras-ssoma] a').first().click()])
  await quieta(pagina)
  comprobar(
    (await pagina.getByRole('link', { name: /Por área/ }).getAttribute('aria-current')) !== null ||
      (await pagina.locator('[data-seguridad-por-area]').count()) === 1,
    '[Gerencia 1440] tocar los días abre «Por área»',
  )
  await areasComoLaBase(pagina, CUENTAS.gerencia, 'Gerencia 1440')
  // Gerencia consulta: en la lectura no hay nada que escriba (el «i» de la ayuda solo la abre).
  const botones = await pagina
    .locator('[data-seguridad-por-area] button:not([data-ayuda]), [data-vencidas-por-area] button:not([data-ayuda]), [data-cifras-ssoma] button')
    .evaluateAll((bs) => bs.map((b) => (b.textContent ?? '').trim()))
  comprobar(botones.length === 0, `[Gerencia 1440] la lectura no tiene botones${botones.length ? `: ${botones.join(', ')}` : ''}`)
  comprobar((await pagina.locator('[data-seguridad-por-area] button[data-ayuda]').count()) === 1, '[Gerencia 1440] «Por área» explica qué cuenta en su «i»')
  // La captura, con la pestaña ya quieta (recién tocada salía a medio cambiar).
  await ir(pagina, `${BASE}/ssoma?vista=areas`)
  await captura(pagina, 'ssoma-lectura-por-area-gerencia-1440.png')
  comprobar(errores.length === 0, `[Gerencia 1440] sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------------ 2. Un accidente nuevo, y SSOMA lo reclasifica
{
  const [acb] = await consulta(`select id, nombre from public.areas where nombre = 'Acabados' and activo`)
  const [acc] = await comoCuenta(
    CUENTAS.ventas,
    `select r.reporte as id, r.numero_reporte as numero from public.ssoma_reportar(gen_random_uuid(), 'ACCIDENTE', $1, 'Cabina de pintura',
       'Resbaló con la pintura del piso y se golpeó la rodilla.', now() - interval '10 minutes', false, null, '[]'::jsonb) r`,
    [acb.id],
    true,
  )
  comprobar(!!acc, `[Ventas] reporta un accidente en Acabados (${acc?.numero})`)
  const { pagina, contexto } = await entrar(CUENTAS.gerencia, MONITOR)
  await ir(pagina, `${BASE}/ssoma`)
  const conAccidente = await cifrasComoLaBase(pagina, CUENTAS.gerencia, 'Gerencia, con el accidente nuevo')
  comprobar(
    conAccidente.dias === 0 && conAccidente.area === 'Acabados' && conAccidente.por_clasificar === antes.por_clasificar + 1,
    `[Gerencia] el accidente sin clasificar ya cuenta: 0 días, en Acabados, uno más por clasificar`,
  )
  await comoCuenta(
    CUENTAS.ssoma,
    `select public.ssoma_clasificar($1, 'INCIDENTE', null, null, 'Revisado con el operario: no llegó a golpearse.')`,
    [acc.id],
    true,
  )
  await ir(pagina, `${BASE}/ssoma`)
  const despues = await cifrasComoLaBase(pagina, CUENTAS.gerencia, 'Gerencia, tras la reclasificación')
  comprobar(
    despues.ultimo === antes.ultimo && despues.dias === antes.dias && despues.por_clasificar === antes.por_clasificar,
    `[Gerencia] reclasificado como incidente, deja de contar: vuelve a ${despues.dias} días (antes ${antes.dias})`,
  )
  // En la lista de reportes, lo que SSOMA clasificó manda: ya no sale como «Accidente».
  const enLista = limpio(await pagina.locator(`[data-reporte-ssoma="${acc.numero}"] td`).first().innerText())
  comprobar(
    /Incidente/.test(enLista) && enLista.includes('reportado como accidente') && !/\bAccidente\b/.test(enLista.replace('reportado como accidente', '')),
    `[Gerencia] en la lista, ${acc.numero} dice «Incidente · reportado como accidente»`,
  )
  await ir(pagina, `${BASE}/ssoma?vista=areas`)
  const areas = await areasComoLaBase(pagina, CUENTAS.gerencia, 'Gerencia, tras la reclasificación')
  const suya = areas.find((a) => a.area === 'Acabados')
  // Le queda el reporte abierto: sigue a la vista, con lo que diga su último accidente, si tuvo.
  const fila = limpio(await pagina.locator(`[data-seguridad-por-area] [data-area-ssoma="Acabados"]`).innerText().catch(() => ''))
  comprobar(
    !!suya && suya.abiertos > 0 && fila.includes(suya.ultimo ? `último el ${dia(suya.ultimo)}` : 'desde el primer registro'),
    `[Gerencia] Acabados sigue a la vista con su reporte abierto y dice «${suya?.ultimo ? `último el ${dia(suya.ultimo)}` : 'desde el primer registro'}»`,
  )
  await contexto.close()
}

// ------------------------------------------------------------ 3. Gerencia y SSOMA, en el celular
for (const [puesto, correo, nombre] of [
  ['Gerencia 390', CUENTAS.gerencia, 'gerencia'],
  ['SSOMA 390', CUENTAS.ssoma, 'ssoma'],
]) {
  const { pagina, contexto, errores } = await entrar(correo, CELULAR)
  await ir(pagina, `${BASE}/ssoma`)
  await cifrasComoLaBase(pagina, correo, puesto)
  const anchos = await pagina.locator('[data-cifras-ssoma] a').evaluateAll((as) => as.map((a) => Math.round(a.getBoundingClientRect().width)))
  comprobar(anchos[0] > anchos[1] * 1.8 && Math.abs(anchos[1] - anchos[2]) < 4, `[${puesto}] los días van a todo lo ancho y las otras dos, lado a lado (${anchos.join(', ')} px)`)
  const alto = await pagina.locator('[data-cifras-ssoma] a').first().evaluate((a) => Math.round(a.getBoundingClientRect().height))
  comprobar(alto >= 44, `[${puesto}] cada cifra es un blanco de al menos 44 px (${alto})`)
  comprobar(await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `[${puesto}] la pantalla no se desliza de costado`)
  await captura(pagina, `ssoma-lectura-${nombre}-390.png`)
  await ir(pagina, `${BASE}/ssoma?vista=areas`)
  await areasComoLaBase(pagina, correo, puesto, true)
  comprobar(await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `[${puesto}] «Por área» tampoco`)
  await captura(pagina, `ssoma-lectura-por-area-${nombre}-390.png`)
  comprobar(errores.length === 0, `[${puesto}] sin errores en la consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// SSOMA en el monitor, para la captura de su puesto.
{
  const { pagina, contexto } = await entrar(CUENTAS.ssoma, MONITOR)
  await ir(pagina, `${BASE}/ssoma?vista=areas`)
  await cifrasComoLaBase(pagina, CUENTAS.ssoma, 'SSOMA 1440')
  await areasComoLaBase(pagina, CUENTAS.ssoma, 'SSOMA 1440')
  await captura(pagina, 'ssoma-lectura-por-area-ssoma-1440.png')
  await contexto.close()
}

// ------------------------------------------------------------ 4. Quien no debe verla
// La acción vencida de la demostración está a cargo de la cuenta de Almacén de la demo, no de la del banco:
// se le pasa a la del banco sin tocar su fecha (armazón de la prueba, por encima de la guarda).
{
  const [n] = await consulta(
    `select count(*)::int as n from public.ssoma_acciones x join public.usuarios u on u.id = x.responsable_id
      where u.correo = $1 and x.estado = 'ABIERTA' and x.fecha_limite < (now() at time zone 'America/Lima')::date`,
    [CUENTAS.almacen],
  )
  if (n.n === 0) {
    await base.query('begin')
    await base.query(`set local session_replication_role = replica`)
    await base.query(
      `update public.ssoma_acciones set responsable_id = (select id from public.usuarios where correo = $1)
        where id = (select id from public.ssoma_acciones where estado = 'ABIERTA' and fecha_limite < (now() at time zone 'America/Lima')::date
                     order by fecha_limite limit 1)`,
      [CUENTAS.almacen],
    )
    await base.query('commit')
  }
}
const [vencidaDeAlmacen] = await consulta(
  `select count(*)::int as n from public.ssoma_acciones x join public.usuarios u on u.id = x.responsable_id
    where u.correo = $1 and x.estado = 'ABIERTA' and x.fecha_limite < (now() at time zone 'America/Lima')::date`,
  [CUENTAS.almacen],
)
comprobar(vencidaDeAlmacen.n > 0, `Almacén tiene ${vencidaDeAlmacen.n} acción vencida a su cargo`)
for (const [puesto, correo] of [
  ['RR. HH.', CUENTAS.rrhh],
  ['Ventas', CUENTAS.ventas],
  ['Almacén', CUENTAS.almacen],
]) {
  const filas = await comoCuenta(correo, `select (select count(*) from public.ssoma_seguridad_de_la_planta()) + (select count(*) from public.ssoma_seguridad_por_area()) as n`)
  comprobar(Number(filas[0].n) === 0, `[${puesto}] la base no le da ninguna fila de la lectura`)
  const { pagina, contexto } = await entrar(correo, CELULAR)
  for (const url of ['/ssoma', '/ssoma?vista=areas']) {
    await ir(pagina, `${BASE}${url}`)
    const texto = limpio(await pagina.locator('main').innerText().catch(() => ''))
    comprobar(
      (await pagina.locator('[data-cifras-ssoma], [data-seguridad-por-area], [data-vencidas-por-area]').count()) === 0 &&
        !texto.includes('Días sin accidentes') &&
        (await pagina.getByRole('link', { name: /^Por área/ }).count()) === 0,
      `[${puesto}] ${url} no muestra las cifras ni la pestaña`,
    )
  }
  if (puesto === 'Almacén') await captura(pagina, 'ssoma-lectura-almacen-no-la-ve-390.png')
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
