/**
 * Entrega 6 del plan de orden y diseño (2026-11-26): las pantallas de
 * Tesorería, Contabilidad y Gerencia. Ninguna tabla se sale de su tarjeta
 * entre 768 y 1439 px, y lo que no cabe en una columna baja a una ficha o a la
 * celda vecina, con su rótulo. No se quita ningún dato ni botón.
 *
 *   1. Adquisiciones › OC y OS, con Contabilidad, Tesorería, Gerencia y Logística: de
 *      1280 px en adelante, la tabla, sin salirse (a 1280 y 1366 «De dónde
 *      sale» va bajo la orden; desde 1440 tiene su columna); por debajo, una ficha
 *      por orden con sus cuatro partes rotuladas («De dónde sale», «En qué
 *      va», «Documentos», «Pago»). Las fichas son las mismas órdenes que las
 *      filas.
 *   2. Adquisiciones › Facturas, con Contabilidad: a 1720 las ocho columnas; a
 *      1280, 1366, 1440 y 1536 la fecha va bajo la factura y el código interno bajo
 *      su OC, y la tabla no se sale; por debajo, una ficha por factura con
 *      «OC, RQ y código» (cada OC con su total) y «Pago» rotulados. La fecha
 *      que se lee es la de la base. También con Tesorería y Gerencia, que consultan.
 *   3. Caja diaria, con Tesorería (1440, 1366, 1280, 1024, 768, 700 y 390) y
 *      Gerencia (1440, 1024 y 390), la de hoy y la del último día con el saldo
 *      del banco capturado y la del último con una diferencia: nada se sale; hasta 1399 px lo del banco va bajo el
 *      saldo final de cada cuenta (su monto o «Sin captura del banco», y la
 *      diferencia o «Cuadra con el banco»), también en el teléfono; de 1400 en
 *      adelante tiene sus columnas.
 *   4. Aprobación de compras, con Gerencia: nada se sale a 1440, 1024, 768 y
 *      390 (a 390 se salían dos listas); en el teléfono cada decidida dice
 *      quién y cuándo, y cada insumo su precio unitario; «Anular» va en su
 *      renglón de acciones, sin borde, y abre su ventana con el motivo.
 *   5. Órdenes de servicio, con Contabilidad («PDF» y «Detracción») y con
 *      Tesorería («PDF» y «Adjuntar documento») a 1440, 1280, 1024 y 768: en
 *      un renglón.
 *   6. La escala de separaciones: 20 px bajo los filtros de Cotización,
 *      Recibos por honorarios y Trabajos, y entre los bloques de Gastos del mes.
 *   7. Las demás pantallas de la entrega, con la cuenta de su puesto y a 1440,
 *      1024 y 390: nada se sale, ninguna letra de menos de 12 px y sin errores
 *      de consola.
 *
 * En todas las pantallas y anchos, además: ningún botón de la pantalla con el
 * borde rojo (decisión 6; «Rechazar» de Aprobación es una decisión y lo
 * conserva).
 *
 * Solo consulta: abre una ventana y la cierra, no escribe en la base.
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

const ALTOS = { 1720: 968, 1536: 864, 1440: 900, 1366: 768, 1280: 800, 1024: 768, 768: 1024, 700: 1000, 390: 844 }

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(puesto, ancho) {
  const viewport = { width: ancho, height: ALTOS[ancho] }
  const movil = ancho < 500
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

/** Lo que se sale: de la página y de la tarjeta de cada tabla a la vista; y la letra de menos de 12 px. */
const medir = (pagina) =>
  pagina.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
    }
    const tablas = [...document.querySelectorAll('main table')].filter(visible)
    const chicas = [...document.querySelectorAll('main *')].filter((el) => {
      if (el.matches('[data-ayuda]')) return false // el glifo «i» de la ayuda, no texto que se lee
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return false
      return parseFloat(getComputedStyle(el).fontSize) < 12 && visible(el)
    })
    return {
      tablas: tablas.length,
      sobraTabla: Math.max(0, ...tablas.map((t) => t.parentElement.scrollWidth - t.parentElement.clientWidth)),
      seSale: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      chicas: chicas.length,
    }
  })

/** Lo común a toda pantalla de la entrega, en un ancho. */
async function comprobarCaja(pagina, errores, donde) {
  const t = await medir(pagina)
  comprobar(t.seSale <= 0, `${donde}: nada se sale por el costado de la página (${t.seSale})`)
  comprobar(t.sobraTabla <= 0, `${donde}: ninguna tabla se sale de su tarjeta (${t.sobraTabla}, ${t.tablas} a la vista)`)
  comprobar(t.chicas === 0, `${donde}: ninguna letra de menos de 12 px (${t.chicas})`)
  // Decisión 6: anular, quitar y deshacer van al final y sin borde; el rojo queda para la ventana.
  const rojos = await pagina.locator('main button.border-peligro').evaluateAll((bs) =>
    bs.filter((b) => b.getBoundingClientRect().width > 0 && !b.closest('dialog, [role="dialog"]')).map((b) => b.textContent.replace(/\s+/g, ' ').trim()),
  )
  // «Rechazar» de Aprobación es la decisión de Gerencia, no un anular de una vez: conserva su borde.
  const deUnaVez = rojos.filter((t) => !/^Rechazar/.test(t))
  comprobar(deUnaVez.length === 0, `${donde}: ningún botón de la pantalla lleva el borde rojo (${deUnaVez.length}${deUnaVez.length ? `: ${[...new Set(deUnaVez)].join(', ')}` : ''})`)
  comprobar(errores.length === 0, `${donde}: sin errores de consola${errores.length ? ` (${errores[0]})` : ''}`)
  errores.length = 0
}

/** Cuántos de los que casan con el selector están a la vista. */
const aLaVista = (pagina, selector) =>
  pagina.locator(selector).evaluateAll((es) => es.filter((e) => e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0).length)

/** Las cabeceras a la vista de la primera tabla visible. */
const cabeceras = (pagina) =>
  pagina.evaluate(() => {
    const visible = (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
    const tabla = [...document.querySelectorAll('main table')].find(visible)
    return tabla ? [...tabla.querySelectorAll('thead th')].filter(visible).map((th) => th.textContent.replace(/\s+/g, ' ').trim()) : []
  })

/** El margen de abajo del grupo que lleva esa etiqueta (él o quien lo envuelve), en px. */
const margenBajo = (pagina, selector) =>
  pagina.evaluate((sel) => {
    let el = [...document.querySelectorAll(sel)].find((e) => e.getBoundingClientRect().width > 0)
    let mayor = null
    for (let i = 0; el && i < 3 && !el.matches('main'); i++, el = el.parentElement) {
      mayor = Math.max(mayor ?? 0, parseFloat(getComputedStyle(el).marginBottom) || 0)
    }
    return mayor
  }, selector)

const PARTES_DE_LA_ORDEN = ['De dónde sale', 'En qué va', 'Documentos', 'Pago']

try {
  // ---------------------------------------------------------------- 1. Adquisiciones › OC y OS
  console.log('\n1. Adquisiciones › OC y OS')
  const VISITAS_OC = [
    ['contabilidad', [1440, 1366, 1280, 1024, 768, 390]],
    ['tesoreria', [1280, 1024, 390]],
    ['gerencia', [1024]],
    ['logistica', [1280, 390]],
  ]
  for (const [puesto, anchos] of VISITAS_OC) {
    for (const ancho of anchos) {
      const { pagina, contexto, errores } = await entrar(puesto, ancho)
      await ir(pagina, '/adquisiciones')
      const donde = `OC y OS (${puesto}) ${ancho}`
      const filas = await pagina.locator('main tr[data-orden]').count()
      const fichas = await pagina.locator('main li[data-orden-telefono]').count()
      const filasVistas = await aLaVista(pagina, 'main tr[data-orden]')
      const fichasVistas = await aLaVista(pagina, 'main li[data-orden-telefono]')
      comprobar(filas > 0 && filas === fichas, `${donde}: las fichas son las mismas órdenes que las filas (${fichas} y ${filas})`)
      if (ancho >= 1280) {
        comprobar(filasVistas === filas && fichasVistas === 0, `${donde}: se ve la tabla y no las fichas (${filasVistas} filas, ${fichasVistas} fichas)`)
        const ths = await cabeceras(pagina)
        const enFila = await aLaVista(pagina, 'main [data-origen-en-fila]')
        if (ancho >= 1440) {
          comprobar(ths.includes('De dónde sale') && enFila === 0, `${donde}: «De dónde sale» tiene su columna (${ths.join(' | ')})`)
        } else {
          comprobar(!ths.includes('De dónde sale') && enFila === filas, `${donde}: «De dónde sale» va bajo la orden en cada fila (${enFila} de ${filas})`)
        }
      } else {
        comprobar(fichasVistas === fichas && filasVistas === 0, `${donde}: se ven las fichas y no la tabla (${fichasVistas} fichas, ${filasVistas} filas)`)
        const partes = await pagina.locator('main li[data-orden-telefono]').evaluateAll((lis) =>
          lis.map((li) =>
            [...li.querySelectorAll('[data-parte] > dt')].filter((dt) => dt.getBoundingClientRect().height > 0).map((dt) => dt.textContent.trim()),
          ),
        )
        comprobar(
          partes.every((p) => PARTES_DE_LA_ORDEN.every((nombre) => p.includes(nombre))),
          `${donde}: cada ficha rotula sus cuatro partes (${partes[0]?.join(' | ')})`,
        )
        // La ficha dice lo mismo que la fila: su número, su proveedor y su total.
        const comparadas = await pagina.evaluate(() => {
          const limpio = (t) => t.replace(/\s+/g, ' ').trim()
          // Por su lugar en la lista y no por su nombre: varias de antes de la serie se llaman «OC sin número».
          const filas = [...document.querySelectorAll('main tr[data-orden]')]
          return [...document.querySelectorAll('main li[data-orden-telefono]')].map((li, i) => {
            const nombre = li.getAttribute('data-orden-telefono')
            const tr = filas[i]?.getAttribute('data-orden') === nombre ? filas[i] : null
            const total = tr ? limpio([...tr.children].find((td) => /\d\.\d\d/.test(td.textContent) && /S\/|US\$/.test(td.textContent))?.textContent ?? '') : ''
            const montos = total.match(/(S\/|US\$)\s?[\d,]+\.\d\d/g) ?? []
            return { nombre, tiene: Boolean(tr), monto: montos[0] ?? null, enFicha: montos[0] ? limpio(li.innerText).includes(montos[0]) : true }
          })
        })
        comprobar(
          comparadas.length > 0 && comparadas.every((c) => c.tiene && c.enFicha),
          `${donde}: cada ficha lleva el total de su fila (${comparadas.filter((c) => !c.enFicha).map((c) => c.nombre).join(', ') || 'todas'})`,
        )
      }
      await comprobarCaja(pagina, errores, donde)
      await contexto.close()
    }
  }

  // ---------------------------------------------------------------- 2. Adquisiciones › Facturas
  console.log('\n2. Adquisiciones › Facturas')
  for (const [puesto, ancho] of [
    ...[1720, 1536, 1440, 1366, 1280, 1024, 768, 390].map((a) => ['contabilidad', a]),
    ['tesoreria', 1280],
    ['tesoreria', 390],
    ['gerencia', 1366],
    ['gerencia', 1024],
  ]) {
    const { pagina, contexto, errores } = await entrar(puesto, ancho)
    await ir(pagina, '/adquisiciones?vista=facturas')
    const donde = `Facturas (${puesto}) ${ancho}`
    const fichas = await pagina.locator('main li[data-factura-telefono]').count()
    const fichasVistas = await aLaVista(pagina, 'main li[data-factura-telefono]')
    const ths = await cabeceras(pagina)
    const fechasEnFila = await aLaVista(pagina, 'main [data-fecha-en-fila]')
    const codigosEnFila = await aLaVista(pagina, 'main [data-codigo-en-fila]')
    const numero = await pagina.locator('main li[data-factura-telefono]').first().getAttribute('data-factura-telefono').catch(() => null)
    const deLaBase = numero
      ? await uno(`select to_char(fecha_emision, 'DD/MM/YYYY') fecha from adquisiciones where numero_documento = $1 order by creado_en desc limit 1`, [numero])
      : null
    comprobar(fichas > 0, `${donde}: hay facturas que mirar (${fichas})`)
    if (ancho >= 1700) {
      comprobar(ths.length === 8 && ths.includes('Fecha de factura') && ths.includes('Código interno'), `${donde}: las ocho columnas (${ths.join(' | ')})`)
      comprobar(fechasEnFila === 0 && codigosEnFila === 0 && fichasVistas === 0, `${donde}: nada repetido bajo las celdas ni fichas a la vista`)
    } else if (ancho >= 1280) {
      comprobar(ths.length === 6 && !ths.includes('Fecha de factura') && !ths.includes('Código interno'), `${donde}: seis columnas, sin «Fecha de factura» ni «Código interno» (${ths.join(' | ')})`)
      comprobar(fechasEnFila >= fichas && fichasVistas === 0, `${donde}: la fecha va bajo cada factura (${fechasEnFila} para ${fichas} facturas y las OC que esperan)`)
      comprobar(codigosEnFila > 0, `${donde}: el código interno va bajo su OC (${codigosEnFila})`)
    } else {
      comprobar(ths.length === 0 && fichasVistas === fichas, `${donde}: una ficha por factura y ninguna tabla (${fichasVistas} de ${fichas})`)
      const partes = await pagina.locator('main li[data-factura-telefono]').evaluateAll((lis) =>
        lis.map((li) => ({
          rotulos: [...li.querySelectorAll('[data-parte] > dt')].filter((dt) => dt.getBoundingClientRect().height > 0).map((dt) => dt.textContent.trim()),
          conOc: li.querySelectorAll('a[href*="/compras/"], [data-parte="OC, RQ y código"] li').length > 0,
        })),
      )
      // El total de cada OC, que la tabla dice en su celda: una factura puede llevar dos OC o una parte de una.
      const totales = await pagina.locator('main li[data-factura-telefono] [data-parte="OC, RQ y código"] li').evaluateAll((lis) => ({
        ocs: lis.length,
        conTotal: lis.filter((li) => /(S\/|US\$)\s?[\d,]+\.\d\d|Sin precio/.test(li.querySelector('[data-total-de-la-oc]')?.textContent ?? '')).length,
      }))
      comprobar(totales.ocs > 0 && totales.conTotal === totales.ocs, `${donde}: cada OC de la ficha dice su total (${totales.conTotal} de ${totales.ocs})`)
      comprobar(
        partes.every((p) => p.rotulos.includes('Pago') && (!p.conOc || p.rotulos.includes('OC, RQ y código'))),
        `${donde}: cada ficha rotula «Pago» y, si tiene OC, «OC, RQ y código» (${partes[0]?.rotulos.join(' | ')})`,
      )
    }
    if (numero && deLaBase?.fecha) {
      // Lo que se lee de esa factura, en la tabla o en la ficha según el ancho, lleva la fecha de la base.
      const leido = await pagina.evaluate((n) => {
        const visible = (el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0
        const ficha = document.querySelector(`main li[data-factura-telefono="${CSS.escape(n)}"]`)
        if (ficha && visible(ficha)) return ficha.innerText
        const grupo = [...document.querySelectorAll('main table tbody')].find((tb) => visible(tb) && tb.innerText.includes(n))
        return grupo?.innerText ?? ''
      }, numero)
      comprobar(leido.includes(deLaBase.fecha), `${donde}: la factura ${numero} dice su fecha, la de la base (${deLaBase.fecha})`)
    }
    await comprobarCaja(pagina, errores, donde)
    await contexto.close()
  }

  // ---------------------------------------------------------------- 3. Caja diaria
  console.log('\n3. Caja diaria')
  // El último día con el saldo del banco capturado: hoy no tiene cierres y la línea no diría ningún monto.
  const conBanco = await uno(
    `select to_char(fecha, 'YYYY-MM-DD') dia, count(*)::int n, count(*) filter (where diferencia <> 0)::int descuadradas
       from cierres_caja where saldo_banco is not null and anulado_en is null group by fecha order by fecha desc limit 1`,
  )
  comprobar(Boolean(conBanco?.dia), `hay un día con el saldo del banco capturado para mirar (${conBanco?.dia ?? 'ninguno'}, ${conBanco?.n ?? 0} cuentas)`)
  // Y el último con una diferencia que no cuadra: el de arriba puede cuadrar en todas sus cuentas.
  const conDiferencia = await uno(
    `select to_char(fecha, 'YYYY-MM-DD') dia,
            count(*) filter (where saldo_banco is not null)::int n,
            count(*) filter (where diferencia <> 0)::int descuadradas
       from cierres_caja
      where anulado_en is null and fecha = (select max(fecha) from cierres_caja where anulado_en is null and diferencia <> 0)
      group by fecha`,
  )
  comprobar(Boolean(conDiferencia?.dia), `hay un día con una diferencia que no cuadra (${conDiferencia?.dia ?? 'ninguno'}, ${conDiferencia?.descuadradas ?? 0} cuentas)`)
  for (const [puesto, anchos] of [
    ['tesoreria', [1440, 1366, 1280, 1024, 768, 700, 390]],
    ['gerencia', [1440, 1024, 390]],
  ]) {
    for (const ancho of anchos) {
      const { pagina, contexto, errores } = await entrar(puesto, ancho)
      for (const [ruta, cual, delDia] of [
        ['/tesoreria/caja-diaria', 'hoy'],
        ...(conBanco?.dia ? [[`/tesoreria/caja-diaria?fecha=${conBanco.dia}`, conBanco.dia, conBanco]] : []),
        ...(conDiferencia?.dia && conDiferencia.dia !== conBanco?.dia
          ? [[`/tesoreria/caja-diaria?fecha=${conDiferencia.dia}`, conDiferencia.dia, conDiferencia]]
          : []),
      ]) {
        errores.length = 0
        await ir(pagina, ruta)
        const donde = `Caja diaria de ${cual} (${puesto}) ${ancho}`
        const ths = await cabeceras(pagina)
        const lineas = await pagina.locator('main [data-segun-el-banco]').evaluateAll((es) =>
          es.map((e) => ({ texto: e.textContent.replace(/\s+/g, ' ').trim(), visto: e.getBoundingClientRect().height > 0 })),
        )
        const conMonto = lineas.filter((l) => /^Según el banco (S\/|US\$)/.test(l.texto))
        if (ancho >= 1400) {
          comprobar(ths.includes('Según el banco') && ths.includes('Diferencia') && lineas.every((l) => !l.visto), `${donde}: «Según el banco» y «Diferencia» tienen su columna (${ths.join(' | ')})`)
        } else {
          comprobar(!ths.includes('Según el banco') && lineas.length > 0 && lineas.every((l) => l.visto), `${donde}: lo del banco va bajo el saldo final de cada cuenta (${lineas.filter((l) => l.visto).length} de ${lineas.length})`)
          const sinCaptura = lineas.filter((l) => l.texto === 'Sin captura del banco')
          comprobar(conMonto.length + sinCaptura.length === lineas.length, `${donde}: cada línea dice el saldo del banco o «Sin captura del banco» (${conMonto.length} con monto, ${sinCaptura.length} sin captura, de ${lineas.length})`)
          if (delDia) {
            comprobar(conMonto.length === delDia.n, `${donde}: dice el saldo del banco de cada cuenta que lo tiene (${conMonto.length} de ${delDia.n})`)
            const diferencias = await pagina.locator('main [data-diferencia-en-fila]').evaluateAll((es) =>
              es.filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
            )
            const descuadres = diferencias.filter((t) => /^Diferencia (−|-)?(S\/|US\$) ?-?[\d,]+\.\d\d$/.test(t))
            comprobar(
              diferencias.length === delDia.n && descuadres.length + diferencias.filter((t) => t === 'Cuadra con el banco').length === diferencias.length,
              `${donde}: y su diferencia o «Cuadra con el banco» (${diferencias.length} de ${delDia.n}: ${[...new Set(diferencias)].slice(0, 3).join(' · ')})`,
            )
            comprobar(descuadres.length === delDia.descuadradas, `${donde}: la que no cuadra dice cuánto (${descuadres.length} de ${delDia.descuadradas})`)
          }
        }
        await comprobarCaja(pagina, errores, donde)
      }
      await contexto.close()
    }
  }

  // ---------------------------------------------------------------- 4. Aprobación de compras
  console.log('\n4. Aprobación de compras')
  for (const ancho of [1440, 1024, 768, 390]) {
    const { pagina, contexto, errores } = await entrar('gerencia', ancho)
    await ir(pagina, '/compras/aprobacion')
    const donde = `Aprobación (gerencia) ${ancho}`
    const quien = await pagina.locator('main [data-quien-decidio]').count()
    const quienVisto = await aLaVista(pagina, 'main [data-quien-decidio]')
    const precio = await pagina.locator('main [data-precio-en-telefono]').count()
    const precioVisto = await aLaVista(pagina, 'main [data-precio-en-telefono]')
    if (ancho < 768) {
      comprobar(quien > 0 && quienVisto === quien, `${donde}: cada decidida dice quién y cuándo (${quienVisto} de ${quien})`)
    } else {
      comprobar(quienVisto === 0, `${donde}: quién y cuándo va en su columna, no repetido (${quienVisto})`)
    }
    // Sin el `if`: en este banco siempre hay órdenes por aprobar con insumos, y sin la línea la prueba tiene que fallar.
    comprobar(precio > 0 && (ancho < 640 ? precioVisto === precio : precioVisto === 0), `${donde}: el precio unitario ${ancho < 640 ? 'va bajo el insumo' : 'va en su columna'} (${precioVisto} de ${precio})`)
    const anular = await pagina.locator('main tr[data-anulable]').evaluateAll((trs) =>
      trs.map((tr) => {
        const boton = [...tr.querySelectorAll('button')].find((b) => /^Anular la /.test(b.getAttribute('aria-label') ?? ''))
        const estilo = boton ? getComputedStyle(boton) : null
        return {
          hay: Boolean(boton),
          enAcciones: Boolean(boton?.closest('[data-acciones-fila]')),
          sinBorde: estilo ? ['0px', ''].includes(estilo.borderTopWidth) || /rgba\(0, 0, 0, 0\)|transparent/.test(estilo.borderTopColor) : false,
        }
      }),
    )
    if (anular.length > 0) {
      comprobar(anular.every((a) => a.hay && a.enAcciones && a.sinBorde), `${donde}: «Anular» va en el renglón de acciones de cada aprobada, sin borde (${anular.length})`)
      if (ancho === 1440 || ancho === 390) {
        await pagina.locator('main tr[data-anulable]').first().getByRole('button', { name: /^Anular la / }).click()
        const ventana = pagina.locator('[role="dialog"]').first()
        await ventana.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
        comprobar((await ventana.locator('textarea[name="motivo"]').count()) === 1, `${donde}: «Anular» abre su ventana y pide el motivo`)
        await pagina.keyboard.press('Escape')
      }
    } else {
      console.log(`  (sin aprobadas que se puedan anular en este banco: no se mira «Anular» a ${ancho})`)
    }
    await comprobarCaja(pagina, errores, donde)
    await contexto.close()
  }

  // ---------------------------------------------------------------- 5. Órdenes de servicio, con Contabilidad y Tesorería
  console.log('\n5. Órdenes de servicio')
  for (const [puesto, botones] of [
    ['contabilidad', '«PDF» y «Detracción»'],
    ['tesoreria', '«PDF» y «Adjuntar documento»'],
  ]) {
    for (const ancho of [1440, 1280, 1024, 768]) {
      const { pagina, contexto, errores } = await entrar(puesto, ancho)
      await ir(pagina, '/compras/servicios')
      const filas = await pagina.locator('main tbody > tr [data-acciones-fila]').evaluateAll((cajas) =>
        cajas
          .map((caja) => {
            const mandos = [...caja.querySelectorAll('button, a')].filter((m) => m.getBoundingClientRect().width > 0)
            const centros = mandos.map((m) => m.getBoundingClientRect().top + m.getBoundingClientRect().height / 2).sort((a, b) => a - b)
            return { mandos: mandos.map((m) => m.textContent.replace(/\s+/g, ' ').trim()), renglones: centros.filter((c, i, l) => i === 0 || c - l[i - 1] > 8).length }
          })
          .filter((f) => f.mandos.length >= 2),
      )
      comprobar(filas.length > 0 && filas.every((f) => f.renglones === 1), `Órdenes de servicio (${puesto}) ${ancho}: ${botones} en un renglón (${filas.length} filas; el peor, ${Math.max(0, ...filas.map((f) => f.renglones))})`)
      await comprobarCaja(pagina, errores, `Órdenes de servicio (${puesto}) ${ancho}`)
      await contexto.close()
    }
  }

  // ---------------------------------------------------------------- 6. La escala de separaciones
  console.log('\n6. Separaciones')
  {
    const SEPARADAS = [
      ['gerencia', '/cotizaciones/pdf', '[aria-label="Filtrar por estado"]', 'Cotización: bajo los filtros'],
      ['tesoreria', '/tesoreria/recibos-por-honorarios', '[aria-label="Qué ver"]', 'Recibos por honorarios: bajo el filtro'],
      ['gerencia', '/avance/trabajos', '[aria-label="Filtrar por estado"]', 'Trabajos: bajo el filtro'],
      ['gerencia', '/costos/gastos-generales', 'nav[aria-label="Mes"]', 'Gastos del mes: bajo el mes'],
    ]
    let sesion = null
    let de = null
    for (const [puesto, ruta, selector, nombre] of SEPARADAS) {
      if (de !== puesto) {
        await sesion?.contexto.close()
        sesion = await entrar(puesto, 1440)
        de = puesto
      }
      await ir(sesion.pagina, ruta)
      const margen = await margenBajo(sesion.pagina, `main ${selector}`)
      comprobar(margen === 20, `${nombre}, 20 px (${margen})`)
    }
    await sesion?.contexto.close()
  }

  // ---------------------------------------------------------------- 7. Las demás pantallas, con la cuenta de su puesto
  console.log('\n7. Las demás pantallas de la entrega')
  const DEMAS = [
    ['tesoreria', ['/tesoreria/por-cobrar', '/tesoreria/por-pagar', '/tesoreria/pagos-de-servicio', '/tesoreria/recibos-por-honorarios', '/cotizaciones/pdf']],
    ['contabilidad', ['/contabilidad/facturacion', '/tesoreria/tipo-de-cambio', '/tesoreria/recibos-por-honorarios', '/compras/servicios', '/adquisiciones?vista=por-registrar']],
    ['gerencia', ['/por-decidir', '/cotizaciones/pdf', '/avance/trabajos', '/costos/gastos-generales', '/adquisiciones?vista=facturas']],
  ]
  for (const [puesto, rutas] of DEMAS) {
    for (const ancho of [1440, 1024, 390]) {
      const { pagina, contexto, errores } = await entrar(puesto, ancho)
      for (const ruta of rutas) {
        errores.length = 0
        await ir(pagina, ruta)
        const titulo = ((await pagina.locator('main h1').first().textContent()) ?? '').trim()
        comprobar(!/No tienes acceso/.test(titulo), `${puesto} entra a ${ruta} («${titulo}»)`)
        await comprobarCaja(pagina, errores, `${ruta} (${puesto}) ${ancho}`)
      }
      await contexto.close()
    }
  }
} finally {
  await navegador.close()
  await base.end()
}

console.log(fallas.length === 0 ? '\nTodo en orden.' : `\n${fallas.length} fallas.`)
process.exit(fallas.length === 0 ? 0 : 1)
