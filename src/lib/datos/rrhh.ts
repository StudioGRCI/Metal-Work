import 'server-only'

import { cache } from 'react'

import { todasLasFilas } from '@/lib/datos/todas-las-filas'
import { createClient } from '@/lib/supabase/server'

/** Una persona del personal, con su cuenta si quien mira es RR. HH. */
export type Trabajador = {
  id: string
  nombres: string
  apellidos: string
  /**
   * Solo para RR. HH. (`listarTrabajadores(…, { conDni: true })`): la columna
   * está cerrada por permiso (migración 20261020165000) y a los demás les llega
   * vacío. La portería busca por DNI con `asistencia_buscar_por_dni`, sin verlo.
   */
  dni: string | null
  cargo: string | null
  area_id: string | null
  hora_entrada: string
  hora_salida: string
  activo: boolean
  /** El primer día que trabajó. Vacía en quien se registró antes de que la ficha la tuviera. */
  fecha_ingreso: string | null
  /** El último día que trabajó, si está de baja. */
  fecha_baja: string | null
  /** De taller (la que el supervisor pone en el reporte diario) o administrativa. La elige RR. HH. */
  planilla: 'TALLER' | 'ADMINISTRATIVA'
  area: { id: string; codigo: string; nombre: string } | null
  /** Solo la ve RR. HH.: para el portero el embed llega vacío. */
  cuenta: { banco: string; tipo_cuenta: string; numero_cuenta: string; cci: string | null } | null
  /** Lo que cuesta al mes. Solo lo ve RR. HH.: de ahí sale el costo de su hora en el tareo. */
  costo_mensual: number | null
  /** Lo que se le paga al mes, sin aportes. Solo lo ve RR. HH.: de ahí sale su hora en la planilla diaria. */
  remuneracion_mensual: number | null
}

const COLUMNAS_TRABAJADOR =
  'id, nombres, apellidos, cargo, area_id, hora_entrada, hora_salida, activo, fecha_ingreso, fecha_baja, planilla,' +
  ' area:areas(id, codigo, nombre), cuenta:trabajador_cuentas(banco, tipo_cuenta, numero_cuenta, cci),' +
  ' costo:trabajador_costos(costo_mensual), remuneracion:trabajador_remuneraciones(remuneracion_mensual)'

type FilaCosto = { costo_mensual: number | string }
type FilaRemuneracion = { remuneracion_mensual: number | string }
type FilaTrabajador = Omit<Trabajador, 'dni' | 'cuenta' | 'costo_mensual' | 'remuneracion_mensual'> & {
  cuenta: Trabajador['cuenta'] | Trabajador['cuenta'][]
  costo: FilaCosto | FilaCosto[] | null
  remuneracion: FilaRemuneracion | FilaRemuneracion[] | null
}

/** Una relación 1 a 1 por llave única llega como objeto; si llegara como lista, se toma la primera. */
function unico<T>(valor: T | T[] | null): T | null {
  return Array.isArray(valor) ? (valor[0] ?? null) : valor
}

function aplanar({ costo, remuneracion, ...fila }: FilaTrabajador, dni: Map<string, string>): Trabajador {
  const c = unico(costo)
  const r = unico(remuneracion)
  return {
    ...fila,
    dni: dni.get(fila.id) ?? null,
    cuenta: unico(fila.cuenta),
    costo_mensual: c ? Number(c.costo_mensual) : null,
    remuneracion_mensual: r ? Number(r.remuneracion_mensual) : null,
  }
}

/**
 * Todo el personal, por apellidos. `activos` deja fuera a los de baja.
 * `conDni` lo pide solo la ficha de RR. HH.: la base lo niega a los demás.
 */
export async function listarTrabajadores(
  filtro: 'activos' | 'todos' = 'activos',
  { conDni = false }: { conDni?: boolean } = {},
): Promise<Trabajador[]> {
  const supabase = await createClient()
  let consulta = supabase.from('trabajadores').select(COLUMNAS_TRABAJADOR).order('apellidos').order('nombres')
  if (filtro === 'activos') consulta = consulta.eq('activo', true)
  const [{ data, error }, dni] = await Promise.all([consulta, conDni ? dniDelPersonal() : Promise.resolve(new Map<string, string>())])
  if (error) throw new Error(`No se pudo leer el personal: ${error.message}`)
  return ((data ?? []) as unknown as FilaTrabajador[]).map((f) => aplanar(f, dni))
}

/** El DNI de cada persona, para RR. HH. (`rrhh_dni_de_trabajadores`). */
async function dniDelPersonal(): Promise<Map<string, string>> {
  const supabase = await createClient()
  const { data, error } = await todasLasFilas(() => supabase.rpc('rrhh_dni_de_trabajadores'), ['trabajador_id'])
  if (error) throw new Error(`No se pudo leer el DNI del personal: ${error.message}`)
  return new Map(data.flatMap((f) => (f.trabajador_id && f.dni ? [[f.trabajador_id, f.dni] as const] : [])))
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
  /** El DNI llega solo a RR. HH. */
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
              dni: f.dni,
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

type PersonaCorta = Pick<Trabajador, 'id' | 'nombres' | 'apellidos' | 'cargo'>

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
  // Un mes normal pasa de mil cargas: se lee entero, o el total del mes salía corto.
  const { data, error } = await todasLasFilas(
    () =>
      supabase
        .from('tareos')
        .select(
          'id, trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo, anulado_en, motivo_anulacion,' +
            ' trabajador:trabajadores(id, nombres, apellidos, cargo),' +
            ' linea:reporte_diario_personal!tareos_reporte_linea_id_fkey(reporte:reportes_diarios!reporte_diario_personal_reporte_id_fkey(id, asunto, area:areas(nombre)))',
        )
        .gte('fecha', desde)
        .lt('fecha', hasta),
    ['fecha.desc', 'creado_en.desc', 'id'],
  )
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

/** El recargo de las horas extras que pagó una planilla diaria, en un código y un día. */
export type RecargoExtras = {
  codigo: string
  fecha: string
  /** El número de la planilla diaria que lo pagó. */
  documento: string
  planilla_id: string | null
  personas: number
  horas: number
  monto: number
}

/**
 * El recargo de las horas extras del mes (`YYYY-MM`) por código, lo mismo que
 * suma el costeo de cada código (`rrhh_recargo_extras_del_mes`). Exige `rrhh.personal`.
 */
export async function recargoExtrasDelMes(mes: string): Promise<RecargoExtras[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_recargo_extras_del_mes', { p_mes: `${mes}-01` })
  if (error) throw new Error(`No se pudo leer el recargo de las horas extras: ${error.message}`)
  return (data ?? []).flatMap((f) =>
    f.codigo && f.fecha
      ? [
          {
            codigo: f.codigo,
            fecha: f.fecha,
            documento: f.documento ?? '',
            planilla_id: f.planilla_id,
            personas: f.personas ?? 0,
            horas: Number(f.horas ?? 0),
            monto: Number(f.monto ?? 0),
          },
        ]
      : [],
  )
}

/**
 * Cómo entra cada persona de la planilla de taller al costo de los códigos:
 * `HORAS`, por sus horas del mes más el ajuste a su costo real; `SIN_COSTO`,
 * tiene horas en el reporte pero su ficha no tiene costo mensual, y su costo va
 * por esas horas; `SIN_FICHA` o `SIN_HORAS`, su costo entero por las horas de
 * todos; `OFICINA`, no entra (va por los pagos de la oficina); `ANTES`, de antes
 * de noviembre de 2026, cuando empezó el ajuste: queda como registro.
 */
export type PersonaAlCosto = {
  persona_id: string
  trabajador_id: string | null
  trabajador: string | null
  como: 'HORAS' | 'SIN_COSTO' | 'SIN_FICHA' | 'SIN_HORAS' | 'OFICINA' | 'ANTES'
  costo: number
  horas: number
  costo_horas: number
  /** El recargo de sus horas extras que la planilla diaria pagó y ya entró a los códigos. */
  recargo: number
  ajuste: number
  /** Lo que de verdad llega a los códigos: 0 si no hay adónde (un mes sin horas en ningún código). */
  entra: number
  codigos: number
  /** El mes tiene horas en algún código. */
  mes_con_horas: boolean
}

/**
 * El primer mes (`YYYY-MM-01`) cuya planilla de taller ajusta la mano de obra de
 * los códigos al cerrarse (`planilla_ajuste_desde()`): noviembre de 2026. Las de
 * antes quedan como registro. Es una fecha fija: no pide permiso. Una vez por
 * petición: la leen la pantalla de Planillas y el globo del menú.
 */
export const planillaAjusteDesde = cache(async (): Promise<string> => {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('planilla_ajuste_desde')
  if (error || !data) throw new Error(`No se pudo leer desde cuándo se ajusta la planilla: ${error?.message ?? 'sin fecha'}`)
  return data
})

/** Las personas de una planilla de taller y cómo entran al costo (`rrhh_planilla_al_costo`), por persona. */
export async function planillaAlCosto(planillaId: string): Promise<Map<string, PersonaAlCosto>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_planilla_al_costo', { p_planilla: planillaId })
  if (error) throw new Error(`No se pudo leer cómo entra la planilla al costo: ${error.message}`)
  const comoDe = (v: string | null): PersonaAlCosto['como'] =>
    v === 'SIN_COSTO' || v === 'SIN_FICHA' || v === 'SIN_HORAS' || v === 'OFICINA' || v === 'ANTES' ? v : 'HORAS'
  return new Map(
    (data ?? []).flatMap((f) =>
      f.persona_id
        ? [
            [
              f.persona_id,
              {
                persona_id: f.persona_id,
                trabajador_id: f.trabajador_id,
                trabajador: f.trabajador,
                como: comoDe(f.como),
                costo: Number(f.costo ?? 0),
                horas: Number(f.horas ?? 0),
                costo_horas: Number(f.costo_horas ?? 0),
                recargo: Number(f.recargo ?? 0),
                ajuste: Number(f.ajuste ?? 0),
                entra: Number(f.entra ?? 0),
                codigos: f.codigos ?? 0,
                mes_con_horas: f.mes_con_horas ?? false,
              },
            ] as const,
          ]
        : [],
    ),
  )
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
  ' trabajador:trabajadores(id, nombres, apellidos, cargo)'

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

/** Un permiso que pidió una persona, con lo que ya justificó con sus horas extras o se le descontó. */
export type Permiso = {
  id: string
  trabajador_id: string
  nombre: string
  cargo: string | null
  activo: boolean
  /** De taller (se le paga por las horas del reporte) o administrativa (por su sueldo). */
  planilla: 'TALLER' | 'ADMINISTRATIVA'
  fecha: string
  horas: number
  motivo: string
  justificadas: number
  /** Las horas que RR. HH. decidió descontar porque no se justificaron. */
  descontadas: number
  por_justificar: number
  /** Las horas extras que hoy tiene reservadas la persona. */
  saldo: number
  /** Quedó en las observaciones de la persona como permiso sin justificar. */
  reportado: boolean
  /** Lo que marcó en portería ese día. */
  ingreso: string | null
  salida: string | null
  /** Las horas que el supervisor le puso ese día en sus reportes. */
  horas_reporte: number | null
  /** Las horas del permiso que la planilla diaria ya pagó (justificadas con extras). */
  horas_pagadas: number
  /** Lo restado del pago por ese día; `null` para quien no ve el sueldo. */
  descontado: number | null
  /** La hora de su remuneración (entre 240); `null` para quien no ve el sueldo o sin remuneración. */
  valor_hora: number | null
  /** Lo que el próximo pago va a restar (o devolver, en negativo) por ese día; `null` para quien no ve el sueldo. */
  por_restar: number | null
  creado_en: string
  anulado_en: string | null
  motivo_anulacion: string | null
}

/**
 * Con `mes` (`YYYY-MM`), los permisos de ese mes, incluidos los anulados; sin
 * él, los que todavía deben horas, de cualquier mes. Lo calcula la base
 * (`rrhh_permisos_con_estado`): quien solo consulta no lee el uso del saldo ni
 * lo restado en soles.
 */
export async function listarPermisos(mes?: string): Promise<Permiso[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_permisos_con_estado', mes ? { p_mes: `${mes}-01` } : {})
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
            planilla: f.planilla === 'ADMINISTRATIVA' ? 'ADMINISTRATIVA' : 'TALLER',
            fecha: f.fecha,
            horas: Number(f.horas ?? 0),
            motivo: f.motivo ?? '',
            justificadas: Number(f.justificadas ?? 0),
            descontadas: Number(f.descontadas ?? 0),
            por_justificar: Number(f.por_justificar ?? 0),
            saldo: Number(f.saldo ?? 0),
            reportado: f.reportado ?? false,
            ingreso: f.ingreso,
            salida: f.salida,
            horas_reporte: f.horas_reporte === null ? null : Number(f.horas_reporte),
            horas_pagadas: Number(f.horas_pagadas ?? 0),
            descontado: f.descontado === null ? null : Number(f.descontado),
            valor_hora: f.valor_hora === null ? null : Number(f.valor_hora),
            por_restar: f.por_restar === null ? null : Number(f.por_restar),
            creado_en: f.creado_en,
            anulado_en: f.anulado_en,
            motivo_anulacion: f.motivo_anulacion,
          },
        ]
      : [],
  )
}

/** Lo que el próximo pago de una persona le va a restar (monto positivo) o devolver (negativo). */
export type DescuentoPorAplicar = {
  trabajador_id: string
  nombre: string
  planilla: 'TALLER' | 'ADMINISTRATIVA'
  /** De baja ya no tiene próximo pago: lo que le falta no se le va a restar. */
  activo: boolean
  concepto: 'TARDANZAS' | 'PERMISO'
  /** El mes de las tardanzas (su primer día) o el día del permiso. */
  fecha: string
  horas: number | null
  monto: number
  detalle: string
}

/**
 * Lo que falta restar o devolver a cada persona por tardanzas y permisos
 * descontados, hasta `hasta` (hoy, sin ella). Lo mismo que aplican la planilla
 * diaria y el pago de la oficina. Solo RR. HH.
 */
export async function descuentosPorAplicar(hasta?: string): Promise<DescuentoPorAplicar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_descuentos_por_aplicar', hasta ? { p_hasta: hasta } : {})
  if (error) throw new Error(`No se pudo leer lo que hay por descontar: ${error.message}`)
  return (data ?? []).flatMap((f) =>
    f.trabajador_id && f.fecha && f.concepto && f.monto !== null
      ? [
          {
            trabajador_id: f.trabajador_id,
            nombre: f.nombre ?? 'Persona',
            planilla: f.planilla === 'ADMINISTRATIVA' ? 'ADMINISTRATIVA' : 'TALLER',
            activo: f.activo ?? true,
            concepto: f.concepto === 'PERMISO' ? 'PERMISO' : 'TARDANZAS',
            fecha: f.fecha,
            horas: f.horas === null ? null : Number(f.horas),
            monto: Number(f.monto),
            detalle: f.detalle ?? '',
          },
        ]
      : [],
  )
}

/** Lo restado a cada persona por las tardanzas de un mes, lo que falta y en qué pago se restó. */
export type TardanzasRestadas = { descontado: number; por_descontar: number; documentos: string | null }

export async function tardanzasRestadas(mes: string): Promise<Map<string, TardanzasRestadas>> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('rrhh_descuentos_de_tardanzas', { p_mes: `${mes}-01` })
  if (error) throw new Error(`No se pudo leer lo restado por tardanzas: ${error.message}`)
  return new Map(
    (data ?? []).flatMap((f) =>
      f.trabajador_id
        ? [
            [
              f.trabajador_id,
              { descontado: Number(f.descontado ?? 0), por_descontar: Number(f.por_descontar ?? 0), documentos: f.documentos },
            ] as const,
          ]
        : [],
    ),
  )
}

/**
 * Lo que el sistema ya le restó a cada persona en un mes `YYYY-MM` (neto de lo
 * devuelto): por las tardanzas del mes y por los permisos descontados de sus
 * días. Para comparar con los descuentos que trae el Excel de la planilla del mes.
 * Pide `rrhh.personal` o `planilla_diaria.preparar`.
 */
export async function restadoDelMes(mes: string): Promise<Map<string, { tardanzas: number; permisos: number }>> {
  const [tardanzas, permisos] = await Promise.all([tardanzasRestadas(mes), listarPermisos(mes)])
  const restado = new Map<string, { tardanzas: number; permisos: number }>()
  for (const [id, t] of tardanzas) restado.set(id, { tardanzas: t.descontado, permisos: 0 })
  // Lo restado va por día: dos permisos del mismo día (uno anulado) lo traen dos veces.
  const dias = new Set<string>()
  for (const p of permisos) {
    if (!p.descontado || dias.has(`${p.trabajador_id}|${p.fecha}`)) continue
    dias.add(`${p.trabajador_id}|${p.fecha}`)
    const v = restado.get(p.trabajador_id) ?? { tardanzas: 0, permisos: 0 }
    restado.set(p.trabajador_id, { ...v, permisos: v.permisos + p.descontado })
  }
  return restado
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
  /** Lo que el pago restó (o devolvió, en negativo) por tardanzas y permisos: `monto` ya va sin ello. */
  descuentos: { concepto: string; monto: number; detalle: string }[]
}

/** Los pagos de la oficina que tocan algún día del mes `YYYY-MM`, anulados incluidos. */
export async function pagosOficinaDelMes(mes: string, finDelMes: string): Promise<PagoOficina[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('oficina_pagos')
    .select(
      'id, trabajador_id, desde, hasta, monto, aportes, nota, anulado_en, motivo_anulacion, trabajador:trabajadores(nombres, apellidos, cargo), anulador:usuarios!oficina_pagos_anulado_por_fkey(nombres, apellidos), descuentos:descuentos_del_pago!descuentos_del_pago_oficina_pago_id_fkey(concepto, monto, detalle)',
    )
    .lte('desde', finDelMes)
    .gte('hasta', `${mes}-01`)
    .order('desde')
    .order('creado_en')
  if (error) throw new Error(`No se pudieron leer los pagos de la oficina: ${error.message}`)
  return (data ?? []).map((p) => ({
    ...p,
    monto: Number(p.monto),
    aportes: Number(p.aportes),
    descuentos: (p.descuentos ?? []).map((d) => ({ concepto: d.concepto, monto: Number(d.monto), detalle: d.detalle })),
  }))
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
