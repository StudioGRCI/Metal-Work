import { useEffect, useId, useSyncExternalStore } from 'react'

/**
 * Un estado que comparten los componentes montados con la misma `clave`. La
 * orden pinta cada actividad dos veces —la tarjeta del teléfono y la fila del
 * monitor, una oculta con CSS— y cada «Reportar día» llevaba el suyo: al girar
 * el teléfono, el que quedaba a la vista no sabía del envío que seguía en
 * camino, dejaba mandar otro, y el desenlace y el aviso verde salían en el
 * oculto (crítica de la vigesimoctava pasada).
 *
 * Sin `clave` es de este componente, como `useState`. Lo de una clave que ya no
 * monta nadie se olvida, y lo que llega después (un envío que contesta con la
 * pantalla ya cerrada) no se guarda. `inicial` es un valor que no cambia de una
 * pintada a otra (`null`, `false`, un texto): React compara lo que devuelve.
 */
const valores = new Map<string, unknown>()
const montados = new Map<string, number>()
const oyentes = new Map<string, Set<() => void>>()

export function useEstadoCompartido<T>(clave: string | null | undefined, inicial: T): [T, (valor: T) => void] {
  const propia = useId()
  const llave = clave ?? `propio${propia}`
  const valor = useSyncExternalStore(
    (avisar) => {
      const suyos = oyentes.get(llave) ?? new Set()
      oyentes.set(llave, suyos)
      suyos.add(avisar)
      return () => {
        suyos.delete(avisar)
        if (suyos.size === 0) oyentes.delete(llave)
      }
    },
    () => (valores.has(llave) ? (valores.get(llave) as T) : inicial),
    () => inicial,
  )
  useEffect(() => {
    montados.set(llave, (montados.get(llave) ?? 0) + 1)
    return () => {
      const quedan = (montados.get(llave) ?? 1) - 1
      if (quedan > 0) return void montados.set(llave, quedan)
      montados.delete(llave)
      valores.delete(llave)
    }
  }, [llave])
  const poner = (nuevo: T) => {
    if (!montados.has(llave)) return
    valores.set(llave, nuevo)
    for (const avisar of oyentes.get(llave) ?? []) avisar()
  }
  return [valor, poner]
}
