'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useAccion, useEnvio } from '@/lib/envio'
import { borrarEvaluacionDiseno, cambiarEstadoEvaluacion } from '../acciones'

/**
 * Lo que se puede hacer con la evaluación según quién mira y en qué estado
 * está. La base vuelve a comprobarlo todo (migración 20261001190000): esconder
 * un botón aquí no da ni quita permisos.
 */
export function AccionesEvaluacion({ id, puedeEnviar, puedeBorrar, puedeRecibir, reenvio }: {
  id: string
  puedeEnviar: boolean
  puedeBorrar: boolean
  puedeRecibir: boolean
  reenvio: boolean
}) {
  if (!puedeEnviar && !puedeBorrar && !puedeRecibir) return null
  return (
    <div className="space-y-3 border-t border-borde pt-4">
      {puedeEnviar && <Enviar id={id} reenvio={reenvio} />}
      {puedeRecibir && <RecibirODevolver id={id} />}
      {puedeBorrar && <Borrar id={id} />}
    </div>
  )
}

function datosDe(id: string, accion: string) {
  const datos = new FormData()
  datos.set('id', id)
  datos.set('accion', accion)
  return datos
}

function Enviar({ id, reenvio }: { id: string; reenvio: boolean }) {
  const [abierta, setAbierta] = useState(false)
  const accion = useAccion(cambiarEstadoEvaluacion, () => setAbierta(false))
  return (
    <>
      <Boton type="button" className="w-full justify-center" onClick={() => { accion.limpiar(); setAbierta(true) }}>
        {reenvio ? 'Reenviar corregida a Administración' : 'Enviar a Administración'}
      </Boton>
      <p className="text-xs text-texto-suave">
        Revísala antes: enviada, queda cerrada y Administración la recibe tal cual.
      </p>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={reenvio ? '¿Reenviar la evaluación corregida?' : '¿Enviar la evaluación a Administración?'}
        descripcion="Después ya no se puede corregir, salvo que Administración la devuelva con una observación."
      >
        {accion.error && <p role="alert" className="mb-3 text-sm text-peligro">{accion.error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Boton type="button" variante="secundario" onClick={() => setAbierta(false)}>Cancelar</Boton>
          <Boton type="button" cargando={accion.enviando} onClick={() => accion.ejecutar(datosDe(id, 'enviar'))}>Enviar</Boton>
        </div>
      </Ventana>
    </>
  )
}

function RecibirODevolver({ id }: { id: string }) {
  const [devolviendo, setDevolviendo] = useState(false)
  const recibir = useAccion(cambiarEstadoEvaluacion)
  const devolver = useEnvio(cambiarEstadoEvaluacion, () => setDevolviendo(false))
  return (
    <div className="space-y-3">
      {!devolviendo && (
        <>
          <Boton type="button" className="w-full justify-center" cargando={recibir.enviando} onClick={() => recibir.ejecutar(datosDe(id, 'recibir'))}>
            Marcar como recibida
          </Boton>
          <Boton type="button" variante="secundario" className="w-full justify-center" onClick={() => { devolver.limpiar(); setDevolviendo(true) }}>
            Devolver a Diseño para corregir
          </Boton>
          {recibir.error && <p role="alert" className="text-sm text-peligro">{recibir.error}</p>}
          <p className="text-xs text-texto-suave">Recibida, ya no se puede devolver.</p>
        </>
      )}
      {devolviendo && (
        <form onSubmit={devolver.alEnviar} className="space-y-3">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="accion" value="devolver" />
          <Campo etiqueta="Qué hay que corregir" htmlFor="ev-observacion" requerido>
            <AreaTexto id="ev-observacion" name="observacion" minLength={10} maxLength={1000} rows={4} required />
          </Campo>
          {devolver.error && <p role="alert" className="text-sm text-peligro">{devolver.error}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <Boton type="button" variante="secundario" onClick={() => setDevolviendo(false)}>Cancelar</Boton>
            <Boton type="submit" cargando={devolver.enviando}>Devolver con esta observación</Boton>
          </div>
        </form>
      )}
    </div>
  )
}

function Borrar({ id }: { id: string }) {
  const router = useRouter()
  const [abierta, setAbierta] = useState(false)
  const accion = useAccion(borrarEvaluacionDiseno, () => router.push('/diseno/evaluaciones'), { refrescar: false })
  return (
    <>
      <Boton type="button" variante="contornoPeligro" className="w-full justify-center" onClick={() => { accion.limpiar(); setAbierta(true) }}>
        Borrar borrador
      </Boton>
      <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo="¿Borrar este borrador?"
        descripcion="Nunca salió hacia Administración, así que se puede borrar. No hay forma de recuperarlo.">
        {accion.error && <p role="alert" className="mb-3 text-sm text-peligro">{accion.error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Boton type="button" variante="secundario" onClick={() => setAbierta(false)}>Cancelar</Boton>
          <Boton type="button" variante="peligro" cargando={accion.enviando} onClick={() => accion.ejecutar(datosDe(id, 'borrar'))}>Borrar</Boton>
        </div>
      </Ventana>
    </>
  )
}
