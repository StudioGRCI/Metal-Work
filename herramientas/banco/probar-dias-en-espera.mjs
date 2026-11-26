/**
 * Clic real sobre la migración 20261125140000: los días en espera de cada fila.
 * Con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Gerencia, en «Aprobación de compras y servicios», ve en cada compra por
 *      aprobar cuánto lleva esperando («hace 5 días»), el mismo número que da la
 *      base con su sesión, y la que más espera va arriba. Logística consulta la
 *      misma lista con las mismas insignias.
 *   2. Almacén y Logística, en «Atención de requerimiento», ven en cada RQ abierto
 *      quién lo tiene y hace cuántos días, el mismo número que da su recorrido.
 *      Lo que ya estaba (las insignias de estado, «espera(n) por ti», los
 *      botones) sigue; dentro de lo que le toca a cada uno, el que más espera va
 *      arriba. En el historial, el entregado y el anulado no llevan días.
 *   3. Portería no entra a ninguna de las dos.
 *   4. En el teléfono (390) nada se sale de la pantalla. Capturas en 390 y 1440.
 *
 * Solo en el banco, y con los disparadores apagados, corre la hora en que se
 * pidió la aprobación de las compras por aprobar (0, 2, 5… días atrás) para que
 * el orden se note. Usa las compras y los RQ que dejaron las demás suites
 * (`probar-oc-del-rq.mjs`, `probar-oc-de-varios-rq.mjs`). Variables:
 * BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * BANCO_CHROMIUM, CAPTURAS.
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
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const haceDias = (d) => (d <= 0 ? 'desde hoy' : d === 1 ? 'hace 1 día' : `hace ${d} días`)
const desdeHace = (d) => (d <= 0 ? haceDias(d) : `desde ${haceDias(d)}`)
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

/** La pantalla entera, sin la barra fija del teléfono cruzada a media página ni la marca de `next dev`. */
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

/** De cada insignia de días: el número, el texto y desde cuándo. */
const insignias = (raiz) =>
  raiz.locator('[data-dias-en-espera]').evaluateAll((es) =>
    es.map((e) => ({
      dias: Number(e.dataset.diasEnEspera),
      desde: e.dataset.desde ?? null,
      visible: e.querySelector('[aria-hidden="true"]:not(svg)')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
      lector: e.querySelector('.sr-only')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
    })),
  )
const enOrden = (lista) => lista.every((x, i) => i === 0 || Date.parse(lista[i - 1]) <= Date.parse(x))

// ------------------------------------------------ armazón: las compras por aprobar, a distintas edades
const porAprobar = await consulta(
  `select id, coalesce(numero, referencia) as nombre from public.ordenes_compra_materiales where aprobacion = 'POR_APROBAR' order by creado_en`,
)
comprobar(porAprobar.length > 0, `el banco tiene compras por aprobar (${porAprobar.length}; si no, corre probar-oc-de-varios-rq.mjs)`)
await base.query('begin')
await base.query('set local session_replication_role = replica')
// La más vieja por creación queda como la más reciente por pedido: el orden de la pantalla no puede salir de otra columna.
for (const [i, c] of porAprobar.entries()) {
  const atras = [0, 5, 2, 9, 1][i % 5]
  await base.query(
    `update public.ordenes_compra_materiales
        set aprobacion_pedida_en = (((now() at time zone 'America/Lima')::date - $2::int) + time '10:30') at time zone 'America/Lima'
      where id = $1`,
    [c.id, atras],
  )
}
await base.query('commit')

// ------------------------------------------------ 1. Aprobación de compras
for (const puesto of ['gerencia', 'logistica']) {
  const { pagina, contexto } = await entrar(puesto)
  await ir(pagina, '/compras/aprobacion')
  if (pagina.url().includes('/sin-permiso')) {
    comprobar(puesto === 'logistica', `${puesto} entra a Aprobación de compras`)
    await contexto.close()
    continue
  }
  const esperado = await comoCuenta(
    puesto,
    `select tipo, id, numero, pedida_en, public.dias_en_espera(pedida_en) as dias from public.documentos_por_aprobar() where aprobacion = 'POR_APROBAR' order by pedida_en`,
  )
  const seccion = pagina.locator('section').filter({ has: pagina.getByRole('heading', { name: /^Por aprobar/ }) })
  const vistas = await insignias(seccion)
  comprobar(vistas.length === esperado.length && vistas.length > 0, `${puesto}: cada compra por aprobar trae sus días (${vistas.length} de ${esperado.length})`)
  comprobar(
    vistas.map((v) => v.dias).join(',') === esperado.map((e) => e.dias).join(','),
    `${puesto}: los días son los de la base y la que más espera va arriba (pantalla ${vistas.map((v) => v.dias).join(', ')}; base ${esperado.map((e) => e.dias).join(', ')})`,
  )
  comprobar(enOrden(vistas.map((v) => v.desde)), `${puesto}: de la más antigua a la más nueva`)
  comprobar(
    vistas.every((v) => v.visible === haceDias(v.dias) && v.lector === `Espera ${desdeHace(v.dias)}`),
    `${puesto}: dice «hace N días» y el lector oye «Espera desde hace N días» (${vistas.map((v) => `${v.visible} / ${v.lector}`).join(' | ')})`,
  )
  // Lo de antes sigue: «Por aprobar» y, para quien aprueba, sus botones.
  const porAprobarInsignias = await seccion.getByText('Por aprobar', { exact: true }).count()
  comprobar(porAprobarInsignias === esperado.length, `${puesto}: cada una sigue con su «Por aprobar» (${porAprobarInsignias})`)
  if (puesto === 'gerencia') {
    const botones = await seccion.getByRole('button', { name: /^Aprobar/ }).count()
    comprobar(botones === esperado.length, `gerencia: y con su botón de aprobar (${botones})`)
  }
  await contexto.close()
}

// ------------------------------------------------ armazón: RQ listos de las áreas Almacén y Administración
// Dos RQ listos que el área todavía recoge pasan un momento a las áreas Almacén y
// Administración: los recoge quien es de esa área (el almacenero, la
// administradora), y a Logística no le cuentan. Se devuelven a su área al
// terminar la sección 2.
const areasDeAntes = await consulta(
  `select r.id, r.area_id, a.id as nueva
     from (select r.id, r.area_id, row_number() over (order by r.numero) as n
             from public.requerimientos r
            where r.estado = 'LISTO_EN_ALMACEN'
              and exists (select 1 from public.v_rq_lineas_para_salida v where v.requerimiento_id = r.id and v.pendiente > 0)) r
     join public.areas a on a.nombre = (case r.n when 1 then 'Almacén' else 'Administración' end)
    where r.n <= 2`,
)
comprobar(areasDeAntes.length === 2, `armazón: dos RQ listos pasan a las áreas Almacén y Administración (${areasDeAntes.length})`)
await base.query('begin')
await base.query('set local session_replication_role = replica')
for (const r of areasDeAntes) await base.query('update public.requerimientos set area_id = $2 where id = $1', [r.id, r.nueva])
await base.query('commit')

// ------------------------------------------------ 2. Atención de requerimiento
// Las áreas del armazón se devuelven aunque algo de esta sección se caiga.
try {
for (const puesto of ['almacen', 'logistica', 'administracion']) {
  const { pagina, contexto } = await entrar(puesto)
  await ir(pagina, '/requerimientos/atencion')
  const filas = await pagina.locator('tr[id^="rq-"]').evaluateAll((trs) =>
    trs.map((tr) => {
      const i = tr.querySelector('[data-dias-en-espera]')
      return {
        id: tr.id.slice(3),
        numero: tr.querySelector('p')?.innerText.trim().split(/\s/)[0],
        dias: i ? Number(i.dataset.diasEnEspera) : null,
        desde: i?.dataset.desde ?? null,
        visible: i?.querySelector('[aria-hidden="true"]:not(svg)')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
        lector: i?.querySelector('.sr-only')?.textContent.replace(/\s+/g, ' ').trim() ?? '',
        frenado: Boolean(tr.querySelector('[data-freno]')),
        grupo: tr.dataset.grupo ?? '',
        estado: tr.querySelector('td:nth-child(3) [class*="rounded-full"]')?.innerText.trim() ?? '',
      }
    }),
  )
  const ids = filas.map((f) => f.id)
  const ahora = ids.length
    ? await comoCuenta(
        puesto,
        `select documento::text as id, dias, en, puesto from public.recorrido_de_requerimientos($1::uuid[]) where situacion = 'AHORA'`,
        [ids],
      )
    : []
  const porId = new Map(ahora.map((a) => [a.id, a]))
  comprobar(filas.length > 0, `${puesto}: la bandeja tiene RQ abiertos (${filas.length})`)
  const malos = filas.filter((f) => {
    const a = porId.get(f.id)
    return !a || f.dias !== Number(a.dias) || f.lector !== `Lo tiene ${a.puesto} ${desdeHace(Number(a.dias))}` || f.visible !== `${a.puesto} · ${haceDias(Number(a.dias))}`
  })
  comprobar(malos.length === 0, `${puesto}: cada RQ dice quién lo tiene y sus días, los del recorrido (${filas.map((f) => `${f.numero} ${f.visible} / ${f.lector}`).join(' | ')})`)
  const leyenda = await pagina.getByText(/espera(n)? por ti\.$|Ninguno espera por ti\./).count()
  comprobar(leyenda === 1, `${puesto}: sigue el «… espera(n) por ti»`)
  // Los frenados por el metrado van al final, como antes; antes de ellos, por grupos, el que más espera arriba.
  const primerFrenado = filas.findIndex((f) => f.frenado)
  comprobar(primerFrenado === -1 || filas.slice(primerFrenado).every((f) => f.frenado), `${puesto}: los que esperan el metrado siguen al final`)
  // Por grupos (le toca / no / frenado), primero lo que tiene su puesto, y en cada parte el que más espera arriba.
  const grupos = filas.map((f) => f.grupo)
  comprobar(grupos.every((g, i) => g !== '' && (i === 0 || grupos[i - 1] <= g)), `${puesto}: los grupos van en orden (${grupos.join(' ')})`)
  const desordenados = [...new Set(grupos)].filter((g) => !enOrden(filas.filter((f) => f.grupo === g).map((f) => f.desde)))
  comprobar(desordenados.length === 0, `${puesto}: en cada grupo, del más antiguo al más nuevo (${desordenados.join(', ') || 'todos'})`)
  // De quién es cada RQ abierto según lo que espera su recorrido (DKS,
  // 2026-11-26), escrito aparte en SQL para no copiar la regla de la aplicación:
  // por la clave de la espera, no por el nombre que muestra la insignia.
  // Programar el recojo es de Logística también en un RQA, y el recojo del RQ
  // listo es de quien es del área que lo pidió.
  const deQuien = await comoCuenta(
    puesto,
    `select q.id::text as id, q.numero, q.estado,
            case
              when r.espera in ('REVISION_STOCK', 'POR_VALIDAR', 'YA_LLEGO_TODO', 'POR_ENTREGAR') then 'almacen'
              when r.espera = 'POR_PROGRAMAR' then 'logistica'
              -- El recojo, solo a quien es del área que lo pidió.
              when r.espera = 'RECOJO_DEL_AREA' then
                case when q.area_id = (select u.area_id from public.usuarios u where u.correo = $1) then $2 end
              when r.espera in ('SUSTENTO', 'VISTO_DISENO', 'COMPRA_CORTA', 'OC_POR_APROBAR', 'PENDIENTE_RECOJO',
                                'EN_RECOJO', 'RECOGIDO') then null
              when q.tipo = 'ADMINISTRACION' then 'administracion'
              else 'logistica'
            end as quien
       from public.recorrido_de_requerimientos(array(select id from public.requerimientos where estado not in ('ENTREGADO', 'ANULADO'))) r
       join public.requerimientos q on q.id = r.documento
      where r.situacion = 'AHORA'`,
    [correoDe(puesto), puesto],
  )
  const suyosIds = new Set(deQuien.filter((d) => d.quien === puesto).map((d) => d.id))
  // Lo que tiene su puesto, primero dentro de su grupo, y en el grupo de arriba justo eso.
  const mal = filas.filter((f) => f.grupo.endsWith('0') !== suyosIds.has(f.id))
  comprobar(mal.length === 0, `${puesto}: lo que tiene su puesto va primero en su grupo (${mal.map((f) => `${f.numero} ${f.visible}`).join(', ') || 'bien'})`)
  const textoLeyenda = limpio(await pagina.getByText(/espera(n)? por ti\.$/).first().textContent())
  const dice = /^Ninguno/.test(textoLeyenda) ? 0 : Number(textoLeyenda.match(/^(\d+)/)?.[1])
  const enBandeja = filas.filter((f) => suyosIds.has(f.id)).length
  comprobar(dice === enBandeja, `${puesto}: «${textoLeyenda}» cuenta los que tiene su puesto (${enBandeja} de ${filas.length})`)
  const arriba = filas.filter((f) => f.grupo.startsWith('0') !== suyosIds.has(f.id))
  comprobar(arriba.length === 0, `${puesto}: arriba van justo los que tiene su puesto (${arriba.map((f) => `${f.numero} ${f.visible}`).join(', ') || 'bien'})`)
  // «Te toca» y el globo: lo que tiene su puesto después de la revisión del stock
  // (la revisión va en su propia línea), con la cuenta de la base.
  const teEsperanBase = deQuien.filter((d) => d.quien === puesto && d.estado !== 'POR_ATENDER').length
  const [{ n: revisionBase }] = puesto === 'almacen'
    ? await comoCuenta(puesto, `select count(*)::int as n from public.requerimientos where estado = 'POR_ATENDER'`)
    : [{ n: 0 }]
  await ir(pagina, '/')
  const teToca = await pagina.locator('[data-te-toca] a').evaluateAll((as) =>
    as.map((a) => ({ texto: a.innerText.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href') ?? '', cantidad: Number(a.dataset.cantidad ?? 'NaN') })),
  )
  const teEsperan = teToca.filter((t) => t.href.startsWith('/requerimientos/atencion') && /esperan? por ti/.test(t.texto))
  comprobar(
    teEsperanBase === 0 ? teEsperan.length === 0 : teEsperan.length === 1 && teEsperan[0].cantidad === teEsperanBase,
    `${puesto}: «Te toca» cuenta lo que tiene su puesto: ${teEsperanBase} en la base (dice ${teEsperan.map((t) => t.texto).join(' | ') || 'nada'})`,
  )
  const viejas = teToca.filter((t) => /sin stock por comprar|listos? por entregar al área|en compra esperan? por ti/.test(t.texto))
  comprobar(viejas.length === 0, `${puesto}: ya no salen los textos de antes (${viejas.map((t) => t.texto).join(' | ') || 'nada'})`)
  const globo = await pagina.evaluate(() => {
    for (const a of document.querySelectorAll('a[href="/requerimientos/atencion"]')) {
      const l = a.getAttribute('aria-label') ?? ''
      if (/no se pudo comprobar/.test(l)) return '!'
      const m = l.match(/, (\d+) pendientes?$/)
      if (m) return Number(m[1])
    }
    return 0
  })
  const revisa = teToca.find((t) => /por revisar insumo por insumo/.test(t.texto))?.cantidad ?? 0
  comprobar(globo === revisa + teEsperanBase, `${puesto}: el globo del menú suma la revisión (${revisa}) y lo que tiene su puesto (${teEsperanBase}): dice ${globo}`)
  if (puesto === 'almacen') comprobar(revisa <= revisionBase, `${puesto}: la revisión cuenta a lo más los ${revisionBase} por revisar`)
  await ir(pagina, '/requerimientos/atencion?vista=todos')
  const historial = await pagina.locator('tr[id^="rq-"]').evaluateAll((trs) =>
    trs.map((tr) => ({
      estado: tr.querySelector('td:nth-child(3) span span')?.textContent.trim() ?? '',
      dias: Boolean(tr.querySelector('[data-dias-en-espera]')),
    })),
  )
  const cerrados = historial.filter((f) => /^(Entregado|Anulado)/.test(f.estado))
  const abiertos = historial.filter((f) => !/^(Entregado|Anulado)/.test(f.estado))
  comprobar(cerrados.length > 0 && cerrados.every((f) => !f.dias), `${puesto}: en el historial, los ${cerrados.length} entregados o anulados no llevan días`)
  comprobar(abiertos.every((f) => f.dias), `${puesto}: y los ${abiertos.length} abiertos sí`)
  await contexto.close()
}

} finally {
  await base.query('begin')
  await base.query('set local session_replication_role = replica')
  for (const r of areasDeAntes) await base.query('update public.requerimientos set area_id = $2 where id = $1', [r.id, r.area_id])
  await base.query('commit')
}

// ------------------------------------------------ 2b. Por comprar, la vista de trabajo de Logística
{
  const { pagina, contexto } = await entrar('logistica')
  await ir(pagina, '/requerimientos/atencion?vista=comprar')
  // Cada insumo, con el número de su RQ y su insignia.
  const filas = await pagina.locator('tbody tr').evaluateAll((trs) =>
    trs
      .filter((tr) => tr.querySelector('input[type="checkbox"][aria-label^="Marcar "]:not([aria-label^="Marcar todo"])'))
      .map((tr) => {
        const i = tr.querySelector('[data-dias-en-espera]')
        return {
          numero: tr.querySelector('td:nth-child(3) .tabular')?.textContent.trim() ?? '',
          dias: i ? Number(i.dataset.diasEnEspera) : null,
          visible: i?.querySelector('[aria-hidden="true"]:not(svg)')?.textContent.trim() ?? '',
        }
      }),
  )
  comprobar(filas.length > 0, `logistica: «Por comprar» tiene insumos para mirar (${filas.length})`)
  const numeros = [...new Set(filas.map((f) => f.numero))]
  const ids = await consulta(`select id, numero from public.requerimientos where numero = any($1)`, [numeros])
  const pasos = await comoCuenta(
    'logistica',
    `select r.numero, p.dias from public.recorrido_de_requerimientos($1::uuid[]) p join public.requerimientos r on r.id = p.documento where p.situacion = 'AHORA'`,
    [ids.map((r) => r.id)],
  )
  const diasDe = new Map(pasos.map((p) => [p.numero, Number(p.dias)]))
  const malos = filas.filter((f) => f.dias === null || f.dias !== diasDe.get(f.numero) || f.visible !== haceDias(f.dias))
  comprobar(
    malos.length === 0,
    `logistica: cada insumo por comprar dice los días de su RQ, los de la base (${filas.map((f) => `${f.numero} ${f.visible}`).join(' | ')})`,
  )
  await contexto.close()
}

// ------------------------------------------------ 2c. Si la base no cuenta, se dice
// Solo en el banco: se le quita un momento a `authenticated` la función que
// cuenta (y en Atención el recorrido, de donde salen los días), y se devuelve.
const erroresAntes = errores.length
try {
  await base.query('revoke execute on function public.dias_en_espera_de(timestamptz[]) from authenticated')
  await base.query('revoke execute on function public.recorrido_de_requerimientos(uuid[]) from authenticated')
  for (const [puesto, ruta] of [
    ['gerencia', '/compras/aprobacion'],
    ['almacen', '/requerimientos/atencion'],
  ]) {
    const { pagina, contexto } = await entrar(puesto)
    await ir(pagina, ruta)
    const aviso = pagina.locator('[data-dias-sin-leer]')
    const visible = (await aviso.count()) === 1 && (await aviso.isVisible())
    const insignias = await pagina.locator('[data-dias-en-espera]').count()
    comprobar(visible && insignias === 0, `${puesto}: si no se pudieron contar los días, ${ruta} lo dice («${visible ? limpio(await aviso.innerText()) : 'sin aviso'}»)`)
    if (puesto === 'almacen') {
      // Sin el recorrido no se cuenta con otra regla: la leyenda lo dice y el globo sale con «!».
      const leyenda = await pagina.getByText('No se pudo contar cuántos esperan por ti.').count()
      comprobar(leyenda === 1, `almacen: sin el recorrido, la bandeja dice que no pudo contar cuántos esperan por él`)
      await ir(pagina, '/')
      const globo = await pagina.evaluate(() =>
        [...document.querySelectorAll('a[href="/requerimientos/atencion"]')].some((a) => /no se pudo comprobar/.test(a.getAttribute('aria-label') ?? '')))
      const teToca = await pagina.locator('[data-te-toca] a').evaluateAll((as) => as.map((a) => a.innerText.replace(/\s+/g, ' ').trim()))
      comprobar(globo && !teToca.some((t) => /esperan? por ti/.test(t)),
        `almacen: sin el recorrido, el globo sale con «!» y «Te toca» no cuenta con otra regla (${teToca.join(' | ') || 'nada'})`)
    }
    await contexto.close()
  }
} finally {
  await base.query('grant execute on function public.dias_en_espera_de(timestamptz[]) to authenticated')
  await base.query('grant execute on function public.recorrido_de_requerimientos(uuid[]) to authenticated')
}
// Los errores de consola de ese rato son los que se provocaron a propósito.
errores.length = erroresAntes

// ------------------------------------------------ 2d. El supervisor recoge solo lo que falta sacar
// El RQ listo que ya salió entero del kardex lo tiene Almacén para marcarlo
// entregado (20261126170000): al supervisor no se le cuenta como «listo para recoger».
{
  // Lo que espera su recojo según el recorrido leído con su sesión: las salidas
  // del kardex no las ve, y por ellas no se puede saber.
  const [{ n: porRecoger, listos }] = await comoCuenta(
    'sup.mtz',
    `select count(*) filter (where r.espera = 'RECOJO_DEL_AREA')::int as n, count(*)::int as listos
       from public.requerimientos q
       join public.areas a on a.id = q.area_id
       join public.recorrido_de_requerimientos(array(select id from public.requerimientos where estado = 'LISTO_EN_ALMACEN')) r
         on r.documento = q.id and r.situacion = 'AHORA'
      where q.estado = 'LISTO_EN_ALMACEN' and a.nombre = 'Maestranza'`,
  )
  const [{ n: salidoEntero }] = await consulta(
    `select count(*)::int as n from public.requerimientos q join public.areas a on a.id = q.area_id
      where q.estado = 'LISTO_EN_ALMACEN' and a.nombre = 'Maestranza'
        and not exists (select 1 from public.v_rq_lineas_para_salida v where v.requerimiento_id = q.id and v.pendiente > 0)`,
  )
  const { pagina, contexto } = await entrar('sup.mtz')
  await ir(pagina, '/')
  const recoger = await pagina.locator('[data-te-toca] a').evaluateAll((as) =>
    as.map((a) => ({ texto: a.innerText.replace(/\s+/g, ' ').trim(), cantidad: Number(a.dataset.cantidad ?? 'NaN') }))
      .filter((t) => /listos? para recoger en almacén/.test(t.texto)))
  comprobar(
    porRecoger === 0 ? recoger.length === 0 : recoger.length === 1 && recoger[0].cantidad === porRecoger,
    `sup.mtz: «listos para recoger» cuenta los ${porRecoger} que tienen algo por salir del kardex, de ${listos} listos (dice ${recoger.map((t) => t.texto).join(' | ') || 'nada'})`,
  )
  comprobar(salidoEntero > 0 && porRecoger === listos - salidoEntero,
    `sup.mtz: el que ya salió entero no cuenta: ${listos} listos, ${salidoEntero} ya salió entero, ${porRecoger} por recoger`)
  await contexto.close()
}

// ------------------------------------------------ 3. Portería
{
  const { pagina, contexto } = await entrar('porteria')
  for (const ruta of ['/requerimientos/atencion', '/compras/aprobacion']) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    comprobar(pagina.url().includes('/sin-permiso'), `Portería no entra a ${ruta}`)
  }
  await contexto.close()
}

// ------------------------------------------------ 4. Capturas, 390 y 1440
for (const ancho of [390, 1440]) {
  for (const [puesto, ruta, archivo] of [
    ['almacen', '/requerimientos/atencion', 'dias-atencion-almacen'],
    ['gerencia', '/compras/aprobacion', 'dias-aprobacion-gerencia'],
    ['logistica', '/requerimientos/atencion?vista=comprar', 'dias-por-comprar-logistica'],
    ['logistica', '/requerimientos/atencion', 'te-esperan-atencion-logistica'],
    ['almacen', '/', 'te-esperan-inicio-almacen'],
    ['logistica', '/', 'te-esperan-inicio-logistica'],
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
