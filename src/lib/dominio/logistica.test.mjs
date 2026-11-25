import test from 'node:test'
import assert from 'node:assert/strict'
import { enlaceAlMapa, pasosDelDia, telefonosParaLlamar } from './logistica.ts'

// El teléfono del padrón es texto libre. Antes se juntaban todos sus dígitos en
// un solo tel:, y con dos números el conductor marcaba uno que no existe.
test('el teléfono del proveedor se parte en los números que se pueden marcar', () => {
  assert.deepEqual(telefonosParaLlamar('999 111 222'), [{ texto: '999 111 222', numero: '999111222' }])
  assert.deepEqual(telefonosParaLlamar('940 843 031 - 980 926 670'), [
    { texto: '940 843 031', numero: '940843031' },
    { texto: '980 926 670', numero: '980926670' },
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
  assert.equal(telefonosParaLlamar('1111111, 2222222, 3333333, 4444444').length, 3)
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
