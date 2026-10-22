/**
 * Clic real sobre la migración 20261020196000: el circuito del RQ sin cabos
 * sueltos. Con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Almacén, en «Atención de requerimiento», ve que a un RQ listo le falta
 *      la salida del kardex y no tiene «Entregado» todavía. El enlace abre el
 *      kardex con la salida de ese RQ ya elegida, sin error de hidratación. La
 *      registra con su foto y entonces sí lo entrega.
 *   1b. En un RQ de dos insumos, el foco cae en el RQ elegido (no en la «i» de
 *      su ayuda), cancelar no la vuelve a abrir al recargar, después del primer
 *      insumo la ventana sigue con el segundo, y al terminar ofrece volver a
 *      Atención a marcarlo entregado.
 *      «Sigue el ítem 2» se lleva el foco y quien recibe se queda escrito; el
 *      enlace de vuelta cae en la fila del RQ.
 *   2. En un RQ cuya compra llegó de otra marca, la salida propone el material
 *      que llegó y no el pedido. Si Logística lo compró de otra categoría de
 *      almacén, la salida también lo ofrece y lo registra.
 *   3. Requerimientos no puede subir la cantidad de un RQ listo en almacén: la
 *      ventana dice por qué y la base no cambia.
 *   4. Si el RQ se anula mientras Almacén tiene abierta la revisión, al guardar
 *      dice que se anuló, no «ya pasó la revisión».
 *   5. En el teléfono, la fila del RQ listo va apilada: el enlace a la salida
 *      queda dentro de la pantalla, no del otro lado de la tabla. La lista de
 *      Requerimientos tampoco se sale.
 *   6. Lo que ya no va a salir: Almacén lo entrega con faltante y escribe por
 *      qué. Un motivo de espacios lo rechaza el servidor y el aviso se lleva el
 *      foco; al entregarlo, el aviso queda arriba de la lista aunque la fila se
 *      vaya, y a 390 px la barra de arriba no lo tapa. Queda en el RQ y en el
 *      insumo, le llega a quien lo pidió, y en su
 *      lista dice «Entregado con faltante», no «Entregado»; Gerencia lo ve
 *      igual en el código interno. Logística no tiene el botón ni la base se lo
 *      deja hacer.
 *   7. Con la fila vieja: si otra pestaña lo entregó con otra nota, la pantalla
 *      dice primero «Ya estaba entregado; no se cambió nada», a quién y cuándo, en tono de aviso; si
 *      mientras tanto salió todo del kardex, se entrega sin faltante y lo dice.
 *      Un RQ por atender del que ya salió algo no se anula: la ventana dice
 *      por qué y qué hacer, y el motivo escrito se queda.
 *   8. La salida sin RQ elige el código de la unidad de la misma lista que el
 *      RQ (migración 20261021131000): en el monitor la lista abierta no pasa
 *      el borde de la ventana; con un consumible ofrece PLANTA y OFICINA; con
 *      un accesorio no las ofrece, ni como código nuevo, buscada a medias dice
 *      por qué no está, y si PLANTA ya estaba elegida dice por qué no va y no
 *      deja enviar; escribiendo la placa sale
 *      su código, y la placa escrita dice adónde va la salida; lo escrito
 *      para buscar sin elegir no se envía; ir a «Vehículo
 *      registrado» y volver no borra el código elegido ni el nuevo confirmado,
 *      y la salida va al código elegido, vinculada a su unidad.
 *   9. Lo libre con la cuenta de «Stock en almacén»: la ficha del kardex dice
 *      lo libre sin código y de quién es lo demás, y lo separado de más (como
 *      Almacén y como Gerencia). La salida ofrece el material con lo libre y
 *      lo separado; sin RQ, a PLANTA o al mismo código del RQ, avisa cuánto
 *      puede sacar sin quitarle a otro y pide elegir el RQ; a medio escribir
 *      no nombra un código; con su RQ no avisa, dice a la vista cuánto es
 *      suyo, y la salida le descuenta lo separado en la base. Lo de un RQ de
 *      PLANTA no es de cualquier salida a PLANTA, y con lo separado de más lo
 *      dice. Lo apartado para un pedido de OT no es libre para Almacén, que no
 *      ve las OT. Un RQ de PLANTA hacia una unidad se lleva primero lo que
 *      separó y después lo que entró para ella; propone lo que pide, la salida
 *      entra y la base no lo cuenta dos veces. Con la placa de una unidad
 *      registrada escrita como código, cuenta lo de esa unidad; lo que pasa de
 *      lo separado se le descuenta a ella, y el mensaje dice su código; lo
 *      que el RQ separó sin que estuviera aparte de lo de la unidad no se da
 *      por del RQ, y la base se lo descuenta a la unidad. Con dos
 *      RQ del mismo código dice cuánto es de cada uno, y el otro ítem del mismo
 *      RQ es «otro ítem», y propone lo que no es de otros. Lo separado de más
 *      por el propio RQ lo dice aunque no haya nada de otros. Un accesorio que
 *      entró para una unidad no se ofrece hacia otra: lo dice junto a la
 *      cantidad y no deja confirmar. La cantidad tecleada igual a la propuesta
 *      cuenta como escrita y no cambia al elegir el destino; si pasa del tope
 *      del destino, lo dice junto a ella. El vehículo sin código interno se ve
 *      en la lista (primero en su detalle), no sale marcado como bien elegido,
 *      y su placa escrita como código, con guion, sin él o con un espacio, no
 *      se ofrece como código nuevo. La placa de un vehículo escrita como
 *      código dice adónde va la salida y no se ofrece como código nuevo; un
 *      código de la lista escrito como la placa de un vehículo sin código es
 *      ese código (el accesorio y el consumible salen hacia él), y la placa de
 *      dos vehículos no deja confirmar, salvo con un RQ elegido después, que
 *      sale con el código del RQ. El código que Requerimientos le puso al
 *      vehículo sin código, escrito de otra manera que su placa, se nombra y
 *      se ofrece para tocarlo; la placa de un vehículo con código va a su
 *      código aunque un RQ la tenga de código. Al seguir con el ítem 2 de un RQ de
 *      PLANTA, el aviso dice cuánto del ítem 1 salió de lo de la unidad. En
 *      metros, con decimales, propone 3.2 y no 3.1999999999999997, la base lo
 *      guarda, y la ficha no avisa de «0 M» separados de más; con 1.0005 en el
 *      kardex propone 1 y no 1.001, que la base rechazaba, la lista de
 *      materiales dice «libre 1» y 1.0005 escrito dice que van tres decimales.
 *
 * Siembra por SQL dos materiales propios de la corrida y cuatro RQ, con la
 * sesión de cada puesto. Después de cada clic consulta la base. Se puede correr
 * cuantas veces haga falta.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  requerimientos: 'requerimientos.local@metalwork.test',
  almacen: 'almacen.local@metalwork.test',
  logistica: 'logistica.local@metalwork.test',
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

/** Corre `sql` con la sesión de `correo`, con su rol y no como dueño de las tablas. */
async function como(correo, sql, valores = []) {
  await base.query('begin')
  try {
    const [u] = await consulta('select id::text from public.usuarios where correo = $1', [correo])
    await base.query(
      `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
              set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
      [u.id],
    )
    await base.query('set local role authenticated')
    const filas = await consulta(sql, valores)
    await base.query('commit')
    return filas
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

// ============================================ 0. Lo que se siembra
const sufijo = Date.now().toString(36).slice(-4).toUpperCase()
const consumible = `(select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' order by codigo limit 1)`
const und = `(select id from public.unidades_medida where codigo = 'UND')`
const [dis] = await consulta(`insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ($1, $2, ${consumible}, ${und}) returning id::text, descripcion`, [`PRB-CR-${sufijo}`, `Disco del circuito ${sufijo}`])
const [ds2] = await consulta(`insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ($1, $2, ${consumible}, ${und}) returning id::text, descripcion`, [`PRB-CR2-${sufijo}`, `Disco de otra marca ${sufijo}`])
const [lija] = await consulta(`insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ($1, $2, ${consumible}, ${und}) returning id::text, descripcion`, [`PRB-CR3-${sufijo}`, `Lija del circuito ${sufijo}`])
// Un disco con guarda del almacén de EPP, que Logística compra para un disco de consumibles.
const [epp] = await consulta(`insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ($1, $2, (select id from public.categorias_material where activo and almacen = 'EPP' order by codigo limit 1), ${und})
  returning id::text, descripcion`, [`PRB-CR4-${sufijo}`, `Disco con guarda, de EPP ${sufijo}`])
for (const [m, n] of [[dis.id, 20], [lija.id, 5]]) {
  await consulta(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
    select gen_random_uuid(), 'INGRESO', $1::uuid, $4, 'INGRESO_GENERAL', $2, u.id from public.usuarios u where u.correo = $3`,
    [m, `GR BANCO CR ${sufijo}`, CUENTAS.almacen, n])
}
const [{ id: area }] = await consulta(`select id::text from public.areas where codigo = 'MTZ'`)
const rq = { a: crypto.randomUUID(), b: crypto.randomUUID(), c: crypto.randomUUID(), d: crypto.randomUUID(), h: crypto.randomUUID() }
const codigos = { a: `BANCO-CRA${sufijo}`, b: `BANCO-CRB${sufijo}`, c: `BANCO-CRC${sufijo}`, d: `BANCO-CRD${sufijo}`, h: `BANCO-CRH${sufijo}` }
const cantidades = { a: 2, b: 2, c: 1, d: 1, h: 1 }
for (const k of Object.keys(rq)) {
  await como(CUENTAS.requerimientos, `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Prueba del circuito del RQ en el banco', null, $4::jsonb)`,
    [rq[k], area, codigos[k], JSON.stringify([{ material_id: dis.id, cantidad: cantidades[k] }])])
}
const numero = async (id) => (await consulta('select numero from public.requerimientos where id = $1', [id]))[0].numero
const insumo = async (id) => (await consulta('select id::text from public.requerimiento_lineas where requerimiento_id = $1 and item = 1', [id]))[0].id
const N = { a: await numero(rq.a), b: await numero(rq.b), c: await numero(rq.c), d: await numero(rq.d), h: await numero(rq.h) }
// RQ F: dos insumos, un disco y una lija, los dos en el almacén.
rq.f = crypto.randomUUID()
await como(CUENTAS.requerimientos, `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Prueba del circuito con dos insumos', null, $4::jsonb)`,
  [rq.f, area, `BANCO-CRF${sufijo}`, JSON.stringify([{ material_id: dis.id, cantidad: 1 }, { material_id: lija.id, cantidad: 2 }])])
N.f = await numero(rq.f)
await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 1}, {"item": 2, "en_stock": 2}]', null)`, [rq.f])
// RQ A y C: Almacén tiene todo, quedan listos. RQ B: no tiene, se compra de otra marca y llega.
await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 2}]', null)`, [rq.a])
await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 1}]', null)`, [rq.c])
await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 0}]', null)`, [rq.b])
await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 0}]', null)`, [rq.h])
// Las compras piden un proveedor activo; el banco recién hecho no trae ninguno (como en probar-codigo-y-tarjetas-rq.mjs).
await consulta(
  `insert into public.proveedores (numero_documento, razon_social)
   select r, 'PROVEEDOR DEL BANCO'
     from (select '2069' || lpad(n::text, 6, '0') || d::text as r from generate_series(100000, 100200) n, generate_series(0, 9) d) x
    where public.ruc_es_valido(r) and not exists (select 1 from public.proveedores where activo)
    order by r limit 1
   on conflict do nothing`,
)
const [prov] = await consulta(`select id::text from public.proveedores where activo order by razon_social limit 1`)
/** Logística compra `material` para el insumo del RQ y la compra llega al almacén. */
async function comprarYRecibir(rqId, material, cantidadComprada, guia) {
  const oc = crypto.randomUUID()
  await como(CUENTAS.logistica, `select public.emitir_compra_de_requerimientos($1, $2::jsonb, $3, $4, null, 'CONTADO', 0, 'PEN', true)`,
    [oc, JSON.stringify([{ material_id: material, cantidad: cantidadComprada, precio: 9, insumos: [await insumo(rqId)] }]), prov.id, `Cotización del banco ${guia}`])
  // Gerencia la aprueba si hace falta; la llegada, como dueño: la recepción tiene sus propias pruebas.
  const [{ aprobacion }] = await consulta('select aprobacion from public.ordenes_compra_materiales where id = $1', [oc])
  if (aprobacion !== 'APROBADA' && aprobacion !== 'NO_REQUIERE') await como(CUENTAS.gerencia, 'select public.aprobar_compra($1)', [oc])
  // Sin el recojo del conductor, que tiene su propia prueba: la entrega se marca sin disparadores.
  await base.query('begin')
  await base.query('set local session_replication_role = replica')
  await consulta(`update public.ordenes_compra_materiales set entregado_almacen_en = now() where id = $1`, [oc])
  await base.query('commit')
  await consulta(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, orden_compra_detalle_id)
    select gen_random_uuid(), 'INGRESO', $1::uuid, $5, 'COMPRA', $2, u.id, l.orden_compra_detalle_id
      from public.usuarios u, public.requerimiento_lineas l where u.correo = $3 and l.id = $4`,
    [material, `GR BANCO ${guia}`, CUENTAS.almacen, await insumo(rqId), cantidadComprada])
}
await comprarYRecibir(rq.b, ds2.id, 2, `CR2 ${sufijo}`)
await comprarYRecibir(rq.h, epp.id, 1, `CR4 ${sufijo}`)
console.log(`    sembrados: ${N.a} y ${N.c} listos, ${N.b} con la compra de otra marca, ${N.h} con la de EPP, ${N.d} por revisar`)

const foto = join(CAPTURAS, `salida-circuito-${sufijo}.jpg`)
writeFileSync(foto, Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'))
const justificante = join(CAPTURAS, `justificante-circuito-${sufijo}.pdf`)
writeFileSync(justificante, Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'latin1'))

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, ancho = 1280) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: 900 } })
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
const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ').trim()
const ir = (pagina, ruta) => pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle', timeout: 120000 })
/**
 * Espera a que React tome el elemento antes del primer clic. Con la página
 * recién compilada, el clic llegaba antes que la hidratación y no abría nada.
 */
async function hidratado(loc) {
  await loc.waitFor({ timeout: 60000 })
  for (let i = 0; i < 240; i++) {
    if (await loc.evaluate((e) => Object.keys(e).some((k) => k.startsWith('__reactProps')))) return
    await loc.page().waitForTimeout(250)
  }
}
const enfocado = (pagina) => pagina.evaluate(() => ({ rol: document.activeElement?.getAttribute('role'), dice: document.activeElement?.textContent?.trim() ?? '' }))
/** La fila de un RQ en «Atención», que sigue siendo una tabla. */
const filaDe = (pagina, n) => pagina.locator('tbody tr', { hasText: n })
/** Espera a que la ventana se cierre o diga algo; devuelve la alerta, si la hubo. */
async function terminarVentana(pagina) {
  const v = pagina.locator('[role="dialog"]')
  await Promise.race([v.waitFor({ state: 'hidden', timeout: 60000 }), v.locator('[role="alert"]').waitFor({ timeout: 60000 })]).catch(() => {})
  return (await v.locator('[role="alert"]').allTextContents().catch(() => [])).join(' ').trim()
}

// ============================================ 1. «Entregado» después de la salida del kardex
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  await ir(pagina, '/requerimientos/atencion')
  let fila = filaDe(pagina, N.a)
  const aviso = fila.locator('[data-por-sacar]')
  comprobar((await aviso.count()) === 1 && (await texto(aviso)).startsWith('Falta la salida de 1 insumo'),
    `${N.a} listo dice lo que falta: «${await texto(aviso).catch(() => '')}»`)
  comprobar((await fila.getByRole('button', { name: 'Entregado', exact: true }).count()) === 0, 'y todavía no ofrece «Entregado»')
  await hidratado(fila.getByRole('link', { name: 'Registrar la salida en el kardex' }))
  await fila.getByRole('link', { name: 'Registrar la salida en el kardex' }).click()
  await pagina.waitForURL((u) => u.pathname === '/almacen/kardex' && u.searchParams.get('rq') === rq.a, { timeout: 60000 })
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.waitFor({ timeout: 60000 }).catch(() => {})
  await pagina.waitForTimeout(500)
  comprobar(await ventana.isVisible(), 'el enlace abre el kardex con la ventana de salida abierta')
  comprobar(!errores.some((e) => e.includes('Hydration')), `sin error de hidratación al abrirlo desde el RQ ${errores.join(' | ')}`)
  const lineaA = await insumo(rq.a)
  comprobar(await ventana.locator('select[name="requerimiento_linea_id"]').inputValue() === lineaA, `con el ítem de ${N.a} elegido`)
  comprobar(await ventana.locator('select[name="material_id"]').inputValue() === dis.id, 'y el material pedido, que es el que hay')
  comprobar(await pagina.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))), 'el foco está dentro de la ventana')
  await ventana.locator('#sal-motivo').fill('Vale del banco, circuito del RQ')
  await ventana.locator('#sal-recibe').fill('Soldador de Maestranza')
  await ventana.locator('#sal-foto').setInputFiles(foto)
  await ventana.getByRole('button', { name: 'Confirmar salida' }).click()
  const alerta = await terminarVentana(pagina)
  const [salida] = await consulta(`select material_id::text, cantidad::float as cantidad, codigo_interno from public.movimientos_materiales
                                    where requerimiento_linea_id = $1 and tipo = 'SALIDA'`, [lineaA])
  comprobar(!alerta && salida?.material_id === dis.id && salida?.cantidad === 2 && salida?.codigo_interno === codigos.a.toUpperCase(),
    `la salida entra con su RQ: ${JSON.stringify(salida)} ${alerta ? `(${alerta})` : ''}`)

  await ir(pagina, '/requerimientos/atencion')
  fila = filaDe(pagina, N.a)
  comprobar((await fila.locator('[data-por-sacar]').count()) === 0, 'ya no dice que falte algo')
  await hidratado(fila.getByRole('button', { name: 'Entregado', exact: true }))
  await fila.getByRole('button', { name: 'Entregado', exact: true }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('textarea[name="nota"]').fill('Supervisor de Maestranza')
  await v.getByRole('button', { name: 'Registrar entrega' }).click()
  const alertaEntrega = await terminarVentana(pagina)
  const [{ estado }] = await consulta('select estado from public.requerimientos where id = $1', [rq.a])
  comprobar(!alertaEntrega && estado === 'ENTREGADO', `con la salida hecha, ${N.a} se entrega: ${estado} ${alertaEntrega}`)
  comprobar(errores.length === 0, `sin errores de consola como Almacén ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 1b. Un RQ de dos insumos, de corrido
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  const lineasF = (await consulta('select id::text from public.requerimiento_lineas where requerimiento_id = $1 order by item', [rq.f])).map((l) => l.id)
  const ventana = pagina.locator('[role="dialog"]')
  // Cancelar la que nació abierta: no vuelve a abrirse al recargar.
  await ir(pagina, `/almacen/kardex?rq=${rq.f}`)
  await ventana.waitFor({ timeout: 60000 }).catch(() => {})
  await pagina.waitForTimeout(300)
  comprobar(await pagina.evaluate(() => document.activeElement?.id) === 'sal-rq',
    `el foco cae en el RQ elegido, no en la «i» de su ayuda (${await pagina.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id)})`)
  await pagina.keyboard.press('Escape')
  await pagina.waitForURL((u) => u.pathname === '/almacen/kardex' && !u.searchParams.has('rq'), { timeout: 30000 }).catch(() => {})
  comprobar(!new URL(pagina.url()).searchParams.has('rq'), `al cancelarla, el enlace pierde el RQ: ${pagina.url()}`)
  comprobar(await pagina.evaluate(() => document.activeElement?.textContent?.trim()) === 'Registrar salida', 'y el foco vuelve a «Registrar salida»')
  await pagina.reload({ waitUntil: 'networkidle' })
  await pagina.waitForTimeout(500)
  comprobar((await ventana.count()) === 0, 'al recargar, la ventana no se vuelve a abrir')

  await ir(pagina, `/almacen/kardex?rq=${rq.f}`)
  await ventana.waitFor({ timeout: 60000 }).catch(() => {})
  comprobar(await ventana.locator('select[name="requerimiento_linea_id"]').inputValue() === lineasF[0], `abre con el ítem 1 de ${N.f}`)
  await ventana.locator('#sal-recibe').fill('Soldador de Maestranza')
  await ventana.locator('#sal-foto').setInputFiles(foto)
  await ventana.getByRole('button', { name: 'Confirmar salida' }).click()
  const sigue = ventana.getByText(/Sigue el ítem 2/)
  await sigue.waitFor({ timeout: 60000 }).catch(() => {})
  comprobar(await sigue.isVisible(), `la ventana sigue abierta y dice que sigue el ítem 2: «${await texto(sigue).catch(() => '')}»`)
  const foco = await enfocado(pagina)
  comprobar(foco.rol === 'status' && foco.dice.includes('Sigue el ítem 2'), `y el aviso se lleva el foco (no queda en la página): ${JSON.stringify(foco)}`)
  comprobar(await ventana.locator('select[name="requerimiento_linea_id"]').inputValue() === lineasF[1]
    && await ventana.locator('select[name="material_id"]').inputValue() === lija.id, 'con el ítem 2 y la lija ya elegidos')
  comprobar(await ventana.locator('#sal-recibe').inputValue() === 'Soldador de Maestranza', 'quien recibe se queda escrito para el ítem 2')
  await ventana.locator('#sal-foto').setInputFiles(foto)
  await ventana.getByRole('button', { name: 'Confirmar salida' }).click()
  const alerta = await terminarVentana(pagina)
  const salidas = await consulta(`select material_id::text, cantidad::float as cantidad from public.movimientos_materiales
                                   where requerimiento_linea_id = any($1::uuid[]) and tipo = 'SALIDA' order by cantidad`, [lineasF])
  comprobar(!alerta && salidas.length === 2 && salidas[0].material_id === dis.id && salidas[1].material_id === lija.id && salidas[1].cantidad === 2,
    `las dos salidas entran, cada una con su insumo: ${JSON.stringify(salidas)} ${alerta}`)
  const volver = pagina.getByRole('link', { name: 'Volver a Atención para marcarlo entregado' })
  comprobar(await volver.isVisible(), 'al terminar ofrece volver a Atención a marcarlo entregado')
  comprobar((await volver.getAttribute('href'))?.endsWith(`#rq-${rq.f}`), `y el enlace cae en la fila del RQ: ${await volver.getAttribute('href')}`)
  await volver.click()
  await pagina.waitForURL((u) => u.pathname === '/requerimientos/atencion', { timeout: 60000 }).catch(() => {})
  const entregadoF = filaDe(pagina, N.f).getByRole('button', { name: 'Entregado', exact: true })
  await entregadoF.waitFor({ timeout: 60000 }).catch(() => {})
  comprobar((await entregadoF.count()) === 1,
    `y ahí ${N.f} ya ofrece «Entregado»`)
  comprobar(errores.length === 0, `sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 2. La salida propone lo que llegó de la compra
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  await ir(pagina, `/almacen/kardex?rq=${rq.b}`)
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.waitFor({ timeout: 60000 }).catch(() => {})
  comprobar(await ventana.locator('select[name="requerimiento_linea_id"]').inputValue() === await insumo(rq.b), `la salida abre con el ítem de ${N.b}`)
  comprobar(await ventana.locator('select[name="material_id"]').inputValue() === ds2.id,
    `y propone «${ds2.descripcion}», que llegó de su compra, en vez del pedido`)
  await pagina.screenshot({ path: `${CAPTURAS}/circuito-salida-comprado.png` })

  // Lo comprado de otra categoría de almacén: la salida lo ofrece y lo registra.
  await ir(pagina, `/almacen/kardex?rq=${rq.h}`)
  await ventana.waitFor({ timeout: 60000 }).catch(() => {})
  const lineaH = await insumo(rq.h)
  comprobar(await ventana.locator('select[name="requerimiento_linea_id"]').inputValue() === lineaH, `la salida abre con el ítem de ${N.h}`)
  comprobar(await ventana.locator(`select[name="material_id"] option[value="${epp.id}"]`).count() === 1
    && await ventana.locator('select[name="material_id"]').inputValue() === epp.id,
    `y ofrece y propone «${epp.descripcion}», del almacén de EPP, que llegó de su compra`)
  await ventana.locator('#sal-recibe').fill('Soldador de Maestranza')
  await ventana.locator('#sal-foto').setInputFiles(foto)
  await ventana.getByRole('button', { name: 'Confirmar salida' }).click()
  const alerta = await terminarVentana(pagina)
  const [salidaH] = await consulta(`select material_id::text, cantidad::float as cantidad from public.movimientos_materiales
                                     where requerimiento_linea_id = $1 and tipo = 'SALIDA'`, [lineaH])
  comprobar(!alerta && salidaH?.material_id === epp.id && salidaH?.cantidad === 1,
    `la salida entra con el material de EPP para su insumo: ${JSON.stringify(salidaH)} ${alerta}`)
  comprobar(errores.length === 0, `sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 3. Un RQ listo no se corrige hacia arriba
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos)
  await ir(pagina, '/requerimientos')
  await hidratado(pagina.getByRole('button', { name: `Corregir el requerimiento ${N.c}` }))
  await pagina.getByRole('button', { name: `Corregir el requerimiento ${N.c}` }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('[id^="rq-corr-cant-"]').first().fill('3')
  await v.locator('[id^="correccion-motivo-"]').fill('Maestranza necesita dos discos más')
  await v.locator('[id^="correccion-justificante-"]').setInputFiles(justificante)
  await v.getByRole('button', { name: 'Corregir', exact: true }).click()
  const alerta = await terminarVentana(pagina)
  const [{ cantidad }] = await consulta('select cantidad::float as cantidad from public.requerimiento_lineas where requerimiento_id = $1', [rq.c])
  comprobar(alerta.includes('la cantidad solo puede bajar') && alerta.includes('registra otro requerimiento') && cantidad === 1,
    `la ventana dice por qué no y la base sigue en 1: «${alerta}»`)
  const [{ n }] = await consulta('select count(*)::int as n from public.correcciones where documento_id = $1', [rq.c])
  comprobar(n === 0, 'y no queda ninguna corrección anotada')
  comprobar(errores.length === 0, `sin errores de consola como Requerimientos ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 4. El RQ anulado mientras se revisa
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  await ir(pagina, '/requerimientos/atencion')
  const fila = filaDe(pagina, N.d)
  await hidratado(fila.getByRole('button', { name: 'Revisar stock' }))
  await fila.getByRole('button', { name: 'Revisar stock' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.getByRole('button', { name: 'Tengo todo' }).click()
  // Mientras tanto, Requerimientos lo anula.
  await como(CUENTAS.requerimientos, `select public.anular_requerimiento($1, 'Ya no hace falta, prueba del banco')`, [rq.d])
  await v.getByRole('button', { name: 'Guardar la revisión' }).click()
  const alerta = await terminarVentana(pagina)
  comprobar(alerta.includes('se anuló') && !alerta.includes('ya pasó la revisión'), `al guardar dice que se anuló: «${alerta}»`)
  comprobar(errores.length === 0, `sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 5. En el teléfono
{
  // Otro RQ listo, para ver la fila con lo que falta.
  const rqE = crypto.randomUUID()
  await como(CUENTAS.requerimientos, `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Prueba del circuito en el teléfono', null, $4::jsonb)`,
    [rqE, area, `BANCO-CRE${sufijo}`, JSON.stringify([{ material_id: dis.id, cantidad: 1 }])])
  await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 1}]', null)`, [rqE])
  const { pagina, contexto } = await entrar(CUENTAS.almacen, 390)
  await ir(pagina, '/requerimientos/atencion')
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `a 390 px la página mide ${ancho} px`)
  const enlace = filaDe(pagina, await numero(rqE)).getByRole('link', { name: 'Registrar la salida en el kardex' })
  // `isVisible()` no ve el recorte de la tabla: se mide contra el ancho de la pantalla.
  const caja = await enlace.evaluate((e) => { const r = e.getBoundingClientRect(); return { izq: r.left, der: r.right, ancho: innerWidth } })
  comprobar(caja.izq >= 0 && caja.der <= caja.ancho, `el enlace a la salida queda dentro de la pantalla: ${JSON.stringify(caja)}`)
  const aviso = filaDe(pagina, await numero(rqE)).locator('[data-por-sacar]')
  const cajaAviso = await aviso.evaluate((e) => e.getBoundingClientRect().right)
  comprobar(cajaAviso <= 390, `y lo que falta también: termina en ${Math.round(cajaAviso)} px`)
  await pagina.screenshot({ path: `${CAPTURAS}/circuito-telefono.png`, fullPage: true })
  await contexto.close()

  const req = await entrar(CUENTAS.requerimientos, 390)
  await ir(req.pagina, '/requerimientos')
  // Desde #128 cada RQ es una tarjeta (`data-rq`), no una fila.
  const filas = await req.pagina.locator('[data-rq]').count()
  const anchoReq = await req.pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(filas > 0 && anchoReq <= 390, `la lista de Requerimientos a 390 px: ${filas} tarjetas, mide ${anchoReq} px`)
  await req.contexto.close()
}

// ============================================ 6. Entregar con faltante
{
  const rqG = crypto.randomUUID()
  await como(CUENTAS.requerimientos, `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Prueba del faltante en el banco', null, $4::jsonb)`,
    [rqG, area, `BANCO-CRG${sufijo}`, JSON.stringify([{ material_id: dis.id, cantidad: 2 }])])
  await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 2}]', null)`, [rqG])
  const nG = await numero(rqG)
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  await ir(pagina, '/requerimientos/atencion')
  await hidratado(filaDe(pagina, nG).getByRole('button', { name: 'Entregar con faltante' }))
  await filaDe(pagina, nG).getByRole('button', { name: 'Entregar con faltante' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.waitFor({ timeout: 30000 }).catch(() => {})
  const lista = await texto(v.locator('[data-faltante]')).catch(() => '')
  comprobar(lista.includes('2 UND') && lista.includes(dis.descripcion), `la ventana dice qué no salió: «${lista}»`)
  await v.locator('textarea[name="nota"]').fill('Supervisor de Maestranza')
  await v.locator('textarea[name="motivo"]').fill('corto')
  await v.getByRole('button', { name: 'Entregar con faltante' }).click()
  await pagina.waitForTimeout(800)
  const [{ estado: antes }] = await consulta('select estado from public.requerimientos where id = $1', [rqG])
  comprobar(antes === 'LISTO_EN_ALMACEN' && await v.isVisible(), `sin un motivo de verdad no se entrega: ${antes}`)
  // Once caracteres que el navegador deja pasar; el servidor quita los espacios y lo rechaza.
  await v.locator('textarea[name="motivo"]').fill('          x')
  await v.getByRole('button', { name: 'Entregar con faltante' }).click()
  const rechazo = await terminarVentana(pagina)
  const focoRechazo = await enfocado(pagina)
  const [{ estado: trasRechazo }] = await consulta('select estado from public.requerimientos where id = $1', [rqG])
  comprobar(rechazo.includes('al menos 10 caracteres') && trasRechazo === 'LISTO_EN_ALMACEN',
    `un motivo de espacios lo rechaza el servidor y la ventana lo dice: «${rechazo}» (${trasRechazo})`)
  comprobar(focoRechazo.rol === 'alert' && focoRechazo.dice.includes('al menos 10 caracteres'), `y el rechazo se lleva el foco: ${JSON.stringify(focoRechazo)}`)
  await v.locator('textarea[name="motivo"]').fill('El área ya no necesita los discos: cambiaron el diseño')
  // En el teléfono, con la lista corrida hasta el RQ: el aviso de arriba tiene
  // que quedar a la vista, no debajo de la barra fija (cuarta vuelta de diseño).
  await pagina.setViewportSize({ width: 390, height: 800 })
  await v.getByRole('button', { name: 'Entregar con faltante' }).click()
  const alerta = await terminarVentana(pagina)
  const [g] = await consulta('select estado, faltante_al_entregar, motivo_del_faltante from public.requerimientos where id = $1', [rqG])
  comprobar(!alerta && g.estado === 'ENTREGADO' && g.faltante_al_entregar === `2 UND de «${dis.descripcion}»`
    && g.motivo_del_faltante === 'El área ya no necesita los discos: cambiaron el diseño',
    `se entrega con faltante y queda escrito: ${JSON.stringify(g)} ${alerta}`)
  // La fila se fue de la lista con el botón que se tocó: el aviso queda arriba, con el foco.
  const avisoArriba = pagina.locator('[role="status"]', { hasText: `${nG}: Entregado con faltante` })
  await avisoArriba.waitFor({ timeout: 30000 }).catch(() => {})
  await filaDe(pagina, nG).waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
  comprobar((await filaDe(pagina, nG).count()) === 0, `${nG} se va de los que esperan`)
  const focoArriba = await enfocado(pagina)
  comprobar(await avisoArriba.isVisible() && focoArriba.rol === 'status' && focoArriba.dice.includes(nG),
    `y el aviso sigue arriba de la lista, con el foco: «${await texto(avisoArriba).catch(() => '')}» ${JSON.stringify(focoArriba)}`)
  // La barra de arriba es fija: al llevarse el foco, el aviso no queda debajo de ella.
  // El caso que vio el auditor: el aviso asoma apenas por encima de la vista, y
  // el foco lo baja justo hasta el borde. Con scroll-mt-4 quedaba a 16 px, bajo
  // la barra de 56; con scroll-mt-20, a 80. Si ya está entero bajo la barra, el
  // navegador lo da por visible y no lo mueve: eso no lo arregla el margen.
  const vista = await avisoArriba.evaluate((e) => {
    const relleno = document.createElement('div')
    relleno.style.height = '3000px'
    document.body.append(relleno)
    e.blur()
    window.scrollTo(0, e.getBoundingClientRect().top + window.scrollY + 5)
    const antes = Math.round(e.getBoundingClientRect().top)
    e.focus()
    const r = e.getBoundingClientRect()
    const dice = { antes, despues: Math.round(r.top), tapado: !e.contains(document.elementFromPoint(r.left + 8, r.top + 4)) }
    relleno.remove()
    return dice
  })
  comprobar(vista.antes < 0 && !vista.tapado, `a 390 px, el foco baja el aviso y la barra de arriba no lo tapa: ${JSON.stringify(vista)}`)
  await pagina.setViewportSize({ width: 1280, height: 900 })
  const [{ sin_salida }] = await consulta('select sin_salida_al_entregar::float as sin_salida from public.requerimiento_lineas where requerimiento_id = $1', [rqG])
  comprobar(sin_salida === 2, `en el insumo queda cuánto no salió: ${sin_salida}`)
  const avisos = await consulta(`select n.cuerpo from public.notificaciones n join public.usuarios u on u.id = n.usuario_id
                                  where n.origen_id = $1 and u.correo = $2 and n.titulo like 'Entregado con faltante:%'`, [rqG, CUENTAS.requerimientos])
  comprobar(avisos.length === 1 && avisos[0].cuerpo.includes('Motivo: El área ya no necesita') && avisos[0].cuerpo.includes('No salió: 2 UND'),
    `a quien lo pidió le llega el motivo y qué no salió: «${avisos[0]?.cuerpo ?? ''}»`)
  comprobar(errores.length === 0, `sin errores de consola como Almacén ${errores.join(' | ')}`)
  await contexto.close()

  const req = await entrar(CUENTAS.requerimientos)
  await ir(req.pagina, '/requerimientos')
  // Desde #128 cada RQ es una tarjeta: arriba su insignia, en cada insumo su barra, abajo cómo se entregó.
  const filaG = req.pagina.locator(`[data-rq="${nG}"]`)
  const dice = await texto(filaG.locator('[data-faltante]')).catch(() => '')
  comprobar(dice.includes('No salió del kardex: 2 UND') && dice.includes('Motivo: El área ya no necesita los discos: cambiaron el diseño'),
    `Requerimientos ve en su lista qué no salió y por qué: «${dice}»`)
  const insignias = await texto(filaG.locator('div:has(> h2)')).catch(() => '')
  comprobar(insignias.includes('Entregado con faltante') && !/Entregado(?! con faltante)/.test(insignias),
    `y dice «Entregado con faltante», nunca «Entregado» a secas: «${insignias.slice(0, 160)}»`)
  await filaG.locator('summary').click()
  const insumoG = filaG.locator('[data-parte="no-salio"]')
  const diceInsumo = await texto(insumoG).catch(() => '')
  const entregadoG = await filaG.locator('[data-parte="entregado"]').count()
  comprobar((await insumoG.count()) === 1 && diceInsumo.startsWith('2 UND no salió del kardex') && entregadoG === 0,
    `en el insumo, los 2 que no salieron y nada como entregado: «${diceInsumo}» (${entregadoG} partes de entregado)`)
  comprobar(req.errores.length === 0, `sin errores de consola como Requerimientos ${req.errores.join(' | ')}`)
  await req.contexto.close()

  // Donde Gerencia mira el código interno, tampoco sale «Entregado» a secas.
  const ger = await entrar(CUENTAS.gerencia)
  // En Documentos cada RQ es un renglón de su tarjeta; en Materiales, una fila de «Lo pedido».
  for (const [vista, renglon] of [['documentos', '[data-tipo="REQUERIMIENTO"] li'], ['materiales', 'tbody tr']]) {
    await ir(ger.pagina, `/codigos-internos/detalle?codigo=${encodeURIComponent(`BANCO-CRG${sufijo}`)}&vista=${vista}`)
    const filaCodigo = ger.pagina.locator(renglon, { hasText: nG })
    const diceCodigo = await texto(filaCodigo.first()).catch(() => '')
    comprobar((await filaCodigo.count()) >= 1 && diceCodigo.includes('Entregado con faltante'),
      `en «${vista}» del código, ${nG} dice «Entregado con faltante»: «${diceCodigo.slice(0, 160)}»`)
  }
  comprobar(ger.errores.length === 0, `sin errores de consola como Gerencia ${ger.errores.join(' | ')}`)
  await ger.contexto.close()

  // Logística no entrega: no tiene el botón, y la base tampoco se lo deja hacer.
  const rqI = crypto.randomUUID()
  await como(CUENTAS.requerimientos, `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Prueba del faltante sin permiso', null, $4::jsonb)`,
    [rqI, area, `BANCO-CRI${sufijo}`, JSON.stringify([{ material_id: dis.id, cantidad: 1 }])])
  await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 1}]', null)`, [rqI])
  const log = await entrar(CUENTAS.logistica)
  await ir(log.pagina, '/requerimientos/atencion')
  const filasLog = await log.pagina.locator('tbody tr').count()
  const botones = await log.pagina.getByRole('button', { name: 'Entregar con faltante' }).count()
  comprobar(filasLog > 0 && botones === 0, `Logística ve ${filasLog} filas en Atención y ningún «Entregar con faltante» (${botones})`)
  await log.contexto.close()
  let rechazoLog = ''
  await como(CUENTAS.logistica, `select public.rq_entregar_con_faltante($1, 'Supervisor de Maestranza', 'Logística intenta cerrarlo sin ser Almacén')`, [rqI])
    .catch((e) => { rechazoLog = e.message })
  const [{ estado: estadoI }] = await consulta('select estado from public.requerimientos where id = $1', [rqI])
  comprobar(rechazoLog.includes('almacen.despachar') && estadoI === 'LISTO_EN_ALMACEN', `y la base se lo niega: «${rechazoLog}» (${estadoI})`)
}

// ============================================ 7. La fila vieja, lo que salió mientras tanto y anular con salida
{
  const sembrar = async (clave, cantidad, enStock) => {
    const id = crypto.randomUUID()
    await como(CUENTAS.requerimientos, `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Prueba de la fila vieja en el banco', null, $4::jsonb)`,
      [id, area, `BANCO-CR${clave}${sufijo}`, JSON.stringify([{ material_id: dis.id, cantidad }])])
    if (enStock !== null) await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, $2::jsonb, null)`, [id, JSON.stringify([{ item: 1, en_stock: enStock }])])
    return { id, n: await numero(id) }
  }
  /** Una salida del kardex por SQL, con su foto: Almacén la registra desde otra pantalla. */
  const salidaAparte = async (rqId, cantidad) => {
    const s = crypto.randomUUID()
    const [{ id: alm }] = await consulta('select id::text from public.usuarios where correo = $1', [CUENTAS.almacen])
    await consulta(`insert into storage.objects (bucket_id, name, owner_id, metadata)
      values ('evidencias-almacen', $1, $2, '{"mimetype":"image/jpeg","size":100}'::jsonb)`, [`${alm}/${s}.jpg`, alm])
    await como(CUENTAS.almacen, `select public.registrar_salida_material($1, $2, $3, null, null, 'Vale del banco, desde otra pantalla', 'Soldador de Maestranza', $4, $5)`,
      [s, dis.id, cantidad, `${alm}/${s}.jpg`, await insumo(rqId)])
  }
  const J = await sembrar('J', 2, 2)
  const K = await sembrar('K', 1, 1)
  const L = await sembrar('L', 2, null)
  await salidaAparte(L.id, 1)

  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  await ir(pagina, '/requerimientos/atencion')
  const v = pagina.locator('[role="dialog"]')
  // J: mientras la ventana está abierta, otra pestaña lo entrega con otra nota.
  await hidratado(filaDe(pagina, J.n).getByRole('button', { name: 'Entregar con faltante' }))
  await filaDe(pagina, J.n).getByRole('button', { name: 'Entregar con faltante' }).click()
  await v.waitFor({ timeout: 30000 }).catch(() => {})
  await v.locator('textarea[name="nota"]').fill('Supervisor de Maestranza')
  await v.locator('textarea[name="motivo"]').fill('El área ya no necesita los discos: cambiaron el diseño')
  await como(CUENTAS.almacen, `select public.rq_entregar_con_faltante($1, 'Jefe de Acabados', 'Acabados se llevó lo que había y ya no necesita el resto')`, [J.id])
  await v.getByRole('button', { name: 'Entregar con faltante' }).click()
  const alertaJ = await terminarVentana(pagina)
  const avisoJ = pagina.locator('[role="status"]', { hasText: `${J.n}: Ya estaba entregado con faltante` })
  await avisoJ.waitFor({ timeout: 30000 }).catch(() => {})
  const diceJ = await texto(avisoJ).catch(() => '')
  const tonoJ = await avisoJ.getAttribute('class').catch(() => '')
  const [j] = await consulta('select nota_entrega, motivo_del_faltante from public.requerimientos where id = $1', [J.id])
  // Primero que no se cambió nada; después quién lo recogió y cuándo. En tono de aviso: no es un éxito.
  comprobar(!alertaJ && diceJ.includes('Ya estaba entregado con faltante; no se cambió nada. Lo recogió Jefe de Acabados el ')
    && /\btext-aviso\b/.test(tonoJ ?? '') && j.nota_entrega === 'Jefe de Acabados' && j.motivo_del_faltante.startsWith('Acabados se llevó'),
    `con la fila vieja dice que ya estaba entregado, a quién y cuándo, en tono de aviso, y no cambia nada: «${diceJ}» ${JSON.stringify(j)} ${alertaJ}`)

  // K: mientras la ventana está abierta, sale del kardex lo que faltaba.
  await hidratado(filaDe(pagina, K.n).getByRole('button', { name: 'Entregar con faltante' }))
  await filaDe(pagina, K.n).getByRole('button', { name: 'Entregar con faltante' }).click()
  await v.waitFor({ timeout: 30000 }).catch(() => {})
  await v.locator('textarea[name="nota"]').fill('Supervisor de Maestranza')
  await v.locator('textarea[name="motivo"]').fill('El área ya no necesita el disco: cambiaron el diseño')
  await salidaAparte(K.id, 1)
  await v.getByRole('button', { name: 'Entregar con faltante' }).click()
  const alertaK = await terminarVentana(pagina)
  const avisoK = pagina.locator('[role="status"]', { hasText: `${K.n}: Entregado: mientras tanto salió todo del kardex` })
  await avisoK.waitFor({ timeout: 30000 }).catch(() => {})
  const [k] = await consulta('select estado, nota_entrega, faltante_al_entregar, motivo_del_faltante from public.requerimientos where id = $1', [K.id])
  comprobar(!alertaK && await avisoK.isVisible() && k.estado === 'ENTREGADO' && k.nota_entrega === 'Supervisor de Maestranza'
    && k.faltante_al_entregar === null && k.motivo_del_faltante === null,
    `si mientras tanto salió todo, se entrega sin faltante y lo dice: «${await texto(avisoK).catch(() => '')}» ${JSON.stringify(k)} ${alertaK}`)
  comprobar(errores.length === 0, `sin errores de consola como Almacén ${errores.join(' | ')}`)
  await contexto.close()

  // L: por atender y con una salida; Requerimientos lo intenta anular.
  const req = await entrar(CUENTAS.requerimientos)
  await ir(req.pagina, '/requerimientos')
  // En Requerimientos cada RQ es una tarjeta (`data-rq`, desde #128).
  const tarjetaL = req.pagina.locator(`[data-rq="${L.n}"]`)
  await hidratado(tarjetaL.getByRole('button', { name: 'Anular' }))
  await tarjetaL.getByRole('button', { name: 'Anular' }).click()
  const vl = req.pagina.locator('[role="dialog"]')
  await vl.waitFor({ timeout: 30000 }).catch(() => {})
  await vl.locator('textarea[name="motivo"]').fill('Ya no hace falta, prueba del banco')
  await vl.getByRole('button', { name: 'Anular', exact: true }).click()
  const alertaL = await terminarVentana(req.pagina)
  const [{ estado: estadoL }] = await consulta('select estado from public.requerimientos where id = $1', [L.id])
  comprobar(alertaL.includes('ya salió material del kardex') && alertaL.includes('entregue con faltante') && estadoL === 'POR_ATENDER',
    `con una salida, la ventana dice por qué no se anula y qué hacer, y el RQ sigue: «${alertaL}» (${estadoL})`)
  comprobar(await vl.locator('textarea[name="motivo"]').inputValue() === 'Ya no hace falta, prueba del banco', 'y el motivo escrito se queda')
  comprobar(req.errores.length === 0, `sin errores de consola como Requerimientos ${req.errores.join(' | ')}`)
  await req.contexto.close()
}

// ============================================ 8. La salida sin RQ elige el código de la lista
// Almacén lee la lista de códigos internos desde la migración 20261021131000.
{
  const unidadSal = { codigo: `BANCO-SAL${sufijo}`, placa: `BS${sufijo[0]}-${sufijo.slice(1)}` }
  await consulta(`insert into public.unidades (codigo_interno, placa, marca, modelo) values ($1, $2, 'Scania', 'R450')`,
    [unidadSal.codigo, unidadSal.placa])
  const [perno] = await consulta(`insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
    values ($1, $2, ${consumible}, ${und}) returning id::text`, [`PRB-CR5-${sufijo}`, `Perno de la salida sin RQ ${sufijo}`])
  const [faro] = await consulta(`insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
    values ($1, $2, (select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1), ${und})
    returning id::text`, [`PRB-CR6-${sufijo}`, `Faro de la salida sin RQ ${sufijo}`])
  for (const m of [perno.id, faro.id]) {
    await consulta(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
      select gen_random_uuid(), 'INGRESO', $1::uuid, 4, 'INGRESO_GENERAL', $2, u.id from public.usuarios u where u.correo = $3`,
      [m, `GR BANCO CR ${sufijo}`, CUENTAS.almacen])
  }
  const salidas = async () => (await consulta(`select m.codigo_interno, m.codigo_unidad, u.codigo_interno as de_la_unidad
    from public.movimientos_materiales m left join public.unidades u on u.id = m.unidad_id
    where m.material_id = $1 and m.tipo = 'SALIDA'`, [perno.id]))

  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  await ir(pagina, '/almacen/kardex')
  const abrir = pagina.getByRole('button', { name: 'Registrar salida' })
  await hidratado(abrir)
  await abrir.click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.waitFor({ timeout: 30000 }).catch(() => {})
  await ventana.locator('select[name="material_id"]').selectOption(perno.id)
  await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
  const campo = ventana.locator('#sal-codigo')
  comprobar(await campo.getAttribute('role') === 'combobox', 'el código de la unidad es el buscador de la lista, como en el RQ')
  // En el monitor, la lista entera cabe en lo que rueda la ventana: antes pasaba
  // su borde sin pasar el de la pantalla, y la mitad quedaba escondida. Y no la
  // rueda: al cerrarse volvía arriba y el clic en un botón se perdía.
  const rodadoAntes = await campo.evaluate((c) => {
    let p = c.parentElement
    while (p && !['auto', 'scroll'].includes(getComputedStyle(p).overflowY)) p = p.parentElement
    return p ? p.scrollTop : window.scrollY
  })
  await campo.click()
  const listbox = ventana.locator('[role="listbox"]')
  await listbox.waitFor({ timeout: 10000 }).catch(() => {})
  await pagina.waitForTimeout(300)
  const enLaVentana = await listbox.evaluate((ul) => {
    let p = ul.parentElement
    while (p && !['auto', 'scroll'].includes(getComputedStyle(p).overflowY)) p = p.parentElement
    return { lista: Math.round(ul.getBoundingClientRect().bottom), borde: Math.round(p ? p.getBoundingClientRect().bottom : innerHeight),
             desde: Math.round(ul.getBoundingClientRect().top), techo: Math.round(p ? p.getBoundingClientRect().top : 0),
             rodado: p ? p.scrollTop : window.scrollY, opciones: ul.querySelectorAll('[role="option"]').length }
  }).catch(() => null)
  comprobar(enLaVentana !== null && enLaVentana.opciones > 3 && enLaVentana.lista <= enLaVentana.borde
    && enLaVentana.desde >= enLaVentana.techo && enLaVentana.rodado === rodadoAntes,
    `en el monitor la lista abierta no pasa el borde de la ventana ni la rueda: ${JSON.stringify(enLaVentana)} ${rodadoAntes}`)
  const primeras = async () => (await ventana.locator('[role="option"]').allTextContents()).slice(0, 3).map((t) => t.replace(/\s+/g, ' ').trim())
  const conDisco = await primeras()
  comprobar(conDisco[0]?.startsWith('PLANTA') && conDisco[1]?.startsWith('OFICINA'),
    `con un consumible, PLANTA y OFICINA van primero: ${JSON.stringify(conDisco)}`)
  // PLANTA elegida con el perno, y después se cambia al faro: un accesorio no
  // sale a PLANTA sin un RQ que lo pida, y el campo lo dice en vez de ofrecerla
  // como código nuevo.
  await ventana.locator('[role="option"]').first().click()
  await ventana.locator('select[name="material_id"]').selectOption(faro.id)
  await pagina.waitForTimeout(200)
  const conPlanta = await texto(ventana.locator('#sal-codigo-estado')).catch(() => '')
  const bloqueo = await campo.evaluate((c) => c.validationMessage)
  comprobar(await campo.inputValue() === 'PLANTA' && conPlanta.startsWith('Un accesorio sale solo para una unidad')
    && !/como código nuevo/.test(conPlanta) && bloqueo.startsWith('Un accesorio'),
    `con el faro, PLANTA ya elegida dice por qué no va y no deja enviar: «${conPlanta}» · «${bloqueo}»`)
  // Se busca: PLANTA puede venir también en la lista, por los RQ que la usan.
  await campo.click()
  await campo.fill('planta')
  await pagina.waitForTimeout(200)
  const conFaro = (await ventana.locator('[role="option"]:not([id$="-nuevo"]) .font-mono').allTextContents()).map((t) => t.trim())
  const nuevoConFaro = await ventana.locator('[role="option"][id$="-nuevo"]').count()
  comprobar(!conFaro.includes('PLANTA') && !conFaro.includes('OFICINA') && nuevoConFaro === 0,
    `con un accesorio, buscando «planta» la lista no la ofrece, ni como código nuevo: ${JSON.stringify(conFaro.slice(0, 3))} · ${nuevoConFaro}`)
  // Buscada a medias, la lista dice por qué no está, en vez de solo «ningún código coincide».
  await campo.fill('ofi')
  await pagina.waitForTimeout(200)
  const porQue = await texto(ventana.locator('[role="listbox"] li[role="presentation"]').first()).catch(() => '')
  comprobar(porQue.startsWith('Un accesorio sale solo para una unidad'), `con un accesorio, buscando «ofi» la lista dice por qué no está: «${porQue}»`)
  await campo.fill('')
  await campo.press('Escape')
  await ventana.locator('select[name="material_id"]').selectOption(perno.id)
  await campo.click()
  await campo.fill(unidadSal.placa.toLowerCase())
  const opcion = ventana.locator('[role="option"]', { hasText: unidadSal.codigo })
  await opcion.waitFor({ timeout: 10000 }).catch(() => {})
  comprobar(await opcion.count() === 1 && (await texto(opcion)).includes('Scania R450'),
    `escribiendo la placa sale su código, con la unidad: «${await texto(opcion).catch(() => '')}»`)
  await ventana.locator('#sal-cantidad').fill('1')
  await ventana.locator('#sal-motivo').fill('Vale del banco, salida sin RQ')
  await ventana.locator('#sal-recibe').fill('Mecánico de turno')
  await ventana.locator('#sal-foto').setInputFiles(foto)
  // La placa de la unidad vale escrita: la base la vincula a ella, y el campo
  // dice adónde va (decía «se registra como está escrito»).
  await campo.press('Tab')
  await pagina.waitForTimeout(200)
  const estadoPlaca = await texto(ventana.locator('#sal-codigo-estado')).catch(() => '')
  comprobar(estadoPlaca === `Placa ${unidadSal.placa}, del Scania R450: la salida va a ${unidadSal.codigo}.`
    && await campo.evaluate((c) => c.validationMessage) === '',
    `la placa de la unidad escrita sin elegir dice adónde va la salida: «${estadoPlaca}»`)
  // Sin elegirlo, lo escrito para buscar no sale como código.
  await campo.click()
  await campo.fill('scania')
  await campo.blur()
  await ventana.getByRole('button', { name: 'Confirmar salida' }).click()
  await pagina.waitForTimeout(1000)
  const estado = await texto(ventana.locator('#sal-codigo-estado')).catch(() => '')
  comprobar((await salidas()).length === 0 && await ventana.isVisible() && /lista|nuevo/.test(estado),
    `sin elegirlo, lo escrito para buscar no se envía y debajo dice qué falta: «${estado}»`)
  // Un código nuevo confirmado tampoco se pierde al ir a «Vehículo registrado» y volver.
  const nuevo = `ZZ-NUEVO-${sufijo}`
  await campo.click()
  await campo.fill(nuevo.toLowerCase())
  await ventana.locator('[role="option"][id$="-nuevo"]').click()
  await ventana.getByRole('button', { name: 'Vehículo registrado', exact: true }).click()
  await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
  const trasVolver = await texto(ventana.locator('#sal-codigo-estado')).catch(() => '')
  const validoTrasVolver = await campo.evaluate((c) => c.validationMessage)
  comprobar(await campo.inputValue() === nuevo && validoTrasVolver === '' && !/Elígelo de la lista|confírmalo/.test(trasVolver),
    `el código nuevo confirmado sigue confirmado al volver: «${await campo.inputValue()}» «${trasVolver}» «${validoTrasVolver}»`)
  await campo.click()
  await campo.fill(unidadSal.placa.toLowerCase())
  await opcion.click()
  comprobar(await campo.inputValue() === unidadSal.codigo, `al tocarlo, el campo queda con el código: ${await campo.inputValue()}`)
  // Ir a «Vehículo registrado» y volver no borra el código elegido.
  await ventana.getByRole('button', { name: 'Vehículo registrado', exact: true }).click()
  await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
  comprobar(await campo.inputValue() === unidadSal.codigo, `ir a «Vehículo registrado» y volver no lo borra: ${await campo.inputValue()}`)
  await ventana.getByRole('button', { name: 'Confirmar salida' }).click()
  const alerta = await terminarVentana(pagina)
  const hechas = await salidas()
  comprobar(!alerta && hechas.length === 1 && hechas[0].codigo_interno === unidadSal.codigo && hechas[0].de_la_unidad === unidadSal.codigo,
    `la salida va al código elegido, vinculada a su unidad: ${JSON.stringify(hechas)} ${alerta}`)
  const dice = await texto(pagina.locator('[role="status"]', { hasText: 'Salida registrada' })).catch(() => '')
  comprobar(dice === `Salida registrada en el kardex para ${unidadSal.codigo}.`, `y lo dice con su código: «${dice}»`)
  comprobar(errores.length === 0, `sin errores de consola como Almacén ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================ 9. Lo libre y lo separado, con la cuenta de «Stock en almacén»
// Lo que «Stock en almacén» (#132) dejó para después: el kardex decía «Libre
// para salidas» con todo lo que hay, aunque una parte ya fuera de un código, y
// la salida lo ofrecía como libre para cualquier destino. Con la regla de la
// base: lo que separó un RQ se descuenta solo con una salida de ese RQ.
{
  /**
   * Un material con `n` en almacén y, por cada [código, cuánto separa, cuánto
   * pide], un RQ que lo separa. `paraUnidad`: [código, cuánto] que entró
   * marcado para una unidad (un accesorio).
   */
  async function sembrar(etiqueta, n, separaciones, { categoria = consumible, paraUnidad = [] } = {}) {
    const [m] = await consulta(`insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
      values ($1, $2, ${categoria}, ${und}) returning id::text, codigo, descripcion`, [`PRB-${etiqueta}-${sufijo}`, `${etiqueta} separado ${sufijo}`])
    for (const [codigo, cuanto] of [[null, n], ...paraUnidad].filter(([, cuanto]) => cuanto > 0)) {
      await consulta(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, codigo_interno)
        select gen_random_uuid(), 'INGRESO', $1::uuid, $4, 'INGRESO_GENERAL', $2, u.id, $5 from public.usuarios u where u.correo = $3`,
        [m.id, `GR BANCO CR ${sufijo}`, CUENTAS.almacen, cuanto, codigo])
    }
    const rqs = []
    for (const [codigo, cuanto, pide = cuanto] of separaciones) {
      const id = crypto.randomUUID()
      await como(CUENTAS.requerimientos, `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Prueba de lo separado en el kardex', null, $4::jsonb)`,
        [id, area, codigo, JSON.stringify([{ material_id: m.id, cantidad: pide }])])
      await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, $2::jsonb, null)`, [id, JSON.stringify([{ item: 1, en_stock: cuanto }])])
      rqs.push({ id, codigo, numero: await numero(id) })
    }
    return { ...m, rqs }
  }
  const stockDe = async (id) => (await como(CUENTAS.almacen,
    `select existencia::float8 as existencia, libre::float8 as libre, separado::float8 as separado
       from public.stock_libre_en_almacen(array[$1]::uuid[])`, [id]))[0]
  const codS = `BANCO-CRS${sufijo}`
  const codT = `BANCO-CRT${sufijo}`
  // Tuerca: 10 en almacén, 3 para un RQ de S y 2 para uno de T. Arandela: 4, y 2 para un RQ de PLANTA.
  // Remache: 4, y 3 + 3 para dos RQ: se separó 2 más de lo que hay.
  const tuerca = await sembrar('TUERCA', 10, [[codS, 3], [codT, 2]])
  const arandela = await sembrar('ARANDELA', 4, [['PLANTA', 2]])
  const remache = await sembrar('REMACHE', 4, [[`BANCO-CRX${sufijo}`, 3], [`BANCO-CRY${sufijo}`, 3]])
  // Taco: 10, y 2 apartados para un pedido de OT del circuito anterior, como
  // lo arma el check 306. La vista del kardex no se los cuenta a quien no ve
  // las OT, y Almacén no las ve: el kardex le decía 10 libres y la base deja sacar 8.
  const taco = await sembrar('TACO', 10, [])
  {
    const [om] = await consulta(`insert into public.ot_materiales (orden_id, material_id, cantidad, area_destino)
      values ((select id from public.ordenes_trabajo where estado <> 'ANULADA' order by numero limit 1), $1, 2, 'MTZ')
      returning id, orden_id`, [taco.id])
    const [sol] = await consulta(`insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por)
      values ($1, 'MTZ', (select id from public.usuarios where correo = $2))
      on conflict (orden_id, area_destino) do update set area_destino = excluded.area_destino returning id`, [om.orden_id, CUENTAS.almacen])
    await consulta(`insert into public.requerimiento_material_detalles (requerimiento_id, ot_material_id, cantidad_solicitada) values ($1, $2, 2)`, [sol.id, om.id])
    await consulta(`update public.requerimiento_material_detalles set aprobacion_diseno = 'APROBADO', decision_almacen = 'STOCK', cantidad_stock = 2
      where ot_material_id = $1`, [om.id])
  }
  // Faro, un accesorio: 2 en almacén y 3 que entraron para la unidad U; un RQ
  // de PLANTA pide 4 y separa 2, y uno de U separa 1 de lo de su unidad.
  const codU = `BANCO-CRU${sufijo}`
  const faro = await sembrar('FARO', 2, [['PLANTA', 2, 4], [codU, 1]], {
    categoria: `(select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1)`,
    paraUnidad: [[codU, 3]],
  })
  // Perno: 10, y dos RQ del mismo código W separan 3 y 2; el primero pide 8.
  const codW = `BANCO-CRW${sufijo}`
  const perno = await sembrar('PERNO', 10, [[codW, 3, 8], [codW, 2]])
  const [nS, nT] = [tuerca.rqs[0].numero, tuerca.rqs[1].numero]
  const s0 = await stockDe(tuerca.id)
  comprobar(s0?.libre === 5 && s0?.separado === 5, `la base da 5 libres y 5 separados de la tuerca: ${JSON.stringify(s0)}`)
  const sTaco = await stockDe(taco.id)
  const sFaro = await stockDe(faro.id)
  comprobar(sTaco?.libre === 8 && sFaro?.existencia === 5 && sFaro?.separado === 5 && sFaro?.libre === 0,
    `la base da 8 libres del taco, y del faro 5 separados: ${JSON.stringify([sTaco, sFaro])}`)

  // La ficha del material: Almacén despacha; Gerencia solo mira el kardex.
  for (const [quien, correo] of [['Almacén', CUENTAS.almacen], ['Gerencia', CUENTAS.gerencia]]) {
    const { pagina, contexto, errores } = await entrar(correo)
    await ir(pagina, `/almacen/kardex?material=${tuerca.id}`)
    const cifras = (await pagina.locator('dl > div').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim())
    const dueno = await texto(pagina.locator('[data-ya-tiene-dueno]')).catch(() => '')
    comprobar(cifras.includes('Libre, sin código 5') && !cifras.some((c) => c.startsWith('Libre para salidas'))
      && dueno.includes(`${codS} 3 UND ${nS}`) && dueno.includes(`${codT} 2 UND ${nT}`)
      && dueno.endsWith('Lo separado para un RQ sale con ese RQ.'),
      `como ${quien}, la ficha dice lo libre y de quién es lo demás, como «Stock en almacén»: ${JSON.stringify(cifras.slice(0, 2))} «${dueno}»`)
    await ir(pagina, `/almacen/kardex?material=${remache.id}`)
    const deMas = await texto(pagina.locator('[data-ya-tiene-dueno] [data-separado-de-mas]')).catch(() => '')
    comprobar(deMas === 'Se separó 2 UND más de lo que hay', `como ${quien}, la ficha avisa lo separado de más: «${deMas}»`)
    // Lo de un pedido de OT, también como Almacén, que no ve las OT.
    await ir(pagina, `/almacen/kardex?material=${taco.id}`)
    const cifrasTaco = (await pagina.locator('dl > div').allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim())
    const duenoTaco = await texto(pagina.locator('[data-ya-tiene-dueno]')).catch(() => '')
    comprobar(cifrasTaco.includes('Libre, sin código 8') && duenoTaco.includes('Pedidos de OT: 2 UND')
      && duenoTaco.endsWith('Lo de pedidos de OT sale con su despacho.'),
      `como ${quien}, lo de un pedido de OT no es libre: ${JSON.stringify(cifrasTaco.slice(0, 2))} «${duenoTaco}»`)
    comprobar(errores.length === 0, `sin errores de consola en la ficha como ${quien} ${errores.join(' | ')}`)
    await contexto.close()
  }

  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  await ir(pagina, '/almacen/kardex')
  const abrir = pagina.getByRole('button', { name: 'Registrar salida' })
  await hidratado(abrir)
  await abrir.click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.waitFor({ timeout: 30000 }).catch(() => {})
  const opcionDe = async (m) => {
    await ventana.locator('#sal-material').click()
    // La lista muestra los primeros: se busca, como lo haría Almacén.
    await ventana.getByRole('searchbox', { name: 'Código o descripción' }).fill(m.codigo)
    const opcion = ventana.locator('[role="option"]', { hasText: m.descripcion })
    await opcion.waitFor({ timeout: 10000 }).catch(() => {})
    const dice = await texto(opcion).catch(() => '')
    await opcion.click().catch(() => {})
    return dice
  }
  const campo = ventana.locator('#sal-codigo')
  const elegirCodigo = async (c) => {
    await campo.click()
    await campo.fill(c.toLowerCase())
    await ventana.locator('[role="option"]:not([id$="-nuevo"])', { hasText: c }).first().click()
    await pagina.waitForTimeout(200)
  }
  const aviso = ventana.locator('[data-aviso-de-dueno]')
  const avisa = async () => ((await aviso.count()) ? texto(aviso) : '')
  const ayudaCantidad = async () => {
    const id = await ventana.locator('#sal-cantidad').getAttribute('aria-describedby')
    return id ? (await pagina.locator(`[id="${id}"]`).textContent())?.replace(/\s+/g, ' ').trim() : ''
  }

  const opcionTuerca = await opcionDe(tuerca)
  comprobar(opcionTuerca.includes(`${tuerca.codigo} · libre 5 UND · 5 separados`), `la opción del material dice lo libre y lo separado: «${opcionTuerca}»`)
  await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
  // Sin RQ, a PLANTA: todo lo separado es de otros, y lo dice antes de enviar.
  await elegirCodigo('PLANTA')
  const aPlanta = await avisa()
  comprobar(aPlanta.startsWith('Para PLANTA puedes sacar 5 UND sin tocar lo que es de otros. Ya tiene dueño:')
    && aPlanta.includes(`3 de ${codS} (${nS})`) && aPlanta.includes(`2 de ${codT} (${nT})`),
    `sin RQ, a PLANTA, dice cuánto puede sacar y de quién es lo demás: «${aPlanta}»`)
  comprobar(await ventana.locator('[role="status"]:has([data-aviso-de-dueno])').count() === 1, 'el aviso está en una región que el lector de pantalla anuncia')
  // Sin RQ, al mismo código del RQ: lo separado por el RQ tampoco es de la salida suelta.
  await elegirCodigo(codS)
  const aS = await avisa()
  comprobar(aS.startsWith(`Para ${codS} puedes sacar 5 UND sin tocar lo que es de otros.`) && aS.includes(`3 de ${codS} (${nS})`)
    && aS.endsWith(`Si es para ${nS}, elígelo en «Requerimiento que atiende»: así se descuenta de su pedido.`),
    `sin RQ, al código del RQ, no lo da por suyo y pide elegir el RQ: «${aS}»`)
  // Un código a medio escribir no es todavía un destino.
  await campo.click()
  await campo.fill(codS.slice(0, 8).toLowerCase())
  await pagina.waitForTimeout(200)
  const aMedias = await avisa()
  comprobar(aMedias.startsWith('Puedes sacar 5 UND sin tocar lo que es de otros.'), `con el código a medio escribir no nombra uno que no existe: «${aMedias}»`)
  await campo.press('Escape')
  // Con su RQ: lo de S es suyo, el tope del RQ cabe y no avisa; la cantidad dice cuánto es de este RQ, a la vista.
  await ventana.locator('select[name="requerimiento_linea_id"]').selectOption(await insumo(tuerca.rqs[0].id))
  await pagina.waitForTimeout(200)
  const ayuda = await ayudaCantidad()
  const ayudaVisible = await ventana.locator('#sal-cantidad').evaluate((c) => {
    const id = c.getAttribute('aria-describedby')
    const e = id ? document.getElementById(id) : null
    return Boolean(e) && e.getAttribute('role') !== 'tooltip' && getComputedStyle(e).opacity !== '0'
  })
  comprobar(await aviso.count() === 0 && ayuda === 'Hay 10: 5 libres, 3 de este RQ y 2 con dueño · el RQ pide 3 más' && ayudaVisible,
    `con su RQ no avisa, y la cantidad dice cuánto es suyo a la vista: ${await aviso.count()} «${ayuda}» ${ayudaVisible}`)
  // La sale con su RQ: la base le descuenta lo separado a S, y a T no le toca.
  await ventana.locator('#sal-recibe').fill('Mecánico de turno')
  await ventana.locator('#sal-foto').setInputFiles(foto)
  await ventana.getByRole('button', { name: 'Confirmar salida' }).click()
  const alerta = await terminarVentana(pagina)
  const s1 = await stockDe(tuerca.id)
  comprobar(!alerta && s1?.existencia === 7 && s1?.separado === 2 && s1?.libre === 5,
    `con su RQ, la salida se lleva lo de S y lo libre sigue igual: ${JSON.stringify(s1)} ${alerta}`)

  // Lo de un RQ de PLANTA tampoco es de cualquier salida a PLANTA.
  await ir(pagina, '/almacen/kardex')
  await hidratado(abrir)
  await abrir.click()
  await ventana.waitFor({ timeout: 30000 }).catch(() => {})
  await opcionDe(arandela)
  await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
  await elegirCodigo('PLANTA')
  const nP = arandela.rqs[0].numero
  const aPlantaRq = await avisa()
  comprobar(aPlantaRq === `Para PLANTA puedes sacar 2 UND sin tocar lo que es de otros. Ya tiene dueño: 2 de PLANTA (${nP}). Si es para ${nP}, elígelo en «Requerimiento que atiende»: así se descuenta de su pedido.`,
    `lo separado por un RQ de PLANTA no se ofrece a otra salida a PLANTA: «${aPlantaRq}»`)
  // Lo separado de más: lo dice, y que todo ya tiene dueño.
  const opcionRemache = await opcionDe(remache)
  const deMas = await avisa()
  comprobar(opcionRemache.includes(`${remache.codigo} · libre 0 UND · 6 separados`)
    && deMas.startsWith('Se separó 2 UND más de lo que hay. Todo lo que hay ya tiene dueño: 3 de BANCO-CRX'),
    `con lo separado de más, la opción y el aviso lo dicen: «${opcionRemache}» «${deMas}»`)
  // Lo apartado para un pedido de OT no sale por aquí: la opción y el tope lo descuentan.
  const opcionTaco = await opcionDe(taco)
  const topeTaco = await ventana.locator('#sal-cantidad').getAttribute('max')
  const ayudaTaco = await ayudaCantidad()
  comprobar(opcionTaco.includes(`${taco.codigo} · libre 8 UND`) && !/separados?$/.test(opcionTaco) && topeTaco === '8'
    && ayudaTaco === 'Libre en almacén, sin contar los pedidos de OT: 8',
    `lo de un pedido de OT no se ofrece a la salida: «${opcionTaco}» tope ${topeTaco} «${ayudaTaco}»`)
  // Dos RQ del mismo código separaron el perno: con el primero, lo suyo son
  // sus 3 y lo del otro tiene dueño; pide 8 y caben 5 libres más sus 3.
  await ventana.locator('select[name="requerimiento_linea_id"]').selectOption(await insumo(perno.rqs[0].id))
  await pagina.waitForTimeout(200)
  const ayudaW = await ayudaCantidad()
  comprobar(await aviso.count() === 0 && ayudaW === 'Hay 10: 5 libres, 3 de este RQ y 2 con dueño · el RQ pide 8 más',
    `con dos RQ del mismo código, cada uno tiene lo suyo: ${await aviso.count()} «${ayudaW}»`)
  comprobar(errores.length === 0, `sin errores de consola en la salida ${errores.join(' | ')}`)
  await contexto.close()

  // Un RQ de PLANTA hacia la unidad U: lo que entró para U es de esta salida,
  // y lo que separó el RQ de U, no.
  {
    const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
    await ir(pagina, '/almacen/kardex')
    const abrir = pagina.getByRole('button', { name: 'Registrar salida' })
    await hidratado(abrir)
    await abrir.click()
    const ventana = pagina.locator('[role="dialog"]')
    await ventana.waitFor({ timeout: 30000 }).catch(() => {})
    const lineaPlanta = await insumo(faro.rqs[0].id)
    await ventana.locator('select[name="requerimiento_linea_id"]').selectOption(lineaPlanta)
    await pagina.waitForTimeout(200)
    await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
    const campo = ventana.locator('#sal-codigo')
    const elegirCodigo = async (c) => {
      await campo.click()
      await campo.fill(c.toLowerCase())
      await ventana.locator('[role="option"]:not([id$="-nuevo"])', { hasText: c }).first().click()
      await pagina.waitForTimeout(200)
    }
    const aviso = ventana.locator('[data-aviso-de-dueno]')
    const ayuda = async () => {
      const id = await ventana.locator('#sal-cantidad').getAttribute('aria-describedby')
      return id ? (await pagina.locator(`[id="${id}"]`).textContent())?.replace(/\s+/g, ' ').trim() : ''
    }
    const [, nU] = faro.rqs.map((r) => r.numero)
    const tope = ventana.locator('[data-tope-accesorio]')
    // A PLANTA: lo que entró para U sale solo para U, y el tope lo descuenta.
    await elegirCodigo('PLANTA')
    const topePlanta = (await tope.count()) ? await texto(tope) : ''
    comprobar(await aviso.count() === 0 && await ventana.locator('#sal-cantidad').getAttribute('max') === '2'
      && topePlanta === 'De este accesorio, 3 UND entraron para otras unidades y salen solo para ellas: para PLANTA quedan 2 UND.',
      `un RQ de PLANTA hacia PLANTA no toca lo de la unidad: tope ${await ventana.locator('#sal-cantidad').getAttribute('max')} «${topePlanta}»`)
    // A U: lo que sale con el RQ de PLANTA se lleva primero lo que separó el
    // RQ y después lo de U, que es el destino; lo que separó el RQ de U, no.
    await elegirCodigo(codU)
    const ayudaU = await ayuda()
    const propuesta = await ventana.locator('#sal-cantidad').inputValue()
    comprobar(await tope.count() === 0 && await aviso.count() === 0 && propuesta === '4'
      && ayudaU === 'Hay 5: 0 libres, 2 de este RQ, 2 de esta unidad y 1 con dueño · el RQ pide 4 más',
      `un RQ de PLANTA hacia la unidad cuenta lo de ella y propone lo que pide: ${await aviso.count()} «${propuesta}» «${ayudaU}»`)
    await ventana.locator('#sal-cantidad').fill('2')
    await ventana.locator('#sal-recibe').fill('Electricista de turno')
    await ventana.locator('#sal-foto').setInputFiles(foto)
    await ventana.getByRole('button', { name: 'Confirmar salida' }).click()
    const alerta = await terminarVentana(pagina)
    const sF = await stockDe(faro.id)
    const [mov] = await consulta(`select count(*)::int as n, max(cantidad)::float8 as cantidad, max(codigo_interno) as codigo,
      max(de_la_unidad)::float8 as de_la_unidad
      from public.movimientos_materiales where requerimiento_linea_id = $1 and tipo = 'SALIDA'`, [lineaPlanta])
    // Salieron los 2 del RQ de PLANTA: quedan los 3 que entraron para U, y
    // la base no se los descuenta a U otra vez.
    comprobar(!alerta && mov.n === 1 && mov.cantidad === 2 && mov.codigo === codU && mov.de_la_unidad === 0
      && sF?.existencia === 3 && sF?.separado === 3 && sF?.libre === 0,
      `la salida entra a U con el RQ de PLANTA y lo de U sigue siendo de U: ${JSON.stringify([mov, sF])} ${alerta}`)

    // Sin RQ, hacia otra unidad: lo que entró para U no se ofrece, y lo dice.
    await ir(pagina, '/almacen/kardex')
    await hidratado(abrir)
    await abrir.click()
    await ventana.waitFor({ timeout: 30000 }).catch(() => {})
    await ventana.locator('#sal-material').click()
    await ventana.getByRole('searchbox', { name: 'Código o descripción' }).fill(faro.codigo)
    await ventana.locator('[role="option"]', { hasText: faro.descripcion }).click()
    await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
    await elegirCodigo(codS)
    const topeS = (await tope.count()) ? await texto(tope) : ''
    // Con el tope en cero, el motivo va junto a la cantidad y no deja confirmar.
    const motivoS = await ayuda()
    const confirmar = ventana.getByRole('button', { name: 'Confirmar salida' })
    comprobar(await ventana.locator('#sal-cantidad').getAttribute('max') === '0'
      && topeS === `De este accesorio, 3 UND entraron para otras unidades y salen solo para ellas: no queda nada para ${codS}.`
      && motivoS === `Hacia ${codS} no sale nada de este accesorio.` && await confirmar.isDisabled(),
      `hacia otra unidad, lo que entró para U no sale, y no deja confirmar: tope ${await ventana.locator('#sal-cantidad').getAttribute('max')} «${topeS}» «${motivoS}» ${await confirmar.isDisabled()}`)
    // Sin RQ, hacia U: lo de la unidad es suyo; lo que separó su RQ, no.
    await elegirCodigo(codU)
    const aUsinRq = (await aviso.count()) ? await texto(aviso) : ''
    comprobar(await tope.count() === 0
      && aUsinRq === `Para ${codU} puedes sacar 2 UND sin tocar lo que es de otros. Ya tiene dueño: 1 de ${codU} (${nU}). Si es para ${nU}, elígelo en «Requerimiento que atiende»: así se descuenta de su pedido.`,
      `sin RQ hacia U, saca lo de la unidad y no lo de su RQ: «${aUsinRq}»`)
    comprobar(errores.length === 0, `sin errores de consola en la salida del faro ${errores.join(' | ')}`)
    await contexto.close()
  }

  // Una unidad registrada, con su placa: lo que entró para ella cuenta aunque
  // Almacén escriba la placa en vez del código, y lo que pasa de lo separado
  // por un RQ de PLANTA se le descuenta a ella (antes no se le descontaba a nadie).
  {
    const unidadP = { codigo: `BANCO-CRP${sufijo}`, placa: `PL${sufijo[0]}-${sufijo.slice(1)}` }
    await consulta(`insert into public.unidades (codigo_interno, placa, marca, modelo) values ($1, $2, 'Volvo', 'FH')`,
      [unidadP.codigo, unidadP.placa])
    const faroP = await sembrar('FAROP', 2, [['PLANTA', 2, 4]], {
      categoria: `(select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1)`,
      paraUnidad: [[unidadP.codigo, 3]],
    })
    const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
    const ventana = pagina.locator('[role="dialog"]')
    const abrirVentana = async () => {
      await ir(pagina, '/almacen/kardex')
      const abrir = pagina.getByRole('button', { name: 'Registrar salida' })
      await hidratado(abrir)
      await abrir.click()
      await ventana.waitFor({ timeout: 30000 }).catch(() => {})
    }
    const campo = ventana.locator('#sal-codigo')
    // Con un espacio en vez del guion: es la misma placa, por sus letras y números.
    const placaEscrita = unidadP.placa.replace('-', ' ').toLowerCase()
    const conLaPlaca = async () => {
      await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
      await campo.click()
      await campo.fill(placaEscrita)
      await pagina.waitForTimeout(200)
      const nuevo = await ventana.locator('[role="option"][id$="-nuevo"]').count()
      await campo.press('Tab')
      await pagina.waitForTimeout(200)
      return { nuevo, estado: await texto(ventana.locator('#sal-codigo-estado')).catch(() => '') }
    }
    const ayuda = async () => {
      const id = await ventana.locator('#sal-cantidad').getAttribute('aria-describedby')
      return id ? (await pagina.locator(`[id="${id}"]`).textContent())?.replace(/\s+/g, ' ').trim() : ''
    }
    const stock = async () => (await como(CUENTAS.almacen,
      `select existencia::float8 as existencia, libre::float8 as libre, separado::float8 as separado
         from public.stock_libre_en_almacen(array[$1]::uuid[])`, [faroP.id]))[0]
    await abrirVentana()
    const lineaP = await insumo(faroP.rqs[0].id)
    await ventana.locator('select[name="requerimiento_linea_id"]').selectOption(lineaP)
    await pagina.waitForTimeout(200)
    const placaP = await conLaPlaca()
    // Decía «No está en la lista: se registra como está escrito» y la ofrecía como código nuevo.
    comprobar(placaP.nuevo === 0 && placaP.estado === `Placa ${unidadP.placa}, del Volvo FH: la salida va a ${unidadP.codigo}.`,
      `la placa de una unidad con código dice adónde va la salida y no se ofrece como código nuevo: ${placaP.nuevo} «${placaP.estado}»`)
    const ayudaP = await ayuda()
    const propuestaP = await ventana.locator('#sal-cantidad').inputValue()
    comprobar(await campo.inputValue() === placaEscrita && await ventana.locator('[data-tope-accesorio]').count() === 0
      && await ventana.locator('[data-aviso-de-dueno]').count() === 0 && propuestaP === '4'
      && ayudaP === 'Hay 5: 0 libres, 2 de este RQ y 3 de esta unidad · el RQ pide 4 más',
      `con la placa escrita, lo que entró para su unidad es de esta salida: «${await campo.inputValue()}» «${propuestaP}» «${ayudaP}»`)
    await ventana.locator('#sal-recibe').fill('Electricista de turno')
    await ventana.locator('#sal-foto').setInputFiles(foto)
    await ventana.getByRole('button', { name: 'Confirmar salida' }).click()
    const alerta = await terminarVentana(pagina)
    const [mov] = await consulta(`select m.cantidad::float8 as cantidad, m.codigo_interno as codigo, u.codigo_interno as unidad,
        m.de_la_unidad::float8 as de_la_unidad
      from public.movimientos_materiales m left join public.unidades u on u.id = m.unidad_id
      where m.requerimiento_linea_id = $1 and m.tipo = 'SALIDA'`, [lineaP])
    const sP = await stock()
    // Salen los 4 que propone: 2 del RQ y 2 de la unidad, que queda con 1.
    comprobar(!alerta && mov?.cantidad === 4 && mov.codigo === unidadP.codigo && mov.unidad === unidadP.codigo && mov.de_la_unidad === 2
      && sP?.existencia === 1 && sP?.separado === 1 && sP?.libre === 0,
      `lo que pasa de lo separado por el RQ se le descuenta a la unidad: ${JSON.stringify([mov, sP])} ${alerta}`)
    // Sin RQ, con la placa: sale lo que le queda a la unidad, y el mensaje dice su código.
    await abrirVentana()
    await ventana.locator('#sal-material').click()
    await ventana.getByRole('searchbox', { name: 'Código o descripción' }).fill(faroP.codigo)
    await ventana.locator('[role="option"]', { hasText: faroP.descripcion }).click()
    await conLaPlaca()
    const ayudaSinRq = await ayuda()
    comprobar(await ventana.locator('[data-tope-accesorio]').count() === 0 && ayudaSinRq === 'Hay 1: 0 libres y 1 de esta unidad',
      `sin RQ, con la placa, el último faro es de esta unidad: «${ayudaSinRq}»`)
    await ventana.locator('#sal-cantidad').fill('1')
    await ventana.locator('#sal-motivo').fill('Vale del banco, faro con la placa')
    await ventana.locator('#sal-recibe').fill('Electricista de turno')
    await ventana.locator('#sal-foto').setInputFiles(foto)
    await ventana.getByRole('button', { name: 'Confirmar salida' }).click()
    const alertaSinRq = await terminarVentana(pagina)
    const dice = await texto(pagina.locator('[role="status"]', { hasText: 'Salida registrada' })).catch(() => '')
    const sP2 = await stock()
    comprobar(!alertaSinRq && dice === `Salida registrada en el kardex para ${unidadP.codigo}.` && sP2?.existencia === 0 && sP2?.libre === 0,
      `con la placa, el mensaje dice el código de la unidad y no la placa: «${dice}» ${JSON.stringify(sP2)} ${alertaSinRq}`)
    // Los 3 que hay entraron para la unidad, y un RQ de PLANTA separó 2 igual: lo
    // del RQ no está aparte de lo de la unidad, y la base se lo descuenta a ella.
    // La ayuda lo dice así, y no «2 de este RQ». Almacén escribe la cantidad
    // antes de elegir el destino, y elegirlo no se la cambia por la propuesta.
    const faroD = await sembrar('FAROD', 0, [['PLANTA', 2]], {
      categoria: `(select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1)`,
      paraUnidad: [[unidadP.codigo, 3]],
    })
    await abrirVentana()
    const lineaD = await insumo(faroD.rqs[0].id)
    await ventana.locator('select[name="requerimiento_linea_id"]').selectOption(lineaD)
    await pagina.waitForTimeout(200)
    await ventana.locator('#sal-cantidad').fill('1')
    await conLaPlaca()
    const ayudaD = await ayuda()
    const avisoD = (await ventana.locator('[data-aviso-de-dueno]').count()) ? await texto(ventana.locator('[data-aviso-de-dueno]')) : ''
    const escritaD = await ventana.locator('#sal-cantidad').inputValue()
    comprobar(ayudaD === 'Hay 3: 0 libres y 3 de esta unidad · el RQ pide 2 más'
      && avisoD === `Se separó 2 UND más de lo que hay. Para ${faroD.rqs[0].numero} puedes sacar 2 UND sin tocar lo que es de otros.`,
      `lo que el RQ de PLANTA separó encima de lo de la unidad no se da por del RQ: «${ayudaD}» «${avisoD}»`)
    comprobar(escritaD === '1', `la cantidad escrita antes de elegir el destino se queda: «${escritaD}»`)
    await ventana.getByRole('button', { name: 'Vehículo registrado', exact: true }).click()
    await pagina.waitForTimeout(200)
    await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
    await pagina.waitForTimeout(200)
    const escritaD2 = await ventana.locator('#sal-cantidad').inputValue()
    comprobar(escritaD2 === '1' && await campo.inputValue() === placaEscrita,
      `y tampoco cambia al ir a «Vehículo registrado» y volver: «${escritaD2}» «${await campo.inputValue()}»`)
    await ventana.locator('#sal-recibe').fill('Electricista de turno')
    await ventana.locator('#sal-foto').setInputFiles(foto)
    await ventana.getByRole('button', { name: 'Confirmar salida' }).click()
    const alertaD = await terminarVentana(pagina)
    const diceD = await texto(pagina.locator('[role="status"]', { hasText: 'Salida registrada' })).catch(() => '')
    const [movD] = await consulta(`select cantidad::float8 as cantidad, de_la_unidad::float8 as de_la_unidad
      from public.movimientos_materiales where requerimiento_linea_id = $1 and tipo = 'SALIDA'`, [lineaD])
    const sD = (await como(CUENTAS.almacen,
      `select existencia::float8 as existencia, libre::float8 as libre, separado::float8 as separado
         from public.stock_libre_en_almacen(array[$1]::uuid[])`, [faroD.id]))[0]
    // Sale el 1 que se escribió, de lo de la unidad, que queda con 2; al RQ le falta 1.
    comprobar(!alertaD && movD?.cantidad === 1 && movD.de_la_unidad === 1
      && sD?.existencia === 2 && sD?.separado === 3 && sD?.libre === 0,
      `y la base guarda lo escrito y se lo descuenta a la unidad: ${JSON.stringify([movD, sD])} ${alertaD}`)
    comprobar(diceD === `Salida registrada y descontada del requerimiento: 1 UND salió de lo que entró para ${unidadP.codigo}.`,
      `el mensaje dice cuánto salió de lo de la unidad: «${diceD}»`)
    // Lo escrito que pasa del tope del destino elegido después se dice junto a
    // la cantidad (antes solo lo frenaba la burbuja del navegador al confirmar).
    // Y el mismo número que se proponía, tecleado encima, cuenta como escrito:
    // React no avisaba ese tecleo, y al elegir el destino salía la propuesta
    // nueva (4) en vez de los 2 tecleados.
    const faroE = await sembrar('FAROE', 2, [['PLANTA', 2, 4]], {
      categoria: `(select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1)`,
      paraUnidad: [[unidadP.codigo, 3]],
    })
    const lineaE = await insumo(faroE.rqs[0].id)
    const cantidadE = ventana.locator('#sal-cantidad')
    const codQ = `BANCO-CRQ${sufijo}`
    await abrirVentana()
    await ventana.locator('select[name="requerimiento_linea_id"]').selectOption(lineaE)
    await pagina.waitForTimeout(200)
    await cantidadE.fill('3')
    await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
    await campo.click()
    await campo.fill(codQ)
    await ventana.locator('[role="option"][id$="-nuevo"]').click()
    await pagina.waitForTimeout(200)
    const dichoE = await ayuda()
    comprobar(await cantidadE.getAttribute('aria-invalid') === 'true' && dichoE === `Hacia ${codQ} sale como máximo 2 UND de este accesorio.`,
      `lo escrito que pasa del tope del destino lo dice junto a la cantidad: ${await cantidadE.getAttribute('aria-invalid')} «${dichoE}»`)
    await abrirVentana()
    await ventana.locator('select[name="requerimiento_linea_id"]').selectOption(lineaE)
    await pagina.waitForTimeout(200)
    const propuestaE = await cantidadE.inputValue()
    await cantidadE.click()
    await pagina.keyboard.press('Control+A')
    await pagina.keyboard.type(propuestaE)
    await conLaPlaca()
    const tecleadaE = await cantidadE.inputValue()
    comprobar(propuestaE === '2' && tecleadaE === '2',
      `el mismo número tecleado encima de la propuesta no cambia al elegir el destino: «${propuestaE}» → «${tecleadaE}»`)
    await ventana.locator('#sal-recibe').fill('Electricista de turno')
    await ventana.locator('#sal-foto').setInputFiles(foto)
    await ventana.getByRole('button', { name: 'Confirmar salida' }).click()
    const alertaE = await terminarVentana(pagina)
    const [movE] = await consulta(`select cantidad::float8 as cantidad, codigo_interno as codigo from public.movimientos_materiales
      where requerimiento_linea_id = $1 and tipo = 'SALIDA'`, [lineaE])
    comprobar(!alertaE && movE?.cantidad === 2 && movE.codigo === unidadP.codigo,
      `y la base guarda los 2 tecleados: ${JSON.stringify(movE)} ${alertaE}`)

    // Un RQ de PLANTA de dos ítems, desde «Atención»: al seguir con el ítem 2,
    // el aviso dice cuánto del ítem 1 salió de lo que entró para la unidad (el
    // mensaje de la salida solo se veía al cerrar la ventana).
    const faroF = await sembrar('FAROF', 0, [], {
      categoria: `(select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1)`,
      paraUnidad: [[unidadP.codigo, 3]],
    })
    const clavoF = await sembrar('CLAVOF', 4, [])
    const rqF2 = crypto.randomUUID()
    await como(CUENTAS.requerimientos, `select public.emitir_requerimiento($1, 'OPERACION', $2, 'PLANTA', 'Prueba de dos ítems hacia una unidad', null, $3::jsonb)`,
      [rqF2, area, JSON.stringify([{ material_id: faroF.id, cantidad: 2 }, { material_id: clavoF.id, cantidad: 1 }])])
    await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, $2::jsonb, null)`,
      [rqF2, JSON.stringify([{ item: 1, en_stock: 2 }, { item: 2, en_stock: 1 }])])
    const nF2 = await numero(rqF2)
    await ir(pagina, `/almacen/kardex?rq=${rqF2}`)
    await ventana.waitFor({ timeout: 60000 }).catch(() => {})
    await hidratado(ventana.locator('#sal-cantidad'))
    await ventana.locator('#sal-cantidad').fill('1')
    await conLaPlaca()
    await ventana.locator('#sal-recibe').fill('Electricista de turno')
    await ventana.locator('#sal-foto').setInputFiles(foto)
    await ventana.getByRole('button', { name: 'Confirmar salida' }).click()
    const sigueF = ventana.getByText(/Sigue el ítem 2/)
    await sigueF.waitFor({ timeout: 60000 }).catch(() => {})
    const dichoF = await texto(sigueF).catch(() => '')
    const [movF] = await consulta(`select de_la_unidad::float8 as de_la_unidad from public.movimientos_materiales
      where requerimiento_linea_id = $1 and tipo = 'SALIDA'`, [await insumo(rqF2)])
    comprobar(dichoF === `Salida del ítem 1 registrada: 1 UND salió de lo que entró para ${unidadP.codigo}. Sigue el ítem 2 de ${nF2}.`
      && movF?.de_la_unidad === 1,
      `al seguir con el ítem 2, el aviso dice lo que salió de lo de la unidad: «${dichoF}» ${JSON.stringify(movF)}`)
    await pagina.keyboard.press('Escape')

    // Un vehículo registrado sin código interno: el accesorio no sale hacia él,
    // y la ventana lo dice antes de la foto (la base lo rechazaba después).
    const sinCodigo = { placa: `SC${sufijo[0]}-${sufijo.slice(1)}` }
    ;[{ id: sinCodigo.id }] = await consulta(`insert into public.unidades (codigo_interno, placa, marca, modelo) values (null, $1, 'Volvo', 'FH')
      returning id::text`, [sinCodigo.placa])
    await abrirVentana()
    await ventana.locator('#sal-material').click()
    await ventana.getByRole('searchbox', { name: 'Código o descripción' }).fill(faroD.codigo)
    await ventana.locator('[role="option"]', { hasText: faroD.descripcion }).click()
    await ventana.getByRole('button', { name: 'Vehículo registrado', exact: true }).click()
    await ventana.locator('#sal-unidad').click()
    await ventana.getByRole('searchbox', { name: 'Placa, código interno u OT' }).fill(sinCodigo.placa)
    const opcionSc = ventana.locator('[role="option"]', { hasText: sinCodigo.placa }).first()
    const enLaLista = await texto(opcionSc)
    const detalleSc = await texto(opcionSc.locator('span.block')).catch(() => '')
    await opcionSc.click()
    await pagina.waitForTimeout(300)
    const motivoVehiculo = await ventana.getByText('Este vehículo no tiene código interno', { exact: false }).count()
    const confirmarSc = ventana.getByRole('button', { name: 'Confirmar salida' })
    comprobar(motivoVehiculo === 1 && await confirmarSc.isDisabled(),
      `hacia un vehículo sin código interno, un accesorio no sale y la ventana lo dice: ${motivoVehiculo} ${await confirmarSc.isDisabled()}`)
    const elegidoSc = ventana.locator('#sal-unidad')
    comprobar(detalleSc.startsWith('Sin código interno') && await elegidoSc.locator('svg').count() === 0
      && (await elegidoSc.getAttribute('class'))?.includes('border-peligro'),
      `la lista lo dice antes de elegirlo, primero en el detalle, y elegido no sale con la marca de bien elegido: «${enLaLista}» «${detalleSc}» ${await elegidoSc.locator('svg').count()}`)
    await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
    await campo.click()
    await campo.fill(sinCodigo.placa)
    await pagina.waitForTimeout(300)
    // Lo visible: con la lista abierta lo dice ella, y debajo del campo queda invisible.
    const motivoPlaca = await ventana.getByText('Esa placa es de un vehículo sin código interno', { exact: false }).filter({ visible: true }).count()
    const comoNuevo = await ventana.locator('[role="option"][id$="-nuevo"]').count()
    comprobar(motivoPlaca === 1 && comoNuevo === 0 && await confirmarSc.isDisabled(),
      `y con su placa escrita como código, la lista dice por qué y no la ofrece como código nuevo: ${motivoPlaca} ${comoNuevo} ${await confirmarSc.isDisabled()}`)
    // Sale del campo con el teclado: con la lista abierta encima, el clic no llega a otro campo.
    await campo.press('Tab')
    await pagina.waitForTimeout(200)
    const motivoCerrada = await ventana.getByText('Esa placa es de un vehículo sin código interno', { exact: false }).count()
    const seRegistra = await ventana.getByText('se registra como está escrito', { exact: false }).count()
    comprobar(motivoCerrada === 1 && seRegistra === 0 && await campo.getAttribute('aria-invalid') === 'true',
      `con la lista cerrada, el campo lo sigue diciendo, sin «se registra como está escrito»: ${motivoCerrada} ${seRegistra}`)
    // Sin guion o con un espacio es la misma placa: antes la ofrecía como código
    // nuevo, dejaba confirmar y el accesorio salía hacia ella.
    for (const escrita of [sinCodigo.placa.replace('-', ''), sinCodigo.placa.replace('-', ' ').toLowerCase()]) {
      await campo.click()
      await campo.fill(escrita)
      await pagina.waitForTimeout(300)
      const motivoOtra = await ventana.getByText('Esa placa es de un vehículo sin código interno', { exact: false }).filter({ visible: true }).count()
      const nuevoOtra = await ventana.locator('[role="option"][id$="-nuevo"]').count()
      comprobar(motivoOtra === 1 && nuevoOtra === 0 && await confirmarSc.isDisabled(),
        `la placa escrita «${escrita}» es el mismo vehículo sin código: ${motivoOtra} ${nuevoOtra} ${await confirmarSc.isDisabled()}`)
      await campo.press('Tab')
      await pagina.waitForTimeout(200)
    }
    await pagina.keyboard.press('Escape')

    // Un código de la lista es ese código aunque se escriba como la placa de un
    // vehículo sin código: Requerimientos usa la placa sin guion como código. La
    // ventana lo escondía y daba el motivo de la placa, y el consumible salía
    // vinculado al vehículo, sin código y fuera de su costeo. Sale al código y
    // queda en el vehículo, que la lleva al costeo de su OT.
    const codPlaca = sinCodigo.placa.replace('-', '')
    const faroQ = await sembrar('FAROQ', 2, [], {
      categoria: `(select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1)`,
    })
    const discoQ = await sembrar('DISCOQ', 2, [[codPlaca, 0, 1]])
    for (const m of [faroQ, discoQ]) {
      await abrirVentana()
      await ventana.locator('#sal-material').click()
      await ventana.getByRole('searchbox', { name: 'Código o descripción' }).fill(m.codigo)
      await ventana.locator('[role="option"]', { hasText: m.descripcion }).click()
      await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
      await campo.click()
      await campo.fill(codPlaca.toLowerCase())
      await pagina.waitForTimeout(300)
      const ofrecido = await ventana.locator('[role="option"]', { hasText: codPlaca }).count()
      const motivoQ = await ventana.getByText('Esa placa es de', { exact: false }).count()
      await campo.press('Tab')
      await ventana.locator('#sal-cantidad').fill('1')
      await ventana.locator('#sal-motivo').fill('Vale del banco, código igual a una placa')
      await ventana.locator('#sal-recibe').fill('Electricista de turno')
      await ventana.locator('#sal-foto').setInputFiles(foto)
      // Si la ventana no deja confirmar, se dice y se sigue con lo demás.
      const confirmarQ = ventana.getByRole('button', { name: 'Confirmar salida' })
      const sePuedeQ = await confirmarQ.isEnabled()
      if (sePuedeQ) await confirmarQ.click()
      else await pagina.keyboard.press('Escape')
      const alertaQ = sePuedeQ ? await terminarVentana(pagina) : 'no deja confirmar'
      const diceQ = await texto(pagina.locator('[role="status"]', { hasText: 'Salida registrada' })).catch(() => '')
      const [movQ] = await consulta(`select codigo_interno as codigo, unidad_id from public.movimientos_materiales
        where material_id = $1 and tipo = 'SALIDA'`, [m.id])
      comprobar(ofrecido > 0 && motivoQ === 0 && !alertaQ && diceQ === `Salida registrada en el kardex para ${codPlaca}.`
        && movQ?.codigo === codPlaca && movQ.unidad_id === sinCodigo.id,
        `${m === faroQ ? 'el accesorio' : 'el consumible'} sale al código de la lista escrito como la placa de un vehículo sin código: ${ofrecido} ${motivoQ} «${diceQ}» ${JSON.stringify(movQ)} ${alertaQ}`)
    }

    // El código que Requerimientos le puso al vehículo sin código, escrito de
    // otra manera que su placa: la placa sola no llevaba a él, y la ventana no
    // lo nombraba. Ahora lo nombra con el vehículo elegido y con su placa
    // escrita, y lo ofrece para tocarlo.
    const faroR = await sembrar('FAROR', 2, [], {
      categoria: `(select id from public.categorias_material where activo and almacen = 'ACCESORIOS' order by codigo limit 1)`,
    })
    await abrirVentana()
    await ventana.locator('#sal-material').click()
    await ventana.getByRole('searchbox', { name: 'Código o descripción' }).fill(faroR.codigo)
    await ventana.locator('[role="option"]', { hasText: faroR.descripcion }).click()
    await ventana.getByRole('button', { name: 'Vehículo registrado', exact: true }).click()
    await ventana.locator('#sal-unidad').click()
    await ventana.getByRole('searchbox', { name: 'Placa, código interno u OT' }).fill(sinCodigo.placa)
    await ventana.locator('[role="option"]', { hasText: sinCodigo.placa }).first().click()
    await pagina.waitForTimeout(300)
    const avisoR = await texto(ventana.getByText('Este vehículo no tiene código interno', { exact: false })).catch(() => '')
    comprobar(avisoR.endsWith(`En la lista de códigos está ${codPlaca}: úsalo si es el suyo.`),
      `elegido el vehículo sin código, la ventana nombra el código que le puso Requerimientos: «${avisoR}»`)
    // Y lo deja usar de un toque: había que ir a «Código de unidad» y escribirlo de memoria.
    const usarR = ventana.getByRole('button', { name: `Usar ${codPlaca}`, exact: true })
    const hayUsarR = await usarR.count()
    if (hayUsarR === 1) await usarR.click()
    await pagina.waitForTimeout(300)
    const valorUsarR = await campo.inputValue().catch(() => '')
    const focoUsarR = await pagina.evaluate(() => document.activeElement?.id ?? '')
    const estadoUsarR = await texto(ventana.locator('#sal-codigo-estado')).catch(() => '')
    const quedaR = await texto(ventana.locator('p.text-texto-suave', { hasText: 'La salida queda en el' })).catch(() => '')
    // Lo anuncia la región que siempre está: la nota nace con su texto.
    const regionR = await texto(ventana.locator('p[role="status"].sr-only')).catch(() => '')
    // El foco va al botón «Código de unidad», no al campo: en el teléfono abría el
    // teclado sin nada que escribir. Y el código dice de qué vehículo es: decía
    // «Sin unidad registrada», y la salida queda en él.
    comprobar(hayUsarR === 1 && valorUsarR === codPlaca && focoUsarR === 'sal-destino-codigo' && await ventana.locator('[role="listbox"]').count() === 0
      && estadoUsarR === `${sinCodigo.placa} · Volvo FH · sin código en el padrón`
      && quedaR === `La salida queda en el Volvo FH ${sinCodigo.placa} y el gasto va a ${codPlaca}.` && regionR === quedaR,
      `«Usar ${codPlaca}» pasa a «Código de unidad» con ese código, sin abrir la lista, y dice que la salida queda en el vehículo: ${hayUsarR} «${valorUsarR}» ${focoUsarR} «${estadoUsarR}» «${quedaR}» «${regionR}»`)
    // Sin el botón, la prueba sigue por «Código de unidad», como antes.
    if (hayUsarR !== 1) await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
    await campo.click()
    await campo.fill(sinCodigo.placa.toLowerCase())
    await pagina.waitForTimeout(300)
    const enListaR = await ventana.locator('[role="option"]', { hasText: codPlaca }).count()
    await campo.press('Tab')
    await pagina.waitForTimeout(200)
    const motivoR = await texto(ventana.locator('#sal-codigo-estado')).catch(() => '')
    const cambiarR = ventana.getByRole('button', { name: `Cambiar a ${codPlaca}` })
    const botonR = await cambiarR.count()
    comprobar(enListaR > 0 && botonR === 1
      && motivoR.startsWith(`Esa placa es de un vehículo sin código interno. En la lista está ${codPlaca}: elígelo si es el suyo.`),
      `con su placa escrita, el campo nombra ese código, lo deja en la lista y lo ofrece: ${enListaR} ${botonR} «${motivoR}»`)
    if (botonR === 1) await cambiarR.click()
    await pagina.waitForTimeout(200)
    await ventana.locator('#sal-cantidad').fill('1')
    await ventana.locator('#sal-motivo').fill('Vale del banco, el código que ofrece la placa')
    await ventana.locator('#sal-recibe').fill('Electricista de turno')
    await ventana.locator('#sal-foto').setInputFiles(foto)
    const confirmarR = ventana.getByRole('button', { name: 'Confirmar salida' })
    const sePuedeR = await confirmarR.isEnabled()
    if (sePuedeR) await confirmarR.click()
    else await pagina.keyboard.press('Escape')
    const alertaR = sePuedeR ? await terminarVentana(pagina) : 'no deja confirmar'
    const [movR] = await consulta(`select codigo_interno as codigo, unidad_id from public.movimientos_materiales
      where material_id = $1 and tipo = 'SALIDA'`, [faroR.id])
    comprobar(!alertaR && movR?.codigo === codPlaca && movR.unidad_id === sinCodigo.id,
      `al tocar «Cambiar a ${codPlaca}», el accesorio sale a ese código y queda en el vehículo: ${JSON.stringify(movR)} ${alertaR}`)
    // Un consumible sí sale al vehículo por su placa; el campo dice que en la
    // lista está su código, por si el gasto es de él.
    const discoR = await sembrar('DISCOR', 2, [])
    await abrirVentana()
    await ventana.locator('#sal-material').click()
    await ventana.getByRole('searchbox', { name: 'Código o descripción' }).fill(discoR.codigo)
    await ventana.locator('[role="option"]', { hasText: discoR.descripcion }).click()
    await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
    await campo.click()
    await campo.fill(sinCodigo.placa.toLowerCase())
    await pagina.waitForTimeout(300)
    await campo.press('Tab')
    await pagina.waitForTimeout(200)
    const estadoR = await texto(ventana.locator('#sal-codigo-estado')).catch(() => '')
    comprobar(estadoR.startsWith(`Placa ${sinCodigo.placa}, del Volvo FH, sin código interno: la salida va al vehículo y no a un código.`)
      && estadoR.includes(`En la lista está ${codPlaca}: elígelo si es el suyo, y el gasto va a ese código.`)
      && await ventana.getByRole('button', { name: `Cambiar a ${codPlaca}` }).count() === 1,
      `con un consumible, la placa va al vehículo y el campo ofrece su código: «${estadoR}»`)
    // Por «Vehículo registrado», el mismo consumible avisa que su código está en
    // la lista y lo deja usar, sin frenar: salía sin código y sin decir nada.
    await ventana.getByRole('button', { name: 'Vehículo registrado', exact: true }).click()
    await ventana.locator('#sal-unidad').click()
    await ventana.getByRole('searchbox', { name: 'Placa, código interno u OT' }).fill(sinCodigo.placa)
    await ventana.locator('[role="option"]', { hasText: sinCodigo.placa }).first().click()
    await pagina.waitForTimeout(300)
    const avisoConsumible = await texto(ventana.locator('p.text-aviso', { hasText: 'Este vehículo no tiene código interno' })).catch(() => '')
    const regionConsumible = await texto(ventana.locator('p[role="status"].sr-only')).catch(() => '')
    const usarConsumible = await ventana.getByRole('button', { name: `Usar ${codPlaca}`, exact: true }).count()
    const errorConsumible = await ventana.locator('[role="alert"]', { hasText: 'Este vehículo no tiene código interno' }).count()
    comprobar(avisoConsumible === `Este vehículo no tiene código interno: la salida queda en él, sin código. En la lista de códigos está ${codPlaca}: úsalo si el gasto es de él.`
      && regionConsumible === avisoConsumible && usarConsumible === 1 && errorConsumible === 0 && await ventana.getByRole('button', { name: 'Confirmar salida' }).isEnabled(),
      `con un consumible, el vehículo sin código avisa que su código está en la lista y lo ofrece, sin frenar: «${avisoConsumible}» «${regionConsumible}» ${usarConsumible} ${errorConsumible}`)
    await pagina.keyboard.press('Escape')
    comprobar(errores.length === 0, `sin errores de consola en la salida con la placa ${errores.join(' | ')}`)
    await contexto.close()
  }

  // Dos vehículos con la misma placa por sus letras y números, uno sin código
  // y otro con código, de un cliente: la placa tal cual es su vehículo, y la
  // que es de los dos no deja confirmar (salía como código nuevo, de nadie).
  {
    const sinCodigoV = { placa: `CV${sufijo[0]}-${sufijo.slice(1)}` }
    const conCodigoV = { placa: `CV${sufijo}`, codigo: `BANCO-CRV${sufijo}` }
    ;[{ id: conCodigoV.id }] = await consulta(`insert into public.unidades (codigo_interno, placa, marca, modelo, cliente_id) values
      (null, $1, 'Isuzu', 'NPR', null),
      ($2, $3, 'Hino', '500', (select id from public.clientes order by creado_en limit 1))
      returning id::text, codigo_interno`,
      [sinCodigoV.placa, conCodigoV.codigo, conCodigoV.placa]).then((filas) => filas.filter((f) => f.codigo_interno !== null))
    // Un RQ cuyo código es la placa del vehículo con código: la placa sigue
    // siendo la de ese vehículo, y con el RQ elegido sale con el código del RQ.
    // Separa 2 y sale 1: le queda uno, para ver el aviso de un RQ del que ya salió algo.
    const discoV = await sembrar('DISCOV', 3, [[conCodigoV.placa, 2, 2]])
    const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
    const ventana = pagina.locator('[role="dialog"]')
    await ir(pagina, '/almacen/kardex')
    const abrir = pagina.getByRole('button', { name: 'Registrar salida' })
    await hidratado(abrir)
    await abrir.click()
    await ventana.waitFor({ timeout: 30000 }).catch(() => {})
    await ventana.locator('#sal-material').click()
    await ventana.getByRole('searchbox', { name: 'Código o descripción' }).fill(discoV.codigo)
    await ventana.locator('[role="option"]', { hasText: discoV.descripcion }).click()
    await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
    const campo = ventana.locator('#sal-codigo')
    const confirmar = ventana.getByRole('button', { name: 'Confirmar salida' })
    await campo.click()
    await campo.fill(`cv${sufijo[0]} ${sufijo.slice(1)}`)
    await pagina.waitForTimeout(300)
    const motivoV = await ventana.getByText('Esa placa es de más de un vehículo registrado', { exact: false }).filter({ visible: true }).count()
    const nuevoV = await ventana.locator('[role="option"][id$="-nuevo"]').count()
    await campo.press('Tab')
    await pagina.waitForTimeout(200)
    comprobar(motivoV === 1 && nuevoV === 0 && await confirmar.isDisabled(),
      `la placa de dos vehículos no sale como código nuevo y no deja confirmar: ${motivoV} ${nuevoV} ${await confirmar.isDisabled()}`)
    await campo.click()
    await campo.fill(conCodigoV.placa.toLowerCase())
    await pagina.waitForTimeout(300)
    // La placa también está en la lista (un RQ la usa de código): la lista filtra
    // por lo escrito y trae el código del vehículo. Abría el catálogo entero,
    // empezando por PLANTA, y no el código al que va la salida.
    const listaV = (await ventana.locator('[role="option"]').allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim())
    comprobar(listaV.length > 0 && listaV.length <= 3 && listaV.some((t) => t.startsWith(conCodigoV.codigo))
      && !listaV.some((t) => t.startsWith('PLANTA')),
      `con la placa de un vehículo con código que también está en la lista, la lista trae su código y no el catálogo: ${listaV.length} ${JSON.stringify(listaV.slice(0, 3))}`)
    await campo.press('Tab')
    await pagina.waitForTimeout(200)
    const estadoV = await texto(ventana.locator('#sal-codigo-estado')).catch(() => '')
    comprobar(estadoV === `Placa ${conCodigoV.placa}, del Hino 500: la salida va a ${conCodigoV.codigo}.`,
      `la placa tal cual es la del vehículo con código, aunque un RQ la tenga de código: «${estadoV}»`)
    await campo.click()
    await campo.fill(sinCodigoV.placa.toLowerCase())
    await pagina.waitForTimeout(300)
    await campo.press('Tab')
    await pagina.waitForTimeout(200)
    const estadoSinV = await texto(ventana.locator('#sal-codigo-estado')).catch(() => '')
    comprobar(estadoSinV === `Placa ${sinCodigoV.placa}, del Isuzu NPR, sin código interno: la salida va al vehículo y no a un código.`,
      `y con guion, la del vehículo sin código, que un consumible sí puede llevar, sin ofrecerle la placa del otro: «${estadoSinV}»`)
    await pagina.keyboard.press('Escape')
    const abrirV = async (material = discoV) => {
      await ir(pagina, '/almacen/kardex')
      await hidratado(abrir)
      await abrir.click()
      await ventana.waitFor({ timeout: 30000 }).catch(() => {})
      await ventana.locator('#sal-material').click()
      await ventana.getByRole('searchbox', { name: 'Código o descripción' }).fill(material.codigo)
      await ventana.locator('[role="option"]', { hasText: material.descripcion }).click()
      await ventana.getByRole('button', { name: 'Código de unidad', exact: true }).click()
    }
    const salidaV = async (motivo) => {
      await ventana.locator('#sal-cantidad').fill('1')
      await ventana.locator('#sal-motivo').fill(motivo)
      await ventana.locator('#sal-recibe').fill('Mecánico de turno')
      await ventana.locator('#sal-foto').setInputFiles(foto)
      const sePuede = await confirmar.isEnabled()
      if (sePuede) await confirmar.click()
      else await pagina.keyboard.press('Escape')
      return sePuede ? await terminarVentana(pagina) : 'no deja confirmar'
    }
    // Con la placa de dos vehículos escrita y después el RQ elegido, el campo
    // ya no se ve y el botón se queda apagado: no se podía atender el RQ.
    await abrirV()
    await campo.click()
    await campo.fill(`cv${sufijo[0]} ${sufijo.slice(1)}`)
    await pagina.waitForTimeout(300)
    await campo.press('Tab')
    await ventana.locator('select[name="requerimiento_linea_id"]').selectOption(await insumo(discoV.rqs[0].id))
    await pagina.waitForTimeout(300)
    // El código del RQ es la placa del vehículo con código: la ventana dice que
    // el gasto no va al costeo de su código.
    const avisoConRq = await texto(ventana.locator('span.text-aviso', { hasText: 'Es la placa del' })).catch(() => '')
    const alertaConRq = await salidaV('Vale del banco, RQ con la placa de código')
    const [movConRq] = await consulta(`select codigo_interno as codigo, unidad_id from public.movimientos_materiales
      where material_id = $1 and tipo = 'SALIDA' and requerimiento_linea_id is not null`, [discoV.id])
    comprobar(!alertaConRq && movConRq?.codigo === conCodigoV.placa && movConRq.unidad_id === conCodigoV.id
      && avisoConRq === `Es la placa del Hino 500, que tiene el código ${conCodigoV.codigo}: la salida queda en el vehículo, pero el gasto va a ${conCodigoV.placa}, como pide el RQ, y no al costeo de su código. Si es para ${conCodigoV.codigo}, que Requerimientos corrija el código del RQ antes de sacarlo.`,
      `con el RQ elegido después de la placa de dos vehículos, sale con el código del RQ y queda en el vehículo de esa placa, y la ventana lo dice: «${avisoConRq}» ${JSON.stringify(movConRq)} ${alertaConRq}`)
    // Ya salió parte del RQ: su código ya no se corrige (la base lo rechaza), y el
    // aviso ya no manda a corregirlo. Lo anuncia una región que ya estaba, vacía,
    // antes de elegir el RQ: el aviso nace con su texto y así no se oía.
    await abrirV()
    const regionV = ventana.locator('p[role="status"].sr-only')
    const regionAntesV = [await regionV.count(), await texto(regionV).catch(() => null)]
    await ventana.locator('select[name="requerimiento_linea_id"]').selectOption(await insumo(discoV.rqs[0].id))
    await pagina.waitForTimeout(300)
    const avisoYaSalio = await texto(ventana.locator('span.text-aviso', { hasText: 'Es la placa del' })).catch(() => '')
    const regionYaSalio = await texto(regionV).catch(() => '')
    comprobar(regionAntesV[0] === 1 && !regionAntesV[1] && regionYaSalio === avisoYaSalio
      && avisoYaSalio.endsWith(`Ya salió parte de este RQ: su código ya no se corrige. Si lo que falta es para ${conCodigoV.codigo}, que Requerimientos registre otro RQ.`),
      `después de una salida del RQ, el aviso ya no manda a corregir su código y lo anuncia la región que ya estaba: ${JSON.stringify(regionAntesV)} «${avisoYaSalio}» «${regionYaSalio}»`)
    await pagina.keyboard.press('Escape')
    // Desde «Atención», un RQ de dos ítems cuyo código es esa placa: al seguir
    // con el ítem 2, el aviso ya dice que salió parte. Decía unos segundos, hasta
    // que llegaba la página, que el código del RQ todavía se corregía, y la base
    // ya no lo deja. La página nueva se retiene hasta mirar, para no depender de
    // cuánto tarda en llegar.
    const pernoV = await sembrar('PERNOV', 2, [])
    const golillaV = await sembrar('GOLILLAV', 2, [])
    const rqV2 = crypto.randomUUID()
    await como(CUENTAS.requerimientos, `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Prueba de dos ítems con la placa de un vehículo con código', null, $4::jsonb)`,
      [rqV2, area, conCodigoV.placa, JSON.stringify([{ material_id: pernoV.id, cantidad: 1 }, { material_id: golillaV.id, cantidad: 1 }])])
    await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, $2::jsonb, null)`,
      [rqV2, JSON.stringify([{ item: 1, en_stock: 1 }, { item: 2, en_stock: 1 }])])
    let soltarV
    const sueltaV = new Promise((r) => { soltarV = r })
    let retenerV = false
    let retenidasV = 0
    const retenerPaginaV = async (ruta) => {
      if (retenerV && ruta.request().method() === 'GET' && ruta.request().headers().rsc === '1') {
        retenidasV++
        await sueltaV
      }
      await ruta.continue().catch(() => {})
    }
    await pagina.route('**/almacen/kardex**', retenerPaginaV)
    await ir(pagina, `/almacen/kardex?rq=${rqV2}`)
    await ventana.waitFor({ timeout: 60000 }).catch(() => {})
    await hidratado(ventana.locator('#sal-cantidad'))
    const avisoItem1V = await texto(ventana.locator('span.text-aviso', { hasText: 'Es la placa del' })).catch(() => '')
    await ventana.locator('#sal-cantidad').fill('1')
    await ventana.locator('#sal-recibe').fill('Mecánico de turno')
    await ventana.locator('#sal-foto').setInputFiles(foto)
    retenerV = true
    await confirmar.click()
    const sigueV = ventana.getByText(/Sigue el ítem 2/)
    await sigueV.waitFor({ timeout: 60000 }).catch(() => {})
    await pagina.waitForTimeout(400)
    const avisoItem2V = await texto(ventana.locator('span.text-aviso', { hasText: 'Es la placa del' })).catch(() => '')
    const regionItem2V = await texto(regionV).catch(() => '')
    const [salioV] = await consulta(`select count(*)::int as n from public.movimientos_materiales
      where tipo = 'SALIDA' and requerimiento_linea_id in (select id from public.requerimiento_lineas where requerimiento_id = $1)`, [rqV2])
    retenerV = false
    soltarV()
    await pagina.unroute('**/almacen/kardex**', retenerPaginaV)
    comprobar(salioV?.n === 1 && avisoItem1V.endsWith(`Si es para ${conCodigoV.codigo}, que Requerimientos corrija el código del RQ antes de sacarlo.`)
      && avisoItem2V.endsWith(`Ya salió parte de este RQ: su código ya no se corrige. Si lo que falta es para ${conCodigoV.codigo}, que Requerimientos registre otro RQ.`)
      && regionItem2V === avisoItem2V,
      `desde «Atención», al seguir con el ítem 2 el aviso ya dice que salió parte del RQ, sin esperar la página (${retenidasV} retenida): «${avisoItem1V}» → «${avisoItem2V}» «${regionItem2V}» ${JSON.stringify(salioV)}`)
    await pagina.keyboard.press('Escape')
    // Devuelta entera esa salida en la misma visita, sin recargar, la ventana
    // vuelve a mandar a corregir el código del RQ, como la base: la salida que la
    // ventana recordaba le ganaba a lo que traía la página.
    const [salidaV2] = await consulta(`select m.id::text from public.movimientos_materiales m join public.requerimiento_lineas l on l.id = m.requerimiento_linea_id
      where m.tipo = 'SALIDA' and l.requerimiento_id = $1`, [rqV2])
    const ingresoV = pagina.getByRole('button', { name: 'Registrar ingreso', exact: true })
    await hidratado(ingresoV)
    await ingresoV.click()
    await ventana.waitFor({ timeout: 30000 }).catch(() => {})
    await ventana.locator('#ing-material').fill(pernoV.codigo)
    await ventana.locator('#ing-origen').selectOption('DEVOLUCION')
    await ventana.locator('#ing-cantidad').fill('1')
    await ventana.locator('#ing-doc').fill(`DEV BANCO ${sufijo}`)
    // La salida entra a la lista de lo que se puede devolver cuando llega la página.
    await ventana.locator(`#ing-devolucion option[value="${salidaV2.id}"]`).waitFor({ state: 'attached', timeout: 60000 }).catch(() => {})
    await ventana.locator('#ing-devolucion').selectOption(salidaV2.id)
    await ventana.getByRole('button', { name: 'Confirmar ingreso' }).click()
    const alertaDevV = await terminarVentana(pagina)
    const [devV] = await consulta(`select cantidad::float8 as cantidad from public.movimientos_materiales where tipo = 'INGRESO' and devolucion_de = $1`, [salidaV2.id])
    await pagina.waitForTimeout(4000)
    await abrir.click()
    await ventana.waitFor({ timeout: 30000 }).catch(() => {})
    const [{ id: linea2V }] = await consulta('select id::text from public.requerimiento_lineas where requerimiento_id = $1 and item = 2', [rqV2])
    await ventana.locator('select[name="requerimiento_linea_id"]').selectOption(linea2V)
    await pagina.waitForTimeout(800)
    const avisoDevueltoV = await texto(ventana.locator('span.text-aviso', { hasText: 'Es la placa del' })).catch(() => '')
    comprobar(!alertaDevV && devV?.cantidad === 1
      && avisoDevueltoV.endsWith(`Si es para ${conCodigoV.codigo}, que Requerimientos corrija el código del RQ antes de sacarlo.`),
      `devuelta entera esa salida en la misma visita, sin recargar, la ventana vuelve a mandar a corregir el código del RQ: «${avisoDevueltoV}» ${JSON.stringify(devV)} ${alertaDevV}`)
    await pagina.keyboard.press('Escape')
    // Sin RQ, la misma placa escrita va al código del vehículo, aunque un RQ la tenga de código.
    await abrirV()
    await campo.click()
    await campo.fill(conCodigoV.placa.toLowerCase())
    await pagina.waitForTimeout(300)
    await campo.press('Tab')
    await pagina.waitForTimeout(200)
    const alertaSinRq = await salidaV('Vale del banco, placa del vehículo con código')
    const [movSinRq] = await consulta(`select codigo_interno as codigo, unidad_id from public.movimientos_materiales
      where material_id = $1 and tipo = 'SALIDA' and requerimiento_linea_id is null`, [discoV.id])
    comprobar(!alertaSinRq && movSinRq?.codigo === conCodigoV.codigo && movSinRq.unidad_id !== null,
      `sin RQ, la placa va al vehículo con código y a su código: ${JSON.stringify(movSinRq)} ${alertaSinRq}`)

    // Con un código que tiene gemelo escrito tal cual, el Tab pasa al campo
    // siguiente y la lista se cierra: caía en un «Cambiar a <gemelo>» tapado por
    // ella, y Enter cambiaba el código al de otra unidad sin que se viera. Y con
    // la lista cerrada por el Tab caía en ese botón, o en «Usar … como código
    // nuevo» con una búsqueda a medias.
    // Con otro material: los dos de DISCOV ya salieron.
    const gemV = await sembrar('GEMV', 1, [[`BANCO-GEM${sufijo}`, 0, 1], [`BANCO_GEM${sufijo}`, 0, 1]])
    await abrirV(gemV)
    await campo.click()
    await campo.fill(`BANCO-GEM${sufijo}`)
    await pagina.waitForTimeout(300)
    await campo.press('Tab')
    await pagina.waitForTimeout(200)
    const focoGemelo = await pagina.evaluate(() => {
      const a = document.activeElement
      const r = a?.getBoundingClientRect()
      // Se ve si lo que está encima de su centro es él (o algo suyo), no la lista.
      const encima = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null
      const visible = !!a && a !== document.body && !!encima && (a === encima || a.contains(encima))
      return `${a?.tagName ?? ''}#${a?.id ?? ''} «${(a?.textContent ?? '').trim().slice(0, 60)}» ${visible ? 'a la vista' : 'TAPADO'}`
    })
    const listaGemelo = await ventana.locator('[role="listbox"]').count()
    const cambiarGemelo = await ventana.getByRole('button', { name: `Cambiar a BANCO_GEM${sufijo}`, exact: false }).count()
    comprobar(listaGemelo === 0 && focoGemelo.startsWith('INPUT#sal-recibe') && focoGemelo.endsWith('a la vista') && await campo.inputValue() === `BANCO-GEM${sufijo}` && cambiarGemelo === 1,
      `con un código gemelo, el Tab pasa al campo siguiente y cierra la lista; el «Cambiar a» se ve: ${listaGemelo} ${focoGemelo} ${cambiarGemelo}`)
    await campo.click()
    await campo.fill(`zq${sufijo.toLowerCase()}`)
    await pagina.waitForTimeout(300)
    await campo.press('Tab')
    await pagina.waitForTimeout(200)
    const focoMedias = await pagina.evaluate(() => document.activeElement?.id ?? '')
    const estadoMedias = await texto(ventana.locator('#sal-codigo-estado')).catch(() => '')
    const validoMedias = await campo.evaluate((e) => e.validity.valid)
    comprobar(focoMedias === 'sal-recibe' && await campo.inputValue() === `zq${sufijo.toLowerCase()}` && !validoMedias
      && estadoMedias.startsWith('No está entre los códigos abiertos.'),
      `con una búsqueda a medias, el Tab pasa al campo siguiente y no la deja como código nuevo: ${focoMedias} ${validoMedias} «${estadoMedias}»`)
    // El clic en lo que no es opción (el motivo de arriba de la lista) deja el
    // foco en el campo: se lo llevaba la lista, lo escrito no entraba y el
    // Escape cerraba la ventana entera.
    await campo.click()
    await campo.fill(`cv${sufijo[0]} ${sufijo.slice(1)}`)
    await pagina.waitForTimeout(300)
    await ventana.locator('[role="listbox"] li[role="presentation"]').first().click()
    await pagina.keyboard.type('x')
    const focoClic = await pagina.evaluate(() => document.activeElement?.id ?? '')
    const valorClic = await campo.inputValue()
    await pagina.keyboard.press('Escape')
    await pagina.waitForTimeout(200)
    const sigueVentana = await ventana.count()
    const listaClic = await ventana.locator('[role="listbox"]').count()
    comprobar(focoClic === 'sal-codigo' && valorClic === `cv${sufijo[0]} ${sufijo.slice(1)}x` && sigueVentana === 1 && listaClic === 0,
      `el clic en el aviso de la lista deja el foco en el campo, y el Escape cierra la lista y no la ventana: ${focoClic} «${valorClic}» ${sigueVentana} ${listaClic}`)
    await pagina.keyboard.press('Escape')
    comprobar(errores.length === 0, `sin errores de consola con la placa de dos vehículos ${errores.join(' | ')}`)
    await contexto.close()
  }

  // Un RQ de dos ítems: el 1 pide 5 clavos y separó 5, aunque hay 2; el 2
  // separó 4 de las 6 grapas. Con el ítem 1, lo separado de más se dice
  // aunque nada sea de otro; y lo que separó el ítem 2 es de «otro ítem».
  {
    const clavo = await sembrar('CLAVO', 2, [])
    const grapa = await sembrar('GRAPA', 6, [])
    const codZ = `BANCO-CRZ${sufijo}`
    const rqZ = crypto.randomUUID()
    await como(CUENTAS.requerimientos, `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Prueba de dos ítems en la salida', null, $4::jsonb)`,
      [rqZ, area, codZ, JSON.stringify([{ material_id: clavo.id, cantidad: 5 }, { material_id: grapa.id, cantidad: 4 }])])
    await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, $2::jsonb, null)`,
      [rqZ, JSON.stringify([{ item: 1, en_stock: 5 }, { item: 2, en_stock: 4 }])])
    const nZ = await numero(rqZ)
    const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
    await ir(pagina, '/almacen/kardex')
    const abrir = pagina.getByRole('button', { name: 'Registrar salida' })
    await hidratado(abrir)
    await abrir.click()
    const ventana = pagina.locator('[role="dialog"]')
    await ventana.waitFor({ timeout: 30000 }).catch(() => {})
    const aviso = ventana.locator('[data-aviso-de-dueno]')
    const ayuda = async () => {
      const id = await ventana.locator('#sal-cantidad').getAttribute('aria-describedby')
      return id ? (await pagina.locator(`[id="${id}"]`).textContent())?.replace(/\s+/g, ' ').trim() : ''
    }
    await ventana.locator('select[name="requerimiento_linea_id"]').selectOption(await insumo(rqZ))
    await pagina.waitForTimeout(200)
    const aClavo = (await aviso.count()) ? await texto(aviso) : ''
    const ayudaClavo = await ayuda()
    comprobar(aClavo === `Se separó 3 UND más de lo que hay. Para ${nZ} puedes sacar 2 UND sin tocar lo que es de otros.`
      && ayudaClavo === 'Hay 2: 0 libres y 2 de este RQ · el RQ pide 5 más',
      `lo separado de más por el mismo RQ se dice aunque nada sea de otro: «${aClavo}» «${ayudaClavo}»`)
    await ventana.locator('#sal-material').click()
    await ventana.getByRole('searchbox', { name: 'Código o descripción' }).fill(grapa.codigo)
    await ventana.locator('[role="option"]', { hasText: grapa.descripcion }).click()
    await pagina.waitForTimeout(200)
    const aGrapa = (await aviso.count()) ? await texto(aviso) : ''
    const propuestaGrapa = await ventana.locator('#sal-cantidad').inputValue()
    comprobar(aGrapa === `Para ${nZ} puedes sacar 2 UND sin tocar lo que es de otros. Ya tiene dueño: 4 de ${codZ} (${nZ}, otro ítem).`
      && propuestaGrapa === '2',
      `lo que separó el otro ítem del mismo RQ no es de este, y propone lo que no es de otros: «${aGrapa}» «${propuestaGrapa}»`)
    // Salen 2 grapas con el ítem 1: el ítem 2 conserva sus 4 en la base.
    await ventana.locator('#sal-cantidad').fill('2')
    await ventana.locator('#sal-recibe').fill('Soldador de turno')
    await ventana.locator('#sal-foto').setInputFiles(foto)
    await ventana.getByRole('button', { name: 'Confirmar salida' }).click()
    const alerta = await terminarVentana(pagina)
    const sG = await stockDe(grapa.id)
    const [mov] = await consulta(`select count(*)::int as n, max(cantidad)::float8 as cantidad from public.movimientos_materiales
      where requerimiento_linea_id = $1 and material_id = $2 and tipo = 'SALIDA'`, [await insumo(rqZ), grapa.id])
    comprobar(!alerta && mov.n === 1 && mov.cantidad === 2 && sG?.existencia === 4 && sG?.separado === 4 && sG?.libre === 0,
      `la salida del ítem 1 con grapas no le quita al ítem 2 lo que separó: ${JSON.stringify([mov, sG])} ${alerta}`)
    comprobar(errores.length === 0, `sin errores de consola en la salida de dos ítems ${errores.join(' | ')}`)
    await contexto.close()
  }

  // En metros, con decimales. El navegador sumaba y restaba sin redondear: con
  // 5.3 y 2.1 apartados para un pedido de OT proponía 3.1999999999999997, que
  // la base rechazaba con «Indica material, cantidad…», y no dejaba escribir
  // 3.2; con 0.1 libre y 0.2 del RQ, 0.30000000000000004; y con 0.3 que son
  // 0.2 del pedido de OT y 0.1 del RQ, la ficha decía «Se separó 0 M más».
  {
    const metro = `(select id from public.unidades_medida where codigo = 'M')`
    async function enMetros(etiqueta, n) {
      const [m] = await consulta(`insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
        values ($1, $2, ${consumible}, ${metro}) returning id::text, codigo, descripcion`, [`PRB-${etiqueta}-${sufijo}`, `${etiqueta} en metros ${sufijo}`])
      await consulta(`insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
        select gen_random_uuid(), 'INGRESO', $1::uuid, $3, 'INGRESO_GENERAL', $2, u.id from public.usuarios u where u.correo = $4`,
        [m.id, `GR BANCO CR ${sufijo}`, n, CUENTAS.almacen])
      return m
    }
    async function pedidoDeOt(m, n) {
      const [om] = await consulta(`insert into public.ot_materiales (orden_id, material_id, cantidad, area_destino)
        values ((select id from public.ordenes_trabajo where estado <> 'ANULADA' order by numero limit 1), $1, $2, 'MTZ')
        returning id, orden_id`, [m.id, n])
      const [sol] = await consulta(`insert into public.requerimientos_materiales (orden_id, area_destino, solicitado_por)
        values ($1, 'MTZ', (select id from public.usuarios where correo = $2))
        on conflict (orden_id, area_destino) do update set area_destino = excluded.area_destino returning id`, [om.orden_id, CUENTAS.almacen])
      await consulta(`insert into public.requerimiento_material_detalles (requerimiento_id, ot_material_id, cantidad_solicitada) values ($1, $2, $3)`,
        [sol.id, om.id, n])
      await consulta(`update public.requerimiento_material_detalles set aprobacion_diseno = 'APROBADO', decision_almacen = 'STOCK', cantidad_stock = $2
        where ot_material_id = $1`, [om.id, n])
    }
    async function lineaDe(m, codigo, pide, separa) {
      const id = crypto.randomUUID()
      await como(CUENTAS.requerimientos, `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, 'Prueba de decimales en la salida', null, $4::jsonb)`,
        [id, area, codigo, JSON.stringify([{ material_id: m.id, cantidad: pide }])])
      await como(CUENTAS.almacen, `select public.rq_revisar_stock($1, $2::jsonb, null)`, [id, JSON.stringify([{ item: 1, en_stock: separa }])])
      return insumo(id)
    }
    const cinta1 = await enMetros('CINTA1', 1)
    const lineaC1 = await lineaDe(cinta1, `BANCO-CRM1${sufijo}`, 0.5, 0.2)
    await lineaDe(cinta1, `BANCO-CRM2${sufijo}`, 0.7, 0.7)
    const cinta2 = await enMetros('CINTA2', 5.3)
    await pedidoDeOt(cinta2, 2.1)
    const lineaC2 = await lineaDe(cinta2, `BANCO-CRM3${sufijo}`, 4, 0)
    const cinta3 = await enMetros('CINTA3', 0.3)
    await pedidoDeOt(cinta3, 0.2)
    await lineaDe(cinta3, `BANCO-CRM4${sufijo}`, 0.1, 0.1)
    // La recepción guarda hasta cuatro decimales; la salida, tres.
    const cinta4 = await enMetros('CINTA4', 1.0005)
    const lineaC4 = await lineaDe(cinta4, `BANCO-CRM5${sufijo}`, 2, 0)

    const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
    const ventana = pagina.locator('[role="dialog"]')
    const cantidadC = ventana.locator('#sal-cantidad')
    const abrirCon = async (linea) => {
      await ir(pagina, '/almacen/kardex')
      const abrir = pagina.getByRole('button', { name: 'Registrar salida' })
      await hidratado(abrir)
      await abrir.click()
      await ventana.waitFor({ timeout: 30000 }).catch(() => {})
      await ventana.locator('select[name="requerimiento_linea_id"]').selectOption(linea)
      await pagina.waitForTimeout(300)
    }
    await abrirCon(lineaC1)
    const propuesta1 = await cantidadC.inputValue()
    comprobar(propuesta1 === '0.3', `con 0.1 libre y 0.2 del RQ propone 0.3: «${propuesta1}»`)
    await abrirCon(lineaC2)
    const propuesta2 = await cantidadC.inputValue()
    const tope2 = await cantidadC.getAttribute('max')
    comprobar(propuesta2 === '3.2' && tope2 === '3.2', `con 5.3 y 2.1 de un pedido de OT propone 3.2 y deja escribirlo: «${propuesta2}» max «${tope2}»`)
    await ventana.locator('#sal-recibe').fill('Pintor de turno')
    await ventana.locator('#sal-foto').setInputFiles(foto)
    await ventana.getByRole('button', { name: 'Confirmar salida' }).click()
    const alerta2 = await terminarVentana(pagina)
    const [mov2] = await consulta(`select cantidad::float8 as cantidad from public.movimientos_materiales
      where requerimiento_linea_id = $1 and tipo = 'SALIDA'`, [lineaC2])
    comprobar(!alerta2 && mov2?.cantidad === 3.2, `y la base guarda la propuesta: ${JSON.stringify(mov2)} ${alerta2}`)
    await abrirCon(lineaC4)
    const propuesta4 = await cantidadC.inputValue()
    const tope4 = await cantidadC.getAttribute('max')
    comprobar(propuesta4 === '1' && tope4 === '1', `con 1.0005 en el kardex propone 1 y no 1.001: «${propuesta4}» max «${tope4}»`)
    // La lista de materiales dice lo que puede salir, y 1.0005 escrito dice por qué no sale.
    await ventana.locator('#sal-material').click()
    await ventana.getByRole('searchbox', { name: 'Código o descripción' }).fill(cinta4.codigo)
    const opcion4 = await texto(ventana.locator('[role="option"]', { hasText: cinta4.descripcion })).catch(() => '')
    await pagina.keyboard.press('Escape')
    await cantidadC.fill('1.0005')
    await pagina.waitForTimeout(200)
    const decimales4 = await ventana.getByText('La salida lleva hasta tres decimales: escribe 1.', { exact: true }).count()
    comprobar(opcion4.includes('libre 1 M') && !opcion4.includes('1.0005') && decimales4 === 1,
      `con 1.0005 en el kardex la lista dice «libre 1» y 1.0005 escrito dice que van tres decimales: «${opcion4}» ${decimales4}`)
    await cantidadC.fill('1')
    await ventana.locator('#sal-recibe').fill('Pintor de turno')
    await ventana.locator('#sal-foto').setInputFiles(foto)
    await ventana.getByRole('button', { name: 'Confirmar salida' }).click()
    const alerta4 = await terminarVentana(pagina)
    const [mov4] = await consulta(`select cantidad::float8 as cantidad from public.movimientos_materiales
      where requerimiento_linea_id = $1 and tipo = 'SALIDA'`, [lineaC4])
    comprobar(!alerta4 && mov4?.cantidad === 1, `y la base la guarda: ${JSON.stringify(mov4)} ${alerta4}`)
    await ir(pagina, `/almacen/kardex?material=${cinta3.id}`)
    const deMas3 = await pagina.locator('[data-separado-de-mas]').count()
    const dueno3 = await texto(pagina.locator('[data-ya-tiene-dueno]')).catch(() => '')
    comprobar(deMas3 === 0 && dueno3.includes('Pedidos de OT: 0.2 M'),
      `con 0.3 que son 0.2 del pedido de OT y 0.1 del RQ, la ficha no avisa de nada separado de más: ${deMas3} «${dueno3}»`)
    comprobar(errores.length === 0, `sin errores de consola con decimales ${errores.join(' | ')}`)
    await contexto.close()
  }
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} fallan` : '\nTodo pasa')
process.exit(fallas.length ? 1 : 0)
