import test from 'node:test'
import assert from 'node:assert/strict'
import { esPlacaRepetida, placaRepetida } from './unidades.ts'

// La placa repetida en el mismo cliente dice cuál, si es otra al editar, y
// dónde se reactiva la desactivada, que no sale en ninguna lista. El campo de
// la placa la reconoce por su principio, diga lo que diga después.
test('la placa repetida dice cuál, al registrar y al editar, y la desactivada dónde se reactiva', () => {
  assert.equal(placaRepetida('A65-665', { editando: false, desactivada: false }), 'Este cliente ya tiene una unidad con la placa A65-665.')
  assert.equal(placaRepetida('A65-665', { editando: true, desactivada: false }), 'Este cliente ya tiene otra unidad con la placa A65-665.')
  assert.equal(
    placaRepetida('A65-665', { editando: false, desactivada: true }),
    'Este cliente ya tiene una unidad con la placa A65-665, desactivada: Ventas o Diseño la reactivan en Unidades, sin registrarla otra vez.',
  )
  assert.equal(placaRepetida('A65-665', { editando: true, desactivada: true }), 'Este cliente ya tiene otra unidad con la placa A65-665, desactivada.')
  for (const editando of [false, true]) {
    for (const desactivada of [false, true]) assert.ok(esPlacaRepetida(placaRepetida('B12-345', { editando, desactivada })))
  }
  assert.equal(esPlacaRepetida(null), false)
  assert.equal(esPlacaRepetida('Ya existe un registro con esos datos.'), false)
})
