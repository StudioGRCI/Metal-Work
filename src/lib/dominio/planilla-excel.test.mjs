import test from 'node:test'
import assert from 'node:assert/strict'
import { asignarEmpresas, claveNombre, leerBoletas, leerPagos } from './planilla-excel.ts'

// Boletas inventadas con la forma del Excel de Recursos Humanos (agosto de 2026).
// Formato A: «NOMBRES Y APELLIDOS» en B y el nombre en C, con EsSalud.
function boletaA({ nombre = 'ANA LUCIA QUISPE ROJAS', essalud = 135, neto = 1570.94, he = 100 } = {}) {
  return [
    [null, 'NOMBRES Y APELLIDOS', nombre],
    [null, 'PUESTO DE TRABAJO :', 'SOLDADORA'],
    [null, 'N° DE DÍAS TRABAJADOS', 'N° DE HORAS TRABAJADAS', null, 'N° DE HORAS EXTRAS '],
    [null, 30, 240, null, 8],
    [null, 'INGRESOS', null, 'DESCUENTOS'],
    [null, 'SUELDO SIN BONOS', 1400, 'TARDANZAS 5%', 0],
    [null, 'BONO PRODUCTIVIDAD', 250.35, new Date('2026-08-11')],
    [null, 'HORAS EXTRA', he, 'PERMISOS'],
    [null, 'FERIDOS', 0, null, 10],
    [null, null, null, 'APORTE  10.00%', 149],
    [null, null, null, 'PRIMA     1.37%', 20.41],
    [null, 'TOTAL', 1400 + 250.35 + he, 'TOTAL', 179.41],
    [],
    [null, 'ESSALUD ', 0.09, null, essalud],
    [null, 'NETO A RECIBIR', null, neto],
  ]
}
// Formato B: «APELLIDO Y NOMBRES:» en B y el nombre en D, sin EsSalud; las
// horas extras por fecha van debajo, con la fecha en B y las horas en C.
function boletaB() {
  return [
    [null, 'APELLIDO Y NOMBRES: ', null, 'RAMOS TELLO, JORGE LUIS'],
    [null, 'OCUPACION :', null, 'SUPERVISOR DE DISEÑO'],
    [null, 'N° DE DIAS TRABAJADAS', null, 30],
    [null, 'N° DE HORAS TRABAJADAS', null, 240],
    [null, 'N° DE HORAS EXTRAS TRABAJADAS ', null, 4],
    [null, 'INGRESOS', null, 'DESCUENTOS'],
    [null, 'REMUNERACION', 3000, 'TARDANZAS 5%  ', 150],
    [null, 'HORAS EXTRAS', 50],
    [null, new Date('2026-08-22'), 4],
    [null, null, null, 'PENALIDADES', 30],
    [null, null, null, 'NO TIENE RADIO ENCENDIDA'],
    [null, 'TOTAL', 3050, 'TOTAL', 180],
    [null, 'NETO A RECIBIR', null, 2870],
  ]
}
const pagos = [
  [null, 'ESTADO GENERAL DE PLANILLA AGOSTO 2026'],
  [null, ' ', 'METAL WORK PERU S.A.C.', null, null, 'SUELDO SIN BONOS'],
  [null, 1, 'RAMOS TELLO, JORGE LUIS'],
  [null, 'TOTAL METAL WORK PERU S.A.C.'],
  [null, ' ', 'FABRICACIONES DE PRUEBA S.A.C.', null, null, 'SUELDO SIN BONOS'],
  [null, 1, 'QUISPE ROJAS ANA LUCIA'],
  [null, 'TOTAL FABRICACIONES'],
]

test('lee los dos formatos de boleta con su fila, sus conceptos y su total', () => {
  const a = leerBoletas([[], ...boletaA()], 'RESUMEN AGOSTO -2026')
  const b = leerBoletas(boletaB(), 'RESUMEN AGOSTO OTROS - 2026')
  assert.equal(a.errores.length, 0)
  assert.equal(b.errores.length, 0)
  const [ana] = a.lineas
  const [jorge] = b.lineas
  assert.equal(ana.fila, 2)
  assert.equal(ana.detalle.puesto, 'SOLDADORA')
  assert.equal(ana.detalle.horas_extras, 8)
  assert.equal(ana.detalle.ingresos, 1750.35)
  // El permiso tiene el rótulo una fila más arriba que el importe.
  assert.deepEqual(ana.detalle.conceptos.filter((c) => c.tipo === 'DESCUENTO').map((c) => c.clave), ['PERMISOS', 'AFP_APORTE', 'AFP_PRIMA'])
  assert.equal(jorge.detalle.puesto, 'SUPERVISOR DE DISEÑO')
  assert.equal(jorge.detalle.aporte_empleador, 0)
  // Las horas por fecha (4) no son un importe.
  assert.equal(jorge.detalle.conceptos.filter((c) => c.tipo === 'INGRESO').reduce((s, c) => s + c.importe, 0), 3050)
  assert.deepEqual(jorge.detalle.avisos, [])
})

test('EsSalud fuera del 9 % de sueldo más horas extras se corrige y se avisa', () => {
  const bien = leerBoletas(boletaA(), 'RESUMEN AGOSTO MWP - 2026').lineas[0]
  assert.equal(bien.detalle.aporte_empleador, 135)
  const rota = leerBoletas(boletaA({ essalud: 0.94 }), 'RESUMEN AGOSTO MWP - 2026').lineas[0]
  assert.equal(rota.detalle.aporte_excel, 0.94)
  assert.equal(rota.detalle.aporte_empleador, 135)
  assert.match(rota.detalle.avisos.join(' '), /EsSalud: el Excel dice S\/ 0\.94/)
})

test('una boleta que no cuadra no detiene a las demás', () => {
  const r = leerBoletas([...boletaA({ neto: 999 }), ...boletaA({ nombre: 'OTRA PERSONA DE PRUEBA' })], 'RESUMEN AGOSTO MWP - 2026')
  assert.equal(r.lineas.length, 1)
  assert.equal(r.errores.length, 1)
  assert.match(r.errores[0].error, /no cuadra/)
})

test('la empresa sale de la hoja PAGOS, con el nombre en cualquier orden', () => {
  assert.equal(claveNombre('Quispe Rojas, Ana Lucía'), claveNombre('ANA LUCIA QUISPE ROJAS'))
  const grupos = leerPagos(pagos)
  assert.deepEqual(grupos.map((g) => g.empresa), ['METAL WORK PERU S.A.C.', 'FABRICACIONES DE PRUEBA S.A.C.'])
  const lineas = asignarEmpresas([...leerBoletas(boletaA(), 'RESUMEN AGOSTO -2026').lineas, ...leerBoletas(boletaB(), 'RESUMEN AGOSTO OTROS - 2026').lineas], grupos)
  assert.deepEqual(lineas.map((l) => l.empresa), ['FABRICACIONES DE PRUEBA S.A.C.', 'METAL WORK PERU S.A.C.'])
  const sinPagos = asignarEmpresas(leerBoletas(boletaA({ nombre: 'PERSONA FUERA DE PAGOS' }), 'RESUMEN AGOSTO MWP - 2026').lineas, grupos)
  assert.equal(sinPagos[0].empresa, null)
  assert.match(sinPagos[0].detalle.avisos.join(' '), /No figura en la hoja PAGOS/)
})
