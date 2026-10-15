/**
 * Clic real sobre el porcentaje de avance de cada código interno en Gerencia
 * (migración 20261016300000), con la cuenta de cada puesto (nunca ADMIN):
 *
 *   1. Gerencia ve en la lista el porcentaje de cada código y de dónde sale:
 *      por las etapas de Diseño, por el reporte diario si no hay etapas, 0 %
 *      si no hay ni lo uno ni lo otro; PLANTA sin porcentaje.
 *   2. En el detalle, el mismo porcentaje arriba; en «Avance», cómo sale etapa
 *      por etapa, y cada trabajo con su área («Soldadura» de dos áreas son dos).
 *   3. Todas las pestañas del código abren sin error y dan las mismas cifras
 *      que el circuito: costo, horas, servicios, subcontratos, factura y cobro.
 *   4. Las otras cuentas no entran a Códigos internos.
 *
 * Necesita la base que deja `herramientas/recorrido/circuito-codigo-interno.sql`
 * guardada (sin el rollback del final) y los códigos de ejemplo de cada caso.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CORREOS (JSON puesto → correo).
 */
import { mkdirSync } from 'node:fs'

import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CORREOS = JSON.parse(process.env.CORREOS ?? '{}')
if (!CLAVE || !CORREOS.GERENTE) {
  console.error('Faltan BANCO_CLAVE o CORREOS con la cuenta de GERENTE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const ENSAYO = 'ENSAYO_GERENCIA_26/99'
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
const detalle = (codigo, vista) => `${BASE}/codigos-internos/detalle?${new URLSearchParams({ codigo, ...(vista ? { vista } : {}) })}`
const fila = (pagina, codigo) => pagina.locator(`[data-codigo="${codigo}"]`)

// ============================================ 1. La lista de Gerencia
{
  const { pagina, contexto, errores } = await entrar(CORREOS.GERENTE)
  await pagina.goto(`${BASE}/codigos-internos`, { waitUntil: 'networkidle' })
  const casos = [
    [ENSAYO, '33', 'Por sus 4 etapas de Diseño: 1 terminada'],
    ['BANCO_REPORTES_26/01', '60', 'Por el reporte diario, sin etapas de Diseño: 1 de 2 trabajos terminados'],
    ['BANCO_DISENO_26/03', '50', 'Por sus 2 etapas de Diseño: 1 terminada'],
    ['BANCO_NADA_26/02', '0', 'Sin etapas de Diseño ni reporte diario'],
  ]
  for (const [codigo, pct, origen] of casos) {
    const f = fila(pagina, codigo)
    comprobar((await f.count()) === 1, `${codigo} está en la lista`)
    comprobar((await f.locator('[data-avance]').getAttribute('data-avance')) === pct, `${codigo} va al ${pct} %`)
    comprobar((await f.getByRole('progressbar').getAttribute('aria-valuenow')) === pct, `${codigo}: la barra dice ${pct} %`)
    comprobar((await texto(f)).includes(origen), `${codigo}: «${origen}»`)
  }
  const planta = fila(pagina, 'PLANTA')
  comprobar((await planta.count()) === 1 && (await planta.getByRole('progressbar').count()) === 0, 'PLANTA sale sin barra de avance')
  comprobar((await texto(planta)).includes('PLANTA no es una unidad: no lleva avance'), 'PLANTA dice por qué')
  comprobar((await texto(fila(pagina, ENSAYO))).includes('S/ 2,865.00'), 'el costo del código del circuito es S/ 2,865.00')
  await pagina.screenshot({ path: `${CAPTURAS}/avance-lista.png`, fullPage: true })

  // ============================================ 2. El detalle y cómo sale el porcentaje
  await fila(pagina, ENSAYO).click()
  await pagina.waitForURL((u) => u.pathname === '/codigos-internos/detalle', { timeout: 30000 })
  await pagina.waitForLoadState('networkidle')
  comprobar((await pagina.locator('[data-avance]').first().getAttribute('data-avance')) === '33', 'el detalle dice 33 % arriba, lo mismo que la lista')
  const comoSale = pagina.locator('[data-como-sale]')
  comprobar((await texto(comoSale)).includes('Cómo sale el 33 %'), '«Cómo sale el 33 %»')
  const vale = await comoSale.locator('[data-etapa]').evaluateAll((ls) => ls.map((l) => `${l.dataset.etapa}=${l.dataset.vale}`))
  comprobar(
    vale.join(' | ') === 'Habilitado=100 | Armado y soldadura=30 | Arenado y pintura=0 | Entrega=0',
    `cada etapa con lo que vale: ${vale.join(' | ')}`,
  )
  const trabajos = await pagina.locator('[data-trabajo]').evaluateAll((ls) => ls.map((l) => `${l.dataset.trabajo}@${l.dataset.area}`))
  comprobar(trabajos.length === 4, `4 trabajos, cada uno con su área: ${trabajos.join(', ')}`)
  comprobar(trabajos.filter((t) => t.startsWith('Soldadura@')).length === 2, 'la Soldadura de Maestranza y la de Producción van aparte')
  await pagina.screenshot({ path: `${CAPTURAS}/avance-detalle.png`, fullPage: true })

  // ============================================ 3. Todas las pestañas
  const esperado = {
    etapas: ['Etapas de la unidad', '1 de 4 terminadas'],
    planos: ['001', 'Estructura del chasis'],
    materiales: ['Disco de corte 7 pulgadas (ensayo)'],
    costeo: ['S/ 100.00', 'S/ 65.00', 'S/ 1,200.00', 'S/ 1,500.00', 'Por aprobar', 'Por pagar'],
    personal: ['2 personas', '12 h'],
    documentos: ['9999-2099', 'Entregado'],
    facturacion: ['E999-9999999', 'S/ 29,500.00', 'S/ 10,000.00'],
  }
  for (const [vista, frases] of Object.entries(esperado)) {
    const respuesta = await pagina.goto(detalle(ENSAYO, vista), { waitUntil: 'networkidle' })
    const cuerpo = await texto(pagina.locator('main'))
    comprobar(respuesta?.status() === 200 && !cuerpo.includes('Algo salió mal'), `la pestaña «${vista}» abre`)
    for (const frase of frases) comprobar(cuerpo.includes(frase), `«${vista}» muestra «${frase}»`)
    comprobar((await pagina.locator('[data-avance]').first().getAttribute('data-avance')) === '33', `«${vista}» mantiene el 33 % arriba`)
  }

  await pagina.goto(detalle('BANCO_REPORTES_26/01'), { waitUntil: 'networkidle' })
  const cuerpo = await texto(pagina.locator('main'))
  comprobar(cuerpo.includes('Cómo sale el 60 %') && cuerpo.includes('Diseño todavía no armó las etapas'), 'sin etapas, el detalle explica que sale del reporte diario')
  await pagina.goto(detalle('BANCO_NADA_26/02'), { waitUntil: 'networkidle' })
  comprobar((await texto(pagina.locator('main'))).includes('Avance en 0 %'), 'sin etapas ni reportes, el detalle dice 0 % y por qué')
  await pagina.goto(detalle('PLANTA'), { waitUntil: 'networkidle' })
  comprobar((await texto(pagina.locator('main'))).includes('PLANTA no lleva avance'), 'PLANTA no lleva avance en el detalle')

  // En el teléfono: el porcentaje se lee sin desplazar de lado.
  const telefono = await entrar(CORREOS.GERENTE, 390)
  await telefono.pagina.goto(`${BASE}/codigos-internos`, { waitUntil: 'networkidle' })
  const ancho = await telefono.pagina.evaluate(() => document.documentElement.scrollWidth)
  comprobar(ancho <= 390, `en el teléfono la lista no se sale de lado (${ancho} px)`)
  await telefono.pagina.screenshot({ path: `${CAPTURAS}/avance-telefono.png`, fullPage: true })
  await telefono.contexto.close()

  comprobar(errores.length === 0, `sin errores en la consola de Gerencia${errores.length ? `: ${errores.join(' / ')}` : ''}`)
  await contexto.close()
}

// ============================================ 4. Las otras cuentas no entran
for (const [puesto, correo] of Object.entries(CORREOS)) {
  if (puesto === 'GERENTE') continue
  const { pagina, contexto } = await entrar(correo)
  await pagina.goto(`${BASE}/codigos-internos`, { waitUntil: 'networkidle' })
  const lista = pagina.url().includes('/sin-permiso') && (await pagina.locator('[data-codigo]').count()) === 0
  await pagina.goto(detalle(ENSAYO), { waitUntil: 'networkidle' })
  const unCodigo = pagina.url().includes('/sin-permiso') && (await pagina.locator('[data-avance]').count()) === 0
  comprobar(lista && unCodigo, `${puesto} no entra a Códigos internos ni a un código`)
  await contexto.close()
}

await navegador.close()
if (fallas.length > 0) {
  console.error(`\n${fallas.length} falla(s).`)
  process.exit(1)
}
console.log('\nTodo pasa.')
