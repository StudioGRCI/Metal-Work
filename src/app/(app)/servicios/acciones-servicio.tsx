'use client'

import { BadgeCheck, Ban, PackageCheck, Plus, Receipt, Truck } from 'lucide-react'
import { useActionState, useRef, useState } from 'react'

import { NuevoProveedor } from '@/components/proveedores/nuevo-proveedor'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { TD, TR } from '@/components/ui/tabla'
import { ConfirmarAccion, Ventana } from '@/components/ui/ventana'
import type { OrdenDeServicio } from '@/lib/datos/servicios'
import { ESTADO_SERVICIO, TIPO_SERVICIO } from '@/lib/dominio/servicios'
import { nombreDeUnidad, todaviaSinPlaca, type UnidadNombrable } from '@/lib/dominio/unidades'
import {
  type CodigoMoneda,
  fecha as formatearFecha,
  hoyLima,
  moneda as formatearMoneda,
} from '@/lib/format'
import { cn } from '@/lib/utils'

import { cambiarEstadoServicio, crearOrdenDeServicio, darConformidad, registrarPago } from './acciones'

type Catalogos = {
  proveedores: { id: string; razon_social: string; numero_documento: string }[]
  ordenes: { id: string; numero: string; cliente: string | null; unidad: UnidadNombrable | null }[]
}

// Botón de icono de la fila. 44 px en el teléfono —lo que ocupa un dedo, y con
// guante más—; desde `sm` vuelve a los 28 px de siempre, que es lo que daban el
// `p-1.5` y el icono de 16 px.
const BOTON_ICONO =
  'inline-flex size-11 items-center justify-center rounded-[var(--radius-base)] text-texto-suave hover:bg-superficie-2 disabled:opacity-50 sm:size-7'

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

  // Los proveedores dados de alta sin salir de esta ventana se suman a la lista
  // y quedan elegidos, para no perder lo que ya se escribió.
  const [agregados, setAgregados] = useState<Catalogos['proveedores']>([])
  const [proveedorId, setProveedorId] = useState('')
  const proveedores = [...agregados, ...catalogos.proveedores]

  // Emitida la orden, la ventana no se cierra sola: queda a la vista el número
  // que le tocó, que es lo que hay que dictarle al proveedor.
  // La fecha del taller, no la del reloj universal: pasadas las siete de la
  // noche en Lima el reloj universal ya está en el día siguiente.
  const hoy = hoyLima()

  return (
    <>
      <Boton onClick={() => setAbierto(true)}>
        <Plus aria-hidden className="size-4" />
        Nueva orden de servicio
      </Boton>

      <Ventana
        abierta={abierto}
        alCerrar={() => setAbierto(false)}
        titulo="Nueva orden de servicio"
        descripcion="El trabajo que se manda a hacer afuera, con su plazo y su monto."
        ancho="lg"
      >
        <form action={accion} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Orden de trabajo" htmlFor="orden_id" requerido>
              <Seleccion id="orden_id" name="orden_id" required>
                <option value="">Elegir…</option>
                {/* La unidad se nombra siempre: la carrocería que todavía no
                    tiene placa se llama por su código de fabricación o por su
                    chasis, no por un hueco. */}
                {catalogos.ordenes.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.numero} · {nombreDeUnidad(o.unidad)}
                  </option>
                ))}
              </Seleccion>
            </Campo>
            <Campo etiqueta="Proveedor" htmlFor="proveedor_id" requerido>
              <div className="flex items-center gap-2">
                <Seleccion
                  id="proveedor_id"
                  name="proveedor_id"
                  required
                  value={proveedorId}
                  onChange={(e) => setProveedorId(e.target.value)}
                  className="flex-1"
                >
                  <option value="">Elegir…</option>
                  {proveedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.razon_social}
                    </option>
                  ))}
                </Seleccion>
                <NuevoProveedor
                  compacto
                  etiqueta="Nuevo"
                  onCreado={(prov) => {
                    setAgregados((lista) =>
                      lista.some((p) => p.id === prov.id)
                        ? lista
                        : [{ ...prov, numero_documento: '' }, ...lista],
                    )
                    setProveedorId(prov.id)
                  }}
                />
              </div>
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
              autoComplete="off"
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

          {/* Dos por fila en el teléfono: cuatro campos apilados dejaban el
              botón de emitir fuera de pantalla. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Campo etiqueta="Plazo" htmlFor="plazo_dias" ayuda="Días de taller">
              <Entrada
                id="plazo_dias"
                name="plazo_dias"
                type="number"
                inputMode="numeric"
                min="0"
                className="tabular"
                defaultValue={3}
              />
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
              <Entrada
                id="monto"
                name="monto"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                required
                className="tabular text-right"
              />
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
                inputMode="decimal"
                step="0.001"
                min="0.001"
                className="tabular text-right"
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
              Emitir la orden
            </Boton>
          </div>
        </form>
      </Ventana>
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
  const [anulando, setAnulando] = useState(false)
  const formularioAnular = useRef<HTMLFormElement>(null)
  // La fecha del taller, no la del reloj universal: pasadas las siete de la
  // noche en Lima el reloj universal ya está en el día siguiente.
  const hoy = hoyLima()

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
          {/* En el teléfono no hay columna de proveedor: sin esta línea la fila
              diría el número y el monto, pero no a quién se le mandó. */}
          <div className="text-[11px] text-texto-suave sm:hidden">{servicio.proveedor}</div>
        </TD>
        <TD className="hidden sm:table-cell">
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
              {/* Mientras la unidad no tenga placa, su nombre va más tenue: en el
                  renglón que se lee de lejos, un código de fabricación no se
                  puede confundir con una matrícula. */}
              {servicio.orden_numero} ·{' '}
              <span className={cn(todaviaSinPlaca(servicio) && 'text-texto-tenue')}>
                {nombreDeUnidad(servicio)}
              </span>
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
          {/* La fecha de entrega, que en el teléfono pierde su columna: es el dato
              con el que se decide a quién llamar hoy. */}
          {servicio.fecha_entrega && (
            <div className="text-[11px] whitespace-nowrap text-texto-suave sm:hidden">
              entrega {formatearFecha(servicio.fecha_entrega)}
            </div>
          )}
        </TD>
        <TD className="hidden text-xs whitespace-nowrap sm:table-cell">
          {servicio.fecha_entrega ? formatearFecha(servicio.fecha_entrega) : '—'}
        </TD>
        <TD className="tabular text-right whitespace-nowrap">
          {formatearMoneda(Number(servicio.monto), servicio.moneda as CodigoMoneda)}
        </TD>
        <TD className="text-right whitespace-nowrap">
          <div className="flex items-center justify-end gap-1 sm:gap-0">
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
                  className={cn(BOTON_ICONO, 'hover:text-texto')}
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
                className={cn(BOTON_ICONO, 'hover:text-exito')}
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
                className={cn(BOTON_ICONO, 'hover:text-texto')}
              >
                <Receipt className="size-4" />
              </button>
            )}

            {puedeMover && anulable && (
              // El botón no envía: primero pregunta. Anular no tiene vuelta
              // —el estado ya no puede volver a SOLICITADO— y aquí está a un
              // dedo de los otros tres iconos de la fila.
              <form ref={formularioAnular} action={accionMover} className="inline">
                <input type="hidden" name="id" value={servicio.id} />
                <input type="hidden" name="estado" value="ANULADO" />
                <button
                  type="button"
                  onClick={() => setAnulando(true)}
                  disabled={moviendo}
                  title="Anular la orden de servicio"
                  aria-label={`Anular ${servicio.numero}`}
                  className={cn(BOTON_ICONO, 'hover:text-peligro')}
                >
                  <Ban className="size-4" />
                </button>
              </form>
            )}
          </div>
        </TD>
      </TR>

      {(movido?.ok === false || conforme || pagado) && (
        <TR>
          <TD colSpan={7} className="py-1">
            <Aviso resultado={movido?.ok === false ? movido : (conforme ?? pagado)} />
          </TD>
        </TR>
      )}

      <Ventana
        abierta={ventana === 'conformidad'}
        alCerrar={() => setVentana(null)}
        titulo={`Conformidad de ${servicio.numero}`}
        descripcion={`${servicio.proveedor} · ${servicio.descripcion}`}
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

      <Ventana
        abierta={ventana === 'pago'}
        alCerrar={() => setVentana(null)}
        titulo={`Pago de ${servicio.numero}`}
        descripcion={`${servicio.proveedor} · ${formatearMoneda(Number(servicio.monto), servicio.moneda as CodigoMoneda)}`}
      >
        <form action={accionPagar} className="space-y-3">
          <input type="hidden" name="id" value={servicio.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Número de factura" htmlFor={`fac-${servicio.id}`} requerido>
              {/* Sin autocompletado: el navegador ofrecía aquí lo último que se
                  escribió en otro campo de texto, y una factura mal copiada se
                  arrastra hasta la contabilidad. */}
              <Entrada
                id={`fac-${servicio.id}`}
                name="numero_factura"
                required
                autoComplete="off"
                className="tabular"
                placeholder="F001-00001234"
              />
            </Campo>
            <Campo etiqueta="Fecha de la factura" htmlFor={`fecfac-${servicio.id}`} requerido>
              <Entrada
                id={`fecfac-${servicio.id}`}
                name="fecha_factura"
                type="date"
                required
                defaultValue={hoy}
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

      {/* El detalle dice qué trabajo se anula y de quién: en la fila del taller
          el número solo no alcanza para saber cuál se está tocando. */}
      <ConfirmarAccion
        abierta={anulando}
        alCerrar={() => setAnulando(false)}
        alConfirmar={() => {
          setAnulando(false)
          // Envía el formulario de siempre: la acción de servidor, sus campos y
          // su permiso se quedan tal cual estaban.
          formularioAnular.current?.requestSubmit()
        }}
        titulo={`¿Anular ${servicio.numero}?`}
        detalle={`Se anula «${servicio.descripcion}», de ${servicio.proveedor}, por ${formatearMoneda(Number(servicio.monto), servicio.moneda as CodigoMoneda)}. No hay vuelta atrás: si el trabajo se manda igual, hay que emitir otra orden con número nuevo.`}
        etiquetaConfirmar="Sí, anular"
      />
    </>
  )
}
