'use client'

import { X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition, type FormEvent } from 'react'

import { YaQuedo } from '@/components/estructura/ida-que-no-salio'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo, revisarArchivo } from '@/components/ui/elegir-archivo'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { SeleccionBuscable } from '@/components/ui/seleccion-buscable'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { motivoDeSubida } from '@/lib/acciones'
import { PRIORIDAD, TIPO_TRABAJO, opciones } from '@/lib/dominio/estados'
import { MAXIMO_ADJUNTO_MB } from '@/lib/adjuntos'
import { camposDe, decirElRechazoSiSeFue, type DeFormulario, laPestanaEsDeLaVersionAnterior, laPestanaEsDeOtraCuenta, mientrasSeEnvia, navegarSiEsDeLaPestana, NO_SE_GUARDO_OTRA_CUENTA, nombreDe, OtraCuentaEnLaPestana, partida, quitarConLaCuenta, SE_ACTUALIZO_EL_SISTEMA, seguirConLaCuentaDeLaPestana, type SiSeVa, useCursorAlRechazo, useFormularioMontado } from '@/lib/envio'
import { subirARutaNueva } from '@/lib/ruta-nueva'
import { anotarSinDejarloSuelto } from '@/lib/subida-privada'
import { createClient } from '@/lib/supabase/client'
import { codigoDeCarroceria } from '@/lib/dominio/medidas-carroceria'
import { nombreDeUnidad } from '@/lib/dominio/unidades'
import { etiquetasDePuesto } from '@/lib/format'
import { NuevaUnidad } from '@/app/(app)/clientes/nueva-unidad'
import { NuevaCarroceria } from '@/components/comercial/nueva-carroceria'
import { NuevoCliente } from '@/components/comercial/nuevo-cliente'

import type { Enums } from '@/types/database'

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
  // Registrada, la orden queda dicha junto al botón y el formulario trabado,
  // salga la ida o no: con otra ventana abierta al volver no salía, y el botón
  // seguía vivo y mudo (`YaQuedo`).
  const [quedo, setQuedo] = useState<ReturnType<typeof idaALaOrden> | null>(null)
  // Al volver de un rechazo, el cursor va al número o al aviso.
  const avisoError = useRef<HTMLParagraphElement>(null)
  useCursorAlRechazo(pendiente, errorNumero ?? error, () => (errorNumero ? campoNumero.current : avisoError.current))
  const router = useRouter()
  const enCurso = useRef(false)
  const instancia = useFormularioMontado()
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
  // Lo dado de alta sin salir de acá se suma a las listas y queda elegido. Si la
  // persona cerró su ventana antes de que contestara, solo se suma, y junto a su
  // campo se dice que entró igual: la unidad cancelada en vuelo reemplazaba la
  // que la persona había elegido entretanto, y la orden —un documento numerado—
  // podía salir con ella (F3 de la crítica, quincuagésima cuarta pasada).
  const [clientesNuevos, setClientesNuevos] = useState<Catalogos['clientes']>([])
  const [aparte, setAparte] = useState<Partial<Record<'cliente' | 'unidad' | 'carroceria', string>>>({})
  const quitarAparte = (campo: keyof typeof aparte) => setAparte(({ [campo]: _, ...resto }) => resto)
  // El cliente elegido ahora. `NuevaUnidad` va con el de su ventana (`key`): la
  // que se cerró en vuelo y entra después de cambiar el cliente es del de antes.
  const clienteAhora = useRef(clienteId)
  useEffect(() => {
    clienteAhora.current = clienteId
  }, [clienteId])
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
  // navegador toda la flota de todos los clientes. `releer`: el alta de una
  // unidad volvió sin decir si entró, y se vuelven a leer (`unidadEnDuda`).
  // La lectura que falla (sin conexión, o con la sesión muerta) no toca la
  // lista: vaciaba «Unidad» y soltaba la unidad elegida (F-B de funcionalidad,
  // quincuagésima sexta pasada; N3 de su crítica). Lo dice junto al campo, por
  // qué, y vuelve a leer al volver la conexión o a esta pestaña.
  const [releer, setReleer] = useState(0)
  const [sinLeer, setSinLeer] = useState<{ clienteId: string; porSesion: boolean } | null>(null)
  // Las dadas de alta aquí: una lectura que sale antes de su alta y llega
  // después no las trae, y reemplazar la lista con ella borraba de «Unidad» la
  // recién creada y elegida; la orden salía sin unidad (H3 de funcionalidad,
  // quincuagésima quinta pasada, que la relectura de la duda volvió a abrir:
  // crítica de la quincuagésima sexta). Se suman a lo que llegue.
  const creadasAqui = useRef<{ clienteId: string; unidad: NonNullable<typeof cargadas>['unidades'][number] }[]>([])
  useEffect(() => {
    if (!clienteId) return

    let vigente = true
    const volverALeer = () => setReleer((n) => n + 1)
    createClient()
      .from('unidades')
      .select('id, placa, marca, codigo_interno, numero_chasis, modelo')
      .eq('cliente_id', clienteId)
      .eq('activo', true)
      .order('placa')
      .then(({ data, error, status }) => {
        if (!vigente) return
        if (error) {
          const porSesion = sinSesion(status)
          setSinLeer({ clienteId, porSesion })
          if (porSesion) setAparte((a) => (a.unidad === DUDA_UNIDAD ? { ...a, unidad: DUDA_UNIDAD_SIN_SESION } : a))
          window.addEventListener('online', volverALeer, { once: true })
          window.addEventListener('focus', volverALeer, { once: true })
          return
        }
        setSinLeer(null)
        const leidas = data ?? []
        const propias = creadasAqui.current.filter((c) => c.clienteId === clienteId && !leidas.some((u) => u.id === c.unidad.id)).map((c) => c.unidad)
        setCargadas({ clienteId, unidades: [...propias, ...leidas] })
      })

    return () => {
      vigente = false
      window.removeEventListener('online', volverALeer)
      window.removeEventListener('focus', volverALeer)
    }
  }, [clienteId, releer])

  // Se derivan del estado en lugar de limpiarse a mano: mientras la carga del
  // nuevo cliente está en vuelo no se muestran las unidades del anterior.
  const unidades = cargadas?.clienteId === clienteId ? cargadas.unidades : []

  function clienteCreado(c: Catalogos['clientes'][number], { elegir }: { elegir: boolean }) {
    setClientesNuevos((lista) => (lista.some((x) => x.id === c.id) ? lista : [c, ...lista]))
    if (!elegir) {
      setAparte((a) => ({ ...a, cliente: `El cliente ${c.razon_social} quedó registrado aunque cerraste su ventana antes de que contestara. Está en la lista, sin elegir.` }))
      return
    }
    setClienteId(c.id)
    setUnidadId('')
    setAparte(({ cliente: _, unidad: __, ...resto }) => resto)
  }

  function unidadCreada(
    u: {
      id: string
      placa: string | null
      codigo_interno?: string | null
      numero_chasis?: string | null
      marca?: string | null
      modelo?: string | null
    },
    { elegir }: { elegir: boolean },
  ) {
    const nombre = nombreDeUnidad(u)
    if (clienteAhora.current !== clienteId) {
      const de = clienteElegido?.razon_social ?? 'el cliente que tenías elegido'
      setAparte((a) => ({ ...a, unidad: `La unidad ${nombre} quedó registrada en ${de} aunque cerraste su ventana antes de que contestara.` }))
      return
    }
    const fila = { ...u, marca: null }
    creadasAqui.current = [...creadasAqui.current.filter((c) => c.unidad.id !== u.id), { clienteId, unidad: fila }]
    setCargadas((previas) =>
      previas?.clienteId === clienteId
        ? { clienteId, unidades: [fila, ...previas.unidades.filter((x) => x.id !== u.id)] }
        : { clienteId, unidades: [fila] },
    )
    if (!elegir) {
      setAparte((a) => ({ ...a, unidad: `La unidad ${nombre} quedó registrada aunque cerraste su ventana antes de que contestara. Está en la lista, sin elegir.` }))
      return
    }
    setUnidadId(u.id)
    quitarAparte('unidad')
  }

  // El alta que volvió sin decir si entró (sin respuesta, el servidor caído a
  // medio envío): se vuelve a leer su lista y junto al campo se dice que puede
  // haber quedado. La unidad entraba y no estaba en «Unidad», donde la ventana
  // mandaba a buscarla, y sin placa se registraba dos veces (G2 de la crítica,
  // quincuagésima quinta pasada). Corre desde el envío aunque la ventana se
  // haya cancelado (`alQuedarEnDuda` de `useEnvio`): si entretanto se eligió
  // otro cliente, la unidad sería del de antes, y se dice de cuál.
  function unidadEnDuda() {
    if (clienteAhora.current !== clienteId) {
      const de = clienteElegido?.razon_social ?? 'el cliente que tenías elegido'
      setAparte((a) => ({ ...a, unidad: `No llegó la respuesta de la unidad que registrabas en ${de}: puede haber quedado en ese cliente. Míralo antes de registrarla otra vez.` }))
      return
    }
    setReleer((n) => n + 1)
    setAparte((a) => ({ ...a, unidad: DUDA_UNIDAD }))
  }

  // El cliente y la carrocería no se repiten (el alta que encuentra el suyo
  // devuelve el que estaba): se buscan desde el navegador por su documento o
  // su código y, si están, se suman a la lista. Con `router.refresh()` se
  // pedía la página entera, y sin conexión, o con el 502 que dejó la duda,
  // Next recargaba el documento y se llevaba la orden escrita sin decir nada
  // (F-A de funcionalidad, quincuagésima sexta pasada). Si no se encuentra,
  // registrarlo otra vez no lo duplica. Con la sesión muerta la acción tampoco
  // llega (vuelve como «El servidor no pudo…») y la búsqueda no lee: se dice
  // que es la sesión, no la conexión (N2 de la crítica, quincuagésima sexta).
  async function clienteEnDuda({ tipo_documento, numero_documento, razon_social }: { tipo_documento: Enums<'tipo_documento_cliente'>; numero_documento: string; razon_social: string }) {
    const duda = `No llegó la respuesta del cliente ${razon_social}: puede haber quedado. Regístralo otra vez con el mismo documento: si ya estaba, no se repite y queda elegido.`
    setAparte((a) => ({ ...a, cliente: duda }))
    if (!numero_documento) return
    const { data, status } = await createClient()
      .from('clientes')
      .select('id, razon_social, tipo_documento, numero_documento')
      .eq('tipo_documento', tipo_documento)
      .eq('numero_documento', numero_documento)
      .eq('activo', true)
      .maybeSingle()
    if (sinSesion(status)) {
      setAparte((a) => (a.cliente === duda ? { ...a, cliente: `No se sabe si quedó el cliente ${razon_social}: la sesión terminó. ${VOLVER_A_ENTRAR}, y regístralo otra vez aquí con el mismo documento: si ya estaba, no se repite y queda elegido.` } : a))
      return
    }
    if (!data) return
    setClientesNuevos((lista) => (lista.some((x) => x.id === data.id) ? lista : [data, ...lista]))
    setAparte((a) => (a.cliente === duda ? { ...a, cliente: `El cliente ${data.razon_social} quedó registrado aunque no llegó la respuesta. Está en la lista, sin elegir.` } : a))
  }

  async function carroceriaEnDuda({ nombre }: { nombre: string }) {
    const duda = `No llegó la respuesta de la carrocería ${nombre}: puede haber quedado. Regístrala otra vez con el mismo nombre: si ya estaba, no se repite y queda elegida.`
    setAparte((a) => ({ ...a, carroceria: duda }))
    const codigo = codigoDeCarroceria(nombre)
    if (!codigo) return
    const { data, status } = await createClient().from('tipos_carroceria').select('id, nombre').eq('codigo', codigo).eq('activo', true).maybeSingle()
    if (sinSesion(status)) {
      setAparte((a) => (a.carroceria === duda ? { ...a, carroceria: `No se sabe si quedó la carrocería ${nombre}: la sesión terminó. ${VOLVER_A_ENTRAR}, y regístrala otra vez aquí con el mismo nombre: si ya estaba, no se repite y queda elegida.` } : a))
      return
    }
    if (!data) return
    setCarroceriasNuevas((lista) => (lista.some((x) => x.id === data.id) ? lista : [data, ...lista]))
    setAparte((a) => (a.carroceria === duda ? { ...a, carroceria: `La carrocería ${data.nombre} quedó registrada aunque no llegó la respuesta. Está en la lista, sin elegir.` } : a))
  }

  function carroceriaCreada(t: { id: string; nombre: string }, { elegir }: { elegir: boolean }) {
    setCarroceriasNuevas((lista) => (lista.some((x) => x.id === t.id) ? lista : [t, ...lista]))
    if (!elegir) {
      setAparte((a) => ({ ...a, carroceria: `La carrocería ${t.nombre} quedó registrada aunque cerraste su ventana antes de que contestara. Está en la lista, sin elegir.` }))
      return
    }
    setCarroceriaId(t.id)
    quitarAparte('carroceria')
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

    // La sesión pudo cambiar en otra pestaña sin que la traba llegara: se mira en el acto.
    if (laPestanaEsDeOtraCuenta()) return
    enCurso.current = true
    setError(null)
    setErrorNumero(null)
    const de: DeFormulario = { instancia, campos: camposDe(evento.currentTarget), nombre: nombreDe(SI_SE_VA) }
    // Cómo estaba la pestaña: si al entrar la persona ya está en otra cosa, la
    // orden no se la lleva. Con su formulario, como en `useAccion`: si al
    // entrar el que ve es otro, vuelto a montar vacío (Atrás y Adelante), la
    // línea de arriba lo dice. Callada, nada decía que entró, y escrita otra vez
    // volvía con «Ya hay una orden de trabajo…: revisa el número del papel»,
    // que culpa al papel (T1 de la crítica, quincuagésima pasada).
    const desde = { ...partida(), de }
    // Como en `useAccion`: «Volver a cargar», el del aviso de arriba tras un
    // despliegue, espera a que la orden vuelva, y si no entró no recarga.
    iniciar(() => mientrasSeEnvia(async (entro) => {
      const supabase = createClient()
      // El PDF viaja a la carpeta de la orden antes de que exista; la base
      // registra la orden y su PDF juntos, o ninguno.
      const ruta = `ot/${ordenId}/${crypto.randomUUID()}.pdf`
      let listo = false
      try {
        // La pestaña ya se sabe de antes del último despliegue: lo que lo
        // registraría no va a entrar, así que ni se sube (trigésima pasada).
        // Se sabe antes de esperar nada: la persona sigue aquí y lo dice el formulario.
        if (laPestanaEsDeLaVersionAnterior()) {
          setError(SE_ACTUALIZO_EL_SISTEMA)
          return
        }
        const { error: falla } = await subirARutaNueva(supabase.storage.from('adjuntos-ot'), ruta, archivo, 'application/pdf', quitarConLaCuenta)
        // Un rechazo con la sesión de otra cuenta no es «No tienes permiso»: es el corte.
        if (falla) seguirConLaCuentaDeLaPestana()
        if (falla) {
          const motivo = `No se pudo subir el PDF de la orden. ${motivoDeSubida(falla)}`
          setError(motivo)
          decirElRechazoSiSeFue(desde, motivo, SI_SE_VA, { de })
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
          } else {
            setError(r.error)
          }
          decirElRechazoSiSeFue(desde, r.error, SI_SE_VA, { de })
          return
        }
        // Registrada: el formulario queda trabado hasta que se abre la orden.
        listo = true
        entro()
        const ida = idaALaOrden(r.datos?.id ?? ordenId)
        setQuedo(ida)
        const { url, ...dicho } = ida
        navegarSiEsDeLaPestana(router, url, desde, { ...dicho, juntoAlBoton: true })
      } catch (e) {
        // Entró otra cuenta a media cadena: no sigue, y el archivo que haya
        // subido se quita cuando vuelva la tuya (`anotarSinDejarloSuelto`). La
        // ventana dice que no se guardó: al volver, el cursor va ahí.
        if (e instanceof OtraCuentaEnLaPestana) {
          setError(NO_SE_GUARDO_OTRA_CUENTA)
          decirElRechazoSiSeFue(desde, NO_SE_GUARDO_OTRA_CUENTA, SI_SE_VA, { de })
          return
        }
        // Lo que se cae acá es la subida: la orden todavía no se registró.
        const motivo = 'No se pudo subir el PDF de la orden. Revisa la señal y vuelve a intentar.'
        setError(motivo)
        decirElRechazoSiSeFue(desde, motivo, SI_SE_VA, { de })
      } finally {
        if (!listo) enCurso.current = false
      }
    }, de))
  }

  return (
    <form onSubmit={enviar} className="max-w-4xl space-y-4">
      {/* Mientras se registra, nada se cambia: la orden sale con lo que se envió. */}
      <fieldset disabled={pendiente || Boolean(quedo)} className="min-w-0 space-y-4">
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
                    setAparte(({ cliente: _, unidad: __, ...resto }) => resto)
                  }}
                  marcador="Elige el cliente"
                  marcadorBusqueda="Razón social o RUC"
                  opciones={clientes.map((c) => ({
                    valor: c.id,
                    etiqueta: c.razon_social,
                    detalle: c.numero_documento,
                  }))}
                />
                <NuevoCliente onCreado={clienteCreado} alQuedarEnDuda={clienteEnDuda} />
              </div>
              <RegistradoAparte dice={aparte.cliente} alQuitar={() => quitarAparte('cliente')} />
            </Campo>

            <Campo
              etiqueta="Unidad"
              htmlFor="unidad_id"
              requerido={esGarantia}
              ayuda={
                clienteId && sinLeer?.clienteId === clienteId
                  ? sinLeer.porSesion
                    ? `No se pudieron leer sus unidades: la sesión terminó. ${VOLVER_A_ENTRAR}: se leen otra vez.`
                    : 'No se pudieron leer sus unidades. Se vuelven a leer al volver la conexión.'
                  : clienteId && unidades.length === 0
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
                  onChange={(v) => {
                    setUnidadId(v)
                    quitarAparte('unidad')
                  }}
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
                    alQuedarEnDuda={unidadEnDuda}
                    compacta
                  />
                )}
              </div>
              <RegistradoAparte dice={aparte.unidad} alQuitar={() => quitarAparte('unidad')} />
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
                  onChange={(v) => {
                    setCarroceriaId(v)
                    quitarAparte('carroceria')
                  }}
                  marcador="Sin especificar"
                  marcadorBusqueda="Tolva, cisterna, furgón…"
                  opciones={carrocerias.map((t) => ({ valor: t.id, etiqueta: t.nombre }))}
                />
                <NuevaCarroceria onCreada={carroceriaCreada} alQuedarEnDuda={carroceriaEnDuda} />
              </div>
              <RegistradoAparte dice={aparte.carroceria} alQuitar={() => quitarAparte('carroceria')} />
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
        <p ref={avisoError} role="alert" tabIndex={-1} className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-sm text-peligro">
          {error}
        </p>
      )}

      <YaQuedo ida={quedo} />

      <div className="flex justify-end gap-2">
        <EnlaceBoton href="/ordenes" variante="fantasma">
          Cancelar
        </EnlaceBoton>
        <Boton type="submit" cargando={pendiente} disabled={Boolean(quedo)}>
          Registrar orden
        </Boton>
      </div>
    </form>
  )
}

const idaALaOrden = (id: string) => ({ url: `/ordenes/${id}?creada=1`, dice: 'La orden quedó registrada.', enlace: 'Ver la orden' })
// Si su rechazo vuelve cuando la persona ya pidió otra pantalla, lo dice arriba (`decirElRechazoSiSeFue`).
const SI_SE_VA: SiSeVa = { que: 'la orden', enlace: 'Volver a la orden nueva' }

// Lo que se dice junto al campo cuando el alta de la unidad volvió sin decir si
// entró, y cuando además la lista no se pudo leer porque la sesión terminó.
const DUDA_UNIDAD = 'No llegó la respuesta de la unidad que registrabas: puede haber quedado. Búscala en «Unidad» antes de registrarla otra vez.'
const VOLVER_A_ENTRAR = 'Entra de nuevo en otra pestaña y vuelve a esta'
const DUDA_UNIDAD_SIN_SESION = `No se sabe si quedó la unidad que registrabas: la sesión terminó. ${VOLVER_A_ENTRAR}, y búscala en «Unidad» antes de registrarla otra vez.`

// 401 o 403 en una lectura que la cuenta sí puede hacer: la sesión ya no vale
// (el token vencido, o sin sesión, y anon no lee estas tablas). Lo que se
// escribió sigue en la pantalla, y lo que se envíe tampoco llegaría.
const sinSesion = (status: number) => status === 401 || status === 403

/** Cómo guarda la base el número del papel (migración 20261021110000); `null` si todavía no es un número. */
function comoQuedaElNumero(escrito: string): string | null {
  const m = /^(\d{1,6})(?:-(\d{4}))?$/.exec(escrito.trim())
  if (!m) return null
  const cifras = m[1].replace(/^0+/, '')
  if (!cifras) return null
  const anio = m[2] ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric' }).format(new Date())
  return `${cifras.padStart(4, '0')}-${anio}`
}

/**
 * Lo que se dio de alta en su ventana y entró después de cerrarla, o lo que
 * volvió sin decir si entró: junto a su campo, sin elegirlo (`aparte`). Siempre montada, como `YaQuedo`: una región
 * que nace con su texto el lector no la lee.
 */
function RegistradoAparte({ dice, alQuitar }: { dice: string | undefined; alQuitar: () => void }) {
  return (
    <div
      role="status"
      className={dice ? 'flex items-center gap-2 rounded-[var(--radius-base)] bg-info-suave py-1 pr-1 pl-3 text-xs text-texto' : 'sr-only'}
      data-registrado-aparte={dice ? '' : undefined}
    >
      {dice && (
        <>
          <p className="min-w-0 flex-1 text-pretty">{dice}</p>
          <Boton type="button" variante="fantasma" tamano="icono" aria-label="Quitar este aviso" onClick={alQuitar}>
            <X aria-hidden className="size-4" />
          </Boton>
        </>
      )}
    </div>
  )
}
