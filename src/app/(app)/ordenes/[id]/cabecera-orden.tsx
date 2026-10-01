import { FileText, Truck, CalendarDays } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia, Punto } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { cotizacionPdfDeOrden } from '@/lib/datos/cotizaciones-pdf'
import type { obtenerOrden } from '@/lib/datos/ordenes'
import { situacionDeEntrega } from '@/lib/dominio/expediente'
import { PRIORIDAD, TIPO_TRABAJO, definir, estadoDeOrden } from '@/lib/dominio/estados'
import { nombreDeUnidad } from '@/lib/dominio/unidades'
import { fecha, hoyLima, numero as fmtNumero } from '@/lib/format'
import { puede, type PerfilSesion } from '@/lib/sesion'

import { AccionesEstado } from './acciones-estado'
import { Pestanas } from './pestanas'

/** Estados en los que la orden ya no corre plazo: no puede estar atrasada. */
export const ESTADOS_CERRADOS: string[] = ['ENTREGADA', 'FACTURADA', 'ANULADA']

/**
 * En la OT solo Gerencia, Administración y Tesorería consultan el documento
 * comercial. Ventas conserva su propia pantalla de cotizaciones.
 */
export function veCotizacionEnOt(perfil: PerfilSesion) {
  return ['GERENTE', 'ADMINISTRACION', 'TESORERIA', 'ADMIN'].includes(perfil.rol.codigo)
}

/** Lo que se dice bajo la fecha prometida: cuánto falta, o hace cuánto venció. */
function pieDeEntrega(finReal: string | null, comprometida: string | null, cerrada: boolean) {
  if (finReal) return `Trabajo terminado el ${fecha(finReal)}`
  if (cerrada) return 'Fecha prometida al cliente'
  return situacionDeEntrega(comprometida, null, hoyLima()).pie
}

type Orden = NonNullable<Awaited<ReturnType<typeof obtenerOrden>>>

/**
 * Lo primero de cada pestaña de la OT, y lo mismo en todas: de quién es, en qué
 * estado está, sus avisos, cuánto avanzó y cuándo se entrega. Antes Planos tenía
 * otra cabecera —sin estado, sin cliente, sin avance— y al pasar de una pestaña
 * a otra cambiaba todo lo de arriba, no solo el contenido.
 */
export function CabeceraDeOrden({ orden, perfil, vista, secciones, contadores, cotizacionPdf, creada = false, abierta = false }: {
  orden: Orden
  perfil: PerfilSesion
  vista: string
  secciones: string[]
  contadores?: Record<string, number>
  cotizacionPdf: Awaited<ReturnType<typeof cotizacionPdfDeOrden>> | null
  /** Se llega recién registrada (`?creada=1`). */
  creada?: boolean
  /** Se llega recién abierta por el taller (`?abierta=1`). */
  abierta?: boolean
}) {
  const estado = estadoDeOrden(orden.estado, orden.abierta_en_taller)
  const porRevisar = orden.abierta_en_taller && orden.estado === 'BORRADOR'
  const prioridad = definir(PRIORIDAD, orden.prioridad)
  // Puede venir vacío: quien no tiene `clientes.ver` abre la orden igual, pero
  // sin los datos del cliente.
  const cliente = orden.cliente as unknown as { razon_social: string } | null
  const unidad = orden.unidad as unknown as {
    placa: string | null
    numero_fmi: string | null
    codigo_interno: string | null
  } | null
  const tipoCarroceria = orden.tipo_carroceria as unknown as { nombre: string } | null
  const esResumen = vista === 'resumen'

  // Comparación de texto contra la fecha de hoy en el taller: son fechas planas
  // YYYY-MM-DD y `hoyLima()` da la del taller, no la de UTC, que de noche ya va
  // un día adelante y pintaba de rojo lo que todavía estaba en plazo. Esto es un
  // componente de servidor, así que el navegador no lo vuelve a calcular y no
  // hay error de hidratación que suprimir.
  const entregaVencida = Boolean(
    orden.fecha_entrega_comprometida &&
      !orden.fecha_fin_real &&
      !ESTADOS_CERRADOS.includes(orden.estado) &&
      orden.fecha_entrega_comprometida < hoyLima(),
  )

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Órdenes de trabajo', ruta: '/ordenes' }, { titulo: orden.numero }]}
        titulo={
          <span className="flex flex-wrap items-center gap-3">
            {orden.numero}
            <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
            <span className="flex items-center gap-1 text-xs font-normal text-texto-suave">
              <Punto tono={prioridad.tono} />
              {prioridad.etiqueta}
            </span>
          </span>
        }
        descripcion={
          /* Quien abre una orden busca primero de quién es y qué unidad: el
             número solo no lo dice. Van en <span> porque la descripción ya es
             un <p>. */
          <>
            {cliente?.razon_social && (
              <span className="block font-medium text-texto">{cliente.razon_social}</span>
            )}
            <span className="block">
              {[unidad ? nombreDeUnidad(unidad) : null, orden.descripcion].filter(Boolean).join(' · ')}
            </span>
          </>
        }
        acciones={
          <AccionesEstado
            orden={{ id: orden.id, estado: orden.estado, abiertaEnTaller: orden.abierta_en_taller }}
            permisos={perfil.permisos}
            esAdmin={perfil.rol.codigo === 'ADMIN'}
          />
        }
      />

      {creada && orden.estado === 'BORRADOR' && (
        <p className="mb-4 rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-sm text-exito">
          {/* A quien no aprueba no se le pide que apruebe: se le dice quién lo hace. */}
          {puede(perfil, 'ordenes.aprobar')
            ? 'Orden registrada. Apruébala para que Diseño pueda definir las etapas.'
            : 'Orden registrada. Falta su aprobación para que Diseño pueda definir las etapas.'}
        </p>
      )}

      {/* La que abrió el taller: se dice quién la revisa y que el trabajo no
          espera. Al abrirla se llega acá, a la pestaña de actividades. */}
      {porRevisar && (
        <p
          role={abierta ? 'status' : undefined}
          className="mb-4 rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-sm text-aviso"
        >
          {abierta ? <strong>Orden abierta. </strong> : <strong>Por revisar. </strong>}
          La abrió el taller y espera que Administración la apruebe o la rechace; ya se le
          avisó. Administración revisará sus datos; después Diseño definirá las etapas y Administración programará las fechas.
        </p>
      )}

      {orden.estado === 'PAUSADA' && orden.motivo_pausa && (
        <p className="mb-4 rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-sm text-aviso">
          <strong>Orden pausada:</strong> {orden.motivo_pausa}
        </p>
      )}
      {orden.estado === 'ANULADA' && orden.motivo_anulacion && (
        <p className="mb-4 rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-sm text-peligro">
          <strong>Orden anulada:</strong> {orden.motivo_anulacion}
        </p>
      )}

      {/* En el monitor las secciones viven en la barra lateral: el contenedor
          se oculta pero el componente se monta igual, porque es el que las
          publica allí. */}
      <div className="mb-4 lg:hidden"><Pestanas ordenId={orden.id} numero={orden.numero} activa={vista} contadores={contadores} visibles={secciones} /></div>
      <Tarjeta className={esResumen?'overflow-hidden border-acento/20':'border-borde shadow-none'}>
        <TarjetaCuerpo className={esResumen?'grid items-center gap-6 bg-gradient-to-r from-acento-suave/50 to-superficie p-5 sm:grid-cols-[minmax(0,1fr)_auto]':'flex flex-wrap items-center gap-x-6 gap-y-3 py-3'}>
          <div className={esResumen?'flex min-w-0 items-center gap-4':'flex min-w-44 flex-1 items-center gap-3'}>
            {esResumen&&<span className="hidden size-14 shrink-0 items-center justify-center rounded-2xl bg-acento-suave text-acento sm:flex"><Truck aria-hidden className="size-7"/></span>}
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-baseline justify-between gap-4">
                <span className="text-xs font-medium text-texto-suave">Avance de la unidad</span>
                <strong className="tabular text-lg text-texto">{fmtNumero(orden.avance_porcentaje,1)} %</strong>
              </div>
              <Progreso valor={orden.avance_porcentaje} etiqueta="Avance de la orden de trabajo" alto={esResumen?'md':'sm'}/>
              {/* El número suma todos los reportes de las áreas, revisados o no
                  (migración 097: la aprobación es el visto bueno, no la llave
                  del porcentaje). Decía «aprobado» y no lo era. */}
              {esResumen&&<p className="mt-2 text-xs text-texto-suave">Según lo que reportan las áreas · {tipoCarroceria?.nombre??definir(TIPO_TRABAJO,orden.tipo_trabajo).etiqueta} · <Link href={`/ordenes/${orden.id}/expediente`} className="font-medium text-acento hover:underline">Ver expediente</Link></p>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-2">
              <CalendarDays aria-hidden className="size-4 shrink-0 text-texto-suave"/>
              <div><p className="text-xs text-texto-suave">Entrega comprometida</p><p className={entregaVencida?'tabular font-semibold text-peligro':'tabular font-semibold text-texto'}>{fecha(orden.fecha_entrega_comprometida)}</p>
                {esResumen&&<p className={entregaVencida?'mt-1 max-w-48 text-xs text-peligro':'mt-1 max-w-48 text-xs text-texto-suave'}>{pieDeEntrega(orden.fecha_fin_real,orden.fecha_entrega_comprometida,ESTADOS_CERRADOS.includes(orden.estado))}</p>}
              </div>
            </div>
            {cotizacionPdf&&<div className="border-l border-borde pl-4"><p className="text-xs text-texto-suave">Cotización {cotizacionPdf.numero}</p>
              {cotizacionPdf.url?<a href={cotizacionPdf.url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-acento hover:underline"><FileText aria-hidden className="size-4"/>{cotizacionPdf.revisionPendiente?'PDF aprobado anterior':'Abrir cotización'}</a>:<p className="text-xs text-aviso">PDF no disponible</p>}
            </div>}
          </div>
        </TarjetaCuerpo>
      </Tarjeta>
    </>
  )
}
