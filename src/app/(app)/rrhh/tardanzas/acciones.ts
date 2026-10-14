'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * RR. HH. ajusta la tolerancia, cada cuántas tardanzas del mes se descuenta y
 * qué porcentaje del sueldo. Mismo permiso que `rrhh_guardar_regla_tardanza`.
 */
export async function guardarReglaTardanza(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'rrhh.personal')) return { ok: false, error: 'La regla de tardanza la ajusta Recursos Humanos.' }

  const analisis = z
    .object({
      tolerancia_minutos: z.coerce.number().int('La tolerancia va en minutos enteros.').min(0).max(120, 'La tolerancia va de 0 a 120 minutos.'),
      tardanzas_por_descuento: z.coerce
        .number()
        .int('Las tardanzas van en números enteros.')
        .min(1, 'Las tardanzas que hacen un descuento van de 1 a 31.')
        .max(31, 'Las tardanzas que hacen un descuento van de 1 a 31.'),
      porcentaje_descuento: z.coerce.number().min(0, 'El porcentaje va de 0 % a 100 %.').max(100, 'El porcentaje va de 0 % a 100 %.'),
    })
    .safeParse({
      tolerancia_minutos: formulario.get('tolerancia_minutos'),
      tardanzas_por_descuento: formulario.get('tardanzas_por_descuento'),
      porcentaje_descuento: String(formulario.get('porcentaje_descuento') ?? '').replace(',', '.'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la regla.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('rrhh_guardar_regla_tardanza', {
    p_tolerancia_minutos: analisis.data.tolerancia_minutos,
    p_tardanzas_por_descuento: analisis.data.tardanzas_por_descuento,
    p_porcentaje_descuento: analisis.data.porcentaje_descuento,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/rrhh/tardanzas')
  return {
    ok: true,
    mensaje: 'Regla guardada. La tolerancia vale para las marcas desde ahora; el descuento de cada mes se calcula con la regla nueva.',
  }
}
