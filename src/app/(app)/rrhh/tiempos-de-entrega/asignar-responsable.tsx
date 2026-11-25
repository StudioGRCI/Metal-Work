'use client'

import { UserPlus, UserRound } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo } from '@/components/ui/campos'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { SeleccionBuscable, type OpcionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'

import { asignarResponsable, quitarResponsable } from './acciones'

/**
 * Recursos Humanos pone a una persona del personal a cargo de una etapa, la
 * cambia o la quita (migración 20261125310000). La persona de antes queda en
 * el historial; las fechas de la etapa no se tocan.
 */
export function AsignarResponsable({
  etapa,
  actual,
  personas,
}: {
  etapa: { id: string; nombre: string }
  actual: { trabajador_id: string; nombre: string } | null
  personas: OpcionBuscable[]
}) {
  const [abierta, setAbierta] = useState(false)
  const [persona, setPersona] = useState(actual?.trabajador_id ?? '')
  const cerrar = () => setAbierta(false)
  // Corrige lo que la fila muestra: la ventana se cierra cuando la fila ya
  // dice quién la lleva. Cerrada antes, volver a abrirla traía a la persona de
  // antes y «Cambiar» deshacía la asignación sin aviso.
  const asignar = useEnvio(asignarResponsable, cerrar, { corrige: true, documento: etapa.id })
  const quitar = useEnvio(quitarResponsable, cerrar, { corrige: true, documento: etapa.id })
  const enviando = asignar.enviando || quitar.enviando
  const abrir = () => {
    setPersona(actual?.trabajador_id ?? '')
    asignar.limpiar()
    quitar.limpiar()
    setAbierta(true)
  }
  const idCampo = `responsable-${etapa.id}`

  return (
    <>
      <Boton type="button" variante="contorno" tamano="sm" onClick={abrir} aria-label={actual ? `Cambiar a quién lleva «${etapa.nombre}»` : `Asignar persona a «${etapa.nombre}»`}>
        {actual ? <UserRound aria-hidden className="size-4" /> : <UserPlus aria-hidden className="size-4" />}
        {actual ? 'Cambiar' : 'Asignar persona'}
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={cerrar}
        titulo={`Quién lleva «${etapa.nombre}»`}
        descripcion="La persona del personal a cargo de la etapa. Las fechas las sigue poniendo Diseño."
        ancho="sm"
      >
        <form onSubmit={asignar.alEnviar} className="space-y-4">
          <input type="hidden" name="etapa_id" value={etapa.id} />
          <fieldset disabled={enviando} className="space-y-4">
            <Campo etiqueta="Persona" htmlFor={idCampo} requerido>
              <SeleccionBuscable
                id={idCampo}
                name="trabajador_id"
                opciones={personas}
                valor={persona}
                onChange={setPersona}
                marcador="Elige a la persona"
                marcadorBusqueda="Escribe el nombre o el área"
                requerido
                permiteVaciar={false}
              />
            </Campo>
          </fieldset>
          <PieDeVentana error={asignar.error} enviando={asignar.enviando} alCancelar={cerrar} texto={actual ? 'Cambiar' : 'Asignar'} disabled={quitar.enviando} />
        </form>
        {actual && (
          <form onSubmit={quitar.alEnviar} className="mt-4 border-t border-borde pt-4">
            <input type="hidden" name="etapa_id" value={etapa.id} />
            <p className="mb-2 text-sm text-texto-suave">Ahora la lleva {actual.nombre}.</p>
            <Boton type="submit" variante="contornoPeligro" tamano="sm" cargando={quitar.enviando} disabled={asignar.enviando}>
              Dejarla sin nadie
            </Boton>
            {quitar.error && (
              <p role="alert" className="mt-2 text-sm text-peligro">
                {quitar.error}
              </p>
            )}
          </form>
        )}
      </Ventana>
    </>
  )
}
