'use client'

import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { createClient } from '@/lib/supabase/client'
import { NuevaUnidad } from '@/app/(app)/clientes/nueva-unidad'
import { NuevaCarroceria } from '@/components/comercial/nueva-carroceria'
import { NuevoCliente } from '@/components/comercial/nuevo-cliente'

import { crearCotizacion } from '../acciones'

type Catalogos = {
  clientes: { id: string; razon_social: string; numero_documento: string }[]
  sedes: { id: string; nombre: string }[]
  tiposCarroceria: { id: string; nombre: string }[]
}

export function FormularioCotizacion({ catalogos }: { catalogos: Catalogos }) {
  const [resultado, ejecutar, pendiente] = useActionState(crearCotizacion, null)
  const [clienteId, setClienteId] = useState('')
  const [unidadId, setUnidadId] = useState('')
  const [carroceriaId, setCarroceriaId] = useState('')
  const [cargadas, setCargadas] = useState<{
    clienteId: string
    unidades: { id: string; placa: string }[]
  } | null>(null)
  // Lo dado de alta sin salir de acá se suma a las listas y queda elegido.
  const [clientesNuevos, setClientesNuevos] = useState<Catalogos['clientes']>([])
  const [carroceriasNuevas, setCarroceriasNuevas] = useState<Catalogos['tiposCarroceria']>([])
  // Tras una acción de servidor Next refresca la página y el catálogo ya trae
  // lo recién creado: se filtra para no listarlo dos veces.
  const clientes = [
    ...clientesNuevos.filter((n) => !catalogos.clientes.some((c) => c.id === n.id)),
    ...catalogos.clientes,
  ]
  const carrocerias = [
    ...carroceriasNuevas.filter((n) => !catalogos.tiposCarroceria.some((t) => t.id === n.id)),
    ...catalogos.tiposCarroceria,
  ]

  useEffect(() => {
    if (!clienteId) return

    let vigente = true
    createClient()
      .from('unidades')
      .select('id, placa')
      .eq('cliente_id', clienteId)
      .eq('activo', true)
      .order('placa')
      .then(({ data }) => {
        if (vigente) setCargadas({ clienteId, unidades: data ?? [] })
      })

    return () => {
      vigente = false
    }
  }, [clienteId])

  const unidades = cargadas?.clienteId === clienteId ? cargadas.unidades : []

  function clienteCreado(c: Catalogos['clientes'][number]) {
    setClientesNuevos((lista) => (lista.some((x) => x.id === c.id) ? lista : [c, ...lista]))
    setClienteId(c.id)
    setUnidadId('')
  }

  function unidadCreada(u: { id: string; placa: string }) {
    setCargadas((previas) =>
      previas?.clienteId === clienteId
        ? { clienteId, unidades: [u, ...previas.unidades.filter((x) => x.id !== u.id)] }
        : { clienteId, unidades: [u] },
    )
    setUnidadId(u.id)
  }

  function carroceriaCreada(t: { id: string; nombre: string }) {
    setCarroceriasNuevas((lista) => (lista.some((x) => x.id === t.id) ? lista : [t, ...lista]))
    setCarroceriaId(t.id)
  }
  const hoy = new Date().toISOString().slice(0, 10)

  return (
    <form action={ejecutar} className="max-w-3xl space-y-4">
      <Tarjeta>
        <TarjetaCabecera titulo="Cliente y trabajo" />
        <TarjetaCuerpo className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Cliente" htmlFor="cliente_id" requerido>
            <div className="flex items-center gap-2">
              <Seleccion
                id="cliente_id"
                name="cliente_id"
                required
                value={clienteId}
                onChange={(e) => {
                  setClienteId(e.target.value)
                  setUnidadId('')
                }}
                className="flex-1"
              >
                <option value="">Selecciona un cliente</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.razon_social} · {c.numero_documento}
                  </option>
                ))}
              </Seleccion>
              <NuevoCliente onCreado={clienteCreado} />
            </div>
          </Campo>

          <Campo etiqueta="Unidad" htmlFor="unidad_id">
            <div className="flex items-center gap-2">
              <Seleccion
                id="unidad_id"
                name="unidad_id"
                disabled={!clienteId}
                value={unidadId}
                onChange={(e) => setUnidadId(e.target.value)}
                className="flex-1"
              >
                <option value="">Sin unidad asignada</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.placa}
                  </option>
                ))}
              </Seleccion>
              {clienteId && (
                <NuevaUnidad
                  key={clienteId}
                  clienteId={clienteId}
                  tiposCarroceria={carrocerias}
                  onCreada={unidadCreada}
                  compacta
                />
              )}
            </div>
          </Campo>

          <Campo etiqueta="Tipo de carrocería" htmlFor="tipo_carroceria_id">
            <div className="flex items-center gap-2">
              <Seleccion
                id="tipo_carroceria_id"
                name="tipo_carroceria_id"
                value={carroceriaId}
                onChange={(e) => setCarroceriaId(e.target.value)}
                className="flex-1"
              >
                <option value="">Sin especificar</option>
                {carrocerias.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </Seleccion>
              <NuevaCarroceria onCreada={carroceriaCreada} />
            </div>
          </Campo>

          <Campo etiqueta="Taller" htmlFor="sede_id">
            <Seleccion id="sede_id" name="sede_id" defaultValue={catalogos.sedes[0]?.id ?? ''}>
              {catalogos.sedes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera titulo="Condiciones" />
        <TarjetaCuerpo className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Campo etiqueta="Fecha de emisión" htmlFor="fecha_emision">
            <Entrada id="fecha_emision" name="fecha_emision" type="date" defaultValue={hoy} />
          </Campo>

          <Campo etiqueta="Validez" htmlFor="validez_dias" ayuda="Días">
            <Entrada
              id="validez_dias"
              name="validez_dias"
              type="number"
              min={1}
              max={365}
              defaultValue={15}
              className="tabular text-right"
            />
          </Campo>

          <Campo etiqueta="Moneda" htmlFor="moneda">
            <Seleccion id="moneda" name="moneda" defaultValue="PEN">
              <option value="PEN">Soles (S/)</option>
              <option value="USD">Dólares (US$)</option>
            </Seleccion>
          </Campo>

          <Campo etiqueta="Plazo de entrega" htmlFor="plazo_entrega_dias" ayuda="Días calendario">
            <Entrada
              id="plazo_entrega_dias"
              name="plazo_entrega_dias"
              type="number"
              min={0}
              max={999}
              defaultValue={30}
              className="tabular text-right"
            />
          </Campo>

          <Campo etiqueta="Forma de pago" htmlFor="forma_pago" className="sm:col-span-2">
            <Entrada
              id="forma_pago"
              name="forma_pago"
              placeholder="50 % adelanto y saldo contra entrega"
            />
          </Campo>

          <Campo etiqueta="Condiciones" htmlFor="condiciones" className="sm:col-span-2 lg:col-span-4">
            <AreaTexto
              id="condiciones"
              name="condiciones"
              rows={2}
              placeholder="Garantía, alcance, exclusiones y todo lo que deba quedar por escrito"
            />
          </Campo>

          <Campo etiqueta="Observaciones" htmlFor="observaciones" className="sm:col-span-2 lg:col-span-4">
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
          href="/cotizaciones"
          className="inline-flex h-9 items-center rounded-[var(--radius-base)] px-4 text-sm text-texto-suave hover:bg-superficie-2 hover:text-texto"
        >
          Cancelar
        </Link>
        <Boton type="submit" cargando={pendiente}>
          Crear y agregar partidas
        </Boton>
      </div>
    </form>
  )
}
