'use client'

import { Check, X } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import type { PuestoAprobador, ReglaAprobacion } from '@/lib/datos/aprobacion-compras'
import { useAccion, useEnvio } from '@/lib/envio'

import { aprobarCompra, fijarReglaAprobacion, rechazarCompra } from './acciones'

export function FormularioRegla({ regla, puestos }: { regla: ReglaAprobacion | null; puestos: PuestoAprobador[] }) {
  const [activa, setActiva] = useState(regla?.activa ? 'true' : 'false')
  const { alEnviar, enviando, error, resultado } = useEnvio(fijarReglaAprobacion)
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo etiqueta="¿Pedir aprobación?" htmlFor="regla-activa">
          <Seleccion id="regla-activa" name="activa" value={activa} onChange={(e) => setActiva(e.target.value)}>
            <option value="true">Sí, desde un monto</option>
            <option value="false">No, apagada</option>
          </Seleccion>
        </Campo>
        <Campo etiqueta="Desde (en soles, sin IGV)" htmlFor="regla-monto" ayuda="Una compra en dólares se pasa a soles con el tipo de cambio del día.">
          <Entrada
            id="regla-monto"
            name="monto_desde"
            type="number"
            min={0}
            step="0.01"
            defaultValue={regla?.monto_desde ?? 5000}
            required
          />
        </Campo>
        <Campo etiqueta="La aprueba" htmlFor="regla-puesto">
          <Seleccion id="regla-puesto" name="rol_aprobador" defaultValue={regla?.rol_aprobador_id ?? ''} required>
            <option value="" disabled>
              Elige el puesto…
            </option>
            {puestos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </Seleccion>
        </Campo>
      </div>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      {resultado?.ok && (
        <p role="status" className="text-sm text-exito">
          {resultado.mensaje}
        </p>
      )}
      <div className="flex justify-end">
        <Boton type="submit" cargando={enviando}>
          Guardar regla
        </Boton>
      </div>
    </form>
  )
}

export function DecisionCompra({ id, numero, tipo }: { id: string; numero: string; tipo: 'OC' | 'OS' }) {
  const [rechazando, setRechazando] = useState(false)
  const aprobacion = useAccion(aprobarCompra)
  const rechazo = useEnvio(rechazarCompra, () => setRechazando(false))

  function aprobar() {
    const datos = new FormData()
    datos.set('id', id)
    datos.set('tipo', tipo)
    aprobacion.ejecutar(datos)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Boton type="button" cargando={aprobacion.enviando} onClick={aprobar}>
        <Check aria-hidden className="size-4" />
        Aprobar
      </Boton>
      <Boton type="button" variante="contornoPeligro" onClick={() => setRechazando(true)}>
        <X aria-hidden className="size-4" />
        Rechazar
      </Boton>
      {aprobacion.error && (
        <p role="alert" className="w-full text-sm text-peligro">
          {aprobacion.error}
        </p>
      )}
      <Ventana
        abierta={rechazando}
        alCerrar={() => setRechazando(false)}
        titulo={`Rechazar la orden ${numero}`}
        descripcion={
          tipo === 'OS'
            ? 'Logística recibe el motivo. Una orden de servicio rechazada no se reabre: se emite otra.'
            : 'Si venía de un requerimiento, sus insumos vuelven a quedar por comprar. Logística recibe el motivo. Una compra rechazada no se reabre: se emite otra.'
        }
        ancho="md"
      >
        <form onSubmit={rechazo.alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="tipo" value={tipo} />
          <Campo etiqueta="Motivo" htmlFor={`motivo-${id}`} requerido>
            <AreaTexto
              id={`motivo-${id}`}
              name="motivo"
              required
              minLength={10}
              maxLength={500}
              placeholder="Por ejemplo: el precio está por encima de la última compra; cotizar con otro proveedor."
            />
          </Campo>
          {rechazo.error && (
            <p role="alert" className="text-sm text-peligro">
              {rechazo.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setRechazando(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" cargando={rechazo.enviando}>
              Rechazar
            </Boton>
          </div>
        </form>
      </Ventana>
    </div>
  )
}
