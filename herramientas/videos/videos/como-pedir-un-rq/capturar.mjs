/**
 * Las capturas de «Cómo pedir un RQ», con la cuenta de prueba del supervisor
 * de Maestranza (`sup.mtz.local@metalwork.test`) en el banco local.
 *
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-pedir-un-rq/capturar.mjs horizontal
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-pedir-un-rq/capturar.mjs horizontal
 *
 * Antes, el banco recién preparado y con las unidades de prueba:
 *
 *   BANCO_CLAVE='…' ./herramientas/banco/preparar.sh
 *   psql -h /tmp -p 5433 -U postgres -d mw_demo -f herramientas/banco/sembrar-diseno-por-codigo.sql
 *
 * Registra un RQ de verdad en el banco (el supervisor lo pide, Almacén revisa
 * el stock fuera de cámara) para que la última pantalla muestre el avance real.
 * Cada formato registra el suyo: para que los dos salgan con el mismo número,
 * rehacer el banco entre uno y otro.
 */
import { abrir, cerrar, entrar, formatoPedido } from '../../scripts/captura.mjs'

const formato = formatoPedido()
const UNIDAD = 'SR-101'
const JUSTIFICACION = 'Armado del chasis: se acabaron los electrodos y los discos del área.'
const INSUMOS = [
  { busca: 'electrodo 7018', cantidad: '10' },
  { busca: 'disco de corte', elige: 'DIS-CORTE', cantidad: '6' },
]

const { pagina, ir, tomar } = await abrir({ video: import.meta.url, formato, cuenta: 'sup.mtz' })

// 1. Por dónde se entra. En el monitor, el menú; en el teléfono, la pestaña.
await ir('/requerimientos')
await tomar('01-entrada', {
  entrada:
    formato === 'horizontal'
      ? pagina.locator('nav[aria-label="Menú principal"]').getByRole('link', { name: 'RQ por unidad' })
      : pagina.locator('main').getByRole('link', { name: /^Por unidad/ }),
})

// 2. La unidad y su botón.
await ir('/requerimientos/unidades')
const nuevo = pagina.getByRole('button', { name: `Nuevo RQ para ${UNIDAD}` })
await tomar('02-unidad', { nuevo })

// 3. El formulario con el código ya puesto y la justificación.
await nuevo.click()
const ventana = pagina.locator('[role="dialog"]')
await ventana.waitFor()
const justificacion = ventana.locator('#rq-justificacion')
await justificacion.fill(JUSTIFICACION)
await justificacion.blur()
await tomar('03-justificacion', { justificacion, codigo: ventana.getByText(UNIDAD, { exact: true }).first().locator('xpath=..') })

// 4. El insumo: se busca en el catálogo de Almacén…
const insumo = (i) => ventana.locator('[id^="rq-mat-"]').nth(i)
const cantidad = (i) => ventana.locator('[id^="rq-cant-"]').nth(i)
await insumo(0).click()
await pagina.keyboard.type(INSUMOS[0].busca, { delay: 15 })
const lista = pagina.locator('[role="listbox"]')
await lista.locator('[role="option"]').first().waitFor()
await tomar('04-buscar', { lista: lista.locator('[role="option"]').first(), buscador: pagina.getByPlaceholder('Nombre o código del material…') })
// … y se pone la cantidad. La unidad de medida sale sola.
await lista.locator('[role="option"]').first().click()
await cantidad(0).fill(INSUMOS[0].cantidad)
await cantidad(0).blur()
await tomar('05-cantidad', { cantidad: cantidad(0), insumo: insumo(0) })

// El segundo insumo, sin detenerse: el video muestra uno.
await ventana.getByRole('button', { name: 'Agregar insumo' }).click()
await insumo(1).click()
await pagina.keyboard.type(INSUMOS[1].busca, { delay: 15 })
await lista.locator('[role="option"]', { hasText: INSUMOS[1].elige }).first().click()
await cantidad(1).fill(INSUMOS[1].cantidad)
await cantidad(1).blur()

// 5. Registrar.
const registrar = ventana.getByRole('button', { name: 'Registrar y mandar a Almacén' })
await tomar('06-registrar', { registrar })
await registrar.click()
const aviso = pagina.locator('[role="status"]').filter({ hasText: /RQ-\d{4}-\d{4}/ }).first()
await aviso.waitFor({ timeout: 20000 })
const numero = (await aviso.innerText()).match(/RQ-\d{4}-\d{4}/)[0]
await ventana.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
await tomar('07-registrado', { aviso })

// Fuera de cámara, Almacén revisa el stock: tiene los electrodos y no los discos.
{
  const almacen = await entrar('almacen')
  await almacen.ir('/requerimientos/atencion')
  await almacen.pagina.locator('tbody tr', { hasText: numero }).getByRole('button', { name: 'Revisar stock' }).click()
  const revision = almacen.pagina.locator('[role="dialog"]')
  await revision.waitFor()
  await revision.locator('input[type="number"]').nth(0).fill(INSUMOS[0].cantidad)
  await revision.locator('input[type="number"]').nth(1).fill('0')
  await revision.getByRole('button', { name: 'Guardar la revisión' }).click()
  await revision.waitFor({ state: 'detached', timeout: 20000 })
  await almacen.contexto.close()
}

// 6. Cómo va: la tarjeta del RQ con la barra de cada insumo.
await ir('/requerimientos')
const tarjeta = pagina.locator(`[data-rq="${numero}"]`)
const etapas = tarjeta.locator('ol[aria-label^="En qué va"]')
await tomar(
  '08-avance',
  { etapas, verde: tarjeta.locator('[data-insumo="1"]'), ambar: tarjeta.locator('[data-insumo="2"]') },
  { arriba: formato === 'horizontal' ? tarjeta : etapas },
)

await cerrar()
console.log(`Capturas de ${formato} listas. RQ de prueba: ${numero}.`)
