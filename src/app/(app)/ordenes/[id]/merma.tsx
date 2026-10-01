'use client'

import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import { cantidad, fechaHora } from '@/lib/format'

import { fijarMermaOrden } from './acciones-merma'

export type MermaEnPantalla = {
  porcentaje: number
  motivo: string
  registradoEn: string
  registradoPor: string | null
} | null

/**
 * La merma de material de la OT: el porcentaje que Diseño e Ingeniería evalúa
 * —recortes de plancha, perfiles que no se aprovechan— y que el costeo suma
 * sobre el material valorizado. Costos la lee; solo Diseño la fija.
 */
export function MermaDeOrden({ ordenId, merma, puedeFijar, ordenViva }: {
  ordenId: string
  merma: MermaEnPantalla
  puedeFijar: boolean
  ordenViva: boolean
}) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error, resultado } = useEnvio(fijarMermaOrden, () => setAbierta(false))
  const editable = puedeFijar && ordenViva

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Merma de material"
        descripcion="Lo que se pierde al cortar y armar. Diseño e Ingeniería la evalúa; el costeo la aplica sobre el material valorizado de la OT."
        acciones={editable && (
          <Boton tamano="sm" variante={merma ? 'contorno' : 'primario'} onClick={() => setAbierta(true)}>
            {merma ? 'Cambiar merma' : 'Fijar merma'}
          </Boton>
        )}
      />
      <TarjetaCuerpo>
        {merma ? (
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="tabular text-2xl font-semibold text-texto">{cantidad(merma.porcentaje)} %</span>
            <span className="min-w-0 flex-1 text-sm text-texto">{merma.motivo}</span>
            <span className="basis-full text-[11px] text-texto-suave">
              {merma.registradoPor ? `${merma.registradoPor} · ` : ''}{fechaHora(merma.registradoEn)}
            </span>
          </div>
        ) : (
          <p className="text-sm text-texto-suave">
            {editable
              ? 'Todavía sin evaluar. Fija el porcentaje con «Fijar merma»; mientras tanto el costeo no suma merma.'
              : 'Diseño e Ingeniería todavía no la evalúa; mientras tanto el costeo no suma merma.'}
          </p>
        )}
        {resultado?.ok && <p role="status" className="mt-2 text-sm text-exito">{resultado.mensaje}</p>}
      </TarjetaCuerpo>

      <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo="Merma de material"
        descripcion="Porcentaje sobre el material valorizado de esta OT. Si se vuelve a fijar, reemplaza al anterior.">
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="orden_id" value={ordenId} />
          <Campo etiqueta="Merma (%)" htmlFor="merma-porcentaje" requerido>
            <Entrada id="merma-porcentaje" name="porcentaje" type="number" inputMode="decimal" min={0} max={100} step="0.01"
              defaultValue={merma?.porcentaje ?? undefined} required />
          </Campo>
          <Campo etiqueta="Cómo se evaluó" htmlFor="merma-motivo" requerido>
            <AreaTexto id="merma-motivo" name="motivo" rows={3} required minLength={5} maxLength={300}
              defaultValue={merma?.motivo ?? ''} placeholder="Ej.: recortes de plancha del piso y perfiles del techo" />
          </Campo>
          {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
          <Boton type="submit" cargando={enviando}>Guardar merma</Boton>
        </form>
      </Ventana>
    </Tarjeta>
  )
}
