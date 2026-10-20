'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { opcionesDeTrabajo, type OpcionDeTrabajo } from '@/lib/datos/reportes-diarios'
import { MAXIMO_CODIGOS_REPORTE, MAXIMO_FOTOS_REPORTE, MAXIMO_TRABAJOS_REPORTE } from '@/lib/dominio/reporte-diario'
import { editaComoRrhh, exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

/** Lo que viaja como JSON en un campo del formulario; si no se puede leer, `null`. */
function json(formulario: FormData, nombre: string): unknown {
  try {
    return JSON.parse(dato(formulario, nombre) || 'null')
  } catch {
    return null
  }
}

const PERSONA = z.object({
  trabajador_id: z.guid('Elige a cada persona de la lista.'),
  horas: z.coerce
    .number('Escribe las horas de cada persona.')
    .min(0.25, 'Las horas de cada persona van de 0,25 a 16.')
    .max(16, 'Las horas de cada persona van de 0,25 a 16.'),
})

const AVANCE = z.coerce
  .number('Pon el porcentaje de avance de cada trabajo.')
  .int('El avance va en números enteros.')
  .min(0, 'El avance va de 0 a 100 %.')
  .max(100, 'El avance va de 0 a 100 %.')
const PERSONAL_DEL_TRABAJO = z.array(PERSONA).max(60, 'Un trabajo lleva hasta 60 personas.')
const ELIGE = 'Elige sobre qué es cada trabajo: un plano, un subcontrato, una actividad que sigue o una nueva.'

/**
 * Cada trabajo va sobre una cosa: un plano o un subcontrato de su área, una
 * actividad que ya abrió otro día, o una actividad nueva con su descripción.
 */
const TRABAJO = z.discriminatedUnion(
  'sobre',
  [
    z.object({ sobre: z.literal('PLANO'), id: z.guid(ELIGE), avance: AVANCE, personal: PERSONAL_DEL_TRABAJO }),
    z.object({ sobre: z.literal('SUBCONTRATO'), id: z.guid(ELIGE), avance: AVANCE, personal: PERSONAL_DEL_TRABAJO }),
    z.object({ sobre: z.literal('ACTIVIDAD'), id: z.guid(ELIGE), avance: AVANCE, personal: PERSONAL_DEL_TRABAJO }),
    z.object({
      sobre: z.literal('NUEVA'),
      descripcion: z
        .string()
        .trim()
        .min(3, 'Describe cada actividad nueva, en al menos 3 caracteres.')
        .max(500, 'La descripción de una actividad pasa de 500 caracteres.'),
      avance: AVANCE,
      personal: PERSONAL_DEL_TRABAJO,
    }),
  ],
  ELIGE,
)
type Trabajo = z.infer<typeof TRABAJO>

/** Lo que espera la base por cada trabajo (`reporte_diario_insertar`). */
function trabajoParaLaBase(t: Trabajo, general: boolean) {
  const personal = general ? [] : t.personal
  switch (t.sobre) {
    case 'PLANO':
      return { plano_id: t.id, avance: t.avance, personal }
    case 'SUBCONTRATO':
      return { subcontrato_id: t.id, avance: t.avance, personal }
    case 'ACTIVIDAD':
      return { actividad_id: t.id, avance: t.avance, personal }
    case 'NUEVA':
      return { descripcion: t.descripcion, avance: t.avance, personal }
  }
}

/**
 * Sobre qué puede reportar el supervisor en un código, con el avance que ya
 * llevaba cada cosa el día del reporte (`fecha`). Mismo permiso que
 * `reporte_diario_opciones`. `corrige`: su
 * reporte observado, que no se cuenta porque lo va a reemplazar.
 */
export async function opcionesDelCodigo(codigo: string, corrige: string | null, fecha: string | null): Promise<ResultadoAccion<OpcionDeTrabajo[]>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'reporte_diario.registrar')) return { ok: false, error: 'El reporte diario lo suben los supervisores.' }
  const analisis = z
    .object({ codigo: z.string().trim().min(2).max(60), corrige: z.guid().nullable(), fecha: z.iso.date().nullable() })
    .safeParse({ codigo, corrige, fecha })
  if (!analisis.success) return { ok: false, error: 'Revisa el código interno: de 2 a 60 caracteres.' }
  try {
    return { ok: true, datos: await opcionesDeTrabajo(analisis.data.codigo, analisis.data.corrige, analisis.data.fecha) }
  } catch (e) {
    const { message, code } = e instanceof Error ? (e as Error & { code?: string }) : { message: String(e), code: undefined }
    return { ok: false, error: mensajeDeError({ message, code }) }
  }
}

const TRABAJOS = z
  .array(TRABAJO, 'Anota al menos un trabajo realizado.')
  .min(1, 'Anota al menos un trabajo realizado.')
  .max(MAXIMO_TRABAJOS_REPORTE, `Un reporte lleva hasta ${MAXIMO_TRABAJOS_REPORTE} trabajos.`)
const CODIGO_INTERNO = z
  .string()
  .trim()
  .min(2, 'Escribe el código interno. Si no es para una unidad, escribe PLANTA.')
  .max(60, 'El código interno pasa de 60 caracteres.')
const FOTOS = z.array(z.string().min(1).max(300)).max(MAXIMO_FOTOS_REPORTE, `Cada código lleva hasta ${MAXIMO_FOTOS_REPORTE} fotos.`)
const CABECERA = {
  fecha: z.iso.date('Elige el día del reporte.'),
  asunto: z.string().min(3, 'Escribe el asunto del reporte.').max(120, 'El asunto pasa de 120 caracteres.'),
  descripcion: z.string().min(3, 'Escribe una breve descripción del reporte.').max(1000, 'La descripción pasa de 1000 caracteres.'),
}

/**
 * Lo de un código: sus trabajos y su gente. Con personal general, la gente va
 * una vez para todo el código y los trabajos sin la suya; si no, cada trabajo
 * con la suya. El subcontratista no está en el personal: un código con solo
 * subcontratos va sin gente.
 */
function sinGente(d: { trabajos: Trabajo[]; general: boolean; personal_general: unknown[] }) {
  const personas = d.general ? d.personal_general.length : d.trabajos.reduce((n, t) => n + t.personal.length, 0)
  return personas === 0 && !d.trabajos.every((t) => t.sobre === 'SUBCONTRATO')
}

/**
 * El supervisor corrige un reporte observado (`reemplaza`): el observado se
 * anula y este entra en su lugar. Mismo permiso que `registrar_reporte_corregido`
 * (`reporte_diario.registrar`); la base vuelve a revisar todo y es la que pasa
 * las horas al costeo y avisa a Gerencia y a RR. HH. que lo validen. El reporte
 * nuevo del día, con uno o varios códigos, entra por `registrarReportesDiarios`.
 */
export async function registrarReporteCorregido(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<{ id: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'reporte_diario.registrar')) return { ok: false, error: 'El reporte diario lo suben los supervisores.' }

  const analisis = z
    .object({
      id: z.guid(),
      reemplaza: z.guid('Vuelve a abrir el reporte que corriges.'),
      ...CABECERA,
      codigo_interno: CODIGO_INTERNO,
      trabajos: TRABAJOS,
      general: z.boolean(),
      personal_general: z.array(PERSONA).max(60, 'El personal general lleva hasta 60 personas.'),
      fotos: FOTOS,
    })
    .safeParse({
      id: dato(formulario, 'id'),
      reemplaza: dato(formulario, 'reemplaza'),
      fecha: dato(formulario, 'fecha'),
      codigo_interno: dato(formulario, 'codigo_interno'),
      asunto: dato(formulario, 'asunto'),
      descripcion: dato(formulario, 'descripcion'),
      trabajos: json(formulario, 'trabajos'),
      general: dato(formulario, 'personal_general') === 'si',
      personal_general: json(formulario, 'personal') ?? [],
      fotos: json(formulario, 'fotos') ?? [],
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el reporte.' }
  const d = analisis.data
  if (sinGente(d)) return { ok: false, error: 'Pon al menos a una persona con sus horas: de ahí sale el costeo.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_reporte_corregido', {
    p_reemplaza: d.reemplaza,
    p_id: d.id,
    p_fecha: d.fecha,
    p_codigo_interno: d.codigo_interno,
    p_asunto: d.asunto,
    p_descripcion: d.descripcion,
    p_trabajos: d.trabajos.map((t) => trabajoParaLaBase(t, d.general)),
    p_personal_general: d.general ? d.personal_general : [],
    p_fotos: d.fotos,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'El reporte no quedó subido. Recarga la pantalla.' }

  revalidatePath('/reportes-diarios')
  revalidatePath(`/reportes-diarios/${d.reemplaza}`)
  revalidatePath('/rrhh/costeo')
  return {
    ok: true,
    mensaje: 'Reporte subido: Gerencia y Recursos Humanos lo validan.',
    datos: { id: d.id },
  }
}

/**
 * El reporte del día con uno o varios códigos internos: asunto y descripción
 * comunes, y en cada código sus trabajos, su gente y sus fotos. La base guarda
 * un reporte por código, todos o ninguno (`registrar_reportes_diarios`), porque
 * de cada reporte salen las horas que van al costeo de su código. Mismo permiso
 * que la función (`reporte_diario.registrar`). Devuelve el primero: su detalle
 * muestra los demás del mismo envío.
 */
export async function registrarReportesDiarios(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<{ id: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'reporte_diario.registrar')) return { ok: false, error: 'El reporte diario lo suben los supervisores.' }

  const analisis = z
    .object({
      ...CABECERA,
      codigos: z
        .array(
          z.object({
            id: z.guid('Vuelve a abrir el formulario del reporte.'),
            codigo_interno: CODIGO_INTERNO,
            trabajos: TRABAJOS,
            general: z.boolean(),
            personal_general: z.array(PERSONA).max(60, 'El personal general lleva hasta 60 personas.'),
            fotos: FOTOS,
          }),
          'Agrega al menos un código interno con su trabajo.',
        )
        .min(1, 'Agrega al menos un código interno con su trabajo.')
        .max(MAXIMO_CODIGOS_REPORTE, `Un reporte lleva hasta ${MAXIMO_CODIGOS_REPORTE} códigos internos.`),
    })
    .safeParse({
      fecha: dato(formulario, 'fecha'),
      asunto: dato(formulario, 'asunto'),
      descripcion: dato(formulario, 'descripcion'),
      codigos: json(formulario, 'codigos'),
    })
  if (!analisis.success) {
    const problema = analisis.error.issues[0]
    // Con varios códigos, el aviso dice en cuál está lo que hay que corregir.
    const n = problema?.path[0] === 'codigos' && typeof problema.path[1] === 'number' ? problema.path[1] + 1 : null
    const lista = json(formulario, 'codigos')
    const varios = Array.isArray(lista) && lista.length > 1
    return { ok: false, error: `${varios && n ? `En el código ${n}: ` : ''}${problema?.message ?? 'Revisa el reporte.'}` }
  }
  const d = analisis.data
  const vacio = d.codigos.findIndex(sinGente)
  if (vacio >= 0) {
    const varios = d.codigos.length > 1
    return {
      ok: false,
      error: `${varios ? `En ${d.codigos[vacio].codigo_interno.toUpperCase()}: p` : 'P'}on al menos a una persona con sus horas: de ahí sale el costeo.`,
    }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_reportes_diarios', {
    p_fecha: d.fecha,
    p_asunto: d.asunto,
    p_descripcion: d.descripcion,
    p_codigos: d.codigos.map((c) => ({
      id: c.id,
      codigo_interno: c.codigo_interno,
      trabajos: c.trabajos.map((t) => trabajoParaLaBase(t, c.general)),
      personal_general: c.general ? c.personal_general : [],
      fotos: c.fotos,
    })),
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  // La base devuelve los mismos ids, en orden: si no, no entró lo que se mandó.
  if (!Array.isArray(data) || data.length !== d.codigos.length || data.some((id, i) => id !== d.codigos[i].id)) {
    return { ok: false, error: 'El reporte no quedó subido. Recarga la pantalla.' }
  }

  revalidatePath('/reportes-diarios')
  revalidatePath('/rrhh/costeo')
  revalidatePath('/subcontratos/area')
  return {
    ok: true,
    mensaje:
      d.codigos.length === 1
        ? 'Reporte subido: Gerencia y Recursos Humanos lo validan.'
        : `Reporte subido con ${d.codigos.length} códigos: Gerencia y Recursos Humanos validan cada uno.`,
    datos: { id: d.codigos[0].id },
  }
}

const LADO = z.enum(['GERENCIA', 'RRHH'], 'Vuelve a cargar la pantalla.')
const PERMISO_DEL_LADO = { GERENCIA: 'reporte_diario.validar_gerencia', RRHH: 'reporte_diario.validar_rrhh' } as const
/** El visto de RR. HH. lo da RR. HH.: el administrador no entra por su atajo (migración 20261020167000). */
const daElVisto = (perfil: Parameters<typeof puede>[0], lado: keyof typeof PERMISO_DEL_LADO) =>
  lado === 'RRHH' ? editaComoRrhh(perfil, PERMISO_DEL_LADO.RRHH) : puede(perfil, PERMISO_DEL_LADO.GERENCIA)

/**
 * El visto bueno de Gerencia o de RR. HH. Cada lado con su permiso, el mismo
 * que exige `validar_reporte_diario`. Con los dos, el reporte entra a la
 * planilla diaria.
 */
export async function validarReporteDiario(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  const analisis = z.object({ id: z.guid(), lado: LADO }).safeParse({ id: dato(formulario, 'id'), lado: dato(formulario, 'lado') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }
  const { id, lado } = analisis.data
  if (!daElVisto(perfil, lado)) return { ok: false, error: `El visto de ${lado === 'GERENCIA' ? 'Gerencia' : 'Recursos Humanos'} lo da esa área.` }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('validar_reporte_diario', { p_id: id, p_lado: lado })
  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/reportes-diarios')
  revalidatePath(`/reportes-diarios/${id}`)
  revalidatePath('/planilla-diaria')
  revalidatePath('/rrhh/horas-extras')
  return {
    ok: true,
    mensaje: data === 'VALIDADO' ? 'Validado por las dos áreas: sus horas pasan a la planilla diaria.' : 'Visto bueno registrado.',
  }
}

/** Observar un reporte: vuelve al supervisor con el motivo. Mismo permiso por lado que `observar_reporte_diario`. */
export async function observarReporteDiario(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  const analisis = z
    .object({
      id: z.guid(),
      lado: LADO,
      motivo: z.string().min(10, 'Cuenta qué tiene que corregir el supervisor, en al menos 10 caracteres.').max(500, 'La observación pasa de 500 caracteres.'),
    })
    .safeParse({ id: dato(formulario, 'id'), lado: dato(formulario, 'lado'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }
  const { id, lado, motivo } = analisis.data
  if (!daElVisto(perfil, lado)) return { ok: false, error: `Como ${lado === 'GERENCIA' ? 'Gerencia' : 'Recursos Humanos'} observa esa área.` }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('observar_reporte_diario', { p_id: id, p_lado: lado, p_motivo: motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== id) return { ok: false, error: 'La observación no quedó. Recarga la pantalla.' }

  revalidatePath('/reportes-diarios')
  revalidatePath(`/reportes-diarios/${id}`)
  return { ok: true, mensaje: 'Observado: el supervisor recibe el aviso para corregirlo y subirlo de nuevo.' }
}

/**
 * Anular un reporte con su motivo: sus horas salen del costeo. Lo puede quien
 * lo subió (dentro de 7 días) y RR. HH.; la base lo vuelve a exigir.
 */
export async function anularReporteDiario(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['reporte_diario.registrar', 'rrhh.personal'])) {
    return { ok: false, error: 'Solo quien subió el reporte o Recursos Humanos lo pueden anular.' }
  }

  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_reporte_diario', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'El reporte no se anuló. Recarga la pantalla.' }

  revalidatePath('/reportes-diarios')
  revalidatePath(`/reportes-diarios/${analisis.data.id}`)
  revalidatePath('/rrhh/costeo')
  return { ok: true, mensaje: 'Reporte anulado. Sus horas salieron del costeo.' }
}
