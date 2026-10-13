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
}

const COLUMNAS_TRABAJADOR =
  'id, nombres, apellidos, dni, cargo, area_id, hora_entrada, hora_salida, activo,' +
  ' area:areas(id, codigo, nombre), cuenta:trabajador_cuentas(banco, tipo_cuenta, numero_cuenta, cci)'

type FilaTrabajador = Omit<Trabajador, 'cuenta'> & { cuenta: Trabajador['cuenta'] | Trabajador['cuenta'][] }

function aplanar(fila: FilaTrabajador): Trabajador {
  // Una relación 1 a 1 por llave única llega como objeto; si llegara como lista, se toma la primera.
  const cuenta = Array.isArray(fila.cuenta) ? (fila.cuenta[0] ?? null) : fila.cuenta
  return { ...fila, cuenta }
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
