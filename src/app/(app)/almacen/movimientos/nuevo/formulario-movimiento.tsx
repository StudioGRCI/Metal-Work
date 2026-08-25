'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { TIPO_MOVIMIENTO } from '@/lib/dominio/almacen'

import { crearMovimiento } from '../../acciones'

type Catalogos = {
  almacenes: { id: string; nombre: string }[]
  ordenes: { id: string; numero: string; cliente: string | null; placa: string | null }[]
  proveedores: { id: string; razon_social: string }[]
}

export function FormularioMovimiento({
  catalogos,
  tipoInicial,
  ordenInicial,
}: {
  catalogos: Catalogos
  tipoInicial?: string
  ordenInicial?: string
}) {
  const [resultado, ejecutar, pendiente] = useActionState(crearMovimiento, null)
  const [tipo, setTipo] = useState(tipoInicial ?? 'INGRESO')
  const hoy = new Date().toISOString().slice(0, 10)

  const necesitaOrden = tipo === 'SALIDA_OT' || tipo === 'DEVOLUCION_OT'
  const necesitaDestino = tipo === 'TRANSFERENCIA'
  const necesitaMotivo = tipo === 'AJUSTE' || tipo === 'SALIDA_MERMA'
  const esIngreso = tipo === 'INGRESO'

  return (
    <form action={ejecutar} className="max-w-3xl space-y-4">
      <Tarjeta>
        <TarjetaCuerpo className="grid gap-4 sm:grid-cols-2">
          <Campo
            etiqueta="Tipo de movimiento"
            htmlFor="tipo"
            requerido
            ayuda={TIPO_MOVIMIENTO[tipo]?.descripcion}
          >
            <Seleccion id="tipo" name="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {Object.entries(TIPO_MOVIMIENTO).map(([valor, def]) => (
                <option key={valor} value={valor}>
                  {def.etiqueta}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Campo etiqueta="Fecha" htmlFor="fecha" requerido>
            <Entrada id="fecha" name="fecha" type="date" defaultValue={hoy} required />
          </Campo>

          <Campo
            etiqueta={necesitaDestino ? 'Almacén de origen' : 'Almacén'}
            htmlFor="almacen_id"
            requerido
          >
            <Seleccion
              id="almacen_id"
              name="almacen_id"
              required
              defaultValue={catalogos.almacenes[0]?.id ?? ''}
            >
              {catalogos.almacenes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>

          {necesitaDestino && (
            <Campo etiqueta="Almacén de destino" htmlFor="almacen_destino_id" requerido>
              <Seleccion id="almacen_destino_id" name="almacen_destino_id" required>
                <option value="">Selecciona</option>
                {catalogos.almacenes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </Seleccion>
            </Campo>
          )}

          {necesitaOrden && (
            <Campo
              etiqueta="Orden de trabajo"
              htmlFor="orden_id"
              requerido
              ayuda="El costo del material se carga a esta orden"
            >
              <Seleccion id="orden_id" name="orden_id" required defaultValue={ordenInicial ?? ''}>
                <option value="">Selecciona</option>
                {catalogos.ordenes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.numero} · {o.cliente ?? ''} {o.placa ? `(${o.placa})` : ''}
                  </option>
                ))}
              </Seleccion>
            </Campo>
          )}

          {esIngreso && (
            <>
              <Campo etiqueta="Proveedor" htmlFor="proveedor_id">
                <Seleccion id="proveedor_id" name="proveedor_id">
                  <option value="">Sin proveedor</option>
                  {catalogos.proveedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.razon_social}
                    </option>
                  ))}
                </Seleccion>
              </Campo>

              <Campo
                etiqueta="Documento de referencia"
                htmlFor="documento_referencia"
                ayuda="Guía de remisión o factura del proveedor"
              >
                <Entrada
                  id="documento_referencia"
                  name="documento_referencia"
                  placeholder="Guía 001-1234"
                />
              </Campo>
            </>
          )}

          <Campo
            etiqueta="Motivo"
            htmlFor="motivo"
            requerido={necesitaMotivo}
            className="sm:col-span-2"
            ayuda={
              necesitaMotivo
                ? 'Un ajuste sin explicación es un descuadre encubierto'
                : 'Opcional'
            }
          >
            <Entrada
              id="motivo"
              name="motivo"
              required={necesitaMotivo}
              placeholder={
                tipo === 'AJUSTE'
                  ? 'Inventario físico del 25/08: faltante de plancha'
                  : tipo === 'SALIDA_MERMA'
                    ? 'Recortes inservibles del habilitado'
                    : ''
              }
            />
          </Campo>

          <Campo etiqueta="Observaciones" htmlFor="observaciones" className="sm:col-span-2">
            <AreaTexto id="observaciones" name="observaciones" rows={2} />
          </Campo>
        </TarjetaCuerpo>
      </Tarjeta>

      {resultado && !resultado.ok && (
        <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-sm text-peligro">
          {resultado.error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Link
          href="/almacen/movimientos"
          className="inline-flex h-9 items-center rounded-[var(--radius-base)] px-4 text-sm text-texto-suave hover:bg-superficie-2 hover:text-texto"
        >
          Cancelar
        </Link>
        <Boton type="submit" cargando={pendiente}>
          Crear y agregar materiales
        </Boton>
      </div>
    </form>
  )
}
