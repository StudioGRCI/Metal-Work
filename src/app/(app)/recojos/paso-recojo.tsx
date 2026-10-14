'use client'

import { Package, PackageCheck, Truck } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Ventana } from '@/components/ui/ventana'
import { useAccion } from '@/lib/envio'

import { marcarRecojo } from './acciones'

/**
 * El botón grande del conductor, uno por paso: «Salgo a recoger», «Ya la
 * recogí» y «La dejé en almacén». El último pide confirmar: después de eso
 * Almacén recibe el ingreso y el paso no se deshace.
 */
export function PasoRecojo({ id, numero, paso }: { id: string; numero: string; paso: 'EN_RECOJO' | 'RECOGIDO' | 'DEJADO' }) {
  const [confirmando, setConfirmando] = useState(false)
  const accion = useAccion(marcarRecojo, () => setConfirmando(false))

  function marcar() {
    const datos = new FormData()
    datos.set('id', id)
    datos.set('paso', paso)
    accion.ejecutar(datos)
  }

  return (
    <div className="space-y-2">
      {paso === 'EN_RECOJO' ? (
        <Boton type="button" tamano="lg" className="w-full sm:w-auto" cargando={accion.enviando} onClick={marcar}>
          <Truck aria-hidden className="size-4" />
          Salgo a recoger
        </Boton>
      ) : paso === 'RECOGIDO' ? (
        <Boton type="button" tamano="lg" className="w-full sm:w-auto" cargando={accion.enviando} onClick={marcar}>
          <Package aria-hidden className="size-4" />
          Ya la recogí
        </Boton>
      ) : (
        <Boton type="button" tamano="lg" className="w-full sm:w-auto" onClick={() => setConfirmando(true)}>
          <PackageCheck aria-hidden className="size-4" />
          La dejé en almacén
        </Boton>
      )}
      {accion.error && !confirmando && (
        <p role="alert" className="text-sm text-peligro">
          {accion.error}
        </p>
      )}
      <Ventana
        abierta={confirmando}
        alCerrar={() => setConfirmando(false)}
        titulo={`¿Dejaste ${numero} en almacén?`}
        descripcion="Almacén recibe el ingreso para validarlo contra lo que entregaste. Esto no se deshace."
        ancho="sm"
      >
        <div className="space-y-4">
          {accion.error && (
            <p role="alert" className="text-sm text-peligro">
              {accion.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setConfirmando(false)}>
              Todavía no
            </Boton>
            <Boton type="button" cargando={accion.enviando} onClick={marcar}>
              Sí, la dejé
            </Boton>
          </div>
        </div>
      </Ventana>
    </div>
  )
}
