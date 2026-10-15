import test from 'node:test'
import assert from 'node:assert/strict'
import { cambiosDeCorreccion, idsDeCorreccion, problemaDelJustificante, rutaDeJustificante } from './correcciones.ts'

const f = {
  dinero: (n, m) => `${m} ${n.toFixed(2)}`,
  cantidad: (n) => String(n),
  fecha: (iso) => iso.split('-').reverse().join('/'),
  oc: (id) => ({ a: 'OC-5583-MW', b: 'OC-5584-MW', c: 'OC-5590-MW' })[id] ?? null,
  material: (id) => ({ m1: 'Plancha LAC 2 mm' })[id] ?? null,
}

test('el justificante va en PDF o foto, con la ruta que pide la base', () => {
  assert.equal(rutaDeJustificante('doc', 'corr', 'application/pdf'), 'doc/corr.pdf')
  assert.equal(rutaDeJustificante('doc', 'corr', 'image/jpeg'), 'doc/corr.jpg')
  assert.equal(rutaDeJustificante('doc', 'corr', 'text/plain'), null)
  assert.match(problemaDelJustificante(null), /Adjunta el justificante/)
  assert.match(problemaDelJustificante({ size: 10, type: 'application/zip' }), /PDF o en foto/)
  assert.match(problemaDelJustificante({ size: 11 * 1024 * 1024, type: 'image/png' }), /10 MB/)
  assert.equal(problemaDelJustificante({ size: 10, type: 'image/png' }), null)
})

test('la corrección del requerimiento dice qué insumo y qué cantidad cambiaron', () => {
  const antes = {
    codigo_interno: 'SR-1', justificacion: 'Para la plataforma', fecha_requerida: null,
    lineas: [{ item: 1, descripcion: 'Plancha 2 mm', cantidad: 4, material_id: 'm1' }, { item: 2, descripcion: 'Disco', cantidad: 2, material_id: 'm2' }],
  }
  const despues = {
    ...antes, codigo_interno: 'SR-2', fecha_requerida: '2026-10-20',
    lineas: [{ item: 1, descripcion: 'Plancha 3 mm', cantidad: 6, material_id: 'm3' }, antes.lineas[1]],
  }
  assert.deepEqual(cambiosDeCorreccion('REQUERIMIENTO', antes, despues, f), [
    'Código interno: SR-1 → SR-2',
    'Se necesita el: — → 20/10/2026',
    'Insumo 1: Plancha 2 mm → Plancha 3 mm',
    'Cantidad del insumo 1: 4 → 6',
  ])
})

test('la corrección de la OC nombra el material de la línea y su precio sin IGV', () => {
  const antes = { con_factura: true, codigo_interno: 'PLANTA', lineas: [{ detalle_id: 'd1', material_id: 'm1', cantidad: 10, precio_unitario: 100 }] }
  const despues = { con_factura: false, codigo_interno: 'PLANTA', lineas: [{ detalle_id: 'd1', material_id: 'm1', cantidad: 10, precio_unitario: 95.5 }] }
  assert.deepEqual(cambiosDeCorreccion('ORDEN_COMPRA', antes, despues, f, 'PEN'), [
    'Comprobante: con factura → sin factura',
    'Precio sin IGV de Plancha LAC 2 mm: PEN 100.00 → PEN 95.50',
  ])
})

test('la corrección de la factura dice el total y qué OC entraron y salieron', () => {
  const antes = { proveedor: 'ACEROS', numero_documento: 'F001-1', moneda: 'PEN', total: 1180, condicion_pago: 'CONTADO', ruta_storage: 'x', ordenes: ['a', 'b'] }
  const despues = { ...antes, total: 1185.9, ruta_storage: 'y', ordenes: ['a', 'c'] }
  assert.deepEqual(cambiosDeCorreccion('FACTURA_COMPRA', antes, despues, f), [
    'Total: PEN 1180.00 → PEN 1185.90',
    'Se reemplazó el PDF de la factura.',
    'Se sumó la OC-5590-MW.',
    'Salió la OC-5584-MW (queda anotada como quitada).',
  ])
  assert.deepEqual(idsDeCorreccion(antes, despues), { ordenes: ['a', 'b', 'c'], materiales: [] })
})
