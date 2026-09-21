'use client'

import { useRouter } from 'next/navigation'
import { marcarAvisoLeido, marcarTodosLeidos } from '@/app/(app)/acciones-avisos'
import { useAccion } from '@/lib/envio'
import { destinoAviso } from '@/lib/dominio/destino-aviso'
import type { Notificacion } from '@/lib/datos/notificaciones'

export function useAvisos(alAbrir?: () => void) {
  const router = useRouter()
  const accion = useAccion<{ destino: string | null; abrir: boolean }>(async (_, datos) => {
    try {
      const id = datos.get('id')
      const resultado = typeof id === 'string' ? await marcarAvisoLeido(id) : await marcarTodosLeidos()
      if (!resultado.ok) return resultado
      const ruta = datos.get('ruta')
      return { ok: true, datos: { destino: typeof ruta === 'string' ? destinoAviso(ruta, null) : null, abrir: typeof id === 'string' } }
    } catch {
      return { ok: false, error: 'No se pudo guardar la lectura. Comprueba tu conexión y vuelve a intentarlo.' }
    }
  }, ({ datos }) => {
    if (datos?.abrir) alAbrir?.()
    if (datos?.destino) router.push(datos.destino)
  })
  function abrir(aviso: Notificacion) {
    const datos = new FormData()
    datos.set('id', aviso.id)
    const destino = destinoAviso(aviso.ruta, aviso.origen_id)
    if (destino) datos.set('ruta', destino)
    accion.ejecutar(datos)
  }
  return { abrir, marcarTodos: () => accion.ejecutar(new FormData()), marcando: accion.enviando, error: accion.error }
}
