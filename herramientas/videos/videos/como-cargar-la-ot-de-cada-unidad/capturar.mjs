/**
 * Las capturas de «Cómo cargar la OT de cada unidad», con la cuenta de prueba
 * de Administración (`administracion.local@metalwork.test`) en el banco local.
 *
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-cargar-la-ot-de-cada-unidad/capturar.mjs horizontal
 *
 * Antes, el banco recién preparado (`BANCO_CLAVE='…' ./herramientas/banco/preparar.sh`).
 *
 * Fuera de cámara, Ventas sube una cotización INVENTADA de tres camabajas para
 * un cliente de los datos de demostración y Gerencia la aprueba. Después, en
 * cámara, Administración carga la OT de cada una de las tres unidades, cada
 * una con su código interno y su PDF, también inventados. Cada formato hace el
 * recorrido entero: para que los dos salgan con los mismos números, rehacer el
 * banco entre uno y otro.
 *
 * Ningún documento trae RUC: en el video no sale ninguno. El monto es
 * inventado y se declara abajo con las mismas constantes con que se escribe:
 * la revisión automática deja pasar solo ese.
 */
import { abrir, cenido, cerrar, entrar, formatoPedido, pdfConTexto } from '../../scripts/captura.mjs'

const formato = formatoPedido()
const NUMERO = '9001-2026'
const CLIENTE = 'TRANSPORTES ANDINOS S.A.C.' // de los datos de demostración del banco
const UNIDADES = 3
const MONEDA = 'USD'
const TOTAL = 135000 // inventado: 45 000 por unidad
const dinero = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ORDENES = [
  { numero: '9101-2026', codigo: 'CMB_SR_O3_4_26/901', entrega: '10 de febrero de 2027' },
  { numero: '9102-2026', codigo: 'CMB_SR_O3_4_26/902', entrega: '24 de febrero de 2027' },
  { numero: '9103-2026', codigo: 'CMB_SR_O3_4_26/903', entrega: '10 de marzo de 2027' },
]

// Los documentos se arman aquí y se le dan al navegador en memoria: no hay archivo que guardar.
const pdf = (name, lineas) => ({ name, mimeType: 'application/pdf', buffer: pdfConTexto(lineas) })
const archivoCotizacion = pdf(`Cotización ${NUMERO}.pdf`, [
  `COTIZACION N° ${NUMERO.replace('-', '- ')}`,
  'Fecha : 26/11/2026',
  `Señores : ${CLIENTE}`,
  'SEMIRREMOLQUE CAMA BAJA 3 EJES - SUSPENSION MECANICA',
  `CANTIDAD : 0${UNIDADES} UNIDADES`,
  `TOTAL US$ ${dinero(TOTAL)}`,
  'PRECIO NO INCLUYE IGV',
  'Documento de prueba del banco local de Metal Work.',
])
const archivoOrden = (orden) =>
  pdf(`OT ${orden.numero}.pdf`, [
    `ORDEN DE TRABAJO N ${orden.numero}`,
    `CLIENTE: ${CLIENTE}`,
    'PRODUCTO: SEMIRREMOLQUE CAMA BAJA 3 EJES',
    `FECHA DE ENTREGA DE LA UNIDAD: ${orden.entrega}`,
    'Documento de prueba del banco local de Metal Work.',
  ])

// Fuera de cámara: Ventas la sube…
{
  const ventas = await entrar('ventas')
  await ventas.ir('/cotizaciones/pdf')
  await ventas.pagina.getByRole('button', { name: 'Subir cotización' }).click()
  const ventana = ventas.pagina.getByRole('dialog')
  await ventana.waitFor()
  const campo = (id) => ventana.locator(`#cot-${id}`)
  await campo('archivo').setInputFiles(archivoCotizacion)
  await ventana.locator('[role="status"]').filter({ hasText: 'Leído del archivo' }).waitFor({ timeout: 30000 })
  await ventas.pagina.waitForFunction(() => document.querySelector('#cot-unidades')?.value === '3', null, { timeout: 30000 })
  if (!(await campo('moneda').inputValue())) await campo('moneda').selectOption(MONEDA)
  if (!(await campo('igv').inputValue())) await campo('igv').selectOption('no')
  if (!(await campo('monto').inputValue())) await campo('monto').fill(TOTAL.toFixed(2))
  if (!(await campo('cliente').inputValue())) await campo('cliente').selectOption({ label: CLIENTE })
  if (!(await campo('carroceria').inputValue())) await campo('carroceria').selectOption({ label: 'Cama baja' })
  await ventana.getByRole('button', { name: 'Subir y mandar a Gerencia' }).click()
  await ventana.waitFor({ state: 'hidden', timeout: 30000 })
  await ventas.contexto.close()
}
// … y Gerencia la aprueba con un toque.
{
  const gerencia = await entrar('gerencia')
  await gerencia.ir('/cotizaciones/pdf?estado=POR_REVISAR')
  const suya = gerencia.pagina.locator('li[id]', { hasText: NUMERO }).first()
  await suya.getByRole('button', { name: 'Aprobar', exact: true }).click()
  await suya.getByText(/Falta que Administración/).waitFor({ timeout: 30000 })
  await gerencia.contexto.close()
}

const { pagina, ir, tomar } = await abrir({
  video: import.meta.url,
  formato,
  cuenta: 'administracion',
  // El total de la cotización inventada y su promedio por unidad, que la tarjeta calcula.
  montosInventados: [
    { moneda: MONEDA, valor: TOTAL },
    { moneda: MONEDA, valor: TOTAL / UNIDADES },
  ],
})
const tarjeta = pagina.locator('li[id]', { hasText: NUMERO }).first()
const ventana = pagina.getByRole('dialog')
const codigo = ventana.locator('input[name="codigo_interno"]')
const numero = ventana.locator('input[name="numero"]')
const guardar = ventana.getByRole('button', { name: 'Guardar código y OT' })
const botonDeLa = (cual) => tarjeta.getByRole('button', { name: `Cargar la OT ${cual} de ${UNIDADES}` })
const ordenes = tarjeta.locator(`ul[aria-label="OT de las ${UNIDADES} unidades"]`)

/** Abre la ventana de la unidad `cual` y elige su PDF; el código y el guardado quedan para quien llama. */
async function abrirLaDe(cual) {
  await ir('/cotizaciones/pdf')
  await botonDeLa(cual).click()
  await ventana.waitFor()
}
async function elegirPdf(orden) {
  await ventana.locator('input[type="file"]').setInputFiles(archivoOrden(orden))
  await ventana.getByText(/Datos leídos del PDF|No se reconocieron|No se pudo leer/).waitFor({ timeout: 30000 }).catch(() => {})
  if (!(await numero.inputValue())) await numero.fill(orden.numero)
  const tipo = ventana.locator('select[name="tipo_unidad"]')
  if (!(await tipo.inputValue())) await tipo.selectOption('SEMIRREMOLQUE')
}
async function guardarYEsperar() {
  await guardar.click()
  await ventana.waitFor({ state: 'hidden', timeout: 30000 })
}

// 1. La cotización aprobada: dice cuántas unidades lleva y ofrece cargar la primera OT.
await ir('/cotizaciones/pdf')
await tarjeta.waitFor()
await tomar(
  '01-aprobada',
  {
    boton: botonDeLa(1),
    unidades: cenido(tarjeta.getByText(`${UNIDADES} unidades`).first().locator('xpath=..')),
    // En el monitor, el menú; en el teléfono, la pestaña de abajo.
    entrada:
      formato === 'horizontal'
        ? pagina.locator('nav[aria-label="Menú principal"]').getByRole('link', { name: 'Cotización' })
        : pagina.getByRole('link', { name: 'Cotizar' }).last(),
  },
  { arriba: formato === 'horizontal' ? undefined : tarjeta },
)

// 2. La ventana dice qué unidad se está cargando.
await botonDeLa(1).click()
await ventana.waitFor()
await tomar('02-ventana', { titulo: cenido(ventana.locator('h2').first()) })

// 3. El código interno de esta unidad.
await codigo.fill(ORDENES[0].codigo)
await tomar('03-codigo', { codigo })

// 4. El PDF de la OT: el sistema lee su número y la fecha de entrega.
await elegirPdf(ORDENES[0])
await tomar('04-pdf', {
  pdf: ventana.getByText('haz clic para cambiarlo').locator('xpath=ancestor::*[self::label or self::button or self::div][1]'),
  leido: ventana.getByText('Datos leídos del PDF'),
  numero,
})
await tomar('05-fecha', { fecha: ventana.locator('input[name="fecha_entrega"]') })

// 5. Guardar.
await tomar('06-guardar', { guardar })
await guardarYEsperar()

// 6. La tarjeta ya tiene la primera y ofrece la segunda.
await ir('/cotizaciones/pdf')
await ordenes.waitFor({ timeout: 20000 })
await tomar('07-primera', { ordenes: cenido(ordenes), boton: botonDeLa(2) }, { arriba: formato === 'horizontal' ? undefined : tarjeta })

// 7. La segunda: la ventana recuerda el código de la primera, y uno repetido no entra.
await botonDeLa(2).click()
await ventana.waitFor()
await codigo.fill(ORDENES[0].codigo)
await elegirPdf(ORDENES[1])
await tomar('08-otras', { otras: cenido(ventana.getByText('Ya tienen código:')) })
await guardar.click()
await ventana.getByText(/cada unidad lleva su propio código/).waitFor({ timeout: 30000 })
await tomar('09-repetido', { codigo, error: cenido(ventana.getByText(/cada unidad lleva su propio código/)) })
await codigo.fill(ORDENES[1].codigo)
await guardarYEsperar()

// La tercera, sin cámara.
await abrirLaDe(3)
await codigo.fill(ORDENES[2].codigo)
await elegirPdf(ORDENES[2])
await guardarYEsperar()

// 8. Las tres unidades, cada una con su código y su OT.
await ir('/cotizaciones/pdf')
await ordenes.waitFor({ timeout: 20000 })
await tomar('10-todas', { ordenes: cenido(ordenes) }, { arriba: tarjeta })

await cerrar()
console.log(`Capturas de ${formato} listas. Cotización de prueba: ${NUMERO}.`)
