import 'server-only'

import { todasLasFilas } from '@/lib/datos/todas-las-filas'
import type { CodigoParaElegir } from '@/lib/dominio/codigos-internos'
import { createClient } from '@/lib/supabase/server'

/**
 * Los códigos internos que ofrece el buscador de código (`EntradaCodigoInterno`):
 * los que conoce el sistema, con su unidad y si su costeo está cerrado
 * (`codigos_internos_para_elegir`, migración 20261020190000). La misma lista en
 * el requerimiento, la caja diaria, el costeo de horas, las observaciones de
 * RR. HH., la compra directa, la compra desde los materiales de una OT, el
 * servicio, el subcontrato y, desde la migración 20261021131000, la salida del
 * almacén sin RQ.
 *
 * Si no se puede leer, `null`: el campo dice que no hay lista y se escribe a
 * mano, como antes. Nadie se queda sin poder registrar por la lista.
 */
export async function codigosParaElegir(db?: Awaited<ReturnType<typeof createClient>>): Promise<CodigoParaElegir[] | null> {
  const supabase = db ?? (await createClient())
  const { data, error } = await todasLasFilas(() => supabase.rpc('codigos_internos_para_elegir'), ['codigo'])
  if (error) {
    console.error(`No se pudo leer la lista de códigos internos: ${error.message}`)
    return null
  }
  return data.flatMap((f) => (f.codigo ? [{ codigo: f.codigo, unidad: f.unidad, cerrado: f.cerrado === true, registrada: f.registrada === true }] : []))
}
