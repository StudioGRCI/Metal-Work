'use client'

import { useActionState, useEffect, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { PRIORIDAD, TIPO_TRABAJO, opciones } from '@/lib/dominio/estados'
import { createClient } from '@/lib/supabase/client'
import { nombreDeUnidad } from '@/lib/dominio/unidades'
import { NuevaUnidad } from '@/app/(app)/clientes/nueva-unidad'
import { NuevaCarroceria } from '@/components/comercial/nueva-carroceria'
import { NuevoCliente } from '@/components/comercial/nuevo-cliente'

import { crearOrden } from '../acciones'

type Catalogos = {
  clientes: { id: string; razon_social: string; numero_documento: string }[]
  sedes: { id: string; nombre: string }[]
  tiposCarroceria: { id: string; nombre: string }[]
  responsables: { id: string; nombres: string; apellidos: string }[]
}

const TIPOS_TRABAJO = opciones(TIPO_TRABAJO)
const PRIORIDADES = opciones(PRIORIDAD)

export function FormularioOrden({ catalogos }: { catalogos: Catalogos }) {
  const [resultado, ejecutar, pendiente] = useActionState(crearOrden, null)
  const [clienteId, setClienteId] = useState('')
  const [unidadId, setUnidadId] = useState('')
  const [carroceriaId, setCarroceriaId] = useState('')
  const [responsableId, setResponsableId] = useState('')
  const [cargadas, setCargadas] = useState<{
    clienteId: string
    unidades: { id: string; placa: string | null; marca: string | null }[]
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

  // Las unidades dependen del cliente: se cargan al vuelo para no traer al
  // navegador toda la flota de todos los clientes.
  useEffect(() => {
    if (!clienteId) return

    let vigente = true
    createClient()
      .from('unidades')
      .select('id, placa, marca')
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

  // Se derivan del estado en lugar de limpiarse a mano: mientras la carga del
  // nuevo cliente está en vuelo no se muestran las unidades del anterior.
  const unidades = cargadas?.clienteId === clienteId ? cargadas.unidades : []

  function clienteCreado(c: Catalogos['clientes'][number]) {
    setClientesNuevos((lista) => (lista.some((x) => x.id === c.id) ? lista : [c, ...lista]))
    setClienteId(c.id)
    setUnidadId('')
  }

  function unidadCreada(u: {
    id: string
    placa: string | null
    codigo_interno?: string | null
    numero_chasis?: string | null
    marca?: string | null
    modelo?: string | null
  }) {
    const fila = { ...u, marca: null }
    setCargadas((previas) =>
      previas?.clienteId === clienteId
        ? { clienteId, unidades: [fila, ...previas.unidades.filter((x) => x.id !== u.id)] }
        : { clienteId, unidades: [fila] },
    )
    setUnidadId(u.id)
  }

  function carroceriaCreada(t: { id: string; nombre: string }) {
    setCarroceriasNuevas((lista) => (lista.some((x) => x.id === t.id) ? lista : [t, ...lista]))
    setCarroceriaId(t.id)
  }

  return (
    <form action={ejecutar} className="max-w-4xl space-y-4">
      <Tarjeta>
        <TarjetaCabecera titulo="Cliente y unidad" />
        <TarjetaCuerpo className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Cliente" htmlFor="cliente_id" requerido>
            <div className="flex items-center gap-2">
              <SeleccionBuscable
                id="cliente_id"
                name="cliente_id"
                requerido
                permiteVaciar={false}
                className="flex-1"
                valor={clienteId}
                onChange={(v) => {
                  setClienteId(v)
                  setUnidadId('')
                }}
                marcador="Selecciona un cliente"
                marcadorBusqueda="Razón social o RUC"
                opciones={clientes.map((c) => ({
                  valor: c.id,
                  etiqueta: c.razon_social,
                  detalle: c.numero_documento,
                }))}
              />
              <NuevoCliente onCreado={clienteCreado} />
            </div>
          </Campo>

          <Campo
            etiqueta="Unidad"
            htmlFor="unidad_id"
            ayuda={
              clienteId && unidades.length === 0
                ? 'Este cliente no tiene unidades registradas'
                : 'Vehículo sobre el que se ejecuta el trabajo'
            }
          >
            <div className="flex items-center gap-2">
              <SeleccionBuscable
                id="unidad_id"
                name="unidad_id"
                deshabilitado={!clienteId}
                className="flex-1"
                valor={unidadId}
                onChange={setUnidadId}
                marcador="Sin unidad asignada"
                marcadorBusqueda="Placa o marca"
                opciones={unidades.map((u) => ({
                  valor: u.id,
                  etiqueta: nombreDeUnidad(u),
                  detalle: u.marca,
                }))}
              />
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
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera titulo="Trabajo a realizar" />
        <TarjetaCuerpo className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Taller" htmlFor="sede_id" requerido>
            <Seleccion id="sede_id" name="sede_id" required defaultValue={catalogos.sedes[0]?.id ?? ''}>
              {catalogos.sedes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Campo etiqueta="Tipo de carrocería" htmlFor="tipo_carroceria_id">
            <div className="flex items-center gap-2">
              <SeleccionBuscable
                id="tipo_carroceria_id"
                name="tipo_carroceria_id"
                className="flex-1"
                valor={carroceriaId}
                onChange={setCarroceriaId}
                marcador="Sin especificar"
                marcadorBusqueda="Tolva, cisterna, furgón…"
                opciones={carrocerias.map((t) => ({ valor: t.id, etiqueta: t.nombre }))}
              />
              <NuevaCarroceria onCreada={carroceriaCreada} />
            </div>
          </Campo>

          <Campo etiqueta="Tipo de trabajo" htmlFor="tipo_trabajo" requerido>
            <Seleccion id="tipo_trabajo" name="tipo_trabajo" defaultValue="FABRICACION">
              {TIPOS_TRABAJO.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Campo etiqueta="Prioridad" htmlFor="prioridad" requerido>
            <Seleccion id="prioridad" name="prioridad" defaultValue="NORMAL">
              {PRIORIDADES.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.etiqueta}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Campo
            etiqueta="Descripción del trabajo"
            htmlFor="descripcion"
            requerido
            className="sm:col-span-2"
          >
            <AreaTexto
              id="descripcion"
              name="descripcion"
              required
              minLength={5}
              rows={2}
              placeholder="Ej.: Fabricación de tolva de volquete de 18 m3 en acero A36 con compuerta trasera"
            />
          </Campo>

          <Campo
            etiqueta="Especificaciones técnicas"
            htmlFor="especificaciones_tecnicas"
            className="sm:col-span-2"
            ayuda="Medidas, espesores, calidad del acero, accesorios y todo lo acordado con el cliente"
          >
            <AreaTexto id="especificaciones_tecnicas" name="especificaciones_tecnicas" rows={4} />
          </Campo>
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera titulo="Programación y responsables" />
        <TarjetaCuerpo className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Campo etiqueta="Inicio programado" htmlFor="fecha_inicio_programada">
            <Entrada id="fecha_inicio_programada" name="fecha_inicio_programada" type="date" />
          </Campo>

          <Campo etiqueta="Fin programado" htmlFor="fecha_fin_programada">
            <Entrada id="fecha_fin_programada" name="fecha_fin_programada" type="date" />
          </Campo>

          <Campo
            etiqueta="Entrega comprometida"
            htmlFor="fecha_entrega_comprometida"
            ayuda="Fecha prometida al cliente; es la que mide el atraso"
          >
            <Entrada
              id="fecha_entrega_comprometida"
              name="fecha_entrega_comprometida"
              type="date"
            />
          </Campo>

          <Campo etiqueta="Responsable" htmlFor="responsable_id">
            <SeleccionBuscable
              id="responsable_id"
              name="responsable_id"
              valor={responsableId}
              onChange={setResponsableId}
              marcador="Sin asignar"
              marcadorBusqueda="Nombre o apellido"
              opciones={catalogos.responsables.map((r) => ({
                valor: r.id,
                etiqueta: `${r.nombres} ${r.apellidos}`,
              }))}
            />
          </Campo>

          <Campo etiqueta="Monto presupuestado" htmlFor="monto_presupuestado">
            {/* `inputMode` decimal: en el teléfono abre el teclado numérico con
                punto, no el alfabético, que obliga a dos toques por cifra. */}
            <Entrada
              id="monto_presupuestado"
              name="monto_presupuestado"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              defaultValue={0}
              className="tabular text-right"
            />
          </Campo>

          <Campo etiqueta="Observaciones" htmlFor="observaciones" className="sm:col-span-2 lg:col-span-3">
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
        <EnlaceBoton href="/ordenes" variante="fantasma">
          Cancelar
        </EnlaceBoton>
        <Boton type="submit" cargando={pendiente}>
          Registrar orden
        </Boton>
      </div>
    </form>
  )
}
