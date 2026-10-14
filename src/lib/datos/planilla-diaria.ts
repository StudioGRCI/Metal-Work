import 'server-only'

import { BUCKET_PLANILLA_DIARIA, REGLA_DE_LEY, type ReglaHorasExtras } from '@/lib/dominio/planilla-diaria'
import { createClient } from '@/lib/supabase/server'

type Uno<T> = T | T[] | null
/** Una relación 1 a 1 llega como objeto; si llegara como lista, se toma la primera. */
function unico<T>(valor: Uno<T>): T | null {
  return Array.isArray(valor) ? (valor[0] ?? null) : valor
}

/** La regla de las horas extras. Si no se puede leer, la de ley. */
export async function reglaHorasExtras(): Promise<ReglaHorasExtras & { actualizado_en: string | null }> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('rrhh_regla_horas_extras')
    .select('horas_tramo1, recargo_tramo1, recargo_tramo2, actualizado_en')
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer la regla de las horas extras: ${error.message}`)
  if (!data) return { ...REGLA_DE_LEY, actualizado_en: null }
  return {
    horas_tramo1: Number(data.horas_tramo1),
    recargo_tramo1: Number(data.recargo_tramo1),
    recargo_tramo2: Number(data.recargo_tramo2),
    actualizado_en: data.actualizado_en,
  }
}

/** Un día de una persona que va a entrar a la próxima planilla. */
export type DiaPorEnviar = { fecha: string; concepto: 'ORDINARIAS' | 'EXTRAS'; horas: number; tramo1: number; tramo2: number }

/** Lo que va a entrar a la próxima planilla, por persona. Sin remuneración, la persona espera. */
export type PersonaPorEnviar = {
  trabajador_id: string
  nombre: string
  cargo: string | null
  remuneracion: number | null
  dias: DiaPorEnviar[]
}

/** Lo validado que falta pagar. Solo RR. HH. (`planilla_diaria.preparar`). */
export async function planillaPorEnviar(): Promise<PersonaPorEnviar[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('planilla_diaria_por_enviar')
  if (error) throw new Error(`No se pudo leer lo que falta pagar: ${error.message}`)
  const porPersona = new Map<string, PersonaPorEnviar>()
  for (const f of data ?? []) {
    if (!f.trabajador_id || !f.fecha) continue
    const persona = porPersona.get(f.trabajador_id) ?? {
      trabajador_id: f.trabajador_id,
      nombre: f.nombre ?? 'Persona',
      cargo: f.cargo,
      remuneracion: f.remuneracion_mensual === null ? null : Number(f.remuneracion_mensual),
      dias: [],
    }
    persona.dias.push({
      fecha: f.fecha,
      concepto: f.concepto === 'EXTRAS' ? 'EXTRAS' : 'ORDINARIAS',
      horas: Number(f.horas),
      tramo1: Number(f.horas_tramo1 ?? 0),
      tramo2: Number(f.horas_tramo2 ?? 0),
    })
    porPersona.set(f.trabajador_id, persona)
  }
  return [...porPersona.values()]
}

/** Una planilla en la lista, con lo justo para saber en qué va. */
export type PlanillaListada = {
  id: string
  numero: string
  fecha: string
  personas: number
  total: number
  creado_en: string
  anulado_en: string | null
  motivo_anulacion: string | null
  gente: { pago_id: string | null; boleta_ruta: string | null; boleta_entregada_en: string | null }[]
}

/** Las planillas diarias, de la más reciente a la más vieja. Las ven RR. HH., Tesorería y Gerencia. */
export async function listarPlanillasDiarias(): Promise<PlanillaListada[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('planillas_diarias')
    .select(
      'id, numero, fecha, personas, total, creado_en, anulado_en, motivo_anulacion,' +
        ' gente:planilla_diaria_personas!planilla_diaria_personas_planilla_id_fkey(pago_id, boleta_ruta, boleta_entregada_en)',
    )
    .order('creado_en', { ascending: false })
    .limit(100)
  if (error) throw new Error(`No se pudieron leer las planillas diarias: ${error.message}`)
  type Fila = Omit<PlanillaListada, 'total' | 'gente'> & { total: number | string; gente: PlanillaListada['gente'] | null }
  return ((data ?? []) as unknown as Fila[]).map((p) => ({ ...p, total: Number(p.total), gente: p.gente ?? [] }))
}

/** Un día de una persona en la planilla, con la hora y el recargo de ese momento. */
export type DetallePlanilla = {
  fecha: string
  concepto: 'ORDINARIAS' | 'EXTRAS'
  horas: number
  horas_tramo1: number
  horas_tramo2: number
  valor_hora: number
  recargo_tramo1: number
  recargo_tramo2: number
  monto: number
}

/** La cuenta donde se le paga a la persona: solo para Tesorería y RR. HH. */
export type CuentaDePago = { banco: string | null; tipo_cuenta: string | null; numero_cuenta: string | null; cci: string | null }

export type PersonaPlanilla = {
  id: string
  trabajador_id: string
  nombre: string
  cargo: string | null
  horas_ordinarias: number
  horas_extras: number
  monto_ordinarias: number
  monto_extras: number
  total: number
  pago_id: string | null
  boleta_ruta: string | null
  boleta_subida_en: string | null
  boleta_entregada_en: string | null
  boleta_enlace: string | null
  detalle: DetallePlanilla[]
  cuenta: CuentaDePago | null
}

export type PagoPlanilla = {
  id: string
  fecha_pago: string
  operacion: string | null
  comprobante_ruta: string
  comprobante_mime: string
  creado_en: string
  anulado_en: string | null
  motivo_anulacion: string | null
  enlace: string | null
}

export type PlanillaDetalle = Omit<PlanillaListada, 'gente'> & { gente: PersonaPlanilla[]; pagos: PagoPlanilla[] }

/**
 * Una planilla con su gente, sus días, sus pagos y los enlaces para abrir los
 * comprobantes y las boletas. `conCuentas`: quien mira paga o arma la planilla
 * y ve la cuenta de cada persona (la base vuelve a decidirlo).
 */
export async function planillaDiaria(id: string, conCuentas: boolean): Promise<PlanillaDetalle | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('planillas_diarias')
    .select(
      'id, numero, fecha, personas, total, creado_en, anulado_en, motivo_anulacion,' +
        ' gente:planilla_diaria_personas!planilla_diaria_personas_planilla_id_fkey(id, trabajador_id, nombre, cargo, horas_ordinarias,' +
        ' horas_extras, monto_ordinarias, monto_extras, total, pago_id, boleta_ruta, boleta_subida_en, boleta_entregada_en,' +
        ' detalle:planilla_diaria_detalle!planilla_diaria_detalle_persona_id_fkey(fecha, concepto, horas, horas_tramo1, horas_tramo2,' +
        ' valor_hora, recargo_tramo1, recargo_tramo2, monto)),' +
        ' pagos:planilla_diaria_pagos!planilla_diaria_pagos_planilla_id_fkey(id, fecha_pago, operacion, comprobante_ruta, comprobante_mime,' +
        ' creado_en, anulado_en, motivo_anulacion)',
    )
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer la planilla diaria: ${error.message}`)
  if (!data) return null

  type Num = number | string
  type FilaDetalle = { [K in keyof DetallePlanilla]: K extends 'fecha' | 'concepto' ? DetallePlanilla[K] : Num }
  type FilaPersona = Omit<PersonaPlanilla, 'horas_ordinarias' | 'horas_extras' | 'monto_ordinarias' | 'monto_extras' | 'total' | 'detalle' | 'cuenta' | 'boleta_enlace'> & {
    horas_ordinarias: Num
    horas_extras: Num
    monto_ordinarias: Num
    monto_extras: Num
    total: Num
    detalle: FilaDetalle[] | null
  }
  const fila = data as unknown as Omit<PlanillaListada, 'total' | 'gente'> & {
    total: Num
    gente: FilaPersona[] | null
    pagos: Omit<PagoPlanilla, 'enlace'>[] | null
  }

  const pagos = [...(fila.pagos ?? [])].sort((a, b) => a.creado_en.localeCompare(b.creado_en))
  const rutas = [...pagos.map((p) => p.comprobante_ruta), ...(fila.gente ?? []).flatMap((p) => (p.boleta_ruta ? [p.boleta_ruta] : []))]
  const [enlaces, cuentas] = await Promise.all([enlacesDeArchivos(rutas), conCuentas && !fila.anulado_en ? cuentasDePlanilla(id) : Promise.resolve(null)])

  return {
    ...fila,
    total: Number(fila.total),
    gente: [...(fila.gente ?? [])]
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
      .map((p) => ({
        ...p,
        horas_ordinarias: Number(p.horas_ordinarias),
        horas_extras: Number(p.horas_extras),
        monto_ordinarias: Number(p.monto_ordinarias),
        monto_extras: Number(p.monto_extras),
        total: Number(p.total),
        boleta_enlace: p.boleta_ruta ? (enlaces[p.boleta_ruta] ?? null) : null,
        detalle: [...(p.detalle ?? [])]
          .map((d) => ({
            fecha: d.fecha,
            concepto: d.concepto,
            horas: Number(d.horas),
            horas_tramo1: Number(d.horas_tramo1),
            horas_tramo2: Number(d.horas_tramo2),
            valor_hora: Number(d.valor_hora),
            recargo_tramo1: Number(d.recargo_tramo1),
            recargo_tramo2: Number(d.recargo_tramo2),
            monto: Number(d.monto),
          }))
          .sort((a, b) => a.fecha.localeCompare(b.fecha) || b.concepto.localeCompare(a.concepto)),
        cuenta: cuentas?.get(p.id) ?? null,
      })),
    pagos: pagos.map((p) => ({ ...p, enlace: enlaces[p.comprobante_ruta] ?? null })),
  }
}

/** La cuenta de cada persona de la planilla, por su renglón. La base la da solo a Tesorería y RR. HH. */
async function cuentasDePlanilla(id: string) {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('planilla_diaria_cuentas', { p_planilla_id: id })
  // Sin cuentas la planilla igual se lee; Tesorería verá «sin cuenta».
  if (error || !data) return new Map<string, CuentaDePago>()
  return new Map(
    data.flatMap((c) =>
      c.persona_id ? [[c.persona_id, { banco: c.banco, tipo_cuenta: c.tipo_cuenta, numero_cuenta: c.numero_cuenta, cci: c.cci }] as const] : [],
    ),
  )
}

/** Enlaces temporales para abrir comprobantes y boletas: el bucket es privado y la política decide quién. */
async function enlacesDeArchivos(rutas: string[]) {
  if (rutas.length === 0) return {} as Record<string, string>
  const supabase = await createClient()
  const { data, error } = await supabase.storage.from(BUCKET_PLANILLA_DIARIA).createSignedUrls(rutas, 3600)
  if (error || !data) return {} as Record<string, string>
  const enlaces: Record<string, string> = {}
  for (const item of data) if (item.path && item.signedUrl) enlaces[item.path] = item.signedUrl
  return enlaces
}

/** Las horas extras de un día que RR. HH. todavía no decidió. */
export type ExtrasPorDecidir = {
  trabajador_id: string
  nombre: string
  cargo: string | null
  fecha: string
  horas_del_dia: number
  extras: number
  por_decidir: number
  tramo1: number
  tramo2: number
  /** Solo para RR. HH.; para Gerencia llega `null`. */
  remuneracion: number | null
}

export async function horasExtrasPorDecidir(): Promise<ExtrasPorDecidir[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('horas_extras_por_decidir')
  if (error) throw new Error(`No se pudieron leer las horas extras: ${error.message}`)
  return (data ?? []).flatMap((f) =>
    f.trabajador_id && f.fecha
      ? [
          {
            trabajador_id: f.trabajador_id,
            nombre: f.nombre ?? 'Persona',
            cargo: f.cargo,
            fecha: f.fecha,
            horas_del_dia: Number(f.horas_del_dia),
            extras: Number(f.extras),
            por_decidir: Number(f.por_decidir),
            tramo1: Number(f.horas_tramo1),
            tramo2: Number(f.horas_tramo2),
            remuneracion: f.remuneracion_mensual === null ? null : Number(f.remuneracion_mensual),
          },
        ]
      : [],
  )
}

/** El saldo de horas reservadas de cada persona que alguna vez tuvo. */
export type SaldoDeHoras = { trabajador_id: string; nombre: string; cargo: string | null; reservadas: number; usadas: number; saldo: number }

export async function saldoDeHoras(): Promise<SaldoDeHoras[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('saldo_horas_por_persona')
  if (error) throw new Error(`No se pudo leer el saldo de horas: ${error.message}`)
  return (data ?? []).flatMap((f) =>
    f.trabajador_id
      ? [
          {
            trabajador_id: f.trabajador_id,
            nombre: f.nombre ?? 'Persona',
            cargo: f.cargo,
            reservadas: Number(f.reservadas),
            usadas: Number(f.usadas),
            saldo: Number(f.saldo),
          },
        ]
      : [],
  )
}

/** Lo que RR. HH. decidió con las extras de un día, y en qué planilla entraron las pagadas. */
export type DecisionExtras = {
  id: string
  fecha: string
  horas: number
  horas_tramo1: number
  horas_tramo2: number
  decision: 'PAGAR' | 'RESERVAR'
  creado_en: string
  anulado_en: string | null
  motivo_anulacion: string | null
  nombre: string
  planilla: { id: string; numero: string } | null
}

/** Las últimas decisiones, de la más reciente a la más vieja. */
export async function decisionesHorasExtras(): Promise<DecisionExtras[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('horas_extras_decisiones')
    .select(
      'id, fecha, horas, horas_tramo1, horas_tramo2, decision, creado_en, anulado_en, motivo_anulacion,' +
        ' trabajador:trabajadores(nombres, apellidos),' +
        ' detalle:planilla_diaria_detalle!planilla_diaria_detalle_decision_id_fkey(persona:planilla_diaria_personas!planilla_diaria_detalle_persona_id_fkey(' +
        'planilla:planillas_diarias!planilla_diaria_personas_planilla_id_fkey(id, numero, anulado_en)))',
    )
    .order('fecha', { ascending: false })
    .order('creado_en', { ascending: false })
    .limit(150)
  if (error) throw new Error(`No se pudieron leer las decisiones de horas extras: ${error.message}`)
  type Planilla = { id: string; numero: string; anulado_en: string | null }
  type Fila = Omit<DecisionExtras, 'horas' | 'horas_tramo1' | 'horas_tramo2' | 'nombre' | 'planilla'> & {
    horas: number | string
    horas_tramo1: number | string
    horas_tramo2: number | string
    trabajador: Uno<{ nombres: string; apellidos: string }>
    detalle: { persona: Uno<{ planilla: Uno<Planilla> }> }[] | null
  }
  return ((data ?? []) as unknown as Fila[]).map(({ trabajador, detalle, ...f }) => {
    const t = unico(trabajador)
    const vigente = (detalle ?? []).map((d) => unico(unico(d.persona)?.planilla ?? null)).find((p) => p && !p.anulado_en) ?? null
    return {
      ...f,
      horas: Number(f.horas),
      horas_tramo1: Number(f.horas_tramo1),
      horas_tramo2: Number(f.horas_tramo2),
      nombre: t ? `${t.apellidos}, ${t.nombres}` : 'Persona',
      planilla: vigente ? { id: vigente.id, numero: vigente.numero } : null,
    }
  })
}

/** Las horas del saldo que se usaron (un permiso, un descanso). */
export type UsoDelSaldo = {
  id: string
  fecha: string
  horas: number
  motivo: string
  anulado_en: string | null
  motivo_anulacion: string | null
  nombre: string
}

export async function usosDelSaldo(): Promise<UsoDelSaldo[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('horas_compensadas')
    .select('id, fecha, horas, motivo, anulado_en, motivo_anulacion, trabajador:trabajadores(nombres, apellidos)')
    .order('fecha', { ascending: false })
    .order('creado_en', { ascending: false })
    .limit(100)
  if (error) throw new Error(`No se pudo leer el uso del saldo de horas: ${error.message}`)
  type Fila = Omit<UsoDelSaldo, 'horas' | 'nombre'> & { horas: number | string; trabajador: Uno<{ nombres: string; apellidos: string }> }
  return ((data ?? []) as unknown as Fila[]).map(({ trabajador, ...f }) => {
    const t = unico(trabajador)
    return { ...f, horas: Number(f.horas), nombre: t ? `${t.apellidos}, ${t.nombres}` : 'Persona' }
  })
}
