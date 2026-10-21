import test from 'node:test'
import assert from 'node:assert/strict'
import { paginaPedida, paginaQueExiste } from './paginas.ts'

const sinContar = async () => assert.fail('no debía contar')

test('una página que existe se queda', async () => {
  assert.equal(await paginaQueExiste(1, 25, { error: null, count: 0, filas: 0 }, sinContar), null)
  assert.equal(await paginaQueExiste(2, 25, { error: null, count: 40, filas: 15 }, sinContar), null)
})

test('PostgREST rechaza la página (PGRST103): se cuenta y se va a la última', async () => {
  assert.equal(await paginaQueExiste(999, 25, { error: { code: 'PGRST103' }, count: null, filas: 0 }, async () => 3), 1)
  assert.equal(await paginaQueExiste(13, 50, { error: { code: 'PGRST103' }, count: null, filas: 0 }, async () => 572), 12)
})

test('el banco la devuelve vacía con su total: se va a la última sin contar otra vez', async () => {
  assert.equal(await paginaQueExiste(13, 50, { error: null, count: 572, filas: 0 }, sinContar), 12)
  assert.equal(await paginaQueExiste(3, 25, { error: null, count: 0, filas: 0 }, sinContar), 1)
})

test('otro error no se toca: lo lanza quien consulta', async () => {
  assert.equal(await paginaQueExiste(5, 25, { error: { code: '57014' }, count: null, filas: 0 }, sinContar), null)
})

test('la página de la dirección sale entera y en su rango', () => {
  assert.equal(paginaPedida(undefined), 1)
  assert.equal(paginaPedida('3'), 3)
  assert.equal(paginaPedida(['4', '5']), 4)
  for (const raro of ['0', '-2', '2.5', 'Infinity', 'abc', '', '1e3']) assert.equal(paginaPedida(raro), 1, raro)
  assert.equal(paginaPedida('99999999999999999999999'), 1)
  assert.equal(paginaPedida('250000'), 100000)
})
