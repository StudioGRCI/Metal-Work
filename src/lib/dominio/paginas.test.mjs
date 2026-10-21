import test from 'node:test'
import assert from 'node:assert/strict'
import { paginaQueExiste } from './paginas.ts'

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
