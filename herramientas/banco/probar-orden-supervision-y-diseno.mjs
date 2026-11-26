/**
 * Entrega 5 del plan de orden y diseño (2026-11-26): las pantallas de
 * Supervisión y de Diseño. Los avisos que se repetían en cada fila pasan a un
 * filtro con su cuenta o a una línea en letra suave, y los botones de cada
 * fila van en un renglón.
 *
 *   1. Materiales, con la cuenta de Diseño: «Corregir» y «Retirar» en un
 *      renglón a 1440, 1024, 768 y 390 («Retirar» al final y sin borde); a 390
 *      cada material es una ficha; «confirmar unidad» ya no va en una insignia
 *      ámbar por fila sino en el filtro «Unidad por confirmar (N)», con la
 *      cuenta de la base, que deja solo esos. «Corregir» abre su ventana con
 *      la casilla de confirmar la unidad; «Retirar» y «Devolver» escriben en
 *      la base (y el material vuelve a quedar como estaba). Gerencia, que solo
 *      consulta, lee «unidad por confirmar» y no recibe columna de acciones.
 *   2. Unidades, con la de Diseño: «Editar» y «Desactivar» en un renglón; a
 *      390 la ficha lleva el cliente, el vehículo y el detalle; a 1024 el
 *      detalle va bajo la unidad; «Editar» abre su ventana; «Desactivar» y
 *      «Reactivar» escriben en la base.
 *   3. Órdenes de trabajo a 1024 y 768: la tabla no se sale de su tarjeta y lo
 *      de la columna «Trabajo» va bajo el cliente; a 700, las fichas.
 *   4. Carrocerías con un código de 40 letras sin espacios (sembrado y borrado
 *      al terminar): a 768, 1024 y 390 nada se sale por el costado.
 *   5. Códigos internos, con la de Gerencia: el código sin nada de Diseño lo
 *      dice en una línea, con los cinco puntos nombrados, y no en cinco
 *      casillas; el filtro «Sin planos, materiales ni etapas de Diseño (N)»
 *      deja solo esos. Lo mismo en la lista de Planos de Diseño.
 *   6. La escala de separaciones: 20 px entre los filtros y la lista en
 *      Códigos internos, Planos de Diseño y Reporte diario; 12 px entre las
 *      fichas de la lista de Diseño. El vacío de la lista de Diseño es el
 *      `SinDatos` de siempre.
 *   7. En ninguna, errores en la consola ni letra de menos de 12 px.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE,
 * BANCO_CHROMIUM.
 */
import { existsSync } from 'node:fs'

import pg from 'pg'
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

const base = new pg.Client({
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.BANCO_BASE ?? 'mw_demo',
})
await base.connect()
const uno = async (sql, valores = []) => (await base.query(sql, valores)).rows[0]

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

const VISTAS = {
  1440: { width: 1440, height: 900 },
  1024: { width: 1024, height: 768 },
  768: { width: 768, height: 1024 },
  700: { width: 700, height: 1000 },
  390: { width: 390, height: 844 },
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(puesto, ancho) {
  const viewport = VISTAS[ancho]
  const movil = viewport.width < 500
  const contexto = await navegador.newContext({ viewport, isMobile: movil, hasTouch: movil, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
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
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
  await pagina.waitForSelector('main h1')
}

/** La tabla principal: cada fila con sus botones y en cuántos renglones caen, y lo que se sale. */
const leerTabla = (pagina) =>
  pagina.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
    }
    const tabla = [...document.querySelectorAll('main table')].find(visible)
    const filas = [...(tabla?.querySelectorAll('tbody > tr') ?? [])].map((tr) => {
      const acciones = tr.querySelector('[data-acciones-fila]')
      const mandos = acciones ? [...acciones.querySelectorAll('button, a')].filter(visible) : []
      const centros = mandos
        .map((m) => {
          const r = m.getBoundingClientRect()
          return r.top + r.height / 2
        })
        .sort((a, b) => a - b)
      const ultimo = mandos.at(-1)
      return {
        texto: tr.innerText.slice(0, 40).replace(/\s+/g, ' '),
        mandos: mandos.map((m) => m.textContent.replace(/\s+/g, ' ').trim()),
        renglones: centros.filter((c, i, l) => i === 0 || c - l[i - 1] > 8).length,
        ultimoSinBorde: ultimo
          ? ['0px', ''].includes(getComputedStyle(ultimo).borderTopWidth) || /rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(ultimo).borderTopColor)
          : true,
        alto: Math.round(tr.getBoundingClientRect().height),
      }
    })
    const caja = tabla?.parentElement
    const chicas = [...document.querySelectorAll('main *')].filter((el) => {
      if (el.matches('[data-ayuda]')) return false // el glifo «i» de la ayuda, no texto que se lee
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false
      return parseFloat(getComputedStyle(el).fontSize) < 12 && visible(el)
    })
    return {
      hay: Boolean(tabla),
      apilada: tabla ? getComputedStyle(tabla).display === 'block' : false,
      cabecera: tabla?.querySelector('thead') ? visible(tabla.querySelector('thead')) : false,
      filas,
      sobraTabla: caja ? caja.scrollWidth - caja.clientWidth : 0,
      seSale: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      chicas: chicas.length,
    }
  })

/** Lo común a toda pantalla de la entrega, en un ancho. */
function comprobarCaja(t, errores, donde) {
  comprobar(t.seSale <= 0, `${donde}: nada se sale por el costado de la página (${t.seSale})`)
  comprobar(t.sobraTabla <= 0, `${donde}: la tabla no se sale de su tarjeta (${t.sobraTabla})`)
  comprobar(t.chicas === 0, `${donde}: ninguna letra de menos de 12 px (${t.chicas})`)
  comprobar(errores.length === 0, `${donde}: sin errores de consola${errores.length ? ` (${errores[0]})` : ''}`)
  errores.length = 0
}

const CODIGO_LARGO = 'QACODIGOLARGODECUARENTALETRASSINESPACIOS'
const NOMBRE_LARGO = 'QA carrocería de código largo (entrega 5)'

try {
  // ---------------------------------------------------------------- 1. Materiales
  console.log('\n1. Materiales')
  const { n: pendientes } = await uno('select count(*)::int n from materiales where activo and unidad_pendiente')
  for (const ancho of [1440, 1024, 768, 390]) {
    const { pagina, contexto, errores } = await entrar('diseno', ancho)
    await ir(pagina, '/materiales')
    const t = await leerTabla(pagina)
    const conMandos = t.filas.filter((f) => f.mandos.length >= 2)
    comprobar(conMandos.length > 0 && conMandos.every((f) => f.renglones === 1), `Materiales ${ancho}: «Corregir» y «Retirar» en un renglón (el peor, ${Math.max(0, ...conMandos.map((f) => f.renglones))})`)
    comprobar(conMandos.every((f) => f.mandos[0] === 'Corregir' && f.mandos.at(-1) === 'Retirar' && f.ultimoSinBorde), `Materiales ${ancho}: «Corregir» primero y «Retirar» al final, sin borde`)
    comprobar(ancho < 768 ? t.apilada && !t.cabecera : !t.apilada && t.cabecera, `Materiales ${ancho}: ${ancho < 768 ? 'cada material es una ficha, sin cabecera' : 'tabla con su cabecera'}`)
    comprobarCaja(t, errores, `Materiales ${ancho}`)
    if (ancho === 1440 || ancho === 390) {
      // El aviso ya no va en una insignia ámbar por fila.
      const ambar = await pagina.locator('main tbody').getByText(/^Confirmar unidad$/).count()
      comprobar(ambar === 0, `Materiales ${ancho}: ninguna fila lleva la insignia «Confirmar unidad»`)
      const pastilla = pagina.getByRole('link', { name: `Unidad por confirmar (${pendientes})` })
      comprobar((await pastilla.count()) === 1, `Materiales ${ancho}: el filtro dice «Unidad por confirmar (${pendientes})», la cuenta de la base`)
      if (pendientes > 0) {
        await Promise.all([pagina.waitForURL(/ver=unidad/), pastilla.click()])
        await pagina.waitForLoadState('networkidle')
        const filas = await pagina.locator('main tbody > tr').count()
        const marcadas = await pagina.locator('main tbody > tr').filter({ has: pagina.locator('[data-unidad-por-confirmar]') }).count()
        comprobar(filas > 0 && filas === marcadas, `Materiales ${ancho}: el filtro deja solo los que esperan su unidad (${marcadas} de ${filas})`)
        const dice = await pagina.locator('main tbody > tr').first().locator('[data-unidad-por-confirmar]').evaluateAll((es) => es.filter((e) => e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim()))
        comprobar(dice.length === 1 && dice[0].includes('confirmar unidad'), `Materiales ${ancho}: la fila lo dice una vez, a quien puede confirmarla («${dice.join('|')}»)`)
        // «Corregir» abre su ventana, con la casilla de confirmar la unidad. No se envía.
        await pagina.locator('main tbody > tr').first().getByRole('button', { name: /^Corregir / }).click()
        const ventana = pagina.locator('[role="dialog"]').first()
        await ventana.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
        comprobar((await ventana.locator('input[name="confirmar_unidad"]').count()) === 1, `Materiales ${ancho}: «Corregir» abre la ventana con la casilla de confirmar la unidad`)
        await ventana.getByRole('button', { name: 'Cancelar' }).click()
      }
    }
    if (ancho === 390) {
      // «Retirar» y «Devolver» con clic real, y el material vuelve a quedar en uso.
      await ir(pagina, '/materiales')
      const fila = pagina.locator('main tbody > tr').first()
      const nombre = ((await fila.locator('td').first().locator('p').first().textContent()) ?? '').trim()
      const material = await uno('select id from materiales where descripcion = $1 and activo order by codigo limit 1', [nombre])
      try {
        await fila.getByRole('button', { name: /^Retirar / }).click()
        await pagina.waitForFunction((n) => ![...document.querySelectorAll('main tbody > tr')].some((tr) => tr.querySelector('p')?.textContent.trim() === n), nombre, { timeout: 20000 }).catch(() => {})
        comprobar((await uno('select activo from materiales where id = $1', [material.id])).activo === false, `«Retirar» deja el material fuera de uso en la base (${nombre})`)
        await ir(pagina, `/materiales?todos=1&buscar=${encodeURIComponent(nombre)}`)
        const retirado = pagina.locator('main tbody > tr').filter({ hasText: 'retirado' }).first()
        comprobar((await retirado.count()) === 1, 'el retirado sale en «También los retirados», con su marca')
        await retirado.getByRole('button', { name: /^Devolver / }).click()
        await pagina.waitForFunction(() => !document.querySelector('main tbody > tr button[aria-label^="Devolver"]'), null, { timeout: 20000 }).catch(() => {})
        comprobar((await uno('select activo from materiales where id = $1', [material.id])).activo === true, '«Devolver» lo deja otra vez en uso en la base')
      } finally {
        await base.query('update materiales set activo = true where id = $1', [material.id])
      }
      comprobar(errores.length === 0, `Materiales ${ancho}: sin errores de consola al retirar y devolver${errores.length ? ` (${errores[0]})` : ''}`)
    }
    await contexto.close()
  }
  {
    const { pagina, contexto, errores } = await entrar('gerencia', 1440)
    await ir(pagina, '/materiales?ver=unidad')
    const t = await leerTabla(pagina)
    comprobar(t.filas.every((f) => f.mandos.length === 0) && (await pagina.locator('main thead th', { hasText: 'Acciones' }).count()) === 0, 'Gerencia consulta Materiales sin botones ni columna de acciones')
    const dice = pendientes > 0 ? ((await pagina.locator('main tbody > tr').first().locator('[data-unidad-por-confirmar]').last().textContent()) ?? '') : 'unidad por confirmar'
    comprobar(dice.includes('unidad por confirmar'), `a quien solo consulta le dice «unidad por confirmar», no la orden («${dice.trim()}»)`)
    comprobarCaja(t, errores, 'Materiales (Gerencia) 1440')
    await contexto.close()
  }

  // ---------------------------------------------------------------- 2. Unidades
  console.log('\n2. Unidades')
  for (const ancho of [1440, 1024, 768, 390]) {
    const { pagina, contexto, errores } = await entrar('diseno', ancho)
    await ir(pagina, '/unidades')
    const t = await leerTabla(pagina)
    const conDos = t.filas.filter((f) => f.mandos.length >= 2)
    comprobar(conDos.length > 0 && conDos.every((f) => f.renglones === 1), `Unidades ${ancho}: «Editar» y «Desactivar» en un renglón (el peor, ${Math.max(0, ...conDos.map((f) => f.renglones))})`)
    comprobar(conDos.every((f) => f.mandos[0] === 'Editar' && f.mandos.at(-1) === 'Desactivar' && f.ultimoSinBorde), `Unidades ${ancho}: «Editar» primero y «Desactivar» al final, sin borde`)
    comprobar(ancho < 768 ? t.apilada && !t.cabecera : !t.apilada && t.cabecera, `Unidades ${ancho}: ${ancho < 768 ? 'cada unidad es una ficha, sin cabecera' : 'tabla con su cabecera'}`)
    comprobarCaja(t, errores, `Unidades ${ancho}`)
    const detalle = await pagina.locator('main tbody [data-detalle-unidad]').evaluateAll((es) => es.filter((e) => e.getBoundingClientRect().width > 0).length)
    comprobar(ancho >= 1280 ? detalle === 0 : detalle > 0, `Unidades ${ancho}: el tipo, la carrocería y la capacidad ${ancho >= 1280 ? 'van en sus columnas' : 'van bajo la unidad'} (${detalle})`)
    if (ancho === 390) {
      const fila = pagina.locator('main tbody > tr').filter({ has: pagina.getByRole('button', { name: 'Editar' }) }).first()
      const unidad = await fila.locator('a[href^="/unidades/"]').first().getAttribute('href')
      const id = unidad.split('/').pop()
      const enBase = await uno('select u.marca, c.razon_social from unidades u left join clientes c on c.id = u.cliente_id where u.id = $1', [id])
      const texto = await fila.innerText()
      comprobar(texto.includes(enBase.razon_social) && (!enBase.marca || texto.includes(enBase.marca)), `Unidades 390: la ficha lleva el cliente y el vehículo (${enBase.razon_social})`)
      await fila.getByRole('button', { name: 'Editar' }).click()
      const ventana = pagina.locator('[role="dialog"]').first()
      await ventana.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
      comprobar(await ventana.isVisible(), 'Unidades 390: «Editar» abre su ventana')
      await pagina.keyboard.press('Escape')
      await ventana.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
      // «Desactivar» y «Reactivar» con clic real; la unidad vuelve a quedar activa.
      try {
        await fila.getByRole('button', { name: 'Desactivar' }).click()
        await pagina.waitForFunction((u) => !document.querySelector(`main tbody a[href="/unidades/${u}"]`), id, { timeout: 20000 }).catch(() => {})
        comprobar((await uno('select activo from unidades where id = $1', [id])).activo === false, '«Desactivar» deja la unidad inactiva en la base')
        await ir(pagina, '/unidades?estado=inactivas')
        const inactiva = pagina.locator('main tbody > tr').filter({ has: pagina.locator(`a[href="/unidades/${id}"]`) }).first()
        comprobar((await inactiva.getByText('Inactiva', { exact: true }).count()) === 1, 'la desactivada lo dice junto a su nombre («Inactiva»)')
        await inactiva.getByRole('button', { name: 'Reactivar' }).click()
        await inactiva.getByRole('button', { name: 'Desactivar' }).waitFor({ timeout: 20000 }).catch(() => {})
        comprobar((await uno('select activo from unidades where id = $1', [id])).activo === true, '«Reactivar» la deja activa otra vez en la base')
      } finally {
        await base.query('update unidades set activo = true where id = $1', [id])
      }
      comprobar(errores.length === 0, `Unidades 390: sin errores de consola al desactivar y reactivar${errores.length ? ` (${errores[0]})` : ''}`)
    }
    await contexto.close()
  }

  // ---------------------------------------------------------------- 3. Órdenes de trabajo
  console.log('\n3. Órdenes de trabajo')
  for (const ancho of [1440, 1024, 768, 700]) {
    const { pagina, contexto, errores } = await entrar('diseno', ancho)
    await ir(pagina, '/ordenes')
    const t = await leerTabla(pagina)
    const enFila = await pagina.locator('main tbody [data-trabajo-en-fila]').evaluateAll((es) => es.filter((e) => e.getBoundingClientRect().width > 0).length)
    const fichas = await pagina.locator('main ul > li > a[href^="/ordenes/"]').evaluateAll((es) => es.filter((e) => e.getBoundingClientRect().width > 0).length)
    if (ancho === 700) {
      comprobar(!t.hay && fichas > 0, `Órdenes ${ancho}: una ficha por orden, sin la tabla (${fichas})`)
    } else {
      comprobar(t.hay && fichas === 0 && t.filas.length > 0, `Órdenes ${ancho}: la tabla, con ${t.filas.length} órdenes`)
      comprobar(ancho >= 1280 ? enFila === 0 : enFila === t.filas.length, `Órdenes ${ancho}: el trabajo ${ancho >= 1280 ? 'va en su columna' : 'va bajo el cliente'} (${enFila})`)
    }
    comprobarCaja(t, errores, `Órdenes ${ancho}`)
    await contexto.close()
  }

  // ---------------------------------------------------------------- 4. Carrocerías, con un código de 40 letras
  console.log('\n4. Carrocerías')
  await base.query('delete from tipos_carroceria where nombre = $1', [NOMBRE_LARGO])
  await base.query('insert into tipos_carroceria (codigo, nombre, orden_secuencia) values ($1, $2, 999)', [CODIGO_LARGO, NOMBRE_LARGO])
  try {
    for (const ancho of [1024, 768, 390]) {
      const { pagina, contexto, errores } = await entrar('diseno', ancho)
      await ir(pagina, '/carrocerias')
      const t = await leerTabla(pagina)
      const codigo = pagina.locator('main tbody [data-codigo-carroceria]', { hasText: CODIGO_LARGO })
      const cabe = await codigo.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const celda = el.closest('td').getBoundingClientRect()
        return r.width > 0 && r.right <= celda.right + 1 && r.left >= celda.left - 1
      })
      comprobar(cabe, `Carrocerías ${ancho}: el código de ${CODIGO_LARGO.length} letras cabe en su celda`)
      const conTres = t.filas.filter((f) => f.mandos.length >= 2)
      comprobar(conTres.every((f) => f.renglones === 1), `Carrocerías ${ancho}: los botones siguen en un renglón (el peor, ${Math.max(0, ...conTres.map((f) => f.renglones))})`)
      comprobarCaja(t, errores, `Carrocerías ${ancho}`)
      await contexto.close()
    }
  } finally {
    await base.query('delete from tipos_carroceria where nombre = $1', [NOMBRE_LARGO])
  }

  // ---------------------------------------------------------------- 5 y 6. Códigos internos y las listas de Diseño
  console.log('\n5. Códigos internos y Planos de Diseño')
  const leerLineas = (pagina) =>
    pagina.evaluate(() =>
      [...document.querySelectorAll('main [data-lo-que-debe-diseno]')].map((e) => ({
        sinNada: e.hasAttribute('data-sin-nada'),
        puntos: [...e.querySelectorAll('[data-punto]')].map((p) => ({ clave: p.dataset.punto, hecho: p.dataset.hecho === 'true' })),
        insignias: e.querySelectorAll('[data-punto] > span').length,
        texto: e.querySelector('ul')?.innerText.replace(/\s+/g, ' ').trim() ?? '',
        alto: Math.round(e.getBoundingClientRect().height),
      })),
    )
  /** Lo que separa el bloque de buscador y filtros de lo que sigue. */
  const separacion = (pagina, selectorLista) =>
    pagina.evaluate((sel) => {
      const lista = document.querySelector(sel)
      const antes = lista?.previousElementSibling
      if (!lista || !antes) return null
      return Math.round(lista.getBoundingClientRect().top - antes.getBoundingClientRect().bottom)
    }, selectorLista)

  for (const ancho of [1440, 390]) {
    const { pagina, contexto, errores } = await entrar('gerencia', ancho)
    await ir(pagina, '/codigos-internos')
    const lineas = await leerLineas(pagina)
    const vacias = lineas.filter((l) => l.puntos.length === 5 && l.puntos.every((p) => !p.hecho))
    comprobar(vacias.length > 0 && vacias.every((l) => l.sinNada && l.insignias === 0), `Códigos internos ${ancho}: el código sin nada de Diseño lo dice en una línea, sin casillas (${vacias.length})`)
    comprobar(vacias.every((l) => /Diseño todavía no carga: ficha técnica, planos, materiales, etapas, DXF\./.test(l.texto)), `Códigos internos ${ancho}: la línea nombra los cinco puntos («${vacias[0]?.texto}»)`)
    comprobar(lineas.filter((l) => l.puntos.some((p) => p.hecho)).every((l) => !l.sinNada && l.puntos.length === 5), `Códigos internos ${ancho}: el que tiene algo cargado conserva sus cinco casillas`)
    comprobar((await separacion(pagina, 'main ul:has(> li > a[data-codigo])')) === 20, `Códigos internos ${ancho}: 20 px entre los filtros y la lista`)
    const t = await leerTabla(pagina)
    comprobarCaja(t, errores, `Códigos internos ${ancho}`)
    if (ancho === 1440) {
      const pastilla = pagina.getByRole('link', { name: /^Sin planos, materiales ni etapas de Diseño \(\d+\)$/ })
      comprobar((await pastilla.count()) === 1, 'Códigos internos: el filtro «Sin planos, materiales ni etapas de Diseño (N)» está')
      const cuenta = Number(((await pastilla.textContent()) ?? '').match(/\((\d+)\)/)?.[1] ?? -1)
      await Promise.all([pagina.waitForURL(/ver=sin-diseno/), pastilla.click()])
      await pagina.waitForLoadState('networkidle')
      const filtradas = await leerLineas(pagina)
      const filas = await pagina.locator('main a[data-codigo]').count()
      comprobar(filas > 0 && filtradas.length === filas, `el filtro deja códigos de unidad, cada uno con lo que Diseño entrega (${filtradas.length} de ${filas})`)
      comprobar(filtradas.every((l) => l.puntos.filter((p) => ['planos', 'materiales', 'etapas'].includes(p.clave)).every((p) => !p.hecho)), 'ninguno de los filtrados tiene planos, materiales ni etapas')
      const total = Number(((await pagina.locator('main p', { hasText: /^\d[\d,]* códigos? ·/ }).first().textContent()) ?? '').match(/^([\d,]+)/)?.[1].replace(/,/g, '') ?? -2)
      comprobar(total === cuenta, `la cuenta del filtro (${cuenta}) es la de la lista filtrada (${total})`)
      comprobar(errores.length === 0, `Códigos internos, filtrado: sin errores de consola${errores.length ? ` (${errores[0]})` : ''}`)
    }
    await contexto.close()
  }
  for (const ancho of [1440, 390]) {
    const { pagina, contexto, errores } = await entrar('diseno', ancho)
    await ir(pagina, '/diseno/planos')
    const lineas = await leerLineas(pagina)
    const vacias = lineas.filter((l) => l.puntos.length === 5 && l.puntos.every((p) => !p.hecho))
    comprobar(vacias.length > 0 && vacias.every((l) => l.sinNada && l.insignias === 0), `Planos de Diseño ${ancho}: el código sin nada lo dice en una línea, sin casillas (${vacias.length})`)
    comprobar((await separacion(pagina, 'main ul:has(> li [data-codigo])')) === 20, `Planos de Diseño ${ancho}: 20 px entre los filtros y la lista`)
    const entreFichas = await pagina.evaluate(() => {
      const [a, b] = document.querySelectorAll('main ul:has(> li [data-codigo]) > li')
      return a && b ? Math.round(b.getBoundingClientRect().top - a.getBoundingClientRect().bottom) : null
    })
    comprobar(entreFichas === 12, `Planos de Diseño ${ancho}: 12 px entre las fichas de la lista (${entreFichas})`)
    comprobarCaja(await leerTabla(pagina), errores, `Planos de Diseño ${ancho}`)
    await ir(pagina, '/diseno/planos?q=zzzzqqqq')
    const vacio = await pagina.evaluate(() => {
      const p = [...document.querySelectorAll('main p')].find((e) => e.textContent.trim() === 'Ningún código con esta búsqueda o filtro')
      return p ? getComputedStyle(p.parentElement).textAlign : null
    })
    comprobar(vacio === 'center', `Planos de Diseño ${ancho}: sin resultados, el vacío de siempre, centrado (${vacio})`)
    await contexto.close()
  }
  {
    const { pagina, contexto, errores } = await entrar('gerencia', 1440)
    await ir(pagina, '/reportes-diarios')
    const hayLista = (await pagina.locator('main ul:has(> li > a[data-reporte])').count()) > 0
    if (hayLista) comprobar((await separacion(pagina, 'main ul:has(> li > a[data-reporte])')) === 20, 'Reporte diario: 20 px entre los filtros y la lista')
    else console.log('  — Reporte diario sin reportes este mes: no se mide la separación')
    comprobarCaja(await leerTabla(pagina), errores, 'Reporte diario 1440')
    await contexto.close()
  }
} finally {
  await navegador.close()
  await base.end()
}

console.log(fallas.length === 0 ? '\nTodo en orden.' : `\n${fallas.length} fallas.`)
process.exit(fallas.length === 0 ? 0 : 1)
