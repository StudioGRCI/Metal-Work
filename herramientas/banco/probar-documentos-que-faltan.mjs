/**
 * Clic real sobre lo que falta en cada compra (Plan 10, entrega 10.2), con la
 * cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Siembra, con la función de cada puesto: la OC «A» aprobada hace 5 días,
 *      sin factura y en la lista del conductor (le faltan la factura y la guía);
 *      la OC «B» con su factura registrada, recogida, validada y con 2 devueltos
 *      sin reposición (le faltan la nota de crédito y la guía, que el conductor
 *      no llevó); la OS «S» afecta a detracción, aprobada hace 3 días y pagada al
 *      proveedor con el número de su comprobante anotado (le faltan el PDF del
 *      comprobante y la detracción); y la OC «C», con su factura entera, que no
 *      debe salir en «Incompletas».
 *   2. Contabilidad, en 1440 y en 390, filtra «Incompletas»: cada una dice qué le
 *      falta y desde hace cuántos días, y la completa no sale.
 *   3. Contabilidad baja el Excel del mes con el botón; Logística también;
 *      Almacén no entra ni baja el Excel.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo),
 * BANCO_ARCHIVOS, CAPTURAS y el correo de cada cuenta si no es la
 * `<puesto>.local@metalwork.test` que siembra `preparar.sh`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import ExcelJS from 'exceljs'
import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = join(process.env.CAPTURAS ?? '/tmp/banco-capturas', 'documentos-que-faltan')
const ARCHIVOS = process.env.BANCO_ARCHIVOS ?? '/tmp/banco-archivos'
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(
  ['requerimientos', 'almacen', 'logistica', 'gerencia', 'conductor', 'contabilidad', 'tesoreria'].map((p) => [p, cuenta(p)]),
)
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })
const PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'

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
async function nadie() {
  await consulta(`select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false)`)
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
/** Un archivo de quien lo sube, en el disco del banco y en `storage.objects`. */
async function archivo(bucket, ruta, puesto) {
  mkdirSync(dirname(join(ARCHIVOS, bucket, ruta)), { recursive: true })
  writeFileSync(join(ARCHIVOS, bucket, ruta), PDF)
  await consulta(
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values ($1, $2, $3::uuid, $4, jsonb_build_object('mimetype', 'application/pdf', 'size', $5::bigint))`,
    [bucket, ruta, ids[CUENTAS[puesto]], ids[CUENTAS[puesto]], PDF.length],
  )
  return ruta
}
/** Corre una fecha como dueño, sin disparadores: lo que en la vida real pasó hace días. */
async function haceDias(sql, valores) {
  await base.query('begin')
  try {
    await base.query('set local session_replication_role = replica')
    await consulta(sql, valores)
    await base.query('commit')
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}
const [{ hoy }] = await consulta(`select (now() at time zone 'America/Lima')::date::text as hoy`)
const MES = hoy.slice(0, 7)
const PROVEEDOR = `PAPELES ${SUFIJO} S.A.C.`
const RUC = await rucNuevo()
const [{ id: proveedor }] = await consulta(
  `insert into proveedores (numero_documento, razon_social, direccion, telefono) values ($1, $2, 'Av. de prueba 473, Trujillo', '999 000 473') returning id`,
  [RUC, PROVEEDOR],
)
const [{ id: material }] = await consulta(
  `insert into materiales (codigo, descripcion, categoria_id, unidad_medida_id)
   values ($1, $2, (select id from categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1),
           (select id from unidades_medida where codigo = 'UND')) returning id`,
  [`BAN473-${SUFIJO}`, `Disco banco 473 ${SUFIJO}`],
)
const [{ id: areaMtz }] = await consulta(`select id from areas where codigo = 'MTZ'`)
const codigoUnidad = `BAN473_${SUFIJO}`
await consulta(`insert into unidades (placa, tipo_vehiculo, marca, codigo_interno, activo) values ($1, 'CAMION', 'Volvo', $2, true)`,
  [`D${SUFIJO.slice(0, 2)}-${SUFIJO.slice(2, 5)}`, codigoUnidad])

/** Un RQ de 10, sin stock, comprado con factura a 10 por unidad y aprobado por Gerencia. */
async function ocAprobada(letra) {
  const [{ rq, oc }] = await consulta(`select gen_random_uuid() as rq, gen_random_uuid() as oc`)
  await como('requerimientos')
  await consulta(`select public.emitir_requerimiento($1, 'OPERACION', $2, $3, $4, null, $5::jsonb)`,
    [rq, areaMtz, codigoUnidad, `Discos para la OC ${letra} del banco 473`, JSON.stringify([{ material_id: material, cantidad: 10 }])])
  await como('almacen')
  await consulta(`select public.rq_revisar_stock($1, '[{"item": 1, "en_stock": 0}]'::jsonb, null)`, [rq])
  const [{ id: linea }] = await consulta(`select l.id from requerimiento_lineas l where l.requerimiento_id = $1`, [rq])
  await como('logistica')
  await consulta(`select public.emitir_compra_de_requerimientos($1, $2::jsonb, $3, $4, null, 'CONTADO', 0, 'PEN', true)`,
    [oc, JSON.stringify([{ material_id: material, cantidad: 10, precio: 10, insumos: [linea] }]), proveedor, `COT-473${letra}-${SUFIJO}`])
  await como('gerencia')
  await consulta(`select public.aprobar_compra($1) from ordenes_compra_materiales where id = $1 and aprobacion = 'POR_APROBAR'`, [oc])
  return oc
}
/** La factura de la OC, registrada por Contabilidad con su PDF. */
async function facturar(oc, numero, total) {
  const [{ id }] = await consulta(`select gen_random_uuid() as id`)
  await como('contabilidad')
  await consulta(
    `insert into adquisiciones (id, tipo, proveedor, ruc_proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago, orden_compra_id)
     values ($1, 'FACTURA_COMPRA', $2, $3, $4, $5::date, $5::date, 'PEN', $6, 'CONTADO', $7)`,
    [id, PROVEEDOR, RUC, numero, hoy, total, oc],
  )
  await archivo('comprobantes-financieros', `adquisiciones/${id}/comprobante.pdf`, 'contabilidad')
  await consulta(`update adquisiciones set ruta_storage = 'adquisiciones/' || id || '/comprobante.pdf', estado = 'REGISTRADA' where id = $1`, [id])
}

// A: aprobada hace 5 días, sin factura, en la lista del conductor.
const ocA = await ocAprobada('A')
await haceDias(`update ordenes_compra_materiales set aprobado_en = now() - interval '5 days' where id = $1`, [ocA])
await como('logistica')
await consulta(`select public.mandar_compra_a_recojo($1)`, [ocA])
await consulta(`select public.programar_recojo($1, 25, null)`, [ocA])

// B: con su factura, recogida, dejada y validada; Almacén devuelve 2 sin reposición.
const ocB = await ocAprobada('B')
await facturar(ocB, `F473-${SUFIJO.slice(0, 5)}B`, 118)
await como('logistica')
await consulta(`select public.mandar_compra_a_recojo($1)`, [ocB])
await consulta(`select public.programar_recojo($1, 25, null)`, [ocB])
await como('conductor')
await consulta(`select public.marcar_compra_en_recojo($1)`, [ocB])
await consulta(`select public.marcar_compra_recogida($1)`, [ocB])
await consulta(`select public.marcar_compra_dejada_almacen($1)`, [ocB])
await como('almacen')
const [{ ing, dev }] = await consulta(`select gen_random_uuid() as ing, gen_random_uuid() as dev`)
const [{ id: pendiente }] = await consulta(`select id from ingresos_pendientes_almacen where orden_compra_id = $1`, [ocB])
await consulta(`select public.validar_ingresos_compra($1, $2::jsonb, null)`, [ocB, JSON.stringify([{ id: pendiente, movimiento_id: ing, cantidad: 10 }])])
await consulta(`select public.devolver_al_proveedor($1, $2, 2, $3, 'Dos discos llegaron partidos', false)`, [dev, ing, `GR-473-${SUFIJO}`])

// C: con su factura entera y sin nada pendiente: no es incompleta.
const ocC = await ocAprobada('C')
await facturar(ocC, `F473-${SUFIJO.slice(0, 5)}C`, 118)

// S: OS afecta a detracción, aprobada hace 3 días, y Tesorería paga al proveedor.
await nadie()
const [{ id: os }] = await consulta(
  `insert into ordenes_servicio (numero, proveedor_id, proveedor, descripcion, monto, monto_pen, moneda, codigo_interno, aprobacion, aprobado_por, aprobado_en, creado_por,
                                 detraccion_afecta, detraccion_codigo, detraccion_porcentaje, detraccion_minimo)
   values ($1, $2, $3, $4, 1800, 1800, 'PEN', $5, 'APROBADA', $6, now() - interval '3 days', $7, true, '020', 12, 700) returning id`,
  [`QA-OS-473-${SUFIJO}`, proveedor, PROVEEDOR, `Servicio de prueba 473 (${SUFIJO})`, codigoUnidad, ids[CUENTAS.gerencia], ids[CUENTAS.logistica]],
)
const [{ id: caja }] = await consulta(
  `insert into cajas (nombre, tipo, banco, moneda, saldo_inicial, fecha_inicio, creado_por)
   values ($1, 'BANCO', 'BANCO DE PRUEBA', 'PEN', 5000, $2::date - 30, $3) returning id`,
  [`Banco 473 ${SUFIJO}`, hoy, ids[CUENTAS.tesoreria]],
)
await como('tesoreria')
const voucher = await archivo('pagos-servicio', `${os}/${(await consulta(`select gen_random_uuid() as u`))[0].u}.pdf`, 'tesoreria')
const COMPROBANTE_OS = `E555-${SUFIJO.slice(0, 5)}`
await consulta(`select public.registrar_pago_servicio(gen_random_uuid(), $1, $2::date, 1000, false, $3, $6, $4, $5, null, 'PROVEEDOR')`,
  [os, hoy, `OP-473-${SUFIJO}`, voucher, caja, COMPROBANTE_OS])
await nadie()

const numeros = Object.fromEntries(
  (await consulta(`select id, numero from ordenes_compra_materiales where id = any($1) union all select id, numero from ordenes_servicio where id = $2`, [[ocA, ocB, ocC], os]))
    .map((f) => [f.id, f.numero]),
)
const [A, B, C, S] = [numeros[ocA], numeros[ocB], numeros[ocC], numeros[os]]
console.log(`  siembra: ${A} sin factura hace 5 días y en la lista; ${B} con devolución sin nota; ${C} completa; ${S} pagada con el comprobante anotado y sin detracción`)

// ---------------------------------------------------------------- navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
async function entrar(puesto, viewport = { width: 1440, height: 900 }) {
  const correo = CUENTAS[puesto]
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima', acceptDownloads: true })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${puesto}: ${m.text().slice(0, 300)}`)
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
const anchoDe = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth)
async function leerExcel(buffer) {
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(buffer)
  const hoja = libro.getWorksheet('Adquisiciones')
  const titulos = hoja.getRow(4).values.slice(1)
  const filas = []
  hoja.eachRow((r, n) => {
    if (n < 5) return
    const v = r.values.slice(1)
    filas.push(Object.fromEntries(titulos.map((t, i) => [t, v[i] ?? null])))
  })
  return { titulos, filas }
}

// ---- 2. Contabilidad, 1440: «Incompletas»
{
  const { pagina, contexto } = await entrar('contabilidad')
  await pagina.goto(`${BASE}/adquisiciones`, { waitUntil: 'networkidle' })
  const pastilla = pagina.getByRole('link', { name: /^Incompletas \(\d+\)$/ }).first()
  comprobar((await pastilla.count()) === 1, 'Contabilidad ve la pastilla «Incompletas (N)»')
  await Promise.all([pagina.waitForURL(/situacion=incompletas/), pastilla.click()])
  await pagina.waitForLoadState('networkidle')
  const fila = (n) => pagina.locator(`tr[data-orden="${n}"]`)
  const faltas = async (n) =>
    Object.fromEntries(await fila(n).locator('[data-falta]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-falta'), e.textContent.replace(/\s+/g, ' ').trim()])))
  const fa = await faltas(A)
  comprobar(/Falta la factura/.test(fa.FACTURA ?? '') && /hace 5 días/.test(fa.FACTURA ?? ''), `${A}: falta la factura, hace 5 días («${fa.FACTURA}»)`)
  comprobar(/Guía de remisión por cargar/.test(fa.GUIA ?? '') && /desde hoy/.test(fa.GUIA ?? ''), `${A}: falta la guía, desde hoy, que entró a la lista («${fa.GUIA}»)`)
  const fb = await faltas(B)
  comprobar(/nota de crédito/.test(fb.NOTA_CREDITO ?? '') && /desde hoy/.test(fb.NOTA_CREDITO ?? '') && !fb.FACTURA,
    `${B}: falta la nota de crédito de lo devuelto, y la factura no («${fb.NOTA_CREDITO}»)`)
  comprobar(/Falta la guía de remisión/.test(fb.GUIA ?? '') && /desde hoy/.test(fb.GUIA ?? ''),
    `${B}: el conductor la dejó sin guía y la guía sigue faltando («${fb.GUIA}»)`)
  comprobar((await fila(B).locator('[data-falta="GUIA"]').getByRole('button', { name: /Cargar guía/ }).count()) === 1,
    `${B}: Contabilidad puede cargar la guía desde esa línea`)
  const fs = await faltas(S)
  comprobar(new RegExp(`Falta el PDF del comprobante ${COMPROBANTE_OS} \\(anotado al pagar\\)`).test(fs.COMPROBANTE ?? '') && /hace 3 días/.test(fs.COMPROBANTE ?? ''),
    `${S}: el comprobante anotado al pagar dice que falta su PDF, hace 3 días («${fs.COMPROBANTE}»)`)
  const celdaS = limpio(await fila(S).locator('td').nth(5).textContent())
  comprobar(celdaS.split(COMPROBANTE_OS).length === 2, `${S}: su número sale una vez, no también como «anotado al pagar» suelto («${celdaS}»)`)
  comprobar(/etracción/.test(fs.DETRACCION ?? '') && /desde hoy/.test(fs.DETRACCION ?? ''), `${S}: falta la detracción desde el pago al proveedor («${fs.DETRACCION}»)`)
  comprobar((await fila(C).count()) === 0, `${C}, completa, no sale en «Incompletas»`)
  const sinFalta = await pagina.locator('tbody tr[data-orden]').evaluateAll((trs) => trs.filter((tr) => !tr.querySelector('[data-falta]')).map((tr) => tr.getAttribute('data-orden')))
  comprobar(sinFalta.length === 0, `toda fila de «Incompletas» dice qué le falta (sin línea: ${sinFalta.join(', ') || 'ninguna'})`)
  comprobar((await anchoDe(pagina)) <= 1440, 'en 1440 no se corre de costado')
  await fila(A).scrollIntoViewIfNeeded()
  await pagina.screenshot({ path: join(CAPTURAS, '10-2-contabilidad-1440-incompletas.png'), fullPage: false })

  // ---- 3. El Excel del mes, con el botón
  const campo = pagina.locator('#excel-mes')
  comprobar((await campo.inputValue()) === MES, `el mes del Excel viene puesto en el mes en curso (${await campo.inputValue()})`)
  const [descarga] = await Promise.all([pagina.waitForEvent('download'), pagina.getByRole('button', { name: 'Descargar Excel' }).click()])
  comprobar(descarga.suggestedFilename() === `MW-Adquisiciones-${MES}.xlsx`, `se baja «${descarga.suggestedFilename()}»`)
  const ruta = join(CAPTURAS, descarga.suggestedFilename())
  await descarga.saveAs(ruta)
  const { readFileSync } = await import('node:fs')
  const { titulos, filas } = await leerExcel(readFileSync(ruta))
  for (const t of ['Orden', 'Proveedor', 'Factura o comprobante', 'Guía de remisión', 'Detracción', 'Nota de crédito', 'Qué falta', 'Días de la espera más larga'])
    comprobar(titulos.includes(t), `el Excel tiene la columna «${t}»`)
  const de = (n) => filas.find((f) => f.Orden === n)
  comprobar(/^Falta desde el .+ \(hace 5 días\)$/.test(de(A)?.['Factura o comprobante'] ?? '') && /^Falta desde el /.test(de(A)?.['Guía de remisión'] ?? '') && de(A)?.['Días de la espera más larga'] === 5,
    `${A} en el Excel: falta la factura desde hace 5 días y la guía («${de(A)?.['Factura o comprobante']}», «${de(A)?.['Guía de remisión']}»)`)
  comprobar(/^Factura /.test(de(B)?.['Factura o comprobante'] ?? '') && /^Falta desde el /.test(de(B)?.['Nota de crédito'] ?? ''),
    `${B} en el Excel: la factura está y la nota de crédito falta («${de(B)?.['Factura o comprobante']}», «${de(B)?.['Nota de crédito']}»)`)
  comprobar(new RegExp(`^Falta el PDF del comprobante ${COMPROBANTE_OS} \\(anotado al pagar\\), desde el .+ \\(hace 3 días\\)$`).test(de(S)?.['Factura o comprobante'] ?? '') &&
      /^Falta desde el .+ \(desde hoy\)$/.test(de(S)?.Detracción ?? '') && de(S)?.['Nota de crédito'] === '—' && /Servicio de prueba 473/.test(de(S)?.['Descripción del servicio'] ?? ''),
    `${S} en el Excel: falta el PDF del comprobante (hace 3 días) y la detracción, con su descripción y sin nota («${de(S)?.['Factura o comprobante']}», «${de(S)?.Detracción}»)`)
  comprobar(/Pagada en parte · pagado S\/\s?1,000\.00/.test(de(S)?.Pago ?? '') && /por pagar S\/\s?118\.00/.test(de(B)?.Pago ?? ''),
    `el pago dice lo pagado y lo que falta, como la pantalla («${de(S)?.Pago}», «${de(B)?.Pago}»)`)
  comprobar(de(C) && !de(C)['Qué falta'] && de(C)['Días de la espera más larga'] === null, `${C} en el Excel, sin nada que falte`)
  comprobar(de(A)?.Proveedor === PROVEEDOR && de(A)?.Total === 118, `${A} en el Excel con su proveedor y su total (${de(A)?.Total})`)

  // Un mes que no se entiende no baja otro mes callado: vuelve a la pantalla y lo dice junto al botón.
  await pagina.goto(`${BASE}/adquisiciones/excel?mes=noviembre`, { waitUntil: 'networkidle' })
  const avisoMes = limpio(await pagina.locator('#excel-aviso').textContent().catch(() => ''))
  comprobar(/\/adquisiciones\?excel=mes/.test(pagina.url()) && /Ese mes no se entiende/.test(avisoMes),
    `un mes que no se entiende vuelve a Adquisiciones con el aviso («${avisoMes}»)`)
  await contexto.close()
}

// ---- 2b. Contabilidad, 390
{
  const { pagina, contexto } = await entrar('contabilidad', { width: 390, height: 844 })
  await pagina.goto(`${BASE}/adquisiciones?situacion=incompletas`, { waitUntil: 'networkidle' })
  const ficha = pagina.locator(`li[data-orden-telefono="${A}"]`)
  comprobar((await ficha.count()) === 1 && /Falta la factura/.test(limpio(await ficha.textContent())) && /hace 5 días/.test(limpio(await ficha.textContent())),
    `en el teléfono, ${A} dice que falta la factura y hace 5 días`)
  comprobar((await anchoDe(pagina)) <= 390, `en 390 no se corre de costado (${await anchoDe(pagina)})`)
  await ficha.scrollIntoViewIfNeeded()
  await pagina.screenshot({ path: join(CAPTURAS, '10-2-contabilidad-390-incompletas.png'), fullPage: false })
  await contexto.close()
}

// ---- 3b. Logística baja el Excel; Almacén no entra
{
  const { pagina, contexto } = await entrar('logistica')
  const r = await pagina.request.get(`${BASE}/adquisiciones/excel?mes=${MES}`)
  const { filas } = r.status() === 200 ? await leerExcel(await r.body()) : { filas: [] }
  comprobar(r.status() === 200 && filas.some((f) => f.Orden === A), `Logística baja el Excel del mes, con ${A}`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('almacen')
  const r = await pagina.request.get(`${BASE}/adquisiciones/excel?mes=${MES}`, { maxRedirects: 0 })
  comprobar(r.status() >= 300 && r.status() < 400 && /sin-permiso/.test(r.headers().location ?? ''), `Almacén no baja el Excel: lo manda a /sin-permiso (${r.status()} ${r.headers().location ?? ''})`)
  await pagina.goto(`${BASE}/adquisiciones?situacion=incompletas`, { waitUntil: 'networkidle' })
  comprobar(pagina.url().includes('/sin-permiso'), 'Almacén no entra a Adquisiciones')
  await contexto.close()
}

comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo bien' : `\n${fallas.length} fallas`)
process.exit(fallas.length === 0 ? 0 : 1)
