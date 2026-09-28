import assert from 'node:assert/strict'

import { leerTextoDeCotizacion, leerTotalDeCotizacion } from '../../src/lib/cotizacion-pdf.ts'

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

// El PDF 3588 coloca el título antes de la cabecera en el texto extraído y
// separa cantidad, descripción, precio unitario y total en líneas distintas.
const cotizacionEnColumnas = `FURGÓN SEMIRREMOLQUE CUELLO GANSO DOBLE NIVEL CRUCERO
RIELES ALUMINIO - SUSPENSION NEUMÁTICA
ESPECIFICACIÓNES TÉCNICAS
COTIZACIÓN N° 3588 (02) - 2026
Fecha : 23/02/2026
Señor : MAT CENTER S.A.C.
RUC : 20501416917
18 puertas laterales abatibles
PROPUESTA ECONÓMICA:
CANTIDAD DESCRIPCIÓN PRECIO
UNITARIO
PRECIO
TOTAL
02
FURGÓN SEMIRREMOLQUE CUELLO GANSO
DOBLE NIVEL CRUCERO RIELES ALUMINIO
$ 34,000.00 $ 68,000.00
PRECIO : Expresado en dólares americanos incluye IGV.`
assert.equal(leerTextoDeCotizacion(cotizacionEnColumnas).producto,
  'FURGÓN SEMIRREMOLQUE CUELLO GANSO DOBLE NIVEL CRUCERO RIELES ALUMINIO - SUSPENSION NEUMÁTICA')
assert.deepEqual(leerTotalDeCotizacion(cotizacionEnColumnas), { monto: '68000.00', moneda: 'USD' })

console.log('Lectura de cotización: 9 casos correctos.')
