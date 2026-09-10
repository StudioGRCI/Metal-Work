import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AvanceDeFlota } from '@/components/avance/avance-de-flota'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { areasDelTaller } from '@/lib/datos/actividades'
import { obtenerFlota } from '@/lib/datos/flota'
import { ESTADO_FLOTA, definir } from '@/lib/dominio/estados'
import { nombreDeFlota } from '@/lib/dominio/unidades'
import { fechaHora, numero } from '@/lib/format'
import { areasDeSuMano, exigirPermiso, puede } from '@/lib/sesion'
import { esUuid } from '@/lib/utils'

import { AccionesTrabajo } from './acciones-trabajo'

export const metadata = { title: 'Trabajo sin orden' }

export default async function PaginaTrabajoSinOrden({ params }: PageProps<'/avance/trabajos/[id]'>) {
  const perfil = await exigirPermiso('produccion.ver')
  const { id } = await params
  if (!esUuid(id)) notFound()

  const [trabajo, areas] = await Promise.all([obtenerFlota(id), areasDelTaller()])
  if (!trabajo) notFound()

  const estado = definir(ESTADO_FLOTA, trabajo.estado)
  const nombre = nombreDeFlota(trabajo)
  const dias = Number(trabajo.dias_en_taller ?? 0)
  const sinNoticias = Number(trabajo.dias_sin_avance ?? 0)

  return (
    <>
      <Link
        href="/avance"
        className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm text-texto-suave hover:text-texto sm:min-h-0"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Volver al taller
      </Link>

      <EncabezadoPagina
        titulo={nombre}
        descripcion={
          [trabajo.placa ? trabajo.descripcion : null, trabajo.cliente, 'sin orden de trabajo']
            .filter(Boolean)
            .join(' · ')
        }
        acciones={
          <AccionesTrabajo
            trabajo={{ id: trabajo.id, estado: trabajo.estado, nombre, esUnidad: Boolean(trabajo.placa) }}
            areas={areasDeSuMano(perfil, areas)}
            areaPropia={perfil.area_id}
            puedeReportar={puede(perfil, 'produccion.registrar')}
            puedeArmar={puede(perfil, 'produccion.actividades')}
          />
        }
      />

      <Tarjeta className="mb-4">
        <TarjetaCuerpo className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
            <p className="text-xs text-texto-suave">
              Desde el <span className="font-medium text-texto">{fechaHora(trabajo.ingreso)}</span>
              {trabajo.estado !== 'SALIO' && (
                <span className={dias >= 5 ? 'ml-2 font-medium text-aviso' : 'ml-2'}>
                  · lleva {dias} {dias === 1 ? 'día' : 'días'}
                </span>
              )}
            </p>
            {trabajo.estado === 'EN_TALLER' && sinNoticias >= 3 && (
              <p className="text-xs font-medium text-aviso">{sinNoticias} días sin reporte</p>
            )}
          </div>

          <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-texto-suave">Qué se va a hacer</p>
              <p className="text-texto">{trabajo.trabajo}</p>
            </div>
            <div>
              <p className="text-xs text-texto-suave">Área actual</p>
              <p className="text-texto">
                {trabajo.area_actual ?? 'Todavía nadie lo reportó'}
                {trabajo.avance_porcentaje !== null && (
                  <span className="ml-2 text-texto-suave">va en ~{numero(trabajo.avance_porcentaje, 0)} %</span>
                )}
              </p>
            </div>
            {trabajo.trajo && (
              <div>
                <p className="text-xs text-texto-suave">Quién la trajo</p>
                <p className="text-texto">{trabajo.trajo}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-texto-suave">Lo registró</p>
              <p className="text-texto">{trabajo.registrado_por_nombre ?? '—'}</p>
            </div>
            {trabajo.lista_en && (
              <div>
                <p className="text-xs text-texto-suave">Terminado el</p>
                <p className="text-texto">{fechaHora(trabajo.lista_en)}</p>
              </div>
            )}
            {trabajo.salio_en && (
              <div>
                <p className="text-xs text-texto-suave">Cerrado el</p>
                <p className="text-texto">
                  {fechaHora(trabajo.salio_en)}
                  {trabajo.retiro && <span className="text-texto-suave"> · se la llevó {trabajo.retiro}</span>}
                </p>
              </div>
            )}
          </div>

          {trabajo.impedimento && (
            <p className="rounded-[var(--radius-base)] bg-peligro-suave px-2.5 py-1.5 text-xs text-peligro">
              Trabado: {trabajo.impedimento}
            </p>
          )}
        </TarjetaCuerpo>
      </Tarjeta>

      <AvanceDeFlota flotaId={id} />
    </>
  )
}
