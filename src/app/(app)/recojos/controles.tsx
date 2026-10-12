'use client'

import { PackageCheck, Truck } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'

import { marcarDejadaEnAlmacen, marcarRecogida } from './acciones'

/** Paso 1: el conductor ya tiene la compra en la mano. */
export function MarcarRecogida({ compraId }: { compraId: string }) {
  const { alEnviar, enviando, error } = useEnvio(marcarRecogida)
  return (
    <form onSubmit={alEnviar} className="space-y-2">
      <input type="hidden" name="compra_id" value={compraId} />
      <Boton type="submit" cargando={enviando} className="w-full sm:w-auto">
        <Truck aria-hidden className="size-4" />Ya la recogí
      </Boton>
      {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
    </form>
  )
}

/** Paso 2: la dejó en almacén, con la guía o factura que le dio el proveedor. */
export function DejarEnAlmacen({ compraId }: { compraId: string }) {
  const { alEnviar, enviando, error } = useEnvio(marcarDejadaEnAlmacen)
  return (
    <form onSubmit={alEnviar} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
      <input type="hidden" name="compra_id" value={compraId} />
      <Campo etiqueta="Guía o factura del proveedor" htmlFor={`doc-${compraId}`} requerido ayuda="El número que viene en el papel con que te entregaron la compra.">
        <Entrada id={`doc-${compraId}`} name="documento" required minLength={2} maxLength={100} placeholder="GR 001-12345" autoComplete="off" />
      </Campo>
      <Boton type="submit" cargando={enviando} className="w-full sm:w-auto">
        <PackageCheck aria-hidden className="size-4" />La dejé en almacén
      </Boton>
      {error && <p role="alert" className="text-sm text-peligro sm:col-span-2">{error}</p>}
    </form>
  )
}
