import 'server-only'

import type { ContratoAdjunto } from '@/lib/dominio/contratos'
import { AREAS_SUBCONTRATO, BUCKET_SUBCONTRATOS } from '@/lib/dominio/subcontratos'
import { createClient } from '@/lib/supabase/server'

/*
 * Subcontratos y recibos por honorarios (migración 20261015221000). Los leen
 * Administración, Tesorería, Gerencia y Contabilidad; la base decide quién
 * (`puede_ver_subcontratos`). Las llaves se nombran siempre: `recibos_honorarios`
 * apunta a la vez a `subcontratos` y a `subcontratistas`, y sin nombre PostgREST
 * no sabe por cuál de los dos caminos embeber.
 */

type Uno<T> = T | T[] | null
/** Una relación 1 a 1 llega como objeto; si llegara como lista, se toma la primera. */
function unico<T>(valor: Uno<T>): T | null {
  return Array.isArray(valor) ? (valor[0] ?? null) : valor
}

type Num = number | string | null
const num = (v: Num) => Number(v ?? 0)

export type Subcontratista = {
  id: string
  ruc: string
  nombre: string
  telefono: string | null
  banco: string | null
  numero_cuenta: string | null
  cci: string | null
  activo: boolean
}

const COLUMNAS_SUBCONTRATISTA = 'id, ruc, nombre, telefono, banco, numero_cuenta, cci, activo'

/** El padrón, por nombre. */
export async function listarSubcontratistas(): Promise<Subcontratista[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('subcontratistas').select(COLUMNAS_SUBCONTRATISTA).order('nombre')
  if (error) throw new Error(`No se pudo leer el padrón de subcontratistas: ${error.message}`)
  return data ?? []
}

/** Lo que cuenta de un recibo para saber en qué va. */
export type ReciboResumen = {
  monto_bruto: number
  retencion_monto: number
  monto_neto: number
  anulado_en: string | null
  pagos: { anulado_en: string | null }[]
}

export type SubcontratoListado = {
  id: string
  numero: string
  codigo_interno: string
  /** PRD o ACB (migración 20261017100000); null en los de antes que todavía no la tienen. */
  area_codigo: string | null
  descripcion: string
  moneda: 'PEN' | 'USD'
  monto: number
  fecha_inicio: string | null
  fecha_fin: string | null
  /** Cuándo empezó y terminó de verdad, según el supervisor (referencial, migración 20261020201000). */
  inicio_real: string | null
  fin_real: string | null
  estado: string
  creado_en: string
  motivo_anulacion: string | null
  subcontratista: { nombre: string; ruc: string } | null
  recibos: ReciboResumen[]
}

type FilaResumen = Omit<ReciboResumen, 'monto_bruto' | 'retencion_monto' | 'monto_neto' | 'pagos'> & {
  monto_bruto: Num
  retencion_monto: Num
  monto_neto: Num
  pagos: { anulado_en: string | null }[] | null
}

function resumen(r: FilaResumen): ReciboResumen {
  return { ...r, monto_bruto: num(r.monto_bruto), retencion_monto: num(r.retencion_monto), monto_neto: num(r.monto_neto), pagos: r.pagos ?? [] }
}

/** Los subcontratos, del más reciente al más viejo, con lo justo de sus recibos para las cuentas. */
export async function listarSubcontratos(): Promise<SubcontratoListado[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('subcontratos')
    .select(
      'id, numero, codigo_interno, descripcion, moneda, monto, fecha_inicio, fecha_fin, inicio_real, fin_real, estado, creado_en, motivo_anulacion,' +
        ' subcontratista:subcontratistas!subcontratos_subcontratista_id_fkey(nombre, ruc),' +
        ' area:areas!subcontratos_area_id_fkey(codigo),' +
        ' recibos:recibos_honorarios!recibos_honorarios_subcontrato_id_fkey(monto_bruto, retencion_monto, monto_neto, anulado_en,' +
        ' pagos:pagos_recibo_honorarios!pagos_recibo_honorarios_recibo_id_fkey(anulado_en))',
    )
    .order('creado_en', { ascending: false })
    .limit(300)
  if (error) throw new Error(`No se pudieron leer los subcontratos: ${error.message}`)
  type Fila = Omit<SubcontratoListado, 'area_codigo' | 'monto' | 'moneda' | 'subcontratista' | 'recibos'> & {
    area: Uno<{ codigo: string }>
    monto: Num
    moneda: string
    subcontratista: Uno<{ nombre: string; ruc: string }>
    recibos: FilaResumen[] | null
  }
  return ((data ?? []) as unknown as Fila[]).map(({ area, ...s }) => ({
    ...s,
    area_codigo: unico(area)?.codigo ?? null,
    moneda: s.moneda === 'USD' ? 'USD' : 'PEN',
    monto: num(s.monto),
    subcontratista: unico(s.subcontratista),
    recibos: (s.recibos ?? []).map(resumen),
  }))
}

export type PagoRecibo = {
  id: string
  fecha_pago: string
  monto: number
  operacion: string | null
  voucher_ruta: string
  creado_en: string
  anulado_en: string | null
  motivo_anulacion: string | null
  enlace: string | null
}

export type ReciboHonorarios = {
  id: string
  numero: string
  fecha_emision: string
  concepto: string | null
  moneda: 'PEN' | 'USD'
  monto_bruto: number
  retencion_porcentaje: number
  retencion_monto: number
  monto_neto: number
  archivo_ruta: string
  creado_en: string
  anulado_en: string | null
  motivo_anulacion: string | null
  enlace: string | null
  pagos: PagoRecibo[]
}

export type SubcontratoDetalle = Omit<SubcontratoListado, 'subcontratista' | 'recibos'> & {
  terminado_en: string | null
  anulado_en: string | null
  fechas_reales_en: string | null
  /** Quién marcó las fechas reales; null si nadie o si su ficha no se puede leer. */
  fechas_reales_por: string | null
  subcontratista: Subcontratista | null
  recibos: ReciboHonorarios[]
  /** Del más reciente al más viejo: el primero es el vigente. */
  contratos: ContratoAdjunto[]
}

const COLUMNAS_RECIBO =
  'id, numero, fecha_emision, concepto, moneda, monto_bruto, retencion_porcentaje, retencion_monto, monto_neto, archivo_ruta,' +
  ' creado_en, anulado_en, motivo_anulacion,' +
  ' pagos:pagos_recibo_honorarios!pagos_recibo_honorarios_recibo_id_fkey(id, fecha_pago, monto, operacion, voucher_ruta, creado_en,' +
  ' anulado_en, motivo_anulacion)'

type FilaPago = Omit<PagoRecibo, 'monto' | 'enlace'> & { monto: Num }
type FilaRecibo = Omit<ReciboHonorarios, 'moneda' | 'monto_bruto' | 'retencion_porcentaje' | 'retencion_monto' | 'monto_neto' | 'enlace' | 'pagos'> & {
  moneda: string
  monto_bruto: Num
  retencion_porcentaje: Num
  retencion_monto: Num
  monto_neto: Num
  pagos: FilaPago[] | null
}

/** Un recibo con sus números y los enlaces de su archivo y de los vouchers. */
function armarRecibo(r: FilaRecibo, enlaces: Record<string, string>): ReciboHonorarios {
  return {
    ...r,
    moneda: r.moneda === 'USD' ? 'USD' : 'PEN',
    monto_bruto: num(r.monto_bruto),
    retencion_porcentaje: num(r.retencion_porcentaje),
    retencion_monto: num(r.retencion_monto),
    monto_neto: num(r.monto_neto),
    enlace: enlaces[r.archivo_ruta] ?? null,
    pagos: [...(r.pagos ?? [])]
      .sort((a, b) => a.creado_en.localeCompare(b.creado_en))
      .map((p) => ({ ...p, monto: num(p.monto), enlace: enlaces[p.voucher_ruta] ?? null })),
  }
}

const rutasDe = (recibos: FilaRecibo[]) => recibos.flatMap((r) => [r.archivo_ruta, ...(r.pagos ?? []).map((p) => p.voucher_ruta)])

/** Un subcontrato con su subcontratista, su cuenta, sus recibos, sus pagos y los enlaces para abrirlos. */
export async function subcontratoDetalle(id: string): Promise<SubcontratoDetalle | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('subcontratos')
    .select(
      'id, numero, codigo_interno, descripcion, moneda, monto, fecha_inicio, fecha_fin, inicio_real, fin_real, fechas_reales_en, estado, creado_en,' +
        ` terminado_en, anulado_en, motivo_anulacion, subcontratista:subcontratistas!subcontratos_subcontratista_id_fkey(${COLUMNAS_SUBCONTRATISTA}),` +
        ' area:areas!subcontratos_area_id_fkey(codigo),' +
        ' marco:usuarios!subcontratos_fechas_reales_por_fkey(nombres, apellidos),' +
        ` recibos:recibos_honorarios!recibos_honorarios_subcontrato_id_fkey(${COLUMNAS_RECIBO}),` +
        ' contratos:subcontrato_contratos!subcontrato_contratos_subcontrato_id_fkey(id, archivo_ruta, archivo_nombre, creado_en,' +
        ' subio:usuarios!subcontrato_contratos_subido_por_fkey(nombres, apellidos))',
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el subcontrato: ${error.message}`)
  if (!data) return null

  type Persona = { nombres: string; apellidos: string }
  type Fila = Omit<SubcontratoDetalle, 'area_codigo' | 'monto' | 'moneda' | 'subcontratista' | 'recibos' | 'contratos' | 'fechas_reales_por'> & {
    area: Uno<{ codigo: string }>
    marco: Uno<Persona>
    monto: Num
    moneda: string
    subcontratista: Uno<Subcontratista>
    recibos: FilaRecibo[] | null
    contratos: (Omit<ContratoAdjunto, 'subido_por' | 'enlace'> & { subio: Uno<Persona> })[] | null
  }
  const { area, marco, contratos: filasContrato, ...fila } = data as unknown as Fila
  const recibos = [...(fila.recibos ?? [])].sort((a, b) => a.fecha_emision.localeCompare(b.fecha_emision) || a.creado_en.localeCompare(b.creado_en))
  const contratos = [...(filasContrato ?? [])].sort((a, b) => b.creado_en.localeCompare(a.creado_en))
  const enlaces = await enlacesDeArchivos([...rutasDe(recibos), ...contratos.map((c) => c.archivo_ruta)])
  const nombre = (p: Uno<Persona>) => {
    const u = unico(p)
    return u ? `${u.nombres} ${u.apellidos}` : null
  }
  return {
    ...fila,
    area_codigo: unico(area)?.codigo ?? null,
    fechas_reales_por: nombre(marco),
    contratos: contratos.map(({ subio, ...c }) => ({ ...c, subido_por: nombre(subio), enlace: enlaces[c.archivo_ruta] ?? null })),
    moneda: fila.moneda === 'USD' ? 'USD' : 'PEN',
    monto: num(fila.monto),
    subcontratista: unico(fila.subcontratista),
    recibos: recibos.map((r) => armarRecibo(r, enlaces)),
  }
}

/** Un recibo en la bandeja de Tesorería, con el subcontrato y la cuenta donde se paga. */
export type ReciboParaPagar = ReciboHonorarios & {
  subcontrato: { id: string; numero: string; codigo_interno: string; estado: string } | null
  subcontratista: Pick<Subcontratista, 'nombre' | 'ruc' | 'banco' | 'numero_cuenta' | 'cci'> | null
}

/**
 * Los recibos para Tesorería: los vigentes, los que esperan pago y los
 * pagados. Los anulados no: no se pagan ni se pagaron. Todos, de a 1000 filas
 * (lo que entrega el servicio por consulta): si el recibo está pagado lo dice
 * su pago, no una columna, así que no se pueden separar en la base, y con un
 * tope los por pagar más viejos desaparecían sin aviso. La pantalla los ordena.
 */
export async function recibosParaTesoreria(): Promise<ReciboParaPagar[]> {
  const supabase = await createClient()
  const data: unknown[] = []
  let error: { message: string } | null = null
  for (let desde = 0; ; desde += 1000) {
    const r = await supabase
      .from('recibos_honorarios')
      .select(
        `${COLUMNAS_RECIBO},` +
          ' subcontrato:subcontratos!recibos_honorarios_subcontrato_id_fkey(id, numero, codigo_interno, estado),' +
          ' subcontratista:subcontratistas!recibos_honorarios_subcontratista_id_fkey(nombre, ruc, banco, numero_cuenta, cci)',
      )
      .is('anulado_en', null)
      .order('fecha_emision')
      .order('id')
      .range(desde, desde + 999)
    if (r.error) { error = r.error; break }
    data.push(...(r.data ?? []))
    if ((r.data ?? []).length < 1000) break
  }
  if (error) throw new Error(`No se pudieron leer los recibos por honorarios: ${error.message}`)
  type Fila = FilaRecibo & {
    subcontrato: Uno<NonNullable<ReciboParaPagar['subcontrato']>>
    subcontratista: Uno<NonNullable<ReciboParaPagar['subcontratista']>>
  }
  const filas = (data ?? []) as unknown as Fila[]
  const enlaces = await enlacesDeArchivos(rutasDe(filas))
  return filas.map(({ subcontrato, subcontratista, ...r }) => ({
    ...armarRecibo(r, enlaces),
    subcontrato: unico(subcontrato),
    subcontratista: unico(subcontratista),
  }))
}

/**
 * Un subcontrato como lo ve el supervisor de su área (migración
 * 20261020180000): sin montos ni recibos, con su inicio, su fin y el avance
 * que su área reportó en el reporte diario.
 */
export type SubcontratoDelArea = {
  id: string
  numero: string
  codigo_interno: string
  descripcion: string
  estado: string
  area_codigo: string
  area_nombre: string
  subcontratista: string
  fecha_inicio: string | null
  fecha_fin: string | null
  terminado_en: string | null
  /** El último avance reportado; `null` si nadie lo reportó. Terminado, 100. */
  avance: number | null
  ultimo_reporte: string | null
  reportes: number
  /** Cuándo empezó y terminó de verdad, según el supervisor (referencial, migración 20261020201000). */
  inicio_real: string | null
  fin_real: string | null
  fechas_reales_en: string | null
}

/**
 * Los subcontratos del área de quien mira (Maestranza, Producción o Acabados),
 * por código interno. Los da una función de la base que exige
 * `subcontratos.area` y no devuelve ni un monto: el supervisor no lee las tablas.
 */
export async function subcontratosDelArea(): Promise<SubcontratoDelArea[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('subcontratos_del_area_con_fechas_reales')
  if (error) throw new Error(`No se pudieron leer los subcontratos de tu área: ${error.message}`)
  // La función devuelve con valor todo lo que sale de llaves no nulas; los tipos generados no lo saben.
  return ((data ?? []) as unknown as SubcontratoDelArea[]).map((s) => ({
    ...s,
    avance: s.avance === null ? null : Number(s.avance),
    reportes: Number(s.reportes ?? 0),
  }))
}

/** Las áreas que reciben subcontratos, con su id: para nombrar la de quien mira. */
export async function areasDeSubcontratos(): Promise<{ id: string; codigo: string; nombre: string }[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('areas')
    .select('id, codigo, nombre')
    .in('codigo', AREAS_SUBCONTRATO.map((x) => x.codigo))
  if (error) throw new Error(`No se pudieron leer las áreas: ${error.message}`)
  return data ?? []
}

/** Enlaces temporales para abrir los recibos y los vouchers: el bucket es privado y la política decide quién. */
async function enlacesDeArchivos(rutas: string[]) {
  if (rutas.length === 0) return {} as Record<string, string>
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from(BUCKET_SUBCONTRATOS).createSignedUrls(rutas, 3600)
  if (error || !data) return {} as Record<string, string>
  const enlaces: Record<string, string> = {}
  for (const item of data) if (item.path && item.signedUrl) enlaces[item.path] = item.signedUrl
  return enlaces
}
