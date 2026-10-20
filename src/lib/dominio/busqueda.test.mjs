import test from 'node:test'
import assert from 'node:assert/strict'
import { coincide, expresionSinTildes, filtroDePalabra, palabrasDeBusqueda } from './busqueda.ts'

test('las palabras salen sin tildes, sin signos y en minúsculas', () => {
  assert.deepEqual(palabrasDeBusqueda('  Camión, CISTERNA (agua) '), ['camion', 'cisterna', 'agua'])
  assert.deepEqual(palabrasDeBusqueda('S.A.C.'), ['sac'])
  assert.deepEqual(palabrasDeBusqueda('SR_04, plancha 3/16 A-36'), ['sr04', 'plancha', '316', 'a36'])
  assert.deepEqual(palabrasDeBusqueda('Año 2026'), ['ano', '2026'])
  assert.deepEqual(palabrasDeBusqueda(''), [])
  assert.deepEqual(palabrasDeBusqueda(undefined), [])
  assert.deepEqual(palabrasDeBusqueda('%,()*"\\'), [])
})

test('no pasan más de cinco palabras ni más de veinticuatro letras entre todas', () => {
  assert.equal(palabrasDeBusqueda('a b c d e f g').length, 5)
  assert.equal(palabrasDeBusqueda('x'.repeat(100))[0].length, 24)
  assert.deepEqual(palabrasDeBusqueda(`${'x'.repeat(19)} abcdefgh zz`), ['x'.repeat(19), 'abcde'])
})

// Con `i`, como el `~*` de Postgres: las mayúsculas sin tilde las iguala la base.
test('la expresión encuentra la palabra con y sin tilde', () => {
  const r = new RegExp(expresionSinTildes('camion'), 'i')
  for (const t of ['CAMIÓN', 'camion', 'Camión']) assert.ok(r.test(t), t)
  assert.ok(new RegExp(expresionSinTildes('agricola'), 'i').test('AGRÍCOLA SAN JUAN'))
  assert.ok(new RegExp(expresionSinTildes('pena'), 'i').test('PEÑA'))
  assert.match(expresionSinTildes('sr04'), /^[a-zA-Z0-9[\]._/?áéíóúüñÁÉÍÓÚÜÑ-]+$/)
})

test('la expresión encuentra siglas y códigos con o sin sus signos, y no salta espacios', () => {
  const sac = new RegExp(expresionSinTildes('sac'), 'i')
  assert.ok(sac.test('ACEROS DEL NORTE S.A.C.'))
  assert.ok(!sac.test('PLANCHAS ACERO'))
  assert.ok(new RegExp(expresionSinTildes('sr04'), 'i').test('PLA_SR_04_1'))
  assert.ok(new RegExp(expresionSinTildes('316'), 'i').test('PLANCHA LAC 3/16'))
  assert.ok(!new RegExp(expresionSinTildes('sac'), 'i').test('E.I.R.L.'))
})

test('el filtro lleva cada columna con su expresión entre comillas', () => {
  assert.equal(filtroDePalabra(['placa', 'marca'], '12'), 'placa.imatch."1[._/-]?2",marca.imatch."1[._/-]?2"')
  // La coma y el paréntesis escritos no llegan al filtro.
  assert.equal(filtroDePalabra(['a'], palabrasDeBusqueda('x, y)')[0]), 'a.imatch."x"')
})

test('en una lista ya leída cada palabra tiene que estar en algún campo, en cualquier orden', () => {
  const p = palabrasDeBusqueda('agua cisterna')
  assert.ok(coincide(p, ['COT-0012', 'CISTERNA DE AGUA', null]))
  assert.ok(!coincide(p, ['CISTERNA DE COMBUSTIBLE']))
  assert.ok(coincide(palabrasDeBusqueda('agricola'), ['AGRÍCOLA SAN JUAN S.A.C.']))
  assert.ok(coincide([], ['lo que sea']))
  assert.ok(coincide(palabrasDeBusqueda('nunez pena'), ['TRANSPORTES PEÑA Y NÚÑEZ S.A.C.']))
  assert.ok(coincide(palabrasDeBusqueda('Núñez'), ['NUNEZ']))
  assert.ok(coincide(palabrasDeBusqueda('sac'), ['ACEROS DEL NORTE S.A.C.']))
  assert.ok(coincide(palabrasDeBusqueda('sr04'), ['PLA_SR_04_1']))
  assert.ok(coincide(palabrasDeBusqueda('S.A.C.'), ['ACEROS DEL NORTE SAC']))
  assert.ok(!coincide(palabrasDeBusqueda('S.A.C.'), ['TORNERÍA E.I.R.L.']))
  // Ni salta espacios ni cruza de un campo a otro.
  assert.ok(!coincide(palabrasDeBusqueda('sac'), ['PLANCHAS ACERO']))
  assert.ok(!coincide(palabrasDeBusqueda('ab'), ['XA', 'BX']))
})
