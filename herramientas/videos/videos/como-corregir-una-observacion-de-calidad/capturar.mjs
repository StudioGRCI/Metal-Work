/**
 * Las capturas de «Cómo corregir una observación de Calidad», con la cuenta de
 * prueba de Diseño (`diseno.local@metalwork.test`), que en la empresa responde
 * también por el área de Ingeniería.
 *
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-corregir-una-observacion-de-calidad/capturar.mjs horizontal
 *
 * Antes, el banco recién preparado (`herramientas/banco/preparar.sh`).
 * Fuera de cámara: la cuenta de Diseño queda como responsable del área de
 * Ingeniería (como en la empresa) y Calidad observa un trabajo de Ingeniería en
 * el código de la OT 0003. En cámara, Diseño ve el aviso, abre la observación
 * y la marca corregida con su nota.
 */
import { conectar } from '../../scripts/banco.mjs'
import { abrir, cenido, cerrar, formatoPedido } from '../../scripts/captura.mjs'

const formato = formatoPedido()
if (formato !== 'horizontal') {
  console.error('Este video se entrega solo en horizontal.')
  process.exit(2)
}
const OBSERVACION = 'El soporte del tanque no lleva el refuerzo que pide el plano de ingeniería.'
const NOTA = 'Se agregó el refuerzo al plano y se avisó a Maestranza para soldarlo.'

const b = await conectar()
const [orden] = await b.consulta(
  `select u.codigo_interno as codigo from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id where o.numero = '0003-2026'`,
)
if (!orden?.codigo) throw new Error('La OT 0003-2026 del banco no tiene código interno: rehaz el banco con preparar.sh.')
const CODIGO = orden.codigo
const [{ n: ya }] = await b.consulta('select count(*)::int as n from public.calidad_inspecciones where codigo_interno = $1', [CODIGO])
if (ya > 0) throw new Error(`${CODIGO} ya tiene inspecciones en el banco (una inspección no se borra): rehaz el banco con preparar.sh.`)
// Configuración, como en la empresa: Ingeniería la lleva la cuenta de Diseño.
await b.consulta(`update public.areas set jefe_id = (select id from public.usuarios where correo = 'diseno.local@metalwork.test') where codigo = 'ING'`)
const [{ id: ing }] = await b.consulta(`select id::text from public.areas where codigo = 'ING'`)
const ins = crypto.randomUUID()
await b.como('calidad', `select * from public.calidad_inspeccionar($1, $2, null, $3, 'NO_CONFORME', $4, '[]'::jsonb)`, [ins, CODIGO, ing, OBSERVACION])

const { pagina, ir, tomar } = await abrir({ video: import.meta.url, formato, cuenta: 'diseno' })

// 1. El aviso en la campana.
await ir('/calidad')
const campana = pagina.locator('button[aria-label^="Avisos"]').first()
await campana.click()
const panel = pagina.locator('#panel-avisos')
await panel.waitFor()
const aviso = panel.locator('li, a, article', { hasText: 'Calidad observó' }).last()
await aviso.waitFor()
await tomar('01-campana', { aviso, campana })
await pagina.keyboard.press('Escape')

// 2. La lista del área: lo que espera corrección.
await ir('/calidad')
const menu = pagina.locator('nav[aria-label="Menú principal"]').getByRole('link', { name: /^Observaciones de calidad/ })
const fila = pagina.locator(`[data-inspeccion-calidad="${ins}"]`)
await tomar('02-lista', { menu, fila })

// 3. La observación: qué está no conforme.
await ir(`/calidad/${ins}`)
const que = pagina.getByText(OBSERVACION).first()
const marcar = pagina.getByRole('button', { name: 'Marcar corregido' })
await tomar('03-observacion', { que: cenido(que), marcar }, { arriba: pagina.locator('main h1') })

// 4. Marcar corregido, con su nota.
await marcar.click()
const v = pagina.locator('[role="dialog"]', { has: pagina.locator('#calidad-nota') }).last()
await v.waitFor()
await v.locator('#calidad-nota').fill(NOTA)
const enviar = v.getByRole('button', { name: 'Marcar corregido' })
await tomar('04-nota', { nota: v.locator('#calidad-nota'), enviar })
await enviar.click()
await v.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {})
await pagina.waitForLoadState('networkidle')
const [{ estado }] = await b.consulta('select estado from public.calidad_inspecciones where id = $1', [ins])
if (estado !== 'CORREGIDA') throw new Error(`La inspección quedó ${estado}, no CORREGIDA.`)

// 5. Queda en manos de Calidad.
await ir(`/calidad/${ins}`)
const estadoAhora = pagina.locator('main').getByText('Por revisar').first()
await tomar('05-corregida', { estado: cenido(estadoAhora) }, { arriba: pagina.locator('main h1') })

await cerrar()
await b.cerrar()
console.log(`Capturas de ${formato} listas. Observación de prueba en ${CODIGO}.`)
