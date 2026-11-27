'use client'

import { Check, DoorOpen, Landmark } from 'lucide-react'
import Link from 'next/link'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada } from '@/components/ui/campos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { useEnvio } from '@/lib/envio'
import { fecha as formatearFecha, fechaHora, hoyLima, puesto } from '@/lib/format'
import { cn } from '@/lib/utils'

import { confirmarSalida, liberarTesoreria, registrarSalidaFisica } from '../acciones'
import type { estadoDeSalida } from '@/lib/datos/ordenes'
import type { TramiteDeLaOrden } from '@/lib/datos/tramites'
import { SITUACION_TRAMITE } from '@/lib/dominio/tramites'

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
  fisica,
  puedeRegistrarSalida,
  puedeLiberar,
  puedeConfirmar,
  puedeRegistrarEntrega,
}: {
  ordenId: string
  liberacion: Liberacion
  entrega: Entrega
  fisica: Awaited<ReturnType<typeof estadoDeSalida>>['fisica']
  puedeRegistrarSalida: boolean
  puedeLiberar: boolean
  puedeConfirmar: boolean
  puedeRegistrarEntrega: boolean
}) {
  // Con `useEnvio` la constancia se queda escrita si tesorería no puede liberar
  // todavía; antes el formulario se vaciaba con el rechazo.
  const liberar = useEnvio(liberarTesoreria)
  const confirmar = useEnvio(confirmarSalida)
  const salidaFisica = useEnvio(registrarSalidaFisica)
  const completados = Number(Boolean(liberacion)) + Number(Boolean(entrega)) + Number(Boolean(entrega?.salida_confirmada_en)) + Number(Boolean(fisica))

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Salida de la unidad"
        ayuda="Liberación, acta, aviso y constancia de salida física."
      />
      <TarjetaCuerpo className="space-y-4">
        <div className="rounded-[var(--radius-base)] bg-acento-suave px-3 py-2 text-sm text-acento">
          <p className="font-semibold">{completados} de 4 pasos registrados</p>
          <p className="mt-0.5 text-xs">
            {!liberacion ? 'Siguiente: Administración o Gerencia confirma la liberación de tesorería.'
              : !entrega ? 'Siguiente: el responsable de entrega registra el acta de conformidad.'
                : !entrega.salida_confirmada_en ? 'Siguiente: quien coordina la entrega avisa a portería.'
                  : !fisica ? 'Siguiente: el responsable de entrega registra la salida física cuando el vehículo haya salido.'
                    : 'Salida física registrada. El circuito de entrega está completo.'}
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
        <Compuerta cumplida={Boolean(fisica)} titulo="Salida física del vehículo"
          detalle={fisica ? <>{fechaHora(fisica.creado_en)} · {fisica.responsable?.cargo || 'Responsable de entrega'}<span className="block">{fisica.constancia}</span></>
            : 'El aviso a portería no sustituye la constancia de que el vehículo salió.'} />
        {entrega?.salida_confirmada_en && !fisica && puedeRegistrarSalida && <form onSubmit={salidaFisica.alEnviar} className="space-y-3 sm:ml-8">
          <input type="hidden" name="entrega_id" value={entrega.id} />
          <input type="hidden" name="orden_id" value={ordenId} />
          <Campo etiqueta="Constancia de salida" htmlFor="constancia-salida" requerido ayuda="Quién retiró la unidad y cómo se verificó la salida; 10 a 500 caracteres.">
            <Entrada id="constancia-salida" name="constancia" required minLength={10} maxLength={500} />
          </Campo>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="confirmada" required className="mt-1 accent-acento" />Confirmo que observé la salida del vehículo de esta orden.</label>
          <Boton type="submit" tamano="sm" cargando={salidaFisica.enviando}>Registrar salida física</Boton>
          <Aviso resultado={salidaFisica.resultado} />
        </form>}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

/** Las fechas límite de las reglas de plazo, con su semáforo contra hoy. */
export function FechasClave({
  fechas,
  disenoCumplida,
  tramites,
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
  /** Los trámites sin anular de la OT (`tramites_de_la_orden`); `null` si no se pudieron leer. */
  tramites: TramiteDeLaOrden[] | null
}) {
  // La tarjeta y las placas: los trámites que la OT abrió al terminar (entrega 4
  // del Tramitador). Se cumple cuando todos están concluidos; si alguno se
  // concluyó pasada su fecha límite, se cumplió con atraso.
  const {
    visibles: tramitesVisibles,
    deLaRegla,
    cumplida: tarjetaCumplida,
    conAtraso: tarjetaConAtraso,
    limite: limiteDeLaTarjeta,
  } = estadoDeLaTarjeta(tramites ?? [])
  // `semaforo` en falso: el sistema no sabe si esa regla se cumplió —la OS de
  // acabados se tramita fuera, y la tarjeta antes de que la OT termine— y
  // pintarla en rojo era mentir.
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
      // Con sus trámites abiertos, la fecha es la de ellos: la calcula la base al terminar.
      limite: limiteDeLaTarjeta ?? fechas.limite_tarjeta_placas,
      cumplida: tarjetaCumplida,
      conAtraso: tarjetaConAtraso,
      semaforo: deLaRegla.length > 0,
    },
  ]

  // La fecha de hoy solo pinta el semáforo. En hora del taller, no en UTC:
  // de noche UTC ya va un día adelante y marcaba vencido lo que no lo estaba.
  const hoy = hoyLima()

  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Fechas clave"
        ayuda="Las reglas de plazo que la empresa tiene escritas, calculadas en días de taller. La OS de acabados se tramita fuera: acá solo va su fecha límite. La tarjeta de propiedad y las placas las lleva el Tramitador: al terminar la unidad se abren solas, y acá se ve si se cumplieron."
      />
      <TarjetaCuerpo className="space-y-0">
        {filas.map((f) => {
          const vencida = f.semaforo && !f.cumplida && f.limite !== null && f.limite < hoy
          const conAtraso = 'conAtraso' in f && f.conAtraso
          return (
            <div
              key={f.titulo}
              className="flex items-center justify-between gap-3 border-b border-borde py-2 text-sm last:border-0"
            >
              <span>
                <span className="text-texto">{f.titulo}</span>
                <span className="block text-xs text-texto-tenue">{f.regla}</span>
              </span>
              <span
                className={cn(
                  'tabular whitespace-nowrap',
                  conAtraso ? 'text-aviso' : f.cumplida ? 'text-exito' : vencida ? 'font-medium text-peligro' : 'text-texto-suave',
                )}
                suppressHydrationWarning
              >
                {conAtraso ? 'Cumplida con atraso' : f.cumplida ? 'Cumplida' : f.limite ? formatearFecha(f.limite) : 'Por programar'}
              </span>
            </div>
          )
        })}
        {tramites === null ? (
          <p className="pt-3 text-sm text-aviso" role="status" data-tramites-sin-leer>
            No se pudieron leer los trámites de la OT: la tarjeta y las placas no dicen si se cumplieron. Recarga la pantalla.
          </p>
        ) : (
          tramitesVisibles.length > 0 && (
            <div className="pt-3">
              <ListaDeTramitesDeLaOt tramites={tramitesVisibles} />
            </div>
          )
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

/**
 * La tarjeta y las placas de la OT: cumplidas cuando todos sus trámites
 * concluyeron, con atraso si alguno pasó su límite. Cuentan los de los tipos
 * que abre la OT, también el que se registró a mano con ella.
 */
function estadoDeLaTarjeta(tramites: TramiteDeLaOrden[]) {
  const enPie = tramites.filter((t) => t.estado !== 'ANULADO')
  const deLaRegla = enPie.filter((t) => t.de_la_regla)
  // Uno de la regla que se anuló y no se volvió a abrir: la regla no se cumplió.
  const anuladosSinOtro = tramites.filter(
    (t) => t.estado === 'ANULADO' && t.de_la_regla && !deLaRegla.some((v) => v.tipo === t.tipo) && !tramites.some((v) => v !== t && v.estado === 'ANULADO' && v.tipo === t.tipo && v.numero > t.numero),
  )
  const cumplida = deLaRegla.length > 0 && anuladosSinOtro.length === 0 && deLaRegla.every((t) => t.estado === 'CONCLUIDO')
  return {
    // Lo que se lista: lo que está en pie y el anulado que dejó su tipo sin trámite.
    visibles: [...enPie, ...anuladosSinOtro],
    deLaRegla,
    anuladosSinOtro,
    cumplida,
    conAtraso: cumplida && deLaRegla.some((t) => t.fecha_conclusion !== null && t.fecha_limite !== null && t.fecha_conclusion > t.fecha_limite),
    limite: deLaRegla.reduce<string | null>((max, t) => (t.fecha_limite && (!max || t.fecha_limite > max) ? t.fecha_limite : max), null),
  }
}

function ListaDeTramitesDeLaOt({ tramites, conRotulo = true }: { tramites: TramiteDeLaOrden[]; conRotulo?: boolean }) {
  return (
    <div data-tramites-de-la-ot>
      {conRotulo && <p className="text-xs font-medium text-texto-suave">Trámites de la OT</p>}
      <ul className={cn('divide-y divide-borde', conRotulo && 'mt-1')}>
        {tramites.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm" data-tramite={t.numero}>
            <span className="min-w-0">
              {t.ve ? (
                <Link href={`/tramites/${t.id}`} className="tabular inline-flex min-h-11 items-center font-semibold text-acento hover:underline sm:min-h-0">
                  {t.numero}
                </Link>
              ) : (
                <span className="tabular font-semibold text-texto">{t.numero}</span>
              )}
              <span className="text-texto"> · {t.tipo}</span>
            </span>
            <span
              className={cn('tabular text-xs whitespace-nowrap', t.estado === 'CONCLUIDO' ? 'text-exito' : t.vencido ? 'font-medium text-peligro' : 'text-texto-suave')}
            >
              {t.estado === 'CONCLUIDO'
                ? `Concluido el ${formatearFecha(t.fecha_conclusion)}`
                : t.estado === 'ANULADO'
                  ? 'Anulado'
                : [SITUACION_TRAMITE[t.situacion]?.etiqueta ?? t.situacion, t.fecha_limite ? `${t.vencido ? 'venció' : 'vence'} el ${formatearFecha(t.fecha_limite)}` : null]
                    .filter(Boolean)
                    .join(' · ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Los trámites de la OT cuando no hay «Fechas clave» (las OT con plan de
 * etapas de Diseño, que son todas las nuevas): la tarjeta y las placas que
 * abrió al terminar, si se cumplieron, y cada trámite con su plazo.
 */
export function TramitesDeLaOt({ tramites }: { tramites: TramiteDeLaOrden[] | null }) {
  if (tramites === null) {
    return (
      <Tarjeta>
        <TarjetaCabecera titulo="Trámites de la OT" />
        <TarjetaCuerpo>
          <p className="text-sm text-aviso" role="status" data-tramites-sin-leer>
            No se pudieron leer los trámites de la OT. Recarga la pantalla; si sigue, avisa a quien administra el sistema.
          </p>
        </TarjetaCuerpo>
      </Tarjeta>
    )
  }
  const { visibles, deLaRegla, anuladosSinOtro, cumplida, conAtraso, limite } = estadoDeLaTarjeta(tramites)
  const vencida = deLaRegla.length > 0 && !cumplida && limite !== null && limite < hoyLima()
  const sinTramitar = anuladosSinOtro.length > 0
  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Trámites de la OT"
        ayuda="Los lleva el Tramitador. Cuando la unidad llega al 100 % de avance (o la OT se termina) se abren solos la tarjeta de propiedad y, si la unidad no tiene placa, las placas, con la fecha límite que fija su tipo en días hábiles desde el término; se cumplen cuando todos concluyen."
      />
      <TarjetaCuerpo className="space-y-3">
        {(deLaRegla.length > 0 || sinTramitar) && (
          <p className="flex items-center justify-between gap-3 border-b border-borde pb-3 text-sm" data-cumplimiento-tarjeta>
            <span>
              <span className="text-texto">Tarjeta de propiedad y placas</span>
              <span className="block text-xs text-texto-tenue">Hasta la fecha límite de sus trámites</span>
            </span>
            <span
              className={cn(
                'tabular whitespace-nowrap',
                sinTramitar || conAtraso ? 'text-aviso' : cumplida ? 'text-exito' : vencida ? 'font-medium text-peligro' : 'text-texto-suave',
              )}
              suppressHydrationWarning
            >
              {sinTramitar
                ? `${anuladosSinOtro.map((t) => t.tipo).join(' y ')}: anulado, sin otro`
                : conAtraso
                  ? 'Cumplida con atraso'
                  : cumplida
                    ? 'Cumplida'
                    : limite
                      ? `${vencida ? 'Venció el' : 'Vence el'} ${formatearFecha(limite)}`
                      : 'Por programar'}
            </span>
          </p>
        )}
        <ListaDeTramitesDeLaOt tramites={visibles} conRotulo={false} />
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
