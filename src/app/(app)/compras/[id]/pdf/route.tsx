import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { renderToBuffer } from '@react-pdf/renderer'
import { NextResponse } from 'next/server'

import { DocumentoCompraMateriales, type LineaCompraPdf } from '@/lib/documentos/compra-materiales'
import { APROBACION_COMPRA, compraDetenida, cuentaParaCompra } from '@/lib/dominio/proveedores'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/** El logo va dentro del PDF; si no se pudo leer, la orden sale igual con el nombre en texto. */
async function leerLogo() {
  try {
    return await readFile(path.join(process.cwd(), 'public', 'marca', 'logo-metal-work.png'))
  } catch {
    return null
  }
}

export async function GET(_request: Request, context: RouteContext<'/compras/[id]/pdf'>) {
  await exigirPermiso(['compras.ver', 'almacen.recibir'])
  const { id } = await context.params
  const db = await createClient()
  const [compra, detalles] = await Promise.all([
    db
      .from('ordenes_compra_materiales')
      .select(
        'id, numero, referencia, proveedor, proveedor_id, fecha_estimada, condicion_pago, dias_credito, moneda, aprobacion, con_factura, codigo_interno, motivo, origen, recojo, creado_en, padron:proveedores(tipo_documento, numero_documento, direccion, direccion_recojo, telefono, contacto)',
      )
      .eq('id', id)
      .maybeSingle(),
    db
      .from('orden_compra_material_detalles')
      .select('id, cantidad, precio_unitario, requerimiento_detalle_id, material_id')
      .eq('orden_compra_id', id)
      .order('id'),
  ])
  if (compra.error || detalles.error) return NextResponse.json({ error: 'No se pudo leer la compra.' }, { status: 500 })
  if (!compra.data) return NextResponse.json({ error: 'La compra no está disponible.' }, { status: 404 })
  const c = compra.data
  const titulo = c.numero ?? c.referencia
  // Una compra por aprobar o rechazada no sale en papel: el papel es lo que se
  // le manda al proveedor.
  if (compraDetenida(c.aprobacion)) {
    return NextResponse.json(
      { error: `La compra ${titulo} no se puede descargar: ${APROBACION_COMPRA[c.aprobacion]?.descripcion ?? 'espera aprobación.'}` },
      { status: 409 },
    )
  }

  // Dos clases de línea: la que atiende un requerimiento de una OT y la de la
  // compra directa, que va al almacén y nombra el material sin pasar por una OT.
  const ids = (detalles.data ?? []).flatMap((d) => (d.requerimiento_detalle_id ? [d.requerimiento_detalle_id] : []))
  const directos = (detalles.data ?? []).flatMap((d) => (!d.requerimiento_detalle_id && d.material_id ? [d.material_id] : []))
  const [lineas, materiales, cuentas, insumos] = await Promise.all([
    ids.length
      ? db.from('v_atencion_materiales').select('detalle_id, numero_ot, material, material_codigo, unidad').in('detalle_id', ids)
      : Promise.resolve({ data: [], error: null }),
    directos.length
      ? db.from('materiales').select('id, codigo, descripcion, unidad:unidades_medida(codigo)').in('id', directos)
      : Promise.resolve({ data: [], error: null }),
    // El RLS decide: sin `proveedores.ver_cuentas` llega vacía y la orden sale sin cuenta.
    c.proveedor_id
      ? db.from('proveedor_cuentas').select('banco, numero_cuenta, titular, moneda').eq('proveedor_id', c.proveedor_id).eq('activo', true).order('creado_en')
      : Promise.resolve({ data: [], error: null }),
    // Los insumos de RQ que compra cada línea: el destino es el código de cada uno.
    db.rpc('insumos_de_compras', { p_ids: [c.id] }),
  ])
  if (lineas.error || materiales.error || cuentas.error || insumos.error) {
    return NextResponse.json({ error: 'No se pudieron identificar los insumos.' }, { status: 500 })
  }
  const porId = new Map((lineas.data ?? []).map((l) => [l.detalle_id, l]))
  const porMaterial = new Map((materiales.data ?? []).map((m) => [m.id, m]))
  if (ids.some((d) => !porId.has(d))) {
    return NextResponse.json({ error: 'No tienes acceso a todas las solicitudes de esta compra.' }, { status: 403 })
  }

  const codigo = c.codigo_interno?.trim() || null
  // «CÓDIGO · RQ-…» por cada código de los insumos de la línea, si la OC junta varios RQ.
  const destinoPorLinea = new Map<string, Map<string, Set<string>>>()
  for (const i of insumos.data ?? []) {
    if (!i.detalle_id || !i.codigo_interno || !i.requerimiento) continue
    const porCodigo = destinoPorLinea.get(i.detalle_id) ?? new Map<string, Set<string>>()
    porCodigo.set(i.codigo_interno, (porCodigo.get(i.codigo_interno) ?? new Set()).add(i.requerimiento))
    destinoPorLinea.set(i.detalle_id, porCodigo)
  }
  const destinoDeInsumos = (detalle: string) => {
    const porCodigo = destinoPorLinea.get(detalle)
    if (!porCodigo) return null
    return [...porCodigo].map(([cod, rqs]) => `${cod} · ${[...rqs].sort().join(', ')}`).join('; ')
  }
  const filas: LineaCompraPdf[] = (detalles.data ?? []).map((d) => {
    if (d.requerimiento_detalle_id) {
      const l = porId.get(d.requerimiento_detalle_id)
      return {
        id: d.id,
        codigo: l?.material_codigo ?? '',
        material: l?.material ?? '',
        unidad: l?.unidad ?? '',
        cantidad: Number(d.cantidad),
        precio: d.precio_unitario === null ? null : Number(d.precio_unitario),
        destino: [l?.numero_ot ? `OT ${l.numero_ot}` : null, codigo].filter(Boolean).join(' · ') || '—',
      }
    }
    const m = d.material_id ? porMaterial.get(d.material_id) : undefined
    return {
      id: d.id,
      codigo: m?.codigo ?? '',
      material: m?.descripcion ?? '',
      unidad: m?.unidad?.codigo ?? '',
      cantidad: Number(d.cantidad),
      precio: d.precio_unitario === null ? null : Number(d.precio_unitario),
      destino: destinoDeInsumos(d.id) ?? codigo ?? 'ALMACÉN',
    }
  })

  const divisa = c.moneda === 'USD' ? 'USD' : 'PEN'
  const cuenta = cuentaParaCompra(cuentas.data ?? [], divisa)
  const padron = c.padron
  const buffer = await renderToBuffer(
    <DocumentoCompraMateriales
      logo={await leerLogo()}
      lineas={filas}
      compra={{
        numero: titulo,
        referenciaProveedor: c.referencia,
        emitida: c.creado_en,
        entrega: c.fecha_estimada,
        condicion: c.condicion_pago,
        dias: c.dias_credito,
        divisa,
        conFactura: c.con_factura,
        motivo: c.motivo,
        aprobada: c.aprobacion === 'APROBADA',
        recojo: c.recojo !== null,
        proveedor: {
          nombre: c.proveedor,
          documento: padron ? `${padron.tipo_documento} ${padron.numero_documento}` : null,
          direccion: padron?.direccion ?? null,
          direccionRecojo: padron?.direccion_recojo ?? null,
          telefono: padron?.telefono ?? null,
          contacto: padron?.contacto ?? null,
        },
        cuenta: cuenta ? { banco: cuenta.banco, titular: cuenta.titular, numero: cuenta.numero_cuenta, moneda: cuenta.moneda } : null,
      }}
    />,
  )
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="MW-Compra-${titulo.replace(/[^a-zA-Z0-9-]/g, '_')}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
