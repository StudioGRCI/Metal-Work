'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo, revisarArchivo } from '@/components/ui/elegir-archivo'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { motivoDeSubida } from '@/lib/acciones'
import { PRIORIDAD, TIPO_TRABAJO, opciones } from '@/lib/dominio/estados'
import { MAXIMO_ADJUNTO_MB } from '@/lib/adjuntos'
import { anotarSinDejarloSuelto } from '@/lib/subida-privada'
import { createClient } from '@/lib/supabase/client'
import { nombreDeUnidad } from '@/lib/dominio/unidades'
import { etiquetasDePuesto } from '@/lib/format'
import { NuevaUnidad } from '@/app/(app)/clientes/nueva-unidad'
import { NuevaCarroceria } from '@/components/comercial/nueva-carroceria'
import { NuevoCliente } from '@/components/comercial/nuevo-cliente'

import { crearOrden } from '../acciones'

const ACEPTA_PDF = 'application/pdf,.pdf'

type Catalogos = {
  clientes: { id: string; razon_social: string; tipo_documento?: string; numero_documento: string }[]
  sedes: { id: string; nombre: string }[]
  tiposCarroceria: { id: string; nombre: string }[]
  responsables: { id: string; puesto: string | null; correo: string | null }[]
}

const TIPOS_TRABAJO = opciones(TIPO_TRABAJO)
const PRIORIDADES = opciones(PRIORIDAD)

export function FormularioOrden({ catalogos }: { catalogos: Catalogos }) {
  // Un envío por toque, como `useEnvio`; aquí a mano porque el PDF viaja antes
  // que la orden. El id se decide al abrir: un reintento tras perder la señal
  // encuentra la orden ya registrada en vez de crear otra.
  const [ordenId] = useState(() => crypto.randomUUID())
  const [archivo, setArchivo] = useState<File | null>(null)
  // Por qué el PDF elegido no sirve, o que falta: va en su campo, como el número.
  const [avisoPdf, setAvisoPdf] = useState<string | null>(null)
  const campoPdf = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  // El rechazo del número va junto a su campo, no en el aviso de abajo: en la
  // misma tarjeta también puede fallar el PDF.
  const [errorNumero, setErrorNumero] = useState<string | null>(null)
  const campoNumero = useRef<HTMLInputElement>(null)
  // El número no se corrige después (un documento numerado no se toca): antes
  // de registrar se ve cómo va a quedar.
  const [numeroEscrito, setNumeroEscrito] = useState('')
  const numeroFinal = comoQuedaElNumero(numeroEscrito)
  const [pendiente, iniciar] = useTransition()
  // Mientras se envía, los campos están trabados y no reciben el cursor: el que
  // rechazó la base se enfoca cuando vuelven a estar libres.
  const enfocarAlVolver = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (pendiente) return
    enfocarAlVolver.current?.focus()
    enfocarAlVolver.current = null
  }, [pendiente])
  const router = useRouter()
  const enCurso = useRef(false)
  const [clienteId, setClienteId] = useState('')
  const [unidadId, setUnidadId] = useState('')
  // La garantía es de un vehículo que vuelve: va con su unidad (migración 20261021120000).
  const [tipoTrabajo, setTipoTrabajo] = useState('FABRICACION')
  const esGarantia = tipoTrabajo === 'GARANTIA'
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
  const clienteElegido = clientes.find((c) => c.id === clienteId)
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
      .select('id, placa, marca, codigo_interno, numero_chasis, modelo')
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

  async function elegirArchivo(elegido: File | undefined) {
    setError(null)
    if (!elegido) return
    // El que no sirve se queda a la vista, en rojo y con el motivo: así se sabe
    // cuál se eligió y por qué hay que cambiarlo.
    const aviso = await revisarArchivo(elegido, ACEPTA_PDF, MAXIMO_ADJUNTO_MB)
    setArchivo(elegido)
    setAvisoPdf(aviso)
  }

  function enviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault()
    if (enCurso.current) return
    const datos = new FormData(evento.currentTarget)
    if (!archivo || avisoPdf) {
      if (!archivo) setAvisoPdf('Falta el PDF de la orden: sin él la orden no se registra')
      campoPdf.current?.focus()
      return
    }

    enCurso.current = true
    setError(null)
    setErrorNumero(null)
    iniciar(async () => {
      const supabase = createClient()
      // El PDF viaja a la carpeta de la orden antes de que exista; la base
      // registra la orden y su PDF juntos, o ninguno.
      const ruta = `ot/${ordenId}/${crypto.randomUUID()}.pdf`
      let listo = false
      try {
        const { error: falla } = await supabase.storage
          .from('adjuntos-ot')
          .upload(ruta, archivo, { contentType: 'application/pdf', upsert: false })
        if (falla) {
          setError(`No se pudo subir el PDF de la orden. ${motivoDeSubida(falla)}`)
          return
        }

        datos.set('orden_id', ordenId)
        datos.set('ruta_pdf', ruta)
        datos.set('nombre_pdf', archivo.name.slice(0, 200))
        datos.set('tamano_pdf', String(archivo.size))
        // Si la base dice que no, la orden no existe y el PDF que ya viajó se
        // quita, para que no quede un archivo que ninguna orden nombra. Quien
        // lo subió lo borra mientras ninguna fila lo nombre (migración
        // 20261017402000). Sin respuesta se pregunta otra vez: si quedó, la
        // base reconoce la misma orden y no la duplica.
        const r = await anotarSinDejarloSuelto({
          bucket: 'adjuntos-ot',
          ruta,
          anotar: () => crearOrden(null, datos),
          sinRespuesta: 'No llegó la respuesta. Revisa en Órdenes de trabajo si la orden quedó registrada antes de volver a intentar.',
        })
        if (!r.ok) {
          if (/número de la (OT|orden)|^Ya hay una orden de trabajo/.test(r.error)) {
            setErrorNumero(r.error)
            enfocarAlVolver.current = campoNumero.current
          } else {
            setError(r.error)
          }
          return
        }
        // Registrada: el formulario queda trabado hasta que se abre la orden.
        listo = true
        router.push(`/ordenes/${r.datos?.id ?? ordenId}?creada=1`)
      } catch {
        // Lo que se cae acá es la subida: la orden todavía no se registró.
        setError('No se pudo subir el PDF de la orden. Revisa la señal y vuelve a intentar.')
      } finally {
        if (!listo) enCurso.current = false
      }
    })
  }

  return (
    <form onSubmit={enviar} className="max-w-4xl space-y-4">
      {/* Mientras se registra, nada se cambia: la orden sale con lo que se envió. */}
      <fieldset disabled={pendiente} className="min-w-0 space-y-4">
        <Tarjeta>
          <TarjetaCabecera titulo="Cliente y unidad" />
          <TarjetaCuerpo className="grid gap-4 sm:grid-cols-2">
            <Campo
              etiqueta="Cliente"
              htmlFor="cliente_id"
              requerido
              // El desplegable corta un nombre largo en el monitor y lo que
              // distingue a dos clientes —el número, la sigla— queda al final.
              ayudaEnIcono={false}
              ayuda={clienteElegido ? `${clienteElegido.razon_social} · ${clienteElegido.tipo_documento ?? 'N.º'} ${clienteElegido.numero_documento}` : undefined}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
                  marcador="Elige el cliente"
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
              requerido={esGarantia}
              ayuda={
                clienteId && unidades.length === 0
                  ? 'Este cliente no tiene unidades registradas'
                  : esGarantia
                    ? 'La garantía va con la unidad que vuelve, y la unidad con su código interno.'
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
              <Seleccion id="tipo_trabajo" name="tipo_trabajo" value={tipoTrabajo} onChange={(e) => setTipoTrabajo(e.target.value)}>
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
                marcadorBusqueda="Puesto"
                opciones={[...etiquetasDePuesto(catalogos.responsables)].map(([valor, etiqueta]) => ({
                  valor,
                  etiqueta,
                }))}
              />
            </Campo>

            <Campo etiqueta="Observaciones" htmlFor="observaciones" className="sm:col-span-2 lg:col-span-3">
              <AreaTexto id="observaciones" name="observaciones" rows={2} />
            </Campo>
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta>
          <TarjetaCabecera
            titulo="La orden en papel"
            ayuda="Su número y su PDF: la orden de trabajo firmada, la misma que se imprime. Sin los dos la orden no se registra."
          />
          <TarjetaCuerpo className="space-y-4">
            {/* El número lo trae el papel, como en la OT de una cotización
                (migración 20261021110000): la orden en la mano y la de la
                pantalla son la misma. */}
            <Campo
              etiqueta="N.º de la OT"
              htmlFor="numero"
              ayuda={
                numeroFinal
                  ? `Se registrará como la OT ${numeroFinal}: revisa que sea la de su PDF`
                  : 'El que trae su PDF: 2922, o 2922-2026 si quieres escribir el año'
              }
              error={errorNumero ?? undefined}
              requerido
            >
              <Entrada
                ref={campoNumero}
                id="numero"
                name="numero"
                autoComplete="off"
                // Texto y no `numeric`: el teclado de cifras del iPhone no trae el guion del año.
                inputMode="text"
                required
                maxLength={11}
                pattern={'\\d{1,6}(-\\d{4})?'}
                title="El número de la OT, como 2922 o 2922-2026"
                placeholder="2922"
                className="sm:max-w-48"
                onChange={(e) => {
                  setErrorNumero(null)
                  setNumeroEscrito(e.target.value)
                }}
              />
            </Campo>
            <Campo etiqueta="PDF de la orden" htmlFor="pdf_orden" requerido>
              {/* Sin `name`: el archivo va a Storage, no dentro del formulario a la acción. */}
              <ElegirArchivo
                ref={campoPdf}
                id="pdf_orden"
                required
                accept={ACEPTA_PDF}
                texto="Elegir el PDF de la orden"
                hastaMb={MAXIMO_ADJUNTO_MB}
                archivo={archivo}
                aviso={avisoPdf}
                onChange={(e) => void elegirArchivo(e.target.files?.[0])}
              />
            </Campo>
          </TarjetaCuerpo>
        </Tarjeta>
      </fieldset>

      {error && (
        <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-sm text-peligro">
          {error}
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

/** Cómo guarda la base el número del papel (migración 20261021110000); `null` si todavía no es un número. */
function comoQuedaElNumero(escrito: string): string | null {
  const m = /^(\d{1,6})(?:-(\d{4}))?$/.exec(escrito.trim())
  if (!m) return null
  const cifras = m[1].replace(/^0+/, '')
  if (!cifras) return null
  const anio = m[2] ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric' }).format(new Date())
  return `${cifras.padStart(4, '0')}-${anio}`
}
