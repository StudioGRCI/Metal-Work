/**
 * Clic real sobre la devolución al proveedor (migración 20261022185000), con la
 * cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Un RQ de Maestranza pide 5 de un material sin stock; Logística los compra,
 *      el conductor los deja y Almacén los valida (sembrado por SQL, con la
 *      cuenta de cada uno).
 *   2. Almacén, en el kardex, devuelve 2 que llegaron rotos y dice que el
 *      proveedor los repone: la base anota la devolución y la OC espera 2.
 *   3. En «Esperan reposición» recibe 1 que llegó.
 *   4. Logística, en el teléfono, ve la devolución en Órdenes de compra y dice
 *      que el que falta ya no viene: el RQ se parte y el nuevo insumo sale en
 *      su lista «por comprar», con «Se compra otra vez».
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * CAPTURAS y el correo de cada cuenta si no es la `<puesto>.local@metalwork.test`
 * que siembra `preparar.sh`.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = join(process.env.CAPTURAS ?? '/tmp/banco-capturas', 'devolucion-proveedor')
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(
  ['requerimientos', 'almacen', 'logistica', 'gerencia', 'conductor', 'contabilidad'].map((p) => [p, cuenta(p)]),
)
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

// ---------------------------------------------------------------- siembra
const SUFIJO = String(100000 + (Date.now() % 900000))
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)
async function como(puesto) {
  const sub = ids[CUENTAS[puesto]]
  await consulta(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                         set_config('request.jwt.claims', $2, false)`, [sub, JSON.stringify({ sub, role: 'authenticated' })])
}
async function rucNuevo() {
  for (;;) {
    const prefijo = `20${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    const [fila] = await consulta(
      `select n from (select $1 || d as n from generate_series(0, 9) d) x
        where public.ruc_es_valido(n) and not exists (select 1 from proveedores p where p.numero_documento = n) limit 1`,
      [prefijo],
    )
    if (fila) return fila.n
  }
}
const PROVEEDOR = `DISCOS DEVOLUCIÓN ${SUFIJO} S.A.C.`
const [{ id: proveedor }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. de prueba 426, Trujillo', '999 000 426') returning id`,
  [await rucNuevo(), PROVEEDOR],
)
const MATERIAL = `Platina banco ${SUFIJO}`
const [{ id: material }] = await consulta(
  `insert into materiales (codigo, descripcion, categoria_id, unidad_medida_id)
   values ($1, $2, (select id from categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1),
           (select id from unidades_medida where codigo = 'M')) returning id`,
  [`BAN426-${SUFIJO}`, MATERIAL],
)
const [{ rq, oc, ing }] = await consulta(`select gen_random_uuid() as rq, gen_random_uuid() as oc, gen_random_uuid() as ing`)
const [{ id: areaMtz }] = await consulta(`select id from areas where codigo = 'MTZ'`)
const codigoUnidad = `BAN426_${SUFIJO}`
await consulta(`insert into unidades (placa, tipo_vehiculo, marca, codigo_interno, activo) values ($1, 'CAMION', 'Volvo', $2, true)`,
  [`B${SUFIJO.slice(0, 2)}-${SUFIJO.slice(2, 5)}`, codigoUnidad])
await como('requerimientos')
await consulta(`select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Discos para el banco de la devolución', null, $4::jsonb)`,
  [rq, areaMtz, codigoUnidad, JSON.stringify([{ material_id: material, cantidad: 8.5 }])])
await como('almacen')
await consulta(`select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 0}]'::jsonb, null)`, [rq])
const [{ id: linea, numero: rqNumero }] = await consulta(
  `select l.id, r.numero from requerimiento_lineas l join requerimientos r on r.id = l.requerimiento_id where r.id = $1`, [rq])
await como('logistica')
await consulta(`select public.emitir_compra_de_requerimientos($1, $2::jsonb, $3, $4, null, 'CONTADO', 0, 'PEN', true)`,
  [oc, JSON.stringify([{ material_id: material, cantidad: 8.5, precio: 9, insumos: [linea] }]), proveedor, `COT-DEV-${SUFIJO}`])
await como('gerencia')
await consulta(`select public.aprobar_compra($1) from ordenes_compra_materiales where id = $1 and aprobacion = 'POR_APROBAR'`, [oc])
await como('logistica')
await consulta(`select public.mandar_compra_a_recojo($1)`, [oc])
await consulta(`select public.programar_recojo($1, 25, null)`, [oc])
await como('conductor')
await consulta(`select public.marcar_compra_en_recojo($1)`, [oc])
await consulta(`select public.marcar_compra_recogida($1)`, [oc])
await consulta(`select public.marcar_compra_dejada_almacen($1)`, [oc])
await como('almacen')
const [{ id: pendiente }] = await consulta(`select id from ingresos_pendientes_almacen where orden_compra_id = $1`, [oc])
await consulta(`select public.validar_ingresos_compra($1, $2::jsonb, null)`, [oc, JSON.stringify([{ id: pendiente, movimiento_id: ing, cantidad: 8.5 }])])
const [{ numero: ocNumero, detalle }] = await consulta(
  `select c.numero, d.id as detalle from ordenes_compra_materiales c join orden_compra_material_detalles d on d.orden_compra_id = c.id where c.id = $1`, [oc])
console.log(`  siembra: ${rqNumero} pide 8.5 M de ${MATERIAL}; ${ocNumero} los compra y Almacén los valida`)

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    // El corte a propósito de la sección 5 deja su error de red en la consola.
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket') && !/ERR_CONNECTION_RESET|Failed to fetch/.test(m.text())) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
  pagina.on('response', (r) => {
    if (r.status() >= 400) errores.push(`${correo}: ${r.status()} ${r.request().method()} ${r.url().replace(/[?#].*$/, '')}`)
  })
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
const pendienteDeLaOc = async () =>
  Number((await consulta(`select cantidad_pendiente from v_orden_compra_material_pendiente where id = $1`, [detalle]))[0].cantidad_pendiente)

// ------------------------------------------------------- 2. Almacén devuelve 2 con reposición
{
  const { pagina, contexto } = await entrar(CUENTAS.almacen)
  await pagina.goto(`${BASE}/almacen/kardex`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Devolver al proveedor' }).click()
  const dialogo = pagina.getByRole('dialog')
  await dialogo.waitFor()
  const opcion = dialogo.locator('#dev-ingreso option', { hasText: MATERIAL })
  comprobar((await opcion.count()) === 1, `el ingreso de ${ocNumero} sale en la lista para devolver`)
  await dialogo.locator('#dev-ingreso').selectOption(ing)
  const detalleTexto = limpio(await dialogo.getByText(/se pueden devolver/).textContent())
  comprobar(detalleTexto.includes(PROVEEDOR) && detalleTexto.includes('se pueden devolver 8.5 M'), `elegido, dice el proveedor y cuánto se puede devolver («${detalleTexto}»)`)
  await dialogo.locator('#dev-cantidad').fill('9')
  await dialogo.locator('#dev-documento').fill(`GR-DEV-${SUFIJO}`)
  await dialogo.locator('#dev-motivo').fill('Un tramo llegó doblado (banco)')
  await dialogo.locator('#dev-repone').selectOption('si')
  await dialogo.getByRole('button', { name: 'Devolver' }).click()
  await pagina.waitForTimeout(800)
  comprobar((await consulta(`select count(*)::int as n from movimientos_materiales where devuelve_ingreso = $1`, [ing]))[0].n === 0,
    'con más de lo que se puede, el navegador no lo manda')
  await dialogo.locator('#dev-cantidad').fill('5.3')
  await dialogo.getByRole('button', { name: 'Devolver' }).click()
  await pagina.getByText('Devuelto al proveedor: la OC vuelve a esperar').waitFor({ timeout: 30000 }).catch(() => {})
  const [dev] = await consulta(`select id, cantidad::numeric as cantidad, se_repone, documento_referencia from movimientos_materiales where devuelve_ingreso = $1`, [ing])
  comprobar(dev && Number(dev.cantidad) === 5.3 && dev.se_repone === true, 'la base anota la devolución de 5.3 M, con reposición')
  comprobar((await pendienteDeLaOc()) === 5.3, 'la OC vuelve a esperar 5.3')
  await pagina.screenshot({ path: join(CAPTURAS, '1-devuelto.png'), fullPage: true })

  // ----------------------------------------------------- 3. Llega 1 de la reposición
  const tarjeta = pagina.locator('#por-reponer')
  const fila = tarjeta.locator('li', { hasText: MATERIAL })
  // La lista se repinta con el refresco que sigue al aviso: se espera la fila antes de leerla.
  await fila.filter({ hasText: 'Faltan 5.3' }).waitFor({ timeout: 15000 }).catch(() => {})
  const filaAntes = (await fila.count()) === 1 ? limpio(await fila.textContent()) : ''
  comprobar(filaAntes.includes('Faltan 5.3 M'), `«Esperan reposición» lo muestra: faltan 5.3 M de ${ocNumero} («${filaAntes}»)`)
  await fila.getByRole('button', { name: 'Llegó la reposición' }).click()
  const ventana = pagina.getByRole('dialog')
  await ventana.locator('#rep-cantidad').fill('2.1')
  await ventana.locator('#rep-documento').fill(`GR-REP-${SUFIJO}`)
  await ventana.getByRole('button', { name: 'Recibir' }).click()
  await pagina.getByText('La reposición entró al kardex.').waitFor({ timeout: 30000 }).catch(() => {})
  comprobar((await pendienteDeLaOc()) === 3.2, 'entran 2.1 de la reposición: la OC espera 3.2')
  comprobar(limpio(await tarjeta.textContent()).includes('La reposición entró al kardex.'), 'el aviso queda a la vista en la tarjeta')
  // El aviso sale con la respuesta; la lista se repinta con el refresco que le sigue.
  await tarjeta.locator('li', { hasText: MATERIAL }).filter({ hasText: 'Faltan 3.2' }).waitFor({ timeout: 15000 }).catch(() => {})
  const filaDespues = limpio(await tarjeta.locator('li', { hasText: MATERIAL }).textContent({ timeout: 5000 }).catch(() => ''))
  comprobar(filaDespues.includes('Faltan 3.2 M') && filaDespues.includes('ya llegaron 2.1'), `la fila dice lo que falta («${filaDespues}»)`)
  // Lo que falta se propone redondeado: en el navegador 5.3 − 2.1 da 3.1999999999999997.
  await tarjeta.locator('li', { hasText: MATERIAL }).getByRole('button', { name: 'Llegó la reposición' }).click()
  const propuesta = await pagina.getByRole('dialog').locator('#rep-cantidad').inputValue()
  comprobar(propuesta === '3.2', `«Llegó la reposición» propone lo que falta, 3.2 («${propuesta}»)`)
  await pagina.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click()
  // El kardex lo muestra como egreso.
  await pagina.goto(`${BASE}/almacen/kardex?material=${material}`, { waitUntil: 'networkidle' })
  const egreso = pagina.locator('tbody tr', { hasText: 'Devuelto al proveedor' })
  comprobar((await egreso.count()) >= 1, 'el kardex del material muestra «Devuelto al proveedor»')
  await pagina.screenshot({ path: join(CAPTURAS, '2-kardex.png'), fullPage: true })
  await contexto.close()
}

// Quien pidió el RQ ve que el proveedor lo repone, no que tiene que pedirlo otra vez.
{
  const { pagina, contexto } = await entrar(CUENTAS.requerimientos, { width: 390, height: 844 })
  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  const tarjetaRq = pagina.locator(`[data-rq="${rqNumero}"]`)
  const texto = limpio(await tarjetaRq.textContent().catch(() => ''))
  comprobar(texto.includes('El proveedor lo repone') && !texto.includes('pide el resto en un RQ nuevo'),
    `el RQ dice «El proveedor lo repone» y no pide otro RQ («${texto.slice(0, 160)}»)`)
  await contexto.close()
}

// ------------------------------------------------------- 4. Logística, en el teléfono: ya no viene
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica, { width: 390, height: 844 })
  await pagina.goto(`${BASE}/compras/ordenes`, { waitUntil: 'networkidle' })
  const fila = pagina.locator('li', { hasText: MATERIAL })
  comprobar((await fila.count()) === 1, 'Logística ve la devolución que espera reposición en Órdenes de compra')
  comprobar((await fila.getByRole('button', { name: 'Llegó la reposición' }).count()) === 0, 'Logística no recibe: ese botón es de Almacén')
  await fila.getByRole('button', { name: 'No lo repone' }).click()
  const ventana = pagina.getByRole('dialog')
  await ventana.locator('#yano-motivo').fill('corto')
  await ventana.getByRole('button', { name: 'No lo repone' }).click()
  await pagina.waitForTimeout(800)
  comprobar((await consulta(`select se_repone from movimientos_materiales where devuelve_ingreso = $1`, [ing]))[0].se_repone === true,
    'con un motivo corto no se manda')
  await ventana.locator('#yano-motivo').fill('El proveedor ya no tiene ese disco y emite nota de crédito')
  await ventana.getByRole('button', { name: 'No lo repone' }).click()
  await pagina.getByText(/Ya no se espera: lo que falte vuelve/).waitFor({ timeout: 30000 }).catch(() => {})
  const lineas = await consulta(`select item, cantidad::numeric as cantidad, orden_compra_id, recompra_de from requerimiento_lineas where requerimiento_id = $1 order by item`, [rq])
  comprobar(lineas.length === 2 && Number(lineas[0].cantidad) === 5.3 && Number(lineas[1].cantidad) === 3.2 && !lineas[1].orden_compra_id && lineas[1].recompra_de === linea,
    `el RQ se parte: 5.3 que tiene y 3.2 nuevos, sin compra (${JSON.stringify(lineas.map((l) => [l.item, Number(l.cantidad), Boolean(l.orden_compra_id)]))})`)
  comprobar((await pendienteDeLaOc()) === 0, 'la OC ya no espera nada')
  const anchoPagina = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(anchoPagina <= 390, `la página no se sale del teléfono (${anchoPagina} px)`)
  await pagina.screenshot({ path: join(CAPTURAS, '3-logistica-telefono.png'), fullPage: true })

  await pagina.goto(`${BASE}/requerimientos/atencion`, { waitUntil: 'networkidle' })
  const otraVez = pagina.getByText('Se compra otra vez: el proveedor no repuso lo devuelto')
  comprobar((await otraVez.count()) >= 1, 'en la atención de RQ, el insumo nuevo dice «Se compra otra vez»')
  await pagina.screenshot({ path: join(CAPTURAS, '4-atencion.png'), fullPage: true })
  await contexto.close()
}

// Requerimientos también lo ve en su lista.
{
  const { pagina, contexto } = await entrar(CUENTAS.requerimientos)
  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  comprobar((await pagina.getByText('Se compra otra vez: el proveedor no repuso lo devuelto').count()) >= 1, 'Requerimientos ve «Se compra otra vez» en su RQ')
  await contexto.close()
}
// ------------------------------------------------------- 5. La respuesta perdida y el reenvío con otra cantidad
// La devolución entra y su respuesta no llega; Almacén cambia la cantidad y
// vuelve a pulsar. Ya había entrado: la ventana lo dice sin rojo, solo ofrece
// «Cerrar» y sigue a la vista hasta que se cierra. El envío vive fuera de la
// ventana: al volver a abrirla, llega sin el aviso y con un id nuevo, y la
// devolución siguiente entra (antes decía otra vez «ya quedó»).
{
  const { pagina, contexto } = await entrar(CUENTAS.almacen, { width: 390, height: 844 })
  const cdp = await contexto.newCDPSession(pagina)
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Response' }] })
  const corte = { armado: null, cortadas: 0 }
  const cuerpo = (r) => r.postData ?? (r.postDataEntries ?? []).map((x) => Buffer.from(x.bytes ?? '', 'base64').toString()).join('')
  cdp.on('Fetch.requestPaused', async (e) => {
    const h = Object.fromEntries(Object.entries(e.request.headers).map(([k, v]) => [k.toLowerCase(), v]))
    if (corte.armado && e.request.method === 'POST' && h['next-action'] && cuerpo(e.request).includes(corte.armado)) {
      corte.armado = null
      corte.cortadas++
      return cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'ConnectionReset' }).catch(() => {})
    }
    return cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => {})
  })
  const documento = `GR-CORTE-${SUFIJO}`
  const llenar = async (d, cantidadDevuelta, doc) => {
    await d.locator('#dev-ingreso').selectOption(ing)
    await d.locator('#dev-cantidad').fill(cantidadDevuelta)
    await d.locator('#dev-documento').fill(doc)
    await d.locator('#dev-motivo').fill('Otro tramo llegó doblado (banco, corte)')
    await d.locator('#dev-repone').selectOption('si')
  }
  await pagina.goto(`${BASE}/almacen/kardex`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Devolver al proveedor' }).click()
  let d = pagina.getByRole('dialog')
  await d.waitFor()
  const id1 = await d.locator('input[name="id"]').inputValue()
  await llenar(d, '0.5', documento)
  corte.armado = documento
  await d.getByRole('button', { name: 'Devolver' }).click()
  const sinRespuesta = await d.locator('[role="alert"]', { hasText: 'No llegó la respuesta' }).waitFor({ timeout: 30000 }).then(() => true, () => false)
  comprobar(sinRespuesta && corte.cortadas === 1, '[Almacén 390] la devolución entra y la respuesta se pierde')
  await d.locator('#dev-cantidad').fill('0.6')
  await d.getByRole('button', { name: 'Devolver' }).click()
  const neutro = d.locator('[data-ya-entro]')
  await neutro.waitFor({ timeout: 30000 }).catch(() => {})
  await pagina.waitForTimeout(4000)
  const vio = {
    dijo: limpio(await neutro.textContent().catch(() => '')),
    sigue: await neutro.isVisible().catch(() => false),
    cursor: await neutro.evaluate((p) => document.activeElement === p).catch(() => false),
    soloCerrar: (await d.getByRole('button', { name: 'Devolver' }).count()) === 0
      && (await d.getByRole('button', { name: 'Cerrar' }).filter({ hasText: 'Cerrar' }).count()) === 1,
  }
  comprobar(vio.dijo.includes('Esa devolución ya quedó registrada la primera vez que la enviaste') && vio.sigue && vio.cursor && vio.soloCerrar,
    `[Almacén 390] con otra cantidad, dice sin rojo que ya quedó, con el cursor en el aviso, solo ofrece «Cerrar» y sigue a la vista 4 s después (${JSON.stringify(vio)})`)
  const filas = await consulta(`select cantidad::numeric as cantidad from movimientos_materiales where documento_referencia = $1`, [documento])
  comprobar(filas.length === 1 && Number(filas[0].cantidad) === 0.5, `[Almacén 390] queda la devolución de la primera vez, 0.5 M, una vez (${filas.map((f) => Number(f.cantidad)).join(', ')})`)
  await pagina.screenshot({ path: join(CAPTURAS, '5-ya-quedo.png'), fullPage: true })
  await d.getByRole('button', { name: 'Cerrar' }).filter({ hasText: 'Cerrar' }).click()
  await d.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  await pagina.getByRole('button', { name: 'Devolver al proveedor' }).click()
  d = pagina.getByRole('dialog')
  await d.waitFor()
  const id2 = await d.locator('input[name="id"]').inputValue()
  const limpia = (await d.locator('[role="alert"]').count()) === 0 && (await d.getByRole('button', { name: 'Devolver' }).count()) === 1
  comprobar(limpia && id2 && id2 !== id1, `[Almacén 390] al volver a abrir, la ventana llega sin el aviso y con un id nuevo (${id1 !== id2})`)
  await llenar(d, '0.1', `${documento}-B`)
  await d.getByRole('button', { name: 'Devolver' }).click()
  await pagina.getByText('Devuelto al proveedor: la OC vuelve a esperar').waitFor({ timeout: 30000 }).catch(() => {})
  const [otra] = await consulta(`select count(*)::int as n from movimientos_materiales where id = $1 and documento_referencia = $2`, [id2, `${documento}-B`])
  comprobar(otra.n === 1, '[Almacén 390] y la devolución siguiente entra con ese id')
  await contexto.close()
}

const [aviso] = await consulta(`select count(*)::int as n from notificaciones where usuario_id = $1 and titulo = $2`,
  [ids[CUENTAS.contabilidad], `Espera la nota de crédito: ${ocNumero}`])
comprobar(aviso.n >= 1, 'Contabilidad recibe el aviso de la nota de crédito')

await navegador.close()
await base.end()
const propios = errores.filter((e) => !e.includes('favicon'))
comprobar(propios.length === 0, `sin errores de consola ni respuestas ≥ 400${propios.length ? `: ${propios.slice(0, 5).join(' | ')}` : ''}`)
console.log(fallas.length ? `\n${fallas.length} fallan.` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
