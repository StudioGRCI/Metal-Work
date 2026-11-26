import test from 'node:test'
import assert from 'node:assert/strict'
import { faltaDeLaBoleta, faltaDeLaFactura, faltaDelServicio, faltaDeLaParte, ocsQueTraban } from './lo-que-falta.ts'

const oc = (nombre, aprobacion, mas = {}) => ({ nombre, aprobacion, ...mas })
const factura = (mas = {}) => ({ saldo: 100, enEspera: false, ordenes: [oc('OC-0001-MW', 'APROBADA')], esperaLaBoleta: false, ...mas })
const quien = (lista) => lista.map((f) => `${f.quien}${f.traba ? '!' : ''}`)

test('solo traban las OC por aprobar, rechazadas o anuladas', () => {
  const ordenes = [oc('A', 'APROBADA'), oc('B', 'NO_REQUERIDA'), oc('C', null), oc('D', 'POR_APROBAR'), oc('E', 'RECHAZADA')]
  assert.deepEqual(ocsQueTraban(ordenes).map((o) => o.nombre), ['D', 'E'])
})

test('la factura sin nada pendiente le toca a Tesorería: el pago con su voucher', () => {
  assert.deepEqual(faltaDeLaFactura(factura()), [{ que: 'el pago, con su voucher', quien: 'Tesorería', traba: false }])
  assert.deepEqual(faltaDeLaFactura(factura({ saldo: 0 })), [])
})

test('la factura de una OC por aprobar espera a Gerencia, con los días de la que espera desde antes', () => {
  const r = faltaDeLaFactura(factura({
    ordenes: [oc('OC-0001-MW', 'POR_APROBAR', { pedidaEn: '2026-11-25T10:00:00Z', dias: 1 }), oc('OC-0002-MW', 'POR_APROBAR', { pedidaEn: '2026-11-20T10:00:00Z', dias: 6 })],
  }))
  assert.deepEqual(quien(r), ['Gerencia!'])
  assert.equal(r[0].que, 'la aprobación de la OC-0001-MW y OC-0002-MW')
  assert.equal(r[0].dias, 6)
  assert.equal(r[0].desde, '2026-11-20T10:00:00Z')
})

test('la OC rechazada manda sobre la que espera: no se paga, lo ve Contabilidad', () => {
  const r = faltaDeLaFactura(factura({ ordenes: [oc('OC-0001-MW', 'POR_APROBAR'), oc('OC-0002-MW', 'RECHAZADA')] }))
  assert.deepEqual(quien(r), ['Contabilidad!'])
  assert.match(r[0].que, /OC-0002-MW está rechazada/)
})

test('la que espera a Contabilidad no pregunta por Gerencia', () => {
  assert.deepEqual(quien(faltaDeLaFactura(factura({ enEspera: true, ordenes: [oc('X', 'POR_APROBAR')] }))), ['Contabilidad!'])
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
  assert.deepEqual(quien(faltaDelServicio(servicio({ conComprobante: false, conforme: false }))), ['Logística', 'Logística', 'Tesorería'])
  assert.deepEqual(
    faltaDelServicio(servicio({ saldoDetraccion: 30 })).map((f) => f.que),
    ['depositar la detracción en el Banco de la Nación, con su constancia', 'el pago al proveedor, con su voucher'],
  )
  assert.deepEqual(quien(faltaDelServicio(servicio({ todoPagado: true, saldoProveedor: 0 }))), ['Tesorería'])
  assert.deepEqual(faltaDelServicio(servicio({ cancelada: true })), [])
})
