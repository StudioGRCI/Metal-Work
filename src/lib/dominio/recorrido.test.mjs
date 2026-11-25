import test from 'node:test'
import assert from 'node:assert/strict'
import { describirRecorridoDeLaCotizacion, describirRecorridoDelRequerimiento, haceDias } from './recorrido.ts'

const paso = (orden, paso, situacion, mas = {}) => ({
  orden, paso, situacion, puesto: null, nombre: null, en: null, dias: null, espera: null, detalle: null, ...mas,
})

test('los días se dicen como se habla', () => {
  assert.equal(haceDias(0), 'hoy')
  assert.equal(haceDias(-1), 'hoy')
  assert.equal(haceDias(1), 'hace 1 día')
  assert.equal(haceDias(3), 'hace 3 días')
})

test('el recorrido del RQ dice lo hecho, quién lo tiene y lo que falta', () => {
  const pasos = describirRecorridoDelRequerimiento([
    // Llega desordenado: manda el orden de la base.
    paso(3, 'LISTO', 'PENDIENTE'),
    paso(1, 'REGISTRO', 'HECHO', { puesto: 'Requerimientos', nombre: 'Ana Ruiz', en: '2026-11-20T15:00:00Z', detalle: 'Maestranza' }),
    paso(2, 'COMPRA', 'AHORA', { puesto: 'Gerencia', dias: 3, espera: 'OC_POR_APROBAR', detalle: 'OC-0001-MW' }),
    paso(4, 'ENTREGA', 'PENDIENTE'),
  ])
  assert.deepEqual(pasos.map((p) => p.paso), ['REGISTRO', 'COMPRA', 'LISTO', 'ENTREGA'])
  assert.equal(pasos[0].titulo, 'Registrado')
  assert.equal(pasos[0].nota, 'Para Maestranza')
  assert.equal(pasos[1].titulo, 'Compra de lo que falta')
  assert.equal(pasos[1].nota, 'Aprueba la OC-0001-MW.')
  assert.equal(pasos[2].titulo, 'Listo en almacén')
  assert.equal(pasos[2].nota, null)
})

test('lo que el RQ espera sin orden de compra todavía no la nombra', () => {
  const [p] = describirRecorridoDelRequerimiento([paso(1, 'COMPRA', 'AHORA', { puesto: 'Logística', dias: 0, espera: 'POR_COMPRAR' })])
  assert.equal(p.nota, 'Falta ponerlo en una orden de compra.')
  const [g] = describirRecorridoDelRequerimiento([paso(1, 'COMPRA', 'AHORA', { puesto: 'Gerencia', dias: 0, espera: 'OC_POR_APROBAR' })])
  assert.equal(g.nota, 'Aprueba la orden de compra.')
})

test('el visto de Diseño y la entrega cambian de frase según cómo terminaron', () => {
  const pasos = describirRecorridoDelRequerimiento([
    paso(1, 'VISTO_DISENO', 'HECHO', { detalle: 'RECHAZADO' }),
    paso(2, 'VISTO_DISENO', 'HECHO', { detalle: 'AUTORIZADO' }),
    paso(3, 'ENTREGA', 'HECHO', { detalle: 'CON_FALTANTE' }),
    paso(4, 'ENTREGA', 'HECHO'),
  ])
  assert.deepEqual(pasos.map((p) => p.titulo), ['Diseño no lo autorizó', 'Diseño lo autorizó', 'Entregado al área, con faltante', 'Entregado al área'])
})

test('el recorrido de la cotización nombra la OT solo si la base la manda', () => {
  const pasos = describirRecorridoDeLaCotizacion([
    paso(1, 'SUBIDA', 'HECHO'),
    paso(2, 'REVISION', 'HECHO', { detalle: 'RECHAZADA' }),
    paso(3, 'CORRECCION', 'HECHO', { detalle: 'versión 2' }),
    paso(4, 'REVISION', 'HECHO', { detalle: 'APROBADA' }),
    paso(5, 'CODIGO_Y_OT', 'HECHO', { detalle: 'OT 9357-2026' }),
    paso(6, 'CODIGO_Y_OT', 'HECHO'),
    paso(7, 'FACTURA', 'AHORA', { puesto: 'Contabilidad', dias: 2, espera: 'FACTURA' }),
  ])
  assert.deepEqual(pasos.map((p) => p.titulo), ['Subida', 'Rechazada', 'Corrección subida', 'Aprobada', 'Código interno y OT cargados', 'Código interno y OT cargados', 'Factura'])
  assert.equal(pasos[2].nota, 'Pasó a la versión 2')
  assert.equal(pasos[4].nota, 'OT 9357-2026')
  assert.equal(pasos[5].nota, null)
  assert.equal(pasos[6].nota, 'Registra su factura.')
})

test('un paso que este mapa no conoce se pinta en llano, no se esconde', () => {
  const [hecho, ahora] = describirRecorridoDelRequerimiento([
    paso(1, 'PASO_NUEVO', 'HECHO', { detalle: 'algo' }),
    paso(2, 'OTRO_PASO', 'AHORA', { espera: 'ESPERA_NUEVA' }),
  ])
  assert.equal(hecho.titulo, 'paso nuevo')
  assert.equal(hecho.nota, null)
  assert.equal(ahora.titulo, 'otro paso')
  assert.equal(ahora.nota, null)
})
