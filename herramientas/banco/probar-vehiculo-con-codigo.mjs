/**
 * Recorre con clic real lo que DKS pidió el 2026-10-20 para el ingreso y la
 * salida de vehículos (migración 20261020166000), con la cuenta de cada puesto
 * (nunca ADMIN):
 *
 *   1. Requerimientos, en el celular: el trabajo del taller (fabricación,
 *      mantenimiento, garantía, arenado) entra eligiendo un código interno que
 *      ya tiene OT; el cliente, el vehículo y la placa se cargan solos. El código
 *      sin OT no se ofrece, y el que ya entró sale apagado.
 *   2. La salida de ese vehículo queda apagada y dice por qué (el avance del
 *      código no llega al 100 %), y el detalle no deja pedir la revisión de
 *      Tesorería todavía.
 *   3. La cochera no es trabajo: entra con la placa a mano y sale cuando sea.
 *   4. Gerencia ve el avance en el detalle, sin botones; Ventas no entra.
 *
 * El desbloqueo con el 100 % y Tesorería lo prueba la base en el check 405: el
 * banco no tiene un código con todo su avance reportado.
 *
 * Arma, como dueño de la base del banco, dos códigos: BANCO_VEH_26/41 en la
 * unidad V2G-841 (con su OT de la demostración) y BANCO_SINOT_26/42 en la
 * B7T-329 (sin OT).
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
const CODIGO = 'BANCO_VEH_26/41'
const SIN_OT = 'BANCO_SINOT_26/42'
const CUENTAS = {
  requerimientos: 'requerimientos.local@metalwork.test',
  gerencia: 'gerencia.local@metalwork.test',
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

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()

// ------------------------------------------------------------ armazón
await consulta(`update public.unidades set codigo_interno = $1 where placa = 'V2G-841' and codigo_interno is null`, [CODIGO])
await consulta(`update public.unidades set codigo_interno = $1 where placa = 'B7T-329' and codigo_interno is null`, [SIN_OT])
const [unidad] = await consulta(
  `select u.id, o.id as orden_id, o.numero, c.razon_social
     from public.unidades u join public.ordenes_trabajo o on o.unidad_id = u.id and o.estado <> 'ANULADA'
     join public.clientes c on c.id = u.cliente_id
    where u.codigo_interno = $1 order by o.creado_en desc limit 1`,
  [CODIGO],
)
if (!unidad) throw new Error(`El banco no tiene la unidad V2G-841 con su OT: rehaz la base con preparar.sh.`)
// Si una vuelta anterior lo dejó en la planta, se anula ese ingreso (no se borra).
await consulta(
  `update public.registro_vehiculos set anulado_en = now(), motivo_anulacion = 'Vuelta anterior del banco'
    where codigo_interno = $1 and salida_en is null and anulado_en is null`,
  [CODIGO],
)

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

// Una foto chica basta: aquí no se prueba el achicado.
const fotos = join(CAPTURAS, 'fotos-vehiculo-codigo')
mkdirSync(fotos, { recursive: true })
{
  const p = await (await navegador.newContext()).newPage()
  const datos = await p.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 640
    c.height = 480
    const g = c.getContext('2d')
    g.fillStyle = '#7a8'
    g.fillRect(0, 0, 640, 480)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
    const b = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return btoa(s)
  })
  writeFileSync(join(fotos, 'entra.jpg'), Buffer.from(datos, 'base64'))
  await p.context().close()
}
async function esperarSubidas(pagina) {
  await pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })
}

const sello = Date.now().toString().slice(-6)
const placaCochera = `K${sello.slice(-2)}${sello.slice(0, 3)}`
let registroId = null

// ---------------------------------------- 1 y 2. Requerimientos, en el celular
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos, CELULAR)
  await pagina.goto(`${BASE}/vehiculos`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Registrar ingreso' }).click()
  let v = pagina.locator('[role="dialog"]')
  comprobar((await v.locator('#veh-placa').count()) === 0, 'antes del motivo no hay campos que llenar')
  await v.locator('#veh-motivo').selectOption('FABRICACION')
  const opciones = await v.locator('#veh-codigo option').evaluateAll((os) => os.map((o) => ({ valor: o.value, texto: o.textContent, apagada: o.disabled })))
  const conOt = opciones.find((o) => o.valor === CODIGO)
  comprobar(Boolean(conOt) && !conOt.apagada && conOt.texto.includes(unidad.numero), `para fabricación se elige el código, con su OT ${unidad.numero}`)
  comprobar(!opciones.some((o) => o.valor === SIN_OT), 'el código sin OT no se ofrece')
  comprobar((await v.locator('#veh-unidad').count()) === 0 && (await v.locator('#veh-empresa').count()) === 0, 'el vehículo y la empresa no se escriben a mano')

  await v.locator('#veh-codigo').selectOption(CODIGO)
  const resumen = limpio(await v.locator(`[data-codigo-elegido="${CODIGO}"]`).innerText())
  comprobar(resumen.includes(unidad.razon_social) && resumen.includes(unidad.numero), `se carga el cliente y la OT: «${resumen}»`)
  comprobar((await v.locator('#veh-placa').inputValue()) === 'V2G-841', 'y la placa de la unidad')
  await v.locator('#veh-obs').fill('Entra para la tolva')
  await v.locator('input[type="file"]:not([capture])').setInputFiles(join(fotos, 'entra.jpg'))
  await esperarSubidas(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'vehiculo-ingreso-con-codigo.png'), fullPage: true })
  await v.getByRole('button', { name: 'Registrar ingreso' }).click()
  await pagina.locator('[role="status"]').waitFor({ timeout: 20000 })

  const [reg] = await consulta(
    `select id, unidad_id, orden_id, empresa, unidad, placa from public.registro_vehiculos
      where codigo_interno = $1 and salida_en is null and anulado_en is null`,
    [CODIGO],
  )
  registroId = reg?.id ?? null
  comprobar(reg?.unidad_id === unidad.id && reg?.orden_id === unidad.orden_id && reg?.empresa === unidad.razon_social,
    'en la base: el ingreso queda atado a la unidad y a su OT, con el cliente')

  await pagina.reload({ waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: CODIGO })
  await fila.first().waitFor({ timeout: 15000 }).catch(() => {})
  const salida = fila.getByRole('button', { name: 'Marcar salida' })
  comprobar(await salida.isDisabled(), 'en la lista, «Marcar salida» queda apagado')
  const porque = limpio(await fila.locator('[data-bloqueo-salida]').innerText().catch(() => ''))
  comprobar(porque.includes('100 %'), `y dice por qué: «${porque}»`)
  comprobar((await fila.locator('[data-avance-salida]').count()) === 1, 'la fila muestra el avance del código')

  // El mismo código no entra otra vez mientras está en la planta.
  await pagina.getByRole('button', { name: 'Registrar ingreso' }).click()
  v = pagina.locator('[role="dialog"]')
  await v.locator('#veh-motivo').selectOption('MANTENIMIENTO')
  const ya = await v.locator(`#veh-codigo option[value="${CODIGO}"]`).evaluate((o) => ({ apagada: o.disabled, texto: o.textContent }))
  comprobar(ya.apagada && ya.texto.includes('ya está en la planta'), 'el código que ya entró sale apagado, «ya está en la planta»')

  // 3. La cochera entra con la placa a mano.
  await v.locator('#veh-motivo').selectOption('COCHERA')
  await v.locator('#veh-placa').fill(placaCochera)
  await v.locator('#veh-unidad').fill('Camioneta del cliente')
  await v.locator('#veh-empresa').fill('EMPRESA DEL BANCO')
  await v.locator('input[type="file"]:not([capture])').setInputFiles(join(fotos, 'entra.jpg'))
  await esperarSubidas(pagina)
  await v.getByRole('button', { name: 'Registrar ingreso' }).click()
  await pagina.locator('[role="status"]').waitFor({ timeout: 20000 })
  await pagina.reload({ waitUntil: 'networkidle' })
  const filaCochera = pagina.locator('tbody tr', { hasText: placaCochera })
  await filaCochera.first().waitFor({ timeout: 15000 }).catch(() => {})
  comprobar(!(await filaCochera.getByRole('button', { name: 'Marcar salida' }).isDisabled()), 'la cochera sale cuando sea: su botón está prendido')
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `la lista no se desborda a lo ancho en el celular (${ancho} px)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'vehiculos-lista-salida-bloqueada.png'), fullPage: true })

  // El detalle: el avance y lo que falta, sin el botón para pedir la revisión.
  await pagina.goto(`${BASE}/vehiculos/${registroId}`, { waitUntil: 'networkidle' })
  const detalle = limpio(await pagina.locator('main').innerText())
  comprobar(detalle.includes('Avance del código') && detalle.includes('la salida se habilita con el 100 %'), 'el detalle muestra el avance y lo que falta')
  comprobar((await pagina.getByRole('button', { name: /Pedir revisión/i }).count()) === 0, 'y todavía no deja pedir la revisión de Tesorería')
  comprobar(await pagina.getByRole('button', { name: 'Marcar salida' }).isDisabled(), 'ni marcar la salida')
  await pagina.screenshot({ path: join(CAPTURAS, 'vehiculo-detalle-salida-bloqueada.png'), fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola como Requerimientos ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------- 4. Gerencia mira; Ventas no entra
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  await pagina.goto(`${BASE}/vehiculos/${registroId}`, { waitUntil: 'networkidle' })
  const detalle = limpio(await pagina.locator('main').innerText())
  comprobar(detalle.includes('Avance del código'), 'Gerencia ve el avance del código en el detalle')
  comprobar((await pagina.getByRole('button', { name: 'Marcar salida' }).count()) === 0, 'sin botones para marcar')
  comprobar(errores.length === 0, `sin errores de consola como Gerencia ${errores.join(' | ')}`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.ventas)
  await pagina.goto(`${BASE}/vehiculos/${registroId}`, { waitUntil: 'networkidle' })
  comprobar(new URL(pagina.url()).pathname === '/sin-permiso', 'Ventas no entra al vehículo')
  await contexto.close()
}

await navegador.close()
await base.end()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} comprobación(es) fallaron.`)
  process.exit(1)
}
console.log('\nTodo bien: el vehículo entra con su código y su OT, y la salida espera el 100 %.')
