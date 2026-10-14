import { PencilLine } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia, type Tono } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { reporteDiario, type PersonaReporte } from '@/lib/datos/reportes-diarios'
import { diaDeLima } from '@/lib/dominio/expediente'
import {
  AREA_QUE_VALIDA,
  DIAS_PARA_EL_REPORTE,
  ESTADO_REPORTE,
  estadoDeReporte,
  type LadoValidacion,
} from '@/lib/dominio/reporte-diario'
import { horasCortas } from '@/lib/dominio/rrhh'
import { fechaHora, fechaLarga, hoyLima, sumarDias } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AnularReporte } from './anular'
import { ValidarReporte } from './validacion'

export const metadata = { title: 'Reporte diario' }

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Dónde están las horas de cada persona en el costeo. Solo lo ve RR. HH. */
const COSTEO: Record<NonNullable<PersonaReporte['costeo']>, { etiqueta: string; tono: Tono }> = {
  EN_COSTEO: { etiqueta: 'En el costeo', tono: 'exito' },
  ESPERA_COSTO: { etiqueta: 'Espera su costo mensual', tono: 'aviso' },
  ANULADO: { etiqueta: 'Anulado en el costeo', tono: 'neutro' },
}

export default async function PaginaReporteDiario({ params, searchParams }: PageProps<'/reportes-diarios/[id]'>) {
  const perfil = await exigirPermiso(['reporte_diario.registrar', 'reporte_diario.ver'])
  const { id } = await params
  const { subido } = await searchParams
  if (!GUID.test(id)) notFound()
  const veCosteo = puede(perfil, 'rrhh.personal')
  const r = await reporteDiario(id, veCosteo)
  if (!r) notFound()

  const anulado = r.anulado_en !== null
  const estado = estadoDeReporte(r)
  // Lo mismo que exige `anular_reporte_diario`: quien lo subió, dentro de los 7
  // días y mientras no lo validen las dos áreas; RR. HH., siempre.
  const propio = r.registrado_por === perfil.id && puede(perfil, 'reporte_diario.registrar')
  const aTiempo = (diaDeLima(r.creado_en) ?? '') >= sumarDias(hoyLima(), -DIAS_PARA_EL_REPORTE)
  const puedeAnular = !anulado && (veCosteo || (propio && aTiempo && estado !== 'VALIDADO'))
  const valida: LadoValidacion[] = []
  if (puede(perfil, 'reporte_diario.validar_gerencia')) valida.push('GERENCIA')
  if (puede(perfil, 'reporte_diario.validar_rrhh')) valida.push('RRHH')
  const corrige = propio && estado === 'OBSERVADO'
  const general = r.personal.filter((p) => p.trabajo_id === null)
  const horas = r.personal.reduce((n, p) => n + p.horas, 0)
  const personas = new Set(r.personal.map((p) => p.trabajador_id)).size

  return (
    <>
      <EncabezadoPagina
        titulo={<span className={anulado ? 'line-through' : undefined}>{r.asunto}</span>}
        descripcion={
          <>
            <span className="first-letter:uppercase">{fechaLarga(r.fecha)}</span> · <span className="font-mono text-texto">{r.codigo_interno}</span>
            {r.area && ` · ${r.area}`}
          </>
        }
        migas={[{ titulo: 'Reporte diario', ruta: '/reportes-diarios' }, { titulo: r.asunto }]}
        acciones={
          (corrige || puedeAnular) && (
            <>
              {corrige && (
                <EnlaceBoton href={`/reportes-diarios/nuevo?corrige=${r.id}`} tamano="sm">
                  <PencilLine aria-hidden className="size-4" />
                  Corregir y subir de nuevo
                </EnlaceBoton>
              )}
              {puedeAnular && <AnularReporte id={r.id} asunto={r.asunto} />}
            </>
          )
        }
      />

      {subido === '1' && !anulado && (
        <p role="status" className="mb-4 rounded-lg border border-exito bg-exito-suave px-3 py-2 text-sm text-texto">
          Reporte subido. Sus horas van al costeo de Recursos Humanos con el código {r.codigo_interno}, y Gerencia y Recursos Humanos
          lo validan para la planilla diaria.
        </p>
      )}
      {r.observado_en && (
        <div className="mb-4 rounded-lg border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto" data-observacion>
          <p>
            <span className="font-medium">Observado por {AREA_QUE_VALIDA[r.observacion_area ?? 'RRHH']}</span> el {fechaHora(r.observado_en)}:{' '}
            {r.observacion}
          </p>
          {r.corregido_por ? (
            <p className="mt-1">
              El supervisor ya lo corrigió:{' '}
              <Link href={`/reportes-diarios/${r.corregido_por}`} className="font-medium text-acento underline">
                ver el reporte corregido
              </Link>
              .
            </p>
          ) : corrige ? (
            <p className="mt-1">Corrígelo con «Corregir y subir de nuevo»: se abre con lo que ya escribiste y sus fotos.</p>
          ) : (
            <p className="mt-1">Espera a que el supervisor lo corrija y lo suba de nuevo. Sus horas no entran a la planilla diaria.</p>
          )}
        </div>
      )}
      {anulado && !r.corregido_por && (
        <p className="mb-4 rounded-lg border border-peligro bg-peligro-suave px-3 py-2 text-sm text-texto">
          Anulado el {fechaHora(r.anulado_en)}: {r.motivo_anulacion} Sus horas salieron del costeo.
        </p>
      )}
      {r.reemplaza_a && (
        <p className="mb-4 text-sm text-texto-suave">
          Corrige un{' '}
          <Link href={`/reportes-diarios/${r.reemplaza_a}`} className="font-medium text-acento underline">
            reporte observado
          </Link>
          .
        </p>
      )}

      <div className="max-w-3xl space-y-5">
        {!anulado && (
          <Tarjeta>
            <TarjetaCabecera
              titulo="Validación"
              descripcion="Sus horas entran a la planilla diaria cuando le dan su visto bueno Gerencia y Recursos Humanos, en cualquier orden."
              acciones={<Insignia tono={ESTADO_REPORTE[estado].tono}>{ESTADO_REPORTE[estado].etiqueta}</Insignia>}
            />
            <ul className="divide-y divide-borde">
              {(['GERENCIA', 'RRHH'] as const).map((lado) => {
                const visto = lado === 'GERENCIA' ? r.visto_gerencia_en : r.visto_rrhh_en
                return (
                  <li key={lado} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3" data-lado={lado}>
                    <div>
                      <p className="text-sm font-medium text-texto">{AREA_QUE_VALIDA[lado]}</p>
                      <p className="text-xs text-texto-suave">
                        {visto ? `Visto bueno el ${fechaHora(visto)}` : estado === 'OBSERVADO' ? 'Sin visto: está observado' : 'Falta su visto bueno'}
                      </p>
                    </div>
                    {estado === 'POR_VALIDAR' && valida.includes(lado) && <ValidarReporte id={r.id} lado={lado} yaDioVisto={Boolean(visto)} />}
                  </li>
                )
              })}
            </ul>
          </Tarjeta>
        )}

        <Tarjeta>
          <TarjetaCabecera
            titulo="Lo que cuenta el reporte"
            descripcion={`${personas} ${personas === 1 ? 'persona' : 'personas'} · ${horasCortas(horas)} · subido ${fechaHora(r.creado_en)}`}
          />
          <TarjetaCuerpo>
            <p className="text-sm whitespace-pre-line text-texto">{r.descripcion}</p>
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera titulo="Trabajos realizados" />
          <ul className="divide-y divide-borde">
            {r.trabajos.map((t) => {
              const suyos = r.personal.filter((p) => p.trabajo_id === t.id)
              return (
                <li key={t.id} className="space-y-2 px-4 py-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_9rem] sm:items-center">
                    <p className="text-sm text-texto">
                      <span className="tabular mr-1 text-texto-suave">{t.orden}.</span>
                      {t.descripcion}
                    </p>
                    <Progreso valor={t.avance} mostrarValor etiqueta={`Avance de ${t.descripcion}`} />
                  </div>
                  {suyos.length > 0 && <Personal personas={suyos} veCosteo={veCosteo} />}
                </li>
              )
            })}
          </ul>
        </Tarjeta>

        {general.length > 0 && (
          <Tarjeta className="overflow-hidden">
            <TarjetaCabecera titulo="Personal general" descripcion="La misma gente para todos los trabajos del reporte." />
            <div className="px-4 pb-3">
              <Personal personas={general} veCosteo={veCosteo} />
            </div>
          </Tarjeta>
        )}

        <Tarjeta>
          <TarjetaCabecera titulo="Fotos" />
          <TarjetaCuerpo>
            {r.fotos.length === 0 ? (
              <p className="text-sm text-texto-suave">Este reporte se subió sin fotos.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {r.fotos.map((f) => (
                  <li key={f.id}>
                    {f.enlace ? (
                      <a href={f.enlace} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-borde">
                        {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado de Storage, no pasa por el optimizador */}
                        <img src={f.enlace} alt={`Foto ${f.orden} del reporte`} className="aspect-square w-full object-cover" loading="lazy" />
                      </a>
                    ) : (
                      <p className="flex aspect-square items-center justify-center rounded-lg border border-borde p-2 text-center text-xs text-texto-suave">
                        La foto {f.orden} no se pudo abrir ahora
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TarjetaCuerpo>
        </Tarjeta>
      </div>
    </>
  )
}

function Personal({ personas, veCosteo }: { personas: PersonaReporte[]; veCosteo: boolean }) {
  return (
    <Tabla>
      <TablaCabecera>
        <tr>
          <TH>Persona</TH>
          <TH className="text-right">Horas</TH>
          {veCosteo && <TH className="hidden sm:table-cell">Costeo</TH>}
        </tr>
      </TablaCabecera>
      <tbody>
        {personas.map((p) => {
          const costeo = p.costeo ? COSTEO[p.costeo] : null
          return (
            <TR key={p.id}>
              <TD>
                <p className="font-medium text-texto">{p.nombre}</p>
                {p.cargo && <p className="text-xs text-texto-suave">{p.cargo}</p>}
                {costeo && (
                  <span className="sm:hidden">
                    <Insignia tono={costeo.tono}>{costeo.etiqueta}</Insignia>
                  </span>
                )}
              </TD>
              <TD className="tabular text-right">{horasCortas(p.horas)}</TD>
              {veCosteo && <TD className="hidden sm:table-cell">{costeo && <Insignia tono={costeo.tono}>{costeo.etiqueta}</Insignia>}</TD>}
            </TR>
          )
        })}
      </tbody>
    </Tabla>
  )
}
