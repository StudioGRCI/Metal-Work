'use client'

import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'

import { FormularioProveedor } from '@/app/(app)/proveedores/formulario'
import { Boton } from '@/components/ui/boton'
import { Campo } from '@/components/ui/campos'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Ventana } from '@/components/ui/ventana'
import type { ProveedorParaCompra } from '@/lib/datos/proveedores'
import { condicionDePago } from '@/lib/dominio/proveedores'

/**
 * El proveedor de una orden de compra o de servicio: se elige del padrón y, si
 * es nuevo, se da de alta ahí mismo y queda elegido. Al elegirlo avisa su forma
 * de pago para llenar la orden.
 */
export function SelectorProveedor({
  id,
  proveedores,
  puedeRegistrar,
  valor,
  alElegir,
}: {
  id: string
  proveedores: ProveedorParaCompra[]
  puedeRegistrar: boolean
  valor: string
  alElegir: (proveedor: ProveedorParaCompra | undefined) => void
}) {
  const [nuevos, setNuevos] = useState<ProveedorParaCompra[]>([])
  const [altaAbierta, setAltaAbierta] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const padron = useMemo(() => {
    const vistos = new Set(proveedores.map((p) => p.id))
    return [...proveedores, ...nuevos.filter((n) => !vistos.has(n.id))]
  }, [proveedores, nuevos])

  return (
    <Campo
      etiqueta="Proveedor"
      htmlFor={id}
      requerido
      ayuda={padron.length === 0 ? 'El padrón está vacío: registra el primero.' : undefined}
    >
      <div className="flex gap-2">
        <SeleccionBuscable
          id={id}
          name="proveedor_id"
          className="min-w-0 flex-1"
          requerido
          valor={valor}
          onChange={(v) => alElegir(padron.find((p) => p.id === v))}
          marcador="Elige del padrón…"
          marcadorBusqueda="Razón social o RUC…"
          opciones={padron.map((p) => ({
            valor: p.id,
            etiqueta: p.razon_social,
            detalle: `${p.numero_documento} · ${condicionDePago(p.condicion_pago, p.dias_credito)}`,
          }))}
        />
        {puedeRegistrar && (
          <Boton
            type="button"
            variante="contorno"
            onClick={() => {
              setAviso(null)
              setAltaAbierta(true)
            }}
          >
            <Plus aria-hidden className="size-4" />
            Nuevo
          </Boton>
        )}
      </div>
      {aviso && (
        <p role="status" className="text-xs text-exito">
          {aviso}
        </p>
      )}
      <Ventana
        abierta={altaAbierta}
        alCerrar={() => setAltaAbierta(false)}
        titulo="Nuevo proveedor"
        descripcion="Queda en el padrón y elegido para esta orden. Lo demás se completa en Proveedores."
        ancho="md"
      >
        {/* La ventana se pinta fuera del formulario de la orden, pero React hace
            subir el envío por el árbol de componentes: sin este corte, guardar
            el proveedor emitiría también la orden. */}
        <div onSubmit={(e) => e.stopPropagation()}>
        <FormularioProveedor
          breve
          alTerminar={(creado, mensaje) => {
            setAltaAbierta(false)
            if (!creado) return
            setNuevos((n) => [...n.filter((x) => x.id !== creado.id), creado])
            alElegir(creado)
            setAviso(mensaje ?? null)
          }}
        />
        </div>
      </Ventana>
    </Campo>
  )
}
