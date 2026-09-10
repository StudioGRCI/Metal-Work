'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * El catálogo lo mantiene Diseño, que es quien lo usa: el permiso es
 * `diseno.planos`, el mismo que exige la política de `materiales` desde que el
 * almacén se fue. Si acá se pidiera otro, el UPDATE afectaría cero filas sin
 * error y la pantalla diría «guardado» sin haber guardado.
 */
const esquema = z.object({
  id: z.string().uuid().optional().or(z.literal('')),
  codigo: z.string().trim().max(30).optional(),
  descripcion: z.string().trim().min(3, 'Escribe cómo se llama el material'),
  especificacion_tecnica: z.string().trim().max(300).optional(),
  categoria_id: z.string().uuid('Elige la categoría'),
  unidad_medida_id: z.string().uuid('Elige la unidad'),
})

const nulo = (v: string | undefined) => (v && v.trim().length > 0 ? v.trim() : null)

export async function guardarMaterial(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.planos')) {
    return { ok: false, error: 'El catálogo de materiales lo mantiene Diseño.' }
  }

  const analisis = esquema.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  if (v.id) {
    const { data, error } = await supabase
      .from('materiales')
      .update({
        codigo: nulo(v.codigo) ?? undefined,
        descripcion: v.descripcion,
        especificacion_tecnica: nulo(v.especificacion_tecnica),
        categoria_id: v.categoria_id,
        unidad_medida_id: v.unidad_medida_id,
      })
      .eq('id', v.id)
      .select('id')
      .maybeSingle()

    if (error) return { ok: false, error: traducir(error) }
    if (!data) return { ok: false, error: NO_TOCO_NADA }

    revalidatePath('/materiales')
    return { ok: true, mensaje: 'Material corregido.' }
  }

  // Sin código escrito, uno correlativo: el código existe porque la tabla lo
  // exige único, no porque Diseño lo vaya a usar.
  const codigo = nulo(v.codigo) ?? (await siguienteCodigo())

  const { data, error } = await supabase
    .from('materiales')
    .insert({
      codigo,
      descripcion: v.descripcion,
      especificacion_tecnica: nulo(v.especificacion_tecnica),
      categoria_id: v.categoria_id,
      unidad_medida_id: v.unidad_medida_id,
      creado_por: perfil.id,
    })
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: traducir(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/materiales')
  return { ok: true, mensaje: 'Material agregado al catálogo.' }
}

async function siguienteCodigo() {
  const supabase = await createClient()
  const { count } = await supabase.from('materiales').select('id', { count: 'exact', head: true })
  return `MAT-${String((count ?? 0) + 1).padStart(4, '0')}`
}

function traducir(error: { message: string; code?: string }) {
  if (error.code === '23505') return 'Ya hay un material con ese código.'
  return mensajeDeError(error)
}

const esquemaEstado = z.object({ id: z.string().uuid(), activo: z.enum(['1', '0']) })

/** Un material no se borra: se retira del catálogo, y lo que ya lo usa sigue entero. */
export async function cambiarEstadoMaterial(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'diseno.planos')) {
    return { ok: false, error: 'El catálogo de materiales lo mantiene Diseño.' }
  }

  const analisis = esquemaEstado.safeParse(Object.fromEntries(datos))
  if (!analisis.success) return { ok: false, error: 'No se pudo identificar el material.' }

  const v = analisis.data
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('materiales')
    .update({ activo: v.activo === '1' })
    .eq('id', v.id)
    .select('id')
    .maybeSingle()

  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/materiales')
  return { ok: true, mensaje: v.activo === '1' ? 'Material de vuelta en el catálogo.' : 'Material retirado del catálogo.' }
}
