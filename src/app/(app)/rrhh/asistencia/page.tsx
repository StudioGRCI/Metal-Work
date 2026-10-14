import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { listarTrabajadores, marcasDelDia } from '@/lib/datos/rrhh'
import { diaVecino, fechaValida } from '@/lib/dominio/rrhh'
import { fechaLarga, hoyLima } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { Marcador } from './marcador'

export const metadata = { title: 'Asistencia del personal' }

export default async function PaginaAsistencia({ searchParams }: PageProps<'/rrhh/asistencia'>) {
  const perfil = await exigirPermiso(['asistencia.marcar', 'asistencia.ver'])
  const marca = puede(perfil, 'asistencia.marcar')
  const consulta = puede(perfil, 'asistencia.ver')
  // La miga lleva a las planillas solo a quien las abre: Gerencia y
  // Administración consultan esto con `asistencia.ver` y ahí las rebotaban.
  const planillas = puede(perfil, 'rrhh.ver_planillas')
  const params = await searchParams
  const hoy = hoyLima()
  // El portero marca hoy; quien consulta puede moverse de día.
  const fecha = consulta && fechaValida(params.fecha) ? params.fecha : hoy
  const esHoy = fecha === hoy

  const [personal, marcas] = await Promise.all([listarTrabajadores('activos'), marcasDelDia(fecha)])
  const vigentes = marcas.filter((m) => m.anulado_en === null)
  const ingresos = vigentes.filter((m) => m.tipo === 'INGRESO')
  const tarde = ingresos.filter((m) => m.es_tardanza)

  return (
    <>
      <EncabezadoPagina
        titulo={esHoy ? 'Asistencia de hoy' : 'Asistencia'}
        descripcion={
          marca
            ? 'Toca «Ingreso» cuando la persona entra y «Salida» cuando se va. La hora la pone el sistema; si entra después de su hora, queda la tardanza.'
            : 'Lo que marcó la portería cada día, con las tardanzas. El descuento sale del mes, en «Tardanzas».'
        }
        migas={[{ titulo: 'Recursos Humanos', ruta: planillas ? '/rrhh' : undefined }, { titulo: 'Asistencia' }]}
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {consulta && (
            <Link
              href={`/rrhh/asistencia?fecha=${diaVecino(fecha, -1)}`}
              aria-label="Día anterior"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto"
            >
              <ChevronLeft aria-hidden className="size-4" />
            </Link>
          )}
          <p className="px-1 text-sm font-medium text-texto">{fechaLarga(fecha)}</p>
          {consulta && !esHoy && (
            <Link
              href={`/rrhh/asistencia?fecha=${diaVecino(fecha, 1)}`}
              aria-label="Día siguiente"
              className="inline-flex size-9 items-center justify-center rounded-lg border border-borde text-texto-suave hover:text-texto"
            >
              <ChevronRight aria-hidden className="size-4" />
            </Link>
          )}
        </div>
        <p className="text-xs text-texto-suave" aria-live="polite">
          <span className="tabular">{ingresos.length}</span> de <span className="tabular">{personal.length}</span> con ingreso
          {tarde.length > 0 && (
            <>
              {' '}
              · <span className="tabular">{tarde.length}</span> {tarde.length === 1 ? 'tardanza' : 'tardanzas'}
            </>
          )}
        </p>
      </div>

      <Marcador
        personal={personal.map((p) => ({
          id: p.id,
          nombres: p.nombres,
          apellidos: p.apellidos,
          dni: p.dni,
          cargo: p.cargo,
          hora_entrada: p.hora_entrada,
          hora_salida: p.hora_salida,
        }))}
        marcas={marcas}
        marca={marca}
        anula={consulta || (marca && esHoy)}
        esHoy={esHoy}
      />
    </>
  )
}
