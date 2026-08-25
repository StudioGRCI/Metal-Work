import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_REQUERIMIENTO } from '@/lib/dominio/almacen'
import { PRIORIDAD, definir } from '@/lib/dominio/estados'
import { fecha } from '@/lib/format'
import {
  catalogosAlmacen,
  lineasDeRequerimiento,
  obtenerRequerimiento,
} from '@/lib/datos/almacen-operativo'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AccionesRequerimiento } from './acciones-requerimiento'
import { LineasRequerimiento } from './lineas-requerimiento'

export async function generateMetadata({
  params,
}: PageProps<'/almacen/requerimientos/[id]'>): Promise<Metadata> {
  const { id } = await params
  const requerimiento = await obtenerRequerimiento(id)
  return {
    title: requerimiento ? `Requerimiento ${requerimiento.numero}` : 'Requerimiento no encontrado',
  }
}

export default async function PaginaRequerimiento({
  params,
}: PageProps<'/almacen/requerimientos/[id]'>) {
  const perfil = await exigirPermiso('requerimientos.ver')
  const { id } = await params

  const requerimiento = await obtenerRequerimiento(id)
  if (!requerimiento) notFound()

  const editable =
    requerimiento.estado === 'SOLICITADO' && puede(perfil, 'requerimientos.crear')

  const [lineas, catalogos] = await Promise.all([
    lineasDeRequerimiento(id),
    editable ? catalogosAlmacen() : Promise.resolve(null),
  ])

  const estado = definir(ESTADO_REQUERIMIENTO, requerimiento.estado)
  const prioridad = definir(PRIORIDAD, requerimiento.prioridad)
  const orden = requerimiento.orden as unknown as { id: string; numero: string; descripcion: string } | null
  const solicitante = requerimiento.solicitante as unknown as { nombres: string; apellidos: string } | null
  const aprobador = requerimiento.aprobador as unknown as { nombres: string; apellidos: string } | null
  const almacen = requerimiento.almacen as unknown as { nombre: string } | null

  return (
    <>
      <EncabezadoPagina
        migas={[
          { titulo: 'Almacén', ruta: '/almacen' },
          { titulo: 'Requerimientos', ruta: '/almacen/requerimientos' },
          { titulo: requerimiento.numero },
        ]}
        titulo={
          <span className="flex flex-wrap items-center gap-3">
            {requerimiento.numero}
            <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
            <Insignia tono={prioridad.tono}>{prioridad.etiqueta}</Insignia>
          </span>
        }
        descripcion={
          orden ? (
            <>
              Para la orden{' '}
              <Link href={`/ordenes/${orden.id}`} className="text-acento hover:underline">
                {orden.numero}
              </Link>{' '}
              · {orden.descripcion}
            </>
          ) : (
            'Sin orden asociada'
          )
        }
        acciones={
          <AccionesRequerimiento
            requerimiento={{ id: requerimiento.id, estado: requerimiento.estado }}
            permisos={perfil.permisos}
            esAdmin={perfil.rol.codigo === 'ADMIN'}
            tieneLineas={lineas.length > 0}
          />
        }
      />

      {requerimiento.estado === 'RECHAZADO' && requerimiento.motivo_rechazo && (
        <p className="mb-4 rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-sm text-peligro">
          <strong>Rechazado:</strong> {requerimiento.motivo_rechazo}
        </p>
      )}
      {requerimiento.estado === 'APROBADO' && (
        <p className="mb-4 rounded-[var(--radius-base)] bg-info-suave px-3 py-2 text-sm text-info">
          Aprobado{aprobador ? ` por ${aprobador.nombres} ${aprobador.apellidos}` : ''}. El stock
          disponible quedó reservado; entrégalo con un vale de consumo.
        </p>
      )}

      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        <Dato titulo="Solicitado por">
          {solicitante ? `${solicitante.nombres} ${solicitante.apellidos}` : '—'}
        </Dato>
        <Dato titulo="Fecha">{fecha(requerimiento.fecha)}</Dato>
        <Dato titulo="Requerido para">{fecha(requerimiento.fecha_requerida)}</Dato>
        <Dato titulo="Almacén">{almacen?.nombre ?? '—'}</Dato>
      </div>

      {requerimiento.observaciones && (
        <Tarjeta className="mb-4">
          <TarjetaCuerpo>
            <p className="text-sm whitespace-pre-wrap text-texto">{requerimiento.observaciones}</p>
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      <LineasRequerimiento
        requerimientoId={id}
        lineas={lineas}
        editable={editable}
        materiales={catalogos?.materiales ?? []}
      />

      {requerimiento.estado === 'APROBADO' && orden && (
        <p className="mt-3 text-sm">
          <Link
            href={`/almacen/movimientos/nuevo?tipo=SALIDA_OT&orden=${orden.id}`}
            className="text-acento hover:underline"
          >
            Entregar el material con un vale de consumo →
          </Link>
        </p>
      )}
    </>
  )
}

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <Tarjeta>
      <TarjetaCuerpo>
        <p className="text-[11px] font-medium tracking-wide text-texto-suave uppercase">{titulo}</p>
        <p className="mt-1 truncate text-sm font-medium text-texto">{children}</p>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
