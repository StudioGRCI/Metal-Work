import test from 'node:test'
import assert from 'node:assert/strict'
import { diasDeAvisoDesdeTexto, diasDeAvisoEnTexto, nombreDeLaUnidad, plazoDelTramite } from './tramites.ts'

test('los días de aviso: como los escribe la persona, de más a menos y sin repetir', () => {
  assert.deepEqual(diasDeAvisoDesdeTexto('30, 15 y 7'), [30, 15, 7])
  assert.deepEqual(diasDeAvisoDesdeTexto('5 20 5'), [20, 5])
  assert.deepEqual(diasDeAvisoDesdeTexto('0'), [0])
  assert.deepEqual(diasDeAvisoDesdeTexto('7;15'), [15, 7])
})

test('los días de aviso: lo que no es de 0 a 120, o no deja de uno a cinco, no vale', () => {
  assert.equal(diasDeAvisoDesdeTexto(''), null)
  assert.equal(diasDeAvisoDesdeTexto('121'), null)
  assert.equal(diasDeAvisoDesdeTexto('-5'), null)
  assert.equal(diasDeAvisoDesdeTexto('siete'), null)
  assert.equal(diasDeAvisoDesdeTexto('7.5'), null)
  assert.equal(diasDeAvisoDesdeTexto('60, 45, 30, 15, 7, 1'), null)
})

test('los días de aviso: como se leen en el catálogo', () => {
  assert.equal(diasDeAvisoEnTexto([30, 15, 7]), '30, 15 y 7 días antes')
  assert.equal(diasDeAvisoEnTexto([5]), '5 días antes')
  assert.equal(diasDeAvisoEnTexto([1]), '1 día antes')
  assert.equal(diasDeAvisoEnTexto([0]), 'El mismo día')
  assert.equal(diasDeAvisoEnTexto([]), 'Sin avisos')
})

test('el plazo: vencido y hoy en rojo, la semana en ámbar, lo demás neutro', () => {
  assert.equal(plazoDelTramite(null), null)
  assert.deepEqual(plazoDelTramite(-3), { texto: 'Venció hace 3 días', tono: 'peligro' })
  assert.deepEqual(plazoDelTramite(-1), { texto: 'Venció hace 1 día', tono: 'peligro' })
  assert.deepEqual(plazoDelTramite(0), { texto: 'Vence hoy', tono: 'peligro' })
  assert.deepEqual(plazoDelTramite(1), { texto: 'Vence mañana', tono: 'aviso' })
  assert.deepEqual(plazoDelTramite(7), { texto: 'Vence en 7 días', tono: 'aviso' })
  assert.deepEqual(plazoDelTramite(8), { texto: 'Vence en 8 días', tono: 'neutro' })
})

test('la unidad se nombra por su placa, su código y su carrocería', () => {
  assert.equal(nombreDeLaUnidad({ placa: 'C4L-118', codigo_interno: 'M-0045', carroceria: 'Furgón' }), 'C4L-118 · M-0045 · Furgón')
  assert.equal(nombreDeLaUnidad({ placa: null, codigo_interno: null, carroceria: 'Furgón' }), 'Sin placa · Furgón')
})
