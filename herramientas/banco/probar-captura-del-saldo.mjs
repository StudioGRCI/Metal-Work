/**
 * Recorre con clic real lo que DKS pidió el 2026-10-20 para Tesorería y
 * Contabilidad (migraciones 20261020174500 y 20261020174600), con la cuenta de
 * cada puesto (nunca ADMIN):
 *
 *   1. Los menús: Tesorería empieza por Adquisiciones y después Caja diaria, sin
 *      el tipo de cambio; Contabilidad empieza por Adquisiciones, encima de
 *      Facturación, lleva Proveedores y Tipo de cambio en Consultas y no tiene
 *      Cotización ni Requerimientos. En el monitor y en el teléfono.
 *   2. Contabilidad no entra a los requerimientos por su dirección, y en
 *      Adquisiciones el número de RQ ya no la lleva ahí. Registra el tipo de
 *      cambio; Tesorería ya no entra a esa pantalla.
 *   3. Caja diaria: un banco nuevo no se da de alta sin la captura del saldo.
 *      Con ella, tres toques dejan una cuenta y un archivo, la cuenta la
 *      nombra y «Ver la captura del saldo» la abre. Un nombre repetido no deja
 *      el archivo suelto.
 *   4. La caja chica entra sin captura y la adjunta después; un banco de antes
 *      sin captura avisa y la adjunta con «Corregir»; sin movimientos la
 *      captura se cambia y la vieja se quita; con movimientos ya no se ofrece.
 *   5. Contabilidad y Gerencia no abren la captura por su enlace.
 *   6. En el teléfono la ventana entra sin desbordarse.
 *
 * El banco no aplica las políticas de Storage (ver `diseno` › Comprobación
 * visual): aquí se mira `storage.objects` después de cada clic, y las políticas
 * las prueba el check 404 con `set local role authenticated`.
 *
 * Necesita las cuentas `*.local@metalwork.test` de Tesorería, Contabilidad y
 * Gerencia. Las cuentas de la caja las crea el script, con un nombre distinto
 * en cada corrida.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  tesoreria: process.env.TESORERIA ?? 'tesoreria.local@metalwork.test',
  contabilidad: process.env.CONTABILIDAD ?? 'contabilidad.local@metalwork.test',
  gerencia: process.env.GERENCIA ?? 'gerencia.local@metalwork.test',
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
async function hasta(leer, cumple, ms = 15000) {
  const fin = Date.now() + ms
  let v = await leer()
  while (!cumple(v) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 250))
    v = await leer()
  }
  return v
}

// Los archivos que «saca» Tesorería del aplicativo: una imagen y un PDF de verdad, pequeños.
const PNG = join(CAPTURAS, 'saldo-aplicativo.png')
const PDF = join(CAPTURAS, 'saldo-aplicativo.pdf')
const JPG = join(CAPTURAS, 'conteo-caja-chica.jpg')
writeFileSync(PNG, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
writeFileSync(PDF, '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
writeFileSync(
  JPG,
  Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
    'base64',
  ),
)

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const CELULAR = { width: 390, height: 844 }

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

async function esperarVentana(pagina) {
  const v = pagina.locator('[role="dialog"]')
  await Promise.race([
    v.waitFor({ state: 'hidden', timeout: 30000 }),
    v.locator('[role="alert"]').waitFor({ timeout: 30000 }),
  ]).catch(() => {})
  const error = limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
  await pagina.waitForLoadState('networkidle')
  return error
}

/** El menú del monitor, grupo por grupo, con las rutas en su orden. */
async function menu(pagina) {
  return pagina.locator('nav[aria-label="Menú principal"] > div').evaluateAll((grupos) =>
    grupos.map((g) => ({
      titulo: g.querySelector('p')?.textContent?.trim() ?? '',
      rutas: [...g.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
    })),
  )
}
const pestanas = (pagina) =>
  pagina.locator('nav[aria-label="Secciones"] a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')))

const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date())
const ayer = new Date(Date.parse(`${hoy}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)
const hace40 = new Date(Date.parse(`${hoy}T12:00:00Z`) - 40 * 86400000).toISOString().slice(0, 10)
const sello = Date.now().toString().slice(-6)
const BANCO = `Interbank soles ${sello}`
const CHICA = `Caja chica ${sello}`
const ANTIGUO = `BBVA de antes ${sello}`
const RUTA = `${BASE}/tesoreria/caja-diaria`

const cuenta = async (nombre) =>
  (await consulta('select id, tipo, saldo_inicial::float as saldo, apertura_ruta from cajas where nombre = $1', [nombre]))[0]
const objetos = (prefijo) =>
  consulta(`select name, owner_id, metadata->>'mimetype' as tipo from storage.objects where bucket_id = 'apertura-caja' and name like $1`, [`${prefijo}%`])
const idDe = async (correo) => (await consulta('select id from usuarios where correo = $1', [correo]))[0]?.id

async function abrirAlta(pagina) {
  const seccion = pagina.locator('details', { hasText: 'Cuentas de Tesorería' })
  if (await seccion.count()) await seccion.evaluate((d) => (d.open = true))
  await pagina.locator('[data-agregar-cuenta]:visible').first().click()
  return pagina.locator('[role="dialog"]')
}
async function llenarAlta(v, { nombre, tipo, banco, saldo }) {
  await v.locator('input[name="nombre"]').fill(nombre)
  await v.locator('select[name="tipo"]').selectOption(tipo)
  if (banco) await v.locator('input[name="banco"]').fill(banco)
  await v.locator('select[name="moneda"]').selectOption('PEN')
  await v.locator('input[name="saldo_inicial"]').fill(saldo)
  await v.locator('input[name="fecha_inicio"]').fill(ayer)
}
async function abrirCorregir(pagina, nombre) {
  const seccion = pagina.locator('details', { hasText: 'Cuentas de Tesorería' })
  if (await seccion.count()) await seccion.evaluate((d) => (d.open = true))
  await pagina.locator(`[data-editar-cuenta="${nombre}"]`).click()
  return pagina.locator('[role="dialog"]')
}

const idTesoreria = await idDe(CUENTAS.tesoreria)
comprobar(Boolean(idTesoreria), 'la cuenta local de Tesorería existe')

// ------------------------------------------------------ 1. los menús
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.tesoreria)
  const grupos = await menu(pagina)
  const suyo = grupos.find((g) => g.titulo === 'Tesorería')?.rutas ?? []
  comprobar(suyo[0] === '/adquisiciones' && suyo[1] === '/tesoreria/caja-diaria', `Tesorería empieza por Adquisiciones y después Caja diaria (${suyo.slice(0, 3).join(', ')})`)
  comprobar(!grupos.some((g) => g.rutas.includes('/tesoreria/tipo-de-cambio')), 'Tesorería ya no tiene Tipo de cambio en el menú')
  await pagina.goto(`${BASE}/tesoreria/tipo-de-cambio`, { waitUntil: 'networkidle' })
  comprobar(new URL(pagina.url()).pathname === '/sin-permiso', `Tesorería no entra al tipo de cambio por su dirección (${new URL(pagina.url()).pathname})`)
  comprobar(errores.length === 0, `Tesorería sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.tesoreria, CELULAR)
  const tabs = await pestanas(pagina)
  comprobar(tabs[0] === '/adquisiciones' && tabs[1] === '/tesoreria/caja-diaria', `en el teléfono de Tesorería, Adquisiciones y Caja primero (${tabs.join(', ')})`)
  await contexto.close()
}
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.contabilidad)
  const grupos = await menu(pagina)
  const suyo = grupos.find((g) => g.titulo === 'Contabilidad')?.rutas ?? []
  const consultas = grupos.find((g) => g.titulo === 'Consultas')?.rutas ?? []
  console.log(`    menú de Contabilidad: ${grupos.map((g) => `${g.titulo}: ${g.rutas.join(' ')}`).join(' | ')}`)
  comprobar(
    JSON.stringify(suyo) === JSON.stringify(['/adquisiciones', '/contabilidad/facturacion', '/compras/gestion', '/compras/servicios']),
    'Contabilidad: Adquisiciones encima de Facturación, después Gestión de compras y Órdenes de servicio',
  )
  comprobar(consultas.includes('/proveedores') && consultas.includes('/tesoreria/tipo-de-cambio'), 'Proveedores y Tipo de cambio van en Consultas')
  const todas = grupos.flatMap((g) => g.rutas)
  comprobar(!todas.includes('/cotizaciones/pdf'), 'Contabilidad ya no tiene Cotización en el menú')
  comprobar(!todas.some((r) => r.startsWith('/requerimientos')), 'ni Requerimientos')
  const perfil = limpio(await pagina.locator('section[aria-label="Tu cuenta"]').first().innerText())
  comprobar(!/adquisici/i.test(perfil) && /Contabilidad/.test(perfil), `la cuenta dice Contabilidad, sin Adquisiciones («${perfil}»)`)

  for (const ruta of ['/requerimientos', '/requerimientos/atencion']) {
    await pagina.goto(`${BASE}${ruta}`, { waitUntil: 'networkidle' })
    comprobar(new URL(pagina.url()).pathname === '/sin-permiso', `Contabilidad no entra a ${ruta} por su dirección`)
  }
  await pagina.goto(`${BASE}/adquisiciones`, { waitUntil: 'networkidle' })
  comprobar(limpio(await pagina.locator('h1').textContent()) === 'Adquisiciones', 'Adquisiciones abre con su título')
  comprobar((await pagina.locator('main a[href^="/requerimientos"]').count()) === 0, 'en Adquisiciones el número de RQ ya no lleva a Requerimientos')
  const facturacion = await pagina.goto(`${BASE}/contabilidad/facturacion`, { waitUntil: 'networkidle' })
  comprobar(facturacion?.status() === 200 && new URL(pagina.url()).pathname === '/contabilidad/facturacion', 'Facturación sigue abriendo')

  // El tipo de cambio lo registra ella: un día de hace 40, que ninguna otra prueba usa.
  await pagina.goto(`${BASE}/tesoreria/tipo-de-cambio`, { waitUntil: 'networkidle' })
  comprobar(new URL(pagina.url()).pathname === '/tesoreria/tipo-de-cambio', 'Contabilidad abre el tipo de cambio')
  await pagina.locator('input[name="fecha"]').fill(hace40)
  await pagina.locator('input[name="compra"]').fill('3.701')
  await pagina.locator('input[name="venta"]').fill('3.709')
  await pagina.getByRole('button', { name: 'Guardar cambio' }).click()
  const fila = await hasta(
    async () => (await consulta('select venta::float as venta, u.correo from tipos_de_cambio t join usuarios u on u.id = t.registrado_por where fecha = $1', [hace40]))[0],
    (f) => f?.venta === 3.709,
  )
  comprobar(fila?.venta === 3.709 && fila?.correo === CUENTAS.contabilidad, `Contabilidad registra el cambio del ${hace40} y queda a su nombre (${JSON.stringify(fila)})`)
  comprobar(errores.length === 0, `Contabilidad sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad, CELULAR)
  const tabs = await pestanas(pagina)
  comprobar(tabs[0] === '/adquisiciones' && tabs[1] === '/contabilidad/facturacion', `en el teléfono de Contabilidad, Adquisiciones y después Facturar (${tabs.join(', ')})`)
  await contexto.close()
}

// ------------------------------------------------------ 3. el banco nuevo y su captura
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.tesoreria)
  await pagina.goto(RUTA, { waitUntil: 'networkidle' })
  let v = await abrirAlta(pagina)
  await llenarAlta(v, { nombre: BANCO, tipo: 'BANCO', banco: 'Interbank', saldo: '3500' })
  comprobar(limpio(await v.locator('label', { hasText: 'Captura del saldo en el aplicativo' }).textContent()).length > 0, 'la ventana pide la captura del saldo en el aplicativo')
  await v.getByRole('button', { name: 'Agregar la cuenta' }).click()
  await pagina.waitForTimeout(1500)
  comprobar(await v.isVisible(), 'sin la captura la ventana no se cierra')
  comprobar(!(await cuenta(BANCO)), 'y el banco no se da de alta')

  const antes = (await objetos('')).length
  await v.locator('input[name="captura"]').setInputFiles(PNG)
  const boton = v.getByRole('button', { name: 'Agregar la cuenta' })
  // Tres toques seguidos, como un dedo impaciente: el segundo y el tercero caen sobre el botón ya desactivado.
  for (let i = 0; i < 3; i++) await boton.click({ force: true, timeout: 2000 }).catch(() => {})
  const error = await esperarVentana(pagina)
  comprobar(!error, `con la captura entra${error ? `: ${error}` : ''}`)
  const banco = await hasta(() => cuenta(BANCO), (c) => Boolean(c?.apertura_ruta))
  comprobar(Boolean(banco?.apertura_ruta?.startsWith(`${banco?.id}/`)), `la cuenta nombra su captura, en su carpeta (${banco?.apertura_ruta})`)
  const [obj] = await objetos(banco?.apertura_ruta ?? '-')
  comprobar(obj?.owner_id === idTesoreria && obj?.tipo === 'image/png', 'el archivo está en Storage, subido por Tesorería, como imagen')
  comprobar((await objetos('')).length === antes + 1, `tres toques dejan un solo archivo (${(await objetos('')).length - antes})`)
  comprobar((await consulta('select count(*)::int as n from cajas where nombre = $1', [BANCO]))[0].n === 1, 'y una sola cuenta')

  // «Ver la captura del saldo» la abre: el enlace firmado se pide al tocar.
  const seccion = pagina.locator('details', { hasText: 'Cuentas de Tesorería' })
  const enlace = pagina.locator(`[data-captura-saldo="${BANCO}"]`)
  const hayEnlace = await hasta(async () => {
    if (await seccion.count()) await seccion.evaluate((d) => (d.open = true))
    return enlace.count()
  }, (n) => n === 1)
  comprobar(hayEnlace === 1, 'la cuenta muestra «Ver la captura del saldo»')
  const href = await enlace.getAttribute('href')
  const respuesta = await pagina.request.get(`${BASE}${href}`)
  const cuerpo = await respuesta.body()
  comprobar(respuesta.status() === 200 && cuerpo.equals(readFileSync(PNG)), `el enlace abre la misma imagen que se subió (${respuesta.status()}, ${cuerpo.length} bytes)`)

  // Un nombre repetido no entra, y su captura no se queda suelta en Storage.
  const sueltasAntes = (await objetos('')).length
  v = await abrirAlta(pagina)
  await llenarAlta(v, { nombre: BANCO.toUpperCase(), tipo: 'BANCO', banco: 'Interbank', saldo: '1' })
  await v.locator('input[name="captura"]').setInputFiles(PNG)
  await v.getByRole('button', { name: 'Agregar la cuenta' }).click()
  const repetida = await esperarVentana(pagina)
  comprobar(repetida.includes('Ya hay una cuenta'), `un nombre repetido no entra, con su mensaje (${repetida})`)
  comprobar(await v.locator('input[name="nombre"]').inputValue() === BANCO.toUpperCase(), 'y lo escrito sigue en la ventana')
  comprobar((await hasta(async () => (await objetos('')).length, (n) => n === sueltasAntes)) === sueltasAntes, 'su captura se retiró de Storage')
  await v.getByRole('button', { name: 'Cancelar' }).click()
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------------------ 4. la caja chica, el banco de antes y los cambios
await consulta(
  `insert into cajas (nombre, tipo, banco, moneda, saldo_inicial, fecha_inicio, creado_por)
   select $1, 'BANCO', 'BBVA', 'PEN', 800, $2::date, u.id from usuarios u where u.correo = $3`,
  [ANTIGUO, ayer, CUENTAS.tesoreria],
)
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.tesoreria)
  await pagina.goto(RUTA, { waitUntil: 'networkidle' })

  let v = await abrirAlta(pagina)
  await llenarAlta(v, { nombre: CHICA, tipo: 'EFECTIVO', saldo: '300' })
  comprobar((await v.locator('label', { hasText: 'Foto del conteo' }).count()) === 1, 'para la caja chica la foto del conteo es opcional')
  await v.getByRole('button', { name: 'Agregar la cuenta' }).click()
  let error = await esperarVentana(pagina)
  const chica = await hasta(() => cuenta(CHICA), Boolean)
  comprobar(!error && chica && chica.apertura_ruta === null, `la caja chica entra sin captura${error ? `: ${error}` : ''}`)

  // Un banco de antes, sin captura: avisa, y la adjunta con «Corregir».
  const seccion = pagina.locator('details', { hasText: 'Cuentas de Tesorería' })
  if (await seccion.count()) await seccion.evaluate((d) => (d.open = true))
  comprobar((await pagina.locator(`[data-sin-captura="${ANTIGUO}"]`).count()) === 1, 'el banco de antes avisa que le falta la captura')
  comprobar((await pagina.locator(`[data-sin-captura="${CHICA}"]`).count()) === 0, 'la caja chica no')
  v = await abrirCorregir(pagina, ANTIGUO)
  await v.locator('input[name="captura"]').setInputFiles(PDF)
  await v.getByRole('button', { name: 'Guardar' }).click()
  error = await esperarVentana(pagina)
  const antiguo = await hasta(() => cuenta(ANTIGUO), (c) => Boolean(c?.apertura_ruta))
  comprobar(!error && Boolean(antiguo?.apertura_ruta?.endsWith('.pdf')), `el banco de antes adjunta su captura en PDF${error ? `: ${error}` : ''}`)
  // La lista se repinta un momento después de cerrar la ventana.
  const cambio = await hasta(
    async () => {
      if (await seccion.count()) await seccion.evaluate((d) => (d.open = true))
      return [await pagina.locator(`[data-sin-captura="${ANTIGUO}"]`).count(), await pagina.locator(`[data-captura-saldo="${ANTIGUO}"]`).count()]
    },
    ([aviso, enlace]) => aviso === 0 && enlace === 1,
  )
  comprobar(cambio[0] === 0 && cambio[1] === 1, `y el aviso cambia por «Ver la captura del saldo» (aviso ${cambio[0]}, enlace ${cambio[1]})`)

  // Sin movimientos la captura se cambia, y la vieja deja Storage.
  const vieja = (await cuenta(BANCO)).apertura_ruta
  v = await abrirCorregir(pagina, BANCO)
  comprobar((await v.getByRole('link', { name: 'verla' }).count()) === 1, 'la ventana de corregir enlaza la captura que tiene')
  await v.locator('input[name="captura"]').setInputFiles(PDF)
  await v.getByRole('button', { name: 'Guardar' }).click()
  error = await esperarVentana(pagina)
  const nueva = (await hasta(() => cuenta(BANCO), (c) => c?.apertura_ruta !== vieja)).apertura_ruta
  comprobar(!error && nueva !== vieja && nueva.endsWith('.pdf'), `sin movimientos se cambia la captura${error ? `: ${error}` : ''}`)
  comprobar((await hasta(() => objetos(vieja), (o) => o.length === 0)).length === 0, 'y la vieja sale de Storage')

  // La caja chica adjunta después la foto del conteo.
  v = await abrirCorregir(pagina, CHICA)
  await v.locator('input[name="captura"]').setInputFiles(JPG)
  await v.getByRole('button', { name: 'Guardar' }).click()
  error = await esperarVentana(pagina)
  comprobar(!error && Boolean((await hasta(() => cuenta(CHICA), (c) => Boolean(c?.apertura_ruta))).apertura_ruta?.endsWith('.jpg')),
    `la caja chica adjunta la foto del conteo después${error ? `: ${error}` : ''}`)

  // La caja chica que pasa a banco pide la captura del aplicativo: la foto del conteo no la reemplaza.
  v = await abrirCorregir(pagina, CHICA)
  await v.locator('select[name="tipo"]').selectOption('BANCO')
  await v.locator('input[name="banco"]').fill('BCP')
  comprobar(await v.locator('input[name="captura"]').evaluate((e) => e.required), 'al pasar a banco la captura se vuelve obligatoria')
  await v.getByRole('button', { name: 'Guardar' }).click()
  await pagina.waitForTimeout(1500)
  comprobar(await v.isVisible() && (await cuenta(CHICA)).tipo === 'EFECTIVO', 'sin la captura no pasa a banco')
  await v.locator('input[name="captura"]').setInputFiles(PNG)
  await v.getByRole('button', { name: 'Guardar' }).click()
  error = await esperarVentana(pagina)
  const abanco = await hasta(() => cuenta(CHICA), (c) => c?.tipo === 'BANCO')
  comprobar(!error && abanco?.tipo === 'BANCO' && Boolean(abanco?.apertura_ruta?.endsWith('.png')), `con la captura pasa a banco${error ? `: ${error}` : ''}`)
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}
{
  // Con un movimiento, la captura queda como respaldo: ya no se ofrece cambiarla.
  const banco = await cuenta(BANCO)
  await consulta(
    `insert into movimientos_caja (caja_id, fecha, tipo, monto, descripcion, registrado_por) values ($1, $2::date, 'EGRESO', 10, $3, $4)`,
    [banco.id, ayer, `Comisión ${sello}`, idTesoreria],
  )
  const { pagina, contexto } = await entrar(CUENTAS.tesoreria)
  await pagina.goto(RUTA, { waitUntil: 'networkidle' })
  const v = await abrirCorregir(pagina, BANCO)
  comprobar((await v.locator('input[name="captura"]').count()) === 0, 'con movimientos ya no se ofrece cambiar la captura')
  comprobar(limpio(await v.textContent()).includes('queda como respaldo del saldo'), 'y dice que queda como respaldo del saldo')
  await v.getByRole('button', { name: 'Cancelar' }).click()
  await contexto.close()
}

// ------------------------------------------------------ 5. quien no lleva la caja no la abre
{
  const banco = await cuenta(BANCO)
  for (const quien of ['contabilidad', 'gerencia']) {
    const { pagina, contexto } = await entrar(CUENTAS[quien])
    await pagina.goto(`${BASE}/tesoreria/caja-diaria/captura/${banco.id}`, { waitUntil: 'networkidle' }).catch(() => {})
    comprobar(new URL(pagina.url()).pathname === '/sin-permiso', `${quien} no abre la captura por su enlace (${new URL(pagina.url()).pathname})`)
    await contexto.close()
  }
}

// ------------------------------------------------------ 6. en el teléfono
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.tesoreria, CELULAR)
  await pagina.goto(RUTA, { waitUntil: 'networkidle' })
  const v = await abrirAlta(pagina)
  await v.locator('select[name="tipo"]').selectOption('BANCO')
  await v.locator('input[name="captura"]').scrollIntoViewIfNeeded()
  const ancho = await pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= CELULAR.width, `la ventana con la captura entra en el teléfono (${ancho} px)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'captura-del-saldo-telefono.png') })
  await v.getByRole('button', { name: 'Cancelar' }).click()
  await pagina.locator('details', { hasText: 'Cuentas de Tesorería' }).evaluate((d) => (d.open = true))
  const fila = pagina.locator(`[data-captura-saldo="${BANCO}"]`)
  const caja = await fila.boundingBox()
  comprobar(Boolean(caja) && caja.height >= 44, `«Ver la captura del saldo» se toca con el dedo (${caja ? Math.round(caja.height) : 0} px)`)
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo en orden.')
process.exit(fallas.length ? 1 : 0)
