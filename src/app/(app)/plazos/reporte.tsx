'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { BadgeCheck, MessageSquarePlus } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto } from '@/components/ui/campos'
import { fechaHora } from '@/lib/format'

import { reportarAvance, verificarReporte } from './acciones'

/**
 * Lo que el área reporta de una etapa, y la verificación de Administración.
 *
 * En el Excel de la empresa esto es una celda de «Observaciones» que se pisa
 * cada semana. Acá el último reporte se ve siempre —es lo que contesta «¿por qué
 * va tarde?»— y escribir uno nuevo no borra el anterior.
 */
export function Reporte({
  etapaId,
  ordenId,
  ultimo,
  verificadoEn,
  reportadoEn,
  puedeReportar,
  puedeVerificar,
  reporteId,
}: {
  etapaId: string
  ordenId: string
  ultimo: string | null
  verificadoEn: string | null
  reportadoEn: string | null
  /** `produccion.registrar`: lo calcula la página, no se recalcula acá. */
  puedeReportar: boolean
  /** `ordenes.editar`. */
  puedeVerificar: boolean
  /** Del último reporte, para poder verificarlo desde la lista. */
  reporteId: string | null
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [escribiendo, setEscribiendo] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function enviar(datos: FormData) {
    if (enviando) return
    setError(null)
    setEnviando(true)
    const resultado = await reportarAvance(null, datos)
    setEnviando(false)

    if (resultado.ok) {
      setEscribiendo(false)
      iniciarTransicion(() => router.refresh())
      return
    }
    setError(resultado.error)
  }

  async function verificar() {
    if (!reporteId || enviando) return
    const datos = new FormData()
    datos.set('reporte_id', reporteId)

    setError(null)
    setEnviando(true)
    const resultado = await verificarReporte(null, datos)
    setEnviando(false)

    if (resultado.ok) iniciarTransicion(() => router.refresh())
    else setError(resultado.error)
  }

  if (escribiendo) {
    return (
      <form action={enviar} className="space-y-2">
        <input type="hidden" name="etapa_id" value={etapaId} />
        <input type="hidden" name="orden_id" value={ordenId} />
        <AreaTexto
          name="texto"
          rows={3}
          required
          autoFocus
          aria-label="Qué falta o qué trabó el trabajo"
          placeholder="Qué falta y quién lo tiene. Ej.: faltan medidas de compuerta posterior — las pidió Diseño el lunes."
        />
        {error && <p className="text-xs text-peligro">{error}</p>}
        <div className="flex justify-end gap-2">
          <Boton
            type="button"
            variante="fantasma"
            tamano="sm"
            onClick={() => setEscribiendo(false)}
          >
            Cancelar
          </Boton>
          <Boton type="submit" tamano="sm" cargando={enviando}>
            Enviar el reporte
          </Boton>
        </div>
      </form>
    )
  }

  return (
    <div className="space-y-1">
      {ultimo ? (
        <>
          <p className="max-w-prose text-xs whitespace-pre-wrap text-texto">{ultimo}</p>
          <p className="text-[11px] text-texto-tenue">
            {fechaHora(reportadoEn)}
            {verificadoEn ? (
              <span className="ml-2 inline-flex items-center gap-1 text-exito">
                <BadgeCheck aria-hidden className="size-3" />
                Verificado
              </span>
            ) : (
              <span className="ml-2 text-aviso">Sin verificar</span>
            )}
          </p>
        </>
      ) : (
        <p className="text-xs text-texto-tenue">Esta área todavía no ha reportado nada.</p>
      )}

      {error && <p className="text-xs text-peligro">{error}</p>}

      <div className="flex flex-wrap gap-2 pt-0.5">
        {puedeReportar && (
          <button
            type="button"
            onClick={() => setEscribiendo(true)}
            className="inline-flex items-center gap-1 text-[11px] text-acento hover:underline"
          >
            <MessageSquarePlus aria-hidden className="size-3" />
            {ultimo ? 'Reportar de nuevo' : 'Reportar'}
          </button>
        )}
        {/* Verificar solo tiene sentido sobre algo escrito y sin verificar. */}
        {puedeVerificar && reporteId && !verificadoEn && (
          <button
            type="button"
            onClick={verificar}
            disabled={enviando}
            className="inline-flex items-center gap-1 text-[11px] text-acento hover:underline disabled:opacity-50"
          >
            <BadgeCheck aria-hidden className="size-3" />
            Verificar
          </button>
        )}
      </div>
    </div>
  )
}
