/**
 * Mantenimiento de unidades (plan «Las demás áreas», entrega A.3, migración
 * 20261126996000), con clic real y la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Mantenimiento, en el monitor: su menú lleva «OT de mantenimiento»,
 *      «Reporte diario» y «Requerimientos» arriba de Averías y Equipos. La
 *      lista trae las OT de mantenimiento aprobadas (no el borrador ni la de
 *      garantía), con el cliente, lo que hay que hacer, la fecha comprometida y
 *      si el vehículo ya entró, sin montos. La que Administración dio por
 *      terminada va en «Terminadas», sin botones.
 *   2. Desde la tarjeta de la OT, «Nuevo RQ» abre el requerimiento con su área
 *      y el N.º de la OT ya puestos: entra uno solo aunque se toque dos veces y
 *      la tarjeta lo muestra. En Requerimientos ve «Por OT» y «De tu área», sin
 *      «Todas las áreas», y «RQ por unidad» lo devuelve a su lista de OT.
 *   3. Con el vehículo en la planta, el Dashboard le pide el reporte de hoy.
 *      «Reportar el día» abre el reporte con el código de la OT: pone a su
 *      gente de Mantenimiento con sus horas y lo sube. La tarjeta dice el
 *      último reporte y el pendiente se va.
 *   4. En el teléfono: sus pestañas son OT, Reporte, Averías y Equipos, y la
 *      lista no se desborda.
 *   5. Tesorería no tiene el enlace ni entra. El supervisor de Producción, que
 *      comparte los otros dos permisos, tampoco.
 *
 * Arma, como dueño de la base del banco, cinco OT (9495 a 9499 del año), el
 * ingreso del vehículo de una y una persona de planilla de taller en
 * Mantenimiento. Lo que la base rechaza (otra área, gente de oficina, dar la OT
 * por terminada) lo prueba el check 497.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE, CAPTURAS.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const cuenta = (puesto) => `${puesto}.local@metalwork.test`
const CUENTAS = {
  mantenimiento: cuenta('mantenimiento'),
  requerimientos: cuenta('requerimientos'),
  administracion: cuenta('administracion'),
  tesoreria: cuenta('tesoreria'),
  produccion: cuenta('sup.prd'),
}
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
const carpeta = join(CAPTURAS, 'mantenimiento-unidades')
mkdirSync(carpeta, { recursive: true })

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
// Next deja a veces un prefetch sin cerrar y «networkidle» no llega nunca: se espera un poco y se sigue.
const quieta = (pagina) => pagina.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
async function ir(pagina, url) {
  await pagina.goto(url, { waitUntil: 'load' })
  await quieta(pagina)
}

// ------------------------------------------------------------ armazón
const usuarios = Object.fromEntries((await consulta(`select correo, id from public.usuarios where correo = any($1)`, [Object.values(CUENTAS)])).map((f) => [f.correo, f.id]))
for (const [p, c] of Object.entries(CUENTAS)) if (!usuarios[c]) throw new Error(`Falta la cuenta de ${p} (${c}) en la base del banco: rehazla con preparar.sh.`)

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
const anio = hoy.slice(0, 4)
const N = (n) => `${n}-${anio}`
const OT = { garantia: N(9495), borrador: N(9496), enPlanta: N(9497), espera: N(9498), terminada: N(9499) }
const CODIGO = `OT ${OT.enPlanta}`
const PLACA = 'BMT-497'
const [cliente] = await consulta(
  `select c.id, c.razon_social, (select o.sede_id from public.ordenes_trabajo o limit 1) as sede_id
     from public.clientes c order by c.creado_en limit 1`,
)
if (!cliente?.sede_id) throw new Error('El banco no tiene clientes ni órdenes: rehaz la base con preparar.sh.')
// La de garantía va con la unidad que vuelve (la base lo exige): una cualquiera del banco.
const sembrar = (numero, tipo, estado, descripcion, dias) =>
  consulta(
    `insert into public.ordenes_trabajo (numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado, fecha_entrega_comprometida, unidad_id)
     select $1, $2, $3, $4::public.tipo_trabajo_ot, 'NORMAL', $5, $6::public.estado_ot, $7::date + $8::int,
            case when $4::text = 'GARANTIA' then (select u.id from public.unidades u order by u.creado_en limit 1) end
      where not exists (select 1 from public.ordenes_trabajo where numero = $1)`,
    [numero, cliente.id, cliente.sede_id, tipo, descripcion, estado, hoy, dias],
  )
await sembrar(OT.enPlanta, 'MANTENIMIENTO', 'APROBADA', 'Cambio de bocinas del eje posterior y engrase general.\nRevisar la fuga de aire de la suspensión.', 6)
await sembrar(OT.espera, 'MANTENIMIENTO', 'APROBADA', 'Cambio de zapatas de freno y regulación.', -2)
await sembrar(OT.terminada, 'MANTENIMIENTO', 'APROBADA', 'Reparación del sistema de luces de la carrocería.', -8)
await sembrar(OT.borrador, 'MANTENIMIENTO', 'BORRADOR', 'Mantenimiento que Gerencia todavía no aprueba.', 12)
await sembrar(OT.garantia, 'GARANTIA', 'APROBADA', 'Garantía del banco: no es del puesto de Mantenimiento.', 9)
const ordenes = Object.fromEntries((await consulta(`select numero, id from public.ordenes_trabajo where numero = any($1)`, [Object.values(OT)])).map((f) => [f.numero, f.id]))
// El vehículo de la primera está en la planta (lo registra Requerimientos); la última ya se dio por terminada.
await consulta(
  `insert into public.registro_vehiculos (unidad, empresa, motivo, ingreso_en, ingreso_por, placa, orden_id)
   select 'Camión Volvo FH 440', $1, 'MANTENIMIENTO', now() - interval '1 day', $2, $3, $4
    where not exists (select 1 from public.registro_vehiculos where orden_id = $4 and anulado_en is null)`,
  [cliente.razon_social, usuarios[CUENTAS.requerimientos], PLACA.replace('-', ''), ordenes[OT.enPlanta]],
)
await consulta(
  `insert into public.ot_garantia_terminada (orden_id, terminada_por, nota)
   select $1, $2, 'Luces reparadas y probadas' where not exists (select 1 from public.ot_garantia_terminada where orden_id = $1)`,
  [ordenes[OT.terminada], usuarios[CUENTAS.administracion]],
)
// Los reportes que dejó una vuelta anterior se anulan (es la base local del
// banco): con uno de hoy, el Dashboard ya no pediría el reporte del día.
await consulta(
  `update public.reportes_diarios set anulado_en = now(), anulado_por = $2, motivo_anulacion = 'Vuelta anterior del banco de pruebas'
    where registrado_por = $1 and anulado_en is null`,
  [usuarios[CUENTAS.mantenimiento], usuarios[CUENTAS.administracion]],
)
// Su gente: una persona de planilla de taller en Mantenimiento, nueva en cada
// corrida para no chocar con el tope de horas del día.
const sello = Date.now().toString().slice(-6)
const persona = `Mecánico ${sello}`
await consulta(
  `insert into public.trabajadores (nombres, apellidos, dni, cargo, area_id, planilla, creado_por)
   values ($1, 'Prueba Mantenimiento', '71' || $2, 'Mecánico', (select id from public.areas where codigo = 'MNT'), 'TALLER', $3)`,
  [persona, sello, usuarios[CUENTAS.administracion]],
)
const [material] = await consulta(`select descripcion from public.materiales where activo and not unidad_pendiente order by descripcion limit 1`)
// Un RQ de otra área, registrado por Requerimientos: Mantenimiento no lo ve en su lista.
if ((await consulta(`select 1 from public.requerimientos r join public.areas a on a.id = r.area_id where a.codigo = 'PRD' and r.estado <> 'ANULADO' limit 1`)).length === 0) {
  await consulta(
    `select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, false)`,
    [usuarios[CUENTAS.requerimientos]],
  )
  await consulta(
    `select public.emitir_requerimiento(gen_random_uuid(), 'OPERACION', (select id from public.areas where codigo = 'PRD'), 'PLANTA',
            'Insumo para la planta, de Producción (banco A.3)', null,
            jsonb_build_array(jsonb_build_object('material_id', (select id from public.materiales where descripcion = $1 order by id limit 1), 'cantidad', 1)))`,
    [material.descripcion],
  )
  await consulta(`select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claims', '', false)`)
}
const [{ inicio }] = await consulta(`select now() as inicio`)

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const CELULAR = { width: 390, height: 844 }
const MONITOR = { width: 1440, height: 900 }

async function entrar(correo, viewport = MONITOR) {
  const movil = viewport.width < 500
  const contexto = await navegador.newContext({ viewport, isMobile: movil, hasTouch: movil, timezoneId: 'America/Lima', deviceScaleFactor: 2 })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  pagina.on('pageerror', (e) => errores.push(String(e).slice(0, 300)))
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  await quieta(pagina)
  return { pagina, contexto, errores }
}
const tarjeta = (pagina, numero) => pagina.locator(`[data-ot-de-mantenimiento="${numero}"]`)
const sinDesborde = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)
const PENDIENTE_DE_HOY = 'Tu reporte diario de hoy todavía no está subido'

/** Elige una opción en el `SeleccionBuscable` cuyo nombre accesible se da. */
async function elegir(pagina, etiqueta, texto) {
  await pagina.getByRole('combobox', { name: etiqueta }).click()
  const caja = pagina.locator('input[type="search"]:focus')
  await caja.waitFor({ timeout: 10000 })
  await caja.fill(texto)
  await pagina.getByRole('option', { name: new RegExp(texto) }).first().click()
}

// ---------------------------------------- 1. Mantenimiento: su menú y su lista de OT
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.mantenimiento)
  const menu = limpio(await pagina.locator('nav').first().innerText())
  const orden = ['OT de mantenimiento', 'Reporte diario', 'Requerimientos', 'Averías', 'Equipos'].map((t) => menu.indexOf(t))
  comprobar(orden.every((i) => i >= 0) && orden.every((i, k) => k === 0 || i > orden[k - 1]),
    `el menú lleva las unidades de los clientes arriba de Averías y Equipos (${orden.join(', ')})`)
  comprobar(!menu.includes('RQ por unidad') && !menu.includes('Órdenes de trabajo'), 'sin «RQ por unidad» ni «Órdenes de trabajo» en su menú')

  // Con el vehículo en la planta y sin reporte de hoy, el Dashboard se lo pide y lo lleva a su lista.
  const teToca = pagina.locator('[data-te-toca]')
  const pide = teToca.getByRole('link', { name: new RegExp(PENDIENTE_DE_HOY) })
  comprobar((await pide.count()) === 1 && (await pide.getAttribute('href')) === '/mantenimiento',
    `el Dashboard le pide el reporte de hoy y lleva a su lista de OT (${await pide.count()})`)

  await pagina.locator('nav').first().getByRole('link', { name: /OT de mantenimiento/ }).click()
  await pagina.waitForURL('**/mantenimiento')
  await pagina.locator('[data-ot-de-mantenimiento]').first().waitFor({ timeout: 20000 }).catch(() => {})
  comprobar((await pagina.locator('h1', { hasText: 'OT de mantenimiento' }).count()) === 1, 'abre «OT de mantenimiento»')
  const numeros = await pagina.locator('[data-ot-de-mantenimiento]').evaluateAll((t) => t.map((x) => x.getAttribute('data-ot-de-mantenimiento')))
  comprobar(numeros.includes(OT.enPlanta) && numeros.includes(OT.espera), `salen las aprobadas (${numeros.join(', ')})`)
  comprobar(!numeros.includes(OT.borrador) && !numeros.includes(OT.garantia) && !numeros.includes(OT.terminada),
    'no sale el borrador, ni la de garantía, ni la terminada')
  comprobar(numeros.indexOf(OT.espera) < numeros.indexOf(OT.enPlanta), 'la de fecha más cercana va primero')

  const t1 = tarjeta(pagina, OT.enPlanta)
  const texto1 = limpio(await t1.innerText())
  comprobar(texto1.includes(CODIGO) && texto1.toUpperCase().includes(cliente.razon_social.toUpperCase()),
    `la tarjeta lleva el código «${CODIGO}» y el cliente`)
  comprobar(texto1.includes('En la planta') && limpio(await t1.locator('[data-vehiculo]').innerText()).startsWith('En la planta desde el'),
    `dice que el vehículo está en la planta («${limpio(await t1.locator('[data-vehiculo]').innerText())}»)`)
  comprobar(texto1.includes(PLACA.replace('-', '')) && texto1.includes('Camión Volvo FH 440'), 'la OT sin unidad muestra la placa y el vehículo de su ingreso')
  comprobar(texto1.includes('Cambio de bocinas del eje posterior') && texto1.includes('Revisar la fuga de aire'), 'dice qué hay que hacer, entero')
  comprobar(!/S\/|US\$|\bPEN\b|\bUSD\b|precio|monto/i.test(limpio(await pagina.locator('main').innerText())), 'la pantalla no trae montos')
  const t2 = tarjeta(pagina, OT.espera)
  const entrega2 = limpio(await t2.locator('[data-entrega]').innerText())
  comprobar(limpio(await t2.innerText()).includes('Espera el vehículo') && entrega2.includes('ya pasó'),
    `la que no tiene vehículo lo dice, y su fecha vencida también («${entrega2}»)`)
  comprobar((await t1.getByRole('link', { name: /Reportar el día/ }).count()) === 1 && (await t1.getByRole('button', { name: `Nuevo RQ para ${CODIGO}` }).count()) === 1,
    'cada OT abierta trae «Reportar el día» y «Nuevo RQ»')
  comprobar((await pagina.locator(`a[href^="/ordenes/"]`).count()) === 0, 'sin enlaces a la OT: no la abre')
  await pagina.screenshot({ path: join(carpeta, '1-lista-1440.png'), fullPage: true })

  // Terminadas
  await pagina.getByRole('link', { name: /Terminadas/ }).click()
  await pagina.waitForURL('**/mantenimiento?ver=terminadas')
  await tarjeta(pagina, OT.terminada).waitFor({ timeout: 20000 }).catch(() => {})
  const t3 = tarjeta(pagina, OT.terminada)
  const texto3 = limpio(await t3.innerText().catch(() => ''))
  comprobar(texto3.includes('Terminada') && texto3.includes('por Administración'), `la terminada va en «Terminadas» («${texto3.slice(0, 140)}»)`)
  comprobar((await t3.getByRole('button').count()) === 0 && (await t3.getByRole('link', { name: /Reportar el día/ }).count()) === 0, 'y ya no ofrece pedir ni reportar')
  await pagina.screenshot({ path: join(carpeta, '2-terminadas-1440.png'), fullPage: true })

  // Buscar por la placa
  await ir(pagina, `${BASE}/mantenimiento?q=${encodeURIComponent(PLACA.replace('-', ''))}`)
  const buscadas = await pagina.locator('[data-ot-de-mantenimiento]').evaluateAll((t) => t.map((x) => x.getAttribute('data-ot-de-mantenimiento')))
  comprobar(buscadas.length === 1 && buscadas[0] === OT.enPlanta, `buscar por la placa deja solo su OT (${buscadas.join(', ')})`)

  // ---------------------------------------- 2. Su RQ, por el N.º de la OT
  await ir(pagina, `${BASE}/mantenimiento`)
  const antes = Number((await consulta(`select count(*) n from public.requerimientos where codigo_interno = $1`, [CODIGO]))[0].n)
  await tarjeta(pagina, OT.enPlanta).getByRole('button', { name: `Nuevo RQ para ${CODIGO}` }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('#rq-para').waitFor({ timeout: 10000 })
  const para = limpio(await ventana.locator('#rq-para').innerText())
  comprobar(para.includes('Mantenimiento') && para.includes(CODIGO) && (await ventana.locator('select#rq-area').count()) === 0 && (await ventana.locator('input#rq-codigo').count()) === 0,
    `el área y el N.º de la OT van puestos y no se eligen («${para}»)`)
  await pagina.screenshot({ path: join(carpeta, '3-ventana-rq-1440.png') })
  await ventana.locator('#rq-justificacion').fill(`Bocinas y grasa para el mantenimiento ${sello}`)
  await ventana.locator('[id^="rq-mat-"]').first().click()
  await pagina.keyboard.type(material.descripcion.slice(0, 20))
  await pagina.getByRole('option', { name: material.descripcion }).first().click()
  await ventana.locator('[id^="rq-cant-"]').first().fill('2')
  const enviar = ventana.getByRole('button', { name: 'Registrar y mandar a Almacén' })
  await enviar.click()
  await enviar.click({ timeout: 800 }).catch(() => {})
  await ventana.waitFor({ state: 'detached', timeout: 20000 })
  const verde = tarjeta(pagina, OT.enPlanta).locator('p[role="status"]', { hasText: /RQ-/ })
  await verde.waitFor({ timeout: 20000 }).catch(() => {})
  const aviso = limpio(await verde.innerText().catch(() => ''))
  const numeroRq = (aviso.match(/RQ-\d{4}-\d{4}/) ?? [''])[0]
  comprobar(Boolean(numeroRq), `el verde sale en la tarjeta de la OT: «${aviso}»`)
  const filas = await consulta(
    `select r.numero, a.codigo area, r.tipo, r.estado, r.creado_por from public.requerimientos r join public.areas a on a.id = r.area_id
      where r.codigo_interno = $1 order by r.creado_en desc`, [CODIGO])
  comprobar(filas.length === antes + 1, `un solo RQ nuevo aunque se tocó dos veces (${antes} → ${filas.length})`)
  comprobar(filas[0]?.numero === numeroRq && filas[0]?.area === 'MNT' && filas[0]?.tipo === 'OPERACION' && filas[0]?.creado_por === usuarios[CUENTAS.mantenimiento],
    `en la base: ${filas[0]?.numero}, de operación, del área de Mantenimiento, registrado por su cuenta (${filas[0]?.estado})`)
  await tarjeta(pagina, OT.enPlanta).locator(`[data-rq-de-la-ot="${numeroRq}"]`).waitFor({ timeout: 15000 }).catch(() => {})
  comprobar((await tarjeta(pagina, OT.enPlanta).locator(`[data-rq-de-la-ot="${numeroRq}"]`).count()) === 1, `la tarjeta de la OT ya muestra ${numeroRq}`)
  comprobar((await tarjeta(pagina, OT.espera).locator('[data-rq-de-la-ot]').count()) === 0, 'y no la de la otra OT')
  await pagina.screenshot({ path: join(carpeta, '4-ot-con-su-rq-1440.png'), fullPage: true })

  // En Requerimientos: lo suyo, sin «Todas las áreas».
  await tarjeta(pagina, OT.enPlanta).getByRole('link', { name: numeroRq }).click()
  await pagina.waitForURL('**/requerimientos?rq=*')
  await pagina.getByText(`Solo el ${numeroRq}`).first().waitFor({ timeout: 20000 }).catch(() => {})
  comprobar(limpio(await pagina.locator('main').innerText()).includes(`Solo el ${numeroRq}`), `el número lleva a su requerimiento (${numeroRq})`)
  await ir(pagina, `${BASE}/requerimientos`)
  const pestanas = (await pagina.getByRole('navigation', { name: 'Requerimiento' }).getByRole('link').allInnerTexts().catch(() => [])).map(limpio)
  comprobar(pestanas.some((p) => p.startsWith('Por OT')) && pestanas.some((p) => p.startsWith('De tu área')) && !pestanas.some((p) => p.startsWith('Todas las áreas') || p.startsWith('Por unidad')),
    `en Requerimientos: «Por OT» y «De tu área», sin «Todas las áreas» ni «Por unidad» (${pestanas.join(' | ')})`)
  const ajenos = await consulta(`select r.numero from public.requerimientos r join public.areas a on a.id = r.area_id where a.codigo <> 'MNT' and r.estado <> 'ANULADO' limit 3`)
  const lista = limpio(await pagina.locator('main').innerText())
  comprobar(ajenos.length > 0 && lista.includes(numeroRq) && ajenos.every((a) => !lista.includes(a.numero)), `la lista trae el suyo y ninguno de otra área (${ajenos.map((a) => a.numero).join(', ') || 'no hay ajenos: la prueba no vale'})`)
  comprobar((await pagina.getByRole('button', { name: `Corregir el requerimiento ${numeroRq}` }).count()) === 1, 'y puede corregir el suyo')
  await ir(pagina, `${BASE}/requerimientos?area=todas`)
  const conTodas = limpio(await pagina.locator('main').innerText())
  comprobar(ajenos.every((a) => !conTodas.includes(a.numero)), 'ni escribiendo «?area=todas» en la dirección')
  await pagina.screenshot({ path: join(carpeta, '5-requerimientos-1440.png'), fullPage: true })
  await ir(pagina, `${BASE}/requerimientos/unidades`)
  comprobar(new URL(pagina.url()).pathname === '/mantenimiento', `«RQ por unidad» lo devuelve a su lista de OT (${new URL(pagina.url()).pathname})`)

  // ---------------------------------------- 3. Su reporte diario, por el N.º de la OT
  await tarjeta(pagina, OT.enPlanta).getByRole('link', { name: /Reportar el día/ }).click()
  await pagina.waitForURL('**/reportes-diarios/nuevo?codigo=*')
  await pagina.locator('#rd-codigo').waitFor({ timeout: 20000 })
  await quieta(pagina)
  comprobar((await pagina.locator('#rd-codigo').inputValue()) === CODIGO, `el reporte abre con el código de la OT (${await pagina.locator('#rd-codigo').inputValue()})`)
  await pagina.fill('#rd-asunto', `Mantenimiento ${sello}`)
  await pagina.fill('#rd-descripcion', 'Se cambiaron las bocinas del eje posterior; mañana se engrasa.')
  const trabajo = pagina.locator('fieldset[data-trabajo="1"]')
  if ((await pagina.getByRole('combobox', { name: 'Trabajo 1: sobre qué' }).count()) > 0) await elegir(pagina, 'Trabajo 1: sobre qué', 'Tarea nueva')
  // Con el sello: la actividad de otra vuelta sigue abierta en el código, y la base pide sumarle a esa.
  await trabajo.locator('textarea').fill(`Cambio de bocinas del eje posterior ${sello}`)
  await trabajo.locator('input[type="number"]').first().fill('50')
  await elegir(pagina, 'Personal del trabajo 1: persona 1', persona)
  await pagina.getByRole('spinbutton', { name: 'Personal del trabajo 1: horas de la persona 1' }).fill('6')
  await pagina.screenshot({ path: join(carpeta, '6-reporte-1440.png'), fullPage: true })
  const subir = pagina.getByRole('button', { name: 'Subir reporte' })
  await subir.click()
  await subir.click({ timeout: 800 }).catch(() => {})
  await pagina.waitForURL((u) => !u.pathname.endsWith('/nuevo'), { timeout: 30000 }).catch(() => {})
  await quieta(pagina)
  const rechazo = new URL(pagina.url()).pathname.endsWith('/nuevo') ? limpio(await pagina.locator('form [role="alert"]').last().innerText().catch(() => '')) : ''
  const reportes = await consulta(
    `select r.id, r.codigo_interno, r.fecha::text, r.registrado_por,
            (select json_agg(json_build_object('nombre', p.nombre, 'horas', p.horas::float)) from public.reporte_diario_personal p where p.reporte_id = r.id) as gente
       from public.reportes_diarios r where r.codigo_interno = $1 and r.creado_en > $2`, [CODIGO, inicio])
  comprobar(reportes.length === 1 && reportes[0].fecha === hoy && reportes[0].registrado_por === usuarios[CUENTAS.mantenimiento],
    `en la base: un solo reporte de hoy con ${CODIGO}, de su cuenta (${reportes.length}; quedó en ${new URL(pagina.url()).pathname}${rechazo ? `: «${rechazo}»` : ''})`)
  comprobar(reportes[0]?.gente?.length === 1 && reportes[0].gente[0].nombre.includes(persona) && reportes[0].gente[0].horas === 6,
    `con su gente de Mantenimiento y sus horas (${JSON.stringify(reportes[0]?.gente)})`)
  await ir(pagina, `${BASE}/mantenimiento`)
  const ultimo = limpio(await tarjeta(pagina, OT.enPlanta).locator('[data-ultimo-reporte]').innerText())
  comprobar(/^\d{2}\/\d{2}\/\d{4}/.test(ultimo), `la tarjeta de la OT dice su último reporte («${ultimo}»)`)
  await pagina.screenshot({ path: join(carpeta, '7-ot-con-reporte-1440.png'), fullPage: true })
  await ir(pagina, `${BASE}/reportes-diarios`)
  comprobar(limpio(await pagina.locator('main').innerText()).includes(`Mantenimiento ${sello}`), 'y su reporte está en «Reporte diario»')
  await ir(pagina, `${BASE}/`)
  comprobar((await pagina.locator('[data-te-toca]').getByRole('link', { name: new RegExp(PENDIENTE_DE_HOY) }).count()) === 0, 'subido el reporte, el Dashboard ya no lo pide')
  comprobar(errores.length === 0, `Mantenimiento sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ---------------------------------------- 4. En el teléfono
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.mantenimiento, CELULAR)
  const barra = pagina.locator('nav[aria-label="Navegación rápida"], nav').last()
  const cortos = (await barra.getByRole('link').allInnerTexts()).map(limpio)
  comprobar(['OT', 'Reporte', 'Averías', 'Equipos'].every((c) => cortos.some((x) => x.startsWith(c))), `las pestañas del teléfono: ${cortos.join(' | ')}`)
  await ir(pagina, `${BASE}/mantenimiento`)
  comprobar(await sinDesborde(pagina), 'la lista no se desborda a 390')
  const boton = tarjeta(pagina, OT.enPlanta).getByRole('link', { name: /Reportar el día/ })
  const caja = await boton.boundingBox()
  comprobar(Boolean(caja) && caja.height >= 40, `«Reportar el día» mide ${Math.round(caja?.height ?? 0)} px de alto en el teléfono`)
  await pagina.screenshot({ path: join(carpeta, '1-lista-390.png'), fullPage: true })
  await ir(pagina, `${BASE}/mantenimiento?ver=terminadas`)
  comprobar(await sinDesborde(pagina), '«Terminadas» tampoco')
  await pagina.screenshot({ path: join(carpeta, '2-terminadas-390.png'), fullPage: true })
  await ir(pagina, `${BASE}/mantenimiento`)
  await tarjeta(pagina, OT.espera).getByRole('button', { name: `Nuevo RQ para OT ${OT.espera}` }).click()
  await pagina.locator('[role="dialog"] #rq-para').waitFor({ timeout: 10000 })
  await pagina.screenshot({ path: join(carpeta, '3-ventana-rq-390.png') })
  await pagina.keyboard.press('Escape')
  await ir(pagina, `${BASE}/requerimientos`)
  comprobar(await sinDesborde(pagina), 'Requerimientos no se desborda a 390')
  await pagina.screenshot({ path: join(carpeta, '5-requerimientos-390.png'), fullPage: true })
  comprobar(errores.length === 0, `teléfono sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ---------------------------------------- 5. Quien no es Mantenimiento no entra
for (const [puesto, correo] of [['Tesorería', CUENTAS.tesoreria], ['El supervisor de Producción', CUENTAS.produccion]]) {
  const { pagina, contexto } = await entrar(correo)
  comprobar((await pagina.locator('nav a[href="/mantenimiento"]').count()) === 0, `${puesto} no tiene «OT de mantenimiento» en su menú`)
  await ir(pagina, `${BASE}/mantenimiento`)
  comprobar(new URL(pagina.url()).pathname === '/sin-permiso', `${puesto} no entra a /mantenimiento (${new URL(pagina.url()).pathname})`)
  await contexto.close()
}
{
  // El supervisor sigue con su «Por unidad» y su «Todas las áreas».
  const { pagina, contexto } = await entrar(CUENTAS.produccion)
  await ir(pagina, `${BASE}/requerimientos`)
  const pestanas = (await pagina.getByRole('navigation', { name: 'Requerimiento' }).getByRole('link').allInnerTexts().catch(() => [])).map(limpio)
  comprobar(pestanas.some((p) => p.startsWith('Por unidad')) && pestanas.some((p) => p.startsWith('Todas las áreas')) && !pestanas.some((p) => p.startsWith('Por OT')),
    `el supervisor de Producción sigue con «Por unidad» y «Todas las áreas» (${pestanas.join(' | ')})`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo pasa.' : `\n${fallas.length} fallan:\n- ${fallas.join('\n- ')}`)
process.exit(fallas.length === 0 ? 0 : 1)
