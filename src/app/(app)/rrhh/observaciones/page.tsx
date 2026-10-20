import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import { codigosParaElegir } from '@/lib/datos/codigos-para-elegir'
import { listarObservaciones, listarTrabajadores, type Observacion } from '@/lib/datos/rrhh'
import { MOTIVO_OBSERVACION, TIPO_OBSERVACION, mesDeLima, mesValido, mesVecino } from '@/lib/dominio/rrhh'
import { fecha, hoyLima, mesLargo } from '@/lib/format'
import { editaComoRrhh, exigirPermiso, puede } from '@/lib/sesion'

import { AnularObservacion, RegistrarObservacion } from './formulario'

export const metadata = { title: 'Observaciones y amonestaciones' }

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Resumen = { id: string; nombre: string; cargo: string | null; porTipo: Record<string, number>; dias: number; total: number }

/** Cuántas de cada tipo tiene cada persona, sin contar las anuladas; primero quien tiene más graves. */
function resumir(observaciones: Observacion[]): Resumen[] {
  const porPersona = new Map<string, Resumen>()
  for (const o of observaciones) {
    if (o.anulado_en) continue
    const nombre = o.trabajador ? `${o.trabajador.apellidos}, ${o.trabajador.nombres}` : 'Persona sin ficha'
    const r = porPersona.get(o.trabajador_id) ?? { id: o.trabajador_id, nombre, cargo: o.trabajador?.cargo ?? null, porTipo: {}, dias: 0, total: 0 }
    r.porTipo[o.tipo] = (r.porTipo[o.tipo] ?? 0) + 1
    r.dias += o.dias_suspension ?? 0
    r.total += 1
    porPersona.set(o.trabajador_id, r)
  }
  const peso = (r: Resumen) =>
    (r.porTipo.SUSPENSION ?? 0) * 1000 + (r.porTipo.AMONESTACION_ESCRITA ?? 0) * 100 + (r.porTipo.AMONESTACION_VERBAL ?? 0) * 10 + (r.porTipo.OBSERVACION ?? 0)
  return [...porPersona.values()].sort((a, b) => peso(b) - peso(a) || a.nombre.localeCompare(b.nombre))
}

export default async function PaginaObservaciones({ searchParams }: PageProps<'/rrhh/observaciones'>) {
  const perfil = await exigirPermiso(['rrhh.personal', 'asistencia.ver'])
  const registra = editaComoRrhh(perfil, 'rrhh.personal')
  const planillas = puede(perfil, 'rrhh.ver_planillas')
  const params = await searchParams
  const hoy = hoyLima()
  const mesActual = mesDeLima(hoy)
  const mes = mesValido(params.mes) ? params.mes : mesActual
  const personaId = typeof params.persona === 'string' && GUID.test(params.persona) ? params.persona : null

  const [observaciones, personal, codigos] = await Promise.all([
    listarObservaciones(personaId ? { trabajadorId: personaId } : { mes }),
    listarTrabajadores('todos'),
    registra ? codigosParaElegir() : Promise.resolve(null),
  ])
  const persona = personaId ? personal.find((p) => p.id === personaId) : undefined
  const resumen = resumir(observaciones)
  const vigentes = observaciones.filter((o) => !o.anulado_en)
  const amonestaciones = vigentes.filter((o) => o.tipo !== 'OBSERVACION').length

  return (
    <>
      <EncabezadoPagina
        titulo={persona ? `Historial de ${persona.nombres} ${persona.apellidos}` : 'Observaciones y amonestaciones'}
        ayuda="Lo que se le observa a cada persona: observaciones, amonestaciones verbales y escritas, y suspensiones, con su motivo. No se borran: se anulan con su motivo y quedan como evidencia."
        migas={[
          { titulo: 'Recursos Humanos', ruta: planillas ? '/rrhh' : undefined },
          { titulo: 'Observaciones', ruta: persona ? `/rrhh/observaciones?mes=${mes}` : undefined },
          ...(persona ? [{ titulo: `${persona.nombres} ${persona.apellidos}` }] : []),
        ]}
        acciones={
          registra && (
            <RegistrarObservacion
              hoy={hoy}
              personaInicial={persona?.activo ? persona.id : undefined}
              codigos={codigos}
              personal={personal.filter((p) => p.activo).map((p) => ({ id: p.id, nombre: `${p.nombres} ${p.apellidos}`, cargo: p.cargo }))}
            />
          )
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {persona ? (
          <Link href={`/rrhh/observaciones?mes=${mes}`} className="text-sm font-medium text-acento hover:underline">
            Volver al mes
          </Link>
        ) : (
          <div className="flex items-center gap-1">
            <Link
              href={`/rrhh/observaciones?mes=${mesVecino(mes, -1)}`}
              aria-label="Mes anterior"
              className="inline-flex size-11 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto"
            >
              <ChevronLeft aria-hidden className="size-4" />
            </Link>
            <p className="px-1 text-sm font-medium text-texto first-letter:uppercase">{mesLargo(`${mes}-01`)}</p>
            {mes < mesActual && (
              <Link
                href={`/rrhh/observaciones?mes=${mesVecino(mes, 1)}`}
                aria-label="Mes siguiente"
                className="inline-flex size-11 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto"
              >
                <ChevronRight aria-hidden className="size-4" />
              </Link>
            )}
          </div>
        )}
        <p className="text-xs text-texto-suave">
          <span className="tabular">{vigentes.length}</span> {vigentes.length === 1 ? 'registro' : 'registros'} ·{' '}
          <span className="tabular">{amonestaciones}</span> {amonestaciones === 1 ? 'amonestación o suspensión' : 'amonestaciones o suspensiones'}
        </p>
      </div>

      <div className="space-y-5">
        {!persona && (
          <Tarjeta className="overflow-hidden">
            <TarjetaCabecera titulo="Por persona" ayuda="Toca un nombre para ver todo su historial, de todos los meses." />
            <Tabla>
              <TablaCabecera>
                <tr>
                  <TH>Persona</TH>
                  {/* En el teléfono el rótulo corto: los largos ensanchaban la tabla a 418 px en una pantalla de 390. */}
                  <TH className="text-right">
                    <RotuloCorto corto="Obs." largo="Observaciones" />
                  </TH>
                  <TH className="hidden text-right sm:table-cell">Verbales</TH>
                  <TH className="text-right">Escritas</TH>
                  <TH className="text-right">
                    <RotuloCorto corto="Susp." largo="Suspensiones" />
                  </TH>
                </tr>
              </TablaCabecera>
              <tbody>
                {resumen.length === 0 ? (
                  <SinDatos
                    titulo="Nadie tiene observaciones este mes"
                    descripcion={registra ? 'Registra la primera con el botón de arriba.' : 'Recursos Humanos las registra.'}
                  />
                ) : (
                  resumen.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <Link href={`/rrhh/observaciones?persona=${r.id}&mes=${mes}`} className="font-medium text-texto hover:text-acento hover:underline">
                          {r.nombre}
                        </Link>
                        <p className="text-xs text-texto-suave">{r.cargo ?? 'Sin cargo'}</p>
                        {/* La columna de las verbales no cabe en el teléfono, pero la verbal es el paso antes de la escrita. */}
                        <p className="tabular text-[11px] text-texto-suave sm:hidden">
                          {r.porTipo.AMONESTACION_VERBAL ?? 0} {(r.porTipo.AMONESTACION_VERBAL ?? 0) === 1 ? 'verbal' : 'verbales'}
                        </p>
                      </TD>
                      <TD className="tabular text-right">{r.porTipo.OBSERVACION ?? 0}</TD>
                      <TD className="tabular hidden text-right sm:table-cell">{r.porTipo.AMONESTACION_VERBAL ?? 0}</TD>
                      <TD className={`tabular text-right ${r.porTipo.AMONESTACION_ESCRITA ? 'font-semibold text-peligro' : ''}`}>
                        {r.porTipo.AMONESTACION_ESCRITA ?? 0}
                      </TD>
                      <TD className={`tabular text-right ${r.porTipo.SUSPENSION ? 'font-semibold text-peligro' : ''}`}>
                        {r.porTipo.SUSPENSION ?? 0}
                        {r.dias > 0 && <span className="block text-[11px] font-normal text-texto-suave">{r.dias} {r.dias === 1 ? 'día' : 'días'}</span>}
                      </TD>
                    </TR>
                  ))
                )}
              </tbody>
            </Tabla>
          </Tarjeta>
        )}

        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera
            titulo={persona ? 'Todo lo registrado' : 'Lo registrado en el mes'}
            ayuda="Del más reciente al más antiguo. Lo anulado queda tachado, con su motivo."
          />
          <ul className="divide-y divide-borde">
            {observaciones.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-texto-suave">
                {persona ? 'No tiene nada registrado.' : 'No hay nada registrado este mes.'}
              </li>
            ) : (
              observaciones.map((o) => <Registro key={o.id} observacion={o} registra={registra} mostrarPersona={!persona} />)
            )}
          </ul>
        </Tarjeta>
      </div>
    </>
  )
}

function Registro({ observacion: o, registra, mostrarPersona }: { observacion: Observacion; registra: boolean; mostrarPersona: boolean }) {
  const tipo = TIPO_OBSERVACION[o.tipo] ?? { etiqueta: o.tipo, tono: 'neutro' as const }
  const motivo = MOTIVO_OBSERVACION[o.motivo]?.etiqueta ?? o.motivo
  const nombre = o.trabajador ? `${o.trabajador.nombres} ${o.trabajador.apellidos}` : 'Persona sin ficha'
  const anulada = o.anulado_en !== null
  return (
    <li className={`flex items-start justify-between gap-3 px-4 py-3 ${anulada ? 'opacity-60' : ''}`}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Insignia tono={anulada ? 'neutro' : tipo.tono}>
            {tipo.etiqueta}
            {o.dias_suspension ? ` · ${o.dias_suspension} ${o.dias_suspension === 1 ? 'día' : 'días'}` : ''}
          </Insignia>
          <span className="text-xs font-medium text-texto">{motivo}</span>
          <span className="tabular text-xs text-texto-suave">{fecha(o.fecha)}</span>
          {o.codigo_interno && <span className="font-mono text-xs text-texto-suave">{o.codigo_interno}</span>}
        </div>
        {mostrarPersona && <p className={`text-sm font-semibold text-texto ${anulada ? 'line-through' : ''}`}>{nombre}</p>}
        <p className={`text-sm text-texto ${anulada ? 'line-through' : ''}`}>{o.detalle}</p>
        {anulada && <p className="text-xs text-texto-suave">Anulada: {o.motivo_anulacion}</p>}
      </div>
      {registra && !anulada && (
        <AnularObservacion id={o.id} descripcion={`${tipo.etiqueta} de ${nombre} del ${fecha(o.fecha)}`} />
      )}
    </li>
  )
}

/** El rótulo de una columna, abreviado en el teléfono; el lector de pantalla siempre lee el completo. */
function RotuloCorto({ corto, largo }: { corto: string; largo: string }) {
  return (
    <>
      <span aria-hidden className="sm:hidden">
        {corto}
      </span>
      <span className="sr-only sm:not-sr-only">{largo}</span>
    </>
  )
}
