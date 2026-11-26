/**
 * Clic real sobre «Por decidir» (plan 12, entrega 12.1): lo que espera a
 * Gerencia, reunido. Con la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Gerencia ve los seis grupos —cotizaciones, compras y servicios, pagos
 *      detenidos, reportes diarios, trabajos sin orden y cierre de códigos—,
 *      cada uno con las filas que da la base con su sesión, lo más antiguo
 *      primero y con sus días. No hay ningún botón que apruebe: cada fila es un
 *      enlace a su pantalla, y el de la compra cae en su tarjeta.
 *   2. La pantalla está en «Por aprobar» de su menú, primera.
 *   3. Gerencia de Producción, que da el visto al reporte diario, entra y ve
 *      solo ese grupo. Almacén no entra (va a «Sin permiso»).
 *   4. En el teléfono (390) nada se sale de la pantalla. Capturas en 390 y 1440.
 *
 * Solo en el banco: deja un armazón con el prefijo PD- (dos cotizaciones por
 * revisar, una OC y una OS por aprobar, una factura detenida por esa OC, dos
 * reportes diarios sin visto, un reporte de un trabajo sin orden y un código
 * entregado con el costeo abierto), con las horas corridas para que el orden
 * se note. Lo de una corrida anterior se quita antes. Variables: BANCO_CLAVE,
 * BASE (http://localhost:3111), BANCO_BASE (mw_demo), BANCO_CHROMIUM, CAPTURAS.
 */
import { mkdirSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { conReact } from './con-react.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
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
const correoDe = (puesto) => `${puesto}.local@metalwork.test`
const idDe = async (puesto) => (await consulta('select id from public.usuarios where correo = $1', [correoDe(puesto)]))[0]?.id

/** Lo que da la base con la sesión de esa cuenta y el rol authenticated. */
async function comoCuenta(puesto, sql, valores = []) {
  const id = await idDe(puesto)
  if (!id) throw new Error(`El banco no tiene la cuenta ${correoDe(puesto)}: corre preparar.sh.`)
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
      set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [id])
    await base.query('set local role authenticated')
    return (await base.query(sql, valores)).rows
  } finally {
    await base.query('rollback')
  }
}

// ------------------------------------------------ armazón
const CODIGO = 'MW-PD-001'
{
  const ventas = await idDe('ventas')
  const logistica = await idDe('logistica')
  const supMtz = await idDe('sup.mtz')
  const supPrd = await idDe('sup.prd')
  const contabilidad = await idDe('contabilidad')
  await base.query('begin')
  try {
    // Sin disparadores: el armazón pone a mano quién y cuándo, como si ya hubiera pasado.
    await base.query('set local session_replication_role = replica')
    await base.query(`delete from public.adquisiciones_ordenes_compra where adquisicion_id in (select id from public.adquisiciones where numero_documento like 'F0PD-%')`)
    await base.query(`delete from public.adquisiciones where numero_documento like 'F0PD-%'`)
    await base.query(`delete from public.ordenes_compra_materiales where referencia like 'PD-%'`)
    await base.query(`delete from public.ordenes_servicio where numero like 'OS-PD%'`)
    await base.query(`delete from public.cotizaciones_pdf where numero like 'PD-%'`)
    await base.query(`delete from public.reportes_diarios where codigo_interno = $1`, [CODIGO])
    await base.query(`delete from public.flota_avances where descripcion like 'PD-%'`)
    await base.query(`delete from public.flota_unidades where trabajo like 'PD-%'`)
    await base.query(`delete from public.ot_entregas where numero like 'PD-%'`)

    const [cliente] = await consulta('select id from public.clientes order by creado_en limit 1')
    const [carroceria] = await consulta('select id from public.tipos_carroceria order by creado_en limit 1')
    for (const [numero, dias, monto] of [['PD-0101-2026', 6, 85000], ['PD-0102-2026', 1, 42000]]) {
      await base.query(
        `with nuevo as (select gen_random_uuid() as id)
         insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, estado, registrado_por, creado_en, archivo_subido_en, monto_venta, moneda)
         select id, $1, $2, $3, $1 || '.pdf', 'cot/' || id || '/' || $1 || '.pdf', 'POR_REVISAR', $4, now() - make_interval(days => $5), now() - make_interval(days => $5), $6, 'PEN' from nuevo`,
        [numero, cliente.id, carroceria.id, ventas, dias, monto],
      )
    }
    const [oc] = await consulta(
      `insert into public.ordenes_compra_materiales (proveedor, referencia, numero, moneda, aprobacion, creado_por, creado_en, aprobacion_pedida_en, condicion_pago, dias_credito, origen, motivo, lineas_rechazadas)
       values ('ACEROS PD SAC', 'PD-REF-1', 'OC-PD01', 'PEN', 'POR_APROBAR', $1, now() - interval '4 days', now() - interval '4 days', 'CREDITO', 30, 'DIRECTA', 'Compra directa de prueba',
               '[{"cantidad": 2, "precio_unitario": 150, "material": "Plancha PD"}]'::jsonb)
       returning id`,
      [logistica],
    )
    await base.query(
      `insert into public.proveedores (tipo_documento, numero_documento, razon_social, condicion_pago, dias_credito)
       values ('RUC', '20100047218', 'SERVICIOS PD SAC', 'CONTADO', 0) on conflict (tipo_documento, numero_documento) do nothing`,
    )
    const [proveedor] = await consulta(`select id, razon_social from public.proveedores where numero_documento = '20100047218'`)
    const gerencia = await idDe('gerencia')
    {
      // Una OS ya aprobada con el código: le da costo, sin costo no hay qué cerrar.
      await base.query(
        `insert into public.ordenes_servicio (numero, proveedor_id, proveedor, descripcion, monto, moneda, aprobacion, aprobado_por, aprobado_en, estado, condicion_pago, dias_credito, codigo_interno, creado_por, creado_en)
         values ('OS-PD02', $1, $2, 'Pintura de carrocería completa', 1200, 'PEN', 'APROBADA', $3, now() - interval '10 days', 'EMITIDA', 'CONTADO', 0, $4, $5, now() - interval '12 days')`,
        [proveedor.id, proveedor.razon_social, gerencia, CODIGO, logistica],
      )
      await base.query(
        `insert into public.ordenes_servicio (numero, proveedor_id, proveedor, descripcion, monto, moneda, aprobacion, estado, condicion_pago, dias_credito, creado_por, creado_en)
         values ('OS-PD01', $1, $2, 'Arenado de chasis completo', 500, 'PEN', 'POR_APROBAR', 'EMITIDA', 'CONTADO', 0, $3, now() - interval '2 days')`,
        [proveedor.id, proveedor.razon_social, logistica],
      )
    }
    const [factura] = await consulta(
      `insert into public.adquisiciones (tipo, proveedor, numero_documento, fecha_emision, fecha_vencimiento, moneda, total, condicion_pago, estado, orden_compra_id, registrado_por, ruta_storage)
       values ('FACTURA_COMPRA', 'ACEROS PD SAC', 'F0PD-000123', (now() at time zone 'America/Lima')::date - 3, (now() at time zone 'America/Lima')::date + 27, 'PEN', 354, 'CREDITO', 'REGISTRADA', $1, $2, 'pd/f0pd.pdf')
       returning id`,
      [oc.id, contabilidad],
    )
    await base.query('insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id) values ($1, $2)', [factura.id, oc.id])

    const [mtz] = await consulta(`select id from public.areas where nombre = 'Maestranza'`)
    const [prd] = await consulta(`select id from public.areas where nombre = 'Producción'`)
    for (const [dias, asunto] of [[3, 'Armado de bastidor'], [0, 'Soldadura de parantes']]) {
      await base.query(
        `insert into public.reportes_diarios (fecha, codigo_interno, asunto, descripcion, area_id, registrado_por, creado_en)
         values ((now() at time zone 'America/Lima')::date - $1::int, $2, $3, 'Avance del día con fotos.', $4, $5, now() - make_interval(days => $1::int))`,
        [dias, CODIGO, asunto, mtz.id, supMtz],
      )
    }
    const [flota] = await consulta(
      `insert into public.flota_unidades (placa, trabajo, cliente, registrado_por, creado_en) values ('PDX-123', 'PD-Reparación de baranda', 'Cliente de paso', $1, now() - interval '6 days') returning id`,
      [supPrd],
    )
    await base.query(
      `insert into public.flota_avances (flota_id, area_id, fecha, descripcion, avance_porcentaje, registrado_por, revision, creado_en)
       values ($1, $2, (now() at time zone 'America/Lima')::date - 5, 'PD-Cambio de baranda lateral', 60, $3, 'PENDIENTE', now() - interval '5 days')`,
      [flota.id, prd.id, supPrd],
    )
    // El código: la unidad de la OT entregada lleva el código y su acta (la de la demo, o una de hace 8 días).
    const [ot] = await consulta(`select id, unidad_id from public.ordenes_trabajo where estado = 'ENTREGADA' order by numero limit 1`)
    await base.query('update public.unidades set codigo_interno = $1 where id = $2', [CODIGO, ot.unidad_id])
    await base.query(
      `insert into public.ot_entregas (numero, orden_id, fecha_entrega, recibe_nombre, conforme) values ('PD-ACTA-1', $1, (now() at time zone 'America/Lima')::date - 8, 'Cliente PD', true)
       on conflict (orden_id) do nothing`,
      [ot.id],
    )
    await base.query('commit')
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

// ------------------------------------------------ lo que da la base con la sesión de Gerencia
const esperados = {
  cotizaciones: (await comoCuenta('gerencia', `select numero from public.v_cotizaciones_pdf where estado = 'POR_REVISAR'`)).length,
  compras: (await comoCuenta('gerencia', `select 1 from public.documentos_por_aprobar() where aprobacion = 'POR_APROBAR'`)).length,
  reportes: (await comoCuenta('gerencia', `select 1 from public.reportes_diarios where anulado_en is null and observado_en is null and visto_gerencia_en is null`)).length,
  trabajos: (await comoCuenta('gerencia', `select 1 from public.v_flota_avance_diario where revision = 'PENDIENTE'`)).length,
}
console.log('Lo que da la base a Gerencia:', esperados)

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(puesto, ancho = 1440) {
  const correo = correoDe(puesto)
  const telefono = ancho <= 480
  const contexto = await navegador.newContext({
    viewport: { width: ancho, height: telefono ? 844 : 900 },
    deviceScaleFactor: 2,
    hasTouch: telefono,
    isMobile: telefono,
    timezoneId: 'America/Lima',
  })
  const pagina = await contexto.newPage()
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
  pagina.on('pageerror', (e) => errores.push(`${correo}: ${String(e).slice(0, 300)}`))
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

async function ir(pagina, ruta) {
  await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
  await conReact(pagina)
}

async function capturar(pagina, archivo) {
  await pagina.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
  const ventana = pagina.viewportSize()
  const alto = await pagina.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight))
  await pagina.setViewportSize({ width: ventana.width, height: Math.max(alto, ventana.height) })
  await pagina.evaluate(() => window.scrollTo(0, 0))
  await pagina.screenshot({ path: `${CAPTURAS}/${archivo}` })
  await pagina.setViewportSize(ventana)
}

async function sinDesborde(pagina, donde) {
  const sobra = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  comprobar(sobra <= 0, `${donde}: nada se sale de la pantalla (sobran ${sobra} px)`)
}

/** Cada grupo con sus filas: qué es, los días y adónde lleva. */
const grupos = (pagina) =>
  pagina.locator('[data-grupo-por-decidir]').evaluateAll((gs) =>
    gs.map((g) => ({
      clave: g.dataset.grupoPorDecidir,
      cantidad: Number(g.dataset.cantidad),
      filas: [...g.querySelectorAll('[data-por-decidir]')].map((f) => ({
        que: f.querySelector('td p')?.textContent.trim() ?? '',
        dias: f.querySelector('[data-dias-en-espera]') ? Number(f.querySelector('[data-dias-en-espera]').dataset.diasEnEspera) : null,
        desde: f.querySelector('[data-dias-en-espera]')?.dataset.desde ?? null,
        href: f.querySelector('a')?.getAttribute('href') ?? null,
      })),
    })),
  )

// ------------------------------------------------ 1 y 2: Gerencia, en el monitor
{
  const { pagina, contexto } = await entrar('gerencia', 1440)
  await ir(pagina, '/por-decidir')
  comprobar((await pagina.locator('h1').textContent())?.trim() === 'Por decidir', 'Gerencia: abre «Por decidir»')
  const leidos = await grupos(pagina)
  const de = (c) => leidos.find((g) => g.clave === c)
  for (const [clave, n] of Object.entries(esperados)) {
    comprobar(de(clave)?.cantidad === n, `Gerencia: ${clave} trae ${de(clave)?.cantidad} filas, la base le da ${n}`)
  }
  comprobar((de('pagos')?.filas ?? []).some((f) => f.que.includes('F0PD-000123')), 'Gerencia: la factura detenida por la OC-PD01 sale en Pagos')
  comprobar((de('pagos')?.filas ?? []).every((f) => f.href?.startsWith('/compras/aprobacion#OC-')), 'Gerencia: el pago detenido lleva a su OC en Aprobación de compras')
  comprobar((de('cierres')?.filas ?? []).some((f) => f.que.includes(CODIGO)), `Gerencia: ${CODIGO}, entregado con el costeo abierto, sale en Cierre de códigos`)
  for (const g of leidos) {
    const fechas = g.filas.map((f) => f.desde).filter(Boolean)
    comprobar(fechas.every((x, i) => i === 0 || Date.parse(fechas[i - 1]) <= Date.parse(x)), `Gerencia: ${g.clave}, lo más antiguo primero`)
    comprobar(g.filas.every((f) => f.dias !== null), `Gerencia: ${g.clave}, cada fila con sus días`)
  }
  // Los días son los de la base, con su sesión.
  const cot = de('cotizaciones')?.filas.find((f) => f.que.includes('PD-0101-2026'))
  if (cot?.desde) {
    const [{ dias }] = await comoCuenta('gerencia', 'select dias from public.dias_en_espera_de(array[$1::timestamptz])', [cot.desde])
    comprobar(cot.dias === Number(dias) && cot.dias === 6, `Gerencia: la PD-0101-2026 espera ${cot.dias} días, la base dice ${dias}`)
  }
  comprobar((await pagina.locator('main form, main button[type="submit"]').count()) === 0, 'Gerencia: no hay nada que apruebe desde aquí')
  // El menú: primera en «Por aprobar».
  const primera = await pagina.locator('nav a[href="/por-decidir"]').first()
  comprobar((await primera.count()) === 1, 'Gerencia: «Por decidir» está en su menú')
  await capturar(pagina, 'por-decidir-gerencia-1440.png')
  // El salto de la compra cae en su tarjeta.
  const compra = de('compras')?.filas.find((f) => f.que.includes('OC-PD01'))
  if (compra?.href) {
    await ir(pagina, compra.href)
    const destino = compra.href.split('#')[1]
    comprobar((await pagina.locator(`[id="${destino}"]`).count()) === 1, 'Gerencia: el enlace de la OC cae en su tarjeta de Aprobación de compras')
  }
  await contexto.close()
}

// ------------------------------------------------ 4: Gerencia, en el teléfono
{
  const { pagina, contexto } = await entrar('gerencia', 390)
  await ir(pagina, '/por-decidir')
  await sinDesborde(pagina, 'Gerencia en 390')
  await capturar(pagina, 'por-decidir-gerencia-390.png')
  await contexto.close()
}

// ------------------------------------------------ 3: Gerencia de Producción y Almacén
{
  const { pagina, contexto } = await entrar('gerencia.produccion', 1440)
  await ir(pagina, '/por-decidir')
  const leidos = await grupos(pagina)
  const claves = (await pagina.locator('nav[aria-label="Grupos por decidir"] a').evaluateAll((as) => as.length))
  comprobar(claves === 1 && leidos.every((g) => g.clave === 'reportes'), `Gerencia de Producción: ve solo los reportes diarios (${claves} grupo(s))`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('almacen', 1440)
  await pagina.goto(`${BASE}/por-decidir`, { waitUntil: 'networkidle' })
  comprobar(new URL(pagina.url()).pathname === '/sin-permiso', `Almacén: no entra (${new URL(pagina.url()).pathname})`)
  await contexto.close()
}

await navegador.close()
await base.end()
comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
