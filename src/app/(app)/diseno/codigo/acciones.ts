'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { BUCKET_PLANOS_CODIGO, MAXIMO_MB_PLANO, rutaPlanoCodigo } from '@/lib/dominio/diseno-codigos'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Lo que Diseño escribe por código interno y lo que el supervisor marca. Cada
 * acción exige el mismo permiso que la función de la base a la que llama
 * (migración 20261015200000): `diseno.codigos` para cargar, `codigos_internos.area`
 * para recibir un plano, cualquiera de los dos para marcar una etapa. Las
 * tablas no se escriben directo: no hay UPDATE que el RLS pueda dejar en cero.
 */

/** Diseño, el supervisor y Gerencia leen lo mismo: se repintan juntos. */
function repintar() {
  for (const ruta of ['/diseno/codigo', '/diseno/planos', '/diseno/materiales', '/diseno/etapas', '/planos', '/codigos-internos', '/codigos-internos/detalle']) {
    revalidatePath(ruta)
  }
}

const SOLO_DISENO = 'Esto lo carga Diseño e Ingeniería.'
const NO_SE_RECONOCE = 'No se reconoció el registro. Vuelve a cargar la pantalla.'

const texto = (max: number) => z.string().trim().max(max)
const opcional = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : v)

/** «4,5» y «4.5» son lo mismo: en el teclado del teléfono sale la coma. */
const CANTIDAD = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().replace(/\s/g, '').replace(',', '.') : v),
  z.coerce.number().positive().max(999999),
)

/**
 * El PDF ya subió al almacenamiento con la sesión de quien lo carga: se
 * comprueba que de verdad sea un PDF antes de registrarlo. La base vuelve a
 * mirar que sea suyo, de tipo PDF y de hasta 20 MB.
 */
async function pdfSubido(ruta: string): Promise<string | null> {
  const supabase = await createClient()
  const { data: archivo, error } = await supabase.storage.from(BUCKET_PLANOS_CODIGO).download(ruta)
  if (error || !archivo) return 'No se pudo comprobar el PDF cargado. Revisa la conexión y vuelve a intentar.'
  if (archivo.size < 1 || archivo.size > MAXIMO_MB_PLANO * 1024 * 1024 || (await archivo.slice(0, 5).text()) !== '%PDF-') {
    return `El plano tiene que ser un PDF de hasta ${MAXIMO_MB_PLANO} MB.`
  }
  return null
}

const PLANO_NUEVO = z.object({
  plano: z.guid(),
  revision: z.guid(),
  codigo: texto(60).min(2),
  numero: texto(20).min(1),
  nombre: texto(200).min(2),
  area: z.guid(),
  observacion: texto(1000).nullable(),
  nombre_archivo: texto(200).min(1),
})

/** Cargar un plano nuevo de un código, con su área y su primer PDF (R1). */
export async function registrarPlano(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.codigos')) return { ok: false, error: SOLO_DISENO }
  const datos = PLANO_NUEVO.safeParse({
    plano: formulario.get('plano'),
    revision: formulario.get('revision'),
    codigo: formulario.get('codigo'),
    numero: formulario.get('numero'),
    nombre: formulario.get('nombre'),
    area: formulario.get('area'),
    observacion: opcional(formulario.get('observacion')),
    nombre_archivo: formulario.get('nombre_archivo'),
  })
  if (!datos.success) {
    const campo = datos.error.issues[0]?.path[0]
    return {
      ok: false,
      error:
        campo === 'numero'
          ? 'Escribe el número del plano como figura en él: 001, 2A, ENS.'
          : campo === 'nombre'
            ? 'Escribe el nombre del plano, por ejemplo ESTRUCTURA CAJÓN.'
            : campo === 'area'
              ? 'Elige a qué área de producción va el plano.'
              : campo === 'observacion'
                ? 'La observación pasa de 1000 caracteres.'
                : campo === 'nombre_archivo'
                  ? 'Elige el PDF del plano.'
                  : NO_SE_RECONOCE,
    }
  }
  const malPdf = await pdfSubido(rutaPlanoCodigo(datos.data.plano, datos.data.revision))
  if (malPdf) return { ok: false, error: malPdf }

  const supabase = await createClient()
  const { error } = await supabase.rpc('registrar_plano_codigo', {
    p_plano: datos.data.plano,
    p_revision: datos.data.revision,
    p_codigo: datos.data.codigo,
    p_numero: datos.data.numero,
    p_nombre: datos.data.nombre,
    p_area: datos.data.area,
    p_observacion: datos.data.observacion ?? '',
    p_nombre_archivo: datos.data.nombre_archivo,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  repintar()
  return { ok: true, mensaje: `Plano ${datos.data.numero.toUpperCase()} cargado. Al supervisor del área le llegó el aviso.` }
}

const REVISION = z.object({
  plano: z.guid(),
  revision: z.guid(),
  cambios: texto(1000).min(5),
  nombre_archivo: texto(200).min(1),
})

/** Subirle a un plano su revisión corregida (R2, R3…), diciendo qué cambió. */
export async function subirRevision(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.codigos')) return { ok: false, error: SOLO_DISENO }
  const datos = REVISION.safeParse({
    plano: formulario.get('plano'),
    revision: formulario.get('revision'),
    cambios: formulario.get('cambios'),
    nombre_archivo: formulario.get('nombre_archivo'),
  })
  if (!datos.success) {
    const campo = datos.error.issues[0]?.path[0]
    return {
      ok: false,
      error: campo === 'cambios' ? 'Escribe qué cambió en esta revisión.' : campo === 'nombre_archivo' ? 'Elige el PDF corregido.' : NO_SE_RECONOCE,
    }
  }
  const malPdf = await pdfSubido(rutaPlanoCodigo(datos.data.plano, datos.data.revision))
  if (malPdf) return { ok: false, error: malPdf }

  const supabase = await createClient()
  const { error } = await supabase.rpc('subir_revision_plano', {
    p_plano: datos.data.plano,
    p_revision: datos.data.revision,
    p_cambios: datos.data.cambios,
    p_nombre_archivo: datos.data.nombre_archivo,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  repintar()
  return { ok: true, mensaje: 'Revisión cargada. El supervisor del área tiene que marcarla recibida.' }
}

/** Anular un plano mal cargado o que ya no va, con su motivo. Queda como evidencia. */
export async function anularPlano(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.codigos')) return { ok: false, error: SOLO_DISENO }
  const datos = z.object({ plano: z.guid(), motivo: texto(500).min(5) }).safeParse({
    plano: formulario.get('plano'),
    motivo: formulario.get('motivo'),
  })
  if (!datos.success) {
    return { ok: false, error: datos.error.issues[0]?.path[0] === 'motivo' ? 'Escribe por qué se anula el plano.' : NO_SE_RECONOCE }
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('anular_plano_codigo', { p_plano: datos.data.plano, p_motivo: datos.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  repintar()
  return { ok: true, mensaje: 'Plano anulado. Al supervisor del área le llegó el aviso.' }
}

/** El supervisor marca que recibió la revisión vigente de un plano de su área. */
export async function recibirPlano(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'codigos_internos.area')) return { ok: false, error: 'El plano lo recibe el supervisor del área a la que va.' }
  const revision = z.guid().safeParse(formulario.get('revision'))
  if (!revision.success) return { ok: false, error: NO_SE_RECONOCE }
  const supabase = await createClient()
  const { error } = await supabase.rpc('recibir_plano_codigo', { p_revision: revision.data })
  if (error) return { ok: false, error: mensajeDeError(error) }
  repintar()
  return { ok: true, mensaje: 'Recibido. Diseño se entera.' }
}

const MATERIAL = z.object({
  id: z.guid().nullable(),
  codigo: texto(60).nullable(),
  material: z.guid(),
  cantidad: CANTIDAD,
  plano: z.guid().nullable(),
  observacion: texto(500).nullable(),
})

/** Agregar una línea a la lista de materiales del código, o corregirla. */
export async function guardarMaterial(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.codigos')) return { ok: false, error: SOLO_DISENO }
  const datos = MATERIAL.safeParse({
    id: opcional(formulario.get('id')),
    codigo: opcional(formulario.get('codigo')),
    material: formulario.get('material'),
    cantidad: formulario.get('cantidad'),
    plano: opcional(formulario.get('plano')),
    observacion: opcional(formulario.get('observacion')),
  })
  if (!datos.success) {
    const campo = datos.error.issues[0]?.path[0]
    return {
      ok: false,
      error:
        campo === 'material'
          ? 'Elige el material del catálogo.'
          : campo === 'cantidad'
            ? 'Escribe la cantidad, más de cero: por ejemplo 12 o 4,5.'
            : campo === 'observacion'
              ? 'La observación pasa de 500 caracteres.'
              : NO_SE_RECONOCE,
    }
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('guardar_material_codigo', {
    p_id: datos.data.id as string,
    p_codigo: datos.data.codigo ?? '',
    p_material: datos.data.material,
    p_cantidad: datos.data.cantidad,
    p_plano: datos.data.plano as string,
    p_observacion: datos.data.observacion ?? '',
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  repintar()
  return { ok: true, mensaje: datos.data.id ? 'Línea corregida.' : 'Material agregado a la lista.' }
}

/** Quitar una línea de la lista. Queda en el historial. */
export async function quitarMaterial(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.codigos')) return { ok: false, error: SOLO_DISENO }
  const id = z.guid().safeParse(formulario.get('id'))
  if (!id.success) return { ok: false, error: NO_SE_RECONOCE }
  const supabase = await createClient()
  const { error } = await supabase.rpc('quitar_material_codigo', { p_id: id.data })
  if (error) return { ok: false, error: mensajeDeError(error) }
  repintar()
  return { ok: true, mensaje: 'Línea quitada de la lista.' }
}

/** Las seis etapas de siempre, para un código que todavía no tiene ninguna. */
export async function cargarEtapasDeSiempre(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.codigos')) return { ok: false, error: SOLO_DISENO }
  const codigo = texto(60).min(2).safeParse(formulario.get('codigo'))
  if (!codigo.success) return { ok: false, error: NO_SE_RECONOCE }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('etapas_de_siempre_codigo', { p_codigo: codigo.data })
  if (error) return { ok: false, error: mensajeDeError(error) }
  repintar()
  return { ok: true, mensaje: `${data ?? 6} etapas cargadas. Ponles sus fechas.` }
}

const FECHA = z.preprocess((v) => (v === '' || v === null ? null : v), z.iso.date().nullable())

const ETAPA = z.object({
  id: z.guid().nullable(),
  codigo: texto(60).nullable(),
  nombre: texto(120).min(2),
  area: z.guid().nullable(),
  inicio_plan: FECHA,
  fin_plan: FECHA,
})

/** Agregar una etapa al código, o corregir su nombre, su área y sus fechas. */
export async function guardarEtapa(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.codigos')) return { ok: false, error: SOLO_DISENO }
  const datos = ETAPA.safeParse({
    id: opcional(formulario.get('id')),
    codigo: opcional(formulario.get('codigo')),
    nombre: formulario.get('nombre'),
    area: opcional(formulario.get('area')),
    inicio_plan: formulario.get('inicio_plan'),
    fin_plan: formulario.get('fin_plan'),
  })
  if (!datos.success) {
    const campo = datos.error.issues[0]?.path[0]
    return {
      ok: false,
      error:
        campo === 'nombre'
          ? 'Escribe el nombre de la etapa, por ejemplo Habilitado o Arenado y pintura.'
          : campo === 'inicio_plan' || campo === 'fin_plan'
            ? 'Revisa las fechas de la etapa.'
            : NO_SE_RECONOCE,
    }
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('guardar_etapa_codigo', {
    p_id: datos.data.id as string,
    p_codigo: datos.data.codigo ?? '',
    p_nombre: datos.data.nombre,
    p_area: datos.data.area as string,
    p_inicio_plan: datos.data.inicio_plan as string,
    p_fin_plan: datos.data.fin_plan as string,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  repintar()
  return { ok: true, mensaje: datos.data.id ? 'Etapa corregida.' : 'Etapa agregada al final.' }
}

/** Subir o bajar una etapa un lugar. */
export async function moverEtapa(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.codigos')) return { ok: false, error: SOLO_DISENO }
  const datos = z.object({ id: z.guid(), arriba: z.enum(['1', '0']) }).safeParse({ id: formulario.get('id'), arriba: formulario.get('arriba') })
  if (!datos.success) return { ok: false, error: NO_SE_RECONOCE }
  const supabase = await createClient()
  const { error } = await supabase.rpc('mover_etapa_codigo', { p_id: datos.data.id, p_arriba: datos.data.arriba === '1' })
  if (error) return { ok: false, error: mensajeDeError(error) }
  repintar()
  return { ok: true }
}

const MARCA = z.object({
  id: z.guid(),
  paso: z.enum(['INICIO', 'FIN', 'REABRIR']),
  fecha: FECHA,
  nota: texto(1000).nullable(),
})

/**
 * Marcar que una etapa empezó, terminó o se reabre. Lo hace Diseño, o el
 * supervisor del área de la etapa: la base comprueba el área.
 */
export async function marcarEtapa(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['diseno.codigos', 'codigos_internos.area'])) {
    return { ok: false, error: 'La etapa la marca Diseño o el supervisor del área que la hace.' }
  }
  const datos = MARCA.safeParse({
    id: formulario.get('id'),
    paso: formulario.get('paso'),
    fecha: formulario.get('fecha'),
    nota: opcional(formulario.get('nota')),
  })
  if (!datos.success) {
    const campo = datos.error.issues[0]?.path[0]
    return { ok: false, error: campo === 'fecha' ? 'Escribe la fecha.' : campo === 'nota' ? 'La nota pasa de 1000 caracteres.' : NO_SE_RECONOCE }
  }
  const supabase = await createClient()
  const { error } = await supabase.rpc('marcar_etapa_codigo', {
    p_id: datos.data.id,
    p_paso: datos.data.paso,
    p_fecha: datos.data.fecha as string,
    p_nota: datos.data.nota ?? '',
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  repintar()
  return {
    ok: true,
    mensaje: datos.data.paso === 'INICIO' ? 'Etapa empezada.' : datos.data.paso === 'FIN' ? 'Etapa terminada.' : 'Etapa reabierta.',
  }
}

/** Quitar una etapa que sobra. Queda en el historial. */
export async function quitarEtapa(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.codigos')) return { ok: false, error: SOLO_DISENO }
  const id = z.guid().safeParse(formulario.get('id'))
  if (!id.success) return { ok: false, error: NO_SE_RECONOCE }
  const supabase = await createClient()
  const { error } = await supabase.rpc('quitar_etapa_codigo', { p_id: id.data })
  if (error) return { ok: false, error: mensajeDeError(error) }
  repintar()
  return { ok: true, mensaje: 'Etapa quitada.' }
}
