import test from 'node:test'
import assert from 'node:assert/strict'
import { CRITERIOS_DISENO, puntajeDiseno } from './evaluacion-diseno.ts'

test('la evaluación contiene veinte criterios y suma sobre cien', () => {
  assert.equal(CRITERIOS_DISENO.length, 20)
  assert.equal(puntajeDiseno(Array(20).fill(5)), 100)
  assert.equal(puntajeDiseno(Array(20).fill(1)), 20)
  assert.equal(puntajeDiseno([...Array(19).fill(2), 5]), 43)
})

test('rechaza formularios incompletos o puntajes fuera de escala', () => {
  assert.throws(() => puntajeDiseno(Array(19).fill(3)))
  assert.throws(() => puntajeDiseno([...Array(19).fill(3), 6]))
})
