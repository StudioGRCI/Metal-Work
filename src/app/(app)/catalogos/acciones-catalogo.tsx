'use client'

import { Archive, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { useAccion } from '@/lib/envio'

import { cambiarEstadoCatalogo, eliminarCatalogo } from './acciones'

type TipoCatalogo = 'cliente' | 'unidad' | 'carroceria'

export function AccionesCatalogo({
  tipo,
  id,
  nombre,
  activo,
  puedeEditar,
  esAdmin,
}: {
  tipo: TipoCatalogo
  id: string
  nombre: string
  activo: boolean
  puedeEditar: boolean
  esAdmin: boolean
}) {
  const [confirmar, setConfirmar] = useState(false)
  const estado = useAccion(cambiarEstadoCatalogo)
  const borrado = useAccion(eliminarCatalogo)
  const datos = (incluyeActivo: boolean) => {
    const form = new FormData()
    form.set('tipo', tipo)
    form.set('id', id)
    if (incluyeActivo) form.set('activo', String(!activo))
    return form
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!activo && <span className="rounded-full bg-superficie-2 px-2 py-1 text-xs text-texto-suave">Inactivo</span>}
      {puedeEditar && (
        <Boton type="button" tamano="sm" variante="contorno" cargando={estado.enviando} onClick={() => estado.ejecutar(datos(true))}>
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
      {estado.resultado && !estado.resultado.ok && <span role="alert" className="text-xs text-peligro">{estado.resultado.error}</span>}
      {borrado.resultado && !borrado.resultado.ok && <span role="alert" className="text-xs text-peligro">{borrado.resultado.error}</span>}
      {estado.resultado?.ok && <span role="status" className="text-xs text-exito">{estado.resultado.mensaje}</span>}
      {borrado.resultado?.ok && <span role="status" className="text-xs text-exito">{borrado.resultado.mensaje}</span>}
    </div>
  )
}
