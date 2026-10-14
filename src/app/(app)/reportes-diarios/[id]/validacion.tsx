'use client'

import { Check, MessageSquareWarning } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { AREA_QUE_VALIDA, type LadoValidacion } from '@/lib/dominio/reporte-diario'
import { useAccion, useEnvio } from '@/lib/envio'

import { observarReporteDiario, validarReporteDiario } from '../acciones'

/**
 * Los dos botones de un área sobre un reporte por validar: el visto bueno, de
 * un toque, y la observación, con su motivo, que lo devuelve al supervisor.
 */
export function ValidarReporte({ id, lado, yaDioVisto }: { id: string; lado: LadoValidacion; yaDioVisto: boolean }) {
  const [abierta, setAbierta] = useState(false)
  const visto = useAccion(validarReporteDiario)
  const observar = useEnvio(observarReporteDiario, () => setAbierta(false))
  const area = AREA_QUE_VALIDA[lado]

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {!yaDioVisto && (
          <Boton
            type="button"
            tamano="sm"
            cargando={visto.enviando}
            onClick={() => {
              const datos = new FormData()
              datos.set('id', id)
              datos.set('lado', lado)
              visto.ejecutar(datos)
            }}
            data-validar={lado}
          >
            <Check aria-hidden className="size-4" />
            Dar visto bueno
          </Boton>
        )}
        <Boton type="button" variante="contorno" tamano="sm" onClick={() => setAbierta(true)} data-observar={lado}>
          <MessageSquareWarning aria-hidden className="size-4" />
          Observar
        </Boton>
      </div>
      {visto.error && (
        <p role="alert" className="text-sm text-peligro">
          {visto.error}
        </p>
      )}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Observar como ${area}`}
        descripcion="El reporte vuelve al supervisor con tu observación. Lo corrige y lo sube de nuevo, y otra vez lo validan las dos áreas. Mientras tanto sus horas no entran a la planilla diaria."
        ancho="md"
      >
        <form onSubmit={observar.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="lado" value={lado} />
          <Campo etiqueta="Qué tiene que corregir" htmlFor={`rd-observacion-${id}`} requerido>
            <AreaTexto
              id={`rd-observacion-${id}`}
              name="motivo"
              required
              minLength={10}
              maxLength={500}
              placeholder="Por ejemplo: Juan trabajó 6 horas, no 8; y el avance de la tolva es 30 %."
            />
          </Campo>
          {observar.error && (
            <p role="alert" className="text-sm text-peligro">
              {observar.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={observar.enviando}>
              Observar
            </Boton>
          </div>
        </form>
      </Ventana>
    </div>
  )
}
