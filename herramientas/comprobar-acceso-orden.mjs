import assert from 'node:assert/strict'
import { seccionesDeOrden } from '../src/lib/dominio/acceso-orden.ts'

const perfil = (codigo, permisos) => ({ rol: { codigo, nombre: codigo, nivel: 0 }, permisos })
assert.deepEqual(seccionesDeOrden(perfil('VENDEDOR', ['ordenes.ver','cotizaciones.ver'])), ['resumen','expediente','entrega','bitacora'])
assert.deepEqual(seccionesDeOrden(perfil('SIN_ACCESO', ['produccion.ver'])), [])
const operario = seccionesDeOrden(perfil('OPERARIO', ['ordenes.ver','ordenes.listar','produccion.ver','produccion.registrar']))
assert.ok(operario.includes('planos') && operario.includes('actividades') && operario.includes('avance'))
const permisosOficina = ['ordenes.ver','ordenes.listar','ordenes.editar','cotizaciones.costear']
// En la OT de una cotización, la ficha y las etapas de Administración están en
// el código interno desde el 2026-10-26; la orden sin cotización las conserva.
const oficina = seccionesDeOrden(perfil('ADMINISTRACION', permisosOficina), { avance_del_codigo: 'SRQ_PL_N3_2_26/41' })
assert.ok(oficina.includes('materiales') && !oficina.includes('ficha') && !oficina.includes('etapas'))
assert.ok(!oficina.includes('planos') && !oficina.includes('actividades') && !oficina.includes('avance'))
const oficinaSinCotizacion = seccionesDeOrden(perfil('ADMINISTRACION', permisosOficina), { avance_del_codigo: null })
assert.ok(oficinaSinCotizacion.includes('ficha') && oficinaSinCotizacion.includes('etapas'))
const taller = seccionesDeOrden(perfil('JEFE_TALLER', ['ordenes.ver','ordenes.listar','ordenes.editar','produccion.ver']))
assert.ok(taller.includes('ficha') && taller.includes('etapas'))
const diseno = seccionesDeOrden(perfil('DISENO', ['ordenes.ver','diseno.planos','produccion.ver']))
assert.ok(diseno.includes('planos') && diseno.includes('actividades'))
assert.ok(seccionesDeOrden(perfil('CALIDAD', ['ordenes.ver'])).includes('planos'))
assert.equal(seccionesDeOrden(perfil('ADMIN', [])).length, 11)
console.log('Accesos de OT: Ventas, Administración, Operario, Diseño, Calidad, Admin y sin permiso comprobados')
