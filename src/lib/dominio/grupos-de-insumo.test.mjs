import assert from 'node:assert/strict'
import { test } from 'node:test'
import { delGrupo, gruposDeInsumo, GRUPO_NIPLERIA } from './grupos-de-insumo.ts'

const m = (categoria, codigo = null, descripcion = 'Material') => ({ categoria, codigo, descripcion })

test('las categorías que solo difieren en tildes o mayúsculas son un grupo, con el nombre más usado', () => {
  const materiales = [
    m('SISTEMA ELECTRICO'), m('SISTEMA ELECTRICO'), m('SISTEMA ELECTRICO'), m('Sistema eléctrico'), m('Sistema  eléctrico'),
    m('POR CLASIFICAR'), m('ACCESORIOS ESTRUCTURALES', 'AE-ET-AC-SD-01', 'NIPLE SOLDABLE 1/2'), m('SISTEMA HIDRAULICO', 'SH-NI-01', 'CONECTOR'),
  ]
  const grupos = gruposDeInsumo(materiales)
  const electrico = grupos.find((g) => g.nombre === 'SISTEMA ELECTRICO')
  assert.equal(electrico?.cuantos, 5)
  assert.equal(grupos.filter((g) => /el[eé]ctrico/i.test(g.nombre)).length, 1)
  assert.equal(grupos.at(-1)?.nombre, 'POR CLASIFICAR')
  assert.equal(grupos.find((g) => g.clave === GRUPO_NIPLERIA)?.cuantos, 2)
  // El buscador del grupo trae los cinco, escritos como estén.
  assert.equal(materiales.filter((x) => delGrupo(x, electrico.clave)).length, 5)
})
