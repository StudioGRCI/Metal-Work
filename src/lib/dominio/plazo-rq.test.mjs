import test from 'node:test'
import assert from 'node:assert/strict'
import { diasHastaElDomingo, estaVencido, loQueLoAtrasa, plazoDelRq, seNecesitaEstaSemana, textoDelPlazo } from './plazo-rq.ts'

test('solo el RQ con algo por entregar tiene plazo', () => {
  for (const estado of ['POR_ATENDER', 'SIN_STOCK', 'EN_ATENCION', 'LISTO_EN_ALMACEN']) assert.equal(plazoDelRq(estado, -2), -2)
  assert.equal(plazoDelRq('ENTREGADO', -2), null)
  assert.equal(plazoDelRq('ANULADO', -2), null)
  assert.equal(plazoDelRq('POR_ATENDER', null), null, 'sin fecha no hay plazo')
})

test('vencido es la fecha pasada, no la de hoy', () => {
  assert.equal(estaVencido(-1), true)
  assert.equal(estaVencido(0), false)
  assert.equal(estaVencido(null), false)
})

test('la semana va de lunes a domingo', () => {
  assert.equal(diasHastaElDomingo('2026-11-23'), 6) // lunes
  assert.equal(diasHastaElDomingo('2026-11-26'), 3) // jueves
  assert.equal(diasHastaElDomingo('2026-11-29'), 0) // domingo
})

test('«esta semana» va de hoy al domingo, sin los vencidos', () => {
  const jueves = '2026-11-26'
  assert.equal(seNecesitaEstaSemana(0, jueves), true)
  assert.equal(seNecesitaEstaSemana(3, jueves), true, 'el domingo entra')
  assert.equal(seNecesitaEstaSemana(4, jueves), false, 'el lunes que viene no')
  assert.equal(seNecesitaEstaSemana(-1, jueves), false, 'el vencido va en su filtro')
  assert.equal(seNecesitaEstaSemana(0, '2026-11-29'), true, 'el domingo, solo hoy')
  assert.equal(seNecesitaEstaSemana(1, '2026-11-29'), false)
})

test('el plazo se dice como se habla', () => {
  assert.deepEqual(textoDelPlazo(-1), { etiqueta: 'Vencido hace 1 día', tono: 'peligro' })
  assert.deepEqual(textoDelPlazo(-3), { etiqueta: 'Vencido hace 3 días', tono: 'peligro' })
  assert.deepEqual(textoDelPlazo(0), { etiqueta: 'Se necesita hoy', tono: 'aviso' })
  assert.deepEqual(textoDelPlazo(1), { etiqueta: 'Se necesita mañana', tono: 'aviso' })
  assert.deepEqual(textoDelPlazo(5), { etiqueta: 'Faltan 5 días', tono: 'neutro' })
})

test('lo que atrasa el RQ: primero lo que ya se puede recoger', () => {
  const p = (recoger, porLlegar, revisar) => ({ recoger, porLlegar, revisar })
  assert.deepEqual(
    loQueLoAtrasa([
      { item: 1, partes: p(0, 4, 0) },
      { item: 2, partes: p(2, 0, 0) },
      { item: 3, partes: p(1, 3, 0) },
      { item: 4, partes: p(0, 0, 0) },
      { item: 5, partes: null },
    ]),
    ['los insumos 2 y 3, para recoger en Almacén', 'los insumos 1 y 3, por llegar'],
  )
  assert.deepEqual(loQueLoAtrasa([{ item: 1, partes: p(0, 0, 5) }]), ['el insumo 1, por revisar en Almacén'])
  assert.deepEqual(loQueLoAtrasa([{ item: 1, partes: p(0, 0, 0) }]), [])
})
