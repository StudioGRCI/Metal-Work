'use client'

import { Check, CircleDashed, MessageSquareWarning, PenLine, X } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'

import { firmar, pedirFirmas } from '@/app/(app)/firmas/acciones'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Seleccion } from '@/components/ui/campos'
import { fecha as formatearFecha } from '@/lib/format'
import { cn } from '@/lib/utils'

export type Firmante = { id: string; nombre: string; cargo: string | null }

export type FirmaVista = {
  aprobacion_id: string
  orden_firma: number
  estado: string
  comentario: string | null
  fecha: string | null
  aprobador_id: string
  aprobador: string
  aprobador_cargo: string | null
  le_toca: boolean
}

const ICONO = {
  APROBADO: Check,
  OBSERVADO: MessageSquareWarning,
  RECHAZADO: X,
  PENDIENTE: CircleDashed,
}

const COLOR = {
  APROBADO: 'text-exito',
  OBSERVADO: 'text-aviso',
  RECHAZADO: 'text-peligro',
  PENDIENTE: 'text-texto-tenue',
}

const PALABRA = {
  APROBADO: 'firmó',
  OBSERVADO: 'observó',
  RECHAZADO: 'rechazó',
  PENDIENTE: 'pendiente',
}

/**
 * La cadena de firmas de un documento: quién firmó, quién falta y a quién le
 * toca ahora. Si al que mira le toca, firma desde acá mismo.
 */
export function FirmasDocumento({
  documentoId,
  firmas,
  usuarioId,
  firmantes,
  puedePedir,
  tieneArchivo,
}: {
  documentoId: string
  firmas: FirmaVista[]
  usuarioId: string
  firmantes: Firmante[]
  puedePedir: boolean
  tieneArchivo: boolean
}) {
  const [pidiendo, setPidiendo] = useState(false)
  const [firmando, setFirmando] = useState<string | null>(null)

  if (firmas.length === 0) {
    if (!puedePedir || !tieneArchivo) return null

    return (
      <>
        <button
          type="button"
          onClick={() => setPidiendo(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-base)] border border-borde px-3 text-xs text-texto hover:bg-superficie-2"
        >
          <PenLine aria-hidden className="size-3.5" />
          Pedir firma
        </button>
        {pidiendo && (
          <VentanaPedir
            documentoId={documentoId}
            firmantes={firmantes}
            onCerrar={() => setPidiendo(false)}
          />
        )}
      </>
    )
  }

  return (
    <div className="w-full">
      <ol className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {firmas.map((f) => {
          const estado = (f.estado as keyof typeof ICONO) ?? 'PENDIENTE'
          const Icono = ICONO[estado] ?? CircleDashed
          const mia = f.aprobador_id === usuarioId && f.estado === 'PENDIENTE' && f.le_toca

          return (
            <li key={f.aprobacion_id} className="flex items-center gap-1.5 text-[11px]">
              <Icono aria-hidden className={cn('size-3.5 shrink-0', COLOR[estado])} />
              <span className="text-texto-suave">
                <span className="font-medium text-texto">{f.aprobador}</span>
                {f.aprobador_cargo && <span className="text-texto-tenue"> ({f.aprobador_cargo})</span>}{' '}
                {PALABRA[estado]}
                {f.fecha && ` el ${formatearFecha(f.fecha)}`}
              </span>

              {mia && (
                <button
                  type="button"
                  onClick={() => setFirmando(f.aprobacion_id)}
                  className="ml-1 inline-flex h-6 items-center gap-1 rounded-[var(--radius-base)] bg-acento px-2 text-[11px] font-medium text-white hover:opacity-90"
                >
                  <PenLine aria-hidden className="size-3" />
                  Firmar
                </button>
              )}
            </li>
          )
        })}
      </ol>

      {firmas.some((f) => f.comentario) && (
        <ul className="mt-1.5 space-y-1">
          {firmas
            .filter((f) => f.comentario)
            .map((f) => (
              <li
                key={`c-${f.aprobacion_id}`}
                className={cn(
                  'rounded-[var(--radius-base)] px-2.5 py-1.5 text-[11px]',
                  f.estado === 'RECHAZADO'
                    ? 'bg-peligro-suave text-peligro'
                    : f.estado === 'OBSERVADO'
                      ? 'bg-aviso-suave text-aviso'
                      : 'bg-superficie-2 text-texto-suave',
                )}
              >
                <span className="font-medium">{f.aprobador}:</span> {f.comentario}
              </li>
            ))}
        </ul>
      )}

      {firmando && (
        <VentanaFirmar aprobacionId={firmando} onCerrar={() => setFirmando(null)} />
      )}
    </div>
  )
}

function VentanaPedir({
  documentoId,
  firmantes,
  onCerrar,
}: {
  documentoId: string
  firmantes: Firmante[]
  onCerrar: () => void
}) {
  const [elegidos, setElegidos] = useState<string[]>([])
  const [resultado, accion, enviando] = useActionState(pedirFirmas, null)

  const disponibles = firmantes.filter((f) => !elegidos.includes(f.id))

  return (
    <Ventana titulo="Pedir la firma del documento" onCerrar={onCerrar}>
      <p className="mb-3 text-xs text-texto-suave">
        Se firma en el orden en que se agregan: el segundo no puede decidir mientras el primero no
        lo haya hecho.
      </p>

      <form action={accion} className="space-y-3">
        <input type="hidden" name="documento_id" value={documentoId} />
        <input type="hidden" name="aprobadores" value={elegidos.join(',')} />

        {elegidos.length > 0 && (
          <ol className="space-y-1">
            {elegidos.map((id, i) => {
              const persona = firmantes.find((f) => f.id === id)
              return (
                <li
                  key={id}
                  className="flex items-center gap-2 rounded-[var(--radius-base)] bg-superficie-2 px-3 py-1.5 text-sm"
                >
                  <span className="tabular w-5 text-xs text-texto-tenue">{i + 1}.</span>
                  <span className="flex-1 text-texto">
                    {persona?.nombre}
                    {persona?.cargo && (
                      <span className="text-xs text-texto-suave"> · {persona.cargo}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setElegidos((e) => e.filter((x) => x !== id))}
                    aria-label={`Quitar a ${persona?.nombre}`}
                    className="text-texto-tenue hover:text-peligro"
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              )
            })}
          </ol>
        )}

        <Campo etiqueta="Agregar a la cadena" htmlFor={`firmante-${documentoId}`}>
          <Seleccion
            id={`firmante-${documentoId}`}
            value=""
            onChange={(e) => {
              if (e.target.value) setElegidos((x) => [...x, e.target.value])
            }}
          >
            <option value="">Elegir…</option>
            {disponibles.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nombre}
                {f.cargo ? ` · ${f.cargo}` : ''}
              </option>
            ))}
          </Seleccion>
        </Campo>

        <Aviso resultado={resultado} />

        <div className="flex justify-end gap-2">
          <Boton type="button" variante="contorno" onClick={onCerrar}>
            {resultado?.ok ? 'Cerrar' : 'Cancelar'}
          </Boton>
          <Boton type="submit" cargando={enviando} disabled={elegidos.length === 0}>
            Pedir firma
          </Boton>
        </div>
      </form>
    </Ventana>
  )
}

export function VentanaFirmar({
  aprobacionId,
  onCerrar,
}: {
  aprobacionId: string
  onCerrar: () => void
}) {
  const [decision, setDecision] = useState<'APROBADO' | 'OBSERVADO' | 'RECHAZADO'>('APROBADO')
  const [resultado, accion, enviando] = useActionState(firmar, null)

  return (
    <Ventana titulo="Firmar el documento" onCerrar={onCerrar}>
      <form action={accion} className="space-y-3">
        <input type="hidden" name="aprobacion_id" value={aprobacionId} />
        <input type="hidden" name="estado" value={decision} />

        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['APROBADO', 'Aprobar', 'border-exito text-exito'],
              ['OBSERVADO', 'Observar', 'border-aviso text-aviso'],
              ['RECHAZADO', 'Rechazar', 'border-peligro text-peligro'],
            ] as const
          ).map(([valor, texto, activo]) => (
            <button
              key={valor}
              type="button"
              onClick={() => setDecision(valor)}
              aria-pressed={decision === valor}
              className={cn(
                'rounded-[var(--radius-base)] border px-3 py-2 text-sm font-medium transition-colors',
                decision === valor
                  ? activo
                  : 'border-borde text-texto-suave hover:bg-superficie-2',
              )}
            >
              {texto}
            </button>
          ))}
        </div>

        <Campo
          etiqueta={decision === 'APROBADO' ? 'Comentario' : 'Qué está mal'}
          htmlFor={`com-${aprobacionId}`}
          requerido={decision !== 'APROBADO'}
          ayuda={
            decision === 'APROBADO'
              ? 'Opcional; queda junto a tu firma'
              : 'Quien lo subió necesita saber qué corregir'
          }
        >
          <AreaTexto
            id={`com-${aprobacionId}`}
            name="comentario"
            rows={3}
            required={decision !== 'APROBADO'}
          />
        </Campo>

        <p className="rounded-[var(--radius-base)] bg-superficie-2 px-3 py-2 text-[11px] text-texto-suave">
          La firma queda con tu nombre, la fecha y la versión del archivo sobre la que decidiste. Si
          después se sube una revisión nueva, la cadena vuelve a empezar.
        </p>

        <Aviso resultado={resultado} />

        <div className="flex justify-end gap-2">
          <Boton type="button" variante="contorno" onClick={onCerrar}>
            {resultado?.ok ? 'Cerrar' : 'Cancelar'}
          </Boton>
          <Boton type="submit" cargando={enviando}>
            Registrar la firma
          </Boton>
        </div>
      </form>
    </Ventana>
  )
}

function Ventana({
  titulo,
  onCerrar,
  children,
}: {
  titulo: string
  onCerrar: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const salir = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    document.addEventListener('keydown', salir)
    return () => document.removeEventListener('keydown', salir)
  }, [onCerrar])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="w-full max-w-lg rounded-[calc(var(--radius-base)*1.5)] border border-borde bg-superficie p-5 shadow-2xl shadow-black/30"
      >
        <h2 className="mb-3 text-base font-semibold text-texto">{titulo}</h2>
        {children}
      </div>
    </div>
  )
}

function Aviso({ resultado }: { resultado: { ok?: boolean; error?: string; mensaje?: string } | null }) {
  if (!resultado) return null
  const malo = resultado.ok === false

  return (
    <p
      role={malo ? 'alert' : 'status'}
      className={cn(
        'rounded-[var(--radius-base)] px-3 py-2 text-xs',
        malo ? 'bg-peligro-suave text-peligro' : 'bg-exito-suave text-exito',
      )}
    >
      {malo ? resultado.error : resultado.mensaje}
    </p>
  )
}
