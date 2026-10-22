import { renderToBuffer } from '@react-pdf/renderer'
import { redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { DocumentoOrdenServicio } from '@/lib/documentos/orden-servicio'
import { leerLogoDocumento } from '@/lib/documentos/logo'
import { servicioSinPapel } from '@/lib/dominio/logistica'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * Los permisos que acepta la política de lectura de la OS (`ver_ordenes_servicio`,
 * migración 20261015141000). Si la ruta pidiera otro, quien la ve en la lista
 * recibiría «sin permiso», o la ruta dejaría pasar a quien el RLS le esconde la fila.
 */
const LEEN_SERVICIOS = ['compras.ver', 'compras.crear', 'compras.detraccion', 'tesoreria.ver_documentos', 'costos.ver']

/** El nombre de quien firma, en mayúsculas como el resto del papel. */
function nombreDe(u: { nombres: string; apellidos: string } | null) {
  const nombre = u ? `${u.nombres} ${u.apellidos}`.trim() : ''
  return nombre ? nombre.toUpperCase() : null
}

const numeroONulo = (v: number | null) => (v === null ? null : Number(v))

export async function GET(_request: Request, context: RouteContext<'/compras/servicios/[id]/pdf'>) {
  const perfil = await exigirSesion()
  const { id } = await context.params
  // Con la sesión de quien descarga: lo que el RLS le esconde no sale en el papel.
  const db = await createClient()
  // La política también deja leer al puesto que aprueba las compras, sin permiso aparte.
  if (!puede(perfil, LEEN_SERVICIOS)) {
    const aprueba = await db.rpc('es_aprobador_compras')
    if (aprueba.data !== true) redirect('/sin-permiso')
  }
  // Un id que no es uuid haría fallar la consulta con un 500: no hay tal orden.
  if (!z.guid().safeParse(id).success) return NextResponse.json({ error: 'La orden de servicio no está disponible.' }, { status: 404 })
  const logo = leerLogoDocumento()
  const [servicio, listado] = await Promise.all([
    db
      .from('ordenes_servicio')
      .select(
        'id, numero, referencia, proveedor, descripcion, fecha_inicio, fecha_fin, moneda, monto, condicion_pago, dias_credito, aprobacion, aprobado_en, estado, anulado_en, motivo_anulacion, codigo_interno, creado_en, detraccion_afecta, detraccion_codigo, detraccion_porcentaje, detraccion_minimo, detraccion_motivo, total_con_igv_pen, detraccion_monto, emisor:usuarios!ordenes_servicio_creado_por_fkey(nombres, apellidos), aprobador:usuarios!ordenes_servicio_aprobado_por_fkey(nombres, apellidos), anulador:usuarios!ordenes_servicio_anulado_por_fkey(nombres, apellidos), padron:proveedores(tipo_documento, numero_documento, direccion, telefono, contacto), ot:ordenes_trabajo(numero), area:areas(nombre), tipo_detraccion:detracciones_servicio(descripcion)',
      )
      .eq('id', id)
      .maybeSingle(),
    // La OT y la unidad, como las muestra la lista: Almacén y Requerimientos leen las
    // OS pero no `ordenes_trabajo`, y ningún puesto de compras lee `unidades`. El
    // listado (definer) las trae, solo de las 300 últimas OS; para una más vieja la
    // OT sale del embebido si quien descarga lee las OT, y la unidad no sale.
    db.rpc('ordenes_servicio_listado').eq('id', id).maybeSingle(),
  ])
  if (servicio.error) return NextResponse.json({ error: 'No se pudo leer la orden de servicio.' }, { status: 500 })
  if (!servicio.data) return NextResponse.json({ error: 'La orden de servicio no está disponible.' }, { status: 404 })
  const o = servicio.data
  // Una OS por aprobar o rechazada no sale en papel: el papel es lo que se le
  // entrega al contratista.
  const motivo = servicioSinPapel(o.aprobacion, o.estado)
  if (motivo) {
    return NextResponse.json({ error: `La orden de servicio ${o.numero} no se puede descargar: ${motivo}` }, { status: 409 })
  }

  const fila = listado.error ? null : listado.data
  // La base exige motivo, quién y cuándo para anular (`ck_os_estado`).
  const anulada = o.estado === 'ANULADA'
  const padron = o.padron
  const buffer = await renderToBuffer(
    <DocumentoOrdenServicio
      logo={await logo}
      servicio={{
        numero: o.numero,
        referenciaProveedor: o.referencia,
        emitida: o.creado_en,
        inicio: o.fecha_inicio,
        fin: o.fecha_fin,
        condicion: o.condicion_pago,
        dias: o.dias_credito,
        divisa: o.moneda === 'USD' ? 'USD' : 'PEN',
        monto: Number(o.monto),
        descripcion: o.descripcion,
        codigoInterno: o.codigo_interno?.trim() || null,
        orden: o.ot?.numero ?? fila?.orden ?? null,
        unidad: fila?.unidad ?? null,
        area: o.area?.nombre ?? fila?.area ?? null,
        detraccion: {
          afecta: o.detraccion_afecta,
          codigo: o.detraccion_codigo,
          descripcion: o.tipo_detraccion?.descripcion ?? null,
          porcentaje: numeroONulo(o.detraccion_porcentaje),
          minimo: numeroONulo(o.detraccion_minimo),
          motivo: o.detraccion_motivo,
          total_con_igv_pen: numeroONulo(o.total_con_igv_pen),
          monto: numeroONulo(o.detraccion_monto),
        },
        emitidaPor: nombreDe(o.emisor),
        aprobadaPor: nombreDe(o.aprobador),
        aprobadaEn: o.aprobado_en,
        anulacion: anulada ? { motivo: o.motivo_anulacion ?? '', por: nombreDe(o.anulador), en: o.anulado_en ?? '' } : null,
        proveedor: {
          nombre: o.proveedor,
          documento: padron ? `${padron.tipo_documento} ${padron.numero_documento}` : null,
          direccion: padron?.direccion ?? null,
          telefono: padron?.telefono ?? null,
          contacto: padron?.contacto ?? null,
        },
      }}
    />,
  )
  const nombre = `MW-Servicio-${o.numero.replace(/[^a-zA-Z0-9-]/g, '_')}${anulada ? '-ANULADA' : ''}.pdf`
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${nombre}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
