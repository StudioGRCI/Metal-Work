import 'server-only'

import type { Tono } from '@/components/ui/etiqueta-estado'
import { ESTADOS_ACTIVOS_OT } from '@/lib/dominio/estados'
import { hoyLima } from '@/lib/format'
import { puede, type PerfilSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Lo que le toca mover a quien mira, en todo el sistema: es la franja de arriba
 * del Tablero y los globos de la barra del teléfono. Cada cuenta se pide solo si
 * el puesto tiene el permiso que la resuelve —a quien no puede aprobar no se le
 * cuentan reportes por aprobar— y cada una es un `count` de cabecera sobre las
 * vistas que ya existen, que el RLS filtra solo. Una lectura que falle deja su
 * número en cero: son avisos, no datos de la orden.
 */
export type PendienteGlobal = {
  clave: string
  texto: string
  ruta: string
  cantidad: number
  tono: Tono
}

export type PendientesGlobales = {
  items: PendienteGlobal[]
  /** Cuántos pendientes cuelgan de cada módulo del menú, por su ruta base. */
  porRuta: Record<string, number>
}

type Cuenta = () => Promise<number>

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`

export async function pendientesGlobales(perfil: PerfilSesion): Promise<PendientesGlobales> {
  const supabase = await createClient()
  const hoy = hoyLima()

  const cabeza = async (consulta: PromiseLike<{ count: number | null; error: unknown }>) => {
    const { count, error } = await consulta
    return error ? 0 : (count ?? 0)
  }

  // Las terminadas que esperan a tesorería o el acta se cruzan en memoria: son
  // pocas y no hay vista que las junte.
  const terminadas = async () => {
    const { data } = await supabase.from('ordenes_trabajo').select('id').eq('estado', 'TERMINADA').limit(500)
    const ids = (data ?? []).map((o) => o.id)
    if (ids.length === 0) return { ids, liberadas: new Set<string>(), entregadas: new Set<string>() }
    const [lib, ent] = await Promise.all([
      supabase.from('liberaciones_tesoreria').select('orden_id').in('orden_id', ids),
      supabase.from('ot_entregas').select('orden_id').in('orden_id', ids),
    ])
    return {
      ids,
      liberadas: new Set((lib.data ?? []).map((l) => l.orden_id)),
      entregadas: new Set((ent.data ?? []).map((e) => e.orden_id)),
    }
  }

  const aprueba = puede(perfil, 'produccion.aprobar_reportes')
  const todoElTaller = aprueba || puede(perfil, 'produccion.cualquier_area')

  const tareas: { clave: string; ruta: string; tono: Tono; texto: (n: number) => string; contar: Cuenta }[] = []

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

  if (puede(perfil, 'ordenes.crear')) {
    tareas.push({
      clave: 'pdf_sin_ot',
      ruta: '/cotizaciones/pdf?estado=APROBADA_SIN_OT',
      tono: 'acento',
      texto: (n) => plural(n, 'cotización aprobada sin OT', 'cotizaciones aprobadas sin OT'),
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
      ruta: '/avance',
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
      ruta: '/avance/diario?ver=por-aprobar',
      tono: 'aviso',
      texto: (n) => plural(n, 'reporte por aprobar', 'reportes por aprobar'),
      contar: async () => {
        const [hoja, foto, flota] = await Promise.all([
          cabeza(supabase.from('v_ot_avance_diario').select('id', { count: 'exact', head: true }).eq('revision', 'PENDIENTE')),
          cabeza(supabase.from('ot_avance_resumen').select('id', { count: 'exact', head: true }).eq('revision', 'PENDIENTE')),
          cabeza(supabase.from('v_flota_avance_diario').select('id', { count: 'exact', head: true }).eq('revision', 'PENDIENTE')),
        ])
        return hoja + foto + flota
      },
    })
  } else if (puede(perfil, 'produccion.registrar')) {
    tareas.push({
      clave: 'mios_observados',
      ruta: '/avance/diario?ver=observados',
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

  if (puede(perfil, 'produccion.registrar') && perfil.area_id && !todoElTaller) {
    const area = perfil.area_id
    tareas.push({
      clave: 'hojas_sin_reporte',
      ruta: '/avance',
      tono: 'aviso',
      texto: (n) => plural(n, 'hoja de tu área sin reporte de hoy', 'hojas de tu área sin reporte de hoy'),
      contar: async () => {
        const { data } = await supabase
          .from('v_ot_avance_areas')
          .select('ultimo_reporte, orden_estado')
          .eq('area_id', area)
          .in('orden_estado', [...ESTADOS_ACTIVOS_OT])
          .limit(200)
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
        const { data } = await supabase
          .from('ordenes_trabajo')
          .select('id')
          .in('estado', [...ESTADOS_ACTIVOS_OT])
          .limit(500)
        const ids = (data ?? []).map((o) => o.id)
        if (ids.length === 0) return 0
        const { data: con } = await supabase.from('v_cumplimiento_ot').select('orden_id').in('orden_id', ids).gt('planos', 0)
        const conPlanos = new Set((con ?? []).map((c) => c.orden_id))
        return ids.filter((id) => !conPlanos.has(id)).length
      },
    })
  }

  if (puede(perfil, 'tesoreria.liberar') || puede(perfil, 'ordenes.entregar')) {
    const cierre = terminadas()
    if (puede(perfil, 'tesoreria.liberar')) {
      tareas.push({
        clave: 'liberar',
        ruta: '/ordenes?estado=TERMINADA',
        tono: 'aviso',
        texto: (n) => plural(n, 'orden terminada espera la liberación de tesorería', 'órdenes terminadas esperan la liberación de tesorería'),
        contar: async () => {
          const c = await cierre
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
          const c = await cierre
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

  const cantidades = await Promise.all(tareas.map((t) => t.contar().catch(() => 0)))

  const items: PendienteGlobal[] = []
  const porRuta: Record<string, number> = {}
  tareas.forEach((t, i) => {
    const n = cantidades[i]
    if (n <= 0) return
    items.push({ clave: t.clave, texto: t.texto(n), ruta: t.ruta, cantidad: n, tono: t.tono })
    const base = t.ruta.split('?')[0]
    porRuta[base] = (porRuta[base] ?? 0) + n
  })

  return { items, porRuta }
}
