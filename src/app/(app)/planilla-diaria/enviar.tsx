'use client'

import { Send } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Ventana } from '@/components/ui/ventana'
import { useAccion } from '@/lib/envio'

import { enviarPlanillaDiaria } from './acciones'

/**
 * Armar la planilla con lo que está en la tarjeta y mandarla a Tesorería. El
 * id llega del servidor con la página: un segundo toque o un reintento mandan
 * el mismo y la base devuelve la planilla ya armada.
 */
export function EnviarPlanilla({ id, resumen }: { id: string; resumen: string }) {
  const router = useRouter()
  const [abierta, setAbierta] = useState(false)
  const { ejecutar, enviando, error } = useAccion(enviarPlanillaDiaria, (r) => router.push(`/planilla-diaria/${r.datos?.id ?? id}`), {
    refrescar: false,
  })
  return (
    <>
      <Boton type="button" onClick={() => setAbierta(true)} data-enviar-planilla>
        <Send aria-hidden className="size-4" />
        Enviar a Tesorería
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Enviar la planilla a Tesorería"
        descripcion={`${resumen}. Sale con número y no se corrige: si algo está mal, se anula con su motivo mientras Tesorería no haya pagado.`}
        ancho="md"
      >
        {error && (
          <p role="alert" className="mb-3 text-sm text-peligro">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
            Cancelar
          </Boton>
          <Boton
            type="button"
            cargando={enviando}
            onClick={() => {
              const datos = new FormData()
              datos.set('id', id)
              ejecutar(datos)
            }}
          >
            Enviar
          </Boton>
        </div>
      </Ventana>
    </>
  )
}
