import { CheckCircle2, Circle, Clock, Coins, FileText, Gauge, Truck } from 'lucide-react'
import { notFound, redirect } from 'next/navigation'
import type { Metadata } from 'next'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { ComposicionDelCosto } from '@/components/expediente/composicion-costo'
import { PlanContraReal } from '@/components/expediente/plan-contra-real'
import { Insignia, type Tono } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Progreso } from '@/components/ui/progreso'
import { Tabla, TablaCabecera, TD, TH, TR } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cotizacionPdfDeOrden } from '@/lib/datos/cotizaciones-pdf'
import { expedienteDeOrden, type Expediente, type LineaCosto, type PresupuestoExpediente } from '@/lib/datos/expediente'
import { observacionesDeOrden } from '@/lib/datos/observaciones'
import { obtenerOrden, timelineDeOrden } from '@/lib/datos/ordenes'
import { pendientesDeOrden } from '@/lib/datos/pendientes-ot'
import { seccionesDeOrden } from '@/lib/dominio/acceso-orden'
import {
  ESTADO_ETAPA,
  REVISION,
  TIPO_EVENTO_BITACORA,
  TIPO_TRABAJO,
  definir,
  estadoDeOrden,
} from '@/lib/dominio/estados'
import {
  FUENTES_COSTO,
  composicionDelCosto,
  cumplimientoDeEtapa,
  diaDeLima,
  dias,
  situacionDeEntrega,
  tiempoEnTaller,
} from '@/lib/dominio/expediente'
import { nombreDeUnidad } from '@/lib/dominio/unidades'
import { cantidad, fecha, fechaHora, fechaLarga, hora, hoyLima, moneda, numero, porcentaje } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { cn } from '@/lib/utils'

import { Pestanas } from '../pestanas'
import { queMeToca } from '../te-toca'
import { CerrarCosto, ConfirmarIgv, FijarPresupuesto } from './acciones-costo'
import { BotonImprimir } from './imprimir'

export async function generateMetadata({ params }: PageProps<'/ordenes/[id]/expediente'>): Promise<Metadata> {
  const { id } = await params
  const orden = await obtenerOrden(id)
  return { title: orden ? `Expediente ${orden.numero}` : 'Orden no encontrada' }
}

const ESTADOS_CERRADOS = ['ENTREGADA', 'FACTURADA', 'ANULADA']

/** El tono del punto de la bitácora según el tipo de evento. */
const TONO_PUNTO: Record<Tono, string> = {
  neutro: 'bg-texto-tenue',
  exito: 'bg-exito',
  aviso: 'bg-aviso',
  peligro: 'bg-peligro',
  info: 'bg-info',
  acento: 'bg-acento',
}

/**
 * El expediente de fabricación de una unidad: la respuesta, en una sola hoja, a
 * «¿cuánto va?», «¿cuánto costó?» y «¿cómo se hizo?».
 *
 * Junta lo que hoy vive en ocho pestañas —etapas, hoja de cada área, fotos,
 * costo, observaciones, entrega e historial— y lo ordena como se cuenta una
 * fabricación: qué se prometió, cómo se ejecutó contra eso, qué costó y qué
 * pasó cada día, con su foto. Se imprime o se guarda en PDF para Gerencia o
 * para el cliente; el costo solo aparece para quien tiene `costos.ver`.
 */
export default async function PaginaExpediente({ params }: PageProps<'/ordenes/[id]/expediente'>) {
  const perfil = await exigirPermiso('ordenes.ver')
  const { id } = await params
  const secciones = seccionesDeOrden(perfil)
  if (!secciones.includes('expediente')) redirect('/sin-permiso')

  const verCosteo = puede(perfil, 'costos.ver')
  // El margen se arma con el precio de venta: lo ve quien ve el costo y además
  // el documento comercial (la misma llave que exige `margen_ot`).
  const verMargen = verCosteo && puede(perfil, 'cotizaciones.ver_pdf_comercial')
  const puedeConfirmarIgv = puede(perfil, ['cotizaciones.crear', 'cotizaciones.revisar', 'cotizaciones.liberar_tesoreria'])
  const puedeCerrarCosto = puede(perfil, ['costos.controlar_ot', 'ordenes.editar'])
  // Las llaves de `fijar_presupuesto_ot`: decidir y, además, ver costo y precio.
  const puedeFijarPresupuesto = verMargen && puede(perfil, ['cotizaciones.revisar', 'ordenes.editar'])
  // La misma regla que el resumen de la OT: el documento comercial solo lo
  // abren Gerencia, Administración y Tesorería.
  const verCotizacion = ['GERENTE', 'ADMINISTRACION', 'TESORERIA', 'ADMIN'].includes(perfil.rol.codigo)

  const [orden, pendientes, expediente, eventos, observaciones, cotizacion] = await Promise.all([
    obtenerOrden(id),
    pendientesDeOrden(id),
    expedienteDeOrden(id, { verCosteo, verMargen }),
    timelineDeOrden(id, 300),
    observacionesDeOrden(id),
    verCotizacion ? cotizacionPdfDeOrden(id) : Promise.resolve(null),
  ])
  if (!orden) notFound()

  const hoy = hoyLima()
  const viva = !ESTADOS_CERRADOS.includes(orden.estado)
  const toca = queMeToca(perfil, pendientes, orden, expediente.etapas.length)
  const estado = estadoDeOrden(orden.estado, orden.abierta_en_taller)

  const cliente = orden.cliente as unknown as { razon_social: string; numero_documento: string } | null
  const unidad = orden.unidad as unknown as {
    placa: string | null
    numero_fmi: string | null
    codigo_interno: string | null
    marca: string | null
    modelo: string | null
    anio: number | null
    numero_chasis: string | null
  } | null
  const tipoCarroceria = orden.tipo_carroceria as unknown as { nombre: string } | null

  const terminadas = expediente.etapas.filter((e) => e.estado === 'TERMINADA').length
  const entregaReal = expediente.acta?.fecha_entrega ?? null
  const entrega = situacionDeEntrega(orden.fecha_entrega_comprometida, entregaReal, hoy)
  const taller = tiempoEnTaller(orden.fecha_inicio_real, orden.fecha_fin_real ?? entregaReal, hoy)
  const composicion = expediente.costo ? composicionDelCosto(expediente.costo.resumen) : null
  const enSoles = enSolesDe(expediente)
  const conFoto = expediente.reportes.filter((r) => r.foto_url)

  const medidas = [orden.largo_m, orden.ancho_m, orden.alto_m].every((m) => m !== null)
    ? `${numero(orden.largo_m, 2)} × ${numero(orden.ancho_m, 2)} × ${numero(orden.alto_m, 2)} m`
    : null

  return (
    <>
      <EncabezadoPagina
        migas={[
          { titulo: 'Órdenes de trabajo', ruta: '/ordenes' },
          { titulo: orden.numero, ruta: `/ordenes/${orden.id}` },
          { titulo: 'Expediente' },
        ]}
        titulo={
          <span className="flex flex-wrap items-center gap-3">
            Expediente de fabricación · {orden.numero}
            <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
          </span>
        }
        descripcion={
          <>
            {cliente?.razon_social && <span className="block font-medium text-texto">{cliente.razon_social}</span>}
            <span className="block">
              {[unidad ? nombreDeUnidad(unidad) : null, tipoCarroceria?.nombre, orden.descripcion].filter(Boolean).join(' · ')}
            </span>
          </>
        }
        acciones={<BotonImprimir />}
      />

      <div className="mb-4">
        <Pestanas ordenId={orden.id} numero={orden.numero} activa="expediente" contadores={toca.contadores} visibles={secciones} />
      </div>

      {/* Lo que la hoja impresa necesita y la pantalla ya dice arriba. */}
      <p className="mb-4 hidden text-xs text-texto-suave print:block">
        Metal Work · Expediente emitido el {fechaLarga(hoy)}. Costos y avance a esa fecha.
      </p>

      {/* En pastillas, como las secciones de la OT: en texto suelto se leían
          como cuatro enlaces cualquiera y no como el índice de la hoja. */}
      <nav
        aria-label="Contenido del expediente"
        className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 text-sm whitespace-nowrap [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 print:hidden"
      >
        {[
          ['#plan', 'Plan contra real'],
          ['#areas', 'Avance por área'],
          ...(expediente.costo ? [['#costo', 'Costo']] : []),
          ['#proceso', 'Cómo se fabricó'],
          ['#entrega', 'Entrega'],
          ...(conFoto.length > 0 ? [['#fotos', 'Fotos']] : []),
        ].map(([href, titulo]) => (
          <a
            key={href}
            href={href}
            className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-borde bg-superficie px-3.5 text-texto-suave transition-colors hover:border-acento/40 hover:text-acento sm:min-h-9"
          >
            {titulo}
          </a>
        ))}
      </nav>

      <div className="space-y-5">
        {/* ----------------------------------------------------- las cifras */}
        <section aria-label="Resumen" className="no-partir grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Indicador
            titulo="Avance"
            icono={Gauge}
            tono={Number(orden.avance_porcentaje) >= 100 ? 'exito' : 'acento'}
            valor={
              <div>
                <span>{numero(orden.avance_porcentaje, 1)} %</span>
                <Progreso valor={orden.avance_porcentaje} alto="sm" className="mt-2" etiqueta="Avance de la unidad" />
              </div>
            }
            pie={expediente.etapas.length > 0 ? `${terminadas} de ${expediente.etapas.length} etapas terminadas` : 'Sin etapas definidas'}
          />
          <Indicador
            titulo="Tiempo en taller"
            icono={Clock}
            valor={taller ? dias(taller.dias) : '—'}
            pie={
              taller
                ? taller.cerrado
                  ? `Del ${fecha(taller.desde)} al ${fecha(taller.hasta)}`
                  : `Desde el ${fecha(taller.desde)}`
                : 'Todavía no empieza'
            }
          />
          <Indicador
            titulo={entregaReal ? 'Entregada' : 'Entrega comprometida'}
            icono={Truck}
            tono={entrega.tono === 'peligro' ? 'peligro' : entrega.tono === 'exito' ? 'exito' : entrega.tono === 'aviso' ? 'aviso' : 'neutro'}
            valor={fecha(entregaReal ?? orden.fecha_entrega_comprometida)}
            pie={entrega.pie}
          />
          {composicion ? (
            <Indicador
              titulo="Costo acumulado"
              icono={Coins}
              valor={moneda(enSoles.total)}
              pie={
                composicion.sinPrecio > 0
                  ? `${composicion.sinPrecio} despacho(s) sin precio: el costo está incompleto`
                  : enSoles.sinCambio > 0
                    ? `${enSoles.sinCambio} línea(s) en dólares sin tipo de cambio`
                    : expediente.margen?.margen_pct != null
                      ? `Margen ${porcentaje(expediente.margen.margen_pct, 1)} sobre la venta sin IGV`
                      : enSoles.totalUsd > 0
                        ? `Incluye ${moneda(enSoles.totalUsd, 'USD')} al cambio de su fecha`
                        : 'Material despachado, planilla cerrada y gastos aprobados'
              }
              tono={composicion.sinPrecio > 0 || enSoles.sinCambio > 0 ? 'aviso' : 'neutro'}
            />
          ) : (
            <Indicador
              titulo="Reportes del taller"
              icono={FileText}
              valor={expediente.reportes.length}
              pie={`${conFoto.length} con foto`}
            />
          )}
        </section>

        {/* ------------------------------------------------- los hitos */}
        {/* Van antes que los datos de la unidad: dicen en qué paso va la orden,
            que es lo primero que se pregunta. */}
        <Tarjeta className="no-partir">
          <TarjetaCabecera titulo="Hitos" descripcion="Los pasos que toda carrocería recorre, con su fecha" />
          <TarjetaCuerpo>
            <Hitos orden={orden} expediente={expediente} />
          </TarjetaCuerpo>
        </Tarjeta>

        {/* ------------------------------------------------- la unidad */}
        <Tarjeta className="no-partir">
          <TarjetaCabecera titulo="La unidad" descripcion="Qué se fabricó y para quién" />
          <TarjetaCuerpo>
            <dl className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
              <Dato etiqueta="Cliente" valor={cliente?.razon_social} />
              <Dato etiqueta="Documento" valor={cliente?.numero_documento} />
              <Dato etiqueta="Unidad" valor={nombreDeUnidad(unidad)} />
              <Dato etiqueta="Vehículo" valor={[unidad?.marca, unidad?.modelo, unidad?.anio].filter(Boolean).join(' ') || null} />
              <Dato etiqueta="N.º de chasis" valor={unidad?.numero_chasis} />
              <Dato etiqueta="Carrocería" valor={tipoCarroceria?.nombre} />
              <Dato etiqueta="Tipo de trabajo" valor={definir(TIPO_TRABAJO, orden.tipo_trabajo).etiqueta} />
              <Dato etiqueta="Medidas (largo × ancho × alto)" valor={medidas} />
              <Dato etiqueta="Capacidad" valor={orden.capacidad_carga} />
              <Dato etiqueta="Ejes" valor={orden.cantidad_ejes} />
              <Dato etiqueta="Colores" valor={orden.colores} />
              <Dato etiqueta="Orden registrada" valor={fecha(orden.fecha_registro)} />
              {cotizacion && (
                <div className="flex justify-between gap-4 border-b border-borde py-2 text-sm">
                  <dt className="shrink-0 text-texto-suave">Cotización</dt>
                  <dd className="min-w-0 text-right font-medium text-texto">
                    {cotizacion.url ? (
                      <a href={cotizacion.url} target="_blank" rel="noreferrer" className="text-acento hover:underline">
                        {cotizacion.numero}
                      </a>
                    ) : (
                      cotizacion.numero
                    )}
                  </dd>
                </div>
              )}
            </dl>
          </TarjetaCuerpo>
        </Tarjeta>

        {/* ----------------------------------------- el plan contra lo real */}
        <Tarjeta id="plan" className="scroll-mt-20">
          <TarjetaCabecera
            titulo="Plan contra real"
            descripcion="Lo que Administración programó para cada etapa y lo que de verdad tomó"
          />
          <TarjetaCuerpo className="space-y-5">
            {expediente.etapas.length === 0 ? (
              <p className="text-sm text-texto-suave">
                Diseño todavía no definió las etapas de esta orden. Se definen en la pestaña Etapas.
              </p>
            ) : (
              <>
                <PlanContraReal etapas={expediente.etapas} hoy={hoy} viva={viva} />
                <Tabla>
                  <TablaCabecera>
                    <tr>
                      <TH>Etapa</TH>
                      <TH className="hidden md:table-cell">Área</TH>
                      <TH className="text-right">Peso</TH>
                      <TH className="text-right">Avance</TH>
                      <TH className="hidden sm:table-cell">Programado</TH>
                      <TH className="hidden sm:table-cell">Real</TH>
                      <TH>Cumplimiento</TH>
                    </tr>
                  </TablaCabecera>
                  <tbody>
                    {expediente.etapas.map((e) => {
                      const c = cumplimientoDeEtapa(
                        { estado: e.estado, fecha_inicio_real: e.inicio_real, fecha_fin_programada: e.fin_programado, fecha_fin_real: e.fin_real },
                        hoy,
                      )
                      return (
                        <TR key={e.id}>
                          <TD>
                            <span className="block text-texto">{e.nombre}</span>
                            <span className="block text-xs text-texto-tenue md:hidden">{e.area ?? '—'} · {definir(ESTADO_ETAPA, e.estado).etiqueta}</span>
                          </TD>
                          <TD className="hidden text-texto-suave md:table-cell">{e.area ?? '—'}</TD>
                          <TD className="tabular text-right">{e.peso === null ? '—' : porcentaje(e.peso)}</TD>
                          <TD className="tabular text-right">{porcentaje(e.avance)}</TD>
                          <TD className="tabular hidden text-xs text-texto-suave sm:table-cell">
                            {e.inicio_programado ? `${fecha(e.inicio_programado)} → ${fecha(e.fin_programado)}` : '—'}
                          </TD>
                          <TD className="tabular hidden text-xs text-texto-suave sm:table-cell">
                            {e.inicio_real ? `${fecha(diaDeLima(e.inicio_real))} → ${e.fin_real ? fecha(diaDeLima(e.fin_real)) : '…'}` : '—'}
                          </TD>
                          <TD>
                            <Insignia tono={c.tono}>{c.etiqueta}</Insignia>
                          </TD>
                        </TR>
                      )
                    })}
                  </tbody>
                </Tabla>
              </>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        {/* El avance de cada área y las observaciones son cortos: lado a lado en
            el monitor, uno sobre otro en el teléfono y en la hoja impresa. */}
        <div className="grid gap-5 lg:grid-cols-2 *:min-w-0 print:grid-cols-1">
          {/* ------------------------------------------------- las áreas */}
          <Tarjeta id="areas" className="no-partir scroll-mt-20">
            <TarjetaCabecera titulo="Avance por área" descripcion="La hoja de actividades de cada área y cuánto lleva de lo suyo" />
            <TarjetaCuerpo className="space-y-4">
              {expediente.areas.length === 0 ? (
                <p className="text-sm text-texto-suave">Ninguna área armó todavía su hoja de actividades para esta orden.</p>
              ) : (
                <ul className="space-y-3">
                  {expediente.areas.map((a) => (
                    <li key={a.area_codigo} className="grid grid-cols-[minmax(7rem,10rem)_1fr_auto] items-center gap-3 text-sm">
                      <span className="text-texto">{a.area}</span>
                      <Progreso valor={a.avance_pct} etiqueta={`Avance de ${a.area}`} />
                      <span className="tabular w-36 text-right text-xs text-texto-suave">
                        {porcentaje(a.avance_pct)} · {a.terminadas}/{a.actividades} actividades
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {(expediente.planos.length > 0 || expediente.materiales.length > 0) && (
                <dl className="grid gap-x-8 border-t border-borde pt-3 sm:grid-cols-2 lg:grid-cols-1">
                  {expediente.planos.length > 0 && (
                    <Dato
                      etiqueta="Planos entregados por Diseño"
                      valor={`${expediente.planos.filter((p) => p.fecha_entrega).length} de ${expediente.planos.length}`}
                    />
                  )}
                  {expediente.materiales.length > 0 && (
                    <Dato
                      etiqueta="Materiales despachados"
                      valor={`${expediente.materiales.filter((m) => Number(m.cantidad_despachada ?? 0) >= Number(m.cantidad_solicitada ?? 0)).length} de ${expediente.materiales.length} líneas completas`}
                    />
                  )}
                </dl>
              )}
            </TarjetaCuerpo>
          </Tarjeta>

          {/* --------------------------------------------- observaciones */}
          <Tarjeta id="observaciones" className="no-partir scroll-mt-20">
            <TarjetaCabecera
              titulo="Observaciones"
              descripcion={
                observaciones.length === 0
                  ? 'Los errores que alguien encontró en la orden'
                  : `${observaciones.filter((o) => o.abierta).length} abiertas · ${observaciones.filter((o) => !o.abierta).length} resueltas`
              }
            />
            {observaciones.length === 0 && (
              <TarjetaCuerpo>
                <p className="flex items-center gap-2 text-sm text-texto-suave">
                  <CheckCircle2 aria-hidden className="size-4 shrink-0 text-exito" />
                  Nadie levantó observaciones sobre esta orden.
                </p>
              </TarjetaCuerpo>
            )}
            {observaciones.length > 0 && (
              <TarjetaCuerpo>
                <ul className="divide-y divide-borde">
                  {observaciones.map((o) => (
                    <li key={o.id} className="py-2.5 text-sm first:pt-0 last:pb-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <Insignia tono={o.abierta ? 'aviso' : 'exito'}>{o.abierta ? 'Abierta' : 'Resuelta'}</Insignia>
                        <span className="text-texto">{o.descripcion}</span>
                      </p>
                      <p className="mt-1 text-xs text-texto-tenue">
                        Para {o.area} · {fechaHora(o.creado_en)}
                        {o.registrado_por_nombre && ` · ${o.registrado_por_nombre}`}
                      </p>
                      {!o.abierta && o.resolucion && (
                        <p className="mt-1 text-xs text-exito">
                          Resuelta el {fecha(o.resuelta_en)}: {o.resolucion}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </TarjetaCuerpo>
            )}
          </Tarjeta>
        </div>

        {/* ------------------------------------------------- el costo */}
        {expediente.costo && composicion && (
          <Tarjeta id="costo" className="scroll-mt-20">
            <TarjetaCabecera
              titulo="Costo de la carrocería"
              descripcion="Material despachado a precio de compra, mano de obra de la planilla cerrada y gastos aprobados de las áreas. Se calcula en vivo."
            />
            <TarjetaCuerpo className="space-y-5">
              {composicion.sinPrecio > 0 && (
                <p role="status" className="rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-sm text-aviso">
                  {composicion.sinPrecio === 1 ? 'Un despacho no tiene' : `${composicion.sinPrecio} despachos no tienen`} precio de
                  compra: el costo de material está incompleto hasta que Logística registre el precio.
                </p>
              )}
              {enSoles.sinCambio > 0 && (
                <p role="status" className="rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-sm text-aviso">
                  {enSoles.sinCambio === 1 ? 'Una línea en dólares no tiene' : `${enSoles.sinCambio} líneas en dólares no tienen`}{' '}
                  tipo de cambio de su fecha: Tesorería lo registra en Tipo de cambio, y hasta entonces no suma al total en soles.
                </p>
              )}
              {composicion.monedas.length === 0 ? (
                <p className="text-sm text-texto-suave">
                  Todavía no hay costo cargado: aparece cuando Almacén despacha material, se cierra la planilla del mes o
                  Administración aprueba un gasto del área.
                </p>
              ) : (
                <div className={composicion.monedas.length > 1 ? 'grid gap-6 lg:grid-cols-2' : undefined}>
                  {composicion.monedas.map((m) => (
                    <ComposicionDelCosto key={m.moneda} composicion={m} />
                  ))}
                </div>
              )}
              {enSoles.totalUsd > 0 && (
                <p className="text-sm text-texto-suave">
                  Todo en soles: <strong className="tabular text-texto">{moneda(enSoles.total)}</strong>, con{' '}
                  {moneda(enSoles.totalUsd, 'USD')} pasados al cambio de venta de la fecha de cada línea.
                </p>
              )}
              {expediente.margen && (
                <MargenDeLaCarroceria
                  margen={expediente.margen}
                  cotizacionId={expediente.cotizacionId}
                  ordenId={orden.id}
                  puedeConfirmar={puedeConfirmarIgv}
                  cerrado={Boolean(expediente.costo.cierre)}
                />
              )}
              {expediente.presupuesto && (
                <PresupuestoDeLaCarroceria
                  presupuesto={expediente.presupuesto}
                  ordenId={orden.id}
                  puedeFijar={puedeFijarPresupuesto}
                  cerrado={Boolean(expediente.costo.cierre)}
                />
              )}
              <CierreDelCosto
                cierre={expediente.costo.cierre}
                costoVivo={enSoles.total}
                estado={orden.estado}
                ordenId={orden.id}
                puedeCerrar={puedeCerrarCosto}
                pendientes={composicion.sinPrecio + enSoles.sinCambio}
              />
              {expediente.costo.lineas.length > 0 && <DetalleDelCosto lineas={expediente.costo.lineas} />}
            </TarjetaCuerpo>
          </Tarjeta>
        )}

        {/* ------------------------------------------- cómo se fabricó */}
        <Tarjeta id="proceso" className="scroll-mt-20">
          <TarjetaCabecera
            titulo="Cómo se fabricó"
            descripcion="Día por día: lo que reportó cada área, con su foto, y lo que pasó con la orden"
          />
          <TarjetaCuerpo>
            <Proceso expediente={expediente} eventos={eventos} />
          </TarjetaCuerpo>
        </Tarjeta>

        {/* ------------------------------------------------- la entrega */}
        <Tarjeta id="entrega" className="no-partir scroll-mt-20">
          <TarjetaCabecera titulo="Entrega y salida" descripcion="Cómo dejó la planta: liberación de Tesorería, acta de conformidad y salida física" />
          <TarjetaCuerpo>
            <dl className="grid gap-x-8 sm:grid-cols-2">
              <Dato
                etiqueta="Trabajo terminado"
                valor={orden.fecha_fin_real ? fechaHora(orden.fecha_fin_real) : viva ? 'En curso' : '—'}
              />
              <Dato
                etiqueta="Liberación de Tesorería"
                valor={expediente.liberacion ? fechaHora(expediente.liberacion.liberado_en) : 'Pendiente'}
              />
              <Dato
                etiqueta="Acta de conformidad"
                valor={expediente.acta ? `${expediente.acta.numero ?? 'Sin número'} · ${fecha(expediente.acta.fecha_entrega)}` : 'Pendiente'}
              />
              <Dato
                etiqueta="Recibió"
                valor={
                  expediente.acta
                    ? [expediente.acta.recibe_nombre, expediente.acta.recibe_cargo].filter(Boolean).join(' · ')
                    : null
                }
              />
              <Dato
                etiqueta="Garantía"
                valor={
                  expediente.acta?.garantia_vence
                    ? `${expediente.acta.garantia_meses} meses, hasta el ${fecha(expediente.acta.garantia_vence)}`
                    : null
                }
              />
              <Dato
                etiqueta="Salida de planta"
                valor={
                  expediente.salida
                    ? fechaHora(expediente.salida.creado_en)
                    : expediente.acta?.salida_confirmada_en
                      ? `Confirmada en portería ${fechaHora(expediente.acta.salida_confirmada_en)}`
                      : 'Pendiente'
                }
              />
            </dl>
            {expediente.salida?.constancia && (
              <p className="mt-3 text-sm text-texto-suave">{expediente.salida.constancia}</p>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        {/* ---------------------------- las fotos, como anexo al final */}
        {conFoto.length > 0 && (
          <Tarjeta id="fotos" className="scroll-mt-20">
            <TarjetaCabecera titulo="Evidencia fotográfica" descripcion={`${conFoto.length} fotos de los reportes del taller, de la más antigua a la más reciente`} />
            <TarjetaCuerpo>
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-4">
                {conFoto.map((r) => (
                  <li key={r.id} className="no-partir">
                    <a href={r.foto_url!} target="_blank" rel="noreferrer" className="group block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={r.foto_url!}
                        alt={`${r.actividad}, ${fecha(r.fecha)}`}
                        loading="lazy"
                        className="aspect-[4/3] w-full rounded-[var(--radius-base)] border border-borde object-cover group-hover:opacity-90"
                      />
                    </a>
                    <p className="mt-1 text-xs text-texto">{r.actividad}</p>
                    <p className="text-[11px] text-texto-tenue">
                      {r.area} · {fecha(r.fecha)} · +{porcentaje(r.avance_pct)}
                    </p>
                  </li>
                ))}
              </ul>
            </TarjetaCuerpo>
          </Tarjeta>
        )}
      </div>
    </>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor?: string | number | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-borde py-2 text-sm">
      <dt className="shrink-0 text-texto-suave">{etiqueta}</dt>
      <dd className="min-w-0 text-right font-medium wrap-break-word text-texto">{valor || '—'}</dd>
    </div>
  )
}

type OrdenParaHitos = {
  fecha_registro: string | null
  creado_en: string | null
  fecha_inicio_real: string | null
  fecha_fin_real: string | null
}

/** Los pasos de toda carrocería, en orden, con la fecha en que se cumplieron. */
function Hitos({ orden, expediente }: { orden: OrdenParaHitos; expediente: Expediente }) {
  const planosEntregados = expediente.planos.filter((p) => p.fecha_entrega)
  const ultimoPlano = planosEntregados.map((p) => p.fecha_entrega as string).sort().at(-1) ?? null
  const hitos: { titulo: string; cuando: string | null; detalle?: string }[] = [
    { titulo: 'Orden emitida', cuando: orden.fecha_registro ?? orden.creado_en },
    ...(expediente.planos.length > 0
      ? [{
          titulo: 'Planos entregados',
          cuando: planosEntregados.length === expediente.planos.length ? ultimoPlano : null,
          detalle: `${planosEntregados.length} de ${expediente.planos.length}`,
        }]
      : []),
    { titulo: 'Inicio del trabajo', cuando: orden.fecha_inicio_real },
    { titulo: 'Trabajo terminado', cuando: orden.fecha_fin_real },
    { titulo: 'Liberación de Tesorería', cuando: expediente.liberacion?.liberado_en ?? null },
    { titulo: 'Acta de entrega', cuando: expediente.acta?.fecha_entrega ?? null, detalle: expediente.acta?.numero ?? undefined },
    { titulo: 'Salida de planta', cuando: expediente.salida?.creado_en ?? expediente.acta?.salida_confirmada_en ?? null },
  ]
  // En el monitor, una línea de tiempo: cada paso unido al anterior, en verde
  // el tramo que ya se recorrió. En el teléfono, una lista en dos columnas.
  return (
    <ol className="grid gap-x-4 gap-y-4 sm:grid-cols-2 lg:flex lg:gap-0">
      {hitos.map((h, i) => (
        <li key={h.titulo} className="relative flex items-start gap-2.5 lg:flex-1 lg:flex-col lg:items-center lg:gap-2 lg:px-2 lg:text-center">
          {i > 0 && (
            <span
              aria-hidden
              className={cn(
                'absolute top-2.5 right-1/2 hidden h-0.5 w-full -translate-y-1/2 lg:block',
                hitos[i - 1].cuando && h.cuando ? 'bg-exito' : 'bg-borde',
              )}
            />
          )}
          <span className="relative z-10 shrink-0 rounded-full bg-superficie">
            {h.cuando ? (
              <CheckCircle2 aria-hidden className="size-5 text-exito" />
            ) : (
              <Circle aria-hidden className="size-5 text-texto-tenue" />
            )}
          </span>
          <span className="min-w-0">
            <span className={cn('block text-sm', h.cuando ? 'font-medium text-texto' : 'text-texto-suave')}>
              {h.titulo}
              <span className="sr-only">{h.cuando ? ', cumplido' : ', pendiente'}</span>
            </span>
            <span className="tabular block text-xs text-texto-tenue">
              {h.cuando ? fecha(diaDeLima(h.cuando)) : 'Pendiente'}
              {h.detalle ? ` · ${h.detalle}` : ''}
            </span>
          </span>
        </li>
      ))}
    </ol>
  )
}

type Evento = Awaited<ReturnType<typeof timelineDeOrden>>[number]

type Paso = {
  clave: string
  dia: string
  cuando: string
  titulo: string
  detalle: string | null
  quien: string | null
  tono: Tono
  reporte?: Expediente['reportes'][number]
}

/**
 * La historia de la orden en orden cronológico: los eventos de la bitácora
 * (emisión, cambios de estado, pausas, entrega) intercalados con cada reporte
 * del taller. Las filas de auditoría cruda se quedan en el Historial: aquí se
 * cuenta la fabricación, no cada campo que se editó.
 */
function Proceso({ expediente, eventos }: { expediente: Expediente; eventos: Evento[] }) {
  const pasos: Paso[] = [
    ...eventos
      .filter((e) => e.categoria === 'BITACORA' && !e.automatico)
      .map((e) => ({
        clave: e.clave,
        dia: diaDeLima(e.ocurrido_en) ?? e.ocurrido_en.slice(0, 10),
        cuando: e.ocurrido_en,
        titulo: e.titulo,
        detalle: e.detalle,
        quien: e.usuario,
        tono: (Object.values(TIPO_EVENTO_BITACORA).find((d) => d.etiqueta === e.titulo)?.tono ?? 'neutro') as Tono,
      })),
    ...expediente.reportes.map((r) => ({
      clave: `reporte-${r.id}`,
      dia: r.fecha,
      cuando: r.creado_en,
      titulo: r.actividad,
      detalle: r.nota,
      quien: r.reportado_por,
      tono: 'acento' as Tono,
      reporte: r,
    })),
  ].sort((a, b) => (a.dia === b.dia ? a.cuando.localeCompare(b.cuando) : a.dia.localeCompare(b.dia)))

  if (pasos.length === 0) {
    return <p className="text-sm text-texto-suave">Todavía no hay nada registrado de esta orden.</p>
  }

  const porDia = new Map<string, Paso[]>()
  for (const p of pasos) porDia.set(p.dia, [...(porDia.get(p.dia) ?? []), p])

  return (
    <>
      {expediente.reportesAlTope && (
        <p className="mb-3 text-xs text-texto-tenue">Se muestran los primeros 500 reportes del taller.</p>
      )}
      <ol className="space-y-5">
        {[...porDia.entries()].map(([dia, del_dia]) => (
          <li key={dia} className="no-partir">
            <p className="mb-2 text-xs font-semibold text-texto-suave">{fechaLarga(dia)}</p>
            <ol className="space-y-3 border-l border-borde pl-4">
              {del_dia.map((p) => (
                <li key={p.clave} className="relative">
                  <span aria-hidden className={cn('absolute top-1.5 -left-[21px] size-2.5 rounded-full ring-2 ring-superficie', TONO_PUNTO[p.tono])} />
                  <div className="flex gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <span className="font-medium text-texto">{p.titulo}</span>
                        {p.reporte && (
                          <>
                            <span className="tabular text-xs text-texto-suave">
                              {p.reporte.area} · +{porcentaje(p.reporte.avance_pct)}
                              {p.reporte.acumulado_pct !== null && ` (lleva ${porcentaje(p.reporte.acumulado_pct)})`}
                            </span>
                            {p.reporte.revision && p.reporte.revision !== 'APROBADO' && (
                              <Insignia tono={definir(REVISION, p.reporte.revision).tono}>
                                {definir(REVISION, p.reporte.revision).etiqueta}
                              </Insignia>
                            )}
                          </>
                        )}
                      </p>
                      {p.detalle && <p className="mt-0.5 text-sm text-texto-suave">{p.detalle}</p>}
                      <p className="mt-0.5 text-[11px] text-texto-tenue">
                        {hora(p.cuando)}
                        {p.quien && ` · ${p.quien}`}
                      </p>
                    </div>
                    {p.reporte?.foto_url && (
                      <a href={p.reporte.foto_url} target="_blank" rel="noreferrer" className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={p.reporte.foto_url}
                          alt={`Foto del reporte: ${p.reporte.actividad}`}
                          loading="lazy"
                          className="size-16 rounded-[var(--radius-base)] border border-borde object-cover sm:size-20"
                        />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </>
  )
}

/** Las líneas del costo por fuente, con su subtotal: de qué está hecho el número de arriba. */
function DetalleDelCosto({ lineas }: { lineas: LineaCosto[] }) {
  const grupos = [
    ...FUENTES_COSTO.map((f) => ({ clave: f.clave, etiqueta: f.etiqueta, serie: f.serie as string | null })),
    { clave: 'MATERIALES_SIN_PRECIO', etiqueta: 'Material sin precio (Logística debe valorizarlo)', serie: null },
  ]
    .map((g) => ({ ...g, lineas: lineas.filter((l) => l.fuente === g.clave) }))
    .filter((g) => g.lineas.length > 0)

  return (
    <div className="space-y-4">
      {grupos.map((g) => {
        const porMoneda = new Map<string, number>()
        for (const l of g.lineas) {
          if (l.monto !== null && l.moneda) porMoneda.set(l.moneda, (porMoneda.get(l.moneda) ?? 0) + Number(l.monto))
        }
        return (
          <section key={g.clave} aria-label={g.etiqueta} className="no-partir">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-texto">
              {g.serie && <span aria-hidden className={cn('size-2.5 rounded-[3px]', g.serie)} />}
              {g.etiqueta}
              <span className="tabular ml-auto text-sm font-medium text-texto-suave">
                {[...porMoneda.entries()].map(([m, t]) => moneda(t, m as 'PEN' | 'USD')).join(' + ') || '—'}
              </span>
            </h3>
            <Tabla>
              <TablaCabecera>
                <tr>
                  <TH className="w-24">Fecha</TH>
                  <TH>Concepto</TH>
                  <TH className="hidden md:table-cell">Detalle</TH>
                  {g.clave.startsWith('MATERIALES') && <TH className="hidden text-right sm:table-cell">Cantidad</TH>}
                  {g.clave.startsWith('MATERIALES') && <TH className="hidden text-right sm:table-cell">P. unitario</TH>}
                  <TH className="text-right">Importe</TH>
                  <TH className="hidden lg:table-cell">Documento</TH>
                </tr>
              </TablaCabecera>
              <tbody>
                {g.lineas.map((l, i) => (
                  <TR key={`${g.clave}-${i}`}>
                    <TD className="tabular text-xs text-texto-suave">{fecha(l.fecha)}</TD>
                    <TD>
                      <span className="block text-texto">{l.concepto}</span>
                      {l.detalle && <span className="block text-xs text-texto-tenue md:hidden">{l.detalle}</span>}
                    </TD>
                    <TD className="hidden text-texto-suave md:table-cell">{l.detalle ?? '—'}</TD>
                    {g.clave.startsWith('MATERIALES') && (
                      <TD className="tabular hidden text-right whitespace-nowrap sm:table-cell">
                        {l.cantidad === null ? '—' : `${cantidad(l.cantidad)} ${l.unidad ?? ''}`}
                      </TD>
                    )}
                    {g.clave.startsWith('MATERIALES') && (
                      <TD className="tabular hidden text-right whitespace-nowrap sm:table-cell">
                        {l.precio_unitario === null || !l.moneda ? '—' : moneda(l.precio_unitario, l.moneda as 'PEN' | 'USD')}
                      </TD>
                    )}
                    <TD className="tabular text-right font-medium whitespace-nowrap">
                      {l.monto === null || !l.moneda ? 'Sin precio' : moneda(l.monto, l.moneda as 'PEN' | 'USD')}
                    </TD>
                    <TD className="hidden text-xs text-texto-suave lg:table-cell">{l.referencia ?? '—'}</TD>
                  </TR>
                ))}
              </tbody>
            </Tabla>
          </section>
        )
      })}
      <p className="text-xs text-texto-tenue">
        La planilla se reparte por el porcentaje que Recursos Humanos asignó a esta orden; aquí va el total por
        período. El detalle por persona queda en Planillas, con su propio permiso.
      </p>
    </div>
  )
}

/** El costo en soles: el total, cuánto vino en dólares y cuántas líneas no tienen cambio. */
function enSolesDe(expediente: Expediente) {
  const lineas = expediente.costo?.enSoles ?? []
  const usd = lineas.filter((l) => l.moneda === 'USD')
  return {
    total: lineas.reduce((suma, l) => suma + (l.monto_pen ?? 0), 0),
    totalUsd: usd.reduce((suma, l) => suma + (l.monto ?? 0), 0),
    sinCambio: usd.filter((l) => l.monto_pen === null).length,
  }
}

/**
 * Precio de venta sin IGV contra el costo. Se muestra solo cuando se puede
 * decir con verdad: sin saber si el monto de la cotización trae IGV, la cifra
 * podría estar inflada en el 18 % de la venta, y entonces se pide confirmarlo.
 */
function MargenDeLaCarroceria({
  margen,
  cotizacionId,
  ordenId,
  puedeConfirmar,
  cerrado,
}: {
  margen: NonNullable<Expediente['margen']>
  cotizacionId: string | null
  ordenId: string
  puedeConfirmar: boolean
  cerrado: boolean
}) {
  const venta = margen.moneda_venta === 'USD' ? 'USD' : 'PEN'
  if (margen.precio_venta === null) {
    return (
      <section aria-label="Margen" className="no-partir rounded-[var(--radius-base)] border border-borde p-4">
        <h3 className="text-sm font-semibold text-texto">Margen</h3>
        <p className="mt-1 text-sm text-texto-suave">
          La OT no tiene una cotización con monto de venta: no hay contra qué medir el costo.
        </p>
      </section>
    )
  }
  return (
    <section aria-label="Margen" className="no-partir space-y-3 rounded-[var(--radius-base)] border border-borde p-4">
      <h3 className="text-sm font-semibold text-texto">Margen</h3>
      {margen.incluye_igv === null ? (
        <div className="space-y-2">
          <p className="text-sm text-texto-suave">
            Precio de venta según la cotización:{' '}
            <strong className="tabular text-texto">{moneda(margen.precio_venta, venta)}</strong>. Para calcular el margen
            hay que saber si ese monto incluye IGV.
          </p>
          {puedeConfirmar && cotizacionId ? (
            <ConfirmarIgv cotizacionId={cotizacionId} ordenId={ordenId} />
          ) : (
            <p className="text-sm text-aviso">Falta que Ventas, Gerencia o Administración lo confirmen.</p>
          )}
        </div>
      ) : (
        <>
          <dl className="grid gap-3 sm:grid-cols-4">
            <CifraMargen
              etiqueta="Precio de venta"
              valor={moneda(margen.precio_venta, venta)}
              pie={margen.incluye_igv ? 'Con IGV, según la cotización' : 'Sin IGV, según la cotización'}
            />
            <CifraMargen
              etiqueta="Venta sin IGV"
              valor={margen.precio_neto_pen === null ? '—' : moneda(margen.precio_neto_pen)}
              pie={
                venta === 'USD'
                  ? margen.cambio_venta === null
                    ? 'Falta el tipo de cambio del día de la OT'
                    : `${moneda(margen.precio_neto, 'USD')} al cambio de ${numero(margen.cambio_venta, 3)}`
                  : 'En soles'
              }
            />
            <CifraMargen
              etiqueta={cerrado ? 'Costo cerrado' : 'Costo a la fecha'}
              valor={moneda(margen.costo_pen)}
              pie={cerrado ? 'El que quedó al cerrar la OT' : 'Material, planilla y gastos'}
            />
            {margen.costo_pen <= 0 ? (
              // Sin costo cargado, el margen saldría 100 %: una cifra que parece buena y no dice nada.
              <CifraMargen etiqueta="Margen" valor="—" pie="Todavía no hay costo cargado" />
            ) : (
              <CifraMargen
                etiqueta="Margen"
                valor={margen.margen_pen === null ? '—' : moneda(margen.margen_pen)}
                pie={margen.margen_pct === null ? 'Sin calcular' : `${porcentaje(margen.margen_pct, 1)} de la venta sin IGV`}
                tono={margen.margen_pen !== null && margen.margen_pen < 0 ? 'peligro' : undefined}
              />
            )}
          </dl>
          {(margen.despachos_sin_precio > 0 || margen.lineas_sin_cambio > 0) && (
            <p className="text-xs text-aviso">
              El costo todavía está incompleto: el margen real puede ser menor que este.
            </p>
          )}
        </>
      )}
    </section>
  )
}

const SEMAFORO_PRESUPUESTO: Record<
  NonNullable<PresupuestoExpediente['semaforo']>,
  { tono: Tono; titulo: string; explica: string; barra: string }
> = {
  EN_RANGO: { tono: 'exito', titulo: 'Dentro del presupuesto', explica: 'Lo gastado está dentro de lo que se puede gastar.', barra: 'bg-exito' },
  AJUSTADO: {
    tono: 'aviso',
    titulo: 'Cerca del tope',
    explica: 'Ya se gastó el 90 % o más y la unidad no llega al 90 % de avance.',
    barra: 'bg-aviso',
  },
  EXCEDIDO: { tono: 'peligro', titulo: 'Pasó el presupuesto', explica: 'Lo gastado es más de lo que se podía gastar.', barra: 'bg-peligro' },
}

/**
 * Lo que se puede gastar en la unidad contra lo gastado, con el avance al lado.
 * El semáforo compara el gasto con el tope y no con el avance: el material se
 * compra al empezar, y un gasto por delante del avance no es una alarma.
 */
function PresupuestoDeLaCarroceria({
  presupuesto,
  ordenId,
  puedeFijar,
  cerrado,
}: {
  presupuesto: PresupuestoExpediente
  ordenId: string
  puedeFijar: boolean
  cerrado: boolean
}) {
  if (presupuesto.presupuesto_pen === null || presupuesto.semaforo === null) {
    return (
      <section aria-label="Presupuesto" className="no-partir space-y-2 rounded-[var(--radius-base)] border border-borde p-4">
        <h3 className="text-sm font-semibold text-texto">Presupuesto de costo</h3>
        <p className="text-sm text-texto-suave">
          Sale solo de la cotización cuando se confirma si su monto incluye IGV: el precio sin IGV ÷ 1.15, la utilidad
          estándar de la casa.{puedeFijar ? ' Si la OT no tiene cotización, fíjalo a mano.' : ''}
        </p>
        {puedeFijar && <FijarPresupuesto ordenId={ordenId} manual={false} />}
      </section>
    )
  }

  const s = SEMAFORO_PRESUPUESTO[presupuesto.semaforo]
  const consumido = presupuesto.consumido_pct ?? 0
  const regla = `Precio sin IGV ÷ ${numero(1 + presupuesto.utilidad_pct / 100, 2)}: la utilidad de ${porcentaje(presupuesto.utilidad_pct, 0)} de la casa`
  const fijado = [presupuesto.fijado_por, presupuesto.fijado_en ? fecha(presupuesto.fijado_en) : null].filter(Boolean).join(', ')

  return (
    <section aria-label="Presupuesto" className="no-partir space-y-3 rounded-[var(--radius-base)] border border-borde p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-texto">Presupuesto de costo</h3>
        <Insignia tono={s.tono}>{s.titulo}</Insignia>
      </div>
      <dl className="grid gap-3 sm:grid-cols-3">
        <CifraMargen
          etiqueta="Se puede gastar"
          valor={moneda(presupuesto.presupuesto_pen)}
          pie={presupuesto.origen === 'MANUAL' ? `Fijado a mano${fijado ? ` · ${fijado}` : ''}` : regla}
        />
        <CifraMargen
          etiqueta={cerrado ? 'Costo cerrado' : 'Gastado a la fecha'}
          valor={moneda(presupuesto.costo_pen)}
          pie={`${porcentaje(consumido, 1)} del presupuesto`}
          tono={presupuesto.semaforo === 'EXCEDIDO' ? 'peligro' : undefined}
        />
        <CifraMargen etiqueta="Avance de la unidad" valor={porcentaje(presupuesto.avance_pct, 0)} pie="Lo hecho, según los reportes" />
      </dl>
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-texto-suave">Gastado</span>
          <div
            role="meter"
            aria-label="Gastado del presupuesto"
            aria-valuenow={Math.round(consumido)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-2 w-full overflow-hidden rounded-full bg-neutro-suave"
          >
            <div className={cn('h-full rounded-full', s.barra)} style={{ width: `${Math.min(100, Math.max(0, consumido))}%` }} />
          </div>
          <span className="tabular w-12 shrink-0 text-right text-xs text-texto-suave">{Math.round(consumido)}%</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-texto-suave">Avance</span>
          <Progreso valor={presupuesto.avance_pct} etiqueta="Avance de la unidad" className="w-full" />
          <span className="tabular w-12 shrink-0 text-right text-xs text-texto-suave">{Math.round(presupuesto.avance_pct)}%</span>
        </div>
      </div>
      <p className="text-xs text-texto-suave">
        {s.explica}
        {consumido > presupuesto.avance_pct &&
          presupuesto.semaforo !== 'EXCEDIDO' &&
          ' El material se compra al empezar: es normal que el gasto vaya por delante del avance.'}
      </p>
      {presupuesto.origen === 'MANUAL' && presupuesto.motivo && (
        <p className="text-xs text-texto-suave">Motivo del presupuesto: {presupuesto.motivo}</p>
      )}
      {presupuesto.costo_incompleto && (
        <p className="text-xs text-aviso">El costo todavía está incompleto: lo gastado de verdad puede ser más.</p>
      )}
      {puedeFijar && <FijarPresupuesto ordenId={ordenId} manual={presupuesto.origen === 'MANUAL'} />}
    </section>
  )
}

function CifraMargen({ etiqueta, valor, pie, tono }: { etiqueta: string; valor: string; pie: string; tono?: 'peligro' }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-texto-suave">{etiqueta}</dt>
      <dd className={cn('tabular text-lg font-semibold', tono === 'peligro' ? 'text-peligro' : 'text-texto')}>{valor}</dd>
      <dd className="text-xs text-texto-tenue">{pie}</dd>
    </div>
  )
}

/**
 * El cierre del costo: si está cerrado, con qué cifra, quién y cuándo, y cuánto
 * entró después; si no, el botón para cerrarlo cuando el trabajo terminó.
 */
function CierreDelCosto({
  cierre,
  costoVivo,
  estado,
  ordenId,
  puedeCerrar,
  pendientes,
}: {
  cierre: NonNullable<Expediente['costo']>['cierre']
  costoVivo: number
  estado: string
  ordenId: string
  puedeCerrar: boolean
  pendientes: number
}) {
  if (cierre) {
    const diferencia = Math.round((costoVivo - cierre.costo_pen) * 100) / 100
    return (
      <section aria-label="Cierre del costo" className="no-partir rounded-[var(--radius-base)] bg-superficie-2 p-4 text-sm">
        <p className="text-texto">
          <strong>Costo cerrado en {moneda(cierre.costo_pen)}</strong> el {fechaHora(cierre.cerrado_en)}
          {cierre.cerrado_por && ` por ${cierre.cerrado_por}`}.
        </p>
        {cierre.nota && <p className="mt-1 text-texto-suave">{cierre.nota}</p>}
        {diferencia !== 0 && (
          <p className="mt-1 text-aviso">
            Desde el cierre {diferencia > 0 ? 'entraron' : 'salieron'} {moneda(Math.abs(diferencia))}: el costo de hoy es{' '}
            {moneda(costoVivo)}. El cierre no cambia; la diferencia queda a la vista.
          </p>
        )}
      </section>
    )
  }
  const termino = ['TERMINADA', 'ENTREGADA', 'FACTURADA'].includes(estado)
  if (!termino || !puedeCerrar) return null
  if (pendientes > 0) {
    return (
      <p className="text-sm text-texto-suave print:hidden">
        El costo se podrá cerrar cuando no queden despachos sin precio ni líneas en dólares sin tipo de cambio.
      </p>
    )
  }
  return <CerrarCosto ordenId={ordenId} />
}
