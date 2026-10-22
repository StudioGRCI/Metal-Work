'use client'

import { createContext, useContext, useState } from 'react'

import { AvisoEnfocado } from '@/components/ui/aviso-enfocado'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import type { EsperaDeLaFactura } from '@/lib/datos/adquisiciones'
import { useEnvio } from '@/lib/envio'
import { fecha, moneda } from '@/lib/format'

import { confirmarPagoDeBoleta } from './acciones'

const Avisar = createContext<((mensaje: string) => void) | null>(null)

/**
 * Lo anotado, arriba de la lista: en «Pago por confirmar» la fila se va al
 * anotarlo, y con ella el botón que se tocó y lo que dijera a su lado.
 */
export function ConAvisosDeLoAnotado({ children }: { children: React.ReactNode }) {
  const [aviso, setAviso] = useState<{ mensaje: string; n: number } | null>(null)
  return (
    <Avisar.Provider value={(mensaje) => setAviso((previo) => ({ mensaje, n: (previo?.n ?? 0) + 1 }))}>
      {aviso && (
        <AvisoEnfocado key={aviso.n} className="mb-3 rounded-[var(--radius-base)] border border-borde bg-superficie px-3 py-2">
          {aviso.mensaje}
        </AvisoEnfocado>
      )}
      {children}
    </Avisar.Provider>
  )
}

/** Para otro botón de la lista que también anota algo y deja su aviso arriba (la nota de crédito). */
export function useAvisoDeLoAnotado() {
  return useContext(Avisar)
}

/**
 * La factura de una OC con boleta que se dio por pagada fuera espera que
 * Contabilidad diga si esa OC ya se pagó o si falta pagarla (decisión de DKS del
 * 22/10, migración 20261022175000). «Ya se pagó» anota cuándo y cuánto, y la
 * factura toma ese pago; «Falta pagarla» la deja para Tesorería. No vuelve atrás.
 *
 * Lo anotado sale arriba de la lista (`ConAvisosDeLoAnotado`), que no se va con
 * la fila: antes salía a su lado y desaparecía en menos de dos segundos, cuando
 * la fila dejaba de esperar.
 */
export function ConfirmarPagoDeBoleta({
  espera,
  factura,
  monedaFactura,
  hoy,
}: {
  espera: EsperaDeLaFactura | null
  factura: string
  monedaFactura: string
  hoy: string
}) {
  const [abierta, setAbierta] = useState<'si' | 'no' | null>(null)
  const avisar = useContext(Avisar)
  // De qué OC fue lo anotado: una factura de dos OC pagadas fuera pasa a esperar por la otra.
  const [hecho, setHecho] = useState<{ oc: string; mensaje: string } | null>(null)
  const aviso = hecho && !avisar ? <AvisoEnfocado className="mt-1 max-w-72 text-xs">{hecho.mensaje}</AvisoEnfocado> : null
  if (!espera || espera.ordenCompraId === hecho?.oc) return aviso
  const otraMoneda = (monedaFactura === 'USD' ? 'USD' : 'PEN') !== (espera.moneda === 'USD' ? 'USD' : 'PEN')
  return (
    <>
      {aviso}
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
          titulo={abierta === 'si' ? `La ${espera.compra} ya se pagó` : `Falta pagar la ${espera.compra}`}
          descripcion={
            abierta === 'si'
              ? otraMoneda
                ? `La factura ${factura} va en otra moneda que la OC: no toma ese pago sola, Tesorería lo pasa al cambio. No vuelve atrás.`
                : `La factura ${factura} toma ese pago; si es por más, Tesorería paga la diferencia, y si es por menos, se devuelve o se descuenta de otra factura. No vuelve atrás.`
              : `Tesorería paga la factura ${factura} en Cuentas por pagar. No vuelve atrás.`
          }
        >
          {abierta && (
            <Formulario
              espera={espera}
              pagada={abierta}
              otraMoneda={otraMoneda}
              hoy={hoy}
              alCancelar={() => setAbierta(null)}
              alTerminar={(mensaje) => {
                setAbierta(null)
                setHecho({ oc: espera.ordenCompraId, mensaje })
              avisar?.(mensaje)
              }}
            />
          )}
        </Ventana>
      </div>
    </>
  )
}

function Formulario({
  espera,
  pagada,
  otraMoneda,
  hoy,
  alCancelar,
  alTerminar,
}: {
  espera: EsperaDeLaFactura
  pagada: 'si' | 'no'
  otraMoneda: boolean
  hoy: string
  alCancelar: () => void
  alTerminar: (mensaje: string) => void
}) {
  const { alEnviar, enviando, error } = useEnvio(confirmarPagoDeBoleta, (r) => alTerminar(r.mensaje ?? 'Anotado.'))
  const m = espera.moneda === 'USD' ? 'USD' : 'PEN'
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="compra" value={espera.ordenCompraId} />
      <input type="hidden" name="pagada" value={pagada} />
      {pagada === 'si' && <input type="hidden" name="otra_moneda" value={otraMoneda ? 'si' : 'no'} />}
      {pagada === 'si' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Se pagó el"
            htmlFor="pb-fecha"
            requerido
            ayuda={espera.desde ? `Desde el ${fecha(espera.desde)}, cuando se emitió la OC.` : undefined}
          >
            <Entrada id="pb-fecha" name="fecha" type="date" min={espera.desde ?? undefined} max={hoy} required />
          </Campo>
          <Campo
            etiqueta={`Se pagó, en ${m === 'USD' ? 'dólares' : 'soles'}`}
            htmlFor="pb-monto"
            requerido
            ayuda={`La OC suma ${moneda(espera.total, m)}.`}
          >
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
      <div className="flex flex-wrap gap-2">
        <Boton type="submit" cargando={enviando}>
          {pagada === 'si' ? 'Anotar que ya se pagó' : 'Anotar que falta pagarla'}
        </Boton>
        <Boton type="button" variante="secundario" onClick={alCancelar} disabled={enviando}>
          Cancelar
        </Boton>
      </div>
    </form>
  )
}
