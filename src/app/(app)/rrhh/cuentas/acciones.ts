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
 * Recursos Humanos pone el DNI de una cuenta. Mismo permiso que las políticas
 * de `usuario_datos_reservados` (migración 20261020165000): `rrhh.personal`,
 * sin el atajo del administrador. El costo por hora no se toca: ya no se pide
 * (DKS, 2026-10-26) y la fila guarda el que tenía.
 */
export async function guardarDatosDeCuenta(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!cambiaDatosReservados(perfil)) return { ok: false, error: 'No tienes permiso para cambiar el DNI de una cuenta.' }

  const analisis = z
    .object({
      usuario_id: z.guid(),
      // Sin `^\d{8}$`: aquí también entran carnés de extranjería, que llevan letras.
      documento: z.string().max(20, 'El documento pasa de 20 caracteres.'),
    })
    .safeParse({
      usuario_id: dato(formulario, 'usuario_id'),
      documento: dato(formulario, 'documento').replace(/\s/g, ''),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  const d = analisis.data

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('usuario_datos_reservados')
    .upsert({ usuario_id: d.usuario_id, documento: d.documento || null }, { onConflict: 'usuario_id' })
    .select('usuario_id')
    .maybeSingle()
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (!data) return { ok: false, error: 'No se guardó: no tienes permiso para cambiar el DNI de esta cuenta.' }

  revalidatePath('/rrhh/cuentas')
  revalidatePath('/personal')
  return { ok: true, mensaje: 'Guardado.' }
}
