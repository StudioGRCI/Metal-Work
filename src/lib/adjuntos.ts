import { registrarAdjunto } from '@/app/(app)/ordenes/[id]/acciones-adjuntos'
import type { ResultadoAccion } from '@/lib/acciones'
import { createClient } from '@/lib/supabase/client'

/**
 * Subir un archivo a la orden, desde el navegador (migración 099).
 *
 * El archivo va directo a Storage —bucket `adjuntos-ot`, ruta `ot/{orden}/…`,
 * que es de donde las políticas sacan de qué orden es— y después una acción lo
 * anota en `ot_adjuntos`. Si la anotación falla, el archivo se quita: no queda
 * un archivo suelto que nadie ve.
 */
export const MAXIMO_ADJUNTO_MB = 20

const TIPOS = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const

export async function subirAdjunto(
  ordenId: string,
  archivo: File,
  tipo: 'ORDEN' | 'CRONOGRAMA',
): Promise<ResultadoAccion> {
  const esPdf = archivo.type === TIPOS.pdf || /\.pdf$/i.test(archivo.name)
  const esExcel = archivo.type === TIPOS.xlsx || /\.xlsx$/i.test(archivo.name)

  if (tipo === 'ORDEN' && !esPdf) return { ok: false, error: 'La orden se sube en PDF.' }
  if (tipo === 'CRONOGRAMA' && !esExcel) return { ok: false, error: 'El cronograma se sube en Excel (.xlsx).' }
  if (archivo.size > MAXIMO_ADJUNTO_MB * 1024 * 1024) {
    return { ok: false, error: `El archivo pesa más de ${MAXIMO_ADJUNTO_MB} MB.` }
  }

  const ruta = `ot/${ordenId}/${crypto.randomUUID()}.${esPdf ? 'pdf' : 'xlsx'}`
  const contentType = esPdf ? TIPOS.pdf : TIPOS.xlsx
  const supabase = createClient()

  const { error } = await supabase.storage.from('adjuntos-ot').upload(ruta, archivo, { contentType, upsert: false })
  if (error) return { ok: false, error: 'No se pudo subir el archivo. Revisa la señal y vuelve a intentar.' }

  const datos = new FormData()
  datos.set('orden_id', ordenId)
  datos.set('tipo', tipo)
  datos.set('nombre_archivo', archivo.name.slice(0, 200))
  datos.set('ruta_storage', ruta)
  datos.set('mime_type', contentType)
  datos.set('tamano_bytes', String(archivo.size))

  // Si la anotación no entra —o se cae por el camino— el archivo se quita: un
  // archivo en Storage que ninguna fila nombra no lo ve nadie y no lo borra
  // nadie. Pasó una vez con el Excel de un cronograma.
  try {
    const resultado = await registrarAdjunto(null, datos)
    if (!resultado.ok) await supabase.storage.from('adjuntos-ot').remove([ruta])
    return resultado
  } catch {
    await supabase.storage.from('adjuntos-ot').remove([ruta])
    return { ok: false, error: 'No se pudo anotar el archivo en la orden. Vuelve a intentar.' }
  }
}
