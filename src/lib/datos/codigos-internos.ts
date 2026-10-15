import 'server-only'

import { createClient } from '@/lib/supabase/server'

/**
 * Los códigos internos para Gerencia: todo sale de las funciones de la migración
 * 20261014220000, que exigen `codigos_internos.ver` y no devuelven el costo de
 * cada persona. Nada se lee de las tablas: el tareo es solo de RR. HH.
 */

/** Un código en la lista: dónde aparece y su costeo. Su avance sale aparte, de `avanceDeLosCodigos`. */
export type ResumenCodigo = {
  codigo: string
  requerimientos: number
  compras: number
  salidas: number
  reportes: number
  vehiculos: number
  unidades: number
  ordenes: number
  /** Órdenes de servicio vigentes con el código: aprobadas y por aprobar. */
  servicios: number
  /** Las aprobadas, sin IGV: suman al costo. */
  servicios_pen: number
  servicios_usd: number
  /** Las que esperan a Gerencia: se muestran aparte y no suman. */
  servicios_por_aprobar: number
  servicios_por_aprobar_pen: number
  servicios_por_aprobar_usd: number
  /** Recibos por honorarios vigentes de sus subcontratos, por su bruto: todos suman al costo. */
  subcontratos: number
  subcontratos_pen: number
  subcontratos_usd: number
  /** Los que esperan el pago de Tesorería: suman igual, y se muestran para saber cuánto falta pagar. */
  subcontratos_por_pagar: number
  subcontratos_por_pagar_pen: number
  subcontratos_por_pagar_usd: number
  ultima_actividad: string | null
  ultimo_reporte: string | null
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
  // El resumen de la base no trae las órdenes de servicio ni los subcontratos
  // (cambiarle las columnas exige borrarlo): salen de su propia función, con
  // las mismas líneas que el costeo de cada código.
  const [{ data, error }, porServicio, porSubcontrato] = await Promise.all([
    supabase.rpc('codigos_internos_resumen'),
    supabase.rpc('codigos_internos_servicios'),
    supabase.rpc('codigos_internos_subcontratos'),
  ])
  if (error) throw new Error(`No se pudieron leer los códigos internos: ${error.message}`)
  if (porServicio.error) throw new Error(`No se pudieron leer los servicios de los códigos: ${porServicio.error.message}`)
  if (porSubcontrato.error) throw new Error(`No se pudieron leer los subcontratos de los códigos: ${porSubcontrato.error.message}`)
  const servicios = new Map((porServicio.data ?? []).flatMap((s) => (s.codigo ? [[s.codigo, s] as const] : [])))
  const subcontratos = new Map((porSubcontrato.data ?? []).flatMap((s) => (s.codigo ? [[s.codigo, s] as const] : [])))
  return (data ?? []).flatMap((f) => {
    const s = f.codigo ? servicios.get(f.codigo) : undefined
    const sc = f.codigo ? subcontratos.get(f.codigo) : undefined
    return f.codigo
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
            servicios: n(s?.servicios) + n(s?.por_aprobar),
            servicios_pen: n(s?.servicios_pen),
            servicios_usd: n(s?.servicios_usd),
            servicios_por_aprobar: n(s?.por_aprobar),
            servicios_por_aprobar_pen: n(s?.por_aprobar_pen),
            servicios_por_aprobar_usd: n(s?.por_aprobar_usd),
            subcontratos: n(sc?.recibos),
            subcontratos_pen: n(sc?.subcontratos_pen),
            subcontratos_usd: n(sc?.subcontratos_usd),
            subcontratos_por_pagar: n(sc?.por_pagar),
            subcontratos_por_pagar_pen: n(sc?.por_pagar_pen),
            subcontratos_por_pagar_usd: n(sc?.por_pagar_usd),
            ultima_actividad: f.ultima_actividad,
            ultimo_reporte: f.ultimo_reporte,
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
      : []
  })
}

/**
 * El porcentaje de avance de un código (migración 20261016300000): el promedio
 * de sus etapas de Diseño, donde la terminada vale 100 y la que no, lo que su
 * área reporta en el reporte diario. Sin etapas, el promedio del último avance
 * de cada trabajo del reporte diario, área por área. El código que no tiene ni
 * lo uno ni lo otro no viene: va en 0 %. PLANTA no viene nunca.
 */
export type AvanceDeCodigo = {
  codigo: string
  avance: number
  fuente: 'ETAPAS' | 'REPORTES'
  etapas: number
  etapas_terminadas: number
  /** Los trabajos del reporte diario, cada uno con su área: «Soldadura» de dos áreas son dos. */
  trabajos: number
  trabajos_terminados: number
  ultimo_reporte: string | null
}

/** El avance de todos los códigos, o de uno, por código. */
export async function avanceDeLosCodigos(codigo?: string): Promise<Map<string, AvanceDeCodigo>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('codigos_internos_avance', codigo ? { p_codigo: codigo } : {})
  if (error) throw new Error(`No se pudo leer el avance de los códigos: ${error.message}`)
  return new Map(
    (data ?? []).flatMap((f) =>
      f.codigo
        ? [
            [
              f.codigo,
              {
                codigo: f.codigo,
                avance: n(f.avance),
                fuente: f.fuente === 'ETAPAS' ? 'ETAPAS' : 'REPORTES',
                etapas: n(f.etapas),
                etapas_terminadas: n(f.etapas_terminadas),
                trabajos: n(f.trabajos),
                trabajos_terminados: n(f.trabajos_terminados),
                ultimo_reporte: f.ultimo_reporte,
              },
            ] as const,
          ]
        : [],
    ),
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
 * salida; COMPRAS, cada OC sin IGV, que no va al total; SERVICIOS, cada OS
 * aprobada sin IGV, que sí va; SERVICIOS_POR_APROBAR, la que espera a Gerencia;
 * SUBCONTRATOS, cada recibo por honorarios pagado, por su bruto, y
 * SUBCONTRATOS_POR_PAGAR, el que espera a Tesorería: los dos van.
 */
export type LineaCosteo = {
  fuente:
    | 'MANO_OBRA'
    | 'MANO_OBRA_SIN_COSTO'
    | 'MATERIALES'
    | 'MATERIALES_SIN_PRECIO'
    | 'COMPRAS'
    | 'SERVICIOS'
    | 'SERVICIOS_POR_APROBAR'
    | 'SUBCONTRATOS'
    | 'SUBCONTRATOS_POR_PAGAR'
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

/**
 * Suma a la lista los códigos que solo tiene Diseño: los planos, la lista de
 * materiales o las etapas se pueden cargar antes del primer requerimiento de
 * la unidad, y Gerencia tiene que verlos igual. Entran en cero, con la fecha
 * del último cambio de Diseño como su última actividad.
 */
export function sumarCodigosDeDiseno(
  todos: ResumenCodigo[],
  deDiseno: { codigo: string; planos: number; materiales: number; etapas: number; ultimo_cambio: string | null }[],
): ResumenCodigo[] {
  const conocidos = new Set(todos.map((c) => c.codigo))
  const nuevos = deDiseno
    .filter((d) => !conocidos.has(d.codigo) && d.planos + d.materiales + d.etapas > 0)
    .map(
      (d): ResumenCodigo => ({
        codigo: d.codigo,
        requerimientos: 0,
        compras: 0,
        salidas: 0,
        reportes: 0,
        vehiculos: 0,
        unidades: 0,
        ordenes: 0,
        servicios: 0,
        servicios_pen: 0,
        servicios_usd: 0,
        servicios_por_aprobar: 0,
        servicios_por_aprobar_pen: 0,
        servicios_por_aprobar_usd: 0,
        subcontratos: 0,
        subcontratos_pen: 0,
        subcontratos_usd: 0,
        subcontratos_por_pagar: 0,
        subcontratos_por_pagar_pen: 0,
        subcontratos_por_pagar_usd: 0,
        ultima_actividad: d.ultimo_cambio ? diaDeLima(d.ultimo_cambio) : null,
        ultimo_reporte: null,
        horas: 0,
        horas_sin_costo: 0,
        mano_obra: 0,
        materiales_pen: 0,
        materiales_usd: 0,
        materiales_sin_precio: 0,
        compras_pen: 0,
        compras_usd: 0,
        compras_sin_precio: 0,
      }),
    )
  if (nuevos.length === 0) return todos
  // El mismo orden que `codigos_internos_resumen`: la actividad más reciente primero, sin fecha al final.
  return [...todos, ...nuevos].sort(
    (a, b) =>
      (a.ultima_actividad === null ? 1 : 0) - (b.ultima_actividad === null ? 1 : 0) ||
      (b.ultima_actividad ?? '').localeCompare(a.ultima_actividad ?? '') ||
      a.codigo.localeCompare(b.codigo),
  )
}

/** El día de Lima de un instante: la última actividad de la lista es una fecha, no una hora. */
function diaDeLima(instante: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instante))
}
