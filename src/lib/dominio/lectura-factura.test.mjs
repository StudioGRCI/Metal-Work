import test from 'node:test'
import assert from 'node:assert/strict'
import {
  avisosDeLaOrden,
  avisosDelDetector,
  importeDeTexto,
  leerFacturaDeTexto,
  leerFacturaDeXml,
  numeroDeFactura,
  numeroDeOc,
  ordenesMencionadas,
} from './lectura-factura.ts'

// La representación impresa del portal de SUNAT (SEE-SOL), con datos inventados.
const SUNAT = `FACTURA ELECTRONICA
RUC: 20123456789
E001-482
FERRETERIA EL PERNO S.A.C.
Fecha de Emisión : 14/10/2026
Señor(es) : METAL WORK S.A.C.
RUC : 20601538840
Tipo de Moneda : SOLES
Observación : OC-5583-MW
Cantidad Unidad Medida Descripción Valor Unitario
10.00 UNIDAD DISCO DE CORTE 4 1/2 8.47
Sub Total Ventas : S/ 1,000.00
Anticipos : S/ 0.00
Descuentos : S/ 0.00
Valor Venta : S/ 1,000.00
ISC : S/ 0.00
IGV : S/ 180.00
Otros Cargos : S/ 0.00
Importe Total : S/ 1,180.00
SON: MIL CIENTO OCHENTA Y 00/100 SOLES`

// La de un sistema de facturación privado: el total en la línea de abajo y dos OC.
const PRIVADA = `ACEROS DEL NORTE E.I.R.L.
R.U.C. 20456789012
FACTURA ELECTRÓNICA
F001 - 00012345
FECHA DE EMISIÓN: 2026-10-13
O/C N° 5590 y ORDEN DE COMPRA: 0591-MW
CANT. DESCRIPCIÓN P. UNIT. TOTAL
2 PLANCHA LAC 2MM 4X8 250.00 500.00
OP. GRAVADA S/ 1,500.00
TOTAL IGV S/ 270.00
IMPORTE TOTAL
S/ 1,770.00
MONTO NETO PENDIENTE DE PAGO S/ 1,646.10`

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:cac" xmlns:cbc="urn:cbc">
  <ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><ds:Signature Id="SIGN"><ds:SignedInfo/></ds:Signature></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions>
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:ID>F002-00000077</cbc:ID>
  <cbc:IssueDate>2026-10-12</cbc:IssueDate>
  <cbc:Note languageLocaleID="1000"><![CDATA[DOS MIL TRESCIENTOS SESENTA Y 00/100 SOLES]]></cbc:Note>
  <cbc:DocumentCurrencyCode>PEN</cbc:DocumentCurrencyCode>
  <cac:OrderReference><cbc:ID>OC-5600-MW</cbc:ID></cac:OrderReference>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="6">20456789012</cbc:ID></cac:PartyIdentification></cac:Party></cac:AccountingSupplierParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="PEN">360.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="PEN">2000.00</cbc:LineExtensionAmount>
    <cbc:TaxInclusiveAmount currencyID="PEN">2360.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="PEN">2360.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`

test('los importes se leen con coma o punto de miles', () => {
  assert.equal(importeDeTexto('1,180.00'), 1180)
  assert.equal(importeDeTexto('1.180,50'), 1180.5)
  assert.equal(importeDeTexto('1 180.00'), 1180)
  assert.equal(importeDeTexto('12,5'), 12.5)
  assert.equal(importeDeTexto('abc'), null)
})

test('el número de la OC y el de la factura se comparan sin ceros', () => {
  assert.equal(numeroDeOc('OC-5583-MW'), '5583')
  assert.equal(numeroDeOc('OC-0001'), '1')
  assert.equal(numeroDeOc(null), null)
  assert.equal(numeroDeFactura('f001 - 00012345'), 'F001-12345')
  assert.equal(numeroDeFactura('E001-482'), 'E001-482')
  assert.equal(numeroDeFactura('OC-5583-MW'), null)
})

test('las OC se encuentran escritas de varias maneras y no en palabras que empiezan con OC', () => {
  assert.deepEqual(ordenesMencionadas('Observación: OC-5583-MW'), ['5583'])
  assert.deepEqual(ordenesMencionadas('O/C N° 5590 y ORDEN DE COMPRA: 0591-MW'), ['5590', '591'])
  assert.deepEqual(ordenesMencionadas('OC N° 12, O.C. 13'), ['12', '13'])
  assert.deepEqual(ordenesMencionadas('OCHO UNIDADES 2026, OCTUBRE 15'), [])
})

test('la factura de SUNAT da su importe total, no el subtotal ni el IGV', () => {
  const l = leerFacturaDeTexto(SUNAT)
  assert.equal(l.total, 1180)
  assert.equal(l.moneda, 'PEN')
  assert.equal(l.numero, 'E001-482')
  assert.equal(l.fecha_emision, '2026-10-14')
  assert.deepEqual(l.ordenes, ['5583'])
})

test('la factura privada da el total de la línea de abajo y no el neto de la detracción', () => {
  const l = leerFacturaDeTexto(PRIVADA)
  assert.equal(l.total, 1770)
  assert.equal(l.moneda, 'PEN')
  assert.equal(l.numero, 'F001-12345')
  assert.equal(l.fecha_emision, '2026-10-13')
  assert.deepEqual(l.ordenes, ['5590', '591'])
})

test('el XML de SUNAT da el PayableAmount, su moneda, el número y la OrderReference', () => {
  const l = leerFacturaDeXml(XML)
  assert.equal(l.fuente, 'XML')
  assert.equal(l.total, 2360)
  assert.equal(l.moneda, 'PEN')
  assert.equal(l.numero, 'F002-77')
  assert.equal(l.fecha_emision, '2026-10-12')
  assert.deepEqual(l.ordenes, ['5600'])
})

test('el detector avisa lo que no calza y calla lo que sí', () => {
  const lectura = leerFacturaDeTexto(PRIVADA)
  const disponibles = [
    { numero: 'OC-5590-MW', referencia: 'Planchas' },
    { numero: 'OC-0591-MW', referencia: 'Tubos' },
    { numero: 'OC-5599-MW', referencia: 'Pernos' },
  ]
  // Todo bien: mismo total, número y las dos OC.
  assert.deepEqual(
    avisosDelDetector({ lectura, total: 1770, moneda: 'PEN', numero: 'F001-12345', marcadas: disponibles.slice(0, 2), disponibles }),
    [],
  )
  const avisos = avisosDelDetector({
    lectura,
    total: 1700,
    moneda: 'USD',
    numero: 'F001-12346',
    marcadas: [disponibles[0], disponibles[2]],
    disponibles,
  })
  assert.deepEqual(
    avisos.map((a) => a.tipo),
    ['MONEDA', 'TOTAL', 'NUMERO', 'OC_NO_MARCADA', 'OC_NO_MENCIONADA'],
  )
  assert.deepEqual(avisos[3], { tipo: 'OC_NO_MARCADA', oc: 'OC-0591-MW', espera: true })
  assert.deepEqual(avisos[4], { tipo: 'OC_NO_MENCIONADA', oc: 'OC-5599-MW' })
  // Una factura que no nombra ninguna OC no hace sospechar de las marcadas.
  const sinOc = { ...lectura, ordenes: [] }
  assert.deepEqual(avisosDelDetector({ lectura: sinOc, total: 1770, moneda: 'PEN', numero: '', marcadas: disponibles }), [])
})

test('al adjuntar la factura a su OC se avisa si el total o la OC no son los de la orden', () => {
  const lectura = leerFacturaDeTexto(SUNAT)
  const dinero = (n, m) => `${m} ${n.toFixed(2)}`
  assert.deepEqual(avisosDeLaOrden({ lectura, total: 1180.4, moneda: 'PEN', numero: 'OC-5583-MW' }, dinero), [])
  assert.deepEqual(avisosDeLaOrden({ lectura, total: 1000, moneda: 'PEN', numero: 'OC-5584-MW' }, dinero), [
    'La factura dice PEN 1180.00 y la orden suma PEN 1000.00: revisa cantidades y precios, o si la factura es de otra compra.',
    'La factura menciona la OC 5583, y esta es la OC-5584-MW: revisa que sea su factura.',
  ])
  assert.deepEqual(avisosDeLaOrden({ lectura, total: 1180, moneda: 'USD' }, dinero), ['La factura está en soles y la orden en dólares.'])
  // El número escrito a mano se compara con el leído, con o sin ceros a la izquierda.
  assert.deepEqual(avisosDeLaOrden({ lectura, total: 1180.4, moneda: 'PEN', anotada: 'e001-000482' }, dinero), [])
  assert.deepEqual(avisosDeLaOrden({ lectura, total: 1180.4, moneda: 'PEN', anotada: 'F001-111' }, dinero), [
    'La factura es la E001-482 y se anotó como F001-111: revisa el número.',
  ])
  // A medio escribir no se avisa.
  assert.deepEqual(avisosDeLaOrden({ lectura, total: 1180.4, moneda: 'PEN', anotada: 'F00' }, dinero), [])
})
