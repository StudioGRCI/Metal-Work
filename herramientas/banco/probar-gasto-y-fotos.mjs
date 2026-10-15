/**
 * Recorre con clic real lo que cambió para Requerimientos el 2026-10-15, con
 * la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Requerimientos ya no tiene en el menú el kardex, los gastos del mes ni
 *      la valorización, y si las abre por su dirección le sale «Sin permiso».
 *      Tiene «Gasto por código interno»: la lista y el detalle de un código con
 *      sus materiales y su compra aparte, sin mano de obra.
 *   2. Registra el ingreso de un vehículo: sin fotos no se deja; con dos fotos
 *      grandes, que se achican y suben, entra. El detalle del vehículo las
 *      muestra. Una ventana que se cierra sin registrar retira la foto que ya
 *      había subido.
 *   3. Marca la salida con una foto; el detalle muestra las dos tandas.
 *   4. Gerencia abre el detalle y ve las fotos; Ventas no entra a Vehículos ni
 *      al gasto por código.
 *
 * Necesita en la base del banco las cuentas `requerimientos.local`,
 * `gerencia.local` y `ventas.local@metalwork.test`, y el código
 * BANCO_SR_O4_1_26/30 con 8 × 5.50 de soldadura salida, un disco sin precio y
 * una OC de S/ 55.50.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE, CAPTURAS.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CODIGO = process.env.CODIGO ?? 'BANCO_SR_O4_1_26/30'
const CUENTAS = {
  requerimientos: process.env.REQUERIMIENTOS ?? 'requerimientos.local@metalwork.test',
  gerencia: process.env.GERENCIA ?? 'gerencia.local@metalwork.test',
  ventas: process.env.VENTAS ?? 'ventas.local@metalwork.test',
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

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const CELULAR = { width: 390, height: 844 }

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto, errores }
}

// --------------------------------------------------- fotos de prueba
// Ruido para que pesen como una foto de celular y tengan que achicarse.
const fotos = join(CAPTURAS, 'fotos-vehiculo')
mkdirSync(fotos, { recursive: true })
{
  const p = await (await navegador.newContext()).newPage()
  const hacer = (ancho, alto) =>
    p.evaluate(
      async ([ancho, alto]) => {
        const c = document.createElement('canvas')
        c.width = ancho
        c.height = alto
        const g = c.getContext('2d')
        const img = g.createImageData(ancho, alto)
        for (let i = 0; i < img.data.length; i++) img.data[i] = (i + 1) % 4 === 0 ? 255 : Math.random() * 255
        g.putImageData(img, 0, 0)
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.95))
        const b = new Uint8Array(await blob.arrayBuffer())
        let s = ''
        for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
        return btoa(s)
      },
      [ancho, alto],
    )
  for (const nombre of ['lado-izquierdo.jpg', 'frente.jpg', 'salida.jpg', 'suelta.jpg']) {
    writeFileSync(join(fotos, nombre), Buffer.from(await hacer(2400, 1800), 'base64'))
  }
  await p.context().close()
}

const sello = Date.now().toString().slice(-6)
const placa = `F${sello.slice(-2)}-${sello.slice(0, 3)}`
const placaGuardada = placa.replace('-', '').toUpperCase()

/** Espera a que no quede ninguna foto «subiendo…» en la ventana. */
async function esperarSubidas(pagina) {
  await pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })
}

// ------------------------------------------- 1. Requerimientos: menú y gasto por código
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos)
  const enlaces = await pagina.locator('nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  comprobar(enlaces.includes('/requerimientos/gasto-por-codigo'), 'el menú trae «Gasto por código interno»')
  for (const ruta of ['/almacen/kardex', '/costos/gastos-generales', '/compras/valorizacion']) {
    comprobar(!enlaces.includes(ruta), `el menú ya no trae ${ruta}`)
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    comprobar(new URL(pagina.url()).pathname === '/sin-permiso', `${ruta} por su dirección lleva a «Sin permiso»`)
  }

  await pagina.goto(`${BASE}/requerimientos/gasto-por-codigo`, { waitUntil: 'networkidle' })
  const fila = pagina.locator(`a[data-codigo="${CODIGO}"]`)
  const texto = limpio(await fila.innerText().catch(() => ''))
  comprobar(texto.includes('44.00') && texto.includes('55.50') && /1 salida sin precio/.test(texto),
    `la lista trae el código con S/ 44.00 en materiales, la compra aparte y la salida sin precio: «${texto.slice(0, 200)}»`)
  await pagina.screenshot({ path: join(CAPTURAS, 'gasto-por-codigo.png'), fullPage: true })

  await fila.click()
  await pagina.waitForURL(/gasto-por-codigo\/detalle/)
  await pagina.waitForLoadState('networkidle')
  const detalle = limpio(await pagina.locator('main').innerText())
  comprobar(detalle.includes('Soldadura MIG 0.9 mm (banco)') && detalle.includes('Disco de corte') && detalle.includes('Sin precio'),
    'el detalle trae cada salida del almacén, con la que no tiene precio marcada')
  comprobar(/Compras con este código/.test(detalle) && detalle.includes('55.50') && /proveedor del banco/i.test(detalle),
    'y la orden de compra con su proveedor, aparte')
  comprobar(!detalle.includes('Mano de obra') && !detalle.includes('Personal'), 'sin la tabla de mano de obra ni la del personal')
  await pagina.screenshot({ path: join(CAPTURAS, 'gasto-por-codigo-detalle.png'), fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola en el gasto por código ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------- 2 y 3. Vehículo con fotos, en el celular
let registroId = null
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos, CELULAR)
  await pagina.goto(`${BASE}/vehiculos`, { waitUntil: 'networkidle' })

  // Una ventana que se cierra sin registrar no deja la foto suelta.
  const sueltasAntes = Number((await consulta(`select count(*) from storage.objects where bucket_id = 'fotos-vehiculos'`))[0].count)
  await pagina.getByRole('button', { name: 'Registrar ingreso' }).click()
  let v = pagina.locator('[role="dialog"]')
  await v.locator('input[type="file"]:not([capture])').setInputFiles(join(fotos, 'suelta.jpg'))
  await esperarSubidas(pagina)
  const conSuelta = Number((await consulta(`select count(*) from storage.objects where bucket_id = 'fotos-vehiculos'`))[0].count)
  comprobar(conSuelta === sueltasAntes + 1, 'la foto sube a Storage apenas se elige')
  await pagina.keyboard.press('Escape')
  await v.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  await pagina.waitForTimeout(1500)
  const despuesDeCerrar = Number((await consulta(`select count(*) from storage.objects where bucket_id = 'fotos-vehiculos'`))[0].count)
  comprobar(despuesDeCerrar === sueltasAntes, `al cerrar sin registrar, la foto se retira (${conSuelta} → ${despuesDeCerrar})`)

  await pagina.getByRole('button', { name: 'Registrar ingreso' }).click()
  v = pagina.locator('[role="dialog"]')
  await v.locator('#veh-placa').fill(placa.toLowerCase())
  await v.locator('#veh-codigo').fill(CODIGO)
  await v.locator('#veh-unidad').fill('Tolva 18 m3 Volvo FMX')
  await v.locator('#veh-empresa').fill('EMPRESA DE PRUEBA DEL BANCO')
  await v.locator('#veh-motivo').selectOption('MANTENIMIENTO')
  await v.locator('#veh-obs').fill('Ingresa con llanta baja')
  const registrar = v.getByRole('button', { name: 'Registrar ingreso' })
  comprobar(await registrar.isDisabled(), 'sin fotos, «Registrar ingreso» no se deja tocar')
  comprobar((await v.innerText()).includes('Toma al menos una foto del vehículo al entrar'), 'y dice por qué')

  await v.locator('input[type="file"]:not([capture])').setInputFiles([join(fotos, 'lado-izquierdo.jpg'), join(fotos, 'frente.jpg')])
  await esperarSubidas(pagina)
  comprobar(!(await registrar.isDisabled()), 'con las dos fotos arriba, se habilita')
  await pagina.screenshot({ path: join(CAPTURAS, 'vehiculo-ingreso-celular.png'), fullPage: true })
  await registrar.click()
  await registrar.click({ timeout: 500 }).catch(() => {})
  await pagina.locator('[role="status"]').waitFor({ timeout: 20000 })
  const aviso = limpio(await pagina.locator('[role="status"]').innerText())
  comprobar(aviso.includes('con 2 fotos'), `aviso: «${aviso}»`)

  const [reg] = await consulta(
    `select v.id, count(f.*) filter (where f.momento = 'INGRESO') as ingreso,
            bool_and(f.mime_type = 'image/jpeg' and f.tamano_bytes < 5242880) as achicadas
       from public.registro_vehiculos v left join public.registro_vehiculo_fotos f on f.registro_id = v.id
      where v.placa = $1 group by v.id`,
    [placaGuardada],
  )
  registroId = reg?.id ?? null
  comprobar(reg && Number(reg.ingreso) === 2 && reg.achicadas, `en la base: un ingreso de ${placaGuardada} con 2 fotos JPEG achicadas`)

  const filaV = pagina.locator('tbody tr', { hasText: placaGuardada })
  await filaV.first().waitFor({ timeout: 20000 }).catch(() => {})
  comprobar(limpio(await filaV.innerText()).includes('2 al entrar'), 'la fila dice «2 al entrar»')

  await pagina.goto(`${BASE}/vehiculos/${registroId}`, { waitUntil: 'networkidle' })
  const imagenes = pagina.locator('main img')
  await imagenes.first().waitFor({ timeout: 15000 }).catch(() => {})
  const cargadas = await imagenes.evaluateAll((is) => is.filter((i) => i.complete && i.naturalWidth > 0).length)
  comprobar(cargadas === 2, `el detalle muestra las 2 fotos del ingreso (${cargadas} cargadas)`)

  // La salida, desde el mismo detalle.
  await pagina.getByRole('button', { name: 'Marcar salida' }).click()
  const s = pagina.locator('[role="dialog"]')
  const salir = s.getByRole('button', { name: 'Registrar salida' })
  comprobar(await salir.isDisabled(), 'sin foto, «Registrar salida» no se deja tocar')
  await s.locator('textarea[name="observacion"]').fill('Sale reparado')
  await s.locator('input[type="file"]:not([capture])').setInputFiles(join(fotos, 'salida.jpg'))
  await esperarSubidas(pagina)
  await salir.click()
  await s.waitFor({ state: 'detached', timeout: 20000 })
  await pagina.waitForLoadState('networkidle')
  await pagina.reload({ waitUntil: 'networkidle' })
  const texto = limpio(await pagina.locator('main').innerText())
  comprobar(texto.includes('Al salir · 1 foto') && texto.includes('Sale reparado') && texto.includes('Salió'),
    'el detalle muestra la salida con su foto y su observación')
  const todas = await pagina.locator('main img').evaluateAll((is) => is.filter((i) => i.complete && i.naturalWidth > 0).length)
  comprobar(todas === 3, `tres fotos en el detalle: dos al entrar y una al salir (${todas})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'vehiculo-detalle-celular.png'), fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola en vehículos ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------- 4. Gerencia ve las fotos; Ventas no entra
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  await pagina.goto(`${BASE}/vehiculos/${registroId}`, { waitUntil: 'networkidle' })
  await pagina.locator('main img').first().waitFor({ timeout: 15000 }).catch(() => {})
  const cargadas = await pagina.locator('main img').evaluateAll((is) => is.filter((i) => i.complete && i.naturalWidth > 0).length)
  comprobar(cargadas === 3, `Gerencia ve las tres fotos del vehículo (${cargadas})`)
  comprobar((await pagina.getByRole('button', { name: 'Marcar salida' }).count()) === 0, 'sin botones para marcar')
  await pagina.goto(`${BASE}/requerimientos/gasto-por-codigo`, { waitUntil: 'networkidle' })
  comprobar(new URL(pagina.url()).pathname === '/sin-permiso', 'el gasto por código es de Requerimientos: Gerencia tiene el suyo en Códigos internos')
  comprobar(errores.length === 0, `sin errores de consola como Gerencia ${errores.join(' | ')}`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.ventas)
  for (const ruta of [`/vehiculos/${registroId}`, '/requerimientos/gasto-por-codigo']) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    comprobar(new URL(pagina.url()).pathname === '/sin-permiso', `Ventas no entra a ${ruta.replace(registroId ?? '', '…')}`)
  }
  await contexto.close()
}

await navegador.close()
await base.end()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} comprobación(es) fallaron.`)
  process.exit(1)
}
console.log('\nTodo bien: gasto por código y fotos del vehículo con clic real.')
