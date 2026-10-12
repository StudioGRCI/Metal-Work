'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function refrescar() {
  revalidatePath('/compras/aprobacion')
  revalidatePath('/compras')
  revalidatePath('/compras/ordenes')
  revalidatePath('/compras/servicios')
  revalidatePath('/recojos')
  revalidatePath('/ordenes/[id]', 'page')
}

/** La bandeja trae órdenes de compra (OC) y de servicio (OS); cada una se decide con su función. */
const TIPO = z.enum(['OC', 'OS']).catch('OC')

/**
 * La regla la fija quien tenga `compras.configurar_aprobacion`, el mismo
 * permiso que exige `fijar_regla_aprobacion_compras` en la base.
 */
export async function fijarReglaAprobacion(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'compras.configurar_aprobacion')) {
    return { ok: false, error: 'Tu perfil no puede cambiar la regla de aprobación de compras.' }
  }
  const analisis = z
    .object({
      activa: z.enum(['true', 'false']),
      monto_desde: z.coerce
        .number({ message: 'Indica el monto en soles.' })
        .min(0, 'El monto va de 0 en adelante.')
        .max(999999999, 'El monto es demasiado grande.')
        .multipleOf(0.01, 'El monto lleva como máximo dos decimales.'),
      rol_aprobador: z.string().uuid('Elige el puesto que aprobará las compras.'),
    })
    .safeParse({ activa: datos.get('activa'), monto_desde: datos.get('monto_desde'), rol_aprobador: datos.get('rol_aprobador') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la regla.' }

  const supabase = await createClient()
  const { error } = await supabase.rpc('fijar_regla_aprobacion_compras', {
    p_activa: analisis.data.activa === 'true',
    p_monto_desde: analisis.data.monto_desde,
    p_rol_aprobador: analisis.data.rol_aprobador,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }

  refrescar()
  return {
    ok: true,
    mensaje:
      analisis.data.activa === 'true'
        ? 'Regla guardada. Desde ahora, las compras nuevas que lleguen a ese monto esperan aprobación.'
        : 'Regla guardada y apagada: las compras no piden aprobación.',
  }
}

// Aprobar y rechazar no se cruzan con un permiso aquí: quien aprueba es un
// puesto que fija Gerencia, y eso lo comprueba la función de la base
// (`es_aprobador_compras`). La pantalla solo muestra los botones a ese puesto.
export async function aprobarCompra(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  await exigirSesion()
  const id = z.string().uuid().safeParse(datos.get('id'))
  if (!id.success) return { ok: false, error: 'No se reconoció la orden. Vuelve a cargar la pantalla.' }
  const tipo = TIPO.parse(datos.get('tipo'))

  const supabase = await createClient()
  const { error } =
    tipo === 'OS'
      ? await supabase.rpc('aprobar_orden_servicio', { p_id: id.data })
      : await supabase.rpc('aprobar_compra', { p_compra: id.data })
  if (error) return { ok: false, error: mensajeDeError(error) }

  refrescar()
  return {
    ok: true,
    mensaje:
      tipo === 'OS'
        ? 'Orden de servicio aprobada. Logística ya puede encargar el trabajo.'
        : 'Compra aprobada. Logística ya puede enviarla al proveedor; si es directa, al conductor ya le llegó el recojo.',
  }
}

export async function rechazarCompra(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  await exigirSesion()
  const analisis = z
    .object({
      id: z.string().uuid(),
      motivo: z
        .string()
        .trim()
        .min(10, 'Cuenta por qué se rechaza, en al menos 10 caracteres: Logística lo lee para corregir la compra.')
        .max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: datos.get('id'), motivo: datos.get('motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa el motivo.' }
  const tipo = TIPO.parse(datos.get('tipo'))

  const supabase = await createClient()
  const { error } =
    tipo === 'OS'
      ? await supabase.rpc('rechazar_orden_servicio', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
      : await supabase.rpc('rechazar_compra', { p_compra: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }

  refrescar()
  return {
    ok: true,
    mensaje:
      tipo === 'OS'
        ? 'Orden de servicio rechazada. Logística recibió el motivo.'
        : 'Compra rechazada. Logística recibió el motivo; si venía de un requerimiento, sus insumos volvieron a quedar por comprar.',
  }
}
