'use client'

import { MessageSquareText } from 'lucide-react'
import { useState } from 'react'

import { AvisoEnfocado } from '@/components/ui/aviso-enfocado'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { cuentaDelMetrado } from '@/lib/dominio/metrado-rq'
import { useEnvio } from '@/lib/envio'
import { cantidad } from '@/lib/format'

import { sustentarInsumos } from './acciones'

export type InsumoPorSustentar = {
  item: number
  descripcion: string
  cantidad: number
  unidad: string
  metrado: number | null
  pedido_antes: number
  exceso: number
  planos: string | null
  /** El sustento que ya espera a Diseño: se corrige encima. */
  sustento: string | null
  /** La nota con que Diseño no lo autorizó: hay que sustentarlo de nuevo. */
  rechazo: string | null
}

/**
 * Quien pidió cuenta por qué cada insumo necesita más de lo que dice el metrado
 * de Diseño (DKS, 20/11/2026: «Sustento y visto de Diseño»). Una ventana para
 * todos los que se pasan: Diseño los lee juntos.
 */
export function SustentarInsumos({ id, numero, insumos }: { id: string; numero: string; insumos: InsumoPorSustentar[] }) {
  const [abierta, setAbierta] = useState(false)
  const [listo, setListo] = useState<{ texto: string; n: number } | null>(null)
  const { alEnviar, enviando, error } = useEnvio(
    sustentarInsumos,
    (r) => {
      setAbierta(false)
      setListo((previo) => ({ texto: r.mensaje ?? 'Sustento enviado a Diseño.', n: (previo?.n ?? 0) + 1 }))
    },
    { documento: id },
  )
  const yaEnviado = insumos.every((i) => i.sustento && !i.rechazo)
  return (
    <div className="space-y-1">
      <Boton
        type="button"
        tamano="sm"
        variante={yaEnviado ? 'contorno' : 'primario'}
        onClick={() => {
          setListo(null)
          setAbierta(true)
        }}
      >
        <MessageSquareText aria-hidden className="size-4" />
        {yaEnviado ? 'Corregir el sustento' : 'Escribir el sustento'}
      </Boton>
      {/* Siempre montado: el aviso que nace con su texto no se anuncia. */}
      <p role="status" className={listo ? 'text-xs text-exito' : 'sr-only'}>
        {listo && <span key={listo.n}>{listo.texto}</span>}
      </p>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Sustento · ${numero}`}
        descripcion="Cuenta por qué cada insumo necesita más de lo que dice el metrado de Diseño: el plano que cambió, la merma, la pieza que se repone. Diseño lo autoriza o no, y Almacén revisa el requerimiento después."
        ancho="lg"
      >
        <form onSubmit={alEnviar} className="space-y-5">
          <input type="hidden" name="id" value={id} />
          <fieldset disabled={enviando} className="space-y-5">
            {insumos.map((i) => (
              <div key={i.item} className="space-y-2" data-sustento={i.item}>
                <input type="hidden" name="item" value={i.item} />
                <div className="text-sm">
                  <p className="text-texto">
                    <span className="tabular font-semibold">
                      Ítem {i.item} · {cantidad(i.cantidad)} {i.unidad}
                    </span>{' '}
                    {i.descripcion}
                  </p>
                  <p className="text-xs text-texto-suave">{cuentaDelMetrado(i, i.unidad)}</p>
                  {i.rechazo && (
                    <p className="mt-1 text-xs text-peligro">
                      <span className="font-medium">Diseño no lo autorizó:</span> {i.rechazo}
                    </p>
                  )}
                </div>
                <Campo etiqueta={`Por qué hace falta (ítem ${i.item})`} htmlFor={`sustento-${id}-${i.item}`} requerido>
                  <AreaTexto
                    id={`sustento-${id}-${i.item}`}
                    name={`sustento-${i.item}`}
                    rows={2}
                    required
                    minLength={10}
                    maxLength={500}
                    defaultValue={i.rechazo ? '' : (i.sustento ?? '')}
                    placeholder="Por ejemplo: el plano P-03 R2 agregó dos travesaños; se cortó mal una plancha y se repone."
                  />
                </Campo>
              </div>
            ))}
          </fieldset>
          {error && <AvisoEnfocado rol="alert">{error}</AvisoEnfocado>}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Enviar a Diseño
            </Boton>
          </div>
        </form>
      </Ventana>
    </div>
  )
}
