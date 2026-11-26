import test from 'node:test'
import assert from 'node:assert/strict'
import { menuDe, modulosDelInicio, pestanasDe, rutaActiva, rutasDeTrabajo } from './navegacion.ts'

// Los 32 permisos de Gerencia en producción el 2026-11-25 (leídos de `roles_permisos`), más
// `rrhh.tiempos_entrega`, que le da la migración 20261125100000 (Semáforo de entregas, #186), y
// `equipos.ver`, que le da la 20261125160000 (padrón de equipos, #191). Desde la 20261126310000
// tiene además los diez de lectura de las once pantallas que le faltaban, y ya no `proveedores.editar`;
// desde la 20261126100100, `averias.ver` (reportar una avería, Plan 16.2), y desde la
// 20261126700000, `calidad.ver` (Calidad, A.1), y desde la 20261126991000, `garantias.ver`
// (reclamos de garantía, A.2).
const GERENCIA = [
  'adquisiciones.ver', 'almacen.ver', 'averias.ver', 'asistencia.ver', 'auditoria.ver', 'calidad.ver', 'clientes.ver', 'codigos_internos.cerrar',
  'codigos_internos.ver', 'compras.configurar_aprobacion', 'compras.ver', 'costos.ver', 'cotizaciones.revisar',
  'cotizaciones.ver_aprobadas', 'cotizaciones.ver_pdf_comercial', 'diseno.revisar', 'equipos.ver', 'ordenes.anular', 'ordenes.aprobar',
  'ordenes.listar', 'ordenes.ver', 'planilla_diaria.ver', 'produccion.aprobar_sin_orden', 'produccion.cualquier_area',
  'produccion.ver', 'proveedores.ver', 'proveedores.ver_cuentas', 'reporte_diario.validar_gerencia',
  'reporte_diario.ver', 'requerimientos.ver', 'rrhh.tiempos_entrega', 'subcontratos.ver', 'tesoreria.liberar', 'tesoreria.ver_documentos',
  'vehiculos.ver',
  'codigos_internos.seguimiento', 'codigos_internos.gasto', 'configuracion.ver', 'diseno.ver_informes', 'diseno.ver_materiales',
  'diseno.ver_dxf', 'requerimientos.ver_metrado', 'compras.ver_gestion', 'tesoreria.ver_caja', 'tesoreria.ver_tipo_cambio',
  // Reportes de seguridad, desde el área de SSOMA (#192).
  'ssoma.ver',
  'garantias.ver',
]

const rutas = (grupos) => grupos.flatMap((g) => g.items.map((i) => i.ruta))

test('Gerencia ve por área las 55 pantallas que su permiso le abre, cada una una vez', () => {
  const grupos = menuDe(GERENCIA, false, 'GERENTE')
  assert.deepEqual(grupos.map((g) => g.titulo), [
    'Principal', 'Por aprobar', 'Ventas', 'Diseño e Ingeniería', 'Requerimientos', 'Almacén', 'Logística', 'Administración',
    'Finanzas', 'Recursos Humanos', 'SSOMA y Calidad',
  ])
  const todas = rutas(grupos)
  // 49 en main el 2026-11-26 (con Averías), más Por decidir (plan 12, entrega 12.1), el Control de compras de Almacén,
  // las inspecciones de calidad (A.1), las charlas e inducciones de SSOMA (plan 15, entrega 15.3), los reclamos de garantía (A.2)
  // y las inspecciones de seguridad (plan 15, entrega 15.4).
  assert.equal(todas.length, 55)
  assert.equal(new Set(todas).size, 55)
  // Los reclamos de garantía, en lo que consulta de Ventas: un grupo más no entraba en el monitor.
  assert.deepEqual(rutas(grupos.filter((g) => g.titulo === 'Ventas')), ['/clientes', '/unidades', '/carrocerias', '/garantias'])
  // Calidad la consulta con su permiso: la entrada del área (sin permiso) no la reemplaza.
  assert.equal(grupos.find((g) => g.titulo === 'SSOMA y Calidad')?.items[3]?.titulo, 'Inspecciones de calidad')
  // Las averías y los reportes de seguridad, en lo que consulta: no se repiten en «Reportar», que va al final para todos.
  // Las averías van con los equipos en Almacén: un grupo más no entraba en el monitor.
  assert.deepEqual(rutas(grupos.filter((g) => g.titulo === 'Almacén')).slice(-2), ['/equipos', '/averias'])
  assert.deepEqual(rutas(grupos.filter((g) => g.titulo === 'SSOMA y Calidad')), ['/ssoma', '/ssoma/charlas', '/ssoma/inspecciones', '/calidad'])
  assert.ok(!grupos.some((g) => g.titulo === 'Reportar'))
  // Las once que se le abrieron en lectura el 2026-11-26, y Proveedores sin `proveedores.editar`.
  for (const r of [
    '/carrocerias', '/seguimiento', '/requerimientos/metrado', '/materiales', '/diseno/informe-semanal', '/diseno/dxf',
    '/requerimientos/gasto-por-codigo', '/seguimiento?vista=materiales', '/compras/gestion', '/tesoreria/caja-diaria',
    '/tesoreria/tipo-de-cambio', '/proveedores',
  ]) {
    assert.ok(todas.includes(r), r)
  }
  // Las cuatro que el catálogo pide con un permiso de registro le abren con el de lectura.
  assert.ok(todas.includes('/equipos'))
  for (const r of ['/requerimientos/atencion', '/compras/ordenes', '/compras/servicios', '/contabilidad/facturacion']) {
    assert.ok(todas.includes(r), r)
  }
  // Lo reservado del personal y la administración del sistema no están.
  for (const r of [
    '/rrhh', '/rrhh/costeo', '/rrhh/pagos-oficina', '/rrhh/cuentas', '/diseno/evaluaciones', '/personal', '/configuracion',
    // Las de trabajo de un solo puesto o área, que repiten lo que ya ve de todas (decisión 1 del plan).
    '/diseno/planos', '/diseno/materiales', '/diseno/etapas', '/planos', '/subcontratos/area', '/requerimientos/unidades', '/recojos',
  ]) {
    assert.ok(!todas.includes(r), r)
  }
})

test('lo que Gerencia consulta no es su trabajo; lo que ya tenía en su menú, sí', () => {
  const grupos = menuDe(GERENCIA, false, 'GERENTE')
  assert.deepEqual(grupos.filter((g) => !g.consulta).map((g) => g.titulo), ['Principal', 'Por aprobar'])
  // Las once rutas que su menú tenía en main, más «Por decidir» (plan 12.1), que no lleva
  // pendiente propio, y las OT por aprobar (2026-11-26): ni un pendiente ni una cifra de más.
  assert.deepEqual([...rutasDeTrabajo(GERENCIA, false, 'GERENTE')].sort(), [
    '/', '/adquisiciones', '/avance/trabajos', '/codigos-internos', '/compras/aprobacion', '/costos/gastos-generales',
    '/cotizaciones/pdf', '/ordenes', '/por-decidir', '/reportes-diarios', '/rrhh/tiempos-de-entrega', '/tesoreria/por-cobrar', '/tesoreria/por-pagar',
  ])
  // Las OT por aprobar son su trabajo (2026-11-26): /ordenes va en «Por aprobar» y cuenta.
  assert.ok(rutasDeTrabajo(GERENCIA, false, 'GERENTE').has('/ordenes'))
  assert.deepEqual(rutas(modulosDelInicio(GERENCIA, false, 'GERENTE')), [
    '/', '/codigos-internos', '/por-decidir', '/cotizaciones/pdf', '/ordenes', '/compras/aprobacion', '/reportes-diarios', '/avance/trabajos',
    '/adquisiciones', '/tesoreria/por-cobrar', '/tesoreria/por-pagar', '/costos/gastos-generales', '/rrhh/tiempos-de-entrega',
  ])
  assert.deepEqual(pestanasDe(GERENCIA, false, 'GERENTE').map((p) => p.ruta), [
    '/codigos-internos', '/cotizaciones/pdf', '/por-decidir', '/reportes-diarios',
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
      ['Principal', 'fijo'], ['Por aprobar', 'fijo'], ['Ventas', 'plegado'], ['Diseño e Ingeniería', 'plegado'], ['Requerimientos', 'plegado'],
      ['Almacén', 'plegado'],
      ['Logística', 'plegado'], ['Administración', 'plegado'], ['Finanzas', 'plegado'], ['Recursos Humanos', 'plegado'],
      ['SSOMA y Calidad', 'plegado'],
    ],
  )
})

test('«Materiales por código» se marca a sí mismo, no a «Seguimiento por código»', () => {
  const rutas = ['/seguimiento', '/seguimiento?vista=materiales', '/requerimientos']
  assert.equal(rutaActiva('/seguimiento', rutas, new URLSearchParams('vista=materiales')), '/seguimiento?vista=materiales')
  assert.equal(rutaActiva('/seguimiento', rutas, new URLSearchParams('vista=planos')), '/seguimiento')
  assert.equal(rutaActiva('/seguimiento', rutas, new URLSearchParams()), '/seguimiento')
  assert.equal(rutaActiva('/seguimiento', ['/seguimiento?vista=materiales'], new URLSearchParams()), undefined)
  assert.equal(rutaActiva('/requerimientos/atencion', rutas, new URLSearchParams()), '/requerimientos')
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

test('Calidad lleva sus inspecciones arriba y consulta los códigos y las OT sin montos', () => {
  const permisos = ['ordenes.listar', 'ordenes.ver', 'produccion.ver', 'calidad.inspeccionar', 'codigos_internos.seguimiento']
  const grupos = menuDe(permisos, false, 'CALIDAD')
  assert.deepEqual(rutas(grupos), ['/', '/calidad', '/seguimiento', '/ordenes', '/ssoma', '/averias'])
  assert.equal(grupos[0].items[1].titulo, 'Inspecciones de calidad')
  assert.deepEqual(pestanasDe(permisos, false, 'CALIDAD').map((p) => p.ruta), ['/calidad', '/seguimiento', '/'])
  // Con la causa de la garantía (A.2), como lo tiene el puesto: anota la causa en el teléfono.
  assert.deepEqual(pestanasDe([...permisos, 'garantias.causa'], false, 'CALIDAD').map((p) => p.ruta), ['/calidad', '/garantias', '/seguimiento', '/'])
  assert.ok(!rutasDeTrabajo(permisos, false, 'CALIDAD').has('/seguimiento'))
})

test('cada puesto de un área de la planta con menú propio ve lo que Calidad le observa, y la oficina no', () => {
  for (const [puesto, permisos] of [
    ['SUPERVISOR', ['reporte_diario.ver']],
    ['DISENO', ['diseno.codigos']],
    ['DISENO_COLABORADOR', ['diseno.informe_semanal']],
    ['ALMACENERO', ['almacen.ver']],
  ]) {
    const menu = menuDe(permisos, false, puesto)
    assert.ok(rutas(menu).includes('/calidad'), puesto)
    assert.ok(menu.flatMap((g) => g.items).some((i) => i.titulo === 'Observaciones de calidad'), puesto)
    assert.ok(rutasDeTrabajo(permisos, false, puesto).has('/calidad'), `${puesto}: su globo cuenta lo que espera por el área`)
  }
  for (const puesto of ['TESORERIA', 'CONTABILIDAD', 'COMPRADOR', 'VENDEDOR']) {
    assert.ok(!rutas(menuDe([], false, puesto)).includes('/calidad'), puesto)
  }
})

test('los reclamos de garantía: Ventas y Gerencia Comercial registran, Administración atiende, Calidad anota la causa; la oficina no', () => {
  const menu = (rol, permisos) => rutas(menuDe(permisos, false, rol))
  assert.deepEqual(menu('VENDEDOR', ['cotizaciones.crear', 'clientes.ver', 'garantias.registrar']).slice(-4), ['/carrocerias', '/garantias', '/ssoma', '/averias'])
  assert.ok(menu('GERENTE_COMERCIAL', ['cotizaciones.ver_pdf_comercial', 'clientes.ver', 'ordenes.listar', 'garantias.registrar']).includes('/garantias'))
  const administracion = menu('ADMINISTRACION', ['cotizaciones.ver_aprobadas', 'ordenes.listar', 'garantias.atender'])
  assert.equal(administracion[administracion.indexOf('/ordenes') + 1], '/garantias', 'Administración: justo después de las OT')
  // Calidad, arriba, junto a sus inspecciones: anotar la causa es su trabajo.
  const calidad = menuDe(['ordenes.listar', 'calidad.inspeccionar', 'garantias.causa'], false, 'CALIDAD')
  assert.deepEqual(rutas([calidad[0]]), ['/', '/calidad', '/garantias'])
  assert.ok(rutasDeTrabajo(['ordenes.listar', 'calidad.inspeccionar', 'garantias.causa'], false, 'CALIDAD').has('/garantias'))
  // Sin su permiso no sale: la entrada desaparece en vez de llevar a «Sin permiso».
  for (const puesto of ['TESORERIA', 'CONTABILIDAD', 'COMPRADOR', 'SUPERVISOR']) {
    assert.ok(!menu(puesto, ['reporte_diario.ver']).includes('/garantias'), puesto)
  }
  assert.ok(!menu('VENDEDOR', ['cotizaciones.crear']).includes('/garantias'))
})
