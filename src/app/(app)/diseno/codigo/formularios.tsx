'use client'

import { ArrowDown, ArrowUp, Check, FileUp, FolderOpen, ListPlus, Pencil, Percent, Play, RotateCcw, Trash2, Flag, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { SeleccionBuscable, type OpcionBuscable } from '@/components/ui/seleccion-buscable'
import { ConfirmarAccion, Ventana } from '@/components/ui/ventana'
import { BUCKET_PLANOS_CODIGO, MAXIMO_MB_PLANO, enlaceDisenoCodigo, rutaPlanoCodigo, type VistaDiseno } from '@/lib/dominio/diseno-codigos'
import { useAccion, useEnvio } from '@/lib/envio'
import { subirArchivoPrivado } from '@/lib/subida-privada'

import {
  anularPlano,
  cargarEtapasDeSiempre,
  fijarPesoPlano,
  guardarEtapa,
  guardarMaterial,
  marcarEtapa,
  moverEtapa,
  quitarEtapa,
  quitarMaterial,
  recibirPlano,
  registrarPlano,
  subirRevision,
} from './acciones'

type Area = { id: string; codigo: string; nombre: string }

function Alerta({ error, mensaje }: { error: string | null; mensaje?: string | null }) {
  if (error) {
    return (
      <p role="alert" className="text-sm text-peligro">
        {error}
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
/** «12,5» y «12.5» son lo mismo para la persona; el número se muestra con coma. */
function porcentajeTexto(valor: number) {
  return String(Math.round(valor * 100) / 100).replace('.', ',')
}

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
  )
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
        ayuda={libre > 0 ? `Quedan ${porcentajeTexto(libre)} % por repartir` : 'Ya se repartió el 100 %: este va en 0 o corrige otro'}
      >
        <Entrada
          id="plano-peso"
          name="peso"
          inputMode="decimal"
          placeholder={libre > 0 ? porcentajeTexto(Math.min(libre, 25)) : '0'}
          maxLength={6}
          autoComplete="off"
          required
          disabled={enviando}
        />
      </Campo>
      <Campo etiqueta="PDF del plano" htmlFor="plano-pdf" requerido className="sm:col-span-2 lg:col-span-2">
        <Entrada id="plano-pdf" name="archivo" type="file" accept="application/pdf,.pdf" required disabled={enviando} />
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
        <Alerta error={error} mensaje={mensaje} />
      </div>
    </form>
  )
}

/** Corregir el porcentaje de la unidad que representa un plano vigente. */
export function CambiarPeso({ plano, numero, peso, libre }: { plano: string; numero: string; peso: number | null; libre: number }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(fijarPesoPlano, () => setAbierta(false))
  const tope = Math.round((libre + (peso ?? 0)) * 100) / 100
  return (
    <>
      <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbierta(true)} aria-label={`Cambiar el % de la unidad del plano ${numero}`}>
        <Percent aria-hidden className="size-4" />
        {peso === null ? 'Poner %' : 'Cambiar %'}
      </Boton>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`% de la unidad del plano ${numero}`}
        descripcion={`Con los demás planos del código, este puede llegar a ${porcentajeTexto(tope)} %.`}
        ancho="sm"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="plano" value={plano} />
          <Campo etiqueta="% de la unidad" htmlFor={`peso-${plano}`} requerido>
            <Entrada
              id={`peso-${plano}`}
              name="peso"
              inputMode="decimal"
              defaultValue={peso === null ? '' : porcentajeTexto(peso)}
              maxLength={6}
              autoComplete="off"
              required
              disabled={enviando}
            />
          </Campo>
          <Alerta error={error} />
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
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
            <Entrada id={`revision-pdf-${plano}`} name="archivo" type="file" accept="application/pdf,.pdf" required disabled={enviando} />
          </Campo>
          <Alerta error={error} />
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Subir revisión
            </Boton>
          </div>
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
          <Alerta error={error} />
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" variante="peligro" cargando={enviando}>
              Anular plano
            </Boton>
          </div>
        </form>
      </Ventana>
    </>
  )
}

/** El supervisor marca que recibió la revisión vigente. Un toque, sin ventana. */
export function RecibirPlano({ revision, numero }: { revision: string; numero: string }) {
  const { ejecutar, enviando, error } = useAccion(recibirPlano)
  return (
    <div className="space-y-1">
      <Boton
        type="button"
        tamano="sm"
        cargando={enviando}
        onClick={() => {
          const datos = new FormData()
          datos.set('revision', revision)
          ejecutar(datos)
        }}
        aria-label={`Marcar recibido el plano ${numero}`}
      >
        <Check aria-hidden className="size-4" />
        Recibido
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
  const { alEnviar, enviando, error } = useEnvio(guardarMaterial, (r) => {
    if (alTerminar) return alTerminar()
    setMensaje(r.mensaje ?? null)
    setMaterial('')
    setVuelta((v) => v + 1)
  })
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
        detalle={`${nombre} sale de la lista de materiales del código. Queda en el historial.${error ? ` ${error}` : ''}`}
        trabajando={enviando}
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

/** Las seis etapas de siempre, de un toque, para el código que no tiene ninguna. */
export function EtapasDeSiempre({ codigo }: { codigo: string }) {
  const { ejecutar, enviando, error } = useAccion(cargarEtapasDeSiempre)
  return (
    <div className="space-y-1">
      <Boton
        type="button"
        cargando={enviando}
        onClick={() => {
          const datos = new FormData()
          datos.set('codigo', codigo)
          ejecutar(datos)
        }}
      >
        <ListPlus aria-hidden className="size-4" />
        Cargar las etapas de siempre
      </Boton>
      <Alerta error={error} />
    </div>
  )
}

type EtapaEditable = { id: string; nombre: string; area_id: string | null; inicio_plan: string | null; fin_plan: string | null }

/** Agregar una etapa (al final) o corregir nombre, área y fechas (con `etapa`). */
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
  const { alEnviar, enviando, error } = useEnvio(guardarEtapa, (r) => {
    if (alTerminar) return alTerminar()
    setMensaje(r.mensaje ?? null)
    setVuelta((v) => v + 1)
  })
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
      <Campo etiqueta="La hace" htmlFor={`etapa-area-${id}`}>
        <Seleccion id={`etapa-area-${id}`} name="area" defaultValue={etapa?.area_id ?? ''} disabled={enviando}>
          <option value="">Ningún área del taller</option>
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
  const { ejecutar, enviando, error } = useAccion(moverEtapa)
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
        detalle={`«${nombre}» sale de las etapas del código, con sus fechas. Queda en el historial.${error ? ` ${error}` : ''}`}
        trabajando={enviando}
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
