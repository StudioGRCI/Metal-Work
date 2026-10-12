'use client'

import { LogIn } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { MOTIVO_VEHICULO } from '@/lib/dominio/requerimientos'
import { useEnvio } from '@/lib/envio'

import { registrarIngresoVehiculo } from './acciones'

/** El botón «Registrar ingreso» y su ventana. */
export function NuevoIngresoVehiculo() {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  return (
    <>
      <Boton
        type="button"
        onClick={() => {
          setAviso(null)
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        <LogIn aria-hidden className="size-4" />
        Registrar ingreso
      </Boton>
      {aviso && (
        <p role="status" className="basis-full text-sm text-exito">
          {aviso}
        </p>
      )}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Ingreso de vehículo"
        descripcion="Un vehículo entra a la planta. La salida se marca después en la misma fila."
        ancho="lg"
      >
        <FormularioIngreso
          key={vez}
          alTerminar={(mensaje) => {
            setAbierta(false)
            setAviso(mensaje)
          }}
        />
      </Ventana>
    </>
  )
}

function FormularioIngreso({ alTerminar }: { alTerminar: (mensaje: string) => void }) {
  // Decidido aquí: un reintento manda el mismo y la base no duplica el ingreso.
  const [id] = useState(() => crypto.randomUUID())
  const { alEnviar, enviando, error } = useEnvio(registrarIngresoVehiculo, (r) => alTerminar(r.mensaje ?? 'Ingreso registrado.'))
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="operacion_id" value={id} />
      <p className="text-xs text-texto-suave">Anota al menos uno de los tres: placa, chasis o código interno.</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo etiqueta="Placa" htmlFor="veh-placa">
          <Entrada id="veh-placa" name="placa" maxLength={15} autoComplete="off" placeholder="ABC-123" className="uppercase" />
        </Campo>
        <Campo etiqueta="N.º de chasis" htmlFor="veh-chasis" ayuda="Para un chasis nuevo que todavía no tiene placa.">
          <Entrada id="veh-chasis" name="chasis" maxLength={40} autoComplete="off" className="uppercase" />
        </Campo>
        <Campo etiqueta="Código interno" htmlFor="veh-codigo" ayuda="El de la unidad, si ya lo tiene.">
          <Entrada id="veh-codigo" name="codigo_interno" maxLength={60} autoComplete="off" placeholder="PLA_SR_O4_1_26/28" />
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo etiqueta="Vehículo" htmlFor="veh-unidad" requerido>
          <Entrada id="veh-unidad" name="unidad" required minLength={2} maxLength={120} placeholder="Tolva 18 m³ Volvo FMX" />
        </Campo>
        <Campo etiqueta="Empresa" htmlFor="veh-empresa" requerido ayuda="El cliente o dueño del vehículo.">
          <Entrada id="veh-empresa" name="empresa" required minLength={2} maxLength={160} />
        </Campo>
        <Campo etiqueta="Motivo" htmlFor="veh-motivo" requerido>
          <Seleccion id="veh-motivo" name="motivo" required defaultValue="">
            <option value="" disabled>
              Elige el motivo
            </option>
            {Object.entries(MOTIVO_VEHICULO).map(([valor, m]) => (
              <option key={valor} value={valor}>
                {m.etiqueta}
              </option>
            ))}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Fecha y hora de ingreso" htmlFor="veh-ingreso" ayuda="Déjalo vacío si entra ahora.">
          <Entrada id="veh-ingreso" name="ingreso_en" type="datetime-local" />
        </Campo>
      </div>
      <Campo etiqueta="Observación" htmlFor="veh-obs">
        <AreaTexto id="veh-obs" name="observacion" maxLength={500} rows={2} placeholder="Cómo llega: llanta baja, sin espejo derecho, con documentos…" />
      </Campo>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Boton type="submit" cargando={enviando}>
          Registrar ingreso
        </Boton>
      </div>
    </form>
  )
}
