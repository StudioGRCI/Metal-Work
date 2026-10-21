/**
 * Clic real sobre los dos requerimientos y la revisión por insumo, con la
 * cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Requerimientos solo elige Acabados, Almacén, Maestranza o Producción y
 *      registra un RQ de operación con tres insumos; le llega a Almacén.
 *   2. La administradora tiene su grupo en el menú y registra un RQA para un
 *      área de oficina; no puede elegir Maestranza.
 *   3. Almacén revisa cada insumo: del RQ tiene el primero completo, la mitad
 *      del segundo y nada del tercero; del RQA, el primero completo.
 *   4. Logística ve «Generar OC» solo en el RQ de operación, con el insumo
 *      completo bloqueado y el segundo por lo que falta; en el RQA no tiene
 *      botones, y no le llega su aviso.
 *   5. La administradora genera la OC del RQA con lo que falta: queda en compra.
 *      En el RQ de operación no tiene botones.
 *
 * Al día hasta la revisión de Almacén (2026-10-21). Desde #105 «Generar OC» va
 * arriba de la lista de Atención y junta insumos de varios RQ, y la fila de
 * Atención cuenta cada insumo con otras palabras: lo que lee de la fila en 3 y
 * los pasos 4 y 5 esperan la pantalla de antes y fallan, aunque la revisión
 * queda bien en la base. La OC de varios RQ tiene su recorrido aparte,
 * `probar-oc-de-varios-rq.mjs`.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111) y los correos
 * REQUERIMIENTOS, ADMINISTRACION, ALMACEN y LOGISTICA si no son
 * `*.local@metalwork.test`.
 */
import { mkdirSync } from 'node:fs'

import { chromium } from 'playwright-core'

import { escribirCodigo } from './campo-codigo.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  requerimientos: process.env.REQUERIMIENTOS ?? 'requerimientos.local@metalwork.test',
  administracion: process.env.ADMINISTRACION ?? 'administracion.local@metalwork.test',
  almacen: process.env.ALMACEN ?? 'almacen.local@metalwork.test',
  logistica: process.env.LOGISTICA ?? 'logistica.local@metalwork.test',
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

async function entrar(correo) {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } })
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

/** Los títulos de grupo del menú y, por grupo, sus entradas. */
async function menu(pagina) {
  return pagina.locator('nav[aria-label="Menú principal"] > div').evaluateAll((divs) =>
    divs.map((d) => ({ grupo: d.querySelector('p')?.textContent?.trim(), items: [...d.querySelectorAll('a')].map((a) => a.textContent?.trim()) })),
  )
}

const texto = async (loc) => (await loc.innerText()).replace(/\s+/g, ' ')
const opciones = async (select) => (await select.locator('option:not([disabled])').allInnerTexts()).map((t) => t.trim())

/** Llena el formulario del requerimiento abierto y lo manda; devuelve el número que dice el aviso. */
async function registrar(pagina, { area, codigo, justificacion, insumos }) {
  const ventana = pagina.locator('[role="dialog"]')
  await ventana.locator('#rq-area').selectOption({ label: area })
  await escribirCodigo(ventana.locator('#rq-codigo'), codigo)
  await ventana.locator('#rq-justificacion').fill(justificacion)
  for (const [i, [descripcion, cantidad]] of insumos.entries()) {
    if (i > 0) await ventana.getByRole('button', { name: 'Agregar insumo' }).click()
    // Desde #98 cada insumo se elige del catálogo de Almacén; los del recorrido
    // son inventados, así que se piden como material nuevo.
    await ventana.getByRole('button', { name: 'Pedirlo como material nuevo' }).last().click()
    await ventana.locator('[id^="rq-desc-"]').nth(i).fill(descripcion)
    await ventana.locator('[id^="rq-cant-"]').nth(i).fill(String(cantidad))
    await ventana.locator('[id^="rq-cat-"]').nth(i).selectOption({ index: 1 })
  }
  await ventana.getByRole('button', { name: 'Registrar y mandar a Almacén' }).click()
  await pagina.locator('[role="status"]').first().waitFor({ timeout: 20000 })
  const aviso = await pagina.locator('[role="status"]').first().innerText()
  return { aviso, numero: (aviso.match(/RQA?-\d{4}-\d{4}/) ?? [''])[0] }
}

/** «Revisar stock»: una cantidad por insumo, en orden. */
async function revisarStock(pagina, fila, cantidades, nota) {
  await fila.getByRole('button', { name: 'Revisar stock' }).click()
  const v = pagina.locator('[role="dialog"]')
  for (const [i, c] of cantidades.entries()) await v.locator('input[type="number"]').nth(i).fill(String(c))
  if (nota) await v.locator('textarea[name="nota"]').fill(nota)
  const resumen = await v.locator('[role="status"]').innerText()
  await v.getByRole('button', { name: 'Guardar la revisión' }).click()
  await v.waitFor({ state: 'detached', timeout: 20000 })
  await pagina.waitForTimeout(800)
  return resumen
}

const sello = Date.now().toString().slice(-6)
const codigo = `PLA_SR_O4_1_26/${sello.slice(-2)}`
let rq = ''
let rqa = ''

// ------------------------------------------------ 1. Requerimientos: el RQ de operación
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.requerimientos)
  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('nav[aria-label="Requerimiento"] [aria-current="page"]').innerText()).startsWith('Operación'),
    'Requerimientos abre en la pestaña «Operación»')
  await pagina.getByRole('button', { name: 'Nuevo requerimiento', exact: true }).click()
  const ventana = pagina.locator('[role="dialog"]')
  comprobar((await ventana.locator('#rq-tipo').count()) === 0, 'no elige el tipo: el suyo es el de operación')
  const areas = await opciones(ventana.locator('#rq-area'))
  comprobar(areas.join(',') === 'Acabados,Almacén,Maestranza,Producción', `solo las cuatro áreas de operación: ${areas.join(', ')}`)
  const r = await registrar(pagina, {
    area: 'Maestranza',
    codigo,
    justificacion: 'Armado del chasis de la plataforma del banco.',
    insumos: [[`Disco de corte ${sello}`, 5], [`Electrodo 1/8 ${sello}`, 4], [`Plancha LAF 2 mm ${sello}`, 2]],
  })
  rq = r.numero
  comprobar(/^RQ-/.test(rq) && r.aviso.includes('Almacén'), `registrado y mandado a Almacén: «${r.aviso}»`)
  comprobar(errores.length === 0, `sin errores de consola como Requerimientos ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 2. La administradora: el RQA
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.administracion)
  const m = await menu(pagina)
  const grupo = m.find((g) => g.grupo === 'Requerimiento de Administración')
  comprobar(grupo && grupo.items.join(',') === 'Requerimientos,Atención de requerimiento,Órdenes de compra,Stock en almacén',
    `su menú tiene el requerimiento de Administración: ${JSON.stringify(grupo?.items)}`)
  await pagina.goto(`${BASE}/requerimientos`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('nav[aria-label="Requerimiento"] [aria-current="page"]').innerText()).startsWith('Administración'),
    'abre en la pestaña «Administración»')
  await pagina.getByRole('button', { name: 'Nuevo requerimiento de Administración' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  const areas = await opciones(ventana.locator('#rq-area'))
  comprobar(areas.includes('Recursos Humanos') && areas.includes('Servicios de apoyo') && areas.includes('Logística') && !areas.includes('Maestranza'),
    `áreas de oficina, sin Maestranza: ${areas.join(', ')}`)
  const r = await registrar(pagina, {
    area: 'Recursos Humanos',
    codigo: 'OFICINA',
    justificacion: 'Útiles para la oficina de RR. HH. del banco.',
    insumos: [[`Papel bond A4 ${sello}`, 3], [`Tóner de impresora ${sello}`, 2]],
  })
  rqa = r.numero
  comprobar(/^RQA-/.test(rqa), `RQA registrado con su serie: «${r.aviso}»`)
  await pagina.waitForTimeout(800)
  // Desde #128 cada RQ es una tarjeta (`data-rq`), no una fila.
  const fila = pagina.locator(`[data-rq="${rqa}"]`)
  comprobar((await texto(fila)).includes('Administración') && (await texto(fila)).includes('Por revisar'), 'la tarjeta dice Administración y «Por revisar»')
  comprobar((await pagina.locator(`[data-rq="${rq}"]`).count()) === 0, 'en su pestaña no aparece el RQ de operación')
  comprobar(errores.length === 0, `sin errores de consola como la administradora ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 3. Almacén revisa insumo por insumo
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
  const avisos = await pagina.goto(`${BASE}/avisos`, { waitUntil: 'networkidle' }).then(() => pagina.locator('body').innerText())
  comprobar(avisos.includes(`Requerimiento por revisar: ${rq}`) && avisos.includes(`Requerimiento por revisar: ${rqa}`), 'a Almacén le llegaron los dos')
  await pagina.goto(`${BASE}/requerimientos/atencion`, { waitUntil: 'networkidle' })
  let fila = pagina.locator('tbody tr', { hasText: rq })
  const resumen = await revisarStock(pagina, fila, [5, 2, 0], 'De electrodo queda media caja')
  comprobar(resumen.includes('Se compran 2 de 3 insumos') && resumen.includes('Logística'), `la ventana avisa qué se compra: «${resumen}»`)
  fila = pagina.locator('tbody tr', { hasText: rq })
  const t = await texto(fila)
  comprobar(t.includes('Por comprar'), 'el RQ queda «Por comprar»')
  comprobar(t.includes('Almacén lo tiene'), 'el disco: «Almacén lo tiene»')
  comprobar(t.includes('Almacén tiene 2 UND, se compran 2'), `el electrodo: tiene 2, se compran 2 (${t.slice(0, 260)})`)

  let filaA = pagina.locator('tbody tr', { hasText: rqa })
  const resumenA = await revisarStock(pagina, filaA, [3, 0])
  comprobar(resumenA.includes('la administradora'), `en el RQA, lo que falta va a la administradora: «${resumenA}»`)
  filaA = pagina.locator('tbody tr', { hasText: rqa })
  comprobar((await texto(filaA)).includes('Por comprar'), 'el RQA queda «Por comprar»')
  await pagina.screenshot({ path: `${CAPTURAS}/dos-rq-almacen.png`, fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola como Almacén ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 4. Logística: solo el de operación, solo lo que falta
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.logistica)
  const avisos = await pagina.goto(`${BASE}/avisos`, { waitUntil: 'networkidle' }).then(() => pagina.locator('body').innerText())
  comprobar(avisos.includes(`Requerimiento por comprar: ${rq}`), `a Logística le llegó ${rq} por comprar`)
  comprobar(!avisos.includes(rqa), `y no le llegó el ${rqa}`)
  await pagina.goto(`${BASE}/requerimientos/atencion`, { waitUntil: 'networkidle' })
  const filaA = pagina.locator('tbody tr', { hasText: rqa })
  comprobar((await filaA.getByRole('button').count()) === 0, 'en el RQA no tiene botones')
  const fila = pagina.locator('tbody tr', { hasText: rq })
  comprobar((await fila.getByRole('button', { name: 'Lo estoy comprando' }).count()) === 1, 'en el RQ tiene «Lo estoy comprando»')
  await fila.getByRole('button', { name: 'Generar OC' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  comprobar(await ventana.locator('input[name="item"][value="1"]').isDisabled(), 'el disco que Almacén tiene no se puede marcar')
  comprobar(!(await ventana.locator('input[name="item"][value="1"]').isChecked()), 'y no viene marcado')
  const tv = await texto(ventana)
  comprobar(tv.includes('Almacén lo tiene: no se compra.'), 'dice que Almacén lo tiene')
  comprobar(tv.includes('Pidieron 4; Almacén tiene 2: se compra el resto.'), 'el electrodo, por lo que falta')
  comprobar(await ventana.locator('input[name="item"][value="3"]').isChecked(), 'la plancha viene marcada')
  await pagina.screenshot({ path: `${CAPTURAS}/dos-rq-oc-logistica.png`, fullPage: true })
  await pagina.keyboard.press('Escape')
  comprobar(errores.length === 0, `sin errores de consola como Logística ${errores.join(' | ')}`)
  await contexto.close()
}

// ------------------------------------------------ 5. La administradora compra lo suyo
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.administracion)
  const avisos = await pagina.goto(`${BASE}/avisos`, { waitUntil: 'networkidle' }).then(() => pagina.locator('body').innerText())
  comprobar(avisos.includes(`Requerimiento por comprar: ${rqa}`), `a la administradora le llegó ${rqa} por comprar`)
  await pagina.goto(`${BASE}/requerimientos/atencion`, { waitUntil: 'networkidle' })
  const filaO = pagina.locator('tbody tr', { hasText: rq })
  comprobar((await filaO.getByRole('button').count()) === 0, 'en el RQ de operación no tiene botones')
  const fila = pagina.locator('tbody tr', { hasText: rqa })
  await fila.getByRole('button', { name: 'Generar OC' }).click()
  const ventana = pagina.locator('[role="dialog"]')
  comprobar(await ventana.locator('input[name="item"][value="1"]').isDisabled(), 'el papel que Almacén tiene no se puede marcar')
  await ventana.locator('#ocd-proveedor').click()
  await pagina.locator('[role="option"]').first().click()
  await ventana.locator('[id^="ocd-mat-"]').first().click()
  await pagina.locator('[role="option"]').first().click()
  await ventana.locator('[id^="ocd-cant-"]').first().fill('2')
  await ventana.locator('[id^="ocd-precio-"]').first().fill('85')
  await ventana.getByRole('button', { name: 'Emitir orden de compra' }).click()
  await ventana.waitFor({ state: 'detached', timeout: 30000 })
  await pagina.locator('[role="status"]').first().waitFor({ timeout: 20000 })
  const aviso = await pagina.locator('[role="status"]').first().innerText()
  const oc = (aviso.match(/OC-\d+-MW/) ?? [''])[0]
  comprobar(oc !== '', `la administradora emitió la OC del RQA: «${aviso}»`)
  await pagina.waitForTimeout(800)
  const t = await texto(pagina.locator('tbody tr', { hasText: rqa }))
  comprobar(t.includes('En compra') && t.includes(oc), `el RQA queda «En compra» con la ${oc}`)
  comprobar((await pagina.locator('tbody tr', { hasText: rqa }).getByRole('button', { name: 'Generar OC' }).count()) === 0, 'ya no queda nada por comprar')
  await pagina.screenshot({ path: `${CAPTURAS}/dos-rq-administradora.png`, fullPage: true })
  await pagina.goto(`${BASE}/compras/ordenes`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('tbody tr', { hasText: oc }).count()) >= 1, `la ${oc} aparece en sus órdenes de compra`)
  comprobar(errores.length === 0, `sin errores de consola como la administradora ${errores.join(' | ')}`)
  await contexto.close()
}

await navegador.close()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} comprobación(es) fallaron.`)
  process.exit(1)
}
console.log('\nTodo bien: los dos requerimientos y la revisión por insumo, con clic real.')
