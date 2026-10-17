/**
 * Recorre con clic real el costeo completo de un código interno (migración
 * 20261017300000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Gerencia ve en la lista de Códigos internos el margen del código.
 *   2. En su detalle ve el costo en soles, el margen, los gastos del mes y la
 *      caja, y en el Costeo el recargo de las extras y la tarjeta «Gastos y
 *      caja».
 *   3. Cierra el costeo: sin escribir cómo se entregó la unidad no se envía;
 *      con eso, queda congelado con su puesto. Tesorería registra otro egreso
 *      con el código y la pantalla muestra la diferencia desde el cierre.
 *      Reabrir sin motivo no deja; con motivo, sí.
 *   4. Administración ve el mismo costo del código en su Dashboard, en el
 *      expediente de la OT y en la ficha de la unidad: un solo costo. Y que
 *      está completo, no solo que es el mismo: un trámite que se aprueba en la
 *      OT sube esa cifra del Dashboard en lo que vale.
 *   5. Tesorería ve en el formulario de la caja que el pago de una OC u OS no
 *      lleva el código.
 *
 * Necesita la base sembrada con la parte de armado del check 397 (hasta el tipo
 * de cambio) y con clave en las cuentas `gerencia397@`, `oficina397@` y
 * `tesoreria397@demo.pe`. Cada corrida deja un egreso de caja, un trámite
 * aprobado y un cierre reabierto más en el código: se puede volver a correr.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CODIGO = process.env.CODIGO ?? 'CHK397_A_26/01'
const CUENTAS = {
  gerencia: process.env.GERENCIA ?? 'gerencia397@demo.pe',
  administracion: process.env.ADMINISTRACION ?? 'oficina397@demo.pe',
  tesoreria: process.env.TESORERIA ?? 'tesoreria397@demo.pe',
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

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, timezoneId: 'America/Lima' })
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

/** Espera a que la ventana abierta se cierre (la acción salió bien) o muestre su error. */
async function esperarVentana(pagina) {
  const v = pagina.locator('[role="dialog"]')
  await Promise.race([
    v.waitFor({ state: 'hidden', timeout: 30000 }),
    v.locator('[role="alert"]').waitFor({ timeout: 30000 }),
  ]).catch(() => {})
  return limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
}

const numero = (t) => Number(t)
const detalle = (vista) => `${BASE}/codigos-internos/detalle?${new URLSearchParams({ codigo: CODIGO, ...(vista ? { vista } : {}) })}`

const [esperado] = await consulta(
  `select costo_pen::float as costo, margen_pct::float as margen, recargo_extras::float as recargo,
          (gastos_mes_pen + caja_pen)::float as gastos_y_caja
     from public.codigos_internos_costo_calculado($1)`,
  [CODIGO],
)
if (!esperado) throw new Error(`La base no tiene costo para ${CODIGO}: siembra el armado del check 397.`)
const [antes] = await consulta(
  `select count(*)::int as n, count(*) filter (where motivo_reapertura is not null)::int as reabiertos,
          count(*) filter (where reabierto_en is null)::int as vigentes
     from public.codigo_interno_cierres where codigo = $1`,
  [CODIGO],
)
if (antes.vigentes > 0) throw new Error(`${CODIGO} tiene un cierre vigente de otra corrida: reábrelo antes de probar.`)
const [ot] = await consulta(
  `select o.id, u.id as unidad_id from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id
    where public.normalizar_codigo_interno(u.codigo_interno) = $1 limit 1`,
  [CODIGO],
)

// ------------------------------------------------------ 1 y 2. Gerencia mira
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  await pagina.goto(`${BASE}/codigos-internos`, { waitUntil: 'networkidle' })
  const fila = pagina.locator(`[data-codigo="${CODIGO}"]`).first()
  const margenLista = await fila.locator('[data-margen]').getAttribute('data-margen', { timeout: 5000 }).catch(() => null)
  comprobar(margenLista !== null && numero(margenLista) === esperado.margen, `la lista muestra el margen del código: ${margenLista} % (base ${esperado.margen} %)`)

  await pagina.goto(detalle(), { waitUntil: 'networkidle' })
  const costo = await pagina.locator('[data-costo]').first().getAttribute('data-costo').catch(() => null)
  comprobar(costo !== null && numero(costo) === esperado.costo, `«Costo hasta hoy» del detalle: S/ ${costo} (base ${esperado.costo})`)
  const margen = await pagina.locator('main [data-margen]').first().getAttribute('data-margen').catch(() => null)
  comprobar(margen !== null && numero(margen) === esperado.margen, `el indicador «Margen»: ${margen} %`)
  const gastos = limpio(await pagina.getByText('Gastos y caja', { exact: true }).first().locator('..').textContent().catch(() => ''))
  comprobar(gastos.includes('egreso'), `el indicador «Gastos y caja» dice: «${gastos.slice(0, 120)}»`)
  comprobar((await pagina.locator('[data-cierre="abierto"] [data-cerrar-costeo]').count()) === 1, 'Gerencia tiene el botón «Cerrar el costeo»')

  await pagina.goto(detalle('costeo'), { waitUntil: 'networkidle' })
  const recargo = await pagina.locator('[data-recargo]').first().getAttribute('data-recargo').catch(() => null)
  comprobar(recargo !== null && numero(recargo) === esperado.recargo, `el Costeo trae el recargo de las extras en mano de obra: S/ ${recargo}`)
  const filasGasto = await pagina.locator('[data-gastos-y-caja] [data-gasto]').count()
  const filasCaja = await pagina.locator('[data-gastos-y-caja] [data-gasto="CAJA"]').count()
  comprobar(filasGasto >= 2 && filasCaja >= 1, `la tarjeta «Gastos y caja» tiene ${filasGasto} filas, ${filasCaja} de caja`)
  await pagina.screenshot({ path: join(CAPTURAS, 'costeo-gastos-y-caja.png'), fullPage: true })

  // ---------------------------------------------------------- 3. el cierre
  await pagina.goto(detalle(), { waitUntil: 'networkidle' })
  await pagina.click('[data-cerrar-costeo]')
  await pagina.locator('[role="dialog"] button[type="submit"]').click()
  await pagina.waitForTimeout(800)
  const pideObservacion = await pagina.locator('[role="dialog"]').isVisible()
  const [sinCerrar] = await consulta(`select count(*)::int as n from public.codigo_interno_cierres where codigo = $1`, [CODIGO])
  comprobar(pideObservacion && sinCerrar.n === antes.n, 'sin escribir cómo se entregó la unidad, el cierre no se envía')
  await pagina.fill('#cierre-observacion', 'Unidad entregada con su acta (prueba del banco)')
  await pagina.locator('[role="dialog"] button[type="submit"]').click()
  const errorCierre = await esperarVentana(pagina)
  comprobar(errorCierre === '', `cerrar el costeo no dio error${errorCierre ? `: ${errorCierre}` : ''}`)
  await pagina.waitForSelector('[data-cierre="cerrado"]', { timeout: 15000 }).catch(() => {})
  const textoCierre = limpio(await pagina.locator('[data-cierre="cerrado"]').textContent().catch(() => ''))
  comprobar(textoCierre.includes('Costeo cerrado') && textoCierre.includes('Gerencia'), `la línea del cierre dice: «${textoCierre.slice(0, 160)}»`)
  const [cierre] = await consulta(
    `select z.costo_pen::float as costo, r.codigo as rol from public.codigo_interno_cierres z
       join public.usuarios u on u.id = z.cerrado_por join public.roles r on r.id = u.rol_id
      where z.codigo = $1 and z.reabierto_en is null`,
    [CODIGO],
  )
  comprobar(cierre?.costo === esperado.costo && cierre?.rol === 'GERENTE', `la base guardó el cierre con S/ ${cierre?.costo}, por ${cierre?.rol}`)

  // Tesorería registra otro egreso con el código después del cierre.
  const [{ id: tesoreriaId }] = await consulta(`select id from public.usuarios where correo = $1`, [CUENTAS.tesoreria])
  await base.query('begin')
  await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                           set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [tesoreriaId])
  await base.query('set local role authenticated')
  await base.query(
    `select public.registrar_movimiento_caja(gen_random_uuid(), (select id from public.cajas where activa order by creado_en limit 1),
            (now() at time zone 'America/Lima')::date - 1, 'EGRESO', 100, 'Comisión de venta de la unidad (prueba)', $1, null, null)`,
    [CODIGO],
  )
  await base.query('commit')

  await pagina.reload({ waitUntil: 'networkidle' })
  const diferencia = await pagina.locator('[data-despues-del-cierre]').getAttribute('data-despues-del-cierre').catch(() => null)
  comprobar(diferencia !== null && numero(diferencia) === 100, `después del cierre la pantalla avisa la diferencia: S/ ${diferencia}`)

  await pagina.click('[data-reabrir-costeo]')
  await pagina.fill('#reabrir-motivo', 'corto')
  await pagina.locator('[role="dialog"] button[type="submit"]').click()
  await pagina.waitForTimeout(800)
  const sigueAbierta = await pagina.locator('[role="dialog"]').isVisible()
  comprobar(sigueAbierta, 'reabrir con un motivo de 5 letras no se envía')
  await pagina.fill('#reabrir-motivo', 'Entró la comisión de venta después de la entrega')
  await pagina.locator('[role="dialog"] button[type="submit"]').click()
  const errorReabrir = await esperarVentana(pagina)
  comprobar(errorReabrir === '', `reabrir con motivo no dio error${errorReabrir ? `: ${errorReabrir}` : ''}`)
  await pagina.waitForSelector('[data-cierre="abierto"]', { timeout: 15000 }).catch(() => {})
  comprobar((await pagina.locator('[data-cierre="abierto"]').count()) === 1, 'el código vuelve a costearse en vivo')
  const [historia] = await consulta(`select count(*)::int as n, count(*) filter (where motivo_reapertura is not null)::int as reabiertos
                                       from public.codigo_interno_cierres where codigo = $1`, [CODIGO])
  comprobar(historia.n === antes.n + 1 && historia.reabiertos === antes.reabiertos + 1, 'el cierre anterior quedó como evidencia, con su motivo')
  comprobar(errores.length === 0, `Gerencia sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

const [ahora] = await consulta(`select costo_pen::float as costo from public.codigos_internos_costo_calculado($1)`, [CODIGO])

// ------------------------------------------------- 4. Administración, un solo costo y completo
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.administracion)
  await pagina.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  const fila = limpio(await pagina.locator(`a[href="/ordenes/${ot?.id}"]`).first().textContent({ timeout: 5000 }).catch(() => ''))
  const soles = `S/ ${ahora.costo.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
  comprobar(fila.includes(soles.replace('S/ ', '')), `el Dashboard de Administración dice el costo del código en la OT: «${fila.slice(-90)}» (base ${soles})`)

  // Completo, no solo el mismo: un trámite de S/ 37.25 aprobado en la OT sube la cifra del Dashboard en eso.
  const enPantalla = async () => {
    const t = await pagina.locator(`a[href="/ordenes/${ot?.id}"] [data-costo-orden]`).first().getAttribute('data-costo-orden', { timeout: 5000 }).catch(() => null)
    return t === null ? null : numero(t)
  }
  const cifraAntes = await enPantalla()
  const [{ id: oficinaId }] = await consulta(`select id from public.usuarios where correo = $1`, [CUENTAS.administracion])
  await base.query(
    `insert into public.ot_gastos_areas (id, orden_id, area_id, tipo, descripcion, fecha, monto, moneda, comprobante_ruta, comprobante_nombre,
                                         estado, registrado_por, revisado_por, revisado_en)
     select g.id, $1::uuid, (select id from public.areas where codigo = 'ADM'), 'TRAMITE', 'Trámite de placas (prueba del banco)',
            (now() at time zone 'America/Lima')::date, 37.25, 'PEN', 'ot/' || $1::text || '/gastos/' || g.id || '.pdf', 'banco.pdf',
            'APROBADO', $2::uuid, $2::uuid, now()
       from (select gen_random_uuid() as id) g`,
    [ot?.id, oficinaId],
  )
  await pagina.reload({ waitUntil: 'networkidle' })
  const cifraDespues = await enPantalla()
  comprobar(
    cifraAntes !== null && cifraDespues !== null && Math.round((cifraDespues - cifraAntes) * 100) === 3725,
    `el trámite aprobado en la OT sube el costo del Dashboard de ${cifraAntes} a ${cifraDespues} (S/ 37.25)`,
  )
  const [luego] = await consulta(`select costo_pen::float as costo from public.codigos_internos_costo_calculado($1)`, [CODIGO])
  const solesLuego = luego.costo.toLocaleString('en-US', { minimumFractionDigits: 2 })

  await pagina.goto(`${BASE}/ordenes/${ot?.id}/expediente`, { waitUntil: 'networkidle' })
  const enExpediente = await pagina.locator('[data-costo-codigo]').first().getAttribute('data-costo-codigo').catch(() => null)
  comprobar(enExpediente !== null && numero(enExpediente) === luego.costo, `el expediente de la OT dice el costo del código: S/ ${enExpediente}`)

  await pagina.goto(`${BASE}/unidades/${ot?.unidad_id}`, { waitUntil: 'networkidle' })
  const cifra = limpio(await pagina.locator('section[aria-label="Costo en el taller"]').textContent({ timeout: 5000 }).catch(() => ''))
  comprobar(cifra.includes(solesLuego) && cifra.includes(CODIGO), `la ficha de la unidad: «${cifra.slice(0, 160)}»`)
  comprobar(errores.length === 0, `Administración sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// --------------------------------------------------------- 5. Tesorería, la caja
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.tesoreria)
  await pagina.goto(`${BASE}/tesoreria/caja-diaria`, { waitUntil: 'networkidle' })
  await pagina.locator('[data-registrar-movimiento]').first().click()
  const ventana = limpio(await pagina.locator('[role="dialog"]').textContent({ timeout: 5000 }).catch(() => ''))
  comprobar(
    ventana.includes('No lo pongas en el pago de una OC, OS') && ventana.includes('ya aprobó en la OT'),
    'el formulario de la caja avisa que el pago de una OC u OS, o un gasto ya aprobado en la OT, no lleva el código',
  )
  comprobar(errores.length === 0, `Tesorería sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} fallas.` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
