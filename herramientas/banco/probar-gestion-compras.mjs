/**
 * Clic real sobre la gestión de compras (migración 20261015140000), con la
 * cuenta de cada puesto (nunca ADMIN):
 *
 *   1. El conductor ve las OC aprobadas solo como un aviso, sin botón: hasta
 *      que Logística las programe no sale a recogerlas.
 *   2. Logística, en «Gestión de compras», pone el peso y el lugar de dos OC
 *      (con coma decimal, como sale en el teléfono), rechaza un peso de cero
 *      y baja una de lugar con la flecha.
 *   3. Contabilidad ve la misma lista sin los controles de Logística y carga
 *      la guía de remisión en PDF de la primera; un archivo que no es PDF no
 *      entra.
 *   4. Con la guía, Logística ya no puede cambiar el peso.
 *   5. El conductor ve su lista en el orden de Logística, con el peso y la
 *      guía (el enlace abre el PDF), y sale a recoger la primera.
 *   6. Contabilidad anula la guía con motivo: al conductor le vuelve a decir
 *      que falta, y la anulada queda contada.
 *
 * Necesita al menos tres OC aprobadas que Logística todavía no programa.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111) y los correos de cada
 * cuenta si no son `*@local.test`.
 */
import { mkdirSync } from 'node:fs'

import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  logistica: process.env.LOGISTICA ?? 'comprador@local.test',
  contabilidad: process.env.CONTABILIDAD ?? 'contabilidad@local.test',
  conductor: process.env.CONDUCTOR ?? 'conductor@local.test',
}
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

// ------------------------------------------------ 1. Sin programar, el conductor no sale
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.conductor)
  await pagina.goto(`${BASE}/recojos`, { waitUntil: 'networkidle' })
  const main = await texto(pagina.locator('main'))
  const espera = main.match(/(\d+) compras? aprobadas? esperan? que Logística/)
  comprobar(espera !== null && Number(espera[1]) >= 3, `el conductor ve cuántas esperan a Logística: «${espera?.[0]}»`)
  comprobar((await pagina.getByRole('button', { name: 'Salgo a recoger' }).count()) === 0, 'y ningún «Salgo a recoger»')
  comprobar((await pagina.locator('nav a', { hasText: 'Gestión de compras' }).count()) === 0, 'su menú no lleva Gestión de compras')
  await pagina.goto(`${BASE}/compras/gestion`, { waitUntil: 'networkidle' })
  comprobar(pagina.url().includes('/sin-permiso'), `por la dirección, Gestión de compras lo rechaza (${new URL(pagina.url()).pathname})`)
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

// ------------------------------------------------ 3. Contabilidad carga la guía
let hrefGuia = ''
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.contabilidad)
  const menu = await pagina.locator('nav a').allInnerTexts()
  comprobar(menu.some((m) => m.includes('Gestión de compras')), 'el menú de Contabilidad lleva Gestión de compras')
  await pagina.goto(`${BASE}/compras/gestion`, { waitUntil: 'networkidle' })
  comprobar((await pagina.getByRole('button', { name: /Poner en la lista|Guardar|Sacar de la lista/ }).count()) === 0, 'Contabilidad no ve los controles de Logística')
  const sinPeso = tarjeta(pagina, 'titulo-por-programar', ocC)
  comprobar(
    (await texto(sinPeso)).includes('se emite cuando Logística ponga el peso') && (await sinPeso.getByRole('button', { name: 'Cargar guía' }).count()) === 0,
    `${ocC}, sin peso, todavía no pide guía`,
  )

  // Un archivo que no es PDF no entra, aunque se llame .pdf.
  let t = tarjeta(pagina, 'titulo-lista', ocB)
  await t.locator('input[name="numero"]').fill('T001-0000999')
  await t.locator('input[name="archivo"]').setInputFiles({ name: 'guia.pdf', mimeType: 'application/pdf', buffer: NO_PDF })
  await t.getByRole('button', { name: 'Cargar guía' }).click()
  await t.locator('[role="alert"]').waitFor({ timeout: 20000 })
  comprobar((await t.locator('[role="alert"]').innerText()).includes('Elige el PDF'), `un archivo que no es PDF no entra: «${await t.locator('[role="alert"]').innerText()}»`)

  // La guía de A, con el número escrito a la ligera: se guarda normalizado.
  t = tarjeta(pagina, 'titulo-lista', ocA)
  await t.locator('input[name="numero"]').fill(' t001- 00000123 ')
  await t.locator('input[name="archivo"]').setInputFiles({ name: 'guia-a.pdf', mimeType: 'application/pdf', buffer: PDF })
  await t.getByRole('button', { name: 'Cargar guía' }).click()
  await t.getByRole('link', { name: /Guía de remisión T001-00000123/ }).waitFor({ timeout: 20000 })
  comprobar(true, `la guía de ${ocA} queda como T001-00000123`)
  comprobar((await t.getByText('Con guía', { exact: true }).count()) === 1, 'la tarjeta dice «Con guía»')
  hrefGuia = (await t.getByRole('link', { name: /Guía de remisión/ }).getAttribute('href')) ?? ''
  const abierta = await abrirGuia(contexto, hrefGuia)
  comprobar(abierta.estado === 200 && abierta.cabeza === '%PDF-', `Contabilidad abre el PDF de la guía (${abierta.estado}, ${abierta.cabeza})`)
  comprobar((await texto(pagina.locator('main'))).includes('1 sin guía de remisión'), 'el resumen cuenta una sin guía')
  await pagina.screenshot({ path: `${CAPTURAS}/gestion-contabilidad.png`, fullPage: true })
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
  comprobar(textos[0]?.startsWith(`1.º · ${ocA}`) && textos[1]?.startsWith(`2.º · ${ocB}`), `en el teléfono, su lista en el orden de Logística: ${textos.map((x) => x.slice(0, 18)).join(' | ')}`)
  comprobar(/Pesa 350[,.]5 kg/.test(textos[0] ?? '') && /Pesa 120 kg/.test(textos[1] ?? ''), 'cada una con su peso')
  comprobar(textos[0]?.includes('Guía de remisión T001-00000123 (PDF)'), 'la primera con su guía')
  comprobar(textos[1]?.includes('Contabilidad todavía no carga la guía de remisión'), 'la segunda dice que falta la guía')
  comprobar((await texto(pagina.locator('main'))).includes('1 compra aprobada espera que Logística la programe'), 'la tercera sigue solo como aviso')
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

// ------------------------------------------------ 6. Contabilidad anula la guía
{
  const { pagina, contexto } = await entrar(CUENTAS.contabilidad)
  await pagina.goto(`${BASE}/compras/gestion`, { waitUntil: 'networkidle' })
  const t = tarjeta(pagina, 'titulo-en-camino', ocA)
  comprobar((await t.count()) === 1, `${ocA} pasó a «En camino»`)
  await t.getByRole('button', { name: 'Anular guía' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('textarea[name="motivo"]').fill('El peso de la guía salió mal escrito')
  await ventana.getByRole('button', { name: 'Anular guía' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 20000 })
  await t.getByRole('button', { name: 'Cargar guía' }).waitFor({ timeout: 20000 })
  comprobar((await texto(t)).includes('(1 anulada)'), 'la anulada queda contada y se puede cargar la buena')
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

await navegador.close()
console.log(fallas.length === 0 ? `\nTODO EN VERDE (${ocA}, ${ocB}, ${ocC})` : `\n${fallas.length} FALLAS`)
process.exit(fallas.length === 0 ? 0 : 1)
