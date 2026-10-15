'use client'

import { Pencil } from 'lucide-react'
import { useMemo, useState } from 'react'

import { CamposDeCorreccion, useCorreccion } from '@/components/correcciones/justificante'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { MaterialParaRequerimiento, RequerimientoListado } from '@/lib/datos/requerimientos'
import { useEnvio } from '@/lib/envio'
import { hoyLima } from '@/lib/format'

import { corregirRequerimiento } from './acciones'

type Linea = { item: number; cantidad: string; material_id: string }

/**
 * Corregir un requerimiento registrado, con su motivo y su justificante. El
 * material de un insumo cambia solo mientras Almacén no revisa el stock; la
 * cantidad, mientras el insumo no va en una OC ni salió del almacén. La base lo
 * vuelve a comprobar y deja la corrección en el historial.
 */
export function CorregirRequerimiento({ rq, materiales }: { rq: RequerimientoListado; materiales: MaterialParaRequerimiento[] }) {
  const [abierta, setAbierta] = useState(false)
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierta(true)} aria-label={`Corregir el requerimiento ${rq.numero}`}>
        <Pencil aria-hidden className="size-4" />
        Corregir
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Corregir el requerimiento ${rq.numero}`}
        descripcion="Cambia solo lo que estaba mal. Queda en su historial con el motivo, quién, cuándo y el justificante."
        ancho="lg"
      >
        {abierta && <Formulario rq={rq} materiales={materiales} alTerminar={() => setAbierta(false)} />}
      </Ventana>
    </>
  )
}

function Formulario({ rq, materiales, alTerminar }: { rq: RequerimientoListado; materiales: MaterialParaRequerimiento[]; alTerminar: () => void }) {
  const [codigo, setCodigo] = useState(rq.codigo_interno)
  const [justificacion, setJustificacion] = useState(rq.justificacion)
  const [fechaRequerida, setFechaRequerida] = useState(rq.fecha_requerida ?? '')
  const [lineas, setLineas] = useState<Linea[]>(() =>
    rq.lineas.map((l) => ({ item: l.item, cantidad: String(l.cantidad), material_id: l.material_id ?? '' })),
  )
  const { corregir, otra } = useCorreccion(rq.id, corregirRequerimiento)
  const { alEnviar, enviando, error } = useEnvio(corregir, () => {
    otra()
    alTerminar()
  })
  const opciones = useMemo(
    () =>
      materiales.map((m) => ({
        valor: m.id,
        etiqueta: m.descripcion,
        detalle: [m.codigo, m.unidad_pendiente ? 'unidad por confirmar' : m.unidad, m.categoria].filter(Boolean).join(' · '),
      })),
    [materiales],
  )
  // El material cambia mientras Almacén no revisó; nada cambia en un insumo que ya va en una OC viva.
  const cambiaMaterial = rq.estado === 'POR_ATENDER'
  const enCompra = (item: number) => {
    const l = rq.lineas.find((x) => x.item === item)
    return Boolean(l?.orden_compra && !l.compra_rechazada)
  }

  // Solo viaja lo que cambió: la base anota antes y después.
  const cambios: Record<string, unknown> = {}
  if (codigo.trim() !== rq.codigo_interno) cambios.codigo_interno = codigo.trim()
  if (justificacion.trim() !== rq.justificacion) cambios.justificacion = justificacion.trim()
  if (fechaRequerida !== (rq.fecha_requerida ?? '')) cambios.fecha_requerida = fechaRequerida
  const lineasCambiadas = lineas.flatMap((l) => {
    const original = rq.lineas.find((x) => x.item === l.item)
    if (!original) return []
    const c: { item: number; cantidad?: number; material_id?: string } = { item: l.item }
    if (Number(l.cantidad) !== original.cantidad && Number(l.cantidad) > 0) c.cantidad = Number(l.cantidad)
    if (l.material_id && l.material_id !== (original.material_id ?? '')) c.material_id = l.material_id
    return c.cantidad !== undefined || c.material_id !== undefined ? [c] : []
  })
  if (lineasCambiadas.length) cambios.lineas = lineasCambiadas
  const sinCambios = Object.keys(cambios).length === 0

  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={rq.id} />
      <input type="hidden" name="cambios" value={JSON.stringify(cambios)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Código interno" htmlFor={`rq-corr-codigo-${rq.id}`} requerido>
          <Entrada
            id={`rq-corr-codigo-${rq.id}`}
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            required
            minLength={2}
            maxLength={60}
            autoComplete="off"
          />
        </Campo>
        <Campo etiqueta="Se necesita el" htmlFor={`rq-corr-fecha-${rq.id}`}>
          <Entrada
            id={`rq-corr-fecha-${rq.id}`}
            type="date"
            value={fechaRequerida}
            min={fechaRequerida && fechaRequerida < hoyLima() ? undefined : hoyLima()}
            onChange={(e) => setFechaRequerida(e.target.value)}
          />
        </Campo>
      </div>
      <Campo etiqueta="Justificación" htmlFor={`rq-corr-just-${rq.id}`} requerido>
        <AreaTexto
          id={`rq-corr-just-${rq.id}`}
          value={justificacion}
          onChange={(e) => setJustificacion(e.target.value)}
          required
          minLength={10}
          maxLength={1000}
        />
      </Campo>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-texto">Insumos</legend>
        {rq.lineas.map((original) => {
          const l = lineas.find((x) => x.item === original.item)
          if (!l) return null
          const fijo = enCompra(original.item)
          const cambiar = (parcial: Partial<Linea>) =>
            setLineas((todas) => todas.map((x) => (x.item === original.item ? { ...x, ...parcial } : x)))
          return (
            <div key={original.item} className="grid gap-2 rounded-[var(--radius-base)] border border-borde p-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
              {cambiaMaterial && !fijo ? (
                <Campo etiqueta={`Insumo ${original.item}`} htmlFor={`rq-corr-mat-${rq.id}-${original.item}`}>
                  <SeleccionBuscable
                    id={`rq-corr-mat-${rq.id}-${original.item}`}
                    valor={l.material_id}
                    onChange={(v) => cambiar({ material_id: v })}
                    marcador={original.material_nuevo && !original.material_id ? `Material nuevo: ${original.descripcion}` : 'Elige del catálogo de Almacén…'}
                    marcadorBusqueda="Nombre o código del material…"
                    permiteVaciar={false}
                    opciones={opciones.filter((o) => o.valor === l.material_id || !lineas.some((y) => y.material_id === o.valor))}
                  />
                </Campo>
              ) : (
                <div className="text-sm">
                  <p className="text-xs font-medium text-texto-suave">Insumo {original.item}</p>
                  <p className="text-texto">{original.descripcion}</p>
                  <p className="text-[11px] text-texto-suave">
                    {fijo
                      ? `Va en la ${original.orden_compra}: se corrige la orden de compra.`
                      : 'Almacén ya revisó el stock: el material no cambia.'}
                  </p>
                </div>
              )}
              <Campo etiqueta={`Cantidad (${original.unidad})`} htmlFor={`rq-corr-cant-${rq.id}-${original.item}`}>
                <Entrada
                  id={`rq-corr-cant-${rq.id}-${original.item}`}
                  type="number"
                  inputMode="decimal"
                  min="0.001"
                  step="0.001"
                  value={l.cantidad}
                  onChange={(e) => cambiar({ cantidad: e.target.value })}
                  disabled={fijo}
                  required
                />
              </Campo>
            </div>
          )
        })}
      </fieldset>

      <CamposDeCorreccion id={rq.id} disabled={enviando} />
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {sinCambios && <p className="mr-auto text-xs text-texto-suave">Todavía no cambiaste nada.</p>}
        <Boton type="button" variante="contorno" onClick={alTerminar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={enviando} disabled={sinCambios}>
          Corregir
        </Boton>
      </div>
    </form>
  )
}
