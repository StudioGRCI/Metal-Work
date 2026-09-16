'use client'

import { useState } from 'react'
import { BadgeCheck, MessageSquarePlus } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto } from '@/components/ui/campos'
import { useAccion, useEnvio } from '@/lib/envio'
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
  const [escribiendo, setEscribiendo] = useState(false)
  const reporte = useEnvio(reportarAvance, () => setEscribiendo(false))
  // Verificar es un clic, no un formulario: useAccion le da el mismo «uno en
  // vuelo a la vez» y el repintado al terminar.
  const verificacion = useAccion(verificarReporte)
  const error = reporte.error ?? verificacion.error

  function verificar() {
    if (!reporteId) return
    const datos = new FormData()
    datos.set('reporte_id', reporteId)
    verificacion.ejecutar(datos)
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

      {/* Botones de verdad y no enlaces de 11 px: en el teléfono miden 44 px,
          que es lo que se acierta con guante. */}
      <div className="flex flex-wrap gap-1 pt-0.5">
        {puedeReportar && (
          <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setEscribiendo(true)}>
            <MessageSquarePlus aria-hidden className="size-3.5" />
            {ultimo ? 'Reportar de nuevo' : 'Reportar'}
          </Boton>
        )}
        {/* Verificar solo tiene sentido sobre algo escrito y sin verificar. */}
        {puedeVerificar && reporteId && !verificadoEn && (
          <Boton type="button" variante="fantasma" tamano="sm" onClick={verificar} cargando={verificacion.enviando}>
            <BadgeCheck aria-hidden className="size-3.5" />
            Verificar
          </Boton>
        )}
      </div>
    </div>
  )
}
