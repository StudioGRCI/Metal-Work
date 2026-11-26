/**
 * Cuentas por cobrar con la cuenta de Costos, que entra con
 * `tesoreria.ver_documentos` y responde las salidas de vehículos con
 * `tesoreria.liberar`, pero no lee las cotizaciones aprobadas
 * (`cotizaciones_para_facturar` le responde «sin permiso»). Antes se le caía
 * la pantalla entera; ahora:
 *
 *   1. Costos abre Cuentas por cobrar y ve las salidas por revisar, sin
 *      «Cotizaciones aprobadas» y sin decirle que un código «no tiene
 *      cotización aprobada» (no lo sabe: no la lee).
 *   2. En cada salida ve lo que falta cobrar de las facturas del código, que sí
 *      lee, o que no tienen saldo; lo que falta facturar lo ve Tesorería.
 *   3. Responde «Revisada: puede salir» y la base lo guarda a su nombre.
 *   4. Tesorería sigue viendo lo cobrado de cada código junto a cada salida.
 *
 * Siembra sus dos salidas: una con el código de una factura con saldo y otra con
 * un código sin facturas. La cuenta de Costos la da de alta el script,
 * `costos.cobrar@banco.test`, con la clave del banco.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { esperarReactAlNavegar } from './con-react.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const COSTOS = process.env.COSTOS ?? 'costos.cobrar@banco.test'
const TESORERIA = process.env.TESORERIA ?? 'tesoreria.local@metalwork.test'
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
const uno = async (sql, valores = []) => (await base.query(sql, valores)).rows[0]

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => t.replace(/\s+/g, ' ').trim()

// La cuenta de Costos, si no está.
if (!process.env.COSTOS) {
  let fila = await uno('select id from public.usuarios where correo = $1', [COSTOS])
  if (!fila) {
    fila = await uno(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [COSTOS])
    await base.query(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id)
       select $1, 'COSTOS', 'Banco por cobrar', $2, r.id from public.roles r where r.codigo = 'COSTOS'`,
      [fila.id, COSTOS],
    )
  }
  await base.query(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where email = $1`, [COSTOS, CLAVE])
}
const { id: idCostos } = await uno('select id from public.usuarios where correo = $1', [COSTOS])

// Dos salidas por revisar: una con el código de una factura con saldo, otra con un código sin facturas.
const conSaldo = await uno(
  `select codigo_interno, count(*)::int as facturas from public.v_facturas_venta
    where anulada_en is null and not cancelada and saldo > 0 and codigo_interno is not null
    group by codigo_interno order by 1 limit 1`,
)
if (!conSaldo) throw new Error('El banco no tiene facturas de venta con saldo y código interno: corre antes probar-facturacion.mjs.')
const sello = String(Date.now()).slice(-6)
const sinFacturas = `QA_COSTOS_${sello}`
const { id: quienPide } = await uno(
  `select u.id from public.usuarios u join public.roles r on r.id = u.rol_id where r.codigo = 'REQUERIMIENTOS' and u.activo limit 1`,
)
const salidas = {}
await base.query('begin')
await base.query('set local session_replication_role = replica')
for (const [clave, codigo] of [['conSaldo', conSaldo.codigo_interno], ['sinFacturas', sinFacturas]]) {
  const { id } = await uno(
    `insert into public.registro_vehiculos (id, placa, unidad, empresa, motivo, codigo_interno, ingreso_en, ingreso_por)
     values (gen_random_uuid(), $1, 'CARROCERÍA DE PRUEBA', 'COSTOS BANCO S.A.C.', 'FABRICACION', $2, now() - interval '2 days', $3)
     returning id`,
    [`QC${clave === 'conSaldo' ? 'S' : 'N'}-${sello.slice(2)}`, codigo, quienPide],
  )
  const r = await uno(
    `insert into public.registro_vehiculo_revisiones (registro_id, concepto, solicitado_por)
     values ($1, 'Salida de la carrocería terminada', $2) returning id`,
    [id, quienPide],
  )
  salidas[clave] = r.id
}
await base.query('commit')
console.log(`     sembrado: salida de ${conSaldo.codigo_interno} (${conSaldo.facturas} factura(s) con saldo) y de ${sinFacturas} (sin facturas)`)
const pendientes = async () =>
  (await uno(`select count(*)::int as n from public.registro_vehiculo_revisiones where estado = 'PENDIENTE'`)).n

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const errores = []
async function entrar(correo, viewport) {
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, deviceScaleFactor: 2, timezoneId: 'America/Lima' })
  const pagina = esperarReactAlNavegar(await contexto.newPage())
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(`${correo}: ${m.text().slice(0, 300)}`)
  })
  pagina.on('response', (r) => r.status() >= 500 && errores.push(`${correo}: ${r.status()} ${r.url().slice(0, 120)}`))
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'load' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}), pagina.click('button[type="submit"]')])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto }
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const w = viewport.width
  {
    const n = await pendientes()
    const { pagina, contexto } = await entrar(COSTOS, viewport)
    const r = await pagina.goto(`${BASE}/tesoreria/por-cobrar`, { waitUntil: 'networkidle' })
    const texto = limpio(await pagina.locator('main').innerText().catch(() => ''))
    comprobar(r?.status() === 200 && /Cuentas por cobrar/.test(texto) && !/No se pudieron leer|Algo salió mal/.test(texto),
      `Costos ${w}: abre Cuentas por cobrar (${r?.status()})`)
    comprobar((await pagina.locator('[data-revision]').count()) === n, `Costos ${w}: ve las ${n} salidas por revisar`)
    comprobar((await pagina.locator('[data-cobro-del-codigo]').count()) === 0, `Costos ${w}: no se le dice nada de la cotización, que no lee`)
    comprobar(!/Cotizaciones aprobadas/.test(texto), `Costos ${w}: sin «Cotizaciones aprobadas»`)
    const lineaDe = async (clave) =>
      limpio(await pagina.locator(`[data-revision="${salidas[clave]}"] [data-por-cobrar-de-facturas]`).innerText().catch(() => ''))
    const deSaldo = await lineaDe('conSaldo')
    comprobar(/^Por cobrar de (su factura|sus \d+ facturas): (S\/|US\$) [\d,.]+.*Lo que falta facturar de la cotización lo ve Tesorería\.$/.test(deSaldo),
      `Costos ${w}: en la salida de ${conSaldo.codigo_interno} ve lo que falta cobrar de sus facturas («${deSaldo}»)`)
    if (w === 1440) {
      const deNada = await lineaDe('sinFacturas')
      comprobar(deNada === 'Las facturas registradas del código no tienen saldo por cobrar. Lo que falta facturar de la cotización lo ve Tesorería.',
        `Costos ${w}: en la del código sin facturas, que no tienen saldo («${deNada}»)`)
    }
    const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(ancho <= w, `Costos ${w}: no se corre de costado (${ancho} px)`)
    await pagina.locator(`[data-revision="${salidas.conSaldo}"]`).scrollIntoViewIfNeeded().catch(() => {})
    await pagina.screenshot({ path: join(CAPTURAS, `por-cobrar-costos-${w}.png`) })

    // Costos responde la salida del código sin facturas, y la base la guarda a su nombre.
    if (w === 1440) {
      const tarjeta = pagina.locator(`[data-revision="${salidas.sinFacturas}"]`)
      await tarjeta.locator('select[name="estado"]').selectOption('ATENDIDA')
      await tarjeta.locator('textarea[name="respuesta"]').fill('Revisado por Costos: puede salir (prueba del banco).')
      await tarjeta.getByRole('button', { name: 'Responder' }).click()
      await pagina.getByText('Salida revisada').first().waitFor({ timeout: 20000 }).catch(() => {})
      const fila = await uno('select estado, atendido_por from public.registro_vehiculo_revisiones where id = $1', [salidas.sinFacturas])
      comprobar(fila.estado === 'ATENDIDA' && fila.atendido_por === idCostos,
        `Costos ${w}: «Revisada: puede salir» queda en la base a su nombre (${fila.estado})`)
    }
    await contexto.close()
  }
  {
    const n = await pendientes()
    const { pagina, contexto } = await entrar(TESORERIA, viewport)
    await pagina.goto(`${BASE}/tesoreria/por-cobrar`, { waitUntil: 'networkidle' })
    const conCodigo = await pagina.locator('[data-revision]').count()
    comprobar(conCodigo === n && (await pagina.locator('[data-cobro-del-codigo]').count()) > 0,
      `Tesorería ${w}: ve las ${n} salidas y lo cobrado de cada código`)
    comprobar((await pagina.locator('[data-por-cobrar-de-facturas]').count()) === 0, `Tesorería ${w}: sin la línea de Costos`)
    comprobar((await pagina.getByText('Cotizaciones aprobadas').count()) > 0, `Tesorería ${w}: sigue viendo «Cotizaciones aprobadas»`)
    await contexto.close()
  }
}
await navegador.close()
await base.end()
if (errores.length) {
  console.log(`Errores:\n${errores.join('\n')}`)
  fallas.push('errores de consola o 5xx')
}
console.log(fallas.length ? `\n${fallas.length} FALLAS` : '\nTodo bien')
process.exit(fallas.length ? 1 : 0)
