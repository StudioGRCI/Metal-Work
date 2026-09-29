import test from 'node:test'
import assert from 'node:assert/strict'
import { inicioSemanaDiseno, finSemanaDiseno } from './semana-diseno.ts'

test('agrupa las fechas en semanas de lunes a domingo', () => {
  assert.equal(inicioSemanaDiseno('2026-09-29'), '2026-09-28')
  assert.equal(finSemanaDiseno('2026-09-29'), '2026-10-04')
  assert.equal(inicioSemanaDiseno('2026-10-04'), '2026-09-28')
})

test('rechaza fechas inexistentes', () => {
  assert.throws(() => inicioSemanaDiseno('2026-02-30'))
})
