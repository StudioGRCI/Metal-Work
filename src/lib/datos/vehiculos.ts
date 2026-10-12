import 'server-only'

import { createClient } from '@/lib/supabase/server'

/** Una vez que un vehículo entró a la planta, con su salida si ya salió. */
export type RegistroVehiculo = {
  id: string
  placa: string | null
  chasis: string | null
  codigo_interno: string | null
  unidad: string
  empresa: string
  motivo: string
  ingreso_en: string
  observacion_ingreso: string | null
  salida_en: string | null
  observacion_salida: string | null
  anulado_en: string | null
  motivo_anulacion: string | null
}

/** `en_planta`: lo que está adentro ahora. `historial`: los últimos 300 ingresos. */
export async function cargarVehiculos(vista: 'en_planta' | 'historial'): Promise<RegistroVehiculo[]> {
  const supabase = await createClient()
  let consulta = supabase
    .from('registro_vehiculos')
    .select(
      'id, placa, chasis, codigo_interno, unidad, empresa, motivo, ingreso_en, observacion_ingreso, salida_en, observacion_salida, anulado_en, motivo_anulacion',
    )
    .order('ingreso_en', { ascending: false })
    .limit(300)
  if (vista === 'en_planta') consulta = consulta.is('salida_en', null).is('anulado_en', null)
  const { data, error } = await consulta
  if (error) throw new Error(`No se pudo leer el registro de vehículos: ${error.message}`)
  return data ?? []
}
