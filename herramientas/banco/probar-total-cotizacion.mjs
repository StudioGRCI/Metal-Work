import assert from 'node:assert/strict'

import { leerTotalDeCotizacion } from '../../src/lib/cotizacion-pdf.ts'

assert.deepEqual(leerTotalDeCotizacion('IGV S/ 4,200.00\nTOTAL A PAGAR S/ 29,880.00'), {
  monto: '29880.00',
  moneda: 'PEN',
})
assert.deepEqual(leerTotalDeCotizacion('TOTAL GENERAL\nUS$ 1.234,50'), {
  monto: '1234.50',
  moneda: 'USD',
})
assert.deepEqual(leerTotalDeCotizacion('SUBTOTAL S/ 10,000.00\nADELANTO S/ 2,000.00'), {
  monto: null,
  moneda: null,
})
assert.deepEqual(leerTotalDeCotizacion('TOTAL IGV S/ 4,500.00\nTOTAL A PAGAR S/ 29,500.00'), {
  monto: '29500.00',
  moneda: 'PEN',
})
assert.deepEqual(leerTotalDeCotizacion('TOTAL IGV S/ 4,500.00'), {
  monto: null,
  moneda: null,
})
assert.deepEqual(leerTotalDeCotizacion('TOTAL 29880.00'), {
  monto: '29880.00',
  moneda: null,
})
assert.deepEqual(leerTotalDeCotizacion('TOTAL 10,5 PEN'), {
  monto: '10.50',
  moneda: 'PEN',
})

console.log('Lectura del monto: 7 casos correctos.')
