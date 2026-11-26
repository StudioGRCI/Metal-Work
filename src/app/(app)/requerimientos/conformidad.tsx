'use client'

import { MessageSquareWarning } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import { useCursorAlRechazo, useEnvio } from '@/lib/envio'
import { cantidad, fechaHora } from '@/lib/format'

import { anotarConformidad } from './acciones'

const OPCION =
  'flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-base)] border border-borde px-3 py-2 text-sm text-texto has-[:checked]:border-acento has-[:checked]:bg-acento-suave'
const RADIO = 'mt-0.5 size-4 shrink-0 accent-[var(--acento)]'

/** El rechazo de la base que es de la cantidad: va junto a su campo, no al pie. */
const esDeLaCantidad = (error: string | null) => Boolean(error?.startsWith('Indica cuánto llegó'))

/**
 * Quien pidió el RQ anota que una salida no le llegó o llegó incompleta (plan
 * 2, entrega 2.2). La salida del kardex no cambia: queda la nota, con quién y
 * cuándo, y Almacén la ve arriba de Atención con un aviso en la campana.
 *
 * Se monta en toda salida que quien mira puede anotar, aunque tenga una nota
 * abierta (`abierta`): entonces no ofrece el botón, pero conserva el aviso de
 * lo que se anotó. El botón desaparece al anotar y el cursor va a ese aviso.
 */
export function AnotarConformidad({
  salida,
  requerimiento,
  material,
  abierta: conNotaAbierta,
}: {
  salida: { id: string; cantidad: number; unidad: string | null; numero: string | null; en: string }
  requerimiento: string
  material: string
  abierta: boolean
}) {
  const [abierta, setAbierta] = useState(false)
  // Un id por envío: si la respuesta se pierde y se vuelve a enviar, la base no la anota dos veces.
  const [id, setId] = useState('')
  const [tipo, setTipo] = useState<'NO_LLEGO' | 'LLEGO_INCOMPLETO'>('NO_LLEGO')
  const [hecho, setHecho] = useState<{ texto: string; vez: number } | null>(null)
  const aviso = useRef<HTMLParagraphElement>(null)
  const campoCantidad = useRef<HTMLInputElement>(null)
  const { alEnviar, enviando, error } = useEnvio(anotarConformidad, (r) => {
    // El id cambia solo cuando el envío entró: si no se supo cómo terminó, el mismo id lo reconoce la base.
    setId('')
    setAbierta(false)
    setHecho((h) => ({ texto: r.mensaje ?? 'Anotado.', vez: (h?.vez ?? 0) + 1 }))
  })
  const deLaCantidad = esDeLaCantidad(error)
  useCursorAlRechazo(enviando, deLaCantidad ? error : null, () => campoCantidad.current)
  // El botón que abrió la ventana se va con la nota anotada: el cursor, al aviso.
  useEffect(() => {
    if (!hecho) return
    const t = setTimeout(() => aviso.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [hecho])
  const u = salida.unidad ? ` ${salida.unidad}` : ''
  const prefijo = `conf-${salida.id}`
  return (
    <>
      {!conNotaAbierta && (
        <Boton
          type="button"
          variante="contorno"
          tamano="sm"
          onClick={() => {
            if (!id) setId(crypto.randomUUID())
            setTipo('NO_LLEGO')
            setHecho(null)
            setAbierta(true)
          }}
          data-anotar-conformidad={salida.numero ?? salida.id}
        >
          <MessageSquareWarning aria-hidden className="size-4" />
          ¿No llegó o llegó incompleto?
        </Boton>
      )}
      {/* Siempre puesto, para que el lector anuncie el texto cuando llega. */}
      <p ref={aviso} role="status" tabIndex={-1} className="w-full text-xs text-exito outline-none empty:hidden" data-anotado={hecho ? '' : undefined}>
        {hecho && <span key={hecho.vez}>{hecho.texto}</span>}
      </p>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={[`Salida del ${requerimiento}`, salida.numero].filter(Boolean).join(' · ')}
        descripcion={`El ${fechaHora(salida.en)} salieron ${cantidad(salida.cantidad)}${u} de ${material}. La salida del kardex no cambia: Almacén ve tu nota y te responde.`}
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
                etiqueta={salida.unidad ? `¿Cuántas ${salida.unidad} llegaron?` : '¿Cuánto llegó?'}
                htmlFor={`${prefijo}-recibido`}
                ayuda={`Salieron ${cantidad(salida.cantidad)}${u}: escribe menos que eso.`}
                error={deLaCantidad && error ? error : undefined}
                requerido
              >
                <Entrada
                  ref={campoCantidad}
                  id={`${prefijo}-recibido`}
                  name="recibido"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min="0.001"
                  required
                  aria-invalid={deLaCantidad || undefined}
                  // Lo mismo que salió no es «incompleto»: el navegador lo frena aquí, junto al campo.
                  onInput={(e) => {
                    const v = Number(e.currentTarget.value)
                    e.currentTarget.setCustomValidity(
                      e.currentTarget.value !== '' && v >= salida.cantidad
                        ? `Escribe menos de lo que salió (${cantidad(salida.cantidad)}${u}). Si no llegó nada, marca «No llegó».`
                        : '',
                    )
                  }}
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
          <PieDeVentana error={deLaCantidad ? null : error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Anotar" />
        </form>
      </Ventana>
    </>
  )
}
