'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { MOTIVOS_DE_ATRASO } from '@/lib/dominio/plazos'
import { compraComoLogistica, exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * El seguimiento de una compra atrasada (Plan 4.2, migración 20261126462000):
 * por qué se atrasó y la fecha nueva que prometió el proveedor. Lo anota quien
 * emite las compras (`compras.crear`, el mismo permiso que exigen las dos
 * funciones). La OC y la OS no cambian: cada anotación es una fila nueva.
 */

const SIN_PERMISO = 'El motivo del atraso y la fecha prometida los anota quien emite las compras.'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor : ''
}

function refrescar() {
  revalidatePath('/compras/ordenes')
  revalidatePath('/compras/servicios')
}

const comun = {
  id: z.guid(),
  tipo: z.enum(['OC', 'OS']),
  documento: z.guid(),
  motivo: z.enum(MOTIVOS_DE_ATRASO, { message: 'Elige el motivo: proveedor, pago, transporte, aprobación u otro.' }),
  nota: z.string().trim().max(500, 'La nota pasa de 500 caracteres.'),
}

function conNota<T extends { motivo: string; nota: string }>(d: T) {
  return d.motivo === 'OTRO' && d.nota.length < 10 ? 'Con «Otro», cuenta qué pasó en al menos 10 caracteres.' : null
}

export async function anotarMotivoAtraso(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: SIN_PERMISO }

  const analisis = z.object(comun).safeParse({
    id: dato(formulario, 'id'),
    tipo: dato(formulario, 'tipo'),
    documento: dato(formulario, 'documento'),
    motivo: dato(formulario, 'motivo'),
    nota: dato(formulario, 'nota'),
  })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el motivo.' }
  const d = analisis.data
  // Administración sigue solo las OC de su RQA; la base mira además de dónde nace la OC.
  if (d.tipo === 'OS' && !compraComoLogistica(perfil)) return { ok: false, error: SIN_PERMISO }
  const falta = conNota(d)
  if (falta) return { ok: false, error: falta }

  const supabase = await createClient()
  const { error } = await supabase.rpc('anotar_motivo_atraso', {
    p_id: d.id,
    p_tipo: d.tipo,
    p_documento: d.documento,
    p_motivo: d.motivo,
    p_nota: d.nota,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  refrescar()
  return { ok: true, mensaje: 'Motivo del atraso anotado.' }
}

export async function corregirFechaPrometida(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.crear')) return { ok: false, error: SIN_PERMISO }

  const analisis = z
    .object({ ...comun, fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elige la fecha nueva que prometió el proveedor.') })
    .safeParse({
      id: dato(formulario, 'id'),
      tipo: dato(formulario, 'tipo'),
      documento: dato(formulario, 'documento'),
      motivo: dato(formulario, 'motivo'),
      nota: dato(formulario, 'nota'),
      fecha: dato(formulario, 'fecha'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la fecha.' }
  const d = analisis.data
  // Administración sigue solo las OC de su RQA; la base mira además de dónde nace la OC.
  if (d.tipo === 'OS' && !compraComoLogistica(perfil)) return { ok: false, error: SIN_PERMISO }
  const falta = conNota(d)
  if (falta) return { ok: false, error: falta }

  const supabase = await createClient()
  const { error } = await supabase.rpc('corregir_fecha_esperada', {
    p_id: d.id,
    p_tipo: d.tipo,
    p_documento: d.documento,
    p_fecha: d.fecha,
    p_motivo: d.motivo,
    p_nota: d.nota,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  refrescar()
  return { ok: true, mensaje: 'Fecha prometida corregida. La anterior queda en el recorrido.' }
}
