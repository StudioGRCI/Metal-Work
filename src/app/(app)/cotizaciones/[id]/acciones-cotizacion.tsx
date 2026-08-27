'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Download } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Seleccion } from '@/components/ui/campos'

import { cambiarEstadoCotizacion, convertirEnOrden } from '../acciones'

/**
 * Transiciones que ofrece la interfaz desde cada estado. Es un espejo del
 * trigger fn_cotizacion_transicion: aquí solo decide qué botones se muestran.
 *
 * «Enviar al cliente» ya no es un botón: enviar es descargar el PDF y mandarlo,
 * así que ese paso lo da la descarga. Anular siempre pide motivo, porque la
 * cotización no se borra nunca -es parte del correlativo de la empresa- y lo
 * único que queda de ella es la explicación de por qué se dejó sin efecto.
 */
const SIGUIENTES: Record<
  string,
  { estado: string; etiqueta: string; permiso: string; motivo?: boolean; peligro?: boolean }[]
> = {
  BORRADOR: [
    { estado: 'ANULADA', etiqueta: 'Anular', permiso: 'cotizaciones.editar', motivo: true, peligro: true },
  ],
  ENVIADA: [
    { estado: 'APROBADA', etiqueta: 'Marcar aprobada', permiso: 'cotizaciones.aprobar' },
    { estado: 'RECHAZADA', etiqueta: 'Rechazar', permiso: 'cotizaciones.aprobar', motivo: true, peligro: true },
    { estado: 'BORRADOR', etiqueta: 'Volver a borrador', permiso: 'cotizaciones.editar' },
    { estado: 'ANULADA', etiqueta: 'Anular', permiso: 'cotizaciones.editar', motivo: true, peligro: true },
  ],
  // Una aprobada es lo que el cliente ya aceptó: deshacerlo es de Gerencia.
  APROBADA: [
    { estado: 'ANULADA', etiqueta: 'Anular', permiso: 'cotizaciones.anular', motivo: true, peligro: true },
  ],
  RECHAZADA: [
    { estado: 'ANULADA', etiqueta: 'Anular', permiso: 'cotizaciones.editar', motivo: true, peligro: true },
  ],
  VENCIDA: [
    { estado: 'ENVIADA', etiqueta: 'Reenviar', permiso: 'cotizaciones.editar' },
    { estado: 'ANULADA', etiqueta: 'Anular', permiso: 'cotizaciones.editar', motivo: true, peligro: true },
  ],
}

/** Lo que pide cada motivo, en el lenguaje de quien lo va a escribir. */
const MOTIVOS: Record<string, { etiqueta: string; ejemplo: string }> = {
  RECHAZADA: {
    etiqueta: 'Motivo del rechazo',
    ejemplo: 'Ej.: el cliente eligió otro proveedor por precio',
  },
  ANULADA: {
    etiqueta: 'Motivo de la anulación',
    ejemplo: 'Ej.: se emitió por error, va la 3570-2026 en su lugar',
  },
}

export function AccionesCotizacion({
  cotizacion,
  permisos,
  esAdmin,
  sedes,
  ordenExistente,
  tienePartidas,
}: {
  cotizacion: { id: string; estado: string; numero: string }
  permisos: string[]
  esAdmin: boolean
  sedes: { id: string; nombre: string }[]
  ordenExistente: { id: string; numero: string } | null
  tienePartidas: boolean
}) {
  const router = useRouter()
  const [, iniciarTransicion] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [pidiendoMotivo, setPidiendoMotivo] = useState<{ estado: string; etiqueta: string } | null>(null)
  const [abriendoOrden, setAbriendoOrden] = useState(false)

  const puede = (permiso: string) => esAdmin || permisos.includes(permiso)
  const disponibles = (SIGUIENTES[cotizacion.estado] ?? []).filter((t) => puede(t.permiso))

  async function cambiar(datos: FormData) {
    setError(null)
    setEnviando(true)
    const resultado = await cambiarEstadoCotizacion(null, datos)
    setEnviando(false)
    setPidiendoMotivo(null)

    if (resultado.ok) iniciarTransicion(() => router.refresh())
    else setError(resultado.error)
  }

  async function abrirOrden(datos: FormData) {
    setError(null)
    setEnviando(true)
    const resultado = await convertirEnOrden(null, datos)
    setEnviando(false)

    // Si sale bien, la acción redirige a la orden y este código ya no corre.
    if (!resultado.ok) {
      setError(resultado.error)
      setAbriendoOrden(false)
    }
  }

  const puedeAbrirOrden =
    cotizacion.estado === 'APROBADA' && !ordenExistente && puede('ordenes.crear')

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {/* Un enlace de verdad, no un window.open: el navegador guarda el
            archivo sin que el bloqueador de ventanas se meta en el camino.
            Marcar el borrador como enviado lo hace la ruta, y solo cuando el
            documento salió: si lo hiciera este clic, una descarga fallida
            dejaría igual la cotización «enviada» sin que nada saliera. */}
        <a
          href={`/cotizaciones/${cotizacion.id}/pdf`}
          download
          className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-base)] border border-borde px-3 text-xs font-medium text-texto hover:bg-superficie-2"
        >
          <Download aria-hidden className="size-3.5" />
          Descargar cotización
        </a>

        {ordenExistente && (
          <Link
            href={`/ordenes/${ordenExistente.id}`}
            className="inline-flex h-8 items-center rounded-[var(--radius-base)] border border-borde px-3 text-xs text-texto hover:bg-superficie-2"
          >
            Ver orden {ordenExistente.numero}
          </Link>
        )}

        {puedeAbrirOrden && (
          <Boton tamano="sm" onClick={() => setAbriendoOrden(true)} disabled={!tienePartidas}>
            Abrir orden de trabajo
          </Boton>
        )}

        {disponibles.map((t) =>
          t.motivo ? (
            <Boton
              key={t.estado}
              variante="peligro"
              tamano="sm"
              onClick={() => setPidiendoMotivo({ estado: t.estado, etiqueta: t.etiqueta })}
            >
              {t.etiqueta}
            </Boton>
          ) : (
            <form key={t.estado} action={cambiar}>
              <input type="hidden" name="cotizacion_id" value={cotizacion.id} />
              <input type="hidden" name="estado" value={t.estado} />
              <Boton
                type="submit"
                tamano="sm"
                cargando={enviando}
                variante={t.peligro ? 'peligro' : t.estado === 'APROBADA' ? 'primario' : 'secundario'}
              >
                {t.etiqueta}
              </Boton>
            </form>
          ),
        )}
      </div>

      {puedeAbrirOrden && !tienePartidas && (
        <p className="text-xs text-texto-suave">
          Agrega al menos una partida antes de abrir la orden.
        </p>
      )}

      {error && (
        <p role="alert" className="max-w-md rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-xs text-peligro">
          {error}
        </p>
      )}

      {pidiendoMotivo && (
        <Dialogo
          titulo={`${pidiendoMotivo.etiqueta} la cotización ${cotizacion.numero}`}
          alCerrar={() => setPidiendoMotivo(null)}
        >
          {pidiendoMotivo.estado === 'ANULADA' && (
            <p className="mt-1 text-xs text-texto-suave">
              La cotización no se elimina: su número es parte del correlativo de la empresa. Queda
              anulada, con el motivo a la vista y sin poder modificarse.
            </p>
          )}

          <form action={cambiar} className="mt-4 space-y-3">
            <input type="hidden" name="cotizacion_id" value={cotizacion.id} />
            <input type="hidden" name="estado" value={pidiendoMotivo.estado} />

            <Campo
              etiqueta={MOTIVOS[pidiendoMotivo.estado]?.etiqueta ?? 'Motivo'}
              htmlFor="motivo"
              requerido
            >
              <AreaTexto
                id="motivo"
                name="motivo"
                required
                autoFocus
                placeholder={MOTIVOS[pidiendoMotivo.estado]?.ejemplo}
              />
            </Campo>

            <div className="flex justify-end gap-2">
              <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setPidiendoMotivo(null)}>
                Cancelar
              </Boton>
              <Boton type="submit" tamano="sm" variante="peligro" cargando={enviando}>
                Confirmar
              </Boton>
            </div>
          </form>
        </Dialogo>
      )}

      {abriendoOrden && (
        <Dialogo titulo="Abrir orden de trabajo" alCerrar={() => setAbriendoOrden(false)}>
          <p className="mt-1 text-xs text-texto-suave">
            Se creará una orden en borrador con el cliente, la unidad y el presupuesto de esta
            cotización.
          </p>

          <form action={abrirOrden} className="mt-4 space-y-3">
            <input type="hidden" name="cotizacion_id" value={cotizacion.id} />

            <Campo etiqueta="Taller donde se ejecutará" htmlFor="sede_id" requerido>
              <Seleccion id="sede_id" name="sede_id" required defaultValue={sedes[0]?.id ?? ''}>
                {sedes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </Seleccion>
            </Campo>

            <div className="flex justify-end gap-2">
              <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setAbriendoOrden(false)}>
                Cancelar
              </Boton>
              <Boton type="submit" tamano="sm" cargando={enviando}>
                Abrir orden
              </Boton>
            </div>
          </form>
        </Dialogo>
      )}
    </div>
  )
}

function Dialogo({
  titulo,
  alCerrar,
  children,
}: {
  titulo: string
  alCerrar: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button type="button" aria-label="Cancelar" onClick={alCerrar} className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-md rounded-[var(--radius-base)] border border-borde bg-superficie p-4 text-left shadow-xl">
        <h2 className="text-sm font-semibold text-texto">{titulo}</h2>
        {children}
      </div>
    </div>
  )
}
