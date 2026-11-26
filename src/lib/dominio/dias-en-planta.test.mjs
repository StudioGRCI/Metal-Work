import test from 'node:test'
import assert from 'node:assert/strict'
import { diasEntre, textoEnPlanta, textoEstuvo } from './dias-en-planta.ts'

test('los días entre dos fechas de Lima', () => {
  assert.equal(diasEntre('2026-11-26', '2026-11-26'), 0)
  assert.equal(diasEntre('2026-11-25', '2026-11-26'), 1)
  assert.equal(diasEntre('2026-10-28', '2026-11-26'), 29, 'cruza el mes')
  assert.equal(diasEntre('2026-12-30', '2027-01-02'), 3, 'cruza el año')
})

test('el que sigue adentro', () => {
  assert.equal(textoEnPlanta(0), 'Entró hoy')
  assert.equal(textoEnPlanta(1), '1 día en planta')
  assert.equal(textoEnPlanta(12), '12 días en planta')
})

test('el que ya salió', () => {
  assert.equal(textoEstuvo(0), 'Salió el mismo día')
  assert.equal(textoEstuvo(1), 'Estuvo 1 día')
  assert.equal(textoEstuvo(4), 'Estuvo 4 días')
})
