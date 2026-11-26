import { Camera, ChevronLeft, ChevronRight, PencilLine, Plus } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { Progreso } from '@/components/ui/progreso'
import { Recorrido } from '@/components/ui/recorrido'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { recorridoDeReportesDiarios, type Recorridos } from '@/lib/datos/recorrido'
import { listarReportesDiarios, reportesObservadosPorCorregir, type ReporteListado, type ReporteObservado } from '@/lib/datos/reportes-diarios'
import { tareosDelMes } from '@/lib/datos/rrhh'
import { describirRecorridoDelReporte } from '@/lib/dominio/recorrido'
import {
  AREA_QUE_VALIDA,
  ESTADO_REPORTE,
  estadoDeReporte,
  faltaParaValidar,
  horasPorPersona,
  type EstadoReporte,
} from '@/lib/dominio/reporte-diario'
import { horasCortas, mesDeLima, mesValido, mesVecino } from '@/lib/dominio/rrhh'
import { fechaLarga, hoyLima, mesLargo, moneda } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Reporte diario' }

/** El filtro por estado: lo que espera a quien mira primero. */
const FILTRO_ESTADO: Record<string, EstadoReporte> = { 'por-validar': 'POR_VALIDAR', observados: 'OBSERVADO', validados: 'VALIDADO' }
/**
 * Lo que espera el visto de Gerencia: desde el 2026-11-25 es todo el trabajo de
 * Gerencia de Producción, y «Por validar» cuenta también lo que ya tiene su
 * visto y espera a RR. HH.
 */
const FALTA_GERENCIA = 'falta-gerencia'
const faltaGerencia = (r: { anulado_en: string | null; observado_en: string | null; visto_gerencia_en: string | null; visto_rrhh_en: string | null }) =>
  estadoDeReporte(r) === 'POR_VALIDAR' && !r.visto_gerencia_en

export default async function PaginaReportesDiarios({ searchParams }: PageProps<'/reportes-diarios'>) {
  const perfil = await exigirPermiso(['reporte_diario.registrar', 'reporte_diario.ver'])
  const sube = puede(perfil, 'reporte_diario.registrar')
  const veTodos = puede(perfil, 'reporte_diario.ver')
  const params = await searchParams
  const mesActual = mesDeLima(hoyLima())
  const mes = mesValido(params.mes) ? params.mes : mesActual
  const area = typeof params.area === 'string' ? params.area : null
  const daVistoGerencia = puede(perfil, 'reporte_diario.validar_gerencia')
  const filtro =
    typeof params.estado === 'string' && (params.estado in FILTRO_ESTADO || (daVistoGerencia && params.estado === FALTA_GERENCIA))
      ? params.estado
      : null

  // RR. HH. ve lo que cuestan esas horas: el costeo por código ya las tiene con su costo.
  const veCosto = puede(perfil, 'rrhh.personal')
  // Lo observado que espera su corrección va arriba, de cualquier mes: es lo único que le toca hacer al supervisor.
  const [todos, tareos, observados] = await Promise.all([
    listarReportesDiarios(mes),
    veCosto ? tareosDelMes(mes) : Promise.resolve([]),
    sube ? reportesObservadosPorCorregir(perfil.id) : Promise.resolve([]),
  ])
  const areas = [...new Set(todos.map((r) => r.area ?? 'Sin área'))].sort()
  const deLaArea = area ? todos.filter((r) => (r.area ?? 'Sin área') === area) : todos
  const reportes = !filtro
    ? deLaArea
    : filtro === FALTA_GERENCIA
      ? deLaArea.filter(faltaGerencia)
      : deLaArea.filter((r) => estadoDeReporte(r) === FILTRO_ESTADO[filtro])
  const vigentes = reportes.filter((r) => !r.anulado_en)
  const horas = vigentes.reduce((n, r) => n + r.personal.reduce((m, p) => m + p.horas, 0), 0)
  const idsVigentes = new Set(vigentes.map((r) => r.id))
  const costoHoras = tareos.filter((t) => !t.anulado_en && t.reporte && idsVigentes.has(t.reporte.id)).reduce((n, t) => n + t.costo, 0)
  const cuantos = (e: EstadoReporte) => deLaArea.filter((r) => estadoDeReporte(r) === e).length
  // Quién tiene cada reporte y hace cuántos días (migración 20261126331000). Si
  // la base no contesta, la lista sale igual y cada tarjeta dice que no se pudo leer.
  const recorridos = await recorridoDeReportesDiarios([...reportes.map((r) => r.id), ...observados.map((r) => r.id)]).catch((e: unknown) => {
    console.error('Reporte diario: no se pudo leer el recorrido.', e)
    return null
  })
  const enlaceMes = (m: string) =>
    `/reportes-diarios?mes=${m}${area ? `&area=${encodeURIComponent(area)}` : ''}${filtro ? `&estado=${filtro}` : ''}`

  return (
    <>
      <EncabezadoPagina
        titulo="Reporte diario"
        ayuda={
          sube
            ? 'Lo que hiciste en el día por código interno: los trabajos con su avance, quién trabajó y cuántas horas, y hasta tres fotos. Las horas pasan solas al costeo; Gerencia y Recursos Humanos lo validan para la planilla diaria, o te lo observan para que lo corrijas.'
            : 'Lo que cada supervisor reporta en el día por código interno: trabajos con su avance, el personal con sus horas y fotos. Con el visto bueno de Gerencia y de Recursos Humanos, sus horas pasan a la planilla diaria.'
        }
        migas={[{ titulo: 'Reporte diario' }]}
        acciones={
          sube && (
            <EnlaceBoton href="/reportes-diarios/nuevo">
              <Plus aria-hidden className="size-4" />
              Nuevo reporte
            </EnlaceBoton>
          )
        }
      />

      {observados.length > 0 && <ObservadosPorCorregir reportes={observados} recorridos={recorridos} />}

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link
            href={enlaceMes(mesVecino(mes, -1))}
            aria-label="Mes anterior"
            className="inline-flex size-11 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto sm:size-9"
          >
            <ChevronLeft aria-hidden className="size-4" />
          </Link>
          <p className="px-1 text-sm font-medium text-texto first-letter:uppercase">{mesLargo(`${mes}-01`)}</p>
          {mes < mesActual && (
            <Link
              href={enlaceMes(mesVecino(mes, 1))}
              aria-label="Mes siguiente"
              className="inline-flex size-11 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto sm:size-9"
            >
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          )}
        </div>
        <p className="text-xs text-texto-suave">
          <span className="tabular">{vigentes.length}</span> {vigentes.length === 1 ? 'reporte' : 'reportes'} ·{' '}
          <span className="tabular">{horasCortas(horas)}</span> de personal
          {veCosto && costoHoras > 0 && (
            <>
              {' '}
              · <span className="tabular whitespace-nowrap">{moneda(costoHoras)}</span>
            </>
          )}
        </p>
      </div>

      <PastillaFiltro
        ruta="/reportes-diarios"
        clave="estado"
        params={params}
        activo={filtro}
        etiqueta="Estado"
        opciones={[
          { valor: null, etiqueta: 'Todos' },
          ...(daVistoGerencia
            ? [{ valor: FALTA_GERENCIA, etiqueta: `Falta Gerencia (${deLaArea.filter(faltaGerencia).length})` }]
            : []),
          { valor: 'por-validar', etiqueta: `Por validar (${cuantos('POR_VALIDAR')})` },
          { valor: 'observados', etiqueta: `Observados (${cuantos('OBSERVADO')})` },
          { valor: 'validados', etiqueta: `Validados (${cuantos('VALIDADO')})` },
        ]}
        className="mb-3"
      />

      {veTodos && areas.length > 1 && (
        <PastillaFiltro
          ruta="/reportes-diarios"
          clave="area"
          params={params}
          activo={area}
          etiqueta="Área"
          opciones={[{ valor: null, etiqueta: 'Todas' }, ...areas.map((a) => ({ valor: a, etiqueta: a }))]}
          className="mb-3"
        />
      )}

      {reportes.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">{filtro ? 'Ningún reporte en este estado' : 'Sin reportes este mes'}</p>
            <p className="text-sm text-texto-suave">
              {filtro
                ? 'Quita el filtro de estado con «Todos» para ver el resto.'
                : sube
                  ? 'Sube el del día con «Nuevo reporte»: un reporte por cada código interno en que trabajaste.'
                  : 'Aparecen aquí cuando los supervisores suben su reporte del día.'}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-3">
          {reportes.map((r) => (
            <li key={r.id}>
              <FilaReporte reporte={r} conArea={veTodos} recorridos={recorridos} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * Lo observado que espera su corrección, arriba de todo y de cualquier mes: qué
 * área lo observó, hace cuántos días, el motivo, y el salto a corregirlo.
 */
function ObservadosPorCorregir({ reportes, recorridos }: { reportes: ReporteObservado[]; recorridos: Recorridos | null }) {
  return (
    <Tarjeta className="mb-5 border-aviso" data-observados-por-corregir>
      <TarjetaCabecera
        titulo={reportes.length === 1 ? 'Un reporte observado por corregir' : `${reportes.length} reportes observados por corregir`}
        ayuda="Gerencia o Recursos Humanos los observaron y sus horas no entran a la planilla diaria hasta que los corrijas. «Corregir y subir de nuevo» abre el reporte con lo que ya escribiste y sus fotos; el observado queda anulado."
      />
      <ul className="divide-y divide-borde">
        {reportes.map((r) => {
          // Los días los cuenta la base, desde que lo observaron: es el paso que espera.
          const espera = recorridos?.get(r.id)?.find((p) => p.situacion === 'AHORA')
          return (
            <li key={r.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3" data-observado={r.id}>
              <div className="min-w-0 flex-1 basis-64 space-y-1">
                <p className="text-xs text-texto-suave first-letter:uppercase">
                  {fechaLarga(r.fecha)} · <span className="font-mono text-texto">{r.codigo_interno}</span>
                </p>
                <p className="font-semibold break-words text-texto">{r.asunto}</p>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-texto">
                  <span className="font-medium">Observado por {AREA_QUE_VALIDA[r.observacion_area ?? 'RRHH']}</span>
                  <DiasEnEspera dias={espera?.dias} desde={espera?.en ?? r.observado_en} />
                </p>
                {r.observacion && <p className="text-sm break-words text-texto-suave">{r.observacion}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <EnlaceBoton href={`/reportes-diarios/nuevo?corrige=${r.id}`} tamano="sm">
                  <PencilLine aria-hidden className="size-4" />
                  Corregir y subir de nuevo
                </EnlaceBoton>
                <EnlaceBoton href={`/reportes-diarios/${r.id}`} variante="secundario" tamano="sm">
                  Ver el reporte
                </EnlaceBoton>
              </div>
            </li>
          )
        })}
      </ul>
    </Tarjeta>
  )
}

function FilaReporte({
  reporte: r,
  conArea,
  recorridos,
}: {
  reporte: ReporteListado
  conArea: boolean
  recorridos: Recorridos | null
}) {
  const personas = horasPorPersona(r.personal).size
  const horas = r.personal.reduce((n, p) => n + p.horas, 0)
  const anulado = r.anulado_en !== null
  const estado = estadoDeReporte(r)
  const falta = faltaParaValidar(r)
  return (
    <div
      className="overflow-hidden rounded-[var(--radius-base)] border border-borde bg-superficie has-[>a:hover]:border-acento"
      data-reporte={r.id}
    >
      <Link href={`/reportes-diarios/${r.id}`} className={`block p-4 ${anulado ? 'opacity-60' : ''}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-texto-suave first-letter:uppercase">
              {fechaLarga(r.fecha)}
              {conArea && ` · ${r.area ?? 'Sin área'}`}
            </p>
            <p className={`font-semibold text-texto ${anulado ? 'line-through' : ''}`}>{r.asunto}</p>
            <p className="font-mono text-xs text-texto">{r.codigo_interno}</p>
          </div>
          <div className="text-right">
            <Insignia tono={ESTADO_REPORTE[estado].tono}>{ESTADO_REPORTE[estado].etiqueta}</Insignia>
            {falta && <p className="mt-1 text-xs text-texto-suave">{falta}</p>}
          </div>
        </div>
        {estado === 'OBSERVADO' && r.observacion && <p className="mt-1 text-xs text-texto">Observación: {r.observacion}</p>}
        <ul className="mt-2 space-y-1">
          {r.trabajos.map((t) => (
            <li key={t.id} className="grid grid-cols-[1fr_6.5rem] items-center gap-3 text-xs">
              <span className="truncate text-texto">{t.descripcion}</span>
              <Progreso valor={t.avance} alto="sm" mostrarValor etiqueta={`Avance de ${t.descripcion}`} />
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-texto-suave">
          {personas} {personas === 1 ? 'persona' : 'personas'} · <span className="tabular">{horasCortas(horas)}</span>
          {r.personal_general && ' · personal general'}
          {r.fotos > 0 && (
            <>
              {' · '}
              <Camera aria-hidden className="inline size-3.5 align-[-2px]" /> {r.fotos}
            </>
          )}
        </p>
      </Link>
      {/* Quién lo tiene y hace cuánto, sin abrirlo; abierto, cada paso con su puesto y su hora. */}
      <Recorrido pasos={recorridos ? describirRecorridoDelReporte(recorridos.get(r.id) ?? []) : null} className="border-t border-borde" />
    </div>
  )
}
