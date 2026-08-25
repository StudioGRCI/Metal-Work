'use client'

import Link from 'next/link'
import { useActionState, useEffect, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { PRIORIDAD, TIPO_TRABAJO, opciones } from '@/lib/dominio/estados'
import { createClient } from '@/lib/supabase/client'

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
  const [cargadas, setCargadas] = useState<{
    clienteId: string
    unidades: { id: string; placa: string; marca: string | null }[]
  } | null>(null)

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

  return (
    <form action={ejecutar} className="max-w-4xl space-y-4">
      <Tarjeta>
        <TarjetaCabecera titulo="Cliente y unidad" />
        <TarjetaCuerpo className="grid gap-4 sm:grid-cols-2">
          <Campo etiqueta="Cliente" htmlFor="cliente_id" requerido>
            <Seleccion
              id="cliente_id"
              name="cliente_id"
              required
              value={clienteId}
              onChange={(e) => setClienteId(e.target.value)}
            >
              <option value="">Selecciona un cliente</option>
              {catalogos.clientes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.razon_social} · {c.numero_documento}
                </option>
              ))}
            </Seleccion>
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
            <Seleccion id="unidad_id" name="unidad_id" disabled={!clienteId}>
              <option value="">Sin unidad asignada</option>
              {unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.placa}
                  {u.marca ? ` · ${u.marca}` : ''}
                </option>
              ))}
            </Seleccion>
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
            <Seleccion id="tipo_carroceria_id" name="tipo_carroceria_id">
              <option value="">Sin especificar</option>
              {catalogos.tiposCarroceria.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                </option>
              ))}
            </Seleccion>
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
            <Seleccion id="responsable_id" name="responsable_id">
              <option value="">Sin asignar</option>
              {catalogos.responsables.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombres} {r.apellidos}
                </option>
              ))}
            </Seleccion>
          </Campo>

          <Campo etiqueta="Monto presupuestado" htmlFor="monto_presupuestado">
            <Entrada
              id="monto_presupuestado"
              name="monto_presupuestado"
              type="number"
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
        <Link
          href="/ordenes"
          className="inline-flex h-9 items-center rounded-[var(--radius-base)] px-4 text-sm text-texto-suave hover:bg-superficie-2 hover:text-texto"
        >
          Cancelar
        </Link>
        <Boton type="submit" cargando={pendiente}>
          Registrar orden
        </Boton>
      </div>
    </form>
  )
}
