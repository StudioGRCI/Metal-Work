/**
 * Lo que dejó la vigesimoctava pasada del PR #148, con clic real y la cuenta de
 * cada puesto (nunca ADMIN):
 *
 *   1. La pestaña de antes del último despliegue. Cada compilación cambia el id
 *      de cada acción de servidor, y el servidor contesta 404 con
 *      `x-nextjs-action-not-found` al id viejo (aquí, la cabecera `next-action`
 *      se cambia por CDP por uno que no existe; la respuesta es la del servidor
 *      de verdad). La acción no corrió: se dice que hay que recargar, no
 *      «revisa la conexión», no se reintenta, y nada queda suelto en Storage.
 *      a. «Reportar» un trabajo sin orden (Supervisión de Maestranza) con la
 *         ventana abierta: la foto se quita y la ventana pide elegirla otra vez.
 *         Antes quedaba «en duda», suelta para siempre.
 *      b. Lo mismo cerrada en vuelo: «… no se registró: el sistema se
 *         actualizó…» junto al botón. Mientras sigue, el botón apunta con
 *         `aria-describedby` a una región que ya estaba montada (la que nace con
 *         su texto no la lee el lector).
 *      c. Otra versión del contrato de un subcontrato (Administración): una
 *         sola llamada, sin la pausa ni el segundo intento, y el archivo se
 *         quita. Antes decía «No quedó registrado: no llegó la respuesta».
 *      d. El conteo inicial del kardex (Almacén): al leer el Excel y al
 *         registrar, el motivo es recargar.
 *   2. La anulación de un vehículo (Requerimientos) cerrada en vuelo: la fila
 *      entera gira y no abre otra ventana; lo que conteste se dice en la fila.
 *      Antes «Anular» no era parte del estado de la fila, y al contestar cerraba
 *      la ventana de la salida abierta entretanto.
 *   3. «Reportar día» de una OT al girar el teléfono (una cuenta OPERARIO del
 *      banco, sembrada como las de probar-administracion): la orden pinta cada
 *      actividad dos veces, y la que aparece al girar sabe del envío en camino
 *      y de su desenlace. Y el reporte entra: el banco mandaba `[]` como `{}` a
 *      la columna jsonb y ck_materiales_usados_array lo rechazaba.
 *
 * Y lo que dejó la vigesimonovena:
 *
 *   1b. El «Reporte registrado» que llega con la ventana ya cerrada sale en una
 *       región montada desde antes: la que nace con su texto no la lee el lector.
 *   1d. El conteo inicial cortado por la pestaña vieja dice la causa una vez, en
 *       el resumen; las filas dicen «No salió» sin una alerta cada una, y en
 *       vez de «Registrar», que volvería a fallar, ofrece volver a cargar.
 *   1e. El reporte diario a medio llenar en la pestaña vieja: al volver tras
 *       31 s ya no se recarga solo (Next recarga el documento entero si
 *       `router.refresh()` ve otra compilación, y se perdía lo escrito y la foto
 *       quedaba suelta); arriba se dice que el sistema se actualizó. Al «Subir
 *       reporte», la foto se quita y se pide elegirla otra vez. Sin despliegue,
 *       al volver se repinta como siempre y sin aviso.
 *   1f. La planilla sin internet del kardex, como el conteo.
 *   1g. La cotización con cliente nuevo dice que hay que recargar, no «Vuelve a
 *       intentar», que nunca entraría.
 *   1h. El plano a dos áreas: una sola acción, una subida y un borrado, y un
 *       mensaje que no pide a la vez recargar y reenviar.
 *   3.  La parte se arma sola en un banco nuevo (antes dependía de que hubiera
 *       corrido probar-documentos-al-elegir), dice «Avance del día reportado» en
 *       la copia a la vista y en la otra al girar, y deja al OPERARIO
 *       desactivado.
 *
 * Y lo que se cerró antes de la trigésima: una vez que la pestaña se sabe
 * vieja, lo que se elija o se envíe desde ella ni sube a Storage, porque al
 * recargar, como pide el aviso de arriba, quedaría suelto.
 *
 *   1c. El segundo «Adjuntar» del contrato no sube el archivo ni llama a la acción.
 *   1e. La foto que se elige después de «Subir reporte» no sube, lo dice y no
 *       ofrece «Reintentar».
 *   El aviso de arriba solo está montado en la pestaña vieja (fijo en toda
 *   pantalla quedaba delante de la región de estado de cada una) y nace vacío,
 *   para que el lector lo oiga.
 *
 * Y lo que dejó la trigésima:
 *
 *   1c. Si el banco no tiene ningún subcontrato, registra uno con la sesión de
 *       Administración: antes dependía de SC-0001-2026 y en un banco nuevo
 *       tumbaba la suite entera.
 *   1e. Al saberse vieja la pestaña al volver, la foto ya subida se quita en el
 *       acto, queda sin miniatura con una sola alerta, y debajo se pide volver
 *       a cargar, no «Quita o vuelve a subir». Descubierta al enviar, el aviso
 *       de arriba está sin región: el del botón ya lo dice.
 *   1i. El despliegue de todos los días: la acción conserva su id (Next guarda
 *       la clave en .next/cache y Vercel la conserva) y solo cambia la
 *       compilación de las respuestas. Antes la pestaña no se enteraba y se
 *       recargaba sola. Ahora, al volver y en el sondeo, lo dice arriba sin
 *       recargar ni repintar; la foto sigue; «Volver a cargar» la quita antes
 *       de recargar; sin señal al volver no sale la página sin conexión; y el
 *       reporte entra con su foto.
 *   1j. La ventana que pregunta al abrirse por su envío anterior descubre la
 *       pestaña vieja y lo dice dentro; abierta otra vez, nace con el aviso.
 *   1k. El PDF de la orden: la segunda vez, ya sabida vieja, ni sube.
 *
 * Y lo que dejó la trigesimoprimera, también en el despliegue que conserva los
 * ids (la pestaña «nueva»), donde casi todo envío repinta y Next recarga el
 * documento entero:
 *
 *   1e. La foto quitada al saberse vieja la pestaña conserva su miniatura, con
 *       «Se quitó» encima: con tres eran tres cuadros iguales.
 *   1f-conserva. La planilla del kardex con un ingreso y dos salidas entra
 *       entera: cada fila repintaba, y Next recargaba a mitad de la planilla.
 *   1j. Con la ventana abierta, solo la ventana lo anuncia; arriba, sin región.
 *   1l. «Marcar todos leídos» y un aviso de la campana no recargan la pantalla
 *       ni se llevan el reporte a medio llenar, se sepa o no todavía que hubo
 *       un despliegue; la campana los pinta leídos.
 *   1m. «Volver a cargar» con el reporte en camino lo espera: el reporte entra
 *       con su foto y lleva a él. Antes quitaba la foto y el reporte no entraba.
 *   1n. El reporte que no se sabe si entró, en la pestaña que se sabe vieja:
 *       su foto no se quita ni dice «Se quitó», y debajo se pide buscarlo antes
 *       de subirlo otra vez.
 *
 * Y lo que dejó la trigesimosegunda:
 *
 *   1o. Con la sesión vencida (la cookie dice que vence ya), la acción no la
 *       refresca: antes pregunta `/auth/sesion`. Si el proxy la refrescaba en
 *       la acción, Next la respondía revalidada y la pestaña «nueva» se
 *       recargaba al descubrir el despliegue y al tocar un aviso. Con la
 *       sesión al día, la acción siguiente no pregunta otra vez.
 *   1o-conteo. El conteo inicial en «nueva», con la sesión vencida, entra sin
 *       recargar.
 *   1p. «Volver a cargar» no recarga encima de lo que no entró: el reporte en
 *       camino que vuelve rechazado (1p-rechazo) o sin respuesta
 *       (1p-sin-respuesta) deja su aviso y lo escrito, arriba se dice por qué
 *       y el botón pasa a «Volver a cargar igual»; el que no contesta en 10 s
 *       (1p-colgado) lo dice y deja recargar igual, también desde la franja
 *       que queda fija bajo la cabecera al bajar a 390; y el que entró y lleva
 *       a otra pantalla que tarda (1p-destino-lento, sin service worker) no se
 *       corta con otra recarga.
 *   1q. «Atrás» al stock con la ventana de la planilla abierta (Almacén a
 *       1440) trae el saldo nuevo: sin revalidar, Next lo traía de su
 *       historial.
 *   1r. La pastilla «Sin leer» de /avisos baja con lo marcado leído en
 *       «nueva»: seguía en el número de antes.
 *
 * Y lo que dejó la trigesimotercera:
 *
 *   1p-se-va. El reporte entró y su pantalla tarda más de 15 s: arriba se dice
 *       que ya está guardado, y el toque siguiente va a esa pantalla con su
 *       foto, no al formulario de antes, que ofrecía subirlo otra vez.
 *   1s. «Volver a cargar» espera también lo que va por su cuenta, fuera de
 *       `useAccion`, con la ventana cerrada en vuelo: «Subir cotización»
 *       (1s-cotizacion, Ventas) y el Excel del cronograma (1s-cronograma,
 *       Diseño). Antes recargaba en el acto y el archivo quedaba subido sin
 *       anotar; ahora, cuando entra, recarga, y nada queda suelto.
 *
 * Y lo que dejó la trigesimocuarta:
 *
 *   1s-reenvio. La cotización con un número que ya existe, cerrada en vuelo
 *       (Ventas): el botón que abre la ventana gira, y el rechazo se dice a su
 *       lado y en el aviso de arriba; reabrir no lo borra.
 *       Después el reenvío corregido, otra vez cerrado en vuelo: el aviso de
 *       arriba vuelve a «Volver a cargar» y el toque lo espera. Antes se
 *       quedaba en «igual», recargaba a los 160 ms y dejaba su PDF suelto.
 *   1s-cronograma-sin-respuesta. El cronograma cerrado en vuelo cuya respuesta
 *       no llega (Diseño, a 390): junto a «Subir cronograma», que no se sabe si
 *       quedó.
 *   1s-orden-pdf. El PDF de la orden, que sube al elegirlo (Administración):
 *       «Volver a cargar» espera a que quede anotado. Recargaba a los 180 ms.
 *
 * Y lo que dejó la trigesimoquinta:
 *
 *   1s-reenvio, además: el estado de «Subir cotización» va bajo el
 *       encabezado, y el botón no se mueve cuando aparece.
 *   1t-cronograma. «Cancelar» con el cronograma en camino (Diseño): el botón
 *       gira y dice que sigue; «Nueva tarea» se lleva el botón y su
 *       «Cancelar» lo devuelve girando; el rechazo se dice a su lado, y otra
 *       «Nueva tarea» no lo borra. Antes el envío y su desenlace se perdían.
 *   1t-correccion. La corrección cerrada en vuelo que entra (Ventas): lo dice
 *       en verde junto a su botón. Antes la tarjeta cambiaba callada.
 *   1t-dos-tarjetas. «Dar código y cargar la OT» de una cotización entra con
 *       la ventana de otra abierta y escrita (Administración): no recarga ni
 *       se va; el encabezado dice que ya tiene su OT, con «Ver su tarjeta».
 *       Cuando la otra entra con su ventana abierta, va a su tarjeta,
 *       resaltada y sin recargar, con las dos OT y nada suelto. Antes
 *       recargaba y se perdía lo escrito o la otra OT.
 *   1t-motivo-arriba. Una ventana de `useEnvio` cerrada en vuelo y rechazada
 *       en «nueva» (Ventas, la unidad con una placa que ya está): arriba se
 *       dice por qué, no se manda a leer un aviso que no existe.
 *
 * Y lo que dejó la trigesimosexta:
 *
 *   1t-cronograma, además: lo que dice va en el renglón de la tarjeta, y
 *       «Subir cronograma» no se mueve cuando aparece; con «Nueva tarea»
 *       abierta y el botón fuera, el renglón dice que sigue y después el
 *       rechazo. 1t-correccion, además: «Cancelar» cierra en vuelo, y el verde
 *       se calla cuando Gerencia la rechaza. 1t-dos-tarjetas, además:
 *       «Cancelar» cierra en vuelo.
 *   1u-cronograma-arriba. El cronograma rechazado con la ventana cerrada y
 *       «Nueva tarea» abierta, en «nueva» (Diseño): arriba dice por qué.
 *   1u-rechazo-se-queda. La OT que entra con su ventana cerrada va a su
 *       tarjeta sin recargar, y el «Ya hay una OT» de la otra sigue dicho
 *       (Administración). Antes la recarga se lo llevaba.
 *   1u-ida-otra-pantalla. La OT que entra con el PDF de una orden todavía
 *       subiendo no se va a su tarjeta: lo dice el encabezado, y cuando la
 *       subida termina nada se lleva la orden nueva a medio escribir
 *       (Administración). Antes la ida salía después, desde ahí.
 *   1u-pdf-aviso. «PDF corregido guardado.» y «Se quitó…» se dicen en la
 *       orden y se van al salir de ella (Administración). Antes volvían.
 *
 * Y lo que dejó la trigesimoséptima:
 *
 *   1t-dos-tarjetas y 1u-rechazo-se-queda, además: desde la tarjeta a la que
 *       se fue (sola o con «Ver su tarjeta»), al menú y «Atrás» vuelve a
 *       Cotización en un paso, y «Adelante» y «Atrás» siguen. Antes la
 *       dirección cambiaba y la pantalla no. En 1u-rechazo-se-queda la OT que
 *       va detrás se detiene hasta que la rechazada quitó su PDF: si
 *       contestara antes, habría dos en camino y no iría sola.
 *   1v-ver-su-tarjeta-en-camino. Con otra OT en camino, «Ver su tarjeta» está
 *       apagado y dice por qué; cuando vuelve, lleva a la tarjeta con un solo
 *       «#» (Administración). Antes la línea se iba y no llevaba a ningún lado.
 *   1v-ver-su-tarjeta-nueva. En «nueva», «Ver su tarjeta» y después «Volver a
 *       cargar»: recarga, sin decir que algo enviado ya entró (Administración).
 *   1v-ida-no-pisa-el-menu. La OT cerrada en vuelo entra después de tocar el
 *       menú: abre Órdenes, no la tarjeta, y al volver a Cotización la línea
 *       que lo decía ya no está (Administración).
 *   1v-cronograma-se-va. Lo que entró del cronograma se va al salir de la
 *       orden; el Excel que no quedó sigue dicho (Diseño).
 *   1v-subida-se-va. «Cotización subida y enviada a Gerencia…» se va al salir
 *       de Cotización (Ventas).
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 * SOLO=1a,2 corre solo esas partes, y las que empiezan así (1i son 1i-volver,
 * 1i-sondeo y 1i-sin-senal; 1f también corre 1f-conserva; 1o, 1o-conteo; 1p,
 * las cinco de arriba; 1s, las cinco; 1t, las cuatro; 1u, las cuatro; 1v, las cinco).
 */
import ExcelJS from 'exceljs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  mtz: process.env.SUPERVISOR_MTZ ?? 'sup.mtz.local@metalwork.test',
  administracion: process.env.ADMINISTRACION ?? 'administracion.local@metalwork.test',
  almacen: process.env.ALMACEN ?? 'almacen.local@metalwork.test',
  requerimientos: process.env.REQUERIMIENTOS ?? 'requerimientos.local@metalwork.test',
  diseno: process.env.DISENO ?? 'diseno.local@metalwork.test',
  rrhh: process.env.RRHH ?? 'rrhh.local@metalwork.test',
  ventas: process.env.VENTAS ?? 'ventas.local@metalwork.test',
  gerencia: process.env.GERENCIA ?? 'gerencia.local@metalwork.test',
  operario: 'operario.giro@banco.test',
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
const existe = async (bucket, ruta) =>
  (await consulta(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, ruta ?? ''])).length === 1

/** Lo que haría `correo` desde la pantalla, con su sesión y su permiso: `set local role authenticated`. */
async function comoLaCuenta(correo, hacer) {
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claims', json_build_object('sub', (select id from usuarios where correo = $1), 'role', 'authenticated')::text, true)`, [correo])
    await base.query('set local role authenticated')
    await hacer()
    await base.query('commit')
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
  let ultimo = await Promise.resolve().then(leer).catch(() => null)
  while (!cumple(ultimo) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 250))
    ultimo = await Promise.resolve().then(leer).catch(() => null)
  }
  return ultimo
}
const esperarSubidas = (pagina) => pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })

const SE_ACTUALIZO = 'El sistema se actualizó mientras tenías la pantalla abierta'
const SIN_RESPUESTA = /No llegó la respuesta|Revisa la conexión|revisa la conexión/
const ID_VIEJO = 'f'.repeat(42)

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const CELULAR = { width: 390, height: 844 }
const GIRADO = { width: 844, height: 390 }

async function entrar(correo, viewport = { width: 1280, height: 900 }, { compilacion = false, sinSw = false } = {}) {
  const movil = viewport.width < 500
  // `sinSw`: sin el service worker, el documento también pasa por CDP y se puede demorar (`lento`).
  const contexto = await navegador.newContext({ viewport, isMobile: movil, hasTouch: movil, timezoneId: 'America/Lima', ...(sinSw ? { serviceWorkers: 'block' } : {}) })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    const t = m.text()
    // El 404 de la acción vieja y el error que Next anota por él son lo que se prueba.
    if (m.type() === 'error' && !/Failed to fetch|net::|404|UnrecognizedActionError|Server Action/.test(t)) errores.push(t.slice(0, 300))
  })
  // Lo que nadie atrapó: la consola lo anota con el texto de arriba, que se deja
  // pasar, y una acción desconocida sin atrapar se lleva la pantalla.
  pagina.on('pageerror', (e) => errores.push(`sin atrapar: ${String(e?.message ?? e).slice(0, 300)}`))
  await ir(pagina, `${BASE}/ingresar`)
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  await quieta(pagina)

  // `despliegue`: desde ahora cada acción sale con un id que el servidor no
  // conoce, como desde una pestaña vieja. `marca`: la acción cuyo cuerpo la
  // lleva se detiene antes de salir hasta `soltar()`; sale con el id que diga
  // `despliegue` en ese momento. Con `compilacion`, además, las respuestas RSC
  // llegan con otro x-nextjs-deployment-id mientras dure `despliegue`, como las
  // de otra compilación: con eso Next recarga el documento entero.
  //
  // `conservaIds`, con `despliegue`: el despliegue de todos los días. Next
  // guarda la clave de los ids en .next/cache y Vercel conserva esa carpeta,
  // así que el servidor nuevo conoce las acciones de la pestaña: no se cambia
  // el id, y lo que cambia es la compilación que dicen sus respuestas (la
  // cabecera, y en el cuerpo la `b` de Next y la que contesta
  // contarAvisosYDespliegue). La de la pantalla se lee de la página al entrar,
  // y la que la pestaña manda (la campana) sale como la de antes.
  //
  // `perder`: la respuesta de la acción cuyo cuerpo lo lleva no llega, como
  // con la señal que se corta después de que el servidor guardó.
  //
  // `lento`: { patron, ms }, los pedidos (no acciones) cuya dirección calza se
  // demoran `ms` antes de salir, como la pantalla de destino con poca señal.
  // `sesion` cuenta los pedidos a /auth/sesion, donde la pantalla refresca la
  // sesión antes de una acción.
  //
  // `cortarSubida`: la subida a Storage cuya ruta lo lleva se detiene como la
  // `marca`, y al soltarla se corta sin llegar, como la señal que se va.
  // `soltarLa(marca)` suelta solo la detenida con esa marca (o esa ruta).
  const cdp = await contexto.newCDPSession(pagina)
  const patrones = [{ urlPattern: '*', requestStage: 'Request' }]
  if (compilacion) patrones.push({ urlPattern: '*', requestStage: 'Response' })
  await cdp.send('Fetch.enable', { patterns: patrones })
  const corte = { despliegue: false, conservaIds: false, marca: null, retenidas: 0, esperan: [], acciones: 0, documentos: 0, rsc: 0, storage: [], reescritas: 0, perder: null, perdidas: 0, lento: null, demorados: 0, sesion: 0, cortarSubida: null }
  corte.compilacion = (await pagina.content()).match(/\\"compilacion\\":\\"([^\\"]+)\\"/)?.[1] ?? null
  corte.soltar = () => {
    for (const listo of corte.esperan.splice(0)) listo()
  }
  corte.soltarLa = (marca) => {
    const i = corte.esperan.findIndex((listo) => listo.marca?.includes(marca))
    if (i >= 0) corte.esperan.splice(i, 1)[0]()
    return i >= 0
  }
  const cuerpo = (r) =>
    r.postDataEntries?.length ? r.postDataEntries.map((x) => Buffer.from(x.bytes ?? '', 'base64').toString()).join('') : (r.postData ?? '')
  cdp.on('Fetch.requestPaused', async (e) => {
    const seguir = (extra = {}) => cdp.send('Fetch.continueRequest', { requestId: e.requestId, ...extra }).catch(() => {})
    const h = Object.fromEntries(Object.entries(e.request.headers).map(([k, v]) => [k.toLowerCase(), v]))
    if (e.responseStatusCode !== undefined || e.responseErrorReason !== undefined) {
      const responder = (extra = {}) => cdp.send('Fetch.continueResponse', { requestId: e.requestId, ...extra }).catch(() => seguir())
      if (h['next-action'] && corte.perder && !e.responseErrorReason) {
        const enviado = cuerpo(e.request)
        if (!enviado || enviado.includes(corte.perder)) {
          corte.perder = null
          corte.perdidas++
          return cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'ConnectionReset' }).catch(() => responder())
        }
      }
      if (!corte.despliegue || e.responseErrorReason) return responder()
      const responseHeaders = [...(e.responseHeaders ?? []).filter((x) => x.name.toLowerCase() !== 'x-nextjs-deployment-id'), { name: 'x-nextjs-deployment-id', value: 'compilacion-nueva' }]
      if (h['next-action']) {
        if (!corte.conservaIds || !corte.compilacion) return responder()
        // Lo que contesta el servidor nuevo a una acción que conoce: dice su compilación.
        const leido = await cdp.send('Fetch.getResponseBody', { requestId: e.requestId }).catch(() => null)
        if (!leido) return responder()
        const texto = Buffer.from(leido.body, leido.base64Encoded ? 'base64' : 'utf8').toString('utf8').split(corte.compilacion).join('compilacion-nueva')
        corte.reescritas++
        return cdp
          .send('Fetch.fulfillRequest', {
            requestId: e.requestId,
            responseCode: e.responseStatusCode,
            responseHeaders: responseHeaders.filter((x) => !/^(content-length|content-encoding|transfer-encoding)$/i.test(x.name)),
            body: Buffer.from(texto).toString('base64'),
          })
          .catch(() => responder())
      }
      if (h.rsc !== '1') return responder()
      return responder({ responseCode: e.responseStatusCode, responseHeaders })
    }
    if (e.resourceType === 'Document') corte.documentos++
    if (new URL(e.request.url).pathname === '/auth/sesion') corte.sesion++
    if (corte.lento && !h['next-action'] && corte.lento.patron.test(e.request.url)) {
      corte.demorados++
      await new Promise((listo) => setTimeout(listo, corte.lento.ms))
    }
    // El repintado, no lo que Next pide por adelantado de los enlaces.
    if (h.rsc === '1' && !h['next-action'] && !h['next-router-prefetch']) corte.rsc++
    const objeto = e.request.url.match(/\/storage\/v1\/object\/([^?]+)/)?.[1]
    if (objeto && e.request.method !== 'GET' && e.request.method !== 'OPTIONS') corte.storage.push(`${e.request.method} ${objeto}`)
    if (objeto && e.request.method === 'POST' && corte.cortarSubida && objeto.includes(corte.cortarSubida)) {
      corte.cortarSubida = null
      corte.retenidas++
      await new Promise((listo) => corte.esperan.push(Object.assign(listo, { marca: objeto })))
      return cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'ConnectionReset' }).catch(() => {})
    }
    if (e.request.method !== 'POST' || !h['next-action']) return seguir()
    corte.acciones++
    if (corte.marca && cuerpo(e.request).includes(corte.marca)) {
      const marca = corte.marca
      corte.marca = null
      corte.retenidas++
      await new Promise((listo) => corte.esperan.push(Object.assign(listo, { marca })))
    }
    if (!corte.despliegue) return seguir()
    if (corte.conservaIds) {
      // La compilación que manda la pestaña (la campana) es la de antes del despliegue.
      const enviado = cuerpo(e.request)
      if (!corte.compilacion || !enviado.includes(corte.compilacion)) return seguir()
      return seguir({ postData: Buffer.from(enviado.split(corte.compilacion).join('compilacion-vieja')).toString('base64') })
    }
    const headers = Object.entries(e.request.headers).map(([name, value]) => ({ name, value: name.toLowerCase() === 'next-action' ? ID_VIEJO : value }))
    return seguir({ headers })
  })
  return { pagina, contexto, errores, corte }
}

/** Las regiones `role="status"` montadas ahora, por id: la del botón tiene que estar desde antes. */
const regionesMontadas = (pagina) =>
  pagina.evaluate(() => [...document.querySelectorAll('[role="status"][id]')].map((e) => e.id))
/** El texto de lo que nombra `aria-describedby` del botón, o null. */
const loQueDescribe = (boton) =>
  boton.evaluate((b) => {
    const ids = b.getAttribute('aria-describedby')
    if (!ids) return null
    return ids.split(' ').map((id) => document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? `(${id} no existe)`).join(' | ')
  })
const idsQueDescribe = (boton) => boton.evaluate((b) => (b.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean))

/**
 * Anota, para cada región `role="status"` donde aparece `texto`, si ya estaba
 * montada al llamar: la que nace con su texto el lector no la anuncia.
 * `leer()` da la lista, en el orden en que aparecieron.
 */
async function vigilarElVerde(pagina, texto) {
  await pagina.evaluate((texto) => {
    for (const e of document.querySelectorAll('[role="status"]')) e.dataset.deAntes = '1'
    window.__verdes = []
    const mirar = () => {
      for (const e of document.querySelectorAll('[role="status"]')) {
        if (!e.dataset.vistoVerde && (e.textContent ?? '').includes(texto)) {
          e.dataset.vistoVerde = '1'
          window.__verdes.push(e.dataset.deAntes === '1')
        }
      }
    }
    new MutationObserver(mirar).observe(document.body, { subtree: true, childList: true, characterData: true })
  }, texto)
  return { leer: () => pagina.evaluate(() => window.__verdes ?? []) }
}

/** Lo que hace el teléfono al cambiar de aplicación y volver `ms` después: blur, y focus con el reloj adelantado. */
const salirYVolver = (pagina, ms = 31_000) =>
  pagina.evaluate((ms) => {
    window.dispatchEvent(new Event('blur'))
    const real = Date.now.bind(Date)
    Date.now = () => real() + ms
    window.dispatchEvent(new Event('focus'))
  }, ms)
/**
 * La sesión vence a la hora de entrar (el banco firma por 3600 s, como Supabase):
 * se adelanta `expires_at` de la sesión guardada en la cookie, y el token sigue
 * firmado como estaba. Devuelve cuándo vencía, en segundos.
 */
async function vencerLaSesion(contexto) {
  const partes = (await contexto.cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name))
  if (partes.length === 0) throw new Error('No hay cookie de sesión')
  const nombre = partes[0].name.replace(/\.\d+$/, '')
  let valor = decodeURIComponent(partes.map((c) => c.value).join(''))
  if (valor.startsWith('base64-')) valor = Buffer.from(valor.slice(7), 'base64url').toString('utf8')
  const sesion = JSON.parse(valor)
  const nueva = 'base64-' + Buffer.from(JSON.stringify({ ...sesion, expires_at: Math.floor(Date.now() / 1000) - 30 }), 'utf8').toString('base64url')
  // Una sola cookie basta; los trozos que hubiera se borran para que no se mezclen.
  await contexto.addCookies([
    { ...partes[0], name: nombre, value: nueva },
    ...partes.filter((c) => c.name !== nombre).map((c) => ({ ...c, value: '', expires: Math.floor(Date.now() / 1000) - 10 })),
  ])
  return sesion.expires_at
}
/** Cuándo vence la sesión que tiene ahora la cookie, en segundos (0 si no se lee). */
async function venceLaSesion(contexto) {
  const partes = (await contexto.cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name) && c.value).sort((a, b) => a.name.localeCompare(b.name))
  try {
    let valor = decodeURIComponent(partes.map((c) => c.value).join(''))
    if (valor.startsWith('base64-')) valor = Buffer.from(valor.slice(7), 'base64url').toString('utf8')
    return Number(JSON.parse(valor).expires_at) || 0
  } catch {
    return 0
  }
}
/** El reloj de la página, `ms` más tarde (sin salir ni volver). */
const adelantarElReloj = (pagina, ms) =>
  pagina.evaluate((ms) => {
    const antes = Date.now.bind(Date)
    Date.now = () => antes() + ms
  }, ms)
/** Una marca en `window` que solo una recarga del documento borra. */
const marcarDocumento = (pagina) => pagina.evaluate(() => { window.__mismoDocumento = 1 })
const mismoDocumento = (pagina) => pagina.evaluate(() => window.__mismoDocumento === 1).catch(() => false)
const avisoDeArriba = async (pagina) => limpio(await pagina.locator('[data-pestana-vieja]').innerText().catch(() => ''))
/** Lo que pasa al volver a la pestaña después del despliegue de todos los días: queda «nueva». */
const hastaLaPestanaNueva = async (pagina, corte) => {
  corte.despliegue = true
  corte.conservaIds = true
  await salirYVolver(pagina)
  await hasta(() => pagina.locator('[data-pestana-vieja="nueva"]').count(), (n) => n === 1, 15000)
}
/** Por qué «Volver a cargar» no recargó, como lo dice arriba la región que el lector oye. */
const sinRecargar = (pagina) => pagina.locator('[data-pestana-vieja] [data-sin-recargar]').innerText().then(limpio).catch(() => '')
const NO_ENTRO = 'Lo que enviaste no entró, o no se sabe si entró: lee el aviso junto a su botón antes de volver a cargar la pantalla.'
const EN_CAMINO = 'Lo que enviaste todavía no contesta. Si entra, la pantalla se vuelve a cargar sola; si la vuelves a cargar antes, no vas a saber si entró.'
const SE_VA = 'Lo que enviaste ya entró, y la pantalla a la que lleva tarda en abrir. Si no abre, vuelve a cargar: ya está guardado, no lo envíes de nuevo.'
const botonDeArriba = (pagina, nombre) => pagina.locator('[data-pestana-vieja]').getByRole('button', { name: nombre, exact: true })
/** Por el menú, como la persona: el enlace a `href` (si está plegado, se toca igual) y Next lleva sin recargar. */
async function porElMenu(pagina, href) {
  const enlaces = pagina.locator(`a[href="${href}"]`)
  await enlaces.first().waitFor({ state: 'attached', timeout: 15000 })
  const visible = await enlaces.evaluateAll((l) => l.findIndex((a) => a.checkVisibility()))
  if (visible >= 0) await enlaces.nth(visible).click()
  else await enlaces.first().evaluate((a) => a.click())
  await pagina.waitForURL((u) => u.pathname === href, { timeout: 30000 })
  await quieta(pagina)
}
/** La tarjeta que el navegador resalta (`:target`), por su id. */
const resaltada = (pagina) => pagina.evaluate(() => document.querySelector('li:target')?.id ?? null).catch(() => null)
const TEXTO_VIEJA =
  'El sistema se actualizó mientras tenías la pantalla abierta: lo que envíes desde aquí no va a entrar. Copia lo que tengas escrito y vuelve a cargar la pantalla.'
const TEXTO_NUEVA =
  'El sistema se actualizó mientras tenías la pantalla abierta. Lo que envíes todavía entra, pero al enviarlo la pantalla se vuelve a cargar y se pierde lo que tengas a medio escribir en otra parte de ella. Envía una cosa a la vez y vuelve a cargar la pantalla para ver lo nuevo.'
const TEXTO_VENTANA =
  'El sistema se actualizó mientras tenías la pantalla abierta: lo que envíes desde esta ventana no va a entrar. Copia lo que tengas escrito y vuelve a cargar la pantalla.'
/** Anota si la región del aviso de arriba nació vacía: la que nace con su texto el lector no la lee. */
const vigilarLaRegionDeArriba = (pagina) =>
  pagina.evaluate(() => {
    window.__regionVaciaPrimero = undefined
    new MutationObserver(() => {
      const r = document.querySelector('[data-region-pestana-vieja]')
      if (r && window.__regionVaciaPrimero === undefined) window.__regionVaciaPrimero = !r.textContent
    }).observe(document.body, { subtree: true, childList: true })
  })
const regionDeArriba = (pagina) =>
  pagina.evaluate(() => ({ rol: document.querySelector('[data-region-pestana-vieja]')?.getAttribute('role') ?? null, vacia: window.__regionVaciaPrimero }))

async function elegir(pagina, etiqueta, texto) {
  await pagina.getByRole('combobox', { name: etiqueta }).click()
  // Como en probar-reporte-diario: se escribe cuando la caja de búsqueda ya
  // tiene el foco, o las letras se pierden en el botón.
  const caja = pagina.locator('input[type="search"]:focus')
  await caja.waitFor({ timeout: 10000 })
  await caja.fill(texto)
  await pagina.getByRole('option', { name: new RegExp(texto) }).first().click()
}

function pdfConTexto(lineas) {
  const texto = lineas.map((l, i) => `BT /F1 11 Tf 50 ${780 - i * 18} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n')
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(texto, 'latin1')} >>\nstream\n${texto}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  let pdf = '%PDF-1.4\n'
  const posiciones = []
  objetos.forEach((o, i) => {
    posiciones.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  pdf += posiciones.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

/** Un material propio con 5 en stock, como en probar-fotos-al-cerrar: contar o sacar uno del catálogo le quitaría la salida a otras suites. */
async function materialPropio(codigo, descripcion) {
  const [{ id }] = await consulta(
    `insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
     values ($1, $2, (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1),
             (select id from public.unidades_medida where codigo = 'UND')) returning id`,
    [codigo, descripcion],
  )
  await consulta(
    `insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, precio_unitario, moneda, registrado_en)
     select gen_random_uuid(), 'INGRESO', $1, 5, 'INGRESO_GENERAL', 'Compra de banco', u.id, 2, 'PEN', now() - interval '1 hour'
     from public.usuarios u where u.correo = $2`,
    [id, CUENTAS.almacen],
  )
  return id
}

const sello = Date.now().toString().slice(-6)
const archivos = join(CAPTURAS, 'pestana-vieja')
mkdirSync(archivos, { recursive: true })

/**
 * La orden donde Diseño carga un cronograma: de las de antes del plan manual,
 * como en probar-documentos-al-elegir. En el banco, y solo aquí, vuelve a ser
 * «de antes» con los disparadores apagados.
 */
async function ordenParaElCronograma() {
  const [orden] = await consulta(`select id, plan_etapas_manual from ordenes_trabajo
                                  where cotizacion_pdf_id is null and estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA', 'BORRADOR') order by numero limit 1`)
  if (orden.plan_etapas_manual) {
    await base.query('begin')
    await base.query(`set local session_replication_role = replica`)
    await base.query(`update ordenes_trabajo set plan_etapas_manual = false where id = $1`, [orden.id])
    await base.query('commit')
  }
  return orden
}
/** Un Excel con dos actividades de 60 % en Acabados: la pantalla lo marca en rojo y deja cargarlo, y la base lo rechaza porque suman más de 100. */
async function cronogramaQuePasaDeCien(actividad, nombre) {
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet('Cronograma')
  hoja.addRow(['Área', 'Actividad', 'Referencia', 'Peso (%)', 'Inicio', 'Fin'])
  hoja.addRow(['Acabados', actividad, null, 60, null, null])
  hoja.addRow(['Acabados', `${actividad} B`, null, 60, null, null])
  const ruta = join(archivos, nombre)
  await libro.xlsx.writeFile(ruta)
  return ruta
}
const fotos = {}
{
  const p = await (await navegador.newContext()).newPage()
  for (const [n, color] of [['a', '#7a4b2a'], ['b', '#3a3f44'], ['c', '#2a5a7a'], ['d', '#5a7a2a'], ['e', '#7a2a5a']]) {
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
    fotos[n] = join(archivos, `vieja-${n}-${sello}.jpg`)
    writeFileSync(fotos[n], Buffer.from(b64, 'base64'))
  }
  await p.context().close()
}
const SOLO = process.env.SOLO?.split(',')
const corre = (parte) => !SOLO || SOLO.some((s) => parte === s || parte.startsWith(s))

// ------------------------------------------- 1a y 1b. «Reportar» un trabajo sin orden (Maestranza)
if (corre('1a') || corre('1b')) {
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz)
  await ir(pagina, `${BASE}/avance/trabajos/nueva`)
  await pagina.fill('#descripcion', `Tolva de la pestaña vieja ${sello}`)
  await pagina.fill('#trabajo', 'Cambio de compuerta')
  await Promise.all([
    pagina.waitForURL((u) => /^\/avance\/trabajos\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 }),
    pagina.getByRole('button', { name: 'Registrar el trabajo' }).click(),
  ])
  await quieta(pagina)
  const flotaId = new URL(pagina.url()).pathname.split('/').pop()
  const enStorage = async () =>
    (await consulta(`select name from storage.objects where bucket_id = 'fotos-avance' and name like $1 order by created_at`, [`flota/${flotaId}/%`])).map((x) => x.name)
  const reportes = async () => Number((await consulta(`select count(*) n from flota_avances where flota_id = $1`, [flotaId]))[0].n)
  const ventana = pagina.locator('[role="dialog"]', { has: pagina.locator('#rf-descripcion') })
  const reportar = pagina.getByRole('button', { name: 'Reportar', exact: true })
  const abrir = async (foto) => {
    await reportar.click()
    await ventana.waitFor({ timeout: 10000 })
    await ventana.locator('input[type="file"]:not([capture])').setInputFiles(foto)
    await esperarSubidas(pagina)
  }

  if (corre('1a')) {
    await abrir(fotos.a)
    const [ruta] = await enStorage()
    await ventana.locator('#rf-descripcion').fill(`1a ${sello}: se cortó la compuerta`)
    const a0 = corte.acciones
    corte.despliegue = true
    await ventana.getByRole('button', { name: 'Registrar', exact: true }).click()
    const dice = limpio(await hasta(() => ventana.getByRole('alert').allInnerTexts().then((t) => t.join(' ')), (t) => t?.includes(SE_ACTUALIZO)))
    const quitada = !(await hasta(() => existe('fotos-avance', ruta), (v) => v === false, 10000))
    const miniaturas = await ventana.locator('img').count()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1a-ventana.png') })
    comprobar(dice.includes(SE_ACTUALIZO) && dice.includes('elige las fotos otra vez') && !SIN_RESPUESTA.test(dice) && corte.acciones - a0 === 1,
      `[Maestranza 1280] 1a. ventana abierta, pestaña vieja: dice que hay que recargar y elegir las fotos otra vez, sin «revisa la conexión», en una sola llamada («${dice}», ${corte.acciones - a0} llamada)`)
    comprobar(Boolean(ruta) && quitada && miniaturas === 0 && (await reportes()) === 0,
      `[Maestranza 1280] 1a. la foto se quita de Storage y de la ventana, sin esperar a «Cancelar», y no hay reporte (quitada ${quitada}, miniaturas ${miniaturas})`)
    await ventana.getByRole('button', { name: 'Cancelar' }).click()
    await hasta(() => ventana.count(), (n) => n === 0, 5000)
    corte.despliegue = false
  }

  if (corre('1b')) {
    const antes = new Set(await regionesMontadas(pagina))
    await abrir(fotos.b)
    const [ruta] = (await enStorage()).slice(-1)
    const marca = `1b ${sello}`
    await ventana.locator('#rf-descripcion').fill(`${marca}: se soldaron los refuerzos`)
    corte.marca = marca
    await ventana.getByRole('button', { name: 'Registrar', exact: true }).click()
    const retenido = (await hasta(() => corte.retenidas, (n) => n >= 1)) >= 1
    await ventana.getByRole('button', { name: 'Cancelar' }).click()
    const cerro = (await hasta(() => ventana.count(), (n) => n === 0, 5000)) === 0
    const ocupado = (await reportar.getAttribute('aria-disabled')) === 'true'
    const describe = await hasta(() => loQueDescribe(reportar), (t) => Boolean(t), 5000)
    const [idEstado] = await idsQueDescribe(reportar)
    comprobar(retenido && cerro && ocupado && describe === 'El reporte se sigue enviando: lo que conteste se dice aquí.' && antes.has(idEstado),
      `[Maestranza 1280] 1b. cerrada en vuelo, «Reportar» gira y su aria-describedby nombra «se sigue enviando», en una región montada desde antes (retenido ${retenido}, ocupado ${ocupado}, «${describe}», de antes ${antes.has(idEstado)})`)
    corte.despliegue = true
    corte.soltar()
    const desenlace = limpio(await hasta(() => pagina.getByRole('alert').filter({ hasText: 'que se estaba enviando' }).allInnerTexts().then((t) => t.join(' ')), Boolean))
    const libre = await hasta(() => reportar.getAttribute('aria-disabled'), (v) => v === null, 5000)
    const quitada = !(await hasta(() => existe('fotos-avance', ruta), (v) => v === false, 10000))
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1b-fila.png') })
    comprobar(desenlace === 'El reporte que se estaba enviando no se registró: el sistema se actualizó mientras tenías la pantalla abierta. Vuelve a cargar la pantalla y envíalo otra vez.',
      `[Maestranza 1280] 1b. al contestar el servidor que la acción no existe, junto al botón: «${desenlace}»`)
    comprobar(libre === null && (await reportar.getAttribute('aria-describedby')) === null && quitada && (await reportes()) === 0,
      `[Maestranza 1280] 1b. el botón se libera y deja de nombrar el estado, la foto se quita y no hay reporte (quitada ${quitada})`)
    corte.despliegue = false

    // Y el que sí entra con la ventana ya cerrada: su verde sale en una región
    // que estaba montada (vigesimonovena pasada).
    await abrir(fotos.e)
    const marcaOk = `1b-ok ${sello}`
    await ventana.locator('#rf-descripcion').fill(`${marcaOk}: se pintó la compuerta`)
    corte.marca = marcaOk
    await ventana.getByRole('button', { name: 'Registrar', exact: true }).click()
    await hasta(() => corte.retenidas, (n) => n >= 2)
    await ventana.getByRole('button', { name: 'Cancelar' }).click()
    await hasta(() => ventana.count(), (n) => n === 0, 5000)
    const verde = await vigilarElVerde(pagina, 'Reporte registrado')
    corte.soltar()
    const verdes = await hasta(verde.leer, (v) => v?.length > 0, 20000)
    const dice = limpio(await pagina.getByRole('status').filter({ hasText: 'Reporte registrado' }).first().innerText().catch(() => ''))
    comprobar(verdes?.[0] === true && dice.startsWith('Reporte registrado') && (await reportes()) === 1,
      `[Maestranza 1280] 1b. cerrada en vuelo, «${dice}» sale en una región montada desde antes, que el lector anuncia (${JSON.stringify(verdes)})`)
  }
  comprobar(errores.length === 0, `[Maestranza 1280] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1c. Otra versión del contrato de un subcontrato (Administración)
if (corre('1c')) {
  const vigente = () => consulta(`select id, numero from subcontratos where estado <> 'ANULADO' order by numero limit 1`)
  let [sc] = await vigente()
  if (!sc) {
    // En un banco nuevo no hay ninguno: se registra uno con la sesión y el
    // permiso de Administración, como lo haría ella (nunca ADMIN).
    await comoLaCuenta(CUENTAS.administracion, async () => {
      const [{ id: quien }] = await consulta(`select gen_random_uuid() as id`)
      await consulta(`select public.guardar_subcontratista($1::uuid, '10043200017', 'Subcontratista de la pestaña vieja', null, null, null, null, true)`, [quien])
      await consulta(`select public.registrar_subcontrato(gen_random_uuid(), $1::uuid, 'PLANTA', $2, 'PEN', 1000, null, null, 'MTZ')`, [quien, `Pintura de la tolva ${sello}`])
    })
    ;[sc] = await vigente()
  }
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'subcontratos' and o.name like $1
        and not exists (select 1 from subcontrato_contratos c where c.archivo_ruta = o.name)
        and not exists (select 1 from recibos_honorarios r where r.archivo_ruta = o.name)`, [`${sc?.id}/%`])).length
  const contratos = async () => Number((await consulta(`select count(*) n from subcontrato_contratos where subcontrato_id = $1`, [sc?.id]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion)
  await ir(pagina, `${BASE}/subcontratos/${sc?.id}`)
  const sueltosAntes = await sueltos()
  const n0 = await contratos()
  await pagina.locator('[data-adjuntar-contrato]').first().click()
  const v = pagina.locator('[role="dialog"]').filter({ hasText: `contrato de ${sc?.numero}` })
  await v.waitFor({ timeout: 30000 })
  const pdf = Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n%vieja ${sello} ${'x'.repeat(1500)}\ntrailer<</Root 1 0 R>>\n%%EOF\n`)
  await v.locator('input[type=file]').first().setInputFiles({ name: `contrato-vieja-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdf })
  await pagina.waitForTimeout(1200)
  const a0 = corte.acciones
  corte.despliegue = true
  const t0 = Date.now()
  await v.getByRole('button', { name: 'Adjuntar', exact: true }).click()
  const dice = limpio(await hasta(() => v.getByRole('alert').allInnerTexts().then((t) => t.join(' ')), (t) => t?.includes(SE_ACTUALIZO) || SIN_RESPUESTA.test(t ?? ''), 30000))
  const tardo = Date.now() - t0
  const sueltosDespues = await hasta(sueltos, (n) => n === sueltosAntes, 10000)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1c-contrato.png') })
  comprobar(dice.includes(SE_ACTUALIZO) && !SIN_RESPUESTA.test(dice) && corte.acciones - a0 === 1,
    `[Administración 1280] 1c. el contrato desde la pestaña vieja dice que hay que recargar, en una sola llamada, sin la pausa (${tardo} ms; «${dice}»; ${corte.acciones - a0} llamada)`)
  comprobar(sueltosDespues === sueltosAntes && (await contratos()) === n0,
    `[Administración 1280] 1c. el archivo subido se quita y no hay contrato nuevo (sueltos ${sueltosAntes} → ${sueltosDespues})`)
  // Ya se sabe vieja: el segundo intento ni sube el archivo ni llama a la acción.
  const s1 = corte.storage.length
  const a1 = corte.acciones
  await v.getByRole('button', { name: 'Adjuntar', exact: true }).click()
  await pagina.waitForTimeout(2000)
  const otraVez = limpio(await v.getByRole('alert').allInnerTexts().then((t) => t.join(' ')))
  comprobar(otraVez.includes(SE_ACTUALIZO) && corte.storage.length === s1 && corte.acciones === a1 && (await sueltos()) === sueltosAntes,
    `[Administración 1280] 1c. el segundo «Adjuntar», con la pestaña ya sabida vieja, no sube nada ni llama a la acción (${corte.storage.length - s1} pedidos a Storage, ${corte.acciones - a1} llamadas)`)
  corte.despliegue = false
  await v.getByRole('button', { name: 'Cancelar' }).click().catch(() => {})
  comprobar(errores.length === 0, `[Administración 1280] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1d. El conteo inicial del kardex (Almacén)
if (corre('1d')) {
  // Un material propio, como en probar-fotos-al-cerrar: contar uno del catálogo le quitaría la salida a otras suites.
  const codigo = `QA-VIEJA-${sello}`
  const [{ id: materialId }] = await consulta(
    `insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
     values ($1, $2, (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1),
             (select id from public.unidades_medida where codigo = 'UND')) returning id`,
    [codigo, `Trapo de la pestaña vieja ${sello}`],
  )
  await consulta(
    `insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, precio_unitario, moneda, registrado_en)
     select gen_random_uuid(), 'INGRESO', $1, 5, 'INGRESO_GENERAL', 'Compra de banco', u.id, 2, 'PEN', now() - interval '1 hour'
     from public.usuarios u where u.correo = $2`,
    [materialId, CUENTAS.almacen],
  )
  const movimientos = async () => Number((await consulta(`select count(*) n from movimientos_materiales where material_id = $1`, [materialId]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.almacen)
  await ir(pagina, `${BASE}/almacen/kardex`)
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(await (await pagina.request.get(`${BASE}/almacen/kardex/conteo-inicial`)).body())
  const hoja = libro.getWorksheet('Conteo')
  let encabezado = 0
  hoja.eachRow((f, n) => {
    if (!encabezado && f.values.includes('Cantidad contada')) encabezado = n
  })
  for (let n = encabezado + 1; n <= hoja.rowCount; n++) {
    if (String(hoja.getCell(n, 1).value) === codigo) hoja.getCell(n, 5).value = Number(hoja.getCell(n, 4).value) + 1
    else hoja.getCell(n, 5).value = null
  }
  const lleno = join(archivos, `conteo-vieja-${sello}.xlsx`)
  await libro.xlsx.writeFile(lleno)
  await pagina.getByRole('button', { name: 'Conteo inicial' }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor()
  // Al leer el Excel.
  corte.despliegue = true
  await v.locator('#conteo-inicial-archivo').setInputFiles(lleno)
  const alLeer = limpio(await hasta(() => v.innerText(), (t) => t?.includes(SE_ACTUALIZO) || /No se pudo leer/.test(t ?? ''), 20000))
  comprobar(alLeer.includes(SE_ACTUALIZO) && !/revisa la conexión/.test(alLeer),
    `[Almacén 1280] 1d. leer el conteo desde la pestaña vieja dice que hay que recargar, no «revisa la conexión y elígelo otra vez»`)
  // Al registrar: la ventana otra vez, con el mismo Excel.
  corte.despliegue = false
  await pagina.keyboard.press('Escape')
  await hasta(() => v.count(), (n) => n === 0, 5000)
  await pagina.getByRole('button', { name: 'Conteo inicial' }).click()
  await v.waitFor()
  await v.locator('#conteo-inicial-archivo').setInputFiles(lleno)
  const boton = v.getByRole('button', { name: 'Registrar 1 material' })
  await boton.waitFor({ timeout: 30000 })
  const m0 = await movimientos()
  const a0 = corte.acciones
  corte.despliegue = true
  await boton.click()
  const alRegistrar = limpio(await hasta(() => v.innerText(), (t) => /el sistema se actualizó|No se confirmó/i.test(t ?? ''), 20000))
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1d-conteo.png') })
  comprobar(/el sistema se actualizó mientras tenías la pantalla abierta/i.test(alRegistrar) && !/No se confirmó/.test(alRegistrar) && corte.acciones - a0 === 1 && (await movimientos()) === m0,
    `[Almacén 1280] 1d. registrar el conteo desde la pestaña vieja dice que hay que recargar, en una sola llamada, y no registra nada (${corte.acciones - a0} llamada)`)
  // La causa una vez, en el resumen que recibe el cursor; las filas sin alerta
  // propia; y en vez de «Registrar», que fallaría igual, volver a cargar.
  const resumen = limpio(await pagina.evaluate(() => document.activeElement?.textContent ?? ''))
  const alertas = await v.getByRole('alert').filter({ hasText: /actualizó/ }).count()
  const fila = limpio(await v.getByText('No salió: el sistema se actualizó.').first().innerText().catch(() => ''))
  const registrarOtraVez = await v.getByRole('button', { name: /^Registrar \d/ }).count()
  const recargar = v.getByRole('button', { name: 'Volver a cargar la pantalla' })
  comprobar(resumen === 'No se registró ningún material; 1 no salió porque el sistema se actualizó mientras tenías la pantalla abierta. Vuelve a cargar la pantalla y elige el archivo otra vez: lo registrado no se duplica.',
    `[Almacén 1280] 1d. el resumen enfocado dice la causa y qué hacer («${resumen}»)`)
  comprobar(alertas === 0 && fila === 'No salió: el sistema se actualizó.' && registrarOtraVez === 0 && (await recargar.count()) === 1,
    `[Almacén 1280] 1d. la fila dice «${fila}» sin alerta propia (${alertas}); no queda «Registrar» (${registrarOtraVez}) y sí «Volver a cargar la pantalla»`)
  comprobar((await avisoDeArriba(pagina)).startsWith(SE_ACTUALIZO), `[Almacén 1280] 1d. y arriba de la pantalla lo dice también («${await avisoDeArriba(pagina)}»)`)
  corte.despliegue = false
  await marcarDocumento(pagina)
  if (await recargar.count()) await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}), recargar.click()])
  comprobar(!(await mismoDocumento(pagina)) && (await pagina.locator('[data-pestana-vieja]').count()) === 0,
    `[Almacén 1280] 1d. «Volver a cargar la pantalla» la recarga, y ya sin el aviso de arriba`)
  comprobar(errores.length === 0, `[Almacén 1280] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1e y 1i. El reporte diario a medio llenar (Maestranza, a 390)
if (['1e', '1i-volver', '1i-sondeo', '1i-sin-senal', '1l', '1m', '1n', '1o', '1p-rechazo', '1p-sin-respuesta', '1p-colgado', '1p-destino-lento', '1p-se-va', '1r'].some(corre)) {
  // Una persona de Maestranza para el trabajo, como la dejaría RR. HH.; al
  // final se le pone su costo y se da de baja. Para enviar no hace falta.
  const persona = `Pedro ${sello}`
  await consulta(
    `insert into trabajadores (nombres, apellidos, dni, cargo, area_id, creado_por)
     select $1, 'Prueba Pestaña Vieja', '5' || $2 || '01', 'Soldador', (select id from areas where codigo = 'MTZ'), (select id from usuarios where correo = $3)`,
    [persona, sello.slice(-5), CUENTAS.rrhh],
  )
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.mtz])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const subidas = async () =>
    (await consulta(`select name from storage.objects where bucket_id = 'fotos-reporte-diario' and owner_id = $1 and created_at >= $2 order by created_at`, [yo, desde])).map((o) => o.name)
  const asunto = `Pestaña vieja ${sello}`
  const reportes = async () => Number((await consulta(`select count(*) n from reportes_diarios where asunto = $1`, [asunto]))[0].n)
  // `sinPersona`: nadie elegido, y la acción lo rechaza («Pon al menos a una persona…»).
  const llenar = async (pagina, conFoto, { sinPersona = false } = {}) => {
    await ir(pagina, `${BASE}/reportes-diarios/nuevo`)
    await pagina.fill('#rd-codigo', 'PLANTA')
    await pagina.fill('#rd-asunto', asunto)
    await pagina.fill('#rd-descripcion', 'Se ordenó la planta y se soldaron los soportes.')
    const t1 = pagina.locator('fieldset[data-trabajo="1"]')
    await elegir(pagina, 'Trabajo 1: sobre qué', 'Tarea nueva')
    await t1.locator('textarea').fill('Soportes de la tolva')
    await t1.locator('input[type="number"]').first().fill('30')
    if (!sinPersona) {
      await elegir(pagina, 'Personal del trabajo 1: persona 1', persona)
      await pagina.getByRole('spinbutton', { name: 'Personal del trabajo 1: horas de la persona 1' }).fill('2')
    }
    if (conFoto) {
      await pagina.locator('input[type="file"]:not([capture])').first().setInputFiles(fotos.d)
      await esperarSubidas(pagina)
    }
    // El último toque fuera de un campo, como al cerrar el teclado tocando el
    // título: con el cursor en un campo, RefrescoAlVolver espera de todos modos.
    await pagina.locator('main h1').first().click()
  }
  // La foto a la vista: su miniatura. Al quitarla por la pestaña vieja queda
  // en la lista con su miniatura y «Se quitó» encima.
  const miniaturas = (pagina) => pagina.locator('main img[alt^="vieja-d-"]').count()
  const subirReporte = (pagina) => pagina.getByRole('button', { name: 'Subir reporte' })

  // Sin despliegue: al volver se repinta, sin recargar el documento y sin aviso.
  if (corre('1e')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, false)
    await marcarDocumento(pagina)
    const r0 = corte.rsc
    const d0 = corte.documentos
    await salirYVolver(pagina)
    const repinto = await hasta(() => corte.rsc - r0, (n) => n > 0, 10000)
    await quieta(pagina)
    comprobar(repinto > 0 && corte.documentos === d0 && (await mismoDocumento(pagina)) && (await pagina.inputValue('#rd-asunto')) === asunto && (await pagina.locator('[data-region-pestana-vieja]').count()) === 0,
      `[Maestranza 390] 1e. sin despliegue, al volver tras 31 s se repinta sin recargar, lo escrito sigue y arriba no hay aviso ni su región (${repinto} pedidos RSC, ${corte.documentos - d0} documentos)`)
    comprobar(errores.length === 0, `[Maestranza 390] 1e. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // Un despliegue que cambia los ids: al volver no se recarga sola, lo dice
  // arriba, y la foto ya subida se quita en el acto (trigésima pasada: antes
  // se quedaba hasta «Subir reporte», y al recargar como pedía el aviso quedaba suelta).
  if (corre('1e')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await marcarDocumento(pagina)
    await vigilarLaRegionDeArriba(pagina)
    const d0 = corte.documentos
    corte.despliegue = true
    await salirYVolver(pagina)
    const arriba = limpio(await hasta(() => avisoDeArriba(pagina), Boolean, 15000))
    const quitada = !(await hasta(() => existe('fotos-reporte-diario', ruta), (v) => v === false, 10000))
    await pagina.waitForTimeout(1500)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1e-al-volver.png'), fullPage: true })
    const mismo = await mismoDocumento(pagina)
    const escrito = await pagina.inputValue('#rd-asunto')
    comprobar(corte.documentos === d0 && mismo && escrito === asunto,
      `[Maestranza 390] 1e. con despliegue, al volver tras 31 s la pantalla no se recarga sola: lo escrito sigue (mismo documento ${mismo}, asunto «${escrito}»)`)
    comprobar(arriba === `${TEXTO_VIEJA} Volver a cargar` && (await pagina.locator('[data-pestana-vieja="vieja"]').count()) === 1,
      `[Maestranza 390] 1e. y arriba lo dice, con «Volver a cargar» («${arriba}»)`)
    const region = await regionDeArriba(pagina)
    comprobar(region.rol === 'status' && region.vacia === true,
      `[Maestranza 390] 1e. el aviso de arriba nace en una región role=status montada antes que su texto (role ${region.rol}, vacía primero ${region.vacia})`)
    const alerta = limpio(await pagina.locator('[data-fotos-quitadas]').innerText().catch(() => ''))
    const alertas = await pagina.locator('main [role="alert"]').filter({ hasText: /se quitó|se quitaron/ }).count()
    const tarjeta = limpio(await pagina.locator('main').getByText('Se quitó', { exact: true }).first().innerText().catch(() => ''))
    comprobar(Boolean(ruta) && quitada && (await miniaturas(pagina)) === 1 && tarjeta === 'Se quitó'
      && alerta === 'La foto ya subida se quitó: el sistema se actualizó. Vuelve a cargar la pantalla y elígela otra vez.' && alertas === 1,
      `[Maestranza 390] 1e. la foto ya subida se quita de Storage en el acto y queda con su miniatura y «Se quitó» encima, con una sola alerta que pide elegirla otra vez («${alerta}»; quitada ${quitada}, ${alertas} alerta)`)
    const ayuda = await pagina.getByText('Vuelve a cargar la pantalla para subir el reporte.', { exact: true }).count()
    comprobar(ayuda === 1 && (await pagina.getByText(/Quita o vuelve a subir/).count()) === 0 && (await subirReporte(pagina).isDisabled()) && (await reportes()) === 0,
      `[Maestranza 390] 1e. debajo dice «Vuelve a cargar la pantalla para subir el reporte.», no «Quita o vuelve a subir», y «Subir reporte» no se deja tocar`)
    // Ya se sabe vieja: la foto que se elija ahora ni sube. Al recargar, como
    // pide el aviso, quedaría suelta.
    const s1 = corte.storage.length
    await pagina.locator('input[type="file"]:not([capture])').first().setInputFiles(fotos.a)
    const noSubio = limpio(await hasta(() => pagina.getByRole('alert').filter({ hasText: 'No se subió' }).allInnerTexts().then((t) => t.join(' ')), Boolean, 15000))
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1e-otra-foto.png'), fullPage: true })
    comprobar(noSubio.endsWith(': No se subió: el sistema se actualizó. Vuelve a cargar la pantalla y elígela otra vez.') && corte.storage.length === s1
      && (await pagina.getByRole('button', { name: /^Volver a subir/ }).count()) === 0 && (await subidas()).length === 0,
      `[Maestranza 390] 1e. la foto elegida después no sube, lo dice y no ofrece «Reintentar» («${noSubio}»; ${corte.storage.length - s1} pedidos a Storage)`)
    corte.despliegue = false
    comprobar(errores.length === 0, `[Maestranza 390] 1e. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // Descubierta al enviar: lo dice el aviso junto al botón; el de arriba está,
  // pero sin región que lo anuncie otra vez, y la foto no suma otra alerta
  // (trigésima pasada: el lector lo oía dos veces seguidas).
  if (corre('1e')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    corte.despliegue = true
    await subirReporte(pagina).click()
    const dice = limpio(await hasta(() => pagina.locator('main [role="alert"]').filter({ hasText: SE_ACTUALIZO }).allInnerTexts().then((t) => t.join(' ')), Boolean))
    const quitada = !(await hasta(() => existe('fotos-reporte-diario', ruta), (v) => v === false, 10000))
    const arriba = limpio(await hasta(() => avisoDeArriba(pagina), Boolean, 5000))
    await pagina.waitForTimeout(800)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1e-enviar.png'), fullPage: true })
    comprobar(dice === 'El sistema se actualizó mientras tenías la pantalla abierta: no se registró. Copia lo escrito, vuelve a cargar la pantalla y elige las fotos otra vez.',
      `[Maestranza 390] 1e. «Subir reporte» desde la pestaña vieja pide elegir las fotos otra vez («${dice}»)`)
    comprobar(quitada && (await miniaturas(pagina)) === 0 && (await reportes()) === 0 && (await pagina.inputValue('#rd-asunto')) === asunto,
      `[Maestranza 390] 1e. la foto se quita de Storage y de la pantalla, no hay reporte y lo escrito sigue para copiarlo (quitada ${quitada})`)
    comprobar(arriba === `${TEXTO_VIEJA} Volver a cargar` && (await pagina.locator('[data-region-pestana-vieja]').count()) === 0 && (await pagina.locator('[data-fotos-quitadas]').count()) === 0,
      `[Maestranza 390] 1e. arriba lo dice sin región que lo anuncie otra vez, y la foto no suma su propia alerta («${arriba}»)`)
    corte.despliegue = false
    comprobar(errores.length === 0, `[Maestranza 390] 1e. al enviar, sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1i. El despliegue de todos los días: el servidor nuevo conoce las acciones
  // de la pestaña (la clave de sus ids dura 14 días y Vercel la conserva), así
  // que nada vuelve 404. Antes la pestaña no se enteraba, `router.refresh()`
  // recargaba el documento entero y se perdía lo escrito y la foto (X3 de la
  // crítica de la trigésima). Ahora la pregunta por los avisos trae de qué
  // despliegue es el servidor.
  if (corre('1i-volver')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    comprobar(Boolean(corte.compilacion), `[Maestranza 390] 1i. la pantalla trae de qué compilación es («${corte.compilacion}»)`)
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await marcarDocumento(pagina)
    await vigilarLaRegionDeArriba(pagina)
    const d0 = corte.documentos
    const r0 = corte.rsc
    corte.despliegue = true
    corte.conservaIds = true
    await salirYVolver(pagina)
    const arriba = limpio(await hasta(() => avisoDeArriba(pagina), Boolean, 15000))
    await pagina.waitForTimeout(2000)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1i-al-volver.png'), fullPage: true })
    const mismo = await mismoDocumento(pagina)
    const escrito = await pagina.inputValue('#rd-asunto')
    comprobar(corte.reescritas > 0 && corte.documentos === d0 && corte.rsc === r0 && mismo && escrito === asunto,
      `[Maestranza 390] 1i. el servidor nuevo contesta la pregunta (${corte.reescritas} respuestas de otra compilación) y la pantalla no se recarga ni se repinta: lo escrito sigue (${corte.rsc - r0} pedidos RSC, ${corte.documentos - d0} documentos)`)
    comprobar(arriba === `${TEXTO_NUEVA} Volver a cargar` && (await pagina.locator('[data-pestana-vieja="nueva"]').count()) === 1,
      `[Maestranza 390] 1i. arriba dice que el sistema se actualizó: lo que envíe entra, pero la pantalla se vuelve a cargar («${arriba}»)`)
    const region = await regionDeArriba(pagina)
    comprobar(region.rol === 'status' && region.vacia === true,
      `[Maestranza 390] 1i. en una región role=status montada antes que su texto (role ${region.rol}, vacía primero ${region.vacia})`)
    comprobar(Boolean(ruta) && (await miniaturas(pagina)) === 1 && (await existe('fotos-reporte-diario', ruta)) && (await pagina.locator('[data-fotos-quitadas]').count()) === 0 && !(await subirReporte(pagina).isDisabled()),
      `[Maestranza 390] 1i. la foto sigue y «Subir reporte» también: con la acción viva el reporte todavía entra`)
    // «Volver a cargar»: antes de recargar, quita la foto que nadie va a nombrar
    // (X4 de la crítica). La recarga se ve en la marca de `window`: el pedido del
    // documento lo hace el service worker, y no pasa por esta sesión de CDP.
    await Promise.all([
      pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}),
      pagina.locator('[data-pestana-vieja]').getByRole('button', { name: 'Volver a cargar' }).click(),
    ])
    corte.despliegue = false
    corte.conservaIds = false
    await quieta(pagina)
    const quitada = !(await existe('fotos-reporte-diario', ruta))
    const recargo = !(await mismoDocumento(pagina))
    const avisos = await pagina.locator('[data-pestana-vieja]').count()
    comprobar(recargo && quitada && avisos === 0,
      `[Maestranza 390] 1i. «Volver a cargar» quita la foto ya subida y recién después recarga; la pantalla nueva sale sin aviso (quitada ${quitada}, recargó ${recargo}, ${avisos} avisos)`)
    comprobar(errores.length === 0, `[Maestranza 390] 1i. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1i. Lo mismo sin salir de la pantalla: el sondeo de cada minuto.
  if (corre('1i-sondeo')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, false)
    await marcarDocumento(pagina)
    const d0 = corte.documentos
    const r0 = corte.rsc
    corte.despliegue = true
    corte.conservaIds = true
    const arriba = limpio(await hasta(() => avisoDeArriba(pagina), Boolean, 75000))
    const mismo = await mismoDocumento(pagina)
    comprobar(arriba.startsWith(TEXTO_NUEVA) && mismo && corte.documentos === d0 && corte.rsc === r0 && (await pagina.inputValue('#rd-asunto')) === asunto,
      `[Maestranza 390] 1i. sin salir, el sondeo de cada minuto lo dice arriba sin recargar ni repintar (${corte.rsc - r0} pedidos RSC, mismo documento ${mismo})`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1i. sondeo, sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1i. Sin señal al volver: la pregunta no llega y no se repinta. Antes Next
  // pedía la pantalla entera al navegador, salía la página sin conexión y se
  // llevaba lo escrito (D1 de diseño y H2 de funcionamiento, de main). Y al
  // volver la señal, con la acción viva, el reporte entra desde la pestaña
  // del despliegue anterior.
  if (corre('1i-sin-senal')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await marcarDocumento(pagina)
    const d0 = corte.documentos
    await contexto.setOffline(true)
    await salirYVolver(pagina)
    await pagina.waitForTimeout(4000)
    const mismo = await mismoDocumento(pagina)
    const escrito = await pagina.inputValue('#rd-asunto').catch(() => '')
    const titulo = await pagina.title().catch(() => '')
    const fotoSigue = await miniaturas(pagina)
    await contexto.setOffline(false)
    comprobar(mismo && corte.documentos === d0 && escrito === asunto && fotoSigue === 1 && (await pagina.locator('[data-pestana-vieja]').count()) === 0,
      `[Maestranza 390] 1i. sin señal, al volver tras 31 s no sale la página sin conexión: lo escrito y la foto siguen y arriba no dice nada («${titulo}», mismo documento ${mismo})`)

    corte.despliegue = true
    corte.conservaIds = true
    await salirYVolver(pagina)
    await hasta(() => avisoDeArriba(pagina), Boolean, 15000)
    const n0 = await reportes()
    await Promise.all([
      pagina.waitForURL((u) => /^\/reportes-diarios\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 }).catch(() => {}),
      subirReporte(pagina).click(),
    ])
    await quieta(pagina)
    const [rd] = await consulta(
      `select r.id, (select count(*)::int from reporte_diario_fotos f where f.reporte_id = r.id and f.ruta = $2) as fotos
       from reportes_diarios r where r.asunto = $1 order by r.creado_en desc limit 1`,
      [asunto, ruta],
    )
    const llego = new URL(pagina.url()).pathname
    corte.despliegue = false
    corte.conservaIds = false
    comprobar((await reportes()) === n0 + 1 && rd?.fotos === 1 && llego === `/reportes-diarios/${rd?.id}`,
      `[Maestranza 390] 1i. con la acción viva, «Subir reporte» desde la pestaña del despliegue anterior entra con su foto y lleva al reporte (${llego})`)
    comprobar(errores.length === 0, `[Maestranza 390] 1i. sin señal y al enviar, sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }
  // 1l. La campana en la pestaña de otro despliegue: marcar lo leído no
  // revalida, así que Next no recarga. Antes «Marcar todos leídos» se llevaba el
  // reporte a medio llenar y dejaba suelta su foto (D7 de la trigesimoprimera).
  // Los avisos los dejan los disparadores; aquí se siembran.
  const sinLeer = async () => Number((await consulta(`select count(*) n from notificaciones where usuario_id = $1 and leida_en is null`, [yo]))[0].n)
  const sembrarAvisos = (n, de) =>
    consulta(`insert into notificaciones (usuario_id, titulo, cuerpo) select $1, $2 || ' ' || g, 'Sembrado por probar-pestana-vieja-y-giro' from generate_series(1, $3) g`, [yo, de, n])
  const campana = (pagina) => pagina.getByRole('button', { name: /^Avisos/ })
  if (corre('1l')) {
    const titulo = `Aviso de la pestaña nueva ${sello}`
    await sembrarAvisos(2, titulo)
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await marcarDocumento(pagina)
    const d0 = corte.documentos
    corte.despliegue = true
    corte.conservaIds = true
    await salirYVolver(pagina)
    await hasta(() => pagina.locator('[data-pestana-vieja="nueva"]').count(), (n) => n === 1, 15000)
    const n0 = await sinLeer()
    // Un aviso sin pantalla a la que ir: se marca, la campana se cierra y nada se recarga.
    await campana(pagina).click()
    await pagina.locator('#panel-avisos').getByRole('button', { name: new RegExp(`^${titulo} 1`) }).click()
    await hasta(sinLeer, (n) => n === n0 - 1, 10000)
    await pagina.waitForTimeout(1500)
    const etiqueta1 = await campana(pagina).getAttribute('aria-label')
    comprobar((await mismoDocumento(pagina)) && corte.documentos === d0 && (await pagina.inputValue('#rd-asunto')) === asunto && etiqueta1 === `Avisos, ${n0 - 1} sin leer`,
      `[Maestranza 390] 1l. en la pestaña «nueva», tocar un aviso lo marca leído sin recargar: lo escrito sigue y la campana baja a ${n0 - 1} («${etiqueta1}»)`)
    await campana(pagina).click()
    await pagina.locator('#panel-avisos').getByRole('button', { name: 'Marcar todos leídos' }).click()
    await hasta(sinLeer, (n) => n === 0, 10000)
    await pagina.waitForTimeout(1500)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1l-campana.png'), fullPage: true })
    const mismo = await mismoDocumento(pagina)
    const etiqueta = await campana(pagina).getAttribute('aria-label')
    const negritas = await pagina.locator('#panel-avisos p.font-semibold').count()
    comprobar(mismo && corte.documentos === d0 && (await pagina.inputValue('#rd-asunto')) === asunto && (await miniaturas(pagina)) === 1 && (await existe('fotos-reporte-diario', ruta)),
      `[Maestranza 390] 1l. «Marcar todos leídos» no recarga: lo escrito y la foto siguen (mismo documento ${mismo}, ${corte.documentos - d0} documentos)`)
    comprobar(etiqueta === 'Avisos' && negritas === 0 && (await pagina.locator('#panel-avisos').getByRole('button', { name: 'Marcar todos leídos' }).count()) === 0,
      `[Maestranza 390] 1l. y la campana los pinta leídos sin repintar la pantalla («${etiqueta}», ${negritas} sin leer en la lista)`)
    await pagina.getByRole('button', { name: 'Cerrar notificaciones' }).click()
    // Y el reporte todavía entra, con su foto.
    await Promise.all([
      pagina.waitForURL((u) => /^\/reportes-diarios\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 }).catch(() => {}),
      subirReporte(pagina).click(),
    ])
    const [rd] = await consulta(`select count(*)::int n from reporte_diario_fotos where ruta = $1`, [ruta])
    comprobar(rd?.n === 1, `[Maestranza 390] 1l. después, el reporte entra con su foto (${new URL(pagina.url()).pathname})`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1l. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }
  // 1l. Lo mismo antes de que la pestaña sepa del despliegue (sigue «al día»):
  // la respuesta de la acción lo dice, y arriba aparece el aviso.
  if (corre('1l')) {
    await sembrarAvisos(1, `Aviso sin saberlo ${sello}`)
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, false)
    await marcarDocumento(pagina)
    const d0 = corte.documentos
    corte.despliegue = true
    corte.conservaIds = true
    await campana(pagina).click()
    await pagina.locator('#panel-avisos').getByRole('button', { name: 'Marcar todos leídos' }).click()
    await hasta(sinLeer, (n) => n === 0, 10000)
    const arriba = limpio(await hasta(() => avisoDeArriba(pagina), Boolean, 10000))
    await pagina.waitForTimeout(1500)
    const mismo = await mismoDocumento(pagina)
    comprobar(mismo && corte.documentos === d0 && (await pagina.inputValue('#rd-asunto')) === asunto && arriba.startsWith(TEXTO_NUEVA) && (await campana(pagina).getAttribute('aria-label')) === 'Avisos',
      `[Maestranza 390] 1l. sin saberse todavía del despliegue, «Marcar todos leídos» no recarga, la campana queda en cero y arriba lo dice (mismo documento ${mismo})`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1l. sin saberlo, sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1m. «Volver a cargar» con el reporte en camino: espera a que vuelva, y como
  // entró, lleva a él. Antes quitaba la foto que el envío nombraba, el servidor
  // no la encontraba y la pantalla recargaba vacía (Importante 1 de la
  // trigesimoprimera). La acción se retiene antes de salir, como el servidor en frío.
  if (corre('1m')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    corte.despliegue = true
    corte.conservaIds = true
    await salirYVolver(pagina)
    await hasta(() => pagina.locator('[data-pestana-vieja="nueva"]').count(), (n) => n === 1, 15000)
    await marcarDocumento(pagina)
    const n0 = await reportes()
    corte.marca = asunto
    await subirReporte(pagina).click()
    await hasta(() => corte.retenidas, (n) => n > 0, 15000)
    await pagina.locator('[data-pestana-vieja]').getByRole('button', { name: 'Volver a cargar' }).click()
    await pagina.waitForTimeout(2000)
    const esperando = (await mismoDocumento(pagina)) && (await existe('fotos-reporte-diario', ruta))
    await Promise.all([
      pagina.waitForURL((u) => /^\/reportes-diarios\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 }).catch(() => {}),
      corte.soltar(),
    ])
    await quieta(pagina)
    const [rd] = await consulta(
      `select r.id, (select count(*)::int from reporte_diario_fotos f where f.reporte_id = r.id and f.ruta = $2) as fotos
       from reportes_diarios r where r.asunto = $1 order by r.creado_en desc limit 1`,
      [asunto, ruta],
    )
    const llego = new URL(pagina.url()).pathname
    comprobar(esperando, `[Maestranza 390] 1m. «Volver a cargar» con el reporte en camino espera: ni recarga ni quita la foto mientras tanto`)
    comprobar((await reportes()) === n0 + 1 && rd?.fotos === 1 && (await existe('fotos-reporte-diario', ruta)) && llego === `/reportes-diarios/${rd?.id}`,
      `[Maestranza 390] 1m. cuando vuelve, el reporte entró con su foto y la pantalla lleva a él (${llego})`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1m. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1n. El reporte que no se sabe si entró (la respuesta no llegó, y sí entró),
  // en la pestaña que después se sabe vieja: su foto no se quita ni dice «Se
  // quitó… elígela otra vez», que llevaba a subirlo dos veces con sus horas (F2
  // de la trigesimoprimera). Debajo se pide buscarlo antes de subirlo otra vez.
  if (corre('1n')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    const n0 = await reportes()
    corte.perder = asunto
    await subirReporte(pagina).click()
    const sinRespuesta = limpio(await hasta(() => pagina.locator('main [role="alert"]').filter({ hasText: SIN_RESPUESTA }).allInnerTexts().then((t) => t.join(' ')), Boolean))
    const entro = (await hasta(reportes, (n) => n === n0 + 1, 10000)) === n0 + 1
    comprobar(corte.perdidas === 1 && Boolean(sinRespuesta) && entro, `[Maestranza 390] 1n. la respuesta no llega y el reporte sí entró («${sinRespuesta}»)`)
    corte.despliegue = true
    await salirYVolver(pagina)
    await hasta(() => pagina.locator('[data-pestana-vieja="vieja"]').count(), (n) => n === 1, 15000)
    await pagina.waitForTimeout(2000)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1n-en-duda.png'), fullPage: true })
    const enDuda = await pagina.getByText('No se sabe si entró el reporte que enviaste: búscalo en Reportes diarios antes de volver a cargar la pantalla y subirlo otra vez.', { exact: true }).count()
    comprobar((await existe('fotos-reporte-diario', ruta)) && (await pagina.locator('[data-fotos-quitadas]').count()) === 0 && (await pagina.locator('main').getByText('Se quitó', { exact: true }).count()) === 0 && enDuda === 1,
      `[Maestranza 390] 1n. al saberse vieja, la foto del reporte en duda no se quita ni dice «Se quitó», y debajo se pide buscarlo antes de subirlo otra vez`)
    await subirReporte(pagina).click()
    const dice = limpio(await hasta(() => pagina.locator('main [role="alert"]').filter({ hasText: SE_ACTUALIZO }).allInnerTexts().then((t) => t.join(' ')), Boolean))
    comprobar(dice === 'El sistema se actualizó mientras tenías la pantalla abierta. Copia lo escrito y vuelve a cargar la pantalla.' && (await existe('fotos-reporte-diario', ruta)) && (await reportes()) === n0 + 1,
      `[Maestranza 390] 1n. «Subir reporte» otra vez no pide elegir las fotos de nuevo, y la foto del que entró sigue («${dice}»)`)
    corte.despliegue = false
    comprobar(errores.length === 0, `[Maestranza 390] 1n. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1o. La sesión que vence (X8 de la crítica de la trigesimoprimera): el proxy
  // la refrescaba durante la acción, Next la respondía revalidada y, en la
  // pestaña de otro despliegue, recargaba el documento sin que nadie enviara
  // nada. Ahora se refresca antes, en un GET a /auth/sesion.
  if (corre('1o')) {
    const titulo = `Aviso de la sesión vencida ${sello}`
    await sembrarAvisos(2, titulo)
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await marcarDocumento(pagina)
    const d0 = corte.documentos
    // La primera pregunta tras el despliegue, al volver, con la sesión vencida:
    // todavía no se sabe «nueva».
    corte.despliegue = true
    corte.conservaIds = true
    let s0 = corte.sesion
    let vencia = await vencerLaSesion(contexto)
    await salirYVolver(pagina)
    const arriba = limpio(await hasta(() => avisoDeArriba(pagina), Boolean, 15000))
    await pagina.waitForTimeout(2000)
    let mismo = await mismoDocumento(pagina)
    comprobar(arriba.startsWith(TEXTO_NUEVA) && mismo && corte.documentos === d0 && (await pagina.inputValue('#rd-asunto')) === asunto && (await miniaturas(pagina)) === 1,
      `[Maestranza 390] 1o. con la sesión vencida, la pregunta al volver descubre el despliegue sin recargar: arriba lo dice y lo escrito y la foto siguen (mismo documento ${mismo})`)
    let ahora = await venceLaSesion(contexto)
    comprobar(corte.sesion > s0 && ahora > vencia && ahora * 1000 > Date.now() + 50 * 60_000,
      `[Maestranza 390] 1o. la sesión se refrescó antes de la pregunta, en /auth/sesion (${corte.sesion - s0} pedidos; vence en ${Math.round((ahora * 1000 - Date.now()) / 60_000)} min)`)
    // Ya «nueva», otra vez vencida: lo leído de la campana. El reloj de la
    // página se adelanta medio minuto: recién preguntada, la sesión no se
    // vuelve a preguntar, y aquí venció de golpe.
    s0 = corte.sesion
    vencia = await vencerLaSesion(contexto)
    await adelantarElReloj(pagina, 31_000)
    const n0 = await sinLeer()
    await campana(pagina).click()
    await pagina.locator('#panel-avisos').getByRole('button', { name: new RegExp(`^${titulo} 1`) }).click()
    await hasta(sinLeer, (n) => n === n0 - 1, 10000)
    await campana(pagina).click()
    await pagina.locator('#panel-avisos').getByRole('button', { name: 'Marcar todos leídos' }).click()
    await hasta(sinLeer, (n) => n === 0, 10000)
    await pagina.waitForTimeout(2000)
    mismo = await mismoDocumento(pagina)
    ahora = await venceLaSesion(contexto)
    comprobar(mismo && corte.documentos === d0 && (await pagina.inputValue('#rd-asunto')) === asunto && (await existe('fotos-reporte-diario', ruta)) && corte.sesion > s0 && ahora > vencia,
      `[Maestranza 390] 1o. en «nueva» y con la sesión vencida, tocar un aviso y «Marcar todos leídos» no recargan: la sesión se refrescó antes (${corte.sesion - s0} pedidos, mismo documento ${mismo})`)
    await pagina.getByRole('button', { name: 'Cerrar notificaciones' }).click().catch(() => {})
    // Y con la sesión al día no se pregunta en cada acción: una vez cada cinco
    // minutos. Un aviso ya leído, tocado otra vez, también llama a la acción.
    s0 = corte.sesion
    const a0 = corte.acciones
    await campana(pagina).click()
    await pagina.locator('#panel-avisos').getByRole('button', { name: new RegExp(`^${titulo} 2`) }).click()
    await hasta(() => corte.acciones, (n) => n > a0, 10000)
    await pagina.waitForTimeout(1000)
    comprobar(corte.acciones > a0 && corte.sesion === s0 && (await mismoDocumento(pagina)),
      `[Maestranza 390] 1o. con la sesión al día, la acción siguiente no pregunta otra vez (${corte.acciones - a0} acciones, ${corte.sesion - s0} pedidos a /auth/sesion)`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1o. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1p. «Volver a cargar» con el reporte en camino, en sus otros desenlaces
  // (D13 e Importante 2 de la trigesimosegunda): antes recargaba igual y el
  // formulario volvía vacío con el reporte rechazado, sin respuesta, colgado o
  // con la pantalla del reporte lenta.
  const alertaDelFormulario = (pagina) => pagina.locator('main [role="alert"]').allInnerTexts().then((t) => limpio(t.join(' ')))

  if (corre('1p-rechazo')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true, { sinPersona: true })
    const [ruta] = (await subidas()).slice(-1)
    await hastaLaPestanaNueva(pagina, corte)
    await marcarDocumento(pagina)
    const n0 = await reportes()
    corte.marca = asunto
    await subirReporte(pagina).click()
    await hasta(() => corte.retenidas, (n) => n > 0, 15000)
    await botonDeArriba(pagina, 'Volver a cargar').click()
    corte.soltar()
    const rechazo = await hasta(() => alertaDelFormulario(pagina), (t) => t?.includes('Pon al menos a una persona'), 15000)
    const dice = await hasta(() => sinRecargar(pagina), (t) => t === NO_ENTRO, 10000)
    await pagina.waitForTimeout(2000)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1p-rechazo.png'), fullPage: true })
    const mismo = await mismoDocumento(pagina)
    comprobar(mismo && rechazo?.includes('Pon al menos a una persona') && (await pagina.inputValue('#rd-asunto')) === asunto && (await existe('fotos-reporte-diario', ruta)) && (await reportes()) === n0,
      `[Maestranza 390] 1p. «Volver a cargar» con el reporte en camino que vuelve rechazado no recarga: el rechazo y lo escrito siguen, y la foto también (mismo documento ${mismo}, «${rechazo}»)`)
    comprobar(dice === NO_ENTRO && (await botonDeArriba(pagina, 'Volver a cargar igual').count()) === 1 && !(await botonDeArriba(pagina, 'Volver a cargar igual').isDisabled()),
      `[Maestranza 390] 1p. arriba dice por qué no recargó, y el botón pasa a «Volver a cargar igual» («${dice}»)`)
    await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}), botonDeArriba(pagina, 'Volver a cargar igual').click()])
    corte.despliegue = false
    corte.conservaIds = false
    await quieta(pagina)
    comprobar(!(await mismoDocumento(pagina)) && !(await existe('fotos-reporte-diario', ruta)),
      `[Maestranza 390] 1p. «Volver a cargar igual» recarga, y antes quita la foto que ningún reporte nombra`)
    comprobar(errores.length === 0, `[Maestranza 390] 1p-rechazo. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  if (corre('1p-sin-respuesta')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await hastaLaPestanaNueva(pagina, corte)
    await marcarDocumento(pagina)
    const n0 = await reportes()
    corte.marca = asunto
    corte.perder = asunto
    await subirReporte(pagina).click()
    await hasta(() => corte.retenidas, (n) => n > 0, 15000)
    await botonDeArriba(pagina, 'Volver a cargar').click()
    corte.soltar()
    const sinRespuesta = await hasta(() => alertaDelFormulario(pagina), (t) => SIN_RESPUESTA.test(t ?? ''), 15000)
    const dice = await hasta(() => sinRecargar(pagina), (t) => t === NO_ENTRO, 10000)
    await pagina.waitForTimeout(2000)
    const mismo = await mismoDocumento(pagina)
    const entro = (await hasta(reportes, (n) => n === n0 + 1, 10000)) === n0 + 1
    comprobar(corte.perdidas === 1 && mismo && SIN_RESPUESTA.test(sinRespuesta ?? '') && dice === NO_ENTRO && (await pagina.inputValue('#rd-asunto')) === asunto && (await existe('fotos-reporte-diario', ruta)) && entro,
      `[Maestranza 390] 1p. sin respuesta (y sí entró) tampoco recarga: «No llegó la respuesta…» sigue junto al botón y la pantalla no invita a subirlo otra vez (mismo documento ${mismo})`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1p-sin-respuesta. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // Desde abajo, junto a «Subir reporte»: arriba queda fuera de la vista, y la
  // franja de una línea bajo la cabecera dice lo mismo (D12).
  if (corre('1p-colgado')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await subirReporte(pagina).scrollIntoViewIfNeeded()
    comprobar((await pagina.locator('[data-franja-pestana-vieja]').count()) === 0, `[Maestranza 390] 1p. sin despliegue no hay franja`)
    await hastaLaPestanaNueva(pagina, corte)
    await subirReporte(pagina).scrollIntoViewIfNeeded()
    const franja = pagina.locator('[data-franja-pestana-vieja="nueva"]')
    await franja.waitFor({ timeout: 5000 }).catch(() => {})
    const medida = await pagina.evaluate(() => {
      const f = document.querySelector('[data-franja-pestana-vieja]')?.getBoundingClientRect()
      const c = document.querySelector('[data-barra-superior]')?.getBoundingClientRect()
      return { arriba: f?.top ?? null, alto: f?.height ?? null, cabecera: c?.bottom ?? null, ancho: document.documentElement.scrollWidth }
    })
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1p-franja.png') })
    const textoFranja = limpio(await franja.innerText().catch(() => ''))
    comprobar(textoFranja === 'El sistema se actualizó: al enviar algo, la pantalla se vuelve a cargar. Volver a cargar' && Math.abs(medida.arriba - medida.cabecera) < 1 && medida.alto <= 60 && medida.ancho <= CELULAR.width,
      `[Maestranza 390] 1p. con la pantalla bajada, la franja queda a la vista bajo la cabecera, baja y sin correr la pantalla de lado («${textoFranja}», arriba ${medida.arriba} y cabecera ${medida.cabecera}, alto ${medida.alto}, ancho ${medida.ancho})`)
    await marcarDocumento(pagina)
    const n0 = await reportes()
    corte.marca = asunto
    await subirReporte(pagina).click()
    await hasta(() => corte.retenidas, (n) => n > 0, 15000)
    await franja.getByRole('button', { name: 'Volver a cargar', exact: true }).click()
    await pagina.waitForTimeout(11_000)
    const enLaFranja = limpio(await franja.locator('p').innerText().catch(() => ''))
    const igual = franja.getByRole('button', { name: 'Volver a cargar igual', exact: true })
    const mismo = await mismoDocumento(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1p-colgado.png') })
    comprobar(mismo && enLaFranja === EN_CAMINO && (await igual.count()) === 1 && !(await igual.isDisabled()) && (await existe('fotos-reporte-diario', ruta)) && (await pagina.inputValue('#rd-asunto')) === asunto,
      `[Maestranza 390] 1p. con el reporte colgado más de 10 s no recarga: la franja dice que todavía no contesta y ofrece «Volver a cargar igual» («${enLaFranja}», mismo documento ${mismo})`)
    comprobar((await sinRecargar(pagina)) === EN_CAMINO, `[Maestranza 390] 1p. y arriba, en la región que el lector oye, lo mismo`)
    await Promise.all([
      pagina.waitForURL((u) => /^\/reportes-diarios\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 }).catch(() => {}),
      corte.soltar(),
    ])
    await quieta(pagina)
    const llego = new URL(pagina.url()).pathname
    const [rd] = await consulta(`select r.id from reportes_diarios r join reporte_diario_fotos f on f.reporte_id = r.id and f.ruta = $2 where r.asunto = $1`, [asunto, ruta])
    comprobar((await reportes()) === n0 + 1 && llego === `/reportes-diarios/${rd?.id}`, `[Maestranza 390] 1p. cuando contesta, el reporte entró con su foto y la pantalla lleva a él (${llego})`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1p-colgado. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // La pantalla del reporte tarda (poca señal): «Volver a cargar» no la corta.
  // Sin el service worker, para que el documento también pase por aquí.
  if (corre('1p-destino-lento')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true, sinSw: true })
    await llenar(pagina, false)
    await hastaLaPestanaNueva(pagina, corte)
    const n0 = await reportes()
    corte.marca = asunto
    await subirReporte(pagina).click()
    await hasta(() => corte.retenidas, (n) => n > 0, 15000)
    await botonDeArriba(pagina, 'Volver a cargar').click()
    corte.lento = { patron: /\/reportes-diarios\/[0-9a-f-]{36}/, ms: 6000 }
    await Promise.all([
      pagina.waitForURL((u) => /^\/reportes-diarios\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 40000 }).catch(() => {}),
      corte.soltar(),
    ])
    await quieta(pagina)
    await pagina.waitForTimeout(2000)
    const llego = new URL(pagina.url()).pathname
    const [rd] = await consulta(`select id from reportes_diarios where asunto = $1 order by creado_en desc limit 1`, [asunto])
    comprobar((await reportes()) === n0 + 1 && corte.demorados > 0 && llego === `/reportes-diarios/${rd?.id}`,
      `[Maestranza 390] 1p. con la pantalla del reporte lenta (${corte.demorados} pedidos de 6 s), «Volver a cargar» no la corta: termina en el reporte (${llego})`)
    corte.lento = null
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1p-destino-lento. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // Y si tarda más de 15 s, arriba se dice que ya está guardado, y el toque
  // siguiente va a la pantalla del reporte: recargaba el formulario, que
  // ofrecía subirlo otra vez (F2 de la trigesimotercera). Con su foto, que
  // «Volver a cargar» no quita: la nombra el reporte.
  if (corre('1p-se-va')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true, sinSw: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await hastaLaPestanaNueva(pagina, corte)
    const n0 = await reportes()
    corte.marca = asunto
    await subirReporte(pagina).click()
    await hasta(() => corte.retenidas, (n) => n > 0, 15000)
    await botonDeArriba(pagina, 'Volver a cargar').click()
    // La pantalla del reporte tarda 40 s, desde lo que Next pide antes del
    // documento: mientras, la pestaña sigue en el formulario, con su aviso.
    corte.lento = { patron: /\/reportes-diarios\/[0-9a-f-]{36}/, ms: 40_000 }
    corte.soltar()
    const dice = await hasta(() => sinRecargar(pagina), (t) => t === SE_VA, 30000)
    const donde = new URL(pagina.url()).pathname
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1p-se-va.png'), fullPage: true })
    comprobar((await reportes()) === n0 + 1 && corte.demorados > 0 && dice === SE_VA && (await botonDeArriba(pagina, 'Volver a cargar igual').count()) === 1,
      `[Maestranza 390] 1p. el reporte entró y su pantalla tarda más de 15 s: arriba dice que ya está guardado y ofrece «Volver a cargar igual» («${dice}», en ${donde})`)
    corte.lento = null
    // Por lo que muestra, no solo por la dirección.
    await pagina.locator('[data-pestana-vieja] button').first().click()
    const enElReporte = await hasta(
      () => pagina.evaluate((asunto) => !document.querySelector('#rd-asunto') && (document.querySelector('main')?.innerText ?? '').includes(asunto), asunto).catch(() => false),
      Boolean,
      15000,
    )
    await quieta(pagina)
    const llego = new URL(pagina.url()).pathname
    const [rd] = await consulta(`select r.id from reportes_diarios r join reporte_diario_fotos f on f.reporte_id = r.id and f.ruta = $2 where r.asunto = $1`, [asunto, ruta])
    comprobar(enElReporte && llego === `/reportes-diarios/${rd?.id}` && (await reportes()) === n0 + 1 && (await existe('fotos-reporte-diario', ruta)),
      `[Maestranza 390] 1p. el toque siguiente va al reporte, no al formulario, y su foto sigue (${llego}, en el reporte ${enElReporte})`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1p-se-va. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1r. La pastilla «Sin leer (N)» de /avisos en la pestaña «nueva»: lo leído
  // lo pinta la pestaña, y la pastilla seguía con el número del servidor (D11).
  if (corre('1r')) {
    const titulo = `Aviso de la pastilla ${sello}`
    await sembrarAvisos(3, titulo)
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, { width: 1440, height: 900 }, { compilacion: true })
    await ir(pagina, `${BASE}/avisos`)
    await marcarDocumento(pagina)
    const d0 = corte.documentos
    await hastaLaPestanaNueva(pagina, corte)
    const pastilla = () => pagina.getByRole('group', { name: 'Filtrar avisos' }).getByRole('link', { name: /^Sin leer/ }).innerText().then(limpio)
    const n0 = await sinLeer()
    const antes = await pastilla()
    await pagina.locator('main').getByRole('button', { name: new RegExp(`^${titulo} 1`) }).click()
    await hasta(sinLeer, (n) => n === n0 - 1, 10000)
    const tras1 = await hasta(pastilla, (t) => t === `Sin leer (${n0 - 1})`, 5000)
    await pagina.locator('main').getByRole('button', { name: `Marcar los ${n0 - 1} como leídos` }).click()
    await hasta(sinLeer, (n) => n === 0, 10000)
    const tras2 = await hasta(pastilla, (t) => t === 'Sin leer (0)', 5000)
    const mismo = await mismoDocumento(pagina)
    comprobar(antes === `Sin leer (${n0})` && tras1 === `Sin leer (${n0 - 1})` && tras2 === 'Sin leer (0)' && mismo && corte.documentos === d0,
      `[Maestranza 1440] 1r. en /avisos de la pestaña «nueva», la pastilla baja con lo leído sin recargar («${antes}» → «${tras1}» → «${tras2}»)`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 1440] 1r. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // Su costo, como se lo pondría RR. HH.: las horas del reporte que entró pasan
  // al costeo, y el aviso de «Horas… que esperan su costo» no queda prendido
  // para probar-reporte-diario.
  await consulta(
    `insert into trabajador_costos (trabajador_id, costo_mensual) select id, 1680 from trabajadores where nombres = $1
      and not exists (select 1 from trabajador_costos c where c.trabajador_id = trabajadores.id)`,
    [persona],
  )
  await consulta(`update trabajadores set activo = false where nombres = $1`, [persona])
}

// ------------------------------------------- 1f. La planilla sin internet del kardex (Almacén)
if (corre('1f')) {
  const codigo = `QA-VIEJA-P-${sello}`
  const materialId = await materialPropio(codigo, `Disco de corte de la pestaña vieja ${sello}`)
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.almacen])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const movimientos = async () => Number((await consulta(`select count(*) n from movimientos_materiales where material_id = $1`, [materialId]))[0].n)
  const sueltas = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'evidencias-almacen' and o.owner_id = $1 and o.created_at >= $2
        and not exists (select 1 from movimientos_materiales m where m.foto_ruta = o.name)`, [yo, desde])).map((o) => o.name)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.almacen)
  await ir(pagina, `${BASE}/almacen/kardex`)
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(await (await pagina.request.get(`${BASE}/almacen/kardex/planilla`)).body())
  let unidad = null
  libro.getWorksheet('Unidades')?.eachRow((f, n) => {
    if (n > 1 && !unidad && f.getCell(1).value) unidad = String(f.getCell(1).value)
  })
  const [a, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }).split('-').map(Number)
  const salidas = libro.getWorksheet('Salidas')
  salidas.getCell(5, 1).value = new Date(Date.UTC(a, m - 1, d))
  salidas.getCell(5, 3).value = codigo
  salidas.getCell(5, 6).value = 1
  salidas.getCell(5, 7).value = `Vale de la pestaña vieja ${sello}`
  salidas.getCell(5, 8).value = unidad
  salidas.getCell(5, 9).value = 'Soldador de banco'
  const llena = join(archivos, `planilla-vieja-${sello}.xlsx`)
  await libro.xlsx.writeFile(llena)
  await pagina.getByRole('button', { name: /sin internet/i }).first().click()
  await pagina.getByRole('button', { name: /Cargar planilla/ }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor()
  await v.locator('#planilla-archivo').setInputFiles(llena)
  const foto = v.locator('input[type=file][aria-label^="Elegir la foto de la salida"]').first()
  await foto.waitFor({ state: 'attached', timeout: 30000 })
  await foto.setInputFiles(fotos.e)
  const boton = v.getByRole('button', { name: /^Registrar 1 movimiento/ })
  await boton.waitFor({ timeout: 30000 })
  const m0 = await movimientos()
  const a0 = corte.acciones
  const s0 = corte.storage.length
  corte.despliegue = true
  await boton.click()
  const resumen = limpio(await hasta(() => pagina.evaluate(() => (document.activeElement?.getAttribute('role') === 'status' ? document.activeElement.textContent : '')), Boolean, 30000))
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1f-planilla.png') })
  const alertas = await v.getByRole('alert').filter({ hasText: /actualizó/ }).count()
  const fila = limpio(await v.getByText('No salió: el sistema se actualizó.').first().innerText().catch(() => ''))
  const registrarOtraVez = await v.getByRole('button', { name: /^Registrar/ }).count()
  const enStorage = corte.storage.slice(s0).filter((x) => x.includes('evidencias-almacen'))
  comprobar(resumen === 'No se registró ninguno; 1 no salió porque el sistema se actualizó mientras tenías la pantalla abierta. Vuelve a cargar la pantalla y elige la planilla y sus fotos otra vez: lo registrado no se duplica.',
    `[Almacén 1280] 1f. la planilla desde la pestaña vieja: el resumen enfocado dice la causa y qué hacer («${resumen}»)`)
  comprobar(alertas === 0 && fila === 'No salió: el sistema se actualizó.' && registrarOtraVez === 0 && (await v.getByRole('button', { name: 'Volver a cargar la pantalla' }).count()) === 1,
    `[Almacén 1280] 1f. la fila dice «${fila}» sin alerta propia (${alertas}); no queda «Registrar» (${registrarOtraVez}) y sí «Volver a cargar la pantalla»`)
  comprobar(corte.acciones - a0 === 1 && (await movimientos()) === m0 && (await hasta(sueltas, (l) => l.length === 0, 10000)).length === 0,
    `[Almacén 1280] 1f. una sola llamada, ningún movimiento y ninguna foto suelta (${corte.acciones - a0} llamada; Storage: ${enStorage.join(', ') || 'nada'})`)
  corte.despliegue = false
  comprobar(errores.length === 0, `[Almacén 1280] 1f. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1f-conserva. La planilla, tras el despliegue de todos los días
// Un ingreso y dos salidas con su foto, en la pestaña que se sabe «nueva». Cada
// fila repintaba el kardex, y Next, que veía otra compilación, recargaba el
// documento a mitad de la planilla: la segunda salida no salía nunca, sin aviso
// (trigesimoprimera pasada). Ahora se pone al día al cerrar.
if (corre('1f-conserva')) {
  const codigo = `QA-NUEVA-P-${sello}`
  await materialPropio(codigo, `Disco de corte de la pestaña nueva ${sello}`)
  const marca = `Planilla nueva ${sello}`
  const movimientos = async () =>
    (await consulta(`select tipo, foto_ruta from movimientos_materiales where documento_referencia like $1 order by registrado_en`, [`${marca}%`]))
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.almacen, undefined, { compilacion: true })
  await ir(pagina, `${BASE}/almacen/kardex`)
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(await (await pagina.request.get(`${BASE}/almacen/kardex/planilla`)).body())
  let unidad = null
  libro.getWorksheet('Unidades')?.eachRow((f, n) => {
    if (n > 1 && !unidad && f.getCell(1).value) unidad = String(f.getCell(1).value)
  })
  const [a, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }).split('-').map(Number)
  const fecha = new Date(Date.UTC(a, m - 1, d))
  const ingresos = libro.getWorksheet('Ingresos')
  ingresos.getCell(5, 1).value = fecha
  ingresos.getCell(5, 3).value = codigo
  ingresos.getCell(5, 6).value = 3
  ingresos.getCell(5, 7).value = 'Ingreso general'
  ingresos.getCell(5, 8).value = `${marca} I1`
  const salidas = libro.getWorksheet('Salidas')
  for (const fila of [5, 6]) {
    salidas.getCell(fila, 1).value = fecha
    salidas.getCell(fila, 3).value = codigo
    salidas.getCell(fila, 6).value = 1
    salidas.getCell(fila, 7).value = `${marca} S${fila - 4}`
    salidas.getCell(fila, 8).value = unidad
    salidas.getCell(fila, 9).value = 'Soldador de banco'
  }
  const llena = join(archivos, `planilla-nueva-${sello}.xlsx`)
  await libro.xlsx.writeFile(llena)
  await pagina.getByRole('button', { name: /sin internet/i }).first().click()
  await pagina.getByRole('button', { name: /Cargar planilla/ }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor()
  await v.locator('#planilla-archivo').setInputFiles(llena)
  for (const [fila, foto] of [[5, fotos.a], [6, fotos.b]]) {
    const campo = v.getByLabel(`Elegir la foto de la salida de la fila ${fila}`)
    await campo.waitFor({ state: 'attached', timeout: 30000 })
    await campo.setInputFiles(foto)
  }
  const boton = v.getByRole('button', { name: /^Registrar 3 movimientos/ })
  await boton.waitFor({ timeout: 30000 })
  await marcarDocumento(pagina)
  const d0 = corte.documentos
  // La pestaña se sabe «nueva», con el aviso de arriba que invita a terminar.
  corte.despliegue = true
  corte.conservaIds = true
  await salirYVolver(pagina)
  await hasta(() => pagina.locator('[data-pestana-vieja="nueva"]').count(), (n) => n === 1, 15000)
  await boton.click()
  const resumen = limpio(await hasta(() => pagina.evaluate(() => (document.activeElement?.getAttribute('role') === 'status' ? document.activeElement.textContent : '')), Boolean, 45000))
  await pagina.waitForTimeout(3000)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1f-conserva.png') })
  const entraron = await movimientos()
  const mismo = await mismoDocumento(pagina)
  comprobar(entraron.length === 3 && entraron.filter((x) => x.foto_ruta).length === 2 && mismo && corte.documentos === d0 && resumen === 'Se registraron 3 movimientos.',
    `[Almacén 1280] 1f-conserva. tras el despliegue que conserva los ids, la planilla entra entera sin recargar la pantalla («${resumen}»; ${entraron.length} de 3, mismo documento ${mismo})`)
  // Al cerrar, el kardex se pone al día: aquí Next recarga, como dice el aviso de arriba.
  await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}), v.locator('button', { hasText: /^Cerrar$/ }).click()])
  await quieta(pagina)
  comprobar(!(await mismoDocumento(pagina)), `[Almacén 1280] 1f-conserva. al cerrar, la pantalla se vuelve a cargar con lo registrado`)
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Almacén 1280] 1f-conserva. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1q. «Atrás» con la planilla registrada (Almacén, sin despliegue)
// Las filas de la planilla no revalidaban (trigesimoprimera pasada), y Next
// solo olvida las pantallas del historial cuando una acción revalida: «Atrás»
// al stock, con la ventana todavía abierta, mostraba el saldo de antes (H-e1
// de la trigesimosegunda). Ahora revalidan, salvo en una pestaña de otro despliegue.
if (corre('1q')) {
  const codigo = `QA-ATRAS-${sello}`
  await materialPropio(codigo, `Perno del historial ${sello}`)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.almacen, { width: 1440, height: 900 })
  await ir(pagina, `${BASE}/almacen/kardex`)
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(await (await pagina.request.get(`${BASE}/almacen/kardex/planilla`)).body())
  const [a, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }).split('-').map(Number)
  const ingresos = libro.getWorksheet('Ingresos')
  ingresos.getCell(5, 1).value = new Date(Date.UTC(a, m - 1, d))
  ingresos.getCell(5, 3).value = codigo
  ingresos.getCell(5, 6).value = 3
  ingresos.getCell(5, 7).value = 'Ingreso general'
  ingresos.getCell(5, 8).value = `Planilla del historial ${sello}`
  const llena = join(archivos, `planilla-atras-${sello}.xlsx`)
  await libro.xlsx.writeFile(llena)
  await ir(pagina, `${BASE}/almacen/stock?q=${codigo}`)
  const fila = () => pagina.locator('main tr', { hasText: codigo }).first().innerText().then(limpio).catch(() => '')
  const antes = await fila()
  // Al kardex por el menú, como Almacén: el stock queda en el historial del navegador.
  await Promise.all([
    pagina.waitForURL((u) => u.pathname === '/almacen/kardex', { timeout: 30000 }),
    pagina.locator('aside').getByRole('link', { name: /^Kardex/ }).click(),
  ])
  await quieta(pagina)
  await pagina.getByRole('button', { name: /sin internet/i }).first().click()
  await pagina.getByRole('button', { name: /Cargar planilla/ }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor()
  await v.locator('#planilla-archivo').setInputFiles(llena)
  const boton = v.getByRole('button', { name: /^Registrar 1 movimiento/ })
  await boton.waitFor({ timeout: 30000 })
  await boton.click()
  const resumen = limpio(await hasta(() => pagina.evaluate(() => (document.activeElement?.getAttribute('role') === 'status' ? document.activeElement.textContent : '')), Boolean, 30000))
  const r0 = corte.rsc
  await Promise.all([pagina.waitForURL((u) => u.pathname === '/almacen/stock', { timeout: 30000 }), pagina.goBack()])
  await quieta(pagina)
  // La fila del stock, no la del kardex que sigue a la vista mientras vuelve.
  const delStock = (t) => Boolean(t) && t.startsWith(`Perno del historial ${sello} ${codigo} ·`)
  const alVolver = await hasta(fila, (t) => delStock(t) && t !== antes, 10000)
  const pidio = corte.rsc - r0
  await ir(pagina, `${BASE}/almacen/stock?q=${codigo}`)
  const recargada = await fila()
  comprobar(resumen === 'Se registró 1 movimiento.' && delStock(antes) && recargada !== antes && alVolver === recargada && pidio > 0,
    `[Almacén 1440] 1q. «Atrás» al stock con la ventana de la planilla abierta trae el saldo nuevo, como la pantalla recargada («${antes}» → «${alVolver}»; ${pidio} pedidos al volver)`)
  comprobar(errores.length === 0, `[Almacén 1440] 1q. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1o-conteo. El conteo inicial con la sesión vencida, en «nueva» (Almacén)
// La acción del conteo no revalida en «nueva», pero el proxy refrescaba la
// sesión dentro de ella y Next la respondía revalidada: el conteo entraba y la
// pantalla se recargaba, sin la ventana ni su resumen (X8 de la crítica).
if (corre('1o-conteo')) {
  const codigo = `QA-SESION-${sello}`
  const materialId = await materialPropio(codigo, `Trapo de la sesión vencida ${sello}`)
  const movimientos = async () => Number((await consulta(`select count(*) n from conteos_inventario where material_id = $1`, [materialId]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.almacen, undefined, { compilacion: true })
  await ir(pagina, `${BASE}/almacen/kardex`)
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(await (await pagina.request.get(`${BASE}/almacen/kardex/conteo-inicial`)).body())
  const hoja = libro.getWorksheet('Conteo')
  let encabezado = 0
  hoja.eachRow((f, n) => {
    if (!encabezado && f.values.includes('Cantidad contada')) encabezado = n
  })
  for (let n = encabezado + 1; n <= hoja.rowCount; n++) {
    if (String(hoja.getCell(n, 1).value) === codigo) hoja.getCell(n, 5).value = Number(hoja.getCell(n, 4).value) + 1
    else hoja.getCell(n, 5).value = null
  }
  const lleno = join(archivos, `conteo-sesion-${sello}.xlsx`)
  await libro.xlsx.writeFile(lleno)
  await marcarDocumento(pagina)
  const d0 = corte.documentos
  corte.despliegue = true
  corte.conservaIds = true
  await salirYVolver(pagina)
  await hasta(() => pagina.locator('[data-pestana-vieja="nueva"]').count(), (n) => n === 1, 15000)
  await pagina.getByRole('button', { name: 'Conteo inicial' }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor()
  await v.locator('#conteo-inicial-archivo').setInputFiles(lleno)
  const boton = v.getByRole('button', { name: 'Registrar 1 material' })
  await boton.waitFor({ timeout: 30000 })
  const m0 = await movimientos()
  const s0 = corte.sesion
  await vencerLaSesion(contexto)
  await adelantarElReloj(pagina, 31_000)
  await boton.click()
  const resumen = limpio(await hasta(() => pagina.evaluate(() => (document.activeElement?.getAttribute('role') === 'status' ? document.activeElement.textContent : '')), Boolean, 30000))
  await pagina.waitForTimeout(2000)
  const mismo = await mismoDocumento(pagina)
  comprobar(mismo && corte.documentos === d0 && (await v.count()) === 1 && /^Se registró 1 material/.test(resumen) && (await movimientos()) === m0 + 1 && corte.sesion > s0,
    `[Almacén 1280] 1o. el conteo inicial con la sesión vencida, en «nueva», entra sin recargar: la ventana sigue con su resumen y la sesión se refrescó antes («${resumen}», ${corte.sesion - s0} pedidos a /auth/sesion, mismo documento ${mismo})`)
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Almacén 1280] 1o-conteo. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1g. La cotización con cliente nuevo (Ventas)
if (corre('1g')) {
  // Un RUC válido que nadie tiene: el cliente nuevo no llega a crearse.
  const [{ n: ruc }] = await consulta(`select n from (select '209' || lpad($1::text, 7, '0') || d as n from generate_series(0, 9) d) x
                                       where public.ruc_es_valido(n) and not exists (select 1 from clientes c where c.numero_documento = x.n) limit 1`, [sello])
  const numero = `QA-VIEJA-COT-${sello}`
  const razon = `Transportes de la pestaña vieja ${sello}`
  const clientes = async () => Number((await consulta(`select count(*) n from clientes where razon_social = $1`, [razon]))[0].n)
  const cotizaciones = async () => Number((await consulta(`select count(*) n from cotizaciones_pdf where numero = $1`, [numero]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.ventas)
  await ir(pagina, `${BASE}/cotizaciones/pdf`)
  await pagina.getByRole('button', { name: 'Subir cotización' }).first().click()
  const d = pagina.getByRole('dialog').first()
  await d.waitFor({ timeout: 20000 })
  await d.locator('#cot-archivo').setInputFiles({ name: `${numero}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`COTIZACION ${numero}`, 'Semirremolque de banco']) })
  const subir = d.getByRole('button', { name: 'Subir y mandar a Gerencia' })
  await pagina.waitForTimeout(1500)
  await hasta(async () => !/Leyendo/.test(await d.innerText()) && (await subir.isEnabled()), Boolean, 30000)
  await d.locator('#cot-numero').fill(numero)
  await d.locator('#cot-monto').fill('1000')
  await d.locator('#cot-moneda').selectOption('USD')
  await d.locator('#cot-igv').selectOption('no')
  if (!(await d.locator('#cot-razon').count())) await d.getByRole('button', { name: 'Es un cliente nuevo' }).click()
  await d.locator('#cot-tipo-doc').selectOption('RUC')
  await d.locator('#cot-num-doc').fill(ruc)
  await d.locator('#cot-razon').fill(razon)
  if (await d.locator('#cot-carroceria').count()) await d.locator('#cot-carroceria').selectOption({ index: 1 })
  const a0 = corte.acciones
  corte.despliegue = true
  for (const vez of [1, 2]) {
    await subir.click()
    await hasta(() => corte.acciones - a0, (n) => n >= vez, 20000)
    const dice = limpio(await hasta(() => d.getByRole('alert').allInnerTexts().then((t) => t.join(' ')), (t) => /actualizó|Vuelve a intentar/.test(t ?? ''), 20000))
    comprobar(dice.startsWith(SE_ACTUALIZO) && !/Vuelve a intentar/.test(dice),
      `[Ventas 1280] 1g. cotización con cliente nuevo desde la pestaña vieja, intento ${vez}: dice que hay que recargar, no «Vuelve a intentar» («${dice}»)`)
  }
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1g-cotizacion.png') })
  comprobar(corte.acciones - a0 === 2 && (await clientes()) === 0 && (await cotizaciones()) === 0,
    `[Ventas 1280] 1g. una llamada por intento, sin cliente ni cotización nuevos (${corte.acciones - a0} llamadas)`)
  corte.despliegue = false
  comprobar(errores.length === 0, `[Ventas 1280] 1g. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1h. El plano a dos áreas (Diseño)
if (corre('1h')) {
  // Un plano va en una etapa de su orden, como en probar-archivo-sin-dejarlo-suelto;
  // en la orden con plan propio la base pide quién lo elaboró.
  const [orden] = await consulta(`select o.id, e.id as etapa_id, o.plan_etapas_manual from ordenes_trabajo o join ot_etapas e on e.orden_id = o.id
                                  where o.estado not in ('BORRADOR', 'ENTREGADA', 'FACTURADA', 'ANULADA') order by o.numero limit 1`)
  const integrante = orden.plan_etapas_manual
    ? (await consulta(`insert into ot_equipo_diseno (orden_id, nombre, funcion) values ($1, 'QA banco Diseño', 'COLABORADOR')
                       on conflict (orden_id, lower(btrim(nombre))) do update set nombre = excluded.nombre returning id`, [orden.id]))[0].id
    : null
  const [plano] = await consulta(`insert into ot_planos (orden_id, numero_plano, nombre, etapa_id, integrante_diseno_id)
                                  values ($1, $2, 'Plano de la pestaña vieja', $3, $4) returning id`, [orden.id, `QA-VIEJA-PL-${sello}`, orden.etapa_id, integrante])
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.diseno])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'planos-privados' and o.name like $1 and o.created_at >= $2
        and not exists (select 1 from ot_plano_versiones v where v.ruta_storage = o.name)`, [`${yo}/%`, desde])).map((o) => o.name)
  const versiones = async () => Number((await consulta(`select count(*) n from ot_plano_versiones where plano_id = $1`, [plano.id]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno)
  await ir(pagina, `${BASE}/ordenes/${orden.id}/planos?plano=${plano.id}`)
  const archivo = pagina.locator('#version-archivo')
  await archivo.waitFor({ state: 'attached', timeout: 30000 })
  const formulario = archivo.locator('xpath=ancestor::form')
  await formulario.getByLabel('Maestranza', { exact: true }).check()
  await formulario.getByLabel('Producción', { exact: true }).check()
  await archivo.setInputFiles({ name: `QA-VIEJA-PL-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`PLANO QA-VIEJA-PL-${sello}`]) })
  const a0 = corte.acciones
  const s0 = corte.storage.length
  corte.despliegue = true
  await formulario.getByRole('button', { name: 'Enviar a revisión' }).click()
  const dice = limpio(await hasta(() => formulario.locator('[role="alert"]').allInnerTexts().then((t) => t.join(' ')), (t) => /actualizó|Falta/.test(t ?? ''), 30000))
  await pagina.waitForTimeout(1500)
  const enStorage = corte.storage.slice(s0).filter((x) => x.includes('planos-privados'))
  const subidasPl = enStorage.filter((x) => x.startsWith('POST')).length
  const borrados = enStorage.filter((x) => x.startsWith('DELETE')).length
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1h-plano.png') })
  comprobar(dice === 'El sistema se actualizó mientras tenías la pantalla abierta. Copia lo escrito y vuelve a cargar la pantalla.',
    `[Diseño 1280] 1h. el plano a Maestranza y Producción desde la pestaña vieja dice solo que hay que recargar, sin «Vuelve a enviar sin cambiar el archivo» («${dice}»)`)
  comprobar(corte.acciones - a0 === 1 && subidasPl === 1 && borrados === 1 && (await versiones()) === 0 && (await hasta(sueltos, (l) => l.length === 0, 10000)).length === 0,
    `[Diseño 1280] 1h. una sola llamada, una subida y su borrado, ninguna versión y ningún PDF suelto (${corte.acciones - a0} llamada; Storage: ${enStorage.join(', ')})`)
  corte.despliegue = false
  comprobar(errores.length === 0, `[Diseño 1280] 1h. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1s. Lo que va por su cuenta, fuera de useAccion (Ventas, Diseño)
// «Volver a cargar» esperaba solo lo que iba por `useAccion`: con «Subir
// cotización» o el Excel del cronograma en camino recargaba en el acto, y el
// archivo quedaba subido sin anotar (D17 de la trigesimotercera pasada). Ahora
// espera a que vuelva y, cuando entra, recarga. Con la ventana cerrada en vuelo:
// abierta, tapa el aviso de arriba. La acción que anota se detiene antes de
// salir, como un envío lento.
if (corre('1s-cotizacion')) {
  const numero = `QA-ESPERA-COT-${sello}`
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.ventas])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'cotizaciones-pdf' and o.owner_id = $1 and o.created_at >= $2
        and not exists (select 1 from cotizaciones_pdf c where c.ruta_storage = o.name)`, [yo, desde])).map((o) => o.name)
  const cotizaciones = async () => Number((await consulta(`select count(*) n from cotizaciones_pdf where numero = $1`, [numero]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.ventas, { width: 1280, height: 900 }, { compilacion: true })
  await ir(pagina, `${BASE}/cotizaciones/pdf`)
  await hastaLaPestanaNueva(pagina, corte)
  await marcarDocumento(pagina)
  await pagina.getByRole('button', { name: 'Subir cotización' }).first().click()
  const d = pagina.getByRole('dialog').first()
  await d.waitFor({ timeout: 20000 })
  await d.locator('#cot-archivo').setInputFiles({ name: `${numero}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`COTIZACION ${numero}`, 'Semirremolque de banco']) })
  const subir = d.getByRole('button', { name: 'Subir y mandar a Gerencia' })
  await pagina.waitForTimeout(1500)
  await hasta(async () => !/Leyendo/.test(await d.innerText()) && (await subir.isEnabled()), Boolean, 30000)
  await d.locator('#cot-numero').fill(numero)
  await d.locator('#cot-monto').fill('1000')
  await d.locator('#cot-moneda').selectOption('USD')
  await d.locator('#cot-igv').selectOption('no')
  // Un cliente y una carrocería que ya están: crearlos sería otra acción, que en «nueva» recarga.
  if (await d.locator('#cot-cliente').count()) await d.locator('#cot-cliente').selectOption({ index: 1 })
  if (await d.locator('#cot-carroceria').count()) await d.locator('#cot-carroceria').selectOption({ index: 1 })
  corte.marca = numero
  await subir.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await d.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await botonDeArriba(pagina, 'Volver a cargar').click()
  await pagina.waitForTimeout(3000)
  const esperaba = await mismoDocumento(pagina)
  const enCamino = (await sueltos()).length
  await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}), corte.soltar()])
  await quieta(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1s-cotizacion.png') })
  comprobar(esperaba && enCamino === 1,
    `[Ventas 1280] 1s. con «Subir cotización» en camino y la ventana cerrada, «Volver a cargar» espera (mismo documento ${esperaba}, PDF subido y sin anotar todavía: ${enCamino})`)
  const quedan = await hasta(sueltos, (l) => l.length === 0, 10000)
  comprobar(!(await mismoDocumento(pagina)) && (await cotizaciones()) === 1 && quedan.length === 0,
    `[Ventas 1280] 1s. cuando entra, recarga: la cotización quedó y su PDF no queda suelto (${await cotizaciones()} cotización, ${quedan.length} sueltos)`)
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Ventas 1280] 1s-cotizacion. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

if (corre('1s-cronograma')) {
  // El cronograma es de las órdenes de antes del plan manual, como en
  // probar-documentos-al-elegir: en el banco, y solo aquí, la orden vuelve a
  // ser «de antes» con los disparadores apagados.
  const [orden] = await consulta(`select id, plan_etapas_manual from ordenes_trabajo
                                  where cotizacion_pdf_id is null and estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA', 'BORRADOR') order by numero limit 1`)
  if (orden.plan_etapas_manual) {
    await base.query('begin')
    await base.query(`set local session_replication_role = replica`)
    await base.query(`update ordenes_trabajo set plan_etapas_manual = false where id = $1`, [orden.id])
    await base.query('commit')
  }
  const nombre = `cronograma-espera-${sello}.xlsx`
  const actividad = `Espera del cronograma ${sello}`
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet('Cronograma')
  hoja.addRow(['Área', 'Actividad', 'Referencia', 'Peso (%)', 'Inicio', 'Fin'])
  hoja.addRow(['Acabados', actividad, null, 0, null, null])
  const excel = join(archivos, nombre)
  await libro.xlsx.writeFile(excel)
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.diseno])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'adjuntos-ot' and o.owner_id = $1 and o.created_at >= $2
        and not exists (select 1 from ot_adjuntos a where a.ruta_storage = o.name)`, [yo, desde])).map((o) => o.name)
  const anotados = async () => Number((await consulta(`select count(*) n from ot_adjuntos where orden_id = $1 and tipo = 'CRONOGRAMA' and nombre_archivo = $2`, [orden.id, nombre]))[0].n)
  const actividades = async () => Number((await consulta(`select count(*) n from ot_actividades where orden_id = $1 and nombre = $2`, [orden.id, actividad]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, { width: 1280, height: 900 }, { compilacion: true })
  await ir(pagina, `${BASE}/ordenes/${orden.id}?vista=actividades`)
  await hastaLaPestanaNueva(pagina, corte)
  await marcarDocumento(pagina)
  await pagina.getByRole('button', { name: 'Subir cronograma' }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor({ timeout: 20000 })
  await v.locator(`#cronograma-${orden.id}`).setInputFiles(excel)
  const cargar = v.getByRole('button', { name: 'Cargar 1 actividad' })
  await cargar.waitFor({ timeout: 15000 })
  // Se detiene la que anota el Excel: el cronograma ya entró y el Excel ya subió.
  corte.marca = nombre
  await cargar.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await v.getByRole('button', { name: 'Cerrar', exact: true }).click().catch(() => {})
  await botonDeArriba(pagina, 'Volver a cargar').click()
  await pagina.waitForTimeout(3000)
  const esperaba = await mismoDocumento(pagina)
  const enCamino = (await sueltos()).length
  await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}), corte.soltar()])
  await quieta(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1s-cronograma.png') })
  comprobar(esperaba && enCamino === 1,
    `[Diseño 1280] 1s. con el Excel del cronograma subido y sin anotar todavía, «Volver a cargar» espera (mismo documento ${esperaba}, sin anotar: ${enCamino})`)
  const quedan = await hasta(sueltos, (l) => l.length === 0, 10000)
  comprobar(!(await mismoDocumento(pagina)) && (await actividades()) === 1 && (await anotados()) === 1 && quedan.length === 0,
    `[Diseño 1280] 1s. cuando entra, recarga: la actividad y el Excel quedaron en la orden, y nada suelto (${await anotados()} Excel, ${quedan.length} sueltos)`)
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Diseño 1280] 1s-cronograma. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1s-reenvio. «No entró», y el reenvío corregido en camino (Ventas)
// La cotización con un número que ya existe, cerrada en vuelo: el rechazo se
// quedaba dentro de la ventana cerrada, y arriba se mandaba a leer «el aviso
// junto a su botón», que no estaba (A, H7 y R2 de la trigesimocuarta pasada).
// Ahora va junto al botón, y arriba se dice el motivo mismo: con el botón
// desmontado, mandar a leerlo no servía (D4 de la trigesimosexta).
// Después, la persona corrige y la sube otra vez: «Volver a cargar igual» se
// quedaba puesto, recargaba a los 160 ms con el reenvío en camino y dejaba su
// PDF suelto (F3 de la crítica).
if (corre('1s-reenvio')) {
  const [{ numero: usado }] = await consulta(`select numero from cotizaciones_pdf order by creado_en limit 1`)
  const numero = `QA-REENVIO-COT-${sello}`
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.ventas])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'cotizaciones-pdf' and o.owner_id = $1 and o.created_at >= $2
        and not exists (select 1 from cotizaciones_pdf c where c.ruta_storage = o.name)`, [yo, desde])).map((o) => o.name)
  const cotizaciones = async () => Number((await consulta(`select count(*) n from cotizaciones_pdf where numero = $1`, [numero]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.ventas, { width: 1280, height: 900 }, { compilacion: true })
  await ir(pagina, `${BASE}/cotizaciones/pdf`)
  await hastaLaPestanaNueva(pagina, corte)
  await marcarDocumento(pagina)
  const abrirla = pagina.getByRole('button', { name: 'Subir cotización' }).first()
  // Lo que dice cómo va está en el renglón de estado del encabezado, no al
  // lado: junto al botón lo corría de sitio (diseño H3 de la trigesimoquinta).
  const junto = pagina.locator('[data-estado-del-encabezado]')
  // Respecto del título: el aviso de arriba crece con su frase y baja la página
  // entera. Con la rueda el botón es 2 px más angosto: eso no es correrse.
  const titulo = pagina.locator('main h1').first()
  const donde = async () => {
    const [caja, h1] = [await abrirla.boundingBox(), await titulo.boundingBox()]
    return caja && h1 && { x: Math.round(caja.x + caja.width), y: Math.round(caja.y - h1.y) }
  }
  const quieto = (a, b) => a !== null && b !== null && Math.abs(a.x - b.x) <= 4 && a.y === b.y
  const dondeAntes = await donde()
  const llenar = async (n) => {
    await abrirla.click()
    const d = pagina.getByRole('dialog').first()
    await d.waitFor({ timeout: 20000 })
    await d.locator('#cot-archivo').setInputFiles({ name: `reenvio-${sello}-${n.length}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`COTIZACION ${n}`, 'Semirremolque de banco']) })
    const subir = d.getByRole('button', { name: 'Subir y mandar a Gerencia' })
    await pagina.waitForTimeout(1500)
    await hasta(async () => !/Leyendo/.test(await d.innerText()) && (await subir.isEnabled()), Boolean, 30000)
    await d.locator('#cot-numero').fill(n)
    await d.locator('#cot-monto').fill('1000')
    await d.locator('#cot-moneda').selectOption('USD')
    await d.locator('#cot-igv').selectOption('no')
    if (await d.locator('#cot-cliente').count()) await d.locator('#cot-cliente').selectOption({ index: 1 })
    if (await d.locator('#cot-carroceria').count()) await d.locator('#cot-carroceria').selectOption({ index: 1 })
    return { d, subir }
  }

  // A. El número repetido, con la ventana cerrada mientras va.
  let { d, subir } = await llenar(usado)
  corte.marca = usado
  await subir.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await d.getByRole('button', { name: 'Cerrar', exact: true }).click()
  const ocupadoEnVuelo = (await abrirla.getAttribute('aria-disabled')) === 'true'
  const sigue = await loQueDescribe(abrirla)
  const dondeEnVuelo = await donde()
  await botonDeArriba(pagina, 'Volver a cargar').click()
  await pagina.waitForTimeout(1000)
  corte.soltar()
  const conMotivo = (t) => t.startsWith('Lo que enviaste no entró, o no se sabe si entró: ') && t !== NO_ENTRO
  const porque = await hasta(() => sinRecargar(pagina), conMotivo, 20000)
  const alerta = limpio(await hasta(() => junto.locator('[role="alert"]').innerText().catch(() => ''), Boolean, 10000))
  const dondeConAlerta = await donde()
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1s-reenvio-rechazo.png') })
  comprobar(quieto(dondeAntes, dondeEnVuelo) && quieto(dondeAntes, dondeConAlerta),
    `[Ventas 1280] 1s-reenvio. «Subir cotización» no se mueve cuando aparece su estado (borde derecho y alto desde el título: antes ${JSON.stringify(dondeAntes)}, en vuelo ${JSON.stringify(dondeEnVuelo)}, con el rechazo ${JSON.stringify(dondeConAlerta)})`)
  comprobar(ocupadoEnVuelo && sigue === 'La cotización se sigue enviando: lo que conteste se dice aquí.',
    `[Ventas 1280] 1s-reenvio. cerrada en vuelo, «Subir cotización» gira y dice que sigue (ocupado ${ocupadoEnVuelo}, «${sigue}»)`)
  comprobar(conMotivo(porque) && porque.includes('Ya hay una cotización con el número') && alerta.startsWith('La cotización que se estaba enviando no se registró: Ya hay una cotización con el número') && (await mismoDocumento(pagina)),
    `[Ventas 1280] 1s-reenvio. arriba dice por qué no entró, y junto a su botón también: «${porque}» / «${alerta}»`)
  comprobar((await hasta(sueltos, (l) => l.length === 0, 10000)).length === 0,
    `[Ventas 1280] 1s-reenvio. el PDF del rechazo no queda suelto`)

  // B. Reabrir no lo borra; el reenvío corregido, otra vez cerrado en vuelo.
  ;({ d, subir } = await llenar(numero))
  const sigueAlReabrir = await junto.locator('[role="alert"]').count()
  corte.marca = numero
  await subir.click()
  await hasta(() => corte.retenidas, (n) => n > 1, 30000)
  await d.getByRole('button', { name: 'Cerrar', exact: true }).click()
  const boton = pagina.locator('[data-pestana-vieja]').getByRole('button').first()
  const dice = limpio(await boton.innerText())
  const porqueAhora = await sinRecargar(pagina)
  await boton.click()
  await pagina.waitForTimeout(3000)
  const esperaba = await mismoDocumento(pagina)
  const enCamino = (await sueltos()).length
  await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}), corte.soltar()])
  await quieta(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1s-reenvio.png') })
  comprobar(sigueAlReabrir === 1, `[Ventas 1280] 1s-reenvio. reabrir la ventana no borra el motivo (${sigueAlReabrir} aviso junto al botón)`)
  comprobar(dice === 'Volver a cargar' && porqueAhora === '',
    `[Ventas 1280] 1s-reenvio. con el reenvío en camino, el aviso de arriba ya no dice «no entró» y el botón vuelve a esperar («${dice}», «${porqueAhora}»)`)
  comprobar(esperaba && enCamino === 1,
    `[Ventas 1280] 1s-reenvio. el toque espera el reenvío (mismo documento ${esperaba}, PDF subido y sin anotar todavía: ${enCamino})`)
  const quedan = await hasta(sueltos, (l) => l.length === 0, 10000)
  comprobar(!(await mismoDocumento(pagina)) && (await cotizaciones()) === 1 && quedan.length === 0,
    `[Ventas 1280] 1s-reenvio. cuando entra, recarga: la cotización quedó y nada suelto (${await cotizaciones()} cotización, ${quedan.length} sueltos)`)
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Ventas 1280] 1s-reenvio. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1s-cronograma-sin-respuesta. Cerrada en vuelo, la respuesta no llega (Diseño, a 390)
// El mismo hallazgo en otra de las cuatro cadenas: sin respuesta, lo que dice
// cómo terminó estaba dentro de la ventana cerrada. Ahora va en el renglón de
// la tarjeta, bajo «Subir cronograma», sin «no se registró»: pudo entrar.
if (corre('1s-cronograma-sin-respuesta')) {
  const [orden] = await consulta(`select id, plan_etapas_manual from ordenes_trabajo
                                  where cotizacion_pdf_id is null and estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA', 'BORRADOR') order by numero desc limit 1`)
  if (orden.plan_etapas_manual) {
    await base.query('begin')
    await base.query(`set local session_replication_role = replica`)
    await base.query(`update ordenes_trabajo set plan_etapas_manual = false where id = $1`, [orden.id])
    await base.query('commit')
  }
  const actividad = `Sin respuesta del cronograma ${sello}`
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet('Cronograma')
  hoja.addRow(['Área', 'Actividad', 'Referencia', 'Peso (%)', 'Inicio', 'Fin'])
  hoja.addRow(['Acabados', actividad, null, 0, null, null])
  const excel = join(archivos, `cronograma-sin-respuesta-${sello}.xlsx`)
  await libro.xlsx.writeFile(excel)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, CELULAR, { compilacion: true })
  await ir(pagina, `${BASE}/ordenes/${orden.id}?vista=actividades`)
  const abrirla = pagina.getByRole('button', { name: 'Subir cronograma' })
  const junto = pagina.locator(`#estado-del-cronograma-${orden.id}`).locator('xpath=..')
  await abrirla.click()
  const v = pagina.getByRole('dialog')
  await v.waitFor({ timeout: 20000 })
  await v.locator(`#cronograma-${orden.id}`).setInputFiles(excel)
  const cargar = v.getByRole('button', { name: 'Cargar 1 actividad' })
  await cargar.waitFor({ timeout: 15000 })
  await v.getByRole('checkbox').uncheck().catch(() => {})
  corte.marca = actividad
  corte.perder = actividad
  await cargar.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await v.getByRole('button', { name: 'Cerrar', exact: true }).click()
  const ocupadoEnVuelo = (await abrirla.getAttribute('aria-disabled')) === 'true'
  const sigue = await loQueDescribe(abrirla)
  corte.soltar()
  const alerta = limpio(await hasta(() => junto.locator('[role="alert"]').innerText().catch(() => ''), Boolean, 20000))
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1s-cronograma-sin-respuesta-390.png') })
  comprobar(ocupadoEnVuelo && sigue === 'El cronograma se sigue enviando: lo que conteste se dice aquí.',
    `[Diseño 390] 1s-cronograma-sin-respuesta. cerrada en vuelo, «Subir cronograma» gira y dice que sigue (ocupado ${ocupadoEnVuelo}, «${sigue}»)`)
  comprobar(corte.perdidas === 1 && alerta.startsWith('El cronograma que se estaba enviando: No llegó la respuesta'),
    `[Diseño 390] 1s-cronograma-sin-respuesta. sin respuesta, el renglón de su tarjeta dice que no se sabe si quedó, sin «no se registró»: «${alerta}»`)
  comprobar((await abrirla.getAttribute('aria-disabled')) !== 'true',
    `[Diseño 390] 1s-cronograma-sin-respuesta. ya contestó: el botón vuelve a abrir la ventana`)
  // El envío siguiente, con la ventana abierta y la respuesta a tiempo: el motivo de antes se va.
  hoja.getRow(2).getCell(2).value = `${actividad} otra vez`
  await libro.xlsx.writeFile(excel)
  await abrirla.click()
  await v.waitFor({ timeout: 20000 })
  const sigueAlReabrir = await junto.locator('[role="alert"]').count()
  await v.locator(`#cronograma-${orden.id}`).setInputFiles(excel)
  await cargar.waitFor({ timeout: 15000 })
  await v.getByRole('checkbox').uncheck().catch(() => {})
  await cargar.click()
  const verde = limpio(await hasta(() => junto.locator('[role="status"]').allInnerTexts().then((l) => l.join(' ')), (t) => /Cronograma cargado|actividad/i.test(t), 30000))
  const alertaDespues = await junto.locator('[role="alert"]').count()
  comprobar(sigueAlReabrir === 1 && alertaDespues === 0 && verde !== '',
    `[Diseño 390] 1s-cronograma-sin-respuesta. reabrir no borra el motivo; el envío siguiente, al entrar, sí (al reabrir ${sigueAlReabrir}, después ${alertaDespues}; «${verde}»)`)
  comprobar(errores.length === 0, `[Diseño 390] 1s-cronograma-sin-respuesta. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1s-orden-pdf. El PDF de la orden, que sube al elegirlo (Administración)
// Iba fuera de `mientrasSeEnvia`: «Volver a cargar» recargaba a los 180 ms, y
// el PDF quedaba cortado o subido sin anotar (C, H5 y R1 de la trigesimocuarta).
// Ahora espera a que quede anotado. Se detiene la acción que lo anota.
if (corre('1s-orden-pdf')) {
  const [ot] = await consulta(
    `select o.id, o.numero from ordenes_trabajo o
     where o.cotizacion_pdf_id is null and o.estado <> 'ANULADA'
       and not exists (select 1 from ot_adjuntos a where a.orden_id = o.id and a.tipo = 'ORDEN') order by o.numero desc limit 1`,
  )
  const nombre = `orden-espera-${sello}.pdf`
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.administracion])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'adjuntos-ot' and o.owner_id = $1 and o.created_at >= $2
        and not exists (select 1 from ot_adjuntos a where a.ruta_storage = o.name)`, [yo, desde])).map((o) => o.name)
  const anotados = async () => Number((await consulta(`select count(*) n from ot_adjuntos where orden_id = $1 and tipo = 'ORDEN' and nombre_archivo = $2`, [ot?.id, nombre]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 }, { compilacion: true })
  await ir(pagina, `${BASE}/ordenes/${ot?.id}`)
  const campo = pagina.locator(`input[type="file"]#subir-pdf-${ot?.id}, #subir-pdf-${ot?.id} input[type="file"]`).first()
  if (!ot || (await campo.count()) === 0) {
    comprobar(false, `[Administración 1280] 1s-orden-pdf. hay una orden sin PDF que ofrezca «Subir el PDF de la orden» (${ot?.numero ?? 'ninguna'})`)
  } else {
    await hastaLaPestanaNueva(pagina, corte)
    await marcarDocumento(pagina)
    corte.marca = nombre
    await campo.setInputFiles({ name: nombre, mimeType: 'application/pdf', buffer: pdfConTexto([`Orden ${ot.numero}`, `Espera ${sello}`]) })
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await botonDeArriba(pagina, 'Volver a cargar').click()
    await pagina.waitForTimeout(3000)
    const esperaba = await mismoDocumento(pagina)
    const enCamino = (await sueltos()).length
    await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}), corte.soltar()])
    await quieta(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1s-orden-pdf.png') })
    comprobar(esperaba && enCamino === 1,
      `[Administración 1280] 1s-orden-pdf. con el PDF de la orden subido y sin anotar todavía, «Volver a cargar» espera (mismo documento ${esperaba}, sin anotar: ${enCamino})`)
    const quedan = await hasta(sueltos, (l) => l.length === 0, 10000)
    comprobar(!(await mismoDocumento(pagina)) && (await anotados()) === 1 && quedan.length === 0,
      `[Administración 1280] 1s-orden-pdf. cuando queda anotado, recarga: la orden tiene su PDF y nada suelto (${await anotados()} anotado, ${quedan.length} sueltos)`)
  }
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Administración 1280] 1s-orden-pdf. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1t-cronograma. «Cancelar» en vuelo, y «Nueva tarea» se lleva el botón (Diseño)
// «Cancelar» cerraba la ventana del cronograma sin decirle al envío que iba
// sin ella: el botón no giraba y el rechazo no se decía (realización H1 de la
// trigesimoquinta pasada). Y «Nueva tarea» desmonta «Subir cronograma»: el
// envío en camino y su desenlace se iban con él (diseño H1). Ahora lo del
// envío vive con la orden, no con el botón: al volver, gira si sigue.
//
// Lo que dice va en su renglón, arriba del cuerpo de la tarjeta: junto al
// botón lo corría 346 px y lo bajaba de línea (D3 de la trigesimosexta), y con
// «Nueva tarea» abierta no se veía (D4). El Excel pasa de 100 % en Acabados:
// la pantalla lo marca en rojo y deja cargar, y la base lo rechaza.
if (corre('1t-cronograma')) {
  const orden = await ordenParaElCronograma()
  const actividad = `Pasa de cien ${sello}`
  const excel = await cronogramaQuePasaDeCien(actividad, `cronograma-pasa-de-cien-${sello}.xlsx`)
  const actividades = async () => Number((await consulta(`select count(*) n from ot_actividades where orden_id = $1 and nombre like $2`, [orden.id, `${actividad}%`]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/ordenes/${orden.id}?vista=actividades`)
  const abrirla = pagina.getByRole('button', { name: 'Subir cronograma' })
  const renglon = pagina.locator(`#estado-del-cronograma-${orden.id}`).locator('xpath=..')
  const nuevaTarea = pagina.getByRole('button', { name: 'Nueva tarea', exact: true })
  const cancelarTarea = pagina.locator('form').filter({ has: pagina.getByRole('button', { name: 'Agregar a la lista' }) }).getByRole('button', { name: 'Cancelar', exact: true })
  // Respecto del título de la pantalla; con la rueda el botón cambia 2 px de ancho.
  const titulo = pagina.locator('main h1').first()
  const donde = async () => {
    const [caja, h1] = [await abrirla.boundingBox(), await titulo.boundingBox()]
    return caja && h1 && { x: Math.round(caja.x), derecha: Math.round(caja.x + caja.width), y: Math.round(caja.y - h1.y) }
  }
  const quieto = (a, b) => Boolean(a && b) && (Math.abs(a.x - b.x) <= 4 || Math.abs(a.derecha - b.derecha) <= 4) && a.y === b.y
  const dondeAntes = await donde()
  await abrirla.click()
  const v = pagina.getByRole('dialog')
  await v.waitFor({ timeout: 20000 })
  await v.locator(`#cronograma-${orden.id}`).setInputFiles(excel)
  const cargar = v.getByRole('button', { name: 'Cargar 2 actividades' })
  await cargar.waitFor({ timeout: 15000 })
  await v.getByRole('checkbox').uncheck().catch(() => {})
  corte.marca = actividad
  await cargar.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  // «Cancelar», no la X: es el que no avisaba.
  await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await hasta(() => v.count(), (n) => n === 0, 5000)
  const ocupadoAlCancelar = (await abrirla.getAttribute('aria-disabled')) === 'true'
  const sigueAlCancelar = await loQueDescribe(abrirla)
  const dondeEnVuelo = await donde()
  // «Nueva tarea» se lleva «Subir cronograma»; su «Cancelar» lo devuelve.
  await nuevaTarea.click()
  await cancelarTarea.waitFor({ timeout: 10000 })
  const sinBoton = (await abrirla.count()) === 0
  const sigueSinBoton = limpio(await renglon.innerText().catch(() => ''))
  await cancelarTarea.click()
  await abrirla.waitFor({ timeout: 10000 })
  const ocupadoAlVolver = (await abrirla.getAttribute('aria-disabled')) === 'true'
  const sigueAlVolver = await loQueDescribe(abrirla)
  // Otra vez «Nueva tarea», y el rechazo llega con el botón fuera.
  await nuevaTarea.click()
  await cancelarTarea.waitFor({ timeout: 10000 })
  corte.soltar()
  const alertaSinBoton = limpio(await hasta(() => renglon.locator('[role="alert"]').innerText().catch(() => ''), Boolean, 20000))
  const visibleSinBoton = await renglon.locator('[role="alert"]').isVisible().catch(() => false)
  const botonSinBoton = await abrirla.count()
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1t-cronograma-nueva-tarea.png') })
  await cancelarTarea.click()
  await abrirla.waitFor({ timeout: 10000 })
  const alerta = limpio(await renglon.locator('[role="alert"]').innerText().catch(() => ''))
  const dondeConAlerta = await donde()
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1t-cronograma.png') })
  const SIGUE = 'El cronograma se sigue enviando: lo que conteste se dice aquí.'
  comprobar(ocupadoAlCancelar && sigueAlCancelar === SIGUE,
    `[Diseño 1280] 1t-cronograma. «Cancelar» en vuelo: «Subir cronograma» gira y dice que sigue (ocupado ${ocupadoAlCancelar}, «${sigueAlCancelar}»)`)
  comprobar(sinBoton && sigueSinBoton.includes(SIGUE),
    `[Diseño 1280] 1t-cronograma. con «Nueva tarea» abierta el botón no está, y el renglón de la tarjeta dice que sigue (se fue ${sinBoton}, «${sigueSinBoton}»)`)
  comprobar(ocupadoAlVolver && sigueAlVolver === SIGUE,
    `[Diseño 1280] 1t-cronograma. tras «Nueva tarea» y su «Cancelar», el botón vuelve girando y dice que sigue (ocupado ${ocupadoAlVolver}, «${sigueAlVolver}»)`)
  comprobar(botonSinBoton === 0 && visibleSinBoton && alertaSinBoton.startsWith('El cronograma que se estaba enviando no se registró: ') && alertaSinBoton.includes('suman'),
    `[Diseño 1280] 1t-cronograma. el rechazo que llega con «Nueva tarea» abierta se ve en el renglón, sin el botón: «${alertaSinBoton}»`)
  comprobar(alerta === alertaSinBoton && (await actividades()) === 0,
    `[Diseño 1280] 1t-cronograma. al volver el botón, el rechazo sigue dicho, y no entró nada (${await actividades()} actividades)`)
  comprobar(quieto(dondeAntes, dondeEnVuelo) && quieto(dondeAntes, dondeConAlerta),
    `[Diseño 1280] 1t-cronograma. «Subir cronograma» no se mueve cuando aparece lo que dice (antes ${JSON.stringify(dondeAntes)}, en vuelo ${JSON.stringify(dondeEnVuelo)}, con el rechazo ${JSON.stringify(dondeConAlerta)})`)
  // Con el desenlace ya a la vista, «Nueva tarea» y «Cancelar» no lo borran.
  await nuevaTarea.click()
  await cancelarTarea.waitFor({ timeout: 10000 })
  await cancelarTarea.click()
  await abrirla.waitFor({ timeout: 10000 })
  const alertaDespues = limpio(await renglon.locator('[role="alert"]').innerText().catch(() => ''))
  comprobar(alertaDespues !== '' && alertaDespues === alerta, `[Diseño 1280] 1t-cronograma. «Nueva tarea» y «Cancelar» no borran el rechazo ya dicho («${alertaDespues}»)`)
  comprobar(errores.length === 0, `[Diseño 1280] 1t-cronograma. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1t-correccion. La corrección cerrada en vuelo que entra (Ventas)
// «Lo que conteste se dice aquí», y cuando entraba no se decía nada: la
// tarjeta cambiaba callada (diseño H2 y funcionalidad H4 de la trigesimoquinta).
// «Cancelar» quedaba trabado con lo demás mientras se enviaba (D2 de la
// trigesimosexta), y el verde «Gerencia revisa esta versión» seguía junto a la
// cotización que Gerencia ya había rechazado (D1).
if (corre('1t-correccion')) {
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.ventas])
  const [cot] = await consulta(`select id, numero, version from cotizaciones_pdf where registrado_por = $1 and estado = 'POR_REVISAR' order by creado_en desc limit 1`, [yo])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'cotizaciones-pdf' and o.owner_id = $1 and o.created_at >= $2
        and not exists (select 1 from cotizaciones_pdf c where c.ruta_storage = o.name)
        and not exists (select 1 from cotizaciones_pdf_versiones v where v.ruta_storage = o.name)`, [yo, desde])).map((o) => o.name)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.ventas, { width: 1280, height: 900 })
  if (!cot) {
    comprobar(false, '[Ventas 1280] 1t-correccion. hay una cotización de Ventas por revisar para corregir')
  } else {
    await ir(pagina, `${BASE}/cotizaciones/pdf`)
    const abrirla = pagina.locator(`li[id="${cot.id}"]`).getByRole('button', { name: /Editar cotización|Subir corrección/ })
    const junto = abrirla.locator('xpath=..')
    await abrirla.click()
    const e = pagina.getByRole('dialog').first()
    await e.waitFor({ timeout: 20000 })
    const motivo = `Corrección en vuelo ${sello}`
    await e.locator(`#corregir-motivo-${cot.id}`).fill(motivo)
    await e.locator(`#corregir-archivo-${cot.id}`).setInputFiles({ name: `${cot.numero}-en-vuelo.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`COTIZACION ${cot.numero}`, `En vuelo ${sello}`]) })
    const guardar = e.getByRole('button', { name: 'Guardar versión y enviar a Gerencia' })
    await pagina.waitForTimeout(1500)
    await hasta(async () => !/Leyendo/.test(await e.innerText()) && (await guardar.isEnabled()), Boolean, 30000)
    await e.locator('#corregir-monto').fill('1200')
    await e.locator('#corregir-moneda').selectOption('USD')
    await e.locator('#corregir-igv').selectOption('no')
    corte.marca = motivo
    await guardar.click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    const cancelar = e.getByRole('button', { name: 'Cancelar', exact: true })
    const cancelarSeUsa = await cancelar.isEnabled()
    if (cancelarSeUsa) await cancelar.click()
    else await e.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    comprobar(cancelarSeUsa, `[Ventas 1280] 1t-correccion. mientras se envía, «Cancelar» cierra como la X: no queda trabado con lo demás`)
    const ocupado = (await abrirla.getAttribute('aria-disabled')) === 'true'
    const sigue = await loQueDescribe(abrirla)
    corte.soltar()
    const verde = limpio(await hasta(() => junto.locator('[role="status"]').allInnerTexts().then((l) => l.join(' ')), (t) => t.includes('quedó guardada'), 20000))
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1t-correccion.png') })
    const [ahora] = await consulta(`select version from cotizaciones_pdf where id = $1`, [cot.id])
    comprobar(ocupado && sigue === 'La corrección se sigue enviando: lo que conteste se dice aquí.',
      `[Ventas 1280] 1t-correccion. cerrada en vuelo, el botón gira y dice que sigue (ocupado ${ocupado}, «${sigue}»)`)
    comprobar(verde === 'La corrección que se estaba enviando quedó guardada: Gerencia revisa esta versión.' && (await junto.locator('[role="alert"]').count()) === 0 && ahora.version === cot.version + 1,
      `[Ventas 1280] 1t-correccion. cuando entra, lo dice en verde junto al botón, sin alerta («${verde}», versión ${cot.version} → ${ahora.version})`)
    comprobar((await hasta(sueltos, (l) => l.length === 0, 10000)).length === 0, `[Ventas 1280] 1t-correccion. nada suelto`)
    // Gerencia la rechaza, con su cuenta y su permiso; Ventas va a «Rechazadas».
    let filas = 0
    await comoLaCuenta(CUENTAS.gerencia, async () => {
      filas = (await base.query(`update cotizaciones_pdf set estado = 'RECHAZADA', observacion = $2 where id = $1`, [cot.id, `Rechazada en el banco ${sello}`])).rowCount
    })
    await marcarDocumento(pagina)
    await pagina.getByRole('link', { name: /^Rechazadas/ }).first().click()
    await pagina.waitForURL((u) => u.searchParams.get('estado') === 'RECHAZADA', { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    const tarjeta = pagina.locator(`li[id="${cot.id}"]`)
    await tarjeta.waitFor({ timeout: 15000 }).catch(() => {})
    const dice = limpio(await tarjeta.innerText().catch(() => ''))
    const estadoAhora = limpio(await junto.locator('[role="status"]').allInnerTexts().then((l) => l.join(' ')).catch(() => ''))
    const nombre = limpio(await abrirla.innerText().catch(() => ''))
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1t-correccion-rechazada.png') })
    comprobar(filas === 1 && dice.includes('Rechazada') && nombre === 'Subir corrección' && (await mismoDocumento(pagina)) && !estadoAhora.includes('quedó guardada'),
      `[Ventas 1280] 1t-correccion. ya rechazada por Gerencia, junto a «${nombre}» no sigue diciendo que Gerencia la revisa (${filas} fila, «${estadoAhora}»)`)
  }
  comprobar(errores.length === 0, `[Ventas 1280] 1t-correccion. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1t-dos-tarjetas. «Dar código y cargar la OT» de una, con la otra en su ventana (Administración)
// La que entraba recargaba la pantalla para ir a su tarjeta: la ventana de la
// otra cotización se cerraba con lo escrito, y si ya iba, su OT no entraba y
// su PDF quedaba suelto (X1 de la crítica de la trigesimoquinta). Esperar a
// que no quedara nada abierto dejaba la ida armada, y salía minutos después
// desde otra pantalla (Y1 de la trigesimosexta): ahora va en el acto, sin
// recargar, o no va, y el encabezado dice que entró con el camino a su tarjeta.
/**
 * Las `n` cotizaciones aprobadas sin OT más nuevas. Cada corrida les carga OT a
 * algunas: si el banco ya no tiene tantas, se siembran copiando una aprobada,
 * con los disparadores apagados. Lo que se prueba aquí es la OT; la aprobación
 * la prueba probar-gerencia-aprueba-y-administracion-carga-la-ot por su pantalla.
 */
let sembradas = 0
async function aprobadasSinOt(n) {
  const hay = () =>
    consulta(`select c.id, c.numero from cotizaciones_pdf c where c.estado = 'APROBADA'
                and not exists (select 1 from ordenes_trabajo o where o.cotizacion_pdf_id = c.id) order by c.creado_en desc limit $1`, [n])
  const ya = await hay()
  const [modelo] = await consulta(`select id from cotizaciones_pdf where estado = 'APROBADA' order by creado_en limit 1`)
  if (ya.length >= n || !modelo) return ya
  await consulta('begin')
  try {
    await consulta('set local session_replication_role = replica')
    for (let i = ya.length; i < n; i++) {
      // La ruta va dentro de la carpeta de su id (ck_cotizacion_pdf_ruta).
      await consulta(`with nueva as (select gen_random_uuid() id)
                      insert into cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, estado, revisado_por, revisado_en, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
                      select nueva.id, $2, c.cliente_id, c.tipo_carroceria_id, 'APROBADA', c.revisado_por, now(), c.nombre_archivo, 'cot/' || nueva.id || '/sembrada.pdf', c.mime_type, c.tamano_bytes, c.registrado_por, c.monto_venta, c.moneda
                      from cotizaciones_pdf c, nueva where c.id = $1`, [modelo.id, `QA-SEMBRADA-${sello}-${sembradas++}`])
    }
    await consulta('commit')
  } catch (e) {
    await consulta('rollback')
    throw e
  }
  return hay()
}
const anioDeLima = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric' }).format(new Date())
const numerosLibres = async (n) =>
  (await consulta(`select n from generate_series(9100, 9999) n
                   where not exists (select 1 from ordenes_trabajo o where o.numero = n || '-' || $1) order by n desc limit $2`, [anioDeLima(), n])).map((x) => x.n)
const otDe = async (id) => Number((await consulta(`select count(*) n from ordenes_trabajo where cotizacion_pdf_id = $1`, [id]))[0].n)
/** Abre «Dar código y cargar la OT» de la tarjeta `id` y la deja lista para guardar. */
async function llenarLaOt(pagina, id, codigo, n) {
  const anio = anioDeLima()
  const boton = pagina.locator(`li[id="${id}"]`).getByRole('button', { name: 'Dar código y cargar la OT' })
  await boton.scrollIntoViewIfNeeded().catch(() => {})
  await boton.click()
  const d = pagina.getByRole('dialog').first()
  await d.waitFor({ timeout: 20000 })
  await d.locator('#eo-codigo-interno').fill(codigo)
  await d.locator(`#aprobar-pdf-${id}`).setInputFiles({ name: `OT-${n}.pdf`, mimeType: 'application/pdf',
    buffer: pdfConTexto([`ORDEN DE TRABAJO N ${n}-${anio}`, `FECHA DE ENTREGA: 15/12/${anio}`]) })
  const guardar = d.getByRole('button', { name: 'Guardar código y OT' })
  await pagina.waitForTimeout(1500)
  await hasta(async () => !/Leyendo/.test(await d.innerText()) && (await guardar.isEnabled()), Boolean, 30000)
  await d.locator('#eo-numero').fill(String(n))
  await d.locator('#eo-fecha').fill(`${anio}-12-15`)
  await d.locator('#eo-tipo').selectOption('SEMIRREMOLQUE')
  return { d, guardar }
}
/**
 * Desde la tarjeta `id`, ya en /cotizaciones/pdf#id: al menú de Órdenes, y
 * «Atrás» vuelve a Cotización en un paso; «Adelante» va a Órdenes y otro
 * «Atrás» vuelve. Ir al ancla dejaba la entrada sin el estado de Next: la
 * dirección cambiaba y la pantalla no (H1 de los tres auditores, trigesimoséptima).
 */
async function atrasDesdeLaTarjeta(pagina, id) {
  const titulo = () => pagina.locator('main h1').first().innerText().then(limpio).catch(() => '')
  const conEstado = await pagina.evaluate(() => window.history.state?.__NA === true)
  await porElMenu(pagina, '/ordenes')
  const pasos = []
  for (const [mover, camino, h1] of [['back', `/cotizaciones/pdf#${id}`, 'Cotización'], ['forward', '/ordenes', 'Órdenes de trabajo'], ['back', `/cotizaciones/pdf#${id}`, 'Cotización']]) {
    await pagina.evaluate((m) => window.history[m](), mover)
    const visto = await hasta(titulo, (t) => t === h1, 10000)
    const donde = pagina.url().replace(BASE, '')
    pasos.push({ donde, visto, bien: donde === camino && visto === h1 })
  }
  const quieto = await mismoDocumento(pagina)
  return {
    bien: conEstado && quieto && pasos.every((p) => p.bien),
    detalle: `estado de Next en la entrada ${conEstado}, ${pasos.map((p) => `${p.donde} «${p.visto}»`).join(' → ')}, mismo documento ${quieto}`,
  }
}
/** Lo que Administración subió desde `desde` y ninguna fila de la orden nombra. */
const sueltosDeLaOt = async (desde) =>
  (await consulta(`select o.name from storage.objects o where o.bucket_id = 'adjuntos-ot' and o.owner_id = (select id::text from usuarios where correo = $1) and o.created_at >= $2
      and not exists (select 1 from ot_adjuntos a where a.ruta_storage = o.name)`, [CUENTAS.administracion, desde])).map((o) => o.name)

if (corre('1t-dos-tarjetas')) {
  const dos = await aprobadasSinOt(2)
  const libres = await numerosLibres(2)
  const [{ t: desde }] = await consulta(`select now() as t`)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  if (dos.length < 2 || libres.length < 2) {
    comprobar(false, `[Administración 1280] 1t-dos-tarjetas. hay dos cotizaciones aprobadas sin OT (${dos.length}) y dos números libres`)
  } else {
    const [a, b] = dos
    const encabezado = pagina.locator('[data-estado-del-encabezado]')
    const LINEA_A = `Se cargó el código y la OT de la cotización ${a.numero}.`
    await ir(pagina, `${BASE}/cotizaciones/pdf?estado=APROBADA_SIN_OT`)
    await marcarDocumento(pagina)
    // A: va, y la ventana se cierra en vuelo con «Cancelar».
    const codigoA = `QA_X1A_${sello}/26`
    const ventanaA = await llenarLaOt(pagina, a.id, codigoA, libres[0])
    corte.marca = `QA_X1A_${sello}`
    await ventanaA.guardar.click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    const cancelar = ventanaA.d.getByRole('button', { name: 'Cancelar', exact: true })
    const cancelarSeUsa = await cancelar.isEnabled()
    if (cancelarSeUsa) await cancelar.click()
    else await ventanaA.d.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    comprobar(cancelarSeUsa, `[Administración 1280] 1t-dos-tarjetas. mientras se envía, «Cancelar» cierra como la X`)
    // B: su ventana abierta y escrita mientras A vuelve.
    const codigoB = `QA_X1B_${sello}/26`
    const ventanaB = await llenarLaOt(pagina, b.id, codigoB, libres[1])
    corte.soltar()
    await hasta(() => otDe(a.id), (n) => n === 1, 20000)
    const linea = limpio(await hasta(() => encabezado.innerText(), (t) => limpio(t).includes(LINEA_A), 15000))
    await pagina.waitForTimeout(2000)
    const quieto = await mismoDocumento(pagina)
    const dondeA = pagina.url().replace(BASE, '')
    const escrito = await ventanaB.d.locator('#eo-codigo-interno').inputValue().catch(() => '')
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1t-dos-tarjetas-b-abierta.png') })
    comprobar((await otDe(a.id)) === 1 && quieto && dondeA === '/cotizaciones/pdf?estado=APROBADA_SIN_OT' && escrito === codigoB,
      `[Administración 1280] 1t-dos-tarjetas. A entra con la ventana de B abierta: no se recarga ni se va (OT de A ${await otDe(a.id)}, mismo documento ${quieto}, ${dondeA}, B dice «${escrito}»)`)
    comprobar(linea.includes(LINEA_A) && (await encabezado.getByRole('button', { name: 'Ver su tarjeta' }).count()) === 1,
      `[Administración 1280] 1t-dos-tarjetas. el encabezado dice que se cargó la OT de A, con «Ver su tarjeta» («${linea}»)`)
    // B entra con su ventana abierta: va a su tarjeta, resaltada, sin recargar.
    if (quieto && escrito === codigoB) {
      await ventanaB.guardar.click()
      await hasta(() => otDe(b.id), (n) => n === 1, 30000)
      await pagina.waitForURL((u) => u.pathname === '/cotizaciones/pdf' && u.search === '' && u.hash === `#${b.id}`, { timeout: 20000 }).catch(() => {})
      const marcadaB = await hasta(() => resaltada(pagina), (id) => id === b.id, 15000)
      const dondeB = pagina.url().replace(BASE, '')
      await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1t-dos-tarjetas-b.png') })
      comprobar((await otDe(b.id)) === 1 && marcadaB === b.id && dondeB === `/cotizaciones/pdf#${b.id}` && (await mismoDocumento(pagina)),
        `[Administración 1280] 1t-dos-tarjetas. B entra con su ventana abierta y va a su tarjeta, resaltada, sin recargar (resaltada ${marcadaB === b.id ? 'B' : marcadaB}, ${dondeB})`)
      // «Ver su tarjeta» lleva a la de A, y la línea se va.
      await encabezado.getByRole('button', { name: 'Ver su tarjeta' }).click().catch(() => {})
      const marcadaA = await hasta(() => resaltada(pagina), (id) => id === a.id, 15000)
      const dondeVer = pagina.url().replace(BASE, '')
      const lineaDespues = limpio(await encabezado.innerText().catch(() => ''))
      await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1t-dos-tarjetas-a.png') })
      comprobar(marcadaA === a.id && dondeVer === `/cotizaciones/pdf#${a.id}` && (await mismoDocumento(pagina)) && !lineaDespues.includes(LINEA_A),
        `[Administración 1280] 1t-dos-tarjetas. «Ver su tarjeta» lleva a la de A, resaltada, y la línea se va (resaltada ${marcadaA === a.id ? 'A' : marcadaA}, ${dondeVer}, «${lineaDespues}»)`)
      const atras = await atrasDesdeLaTarjeta(pagina, a.id)
      comprobar(atras.bien, `[Administración 1280] 1t-dos-tarjetas. desde la tarjeta de «Ver su tarjeta», al menú y «Atrás» vuelve a Cotización en un paso, y «Adelante» y «Atrás» siguen (${atras.detalle})`)
    }
    const quedan = await hasta(() => sueltosDeLaOt(desde), (l) => l.length === 0, 10000)
    comprobar((await otDe(a.id)) === 1 && (await otDe(b.id)) === 1 && quedan.length === 0,
      `[Administración 1280] 1t-dos-tarjetas. las dos OT y nada suelto (OT de B ${await otDe(b.id)}, ${quedan.length} sueltos)`)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1t-dos-tarjetas. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1t-motivo-arriba. El rechazo de una ventana de useEnvio cerrada en vuelo, en «nueva» (Ventas)
// Nada lo pinta fuera de la ventana, y el aviso de arriba mandaba a leer «el
// aviso junto a su botón», que no existía (funcionalidad H1 de la
// trigesimoquinta): ahora dice el motivo. La placa repetida la rechaza la base.
if (corre('1t-motivo-arriba')) {
  const [unidad] = await consulta(`select u.cliente_id, u.placa from unidades u join clientes c on c.id = u.cliente_id
                                   where u.placa is not null and u.activo and c.activo order by u.creado_en limit 1`)
  const unidades = async () => Number((await consulta(`select count(*) n from unidades where cliente_id = $1`, [unidad.cliente_id]))[0].n)
  const antes = await unidades()
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.ventas, { width: 1280, height: 900 }, { compilacion: true })
  await ir(pagina, `${BASE}/clientes/${unidad.cliente_id}`)
  await hastaLaPestanaNueva(pagina, corte)
  await marcarDocumento(pagina)
  await pagina.getByRole('button', { name: 'Nueva unidad', exact: true }).first().click()
  const d = pagina.getByRole('dialog').first()
  await d.waitFor({ timeout: 20000 })
  const modelo = `QA-MOTIVO ${sello}`
  await d.locator('#nu-marca').fill('QA')
  await d.locator('#nu-modelo').fill(modelo)
  await d.locator('#nu-anio').fill('2020')
  await d.locator('#nu-placa').fill(unidad.placa)
  corte.marca = modelo
  await d.getByRole('button', { name: 'Registrar unidad' }).click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await d.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await botonDeArriba(pagina, 'Volver a cargar').click()
  await pagina.waitForTimeout(1000)
  corte.soltar()
  const porque = await hasta(() => sinRecargar(pagina), (t) => t.startsWith('Lo que enviaste no entró'), 20000)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1t-motivo-arriba.png') })
  comprobar(porque.startsWith('Lo que enviaste no entró, o no se sabe si entró: ') && porque !== NO_ENTRO && /existe/i.test(porque) && (await mismoDocumento(pagina)) && (await unidades()) === antes,
    `[Ventas 1280] 1t-motivo-arriba. la unidad rechazada con la ventana cerrada: arriba dice por qué, sin mandar a un aviso que no está, y no recarga («${porque}»)`)
  const igual = botonDeArriba(pagina, 'Volver a cargar igual')
  await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}), igual.click()])
  comprobar(!(await mismoDocumento(pagina)), `[Ventas 1280] 1t-motivo-arriba. «Volver a cargar igual» recarga`)
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Ventas 1280] 1t-motivo-arriba. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1u-cronograma-arriba. El rechazo con «Nueva tarea» abierta, en «nueva» (Diseño)
// Con la ventana cerrada en vuelo, el rechazo del cronograma lo decía solo su
// renglón, y arriba se mandaba a leer «el aviso junto a su botón» con el botón
// desmontado por «Nueva tarea» (D4 de la trigesimosexta): ahora arriba dice
// por qué, como con la unidad de 1t-motivo-arriba.
if (corre('1u-cronograma-arriba')) {
  const orden = await ordenParaElCronograma()
  const actividad = `Arriba del cronograma ${sello}`
  const excel = await cronogramaQuePasaDeCien(actividad, `cronograma-arriba-${sello}.xlsx`)
  const actividades = async () => Number((await consulta(`select count(*) n from ot_actividades where orden_id = $1 and nombre like $2`, [orden.id, `${actividad}%`]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, { width: 1280, height: 900 }, { compilacion: true })
  await ir(pagina, `${BASE}/ordenes/${orden.id}?vista=actividades`)
  await hastaLaPestanaNueva(pagina, corte)
  await marcarDocumento(pagina)
  await pagina.getByRole('button', { name: 'Subir cronograma' }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor({ timeout: 20000 })
  await v.locator(`#cronograma-${orden.id}`).setInputFiles(excel)
  const cargar = v.getByRole('button', { name: 'Cargar 2 actividades' })
  await cargar.waitFor({ timeout: 15000 })
  await v.getByRole('checkbox').uncheck().catch(() => {})
  corte.marca = actividad
  await cargar.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await v.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await pagina.getByRole('button', { name: 'Nueva tarea', exact: true }).click()
  await pagina.getByRole('button', { name: 'Agregar a la lista' }).waitFor({ timeout: 10000 })
  const sinBoton = (await pagina.getByRole('button', { name: 'Subir cronograma' }).count()) === 0
  await botonDeArriba(pagina, 'Volver a cargar').click()
  await pagina.waitForTimeout(1000)
  corte.soltar()
  const porque = await hasta(() => sinRecargar(pagina), (t) => t.startsWith('Lo que enviaste no entró'), 20000)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1u-cronograma-arriba.png') })
  comprobar(sinBoton && porque.startsWith('Lo que enviaste no entró, o no se sabe si entró: ') && porque !== NO_ENTRO && porque.includes('suman') && (await mismoDocumento(pagina)) && (await actividades()) === 0,
    `[Diseño 1280] 1u-cronograma-arriba. el cronograma rechazado con «Nueva tarea» abierta y sin su botón: arriba dice por qué, y no recarga («${porque}»)`)
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Diseño 1280] 1u-cronograma-arriba. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1u-rechazo-se-queda. La ida a la tarjeta no se lleva el rechazo de otra OT (Administración)
// La OT que entraba con su ventana cerrada recargaba la pantalla para ir a su
// tarjeta, y se llevaba el «Ya hay una OT» que otra acababa de decir junto a
// su botón (F1 de la trigesimosexta). Ahora va sin recargar. Next manda las
// acciones de a una: B, con el número de una OT que ya existe, se detiene, y
// A sale cuando B vuelve rechazada.
if (corre('1u-rechazo-se-queda')) {
  const dos = await aprobadasSinOt(2)
  const [libre] = await numerosLibres(1)
  const [usada] = await consulta(`select split_part(numero, '-', 1) n, numero from ordenes_trabajo where numero like '%-' || $1 order by numero limit 1`, [anioDeLima()])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  if (dos.length < 2 || !libre || !usada) {
    comprobar(false, `[Administración 1280] 1u-rechazo-se-queda. hay dos cotizaciones aprobadas sin OT (${dos.length}), un número libre y una OT de este año`)
  } else {
    const [a, b] = dos
    const marcaB = `QA_F1B_${sello}`
    await ir(pagina, `${BASE}/cotizaciones/pdf?estado=APROBADA_SIN_OT`)
    await marcarDocumento(pagina)
    // B va con el número repetido y se detiene; su ventana se cierra en vuelo.
    const ventanaB = await llenarLaOt(pagina, b.id, `${marcaB}/26`, usada.n)
    corte.marca = marcaB
    await ventanaB.guardar.click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await ventanaB.d.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    // A va detrás, con su PDF ya subido, y su ventana también se cierra.
    const subidas = corte.storage.length
    const marcaA = `QA_F1A_${sello}`
    const ventanaA = await llenarLaOt(pagina, a.id, `${marcaA}/26`, libre)
    await ventanaA.guardar.click()
    await hasta(() => corte.storage.slice(subidas).some((x) => x.startsWith('POST adjuntos-ot/')), Boolean, 20000)
    await pagina.waitForTimeout(500)
    await ventanaA.d.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    const alertaDeB = () =>
      pagina.locator(`li[id="${b.id}"] [role="alert"]`).filter({ hasText: 'La OT que se estaba enviando' }).innerText().then(limpio).catch(() => '')
    // A también se detiene cuando sale, detrás de B: vuelve cuando B ya quitó
    // su PDF. Si A contestara antes, B seguiría en camino y A no iría sola
    // (lo dice el encabezado), que no es lo que se mide aquí.
    corte.marca = marcaA
    const borrados = corte.storage.filter((x) => x.startsWith('DELETE')).length
    corte.soltar()
    const rechazo = await hasta(alertaDeB, (t) => t.includes('Ya hay una OT'), 20000)
    await hasta(() => corte.retenidas, (n) => n >= 2, 20000)
    await hasta(() => corte.storage.filter((x) => x.startsWith('DELETE')).length, (n) => n > borrados, 20000)
    await pagina.waitForTimeout(500)
    corte.soltar()
    await hasta(() => otDe(a.id), (n) => n === 1, 20000)
    await pagina.waitForURL((u) => u.pathname === '/cotizaciones/pdf' && u.search === '' && u.hash === `#${a.id}`, { timeout: 20000 }).catch(() => {})
    const marcada = await hasta(() => resaltada(pagina), (id) => id === a.id, 15000)
    await pagina.waitForTimeout(1000)
    const donde = pagina.url().replace(BASE, '')
    const sigue = await alertaDeB()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1u-rechazo-se-queda.png') })
    comprobar(rechazo.startsWith(`La OT que se estaba enviando no se registró: Ya hay una OT ${usada.numero}`),
      `[Administración 1280] 1u-rechazo-se-queda. B, cerrada en vuelo con un número que ya existe: el rechazo se dice junto a su botón («${rechazo}»)`)
    comprobar(marcada === a.id && donde === `/cotizaciones/pdf#${a.id}` && (await mismoDocumento(pagina)) && sigue === rechazo,
      `[Administración 1280] 1u-rechazo-se-queda. A entra después y va a su tarjeta, resaltada, sin recargar, y el rechazo de B sigue dicho (resaltada ${marcada === a.id ? 'A' : marcada}, ${donde}, «${sigue}»)`)
    const atras = await atrasDesdeLaTarjeta(pagina, a.id)
    comprobar(atras.bien, `[Administración 1280] 1u-rechazo-se-queda. desde la tarjeta a la que fue sola, al menú y «Atrás» vuelve a Cotización en un paso, y «Adelante» y «Atrás» siguen (${atras.detalle})`)
    const quedan = await hasta(() => sueltosDeLaOt(desde), (l) => l.length === 0, 10000)
    comprobar((await otDe(a.id)) === 1 && (await otDe(b.id)) === 0 && quedan.length === 0,
      `[Administración 1280] 1u-rechazo-se-queda. A con su OT, B sin ella, y nada suelto (${quedan.length} sueltos)`)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1u-rechazo-se-queda. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1u-ida-otra-pantalla. La OT que entra con otro envío en camino no se va después (Administración)
// La ida a la tarjeta esperaba a que no quedara nada en camino ni otra ventana
// abierta, y salía minutos después desde la pantalla donde se estuviera:
// aquí, la orden nueva a medio escribir (Y1 de la trigesimosexta). Ahora sale
// en el acto o no sale, y el encabezado dice que entró. El otro envío es el
// PDF de una orden, que se corta sin llegar.
if (corre('1u-ida-otra-pantalla')) {
  const [ot] = await consulta(`select o.id, o.numero from ordenes_trabajo o
                               where o.cotizacion_pdf_id is null and o.estado not in ('ANULADA', 'ENTREGADA', 'FACTURADA')
                                 and not exists (select 1 from ot_adjuntos a where a.orden_id = o.id and a.tipo = 'ORDEN') order by o.numero desc limit 1`)
  const [cot] = await aprobadasSinOt(1)
  const [libre] = await numerosLibres(1)
  const [{ t: desde }] = await consulta(`select now() as t`)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  if (!ot || !cot || !libre) {
    comprobar(false, `[Administración 1280] 1u-ida-otra-pantalla. hay una orden sin PDF (${ot?.numero ?? 'ninguna'}), una cotización aprobada sin OT y un número libre`)
  } else {
    await ir(pagina, `${BASE}/ordenes/${ot.id}`)
    await marcarDocumento(pagina)
    corte.cortarSubida = `adjuntos-ot/ot/${ot.id}/`
    await pagina.locator(`input[type="file"]#subir-pdf-${ot.id}, #subir-pdf-${ot.id} input[type="file"]`).first()
      .setInputFiles({ name: `orden-en-camino-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`Orden ${ot.numero}`, `En camino ${sello}`]) })
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    // Con el PDF subiendo, a Cotización: la OT entra con su ventana abierta.
    await porElMenu(pagina, '/cotizaciones/pdf')
    const LINEA = `Se cargó el código y la OT de la cotización ${cot.numero}.`
    const ventana = await llenarLaOt(pagina, cot.id, `QA_Y1_${sello}/26`, libre)
    await ventana.guardar.click()
    await hasta(() => otDe(cot.id), (n) => n === 1, 30000)
    const linea = limpio(await hasta(() => pagina.locator('[data-estado-del-encabezado]').innerText(), (t) => limpio(t).includes(LINEA), 15000))
    await pagina.waitForTimeout(1500)
    const enCotizacion = pagina.url().replace(BASE, '')
    const quietoEnCotizacion = await mismoDocumento(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1u-ida-otra-pantalla-cotizacion.png') })
    comprobar(linea.includes(LINEA) && enCotizacion === '/cotizaciones/pdf' && quietoEnCotizacion,
      `[Administración 1280] 1u-ida-otra-pantalla. con el PDF de una orden todavía subiendo, la OT que entra no se va a su tarjeta: lo dice el encabezado (${enCotizacion}, «${linea}»)`)
    // A otra pantalla, a escribir; la subida termina mientras tanto.
    await porElMenu(pagina, '/ordenes')
    await porElMenu(pagina, '/ordenes/nueva')
    const texto = `Orden a medio escribir ${sello}`
    await pagina.locator('[name="descripcion"]').fill(texto)
    corte.soltar()
    await pagina.waitForTimeout(3000)
    const dondeAhora = pagina.url().replace(BASE, '')
    const sigueEscrito = await pagina.locator('[name="descripcion"]').inputValue().catch(() => '')
    const quieto = await mismoDocumento(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1u-ida-otra-pantalla-nueva.png') })
    comprobar(dondeAhora === '/ordenes/nueva' && quieto && sigueEscrito === texto,
      `[Administración 1280] 1u-ida-otra-pantalla. cuando la subida termina, nada se lleva la orden nueva a medio escribir (${dondeAhora}, mismo documento ${quieto}, «${sigueEscrito}»)`)
    // De vuelta en la orden, la subida cortada se dice, y nada quedó suelto.
    await pagina.evaluate(() => window.history.go(-3))
    await pagina.waitForURL((u) => u.pathname === `/ordenes/${ot.id}`, { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    const dice = limpio(await hasta(() => pagina.locator('main').innerText(), (t) => /No se pudo subir el archivo/.test(t ?? ''), 15000))
    const quedan = await hasta(() => sueltosDeLaOt(desde), (l) => l.length === 0, 10000)
    comprobar(/No se pudo subir el archivo/.test(dice) && quedan.length === 0,
      `[Administración 1280] 1u-ida-otra-pantalla. de vuelta en la orden, dice que el PDF no subió, y nada suelto (${quedan.length} sueltos)`)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1u-ida-otra-pantalla. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1u-pdf-aviso. Lo hecho con el PDF de la orden se va al salir (Administración)
// «PDF corregido guardado.» y «Se quitó…; vuelve a valer…» quedaban guardados:
// volvían horas después diciendo qué PDF vale, aunque otro ya hubiera subido
// uno (Y2 de la trigesimosexta). Ahora se dicen mientras se está en la orden.
if (corre('1u-pdf-aviso')) {
  // Una con un PDF o ninguno, y si lo tiene, subido por Administración: el de otra cuenta no lo ve, y no lo cambia.
  const [ot] = await consulta(`select o.id, o.numero, (select count(*) from ot_adjuntos a where a.orden_id = o.id and a.tipo = 'ORDEN')::int n
                               from ordenes_trabajo o where o.cotizacion_pdf_id is null and o.estado not in ('ANULADA', 'ENTREGADA', 'FACTURADA')
                                 and not exists (select 1 from ot_adjuntos a where a.orden_id = o.id and a.subido_por is distinct from (select id from usuarios where correo = $1))
                               order by case (select count(*) from ot_adjuntos a where a.orden_id = o.id and a.tipo = 'ORDEN') when 1 then 0 when 0 then 1 else 2 end, o.numero desc limit 1`, [CUENTAS.administracion])
  const pdfs = async () => Number((await consulta(`select count(*) n from ot_adjuntos where orden_id = $1 and tipo = 'ORDEN'`, [ot.id]))[0].n)
  const { pagina, contexto, errores } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  if (!ot || ot.n > 1) {
    comprobar(false, `[Administración 1280] 1u-pdf-aviso. hay una orden sin cotización con un PDF o ninguno (${ot?.numero ?? 'ninguna'}, ${ot?.n} PDF)`)
  } else {
    await ir(pagina, `${BASE}/ordenes/${ot.id}`)
    const campo = pagina.locator(`input[type="file"]#subir-pdf-${ot.id}, #subir-pdf-${ot.id} input[type="file"]`).first()
    const avisos = () => pagina.locator('main [role="status"]').allInnerTexts().then((l) => limpio(l.join(' | '))).catch(() => '')
    if (ot.n === 0) {
      await campo.setInputFiles({ name: `orden-primera-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`Orden ${ot.numero}`, `Primera ${sello}`]) })
      await hasta(pdfs, (n) => n === 1, 30000)
      await quieta(pagina)
    }
    const fuera = async () => {
      await porElMenu(pagina, '/ordenes')
      await pagina.evaluate(() => window.history.back())
      await pagina.waitForURL((u) => u.pathname === `/ordenes/${ot.id}`, { timeout: 20000 }).catch(() => {})
      await quieta(pagina)
      await pagina.getByRole('button', { name: 'Cambiar el PDF' }).waitFor({ timeout: 15000 }).catch(() => {})
    }
    await marcarDocumento(pagina)
    await pagina.getByRole('button', { name: 'Cambiar el PDF' }).click()
    await campo.setInputFiles({ name: `orden-corregida-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`Orden ${ot.numero}`, `Corregida ${sello}`]) })
    const dicho = await hasta(avisos, (t) => t.includes('PDF corregido guardado.'), 30000)
    await fuera()
    const alVolver = await avisos()
    comprobar(dicho.includes('PDF corregido guardado.') && (await pdfs()) === 2 && !alVolver.includes('PDF corregido guardado.') && (await mismoDocumento(pagina)),
      `[Administración 1280] 1u-pdf-aviso. «PDF corregido guardado.» se dice, y al salir de la orden y volver ya no («${alVolver}»)`)
    // Se quita el anterior, el que no es el vigente.
    const tachos = pagina.getByRole('button', { name: /^Quitar .*, del / })
    const nombres = await tachos.evaluateAll((l) => l.map((b) => b.getAttribute('aria-label')))
    const anterior = nombres.findIndex((n) => !n.endsWith(', el vigente'))
    if (anterior >= 0) {
      await tachos.nth(anterior).click()
      await pagina.getByRole('button', { name: 'Sí, quitar' }).click()
    }
    const quitado = await hasta(avisos, (t) => t.includes('Se quitó'), 20000)
    await fuera()
    const alVolverDeQuitar = await avisos()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1u-pdf-aviso.png') })
    comprobar(anterior >= 0 && quitado.includes('Se quitó') && (await pdfs()) === 1 && !alVolverDeQuitar.includes('Se quitó') && (await mismoDocumento(pagina)),
      `[Administración 1280] 1u-pdf-aviso. «Se quitó…» se dice, y al salir y volver ya no (${await pdfs()} PDF, «${alVolverDeQuitar}»)`)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1u-pdf-aviso. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1v-ver-su-tarjeta-en-camino. «Ver su tarjeta» con otra OT en camino (Administración)
// La navegación de Next espera a lo que va en transición: «Ver su tarjeta»
// quitaba la línea y no llevaba a ningún lado mientras la otra OT subía su PDF,
// y si esa entraba y se iba a su tarjeta, las dos idas salían juntas a
// «#A#B» (Z2 de la crítica de la trigesimoséptima). Ahora está apagado y dice
// por qué mientras algo va en camino. A entra con B todavía subiendo: no va
// sola, porque no es lo único en camino.
if (corre('1v-ver-su-tarjeta-en-camino')) {
  const dos = await aprobadasSinOt(2)
  const libres = await numerosLibres(2)
  const [{ t: desde }] = await consulta(`select now() as t`)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  if (dos.length < 2 || libres.length < 2) {
    comprobar(false, `[Administración 1280] 1v-ver-su-tarjeta-en-camino. hay dos cotizaciones aprobadas sin OT (${dos.length}) y dos números libres`)
  } else {
    const [a, b] = dos
    const encabezado = pagina.locator('[data-estado-del-encabezado]')
    const LINEA_A = `Se cargó el código y la OT de la cotización ${a.numero}.`
    await ir(pagina, `${BASE}/cotizaciones/pdf?estado=APROBADA_SIN_OT`)
    await marcarDocumento(pagina)
    // A se detiene antes de anotar; su ventana se cierra en vuelo.
    const marcaA = `QA_Z2A_${sello}`
    const ventanaA = await llenarLaOt(pagina, a.id, `${marcaA}/26`, libres[0])
    corte.marca = marcaA
    await ventanaA.guardar.click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await ventanaA.d.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    // B se detiene subiendo su PDF, como con poca señal; su ventana también se cierra.
    const ventanaB = await llenarLaOt(pagina, b.id, `QA_Z2B_${sello}/26`, libres[1])
    corte.cortarSubida = 'adjuntos-ot/ot/'
    await ventanaB.guardar.click()
    await hasta(() => corte.retenidas, (n) => n > 1, 30000)
    await ventanaB.d.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    // A entra con B en camino: lo dice el encabezado, y su botón está apagado.
    corte.soltarLa(marcaA)
    await hasta(() => otDe(a.id), (n) => n === 1, 30000)
    const linea = limpio(await hasta(() => encabezado.innerText(), (t) => limpio(t).includes(LINEA_A), 15000))
    const ver = encabezado.getByRole('button', { name: 'Ver su tarjeta' })
    await pagina.waitForTimeout(1500)
    const apagado = await ver.isDisabled().catch(() => false)
    const porque = await loQueDescribe(ver).catch(() => null)
    const dondeEnCamino = pagina.url().replace(BASE, '')
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1v-ver-su-tarjeta-en-camino.png') })
    comprobar(linea.includes(LINEA_A) && apagado && porque === 'Se puede ver cuando vuelva lo que se está enviando.' && dondeEnCamino === '/cotizaciones/pdf?estado=APROBADA_SIN_OT',
      `[Administración 1280] 1v-ver-su-tarjeta-en-camino. A entra con B subiendo: el encabezado lo dice, y «Ver su tarjeta» está apagado y dice por qué (apagado ${apagado}, «${porque}», ${dondeEnCamino})`)
    // B vuelve sin su PDF: el botón se enciende y lleva a la tarjeta de A, con un solo «#».
    corte.soltarLa('adjuntos-ot/ot/')
    const encendido = await hasta(() => ver.isEnabled().catch(() => false), Boolean, 20000)
    await ver.click().catch(() => {})
    const marcada = await hasta(() => resaltada(pagina), (id) => id === a.id, 15000)
    const donde = pagina.url().replace(BASE, '')
    const lineaDespues = limpio(await encabezado.innerText().catch(() => ''))
    comprobar(encendido && marcada === a.id && donde === `/cotizaciones/pdf#${a.id}` && !lineaDespues.includes(LINEA_A) && (await mismoDocumento(pagina)),
      `[Administración 1280] 1v-ver-su-tarjeta-en-camino. cuando B vuelve, «Ver su tarjeta» se enciende y lleva a la de A, resaltada, con un solo «#» (resaltada ${marcada === a.id ? 'A' : marcada}, ${donde}, «${lineaDespues}»)`)
    const quedan = await hasta(() => sueltosDeLaOt(desde), (l) => l.length === 0, 10000)
    comprobar((await otDe(a.id)) === 1 && (await otDe(b.id)) === 0 && quedan.length === 0,
      `[Administración 1280] 1v-ver-su-tarjeta-en-camino. A con su OT, B sin ella, y nada suelto (${quedan.length} sueltos)`)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1v-ver-su-tarjeta-en-camino. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1v-ver-su-tarjeta-nueva. «Ver su tarjeta» no anota una ida, en «nueva» (Administración)
// «Ver su tarjeta» anotaba la ida como la de un envío que entró: en la pestaña
// de otro despliegue, «Volver a cargar» giraba 15 s y decía «Lo que enviaste
// ya entró…» sin que se hubiera enviado nada (Z1 de la crítica de la
// trigesimoséptima). La OT se cierra en vuelo y la persona toca otra cosa: no
// va sola a su tarjeta, y el encabezado lo dice.
if (corre('1v-ver-su-tarjeta-nueva')) {
  const [cot] = await aprobadasSinOt(1)
  const [libre] = await numerosLibres(1)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 }, { compilacion: true })
  if (!cot || !libre) {
    comprobar(false, `[Administración 1280] 1v-ver-su-tarjeta-nueva. hay una cotización aprobada sin OT y un número libre`)
  } else {
    const encabezado = pagina.locator('[data-estado-del-encabezado]')
    const LINEA = `Se cargó el código y la OT de la cotización ${cot.numero}.`
    await ir(pagina, `${BASE}/cotizaciones/pdf`)
    await marcarDocumento(pagina)
    const marca = `QA_Z1_${sello}`
    const ventana = await llenarLaOt(pagina, cot.id, `${marca}/26`, libre)
    corte.marca = marca
    await ventana.guardar.click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await ventana.d.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    // Lo que la persona toca después de cerrar: la búsqueda, como en la crítica.
    await pagina.getByRole('searchbox', { name: 'Buscar cotizaciones' }).click()
    corte.soltar()
    await hasta(() => otDe(cot.id), (n) => n === 1, 30000)
    const linea = limpio(await hasta(() => encabezado.innerText(), (t) => limpio(t).includes(LINEA), 15000))
    const sinIr = pagina.url().replace(BASE, '')
    comprobar(linea.includes(LINEA) && sinIr === '/cotizaciones/pdf',
      `[Administración 1280] 1v-ver-su-tarjeta-nueva. cerrada en vuelo y tocada otra cosa, la OT no va sola a su tarjeta: lo dice el encabezado (${sinIr}, «${linea}»)`)
    // El despliegue de todos los días: la pestaña queda «nueva», y la línea sigue.
    await hastaLaPestanaNueva(pagina, corte)
    const ver = encabezado.getByRole('button', { name: 'Ver su tarjeta' })
    if (!(await ver.count())) {
      comprobar(false, `[Administración 1280] 1v-ver-su-tarjeta-nueva. en «nueva», el encabezado ofrece «Ver su tarjeta» (no está: la OT se fue sola a ${limpio(pagina.url().replace(BASE, ''))})`)
    } else {
      await ver.click()
      const marcada = await hasta(() => resaltada(pagina), (id) => id === cot.id, 15000)
      const quieto = await mismoDocumento(pagina)
      const dichos = []
      const mirar = setInterval(() => sinRecargar(pagina).then((t) => t && dichos.push(t)), 250)
      const [cargo] = await Promise.all([
        pagina.waitForEvent('load', { timeout: 10000 }).then(() => true).catch(() => false),
        botonDeArriba(pagina, 'Volver a cargar').click(),
      ])
      clearInterval(mirar)
      await quieta(pagina)
      await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1v-ver-su-tarjeta-nueva.png') })
      comprobar(marcada === cot.id && quieto,
        `[Administración 1280] 1v-ver-su-tarjeta-nueva. en «nueva», «Ver su tarjeta» lleva a la tarjeta, resaltada, sin recargar (resaltada ${marcada === cot.id ? 'la tarjeta' : marcada}, mismo documento ${quieto})`)
      comprobar(cargo && !(await mismoDocumento(pagina)) && !dichos.includes(SE_VA),
        `[Administración 1280] 1v-ver-su-tarjeta-nueva. después, «Volver a cargar» recarga: «Ver su tarjeta» no envió nada (recargó ${cargo}${dichos.length ? `, dijo «${dichos.at(-1)}»` : ''})`)
    }
  }
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Administración 1280] 1v-ver-su-tarjeta-nueva. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1v-ida-no-pisa-el-menu. La OT cerrada en vuelo no se lleva lo que la persona pidió después (Administración)
// Con la OT en camino, el menú o la búsqueda que se tocaban quedaban en cola
// detrás de su transición, y la ida a la tarjeta los reemplazaba: Órdenes no se
// abría nunca (funcionalidad H2 de la trigesimoséptima). Ahora, si la ventana
// se cerró y la persona tocó algo después, la OT no va sola.
if (corre('1v-ida-no-pisa-el-menu')) {
  const [cot] = await aprobadasSinOt(1)
  const [libre] = await numerosLibres(1)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  if (!cot || !libre) {
    comprobar(false, `[Administración 1280] 1v-ida-no-pisa-el-menu. hay una cotización aprobada sin OT y un número libre`)
  } else {
    await ir(pagina, `${BASE}/cotizaciones/pdf?estado=APROBADA_SIN_OT`)
    await marcarDocumento(pagina)
    const marca = `QA_H2_${sello}`
    const ventana = await llenarLaOt(pagina, cot.id, `${marca}/26`, libre)
    corte.marca = marca
    await ventana.guardar.click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await ventana.d.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    // El menú, con la OT todavía en camino: Next lo deja en cola.
    const enlaces = pagina.locator('a[href="/ordenes"]')
    const visible = await enlaces.evaluateAll((l) => l.findIndex((a) => a.checkVisibility()))
    await enlaces.nth(Math.max(visible, 0)).click()
    await pagina.waitForTimeout(1000)
    corte.soltar()
    await hasta(() => otDe(cot.id), (n) => n === 1, 30000)
    await pagina.waitForURL((u) => u.pathname === '/ordenes', { timeout: 20000 }).catch(() => {})
    await pagina.waitForTimeout(3000)
    const donde = pagina.url().replace(BASE, '')
    const titulo = limpio(await pagina.locator('main h1').first().innerText().catch(() => ''))
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1v-ida-no-pisa-el-menu.png') })
    comprobar(donde === '/ordenes' && titulo === 'Órdenes de trabajo' && (await mismoDocumento(pagina)) && (await otDe(cot.id)) === 1,
      `[Administración 1280] 1v-ida-no-pisa-el-menu. la OT entra después de tocar el menú: abre Órdenes y no la tarjeta (${donde}, «${titulo}», OT ${await otDe(cot.id)})`)
    // Lo que la línea del encabezado decía se fue con la pantalla: de vuelta
    // en Cotización por el menú, no dice que se cargó (sin `guardar`).
    await porElMenu(pagina, '/cotizaciones/pdf')
    const encabezado = limpio(await pagina.locator('[data-estado-del-encabezado]').innerText().catch(() => ''))
    comprobar(!encabezado.includes('Se cargó el código y la OT') && !encabezado.includes(cot.numero),
      `[Administración 1280] 1v-ida-no-pisa-el-menu. de vuelta en Cotización por el menú, el encabezado ya no dice que se cargó («${encabezado}»)`)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1v-ida-no-pisa-el-menu. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1v-cronograma-se-va. Lo que entró del cronograma se va al salir de la orden (Diseño)
// «Cronograma cargado… El Excel quedó guardado en la orden» se guardaba: seguía
// después de quitar ese Excel en Resumen (funcionalidad H4 y realización H2
// de la trigesimoséptima). Ahora se va al salir; el Excel que no quedó, que es
// lo que falta hacer, sigue dicho.
if (corre('1v-cronograma-se-va')) {
  const orden = await ordenParaElCronograma()
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, { width: 1280, height: 900 })
  const renglon = () => pagina.locator('main [role="status"]').allInnerTexts().then((l) => limpio(l.join(' | '))).catch(() => '')
  const fuera = async () => {
    await porElMenu(pagina, '/ordenes')
    await pagina.evaluate(() => window.history.back())
    await pagina.waitForURL((u) => u.pathname === `/ordenes/${orden.id}`, { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    await pagina.getByRole('button', { name: 'Subir cronograma' }).waitFor({ timeout: 15000 }).catch(() => {})
  }
  const subir = async (actividad) => {
    const libro = new ExcelJS.Workbook()
    const hoja = libro.addWorksheet('Cronograma')
    hoja.addRow(['Área', 'Actividad', 'Referencia', 'Peso (%)', 'Inicio', 'Fin'])
    hoja.addRow(['Acabados', actividad, null, 0, null, null])
    const excel = join(archivos, `${actividad}.xlsx`)
    await libro.xlsx.writeFile(excel)
    await pagina.getByRole('button', { name: 'Subir cronograma' }).click()
    const v = pagina.getByRole('dialog')
    await v.waitFor({ timeout: 20000 })
    await v.locator(`#cronograma-${orden.id}`).setInputFiles(excel)
    const cargar = v.getByRole('button', { name: 'Cargar 1 actividad' })
    await cargar.waitFor({ timeout: 15000 })
    await cargar.click()
    await hasta(() => v.count(), (n) => n === 0, 30000)
  }
  await ir(pagina, `${BASE}/ordenes/${orden.id}?vista=actividades`)
  await marcarDocumento(pagina)
  // El Excel se corta subiendo: el cronograma entró y el Excel no.
  corte.cortarSubida = `adjuntos-ot/ot/${orden.id}/`
  const subida = subir(`Se va el cronograma A ${sello}`)
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  corte.soltar()
  await subida
  const sinExcel = await hasta(renglon, (t) => t.includes('El Excel no quedó guardado en la orden.'), 20000)
  await fuera()
  const sinExcelAlVolver = await renglon()
  comprobar(sinExcel.includes('Cronograma cargado') && sinExcelAlVolver.includes('El Excel no quedó guardado en la orden.') && !sinExcelAlVolver.includes('Cronograma cargado') && (await mismoDocumento(pagina)),
    `[Diseño 1280] 1v-cronograma-se-va. el Excel que no quedó sigue dicho al salir de la orden y volver, y lo que entró ya no («${sinExcelAlVolver}»)`)
  // Ahora entra con su Excel: al salir y volver, nada lo repite.
  await subir(`Se va el cronograma B ${sello}`)
  const conExcel = await hasta(renglon, (t) => t.includes('El Excel quedó guardado en la orden'), 20000)
  await fuera()
  const conExcelAlVolver = await renglon()
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1v-cronograma-se-va.png') })
  comprobar(conExcel.includes('Cronograma cargado') && !conExcelAlVolver.includes('Cronograma cargado') && !conExcelAlVolver.includes('El Excel quedó guardado') && (await mismoDocumento(pagina)),
    `[Diseño 1280] 1v-cronograma-se-va. «Cronograma cargado… El Excel quedó guardado en la orden» se dice, y al salir de la orden y volver ya no («${conExcelAlVolver}»)`)
  comprobar(errores.length === 0, `[Diseño 1280] 1v-cronograma-se-va. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1v-subida-se-va. «Cotización subida…» se va al salir de Cotización (Ventas)
// Se guardaba y decía «Gerencia ya la tiene para revisar» junto a la cotización
// que Gerencia ya había rechazado (funcionalidad H5 de la trigesimoséptima).
// Ahora dice lo que pasó, y se va al salir.
if (corre('1v-subida-se-va')) {
  const numero = `QA-SE-VA-COT-${sello}`
  const { pagina, contexto, errores } = await entrar(CUENTAS.ventas, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/cotizaciones/pdf`)
  await marcarDocumento(pagina)
  const encabezado = () => pagina.locator('[data-estado-del-encabezado]').innerText().then(limpio).catch(() => '')
  await pagina.getByRole('button', { name: 'Subir cotización' }).first().click()
  const d = pagina.getByRole('dialog').first()
  await d.waitFor({ timeout: 20000 })
  await d.locator('#cot-archivo').setInputFiles({ name: `${numero}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`COTIZACION ${numero}`, 'Semirremolque de banco']) })
  const subir = d.getByRole('button', { name: 'Subir y mandar a Gerencia' })
  await pagina.waitForTimeout(1500)
  await hasta(async () => !/Leyendo/.test(await d.innerText()) && (await subir.isEnabled()), Boolean, 30000)
  await d.locator('#cot-numero').fill(numero)
  await d.locator('#cot-monto').fill('1000')
  await d.locator('#cot-moneda').selectOption('USD')
  await d.locator('#cot-igv').selectOption('no')
  if (await d.locator('#cot-cliente').count()) await d.locator('#cot-cliente').selectOption({ index: 1 })
  if (await d.locator('#cot-carroceria').count()) await d.locator('#cot-carroceria').selectOption({ index: 1 })
  await subir.click()
  const dicho = await hasta(encabezado, (t) => t.includes('Cotización subida'), 30000)
  await porElMenu(pagina, '/clientes')
  await pagina.evaluate(() => window.history.back())
  await pagina.waitForURL((u) => u.pathname === '/cotizaciones/pdf', { timeout: 20000 }).catch(() => {})
  await quieta(pagina)
  const alVolver = await encabezado()
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1v-subida-se-va.png') })
  comprobar(dicho.includes('Cotización subida y enviada a Gerencia para que la revise.') && !dicho.includes('ya la tiene'),
    `[Ventas 1280] 1v-subida-se-va. dice lo que pasó, no cómo está la cotización («${dicho}»)`)
  comprobar(!alVolver.includes('Cotización subida') && (await mismoDocumento(pagina)),
    `[Ventas 1280] 1v-subida-se-va. al salir de Cotización y volver, ya no lo dice («${alVolver}»)`)
  comprobar(errores.length === 0, `[Ventas 1280] 1v-subida-se-va. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1j. La ventana que pregunta por su envío anterior (Requerimientos)
if (corre('1j')) {
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.requerimientos)
  await ir(pagina, `${BASE}/requerimientos`)
  const boton = pagina.getByRole('button', { name: /^Nuevo requerimiento/ }).first()
  const v = pagina.getByRole('dialog')
  await vigilarLaRegionDeArriba(pagina)
  // Al abrir, la ventana pregunta si su envío anterior entró (`consultarEnvio`):
  // desde la pestaña vieja vuelve 404, y antes se callaba (H3 de funcionamiento).
  corte.despliegue = true
  await boton.click()
  await v.waitFor()
  const enVentana = limpio(await hasta(() => v.locator('[data-ventana-vieja]').innerText().catch(() => ''), Boolean, 15000))
  const enRegion = await v.locator('[role="status"] [data-ventana-vieja]').count()
  const arriba = await avisoDeArriba(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1j-ventana.png') })
  comprobar(enVentana === TEXTO_VENTANA && enRegion === 1 && arriba.startsWith(TEXTO_VIEJA) && (await pagina.locator('[data-region-pestana-vieja]').count()) === 0,
    `[Requerimientos 1280] 1j. al abrir «Nuevo requerimiento», la pregunta por el envío anterior descubre la pestaña vieja: la ventana lo dice en una región que lo anuncia, y arriba está sin región, para que no se oiga dos veces («${enVentana}»)`)
  corte.despliegue = false
  await pagina.keyboard.press('Escape')
  await hasta(() => v.count(), (n) => n === 0, 5000)
  // Abierta otra vez, ya sabida vieja: nace con el aviso, y lo nombra su aria-describedby.
  await boton.click()
  await v.waitFor()
  const alAbrir = await v.locator('[data-ventana-vieja]').count()
  const sinRegion = (await v.locator('[role="status"] [data-ventana-vieja]').count()) === 0
  const describe = await v.evaluate((d) => (d.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? '').join(' | '))
  comprobar(alAbrir === 1 && sinRegion && describe.includes(TEXTO_VENTANA),
    `[Requerimientos 1280] 1j. abierta otra vez, la ventana nace con el aviso, sin región, y su aria-describedby lo nombra («${describe}»)`)
  await pagina.keyboard.press('Escape')
  comprobar(errores.length === 0, `[Requerimientos 1280] 1j. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// 1j. El otro camino: con la ventana abierta y a medio llenar, se sale y se
// vuelve tras 31 s, y la pregunta por los avisos descubre la pestaña vieja.
// Solo la ventana lo anuncia (trigesimoprimera pasada: las dos regiones
// recibían su texto en el mismo instante).
if (corre('1j')) {
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.requerimientos)
  await ir(pagina, `${BASE}/requerimientos`)
  const v = pagina.getByRole('dialog')
  await pagina.getByRole('button', { name: /^Nuevo requerimiento/ }).first().click()
  await v.waitFor()
  await quieta(pagina)
  corte.despliegue = true
  await salirYVolver(pagina)
  const enVentana = limpio(await hasta(() => v.locator('[data-ventana-vieja]').innerText().catch(() => ''), Boolean, 15000))
  const enRegion = await v.locator('[role="status"] [data-ventana-vieja]').count()
  const arriba = await avisoDeArriba(pagina)
  comprobar(enVentana === TEXTO_VENTANA && enRegion === 1 && arriba.startsWith(TEXTO_VIEJA) && (await pagina.locator('[data-region-pestana-vieja]').count()) === 0,
    `[Requerimientos 1280] 1j. al volver tras 31 s con la ventana abierta, la ventana lo anuncia y arriba está sin región («${enVentana}»)`)
  corte.despliegue = false
  await pagina.keyboard.press('Escape')
  comprobar(errores.length === 0, `[Requerimientos 1280] 1j. al volver, sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1k. El PDF de la orden, dos veces (Administración)
if (corre('1k')) {
  const [ot] = await consulta(
    `select o.id, o.numero from ordenes_trabajo o
     where not exists (select 1 from ot_adjuntos a where a.orden_id = o.id and a.tipo = 'ORDEN') order by o.numero limit 1`,
  )
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.administracion])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'adjuntos-ot' and o.owner_id = $1 and o.created_at >= $2
        and not exists (select 1 from ot_adjuntos a where a.ruta_storage = o.name)`, [yo, desde])).length
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion)
  await ir(pagina, `${BASE}/ordenes/${ot?.id}`)
  const campo = pagina.locator(`input[type="file"]#subir-pdf-${ot?.id}, #subir-pdf-${ot?.id} input[type="file"]`).first()
  if (!ot || (await campo.count()) === 0) {
    comprobar(false, `[Administración 1280] 1k. hay una orden sin PDF que ofrezca «Subir el PDF de la orden» (${ot?.numero ?? 'ninguna'})`)
  } else {
    corte.despliegue = true
    const dicen = []
    const subieron = []
    for (const vez of [1, 2]) {
      const s0 = corte.storage.length
      await campo.setInputFiles({ name: `orden-vieja-${vez}-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`Orden ${ot.numero}`, `Pestaña vieja ${vez} ${sello}`]) })
      dicen.push(limpio(await hasta(() => pagina.locator('main').innerText().then((t) => t.match(/[^.]*se actualizó[^.]*\.[^.]*\./)?.[0] ?? ''), Boolean, 30000)))
      await pagina.waitForTimeout(1500)
      subieron.push(corte.storage.slice(s0).filter((x) => x.startsWith('POST')).length)
    }
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1k-pdf.png') })
    corte.despliegue = false
    const [{ n }] = await consulta(`select count(*)::int n from ot_adjuntos where orden_id = $1 and tipo = 'ORDEN'`, [ot.id])
    comprobar(dicen.every((d) => d.includes(SE_ACTUALIZO)) && subieron[0] === 1 && (await hasta(sueltos, (s) => s === 0, 10000)) === 0 && n === 0,
      `[Administración 1280] 1k. la primera vez, todavía sin saberse vieja, sube el PDF, la acción vuelve 404 y se quita; la orden sigue sin PDF («${dicen[0]}»)`)
    comprobar(subieron[1] === 0,
      `[Administración 1280] 1k. la segunda, ya sabida vieja, ni lo sube (${subieron[1]} subidas a Storage; «${dicen[1]}»)`)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1k. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 2. La anulación de un vehículo, cerrada en vuelo (Requerimientos)
if (corre('2')) {
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.requerimientos)
  await ir(pagina, `${BASE}/vehiculos`)
  const ventana = pagina.locator('[role="dialog"]', { has: pagina.locator('#veh-motivo') })
  await pagina.getByRole('button', { name: 'Registrar ingreso' }).click()
  await ventana.waitFor({ timeout: 10000 })
  await ventana.locator('#veh-motivo').selectOption('COCHERA')
  await ventana.locator('#veh-placa').fill(`V${sello.slice(-1)}A-${sello.slice(0, 3)}`)
  await ventana.locator('#veh-unidad').fill('Camioneta del cliente')
  const empresa = `EMPRESA VIEJA ${sello}`
  await ventana.locator('#veh-empresa').fill(empresa)
  await ventana.locator('input[type="file"]:not([capture])').setInputFiles(fotos.c)
  await esperarSubidas(pagina)
  await ventana.getByRole('button', { name: 'Registrar ingreso' }).click()
  const [reg] = await hasta(() => consulta(`select id from registro_vehiculos where empresa = $1`, [empresa]), (r) => r.length === 1)
  await ir(pagina, `${BASE}/vehiculos/${reg?.id}`)
  const anular = pagina.getByRole('button', { name: /^Anular el ingreso de/ })
  const fila = pagina.locator('div', { has: anular }).last()
  const anulado = async () => (await consulta(`select anulado_en is not null as a from registro_vehiculos where id = $1`, [reg?.id]))[0]?.a
  const v = pagina.locator('[role="dialog"]', { has: pagina.locator('textarea[name="motivo"]') })

  await anular.click()
  await v.waitFor({ timeout: 10000 })
  const marca = `Anulada ${sello}`
  await v.locator('textarea[name="motivo"]').fill(`${marca}: se anotó la placa de otro vehículo`)
  corte.marca = marca
  await v.getByRole('button', { name: 'Anular', exact: true }).click()
  const retenido = (await hasta(() => corte.retenidas, (n) => n >= 1)) >= 1
  await pagina.keyboard.press('Escape')
  const cerro = (await hasta(() => v.count(), (n) => n === 0, 5000)) === 0
  const botones = await fila.getByRole('button').all()
  const ocupados = await Promise.all(botones.map(async (b) => `${limpio(await b.innerText())}:${(await b.getAttribute('aria-disabled')) ?? (await b.isDisabled() ? 'apagado' : 'libre')}`))
  const sigue = limpio(await hasta(() => pagina.getByRole('status').filter({ hasText: 'se sigue enviando' }).allInnerTexts().then((t) => t.join(' ')), Boolean, 5000))
  const describe = await loQueDescribe(anular)
  // Con aria-disabled, Playwright no lo da por tocable: se toca igual, como un dedo.
  await anular.click({ force: true })
  await pagina.waitForTimeout(800)
  const abrioOtra = await pagina.getByRole('dialog').count()
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-2-fila.png') })
  comprobar(retenido && cerro && ocupados.every((o) => /:(true|apagado)$/.test(o)) && sigue === 'La anulación se sigue enviando: lo que conteste se dice aquí.' && abrioOtra === 0,
    `[Requerimientos 1280] 2. la anulación cerrada en vuelo: la fila entera gira, dice que sigue enviándose y no abre otra ventana (${ocupados.join(', ')}; «${sigue}»; ventanas ${abrioOtra})`)
  comprobar(describe === 'La anulación se sigue enviando: lo que conteste se dice aquí.',
    `[Requerimientos 1280] 2. «Anular» nombra con aria-describedby lo que sigue («${describe}»)`)
  corte.despliegue = true
  corte.soltar()
  const desenlace = limpio(await hasta(() => pagina.getByRole('alert').filter({ hasText: 'que se estaba enviando' }).allInnerTexts().then((t) => t.join(' ')), Boolean))
  const libre = await hasta(() => anular.getAttribute('aria-disabled'), (x) => x === null, 5000)
  comprobar(desenlace === 'La anulación que se estaba enviando no se registró: el sistema se actualizó mientras tenías la pantalla abierta. Vuelve a cargar la pantalla y envíalo otra vez.' && libre === null && !(await anulado()),
    `[Requerimientos 1280] 2. desde la pestaña vieja, en la fila: «${desenlace}»; el botón se libera y el ingreso sigue sin anular`)
  corte.despliegue = false
  // Ya sin la pestaña vieja, la anulación entra y la fila deja de ofrecerla.
  await anular.click()
  await v.waitFor({ timeout: 10000 })
  await v.locator('textarea[name="motivo"]').fill(`${marca} otra vez: se anotó la placa de otro vehículo`)
  await v.getByRole('button', { name: 'Anular', exact: true }).click()
  const entro = await hasta(anulado, Boolean, 15000)
  const cerrada = (await hasta(() => v.count(), (n) => n === 0, 10000)) === 0
  comprobar(Boolean(entro) && cerrada, `[Requerimientos 1280] 2. después, la anulación entra y la ventana se cierra (anulado ${entro})`)
  comprobar(errores.length === 0, `[Requerimientos 1280] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 3. «Reportar día» al girar el teléfono (OPERARIO del banco)
if (corre('3')) {
  // «Reportar día» es de las órdenes de antes del plan de etapas propio: en las
  // demás se reporta por tarea, con produccion.reportar_tarea, que el OPERARIO
  // no tiene, y la actividad sin etapa no entra. Toda orden nueva nace con plan
  // propio y la base no deja cambiarlo: en el banco, y solo aquí, la 0001-2026
  // vuelve a ser «de antes» con los disparadores apagados, como hace
  // probar-documentos-al-elegir. Antes la parte solo pasaba si esa suite había
  // corrido (vigesimonovena pasada).
  const [orden] = await consulta(`select id, plan_etapas_manual from ordenes_trabajo where numero = '0001-2026'`)
  const sinDisparadores = async (sql, valores) => {
    await consulta('begin')
    await consulta('set local session_replication_role = replica')
    await consulta(sql, valores)
    await consulta('commit')
  }
  if (orden?.plan_etapas_manual) await sinDisparadores(`update public.ordenes_trabajo set plan_etapas_manual = false where id = $1`, [orden.id])
  // La cuenta y la actividad, como postgres lo que no tiene pantalla en el banco
  // (no hay cuentas OPERARIO) y con la sesión de Diseño la actividad, que pasa
  // por su disparador. Peso 0: no mueve el avance de la orden.
  let [yo] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.operario])
  if (!yo) {
    ;[yo] = await consulta(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [CUENTAS.operario])
    await consulta(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
       select $1, 'Operario', 'Banco del giro', $2, (select id from roles where codigo = 'OPERARIO'), (select id from areas where codigo = 'PRD')`,
      [yo.id, CUENTAS.operario],
    )
  }
  await consulta(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where email = $1`, [CUENTAS.operario, CLAVE])
  // Activa solo mientras corre esta parte: al final se desactiva, y no queda una
  // cuenta OPERARIO con la clave del banco entre una suite y otra. Cambiar el
  // estado de un usuario es de administrador (fn_usuario_proteger_rol): aquí,
  // con los disparadores apagados.
  await sinDisparadores(`update public.usuarios set activo = true where correo = $1`, [CUENTAS.operario])
  try {
    const nombre = `Soldar refuerzos ${sello}`
    await consulta('begin')
    await consulta(`select set_config('request.jwt.claims', json_build_object('sub', (select id from usuarios where correo = $1), 'role', 'authenticated')::text, true)`, [CUENTAS.diseno])
    await consulta('set local role authenticated')
    const [act] = await consulta(
      `insert into ot_actividades (orden_id, area_id, nombre, referencia, peso_pct) values ($1, (select id from areas where codigo = 'PRD'), $2, 'GIRO', 0) returning id`,
      [orden?.id, nombre],
    )
    await consulta('commit')
    const avances = async () => (await consulta(`select nota, avance_pct, materiales_usados from ot_actividad_avances where actividad_id = $1 order by creado_en`, [act.id]))

    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.operario, CELULAR)
    await ir(pagina, `${BASE}/ordenes/${orden?.id}?vista=actividades`)
    const deLaActividad = (sel) => pagina.locator(`#actividad-${act.id}:visible`).locator(sel)
    const boton = () => deLaActividad('button').filter({ hasText: 'Reportar día' })
    const ventana = pagina.locator('[role="dialog"]').filter({ hasText: nombre })
    const aLaVista = async () => limpio((await deLaActividad('[role="status"], [role="alert"]').allInnerTexts()).join(' | '))
    const enDom = await pagina.locator(`[id="actividad-${act.id}"]`).count()

    await boton().click()
    await ventana.waitFor({ timeout: 10000 })
    await ventana.getByRole('button', { name: '25 %' }).click()
    const marca = `Giro ${sello}`
    await ventana.locator('input[name="nota"]').fill(marca)
    corte.marca = marca
    await ventana.getByRole('button', { name: 'Reportar', exact: true }).click()
    const retenido = (await hasta(() => corte.retenidas, (n) => n >= 1)) >= 1
    await ventana.getByRole('button', { name: 'Cancelar' }).click()
    await hasta(() => ventana.count(), (n) => n === 0, 5000)
    const ocupado390 = await boton().getAttribute('aria-disabled')
    const dice390 = await hasta(aLaVista, (t) => t.includes('se sigue enviando'), 5000)

    await pagina.setViewportSize(GIRADO)
    await pagina.waitForTimeout(800)
    const ocupadoGiro = await boton().getAttribute('aria-disabled')
    const diceGiro = await aLaVista()
    const describeGiro = await loQueDescribe(boton())
    await boton().click({ force: true })
    await pagina.waitForTimeout(800)
    const abrio = await ventana.count()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-3-girado.png') })
    comprobar(enDom === 2 && retenido && ocupado390 === 'true' && dice390.includes('El reporte se sigue enviando'),
      `[Operario 390] 3. la actividad está dos veces en la página; cerrada en vuelo, «Reportar día» gira y dice que sigue (${enDom} copias, «${dice390}»)`)
    comprobar(ocupadoGiro === 'true' && diceGiro.includes('El reporte se sigue enviando') && describeGiro === 'El reporte se sigue enviando: lo que conteste se dice aquí.' && abrio === 0,
      `[Operario girado a 844] 3. el «Reportar día» que aparece sabe del envío: gira, lo dice y no abre otra ventana (aria-disabled ${ocupadoGiro}, «${diceGiro}», describe «${describeGiro}», ventanas ${abrio})`)

    corte.despliegue = true
    corte.soltar()
    const desenlaceGiro = await hasta(aLaVista, (t) => t.includes('que se estaba enviando'))
    await pagina.setViewportSize(CELULAR)
    await pagina.waitForTimeout(800)
    const desenlace390 = await aLaVista()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-3-desenlace.png'), fullPage: true })
    corte.despliegue = false
    comprobar(desenlaceGiro.includes('El reporte que se estaba enviando no se registró: el sistema se actualizó') && desenlace390 === desenlaceGiro && (await boton().getAttribute('aria-disabled')) === null && (await avances()).length === 0,
      `[Operario] 3. el desenlace sale en la copia a la vista, girado y de vuelta, y el botón se libera («${desenlaceGiro}»; a 390 «${desenlace390}»)`)

    // Y el reporte entra: el banco ya manda `[]` a la columna jsonb.
    await ir(pagina, `${BASE}/ordenes/${orden?.id}?vista=actividades`)
    await boton().click()
    await ventana.waitFor({ timeout: 10000 })
    await ventana.getByRole('button', { name: '25 %' }).click()
    await ventana.locator('input[name="nota"]').fill(`${marca} entra`)
    const verde = await vigilarElVerde(pagina, 'Avance del día reportado')
    await ventana.getByRole('button', { name: 'Reportar', exact: true }).click()
    const [fila] = await hasta(avances, (r) => r.length === 1, 15000)
    comprobar(fila && Number(fila.avance_pct) === 25 && Array.isArray(fila.materiales_usados) && fila.materiales_usados.length === 0,
      `[Operario 390] 3. el reporte del día entra, con materiales_usados [] (${JSON.stringify(fila?.materiales_usados)})`)
    // Al ponerse al día, la página cambia el «Reportar día» de hoy por «Corregir
    // el de hoy» y «Otro día»: el verde es de la actividad y se queda; antes se
    // iba a los 300 ms (vigesimonovena pasada).
    await hasta(() => deLaActividad('button, span').allInnerTexts().then((t) => /Corregir el de hoy|Reportado hoy/.test(t.join(' '))), Boolean, 15000)
    await pagina.waitForTimeout(1500)
    const verde390 = await aLaVista()
    const verdes = await verde.leer()
    await pagina.setViewportSize(GIRADO)
    await pagina.waitForTimeout(800)
    const verdeGiro = await aLaVista()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-3-verde-girado.png') })
    comprobar(verde390.includes('Avance del día reportado.') && verdes[0] === true,
      `[Operario 390] 3. «Avance del día reportado.» sigue a la vista tras ponerse al día, y salió primero en una región montada desde antes («${verde390}», ${JSON.stringify(verdes)})`)
    comprobar(verdeGiro.includes('Avance del día reportado.'), `[Operario girado a 844] 3. la otra copia también lo dice («${verdeGiro}»)`)
    comprobar(errores.length === 0, `[Operario] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  } finally {
    await sinDisparadores(`update public.usuarios set activo = false where correo = $1`, [CUENTAS.operario])
  }
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
