'use client'

import { Check, DoorOpen, Landmark } from 'lucide-react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { useEnvio } from '@/lib/envio'
import { fecha as formatearFecha, fechaHora, hoyLima, puesto } from '@/lib/format'
import { cn } from '@/lib/utils'

import { confirmarSalida, liberarTesoreria } from '../acciones'

type Liberacion = {
  liberado_en: string
  observacion: string | null
  liberador: { puesto: string | null } | null
} | null

type Entrega = {
  id: string
  fecha_entrega: string
  salida_confirmada_en: string | null
  confirmador: { puesto: string | null } | null
} | null

function Aviso({ resultado }: { resultado: { ok?: boolean; error?: string; mensaje?: string } | null }) {
  if (!resultado?.mensaje && resultado?.ok !== false) return null
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

function Compuerta({
  cumplida,
  titulo,
  detalle,
}: {
  cumplida: boolean
  titulo: string
  detalle: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
          cumplida ? 'border-exito bg-exito-suave text-exito' : 'border-borde-fuerte text-transparent',
        )}
      >
        <Check className="size-3.5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-medium text-texto">{titulo}<span className="sr-only">{cumplida ? ': completado' : ': pendiente'}</span></p>
        <div className="text-xs text-texto-suave">{detalle}</div>
      </div>
    </div>
  )
}

/**
 * Tesorería, acta y aviso a portería. Los sellos reales determinan qué falta;
 * el estado FACTURADA por sí solo no demuestra que se haya avisado la salida.
 */
export function SalidaDeUnidad({
  ordenId,
  liberacion,
  entrega,
  puedeLiberar,
  puedeConfirmar,
  puedeRegistrarEntrega,
}: {
  ordenId: string
  liberacion: Liberacion
  entrega: Entrega
  puedeLiberar: boolean
  puedeConfirmar: boolean
  puedeRegistrarEntrega: boolean
}) {
  // Con `useEnvio` la constancia se queda escrita si tesorería no puede liberar
  // todavía; antes el formulario se vaciaba con el rechazo.
  const liberar = useEnvio(liberarTesoreria)
  const confirmar = useEnvio(confirmarSalida)
  const completados = Number(Boolean(liberacion)) + Number(Boolean(entrega)) + Number(Boolean(entrega?.salida_confirmada_en))

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Salida de la unidad"
        descripcion="Completa la liberación, registra el acta y avisa a portería."
      />
      <TarjetaCuerpo className="space-y-4">
        <div className="rounded-[var(--radius-base)] bg-acento-suave px-3 py-2 text-sm text-acento">
          <p className="font-semibold">{completados} de 3 pasos registrados</p>
          <p className="mt-0.5 text-xs">
            {!liberacion ? 'Siguiente: Administración o Gerencia confirma la liberación de tesorería.'
              : !entrega ? 'Siguiente: el responsable de entrega registra el acta de conformidad.'
                : !entrega.salida_confirmada_en ? 'Siguiente: quien coordina la entrega avisa a portería.'
                  : 'Liberación, acta y aviso registrados. El aviso autoriza la salida; no registra el cruce físico del vehículo.'}
          </p>
        </div>
        <Compuerta
          cumplida={Boolean(liberacion)}
          titulo="Liberación de tesorería"
          detalle={
            liberacion ? (
              <>
                {liberacion.liberador
                  ? puesto(liberacion.liberador)
                  : 'Tesorería'}
                {' · '}
                {fechaHora(liberacion.liberado_en)}
                {liberacion.observacion && <span className="block">{liberacion.observacion}</span>}
              </>
            ) : (
              'El cliente tiene que estar al día antes de que la unidad salga.'
            )
          }
        />

        {!liberacion && puedeLiberar && (
          /* La sangría alinea el formulario con el texto de su compuerta; en el
             teléfono esos 32 px son casi un décimo del ancho y se sueltan. */
          <form onSubmit={liberar.alEnviar} className="flex flex-wrap items-end gap-2 sm:ml-8">
            <input type="hidden" name="orden_id" value={ordenId} />
            <Campo etiqueta="Constancia" htmlFor="observacion-liberacion" ayuda="Cómo se comprobó" className="min-w-64 flex-1">
              <Entrada
                id="observacion-liberacion"
                name="observacion"
                placeholder="Canceló el saldo con la factura F001-…"
              />
            </Campo>
            <Boton type="submit" tamano="sm" cargando={liberar.enviando}>
              <Landmark aria-hidden className="size-3.5" />
              Liberar salida
            </Boton>
            <div className="w-full">
              <Aviso resultado={liberar.resultado} />
            </div>
          </form>
        )}

        <Compuerta
          cumplida={Boolean(entrega)}
          titulo="Acta de entrega"
          detalle={entrega
            ? `Registrada el ${formatearFecha(entrega.fecha_entrega)}`
            : liberacion
              ? puedeRegistrarEntrega
                ? 'Salida liberada. Usa «Registrar entrega» en la cabecera para guardar la conformidad del cliente.'
                : 'Salida liberada. Falta que el responsable de la entrega registre el acta de conformidad del cliente.'
              : 'Primero se necesita la liberación de tesorería.'}
        />

        <Compuerta
          cumplida={Boolean(entrega?.salida_confirmada_en)}
          titulo="Aviso a portería"
          detalle={
            entrega?.salida_confirmada_en ? (
              <>
                {entrega.confirmador
                  ? puesto(entrega.confirmador)
                  : 'Confirmada'}
                {' · '}
                {fechaHora(entrega.salida_confirmada_en)}
              </>
            ) : entrega ? (
              'El acta está registrada; falta avisar a portería que la unidad puede cruzar.'
            ) : (
              'Se habilita al registrar el acta de entrega.'
            )
          }
        />

        {entrega && !entrega.salida_confirmada_en && puedeConfirmar && (
          <form onSubmit={confirmar.alEnviar} className="sm:ml-8">
            <input type="hidden" name="entrega_id" value={entrega.id} />
            <input type="hidden" name="orden_id" value={ordenId} />
            <Boton type="submit" tamano="sm" cargando={confirmar.enviando}>
              <DoorOpen aria-hidden className="size-3.5" />
              Avisar a portería
            </Boton>
            <div className="mt-1">
              <Aviso resultado={confirmar.resultado} />
            </div>
          </form>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

/** Las fechas límite de las reglas de plazo, con su semáforo contra hoy. */
export function FechasClave({
  fechas,
  disenoCumplida,
}: {
  fechas: {
    limite_os_produccion: string | null
    limite_diseno: string | null
    limite_os_acabados: string | null
    limite_certificados: string | null
    limite_tarjeta_placas: string | null
    primera_os: string | null
    fecha_entrega: string | null
  }
  /** Diseño entregó todos los planos de la hoja de cumplimiento. */
  disenoCumplida: boolean
}) {
  // `semaforo` en falso: el sistema no sabe si esa regla se cumplió —la OS de
  // acabados y la tarjeta se tramitan fuera— y pintarla en rojo era mentir.
  const filas = [
    {
      titulo: 'OS de producción',
      regla: '3 días hábiles desde la emisión',
      limite: fechas.limite_os_produccion,
      cumplida: Boolean(fechas.primera_os),
      semaforo: true,
    },
    {
      titulo: 'Diseño de la unidad',
      regla: '4 días hábiles desde la emisión',
      limite: fechas.limite_diseno,
      cumplida: disenoCumplida,
      semaforo: true,
    },
    {
      titulo: 'OS de acabados',
      regla: '1 día hábil antes del arenado',
      limite: fechas.limite_os_acabados,
      cumplida: false,
      semaforo: false,
    },
    {
      titulo: 'Certificados',
      regla: '2 días hábiles desde el término',
      limite: fechas.limite_certificados,
      cumplida: Boolean(fechas.fecha_entrega),
      semaforo: true,
    },
    {
      titulo: 'Tarjeta de propiedad y placas',
      regla: '15 días hábiles desde el término',
      limite: fechas.limite_tarjeta_placas,
      cumplida: false,
      semaforo: false,
    },
  ]

  // La fecha de hoy solo pinta el semáforo. En hora del taller, no en UTC:
  // de noche UTC ya va un día adelante y marcaba vencido lo que no lo estaba.
  const hoy = hoyLima()

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Fechas clave"
        descripcion="Las reglas de plazo que la empresa tiene escritas, calculadas en días de taller. La OS de acabados y la tarjeta se tramitan fuera: acá solo va su fecha límite."
      />
      <TarjetaCuerpo className="space-y-0">
        {filas.map((f) => {
          const vencida = f.semaforo && !f.cumplida && f.limite !== null && f.limite < hoy
          return (
            <div
              key={f.titulo}
              className="flex items-center justify-between gap-3 border-b border-borde py-2 text-sm last:border-0"
            >
              <span>
                <span className="text-texto">{f.titulo}</span>
                <span className="block text-[11px] text-texto-tenue">{f.regla}</span>
              </span>
              <span
                className={cn(
                  'tabular whitespace-nowrap',
                  f.cumplida ? 'text-exito' : vencida ? 'font-medium text-peligro' : 'text-texto-suave',
                )}
                suppressHydrationWarning
              >
                {f.cumplida ? 'Cumplida' : f.limite ? formatearFecha(f.limite) : 'Por programar'}
              </span>
            </div>
          )
        })}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
