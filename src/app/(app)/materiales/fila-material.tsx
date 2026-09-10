'use client'

import { Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { TD, TR } from '@/components/ui/tabla'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import type { MaterialDelCatalogo } from '@/lib/datos/materiales'

import { cambiarEstadoMaterial, guardarMaterial } from './acciones'

type Catalogos = {
  categorias: { id: string; codigo: string; nombre: string }[]
  unidades: { id: string; codigo: string; nombre: string }[]
}



/** La misma ventana para dar de alta y para corregir: cambia solo lo que trae. */
function FormularioMaterial({
  material,
  catalogos,
  abierto,
  alCerrar,
}: {
  material: MaterialDelCatalogo | null
  catalogos: Catalogos
  abierto: boolean
  alCerrar: () => void
}) {
  const { alEnviar, enviando, error } = useEnvio(guardarMaterial, alCerrar)

  return (
    <Ventana
      abierta={abierto}
      alCerrar={alCerrar}
      titulo={material ? 'Corregir el material' : 'Nuevo material'}
      descripcion="Cómo se llama, en qué unidad se cuenta y su especificación, para que en el desglose de la orden todos elijan el mismo."
      ancho="md"
    >
      <form onSubmit={alEnviar} className="space-y-3">
        {material && <input type="hidden" name="id" value={material.id} />}

        <Campo etiqueta="Nombre" htmlFor="fm-descripcion" requerido>
          <Entrada
            id="fm-descripcion"
            name="descripcion"
            required
            defaultValue={material?.descripcion ?? ''}
            placeholder="Plancha LAC A36 6 mm"
            autoComplete="off"
          />
        </Campo>

        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Categoría" htmlFor="fm-categoria" requerido>
            <Seleccion id="fm-categoria" name="categoria_id" required defaultValue={material?.categoria?.id ?? ''}>
              <option value="" disabled>
                Elige una
              </option>
              {catalogos.categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>
          <Campo etiqueta="Unidad" htmlFor="fm-unidad" requerido ayuda="En qué se cuenta">
            <Seleccion id="fm-unidad" name="unidad_medida_id" required defaultValue={material?.unidad?.id ?? ''}>
              <option value="" disabled>
                Elige una
              </option>
              {catalogos.unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.codigo} · {u.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>
        </div>

        <Campo etiqueta="Especificación" htmlFor="fm-espec" ayuda="Norma, medida, calidad del acero">
          <Entrada
            id="fm-espec"
            name="especificacion_tecnica"
            defaultValue={material?.especificacion_tecnica ?? ''}
            placeholder="ASTM A36, 1220 × 2440 × 6 mm"
            autoComplete="off"
          />
        </Campo>

        <Campo etiqueta="Código" htmlFor="fm-codigo" ayuda="Si se deja vacío, se pone uno correlativo">
          <Entrada id="fm-codigo" name="codigo" defaultValue={material?.codigo ?? ''} autoComplete="off" maxLength={30} />
        </Campo>

        {error && (
          <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Boton type="button" variante="contorno" onClick={alCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" cargando={enviando}>
            Guardar
          </Boton>
        </div>
      </form>
    </Ventana>
  )
}

export function NuevoMaterial({ catalogos }: { catalogos: Catalogos }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <>
      <Boton onClick={() => setAbierto(true)}>
        <Plus aria-hidden className="size-4" />
        Nuevo material
      </Boton>
      <FormularioMaterial material={null} catalogos={catalogos} abierto={abierto} alCerrar={() => setAbierto(false)} />
    </>
  )
}

export function FilaMaterial({
  material,
  catalogos,
  puedeEditar,
}: {
  material: MaterialDelCatalogo
  catalogos: Catalogos
  puedeEditar: boolean
}) {
  const [editando, setEditando] = useState(false)
  const estado = useEnvio(cambiarEstadoMaterial)

  return (
    <TR className={material.activo ? undefined : 'opacity-60'}>
      <TD>
        <p className="text-sm font-medium text-texto">{material.descripcion}</p>
        <p className="text-[11px] text-texto-suave">
          {material.codigo}
          {!material.activo && (
            <Insignia tono="neutro" className="ml-2">
              retirado
            </Insignia>
          )}
        </p>
      </TD>
      <TD className="text-sm text-texto-suave">{material.categoria?.nombre ?? '—'}</TD>
      <TD className="text-sm text-texto-suave">{material.unidad?.codigo ?? '—'}</TD>
      <TD className="text-xs text-texto-suave">{material.especificacion_tecnica ?? '—'}</TD>
      {puedeEditar && (
        <TD>
          <div className="flex items-center justify-end gap-1">
            <Boton
              type="button"
              variante="fantasma"
              tamano="sm"
              aria-label={`Corregir ${material.descripcion}`}
              onClick={() => setEditando(true)}
            >
              <Pencil aria-hidden className="size-4" />
            </Boton>
            <form onSubmit={estado.alEnviar}>
              <input type="hidden" name="id" value={material.id} />
              <input type="hidden" name="activo" value={material.activo ? '0' : '1'} />
              <Boton
                type="submit"
                variante="fantasma"
                tamano="sm"
                cargando={estado.enviando}
                aria-label={material.activo ? `Retirar ${material.descripcion} del catálogo` : `Devolver ${material.descripcion} al catálogo`}
              >
                {material.activo ? (
                  <Trash2 aria-hidden className="size-4 text-peligro" />
                ) : (
                  <RotateCcw aria-hidden className="size-4" />
                )}
              </Boton>
            </form>
            {estado.error && (
              <p role="alert" className="text-xs text-peligro">
                {estado.error}
              </p>
            )}
          </div>
          <FormularioMaterial
            material={material}
            catalogos={catalogos}
            abierto={editando}
            alCerrar={() => setEditando(false)}
          />
        </TD>
      )}
    </TR>
  )
}
