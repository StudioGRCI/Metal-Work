import test from 'node:test'
import assert from 'node:assert/strict'
import { faltaDeLaBoleta, faltaDeLaCompraACredito, faltaDeLaFactura, faltaDelServicio, faltaDeLaParte, ocsQueTraban } from './lo-que-falta.ts'

const oc = (nombre, aprobacion, mas = {}) => ({ nombre, aprobacion, ...mas })
const factura = (mas = {}) => ({ saldo: 100, enEspera: false, traba: null, esperaLaBoleta: false, ...mas })
const quien = (lista) => lista.map((f) => `${f.quien}${f.traba ? '!' : ''}`)

test('solo traban las OC por aprobar, rechazadas o anuladas', () => {
  const ordenes = [oc('A', 'APROBADA'), oc('B', 'NO_REQUERIDA'), oc('C', null), oc('D', 'POR_APROBAR'), oc('E', 'RECHAZADA')]
  assert.deepEqual(ocsQueTraban(ordenes).map((o) => o.nombre), ['D', 'E'])
})

test('la factura sin nada pendiente le toca a Tesorería: el pago con su voucher', () => {
  assert.deepEqual(faltaDeLaFactura(factura()), [{ que: 'el pago, con su voucher', quien: 'Tesorería', traba: false }])
  assert.deepEqual(faltaDeLaFactura(factura({ saldo: 0 })), [])
})

test('la factura que la base traba por una OC por aprobar espera a quien aprueba, con sus días', () => {
  const traba = oc('OC-0002-MW', 'POR_APROBAR', { desde: '2026-11-20T10:00:00Z', dias: 6 })
  const r = faltaDeLaFactura(factura({ traba }))
  assert.deepEqual(quien(r), ['Gerencia!'])
  assert.equal(r[0].que, 'la aprobación de la OC-0002-MW')
  assert.equal(r[0].dias, 6)
  assert.equal(r[0].desde, '2026-11-20T10:00:00Z')
  // El puesto lo dice la regla: si aprueba otro, la línea es suya.
  assert.deepEqual(quien(faltaDeLaFactura(factura({ traba, aprueba: 'Administración' }))), ['Administración!'])
})

test('la OC rechazada o anulada no se paga: lo ve Contabilidad', () => {
  const r = faltaDeLaFactura(factura({ traba: oc('OC-0002-MW', 'RECHAZADA') }))
  assert.deepEqual(quien(r), ['Contabilidad!'])
  assert.match(r[0].que, /OC-0002-MW está rechazada/)
  assert.match(faltaDeLaFactura(factura({ traba: oc('OC-0003-MW', 'ANULADA') }))[0].que, /OC-0003-MW está anulada/)
})

test('la que espera a Contabilidad no pregunta por Gerencia', () => {
  assert.deepEqual(quien(faltaDeLaFactura(factura({ enEspera: true, traba: oc('X', 'POR_APROBAR') }))), ['Contabilidad!'])
})

test('la factura que espera lo pagado por la boleta en otra moneda es de Tesorería, y traba', () => {
  assert.deepEqual(quien(faltaDeLaFactura(factura({ esperaLaBoleta: true }))), ['Tesorería!'])
})

const boleta = (mas = {}) => ({
  saldo: 50, cancelada: false, comprobanteEnCamino: false, conFactura: false, anexoPorRevisar: false,
  sinPrecio: false, sinBoleta: false, devuelta: false, deMas: 0, otraMoneda: false, ...mas,
})

test('la OC con boleta: de quién es cada cosa que falta', () => {
  assert.deepEqual(quien(faltaDeLaBoleta(boleta())), ['Tesorería'])
  assert.deepEqual(quien(faltaDeLaBoleta(boleta({ sinBoleta: true }))), ['Logística', 'Tesorería'])
  assert.deepEqual(quien(faltaDeLaBoleta(boleta({ sinPrecio: true }))), ['Logística!'])
  assert.deepEqual(quien(faltaDeLaBoleta(boleta({ comprobanteEnCamino: true }))), ['Contabilidad!'])
  assert.deepEqual(quien(faltaDeLaBoleta(boleta({ anexoPorRevisar: true, comprobanteEnCamino: true }))), ['Logística!'])
  assert.deepEqual(quien(faltaDeLaBoleta(boleta({ conFactura: true }))), [])
  assert.deepEqual(quien(faltaDeLaBoleta(boleta({ cancelada: true, saldo: 0 }))), [])
  assert.deepEqual(quien(faltaDeLaBoleta(boleta({ devuelta: true }))), [])
  // Pagada de más: aunque ya no se deba nada, a Tesorería le queda la devolución.
  assert.deepEqual(quien(faltaDeLaBoleta(boleta({ cancelada: true, saldo: 0, deMas: 20 }))), ['Tesorería'])
})

test('la boleta de una parte: solo el pago', () => {
  assert.deepEqual(quien(faltaDeLaParte({ saldo: 10 })), ['Tesorería'])
  assert.deepEqual(faltaDeLaParte({ saldo: 0 }), [])
})

const servicio = (mas = {}) => ({ cancelada: false, conComprobante: true, conforme: true, todoPagado: false, saldoProveedor: 100, saldoDetraccion: 0, ...mas })

test('la orden de servicio: Logística da la factura y la conformidad; Tesorería paga y deposita', () => {
  assert.deepEqual(quien(faltaDelServicio(servicio())), ['Tesorería'])
  // Sin conformidad, el pago todavía no le toca a Tesorería.
  assert.deepEqual(quien(faltaDelServicio(servicio({ conComprobante: false, conforme: false }))), ['Logística', 'Logística'])
  assert.deepEqual(quien(faltaDelServicio(servicio({ conComprobante: false }))), ['Logística', 'Tesorería'])
  assert.deepEqual(
    faltaDelServicio(servicio({ saldoDetraccion: 30 })).map((f) => f.que),
    ['depositar la detracción en el Banco de la Nación, con su constancia', 'el pago al proveedor, con su voucher'],
  )
  assert.deepEqual(quien(faltaDelServicio(servicio({ todoPagado: true, saldoProveedor: 0 }))), ['Tesorería!'])
  assert.deepEqual(faltaDelServicio(servicio({ cancelada: true })), [])
})

test('la OS en dólares sin monto en soles no se paga ni se da por pagada, y dice de qué día falta el cambio y quién lo registra', () => {
  const r = faltaDelServicio(servicio({ sinTipoDeCambio: true, cambioDel: '23/11/2026', todoPagado: true, saldoProveedor: 0 }))
  assert.deepEqual(quien(r), ['Contabilidad o Administración!'])
  assert.match(r[0].que, /^el tipo de cambio del 23\/11\/2026:/)
  const sinFecha = faltaDelServicio(servicio({ sinTipoDeCambio: true }))
  assert.deepEqual(quien(sinFecha), ['Contabilidad o Administración!'])
  assert.match(sinFecha[0].que, /^el tipo de cambio del día en que se emitió la OS:/)
})

test('la OS en otra moneda sin su factura: la factura va primero con su porqué, y el depósito avisa con qué cambio sale', () => {
  const r = faltaDelServicio(servicio({ conComprobante: false, saldoDetraccion: 30, cambioSinFactura: true }))
  assert.deepEqual(quien(r), ['Logística', 'Tesorería', 'Tesorería'])
  assert.match(r[0].que, /^la factura del proveedor, adjunta a la OS con su fecha de emisión: el tipo de cambio de ese día/)
  assert.match(r[1].que, /queda con el tipo de cambio con que se emitió la OS$/)
  // Con un recibo adjunto la factura sigue faltando: es la que trae la fecha del cambio.
  assert.equal(faltaDelServicio(servicio({ cambioSinFactura: true })).length, 2)
  // La factura que se adjuntó sin fecha no «falta»: se pide adjuntarla de nuevo con su fecha.
  assert.match(faltaDelServicio(servicio({ facturaSinFecha: true }))[0].que, /^anular la factura adjunta y volver a adjuntarla con su fecha de emisión/)
  // Con su factura, pero sin el cambio de ese día: el depósito dice con cuál quedaría.
  assert.match(
    faltaDelServicio(servicio({ saldoDetraccion: 30, cambioDeLaVispera: { usado: '25/11/2026', factura: '26/11/2026' } }))[0].que,
    /el tipo de cambio del 26\/11\/2026, la fecha de su factura, todavía no está registrado; si la depositas ahora, queda con el del 25\/11\/2026$/,
  )
  // En soles, o ya con su factura, nada de eso.
  assert.deepEqual(
    faltaDelServicio(servicio({ saldoDetraccion: 30 })).map((f) => f.que),
    ['depositar la detracción en el Banco de la Nación, con su constancia', 'el pago al proveedor, con su voucher'],
  )
})

test('la OS sin decir si lleva detracción se lo pide a Logística', () => {
  assert.deepEqual(quien(faltaDelServicio(servicio({ detraccionSinDefinir: true }))), ['Logística', 'Tesorería'])
})

test('la compra a crédito por aprobar espera primero a Gerencia, con sus días', () => {
  const falta = faltaDeLaCompraACredito({ nombre: 'OC-0012-MW', aprobacion: 'POR_APROBAR', desde: '2026-11-22T10:00:00Z', dias: 4 })
  assert.deepEqual(quien(falta), ['Gerencia!', 'Contabilidad!'])
  assert.equal(falta[0].que, 'la aprobación de la OC-0012-MW')
  assert.equal(falta[0].dias, 4)
  assert.deepEqual(quien(faltaDeLaCompraACredito({ nombre: 'OC-0012-MW', aprobacion: 'APROBADA' })), ['Contabilidad!'])
  assert.deepEqual(quien(faltaDeLaCompraACredito({ nombre: 'OC-0012-MW', aprobacion: 'RECHAZADA' })), ['Logística!'])
})
