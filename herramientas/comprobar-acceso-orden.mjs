import assert from 'node:assert/strict'
import { seccionesDeOrden } from '../src/lib/dominio/acceso-orden.ts'

const perfil = (codigo, permisos) => ({ rol: { codigo, nombre: codigo, nivel: 0 }, permisos })
assert.deepEqual(seccionesDeOrden(perfil('VENDEDOR', ['ordenes.ver','cotizaciones.ver'])), ['resumen','bitacora'])
assert.deepEqual(seccionesDeOrden(perfil('SIN_ACCESO', ['produccion.ver'])), [])
const operario = seccionesDeOrden(perfil('OPERARIO', ['ordenes.ver','ordenes.listar','produccion.ver','produccion.registrar']))
assert.ok(operario.includes('planos') && operario.includes('actividades') && operario.includes('avance'))
const oficina = seccionesDeOrden(perfil('ADMINISTRACION', ['ordenes.ver','ordenes.listar','ordenes.editar','cotizaciones.costear']))
assert.ok(oficina.includes('materiales') && oficina.includes('ficha'))
assert.ok(!oficina.includes('planos') && !oficina.includes('actividades') && !oficina.includes('avance'))
const diseno = seccionesDeOrden(perfil('DISENO', ['ordenes.ver','diseno.planos','produccion.ver']))
assert.ok(diseno.includes('planos') && diseno.includes('actividades'))
assert.ok(seccionesDeOrden(perfil('CALIDAD', ['ordenes.ver'])).includes('planos'))
assert.equal(seccionesDeOrden(perfil('ADMIN', [])).length, 9)
console.log('Accesos de OT: Ventas, Administración, Operario, Diseño, Calidad, Admin y sin permiso comprobados')
