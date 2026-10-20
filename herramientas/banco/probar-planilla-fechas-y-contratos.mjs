/**
 * Clic real sobre lo que DKS pidió el 2026-10-20 (migraciones 20261020190000,
 * 191000 y 192000), con la cuenta de cada puesto (nunca ADMIN). El contrato de
 * la orden de servicio va con los documentos de la OS, en el PR de Adquisiciones.
 *
 *   1. El sueldo de la oficina va por la planilla: un ayudante de Maestranza en
 *      la planilla de taller no sale en «Registrar pago» de RR. HH.; RR. HH. lo
 *      pasa a la administrativa, sale, y le registra su quincena.
 *   2. Administración registra un subcontrato para Maestranza con su contrato
 *      adjunto en el mismo formulario; el detalle lo muestra. Después adjunta
 *      otra versión encima y la primera queda debajo.
 *   3. El supervisor de Maestranza ve las fechas del contrato y marca cuándo
 *      empezó y terminó de verdad; no ve el contrato. En el teléfono no se sale
 *      de ancho.
 *   4. Administración ve las fechas reales y quién las marcó; Tesorería ve el
 *      contrato sin poder adjuntar.
 *
 * Cada subida se comprueba en la base (`storage.objects` y la tabla del
 * contrato) después del clic: el banco no aplica las políticas de Storage, que
 * prueba el check 412. Necesita las cuentas `*.local@metalwork.test`. Lo que
 * crea lleva un sello distinto en cada corrida; al terminar deja el pago
 * anulado y a la persona de baja.
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
  rrhh: 'rrhh.local@metalwork.test',
  administracion: 'administracion.local@metalwork.test',
  tesoreria: 'tesoreria.local@metalwork.test',
  supervisorMtz: 'sup.mtz.local@metalwork.test',
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

/** Una función de la base con el rol real del puesto, como la llama la aplicación. */
async function comoPuesto(correo, sql, valores = []) {
  await base.query('begin')
  try {
    const [{ id }] = await consulta('select id from usuarios where correo = $1', [correo])
    await base.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [
      JSON.stringify({ sub: id, role: 'authenticated' }),
      id,
    ])
    await base.query('set local role authenticated')
    const filas = (await base.query(sql, valores)).rows
    await base.query('commit')
    return filas
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, timezoneId: 'America/Lima' })
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

/** Un RUC de persona natural inventado, con su dígito de control. */
function rucDePrueba(cuerpo) {
  const base10 = `10${cuerpo}`.slice(0, 10)
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((t, p, i) => t + Number(base10[i]) * p, 0)
  let d = 11 - (suma % 11)
  if (d === 10) d = 0
  if (d === 11) d = 1
  return `${base10}${d}`
}

const [{ hoy, mes }] = await consulta(`select (now() at time zone 'America/Lima')::date::text as hoy,
                                              to_char(now() at time zone 'America/Lima', 'YYYY-MM') as mes`)
const dd = (fecha) => fecha.split('-').reverse().join('/')
const sumarDias = (fecha, n) => new Date(Date.parse(`${fecha}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const sello = Date.now().toString().slice(-6)
const AYUDANTE = `Ayudante ${sello}`
const codigo = `PRB_SR_${sello}_26/42`
const ruc = rucDePrueba(sello.padStart(8, '8'))

// ------------------------------------------------- los archivos de prueba
const archivos = join(CAPTURAS, 'archivos-contratos')
mkdirSync(archivos, { recursive: true })
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
)
const contratoSc = join(archivos, `Contrato SC ${sello}.pdf`)
const adendaSc = join(archivos, `Adenda SC ${sello}.pdf`)
for (const f of [contratoSc, adendaSc]) writeFileSync(f, PDF)

let subcontratoId = null
let numeroSc = ''

try {
  // ------------------------------------------------------------- 1. La planilla manda
  await consulta(
    `insert into trabajadores (nombres, apellidos, dni, cargo, area_id, fecha_ingreso, creado_por)
     values ($1, 'Banco', '5' || right($2, 7), 'Ayudante', (select id from areas where codigo = 'MTZ'), $3::date,
             (select id from usuarios where correo = $4))`,
    [AYUDANTE, `00${sello}`, `${mes}-01`, CUENTAS.rrhh],
  )
  const [ayudante] = await consulta(`select id, planilla from trabajadores where nombres = $1`, [AYUDANTE])
  comprobar(ayudante?.planilla === 'TALLER', `el ayudante de Maestranza entra en la planilla de taller (${ayudante?.planilla})`)
  {
    const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh)
    // Sin nadie de planilla administrativa el botón sale apagado: tampoco lo ofrece.
    const opciones = async () => {
      await pagina.goto(`${BASE}/rrhh/pagos-oficina`, { waitUntil: 'networkidle' })
      const boton = pagina.getByRole('button', { name: 'Registrar pago' })
      const v = pagina.locator('[role="dialog"]')
      if (await boton.isDisabled()) return { v, lista: [] }
      await boton.click()
      const lista = await v.locator('select[name="trabajador_id"] option').allTextContents()
      return { v, lista }
    }
    let { lista } = await opciones()
    comprobar(!lista.some((o) => o.includes(AYUDANTE)), 'en la planilla de taller, RR. HH. no lo tiene para registrarle un pago de la oficina')

    await comoPuesto(CUENTAS.rrhh, `select public.rrhh_guardar_planilla_trabajador($1, 'ADMINISTRATIVA')`, [ayudante.id])
    const r = await opciones()
    lista = r.lista
    comprobar(lista.some((o) => o.includes(AYUDANTE)), 'pasado a la planilla administrativa, sale aunque sea de Maestranza')
    await r.v.locator('select[name="trabajador_id"]').selectOption(ayudante.id)
    await r.v.getByLabel('Cada cuánto se le paga').selectOption('QUINCENA')
    await r.v.locator('input[name="desde"]').fill(`${mes}-01`)
    await r.v.locator('input[name="monto"]').fill('1200')
    await r.v.locator('input[name="aportes"]').fill('0')
    await r.v.getByRole('button', { name: 'Registrar' }).click()
    const error = await esperarVentana(pagina)
    comprobar(!error, `RR. HH. le registra la quincena${error ? `: ${error}` : ''}`)
    const [pago] = await consulta(`select monto::numeric as monto, desde::text from oficina_pagos where trabajador_id = $1 and anulado_en is null`, [ayudante.id])
    comprobar(Number(pago?.monto) === 1200 && pago?.desde === `${mes}-01`, `en la base: S/ 1,200 desde el ${dd(`${mes}-01`)} (${pago?.monto}, ${pago?.desde})`)
    const [oficina] = await consulta(`select personas from sueldos_oficina_del_mes($1::date)`, [`${mes}-01`])
    comprobar(Number(oficina?.personas) >= 1, `el sueldo de la oficina del mes lo cuenta (${oficina?.personas} personas con pago)`)
    comprobar(errores.length === 0, `RR. HH., sin errores de consola (${errores.join(' | ')})`)
    await contexto.close()
  }

  // ----------------------------------- 2. Administración: subcontrato con su contrato
  await consulta(`insert into subcontratistas (ruc, nombre, banco, numero_cuenta) values ($1, $2, 'BCP', $3)`, [
    ruc,
    `Subcontratista de prueba ${sello}`,
    `19100${sello}`,
  ])
  {
    const { pagina, contexto, errores } = await entrar(CUENTAS.administracion)
    await pagina.goto(`${BASE}/subcontratos`, { waitUntil: 'networkidle' })
    await pagina.locator('[data-nuevo-subcontrato]').click()
    const v = pagina.locator('[role="dialog"]')
    await pagina.getByRole('combobox', { name: 'Subcontratista' }).click()
    await pagina.keyboard.type(sello)
    await pagina.getByRole('option', { name: new RegExp(sello) }).first().click()
    await v.locator('textarea[name="descripcion"]').fill('Soldadura del piso del cajón de prueba, con el material de la casa.')
    await v.locator('select[name="area"]').selectOption('MTZ')
    await v.locator('input[name="codigo_interno"]').fill(codigo)
    await v.locator('input[name="monto"]').fill('2800')
    await v.locator('input[name="fecha_inicio"]').fill(sumarDias(hoy, -10))
    await v.locator('input[name="fecha_fin"]').fill(sumarDias(hoy, 10))
    comprobar((await v.locator('input[name="contrato"]').count()) === 1, 'el formulario del subcontrato ofrece adjuntar el contrato')
    await v.locator('input[name="contrato"]').setInputFiles(contratoSc)
    await pagina.screenshot({ path: join(CAPTURAS, 'contratos-01-nuevo-subcontrato.png') })
    await v.getByRole('button', { name: 'Registrar subcontrato' }).click()
    await pagina.waitForURL(/\/subcontratos\/[0-9a-f-]{36}/, { timeout: 30000 }).catch(() => {})
    await pagina.waitForLoadState('networkidle')
    subcontratoId = pagina.url().match(/subcontratos\/([0-9a-f-]{36})/)?.[1] ?? null
    numeroSc = limpio(await pagina.locator('h1').textContent().catch(() => ''))
    comprobar(Boolean(subcontratoId) && !pagina.url().includes('contrato=pendiente'), `registra el subcontrato y lo abre sin aviso de contrato pendiente (${numeroSc})`)
    let contratos = await consulta(
      `select c.archivo_nombre, c.archivo_ruta, exists (select 1 from storage.objects o where o.bucket_id = 'subcontratos' and o.name = c.archivo_ruta) as en_storage
         from subcontrato_contratos c where c.subcontrato_id = $1 order by c.creado_en`,
      [subcontratoId],
    )
    comprobar(
      contratos.length === 1 && contratos[0].en_storage && contratos[0].archivo_nombre === `Contrato SC ${sello}.pdf`,
      `en la base: un contrato, con su archivo en Storage y su nombre (${contratos.map((c) => c.archivo_nombre).join(', ')})`,
    )
    let tarjeta = limpio(await pagina.locator('[data-contrato]').innerText().catch(() => ''))
    comprobar(tarjeta.includes(`Contrato SC ${sello}.pdf`), `el detalle muestra el contrato: «${tarjeta.slice(0, 120)}»`)

    // Llega la adenda: va encima.
    await pagina.locator('[data-adjuntar-contrato]').click()
    await v.locator('input[name="contrato"]').setInputFiles(adendaSc)
    await v.getByRole('button', { name: 'Adjuntar' }).click()
    const error = await esperarVentana(pagina)
    comprobar(!error, `adjunta otra versión del contrato${error ? `: ${error}` : ''}`)
    await pagina.locator('[data-contrato]', { hasText: 'Adenda' }).waitFor({ timeout: 15000 }).catch(() => {})
    contratos = await consulta(`select archivo_nombre from subcontrato_contratos where subcontrato_id = $1 order by creado_en desc`, [subcontratoId])
    tarjeta = limpio(await pagina.locator('[data-contrato]').innerText().catch(() => ''))
    comprobar(
      contratos.length === 2 && tarjeta.startsWith(`Adenda SC ${sello}.pdf`) && tarjeta.includes('Una versión anterior'),
      `la adenda pasa a ser la vigente y la primera queda debajo: «${tarjeta.slice(0, 140)}»`,
    )
    comprobar(limpio(await pagina.locator('[data-fechas-reales]').innerText()).includes('todavía no las marca'), 'sin marcar, dice que el supervisor todavía no marca las fechas reales')
    await pagina.screenshot({ path: join(CAPTURAS, 'contratos-02-detalle-subcontrato.png'), fullPage: true })
    comprobar(errores.length === 0, `Administración, sin errores de consola (${errores.join(' | ')})`)
    await contexto.close()
  }

  // ------------------------------------------------ 3. El supervisor marca las fechas reales
  {
    const { pagina, contexto, errores } = await entrar(CUENTAS.supervisorMtz)
    await pagina.goto(`${BASE}/subcontratos/area`, { waitUntil: 'networkidle' })
    const item = pagina.locator(`[data-subcontrato="${numeroSc}"]`)
    let texto = limpio(await item.innerText().catch(() => ''))
    comprobar(
      texto.includes('Inicio según contrato') && texto.includes(dd(sumarDias(hoy, -10))) && texto.includes('Real: sin marcar'),
      `ve las fechas del contrato y que las reales están sin marcar: «${texto.slice(0, 200)}»`,
    )
    comprobar(!texto.includes('2,800') && !texto.includes('Contrato SC') && (await item.locator('a', { hasText: 'Contrato' }).count()) === 0, 'no ve el monto ni el contrato')
    await item.locator('[data-marcar-fechas-reales]').click()
    const v = pagina.locator('[role="dialog"]')
    comprobar(await v.locator('input[name="fin_real"]').isDisabled(), 'sin el inicio, el fin no se puede marcar')
    await v.locator('input[name="inicio_real"]').fill(sumarDias(hoy, -8))
    await v.locator('input[name="fin_real"]').fill(hoy)
    await v.getByRole('button', { name: 'Guardar' }).click()
    const error = await esperarVentana(pagina)
    comprobar(!error, `marca que empezó hace 8 días y terminó hoy${error ? `: ${error}` : ''}`)
    const [sc] = await consulta(
      `select s.inicio_real::text, s.fin_real::text, s.fecha_inicio::text, s.estado, u.correo
         from subcontratos s left join usuarios u on u.id = s.fechas_reales_por where s.id = $1`,
      [subcontratoId],
    )
    comprobar(
      sc?.inicio_real === sumarDias(hoy, -8) && sc?.fin_real === hoy && sc?.fecha_inicio === sumarDias(hoy, -10) && sc?.estado === 'VIGENTE' && sc?.correo === CUENTAS.supervisorMtz,
      `en la base: las reales con quién las marcó, la del contrato igual y sigue vigente (${JSON.stringify(sc)})`,
    )
    await item.getByText(`Real: ${dd(sumarDias(hoy, -8))}`).waitFor({ timeout: 10000 }).catch(() => {})
    texto = limpio(await item.innerText().catch(() => ''))
    comprobar(texto.includes(`Real: ${dd(sumarDias(hoy, -8))}`) && texto.includes(`Real: ${dd(hoy)}`), `la pantalla las muestra: «${texto.slice(0, 220)}»`)
    comprobar((await item.getByRole('button', { name: /Corregir fechas reales/ }).count()) === 1, 'el botón pasa a «Corregir fechas reales»')
    await pagina.screenshot({ path: join(CAPTURAS, 'contratos-03-supervisor.png'), fullPage: true })
    comprobar(errores.length === 0, `Supervisión de Maestranza, sin errores de consola (${errores.join(' | ')})`)
    await contexto.close()

    // En el teléfono.
    const tel = await entrar(CUENTAS.supervisorMtz, { width: 390, height: 844 })
    await tel.pagina.goto(`${BASE}/subcontratos/area`, { waitUntil: 'networkidle' })
    const ancho = await tel.pagina.evaluate(() => document.documentElement.scrollWidth)
    comprobar(ancho <= 390, `en el teléfono la pantalla no se sale de ancho (${ancho} px)`)
    await tel.pagina.locator(`[data-subcontrato="${numeroSc}"]`).screenshot({ path: join(CAPTURAS, 'contratos-03-supervisor-390.png') })
    await tel.contexto.close()
  }

  // ------------------------------------- 4. Administración y Tesorería ven lo suyo
  {
    const { pagina, contexto } = await entrar(CUENTAS.administracion)
    await pagina.goto(`${BASE}/subcontratos/${subcontratoId}`, { waitUntil: 'networkidle' })
    const reales = limpio(await pagina.locator('[data-fechas-reales]').innerText())
    comprobar(reales.includes(`Empezó el ${dd(sumarDias(hoy, -8))}`) && reales.includes(`terminó el ${dd(hoy)}`) && reales.includes('Las marcó'), `Administración ve las fechas reales y quién las marcó: «${reales}»`)
    await contexto.close()
  }
  {
    const { pagina, contexto, errores } = await entrar(CUENTAS.tesoreria)
    await pagina.goto(`${BASE}/subcontratos/${subcontratoId}`, { waitUntil: 'networkidle' })
    const tarjeta = limpio(await pagina.locator('[data-contrato]').innerText().catch(() => ''))
    comprobar(tarjeta.includes(`Adenda SC ${sello}.pdf`), `Tesorería ve el contrato vigente: «${tarjeta.slice(0, 80)}»`)
    comprobar((await pagina.locator('[data-adjuntar-contrato]').count()) === 0, 'Tesorería no tiene «Adjuntar contrato»')
    const href = await pagina.locator('[data-contrato] a').first().getAttribute('href').catch(() => null)
    const respuesta = href ? await pagina.request.get(href) : null
    comprobar(respuesta?.ok() === true, `el enlace del contrato abre el archivo (${respuesta?.status()})`)
    comprobar(errores.length === 0, `Tesorería, sin errores de consola (${errores.join(' | ')})`)
    await contexto.close()
  }
} catch (e) {
  fallas.push(String(e))
  console.log('FALLA', e)
} finally {
  for (const p of await consulta(`select p.id from oficina_pagos p join trabajadores w on w.id = p.trabajador_id
                                   where w.nombres = $1 and p.anulado_en is null`, [AYUDANTE])) {
    await comoPuesto(CUENTAS.rrhh, `select public.rrhh_anular_pago_oficina($1, 'Prueba del banco: se deja anulado al terminar')`, [p.id]).catch(() => {})
  }
  await consulta(`update trabajadores set activo = false, fecha_baja = greatest(fecha_ingreso, (now() at time zone 'America/Lima')::date)
                   where nombres = $1 and activo`, [AYUDANTE]).catch((e) => fallas.push(`no se pudo dar de baja al ayudante: ${e}`))
  await navegador.close()
  await base.end()
}

console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
