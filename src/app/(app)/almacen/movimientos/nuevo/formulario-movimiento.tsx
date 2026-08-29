'use client'

import { useActionState, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { TIPO_MOVIMIENTO } from '@/lib/dominio/almacen'
import { nombreDeUnidad, type UnidadNombrable } from '@/lib/dominio/unidades'
import { hoyLima } from '@/lib/format'

import { crearMovimiento } from '../../acciones'

type Catalogos = {
  almacenes: { id: string; nombre: string }[]
  ordenes: { id: string; numero: string; cliente: string | null; unidad: UnidadNombrable | null }[]
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
  const [ordenId, setOrdenId] = useState(ordenInicial ?? '')
  const [proveedorId, setProveedorId] = useState('')
  // La fecha del taller, no la de UTC: pasadas las 7 de la noche en Lima el
  // reloj universal ya está en mañana y el servidor y el navegador se
  // contradecían en el mismo campo.
  const hoy = hoyLima()

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
              <SeleccionBuscable
                id="orden_id"
                name="orden_id"
                requerido
                permiteVaciar={false}
                valor={ordenId}
                onChange={setOrdenId}
                marcador="Selecciona la orden"
                marcadorBusqueda="Número, cliente o unidad"
                opciones={catalogos.ordenes.map((o) => ({
                  valor: o.id,
                  etiqueta: o.numero,
                  // La unidad se nombra en un solo sitio: la carrocería que aún
                  // no tiene placa se llama por su código de fabricación o por
                  // su chasis, y el renglón no queda a medias.
                  detalle: [o.cliente, nombreDeUnidad(o.unidad)].filter(Boolean).join(' · '),
                }))}
              />
            </Campo>
          )}

          {esIngreso && (
            <>
              <Campo etiqueta="Proveedor" htmlFor="proveedor_id">
                <SeleccionBuscable
                  id="proveedor_id"
                  name="proveedor_id"
                  valor={proveedorId}
                  onChange={setProveedorId}
                  marcador="Sin proveedor"
                  marcadorBusqueda="Razón social"
                  opciones={catalogos.proveedores.map((p) => ({
                    valor: p.id,
                    etiqueta: p.razon_social,
                  }))}
                />
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
                  // Es el número de una guía, no un dato del que rellena: sin
                  // esto el navegador ofrece direcciones y nombres guardados.
                  autoComplete="off"
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
              autoComplete="off"
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

      {/* En el teléfono los dos botones ocupan el ancho y el que sigue el
          camino queda arriba, bajo el pulgar; `sm:` devuelve la fila de
          siempre, con Cancelar a la izquierda. */}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <EnlaceBoton href="/almacen/movimientos" variante="fantasma" className="justify-center">
          Cancelar
        </EnlaceBoton>
        <Boton type="submit" cargando={pendiente} className="justify-center">
          Crear y agregar materiales
        </Boton>
      </div>
    </form>
  )
}
