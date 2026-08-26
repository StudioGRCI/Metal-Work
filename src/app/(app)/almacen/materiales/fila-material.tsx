'use client'

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useState } from 'react'

import { Insignia } from '@/components/ui/etiqueta-estado'
import type { CatalogoCodificacion, MaterialCatalogo } from '@/lib/datos/codificacion'

import { CodificarMaterial, FichaAlmacen } from './codificar'

const TONO_CRITICIDAD = { A: 'peligro', B: 'aviso', C: 'neutro' } as const

/**
 * Una fila por material; se despliega para codificarlo o corregir su ficha.
 * El despliegue es estado local puro: no toca la URL ni recarga nada.
 */
export function FilaMaterial({
  material,
  catalogo,
  puedeEditar,
}: {
  material: MaterialCatalogo
  catalogo: CatalogoCodificacion
  puedeEditar: boolean
}) {
  const [abierto, setAbierto] = useState(false)

  return (
    <>
      <tr className="border-b border-borde text-sm last:border-0">
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={() => setAbierto((a) => !a)}
            disabled={!puedeEditar}
            aria-expanded={abierto}
            aria-label={`Desplegar ${material.descripcion}`}
            className="flex items-center gap-2 text-left disabled:cursor-default"
          >
            {puedeEditar &&
              (abierto ? (
                <ChevronDown aria-hidden className="size-3.5 shrink-0 text-texto-tenue" />
              ) : (
                <ChevronRight aria-hidden className="size-3.5 shrink-0 text-texto-tenue" />
              ))}
            <span>
              <span className="font-medium text-texto">{material.descripcion}</span>
              <span className="block text-[11px] text-texto-suave">
                {material.categoria?.nombre ?? '—'} · {material.unidad?.codigo ?? ''}
              </span>
            </span>
          </button>
        </td>
        <td className="tabular px-3 py-2 whitespace-nowrap">
          {material.codigo_almacen ?? <span className="text-aviso">sin codificar</span>}
        </td>
        <td className="tabular px-3 py-2 text-texto-suave">{material.codigo}</td>
        <td className="px-3 py-2 text-center">
          {material.criticidad ? (
            <Insignia tono={TONO_CRITICIDAD[material.criticidad]}>{material.criticidad}</Insignia>
          ) : (
            <span className="text-xs text-texto-tenue">—</span>
          )}
        </td>
        <td className="tabular px-3 py-2 text-texto-suave">{material.ubicacion ?? '—'}</td>
        <td className="px-3 py-2 text-xs text-texto-suave">
          {[
            material.controla_lote && 'lote',
            material.controla_serie && 'serie',
            material.controla_caducidad && 'caducidad',
          ]
            .filter(Boolean)
            .join(' · ') || '—'}
        </td>
      </tr>
      {abierto && puedeEditar && (
        <tr className="border-b border-borde bg-superficie-2 last:border-0">
          <td colSpan={6} className="space-y-3 px-4 py-3">
            {!material.codigo_almacen && (
              <CodificarMaterial materialId={material.id} catalogo={catalogo} />
            )}
            <FichaAlmacen
              materialId={material.id}
              criticidad={material.criticidad}
              ubicacion={material.ubicacion}
            />
          </td>
        </tr>
      )}
    </>
  )
}
