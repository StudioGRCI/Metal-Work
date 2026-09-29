'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const dinero = z.coerce.number().positive().multipleOf(0.01)
const documento = z.object({ orden_id:z.string().uuid(), numero_documento:z.string().trim().min(3).max(80), fecha_emision:z.iso.date(), fecha_vencimiento:z.iso.date(), moneda:z.enum(['PEN','USD']), total:dinero, observacion:z.string().trim().max(1000) })

export async function crearCuentaCobrar(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  await exigirPermiso('tesoreria.registrar_cobros')
  const v=documento.safeParse(Object.fromEntries(formulario))
  if(!v.success) return {ok:false,error:v.error.issues[0]?.message ?? 'Revisa la cuenta por cobrar.'}
  if(v.data.fecha_vencimiento<v.data.fecha_emision) return {ok:false,error:'El vencimiento debe ser igual o posterior a la emisión.'}
  const supabase=await createClient()
  const {data,error}=await supabase.from('cuentas_cobrar_ot').insert(v.data).select('id').maybeSingle()
  if(error) return {ok:false,error:mensajeDeError(error)}
  if(!data) return {ok:false,error:NO_TOCO_NADA}
  revalidatePath('/tesoreria/cuentas')
  return {ok:true,mensaje:`Cuenta ${v.data.numero_documento} registrada.`}
}

const movimiento=z.object({id:z.string().uuid(),fecha:z.iso.date(),monto:dinero,referencia:z.string().trim().min(3).max(120)})

export async function registrarCobro(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  await exigirPermiso('tesoreria.registrar_cobros')
  const v=movimiento.safeParse(Object.fromEntries(formulario))
  if(!v.success) return {ok:false,error:'Indica cuenta, fecha, importe y referencia del cobro.'}
  const supabase=await createClient()
  const {data,error}=await supabase.from('cobros_ot').insert({cuenta_id:v.data.id,fecha:v.data.fecha,monto:v.data.monto,referencia:v.data.referencia}).select('id').maybeSingle()
  if(error) return {ok:false,error:mensajeDeError(error)}
  if(!data) return {ok:false,error:NO_TOCO_NADA}
  revalidatePath('/tesoreria/cuentas')
  return {ok:true,mensaje:'Cobro registrado y saldo actualizado.'}
}

export async function registrarPago(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  await exigirPermiso('tesoreria.registrar_pagos')
  const v=movimiento.safeParse(Object.fromEntries(formulario))
  if(!v.success) return {ok:false,error:'Indica comprobante, fecha, importe y referencia del pago.'}
  const supabase=await createClient()
  const {data,error}=await supabase.from('pagos_adquisicion').insert({adquisicion_id:v.data.id,fecha:v.data.fecha,monto:v.data.monto,referencia:v.data.referencia}).select('id').maybeSingle()
  if(error) return {ok:false,error:mensajeDeError(error)}
  if(!data) return {ok:false,error:NO_TOCO_NADA}
  revalidatePath('/tesoreria/cuentas')
  return {ok:true,mensaje:'Pago registrado y saldo actualizado.'}
}
