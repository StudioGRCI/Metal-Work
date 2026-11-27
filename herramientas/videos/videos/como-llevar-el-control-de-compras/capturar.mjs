/**
 * Las capturas de «Cómo llevar el control de compras», con la cuenta de prueba
 * de Almacén (`almacen.local@metalwork.test`) en el banco local.
 *
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-llevar-el-control-de-compras/capturar.mjs horizontal
 *
 * Antes, el banco recién preparado:
 *
 *   BANCO_CLAVE='…' ./herramientas/banco/preparar.sh
 *
 * Fuera de cámara (`sembrar.mjs`): dos OC de hoy para stock, con montos
 * inventados que se declaran; la de electrodos ya se validó en el kardex.
 * En cámara, Almacén ve las compras del día, anota la factura y la guía de
 * los electrodos, mira lo pendiente y la descarga del mes.
 */
import { abrir, cenido, cerrar, formatoPedido } from '../../scripts/captura.mjs'
import { GUIA_ELECTRODOS, MONTOS, sembrar } from './sembrar.mjs'

const formato = formatoPedido()
if (formato !== 'horizontal') {
  console.error('Este video se entrega solo en horizontal.')
  process.exit(2)
}
// Una factura inventada, con la serie como la imprime el proveedor.
const FACTURA = 'F001-4521'

const s = await sembrar()
const { pagina, ir, tomar } = await abrir({ video: import.meta.url, formato, cuenta: 'almacen', montosInventados: MONTOS })
const titulo = pagina.locator('main h1')

// 1. Las compras del día, que salen solas de cada OC.
await ir('/almacen/compras')
const fila = (oc) => pagina.locator(`tr[data-compra="${oc}"]`)
await fila(s.oc.electrodos).waitFor()
const resumen = pagina.locator('[data-resumen-control]')
const menu = pagina.locator('nav[aria-label="Menú principal"]').getByRole('link', { name: /Control de compras/ })
await tomar('01-del-dia', { menu, resumen }, { arriba: titulo })
const tabla = pagina.locator('table').first()
const celda = (oc, n) => fila(oc).locator('td').nth(n)
await tomar('02-filas', { tabla, compra: celda(s.oc.electrodos, 0), destino: celda(s.oc.electrodos, 1), monto: celda(s.oc.electrodos, 2) }, { arriba: titulo })

// 2. Lo que dice el material de cada compra.
const material = (oc) => fila(oc).locator('td').nth(3)
await tomar('03-material', { llego: material(s.oc.electrodos), porVerificar: material(s.oc.discos) }, { arriba: titulo })

// 3. Anotar la factura y la guía que trajo el proveedor.
const anotar = fila(s.oc.electrodos).getByRole('button', { name: /Anotar lo recibido/ })
await tomar('04-anotar', { anotar }, { arriba: titulo })
await anotar.click()
const dialogo = pagina.locator('[role="dialog"]')
await dialogo.waitFor()
const factura = dialogo.locator('[id^="factura-"]')
const guia = dialogo.locator('[id^="guia-"]')
await factura.fill(FACTURA)
await guia.fill(GUIA_ELECTRODOS)
await guia.blur()
const campo = (prefijo) => dialogo.locator(`div:has(label[for^="${prefijo}-"]):has([id^="${prefijo}-"])`).last()
const guardar = dialogo.getByRole('button', { name: 'Guardar' })
await tomar('05-factura', { factura: campo('factura'), guia: campo('guia') })
await tomar('06-guardar', { guardar })
await guardar.click()
await dialogo.waitFor({ state: 'detached', timeout: 20000 })
await ir('/almacen/compras')
const recibio = fila(s.oc.electrodos).locator('td[data-rotulo="Almacén recibió"]')
await recibio.getByText(FACTURA).waitFor()
await tomar('07-anotado', { recibio, sinFactura: resumen.locator('> *').nth(1) }, { arriba: titulo })

// 4. Pendientes: lo que falta de cualquier día, y la descarga del mes.
await ir('/almacen/compras?vista=pendientes')
await fila(s.oc.discos).waitFor()
const pestana = pagina.getByRole('link', { name: /^Pendientes/ }).first()
await tomar('08-pendientes', { pestana, discos: fila(s.oc.discos).locator('td').first() }, { arriba: titulo })
await ir('/almacen/compras')
const descargar = pagina.getByRole('link', { name: /Descargar el mes/ }).or(pagina.getByRole('button', { name: /Descargar el mes/ })).first()
await tomar('09-descargar', { descargar }, { arriba: titulo })

await s.cerrar()
await cerrar()
console.log(`Capturas de ${formato} listas. Compras de prueba: ${s.oc.electrodos} y ${s.oc.discos}.`)
