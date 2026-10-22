import 'server-only'

import { enlaces } from '@/lib/datos/facturacion'
import { nombreDeOc } from '@/lib/dominio/adquisiciones'
import { BUCKET_JUSTIFICANTES, cambiosDeCorreccion, idsDeCorreccion, type DocumentoCorregible } from '@/lib/dominio/correcciones'
import { cantidad, fecha, moneda } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'

/** Una corrección como se muestra en el historial del documento. */
export type CorreccionVista = {
  id: string
  corregido_en: string
  /** El área de quien corrigió (DKS, 12/10: en los registros va el área). */
  quien: string
  motivo: string
  /** Lo que cambió, en frases: «Total: S/ 1 180.00 → S/ 1 185.90». */
  cambios: string[]
  justificante: { nombre: string; url: string | null }
}

/**
 * El historial de correcciones de cada documento, del más viejo al más nuevo.
 * Lo ve quien ve el documento (política `ver_correcciones`); el justificante,
 * con un enlace firmado que vence a los diez minutos.
 */
export async function correccionesDe(
  documento: DocumentoCorregible,
  ids: string[],
  monedaDe: (id: string) => string | null = () => null,
): Promise<Map<string, CorreccionVista[]>> {
  const mapa = new Map<string, CorreccionVista[]>()
  if (ids.length === 0) return mapa
  const supabase = await createClient()
  const filas = []
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase
      .from('correcciones')
      .select(
        'id, documento_id, motivo, antes, despues, justificante_ruta, justificante_nombre, corregido_en, corregido:usuarios(area:areas!usuarios_area_id_fkey(nombre), rol:roles(nombre))',
      )
      .eq('documento', documento)
      .in('documento_id', ids.slice(i, i + 150))
      .order('corregido_en')
    if (error) throw new Error(`No se pudieron leer las correcciones: ${error.message}`)
    filas.push(...(data ?? []))
  }
  if (filas.length === 0) return mapa

  // Los números de las OC y los nombres de los materiales que nombran.
  const ordenes = new Set<string>()
  const materiales = new Set<string>()
  for (const c of filas) {
    const n = idsDeCorreccion(c.antes, c.despues)
    n.ordenes.forEach((id) => ordenes.add(id))
    n.materiales.forEach((id) => materiales.add(id))
  }
  const [oc, mat, urls] = await Promise.all([
    ordenes.size
      ? supabase.from('ordenes_compra_materiales').select('id, numero, referencia').in('id', [...ordenes])
      : Promise.resolve({ data: [], error: null }),
    materiales.size && documento === 'ORDEN_COMPRA'
      ? supabase.from('materiales').select('id, descripcion').in('id', [...materiales])
      : Promise.resolve({ data: [], error: null }),
    enlaces(BUCKET_JUSTIFICANTES, filas.map((c) => c.justificante_ruta)),
  ])
  // Si alguien no puede leer las OC o el catálogo, el historial sale igual, con «una OC» o «Línea 1».
  const numeroDe = new Map((oc.data ?? []).map((o) => [o.id, nombreDeOc(o)]))
  const nombreDe = new Map((mat.data ?? []).map((m) => [m.id, m.descripcion]))
  const formatos = {
    dinero: (n: number, m: 'PEN' | 'USD') => moneda(n, m),
    cantidad: (n: number) => cantidad(n),
    fecha: (iso: string) => fecha(iso),
    oc: (id: string) => numeroDe.get(id) ?? null,
    material: (id: string) => nombreDe.get(id) ?? null,
  }

  for (const c of filas) {
    const vista: CorreccionVista = {
      id: c.id,
      corregido_en: c.corregido_en,
      quien: c.corregido?.area?.nombre ?? c.corregido?.rol?.nombre ?? '—',
      motivo: c.motivo,
      cambios: cambiosDeCorreccion(documento, c.antes, c.despues, formatos, monedaDe(c.documento_id)),
      justificante: { nombre: c.justificante_nombre, url: urls.get(c.justificante_ruta) ?? null },
    }
    mapa.set(c.documento_id, [...(mapa.get(c.documento_id) ?? []), vista])
  }
  return mapa
}
