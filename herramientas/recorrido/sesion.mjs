import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Entrar una vez y guardar la sesión, para no volver a entrar en cada recorrido.
 *
 * El ingreso es, de lejos, lo más lento y lo más frágil de automatizar: son dos
 * saltos —Supabase autentica y después el navegador navega entero— y cualquiera
 * de los dos puede tardar más que la espera. Repetirlo en cada ejecución hacía
 * que un recorrido de veintiséis pantallas fallara antes de mirar la primera.
 *
 * Las cookies quedan en un archivo del directorio temporal. **No va al
 * repositorio**: es una sesión de verdad, sirve para entrar.
 */

const NAVEGADORES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]

export function navegadorDelSistema() {
  const ruta = NAVEGADORES.find((r) => existsSync(r))
  if (!ruta) throw new Error('No hay Chrome ni Edge en esta máquina')
  return ruta
}

/** Una sesión vieja no sirve: el token de Supabase dura una hora. */
function siguenSirviendo(archivo) {
  if (!existsSync(archivo)) return false
  const edadMinutos = (Date.now() - statSync(archivo).mtimeMs) / 60000
  return edadMinutos < 40
}

export async function sesionGuardada({ urlBase, usuario, clave, archivo, intentos = 3 }) {
  if (siguenSirviendo(archivo)) {
    return JSON.parse(readFileSync(archivo, 'utf8'))
  }

  const navegador = await chromium.launch({ executablePath: navegadorDelSistema() })
  const contexto = await navegador.newContext()
  const pagina = await contexto.newPage()

  try {
    for (let intento = 1; intento <= intentos; intento++) {
      // No se espera a ningún evento de la página, y es a propósito. Los tres
      // que ofrece Playwright fallan acá por motivos distintos:
      // `domcontentloaded` llega antes de que React hidrate —el clic se iba en
      // un envío en crudo del formulario y la pantalla se recargaba—, y
      // `networkidle` y `load` no llegan nunca cuando alguna petición se queda
      // abierta, cosa que pasa en los minutos siguientes a cada despliegue.
      // Se espera a lo único que hace falta: que el campo de la contraseña esté
      // en pantalla, más un respiro para que React se enganche a él.
      await pagina.goto(`${urlBase}/ingresar`, { waitUntil: 'commit', timeout: 60000 })
      await pagina.locator('input[type="password"]').waitFor({ state: 'visible', timeout: 60000 })
      await pagina.waitForTimeout(2500)
      await pagina.fill('input[type="email"], input[name="correo"]', usuario)
      await pagina.fill('input[type="password"]', clave)
      await pagina.click('button[type="submit"]')

      // Noventa segundos, que parecen una exageración y no lo son: entrar
      // dispara una navegación completa al tablero, y el tablero tarda diez o
      // más. Con la espera corta el recorrido daba «no se pudo entrar» sobre un
      // ingreso que había funcionado; se perdió una tarde en eso.
      const entro = await pagina
        .waitForURL((u) => !u.pathname.includes('/ingresar'), { timeout: 90000 })
        .then(() => true)
        .catch(() => false)

      // Si la espera venció, puede que la navegación esté llegando justo ahora:
      // el tablero tarda, y preguntarle a la página en ese instante revienta con
      // «execution context destroyed». Se le da un respiro y se vuelve a mirar
      // antes de declarar que no entró.
      if (!entro) await pagina.waitForTimeout(5000)

      if (entro || !pagina.url().includes('/ingresar')) {
        const estado = await contexto.storageState()
        mkdirSync(dirname(archivo), { recursive: true })
        writeFileSync(archivo, JSON.stringify(estado))
        return estado
      }

      // Un `[role="alert"]` vacío no es un mensaje: el hueco existe siempre y
      // solo se llena cuando hay algo que decir. Tomarlo por un error hacía
      // contar «no se pudo entrar: » con la razón en blanco.
      // En try/catch porque leer la pantalla mientras navega tira una excepción
      // que no dice nada del ingreso y esconde el motivo de verdad.
      const avisos = await pagina
        .locator('[role="alert"]')
        .allTextContents()
        .then((ts) => ts.map((x) => x.trim()).filter(Boolean))
        .catch(() => [])
      if (avisos.length > 0) throw new Error(`no se pudo entrar: ${avisos.join(' · ')}`)
      console.log(`  (el ingreso no respondió, intento ${intento} de ${intentos})`)
    }

    throw new Error(`no se pudo entrar después de ${intentos} intentos`)
  } finally {
    await navegador.close()
  }
}
