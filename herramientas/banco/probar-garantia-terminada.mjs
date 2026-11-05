/**
 * Recorre con clic real la salida del vehículo de garantía (migración
 * 20261021120000), con la cuenta de cada puesto (nunca ADMIN). DKS lo decidió
 * el 2026-10-21: «Administración la marca terminada cuando el taller avisa, y
 * con el visto de Tesorería el vehículo sale».
 *
 *   1. Requerimientos, en el celular: con el motivo «Garantía» la ventana del
 *      ingreso ofrece solo el código con su OT de garantía abierta, y muestra
 *      esa OT. El ingreso queda atado a ella; la salida queda apagada y dice que
 *      espera a Administración, sin hablar del avance del código.
 *   2. Gerencia abre la OT de garantía: dice que está por terminar, sin botón.
 *   3. Administración la da por terminada desde la OT, con una nota: la OT no
 *      cambia de estado y a Requerimientos le llega el aviso.
 *   4. Requerimientos ve la garantía terminada en la lista y en el detalle, y
 *      el detalle ya no dice que espera el avance.
 *
 * El visto de Tesorería y la salida los prueba la base en el check 416.
 *
 * Arma, como dueño de la base del banco, el código BANCO_GAR_26/43 en la unidad
 * F3P-772 y su OT de garantía 9443-AAAA aprobada. Si una vuelta anterior la dio
 * por terminada, quita esa marca (es la base local del banco).
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
const CODIGO = 'BANCO_GAR_26/43'
const CUENTAS = {
  requerimientos: 'requerimientos.local@metalwork.test',
  administracion: 'administracion.local@metalwork.test',
  gerencia: 'gerencia.local@metalwork.test',
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
const anio = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric' }).format(new Date())
const NUMERO = `9443-${anio}`
await consulta(`update public.unidades set codigo_interno = $1 where placa = 'F3P-772' and codigo_interno is null`, [CODIGO])
const [unidad] = await consulta(
  `select u.id, u.cliente_id, c.razon_social, (select o.sede_id from public.ordenes_trabajo o where o.unidad_id = u.id limit 1) as sede_id
     from public.unidades u join public.clientes c on c.id = u.cliente_id where u.codigo_interno = $1`,
  [CODIGO],
)
if (!unidad?.sede_id) throw new Error('El banco no tiene la unidad F3P-772 con su OT: rehaz la base con preparar.sh.')
let [orden] = await consulta(`select id, estado from public.ordenes_trabajo where numero = $1`, [NUMERO])
if (!orden) {
  ;[orden] = await consulta(
    `insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
     values ($1, $2, $3, $4, 'GARANTIA', 'NORMAL', 'Garantía del banco: compuerta que no cierra', 'APROBADA') returning id, estado`,
    [NUMERO, unidad.cliente_id, unidad.id, unidad.sede_id],
  )
}
await consulta(`delete from public.ot_garantia_terminada where orden_id = $1`, [orden.id])
// Si una vuelta anterior lo dejó en la planta, se anula ese ingreso (no se borra).
await consulta(
  `update public.registro_vehiculos set anulado_en = now(), anulado_por = ingreso_por, motivo_anulacion = 'Vuelta anterior del banco'
    where codigo_interno = $1 and salida_en is null and anulado_en is null`,
  [CODIGO],
)
const [req] = await consulta(`select id from public.usuarios where correo = $1`, [CUENTAS.requerimientos])
const [adm] = await consulta(`select id from public.usuarios where correo = $1`, [CUENTAS.administracion])

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
const fotos = join(CAPTURAS, 'fotos-garantia')
mkdirSync(fotos, { recursive: true })
{
  const p = await (await navegador.newContext()).newPage()
  const datos = await p.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 640
    c.height = 480
    const g = c.getContext('2d')
    g.fillStyle = '#a87'
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

let registroId = null

// ---------------------------------------- 1. Requerimientos, en el celular
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos, CELULAR)
  await pagina.goto(`${BASE}/vehiculos`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Registrar ingreso' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('#veh-motivo').selectOption('FABRICACION')
  await v.locator('#veh-codigo').click()
  await v.getByRole('listbox').getByRole('option').first().waitFor({ timeout: 10000 }).catch(() => {})
  // Las opciones de la lista de códigos, no las del motivo (que también son `option`).
  const deFabricacion = (await v.getByRole('listbox').getByRole('option').allInnerTexts()).map(limpio)
  await pagina.keyboard.press('Escape')
  await v.locator('#veh-motivo').selectOption('GARANTIA')
  const sinLista = limpio(await v.locator('#veh-codigo').innerText())
  let porGarantia = []
  if (!sinLista.includes('No hay códigos')) {
    await v.locator('#veh-codigo').click()
    await v.getByRole('listbox').getByRole('option').first().waitFor({ timeout: 10000 }).catch(() => {})
    porGarantia = (await v.getByRole('listbox').getByRole('option').allInnerTexts()).map(limpio)
  }
  const nuestro = porGarantia.find((o) => o.includes(CODIGO))
  comprobar(Boolean(nuestro) && nuestro.includes(NUMERO), `por garantía se ofrece el código con su OT de garantía («${nuestro}»)`)
  comprobar(porGarantia.length < deFabricacion.length,
    `y solo los que tienen OT de garantía abierta (${porGarantia.length} de los ${deFabricacion.length} de fabricación)`)
  await v.getByRole('option', { name: new RegExp(CODIGO.replace(/[/]/g, '\\/')) }).click()
  const resumen = limpio(await v.locator(`[data-codigo-elegido="${CODIGO}"]`).innerText())
  comprobar(resumen.includes(NUMERO), `el elegido muestra la OT de garantía: «${resumen}»`)
  await v.locator('#veh-obs').fill('Vuelve por la compuerta')
  await v.locator('input[type="file"]:not([capture])').setInputFiles(join(fotos, 'entra.jpg'))
  await pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })
  await v.getByRole('button', { name: 'Registrar ingreso' }).click()
  // La fila y el formulario tienen su región de estado montada y vacía: se espera la que dice algo.
  await pagina.locator('[role="status"]').filter({ hasText: /\S/ }).first().waitFor({ timeout: 20000 })

  const [reg] = await consulta(
    `select id, orden_id from public.registro_vehiculos where codigo_interno = $1 and salida_en is null and anulado_en is null`,
    [CODIGO],
  )
  registroId = reg?.id ?? null
  comprobar(reg?.orden_id === orden.id, 'en la base: el ingreso queda atado a la OT de garantía')

  await pagina.reload({ waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: CODIGO })
  await fila.first().waitFor({ timeout: 15000 }).catch(() => {})
  comprobar(await fila.getByRole('button', { name: 'Marcar salida' }).isDisabled(), 'en la lista, «Marcar salida» queda apagado')
  const porque = limpio(await fila.locator('[data-bloqueo-salida]').innerText().catch(() => ''))
  comprobar(porque.includes('Administración todavía no da por terminada la garantía') && !porque.includes('%'),
    `y dice que espera a Administración, sin hablar del avance: «${porque}»`)
  const situacion = limpio(await fila.locator('[data-garantia-salida]:visible').first().innerText().catch(() => ''))
  comprobar(situacion.includes(NUMERO) && situacion.includes('por terminar') && (await fila.locator('[data-avance-salida]').count()) === 0,
    `la fila muestra la garantía en vez del avance: «${situacion}»`)
  await pagina.screenshot({ path: join(CAPTURAS, 'garantia-1-lista-por-terminar.png'), fullPage: true })

  await pagina.goto(`${BASE}/vehiculos/${registroId}`, { waitUntil: 'networkidle' })
  const dato = limpio(await pagina.locator('[data-garantia-salida]').innerText().catch(() => ''))
  comprobar(dato.includes(NUMERO) && dato.includes('garantía por terminar'), `el detalle dice «${dato}»`)
  comprobar((await pagina.locator('[data-avance-salida]').count()) === 0, 'y no muestra el avance del código')
  comprobar(errores.length === 0, `Requerimientos sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ---------------------------------------- 2. Gerencia mira, sin botón
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  await pagina.goto(`${BASE}/ordenes/${orden.id}`, { waitUntil: 'networkidle' })
  const insignia = await pagina.locator('h1').getByText('Garantía por terminar', { exact: true }).count()
  comprobar(insignia === 1, 'el título lleva la insignia «Garantía por terminar» junto al estado')
  const aviso = limpio(await pagina.getByText('Garantía por terminar.').locator('..').innerText().catch(() => ''))
  comprobar(aviso.includes('Administración la da por terminada'), `Gerencia ve que la garantía está por terminar: «${aviso}»`)
  comprobar((await pagina.getByRole('button', { name: 'Dar por terminada la garantía' }).count()) === 0, 'y no tiene el botón')
  comprobar(errores.length === 0, `Gerencia sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ---------------------------------------- 3. Administración la da por terminada
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.administracion)
  await pagina.goto(`${BASE}/ordenes/${orden.id}`, { waitUntil: 'networkidle' })
  const boton = pagina.getByRole('button', { name: 'Dar por terminada la garantía' })
  comprobar((await boton.count()) === 1, 'Administración ve el botón «Dar por terminada la garantía»')
  await pagina.screenshot({ path: join(CAPTURAS, 'garantia-2-ot-por-terminar.png'), fullPage: true })
  await boton.click()
  const v = pagina.locator('[role="dialog"]')
  comprobar(limpio(await v.innerText()).includes('La OT no cambia de estado'), 'la ventana dice qué pasa antes de confirmar')
  await v.locator('#nota_garantia').fill('  Compuerta   cambiada, avisó Maestranza ')
  // Tres toques: entra una sola vez.
  const confirmar = v.getByRole('button', { name: 'Dar por terminada', exact: true })
  await Promise.all([1, 2, 3].map(() => confirmar.click({ force: true, timeout: 2000 }).catch(() => {})))
  await pagina.getByText('Garantía terminada', { exact: false }).first().waitFor({ timeout: 20000 })
  const hecho = limpio(await pagina.locator('p[role="status"]', { hasText: 'Garantía terminada' }).innerText().catch(() => ''))
  comprobar(hecho.includes('Compuerta cambiada, avisó Maestranza') && hecho.includes('sale con el visto de Tesorería'), `la OT dice «${hecho}»`)
  comprobar((await pagina.getByRole('button', { name: 'Dar por terminada la garantía' }).count()) === 0, 'y el botón ya no está')
  comprobar((await pagina.locator('h1').getByText('Garantía terminada', { exact: true }).count()) === 1, 'y el título dice «Garantía terminada»')
  await pagina.screenshot({ path: join(CAPTURAS, 'garantia-3-ot-terminada.png'), fullPage: true })

  const marcas = await consulta(`select terminada_por, nota from public.ot_garantia_terminada where orden_id = $1`, [orden.id])
  comprobar(marcas.length === 1 && marcas[0].terminada_por === adm.id && marcas[0].nota === 'Compuerta cambiada, avisó Maestranza',
    `en la base: una marca, de Administración, con su nota (${marcas.length})`)
  const [despues] = await consulta(`select estado from public.ordenes_trabajo where id = $1`, [orden.id])
  comprobar(despues.estado === orden.estado, `la OT sigue ${despues.estado}`)
  const avisos = await consulta(
    `select ruta from public.notificaciones where usuario_id = $1 and origen_id = $2 and titulo = $3`,
    [req.id, registroId, `La garantía de la OT ${NUMERO} está terminada`],
  )
  comprobar(avisos.length === 1 && avisos[0].ruta === `/vehiculos/${registroId}`, 'a Requerimientos le llega el aviso, con el enlace al vehículo')
  comprobar(errores.length === 0, `Administración sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ---------------------------------------- 4. Requerimientos la ve terminada
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos, CELULAR)
  await pagina.goto(`${BASE}/vehiculos`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('tbody tr', { hasText: CODIGO })
  await fila.first().waitFor({ timeout: 15000 }).catch(() => {})
  const situacion = limpio(await fila.locator('[data-garantia-salida]:visible').first().innerText().catch(() => ''))
  comprobar(situacion.includes('terminada, falta Tesorería'), `la fila dice «${situacion}»`)
  comprobar(await fila.getByRole('button', { name: 'Marcar salida' }).isDisabled(), 'sin el visto de Tesorería sigue sin salir')
  await pagina.goto(`${BASE}/vehiculos/${registroId}`, { waitUntil: 'networkidle' })
  const dato = limpio(await pagina.locator('[data-garantia-salida]').innerText().catch(() => ''))
  comprobar(dato.includes('garantía terminada'), `el detalle dice «${dato}»`)
  const revision = limpio(await pagina.locator('#revision-salida').innerText().catch(() => ''))
  comprobar(!revision.includes('100 %') && !revision.includes('dé por terminada'),
    `la revisión de Tesorería ya no espera el avance ni la garantía: «${revision.slice(0, 160)}»`)
  await pagina.screenshot({ path: join(CAPTURAS, 'garantia-4-detalle-terminada.png'), fullPage: true })
  comprobar(errores.length === 0, `Requerimientos sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallan:\n- ${fallas.join('\n- ')}`)
process.exit(fallas.length === 0 ? 0 : 1)
