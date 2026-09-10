'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { BadgeCheck, MessageSquarePlus } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'
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
  const reporte = useEnvio(reportarAvance, () => setEscribiendo(false))

  // Verificar es un clic, no un formulario: lo que se prende en el manejador de
  // un clic sí se pinta al instante, así que su «verificando» no miente.
  const [verificando, setVerificando] = useState(false)
  const [errorVerificar, setErrorVerificar] = useState<string | null>(null)
  const error = reporte.error ?? errorVerificar

  async function verificar() {
    if (!reporteId || verificando) return
    const datos = new FormData()
    datos.set('reporte_id', reporteId)

    setErrorVerificar(null)
    setVerificando(true)
    const resultado = await verificarReporte(null, datos)
    setVerificando(false)

    if (resultado.ok) iniciarTransicion(() => router.refresh())
    else setErrorVerificar(resultado.error)
  }

  if (escribiendo) {
    return (
      <form onSubmit={reporte.alEnviar} className="space-y-2">
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
          <Boton type="submit" tamano="sm" cargando={reporte.enviando}>
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
            disabled={verificando}
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
