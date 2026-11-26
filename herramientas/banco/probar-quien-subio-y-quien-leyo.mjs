/**
 * Clic real sobre la migración 20261126930000 (plan 6, entrega 6.3): en Planos
 * y en Archivos DXF de Diseño, cada versión con quién la subió (su puesto) y
 * cuándo, y si Maestranza y Producción leyeron su aviso. Con la cuenta de cada
 * puesto, nunca ADMIN:
 *
 *   1. Diseño ve en cada plano su revisión vigente con quién la subió y si el
 *      área leyó su aviso, y lo mismo en las revisiones anteriores. Lo
 *      esperado sale de las tablas (`notificaciones`), no de la función.
 *   2. En los DXF, cada envío con quién lo subió y el aviso de cada área.
 *   3. El supervisor de Producción abre su aviso en la campana, con clic, y
 *      Diseño lo ve leído al volver a cargar. Se deshace al final.
 *   4. El supervisor sigue viendo Planos y etapas como antes, sin esto.
 *      Logística no entra a la pantalla de Diseño.
 *   5. En el teléfono (390, 360 y 320) nada se sale, ni cada aviso de su fila.
 *      Capturas en 390 y 1440.
 *
 * Necesita lo que siembra `sembrar-quien-subio-y-quien-leyo.sql`. Variables:
 * BANCO_CLAVE, BASE (http://localhost:3113), BANCO_BASE (mw_demo),
 * BANCO_CHROMIUM, CAPTURAS.
 */
import { mkdirSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { conReact } from './con-react.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3113'
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
const CODIGO = 'SR-101'

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
  // La página puede no desbordar y la insignia salirse igual de su fila: se mide
  // cada aviso, con todo lo que lleva dentro, contra el borde de su fila.
  const fuera = await pagina.evaluate(() =>
    [...document.querySelectorAll('[data-aviso-area]')].flatMap((aviso) => {
      const fila = aviso.closest('li').getBoundingClientRect()
      return [aviso, ...aviso.querySelectorAll('*')]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && (r.right > fila.right + 0.5 || r.left < fila.left - 0.5))
        .map((r) => Math.round(Math.max(r.right - fila.right, fila.left - r.left)))
    }),
  )
  comprobar(fuera.length === 0, `${donde}: ningún aviso se sale de su fila${fuera.length ? ` (se pasan ${fuera.join(', ')} px)` : ''}`)
}

// ------------------------------------------------ Lo esperado, de las tablas
/**
 * Cada versión de SR-101 con el aviso de cada área, contado sobre
 * `notificaciones` sin pasar por la función: el de un plano es el del mismo
 * plano y el mismo momento que la revisión; el de un envío, el de cualquiera
 * de sus archivos. Cuentan las cuentas del área.
 */
async function esperado() {
  const filas = await consulta(
    `with v as (
       select 'PLANO' as tipo, r.id as clave, r.revision, p.numero, a.codigo as area,
              (select count(*) from public.notificaciones n join public.usuarios u on u.id = n.usuario_id
                where n.origen_tabla = 'codigo_planos' and n.origen_id = p.id and n.creado_en = r.subido_en and u.area_id = a.id) as dest,
              (select count(*) from public.notificaciones n join public.usuarios u on u.id = n.usuario_id
                where n.origen_tabla = 'codigo_planos' and n.origen_id = p.id and n.creado_en = r.subido_en and u.area_id = a.id
                  and n.leida_en is not null) as leidos
         from public.codigo_planos p join public.codigo_plano_revisiones r on r.plano_id = p.id join public.areas a on a.id = p.area_id
        where p.codigo_interno = $1 and p.anulado_en is null
       union all
       select 'DXF', e.envio, null, null, a.codigo,
              (select count(*) from public.notificaciones n join public.usuarios u on u.id = n.usuario_id
                where n.origen_tabla = 'codigo_dxf' and n.origen_id in (select id from public.codigo_dxf where envio = e.envio) and u.area_id = a.id),
              (select count(*) from public.notificaciones n join public.usuarios u on u.id = n.usuario_id
                where n.origen_tabla = 'codigo_dxf' and n.origen_id in (select id from public.codigo_dxf where envio = e.envio) and u.area_id = a.id
                  and n.leida_en is not null)
         from (select distinct envio from public.codigo_dxf where codigo_interno = $1 and quitado_en is null) e
        cross join public.areas a where a.codigo in ('MTZ', 'PRD'))
     select tipo, clave, revision, numero, area, dest::int, leidos::int from v`,
    [CODIGO],
  )
  const situacion = (f) => (f.dest === 0 ? 'sin-aviso' : f.leidos === 0 ? 'sin-leer' : f.leidos < f.dest ? 'parcial' : 'leido')
  return filas.map((f) => ({ ...f, situacion: situacion(f) }))
}

const nombres = (await consulta(`select nombres, apellidos from public.usuarios where correo in ($1, $2, $3)`, [
  correoDe('diseno'),
  correoDe('sup.mtz'),
  correoDe('sup.prd'),
])).flatMap((u) => [`${u.nombres} ${u.apellidos}`, u.apellidos])

/** Las insignias de aviso dentro de un bloque: área → situación. */
const avisosEn = (localizador) =>
  localizador.evaluate((el) => Object.fromEntries([...el.querySelectorAll('[data-aviso-area]')].map((i) => [i.dataset.avisoArea, i.dataset.aviso])))

let deshacer = null
try {
  let tablas = await esperado()
  comprobar(tablas.some((t) => t.tipo === 'PLANO' && t.revision === 2) && tablas.some((t) => t.tipo === 'DXF'),
    'el banco tiene un plano con dos revisiones y un envío de DXF')
  comprobar(tablas.some((t) => t.situacion === 'leido') && tablas.some((t) => t.situacion === 'sin-leer'),
    'y avisos leídos y sin leer')

  // ------------------------------------------------ 1. Diseño, Planos
  {
    const { pagina, contexto } = await entrar('diseno')
    await ir(pagina, `/diseno/codigo?codigo=${CODIGO}`)
    const planos = await consulta(
      `select p.id, p.numero, a.codigo as area, r.id as revision_id, r.revision
         from public.codigo_planos p join public.areas a on a.id = p.area_id
         join lateral (select id, revision from public.codigo_plano_revisiones where plano_id = p.id order by revision desc limit 1) r on true
        where p.codigo_interno = $1 and p.anulado_en is null`,
      [CODIGO],
    )
    for (const p of planos) {
      const fila = pagina.locator(`li[data-plano="${p.id}"]`)
      const t = tablas.find((x) => x.clave === p.revision_id && x.area === p.area)
      const enPantalla = await avisosEn(fila)
      comprobar(igual(enPantalla, { [p.area]: t.situacion }),
        `${p.numero} R${p.revision}: el aviso de ${p.area} sale «${t.situacion}», como en las tablas (${JSON.stringify(enPantalla)})`)
      comprobar(/Subido por Diseño el \d\d\/\d\d\/\d{4}/.test(await fila.innerText()), `${p.numero}: dice que lo subió Diseño y cuándo`)
    }
    // Las revisiones anteriores de P-01: la R1, con su aviso.
    const p01 = planos.find((p) => p.revision === 2)
    const r1 = tablas.find((t) => t.tipo === 'PLANO' && t.numero === p01.numero && t.revision === 1)
    const fila = pagina.locator(`li[data-plano="${p01.id}"]`)
    await fila.getByText('Revisiones anteriores').click()
    const anterior = await fila.locator('li[data-revision="1"]').innerText()
    const palabras = { leido: /Maestranza leyó el aviso\s+el \d\d\/\d\d\/\d{4}/, 'sin-leer': /Maestranza no leyó el aviso/ }[r1.situacion]
    comprobar(/subida por Diseño el/.test(anterior) && palabras?.test(anterior),
      `la R1 de ${p01.numero}, en las anteriores, dice quién la subió y que el aviso está «${r1.situacion}» («${anterior}»)`)
    const texto = await pagina.locator('main').innerText()
    comprobar(!nombres.some((n) => texto.includes(n)), 'ningún nombre de persona: solo puestos')
    await capturar(pagina, '6-3-diseno-planos-1440.png')
    await sinDesborde(pagina, 'Planos del código, diseno a 1440')
    await contexto.close()
  }

  // ------------------------------------------------ 2. Diseño, Archivos DXF
  {
    const { pagina, contexto } = await entrar('diseno')
    await ir(pagina, `/diseno/codigo?codigo=${CODIGO}&vista=dxf`)
    for (const t of tablas.filter((x) => x.tipo === 'DXF' && x.area === 'MTZ')) {
      const envio = pagina.locator(`li[data-envio="${t.clave}"]`)
      const enPantalla = await avisosEn(envio)
      const esperados = Object.fromEntries(tablas.filter((x) => x.clave === t.clave).map((x) => [x.area, x.situacion]))
      comprobar(igual(enPantalla, esperados), `el envío de DXF: el aviso de cada área como en las tablas (${JSON.stringify(enPantalla)})`)
      comprobar(/subidos? por Diseño el \d\d\/\d\d\/\d{4}/.test(await envio.innerText()), 'el envío dice que lo subió Diseño y cuándo')
    }
    await capturar(pagina, '6-3-diseno-dxf-1440.png')
    await sinDesborde(pagina, 'DXF del código, diseno a 1440')
    await contexto.close()
  }

  // ------------------------------------------------ 3. Producción abre su aviso con clic; Diseño lo ve leído
  {
    const [aviso] = await consulta(
      `select n.id from public.notificaciones n join public.usuarios u on u.id = n.usuario_id
        where u.correo = $1 and n.origen_tabla = 'codigo_dxf' and n.leida_en is null
          and n.origen_id in (select id from public.codigo_dxf where codigo_interno = $2)`,
      [correoDe('sup.prd'), CODIGO],
    )
    comprobar(Boolean(aviso), 'el supervisor de Producción tiene sin leer el aviso de los DXF')
    if (aviso) {
      deshacer = aviso.id
      const { pagina, contexto } = await entrar('sup.prd')
      await ir(pagina, '/')
      await pagina.getByRole('button', { name: /^Avisos/ }).click()
      await pagina.locator('#panel-avisos').getByRole('button', { name: new RegExp(`DXF nuevos: ${CODIGO}`) }).first().click()
      await pagina.waitForLoadState('networkidle')
      let leida = null
      for (let i = 0; i < 20 && !leida; i++) {
        ;[{ leida_en: leida }] = await consulta('select leida_en from public.notificaciones where id = $1', [aviso.id])
        if (!leida) await new Promise((r) => setTimeout(r, 250))
      }
      comprobar(Boolean(leida), 'con el toque en la campana, la base marca su aviso leído')
      await contexto.close()

      tablas = await esperado()
      const d = await entrar('diseno')
      await ir(d.pagina, `/diseno/codigo?codigo=${CODIGO}&vista=dxf`)
      const t = tablas.find((x) => x.tipo === 'DXF' && x.area === 'PRD')
      const enPantalla = await avisosEn(d.pagina.locator(`li[data-envio="${t.clave}"]`))
      comprobar(enPantalla.PRD === 'leido' && t.situacion === 'leido', `Diseño, al volver a cargar, ve que Producción leyó el aviso (${JSON.stringify(enPantalla)})`)
      comprobar(/Producción leyó el aviso\s+el \d\d\/\d\d\/\d{4}/.test(await d.pagina.locator('main').innerText()), 'y lo dice con la fecha')
      await d.contexto.close()
    }
  }

  // ------------------------------------------------ 4. El supervisor sigue como antes; Logística no entra
  {
    const { pagina, contexto } = await entrar('sup.mtz')
    await ir(pagina, `/planos?q=${CODIGO}`)
    comprobar((await pagina.locator('[data-plano]').count()) > 0 && (await pagina.locator('[data-aviso-area]').count()) === 0,
      'el supervisor ve sus planos en Planos y etapas, sin quién leyó los avisos: es de Diseño')
    await contexto.close()
  }
  {
    const { pagina, contexto } = await entrar('logistica')
    await ir(pagina, `/diseno/codigo?codigo=${CODIGO}`)
    comprobar(new URL(pagina.url()).pathname === '/sin-permiso', `Logística no entra a la pantalla de Diseño (${new URL(pagina.url()).pathname})`)
    await contexto.close()
  }

  // ------------------------------------------------ 5. En el teléfono
  for (const [vista, archivo] of [['', 'planos'], ['&vista=dxf', 'dxf']]) {
    for (const ancho of [390, 360, 320]) {
      const { pagina, contexto } = await entrar('diseno', ancho)
      await ir(pagina, `/diseno/codigo?codigo=${CODIGO}${vista}`)
      // Las revisiones anteriores, abiertas: también llevan el aviso.
      for (const pliegue of await pagina.locator('details:has([data-revision])').all()) await pliegue.evaluate((d) => (d.open = true))
      await sinDesborde(pagina, `${archivo === 'dxf' ? 'DXF' : 'Planos'} del código, diseno a ${ancho}`)
      if (ancho === 390) await capturar(pagina, `6-3-diseno-${archivo}-390.png`)
      await contexto.close()
    }
  }
  comprobar(errores.length === 0, `sin errores de consola ni de hidratación ${errores.join(' | ')}`)
} finally {
  if (deshacer) await consulta('update public.notificaciones set leida_en = null where id = $1', [deshacer])
  await navegador.close()
  await base.end()
}

function igual(a, b) {
  return JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())
}

console.log(fallas.length === 0 ? '\nTodo en orden.' : `\n${fallas.length} falla(s).`)
process.exit(fallas.length === 0 ? 0 : 1)
