import test from 'node:test'
import assert from 'node:assert/strict'
import { contarLoQueEntro } from './envios.ts'

const SIN_FACTURA = { que: 'factura o comprobante', donde: 'desde la fila de la orden', dondeVarios: 'desde la fila de cada orden' }

const oc = (numero, extra = {}) => ({
  sujeto: 'La orden de compra',
  plural: 'Las órdenes de compra',
  detalle: numero,
  falta: null,
  cierre: 'Lo que registres ahora será otra.',
  autor: null,
  ...extra,
})

// Una sola, como la decía la ventana antes de juntarlas: las suites la comparan entera.
test('lo que entró, solo, se dice igual que antes', () => {
  assert.equal(contarLoQueEntro([oc('OC-0001-MW')]), 'La orden de compra que enviaste antes sí quedó: OC-0001-MW. Lo que registres ahora será otra.')
  assert.equal(
    contarLoQueEntro([oc('OC-0002-MW', { falta: SIN_FACTURA })]),
    'La orden de compra que enviaste antes sí quedó: OC-0002-MW. Si le elegiste factura o comprobante, no se adjuntó: adjúntalo desde la fila de la orden. Lo que registres ahora será otra.',
  )
})

// Con varias, cada parte se dice una vez (vigesimoprimera pasada: cinco notas repetían cinco veces el cierre).
test('varias de la misma clase van en una frase y en orden, con lo que falta dicho una vez', () => {
  assert.equal(
    contarLoQueEntro([oc('OC-0010-MW', { falta: SIN_FACTURA }), oc('OC-0002-MW', { falta: SIN_FACTURA }), oc('OC-0003-MW', { falta: SIN_FACTURA })]),
    'Las órdenes de compra que enviaste antes sí quedaron: OC-0002-MW, OC-0003-MW y OC-0010-MW. Si les elegiste factura o comprobante, no se adjuntó: adjúntalos desde la fila de cada orden. Lo que registres ahora será otra.',
  )
})

// Lo que falta, solo de las que les falta (vigesimosegunda pasada: la frase en singular valía para todas).
test('lo que falta nombra a cuáles si no es a todas', () => {
  assert.equal(
    contarLoQueEntro([oc('OC-0001-MW', { falta: SIN_FACTURA }), oc('OC-0002-MW'), oc('OC-0003-MW', { falta: SIN_FACTURA })]),
    'Las órdenes de compra que enviaste antes sí quedaron: OC-0001-MW, OC-0002-MW y OC-0003-MW. Si a OC-0001-MW y OC-0003-MW les elegiste factura o comprobante, no se adjuntó: adjúntalos desde la fila de cada orden. Lo que registres ahora será otra.',
  )
  assert.equal(
    contarLoQueEntro([oc('OC-0001-MW'), oc('OC-0002-MW', { falta: SIN_FACTURA })]),
    'Las órdenes de compra que enviaste antes sí quedaron: OC-0001-MW y OC-0002-MW. Si a OC-0002-MW le elegiste factura o comprobante, no se adjuntó: adjúntalo desde la fila de la orden. Lo que registres ahora será otra.',
  )
})

test('de clases distintas, cada una con su nombre y el cierre neutro', () => {
  const factura = { ...oc('F001-12'), sujeto: 'La factura', plural: 'Las facturas' }
  const comprobante = { ...oc('B002-7'), sujeto: 'El comprobante', plural: 'Los comprobantes', cierre: 'Lo que registres ahora será otro.' }
  assert.equal(
    contarLoQueEntro([factura, comprobante]),
    'Lo que enviaste antes sí quedó: el comprobante B002-7 y la factura F001-12. Lo que registres ahora irá aparte.',
  )
  // Dos de la misma clase siguen con su cierre.
  assert.equal(
    contarLoQueEntro([factura, { ...factura, detalle: 'F001-9' }]),
    'Las facturas que enviaste antes sí quedaron: F001-9 y F001-12. Lo que registres ahora será otra.',
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
    detalle: 'la factura F001-9 tomó S/ 10.00',
    falta: null,
    cierre: 'Lo que registres ahora irá aparte.',
    autor: null,
  }
  assert.equal(contarLoQueEntro([toma]), 'Lo que enviaste antes sí quedó: la factura F001-9 tomó S/ 10.00. Lo que registres ahora irá aparte.')
})
