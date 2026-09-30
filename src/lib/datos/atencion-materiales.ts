import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Tablas, Vistas } from '@/types/database'

export type LineaAtencionMaterial = Vistas<'v_atencion_materiales'> & {
  aprobacion_diseno: string
  decision_almacen: string
  cantidad_stock: number | null
}
export type CompraMaterialPendiente = Vistas<'v_orden_compra_material_pendiente'> & {
  entregado_almacen_en: string | null
  precio_unitario: number | null
  condicion_pago: string
  dias_credito: number
  moneda: string
  tiene_factura: boolean
  precios_completos: boolean
}
export type ExistenciaMaterial = Vistas<'v_existencias_materiales'>
export type MaterialParaConteo = { id: string; descripcion: string; codigo: string; unidad: string | null }
export type ResponsableMaterial = Pick<Tablas<'usuarios'>, 'id' | 'nombres' | 'apellidos' | 'area_id'>
export type AreaMaterial = Pick<Tablas<'areas'>, 'id' | 'codigo' | 'nombre'>

async function catalogoCompleto(db: Awaited<ReturnType<typeof createClient>>) {
  const materiales: MaterialParaConteo[]=[]
  let ultimo: string|undefined
  for (;;) {
    let consulta=db.from('materiales').select('id,descripcion,codigo,unidad:unidades_medida(codigo)')
      .eq('activo',true).eq('unidad_pendiente',false).order('id').limit(1000)
    if(ultimo)consulta=consulta.gt('id',ultimo)
    const {data,error}=await consulta
    if(error)throw new Error(`No se pudo cargar el catálogo de Almacén: ${error.message}`)
    materiales.push(...(data??[]).map(m=>({id:m.id,descripcion:m.descripcion,codigo:m.codigo,unidad:m.unidad?.codigo??null})))
    if(!data?.length||data.length<1000)break
    ultimo=data[data.length-1].id
  }
  return {data:materiales.sort((a,b)=>a.descripcion.localeCompare(b.descripcion,'es')),error:null}
}

async function existenciasCompletas(db: Awaited<ReturnType<typeof createClient>>) {
  const filas: ExistenciaMaterial[]=[]
  let ultimo: string|undefined
  for (;;) {
    let consulta=db.from('v_existencias_materiales').select('material_id,codigo,descripcion,unidad,existencia,reservado,disponible').order('material_id').limit(1000)
    if(ultimo)consulta=consulta.gt('material_id',ultimo)
    const {data,error}=await consulta
    if(error)throw new Error(`No se pudieron cargar las existencias: ${error.message}`)
    filas.push(...data??[])
    if(!data?.length||data.length<1000)break
    const id=data[data.length-1].material_id
    if(!id)throw new Error('No se pudo identificar el material de una existencia.')
    ultimo=id
  }
  return {data:filas.sort((a,b)=>(a.descripcion??'').localeCompare(b.descripcion??'','es')),error:null}
}

export async function cargarAtencionMateriales(permisos: {
  verRequerimientos: boolean
  verExistencias: boolean
  verCompras: boolean
  crearCompra: boolean
  recibir: boolean
  despachar: boolean
}, ordenId?: string) {
  const supabase = await createClient()
  const consultaAtencion = supabase
    .from('v_atencion_materiales')
    .select('requerimiento_id, detalle_id, orden_id, numero_ot, area_destino, ot_material_id, numero_plano, plano, material_id, material_codigo, material, unidad, cantidad_solicitada, cantidad_comprada, cantidad_recibida, cantidad_despachada, estado, responsables, solicitado_por, creado_en')
    .order('creado_en', { ascending: false })
    .limit(300)
  if (ordenId) consultaAtencion.eq('orden_id', ordenId)
  const [atencion, existencias, areas, catalogo] = await Promise.all([
    permisos.verRequerimientos
      ? consultaAtencion
      : Promise.resolve({ data: [], error: null }),
    permisos.verExistencias
      ? existenciasCompletas(supabase)
      : Promise.resolve({ data: [], error: null }),
    permisos.despachar
      ? supabase.from('areas').select('id, codigo, nombre').in('codigo', ['MTZ', 'PRD', 'ACB']).eq('activo', true)
      : Promise.resolve({ data: [], error: null }),
    permisos.verExistencias && !ordenId
      ? catalogoCompleto(supabase)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (atencion.error) throw new Error(`No se pudo cargar el avance de materiales: ${atencion.error.message}`)
  const idsRequerimiento = [...new Set((atencion.data ?? []).map((linea) => linea.requerimiento_id).filter((id): id is string => Boolean(id)))]
  const consultaCompras = supabase.from('v_orden_compra_material_pendiente')
    .select('id, requerimiento_id, requerimiento_detalle_id, proveedor, referencia, fecha_estimada, cantidad_comprada, cantidad_recibida, cantidad_pendiente, orden_compra_id')
    .order('fecha_estimada', { nullsFirst: false }).limit(300)
  if (ordenId && idsRequerimiento.length > 0) consultaCompras.in('requerimiento_id', idsRequerimiento)
  const compras = (permisos.verCompras || permisos.recibir || permisos.crearCompra) && (!ordenId || idsRequerimiento.length > 0)
    ? await consultaCompras : { data: [], error: null }
  if (compras.error) throw new Error(`No se pudieron cargar las compras pendientes: ${compras.error.message}`)
  if (areas.error) throw new Error(`No se pudieron cargar las áreas receptoras: ${areas.error.message}`)

  const idsArea = (areas.data ?? []).map((area) => area.id)
  const personas = permisos.despachar && idsArea.length > 0
    ? await supabase
        .from('usuarios')
        .select('id, nombres, apellidos, area_id')
        .in('area_id', idsArea)
        .eq('activo', true)
        .order('nombres')
        .limit(300)
    : { data: [], error: null }

  if (personas.error) throw new Error(`No se pudieron cargar las personas que reciben materiales: ${personas.error.message}`)

  const idsDetalle = (atencion.data ?? []).map((linea) => linea.detalle_id).filter((id): id is string => Boolean(id))
  const decisiones = idsDetalle.length > 0
    ? await supabase.from('requerimiento_material_detalles')
        .select('id, aprobacion_diseno, decision_almacen, cantidad_stock').in('id', idsDetalle)
    : { data: [], error: null }
  if (decisiones.error) throw new Error(`No se pudieron leer las revisiones de materiales: ${decisiones.error.message}`)
  const porDetalle = new Map((decisiones.data ?? []).map((d) => [d.id, d]))
  if (idsDetalle.some((id) => !porDetalle.has(id))) {
    throw new Error('Faltan revisiones de materiales. Recarga o consulta con Administración.')
  }
  const idsCompra = (compras.data ?? []).map((compra) => compra.orden_compra_id).filter((id): id is string => Boolean(id))
  const idsLineaCompra = (compras.data ?? []).map((compra) => compra.id).filter((id): id is string => Boolean(id))
  const [entregas, precios, facturas] = await Promise.all([
    idsCompra.length > 0
      ? supabase.from('ordenes_compra_materiales').select('id, entregado_almacen_en, condicion_pago, dias_credito, moneda').in('id', idsCompra)
      : Promise.resolve({ data: [], error: null }),
    idsLineaCompra.length > 0
      ? supabase.from('orden_compra_material_detalles').select('id, orden_compra_id, precio_unitario').in('orden_compra_id', idsCompra)
      : Promise.resolve({ data: [], error: null }),
    idsCompra.length > 0 && (permisos.crearCompra || permisos.verCompras)
      ? supabase.from('documentos_compra_material').select('orden_compra_id').in('orden_compra_id',idsCompra).eq('tipo','FACTURA')
      : Promise.resolve({ data: [], error: null }),
  ])
  if (entregas.error || precios.error || facturas.error) throw new Error('No se pudieron leer la entrega, facturas o precios de compra.')
  const entregaPorCompra = new Map((entregas.data ?? []).map((entrega) => [entrega.id, entrega]))
  const precioPorLinea = new Map((precios.data ?? []).map((precio) => [precio.id, precio.precio_unitario]))
  return {
    lineas: (atencion.data ?? []).map((linea) => ({
      ...linea,
      aprobacion_diseno: porDetalle.get(linea.detalle_id ?? '')?.aprobacion_diseno ?? 'PROPUESTO',
      decision_almacen: porDetalle.get(linea.detalle_id ?? '')?.decision_almacen ?? 'PENDIENTE',
      cantidad_stock: porDetalle.get(linea.detalle_id ?? '')?.cantidad_stock ?? null,
    })),
    existencias: existencias.data ?? [],
    catalogoAlmacen: catalogo.data ?? [],
    compras: (compras.data ?? []).map((compra) => ({
      ...compra,
      entregado_almacen_en: entregaPorCompra.get(compra.orden_compra_id ?? '')?.entregado_almacen_en ?? null,
      condicion_pago: entregaPorCompra.get(compra.orden_compra_id ?? '')?.condicion_pago ?? 'CONTADO',
      dias_credito: entregaPorCompra.get(compra.orden_compra_id ?? '')?.dias_credito ?? 0,
      moneda: entregaPorCompra.get(compra.orden_compra_id ?? '')?.moneda ?? 'PEN',
      precio_unitario: precioPorLinea.get(compra.id ?? '') ?? null,
      tiene_factura: (facturas.data ?? []).some(f=>f.orden_compra_id===compra.orden_compra_id),
      precios_completos: (precios.data ?? []).filter(p=>p.orden_compra_id===compra.orden_compra_id).every(p=>p.precio_unitario!==null),
    })),
    areas: areas.data ?? [],
    responsables: personas.data ?? [],
  }
}
