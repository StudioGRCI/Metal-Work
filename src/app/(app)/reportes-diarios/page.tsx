import { Camera, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { listarReportesDiarios, type ReporteListado } from '@/lib/datos/reportes-diarios'
import { horasPorPersona } from '@/lib/dominio/reporte-diario'
import { horasCortas, mesDeLima, mesValido, mesVecino } from '@/lib/dominio/rrhh'
import { fechaLarga, hoyLima, mesLargo } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Reporte diario' }

export default async function PaginaReportesDiarios({ searchParams }: PageProps<'/reportes-diarios'>) {
  const perfil = await exigirPermiso(['reporte_diario.registrar', 'reporte_diario.ver'])
  const sube = puede(perfil, 'reporte_diario.registrar')
  const veTodos = puede(perfil, 'reporte_diario.ver')
  const params = await searchParams
  const mesActual = mesDeLima(hoyLima())
  const mes = mesValido(params.mes) ? params.mes : mesActual
  const area = typeof params.area === 'string' ? params.area : null

  const todos = await listarReportesDiarios(mes)
  const areas = [...new Set(todos.map((r) => r.area ?? 'Sin área'))].sort()
  const reportes = area ? todos.filter((r) => (r.area ?? 'Sin área') === area) : todos
  const vigentes = reportes.filter((r) => !r.anulado_en)
  const horas = vigentes.reduce((n, r) => n + r.personal.reduce((m, p) => m + p.horas, 0), 0)
  const enlaceMes = (m: string) => `/reportes-diarios?mes=${m}${area ? `&area=${encodeURIComponent(area)}` : ''}`

  return (
    <>
      <EncabezadoPagina
        titulo="Reporte diario"
        descripcion={
          sube
            ? 'Lo que hiciste en el día por código interno: los trabajos con su avance, quién trabajó y cuántas horas, y hasta tres fotos. Las horas pasan solas al costeo de Recursos Humanos.'
            : 'Lo que cada supervisor reporta en el día por código interno: trabajos con su avance, el personal con sus horas y fotos. Las horas pasan solas al costeo por código interno.'
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
        </p>
      </div>

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
            <p className="text-sm font-medium text-texto">Sin reportes este mes</p>
            <p className="text-sm text-texto-suave">
              {sube
                ? 'Sube el del día con «Nuevo reporte»: un reporte por cada código interno en que trabajaste.'
                : 'Aparecen aquí cuando los supervisores suben su reporte del día.'}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <ul className="space-y-3">
          {reportes.map((r) => (
            <li key={r.id}>
              <FilaReporte reporte={r} conArea={veTodos} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function FilaReporte({ reporte: r, conArea }: { reporte: ReporteListado; conArea: boolean }) {
  const personas = horasPorPersona(r.personal).size
  const horas = r.personal.reduce((n, p) => n + p.horas, 0)
  const anulado = r.anulado_en !== null
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
        {anulado ? <Insignia tono="peligro">Anulado</Insignia> : null}
      </div>
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
