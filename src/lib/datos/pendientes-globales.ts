import 'server-only'

import type { Tono } from '@/components/ui/etiqueta-estado'
import { codigosDeDiseno, planosDeCodigo } from '@/lib/datos/diseno-codigos'
import { ESTADOS_ACTIVOS_OT } from '@/lib/dominio/estados'
import { devueltaEntera } from '@/lib/dominio/pago-de-boleta'
import { estadoDePlanilla } from '@/lib/dominio/planilla-diaria'
import { ESTADOS_RQ_ABIERTOS, leTocaAtender, quienAtiende, tipoDeRequerimiento } from '@/lib/dominio/requerimientos'
import { hoyLima, mesLargo } from '@/lib/format'
import { menuDe } from '@/lib/navegacion'
import { apruebaSinOrden, puede, type PerfilSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Lo que espera a quien mira en cada módulo, en todo el sistema: los globos del
 * menú y de la barra del teléfono. Hasta el 2026-10-19 también era la lista
 * «Te toca hoy» del Dashboard; se quitó porque el sistema no le dice a nadie
 * qué hacer, le muestra lo que espera en cada pantalla que puede abrir. Cada
 * cuenta se pide solo si el puesto tiene el permiso que la resuelve —a quien no
 * puede aprobar no se le cuentan reportes por aprobar— y cada una es un `count`
 * de cabecera sobre las vistas que ya existen, que el RLS filtra solo. Una
 * lectura que falle deja su ruta en `sinComprobar` y el globo sale con «!»:
 * nunca se presenta como si no hubiera nada pendiente.
 */
export type PendientesGlobales = {
  /** Cuántos pendientes cuelgan de cada módulo del menú, por su ruta base. */
  porRuta: Record<string, number>
  /** Las rutas con alguna cuenta que no se pudo leer: su globo dice «!», no cero. */
  sinComprobar: string[]
}

/** Cuántos hay; con `ruta`, el enlace afina adónde llevar (el mes del más antiguo, por ejemplo). */
type Cuenta = () => Promise<number | { cantidad: number; ruta?: string }>

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export async function pendientesGlobales(perfil: PerfilSesion): Promise<PendientesGlobales> {
  const supabase = await createClient()
  const hoy = hoyLima()

  const cabeza = async (consulta: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count, error } = await consulta
    if (error) throw new Error('No se pudo consultar el pendiente.')
    return count ?? 0
  }

  // Las terminadas que esperan a tesorería o el acta se cruzan en memoria: son
  // pocas y no hay vista que las junte.
  const terminadas = async () => {
    const { data, error } = await supabase.from('ordenes_trabajo').select('id').eq('estado', 'TERMINADA').limit(500)
    if (error) throw new Error('No se pudieron leer las órdenes terminadas.')
    const ids = (data ?? []).map((o) => o.id)
    if (ids.length === 0) return { ids, liberadas: new Set<string>(), entregadas: new Set<string>() }
    const [lib, ent] = await Promise.all([
      supabase.from('liberaciones_tesoreria').select('orden_id').in('orden_id', ids),
      supabase.from('ot_entregas').select('orden_id').in('orden_id', ids),
    ])
    if (lib.error || ent.error) throw new Error('No se pudieron leer las liberaciones y entregas.')
    return {
      ids,
      liberadas: new Set((lib.data ?? []).map((l) => l.orden_id)),
      entregadas: new Set((ent.data ?? []).map((e) => e.orden_id)),
    }
  }

  const aprueba = puede(perfil, 'produccion.aprobar_reportes')
  const todoElTaller = aprueba || puede(perfil, 'produccion.cualquier_area')

  const tareas: { clave: string; ruta: string; tono: Tono; texto: (n: number) => string; contar: Cuenta }[] = []

  const tramitesMateriales = [
    { permiso: 'diseno.planos', campo: 'por_aprobar', texto: 'materiales propuestos por revisar', ruta: '/ordenes?estado=ABIERTAS' },
    { permiso: 'almacen.recibir', campo: 'por_revisar_stock', texto: 'solicitudes de materiales por revisar en Almacén', ruta: '/ordenes?estado=ABIERTAS' },
    { permiso: 'almacen.recibir', campo: 'por_recibir', texto: 'insumos comprados por recibir', ruta: '/ordenes?estado=ABIERTAS' },
    { permiso: 'almacen.despachar', campo: 'por_despachar', texto: 'materiales por despachar con foto', ruta: '/ordenes?estado=ABIERTAS' },
  ]
  for (const tramite of tramitesMateriales) {
    if (puede(perfil, tramite.permiso)) tareas.push({
      clave: tramite.campo, ruta: tramite.ruta, tono: 'aviso', texto: n => `${n} ${tramite.texto}`,
      contar: () => cabeza(supabase.from('v_pendientes_materiales').select('detalle_id', { count: 'exact', head: true }).eq(tramite.campo, true)),
    })
  }
  for (const tramite of [
    { permiso: 'diseno.revisar_informe', estado: 'EN_REVISION', texto: 'informes semanales por revisar' },
  ]) {
    if (puede(perfil, tramite.permiso)) tareas.push({
      clave: `informe_${tramite.estado}`, ruta: '/diseno/informe-semanal', tono: 'aviso', texto: n => `${n} ${tramite.texto}`,
      contar: () => cabeza(supabase.from('diseno_informes').select('id', { count: 'exact', head: true }).eq('estado', tramite.estado)),
    })
  }

  // La gestión de compras (migración 20261015140000): Logística y el conductor
  // cuentan cosas distintas de la misma lista, que se lee una vez.
  let gestion: ReturnType<typeof leerGestion> | null = null
  async function leerGestion() {
    const { data, error } = await supabase.rpc('compras_en_gestion')
    if (error) throw new Error('No se pudo consultar el pendiente.')
    return data ?? []
  }
  const enGestion = () => (gestion ??= leerGestion())

  // Logística: lo que Gerencia aprobó y todavía no está en la lista del conductor.
  if (puede(perfil, 'compras.programar_recojo')) tareas.push({
    clave: 'compras_por_programar', ruta: '/compras/gestion', tono: 'aviso',
    texto: n => plural(n, 'compra aprobada por programar con el conductor', 'compras aprobadas por programar con el conductor'),
    contar: async () => (await enGestion()).filter((c) => c.recojo === 'POR_RECOGER' && !c.en_lista).length,
  })

  // Contabilidad: las que ya tienen peso y esperan su guía de remisión. La carga
  // en Adquisiciones: la gestión ya no es suya (migración 20261020171000).
  if (puede(perfil, 'compras.guia_remision')) tareas.push({
    clave: 'guias_por_cargar', ruta: '/adquisiciones?situacion=guia', tono: 'aviso',
    texto: n => plural(n, 'guía de remisión por cargar', 'guías de remisión por cargar'),
    contar: async () => {
      const { data, error } = await supabase.rpc('guias_por_emitir')
      if (error) throw new Error('No se pudo consultar el pendiente.')
      return (data ?? []).length
    },
  })

  // El conductor de Logística: lo que Logística le programó o lleva en camino.
  if (puede(perfil, 'compras.recojo')) tareas.push({
    clave: 'compras_por_recoger', ruta: '/recojos', tono: 'aviso',
    texto: n => plural(n, 'compra por recoger o dejar en almacén', 'compras por recoger o dejar en almacén'),
    contar: async () => (await enGestion()).filter((c) => c.recojo === 'EN_RECOJO' || c.recojo === 'RECOGIDO' || (c.recojo === 'POR_RECOGER' && c.en_lista)).length,
  })

  if (puede(perfil, 'cotizaciones.revisar')) {
    tareas.push({
      clave: 'pdf_por_revisar',
      ruta: '/cotizaciones/pdf?estado=POR_REVISAR',
      tono: 'aviso',
      texto: (n) => plural(n, 'cotización por revisar', 'cotizaciones por revisar'),
      contar: () =>
        cabeza(supabase.from('v_cotizaciones_pdf').select('id', { count: 'exact', head: true }).eq('estado', 'POR_REVISAR')),
    })
  }

  // Las aprobadas antes de que la aprobación trajera código y OT (migración
  // 20261016900000): Gerencia les da su código y les carga la OT.
  if (puede(perfil, 'cotizaciones.revisar')) {
    tareas.push({
      clave: 'pdf_sin_ot',
      ruta: '/cotizaciones/pdf?estado=APROBADA_SIN_OT',
      tono: 'acento',
      texto: (n) => plural(n, 'cotización aprobada sin código ni OT', 'cotizaciones aprobadas sin código ni OT'),
      contar: () =>
        cabeza(
          supabase
            .from('v_cotizaciones_pdf')
            .select('id', { count: 'exact', head: true })
            .eq('estado', 'APROBADA')
            .is('orden_id', null),
        ),
    })
  }

  if (puede(perfil, 'ordenes.editar') && puede(perfil, 'clientes.ver')) {
    tareas.push({
      clave: 'ot_sin_cliente',
      ruta: '/ordenes?estado=ABIERTAS',
      tono: 'aviso',
      texto: (n) => plural(n, 'orden sin cliente', 'órdenes sin cliente'),
      contar: () =>
        cabeza(
          supabase
            .from('ordenes_trabajo')
            .select('id', { count: 'exact', head: true })
            .is('cliente_id', null)
            .in('estado', [...ESTADOS_ACTIVOS_OT, 'BORRADOR']),
        ),
    })
  }

  if (puede(perfil, 'ordenes.aprobar')) {
    tareas.push({
      clave: 'ot_por_aprobar',
      ruta: '/ordenes?estado=BORRADOR',
      tono: 'aviso',
      texto: (n) => plural(n, 'orden por aprobar', 'órdenes por aprobar'),
      contar: () =>
        cabeza(
          supabase
            .from('ordenes_trabajo')
            .select('id', { count: 'exact', head: true })
            .eq('estado', 'BORRADOR')
            .eq('abierta_en_taller', false),
        ),
    })
  }

  if (puede(perfil, 'ordenes.revisar_taller')) {
    tareas.push({
      clave: 'ot_del_taller',
      ruta: '/ordenes?estado=BORRADOR',
      tono: 'aviso',
      texto: (n) => plural(n, 'orden abierta por el taller por revisar', 'órdenes abiertas por el taller por revisar'),
      contar: () =>
        cabeza(
          supabase
            .from('ordenes_trabajo')
            .select('id', { count: 'exact', head: true })
            .eq('estado', 'BORRADOR')
            .eq('abierta_en_taller', true),
        ),
    })
  }

  if (aprueba) {
    tareas.push({
      clave: 'reportes_por_aprobar',
      ruta: '/ordenes?estado=ABIERTAS',
      tono: 'aviso',
      texto: (n) => plural(n, 'reporte por aprobar', 'reportes por aprobar'),
      contar: async () => {
        const [hoja, foto] = await Promise.all([
          cabeza(supabase.from('v_ot_avance_diario').select('id', { count: 'exact', head: true }).eq('revision', 'PENDIENTE')),
          cabeza(supabase.from('ot_avance_resumen').select('id', { count: 'exact', head: true }).eq('revision', 'PENDIENTE')),
        ])
        return hoja + foto
      },
    })
  } else if (puede(perfil, 'produccion.registrar')) {
    tareas.push({
      clave: 'mios_observados',
      ruta: '/ordenes?estado=ABIERTAS',
      tono: 'peligro',
      texto: (n) => plural(n, 'reporte tuyo observado por corregir', 'reportes tuyos observados por corregir'),
      contar: async () => {
        const [hoja, foto, flota] = await Promise.all([
          cabeza(
            supabase
              .from('v_ot_avance_diario')
              .select('id', { count: 'exact', head: true })
              .eq('revision', 'OBSERVADO')
              .eq('reportado_por', perfil.id),
          ),
          cabeza(
            supabase
              .from('ot_avance_resumen')
              .select('id', { count: 'exact', head: true })
              .eq('revision', 'OBSERVADO')
              .eq('registrado_por', perfil.id),
          ),
          cabeza(
            supabase
              .from('v_flota_avance_diario')
              .select('id', { count: 'exact', head: true })
              .eq('revision', 'OBSERVADO')
              .eq('registrado_por', perfil.id),
          ),
        ])
        return hoja + foto + flota
      },
    })
  }

  // Los de los trabajos sin orden van aparte: viven en otra pantalla, y
  // contarlos con los de las OT mandaba a buscarlos donde no están. Los ve
  // también Gerencia, que aprueba solo esos.
  if (apruebaSinOrden(perfil)) {
    tareas.push({
      clave: 'reportes_sin_orden_por_aprobar',
      ruta: '/avance/trabajos',
      tono: 'aviso',
      texto: (n) =>
        plural(n, 'reporte de un trabajo sin orden por aprobar', 'reportes de trabajos sin orden por aprobar'),
      contar: () =>
        cabeza(supabase.from('v_flota_avance_diario').select('id', { count: 'exact', head: true }).eq('revision', 'PENDIENTE')),
    })
  }

  if (puede(perfil, 'produccion.registrar') && perfil.area_id && !todoElTaller) {
    const area = perfil.area_id
    tareas.push({
      clave: 'hojas_sin_reporte',
      ruta: '/ordenes?estado=ABIERTAS',
      tono: 'aviso',
      texto: (n) => plural(n, 'hoja de tu área sin reporte de hoy', 'hojas de tu área sin reporte de hoy'),
      contar: async () => {
        const { data, error } = await supabase
          .from('v_ot_avance_areas')
          .select('ultimo_reporte, orden_estado')
          .eq('area_id', area)
          .in('orden_estado', [...ESTADOS_ACTIVOS_OT])
          .limit(200)
        if (error) throw new Error('No se pudo leer el avance por área.')
        return (data ?? []).filter((h) => !h.ultimo_reporte || h.ultimo_reporte < hoy).length
      },
    })
  }

  // Las observaciones van a un área: el jefe las ve todas, cada área las suyas.
  if (todoElTaller || perfil.area_id) {
    const area = perfil.area_id
    tareas.push({
      clave: 'observaciones',
      ruta: '/ordenes?estado=ABIERTAS',
      tono: 'aviso',
      texto: (n) =>
        `${plural(n, 'observación abierta', 'observaciones abiertas')}${todoElTaller ? '' : ' para tu área'}`,
      contar: () => {
        let consulta = supabase.from('v_ot_observaciones').select('id', { count: 'exact', head: true }).eq('abierta', true)
        if (!todoElTaller && area) consulta = consulta.eq('area_id', area)
        return cabeza(consulta)
      },
    })
  }

  if (puede(perfil, 'diseno.planos')) {
    tareas.push({
      clave: 'ot_sin_planos',
      ruta: '/ordenes?estado=ABIERTAS',
      tono: 'acento',
      texto: (n) => plural(n, 'orden sin planos que desglosar', 'órdenes sin planos que desglosar'),
      contar: async () => {
        const { data, error } = await supabase
          .from('ordenes_trabajo')
          .select('id')
          .in('estado', [...ESTADOS_ACTIVOS_OT])
          .limit(500)
        if (error) throw new Error('No se pudieron leer las órdenes activas.')
        const ids = (data ?? []).map((o) => o.id)
        if (ids.length === 0) return 0
        const { data: con, error: errorPlanos } = await supabase.from('v_cumplimiento_ot').select('orden_id').in('orden_id', ids).gt('planos', 0)
        if (errorPlanos) throw new Error('No se pudo leer el cumplimiento de planos.')
        const conPlanos = new Set((con ?? []).map((c) => c.orden_id))
        return ids.filter((id) => !conPlanos.has(id)).length
      },
    })
  }

  // Sin etapas con fecha no hay plan contra real ni
  // avance que medir: Diseño las define y Administración las programa. Las dos
  // cuentas salen de la misma lectura.
  const planDeEtapas = (() => {
    let lectura: Promise<{ sinEtapas: number; sinProgramar: number }> | null = null
    return () =>
      (lectura ??= (async () => {
        const { data: ordenes, error } = await supabase
          .from('ordenes_trabajo')
          .select('id')
          .in('estado', [...ESTADOS_ACTIVOS_OT])
          .eq('plan_etapas_manual', true)
          .limit(500)
        if (error) throw new Error('No se pudieron leer las órdenes.')
        const ids = (ordenes ?? []).map((o) => o.id)
        if (ids.length === 0) return { sinEtapas: 0, sinProgramar: 0 }
        const { data: etapas, error: errorEtapas } = await supabase
          .from('ot_etapas')
          .select('orden_id, estado, fecha_inicio_programada, fecha_fin_programada')
          .in('orden_id', ids)
        if (errorEtapas) throw new Error('No se pudieron leer las etapas.')
        const conEtapas = new Set((etapas ?? []).map((e) => e.orden_id))
        const sinProgramar = new Set(
          (etapas ?? [])
            .filter((e) => e.estado !== 'OMITIDA' && (!e.fecha_inicio_programada || !e.fecha_fin_programada))
            .map((e) => e.orden_id),
        )
        return { sinEtapas: ids.filter((id) => !conEtapas.has(id)).length, sinProgramar: sinProgramar.size }
      })())
  })()

  if (puede(perfil, 'diseno.planos')) {
    tareas.push({
      clave: 'ot_sin_etapas',
      ruta: '/ordenes?estado=ABIERTAS',
      tono: 'aviso',
      texto: (n) => plural(n, 'orden sin etapas definidas', 'órdenes sin etapas definidas'),
      contar: async () => (await planDeEtapas()).sinEtapas,
    })
  }

  if (puede(perfil, 'ordenes.editar')) {
    tareas.push({
      clave: 'etapas_sin_programar',
      ruta: '/ordenes?estado=ABIERTAS',
      tono: 'aviso',
      texto: (n) => plural(n, 'orden con etapas sin programar', 'órdenes con etapas sin programar'),
      contar: async () => (await planDeEtapas()).sinProgramar,
    })
  }

  // Una OT terminada con el costo abierto sigue cambiando con cada factura que
  // llega: Costos lo cierra para que quede la cifra con la que se entregó.
  if (puede(perfil, 'costos.controlar_ot')) {
    tareas.push({
      clave: 'costo_por_cerrar',
      ruta: '/ordenes?estado=TERMINADA',
      tono: 'aviso',
      texto: (n) => plural(n, 'orden terminada con el costo sin cerrar', 'órdenes terminadas con el costo sin cerrar'),
      contar: async () => {
        const { data: ordenes, error } = await supabase
          .from('ordenes_trabajo')
          .select('id')
          .in('estado', ['TERMINADA', 'ENTREGADA', 'FACTURADA'])
          .limit(500)
        if (error) throw new Error('No se pudieron leer las órdenes.')
        const ids = (ordenes ?? []).map((o) => o.id)
        if (ids.length === 0) return 0
        const { data: cerradas, error: errorCierres } = await supabase.from('ot_cierres_costo').select('orden_id').in('orden_id', ids)
        if (errorCierres) throw new Error('No se pudieron leer los cierres de costo.')
        const conCierre = new Set((cerradas ?? []).map((c) => c.orden_id))
        return ids.filter((id) => !conCierre.has(id)).length
      },
    })
  }

  // La mano de obra de cada carrocería entra cuando RR. HH. cierra la planilla
  // del mes y la reparte: mientras tanto, el costo de todas las OT sale corto.
  if (puede(perfil, 'rrhh.gestionar_planillas')) {
    const mesAnterior = primerDiaDelMesAnterior(hoy)
    tareas.push({
      clave: 'planilla_por_cerrar',
      ruta: '/rrhh',
      tono: 'aviso',
      texto: (n) => `${n} planilla de taller de ${mesLargo(mesAnterior)} por cerrar y repartir`,
      contar: async () => {
        const { count, error } = await supabase
          .from('planillas')
          .select('id', { count: 'exact', head: true })
          .eq('tipo', 'TALLER')
          .eq('periodo', mesAnterior)
          .eq('estado', 'CERRADA')
        if (error) throw new Error('No se pudo leer la planilla.')
        return (count ?? 0) > 0 ? 0 : 1
      },
    })
  }

  if (puede(perfil, 'tesoreria.liberar') || puede(perfil, 'ordenes.entregar')) {
    // Perezosa: si ninguna de las dos tareas queda en el menú del puesto, no se
    // lee nada (y un error no queda sin quien lo atienda).
    let cierre: ReturnType<typeof terminadas> | undefined
    const terminadasUnaVez = () => (cierre ??= terminadas())
    if (puede(perfil, 'tesoreria.liberar')) {
      tareas.push({
        clave: 'liberar',
        ruta: '/ordenes?estado=TERMINADA',
        tono: 'aviso',
        texto: (n) => plural(n, 'orden terminada espera la liberación de tesorería', 'órdenes terminadas esperan la liberación de tesorería'),
        contar: async () => {
          const c = await terminadasUnaVez()
          return c.ids.filter((id) => !c.liberadas.has(id)).length
        },
      })
    }
    if (puede(perfil, 'ordenes.entregar')) {
      tareas.push({
        clave: 'acta',
        ruta: '/ordenes?estado=TERMINADA',
        tono: 'acento',
        texto: (n) => plural(n, 'orden liberada espera el acta de entrega', 'órdenes liberadas esperan el acta de entrega'),
        contar: async () => {
          const c = await terminadasUnaVez()
          return c.ids.filter((id) => c.liberadas.has(id) && !c.entregadas.has(id)).length
        },
      })
    }
  }

  if (puede(perfil, 'ordenes.editar')) {
    tareas.push({
      clave: 'facturar',
      ruta: '/ordenes?estado=ENTREGADA',
      tono: 'neutro',
      texto: (n) => plural(n, 'orden entregada sin facturar', 'órdenes entregadas sin facturar'),
      contar: () =>
        cabeza(supabase.from('ordenes_trabajo').select('id', { count: 'exact', head: true }).eq('estado', 'ENTREGADA')),
    })
  }

  // La factura de venta y su cobro cuelgan del código interno (migración
  // 20261015124000): las dos cuentas salen de una sola lectura, y la base deja
  // en nulo la que no es de quien mira.
  const facturacion = (() => {
    let lectura: Promise<{ por_facturar: number | null; por_cobrar: number | null }> | null = null
    return () =>
      (lectura ??= (async () => {
        const { data, error } = await supabase.rpc('facturacion_pendientes')
        if (error || !data?.[0]) throw new Error('No se pudo consultar el pendiente.')
        return data[0]
      })())
  })()

  if (puede(perfil, 'contabilidad.facturar')) {
    tareas.push({
      clave: 'por_facturar',
      ruta: '/contabilidad/facturacion',
      tono: 'acento',
      texto: (n) => plural(n, 'cotización aprobada por facturar', 'cotizaciones aprobadas por facturar'),
      contar: async () => (await facturacion()).por_facturar ?? 0,
    })
  }

  if (puede(perfil, 'tesoreria.registrar_cobros')) {
    tareas.push({
      clave: 'por_cobrar',
      ruta: '/tesoreria/por-cobrar',
      tono: 'acento',
      texto: (n) => plural(n, 'factura por cobrar', 'facturas por cobrar'),
      contar: async () => (await facturacion()).por_cobrar ?? 0,
    })
  }

  // Las órdenes de servicio conformes que Tesorería no ha pagado (migración 20261015120000).
  if (puede(perfil, 'tesoreria.pagar_servicios')) {
    tareas.push({
      clave: 'servicios_por_pagar',
      ruta: '/tesoreria/pagos-de-servicio',
      tono: 'aviso',
      texto: (n) => plural(n, 'servicio conforme por pagar', 'servicios conformes por pagar'),
      contar: async () => {
        const { data, error } = await supabase.rpc('servicios_pendientes_de_pago')
        if (error) throw new Error('No se pudo consultar el pendiente.')
        return data ?? 0
      },
    })
  }

  // La salida de un vehículo de la planta (migración 20261016110000): Requerimientos
  // pide la revisión con la ficha cerrada y escaneada, y Tesorería la responde.
  if (puede(perfil, 'tesoreria.liberar') && puede(perfil, 'tesoreria.registrar_cobros')) {
    tareas.push({
      clave: 'salidas_por_revisar',
      ruta: '/tesoreria/por-cobrar',
      tono: 'aviso',
      texto: (n) => plural(n, 'salida de vehículo por revisar', 'salidas de vehículo por revisar'),
      contar: async () => {
        const { data, error } = await supabase.rpc('revisiones_de_salida_pendientes')
        if (error) throw new Error('No se pudo consultar el pendiente.')
        return (data ?? []).length
      },
    })
  }
  if (puede(perfil, 'vehiculos.registrar')) {
    tareas.push({
      clave: 'salidas_observadas',
      ruta: '/vehiculos',
      tono: 'peligro',
      texto: (n) => plural(n, 'salida de vehículo observada por Tesorería', 'salidas de vehículo observadas por Tesorería'),
      contar: async () => {
        // El último pedido de cada vehículo que sigue en la planta: cuenta si Tesorería lo observó.
        const { data, error } = await supabase
          .from('registro_vehiculo_revisiones')
          .select('registro_id, estado, registro_vehiculos!inner(salida_en, anulado_en)')
          .is('registro_vehiculos.salida_en', null)
          .is('registro_vehiculos.anulado_en', null)
          .order('creado_en', { ascending: false })
          .limit(300)
        if (error) throw new Error('No se pudo consultar el pendiente.')
        const ultimo = new Map<string, string>()
        for (const r of data ?? []) if (!ultimo.has(r.registro_id)) ultimo.set(r.registro_id, r.estado)
        return [...ultimo.values()].filter((e) => e === 'OBSERVADA').length
      },
    })
  }

  if (puede(perfil, 'cotizaciones.crear')) {
    tareas.push({
      clave: 'pdf_rechazadas',
      ruta: '/cotizaciones/pdf?estado=RECHAZADA',
      tono: 'peligro',
      texto: (n) => plural(n, 'cotización tuya rechazada por corregir', 'cotizaciones tuyas rechazadas por corregir'),
      contar: () =>
        cabeza(
          supabase
            .from('v_cotizaciones_pdf')
            .select('id', { count: 'exact', head: true })
            .eq('estado', 'RECHAZADA')
            .eq('registrado_por', perfil.id),
        ),
    })
  }

  // ── Lo que cada puesto atiende desde que el trabajo va por código interno ──

  // Gerencia: las compras y servicios que esperan su visto. Quién aprueba lo
  // decide la base con la regla de aprobación, como en la pantalla.
  tareas.push({
    clave: 'compras_por_aprobar', ruta: '/compras/aprobacion', tono: 'aviso',
    texto: n => plural(n, 'compra o servicio por aprobar', 'compras y servicios por aprobar'),
    contar: async () => {
      const aprueba = await supabase.rpc('es_aprobador_compras')
      if (aprueba.error) throw new Error('No se pudo consultar el pendiente.')
      if (aprueba.data !== true) return 0
      const { data, error } = await supabase.rpc('documentos_por_aprobar')
      if (error) throw new Error('No se pudo consultar el pendiente.')
      return (data ?? []).filter((d) => d.aprobacion === 'POR_APROBAR').length
    },
  })

  // El reporte diario lo validan Gerencia y RR. HH., cada uno su visto: a cada
  // uno se le cuentan los que esperan el suyo, de cualquier mes. El enlace abre
  // el mes del más antiguo, que es el primero que hay que validar.
  for (const lado of [
    { permiso: 'reporte_diario.validar_gerencia', columna: 'visto_gerencia_en' },
    { permiso: 'reporte_diario.validar_rrhh', columna: 'visto_rrhh_en' },
  ] as const) {
    if (!puede(perfil, lado.permiso) || perfil.rol.codigo === 'ADMIN') continue
    tareas.push({
      clave: `reportes_${lado.columna}`,
      ruta: '/reportes-diarios?estado=por-validar',
      tono: 'aviso',
      texto: n => plural(n, 'reporte diario espera tu visto', 'reportes diarios esperan tu visto'),
      contar: async () => {
        const { data, error } = await supabase
          .from('reportes_diarios')
          .select('fecha')
          .is('anulado_en', null)
          .is('observado_en', null)
          .is(lado.columna, null)
          .order('fecha')
          .limit(500)
        if (error) throw new Error('No se pudo consultar el pendiente.')
        const primero = data?.[0]?.fecha
        return { cantidad: data?.length ?? 0, ruta: primero ? `/reportes-diarios?mes=${primero.slice(0, 7)}&estado=por-validar` : undefined }
      },
    })
  }

  // El supervisor: lo que Gerencia o RR. HH. le observó y el reporte de hoy.
  if (puede(perfil, 'reporte_diario.registrar') && perfil.rol.codigo !== 'ADMIN') {
    tareas.push({
      clave: 'reportes_observados', ruta: '/reportes-diarios?estado=observados', tono: 'peligro',
      texto: n => plural(n, 'reporte diario observado por corregir', 'reportes diarios observados por corregir'),
      contar: () => cabeza(
        supabase.from('reportes_diarios').select('id', { count: 'exact', head: true })
          .eq('registrado_por', perfil.id).is('anulado_en', null).not('observado_en', 'is', null),
      ),
    })
    // El domingo no se trabaja: no se le pide reporte.
    if (new Date(`${hoy}T12:00:00Z`).getUTCDay() !== 0) tareas.push({
      clave: 'reporte_de_hoy', ruta: '/reportes-diarios', tono: 'acento',
      texto: () => 'Tu reporte diario de hoy todavía no está subido',
      contar: async () => {
        const n = await cabeza(
          supabase.from('reportes_diarios').select('id', { count: 'exact', head: true })
            .eq('registrado_por', perfil.id).eq('fecha', hoy).is('anulado_en', null),
        )
        return n > 0 ? 0 : 1
      },
    })
  }

  // Los planos que Diseño cargó para el área del supervisor y él no recibió.
  if (puede(perfil, 'codigos_internos.area') && perfil.rol.codigo !== 'ADMIN') tareas.push({
    clave: 'planos_por_recibir', ruta: '/planos?ver=por-recibir', tono: 'aviso',
    texto: n => plural(n, 'plano de tu área por recibir', 'planos de tu área por recibir'),
    contar: async () => (await planosDeCodigo(null, { conPeso: false })).filter((p) => !p.anulado_en && !p.recibido_en).length,
  })

  // Los requerimientos abiertos se leen una vez: Almacén, Logística, la
  // administradora y el supervisor cuentan cosas distintas de la misma lista.
  let abiertos: Promise<{ estado: string; tipo: string | null; area_id: string | null }[]> | null = null
  const rqAbiertos = () =>
    (abiertos ??= (async () => {
      const { data, error } = await supabase
        .from('requerimientos')
        .select('estado, tipo, area_id')
        .in('estado', [...ESTADOS_RQ_ABIERTOS])
        .limit(1000)
      if (error) throw new Error('No se pudo consultar el pendiente.')
      return data ?? []
    })())
  const atiende = quienAtiende(perfil)
  const rqQueTeTocan = (estado: string) => async () =>
    (await rqAbiertos()).filter((r) => r.estado === estado && leTocaAtender(r, atiende)).length

  if (atiende.recibe) tareas.push({
    clave: 'rq_por_revisar', ruta: '/requerimientos/atencion', tono: 'aviso',
    texto: n => plural(n, 'requerimiento por revisar insumo por insumo', 'requerimientos por revisar insumo por insumo'),
    contar: rqQueTeTocan('POR_ATENDER'),
  })
  if (atiende.compraDe.OPERACION || atiende.compraDe.ADMINISTRACION) tareas.push({
    clave: 'rq_por_comprar', ruta: '/requerimientos/atencion', tono: 'aviso',
    texto: n => plural(n, 'requerimiento sin stock por comprar', 'requerimientos sin stock por comprar'),
    contar: async () =>
      (await rqAbiertos()).filter((r) => r.estado === 'SIN_STOCK' && atiende.compraDe[tipoDeRequerimiento(r)]).length,
  })
  if (atiende.despacha) tareas.push({
    clave: 'rq_por_entregar', ruta: '/requerimientos/atencion', tono: 'acento',
    texto: n => plural(n, 'requerimiento listo por entregar al área', 'requerimientos listos por entregar al área'),
    contar: rqQueTeTocan('LISTO_EN_ALMACEN'),
  })
  // El supervisor recoge de Almacén lo que su área pidió.
  if (puede(perfil, 'reporte_diario.registrar') && perfil.area_id && perfil.rol.codigo !== 'ADMIN') {
    const area = perfil.area_id
    tareas.push({
      clave: 'rq_por_recoger', ruta: '/requerimientos', tono: 'acento',
      texto: n => plural(n, 'requerimiento de tu área listo para recoger en almacén', 'requerimientos de tu área listos para recoger en almacén'),
      contar: async () => (await rqAbiertos()).filter((r) => r.estado === 'LISTO_EN_ALMACEN' && r.area_id === area).length,
    })
  }

  // Almacén: lo que el conductor dejó y falta validar, y las salidas de materia
  // prima y EPP que esperan su formato firmado.
  if (puede(perfil, 'almacen.recibir')) tareas.push({
    clave: 'ingresos_por_validar', ruta: '/almacen/kardex', tono: 'aviso',
    texto: n => plural(n, 'compra dejada en almacén por validar', 'compras dejadas en almacén por validar'),
    contar: async () => {
      const { data, error } = await supabase.rpc('ingresos_por_validar')
      if (error) throw new Error('No se pudo consultar el pendiente.')
      return new Set((data ?? []).map((l) => l.orden_compra_id)).size
    },
  })
  if (puede(perfil, 'almacen.despachar')) tareas.push({
    clave: 'salidas_por_cerrar', ruta: '/almacen/kardex', tono: 'aviso',
    texto: n => plural(n, 'salida espera su formato firmado', 'salidas esperan su formato firmado'),
    contar: () => cabeza(supabase.from('v_kardex_almacen').select('id', { count: 'exact', head: true }).eq('formato_pendiente', true)),
  })

  // Tesorería: las facturas de compra con saldo (las vencidas aparte), los
  // recibos por honorarios y las planillas diarias por pagar.
  if (puede(perfil, 'tesoreria.registrar_pagos')) {
    let saldos: Promise<{ vencidas: number; resto: number }> | null = null
    const porPagar = () =>
      (saldos ??= (async () => {
        const { data, error } = await supabase.from('v_cuentas_pagar').select('saldo, fecha_vencimiento').gt('saldo', 0).limit(1000)
        if (error) throw new Error('No se pudo consultar el pendiente.')
        const vencidas = (data ?? []).filter((c) => c.fecha_vencimiento && c.fecha_vencimiento < hoy).length
        return { vencidas, resto: (data ?? []).length - vencidas }
      })())
    tareas.push({
      clave: 'facturas_vencidas', ruta: '/tesoreria/por-pagar', tono: 'peligro',
      texto: n => plural(n, 'factura de compra vencida por pagar', 'facturas de compra vencidas por pagar'),
      contar: async () => (await porPagar()).vencidas,
    })
    tareas.push({
      clave: 'facturas_por_pagar', ruta: '/tesoreria/por-pagar', tono: 'aviso',
      texto: n => plural(n, 'factura de compra por pagar', 'facturas de compra por pagar'),
      contar: async () => (await porPagar()).resto,
    })
    // Las OC con boleta, que Tesorería paga directo (migración 20261020210000);
    // la que tiene líneas sin precio espera a Logística, y la que trae su
    // comprobante o ya tiene su factura registrada se paga por ella, en las
    // facturas: ninguna se paga aquí. La que se pagó por su boleta y cuya
    // factura la dejó pagada de más (o va en otra moneda y no toma ese pago
    // sola) espera a Tesorería, que pide la devolución, la registra o la
    // descuenta de otra factura, o pasa la factura en otra moneda al cambio:
    // va aparte.
    let boletas: Promise<{ porPagar: number; deMas: number }> | null = null
    const conBoleta = () =>
      (boletas ??= (async () => {
        const { data, error } = await supabase.rpc('compras_con_boleta_por_pagar')
        if (error) throw new Error('No se pudo consultar el pendiente.')
        const filas = data ?? []
        return {
          // La que el proveedor devolvió entera no se debe hasta que la vuelva a cobrar.
          porPagar: filas.filter((c) => !c.cancelada && !c.sin_precio && !c.comprobante_en_camino && !c.factura && !devueltaEntera(c)).length,
          deMas: filas.filter((c) => Number(c.de_mas ?? 0) > 0 || c.otra_moneda).length,
        }
      })())
    tareas.push({
      clave: 'compras_con_boleta_pagadas_de_mas', ruta: '/tesoreria/por-pagar', tono: 'peligro',
      texto: n => plural(n, 'OC con boleta pagada de más o con factura en otra moneda', 'OC con boleta pagadas de más o con factura en otra moneda'),
      contar: async () => (await conBoleta()).deMas,
    })
    tareas.push({
      clave: 'compras_con_boleta_por_pagar', ruta: '/tesoreria/por-pagar', tono: 'aviso',
      texto: n => plural(n, 'OC con boleta por pagar', 'OC con boleta por pagar'),
      contar: async () => (await conBoleta()).porPagar,
    })
  }
  if (puede(perfil, 'subcontratos.pagar')) tareas.push({
    clave: 'recibos_por_pagar', ruta: '/tesoreria/recibos-por-honorarios', tono: 'aviso',
    texto: n => plural(n, 'recibo por honorarios por pagar', 'recibos por honorarios por pagar'),
    contar: async () => {
      const { data, error } = await supabase
        .from('recibos_honorarios')
        .select('id, pagos:pagos_recibo_honorarios!pagos_recibo_honorarios_recibo_id_fkey(anulado_en)')
        .is('anulado_en', null)
        .limit(1000)
      if (error) throw new Error('No se pudo consultar el pendiente.')
      // El tipo generado lo da por uno solo; la pantalla lo lee como lista.
      const pagosDe = (r: { pagos: unknown }) => ([] as { anulado_en: string | null }[]).concat((r.pagos ?? []) as never)
      return (data ?? []).filter((r) => !pagosDe(r).some((p) => !p.anulado_en)).length
    },
  })
  if (puede(perfil, 'planilla_diaria.pagar')) tareas.push({
    clave: 'planillas_por_pagar', ruta: '/planilla-diaria', tono: 'aviso',
    texto: n => plural(n, 'planilla diaria por pagar', 'planillas diarias por pagar'),
    contar: async () => {
      const { data, error } = await supabase
        .from('planillas_diarias')
        .select('anulado_en, gente:planilla_diaria_personas!planilla_diaria_personas_planilla_id_fkey(pago_id, boleta_entregada_en)')
        .is('anulado_en', null)
        .limit(200)
      if (error) throw new Error('No se pudo consultar el pendiente.')
      return (data ?? []).filter((p) => ['POR_PAGAR', 'PAGO_PARCIAL'].includes(estadoDePlanilla(p.anulado_en, p.gente ?? []))).length
    },
  })

  // RR. HH.: las horas extras por decidir y lo que ya puede ir a la planilla diaria.
  if (puede(perfil, 'planilla_diaria.preparar')) {
    tareas.push({
      clave: 'extras_por_decidir', ruta: '/rrhh/horas-extras', tono: 'aviso',
      texto: n => plural(n, 'día con horas extras por decidir', 'días con horas extras por decidir'),
      contar: async () => {
        const { data, error } = await supabase.rpc('horas_extras_por_decidir')
        if (error) throw new Error('No se pudo consultar el pendiente.')
        return (data ?? []).filter((f) => Number(f.por_decidir ?? 0) > 0).length
      },
    })
    tareas.push({
      clave: 'planilla_por_enviar', ruta: '/planilla-diaria', tono: 'acento',
      texto: n => plural(n, 'persona con horas por enviar a la planilla diaria', 'personas con horas por enviar a la planilla diaria'),
      contar: async () => {
        const { data, error } = await supabase.rpc('planilla_diaria_por_enviar')
        if (error) throw new Error('No se pudo consultar el pendiente.')
        return new Set((data ?? []).map((f) => f.trabajador_id)).size
      },
    })
  }

  // Contabilidad: las compras que todavía no tienen su factura registrada.
  if (puede(perfil, 'adquisiciones.registrar')) tareas.push({
    clave: 'compras_sin_factura', ruta: '/adquisiciones?situacion=por-facturar', tono: 'aviso',
    texto: n => plural(n, 'compra sin factura registrada', 'compras sin factura registrada'),
    contar: async () => {
      const { data, error } = await supabase.rpc('compras_sin_factura')
      if (error) throw new Error('No se pudo consultar el pendiente.')
      return (data ?? []).length
    },
  })

  // Diseño y Supervisión general: los códigos con una etapa que pasó su fecha.
  for (const de of [
    { permiso: 'diseno.codigos', ruta: '/diseno/etapas?ver=vencidas' },
    { permiso: 'supervision.general', ruta: '/seguimiento?ver=vencidas' },
  ]) {
    if (!puede(perfil, de.permiso)) continue
    tareas.push({
      clave: `etapas_vencidas_${de.permiso}`, ruta: de.ruta, tono: 'peligro',
      texto: n => plural(n, 'código con etapas vencidas', 'códigos con etapas vencidas'),
      contar: async () => {
        return (await codigosDeDiseno()).filter((c) => c.etapas_vencidas > 0).length
      },
    })
    break
  }

  // Un pendiente se cuenta solo si su pantalla está en el menú del puesto: lo
  // que se resuelve donde el puesto ya no entra no es suyo. Así Supervisión,
  // Almacén y Requerimientos dejaron de ver lo que se resolvía en la OT (desde
  // el 2026-10-15), y Tesorería, Gerencia y Contabilidad tampoco lo ven.
  const enMenu = new Set(
    menuDe(perfil.permisos, perfil.rol.codigo === 'ADMIN', perfil.rol.codigo).flatMap((g) => g.items.map((i) => i.ruta.split('?')[0])),
  )
  const suyas = tareas.filter((t) => enMenu.has(t.ruta.split('?')[0]))

  const cuentas = await Promise.all(suyas.map((t) => t.contar().catch(() => null)))

  const porRuta: Record<string, number> = {}
  const sinComprobar = new Set<string>()
  suyas.forEach((t, i) => {
    const cuenta = cuentas[i]
    if (cuenta === null) {
      sinComprobar.add(t.ruta.split('?')[0])
      return
    }
    const n = typeof cuenta === 'number' ? cuenta : cuenta.cantidad
    if (n <= 0) return
    const base = t.ruta.split('?')[0]
    porRuta[base] = (porRuta[base] ?? 0) + n
  })

  return { porRuta, sinComprobar: [...sinComprobar] }
}

/** El día 1 del mes anterior a `dia` (YYYY-MM-DD), que es como la base guarda el periodo de una planilla. */
function primerDiaDelMesAnterior(dia: string) {
  const [anio, mes] = dia.split('-').map(Number)
  const previo = mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 }
  return `${previo.anio}-${String(previo.mes).padStart(2, '0')}-01`
}
