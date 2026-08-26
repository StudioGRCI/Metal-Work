'use client'

import { Check, DoorOpen, Landmark } from 'lucide-react'
import { useActionState } from 'react'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { fecha as formatearFecha, hoyLima } from '@/lib/format'
import { cn } from '@/lib/utils'

import { confirmarSalida, liberarTesoreria } from '../acciones'

type Liberacion = {
  liberado_en: string
  observacion: string | null
  liberador: { nombres: string; apellidos: string } | null
} | null

type Entrega = {
  id: string
  fecha_entrega: string
  salida_confirmada_en: string | null
  confirmador: { nombres: string; apellidos: string } | null
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
        <p className="text-sm font-medium text-texto">{titulo}</p>
        <div className="text-xs text-texto-suave">{detalle}</div>
      </div>
    </div>
  )
}

/**
 * Las tres compuertas del flujograma antes de que la unidad cruce portería:
 * papeles completos, tesorería confirma que el cliente está al día, y el aviso
 * final a portería. En ese orden, porque así está escrito el procedimiento.
 */
export function SalidaDeUnidad({
  ordenId,
  liberacion,
  entrega,
  documentosFaltantes,
  puedeLiberar,
  puedeConfirmar,
}: {
  ordenId: string
  liberacion: Liberacion
  entrega: Entrega
  documentosFaltantes: string[]
  puedeLiberar: boolean
  puedeConfirmar: boolean
}) {
  const [resultadoLiberar, liberar, liberando] = useActionState(liberarTesoreria, null)
  const [resultadoSalida, confirmar, confirmando] = useActionState(confirmarSalida, null)

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Salida de la unidad"
        descripcion="Papeles, tesorería y portería: las tres compuertas del procedimiento, en su orden."
      />
      <TarjetaCuerpo className="space-y-4">
        <Compuerta
          cumplida={documentosFaltantes.length === 0}
          titulo="Documentación obligatoria firmada"
          detalle={
            documentosFaltantes.length === 0
              ? 'Completa, incluido el check list de salida.'
              : `Falta: ${documentosFaltantes.join(', ')}.`
          }
        />

        <Compuerta
          cumplida={Boolean(liberacion)}
          titulo="Liberación de tesorería"
          detalle={
            liberacion ? (
              <>
                {liberacion.liberador
                  ? `${liberacion.liberador.nombres} ${liberacion.liberador.apellidos}`
                  : 'Tesorería'}
                {' · '}
                {formatearFecha(liberacion.liberado_en)}
                {liberacion.observacion && <span className="block">{liberacion.observacion}</span>}
              </>
            ) : (
              'El cliente tiene que estar al día antes de que la unidad salga.'
            )
          }
        />

        {!liberacion && puedeLiberar && (
          <form action={liberar} className="ml-8 flex flex-wrap items-end gap-2">
            <input type="hidden" name="orden_id" value={ordenId} />
            <Campo etiqueta="Constancia" htmlFor="observacion-liberacion" ayuda="Cómo se comprobó" className="min-w-64 flex-1">
              <Entrada
                id="observacion-liberacion"
                name="observacion"
                placeholder="Canceló el saldo con la factura F001-…"
              />
            </Campo>
            <Boton type="submit" tamano="sm" cargando={liberando}>
              <Landmark aria-hidden className="size-3.5" />
              Liberar salida
            </Boton>
            <div className="w-full">
              <Aviso resultado={resultadoLiberar} />
            </div>
          </form>
        )}

        <Compuerta
          cumplida={Boolean(entrega?.salida_confirmada_en)}
          titulo="Aviso a portería"
          detalle={
            entrega?.salida_confirmada_en ? (
              <>
                {entrega.confirmador
                  ? `${entrega.confirmador.nombres} ${entrega.confirmador.apellidos}`
                  : 'Confirmada'}
                {' · '}
                {formatearFecha(entrega.salida_confirmada_en)}
              </>
            ) : entrega ? (
              'El acta está registrada; falta avisar a portería que la unidad puede cruzar.'
            ) : (
              'Se habilita al registrar el acta de entrega.'
            )
          }
        />

        {entrega && !entrega.salida_confirmada_en && puedeConfirmar && (
          <form action={confirmar} className="ml-8">
            <input type="hidden" name="entrega_id" value={entrega.id} />
            <input type="hidden" name="orden_id" value={ordenId} />
            <Boton type="submit" tamano="sm" cargando={confirmando}>
              <DoorOpen aria-hidden className="size-3.5" />
              Avisar a portería
            </Boton>
            <div className="mt-1">
              <Aviso resultado={resultadoSalida} />
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
}) {
  const filas = [
    {
      titulo: 'OS de producción',
      regla: '3 días hábiles desde la emisión',
      limite: fechas.limite_os_produccion,
      cumplida: Boolean(fechas.primera_os),
    },
    {
      titulo: 'Diseño de la unidad',
      regla: '4 días hábiles desde la emisión',
      limite: fechas.limite_diseno,
      cumplida: false,
    },
    {
      titulo: 'OS de acabados',
      regla: '1 día hábil antes del arenado',
      limite: fechas.limite_os_acabados,
      cumplida: false,
    },
    {
      titulo: 'Certificados',
      regla: '2 días hábiles desde el término',
      limite: fechas.limite_certificados,
      cumplida: Boolean(fechas.fecha_entrega),
    },
    {
      titulo: 'Tarjeta de propiedad y placas',
      regla: '15 días hábiles desde el término',
      limite: fechas.limite_tarjeta_placas,
      cumplida: false,
    },
  ]

  // La fecha de hoy solo pinta el semáforo. En hora del taller, no en UTC:
  // de noche UTC ya va un día adelante y marcaba vencido lo que no lo estaba.
  const hoy = hoyLima()

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Fechas clave"
        descripcion="Las reglas de plazo que la empresa tiene escritas, calculadas en días de taller."
      />
      <TarjetaCuerpo className="space-y-0">
        {filas.map((f) => {
          const vencida = !f.cumplida && f.limite !== null && f.limite < hoy
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
