'use server'

import { z } from 'zod'

import { CLAVES_DEL_ENVIO, type ClaveDelEnvio } from '@/lib/dominio/envios'
import { cantidad, fecha, moneda, type CodigoMoneda } from '@/lib/format'
import { obtenerSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

const Consulta = z.object({ clave: z.enum(CLAVES_DEL_ENVIO), id: z.guid() })

function importe(monto: number, codigo: string | null | undefined, dia: string | null) {
  const texto = moneda(monto, (codigo ?? 'PEN') as CodigoMoneda)
  return dia ? `${texto} del ${fecha(dia)}` : texto
}

/** «La orden … sí quedó: OS-…. Lo que registres ahora será otra.» */
function quedo(sujeto: string, otra: 'otro' | 'otra', detalle: string | null, despues = '') {
  return `${sujeto} que enviaste antes sí quedó${detalle ? `: ${detalle}` : ''}.${despues} Lo que registres ahora será ${otra}.`
}

/**
 * El archivo que sale después del documento (la factura de la OC, el contrato)
 * no se envió si del documento no llegó la respuesta: si no tiene ninguno, se
 * dice dónde adjuntarlo.
 */
function sinArchivo(cuantos: number | null, texto: string) {
  return cuantos === 0 ? ` ${texto}` : ''
}

/**
 * Si el envío de ese id entró, lo que quedó, dicho para la ventana; si no entró
 * o no se puede saber, `null` (`useIdDelEnvio`). Se lee con la cuenta de quien
 * pregunta y su RLS: lo que no puede ver no se le cuenta, y la ventana sigue con
 * el mismo id, que la base reconoce como el mismo envío.
 */
export async function consultarEnvio(clave: ClaveDelEnvio, id: string): Promise<string | null> {
  const perfil = await obtenerSesion()
  if (!perfil?.activo) return null
  const analisis = Consulta.safeParse({ clave, id })
  if (!analisis.success) return null
  const supabase = await createClient()

  switch (analisis.data.clave) {
    case 'requerimiento': {
      const { data } = await supabase.from('requerimientos').select('numero').eq('id', id).maybeSingle()
      return data ? quedo('El requerimiento', 'otro', data.numero) : null
    }
    case 'orden_compra': {
      const { data } = await supabase.from('ordenes_compra_materiales').select('numero').eq('id', id).maybeSingle()
      if (!data) return null
      const { count } = await supabase
        .from('documentos_compra_material')
        .select('id', { count: 'exact', head: true })
        .eq('orden_compra_id', id)
      const falta = sinArchivo(count, 'Si le elegiste factura o comprobante, no se adjuntó: adjúntalo desde la fila de la orden.')
      return quedo('La orden de compra', 'otra', data.numero, falta)
    }
    case 'orden_servicio': {
      const { data } = await supabase.from('ordenes_servicio').select('numero').eq('id', id).maybeSingle()
      if (!data) return null
      const { count } = await supabase
        .from('documentos_orden_servicio')
        .select('id', { count: 'exact', head: true })
        .eq('orden_servicio_id', id)
      const falta = sinArchivo(count, 'Si le elegiste contrato, no se adjuntó: adjúntalo desde la fila de la orden, con «Adjuntar documento».')
      return quedo('La orden de servicio', 'otra', data.numero, falta)
    }
    case 'subcontrato': {
      const { data } = await supabase.from('subcontratos').select('numero').eq('id', id).maybeSingle()
      if (!data) return null
      const { count } = await supabase
        .from('subcontrato_contratos')
        .select('id', { count: 'exact', head: true })
        .eq('subcontrato_id', id)
      const falta = sinArchivo(count, 'Si le elegiste contrato, no se adjuntó: adjúntalo desde el subcontrato, con «Adjuntar contrato».')
      return quedo('El subcontrato', 'otro', data.numero, falta)
    }
    case 'contrato_subcontrato': {
      const { data } = await supabase.from('subcontrato_contratos').select('archivo_nombre').eq('id', id).maybeSingle()
      return data ? quedo('El contrato', 'otro', data.archivo_nombre) : null
    }
    case 'recibo_honorarios': {
      const { data } = await supabase.from('recibos_honorarios').select('numero').eq('id', id).maybeSingle()
      return data ? quedo('El recibo', 'otro', data.numero) : null
    }
    case 'pago_recibo': {
      const { data } = await supabase
        .from('pagos_recibo_honorarios')
        .select('monto, fecha_pago, recibos_honorarios(moneda)')
        .eq('id', id)
        .maybeSingle()
      return data ? quedo('El pago', 'otro', importe(data.monto, data.recibos_honorarios?.moneda, data.fecha_pago)) : null
    }
    case 'documento_compra': {
      const { data } = await supabase
        .from('documentos_compra_material')
        .select('tipo, numero_documento, nombre_archivo')
        .eq('id', id)
        .maybeSingle()
      if (!data) return null
      const detalle = data.numero_documento || data.nombre_archivo
      if (data.tipo === 'FACTURA') return quedo('La factura', 'otra', detalle)
      return data.tipo === 'COMPROBANTE' ? quedo('El comprobante', 'otro', detalle) : quedo('El documento', 'otro', detalle)
    }
    case 'documento_servicio': {
      const { data } = await supabase.from('documentos_orden_servicio').select('numero, nombre_archivo').eq('id', id).maybeSingle()
      return data ? quedo('El documento', 'otro', data.numero || data.nombre_archivo) : null
    }
    case 'factura_venta': {
      const { data } = await supabase.from('facturas_venta').select('numero').eq('id', id).maybeSingle()
      return data ? quedo('La factura', 'otra', data.numero) : null
    }
    case 'cobro_factura': {
      const { data } = await supabase.from('cobros_factura_venta').select('monto, moneda, fecha').eq('id', id).maybeSingle()
      return data ? quedo('El cobro', 'otro', importe(data.monto, data.moneda, data.fecha)) : null
    }
    case 'pago_factura': {
      const { data } = await supabase.from('pagos_adquisicion').select('monto, fecha, adquisiciones(moneda)').eq('id', id).maybeSingle()
      return data ? quedo('El pago', 'otro', importe(data.monto, data.adquisiciones?.moneda, data.fecha)) : null
    }
    case 'toma_de_la_boleta': {
      // El id es el de la primera fila de la toma; las demás nacen con la misma
      // factura, la misma persona y el mismo instante (`tomar_pago_de_la_boleta`).
      const { data } = await supabase
        .from('pagos_adquisicion')
        .select('adquisicion_id, registrado_por, creado_en, adquisiciones(numero_documento, moneda)')
        .eq('id', id)
        .maybeSingle()
      if (!data) return null
      const { data: filas } = await supabase
        .from('pagos_adquisicion')
        .select('monto')
        .eq('adquisicion_id', data.adquisicion_id)
        .eq('registrado_por', data.registrado_por)
        .eq('creado_en', data.creado_en)
      const tomado = (filas ?? []).reduce((suma, f) => suma + Number(f.monto), 0)
      const factura = data.adquisiciones?.numero_documento ? `la factura ${data.adquisiciones.numero_documento}` : 'la factura'
      return `Lo que enviaste antes sí quedó: ${factura} tomó ${importe(tomado, data.adquisiciones?.moneda, null)}. Lo que registres ahora irá aparte.`
    }
    case 'pago_compra': {
      const { data } = await supabase.from('pagos_orden_compra').select('monto, moneda, fecha_pago').eq('id', id).maybeSingle()
      return data ? quedo('El pago', 'otro', importe(data.monto, data.moneda, data.fecha_pago)) : null
    }
    case 'devolucion_compra': {
      const { data } = await supabase.from('devoluciones_orden_compra').select('monto, moneda, fecha').eq('id', id).maybeSingle()
      return data ? quedo('La devolución', 'otra', importe(data.monto, data.moneda, data.fecha)) : null
    }
    case 'pago_servicio': {
      const { data } = await supabase.from('pagos_orden_servicio').select('monto, moneda, fecha_pago').eq('id', id).maybeSingle()
      return data ? quedo('El pago', 'otro', importe(data.monto, data.moneda, data.fecha_pago)) : null
    }
    case 'pago_parte_boleta': {
      const { data } = await supabase.from('pagos_parte_con_boleta').select('monto, moneda, fecha_pago').eq('id', id).maybeSingle()
      return data ? quedo('El pago', 'otro', importe(data.monto, data.moneda, data.fecha_pago)) : null
    }
    case 'nota_credito': {
      const { data } = await supabase.from('notas_credito_compra').select('numero').eq('id', id).maybeSingle()
      return data ? quedo('La nota de crédito', 'otra', data.numero) : null
    }
    case 'reembolso_nota_credito': {
      const { data } = await supabase.from('reembolsos_nota_credito').select('monto, moneda, fecha').eq('id', id).maybeSingle()
      return data ? quedo('La devolución', 'otra', importe(data.monto, data.moneda, data.fecha)) : null
    }
    case 'movimiento_almacen': {
      const { data } = await supabase
        .from('movimientos_materiales')
        .select('tipo, cantidad, codigo_unidad, documento_referencia')
        .eq('id', id)
        .maybeSingle()
      if (!data) return null
      const detalle = [`${cantidad(data.cantidad)}${data.codigo_unidad ? ` ${data.codigo_unidad}` : ''}`, data.documento_referencia]
        .filter(Boolean)
        .join(', con ')
      return data.tipo === 'DEVOLUCION_PROVEEDOR' ? quedo('La devolución', 'otra', detalle) : quedo('La reposición', 'otra', detalle)
    }
    case 'movimiento_caja': {
      const { data } = await supabase.from('movimientos_caja').select('tipo, monto, fecha, cajas(moneda)').eq('id', id).maybeSingle()
      if (!data) return null
      const sujeto = data.tipo === 'INGRESO' ? 'El ingreso' : 'El egreso'
      return quedo(sujeto, 'otro', importe(data.monto, data.cajas?.moneda, data.fecha))
    }
    case 'transferencia_caja': {
      const { data } = await supabase
        .from('movimientos_caja')
        .select('monto, fecha, cajas(moneda)')
        .eq('origen', 'TRANSFERENCIA')
        .eq('origen_id', id)
        .eq('tipo', 'EGRESO')
        .maybeSingle()
      return data ? quedo('La transferencia', 'otra', importe(data.monto, data.cajas?.moneda, data.fecha)) : null
    }
  }
}
