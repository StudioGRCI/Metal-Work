'use client'

import { ArrowDown, ArrowUp, Check, FileArchive, FileUp, FolderOpen, ListPlus, Pencil, Percent, Play, RotateCcw, Trash2, Flag, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, type RefObject } from 'react'

import { quitarAdjunto } from '@/app/(app)/ordenes/[id]/acciones-adjuntos'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { SeleccionBuscable, type OpcionBuscable } from '@/components/ui/seleccion-buscable'
import { ConfirmarAccion, Ventana } from '@/components/ui/ventana'
import { yaEntroLaPrimeraVez, yaEntroSinVentana } from '@/lib/acciones'
import { MAXIMO_ADJUNTO_MB, subirAdjunto } from '@/lib/adjuntos'
import {
  BUCKET_DXF,
  BUCKET_PLANOS_CODIGO,
  MAXIMO_MB_DXF,
  MAXIMO_MB_PLANO,
  TIPO_DXF,
  enlaceDisenoCodigo,
  extensionDxf,
  rutaDxf,
  rutaPlanoCodigo,
  type VistaDiseno,
} from '@/lib/dominio/diseno-codigos'
import { useAccion, useCursorAlRechazo, useEnvio } from '@/lib/envio'
import { cantidad } from '@/lib/format'
import { subirArchivoPrivado } from '@/lib/subida-privada'

import {
  anularPlano,
  cargarParDeEtapas,
  fijarPesoPlano,
  guardarEtapa,
  guardarEtapaDeArea,
  guardarMaterial,
  marcarEtapa,
  moverEtapa,
  quitarDxf,
  quitarEtapa,
  quitarMaterial,
  recibirPlano,
  registrarDxf,
  registrarPlano,
  subirRevision,
} from './acciones'

type Area = { id: string; codigo: string; nombre: string }

/**
 * El aviso del formulario sin ventana. Si la base dice que el envío ya entró la
 * primera vez, no es un rechazo: va sin rojo, como en `PieDeVentana`, y el
 * formulario ya se vació para el próximo (decimoquinta pasada). No pide
 * recargar: la lista ya se puso al día, y dice que lo de esta vez no se guardó.
 */
function Alerta({ error, mensaje, aviso }: { error: string | null; mensaje?: string | null; aviso?: RefObject<HTMLParagraphElement | null> }) {
  if (error) {
    const yaEntro = yaEntroLaPrimeraVez(error)
    return (
      <p
        ref={aviso}
        role="alert"
        tabIndex={-1}
        data-ya-entro={yaEntro || undefined}
        className={yaEntro ? 'rounded-[var(--radius-base)] bg-info-suave px-3 py-2 text-sm text-texto' : 'text-sm text-peligro'}
      >
        {yaEntro ? yaEntroSinVentana(error) : error}
      </p>
    )
  }
  if (mensaje) {
    return (
      <p role="status" className="text-sm text-exito">
        {mensaje}
      </p>
    )
  }
  return null
}

/** El PDF elegido, comprobado en el navegador antes de subirlo. */
async function pdfElegido(datos: FormData): Promise<File | string> {
  const archivo = datos.get('archivo')
  if (
    !(archivo instanceof File) ||
    archivo.size < 1 ||
    archivo.size > MAXIMO_MB_PLANO * 1024 * 1024 ||
    (await archivo.slice(0, 5).text()) !== '%PDF-'
  ) {
    return `Elige el PDF del plano, de hasta ${MAXIMO_MB_PLANO} MB.`
  }
  datos.delete('archivo')
  datos.set('nombre_archivo', archivo.name.trim().slice(0, 200) || 'plano.pdf')
  return archivo
}

/**
 * Ir a un código: los que el sistema ya conoce salen en la lista, y uno nuevo
 * se escribe tal cual. Diseño puede empezar los planos antes de que llegue el
 * primer requerimiento de la unidad.
 */
export function AbrirCodigo({ codigos, vista }: { codigos: string[]; vista: VistaDiseno }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const codigo = String(new FormData(e.currentTarget).get('codigo') ?? '')
          .trim()
          .replace(/\s+/g, ' ')
          .toUpperCase()
        if (codigo.length < 2) return setError('Escribe el código interno de la unidad, por ejemplo PLA_SR_O4_1_26/28.')
        if (codigo === 'PLANTA') return setError('PLANTA no es una unidad: los planos van con el código de la unidad.')
        setError(null)
        router.push(enlaceDisenoCodigo(codigo, vista))
      }}
      className="grid gap-2 sm:grid-cols-[minmax(0,24rem)_auto] sm:items-end"
    >
      <Campo etiqueta="Código interno de la unidad" htmlFor="abrir-codigo" ayuda="Elige uno de la lista o escribe uno nuevo.">
        <Entrada id="abrir-codigo" name="codigo" list="codigos-conocidos" autoComplete="off" autoCapitalize="characters" placeholder="PLA_SR_O4_1_26/28" />
      </Campo>
      <datalist id="codigos-conocidos">
        {codigos.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <Boton type="submit">
        <FolderOpen aria-hidden className="size-4" />
        Abrir código
      </Boton>
      {error && (
        <p role="alert" className="text-sm text-peligro sm:col-span-2">
          {error}
        </p>
      )}
    </form>
  )
}

// ------------------------------------------------------------------ Planos

/**
 * Cargar un plano nuevo: número, nombre, área de producción y su PDF. El PDF
 * sube primero a `{plano}/{revisión}.pdf` y después se registra; si el registro
 * falla, el PDF suelto se retira (ver `subirArchivoPrivado`).
 */

export function CargarPlano({
  codigo,
  areas,
  solicitud,
  repartido,
}: {
  codigo: string
  areas: Area[]
  solicitud: { plano: string; revision: string }
  /** Lo que ya suman los planos vigentes del código: entre todos no pasan de 100. */
  repartido: number
}) {
  const libre = Math.max(0, Math.round((100 - repartido) * 100) / 100)
  const [ids, setIds] = useState(solicitud)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const { alEnviar, enviando, error } = useEnvio(
    async (_previo, datos) => {
      setMensaje(null)
      const archivo = await pdfElegido(datos)
      if (typeof archivo === 'string') return { ok: false, error: archivo }
      return subirArchivoPrivado({
        bucket: BUCKET_PLANOS_CODIGO,
        ruta: rutaPlanoCodigo(ids.plano, ids.revision),
        archivo,
        contentType: 'application/pdf',
        registrar: () => registrarPlano(null, datos),
      })
    },
    (r) => {
      setMensaje(r.mensaje ?? 'Plano cargado.')
      setIds({ plano: crypto.randomUUID(), revision: crypto.randomUUID() })
    },
    // Tras «ya quedó», el plano siguiente lleva otro id: con el mismo decía «ya quedó» hasta recargar.
    {
      alYaEntrar: () => setIds({ plano: crypto.randomUUID(), revision: crypto.randomUUID() }),
      siSeVa: { que: 'el plano', enlace: 'Volver al plano' },
    },
  )
  // El cursor va al aviso: con el formulario vaciado tras «ya quedó», caía a la página.
  const aviso = useRef<HTMLParagraphElement>(null)
  useCursorAlRechazo(enviando, error, () => aviso.current)
  return (
    <form key={ids.plano} onSubmit={alEnviar} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[8rem_minmax(0,1fr)_12rem_9rem]">
      <input type="hidden" name="plano" value={ids.plano} />
      <input type="hidden" name="revision" value={ids.revision} />
      <input type="hidden" name="codigo" value={codigo} />
      <Campo etiqueta="N.º de plano" htmlFor="plano-numero" requerido>
        <Entrada id="plano-numero" name="numero" placeholder="001" maxLength={20} autoComplete="off" autoCapitalize="characters" required disabled={enviando} />
      </Campo>
      <Campo etiqueta="Nombre del plano" htmlFor="plano-nombre" requerido>
        <Entrada id="plano-nombre" name="nombre" placeholder="Estructura del cajón" maxLength={200} autoComplete="off" required disabled={enviando} />
      </Campo>
      <Campo etiqueta="Va a" htmlFor="plano-area" requerido>
        <Seleccion id="plano-area" name="area" required defaultValue="" disabled={enviando}>
          <option value="" disabled>
            Elige el área
          </option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </Seleccion>
      </Campo>
      <Campo
        etiqueta="% de la unidad"
        htmlFor="plano-peso"
        requerido
        ayuda={libre > 0 ? `Quedan ${cantidad(libre)} % por repartir` : 'Ya se repartió el 100 %: este va en 0 o corrige otro'}
      >
        <Entrada
          id="plano-peso"
          name="peso"
          inputMode="decimal"
          placeholder={libre > 0 ? String(Math.min(libre, 25)) : '0'}
          maxLength={6}
          autoComplete="off"
          required
          disabled={enviando}
        />
      </Campo>
      <Campo etiqueta="PDF del plano" htmlFor="plano-pdf" requerido className="sm:col-span-2 lg:col-span-2">
        <ElegirArchivo id="plano-pdf" name="archivo" accept="application/pdf,.pdf" hastaMb={MAXIMO_MB_PLANO} required disabled={enviando} />
      </Campo>
      <Campo etiqueta="Observación" htmlFor="plano-observacion" className="sm:col-span-2 lg:col-span-2">
        <Entrada id="plano-observacion" name="observacion" maxLength={1000} autoComplete="off" placeholder="Opcional: lo que el área tiene que saber" disabled={enviando} />
      </Campo>
      <div className="flex items-end sm:col-span-2 lg:col-span-4">
        <Boton type="submit" cargando={enviando}>
          <FileUp aria-hidden className="size-4" />
          Cargar plano
        </Boton>
      </div>
      <div className="sm:col-span-2 lg:col-span-4">
        <Alerta error={error} mensaje={mensaje} aviso={aviso} />
      </div>
    </form>
  )
}

/** Corregir el porcentaje de la unidad que representa un plano vigente. */
export function CambiarPeso({ plano, numero, peso, libre }: { plano: string; numero: string; peso: number | null; libre: number }) {
  const [abierta, setAbierta] = useState(false)
  // Corrige el % que la fila muestra: se cierra con la fila ya al día (`corrige`).
  const { alEnviar, enviando, error } = useEnvio(fijarPesoPlano, () => setAbierta(false), { corrige: true })
  const tope = Math.round((libre + (peso ?? 0)) * 100) / 100
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierta(true)} aria-label={`${peso === null ? 'Poner' : 'Cambiar'} el % de la unidad del plano ${numero}`}>
        <Percent aria-hidden className="size-4" />
        {peso === null ? 'Poner %' : 'Cambiar %'}
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`% de la unidad del plano ${numero}`}
        descripcion={`Con los demás planos del código, este puede llegar a ${cantidad(tope)} %.`}
        ancho="sm"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="plano" value={plano} />
          <Campo etiqueta="% de la unidad" htmlFor={`peso-${plano}`} requerido>
            <Entrada
              id={`peso-${plano}`}
              name="peso"
              inputMode="decimal"
              defaultValue={peso === null ? '' : String(peso)}
              maxLength={6}
              autoComplete="off"
              required
              disabled={enviando}
            />
          </Campo>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Guardar" />
        </form>
      </Ventana>
    </>
  )
}

/** La revisión corregida de un plano, diciendo qué cambió. */
export function SubirRevision({ plano, numero, solicitudId }: { plano: string; numero: string; solicitudId: string }) {
  const [abierta, setAbierta] = useState(false)
  const [revision, setRevision] = useState(solicitudId)
  const { alEnviar, enviando, error } = useEnvio(
    async (_previo, datos) => {
      const archivo = await pdfElegido(datos)
      if (typeof archivo === 'string') return { ok: false, error: archivo }
      return subirArchivoPrivado({
        bucket: BUCKET_PLANOS_CODIGO,
        ruta: rutaPlanoCodigo(plano, revision),
        archivo,
        contentType: 'application/pdf',
        registrar: () => subirRevision(null, datos),
      })
    },
    () => {
      setAbierta(false)
      setRevision(crypto.randomUUID())
    },
    { alYaEntrar: () => setRevision(crypto.randomUUID()) },
  )
  return (
    <>
      <Boton type="button" variante="contorno" tamano="sm" onClick={() => setAbierta(true)}>
        <FileUp aria-hidden className="size-4" />
        Subir revisión
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Revisión del plano ${numero}`}
        descripcion="La revisión anterior queda como historia. El supervisor del área recibe el aviso y tiene que marcar la nueva recibida."
        ancho="sm"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="plano" value={plano} />
          <input type="hidden" name="revision" value={revision} />
          <Campo etiqueta="Qué cambió" htmlFor={`cambios-${plano}`} requerido>
            <AreaTexto id={`cambios-${plano}`} name="cambios" rows={3} minLength={5} maxLength={1000} required disabled={enviando} />
          </Campo>
          <Campo etiqueta="PDF corregido" htmlFor={`revision-pdf-${plano}`} requerido>
            <ElegirArchivo id={`revision-pdf-${plano}`} name="archivo" accept="application/pdf,.pdf" hastaMb={MAXIMO_MB_PLANO} required disabled={enviando} />
          </Campo>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Subir revisión" />
        </form>
      </Ventana>
    </>
  )
}

/** Anular un plano con su motivo. Queda como evidencia y el área recibe el aviso. */
export function AnularPlano({ plano, numero }: { plano: string; numero: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(anularPlano, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierta(true)}>
        <XCircle aria-hidden className="size-4" />
        Anular
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Anular el plano ${numero}`}
        descripcion="El plano queda anulado con su motivo y sus revisiones como evidencia; el área recibe el aviso de que ya no trabaje con él. Si estaba mal cargado, después lo cargas bien."
        ancho="sm"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="plano" value={plano} />
          <Campo etiqueta="Por qué se anula" htmlFor={`motivo-plano-${plano}`} requerido>
            <AreaTexto id={`motivo-plano-${plano}`} name="motivo" rows={3} minLength={5} maxLength={500} required disabled={enviando} />
          </Campo>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Anular plano" variante="peligro" />
        </form>
      </Ventana>
    </>
  )
}

/** El supervisor marca que recibió la revisión vigente. Un toque, sin ventana. */
export function RecibirPlano({ revision, numero }: { revision: string; numero: string }) {
  const { ejecutar, enviando, error } = useAccion(recibirPlano, undefined, { documento: revision })
  return (
    <div className="space-y-1">
      {/* Dice lo que hace, no un estado: «✓ Recibido» junto a «Por recibir» se leía como que ya estaba (auditoría del 27/10/2026). */}
      <Boton
        type="button"
        tamano="sm"
        variante="secundario"
        cargando={enviando}
        onClick={() => {
          const datos = new FormData()
          datos.set('revision', revision)
          ejecutar(datos)
        }}
        aria-label={`Marcar recibido el plano ${numero}`}
      >
        <Check aria-hidden className="size-4" />
        Marcar recibido
      </Boton>
      <Alerta error={error} />
    </div>
  )
}

// ------------------------------------------------------------------ Materiales

type PlanoParaElegir = { id: string; etiqueta: string }

/** Agregar una línea a la lista, o corregir una (con `linea`). */
export function FormularioMaterial({
  codigo,
  materiales,
  planos,
  linea,
  alTerminar,
}: {
  codigo: string
  materiales: OpcionBuscable[]
  planos: PlanoParaElegir[]
  linea?: { id: string; material_id: string; cantidad: number; plano_id: string | null; observacion: string | null }
  alTerminar?: () => void
}) {
  const [material, setMaterial] = useState(linea?.material_id ?? '')
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  // Con `linea` corrige lo que la lista muestra y se cierra con la lista ya al
  // día; el alta se rehace al contestar para la siguiente (`corrige`).
  const { alEnviar, enviando, error } = useEnvio(
    guardarMaterial,
    (r) => {
      if (alTerminar) return alTerminar()
      setMensaje(r.mensaje ?? null)
      setMaterial('')
      setVuelta((v) => v + 1)
    },
    { corrige: Boolean(linea) },
  )
  const id = linea?.id ?? 'nueva'
  return (
    <form
      key={vuelta}
      onSubmit={(e) => {
        setMensaje(null)
        alEnviar(e)
      }}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_8rem_minmax(0,14rem)]"
    >
      {linea && <input type="hidden" name="id" value={linea.id} />}
      <input type="hidden" name="codigo" value={codigo} />
      <Campo etiqueta="Material" htmlFor={`material-${id}`} requerido className="sm:col-span-2 lg:col-span-1">
        <SeleccionBuscable
          id={`material-${id}`}
          name="material"
          opciones={materiales}
          valor={material}
          onChange={setMaterial}
          marcador="Elige el material del catálogo"
          marcadorBusqueda="Escribe parte del nombre o del código"
          requerido
          deshabilitado={enviando}
        />
      </Campo>
      <Campo etiqueta="Cantidad" htmlFor={`cantidad-${id}`} requerido>
        <Entrada
          id={`cantidad-${id}`}
          name="cantidad"
          inputMode="decimal"
          autoComplete="off"
          placeholder="Ej. 12"
          defaultValue={linea ? String(linea.cantidad) : ''}
          required
          disabled={enviando}
        />
      </Campo>
      <Campo etiqueta="Sale del plano" htmlFor={`plano-${id}`}>
        <Seleccion id={`plano-${id}`} name="plano" defaultValue={linea?.plano_id ?? ''} disabled={enviando}>
          <option value="">De la unidad entera</option>
          {planos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.etiqueta}
            </option>
          ))}
        </Seleccion>
      </Campo>
      <Campo etiqueta="Observación" htmlFor={`observacion-${id}`} className="sm:col-span-2 lg:col-span-2">
        <Entrada
          id={`observacion-${id}`}
          name="observacion"
          maxLength={500}
          autoComplete="off"
          placeholder="Opcional: medida, calidad, para qué va"
          defaultValue={linea?.observacion ?? ''}
          disabled={enviando}
        />
      </Campo>
      <div className="flex items-end">
        <Boton type="submit" cargando={enviando}>
          {linea ? <Pencil aria-hidden className="size-4" /> : <ListPlus aria-hidden className="size-4" />}
          {linea ? 'Guardar' : 'Agregar a la lista'}
        </Boton>
      </div>
      <div className="sm:col-span-2 lg:col-span-3">
        <Alerta error={error} mensaje={mensaje} />
      </div>
    </form>
  )
}

/** Corregir una línea en una ventana, para no tapar la lista. */
export function CorregirMaterial({
  codigo,
  materiales,
  planos,
  linea,
  nombre,
}: {
  codigo: string
  materiales: OpcionBuscable[]
  planos: PlanoParaElegir[]
  linea: { id: string; material_id: string; cantidad: number; plano_id: string | null; observacion: string | null }
  nombre: string
}) {
  const [abierta, setAbierta] = useState(false)
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="icono" onClick={() => setAbierta(true)} aria-label={`Corregir ${nombre}`}>
        <Pencil aria-hidden className="size-4" />
      </Boton>
      <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo={`Corregir ${nombre}`} ancho="lg">
        <FormularioMaterial codigo={codigo} materiales={materiales} planos={planos} linea={linea} alTerminar={() => setAbierta(false)} />
      </Ventana>
    </>
  )
}

export function QuitarMaterial({ id, nombre }: { id: string; nombre: string }) {
  const [abierta, setAbierta] = useState(false)
  const { ejecutar, enviando, error } = useAccion(quitarMaterial, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="icono" onClick={() => setAbierta(true)} aria-label={`Quitar ${nombre} de la lista`}>
        <Trash2 aria-hidden className="size-4" />
      </Boton>
      <ConfirmarAccion
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Quitar de la lista"
        detalle={`${nombre} sale de la lista de materiales del código. Queda en el historial.`}
        trabajando={enviando}
        error={error}
        alConfirmar={() => {
          const datos = new FormData()
          datos.set('id', id)
          ejecutar(datos)
        }}
      />
    </>
  )
}

// ------------------------------------------------------------------ Etapas

/**
 * El par de Diseño por cada juego de planos: Habilitado (Maestranza) y
 * Ensamblaje (Producción). El primer juego va sin nombre; el segundo de la
 * misma unidad lleva el suyo («Caja», «Chasis»).
 */
export function ParDeEtapas({ codigo, primero }: { codigo: string; primero: boolean }) {
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const { alEnviar, enviando, error } = useEnvio(cargarParDeEtapas, (r) => {
    setMensaje(r.mensaje ?? null)
    setVuelta((v) => v + 1)
  })
  return (
    <form
      key={vuelta}
      onSubmit={(e) => {
        setMensaje(null)
        alEnviar(e)
      }}
      className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
    >
      <input type="hidden" name="codigo" value={codigo} />
      <Campo
        etiqueta="Juego de planos"
        htmlFor="par-juego"
        requerido={!primero}
        ayuda={primero ? 'Déjalo vacío si la unidad lleva un solo juego.' : 'El nombre del otro juego, para no confundir sus etapas.'}
      >
        <Entrada id="par-juego" name="juego" maxLength={60} autoComplete="off" placeholder="Caja" required={!primero} disabled={enviando} />
      </Campo>
      <Boton type="submit" cargando={enviando}>
        <ListPlus aria-hidden className="size-4" />
        Cargar Habilitado y Ensamblaje
      </Boton>
      <div className="sm:col-span-2">
        <Alerta error={error} mensaje={mensaje} />
      </div>
    </form>
  )
}

type EtapaEditable = { id: string; nombre: string; area_id: string | null; inicio_plan: string | null; fin_plan: string | null }

/**
 * Agregar una etapa de Diseño (al final) o corregir nombre, área y fechas (con
 * `etapa`). Diseño solo pone etapas de Maestranza y de Producción: `areas` trae esas dos.
 */
export function FormularioEtapa({
  codigo,
  areas,
  etapa,
  alTerminar,
}: {
  codigo: string
  areas: Area[]
  etapa?: EtapaEditable
  alTerminar?: () => void
}) {
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  // Con `etapa` corrige la fila y se cierra con ella ya al día (`corrige`).
  const { alEnviar, enviando, error } = useEnvio(
    guardarEtapa,
    (r) => {
      if (alTerminar) return alTerminar()
      setMensaje(r.mensaje ?? null)
      setVuelta((v) => v + 1)
    },
    { corrige: Boolean(etapa) },
  )
  const id = etapa?.id ?? 'nueva'
  return (
    <form
      key={vuelta}
      onSubmit={(e) => {
        setMensaje(null)
        alEnviar(e)
      }}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_10rem_10rem_auto] lg:items-end"
    >
      {etapa && <input type="hidden" name="id" value={etapa.id} />}
      <input type="hidden" name="codigo" value={codigo} />
      <Campo etiqueta="Etapa" htmlFor={`etapa-nombre-${id}`} requerido>
        <Entrada
          id={`etapa-nombre-${id}`}
          name="nombre"
          maxLength={120}
          autoComplete="off"
          placeholder="Habilitado"
          defaultValue={etapa?.nombre ?? ''}
          required
          disabled={enviando}
        />
      </Campo>
      <Campo etiqueta="La hace" htmlFor={`etapa-area-${id}`} requerido>
        <Seleccion id={`etapa-area-${id}`} name="area" defaultValue={etapa?.area_id ?? ''} required disabled={enviando}>
          <option value="" disabled>
            Elige el área
          </option>
          {areas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.nombre}
            </option>
          ))}
        </Seleccion>
      </Campo>
      <Campo etiqueta="Empieza" htmlFor={`etapa-inicio-${id}`}>
        <Entrada id={`etapa-inicio-${id}`} name="inicio_plan" type="date" defaultValue={etapa?.inicio_plan ?? ''} disabled={enviando} />
      </Campo>
      <Campo etiqueta="Comprometida" htmlFor={`etapa-fin-${id}`}>
        <Entrada id={`etapa-fin-${id}`} name="fin_plan" type="date" defaultValue={etapa?.fin_plan ?? ''} disabled={enviando} />
      </Campo>
      <Boton type="submit" cargando={enviando}>
        {etapa ? <Pencil aria-hidden className="size-4" /> : <ListPlus aria-hidden className="size-4" />}
        {etapa ? 'Guardar' : 'Agregar etapa'}
      </Boton>
      <div className="sm:col-span-2 lg:col-span-5">
        <Alerta error={error} mensaje={mensaje} />
      </div>
    </form>
  )
}

export function CorregirEtapa({ codigo, areas, etapa }: { codigo: string; areas: Area[]; etapa: EtapaEditable }) {
  const [abierta, setAbierta] = useState(false)
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="icono" onClick={() => setAbierta(true)} aria-label={`Corregir la etapa ${etapa.nombre}`}>
        <Pencil aria-hidden className="size-4" />
      </Boton>
      <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo={`Corregir «${etapa.nombre}»`} ancho="xl">
        <FormularioEtapa codigo={codigo} areas={areas} etapa={etapa} alTerminar={() => setAbierta(false)} />
      </Ventana>
    </>
  )
}

export function MoverEtapa({ id, nombre, primera, ultima }: { id: string; nombre: string; primera: boolean; ultima: boolean }) {
  const { ejecutar, enviando, error } = useAccion(moverEtapa, undefined, { documento: id })
  const mover = (arriba: boolean) => {
    const datos = new FormData()
    datos.set('id', id)
    datos.set('arriba', arriba ? '1' : '0')
    ejecutar(datos)
  }
  return (
    <span className="inline-flex items-center" title={error ?? undefined}>
      <Boton type="button" variante="fantasma" tamano="icono" disabled={primera || enviando} onClick={() => mover(true)} aria-label={`Subir ${nombre}`}>
        <ArrowUp aria-hidden className="size-4" />
      </Boton>
      <Boton type="button" variante="fantasma" tamano="icono" disabled={ultima || enviando} onClick={() => mover(false)} aria-label={`Bajar ${nombre}`}>
        <ArrowDown aria-hidden className="size-4" />
      </Boton>
    </span>
  )
}

export function QuitarEtapa({ id, nombre }: { id: string; nombre: string }) {
  const [abierta, setAbierta] = useState(false)
  const { ejecutar, enviando, error } = useAccion(quitarEtapa, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="icono" onClick={() => setAbierta(true)} aria-label={`Quitar la etapa ${nombre}`}>
        <Trash2 aria-hidden className="size-4" />
      </Boton>
      <ConfirmarAccion
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Quitar la etapa"
        detalle={`«${nombre}» sale de las etapas del código, con sus fechas. Queda en el historial.`}
        trabajando={enviando}
        error={error}
        alConfirmar={() => {
          const datos = new FormData()
          datos.set('id', id)
          ejecutar(datos)
        }}
      />
    </>
  )
}

type Paso = 'INICIO' | 'FIN' | 'REABRIR'

/**
 * Marcar que la etapa empezó, terminó o se reabre. Terminar después de la
 * fecha comprometida y reabrir piden escribir por qué: la base lo exige.
 */
export function MarcarEtapa({
  etapa,
  hoy,
}: {
  etapa: { id: string; nombre: string; inicio_real: string | null; fin_real: string | null; fin_plan: string | null }
  hoy: string
}) {
  const [paso, setPaso] = useState<Paso | null>(null)
  const { alEnviar, enviando, error, limpiar } = useEnvio(marcarEtapa, () => setPaso(null))
  const abrir = (p: Paso) => {
    limpiar()
    setPaso(p)
  }
  const tarde = etapa.fin_plan !== null && hoy > etapa.fin_plan
  const titulo = paso === 'INICIO' ? `Empezó «${etapa.nombre}»` : paso === 'FIN' ? `Terminó «${etapa.nombre}»` : `Reabrir «${etapa.nombre}»`
  return (
    <>
      <span className="inline-flex flex-wrap gap-1">
        {!etapa.fin_real && !etapa.inicio_real && (
          <Boton type="button" variante="contorno" tamano="sm" onClick={() => abrir('INICIO')}>
            <Play aria-hidden className="size-4" />
            Empezó
          </Boton>
        )}
        {!etapa.fin_real && (
          <Boton type="button" variante="contorno" tamano="sm" onClick={() => abrir('FIN')}>
            <Flag aria-hidden className="size-4" />
            Terminó
          </Boton>
        )}
        {etapa.fin_real && (
          <Boton type="button" variante="fantasma" tamano="sm" onClick={() => abrir('REABRIR')}>
            <RotateCcw aria-hidden className="size-4" />
            Reabrir
          </Boton>
        )}
      </span>
      <Ventana
        abierta={paso !== null}
        alCerrar={() => setPaso(null)}
        titulo={titulo}
        descripcion={
          paso === 'REABRIR'
            ? 'La etapa vuelve a quedar en proceso. Escribe por qué: lo ve Gerencia.'
            : paso === 'FIN' && tarde
              ? 'Ya pasó la fecha comprometida: escribe por qué se atrasó. Lo ve Gerencia.'
              : undefined
        }
        ancho="sm"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="id" value={etapa.id} />
          <input type="hidden" name="paso" value={paso ?? ''} />
          {paso !== 'REABRIR' && (
            <Campo etiqueta={paso === 'INICIO' ? 'Empezó el' : 'Terminó el'} htmlFor={`fecha-etapa-${etapa.id}`} requerido>
              <Entrada id={`fecha-etapa-${etapa.id}`} name="fecha" type="date" max={hoy} defaultValue={hoy} required disabled={enviando} />
            </Campo>
          )}
          <Campo
            etiqueta={paso === 'REABRIR' ? 'Por qué se reabre' : paso === 'FIN' && tarde ? 'Por qué se atrasó' : 'Nota'}
            htmlFor={`nota-etapa-${etapa.id}`}
            requerido={paso === 'REABRIR' || (paso === 'FIN' && tarde)}
          >
            <AreaTexto
              id={`nota-etapa-${etapa.id}`}
              name="nota"
              rows={3}
              maxLength={1000}
              minLength={paso === 'REABRIR' || (paso === 'FIN' && tarde) ? 5 : undefined}
              required={paso === 'REABRIR' || (paso === 'FIN' && tarde)}
              disabled={enviando}
            />
          </Campo>
          <Alerta error={error} />
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setPaso(null)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              {paso === 'INICIO' ? 'Marcar empezada' : paso === 'FIN' ? 'Marcar terminada' : 'Reabrir'}
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

// ------------------------------------------------------------------ Etapas de cada área

/**
 * Lo que agrega el supervisor: una subetapa debajo de la etapa de Diseño de su
 * área (con `padre`), una etapa propia de su área para un código (con `codigos`
 * y `areas`), o corrige una de las suyas (con `etapa`).
 */
export function FormularioEtapaDeArea({
  padre,
  codigos,
  areas,
  etapa,
  alTerminar,
}: {
  padre?: { id: string; nombre: string }
  /** Las unidades a las que el área puede ponerle una etapa: el código, con su OT y su placa. */
  codigos?: OpcionBuscable[]
  areas?: Area[]
  etapa?: EtapaEditable
  alTerminar?: () => void
}) {
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [codigo, setCodigo] = useState('')
  const { alEnviar, enviando, error } = useEnvio(
    guardarEtapaDeArea,
    (r) => {
      if (alTerminar) return alTerminar()
      setMensaje(r.mensaje ?? null)
      setVuelta((v) => v + 1)
      setCodigo('')
    },
    { corrige: Boolean(etapa) },
  )
  const id = etapa?.id ?? padre?.id ?? 'propia'
  const propia = !etapa && !padre
  return (
    <form
      key={vuelta}
      onSubmit={(e) => {
        setMensaje(null)
        alEnviar(e)
      }}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_10rem_10rem_auto] lg:items-end"
    >
      {etapa && <input type="hidden" name="id" value={etapa.id} />}
      {padre && <input type="hidden" name="padre" value={padre.id} />}
      {propia && (
        <>
          <Campo etiqueta="Unidad" htmlFor="etapa-area-codigo" requerido className="sm:col-span-2 lg:col-span-2">
            <SeleccionBuscable
              id="etapa-area-codigo"
              name="codigo"
              opciones={codigos ?? []}
              valor={codigo}
              onChange={setCodigo}
              marcador="Elige el código interno"
              marcadorBusqueda="Código, OT o placa"
              requerido
              deshabilitado={enviando}
            />
          </Campo>
          {areas && areas.length === 1 ? (
            <input type="hidden" name="area" value={areas[0].id} />
          ) : (
            <Campo etiqueta="Área" htmlFor="etapa-area-area" requerido className="sm:col-span-2 lg:col-span-2">
              <Seleccion id="etapa-area-area" name="area" required defaultValue="" disabled={enviando}>
                <option value="" disabled>
                  Elige el área
                </option>
                {(areas ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </Seleccion>
            </Campo>
          )}
        </>
      )}
      <Campo etiqueta={padre ? `Subetapa de ${padre.nombre}` : 'Etapa'} htmlFor={`etapa-de-area-nombre-${id}`} requerido>
        <Entrada
          id={`etapa-de-area-nombre-${id}`}
          name="nombre"
          maxLength={120}
          autoComplete="off"
          placeholder={padre ? 'Corte de planchas' : 'Arenado y pintura'}
          defaultValue={etapa?.nombre ?? ''}
          required
          disabled={enviando}
        />
      </Campo>
      <Campo etiqueta="Empieza" htmlFor={`etapa-de-area-inicio-${id}`}>
        <Entrada id={`etapa-de-area-inicio-${id}`} name="inicio_plan" type="date" defaultValue={etapa?.inicio_plan ?? ''} disabled={enviando} />
      </Campo>
      <Campo etiqueta="Comprometida" htmlFor={`etapa-de-area-fin-${id}`}>
        <Entrada id={`etapa-de-area-fin-${id}`} name="fin_plan" type="date" defaultValue={etapa?.fin_plan ?? ''} disabled={enviando} />
      </Campo>
      <Boton type="submit" cargando={enviando}>
        {etapa ? <Pencil aria-hidden className="size-4" /> : <ListPlus aria-hidden className="size-4" />}
        {etapa ? 'Guardar' : padre ? 'Agregar subetapa' : 'Agregar etapa'}
      </Boton>
      <div className="sm:col-span-2 lg:col-span-4">
        <Alerta error={error} mensaje={mensaje} />
      </div>
    </form>
  )
}

/** Abrir en una ventana el formulario de subetapa, o la corrección de una etapa del área. */
export function VentanaEtapaDeArea({ padre, etapa, codigo }: { padre?: { id: string; nombre: string }; etapa?: EtapaEditable; codigo?: string }) {
  const [abierta, setAbierta] = useState(false)
  return (
    <>
      {etapa ? (
        <Boton type="button" variante="fantasma" tamano="icono" onClick={() => setAbierta(true)} aria-label={`Corregir ${etapa.nombre}`}>
          <Pencil aria-hidden className="size-4" />
        </Boton>
      ) : (
        <Boton type="button" variante="contorno" tamano="sm" onClick={() => setAbierta(true)}>
          <ListPlus aria-hidden className="size-4" />
          Subetapa
        </Boton>
      )}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={etapa ? `Corregir «${etapa.nombre}»` : `Subetapa de «${padre?.nombre}»`}
        descripcion={[
          codigo ? `Unidad ${codigo}.` : null,
          etapa ? null : 'Según el material que vas a procesar o lo que vas a ensamblar. Cuenta en el avance de la etapa de arriba.',
        ].filter(Boolean).join(' ') || undefined}
        ancho="xl"
      >
        <FormularioEtapaDeArea padre={padre} etapa={etapa} alTerminar={() => setAbierta(false)} />
      </Ventana>
    </>
  )
}

// ------------------------------------------------------------------ DXF

/**
 * Subir un comprimido de DXF (.zip, .rar o .7z, hasta 50 MB). El archivo sube
 * primero a `dxf-codigo/{id}.{ext}` y después se registra; si el registro
 * falla, el archivo suelto se retira (ver `subirArchivoPrivado`).
 */
export function CargarDxf({ codigo }: { codigo: string }) {
  const [id, setId] = useState(() => crypto.randomUUID())
  const [mensaje, setMensaje] = useState<string | null>(null)
  const { alEnviar, enviando, error } = useEnvio(
    async (_previo, datos) => {
      setMensaje(null)
      const archivo = datos.get('archivo')
      const ext = archivo instanceof File ? extensionDxf(archivo.name) : null
      if (!(archivo instanceof File) || !ext || archivo.size < 1 || archivo.size > MAXIMO_MB_DXF * 1024 * 1024) {
        return { ok: false, error: `Elige el comprimido de los DXF: .zip, .rar o .7z, de hasta ${MAXIMO_MB_DXF} MB.` }
      }
      datos.delete('archivo')
      datos.set('nombre_archivo', archivo.name.trim().slice(0, 200))
      return subirArchivoPrivado({
        bucket: BUCKET_DXF,
        ruta: rutaDxf(id, ext),
        archivo,
        contentType: TIPO_DXF[ext],
        registrar: () => registrarDxf(null, datos),
      })
    },
    (r) => {
      setMensaje(r.mensaje ?? 'DXF cargados.')
      setId(crypto.randomUUID())
    },
    { alYaEntrar: () => setId(crypto.randomUUID()), siSeVa: { que: 'los DXF', enlace: 'Volver a los DXF' } },
  )
  const aviso = useRef<HTMLParagraphElement>(null)
  useCursorAlRechazo(enviando, error, () => aviso.current)
  return (
    <form key={id} onSubmit={alEnviar} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="codigo" value={codigo} />
      <Campo etiqueta="Qué traen" htmlFor="dxf-descripcion" requerido>
        <Entrada id="dxf-descripcion" name="descripcion" maxLength={200} autoComplete="off" placeholder="Corte de planchas del cajón" required disabled={enviando} />
      </Campo>
      <Campo etiqueta="Comprimido" htmlFor="dxf-archivo" requerido>
        <ElegirArchivo id="dxf-archivo" name="archivo" accept=".zip,.rar,.7z" hastaMb={MAXIMO_MB_DXF} required disabled={enviando} />
      </Campo>
      <div className="sm:col-span-2">
        <Boton type="submit" cargando={enviando}>
          <FileArchive aria-hidden className="size-4" />
          Cargar DXF
        </Boton>
      </div>
      <div className="sm:col-span-2">
        <Alerta error={error} mensaje={mensaje} aviso={aviso} />
      </div>
    </form>
  )
}

export function QuitarDxf({ id, nombre }: { id: string; nombre: string }) {
  const [abierta, setAbierta] = useState(false)
  const { ejecutar, enviando, error } = useAccion(quitarDxf, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="icono" onClick={() => setAbierta(true)} aria-label={`Quitar ${nombre}`}>
        <Trash2 aria-hidden className="size-4" />
      </Boton>
      <ConfirmarAccion
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Quitar el comprimido"
        detalle={`«${nombre}» deja de verse en Maestranza. Queda en el historial.`}
        trabajando={enviando}
        error={error}
        alConfirmar={() => {
          const datos = new FormData()
          datos.set('id', id)
          ejecutar(datos)
        }}
      />
    </>
  )
}

// ------------------------------------------------------------------ Ficha técnica

const ACEPTA_FICHA = 'application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png'

/**
 * Adjuntar a la OT la ficha técnica del camión o tracto, en PDF o en foto. Va
 * a la orden como sus otros archivos (`ot_adjuntos`), y se ve también desde ella.
 */
export function SubirFicha({ ordenId, numero }: { ordenId: string; numero: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error, limpiar } = useEnvio(
    async (_previo, datos) => {
      const archivo = datos.get('archivo')
      if (!(archivo instanceof File) || archivo.size < 1) return { ok: false, error: 'Elige la ficha técnica: PDF, JPG o PNG.' }
      return subirAdjunto(ordenId, archivo, 'FICHA_VEHICULO')
    },
    () => setAbierta(false),
    { siSeVa: { que: 'la ficha técnica', enlace: 'Volver al código' } },
  )
  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        onClick={() => {
          limpiar()
          setAbierta(true)
        }}
      >
        <FileUp aria-hidden className="size-4" />
        Adjuntar ficha técnica
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Ficha técnica · OT ${numero}`}
        descripcion="La del camión o tracto que llega para la unidad: en PDF o en foto. Queda junto a la OT."
        ancho="sm"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <Campo etiqueta="Ficha técnica" htmlFor={`ficha-${ordenId}`} requerido>
            <ElegirArchivo id={`ficha-${ordenId}`} name="archivo" accept={ACEPTA_FICHA} hastaMb={MAXIMO_ADJUNTO_MB} required disabled={enviando} />
          </Campo>
          <PieDeVentana error={error} enviando={enviando} alCancelar={() => setAbierta(false)} texto="Adjuntar" />
        </form>
      </Ventana>
    </>
  )
}

export function QuitarFicha({ id, ordenId, nombre }: { id: string; ordenId: string; nombre: string }) {
  const [abierta, setAbierta] = useState(false)
  const { ejecutar, enviando, error } = useAccion(quitarAdjunto, () => setAbierta(false))
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="icono" onClick={() => setAbierta(true)} aria-label={`Quitar la ficha ${nombre}`}>
        <Trash2 aria-hidden className="size-4" />
      </Boton>
      <ConfirmarAccion
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo="Quitar la ficha técnica"
        detalle={`«${nombre}» sale de la OT. Si te equivocaste de archivo, adjunta el correcto después.`}
        trabajando={enviando}
        error={error}
        alConfirmar={() => {
          const datos = new FormData()
          datos.set('id', id)
          datos.set('orden_id', ordenId)
          ejecutar(datos)
        }}
      />
    </>
  )
}
