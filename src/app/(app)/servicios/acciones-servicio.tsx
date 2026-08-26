'use client'

import { BadgeCheck, Ban, PackageCheck, Plus, Receipt, Truck } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'

import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { TD, TR } from '@/components/ui/tabla'
import type { OrdenDeServicio } from '@/lib/datos/servicios'
import { ESTADO_SERVICIO, TIPO_SERVICIO } from '@/lib/dominio/servicios'
import { type CodigoMoneda, fecha as formatearFecha, moneda as formatearMoneda } from '@/lib/format'
import { cn } from '@/lib/utils'

import { cambiarEstadoServicio, crearOrdenDeServicio, darConformidad, registrarPago } from './acciones'

type Catalogos = {
  proveedores: { id: string; razon_social: string; numero_documento: string }[]
  ordenes: { id: string; numero: string; cliente: string | null; placa: string | null }[]
}

function Ventana({
  titulo,
  descripcion,
  onCerrar,
  children,
}: {
  titulo: string
  descripcion?: string
  onCerrar: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const salir = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    document.addEventListener('keydown', salir)
    return () => document.removeEventListener('keydown', salir)
  }, [onCerrar])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-10">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={titulo}
        className="w-full max-w-xl rounded-[calc(var(--radius-base)*1.5)] border border-borde bg-superficie p-5 shadow-2xl shadow-black/30"
      >
        <h2 className="text-base font-semibold text-texto">{titulo}</h2>
        {descripcion && <p className="mt-1 text-xs text-texto-suave">{descripcion}</p>}
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}

function Aviso({ resultado }: { resultado: { ok?: boolean; error?: string; mensaje?: string } | null }) {
  if (!resultado) return null
  const malo = resultado.ok === false
  return (
    <p
      role={malo ? 'alert' : 'status'}
      className={cn(
        'rounded-[var(--radius-base)] px-3 py-2 text-xs',
        malo ? 'bg-peligro-suave text-peligro' : 'bg-exito-suave text-exito',
      )}
    >
      {malo ? resultado.error : resultado.mensaje}
    </p>
  )
}

export function NuevaOrdenDeServicio({ catalogos }: { catalogos: Catalogos }) {
  const [abierto, setAbierto] = useState(false)
  const [moneda, setMoneda] = useState('PEN')
  const [resultado, accion, enviando] = useActionState(crearOrdenDeServicio, null)

  // Emitida la orden, la ventana no se cierra sola: queda a la vista el número
  // que le tocó, que es lo que hay que dictarle al proveedor.
  const hoy = new Date().toISOString().slice(0, 10)

  return (
    <>
      <Boton onClick={() => setAbierto(true)}>
        <Plus aria-hidden className="size-4" />
        Nueva orden de servicio
      </Boton>

      {abierto && (
        <Ventana
          titulo="Nueva orden de servicio"
          descripcion="El trabajo que se manda a hacer afuera, con su plazo y su monto."
          onCerrar={() => setAbierto(false)}
        >
          <form action={accion} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Orden de trabajo" htmlFor="orden_id" requerido>
                <Seleccion id="orden_id" name="orden_id" required>
                  <option value="">Elegir…</option>
                  {catalogos.ordenes.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.numero} · {o.placa ?? o.cliente ?? ''}
                    </option>
                  ))}
                </Seleccion>
              </Campo>
              <Campo etiqueta="Proveedor" htmlFor="proveedor_id" requerido>
                <Seleccion id="proveedor_id" name="proveedor_id" required>
                  <option value="">Elegir…</option>
                  {catalogos.proveedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.razon_social}
                    </option>
                  ))}
                </Seleccion>
              </Campo>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Trabajo" htmlFor="tipo_servicio" requerido>
                <Seleccion id="tipo_servicio" name="tipo_servicio" required defaultValue="ARENADO">
                  {Object.entries(TIPO_SERVICIO).map(([valor, def]) => (
                    <option key={valor} value={valor}>
                      {def.etiqueta}
                    </option>
                  ))}
                </Seleccion>
              </Campo>
              <Campo etiqueta="Fecha" htmlFor="fecha" requerido>
                <Entrada id="fecha" name="fecha" type="date" required defaultValue={hoy} />
              </Campo>
            </div>

            <Campo etiqueta="Qué se manda a hacer" htmlFor="descripcion" requerido>
              <Entrada
                id="descripcion"
                name="descripcion"
                required
                placeholder="Arenado comercial SA 2.5 de la tolva"
              />
            </Campo>

            <Campo
              etiqueta="Especificación"
              htmlFor="especificacion"
              ayuda="Norma, acabado, medidas: lo que el proveedor tiene que cumplir"
            >
              <AreaTexto id="especificacion" name="especificacion" rows={2} />
            </Campo>

            <div className="grid gap-3 sm:grid-cols-4">
              <Campo etiqueta="Plazo (días)" htmlFor="plazo_dias">
                <Entrada id="plazo_dias" name="plazo_dias" type="number" min="0" defaultValue={3} />
              </Campo>
              <Campo etiqueta="Moneda" htmlFor="moneda">
                <Seleccion
                  id="moneda"
                  name="moneda"
                  value={moneda}
                  onChange={(e) => setMoneda(e.target.value)}
                >
                  <option value="PEN">Soles</option>
                  <option value="USD">Dólares</option>
                </Seleccion>
              </Campo>
              <Campo etiqueta="Monto" htmlFor="monto" requerido>
                <Entrada id="monto" name="monto" type="number" step="0.01" min="0.01" required />
              </Campo>
              <Campo
                etiqueta="Tipo de cambio"
                htmlFor="tipo_cambio"
                ayuda={moneda === 'PEN' ? 'No aplica en soles' : undefined}
              >
                <Entrada
                  id="tipo_cambio"
                  name="tipo_cambio"
                  type="number"
                  step="0.001"
                  min="0.001"
                  defaultValue={3.75}
                  disabled={moneda === 'PEN'}
                />
              </Campo>
            </div>

            <Aviso resultado={resultado} />

            <div className="flex justify-end gap-2 pt-1">
              <Boton type="button" variante="contorno" onClick={() => setAbierto(false)}>
                {resultado?.ok ? 'Cerrar' : 'Cancelar'}
              </Boton>
              <Boton type="submit" cargando={enviando}>
                Emitir
              </Boton>
            </div>
          </form>
        </Ventana>
      )}
    </>
  )
}

export function FilaDeServicio({
  servicio,
  puedeMover,
  puedeConformar,
  puedePagar,
}: {
  servicio: OrdenDeServicio
  puedeMover: boolean
  puedeConformar: boolean
  puedePagar: boolean
}) {
  const [ventana, setVentana] = useState<'conformidad' | 'pago' | null>(null)

  const [movido, accionMover, moviendo] = useActionState(cambiarEstadoServicio, null)
  const [conforme, accionConformar, conformando] = useActionState(darConformidad, null)
  const [pagado, accionPagar, pagando] = useActionState(registrarPago, null)

  const estado = ESTADO_SERVICIO[servicio.estado] ?? { etiqueta: servicio.estado, tono: 'neutro' as const }
  const enCurso = ['SOLICITADO', 'EN_EJECUCION'].includes(servicio.estado)
  const porConformar = ['SOLICITADO', 'EN_EJECUCION', 'EJECUTADO'].includes(servicio.estado)
  // Se puede anular mientras no se haya aceptado el trabajo: después ya es
  // costo de la unidad y lo que corresponde es una nota de crédito, no borrarla.
  const anulable = porConformar

  return (
    <>
      <TR>
        <TD>
          <div className="font-medium">{servicio.numero}</div>
          <div className="text-xs text-texto-suave">{formatearFecha(servicio.fecha)}</div>
        </TD>
        <TD>
          <div className="text-sm">{servicio.proveedor}</div>
          <div className="text-xs text-texto-suave">
            {TIPO_SERVICIO[servicio.tipo_servicio]?.etiqueta ?? servicio.tipo_servicio}
          </div>
        </TD>
        <TD className="max-w-72">
          <div className="truncate text-sm" title={servicio.descripcion}>
            {servicio.descripcion}
          </div>
          {servicio.orden_numero && (
            <div className="text-xs text-texto-suave">
              {servicio.orden_numero} · {servicio.placa ?? servicio.cliente}
            </div>
          )}
        </TD>
        <TD>
          <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
          {servicio.atrasada && (
            <span className="ml-1">
              <Insignia tono="peligro">Atrasada</Insignia>
            </span>
          )}
        </TD>
        <TD className="text-xs whitespace-nowrap">
          {servicio.fecha_entrega ? formatearFecha(servicio.fecha_entrega) : '—'}
        </TD>
        <TD className="tabular text-right whitespace-nowrap">
          {formatearMoneda(Number(servicio.monto), servicio.moneda as CodigoMoneda)}
        </TD>
        <TD className="text-right whitespace-nowrap">
          {puedeMover && enCurso && (
            <form action={accionMover} className="inline">
              <input type="hidden" name="id" value={servicio.id} />
              <input
                type="hidden"
                name="estado"
                value={servicio.estado === 'SOLICITADO' ? 'EN_EJECUCION' : 'EJECUTADO'}
              />
              <button
                type="submit"
                disabled={moviendo}
                title={servicio.estado === 'SOLICITADO' ? 'Marcar que salió al proveedor' : 'Marcar que ya volvió'}
                aria-label={servicio.estado === 'SOLICITADO' ? 'Salió al proveedor' : 'Volvió del proveedor'}
                className="rounded-[var(--radius-base)] p-1.5 text-texto-suave hover:bg-superficie-2 hover:text-texto disabled:opacity-50"
              >
                {servicio.estado === 'SOLICITADO' ? (
                  <Truck className="size-4" />
                ) : (
                  <PackageCheck className="size-4" />
                )}
              </button>
            </form>
          )}

          {puedeConformar && porConformar && (
            <button
              type="button"
              onClick={() => setVentana('conformidad')}
              title="Dar la conformidad del trabajo"
              aria-label={`Dar conformidad de ${servicio.numero}`}
              className="rounded-[var(--radius-base)] p-1.5 text-texto-suave hover:bg-superficie-2 hover:text-exito"
            >
              <BadgeCheck className="size-4" />
            </button>
          )}

          {puedePagar && servicio.estado === 'CONFORME' && (
            <button
              type="button"
              onClick={() => setVentana('pago')}
              title="Registrar la factura y el pago"
              aria-label={`Registrar el pago de ${servicio.numero}`}
              className="rounded-[var(--radius-base)] p-1.5 text-texto-suave hover:bg-superficie-2 hover:text-texto"
            >
              <Receipt className="size-4" />
            </button>
          )}

          {puedeMover && anulable && (
            <form action={accionMover} className="inline">
              <input type="hidden" name="id" value={servicio.id} />
              <input type="hidden" name="estado" value="ANULADO" />
              <button
                type="submit"
                disabled={moviendo}
                title="Anular la orden de servicio"
                aria-label={`Anular ${servicio.numero}`}
                className="rounded-[var(--radius-base)] p-1.5 text-texto-suave hover:bg-superficie-2 hover:text-peligro disabled:opacity-50"
              >
                <Ban className="size-4" />
              </button>
            </form>
          )}
        </TD>
      </TR>

      {(movido?.ok === false || conforme || pagado) && (
        <TR>
          <TD colSpan={7} className="py-1">
            <Aviso resultado={movido?.ok === false ? movido : (conforme ?? pagado)} />
          </TD>
        </TR>
      )}

      {ventana === 'conformidad' && (
        <Ventana
          titulo={`Conformidad de ${servicio.numero}`}
          descripcion={`${servicio.proveedor} · ${servicio.descripcion}`}
          onCerrar={() => setVentana(null)}
        >
          <form action={accionConformar} className="space-y-3">
            <input type="hidden" name="id" value={servicio.id} />
            <p className="rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-xs text-aviso">
              Dar la conformidad es aceptar el trabajo que volvió. Desde ese momento el monto deja
              de ser compromiso y pasa a ser costo de la unidad, y recién ahí se puede pagar.
            </p>
            <Campo
              etiqueta="Observaciones"
              htmlFor={`obs-${servicio.id}`}
              ayuda="Cómo volvió el trabajo; queda con tu nombre y la fecha"
            >
              <AreaTexto id={`obs-${servicio.id}`} name="observaciones" rows={3} />
            </Campo>
            <Aviso resultado={conforme} />
            <div className="flex justify-end gap-2">
              <Boton type="button" variante="contorno" onClick={() => setVentana(null)}>
                {conforme?.ok ? 'Cerrar' : 'Cancelar'}
              </Boton>
              <Boton type="submit" cargando={conformando}>
                Dar conformidad
              </Boton>
            </div>
          </form>
        </Ventana>
      )}

      {ventana === 'pago' && (
        <Ventana
          titulo={`Pago de ${servicio.numero}`}
          descripcion={`${servicio.proveedor} · ${formatearMoneda(Number(servicio.monto), servicio.moneda as CodigoMoneda)}`}
          onCerrar={() => setVentana(null)}
        >
          <form action={accionPagar} className="space-y-3">
            <input type="hidden" name="id" value={servicio.id} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Número de factura" htmlFor={`fac-${servicio.id}`} requerido>
                <Entrada id={`fac-${servicio.id}`} name="numero_factura" required placeholder="F001-00001234" />
              </Campo>
              <Campo etiqueta="Fecha de la factura" htmlFor={`fecfac-${servicio.id}`} requerido>
                <Entrada
                  id={`fecfac-${servicio.id}`}
                  name="fecha_factura"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </Campo>
            </div>
            <Aviso resultado={pagado} />
            <div className="flex justify-end gap-2">
              <Boton type="button" variante="contorno" onClick={() => setVentana(null)}>
                {pagado?.ok ? 'Cerrar' : 'Cancelar'}
              </Boton>
              <Boton type="submit" cargando={pagando}>
                Registrar pago
              </Boton>
            </div>
          </form>
        </Ventana>
      )}
    </>
  )
}
