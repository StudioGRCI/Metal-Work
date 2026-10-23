'use client'

import Link from 'next/link'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import type { EntregaPorValidar } from '@/lib/datos/ingresos-por-validar'
import { partesDeNombreDeOc } from '@/lib/dominio/adquisiciones'
import { useEnvio } from '@/lib/envio'
import { cantidad, fechaHora } from '@/lib/format'

import { validarIngresosCompra } from './acciones'

/**
 * La bandeja: una compra por bloque. Al validar, el bloque desaparece con el
 * refresco, así que el aviso de que entró vive aquí y no en el bloque.
 */
export function BandejaPorValidar({ entregas, puedeValidar, abreOt }: { entregas: EntregaPorValidar[]; puedeValidar: boolean; abreOt: boolean }) {
  const [mensaje, setMensaje] = useState<string | null>(null)
  return (
    <div className="space-y-3">
      {mensaje && <p role="status" className="text-sm text-exito">{mensaje}</p>}
      {entregas.length === 0 ? (
        <p className="text-sm text-texto-suave">Nada por validar. Cuando el conductor deje una compra en almacén, aparecerá aquí y te llegará un aviso.</p>
      ) : entregas.map((e) => (
        <EntregaParaValidar key={e.compraId} entrega={e} puedeValidar={puedeValidar} abreOt={abreOt} alValidar={setMensaje} />
      ))}
    </div>
  )
}

/**
 * Lo que el conductor dejó en almacén, una compra por bloque. Viene lleno con
 * lo que dejó: si llegó todo, basta «Validar ingreso». Si llegó menos, se
 * corrige la cantidad y se cuenta qué faltó; esa línea queda observada para
 * Logística y lo que sí llegó entra igual al kardex.
 */
function EntregaParaValidar({ entrega, puedeValidar, abreOt, alValidar }: {
  entrega: EntregaPorValidar
  puedeValidar: boolean
  /** Almacén ya no abre la OT (2026-10-15): el número queda como referencia. */
  abreOt: boolean
  alValidar: (mensaje: string) => void
}) {
  const { alEnviar, enviando, error } = useEnvio(validarIngresosCompra,
    (r) => alValidar(`${entrega.referencia}: ${r.mensaje ?? 'ingreso validado.'}`))
  // Lo que se escribe en cada línea: la cantidad decide si pide observación.
  const [llego, setLlego] = useState<Record<string, string>>(() =>
    Object.fromEntries(entrega.lineas.map((l) => [l.id, String(l.cantidad)])))
  const [observar, setObservar] = useState<Record<string, boolean>>({})
  const prefijo = `pv-${entrega.compraId.slice(0, 8)}`
  // La base la da nombrada entera; el título lleva el número y la referencia va debajo.
  const oc = partesDeNombreDeOc(entrega.referencia)

  const faltaAlgo = entrega.lineas.some((l) => Number(llego[l.id]) < l.cantidad || observar[l.id])

  return (
    <form onSubmit={alEnviar} className="rounded-[var(--radius-base)] border border-borde bg-superficie" aria-labelledby={`${prefijo}-titulo`}>
      <input type="hidden" name="compra_id" value={entrega.compraId} />
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-borde px-4 py-3">
        <div className="min-w-0">
          <h3 id={`${prefijo}-titulo`} className="text-sm font-semibold text-texto">
            {oc.numero ?? 'OC sin número'} · <span className="font-normal">{entrega.proveedor}</span>
          </h3>
          {oc.referencia && <p className="text-xs text-texto-suave">Ref. del proveedor: {oc.referencia}</p>}
          <p className="text-xs text-texto-suave">
            Dejado {fechaHora(entrega.dejadoEn)}{entrega.dejadoPor ? ` por ${entrega.dejadoPor}` : ''}
            {entrega.recogidoEn ? ` · recogido ${fechaHora(entrega.recogidoEn)}` : ''}
          </p>
        </div>
        <Insignia tono={entrega.directa ? 'info' : 'neutro'}>{entrega.directa ? 'Compra para stock' : 'Compra de OT'}</Insignia>
      </div>

      <ul className="divide-y divide-borde">
        {entrega.lineas.map((l) => {
          const valor = llego[l.id] ?? ''
          const menos = valor !== '' && Number(valor) < l.cantidad
          const conObservacion = menos || observar[l.id]
          return (
            <li key={l.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-start">
              <input type="hidden" name="linea" value={l.id} />
              <div className="min-w-0">
                <p className="text-sm font-medium text-texto">{l.descripcion}</p>
                <p className="text-xs text-texto-suave">
                  <span className="font-mono">{l.codigo}</span> · dejó {cantidad(l.cantidad)} {l.unidad ?? ''}
                  {l.ordenId && l.ordenNumero && (
                    <> · {abreOt ? <Link href={`/ordenes/${l.ordenId}?vista=materiales`} className="text-acento hover:underline">OT {l.ordenNumero}</Link> : `OT ${l.ordenNumero}`}</>
                  )}
                </p>
                {conObservacion && (
                  <Campo etiqueta={menos ? 'Qué faltó' : 'Observación'} htmlFor={`${prefijo}-obs-${l.id}`} requerido className="mt-2">
                    <AreaTexto id={`${prefijo}-obs-${l.id}`} name={`observacion_${l.id}`} required minLength={10} maxLength={500}
                      placeholder={menos ? 'Ej.: llegaron 8 planchas, el proveedor quedó en mandar 2 el lunes' : 'Ej.: dos planchas llegaron dobladas en el borde'}
                      disabled={!puedeValidar} />
                  </Campo>
                )}
              </div>
              <div className="flex flex-wrap items-end gap-2 sm:justify-end">
                <Campo etiqueta={`Llegó${l.unidad ? ` (${l.unidad})` : ''}`} htmlFor={`${prefijo}-cant-${l.id}`} className="w-32">
                  <Entrada id={`${prefijo}-cant-${l.id}`} name={`cantidad_${l.id}`} type="number" inputMode="decimal"
                    min={0} max={l.cantidad} step="0.001" required value={valor} disabled={!puedeValidar}
                    onChange={(e) => setLlego((s) => ({ ...s, [l.id]: e.target.value }))} className="tabular text-right" />
                </Campo>
                {puedeValidar && !menos && (
                  <Boton type="button" variante="fantasma" tamano="sm" aria-pressed={Boolean(observar[l.id])}
                    onClick={() => setObservar((s) => ({ ...s, [l.id]: !s[l.id] }))}>
                    {observar[l.id] ? 'Quitar observación' : 'Observar'}
                  </Boton>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      {puedeValidar ? (
        <div className="flex flex-wrap items-end gap-3 border-t border-borde px-4 py-3">
          <Campo etiqueta="Guía de remisión" htmlFor={`${prefijo}-guia`} ayuda={`Vacío: queda con ${entrega.referencia}.`} className="w-full sm:w-64">
            <Entrada id={`${prefijo}-guia`} name="documento" maxLength={100} autoComplete="off" disabled={enviando} />
          </Campo>
          <Boton type="submit" cargando={enviando} variante={faltaAlgo ? 'contorno' : 'primario'}>
            {faltaAlgo ? 'Validar con observación' : 'Validar ingreso'}
          </Boton>
          {error && <p role="alert" className="w-full text-sm text-peligro">{error}</p>}
        </div>
      ) : (
        <p className="border-t border-borde px-4 py-3 text-xs text-texto-suave">Lo valida quien recibe en Almacén.</p>
      )}
    </form>
  )
}
