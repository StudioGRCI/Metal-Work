'use client'

import { useRouter } from 'next/navigation'
import { useSyncExternalStore } from 'react'
import { marcarAvisoLeido, marcarTodosLeidos } from '@/app/(app)/acciones-avisos'
import { anotarQueHuboUnDespliegue, laCompilacionDeLaPestana, motivoDelFallo, navegarSiEsDeLaPestana, useAccion } from '@/lib/envio'
import { destinoAviso } from '@/lib/dominio/destino-aviso'
import type { Notificacion } from '@/lib/datos/notificaciones'

/**
 * Lo leído desde una pantalla de otro despliegue. Ahí repintar recargaría el
 * documento entero (`marcarAvisoLeido` no revalida), así que la campana y la
 * lista lo pintan leído desde aquí. Solo guarda los que el servidor tenía sin
 * leer: así el número baja una vez por aviso, en las dos.
 */
type LeidosAqui = { todos: boolean; ids: ReadonlySet<string> }
const NINGUNO: LeidosAqui = { todos: false, ids: new Set() }
let leidosAqui = NINGUNO
const oyentes = new Set<() => void>()

function leerAqui(id: string | null) {
  leidosAqui = id === null ? { ...leidosAqui, todos: true } : { ...leidosAqui, ids: new Set([...leidosAqui.ids, id]) }
  for (const avisar of oyentes) avisar()
}

function suscribirse(avisar: () => void) {
  oyentes.add(avisar)
  return () => void oyentes.delete(avisar)
}

export function useAvisos(avisos: Notificacion[], sinLeer: number, alAbrir?: () => void) {
  const router = useRouter()
  const aqui = useSyncExternalStore(suscribirse, () => leidosAqui, () => NINGUNO)
  // Sin repintar: la acción ya pone al día la pantalla, y donde no puede, la
  // recarga de `useAccion` se la llevaba entera (trigesimoprimera pasada).
  const accion = useAccion<{ destino: string | null; abrir: boolean }>(async (_, datos) => {
    try {
      const id = datos.get('id')
      const deLaPestana = laCompilacionDeLaPestana()
      const resultado = typeof id === 'string' ? await marcarAvisoLeido(id, deLaPestana) : await marcarTodosLeidos(deLaPestana)
      if (!resultado.ok) return resultado
      if (resultado.datos?.otroDespliegue) {
        anotarQueHuboUnDespliegue()
        if (typeof id !== 'string') leerAqui(null)
        else if (datos.get('sin_leer')) leerAqui(id)
      }
      const ruta = datos.get('ruta')
      return { ok: true, datos: { destino: typeof ruta === 'string' ? destinoAviso(ruta, null) : null, abrir: typeof id === 'string' } }
    } catch (e) {
      return { ok: false, error: motivoDelFallo(e, 'No se pudo guardar la lectura. Comprueba tu conexión y vuelve a intentarlo.') }
    }
  }, ({ datos }) => {
    if (datos?.abrir) alAbrir?.()
    if (datos?.destino) navegarSiEsDeLaPestana(router, datos.destino)
  }, { refrescar: false })
  function abrir(aviso: Notificacion) {
    const datos = new FormData()
    datos.set('id', aviso.id)
    if (!aviso.leida_en) datos.set('sin_leer', '1')
    const destino = destinoAviso(aviso.ruta, aviso.origen_id)
    if (destino) datos.set('ruta', destino)
    accion.ejecutar(datos)
  }
  return {
    abrir,
    marcarTodos: () => accion.ejecutar(new FormData()),
    marcando: accion.enviando,
    error: accion.error,
    leido: (aviso: Notificacion) => Boolean(aviso.leida_en) || aqui.todos || aqui.ids.has(aviso.id),
    sinLeer: aqui.todos ? 0 : Math.max(0, sinLeer - aqui.ids.size),
  }
}
