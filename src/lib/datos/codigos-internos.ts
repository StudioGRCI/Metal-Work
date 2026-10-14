import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Los códigos internos para Gerencia: todo sale de las funciones de la migración
 * 20261014220000, que exigen `codigos_internos.ver` y no devuelven el costo de
 * cada persona. Nada se lee de las tablas: el tareo es solo de RR. HH.
 */

/** Un código en la lista: dónde aparece, su avance y su costeo. */
export type ResumenCodigo = {
  codigo: string
  requerimientos: number
  compras: number
  salidas: number
  reportes: number
  vehiculos: number
  unidades: number
  ordenes: number
  ultima_actividad: string | null
  ultimo_reporte: string | null
  trabajos: number
  trabajos_terminados: number
  avance_medio: number | null
  horas: number
  horas_sin_costo: number
  mano_obra: number
  materiales_pen: number
  materiales_usd: number
  materiales_sin_precio: number
  compras_pen: number
  compras_usd: number
  compras_sin_precio: number
}

const n = (v: number | null | undefined) => Number(v ?? 0)

/** Todos los códigos del sistema, del que tuvo movimiento más reciente al más viejo. */
export async function listarCodigosInternos(): Promise<ResumenCodigo[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('codigos_internos_resumen')
  if (error) throw new Error(`No se pudieron leer los códigos internos: ${error.message}`)
  return (data ?? []).flatMap((f) =>
    f.codigo
      ? [
          {
            codigo: f.codigo,
            requerimientos: n(f.requerimientos),
            compras: n(f.compras),
            salidas: n(f.salidas),
            reportes: n(f.reportes),
            vehiculos: n(f.vehiculos),
            unidades: n(f.unidades),
            ordenes: n(f.ordenes),
            ultima_actividad: f.ultima_actividad,
            ultimo_reporte: f.ultimo_reporte,
            trabajos: n(f.trabajos),
            trabajos_terminados: n(f.trabajos_terminados),
            avance_medio: f.avance_medio === null ? null : Number(f.avance_medio),
            horas: n(f.horas),
            horas_sin_costo: n(f.horas_sin_costo),
            mano_obra: n(f.mano_obra),
            materiales_pen: n(f.materiales_pen),
            materiales_usd: n(f.materiales_usd),
            materiales_sin_precio: n(f.materiales_sin_precio),
            compras_pen: n(f.compras_pen),
            compras_usd: n(f.compras_usd),
            compras_sin_precio: n(f.compras_sin_precio),
          },
        ]
      : [],
  )
}

/** Un trabajo de un reporte diario vigente del código. */
export type AvanceReportado = {
  reporte_id: string
  fecha: string
  asunto: string
  area: string | null
  estado: string
  creado_en: string
  personal_general: boolean
  horas_reporte: number
  trabajo_orden: number
  trabajo: string
  avance: number
  /** Con personal general, las horas son del reporte entero: aquí llega `null`. */
  horas: number | null
  personas: number
}

export async function avanceDelCodigo(codigo: string): Promise<AvanceReportado[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('codigo_interno_avance', { p_codigo: codigo })
  if (error) throw new Error(`No se pudo leer el avance del código: ${error.message}`)
  return (data ?? []).map((f) => ({
    reporte_id: f.reporte_id ?? '',
    fecha: f.fecha ?? '',
    asunto: f.asunto ?? '',
    area: f.area,
    estado: f.estado ?? 'POR_VALIDAR',
    creado_en: f.creado_en ?? '',
    personal_general: Boolean(f.personal_general),
    horas_reporte: n(f.horas_reporte),
    trabajo_orden: n(f.trabajo_orden),
    trabajo: f.trabajo ?? '',
    avance: n(f.avance),
    horas: f.horas === null ? null : Number(f.horas),
    personas: n(f.personas),
  }))
}

/**
 * Una línea del costeo. MANO_OBRA lleva horas y costo (cantidad = personas);
 * MANO_OBRA_SIN_COSTO, horas sin costo; MATERIALES y MATERIALES_SIN_PRECIO, cada
 * salida; COMPRAS, cada OC sin IGV, que no va al total.
 */
export type LineaCosteo = {
  fuente: 'MANO_OBRA' | 'MANO_OBRA_SIN_COSTO' | 'MATERIALES' | 'MATERIALES_SIN_PRECIO' | 'COMPRAS'
  fecha: string
  concepto: string
  detalle: string | null
  cantidad: number
  unidad: string | null
  horas: number | null
  precio_unitario: number | null
  moneda: 'PEN' | 'USD' | null
  monto: number | null
  sin_precio: number
  documento: string | null
  referencia_id: string | null
}

export async function costeoDelCodigo(codigo: string): Promise<LineaCosteo[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('codigo_interno_costeo', { p_codigo: codigo })
  if (error) throw new Error(`No se pudo leer el costeo del código: ${error.message}`)
  return (data ?? []).map((f) => ({
    fuente: (f.fuente ?? 'MATERIALES') as LineaCosteo['fuente'],
    fecha: f.fecha ?? '',
    concepto: f.concepto ?? '',
    detalle: f.detalle,
    cantidad: n(f.cantidad),
    unidad: f.unidad,
    horas: f.horas === null ? null : Number(f.horas),
    precio_unitario: f.precio_unitario === null ? null : Number(f.precio_unitario),
    moneda: f.moneda === 'USD' ? 'USD' : f.moneda === 'PEN' ? 'PEN' : null,
    monto: f.monto === null ? null : Number(f.monto),
    sin_precio: n(f.sin_precio),
    documento: f.documento,
    referencia_id: f.referencia_id,
  }))
}

/** Una orden de compra del código, con lo que hace falta para decir en qué va. */
export type CompraDelCodigo = {
  id: string
  numero: string | null
  fecha: string
  proveedor: string
  aprobacion: string
  recojo: string | null
  entregado_almacen_en: string | null
  validaciones: string[]
  moneda: 'PEN' | 'USD'
  monto: number
  lineas: number
  sin_precio: number
  requerimientos: string | null
}

export async function comprasDelCodigo(codigo: string): Promise<CompraDelCodigo[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('codigo_interno_compras', { p_codigo: codigo })
  if (error) throw new Error(`No se pudieron leer las compras del código: ${error.message}`)
  return (data ?? []).map((f) => ({
    id: f.id ?? '',
    numero: f.numero,
    fecha: f.fecha ?? '',
    proveedor: f.proveedor ?? '',
    aprobacion: f.aprobacion ?? 'NO_REQUERIDA',
    recojo: f.recojo,
    entregado_almacen_en: f.entregado_almacen_en,
    validaciones: f.validaciones ?? [],
    moneda: f.moneda === 'USD' ? 'USD' : 'PEN',
    monto: n(f.monto),
    lineas: n(f.lineas),
    sin_precio: n(f.sin_precio),
    requerimientos: f.requerimientos,
  }))
}

/** Las horas de una persona en el código. Sin su costo: ese es solo de RR. HH. */
export type HorasDePersona = {
  trabajador_id: string
  nombre: string
  cargo: string | null
  horas: number
  horas_sin_costo: number
  dias: number
  primer_dia: string | null
  ultimo_dia: string | null
}

export async function personalDelCodigo(codigo: string): Promise<HorasDePersona[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('codigo_interno_personal', { p_codigo: codigo })
  if (error) throw new Error(`No se pudieron leer las horas del personal: ${error.message}`)
  return (data ?? []).map((f) => ({
    trabajador_id: f.trabajador_id ?? '',
    nombre: f.nombre ?? '',
    cargo: f.cargo,
    horas: n(f.horas),
    horas_sin_costo: n(f.horas_sin_costo),
    dias: n(f.dias),
    primer_dia: f.primer_dia,
    ultimo_dia: f.ultimo_dia,
  }))
}

/** Dónde más aparece el código: RQ, ingresos a la planta, unidades, y su OT y su cotización. */
export type DocumentoDelCodigo = {
  tipo: string
  id: string
  numero: string
  fecha: string | null
  estado: string
  detalle: string | null
}

export async function documentosDelCodigo(codigo: string): Promise<DocumentoDelCodigo[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('codigo_interno_documentos', { p_codigo: codigo })
  if (error) throw new Error(`No se pudieron leer los documentos del código: ${error.message}`)
  return (data ?? []).map((f) => ({
    tipo: f.tipo ?? '',
    id: f.id ?? '',
    numero: f.numero ?? '',
    fecha: f.fecha,
    estado: f.estado ?? '',
    detalle: f.detalle,
  }))
}
