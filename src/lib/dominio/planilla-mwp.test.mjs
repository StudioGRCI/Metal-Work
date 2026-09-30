import test from 'node:test'
import assert from 'node:assert/strict'
import {leerPlanillaMwp} from './planilla-mwp.ts'

function boleta(net=950.25){return [
 [null,'NOMBRES Y APELLIDOS','Persona de prueba'],
 [null,'PUESTO DE TRABAJO:','Diseñador'],[],[null,30,240,null,2],
 [null,'SUELDO',1000.25,'AFP',50],
 [null,'TOTAL',1000.25,'TOTAL',50],
 [null,'ESSALUD',null,null,90.02],
 [null,'NETO A RECIBIR',null,net],
]}
test('extrae bloques, conserva su fila y separa neto de costo empresa',()=>{
 const filas=leerPlanillaMwp([...boleta(),...boleta()])
 assert.equal(filas.length,2)
 assert.deepEqual(filas.map(f=>f.fila),[1,9])
 assert.equal(filas[0].detalle.neto,950.25)
 assert.equal(filas[0].detalle.aporte_empleador,90.02)
 assert.equal(filas[0].detalle.conceptos.length,2)
})
test('rechaza boletas que no cuadran y hojas sin detalle MWP',()=>{
 assert.throws(()=>leerPlanillaMwp(boleta(999)),/no cuadra/)
 assert.throws(()=>leerPlanillaMwp([['DASHBOARD']]),/No se encontraron/)
 assert.throws(()=>leerPlanillaMwp(boleta().slice(0,6)),/totales completos/)
})
