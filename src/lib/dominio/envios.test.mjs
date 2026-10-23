import test from 'node:test'
import assert from 'node:assert/strict'
import { contarLoQueEntro } from './envios.ts'

const oc = (numero, extra = {}) => ({
  sujeto: 'La orden de compra',
  plural: 'Las órdenes de compra',
  detalle: numero,
  falta: '',
  cierre: 'Lo que registres ahora será otra.',
  autor: null,
  ...extra,
})

// Una sola, como la decía la ventana antes de juntarlas: las suites la comparan entera.
test('lo que entró, solo, se dice igual que antes', () => {
  assert.equal(contarLoQueEntro([oc('OC-0001-MW')]), 'La orden de compra que enviaste antes sí quedó: OC-0001-MW. Lo que registres ahora será otra.')
  const sinFactura = oc('OC-0002-MW', { falta: ' Si le elegiste factura o comprobante, no se adjuntó: adjúntalo desde la fila de la orden.' })
  assert.equal(
    contarLoQueEntro([sinFactura]),
    'La orden de compra que enviaste antes sí quedó: OC-0002-MW. Si le elegiste factura o comprobante, no se adjuntó: adjúntalo desde la fila de la orden. Lo que registres ahora será otra.',
  )
})

// Con varias, cada parte se dice una vez (vigesimoprimera pasada: cinco notas repetían cinco veces el cierre).
test('varias de la misma clase van en una frase, con lo que falta dicho una vez', () => {
  const falta = ' Si le elegiste factura o comprobante, no se adjuntó: adjúntalo desde la fila de la orden.'
  assert.equal(
    contarLoQueEntro([oc('OC-0001-MW', { falta }), oc('OC-0002-MW', { falta }), oc('OC-0003-MW')]),
    `Las órdenes de compra que enviaste antes sí quedaron: OC-0001-MW, OC-0002-MW y OC-0003-MW.${falta} Lo que registres ahora será otra.`,
  )
})

test('de clases distintas, cada una con su nombre', () => {
  const factura = { ...oc('F001-12'), sujeto: 'La factura', plural: 'Las facturas' }
  const comprobante = { ...oc('B002-7'), sujeto: 'El comprobante', plural: 'Los comprobantes', cierre: 'Lo que registres ahora será otro.' }
  assert.equal(
    contarLoQueEntro([factura, comprobante]),
    'Lo que enviaste antes sí quedó: la factura F001-12 y el comprobante B002-7. Lo que registres ahora será otra.',
  )
})

test('lo que salió de esta pestaña a nombre de otra cuenta lleva su número y quién tenía la sesión', () => {
  assert.equal(
    contarLoQueEntro([], oc('OC-0004-MW', { autor: 'Administración' })),
    'La orden de compra que se envió antes desde esta pestaña sí quedó, a nombre de Administración, que tenía la sesión: OC-0004-MW. Lo que registres ahora será otra.',
  )
  assert.equal(
    contarLoQueEntro([oc('OC-0005-MW')], oc('OC-0004-MW', { autor: 'Administración' })),
    'La orden de compra que enviaste antes sí quedó: OC-0005-MW. La orden de compra que se envió antes desde esta pestaña sí quedó, a nombre de Administración, que tenía la sesión: OC-0004-MW. Lo que registres ahora será otra.',
  )
})

test('la toma de la boleta conserva su frase', () => {
  const toma = {
    sujeto: 'Lo',
    plural: 'Las tomas de la boleta',
    detalle: 'la factura F001-9 tomó S/ 10.00',
    falta: '',
    cierre: 'Lo que registres ahora irá aparte.',
    autor: null,
  }
  assert.equal(contarLoQueEntro([toma]), 'Lo que enviaste antes sí quedó: la factura F001-9 tomó S/ 10.00. Lo que registres ahora irá aparte.')
})
