/**
 * El mismo envío, con la respuesta perdida, en lo que lleva fotos o un PDF
 * (migración 20261022194000 y la duodécima pasada del PR #148), con clic real
 * y la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Logística registra el gasto de su área; la respuesta se pierde, cambia
 *      el importe, la descripción y el PDF y vuelve a pulsar. Antes la pantalla
 *      lo daba por registrado y se vaciaba con lo de la primera vez guardado.
 *      Ahora dice, sin rojo, que ya quedó la primera vez; el formulario se
 *      vacía con un id nuevo, el siguiente gasto entra, y el mismo envío
 *      repetido sigue entrando una vez.
 *   2. Requerimientos, en el celular, registra el ingreso y la salida de un
 *      vehículo de cochera; tras la respuesta perdida agrega otra foto y
 *      vuelve a pulsar: la ventana dice que ya quedó, solo ofrece «Cerrar», y
 *      al cerrar la foto nueva se quita de Storage. Queda lo de la primera vez.
 *   3. El supervisor de Maestranza, en el celular, sube su reporte diario;
 *      tras la respuesta perdida cambia el asunto y agrega una foto: la
 *      pantalla dice que ya quedó, quita la foto nueva y lleva al reporte.
 *   4. El mismo supervisor elige tres fotos y, mientras sube la primera, en
 *      otra pestaña entra Logística: las otras dos no suben (antes salían a
 *      nombre de Logística y volvían con «No tienes permiso»), quedan con
 *      «Reintentar» y, cuando vuelve su cuenta, suben y el reporte entra con
 *      las tres, todas suyas en Storage.
 *
 * La respuesta se corta con CDP, en la etapa de la respuesta: el pedido llega
 * entero al servidor, la acción se cumple y el navegador no se entera.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { codigoSinUsar } from './campo-codigo.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  logistica: process.env.LOGISTICA ?? 'logistica.local@metalwork.test',
  requerimientos: process.env.REQUERIMIENTOS ?? 'requerimientos.local@metalwork.test',
  mtz: process.env.SUPERVISOR_MTZ ?? 'sup.mtz.local@metalwork.test',
  rrhh: process.env.RRHH ?? 'rrhh.local@metalwork.test',
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

/** Corre `sql` en una transacción con la sesión de esa cuenta y el rol authenticated: como lo haría su pantalla. */
async function comoPuesto(correo, sql, valores = []) {
  await base.query('begin')
  try {
    const [{ id }] = (await base.query('select id::text from usuarios where correo = $1', [correo])).rows
    await base.query(
      `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
              set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
      [id],
    )
    await base.query('set local role authenticated')
    const filas = (await base.query(sql, valores)).rows
    await base.query('commit')
    return filas
  } catch (error) {
    await base.query('rollback')
    throw error
  }
}
/**
 * Una persona del taller de Maestranza, con su costo, como la registra RR. HH.
 * desde su pantalla. Antes se metía como postgres, por encima del permiso, y la
 * prueba no decía si RR. HH. podía (vigesimoquinta pasada).
 */
async function personaDeMaestranza(nombres, apellidos, dni) {
  const [r] = await comoPuesto(
    CUENTAS.rrhh,
    `select public.rrhh_guardar_trabajador(x.id, $1, $2, $3, 'Soldadora', (select id from areas where codigo = 'MTZ'), '08:00', '17:00',
                                           'Banco de Pruebas', 'AHORROS', '191-' || $3, null) = x.id as ficha,
            public.rrhh_guardar_costo_trabajador(x.id, 2400) = x.id as costo
       from (select gen_random_uuid() as id) x`,
    [nombres, apellidos, dni],
  )
  if (!r?.ficha || !r?.costo) throw new Error(`RR. HH. no pudo registrar a ${nombres} con su costo.`)
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
/** Espera hasta que `leer` dé algo que cumpla `cumple`, o se acabe el tiempo; devuelve lo último leído. */
async function hasta(leer, cumple, ms = 20000) {
  const fin = Date.now() + ms
  let ultimo = await leer()
  while (!cumple(ultimo) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 300))
    ultimo = await leer()
  }
  return ultimo
}
const esperarSubidas = (pagina) => pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const CELULAR = { width: 390, height: 844 }

async function entrar(correo, viewport = { width: 1440, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    const t = m.text()
    // El corte a propósito deja su error de red en la consola.
    if (m.type() === 'error' && !t.includes('_next/hmr') && !t.includes('WebSocket') && !/Failed to fetch|ERR_CONNECTION_RESET|net::/.test(t)) errores.push(t.slice(0, 300))
  })
  await ir(pagina, `${BASE}/ingresar`)
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  // La acción de servidor que lleva `corte.armado` en su cuerpo llega y se
  // cumple; su respuesta no llega. Con carga, una búsqueda de la pantalla puede
  // salir tarde: por eso no se corta la primera acción que pase, sino esa.
  const cdp = await contexto.newCDPSession(pagina)
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Response' }] })
  // `retenerFoto`: la respuesta de la próxima foto que sube se detiene hasta
  // `soltar()`; la foto ya llegó al servidor, con la sesión de ese momento.
  const corte = { armado: null, cortadas: 0, retenerFoto: false, fotosRetenidas: 0, esperan: [] }
  corte.soltar = () => {
    for (const listo of corte.esperan.splice(0)) listo()
  }
  const cuerpo = (r) => r.postData ?? (r.postDataEntries ?? []).map((x) => Buffer.from(x.bytes ?? '', 'base64').toString()).join('')
  cdp.on('Fetch.requestPaused', async (e) => {
    const h = Object.fromEntries(Object.entries(e.request.headers).map(([k, v]) => [k.toLowerCase(), v]))
    if (corte.armado && e.request.method === 'POST' && h['next-action'] && cuerpo(e.request).includes(corte.armado)) {
      corte.armado = null
      corte.cortadas++
      return cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'ConnectionReset' }).catch(() => {})
    }
    if (corte.retenerFoto && e.request.method === 'POST' && e.request.url.includes('/storage/v1/object/')) {
      corte.retenerFoto = false
      corte.fotosRetenidas++
      await new Promise((listo) => corte.esperan.push(listo))
    }
    return cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => {})
  })
  return { pagina, contexto, errores, corte }
}

/** En otra pestaña del mismo navegador se cierra la sesión y entra `correo`: la sesión es de todas. */
async function enOtraPestana(contexto, correo) {
  const otra = await contexto.newPage()
  await ir(otra, `${BASE}/`)
  await Promise.all([
    otra.waitForURL((u) => u.pathname.startsWith('/ingresar'), { timeout: 30000 }),
    otra.evaluate(() => document.querySelector('form[action="/auth/salir"]')?.requestSubmit()),
  ])
  await quieta(otra)
  await otra.fill('input[type="email"]', correo)
  await otra.fill('input[type="password"]', CLAVE)
  await Promise.all([
    otra.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    otra.click('button[type="submit"]'),
  ])
  if (otra.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  await quieta(otra)
  await otra.close()
}

const sello = Date.now().toString().slice(-6)
const archivos = join(CAPTURAS, 'mismo-envio')
mkdirSync(archivos, { recursive: true })
const PDF = (relleno) =>
  Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n%${'x'.repeat(relleno)}\ntrailer<</Root 1 0 R>>\n%%EOF\n`)
const pdfs = {}
for (const [n, relleno] of [['A', 700], ['B', 2100], ['C', 900], ['D', 1300], ['E', 600]]) {
  pdfs[n] = join(archivos, `QA-GASTO-${n}-${sello}.pdf`)
  writeFileSync(pdfs[n], PDF(relleno))
}
// Otro PDF que se llama igual que el E: el mismo nombre no es el mismo archivo.
mkdirSync(join(archivos, 'otro'), { recursive: true })
pdfs.Eotro = join(archivos, 'otro', `QA-GASTO-E-${sello}.pdf`)
writeFileSync(pdfs.Eotro, PDF(3000))
// Fotos pequeñas de verdad, cada una distinta. Las chicas en JPEG se suben tal
// cual (`comprimirFoto`); las dos grandes, en PNG y con ruido para que no se
// compriman solas, son las que la cola tiene que achicar antes de subirlas.
const fotos = {}
const pesoOriginal = {}
{
  const p = await (await navegador.newContext()).newPage()
  for (const n of ['dosGrande', 'tresGrande']) {
    const b64 = await p.evaluate(async () => {
      const c = document.createElement('canvas')
      c.width = 1800
      c.height = 1350
      const g = c.getContext('2d')
      const ruido = g.createImageData(c.width, c.height)
      for (let i = 0; i < ruido.data.length; i += 4) {
        ruido.data[i] = Math.random() * 256
        ruido.data[i + 1] = Math.random() * 256
        ruido.data[i + 2] = Math.random() * 256
        ruido.data[i + 3] = 255
      }
      g.putImageData(ruido, 0, 0)
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'))
      const b = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
      return btoa(s)
    })
    fotos[n] = join(archivos, `foto-${n}-${sello}.png`)
    const buffer = Buffer.from(b64, 'base64')
    pesoOriginal[n] = buffer.length
    writeFileSync(fotos[n], buffer)
  }
  for (const [n, color] of [['uno', '#7a4b2a'], ['dos', '#3a3f44'], ['tres', '#2a5a7a'], ['cuatro', '#5a7a2a'], ['cinco', '#7a2a5a'], ['seis', '#2a7a6a']]) {
    const b64 = await p.evaluate(async (color) => {
      const c = document.createElement('canvas')
      c.width = 640
      c.height = 480
      const g = c.getContext('2d')
      g.fillStyle = color
      g.fillRect(0, 0, 640, 480)
      g.fillStyle = '#fff'
      g.fillText(String(Math.random()), 20, 40)
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
      const b = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
      return btoa(s)
    }, color)
    fotos[n] = join(archivos, `foto-${n}-${sello}.jpg`)
    writeFileSync(fotos[n], Buffer.from(b64, 'base64'))
  }
  await p.context().close()
}
const SIN_RESPUESTA = 'No llegó la respuesta'

// ------------------------------------------- 1. El gasto del área (Logística)
{
  const [ot] = await consulta(`select id from ordenes_trabajo where numero = '0001-2026'`)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.logistica)
  await ir(pagina, `${BASE}/ordenes/${ot.id}?vista=costos`)
  await pagina.getByText('Registrar gasto de mi área').click()
  const form = pagina.locator('form', { has: pagina.locator('#gasto-monto') })
  const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' })
  const aviso = form.locator('[role="alert"], [role="status"]')
  const llenar = async (monto, descripcion, pdf) => {
    await pagina.fill('#gasto-fecha', hoy)
    await pagina.fill('#gasto-monto', monto)
    await pagina.fill('#gasto-descripcion', descripcion)
    await pagina.setInputFiles('#gasto-pdf', pdf)
  }
  const enviar = form.getByRole('button', { name: 'Enviar para revisión' })

  const id1 = await form.locator('input[name="id"]').inputValue()
  const desc1 = `QA-GASTO primer envío ${sello}, flete de planchas`
  await llenar('111.11', desc1, pdfs.A)
  corte.armado = 'QA-GASTO primer'
  await enviar.click()
  const dijo1 = limpio(await hasta(() => aviso.allInnerTexts().then((t) => t.join(' ')), (t) => t.includes(SIN_RESPUESTA)))
  const [fila1] = await consulta(`select monto::float as monto from ot_gastos_areas where id = $1`, [id1])
  comprobar(corte.cortadas === 1 && dijo1.includes(SIN_RESPUESTA) && fila1?.monto === 111.11,
    `[Logística] la primera respuesta se pierde: la pantalla dice «${dijo1.slice(0, 60)}…» y el gasto ya entró (${fila1?.monto})`)

  await llenar('222.22', `QA-GASTO segundo envío ${sello}, flete y estiba`, pdfs.B)
  await enviar.click()
  const dijo2 = limpio(await hasta(() => aviso.allInnerTexts().then((t) => t.join(' ')), (t) => t.includes('la primera vez')))
  const id2 = await form.locator('input[name="id"]').inputValue()
  const vacio = (await pagina.inputValue('#gasto-monto')) === '' && (await pagina.inputValue('#gasto-descripcion')) === ''
  const neutro = (await form.locator('[data-ya-entro]').count()) === 1
  // El texto llega antes de que termine el envío; el cursor, al terminar.
  const cursorGasto = await hasta(
    () => form.locator('[data-ya-entro]').evaluate((p) => document.activeElement === p).catch(() => false),
    Boolean, 8000,
  ).catch(() => false)
  comprobar(dijo2.includes('Este gasto ya quedó registrado la primera vez que lo enviaste, por S/ 111.11, y lo que cambiaste después no se guardó')
    && dijo2.includes('pide a Administración que lo observe') && neutro && cursorGasto && vacio && id2 !== id1,
    `[Logística] con otro importe, otra descripción y otro PDF, dice sin rojo qué quedó y cómo se corrige, con el cursor en el aviso, y el formulario se vacía con un id nuevo («${dijo2}»; neutro ${neutro}, cursor ${cursorGasto}, vacío ${vacio}, id nuevo ${id2 !== id1})`)
  const [fila2] = await consulta(`select monto::float as monto, descripcion, comprobante_nombre from ot_gastos_areas where id = $1`, [id1])
  const deEse = await consulta(`select name from storage.objects where bucket_id = 'gastos-ot' and name like $1`, [`%/gastos/${id1}%`])
  comprobar(fila2.monto === 111.11 && fila2.descripcion === desc1 && fila2.comprobante_nombre.includes('-A-') && deEse.length === 1,
    `[Logística] en la base queda lo de la primera vez, con su PDF, una vez (${fila2.monto}, ${fila2.comprobante_nombre}, ${deEse.length} archivo)`)
  const lista = await hasta(() => pagina.locator('ol').allInnerTexts().then((t) => t.join(' ')), (t) => t.includes(desc1), 15000)
  comprobar(lista.includes(desc1), '[Logística] la lista de gastos ya muestra el que entró, sin recargar')
  await pagina.screenshot({ path: join(CAPTURAS, 'mismo-envio-gasto.png'), fullPage: true })

  // El siguiente gasto entra con su id nuevo.
  const desc3 = `QA-GASTO tercero ${sello}, viáticos del viaje`
  await llenar('50', desc3, pdfs.C)
  await enviar.click()
  const dijo3 = limpio(await hasta(() => aviso.allInnerTexts().then((t) => t.join(' ')), (t) => /enviado a Administración|primera vez|No /.test(t)))
  const [fila3] = await consulta(`select count(*)::int as n from ot_gastos_areas where id = $1 and descripcion = $2`, [id2, desc3])
  comprobar(dijo3.includes('enviado a Administración') && fila3.n === 1, `[Logística] el siguiente gasto entra con el id nuevo («${dijo3}»)`)

  // El mismo envío repetido tras otra respuesta perdida entra una vez.
  const id4 = await form.locator('input[name="id"]').inputValue()
  const desc4 = `QA-GASTO cuarto ${sello}, mismo envío repetido`
  await llenar('75.5', desc4, pdfs.D)
  corte.armado = 'QA-GASTO cuarto'
  await enviar.click()
  const dijoCorte = limpio(await hasta(() => aviso.allInnerTexts().then((t) => t.join(' ')), (t) => t.includes(SIN_RESPUESTA)))
  comprobar(corte.cortadas === 2 && dijoCorte.includes(SIN_RESPUESTA), '[Logística] el cuarto gasto entra y la respuesta se pierde')
  await enviar.click()
  const dijo4 = limpio(await hasta(() => aviso.allInnerTexts().then((t) => t.join(' ')), (t) => t.includes('ya estaba registrado')))
  const [fila4] = await consulta(`select count(*)::int as n from ot_gastos_areas where descripcion = $1`, [desc4])
  comprobar(dijo4.includes(`El gasto ${id4} ya estaba registrado`) && fila4.n === 1, `[Logística] el mismo envío repetido se da por registrado una vez («${dijo4}»)`)

  // Otro PDF con el mismo nombre, y todo lo demás igual: no es el mismo envío.
  const id5 = await form.locator('input[name="id"]').inputValue()
  const desc5 = `QA-GASTO quinto ${sello}, otro PDF con el mismo nombre`
  await llenar('31.4', desc5, pdfs.E)
  corte.armado = 'QA-GASTO quinto'
  await enviar.click()
  await hasta(() => aviso.allInnerTexts().then((t) => t.join(' ')), (t) => t.includes(SIN_RESPUESTA))
  await llenar('31.4', desc5, pdfs.Eotro)
  await enviar.click()
  const dijo5 = limpio(await hasta(() => aviso.allInnerTexts().then((t) => t.join(' ')), (t) => /primera vez|ya estaba/.test(t)))
  const [{ n: tamano5 }] = await consulta(
    `select (metadata->>'size')::int as n from storage.objects where bucket_id = 'gastos-ot' and name = (select comprobante_ruta from ot_gastos_areas where id = $1)`,
    [id5],
  )
  comprobar(corte.cortadas === 3 && dijo5.includes('ya quedó registrado la primera vez') && tamano5 === readFileSync(pdfs.E).length,
    `[Logística] otro PDF que se llama igual no se da por el mismo envío, y queda el de la primera vez («${dijo5.slice(0, 90)}…»; ${tamano5} bytes)`)
  const sueltos = await consulta(
    `select o.name from storage.objects o where o.bucket_id = 'gastos-ot' and o.name like $1
        and not exists (select 1 from ot_gastos_areas g where g.comprobante_ruta = o.name)`,
    [`ot/${ot.id}/gastos/%`],
  )
  comprobar(sueltos.length === 0, `[Logística] ningún PDF suelto en los gastos de la OT (${sueltos.length})`)
  comprobar(errores.length === 0, `[Logística] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 2. El vehículo (Requerimientos, en el celular)
{
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.requerimientos, CELULAR)
  const [yo] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.requerimientos])
  const placa = `Q${sello.slice(-2)}-${sello.slice(0, 3)}`
  await ir(pagina, `${BASE}/vehiculos`)
  await pagina.getByRole('button', { name: 'Registrar ingreso' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('#veh-motivo').selectOption('COCHERA')
  await v.locator('#veh-placa').fill(placa)
  await v.locator('#veh-unidad').fill('Camioneta del cliente')
  await v.locator('#veh-empresa').fill('EMPRESA DE PRUEBA DEL BANCO')
  await v.locator('#veh-obs').fill('Llega con la llanta baja')
  await v.locator('input[type="file"]:not([capture])').setInputFiles(fotos.uno)
  await esperarSubidas(pagina)
  corte.armado = 'Llega con la llanta baja'
  await v.getByRole('button', { name: 'Registrar ingreso' }).click()
  const avisoV = v.locator('[role="alert"]')
  const dijo1 = limpio(await hasta(() => avisoV.allInnerTexts().then((t) => t.join(' ')), (t) => t.includes(SIN_RESPUESTA)))
  const [reg] = await consulta(`select id from registro_vehiculos where placa = $1`, [placa.replace('-', '')]).then(async (r) =>
    r.length ? r : consulta(`select id from registro_vehiculos where placa = $1`, [placa]))
  comprobar(corte.cortadas === 1 && dijo1.includes(SIN_RESPUESTA) && Boolean(reg), `[Requerimientos 390] el ingreso entra y la respuesta se pierde («${dijo1.slice(0, 50)}…»)`)

  await v.locator('#veh-obs').fill('Llega sin espejo')
  await v.locator('input[type="file"]:not([capture])').setInputFiles(fotos.dos)
  await esperarSubidas(pagina)
  const carpetaIngreso = `${yo.id}/${reg?.id}/ingreso/%`
  const antesDeCerrar = await consulta(`select name from storage.objects where bucket_id = 'fotos-vehiculos' and name like $1`, [carpetaIngreso])
  await v.getByRole('button', { name: 'Registrar ingreso' }).click()
  const dijo2 = limpio(await hasta(() => avisoV.allInnerTexts().then((t) => t.join(' ')), (t) => t.includes('la primera vez')))
  const estado = {
    neutro: (await v.locator('[data-ya-entro]').count()) === 1,
    sinRegistrar: (await v.getByRole('button', { name: 'Registrar ingreso' }).count()) === 0,
    cerrar: await v.getByRole('button', { name: 'Cerrar' }).filter({ hasText: 'Cerrar' }).isVisible(),
  }
  comprobar(dijo2.includes('Este ingreso ya quedó registrado la primera vez que lo enviaste') && Object.values(estado).every(Boolean),
    `[Requerimientos 390] con otra observación y otra foto, la ventana dice que ya quedó y solo ofrece «Cerrar» (${JSON.stringify(estado)})`)
  await pagina.screenshot({ path: join(CAPTURAS, 'mismo-envio-vehiculo-ingreso-390.png'), fullPage: true })
  // La foto nueva se quita al recibir el aviso, sin esperar a «Cerrar».
  const despues = await hasta(
    () => consulta(`select name from storage.objects where bucket_id = 'fotos-vehiculos' and name like $1`, [carpetaIngreso]),
    (r) => r.length === 1,
  )
  await v.getByRole('button', { name: 'Cerrar' }).filter({ hasText: 'Cerrar' }).click()
  await v.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  const [ingreso] = await consulta(
    `select observacion_ingreso, (select count(*)::int from registro_vehiculo_fotos f where f.registro_id = v.id) as fotos from registro_vehiculos v where id = $1`,
    [reg?.id],
  )
  comprobar(antesDeCerrar.length === 2 && despues.length === 1 && ingreso?.fotos === 1 && ingreso?.observacion_ingreso === 'Llega con la llanta baja',
    `[Requerimientos 390] la foto nueva se quita con el aviso, antes de cerrar; queda el ingreso de la primera vez con su foto (${antesDeCerrar.length} → ${despues.length} en Storage; «${ingreso?.observacion_ingreso}», ${ingreso?.fotos} foto)`)

  // La salida, desde su detalle.
  await ir(pagina, `${BASE}/vehiculos/${reg?.id}`)
  await pagina.getByRole('button', { name: 'Marcar salida' }).click()
  const s = pagina.locator('[role="dialog"]')
  await s.locator('textarea[name="observacion"]').fill('Lo recoge el conductor')
  await s.locator('input[type="file"]:not([capture])').setInputFiles(fotos.tres)
  await esperarSubidas(pagina)
  corte.armado = 'Lo recoge el conductor'
  await s.getByRole('button', { name: 'Registrar salida' }).click()
  const avisoS = s.locator('[role="alert"]')
  const dijoCorte = limpio(await hasta(() => avisoS.allInnerTexts().then((t) => t.join(' ')), (t) => t.includes(SIN_RESPUESTA)))
  comprobar(corte.cortadas === 2 && dijoCorte.includes(SIN_RESPUESTA), '[Requerimientos 390] la salida entra y la respuesta se pierde')
  await s.locator('input[type="file"]:not([capture])').setInputFiles(fotos.cuatro)
  await esperarSubidas(pagina)
  await s.getByRole('button', { name: 'Registrar salida' }).click()
  const dijoS = limpio(await hasta(() => avisoS.allInnerTexts().then((t) => t.join(' ')), (t) => t.includes('la primera vez')))
  const soloCerrar = (await s.getByRole('button', { name: 'Registrar salida' }).count()) === 0
  comprobar(dijoS.includes('la salida quedó registrada la primera vez que la enviaste') && soloCerrar && (await s.locator('[data-ya-entro]').count()) === 1,
    `[Requerimientos 390] la salida con otra foto: dice sin rojo que ya quedó y no ofrece registrarla otra vez («${dijoS}»)`)
  // La foto nueva se quita con el aviso, y la ventana sigue ahí hasta que se
  // cierra. La decimotercera pasada la vio irse sola en medio segundo: el
  // vehículo ya salió, la página dejaba de pintar el botón que la abrió y la
  // foto quedaba suelta.
  const carpetaSalida = `${yo.id}/${reg?.id}/salida/%`
  const enSalida = await hasta(
    () => consulta(`select name from storage.objects where bucket_id = 'fotos-vehiculos' and name like $1`, [carpetaSalida]),
    (r) => r.length === 1,
  )
  await pagina.waitForTimeout(4000)
  const sigue = await s.locator('[data-ya-entro]').isVisible().catch(() => false)
  comprobar(sigue, '[Requerimientos 390] el aviso sigue a la vista 4 s después, hasta que se cierra')
  await s.getByRole('button', { name: 'Cerrar' }).filter({ hasText: 'Cerrar' }).click()
  await s.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  const [salida] = await consulta(
    `select salida_en is not null as salio, observacion_salida,
            (select count(*)::int from registro_vehiculo_fotos f where f.registro_id = v.id and f.momento = 'SALIDA') as fotos
       from registro_vehiculos v where id = $1`,
    [reg?.id],
  )
  await quieta(pagina)
  const sinMarcar = await hasta(() => pagina.getByRole('button', { name: 'Marcar salida' }).count(), (n) => n === 0, 10000)
  comprobar(enSalida.length === 1 && salida?.salio && salida?.fotos === 1 && salida?.observacion_salida === 'Lo recoge el conductor' && sinMarcar === 0,
    `[Requerimientos 390] queda la salida de la primera vez con su foto, la nueva se quitó antes de cerrar y, al cerrar, la pantalla ya no ofrece «Marcar salida» (${enSalida.length} en Storage, ${salida?.fotos} foto)`)
  comprobar(errores.length === 0, `[Requerimientos 390] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 3. El reporte diario (Maestranza, en el celular)
{
  const persona = `Elsa ${sello}`
  await personaDeMaestranza(persona, 'Prueba Mismo Envío', `6${sello.padStart(7, '0')}`)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR)
  const [yo] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.mtz])
  const codigo = await codigoSinUsar(consulta, 'QA_SR_O4_1_26/', sello)
  const asunto = `Armado de tolva ${sello}`
  await ir(pagina, `${BASE}/reportes-diarios/nuevo`)
  await pagina.fill('#rd-codigo', codigo)
  await pagina.fill('#rd-asunto', asunto)
  await pagina.fill('#rd-descripcion', 'Se avanzó la tolva del lado izquierdo.')
  const elegir = async (etiqueta, texto) => {
    await pagina.getByRole('combobox', { name: etiqueta }).click()
    // Como en probar-reporte-diario: se escribe cuando la caja de búsqueda ya
    // tiene el foco, o las letras se pierden en el botón (se vio en la cola).
    const caja = pagina.locator('input[type="search"]:focus')
    await caja.waitFor({ timeout: 10000 })
    await caja.fill(texto)
    await pagina.getByRole('option', { name: new RegExp(texto) }).first().click()
  }
  const t1 = pagina.locator('fieldset[data-trabajo="1"]')
  await elegir('Trabajo 1: sobre qué', 'Tarea nueva')
  await t1.locator('textarea').fill('Soldadura de la tolva')
  await t1.locator('input[type="number"]').first().fill('40')
  await elegir('Personal del trabajo 1: persona 1', persona)
  await pagina.getByRole('spinbutton', { name: 'Personal del trabajo 1: horas de la persona 1' }).fill('4')
  const galeria = pagina.locator('input[type="file"]:not([capture])')
  await galeria.setInputFiles(fotos.cinco)
  await esperarSubidas(pagina)
  corte.armado = asunto
  await pagina.getByRole('button', { name: 'Subir reporte' }).click()
  const avisoR = pagina.locator('form > [role="alert"]')
  const dijo1 = limpio(await hasta(() => avisoR.allInnerTexts().then((t) => t.join(' ')), (t) => t.includes(SIN_RESPUESTA)))
  const [rep] = await consulta(`select id from reportes_diarios where asunto = $1`, [asunto])
  comprobar(corte.cortadas === 1 && dijo1.includes(SIN_RESPUESTA) && Boolean(rep), `[Maestranza 390] el reporte entra y la respuesta se pierde («${dijo1.slice(0, 50)}…»)`)

  await pagina.fill('#rd-asunto', `${asunto} y pulido`)
  await galeria.setInputFiles(fotos.seis)
  await esperarSubidas(pagina)
  const carpeta = `${yo.id}/${rep?.id}/%`
  const antes = await consulta(`select name from storage.objects where bucket_id = 'fotos-reporte-diario' and name like $1`, [carpeta])
  await pagina.getByRole('button', { name: 'Subir reporte' }).click()
  const dijo2 = limpio(await hasta(() => avisoR.allInnerTexts().then((t) => t.join(' ')), (t) => t.includes('la primera vez')))
  const verReporte = pagina.getByRole('link', { name: 'Ver el reporte' })
  const estado = {
    neutro: (await pagina.locator('form [data-ya-entro]').count()) === 1,
    sinSubir: (await pagina.getByRole('button', { name: /^Subir reporte/ }).count()) === 0,
    enlace: await verReporte.isVisible(),
    // Trabado: una foto elegida después subía y quedaba suelta (decimotercera pasada).
    trabado: (await pagina.locator('#rd-asunto').isDisabled()) && (await galeria.isDisabled()),
    cursor: await pagina.locator('form [data-ya-entro]').evaluate((p) => document.activeElement === p).catch(() => false),
  }
  comprobar(dijo2.includes('Este reporte ya quedó registrado la primera vez que lo enviaste, y lo que cambiaste después no se guardó') && Object.values(estado).every(Boolean),
    `[Maestranza 390] con otro asunto y otra foto, dice sin rojo qué pasó, se traba y ofrece «Ver el reporte» en vez de subirlo otra vez (${JSON.stringify(estado)})`)
  const despues = await hasta(
    () => consulta(`select name from storage.objects where bucket_id = 'fotos-reporte-diario' and name like $1`, [carpeta]),
    (r) => r.length === 1,
  )
  const [guardado] = await consulta(
    `select asunto, (select count(*)::int from reporte_diario_fotos f where f.reporte_id = r.id) as fotos from reportes_diarios r where id = $1`,
    [rep?.id],
  )
  comprobar(antes.length === 2 && despues.length === 1 && guardado?.asunto === asunto && guardado?.fotos === 1,
    `[Maestranza 390] la foto nueva se quita y queda el reporte de la primera vez con su foto (${antes.length} → ${despues.length} en Storage; «${guardado?.asunto}», ${guardado?.fotos} foto)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'mismo-envio-reporte-390.png'), fullPage: true })
  await verReporte.click()
  await pagina.waitForURL(`**/reportes-diarios/${rep?.id}`, { timeout: 20000 }).catch(() => {})
  comprobar(new URL(pagina.url()).pathname === `/reportes-diarios/${rep?.id}`, `[Maestranza 390] «Ver el reporte» abre el que entró (${new URL(pagina.url()).pathname})`)
  comprobar(errores.length === 0, `[Maestranza 390] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 4. La cola de fotos con la traba (Maestranza, en el celular)
// Vigesimotercera pasada: `SelectorFotos` miraba la sesión al elegir y no antes
// de cada foto. Si en otra pestaña entraba otra cuenta mientras subía la
// primera, las que seguían salían con esa sesión.
{
  const persona = `Rita ${sello}`
  await personaDeMaestranza(persona, 'Prueba Cola De Fotos', `7${sello.padStart(7, '0')}`)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR)
  const [yo] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.mtz])
  const [logistica] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.logistica])
  const asunto = `Cola de fotos ${sello}`
  await ir(pagina, `${BASE}/reportes-diarios/nuevo`)
  await pagina.fill('#rd-codigo', await codigoSinUsar(consulta, 'QA_SR_O4_1_26/', sello))
  await pagina.fill('#rd-asunto', asunto)
  await pagina.fill('#rd-descripcion', 'Se armó la cola de la tolva.')
  const elegir = async (etiqueta, texto) => {
    await pagina.getByRole('combobox', { name: etiqueta }).click()
    // Como en probar-reporte-diario: se escribe cuando la caja de búsqueda ya
    // tiene el foco, o las letras se pierden en el botón (se vio en la cola).
    const caja = pagina.locator('input[type="search"]:focus')
    await caja.waitFor({ timeout: 10000 })
    await caja.fill(texto)
    await pagina.getByRole('option', { name: new RegExp(texto) }).first().click()
  }
  const t1 = pagina.locator('fieldset[data-trabajo="1"]')
  await elegir('Trabajo 1: sobre qué', 'Tarea nueva')
  await t1.locator('textarea').fill('Armado de la cola')
  await t1.locator('input[type="number"]').first().fill('30')
  await elegir('Personal del trabajo 1: persona 1', persona)
  await pagina.getByRole('spinbutton', { name: 'Personal del trabajo 1: horas de la persona 1' }).fill('3')

  const [{ desde }] = await consulta(`select now() as desde`)
  const deQuien = () =>
    consulta(
      `select count(*) filter (where owner_id = $2)::int as mias, count(*) filter (where owner_id = $3)::int as de_logistica,
              count(*) filter (where owner_id = $2 and metadata->>'mimetype' = 'image/jpeg')::int as en_jpeg,
              coalesce(max((metadata->>'size')::bigint) filter (where owner_id = $2), 0)::bigint as la_mas_pesada
         from storage.objects where bucket_id = 'fotos-reporte-diario' and created_at >= $1`,
      [desde, yo.id, logistica.id],
    ).then(([r]) => ({ ...r, la_mas_pesada: Number(r.la_mas_pesada) }))
  corte.retenerFoto = true
  // La primera, chica, sube tal cual; las dos que esperan son las grandes, que hay que achicar.
  await pagina.locator('input[type="file"]:not([capture])').setInputFiles([fotos.uno, fotos.dosGrande, fotos.tresGrande])
  await hasta(async () => corte.fotosRetenidas, (n) => n === 1)
  await enOtraPestana(contexto, CUENTAS.logistica)
  const traba = pagina.locator('dialog[data-traba-otra-cuenta]')
  const trabada = await hasta(() => traba.evaluate((d) => d.open).catch(() => false), Boolean, 10000)
  corte.soltar()
  const reintentar = pagina.getByRole('button', { name: /^Volver a subir / })
  const quedaron = await hasta(() => reintentar.count(), (n) => n === 2)
  await esperarSubidas(pagina)
  const avisos = limpio((await pagina.getByRole('list', { name: 'Fotos que no entraron' }).allInnerTexts()).join(' '))
  const enStorage = await deQuien()
  comprobar(trabada && corte.fotosRetenidas === 1 && quedaron === 2 && (avisos.match(/No se subió: en otra pestaña entró otra cuenta/g) ?? []).length === 2
      && !avisos.includes('permiso') && enStorage.mias === 1 && enStorage.de_logistica === 0,
    `[Maestranza 390] entra Logística a media cola: sube la que ya salía, las otras dos esperan con «Reintentar» y nada sube a su nombre (${quedaron} por reintentar; Storage: ${enStorage.mias} suya, ${enStorage.de_logistica} de Logística; «${avisos.slice(0, 90)}…»)`)
  await pagina.screenshot({ path: join(CAPTURAS, 'cola-de-fotos-con-la-traba-390.png'), fullPage: true })

  await enOtraPestana(contexto, CUENTAS.mtz)
  const destrabada = await hasta(() => traba.evaluate((d) => !d.open).catch(() => true), Boolean, 10000)
  for (let i = 0; i < 2; i++) await reintentar.first().click()
  await esperarSubidas(pagina)
  const sinFallas = await hasta(() => pagina.getByRole('list', { name: 'Fotos que no entraron' }).count(), (n) => n === 0, 10000)
  const despues = await deQuien()
  // Achicadas: en Storage las tres son JPEG y ninguna pesa lo que pesaba la
  // más liviana de las grandes en PNG (vigesimoquinta pasada: con fotos chicas,
  // «achica» no se medía).
  const pngMasLiviano = Math.min(pesoOriginal.dosGrande, pesoOriginal.tresGrande)
  comprobar(destrabada && sinFallas === 0 && despues.mias === 3 && despues.de_logistica === 0 && despues.en_jpeg === 3 && despues.la_mas_pesada < pngMasLiviano,
    `[Maestranza 390] vuelve su cuenta, «Reintentar» achica y sube las dos, y quedan las tres a su nombre (Storage: ${despues.mias} suyas, ${despues.en_jpeg} en JPEG, la más pesada ${Math.round(despues.la_mas_pesada / 1024)} KB contra ${Math.round(pngMasLiviano / 1024)} KB del PNG; ${despues.de_logistica} de Logística)`)

  await pagina.getByRole('button', { name: 'Subir reporte' }).click()
  await pagina.waitForURL((u) => /^\/reportes-diarios\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 }).catch(() => {})
  const [rep] = await consulta(
    `select r.registrado_por = $2 as suyo, (select count(*)::int from reporte_diario_fotos f where f.reporte_id = r.id) as fotos
       from reportes_diarios r where asunto = $1`,
    [asunto, yo.id],
  )
  comprobar(rep?.suyo && rep?.fotos === 3, `[Maestranza 390] el reporte entra a su nombre con las tres fotos (${rep?.fotos ?? 'sin reporte'})`)
  comprobar(errores.length === 0, `[Maestranza 390, cola] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
