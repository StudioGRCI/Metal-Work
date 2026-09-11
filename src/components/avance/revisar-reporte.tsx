'use client'

import { Check, CheckCheck, MessageSquareWarning } from 'lucide-react'
import { useState } from 'react'

import { revisarReporte, aprobarElDia } from '@/app/(app)/avance/acciones-revision'
import { Boton } from '@/components/ui/boton'
import { AreaTexto } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'
import type { ClaseReporte } from '@/lib/sesion'

function Error_({ texto }: { texto: string | null }) {
  if (!texto) return null
  return (
    <p role="alert" className="w-full rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
      {texto}
    </p>
  )
}

/**
 * Los dos gestos del jefe sobre un reporte: aprobarlo, u observarlo diciendo
 * qué hay que corregir. Lo observado también se puede aprobar —el jefe cambió
 * de idea, o se lo explicaron de palabra—; lo aprobado ya no muestra nada.
 */
export function RevisarReporte({
  clase,
  id,
  revision,
}: {
  clase: ClaseReporte
  id: string
  revision: string | null
}) {
  const [observando, setObservando] = useState(false)
  const aprobar = useEnvio(revisarReporte)
  const observar = useEnvio(revisarReporte, () => setObservando(false))

  if (revision === 'APROBADO') return null

  if (observando) {
    return (
      <form onSubmit={observar.alEnviar} className="w-full space-y-2">
        <input type="hidden" name="clase" value={clase} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value="OBSERVADO" />
        <AreaTexto
          name="observacion"
          rows={2}
          required
          minLength={3}
          maxLength={500}
          autoFocus
          aria-label="Qué hay que corregir"
          placeholder="Qué hay que corregir: falta la foto, el porcentaje no cuadra, di qué pieza…"
        />
        <Error_ texto={observar.error} />
        <div className="flex flex-wrap gap-2">
          <Boton type="submit" tamano="sm" variante="peligro" cargando={observar.enviando}>
            Enviar observación
          </Boton>
          <Boton type="button" tamano="sm" variante="fantasma" onClick={() => setObservando(false)}>
            Cancelar
          </Boton>
        </div>
      </form>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form onSubmit={aprobar.alEnviar} className="contents">
        <input type="hidden" name="clase" value={clase} />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="decision" value="APROBADO" />
        <Boton type="submit" tamano="sm" variante="secundario" cargando={aprobar.enviando}>
          <Check aria-hidden className="size-3.5" />
          Aprobar
        </Boton>
      </form>
      {revision === 'PENDIENTE' && (
        <Boton
          type="button"
          tamano="sm"
          variante="fantasma"
          onClick={() => {
            observar.limpiar()
            setObservando(true)
          }}
        >
          <MessageSquareWarning aria-hidden className="size-3.5" />
          Observar
        </Boton>
      )}
      <Error_ texto={aprobar.error} />
    </div>
  )
}

/**
 * Aprobar de una vez todo lo que queda por aprobar de un día. Pide una segunda
 * confirmación: es un gesto sobre muchos reportes, y el jefe tiene que haberlos
 * mirado antes.
 */
export function AprobarElDia({ fecha, cuantos }: { fecha: string; cuantos: number }) {
  const [confirmando, setConfirmando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const { alEnviar, enviando, error, limpiar } = useEnvio(aprobarElDia, (r) => {
    setConfirmando(false)
    setAviso(r.mensaje ?? 'Aprobado.')
  })

  if (cuantos === 0) {
    return aviso ? (
      <p role="status" className="text-xs font-medium text-exito">
        {aviso}
      </p>
    ) : null
  }

  if (!confirmando) {
    return (
      <Boton
        type="button"
        variante="secundario"
        onClick={() => {
          limpiar()
          setAviso(null)
          setConfirmando(true)
        }}
      >
        <CheckCheck aria-hidden className="size-4" />
        Aprobar los {cuantos} por aprobar
      </Boton>
    )
  }

  return (
    <form onSubmit={alEnviar} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="fecha" value={fecha} />
      <span className="text-sm text-texto">
        ¿Aprobar {cuantos === 1 ? 'el reporte' : `los ${cuantos} reportes`} que {cuantos === 1 ? 'queda' : 'quedan'}?
      </span>
      <Boton type="submit" cargando={enviando}>
        Sí, aprobar
      </Boton>
      <Boton type="button" variante="fantasma" onClick={() => setConfirmando(false)}>
        No
      </Boton>
      <Error_ texto={error} />
    </form>
  )
}
