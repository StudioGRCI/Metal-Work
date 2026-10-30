'use client'

import { FileSpreadsheet, FileText, RefreshCw, Trash2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from 'react'

import { Boton } from '@/components/ui/boton'
import { ElegirArchivo, revisarArchivo } from '@/components/ui/elegir-archivo'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { subirAdjunto, MAXIMO_ADJUNTO_MB } from '@/lib/adjuntos'
import { laPestanaEsDeOtraCuenta, mientrasSeEnvia, OtraCuentaEnLaPestana, refrescarSiEsDeLaPestana, useEnvio } from '@/lib/envio'
import { fechaHora } from '@/lib/format'
import { NO_QUEDO_SIN_RESPUESTA } from '@/lib/subida-privada'

import { quitarAdjunto } from './acciones-adjuntos'

const NO_SUBIO_OTRA_CUENTA = 'No se subió: en otra pestaña entró otra cuenta. Cuando vuelva la tuya, elígelo otra vez.'

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
 * La orden de trabajo en papel (migración 099): el PDF —el de la oficina o el
 * del cliente— para tenerlo a mano en el taller, y el Excel del cronograma si
 * se guardó al cargarlo. Es un lugar para el papel, no un repositorio: lo que
 * se reporta sigue siendo la hoja de cada área.
 *
 * Debajo van las observaciones de la orden (`children`): un error que alguien
 * encontró en la orden se lee junto al documento que lo tiene (pedido de la
 * empresa, 2026-10-01).
 */
export function ArchivosDeOrden({
  ordenId,
  adjuntos,
  puedeSubir,
  tienePdf,
  children,
}: {
  ordenId: string
  adjuntos: AdjuntoEnPantalla[]
  puedeSubir: boolean
  /** Si la orden ya tiene su PDF, aunque este puesto no lo abra (`orden_tiene_pdf`). */
  tienePdf: boolean
  children?: ReactNode
}) {
  const router = useRouter()
  const [subiendo, setSubiendo] = useState(false)
  // El PDF que se está subiendo, o el que no entró y por qué: se ven en su campo.
  const [elegido, setElegido] = useState<File | null>(null)
  const [avisoSubida, setAvisoSubida] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [, iniciar] = useTransition()
  const enCurso = useRef(false)
  // El PDF está pero este puesto no lo abre: se dice que está y no se ofrece subir otro.
  const pdfOculto = tienePdf && !adjuntos.some((a) => a.tipo === 'ORDEN')
  const sube = puedeSubir && !pdfOculto
  // Con el PDF ya puesto, el campo vacío parecía decir que faltaba: se abre con
  // «Cambiar el PDF», en la cabecera, como lo demás que ya existe y se corrige.
  const tieneOrden = adjuntos.some((a) => a.tipo === 'ORDEN')
  const [cambiando, setCambiando] = useState(false)
  const pide = sube && (!tieneOrden || cambiando || Boolean(elegido))
  const textoCampo = tieneOrden ? 'Subir el PDF corregido' : 'Subir el PDF de la orden'
  // Subir el corregido no quita el anterior (el último PDF lo cuida la base):
  // con dos, el más nuevo es el que vale y se dice que el otro hay que quitarlo.
  const pdfs = adjuntos.filter((a) => a.tipo === 'ORDEN')
  const vigente = pdfs.length > 1 ? pdfs.reduce((a, b) => (b.creado_en > a.creado_en ? b : a)) : null
  const anteriores = vigente
    ? pdfs.filter((a) => a.id !== vigente.id).sort((a, b) => b.creado_en.localeCompare(a.creado_en))
    : []
  // Primero el PDF de la orden, el vigente arriba; el Excel del cronograma, que
  // se guarda después, quedaba encima en la tarjeta que se llama «Orden de trabajo».
  const lista = [...pdfs].sort((a, b) => b.creado_en.localeCompare(a.creado_en)).concat(adjuntos.filter((a) => a.tipo !== 'ORDEN'))

  // El foco no se pierde al abrir o cerrar el campo: va al campo al abrirlo y
  // vuelve a «Cambiar el PDF» al cerrarlo o al terminar la subida.
  const campo = useRef<HTMLInputElement>(null)
  const botonCambiar = useRef<HTMLButtonElement>(null)
  const zona = useRef<HTMLDivElement>(null)
  const focoA = useRef<'campo' | 'boton' | null>(null)
  useEffect(() => {
    const quien = focoA.current
    const destino = quien === 'campo' ? campo.current : quien === 'boton' ? botonCambiar.current : null
    if (!destino) return
    focoA.current = null
    // Al volver, solo si el foco se quedó sin lugar: no se le quita a otra cosa.
    const activo = document.activeElement
    if (quien === 'boton' && activo && activo !== document.body && activo !== campo.current) return
    destino.focus()
    // En el teléfono el campo se abre debajo de la barra de abajo: se trae al centro.
    destino.scrollIntoView({ block: quien === 'campo' ? 'center' : 'nearest' })
  }, [pide])

  // La fila quitada se va con el refresco y el foco caía al <body>. Con la
  // hora: el que queda suele llamarse igual que el quitado.
  function alQuitar(quitado: AdjuntoEnPantalla, quedaria?: AdjuntoEnPantalla) {
    const vale = quedaria ? `; vuelve a valer el del ${fechaHora(quedaria.creado_en)}` : ''
    setAviso(`Se quitó ${quitado.nombre_archivo}, del ${fechaHora(quitado.creado_en)}${vale}`.replace(/\.?$/, '.'))
    ;(botonCambiar.current ?? zona.current)?.focus()
  }

  async function subir(archivo: File | undefined) {
    if (!archivo || enCurso.current) return
    setError(null)
    setAviso(null)
    // Se sube apenas se elige: el que no es un PDF de verdad o pasa del tope no sale.
    const noSirve = await revisarArchivo(archivo, 'application/pdf,.pdf', MAXIMO_ADJUNTO_MB)
    setElegido(archivo)
    setAvisoSubida(noSirve)
    if (noSirve) return
    // Se sube al elegirlo, sin pasar por `useAccion`: se mira la sesión aquí. El
    // selector de archivos pudo quedar abierto mientras entraba otra cuenta.
    if (laPestanaEsDeOtraCuenta()) return setAvisoSubida(NO_SUBIO_OTRA_CUENTA)
    enCurso.current = true
    setSubiendo(true)
    // Como en `useAccion`: «Volver a cargar», el del aviso de arriba tras un
    // despliegue, espera a que el PDF suba y quede anotado, y si no entró no
    // recarga encima de su aviso. Recargaba a los 180 ms: la subida quedaba
    // cortada o el PDF suelto, y al cambiarlo seguía el de antes sin que nada
    // lo dijera (C, H5 y R1 de la trigesimocuarta pasada).
    await mientrasSeEnvia(async (entro) => {
      try {
        const r = await subirAdjunto(ordenId, archivo, 'ORDEN')
        if (!r.ok) {
          // En la caja del campo se dice cómo volver a intentar, como los demás avisos.
          setAvisoSubida(r.error === NO_QUEDO_SIN_RESPUESTA ? 'No quedó, no llegó la respuesta: toca para elegirlo otra vez' : r.error)
          return
        }
        entro()
        setElegido(null)
        setCambiando(false)
        focoA.current = 'boton'
        // Qué falta quitar lo dice la nota de abajo, que se queda mientras haya dos.
        setAviso(tieneOrden ? 'PDF corregido guardado.' : (r.mensaje ?? 'PDF guardado en la orden.'))
        iniciar(() => refrescarSiEsDeLaPestana(router))
      } catch (e) {
        setAvisoSubida(e instanceof OtraCuentaEnLaPestana ? NO_SUBIO_OTRA_CUENTA : 'No se pudo guardar. Revisa la señal y vuelve a elegirlo.')
      } finally {
        enCurso.current = false
        setSubiendo(false)
      }
    })
  }

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Orden de trabajo"
        ayuda="El PDF de la orden para tenerlo a mano en el taller, y lo que alguien encontró mal en ella."
        acciones={
          sube &&
          !pide && (
            <Boton
              ref={botonCambiar}
              variante="secundario"
              tamano="sm"
              onClick={() => {
                focoA.current = 'campo'
                setCambiando(true)
              }}
            >
              <RefreshCw aria-hidden className="size-3.5" />
              Cambiar el PDF
            </Boton>
          )
        }
      />
      <TarjetaCuerpo className="space-y-4">
        {pdfOculto && (
          <p className="text-sm text-texto" data-pdf-oculto>
            La orden tiene su PDF. Lo abren Diseño y Supervisión de Producción, Maestranza y Acabados.
          </p>
        )}
        <div ref={zona} tabIndex={-1} className="outline-none">
          {pdfOculto && adjuntos.length === 0 ? null : adjuntos.length === 0 ? (
            <p className="text-sm text-texto-suave">
              Todavía no se subió el PDF de la orden.{!sube && ' Lo sube la oficina o el supervisor.'}
            </p>
          ) : (
            <ul className="divide-y divide-borde">
              {lista.map((a) => (
                <FilaAdjunto
                  key={a.id}
                  adjunto={a}
                  ordenId={ordenId}
                  // Si se quita el vigente, vale el anterior más nuevo: se dice antes de confirmar.
                  quedaria={a.id === vigente?.id ? anteriores[0] : undefined}
                  alQuedarArchivo={setError}
                  alQuitar={alQuitar}
                />
              ))}
            </ul>
          )}
        </div>
        {pide && (
          <div className="space-y-1.5">
            {/* Se guarda en la orden apenas se elige, por eso dice «Subir». */}
            <ElegirArchivo
              ref={campo}
              id={`subir-pdf-${ordenId}`}
              aria-label={textoCampo}
              accept="application/pdf,.pdf"
              texto={textoCampo}
              hastaMb={MAXIMO_ADJUNTO_MB}
              archivo={elegido}
              aviso={avisoSubida}
              estado={subiendo ? 'Subiendo…' : null}
              disabled={subiendo}
              onChange={(e) => void subir(e.target.files?.[0])}
            />
            {tieneOrden && !subiendo && (
              <Boton
                variante="fantasma"
                tamano="sm"
                onClick={() => {
                  focoA.current = 'boton'
                  setCambiando(false)
                  setElegido(null)
                  setAvisoSubida(null)
                }}
              >
                No cambiarlo
              </Boton>
            )}
          </div>
        )}
        {/* El último PDF no se quita (lo cuida la base): se dice cómo se cambia
            mientras se cambia, y cuál falta quitar mientras haya dos. */}
        {pide && tieneOrden && (
          <p className="text-xs text-texto-suave">Sube el correcto; después quita el anterior de la lista.</p>
        )}
        {anteriores.some((a) => a.quitable) && (
          <p className="text-xs font-medium text-aviso wrap-anywhere">
            {/* Por la hora y no solo el nombre: el corregido suele salir con el mismo nombre. */}
            Vale el marcado «Vigente». Quita{' '}
            {anteriores.length === 1
              ? `el anterior (${anteriores[0].nombre_archivo}, del ${fechaHora(anteriores[0].creado_en)})`
              : 'los anteriores, los que no dicen «Vigente»,'}{' '}
            para que el taller no abra el viejo.
          </p>
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

        {children && <div className="border-t border-borde pt-4">{children}</div>}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function FilaAdjunto({
  adjunto: a,
  ordenId,
  quedaria,
  alQuedarArchivo,
  alQuitar,
}: {
  adjunto: AdjuntoEnPantalla
  ordenId: string
  /** Si es el PDF vigente de varios: el que vale si se quita este. */
  quedaria?: AdjuntoEnPantalla
  // La fila se va con el refresco: el aviso de que el archivo quedó guardado
  // lo muestra la tarjeta, que se queda.
  alQuedarArchivo: (mensaje: string) => void
  alQuitar: (quitado: AdjuntoEnPantalla, quedaria?: AdjuntoEnPantalla) => void
}) {
  const [confirmando, setConfirmando] = useState(false)
  const { alEnviar, enviando, error, limpiar } = useEnvio(quitarAdjunto, (r) => {
    if (r.datos?.archivoQuedo && r.mensaje) alQuedarArchivo(r.mensaje)
    alQuitar(a, quedaria)
  })
  // Al abrir la pregunta, el foco va a «No», que es lo seguro, y la pregunta se
  // lee con él; al decir que no, vuelve al tacho. Antes caía al <body>.
  const tacho = useRef<HTMLButtonElement>(null)
  const botonNo = useRef<HTMLButtonElement>(null)
  const volverAlTacho = useRef(false)
  const idPregunta = useId()
  useEffect(() => {
    if (confirmando) botonNo.current?.focus()
    else if (volverAlTacho.current) {
      volverAlTacho.current = false
      tacho.current?.focus()
    }
  }, [confirmando])
  const Icono = a.tipo === 'CRONOGRAMA' ? FileSpreadsheet : FileText
  const vigente = Boolean(quedaria)
  const cuando = fechaHora(a.creado_en)

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
          <p className="flex flex-wrap items-center gap-x-1.5 text-[11px] text-texto-suave">
            {[a.tipo === 'CRONOGRAMA' ? 'Cronograma' : 'Orden de trabajo', tamano(a.tamano_bytes)].filter(Boolean).join(' · ')}
            {/* Con la hora: dos PDF del mismo día se veían iguales. Entera, sin partir «p. m.». */}
            <span className="whitespace-nowrap">· {cuando}</span>
            {vigente && <Insignia tono="exito">Vigente</Insignia>}
          </p>
        </div>
        {a.quitable && !confirmando && (
          <Boton
            ref={tacho}
            type="button"
            variante="fantasma"
            tamano="icono"
            aria-label={`Quitar ${a.nombre_archivo}, del ${cuando}${vigente ? ', el vigente' : ''}`}
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
          <span id={idPregunta} className="text-xs text-peligro">
            {/* La hora termina en «p. m.»: ese punto cierra también la frase. */}
            {quedaria
              ? `Es el vigente: si lo quitas, vuelve a valer el del ${fechaHora(quedaria.creado_en).replace(/\.?$/, '.')} ¿Quitarlo igual?`
              : '¿Quitar este archivo de la orden?'}
          </span>
          <Boton type="submit" tamano="sm" variante="peligro" cargando={enviando} aria-describedby={idPregunta}>
            Sí, quitar
          </Boton>
          <Boton
            ref={botonNo}
            type="button"
            tamano="sm"
            variante="fantasma"
            aria-describedby={idPregunta}
            onClick={() => {
              volverAlTacho.current = true
              setConfirmando(false)
            }}
          >
            No
          </Boton>
          {error && <p role="alert" className="w-full text-xs font-medium text-peligro">{error}</p>}
        </form>
      )}
    </li>
  )
}
