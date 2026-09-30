import test from 'node:test'
import assert from 'node:assert/strict'
import {importeCompra,totalCompra} from './compra-materiales.ts'

test('el total cuadra con cada línea redondeada y omite importes pendientes',()=>{
 assert.equal(importeCompra(0.005,1),0.01)
 assert.equal(totalCompra([{cantidad:0.005,precio:1},{cantidad:0.005,precio:1},{cantidad:10,precio:null}]),0.02)
 assert.equal(totalCompra([{cantidad:3,precio:12.31},{cantidad:0.333,precio:3}]),37.93)
})
