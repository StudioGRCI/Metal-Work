/**
 * Las capturas de «Cómo responder una nota de entrega», con la cuenta de
 * prueba de Almacén (`almacen.local@metalwork.test`) en el banco local.
 *
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-responder-una-nota-de-entrega/capturar.mjs horizontal
 *
 * Antes, el banco recién preparado y con las unidades de prueba:
 *
 *   BANCO_CLAVE='…' ./herramientas/banco/preparar.sh
 *   psql -h /tmp -p 5433 -U postgres -d mw_demo -f herramientas/banco/sembrar-diseno-por-codigo.sql
 *
 * Fuera de cámara (`sembrar.mjs`): el supervisor de Maestranza pide 6 discos,
 * Almacén los saca con su foto y el supervisor anota que llegaron 4 de 6.
 * En cámara, Almacén ve el aviso, lee la nota y la cierra diciendo qué hizo.
 */
import { abrir, cenido, cerrar, formatoPedido } from '../../scripts/captura.mjs'
import { sembrar } from './sembrar.mjs'

const formato = formatoPedido()
if (formato !== 'horizontal') {
  console.error('Este video se entrega solo en horizontal.')
  process.exit(2)
}
const RESPUESTA = 'Repuse los 2 discos que faltaban con otra salida, y el soldador los recibió.'

const s = await sembrar()
const { pagina, ir, tomar } = await abrir({ video: import.meta.url, formato, cuenta: 'almacen' })

// 1. El aviso en la campana.
await ir('/requerimientos/atencion')
const campana = pagina.locator('button[aria-label^="Avisos"]').first()
await campana.click()
const panel = pagina.locator('#panel-avisos')
await panel.waitFor()
const aviso = panel.locator('li, a, article', { hasText: `Llegó incompleto: ${s.numero}` }).last()
await aviso.waitFor()
await tomar('01-campana', { aviso, campana })
await pagina.keyboard.press('Escape')
await ir('/requerimientos/atencion')

// 2. La nota, arriba de Atención.
const tarjeta = pagina.locator('[data-notas-de-entregas]')
const nota = tarjeta.locator('[data-nota]').first()
await nota.waitFor()
const cuantas = pagina.locator('[data-esperan-por-ti]')
await tomar('02-nota', { nota, cuantas }, { arriba: pagina.locator('main h1') })
const insignia = nota.getByText(/^Llegó 4 de 6/)
const dice = nota.getByText(/^«/)
await tomar('03-que-dice', { insignia, dice: cenido(dice) }, { arriba: pagina.locator('main h1') })

// 3. La foto de la salida y quién recibió.
const foto = nota.getByRole('link', { name: /Ver foto/ })
const salio = nota.getByText(/^Salió/)
await tomar('04-foto', { salio: cenido(salio), foto }, { arriba: pagina.locator('main h1') })

// 4. Responder: qué hizo Almacén. Lo que escribe cierra la nota.
const responder = nota.locator('[data-responder-nota]')
await tomar('05-responder', { responder }, { arriba: pagina.locator('main h1') })
await responder.click()
const dialogo = pagina.locator('[role="dialog"]')
await dialogo.waitFor()
const texto = dialogo.locator('textarea')
await texto.fill(RESPUESTA)
await texto.blur()
const cerrarNota = dialogo.getByRole('button', { name: 'Cerrar la nota' })
await tomar('06-que-hiciste', { texto, cerrarNota })
await cerrarNota.click()
await dialogo.waitFor({ state: 'detached', timeout: 20000 })
const cerrada = pagina.locator('[data-nota-cerrada]')
await cerrada.waitFor({ timeout: 20000 })
const [{ n }] = await s.consulta(
  `select count(*)::int as n from public.conformidad_salidas where requerimiento_id = $1 and atendido_en is not null`,
  [s.rq],
)
if (n !== 1) throw new Error('La nota no quedó cerrada en la base.')
await tomar('07-cerrada', { cerrada: cenido(cerrada) }, { arriba: pagina.locator('main h1') })

await s.cerrar()
await cerrar()
console.log(`Capturas de ${formato} listas. RQ de prueba: ${s.numero}.`)
