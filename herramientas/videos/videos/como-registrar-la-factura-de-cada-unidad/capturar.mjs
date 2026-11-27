/**
 * Las capturas de «Cómo registrar la factura de cada unidad», con la cuenta de
 * prueba de Contabilidad (`contabilidad.local@metalwork.test`) en el banco local.
 *
 *   BANCO_CLAVE='la-del-banco' node herramientas/videos/videos/como-registrar-la-factura-de-cada-unidad/capturar.mjs horizontal
 *
 * Antes, el banco recién preparado (`BANCO_CLAVE='…' ./herramientas/banco/preparar.sh`).
 *
 * Fuera de cámara, Ventas sube una cotización INVENTADA de tres camabajas para
 * un cliente de los datos de demostración, Gerencia la aprueba y Administración
 * carga la OT de cada unidad. Después, en cámara, Contabilidad registra la
 * factura de la primera unidad, con un PDF también inventado.
 *
 * Ningún documento trae RUC, y el del cliente de demostración, que la tarjeta
 * de Facturación muestra, sale borroso: en el video no se lee ninguno. Los montos son
 * inventados y se declaran abajo con las mismas constantes con que se
 * escriben: la revisión automática deja pasar solo esos.
 */
import { abrir, cenido, cerrar, entrar, formatoPedido, pdfConTexto } from '../../scripts/captura.mjs'

const formato = formatoPedido()
const NUMERO = '9001-2026'
const CLIENTE = 'TRANSPORTES ANDINOS S.A.C.' // de los datos de demostración del banco
const UNIDADES = 3
const MONEDA = 'USD'
const TOTAL = 135000 // inventado, sin IGV: 45 000 por unidad
const IGV = 1.18
const TOTAL_CON_IGV = TOTAL * IGV
const POR_UNIDAD = TOTAL_CON_IGV / UNIDADES
const dinero = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const ORDENES = [
  { numero: '9101-2026', codigo: 'CMB_SR_O3_4_26/901', entrega: '10 de febrero de 2027' },
  { numero: '9102-2026', codigo: 'CMB_SR_O3_4_26/902', entrega: '24 de febrero de 2027' },
  { numero: '9103-2026', codigo: 'CMB_SR_O3_4_26/903', entrega: '10 de marzo de 2027' },
]
const FACTURA = 'E001-9001'

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
const archivoFactura = pdf(`Factura ${FACTURA}.pdf`, [
  `FACTURA ELECTRONICA ${FACTURA}`,
  `CLIENTE: ${CLIENTE}`,
  `SEMIRREMOLQUE CAMA BAJA 3 EJES - UNIDAD 1 DE ${UNIDADES}`,
  `IMPORTE TOTAL US$ ${dinero(POR_UNIDAD)}`,
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
// … Gerencia la aprueba con un toque…
{
  const gerencia = await entrar('gerencia')
  await gerencia.ir('/cotizaciones/pdf?estado=POR_REVISAR')
  const suya = gerencia.pagina.locator('li[id]', { hasText: NUMERO }).first()
  await suya.getByRole('button', { name: 'Aprobar', exact: true }).click()
  await suya.getByText(/Falta que Administración/).waitFor({ timeout: 30000 })
  await gerencia.contexto.close()
}
// … y Administración carga la OT de cada unidad.
{
  const administracion = await entrar('administracion')
  const suya = administracion.pagina.locator('li[id]', { hasText: NUMERO }).first()
  const carga = administracion.pagina.getByRole('dialog')
  for (const [i, orden] of ORDENES.entries()) {
    await administracion.ir('/cotizaciones/pdf')
    await suya.getByRole('button', { name: `Cargar la OT ${i + 1} de ${UNIDADES}` }).click()
    await carga.waitFor()
    await carga.locator('input[type="file"]').setInputFiles(archivoOrden(orden))
    await carga.getByText(/Datos leídos del PDF|No se reconocieron|No se pudo leer/).waitFor({ timeout: 30000 }).catch(() => {})
    await carga.locator('input[name="codigo_interno"]').fill(orden.codigo)
    if (!(await carga.locator('input[name="numero"]').inputValue())) await carga.locator('input[name="numero"]').fill(orden.numero)
    if (!(await carga.locator('select[name="tipo_unidad"]').inputValue())) await carga.locator('select[name="tipo_unidad"]').selectOption('SEMIRREMOLQUE')
    await carga.getByRole('button', { name: 'Guardar código y OT' }).click()
    await carga.waitFor({ state: 'hidden', timeout: 30000 })
  }
  await administracion.contexto.close()
}

const { pagina, ir, tomar } = await abrir({
  video: import.meta.url,
  formato,
  cuenta: 'contabilidad',
  // Lo que la pantalla de Facturación muestra de la cotización inventada: su total con IGV,
  // lo que le toca a cada unidad y lo que falta facturar después de la primera.
  montosInventados: [
    { moneda: MONEDA, valor: TOTAL_CON_IGV },
    { moneda: MONEDA, valor: POR_UNIDAD },
    { moneda: MONEDA, valor: TOTAL_CON_IGV - POR_UNIDAD },
  ],
  // La tarjeta trae el RUC y la dirección del cliente de demostración: en un video no sale ningún RUC.
  tapar: (p) => p.locator('li[data-cotizacion] p', { hasText: /^RUC\s*\d/ }),
})
const tarjeta = pagina.locator(`li[data-cotizacion="${NUMERO}"]`)
const unidades = tarjeta.locator(`section[aria-label="Unidades de la cotización ${NUMERO}"]`)
const porFacturar = pagina.locator('#por-facturar')
const ventana = pagina.getByRole('dialog')
const facturar = (n) => unidades.locator(`[data-facturar-unidad="${n}"]`)
const unidad = ventana.locator('select[name="unidad"]')
const campo = (nombre) => ventana.locator(`[name="${nombre}"]`)

// 1. «Por facturar»: una fila por cada unidad que espera su factura.
await ir('/contabilidad/facturacion')
await porFacturar.waitFor()
await tomar('01-por-facturar', {
  tabla: porFacturar.locator('table'),
  entrada: pagina.locator('nav[aria-label="Menú principal"]').getByRole('link', { name: 'Facturación' }),
})

// 2. La tarjeta de la cotización: cada unidad con lo que le toca y su «Facturar».
await tomar('02-tarjeta', { unidades: cenido(unidades), boton: facturar(1), fila: cenido(unidades.locator('li[data-unidad="1"]')) }, { arriba: tarjeta })

// 3. La ventana se abre con esa unidad ya elegida y dice cuánto le toca.
await facturar(1).click()
await ventana.waitFor()
await tomar('03-ventana', { titulo: cenido(ventana.locator('h2').first()), unidad })

// 4. El número de la factura, las fechas y el total con IGV.
await campo('numero').fill(FACTURA)
if ((await campo('moneda').inputValue()) !== MONEDA) await campo('moneda').selectOption(MONEDA)
await campo('total').fill(POR_UNIDAD.toFixed(2))
await tomar('04-datos', {
  numero: campo('numero'),
  fechas: campo('fecha_emision'),
  vence: campo('fecha_vencimiento'),
  total: campo('total'),
  toca: cenido(ventana.getByText(/le tocan/)),
})

// 5. El PDF de la factura y registrar.
await campo('archivo').setInputFiles(archivoFactura)
const boton = ventana.getByRole('button', { name: 'Registrar la factura' })
await tomar('05-pdf', { pdf: ventana.getByText(`Factura ${FACTURA}.pdf`).locator('xpath=ancestor::*[self::label or self::button or self::div][1]'), registrar: boton })
await boton.click()
await ventana.waitFor({ state: 'hidden', timeout: 30000 })

// 6. La unidad queda facturada y las otras dos siguen en «Por facturar».
await ir('/contabilidad/facturacion')
await porFacturar.waitFor()
await tomar('06-quedan', { tabla: porFacturar.locator('table') })
await tomar('07-facturada', { primera: cenido(unidades.locator('li[data-unidad="1"]')), unidades: cenido(unidades) }, { arriba: tarjeta })

// 7. La factura por toda la cotización: «Registrar factura» y se reparte en partes iguales.
const registrar = tarjeta.locator('[data-registrar-factura]').first()
await tomar('08-registrar', { boton: registrar })
await registrar.click()
await ventana.waitFor()
await unidad.selectOption('0')
await tomar('09-toda', { unidad, reparto: cenido(ventana.getByText(/partes iguales entre sus unidades/)) })

await cerrar()
console.log(`Capturas de ${formato} listas. Cotización de prueba: ${NUMERO}.`)
