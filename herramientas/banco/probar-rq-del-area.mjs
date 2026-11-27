/**
 * Clic real sobre el RQ del área (gasto operativo), con la cuenta de cada
 * puesto (nunca ADMIN). DKS, 2026-11-27: Producción, Maestranza y Acabados
 * piden herramientas e insumos para el área, y ese costo va como gasto
 * operativo, no a una OT.
 *
 *   1. El supervisor de Producción abre «Nuevo requerimiento»: «Es para»
 *      muestra las dos opciones a la vista, «Para una unidad» y «Para
 *      Producción (gasto operativo)». Con la unidad pide el código interno;
 *      con el área no lo pide.
 *   2. Registra el del área con un insumo del catálogo que hay en el almacén:
 *      en la base queda de operación, de Producción, con PLANTA, marcado
 *      `para_el_area` y a su nombre. Su tarjeta dice «Gasto operativo».
 *   3. Almacén lo recibe en Atención con la misma insignia y registra la
 *      salida desde el enlace: la ventana dice que va a PLANTA como gasto
 *      operativo, no ofrece elegir vehículo ni código, y en la base la salida
 *      queda con PLANTA, sin unidad ni OT.
 *   4. Gerencia lo consulta con la insignia y sin «Nuevo requerimiento».
 *
 * Capturas a 390 y 1440 en CAPTURAS/rq-del-area.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE, CAPTURAS,
 * BANCO_CHROMIUM.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const cuenta = (puesto) => `${puesto}.local@metalwork.test`
const CUENTAS = { produccion: cuenta('sup.prd'), almacen: cuenta('almacen'), gerencia: cuenta('gerencia') }
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
const carpeta = join(CAPTURAS, 'rq-del-area')
mkdirSync(carpeta, { recursive: true })
const foto = join(carpeta, 'foto-salida.jpg')
writeFileSync(foto, Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'))

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
const quieta = (pagina) => pagina.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
async function ir(pagina, url) {
  await pagina.goto(url, { waitUntil: 'load' })
  await quieta(pagina)
}
/** Una captura que no sale es una falla, no un silencio. */
async function capturar(objetivo, nombre) {
  try {
    await objetivo.screenshot({ path: join(carpeta, nombre) })
  } catch (e) {
    comprobar(false, `captura ${nombre}: ${e.message.split('\n')[0]}`)
  }
}

// Un insumo del catálogo con existencia: el que el área pediría y Almacén tiene.
const [insumo] = await consulta(
  `select v.material_id::text as id, v.codigo, v.descripcion, v.disponible::float as disponible
     from public.v_existencias_materiales v join public.materiales m on m.id = v.material_id
    where m.activo and not m.unidad_pendiente and v.disponible >= 2 and v.codigo not like 'AUD-%' and v.codigo not like 'CHK%'
    order by v.disponible desc, v.descripcion limit 1`,
)
if (!insumo) throw new Error('No hay en el banco un insumo con existencia para la salida.')
const [supervisor] = await consulta(`select id::text from public.usuarios where correo = $1`, [CUENTAS.produccion])

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, ancho = 1440) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: 900 } })
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

const sello = Date.now().toString().slice(-6)
let numero = ''
let rqId = ''

// ------------------------------------------------ 1 y 2. El supervisor de Producción
for (const ancho of [390, 1440]) {
  const { pagina, contexto, errores } = await entrar(CUENTAS.produccion, ancho)
  await ir(pagina, `${BASE}/requerimientos`)
  await pagina.getByRole('button', { name: 'Nuevo requerimiento', exact: true }).click()
  const ventana = pagina.locator('[role="dialog"]')
  const radios = ventana.locator('input[name="rq-destino"]')
  await radios.first().waitFor({ timeout: 15000 })
  const textos = []
  for (let i = 0; i < (await radios.count()); i++) {
    textos.push(limpio(await radios.nth(i).locator('xpath=..').locator('span.font-medium').innerText()))
  }
  comprobar(textos.join(' | ') === 'Para una unidad | Para Producción (gasto operativo)',
    `«Es para» muestra las dos opciones (${ancho}): ${textos.join(' | ')}`)
  comprobar(await ventana.locator('input[name="rq-destino"][value="UNIDAD"]').isChecked(), `sale marcada «Para una unidad» (${ancho})`)
  comprobar((await ventana.locator('#rq-codigo').count()) === 1, `con la unidad pide el código interno (${ancho})`)
  await ventana.locator('input[name="rq-destino"][value="AREA"]').check()
  comprobar((await ventana.locator('#rq-codigo').count()) === 0, `con el área ya no pide el código (${ancho})`)
  comprobar(limpio(await ventana.innerText()).includes('No se carga a ninguna OT'), `la ayuda dice que no se carga a ninguna OT (${ancho})`)
  await capturar(pagina, `formulario-produccion-${ancho}.png`)

  if (ancho === 1440) {
    await ventana.locator('#rq-justificacion').fill(`Para el área de Producción: los del banco se gastaron (${sello}).`)
    await ventana.locator('[id^="rq-mat-"]').first().click()
    await pagina.keyboard.type(insumo.codigo)
    await pagina.getByRole('option').filter({ hasText: insumo.codigo }).first().click()
    await ventana.locator('[id^="rq-cant-"]').first().fill('2')
    const enviar = ventana.getByRole('button', { name: 'Registrar y mandar a Almacén' })
    await enviar.click()
    // Un segundo toque mientras envía no debe registrar otro.
    await enviar.click({ timeout: 800 }).catch(() => {})
    await ventana.waitFor({ state: 'detached', timeout: 20000 })
    const aviso = pagina.locator('p[role="status"]', { hasText: /RQ-\d{4}-\d{4}/ }).first()
    await aviso.waitFor({ timeout: 20000 })
    const texto = limpio(await aviso.innerText())
    numero = (texto.match(/RQ-\d{4}-\d{4}/) ?? [''])[0]
    comprobar(Boolean(numero), `registrado: «${texto}»`)

    const filas = await consulta(
      `select r.id::text, r.tipo, r.codigo_interno, r.para_el_area, r.creado_por::text, a.nombre as area,
              (select count(*)::int from public.requerimiento_lineas l where l.requerimiento_id = r.id) as lineas
         from public.requerimientos r join public.areas a on a.id = r.area_id
        where r.justificacion like $1`,
      [`%(${sello}).`],
    )
    const [fila] = filas
    rqId = fila?.id ?? ''
    comprobar(filas.length === 1, `entró una sola vez aunque se tocó dos veces (${filas.length})`)
    comprobar(fila?.tipo === 'OPERACION' && fila?.codigo_interno === 'PLANTA' && fila?.area === 'Producción' && fila?.para_el_area === true
      && fila?.creado_por === supervisor?.id && fila?.lineas === 1,
      `en la base: de operación, de Producción, con PLANTA, marcado y a nombre del supervisor (${JSON.stringify(fila)})`)
  }
  comprobar(errores.length === 0, `sin errores de consola como Producción (${ancho}) ${errores.join(' | ')}`)
  await contexto.close()
}
if (!rqId) throw new Error('No se registró el RQ del área: lo demás no tiene qué mirar.')

// La tarjeta, con la cuenta de Producción, a 390 y 1440.
for (const ancho of [390, 1440]) {
  const { pagina, contexto } = await entrar(CUENTAS.produccion, ancho)
  await ir(pagina, `${BASE}/requerimientos`)
  const tarjeta = pagina.locator(`[data-rq="${numero}"]`)
  await tarjeta.waitFor({ timeout: 15000 })
  comprobar((await tarjeta.locator('[data-gasto-operativo]').count()) === 1, `su tarjeta dice «Gasto operativo» (${ancho})`)
  await capturar(tarjeta, `tarjeta-produccion-${ancho}.png`)
  await contexto.close()
}

// ------------------------------------------------ 3. Almacén lo atiende y lo saca
for (const ancho of [390, 1440]) {
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen, ancho)
  if (ancho === 1440) {
    await ir(pagina, `${BASE}/requerimientos/atencion`)
    const fila = pagina.locator('[data-rq], tbody tr', { hasText: numero }).first()
    await fila.waitFor({ timeout: 15000 })
    comprobar((await fila.locator('[data-gasto-operativo]').count()) === 1, `en Atención, el ${numero} dice «Gasto operativo»`)
    await capturar(fila, 'atencion-almacen-1440.png')
  }

  await ir(pagina, `${BASE}/almacen/kardex?rq=${rqId}`)
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.waitFor({ timeout: 60000 })
  const dice = ventana.locator('[data-salida-gasto-operativo]')
  await dice.waitFor({ timeout: 15000 })
  comprobar(limpio(await dice.innerText()).startsWith('Va a PLANTA: es gasto operativo de Producción'),
    `la salida dice que va a PLANTA como gasto operativo (${ancho}): «${limpio(await dice.innerText())}»`)
  comprobar((await ventana.getByText('¿A qué unidad va?').count()) === 0 && (await ventana.locator('#sal-codigo').count()) === 0,
    `y no ofrece elegir vehículo ni código (${ancho})`)
  await capturar(ventana, `salida-almacen-${ancho}.png`)

  if (ancho === 1440) {
    await ventana.locator('#sal-motivo').fill(`Vale del banco ${sello}, para el área`)
    await ventana.locator('#sal-recibe').fill('Supervisor de Producción')
    await ventana.locator('#sal-foto').setInputFiles(foto)
    await ventana.getByRole('button', { name: 'Confirmar salida' }).click()
    await Promise.race([ventana.waitFor({ state: 'hidden', timeout: 60000 }), ventana.locator('[role="alert"]').first().waitFor({ timeout: 60000 })])
    const alerta = limpio((await ventana.locator('[role="alert"]').allTextContents().catch(() => [])).join(' '))
    const salidas = await consulta(
      `select m.codigo_interno, m.orden_id, m.unidad_id, m.cantidad::float as cantidad
         from public.movimientos_materiales m join public.requerimiento_lineas l on l.id = m.requerimiento_linea_id
        where l.requerimiento_id = $1 and m.tipo = 'SALIDA'`,
      [rqId],
    )
    const [s] = salidas
    comprobar(!alerta && salidas.length === 1 && s.codigo_interno === 'PLANTA' && s.orden_id === null && s.unidad_id === null && s.cantidad === 2,
      `la salida queda en PLANTA, sin unidad ni OT: ${JSON.stringify(salidas)} ${alerta}`)
  }
  comprobar(errores.length === 0, `sin errores de consola como Almacén (${ancho}) ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 4. Gerencia consulta
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  await ir(pagina, `${BASE}/requerimientos?tipo=todos`)
  const tarjeta = pagina.locator(`[data-rq="${numero}"]`)
  await tarjeta.waitFor({ timeout: 15000 })
  comprobar((await tarjeta.locator('[data-gasto-operativo]').count()) === 1, 'Gerencia lo ve con «Gasto operativo»')
  comprobar((await pagina.getByRole('button', { name: 'Nuevo requerimiento', exact: true }).count()) === 0, 'Gerencia no registra RQ')
  comprobar(errores.length === 0, `sin errores de consola como Gerencia ${errores.join(' | ')}`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} fallas.` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
