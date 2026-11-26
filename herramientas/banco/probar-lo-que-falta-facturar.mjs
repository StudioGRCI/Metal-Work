/**
 * Lo que falta facturar, arriba de Facturación (Plan 10.1, migración
 * 20261126210000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Contabilidad ve arriba «Por facturar»: la aprobada sin factura y la
 *      facturada en parte, con lo que falta y los días desde que la OT tiene
 *      código interno, de la que más espera a la que menos. La facturada
 *      entera y la que espera su OT no están. Cada fila baja a su tarjeta, que
 *      lleva los mismos días junto al estado y su recorrido hasta el cobro.
 *   2. Tesorería y Gerencia ven el recorrido con el cobro; Gerencia no tiene
 *      «Registrar factura».
 *   3. Logística no entra a Facturación.
 *
 * Siembra por SQL, como dueño de la base y con un sello por corrida: cinco
 * cotizaciones aprobadas en soles con su OT y su código fechados hacia atrás
 * (sin disparadores, como dato de días pasados), sus facturas y un cobro.
 * Guarda las capturas de Contabilidad en 390 y 1440.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  contabilidad: process.env.CONTABILIDAD ?? 'contabilidad.local@metalwork.test',
  tesoreria: process.env.TESORERIA ?? 'tesoreria.local@metalwork.test',
  gerencia: process.env.GERENCIA ?? 'gerencia.local@metalwork.test',
  logistica: process.env.LOGISTICA ?? 'logistica.local@metalwork.test',
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
const uno = async (sql, valores = []) => (await consulta(sql, valores))[0]

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()

// ---------------------------------------------------------------- siembra
const sello = Date.now().toString().slice(-6)
const idDe = async (correo) => {
  const fila = await uno('select id from public.usuarios where correo = $1', [correo])
  if (!fila) throw new Error(`Falta la cuenta ${correo} en la base del banco.`)
  return fila.id
}
const ventas = await idDe(CUENTAS.ventas)
const gerencia = await idDe(CUENTAS.gerencia)
const contabilidad = await idDe(CUENTAS.contabilidad)
const tesoreria = await idDe(CUENTAS.tesoreria)
const administracion = await idDe(process.env.ADMINISTRACION ?? 'administracion.local@metalwork.test')
const anio = (await uno(`select to_char((now() at time zone 'America/Lima')::date, 'YYYY') as a`)).a
const ruc = (await uno(`select n::text as ruc from generate_series(20990150000::bigint, 20990199999::bigint) n
                         where public.ruc_es_valido(n::text) and not exists (select 1 from public.clientes t where t.numero_documento = n::text) limit 1`)).ruc
const CLIENTE = `TRANSPORTES POR FACTURAR ${sello} S.A.C.`
const clienteId = (await uno(
  `insert into public.clientes (tipo_documento, numero_documento, razon_social, direccion_fiscal) values ('RUC', $1, $2, 'Av. de Prueba 472') returning id`,
  [ruc, CLIENTE],
)).id
const carroceria = (await uno(`select id from public.tipos_carroceria where activo order by orden_secuencia limit 1`)).id
const sede = (await uno(`select id from public.sedes order by nombre limit 1`)).id

/**
 * Una cotización aprobada hace 12 días, en soles con IGV, y, si `diasConCodigo`,
 * su OT con el código interno cargados hace esos días. Sin disparadores: es un
 * dato de días pasados.
 */
async function aprobada(letra, monto, diasConCodigo) {
  const { numero } = await uno(
    `select n || '-' || $1 as numero from generate_series(3900, 8999) n
      where not exists (select 1 from public.cotizaciones_pdf c where c.numero = n || '-' || $1) order by n limit 1`,
    [anio],
  )
  const codigo = diasConCodigo == null ? null : `QA-F${letra} ${sello}`
  const { id } = await uno('select gen_random_uuid() as id')
  await base.query('begin')
  try {
    await base.query('set local session_replication_role = replica')
    await uno(
      `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, tamano_bytes,
                                            registrado_por, monto_venta, moneda, estado, revisado_por, revisado_en, creado_en, archivo_subido_en)
       values ($9, $1, $2, $3, $4, $5, 'application/pdf', 900, $6, $7, 'PEN', 'APROBADA', $8, now() - interval '12 days', now() - interval '13 days', now() - interval '13 days')
       returning id`,
      [numero, clienteId, carroceria, `${numero}.pdf`, `cot/${id}/${numero}.pdf`, ventas, monto, gerencia, id],
    )
    await consulta(`insert into public.cotizaciones_pdf_igv (cotizacion_id, version, incluye_igv, confirmado_por) values ($1, 1, true, $2)`, [id, ventas])
    await base.query('commit')
  } catch (e) {
    await base.query('rollback')
    throw e
  }
  if (!codigo) return { id, numero, codigo }
  // La unidad y la OT entran como en el sistema (su serie le da el número); después se fechan hacia atrás.
  const atras = `${diasConCodigo} days`
  const unidad = (await uno(
    `insert into public.unidades (cliente_id, placa, marca, modelo, tipo_vehiculo, codigo_interno) values ($1, $2, 'VOLVO', 'FMX', 'VOLQUETE', $3) returning id`,
    [clienteId, `${letra}${sello.slice(0, 2)}-${sello.slice(3)}`, codigo],
  )).id
  const ot = (await uno(
    `insert into public.ordenes_trabajo (sede_id, descripcion, cliente_id, unidad_id, cotizacion_pdf_id) values ($1, 'Plataforma por facturar del banco', $2, $3, $4) returning id`,
    [sede, clienteId, unidad, id],
  )).id
  await base.query('begin')
  try {
    await base.query('set local session_replication_role = replica')
    await consulta(`update public.unidades set creado_en = now() - $2::interval where id = $1`, [unidad, atras])
    await consulta(`update public.ordenes_trabajo set creado_en = now() - $2::interval, creado_por = $3 where id = $1`, [ot, atras, administracion])
    await consulta(`update public.audit_log set creado_en = now() - $2::interval where tabla in ('unidades', 'ordenes_trabajo') and registro_id in ($1, $3)`, [unidad, atras, ot])
    await base.query('commit')
    return { id, numero, codigo }
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

/** Una factura vigente de esa cotización, registrada por Contabilidad, y si `cobro`, un cobro de Tesorería. */
async function factura(cot, total, cobro) {
  const serie = (await uno(
    `select 'E' || lpad(n::text, 3, '0') || '-' || $1 as s from generate_series(100, 999) n
      where not exists (select 1 from public.facturas_venta f where f.numero = 'E' || lpad(n::text, 3, '0') || '-' || $1) order by n limit 1`,
    [sello.slice(-3)],
  )).s
  await base.query('begin')
  try {
    await base.query('set local session_replication_role = replica')
    const { id } = await uno(
      `insert into public.facturas_venta (codigo_interno, cotizacion_pdf_id, cotizacion_numero, cliente_id, cliente, numero, fecha_emision,
                                          fecha_vencimiento, moneda, total, ruta_storage, nombre_archivo, tamano_bytes, registrado_por, creado_en)
       values ($1, $2, $3, $4, $5, $6, current_date - 1, current_date + 29, 'PEN', $7, $8, 'f.pdf', 900, $9, now() - interval '1 day') returning id`,
      [cot.codigo, cot.id, cot.numero, clienteId, CLIENTE, serie, total, `${sello}/${serie}.pdf`, contabilidad],
    )
    if (cobro) {
      await consulta(
        `insert into public.cobros_factura_venta (factura_id, fecha, moneda, monto, cancela, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
         values ($1, current_date, 'PEN', $2, $3, $4, 'application/pdf', 900, $5)`,
        [id, cobro.monto, cobro.cancela, `${id}/${sello}.pdf`, tesoreria],
      )
    }
    await base.query('commit')
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

const A = await aprobada('A', 11800, 6) // sin factura, la que más espera
const B = await aprobada('B', 20000, 2) // facturada en parte, con un cobro a cuenta
const C = await aprobada('C', 5000, 1) // sin factura
const D = await aprobada('D', 7000, 9) // facturada entera y cobrada: no espera
const E = await aprobada('E', 9000, null) // sin OT: espera a Administración
const F = await aprobada('F', 8000, 3) // facturada la mitad y esa factura cobrada: el resto no está cobrado
const G = await aprobada('G', 6000, 8) // aprobada, con su OT, y vuelta a revisar: la tiene Gerencia
await factura(B, 10000, { monto: 4000, cancela: false })
await factura(D, 7000, { monto: 7000, cancela: true })
await factura(F, 4000, { monto: 4000, cancela: true })
// G pasa a corrección: su versión aprobada queda archivada y la vigente espera a Gerencia.
await base.query('begin')
try {
  await base.query('set local session_replication_role = replica')
  await consulta(
    `insert into public.cotizaciones_pdf_versiones (cotizacion_id, version, nombre_archivo, ruta_storage, subido_en, observacion, estado_al_archivar)
     values ($1::uuid, 1, 'v1.pdf', 'cot/' || $1::text || '/v1.pdf', now() - interval '13 days', 'Cambia el precio', 'APROBADA')`,
    [G.id],
  )
  await consulta(`update public.cotizaciones_pdf set estado = 'POR_REVISAR', revisado_por = null, revisado_en = null where id = $1`, [G.id])
  await base.query('commit')
} catch (e) {
  await base.query('rollback')
  throw e
}
console.log(`     sembrado: ${A.codigo} (6 días), ${B.codigo} (en parte, 2), ${C.codigo} (1), ${D.codigo} (facturada), ${E.numero} sin OT, ${F.codigo} (adelanto cobrado), ${G.codigo} (en corrección)`)

// ---------------------------------------------------------------- navegador
const quieta = (pagina) => pagina.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
async function ir(pagina, url) {
  await pagina.goto(url, { waitUntil: 'load' })
  await quieta(pagina)
}
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
async function entrar(correo, viewport = { width: 1440, height: 900 }) {
  const contexto = await navegador.newContext({
    viewport,
    isMobile: viewport.width < 500,
    hasTouch: viewport.width < 500,
    deviceScaleFactor: 2,
    timezoneId: 'America/Lima',
  })
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
  await quieta(pagina)
  return { pagina, contexto }
}

const sembradas = [A, B, C, D, F, G].map((c) => c.codigo)
/** Las filas de «Por facturar» de esta corrida, en orden: código y texto. */
async function filasPorFacturar(pagina) {
  const filas = pagina.locator('#por-facturar tbody tr[data-por-facturar]')
  const lista = []
  for (const f of await filas.all()) {
    const codigo = await f.getAttribute('data-por-facturar')
    if (sembradas.includes(codigo)) lista.push({ codigo, texto: limpio(await f.textContent()) })
  }
  return lista
}
const tarjeta = (pagina, cot) => pagina.locator(`li[id="${cot.id}"]`)

// ---------------------------------------------------------- 1. Contabilidad, monitor
{
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad)
  await ir(pagina, `${BASE}/contabilidad/facturacion`)
  const filas = await filasPorFacturar(pagina)
  console.log('     por facturar:', filas.map((f) => `${f.codigo} → ${f.texto}`).join(' | '))
  comprobar(filas.map((f) => f.codigo).join(',') === [A, F, B, C, G].map((c) => c.codigo).join(','),
    `arriba, por facturar: de la que más espera a la que menos, sin la facturada entera, y la que está en corrección al final (${filas.map((f) => f.codigo).join(', ')})`)
  comprobar(/hace 6 días/.test(filas[0]?.texto ?? '') && /S\/\s?11,800\.00/.test(filas[0]?.texto ?? ''),
    'la primera dice lo que falta (todo el total) y hace 6 días desde que su OT tiene código')
  comprobar(/En parte/.test(filas[2]?.texto ?? '') && /S\/\s?10,000\.00/.test(filas[2]?.texto ?? '') && /hace 2 días/.test(filas[2]?.texto ?? ''),
    'la facturada en parte dice «En parte», lo que falta y hace 2 días')
  comprobar(/hace 1 día\b/.test(filas[3]?.texto ?? ''), 'la de ayer, hace 1 día')
  comprobar(/En corrección/.test(filas[4]?.texto ?? '') && /Gerencia · hace 8 días/.test(filas[4]?.texto ?? '') && !/Contabilidad/.test(filas[4]?.texto ?? ''),
    `la que está en corrección dice que la tiene Gerencia, no Contabilidad («${filas[4]?.texto}»)`)
  comprobar(await pagina.locator('#por-facturar tbody tr', { hasText: E.numero }).count() === 0, 'la que espera su OT no está por facturar')
  const todas = await pagina.locator('#por-facturar tbody tr[data-por-facturar]').count()
  const globo = (await pagina.locator('nav a[href="/contabilidad/facturacion"]').first().getAttribute('aria-label')) ?? ''
  comprobar(Number(globo.match(/(\d+) pendientes?$/)?.[1] ?? 0) === todas, `el globo del menú cuenta lo mismo que la lista (${todas}; «${globo}»)`)
  const cabecera = limpio(await pagina.locator('#por-facturar').locator('p').first().textContent())
  comprobar(/esperan su factura; la que más espera, desde hace \d+ días/.test(cabecera), `la cabecera cuenta cuántas y la que más espera («${cabecera}»)`)

  // La fila entera baja a su tarjeta: se toca el cliente, no el código.
  // `force`: el `::after` del enlace cubre la celda, y Playwright lo llama «intercepta»; es lo que se busca.
  await pagina.locator(`#por-facturar tbody tr[data-por-facturar="${A.codigo}"] td`).nth(1).click({ force: true })
  await pagina.waitForFunction((id) => location.hash === `#${id}`, A.id, { timeout: 5000 }).catch(() => {})
  comprobar(new URL(pagina.url()).hash === `#${A.id}`, 'tocar la fila lleva a su tarjeta')
  const ta = tarjeta(pagina, A)
  comprobar(/Por facturar/.test(limpio(await ta.textContent())) && (await ta.locator('[data-dias-en-espera="6"]').count()) === 1,
    'la tarjeta dice «Por facturar» con hace 6 días junto al estado')
  const resumen = limpio(await ta.locator('[data-recorrido] summary').textContent())
  comprobar(/La tiene Contabilidad/.test(resumen) && /hace 6 días/.test(resumen), `su recorrido cerrado dice quién la tiene y hace cuánto («${resumen}»)`)
  await ta.locator('[data-recorrido] summary').click()
  const pasos = await ta.locator('[data-recorrido-paso]').evaluateAll((l) => l.map((e) => `${e.dataset.recorridoPaso}:${e.dataset.situacion}`))
  comprobar(pasos.join(' > ') === 'SUBIDA:HECHO > REVISION:HECHO > CODIGO_Y_OT:HECHO > FACTURA:AHORA > COBRO:PENDIENTE',
    `abierto, va de la subida al cobro (${pasos.join(' > ')})`)

  const tb = tarjeta(pagina, B)
  await tb.locator('[data-recorrido] summary').click()
  const pasosB = await tb.locator('[data-recorrido-paso]').evaluateAll((l) => l.map((e) => `${e.dataset.recorridoPaso}:${e.dataset.situacion}`))
  comprobar(pasosB.join(' > ') === 'SUBIDA:HECHO > REVISION:HECHO > CODIGO_Y_OT:HECHO > FACTURA:HECHO > FACTURA_RESTO:AHORA > COBRO:AHORA',
    `la facturada en parte espera la factura de lo que falta y el cobro (${pasosB.join(' > ')})`)
  const textoB = limpio(await tb.locator('[data-recorrido]').textContent())
  comprobar(/Registra la factura de lo que falta/.test(textoB) && /Ahora la tiene Tesorería/.test(textoB) && /ya cobró una parte/.test(textoB),
    `en palabras: la factura de lo que falta, y Tesorería que ya cobró una parte («${textoB.slice(-260)}»)`)
  comprobar(!/10,000|4,000|20,000/.test(textoB), 'el recorrido no lleva importes')

  const tf = tarjeta(pagina, F)
  await tf.locator('[data-recorrido] summary').click()
  const pasosF = await tf.locator('[data-recorrido-paso]').evaluateAll((l) => l.map((e) => `${e.dataset.recorridoPaso}:${e.dataset.situacion}`))
  comprobar(pasosF.join(' > ') === 'SUBIDA:HECHO > REVISION:HECHO > CODIGO_Y_OT:HECHO > FACTURA:HECHO > FACTURA_RESTO:AHORA > COBRO:PENDIENTE',
    `cobrado el adelanto, el cobro no está hecho: falta facturar el resto (${pasosF.join(' > ')})`)
  const textoF = limpio(await tf.locator('[data-recorrido]').textContent())
  comprobar(/Facturada en parte/.test(textoF) && !/Cobrada/.test(textoF), `dice «Facturada en parte» y no «Cobrada» («${textoF.slice(0, 200)}»)`)

  const td = tarjeta(pagina, D)
  comprobar(/Facturada/.test(limpio(await td.textContent())) && (await td.locator('[data-dias-en-espera]').count()) === 0,
    'la facturada entera no lleva días en espera')
  const resumenD = limpio(await td.locator('[data-recorrido] summary').textContent())
  comprobar(/Cobrada/.test(resumenD), `y su recorrido terminó en el cobro («${resumenD}»)`)
  comprobar(await tarjeta(pagina, A).getByRole('button', { name: /Registrar factura/ }).count() > 0, 'Contabilidad conserva «Registrar factura» en la tarjeta')

  await pagina.evaluate(() => window.scrollTo(0, 0))
  await pagina.screenshot({ path: join(CAPTURAS, '10-1-contabilidad-1440-por-facturar.png') })
  await ta.scrollIntoViewIfNeeded()
  await ta.screenshot({ path: join(CAPTURAS, '10-1-contabilidad-1440-tarjeta-con-recorrido.png') })
  await contexto.close()
}

// ---------------------------------------------------------- 1b. Contabilidad, teléfono
{
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad, { width: 390, height: 844 })
  await ir(pagina, `${BASE}/contabilidad/facturacion`)
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `en el teléfono no se corre de costado (${ancho} px)`)
  const fila = pagina.locator(`#por-facturar tbody tr[data-por-facturar="${A.codigo}"]`)
  const texto = limpio(await fila.textContent())
  comprobar(texto.includes(CLIENTE) && /falta S\/\s?11,800\.00/.test(texto) && /hace 6 días/.test(texto),
    'en el teléfono, la fila lleva el cliente, lo que falta y los días')
  await pagina.screenshot({ path: join(CAPTURAS, '10-1-contabilidad-390-por-facturar.png') })
  const tb = tarjeta(pagina, B)
  await tb.scrollIntoViewIfNeeded()
  await tb.locator('[data-recorrido] summary').click()
  await tb.screenshot({ path: join(CAPTURAS, '10-1-contabilidad-390-tarjeta-en-parte.png') })
  await contexto.close()
}

// ---------------------------------------------------------- 2. Tesorería y Gerencia
for (const puesto of ['tesoreria', 'gerencia']) {
  const { pagina, contexto } = await entrar(CUENTAS[puesto])
  await ir(pagina, `${BASE}/contabilidad/facturacion`)
  const tb = tarjeta(pagina, B)
  const entra = (await tb.count()) === 1
  comprobar(entra, `${puesto} entra a Facturación y ve la cotización facturada en parte`)
  if (entra) {
    await tb.locator('[data-recorrido] summary').click()
    const pasos = await tb.locator('[data-recorrido-paso]').evaluateAll((l) => l.map((e) => e.dataset.recorridoPaso))
    comprobar(pasos.includes('COBRO'), `${puesto} ve el paso del cobro`)
    comprobar((await tb.getByRole('button', { name: /Registrar factura/ }).count()) === 0, `${puesto} no registra facturas`)
  }
  await contexto.close()
}

// ---------------------------------------------------------- 3. Logística no entra
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  await ir(pagina, `${BASE}/contabilidad/facturacion`)
  comprobar((await pagina.locator('#por-facturar').count()) === 0 && !new URL(pagina.url()).pathname.startsWith('/contabilidad/facturacion'),
    `Logística no entra a Facturación (queda en ${new URL(pagina.url()).pathname})`)
  await contexto.close()
}

await navegador.close()
await base.end()
for (const e of errores) console.log('  consola ·', e)
comprobar(errores.length === 0, 'sin errores de consola')
console.log(fallas.length ? `\n${fallas.length} fallas` : '\nTodo bien')
process.exit(fallas.length ? 1 : 0)
