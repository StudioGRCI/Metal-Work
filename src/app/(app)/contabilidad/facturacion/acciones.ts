'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { normalizarNumeroFactura } from '@/lib/dominio/finanzas'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

const NO_FACTURA = 'La factura la registra Contabilidad.'
const MOTIVO = z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.')

function repintar() {
  revalidatePath('/contabilidad/facturacion')
  revalidatePath('/tesoreria/por-cobrar')
  revalidatePath('/cotizaciones/pdf')
  revalidatePath('/codigos-internos')
}

/**
 * Contabilidad registra la factura que emitió en SUNAT: número, fechas, moneda,
 * total y el PDF, que el navegador ya subió a `facturas-venta/{id}/…`. Queda
 * colgada del código interno de la cotización y entra sola a las cuentas por
 * cobrar de Tesorería. Mismo permiso que `registrar_factura_venta`
 * (`contabilidad.facturar`). El id llega de la pantalla: un reintento no
 * registra otra.
 */
export async function registrarFactura(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'contabilidad.facturar')) return { ok: false, error: NO_FACTURA }
  const analisis = z
    .object({
      id: z.guid(),
      cotizacion_id: z.guid(),
      numero: z.string().transform((v, ctx) => {
        const numero = normalizarNumeroFactura(v)
        if (!numero) ctx.addIssue({ code: 'custom', message: 'Escribe el número como sale en SUNAT: la serie, un guion y el número (E001-626).' })
        return numero ?? ''
      }),
      fecha_emision: z.iso.date('Elige la fecha de emisión.'),
      fecha_vencimiento: z.iso.date('Elige la fecha de vencimiento.'),
      moneda: z.enum(['PEN', 'USD'], 'Elige la moneda de la factura.'),
      total: z.coerce.number('Escribe el total de la factura.').positive('Escribe el total de la factura.').multipleOf(0.01, 'El total va en dos decimales.'),
      concepto: z.string().max(200, 'El concepto pasa de 200 caracteres.'),
      ruta: z.string().min(1, 'Adjunta el PDF de la factura.').max(200),
      nombre_archivo: z.string().max(200),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      cotizacion_id: dato(formulario, 'cotizacion_id'),
      numero: dato(formulario, 'numero'),
      fecha_emision: dato(formulario, 'fecha_emision'),
      fecha_vencimiento: dato(formulario, 'fecha_vencimiento'),
      moneda: dato(formulario, 'moneda'),
      total: dato(formulario, 'total'),
      concepto: dato(formulario, 'concepto'),
      ruta: dato(formulario, 'ruta'),
      nombre_archivo: dato(formulario, 'nombre_archivo'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la factura.' }
  const d = analisis.data
  if (d.fecha_vencimiento < d.fecha_emision) return { ok: false, error: 'El vencimiento no puede ser antes de la emisión.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_factura_venta', {
    p_id: d.id,
    p_cotizacion: d.cotizacion_id,
    p_numero: d.numero,
    p_fecha_emision: d.fecha_emision,
    p_fecha_vencimiento: d.fecha_vencimiento,
    p_moneda: d.moneda,
    p_total: d.total,
    p_concepto: d.concepto || null,
    p_ruta: d.ruta,
    p_nombre_archivo: d.nombre_archivo || null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'La factura no se registró. Recarga la pantalla.' }

  repintar()
  return { ok: true, mensaje: `Factura ${d.numero} registrada: Tesorería ya la tiene por cobrar.` }
}

/** Anular una factura mal registrada, mientras Tesorería no tenga un cobro vigente de ella. Mismo permiso que `anular_factura_venta`. */
export async function anularFactura(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'contabilidad.facturar')) return { ok: false, error: NO_FACTURA }
  const analisis = z.object({ id: z.guid(), motivo: MOTIVO }).safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_factura_venta', { p_factura: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'La factura no se anuló. Recarga la pantalla.' }

  repintar()
  return { ok: true, mensaje: 'Factura anulada: su número queda libre para registrarla bien.' }
}
