import 'server-only'

import { createClient } from '@/lib/supabase/server'

/** Una persona del personal, con su cuenta si quien mira es RR. HH. */
export type Trabajador = {
  id: string
  nombres: string
  apellidos: string
  dni: string
  cargo: string | null
  area_id: string | null
  hora_entrada: string
  hora_salida: string
  activo: boolean
  /** El primer día que trabajó. Vacía en quien se registró antes de que la ficha la tuviera. */
  fecha_ingreso: string | null
  /** El último día que trabajó, si está de baja. */
  fecha_baja: string | null
  area: { id: string; codigo: string; nombre: string } | null
  /** Solo la ve RR. HH.: para el portero el embed llega vacío. */
  cuenta: { banco: string; tipo_cuenta: string; numero_cuenta: string; cci: string | null } | null
  /** Lo que cuesta al mes. Solo lo ve RR. HH.: de ahí sale el costo de su hora en el tareo. */
  costo_mensual: number | null
  /** Lo que se le paga al mes, sin aportes. Solo lo ve RR. HH.: de ahí sale su hora en la planilla diaria. */
  remuneracion_mensual: number | null
}

const COLUMNAS_TRABAJADOR =
  'id, nombres, apellidos, dni, cargo, area_id, hora_entrada, hora_salida, activo, fecha_ingreso, fecha_baja,' +
  ' area:areas(id, codigo, nombre), cuenta:trabajador_cuentas(banco, tipo_cuenta, numero_cuenta, cci),' +
  ' costo:trabajador_costos(costo_mensual), remuneracion:trabajador_remuneraciones(remuneracion_mensual)'

type FilaCosto = { costo_mensual: number | string }
type FilaRemuneracion = { remuneracion_mensual: number | string }
type FilaTrabajador = Omit<Trabajador, 'cuenta' | 'costo_mensual' | 'remuneracion_mensual'> & {
  cuenta: Trabajador['cuenta'] | Trabajador['cuenta'][]
  costo: FilaCosto | FilaCosto[] | null
  remuneracion: FilaRemuneracion | FilaRemuneracion[] | null
}

/** Una relación 1 a 1 por llave única llega como objeto; si llegara como lista, se toma la primera. */
function unico<T>(valor: T | T[] | null): T | null {
  return Array.isArray(valor) ? (valor[0] ?? null) : valor
}

function aplanar({ costo, remuneracion, ...fila }: FilaTrabajador): Trabajador {
  const c = unico(costo)
  const r = unico(remuneracion)
  return {
    ...fila,
    cuenta: unico(fila.cuenta),
    costo_mensual: c ? Number(c.costo_mensual) : null,
    remuneracion_mensual: r ? Number(r.remuneracion_mensual) : null,
  }
}

/** Todo el personal, por apellidos. `activos` deja fuera a los de baja. */
export async function listarTrabajadores(filtro: 'activos' | 'todos' = 'activos'): Promise<Trabajador[]> {
  const supabase = await createClient()
  let consulta = supabase.from('trabajadores').select(COLUMNAS_TRABAJADOR).order('apellidos').order('nombres')
  if (filtro === 'activos') consulta = consulta.eq('activo', true)
  const { data, error } = await consulta
  if (error) throw new Error(`No se pudo leer el personal: ${error.message}`)
  return ((data ?? []) as unknown as FilaTrabajador[]).map(aplanar)
}

/** Las áreas vigentes, para la ficha. */
export async function areasParaPersonal() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('areas').select('id, codigo, nombre').eq('activo', true).order('nombre')
  if (error) throw new Error(`No se pudieron leer las áreas: ${error.message}`)
  return data ?? []
}

/** Una marca de ingreso o de salida. */
export type Marca = {
  id: string
  trabajador_id: string
  fecha: string
  tipo: string
  hora: string
  tardanza_minutos: number
  /** El ingreso pasó la tolerancia: cuenta para el descuento del mes. */
  es_tardanza: boolean
  observacion: string | null
  anulado_en: string | null
  motivo_anulacion: string | null
}

const COLUMNAS_MARCA = 'id, trabajador_id, fecha, tipo, hora, tardanza_minutos, es_tardanza, observacion, anulado_en, motivo_anulacion'

/** Las marcas de un día, incluidas las anuladas (se muestran tachadas). */
export async function marcasDelDia(fecha: string): Promise<Marca[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('asistencias').select(COLUMNAS_MARCA).eq('fecha', fecha).order('hora')
  if (error) throw new Error(`No se pudo leer la asistencia del día: ${error.message}`)
  return data ?? []
}

/** La regla vigente: la tolerancia y cada cuántas tardanzas del mes se descuenta qué porcentaje. */
export type ReglaTardanza = {
  tolerancia_minutos: number
  tardanzas_por_descuento: number
  porcentaje_descuento: number
  actualizado_en: string
}

export async function reglaTardanza(): Promise<ReglaTardanza | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('rrhh_regla_tardanza')
    .select('tolerancia_minutos, tardanzas_por_descuento, porcentaje_descuento, actualizado_en')
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer la regla de tardanza: ${error.message}`)
  return data ? { ...data, porcentaje_descuento: Number(data.porcentaje_descuento) } : null
}

/** Lo que acumula cada persona en un mes: tardanzas, y el descuento que suman cada tantas. */
export type ResumenTardanza = {
  trabajador: Pick<Trabajador, 'id' | 'nombres' | 'apellidos' | 'dni' | 'cargo' | 'activo'>
  dias_con_ingreso: number
  tardanzas: number
  minutos: number
  /** Cuántos grupos completos de tardanzas hay en el mes. */
  grupos: number
  /** El porcentaje de su remuneración que se le descuenta. */
  porcentaje: number
  /** Solo para quien ve el sueldo (RR. HH.); `null` también si falta su remuneración. */
  remuneracion_mensual: number | null
  descuento: number | null
}

/**
 * El resumen del mes (`YYYY-MM`), de mayor a menor descuento. Lo calcula la
 * base (`rrhh_tardanzas_del_mes`) con las marcas vigentes y la regla de hoy.
 */
export async function resumenTardanzas(mes: string): Promise<ResumenTardanza[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_tardanzas_del_mes', { p_mes: `${mes}-01` })
  if (error) throw new Error(`No se pudo leer las tardanzas del mes: ${error.message}`)
  return (data ?? []).flatMap((f) =>
    f.trabajador_id
      ? [
          {
            trabajador: {
              id: f.trabajador_id,
              nombres: f.nombres ?? '',
              apellidos: f.apellidos ?? '',
              dni: f.dni ?? '',
              cargo: f.cargo,
              activo: f.activo ?? true,
            },
            dias_con_ingreso: f.dias_con_ingreso ?? 0,
            tardanzas: f.tardanzas ?? 0,
            minutos: f.minutos ?? 0,
            grupos: f.grupos ?? 0,
            porcentaje: Number(f.porcentaje ?? 0),
            remuneracion_mensual: f.remuneracion_mensual === null ? null : Number(f.remuneracion_mensual),
            descuento: f.descuento === null ? null : Number(f.descuento),
          },
        ]
      : [],
  )
}

/** Del primer día de un mes `YYYY-MM` al primero del siguiente, como texto. */
function rangoDelMes(mes: string) {
  const [anio, m] = mes.split('-').map(Number)
  const hasta = `${m === 12 ? anio + 1 : anio}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`
  return { desde: `${mes}-01`, hasta }
}

type PersonaCorta = Pick<Trabajador, 'id' | 'nombres' | 'apellidos' | 'dni' | 'cargo'>

/** Unas horas de una persona en un código interno, con el costo escrito al registrarlas. */
export type Tareo = {
  id: string
  trabajador_id: string
  fecha: string
  codigo_interno: string
  horas: number
  labor: string | null
  costo_hora: number
  costo: number
  anulado_en: string | null
  motivo_anulacion: string | null
  trabajador: PersonaCorta | null
  /** El reporte diario del que vinieron estas horas; `null` si las cargó RR. HH. a mano. */
  reporte: { id: string; asunto: string; area: string | null } | null
}

/** Las horas cargadas en un mes (`YYYY-MM`), incluidas las anuladas, de la más reciente a la más vieja. */
export async function tareosDelMes(mes: string): Promise<Tareo[]> {
  const supabase = await createClient()
  const { desde, hasta } = rangoDelMes(mes)
  const { data, error } = await supabase
    .from('tareos')
    .select(
      'id, trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo, anulado_en, motivo_anulacion,' +
        ' trabajador:trabajadores(id, nombres, apellidos, dni, cargo),' +
        ' linea:reporte_diario_personal!tareos_reporte_linea_id_fkey(reporte:reportes_diarios!reporte_diario_personal_reporte_id_fkey(id, asunto, area:areas(nombre)))',
    )
    .gte('fecha', desde)
    .lt('fecha', hasta)
    .order('fecha', { ascending: false })
    .order('creado_en', { ascending: false })
    .limit(3000)
  if (error) throw new Error(`No se pudo leer el tareo del mes: ${error.message}`)
  type Reporte = { id: string; asunto: string; area: { nombre: string } | { nombre: string }[] | null }
  type Linea = { reporte: Reporte | Reporte[] | null }
  type Fila = Omit<Tareo, 'trabajador' | 'reporte'> & { trabajador: PersonaCorta | PersonaCorta[] | null; linea: Linea | Linea[] | null }
  return ((data ?? []) as unknown as Fila[]).map(({ linea, ...t }) => {
    const reporte = unico(unico(linea)?.reporte ?? null)
    return {
      ...t,
      horas: Number(t.horas),
      costo_hora: Number(t.costo_hora),
      costo: Number(t.costo),
      trabajador: unico(t.trabajador),
      reporte: reporte ? { id: reporte.id, asunto: reporte.asunto, area: unico(reporte.area)?.nombre ?? null } : null,
    }
  })
}

/** Los códigos internos que ya usa la empresa, para elegir en vez de escribir. */
export async function codigosInternos(): Promise<string[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_codigos_internos')
  if (error) throw new Error(`No se pudieron leer los códigos internos: ${error.message}`)
  return (data ?? []).flatMap((f) => (f.codigo ? [f.codigo] : []))
}

/** Una observación, amonestación o suspensión. */
export type Observacion = {
  id: string
  trabajador_id: string
  fecha: string
  tipo: string
  motivo: string
  detalle: string
  codigo_interno: string | null
  dias_suspension: number | null
  anulado_en: string | null
  motivo_anulacion: string | null
  creado_en: string
  trabajador: PersonaCorta | null
}

const COLUMNAS_OBSERVACION =
  'id, trabajador_id, fecha, tipo, motivo, detalle, codigo_interno, dias_suspension, anulado_en, motivo_anulacion, creado_en,' +
  ' trabajador:trabajadores(id, nombres, apellidos, dni, cargo)'

type FilaObservacion = Omit<Observacion, 'trabajador'> & { trabajador: PersonaCorta | PersonaCorta[] | null }

/**
 * Las observaciones de un mes (`YYYY-MM`) o, con `trabajadorId`, todo el
 * historial de esa persona. Incluye las anuladas (se muestran tachadas).
 */
export async function listarObservaciones(filtro: { mes: string } | { trabajadorId: string }): Promise<Observacion[]> {
  const supabase = await createClient()
  let consulta = supabase.from('observaciones_personal').select(COLUMNAS_OBSERVACION)
  if ('mes' in filtro) {
    const { desde, hasta } = rangoDelMes(filtro.mes)
    consulta = consulta.gte('fecha', desde).lt('fecha', hasta)
  } else {
    consulta = consulta.eq('trabajador_id', filtro.trabajadorId)
  }
  const { data, error } = await consulta.order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(2000)
  if (error) throw new Error(`No se pudieron leer las observaciones: ${error.message}`)
  return ((data ?? []) as unknown as FilaObservacion[]).map((o) => ({ ...o, trabajador: unico(o.trabajador) }))
}

/** Un permiso que pidió una persona, con lo que ya justificó con sus horas extras. */
export type Permiso = {
  id: string
  trabajador_id: string
  nombre: string
  cargo: string | null
  activo: boolean
  fecha: string
  horas: number
  motivo: string
  justificadas: number
  por_justificar: number
  /** Las horas extras que hoy tiene reservadas la persona. */
  saldo: number
  creado_en: string
  anulado_en: string | null
  motivo_anulacion: string | null
}

/**
 * Con `mes` (`YYYY-MM`), los permisos de ese mes, incluidos los anulados; sin
 * él, los que todavía deben horas, de cualquier mes. Lo calcula la base
 * (`rrhh_permisos_personal`): quien solo consulta no lee el uso del saldo.
 */
export async function listarPermisos(mes?: string): Promise<Permiso[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_permisos_personal', mes ? { p_mes: `${mes}-01` } : {})
  if (error) throw new Error(`No se pudieron leer los permisos: ${error.message}`)
  return (data ?? []).flatMap((f) =>
    f.id && f.trabajador_id && f.fecha && f.creado_en
      ? [
          {
            id: f.id,
            trabajador_id: f.trabajador_id,
            nombre: f.nombre ?? '',
            cargo: f.cargo,
            activo: f.activo ?? true,
            fecha: f.fecha,
            horas: Number(f.horas ?? 0),
            motivo: f.motivo ?? '',
            justificadas: Number(f.justificadas ?? 0),
            por_justificar: Number(f.por_justificar ?? 0),
            saldo: Number(f.saldo ?? 0),
            creado_en: f.creado_en,
            anulado_en: f.anulado_en,
            motivo_anulacion: f.motivo_anulacion,
          },
        ]
      : [],
  )
}

/** Un pago a una persona de la oficina, con el tramo de días que paga. Solo lo lee RR. HH. */
export type PagoOficina = {
  id: string
  trabajador_id: string
  desde: string
  hasta: string
  monto: number
  aportes: number
  nota: string | null
  anulado_en: string | null
  motivo_anulacion: string | null
  trabajador: { nombres: string; apellidos: string; cargo: string | null } | null
  anulador: { nombres: string; apellidos: string } | null
}

/** Los pagos de la oficina que tocan algún día del mes `YYYY-MM`, anulados incluidos. */
export async function pagosOficinaDelMes(mes: string, finDelMes: string): Promise<PagoOficina[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('oficina_pagos')
    .select(
      'id, trabajador_id, desde, hasta, monto, aportes, nota, anulado_en, motivo_anulacion, trabajador:trabajadores(nombres, apellidos, cargo), anulador:usuarios!oficina_pagos_anulado_por_fkey(nombres, apellidos)',
    )
    .lte('desde', finDelMes)
    .gte('hasta', `${mes}-01`)
    .order('desde')
    .order('creado_en')
  if (error) throw new Error(`No se pudieron leer los pagos de la oficina: ${error.message}`)
  return (data ?? []).map((p) => ({ ...p, monto: Number(p.monto), aportes: Number(p.aportes) }))
}

/**
 * Desde cuándo cuentan los días sin pago de cada persona: la misma fecha que usa la
 * base (`inicio_registro_pagos_oficina`). Exige `rrhh.personal`.
 */
export async function inicioDelRegistroDePagos(): Promise<Map<string, string>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_inicio_registro_pagos_oficina')
  if (error) throw new Error(`No se pudo leer desde cuándo se registran los pagos de la oficina: ${error.message}`)
  return new Map((data ?? []).flatMap((f) => (f.trabajador_id && f.desde ? [[f.trabajador_id, f.desde] as const] : [])))
}

/** Los periodos que cada persona ya trabajó antes de volver a entrar, por persona. Solo RR. HH. */
export async function periodosAnteriores(): Promise<Map<string, { ingreso: string | null; baja: string }[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('trabajador_periodos').select('trabajador_id, ingreso, baja').order('baja')
  if (error) throw new Error(`No se pudieron leer los periodos trabajados: ${error.message}`)
  const porPersona = new Map<string, { ingreso: string | null; baja: string }[]>()
  for (const q of data ?? []) porPersona.set(q.trabajador_id, [...(porPersona.get(q.trabajador_id) ?? []), { ingreso: q.ingreso, baja: q.baja }])
  return porPersona
}

/** Los ids de las áreas marcadas como oficina: a su gente se le registran los pagos. */
export async function areasDeOficina(): Promise<Set<string>> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('areas').select('id').eq('es_oficina', true)
  if (error) throw new Error(`No se pudieron leer las áreas de la oficina: ${error.message}`)
  return new Set((data ?? []).map((a) => a.id))
}
