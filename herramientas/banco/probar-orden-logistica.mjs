/**
 * Entrega 4 del plan de orden y diseño (2026-11-26): las listas de Logística
 * y de Requerimientos con los botones de cada fila en un renglón
 * (`AccionesDeFila`) y, en el teléfono, cada fila como una ficha
 * (`<Tabla apilada>`). Antes, en su columna angosta, iban uno debajo del otro:
 * cinco botones de una orden de servicio medían 230 px de alto.
 *
 *   1. Con la cuenta de Logística, en Órdenes de compra, Órdenes de servicio,
 *      Proveedores y Atención; con la de Requerimientos, en Vehículos (con un
 *      ingreso sembrado que se anula al terminar); con la de Almacén, en
 *      Atención, Reposición y Equipos; con la de Mantenimiento, en Equipos:
 *      - a 1440, los botones de cada fila van en un renglón (la OS, con sus
 *        seis, en tres a lo más), «Anular» al final y sin borde;
 *      - a 390, la tabla es una lista de fichas, sin cabecera, con los botones
 *        en renglón, el monto y en qué va dentro de la ficha, y nada se sale
 *        por el costado;
 *      - a 700 (entre 640 y 767), el monto sale una sola vez por fila;
 *      - a 1024 (una laptop de 1366 con el zoom de Windows al 125 %), nada se
 *        sale por el costado y los botones no van uno por renglón;
 *      - en ninguna, errores en la consola.
 *   2. Cada botón sigue abriendo su ventana: «Editar» del proveedor,
 *      «Conforme» de la OS, «Adjuntar» de la OC y «Marcar salida» del
 *      vehículo, en el teléfono. No se envía nada.
 *   3. Gestión de compras: 20 px entre el resumen y cada sección.
 *   4. Ningún dato se pierde en la ficha: la observación de ingreso del
 *      vehículo, el correo del proveedor (sembrado y devuelto al terminar), su
 *      cuenta (o «Sin cuenta») y el comprobante que pide la OC se ven a 390,
 *      700, 1024 y 1440.
 *   5. Quien solo consulta (Gerencia) no recibe una columna de acciones ancha
 *      y vacía: su ancho sigue a lo que lleva.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE,
 * BANCO_CHROMIUM, CAPTURAS.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR =
  process.env.BANCO_CHROMIUM ??
  ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium'].find((r) => existsSync(r))
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

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(puesto, viewport) {
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

/**
 * Cada fila de la tabla principal: sus botones y enlaces de acción, en qué
 * renglón cae cada uno, si la cabecera se ve y si la página se sale de lado.
 */
const leerFilas = (pagina) =>
  pagina.evaluate(() => {
    const tabla = document.querySelector('main table.tabla-apilada') ?? document.querySelector('main table')
    const visible = (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
    }
    const filas = [...(tabla?.querySelectorAll('tbody > tr') ?? [])].map((tr) => {
      const celda = tr.lastElementChild
      const acciones = celda?.querySelector(':scope > div')
      const mandos = acciones ? [...acciones.querySelectorAll('button, a')].filter(visible) : []
      // Por su centro: el enlace «PDF» es más bajo que un botón y va en el mismo renglón.
      const centros = mandos.map((m) => {
        const r = m.getBoundingClientRect()
        return r.top + r.height / 2
      })
      const tops = centros.sort((a, b) => a - b).filter((c, i, l) => i === 0 || c - l[i - 1] > 8)
      // Si cabrían juntos en el ancho de su renglón (con los 8 px entre uno y otro).
      const cabrian = acciones
        ? mandos.reduce((suma, m) => suma + m.getBoundingClientRect().width, 0) + 8 * (mandos.length - 1) <= acciones.getBoundingClientRect().width
        : true
      const montos = [...tr.querySelectorAll('td, td *')].filter(
        (el) => visible(el) && el.children.length === 0 && /sin IGV$/.test(el.textContent.trim()),
      ).length
      const textoMandos = mandos.map((m) => m.textContent.replace(/\s+/g, ' ').trim())
      const ultimo = mandos.at(-1)
      return {
        texto: tr.innerText.slice(0, 40).replace(/\s+/g, ' '),
        esAcciones: Boolean(acciones && getComputedStyle(acciones).display === 'flex'),
        mandos: textoMandos,
        renglones: tops.length,
        cabrian,
        ultimoEsAnular: ultimo ? /Anular/.test(ultimo.textContent) : false,
        // «Fantasma»: sin borde que se vea (ninguno o transparente).
        anularSinBorde: ultimo
          ? ['0px', ''].includes(getComputedStyle(ultimo).borderTopWidth) || /rgba\(0, 0, 0, 0\)|transparent/.test(getComputedStyle(ultimo).borderTopColor)
          : false,
        montos,
        alto: Math.round(tr.getBoundingClientRect().height),
      }
    })
    const cabecera = tabla?.querySelector('thead')
    // Una celda sin nada que se vea no deja un renglón en blanco en la ficha.
    const celdasVacias = [...(tabla?.querySelectorAll('tbody > tr > td:not([colspan])') ?? [])].filter(
      (td) => visible(td) && !td.innerText.trim() && !td.querySelector('button, a, input, img, svg'),
    ).length
    return {
      celdasVacias,
      // La tabla dentro de su caja: la tarjeta la recorta y la página no se entera.
      tablaSobra: tabla ? Math.round(tabla.getBoundingClientRect().width - tabla.parentElement.getBoundingClientRect().width) : 0,
      apilada: Boolean(tabla?.classList.contains('tabla-apilada')),
      cabeceraVisible: cabecera ? getComputedStyle(cabecera).display !== 'none' : null,
      ancho: document.documentElement.scrollWidth,
      filas,
    }
  })

// Lo que se siembra va dentro del try: si algo falla a medias, el finally lo devuelve.
let vehiculo = null
let proveedor = null
let correo = null
let placa = null
const CASOS = [
  { puesto: 'logistica', ruta: '/compras/ordenes', nombre: 'Órdenes de compra', monto: true, maxRenglones: 1 },
  // La OS emitida lleva seis: «En ejecución», «Conforme», «Adjuntar documento»,
  // «Código y detracción», «PDF» y «Anular». Antes, uno por renglón.
  { puesto: 'logistica', ruta: '/compras/servicios', nombre: 'Órdenes de servicio', monto: true, maxRenglones: 3, anular: true },
  { puesto: 'logistica', ruta: '/proveedores', nombre: 'Proveedores', monto: false, maxRenglones: 1 },
  { puesto: 'requerimientos', ruta: '/vehiculos', nombre: 'Vehículos', monto: false, maxRenglones: 1, anular: true },
  // Atención: lo que se espera va a todo el ancho; los botones, en un renglón.
  { puesto: 'almacen', ruta: '/requerimientos/atencion', nombre: 'Atención (Almacén)', monto: false, maxRenglones: 2 },
  { puesto: 'logistica', ruta: '/requerimientos/atencion', nombre: 'Atención (Logística)', monto: false, maxRenglones: 2, unPrimario: true },
  // Reposición lleva un solo botón por fila («Cambiar»): se mira que sea ficha.
  { puesto: 'almacen', ruta: '/almacen/reposicion', nombre: 'Reposición', monto: false, maxRenglones: 1, sinRenglon: true },
  { puesto: 'mantenimiento', ruta: '/equipos', nombre: 'Equipos (Mantenimiento)', monto: false, maxRenglones: 1 },
  { puesto: 'almacen', ruta: '/equipos', nombre: 'Equipos (Almacén)', monto: false, maxRenglones: 1 },
]

try {
  // Un ingreso de vehículo en la planta, para ver su fila (se anula al terminar).
  const [req] = (
    await base.query(`select u.id from public.usuarios u join auth.users a on a.id = u.id where a.email = 'requerimientos.local@metalwork.test'`)
  ).rows
  placa = `ORD-${String(Date.now()).slice(-4)}`
  ;[vehiculo] = (
    await base.query(
      `insert into public.registro_vehiculos (placa, unidad, empresa, motivo, ingreso_en, ingreso_por, observacion_ingreso)
       values ($1, 'Volquete de prueba', 'TRANSPORTES DEL BANCO S.A.C.', 'COCHERA', now(), $2, 'Prueba del orden de la fila (entrega 4)')
       returning id`,
      [placa, req.id],
    )
  ).rows

  // Un proveedor con correo y una cuenta, para ver que la ficha los muestra (se devuelve al terminar).
  ;[proveedor] = (
    await base.query(`select id, razon_social, numero_documento, correo from public.proveedores where activo order by razon_social limit 1`)
  ).rows
  correo = `compras.${String(Date.now()).slice(-4)}@banco.test`
  await base.query(`update public.proveedores set correo = $2 where id = $1`, [proveedor.id, correo])


  // ------------------------------------------------------------ 1. Monitor, teléfono y el medio
  for (const caso of CASOS) {
    console.log(`\n1. ${caso.nombre} (${caso.puesto})`)
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
      { width: 700, height: 900 },
      { width: 1024, height: 768 },
    ]) {
      const { pagina, contexto, errores } = await entrar(caso.puesto, viewport)
      await ir(pagina, caso.ruta)
      const t = await leerFilas(pagina)
      const conMandos = t.filas.filter((f) => f.mandos.length > 0)
      const w = viewport.width
      comprobar(t.apilada, `${caso.nombre} ${w}: la tabla es apilada`)
      comprobar(conMandos.length > 0, `${caso.nombre} ${w}: hay ${conMandos.length} filas con botones para mirar`)
      if (!caso.sinRenglon) comprobar(conMandos.every((f) => f.esAcciones), `${caso.nombre} ${w}: los botones de cada fila van en AccionesDeFila`)
      // En la ficha: en el monitor una celda vacía es solo una columna sin nada.
      if (w < 768) comprobar(t.celdasVacias === 0, `${caso.nombre} ${w}: ninguna celda vacía deja un renglón en blanco en la ficha (${t.celdasVacias})`)
      comprobar(t.ancho <= w, `${caso.nombre} ${w}: nada se sale por el costado (${t.ancho} px)`)
      comprobar(t.tablaSobra <= 1, `${caso.nombre} ${w}: la tabla cabe en su tarjeta (sobran ${t.tablaSobra} px)`)
      if (w === 1024) {
        // Antes, entre 768 y 1279, un botón por renglón (revisión de diseño).
        const apilados = conMandos.filter((f) => f.mandos.length >= 3 && f.renglones >= f.mandos.length)
        comprobar(apilados.length === 0, `${caso.nombre} 1024: ninguna fila de tres o más botones con uno por renglón (${apilados.map((f) => `${f.texto}: ${f.renglones}`).join(' | ')})`)
        await pagina.screenshot({ path: join(CAPTURAS, `orden-logistica-${caso.ruta.replace(/\//g, '_')}-${caso.puesto}-1024.png`) })
      }
      if (caso.unPrimario) {
        // «Generar OC» y «Lo estoy comprando» juntos: uno solo es primario.
        const dos = await pagina.evaluate(() =>
          [...document.querySelectorAll('main tbody > tr')].filter((tr) => {
            const nombres = [...tr.querySelectorAll('a, button')].map((b) => b.textContent.trim())
            return nombres.some((n) => /Generar OC/.test(n)) && nombres.some((n) => /Lo estoy comprando/.test(n))
          }).map((tr) => {
            const fondo = (re) => getComputedStyle([...tr.querySelectorAll('a, button')].find((b) => re.test(b.textContent)) ).backgroundColor
            return { oc: fondo(/Generar OC/), compro: fondo(/Lo estoy comprando/) }
          }),
        )
        if (dos.length) comprobar(dos.every((d) => d.oc !== d.compro), `${caso.nombre} ${w}: con «Generar OC» al lado, «Lo estoy comprando» no es otro primario (${dos.length} filas)`)
      }
      if (w === 1440) {
        const peor = Math.max(0, ...conMandos.map((f) => f.renglones))
        comprobar(peor <= caso.maxRenglones, `${caso.nombre} 1440: los botones de cada fila caben en ${caso.maxRenglones} renglón(es) (el peor, ${peor})`)
        comprobar(t.cabeceraVisible === true, `${caso.nombre} 1440: la cabecera de la tabla se ve`)
      }
      if (w === 390) {
        comprobar(t.cabeceraVisible === false, `${caso.nombre} 390: sin cabecera, cada fila es una ficha`)
        // Dos o más botones: comparten renglón, no uno bajo otro.
        // Solo cuenta si cabían juntos: «Registrar la salida en el kardex» y
        // «Entregar con faltante» suman más que los 356 px de la ficha.
        const apilados = conMandos.filter((f) => f.mandos.length >= 2 && f.renglones >= f.mandos.length && f.cabrian)
        comprobar(apilados.length === 0, `${caso.nombre} 390: ninguna fila con sus botones uno debajo del otro (${apilados.map((f) => f.texto).join(' | ')})`)
        await pagina.screenshot({ path: join(CAPTURAS, `orden-logistica-${caso.ruta.replace(/\//g, '_')}-390.png`), fullPage: true })
      }
      // En el monitor el monto va en su columna, bajo «Monto sin IGV»; en la
      // ficha, con su «sin IGV» al lado.
      if (caso.monto && w < 768) {
        const mal = t.filas.filter((f) => f.mandos.length > 0 && f.montos !== 1)
        comprobar(mal.length === 0, `${caso.nombre} ${w}: el monto «sin IGV» sale una vez por fila (${mal.map((f) => `${f.texto}: ${f.montos}`).join(' | ')})`)
      }
      if (caso.anular) {
        const conAnular = conMandos.filter((f) => f.mandos.some((m) => /Anular/.test(m)))
        comprobar(conAnular.length > 0, `${caso.nombre} ${w}: hay filas con «Anular» (${conAnular.length})`)
        comprobar(conAnular.every((f) => f.ultimoEsAnular && f.anularSinBorde), `${caso.nombre} ${w}: «Anular» va al final y sin borde`)
      }
      comprobar(errores.length === 0, `${caso.nombre} ${w}: sin errores en la consola${errores.length ? ` (${errores[0]})` : ''}`)
      if (w === 1440) await pagina.screenshot({ path: join(CAPTURAS, `orden-logistica-${caso.ruta.replace(/\//g, '_')}-1440.png`) })
      await contexto.close()
    }
  }

  // ------------------------------------------------------------ 2. Cada botón abre su ventana, en el teléfono
  console.log('\n2. Cada botón abre su ventana (390)')
  const VENTANAS = [
    { puesto: 'logistica', ruta: '/proveedores', boton: /^Editar$/, titulo: 'razon-social', nombre: '«Editar» del proveedor' },
    { puesto: 'logistica', ruta: '/compras/servicios', boton: /^Conforme$/, titulo: /^Conformidad de la orden de servicio/, nombre: '«Conforme» de la OS' },
    { puesto: 'logistica', ruta: '/compras/ordenes', boton: /^Adjuntar$/, titulo: /^Adjuntar a la compra/, nombre: '«Adjuntar» de la OC' },
    { puesto: 'requerimientos', ruta: '/vehiculos', boton: /^Marcar salida$/, titulo: new RegExp(`^Salida de ${placa}`), nombre: '«Marcar salida» del vehículo' },
  ]
  for (const v of VENTANAS) {
    const { pagina, contexto, errores } = await entrar(v.puesto, { width: 390, height: 844 })
    await ir(pagina, v.ruta)
    const boton = pagina.locator('main tbody').getByRole('button', { name: v.boton }).first()
    // La ventana de «Editar» lleva la razón social de su fila, no otra.
    const razon = v.titulo === 'razon-social' ? ((await boton.locator('xpath=ancestor::tr').locator('td').first().locator('p').first().textContent()) ?? '').replace(/Dado de baja/, '').trim() : null
    await boton.scrollIntoViewIfNeeded()
    await boton.tap()
    const ventana = pagina.locator('[role="dialog"]').first()
    await ventana.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {})
    const titulo = (await ventana.locator('h2').first().textContent().catch(() => '')) ?? ''
    comprobar(await ventana.isVisible(), `${v.nombre}: abre su ventana («${titulo.trim()}»)`)
    comprobar(razon ? titulo.includes(razon) && razon.length > 3 : v.titulo.test(titulo.trim()), `${v.nombre}: es la ventana que corresponde${razon ? ` (${razon})` : ''}`)
    await pagina.keyboard.press('Escape')
    comprobar(errores.length === 0, `${v.nombre}: sin errores en la consola${errores.length ? ` (${errores[0]})` : ''}`)
    await contexto.close()
  }

  // ------------------------------------------------------------ 3. Gestión de compras, en la escala
  console.log('\n3. Gestión de compras')
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const { pagina, contexto, errores } = await entrar('logistica', viewport)
    await ir(pagina, '/compras/gestion')
    const huecos = await pagina.evaluate(() => {
      const resumen = document.querySelector('main section')?.parentElement
      if (!resumen) return []
      const hijos = [...resumen.children].filter((h) => h.getBoundingClientRect().height > 0)
      return hijos.slice(1).map((h, i) => Math.round(h.getBoundingClientRect().top - hijos[i].getBoundingClientRect().bottom))
    })
    comprobar(huecos.length >= 2 && huecos.every((h) => h === 20), `Gestión ${viewport.width}: 20 px entre el resumen y cada sección (${huecos.join(', ')})`)
    comprobar(errores.length === 0, `Gestión ${viewport.width}: sin errores en la consola`)
    await contexto.close()
  }

  // ------------------------------------------------------------ 4. Ningún dato se pierde en la ficha
  console.log('\n4. Los datos de cada columna también en la ficha')
  const DATOS = [
    { puesto: 'requerimientos', ruta: '/vehiculos', textos: ['Prueba del orden de la fila (entrega 4)'], nombre: 'Vehículos: la observación del ingreso' },
    { puesto: 'logistica', ruta: `/proveedores?q=${proveedor.numero_documento}`, textos: [correo, /Sin cuenta| · (S\/|US\$|\$) · /], nombre: 'Proveedores: el correo y la cuenta' },
    { puesto: 'logistica', ruta: '/compras/ordenes', textos: [/Con factura|Sin factura/i], nombre: 'OC: el comprobante que se pide' },
  ]
  for (const d of DATOS) {
    for (const viewport of [{ width: 390, height: 844 }, { width: 700, height: 900 }, { width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
      const { pagina, contexto } = await entrar(d.puesto, viewport)
      await ir(pagina, d.ruta)
      const texto = await pagina.locator('main tbody').innerText()
      comprobar(d.textos.every((t) => (typeof t === 'string' ? texto.includes(t) : t.test(texto))), `${d.nombre}, a ${viewport.width}`)
      await contexto.close()
    }
  }

  // ------------------------------------------------------------ 4b. El kardex a 1024
  {
    const { pagina, contexto } = await entrar('almacen', { width: 1024, height: 768 })
    await ir(pagina, '/almacen/kardex')
    const sobra = await pagina.evaluate(() => {
      const tablas = [...document.querySelectorAll('main table')]
      return Math.max(0, ...tablas.map((t) => Math.round(t.getBoundingClientRect().width - t.parentElement.getBoundingClientRect().width)))
    })
    comprobar(sobra <= 1, `Kardex 1024: la consulta cabe en su tarjeta (sobran ${sobra} px; medía 841 en 718)`)
    await contexto.close()
  }

  // ------------------------------------------------------------ 5. Quien solo consulta
  console.log('\n5. Gerencia consulta: sin columna de acciones ancha y vacía')
  for (const ruta of ['/compras/ordenes', '/compras/servicios', '/vehiculos']) {
    const { pagina, contexto } = await entrar('gerencia', { width: 1440, height: 900 })
    await ir(pagina, ruta)
    const m = await pagina.evaluate(() => {
      const th = document.querySelector('main table thead tr')?.lastElementChild
      const contenido = [...document.querySelectorAll('main tbody > tr > td:last-child [data-acciones-fila]')].map((d) =>
        [...d.children].reduce((suma, h) => suma + h.getBoundingClientRect().width, 0),
      )
      return { columna: Math.round(th?.getBoundingClientRect().width ?? 0), contenido: Math.round(Math.max(0, ...contenido)) }
    })
    // Lo que lleva, más el aire de la celda (24 px) y un margen.
    comprobar(m.columna <= m.contenido + 60, `Gerencia ${ruta}: la columna de acciones mide ${m.columna} px para ${m.contenido} px de botones`)
    await contexto.close()
  }
} finally {
  if (proveedor) await base.query(`update public.proveedores set correo = $2 where id = $1`, [proveedor.id, proveedor.correo])
  if (vehiculo) await base.query(
    `update public.registro_vehiculos set anulado_en = now(), anulado_por = ingreso_por, motivo_anulacion = 'Prueba del orden de la fila, se anula al terminar'
     where id = $1 and anulado_en is null`,
    [vehiculo.id],
  )
  await navegador.close()
  await base.end()
}

if (fallas.length) {
  console.log(`\n${fallas.length} fallas:\n- ${fallas.join('\n- ')}`)
  process.exitCode = 1
} else console.log('\nTodo pasa.')
