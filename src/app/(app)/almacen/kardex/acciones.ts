'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor : ''
}

/**
 * Salida de almacén sin solicitud de OT: lo que el taller retira para una
 * unidad. La base exige el destino —vehículo registrado o código de la unidad—,
 * la foto y que haya saldo libre; aquí solo se filtra lo que ni siquiera tiene
 * forma de salida antes de tocarla.
 */
export async function registrarSalidaAlmacen(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.despachar')) return { ok: false, error: 'Solo Almacén registra salidas de material.' }

  const destino = dato(formulario, 'destino')
  const v = z.object({
    operacion_id: z.string().uuid(),
    material_id: z.string().uuid(),
    cantidad: z.coerce.number().positive().multipleOf(0.001),
    destino: z.enum(['UNIDAD', 'CODIGO']),
    unidad_id: z.string().uuid().optional(),
    codigo_unidad: z.string().trim().min(3).max(60).optional(),
    motivo: z.string().trim().min(3).max(200),
    recibido_por_nombre: z.string().trim().min(3).max(160),
    foto_ruta: z.string().min(40).max(200),
  }).safeParse({
    operacion_id: dato(formulario, 'operacion_id'),
    material_id: dato(formulario, 'material_id'),
    cantidad: dato(formulario, 'cantidad'),
    destino,
    unidad_id: destino === 'UNIDAD' ? dato(formulario, 'unidad_id') || undefined : undefined,
    codigo_unidad: destino === 'CODIGO' ? dato(formulario, 'codigo_unidad') || undefined : undefined,
    motivo: dato(formulario, 'motivo'),
    recibido_por_nombre: dato(formulario, 'recibido_por_nombre'),
    foto_ruta: dato(formulario, 'foto_ruta'),
  })
  if (!v.success) return { ok: false, error: 'Revisa material, cantidad, motivo y quién recibe.' }
  if (v.data.destino === 'UNIDAD' && !v.data.unidad_id) return { ok: false, error: 'Elige el vehículo que recibe el material.' }
  if (v.data.destino === 'CODIGO' && !v.data.codigo_unidad) return { ok: false, error: 'Escribe el código de la unidad (de 3 a 60 caracteres).' }

  const supabase = await createClient()
  // La foto ya está en el almacenamiento: se comprueba que de verdad sea una
  // imagen antes de dejarla como evidencia.
  const { data: objeto, error: lectura } = await supabase.storage.from('evidencias-almacen').download(v.data.foto_ruta)
  if (lectura || !objeto || objeto.size > 10485760) return { ok: false, error: 'No se pudo verificar la foto. Vuelve a cargarla.' }
  const cabecera = new Uint8Array(await objeto.slice(0, 12).arrayBuffer())
  const jpg = cabecera[0] === 255 && cabecera[1] === 216 && cabecera[2] === 255
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => cabecera[i] === n)
  const webp = new TextDecoder().decode(cabecera.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(cabecera.slice(8, 12)) === 'WEBP'
  if (!jpg && !png && !webp) return { ok: false, error: 'El archivo debe ser una foto JPG, PNG o WebP válida.' }

  const { data, error } = await supabase.rpc('registrar_salida_almacen', {
    p_id: v.data.operacion_id,
    p_material: v.data.material_id,
    p_cantidad: v.data.cantidad,
    p_unidad: v.data.destino === 'UNIDAD' ? v.data.unidad_id ?? null : null,
    p_codigo: v.data.destino === 'CODIGO' ? v.data.codigo_unidad ?? null : null,
    p_motivo: v.data.motivo,
    p_recibe: v.data.recibido_por_nombre,
    p_foto: v.data.foto_ruta,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== v.data.operacion_id) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/almacen/kardex')
  revalidatePath('/almacen/stock')
  return { ok: true, mensaje: 'Salida registrada en el kardex con su unidad.' }
}
