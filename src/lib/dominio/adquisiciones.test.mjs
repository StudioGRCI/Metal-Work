import test from 'node:test'
import assert from 'node:assert/strict'
import { documentosQueFaltan, enSituacion, nombreDeOc, partesDeNombreDeOc, textoDelDocumento } from './adquisiciones.ts'

// Lo que arma `nombre_de_oc` en la base se separa otra vez para el título y la
// línea de abajo, sin perder nada.
test('el nombre de la OC se separa en número y referencia, y vuelve a armarse igual', () => {
  for (const oc of [
    { numero: 'OC-0001-MW', referencia: 'COT-77' },
    { numero: null, referencia: 'OC-0621' },
    { numero: null, referencia: 'PROFORMA (2) 15/10' },
    { numero: null, referencia: null },
  ]) {
    const nombre = nombreDeOc(oc)
    const partes = partesDeNombreDeOc(nombre)
    assert.equal(partes.numero, oc.numero)
    assert.equal(partes.referencia, oc.numero ? null : oc.referencia)
    assert.equal(nombreDeOc(partes), nombre)
  }
})

test('un número de la serie no se toma por una OC sin número', () => {
  assert.deepEqual(partesDeNombreDeOc('OC-0621-MW'), { numero: 'OC-0621-MW', referencia: null })
})

// Plan 10, entrega 10.2: lo que falta de cada compra se dice igual en la pantalla y en el Excel.
test('cada documento se nombra según falte, esté a medias o esté', () => {
  assert.equal(textoDelDocumento({ documento: 'FACTURA', situacion: 'FALTA', numeros: null }), 'Falta la factura')
  assert.equal(textoDelDocumento({ documento: 'FACTURA', situacion: 'EN_PARTE', numeros: 'F001-1' }), 'Facturada en parte · F001-1')
  assert.equal(textoDelDocumento({ documento: 'GUIA', situacion: 'ESTA', numeros: 'T001-12' }), 'Guía de remisión T001-12')
  assert.equal(textoDelDocumento({ documento: 'DETRACCION', situacion: 'ESTA', numeros: null }), 'Detracción depositada')
  assert.equal(textoDelDocumento({ documento: 'DETRACCION', situacion: 'EN_PARTE', numeros: 'OP-1' }), 'Detracción depositada en parte · (operación OP-1)')
  assert.equal(textoDelDocumento({ documento: 'NOTA_CREDITO', situacion: 'EN_PARTE', numeros: 'FC01-1' }), 'Falta la nota de crédito de otra devolución (ya está la FC01-1)')
  assert.equal(textoDelDocumento({ documento: 'NOTA_CREDITO', situacion: 'FALTA', numeros: null }), 'Falta la nota de crédito de lo devuelto')
})

test('lo que falta va del que más espera al que menos, y lo que está no cuenta', () => {
  const docs = [
    { documento: 'GUIA', situacion: 'FALTA', desde: null, dias: 2, numeros: null },
    { documento: 'FACTURA', situacion: 'ESTA', desde: null, dias: null, numeros: 'F001-1' },
    { documento: 'NOTA_CREDITO', situacion: 'FALTA', desde: null, dias: 9, numeros: null },
    { documento: 'DETRACCION', situacion: 'EN_PARTE', desde: null, dias: 2, numeros: 'OP-1' },
  ]
  assert.deepEqual(documentosQueFaltan(docs).map((d) => d.documento), ['NOTA_CREDITO', 'GUIA', 'DETRACCION'])
})

test('«Incompletas» es la que tiene algún documento que falta o está a medias', () => {
  const fila = { tipo: 'OC', aprobacion: 'APROBADA', con_factura: true, facturada_entera: true, pago: 'PAGADA', recojo: null, en_lista: false, peso_kg: null, guia: null }
  assert.equal(enSituacion({ ...fila, incompletos: 1 }, 'incompletas'), true)
  assert.equal(enSituacion({ ...fila, incompletos: 0 }, 'incompletas'), false)
  assert.equal(enSituacion(fila, 'incompletas'), false)
})
