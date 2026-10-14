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
  area: { id: string; codigo: string; nombre: string } | null
  /** Solo la ve RR. HH.: para el portero el embed llega vacío. */
  cuenta: { banco: string; tipo_cuenta: string; numero_cuenta: string; cci: string | null } | null
  /** Lo que cuesta al mes. Solo lo ve RR. HH.: de ahí sale el costo de su hora en el tareo. */
  costo_mensual: number | null
}

const COLUMNAS_TRABAJADOR =
  'id, nombres, apellidos, dni, cargo, area_id, hora_entrada, hora_salida, activo,' +
  ' area:areas(id, codigo, nombre), cuenta:trabajador_cuentas(banco, tipo_cuenta, numero_cuenta, cci),' +
  ' costo:trabajador_costos(costo_mensual)'

type FilaCosto = { costo_mensual: number | string }
type FilaTrabajador = Omit<Trabajador, 'cuenta' | 'costo_mensual'> & {
  cuenta: Trabajador['cuenta'] | Trabajador['cuenta'][]
  costo: FilaCosto | FilaCosto[] | null
}

/** Una relación 1 a 1 por llave única llega como objeto; si llegara como lista, se toma la primera. */
function unico<T>(valor: T | T[] | null): T | null {
  return Array.isArray(valor) ? (valor[0] ?? null) : valor
}

function aplanar({ costo, ...fila }: FilaTrabajador): Trabajador {
  const c = unico(costo)
  return { ...fila, cuenta: unico(fila.cuenta), costo_mensual: c ? Number(c.costo_mensual) : null }
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
  descuento: number
  observacion: string | null
  anulado_en: string | null
  motivo_anulacion: string | null
}

const COLUMNAS_MARCA = 'id, trabajador_id, fecha, tipo, hora, tardanza_minutos, descuento, observacion, anulado_en, motivo_anulacion'

/** Las marcas de un día, incluidas las anuladas (se muestran tachadas). */
export async function marcasDelDia(fecha: string): Promise<Marca[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from('asistencias').select(COLUMNAS_MARCA).eq('fecha', fecha).order('hora')
  if (error) throw new Error(`No se pudo leer la asistencia del día: ${error.message}`)
  return (data ?? []).map((m) => ({ ...m, descuento: Number(m.descuento) }))
}

/** La regla vigente de tardanza. */
export async function reglaTardanza() {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('rrhh_regla_tardanza')
    .select('tolerancia_minutos, descuento_por_minuto, actualizado_en')
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer la regla de tardanza: ${error.message}`)
  return data ? { ...data, descuento_por_minuto: Number(data.descuento_por_minuto) } : null
}

/** Lo que acumula cada persona en un mes: tardanzas, minutos y descuento. */
export type ResumenTardanza = {
  trabajador: Pick<Trabajador, 'id' | 'nombres' | 'apellidos' | 'dni' | 'cargo' | 'activo'>
  dias_con_ingreso: number
  tardanzas: number
  minutos: number
  descuento: number
}

/** El resumen del mes (`YYYY-MM`), de mayor a menor descuento. Cuenta solo marcas vigentes. */
export async function resumenTardanzas(mes: string): Promise<ResumenTardanza[]> {
  const supabase = await createClient()
  const desde = `${mes}-01`
  const [anio, m] = mes.split('-').map(Number)
  const hasta = `${m === 12 ? anio + 1 : anio}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`
  const [marcas, personal] = await Promise.all([
    supabase
      .from('asistencias')
      .select('trabajador_id, tardanza_minutos, descuento')
      .eq('tipo', 'INGRESO')
      .is('anulado_en', null)
      .gte('fecha', desde)
      .lt('fecha', hasta)
      .limit(5000),
    supabase.from('trabajadores').select('id, nombres, apellidos, dni, cargo, activo'),
  ])
  if (marcas.error) throw new Error(`No se pudo leer la asistencia del mes: ${marcas.error.message}`)
  if (personal.error) throw new Error(`No se pudo leer el personal: ${personal.error.message}`)

  const porPersona = new Map<string, ResumenTardanza>()
  for (const t of personal.data ?? []) {
    porPersona.set(t.id, { trabajador: t, dias_con_ingreso: 0, tardanzas: 0, minutos: 0, descuento: 0 })
  }
  for (const x of marcas.data ?? []) {
    const r = porPersona.get(x.trabajador_id)
    if (!r) continue
    r.dias_con_ingreso += 1
    if (Number(x.descuento) > 0) {
      r.tardanzas += 1
      r.minutos += x.tardanza_minutos
      r.descuento += Number(x.descuento)
    }
  }
  return [...porPersona.values()]
    .filter((r) => r.trabajador.activo || r.dias_con_ingreso > 0)
    .sort((a, b) => b.descuento - a.descuento || a.trabajador.apellidos.localeCompare(b.trabajador.apellidos))
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
}

/** Las horas cargadas en un mes (`YYYY-MM`), incluidas las anuladas, de la más reciente a la más vieja. */
export async function tareosDelMes(mes: string): Promise<Tareo[]> {
  const supabase = await createClient()
  const { desde, hasta } = rangoDelMes(mes)
  const { data, error } = await supabase
    .from('tareos')
    .select(
      'id, trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo, anulado_en, motivo_anulacion,' +
        ' trabajador:trabajadores(id, nombres, apellidos, dni, cargo)',
    )
    .gte('fecha', desde)
    .lt('fecha', hasta)
    .order('fecha', { ascending: false })
    .order('creado_en', { ascending: false })
    .limit(3000)
  if (error) throw new Error(`No se pudo leer el tareo del mes: ${error.message}`)
  type Fila = Omit<Tareo, 'trabajador'> & { trabajador: PersonaCorta | PersonaCorta[] | null }
  return ((data ?? []) as unknown as Fila[]).map((t) => ({
    ...t,
    horas: Number(t.horas),
    costo_hora: Number(t.costo_hora),
    costo: Number(t.costo),
    trabajador: unico(t.trabajador),
  }))
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
