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

import { AccionesUnidad } from './acciones-unidad'

export const metadata = { title: 'Unidad sin orden' }

export default async function PaginaUnidadSinOrden({ params }: PageProps<'/avance/flota/[id]'>) {
  const perfil = await exigirPermiso('produccion.ver')
  const { id } = await params
  if (!esUuid(id)) notFound()

  const [unidad, areas] = await Promise.all([obtenerFlota(id), areasDelTaller()])
  if (!unidad) notFound()

  const estado = definir(ESTADO_FLOTA, unidad.estado)
  const nombre = nombreDeFlota(unidad)
  const dias = Number(unidad.dias_en_taller ?? 0)
  const sinNoticias = Number(unidad.dias_sin_avance ?? 0)

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
          [unidad.placa ? unidad.descripcion : null, unidad.cliente, 'sin orden de trabajo']
            .filter(Boolean)
            .join(' · ')
        }
        acciones={
          <AccionesUnidad
            unidad={{ id: unidad.id, estado: unidad.estado, nombre }}
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
              Entró el <span className="font-medium text-texto">{fechaHora(unidad.ingreso)}</span>
              {unidad.estado !== 'SALIO' && (
                <span className={dias >= 5 ? 'ml-2 font-medium text-aviso' : 'ml-2'}>
                  · lleva {dias} {dias === 1 ? 'día' : 'días'} en el taller
                </span>
              )}
            </p>
            {unidad.estado === 'EN_TALLER' && sinNoticias >= 3 && (
              <p className="text-xs font-medium text-aviso">
                {sinNoticias} días sin reporte
              </p>
            )}
          </div>

          <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div>
              <p className="text-xs text-texto-suave">A qué entró</p>
              <p className="text-texto">{unidad.trabajo}</p>
            </div>
            <div>
              <p className="text-xs text-texto-suave">Área actual</p>
              <p className="text-texto">
                {unidad.area_actual ?? 'Todavía nadie la reportó'}
                {unidad.avance_porcentaje !== null && (
                  <span className="ml-2 text-texto-suave">va en ~{numero(unidad.avance_porcentaje, 0)} %</span>
                )}
              </p>
            </div>
            {unidad.trajo && (
              <div>
                <p className="text-xs text-texto-suave">Quién la trajo</p>
                <p className="text-texto">{unidad.trajo}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-texto-suave">La registró</p>
              <p className="text-texto">{unidad.registrado_por_nombre ?? '—'}</p>
            </div>
            {unidad.lista_en && (
              <div>
                <p className="text-xs text-texto-suave">Lista desde</p>
                <p className="text-texto">{fechaHora(unidad.lista_en)}</p>
              </div>
            )}
            {unidad.salio_en && (
              <div>
                <p className="text-xs text-texto-suave">Salió</p>
                <p className="text-texto">
                  {fechaHora(unidad.salio_en)}
                  {unidad.retiro && <span className="text-texto-suave"> · la retiró {unidad.retiro}</span>}
                </p>
              </div>
            )}
          </div>

          {unidad.impedimento && (
            <p className="rounded-[var(--radius-base)] bg-peligro-suave px-2.5 py-1.5 text-xs text-peligro">
              Trabada: {unidad.impedimento}
            </p>
          )}
        </TarjetaCuerpo>
      </Tarjeta>

      <AvanceDeFlota flotaId={id} />
    </>
  )
}
