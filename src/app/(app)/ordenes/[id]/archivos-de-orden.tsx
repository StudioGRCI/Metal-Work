'use client'

import { FileSpreadsheet, FileText, FileUp, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'

import { BASE_BOTON, TAMANOS, VARIANTES } from '@/components/ui/boton'
import { Boton } from '@/components/ui/boton'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { subirAdjunto, MAXIMO_ADJUNTO_MB } from '@/lib/adjuntos'
import { useEnvio } from '@/lib/envio'
import { fecha as fmtFecha } from '@/lib/format'
import { cn } from '@/lib/utils'

import { quitarAdjunto } from './acciones-adjuntos'

export type AdjuntoEnPantalla = {
  id: string
  tipo: 'ORDEN' | 'CRONOGRAMA'
  nombre_archivo: string
  tamano_bytes: number | null
  creado_en: string
  url: string | null
  /** Si quien mira lo puede quitar: lo decide el servidor, igual que la política. */
  quitable: boolean
}

function tamano(bytes: number | null) {
  if (!bytes) return null
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * Los archivos de la orden (migración 099): el PDF de la orden de trabajo —el
 * de la oficina o el del cliente— para tenerlo a mano en el taller, y el Excel
 * del cronograma si se guardó al cargarlo. Es un lugar para el papel, no un
 * repositorio: lo que se reporta sigue siendo la hoja de cada área.
 */
export function ArchivosDeOrden({
  ordenId,
  adjuntos,
  puedeSubir,
}: {
  ordenId: string
  adjuntos: AdjuntoEnPantalla[]
  puedeSubir: boolean
}) {
  const router = useRouter()
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [, iniciar] = useTransition()
  const enCurso = useRef(false)

  async function subir(archivo: File | undefined) {
    if (!archivo || enCurso.current) return
    enCurso.current = true
    setSubiendo(true)
    setError(null)
    setAviso(null)
    try {
      const r = await subirAdjunto(ordenId, archivo, 'ORDEN')
      if (!r.ok) {
        setError(r.error)
        return
      }
      setAviso(r.mensaje ?? 'PDF guardado en la orden.')
      iniciar(() => router.refresh())
    } catch {
      setError('No se pudo guardar el archivo. Revisa la señal y vuelve a intentar.')
    } finally {
      enCurso.current = false
      setSubiendo(false)
    }
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Archivos de la orden"
        descripcion="El PDF de la orden de trabajo, de la oficina o del cliente, y el Excel del cronograma. Para tenerlos a mano en el taller."
        acciones={
          puedeSubir && (
            <label
              className={cn(
                BASE_BOTON,
                VARIANTES.secundario,
                TAMANOS.sm,
                'cursor-pointer',
                subiendo && 'pointer-events-none opacity-60',
              )}
            >
              <FileUp aria-hidden className="size-3.5" />
              {subiendo ? 'Subiendo…' : 'Subir PDF'}
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                disabled={subiendo}
                onChange={(e) => {
                  void subir(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
          )
        }
      />
      <TarjetaCuerpo className="space-y-3">
        {adjuntos.length === 0 ? (
          <p className="text-sm text-texto-suave">
            Todavía no hay archivos.{' '}
            {puedeSubir
              ? `Sube el PDF de la orden con el botón de arriba (hasta ${MAXIMO_ADJUNTO_MB} MB).`
              : 'Los sube la oficina o el supervisor.'}
          </p>
        ) : (
          <ul className="divide-y divide-borde">
            {adjuntos.map((a) => (
              <FilaAdjunto key={a.id} adjunto={a} ordenId={ordenId} />
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className="rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
            {error}
          </p>
        )}
        {aviso && (
          <p role="status" className="text-xs font-medium text-exito">
            {aviso}
          </p>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function FilaAdjunto({ adjunto: a, ordenId }: { adjunto: AdjuntoEnPantalla; ordenId: string }) {
  const [confirmando, setConfirmando] = useState(false)
  const { alEnviar, enviando, error, limpiar } = useEnvio(quitarAdjunto)
  const Icono = a.tipo === 'CRONOGRAMA' ? FileSpreadsheet : FileText

  return (
    <li className="space-y-2 py-2.5">
      <div className="flex items-center gap-3">
        <Icono aria-hidden className="size-5 shrink-0 text-texto-suave" />
        <div className="min-w-0 flex-1">
          {a.url ? (
            <a
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-sm font-medium text-acento hover:underline"
            >
              {a.nombre_archivo}
            </a>
          ) : (
            <p className="truncate text-sm font-medium text-texto">{a.nombre_archivo}</p>
          )}
          <p className="text-[11px] text-texto-suave">
            {[a.tipo === 'CRONOGRAMA' ? 'Cronograma' : 'Orden de trabajo', tamano(a.tamano_bytes), fmtFecha(a.creado_en)]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        {a.quitable && !confirmando && (
          <Boton
            type="button"
            variante="fantasma"
            tamano="icono"
            aria-label={`Quitar ${a.nombre_archivo}`}
            onClick={() => {
              limpiar()
              setConfirmando(true)
            }}
          >
            <Trash2 aria-hidden className="size-4 text-peligro" />
          </Boton>
        )}
      </div>

      {confirmando && (
        <form
          onSubmit={alEnviar}
          className="flex flex-wrap items-center gap-2 rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2"
        >
          <input type="hidden" name="id" value={a.id} />
          <input type="hidden" name="orden_id" value={ordenId} />
          <span className="text-xs text-peligro">¿Quitar este archivo de la orden?</span>
          <Boton type="submit" tamano="sm" variante="peligro" cargando={enviando}>
            Sí, quitar
          </Boton>
          <Boton type="button" tamano="sm" variante="fantasma" onClick={() => setConfirmando(false)}>
            No
          </Boton>
          {error && <p role="alert" className="w-full text-xs font-medium text-peligro">{error}</p>}
        </form>
      )}
    </li>
  )
}
