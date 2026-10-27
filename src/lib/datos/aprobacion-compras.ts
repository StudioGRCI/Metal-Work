import 'server-only'

import { COLUMNAS_DETRACCION, cargarTiposDetraccion, detraccionDeFila, insumosPorCompra } from '@/lib/datos/logistica'
import { nombreDeOc } from '@/lib/dominio/adquisiciones'
import type { DetraccionDeServicio } from '@/lib/dominio/detraccion'
import { createClient } from '@/lib/supabase/server'

export type LineaParaAprobar = {
  /** Sin OT en la compra directa: va al almacén. */
  orden: string | null
  area: string | null
  material_codigo: string
  material: string
  unidad: string | null
  cantidad: number
  precio_unitario: number | null
}

/** Una orden de compra (OC) o de servicio (OS) en la bandeja de Gerencia. */
export type CompraParaAprobar = {
  tipo: 'OC' | 'OS'
  id: string
  numero: string
  referencia: string
  /** La OC de antes de la serie: no tiene número de la casa, y `numero` trae la referencia del proveedor. */
  sin_numero: boolean
  /** Cómo se nombra en una frase: el número, o «OC sin número (ref. del proveedor …)». */
  nombre: string
  /** REQUERIMIENTO o DIRECTA en una compra; SERVICIO en una orden de servicio. */
  origen: string
  /** Por qué se compra sin requerimiento, o qué se hace en el servicio. */
  motivo: string | null
  proveedor: string
  proveedor_documento: string | null
  moneda: string
  monto: number
  monto_pen: number | null
  condicion_pago: string
  dias_credito: number
  fecha_estimada: string | null
  aprobacion: string
  pedida_en: string | null
  emitida_por: string | null
  decidida_por: string | null
  decidida_en: string | null
  motivo_rechazo: string | null
  ordenes: string[]
  unidades: string[]
  lineas: LineaParaAprobar[]
  /** En la orden de servicio: el código de la unidad y su detracción. */
  codigo_interno: string | null
  /** Los RQ cuyos insumos compra la OC, y el código interno de cada uno. Vacíos si no compra de un RQ. */
  requerimientos: string[]
  codigos: string[]
  detraccion: DetraccionDeServicio | null
  /** La OC va con factura (lleva IGV) o con boleta (no lo lleva); la OS siempre con factura. */
  con_factura: boolean
}

export type ReglaAprobacion = {
  activa: boolean
  monto_desde: number
  rol_aprobador_id: string
  rol_aprobador: string | null
  actualizado_en: string
}

export type PuestoAprobador = { id: string; nombre: string }

/** Una OC aprobada (o sin aprobación) que todavía no llegó a Almacén: Gerencia la anula, o la base dice por qué ya no. */
export type CompraAnulable = {
  id: string
  /** Como la nombra la base: el número, o «OC sin número (ref. del proveedor …)». */
  numero: string
  /** La de antes de la serie, con su referencia aparte para la pantalla; false también si no se pudo leer. */
  sin_numero: boolean
  referencia: string | null
  proveedor: string
  moneda: string
  monto: number
  con_factura: boolean
  aprobacion: string
  aprobado_en: string | null
  creado_en: string | null
  recojo: string | null
  ordenes: string[]
  codigos: string[]
  /** Lo que impide anularla (algo entró, se recogió, se facturó o quedó pagado); null si se puede. */
  impide: string | null
}

/** Las OC que el puesto que aprueba las compras puede anular hoy, y las que ya no, con su motivo. */
export async function cargarComprasAnulables(): Promise<CompraAnulable[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('compras_que_se_pueden_anular')
  if (error) throw new Error(`No se pudieron leer las compras que se pueden anular: ${error.message}`)
  // La base ya la nombra «OC sin número (ref. del proveedor …)»; la pantalla pone
  // la referencia aparte, como en Facturas, para que no se parta en el teléfono.
  // Sin poder leerla, queda el nombre de la base.
  const ids = (data ?? []).flatMap((c) => (c.id ? [c.id] : []))
  const crudas = new Map<string, { numero: string | null; referencia: string }>()
  if (ids.length > 0) {
    const r = await supabase.from('ordenes_compra_materiales').select('id, numero, referencia').in('id', ids)
    if (r.error) console.error('No se pudo leer la referencia de las compras que se pueden anular', r.error)
    for (const o of r.data ?? []) crudas.set(o.id, { numero: o.numero, referencia: o.referencia })
  }
  return (data ?? []).map((c) => ({
    id: c.id ?? '',
    numero: c.numero ?? '',
    sin_numero: Boolean(c.id && crudas.has(c.id) && !crudas.get(c.id)?.numero),
    referencia: (c.id && crudas.get(c.id)?.referencia) || null,
    proveedor: c.proveedor ?? '',
    moneda: c.moneda ?? 'PEN',
    monto: Number(c.monto ?? 0),
    con_factura: c.con_factura ?? false,
    aprobacion: c.aprobacion ?? 'APROBADA',
    aprobado_en: c.aprobado_en,
    creado_en: c.creado_en,
    recojo: c.recojo,
    ordenes: c.ordenes ?? [],
    codigos: c.codigos ?? [],
    impide: c.impide,
  }))
}

/** ¿La persona en sesión es quien aprueba las compras? Lo decide la base. */
export async function esAprobadorDeCompras(): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('es_aprobador_compras')
  if (error) throw new Error(`No se pudo saber quién aprueba las compras: ${error.message}`)
  return data === true
}

export async function cargarAprobacionCompras(opciones: { puestos: boolean }) {
  const supabase = await createClient()
  const [regla, compras, roles] = await Promise.all([
    supabase
      .from('regla_aprobacion_compras')
      .select('activa, monto_desde, rol_aprobador_id, actualizado_en, rol:roles(nombre)')
      .maybeSingle(),
    supabase.rpc('documentos_por_aprobar'),
    opciones.puestos
      ? supabase.from('roles').select('id, codigo, nombre, nivel').order('nivel', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ])
  if (regla.error) throw new Error(`No se pudo leer la regla de aprobación: ${regla.error.message}`)
  if (compras.error) throw new Error(`No se pudieron leer las compras por aprobar: ${compras.error.message}`)
  if (roles.error) throw new Error(`No se pudieron leer los puestos: ${roles.error.message}`)

  // `documentos_por_aprobar` no trae el código ni la detracción de la OS: se
  // leen de la tabla, que Gerencia puede ver.
  const servicios = (compras.data ?? []).filter((c) => c.tipo === 'OS' && c.id).map((c) => c.id as string)
  const [extra, tipos] = servicios.length
    ? await Promise.all([supabase.from('ordenes_servicio').select(COLUMNAS_DETRACCION).in('id', servicios), cargarTiposDetraccion()])
    : [{ data: [], error: null }, []]
  if (extra.error) throw new Error(`No se pudo leer la detracción de las órdenes de servicio: ${extra.error.message}`)
  const porId = new Map((extra.data ?? []).map((f) => [f.id, f]))
  // Los RQ y los códigos de las OC que compran insumos de requerimientos (#100),
  // y si la OC va con factura o con boleta: `documentos_por_aprobar` no lo trae,
  // y sin eso la pantalla sumaría el IGV a una compra que no lo lleva.
  const idsOc = (compras.data ?? []).flatMap((c) => (c.tipo !== 'OS' && c.id ? [c.id] : []))
  const [insumos, comprobante] = await Promise.all([
    insumosPorCompra(supabase, idsOc),
    idsOc.length ? supabase.from('ordenes_compra_materiales').select('id, con_factura').in('id', idsOc) : Promise.resolve({ data: [], error: null }),
  ])
  if (comprobante.error) throw new Error(`No se pudo leer si las compras van con factura: ${comprobante.error.message}`)
  const conFactura = new Map((comprobante.data ?? []).map((o) => [o.id, o.con_factura ?? true]))

  return {
    regla: regla.data
      ? ({
          activa: regla.data.activa,
          monto_desde: Number(regla.data.monto_desde),
          rol_aprobador_id: regla.data.rol_aprobador_id,
          rol_aprobador: (regla.data.rol as { nombre: string } | null)?.nombre ?? null,
          actualizado_en: regla.data.actualizado_en,
        } satisfies ReglaAprobacion)
      : null,
    compras: (compras.data ?? []).map(
      (c): CompraParaAprobar => ({
        tipo: c.tipo === 'OS' ? 'OS' : 'OC',
        id: c.id ?? '',
        numero: c.numero ?? c.referencia ?? '',
        referencia: c.referencia ?? '',
        sin_numero: c.tipo !== 'OS' && !c.numero,
        nombre: c.tipo === 'OS' ? (c.numero ?? c.referencia ?? '') : nombreDeOc({ numero: c.numero, referencia: c.referencia }),
        origen: c.origen ?? 'REQUERIMIENTO',
        motivo: c.motivo,
        proveedor: c.proveedor ?? '',
        proveedor_documento: c.proveedor_documento,
        moneda: c.moneda ?? 'PEN',
        monto: Number(c.monto ?? 0),
        monto_pen: c.monto_pen === null ? null : Number(c.monto_pen),
        condicion_pago: c.condicion_pago ?? 'CONTADO',
        dias_credito: c.dias_credito ?? 0,
        fecha_estimada: c.fecha_estimada,
        aprobacion: c.aprobacion ?? 'POR_APROBAR',
        pedida_en: c.pedida_en,
        emitida_por: c.emitida_por,
        decidida_por: c.decidida_por,
        decidida_en: c.decidida_en,
        motivo_rechazo: c.motivo_rechazo,
        ordenes: c.ordenes ?? [],
        unidades: c.unidades ?? [],
        lineas: (c.lineas as LineaParaAprobar[] | null) ?? [],
        codigo_interno: c.tipo === 'OS' ? (porId.get(c.id ?? '')?.codigo_interno ?? null) : null,
        requerimientos: c.tipo === 'OS' ? [] : (insumos.get(c.id ?? '')?.requerimientos ?? []),
        codigos: c.tipo === 'OS' ? [] : (insumos.get(c.id ?? '')?.codigos ?? []),
        detraccion: c.tipo === 'OS' ? detraccionDeFila(porId.get(c.id ?? ''), tipos) : null,
        con_factura: c.tipo === 'OS' ? true : (conFactura.get(c.id ?? '') ?? true),
      }),
    ),
    // Operario y Solo consulta quedan fuera: la base tampoco los acepta. ADMIN
    // aprueba siempre, así que no se ofrece como puesto.
    puestos: (roles.data ?? [])
      .filter((r) => !['ADMIN', 'CONSULTA', 'OPERARIO'].includes(r.codigo))
      .map((r): PuestoAprobador => ({ id: r.id, nombre: r.nombre })),
  }
}
