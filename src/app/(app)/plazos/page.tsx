import Link from 'next/link'
import { AlertTriangle, CalendarClock, CircleCheck, Factory, Search, Workflow } from 'lucide-react'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { AvisoTope } from '@/components/estructura/paginacion'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Indicador } from '@/components/ui/indicador'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { ESTADO_PLAZO } from '@/lib/dominio/estados'
import { fecha } from '@/lib/format'
import { TOPE_PLAZOS, plazosPorArea, resumenDePlazos, type FilaPlazo } from '@/lib/datos/plazos'
import { exigirPermiso, puede } from '@/lib/sesion'

import { Reporte } from './reporte'

export const metadata = { title: 'Control de plazos' }


/**
 * El control de plazos por área.
 *
 * Es el `CONTROL DE PLAZOS - MWP - 2026.xlsx` de la empresa —siete hojas, una
 * por área— convertido en una sola pantalla con el área como filtro. La
 * pregunta que se hace Gerencia, «¿qué está vencido?», cruza las siete hojas: en
 * el Excel hay que abrirlas una por una y sumar a ojo.
 *
 * La responsabilidad es del área y no de una persona —un área es siempre un
 * equipo— así que acá no se nombra a nadie: se agrupa por área. Y la ve
 * cualquier área del taller —que Maestranza vea que Diseño la tiene trabada es
 * justamente el punto—, pero no ventas: quien vende no responde por un plazo de
 * taller. De ahí `ordenes.listar`, que es entrar al módulo, en vez de
 * `ordenes.ver`, que es la llave de lectura que ventas sí necesita para sus
 * garantías.
 *
 * En el teléfono, una tarjeta por etapa (como /ordenes): la tabla de siete
 * columnas obligaba a desplazarse de lado para leer el reporte, y es la
 * pestaña de abajo del taller.
 */
export default async function PaginaPlazos({ searchParams }: PageProps<'/plazos'>) {
  const perfil = await exigirPermiso(['ordenes.listar', 'produccion.ver'])
  const params = await searchParams

  const area = typeof params.area === 'string' ? params.area : undefined
  const plazo = typeof params.plazo === 'string' ? params.plazo : undefined
  const busqueda = typeof params.q === 'string' ? params.q : undefined

  const [filas, resumen] = await Promise.all([
    plazosPorArea({ area, plazo, busqueda }),
    resumenDePlazos(),
  ])

  const puedeReportar = puede(perfil, 'produccion.registrar')
  const puedeVerificar = puede(perfil, 'ordenes.editar')

  // Las cuentas salen del resumen y no de `filas`: si contaran lo filtrado,
  // encender «Vencido» dejaría las demás pastillas en cero y parecería que no
  // hay nada en ellas.
  const vencidas = resumen.porPlazo.VENCIDO ?? 0
  const porVencer = resumen.porPlazo.POR_VENCER ?? 0
  const vigentes = resumen.porPlazo.VIGENTE ?? 0

  const filtrosAreasAcceso = [
    { valor: null, nombre: 'Todas las áreas', pendientes: resumen.total, total: resumen.total },
    ...resumen.areas.map((a) => ({
      valor: a.codigo,
      nombre: a.nombre,
      pendientes: a.vencidas,
      total: a.total,
    })),
  ]

  const filtrosPlazo = [
    { valor: null, etiqueta: 'Todo', clave: 'plazo' },
    ...(vencidas > 0 ? [{ valor: 'VENCIDO', etiqueta: `Vencido (${vencidas})`, clave: 'plazo' }] : []),
    ...(porVencer > 0
      ? [{ valor: 'POR_VENCER', etiqueta: `Por vencer (${porVencer})`, clave: 'plazo' }]
      : []),
    ...(vigentes > 0 ? [{ valor: 'VIGENTE', etiqueta: `Vigente (${vigentes})`, clave: 'plazo' }] : []),
  ]

  const vacio = (
    <SinDatos
      colSpan={7}
      titulo={resumen.total === 0 ? 'Todavía no hay etapas que controlar' : 'Nada con ese filtro'}
      descripcion={
        resumen.total === 0
          ? 'Cuando se apruebe una orden de trabajo, sus catorce etapas aparecen acá con la fecha que salió del tiempo por área de la cotización.'
          : busqueda
            ? 'Prueba con otro número de orden, otra placa u otro cliente.'
            : 'Prueba con otra área o con otro plazo.'
      }
    />
  )

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Control de plazos' }]}
        titulo="Avance del taller"
        descripcion="Revisa qué necesita atención, entra al área y deja el reporte o seguimiento desde la misma lista."
      />

      <section aria-label="Resumen de plazos" className="grid gap-3 sm:grid-cols-3">
        <Indicador
          titulo="Vencidas"
          valor={vencidas}
          icono={AlertTriangle}
          tono={vencidas > 0 ? 'peligro' : 'neutro'}
          pie="La fecha ya pasó"
          href="/plazos?plazo=VENCIDO"
        />
        <Indicador
          titulo="Por vencer"
          valor={porVencer}
          icono={CalendarClock}
          tono={porVencer > 0 ? 'aviso' : 'neutro'}
          pie="Menos de una semana"
          href="/plazos?plazo=POR_VENCER"
        />
        <Indicador
          titulo="Vigentes"
          valor={vigentes}
          icono={CircleCheck}
          tono="neutro"
          pie="Con siete días o más"
          href="/plazos?plazo=VIGENTE"
        />
      </section>

      <section className="mt-6 rounded-[var(--radius-base)] border border-borde bg-superficie p-4 shadow-[var(--sombra)] sm:p-5" aria-labelledby="areas-plazos-titulo">
        <div className="mb-3 flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-acento-suave text-acento">
            <Factory aria-hidden className="size-5" />
          </span>
          <div>
            <h2 id="areas-plazos-titulo" className="text-sm font-semibold text-texto">¿Qué área quieres revisar?</h2>
            <p className="mt-0.5 text-xs text-texto-suave">Entra directamente a sus etapas. El número rojo indica pendientes vencidos.</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {filtrosAreasAcceso.map((item) => {
            const activa = (area ?? null) === item.valor
            const href = item.valor ? `/plazos?area=${encodeURIComponent(item.valor)}` : '/plazos'
            return (
              <Link
                key={item.valor ?? 'todas'}
                href={href}
                aria-current={activa ? 'page' : undefined}
                className={`flex min-h-16 items-center justify-between gap-3 rounded-[var(--radius-base)] border px-3 py-2.5 transition-colors ${activa ? 'border-acento bg-acento-suave ring-1 ring-acento' : 'border-borde bg-superficie hover:border-borde-fuerte hover:bg-superficie-2'}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-texto">{item.nombre}</span>
                  <span className="text-xs text-texto-suave">{item.total} {item.total === 1 ? 'etapa' : 'etapas'}</span>
                </span>
                {item.pendientes > 0 ? (
                  <span className="tabular inline-flex min-w-8 items-center justify-center rounded-full bg-peligro-suave px-2 py-1 text-xs font-semibold text-peligro" aria-label={`${item.pendientes} vencidas`}>
                    {item.pendientes}
                  </span>
                ) : (
                  <CircleCheck aria-label="Sin vencidas" className="size-4 shrink-0 text-exito" />
                )}
              </Link>
            )
          })}
        </div>
      </section>

      <section className="mt-5 rounded-[var(--radius-base)] border border-borde bg-superficie p-4 shadow-[var(--sombra)] sm:p-5" aria-labelledby="seguimiento-titulo">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Workflow aria-hidden className="size-4 text-acento" />
            <h2 id="seguimiento-titulo" className="text-sm font-semibold text-texto">Etapas y reportes</h2>
          </div>
          <span className="text-xs text-texto-suave">{filas.length} {filas.length === 1 ? 'etapa en esta vista' : 'etapas en esta vista'}</span>
        </div>
        <div className="mb-4 max-w-xl">
          <BuscadorSimple ruta="/plazos" etiqueta="Buscar una orden, unidad o cliente" marcador="N.º de orden, placa, código o cliente" />
        </div>

        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-texto-suave">
          <Search aria-hidden className="size-3.5" />
          <span>Filtra también por plazo</span>
        </div>
        <PastillaFiltro
          ruta="/plazos"
          clave="plazo"
          opciones={filtrosPlazo}
          params={params}
          activo={plazo ?? null}
          etiqueta="Filtrar por plazo"
          className="mb-4"
        />
      </section>

      {/* El teléfono: una tarjeta por etapa, con el reporte a ancho completo. */}
      {filas.length > 0 && (
        <ul className="space-y-3 sm:hidden">
          {filas.map((f) => (
            <TarjetaEtapa key={f.etapa_id} fila={f} puedeReportar={puedeReportar} puedeVerificar={puedeVerificar} />
          ))}
        </ul>
      )}

      {/* La tabla se esconde en el teléfono solo cuando hay filas: sin ellas
          es la que muestra el estado vacío, y ocultarla dejaba la pantalla en
          blanco. */}
      <Tarjeta className={filas.length > 0 ? 'hidden overflow-hidden sm:block' : 'overflow-hidden'}>
        <div className="overflow-x-auto">
          <Tabla>
            <TablaCabecera>
              <TR>
                <TH>Unidad</TH>
                <TH className="hidden lg:table-cell">Área</TH>
                <TH>Etapa</TH>
                <TH className="hidden sm:table-cell">Programado</TH>
                <TH className="text-right">Días</TH>
                <TH>Plazo</TH>
                <TH className="w-72">Lo que reporta el área</TH>
              </TR>
            </TablaCabecera>
            <tbody>
              {filas.length === 0
                ? vacio
                : filas.map((f) => {
                    const semaforo = f.plazo ? ESTADO_PLAZO[f.plazo] : null
                    const dias = f.dias
                    const cerrada = f.plazo === 'CUMPLIDO' || f.plazo === 'CUMPLIDO_TARDE'

                    return (
                      <TR key={f.etapa_id}>
                        <TD>
                          <Link
                            href={`/ordenes/${f.orden_id}?vista=etapas#etapa-${f.etapa_id}`}
                            className="font-medium text-acento hover:underline"
                          >
                            {f.orden_numero}
                          </Link>
                          <p className="max-w-64 truncate text-[11px] text-texto-suave">
                            {f.unidad}
                          </p>
                          {/* El código interno es como la empresa nombra la unidad
                              en todas sus hojas; la placa muchas veces todavía no
                              existe. */}
                          <p className="text-[11px] text-texto-tenue">
                            {f.codigo_interno ?? f.placa ?? f.cliente}
                          </p>
                        </TD>

                        <TD className="hidden lg:table-cell">
                          <span className="text-sm text-texto">{f.area_nombre ?? '—'}</span>
                          {f.area_encargado && (
                            <p className="text-[11px] text-texto-tenue">{f.area_encargado}</p>
                          )}
                        </TD>

                        <TD className="max-w-44">
                          <p className="text-sm text-texto-suave">{f.etapa_nombre}</p>
                        </TD>

                        <TD className="hidden text-xs whitespace-nowrap text-texto-suave sm:table-cell">
                          {fecha(f.fecha_inicio_programada) ?? '—'}
                          {' → '}
                          {fecha(f.fecha_fin_programada) ?? '—'}
                        </TD>

                        <TD className="tabular text-right whitespace-nowrap">
                          {cerrada || dias === null ? (
                            <span className="text-texto-tenue">—</span>
                          ) : (
                            <span
                              className={
                                dias < 0 ? 'font-medium text-peligro' : dias < 7 ? 'text-aviso' : ''
                              }
                            >
                              {dias < 0 ? `${dias}` : `+${dias}`}
                            </span>
                          )}
                        </TD>

                        <TD>
                          {semaforo ? (
                            <Insignia tono={semaforo.tono}>{semaforo.etiqueta}</Insignia>
                          ) : (
                            <span className="text-[11px] text-texto-tenue">Sin fecha</span>
                          )}
                        </TD>

                        <TD>
                          <Reporte
                            etapaId={f.etapa_id as string}
                            ordenId={f.orden_id as string}
                            ultimo={f.ultimo_reporte}
                            reportadoEn={f.ultimo_reporte_en}
                            verificadoEn={f.ultimo_reporte_verificado_en}
                            reporteId={f.ultimo_reporte_id}
                            puedeReportar={puedeReportar}
                            puedeVerificar={puedeVerificar}
                          />
                        </TD>
                      </TR>
                    )
                  })}
            </tbody>
          </Tabla>
        </div>
      </Tarjeta>

      <AvisoTope mostradas={filas.length} tope={TOPE_PLAZOS} />
    </>
  )
}

/** La etapa en el teléfono: la orden, el semáforo con sus días y el reporte abajo. */
function TarjetaEtapa({
  fila: f,
  puedeReportar,
  puedeVerificar,
}: {
  fila: FilaPlazo
  puedeReportar: boolean
  puedeVerificar: boolean
}) {
  const semaforo = f.plazo ? ESTADO_PLAZO[f.plazo] : null
  const dias = f.dias
  const cerrada = f.plazo === 'CUMPLIDO' || f.plazo === 'CUMPLIDO_TARDE'

  return (
    <li>
      <Tarjeta className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href={`/ordenes/${f.orden_id}?vista=etapas#etapa-${f.etapa_id}`}
              className="inline-flex min-h-11 items-center text-sm font-medium text-acento hover:underline"
            >
              {f.orden_numero}
            </Link>
            <p className="truncate text-[11px] text-texto-suave">{f.unidad}</p>
            <p className="text-[11px] text-texto-tenue">{f.codigo_interno ?? f.placa ?? f.cliente}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {semaforo ? (
              <Insignia tono={semaforo.tono}>{semaforo.etiqueta}</Insignia>
            ) : (
              <span className="text-[11px] text-texto-tenue">Sin fecha</span>
            )}
            {!cerrada && dias !== null && (
              <span className={`tabular text-xs ${dias < 0 ? 'font-medium text-peligro' : dias < 7 ? 'text-aviso' : 'text-texto-suave'}`}>
                {dias < 0 ? `${dias} días` : `+${dias} días`}
              </span>
            )}
          </div>
        </div>

        <p className="text-sm text-texto">
          {f.etapa_nombre}
          {f.area_nombre && <span className="text-texto-suave"> · {f.area_nombre}</span>}
        </p>
        <p className="tabular text-[11px] text-texto-suave">
          {fecha(f.fecha_inicio_programada) ?? '—'} → {fecha(f.fecha_fin_programada) ?? '—'}
        </p>

        <div className="border-t border-borde pt-2">
          <Reporte
            etapaId={f.etapa_id as string}
            ordenId={f.orden_id as string}
            ultimo={f.ultimo_reporte}
            reportadoEn={f.ultimo_reporte_en}
            verificadoEn={f.ultimo_reporte_verificado_en}
            reporteId={f.ultimo_reporte_id}
            puedeReportar={puedeReportar}
            puedeVerificar={puedeVerificar}
          />
        </div>
      </Tarjeta>
    </li>
  )
}
