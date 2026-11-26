import test from 'node:test'
import assert from 'node:assert/strict'
import { describirRecorridoDeLaAveria, describirRecorridoDeLaCotizacion, describirRecorridoDelRequerimiento, haceDias, insumos, tardo } from './recorrido.ts'

const paso = (orden, paso, situacion, mas = {}) => ({
  orden, paso, situacion, puesto: null, en: null, dias: null, espera: null, detalle: null, ...mas,
})

test('los días se dicen como se habla', () => {
  assert.equal(haceDias(0), 'desde hoy')
  assert.equal(haceDias(-1), 'desde hoy')
  assert.equal(haceDias(1), 'hace 1 día')
  assert.equal(haceDias(3), 'hace 3 días')
})

test('lo que tardó un paso hecho se dice como se habla', () => {
  assert.equal(tardo(0), 'el mismo día')
  assert.equal(tardo(1), 'al día siguiente')
  assert.equal(tardo(4), 'a los 4 días')
})

test('el recorrido del RQ dice lo hecho, quién lo tiene y lo que falta', () => {
  const pasos = describirRecorridoDelRequerimiento([
    // Llega desordenado: manda el orden de la base.
    paso(3, 'LISTO', 'PENDIENTE'),
    paso(1, 'REGISTRO', 'HECHO', { puesto: 'Requerimientos', en: '2026-11-20T15:00:00Z', detalle: 'Maestranza' }),
    paso(2, 'COMPRA', 'AHORA', { puesto: 'Gerencia', dias: 3, espera: 'OC_POR_APROBAR', detalle: 'OC-0001-MW' }),
    paso(4, 'ENTREGA', 'PENDIENTE'),
  ])
  assert.deepEqual(pasos.map((p) => p.paso), ['REGISTRO', 'COMPRA', 'LISTO', 'ENTREGA'])
  assert.equal(pasos[0].titulo, 'Registrado')
  assert.equal(pasos[0].nota, 'Para Maestranza')
  assert.equal(pasos[1].titulo, 'Compra de lo que falta')
  assert.equal(pasos[1].nota, 'Aprueba la OC-0001-MW.')
  assert.equal(pasos[2].titulo, 'Listo para recoger')
  assert.equal(pasos[2].nota, null)
})

test('lo que el RQ espera sin orden de compra todavía no la nombra', () => {
  const [p] = describirRecorridoDelRequerimiento([paso(1, 'COMPRA', 'AHORA', { puesto: 'Logística', dias: 0, espera: 'POR_COMPRAR' })])
  assert.equal(p.nota, 'Falta ponerlo en una orden de compra.')
  const [g] = describirRecorridoDelRequerimiento([paso(1, 'COMPRA', 'AHORA', { puesto: 'Gerencia', dias: 0, espera: 'OC_POR_APROBAR' })])
  assert.equal(g.nota, 'Aprueba la orden de compra.')
})

test('el visto de Diseño y la entrega cambian de frase según cómo terminaron', () => {
  const pasos = describirRecorridoDelRequerimiento([
    paso(1, 'VISTO_DISENO', 'HECHO', { detalle: 'RECHAZADO:2' }),
    paso(2, 'VISTO_DISENO', 'HECHO', { detalle: 'AUTORIZADO:1,3' }),
    paso(3, 'ENTREGA', 'HECHO', { detalle: 'CON_FALTANTE' }),
    paso(4, 'ENTREGA', 'HECHO'),
  ])
  assert.deepEqual(pasos.map((p) => p.titulo), ['Diseño no lo autorizó', 'Diseño lo autorizó', 'Entregado al área, con faltante', 'Entregado al área'])
  assert.deepEqual(pasos.map((p) => p.nota), ['Insumo 2', 'Insumos 1 y 3', null, null])
})

test('el sustento dice qué insumos sustentó, en orden', () => {
  assert.equal(insumos('3,1,10'), 'Insumos 1, 3 y 10')
  assert.equal(insumos(''), null)
  const [s] = describirRecorridoDelRequerimiento([paso(1, 'SUSTENTO', 'HECHO', { detalle: '2' })])
  assert.equal(s.nota, 'Insumo 2')
})

test('la compra aprobada sin recojo programado y la observada dicen qué falta', () => {
  const [p, o] = describirRecorridoDelRequerimiento([
    paso(1, 'COMPRA', 'AHORA', { puesto: 'Logística', dias: 1, espera: 'POR_PROGRAMAR', detalle: 'OC-0001-MW' }),
    paso(2, 'COMPRA', 'AHORA', { puesto: 'Logística', dias: 1, espera: 'OBSERVADO', detalle: 'OC-0002-MW' }),
  ])
  assert.equal(p.nota, 'Falta programar el recojo de la OC-0001-MW con el conductor.')
  assert.equal(o.nota, 'Almacén observó el ingreso de la OC-0002-MW: trae lo que falta.')
})

test('el recorrido de la cotización nombra la OT solo si la base la manda', () => {
  const pasos = describirRecorridoDeLaCotizacion([
    paso(1, 'SUBIDA', 'HECHO'),
    paso(2, 'REVISION', 'HECHO', { detalle: 'RECHAZADA' }),
    paso(3, 'CORRECCION', 'HECHO', { detalle: 'versión 2' }),
    paso(4, 'REVISION', 'HECHO', { detalle: 'APROBADA' }),
    paso(5, 'CODIGO_Y_OT', 'HECHO', { detalle: 'OT 9357-2026' }),
    paso(6, 'CODIGO_Y_OT', 'HECHO'),
    paso(7, 'FACTURA', 'AHORA', { puesto: 'Contabilidad', dias: 2, espera: 'FACTURA' }),
  ])
  assert.deepEqual(pasos.map((p) => p.titulo), ['Enviada a Gerencia', 'Rechazada', 'Corrección subida', 'Aprobada', 'Con código interno y OT', 'Con código interno y OT', 'Factura'])
  assert.equal(pasos[1].nota, 'Devuelta a Ventas con observación')
  assert.equal(pasos[2].nota, 'Pasó a la versión 2')
  assert.equal(pasos[3].nota, 'Liberada: ya la ven Contabilidad y Tesorería')
  assert.equal(pasos[4].nota, 'OT 9357-2026')
  assert.equal(pasos[5].nota, null)
  assert.equal(pasos[6].nota, 'Registra su factura.')
})

test('la anulada que estuvo aprobada ya no dice que la ven Contabilidad y Tesorería', () => {
  const pasos = describirRecorridoDeLaCotizacion([
    paso(1, 'SUBIDA', 'HECHO'),
    paso(2, 'REVISION', 'HECHO', { detalle: 'APROBADA' }),
    paso(3, 'ANULACION', 'HECHO'),
  ])
  assert.deepEqual(pasos.map((p) => p.titulo), ['Enviada a Gerencia', 'Aprobada', 'Anulada'])
  assert.equal(pasos[1].nota, null)
})

test('un paso que este mapa no conoce se pinta en llano, no se esconde', () => {
  const [hecho, ahora] = describirRecorridoDelRequerimiento([
    paso(1, 'PASO_NUEVO', 'HECHO', { detalle: 'algo' }),
    paso(2, 'OTRO_PASO', 'AHORA', { espera: 'ESPERA_NUEVA' }),
  ])
  assert.equal(hecho.titulo, 'paso nuevo')
  assert.equal(hecho.nota, null)
  assert.equal(ahora.titulo, 'otro paso')
  assert.equal(ahora.nota, null)
})

test('el recorrido de la avería dice las horas parado del cierre y que no quedó bien', () => {
  const pasos = describirRecorridoDeLaAveria([
    { orden: 1, paso: 'REPORTE', situacion: 'HECHO', puesto: 'Ventas', en: '2026-11-25T10:00:00Z', dias: null, espera: null, detalle: 'PARADO' },
    { orden: 2, paso: 'ATENCION', situacion: 'HECHO', puesto: 'Mantenimiento', en: '2026-11-25T11:00:00Z', dias: null, espera: null, detalle: null },
    { orden: 3, paso: 'CIERRE', situacion: 'HECHO', puesto: 'Mantenimiento', en: '2026-11-26T10:00:00Z', dias: null, espera: null, detalle: '26.5|Se cambiaron los carbones.' },
    { orden: 4, paso: 'REAPERTURA', situacion: 'HECHO', puesto: 'Ventas', en: '2026-11-26T12:00:00Z', dias: null, espera: null, detalle: 'Se volvió a apagar.' },
    { orden: 5, paso: 'CIERRE', situacion: 'AHORA', puesto: 'Mantenimiento', en: '2026-11-26T12:00:00Z', dias: 0, espera: 'CIERRE', detalle: null },
    { orden: 6, paso: 'CONFIRMACION', situacion: 'PENDIENTE', puesto: null, en: null, dias: null, espera: null, detalle: null },
  ])
  assert.deepEqual(
    pasos.map((p) => [p.titulo, p.nota]),
    [
      ['Reportada: el equipo quedó parado', null],
      ['Mantenimiento anotó su diagnóstico', null],
      ['Mantenimiento la cerró', 'Parado: 26.5 horas. Se cambiaron los carbones.'],
      ['No quedó bien: volvió a Mantenimiento', '«Se volvió a apagar.»'],
      ['Cierre: el equipo vuelve a operativo', 'La arregla y la cierra con el trabajo hecho y las horas parado.'],
      ['Quien la reportó confirma que quedó bien', null],
    ],
  )
})

test('con varias unidades, Administración la tiene hasta cargar la OT de cada una', () => {
  const [ninguna, algunas, una, todas] = describirRecorridoDeLaCotizacion([
    paso(1, 'CODIGO_Y_OT', 'AHORA', { puesto: 'Administración', espera: 'CODIGO_Y_OT', detalle: '0/3' }),
    paso(2, 'CODIGO_Y_OT', 'AHORA', { puesto: 'Administración', espera: 'CODIGO_Y_OT', detalle: '1/3' }),
    paso(3, 'CODIGO_Y_OT', 'AHORA', { puesto: 'Administración', espera: 'CODIGO_Y_OT', detalle: '2/3' }),
    paso(4, 'CODIGO_Y_OT', 'HECHO', { detalle: '3 OT' }),
  ])
  assert.equal(ninguna.nota, 'Le da a cada una de las 3 unidades su código interno y sube su OT.')
  assert.equal(algunas.nota, 'Lleva 1 de 3 OT: faltan las de 2 unidades, cada una con su código interno.')
  assert.equal(una.nota, 'Lleva 2 de 3 OT: falta la de 1 unidad, con su código interno.')
  assert.equal(todas.nota, '3 OT')
})

test('la cotización sigue hasta el cobro: la factura de lo que falta y el cobro en parte (Plan 10.1)', () => {
  const pasos = describirRecorridoDeLaCotizacion([
    paso(1, 'FACTURA', 'HECHO', { puesto: 'Contabilidad', en: '2026-11-24T15:00:00Z' }),
    paso(2, 'FACTURA_RESTO', 'AHORA', { puesto: 'Contabilidad', dias: 4, espera: 'FACTURA_RESTO' }),
    paso(3, 'COBRO', 'AHORA', { puesto: 'Tesorería', dias: 2, espera: 'COBRO', detalle: 'EN_PARTE' }),
  ])
  assert.equal(pasos[1].titulo, 'Factura de lo que falta')
  assert.equal(pasos[1].nota, 'Registra la factura de lo que falta del total.')
  assert.equal(pasos[2].nota, 'Cobra lo que falta: ya cobró una parte.')
  const cobrada = describirRecorridoDeLaCotizacion([paso(1, 'COBRO', 'HECHO', { puesto: 'Tesorería' })])
  assert.equal(cobrada[0].titulo, 'Cobrada')
  const porCobrar = describirRecorridoDeLaCotizacion([paso(1, 'COBRO', 'AHORA', { espera: 'COBRO' })])
  assert.equal(porCobrar[0].nota, 'Cobra sus facturas.')
  // La factura hecha por una parte no se da por facturada entera.
  const enParte = describirRecorridoDeLaCotizacion([paso(1, 'FACTURA', 'HECHO', { puesto: 'Contabilidad', detalle: 'EN_PARTE' })])
  assert.equal(enParte[0].titulo, 'Facturada en parte')
  assert.equal(describirRecorridoDeLaCotizacion([paso(1, 'FACTURA', 'HECHO', { puesto: 'Contabilidad' })])[0].titulo, 'Facturada')
})
