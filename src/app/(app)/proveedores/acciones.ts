'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import type { ProveedorParaCompra } from '@/lib/datos/proveedores'
import { rucEsValido } from '@/lib/dominio/proveedores'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

// El mismo permiso que acepta la política de `proveedores` para escribir. Si
// estos dos se separan, la escritura afecta cero filas sin error y la pantalla
// dice «guardado» sin haber guardado nada.
const PERMISO = 'proveedores.editar'

const texto = (maximo: number) => z.string().trim().max(maximo, `Ese dato pasa de ${maximo} caracteres.`).optional()

const esquemaProveedor = z
  .object({
    id: z.string().uuid().optional().or(z.literal('')),
    tipo_documento: z.enum(['RUC', 'DNI', 'CE', 'PASAPORTE']),
    numero_documento: z.string().trim().min(1, 'Falta el número de documento.').max(20, 'El documento es demasiado largo.'),
    razon_social: z.string().trim().min(2, 'Falta la razón social.').max(160, 'La razón social pasa de 160 caracteres.'),
    nombre_comercial: texto(160),
    rubro: texto(120),
    contacto: texto(120),
    telefono: texto(40),
    correo: z.string().trim().max(160).optional().refine((c) => !c || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c), 'El correo no parece válido.'),
    direccion: texto(250),
    condicion_pago: z.enum(['CONTADO', 'CREDITO']),
    dias_credito: z.coerce.number().int('Los días de crédito son un número entero.').min(0).max(365, 'El crédito llega hasta 365 días.'),
    observaciones: texto(1000),
  })
  .superRefine((v, ctx) => {
    if (v.tipo_documento === 'RUC' && !rucEsValido(v.numero_documento)) {
      ctx.addIssue({
        code: 'custom',
        message: 'El RUC no es válido: son 11 dígitos, empieza en 10, 15, 16, 17 o 20, y el último es el verificador de SUNAT. Cópialo de la factura.',
      })
    }
    if (v.tipo_documento === 'DNI' && !/^\d{8}$/.test(v.numero_documento)) {
      ctx.addIssue({ code: 'custom', message: 'El DNI tiene 8 dígitos.' })
    }
    if (v.condicion_pago === 'CREDITO' && v.dias_credito === 0) {
      ctx.addIssue({ code: 'custom', message: 'Indica a cuántos días es el crédito (de 1 a 365).' })
    }
  })

function nulo(valor: string | undefined | null) {
  const t = valor?.trim()
  return t ? t : null
}

function errorDeProveedor(error: { message: string; code?: string }) {
  if (error.message.includes('ck_proveedores_documento')) {
    return 'El documento no es válido. Si es RUC, revisa los 11 dígitos: el último es el verificador de SUNAT.'
  }
  if (error.message.includes('ck_proveedores_pago')) {
    return 'El pago al contado va con 0 días; el crédito, de 1 a 365 días.'
  }
  return mensajeDeError(error)
}

/**
 * Da de alta o corrige un proveedor. Al dar de alta devuelve el proveedor, para
 * que la orden de compra desde la que se creó lo deje elegido.
 */
export async function guardarProveedor(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion<ProveedorParaCompra>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, PERMISO)) return { ok: false, error: 'Tu perfil no puede registrar ni corregir proveedores.' }

  const crudo = Object.fromEntries(datos)
  const analisis = esquemaProveedor.safeParse({
    ...crudo,
    numero_documento: String(crudo.numero_documento ?? '').replace(/\s/g, ''),
    // El contado va siempre con 0 días: si alguien dejó un número escrito antes
    // de cambiar a contado, no se le hace volver a borrarlo.
    dias_credito: crudo.condicion_pago === 'CONTADO' ? 0 : crudo.dias_credito,
  })
  if (!analisis.success) {
    return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa los datos del proveedor.' }
  }

  const v = analisis.data
  const fila = {
    tipo_documento: v.tipo_documento,
    numero_documento: v.numero_documento,
    razon_social: v.razon_social,
    nombre_comercial: nulo(v.nombre_comercial),
    rubro: nulo(v.rubro),
    contacto: nulo(v.contacto),
    telefono: nulo(v.telefono),
    correo: nulo(v.correo),
    direccion: nulo(v.direccion),
    condicion_pago: v.condicion_pago,
    dias_credito: v.dias_credito,
    observaciones: nulo(v.observaciones),
  }
  const columnas = 'id, razon_social, numero_documento, condicion_pago, dias_credito'
  const supabase = await createClient()

  if (v.id) {
    // Con `.select()`: un UPDATE que el RLS esconde afecta cero filas sin error.
    const { data, error } = await supabase.from('proveedores').update(fila).eq('id', v.id).select(columnas).maybeSingle()
    if (error) return { ok: false, error: errorDeProveedor(error) }
    if (!data) return { ok: false, error: NO_TOCO_NADA }
    revalidatePath('/proveedores')
    return { ok: true, mensaje: 'Proveedor actualizado.', datos: data }
  }

  const { data, error } = await supabase.from('proveedores').insert(fila).select(columnas).single()
  if (error) {
    if (error.code === '23505') {
      // Ya estaba en el padrón: se devuelve el que había en vez de un error, para
      // que quien lo buscaba desde la orden de compra siga con su compra.
      const { data: existente } = await supabase
        .from('proveedores')
        .select(`${columnas}, activo`)
        .eq('tipo_documento', v.tipo_documento)
        .eq('numero_documento', v.numero_documento)
        .maybeSingle()
      if (existente && !existente.activo) {
        return {
          ok: false,
          error: `Ese documento ya está en el padrón como ${existente.razon_social}, dado de baja. Reactívalo en Proveedores para volver a comprarle.`,
        }
      }
      if (existente) {
        return {
          ok: true,
          mensaje: `Ese documento ya estaba registrado: ${existente.razon_social}. Quedó elegido.`,
          datos: {
            id: existente.id,
            razon_social: existente.razon_social,
            numero_documento: existente.numero_documento,
            condicion_pago: existente.condicion_pago,
            dias_credito: existente.dias_credito,
          },
        }
      }
    }
    return { ok: false, error: errorDeProveedor(error) }
  }

  revalidatePath('/proveedores')
  revalidatePath('/compras')
  return { ok: true, mensaje: 'Proveedor registrado.', datos: data }
}

/** Dar de baja o reactivar. Un proveedor no se borra: sus compras lo nombran. */
export async function cambiarEstadoProveedor(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, PERMISO)) return { ok: false, error: 'Tu perfil no puede dar de baja proveedores.' }

  const analisis = z
    .object({ id: z.string().uuid(), activo: z.enum(['true', 'false']) })
    .safeParse({ id: datos.get('id'), activo: datos.get('activo') })
  if (!analisis.success) return { ok: false, error: 'No se reconoció el proveedor. Vuelve a cargar la pantalla.' }

  const activo = analisis.data.activo === 'true'
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('proveedores')
    .update({ activo })
    .eq('id', analisis.data.id)
    .select('id')
    .maybeSingle()
  if (error) return { ok: false, error: errorDeProveedor(error) }
  if (!data) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/proveedores')
  revalidatePath('/compras')
  return { ok: true, mensaje: activo ? 'Proveedor reactivado.' : 'Proveedor dado de baja. Sus compras anteriores quedan como estaban.' }
}
