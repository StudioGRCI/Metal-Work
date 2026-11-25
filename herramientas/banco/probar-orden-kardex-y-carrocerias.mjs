/**
 * El orden del Kardex y la lista de Carrocerías, con la cuenta de cada puesto
 * que las usa y en los dos tamaños (teléfono de 390 y monitor de 1440).
 * Entrega 1 del plan de orden y diseño (2026-11-25).
 *
 * Kardex, como Almacén:
 *   1. Lo que espera va primero: por validar, por reponer, por cerrar; después
 *      el tablero de los cuatro almacenes, los filtros y el historial.
 *   2. Los seis botones siguen ahí, lo de todos los días primero.
 *   3. La «i» de un almacén abre su regla sin navegar; tocar la tarjeta filtra
 *      por ese almacén, queda marcada, y con el teclado se quita el filtro.
 *   4. «Registrar ingreso» sigue abriendo su ventana.
 *
 * Carrocerías, como Diseño (Editar, Medidas, Desactivar) y como Ventas
 * (Editar, Desactivar):
 *   5. Los botones de la fila van en un solo renglón, dentro de la pantalla,
 *      y en el teléfono con 40 px o más de alto.
 *   6. «Editar» y «Medidas» abren su ventana.
 *   7. En el teléfono la fila es una ficha: el rótulo «Fichas técnicas» se ve
 *      solo ahí y la tabla no se desliza de costado.
 *
 * En ninguna hay desborde ni errores de consola. No escribe en la base.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_CHROMIUM.
 */
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}

const fallas = []
function comprobar(cond, texto, detalle = '') {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}${detalle ? ` ${detalle}` : ''}`)
  if (!cond) fallas.push(texto)
}

const TELEFONO = { width: 390, height: 844 }
const MONITOR = { width: 1440, height: 900 }
const navegador = await chromium.launch({ executablePath: NAVEGADOR })

async function entrar(puesto, tamano) {
  const esTelefono = tamano.width < 500
  const contexto = await navegador.newContext({ viewport: tamano, isMobile: esTelefono, hasTouch: esTelefono })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => { if (m.type() === 'error') errores.push(m.text().slice(0, 300)) })
  pagina.on('pageerror', (e) => errores.push(`pageerror ${e.message.slice(0, 300)}`))
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', `${puesto}.local@metalwork.test`)
  await pagina.fill('input[type="password"]', CLAVE)
  await pagina.click('button[type="submit"]')
  await pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 })
  return { pagina, contexto, errores }
}

const desborde = (pagina) => pagina.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)

for (const tamano of [TELEFONO, MONITOR]) {
  console.log(`\nKardex como Almacén, ${tamano.width} px`)
  const { pagina, contexto, errores } = await entrar('almacen', tamano)
  await pagina.goto(`${BASE}/almacen/kardex`, { waitUntil: 'networkidle' })

  const arriba = async (selector) => Math.round((await pagina.locator(selector).first().boundingBox())?.y ?? -1)
  const alturas = [
    await arriba('#por-validar'), await arriba('#por-reponer'), await arriba('#por-cerrar'),
    await arriba('section[aria-label="Los cuatro almacenes"]'), await arriba('#k-material'), await arriba('h2:has-text("Historial")'),
  ]
  comprobar(alturas[0] > 0 && alturas.every((y, i) => i === 0 || y > alturas[i - 1]),
    'el orden: por validar, por reponer, por cerrar, tablero, filtros, historial', JSON.stringify(alturas))

  const botones = await pagina.locator('main button').evaluateAll((bs) => bs.slice(0, 10).map((b) => b.textContent.trim()))
  const orden = ['Registrar salida', 'Registrar ingreso', 'Devolver al proveedor', 'Conteo físico', 'Conteo inicial', 'Sin internet']
  comprobar(orden.every((t, i) => botones.includes(t) && (i === 0 || botones.indexOf(t) > botones.indexOf(orden[i - 1]))),
    'los seis botones, lo de todos los días primero', JSON.stringify(botones.filter(Boolean)))

  const tarjeta = pagina.locator('[data-almacen="ACCESORIOS"]')
  const regla = tarjeta.getByText('Sale solo con el requerimiento')
  comprobar(!(await regla.isVisible()), 'la regla del almacén empieza guardada')
  await tarjeta.locator('button[data-ayuda]').click()
  comprobar(await regla.isVisible(), 'la «i» la abre')
  comprobar(new URL(pagina.url()).search === '', 'y no navega')
  await tarjeta.locator('button[data-ayuda]').click()
  comprobar(!(await regla.isVisible()), 'y la vuelve a guardar')

  // Un toque en el cuerpo de la tarjeta, no sobre el nombre: lo toma el enlace que la cubre.
  await tarjeta.scrollIntoViewIfNeeded()
  await pagina.evaluate(() => window.scrollBy(0, 200))
  const caja = await tarjeta.boundingBox()
  await pagina.mouse.click(caja.x + caja.width - 6, caja.y + caja.height - 6)
  await pagina.waitForURL(/almacen=ACCESORIOS/, { timeout: 15000 }).catch(() => {})
  comprobar(/almacen=ACCESORIOS/.test(pagina.url()), 'tocar la tarjeta filtra por ese almacén')
  comprobar((await tarjeta.locator('a').getAttribute('aria-current')) === 'page', 'y queda marcada como la actual')
  comprobar(await pagina.locator('h2', { hasText: /Historial de / }).isVisible(), 'el historial dice de qué almacén es')
  await tarjeta.locator('a').focus()
  await pagina.keyboard.press('Enter')
  await pagina.waitForURL((u) => !u.search.includes('almacen='), { timeout: 15000 }).catch(() => {})
  comprobar(!/almacen=/.test(pagina.url()), 'con el teclado, Enter en la marcada quita el filtro')

  await pagina.getByRole('button', { name: 'Registrar ingreso' }).click()
  comprobar(await pagina.getByRole('dialog').first().isVisible().catch(() => false), '«Registrar ingreso» abre su ventana')
  await pagina.keyboard.press('Escape')

  comprobar((await desborde(pagina)) <= 0, 'sin desborde')
  comprobar(errores.length === 0, 'sin errores de consola', errores.join(' | '))
  await contexto.close()
}

for (const [puesto, esperados] of [['diseno', ['Editar', 'Medidas', 'Desactivar']], ['ventas', ['Editar', 'Desactivar']]]) {
  for (const tamano of [TELEFONO, MONITOR]) {
    console.log(`\nCarrocerías como ${puesto}, ${tamano.width} px`)
    const { pagina, contexto, errores } = await entrar(puesto, tamano)
    await pagina.goto(`${BASE}/carrocerias`, { waitUntil: 'networkidle' })
    const fila = pagina.locator('tbody tr').first()
    const botones = await fila.locator('button').evaluateAll((bs) => bs
      .map((b) => ({ texto: b.textContent.trim(), caja: b.getBoundingClientRect() }))
      .filter((b) => b.caja.width > 0)
      .map((b) => ({ texto: b.texto, x: Math.round(b.caja.x), y: Math.round(b.caja.y), ancho: Math.round(b.caja.width), alto: Math.round(b.caja.height) })))
    comprobar(JSON.stringify(botones.map((b) => b.texto)) === JSON.stringify(esperados), `los botones de la fila: ${esperados.join(', ')}`, JSON.stringify(botones.map((b) => b.texto)))
    comprobar(new Set(botones.map((b) => Math.round((b.y + b.alto / 2) / 4))).size === 1, 'en un solo renglón')
    comprobar(botones.every((b) => b.x >= 0 && b.x + b.ancho <= tamano.width), 'todos dentro de la pantalla')
    if (tamano === TELEFONO) comprobar(botones.every((b) => b.alto >= 40), 'con 40 px o más de alto para el dedo', JSON.stringify(botones.map((b) => b.alto)))

    await fila.getByRole('button', { name: 'Editar' }).click()
    comprobar(await pagina.getByRole('dialog').first().isVisible().catch(() => false), '«Editar» abre su ventana')
    await pagina.keyboard.press('Escape')
    if (esperados.includes('Medidas')) {
      await fila.getByRole('button', { name: 'Medidas' }).click()
      comprobar(await pagina.getByRole('dialog').first().isVisible().catch(() => false), '«Medidas» abre su ventana')
      await pagina.keyboard.press('Escape')
      const rotulo = await pagina.locator('td[data-rotulo]').first().evaluate((e) => getComputedStyle(e, '::before').content)
      comprobar(tamano === TELEFONO ? /Fichas técnicas/.test(rotulo) : rotulo === 'none', 'el rótulo «Fichas técnicas» se ve solo en el teléfono', rotulo)
    }

    comprobar((await desborde(pagina)) <= 0, 'sin desborde')
    const desliza = await pagina.locator('.tabla-con-corte').first().evaluate((e) => e.scrollWidth - e.clientWidth)
    comprobar(desliza <= 1, 'la tabla no se desliza de costado', String(desliza))
    comprobar(errores.length === 0, 'sin errores de consola', errores.join(' | '))
    await contexto.close()
  }
}

await navegador.close()
console.log(fallas.length ? `\n${fallas.length} fallas:\n- ${fallas.join('\n- ')}` : '\nTodo bien.')
process.exit(fallas.length ? 1 : 0)
