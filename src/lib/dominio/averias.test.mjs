import test from 'node:test'
import assert from 'node:assert/strict'

import { horas, horasParadoSugeridas, ordenarBandeja } from './averias.ts'

test('la bandeja va por gravedad y, en la misma gravedad, por días en espera', () => {
  const bandeja = ordenarBandeja([
    { numero: 'posible vieja', gravedad: 5, dias_en_espera: 9, creado_en: '2026-11-17T10:00:00Z' },
    { numero: 'detiene de hoy', gravedad: 2, dias_en_espera: 0, creado_en: '2026-11-26T10:00:00Z' },
    { numero: 'detiene de hace 3', gravedad: 2, dias_en_espera: 3, creado_en: '2026-11-23T10:00:00Z' },
    { numero: 'riesgo y detiene', gravedad: 1, dias_en_espera: 0, creado_en: '2026-11-26T11:00:00Z' },
    { numero: 'detiene de hoy, antes', gravedad: 2, dias_en_espera: 0, creado_en: '2026-11-26T08:00:00Z' },
  ])
  assert.deepEqual(
    bandeja.map((a) => a.numero),
    ['riesgo y detiene', 'detiene de hace 3', 'detiene de hoy, antes', 'detiene de hoy', 'posible vieja'],
  )
})

test('las horas parado se proponen desde que quedó parado, a la media hora', () => {
  const ahora = new Date('2026-11-26T15:00:00Z')
  assert.equal(horasParadoSugeridas('2026-11-25T12:40:00Z', ahora), 26.5)
  assert.equal(horasParadoSugeridas('2026-11-26T14:50:00Z', ahora), 0)
  assert.equal(horasParadoSugeridas(null, ahora), null)
  // Un reloj adelantado no da horas negativas.
  assert.equal(horasParadoSugeridas('2026-11-26T16:00:00Z', ahora), null)
})

test('las horas se dicen con punto decimal y en singular cuando es una', () => {
  assert.equal(horas(1), '1 hora')
  assert.equal(horas(26.5), '26.5 horas')
  assert.equal(horas(0), '0 horas')
})
