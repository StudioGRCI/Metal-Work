import test from 'node:test'
import assert from 'node:assert/strict'
import { menuDe, modulosDelInicio, pestanasDe, rutasDeTrabajo } from './navegacion.ts'

// Los 32 permisos de Gerencia en producción el 2026-11-25 (leídos de `roles_permisos`), más
// `rrhh.tiempos_entrega`, que le da la migración 20261125100000 (Semáforo de entregas, #186), y
// `equipos.ver`, que le da la 20261125160000 (padrón de equipos, #191), `ssoma.ver`, que le da la
// 20261125150100 (SSOMA, #192), y `averias.ver`, que le da la 20261126100100 (reportar una avería, Plan 16.2).
const GERENCIA = [
  'adquisiciones.ver', 'almacen.ver', 'averias.ver', 'asistencia.ver', 'auditoria.ver', 'clientes.ver', 'codigos_internos.cerrar',
  'codigos_internos.ver', 'compras.configurar_aprobacion', 'compras.ver', 'costos.ver', 'cotizaciones.revisar',
  'cotizaciones.ver_aprobadas', 'cotizaciones.ver_pdf_comercial', 'diseno.revisar', 'equipos.ver', 'ordenes.anular', 'ordenes.aprobar',
  'ordenes.listar', 'ordenes.ver', 'planilla_diaria.ver', 'produccion.aprobar_sin_orden', 'produccion.cualquier_area',
  'produccion.ver', 'proveedores.editar', 'proveedores.ver', 'proveedores.ver_cuentas', 'reporte_diario.validar_gerencia',
  'reporte_diario.ver', 'requerimientos.ver', 'rrhh.tiempos_entrega', 'ssoma.ver', 'subcontratos.ver', 'tesoreria.liberar', 'tesoreria.ver_documentos',
  'vehiculos.ver',
]

const rutas = (grupos) => grupos.flatMap((g) => g.items.map((i) => i.ruta))

test('Gerencia ve por área las 38 pantallas que su permiso le abre, cada una una vez', () => {
  const grupos = menuDe(GERENCIA, false, 'GERENTE')
  assert.deepEqual(grupos.map((g) => g.titulo), [
    'Principal', 'Por aprobar', 'Ventas', 'Requerimientos', 'Almacén', 'Mantenimiento', 'Logística', 'Administración', 'Finanzas', 'Recursos Humanos', 'SSOMA',
  ])
  const todas = rutas(grupos)
  assert.equal(todas.length, 38)
  assert.equal(new Set(todas).size, 38)
  // Las averías y los reportes de seguridad, en lo que consulta: no se repiten en «Reportar», que va al final para todos.
  assert.deepEqual(rutas(grupos.filter((g) => g.titulo === 'Mantenimiento')), ['/averias'])
  assert.deepEqual(rutas(grupos.filter((g) => g.titulo === 'SSOMA')), ['/ssoma'])
  assert.ok(!grupos.some((g) => g.titulo === 'Reportar'))
  // Las cuatro que el catálogo pide con un permiso de registro le abren con el de lectura.
  assert.ok(todas.includes('/equipos'))
  for (const r of ['/requerimientos/atencion', '/compras/ordenes', '/compras/servicios', '/contabilidad/facturacion']) {
    assert.ok(todas.includes(r), r)
  }
  // Lo reservado del personal y la administración del sistema no están.
  for (const r of ['/rrhh', '/rrhh/costeo', '/rrhh/pagos-oficina', '/rrhh/cuentas', '/diseno/evaluaciones', '/personal', '/configuracion']) {
    assert.ok(!todas.includes(r), r)
  }
})

test('lo que Gerencia consulta no es su trabajo; lo que ya tenía en su menú, sí', () => {
  const grupos = menuDe(GERENCIA, false, 'GERENTE')
  assert.deepEqual(grupos.filter((g) => !g.consulta).map((g) => g.titulo), ['Principal', 'Por aprobar'])
  // Las mismas once rutas que su menú tiene en main: ni un pendiente ni una cifra de más o de menos.
  assert.deepEqual([...rutasDeTrabajo(GERENCIA, false, 'GERENTE')].sort(), [
    '/', '/adquisiciones', '/avance/trabajos', '/codigos-internos', '/compras/aprobacion', '/costos/gastos-generales',
    '/cotizaciones/pdf', '/reportes-diarios', '/rrhh/tiempos-de-entrega', '/tesoreria/por-cobrar', '/tesoreria/por-pagar',
  ])
  assert.ok(!rutasDeTrabajo(GERENCIA, false, 'GERENTE').has('/ordenes'))
  assert.deepEqual(rutas(modulosDelInicio(GERENCIA, false, 'GERENTE')), [
    '/', '/codigos-internos', '/cotizaciones/pdf', '/compras/aprobacion', '/reportes-diarios', '/avance/trabajos',
    '/adquisiciones', '/tesoreria/por-cobrar', '/tesoreria/por-pagar', '/costos/gastos-generales', '/rrhh/tiempos-de-entrega',
  ])
  assert.deepEqual(pestanasDe(GERENCIA, false, 'GERENTE').map((p) => p.ruta), [
    '/codigos-internos', '/cotizaciones/pdf', '/compras/aprobacion', '/reportes-diarios',
  ])
})

test('sin el permiso de lectura, la pantalla no sale aunque el menú la nombre', () => {
  const sinCompras = GERENCIA.filter((p) => p !== 'compras.ver')
  const todas = rutas(menuDe(sinCompras, false, 'GERENTE'))
  assert.ok(!todas.includes('/compras/ordenes'))
  assert.ok(!todas.includes('/compras/servicios'))
})

test('el permiso de lectura no cuelga pantallas en el catálogo de quien no tiene menú propio', () => {
  const todas = rutas(menuDe(['compras.ver', 'cotizaciones.ver_aprobadas', 'requerimientos.ver'], false, 'PUESTO_SIN_MENU'))
  assert.ok(!todas.includes('/compras/ordenes'))
  assert.ok(!todas.includes('/contabilidad/facturacion'))
  assert.ok(!todas.includes('/requerimientos/atencion'))
})

test('el permiso de lectura no sostiene una entrada del trabajo del puesto', () => {
  // Administración tiene «Órdenes de compra» en su trabajo: sin `compras.crear`, la entrada se va aunque tenga `compras.ver`.
  const todas = rutas(menuDe(['compras.ver', 'requerimientos.ver'], false, 'ADMINISTRACION'))
  assert.ok(!todas.includes('/compras/ordenes'))
  assert.ok(!todas.includes('/requerimientos/atencion'))
})

test('un puesto sin grupos de consulta trabaja todo su menú, como antes', () => {
  const permisos = ['almacen.recibir', 'almacen.despachar', 'almacen.ver', 'almacen.stock', 'codigos_internos.seguimiento']
  const menu = new Set(rutas(menuDe(permisos, false, 'ALMACENERO')).map((r) => r.split(/[?#]/)[0]))
  assert.deepEqual([...rutasDeTrabajo(permisos, false, 'ALMACENERO')].sort(), [...menu].sort())
  assert.deepEqual(rutas(modulosDelInicio(permisos, false, 'ALMACENERO')), rutas(menuDe(permisos, false, 'ALMACENERO')))
})

test('en Gerencia, lo que espera su visto va siempre abierto y cada área nace plegada', () => {
  const grupos = menuDe(GERENCIA, false, 'GERENTE')
  assert.deepEqual(
    grupos.map((g) => [g.titulo, g.pliegue]),
    [
      ['Principal', 'fijo'], ['Por aprobar', 'fijo'], ['Ventas', 'plegado'], ['Requerimientos', 'plegado'], ['Almacén', 'plegado'],
      ['Mantenimiento', 'plegado'], ['Logística', 'plegado'], ['Administración', 'plegado'], ['Finanzas', 'plegado'], ['Recursos Humanos', 'plegado'],
      ['SSOMA', 'plegado'],
    ],
  )
})

test('«Reportar incidente» y «Reportar avería» están al final del menú de todo puesto, también del que no tiene ningún permiso', () => {
  for (const [rol, permisos] of [['VENDEDOR', ['cotizaciones.crear']], ['PORTERO', []], ['SUPERVISOR', ['reporte_diario.crear']]]) {
    const grupos = menuDe(permisos, false, rol)
    const ultimo = grupos.at(-1)
    assert.equal(ultimo?.titulo, 'Reportar', rol)
    assert.equal(ultimo?.pliegue, 'fijo', rol)
    assert.deepEqual(ultimo.items.map((i) => [i.ruta, i.titulo]), [['/ssoma', 'Reportar incidente'], ['/averias', 'Reportar avería']], rol)
    // Es su trabajo, no una consulta.
    assert.ok(rutasDeTrabajo(permisos, false, rol).has('/averias'), rol)
  }
  // Mantenimiento la tiene arriba, como «Averías», y no otra vez abajo.
  const mantenimiento = menuDe(['averias.atender', 'equipos.gestionar'], false, 'MANTENIMIENTO')
  assert.deepEqual(mantenimiento.map((g) => g.titulo), ['Principal', 'Mantenimiento', 'Reportar'])
  assert.deepEqual(mantenimiento[1].items.map((i) => i.titulo), ['Averías', 'Equipos'])
  assert.deepEqual(mantenimiento[2].items.map((i) => i.titulo), ['Reportar incidente'])
})
