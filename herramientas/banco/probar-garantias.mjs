/**
 * El reclamo de garantía (plan «Las demás áreas», entrega A.2, migraciones
 * 20261126950000 y 20261126951000), con clic real y la cuenta de cada puesto
 * (nunca ADMIN):
 *
 *   1. Ventas, en el monitor: «Garantías» en su menú. Registra el reclamo de una
 *      unidad con una descripción corta: tres toques dan un envío, la base lo
 *      rechaza, el cursor va al aviso y lo escrito sigue. Corrige, pone una foto
 *      y envía tres veces: entra un solo reclamo RG, con su foto, y el verde
 *      dice que le llegó a Administración.
 *   2. Administración: el globo de su menú cuenta el reclamo; en su ficha,
 *      «Abrir su OT de garantía» lleva a la orden sin cotización con el tipo, el
 *      cliente, la unidad y lo que reclama puestos. La registra con su número y
 *      su PDF: vuelve al reclamo, con su OT enlazada y «En el taller».
 *   3. Gerencia aprueba la OT y Administración da la garantía por terminada
 *      (en SQL, cada uno con su cuenta y `set local role authenticated`): a
 *      Calidad le llega el aviso.
 *   4. Calidad, en el celular: anota la causa (tres toques, una vez) y el
 *      reclamo queda cerrado con su causa.
 *   5. Ventas registra otro y lo anula con su motivo; Administración cierra un
 *      tercero como «No procede».
 *   6. Gerencia consulta todo, sin «Registrar» ni botones en la ficha.
 *   7. Tesorería: sin Garantías en el menú, y por su dirección no ve nada.
 *
 * Deja en el banco los reclamos y la OT: un documento numerado no se borra.
 *
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
  ventas: 'ventas.local@metalwork.test',
  administracion: 'administracion.local@metalwork.test',
  calidad: 'calidad.local@metalwork.test',
  gerencia: 'gerencia.local@metalwork.test',
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

// ------------------------------------------------------------ la unidad que vuelve
const [unidad] = await consulta(
  `select u.id, u.placa, u.cliente_id, c.razon_social
     from public.unidades u join public.clientes c on c.id = u.cliente_id
    where u.activo and u.placa is not null and nullif(btrim(u.codigo_interno), '') is distinct from 'TODOS LOS ACTIVOS'
    order by u.placa limit 1`,
)
if (!unidad) throw new Error('El banco no trae ninguna unidad con placa y cliente.')

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
    if (r.method() === 'POST' && r.headers()['next-action'] && /operacion_id|motivo|detalle|orden_id/.test(r.postData() ?? '')) acciones.n++
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

const textoDelMenu = async (pagina) => limpio(await pagina.locator('nav').first().innerText().catch(() => ''))
const ventanaDe = (pagina) => pagina.locator('[role="dialog"]', { has: pagina.locator('form') }).last()
const verdeDe = (pagina) => pagina.locator('p[role="status"]').first().innerText().catch(() => '')
const avisosDe = (correo, id) =>
  consulta(
    `select n.titulo from public.notificaciones n join public.usuarios u on u.id = n.usuario_id
      where u.correo = $1 and n.origen_tabla = 'garantia_reclamos' and n.origen_id = $2`,
    [correo, id],
  )
const reclamo = async (id) => (await consulta(`select * from public.garantia_reclamos where id = $1`, [id]))[0] ?? null

const sello = Date.now().toString().slice(-6)
const foto = join(CAPTURAS, `garantia-foto-${sello}.jpg`)
const pdf = join(CAPTURAS, `garantia-ot-${sello}.pdf`)
writeFileSync(pdf, `%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% OT de garantía de prueba ${sello}\ntrailer << /Root 1 0 R >>\n%%EOF\n`)
{
  const p = await (await navegador.newContext()).newPage()
  const b64 = await p.evaluate(async () => {
    const c = document.createElement('canvas')
    c.width = 800
    c.height = 600
    const g = c.getContext('2d')
    g.fillStyle = '#6b5b4e'
    g.fillRect(0, 0, 800, 600)
    g.fillStyle = '#fff'
    g.font = '32px sans-serif'
    g.fillText(`Compuerta que no cierra ${Math.random()}`, 30, 80)
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
    const b = new Uint8Array(await blob.arrayBuffer())
    let s = ''
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
    return btoa(s)
  })
  writeFileSync(foto, Buffer.from(b64, 'base64'))
  await p.context().close()
}

const QUE_RECLAMA = `La compuerta trasera no cierra y entra agua a la tolva cuando llueve (${sello}).`

/** Ventas abre la ventana, elige la unidad y escribe lo que reclama. */
async function abrirElRegistro(pagina, descripcion) {
  await pagina.getByRole('button', { name: 'Registrar reclamo' }).click()
  const v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('#reclamo-unidad').click()
  await pagina.getByPlaceholder('Placa, código interno o cliente…').fill(unidad.placa)
  await pagina.getByRole('option', { name: new RegExp(unidad.placa) }).first().click()
  await v.locator('#reclamo-descripcion').evaluate((el) => el.removeAttribute('minlength'))
  await v.locator('#reclamo-descripcion').fill(descripcion)
  return v
}

let rg = null

// ============================================================ 1. Ventas registra
{
  const { pagina, contexto, errores, acciones, yo } = await entrar(CUENTAS.ventas)
  await ir(pagina, `${BASE}/`)
  const menu = await textoDelMenu(pagina)
  comprobar(/Garantías/.test(menu), `[Ventas 1440] «Garantías» está en su menú: «${menu.slice(0, 160)}»`)
  await ir(pagina, `${BASE}/garantias`)
  comprobar((await pagina.getByRole('heading', { name: 'Reclamos de garantía' }).count()) === 1, '[Ventas 1440] abre «Reclamos de garantía»')

  const v = await abrirElRegistro(pagina, 'Corto')
  comprobar(/Cliente: .+/.test(limpio(await v.locator('[data-cliente-de-la-unidad]').innerText().catch(() => ''))), '[Ventas 1440] al elegir la unidad, dice de qué cliente es')
  const enviar = v.getByRole('button', { name: 'Registrar el reclamo' })
  const antes = acciones.n
  await tresToques(enviar)
  const aviso = await hasta(() => v.locator('#reclamo-error').innerText().catch(() => ''), (t) => /10/.test(t))
  await quieta(pagina)
  comprobar(acciones.n - antes === 1, `[Ventas 1440] tres toques con una descripción corta: ${acciones.n - antes} envío`)
  comprobar(/al menos 10/.test(aviso), `[Ventas 1440] el rechazo se dice: «${limpio(aviso)}»`)
  comprobar(await hasta(() => pagina.evaluate(() => document.activeElement?.id === 'reclamo-error'), Boolean, 5000), '[Ventas 1440] el cursor va al aviso')
  comprobar((await v.locator('#reclamo-descripcion').inputValue()) === 'Corto', '[Ventas 1440] lo escrito sigue en el campo')

  await v.locator('#reclamo-descripcion').fill(QUE_RECLAMA)
  await v.locator('#reclamo-trae').fill('Chofer Juan Quispe')
  await v.locator('#reclamo-contacto').fill('999 111 222')
  await v.locator('input[type="file"]:not([capture])').setInputFiles(foto)
  await pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })
  await hasta(() => enviar.isEnabled(), Boolean, 30000)
  await pagina.screenshot({ path: join(CAPTURAS, 'a2-ventas-registrar-1440.png') })
  const antesDelBueno = acciones.n
  await tresToques(enviar)
  const verde = await hasta(() => verdeDe(pagina), (t) => /registrado/.test(t), 30000)
  await quieta(pagina)
  const entraron = await consulta(`select * from public.garantia_reclamos where descripcion = $1`, [QUE_RECLAMA])
  rg = entraron[0] ?? null
  comprobar(entraron.length === 1 && acciones.n - antesDelBueno === 1, `[Ventas 1440] tres toques con todo bien: ${entraron.length} reclamo y ${acciones.n - antesDelBueno} envío`)
  comprobar(/^RG-\d{4}-\d{4}$/.test(rg?.numero ?? '') && rg?.estado === 'REGISTRADO' && rg?.registrado_por === yo.id && rg?.cliente_id === unidad.cliente_id, `[Ventas 1440] entró ${rg?.numero}, registrado, a su nombre y con el cliente de la unidad`)
  comprobar(rg?.trae === 'Chofer Juan Quispe' && rg?.contacto === '999 111 222', '[Ventas 1440] con quién lo trae y su contacto')
  comprobar(/Administración/.test(verde), `[Ventas 1440] el verde dice a quién le llegó: «${limpio(verde)}»`)
  const fotos = await consulta(`select ruta from public.garantia_reclamo_fotos where reclamo_id = $1`, [rg?.id])
  const enStorage = await consulta(`select 1 from storage.objects where bucket_id = 'fotos-garantias' and name = $1`, [fotos[0]?.ruta ?? ''])
  comprobar(fotos.length === 1 && enStorage.length === 1 && fotos[0].ruta.startsWith(`${yo.id}/${rg?.id}/`), '[Ventas 1440] la foto quedó anotada y en Storage, en su carpeta')
  const sueltas = await consulta(
    `select count(*)::int as n from storage.objects o where o.bucket_id = 'fotos-garantias' and o.name like $1
        and not exists (select 1 from public.garantia_reclamo_fotos f where f.ruta = o.name)`,
    [`${yo.id}/%`],
  )
  comprobar(sueltas[0].n === 0, '[Ventas 1440] ninguna foto suelta en Storage')
  await ir(pagina, `${BASE}/garantias`)
  const fila = pagina.locator(`[data-reclamo="${rg?.numero}"]`)
  comprobar((await fila.count()) === 1 && /Espera su OT/.test(await fila.innerText()), '[Ventas 1440] la lista lo muestra «Espera su OT» en «Abiertos»')
  await pagina.screenshot({ path: join(CAPTURAS, 'a2-ventas-lista-1440.png'), fullPage: true })
  comprobar(errores.length === 0, `[Ventas 1440] sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.ventas, CELULAR)
  await ir(pagina, `${BASE}/garantias`)
  await pagina.screenshot({ path: join(CAPTURAS, 'a2-ventas-lista-390.png'), fullPage: true })
  await ir(pagina, `${BASE}/garantias/${rg?.id}`)
  const fotoVista = await hasta(() => pagina.locator('main img').first().evaluate((i) => i.complete && i.naturalWidth > 0).catch(() => false), Boolean, 15000)
  comprobar(fotoVista, '[Ventas 390] ve la foto en la ficha')
  comprobar((await pagina.getByRole('button', { name: 'Anular' }).count()) === 1 && (await pagina.getByRole('link', { name: 'Abrir su OT de garantía' }).count()) === 0, '[Ventas 390] puede anularlo, no abrir su OT')
  await pagina.screenshot({ path: join(CAPTURAS, 'a2-ventas-ficha-390.png'), fullPage: true })
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `[Ventas 390] la ficha no se desliza de costado (${ancho} px)`)
  comprobar(errores.length === 0, `[Ventas 390] sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}
comprobar((await avisosDe(CUENTAS.administracion, rg?.id)).length === 1, '[Administración] le llegó un aviso del reclamo')
comprobar((await avisosDe(CUENTAS.gerencia, rg?.id)).length === 0, '[Gerencia] con Administración activa, a Gerencia no le llegó')

// ============================================================ 2. Administración abre su OT
let numeroOt = null
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.administracion)
  await ir(pagina, `${BASE}/`)
  const globo = (await pagina.locator('nav a[aria-label^="Garantías, "]').first().getAttribute('aria-label').catch(() => null)) ?? ''
  comprobar(/\d+ pendientes?/.test(globo), `[Administración 1440] su menú cuenta el reclamo que espera su OT: «${globo}»`)
  await ir(pagina, `${BASE}/garantias/${rg?.id}`)
  comprobar(/Te toca/.test(limpio(await pagina.locator('[data-que-sigue]').innerText().catch(() => ''))), '[Administración 1440] la ficha dice que le toca')
  comprobar((await pagina.getByRole('button', { name: 'No procede' }).count()) === 1 && (await pagina.getByRole('button', { name: 'Anular' }).count()) === 1, '[Administración 1440] puede decir que no procede o anularlo')
  await pagina.screenshot({ path: join(CAPTURAS, 'a2-administracion-ficha-1440.png'), fullPage: true })
  await pagina.getByRole('link', { name: 'Abrir su OT de garantía' }).click()
  await pagina.waitForURL((u) => u.pathname === '/ordenes/nueva', { timeout: 20000 })
  await quieta(pagina)
  const desde = await pagina.locator('[data-desde-el-reclamo]').waitFor({ timeout: 20000 }).then(() => true, () => false)
  if (!desde) await pagina.screenshot({ path: join(CAPTURAS, 'a2-falla-ot-nueva.png'), fullPage: true })
  comprobar(desde, '[Administración 1440] la orden nueva dice que atiende el reclamo')
  // Fijos, no editables: con otra unidad u otro tipo la OT numerada quedaba registrada y sin enlazar.
  comprobar((await pagina.locator('input[type="hidden"][name="tipo_trabajo"]').inputValue()) === 'GARANTIA'
            && (await pagina.locator('#tipo_trabajo').count()) === 0, '[Administración 1440] nace como garantía, sin poder cambiarla')
  comprobar((await pagina.locator('input[type="hidden"][name="cliente_id"]').inputValue()) === unidad.cliente_id
            && (await pagina.locator('select[name="cliente_id"]').count()) === 0, '[Administración 1440] con el cliente del reclamo, fijo')
  comprobar((await pagina.locator('input[type="hidden"][name="unidad_id"]').inputValue()) === unidad.id
            && limpio(await pagina.locator('[data-fijos-del-reclamo]').innerText()).includes(unidad.placa), '[Administración 1440] con la unidad del reclamo, fija y a la vista')
  comprobar((await pagina.locator(`[data-desde-el-reclamo] a[href="/garantias/${rg?.id}"]`).count()) === 1, '[Administración 1440] el número del reclamo lleva de vuelta a él')
  comprobar((await pagina.locator('#descripcion').inputValue()).startsWith(`Garantía del reclamo ${rg?.numero}:`), '[Administración 1440] con lo que reclama en la descripción')
  for (let n = 0; n < 50 && !numeroOt; n++) {
    const candidato = String(800000 + Math.floor(Math.random() * 99999))
    if ((await consulta(`select 1 from public.ordenes_trabajo where numero like $1`, [`${candidato}-%`])).length === 0) numeroOt = candidato
  }
  await pagina.locator('#numero').fill(numeroOt)
  await pagina.locator('#pdf_orden').setInputFiles(pdf)
  await pagina.screenshot({ path: join(CAPTURAS, 'a2-administracion-ot-nueva-1440.png'), fullPage: true })
  await pagina.locator('form button[type="submit"]').last().click()
  await pagina.waitForURL((u) => u.pathname === `/garantias/${rg?.id}`, { timeout: 60000 })
  await quieta(pagina)
  const r = await reclamo(rg?.id)
  const [ot] = await consulta(`select id, numero, tipo_trabajo::text, unidad_id, estado::text from public.ordenes_trabajo where id = $1`, [r?.orden_id])
  comprobar(r?.estado === 'CON_OT' && ot?.tipo_trabajo === 'GARANTIA' && ot?.unidad_id === unidad.id && ot?.numero.startsWith(numeroOt), `[Administración 1440] la OT ${ot?.numero} quedó enlazada al reclamo, de garantía y de su unidad`)
  const situacion = await pagina.locator('[data-situacion]').first().getAttribute('data-situacion')
  comprobar(situacion === 'EN_TALLER', `[Administración 1440] vuelve al reclamo, «En el taller» (${situacion})`)
  comprobar((await pagina.locator('[data-ot-del-reclamo]').innerText()).includes(ot?.numero ?? '¿?'), '[Administración 1440] la ficha muestra su OT')
  comprobar((await pagina.getByRole('button', { name: /Anular|No procede/ }).count()) === 0, '[Administración 1440] con su OT ya no se anula ni es «No procede»')
  await pagina.screenshot({ path: join(CAPTURAS, 'a2-administracion-con-ot-1440.png'), fullPage: true })
  comprobar((await avisosDe(CUENTAS.ventas, rg?.id)).length === 1, '[Ventas] le llegó que su reclamo tiene OT')
  comprobar(errores.length === 0, `[Administración 1440] sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================================ 3. La garantía se termina
{
  const r = await reclamo(rg?.id)
  // Como en el uso real: Gerencia la aprueba, y Administración la da por terminada cuando el taller avisa.
  await como(CUENTAS.gerencia, `update public.ordenes_trabajo set estado = 'APROBADA' where id = $1`, [r.orden_id])
  await como(CUENTAS.administracion, `select public.dar_por_terminada_la_garantia($1, $2)`, [r.orden_id, 'Bisagra cambiada y compuerta ajustada'])
  comprobar((await avisosDe(CUENTAS.calidad, rg?.id)).length === 1, '[Calidad] al terminar la garantía, le llegó que anote la causa')
}

// ============================================================ 4. Calidad anota la causa
{
  const { pagina, contexto, errores, acciones } = await entrar(CUENTAS.calidad, CELULAR)
  await ir(pagina, `${BASE}/garantias`)
  const fila = pagina.locator(`[data-reclamo="${rg?.numero}"]`)
  comprobar((await fila.count()) === 1 && (await fila.getAttribute('data-le-toca')) !== null && /Espera la causa/.test(await fila.innerText()), '[Calidad 390] lo ve arriba, «Te toca» y «Espera la causa»')
  await pagina.screenshot({ path: join(CAPTURAS, 'a2-calidad-lista-390.png'), fullPage: true })
  await ir(pagina, `${BASE}/garantias/${rg?.id}`)
  await pagina.getByRole('button', { name: 'Anotar la causa' }).click()
  const v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('input[name="causa"][value="FABRICACION"]').check()
  await v.locator('textarea[name="detalle"]').fill(`La bisagra se soldó con un solo cordón y se abrió con la vibración (${sello}).`)
  await pagina.screenshot({ path: join(CAPTURAS, 'a2-calidad-causa-390.png') })
  const antes = acciones.n
  await tresToques(v.getByRole('button', { name: 'Anotar y cerrar' }))
  const verde = await hasta(() => pagina.locator('p[role="status"]').filter({ hasText: /Causa anotada/ }).first().innerText().catch(() => ''), (t) => /Causa anotada/.test(t), 30000)
  await quieta(pagina)
  const r = await reclamo(rg?.id)
  comprobar(r?.estado === 'CERRADO' && r?.causa === 'FABRICACION' && acciones.n - antes === 1, `[Calidad 390] tres toques: ${acciones.n - antes} envío, y quedó cerrado con su causa`)
  comprobar(/cerrado/.test(verde), `[Calidad 390] el verde lo dice: «${limpio(verde)}»`)
  const conCausa = await pagina.locator('[data-causa]').waitFor({ timeout: 20000 }).then(() => true, () => false)
  comprobar(conCausa, '[Calidad 390] la ficha muestra la causa')
  await pagina.screenshot({ path: join(CAPTURAS, 'a2-calidad-cerrado-390.png'), fullPage: true })
  comprobar((await avisosDe(CUENTAS.ventas, rg?.id)).length === 2, '[Ventas] le llegó que se cerró con su causa')
  comprobar(errores.length === 0, `[Calidad 390] sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================================ 5. Anular y «No procede»
let anulado = null
let noProcede = null
{
  const { pagina, contexto, errores, acciones } = await entrar(CUENTAS.ventas)
  await ir(pagina, `${BASE}/garantias`)
  const texto = `La pintura de la tolva se pela por debajo (${sello}).`
  const v = await abrirElRegistro(pagina, texto)
  await v.getByRole('button', { name: 'Registrar el reclamo' }).click()
  await hasta(() => verdeDe(pagina), (t) => /registrado/.test(t), 30000)
  await quieta(pagina)
  anulado = (await consulta(`select * from public.garantia_reclamos where descripcion = $1`, [texto]))[0] ?? null
  await ir(pagina, `${BASE}/garantias/${anulado?.id}`)
  await pagina.getByRole('button', { name: 'Anular' }).click()
  const w = ventanaDe(pagina)
  await w.waitFor({ timeout: 15000 })
  await w.locator('textarea[name="motivo"]').fill(`Se registró dos veces el mismo reclamo (${sello}).`)
  const antes = acciones.n
  await tresToques(w.getByRole('button', { name: 'Anular', exact: true }))
  await hasta(() => pagina.locator('p[role="status"]').filter({ hasText: /anulado/ }).count(), (n) => n > 0, 30000)
  await quieta(pagina)
  const r = await reclamo(anulado?.id)
  comprobar(r?.estado === 'ANULADO' && r?.anulado_por !== null && acciones.n - antes === 1, `[Ventas 1440] lo anula con su motivo, una vez (${acciones.n - antes} envío)`)
  comprobar((await pagina.locator('[data-anulado]').count()) === 1, '[Ventas 1440] la ficha dice quién, cuándo y por qué')
  comprobar(errores.length === 0, `[Ventas 1440] sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}
{
  const id = crypto.randomUUID()
  await como(CUENTAS.ventas, `select * from public.garantias_registrar($1, $2, $3, null, null, '[]')`, [id, unidad.id, `El piso de la tolva se dobló con la carga (${sello}).`])
  const { pagina, contexto, errores } = await entrar(CUENTAS.administracion)
  await ir(pagina, `${BASE}/garantias/${id}`)
  await pagina.getByRole('button', { name: 'No procede' }).click()
  const v = ventanaDe(pagina)
  await v.waitFor({ timeout: 15000 })
  await v.locator('textarea[name="motivo"]').fill('Cargó el doble de lo que soporta la tolva: no es un defecto del trabajo.')
  await v.getByRole('button', { name: 'Cerrar como «No procede»' }).click()
  await hasta(() => pagina.locator('p[role="status"]').filter({ hasText: /No procede/ }).count(), (n) => n > 0, 30000)
  await quieta(pagina)
  noProcede = await reclamo(id)
  comprobar(noProcede?.estado === 'NO_PROCEDE' && (await pagina.locator('[data-no-procede]').count()) === 1, '[Administración 1440] lo cierra como «No procede», con su motivo a la vista')
  comprobar(errores.length === 0, `[Administración 1440] sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================================ 6. Gerencia consulta
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  await ir(pagina, `${BASE}/garantias?vista=cerrados`)
  comprobar((await pagina.getByRole('button', { name: 'Registrar reclamo' }).count()) === 0, '[Gerencia 1440] no registra')
  comprobar(/Solo consulta/.test(limpio(await pagina.locator('main').innerText())), '[Gerencia 1440] la pantalla dice «Solo consulta»')
  comprobar((await pagina.locator(`[data-reclamo="${rg?.numero}"]`).count()) === 1 && (await pagina.locator(`[data-reclamo="${noProcede?.numero}"]`).count()) === 1, '[Gerencia 1440] ve el cerrado con su causa y el que no procede')
  await pagina.screenshot({ path: join(CAPTURAS, 'a2-gerencia-cerrados-1440.png'), fullPage: true })
  await ir(pagina, `${BASE}/garantias/${rg?.id}`)
  comprobar((await pagina.getByRole('button', { name: /Anular|No procede|Anotar la causa|Enlazar/ }).count()) === 0 && (await pagina.getByRole('link', { name: 'Abrir su OT de garantía' }).count()) === 0, '[Gerencia 1440] en la ficha, ningún botón: solo consulta')
  await pagina.screenshot({ path: join(CAPTURAS, 'a2-gerencia-ficha-1440.png'), fullPage: true })
  comprobar(errores.length === 0, `[Gerencia 1440] sin errores de consola ${errores.join(' | ')}`)
  await contexto.close()
}

// ============================================================ 7. Tesorería no ve nada
{
  const { pagina, contexto } = await entrar(CUENTAS.tesoreria)
  await ir(pagina, `${BASE}/`)
  comprobar(!/Garantías/.test(await textoDelMenu(pagina)), '[Tesorería 1440] sin Garantías en su menú')
  // Por su dirección, «Sin permiso»: ni una lista vacía que promete reclamos, ni la ficha.
  await ir(pagina, `${BASE}/garantias`)
  comprobar(new URL(pagina.url()).pathname === '/sin-permiso' && (await pagina.locator('[data-reclamo]').count()) === 0,
    `[Tesorería 1440] por su dirección, la lista la lleva a «Sin permiso» (${new URL(pagina.url()).pathname})`)
  await ir(pagina, `${BASE}/garantias/${rg?.id}`)
  comprobar(new URL(pagina.url()).pathname === '/sin-permiso' && !limpio(await pagina.locator('main').innerText()).includes(QUE_RECLAMA),
    '[Tesorería 1440] la ficha también')
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} comprobación(es) fallaron.` : '\nTodo bien: Ventas registra, Administración abre su OT, Calidad anota la causa y cada quien ve lo suyo.')
process.exit(fallas.length ? 1 : 0)
