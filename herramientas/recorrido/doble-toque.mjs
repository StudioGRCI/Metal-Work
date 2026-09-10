import { chromium } from 'playwright-core'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { navegadorDelSistema, sesionGuardada } from './sesion.mjs'

/**
 * Tocar «Registrar» tres veces seguidas, como el dedo que no ve que pasó algo,
 * y contar cuántos envíos llegan al servidor.
 *
 * Existe por el reporte de flota que entró tres veces el 2026-09-09 con un
 * segundo de diferencia: el botón no se desactivaba mientras enviaba, y cada
 * toque de más quedaba en cola. Lo correcto es UN envío y el botón desactivado
 * desde el primer toque.
 *
 * Para no escribir nada en la base, el texto que se llena tiene que ser uno que
 * el servidor rechace (tres letras donde se piden cinco): el envío llega, la
 * validación lo devuelve, y lo que se cuenta es cuántas veces llegó.
 *
 *   MSYS_NO_PATHCONV=1 URL=https://metal-work-sandy.vercel.app \
 *   USUARIO=supervisor@metalworkperusac.com CLAVE='…' \
 *   node herramientas/recorrido/doble-toque.mjs \
 *     /avance/trabajos/<id> "Reportar" "#rf-descripcion" "abc" "Registrar"
 *
 * Los toques se dan con `force`: Playwright no espera a que el botón se
 * habilite, igual que la persona. Un botón desactivado no dispara el envío
 * aunque se lo toque, así que el conteo dice la verdad.
 */

const URL_BASE = process.env.URL
const USUARIO = process.env.USUARIO
const CLAVE = process.env.CLAVE
const [ruta, abrir, campo, texto, enviar] = process.argv.slice(2)

if (!URL_BASE || !USUARIO || !CLAVE || !ruta || !abrir || !campo || !texto || !enviar) {
  console.error('Uso: URL=… USUARIO=… CLAVE=… node doble-toque.mjs <ruta> <botón que abre> <selector del campo> <texto> <botón de envío>')
  process.exit(2)
}

const archivo = join(tmpdir(), `metalwork-sesion-${USUARIO.replace(/[^a-z0-9]/gi, '_')}.json`)
const estado = await sesionGuardada({ urlBase: URL_BASE, usuario: USUARIO, clave: CLAVE, archivo })

const navegador = await chromium.launch({ executablePath: navegadorDelSistema() })
const contexto = await navegador.newContext({
  storageState: estado,
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
})
const pagina = await contexto.newPage()

// Una acción de servidor de Next es un POST con la cabecera `next-action`.
let envios = 0
pagina.on('request', (p) => {
  if (p.method() === 'POST' && p.headers()['next-action']) envios++
})

try {
  await pagina.goto(`${URL_BASE}${ruta}`, { waitUntil: 'commit', timeout: 60000 })
  const abre = pagina.getByRole('button', { name: abrir, exact: true })
  await abre.waitFor({ state: 'visible', timeout: 60000 })
  await pagina.waitForTimeout(1500) // que React se enganche al botón
  await abre.click()
  await pagina.locator(campo).fill(texto)

  const boton = pagina.getByRole('button', { name: enviar, exact: true })
  const lineas = []
  for (let toque = 1; toque <= 3; toque++) {
    await boton.click({ force: true, timeout: 3000 }).catch(() => {})
    await pagina.waitForTimeout(120)
    const desactivado = await boton.isDisabled().catch(() => null)
    lineas.push(`  tras el toque ${toque}: botón ${desactivado === null ? 'ya no está' : desactivado ? 'desactivado' : 'ACTIVO'}`)
    await pagina.waitForTimeout(130)
  }
  await pagina.waitForTimeout(4000) // que terminen los que quedaron en cola

  const aviso = await pagina.locator('[role="alert"]').allInnerTexts().catch(() => [])
  // Si el servidor lo rechazó, lo escrito tiene que seguir en el campo: quien
  // escribió un reporte largo no lo vuelve a escribir.
  const quedo = await pagina.locator(campo).inputValue().catch(() => null)
  console.log(lineas.join('\n'))
  console.log(`  aviso en pantalla: ${aviso.filter(Boolean).join(' | ') || '(ninguno)'}`)
  console.log(`  lo escrito tras el rechazo: ${quedo === null ? 'el campo ya no está' : quedo === texto ? 'sigue en el campo — bien' : `SE BORRÓ (quedó «${quedo}»)`}`)
  console.log(`\nenvíos al servidor: ${envios} ${envios === 1 ? '— bien' : '— MAL: tendría que ser 1'}`)
  process.exitCode = envios === 1 && quedo === texto ? 0 : 1
} finally {
  await navegador.close()
}
