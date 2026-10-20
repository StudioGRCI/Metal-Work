'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { cambiaDatosReservados, exigirSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

/**
 * Recursos Humanos pone el DNI y el costo por hora de una cuenta. Mismo permiso
 * que las políticas de `usuario_datos_reservados` (migración 20261020165000):
 * `rrhh.personal`, sin el atajo del administrador.
 */
export async function guardarDatosDeCuenta(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!cambiaDatosReservados(perfil)) return { ok: false, error: 'El DNI y el costo por hora los cambia Recursos Humanos.' }

  const analisis = z
    .object({
      usuario_id: z.guid(),
      // Sin `^\d{8}$`: aquí también entran carnés de extranjería, que llevan letras.
      documento: z.string().max(20, 'El documento pasa de 20 caracteres.'),
      costo_hora: z.coerce.number('Escribe el costo por hora en soles.').min(0, 'El costo por hora no puede ser negativo.').max(9999, 'Revisa el costo por hora.'),
    })
    .safeParse({
      usuario_id: dato(formulario, 'usuario_id'),
      documento: dato(formulario, 'documento').replace(/\s/g, ''),
      costo_hora: dato(formulario, 'costo_hora') || '0',
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('usuario_datos_reservados')
    .upsert({ usuario_id: d.usuario_id, documento: d.documento || null, costo_hora: d.costo_hora }, { onConflict: 'usuario_id' })
    .select('usuario_id')
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No se guardó: no tienes permiso para cambiar el DNI ni el costo de esta cuenta.' }

  revalidatePath('/rrhh/cuentas')
  revalidatePath('/personal')
  return { ok: true, mensaje: 'Guardado.' }
}
