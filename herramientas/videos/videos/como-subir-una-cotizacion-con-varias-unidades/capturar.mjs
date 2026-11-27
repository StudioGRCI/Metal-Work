/**
 * Las capturas de «Cómo subir una cotización con varias unidades», con la
 * cuenta de prueba de Ventas (`ventas.local@metalwork.test`) en el banco local.
 *
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-subir-una-cotizacion-con-varias-unidades/capturar.mjs horizontal
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-subir-una-cotizacion-con-varias-unidades/capturar.mjs horizontal
 *
 * Antes, el banco recién preparado (`BANCO_CLAVE='…' ./herramientas/banco/preparar.sh`).
 *
 * Sube de verdad en el banco una cotización INVENTADA de tres camabajas, para
 * un cliente de los datos de demostración. Después, fuera de cámara, Gerencia
 * la aprueba y Administración carga la OT de la primera unidad, para que la
 * última pantalla muestre la tarjeta de Ventas con una OT puesta y dos por
 * llegar. Cada formato sube la suya: para que los dos salgan con el mismo
 * número, rehacer el banco entre uno y otro.
 *
 * El documento no trae RUC: en el video no sale ninguno. El sistema reconoce
 * al cliente igual, por su razón social. Los montos son inventados y se
 * declaran abajo, con las mismas constantes con que se escriben: la revisión
 * automática deja pasar solo esos.
 */
import { abrir, cenido, cerrar, entrar, formatoPedido, pdfConTexto } from '../../scripts/captura.mjs'

const formato = formatoPedido()
const NUMERO = '9001-2026'
const CLIENTE = 'TRANSPORTES ANDINOS S.A.C.' // de los datos de demostración del banco
const UNIDADES = 3
const MONEDA = 'USD'
const TOTAL = 135000 // inventado: 45 000 por unidad
const dinero = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const OT = { numero: '9101-2026', codigo: 'CMB_SR_O3_4_26/901' }

// Los dos documentos se arman aquí y se le dan al navegador en memoria: no hay archivo que guardar.
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
const archivoOrden = pdf(`OT ${OT.numero}.pdf`, [
  `ORDEN DE TRABAJO N ${OT.numero}`,
  `CLIENTE: ${CLIENTE}`,
  'PRODUCTO: SEMIRREMOLQUE CAMA BAJA 3 EJES',
  'FECHA DE ENTREGA DE LA UNIDAD: 10 de febrero de 2027',
  'Documento de prueba del banco local de Metal Work.',
])

const { pagina, ir, tomar } = await abrir({
  video: import.meta.url,
  formato,
  cuenta: 'ventas',
  // El total de la cotización inventada y su promedio por unidad, que la tarjeta calcula.
  montosInventados: [
    { moneda: MONEDA, valor: TOTAL },
    { moneda: MONEDA, valor: TOTAL / UNIDADES },
  ],
})

// 1. Por dónde se entra y el botón.
await ir('/cotizaciones/pdf')
const subir = pagina.getByRole('button', { name: 'Subir cotización' })
await tomar('01-entrada', {
  boton: subir,
  // En el monitor, el menú; en el teléfono, la pestaña de abajo.
  entrada:
    formato === 'horizontal'
      ? pagina.locator('nav[aria-label="Menú principal"]').getByRole('link', { name: 'Cotización' })
      : pagina.getByRole('link', { name: 'Cotizar' }).last(),
})

// 2. Se elige el archivo y el sistema lo lee.
await subir.click()
const ventana = pagina.getByRole('dialog')
await ventana.waitFor()
const campo = (id) => ventana.locator(`#cot-${id}`)
await campo('archivo').setInputFiles(archivoCotizacion)
const leido = ventana.locator('[role="status"]').filter({ hasText: 'Leído del archivo' })
await leido.waitFor({ timeout: 30000 })
await pagina.waitForFunction(() => document.querySelector('#cot-unidades')?.value === '3', null, { timeout: 30000 })
await tomar('02-leido', { leido, archivo: ventana.getByText('haz clic para cambiarlo').locator('xpath=ancestor::*[self::label or self::button or self::div][1]') })

// 3. «Unidades» sale con la cantidad del documento…
const conSuAyuda = (lugar) => lugar.locator('xpath=ancestor::div[1]/..')
await tomar('03-unidades', { unidades: conSuAyuda(campo('unidades')) })
// … y con otra cifra, el sistema avisa.
await campo('unidades').fill('2')
await campo('unidades').blur()
await ventana.getByText('El documento dice 3 unidades: revisa.').waitFor()
await tomar('04-aviso', { unidades: conSuAyuda(campo('unidades')) })
await campo('unidades').fill(String(UNIDADES))
await campo('unidades').blur()

// 4. El total, la moneda y el IGV; el cliente y qué se fabrica.
if (!(await campo('moneda').inputValue())) await campo('moneda').selectOption(MONEDA)
if (!(await campo('igv').inputValue())) await campo('igv').selectOption('no')
if (!(await campo('monto').inputValue())) await campo('monto').fill(TOTAL.toFixed(2))
if (!(await campo('cliente').inputValue())) await campo('cliente').selectOption({ label: CLIENTE })
if (!(await campo('carroceria').inputValue())) await campo('carroceria').selectOption({ label: 'Cama baja' })
// En el teléfono los campos van uno debajo del otro: se sube el primero para que entren todos.
await tomar('05-total', { total: conSuAyuda(campo('monto')), moneda: campo('moneda'), igv: campo('igv') }, { arriba: conSuAyuda(campo('monto')) })
await tomar('06-cliente', { cliente: campo('cliente'), carroceria: campo('carroceria') }, { arriba: conSuAyuda(campo('cliente')) })

// 5. Subir.
const mandar = ventana.getByRole('button', { name: 'Subir y mandar a Gerencia' })
await tomar('07-subir', { mandar })
await mandar.click()
await ventana.waitFor({ state: 'hidden', timeout: 30000 })
await ir('/cotizaciones/pdf')
const tarjeta = pagina.locator('li[id]', { hasText: NUMERO }).first()
await tarjeta.waitFor()
await tomar('08-tarjeta', { unidades: cenido(tarjeta.getByText(`${UNIDADES} unidades`).first().locator('xpath=..')), total: cenido(tarjeta.getByText('en promedio por unidad').locator('xpath=ancestor::p[1]')) }, { arriba: formato === 'horizontal' ? undefined : tarjeta })

// Fuera de cámara: Gerencia la aprueba con un toque…
{
  const gerencia = await entrar('gerencia')
  await gerencia.ir('/cotizaciones/pdf?estado=POR_REVISAR')
  const suya = gerencia.pagina.locator('li[id]', { hasText: NUMERO }).first()
  await suya.getByRole('button', { name: 'Aprobar', exact: true }).click()
  await suya.getByText(/Falta que Administración/).waitFor({ timeout: 30000 })
  await gerencia.contexto.close()
}
// … y Administración carga la OT de la primera unidad.
{
  const administracion = await entrar('administracion')
  await administracion.ir('/cotizaciones/pdf?estado=APROBADA_SIN_OT')
  const suya = administracion.pagina.locator('li[id]', { hasText: NUMERO }).first()
  await suya.getByRole('button', { name: `Cargar la OT 1 de ${UNIDADES}` }).click()
  const carga = administracion.pagina.getByRole('dialog')
  await carga.waitFor()
  await carga.locator('input[type="file"]').setInputFiles(archivoOrden)
  await carga.getByText(/Datos leídos del PDF|No se reconocieron|No se pudo leer/).waitFor({ timeout: 30000 }).catch(() => {})
  await carga.locator('input[name="codigo_interno"]').fill(OT.codigo)
  if (!(await carga.locator('input[name="numero"]').inputValue())) await carga.locator('input[name="numero"]').fill(OT.numero)
  if (!(await carga.locator('select[name="tipo_unidad"]').inputValue())) await carga.locator('select[name="tipo_unidad"]').selectOption('SEMIRREMOLQUE')
  await carga.getByRole('button', { name: 'Guardar código y OT' }).click()
  await carga.waitFor({ state: 'hidden', timeout: 30000 })
  await administracion.contexto.close()
}

// 6. La tarjeta de Ventas: la unidad que ya tiene su OT y las que faltan.
await ir('/cotizaciones/pdf')
await tarjeta.waitFor()
const ordenes = tarjeta.locator(`ul[aria-label="OT de las ${UNIDADES} unidades"]`)
await ordenes.waitFor({ timeout: 20000 })
await tomar(
  '09-avance',
  {
    ordenes: cenido(ordenes),
    faltan: cenido(tarjeta.getByText(/Faltan 2 OT de 3/).locator('xpath=ancestor::p[1]')),
    unidades: cenido(tarjeta.getByText(`${UNIDADES} unidades`).first().locator('xpath=..')),
  },
  { arriba: tarjeta },
)

await cerrar()
console.log(`Capturas de ${formato} listas. Cotización de prueba: ${NUMERO}.`)
