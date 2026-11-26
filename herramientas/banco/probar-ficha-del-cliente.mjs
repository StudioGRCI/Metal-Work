/**
 * Clic real sobre el Plan 9 · 9.2 (migración 20261126210000): la ficha del
 * cliente dice cómo va cada unidad y cada cotización. Con la cuenta de Ventas,
 * nunca ADMIN:
 *
 *   1. Siembra en el banco, a un cliente, tres unidades con su OT (una en
 *      fabricación, una pausada y una entregada con su acta) y una sin OT, con
 *      los disparadores apagados: lo que se prueba es la lectura. Si el cliente
 *      no tiene cotizaciones, le sube una con la cuenta de Ventas.
 *   2. En /clientes/<id>, cada unidad con OT dice su estado en una palabra, su
 *      OT y la fecha de entrega comprometida, igual que la base con la sesión de
 *      Ventas; la unidad sin OT no dice nada. Ningún porcentaje en la tarjeta.
 *   3. La tarjeta «Cotizaciones» lista las vigentes del cliente con su estado y
 *      quién la tiene ahora (las anuladas solo se cuentan); su enlace lleva a la
 *      tarjeta de esa cotización, a la vista y marcada.
 *   4. En el teléfono, la fecha comprometida se lee en un renglón: los botones
 *      de la unidad bajan, no la aprietan.
 *   5. Administración ve la ficha igual; Almacén, sin `clientes.ver`, no entra.
 *   6. En el teléfono (390) nada se sale de la pantalla.
 *
 * Deja capturas en CAPTURAS, en 390 y 1440. Variables: BANCO_CLAVE, BASE
 * (http://localhost:3111), BANCO_BASE (mw_demo), BANCO_CHROMIUM, CAPTURAS.
 */
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

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
const uno = async (sql, valores = []) => (await consulta(sql, valores))[0]

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const correoDe = (puesto) => `${puesto}.local@metalwork.test`

/** Con la sesión de esa cuenta y el rol authenticated; `guardar` deja lo escrito. */
async function comoCuenta(puesto, sql, valores = [], guardar = false) {
  const cuenta = await uno('select id from public.usuarios where correo = $1', [correoDe(puesto)])
  if (!cuenta) throw new Error(`El banco no tiene la cuenta ${correoDe(puesto)}: corre preparar.sh.`)
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
      set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [cuenta.id])
    await base.query('set local role authenticated')
    const filas = (await base.query(sql, valores)).rows
    await base.query(guardar ? 'commit' : 'rollback')
    return filas
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

// ============================================ 1. Las unidades y sus OT
const cliente = await uno(`select id, razon_social from public.clientes where activo order by razon_social limit 1`)
const sede = await uno(`select id from public.sedes order by codigo limit 1`)
const letras = () => Array.from({ length: 3 }, () => 'ABCDEFGHJKLMNPRSTUVWXYZ'[Math.floor(Math.random() * 23)]).join('')
const sello = Date.now().toString().slice(-4)
const sembradas = [
  { placa: `${letras()}-${sello.slice(0, 3)}`, estado: 'EN_PROCESO', dias: 12, acta: false, espera: 'En fabricación' },
  { placa: `${letras()}-${sello.slice(1, 4)}`, estado: 'PAUSADA', dias: 20, acta: false, espera: 'Pausada' },
  { placa: `${letras()}-${sello.slice(0, 2)}9`, estado: 'TERMINADA', dias: -3, acta: true, espera: 'Entregada' },
]
const sinOt = `${letras()}-${sello.slice(2, 4)}8`
await base.query('begin')
await base.query('set local session_replication_role = replica')
for (const [i, u] of sembradas.entries()) {
  u.id = (await base.query(`insert into public.unidades (cliente_id, placa, tipo_vehiculo, marca, modelo) values ($1, $2, 'CAMION', 'VOLVO', 'FH') returning id`, [cliente.id, u.placa])).rows[0].id
  u.ot = `7${sello}${i}-2026`
  const ot = (await base.query(`insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, estado, descripcion, avance_porcentaje, motivo_pausa, fecha_entrega_comprometida)
     values ($1, $2, $3, $4, $5, 'Furgón de prueba de la ficha', 40, $6, ((now() at time zone 'America/Lima')::date + $7::int)) returning id`,
    [u.ot, cliente.id, u.id, sede.id, u.estado, u.estado === 'PAUSADA' ? 'Falta el chasis' : null, u.dias])).rows[0].id
  // Con los disparadores apagados el acta no toma su número: se le pone uno de prueba.
  if (u.acta) await base.query(`insert into public.ot_entregas (orden_id, numero, fecha_entrega, recibe_nombre) values ($1, $2, current_date, 'Chofer del cliente')`, [ot, `PRUEBA-${u.ot}`])
}
await base.query(`insert into public.unidades (cliente_id, placa, tipo_vehiculo) values ($1, $2, 'CAMION')`, [cliente.id, sinOt])
await base.query('commit')

if (!(await uno(`select 1 as hay from public.cotizaciones_pdf where cliente_id = $1 limit 1`, [cliente.id]))) {
  const ventas = await uno('select id from public.usuarios where correo = $1', [correoDe('ventas')])
  const cot = randomUUID()
  await base.query(`insert into storage.objects (bucket_id, name, owner_id, metadata) values ('cotizaciones-pdf', $1, $2, '{"mimetype": "application/pdf", "size": 1200}')`, [`cot/${cot}/v1.pdf`, ventas.id])
  await comoCuenta('ventas', `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
    values ($1, $2, $3, (select id from public.tipos_carroceria where activo order by orden_secuencia limit 1), 'c.pdf', $4, 'application/pdf', 1200, $5, 1000, 'PEN')`,
    [cot, `${sello}9-2026`, cliente.id, `cot/${cot}/v1.pdf`, ventas.id], true)
}

// Lo que dice la base con la sesión de Ventas.
const deLaBase = new Map((await comoCuenta('ventas', `select unidad_id, ot_numero, estado, to_char(fecha_entrega, 'DD/MM/YYYY') as fecha from public.unidades_del_cliente_con_su_entrega($1)`, [cliente.id]))
  .map((f) => [f.unidad_id, f]))
const cotizacionesDeLaBase = await comoCuenta('ventas', `select id, numero, estado from public.cotizaciones_pdf where cliente_id = $1 and estado <> 'ANULADA' order by creado_en desc limit 20`, [cliente.id])

// ============================================ La pantalla
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []

async function entrar(puesto, ancho = 1440) {
  const correo = correoDe(puesto)
  const telefono = ancho <= 480
  const contexto = await navegador.newContext({
    viewport: telefono ? { width: ancho, height: 844 } : { width: ancho, height: 900 },
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
const filaDeUnidad = (pagina, placa) => pagina.locator('li', { has: pagina.locator(`text=${placa}`) }).first()

for (const ancho of [1440, 390]) {
  const { pagina, contexto } = await entrar('ventas', ancho)
  await ir(pagina, `/clientes/${cliente.id}`)
  comprobar(limpio(await pagina.locator('h1').innerText()) === cliente.razon_social, `${ancho}: abre la ficha de ${cliente.razon_social}`)

  // 2. Cada unidad con OT, como la da la base.
  for (const u of sembradas) {
    const fila = filaDeUnidad(pagina, u.placa)
    const entrega = limpio(await fila.locator('[data-entrega-unidad]').innerText().catch(() => ''))
    const base = deLaBase.get(u.id)
    comprobar(Boolean(base) && entrega.startsWith(u.espera) && entrega.includes(`OT ${u.ot}`) && entrega.includes(base.fecha),
      `${ancho}: ${u.placa} dice «${entrega}» (la base: ${base?.estado} · ${base?.fecha})`)
  }
  comprobar((await filaDeUnidad(pagina, sinOt).locator('[data-entrega-unidad]').count()) === 0, `${ancho}: la unidad sin OT no dice nada`)
  const deLasUnidades = (await pagina.locator('[data-entrega-unidad]').allInnerTexts()).join(' ')
  comprobar(deLasUnidades.length > 0 && !/\d+\s?%/.test(deLasUnidades), `${ancho}: ningún porcentaje en lo que dice cada unidad`)

  // 3. Las cotizaciones del cliente.
  const lista = pagina.locator('[data-cotizaciones-del-cliente] > li')
  comprobar((await lista.count()) === cotizacionesDeLaBase.length, `${ancho}: ${await lista.count()} cotizaciones en la ficha, ${cotizacionesDeLaBase.length} en la base`)
  const conAhora = await pagina.locator('[data-cotizacion-ahora]').allInnerTexts()
  comprobar(conAhora.length > 0 && conAhora.every((t) => /^\S.* · (hace \d+ días?|desde hoy)/.test(limpio(t))), `${ancho}: quién la tiene y hace cuánto (${limpio(conAhora[0] ?? 'ninguna espera')})`)
  comprobar(!(await pagina.locator('[data-cotizaciones-del-cliente]').innerText()).includes('Anulada'), `${ancho}: sin anuladas en la lista`)

  if (ancho === 1440) {
    await pagina.locator('h1').scrollIntoViewIfNeeded()
    await pagina.screenshot({ path: `${CAPTURAS}/9-2-ventas-1440-ficha.png`, fullPage: true })
    // El enlace lleva a la tarjeta de esa cotización.
    const primera = cotizacionesDeLaBase[0]
    await lista.first().locator('a').click()
    await pagina.waitForURL((u) => u.pathname === '/cotizaciones/pdf', { timeout: 15000 }).catch(() => {})
    comprobar(pagina.url().endsWith(`#${primera.id}`), `el enlace lleva a la tarjeta de la ${primera.numero} (${pagina.url()})`)
    const aLaVista = await pagina
      .waitForFunction((id) => {
        const el = document.getElementById(id)
        const r = el?.getBoundingClientRect()
        return Boolean(el?.hasAttribute('data-del-aviso') && r && r.top >= 0 && r.top < window.innerHeight)
      }, primera.id, { timeout: 15000 })
      .then(() => true, () => false)
    comprobar(aLaVista, 'y la deja a la vista y marcada')
  } else {
    // La fecha comprometida, en un renglón: los botones de la fila bajan.
    for (const u of sembradas) {
      // La fecha y su rótulo, en un solo renglón (antes salían en cinco).
      const lineas = await filaDeUnidad(pagina, u.placa).locator('[data-entrega-unidad] > span:last-child').evaluate((el) => {
        const tops = new Set([...el.getClientRects()].map((r) => Math.round(r.top)))
        return tops.size
      })
      comprobar(lineas === 1, `390: la fecha comprometida de ${u.placa} ocupa ${lineas} renglón(es)`)
    }
    const ancho390 = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(ancho390 <= 390, `390: nada se sale (ancho ${ancho390})`)
    await pagina.screenshot({ path: `${CAPTURAS}/9-2-ventas-390-ficha.png`, fullPage: true })
  }
  await contexto.close()
}

// 4. Administración la ve igual; Almacén no entra.
{
  const { pagina, contexto } = await entrar('administracion', 1440)
  await ir(pagina, `/clientes/${cliente.id}`)
  comprobar((await pagina.locator('[data-entrega-unidad]').count()) >= sembradas.length, 'Administración ve en qué va cada unidad')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar('almacen', 1440)
  await ir(pagina, `/clientes/${cliente.id}`)
  comprobar(!pagina.url().includes(`/clientes/${cliente.id}`) || (await pagina.locator('[data-entrega-unidad]').count()) === 0,
    `Almacén no ve la ficha (${pagina.url()})`)
  await contexto.close()
}

await navegador.close()
await base.end()

for (const e of errores) console.log(`consola · ${e}`)
comprobar(errores.length === 0, `sin errores en la consola (${errores.length})`)
if (fallas.length > 0) {
  console.error(`\n${fallas.length} falla(s).`)
  process.exit(1)
}
console.log('\nTodo bien.')
