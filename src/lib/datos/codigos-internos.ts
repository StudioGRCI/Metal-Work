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
} & CostoCompleto

/**
 * Lo que el resumen no trae y sale de `codigos_internos_costo` (migración
 * 20261017300000): el recargo de las horas extras, los gastos del mes, los
 * egresos de caja, los gastos aprobados en la OT y su merma, el costo total en
 * soles, lo vendido y el cierre.
 */
export type CostoCompleto = {
  /** Lo que la planilla diaria pagó de más por las horas extras: es mano de obra. */
  recargo_extras: number
  /** Luz, agua, celulares… de «Gastos del mes», con su tasa o en partes iguales. */
  gastos_mes_pen: number
  gastos_mes_usd: number
  /** Los egresos que Tesorería escribió a mano en la caja diaria con el código. */
  caja_pen: number
  caja_usd: number
  egresos_caja: number
  /** Los trámites, comisiones y viáticos que Administración aprobó en la OT del código. */
  gastos_ot_pen: number
  gastos_ot_usd: number
  /** La merma que Diseño evaluó en la OT, sobre los materiales del código. */
  merma_pen: number
  merma_usd: number
  /** Todo lo que suma, en soles: los dólares al cambio de venta del día de cada línea. */
  costo_pen: number
  /** Los dólares de las líneas sin tipo de cambio cargado: no suman hasta que Tesorería lo cargue. */
  usd_sin_cambio: number
  lineas_sin_cambio: number
  /** Los dólares de las partes que sí pasaron a soles, y en cuánto: con eso las partes cuadran con el total. */
  usd_al_cambio: number
  usd_en_soles: number
  /** La fecha del acta de entrega de su OT, si el taller la registró. */
  entregada_el: string | null
  /** Para quien ve el precio de venta y si el código tiene cotización aprobada; si no, `null`. */
  venta: VentaDelCodigo | null
  cierre: CierreDelCodigo | null
}

export type SemaforoCosto = 'EN_RANGO' | 'AJUSTADO' | 'EXCEDIDO'

/** La cotización aprobada del código y lo que queda entre ella y el costo. */
export type VentaDelCodigo = {
  cotizaciones: number
  /** «PEN», «USD» o «PEN+USD» si hay cotizaciones en las dos monedas. */
  moneda: string
  precio_pen: number
  precio_usd: number
  /** Cotizaciones a las que Ventas no les confirmó si el monto incluye IGV. */
  sin_igv: number
  /** Cotizaciones en dólares sin tipo de cambio del día en que se aprobaron. */
  sin_cambio: number
  /** El precio sin IGV en soles; `null` si falta el IGV o el cambio de alguna. */
  precio_neto_pen: number | null
  margen_pen: number | null
  margen_pct: number | null
  /** El que Gerencia fijó a mano en la OT o, si no, el precio sin IGV menos la utilidad estándar del 15 % de la hoja RESUMEN. */
  presupuesto_pen: number | null
  presupuesto_fijado: boolean
  consumido_pct: number | null
  semaforo: SemaforoCosto | null
}

/** El costeo cerrado: lo que valía al entregar la unidad. */
export type CierreDelCodigo = {
  cerrado_en: string
  cerrado_por: string | null
  costo_pen: number
  margen_pen: number | null
  margen_pct: number | null
}

const n = (v: number | null | undefined) => Number(v ?? 0)
const nulo = (v: number | null | undefined) => (v === null || v === undefined ? null : Number(v))

/** Sin costo de la base: un código que solo tiene Diseño, o que la base todavía no costeó. */
export const SIN_COSTO_COMPLETO: CostoCompleto = {
  recargo_extras: 0,
  gastos_mes_pen: 0,
  gastos_mes_usd: 0,
  caja_pen: 0,
  caja_usd: 0,
  egresos_caja: 0,
  gastos_ot_pen: 0,
  gastos_ot_usd: 0,
  merma_pen: 0,
  merma_usd: 0,
  costo_pen: 0,
  usd_sin_cambio: 0,
  lineas_sin_cambio: 0,
  usd_al_cambio: 0,
  usd_en_soles: 0,
  entregada_el: null,
  venta: null,
  cierre: null,
}

/**
 * El costo completo de cada código (o de uno), por código. Lo llaman Gerencia
 * (`codigos_internos.ver`) y quien ve el costo de las OT (`costos.ver`, el
 * Dashboard de Administración); el precio y el margen llegan solo a quien ve
 * el precio de venta.
 */
export async function costoCompletoDeLosCodigos(codigo?: string): Promise<Map<string, CostoCompleto>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('codigos_internos_costo', codigo ? { p_codigo: codigo } : {})
  if (error) throw new Error(`No se pudo leer el costo de los códigos: ${error.message}`)
  return new Map(
    (data ?? []).flatMap((f) => {
      if (!f.codigo) return []
      const semaforo = f.semaforo === 'EN_RANGO' || f.semaforo === 'AJUSTADO' || f.semaforo === 'EXCEDIDO' ? f.semaforo : null
      const costo: CostoCompleto = {
        recargo_extras: n(f.recargo_extras),
        gastos_mes_pen: n(f.gastos_mes_pen),
        gastos_mes_usd: n(f.gastos_mes_usd),
        caja_pen: n(f.caja_pen),
        caja_usd: n(f.caja_usd),
        egresos_caja: n(f.egresos_caja),
        gastos_ot_pen: n(f.gastos_ot_pen),
        gastos_ot_usd: n(f.gastos_ot_usd),
        merma_pen: n(f.merma_pen),
        merma_usd: n(f.merma_usd),
        costo_pen: n(f.costo_pen),
        usd_sin_cambio: n(f.usd_sin_cambio),
        lineas_sin_cambio: n(f.lineas_sin_cambio),
        usd_al_cambio: n(f.usd_al_cambio),
        usd_en_soles: n(f.usd_en_soles),
        entregada_el: f.entregada_el,
        venta:
          f.cotizaciones && f.cotizaciones > 0
            ? {
                cotizaciones: n(f.cotizaciones),
                moneda: f.moneda_venta ?? 'PEN',
                precio_pen: n(f.precio_venta_pen),
                precio_usd: n(f.precio_venta_usd),
                sin_igv: n(f.venta_sin_igv_confirmado),
                sin_cambio: n(f.venta_sin_cambio),
                precio_neto_pen: nulo(f.precio_neto_pen),
                margen_pen: nulo(f.margen_pen),
                margen_pct: nulo(f.margen_pct),
                presupuesto_pen: nulo(f.presupuesto_pen),
                presupuesto_fijado: f.presupuesto_fijado === true,
                consumido_pct: nulo(f.consumido_pct),
                semaforo,
              }
            : null,
        cierre:
          f.cierre_id && f.cerrado_en
            ? {
                cerrado_en: f.cerrado_en,
                cerrado_por: f.cerrado_por,
                costo_pen: n(f.costo_cerrado_pen),
                margen_pen: nulo(f.margen_cerrado_pen),
                margen_pct: nulo(f.margen_cerrado_pct),
              }
            : null,
      }
      return [[f.codigo, costo] as const]
    }),
  )
}

/** Todos los códigos del sistema, del que tuvo movimiento más reciente al más viejo. */
export async function listarCodigosInternos(): Promise<ResumenCodigo[]> {
  const supabase = await createClient()
  // El resumen de la base no trae las órdenes de servicio, los subcontratos ni
  // el costo completo (cambiarle las columnas exige borrarlo): salen de su
  // propia función, con las mismas líneas que el costeo de cada código.
  const [{ data, error }, porServicio, porSubcontrato, completo] = await Promise.all([
    supabase.rpc('codigos_internos_resumen'),
    supabase.rpc('codigos_internos_servicios'),
    supabase.rpc('codigos_internos_subcontratos'),
    costoCompletoDeLosCodigos(),
  ])
  if (error) throw new Error(`No se pudieron leer los códigos internos: ${error.message}`)
  if (porServicio.error) throw new Error(`No se pudieron leer los servicios de los códigos: ${porServicio.error.message}`)
  if (porSubcontrato.error) throw new Error(`No se pudieron leer los subcontratos de los códigos: ${porSubcontrato.error.message}`)
  const servicios = new Map((porServicio.data ?? []).flatMap((s) => (s.codigo ? [[s.codigo, s] as const] : [])))
  const subcontratos = new Map((porSubcontrato.data ?? []).flatMap((s) => (s.codigo ? [[s.codigo, s] as const] : [])))
  const filas = (data ?? []).flatMap((f): ResumenCodigo[] => {
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
            ...(completo.get(f.codigo) ?? SIN_COSTO_COMPLETO),
          },
        ]
      : []
  })
  // Un código que solo está en la caja o en un gasto de la OT también cuesta, y
  // casi siempre es uno mal escrito: tiene que verse para que salte su parecido.
  const conocidos = new Set(filas.map((c) => c.codigo))
  const sueltos = [...completo.entries()]
    .filter(([codigo, k]) => !conocidos.has(codigo) && (k.costo_pen > 0 || k.usd_sin_cambio > 0))
    .map(([codigo, k]) => resumenVacio(codigo, null, k))
  return [...filas, ...sueltos]
}

/**
 * El porcentaje de avance de un código (migraciones 20261016300000 y
 * 20261020100000). Lo que Diseño repartió en planos cuenta plano por plano (su
 * porcentaje por su avance) y la fuente es PLANOS; el resto, el promedio de sus
 * etapas de Diseño, donde la terminada vale 100 y la que no, el promedio de las
 * actividades que su área reporta. Sin etapas, el promedio del último avance
 * de cada actividad del reporte diario. El código que no tiene nada de eso no
 * viene: va en 0 %. PLANTA no viene nunca.
 */
export type AvanceDeCodigo = {
  codigo: string
  avance: number
  fuente: 'PLANOS' | 'ETAPAS' | 'REPORTES'
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
                fuente: f.fuente === 'PLANOS' ? 'PLANOS' : f.fuente === 'ETAPAS' ? 'ETAPAS' : 'REPORTES',
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

/** Un plano con su porcentaje de la unidad, cuánto avanzó y cuánto aporta al avance del código. */
export type AporteDePlano = {
  plano_id: string
  numero: string
  nombre: string
  area: string
  peso: number
  avance: number
  aporte: number
  /** Vale 100 % porque la etapa de su área ya terminó, aunque el reporte dijera menos. */
  por_etapa: boolean
  ultima_fecha: string | null
  reportes: number
}

/** Lo que aporta cada plano con porcentaje al avance de un código. */
export async function aporteDeLosPlanos(codigo: string): Promise<AporteDePlano[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('codigo_interno_avance_planos', { p_codigo: codigo })
  if (error) throw new Error(`No se pudo leer lo que aporta cada plano: ${error.message}`)
  return (data ?? []).flatMap((p) =>
    p.plano_id
      ? [
          {
            plano_id: p.plano_id,
            numero: p.numero ?? '',
            nombre: p.nombre ?? '',
            area: p.area ?? '',
            peso: n(p.peso),
            avance: n(p.avance),
            aporte: n(p.aporte),
            por_etapa: p.por_etapa === true,
            ultima_fecha: p.ultima_fecha,
            reportes: n(p.reportes),
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
 * salida; COMPRAS, cada OC sin IGV, que no va al total; SERVICIOS, cada OS
 * aprobada sin IGV, que sí va; SERVICIOS_POR_APROBAR, la que espera a Gerencia;
 * SUBCONTRATOS, cada recibo por honorarios pagado, por su bruto, y
 * SUBCONTRATOS_POR_PAGAR, el que espera a Tesorería: los dos van.
 * RECARGO_EXTRAS, lo que la planilla diaria pagó de más por las horas extras;
 * GASTOS_DEL_MES, la parte del código de cada gasto del mes; CAJA, cada egreso
 * de la caja diaria con el código; GASTOS_OT, cada trámite, comisión o viático
 * aprobado en la OT del código; MERMA, la merma de la OT sobre los materiales
 * del código: los cinco van.
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
    | 'RECARGO_EXTRAS'
    | 'GASTOS_DEL_MES'
    | 'CAJA'
    | 'GASTOS_OT'
    | 'MERMA'
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

/** Lo que le tocó a cada código de lo cargado a TODOS LOS ACTIVOS, por mes. */
export type RepartoATodos = {
  periodo: string
  codigo: string
  salidas: number
  monto_pen: number
  monto_usd: number
  sin_precio: number
}

export async function repartoATodosLosActivos(): Promise<RepartoATodos[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('codigo_interno_reparto_a_todos')
  if (error) throw new Error(`No se pudo leer a dónde fue lo cargado a todos los activos: ${error.message}`)
  return (data ?? []).map((f) => ({
    periodo: f.periodo ?? '',
    codigo: f.codigo ?? '',
    salidas: n(f.salidas),
    monto_pen: n(f.monto_pen),
    monto_usd: n(f.monto_usd),
    sin_precio: n(f.sin_precio),
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

/** Un código que el resumen no trae: todo en cero, salvo el costo completo que tenga. */
function resumenVacio(codigo: string, ultima: string | null, completo: CostoCompleto = SIN_COSTO_COMPLETO): ResumenCodigo {
  return {
    codigo,
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
    ultima_actividad: ultima,
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
    ...completo,
  }
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
    .map((d) => resumenVacio(d.codigo, d.ultimo_cambio ? diaDeLima(d.ultimo_cambio) : null))
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
