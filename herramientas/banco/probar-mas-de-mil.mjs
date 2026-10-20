/**
 * Las pantallas del costeo y del avance con más de mil filas, que es lo que
 * Supabase entrega como mucho por respuesta (`max_rows`). El banco corta igual
 * (`MAX_FILAS` en `rest.mjs`), así que aquí sale lo mismo que en producción.
 *
 *   1. RR. HH., en el costeo por código de un mes con 1 100 cargas de horas: el
 *      total del mes es el de la base.
 *   2. Gerencia, en el costeo de una unidad con horas en 1 100 días: la mano
 *      de obra suma lo de la base.
 *   3. Supervisión de Maestranza, en Planos y etapas: de entrada ve solo los
 *      códigos con algo por hacer, el último de 1 100 entre ellos, y los
 *      terminados aparte, de cincuenta en cincuenta y con el buscador.
 *   4. Gerencia abre el código con el cambio más viejo, el último de la lista
 *      de 1 100: no le dice que no existe.
 *   5. Gerencia, en Códigos internos: de entrada ve los abiertos, y los de
 *      costeo cerrado aparte, de cincuenta en cincuenta y con el buscador.
 *
 * Los datos se siembran como postgres con un código distinto en cada corrida y
 * se borran al final, aunque algo falle. Necesita las cuentas
 * `*.local@metalwork.test`. Variables: BANCO_CLAVE, BASE (http://localhost:3111).
 */
import { randomBytes, randomUUID } from 'node:crypto'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}

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
const soles = (n) => `S/ ${Number(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const horas = (n) => `${Number(n).toLocaleString('es-PE', { maximumFractionDigits: 2 })} h`

const MARCA = randomBytes(2).toString('hex').toUpperCase()
const COSTEO = `MIL-${MARCA}-COSTEO`
// El costeo de la unidad junta las horas de un mismo día: para pasar de mil
// líneas, este código tiene una carga en cada uno de 1 100 días seguidos.
const LARGO = `MIL-${MARCA}-LARGO`
const prefijo = `MIL-${MARCA}-`
const CUANTOS = 1100
const MES = '2025-03'
const ultimoCodigo = `${prefijo}${String(CUANTOS).padStart(4, '0')}`
const masViejo = `${prefijo}0001`
// Los primeros, con su etapa terminada y el costeo cerrado; los últimos, abiertos.
const TERMINADOS = 1040
const ABIERTOS = CUANTOS - TERMINADOS
const POR_PAGINA = 50
// Una página que se pinta entera con mil códigos tardaba medio minuto en `next dev`.
const RESPUESTA_MAXIMA_MS = 15000
const TRABAJADOR = randomUUID()
const DNI = String(Math.floor(Math.random() * 1e8)).padStart(8, '9')

async function sembrar() {
  const [{ id: rrhh }] = await consulta(`select id from usuarios where correo = 'rrhh.local@metalwork.test'`)
  const [{ id: mtz }] = await consulta(`select id from areas where codigo = 'MTZ'`)
  await base.query('begin')
  // Sin disparadores: mil filas de auditoría y de registro de prueba no prueban nada aquí.
  await base.query('set local session_replication_role = replica')
  const [{ id: trabajador }] = (
    await base.query(
      `insert into trabajadores (id, nombres, apellidos, dni, cargo, area_id, creado_por)
       values ($1, 'Prueba', 'De Más De Mil', $2, 'Soldador', $3, $4) returning id`,
      [TRABAJADOR, DNI, mtz, rrhh],
    )
  ).rows
  await base.query(
    `insert into tareos (trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo, registrado_por)
     select $1, date '${MES}-01' + (i % 28), $2, 1, 'Prueba de más de mil', 10.5, 10.5, $3
       from generate_series(1, ${CUANTOS}) i`,
    [trabajador, COSTEO, rrhh],
  )
  await base.query(
    `insert into tareos (trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo, registrado_por)
     select $1, date '2022-01-01' + i, $2, 1, 'Prueba de más de mil', 10.5, 10.5, $3
       from generate_series(1, ${CUANTOS}) i`,
    [trabajador, LARGO, rrhh],
  )
  await base.query(
    `insert into codigo_etapas (codigo_interno, orden, nombre, area_id, inicio_plan, fin_plan, inicio_real, fin_real, creado_por, creado_en, actualizado_en)
     select $1 || lpad(i::text, 4, '0'), 1, 'Habilitado', $2, current_date, current_date + 10,
            case when i <= ${TERMINADOS} then current_date - 20 end, case when i <= ${TERMINADOS} then current_date - 20 + (i % 15) end, $3,
            now() - make_interval(days => i), case when i = 1 then timestamptz '2001-01-01' else now() - make_interval(mins => i) end
       from generate_series(1, ${CUANTOS}) i`,
    [prefijo, mtz, rrhh],
  )
  // Los terminados tienen algo costeado y Gerencia les cerró el costeo.
  await base.query(
    `insert into tareos (trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo, registrado_por)
     select $1, date '2024-06-15', $2 || lpad(i::text, 4, '0'), 1, 'Prueba de más de mil', 10.5, 10.5, $3
       from generate_series(1, ${TERMINADOS}) i`,
    [trabajador, prefijo, rrhh],
  )
  const [{ id: gerencia }] = (await base.query(`select id from usuarios where correo = 'gerencia.local@metalwork.test'`)).rows
  await base.query(
    `insert into codigo_interno_cierres (codigo, costo_pen, por_fuente, cerrado_por)
     select $1 || lpad(i::text, 4, '0'), 10.5, '{}'::jsonb, $2 from generate_series(1, ${TERMINADOS}) i`,
    [prefijo, gerencia],
  )
  await base.query('commit')
}

async function limpiar() {
  await base.query('begin')
  await base.query('set local session_replication_role = replica')
  await base.query('delete from tareos where codigo_interno in ($1, $2) or codigo_interno like $3', [COSTEO, LARGO, `${prefijo}%`])
  await base.query('delete from codigo_interno_cierres where codigo like $1', [`${prefijo}%`])
  await base.query('delete from codigo_etapas where codigo_interno like $1', [`${prefijo}%`])
  await base.query('delete from trabajadores where id = $1', [TRABAJADOR])
  await base.query('commit')
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

/** Abre la ruta y devuelve cuánto tardó la página en responder. */
async function ir(pagina, ruta) {
  const desde = Date.now()
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
  return Date.now() - desde
}
const tarjetas = (pagina) => pagina.locator('main li[data-codigo]').evaluateAll((li) => li.map((l) => l.dataset.codigo))
const pastilla = async (pagina, texto) => limpio(await pagina.locator('main a[data-filtro]', { hasText: texto }).first().innerText())

async function entrar(correo) {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  // Con 1 100 códigos, /planos tarda más de 30 s en pintarse en `next dev`.
  pagina.setDefaultNavigationTimeout(120000)
  pagina.setDefaultTimeout(120000)
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto }
}

try {
  await sembrar()
  console.log(`Sembrado: ${CUANTOS} horas en ${COSTEO} (${MES}) y ${CUANTOS} códigos con una etapa de Maestranza.`)

  // 1. RR. HH.: el total del mes.
  {
    const [mes] = await consulta(
      `select sum(horas) h, sum(costo) c, count(distinct codigo_interno) n from tareos
        where fecha >= date '${MES}-01' and fecha < date '${MES}-01' + interval '1 month' and anulado_en is null`,
    )
    comprobar(Number(mes.h) > 1000, `el mes tiene más de mil horas cargadas (${mes.h})`)
    const { pagina, contexto } = await entrar('rrhh.local@metalwork.test')
    await pagina.goto(`${BASE}/rrhh/costeo?mes=${MES}`, { waitUntil: 'networkidle' })
    const cuerpo = limpio(await pagina.locator('main').innerText())
    const esperado = `${horas(mes.h)} · ${soles(mes.c)} en ${mes.n} ${Number(mes.n) === 1 ? 'código' : 'códigos'}`
    comprobar(cuerpo.includes(esperado), `RR. HH. ve el total del mes «${esperado}»`)
    if (!cuerpo.includes(esperado)) console.log(`    vio: ${cuerpo.match(/[\d.,]+ h · S\/ [\d.,]+ en \d+ c\S+/)?.[0]}`)
    await contexto.close()
  }

  // 2 y 4. Gerencia: la mano de obra de la unidad y el código más viejo.
  {
    const [cod] = await consulta('select sum(horas) h, sum(costo) c from tareos where codigo_interno = $1 and anulado_en is null', [LARGO])
    const { pagina, contexto } = await entrar('gerencia.local@metalwork.test')
    await pagina.goto(`${BASE}/codigos-internos/detalle?codigo=${LARGO}&vista=costeo`, { waitUntil: 'networkidle' })
    const total = limpio(
      await pagina.locator('table', { has: pagina.locator('th', { hasText: 'Horas' }) }).first().locator('tr', { hasText: 'Total' }).innerText(),
    )
    comprobar(total.includes(horas(cod.h)) && total.includes(soles(cod.c)), `Gerencia ve la mano de obra «${horas(cod.h)} · ${soles(cod.c)}» (vio «${total}»)`)

    await pagina.goto(`${BASE}/codigos-internos/detalle?codigo=${masViejo}`, { waitUntil: 'networkidle' })
    const cuerpo = limpio(await pagina.locator('main').innerText())
    comprobar(!cuerpo.includes('Este código no aparece en el sistema'), `Gerencia abre ${masViejo}, el de cambio más viejo, y no le dice que no existe`)
    await contexto.close()
  }

  // 3. Supervisión de Maestranza: lo que falta hacer, y los terminados aparte.
  {
    const { pagina, contexto } = await entrar('sup.mtz.local@metalwork.test')
    const ms = await ir(pagina, '/planos')
    comprobar(ms < RESPUESTA_MAXIMA_MS, `Planos y etapas responde en ${(ms / 1000).toFixed(1)} s (antes, medio minuto)`)
    const primera = await tarjetas(pagina)
    comprobar(primera.length === POR_PAGINA, `«Por hacer» pinta ${POR_PAGINA} por página (pintó ${primera.length})`)
    await ir(pagina, '/planos?pagina=2')
    const vistos = [...primera, ...(await tarjetas(pagina))].filter((c) => c.startsWith(prefijo))
    comprobar(vistos.includes(ultimoCodigo), `Supervisión de Maestranza ve ${ultimoCodigo}, el último de ${CUANTOS}, en «Por hacer»`)
    comprobar(vistos.length === ABIERTOS, `«Por hacer» trae los ${ABIERTOS} códigos con la etapa sin terminar (trajo ${vistos.length})`)
    comprobar(!vistos.includes(masViejo), `${masViejo}, con su etapa terminada, no sale en «Por hacer»`)
    const terminados = await pastilla(pagina, 'Terminados')
    comprobar(Number(terminados.match(/\d+/)?.[0]) >= TERMINADOS, `la pastilla dice «${terminados}», con los ${TERMINADOS} terminados`)

    const ms2 = await ir(pagina, '/planos?ver=terminados')
    const pagina1 = await tarjetas(pagina)
    comprobar(pagina1.length === POR_PAGINA, `«Terminados» pinta ${POR_PAGINA} por página (pintó ${pagina1.length}, en ${(ms2 / 1000).toFixed(1)} s)`)
    comprobar(pagina1.every((c) => !c.startsWith(prefijo) || Number(c.slice(prefijo.length)) <= TERMINADOS), '«Terminados» no trae ningún código con la etapa abierta')
    comprobar((await pagina.locator('nav[aria-label="Paginación"] a', { hasText: 'Siguiente' }).count()) === 1, '«Terminados» ofrece la página siguiente')
    await pagina.locator('nav[aria-label="Paginación"] a', { hasText: 'Siguiente' }).click()
    await pagina.waitForURL((u) => u.searchParams.get('pagina') === '2')
    await pagina.waitForLoadState('networkidle')
    const pagina2 = await tarjetas(pagina)
    comprobar(pagina2.length > 0 && pagina2.every((c) => !pagina1.includes(c)), `la página 2 trae otros ${pagina2.length} códigos`)

    await ir(pagina, `/planos?ver=terminados&q=${encodeURIComponent(masViejo)}`)
    comprobar((await tarjetas(pagina)).includes(masViejo), `el buscador encuentra ${masViejo} entre los terminados`)
    await ir(pagina, `/planos?q=${encodeURIComponent(masViejo)}`)
    const cuerpo = limpio(await pagina.locator('main').innerText())
    comprobar(cuerpo.includes('Ningún código con esta búsqueda'), `buscado en «Por hacer», ${masViejo} dice que mire en las otras pestañas`)
    await contexto.close()
  }

  // 5. Gerencia: los códigos abiertos, y los de costeo cerrado aparte.
  {
    const [{ n: cerrados }] = await consulta(`select count(*)::int n from codigo_interno_cierres where reabierto_en is null`)
    const { pagina, contexto } = await entrar('gerencia.local@metalwork.test')
    const ms = await ir(pagina, '/codigos-internos')
    comprobar(ms < RESPUESTA_MAXIMA_MS, `Códigos internos responde en ${(ms / 1000).toFixed(1)} s (antes, de 21 a 32 s)`)
    const vistos = await pagina.locator('main li a[data-codigo]').evaluateAll((a) => a.map((l) => l.dataset.codigo))
    comprobar(vistos.length === POR_PAGINA, `pinta ${POR_PAGINA} por página (pintó ${vistos.length})`)
    comprobar(
      vistos.every((c) => !c.startsWith(prefijo) || Number(c.slice(prefijo.length)) > TERMINADOS),
      'de entrada no sale ningún código con el costeo cerrado',
    )
    comprobar((await pagina.locator('main li', { hasText: 'Costeo cerrado' }).count()) === 0, 'ninguna fila dice «Costeo cerrado»')
    const deCerrados = await pastilla(pagina, 'Costeo cerrado')
    comprobar(deCerrados === `Costeo cerrado (${cerrados})`, `la pastilla dice «${deCerrados}» y la base tiene ${cerrados} cerrados`)

    await ir(pagina, '/codigos-internos?costeo=cerrados')
    const filas = await pagina.locator('main li a[data-codigo]').count()
    const conInsignia = await pagina.locator('main li', { hasText: 'Costeo cerrado' }).count()
    comprobar(filas === POR_PAGINA && conInsignia === filas, `«Costeo cerrado» pinta ${filas}, todos con su insignia (${conInsignia})`)

    await ir(pagina, `/codigos-internos?q=${encodeURIComponent(masViejo)}`)
    const cuerpo = limpio(await pagina.locator('main').innerText())
    comprobar(cuerpo.includes('Mira en «Costeo cerrado» (1)'), `buscado entre los abiertos, ${masViejo} avisa que está en «Costeo cerrado»`)
    await ir(pagina, `/codigos-internos?costeo=cerrados&q=${encodeURIComponent(masViejo)}`)
    const encontrado = await pagina
      .locator(`main li a[data-codigo="${masViejo}"]`)
      .waitFor({ timeout: 10000 })
      .then(() => true)
      .catch(() => false)
    comprobar(encontrado, `el buscador encuentra ${masViejo} entre los de costeo cerrado`)
    if (!encontrado) console.log(`    vio en ${pagina.url()}: ${limpio(await pagina.locator('main').innerText()).slice(0, 400)}`)
    await contexto.close()
  }
} catch (e) {
  fallas.push(String(e?.message ?? e))
  console.error(e)
} finally {
  await limpiar().catch((e) => fallas.push(`No se pudo limpiar: ${e.message}`))
  await navegador.close()
  await base.end()
}

console.log(fallas.length ? `\n${fallas.length} fallas` : '\nTodo bien')
process.exit(fallas.length ? 1 : 0)
