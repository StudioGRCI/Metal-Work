'use client'

import { FilePenLine, FileText } from 'lucide-react'
import { useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import type { ResultadoAccion } from '@/lib/acciones'
import { subirContrato } from '@/lib/contratos'
import { ACEPTA_CONTRATO, MAXIMO_MB_CONTRATO, type ContratoAdjunto } from '@/lib/dominio/contratos'
import { useEnvio } from '@/lib/envio'
import { fecha } from '@/lib/format'

type Adjuntar = (datos: { id: string; ruta: string; nombre: string }) => Promise<ResultadoAccion>

/** El campo opcional del contrato en un formulario de alta: el archivo se sube después de registrar. */
export function CampoContrato({ id }: { id: string }) {
  return (
    <Campo
      etiqueta="Contrato (opcional)"
      htmlFor={id}
      ayuda={`El contrato firmado, en PDF o foto, hasta ${MAXIMO_MB_CONTRATO} MB. Si todavía no lo tienes, adjúntalo después.`}
    >
      <Entrada id={id} name="contrato" type="file" accept={ACEPTA_CONTRATO} />
    </Campo>
  )
}

/** El archivo del campo «contrato», o null si no eligieron ninguno. Se saca del FormData: a la acción no viaja. */
export function sacarContrato(datos: FormData): File | null {
  const archivo = datos.get('contrato')
  datos.delete('contrato')
  return archivo instanceof File && archivo.size > 0 ? archivo : null
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
 * atada al subcontrato.
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
  return (
    <>
      <Boton
        type="button"
        variante="contorno"
        tamano="sm"
        onClick={() => {
          setAviso(null)
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
        <FormularioContrato
          key={vez}
          bucket={bucket}
          carpeta={carpeta}
          adjuntar={adjuntar}
          alTerminar={(mensaje) => {
            setAbierta(false)
            setAviso(mensaje)
          }}
          alCancelar={() => setAbierta(false)}
        />
      </Ventana>
    </>
  )
}

function FormularioContrato({
  bucket,
  carpeta,
  adjuntar,
  alTerminar,
  alCancelar,
}: {
  bucket: string
  carpeta: string
  adjuntar: Adjuntar
  alTerminar: (mensaje: string) => void
  alCancelar: () => void
}) {
  // Decidido aquí: un reintento sube a la misma ruta y la base no duplica el contrato.
  const [id] = useState(() => crypto.randomUUID())
  async function enviar(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
    const archivo = sacarContrato(datos)
    if (!archivo) return { ok: false, error: 'Elige el archivo del contrato.' }
    return subirContrato({ bucket, carpeta, id, archivo, adjuntar })
  }
  const { alEnviar, enviando, error } = useEnvio(enviar, (r) => alTerminar(r.mensaje ?? 'Contrato adjunto.'))
  const campo = `contrato-${id.slice(0, 8)}`
  return (
    <form onSubmit={alEnviar} className="space-y-4">
      <Campo etiqueta="Contrato" htmlFor={campo} requerido ayuda={`PDF o foto, hasta ${MAXIMO_MB_CONTRATO} MB.`}>
        <Entrada id={campo} name="contrato" type="file" accept={ACEPTA_CONTRATO} required />
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
