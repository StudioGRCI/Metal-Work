'use client'

import { Archive, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { useAccion } from '@/lib/envio'
import { cn } from '@/lib/utils'

import { cambiarEstadoCatalogo, eliminarCatalogo } from './acciones'

type TipoCatalogo = 'cliente' | 'unidad' | 'carroceria'

// El aviso dentro de `AccionesDeFila`: ancho cero y mínimo el del renglón, así
// baja a su propia línea y no le suma ancho a la columna.
const AVISO_EN_FILA = 'w-0 min-w-full text-pretty md:text-right'

export function AccionesCatalogo({
  tipo,
  id,
  nombre,
  activo,
  puedeEditar,
  esAdmin,
  enFila = false,
}: {
  tipo: TipoCatalogo
  id: string
  nombre: string
  activo: boolean
  puedeEditar: boolean
  esAdmin: boolean
  /**
   * Va dentro de un `AccionesDeFila`: sus botones se suman al renglón de los
   * demás (`contents`) y el aviso baja a su propia línea sin ensanchar la
   * columna. Al lado de los botones, en Carrocerías a 1280 px el aviso corría
   * la tabla 150 px y quedaba fuera de la vista (auditoría del 2026-11-25).
   * Tampoco pinta «Inactivo»: entre los botones mandaba «Reactivar» a otro
   * renglón. La pantalla lo dice junto al nombre, que es donde se lee primero.
   */
  enFila?: boolean
}) {
  const [confirmar, setConfirmar] = useState(false)
  const estado = useAccion(cambiarEstadoCatalogo, undefined, { documento: `${tipo}:${id}` })
  const borrado = useAccion(eliminarCatalogo, undefined, { documento: `${tipo}:${id}` })
  const datos = (incluyeActivo: boolean) => {
    const form = new FormData()
    form.set('tipo', tipo)
    form.set('id', id)
    if (incluyeActivo) form.set('activo', String(!activo))
    return form
  }

  return (
    <div className={enFila ? 'contents' : 'flex flex-wrap items-center gap-2'}>
      {!activo && !enFila && <span className="rounded-full bg-superficie-2 px-2 py-1 text-xs text-texto-suave">Inactivo</span>}
      {puedeEditar && (
        // Sin borde, como «Eliminar»: en listas de 34 filas pesaba igual que «Editar».
        <Boton type="button" tamano="sm" variante="fantasma" cargando={estado.enviando} onClick={() => estado.ejecutar(datos(true))}>
          {activo ? <Archive aria-hidden className="size-3.5" /> : <RotateCcw aria-hidden className="size-3.5" />}
          {activo ? 'Desactivar' : 'Reactivar'}
        </Boton>
      )}
      {esAdmin && !confirmar && (
        <Boton type="button" tamano="sm" variante="fantasma" onClick={() => setConfirmar(true)}>
          <Trash2 aria-hidden className="size-3.5 text-peligro" />
          Eliminar
        </Boton>
      )}
      {esAdmin && confirmar && (
        <span className="flex flex-wrap items-center gap-2 rounded-[var(--radius-base)] bg-peligro-suave px-2 py-1.5 text-xs text-peligro">
          ¿Eliminar «{nombre}»? Si tiene historial, la base lo protegerá.
          <Boton type="button" tamano="sm" variante="peligro" cargando={borrado.enviando} onClick={() => borrado.ejecutar(datos(false))}>
            Sí, eliminar
          </Boton>
          <Boton type="button" tamano="sm" variante="fantasma" onClick={() => setConfirmar(false)}>Cancelar</Boton>
        </span>
      )}
      {estado.resultado && !estado.resultado.ok && <span role="alert" className={cn('text-xs text-peligro', enFila && AVISO_EN_FILA)}>{estado.resultado.error}</span>}
      {borrado.resultado && !borrado.resultado.ok && <span role="alert" className={cn('text-xs text-peligro', enFila && AVISO_EN_FILA)}>{borrado.resultado.error}</span>}
      {estado.resultado?.ok && <span role="status" className={cn('text-xs text-exito', enFila && AVISO_EN_FILA)}>{estado.resultado.mensaje}</span>}
      {borrado.resultado?.ok && <span role="status" className={cn('text-xs text-exito', enFila && AVISO_EN_FILA)}>{borrado.resultado.mensaje}</span>}
    </div>
  )
}
