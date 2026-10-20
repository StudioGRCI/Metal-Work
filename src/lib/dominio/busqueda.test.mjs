import test from 'node:test'
import assert from 'node:assert/strict'
import { coincide, expresionSinTildes, filtroDePalabra, palabrasDeBusqueda } from './busqueda.ts'

test('las palabras salen sin tildes, sin signos y en minúsculas', () => {
  assert.deepEqual(palabrasDeBusqueda('  Camión, CISTERNA (agua) '), ['camion', 'cisterna', 'agua'])
  assert.deepEqual(palabrasDeBusqueda('S.A.C.'), ['s', 'a', 'c'])
  assert.deepEqual(palabrasDeBusqueda('Año 2026'), ['ano', '2026'])
  assert.deepEqual(palabrasDeBusqueda(''), [])
  assert.deepEqual(palabrasDeBusqueda(undefined), [])
  assert.deepEqual(palabrasDeBusqueda('%,()*"\\'), [])
})

test('no pasan más de cinco palabras ni más de cuarenta letras entre todas', () => {
  assert.equal(palabrasDeBusqueda('a b c d e f g').length, 5)
  assert.equal(palabrasDeBusqueda('x'.repeat(100))[0].length, 40)
  assert.deepEqual(palabrasDeBusqueda(`${'x'.repeat(35)} abcdefgh zz`), ['x'.repeat(35), 'abcde'])
})

// Con `i`, como el `~*` de Postgres: las mayúsculas sin tilde las iguala la base.
test('la expresión encuentra la palabra con y sin tilde', () => {
  const r = new RegExp(expresionSinTildes('camion'), 'i')
  for (const t of ['CAMIÓN', 'camion', 'Camión']) assert.ok(r.test(t), t)
  assert.ok(new RegExp(expresionSinTildes('agricola'), 'i').test('AGRÍCOLA VALLE'))
  assert.ok(new RegExp(expresionSinTildes('pena'), 'i').test('PEÑA'))
  assert.match(expresionSinTildes('sr04'), /^[a-zA-Z0-9[\]áàâäéèêëíìîïóòôöúùûüñÁÀÂÄÉÈÊËÍÌÎÏÓÒÔÖÚÙÛÜÑ]+$/)
})

test('el filtro lleva cada columna con su expresión entre comillas', () => {
  assert.equal(filtroDePalabra(['placa', 'marca'], '12'), 'placa.imatch."12",marca.imatch."12"')
  // La coma y el paréntesis escritos no llegan al filtro.
  assert.equal(filtroDePalabra(['a'], palabrasDeBusqueda('x, y)')[0]), 'a.imatch."x"')
})

test('en una lista ya leída cada palabra tiene que estar en algún campo, en cualquier orden', () => {
  const p = palabrasDeBusqueda('agua cisterna')
  assert.ok(coincide(p, ['COT-0012', 'CISTERNA DE AGUA', null]))
  assert.ok(!coincide(p, ['CISTERNA DE COMBUSTIBLE']))
  assert.ok(coincide(palabrasDeBusqueda('agricola'), ['AGRÍCOLA VALLE DE MOCHE S.A.C.']))
  assert.ok(coincide([], ['lo que sea']))
  assert.ok(coincide(palabrasDeBusqueda('nunez pena'), ['TRANSPORTES PEÑA Y NÚÑEZ S.A.C.']))
  assert.ok(coincide(palabrasDeBusqueda('Núñez'), ['NUNEZ']))
  assert.ok(coincide(palabrasDeBusqueda('sac'), ['ACEROS DEL NORTE S.A.C.']))
  assert.ok(coincide(palabrasDeBusqueda('sr04'), ['PLA_SR_04_1']))
})
