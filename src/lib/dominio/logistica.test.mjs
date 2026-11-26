import test from 'node:test'
import assert from 'node:assert/strict'
import { diaLima } from '../format.ts'
import { enlaceAlMapa, pasosDelDia, telefonoDiceMas, telefonosParaLlamar } from './logistica.ts'

// El teléfono del padrón es texto libre. Antes se juntaban todos sus dígitos en
// un solo tel:, y con dos números el conductor marcaba uno que no existe.
test('el teléfono del proveedor se parte en los números que se pueden marcar', () => {
  assert.deepEqual(telefonosParaLlamar('999 111 222'), [{ texto: '999 111 222', numero: '999111222' }])
  assert.deepEqual(telefonosParaLlamar('999 000 111 - 988 000 222'), [
    { texto: '999 000 111', numero: '999000111' },
    { texto: '988 000 222', numero: '988000222' },
  ])
  assert.deepEqual(telefonosParaLlamar('(01) 445-5667 / Cel. 999111222'), [
    { texto: '(01) 445-5667', numero: '014455667' },
    { texto: '999111222', numero: '999111222' },
  ])
  assert.deepEqual(telefonosParaLlamar('+51 999 111 222'), [{ texto: '+51 999 111 222', numero: '+51999111222' }])
  // El mismo dos veces sale una vez, y lo que no es un número no sale.
  assert.deepEqual(telefonosParaLlamar('999111222, 999 111 222'), [{ texto: '999111222', numero: '999111222' }])
  assert.deepEqual(telefonosParaLlamar('preguntar por Juan'), [])
  assert.deepEqual(telefonosParaLlamar('anexo 12'), [])
  assert.deepEqual(telefonosParaLlamar(null), [])
  // Ninguno se queda sin botón por ser el cuarto.
  assert.equal(telefonosParaLlamar('1111111, 2222222, 3333333, 4444444').length, 4)
})

// Desde un celular, un fijo no entra sin el código de la ciudad.
test('el fijo de Lima escrito sin el 01 se marca con el 01, y se lee como está escrito', () => {
  assert.deepEqual(telefonosParaLlamar('445-5667'), [{ texto: '445-5667', numero: '014455667' }])
  // El mismo con y sin el 01, o con el 51, es uno solo.
  assert.deepEqual(telefonosParaLlamar('4455667 / (01) 4455667').map((n) => n.numero), ['014455667'])
  assert.deepEqual(telefonosParaLlamar('999111222 / +51 999 111 222').map((n) => n.numero), ['999111222'])
  // Seis u ocho cifras no dicen de qué ciudad son, o son un DNI: sin botón.
  assert.deepEqual(telefonosParaLlamar('234567'), [])
  assert.deepEqual(telefonosParaLlamar('DNI 45678912'), [])
  assert.deepEqual(telefonosParaLlamar('123456789'), [])
})

// Segunda pasada del auditor de funcionamiento: «51 (01) 445» se tomaba por número entero y «5667» por su anexo.
test('el 51 del país delante de un fijo con guion no se confunde con un anexo', () => {
  const marca = (t) => telefonosParaLlamar(t).map((n) => n.numero)
  assert.deepEqual(marca('51 (01) 445-5667'), ['+5114455667'])
  assert.deepEqual(marca('51 01 4455667'), ['+5114455667'])
  assert.deepEqual(marca('Fax 4455667'), [])
  assert.deepEqual(marca('Fax 445-5667 / Cel. 999111222'), ['999111222'])
  assert.deepEqual(telefonosParaLlamar('(+51) 999 111 222'), [{ texto: '(+51) 999 111 222', numero: '+51999111222' }])
})

// Un botón que marca otro número es peor que no tener botón: lo dudoso no se marca.
test('el anexo, la clave RPM y el RUC no se marcan como si fueran el teléfono', () => {
  const marca = (t) => telefonosParaLlamar(t).map((n) => n.numero)
  assert.deepEqual(marca('(01) 445-5667 anexo 205'), ['014455667'])
  assert.deepEqual(marca('01 445 5667 ext 3 / 999 111 222'), ['014455667', '999111222'])
  assert.deepEqual(marca('4455667-123'), ['014455667'])
  assert.deepEqual(marca('999111222 opción 2'), ['999111222'])
  assert.deepEqual(marca('Cel. 999111222 RPM #948123'), ['999111222'])
  assert.deepEqual(marca('RPM 948123'), [])
  assert.deepEqual(marca('*123456'), [])
  assert.deepEqual(marca('20123456789'), [])
  assert.deepEqual(marca('999111222 de 8 a 1pm'), ['999111222'])
  // Con el 51 del país se marca con «+», y sin el 0 del código de la ciudad.
  assert.deepEqual(marca('(511) 445-5667'), ['+5114455667'])
  assert.deepEqual(marca('51 999 111 222'), ['+51999111222'])
  assert.deepEqual(marca('+51 (01) 445-5667'), ['+5114455667'])
  // Dos números pegados son dos.
  assert.deepEqual(marca('4455667-4455668'), ['014455667', '014455668'])
  assert.deepEqual(marca('999 111 222 988 777 666'), ['999111222', '988777666'])
})

test('la tarjeta muestra el teléfono del padrón entero cuando dice más que los botones', () => {
  const diceMas = (t) => telefonoDiceMas(t, telefonosParaLlamar(t))
  assert.equal(diceMas('999 111 222'), false)
  assert.equal(diceMas('Cel. 999111222 / Fijo 4455667'), false)
  assert.equal(diceMas('(01) 445-5667 anexo 205'), true)
  assert.equal(diceMas('999111222 (Rosa, de 8 a 1)'), true)
  assert.equal(diceMas('RPM #948123'), true)
  assert.equal(diceMas('20123456789'), true)
  assert.equal(diceMas(null), false)
})

test('la dirección va al mapa con sus tildes y sus comas', () => {
  assert.equal(
    enlaceAlMapa('Av. Argentina 1234, Callao'),
    'https://www.google.com/maps/search/?api=1&query=Av.%20Argentina%201234%2C%20Callao',
  )
})

test('lo de hoy sale en el orden en que pasó, y lo de otro día no', () => {
  const diaDe = (t) => t.slice(0, 10)
  const compras = [
    { id: 'a', nombre: 'OC-1', proveedor: 'ACEROS', recogido_en: '2026-11-25T09:10:00Z', dejado_en: '2026-11-25T11:00:00Z' },
    { id: 'b', nombre: 'OC-2', proveedor: 'PERNOS', recogido_en: '2026-11-25T10:05:00Z', dejado_en: null },
    { id: 'c', nombre: 'OC-3', proveedor: 'PINTURAS', recogido_en: '2026-11-24T16:00:00Z', dejado_en: '2026-11-25T08:00:00Z' },
    { id: 'd', nombre: 'OC-4', proveedor: 'GASES', recogido_en: null, dejado_en: null },
  ]
  assert.deepEqual(
    pasosDelDia(compras, '2026-11-25', diaDe).map((p) => `${p.nombre} ${p.paso}`),
    ['OC-3 DEJADO', 'OC-1 RECOGIDO', 'OC-2 RECOGIDO', 'OC-1 DEJADO'],
  )
  assert.deepEqual(pasosDelDia(compras, '2026-11-26', diaDe), [])
})

// «No se pudo recoger» saca la compra de la lista: el intento de hoy queda en el día.
test('el «No se pudo recoger» de hoy sale con su hora; el de ayer, no', () => {
  const diaDe = (t) => t.slice(0, 10)
  const compras = [
    { id: 'a', nombre: 'OC-1', proveedor: 'ACEROS', recogido_en: '2026-11-25T09:10:00Z', dejado_en: null, no_logrado: null },
    { id: 'b', nombre: 'OC-2', proveedor: 'PERNOS', recogido_en: null, dejado_en: null, no_logrado: { registrado_en: '2026-11-25T08:30:00Z' } },
    { id: 'c', nombre: 'OC-3', proveedor: 'PINTURAS', recogido_en: null, dejado_en: null, no_logrado: { registrado_en: '2026-11-24T17:00:00Z' } },
  ]
  assert.deepEqual(
    pasosDelDia(compras, '2026-11-25', diaDe).map((p) => `${p.nombre} ${p.paso}`),
    ['OC-2 NO_LOGRADO', 'OC-1 RECOGIDO'],
  )
})

// El día es el del taller, no el de UTC: a las 8 de la noche en Lima ya es mañana en UTC.
test('lo de hoy cuenta por el día de Lima, también de noche', () => {
  const compras = [
    { id: 'a', nombre: 'OC-1', proveedor: 'ACEROS', recogido_en: '2026-11-26T00:30:00Z', dejado_en: '2026-11-26T05:10:00Z' },
    { id: 'b', nombre: 'OC-2', proveedor: 'PERNOS', recogido_en: '2026-11-25T04:59:00Z', dejado_en: null },
  ]
  assert.deepEqual(
    pasosDelDia(compras, '2026-11-25', diaLima).map((p) => `${p.nombre} ${p.paso}`),
    ['OC-1 RECOGIDO'],
  )
  assert.deepEqual(
    pasosDelDia(compras, '2026-11-24', diaLima).map((p) => `${p.nombre} ${p.paso}`),
    ['OC-2 RECOGIDO'],
  )
})
