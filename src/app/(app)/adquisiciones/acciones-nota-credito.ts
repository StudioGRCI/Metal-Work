'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { mensajeDeError, type ResultadoAccion } from '@/lib/acciones'
import { moneda } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/*
 * Contabilidad registra la nota de crédito del proveedor contra su factura, con
 * el PDF ya subido a `notas-credito/{factura}/…`, o la anula con su motivo
 * (decisiones de DKS del 22/10, migración 20261022190000). Mismo permiso que
 * `registrar_nota_credito` y `anular_nota_credito`: `adquisiciones.registrar`.
 */

const NO_REGISTRA = 'Las notas de crédito las registra Contabilidad.'

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor.trim() : ''
}

function repintar() {
  revalidatePath('/adquisiciones')
  revalidatePath('/tesoreria/por-pagar')
  revalidatePath('/codigos-internos')
  revalidatePath('/costos')
}

/** El id llega de la pantalla: un reintento del mismo envío no registra otra. */
export async function registrarNotaCredito(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'adquisiciones.registrar')) return { ok: false, error: NO_REGISTRA }
  const analisis = z
    .object({
      id: z.guid(),
      factura: z.guid(),
      numero: z.string().min(3, 'Escribe el número de la nota, por ejemplo FC01-123.').max(20, 'El número de la nota es muy largo.'),
      fecha: z.iso.date('Elige la fecha de la nota.'),
      monto: z.coerce
        .number('Escribe el total de la nota.')
        .positive('Escribe el total de la nota.')
        .multipleOf(0.01, 'El total va en dos decimales.'),
      tipo: z.enum(['DEVOLUCION', 'DESCUENTO'], 'Di si la nota es por lo devuelto o por un descuento.'),
      devolucion: z.union([z.literal(''), z.guid()]),
      motivo: z.string().min(10, 'Cuenta qué corrige la nota, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
      ruta: z.string().min(1, 'Adjunta la nota de crédito.').max(200),
    })
    .safeParse({
      id: dato(formulario, 'id'),
      factura: dato(formulario, 'factura'),
      numero: dato(formulario, 'numero'),
      fecha: dato(formulario, 'fecha'),
      monto: dato(formulario, 'monto'),
      tipo: dato(formulario, 'tipo'),
      devolucion: dato(formulario, 'devolucion'),
      motivo: dato(formulario, 'motivo'),
      ruta: dato(formulario, 'ruta'),
    })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Revisa la nota de crédito.' }
  const d = analisis.data
  if (d.tipo === 'DESCUENTO' && d.devolucion) return { ok: false, error: 'Un descuento no va ligado a lo devuelto.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('registrar_nota_credito', {
    p_id: d.id,
    p_factura: d.factura,
    p_numero: d.numero,
    p_fecha: d.fecha,
    p_monto: d.monto,
    p_tipo: d.tipo,
    // Sin devolución la base recibe null: el tipo generado no lo dice.
    p_devolucion: (d.devolucion || null) as string,
    p_motivo: d.motivo,
    p_ruta: d.ruta,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== d.id) return { ok: false, error: 'La nota de crédito no se registró. Recarga la pantalla.' }

  // Cuánto bajó de su factura: lo que no cupo queda a favor para Tesorería.
  const [abonos, factura] = await Promise.all([
    supabase.from('pagos_adquisicion').select('monto').eq('nota_credito_id', d.id).is('anulado_en', null),
    supabase.from('adquisiciones').select('numero_documento, moneda').eq('id', d.factura).maybeSingle(),
  ])
  repintar()
  if (abonos.error || factura.error || !factura.data) {
    return { ok: true, mensaje: 'Nota de crédito registrada. Mira en la factura cuánto bajó.' }
  }
  const m = factura.data.moneda === 'USD' ? 'USD' : 'PEN'
  const bajo = (abonos.data ?? []).reduce((s, a) => s + Number(a.monto), 0)
  const aFavor = Math.round((d.monto - bajo) * 100) / 100
  const enLaFactura = bajo > 0 ? `La factura ${factura.data.numero_documento} bajó ${moneda(bajo, m)}.` : `La factura ${factura.data.numero_documento} ya estaba pagada.`
  return {
    ok: true,
    mensaje:
      aFavor > 0
        ? `Nota de crédito registrada. ${enLaFactura} Quedan ${moneda(aFavor, m)} a favor: Tesorería ya tiene el aviso para descontarlos de otra factura del proveedor o registrar que los devolvió.`
        : `Nota de crédito registrada. ${enLaFactura}`,
  }
}

export async function anularNotaCredito(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'adquisiciones.registrar')) return { ok: false, error: NO_REGISTRA }
  const analisis = z
    .object({
      id: z.guid(),
      motivo: z.string().min(10, 'Cuenta por qué se anula, en al menos 10 caracteres.').max(500, 'El motivo pasa de 500 caracteres.'),
    })
    .safeParse({ id: dato(formulario, 'id'), motivo: dato(formulario, 'motivo') })
  if (!analisis.success) return { ok: false, error: analisis.error.issues[0]?.message ?? 'Vuelve a cargar la pantalla.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('anular_nota_credito', { p_id: analisis.data.id, p_motivo: analisis.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== analisis.data.id) return { ok: false, error: 'La nota de crédito no se anuló. Recarga la pantalla.' }
  repintar()
  return { ok: true, mensaje: 'Nota de crédito anulada: su factura vuelve a deber lo que ella bajaba, y lo devuelto que tenía vuelve a esperar su nota.' }
}
