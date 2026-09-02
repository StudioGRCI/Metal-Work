'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { Pencil } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'

import { Ventana } from '@/components/ui/ventana'
import { createClient } from '@/lib/supabase/client'
import { nombreDeUnidad } from '@/lib/dominio/unidades'
import { cn } from '@/lib/utils'

import { editarCotizacion } from '../acciones'

export type CatalogosCotizacion = {
  clientes: { id: string; razon_social: string; numero_documento: string }[]
  sedes: { id: string; nombre: string }[]
  tiposCarroceria: { id: string; nombre: string }[]
  responsables: { id: string; nombres: string; apellidos: string }[]
}

export type CabeceraCotizacion = {
  id: string
  cliente_id: string
  /** Lo que Ventas le ofrece al cliente. Manda sobre el papel. */
  precio_venta: number | null
  unidad_id: string | null
  tipo_carroceria_id: string | null
  tipo_unidad: string | null
  capacidad: string | null
  sede_id: string | null
  /** Quien firma el papel. Vacío = firma la empresa. */
  vendedor_id?: string | null
  fecha_emision: string
  validez_dias: number
  /** Los meses que se prometen. Los pone Ventas, con el precio y el plazo. */
  garantia_meses?: number | null
  moneda: string
  plazo_entrega_dias: number | null
  /**
   * Desde cuándo cuenta ese plazo, tal como lo escribe la casa. Opcional
   * mientras la página no lo traiga: la consulta que la alimenta pide `*`, así
   * que el dato ya viaja, pero el objeto que arma la página todavía no lo pasa
   * y los tipos generados aún no conocen la columna (migración 045).
   */
  plazo_desde?: string | null
  forma_pago: string | null
  condiciones: string | null
  observaciones: string | null
}

/**
 * Las tres maneras en que la casa cuenta el plazo, transcritas de sus propias
 * cotizaciones. Sugieren y no obligan: el campo acepta cualquier texto porque
 * no siempre es una de las tres.
 *
 * La misma lista está en el alta (`nueva/formulario-cotizacion.tsx`): son dos
 * pantallas distintas y todavía no hay un archivo de dominio que las dos
 * puedan leer. Si se toca una, se toca la otra.
 */
const PLAZO_DESDE_USUALES = [
  'después de emitida la orden de compra',
  'a partir del día de depósito',
  'a partir del abono en la cuenta de la empresa',
]

/**
 * Corregir la cabecera mientras la cotización se está armando —en ventas, en
 * costeo o devuelta—: el cliente pidió otra carrocería, el plazo se negoció, la
 * forma de pago cambió, el precio bajó. Antes había que emitir una cotización
 * nueva y quemar un número de la serie para arreglar una línea de texto.
 *
 * Quién puede abrirla lo decide la pantalla: desde que Gerencia da el visto, la
 * cabecera no se toca sin devolverla antes. Acá solo va el formulario.
 */
export function EditarCotizacion({
  cotizacion,
  catalogos,
  unidadActual,
}: {
  cotizacion: CabeceraCotizacion
  catalogos: CatalogosCotizacion
  /** La unidad que ya tiene, para poder mostrarla antes de cargar la lista. */
  unidadActual: { id: string; placa: string } | null
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [abierto, setAbierto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [clienteId, setClienteId] = useState(cotizacion.cliente_id)
  const [unidadId, setUnidadId] = useState(cotizacion.unidad_id ?? '')
  const [carroceriaId, setCarroceriaId] = useState(cotizacion.tipo_carroceria_id ?? '')
  const [tipoUnidad, setTipoUnidad] = useState(cotizacion.tipo_unidad ?? '')
  const [sedeId, setSedeId] = useState(cotizacion.sede_id ?? '')
  const [vendedorId, setVendedorId] = useState(cotizacion.vendedor_id ?? '')
  const [cargadas, setCargadas] = useState<{
    clienteId: string
    unidades: { id: string; placa: string | null }[]
  } | null>(unidadActual ? { clienteId: cotizacion.cliente_id, unidades: [unidadActual] } : null)

  // Las unidades son del cliente elegido: se piden al vuelo, como en el alta.
  useEffect(() => {
    if (!abierto || !clienteId) return

    let vigente = true
    createClient()
      .from('unidades')
      .select('id, placa, codigo_interno, numero_chasis, marca, modelo')
      .eq('cliente_id', clienteId)
      .eq('activo', true)
      .order('placa')
      .then(({ data }) => {
        if (vigente) setCargadas({ clienteId, unidades: data ?? [] })
      })

    return () => {
      vigente = false
    }
  }, [abierto, clienteId])

  const unidades = cargadas?.clienteId === clienteId ? cargadas.unidades : []

  async function enviar(datos: FormData) {
    setError(null)
    setEnviando(true)
    const salida = await editarCotizacion(null, datos)
    setEnviando(false)

    if (!salida.ok) {
      setError(salida.error)
      return
    }

    setAbierto(false)
    iniciarTransicion(() => router.refresh())
  }

  return (
    <>
      {/* «Editar» a secas se repite tres veces en esta pantalla; el rótulo
          accesible dice cuál de las tres es. */}
      <Boton
        variante="secundario"
        tamano="sm"
        onClick={() => setAbierto(true)}
        aria-label="Editar los datos de la cotización"
      >
        <Pencil aria-hidden className="size-3.5" />
        Editar
      </Boton>

      {/* El marco -fondo, caja, título, Escape, foco y el rodado de atrás- lo
          pone la ventana del sistema; acá abajo solo va el formulario. */}
      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Editar la cotización"
        descripcion="Acá va el precio que se le ofrece al cliente. El costo estimado no se escribe: lo arma Administración con las partidas."
        ancho="lg"
      >
        <form action={enviar} className="space-y-3">
          <input type="hidden" name="cotizacion_id" value={cotizacion.id} />

          <div className="grid gap-3 sm:grid-cols-2">
            {/* «Señores» para la empresa, igual que en el papel y en el
                formulario de alta. */}
            <Campo etiqueta="Señores" htmlFor="cliente_id" requerido>
              <SeleccionBuscable
                id="cliente_id"
                name="cliente_id"
                requerido
                permiteVaciar={false}
                valor={clienteId}
                onChange={(v) => {
                  setClienteId(v)
                  setUnidadId('')
                }}
                marcador="Selecciona un cliente"
                marcadorBusqueda="Razón social o RUC"
                opciones={catalogos.clientes.map((c) => ({
                  valor: c.id,
                  etiqueta: c.razon_social,
                  detalle: c.numero_documento,
                }))}
              />
            </Campo>

            <Campo
              etiqueta="Unidad"
              htmlFor="unidad_id"
              ayuda={clienteId ? undefined : 'Elige primero el cliente'}
            >
              <SeleccionBuscable
                id="unidad_id"
                name="unidad_id"
                deshabilitado={!clienteId}
                valor={unidadId}
                onChange={setUnidadId}
                marcador="Sin unidad asignada"
                marcadorBusqueda="Placa"
                opciones={unidades.map((u) => ({ valor: u.id, etiqueta: nombreDeUnidad(u) }))}
              />
            </Campo>

            {/* Delante del tipo de carrocería, como en el alta: es lo que
                decide la escala de la capacidad y el código de producto. */}
            <Campo
              etiqueta="Tipo"
              htmlFor="ed-tipo_unidad"
              ayuda="Si lleva ejes propios es semirremolque; si va montada sobre el chasis del cliente, carrocería montada."
            >
              <Seleccion
                id="ed-tipo_unidad"
                name="tipo_unidad"
                value={tipoUnidad}
                onChange={(e) => setTipoUnidad(e.target.value)}
              >
                <option value="">Sin definir</option>
                <option value="SEMIRREMOLQUE">Semirremolque</option>
                <option value="CARROCERIA_MONTADA">Carrocería montada</option>
              </Seleccion>
            </Campo>

            <Campo etiqueta="Capacidad" htmlFor="ed-capacidad" ayuda="Como la escriben ustedes: 15 m³, 45 M3, 5000 galones, 2000 GLS, 04 TN. Sale impresa en el papel del cliente.">
              <Entrada
                id="ed-capacidad"
                name="capacidad"
                autoComplete="off"
                placeholder="15 m³"
                defaultValue={cotizacion.capacidad ?? ''}
              />
            </Campo>

            <Campo etiqueta="Tipo de carrocería" htmlFor="tipo_carroceria_id">
              <SeleccionBuscable
                id="tipo_carroceria_id"
                name="tipo_carroceria_id"
                valor={carroceriaId}
                onChange={setCarroceriaId}
                marcador="Sin especificar"
                marcadorBusqueda="Tolva, cisterna, furgón…"
                opciones={catalogos.tiposCarroceria.map((t) => ({
                  valor: t.id,
                  etiqueta: t.nombre,
                }))}
              />
            </Campo>

            <Campo etiqueta="Sede" htmlFor="sede_id">
              <SeleccionBuscable
                id="sede_id"
                name="sede_id"
                valor={sedeId}
                onChange={setSedeId}
                marcador="Sin sede"
                marcadorBusqueda="Nombre de la sede"
                opciones={catalogos.sedes.map((s) => ({ valor: s.id, etiqueta: s.nombre }))}
              />
            </Campo>

            {/* Se puede corregir después de emitir: quien atiende cambia, y sin
                esto el papel salía sin decir quién vende. */}
            <Campo
              etiqueta="Vendedor"
              htmlFor="vendedor_id"
              ayuda="Quien atiende esta cotización. Su nombre sale en el papel como vendedor; no es una firma."
            >
              <SeleccionBuscable
                id="vendedor_id"
                name="vendedor_id"
                valor={vendedorId}
                onChange={setVendedorId}
                marcador="Sin vendedor asignado"
                marcadorBusqueda="Nombre"
                opciones={catalogos.responsables.map((r) => ({
                  valor: r.id,
                  etiqueta: `${r.nombres} ${r.apellidos}`,
                }))}
              />
            </Campo>
          </div>

          {/* El dinero, junto: el precio es lo que Ventas le ofrece al cliente
              y la moneda dice en qué se le ofrece. Con la moneda tres campos más
              allá, corregir un precio sin mirarla es demasiado fácil. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              etiqueta="Precio de venta"
              htmlFor="precio_venta"
              ayuda="Lo que se le ofrece al cliente: es el total que sale impreso."
            >
              <Entrada
                id="precio_venta"
                name="precio_venta"
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                defaultValue={cotizacion.precio_venta ?? ''}
                className="tabular text-right"
              />
            </Campo>

            <Campo etiqueta="Moneda" htmlFor="moneda">
              <Seleccion id="moneda" name="moneda" defaultValue={cotizacion.moneda}>
                <option value="PEN">Soles</option>
                <option value="USD">Dólares</option>
              </Seleccion>
            </Campo>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Campo etiqueta="Emisión" htmlFor="fecha_emision">
              <Entrada
                id="fecha_emision"
                name="fecha_emision"
                type="date"
                defaultValue={cotizacion.fecha_emision}
              />
            </Campo>

            <Campo etiqueta="Validez (días)" htmlFor="validez_dias">
              {/* Teclado numérico en el teléfono: aquí solo van cifras. */}
              <Entrada
                id="validez_dias"
                name="validez_dias"
                type="number"
                inputMode="numeric"
                min={1}
                max={365}
                defaultValue={cotizacion.validez_dias}
                className="tabular text-right"
              />
            </Campo>

            {/* La garantía va con la validez y la entrega: las tres son lo que
                Ventas le promete al cliente, y las tres salen en las condiciones
                del papel. */}
            <Campo etiqueta="Garantía (meses)" htmlFor="garantia_meses">
              <Entrada
                id="garantia_meses"
                name="garantia_meses"
                type="number"
                inputMode="numeric"
                min={0}
                max={120}
                defaultValue={cotizacion.garantia_meses ?? 12}
                className="tabular text-right"
              />
            </Campo>

            <Campo etiqueta="Entrega (días)" htmlFor="plazo_entrega_dias">
              <Entrada
                id="plazo_entrega_dias"
                name="plazo_entrega_dias"
                type="number"
                inputMode="numeric"
                min={0}
                max={999}
                defaultValue={cotizacion.plazo_entrega_dias ?? 0}
                className="tabular text-right"
              />
            </Campo>
          </div>

          {/* Pegado al plazo, porque en el papel de la casa van en el mismo
              renglón: «30 días hábiles después de emitida la orden de compra».
              El número solo no alcanza para saber qué día se entrega. */}
          <Campo
            etiqueta="¿Desde cuándo cuenta el plazo?"
            htmlFor="plazo_desde"
            ayuda="Elige una de las que usa la casa o escribe la que se acordó."
          >
            {/* Sin `autoComplete` el navegador tapa la lista de la casa con lo
                que guardó de otros formularios. */}
            <Entrada
              id="plazo_desde"
              name="plazo_desde"
              autoComplete="off"
              list="plazo-desde-edicion"
              defaultValue={cotizacion.plazo_desde ?? ''}
              placeholder="después de emitida la orden de compra"
            />
          </Campo>
          {/* Fuera del Campo a propósito: el Campo clona a sus hijos para
              atarles la ayuda, y al datalist no hay nada que atarle. */}
          <datalist id="plazo-desde-edicion">
            {PLAZO_DESDE_USUALES.map((texto) => (
              <option key={texto} value={texto} />
            ))}
          </datalist>

          <Campo etiqueta="Forma de pago" htmlFor="forma_pago">
            {/* Sin `autoComplete` el navegador ofrece aquí lo que guardó
                de otros formularios y hay que borrarlo para escribir. */}
            <Entrada
              id="forma_pago"
              name="forma_pago"
              autoComplete="off"
              defaultValue={cotizacion.forma_pago ?? ''}
              placeholder="50% adelanto, 50% contra entrega"
            />
          </Campo>

          {/* Una sola, como en el alta: «Condiciones» y «Observaciones» pedían
              lo mismo y salían juntas en el papel. */}
          <Campo etiqueta="Notas" htmlFor="condiciones" ayuda="Lo que no entra en los campos de arriba: características especiales, acuerdos particulares, lo que se acordó de palabra. Sale impreso al final del papel.">
            <AreaTexto
              id="condiciones"
              name="condiciones"
              rows={3}
              defaultValue={cotizacion.condiciones ?? ''}
            />
          </Campo>

          {error && (
            <p
              role="alert"
              className={cn('rounded-[var(--radius-base)] px-3 py-2 text-xs', 'bg-peligro-suave text-peligro')}
            >
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Guardar
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}
