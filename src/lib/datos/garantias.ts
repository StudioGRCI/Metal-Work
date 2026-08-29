import 'server-only'

import { createClient } from '@/lib/supabase/server'

export type GarantiaResumen = {
  entrega_id: string
  orden_id: string
  orden: string
  placa: string | null
  marca: string | null
  cliente: string
  carroceria: string | null
  fecha_entrega: string
  garantia_meses: number
  garantia_vence: string
  vigente: boolean
  dias_restantes: number
  reclamos: number
  reclamos_abiertos: number
}

export type ReclamoGarantia = {
  id: string
  numero: string
  entrega_id: string
  fecha_reclamo: string
  reportado_por: string | null
  contacto: string | null
  descripcion: string
  dentro_de_garantia: boolean
  estado: 'RECIBIDO' | 'EN_EVALUACION' | 'PROCEDE' | 'NO_PROCEDE' | 'ATENDIDO'
  evaluacion: string | null
  atendido_en: string | null
  atendido: { nombres: string; apellidos: string } | null
  entrega: {
    garantia_vence: string
    orden: { id: string; numero: string; unidad: { placa: string } | null; cliente: { razon_social: string } } | null
  } | null
}

/** Las unidades entregadas con garantía, las vigentes primero. */
export async function listarGarantias(soloVigentes = false): Promise<GarantiaResumen[]> {
  const supabase = await createClient()

  let consulta = supabase
    .from('garantias_resumen')
    .select('*')
    .order('garantia_vence', { ascending: true })
    .limit(200)

  if (soloVigentes) consulta = consulta.eq('vigente', true)

  const { data, error } = await consulta
  if (error) throw new Error(`No se pudieron leer las garantías: ${error.message}`)
  // Las vigentes arriba, las vencidas al final.
  return ((data ?? []) as unknown as GarantiaResumen[]).sort(
    (a, b) => Number(b.vigente) - Number(a.vigente),
  )
}

/** Los reclamos, los abiertos primero. */
export async function listarReclamos(): Promise<ReclamoGarantia[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('garantia_reclamos')
    .select(
      'id, numero, entrega_id, fecha_reclamo, reportado_por, contacto, descripcion, dentro_de_garantia, estado, evaluacion, atendido_en, atendido:usuarios!garantia_reclamos_atendido_por_fkey(nombres, apellidos), entrega:ot_entregas(garantia_vence, orden:ordenes_trabajo(id, numero, unidad:unidades(placa, codigo_interno, numero_chasis, marca, modelo), cliente:clientes(razon_social)))',
    )
    .order('creado_en', { ascending: false })
    .limit(200)

  if (error) throw new Error(`No se pudieron leer los reclamos: ${error.message}`)
  return (data ?? []) as unknown as ReclamoGarantia[]
}
