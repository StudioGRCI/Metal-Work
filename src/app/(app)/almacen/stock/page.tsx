import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { StockAlmacen } from '@/app/(app)/materiales/atencion/tablero'
import { cargarAtencionMateriales } from '@/lib/datos/atencion-materiales'
import { cantidad, fechaHora } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Stock de Almacén' }

export default async function PaginaStockAlmacen() {
  await exigirPermiso('almacen.recibir')
  const db = await createClient()
  const [datos, movimientos, conteos] = await Promise.all([
    cargarAtencionMateriales({
      verRequerimientos: false, verExistencias: true, verCompras: false,
      crearCompra: false, recibir: false, despachar: false,
    }),
    db.from('movimientos_materiales')
      .select('id,tipo,cantidad,documento_referencia,registrado_en,requerimiento_detalle_id,material_id,origen,recibido_por_nombre,foto_ruta,codigo_unidad')
      .order('registrado_en', { ascending: false }).limit(80),
    db.from('conteos_inventario')
      .select('id,material_id,cantidad_fisica,ajuste,motivo,registrado_en')
      .order('registrado_en', { ascending: false }).limit(40),
  ])
  if (movimientos.error || conteos.error) throw new Error('No se pudo cargar el historial del almacén. Recarga la página.')
  const idsDetalle = [...new Set((movimientos.data ?? []).map(m => m.requerimiento_detalle_id).filter((id):id is string=>Boolean(id)))]
  const detalles = idsDetalle.length
    ? await db.from('requerimiento_material_detalles').select('id,ot_material_id').in('id', idsDetalle)
    : { data: [], error: null }
  if (detalles.error) throw new Error('No se pudo identificar el material de los movimientos.')
  const idsOtMaterial = [...new Set((detalles.data ?? []).map(d => d.ot_material_id))]
  const materialesOt = idsOtMaterial.length
    ? await db.from('ot_materiales').select('id,material_id,orden_id').in('id', idsOtMaterial)
    : { data: [], error: null }
  if (materialesOt.error) throw new Error('No se pudo identificar la OT de los movimientos.')
  const idsOrden = [...new Set((materialesOt.data ?? []).map(m => m.orden_id))]
  const ordenes = idsOrden.length
    ? await db.from('ordenes_trabajo').select('id,numero').in('id', idsOrden)
    : { data: [], error: null }
  if (ordenes.error) throw new Error('No se pudo cargar la referencia de las OT.')
  const materialPorId = new Map(datos.catalogoAlmacen.map(m => [m.id, m]))
  const detallePorId = new Map((detalles.data ?? []).map(d => [d.id, d]))
  const otMaterialPorId = new Map((materialesOt.data ?? []).map(m => [m.id, m]))
  const ordenPorId = new Map((ordenes.data ?? []).map(o => [o.id, o]))
  const eventos = [
    ...(movimientos.data ?? []).map(m => {
      const otMaterial = otMaterialPorId.get(detallePorId.get(m.requerimiento_detalle_id??'')?.ot_material_id ?? '')
      const materialId=m.material_id??otMaterial?.material_id??''
      return {
        id: m.id, fecha: m.registrado_en, material: materialPorId.get(materialId)?.descripcion ?? 'Material',
        detalle: m.tipo === 'INGRESO' ? `Ingreso · ${m.documento_referencia ?? 'sin referencia'}` : `Entrega a ${m.recibido_por_nombre??'su área'}${m.codigo_unidad ? ` · ${m.codigo_unidad}` : ''}`,
        foto: m.foto_ruta ? `/almacen/movimientos/${m.id}/evidencia` : null,
        cantidad: (m.tipo === 'INGRESO' ? 1 : -1) * Number(m.cantidad),
        unidad: materialPorId.get(materialId)?.unidad ?? '',
        orden: otMaterial ? ordenPorId.get(otMaterial.orden_id) : null,
      }
    }),
    ...(conteos.data ?? []).map(c => ({
      id: c.id, fecha: c.registrado_en, material: materialPorId.get(c.material_id)?.descripcion ?? 'Material',
      detalle: `Conteo físico · ${c.motivo}`, cantidad: Number(c.ajuste),
      unidad: materialPorId.get(c.material_id)?.unidad ?? '', orden: null, foto:null,
    })),
  ].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 100)

  return <>
    <EncabezadoPagina titulo="Stock de Almacén"
      descripcion="Consulta el saldo, registra conteos físicos y revisa los ingresos y salidas. Cada solicitud se atiende dentro de su OT." />
    <div className="space-y-5">
      <StockAlmacen existencias={datos.existencias} catalogoAlmacen={datos.catalogoAlmacen} despachos={eventos.filter(e=>e.cantidad<0&&e.detalle.startsWith('Entrega')).map(e=>({id:e.id,etiqueta:`${e.material} · ${e.detalle} · ${cantidad(-e.cantidad)} ${e.unidad}`}))} />
      <Tarjeta>
        <TarjetaCabecera titulo="Ingresos, despachos y ajustes recientes"
          descripcion="Los movimientos de compra y despacho se registran desde Materiales de la OT; las salidas por unidad, desde el kardex."
          acciones={<Link href="/almacen/kardex" className="text-sm text-acento underline">Ver kardex completo</Link>} />
        <TarjetaCuerpo className="space-y-2">
          {eventos.length === 0 && <p className="text-sm text-texto-suave">Todavía no hay movimientos registrados.</p>}
          {eventos.map(e => <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-borde py-2 last:border-0">
            <div className="min-w-0">
              <p className="text-sm font-medium text-texto">{e.material}</p>
              <p className="text-xs text-texto-suave">{e.detalle} · {fechaHora(e.fecha)}
                {e.orden && <> · <Link className="text-acento underline" href={`/ordenes/${e.orden.id}?vista=materiales`}>OT {e.orden.numero}</Link></>}
              </p>
            </div>
            <p className="tabular whitespace-nowrap text-sm font-semibold text-texto">
              {e.foto&&<Link href={e.foto} target="_blank" className="mr-3 text-acento underline">Ver entrega</Link>}
              {e.cantidad > 0 ? '+' : ''}{cantidad(e.cantidad)} {e.unidad}
            </p>
          </div>)}
        </TarjetaCuerpo>
      </Tarjeta>
    </div>
  </>
}
