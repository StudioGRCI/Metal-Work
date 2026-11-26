import { Camera, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { diasEnEspera } from '@/lib/datos/dias-en-espera'
import { listarReportesDiarios, type ReporteListado } from '@/lib/datos/reportes-diarios'
import { tareosDelMes } from '@/lib/datos/rrhh'
import { ESTADO_REPORTE, estadoDeReporte, faltaParaValidar, horasPorPersona, type EstadoReporte } from '@/lib/dominio/reporte-diario'
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
  const [todos, tareos] = await Promise.all([listarReportesDiarios(mes), veCosto ? tareosDelMes(mes) : Promise.resolve([])])
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
  // Cuánto lleva cada uno esperando el visto de RR. HH. (plan 13, entrega 13.2): desde
  // que el supervisor lo subió, o lo subió corregido, que es otro reporte. Los días
  // los cuenta la base con la fecha de Lima; si no contesta, la lista sale sin ellos.
  const esperanRrhh = reportes.filter(esperaVistoRrhh)
  const diasRrhh = new Map<string, number | null>()
  const contados = await diasEnEspera(esperanRrhh.map((r) => r.creado_en)).catch((e: unknown) => {
    console.error('Reporte diario: no se pudieron contar los días en espera del visto de RR. HH.', e)
    return null
  })
  esperanRrhh.forEach((r, i) => diasRrhh.set(r.id, contados?.[i] ?? null))
  const sinDias = esperanRrhh.length > 0 && contados === null
  const cuantos = (e: EstadoReporte) => deLaArea.filter((r) => estadoDeReporte(r) === e).length
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
        <>
        {sinDias && (
          <p role="status" className="mb-3 text-sm text-texto-suave">
            No se pudieron contar los días que llevan esperando el visto de Recursos Humanos. Vuelve a cargar la pantalla en un momento.
          </p>
        )}
        <ul className="space-y-3">
          {reportes.map((r) => (
            <li key={r.id}>
              <FilaReporte reporte={r} conArea={veTodos} diasRrhh={diasRrhh.get(r.id)} />
            </li>
          ))}
        </ul>
        </>
      )}
    </>
  )
}

/** Por validar y sin el visto de RR. HH.: lo que espera en su bandeja. */
function esperaVistoRrhh(r: ReporteListado) {
  return estadoDeReporte(r) === 'POR_VALIDAR' && !r.visto_rrhh_en
}

function FilaReporte({
  reporte: r,
  conArea,
  diasRrhh,
}: {
  reporte: ReporteListado
  conArea: boolean
  /** Los días que lleva esperando el visto de RR. HH.; `undefined` si no lo espera. */
  diasRrhh?: number | null
  /** Decir que lo tiene RR. HH.: a quien no es RR. HH., el número solo se leería como su propia demora. */
}) {
  const personas = horasPorPersona(r.personal).size
  const horas = r.personal.reduce((n, p) => n + p.horas, 0)
  const anulado = r.anulado_en !== null
  const estado = estadoDeReporte(r)
  const falta = faltaParaValidar(r)
  return (
    <Link
      href={`/reportes-diarios/${r.id}`}
      className={`block rounded-[var(--radius-base)] border border-borde bg-superficie p-4 hover:border-acento ${anulado ? 'opacity-60' : ''}`}
      data-reporte={r.id}
    >
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
          {/* Lo que falta y desde cuándo, en un solo renglón: quién lo tiene ya lo dice
              «Falta…»; si faltan los dos, la insignia no nombra a nadie. */}
          {falta && (
            <p className="mt-1 flex flex-wrap items-center justify-end gap-2 text-xs text-texto-suave">
              <span>{falta}</span>
              {diasRrhh !== undefined && (
                <DiasEnEspera
                  dias={diasRrhh}
                  desde={r.creado_en}
                  quien={r.visto_gerencia_en ? 'Recursos Humanos' : null}
                />
              )}
            </p>
          )}
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
  )
}
