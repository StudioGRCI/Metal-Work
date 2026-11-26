/**
 * Clic real sobre «Decisiones tomadas» (plan 12, entrega 12.2): lo que Gerencia
 * aprobó, devolvió, anuló, dio por visto o cerró, en lectura, mes por mes. Con
 * la cuenta de cada puesto, nunca ADMIN:
 *
 *   1. Gerencia ve este mes lo que decidió su puesto, igual que lo da la base
 *      con su sesión (`decisiones_tomadas`), lo más reciente primero, con el
 *      motivo de lo devuelto y lo anulado. El visto que dio Gerencia de
 *      Producción no sale. No hay ningún botón que cambie nada.
 *   2. El filtro por tipo deja solo ese tipo; el mes anterior trae la anulación
 *      del mes pasado y no las de este.
 *   3. Cada fila abre su documento: la OC cae en su fila de Órdenes de compra.
 *   4. Se llega desde «Por decidir». Gerencia de Producción y Almacén no entran.
 *   5. En el teléfono (390) nada se sale de la pantalla. Capturas en 390 y 1440.
 *
 * Solo en el banco: deja un armazón con el prefijo DT- (cotizaciones, compras,
 * un servicio, reportes diarios, un trabajo sin orden y una OT, ya decididos),
 * que se quita al empezar la corrida siguiente. Variables: BANCO_CLAVE, BASE
 * (http://localhost:3111), BANCO_BASE (mw_demo), BANCO_CHROMIUM, CAPTURAS.
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

/** Como `comoCuenta`, pero lo que hace queda: la decisión se toma por su camino real, con sus disparadores. */
async function comoCuentaYQueda(puesto, sql, valores = []) {
  const id = await idDe(puesto)
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
      set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [id])
    await base.query('set local role authenticated')
    const filas = (await base.query(sql, valores)).rows
    await base.query('commit')
    return filas
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

// ------------------------------------------------ armazón
const RUC_PROVEEDOR = '20999000470' // inventado, con su dígito de control
const ids = {}
{
  const gerencia = await idDe('gerencia')
  const produccion = await idDe('gerencia.produccion')
  const ventas = await idDe('ventas')
  const logistica = await idDe('logistica')
  await base.query('begin')
  try {
    // Sin disparadores: el armazón pone a mano quién y cuándo, como si ya hubiera pasado.
    await base.query('set local session_replication_role = replica')
    await base.query(`delete from public.ot_bitacora where orden_id in (select id from public.ordenes_trabajo where descripcion = 'DT-orden')`)
    await base.query(`delete from public.ordenes_trabajo where descripcion = 'DT-orden'`)
    await base.query(`delete from public.cotizaciones_pdf_versiones where cotizacion_id in (select id from public.cotizaciones_pdf where numero like 'DT-%')`)
    await base.query(`delete from public.cotizaciones_pdf where numero like 'DT-%'`)
    await base.query(`delete from public.ordenes_compra_materiales where referencia like 'DT-%'`)
    await base.query(`delete from public.ordenes_servicio where numero like 'OS-DT%'`)
    await base.query(`delete from public.reportes_diarios where codigo_interno = 'DT-001'`)
    await base.query(`delete from public.audit_log where tabla = 'flota_avances' and datos_despues ->> 'descripcion' like 'DT-%'`)
    await base.query(`delete from public.flota_avances where descripcion like 'DT-%'`)
    await base.query(`delete from public.flota_unidades where trabajo like 'DT-%'`)

    const [cliente] = await consulta('select id from public.clientes order by creado_en limit 1')
    const [carroceria] = await consulta('select id from public.tipos_carroceria order by creado_en limit 1')
    const [sede] = await consulta('select id from public.sedes order by creado_en limit 1')
    await base.query(
      `insert into public.proveedores (tipo_documento, numero_documento, razon_social, condicion_pago, dias_credito)
       values ('RUC', $1, 'SERVICIOS PD SAC', 'CONTADO', 0) on conflict (tipo_documento, numero_documento) do nothing`,
      [RUC_PROVEEDOR],
    )
    const [proveedor] = await consulta('select id, razon_social from public.proveedores where numero_documento = $1', [RUC_PROVEEDOR])

    // Cotizaciones: una aprobada hace 2 horas, una devuelta hace 1 hora y una anulada el mes pasado.
    const cot = async (numero, estado, extra, valores) =>
      (
        await consulta(
          `with nuevo as (select gen_random_uuid() as id)
           insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, estado, registrado_por, ${extra.columnas})
           select id, $1, $2, $3, $1 || '.pdf', 'cot/' || id || '/' || $1 || '.pdf', $4, $5, ${extra.valores} from nuevo returning id`,
          [numero, cliente.id, carroceria.id, estado, ventas, ...valores],
        )
      )[0].id
    ids.aprobada = await cot('DT-0201-2026', 'APROBADA', { columnas: 'revisado_por, revisado_en', valores: `$6, now() - interval '2 hours'` }, [gerencia])
    ids.devuelta = await cot(
      'DT-0202-2026',
      'RECHAZADA',
      { columnas: 'revisado_por, revisado_en, observacion', valores: `$6, now() - interval '1 hour', 'Falta el plano de la baranda'` },
      [gerencia],
    )
    ids.anulada = await cot(
      'DT-0203-2026',
      'ANULADA',
      {
        columnas: 'anulado_por, anulado_en, motivo_anulacion',
        valores: `$6, date_trunc('month', now() at time zone 'America/Lima') at time zone 'America/Lima' - interval '2 days', 'El cliente desistió'`,
      },
      [gerencia],
    )

    // Compras: una aprobada y una devuelta con su motivo; un servicio anulado.
    const oc = async (referencia, numero, columnas, valores) =>
      (
        await consulta(
          `insert into public.ordenes_compra_materiales (proveedor, proveedor_id, referencia, numero, moneda, creado_por, origen, motivo, ${columnas})
           values ($1, $2, $3, $4, 'PEN', $5, 'DIRECTA', 'Compra directa de prueba', ${valores}) returning id`,
          [proveedor.razon_social, proveedor.id, referencia, numero, logistica, gerencia],
        )
      )[0].id
    ids.ocAprobada = await oc('DT-REF-1', 'OC-DT01', 'aprobacion, aprobado_por, aprobado_en', `'APROBADA', $6, now() - interval '3 hours'`)
    ids.ocDevuelta = await oc(
      'DT-REF-2',
      'OC-DT02',
      'aprobacion, rechazado_por, rechazado_en, motivo_rechazo',
      `'RECHAZADA', $6, now() - interval '30 minutes', 'Pide tres cotizaciones'`,
    )
    await base.query(
      `insert into public.ordenes_servicio (numero, proveedor_id, proveedor, descripcion, monto, moneda, condicion_pago, dias_credito, aprobacion, estado,
                                            anulado_por, anulado_en, motivo_anulacion, creado_por)
       values ('OS-DT01', $1, $2, 'Arenado de chasis de prueba', 500, 'PEN', 'CONTADO', 0, 'POR_APROBAR', 'ANULADA',
               $3, now() - interval '40 minutes', 'Se hizo en el taller', $4)`,
      [proveedor.id, proveedor.razon_social, gerencia, logistica],
    )

    // Reportes diarios: uno con el visto de Gerencia y otro con el de Gerencia de Producción, que no es suyo.
    const [mtz] = await consulta(`select id from public.areas where nombre = 'Maestranza'`)
    const supMtz = await idDe('sup.mtz')
    await base.query(
      `insert into public.reportes_diarios (fecha, codigo_interno, asunto, descripcion, area_id, registrado_por, visto_gerencia_por, visto_gerencia_en)
       values ((now() at time zone 'America/Lima')::date, 'DT-001', 'Armado', 'Avance del día.', $1, $2, $3, now() - interval '50 minutes'),
              ((now() at time zone 'America/Lima')::date, 'DT-001', 'Soldadura', 'Avance del día.', $1, $2, $4, now() - interval '55 minutes')`,
      [mtz.id, supMtz, gerencia, produccion],
    )
    // Y uno por revisar, que Gerencia observa más abajo por su camino real.
    ids.reporteObservado = (
      await consulta(
        `insert into public.reportes_diarios (fecha, codigo_interno, asunto, descripcion, area_id, registrado_por)
         values ((now() at time zone 'America/Lima')::date, 'DT-001', 'Pintura', 'Avance del día.', $1, $2) returning id`,
        [mtz.id, supMtz],
      )
    )[0].id

    // Trabajo sin orden: por revisar; Gerencia lo observa y el supervisor lo corrige más abajo, por su camino real.
    const [prd] = await consulta(`select id from public.areas where nombre = 'Producción'`)
    const supPrd = await idDe('sup.prd')
    const [flota] = await consulta(
      `insert into public.flota_unidades (placa, trabajo, cliente, registrado_por) values ('DTX-123', 'DT-Reparación de baranda', 'Cliente de paso', $1) returning id`,
      [supPrd],
    )
    await base.query(
      `insert into public.flota_avances (flota_id, area_id, fecha, descripcion, avance_porcentaje, registrado_por, revision)
       values ($1, $2, (now() at time zone 'America/Lima')::date, 'DT-Cambio de baranda', 60, $3, 'PENDIENTE')`,
      [flota.id, prd.id, supPrd],
    )

    // La OT: su aprobación y su anulación solo están en la bitácora.
    const [unidad] = await consulta('select id from public.unidades order by creado_en limit 1')
    const [ot] = await consulta(
      `insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, descripcion, estado, motivo_anulacion, creado_por)
       values ('9901-2026', $1, $2, $3, 'DT-orden', 'ANULADA', 'Duplicada', $4) returning id, numero`,
      [cliente.id, unidad.id, sede.id, ventas],
    )
    ids.ot = ot.id
    await base.query(
      `insert into public.ot_bitacora (orden_id, tipo_evento, descripcion, datos, usuario_id, creado_en)
       values ($1, 'CAMBIO_ESTADO', 'Estado de la OT: BORRADOR → APROBADA', '{"estado_nuevo": "APROBADA", "estado_anterior": "BORRADOR"}', $2, now() - interval '6 hours'),
              ($1, 'CAMBIO_ESTADO', 'Estado de la OT: APROBADA → ANULADA', '{"estado_nuevo": "ANULADA", "estado_anterior": "APROBADA", "motivo": "Duplicada"}', $2, now() - interval '5 minutes')`,
      [ot.id, gerencia],
    )
    await base.query('commit')
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

// ------------------------------------------------ decisiones por su camino real
// Gerencia observa el reporte (`observar_reporte_diario`) y el trabajo sin orden (el UPDATE de la
// pantalla); el supervisor corrige el trabajo, y la base deja en nulo quién lo observó.
await comoCuentaYQueda('gerencia', `select public.observar_reporte_diario($1, 'GERENCIA', 'Falta la foto del chasis')`, [ids.reporteObservado])
await comoCuentaYQueda('gerencia', `update public.flota_avances set revision = 'OBSERVADO', observacion = 'Falta la foto del lado derecho' where descripcion = 'DT-Cambio de baranda'`)
await comoCuentaYQueda('sup.prd', `update public.flota_avances set descripcion = 'DT-Cambio de baranda, con la foto' where descripcion = 'DT-Cambio de baranda'`)
const [corregido] = await consulta(`select revision, revisado_por from public.flota_avances where descripcion like 'DT-Cambio de baranda%'`)
comprobar(corregido.revision === 'PENDIENTE' && corregido.revisado_por === null, 'el trabajo corregido vuelve a por revisar y pierde quién lo observó (por eso se lee de la bitácora)')

// ------------------------------------------------ lo que da la base con la sesión de Gerencia
const mesLima = (await consulta(`select to_char(now() at time zone 'America/Lima', 'YYYY-MM') as mes`))[0].mes
const [a, m] = mesLima.split('-').map(Number)
const mesAnterior = `${m === 1 ? a - 1 : a}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`
const delMes = async (puesto, mes) =>
  comoCuenta(
    puesto,
    `select tipo, documento, decision, motivo from public.decisiones_tomadas(to_date($1, 'YYYY-MM'), (to_date($1, 'YYYY-MM') + interval '1 month - 1 day')::date)`,
    [mes],
  )
const esperadas = await delMes('gerencia', mesLima)
console.log(`Lo que da la base a Gerencia en ${mesLima}: ${esperadas.length} decisiones`)

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
  pagina.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('_next/hmr') && !msg.text().includes('WebSocket')) errores.push(`${correo}: ${msg.text().slice(0, 300)}`)
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

const filas = (pagina) =>
  pagina.locator('[data-decision]').evaluateAll((fs) =>
    fs.map((f) => ({
      decision: f.dataset.decision,
      tipo: f.dataset.tipo,
      texto: f.textContent.replace(/\s+/g, ' ').trim(),
      href: f.querySelector('a')?.getAttribute('href') ?? null,
    })),
  )

// ------------------------------------------------ 1 a 4: Gerencia, en el monitor
{
  const { pagina, contexto } = await entrar('gerencia', 1440)
  await ir(pagina, '/por-decidir')
  const enlace = pagina.locator('main a[href="/por-decidir/decisiones"]')
  comprobar((await enlace.count()) === 1 && (await enlace.textContent())?.trim() === 'Decisiones tomadas', 'Gerencia: «Por decidir» lleva a «Decisiones tomadas», con el mismo nombre')
  await enlace.click()
  await pagina.waitForURL((u) => u.pathname === '/por-decidir/decisiones')
  await conReact(pagina)
  comprobar((await pagina.locator('h1').textContent())?.trim() === 'Decisiones tomadas', 'Gerencia: abre «Decisiones tomadas»')

  const vistas = await filas(pagina)
  comprobar(vistas.length === esperadas.length, `Gerencia: ${vistas.length} filas este mes, la base le da ${esperadas.length}`)
  const conTexto = (t) => vistas.find((f) => f.texto.includes(t))
  comprobar(conTexto('DT-0201-2026')?.decision === 'APROBADO', 'Gerencia: la cotización aprobada sale aprobada')
  comprobar(conTexto('DT-0202-2026')?.decision === 'DEVUELTO' && conTexto('DT-0202-2026')?.texto.includes('Falta el plano de la baranda'), 'Gerencia: la devuelta lleva su observación')
  comprobar(!conTexto('DT-0203-2026'), 'Gerencia: la anulada el mes pasado no sale este mes')
  comprobar(conTexto('OC-DT02')?.texto.includes('Pide tres cotizaciones'), 'Gerencia: la OC devuelta lleva su motivo')
  comprobar(conTexto('OS-DT01')?.decision === 'ANULADO' && conTexto('OS-DT01')?.texto.includes('Se hizo en el taller'), 'Gerencia: el servicio anulado lleva su motivo')
  comprobar(vistas.some((f) => f.tipo === 'REPORTE_DIARIO' && f.decision === 'VISTO' && f.texto.includes('Armado') && f.texto.includes('DT-001')),
    'Gerencia: su visto del reporte diario sale, con su asunto y su código')
  comprobar(!vistas.some((f) => f.tipo === 'REPORTE_DIARIO' && f.texto.includes('Soldadura')), 'Gerencia: el visto de Gerencia de Producción no le sale: solo lo de su puesto')
  const observado = conTexto('Pintura')
  comprobar(observado?.decision === 'DEVUELTO' && observado?.texto.includes('Falta la foto del chasis') && !observado?.texto.includes('GERENCIA'),
    `Gerencia: el reporte que observó por la pantalla sale devuelto con su motivo, no con «GERENCIA» (${observado?.texto.slice(0, 120)})`)
  comprobar(conTexto('DTX-123')?.decision === 'DEVUELTO' && conTexto('DTX-123')?.texto.includes('Falta la foto'),
    'Gerencia: el trabajo sin orden que observó sale devuelto, con su motivo, aunque el supervisor ya lo corrigió')
  comprobar(
    vistas.filter((f) => f.tipo === 'ORDEN_TRABAJO' && f.href === `/ordenes/${ids.ot}` && f.texto.includes('9901-2026')).length === 2,
    'Gerencia: la OT 9901-2026 sale aprobada y anulada, de su bitácora',
  )
  comprobar((await pagina.locator('main form, main button[type="submit"]').count()) === 0, 'Gerencia: no hay nada que cambie una decisión desde aquí')
  await capturar(pagina, 'decisiones-gerencia-1440.png')

  // 2: el filtro por tipo y el mes anterior.
  await ir(pagina, '/por-decidir/decisiones?tipo=COTIZACION')
  const cotizaciones = await filas(pagina)
  comprobar(cotizaciones.length > 0 && cotizaciones.every((f) => f.tipo === 'COTIZACION'), `Gerencia: «Cotizaciones» deja solo cotizaciones (${cotizaciones.length})`)
  await ir(pagina, '/por-decidir/decisiones?decision=DEVUELTO')
  const devueltas = await filas(pagina)
  comprobar(devueltas.length >= 3 && devueltas.every((f) => f.decision === 'DEVUELTO'), `Gerencia: «Devoluciones» deja solo devoluciones (${devueltas.length})`)
  // El mes se elige de una lista, no solo de uno en uno.
  comprobar((await pagina.locator('main select option').count()) >= 24, 'Gerencia: el mes se elige de una lista de dos años')
  await ir(pagina, `/por-decidir/decisiones?mes=${mesAnterior}`)
  const anteriores = await filas(pagina)
  comprobar(anteriores.some((f) => f.texto.includes('DT-0203-2026') && f.decision === 'ANULADO' && f.texto.includes('El cliente desistió')), `Gerencia: ${mesAnterior} trae la cotización anulada con su motivo`)
  comprobar(!anteriores.some((f) => f.texto.includes('DT-0201-2026')), `Gerencia: ${mesAnterior} no trae lo de este mes`)
  const anulada = anteriores.find((f) => f.texto.includes('DT-0203-2026'))
  comprobar(Boolean(anulada?.href?.includes('estado=ANULADA')), `Gerencia: la cotización anulada lleva el filtro de anuladas (${anulada?.href})`)
  if (anulada?.href) {
    await ir(pagina, anulada.href)
    comprobar((await pagina.locator(`[id="${ids.anulada}"]`).count()) === 1, 'Gerencia: y cae en su tarjeta')
  }
  // Con un filtro que el mes no trae, el vacío lo dice y deja quitarlo.
  await ir(pagina, `/por-decidir/decisiones?mes=${mesAnterior}&tipo=COMPRA`)
  comprobar((await pagina.getByText('Nada con ese filtro').count()) === 1 && (await pagina.getByRole('link', { name: /Ver todas las de/ }).count()) === 1,
    'Gerencia: un filtro sin nada lo dice y ofrece ver todas las del mes')
  await ir(pagina, '/por-decidir/decisiones?mes=2999-01')
  comprobar((await filas(pagina)).length === esperadas.length, 'Gerencia: un mes que todavía no empieza se queda en el de hoy')

  // 3: cada fila abre su documento.
  const compra = vistas.find((f) => f.texto.includes('OC-DT01'))
  comprobar(compra?.href === `/compras/ordenes#oc-${ids.ocAprobada}`, `Gerencia: la OC lleva a su fila en Órdenes de compra (${compra?.href})`)
  if (compra?.href) {
    await ir(pagina, compra.href)
    comprobar((await pagina.locator(`[id="oc-${ids.ocAprobada}"]`).count()) === 1, 'Gerencia: y cae en su fila')
  }
  const cotizacion = vistas.find((f) => f.texto.includes('DT-0201-2026'))
  if (cotizacion?.href) {
    await ir(pagina, cotizacion.href)
    comprobar((await pagina.locator(`[id="${ids.aprobada}"]`).count()) === 1, 'Gerencia: la cotización cae en su tarjeta')
  }
  await contexto.close()
}

// ------------------------------------------------ 5: Gerencia, en el teléfono
{
  const { pagina, contexto } = await entrar('gerencia', 390)
  await ir(pagina, '/por-decidir/decisiones')
  const sobra = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  comprobar(sobra <= 0, `Gerencia en 390: nada se sale de la pantalla (sobran ${sobra} px)`)
  await capturar(pagina, 'decisiones-gerencia-390.png')
  await contexto.close()
}

// ------------------------------------------------ 4: quien no es Gerencia General no entra
for (const puesto of ['gerencia.produccion', 'administracion', 'almacen']) {
  const { pagina, contexto } = await entrar(puesto, 1440)
  await pagina.goto(`${BASE}/por-decidir/decisiones`, { waitUntil: 'networkidle' })
  comprobar(new URL(pagina.url()).pathname === '/sin-permiso', `${puesto}: no entra (${new URL(pagina.url()).pathname})`)
  await contexto.close()
}
// Y la base no le abre la lista a Almacén aunque la pida directo.
const almacen = await comoCuenta('almacen', `select * from public.decisiones_tomadas(current_date - 1, current_date)`).then(
  () => 'entró',
  (e) => e.message,
)
comprobar(/No tienes permiso/.test(almacen), `Almacén: la base le niega la lista (${almacen})`)
// Gerencia de Producción da vistos, pero la lista es de la Gerencia General: la base pide la puerta de «Por decidir».
const produccion = await comoCuenta('gerencia.produccion', `select * from public.decisiones_tomadas(current_date - 1, current_date)`).then(
  () => 'entró',
  (e) => e.message,
)
comprobar(/No tienes permiso/.test(produccion), `Gerencia de Producción: la base le niega la lista (${produccion})`)

await navegador.close()
await base.end()
comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores.join(' | ')}` : ''}`)
console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
