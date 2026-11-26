'use client'

import { MessageSquareWarning } from 'lucide-react'
import { useRef, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useCursorAlRechazo, useEnvio } from '@/lib/envio'
import { cantidad, fechaHora } from '@/lib/format'

import { anotarConformidad } from './acciones'

const OPCION =
  'flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-base)] border border-borde px-3 py-2 text-sm text-texto has-[:checked]:border-acento has-[:checked]:bg-acento-suave'
const RADIO = 'mt-0.5 size-4 shrink-0 accent-[var(--acento)]'

/**
 * Quien pidió el RQ anota que una salida no le llegó o llegó incompleta (plan
 * 2, entrega 2.2). La salida del kardex no cambia: queda la nota, con quién y
 * cuándo, y Almacén la ve arriba de Atención con un aviso en la campana.
 */
export function AnotarConformidad({
  salida,
  requerimiento,
  material,
}: {
  salida: { id: string; cantidad: number; unidad: string | null; numero: string | null; en: string }
  requerimiento: string
  material: string
}) {
  const [abierta, setAbierta] = useState(false)
  // Un id por envío: si la respuesta se pierde y se vuelve a enviar, la base no la anota dos veces.
  const [id, setId] = useState('')
  const [tipo, setTipo] = useState<'NO_LLEGO' | 'LLEGO_INCOMPLETO'>('NO_LLEGO')
  const aviso = useRef<HTMLParagraphElement>(null)
  const { alEnviar, enviando, error } = useEnvio(anotarConformidad, () => setAbierta(false))
  useCursorAlRechazo(enviando, error, () => aviso.current)
  const u = salida.unidad ? ` ${salida.unidad}` : ''
  const prefijo = `conf-${salida.id}`
  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        onClick={() => {
          setId(crypto.randomUUID())
          setTipo('NO_LLEGO')
          setAbierta(true)
        }}
        data-anotar-conformidad={salida.numero ?? salida.id}
      >
        <MessageSquareWarning aria-hidden className="size-4" />
        ¿No llegó o llegó incompleto?
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Salida ${salida.numero ?? ''} del ${requerimiento}`.replace('  ', ' ')}
        descripcion={`${cantidad(salida.cantidad)}${u} de ${material}, el ${fechaHora(salida.en)}. La salida del kardex no cambia: Almacén ve tu nota y te responde.`}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="movimiento" value={salida.id} />
          <fieldset disabled={enviando} className="min-w-0 space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-2 text-xs font-medium text-texto-suave">
                ¿Qué pasó?<span className="ml-0.5 text-peligro">*</span>
              </legend>
              <label className={OPCION}>
                <input type="radio" name="tipo" value="NO_LLEGO" checked={tipo === 'NO_LLEGO'} onChange={() => setTipo('NO_LLEGO')} className={RADIO} />
                <span className="font-medium">No llegó</span>
              </label>
              <label className={OPCION}>
                <input
                  type="radio"
                  name="tipo"
                  value="LLEGO_INCOMPLETO"
                  checked={tipo === 'LLEGO_INCOMPLETO'}
                  onChange={() => setTipo('LLEGO_INCOMPLETO')}
                  className={RADIO}
                />
                <span className="font-medium">Llegó incompleto</span>
              </label>
            </fieldset>
            {tipo === 'LLEGO_INCOMPLETO' && (
              <Campo
                etiqueta={`¿Cuánto llegó?${u}`}
                htmlFor={`${prefijo}-recibido`}
                ayuda={`Salieron ${cantidad(salida.cantidad)}${u}: escribe menos que eso.`}
                requerido
              >
                <Entrada
                  id={`${prefijo}-recibido`}
                  name="recibido"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0.001"
                  max={salida.cantidad}
                  required
                  className="tabular sm:max-w-40"
                />
              </Campo>
            )}
            <Campo etiqueta="Nota para Almacén" htmlFor={`${prefijo}-nota`} requerido>
              <AreaTexto
                id={`${prefijo}-nota`}
                name="nota"
                required
                minLength={10}
                maxLength={500}
                placeholder="Por ejemplo: recibí 3 discos, faltó uno; o no llegó nada al área."
              />
            </Campo>
          </fieldset>
          <p ref={aviso} tabIndex={-1} role="alert" className="text-sm text-peligro outline-none empty:hidden">
            {error}
          </p>
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Anotar
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
