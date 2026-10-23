import test from 'node:test'
import assert from 'node:assert/strict'
import { nombreDeOc, partesDeNombreDeOc } from './adquisiciones.ts'

// Lo que arma `nombre_de_oc` en la base se separa otra vez para el título y la
// línea de abajo, sin perder nada.
test('el nombre de la OC se separa en número y referencia, y vuelve a armarse igual', () => {
  for (const oc of [
    { numero: 'OC-0001-MW', referencia: 'COT-77' },
    { numero: null, referencia: 'OC-0621' },
    { numero: null, referencia: 'PROFORMA (2) 15/10' },
    { numero: null, referencia: null },
  ]) {
    const nombre = nombreDeOc(oc)
    const partes = partesDeNombreDeOc(nombre)
    assert.equal(partes.numero, oc.numero)
    assert.equal(partes.referencia, oc.numero ? null : oc.referencia)
    assert.equal(nombreDeOc(partes), nombre)
  }
})

test('un número de la serie no se toma por una OC sin número', () => {
  assert.deepEqual(partesDeNombreDeOc('OC-0621-MW'), { numero: 'OC-0621-MW', referencia: null })
})
