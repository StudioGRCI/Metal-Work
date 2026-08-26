'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const esquema = z.object({
  orden_id: z.string().uuid(),
  etapa_id: z.string().uuid().optional().or(z.literal('')),
  fecha: z.string().trim().min(1, 'Falta la fecha'),
  descripcion: z.string().trim().min(5, 'Cuenta qué se hizo hoy en la unidad'),
  avance_porcentaje: z.string().trim().optional(),
  impedimento: z.string().trim().optional(),
  // Las fotos ya están en Storage: acá viajan solo sus rutas, en JSON.
  fotos: z.string().optional(),
})

const esquemaFotos = z.array(
  z.object({
    ruta_storage: z.string().min(1),
    nombre_archivo: z.string().min(1),
    mime_type: z.string().optional(),
    tamano_bytes: z.number().int().positive().optional(),
  }),
)

function nulo(valor?: string | null) {
  const t = valor?.trim()
  return t ? t : null
}

/**
 * Registra el avance del día en una unidad. Las fotos ya viajaron del navegador
 * a Storage; acá solo se guardan sus rutas.
 */
export async function registrarAvance(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'produccion.registrar')) {
    return { ok: false, error: 'No tienes permiso para registrar el avance del taller.' }
  }

  const analisis = esquema.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos del avance.' }
  }

  const v = analisis.data
  const porcentaje = v.avance_porcentaje?.trim() ? Number(v.avance_porcentaje) : null
  if (porcentaje !== null && (Number.isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100)) {
    return { ok: false, error: 'El avance de la etapa va de 0 a 100.' }
  }
  if (porcentaje !== null && !nulo(v.etapa_id)) {
    return { ok: false, error: 'Para mover el avance hay que decir de qué etapa se trata.' }
  }

  const supabase = await createClient()

  const { data: avance, error } = await supabase
    .from('ot_avances')
    .insert({
      orden_id: v.orden_id,
      etapa_id: nulo(v.etapa_id),
      fecha: v.fecha,
      descripcion: v.descripcion,
      avance_porcentaje: porcentaje,
      impedimento: nulo(v.impedimento),
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: mensajeDeError(error) }

  if (v.fotos) {
    let fotos: z.infer<typeof esquemaFotos> = []
    try {
      fotos = esquemaFotos.parse(JSON.parse(v.fotos))
    } catch {
      return { ok: true, mensaje: 'Avance registrado, pero las fotos no se pudieron adjuntar.' }
    }

    if (fotos.length > 0) {
      const { error: errorFotos } = await supabase.from('ot_avance_fotos').insert(
        fotos.map((f, i) => ({
          avance_id: avance.id,
          bucket: 'fotos-avance',
          ruta_storage: f.ruta_storage,
          nombre_archivo: f.nombre_archivo,
          mime_type: f.mime_type ?? null,
          tamano_bytes: f.tamano_bytes ?? null,
          orden_visual: i + 1,
        })),
      )

      if (errorFotos) {
        // El avance quedó registrado: se avisa lo que faltó, no se pierde el
        // trabajo de quien ya escribió.
        return {
          ok: true,
          mensaje: `Avance registrado, pero las fotos no se adjuntaron: ${mensajeDeError(errorFotos)}`,
        }
      }
    }
  }

  revalidatePath('/avance')
  revalidatePath(`/avance/${v.orden_id}`)
  revalidatePath(`/ordenes/${v.orden_id}`)
  revalidatePath('/produccion')
  return { ok: true, mensaje: 'Avance registrado.' }
}

/** URL temporal para ver una foto del avance. */
export async function urlDeFoto(
  ruta: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['produccion.ver', 'documentos.ver'])) {
    return { ok: false, error: 'No tienes permiso para ver las fotos del taller.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase.storage.from('fotos-avance').createSignedUrl(ruta, 600)

  if (error || !data) return { ok: false, error: 'No se pudo abrir la foto.' }
  return { ok: true, url: data.signedUrl }
}
