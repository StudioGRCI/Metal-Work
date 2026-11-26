import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

// `detraccion.ts` importa `@/lib/format`: el alias es de Next, y aquí se resuelve a mano.
registerHooks({
  resolve: (ruta, contexto, siguiente) =>
    siguiente(ruta.startsWith('@/') ? new URL(`../../${ruta.slice(2)}.ts`, import.meta.url).href : ruta, contexto),
})
const { diaDelCambio, resumenDetraccion } = await import('./detraccion.ts')

const os = (mas = {}) => ({
  afecta: true, codigo: '025', descripcion: 'Fabricación por encargo', porcentaje: 10, minimo: 700, motivo: null,
  total_con_igv_pen: 4484, monto: 448, dia_del_cambio: '2026-11-23', ...mas,
})

test('la OS en otra moneda dice con el tipo de cambio de qué día va su detracción, y por qué', () => {
  assert.match(resumenDetraccion(os({ origen_del_cambio: 'FACTURA' })).detalle, / · con el tipo de cambio del 23\/11\/2026, la fecha de su factura$/)
  // Sin factura la cifra es provisional: quien paga lo tiene que leer.
  assert.match(resumenDetraccion(os({ origen_del_cambio: 'SIN_FACTURA' })).detalle, /del 23\/11\/2026, el día en que se emitió: falta su factura$/)
  assert.match(resumenDetraccion(os({ origen_del_cambio: 'DEPOSITADA_ANTES' })).detalle, /el día en que se emitió: su detracción ya estaba depositada cuando llegó su factura$/)
  // La factura de ese día ya no es la vigente: no se la nombra como «su factura».
  const conOtra = resumenDetraccion(os({ origen_del_cambio: 'DEPOSITADA_CON_OTRA' })).detalle
  assert.match(conOtra, /del 23\/11\/2026: su detracción ya estaba depositada cuando se cambió su factura$/)
  assert.doesNotMatch(conOtra, /la fecha de su factura/)
  // La que no pasa del mínimo también lo dice: con otro cambio puede pasar.
  assert.match(resumenDetraccion(os({ monto: null, origen_del_cambio: 'SIN_FACTURA' })).detalle, /falta su factura$/)
})

test('la OS en soles, y Aprobación, que no lee los documentos, no hablan de tipo de cambio', () => {
  assert.doesNotMatch(resumenDetraccion(os({ origen_del_cambio: null })).detalle, /tipo de cambio/)
  assert.doesNotMatch(resumenDetraccion(os()).detalle, /tipo de cambio/)
})

test('cuando falta el tipo de cambio dice de qué día, y si es el de su factura', () => {
  const sin = os({ total_con_igv_pen: null, monto: null })
  assert.match(resumenDetraccion({ ...sin, origen_del_cambio: 'FACTURA' }).detalle, /Falta el tipo de cambio del 23\/11\/2026, la fecha de su factura: lo registran Contabilidad o Administración\.$/)
  assert.match(resumenDetraccion({ ...sin, origen_del_cambio: 'SIN_FACTURA' }).detalle, /Falta el tipo de cambio del 23\/11\/2026: lo registran/)
  assert.equal(diaDelCambio({ dia_del_cambio: null }), null)
})
