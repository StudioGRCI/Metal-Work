/**
 * Recorre con clic real la factura de venta colgada del código interno
 * (migraciones 20261015124000 y 20261015125000), con la cuenta de cada puesto
 * (nunca ADMIN):
 *
 *   1. Contabilidad tiene su menú (Facturación primero; el kardex y la
 *      cotización en Consultas; la OT ya no) y en Facturación ve cada
 *      cotización aprobada por su código interno, con el RUC y la dirección.
 *      La que espera su OT no ofrece registrar factura. Registra la factura
 *      (primero con un número mal escrito, que se rechaza); el aviso de que lo
 *      facturado pasa de la cotización sale sin impedir nada. Ve el kardex sin
 *      botones de ingreso ni salida.
 *   2. Tesorería tiene primero la caja diaria y después sus cuatro
 *      (Adquisiciones, Cuentas por cobrar, Cuentas por pagar y Pagos de
 *      servicio) y la cotización en Consultas; ve la
 *      factura con su código y su PDF y la cobra a cuenta con su voucher; paga
 *      la orden de servicio conforme con su voucher. En el teléfono, sus
 *      cuatro pestañas.
 *   3. Contabilidad ya no ofrece anular la factura cobrada; Gerencia ve en la
 *      cotización la factura y su estado, y no tiene la OT en su menú.
 *   4. Supervisión General ya no ve la cotización; Diseño tampoco; Logística no
 *      entra a Facturación ni a los pagos de servicio.
 *
 * Entra con las cuentas `<puesto>.local@metalwork.test` que deja `preparar.sh`
 * (cada una se cambia con su variable: CONTABILIDAD, TESORERIA, GERENCIA,
 * DISENO, LOGISTICA). Supervisión General no tiene cuenta del banco: sin
 * GENERAL, el script da de alta la suya, `general.fact@banco.test`. Siembra por
 * SQL, como dueño de la base y con un sello por corrida, lo que antes tenía que
 * estar a mano: el cliente, la cotización aprobada con su OT y el código
 * `QA-CI <sello>`, la aprobada sin OT, la orden de servicio aprobada y conforme
 * con la cuenta BCP del proveedor, y los PDF de la factura y del voucher.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE,
 * BANCO_ARCHIVOS (el mismo del servidor del banco).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { crearCajaDePrueba, elegirCuenta } from './caja-de-prueba.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const ARCHIVOS = CAPTURAS
const ALMACEN = process.env.BANCO_ARCHIVOS ?? '/tmp/banco-archivos'
// Las cuentas de cada puesto que deja `preparar.sh`; cada una se cambia con su variable.
const CUENTAS = {
  contabilidad: process.env.CONTABILIDAD ?? 'contabilidad.local@metalwork.test',
  tesoreria: process.env.TESORERIA ?? 'tesoreria.local@metalwork.test',
  gerencia: process.env.GERENCIA ?? 'gerencia.local@metalwork.test',
  general: process.env.GENERAL ?? 'general.fact@banco.test',
  diseno: process.env.DISENO ?? 'diseno.local@metalwork.test',
  logistica: process.env.LOGISTICA ?? 'logistica.local@metalwork.test',
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

/**
 * La red quieta, sin colgarse. Con Next 16, Chromium deja a veces para
 * Playwright una precarga del menú «abierta» para siempre: la que el enrutador
 * abandonó al cambiar de página, sin respuesta ni error, aunque el servidor la
 * contesta en milisegundos y el socket ya está cerrado. `networkidle` no llega
 * nunca y el `goto` muere a los 30 s (pasa en una de cada tres navegaciones).
 * Se espera la carga completa y, a lo sumo diez segundos, la red quieta.
 */
const quieta = (pagina) => pagina.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
async function ir(pagina, url) {
  await pagina.goto(url, { waitUntil: 'load' })
  await quieta(pagina)
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
  await ir(pagina, `${BASE}/ingresar`)
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  // El dashboard llega por partes: las cifras pueden pintarse después de la URL.
  await quieta(pagina)
  return { pagina, contexto }
}

/** Espera a que la ventana abierta se cierre (la acción salió bien) o muestre su error. */
async function esperarVentana(pagina) {
  const v = pagina.locator('[role="dialog"]')
  await Promise.race([v.waitFor({ state: 'hidden', timeout: 30000 }), v.locator('[role="alert"]').waitFor({ timeout: 30000 })]).catch(() => {})
  return limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
}

// El globo de pendientes va pegado al nombre del módulo («Facturación1»): se quita.
const menu = async (pagina) => (await pagina.locator('nav[aria-label="Menú principal"] a').allTextContents()).map((t) => limpio(t).replace(/\d+$/, ''))
const franja = async (pagina) => limpio(await pagina.locator('main').textContent())
// Lo que espera en un módulo ya no se lista en el Dashboard (2026-10-19): se lee
// del globo del menú, que lleva la cantidad en su etiqueta accesible.
const globo = async (pagina, ruta) => (await pagina.locator(`nav a[href="${ruta}"]`).first().getAttribute('aria-label')) ?? ''
const ruta = (pagina) => new URL(pagina.url()).pathname

// ---------------------------------------------------------------- siembra
// Todo lo de esta corrida lleva su sello: una corrida que se cae a medias no
// cambia lo que ve la siguiente. Los números de la OT y de la OS los dan sus
// series, como en la pantalla; nada numerado se borra después.
const sello = Date.now().toString().slice(-6)
const uno = async (sql, valores = []) => (await consulta(sql, valores))[0]
const idDe = async (correo) => {
  const fila = await uno('select id from public.usuarios where correo = $1', [correo])
  if (!fila) throw new Error(`Falta la cuenta ${correo} en la base del banco.`)
  return fila.id
}

/** Un PDF de una página con estas líneas de texto. */
function pdfConTexto(lineas) {
  const texto = lineas.map((l, i) => `BT /F1 11 Tf 50 ${780 - i * 18} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n')
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(texto, 'latin1')} >>\nstream\n${texto}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  let pdf = '%PDF-1.4\n'
  const posiciones = []
  objetos.forEach((o, i) => {
    posiciones.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  pdf += posiciones.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

// Supervisión General no es un puesto del banco: su cuenta la da de alta el script.
if (!process.env.GENERAL) {
  let fila = await uno('select id from public.usuarios where correo = $1', [CUENTAS.general])
  if (!fila) {
    fila = await uno(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [CUENTAS.general])
    await consulta(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
       select $1, 'SUPERVISION GENERAL', 'Banco facturación', $2, r.id, (select id from public.areas where codigo = 'PRD')
         from public.roles r where r.codigo = 'SUPERVISOR_GENERAL'`,
      [fila.id, CUENTAS.general],
    )
  }
  await consulta(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where email = $1`, [CUENTAS.general, CLAVE])
}

const ventas = await idDe(process.env.VENTAS ?? 'ventas.local@metalwork.test')
const gerencia = await idDe(CUENTAS.gerencia)
const logistica = await idDe(CUENTAS.logistica)
const anio = (await uno(`select to_char((now() at time zone 'America/Lima')::date, 'YYYY') as a`)).a
const rucLibre = async (tabla) =>
  (await uno(`select n::text as ruc from generate_series(20990150000::bigint, 20990199999::bigint) n
               where public.ruc_es_valido(n::text) and not exists (select 1 from public.${tabla} t where t.numero_documento = n::text) limit 1`)).ruc
const RUC = await rucLibre('clientes')
const CLIENTE = `TRANSPORTES DE PRUEBA ${sello} S.A.C.`
const clienteId = (await uno(
  `insert into public.clientes (tipo_documento, numero_documento, razon_social, direccion_fiscal) values ('RUC', $1, $2, 'Av. de Prueba 345') returning id`,
  [RUC, CLIENTE],
)).id
const CODIGO = `QA-CI ${sello}`
const carroceria = (await uno(`select id from public.tipos_carroceria where activo order by orden_secuencia limit 1`)).id

/** Una cotización de Ventas por US$ con su PDF en el almacenamiento del banco; queda «Por revisar». */
async function cotizacion(monto) {
  const { id } = await uno('select gen_random_uuid() as id')
  const { numero } = await uno(
    `select n || '-' || $1 as numero from generate_series(3900, 8999) n
      where not exists (select 1 from public.cotizaciones_pdf c where c.numero = n || '-' || $1) order by n limit 1`,
    [anio],
  )
  const ruta = `cot/${id}/${numero}.pdf`
  const contenido = pdfConTexto([`COTIZACION ${numero}`, `CLIENTE: ${CLIENTE}`, 'Semirremolque plataforma de prueba del banco'])
  const destino = join(ALMACEN, 'cotizaciones-pdf', ruta)
  mkdirSync(dirname(destino), { recursive: true })
  writeFileSync(destino, contenido)
  await consulta(
    `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
     values ($1, $2, $3, $4, $5, $6, 'application/pdf', $7, $8, $9, 'USD')`,
    [id, numero, clienteId, carroceria, `${numero}.pdf`, ruta, contenido.length, ventas, monto],
  )
  await consulta(
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
     values ('cotizaciones-pdf', $1, $2::uuid, $2::text, jsonb_build_object('mimetype', 'application/pdf', 'size', $3::bigint))`,
    [ruta, ventas, contenido.length],
  )
  return { id, numero }
}

// Lo que el menú contaba antes de sembrar: lo sembrado suma uno a cada globo.
const cuenta = async (pagina, destino) => Number((await globo(pagina, destino)).match(/, (\d+) pendientes?$/)?.[1] ?? 0)
const antes = {}
{
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad)
  antes.facturar = await cuenta(pagina, '/contabilidad/facturacion')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.tesoreria)
  antes.cobrar = await cuenta(pagina, '/tesoreria/por-cobrar')
  antes.servicios = await cuenta(pagina, '/tesoreria/pagos-de-servicio')
  await contexto.close()
}

// La 59 000 se aprueba como lo hace Gerencia: con su OT ya cargada y su código.
const conOt = await cotizacion(59000)
const unidadId = (await uno(
  `insert into public.unidades (cliente_id, placa, marca, modelo, tipo_vehiculo, codigo_interno) values ($1, $2, 'VOLVO', 'FMX', 'VOLQUETE', $3) returning id`,
  [clienteId, `F${sello.slice(0, 2)}-${sello.slice(3)}`, CODIGO],
)).id
await consulta(
  `insert into public.ordenes_trabajo (sede_id, descripcion, cliente_id, unidad_id, cotizacion_pdf_id)
   values ((select id from public.sedes order by nombre limit 1), 'Plataforma de prueba del banco', $1, $2, $3)`,
  [clienteId, unidadId, conOt.id],
)
await base.query('begin')
try {
  await base.query(
    `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
            set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
    [gerencia],
  )
  await base.query('set local role authenticated')
  await base.query(`update public.cotizaciones_pdf set estado = 'APROBADA' where id = $1`, [conOt.id])
  await base.query('commit')
} catch (e) {
  await base.query('rollback')
  throw e
}
// La aprobada sin OT es un dato de antes de la migración 20261016900000, que
// hoy Gerencia ya no puede dejar así: entra como dato viejo, sin disparadores.
const sinOt = await cotizacion(20000)
await base.query('begin')
try {
  await base.query('set local session_replication_role = replica')
  await base.query(`update public.cotizaciones_pdf set estado = 'APROBADA', revisado_por = $2, revisado_en = now() - interval '1 day' where id = $1`, [sinOt.id, gerencia])
  await base.query('commit')
} catch (e) {
  await base.query('rollback')
  throw e
}
const COT = conOt.numero
const COT_SIN = sinOt.numero

// La orden de servicio aprobada por Gerencia y conforme, con la cuenta BCP del proveedor.
const PROVEEDOR = `ARENADOS DE PRUEBA ${sello} S.A.C.`
const proveedorId = (await uno(
  `insert into public.proveedores (tipo_documento, numero_documento, razon_social) values ('RUC', $1, $2) returning id`,
  [await rucLibre('proveedores'), PROVEEDOR],
)).id
await consulta(
  `insert into public.proveedor_cuentas (proveedor_id, banco, numero_cuenta, titular, moneda) values ($1, 'BCP', $2, $3, 'PEN')`,
  [proveedorId, `191-${sello}00-0-99`, PROVEEDOR],
)
const OS = (await uno(`select public.siguiente_correlativo('ORDEN_SERVICIO', '001', null) as n`)).n
const osId = (await uno(
  `insert into public.ordenes_servicio (numero, proveedor_id, proveedor, descripcion, moneda, monto, codigo_interno, creado_por,
                                        aprobacion, aprobado_por, aprobado_en, estado, conformidad_por, conformidad_en)
   values ($1, $2, $3, 'Arenado de prueba del banco', 'PEN', 1500, $4, $5, 'APROBADA', $6, now(), 'CONFORME', $5, now()) returning id`,
  [OS, proveedorId, PROVEEDOR, CODIGO, logistica, gerencia],
)).id

// La factura lleva una serie libre: el número vigente no se repite.
const SERIE = (await uno(
  `select 'E' || lpad(n::text, 3, '0') as s from generate_series(100, 999) n
    where not exists (select 1 from public.facturas_venta f where f.numero = 'E' || lpad(n::text, 3, '0') || '-626') order by random() limit 1`,
)).s
const FACTURA = `${SERIE}-626`
const PDF_FACTURA = join(ARCHIVOS, `${FACTURA}.pdf`)
const PDF_VOUCHER = join(ARCHIVOS, 'voucher.pdf')
writeFileSync(PDF_FACTURA, pdfConTexto([`FACTURA ELECTRONICA ${SERIE}-00000626`, CLIENTE, 'Importe Total : US$ 29,500.00']))
writeFileSync(PDF_VOUCHER, pdfConTexto(['CONSTANCIA DE OPERACION', 'Operacion OP-000123', 'Banco de prueba']))
// Un ingreso al almacén con su guía de remisión, para el kardex que Contabilidad consulta.
const planchaId = (await uno(
  `insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
   values ($1, $2, (select id from public.categorias_material where activo and almacen = 'MATERIA_PRIMA' order by codigo limit 1),
           (select id from public.unidades_medida where codigo = 'UND')) returning id`,
  [`FAC-${sello}`, `Plancha LAC 3/16 A36 (banco) ${sello}`],
)).id
await consulta(
  `insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, precio_unitario, moneda)
   values (gen_random_uuid(), 'INGRESO', $1, 4, 'INGRESO_GENERAL', 'GR T001-123', $2, 380, 'PEN')`,
  [planchaId, await idDe(process.env.ALMACEN ?? 'almacen.local@metalwork.test')],
)
console.log(`     sembrado: ${COT} con la OT del código ${CODIGO}, ${COT_SIN} sin OT, ${OS} conforme; la factura será ${FACTURA}`)

// ---------------------------------------------------------- 1. Contabilidad
{
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad)
  const items = await menu(pagina)
  console.log('     menú de Contabilidad:', items.join(' · '))
  comprobar(items.indexOf('Facturación') === 1, 'el menú de Contabilidad trae Facturación primero')
  comprobar(items.includes('Kardex') && items.includes('Cotización') && !items.includes('Órdenes de trabajo'), 'con el Kardex y la Cotización en Consultas, y sin la OT')
  comprobar((await cuenta(pagina, '/contabilidad/facturacion')) === antes.facturar + 1, `el menú de Contabilidad cuenta la cotización por facturar (${antes.facturar} + 1)`)

  await ir(pagina, `${BASE}/contabilidad/facturacion`)
  const tarjeta = pagina.locator(`li[data-cotizacion="${COT}"]`)
  const texto = limpio(await tarjeta.textContent())
  comprobar(texto.includes(`Código ${CODIGO}`) && texto.includes('Por facturar') && texto.includes(RUC) && texto.includes('Av. de Prueba 345'),
    'Facturación trae la cotización por su código interno, con el RUC y la dirección fiscal')
  const sinCodigo = pagina.locator(`li[data-cotizacion="${COT_SIN}"]`)
  const textoSin = limpio(await sinCodigo.textContent())
  comprobar(textoSin.includes('Sin código interno') && (await sinCodigo.getByRole('button', { name: 'Registrar factura' }).count()) === 0,
    'la cotización que espera su OT dice que le falta el código y no ofrece registrar factura')
  const orden = await pagina.locator('li[data-cotizacion]').evaluateAll((l) => l.map((e) => e.getAttribute('data-cotizacion')))
  comprobar(orden[0] === COT, 'la que se puede facturar va primero')
  const enlace = await tarjeta.getByRole('link', { name: 'Abrir la cotización' }).getAttribute('href')
  comprobar(Boolean(enlace) && (await fetch(enlace)).status === 200, 'Contabilidad abre el PDF de la cotización')

  await tarjeta.getByRole('button', { name: 'Registrar factura' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="numero"]').fill('factura 626')
  await v.locator('input[name="concepto"]').fill('Inicial 50 %')
  await v.locator('select[name="moneda"]').selectOption('USD')
  await v.locator('input[name="total"]').fill('29500')
  comprobar((await v.locator('[role="status"]').count()) === 0, 'sin aviso mientras lo facturado no pasa de la cotización')
  await v.locator('input[name="archivo"]').setInputFiles(PDF_FACTURA)
  await v.getByRole('button', { name: 'Registrar la factura' }).click()
  const error = await esperarVentana(pagina)
  comprobar(error.includes('E001-626'), `un número mal escrito se rechaza con su ejemplo («${error}»)`)
  await v.locator('input[name="numero"]').fill(`${SERIE.toLowerCase()}-00000626`)
  await v.locator('input[name="archivo"]').setInputFiles(PDF_FACTURA)
  await v.getByRole('button', { name: 'Registrar la factura' }).click()
  const error2 = await esperarVentana(pagina)
  comprobar(error2 === '', `la factura se registra${error2 ? ` (dijo: ${error2})` : ''}`)
  await tarjeta.getByText(`Factura ${FACTURA}`).waitFor({ timeout: 30000 }).catch(() => {})
  const despues = limpio(await tarjeta.textContent())
  comprobar(despues.includes('Facturada') && despues.includes('Por cobrar'), 'la cotización queda «Facturada» y la factura «Por cobrar»')
  const [f] = await consulta(`select numero, codigo_interno, total, moneda from facturas_venta where cotizacion_numero = $1 and anulada_en is null`, [COT])
  comprobar(f?.numero === FACTURA && f.codigo_interno === CODIGO && Number(f.total) === 29500 && f.moneda === 'USD',
    `la base guarda ${FACTURA} por US$ 29 500 en el código ${CODIGO}`)
  const huerfanos = await consulta(`select name from storage.objects o where bucket_id = 'facturas-venta' and not exists (select 1 from facturas_venta f where f.ruta_storage = o.name)`)
  comprobar(huerfanos.length === 0, 'el PDF del intento rechazado no quedó suelto en el almacenamiento')

  // Una segunda factura que pasa del total: avisa y no impide.
  await tarjeta.getByRole('button', { name: 'Registrar factura' }).click()
  await v.locator('select[name="moneda"]').selectOption('USD')
  await v.locator('input[name="total"]').fill('30000')
  const aviso = limpio(await v.locator('[role="status"]').textContent({ timeout: 5000 }).catch(() => ''))
  comprobar(aviso.includes('regístrala igual'), `si lo facturado pasa de la cotización, avisa sin impedir («${aviso}»)`)
  comprobar(await v.getByRole('button', { name: 'Registrar la factura' }).isEnabled(), 'y el botón sigue disponible')
  await v.getByRole('button', { name: 'Cancelar' }).click()
  await pagina.screenshot({ path: join(CAPTURAS, 'facturacion-1-contabilidad.png'), fullPage: true })

  await ir(pagina, `${BASE}/almacen/kardex`)
  const kardex = await franja(pagina)
  comprobar(kardex.includes('GR T001-123') || kardex.includes('Plancha LAC'), 'Contabilidad ve el kardex con el ingreso y su guía')
  comprobar((await pagina.getByRole('button', { name: /Registrar (ingreso|salida)/ }).count()) === 0, 'y no tiene botones de ingreso ni salida')
  await contexto.close()
}

// -------------------------------------------------------------- 2. Tesorería
{
  // Cada pago y cada cobro pide su cuenta de la caja (migración 20261019100000): la factura es en dólares.
  const cajaSoles = await crearCajaDePrueba(consulta, CUENTAS.tesoreria)
  const cajaDolares = await crearCajaDePrueba(consulta, CUENTAS.tesoreria, 'USD')
  const { pagina, contexto } = await entrar(CUENTAS.tesoreria)
  const items = await menu(pagina)
  console.log('     menú de Tesorería:', items.join(' · '))
  // Desde el 2026-10-16 la caja diaria va primero (src/lib/navegacion.ts), y después sus cuatro.
  const orden = ['Caja diaria', 'Adquisiciones', 'Cuentas por cobrar', 'Cuentas por pagar', 'Pagos de servicio', 'Recibos por honorarios', 'Planilla diaria', 'Tipo de cambio']
  comprobar(orden.every((t, i) => items.indexOf(t) === i + 1), 'el menú de Tesorería va la caja diaria y después Adquisiciones, por cobrar, por pagar, pagos de servicio')
  comprobar(items.includes('Cotización') && !items.includes('Órdenes de trabajo'), 'con la Cotización en Consultas, y sin la OT')
  comprobar(
    (await cuenta(pagina, '/tesoreria/por-cobrar')) === antes.cobrar + 1 && (await cuenta(pagina, '/tesoreria/pagos-de-servicio')) === antes.servicios + 1,
    `el menú de Tesorería cuenta la factura por cobrar y el servicio por pagar (${antes.cobrar} + 1 y ${antes.servicios} + 1)`,
  )

  await ir(pagina, `${BASE}/tesoreria`)
  comprobar(ruta(pagina) === '/tesoreria/por-cobrar', 'la dirección vieja lleva a Cuentas por cobrar')
  const factura = pagina.locator(`article[data-factura="${FACTURA}"]`)
  const texto = limpio(await factura.textContent())
  comprobar(texto.includes('TRANSPORTES DE PRUEBA') && texto.includes(`código ${CODIGO}`) && texto.includes(`cotización ${COT}`) && texto.includes('Inicial 50 %'),
    'la factura llega con cliente, código interno, cotización y concepto')
  const pdf = await factura.getByRole('link', { name: 'Abrir la factura' }).getAttribute('href')
  comprobar(Boolean(pdf) && (await fetch(pdf)).status === 200, 'Tesorería abre el PDF de la factura')

  await factura.getByRole('button', { name: 'Registrar cobro' }).click()
  const v = pagina.locator('[role="dialog"]')
  comprobar((await v.locator('input[name="monto"]').inputValue()) === '29500.00', 'el cobro propone el saldo de la factura')
  await v.locator('input[name="monto"]').fill('10000')
  await v.locator('input[name="operacion"]').fill('OP-000123')
  await v.locator('input[name="archivo"]').setInputFiles(PDF_VOUCHER)
  await elegirCuenta(v, cajaDolares)
  await v.getByRole('button', { name: 'Registrar el cobro' }).click()
  const e1 = await esperarVentana(pagina)
  comprobar(e1 === '', `el cobro a cuenta entra con su voucher${e1 ? ` (dijo: ${e1})` : ''}`)
  await factura.getByText('Cobro a cuenta').waitFor({ timeout: 30000 }).catch(() => {})
  const [s] = await consulta(`select saldo, cobrado from v_facturas_venta where numero = $1`, [FACTURA])
  comprobar(Number(s?.saldo) === 19500 && Number(s?.cobrado) === 10000, 'el cobro baja el saldo a 19 500')
  const cobrada = limpio(await factura.textContent())
  comprobar(cobrada.includes('OP-000123') && cobrada.includes('Cobro a cuenta'), 'el cobro sale en la factura, que queda «Cobro a cuenta»')
  const voucher = await factura.getByRole('link', { name: 'Voucher' }).getAttribute('href')
  comprobar(Boolean(voucher) && (await fetch(voucher)).status === 200, 'y su voucher se abre')
  const aprobadas = limpio(await pagina.locator(`[data-cotizacion="${COT}"]`).textContent())
  comprobar(aprobadas.includes(`Código ${CODIGO}`) && aprobadas.includes('Facturado') && aprobadas.includes('cobrado'),
    'debajo, la cotización aprobada con lo facturado y lo cobrado')
  comprobar(limpio(await pagina.locator(`[data-cotizacion="${COT_SIN}"]`).textContent()).includes('Falta cargar la OT'), 'y la que espera su OT')
  await pagina.screenshot({ path: join(CAPTURAS, 'facturacion-2-por-cobrar.png'), fullPage: true })

  await ir(pagina, `${BASE}/tesoreria/pagos-de-servicio`)
  const os = pagina.locator('article', { hasText: OS })
  const textoOs = limpio(await os.textContent())
  comprobar(textoOs.includes('ARENADOS DE PRUEBA') && textoOs.includes('BCP') && textoOs.includes(`código ${CODIGO}`), 'Tesorería ve la OS con su código interno y la cuenta del proveedor')
  await os.getByRole('button', { name: 'Registrar pago' }).click()
  await v.locator('input[name="monto"]').fill('500')
  await v.locator('select[name="cancela"]').selectOption('no')
  await v.locator('input[name="operacion"]').fill('OP-777')
  await v.locator('input[name="archivo"]').setInputFiles(PDF_VOUCHER)
  await elegirCuenta(v, cajaSoles)
  await v.getByRole('button', { name: 'Registrar el pago' }).click()
  const e2 = await esperarVentana(pagina)
  comprobar(e2 === '', `el pago a cuenta de la OS entra${e2 ? ` (dijo: ${e2})` : ''}`)
  await pagina.getByText('Pagada en parte').first().waitFor({ timeout: 30000 }).catch(() => {})
  const pagos = await consulta(`select count(*)::int n, sum(monto)::numeric s from pagos_orden_servicio where orden_servicio_id = $1 and anulado_en is null`, [osId])
  comprobar(pagos[0].n === 1 && Number(pagos[0].s) === 500, 'la base guarda el pago de 500')
  await contexto.close()

  const telefono = await entrar(CUENTAS.tesoreria, { width: 390, height: 844 })
  const pestanas = (await telefono.pagina.locator('nav[aria-label="Secciones"] li').allTextContents()).map(limpio)
  console.log('     pestañas de Tesorería:', pestanas.join(' · '))
  // En el teléfono también va primero la caja y los pagos de servicio pasan a «Más» (2026-10-17).
  // El globo va delante del nombre, y desde nueve dice «9+».
  comprobar(['Caja', 'Compras', 'Por cobrar', 'Por pagar'].every((t, i) => pestanas[i]?.replace(/^\d+\+?/, '').startsWith(t)), 'en el teléfono, sus cuatro pestañas en orden, con la caja primero')
  await ir(telefono.pagina, `${BASE}/tesoreria/por-cobrar`)
  const ancho = await telefono.pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `Cuentas por cobrar cabe en el teléfono (${ancho}px)`)
  await telefono.pagina.screenshot({ path: join(CAPTURAS, 'facturacion-3-telefono.png'), fullPage: true })
  await telefono.contexto.close()
}

// ------------------------------------------- 3. Contabilidad y Gerencia, después
{
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad)
  await ir(pagina, `${BASE}/contabilidad/facturacion`)
  const factura = pagina.locator(`article[data-factura="${FACTURA}"]`)
  comprobar((await factura.getByRole('button', { name: 'Anular' }).count()) === 0, 'la factura con un cobro ya no ofrece «Anular» a Contabilidad')
  comprobar(limpio(await factura.textContent()).includes('OP-000123'), 'y Contabilidad ve el cobro con su voucher')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.gerencia)
  const items = await menu(pagina)
  comprobar(!items.includes('Órdenes de trabajo') && items.includes('Códigos internos'), 'Gerencia sigue cada trabajo en Códigos internos, sin la OT en su menú')
  await ir(pagina, `${BASE}/cotizaciones/pdf`)
  const fila = limpio(await pagina.locator('li', { hasText: COT }).first().textContent())
  comprobar(fila.includes(`Factura ${FACTURA}`) && fila.includes('cobro a cuenta'), 'en la cotización, Gerencia ve la factura y en qué va su cobro')
  // Gerencia ve todo por código: lo vendido junto a lo gastado, y la factura con su cobro.
  await ir(pagina, `${BASE}/codigos-internos/detalle?codigo=${encodeURIComponent(CODIGO)}`)
  const linea = limpio(await pagina.locator('[data-facturado]').textContent().catch(() => ''))
  comprobar(linea.includes('Facturado') && linea.includes('cobrado'), `en Códigos internos, Gerencia ve lo facturado y lo cobrado del código («${linea.slice(0, 110)}»)`)
  await pagina.getByRole('link', { name: 'Ver factura y cobro' }).click()
  await pagina.waitForURL((u) => u.searchParams.get('vista') === 'facturacion').catch(() => {})
  await quieta(pagina)
  const enCodigo = pagina.locator(`article[data-factura="${FACTURA}"]`)
  comprobar((await enCodigo.count()) === 1 && limpio(await enCodigo.textContent()).includes('OP-000123'), 'y en «Factura y cobro», la factura con su cobro')
  comprobar((await pagina.locator(`li[data-cotizacion="${COT}"]`).count()) === 1, 'con la cotización aprobada del código')
  comprobar((await pagina.locator('main button', { hasText: /Anular|Registrar/ }).count()) === 0, 'sin botones de anular ni registrar: Gerencia solo consulta')
  const pdfFactura = await enCodigo.getByRole('link', { name: 'Abrir la factura' }).getAttribute('href').catch(() => null)
  comprobar(Boolean(pdfFactura) && (await fetch(pdfFactura)).status === 200, 'y abre el PDF de la factura')
  await pagina.screenshot({ path: join(CAPTURAS, 'gerencia-codigo-factura.png'), fullPage: true })
  await contexto.close()
}

// ------------------------------------------------- 4. Lo que no se puede
{
  const { pagina, contexto } = await entrar(CUENTAS.general)
  const items = await menu(pagina)
  comprobar(!items.includes('Cotización'), 'Supervisión General ya no tiene la cotización en su menú')
  await ir(pagina, `${BASE}/cotizaciones/pdf`)
  comprobar(ruta(pagina) === '/sin-permiso', 'ni la abre por su dirección')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.diseno)
  await ir(pagina, `${BASE}/cotizaciones/pdf`)
  comprobar(ruta(pagina) === '/sin-permiso', 'Diseño ve la OT, no la cotización')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  await ir(pagina, `${BASE}/tesoreria/pagos-de-servicio`)
  comprobar(ruta(pagina) === '/sin-permiso', 'Logística no entra a los pagos de servicio')
  await ir(pagina, `${BASE}/contabilidad/facturacion`)
  comprobar(ruta(pagina) === '/sin-permiso', 'ni a Facturación')
  await contexto.close()
}

comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallas.`)
process.exit(fallas.length === 0 ? 0 : 1)
