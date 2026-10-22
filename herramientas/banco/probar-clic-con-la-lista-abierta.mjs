/**
 * El buscador del código interno dentro de una ventana: con la lista abierta,
 * el clic en «Registrar» llega al botón al primer intento. Con clic real (el
 * botón se aprieta, pasa un instante y se suelta, como con el ratón), con la
 * cuenta de cada puesto, nunca ADMIN:
 *
 *   1. RR. HH., en «Registrar observación», a 1440 × 900 y a 1366 × 657 (lo
 *      que deja Chrome en un portátil de 1366 × 768): el campo queda abajo y la
 *      lista no cabe debajo. Abrirla no rueda la ventana (al cerrarse volvía
 *      arriba, el botón se corría 204 px antes de soltarlo y el clic caía en el
 *      formulario), y la lista queda dentro de ella. El clic en «Registrar»
 *      llega al botón: el navegador revisa los campos que faltan. Con un código
 *      que tiene otro casi igual, igual: su «Cambiar a …» ya está debajo del
 *      campo con la lista abierta, invisible, y no aparece de golpe al
 *      cerrarla. El Tab desde el campo pasa al campo siguiente y no al
 *      «Cambiar a …». Con una búsqueda a medias, el clic llega igual y el
 *      navegador frena el envío en el código (antes aparecía «Usar … como
 *      código nuevo» al cerrar la lista y corría el botón).
 *   2. RR. HH. en el teléfono (390 × 844, con el dedo): con la lista abierta,
 *      el toque en otro campo cae en ese campo, que no se mueve (la ventana
 *      rodaba y, al cerrarse la lista, el campo bajaba 196 px).
 *   3. Tesorería, en «Registrar ingreso o egreso» a 1440 × 900, con el código
 *      que tiene otro casi igual: el clic en «Registrar» llega al botón (el
 *      «Cambiar a …» que aparecía al cerrar la lista lo corría 23 px).
 *   4. Almacén, en «Registrar salida» del kardex a 1366 × 657: abrir la lista
 *      no rueda la ventana, y al cerrarla con Escape el campo no se mueve.
 *   5. Almacén, en la misma salida a 1440 × 900, con el código escrito entero,
 *      solo y con otro casi igual: la lista trae solo ese (al completarlo pasaba
 *      al catálogo entero, o traía también el casi igual, tapaba «Nombre de quien
 *      recibe» y el clic en ese campo elegía PLANTA o el otro), y el clic en
 *      «Nombre de quien recibe» llega a ese campo con el código intacto. Con
 *      un vehículo de modelo largo, igual, y su detalle se recorta a dos
 *      renglones (salía entero, en cuatro o más, y la opción crecía).
 *
 * No registra nada: los campos que faltan frenan el envío, y eso es lo que
 * prueba que el clic llegó. Siembra tres vehículos con código (uno de modelo
 * largo), una etapa con un código casi igual al de uno de ellos y un material
 * en el kardex, con un sello distinto en cada corrida.
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
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const sello = Date.now().toString(36).slice(-5).toUpperCase()
const solo = `CLS${sello}`
const gemelos = [`CLG-${sello}`, `CLG_${sello}`]
const largo = `CLL${sello}`
const MONITOR = { width: 1440, height: 900 }
const PORTATIL = { width: 1366, height: 657 }
const CELULAR = { width: 390, height: 844 }

const base = new pg.Client({
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.BANCO_BASE ?? 'mw_demo',
})
await base.connect()
await base.query(`insert into public.unidades (codigo_interno, placa, marca, modelo) values ($1, $2, 'Volvo', 'FH'), ($3, $4, 'Volvo', 'FH')`,
  [solo, `S${sello.slice(0, 2)}-${sello.slice(2)}`, gemelos[0], `G${sello.slice(0, 2)}-${sello.slice(2)}`])
await base.query(`insert into public.unidades (codigo_interno, placa, marca, modelo) values ($1, $2, 'Mercedes-Benz', $3)`,
  [largo, `L${sello.slice(0, 2)}-${sello.slice(2)}`,
    // Largo de sobra: a lo ancho de la salida tiene que pasar de dos renglones para que el recorte se note.
    'Actros 3344 K 6x4 con tolva volquetera de 20 m3, cabina dormitorio, toma de fuerza, enganche y luces de trabajo para la mina, '
    + 'con barandas laterales de acero, compuerta trasera de doble apertura, lona enrollable, escalera de acceso, guardafangos '
    + 'de polietileno, faros neblineros, alarma de retroceso, cámara trasera y caja de herramientas bajo la tolva'])
// El casi igual no entra al padrón, que no deja dos códigos iguales por letras y
// números: llega a la lista por una etapa que Diseño le definió.
await base.query(`insert into public.codigo_etapas (codigo_interno, orden, nombre, creado_por)
  values ($1, 1, 'Etapa del banco', (select id from public.usuarios where correo = 'rrhh.local@metalwork.test'))`, [gemelos[1]])
// Un material en el kardex, para abrir la salida con algo que sacar.
const material = { codigo: `PRB-CLA-${sello}`, descripcion: `Lista abierta ${sello}` }
const [{ id: materialId }] = (await base.query(`insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ($1, $2, (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' order by codigo limit 1),
          (select id from public.unidades_medida where codigo = 'UND')) returning id::text`, [material.codigo, material.descripcion])).rows
await base.query(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
  select gen_random_uuid(), 'INGRESO', $1::uuid, 5, 'INGRESO_GENERAL', $2, u.id from public.usuarios u where u.correo = 'almacen.local@metalwork.test'`,
  [materialId, `GR BANCO CLA ${sello}`])
await base.end()

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, viewport) {
  const movil = viewport === CELULAR
  const contexto = await navegador.newContext({ viewport, isMobile: movil, hasTouch: movil, timezoneId: 'America/Lima' })
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

async function hidratado(loc) {
  await loc.waitFor({ timeout: 60000 })
  for (let i = 0; i < 240; i++) {
    if (await loc.evaluate((e) => Object.keys(e).some((k) => k.startsWith('__reactProps')))) return
    await loc.page().waitForTimeout(250)
  }
}

/** Anota los clics y las revisiones del navegador. */
const anotar = (pagina) =>
  pagina.evaluate(() => {
    window.__eventos = []
    for (const t of ['mousedown', 'mouseup', 'click', 'invalid'])
      document.addEventListener(t, (e) => window.__eventos.push(`${t}:${e.target.tagName}:${(e.target.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 20)}`), true)
  })

/** Abre la ventana del formulario y anota los clics y las revisiones del navegador. */
async function abrirVentana(pagina, ruta, abre) {
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
  const boton = pagina.getByRole('button', { name: abre }).first()
  await hidratado(boton)
  await boton.click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.waitFor({ timeout: 30000 })
  const campo = ventana.locator('input[role="combobox"]').first()
  await hidratado(campo)
  await anotar(pagina)
  return { ventana, campo }
}

/** Lo que rueda la ventana, dónde está la lista, el campo y el botón de enviar. */
const medir = (pagina) =>
  pagina.evaluate(() => {
    const campo = document.querySelector('[role="dialog"] input[role="combobox"]')
    let rueda = campo.parentElement
    while (rueda && !['auto', 'scroll'].includes(getComputedStyle(rueda).overflowY)) rueda = rueda.parentElement
    const ul = document.querySelector('[role="listbox"]')?.getBoundingClientRect()
    const enviar = [...document.querySelectorAll('[role="dialog"] button[type="submit"]')].at(-1)?.getBoundingClientRect()
    const borde = rueda?.getBoundingClientRect()
    return {
      rodado: rueda ? Math.round(rueda.scrollTop) : null,
      techo: borde ? Math.round(borde.top) : 0,
      piso: borde ? Math.round(Math.min(borde.bottom, innerHeight)) : innerHeight,
      lista: ul ? [Math.round(ul.top), Math.round(ul.bottom)] : null,
      campo: Math.round(campo.getBoundingClientRect().top),
      enviar: enviar ? Math.round(enviar.top) : null,
    }
  })

const listaAdentro = (m) => m.lista !== null && m.lista[0] >= m.techo && m.lista[1] <= m.piso

/** Un clic como el de una persona: aprieta, espera y suelta. */
async function clicEnEnviar(pagina) {
  const caja = await pagina.locator('[role="dialog"] button[type="submit"]').last().boundingBox()
  await pagina.evaluate(() => { window.__eventos = [] })
  await pagina.mouse.move(caja.x + caja.width / 2, caja.y + caja.height / 2, { steps: 4 })
  await pagina.waitForTimeout(150)
  await pagina.mouse.down()
  await pagina.waitForTimeout(110)
  await pagina.mouse.up()
  await pagina.waitForTimeout(800)
  return pagina.evaluate(() => window.__eventos)
}

const llegoAlBoton = (eventos) => eventos.some((e) => e.startsWith('click:BUTTON:Registrar')) && eventos.some((e) => e.startsWith('invalid:'))

// ---------------------------------------------------------------- 1: Observaciones
for (const [tamano, viewport] of [['1440 × 900', MONITOR], ['1366 × 657', PORTATIL]]) {
  for (const [cual, codigo] of [['un código', solo], ['un código con otro casi igual', gemelos[0]], ['una búsqueda a medias', `ZQ${sello}`]]) {
    console.log(`RR. HH., «Registrar observación», a ${tamano}, con ${cual}`)
    const { pagina, contexto, errores } = await entrar('rrhh.local@metalwork.test', viewport)
    const { campo } = await abrirVentana(pagina, '/rrhh/observaciones', 'Registrar observación')
    const antes = await medir(pagina)
    await campo.click()
    await campo.pressSequentially(codigo, { delay: 20 })
    await pagina.waitForTimeout(700)
    const abierta = await medir(pagina)
    const cambiar = pagina.locator('[role="dialog"] button', { hasText: `Cambiar a ${gemelos[1]}` })
    const cambiarConLista = [await cambiar.count(), await cambiar.isVisible().catch(() => null)]
    const nombre = `${viewport.width}x${viewport.height}-${codigo === solo ? 'solo' : codigo === gemelos[0] ? 'gemelo' : 'a-medias'}`
    await pagina.screenshot({ path: join(CAPTURAS, `clic-lista-abierta-observaciones-${nombre}.png`) })
    comprobar(abierta.lista !== null && abierta.rodado === antes.rodado,
      `abrir la lista no rueda la ventana: ${JSON.stringify({ antes, abierta })}`)
    comprobar(listaAdentro(abierta), `y la lista queda dentro de la ventana: ${JSON.stringify(abierta)}`)
    if (codigo === gemelos[0]) {
      comprobar(cambiarConLista[0] === 1 && cambiarConLista[1] === false,
        `el «Cambiar a ${gemelos[1]}» ya está debajo del campo con la lista abierta, invisible: ${cambiarConLista}`)
    }
    const eventos = await clicEnEnviar(pagina)
    const despues = await medir(pagina)
    comprobar(llegoAlBoton(eventos) && despues.enviar === abierta.enviar,
      `el primer clic en «Registrar» llega al botón y el botón no se corre: ${JSON.stringify(eventos.filter((e) => !e.startsWith('invalid')))} ${abierta.enviar} → ${despues.enviar}`)
    if (codigo === gemelos[0]) {
      // El Tab con la lista abierta pasa al campo siguiente, no al «Cambiar a …».
      await campo.click()
      await campo.fill('')
      await campo.pressSequentially(codigo, { delay: 20 })
      await pagina.waitForTimeout(500)
      await campo.press('Tab')
      await pagina.waitForTimeout(300)
      const foco = await pagina.evaluate(() => `${document.activeElement?.tagName} ${document.activeElement?.textContent?.trim().slice(0, 30) ?? ''}`)
      comprobar(!foco.includes('Cambiar a') && await pagina.locator('[role="listbox"]').count() === 0,
        `con la lista abierta, el Tab no cae en «Cambiar a …» y la lista se cierra: ${foco}`)
    }
    comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
    await contexto.close()
  }
}

// ---------------------------------------------------------------- 2: el teléfono
{
  console.log('RR. HH., «Registrar observación», en el teléfono, con un código')
  const { pagina, contexto, errores } = await entrar('rrhh.local@metalwork.test', CELULAR)
  const { campo } = await abrirVentana(pagina, '/rrhh/observaciones', 'Registrar observación')
  const antes = await medir(pagina)
  await campo.tap()
  await campo.pressSequentially(solo, { delay: 20 })
  await pagina.waitForTimeout(700)
  const abierta = await medir(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'clic-lista-abierta-observaciones-telefono.png') })
  comprobar(abierta.lista !== null && abierta.rodado === antes.rodado && listaAdentro(abierta),
    `en el teléfono, abrir la lista no rueda la ventana y la lista queda dentro de ella: ${JSON.stringify({ antes, abierta })}`)
  // Otro campo que la lista no tapa: el toque cae en él y no se mueve.
  const otro = await pagina.evaluate(() => {
    const ventana = document.querySelector('[role="dialog"]')
    for (const e of ventana.querySelectorAll('textarea, select, input:not([role="combobox"])')) {
      const r = e.getBoundingClientRect()
      const x = r.left + r.width / 2
      const y = r.top + Math.min(r.height / 2, 14)
      if (r.height > 0 && y > 0 && y < innerHeight && document.elementFromPoint(x, y) === e) return { x, y, nombre: e.getAttribute('name') ?? e.tagName }
    }
    return null
  })
  if (otro) {
    await pagina.evaluate(() => { window.__eventos = [] })
    await pagina.touchscreen.tap(otro.x, otro.y)
    await pagina.waitForTimeout(800)
    const eventos = await pagina.evaluate(() => window.__eventos)
    const enElCampo = await pagina.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('name') ?? document.elementFromPoint(x, y)?.tagName, otro)
    comprobar(eventos.filter((e) => e.startsWith('mouseup') || e.startsWith('click')).every((e) => e.split(':')[1] === eventos[0]?.split(':')[1])
      && enElCampo === otro.nombre,
      `con la lista abierta, el toque en «${otro.nombre}» cae en ese campo, que no se mueve: ${JSON.stringify(eventos)} ${enElCampo}`)
  } else {
    comprobar(false, 'con la lista abierta, queda otro campo a la vista para tocarlo')
  }
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------- 3: caja diaria
{
  console.log('Tesorería, «Registrar ingreso o egreso», con un código que tiene otro casi igual')
  const { pagina, contexto, errores } = await entrar('tesoreria.local@metalwork.test', MONITOR)
  const { campo } = await abrirVentana(pagina, '/tesoreria/caja-diaria', /Registrar ingreso o egreso/)
  await campo.click()
  await campo.pressSequentially(gemelos[0], { delay: 20 })
  await pagina.waitForTimeout(700)
  const abierta = await medir(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'clic-lista-abierta-caja.png') })
  const eventos = await clicEnEnviar(pagina)
  const despues = await medir(pagina)
  comprobar(llegoAlBoton(eventos) && despues.enviar === abierta.enviar,
    `el primer clic en «Registrar» llega al botón y el botón no se corre: ${JSON.stringify(eventos.filter((e) => !e.startsWith('invalid')))} ${abierta.enviar} → ${despues.enviar}`)
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------- 4: la salida del kardex
{
  console.log('Almacén, «Registrar salida», a 1366 × 657, con un código')
  const { pagina, contexto, errores } = await entrar('almacen.local@metalwork.test', PORTATIL)
  await pagina.goto(`${BASE}/almacen/kardex`, { waitUntil: 'networkidle', timeout: 120000 })
  const abrir = pagina.getByRole('button', { name: 'Registrar salida' })
  await hidratado(abrir)
  await abrir.click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.waitFor({ timeout: 30000 })
  await ventana.locator('#sal-material').click()
  await ventana.getByRole('searchbox', { name: 'Código o descripción' }).fill(material.codigo)
  await ventana.locator('[role="option"]', { hasText: material.descripcion }).click()
  await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
  const campo = ventana.locator('#sal-codigo')
  await hidratado(campo)
  const antes = await medir(pagina)
  await campo.click()
  await campo.pressSequentially(solo, { delay: 20 })
  await pagina.waitForTimeout(700)
  const abierta = await medir(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'clic-lista-abierta-salida.png') })
  // Se cierra con Escape: el Tab lleva el foco al campo siguiente, y si está
  // abajo el navegador rueda hasta él, como debe.
  await campo.press('Escape')
  await pagina.waitForTimeout(300)
  const cerrada = await medir(pagina)
  comprobar(abierta.lista !== null && abierta.rodado === antes.rodado && listaAdentro(abierta)
    && cerrada.lista === null && cerrada.rodado === abierta.rodado && cerrada.campo === abierta.campo && await ventana.isVisible(),
    `abrir la lista no rueda la ventana, la lista queda dentro y al cerrarla el campo no se mueve: ${JSON.stringify({ antes, abierta, cerrada })}`)
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------------------- 5: el código escrito entero
const NOMBRE_DEL_CASO = { [solo]: 'solo', [gemelos[0]]: 'gemelo', [largo]: 'largo' }
for (const [cual, codigo] of [['un código', solo], ['un código con otro casi igual', gemelos[0]], ['un vehículo de modelo largo', largo]]) {
  console.log(`Almacén, «Registrar salida», a 1440 × 900, con ${cual} escrito entero`)
  const { pagina, contexto, errores } = await entrar('almacen.local@metalwork.test', MONITOR)
  await pagina.goto(`${BASE}/almacen/kardex`, { waitUntil: 'networkidle', timeout: 120000 })
  const abrir = pagina.getByRole('button', { name: 'Registrar salida' })
  await hidratado(abrir)
  await abrir.click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.waitFor({ timeout: 30000 })
  await ventana.locator('#sal-material').click()
  await ventana.getByRole('searchbox', { name: 'Código o descripción' }).fill(material.codigo)
  await ventana.locator('[role="option"]', { hasText: material.descripcion }).click()
  await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
  const campo = ventana.locator('#sal-codigo')
  await hidratado(campo)
  await anotar(pagina)
  await campo.click()
  await campo.pressSequentially(codigo.slice(0, -1), { delay: 20 })
  await pagina.waitForTimeout(500)
  const aMedias = await ventana.locator('[role="option"]').count()
  await campo.pressSequentially(codigo.slice(-1), { delay: 20 })
  await pagina.waitForTimeout(700)
  const opciones = (await ventana.locator('[role="option"]').allTextContents()).map((o) => o.replace(/\s+/g, ' ').trim())
  // Los renglones del detalle de la única opción: el alto que ocupa entre el de un renglón.
  const detalle = await ventana.locator('[role="option"] .text-texto-suave').first().evaluate((e) => {
    const { height } = e.getBoundingClientRect()
    // Recortado: lo que ocupa el texto entero (scrollHeight) es más que lo que se ve.
    return { renglones: Math.round(height / parseFloat(getComputedStyle(e).lineHeight)), alto: Math.round(height), recortado: e.scrollHeight > e.clientHeight + 1 }
  }).catch(() => null)
  await pagina.screenshot({ path: join(CAPTURAS, `clic-lista-abierta-salida-entero-${NOMBRE_DEL_CASO[codigo]}.png`) })
  const recibe = await ventana.locator('#sal-recibe').boundingBox()
  await pagina.evaluate(() => { window.__eventos = [] })
  await pagina.mouse.move(recibe.x + recibe.width / 2, recibe.y + recibe.height / 2, { steps: 4 })
  await pagina.waitForTimeout(150)
  await pagina.mouse.down()
  await pagina.waitForTimeout(110)
  await pagina.mouse.up()
  await pagina.waitForTimeout(500)
  const eventos = await pagina.evaluate(() => window.__eventos)
  const foco = await pagina.evaluate(() => document.activeElement?.id ?? '')
  const valor = await campo.inputValue()
  comprobar(opciones.length === 1 && opciones[0].startsWith(codigo),
    `con ${cual} escrito entero, la lista trae solo ese: ${aMedias} opciones a medias, después ${JSON.stringify(opciones)}`)
  comprobar(foco === 'sal-recibe' && valor === codigo,
    `el clic en «Nombre de quien recibe» llega a ese campo y el código no cambia: ${JSON.stringify(eventos)} foco en «${foco}», código «${valor}»`)
  if (codigo === largo) {
    comprobar(detalle !== null && detalle.renglones <= 2 && detalle.recortado,
      `el detalle del modelo largo se recorta a dos renglones: ${JSON.stringify(detalle)}`)
  }
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
  await contexto.close()
}

await navegador.close()
console.log(fallas.length ? `\n${fallas.length} fallan.` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
