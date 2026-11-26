/**
 * Los trámites (plan «El puesto de Tramitador», entrega 1, migraciones
 * 20261126997000, 20261126997100 y 20261126997200), con clic real y la cuenta
 * de cada puesto (nunca ADMIN):
 *
 *   1. El Tramitador, en el monitor: «Trámites» es lo único de su menú. Registra
 *      el de una unidad con un asunto corto: tres toques dan un envío, el
 *      rechazo se dice, el cursor va al aviso y lo escrito sigue. Corrige y
 *      envía tres veces: entra un solo TR, «En trámite», con el cliente de la
 *      unidad. Registra otro de la empresa sin presentar y con la fecha límite
 *      pasada: «Por iniciar» y vencido, arriba en la lista. «¿No está en la
 *      lista?» lo lleva al catálogo: agrega un tipo (un nombre repetido se
 *      rechaza junto a su campo; los días de aviso se proponen solos) y lo deja
 *      fuera de uso con «Editar». Marca el primero «Observado» con su nota (sale
 *      en la vista «Observados» y en «Te toca»; desde otra pestaña que quedó
 *      abierta con la ficha de antes, guardar no la pisa) y pide anular el segundo.
 *   2. El Tramitador, en el celular: la lista y la ficha no se deslizan de costado.
 *   3. Gerencia: su menú y «Por decidir» cuentan la anulación; consulta sin
 *      «Registrar»; no la aprueba (con motivo) y el trámite sigue. El Tramitador
 *      la pide otra vez; con esa ficha abierta en una pestaña, Gerencia dice que
 *      no en otra y el Tramitador la pide con otro motivo: desde la pestaña que
 *      quedó abierta no se anula. Recargada, la aprueba con tres toques: queda
 *      anulado, una vez.
 *   4. Administración consulta los dos y el catálogo, sin botones.
 *   5. Ventas ve solo el de la unidad; el de la empresa, ni por su dirección.
 *   6. Tesorería: sin «Trámites» en el menú, y su dirección la manda a «Sin permiso».
 *
 * Deja en el banco los trámites y el tipo (fuera de uso): un documento numerado
 * no se borra, y un tipo tampoco.
 *
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
const CUENTAS = {
  tramitador: 'tramitador.local@metalwork.test',
  gerencia: 'gerencia.local@metalwork.test',
  administracion: 'administracion.local@metalwork.test',
  ventas: 'ventas.local@metalwork.test',
  tesoreria: 'tesoreria.local@metalwork.test',
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

/** Lo que hace una cuenta en la base, como ella: con su sesión y el rol `authenticated`, nunca como dueño. */
async function como(correo, sql, valores = []) {
  const [u] = await consulta(`select id from public.usuarios where correo = $1`, [correo])
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                             set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [u.id])
    await base.query('set local role authenticated')
    const r = await base.query(sql, valores)
    await base.query('commit')
    return r
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const quieta = (pagina) => pagina.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
async function ir(pagina, url) {
  await pagina.goto(url, { waitUntil: 'load' })
  await quieta(pagina)
}
async function hasta(leer, cumple, ms = 20000) {
  const fin = Date.now() + ms
  let ultimo = await leer()
  while (!cumple(ultimo) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 300))
    ultimo = await leer()
  }
  return ultimo
}

// ------------------------------------------------------------ la unidad del trámite
const [unidad] = await consulta(
  `select u.id, u.placa, u.cliente_id, c.razon_social,
          (select count(*)::int from public.ordenes_trabajo o where o.unidad_id = u.id and o.estado <> 'ANULADA') as ordenes
     from public.unidades u join public.clientes c on c.id = u.cliente_id
    where u.activo and u.placa is not null and nullif(btrim(u.codigo_interno), '') is distinct from 'TODOS LOS ACTIVOS'
    order by (select count(*) from public.ordenes_trabajo o where o.unidad_id = u.id and o.estado <> 'ANULADA') desc, u.placa limit 1`,
)
if (!unidad) throw new Error('El banco no trae ninguna unidad con placa y cliente.')
const [{ hoy, ayer, en10 }] = await consulta(
  `select h::text as hoy, (h - 1)::text as ayer, (h + 10)::text as en10 from (select (now() at time zone 'America/Lima')::date as h) x`,
)

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const CELULAR = { width: 390, height: 844 }
const MONITOR = { width: 1440, height: 1000 }

async function entrar(correo, viewport = MONITOR) {
  const celular = viewport.width < 500
  const contexto = await navegador.newContext({
    viewport,
    isMobile: celular,
    hasTouch: celular,
    deviceScaleFactor: 2,
    timezoneId: 'America/Lima',
    locale: 'es-PE',
  })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' && !t.includes('_next/hmr') && !t.includes('WebSocket')) errores.push(t.slice(0, 300))
  })
  // Cada envío de un formulario: la pregunta por los avisos, que sale sola cada
  // minuto, también es una acción de servidor y no se cuenta.
  const acciones = { n: 0 }
  pagina.on('request', (r) => {
    if (r.method() === 'POST' && r.headers()['next-action'] && /tipo_id|motivo|respuesta|_estado"|dias_aviso/.test(r.postData() ?? '')) acciones.n++
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
  const [yo] = await consulta(`select id from public.usuarios where correo = $1`, [correo])
  return { pagina, contexto, errores, acciones, yo }
}

async function tresToques(boton) {
  await boton.evaluate((b) => {
    b.click()
    b.click()
    b.click()
  })
}

/** La captura, sin el indicador de `next dev`, que tapa el pie del menú. */
async function captura(pagina, nombre, completa = true) {
  await pagina.addStyleTag({ content: 'nextjs-portal { display: none !important }' })
  // En el celular, lo que se ve en la pantalla: en la página entera, la barra de abajo salía pintada a media captura.
  const entera = completa && (pagina.viewportSize()?.width ?? 0) >= 500
  // Desde arriba: con la página deslizada, la barra y el menú salían pintados a media captura.
  if (entera) await pagina.evaluate(() => window.scrollTo(0, 0))
  await pagina.screenshot({ path: join(CAPTURAS, nombre), fullPage: entera })
}

const textoDelMenu = async (pagina) => limpio(await pagina.locator('nav').first().innerText().catch(() => ''))
const ventanaDe = (pagina) => pagina.locator('[role="dialog"]', { has: pagina.locator('form') }).last()
const verdeDe = (pagina) => pagina.locator('p[role="status"]').first().innerText().catch(() => '')
const anchoDe = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth)
const avisosDe = (correo, id) =>
  consulta(
    `select n.titulo from public.notificaciones n join public.usuarios u on u.id = n.usuario_id
      where u.correo = $1 and n.origen_tabla = 'tramites' and n.origen_id = $2`,
    [correo, id],
  )
const tramite = async (id) => (await consulta(`select * from public.tramites where id = $1`, [id]))[0] ?? null
const porAsunto = (asunto) => consulta(`select * from public.tramites where asunto = $1`, [asunto])

const sello = Date.now().toString().slice(-6)
const ASUNTO_UNIDAD = `Tarjeta de propiedad de la unidad ${unidad.placa} (${sello})`
const ASUNTO_EMPRESA = `Renovación del SOAT de la camioneta de reparto (${sello})`
const TIPO_NUEVO = `Permiso de prueba ${sello}`

let tr1 = null
let tr2 = null

// ============================================================ 1. El Tramitador registra y lleva
{
  const { pagina, contexto, errores, acciones, yo } = await entrar(CUENTAS.tramitador)
  await ir(pagina, `${BASE}/`)
  const menu = await textoDelMenu(pagina)
  comprobar(/Trámites/.test(menu) && !/Clientes|Órdenes de trabajo|Cotización/.test(menu), `[Tramitador 1440] su menú es el de los trámites: «${menu.slice(0, 160)}»`)
  await ir(pagina, `${BASE}/tramites`)
  comprobar((await pagina.getByRole('heading', { name: 'Trámites', exact: true }).count()) === 1, '[Tramitador 1440] abre «Trámites»')

  // --- el de una unidad, primero con un asunto corto
  await pagina.getByRole('button', { name: 'Registrar trámite' }).click()
  let v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('#tramite-tipo').selectOption({ label: 'Tarjeta de propiedad' })
  comprobar((await v.locator('#tramite-entidad').inputValue()) === 'SUNARP', '[Tramitador 1440] al elegir el tipo, propone su entidad')
  await v.locator('#tramite-unidad').click()
  await pagina.getByPlaceholder('Placa, código interno o cliente…').fill(unidad.placa)
  await pagina.getByRole('option', { name: new RegExp(unidad.placa) }).first().click()
  comprobar(limpio(await v.locator('[data-cliente-de-la-unidad]').innerText().catch(() => '')).includes(unidad.razon_social), '[Tramitador 1440] al elegir la unidad, dice de qué cliente es')
  comprobar((await v.locator('#tramite-orden').count()) === (unidad.ordenes > 0 ? 1 : 0), `[Tramitador 1440] ofrece la OT de la unidad solo si la tiene (${unidad.ordenes})`)
  await v.locator('#tramite-asunto').evaluate((el) => el.removeAttribute('minlength'))
  await v.locator('#tramite-asunto').fill('abc')
  const enviar = v.getByRole('button', { name: 'Registrar el trámite' })
  const antes = acciones.n
  await tresToques(enviar)
  const aviso = await hasta(() => v.locator('#tramite-error').innerText().catch(() => ''), (t) => /5/.test(t))
  await quieta(pagina)
  comprobar(acciones.n - antes === 1, `[Tramitador 1440] tres toques con un asunto corto: ${acciones.n - antes} envío`)
  comprobar(/al menos 5/.test(aviso), `[Tramitador 1440] el rechazo se dice: «${limpio(aviso)}»`)
  comprobar(await hasta(() => pagina.evaluate(() => document.activeElement?.id === 'tramite-error'), Boolean, 5000), '[Tramitador 1440] el cursor va al aviso')
  comprobar((await v.locator('#tramite-asunto').inputValue()) === 'abc', '[Tramitador 1440] lo escrito sigue en el campo')

  await v.locator('#tramite-asunto').fill(ASUNTO_UNIDAD)
  await v.locator('#tramite-expediente').fill(`2026-${sello}`)
  await v.locator('#tramite-inicio').fill(hoy)
  await v.locator('#tramite-limite').fill(en10)
  const antesDelBueno = acciones.n
  await tresToques(enviar)
  const verde = await hasta(() => verdeDe(pagina), (t) => /registrado/.test(t), 30000)
  await quieta(pagina)
  const entraron = await porAsunto(ASUNTO_UNIDAD)
  tr1 = entraron[0] ?? null
  comprobar(entraron.length === 1 && acciones.n - antesDelBueno === 1, `[Tramitador 1440] tres toques con todo bien: ${entraron.length} trámite y ${acciones.n - antesDelBueno} envío`)
  comprobar(
    /^TR-\d{4}-\d{4}$/.test(tr1?.numero ?? '') && tr1?.estado === 'EN_TRAMITE' && tr1?.registrado_por === yo.id && tr1?.cliente_id === unidad.cliente_id && tr1?.ambito === 'UNIDAD',
    `[Tramitador 1440] entró ${tr1?.numero}, «En trámite», a su nombre y con el cliente de la unidad`,
  )
  comprobar(new RegExp(`Trámite ${tr1?.numero} registrado`).test(verde), `[Tramitador 1440] el verde dice su número: «${limpio(verde)}»`)
  comprobar((await pagina.locator(`a[href="/tramites/${tr1?.id}"]`, { hasText: 'Ver el trámite' }).count()) === 1, '[Tramitador 1440] y lleva a su ficha')

  // --- el de la empresa, sin presentar y con la fecha límite de ayer
  await pagina.getByRole('button', { name: 'Registrar trámite' }).click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('#tramite-tipo').selectOption({ label: 'SOAT' })
  comprobar((await v.locator('#tramite-unidad').count()) === 0, '[Tramitador 1440] el de la empresa no pide unidad')
  await v.locator('#tramite-asunto').fill(ASUNTO_EMPRESA)
  await v.locator('#tramite-entidad').fill('Rímac')
  await v.locator('#tramite-limite').fill(ayer)
  await captura(pagina, 'tramites-registrar-1440.png', false)
  await v.getByRole('button', { name: 'Registrar el trámite' }).click()
  await hasta(() => verdeDe(pagina), (t) => /registrado/.test(t), 30000)
  await quieta(pagina)
  tr2 = (await porAsunto(ASUNTO_EMPRESA))[0] ?? null
  comprobar(tr2?.estado === 'POR_INICIAR' && tr2?.ambito === 'EMPRESA' && tr2?.entidad === 'Rímac' && tr2?.unidad_id === null, `[Tramitador 1440] el de la empresa entró ${tr2?.numero}, «Por iniciar»`)

  await ir(pagina, `${BASE}/tramites`)
  const filas = await pagina.locator('[data-tramite]').evaluateAll((fs) => fs.map((f) => f.getAttribute('data-tramite')))
  comprobar(filas.indexOf(tr2?.numero) !== -1 && filas.indexOf(tr2?.numero) < filas.indexOf(tr1?.numero), '[Tramitador 1440] el vencido va antes que el que vence en 10 días')
  comprobar(/Venció hace 1 día/.test(await pagina.locator(`[data-tramite="${tr2?.numero}"]`).innerText()), '[Tramitador 1440] la lista dice «Venció hace 1 día»')
  comprobar(/Vence en 10 días/.test(await pagina.locator(`[data-tramite="${tr1?.numero}"]`).innerText()), '[Tramitador 1440] y «Vence en 10 días»')
  await ir(pagina, `${BASE}/`)
  const globo = (await pagina.locator('nav a[aria-label^="Trámites, "]').first().getAttribute('aria-label').catch(() => null)) ?? ''
  comprobar(/\d+ pendientes?/.test(globo), `[Tramitador 1440] su menú cuenta el trámite vencido: «${globo}»`)

  // --- el catálogo: «¿No está en la lista?» cierra la ventana y lleva a «Agregar tipo»
  await ir(pagina, `${BASE}/tramites`)
  await pagina.getByRole('button', { name: 'Registrar trámite' }).click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('[data-ir-a-tipos]').click()
  const enElCatalogo = await hasta(
    () => pagina.evaluate(() => document.getElementById('tipos-de-tramite')?.open === true && document.activeElement?.getAttribute('data-guardar-tipo') === 'nuevo'),
    Boolean,
    5000,
  )
  comprobar(enElCatalogo && (await pagina.locator('[role="dialog"]').count()) === 0, '[Tramitador 1440] «¿No está en la lista?» cierra la ventana, abre el catálogo y deja el cursor en «Agregar tipo»')
  await pagina.locator('[data-guardar-tipo="nuevo"]').click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  const propuestos = await v.locator('input[name="dias_aviso"]').inputValue()
  await v.locator('input[name="se_renueva"]').check()
  const siSeRenueva = await v.locator('input[name="dias_aviso"]').inputValue()
  await v.locator('input[name="se_renueva"]').uncheck()
  comprobar(propuestos === '5' && siSeRenueva === '30, 15, 7', `[Tramitador 1440] al tipo nuevo le propone avisar 5 días antes, y 30, 15 y 7 si se renueva («${propuestos}» / «${siSeRenueva}»)`)
  await v.locator('input[name="nombre"]').fill('soat')
  await v.locator('input[name="entidad"]').fill('MTC')
  await v.locator('input[name="dias_aviso"]').fill('5, 20, 5')
  await v.getByRole('button', { name: 'Agregar el tipo' }).click()
  const repetido = await hasta(() => v.locator('[aria-invalid="true"]').count(), (n) => n > 0, 15000)
  comprobar(repetido > 0 && /Ya hay un tipo/.test(limpio(await v.innerText())), '[Tramitador 1440] un nombre repetido se rechaza junto a su campo')
  await v.locator('input[name="nombre"]').fill(TIPO_NUEVO)
  await v.getByRole('button', { name: 'Agregar el tipo' }).click()
  const [tipoNuevo] = await hasta(() => consulta(`select * from public.tramite_tipos where nombre = $1`, [TIPO_NUEVO]), (r) => r.length === 1, 20000)
  comprobar(tipoNuevo?.ambito === 'EMPRESA' && JSON.stringify(tipoNuevo?.dias_aviso) === '[20,5]' && tipoNuevo?.activo, `[Tramitador 1440] agrega el tipo «${TIPO_NUEVO}», con sus avisos de más a menos y sin repetir`)
  await quieta(pagina)
  await pagina.locator('#tipos-de-tramite').evaluate((d) => (d.open = true))
  comprobar((await hasta(() => pagina.locator(`[data-tipo="${TIPO_NUEVO}"]`).count(), (n) => n === 1, 15000)) === 1, '[Tramitador 1440] y sale en el catálogo')
  comprobar(/agregado/.test(limpio(await pagina.locator('#tipos-de-tramite p[role="status"]').innerText().catch(() => ''))), '[Tramitador 1440] y lo dice junto al botón')
  await captura(pagina, 'tramites-lista-tramitador-1440.png')
  // El tipo de prueba se deja fuera de uso: no se borra, y así no se ofrece al registrar.
  await pagina.locator(`[data-guardar-tipo="${TIPO_NUEVO}"]`).click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('input[name="activo"]').uncheck()
  await tresToques(v.getByRole('button', { name: 'Guardar' }))
  const [fueraDeUso] = await hasta(() => consulta(`select activo, dias_aviso from public.tramite_tipos where nombre = $1`, [TIPO_NUEVO]), (r) => r[0]?.activo === false, 20000)
  comprobar(fueraDeUso?.activo === false && JSON.stringify(fueraDeUso?.dias_aviso) === '[20,5]', '[Tramitador 1440] «Editar» lo deja fuera de uso, sin tocar lo demás')
  await quieta(pagina)
  await pagina.getByRole('button', { name: 'Registrar trámite' }).click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  comprobar((await v.locator('#tramite-tipo option', { hasText: TIPO_NUEVO }).count()) === 0, '[Tramitador 1440] y ya no se ofrece al registrar')
  await pagina.keyboard.press('Escape')

  // --- la ficha: observado, con su nota
  await ir(pagina, `${BASE}/tramites/${tr1?.id}`)
  comprobar(/En la entidad|Te toca/.test(limpio(await pagina.locator('[data-que-sigue]').innerText().catch(() => ''))), '[Tramitador 1440] la ficha dice qué sigue')
  // La misma ficha queda abierta en otra pestaña, como estaba antes de la observación.
  const deAntes = await contexto.newPage()
  await ir(deAntes, `${BASE}/tramites/${tr1?.id}`)
  await pagina.getByRole('button', { name: 'Actualizar' }).click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('input[name="estado"][value="OBSERVADO"]').check()
  await v.locator('textarea[name="nota"]').evaluate((el) => {
    el.removeAttribute('required')
    el.removeAttribute('minlength')
  })
  await v.getByRole('button', { name: 'Guardar' }).click()
  const sinNota = await hasta(() => v.locator('[role="alert"]').first().innerText().catch(() => ''), (t) => /observó/.test(t), 15000)
  comprobar(/qué observó la entidad/.test(sinNota) && (await tramite(tr1?.id))?.estado === 'EN_TRAMITE', `[Tramitador 1440] observado sin nota no se guarda: «${limpio(sinNota)}»`)
  await v.locator('textarea[name="nota"]').fill('Falta la firma legalizada del cliente en el formulario.')
  await v.getByRole('button', { name: 'Guardar' }).click()
  await hasta(() => tramite(tr1?.id), (t) => t?.estado === 'OBSERVADO', 20000)
  await hasta(() => pagina.locator('[data-situacion]').first().getAttribute('data-situacion'), (s) => s === 'OBSERVADO', 20000)
  const t1 = await tramite(tr1?.id)
  comprobar(t1?.estado === 'OBSERVADO' && t1?.nota === 'Falta la firma legalizada del cliente en el formulario.', '[Tramitador 1440] queda «Observado», con lo que observó la entidad')
  comprobar(/Falta la firma/.test(limpio(await pagina.locator('[data-nota]').innerText().catch(() => ''))), '[Tramitador 1440] y la ficha lo muestra')
  await captura(pagina, 'tramites-ficha-tramitador-1440.png')
  // Desde la pestaña que quedó abierta, anotar el expediente no borra lo que observó la entidad.
  await deAntes.getByRole('button', { name: 'Actualizar' }).click()
  v = ventanaDe(deAntes)
  await v.waitFor({ timeout: 15000 })
  await v.locator('input[name="expediente"]').fill('2026-PISADO')
  await v.getByRole('button', { name: 'Guardar' }).click()
  const pisado = await hasta(() => v.locator('[role="alert"]').first().innerText().catch(() => ''), (t) => /cambió después/.test(t), 15000)
  const sigue = await tramite(tr1?.id)
  comprobar(
    /cambió después de que abriste/.test(pisado) && sigue?.estado === 'OBSERVADO' && /Falta la firma/.test(sigue?.nota ?? '') && sigue?.expediente !== '2026-PISADO',
    `[Tramitador 1440] desde una pestaña que quedó abierta no se pisa la observación: «${limpio(pisado).slice(0, 100)}»`,
  )
  await deAntes.close()
  await ir(pagina, `${BASE}/tramites?vista=observados`)
  comprobar((await pagina.locator(`[data-tramite="${tr1?.numero}"]`).count()) === 1 && (await pagina.locator(`[data-tramite="${tr2?.numero}"]`).count()) === 0,
    '[Tramitador 1440] la vista «Observados» trae el observado y no el otro')
  await ir(pagina, `${BASE}/`)
  comprobar((await pagina.locator('a[href="/tramites?vista=observados"]').count()) >= 1, '[Tramitador 1440] «Te toca» lleva a los observados')

  // --- pide anular el de la empresa
  await ir(pagina, `${BASE}/tramites/${tr2?.id}`)
  await pagina.getByRole('button', { name: 'Pedir anulación' }).click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('textarea[name="motivo"]').fill('Se registró dos veces el mismo SOAT.')
  const antesDePedir = acciones.n
  await tresToques(v.getByRole('button', { name: 'Pedir la anulación' }))
  await hasta(() => pagina.locator('[data-situacion]').first().getAttribute('data-situacion'), (s) => s === 'POR_ANULAR', 20000)
  await quieta(pagina)
  const t2 = await tramite(tr2?.id)
  comprobar(acciones.n - antesDePedir === 1 && t2?.anulacion_pedida_por === yo.id && t2?.estado === 'POR_INICIAR', `[Tramitador 1440] tres toques, un pedido: espera el visto de Gerencia (${acciones.n - antesDePedir} envío)`)
  comprobar((await pagina.getByRole('button', { name: /Actualizar|Pedir anulación|Aprobar/ }).count()) === 0, '[Tramitador 1440] mientras espera, no tiene botones')
  comprobar(/Se registró dos veces/.test(limpio(await pagina.locator('[data-pedido-de-anulacion]').innerText().catch(() => ''))), '[Tramitador 1440] la ficha muestra el pedido con su motivo')
  comprobar(errores.length === 0, `[Tramitador 1440] sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}
comprobar((await avisosDe(CUENTAS.gerencia, tr2?.id)).length === 1, '[Gerencia] le llegó un aviso del pedido de anulación')
comprobar((await avisosDe(CUENTAS.administracion, tr2?.id)).length === 0, '[Administración] a quien solo consulta no le llegó')

// ============================================================ 2. El Tramitador, en el celular
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.tramitador, CELULAR)
  await ir(pagina, `${BASE}/tramites`)
  comprobar((await anchoDe(pagina)) <= 390, `[Tramitador 390] la lista no se desliza de costado (${await anchoDe(pagina)} px)`)
  const fila = pagina.locator(`[data-tramite="${tr1?.numero}"]`)
  comprobar(/Observado/.test(await fila.innerText()) && /Vence en 10 días/.test(await fila.innerText()) && (await fila.innerText()).includes(unidad.placa), '[Tramitador 390] la fila trae la unidad, el plazo y cómo va')
  await captura(pagina, 'tramites-lista-tramitador-390.png')
  await pagina.getByRole('button', { name: 'Registrar trámite' }).click()
  const v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('#tramite-tipo').selectOption({ label: 'Placas' })
  await v.locator('#tramite-unidad').click()
  await pagina.getByPlaceholder('Placa, código interno o cliente…').fill(unidad.placa)
  await pagina.getByRole('option', { name: new RegExp(unidad.placa) }).first().click()
  await v.locator('#tramite-asunto').fill(`Placas de la unidad ${unidad.placa}`)
  comprobar((await anchoDe(pagina)) <= 390, `[Tramitador 390] el registro no se desliza de costado (${await anchoDe(pagina)} px)`)
  await captura(pagina, 'tramites-registrar-390.png', false)
  await pagina.keyboard.press('Escape')
  await ir(pagina, `${BASE}/tramites/${tr1?.id}`)
  comprobar((await anchoDe(pagina)) <= 390, `[Tramitador 390] la ficha no se desliza de costado (${await anchoDe(pagina)} px)`)
  comprobar((await pagina.getByRole('button', { name: 'Actualizar' }).count()) === 1 && (await pagina.getByRole('button', { name: 'Pedir anulación' }).count()) === 1, '[Tramitador 390] en la ficha puede actualizar y pedir la anulación')
  await captura(pagina, 'tramites-ficha-tramitador-390.png')
  comprobar(errores.length === 0, `[Tramitador 390] sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================================ 3. Gerencia aprueba la anulación, o no
{
  const { pagina, contexto, errores, acciones, yo } = await entrar(CUENTAS.gerencia)
  await ir(pagina, `${BASE}/`)
  const globo = (await pagina.locator('nav a[aria-label^="Trámites, "]').first().getAttribute('aria-label').catch(() => null)) ?? ''
  comprobar(/\d+ pendientes?/.test(globo), `[Gerencia 1440] su menú cuenta la anulación que espera su visto: «${globo}»`)
  await ir(pagina, `${BASE}/tramites?vista=por-anular`)
  comprobar((await pagina.getByRole('button', { name: 'Registrar trámite' }).count()) === 0, '[Gerencia 1440] consulta: no tiene «Registrar trámite»')
  const fila = pagina.locator(`[data-tramite="${tr2?.numero}"]`)
  comprobar((await fila.count()) === 1 && /Te toca/.test(await fila.innerText()), '[Gerencia 1440] en «Por anular», el trámite dice «Te toca»')
  await captura(pagina, 'tramites-lista-gerencia-1440.png')
  await pagina.locator('#tipos-de-tramite > summary').click()
  comprobar((await pagina.locator('[data-tipo]').count()) > 5 && (await pagina.locator('[data-guardar-tipo]').count()) === 0, '[Gerencia 1440] lee el catálogo, sin «Agregar tipo» ni «Editar»')

  await ir(pagina, `${BASE}/por-decidir`)
  const grupo = pagina.locator('[data-grupo-por-decidir="tramites"]')
  comprobar(
    Number(await grupo.getAttribute('data-cantidad').catch(() => '0')) >= 1 && (await grupo.locator(`a[href="/tramites/${tr2?.id}"]`).count()) >= 1,
    '[Gerencia 1440] «Por decidir» trae la anulación que espera su visto, con el salto a su ficha',
  )
  await captura(pagina, 'tramites-por-decidir-gerencia-1440.png')
  {
    // La misma bandeja en el celular, mientras la anulación espera.
    const celular = await entrar(CUENTAS.gerencia, CELULAR)
    await ir(celular.pagina, `${BASE}/por-decidir`)
    comprobar(
      (await celular.pagina.locator(`[data-grupo-por-decidir="tramites"] a[href="/tramites/${tr2?.id}"]`).count()) >= 1 && (await anchoDe(celular.pagina)) <= 390,
      '[Gerencia 390] «Por decidir» trae la anulación, sin deslizar de costado',
    )
    await celular.pagina.locator('[data-grupo-por-decidir="tramites"]').scrollIntoViewIfNeeded()
    await captura(celular.pagina, 'tramites-por-decidir-gerencia-390.png')
    await celular.contexto.close()
  }

  await ir(pagina, `${BASE}/tramites/${tr2?.id}`)
  comprobar(/Te toca/.test(limpio(await pagina.locator('[data-que-sigue]').innerText().catch(() => ''))), '[Gerencia 1440] la ficha dice que le toca')
  comprobar((await pagina.getByRole('button', { name: /Actualizar|Pedir anulación/ }).count()) === 0, '[Gerencia 1440] no lleva el trámite ni pide anularlo')
  await captura(pagina, 'tramites-ficha-gerencia-1440.png')
  // No la aprueba, desde otra pestaña: la primera se queda abierta con este pedido a la vista.
  const otra = await contexto.newPage()
  await ir(otra, `${BASE}/tramites/${tr2?.id}`)
  await otra.getByRole('button', { name: 'No aprobar' }).click()
  let v = ventanaDe(otra)
  await v.waitFor({ timeout: 15000 })
  await v.locator('textarea[name="motivo"]').fill('El otro SOAT es de otra camioneta: este sigue.')
  await v.getByRole('button', { name: 'No aprobar la anulación' }).click()
  await hasta(() => otra.locator('[data-situacion]').first().getAttribute('data-situacion'), (s) => s === 'POR_INICIAR', 20000)
  await quieta(otra)
  await otra.close()
  await ir(pagina, `${BASE}/tramites/${tr2?.id}`)
  let t2 = await tramite(tr2?.id)
  comprobar(t2?.estado === 'POR_INICIAR' && t2?.anulacion_rechazada_por === yo.id && t2?.anulado_en === null, '[Gerencia 1440] no la aprueba: el trámite sigue como estaba')
  comprobar(/no aprobó anularlo/.test(limpio(await pagina.locator('[data-anulacion-no-aprobada]').innerText().catch(() => ''))), '[Gerencia 1440] y la ficha guarda la respuesta con su motivo')
  comprobar((await avisosDe(CUENTAS.tramitador, tr2?.id)).length === 1, '[Tramitador] le llegó que no se aprobó')

  // El Tramitador la pide otra vez (en SQL, con su cuenta), con otro motivo.
  await como(CUENTAS.tramitador, `select public.tramites_pedir_anulacion($1, $2)`, [tr2?.id, 'Se registró dos veces el mismo SOAT.'])
  // Una pestaña de Gerencia se queda abierta con este pedido a la vista…
  const quieto = await contexto.newPage()
  await ir(quieto, `${BASE}/tramites/${tr2?.id}`)
  // …mientras en otra dice que no, y el Tramitador lo vuelve a pedir con otro motivo.
  await como(CUENTAS.gerencia, `select * from public.tramites_resolver_anulacion($1, false, $2, (select anulacion_pedida_en from public.tramites where id = $1))`, [
    tr2?.id,
    'Sigue siendo de otra camioneta: no se anula.',
  ])
  await como(CUENTAS.tramitador, `select public.tramites_pedir_anulacion($1, $2)`, [tr2?.id, 'La aseguradora devolvió la solicitud: se hará con otra.'])
  // Desde la pestaña que quedó abierta, anular no entra: ese motivo no lo leyó.
  await quieto.getByRole('button', { name: 'Aprobar la anulación' }).click()
  v = ventanaDe(quieto)
  await v.waitFor({ timeout: 15000 })
  comprobar(/Se registró dos veces/.test(limpio(await v.innerText())), '[Gerencia 1440] la pestaña que quedó abierta muestra el motivo del pedido anterior')
  await v.getByRole('button', { name: 'Anular el trámite' }).click()
  const rechazoViejo = await hasta(() => v.locator('[role="alert"]').first().innerText().catch(() => ''), (t) => /volvió a pedir/.test(t), 15000)
  t2 = await tramite(tr2?.id)
  comprobar(/se volvió a pedir anular/.test(rechazoViejo) && t2?.estado === 'POR_INICIAR' && t2?.anulado_en === null,
    `[Gerencia 1440] desde esa pestaña no se anula con un motivo que no leyó: «${limpio(rechazoViejo).slice(0, 110)}»`)
  await quieto.close()
  await ir(pagina, `${BASE}/tramites/${tr2?.id}`)
  await pagina.getByRole('button', { name: 'Aprobar la anulación' }).click()
  v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  comprobar(/La aseguradora devolvió/.test(limpio(await v.innerText())), '[Gerencia 1440] antes de anular, ve el motivo que le dieron')
  const antes = acciones.n
  await tresToques(v.getByRole('button', { name: 'Anular el trámite' }))
  await hasta(() => pagina.locator('[data-situacion]').first().getAttribute('data-situacion'), (s) => s === 'ANULADO', 20000)
  await quieta(pagina)
  t2 = await tramite(tr2?.id)
  comprobar(acciones.n - antes === 1 && t2?.estado === 'ANULADO' && t2?.anulado_por === yo.id, `[Gerencia 1440] tres toques, una anulación (${acciones.n - antes} envío): queda anulado con su visto`)
  comprobar((await pagina.getByRole('button', { name: /Aprobar|No aprobar|Actualizar/ }).count()) === 0, '[Gerencia 1440] anulado, sin botones')
  comprobar(/Anulado con el visto/.test(limpio(await pagina.locator('[data-anulado]').innerText().catch(() => ''))), '[Gerencia 1440] la ficha dice quién lo anuló y por qué')
  await captura(pagina, 'tramites-ficha-anulado-gerencia-1440.png')
  comprobar((await avisosDe(CUENTAS.tramitador, tr2?.id)).length === 3, '[Tramitador] le llegó cada respuesta: dos «no» y la anulación')
  comprobar(errores.length === 0, `[Gerencia 1440] sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia, CELULAR)
  await ir(pagina, `${BASE}/tramites?vista=anulados`)
  comprobar((await pagina.locator(`[data-tramite="${tr2?.numero}"]`).count()) === 1 && (await anchoDe(pagina)) <= 390, '[Gerencia 390] el anulado está en «Anulados», sin deslizar de costado')
  await captura(pagina, 'tramites-lista-gerencia-390.png')
  await ir(pagina, `${BASE}/tramites/${tr2?.id}`)
  comprobar((await anchoDe(pagina)) <= 390, `[Gerencia 390] la ficha no se desliza de costado (${await anchoDe(pagina)} px)`)
  await captura(pagina, 'tramites-ficha-anulado-gerencia-390.png')
  comprobar(errores.length === 0, `[Gerencia 390] sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================================ 4. Administración consulta
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.administracion)
  await ir(pagina, `${BASE}/tramites`)
  comprobar((await pagina.locator(`[data-tramite="${tr1?.numero}"]`).count()) === 1 && (await pagina.getByRole('button', { name: 'Registrar trámite' }).count()) === 0, '[Administración 1440] ve el trámite, sin «Registrar trámite»')
  comprobar(/Solo consulta/.test(limpio(await pagina.locator('main').innerText())), '[Administración 1440] la pantalla dice «Solo consulta»')
  await ir(pagina, `${BASE}/tramites?vista=anulados`)
  comprobar((await pagina.locator(`[data-tramite="${tr2?.numero}"]`).count()) === 1, '[Administración 1440] ve también el de la empresa, anulado')
  await ir(pagina, `${BASE}/tramites/${tr1?.id}`)
  comprobar((await pagina.getByRole('button', { name: /Actualizar|Pedir anulación|Aprobar/ }).count()) === 0, '[Administración 1440] en la ficha no tiene botones')
  await captura(pagina, 'tramites-ficha-administracion-1440.png')
  comprobar(errores.length === 0, `[Administración 1440] sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================================ 5. Ventas ve solo los de una unidad
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.ventas)
  await ir(pagina, `${BASE}/`)
  comprobar(/Trámites/.test(await textoDelMenu(pagina)), '[Ventas 1440] «Trámites» está en su menú')
  await ir(pagina, `${BASE}/tramites`)
  comprobar((await pagina.locator(`[data-tramite="${tr1?.numero}"]`).count()) === 1, '[Ventas 1440] ve el de la unidad')
  const ambitos = await consulta(`select distinct ambito from public.tramites where numero = any($1)`, [
    await pagina.locator('[data-tramite]').evaluateAll((fs) => fs.map((f) => f.getAttribute('data-tramite'))),
  ])
  comprobar(ambitos.every((a) => a.ambito === 'UNIDAD'), '[Ventas 1440] en su lista solo hay trámites de una unidad')
  await ir(pagina, `${BASE}/tramites?vista=anulados`)
  comprobar((await pagina.locator(`[data-tramite="${tr2?.numero}"]`).count()) === 0, '[Ventas 1440] el de la empresa no sale')
  comprobar((await pagina.locator('#tipos-de-tramite').count()) === 0 && (await pagina.getByRole('button', { name: 'Registrar trámite' }).count()) === 0, '[Ventas 1440] sin catálogo y sin «Registrar trámite»')
  await captura(pagina, 'tramites-lista-ventas-1440.png')
  // Con loading.tsx la respuesta ya salió en 200 cuando la ficha llama a notFound(): se mira lo que se pinta.
  await ir(pagina, `${BASE}/tramites/${tr2?.id}`)
  const titulo = limpio(await pagina.locator('h1').first().innerText().catch(() => ''))
  const cuerpo = await pagina.locator('main').innerText().catch(() => '')
  comprobar(
    titulo === 'No encontramos lo que buscas' && !cuerpo.includes(tr2?.numero ?? '—') && !cuerpo.includes(ASUNTO_EMPRESA),
    `[Ventas 1440] el de la empresa, ni por su dirección: «${titulo}», sin su número ni su asunto`,
  )
  await ir(pagina, `${BASE}/tramites/${tr1?.id}`)
  comprobar((await pagina.getByRole('button', { name: /Actualizar|Pedir anulación|Aprobar/ }).count()) === 0, '[Ventas 1440] en la ficha del de la unidad no tiene botones')
  comprobar(errores.filter((e) => !/404/.test(e)).length === 0, `[Ventas 1440] sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================================ 6. Tesorería no entra
{
  const { pagina, contexto } = await entrar(CUENTAS.tesoreria)
  await ir(pagina, `${BASE}/`)
  comprobar(!/Trámites/.test(await textoDelMenu(pagina)), '[Tesorería 1440] «Trámites» no está en su menú')
  await ir(pagina, `${BASE}/tramites`)
  comprobar(new URL(pagina.url()).pathname === '/sin-permiso', `[Tesorería 1440] por su dirección va a «Sin permiso» (${new URL(pagina.url()).pathname})`)
  await ir(pagina, `${BASE}/tramites/${tr1?.id}`)
  comprobar(new URL(pagina.url()).pathname === '/sin-permiso', '[Tesorería 1440] y la ficha, igual')
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length === 0 ? '\nTodo en orden.' : `\n${fallas.length} FALLA(S):\n- ${fallas.join('\n- ')}`)
process.exit(fallas.length === 0 ? 0 : 1)
