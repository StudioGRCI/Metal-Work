import Link from 'next/link'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { Plus } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Paginacion } from '@/components/estructura/paginacion'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia, Punto } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { cantidad, fecha } from '@/lib/format'
import { PRIORIDAD, TIPO_TRABAJO, definir, estadoDeOrden } from '@/lib/dominio/estados'
import { palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { nombreDeUnidadOCodigo, nombreVaTenue } from '@/lib/dominio/unidades'
import {
  ORDENES_POR_PAGINA,
  comoEstado,
  comoPrioridad,
  listarOrdenes,
} from '@/lib/datos/ordenes'
import { reemplazoDeLaOrden, trabajaPorCodigo } from '@/lib/dominio/acceso-orden'
import { cierraElCostoDeLaOt, exigirSesion, puede } from '@/lib/sesion'

import { ordenesConCostoPorCerrar } from '@/lib/datos/costos-ot'
import { FILTRO_COSTO_POR_CERRAR } from '@/lib/dominio/expediente'
import { pendientesDeLasOt } from '@/lib/datos/pendientes-de-las-ot'

import { FiltrosOrdenes } from './filtros-ordenes'
import { PendientesDeLasOt } from './pendientes-de-las-ot'
import { TrabajoPorOtCargando, TrabajoPorOtDeLaCuenta } from './trabajo-por-ot'
import { paginaPedida } from '@/lib/dominio/paginas'

export const metadata = { title: 'Órdenes de trabajo' }

/** Cuántas de las órdenes con el costo por cerrar se listan a la vez: sus id van en la dirección de la consulta. */
const TOPE_COSTO_POR_CERRAR = 200

function texto(valor: unknown) {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : undefined
}

export default async function PaginaOrdenes({ searchParams }: PageProps<'/ordenes'>) {
  // `ordenes.listar` y no `ordenes.ver`: el segundo es la llave de lectura que
  // ventas necesita para sus garantías y sus documentos; entrar al módulo es
  // otra cosa, y ahí ventas no pinta nada.
  const perfil = await exigirSesion()
  // Supervisión, Almacén y Requerimientos trabajan por código interno desde el
  // 2026-10-15: van a lo que reemplaza la OT antes de pedirles un permiso que la
  // base ya no les da (migración 20261016120000).
  if (trabajaPorCodigo(perfil)) redirect(reemplazoDeLaOrden(perfil))
  if (!puede(perfil, 'ordenes.listar')) redirect('/sin-permiso')
  const params = await searchParams

  // Las terminadas con el costo por cerrar, adonde lleva el pendiente: solo para
  // quien lo cierra, que es quien ve el costo. A otro, todas le saldrían sin
  // cierre (`ot_cierres_costo` pide `costos.ver`), así que el filtro no se aplica.
  const cierraCosto = cierraElCostoDeLaOt(perfil)
  const costoPorCerrar = cierraCosto && params.costo === FILTRO_COSTO_POR_CERRAR
  // Los id van en la dirección de la consulta: con cientos, la lista fallaría.
  // Se listan las más recientes y el encabezado dice cuántas quedan fuera.
  const porCerrar = costoPorCerrar ? await ordenesConCostoPorCerrar() : undefined
  const filtros = {
    busqueda: texto(params.q),
    estado: comoEstado(params.estado),
    prioridad: comoPrioridad(params.prioridad),
    atrasadas: params.atrasadas === '1',
    ids: porCerrar?.slice(0, TOPE_COSTO_POR_CERRAR),
    pagina: paginaPedida(params.pagina),
  }

  // Una búsqueda de solo signos no filtra nada: no cuenta como filtro, o la
  // lista entera decía «3 órdenes con los filtros aplicados».
  const hayFiltros = Boolean(
    palabrasDeBusqueda(filtros.busqueda).length > 0 || filtros.estado || filtros.prioridad || filtros.atrasadas || costoPorCerrar,
  )
  // Lo que falta completar (plan 8.1) lo ve quien carga las OT, arriba de la
  // lista y sin filtros: quien filtra está consultando, no atendiendo. Solo
  // `ordenes.crear`: quien solo corrige OT no ve las cotizaciones y la tarjeta
  // le diría que no falta ninguna.
  const verPendientes = puede(perfil, 'ordenes.crear') && !hayFiltros && filtros.pagina <= 1
  // El colaborador de Diseño ve arriba su trabajo reunido por OT (Plan 7,
  // entrega 7.2), en su propio `<Suspense>`: la lista no lo espera. Si no se
  // lee, la lista sigue y la tarjeta lo dice. Por su permiso propio, no por
  // `puede`: el administrador no anota actividades y vería una tarjeta vacía.
  const veSuTrabajo = perfil.permisos.includes('diseno.preparar_informe')
  const [{ ordenes, total, pagina, paginas }, pendientes] = await Promise.all([
    listarOrdenes(filtros),
    verPendientes
      ? pendientesDeLasOt().catch((e: unknown) => {
          // No se esconde: la tarjeta dice que no se pudo leer.
          console.error(e)
          return null
        })
      : Promise.resolve(undefined),
  ])
  const puedeCrear = puede(perfil, 'ordenes.crear')
  const puedeAbrirEnTaller = puede(perfil, 'ordenes.abrir_taller')

  // Cero con filtros puestos y cero de verdad no son lo mismo: al que busca le
  // importa saber si el vacío lo produjo su propio filtro.
  // Con solo el filtro del costo, el vacío es la buena noticia: no queda ninguno por cerrar.
  const soloCosto = costoPorCerrar && !(palabrasDeBusqueda(filtros.busqueda).length > 0 || filtros.estado || filtros.prioridad || filtros.atrasadas)
  const vacio = soloCosto
    ? 'Ninguna orden terminada con el costo por cerrar'
    : hayFiltros
      ? 'Ninguna orden coincide con los filtros aplicados'
      : 'Ninguna orden registrada todavía'
  // Con el filtro del costo, cada orden lleva adonde se cierra: la tarjeta del
  // costo de su expediente. El Resumen no lo dice y el cierre queda en otra pestaña.
  const enlaceDeOrden = (id: string | null) => (costoPorCerrar ? `/ordenes/${id}/expediente#costo` : `/ordenes/${id}`)

  // Lo que cada orden muestra se calcula una vez: la misma fila sale como
  // tarjeta en el teléfono y como renglón de tabla en el monitor, y si cada una
  // lo resolviera por su lado terminarían diciendo cosas distintas.
  const filas = ordenes.map((orden) => {
    const atraso = orden.dias_atraso ?? 0
    // Los días que el taller tiene por delante, ya descontados los domingos y
    // los feriados: es el número con el que se programa.
    const habiles =
      orden.dias_habiles_restantes === null || orden.dias_habiles_restantes === undefined
        ? null
        : Number(orden.dias_habiles_restantes)
    // La unidad se nombra en un solo sitio. `unidad_id` distingue la orden que
    // no tiene unidad —esa sí es «sin unidad asignada»— de la que la tiene y
    // todavía no está matriculada.
    const unidad = orden.unidad_id
      ? {
          placa: orden.placa,
          codigo_interno: orden.codigo_interno,
          numero_chasis: orden.numero_chasis,
          marca: orden.marca,
          modelo: orden.modelo,
        }
      : null
    return {
      orden,
      estado: estadoDeOrden(orden.estado, orden.abierta_en_taller),
      prioridad: definir(PRIORIDAD, orden.prioridad),
      atraso,
      habiles,
      unidad,
      plazo:
        atraso > 0
          ? { texto: `${atraso} ${atraso === 1 ? 'día' : 'días'} de atraso`, clase: 'font-medium text-peligro' }
          : habiles === null
            ? null
            : {
                texto: habiles === 0 ? 'se entrega hoy' : `faltan ${habiles} ${habiles === 1 ? 'día hábil' : 'días hábiles'} de taller`,
                clase: habiles <= 3 ? 'font-medium text-aviso' : 'text-texto-suave',
              },
    }
  })

  return (
    <>
      <EncabezadoPagina
        titulo="Órdenes de trabajo"
        descripcion={
          (total === 0
            ? vacio
            : `${total.toLocaleString('es-PE')} ${total === 1 ? 'orden' : 'órdenes'}${hayFiltros ? ' con los filtros aplicados' : ''}`) +
          (porCerrar && porCerrar.length > TOPE_COSTO_POR_CERRAR
            ? `. Se buscan solo las ${TOPE_COSTO_POR_CERRAR} más recientes de las ${porCerrar.length.toLocaleString('es-PE')} con el costo por cerrar.`
            : '')
        }
        acciones={
          (puedeCrear || puedeAbrirEnTaller) && (
            <>
              {/* La OT de una unidad la carga Administración con su código
                  interno, sobre la cotización que Gerencia aprobó (migración
                  20261027200000): aquí ya no se emite. Queda la orden suelta —reparación,
                  garantía—, que nace en borrador y la aprueba Gerencia. */}
              {puedeCrear && (
                <EnlaceBoton href="/ordenes/nueva" variante="contorno">
                  Orden sin cotización
                </EnlaceBoton>
              )}
              {/* La del taller queda por revisar y la aprueba el jefe de
                  producción; la de la oficina, Gerencia. Son dos puertas. */}
              {puedeAbrirEnTaller && (
                <EnlaceBoton href="/avance/abrir-orden" variante={puedeCrear ? 'secundario' : 'primario'}>
                  <Plus aria-hidden className="size-4" />
                  Abrir OT por revisar
                </EnlaceBoton>
              )}
            </>
          )
        }
      />

      {pendientes !== undefined && <PendientesDeLasOt pendientes={pendientes} corrige={puede(perfil, 'ordenes.editar')} />}

      {veSuTrabajo && (
        <div className="mb-5">
          <Suspense fallback={<TrabajoPorOtCargando />}>
            <TrabajoPorOtDeLaCuenta />
          </Suspense>
        </div>
      )}

      <FiltrosOrdenes costoPorCerrar={cierraCosto} />

      {/* En el teléfono, una tarjeta por orden que se toca entera: la tabla no
          cabía y solo se leía el número y medio cliente. Hasta 768 px: entre 640
          y 767 la tabla tampoco cabía y se deslizaba de costado. */}
      {filas.length > 0 && (
        <ul className="mt-4 space-y-3 md:hidden">
          {filas.map(({ orden, estado, prioridad, unidad, plazo }) => (
            <li key={orden.id}>
              <Link
                href={enlaceDeOrden(orden.id)}
                className="block rounded-[var(--radius-base)] border border-borde bg-superficie p-4 shadow-[var(--sombra)] active:bg-superficie-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-acento">{orden.numero}</span>
                  <span className="flex items-center gap-2">
                    <span className="flex items-center gap-1 text-xs text-texto-suave">
                      <Punto tono={prioridad.tono} />
                      {prioridad.etiqueta}
                    </span>
                    <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-texto">
                  {orden.cliente ??
                    (orden.cliente_id === null ? <span className="text-aviso">Sin cliente todavía</span> : null)}
                </p>
                <p className="text-xs text-texto-suave">
                  <span className={nombreVaTenue(unidad, orden.avance_del_codigo) ? 'text-texto-tenue' : undefined}>{nombreDeUnidadOCodigo(unidad, orden.avance_del_codigo)}</span>
                  {orden.tipo_carroceria ? ` · ${orden.tipo_carroceria}` : ''}
                </p>
                {/* Entre 640 y 767 px antes se veía la tabla, con el trabajo y el
                    responsable: la ficha los lleva en ese ancho para no perderlos. */}
                <p className="mt-1 hidden text-xs text-texto-suave sm:block" data-trabajo-en-ficha>
                  {orden.descripcion && <span className="text-texto">{orden.descripcion} · </span>}
                  {definir(TIPO_TRABAJO, orden.tipo_trabajo).etiqueta}
                  {orden.responsable && ` · ${orden.responsable}`}
                </p>
                <div className="mt-3 flex items-end justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <Progreso valor={orden.avance_porcentaje} mostrarValor alto="sm" />
                    <p className="mt-1 text-xs text-texto-suave">
                      {orden.avance_del_codigo
                        ? `Avance del código ${orden.avance_del_codigo}`
                        : `${orden.etapas_terminadas ?? 0} de ${orden.etapas_total ?? 0} etapas`}
                    </p>
                  </div>
                  {/* Ancho fijo: si la columna medía lo que su texto, cada
                      tarjeta tenía la barra de avance de otro largo. */}
                  <div className="w-32 shrink-0 text-right">
                    <p className="text-sm text-texto">{fecha(orden.fecha_entrega_comprometida)}</p>
                    {plazo && <p className={`text-xs ${plazo.clase}`}>{plazo.texto}</p>}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Tarjeta className={filas.length > 0 ? 'mt-4 hidden overflow-hidden md:block' : 'mt-4 overflow-hidden'}>
        {/* Sin órdenes no hay tabla: con su cabecera, el aviso se centraba en el
            ancho de las columnas y en el teléfono salía cortado. */}
        {ordenes.length === 0 ? (
          <SinDatos
            enTabla={false}
            titulo={soloCosto ? 'No queda ninguna por cerrar' : hayFiltros ? 'Ninguna orden con estos filtros' : 'Aún no hay órdenes de trabajo'}
            descripcion={
              soloCosto
                ? 'Las terminadas que se costean por su código interno se cierran en Códigos internos, no aquí.'
                : hayFiltros
                  ? 'Con los filtros puestos no aparece ninguna. Prueba con otro estado, otra prioridad, o quita la búsqueda.'
                  : 'La OT llega cuando Gerencia aprueba la cotización con su código interno.'
            }
            accion={
              hayFiltros && (
                <EnlaceBoton href="/ordenes" variante="secundario" tamano="sm">
                  Quitar los filtros
                </EnlaceBoton>
              )
            }
          />
        ) : (
          <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Orden</TH>
              <TH>Cliente / unidad</TH>
              {/* «Trabajo» y «Responsable» esperan a 1400 px: a 1024 la tabla se
                  salía 348 px de su tarjeta, a 1280 todavía 114 y a 1366 (la
                  laptop de siempre) 28, con el responsable fuera de la vista.
                  Hasta ahí van bajo el cliente. */}
              <TH className="hidden min-[1400px]:table-cell">Trabajo</TH>
              <TH>Estado</TH>
              <TH className="w-36 min-[1400px]:w-40">Avance</TH>
              <TH>Entrega</TH>
              <TH className="hidden min-[1400px]:table-cell">Responsable</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {filas.map(({ orden, estado, prioridad, unidad, plazo }) => {
                return (
                  <TR key={orden.id}>
                    <TD className="whitespace-nowrap">
                      {/* Blanco de dedo —y de guante— en el teléfono; en el
                          monitor vuelve a ser una línea de texto y nada más. */}
                      <Link
                        href={enlaceDeOrden(orden.id)}
                        className="inline-flex min-h-11 items-center font-medium text-acento hover:underline sm:min-h-0"
                      >
                        {orden.numero}
                      </Link>
                      <p className="mt-0.5 flex items-center gap-1 text-xs text-texto-suave">
                        <Punto tono={prioridad.tono} />
                        {prioridad.etiqueta}
                      </p>
                    </TD>

                    <TD>
                      {/* Sin `cliente_id` es de verdad sin cliente: la abrió el
                          taller (100). Con él y sin nombre, es que quien mira
                          no tiene clientes.ver, y ahí no se dice nada. */}
                      <p className="line-clamp-2 max-w-44 text-texto min-[1400px]:block min-[1400px]:max-w-52 min-[1400px]:truncate min-[1600px]:max-w-72" title={orden.cliente ?? undefined}>
                        {orden.cliente ?? (orden.cliente_id === null ? (
                          <span className="text-aviso">Sin cliente todavía</span>
                        ) : null)}
                      </p>
                      <p className="text-xs text-texto-suave">
                        {/* Sin placa el nombre lo pone el código de fábrica o
                            el chasis: va más tenue para que nadie lo lea de
                            lejos como si fuera una matrícula. */}
                        <span className={nombreVaTenue(unidad, orden.avance_del_codigo) ? 'text-texto-tenue' : undefined}>
                          {nombreDeUnidadOCodigo(unidad, orden.avance_del_codigo)}
                        </span>
                        {/* El responsable no tiene columna propia hasta 1400 px:
                            viaja aquí, pegado a la unidad. */}
                        {orden.responsable && (
                          <span className="min-[1400px]:hidden"> · {orden.responsable}</span>
                        )}
                      </p>
                      {/* Lo mismo que la columna «Trabajo», hasta que cabe. */}
                      <p className="max-w-44 truncate text-xs text-texto-suave min-[1400px]:hidden" title={orden.descripcion ?? undefined} data-trabajo-en-fila>
                        {orden.descripcion}
                      </p>
                      <p className="max-w-44 truncate text-xs text-texto-suave min-[1400px]:hidden">
                        {definir(TIPO_TRABAJO, orden.tipo_trabajo).etiqueta}
                        {orden.tipo_carroceria ? ` · ${orden.tipo_carroceria}` : ''}
                      </p>
                    </TD>

                    <TD className="hidden min-[1400px]:table-cell">
                      <p className="max-w-64 truncate min-[1600px]:max-w-96" title={orden.descripcion ?? undefined}>{orden.descripcion}</p>
                      <p className="text-xs text-texto-suave">
                        {definir(TIPO_TRABAJO, orden.tipo_trabajo).etiqueta}
                        {orden.tipo_carroceria ? ` · ${orden.tipo_carroceria}` : ''}
                      </p>
                    </TD>

                    <TD>
                      <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                    </TD>

                    <TD>
                      <Progreso valor={orden.avance_porcentaje} mostrarValor alto="sm" />
                      <p className="mt-1 text-xs text-texto-suave">
                        {orden.avance_del_codigo
                          ? `Avance del código ${orden.avance_del_codigo}`
                          : `${orden.etapas_terminadas ?? 0} de ${orden.etapas_total ?? 0} etapas`}
                      </p>
                    </TD>

                    <TD className="whitespace-nowrap">
                      {fecha(orden.fecha_entrega_comprometida)}
                      {/* A 12 px, «faltan 22 días hábiles de taller» en un renglón ensanchaba la
                          columna y la tabla se deslizaba 6 px en un monitor de 1440: parte en dos. */}
                      {plazo && <p className={`max-w-28 text-xs whitespace-normal min-[1400px]:max-w-36 ${plazo.clase}`}>{plazo.texto}</p>}
                    </TD>

                    <TD className="hidden whitespace-nowrap text-texto-suave min-[1400px]:table-cell">
                      {orden.responsable ?? '—'}
                    </TD>
                  </TR>
                )
              })}
          </tbody>
          </Tabla>
        )}
      </Tarjeta>

      <Paginacion
        ruta="/ordenes"
        pagina={pagina}
        paginas={paginas}
        total={total}
        porPagina={ORDENES_POR_PAGINA}
        params={params}
      />
    </>
  )
}
