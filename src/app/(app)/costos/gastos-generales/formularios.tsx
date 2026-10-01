'use client'

import { Ban, Plus } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'

import { anularGastoGeneral, registrarGastoGeneral } from './acciones'

export type ConceptoParaElegir = { codigo: string; nombre: string; grupo: string; tasa: number | null }

const GRUPOS = [
  { grupo: 'LOCAL', titulo: 'Servicios del local' },
  { grupo: 'OPERACION', titulo: 'Gastos de operación' },
]

/**
 * Registrar un gasto del mes. Cada concepto trae la tasa de la hoja RESUMEN de
 * la empresa —luz 8 %, agua 10 %…—: el porcentaje del gasto que se carga a
 * cada OT trabajada ese mes. Si el gasto se reparte mejor por igual entre
 * todas, se elige «Partes iguales».
 */
export function NuevoGastoGeneral({ conceptos, mes }: { conceptos: ConceptoParaElegir[]; mes: string }) {
  const [abierta, setAbierta] = useState(false)
  const [id, setId] = useState(() => crypto.randomUUID())
  const [concepto, setConcepto] = useState('')
  const [reparto, setReparto] = useState<'TASA' | 'PARTES_IGUALES'>('TASA')
  const [tasa, setTasa] = useState('')

  const { alEnviar, enviando, error, resultado } = useEnvio(registrarGastoGeneral, () => {
    setId(crypto.randomUUID())
    setConcepto('')
    setTasa('')
    setReparto('TASA')
    setAbierta(false)
  })

  function elegirConcepto(codigo: string) {
    setConcepto(codigo)
    const elegido = conceptos.find((c) => c.codigo === codigo)
    if (elegido?.tasa != null) {
      setTasa(String(elegido.tasa))
      setReparto('TASA')
    } else {
      setTasa('')
      setReparto('PARTES_IGUALES')
    }
  }

  return (
    <>
      <Boton onClick={() => setAbierta(true)}>
        <Plus aria-hidden className="size-4" />Registrar gasto
      </Boton>
      {resultado?.ok && <p role="status" className="mt-2 text-sm text-exito">{resultado.mensaje}</p>}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Gasto del mes"
        descripcion="Servicios del local y gastos de operación que no son de una OT. Se reparten entre las OT trabajadas ese mes."
        ancho="lg"
      >
        <form key={id} onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="operacion_id" value={id} />
          <input type="hidden" name="reparto" value={reparto} />

          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <Campo etiqueta="Mes" htmlFor="gg-mes" requerido>
              <Entrada id="gg-mes" name="mes" type="month" defaultValue={mes} required />
            </Campo>
            <Campo etiqueta="Concepto" htmlFor="gg-concepto" requerido>
              <Seleccion id="gg-concepto" name="concepto" value={concepto} onChange={(e) => elegirConcepto(e.target.value)} required>
                <option value="" disabled>Elige el concepto</option>
                {GRUPOS.map((g) => (
                  <optgroup key={g.grupo} label={g.titulo}>
                    {conceptos.filter((c) => c.grupo === g.grupo).map((c) => (
                      <option key={c.codigo} value={c.codigo}>{c.nombre}</option>
                    ))}
                  </optgroup>
                ))}
              </Seleccion>
            </Campo>
          </div>

          <Campo etiqueta="Detalle" htmlFor="gg-descripcion" requerido ayuda="El recibo o el documento: «Recibo Luz del Sur de setiembre».">
            <Entrada id="gg-descripcion" name="descripcion" required minLength={3} maxLength={300} />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
            <Campo etiqueta="Importe del mes" htmlFor="gg-monto" requerido>
              <Entrada id="gg-monto" name="monto" type="number" inputMode="decimal" min={0.01} step="0.01" required />
            </Campo>
            <Campo etiqueta="Moneda" htmlFor="gg-moneda" requerido>
              <Seleccion id="gg-moneda" name="moneda" defaultValue="PEN" required>
                <option value="PEN">Soles</option>
                <option value="USD">Dólares</option>
              </Seleccion>
            </Campo>
          </div>

          <fieldset className="space-y-3 rounded-[var(--radius-base)] border border-borde p-3">
            <legend className="px-1 text-sm font-medium text-texto">¿Cómo se reparte entre las OT? <span className="text-peligro">*</span></legend>
            <div role="group" aria-label="Forma de reparto" className="flex flex-wrap gap-2">
              <Boton type="button" tamano="sm" variante={reparto === 'TASA' ? 'primario' : 'contorno'}
                aria-pressed={reparto === 'TASA'} onClick={() => setReparto('TASA')}>
                Tasa por OT
              </Boton>
              <Boton type="button" tamano="sm" variante={reparto === 'PARTES_IGUALES' ? 'primario' : 'contorno'}
                aria-pressed={reparto === 'PARTES_IGUALES'} onClick={() => setReparto('PARTES_IGUALES')}>
                Partes iguales
              </Boton>
            </div>
            {reparto === 'TASA' ? (
              <Campo etiqueta="Tasa por OT (%)" htmlFor="gg-tasa" requerido
                ayuda="Qué porcentaje del gasto del mes se carga a cada OT trabajada ese mes, como en la hoja RESUMEN.">
                <Entrada id="gg-tasa" name="tasa" type="number" inputMode="decimal" min={0.001} max={100} step="0.001"
                  value={tasa} onChange={(e) => setTasa(e.target.value)} required />
              </Campo>
            ) : (
              <p className="text-sm text-texto-suave">
                El gasto se divide en partes iguales entre las OT que figuran en las planillas cerradas de ese mes.
              </p>
            )}
          </fieldset>

          {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
          <Boton type="submit" cargando={enviando}>Registrar gasto</Boton>
        </form>
      </Ventana>
    </>
  )
}

/** Anular con motivo. El gasto se queda en la lista, tachado, con quién y cuándo. */
export function AnularGastoGeneral({ id, nombre }: { id: string; nombre: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(anularGastoGeneral, () => setAbierta(false))

  return (
    <>
      <Boton tamano="sm" variante="contornoPeligro" onClick={() => setAbierta(true)} aria-label={`Anular ${nombre}`}>
        <Ban aria-hidden className="size-4" />Anular
      </Boton>
      <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo={`Anular ${nombre}`}
        descripcion="Deja de sumar en el costeo de las OT. No se borra: queda a la vista con el motivo.">
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <Campo etiqueta="Motivo" htmlFor={`anular-${id}`} requerido>
            <AreaTexto id={`anular-${id}`} name="motivo" rows={3} required minLength={5} maxLength={300}
              placeholder="Ej.: se registró dos veces el mismo recibo" />
          </Campo>
          {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
          <Boton type="submit" variante="peligro" cargando={enviando}>Anular gasto</Boton>
        </form>
      </Ventana>
    </>
  )
}
