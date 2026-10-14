'use client'

import { useState } from 'react'

import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { calcularDetraccion, NO_SUJETA, type TipoDetraccion } from '@/lib/dominio/detraccion'
import { moneda } from '@/lib/format'

/**
 * Si el servicio lleva detracción y de qué tipo según SUNAT, o por qué no la
 * lleva. Muestra lo que se depositaría con el monto escrito; la cifra que vale
 * la calcula la base al guardar.
 */
export function SelectorDetraccion({
  id,
  tipos,
  inicial = '',
  motivoInicial = '',
  montoSinIgvPen,
  enDolares,
}: {
  id: string
  tipos: TipoDetraccion[]
  inicial?: string
  motivoInicial?: string
  /** El monto sin IGV en soles; vacío si todavía no se escribe o si es en dólares sin cambio. */
  montoSinIgvPen: number | null
  enDolares: boolean
}) {
  const [elegido, setElegido] = useState(inicial)
  const tipo = tipos.find((t) => t.codigo === elegido) ?? null
  const calculo = tipo ? calcularDetraccion(montoSinIgvPen, tipo.porcentaje, tipo.monto_minimo) : null

  return (
    <div className="space-y-3">
      <Campo
        etiqueta="Detracción (SUNAT)"
        htmlFor={id}
        requerido
        ayuda={tipo ? tipo.ejemplos : 'El tipo de servicio decide el porcentaje. Si dudas, Contabilidad lo corrige después.'}
      >
        <Seleccion id={id} name="detraccion" required value={elegido} onChange={(e) => setElegido(e.target.value)}>
          <option value="" disabled>
            Elige el tipo de servicio…
          </option>
          {tipos.map((t) => (
            <option key={t.codigo} value={t.codigo}>
              {t.codigo} · {t.descripcion} — {t.porcentaje} %
            </option>
          ))}
          <option value={NO_SUJETA}>No está sujeta a detracción</option>
        </Seleccion>
      </Campo>
      {elegido === NO_SUJETA && (
        <Campo etiqueta="Por qué no está sujeta" htmlFor={`${id}-motivo`} requerido>
          <Entrada
            id={`${id}-motivo`}
            name="motivo_detraccion"
            required
            minLength={5}
            maxLength={200}
            defaultValue={motivoInicial}
            placeholder="Por ejemplo: el proveedor no cobra IGV (está en el RUS)."
          />
        </Campo>
      )}
      {tipo && (
        <p className="text-xs text-texto-suave" data-detraccion>
          {calculo === null
            ? enDolares
              ? `Se calcula en soles con el tipo de cambio del día: ${tipo.porcentaje} % del total con IGV, si pasa de ${moneda(tipo.monto_minimo)}.`
              : `Escribe el monto para ver la detracción: ${tipo.porcentaje} % del total con IGV, si pasa de ${moneda(tipo.monto_minimo)}.`
            : calculo.monto === null
              ? `Con IGV suma ${moneda(calculo.total)}: no pasa de ${moneda(tipo.monto_minimo)}, así que no se deposita detracción.`
              : `Con IGV suma ${moneda(calculo.total)}: se depositan ${moneda(calculo.monto)} (${tipo.porcentaje} %) en la cuenta de detracciones del proveedor en el Banco de la Nación.`}
        </p>
      )}
    </div>
  )
}
