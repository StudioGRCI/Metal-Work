'use client'

import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import type { EsperaDeLaFactura } from '@/lib/datos/adquisiciones'
import { useEnvio } from '@/lib/envio'
import { moneda } from '@/lib/format'

import { confirmarPagoDeBoleta } from './acciones'

/**
 * La factura de una OC con boleta que se dio por pagada fuera espera que
 * Contabilidad diga si esa OC ya se pagó o si falta pagarla (decisión de DKS del
 * 22/10, migración 20261022175000). «Ya se pagó» anota cuándo y cuánto, y la
 * factura toma ese pago; «Falta pagarla» la deja para Tesorería. No vuelve atrás.
 */
export function ConfirmarPagoDeBoleta({ espera, factura, hoy }: { espera: EsperaDeLaFactura; factura: string; hoy: string }) {
  const [abierta, setAbierta] = useState<'si' | 'no' | null>(null)
  const [hecho, setHecho] = useState<string | null>(null)
  if (hecho) {
    return (
      <p role="status" className="mt-1 text-xs text-exito">
        {hecho}
      </p>
    )
  }
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      <Boton type="button" variante="secundario" tamano="sm" onClick={() => setAbierta('si')}>
        Ya se pagó
      </Boton>
      <Boton type="button" variante="secundario" tamano="sm" onClick={() => setAbierta('no')}>
        Falta pagarla
      </Boton>
      <Ventana
        abierta={abierta !== null}
        alCerrar={() => setAbierta(null)}
        titulo={abierta === 'si' ? `La ${espera.compra} ya se pagó` : `La ${espera.compra} falta pagarla`}
        descripcion={
          abierta === 'si'
            ? `La factura ${factura} toma ese pago; si es por más, Tesorería paga la diferencia, y si es por menos, se devuelve o se descuenta de otra factura. No vuelve atrás.`
            : `Tesorería paga la factura ${factura} en Cuentas por pagar. No vuelve atrás.`
        }
      >
        {abierta && (
          <Formulario
            espera={espera}
            pagada={abierta}
            hoy={hoy}
            alTerminar={(mensaje) => {
              setAbierta(null)
              setHecho(mensaje)
            }}
          />
        )}
      </Ventana>
    </div>
  )
}

function Formulario({
  espera,
  pagada,
  hoy,
  alTerminar,
}: {
  espera: EsperaDeLaFactura
  pagada: 'si' | 'no'
  hoy: string
  alTerminar: (mensaje: string) => void
}) {
  const { alEnviar, enviando, error } = useEnvio(confirmarPagoDeBoleta, (r) => alTerminar(r.mensaje ?? 'Anotado.'))
  const m = espera.moneda === 'USD' ? 'USD' : 'PEN'
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="compra" value={espera.ordenCompraId} />
      <input type="hidden" name="pagada" value={pagada} />
      {pagada === 'si' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Se pagó el" htmlFor="pb-fecha" requerido>
            <Entrada id="pb-fecha" name="fecha" type="date" max={hoy} required />
          </Campo>
          <Campo etiqueta={`Se pagó, en ${m === 'USD' ? 'dólares' : 'soles'}`} htmlFor="pb-monto" requerido ayuda={`La OC suma ${moneda(espera.total, m)}.`}>
            <Entrada
              id="pb-monto"
              name="monto"
              type="number"
              min="0.01"
              max={espera.total}
              step="0.01"
              inputMode="decimal"
              required
              defaultValue={espera.total.toFixed(2)}
              className="tabular"
            />
          </Campo>
        </div>
      )}
      <Campo etiqueta="Cómo lo sabes" htmlFor="pb-nota" requerido ayuda="Queda anotado con la OC. Al menos 10 caracteres.">
        <AreaTexto
          id="pb-nota"
          name="nota"
          required
          minLength={10}
          maxLength={500}
          rows={3}
          placeholder={pagada === 'si' ? 'Transferencia del 15/10, según el estado de cuenta' : 'El proveedor dice que no le pagaron'}
        />
      </Campo>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <Boton type="submit" cargando={enviando}>
        {pagada === 'si' ? 'Anotar que ya se pagó' : 'Anotar que falta pagarla'}
      </Boton>
    </form>
  )
}
