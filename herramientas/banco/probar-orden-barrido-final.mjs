/**
 * Entrega 7 del plan de orden y diseño (2026-11-27): RR. HH., Administración,
 * Ventas y el barrido final por todo el sistema. Con la cuenta de cada puesto,
 * nunca ADMIN, recorre su menú entero y mira:
 *
 *   1. En cada pantalla del menú, a 1440, 1024 y 390 en tema claro y a 390 en
 *      tema oscuro: nada se sale por el costado, ninguna tabla se sale de su
 *      tarjeta, ninguna letra de menos de 12 px (salvo el glifo «i» de la
 *      ayuda), el texto se lee sobre su fondo (contraste de 4.5, o 3 si es
 *      grande), la consola sin errores y ningún botón de la pantalla con el
 *      borde rojo (decisión 6: anular, quitar, dar de baja y borrar van sin
 *      borde y al final; «Rechazar» y «No autorizar» son decisiones y lo
 *      conservan).
 *   2. Clientes con Ventas a 1024: ubicación, unidades y órdenes bajan bajo el
 *      nombre; desde 1280 tienen su columna.
 *   3. Atención de requerimientos con Logística: «Por comprar» a 390 es una
 *      lista con el RQ y el código bajo el insumo; entre 768 y 1279 la columna de
 *      los insumos es más ancha que la de los botones.
 *   4. Los vacíos que se escribían a mano usan el componente común: Costeo
 *      («Ninguna planilla diaria pagó horas extras este mes») con RR. HH.
 *
 * Solo consulta: no abre ventanas ni escribe en la base.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_CHROMIUM,
 * PUESTOS (separados por coma; por omisión los diecinueve del banco),
 * ANCHOS (1440,1024,390) y OSCURO (390; vacío para no mirarlo).
 */
import { existsSync } from 'node:fs'

import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR =
  process.env.BANCO_CHROMIUM ??
  ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((r) => existsSync(r))
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}

const PUESTOS = (
  process.env.PUESTOS ??
  'rrhh,administracion,ventas,gerencia.comercial,gerencia,gerencia.produccion,almacen,logistica,requerimientos,diseno,sup.prd,sup.mtz,sup.acb,tesoreria,contabilidad,mantenimiento,porteria,conductor,colaborador'
)
  .split(',')
  .filter(Boolean)
const ANCHOS = (process.env.ANCHOS ?? '1440,1024,390').split(',').map(Number)
const OSCURO = (process.env.OSCURO ?? '390').split(',').filter(Boolean).map(Number)
const ALTOS = { 1440: 900, 1366: 768, 1280: 800, 1024: 768, 768: 1024, 390: 844 }
/** Botones que pueden llevar el borde rojo: son decisiones, no lo de una vez (decisión 6). */
const ROJOS_PERMITIDOS = /^(Rechazar|No autorizar|Dejarla sin nadie)/

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(puesto, ancho, tema = 'light') {
  const viewport = { width: ancho, height: ALTOS[ancho] ?? 900 }
  const movil = ancho < 500
  const contexto = await navegador.newContext({ viewport, isMobile: movil, hasTouch: movil, colorScheme: tema, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !/_next\/hmr|WebSocket/.test(m.text())) errores.push(m.text().slice(0, 300))
  })
  pagina.on('pageerror', (e) => errores.push(`pageerror ${e.message.slice(0, 300)}`))
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', `${puesto}.local@metalwork.test`)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 60000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${puesto}`)
  return { pagina, contexto, errores }
}

async function ir(pagina, ruta) {
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle', timeout: 120000 })
  await pagina.waitForSelector('main', { timeout: 60000 })
}

/** Las rutas del menú del puesto, como las ve en el monitor. */
async function menuDe(puesto) {
  const { pagina, contexto } = await entrar(puesto, 1440)
  const rutas = await pagina.evaluate(() => {
    const vistas = new Set()
    for (const a of document.querySelectorAll('aside a[href^="/"], nav a[href^="/"]')) {
      const h = a.getAttribute('href').split('#')[0]
      if (h && h !== '/' && !h.startsWith('/ingresar')) vistas.add(h)
    }
    return [...vistas]
  })
  await contexto.close()
  return ['/', ...rutas]
}

/** Todo lo que se mira en una pantalla, en un ancho y un tema. */
const medir = (pagina) =>
  pagina.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
    }
    const main = document.querySelector('main')
    const conTexto = [...main.querySelectorAll('*')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && visible(el))
    const rgba = (c) => {
      const v = c.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]
      return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }
    }
    const lum = ({ r, g, b }) => {
      const f = (x) => ((x /= 255) <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const fondo = (el) => {
      for (let e = el; e; e = e.parentElement) {
        const c = rgba(getComputedStyle(e).backgroundColor)
        if (c.a > 0.5) return c
      }
      return rgba(getComputedStyle(document.body).backgroundColor)
    }
    const bajos = []
    for (const el of conTexto) {
      const cs = getComputedStyle(el)
      // Lo apagado a propósito (un botón inactivo, lo anulado y tachado) no cuenta.
      if (el.closest('button:disabled, [aria-disabled="true"], del, s, .line-through, .opacity-60') || cs.textDecorationLine.includes('line-through')) continue
      const c = rgba(cs.color)
      const f = fondo(el)
      const mezcla = { r: c.r * c.a + f.r * (1 - c.a), g: c.g * c.a + f.g * (1 - c.a), b: c.b * c.a + f.b * (1 - c.a) }
      const [l1, l2] = [lum(mezcla), lum(f)].sort((a, b) => b - a)
      const ratio = (l1 + 0.05) / (l2 + 0.05)
      // WCAG: grande es desde 24 px, o desde 18.66 px en negrita (18 y 14 puntos).
      const grande = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.66 && Number(cs.fontWeight) >= 700)
      if (ratio < (grande ? 3 : 4.5)) bajos.push(`${ratio.toFixed(2)} «${el.textContent.trim().replace(/\s+/g, ' ').slice(0, 30)}»`)
    }
    return {
      seSale: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tablas: [...main.querySelectorAll('table')].filter(visible).map((t) => t.parentElement.scrollWidth - t.parentElement.clientWidth).filter((s) => s > 1),
      chicas: conTexto.filter((el) => !el.matches('[data-ayuda]') && parseFloat(getComputedStyle(el).fontSize) < 12).map((el) => `«${el.textContent.trim().slice(0, 24)}»`),
      bajos: [...new Set(bajos)],
      rojos: [...main.querySelectorAll('button.border-peligro')]
        .filter((b) => visible(b) && !b.closest('dialog, [role="dialog"]'))
        .map((b) => b.textContent.replace(/\s+/g, ' ').trim() || b.getAttribute('aria-label') || '?'),
    }
  })

try {
  // ---------------------------------------------------------------- 1. El menú de cada puesto
  console.log('\n1. El menú de cada puesto, claro y oscuro')
  for (const puesto of PUESTOS) {
    const rutas = await menuDe(puesto)
    console.log(`\n${puesto}: ${rutas.length} pantallas`)
    const vueltas = [...ANCHOS.map((a) => [a, 'light']), ...OSCURO.map((a) => [a, 'dark'])]
    for (const [ancho, tema] of vueltas) {
      const { pagina, contexto, errores } = await entrar(puesto, ancho, tema)
      const malas = []
      for (const ruta of rutas) {
        errores.length = 0
        const donde = `${ruta} ${ancho}${tema === 'dark' ? ' oscuro' : ''}`
        try {
          await ir(pagina, ruta)
        } catch (e) {
          malas.push(`${donde}: no abrió (${String(e.message).split('\n')[0].slice(0, 80)})`)
          continue
        }
        const m = await medir(pagina)
        const rojos = m.rojos.filter((t) => !ROJOS_PERMITIDOS.test(t))
        const que = [
          m.seSale > 0 && `la página se sale ${m.seSale} px`,
          m.tablas.length && `una tabla se sale ${m.tablas.join(', ')} px`,
          m.chicas.length && `${m.chicas.length} letras de menos de 12 px (${m.chicas.slice(0, 2).join(' ')})`,
          m.bajos.length && `${m.bajos.length} textos con poco contraste (${m.bajos.slice(0, 2).join(' ')})`,
          rojos.length && `${rojos.length} botones con el borde rojo (${[...new Set(rojos)].slice(0, 3).join(', ')})`,
          errores.length && `errores de consola (${errores[0].slice(0, 100)})`,
        ].filter(Boolean)
        if (que.length) malas.push(`${donde}: ${que.join('; ')}`)
      }
      comprobar(malas.length === 0, `${puesto} a ${ancho}${tema === 'dark' ? ' en tema oscuro' : ''}: ${rutas.length} pantallas en orden${malas.length ? `; no: ${malas.join(' | ')}` : ''}`)
      await contexto.close()
    }
  }

  // ---------------------------------------------------------------- 2. Clientes
  console.log('\n2. Clientes con Ventas')
  for (const ancho of [1440, 1024, 768]) {
    const { pagina, contexto } = await entrar('ventas', ancho)
    await ir(pagina, '/clientes')
    const r = await pagina.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().height > 0
      const ths = [...document.querySelectorAll('main thead th')].filter(vis).map((t) => t.textContent.trim())
      const lineas = [...document.querySelectorAll('main [data-ubicacion-en-fila]')]
      const filas = document.querySelectorAll('main tbody > tr').length
      return { ths, filas, vistas: lineas.filter(vis).length, conTexto: lineas.filter((l) => /\d\u00a0(unidad|unidades)/.test(l.textContent)).length }
    })
    if (ancho >= 1280) {
      comprobar(r.ths.includes('Ubicación') && r.ths.includes('Órdenes') && r.vistas === 0, `Clientes ${ancho}: ubicación, unidades y órdenes en su columna (${r.ths.join(' | ')})`)
    } else {
      comprobar(!r.ths.includes('Ubicación') && r.vistas === r.filas && r.conTexto === r.filas && r.filas > 0, `Clientes ${ancho}: ubicación, unidades y órdenes bajo el nombre (${r.vistas} de ${r.filas})`)
    }
    await contexto.close()
  }

  // ---------------------------------------------------------------- 3. Atención de requerimientos
  console.log('\n3. Atención de requerimientos con Logística')
  {
    const { pagina, contexto } = await entrar('logistica', 390)
    await ir(pagina, '/requerimientos/atencion?vista=comprar')
    const r = await pagina.evaluate(() => {
      const vis = (e) => e.getBoundingClientRect().height > 0
      const lineas = [...document.querySelectorAll('main [data-rq-en-telefono]')]
      return {
        lineas: lineas.length,
        vistas: lineas.filter(vis).length,
        conCodigo: lineas.filter((l) => /Código \S+/.test(l.textContent)).length,
        sobra: [...document.querySelectorAll('main table')].filter(vis).map((t) => t.parentElement.scrollWidth - t.parentElement.clientWidth),
      }
    })
    comprobar(r.lineas > 0 && r.vistas === r.lineas && r.conCodigo === r.lineas, `Por comprar a 390: cada insumo dice su RQ y su código debajo (${r.vistas} de ${r.lineas})`)
    comprobar(r.sobra.every((s) => s <= 1), `Por comprar a 390: ninguna tabla se sale (${r.sobra.join(', ')})`)
    await contexto.close()
  }
  for (const ancho of [1024, 768]) {
    const { pagina, contexto } = await entrar('logistica', ancho)
    await ir(pagina, '/requerimientos/atencion')
    const r = await pagina.evaluate(() => {
      const t = [...document.querySelectorAll('main table')].find((x) => x.getBoundingClientRect().width > 0)
      const ths = [...t.querySelectorAll('thead th')]
      const ancho = (i) => Math.round(ths[i].getBoundingClientRect().width)
      return { insumos: ancho(1), acciones: ancho(ths.length - 1), sobra: t.parentElement.scrollWidth - t.parentElement.clientWidth }
    })
    comprobar(r.insumos > r.acciones && r.sobra <= 0, `Atención ${ancho}: los insumos tienen más ancho que los botones (${r.insumos} contra ${r.acciones}) y la tabla cabe`)
    await contexto.close()
  }

  // ---------------------------------------------------------------- 4. Vacíos con el componente común
  console.log('\n4. Vacíos con el componente común')
  {
    const { pagina, contexto } = await entrar('rrhh', 1440)
    await ir(pagina, '/rrhh/costeo')
    const r = await pagina.evaluate(() => {
      const vacios = [...document.querySelectorAll('main [data-recargo-extras] [data-sin-datos]')]
      const recargos = document.querySelectorAll('main [data-recargo]').length
      return { vacios: vacios.length, recargos }
    })
    comprobar(r.recargos > 0 ? r.vacios === 0 : r.vacios === 1, `Costeo: el recargo de las horas extras, o su vacío común (${r.recargos} códigos, ${r.vacios} vacíos)`)
    await contexto.close()
  }
} finally {
  await navegador.close()
}

console.log(fallas.length === 0 ? '\nTodo en orden.' : `\n${fallas.length} fallas.`)
process.exit(fallas.length === 0 ? 0 : 1)
