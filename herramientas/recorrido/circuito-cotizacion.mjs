/**
 * Recorre el circuito de la cotización con un navegador de verdad.
 *
 * Nació porque el sistema se dio por bueno tres veces con tipos, lint y
 * compilación en verde, y las tres veces lo que fallaba era la pantalla: un
 * campo obligatorio que no dejaba pasar, un botón que no aparecía, una firma sin
 * sitio. Nada de eso lo ve un compilador.
 *
 * Hace clic de verdad: entra, abre «Nueva cotización», la llena, la guarda, la
 * pasa a cotización de trabajo y comprueba que aparece en la bandeja. Va
 * guardando capturas de cada paso, y si algo se traba dice exactamente dónde y
 * con qué texto en pantalla.
 *
 *   URL=https://metal-work-sandy.vercel.app \
 *   USUARIO=ventas@metalworkperusac.com CLAVE=... \
 *   node herramientas/recorrido/circuito-cotizacion.mjs
 *
 * Sin USUARIO ni CLAVE hace solo la parte pública: comprueba que la aplicación
 * levanta y que la pantalla de ingreso se pinta. Es la comprobación mínima que
 * se puede hacer sin credenciales.
 */
import { chromium } from 'playwright-core'
import { mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const URL_BASE = process.env.URL ?? 'http://localhost:3111'
const USUARIO = process.env.USUARIO ?? ''
const CLAVE = process.env.CLAVE ?? ''
const CAPTURAS = process.env.CAPTURAS ?? 'capturas/circuito'

// Los dos números del circuito, que a propósito son distintos: Ventas cobra
// 45 000 y el taller espera gastar 30 000. Si fueran iguales, el recorrido no
// podría distinguir el precio del costo —que es justo lo que se confundía— y
// pasaría en verde con la orden presupuestada al revés.
const PRECIO_VENTA = 45000
const COSTO_PARTIDA = 30000

// En esta máquina no hay navegadores de Playwright instalados, pero sí Chrome y
// Edge del sistema. Se usa el que esté.
const NAVEGADORES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]

function navegadorDelSistema() {
  for (const ruta of NAVEGADORES) if (existsSync(ruta)) return ruta
  throw new Error('No hay Chrome ni Edge en esta máquina; instala uno o usa playwright install')
}

const pasos = []
function anotar(paso, detalle) {
  pasos.push({ paso, detalle })
  console.log(`  · ${paso}${detalle ? ' — ' + detalle : ''}`)
}

async function capturar(pagina, nombre) {
  mkdirSync(CAPTURAS, { recursive: true })
  await pagina.screenshot({ path: join(CAPTURAS, `${nombre}.png`), fullPage: true })
}

/**
 * Pulsa un paso del circuito y espera a que la etapa cambie en pantalla.
 *
 * Cada paso es una acción de servidor: no cambia la dirección, cambia la
 * insignia. Esperar al reloj da falsos negativos —ya pasó dos veces en este
 * mismo archivo—, así que se espera al texto de la etapa nueva, y si no llega se
 * cuenta qué botones hay, que es lo que hace falta para entender por qué.
 */
async function pulsarPaso(pagina, nombreBoton, etapaEsperada, captura) {
  const boton = pagina.getByRole('button', { name: nombreBoton })
  try {
    await boton.first().waitFor({ state: 'visible', timeout: 30000 })
  } catch {
    throw new Error(
      `no aparece el botón ${nombreBoton}. En pantalla: ${(
        await pagina.getByRole('button').allTextContents()
      )
        .map((t) => t.trim())
        .filter(Boolean)
        .join(' | ')}`,
    )
  }

  await boton.first().click()

  try {
    await pagina.getByText(etapaEsperada).first().waitFor({ timeout: 30000 })
  } catch {
    const avisos = await avisosEnPantalla(pagina)
    await capturar(pagina, captura + '-FALLO')
    throw new Error(
      `se pulsó ${nombreBoton} y la etapa no cambió a ${etapaEsperada}. ` +
        `En pantalla: ${avisos.join(' · ') || 'sin mensaje'}`,
    )
  }

  await capturar(pagina, captura)
}

/** Lo que la pantalla está diciendo ahora mismo, para poder contarlo. */
async function avisosEnPantalla(pagina) {
  return pagina
    .locator('[role="alert"], [role="status"]')
    .allTextContents()
    .then((t) => t.map((x) => x.trim()).filter(Boolean))
}

async function main() {
  const navegador = await chromium.launch({ executablePath: navegadorDelSistema() })
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 1000 } })
  const pagina = await contexto.newPage()

  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text())
  })

  try {
    console.log(`\nRecorrido del circuito · ${URL_BASE}\n`)

    await pagina.goto(`${URL_BASE}/ingresar`, { waitUntil: 'networkidle', timeout: 60000 })
    await capturar(pagina, '01-ingreso')
    anotar('la aplicación levanta', await pagina.title())

    if (!USUARIO || !CLAVE) {
      anotar('sin credenciales', 'solo se comprobó la pantalla de ingreso')
      return
    }

    await pagina.fill('input[type="email"], input[name="correo"]', USUARIO)
    await pagina.fill('input[type="password"]', CLAVE)
    await pagina.click('button[type="submit"]')
    // Una acción de servidor no recarga la página, así que esperar a que la red
    // se calme termina antes de tiempo y el botón todavía está girando. Se
    // espera a que la dirección deje de ser la de ingreso, que es la señal de
    // que el servidor contestó que sí.
    await pagina
      .waitForURL((u) => !u.pathname.includes('/ingresar'), { timeout: 45000 })
      .catch(() => {})
    await capturar(pagina, '02-dentro')

    if (pagina.url().includes('/ingresar')) {
      const avisos = await avisosEnPantalla(pagina)
      throw new Error(`no se pudo entrar: ${avisos.join(' · ') || 'sin mensaje en pantalla'}`)
    }
    anotar('entró', pagina.url())

    // -------------------------------------------------- la cotización de venta
    await pagina.goto(`${URL_BASE}/cotizaciones/nueva`, { waitUntil: 'networkidle' })
    await capturar(pagina, '03-nueva-cotizacion')

    // El cliente es un desplegable con buscador: se abre, se escribe y se elige
    // el primero que salga. Si no hay ninguno, el recorrido lo dice en vez de
    // fallar con un error de Playwright que no explica nada.
    await pagina.click('#cliente_id')
    await pagina.waitForTimeout(300)
    const opciones = pagina.locator('[role="option"]')
    const cuantos = await opciones.count()
    if (cuantos === 0) throw new Error('el desplegable de clientes salió vacío')
    anotar('clientes a elegir', String(cuantos))
    await opciones.first().click()

    const precio = pagina.locator('input[name="precio_venta"]')
    if ((await precio.count()) === 0) throw new Error('no existe el campo de precio ofrecido')
    await precio.fill(String(PRECIO_VENTA))
    anotar('precio escrito', PRECIO_VENTA)

    await capturar(pagina, '04-llena')
    // Por su nombre, no por `button[type=submit]`: el primero de la página es el
    // de cerrar sesión de la barra superior, y el recorrido se salía del sistema
    // creyendo que guardaba. El registro del servidor lo delató con un
    // «POST /auth/salir» justo donde debía haber una cotización nueva.
    const guardar = pagina.getByRole('button', { name: /crear cotización/i })
    if ((await guardar.count()) === 0) {
      throw new Error(
        `no aparece el botón de crear. En pantalla: ${(
          await pagina.getByRole('button').allTextContents()
        ).join(' | ')}`,
      )
    }
    await guardar.first().click()
    // Crear la cotización redirige a su detalle: se espera esa dirección.
    await pagina
      .waitForURL((u) => /\/cotizaciones\/[0-9a-f-]{36}/.test(u.pathname), { timeout: 45000 })
      .catch(() => {})
    await capturar(pagina, '05-guardada')

    const avisos = await avisosEnPantalla(pagina)
    if (!/\/cotizaciones\/[0-9a-f-]{36}/.test(pagina.url())) {
      throw new Error(
        `no se creó la cotización. Sigue en ${pagina.url()} · ${avisos.join(' · ') || 'sin mensaje'}`,
      )
    }
    const idCotizacion = pagina.url().split('/').pop()
    anotar('cotización creada', idCotizacion)

    // ------------------------------------------------ pasarla a costeo
    // El detalle entra por su esqueleto de carga, así que preguntar por los
    // botones en cuanto cambia la dirección devuelve los cuatro del tema y
    // ninguno más. Se espera al botón, no al reloj.
    const pasar = pagina.getByRole('button', { name: /cotización de trabajo/i })
    try {
      await pasar.first().waitFor({ state: 'visible', timeout: 30000 })
    } catch {
      throw new Error(
        `no aparece el botón «Pasar a cotización de trabajo». En pantalla: ${(
          await pagina.getByRole('button').allTextContents()
        )
          .map((t) => t.trim())
          .filter(Boolean)
          .join(' | ')}`,
      )
    }
    await pasar.first().click()
    // Pasar a costeo no cambia de dirección: cambia la insignia de la etapa.
    await pagina
      .getByText('En costeo', { exact: false })
      .first()
      .waitFor({ timeout: 45000 })
      .catch(() => {})
    await capturar(pagina, '06-en-costeo')
    anotar('pasó a costeo', (await avisosEnPantalla(pagina)).join(' · ') || 'sin aviso')

    // ------------------------------------------------ ¿está en la bandeja?
    await pagina.goto(`${URL_BASE}/cotizaciones/trabajo`, { waitUntil: 'networkidle' })

    // La bandeja entra por su esqueleto, y contar filas antes de que termine da
    // cero: es lo que hizo a este mismo recorrido dictaminar que la cotización
    // no aparecía cuando sí estaba. Se espera a que la pantalla conteste una de
    // las dos cosas —una fila o el mensaje de vacío— antes de juzgar.
    await Promise.race([
      pagina.locator('tbody tr').first().waitFor({ state: 'visible', timeout: 30000 }),
      pagina.getByText('No hay nada esperando costeo').waitFor({ timeout: 30000 }),
    ]).catch(() => {})

    await capturar(pagina, '07-bandeja')
    const filas = await pagina.locator('tbody tr').count()
    const vacia = await pagina.getByText('No hay nada esperando costeo').count()
    if (vacia > 0 || filas === 0) {
      throw new Error('la cotización no aparece en la bandeja de cotización de trabajo')
    }
    anotar('aparece en la bandeja', `${filas} fila(s)`)

    // ============================================================ la segunda mano
    // Administración arma la cotización de trabajo: sin una partida no hay
    // precio que revisar ni presupuesto que arrastrar a la orden.
    await pagina.goto(`${URL_BASE}/cotizaciones/${idCotizacion}`, { waitUntil: 'networkidle' })

    const agregar = pagina.getByRole('button', { name: /agregar partida/i })
    await agregar.first().waitFor({ state: 'visible', timeout: 30000 })
    await agregar.first().click()

    await pagina.fill('input[name="descripcion"]', 'Fabricación de tolva de prueba en acero A36')
    await pagina.fill('input[name="cantidad"]', '1')
    await pagina.fill('input[name="precio_unitario"]', String(COSTO_PARTIDA))

    // El botón que guarda la partida se llama «Agregar partida», igual que el
    // que abre el formulario: cuando el formulario está abierto, el de arriba
    // desaparece y queda solo este. Buscar «Agregar» a secas pulsaba el de
    // accesorios, tres tarjetas más abajo, y la partida no se guardaba nunca
    // sin que nada dijera una palabra.
    await pagina.getByRole('button', { name: /agregar partida/i }).last().click()

    // La partida entra por acción de servidor y la tabla se rehace: se espera a
    // que su descripción aparezca en la fila.
    await pagina
      .getByText('Fabricación de tolva de prueba', { exact: false })
      .first()
      .waitFor({ timeout: 30000 })
    await capturar(pagina, '08-partida')
    anotar('partida cargada', COSTO_PARTIDA)

    // -------------------------------------------------- terminar el costeo
    await pulsarPaso(pagina, /terminar el costeo/i, /con gerencia/i, '09-en-revision')
    anotar('costeo terminado', 'pasó a Gerencia')

    // ============================================================ la tercera mano
    await pulsarPaso(pagina, /dar el visto/i, /lista para enviar/i, '10-revisada')
    anotar('Gerencia dio el visto', 'lista para enviar')

    // ------------------------------------------------------------- el papel
    const papel = await pagina.request.get(`${URL_BASE}/cotizaciones/${idCotizacion}/pdf`)
    const tipo = papel.headers()['content-type'] ?? ''
    const peso = (await papel.body()).length
    if (!tipo.includes('pdf')) throw new Error(`el papel no salió en PDF, salió ${tipo}`)
    anotar('el papel sale', `${Math.round(peso / 1024)} KB`)

    // ---------------------------------------------- el cliente la recibe y contesta
    // Descargar marca ENVIADA —ese es el gesto que la manda— y recién entonces
    // se puede registrar lo que el cliente contestó.
    await pulsarPaso(pagina, /descargar y marcar enviada/i, /enviada al cliente/i, '11-enviada')
    anotar('enviada al cliente', 'la descarga la marcó')

    await pulsarPaso(pagina, /marcar aprobada/i, /^aprobada$/i, '12-aprobada')
    anotar('el cliente aprobó', 'lista para abrir la orden')

    // -------------------------------------------------- abrir la orden de trabajo
    // Es el paso que hasta hace unas horas solo funcionaba entrando como
    // administrador: la función que arrastra el presupuesto no corría con
    // permisos propios y la orden nacía sin costo esperado.
    const abrir = pagina.getByRole('button', { name: /abrir orden de trabajo/i })
    try {
      await abrir.first().waitFor({ state: 'visible', timeout: 30000 })
    } catch {
      throw new Error(
        `no aparece «Abrir orden de trabajo». En pantalla: ${(
          await pagina.getByRole('button').allTextContents()
        )
          .map((t) => t.trim())
          .filter(Boolean)
          .join(' | ')}`,
      )
    }
    await abrir.first().click()

    // Abre una ventana para elegir el taller y confirmar.
    await pagina.waitForTimeout(1200)
    const confirmar = pagina.getByRole('button', { name: /^abrir orden/i })
    if ((await confirmar.count()) > 0) await confirmar.last().click()

    await pagina.waitForURL((u) => u.pathname.startsWith('/ordenes/'), { timeout: 45000 }).catch(() => {})

    if (!pagina.url().includes('/ordenes/')) {
      await capturar(pagina, '13-orden')
      const avisos = await avisosEnPantalla(pagina)
      throw new Error(`no se abrió la orden · ${avisos.join(' · ') || 'sin mensaje'}`)
    }

    // El presupuesto tiene que haber bajado con la orden: sin eso nace sin costo
    // esperado y la desviación se termina midiendo contra el precio de venta.
    //
    // Se espera la tarjeta —no un reloj— porque la pantalla llega en dos tiempos
    // y el esqueleto de carga no tiene ni una letra: preguntarle a destiempo
    // contesta «no aparece» sobre algo que sí está. Ya pasó tres veces en este
    // recorrido; ese es el motivo del waitFor.
    const tarjeta = pagina
      .locator('div')
      .filter({ hasText: /^Presupuesto/ })
      .last()
    await tarjeta.waitFor({ state: 'visible', timeout: 45000 })
    await capturar(pagina, '13-orden')
    anotar('orden de trabajo abierta', pagina.url().split('/').pop())

    const cifra = (await tarjeta.innerText()).replace(/\s+/g, ' ').trim()
    const numero = Number((cifra.match(/[\d.,]{3,}/)?.[0] ?? '0').replace(/,/g, ''))

    // Tiene que ser el COSTO que cargó Administración, no el precio que puso
    // Ventas. Es la comprobación que importa de todo el recorrido: cuando la
    // orden nacía con el precio, nada fallaba ni avisaba —la pantalla mostraba
    // un número redondo y creíble— y el taller se pasaba de plata en verde.
    if (numero !== COSTO_PARTIDA) {
      throw new Error(
        numero === PRECIO_VENTA
          ? `la orden nació con el PRECIO (${numero}) en vez del costo (${COSTO_PARTIDA})`
          : `presupuesto inesperado: ${numero}, se esperaba ${COSTO_PARTIDA} · «${cifra}»`,
      )
    }
    anotar('presupuesto en la orden', `${cifra} — es el costo, no el precio`)
  } finally {
    if (errores.length > 0) {
      console.log('\nErrores de consola del navegador:')
      for (const e of errores.slice(0, 10)) console.log('  ! ' + e)
    }
    console.log(`\nCapturas en ${CAPTURAS}\n`)
    await navegador.close()
  }
}

main().catch((e) => {
  console.error('\nSE TRABÓ: ' + e.message + '\n')
  process.exit(1)
})
