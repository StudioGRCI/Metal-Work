/**
 * Recorre con clic real lo que DKS pidió el 2026-10-20 (migraciones
 * 20261020190000 y 20261020191000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Requerimientos abre «Nuevo requerimiento» y, al tocar «Código interno»,
 *      le sale la lista de los códigos abiertos con PLANTA primero. Escribe
 *      parte de la marca y de la placa y queda solo la unidad del banco. Si sale
 *      del campo sin elegirla, lo escrito no se envía: el formulario no sale y
 *      debajo le ofrece la unidad. Enter elige la única que coincide, debajo
 *      dice de qué unidad es y avisa la variante casi igual que anotó la
 *      portería, y el RQ se registra con el código del padrón. Escrito con
 *      guion, el campo ofrece el del padrón; uno nuevo se confirma con «usa …
 *      como código nuevo». Al abrir «Corregir», la lista no tapa el formulario.
 *   2. En el teléfono la lista cabe en la pantalla y la página no se corre.
 *   3. Almacén tiene 10 de 15, entrega 4 y le devuelven 1 (armado en la base
 *      con la cuenta de Almacén y `set local role authenticated`).
 *   4. Maestranza ve en la tarjeta del RQ, sin presionar nada: 3 ya
 *      entregados, 7 para recoger en Almacén y 5 que faltan de Logística, por
 *      comprar; el paso de ahora es la compra y «Para recoger» va a medias, y
 *      las cifras de arriba cuentan el insumo. En el teléfono la tarjeta cabe.
 *      La cifra verde deja solo los RQ con algo para recoger.
 *   5. RR. HH. (costeo de horas y observaciones), Tesorería (caja diaria),
 *      Logística (OC directa, orden de servicio y OC desde los materiales de
 *      una OT) y Administración (subcontrato) encuentran la unidad del banco
 *      con el mismo buscador.
 *
 * Crea su propia unidad y su material, con un sufijo distinto en cada corrida, y
 * lo que el banco no trae: una solicitud de materiales por comprar, un
 * subcontratista y una cuenta de caja.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  requerimientos: 'requerimientos.local@metalwork.test',
  almacen: 'almacen.local@metalwork.test',
  maestranza: 'sup.mtz.local@metalwork.test',
  rrhh: 'rrhh.local@metalwork.test',
  tesoreria: 'tesoreria.local@metalwork.test',
  logistica: 'logistica.local@metalwork.test',
  administracion: 'administracion.local@metalwork.test',
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
const uno = async (sql, valores = []) => (await consulta(sql, valores))[0]

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
  return { pagina, contexto, errores }
}

/** Corre `sql` como la cuenta `correo`, con su rol real: como el servicio del banco. */
async function comoCuenta(correo, sql, valores = []) {
  const { id } = await uno(`select u.id from public.usuarios u where lower(u.correo) = lower($1)`, [correo])
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                             set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [id])
    await base.query('set local role authenticated')
    const r = await base.query(sql, valores)
    await base.query('commit')
    return r.rows
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

// ============================================ armazón: una unidad y un material del banco
const sufijo = Date.now().toString(36).slice(-5).toUpperCase()
const CODIGO = `BNC_${sufijo}_26/1`
// La misma unidad, escrita con guiones por la portería: la variante que la lista avisa.
const GEMELO = `BNC-${sufijo}-26-1`
// El dominio `placa` pide tres y tres (`ABC-123`): `BNC-` más el sufijo entero no entraba.
const PLACA = `B${sufijo.slice(0, 2)}-${sufijo.slice(2, 5)}`
const MATERIAL = `Aceite de banco ${sufijo}`
const almacenero = await uno(`select id from public.usuarios where lower(correo) = $1`, [CUENTAS.almacen])
await consulta(
  `insert into public.unidades (placa, tipo_vehiculo, marca, modelo, codigo_interno, activo) values ($1, 'CAMION', 'Volvo', 'FH', $2, true)`,
  [PLACA, CODIGO],
)
const { id: materialId } = await uno(
  `insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
   values ($1, $2, (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1),
           (select id from public.unidades_medida where codigo = 'UND'))
   returning id`,
  [`BNC-${sufijo}`, MATERIAL],
)
await consulta(
  `insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, precio_unitario, moneda)
   values (gen_random_uuid(), 'INGRESO', $1, 20, 'INGRESO_GENERAL', 'Compra del banco', $2, 10, 'PEN')`,
  [materialId, almacenero.id],
)
await consulta(
  `insert into public.registro_vehiculos (placa, codigo_interno, unidad, empresa, motivo, ingreso_en, ingreso_por)
   values ($1, $2, 'Hino 500', 'Transportes del banco', 'FABRICACION', now() - interval '1 day', $3)`,
  [`POR-${sufijo}`, GEMELO, almacenero.id],
)
console.log(`  unidad ${PLACA} con el código ${CODIGO} (y ${GEMELO} en la portería); material «${MATERIAL}» con 20 en stock`)
// La OC desde los materiales de una OT se abre solo con algo por comprar, y el
// banco no trae ninguna solicitud de materiales: una de Maestranza, aprobada
// por Diseño y que Almacén mandó a compra, como la arma el check 306. La OT
// tiene una sola solicitud por área: la siguiente corrida le suma una línea.
const { id: otMaterialId, orden_id: ordenConCompra } = await uno(
  `insert into public.ot_materiales (orden_id, material_id, cantidad, area_destino)
   values ((select id from public.ordenes_trabajo where estado <> 'ANULADA' order by numero limit 1), $1, 6, 'MTZ')
   returning id, orden_id`,
  [materialId],
)
const { id: solicitudId } = await uno(
  `insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por)
   values ($1, 'MTZ', (select id from public.usuarios where lower(correo) = $2))
   on conflict (orden_id, area_destino) do update set area_destino = excluded.area_destino
   returning id`,
  [ordenConCompra, CUENTAS.maestranza],
)
await consulta(
  `insert into public.requerimiento_material_detalles (requerimiento_id, ot_material_id, cantidad_solicitada) values ($1, $2, 6)`,
  [solicitudId, otMaterialId],
)
await consulta(
  `update public.requerimiento_material_detalles set aprobacion_diseno = 'APROBADO', decision_almacen = 'COMPRA', cantidad_stock = 0
    where requerimiento_id = $1`,
  [solicitudId],
)
// El formulario del subcontrato pide antes a alguien del padrón, y el banco no trae a nadie.
await consulta(
  `insert into public.subcontratistas (ruc, nombre)
   select r, 'Subcontratista del banco'
     from (select '1045' || lpad(n::text, 6, '0') || d::text as r from generate_series(100000, 100200) n, generate_series(0, 9) d) x
    where public.ruc_es_valido(r) and not exists (select 1 from public.subcontratistas where activo)
    order by r limit 1
   on conflict (ruc) do nothing`,
)

/** Abre un formulario, toca el campo de código, escribe y mira qué queda en la lista. */
// Las opciones que son códigos: la última, «Usar … como código nuevo», no cuenta.
const CODIGOS = '[role="option"]:not([id$="-nuevo"])'

async function buscaEn(v, selector, busqueda) {
  const campo = v.locator(selector)
  await campo.click()
  const lista = v.locator('[role="listbox"][aria-label="Códigos internos abiertos"]')
  await lista.waitFor({ timeout: 5000 })
  await campo.pressSequentially(busqueda)
  return (await lista.locator(CODIGOS).allInnerTexts()).map(limpio)
}

// ============================================ 1. Requerimientos elige el código de la lista
let numero = ''
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos)
  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Nuevo requerimiento', exact: true }).click()
  const v = pagina.locator('[role="dialog"]')
  const areas = await v.locator('#rq-area option').allInnerTexts()
  await v.locator('#rq-area').selectOption({ index: areas.findIndex((a) => a.includes('Maestranza')) })

  const campo = v.locator('#rq-codigo')
  const lista = v.locator('#rq-codigo-lista')
  await campo.click()
  await lista.waitFor({ timeout: 5000 })
  const opciones = lista.locator(CODIGOS)
  const primero = limpio(await opciones.first().innerText())
  comprobar(primero.startsWith('PLANTA'), `al tocar el campo sale la lista, con PLANTA primero («${primero}»)`)
  comprobar((await opciones.count()) > 1, `y los códigos abiertos (${await opciones.count()} a la vista)`)

  await campo.pressSequentially(`volvo ${PLACA.toLowerCase()}`)
  await v.screenshot({ path: `${CAPTURAS}/rq-codigo-busca.png` })
  const quedan = (await opciones.allInnerTexts()).map(limpio)
  comprobar(quedan.length === 1 && quedan[0].includes(CODIGO) && quedan[0].includes('Volvo FH') && quedan[0].includes(PLACA),
    `escribiendo la marca y la placa queda solo ${CODIGO} con su unidad (${quedan.join(' | ')})`)
  comprobar(quedan[0].includes('Del padrón de unidades') && quedan[0].includes(GEMELO), `y avisa que ${GEMELO} es casi igual («${quedan[0]}»)`)

  // Sale del campo sin elegirla: lo escrito no es un código y el formulario no sale.
  await v.locator('#rq-justificacion').fill(`Aceite para la unidad del banco ${sufijo}`)
  await v.locator('[aria-haspopup="listbox"]').first().click()
  await pagina.getByRole('searchbox').fill(MATERIAL)
  await pagina.locator('[role="option"]').filter({ hasText: MATERIAL }).first().click()
  await v.locator('input[type="number"]').first().fill('15')
  const antes = (await uno(`select count(*)::int as n from public.requerimientos where justificacion = $1`, [`Aceite para la unidad del banco ${sufijo}`])).n
  await v.getByRole('button', { name: 'Registrar y mandar a Almacén' }).click()
  await pagina.waitForTimeout(1500)
  const despues = (await uno(`select count(*)::int as n from public.requerimientos where justificacion = $1`, [`Aceite para la unidad del banco ${sufijo}`])).n
  comprobar(despues === antes && (await v.isVisible()), 'con «volvo y la placa» escrito y sin elegir, el RQ no se registra')
  comprobar(await campo.evaluate((e) => e.validity.customError), 'el navegador para el envío en el campo del código')
  const sinElegir = limpio(await v.locator('#rq-codigo-estado').innerText())
  comprobar(sinElegir.includes('No es un código') && sinElegir.includes(CODIGO), `debajo le ofrece ${CODIGO} («${sinElegir}»)`)

  // Enter elige la única que coincide, sin mandar el formulario.
  await campo.click()
  await campo.press('Enter')
  comprobar((await campo.inputValue()) === CODIGO, 'Enter elige la única que coincide: el campo queda con el código entero')
  comprobar(!(await lista.isVisible()) && (await v.isVisible()), 'la lista se cierra y el formulario sigue abierto')
  const elegido = limpio(await v.locator('#rq-codigo-estado').innerText())
  comprobar(elegido.includes('Volvo FH') && elegido.includes(GEMELO) && elegido.includes('que es el del padrón'),
    `debajo dice de qué unidad es y avisa la variante («${elegido}»)`)
  comprobar(!(await campo.evaluate((e) => e.validity.customError)), 'con el código elegido, nada para el envío')

  await v.getByRole('button', { name: 'Registrar y mandar a Almacén' }).click()
  await pagina.locator('[role="status"]').first().waitFor({ timeout: 20000 })
  numero = ((await pagina.locator('[role="status"]').first().innerText()).match(/RQ-\d{4}-\d{4}/) ?? [''])[0]
  const rq = await uno(`select codigo_interno from public.requerimientos where numero = $1`, [numero])
  comprobar(rq?.codigo_interno === CODIGO, `el ${numero || 'RQ'} queda con ${CODIGO} (${rq?.codigo_interno})`)

  // Mal escrito, con guion: ofrece el del padrón, no la variante de la portería.
  await pagina.getByRole('button', { name: 'Nuevo requerimiento', exact: true }).click()
  const v2 = pagina.locator('[role="dialog"]')
  await v2.locator('#rq-codigo').fill(`bnc ${sufijo.toLowerCase()} 26-1`)
  await v2.locator('#rq-justificacion').click()
  const aviso = limpio(await v2.locator('#rq-codigo-estado').innerText())
  comprobar(aviso.includes('se parece a') && aviso.includes(CODIGO), `escrito con guion avisa que se parece a ${CODIGO} («${aviso}»)`)
  await v2.locator('#rq-codigo-estado button', { hasText: CODIGO }).click()
  comprobar((await v2.locator('#rq-codigo').inputValue()) === CODIGO, 'tocando el parecido queda el bueno')

  // Uno que no está en ninguna parte: se confirma como código nuevo.
  const NUEVO = `NUEVO_${sufijo}`
  await v2.locator('#rq-codigo').fill(NUEVO.toLowerCase())
  await v2.locator('#rq-justificacion').click()
  const nuevo = limpio(await v2.locator('#rq-codigo-estado').innerText())
  comprobar(nuevo.includes('No está entre los códigos abiertos') && nuevo.includes('como código nuevo'), `uno nuevo pide confirmarlo («${nuevo}»)`)
  comprobar(await v2.locator('#rq-codigo').evaluate((e) => e.validity.customError), 'y mientras tanto el formulario no sale')
  await v2.locator('#rq-codigo-estado button', { hasText: 'como código nuevo' }).click()
  comprobar((await v2.locator('#rq-codigo').inputValue()) === NUEVO && !(await v2.locator('#rq-codigo').evaluate((e) => e.validity.customError)),
    `confirmado, queda ${NUEVO} y el formulario puede salir`)
  // …o desde la misma lista, sin cerrarla: es su última opción, con flechas y Enter.
  const OTRO = `OTRO_${sufijo}`
  await v2.locator('#rq-codigo').fill(OTRO.toLowerCase())
  const enLista = v2.locator('#rq-codigo-lista-nuevo')
  await enLista.waitFor({ timeout: 5000 })
  comprobar(limpio(await enLista.innerText()).includes(`Usar ${OTRO} como código nuevo`), `con la lista abierta, su última opción ofrece usar ${OTRO} como código nuevo`)
  const opcionesOtro = await v2.locator('#rq-codigo-lista [role="option"]').count()
  for (let i = 0; i < opcionesOtro; i++) await v2.locator('#rq-codigo').press('ArrowDown')
  await v2.locator('#rq-codigo').press('Enter')
  comprobar((await v2.locator('#rq-codigo').inputValue()) === OTRO && !(await v2.locator('#rq-codigo').evaluate((e) => e.validity.customError))
    && !(await v2.locator('#rq-codigo-lista').isVisible()) && (await v2.isVisible()),
    'flecha abajo hasta ella y Enter lo confirman, sin mandar ni cerrar el formulario')
  // Con la lista cerrada, Escape cierra la ventana sin registrar nada.
  await pagina.keyboard.press('Escape')
  await v2.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})

  // «Corregir» pone el foco en el código: la lista no se abre sola encima del formulario.
  await pagina.getByRole('button', { name: `Corregir el requerimiento ${numero}` }).click()
  const v3 = pagina.locator('[role="dialog"]')
  await v3.waitFor({ timeout: 5000 })
  await pagina.waitForTimeout(400)
  comprobar((await v3.locator('[role="listbox"]').count()) === 0, 'al abrir «Corregir» la lista no tapa el formulario')
  comprobar(!(await v3.locator('[id^="rq-corr-codigo-"][role="combobox"]').evaluate((e) => e.validity.customError)), 'el código del RQ vale como está')
  await pagina.keyboard.press('Escape')
  comprobar(errores.length === 0, `sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 2. En el teléfono
{
  const { pagina, contexto } = await entrar(CUENTAS.requerimientos, CELULAR)
  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Nuevo requerimiento', exact: true }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('#rq-codigo').click()
  await v.locator('#rq-codigo-lista').waitFor({ timeout: 5000 })
  const caja = await v.locator('#rq-codigo-lista').boundingBox()
  comprobar(caja && caja.x >= 0 && caja.x + caja.width <= CELULAR.width, `la lista cabe en el teléfono (${caja ? Math.round(caja.x + caja.width) : '?'} px de ${CELULAR.width})`)
  const alto = await v.locator('#rq-codigo-lista [role="option"]').first().boundingBox()
  comprobar(alto && alto.height >= 44, `cada opción se toca con el dedo (${alto ? Math.round(alto.height) : '?'} px de alto)`)
  await v.screenshot({ path: `${CAPTURAS}/rq-codigo-telefono.png` })
  await contexto.close()
}

// ============================================ 3. Almacén: 10 de 15, entrega 4 y le devuelven 1
const linea = await uno(
  `select l.id, r.id as rq from public.requerimiento_lineas l join public.requerimientos r on r.id = l.requerimiento_id where r.numero = $1 and l.item = 1`,
  [numero],
)
const salida = randomUUID()
await consulta(
  `insert into storage.objects (bucket_id, name, owner_id, metadata) values ('evidencias-almacen', $1, $2, '{"mimetype":"image/jpeg","size":100}'::jsonb)`,
  [`${almacenero.id}/${salida}.jpg`, almacenero.id],
)
await comoCuenta(CUENTAS.almacen, `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 10}]'::jsonb, null)`, [linea.rq])
await comoCuenta(CUENTAS.almacen, `select public.registrar_salida_material($1, $2, 4, null, null, 'RQ del banco', 'Supervisor de Maestranza', $3, $4)`, [
  salida, materialId, `${almacenero.id}/${salida}.jpg`, linea.id,
])
await comoCuenta(CUENTAS.almacen, `select public.registrar_ingreso_almacen($1, $2, 1, 'DEVOLUCION', 'Devolución del banco', null, 'PEN', $3)`, [
  randomUUID(), materialId, salida,
])
comprobar((await uno(`select estado from public.requerimientos where id = $1`, [linea.rq]))?.estado === 'SIN_STOCK', 'Almacén revisó: el RQ queda por comprar')

// ============================================ 4. Maestranza lo ve en su tarjeta
for (const [nombre, viewport] of [['monitor', { width: 1280, height: 900 }], ['teléfono', CELULAR]]) {
  const { pagina, contexto, errores } = await entrar(CUENTAS.maestranza, viewport)
  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  const tarjeta = pagina.locator(`[data-rq="${numero}"]`)
  comprobar(await tarjeta.isVisible(), `en ${nombre}, el ${numero} sale en «De tu área»`)
  comprobar(await tarjeta.locator('[data-insumos]').evaluate((d) => d.open), `en ${nombre}, los insumos se ven sin presionar`)
  const insumo = tarjeta.locator('li[data-insumo="1"]')
  const parte = async (p) => limpio(await insumo.locator(`[data-parte="${p}"]`).innerText().catch(() => ''))
  const [recoger, porLlegar, entregado] = [await parte('recoger'), await parte('por-llegar'), await parte('entregado')]
  console.log(`    ${nombre}: ${recoger} | ${porLlegar} | ${entregado}`)
  comprobar(recoger.startsWith('7 UND') && recoger.includes('para recoger en Almacén'), `en ${nombre}: 7 UND para recoger en Almacén`)
  comprobar(porLlegar.startsWith('5 UND') && porLlegar.includes('faltan de Logística') && porLlegar.includes('Por comprar'),
    `en ${nombre}: 5 UND que faltan de Logística, por comprar`)
  comprobar(entregado.startsWith('3 UND') && entregado.includes('ya se entregaron'), `en ${nombre}: 3 UND ya entregadas`)
  const paso = limpio(await tarjeta.locator('[aria-current="step"]').innerText())
  // En el teléfono la columna es angosta: dice «Compra»; en el monitor, quién compra.
  comprobar(paso.startsWith(nombre === 'monitor' ? 'Logística compra' : 'Compra'), `en ${nombre}, el paso de ahora es la compra («${paso}»)`)
  const recojo = limpio(await tarjeta.locator('[data-paso="EN_ALMACEN"]').innerText())
  comprobar(recojo.includes('ya hay una parte'), `en ${nombre}, «Para recoger» va a medias, como la barra («${recojo}»)`)
  const resumen = limpio(await pagina.locator('[data-resumen-rq]').innerText())
  comprobar(resumen.includes('Para recoger en Almacén') && resumen.includes('Por llegar'), `en ${nombre}, arriba están las cifras («${resumen.slice(0, 120)}»)`)
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= viewport.width, `en ${nombre} la página no se corre de costado (${ancho} px de ${viewport.width})`)
  await tarjeta.screenshot({ path: `${CAPTURAS}/rq-tarjeta-${nombre === 'monitor' ? 'monitor' : 'telefono'}.png` })
  if (nombre === 'monitor') {
    // La cifra verde lleva a los RQ que tienen algo para recoger, y solo a esos.
    await pagina.locator('[data-resumen-rq] a', { hasText: 'Para recoger en Almacén' }).click()
    await pagina.waitForURL(/ver=recoger/)
    await pagina.waitForLoadState('networkidle')
    const tarjetas = pagina.locator('[data-rq]')
    const n = await tarjetas.count()
    let todasRecogen = n > 0
    for (let k = 0; k < n; k++) if ((await tarjetas.nth(k).locator('[data-parte="recoger"]').count()) === 0) todasRecogen = false
    comprobar(todasRecogen && (await pagina.locator(`[data-rq="${numero}"]`).isVisible()),
      `la cifra verde deja ${n} RQ, todos con algo para recoger, entre ellos el ${numero}`)
  }
  comprobar(errores.length === 0, `en ${nombre}, sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 5. El mismo buscador en el costeo de horas y en la caja
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh)
  await pagina.goto(`${BASE}/rrhh/costeo`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Cargar horas' }).click()
  const v = pagina.locator('[role="dialog"]')
  const campo = v.locator('[id^="tareo-codigo-"][role="combobox"]')
  await campo.click()
  const lista = v.locator('[role="listbox"][aria-label="Códigos internos abiertos"]')
  await lista.waitFor({ timeout: 5000 })
  comprobar(limpio(await lista.locator('[role="option"]').first().innerText()).startsWith('PLANTA'), 'RR. HH.: PLANTA primero')
  await campo.pressSequentially(`volvo ${sufijo.toLowerCase()}`)
  const quedan = await lista.locator(CODIGOS).allInnerTexts()
  comprobar(quedan.length === 1 && quedan[0].includes(CODIGO), `RR. HH. encuentra ${CODIGO} por la marca y la placa`)
  await pagina.keyboard.press('Escape')
  await pagina.keyboard.press('Escape')

  await pagina.goto(`${BASE}/rrhh/observaciones`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Registrar observación' }).click()
  const obs = await buscaEn(pagina.locator('[role="dialog"]'), '[id^="obs-codigo-"][role="combobox"]', `volvo ${sufijo.toLowerCase()}`)
  comprobar(obs.length === 1 && obs[0].includes(CODIGO), `RR. HH. lo encuentra también en las observaciones (${obs.join(' | ')})`)
  comprobar(errores.length === 0, `RR. HH., sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/compras/ordenes`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Nueva OC directa' }).click()
  const v = pagina.locator('[role="dialog"]')
  comprobar((await v.locator('#ocd-codigo').inputValue()) === 'PLANTA', 'la OC directa sigue abriendo con PLANTA')
  await v.locator('#ocd-codigo').fill('')
  const oc = await buscaEn(v, '#ocd-codigo', `volvo ${sufijo.toLowerCase()}`)
  comprobar(oc.length === 1 && oc[0].includes(CODIGO), `Logística lo encuentra en la OC directa (${oc.join(' | ')})`)
  await pagina.keyboard.press('Escape')
  await pagina.keyboard.press('Escape')

  await pagina.goto(`${BASE}/compras/servicios`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Nueva orden de servicio' }).click()
  const os = await buscaEn(pagina.locator('[role="dialog"]'), '#os-codigo', `volvo ${sufijo.toLowerCase()}`)
  comprobar(os.length === 1 && os[0].includes(CODIGO), `y en la orden de servicio (${os.join(' | ')})`)
  await pagina.keyboard.press('Escape')
  await pagina.keyboard.press('Escape')

  // La OC desde los materiales de la OT que el armazón dejó con algo por comprar.
  await pagina.goto(`${BASE}/ordenes/${ordenConCompra}?vista=materiales`, { waitUntil: 'networkidle' })
  const nueva = pagina.getByRole('button', { name: 'Nueva orden de compra' })
  if (await nueva.isEnabled().catch(() => false)) {
    await nueva.click()
    const ot = await buscaEn(pagina.locator('[role="dialog"]'), '#oc-codigo', `volvo ${sufijo.toLowerCase()}`)
    comprobar(ot.length === 1 && ot[0].includes(CODIGO), `y en la OC desde los materiales de una OT (${ot.join(' | ')})`)
    await pagina.keyboard.press('Escape')
    await pagina.keyboard.press('Escape')
  } else {
    comprobar(false, 'la OT con materiales por comprar no le ofrece a Logística «Nueva orden de compra»')
  }
  comprobar(errores.length === 0, `Logística, sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.administracion)
  await pagina.goto(`${BASE}/subcontratos`, { waitUntil: 'networkidle' })
  const boton = pagina.getByRole('button', { name: 'Nuevo subcontrato' })
  if (await boton.isVisible().catch(() => false)) {
    await boton.click()
    const sc = await buscaEn(pagina.locator('[role="dialog"]'), '#sc-codigo', `volvo ${sufijo.toLowerCase()}`)
    comprobar(sc.length === 1 && sc[0].includes(CODIGO), `Administración lo encuentra en el subcontrato (${sc.join(' | ')})`)
  } else {
    comprobar(false, 'Administración no ve «Nuevo subcontrato»')
  }

  // En el RQA, lo escrito para buscar no queda aceptado por ir a «Todos» y volver.
  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  // Con solo el RQA, el botón dice «Nuevo requerimiento de Administración».
  const nuevoRq = pagina.getByRole('button', { name: /^Nuevo requerimiento( de Administración)?$/ })
  if (await nuevoRq.isVisible().catch(() => false)) {
    await nuevoRq.click()
    const v = pagina.locator('[role="dialog"]')
    if ((await v.locator('#rq-tipo').count()) > 0) await v.locator('#rq-tipo').selectOption('ADMINISTRACION')
    if ((await v.locator('#rq-cargo').count()) > 0) {
      await v.locator('#rq-codigo').fill('volvo')
      await v.locator('#rq-cargo').selectOption('TODOS')
      await v.locator('#rq-cargo').selectOption('UNO')
      const campo = v.locator('#rq-codigo')
      comprobar((await campo.inputValue()) === 'volvo' && (await campo.evaluate((e) => e.validity.customError)),
        'en el RQA, «volvo» escrito para buscar sigue sin valer después de pasar por «Todos los códigos activos»')
    } else {
      comprobar(false, 'Administración no tiene «Se carga a» en el RQ: no se probó el paso por «Todos»')
    }
    await pagina.keyboard.press('Escape')
  } else {
    comprobar(false, 'Administración no ve «Nuevo requerimiento de Administración»: no se probó el RQA')
  }
  comprobar(errores.length === 0, `Administración, sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}
{
  // El banco no trae cuentas en la caja: Tesorería da de alta una de efectivo si no hay ninguna,
  // con la misma función que su formulario.
  await comoCuenta(
    CUENTAS.tesoreria,
    `select public.guardar_caja(gen_random_uuid(), 'Efectivo del banco', 'EFECTIVO', null, 'PEN', 0, (now() at time zone 'America/Lima')::date, true)
      where not exists (select 1 from public.cajas where activa)`,
  )
  const { pagina, contexto, errores } = await entrar(CUENTAS.tesoreria)
  await pagina.goto(`${BASE}/tesoreria/caja-diaria`, { waitUntil: 'networkidle' })
  const boton = pagina.locator('[data-registrar-movimiento]').first()
  if (await boton.isVisible().catch(() => false)) {
    await boton.click()
    const v = pagina.locator('[role="dialog"]')
    const campo = v.locator('[role="combobox"][name="codigo_interno"]')
    await campo.click()
    await campo.pressSequentially(`volvo ${sufijo.toLowerCase()}`)
    const quedan = await v.locator(`[role="listbox"] ${CODIGOS}`).allInnerTexts()
    comprobar(quedan.length === 1 && quedan[0].includes(CODIGO), `Tesorería encuentra ${CODIGO} en la caja diaria`)
  } else {
    comprobar(false, 'la caja tiene una cuenta activa y no ofrece «Registrar ingreso o egreso»')
  }
  comprobar(errores.length === 0, `Tesorería, sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallan:\n- ${fallas.join('\n- ')}`)
process.exit(fallas.length === 0 ? 0 : 1)
