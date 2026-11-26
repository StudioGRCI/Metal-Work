/**
 * Lo facturado de una cotización en cada moneda (migración 20261126960000),
 * con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Gerencia, en la pestaña «Factura y cobro» del código, ve lo
 *      facturado y cobrado en dólares de una cotización en dólares, y aparte,
 *      en su propia línea, lo facturado en soles. Antes salía una sola cifra
 *      en dólares con los soles sumados adentro.
 *   2. Tesorería, en Cuentas por cobrar, ve la misma cotización con las dos
 *      líneas separadas.
 *   3. Una cotización con todas sus facturas en su moneda no muestra la línea
 *      de la otra moneda.
 *
 * Siembra por SQL, como dueño de la base y con un sello por corrida: una
 * cotización aprobada en dólares con su OT y su código, una factura en dólares
 * con un cobro a cuenta y una en soles sin cobrar; y otra en soles con una sola
 * factura en soles. Guarda las capturas en 390 y 1440.
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
const anio = (await uno(`select to_char((now() at time zone 'America/Lima')::date, 'YYYY') as a`)).a
const ruc = (await uno(`select n::text as ruc from generate_series(20990150000::bigint, 20990199999::bigint) n
                         where public.ruc_es_valido(n::text) and not exists (select 1 from public.clientes t where t.numero_documento = n::text) limit 1`)).ruc
const CLIENTE = `TRANSPORTES DOS MONEDAS ${sello} S.A.C.`
const clienteId = (await uno(
  `insert into public.clientes (tipo_documento, numero_documento, razon_social, direccion_fiscal) values ('RUC', $1, $2, 'Av. de Prueba 472') returning id`,
  [ruc, CLIENTE],
)).id
const carroceria = (await uno(`select id from public.tipos_carroceria where activo order by orden_secuencia limit 1`)).id
const sede = (await uno(`select id from public.sedes order by nombre limit 1`)).id

async function enReplica(fn) {
  await base.query('begin')
  try {
    await base.query('set local session_replication_role = replica')
    const r = await fn()
    await base.query('commit')
    return r
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

/** Una cotización aprobada hace 12 días, con IGV, en `moneda`, y su OT con el código interno. */
async function aprobada(letra, monto, moneda) {
  const { numero } = await uno(
    `select n || '-' || $1 as numero from generate_series(3900, 8999) n
      where not exists (select 1 from public.cotizaciones_pdf c where c.numero = n || '-' || $1) order by n limit 1`,
    [anio],
  )
  const codigo = `QA-M${letra} ${sello}`
  const { id } = await uno('select gen_random_uuid() as id')
  await enReplica(async () => {
    await consulta(
      `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, tamano_bytes,
                                            registrado_por, monto_venta, moneda, estado, revisado_por, revisado_en, creado_en, archivo_subido_en)
       values ($9, $1, $2, $3, $4, $5, 'application/pdf', 900, $6, $7, $10, 'APROBADA', $8, now() - interval '12 days', now() - interval '13 days', now() - interval '13 days')`,
      [numero, clienteId, carroceria, `${numero}.pdf`, `cot/${id}/${numero}.pdf`, ventas, monto, gerencia, id, moneda],
    )
    await consulta(`insert into public.cotizaciones_pdf_igv (cotizacion_id, version, incluye_igv, confirmado_por) values ($1, 1, true, $2)`, [id, ventas])
  })
  const unidad = (await uno(
    `insert into public.unidades (cliente_id, placa, marca, modelo, tipo_vehiculo, codigo_interno) values ($1, $2, 'VOLVO', 'FMX', 'VOLQUETE', $3) returning id`,
    [clienteId, `${letra}${sello.slice(0, 2)}-${sello.slice(3)}`, codigo],
  )).id
  await consulta(
    `insert into public.ordenes_trabajo (sede_id, descripcion, cliente_id, unidad_id, cotizacion_pdf_id) values ($1, 'Plataforma en dos monedas del banco', $2, $3, $4)`,
    [sede, clienteId, unidad, id],
  )
  return { id, numero, codigo }
}

/** Una factura vigente de esa cotización en `moneda`, registrada por Contabilidad, y si `cobro`, un cobro de Tesorería. */
async function factura(cot, moneda, total, cobro) {
  const serie = (await uno(
    `select 'E' || lpad(n::text, 3, '0') || '-' || $1 as s from generate_series(100, 999) n
      where not exists (select 1 from public.facturas_venta f where f.numero = 'E' || lpad(n::text, 3, '0') || '-' || $1) order by n limit 1`,
    [sello.slice(-3)],
  )).s
  await enReplica(async () => {
    const { id } = await uno(
      `insert into public.facturas_venta (codigo_interno, cotizacion_pdf_id, cotizacion_numero, cliente_id, cliente, numero, fecha_emision,
                                          fecha_vencimiento, moneda, total, ruta_storage, nombre_archivo, tamano_bytes, registrado_por, creado_en)
       values ($1, $2, $3, $4, $5, $6, current_date - 1, current_date + 29, $10, $7, $8, 'f.pdf', 900, $9, now() - interval '1 day') returning id`,
      [cot.codigo, cot.id, cot.numero, clienteId, CLIENTE, serie, total, `${sello}/${serie}.pdf`, contabilidad, moneda],
    )
    if (cobro) {
      await consulta(
        `insert into public.cobros_factura_venta (factura_id, fecha, moneda, monto, cancela, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
         values ($1, current_date, $6, $2, $3, $4, 'application/pdf', 900, $5)`,
        [id, cobro, false, `${id}/${sello}.pdf`, tesoreria, moneda],
      )
    }
  })
}

const D = await aprobada('D', 29500, 'USD') // US$ 29,500 con el IGV dentro
await factura(D, 'USD', 29500, 10000)
await factura(D, 'PEN', 1000, null)
const S = await aprobada('S', 11800, 'PEN') // S/ 11,800 con el IGV dentro, facturada solo en soles
await factura(S, 'PEN', 11800, 5000)
console.log(`     sembrado: ${D.codigo} (cotización ${D.numero}, en dólares con una factura en soles), ${S.codigo} (cotización ${S.numero}, solo soles)`)

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
const sinCorrerse = async (pagina, ancho, donde) => {
  const doc = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(doc <= ancho, `${donde} en ${ancho}: no se corre de costado (${doc} px)`)
}

/** Lo que dice la cotización `numero` dentro de `contenedor`, y su línea de la otra moneda. */
async function lineas(pagina, contenedor, numero) {
  const caja = pagina.locator(`${contenedor}[data-cotizacion="${numero}"]`).first()
  await caja.waitFor({ timeout: 20000 })
  const texto = limpio(await caja.innerText())
  const otra = caja.locator('[data-otra-moneda]')
  return { caja, texto, otra: (await otra.count()) ? limpio(await otra.innerText()) : null }
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const w = viewport.width
  // 1. Gerencia, en la pestaña «Factura y cobro» del código (Contabilidad no abre Códigos internos).
  {
    const { pagina, contexto } = await entrar(CUENTAS.gerencia, viewport)
    await ir(pagina, `${BASE}/codigos-internos/detalle?codigo=${encodeURIComponent(D.codigo)}&vista=facturacion`)
    const d = await lineas(pagina, 'li', D.numero)
    comprobar(/Facturado US\$ 29,500\.00 · cobrado US\$ 10,000\.00/.test(d.texto), `Gerencia ${w}: en dólares, solo lo de dólares («${d.texto.slice(0, 160)}»)`)
    comprobar(!/30,500/.test(d.texto), `Gerencia ${w}: ya no suma los soles a los dólares`)
    comprobar(d.otra === 'Y en soles: facturado S/ 1,000.00 · cobrado S/ 0.00', `Gerencia ${w}: los soles en su línea («${d.otra}»)`)
    await d.caja.scrollIntoViewIfNeeded()
    await pagina.screenshot({ path: join(CAPTURAS, `factura-y-cobro-${w}.png`) })
    await sinCorrerse(pagina, w, 'Factura y cobro')

    await ir(pagina, `${BASE}/codigos-internos/detalle?codigo=${encodeURIComponent(S.codigo)}&vista=facturacion`)
    const s = await lineas(pagina, 'li', S.numero)
    comprobar(/Facturado S\/ 11,800\.00 · cobrado S\/ 5,000\.00/.test(s.texto), `Gerencia ${w}: la de soles sigue igual («${s.texto.slice(0, 120)}»)`)
    comprobar(s.otra === null, `Gerencia ${w}: sin factura en otra moneda no hay segunda línea`)
    await contexto.close()
  }
  // 2. Tesorería, en Cuentas por cobrar.
  {
    const { pagina, contexto } = await entrar(CUENTAS.tesoreria, viewport)
    await ir(pagina, `${BASE}/tesoreria/por-cobrar`)
    const d = await lineas(pagina, 'div', D.numero)
    comprobar(/Facturado US\$ 29,500\.00.*cobrado US\$ 10,000\.00/.test(d.texto), `Tesorería ${w}: en dólares, solo lo de dólares («${d.texto.slice(0, 200)}»)`)
    comprobar(!/30,500/.test(d.texto), `Tesorería ${w}: ya no suma los soles a los dólares`)
    comprobar(d.otra === 'Y en soles: facturado S/ 1,000.00 · cobrado S/ 0.00', `Tesorería ${w}: los soles en su línea («${d.otra}»)`)
    const s = await lineas(pagina, 'div', S.numero)
    comprobar(s.otra === null, `Tesorería ${w}: la de solo soles no lleva segunda línea`)
    await d.caja.scrollIntoViewIfNeeded()
    await pagina.screenshot({ path: join(CAPTURAS, `por-cobrar-${w}.png`) })
    await sinCorrerse(pagina, w, 'Cuentas por cobrar')
    await contexto.close()
  }
}

await navegador.close()
await base.end()
if (errores.length) {
  console.log(`Errores de consola:\n${errores.join('\n')}`)
  fallas.push('errores de consola')
}
console.log(fallas.length ? `\n${fallas.length} FALLAS` : '\nTodo bien')
process.exit(fallas.length ? 1 : 0)
