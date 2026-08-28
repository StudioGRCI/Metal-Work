'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Download, Eye } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Seleccion } from '@/components/ui/campos'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Ventana } from '@/components/ui/ventana'

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
  const [bajando, setBajando] = useState(false)

  const puede = (permiso: string) => esAdmin || permisos.includes(permiso)
  const disponibles = (SIGUIENTES[cotizacion.estado] ?? []).filter((t) => puede(t.permiso))

  /**
   * Descargar y marcar enviada, en ese orden y sin dejar la pantalla mintiendo.
   *
   * Se pide el archivo con fetch en lugar de seguir un enlace porque hace falta
   * saber cuándo terminó el servidor: es entonces -y no antes- cuando la
   * cotización ya está ENVIADA y la pantalla se puede repintar. Con el enlace,
   * el navegador se llevaba el archivo y la insignia seguía diciendo «Borrador»
   * hasta que alguien recargaba a mano, así que los botones de aprobar y
   * rechazar no aparecían con el cliente al teléfono.
   *
   * Si no hay papel que entregar, la ruta redirige al detalle con el motivo en
   * la dirección; acá se lee de ahí y se muestra donde el vendedor está mirando.
   */
  async function descargarYEnviar() {
    setError(null)
    setBajando(true)

    try {
      const respuesta = await fetch(`/cotizaciones/${cotizacion.id}/pdf?envia=1`)

      if (!respuesta.headers.get('content-type')?.includes('application/pdf')) {
        const motivo = new URL(respuesta.url).searchParams.get('aviso')
        setError(motivo || 'No se pudo armar el documento. Vuelve a intentarlo.')
        return
      }

      const archivo = await respuesta.blob()
      const direccion = URL.createObjectURL(archivo)
      const enlace = document.createElement('a')
      enlace.href = direccion
      enlace.download = nombreDelArchivo(respuesta) ?? `COT-${cotizacion.numero}.pdf`
      enlace.click()
      URL.revokeObjectURL(direccion)

      // Ya está enviada en la base: que la pantalla lo diga.
      iniciarTransicion(() => router.refresh())
    } catch {
      setError('No se pudo descargar el documento. Revisa la conexión y vuelve a intentarlo.')
    } finally {
      setBajando(false)
    }
  }

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
      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* Ver el papel y mandarlo son dos cosas distintas, y hasta ahora eran
            el mismo botón: el vendedor que solo quería mirar cómo iba quedando
            terminaba emitiendo. Este enlace no cambia el estado de nada.

            `prefetch={false}` porque detrás no hay pantalla sino la ruta que
            arma el PDF: sin eso, pasar el ratón por encima lo mandaría a
            fabricar un documento que nadie pidió. */}
        <EnlaceBoton
          href={`/cotizaciones/${cotizacion.id}/pdf`}
          target="_blank"
          rel="noopener"
          prefetch={false}
          variante="secundario"
          tamano="sm"
        >
          <Eye aria-hidden className="size-3.5" />
          Ver el papel
        </EnlaceBoton>

        {/* Marcar enviada lo sigue haciendo la ruta, y solo cuando el documento
            salió: si lo hiciera este clic, una descarga fallida dejaría igual
            la cotización «enviada» sin que nada hubiera salido. */}
        {cotizacion.estado === 'BORRADOR' ? (
          <Boton
            variante="secundario"
            tamano="sm"
            onClick={descargarYEnviar}
            cargando={bajando}
            disabled={!tienePartidas}
          >
            <Download aria-hidden className="size-3.5" />
            Descargar y marcar enviada
          </Boton>
        ) : (
          <Boton variante="secundario" tamano="sm" onClick={descargarYEnviar} cargando={bajando}>
            <Download aria-hidden className="size-3.5" />
            Descargar
          </Boton>
        )}

        {ordenExistente && (
          <EnlaceBoton
            href={`/ordenes/${ordenExistente.id}`}
            variante="secundario"
            tamano="sm"
          >
            Ver orden {ordenExistente.numero}
          </EnlaceBoton>
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

      {/* Va dentro de la condición y no solo con `abierta`: el contenido lee el
          estado que se pidió anular o rechazar, y sin él no hay nada que pintar.
          La explicación de la anulación es la bajada de la ventana. */}
      {pidiendoMotivo && (
        <Ventana
          abierta
          alCerrar={() => setPidiendoMotivo(null)}
          titulo={`${pidiendoMotivo.etiqueta} la cotización ${cotizacion.numero}`}
          descripcion={
            pidiendoMotivo.estado === 'ANULADA'
              ? 'La cotización no se elimina: su número es parte del correlativo de la empresa. Queda anulada, con el motivo a la vista y sin poder modificarse.'
              : undefined
          }
          ancho="sm"
        >
          <form action={cambiar} className="space-y-3">
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
              {/* «Confirmar» no dice qué se confirma; el rótulo del botón que
                  abrió el cuadro sí: Anular, Rechazar. */}
              <Boton type="submit" tamano="sm" variante="peligro" cargando={enviando}>
                {pidiendoMotivo.etiqueta} la cotización
              </Boton>
            </div>
          </form>
        </Ventana>
      )}

      <Ventana
        abierta={abriendoOrden}
        alCerrar={() => setAbriendoOrden(false)}
        titulo="Abrir orden de trabajo"
        descripcion="Se creará una orden en borrador con el cliente, la unidad y el presupuesto de esta cotización."
        ancho="sm"
      >
        <form action={abrirOrden} className="space-y-3">
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
      </Ventana>
    </div>
  )
}

/**
 * El nombre del archivo lo pone el servidor en la cabecera, con el formato que
 * usa la empresa para archivar. Leerlo de ahí evita tener dos reglas de nombre
 * -una en el servidor y otra en el navegador- que un día dejen de coincidir.
 */
function nombreDelArchivo(respuesta: Response) {
  const cabecera = respuesta.headers.get('content-disposition')
  return cabecera?.match(/filename="([^"]+)"/)?.[1]
}
