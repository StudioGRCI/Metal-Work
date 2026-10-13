import test from 'node:test'
import assert from 'node:assert/strict'
import {igvCompra,importeCompra,totalCompra} from './compra-materiales.ts'

test('el total cuadra con cada línea redondeada y omite importes pendientes',()=>{
 assert.equal(importeCompra(0.005,1),0.01)
 assert.equal(totalCompra([{cantidad:0.005,precio:1},{cantidad:0.005,precio:1},{cantidad:10,precio:null}]),0.02)
 assert.equal(totalCompra([{cantidad:3,precio:12.31},{cantidad:0.333,precio:3}]),37.93)
})

test('el IGV y el total cuadran con la OC-5572 que la empresa dio de modelo',()=>{
 // Subtotal 355.93, IGV 64.07, total 420.00. (Su precio 59.32 viene de 70/1.18
 // con más decimales; aquí el precio se guarda al céntimo, así que se prueba el
 // subtotal impreso y no las líneas.)
 assert.equal(igvCompra(355.93),64.07)
 assert.equal(Math.round((355.93+igvCompra(355.93))*100)/100,420)
 assert.equal(igvCompra(totalCompra([{cantidad:2,precio:59.32}])),21.36)
})
