import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import { codigosConTiempos, etapasConTiempos, etapasPorPersona, responsablesDeEtapas } from '@/lib/datos/tiempos-entrega'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { RUTA_TIEMPOS, SEMAFORO_DE_CODIGO, enlaceDeTiempos, plazoEnPalabras } from '@/lib/dominio/tiempos-entrega'
import { fecha, hoyLima } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

export const metadata = { title: 'Tiempos de entrega por persona' }

const RUTA = `${RUTA_TIEMPOS}/personas`

/** Cómo se lee el color de una persona: lo peor que lleva. */
const SEMAFORO_DE_PERSONA = {
  ROJO: 'Tiene vencidas',
  AMBAR: 'Tiene por vencer',
  VERDE: 'A tiempo',
  SIN_FECHA: 'Sin fechas',
  TERMINADA: 'Al día',
} as const

/**
 * Lo que lleva cada persona del personal (DKS, 2026-11-25, entrega 2 del plan
 * de tiempos de entrega): sus etapas sin terminar con su semáforo, lo vencido
 * primero. Recursos Humanos las asigna en el detalle de cada código.
 */
export default async function PaginaTiemposPorPersona({ searchParams }: PageProps<'/rrhh/tiempos-de-entrega/personas'>) {
  await exigirPermiso('rrhh.tiempos_entrega')
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q.trim() : ''
  const [todas, codigos, etapas, responsables] = await Promise.all([
    etapasPorPersona(),
    codigosConTiempos(),
    etapasConTiempos(null),
    responsablesDeEtapas(null),
  ])
  // Lo que falta repartir: las etapas sin terminar de los códigos por entregar
  // que todavía no lleva nadie, por código.
  const porEntregar = new Set(codigos.map((c) => c.codigo))
  const sinPersona = new Map<string, number>()
  for (const e of etapas) {
    if (e.fin_real || !porEntregar.has(e.codigo) || responsables.has(e.id)) continue
    sinPersona.set(e.codigo, (sinPersona.get(e.codigo) ?? 0) + 1)
  }
  const etapasSinPersona = [...sinPersona.values()].reduce((n, v) => n + v, 0)
  const hoy = hoyLima()
  const palabras = palabrasDeBusqueda(q)
  const personas = q ? todas.filter((p) => coincide(palabras, [p.nombre, p.area, ...p.etapas.map((e) => e.codigo)])) : todas
  const conVencidas = todas.filter((p) => p.etapas.some((e) => e.semaforo === 'ROJO')).length
  const conPorVencer = todas.filter((p) => p.etapas.some((e) => e.semaforo === 'AMBAR')).length

  return (
    <>
      <EncabezadoPagina
        titulo="Lo que lleva cada persona"
        descripcion={todas.length > 0 ? `${todas.length} ${todas.length === 1 ? 'persona con etapas a cargo' : 'personas con etapas a cargo'}` : undefined}
        ayuda="Cada persona del personal con las etapas sin terminar que lleva, lo vencido primero. La persona de cada etapa la pone Recursos Humanos en el detalle del código, con «Asignar persona»."
        migas={[{ titulo: 'Recursos Humanos' }, { titulo: 'Tiempos de entrega', ruta: RUTA_TIEMPOS }, { titulo: 'Por persona' }]}
      />

      {todas.length > 0 && (
        <div className="mb-4 hidden grid-cols-2 gap-3 sm:grid lg:grid-cols-3">
          <Indicador titulo="Con algo vencido" valor={String(conVencidas)} tono={conVencidas > 0 ? 'peligro' : 'neutro'} pie="Personas a llamar primero" />
          <Indicador titulo="Con algo por vencer" valor={String(conPorVencer)} tono={conPorVencer > 0 ? 'aviso' : 'neutro'} pie="Hoy o en 3 días hábiles" />
          <Indicador titulo="Etapas a cargo" valor={String(todas.reduce((n, p) => n + p.etapas.length, 0))} pie="Sin terminar" />
        </div>
      )}

      {sinPersona.size > 0 && (
        <Tarjeta className="mb-4">
          <section aria-label="Etapas sin nadie a cargo" data-sin-persona={etapasSinPersona}>
            <TarjetaCabecera
              titulo="Etapas sin nadie a cargo"
              descripcion={`${etapasSinPersona} ${etapasSinPersona === 1 ? 'etapa' : 'etapas'} sin terminar en ${sinPersona.size} ${sinPersona.size === 1 ? 'código' : 'códigos'}. Ábrelo y usa «Asignar persona».`}
            />
            <ul className="flex flex-wrap gap-2 px-4 py-3">
              {[...sinPersona.entries()].map(([codigo, n]) => (
                <li key={codigo}>
                  <Link
                    href={enlaceDeTiempos(codigo)}
                    className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-base)] border border-borde px-3 text-sm hover:bg-superficie-2"
                    data-codigo-sin-persona={codigo}
                  >
                    <span className="font-mono font-semibold text-texto">{codigo}</span>
                    <span className="text-texto-suave">{n === 1 ? '1 etapa' : `${n} etapas`}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </Tarjeta>
      )}

      <div className="mb-3">
        <BuscadorSimple ruta={RUTA} etiqueta="Buscar persona" marcador="Nombre, área o código" />
      </div>

      {personas.length === 0 ? (
        <Tarjeta>
          {todas.length === 0 ? (
            <SinDatos
              enTabla={false}
              titulo="Nadie tiene etapas a cargo todavía"
              descripcion="Abre un código en Tiempos de entrega y usa «Asignar persona» en cada etapa."
              accion={<EnlaceBoton href={RUTA_TIEMPOS} variante="contorno" tamano="sm">Ir a Tiempos de entrega</EnlaceBoton>}
            />
          ) : (
            <SinDatos enTabla={false} titulo="Nadie con esta búsqueda" descripcion="Borra la búsqueda para ver a todos." />
          )}
        </Tarjeta>
      ) : (
        <div className="space-y-3">
          {personas.map((p) => (
            <Tarjeta key={p.trabajador_id}>
              <section aria-label={p.nombre} data-persona={p.nombre} data-semaforo={p.semaforo}>
                <TarjetaCabecera
                  titulo={p.nombre}
                  descripcion={[p.area, `${p.etapas.length} ${p.etapas.length === 1 ? 'etapa' : 'etapas'} a cargo`].filter(Boolean).join(' · ')}
                  acciones={<Insignia tono={SEMAFORO_DE_CODIGO[p.semaforo].tono}>{SEMAFORO_DE_PERSONA[p.semaforo]}</Insignia>}
                />
                <ul className="divide-y divide-borde">
                  {p.etapas.map((e) => (
                    <li key={e.etapa_id}>
                      <Link
                        href={enlaceDeTiempos(e.codigo)}
                        className="flex flex-col gap-1 px-4 py-3 hover:bg-superficie-2 sm:flex-row sm:items-center sm:justify-between"
                        data-etapa={e.etapa}
                        data-semaforo={e.semaforo}
                      >
                        <span className="min-w-0">
                          <span className="font-mono text-sm font-semibold break-all text-texto">{e.codigo}</span>
                          <span className="text-sm text-texto"> · {e.etapa}</span>
                          {e.area_etapa && <span className="text-xs text-texto-suave"> ({e.area_etapa})</span>}
                        </span>
                        <span className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                          <Insignia tono={SEMAFORO_DE_CODIGO[e.semaforo].tono}>
                            {plazoEnPalabras(e.semaforo, e.dias_habiles, { fechaPlan: e.fin_plan, hoy })}
                          </Insignia>
                          <span className="text-texto-suave">
                            {e.fin_plan && (
                              <>
                                Fecha: <span className="tabular text-texto">{fecha(e.fin_plan)}</span> ·{' '}
                              </>
                            )}
                            {e.inicio_real ? 'En proceso' : 'Por empezar'}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </Tarjeta>
          ))}
        </div>
      )}
    </>
  )
}
