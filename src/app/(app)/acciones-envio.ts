'use server'

import { z } from 'zod'

import { CLAVES_DEL_ENVIO, MAXIMO_PENDIENTES, type ClaveDelEnvio, type LoQueEntro } from '@/lib/dominio/envios'
import { cantidad, fecha, moneda, type CodigoMoneda } from '@/lib/format'
import { obtenerSesion } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

type Cliente = Awaited<ReturnType<typeof createClient>>

/**
 * Lo que la base sabe de los envíos que la pestaña tiene pendientes: con qué
 * cuenta está la sesión, y de cada id que quedó, lo que quedó y, si no lo
 * registró esa cuenta, el puesto de la que sí. El id que no está no entró, o
 * no se puede ver.
 */
export type LoQueQuedo = { cuenta: string; puesto: string; entraron: Record<string, LoQueEntro> }

// Sin ids también se pregunta: la respuesta dice con qué cuenta está la sesión.
const Consulta = z.object({ clave: z.enum(CLAVES_DEL_ENVIO), ids: z.array(z.guid()).max(MAXIMO_PENDIENTES) })

// La nota es texto corrido: sin el espacio duro, «S/» quedaba al final de una
// línea y el monto al comienzo de la otra.
function importe(monto: number, codigo: string | null | undefined, dia: string | null) {
  const texto = moneda(monto, (codigo ?? 'PEN') as CodigoMoneda).replace(' ', ' ')
  return dia ? `${texto} del ${fecha(dia)}` : texto
}

/** «La orden de compra … : OS-…. Lo que registres ahora será otra.», contado por `contarLoQueEntro`. */
function dicho(sujeto: string, plural: string, otra: 'otro' | 'otra', detalle: string | null, falta = ''): LoQueEntro {
  return { sujeto, plural, detalle, falta, cierre: `Lo que registres ahora será ${otra}.`, autor: null }
}

/**
 * El archivo que sale después del documento (la factura de la OC, el contrato)
 * no se envió si del documento no llegó la respuesta: si no tiene ninguno, se
 * dice dónde adjuntarlo. Solo a quien lo registró: es quien lo había elegido.
 */
async function sinArchivo(registro: PromiseLike<{ count: number | null }>, texto: string) {
  const { count } = await registro
  return count === 0 ? ` ${texto}` : ''
}

/** Con lo que se nombra la cuenta en pantalla: el cargo, o el rol si no lo tiene (`obtenerSesion`). */
async function puestoDe(supabase: Cliente, usuario: string) {
  const { data } = await supabase.from('usuarios').select('cargo, rol:roles!inner(nombre)').eq('id', usuario).maybeSingle()
  const rol = data?.rol as unknown as { nombre: string } | null
  return data?.cargo?.trim() || rol?.nombre || 'otra cuenta'
}

/**
 * Si los envíos de esos ids entraron (`useIdDelEnvio`), y con qué cuenta está la
 * sesión. Se lee con la cuenta de quien pregunta y su RLS: lo que no puede ver
 * no se le cuenta, y la ventana sigue con el mismo id, que la base reconoce
 * como el mismo envío.
 *
 * Lo que quedó se juzga por quien lo registró, no por la cuenta con que se
 * pintó la pantalla: si en otra pestaña entró otra persona y la pantalla vieja
 * envió con su sesión, la fila es de esa persona, y es ella la que tiene que
 * ver que quedó; antes la ventana miraba la cuenta pintada, no la encontraba, y
 * el reintento entraba dos veces (vigésima pasada). Lo registrado por otra
 * cuenta lleva su puesto, para que la ventana no lo cuente como «que enviaste».
 */
export async function consultarEnvio(clave: ClaveDelEnvio, ids: string[]): Promise<LoQueQuedo | null> {
  const perfil = await obtenerSesion()
  if (!perfil?.activo) return null
  const analisis = Consulta.safeParse({ clave, ids })
  if (!analisis.success) return null
  const supabase = await createClient()
  const hallados = await Promise.all(
    [...new Set(analisis.data.ids)].map(async (id) => {
      const hallado = await queQuedo(supabase, analisis.data.clave, id, perfil.id)
      if (!hallado) return null
      const lo = hallado.por === perfil.id ? hallado.lo : { ...hallado.lo, autor: await puestoDe(supabase, hallado.por) }
      return [id, lo] as const
    }),
  )
  return { cuenta: perfil.id, puesto: perfil.puesto, entraron: Object.fromEntries(hallados.filter((h) => h !== null)) }
}

/** Lo que quedó con ese id y quién lo registró (`por`); `null` si no está. */
async function queQuedo(supabase: Cliente, clave: ClaveDelEnvio, id: string, yo: string): Promise<{ lo: LoQueEntro; por: string } | null> {
  switch (clave) {
    case 'requerimiento': {
      const { data } = await supabase.from('requerimientos').select('numero, creado_por').eq('id', id).maybeSingle()
      return data && { por: data.creado_por, lo: dicho('El requerimiento', 'Los requerimientos', 'otro', data.numero) }
    }
    case 'orden_compra_del_tablero': {
      // La ventana del tablero de la OT no lleva factura ni comprobante: no hay archivo que echar en falta.
      const { data } = await supabase.from('ordenes_compra_materiales').select('numero, creado_por').eq('id', id).maybeSingle()
      return data && { por: data.creado_por, lo: dicho('La orden de compra', 'Las órdenes de compra', 'otra', data.numero) }
    }
    case 'orden_compra': {
      const { data } = await supabase.from('ordenes_compra_materiales').select('numero, creado_por').eq('id', id).maybeSingle()
      if (!data) return null
      const falta =
        data.creado_por === yo
          ? await sinArchivo(
              supabase.from('documentos_compra_material').select('id', { count: 'exact', head: true }).eq('orden_compra_id', id),
              'Si le elegiste factura o comprobante, no se adjuntó: adjúntalo desde la fila de la orden.',
            )
          : ''
      return { por: data.creado_por, lo: dicho('La orden de compra', 'Las órdenes de compra', 'otra', data.numero, falta) }
    }
    case 'orden_servicio': {
      const { data } = await supabase.from('ordenes_servicio').select('numero, creado_por').eq('id', id).maybeSingle()
      if (!data) return null
      const falta =
        data.creado_por === yo
          ? await sinArchivo(
              supabase.from('documentos_orden_servicio').select('id', { count: 'exact', head: true }).eq('orden_servicio_id', id),
              'Si le elegiste contrato, no se adjuntó: adjúntalo desde la fila de la orden, con «Adjuntar documento».',
            )
          : ''
      return { por: data.creado_por, lo: dicho('La orden de servicio', 'Las órdenes de servicio', 'otra', data.numero, falta) }
    }
    case 'subcontrato': {
      const { data } = await supabase.from('subcontratos').select('numero, creado_por').eq('id', id).maybeSingle()
      if (!data) return null
      const falta =
        data.creado_por === yo
          ? await sinArchivo(
              supabase.from('subcontrato_contratos').select('id', { count: 'exact', head: true }).eq('subcontrato_id', id),
              'Si le elegiste contrato, no se adjuntó: adjúntalo desde el subcontrato, con «Adjuntar contrato».',
            )
          : ''
      return { por: data.creado_por, lo: dicho('El subcontrato', 'Los subcontratos', 'otro', data.numero, falta) }
    }
    case 'contrato_subcontrato': {
      const { data } = await supabase.from('subcontrato_contratos').select('archivo_nombre, subido_por').eq('id', id).maybeSingle()
      return data && { por: data.subido_por, lo: dicho('El contrato', 'Los contratos', 'otro', data.archivo_nombre) }
    }
    case 'recibo_honorarios': {
      const { data } = await supabase.from('recibos_honorarios').select('numero, registrado_por').eq('id', id).maybeSingle()
      return data && { por: data.registrado_por, lo: dicho('El recibo', 'Los recibos', 'otro', data.numero) }
    }
    case 'pago_recibo': {
      const { data } = await supabase
        .from('pagos_recibo_honorarios')
        .select('monto, fecha_pago, registrado_por, recibos_honorarios(moneda)')
        .eq('id', id)
        .maybeSingle()
      return (
        data && {
          por: data.registrado_por,
          lo: dicho('El pago', 'Los pagos', 'otro', importe(data.monto, data.recibos_honorarios?.moneda, data.fecha_pago)),
        }
      )
    }
    case 'documento_compra': {
      const { data } = await supabase
        .from('documentos_compra_material')
        .select('tipo, numero_documento, nombre_archivo, subido_por')
        .eq('id', id)
        .maybeSingle()
      if (!data) return null
      const detalle = data.numero_documento || data.nombre_archivo
      if (data.tipo === 'FACTURA') return { por: data.subido_por, lo: dicho('La factura', 'Las facturas', 'otra', detalle) }
      if (data.tipo === 'COMPROBANTE') return { por: data.subido_por, lo: dicho('El comprobante', 'Los comprobantes', 'otro', detalle) }
      return { por: data.subido_por, lo: dicho('El documento', 'Los documentos', 'otro', detalle) }
    }
    case 'documento_servicio': {
      const { data } = await supabase.from('documentos_orden_servicio').select('tipo, numero, nombre_archivo, subido_por').eq('id', id).maybeSingle()
      if (!data) return null
      const detalle = data.numero || data.nombre_archivo
      if (data.tipo === 'FACTURA') return { por: data.subido_por, lo: dicho('La factura', 'Las facturas', 'otra', detalle) }
      if (data.tipo === 'BOLETA') return { por: data.subido_por, lo: dicho('La boleta', 'Las boletas', 'otra', detalle) }
      if (data.tipo === 'RECIBO') return { por: data.subido_por, lo: dicho('El recibo', 'Los recibos', 'otro', detalle) }
      if (data.tipo === 'CONTRATO') return { por: data.subido_por, lo: dicho('El contrato', 'Los contratos', 'otro', detalle) }
      return { por: data.subido_por, lo: dicho('El documento', 'Los documentos', 'otro', detalle) }
    }
    case 'factura_venta': {
      const { data } = await supabase.from('facturas_venta').select('numero, registrado_por').eq('id', id).maybeSingle()
      return data && { por: data.registrado_por, lo: dicho('La factura', 'Las facturas', 'otra', data.numero) }
    }
    case 'cobro_factura': {
      const { data } = await supabase.from('cobros_factura_venta').select('monto, moneda, fecha, registrado_por').eq('id', id).maybeSingle()
      return data && { por: data.registrado_por, lo: dicho('El cobro', 'Los cobros', 'otro', importe(data.monto, data.moneda, data.fecha)) }
    }
    case 'pago_factura': {
      const { data } = await supabase.from('pagos_adquisicion').select('monto, fecha, registrado_por, adquisiciones(moneda)').eq('id', id).maybeSingle()
      return (
        data && { por: data.registrado_por, lo: dicho('El pago', 'Los pagos', 'otro', importe(data.monto, data.adquisiciones?.moneda, data.fecha)) }
      )
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
      const { data: filas, error } = await supabase
        .from('pagos_adquisicion')
        .select('monto')
        .eq('adquisicion_id', data.adquisicion_id)
        .eq('registrado_por', data.registrado_por)
        .eq('creado_en', data.creado_en)
      // Sin las filas no se sabe cuánto tomó: mejor callar que decir «tomó S/ 0.00».
      if (error || !filas?.length) return null
      const tomado = filas.reduce((suma, f) => suma + Number(f.monto), 0)
      const factura = data.adquisiciones?.numero_documento ? `la factura ${data.adquisiciones.numero_documento}` : 'la factura'
      return {
        por: data.registrado_por,
        lo: {
          ...dicho('Lo', 'Las tomas de la boleta', 'otro', `${factura} tomó ${importe(tomado, data.adquisiciones?.moneda, null)}`),
          cierre: 'Lo que registres ahora irá aparte.',
        },
      }
    }
    case 'pago_compra': {
      const { data } = await supabase.from('pagos_orden_compra').select('monto, moneda, fecha_pago, registrado_por').eq('id', id).maybeSingle()
      return data && { por: data.registrado_por, lo: dicho('El pago', 'Los pagos', 'otro', importe(data.monto, data.moneda, data.fecha_pago)) }
    }
    case 'devolucion_compra': {
      const { data } = await supabase.from('devoluciones_orden_compra').select('monto, moneda, fecha, registrado_por').eq('id', id).maybeSingle()
      return data && { por: data.registrado_por, lo: dicho('La devolución', 'Las devoluciones', 'otra', importe(data.monto, data.moneda, data.fecha)) }
    }
    case 'pago_servicio': {
      const { data } = await supabase.from('pagos_orden_servicio').select('monto, moneda, fecha_pago, registrado_por').eq('id', id).maybeSingle()
      return data && { por: data.registrado_por, lo: dicho('El pago', 'Los pagos', 'otro', importe(data.monto, data.moneda, data.fecha_pago)) }
    }
    case 'pago_parte_boleta': {
      const { data } = await supabase.from('pagos_parte_con_boleta').select('monto, moneda, fecha_pago, registrado_por').eq('id', id).maybeSingle()
      return data && { por: data.registrado_por, lo: dicho('El pago', 'Los pagos', 'otro', importe(data.monto, data.moneda, data.fecha_pago)) }
    }
    case 'nota_credito': {
      const { data } = await supabase.from('notas_credito_compra').select('numero, registrado_por').eq('id', id).maybeSingle()
      return data && { por: data.registrado_por, lo: dicho('La nota de crédito', 'Las notas de crédito', 'otra', data.numero) }
    }
    case 'reembolso_nota_credito': {
      const { data } = await supabase.from('reembolsos_nota_credito').select('monto, moneda, fecha, registrado_por').eq('id', id).maybeSingle()
      return data && { por: data.registrado_por, lo: dicho('La devolución', 'Las devoluciones', 'otra', importe(data.monto, data.moneda, data.fecha)) }
    }
    case 'movimiento_almacen': {
      // «2 UND de Disco de corte, con GR-…»: `codigo_unidad` es la unidad del vehículo, no la medida.
      const { data } = await supabase
        .from('movimientos_materiales')
        .select('tipo, cantidad, documento_referencia, registrado_por, materiales(descripcion, unidad:unidades_medida(codigo))')
        .eq('id', id)
        .maybeSingle()
      if (!data) return null
      const material = data.materiales
      const cuanto = [cantidad(data.cantidad), material?.unidad?.codigo].filter(Boolean).join(' ')
      const detalle = [material?.descripcion ? `${cuanto} de ${material.descripcion}` : cuanto, data.documento_referencia]
        .filter(Boolean)
        .join(', con ')
      return {
        por: data.registrado_por,
        lo:
          data.tipo === 'DEVOLUCION_PROVEEDOR'
            ? dicho('La devolución', 'Las devoluciones', 'otra', detalle)
            : dicho('La reposición', 'Las reposiciones', 'otra', detalle),
      }
    }
    case 'movimiento_caja': {
      const { data } = await supabase.from('movimientos_caja').select('tipo, monto, fecha, registrado_por, cajas(nombre, moneda)').eq('id', id).maybeSingle()
      if (!data) return null
      const cuenta = data.cajas?.nombre ? `, en ${data.cajas.nombre}` : ''
      const detalle = `${importe(data.monto, data.cajas?.moneda, data.fecha)}${cuenta}`
      return {
        por: data.registrado_por,
        lo: data.tipo === 'INGRESO' ? dicho('El ingreso', 'Los ingresos', 'otro', detalle) : dicho('El egreso', 'Los egresos', 'otro', detalle),
      }
    }
    case 'transferencia_caja': {
      const { data } = await supabase
        .from('movimientos_caja')
        .select('tipo, monto, fecha, registrado_por, cajas(nombre, moneda)')
        .eq('origen', 'TRANSFERENCIA')
        .eq('origen_id', id)
      const sale = data?.find((m) => m.tipo === 'EGRESO')
      if (!sale) return null
      const entra = data?.find((m) => m.tipo === 'INGRESO')
      const cuentas = sale.cajas?.nombre && entra?.cajas?.nombre ? `, de ${sale.cajas.nombre} a ${entra.cajas.nombre}` : ''
      return {
        por: sale.registrado_por,
        lo: dicho('La transferencia', 'Las transferencias', 'otra', `${importe(sale.monto, sale.cajas?.moneda, sale.fecha)}${cuentas}`),
      }
    }
  }
}
