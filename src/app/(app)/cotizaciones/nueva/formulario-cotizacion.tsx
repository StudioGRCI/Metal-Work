'use client'

import { useActionState, useEffect, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { createClient } from '@/lib/supabase/client'
import { nombreDeUnidad } from '@/lib/dominio/unidades'
import { NuevaUnidad } from '@/app/(app)/clientes/nueva-unidad'
import { NuevaCarroceria } from '@/components/comercial/nueva-carroceria'
import { NuevoCliente } from '@/components/comercial/nuevo-cliente'
import { NuevoContacto, type ContactoElegible } from '@/components/comercial/nuevo-contacto'

import { crearCotizacion } from '../acciones'

type Catalogos = {
  clientes: { id: string; razon_social: string; numero_documento: string }[]
  sedes: { id: string; nombre: string }[]
  tiposCarroceria: { id: string; nombre: string }[]
  /** Quién puede figurar como vendedor: el personal que no es de taller. */
  responsables: { id: string; nombres: string; apellidos: string }[]
}

/**
 * Las tres maneras en que la casa cuenta el plazo, transcritas de sus propias
 * cotizaciones. La lista sugiere y no obliga —el campo acepta cualquier texto—
 * porque no siempre es una de las tres: hay clientes que cuentan desde la firma
 * del contrato o desde la entrega del chasis.
 *
 * La misma lista está en `editar-cotizacion.tsx`: son dos pantallas distintas y
 * todavía no hay un archivo de dominio que las dos puedan leer. Si se toca una,
 * se toca la otra.
 */
const PLAZO_DESDE_USUALES = [
  'después de emitida la orden de compra',
  'a partir del día de depósito',
  'a partir del abono en la cuenta de la empresa',
]

export function FormularioCotizacion({ catalogos }: { catalogos: Catalogos }) {
  const [resultado, ejecutar, pendiente] = useActionState(crearCotizacion, null)
  const [clienteId, setClienteId] = useState('')
  const [unidadId, setUnidadId] = useState('')
  const [carroceriaId, setCarroceriaId] = useState('')
  const [contactoId, setContactoId] = useState('')
  const [contactos, setContactos] = useState<{ clienteId: string; lista: ContactoElegible[] } | null>(
    null,
  )
  const [cargadas, setCargadas] = useState<{
    clienteId: string
    unidades: { id: string; placa: string | null }[]
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
    const supabase = createClient()

    supabase
      .from('unidades')
      .select('id, placa, codigo_interno, numero_chasis, marca, modelo')
      .eq('cliente_id', clienteId)
      .eq('activo', true)
      .order('placa')
      .then(({ data }) => {
        if (vigente) setCargadas({ clienteId, unidades: data ?? [] })
      })

    // Las personas de ese cliente, para el «Atención» del papel.
    supabase
      .from('contactos_cliente')
      .select('id, nombre, cargo')
      .eq('cliente_id', clienteId)
      .eq('activo', true)
      .order('es_principal', { ascending: false })
      .order('nombre')
      .then(({ data }) => {
        if (vigente) setContactos({ clienteId, lista: data ?? [] })
      })

    return () => {
      vigente = false
    }
  }, [clienteId])

  const unidades = cargadas?.clienteId === clienteId ? cargadas.unidades : []
  const contactosDelCliente = contactos?.clienteId === clienteId ? contactos.lista : []

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
        {/* Más aire entre columnas: el botón de «Nuevo» de la izquierda queda
            a un dedo del campo de la derecha, y con el hueco de siempre parecía
            pertenecerle a ese otro campo. */}
        <TarjetaCuerpo className="grid gap-4 sm:grid-cols-2 sm:gap-x-6">
          {/* «Señores» es la empresa y «Cliente» la persona: las dos palabras
              son las de sus cotizaciones, y así el formulario se lee igual que
              el papel que va a salir. */}
          <Campo etiqueta="Señores" htmlFor="cliente_id" requerido>
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
                  // El contacto es de un cliente: al cambiar de cliente, el que
                  // estaba elegido pertenece a otra empresa.
                  setContactoId('')
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

          <Campo etiqueta="Unidad" htmlFor="unidad_id">
            <div className="flex items-center gap-2">
              <SeleccionBuscable
                id="unidad_id"
                name="unidad_id"
                deshabilitado={!clienteId}
                className="flex-1"
                valor={unidadId}
                onChange={setUnidadId}
                marcador="Sin unidad asignada"
                marcadorBusqueda="Placa"
                opciones={unidades.map((u) => ({ valor: u.id, etiqueta: nombreDeUnidad(u) }))}
              />
              {clienteId && (
                <NuevaUnidad
                  key={clienteId}
                  clienteId={clienteId}
                  onCreada={unidadCreada}
                  compacta
                />
              )}
            </div>
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

          <Campo etiqueta="Taller" htmlFor="sede_id">
            <Seleccion id="sede_id" name="sede_id" defaultValue={catalogos.sedes[0]?.id ?? ''}>
              {catalogos.sedes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </Seleccion>
          </Campo>

          {/* Atención y vendedor salen impresos —el primero encabeza el
              «Señores» con su teléfono y su correo, el segundo firma abajo— y
              hasta ahora no tenían dónde escribirse: el papel salía con
              «Atención —», «Correo —» y «Vendedor —». */}
          <Campo
            etiqueta="Cliente"
            htmlFor="contacto_id"
            ayuda="La persona de esa empresa con la que se trata. Su nombre, teléfono y correo encabezan el papel."
          >
            <div className="flex items-center gap-2">
              <SeleccionBuscable
                id="contacto_id"
                name="contacto_id"
                deshabilitado={!clienteId}
                className="flex-1"
                valor={contactoId}
                onChange={setContactoId}
                marcador={clienteId ? 'Sin persona indicada' : 'Elige primero el cliente'}
                marcadorBusqueda="Nombre"
                opciones={contactosDelCliente.map((c) => ({
                  valor: c.id,
                  etiqueta: c.nombre,
                  detalle: c.cargo ?? undefined,
                }))}
              />
              {clienteId && (
                <NuevoContacto
                  key={clienteId}
                  clienteId={clienteId}
                  onCreado={(c) => {
                    setContactos((previos) =>
                      previos?.clienteId === clienteId
                        ? { clienteId, lista: [c, ...previos.lista.filter((x) => x.id !== c.id)] }
                        : { clienteId, lista: [c] },
                    )
                    setContactoId(c.id)
                  }}
                />
              )}
            </div>
          </Campo>

          <Campo
            etiqueta="Vendedor"
            htmlFor="vendedor_id"
            ayuda="Quien atiende esta cotización. Su nombre sale en el papel como vendedor; no es una firma."
          >
            <Seleccion id="vendedor_id" name="vendedor_id" defaultValue="">
              <option value="">Sin vendedor asignado</option>
              {catalogos.responsables.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.nombres} {r.apellidos}
                </option>
              ))}
            </Seleccion>
          </Campo>
        </TarjetaCuerpo>
      </Tarjeta>

      <Tarjeta>
        <TarjetaCabecera
          titulo="Precio y condiciones"
          descripcion="Lo que se le ofrece al cliente. El detalle de partidas lo arma Administración después."
        />
        <TarjetaCuerpo className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Campo etiqueta="Fecha de emisión" htmlFor="fecha_emision">
            <Entrada id="fecha_emision" name="fecha_emision" type="date" defaultValue={hoy} />
          </Campo>

          <Campo etiqueta="Validez" htmlFor="validez_dias" ayuda="Días">
            {/* `inputMode` saca el teclado numérico en el teléfono: aquí no se
                escribe nunca una letra. */}
            <Entrada
              id="validez_dias"
              name="validez_dias"
              type="number"
              inputMode="numeric"
              min={1}
              max={365}
              defaultValue={15}
              className="tabular text-right"
            />
          </Campo>

          {/* Dólares primero porque es lo que la casa cotiza. Estaba en soles y
              había que acordarse de cambiarlo: el que se olvidaba emitía una
              cotización de «S/ 40,000» por un trabajo de US$ 40,000, y eso no
              se ve hasta que el cliente contesta. El orden de las opciones
              también cambia, para que el ojo no elija por costumbre. */}
          <Campo etiqueta="Moneda" htmlFor="moneda">
            <Seleccion id="moneda" name="moneda" defaultValue="USD">
              <option value="USD">Dólares (US$)</option>
              <option value="PEN">Soles (S/)</option>
            </Seleccion>
          </Campo>

          {/* El precio va pegado a la moneda porque en la conversación con el
              cliente van juntos: «tanto, en soles». Es lo único que el cliente
              mira, así que no puede quedar al final del formulario. */}
          <Campo
            etiqueta="Precio ofrecido al cliente"
            htmlFor="precio_venta"
            ayuda="Es lo que se le promete al cliente y lo que imprime el papel. Se toma con IGV incluido; si el precio va sin IGV, se cambia en el detalle antes de imprimir."
          >
            {/* `inputMode="decimal"` saca el teclado con punto en el teléfono:
                acá sí se escriben céntimos. El total impreso sale de este
                número, no de la suma de las partidas —esa es el costo. */}
            <Entrada
              id="precio_venta"
              name="precio_venta"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="0.00"
              className="tabular text-right"
            />
          </Campo>

          {/* La garantía la promete Ventas, con el precio y el plazo: es parte
              de lo que se le ofrece al cliente y sale en las condiciones del
              papel. El texto con el que se redacta lo escribe Administración en
              la ficha; acá van los meses. */}
          <Campo etiqueta="Garantía" htmlFor="garantia_meses" ayuda="Meses">
            <Entrada
              id="garantia_meses"
              name="garantia_meses"
              type="number"
              inputMode="numeric"
              min={0}
              max={120}
              defaultValue={12}
              className="tabular text-right"
            />
          </Campo>

          <Campo etiqueta="Plazo de entrega" htmlFor="plazo_entrega_dias" ayuda="Días calendario">
            <Entrada
              id="plazo_entrega_dias"
              name="plazo_entrega_dias"
              type="number"
              inputMode="numeric"
              min={0}
              max={999}
              defaultValue={30}
              className="tabular text-right"
            />
          </Campo>

          {/* Va pegado al plazo y en el mismo renglón, como en el papel de la
              casa: un plazo de 30 días sin decir desde cuándo se cuentan es una
              fecha que cada uno calcula distinto. */}
          <Campo
            etiqueta="¿Desde cuándo cuenta el plazo?"
            htmlFor="plazo_desde"
            ayuda="Elige una de las que usa la casa o escribe la que se acordó."
            className="sm:col-span-2 lg:col-span-3"
          >
            {/* Sin `autoComplete` el navegador tapa la lista de la casa con lo
                que guardó de otros formularios. */}
            <Entrada
              id="plazo_desde"
              name="plazo_desde"
              autoComplete="off"
              list="plazo-desde-alta"
              placeholder="después de emitida la orden de compra"
            />
          </Campo>
          {/* Fuera del Campo a propósito: el Campo clona a sus hijos para
              atarles la ayuda, y al datalist no hay nada que atarle. */}
          <datalist id="plazo-desde-alta">
            {PLAZO_DESDE_USUALES.map((texto) => (
              <option key={texto} value={texto} />
            ))}
          </datalist>

          <Campo etiqueta="Forma de pago" htmlFor="forma_pago" className="sm:col-span-2">
            {/* Sin `autoComplete` el navegador ofrece aquí lo que guardó de
                otros formularios —el correo del jefe, su dirección— y hay que
                borrarlo antes de escribir. */}
            <Entrada
              id="forma_pago"
              name="forma_pago"
              autoComplete="off"
              placeholder="50 % adelanto y saldo contra entrega"
            />
          </Campo>

          {/* Una sola caja de texto libre. Había dos —«Condiciones» y
              «Observaciones»— que pedían lo mismo y salían las dos en el mismo
              bloque del papel, y encima la primera volvía a pedir la garantía,
              que ya tiene su campo arriba. Dos cajas para lo mismo terminan con
              la mitad del acuerdo en una y la otra mitad en la otra. */}
          <Campo
            etiqueta="Notas"
            htmlFor="condiciones"
            ayuda="Lo que no entra en los campos de arriba: características especiales, acuerdos particulares, lo que se acordó de palabra. Sale impreso al final del papel."
            className="sm:col-span-2 lg:col-span-4"
          >
            <AreaTexto
              id="condiciones"
              name="condiciones"
              rows={3}
              placeholder="Ej.: incluye tarjeta de propiedad y placas de rodaje · color a elección del cliente"
            />
          </Campo>
        </TarjetaCuerpo>
      </Tarjeta>

      {resultado && !resultado.ok && (
        <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-sm text-peligro">
          {resultado.error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <EnlaceBoton href="/cotizaciones" variante="fantasma">
          Cancelar
        </EnlaceBoton>
        {/* Ventas ya no carga partidas: abre la cotización y la manda a
            costear desde el detalle. El botón dice lo que de verdad hace. */}
        <Boton type="submit" cargando={pendiente}>
          Crear cotización
        </Boton>
      </div>
    </form>
  )
}
