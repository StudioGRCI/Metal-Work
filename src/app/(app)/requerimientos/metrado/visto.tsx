'use client'

import { Check, X } from 'lucide-react'
import { useState } from 'react'

import { AvisoEnfocado } from '@/components/ui/aviso-enfocado'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'

import { useAvisar } from '../atencion/avisos'
import { autorizarInsumos } from './acciones'

export type InsumoPorAutorizar = {
  item: number
  /** «40 KG Plancha LAC 3 mm». */
  pedido: string
  /** La cuenta contra el metrado, ya dicha en una frase. */
  cuenta: string
  sustento: string | null
  /** Quién lo sustentó y cuándo. */
  firma: string | null
}

/**
 * El visto de Diseño a lo que un RQ pide de más. Autorizar va de un toque, con
 * los insumos marcados; no autorizar pide la nota que le llega a quien pidió.
 * Si el RQ queda en regla sale de la lista: lo que pasó se dice arriba.
 */
export function VistoDelRequerimiento({ id, numero, insumos }: { id: string; numero: string; insumos: InsumoPorAutorizar[] }) {
  const avisar = useAvisar()
  // Lo que se desmarcó, no lo marcado: el insumo que vuelve a esperar el visto
  // (sustentado otra vez) llega marcado, y el que queda solo no tiene casilla.
  const [desmarcados, setDesmarcados] = useState<Set<number>>(() => new Set())
  const [rechazo, setRechazo] = useState(false)
  const alTerminar = (r: { mensaje?: string }) => {
    setRechazo(false)
    setDesmarcados(new Set())
    if (r.mensaje) avisar(`${numero}: ${r.mensaje}`)
  }
  const autorizar = useEnvio(autorizarInsumos, alTerminar, { documento: `${id}:si` })
  const noAutorizar = useEnvio(autorizarInsumos, alTerminar, { documento: `${id}:no` })
  const varios = insumos.length > 1
  const elegidos = varios ? insumos.filter((i) => !desmarcados.has(i.item)) : insumos
  const ocupado = autorizar.enviando || noAutorizar.enviando
  const marcar = (item: number, si: boolean) =>
    setDesmarcados((previo) => {
      const nuevo = new Set(previo)
      if (si) nuevo.delete(item)
      else nuevo.add(item)
      return nuevo
    })
  const ocultos = elegidos.map((i) => <input key={i.item} type="hidden" name="item" value={i.item} />)

  return (
    <>
      <ul className="divide-y divide-borde border-t border-borde">
        {insumos.map((i) => (
          <li key={i.item} className="flex gap-3 px-4 py-3" data-por-autorizar={i.item}>
            {varios && (
              <input
                type="checkbox"
                id={`visto-${id}-${i.item}`}
                className="mt-1 size-4 shrink-0 accent-[var(--acento)]"
                checked={!desmarcados.has(i.item)}
                disabled={ocupado}
                onChange={(e) => marcar(i.item, e.target.checked)}
                aria-describedby={`visto-${id}-${i.item}-cuenta`}
              />
            )}
            <div className="min-w-0 flex-1 space-y-0.5 text-sm">
              <label htmlFor={varios ? `visto-${id}-${i.item}` : undefined} className="block break-words text-texto">
                <span className="tabular font-semibold">Ítem {i.item} ·</span> {i.pedido}
              </label>
              <p id={`visto-${id}-${i.item}-cuenta`} className="text-xs text-texto-suave">
                {i.cuenta}
              </p>
              {i.sustento && (
                <p className="text-xs break-words text-texto">
                  <span className="font-medium">Sustento:</span> {i.sustento}
                  {i.firma && <span className="text-texto-tenue"> · {i.firma}</span>}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>

      <form onSubmit={autorizar.alEnviar} className="flex flex-wrap items-center gap-2 border-t border-borde px-4 py-3">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="autoriza" value="si" />
        {ocultos}
        <Boton type="submit" tamano="sm" cargando={autorizar.enviando} disabled={elegidos.length === 0 || noAutorizar.enviando}>
          <Check aria-hidden className="size-4" />
          {varios ? `Autorizar ${elegidos.length === insumos.length ? 'todos' : elegidos.length === 1 ? 'el marcado' : `los ${elegidos.length} marcados`}` : 'Autorizar'}
        </Boton>
        <Boton
          type="button"
          tamano="sm"
          variante="contornoPeligro"
          disabled={elegidos.length === 0 || ocupado}
          onClick={() => setRechazo(true)}
        >
          <X aria-hidden className="size-4" />
          No autorizar
        </Boton>
        {varios && elegidos.length === 0 && <p className="text-xs text-texto-suave">Marca al menos un insumo.</p>}
        {autorizar.error && (
          <AvisoEnfocado rol="alert" className="basis-full">
            {autorizar.error}
          </AvisoEnfocado>
        )}
      </form>

      <Ventana
        abierta={rechazo}
        alCerrar={() => setRechazo(false)}
        titulo={`No autorizar · ${numero}`}
        descripcion={`${elegidos.length === 1 ? `El ítem ${elegidos[0]?.item}` : `Los ítems ${elegidos.map((i) => i.item).join(', ')}`} no se compran ni salen del almacén. A quien pidió le llega tu nota para que corrija la cantidad o vuelva a sustentar.`}
        ancho="md"
      >
        <form onSubmit={noAutorizar.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="autoriza" value="no" />
          {ocultos}
          <Campo etiqueta="Por qué no" htmlFor={`visto-nota-${id}`} requerido>
            <AreaTexto
              id={`visto-nota-${id}`}
              name="nota"
              rows={3}
              required
              minLength={10}
              maxLength={500}
              placeholder="Por ejemplo: el plano P-03 R2 no cambió el travesaño; pide lo del metrado."
            />
          </Campo>
          {noAutorizar.error && <AvisoEnfocado rol="alert">{noAutorizar.error}</AvisoEnfocado>}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setRechazo(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" cargando={noAutorizar.enviando}>
              No autorizar
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
