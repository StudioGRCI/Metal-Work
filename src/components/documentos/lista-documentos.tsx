'use client'

import { useState } from 'react'
import { AlertTriangle, Download, FileText } from 'lucide-react'

import { FirmasDocumento, type FirmaVista, type Firmante } from '@/components/documentos/firmas-documento'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { fecha, fechaHora } from '@/lib/format'

import { urlDeDescarga } from '@/app/(app)/documentos/acciones'

type Documento = {
  id: string
  titulo: string
  descripcion: string | null
  numero_externo: string | null
  fecha_documento: string | null
  version_actual: number
  creado_en: string
  tipo: unknown
  creador: unknown
  orden?: unknown
}

const CATEGORIAS: Record<string, 'neutro' | 'info' | 'aviso' | 'exito' | 'acento'> = {
  TECNICO: 'info',
  COMERCIAL: 'acento',
  CALIDAD: 'aviso',
  LOGISTICO: 'neutro',
  ADMINISTRATIVO: 'neutro',
  LEGAL: 'exito',
  FOTOGRAFICO: 'neutro',
}

export function ListaDocumentos({
  documentos,
  versionesPorDocumento,
  vacio = 'Todavía no hay documentos adjuntos.',
  firmas = {},
  firmantes = [],
  usuarioId = '',
  puedePedirFirmas = false,
}: {
  documentos: Documento[]
  versionesPorDocumento: Record<string, { bucket: string; ruta_storage: string; nombre_archivo: string }>
  vacio?: string
  /** La cadena de firmas de cada documento, por identificador. */
  firmas?: Record<string, FirmaVista[]>
  firmantes?: Firmante[]
  usuarioId?: string
  puedePedirFirmas?: boolean
}) {
  const [error, setError] = useState<string | null>(null)
  const [descargando, setDescargando] = useState<string | null>(null)

  async function descargar(documentoId: string) {
    const version = versionesPorDocumento[documentoId]
    if (!version) {
      setError('Este documento no tiene ningún archivo cargado.')
      return
    }

    setError(null)
    setDescargando(documentoId)
    const resultado = await urlDeDescarga(version.bucket, version.ruta_storage, documentoId)
    setDescargando(null)

    if (!resultado.ok) {
      setError(resultado.error)
      return
    }
    // El enlace firmado caduca en cinco minutos; se abre en otra pestaña.
    window.open(resultado.url, '_blank', 'noopener,noreferrer')
  }

  if (documentos.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-texto-suave">{vacio}</p>
  }

  return (
    <>
      {error && (
        <p role="alert" className="mx-4 mt-3 rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
          {error}
        </p>
      )}

      <ul className="divide-y divide-[var(--borde)]">
        {documentos.map((d) => {
          const tipo = d.tipo as { nombre: string; categoria: string }
          const creador = d.creador as { nombres: string; apellidos: string } | null
          const version = versionesPorDocumento[d.id]

          return (
            <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <FileText aria-hidden className="size-5 shrink-0 text-texto-tenue" />

              <div className="min-w-40 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-texto">
                  {d.titulo}
                  <Insignia tono={CATEGORIAS[tipo.categoria] ?? 'neutro'}>{tipo.nombre}</Insignia>
                  {d.version_actual > 1 && (
                    <span className="text-[11px] text-texto-suave">v{d.version_actual}</span>
                  )}
                </p>
                <p className="text-[11px] text-texto-suave">
                  {d.numero_externo && `${d.numero_externo} · `}
                  {d.fecha_documento ? `${fecha(d.fecha_documento)} · ` : ''}
                  subido {fechaHora(d.creado_en)}
                  {creador && ` por ${creador.nombres} ${creador.apellidos}`}
                </p>
                {d.descripcion && (
                  <p className="mt-1 text-xs text-texto-suave">{d.descripcion}</p>
                )}
              </div>

              {version ? (
                <button
                  type="button"
                  onClick={() => descargar(d.id)}
                  disabled={descargando === d.id}
                  className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-base)] border border-borde px-3 text-xs text-texto hover:bg-superficie-2 disabled:opacity-50"
                >
                  <Download aria-hidden className="size-3.5" />
                  {descargando === d.id ? 'Generando…' : 'Descargar'}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] text-aviso">
                  <AlertTriangle aria-hidden className="size-3.5" />
                  sin archivo
                </span>
              )}

              <FirmasDocumento
                documentoId={d.id}
                firmas={firmas[d.id] ?? []}
                usuarioId={usuarioId}
                firmantes={firmantes}
                puedePedir={puedePedirFirmas}
                tieneArchivo={Boolean(version)}
              />
            </li>
          )
        })}
      </ul>
    </>
  )
}
