/**
 * Clic real sobre la gestión de compras (migración 20261015140000), con la
 * cuenta de cada puesto (nunca ADMIN):
 *
 *   1. El conductor ve las OC aprobadas solo como un aviso, sin botón: hasta
 *      que Logística las programe no sale a recogerlas. La gestión la abre por
 *      su dirección, sin los controles de Logística.
 *   2. Logística, en «Gestión de compras», pone el peso y el lugar de dos OC
 *      (con coma decimal, como sale en el teléfono), rechaza un peso de cero
 *      y baja una de lugar con la flecha.
 *   3. Contabilidad ya no tiene la gestión (migración 20261020171000): carga
 *      la guía de remisión en PDF de la primera desde su fila en Adquisiciones;
 *      un archivo que no es PDF no entra.
 *   4. Con la guía, Logística ya no puede cambiar el peso.
 *   5. El conductor ve su lista en el orden de Logística, con el peso y la
 *      guía (el enlace abre el PDF), y sale a recoger la primera.
 *   6. Contabilidad anula la guía con motivo desde Adquisiciones: al conductor
 *      le vuelve a decir que falta, y la anulada queda contada.
 *
 *   7. Logística saca la segunda de la lista: la deja como la encontró.
 *
 * Necesita al menos tres OC aprobadas que Logística todavía no programa
 * (`probar-adquisiciones-compras.mjs` siembra las OC). Si la lista del
 * conductor trae alguna por recoger, Logística la saca primero (paso 0); las
 * que el conductor ya lleva encima no estorban. Como vacía esa lista, no se
 * corre a la vez que otra sonda o que alguien que la esté usando en el banco.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111) y los correos de cada
 * cuenta si no son las `*.local@metalwork.test` que siembra `preparar.sh`.
 */
import { mkdirSync } from 'node:fs'

import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const cuenta = (puesto) => process.env[puesto.toUpperCase()] ?? `${puesto}.local@metalwork.test`
const CUENTAS = Object.fromEntries(['logistica', 'contabilidad', 'conductor'].map((p) => [p, cuenta(p)]))
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, ancho = 1280) {
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: 900 } })
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

const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ')
/** Las tarjetas de una sección de Gestión de compras, por el id de su título. */
const seccion = (pagina, id) => pagina.locator(`section[aria-labelledby="${id}"] > div`)
const tarjeta = (pagina, id, oc) => seccion(pagina, id).filter({ hasText: oc })
/** Un PDF mínimo, y algo que no lo es aunque se llame .pdf. */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n')
const NO_PDF = Buffer.from('esto no es un pdf')
/** Abrir la guía como lo hace el enlace: con la sesión, siguiendo la redirección al PDF firmado. */
async function abrirGuia(contexto, href) {
  const r = await contexto.request.get(`${BASE}${href}`, { maxRedirects: 5 })
  return { estado: r.status(), cabeza: (await r.body()).subarray(0, 5).toString() }
}

let ocA = ''
let ocB = ''
let ocC = ''
let esperanAntes = 0

// ------------------------------------------------ 0. La lista del conductor, vacía
// `probar-adquisiciones-compras.mjs` deja programada la OC que siembra con la
// cotización: Logística la saca con clic, para que esta vuelta empiece en «1.º».
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/compras/gestion`, { waitUntil: 'networkidle' })
  const sacar = () => seccion(pagina, 'titulo-lista').getByRole('button', { name: 'Sacar de la lista' })
  const sacadas = []
  for (let n = await sacar().count(); n > 0 && sacadas.length < 10; n = await sacar().count()) {
    const primera = seccion(pagina, 'titulo-lista').filter({ has: pagina.getByRole('button', { name: 'Sacar de la lista' }) }).first()
    sacadas.push((await texto(primera)).match(/^\d+\.º · (.+?) · /)?.[1] ?? '?')
    await primera.getByRole('button', { name: 'Sacar de la lista' }).click()
    await pagina.getByRole('button', { name: 'Sí, sacarla' }).click()
    await pagina.waitForFunction(
      (antes) => [...document.querySelectorAll('section[aria-labelledby="titulo-lista"] button')].filter((b) => b.textContent?.includes('Sacar de la lista')).length < antes,
      n,
      { timeout: 20000 },
    )
  }
  comprobar((await sacar().count()) === 0, `la lista del conductor queda vacía (sacadas: ${sacadas.join(', ') || 'ninguna'})`)
  await contexto.close()
}

// ------------------------------------------------ 1. Sin programar, el conductor no sale
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.conductor)
  await pagina.goto(`${BASE}/recojos`, { waitUntil: 'networkidle' })
  const main = await texto(pagina.locator('main'))
  const espera = main.match(/(\d+) compras? aprobadas? esperan? que Logística/)
  comprobar(espera !== null && Number(espera[1]) >= 3, `el conductor ve cuántas esperan a Logística: «${espera?.[0]}»`)
  esperanAntes = Number(espera?.[1] ?? 0)
  comprobar((await pagina.getByRole('button', { name: 'Salgo a recoger' }).count()) === 0, 'y ningún «Salgo a recoger»')
  comprobar((await pagina.locator('nav a', { hasText: 'Gestión de compras' }).count()) === 0, 'su menú no lleva Gestión de compras: su lista es Recojos')
  await pagina.goto(`${BASE}/compras/gestion`, { waitUntil: 'networkidle' })
  comprobar(new URL(pagina.url()).pathname === '/compras/gestion', 'por la dirección abre la gestión, para ver qué viene')
  comprobar((await pagina.getByRole('button', { name: /Poner en la lista|Guardar|Sacar de la lista|Cargar guía/ }).count()) === 0, 'sin los controles de Logística')
  comprobar(errores.length === 0, `sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ------------------------------------------------ 2. Logística programa
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.logistica)
  comprobar((await pagina.locator('nav a', { hasText: 'Gestión de compras' }).count()) >= 1, 'el menú de Logística lleva Gestión de compras')
  comprobar((await pagina.locator('nav a', { hasText: /^Recojos$/ }).count()) === 0, 'y ya no Recojos: la gestión lo muestra todo')
  await pagina.goto(`${BASE}/compras/gestion`, { waitUntil: 'networkidle' })
  const porProgramar = seccion(pagina, 'titulo-por-programar')
  const numeros = []
  for (const t of await porProgramar.allInnerTexts()) {
    const n = t.match(/OC-\d+-MW/)
    if (n) numeros.push(n[0])
  }
  comprobar(numeros.length >= 3, `Por programar trae las OC aprobadas: ${numeros.join(', ')}`)
  ;[ocA, ocB, ocC] = numeros

  // A al final (la primera), con coma decimal.
  let t = tarjeta(pagina, 'titulo-por-programar', ocA)
  await t.locator('input[name="peso"]').fill('350,5')
  await t.getByRole('button', { name: 'Poner en la lista' }).click()
  await tarjeta(pagina, 'titulo-lista', ocA).waitFor({ timeout: 20000 })
  comprobar((await texto(tarjeta(pagina, 'titulo-lista', ocA))).startsWith(`1.º · ${ocA}`), `${ocA} pasa a la lista del conductor como 1.º`)
  comprobar(/350[,.]5 kg/.test(await texto(tarjeta(pagina, 'titulo-lista', ocA))), 'con su peso de 350,5 kg')

  // Un peso de cero no entra.
  t = tarjeta(pagina, 'titulo-por-programar', ocC)
  await t.locator('input[name="peso"]').fill('0')
  await t.getByRole('button', { name: 'Poner en la lista' }).click()
  await t.locator('[role="alert"]').waitFor({ timeout: 20000 })
  comprobar((await t.locator('[role="alert"]').innerText()).includes('Escribe el peso en kilos'), `un peso de cero no entra: «${await t.locator('[role="alert"]').innerText()}»`)

  // B en el primer lugar: A baja al segundo.
  t = tarjeta(pagina, 'titulo-por-programar', ocB)
  await t.locator('input[name="peso"]').fill('120')
  await t.locator('select[name="lugar"]').selectOption('1')
  await t.getByRole('button', { name: 'Poner en la lista' }).click()
  await tarjeta(pagina, 'titulo-lista', ocB).waitFor({ timeout: 20000 })
  let lista = await seccion(pagina, 'titulo-lista').allInnerTexts()
  comprobar(lista[0]?.includes(`1.º · ${ocB}`) && lista[1]?.includes(`2.º · ${ocA}`), `${ocB} entra 1.º y ${ocA} pasa a 2.º`)

  // La flecha: B baja un lugar y A vuelve a ser la primera.
  await tarjeta(pagina, 'titulo-lista', ocB).getByRole('button', { name: `Bajar ${ocB} un lugar` }).click()
  await pagina.waitForFunction(
    ([a]) => document.querySelector('section[aria-labelledby="titulo-lista"] > div')?.textContent?.includes(a),
    [`1.º · ${ocA}`],
    { timeout: 20000 },
  )
  lista = await seccion(pagina, 'titulo-lista').allInnerTexts()
  comprobar(lista[0]?.includes(`1.º · ${ocA}`) && lista[1]?.includes(`2.º · ${ocB}`), `con la flecha ${ocB} baja y ${ocA} vuelve a ser 1.º`)
  // El desplegable de cada una dice su lugar de ahora, no el que tenía: si no,
  // «Guardar» la devolvería al lugar viejo.
  const lugarB = await tarjeta(pagina, 'titulo-lista', ocB).locator('select[name="lugar"]').inputValue()
  const lugarA = await tarjeta(pagina, 'titulo-lista', ocA).locator('select[name="lugar"]').inputValue()
  comprobar(lugarA === '1' && lugarB === '2', `el lugar de cada una se pone al día tras la flecha (${ocA}: ${lugarA}, ${ocB}: ${lugarB})`)
  comprobar((await texto(pagina.locator('main'))).includes('2 en la lista del conductor'), 'el resumen cuenta dos en la lista')
  await pagina.screenshot({ path: `${CAPTURAS}/gestion-logistica.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ------------------------------------------------ 3. Contabilidad carga la guía, desde Adquisiciones
let hrefGuia = ''
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.contabilidad)
  const menu = await pagina.locator('nav a').allInnerTexts()
  comprobar(!menu.some((m) => m.includes('Gestión de compras')), 'el menú de Contabilidad ya no lleva Gestión de compras')
  await pagina.goto(`${BASE}/compras/gestion`, { waitUntil: 'networkidle' })
  comprobar(pagina.url().includes('/sin-permiso'), `y por la dirección la rechaza (${new URL(pagina.url()).pathname})`)
  await pagina.goto(`${BASE}/adquisiciones?situacion=guia`, { waitUntil: 'networkidle' })
  const fila = (oc) => pagina.locator(`tbody tr[data-orden="${oc}"]`)
  comprobar((await fila(ocC).count()) === 0, `${ocC}, sin peso, todavía no pide guía`)
  comprobar((await fila(ocA).count()) === 1 && (await fila(ocB).count()) === 1, `${ocA} y ${ocB}, con su peso, la piden`)
  const ventana = pagina.locator('[role="dialog"]')

  // Un archivo que no es PDF no entra, aunque se llame .pdf.
  await fila(ocB).getByRole('button', { name: 'Cargar guía' }).click()
  await ventana.locator('input[name="numero"]').fill('T001-0000999')
  await ventana.locator('input[name="archivo"]').setInputFiles({ name: 'guia.pdf', mimeType: 'application/pdf', buffer: NO_PDF })
  await ventana.getByRole('button', { name: 'Cargar guía' }).click()
  await ventana.locator('[role="alert"]').waitFor({ timeout: 20000 })
  comprobar((await ventana.locator('[role="alert"]').innerText()).includes('Elige el PDF'), `un archivo que no es PDF no entra: «${await ventana.locator('[role="alert"]').innerText()}»`)
  await ventana.getByRole('button', { name: 'Cancelar' }).click()

  // La guía de A, con el número escrito a la ligera: se guarda normalizado.
  await fila(ocA).getByRole('button', { name: 'Cargar guía' }).click()
  await ventana.locator('input[name="numero"]').fill(' t001- 00000123 ')
  await ventana.locator('input[name="archivo"]').setInputFiles({ name: 'guia-a.pdf', mimeType: 'application/pdf', buffer: PDF })
  await ventana.getByRole('button', { name: 'Cargar guía' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  await pagina.goto(`${BASE}/adquisiciones?q=${encodeURIComponent(ocA)}`, { waitUntil: 'networkidle' })
  const enlaceGuia = fila(ocA).getByRole('link', { name: /Guía de remisión T001-00000123/ })
  comprobar((await enlaceGuia.count()) === 1, `la guía de ${ocA} queda como T001-00000123`)
  hrefGuia = (await enlaceGuia.getAttribute('href')) ?? ''
  const abierta = await abrirGuia(contexto, hrefGuia)
  comprobar(abierta.estado === 200 && abierta.cabeza === '%PDF-', `Contabilidad abre el PDF de la guía (${abierta.estado}, ${abierta.cabeza})`)
  await pagina.screenshot({ path: `${CAPTURAS}/guia-contabilidad.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ------------------------------------------------ 4. Con guía, el peso no cambia
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/compras/gestion`, { waitUntil: 'networkidle' })
  const t = tarjeta(pagina, 'titulo-lista', ocA)
  comprobar((await t.locator('input[name="peso"]').getAttribute('readonly')) !== null, `con guía, el peso de ${ocA} queda fijo`)
  comprobar((await texto(t)).includes('Ya hay guía con este peso'), 'y la pantalla dice por qué')
  await contexto.close()
}

// ------------------------------------------------ 5. El conductor ve su lista y sale
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.conductor, 390)
  await pagina.goto(`${BASE}/recojos`, { waitUntil: 'networkidle' })
  const tarjetas = pagina.locator('main section').first().locator('> div')
  const textos = (await tarjetas.allInnerTexts()).map((x) => x.replace(/\s+/g, ' '))
  // Lo que el conductor ya lleva encima va primero, y otra sonda pudo dejarle
  // una recogida: las dos de esta se buscan por su número, y el orden lo dice
  // su lugar en la lista.
  const iA = textos.findIndex((x) => x.startsWith(`1.º · ${ocA}`))
  const iB = textos.findIndex((x) => x.startsWith(`2.º · ${ocB}`))
  const [a, b] = [textos[iA] ?? '', textos[iB] ?? '']
  comprobar(iA >= 0 && iB === iA + 1, `en el teléfono, su lista en el orden de Logística: ${textos.map((x) => x.slice(0, 18)).join(' | ')}`)
  comprobar(/Pesa 350[,.]5 kg/.test(a) && /Pesa 120 kg/.test(b), 'cada una con su peso')
  comprobar(a.includes('Guía de remisión T001-00000123 (PDF)'), 'la primera con su guía')
  comprobar(b.includes('Contabilidad todavía no carga la guía de remisión'), 'la segunda dice que falta la guía')
  const quedan = esperanAntes - 2
  const aviso = quedan === 1 ? '1 compra aprobada espera que Logística la programe' : `${quedan} compras aprobadas esperan que Logística`
  comprobar((await texto(pagina.locator('main'))).includes(aviso), `las que no programó siguen solo como aviso: «${aviso}»`)
  const abierta = await abrirGuia(contexto, hrefGuia)
  comprobar(abierta.estado === 200 && abierta.cabeza === '%PDF-', `el conductor abre el PDF de la guía (${abierta.estado}, ${abierta.cabeza})`)
  const primera = tarjetas.filter({ hasText: ocA })
  await primera.getByRole('button', { name: 'Salgo a recoger' }).click()
  await primera.getByRole('button', { name: 'Ya la recogí' }).waitFor({ timeout: 20000 })
  comprobar((await texto(primera)).includes('En recojo'), `sale a recoger ${ocA}: la tarjeta dice «En recojo»`)
  await pagina.screenshot({ path: `${CAPTURAS}/recojos-conductor.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola (${errores.join(' | ')})`)
  await contexto.close()
}

// ------------------------------------------------ 6. Contabilidad anula la guía, desde Adquisiciones
{
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad)
  await pagina.goto(`${BASE}/adquisiciones?q=${encodeURIComponent(ocA)}`, { waitUntil: 'networkidle' })
  const t = pagina.locator(`tbody tr[data-orden="${ocA}"]`)
  comprobar((await texto(t)).includes('En recojo'), `${ocA} dice que va con el conductor`)
  await t.getByRole('button', { name: 'Anular guía' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('textarea[name="motivo"]').fill('El peso de la guía salió mal escrito')
  await ventana.getByRole('button', { name: 'Anular guía' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 20000 })
  await t.getByRole('button', { name: 'Cargar guía' }).waitFor({ timeout: 20000 })
  comprobar((await texto(t)).includes('Una guía anulada'), 'la anulada queda contada y se puede cargar la buena')
  await contexto.close()
}
{
  const { pagina, contexto } = await entrar(CUENTAS.conductor)
  await pagina.goto(`${BASE}/recojos`, { waitUntil: 'networkidle' })
  const t = pagina.locator('main section').first().locator('> div').filter({ hasText: ocA })
  comprobar((await texto(t)).includes('Contabilidad todavía no carga la guía de remisión'), 'al conductor le vuelve a decir que falta la guía')
  const abierta = await abrirGuia(contexto, hrefGuia)
  comprobar(abierta.estado === 200 && abierta.cabeza === '%PDF-', `la anulada se sigue pudiendo abrir como evidencia (${abierta.estado})`)
  await contexto.close()
}

// ------------------------------------------------ 7. Logística saca la segunda de la lista
// La deja como la encontró: con una OC en la lista del conductor, la próxima
// vuelta no empieza en «1.º».
{
  const { pagina, contexto } = await entrar(CUENTAS.logistica)
  await pagina.goto(`${BASE}/compras/gestion`, { waitUntil: 'networkidle' })
  await tarjeta(pagina, 'titulo-lista', ocB).getByRole('button', { name: 'Sacar de la lista' }).click()
  await pagina.getByRole('button', { name: 'Sí, sacarla' }).click()
  await tarjeta(pagina, 'titulo-por-programar', ocB).waitFor({ timeout: 20000 }).catch(() => {})
  comprobar((await tarjeta(pagina, 'titulo-lista', ocB).count()) === 0 && (await tarjeta(pagina, 'titulo-por-programar', ocB).count()) === 1, `${ocB} sale de la lista y vuelve a Por programar`)
  await contexto.close()
}

await navegador.close()
console.log(fallas.length === 0 ? `\nTODO EN VERDE (${ocA}, ${ocB}, ${ocC})` : `\n${fallas.length} FALLAS`)
process.exit(fallas.length === 0 ? 0 : 1)
