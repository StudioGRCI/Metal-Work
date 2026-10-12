import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type LineaParaAprobar = {
  /** Null en una compra para almacén, que no viene de ninguna OT. */
  orden: string | null
  area: string | null
  material_codigo: string
  material: string
  unidad: string | null
  cantidad: number
  precio_unitario: number | null
}

export type CompraParaAprobar = {
  id: string
  referencia: string
  proveedor: string
  proveedor_documento: string | null
  moneda: string
  monto: number
  monto_pen: number | null
  condicion_pago: string
  dias_credito: number
  fecha_estimada: string | null
  aprobacion: string
  pedida_en: string | null
  emitida_por: string | null
  decidida_por: string | null
  decidida_en: string | null
  motivo_rechazo: string | null
  ordenes: string[]
  lineas: LineaParaAprobar[]
}

export type ReglaAprobacion = {
  activa: boolean
  monto_desde: number
  rol_aprobador_id: string
  rol_aprobador: string | null
  actualizado_en: string
}

export type PuestoAprobador = { id: string; nombre: string }

/** ¿La persona en sesión es quien aprueba las compras? Lo decide la base. */
export async function esAprobadorDeCompras(): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('es_aprobador_compras')
  if (error) throw new Error(`No se pudo saber quién aprueba las compras: ${error.message}`)
  return data === true
}

export async function cargarAprobacionCompras(opciones: { puestos: boolean }) {
  const supabase = await createClient()
  const [regla, compras, roles] = await Promise.all([
    supabase
      .from('regla_aprobacion_compras')
      .select('activa, monto_desde, rol_aprobador_id, actualizado_en, rol:roles(nombre)')
      .maybeSingle(),
    supabase.rpc('compras_para_aprobar'),
    opciones.puestos
      ? supabase.from('roles').select('id, codigo, nombre, nivel').order('nivel', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ])
  if (regla.error) throw new Error(`No se pudo leer la regla de aprobación: ${regla.error.message}`)
  if (compras.error) throw new Error(`No se pudieron leer las compras por aprobar: ${compras.error.message}`)
  if (roles.error) throw new Error(`No se pudieron leer los puestos: ${roles.error.message}`)

  return {
    regla: regla.data
      ? ({
          activa: regla.data.activa,
          monto_desde: Number(regla.data.monto_desde),
          rol_aprobador_id: regla.data.rol_aprobador_id,
          rol_aprobador: (regla.data.rol as { nombre: string } | null)?.nombre ?? null,
          actualizado_en: regla.data.actualizado_en,
        } satisfies ReglaAprobacion)
      : null,
    compras: (compras.data ?? []).map(
      (c): CompraParaAprobar => ({
        id: c.id ?? '',
        referencia: c.referencia ?? '',
        proveedor: c.proveedor ?? '',
        proveedor_documento: c.proveedor_documento,
        moneda: c.moneda ?? 'PEN',
        monto: Number(c.monto ?? 0),
        monto_pen: c.monto_pen === null ? null : Number(c.monto_pen),
        condicion_pago: c.condicion_pago ?? 'CONTADO',
        dias_credito: c.dias_credito ?? 0,
        fecha_estimada: c.fecha_estimada,
        aprobacion: c.aprobacion ?? 'POR_APROBAR',
        pedida_en: c.pedida_en ?? c.creado_en,
        emitida_por: c.emitida_por,
        decidida_por: c.decidida_por,
        decidida_en: c.decidida_en,
        motivo_rechazo: c.motivo_rechazo,
        ordenes: c.ordenes ?? [],
        lineas: (c.lineas as LineaParaAprobar[] | null) ?? [],
      }),
    ),
    // Operario y Solo consulta quedan fuera: la base tampoco los acepta. ADMIN
    // aprueba siempre, así que no se ofrece como puesto.
    puestos: (roles.data ?? [])
      .filter((r) => !['ADMIN', 'CONSULTA', 'OPERARIO'].includes(r.codigo))
      .map((r): PuestoAprobador => ({ id: r.id, nombre: r.nombre })),
  }
}
