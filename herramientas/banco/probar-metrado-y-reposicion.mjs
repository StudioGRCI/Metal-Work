/**
 * Recorre con clic real las mejoras de Almacén del 20/11/2026, con la cuenta de
 * cada puesto (nunca ADMIN):
 *
 *   1. Requerimientos pide 15 planchas donde Diseño metró 10, y un faro que no
 *      está en el metrado: su tarjeta dice que se pasan y escribe el sustento.
 *   2. Almacén ve el RQ en Atención esperando a Diseño, sin «Revisar stock».
 *   3. Diseño lo ve en «Insumos por autorizar» (en su menú): no autoriza el faro,
 *      con su nota, y autoriza la plancha.
 *   4. Requerimientos lee la nota y sustenta el faro otra vez; Diseño lo autoriza.
 *   5. Almacén ya puede revisar el stock, y le llegó el aviso.
 *   6. Almacén fija el mínimo y la compra por mayor en «Reposición de stock»;
 *      Logística la ve en su menú, sin poder cambiarla.
 *   7. Gerencia, al aprobar una OC, ve cuánto hay y cuánto ya viene en otra.
 *   8. En la salida del kardex, la materia prima sin RQ dice que no sale.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * BANCO_CHROMIUM y los correos por puesto si no son `*.local@metalwork.test`.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(['requerimientos', 'almacen', 'diseno', 'logistica', 'gerencia'].map((p) => [p, cuenta(p)]))
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
const carpeta = join(CAPTURAS, 'metrado-y-reposicion')
mkdirSync(carpeta, { recursive: true })

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
const CODIGO = `BANCO-${SUFIJO}`
const ids = Object.fromEntries((await consulta(`select correo, id from usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!ids[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco.`)

async function como(puesto) {
  const sub = ids[CUENTAS[puesto]]
  await consulta(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', 'authenticated', false),
                         set_config('request.jwt.claims', $2, false)`, [sub, JSON.stringify({ sub, role: 'authenticated' })])
}

const deAlmacen = async (almacen) =>
  (await consulta(
    `select m.id, m.descripcion, m.unidad_medida_id, m.categoria_id from materiales m join categorias_material c on c.id = m.categoria_id
      where m.activo and c.almacen = $1 and not coalesce(m.unidad_pendiente, false) order by m.codigo limit 1`,
    [almacen],
  ))[0]
const plancha = await deAlmacen('MATERIA_PRIMA')
const faro = await deAlmacen('ACCESORIOS')
const disco = await deAlmacen('CONSUMIBLES')
if (!plancha || !faro || !disco) throw new Error('El banco no tiene materia prima, accesorios y consumibles.')
const [{ id: area }] = await consulta(`select id from areas where codigo = 'MTZ'`)

// Hay planchas en el almacén, para la salida y para lo que ve Gerencia.
await consulta(
  `insert into movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
   values (gen_random_uuid(), 'INGRESO', $1, 30, 'INGRESO_GENERAL', $2, $3)`,
  [plancha.id, `GR ${SUFIJO}`, ids[CUENTAS.almacen]],
)
// El disco, bajo un mínimo de 20, sin compra por mayor.
await consulta(`update materiales set stock_minimo = 20, compra_por_mayor = null where id = $1`, [disco.id])

await como('diseno')
await consulta(`select public.guardar_material_codigo(null, $1, $2, 10, null, 'Metrado del piso, prueba del banco')`, [CODIGO, plancha.id])
await como('requerimientos')
const rq = (await consulta(`select gen_random_uuid() as id`))[0].id
await consulta(
  `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Planchas y faros para el piso de la unidad de prueba', null, $4::jsonb)`,
  [rq, area, CODIGO, JSON.stringify([{ material_id: plancha.id, cantidad: 15 }, { material_id: faro.id, cantidad: 2 }])],
)
const [{ numero: RQ }] = await consulta(`select numero from requerimientos where id = $1`, [rq])
console.log(`Sembrado ${RQ} en ${CODIGO}: 15 planchas (metrado 10) y 2 faros (no están)`)

// ---------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, ancho = 1280) {
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
async function hidratado(loc) {
  await loc.waitFor({ timeout: 60000 })
  for (let i = 0; i < 240; i++) {
    if (await loc.evaluate((e) => Object.keys(e).some((k) => k.startsWith('__reactProps')))) return
    await loc.page().waitForTimeout(250)
  }
}
/** Los títulos de grupo del menú y, por grupo, sus entradas. */
async function menu(pagina) {
  return pagina.locator('nav[aria-label="Menú principal"] > div').evaluateAll((divs) =>
    divs.map((d) => ({ grupo: d.dataset.grupo, items: [...d.querySelectorAll('a')].map((a) => a.textContent?.trim().replace(/\d+$/, '')) })),
  )
}
async function esperar(condicion, ms = 20000) {
  for (let t = 0; t < ms; t += 250) {
    if (await condicion().catch(() => false)) return true
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}
const estados = async () =>
  Object.fromEntries((await consulta(`select item, estado from metrado_de_requerimientos(array[$1::uuid])`, [rq])).map((f) => [f.item, f.estado]))

try {
  // ------------------------------------------- 1. Requerimientos sustenta
  const req = await entrar(CUENTAS.requerimientos)
  await req.pagina.goto(`${BASE}/requerimientos?rq=${rq}`, { waitUntil: 'networkidle' })
  const tarjeta = req.pagina.locator(`[data-rq="${RQ}"]`)
  const freno = tarjeta.locator(`[data-metrado-frena="${RQ}"]`)
  comprobar(limpio(await freno.innerText().catch(() => '')).includes('Los insumos 1 y 2 se pasan del metrado de Diseño'),
    `la tarjeta dice que los dos insumos se pasan: «${limpio(await freno.innerText().catch(() => '')).slice(0, 160)}»`)
  const linea1 = limpio(await tarjeta.locator('[data-insumo="1"]').innerText())
  comprobar(linea1.includes('Se pasa del metrado') && linea1.includes('Diseño metró 10') && linea1.includes('se pasa 5'),
    `el insumo 1 dice la cuenta: «${linea1.slice(0, 200)}»`)
  comprobar(linea1.includes('por revisar cuando se sustente y Diseño lo autorice'), 'y su parte por revisar espera el sustento, no a Almacén')
  const escribir = freno.getByRole('button', { name: 'Escribir el sustento' })
  await hidratado(escribir)
  await escribir.click()
  let ventana = req.pagina.getByRole('dialog')
  await ventana.waitFor()
  comprobar((await ventana.locator('[data-sustento]').count()) === 2, 'la ventana pide el sustento de los dos insumos')
  await ventana.locator('textarea[name="sustento-1"]').fill('El plano P-02 R1 agregó dos travesaños al piso')
  await ventana.locator('textarea[name="sustento-2"]').fill('Faros de reemplazo pedidos por el cliente en la visita')
  await ventana.getByRole('button', { name: 'Enviar a Diseño' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  const listo = await esperar(async () => limpio(await freno.locator('[role="status"]').innerText()).includes('enviado a Diseño'))
  comprobar(listo, `al enviar dice «${limpio(await freno.locator('[role="status"]').innerText().catch(() => ''))}»`)
  let e = await estados()
  comprobar(e[1] === 'POR_AUTORIZAR' && e[2] === 'POR_AUTORIZAR', `los dos esperan a Diseño en la base (${JSON.stringify(e)})`)
  await esperar(async () => limpio(await freno.innerText()).includes('falta su visto'))
  comprobar(limpio(await freno.innerText()).includes('Diseño tiene el sustento'), 'la tarjeta ya dice que Diseño tiene el sustento')
  comprobar(req.errores.length === 0, `sin errores de consola para Requerimientos (${req.errores.join(' | ')})`)
  await req.pagina.screenshot({ path: join(carpeta, '1-requerimientos.png'), fullPage: true })

  // ------------------------------------------- 2. Almacén espera
  const alm = await entrar(CUENTAS.almacen)
  await alm.pagina.goto(`${BASE}/requerimientos/atencion`, { waitUntil: 'networkidle' })
  let fila = alm.pagina.locator('tbody tr', { hasText: RQ })
  comprobar(limpio(await fila.locator('[data-espera-metrado]').innerText().catch(() => '')).startsWith('Espera el visto de Diseño'),
    'en Atención el RQ dice que espera el visto de Diseño')
  comprobar((await fila.getByRole('button', { name: /Revisar/ }).count()) === 0, 'y no tiene «Revisar stock»')

  // ------------------------------------------- 3. Diseño: no y sí
  const dis = await entrar(CUENTAS.diseno)
  const suMenu = await menu(dis.pagina)
  comprobar(suMenu[1]?.grupo === 'Por autorizar' && suMenu[1]?.items?.[0]?.startsWith('Insumos por autorizar'),
    `en el menú de Diseño, «Por autorizar» va arriba (${JSON.stringify(suMenu.slice(0, 3))})`)
  await dis.pagina.goto(`${BASE}/requerimientos/metrado`, { waitUntil: 'networkidle' })
  let suya = dis.pagina.locator(`[data-rq="${RQ}"]`).first()
  comprobar((await suya.locator('[data-por-autorizar]').count()) === 2, 'la bandeja muestra los dos insumos con su sustento')
  comprobar(limpio(await suya.innerText()).includes('El plano P-02 R1 agregó dos travesaños'), 'y el sustento de quien pidió')
  const casilla1 = suya.locator('[data-por-autorizar="1"] input[type="checkbox"]')
  await hidratado(casilla1)
  await casilla1.uncheck()
  await suya.getByRole('button', { name: 'No autorizar' }).click()
  ventana = dis.pagina.getByRole('dialog')
  await ventana.waitFor()
  await ventana.locator('textarea[name="nota"]').fill('El metrado no lleva faros nuevos: pídelos en el RQ de garantía')
  await ventana.getByRole('button', { name: 'No autorizar' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  await esperar(async () => (await estados())[2] === 'RECHAZADO')
  e = await estados()
  comprobar(e[1] === 'POR_AUTORIZAR' && e[2] === 'RECHAZADO', `el faro quedó sin autorizar y la plancha esperando (${JSON.stringify(e)})`)
  await esperar(async () => (await dis.pagina.locator(`[data-rq="${RQ}"] [data-por-autorizar]`).first().count()) > 0 &&
    (await dis.pagina.locator(`[data-rq="${RQ}"]`).first().locator('[data-por-autorizar]').count()) === 1)
  suya = dis.pagina.locator(`[data-rq="${RQ}"]`).first()
  comprobar((await suya.locator('[data-por-autorizar]').count()) === 1, 'en la bandeja queda solo la plancha')
  const autorizar = suya.getByRole('button', { name: 'Autorizar', exact: true })
  await hidratado(autorizar)
  await autorizar.click()
  await esperar(async () => (await estados())[1] === 'AUTORIZADO')
  // Arriba de la lista, fuera de la tarjeta: la tarjeta del RQ se fue a «Esperan el sustento».
  const aviso = await esperar(async () => (await dis.pagina.getByText(`${RQ}: Insumo autorizado`).count()) === 1)
  comprobar(aviso, 'arriba dice que el insumo quedó autorizado')
  await esperar(async () => (await dis.pagina.locator('#sin-sustento').count()) > 0)
  const espera = limpio(await dis.pagina.locator('section', { has: dis.pagina.locator('#sin-sustento') }).innerText().catch(() => ''))
  comprobar(espera.includes(RQ) && espera.includes('Diseño no lo autorizó') && espera.includes('Diseño: El metrado no lleva faros'),
    'el RQ pasa a «Esperan el sustento de quien pidió», con su nota')
  comprobar(dis.errores.length === 0, `sin errores de consola para Diseño (${dis.errores.join(' | ')})`)
  await dis.pagina.screenshot({ path: join(carpeta, '3-diseno.png'), fullPage: true })

  // ------------------------------------------- 4. Otra vez el faro
  await req.pagina.reload({ waitUntil: 'networkidle' })
  const rojo = limpio(await tarjeta.locator('[data-insumo="2"]').innerText())
  comprobar(rojo.includes('Diseño no lo autorizó') && rojo.includes('pídelos en el RQ de garantía'), 'Requerimientos lee la nota de Diseño en el insumo')
  await hidratado(freno.getByRole('button', { name: 'Escribir el sustento' }))
  await freno.getByRole('button', { name: 'Escribir el sustento' }).click()
  ventana = req.pagina.getByRole('dialog')
  await ventana.waitFor()
  comprobar((await ventana.locator('[data-sustento]').count()) === 1, 'ahora la ventana pide solo el faro')
  await ventana.locator('textarea[name="sustento-2"]').fill('El cliente pidió cambiar los faros en el acta de la visita')
  await ventana.getByRole('button', { name: 'Enviar a Diseño' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  await esperar(async () => (await estados())[2] === 'POR_AUTORIZAR')
  await dis.pagina.reload({ waitUntil: 'networkidle' })
  const otraVez = dis.pagina.locator(`[data-rq="${RQ}"]`).first().getByRole('button', { name: 'Autorizar', exact: true })
  await hidratado(otraVez)
  await otraVez.click()
  await esperar(async () => (await estados())[2] === 'AUTORIZADO')
  e = await estados()
  comprobar(e[1] === 'AUTORIZADO' && e[2] === 'AUTORIZADO', `los dos quedaron autorizados (${JSON.stringify(e)})`)
  // En regla, sale de la bandeja (el banco puede tener otros RQ de corridas anteriores)
  // y pasa a «Ya autorizados por Diseño», donde sigue su recorrido (plan 6.2).
  const enBandeja = dis.pagina.locator(`[data-rq="${RQ}"]:not([data-autorizado])`)
  await esperar(async () => (await enBandeja.count()) === 0)
  comprobar((await enBandeja.count()) === 0, 'el RQ sale de la bandeja de Diseño')
  comprobar((await dis.pagina.locator(`[data-ya-autorizados] [data-rq="${RQ}"][data-autorizado]`).count()) === 1,
    'y aparece en «Ya autorizados por Diseño»')

  // ------------------------------------------- 5. Almacén ya revisa
  const [{ n: avisos }] = await consulta(
    `select count(*)::int as n from notificaciones where usuario_id = $1 and origen_id = $2 and titulo = $3`,
    [ids[CUENTAS.almacen], rq, `Ya puedes revisar: ${RQ}`],
  )
  comprobar(avisos === 1, `a Almacén le llegó «Ya puedes revisar» (${avisos})`)
  await alm.pagina.reload({ waitUntil: 'networkidle' })
  fila = alm.pagina.locator('tbody tr', { hasText: RQ })
  comprobar((await fila.getByRole('button', { name: /Revisar/ }).count()) === 1, 'y en Atención ya tiene «Revisar stock»')
  comprobar(alm.errores.length === 0, `sin errores de consola en Atención (${alm.errores.join(' | ')})`)

  // ------------------------------------------- 6. Reposición
  await alm.pagina.goto(`${BASE}/almacen/reposicion`, { waitUntil: 'networkidle' })
  const deDisco = () => alm.pagina.locator(`tr[data-material]`, { hasText: disco.descripcion }).first()
  let texto = limpio(await deDisco().innerText().catch(() => ''))
  comprobar(texto.includes('Bajo el mínimo') && texto.includes('Sin mínimo') === false, `el disco sale por reponer: «${texto.slice(0, 200)}»`)
  const cambiar = deDisco().getByRole('button', { name: `Cambiar el mínimo de ${disco.descripcion}` })
  await hidratado(cambiar)
  await cambiar.click()
  ventana = alm.pagina.getByRole('dialog')
  await ventana.waitFor()
  await ventana.locator('input[name="minimo"]').fill('25')
  await ventana.locator('input[name="por_mayor"]').fill('100')
  await ventana.getByRole('button', { name: 'Guardar' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  await esperar(async () => Number((await consulta(`select compra_por_mayor from materiales where id = $1`, [disco.id]))[0].compra_por_mayor) === 100)
  const [guardado] = await consulta(`select stock_minimo, compra_por_mayor from materiales where id = $1`, [disco.id])
  comprobar(Number(guardado.stock_minimo) === 25 && Number(guardado.compra_por_mayor) === 100, `quedó mínimo 25 y por mayor 100 (${JSON.stringify(guardado)})`)
  await esperar(async () => limpio(await deDisco().innerText()).includes('por mayor 100'))
  const comprar = limpio(await deDisco().locator('td').nth(5).innerText().catch(() => ''))
  comprobar(limpio(await deDisco().innerText()).includes('por mayor 100') && comprar.includes('100'),
    `la fila dice la compra por mayor y que se compran 100: «${comprar}»`)
  comprobar(alm.errores.length === 0, `sin errores de consola para Almacén (${alm.errores.join(' | ')})`)
  await alm.pagina.screenshot({ path: join(carpeta, '6-reposicion.png'), fullPage: true })

  const log = await entrar(CUENTAS.logistica)
  const deLogistica = await menu(log.pagina)
  comprobar(deLogistica.some((g) => g.items.some((i) => i?.startsWith('Reposición de stock'))), 'Logística tiene «Reposición de stock» en su menú')
  await log.pagina.goto(`${BASE}/almacen/reposicion`, { waitUntil: 'networkidle' })
  const suFila = log.pagina.locator(`tr[data-material]`, { hasText: disco.descripcion }).first()
  comprobar((await suFila.count()) === 1 && (await suFila.getByRole('button').count()) === 0, 'Logística la ve sin poder cambiar el mínimo')
  comprobar(log.errores.length === 0, `sin errores de consola para Logística (${log.errores.join(' | ')})`)

  // ------------------------------------------- 7. Gerencia ve lo que hay y lo que viene
  let ruc
  while (!ruc) {
    const prefijo = `20${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`
    ;[ruc] = await consulta(
      `select n from (select $1 || d as n from generate_series(0, 9) d) x
        where public.ruc_es_valido(n) and not exists (select 1 from proveedores p where p.numero_documento = n) limit 1`,
      [prefijo],
    )
  }
  const [{ id: proveedor }] = await consulta(
    `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. de prueba 420, Lima', '999 420 420') returning id`,
    [ruc.n, `PROVEEDOR REPOSICION ${SUFIJO}`],
  )
  await como('logistica')
  const oc = []
  for (let i = 1; i <= 2; i++) {
    const [{ id }] = await consulta(
      `select public.emitir_compra_directa(gen_random_uuid(), $1, $2, 'Reposición del almacén, prueba del banco', $3::jsonb,
                                           current_date + 5, 'CONTADO', 0, 'PEN', false, 'PLANTA') as id`,
      [proveedor, `COT-REP-${SUFIJO}-${i}`, JSON.stringify([{ material_id: plancha.id, cantidad: 4, precio: 120 }])],
    )
    oc.push(id)
  }
  const [{ numero: oc1 }] = await consulta(`select coalesce(numero, referencia) as numero from ordenes_compra_materiales where id = $1`, [oc[0]])
  const ger = await entrar(CUENTAS.gerencia)
  await ger.pagina.goto(`${BASE}/compras/aprobacion`, { waitUntil: 'networkidle' })
  const stock = ger.pagina.locator('[data-stock-al-aprobar]')
  // Las dos esperan a Gerencia: ninguna «ya viene», cada una dice que la otra también está por aprobar.
  let lineas = (await stock.allInnerTexts()).map(limpio)
  comprobar(lineas.some((l) => l.startsWith('En almacén:') && /Otra OC también por aprobar: 4/.test(l) && l.includes(oc1)) &&
    !lineas.some((l) => /Ya vienen? 4/.test(l)),
    `con las dos OC por aprobar dice cuánto hay y que ${oc1} también espera, sin «ya viene»: ${JSON.stringify(lineas.slice(0, 4))}`)
  await ger.pagina.screenshot({ path: join(carpeta, '7-gerencia.png'), fullPage: true })
  // Gerencia aprueba la primera: en la segunda, esos 4 ya vienen.
  await como('gerencia')
  await consulta(`select public.aprobar_compra($1)`, [oc[0]])
  await ger.pagina.reload({ waitUntil: 'networkidle' })
  lineas = (await stock.allInnerTexts()).map(limpio)
  comprobar(lineas.some((l) => /Ya vienen 4/.test(l) && l.includes(oc1)),
    `aprobada ${oc1}, en la otra OC dice que ya vienen 4 en ${oc1}: ${JSON.stringify(lineas.slice(0, 4))}`)
  comprobar(ger.errores.length === 0, `sin errores de consola para Gerencia (${ger.errores.join(' | ')})`)
  await ger.pagina.screenshot({ path: join(carpeta, '7-gerencia-aprobada.png'), fullPage: true })

  // ------------------------------------------- 8. La materia prima sin RQ no sale
  await alm.pagina.goto(`${BASE}/almacen/kardex`, { waitUntil: 'networkidle' })
  const abrir = alm.pagina.getByRole('button', { name: 'Registrar salida' })
  await hidratado(abrir)
  await abrir.click()
  ventana = alm.pagina.locator('[role="dialog"]')
  await ventana.waitFor()
  await ventana.locator('select[name="material_id"]').selectOption(plancha.id)
  await esperar(async () => (await ventana.getByText(/sale solo con el requerimiento que l[ao] pide/).count()) > 0, 5000)
  const error = limpio(await ventana.getByText(/sale solo con el requerimiento que l[ao] pide/).first().innerText().catch(() => ''))
  comprobar(error.startsWith('La materia prima sale solo con el requerimiento'), `sin RQ, el campo lo dice antes de enviar: «${error}»`)
  comprobar(alm.errores.length === 0, `sin errores de consola en el kardex (${alm.errores.join(' | ')})`)
} finally {
  await navegador.close()
  await base.end()
}

console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallan.`)
process.exit(fallas.length === 0 ? 0 : 1)
