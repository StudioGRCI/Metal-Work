import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { AvanceDeOrden } from '@/components/avance/avance-de-orden'
import { cabeceraDeAvance, etapasDeLaOrden } from '@/lib/datos/avances'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { nombreDeUnidad } from '@/lib/dominio/unidades'
import { fecha as formatearFecha } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { RegistrarAvance } from '../registrar-avance'

export const metadata = { title: 'Avance de la unidad' }

export default async function PaginaAvanceDeUnidad({ params }: PageProps<'/avance/[id]'>) {
  const perfil = await exigirPermiso('produccion.ver')
  const { id } = await params

  const orden = await cabeceraDeAvance(id)
  if (!orden) notFound()

  const etapas = await etapasDeLaOrden(id)

  const estado = definir(ESTADO_OT, orden.estado as string)
  const registra = puede(perfil, 'produccion.registrar')
  const restantes =
    orden.dias_habiles_restantes === null || orden.dias_habiles_restantes === undefined
      ? null
      : Number(orden.dias_habiles_restantes)

  return (
    <>
      {/* min-h-11 solo en el teléfono: el dedo necesita 44 px de alto para no
          fallar el volver; con el ratón basta el texto y el monitor no se mueve. */}
      <Link
        href="/avance"
        className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm text-texto-suave hover:text-texto sm:min-h-0"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Volver al taller
      </Link>

      {/* El título es el nombre de la unidad, no su placa: hay carrocerías que
          se construyen sobre chasis todavía sin matricular. El número de la
          orden queda a la vista en la descripción, que es como se pide por
          teléfono. */}
      <EncabezadoPagina
        titulo={nombreDeUnidad(orden)}
        descripcion={`${orden.numero} · ${orden.cliente} · ${orden.descripcion}`}
        acciones={registra && <RegistrarAvance ordenId={id} etapas={etapas} />}
      />

      <Tarjeta className="mb-4">
        <TarjetaCuerpo className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>

          <div className="min-w-48 flex-1">
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-texto-suave">Avance de la unidad</span>
              <span className="tabular font-medium text-texto">
                {Math.round(Number(orden.avance_porcentaje))}%
              </span>
            </div>
            <Progreso valor={Number(orden.avance_porcentaje)} alto="sm" />
          </div>

          <div className="text-xs">
            <p className="text-texto-suave">Entrega comprometida</p>
            <p className="font-medium text-texto">
              {formatearFecha(orden.fecha_entrega_comprometida)}
              {restantes !== null && (
                <span className={restantes < 0 ? 'ml-2 text-peligro' : 'ml-2 text-texto-suave'}>
                  {restantes < 0
                    ? `${Math.abs(restantes)} días de atraso`
                    : `quedan ${restantes} días de taller`}
                </span>
              )}
            </p>
          </div>

          <Link
            href={`/ordenes/${id}`}
            className="inline-flex min-h-11 items-center text-xs font-medium text-acento hover:underline sm:min-h-0"
          >
            Ver la orden completa
          </Link>
        </TarjetaCuerpo>
      </Tarjeta>

      <AvanceDeOrden ordenId={id} puedeRegistrar={registra} />
    </>
  )
}
