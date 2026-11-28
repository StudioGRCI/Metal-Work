/**
 * Las capturas de «Cómo atender una avería», con la cuenta de prueba de
 * Mantenimiento (`mantenimiento.local@metalwork.test`) en el banco local.
 *
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-atender-una-averia/capturar.mjs horizontal
 *
 * Antes, el banco recién preparado (`herramientas/banco/preparar.sh`).
 * Fuera de cámara: el supervisor de Maestranza reporta, con su sesión, que la
 * inversora MS-03 se apaga sola y detiene el trabajo. En cámara, Mantenimiento
 * la ve primero en su bandeja, anota el diagnóstico y la cierra con el trabajo
 * hecho: el equipo vuelve a operativo y a quien la reportó le llega el aviso.
 */
import { conectar } from '../../scripts/banco.mjs'
import { abrir, cenido, cerrar, formatoPedido } from '../../scripts/captura.mjs'

const formato = formatoPedido()
if (formato !== 'horizontal') {
  console.error('Este video se entrega solo en horizontal.')
  process.exit(2)
}
const EQUIPO = 'MS-03'
const FALLA = 'Se apaga sola a los cinco minutos de soldar.'
const DIAGNOSTICO = 'Relé térmico que corta antes de tiempo y ventilador trabado.'
const TRABAJO = 'Se cambió el relé térmico y se destrabó el ventilador; se probó media hora.'

const b = await conectar()
const [equipo] = await b.consulta('select id::text, estado from public.equipos where codigo = $1', [EQUIPO])
if (!equipo) throw new Error(`Falta el equipo ${EQUIPO} en el banco: rehaz el banco con preparar.sh.`)
if (equipo.estado !== 'OPERATIVO') throw new Error(`${EQUIPO} no está operativo en el banco: rehaz el banco con preparar.sh.`)
const id = crypto.randomUUID()
const [reporte] = await b.como('sup.mtz', `select * from public.averias_reportar($1, $2, 'AVERIA', true, false, $3, '[]')`, [id, equipo.id, FALLA])
const NUMERO = reporte.numero_averia

const { pagina, ir, tomar } = await abrir({ video: import.meta.url, formato, cuenta: 'mantenimiento' })
const ventana = () => pagina.getByRole('dialog')

// 1. La bandeja: primero lo que detiene el trabajo.
await ir('/averias')
const menu = pagina.locator('nav[aria-label="Menú principal"]').getByRole('link', { name: /^Averías/ }).first()
const fila = pagina.locator(`tr[data-averia="${NUMERO}"]`)
await tomar('01-bandeja', { fila, menu })

// 2. La ficha: qué reportaron y quién la tiene.
await ir(`/averias/${id}`)
const quien = pagina.locator('[data-quien-la-tiene]')
const atender = pagina.locator('[data-atender-averia]')
await tomar('02-ficha', { quien: cenido(quien), falla: cenido(pagina.getByText(FALLA).first()), atender }, { arriba: pagina.locator('main h1') })

// 3. El diagnóstico.
await atender.click()
await ventana().waitFor()
const diagnostico = ventana().getByRole('textbox', { name: /^Diagnóstico/ })
await diagnostico.fill(DIAGNOSTICO)
const botonAtender = ventana().getByRole('button', { name: 'Atender' })
await tomar('03-diagnostico', { diagnostico, enviar: botonAtender })
await botonAtender.click()
await ventana().waitFor({ state: 'hidden', timeout: 30000 })
const verde1 = pagina.locator('p[role="status"]', { hasText: /Diagnóstico anotado/ }).first()
await verde1.waitFor({ timeout: 30000 })
await tomar('04-en-atencion', { verde: cenido(verde1) })

// 4. Cerrar con el trabajo hecho.
const cerrarla = pagina.locator('[data-cerrar-averia]')
await tomar('05-cerrar', { cerrar: cerrarla })
await cerrarla.click()
await ventana().waitFor()
const trabajo = ventana().getByRole('textbox', { name: /^Trabajo hecho/ })
await trabajo.fill(TRABAJO)
const horas = ventana().getByRole('textbox', { name: /^Horas parado/ })
await horas.fill('1')
const botonCerrar = ventana().getByRole('button', { name: 'Cerrar la avería' })
await tomar('06-trabajo', { trabajo, horas, enviar: botonCerrar })
await botonCerrar.click()
await ventana().waitFor({ state: 'hidden', timeout: 30000 })
const verde2 = pagina.locator('p[role="status"]', { hasText: /operativo/ }).first()
await verde2.waitFor({ timeout: 30000 })
await tomar('07-cerrada', { verde: cenido(verde2) })

await cerrar()
await b.cerrar()
console.log(`Capturas de ${formato} listas. Avería de prueba: ${NUMERO}.`)
