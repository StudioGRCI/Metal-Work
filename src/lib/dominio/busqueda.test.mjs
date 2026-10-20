import test from 'node:test'
import assert from 'node:assert/strict'
import { coincide, expresionSinTildes, filtroDePalabra, filtrosDeBusqueda, palabrasDeBusqueda } from './busqueda.ts'

test('las palabras salen sin tildes, sin signos y en minúsculas', () => {
  assert.deepEqual(palabrasDeBusqueda('  Camión, CISTERNA (agua) '), ['camion', 'cisterna', 'agua'])
  assert.deepEqual(palabrasDeBusqueda('S.A.C.'), ['sac'])
  assert.deepEqual(palabrasDeBusqueda('SR_04, plancha 3/16 A-36'), ['sr04', 'plancha', '316', 'a36'])
  assert.deepEqual(palabrasDeBusqueda('Año 2026'), ['ano', '2026'])
  assert.deepEqual(palabrasDeBusqueda(''), [])
  assert.deepEqual(palabrasDeBusqueda(undefined), [])
  assert.deepEqual(palabrasDeBusqueda('%,()*"\\'), [])
})

test('la letra suelta no se busca si hay otras, y la sigla del final no se pierde', () => {
  assert.deepEqual(palabrasDeBusqueda('Transportes Peña y Núñez S.A.C.'), ['transportes', 'pena', 'nunez', 'sac'])
  assert.deepEqual(palabrasDeBusqueda('y'), ['y'])
  assert.deepEqual(palabrasDeBusqueda('tubo 2 x 1/4'), ['tubo', '2', '14'])
  // Una palabra larga con guion o punto son dos: la base las encuentra sueltas.
  assert.deepEqual(palabrasDeBusqueda('Mercedes-Benz'), ['mercedes', 'benz'])
  assert.deepEqual(palabrasDeBusqueda('juan.perez'), ['juan', 'perez'])
  assert.deepEqual(palabrasDeBusqueda('E.I.R.L. PLA_SR_O4'), ['eirl', 'plasro4'])
  assert.ok(new RegExp(expresionSinTildes(palabrasDeBusqueda('semi-remolque')[1]), 'i').test('SEMI-REMOLQUE'))
  assert.equal(palabrasDeBusqueda('a1 b2 c3 d4 e5 f6 g7 h8 i9 j10').length, 8)
  assert.equal(palabrasDeBusqueda('x'.repeat(100))[0].length, 20)
})

test('los filtros caben en la dirección y una búsqueda de verdad entra entera', () => {
  const clientes = ['razon_social', 'nombre_comercial', 'numero_documento']
  assert.equal(filtrosDeBusqueda(clientes, 'transportes peña y núñez 123456 s.a.c.').length, 5)
  const unidades = ['placa', 'codigo_interno', 'numero_fmi', 'marca', 'modelo', 'numero_chasis']
  const absurda = filtrosDeBusqueda(unidades, Array(8).fill('u'.repeat(30)).join(' '))
  assert.ok(absurda.length >= 1 && absurda.length < 8)
  assert.ok(absurda.reduce((n, f) => n + encodeURIComponent(f).length, 0) <= 4000)
  assert.deepEqual(filtrosDeBusqueda(unidades, ''), [])
})

// Con `i`, como el `~*` de Postgres: las mayúsculas sin tilde las iguala la base.
test('la expresión encuentra la palabra con y sin tilde', () => {
  const r = new RegExp(expresionSinTildes('camion'), 'i')
  for (const t of ['CAMIÓN', 'camion', 'Camión']) assert.ok(r.test(t), t)
  assert.ok(new RegExp(expresionSinTildes('agricola'), 'i').test('AGRÍCOLA EL EJEMPLO'))
  assert.ok(new RegExp(expresionSinTildes('pena'), 'i').test('PEÑA'))
  assert.match(expresionSinTildes('sr04'), /^[a-z0-9[\] ._/?áéíóúüñÁÉÍÓÚÜÑ-]+$/)
  assert.equal(expresionSinTildes('un'), '[uúüÚÜ][._/-]?[nñÑ]')
  // En una palabra larga sin números no van signos entre letras.
  assert.equal(expresionSinTildes('camion'), 'c[aáÁ]m[iíÍ][oóÓ0][nñÑ]')
})

test('la expresión encuentra siglas y códigos con o sin sus signos, y no salta espacios', () => {
  const sac = new RegExp(expresionSinTildes('sac'), 'i')
  assert.ok(sac.test('ACEROS DEL NORTE S.A.C.'))
  assert.ok(!sac.test('PLANCHAS ACERO'))
  assert.ok(new RegExp(expresionSinTildes('sr04'), 'i').test('PLA_SR_04_1'))
  assert.ok(new RegExp(expresionSinTildes('316'), 'i').test('PLANCHA LAC 3/16'))
  // La O y el cero, como en los códigos internos.
  assert.ok(new RegExp(expresionSinTildes('sr04'), 'i').test('PLA_SR_O4_1_26/28'))
  assert.ok(new RegExp(expresionSinTildes('sro4'), 'i').test('PLA_SR_04_1'))
  assert.ok(!new RegExp(expresionSinTildes('sac'), 'i').test('E.I.R.L.'))
  // La medida pegada encuentra la que lleva espacios.
  assert.ok(new RegExp(expresionSinTildes(palabrasDeBusqueda('2x1/4')[0]), 'i').test('ÁNGULO 2 X 1/4'))
  assert.ok(!new RegExp(expresionSinTildes(palabrasDeBusqueda('2x3/8')[0]), 'i').test('ÁNGULO 2 X 1/4'))
})

test('el filtro lleva cada columna con su expresión entre comillas', () => {
  assert.equal(filtroDePalabra(['placa', 'marca'], '12'), 'placa.imatch."1[ ._/-]?2",marca.imatch."1[ ._/-]?2"')
  // La coma y el paréntesis escritos no llegan al filtro.
  assert.equal(filtroDePalabra(['a'], palabrasDeBusqueda('x, y)')[0]), 'a.imatch."x"')
})

test('en una lista ya leída cada palabra tiene que estar en algún campo, en cualquier orden', () => {
  const p = palabrasDeBusqueda('agua cisterna')
  assert.ok(coincide(p, ['COT-0012', 'CISTERNA DE AGUA', null]))
  assert.ok(!coincide(p, ['CISTERNA DE COMBUSTIBLE']))
  assert.ok(coincide(palabrasDeBusqueda('agricola'), ['AGRÍCOLA EL EJEMPLO S.A.C.']))
  assert.ok(coincide([], ['lo que sea']))
  assert.ok(coincide(palabrasDeBusqueda('nunez pena'), ['TRANSPORTES PEÑA Y NÚÑEZ S.A.C.']))
  assert.ok(coincide(palabrasDeBusqueda('Núñez'), ['NUNEZ']))
  assert.ok(coincide(palabrasDeBusqueda('sac'), ['ACEROS DEL NORTE S.A.C.']))
  assert.ok(coincide(palabrasDeBusqueda('sr04'), ['PLA_SR_04_1']))
  assert.ok(coincide(palabrasDeBusqueda('sr04'), ['PLA_SR_O4_1_26/28']))
  assert.ok(coincide(palabrasDeBusqueda('camion'), ['CAMIÓN']))
  assert.ok(coincide(palabrasDeBusqueda('S.A.C.'), ['ACEROS DEL NORTE SAC']))
  assert.ok(!coincide(palabrasDeBusqueda('S.A.C.'), ['TORNERÍA E.I.R.L.']))
  // Ni salta espacios ni cruza de un campo a otro.
  assert.ok(!coincide(palabrasDeBusqueda('sac'), ['PLANCHAS ACERO']))
  assert.ok(!coincide(palabrasDeBusqueda('ab'), ['XA', 'BX']))
  // La medida pegada encuentra la del catálogo con espacios.
  assert.ok(coincide(palabrasDeBusqueda('ANGULO 2X1/4'), ['ÁNGULO 2 X 1/4']))
  assert.ok(!coincide(palabrasDeBusqueda('ANGULO 2X3/8'), ['ÁNGULO 2 X 1/4']))
})
