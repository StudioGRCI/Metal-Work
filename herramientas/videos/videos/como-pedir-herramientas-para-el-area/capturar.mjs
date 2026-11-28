/**
 * Las capturas de «Cómo pedir herramientas para el área», con la cuenta de
 * prueba de Mantenimiento (`mantenimiento.local@metalwork.test`) en el banco
 * local: un requerimiento del área, que cuenta como gasto operativo.
 *
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-pedir-herramientas-para-el-area/capturar.mjs horizontal
 *
 * Antes, el banco recién preparado (`herramientas/banco/preparar.sh`). Registra
 * un RQ de verdad en el banco: cuatro brocas del catálogo de demostración.
 */
import { abrir, cenido, cerrar, formatoPedido } from '../../scripts/captura.mjs'

const formato = formatoPedido()
if (formato !== 'horizontal') {
  console.error('Este video se entrega solo en horizontal.')
  process.exit(2)
}
const JUSTIFICACION = 'Brocas para el taladro de banco: las de la caja se gastaron.'
const INSUMO = { busca: 'BROCA 1/4', cantidad: '4' }

const { pagina, ir, tomar } = await abrir({ video: import.meta.url, formato, cuenta: 'mantenimiento' })

// 1. Por dónde se entra.
await ir('/requerimientos')
const menu = pagina.locator('nav[aria-label="Menú principal"]').getByRole('link', { name: /^Requerimientos/ })
const nuevo = pagina.getByRole('button', { name: 'Nuevo requerimiento' })
await tomar('01-entrada', { menu, nuevo })

// 2. Para el área: gasto operativo.
await nuevo.click()
const v = pagina.locator('[role="dialog"]')
await v.waitFor()
const paraElArea = v.locator('label', { hasText: /gasto operativo\)/ }).first()
await paraElArea.click()
await tomar('02-para-el-area', { area: paraElArea })

// 3. Para qué lo necesita.
const justificacion = v.locator('#rq-justificacion')
await justificacion.fill(JUSTIFICACION)
await justificacion.blur()
await tomar('03-justificacion', { justificacion })

// 4. El insumo, del catálogo de Almacén, y su cantidad.
const insumo = v.locator('[id^="rq-mat-"]').first()
const cantidad = v.locator('[id^="rq-cant-"]').first()
await insumo.click()
await pagina.keyboard.type(INSUMO.busca, { delay: 15 })
const lista = pagina.locator('[role="listbox"]')
await lista.locator('[role="option"]', { hasText: INSUMO.busca }).first().click()
await cantidad.fill(INSUMO.cantidad)
await cantidad.blur()
await tomar('04-insumo', { insumo, cantidad })

// 5. Registrar.
const registrar = v.getByRole('button', { name: 'Registrar y mandar a Almacén' })
await tomar('05-registrar', { registrar })
await registrar.click()
const verde = pagina.locator('p[role="status"]', { hasText: /RQ-/ }).first()
await verde.waitFor({ timeout: 30000 })
await v.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
const numero = (await verde.innerText()).match(/RQ-[\w-]+/)[0]
await tomar('06-registrado', { verde: cenido(verde) })

// 6. Su tarjeta dice que es gasto operativo.
await ir('/requerimientos')
const tarjeta = pagina.locator(`[data-rq="${numero}"]`)
const insignia = tarjeta.locator('[data-gasto-operativo]')
// Dónde se verá lo gastado cuando Almacén lo entregue (sin abrirla: con montos, la pantalla saldría con cifras).
const gasto = pagina.locator('nav[aria-label="Menú principal"]').getByRole('link', { name: /^Gasto operativo/ })
await tomar('07-tarjeta', { insignia, avance: tarjeta.locator('text=Almacén revisa').first(), gasto }, { arriba: tarjeta })

await cerrar()
console.log(`Capturas de ${formato} listas. RQ de prueba: ${numero}.`)
