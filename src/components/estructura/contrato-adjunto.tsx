'use client'

import { FilePenLine, FileText } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo } from '@/components/ui/campos'
import { ElegirArchivo } from '@/components/ui/elegir-archivo'
import { EnvioAnterior } from '@/components/ui/envio-anterior'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import { subirContrato } from '@/lib/contratos'
import { ACEPTA_CONTRATO, MAXIMO_MB_CONTRATO, type ContratoAdjunto } from '@/lib/dominio/contratos'
import { useEnvio, useIdDelEnvio } from '@/lib/envio'
import { fecha } from '@/lib/format'

type Adjuntar = (datos: { id: string; ruta: string; nombre: string }) => Promise<ResultadoAccion>

/** El campo opcional del contrato en un formulario de alta: el archivo se sube después de registrar. */
export function CampoContrato({ id, disabled }: { id: string; disabled?: boolean }) {
  return (
    <Campo
      etiqueta="Contrato (opcional)"
      htmlFor={id}
      ayuda="El contrato firmado. Si todavía no lo tienes, adjúntalo después."
    >
      <ElegirArchivo id={id} name="contrato" accept={ACEPTA_CONTRATO} hastaMb={MAXIMO_MB_CONTRATO} disabled={disabled} />
    </Campo>
  )
}

/**
 * El archivo del campo «contrato», o null si no eligieron ninguno. Se saca del
 * FormData: a la acción no viaja. Uno elegido cuenta aunque pese 0 bytes, para
 * que `problemaDeContrato` lo diga en vez de registrar sin él.
 */
export function sacarContrato(datos: FormData): File | null {
  const archivo = datos.get('contrato')
  datos.delete('contrato')
  return archivo instanceof File && archivo.name !== '' ? archivo : null
}

/**
 * El contrato vigente (el último) con su enlace, y los anteriores debajo como
 * evidencia. Sin contrato, lo dice.
 */
export function ContratoVigente({ contratos, sinContrato }: { contratos: ContratoAdjunto[]; sinContrato?: string }) {
  const [vigente, ...anteriores] = contratos
  if (!vigente)
    return (
      <p className="text-sm text-texto-suave" data-sin-contrato>
        Sin contrato adjunto.{sinContrato && ` ${sinContrato}`}
      </p>
    )
  return (
    <div className="space-y-1" data-contrato>
      <EnlaceContrato c={vigente} texto={vigente.archivo_nombre ?? 'Contrato'} />
      <p className="text-xs text-texto-suave">
        Adjunto el {fecha(vigente.creado_en)}
        {vigente.subido_por && ` por ${vigente.subido_por}`}
      </p>
      {anteriores.length > 0 && (
        <details className="text-xs">
          <summary className="min-h-11 sm:min-h-9 cursor-pointer content-center text-texto-suave">
            {anteriores.length === 1 ? 'Una versión anterior' : `${anteriores.length} versiones anteriores`}
          </summary>
          <ul className="mt-1 space-y-1">
            {anteriores.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <EnlaceContrato c={c} texto={c.archivo_nombre ?? 'Contrato'} />
                <span className="text-texto-suave">{fecha(c.creado_en)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function EnlaceContrato({ c, texto }: { c: ContratoAdjunto; texto: string }) {
  if (!c.enlace) return <span className="text-xs text-texto-suave">{texto} (no se pudo abrir ahora)</span>
  return (
    <a
      href={c.enlace}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-11 sm:min-h-9 max-w-full items-center gap-1 rounded-lg border border-borde px-2 text-xs font-medium text-acento hover:bg-superficie-2"
    >
      <FileText aria-hidden className="size-3.5 flex-none" />
      <span className="truncate">{texto}</span>
    </a>
  )
}

/**
 * Adjuntar el contrato después, o una versión nueva encima (una adenda, el
 * firmado que reemplaza al borrador). `adjuntar` es la acción de servidor ya
 * atada al subcontrato. El id vive en el botón y no en el formulario, que se
 * rehace al abrir (`useIdDelEnvio`): tras «No llegó la respuesta», cancelar y
 * volver a abrir lleva el mismo, y la misma versión no entra dos veces; si
 * aquella entró, la ventana lo dice y la siguiente lleva otro.
 */
export function AdjuntarContrato({
  bucket,
  carpeta,
  numero,
  hay,
  adjuntar,
}: {
  bucket: string
  carpeta: string
  numero: string
  hay: boolean
  adjuntar: Adjuntar
}) {
  const [abierta, setAbierta] = useState(false)
  const [vez, setVez] = useState(0)
  const [aviso, setAviso] = useState<string | null>(null)
  const contrato = useIdDelEnvio('contrato_subcontrato')
  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        onClick={() => {
          setAviso(null)
          contrato.abrir()
          setVez((v) => v + 1)
          setAbierta(true)
        }}
        data-adjuntar-contrato
      >
        <FilePenLine aria-hidden className="size-4" />
        {hay ? 'Otra versión del contrato' : 'Adjuntar contrato'}
        <span className="sr-only"> de {numero}</span>
      </Boton>
      {aviso && (
        <p role="status" className="text-xs text-exito">
          {aviso}
        </p>
      )}
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={hay ? `Otra versión del contrato de ${numero}` : `Contrato de ${numero}`}
        descripcion={
          hay
            ? 'La nueva pasa a ser la vigente; la anterior queda debajo como evidencia.'
            : 'El contrato firmado. Si llega otra versión, se adjunta encima.'
        }
        ancho="md"
      >
        <EnvioAnterior texto={contrato.anterior} />
        {contrato.id && (
          <FormularioContrato
            key={vez}
            id={contrato.id}
            bucket={bucket}
            carpeta={carpeta}
            adjuntar={adjuntar}
            alSalir={contrato.salio}
            alYaEntrar={contrato.otro}
            alTerminar={(mensaje) => {
              setAbierta(false)
              contrato.otro()
              setAviso(mensaje)
            }}
            alCancelar={() => setAbierta(false)}
          />
        )}
      </Ventana>
    </>
  )
}

function FormularioContrato({
  id,
  bucket,
  carpeta,
  adjuntar,
  alSalir,
  alYaEntrar,
  alTerminar,
  alCancelar,
}: {
  /** Un reintento sube a la misma ruta y la base no duplica el contrato. */
  id: string
  bucket: string
  carpeta: string
  adjuntar: Adjuntar
  alSalir: () => void
  alYaEntrar: () => void
  alTerminar: (mensaje: string) => void
  alCancelar: () => void
}) {
  async function enviar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = sacarContrato(datos)
    if (!archivo) return { ok: false, error: 'Elige el archivo del contrato.' }
    alSalir()
    return subirContrato({ bucket, carpeta, id, archivo, adjuntar })
  }
  const { alEnviar, enviando, error } = useEnvio(enviar, (r) => alTerminar(r.mensaje ?? 'Contrato adjunto.'), { alYaEntrar })
  const campo = `contrato-${id.slice(0, 8)}`
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <Campo etiqueta="Contrato" htmlFor={campo} requerido>
        <ElegirArchivo id={campo} name="contrato" accept={ACEPTA_CONTRATO} hastaMb={MAXIMO_MB_CONTRATO} required />
      </Campo>
      {error && (
        <p role="alert" className="text-sm text-peligro">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Boton type="button" variante="contorno" onClick={alCancelar}>
          Cancelar
        </Boton>
        <Boton type="submit" cargando={enviando}>
          Adjuntar
        </Boton>
      </div>
    </form>
  )
}
