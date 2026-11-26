import test from 'node:test'
import assert from 'node:assert/strict'
import {
  agruparPorVencimiento,
  diasDelVencimiento,
  diasDesdeHoy,
  finDeLaSemana,
  grupoDeVencimiento,
  totalesPorMoneda,
} from './vencimiento.ts'

// 2026-11-26 es jueves: la semana termina el domingo 29.
const HOY = '2026-11-26'

test('la semana va de lunes a domingo', () => {
  assert.equal(finDeLaSemana('2026-11-23'), '2026-11-29') // lunes
  assert.equal(finDeLaSemana(HOY), '2026-11-29') // jueves
  assert.equal(finDeLaSemana('2026-11-28'), '2026-11-29') // sábado
  assert.equal(finDeLaSemana('2026-11-29'), '2026-11-29') // domingo: es su último día
  assert.equal(finDeLaSemana('2026-12-28'), '2027-01-03') // cruza el año
})

test('cada vencimiento cae en su grupo, mirado hoy', () => {
  assert.equal(grupoDeVencimiento('2026-11-25', HOY), 'VENCIDO')
  assert.equal(grupoDeVencimiento('2026-01-02', HOY), 'VENCIDO')
  assert.equal(grupoDeVencimiento(HOY, HOY), 'HOY')
  assert.equal(grupoDeVencimiento('2026-11-27', HOY), 'SEMANA')
  assert.equal(grupoDeVencimiento('2026-11-29', HOY), 'SEMANA')
  assert.equal(grupoDeVencimiento('2026-11-30', HOY), 'DESPUES')
  assert.equal(grupoDeVencimiento(null, HOY), 'SIN_FECHA')
  assert.equal(grupoDeVencimiento('', HOY), 'SIN_FECHA')
  // El domingo, mañana ya es la semana siguiente.
  assert.equal(grupoDeVencimiento('2026-11-30', '2026-11-29'), 'DESPUES')
})

test('una fecha con hora se lee por su día, sin correrse', () => {
  assert.equal(diasDesdeHoy('2026-11-26T23:59:00', HOY), 0)
  assert.equal(grupoDeVencimiento('2026-11-25T00:00:00Z', HOY), 'VENCIDO')
})

test('los días de cada fila se dicen como se habla', () => {
  assert.equal(diasDesdeHoy('2026-11-20', HOY), -6)
  assert.equal(diasDesdeHoy('2026-12-01', HOY), 5)
  assert.equal(diasDesdeHoy('2027-03-01', '2027-02-28'), 1) // febrero corto
  assert.equal(diasDelVencimiento(-6), 'hace 6 días')
  assert.equal(diasDelVencimiento(-1), 'hace 1 día')
  assert.equal(diasDelVencimiento(0), 'hoy')
  assert.equal(diasDelVencimiento(1), 'mañana')
  assert.equal(diasDelVencimiento(5), 'en 5 días')
})

test('soles y dólares se suman aparte, nunca juntos', () => {
  const filas = [
    { moneda: 'PEN', monto: 100.1 },
    { moneda: 'USD', monto: 50 },
    { moneda: null, monto: 0.2 }, // sin moneda se lee como soles, igual que en toda la aplicación
    { moneda: 'USD', monto: 25.55 },
  ]
  assert.deepEqual(
    totalesPorMoneda(filas, (f) => f.moneda, (f) => f.monto),
    { PEN: 100.3, USD: 75.55 },
  )
})

test('los grupos salen en orden de urgencia, sin los vacíos, y lo más vencido primero', () => {
  const filas = [
    { id: 'a', dia: '2026-12-15' },
    { id: 'b', dia: '2026-11-20' },
    { id: 'c', dia: null },
    { id: 'd', dia: '2026-11-25' },
    { id: 'e', dia: '2026-11-28' },
    { id: 'f', dia: '2026-11-20' },
  ]
  const grupos = agruparPorVencimiento(filas, (f) => f.dia, HOY)
  assert.deepEqual(
    grupos.map((g) => [g.grupo, g.filas.map((f) => f.id)]),
    [
      ['VENCIDO', ['b', 'f', 'd']],
      ['SEMANA', ['e']],
      ['DESPUES', ['a']],
      ['SIN_FECHA', ['c']],
    ],
  )
})
