'use client'

import { Ban, Plus } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'

import { anularGastoGeneral, registrarGastoGeneral } from './acciones'

export type ConceptoParaElegir = { codigo: string; nombre: string; grupo: string }

const GRUPOS = [
  { grupo: 'LOCAL', titulo: 'Servicios del local' },
  { grupo: 'OPERACION', titulo: 'Gastos de operación' },
]

/**
 * Registrar un gasto del mes. Se reparte por horas entre las unidades que
 * trabajaron ese mes: cada una carga la parte de sus horas (DKS lo eligió el
 * 2026-10-20). No hay nada que elegir: la base lo calcula al leer el costeo.
 */
export function NuevoGastoGeneral({ conceptos, mes }: { conceptos: ConceptoParaElegir[]; mes: string }) {
  const [abierta, setAbierta] = useState(false)
  const [id, setId] = useState(() => crypto.randomUUID())

  // El id vive fuera de la ventana y vuelve con ella hasta saber cómo terminó:
  // con el mismo, la base reconoce el reenvío. Si dice que el primero ya quedó,
  // el siguiente gasto es otro; antes el id quedaba pegado hasta recargar.
  const { alEnviar, enviando, error, resultado } = useEnvio(
    registrarGastoGeneral,
    () => {
      setId(crypto.randomUUID())
      setAbierta(false)
    },
    { alYaEntrar: () => setId(crypto.randomUUID()) },
  )

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
        descripcion="Servicios del local y gastos de operación que no son de una unidad. Se reparten por horas entre las unidades que trabajaron ese mes."
        ancho="lg"
      >
        <form key={id} onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="operacion_id" value={id} />

          <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
            <Campo etiqueta="Mes" htmlFor="gg-mes" requerido>
              <Entrada id="gg-mes" name="mes" type="month" defaultValue={mes} required />
            </Campo>
            <Campo etiqueta="Concepto" htmlFor="gg-concepto" requerido>
              <Seleccion id="gg-concepto" name="concepto" defaultValue="" required>
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

          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Registrar gasto" />
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
        descripcion="Deja de sumar en el costo de los códigos internos. No se borra: queda a la vista con el motivo.">
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
