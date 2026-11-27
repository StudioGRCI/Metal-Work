'use client'

import { FileCheck2, FileUp, NotebookPen, Undo2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { ElegirArchivo, revisarArchivo } from '@/components/ui/elegir-archivo'
import { EnvioAnterior } from '@/components/ui/envio-anterior'
import { PieDeVentana } from '@/components/ui/pie-de-ventana'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import { subirArchivoTramite } from '@/lib/archivos-tramites'
import type { Tramite } from '@/lib/datos/tramites'
import { CLASE_DE_ARCHIVO, CLASES_QUE_SE_SUBEN, MAXIMO_MB_TRAMITES } from '@/lib/dominio/tramites'
import { refrescarSiEsDeLaPestana, useEnvio, useIdDelEnvio } from '@/lib/envio'
import { fecha } from '@/lib/format'

import { adjuntarArchivo, anotarGestion, concluirTramite, retirarArchivo } from '../acciones'
import { AccionDelTramite, OPCION, RADIO, sinCorte, useAvisoDeLaFicha, type DondeAvisa } from './controles'

/*
 * El expediente del trámite (entrega 2, migración 20261127002000): subir sus
 * archivos, cerrarlo con el documento final, anotar sus gestiones y retirar lo
 * que se subió por error. Cada ventana lleva su id fuera del formulario que se
 * rehace al abrir (`useIdDelEnvio`): tras «No llegó la respuesta», cerrar y
 * volver a abrir manda el mismo, y la base no lo guarda dos veces.
 */

const ACEPTA = 'application/pdf,image/jpeg,image/png,image/webp'

/**
 * Lo que el campo ya avisó, dicho otra vez al enviar: un Word con el nombre
 * cambiado a «.pdf» pasa por el tipo y después no lo abre nadie, y el documento
 * final es la prueba del cierre.
 */
async function noSirve(archivo: File): Promise<string | null> {
  const aviso = await revisarArchivo(archivo, ACEPTA, MAXIMO_MB_TRAMITES)
  return aviso ? `El archivo no sirve. ${aviso.replace(/: toca para elegir otro$/, '')}: elige otro.` : null
}

/** El archivo del campo, o `null` si no eligieron ninguno. Se saca del FormData: a la acción viaja solo su ruta. */
function sacarArchivo(datos: FormData): File | null {
  const archivo = datos.get('archivo')
  datos.delete('archivo')
  // Uno vacío también cuenta como elegido: lo rechaza la subida diciendo que está vacío.
  return archivo instanceof File && archivo.name !== '' ? archivo : null
}

/** Un día después, en `AAAA-MM-DD`: la vigencia termina después de la fecha del documento. */
function diaSiguiente(dia: string): string | undefined {
  const d = new Date(`${dia}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return undefined
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Diez años después: el tope de la vigencia, el mismo de la base. Un año mal tecleado no entra. */
function diezAnosDespues(dia: string): string | undefined {
  const d = new Date(`${dia}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return undefined
  d.setUTCFullYear(d.getUTCFullYear() + 10)
  return d.toISOString().slice(0, 10)
}

/** El botón y su ventana, con el id del envío fuera del formulario y el verde junto al botón al salir bien. */
function VentanaDelExpediente({
  clave,
  donde,
  avisa,
  marca,
  boton,
  titulo,
  descripcion,
  children,
}: {
  clave: 'archivo_tramite' | 'gestion_tramite'
  /** Dónde se dice el verde: en el encabezado o en la tarjeta del botón. */
  avisa: DondeAvisa
  /** Dónde se guarda lo pendiente: cada botón de cada trámite, el suyo. */
  donde: string
  marca: string
  boton: React.ReactNode
  titulo: string
  descripcion: string
  children: (ventana: { envio: ReturnType<typeof useIdDelEnvio>; alCancelar: () => void; alTerminar: (mensaje: string) => void }) => React.ReactNode
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const setAviso = useAvisoDeLaFicha(avisa)
  const router = useRouter()
  const envio = useIdDelEnvio(clave, () => refrescarSiEsDeLaPestana(router), donde)
  return (
    <>
      <Boton
        type="button"
        variante="secundario"
        data-accion={marca}
        onClick={() => {
          setAviso(null)
          envio.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
      >
        {boton}
      </Boton>
      <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo={titulo} descripcion={descripcion} ancho="md">
        <EnvioAnterior texto={envio.anterior} />
        {envio.id && (
          // Con otro id, otro formulario: lo escrito para el que ya entró no se arrastra.
          <div key={`${vez}:${envio.id}`}>
            {children({
              envio,
              alCancelar: () => setAbierta(false),
              alTerminar: (mensaje) => {
                setAbierta(false)
                setAviso(mensaje)
              },
            })}
          </div>
        )}
      </Ventana>
    </>
  )
}

type DeLaVentana = { envio: ReturnType<typeof useIdDelEnvio>; alCancelar: () => void; alTerminar: (mensaje: string) => void }

/** Quien lleva el trámite sube el cargo, un recibo u otro documento. */
export function SubirArchivo({ tramiteId, numero }: { tramiteId: string; numero: string }) {
  return (
    <VentanaDelExpediente
      clave="archivo_tramite"
      donde={tramiteId}
      avisa="expediente"
      marca="subir-archivo"
      boton={
        <>
          <FileUp aria-hidden className="size-4" />
          Subir archivo
        </>
      }
      titulo={`Subir un archivo al trámite ${sinCorte(numero)}`}
      descripcion="El cargo de presentación, un recibo u otro documento. Lo que entrega la entidad al final se sube con «Cerrar con el documento final»."
    >
      {(ventana) => <FormularioArchivo tramiteId={tramiteId} {...ventana} />}
    </VentanaDelExpediente>
  )
}

function FormularioArchivo({ tramiteId, envio, alCancelar, alTerminar }: { tramiteId: string } & DeLaVentana) {
  const id = envio.id ?? ''
  const [clase, setClase] = useState<string>('CARGO')
  const otro = clase === 'OTRO'
  async function subir(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = sacarArchivo(datos)
    if (!archivo) return { ok: false, error: 'Adjunta el archivo.' }
    const aviso = await noSirve(archivo)
    if (aviso) return { ok: false, error: aviso }
    datos.set('nombre', archivo.name)
    envio.salio()
    return subirArchivoTramite(tramiteId, archivo, (ruta) => {
      datos.set('ruta', ruta)
      return adjuntarArchivo(null, datos)
    })
  }
  const { alEnviar, enviando, error } = useEnvio(
    subir,
    (r) => {
      envio.otro()
      alTerminar(r.mensaje ?? 'Archivo guardado en el expediente.')
    },
    { alYaEntrar: envio.otro },
  )
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="tramite_id" value={tramiteId} />
      <fieldset disabled={enviando} className="min-w-0 space-y-4">
        <fieldset className="space-y-2">
          <legend className="mb-2 text-xs font-medium text-texto-suave">
            Qué es<span className="ml-0.5 text-peligro">*</span>
          </legend>
          <div className="grid gap-2">
            {CLASES_QUE_SE_SUBEN.map((valor) => (
              <label key={valor} className={OPCION}>
                <input type="radio" name="clase" value={valor} required checked={clase === valor} onChange={() => setClase(valor)} className={RADIO} />
                <span>
                  <span className="font-medium">{CLASE_DE_ARCHIVO[valor].etiqueta}</span>
                  <span className="block text-xs text-texto-suave">{CLASE_DE_ARCHIVO[valor].descripcion}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Campo
          etiqueta={otro ? 'Qué documento es' : 'Descripción'}
          htmlFor={`archivo-descripcion-${id}`}
          requerido={otro}
          ayuda={otro ? undefined : 'Opcional: lo que ayude a reconocerlo.'}
          ayudaEnIcono={false}
        >
          <Entrada
            id={`archivo-descripcion-${id}`}
            name="descripcion"
            required={otro}
            minLength={3}
            maxLength={200}
            autoComplete="off"
            placeholder={otro ? 'Por ejemplo: esquela de observación' : undefined}
          />
        </Campo>
        <Campo etiqueta="Archivo" htmlFor={`archivo-archivo-${id}`} requerido>
          <ElegirArchivo id={`archivo-archivo-${id}`} name="archivo" accept={ACEPTA} hastaMb={MAXIMO_MB_TRAMITES} required />
        </Campo>
      </fieldset>
      <PieDeVentana error={error} enviando={enviando} alCancelar={alCancelar} texto="Guardar en el expediente" />
    </form>
  )
}

/** Quien lleva el trámite lo cierra al subir lo que entregó la entidad. */
export function CerrarTramite({ tramite: t, hoy }: { tramite: Tramite; hoy: string }) {
  return (
    <VentanaDelExpediente
      clave="archivo_tramite"
      donde={`cierre:${t.id}`}
      avisa="ficha"
      marca="cerrar"
      boton={
        <>
          <FileCheck2 aria-hidden className="size-4" />
          Cerrar con el documento final
        </>
      }
      titulo={`Cerrar el trámite ${sinCorte(t.numero)}`}
      descripcion="Sube lo que entregó la entidad. Con el documento en el expediente el trámite queda concluido; no pasa por Gerencia."
    >
      {(ventana) => <FormularioCierre tramite={t} hoy={hoy} {...ventana} />}
    </VentanaDelExpediente>
  )
}

function FormularioCierre({ tramite: t, hoy, envio, alCancelar, alTerminar }: { tramite: Tramite; hoy: string } & DeLaVentana) {
  const id = envio.id ?? ''
  const [dia, setDia] = useState(hoy)
  async function subir(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = sacarArchivo(datos)
    if (!archivo) return { ok: false, error: 'Adjunta el documento final.' }
    const aviso = await noSirve(archivo)
    if (aviso) return { ok: false, error: aviso }
    datos.set('nombre', archivo.name)
    envio.salio()
    return subirArchivoTramite(t.id, archivo, (ruta) => {
      datos.set('ruta', ruta)
      return concluirTramite(null, datos)
    })
  }
  const { alEnviar, enviando, error } = useEnvio(
    subir,
    (r) => {
      envio.otro()
      alTerminar(r.mensaje ?? 'Trámite concluido.')
    },
    { alYaEntrar: envio.otro },
  )
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="tramite_id" value={t.id} />
      <fieldset disabled={enviando} className="min-w-0 space-y-4">
        {t.estado === 'OBSERVADO' && (
          <p className="rounded-[var(--radius-base)] border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto" data-cierra-observado>
            Figura «Observado». Ciérralo solo si la entidad ya levantó la observación y entregó el documento.
          </p>
        )}
        {/* Dos columnas solo si hay dos campos: con uno, su ayuda se partía en media ventana. */}
        <div className={t.se_renueva ? 'grid gap-4 sm:grid-cols-2' : 'grid gap-4'}>
          <Campo
            etiqueta="Fecha del documento"
            htmlFor={`cierre-fecha-${id}`}
            requerido
            ayuda={t.fecha_inicio ? `Del ${fecha(t.fecha_inicio)}, cuando se presentó, a hoy.` : undefined}
            ayudaEnIcono={false}
          >
            <Entrada
              id={`cierre-fecha-${id}`}
              name="fecha"
              type="date"
              required
              min={t.fecha_inicio ?? undefined}
              max={hoy}
              value={dia}
              onChange={(e) => setDia(e.target.value)}
              className={t.se_renueva ? 'tabular' : 'tabular sm:max-w-48'}
            />
          </Campo>
          {t.se_renueva && (
            <Campo etiqueta="Vigente hasta" htmlFor={`cierre-vigencia-${id}`} requerido ayuda="Hasta cuándo vale: se renueva antes de esa fecha." ayudaEnIcono={false}>
              <Entrada
                id={`cierre-vigencia-${id}`}
                name="vigente_hasta"
                type="date"
                required
                min={diaSiguiente(dia)}
                max={diezAnosDespues(dia)}
                className="tabular"
              />
            </Campo>
          )}
        </div>
        <Campo etiqueta="Documento final" htmlFor={`cierre-archivo-${id}`} requerido ayuda={`${t.tipo}: lo que entregó ${t.entidad}.`} ayudaEnIcono={false}>
          <ElegirArchivo id={`cierre-archivo-${id}`} name="archivo" accept={ACEPTA} hastaMb={MAXIMO_MB_TRAMITES} required />
        </Campo>
      </fieldset>
      <PieDeVentana error={error} enviando={enviando} alCancelar={alCancelar} texto="Cerrar el trámite" />
    </form>
  )
}

/** Quien lleva el trámite anota una gestión, con su fecha. */
export function AnotarGestion({ tramiteId, numero, hoy }: { tramiteId: string; numero: string; hoy: string }) {
  return (
    <VentanaDelExpediente
      clave="gestion_tramite"
      donde={tramiteId}
      avisa="gestiones"
      marca="anotar-gestion"
      boton={
        <>
          <NotebookPen aria-hidden className="size-4" />
          Anotar gestión
        </>
      }
      titulo={`Anotar una gestión del trámite ${sinCorte(numero)}`}
      descripcion="Una ida a la entidad, una llamada, una entrega. Queda en la bitácora con su fecha y tu nombre; lo anotado no se corrige: si algo quedó mal, anota otra que lo aclare."
    >
      {(ventana) => <FormularioGestion tramiteId={tramiteId} hoy={hoy} {...ventana} />}
    </VentanaDelExpediente>
  )
}

function FormularioGestion({ tramiteId, hoy, envio, alCancelar, alTerminar }: { tramiteId: string; hoy: string } & DeLaVentana) {
  const id = envio.id ?? ''
  const { alEnviar, enviando, error } = useEnvio(
    (previo: unknown, datos: FormData) => {
      envio.salio()
      return anotarGestion(previo, datos)
    },
    (r) => {
      envio.otro()
      alTerminar(r.mensaje ?? 'Gestión anotada.')
    },
    { alYaEntrar: envio.otro },
  )
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="tramite_id" value={tramiteId} />
      <fieldset disabled={enviando} className="min-w-0 space-y-4">
        <Campo etiqueta="Fecha" htmlFor={`gestion-fecha-${id}`} requerido>
          <Entrada id={`gestion-fecha-${id}`} name="fecha" type="date" required max={hoy} defaultValue={hoy} className="tabular sm:max-w-48" />
        </Campo>
        <Campo etiqueta="Qué se hizo" htmlFor={`gestion-detalle-${id}`} requerido ayuda="De 5 a 500 caracteres." ayudaEnIcono={false}>
          <AreaTexto
            id={`gestion-detalle-${id}`}
            name="detalle"
            required
            minLength={5}
            maxLength={500}
            rows={3}
            placeholder="Por ejemplo: se dejó el expediente en mesa de partes; responden en 7 días hábiles."
          />
        </Campo>
      </fieldset>
      <PieDeVentana error={error} enviando={enviando} alCancelar={alCancelar} texto="Anotar la gestión" />
    </form>
  )
}

/** Quien lleva el trámite retira un archivo subido por error: no se borra, queda con su motivo. */
export function RetirarArchivo({
  id,
  nombre,
  esElFinal,
}: {
  id: string
  /** Cómo se lee el archivo en la lista: va en el título y en el nombre del botón. */
  nombre: string
  /** El documento final en pie de un trámite concluido: retirarlo lo reabre. */
  esElFinal: boolean
}) {
  return (
    <AccionDelTramite
      id={id}
      accion={retirarArchivo}
      variante="fantasma"
      tamano="sm"
      etiqueta={`Retirar ${nombre}`}
      envioPeligroso
      avisa="expediente"
      marca="retirar-archivo"
      boton={
        <>
          <Undo2 aria-hidden className="size-4" />
          Retirar
        </>
      }
      titulo={`Retirar ${nombre}`}
      descripcion={
        esElFinal
          ? 'Para un documento final subido por error. No se borra: queda en el expediente como retirado, con tu motivo. El trámite se reabre y vuelve a «En trámite» hasta que subas el correcto.'
          : 'Para un archivo subido por error. No se borra: queda en el expediente como retirado, con tu motivo.'
      }
      enviar={esElFinal ? 'Retirar y reabrir el trámite' : 'Retirar el archivo'}
    >
      {() => (
        <Campo etiqueta="Por qué se retira" htmlFor={`retirar-${id}`} requerido ayuda="Al menos 10 caracteres." ayudaEnIcono={false}>
          <AreaTexto id={`retirar-${id}`} name="motivo" required minLength={10} maxLength={500} rows={3} placeholder="Por ejemplo: es el cargo de otro trámite." />
        </Campo>
      )}
    </AccionDelTramite>
  )
}
