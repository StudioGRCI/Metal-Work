'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { exigirSesion, puede } from '@/lib/sesion'
import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'

const esquemaCliente = z.object({
  id: z.string().uuid().optional().or(z.literal('')),
  tipo_documento: z.enum(['RUC', 'DNI', 'CE', 'PASAPORTE']),
  numero_documento: z.string().trim().min(8, 'El documento es obligatorio'),
  razon_social: z.string().trim().min(3, 'La razón social es obligatoria'),
  nombre_comercial: z.string().trim().optional(),
  direccion_fiscal: z.string().trim().optional(),
  distrito: z.string().trim().optional(),
  provincia: z.string().trim().optional(),
  departamento: z.string().trim().optional(),
  telefono: z.string().trim().optional(),
  correo: z.string().trim().optional(),
  condicion_pago_dias: z.coerce.number().int().min(0).max(365).default(0),
  observaciones: z.string().trim().optional(),
})

function nulo(valor: string | undefined | null) {
  const t = valor?.trim()
  return t ? t : null
}

export async function guardarCliente(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  const analisis = esquemaCliente.safeParse(Object.fromEntries(datos))

  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos del formulario.' }
  }

  const v = analisis.data
  const editando = Boolean(v.id)

  if (!puede(perfil, editando ? 'clientes.editar' : 'clientes.crear')) {
    return { ok: false, error: 'No tienes permiso para esta operación.' }
  }

  // El RUC de una empresa peruana tiene 11 dígitos y el DNI 8; la base lo valida
  // con dominios, pero avisar aquí evita un error críptico.
  if (v.tipo_documento === 'RUC' && !/^\d{11}$/.test(v.numero_documento)) {
    return { ok: false, error: 'El RUC debe tener 11 dígitos.' }
  }
  if (v.tipo_documento === 'DNI' && !/^\d{8}$/.test(v.numero_documento)) {
    return { ok: false, error: 'El DNI debe tener 8 dígitos.' }
  }

  const supabase = await createClient()
  const fila = {
    tipo_documento: v.tipo_documento,
    numero_documento: v.numero_documento,
    razon_social: v.razon_social.toUpperCase(),
    nombre_comercial: nulo(v.nombre_comercial),
    direccion_fiscal: nulo(v.direccion_fiscal),
    distrito: nulo(v.distrito),
    provincia: nulo(v.provincia),
    departamento: nulo(v.departamento),
    telefono: nulo(v.telefono),
    correo: nulo(v.correo),
    condicion_pago_dias: v.condicion_pago_dias,
    observaciones: nulo(v.observaciones),
  }

  if (editando) {
    const { error } = await supabase.from('clientes').update(fila).eq('id', v.id!)
    if (error) return { ok: false, error: mensajeDeError(error) }

    revalidatePath(`/clientes/${v.id}`)
    revalidatePath('/clientes')
    return { ok: true, mensaje: 'Cliente actualizado.' }
  }

  const { data, error } = await supabase.from('clientes').insert(fila).select('id').single()
  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath('/clientes')
  redirect(`/clientes/${data.id}`)
}

const esquemaUnidad = z.object({
  cliente_id: z.string().uuid('Selecciona el cliente'),
  // Sin placa se puede registrar: la empresa fabrica sobre chasis que
  // todavía no están matriculados y la placa llega al final del trabajo. Si se
  // escribe, se guarda en mayúsculas y con su forma de siempre.
  placa: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .refine((p) => !p || p.length >= 6, 'La placa tiene menos caracteres de los que lleva una placa'),
  tipo_vehiculo: z.enum(['VOLQUETE', 'TRACTO', 'SEMIRREMOLQUE', 'CAMION', 'REMOLQUE', 'FURGON', 'OTRO']),
  marca: z.string().trim().optional(),
  modelo: z.string().trim().optional(),
  anio: z.string().trim().optional(),
  numero_chasis: z.string().trim().optional(),
  numero_motor: z.string().trim().optional(),
  color: z.string().trim().optional(),
  capacidad_m3: z.string().trim().optional(),
  capacidad_toneladas: z.string().trim().optional(),
  // Obligatoria desde que la ficha empieza por «qué es esta unidad»: sin la
  // carrocería, el taller no sabe qué se va a fabricar y la orden nace muda.
  // La placa, en cambio, puede faltar —hay chasis que llegan sin matricular—.
  tipo_carroceria_id: z.string().uuid('Elige el tipo de carrocería'),
  observaciones: z.string().trim().optional(),
})

function numeroOpcional(valor?: string) {
  const t = valor?.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

export async function guardarUnidad(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion<{ id: string; placa: string | null }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'clientes.crear')) {
    return { ok: false, error: 'No tienes permiso para registrar unidades.' }
  }

  const analisis = esquemaUnidad.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos de la unidad.' }
  }

  const v = analisis.data
  const supabase = await createClient()

  const { data: creada, error } = await supabase.from('unidades').insert({
    cliente_id: v.cliente_id,
    placa: nulo(v.placa),
    tipo_vehiculo: v.tipo_vehiculo,
    marca: nulo(v.marca),
    modelo: nulo(v.modelo),
    anio: numeroOpcional(v.anio),
    numero_chasis: nulo(v.numero_chasis),
    numero_motor: nulo(v.numero_motor),
    color: nulo(v.color),
    capacidad_m3: numeroOpcional(v.capacidad_m3),
    capacidad_toneladas: numeroOpcional(v.capacidad_toneladas),
    tipo_carroceria_id: nulo(v.tipo_carroceria_id) as string | null,
    observaciones: nulo(v.observaciones),
  })
    .select('id, placa, codigo_interno, numero_chasis, marca, modelo')
    .single()

  if (error) return { ok: false, error: mensajeDeError(error) }

  revalidatePath(`/clientes/${v.cliente_id}`)
  revalidatePath('/unidades')
  return { ok: true, mensaje: 'Unidad registrada.', datos: creada }
}

const esquemaClienteRapido = z.object({
  tipo_documento: z.enum(['RUC', 'DNI', 'CE', 'PASAPORTE']),
  numero_documento: z.string().trim().min(8, 'El documento es obligatorio'),
  razon_social: z.string().trim().min(3, 'La razón social es obligatoria'),
  telefono: z.string().trim().optional(),
  correo: z.string().trim().optional(),
})

/**
 * Alta de cliente sin salir del formulario que lo necesita.
 *
 * Pide solo lo que hace falta para cotizar; la ficha completa se llena
 * después con calma. Si el documento ya estaba registrado se devuelve ese
 * cliente en lugar de un error: la meta es seguir cotizando, no discutir.
 */
export async function crearClienteRapido(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion<{ id: string; razon_social: string; numero_documento: string }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'clientes.crear')) {
    return { ok: false, error: 'No tienes permiso para registrar clientes.' }
  }

  const analisis = esquemaClienteRapido.safeParse(Object.fromEntries(datos))
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos.' }
  }

  const v = analisis.data
  if (v.tipo_documento === 'RUC' && !/^\d{11}$/.test(v.numero_documento)) {
    return { ok: false, error: 'El RUC debe tener 11 dígitos.' }
  }
  if (v.tipo_documento === 'DNI' && !/^\d{8}$/.test(v.numero_documento)) {
    return { ok: false, error: 'El DNI debe tener 8 dígitos.' }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('clientes')
    .insert({
      tipo_documento: v.tipo_documento,
      numero_documento: v.numero_documento,
      razon_social: v.razon_social.toUpperCase(),
      telefono: nulo(v.telefono),
      correo: nulo(v.correo),
    })
    .select('id, razon_social, numero_documento')
    .single()

  if (error) {
    if (error.code === '23505') {
      const { data: existente } = await supabase
        .from('clientes')
        .select('id, razon_social, numero_documento')
        .eq('numero_documento', v.numero_documento)
        .maybeSingle()
      if (existente) {
        return {
          ok: true,
          mensaje: `Ese documento ya estaba registrado: ${existente.razon_social}. Quedó elegido.`,
          datos: existente,
        }
      }
    }
    return { ok: false, error: mensajeDeError(error) }
  }

  revalidatePath('/clientes')
  return { ok: true, mensaje: 'Cliente registrado.', datos: data }
}
