import test from 'node:test'
import assert from 'node:assert/strict'
import { comoVaLaEntrega, cuentaDelInsumo } from './cuenta-del-insumo.ts'

const suma = (c) => Math.round((c.separado + c.porLlegar + c.porComprar + c.porRevisar) * 1000) / 1000

test('la entrega parcial dice cuánto falta y dónde está', () => {
  // 10 pedidos, Almacén tenía 3, se compraron 7 y llegaron 2; salieron 4.
  const c = cuentaDelInsumo(10, { entregado: 4, recoger: 1, porLlegar: 5, revisar: 0 }, true)
  assert.deepEqual(c, { pedido: 10, entregado: 4, falta: 6, separado: 1, porLlegar: 5, porComprar: 0, porRevisar: 0 })
  assert.equal(comoVaLaEntrega(c), 'PARCIAL')
  assert.equal(suma(c), c.falta)
})

test('sin OC viva, lo que falta es por comprar, no por llegar', () => {
  const c = cuentaDelInsumo(10, { entregado: 0, recoger: 3, porLlegar: 7, revisar: 0 }, false)
  assert.equal(c.porComprar, 7)
  assert.equal(c.porLlegar, 0)
  assert.equal(comoVaLaEntrega(c), 'NADA')
})

test('lo entregado completo no deja nada separado ni por llegar', () => {
  const c = cuentaDelInsumo(5, { entregado: 5, recoger: 0, porLlegar: 0, revisar: 0 }, true)
  assert.equal(c.falta, 0)
  assert.equal(comoVaLaEntrega(c), 'COMPLETA')
})

test('las cantidades en metros no arrastran decimales de coma flotante', () => {
  const c = cuentaDelInsumo(5.3, { entregado: 2.1, recoger: 3.2, porLlegar: 0, revisar: 0 }, true)
  assert.equal(c.falta, 3.2)
  assert.equal(c.separado, 3.2)
  assert.equal(suma(c), c.falta)
})

test('las partes nunca suman más de lo que falta', () => {
  // Partes viejas o inconsistentes: lo separado y lo por llegar se recortan a lo que falta.
  const c = cuentaDelInsumo(10, { entregado: 8, recoger: 5, porLlegar: 5, revisar: 0 }, true)
  assert.equal(c.falta, 2)
  assert.equal(c.separado, 2)
  assert.equal(c.porLlegar, 0)
  assert.equal(suma(c), c.falta)
})

test('lo que Almacén no revisó va como por revisar', () => {
  const c = cuentaDelInsumo(4, { entregado: 0, recoger: 0, porLlegar: 0, revisar: 4 }, false)
  assert.equal(c.porRevisar, 4)
  assert.equal(c.porComprar, 0)
})
