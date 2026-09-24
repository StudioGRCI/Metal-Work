import 'server-only'
import { createClient } from '@/lib/supabase/server'

export async function cotizacionesParaCambio(clienteId: string | null, carroceriaId: string | null) {
  const supabase = await createClient()
  let consulta = supabase.from('cotizaciones_pdf')
    .select('id, numero, cliente_id, cliente:clientes(razon_social)')
    .eq('estado', 'APROBADA')
  if (clienteId) consulta = consulta.neq('cliente_id', clienteId)
  if (carroceriaId) consulta = consulta.eq('tipo_carroceria_id', carroceriaId)
  const { data, error } = await consulta.order('creado_en', { ascending: false }).limit(200)
  if (error) throw new Error('No se pudieron cargar las cotizaciones para el cambio de cliente.')
  return data ?? []
}
