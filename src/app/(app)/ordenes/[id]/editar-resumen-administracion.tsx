'use client'

import { useState } from 'react'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion, AreaTexto } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import type { obtenerOrden, responsablesDeOrden } from '@/lib/datos/ordenes'
import { editarResumenAdministracion } from './acciones-edicion'

export function EditarResumenAdministracion({ orden, responsables }: {
  orden: NonNullable<Awaited<ReturnType<typeof obtenerOrden>>>
  responsables: Awaited<ReturnType<typeof responsablesDeOrden>>
}) {
  const [abierta, setAbierta] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const { alEnviar, enviando, error } = useEnvio(editarResumenAdministracion, (r) => {
    setAbierta(false)
    setMensaje(r.mensaje ?? 'Datos guardados.')
  })
  if (!orden.unidad) return null
  return <>
    <Boton variante="secundario" tamano="sm" onClick={() => { setMensaje(''); setAbierta(true) }}>
      Editar vehículo y responsable
    </Boton>
    {mensaje && <p role="status" className="text-xs text-exito">{mensaje}</p>}
    <Ventana abierta={abierta} alCerrar={() => { if (!enviando) setAbierta(false) }}
      titulo={`Vehículo y responsable · OT ${orden.numero}`}
      descripcion="Administración corrige estos datos y deja el motivo en Trazabilidad.">
      <form onSubmit={alEnviar} className="space-y-4">
        <input type="hidden" name="orden_id" value={orden.id} />
        <input type="hidden" name="version" value={orden.actualizado_en} />
        <input type="hidden" name="unidad_version" value={orden.unidad.actualizado_en} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Marca" htmlFor="resumen-marca">
            <Entrada id="resumen-marca" name="marca" maxLength={80} defaultValue={orden.unidad.marca ?? ''} />
          </Campo>
          <Campo etiqueta="Modelo" htmlFor="resumen-modelo">
            <Entrada id="resumen-modelo" name="modelo" maxLength={80} defaultValue={orden.unidad.modelo ?? ''} />
          </Campo>
        </div>
        <Campo etiqueta="Año" htmlFor="resumen-anio">
          <Entrada id="resumen-anio" name="anio" type="number" min={1950} max={2100}
            defaultValue={orden.unidad.anio ?? ''} />
        </Campo>
        <Campo etiqueta="Responsable de la OT" htmlFor="resumen-responsable">
          <Seleccion id="resumen-responsable" name="responsable_id" defaultValue={orden.responsable_id ?? ''}>
            <option value="">Sin asignar</option>
            {responsables.map((persona) => <option key={persona.id} value={persona.id}>
              {[persona.nombres, persona.apellidos].filter(Boolean).join(' ') || persona.cargo || persona.correo || persona.id}
            </option>)}
          </Seleccion>
        </Campo>
        <Campo etiqueta="Motivo del cambio" htmlFor="resumen-motivo" requerido>
          <AreaTexto id="resumen-motivo" name="motivo" minLength={5} maxLength={500} required
            placeholder="Explica qué dato corregiste y por qué" />
        </Campo>
        {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
        <div className="flex justify-end gap-2">
          <Boton type="button" variante="secundario" disabled={enviando} onClick={() => setAbierta(false)}>Cancelar</Boton>
          <Boton type="submit" cargando={enviando}>Guardar cambios</Boton>
        </div>
      </form>
    </Ventana>
  </>
}
