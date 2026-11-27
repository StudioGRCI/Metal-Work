/**
 * Las capturas de «Cómo reponer el stock», con la cuenta de prueba de Almacén
 * (`almacen.local@metalwork.test`) en el banco local.
 *
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-reponer-el-stock/capturar.mjs horizontal
 *
 * Antes, el banco recién preparado y con las unidades de prueba:
 *
 *   BANCO_CLAVE='…' ./herramientas/banco/preparar.sh
 *   psql -h /tmp -p 5433 -U postgres -d mw_demo -f herramientas/banco/sembrar-diseno-por-codigo.sql
 *
 * Fuera de cámara (`sembrar.mjs`): los electrodos bajan de su mínimo, avisan y
 * Logística ya los compró; los discos salen mucho y no tienen mínimo. En
 * cámara, Almacén lee el aviso, ve que los electrodos ya vienen y le fija el
 * mínimo y la compra por mayor a los discos, que pasan a «Por reponer».
 */
import { abrir, cerrar, formatoPedido } from '../../scripts/captura.mjs'
import { DISCOS, STOCK, sembrar } from './sembrar.mjs'

const formato = formatoPedido()
if (formato !== 'horizontal') {
  console.error('Este video se entrega solo en horizontal.')
  process.exit(2)
}

const s = await sembrar()
const { pagina, ir, tomar } = await abrir({ video: import.meta.url, formato, cuenta: 'almacen' })
const titulo = pagina.locator('main h1')
const fila = (codigo) => pagina.locator(`tr[data-material="${codigo}"]`)
const celda = (codigo, n) => fila(codigo).locator('td').nth(n)

// 1. El aviso de stock bajo, en la campana.
await ir('/almacen/reposicion')
const campana = pagina.locator('button[aria-label^="Avisos"]').first()
await campana.click()
const panel = pagina.locator('#panel-avisos')
await panel.waitFor()
const aviso = panel.locator('li, a, article', { hasText: `Stock bajo: ${STOCK.electrodos.codigo}` }).last()
await aviso.waitFor()
await tomar('01-aviso', { aviso, campana })

// 2. El aviso lleva al material: ya viene en una OC, no se compra otra vez.
await pagina.keyboard.press('Escape')
await ir(`/almacen/reposicion?vista=todos&q=${STOCK.electrodos.codigo}`)
const electrodos = STOCK.electrodos.codigo
await fila(electrodos).waitFor()
await tomar('02-ya-viene', {
  hay: celda(electrodos, 1),
  minimo: celda(electrodos, 3),
  enCamino: celda(electrodos, 2),
  insignia: fila(electrodos).getByText(/^Bajo el mínimo, ya viene/),
}, { arriba: titulo })

// 3. Lo que sale mucho y no tiene mínimo: nunca avisa.
await ir('/almacen/reposicion?vista=sin-minimo')
const discos = STOCK.discos.codigo
await fila(discos).waitFor()
const pestana = pagina.getByRole('link', { name: /^Sin mínimo/ }).last()
await tomar('03-sin-minimo', { pestana, salio: celda(discos, 4), material: celda(discos, 0) }, { arriba: titulo })
const fijar = fila(discos).getByRole('button', { name: /^Fijar mínimo/ })
await tomar('04-fijar', { fijar }, { arriba: titulo })

// 4. El mínimo y la compra por mayor.
await fijar.click()
const dialogo = pagina.locator('[role="dialog"]')
await dialogo.waitFor()
await dialogo.locator('input[name="minimo"]').fill(String(DISCOS.minimo))
await dialogo.locator('input[name="por_mayor"]').fill(String(DISCOS.porMayor))
await dialogo.locator('input[name="por_mayor"]').blur()
const campo = (prefijo) => dialogo.locator(`div:has(label[for^="${prefijo}-"]):has([id^="${prefijo}-"])`).last()
await tomar('05-minimo', { minimo: campo('minimo'), porMayor: campo('por-mayor') })
const guardar = dialogo.getByRole('button', { name: 'Guardar' })
await tomar('06-guardar', { guardar })
await guardar.click()
await dialogo.waitFor({ state: 'detached', timeout: 20000 })
for (let i = 0; ; i++) {
  const [m] = await s.consulta('select stock_minimo, compra_por_mayor from public.materiales where codigo = $1', [discos])
  if (Number(m.stock_minimo) === DISCOS.minimo && Number(m.compra_por_mayor) === DISCOS.porMayor) break
  if (i > 60) throw new Error('El mínimo de los discos no se guardó en 30 s.')
  await pagina.waitForTimeout(500)
}

// 5. Ya está por reponer, con cuánto comprar.
await ir(`/almacen/reposicion?q=${discos}`)
await fila(discos).waitFor()
await tomar('07-por-reponer', {
  insignia: fila(discos).getByText(/^Bajo el mínimo$/),
  comprar: celda(discos, 5),
}, { arriba: titulo })

await s.cerrar()
await cerrar()
console.log(`Capturas de ${formato} listas. Compra de prueba: ${s.oc}.`)
