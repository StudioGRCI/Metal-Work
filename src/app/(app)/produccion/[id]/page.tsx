import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cantidad, fecha, fechaHora } from '@/lib/format'
import { catalogosParte, lineasDeParte, obtenerParte } from '@/lib/datos/produccion'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AccionesParte } from './acciones-parte'
import { LineasParte } from './lineas-parte'

const ESTADOS = {
  BORRADOR: { etiqueta: 'Borrador', tono: 'neutro' as const },
  CERRADO: { etiqueta: 'Cerrado', tono: 'info' as const },
  APROBADO: { etiqueta: 'Aprobado', tono: 'exito' as const },
}

export async function generateMetadata({ params }: PageProps<'/produccion/[id]'>): Promise<Metadata> {
  const { id } = await params
  const parte = await obtenerParte(id)
  return { title: parte ? `Parte ${parte.numero}` : 'Parte no encontrado' }
}

export default async function PaginaParte({ params }: PageProps<'/produccion/[id]'>) {
  const perfil = await exigirPermiso('produccion.ver')
  const { id } = await params

  const parte = await obtenerParte(id)
  if (!parte) notFound()

  const sede = parte.sede as unknown as { id: string; nombre: string }
  const editable = parte.estado === 'BORRADOR' && puede(perfil, 'produccion.registrar')

  const [lineas, catalogos] = await Promise.all([
    lineasDeParte(id),
    editable ? catalogosParte(sede.id) : Promise.resolve(null),
  ])

  const estado = ESTADOS[parte.estado as keyof typeof ESTADOS] ?? ESTADOS.BORRADOR
  const responsable = parte.responsable as unknown as { nombres: string; apellidos: string } | null
  const aprobador = parte.aprobador as unknown as { nombres: string; apellidos: string } | null

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Producción', ruta: '/produccion' }, { titulo: parte.numero }]}
        titulo={
          <span className="flex flex-wrap items-center gap-3">
            {parte.numero}
            <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
          </span>
        }
        descripcion={`${fecha(parte.fecha)} · ${sede.nombre}${
          responsable ? ` · ${responsable.nombres} ${responsable.apellidos}` : ''
        }`}
        acciones={
          <AccionesParte
            parte={{ id: parte.id, estado: parte.estado }}
            permisos={perfil.permisos}
            esAdmin={perfil.rol.codigo === 'ADMIN'}
            tieneLineas={lineas.length > 0}
          />
        }
      />

      {parte.estado === 'APROBADO' && (
        <p className="mb-4 rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-sm text-exito">
          Parte aprobado{aprobador ? ` por ${aprobador.nombres} ${aprobador.apellidos}` : ''}
          {parte.fecha_aprobacion ? ` el ${fechaHora(parte.fecha_aprobacion)}` : ''}. Las horas ya
          están cargadas a las órdenes y no se pueden modificar.
        </p>
      )}

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <Indicador titulo="Horas normales" valor={cantidad(parte.total_horas)} />
        <Indicador titulo="Horas extra" valor={cantidad(parte.total_horas_extra)} />
        <Indicador
          titulo="Total horas-hombre"
          valor={cantidad(Number(parte.total_horas ?? 0) + Number(parte.total_horas_extra ?? 0))}
        />
      </div>

      {parte.observaciones && (
        <Tarjeta className="mb-4">
          <TarjetaCuerpo>
            <p className="text-[11px] font-medium tracking-wide text-texto-suave uppercase">
              Observaciones del día
            </p>
            <p className="mt-1 text-sm whitespace-pre-wrap text-texto">{parte.observaciones}</p>
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      <LineasParte
        parteId={id}
        lineas={lineas}
        editable={editable}
        operarios={catalogos?.operarios ?? []}
        ordenes={catalogos?.ordenes ?? []}
      />
    </>
  )
}

function Indicador({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <Tarjeta>
      <TarjetaCuerpo>
        <p className="text-[11px] font-medium tracking-wide text-texto-suave uppercase">{titulo}</p>
        <p className="tabular mt-1 text-lg font-semibold text-texto">{valor}</p>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
