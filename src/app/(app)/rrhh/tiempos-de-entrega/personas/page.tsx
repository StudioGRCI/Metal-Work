import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Indicador } from '@/components/ui/indicador'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { etapasPorPersona } from '@/lib/datos/tiempos-entrega'
import { coincide, palabrasDeBusqueda } from '@/lib/dominio/busqueda'
import { RUTA_TIEMPOS, SEMAFORO_DE_CODIGO, enlaceDeTiempos, plazoEnPalabras } from '@/lib/dominio/tiempos-entrega'
import { fecha, hoyLima } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

export const metadata = { title: 'Tiempos de entrega por persona' }

const RUTA = `${RUTA_TIEMPOS}/personas`

/**
 * Lo que lleva cada persona del personal (DKS, 2026-11-25, entrega 2 del plan
 * de tiempos de entrega): sus etapas sin terminar con su semáforo, lo vencido
 * primero. Recursos Humanos las asigna en el detalle de cada código.
 */
export default async function PaginaTiemposPorPersona({ searchParams }: PageProps<'/rrhh/tiempos-de-entrega/personas'>) {
  await exigirPermiso('rrhh.tiempos_entrega')
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q.trim() : ''
  const todas = await etapasPorPersona()
  const hoy = hoyLima()
  const palabras = palabrasDeBusqueda(q)
  const personas = q ? todas.filter((p) => coincide(palabras, [p.nombre, p.area, ...p.etapas.map((e) => e.codigo)])) : todas
  const conVencidas = todas.filter((p) => p.etapas.some((e) => e.semaforo === 'ROJO')).length
  const conPorVencer = todas.filter((p) => p.etapas.some((e) => e.semaforo === 'AMBAR')).length

  return (
    <>
      <EncabezadoPagina
        titulo="Por persona"
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

      <div className="mb-3">
        <BuscadorSimple ruta={RUTA} etiqueta="Buscar persona" marcador="Nombre, área o código" />
      </div>

      {personas.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">{todas.length === 0 ? 'Nadie tiene etapas a cargo todavía' : 'Nadie con esta búsqueda'}</p>
            <p className="text-sm text-texto-suave">
              {todas.length === 0 ? (
                <>
                  Abre un código en <Link href={RUTA_TIEMPOS} className="text-acento underline">Tiempos de entrega</Link> y usa «Asignar persona» en cada etapa.
                </>
              ) : (
                'Borra la búsqueda para ver a todos.'
              )}
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <div className="space-y-3">
          {personas.map((p) => (
            <Tarjeta key={p.trabajador_id}>
              <section aria-label={p.nombre} data-persona={p.nombre} data-semaforo={p.semaforo}>
                <TarjetaCabecera
                  titulo={p.nombre}
                  descripcion={[p.area, `${p.etapas.length} ${p.etapas.length === 1 ? 'etapa' : 'etapas'} a cargo`].filter(Boolean).join(' · ')}
                  acciones={<Insignia tono={SEMAFORO_DE_CODIGO[p.semaforo].tono}>{SEMAFORO_DE_CODIGO[p.semaforo].etiqueta}</Insignia>}
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
