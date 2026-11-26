'use client'

import { FileCheck2 } from 'lucide-react'
import { useState } from 'react'

import { AvisoEnfocado } from '@/components/ui/aviso-enfocado'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { motivoDelFallo, useCursorAlRechazo, useEnvio } from '@/lib/envio'

import { anotarDocumentosRecibidos, leerRecepcionDeAhora, type RecepcionDeAhora } from './acciones'

/** De qué campo es el rechazo de la base, para decirlo en su campo y llevar el cursor ahí. */
function campoDelRechazo(error: string | null): 'factura' | 'guia' | 'observacion' | null {
  if (!error) return null
  if (/comprobante/i.test(error)) return 'factura'
  if (/La guía va/i.test(error)) return 'guia'
  if (/observación/i.test(error)) return 'observacion'
  return null
}

/**
 * La casilla «Recepción de Almacén» del CONTROL DE FACTURAS, con el número: la
 * factura y la guía que trajo el proveedor y la nota de la fila. Corrige lo
 * que la fila muestra, así que espera a que la pantalla se ponga al día; y
 * manda cuándo cambió esa fila, para no pisar lo que otra pantalla anotó.
 */
export function AnotarRecibido({
  tipo,
  ordenId,
  nombre,
  compra,
  proveedor,
  monto,
  factura,
  guia,
  observacion,
  mostrado,
}: {
  tipo: 'OC' | 'OS'
  ordenId: string
  /** Cómo se nombra la orden: «OC-0001-MW», «OS-001-MW». */
  nombre: string
  /** Lo que se compró, para no anotar en la fila equivocada. */
  compra: string | null
  proveedor: string | null
  /** El monto ya escrito con su moneda. */
  monto: string | null
  factura: string | null
  guia: string | null
  observacion: string | null
  /** Cuándo cambió la fila que se muestra, como la dio la base; vacío si no hay. */
  mostrado: string | null
}) {
  const [abierta, setAbierta] = useState(false)
  const [listo, setListo] = useState<{ texto: string; n: number } | null>(null)
  const { alEnviar, enviando, error } = useEnvio(
    anotarDocumentosRecibidos,
    (r) => {
      setAbierta(false)
      setListo((previo) => ({ texto: r.mensaje ?? 'Guardado.', n: (previo?.n ?? 0) + 1 }))
    },
    { documento: `recepcion:${tipo}:${ordenId}`, corrige: true },
  )
  const delCampo = campoDelRechazo(error)
  useCursorAlRechazo(enviando, delCampo, () => document.getElementById(`${delCampo}-${ordenId}`))
  const anotado = factura !== null || guia !== null || observacion !== null
  const descripcion = [compra, proveedor, monto].filter(Boolean).join(' · ')
  // La base dijo que otra pantalla anotó después: se lee lo de ahora de esa
  // fila sin refrescar la lista (en «Pendientes» la fila podía salir y llevarse
  // la ventana con lo escrito). Lo escrito se queda y la versión oculta se pone
  // al día, para que guardar después sea una decisión con lo de ahora a la vista.
  const deOtraPantalla = Boolean(error && /cambió después de que lo abriste/.test(error))
  // Lo de ahora vale para el rechazo al que respondió: si otro «Guardar» choca
  // de nuevo, se vuelve a mostrar el rechazo nuevo con su botón.
  const [ahora, setAhora] = useState<(RecepcionDeAhora & { delRechazo: string }) | null>(null)
  const [leyendo, setLeyendo] = useState(false)
  const [errorAlLeer, setErrorAlLeer] = useState<string | null>(null)
  async function verLoDeAhora() {
    setLeyendo(true)
    setErrorAlLeer(null)
    try {
      const r = await leerRecepcionDeAhora(tipo, ordenId)
      if (r.ok && r.datos) setAhora({ ...r.datos, delRechazo: error ?? '' })
      else setErrorAlLeer(r.ok ? 'No se pudo leer lo de ahora.' : r.error)
    } catch (e) {
      setErrorAlLeer(motivoDelFallo(e, 'No se pudo leer lo de ahora. Revisa la conexión y vuelve a tocar.'))
    } finally {
      setLeyendo(false)
    }
  }
  return (
    <div className="space-y-1">
      <Boton
        type="button"
        tamano="sm"
        variante="contorno"
        onClick={() => {
          setListo(null)
          setAhora(null)
          setErrorAlLeer(null)
          setAbierta(true)
        }}
        aria-label={`${anotado ? 'Corregir lo recibido' : 'Anotar lo recibido'} de ${nombre}`}
      >
        <FileCheck2 aria-hidden className="size-4" />
        {anotado ? 'Corregir' : 'Anotar'}
      </Boton>
      <p role="status" className={listo ? 'text-xs text-exito' : 'sr-only'}>
        {listo && <span key={listo.n}>{listo.texto}</span>}
      </p>
      <Ventana
        abierta={abierta}
        alCerrar={() => setAbierta(false)}
        titulo={`Lo que llegó · ${nombre}`}
        descripcion={descripcion || undefined}
        ancho="md"
      >
        <form onSubmit={alEnviar} className="space-y-4">
          <input type="hidden" name="tipo" value={tipo} />
          <input type="hidden" name="orden_id" value={ordenId} />
          <input type="hidden" name="mostrado" value={(ahora ? ahora.mostrado : mostrado) ?? ''} />
          <p className="text-sm text-texto-suave">
            Anota el comprobante y la guía que trajo el proveedor, como están impresos. Si te equivocaste de fila, borra el
            número y guarda.
          </p>
          <fieldset disabled={enviando} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo
                etiqueta="Factura o comprobante"
                htmlFor={`factura-${ordenId}`}
                ayuda="Serie de 4 y número: F001-0123, E001-45; en papel, 0001-123."
                ayudaEnIcono={false}
                error={delCampo === 'factura' ? (error ?? undefined) : undefined}
              >
                <Entrada
                  id={`factura-${ordenId}`}
                  name="factura"
                  defaultValue={factura ?? ''}
                  placeholder="F001-0123"
                  autoComplete="off"
                  autoCapitalize="characters"
                  maxLength={40}
                  aria-invalid={delCampo === 'factura' || undefined}
                />
              </Campo>
              <Campo
                etiqueta="Guía de remisión"
                htmlFor={`guia-${ordenId}`}
                ayuda="Vacía si no llegó."
                ayudaEnIcono={false}
                error={delCampo === 'guia' ? (error ?? undefined) : undefined}
              >
                <Entrada
                  id={`guia-${ordenId}`}
                  name="guia"
                  defaultValue={guia ?? ''}
                  placeholder="T001-0456"
                  autoComplete="off"
                  autoCapitalize="characters"
                  maxLength={40}
                  aria-invalid={delCampo === 'guia' || undefined}
                />
              </Campo>
            </div>
            <Campo
              etiqueta="Observación"
              htmlFor={`observacion-${ordenId}`}
              ayuda="Falta guía, nota de crédito, quién la recogió."
              ayudaEnIcono={false}
              error={delCampo === 'observacion' ? (error ?? undefined) : undefined}
            >
              <AreaTexto
                id={`observacion-${ordenId}`}
                name="observacion"
                defaultValue={observacion ?? ''}
                rows={2}
                maxLength={500}
                aria-invalid={delCampo === 'observacion' || undefined}
              />
            </Campo>
          </fieldset>
          {error && !delCampo && deOtraPantalla && ahora && ahora.delRechazo === error ? (
            <AvisoEnfocado key={ahora.mostrado ?? 'nada'} aviso>
              Ahora dice: factura {ahora.factura ?? 'sin anotar'}, guía {ahora.guia ?? 'sin anotar'}
              {ahora.observacion ? `, nota «${ahora.observacion}»` : ', sin nota'}. Lo que escribiste sigue arriba: si es lo
              correcto, guarda; si no, cancela.
            </AvisoEnfocado>
          ) : (
            error &&
            !delCampo && (
              <div className="space-y-2">
                <AvisoEnfocado rol="alert">{error}</AvisoEnfocado>
                {deOtraPantalla && (
                  <Boton type="button" variante="secundario" tamano="sm" cargando={leyendo} onClick={verLoDeAhora}>
                    Ver lo de ahora
                  </Boton>
                )}
                {errorAlLeer && <p className="text-xs text-peligro">{errorAlLeer}</p>}
              </div>
            )
          )}
          <div className="flex justify-end gap-2">
            <Boton type="button" variante="contorno" disabled={enviando} onClick={() => setAbierta(false)}>
              Cancelar
            </Boton>
            <Boton type="submit" cargando={enviando}>
              Guardar
            </Boton>
          </div>
        </form>
      </Ventana>
    </div>
  )
}
