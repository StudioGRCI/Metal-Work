'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const CONDICIONES = [
  'CONTADO',
  'CREDITO_7',
  'CREDITO_15',
  'CREDITO_30',
  'CREDITO_45',
  'CREDITO_60',
  'LETRAS',
] as const

/**
 * Un proveedor se identifica por su RUC de 11 dígitos, o por su DNI de 8 si es
 * persona natural: el tornero de la esquina o el pintor independiente también
 * facturan, y son proveedores igual que la siderúrgica.
 */
const esquema = z.object({
  numero_documento: z
    .string()
    .trim()
    .regex(/^[0-9]{8}$|^[0-9]{11}$/, 'El documento debe tener 11 dígitos (RUC) u 8 (DNI)'),
  razon_social: z.string().trim().min(3, 'Falta la razón social'),
  nombre_comercial: z.string().trim().optional(),
  telefono: z.string().trim().optional(),
  correo: z.string().trim().email('El correo no tiene forma de correo').optional().or(z.literal('')),
  contacto_nombre: z.string().trim().optional(),
  direccion: z.string().trim().optional(),
  condicion_pago: z.enum(CONDICIONES).default('CONTADO'),
  dias_credito: z.coerce.number().int().min(0).max(180).default(0),
})

function nulo(valor?: string | null) {
  const t = valor?.trim()
  return t ? t : null
}

/** Días de crédito que corresponden a cada condición, para no pedirlos aparte. */
const DIAS = {
  CONTADO: 0,
  CREDITO_7: 7,
  CREDITO_15: 15,
  CREDITO_30: 30,
  CREDITO_45: 45,
  CREDITO_60: 60,
  LETRAS: 60,
} as const

/**
 * Da de alta un proveedor. Se llama desde la pantalla de proveedores y también
 * desde los formularios que lo necesitan —la orden de servicio, la orden de
 * compra—, porque el proveedor nuevo aparece justo cuando hace falta emitirle
 * algo, y mandar a la persona a otra pantalla es perder lo que ya escribió.
 */
export async function crearProveedor(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion<{ id: string; razon_social: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, ['compras.crear', 'almacen.maestros', 'costos.editar'])) {
    return { ok: false, error: 'No tienes permiso para dar de alta proveedores.' }
  }

  const analisis = esquema.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos del proveedor.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  // Si ya está, no se duplica: se devuelve el que existe. Es lo que espera
  // quien lo está buscando para emitirle una orden.
  const { data: existente } = await supabase
    .from('proveedores')
    .select('id, razon_social, activo')
    .eq('numero_documento', v.numero_documento)
    .maybeSingle()

  if (existente) {
    if (!existente.activo) {
      return {
        ok: false,
        error: `${existente.razon_social} ya está registrado pero dado de baja. Actívalo desde Proveedores.`,
      }
    }
    return {
      ok: true,
      mensaje: `${existente.razon_social} ya estaba registrado con ese documento.`,
      datos: { id: existente.id, razon_social: existente.razon_social },
    }
  }

  const { data, error } = await supabase
    .from('proveedores')
    .insert({
      numero_documento: v.numero_documento,
      razon_social: v.razon_social,
      nombre_comercial: nulo(v.nombre_comercial),
      telefono: nulo(v.telefono),
      correo: nulo(v.correo),
      contacto_nombre: nulo(v.contacto_nombre),
      direccion: nulo(v.direccion),
      condicion_pago: v.condicion_pago,
      dias_credito: DIAS[v.condicion_pago],
    })
    .select('id, razon_social')
    .single()

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/almacen/proveedores')
  revalidatePath('/servicios')
  revalidatePath('/almacen/compras')

  return {
    ok: true,
    mensaje: `${data.razon_social} quedó registrado.`,
    datos: { id: data.id, razon_social: data.razon_social },
  }
}
