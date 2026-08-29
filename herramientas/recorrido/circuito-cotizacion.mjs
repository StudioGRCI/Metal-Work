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
    await pagina.waitForLoadState('networkidle')
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
    await precio.fill('45000')
    anotar('precio escrito', '45000')

    await capturar(pagina, '04-llena')
    await pagina.click('button[type="submit"]')
    await pagina.waitForLoadState('networkidle')
    await capturar(pagina, '05-guardada')

    const avisos = await avisosEnPantalla(pagina)
    if (!/\/cotizaciones\/[0-9a-f-]{36}/.test(pagina.url())) {
      throw new Error(
        `no se creó la cotización. Sigue en ${pagina.url()} · ${avisos.join(' · ') || 'sin mensaje'}`,
      )
    }
    anotar('cotización creada', pagina.url().split('/').pop())

    // ------------------------------------------------ pasarla a costeo
    const pasar = pagina.getByRole('button', { name: /cotización de trabajo/i })
    if ((await pasar.count()) === 0) {
      throw new Error(
        `no aparece el botón «Pasar a cotización de trabajo». En pantalla: ${(
          await pagina.getByRole('button').allTextContents()
        ).join(' | ')}`,
      )
    }
    await pasar.first().click()
    await pagina.waitForLoadState('networkidle')
    await capturar(pagina, '06-en-costeo')
    anotar('pasó a costeo', (await avisosEnPantalla(pagina)).join(' · ') || 'sin aviso')

    // ------------------------------------------------ ¿está en la bandeja?
    await pagina.goto(`${URL_BASE}/cotizaciones/trabajo`, { waitUntil: 'networkidle' })
    await capturar(pagina, '07-bandeja')
    const filas = await pagina.locator('tbody tr').count()
    const vacia = await pagina.getByText('No hay nada esperando costeo').count()
    if (vacia > 0 || filas === 0) {
      throw new Error('la cotización no aparece en la bandeja de cotización de trabajo')
    }
    anotar('aparece en la bandeja', `${filas} fila(s)`)
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
