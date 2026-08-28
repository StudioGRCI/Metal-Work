'use client'

import { Tag } from 'lucide-react'
import { useActionState, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import type { CatalogoCodificacion } from '@/lib/datos/codificacion'
import { cn } from '@/lib/utils'

import { codificarMaterial, guardarFichaAlmacen } from './acciones'

function Aviso({ resultado }: { resultado: { ok?: boolean; error?: string; mensaje?: string } | null }) {
  if (!resultado?.mensaje && resultado?.ok !== false) return null
  const malo = resultado.ok === false
  return (
    <p
      role={malo ? 'alert' : 'status'}
      className={cn(
        'rounded-[var(--radius-base)] px-2 py-1 text-xs',
        malo ? 'bg-peligro-suave text-peligro' : 'bg-exito-suave text-exito',
      )}
    >
      {malo ? resultado.error : resultado.mensaje}
    </p>
  )
}

/**
 * Arma el código de cinco segmentos eligiendo cada uno del catálogo. La
 * vista previa enseña el código como va a quedar; el correlativo lo pone la
 * base al confirmar.
 */
export function CodificarMaterial({
  materialId,
  catalogo,
}: {
  materialId: string
  catalogo: CatalogoCodificacion
}) {
  const [resultado, accion, enviando] = useActionState(codificarMaterial, null)
  const [familia, setFamilia] = useState('')
  const [subfamilia, setSubfamilia] = useState('')
  const [material, setMaterial] = useState('')
  const [tipo, setTipo] = useState('')

  const subfamilias = catalogo.subfamilias.filter((s) => s.familia_codigo === familia)
  const tipos = catalogo.tipos.filter((t) => t.subfamilia_codigo === subfamilia)

  const vista = familia
    ? [familia, subfamilia || null, material || '··', tipo || null, '····']
        .filter(Boolean)
        .join('-')
    : null

  return (
    <form action={accion} className="space-y-2">
      <input type="hidden" name="material_id" value={materialId} />
      <div className="grid gap-2 sm:grid-cols-4">
        <Campo etiqueta="Familia" htmlFor={`familia-${materialId}`} requerido>
          <Seleccion
            id={`familia-${materialId}`}
            name="familia"
            required
            value={familia}
            onChange={(e) => {
              setFamilia(e.target.value)
              setSubfamilia('')
              setTipo('')
            }}
          >
            <option value="">Elegir…</option>
            {catalogo.familias.map((f) => (
              <option key={f.codigo} value={f.codigo}>
                {f.codigo} · {f.nombre}
              </option>
            ))}
          </Seleccion>
        </Campo>

        <Campo etiqueta="Subfamilia" htmlFor={`subfamilia-${materialId}`}>
          <Seleccion
            id={`subfamilia-${materialId}`}
            name="subfamilia"
            value={subfamilia}
            onChange={(e) => {
              setSubfamilia(e.target.value)
              setTipo('')
            }}
            disabled={subfamilias.length === 0}
          >
            <option value="">{subfamilias.length ? 'Elegir…' : 'No aplica'}</option>
            {subfamilias.map((s) => (
              <option key={s.codigo} value={s.codigo}>
                {s.codigo} · {s.nombre}
              </option>
            ))}
          </Seleccion>
        </Campo>

        <Campo etiqueta="Material" htmlFor={`material-${materialId}`} requerido>
          <Seleccion
            id={`material-${materialId}`}
            name="material"
            required
            value={material}
            onChange={(e) => setMaterial(e.target.value)}
          >
            <option value="">Elegir…</option>
            {catalogo.materiales.map((m) => (
              <option key={m.codigo} value={m.codigo}>
                {m.codigo} · {m.nombre}
              </option>
            ))}
          </Seleccion>
        </Campo>

        <Campo etiqueta="Tipo" htmlFor={`tipo-${materialId}`}>
          <Seleccion
            id={`tipo-${materialId}`}
            name="tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            disabled={tipos.length === 0}
          >
            <option value="">{tipos.length ? 'Elegir…' : 'No aplica'}</option>
            {tipos.map((t) => (
              <option key={t.codigo} value={t.codigo}>
                {t.codigo} · {t.nombre}
              </option>
            ))}
          </Seleccion>
        </Campo>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="tabular text-xs text-texto-suave">
          {vista ? (
            <>
              Va a quedar: <span className="font-medium text-texto">{vista}</span>
            </>
          ) : (
            'El correlativo lo asigna el sistema.'
          )}
        </p>
        <Boton type="submit" tamano="sm" cargando={enviando}>
          <Tag aria-hidden className="size-3.5" />
          Asignar código
        </Boton>
      </div>

      <Aviso resultado={resultado} />
    </form>
  )
}

/** Criticidad y ubicación, editables en la propia fila. */
export function FichaAlmacen({
  materialId,
  criticidad,
  ubicacion,
}: {
  materialId: string
  criticidad: 'A' | 'B' | 'C' | null
  ubicacion: string | null
}) {
  const [resultado, accion, enviando] = useActionState(guardarFichaAlmacen, null)

  return (
    <form action={accion} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="material_id" value={materialId} />
      {/* Ancho de columna en el monitor, ancho completo en el teléfono: un
          selector de 7 rem al lado de otro no se acierta con el dedo. */}
      <Campo etiqueta="Criticidad" htmlFor={`criticidad-${materialId}`} className="w-full sm:w-28">
        <Seleccion id={`criticidad-${materialId}`} name="criticidad" defaultValue={criticidad ?? ''}>
          <option value="">Sin clasificar</option>
          <option value="A">A · primero</option>
          <option value="B">B</option>
          <option value="C">C</option>
        </Seleccion>
      </Campo>
      <Campo
        etiqueta="Ubicación"
        htmlFor={`ubicacion-${materialId}`}
        ayuda="Pasillo–rack–nivel–posición"
        className="w-full sm:w-44"
      >
        <Entrada
          id={`ubicacion-${materialId}`}
          name="ubicacion"
          defaultValue={ubicacion ?? ''}
          placeholder="P2-R3-N1-05"
          autoComplete="off"
          autoCapitalize="characters"
        />
      </Campo>
      {/* En esta fila desplegada hay dos formularios: uno asigna el código y
          otro guarda esto. Un botón que solo dice «Guardar» no distingue cuál. */}
      <Boton type="submit" tamano="sm" variante="secundario" cargando={enviando}>
        Guardar ficha
      </Boton>
      <Aviso resultado={resultado} />
    </form>
  )
}
