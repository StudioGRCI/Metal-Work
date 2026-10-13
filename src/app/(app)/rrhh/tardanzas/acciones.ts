'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/** RR. HH. ajusta la tolerancia y el descuento por minuto. Mismo permiso que `rrhh_guardar_regla_tardanza`. */
export async function guardarReglaTardanza(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'rrhh.personal')) return { ok: false, error: 'La regla de tardanza la ajusta Recursos Humanos.' }

  const analisis = z
    .object({
      tolerancia_minutos: z.coerce.number().int('La tolerancia va en minutos enteros.').min(0).max(120, 'La tolerancia va de 0 a 120 minutos.'),
      descuento_por_minuto: z.coerce.number().min(0).max(100, 'El descuento por minuto va de S/ 0 a S/ 100.'),
    })
    .safeParse({
      tolerancia_minutos: formulario.get('tolerancia_minutos'),
      descuento_por_minuto: formulario.get('descuento_por_minuto'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la regla.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('rrhh_guardar_regla_tardanza', {
    p_tolerancia_minutos: analisis.data.tolerancia_minutos,
    p_descuento_por_minuto: analisis.data.descuento_por_minuto,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/rrhh/tardanzas')
  return { ok: true, mensaje: 'Regla guardada. Vale para las marcas desde ahora; las anteriores no cambian.' }
}
