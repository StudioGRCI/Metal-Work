import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { accesoriosDeCotizacion, fichaDeCotizacion } from '@/lib/datos/ficha'
import type { AccesorioCotizado, SeccionFicha } from '@/lib/datos/ficha'

/** El membrete: lo que va impreso arriba de todo documento que sale de la casa. */
export type Membrete = {
  razon_social: string
  nombre_comercial: string | null
  ruc: string
  direccion: string | null
  distrito: string | null
  provincia: string | null
  departamento: string | null
  telefono: string | null
  correo: string | null
  web: string | null
}

export type PartidaImpresa = {
  descripcion: string
  cantidad: number
  unidad_medida: string | null
  precio_unitario: number
  descuento_porcentaje: number | null
  subtotal: number
}

export type CotizacionImpresa = {
  empresa: Membrete | null
  numero: string
  estado: string
  fecha_emision: string
  fecha_vencimiento: string | null
  moneda: string
  subtotal: number
  descuento: number
  igv: number
  igv_porcentaje: number
  total: number
  incluye_igv: boolean
  garantia_meses: number
  plazo_entrega_dias: number | null
  plazo_en_habiles: boolean
  forma_pago: string | null
  condiciones: string | null
  observaciones: string | null
  nota: string | null
  motivo_anulacion: string | null
  marca: string | null
  modelo: string | null
  tipo: string | null
  largo_m: number | null
  ancho_m: number | null
  alto_m: number | null
  capacidad: string | null
  peso_neto_tn: number | null
  cliente: {
    razon_social: string
    numero_documento: string
    direccion_fiscal: string | null
    distrito: string | null
    provincia: string | null
    telefono: string | null
  }
  contacto: { nombre: string | null; telefono: string | null; correo: string | null } | null
  unidad: { placa: string; marca: string | null; modelo: string | null } | null
  carroceria: string | null
  vendedor: { nombres: string; apellidos: string; telefono: string | null; correo: string | null } | null
  partidas: PartidaImpresa[]
  ficha: SeccionFicha[]
  accesorios: AccesorioCotizado[]
}

/**
 * Junta todo lo que la cotización impresa necesita en una sola pasada. Va
 * aparte de obtenerCotizacion() porque el papel pide más que la pantalla: los
 * datos fiscales de la casa, la dirección del cliente y el teléfono del
 * vendedor, que es a quien el cliente llama cuando recibe el documento.
 */
export async function cotizacionParaImprimir(id: string): Promise<CotizacionImpresa | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('cotizaciones')
    .select(
      `*,
       cliente:clientes!inner(razon_social, numero_documento, direccion_fiscal, distrito, provincia, telefono),
       contacto:contactos_cliente!cotizaciones_contacto_id_fkey(nombre, telefono, correo),
       unidad:unidades!cotizaciones_unidad_id_fkey(placa, marca, modelo),
       tipo_carroceria:tipos_carroceria(nombre),
       vendedor:usuarios!cotizaciones_vendedor_id_fkey(nombres, apellidos, telefono, correo),
       partidas:cotizacion_partidas(descripcion, cantidad, unidad_medida, precio_unitario, descuento_porcentaje, subtotal, orden_secuencia)`,
    )
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`No se pudo cargar la cotización: ${error.message}`)
  if (!data) return null

  const [ficha, accesorios, empresa] = await Promise.all([
    fichaDeCotizacion(id),
    accesoriosDeCotizacion(id),
    membrete(),
  ])

  const c = data as unknown as Record<string, unknown>
  // Las partidas salen impresas en el orden en que el vendedor las escribió.
  const partidas: PartidaImpresa[] = (
    (c.partidas ?? []) as (PartidaImpresa & { orden_secuencia: number })[]
  )
    .slice()
    .sort((a, b) => a.orden_secuencia - b.orden_secuencia)
    .map((p) => ({
      descripcion: p.descripcion,
      cantidad: Number(p.cantidad),
      unidad_medida: p.unidad_medida,
      precio_unitario: Number(p.precio_unitario),
      descuento_porcentaje: p.descuento_porcentaje === null ? null : Number(p.descuento_porcentaje),
      subtotal: Number(p.subtotal),
    }))

  return {
    empresa,
    numero: String(c.numero),
    estado: String(c.estado),
    fecha_emision: String(c.fecha_emision),
    fecha_vencimiento: (c.fecha_vencimiento as string | null) ?? null,
    moneda: String(c.moneda ?? 'PEN'),
    subtotal: Number(c.subtotal ?? 0),
    descuento: Number(c.descuento ?? 0),
    igv: Number(c.igv ?? 0),
    igv_porcentaje: Number(c.igv_porcentaje ?? 18),
    total: Number(c.total ?? 0),
    incluye_igv: Boolean(c.incluye_igv),
    garantia_meses: Number(c.garantia_meses ?? 0),
    plazo_entrega_dias: (c.plazo_entrega_dias as number | null) ?? null,
    plazo_en_habiles: Boolean(c.plazo_en_habiles),
    forma_pago: (c.forma_pago as string | null) ?? null,
    condiciones: (c.condiciones as string | null) ?? null,
    observaciones: (c.observaciones as string | null) ?? null,
    nota: (c.nota as string | null) ?? null,
    motivo_anulacion: (c.motivo_anulacion as string | null) ?? null,
    marca: (c.marca as string | null) ?? null,
    modelo: (c.modelo as string | null) ?? null,
    tipo: (c.tipo as string | null) ?? null,
    largo_m: numeroOpcional(c.largo_m),
    ancho_m: numeroOpcional(c.ancho_m),
    alto_m: numeroOpcional(c.alto_m),
    capacidad: (c.capacidad as string | null) ?? null,
    peso_neto_tn: numeroOpcional(c.peso_neto_tn),
    cliente: c.cliente as CotizacionImpresa['cliente'],
    contacto: primerContacto(c.contacto),
    unidad: (c.unidad as CotizacionImpresa['unidad']) ?? null,
    carroceria: (c.tipo_carroceria as { nombre: string } | null)?.nombre ?? null,
    vendedor: (c.vendedor as CotizacionImpresa['vendedor']) ?? null,
    partidas,
    ficha,
    accesorios,
  }
}

/** Los datos fiscales de la casa. Van por función porque la tabla empresa
 *  exige configuracion.ver y el membrete lo necesita cualquiera que cotice. */
export async function membrete(): Promise<Membrete | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('datos_de_empresa')

  // Sin membrete el documento igual sale: pierde el encabezado, no el contenido.
  if (error) return null
  const filas = (data ?? []) as unknown as Membrete[]
  return filas[0] ?? null
}

function numeroOpcional(valor: unknown): number | null {
  return valor === null || valor === undefined ? null : Number(valor)
}

/** El embed de contactos llega como lista aunque solo interese el primero. */
function primerContacto(valor: unknown): CotizacionImpresa['contacto'] {
  if (Array.isArray(valor)) return (valor[0] as CotizacionImpresa['contacto']) ?? null
  return (valor as CotizacionImpresa['contacto']) ?? null
}
