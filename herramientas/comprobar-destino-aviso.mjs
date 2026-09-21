import assert from 'node:assert/strict'
import { destinoAviso } from '../src/lib/dominio/destino-aviso.ts'
for (const ruta of [null, '', 'https://ejemplo.com', '//ejemplo.com', '/\\ejemplo.com', '/\nejemplo.com', 'javascript:alert(1)']) assert.equal(destinoAviso(ruta, null), null)
assert.equal(destinoAviso('/ordenes/123', 'pieza'), '/ordenes/123#pieza')
assert.equal(destinoAviso('/avisos?ver=sin-leer', null), '/avisos?ver=sin-leer')
assert.equal(destinoAviso('/ordenes/123#original', 'otro'), '/ordenes/123#original')
console.log('Destinos internos y rechazo de rutas externas comprobados')
