import Link from 'next/link'
import { Plus } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { cantidad, fecha } from '@/lib/format'
import { listarPartes } from '@/lib/datos/produccion'
import { exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Producción' }

const ESTADOS = {
  BORRADOR: { etiqueta: 'Borrador', tono: 'neutro' as const },
  CERRADO: { etiqueta: 'Cerrado', tono: 'info' as const },
  APROBADO: { etiqueta: 'Aprobado', tono: 'exito' as const },
}

export default async function PaginaProduccion({ searchParams }: PageProps<'/produccion'>) {
  const perfil = await exigirPermiso('produccion.ver')
  const params = await searchParams
  const estado = typeof params.estado === 'string' ? params.estado : undefined

  const partes = await listarPartes({ estado })

  return (
    <>
      <EncabezadoPagina
        titulo="Partes diarios de producción"
        descripcion="Las horas del taller por día. Al aprobar un parte, sus horas se cargan a las etapas de cada orden y al costo de mano de obra."
        acciones={
          puede(perfil, 'produccion.registrar') && (
            <Link
              href="/produccion/nuevo"
              className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-base)] bg-acento px-4 text-sm font-medium text-acento-texto hover:bg-acento-fuerte"
            >
              <Plus aria-hidden className="size-4" />
              Nuevo parte
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { valor: '', titulo: 'Todos' },
          { valor: 'BORRADOR', titulo: 'En borrador' },
          { valor: 'CERRADO', titulo: 'Cerrados' },
          { valor: 'APROBADO', titulo: 'Aprobados' },
        ].map((o) => (
          <Link
            key={o.valor || 'todos'}
            href={o.valor ? `/produccion?estado=${o.valor}` : '/produccion'}
            className={
              (estado ?? '') === o.valor
                ? 'rounded-[var(--radius-base)] bg-acento-suave px-3 py-1.5 text-xs font-medium text-acento'
                : 'rounded-[var(--radius-base)] border border-borde px-3 py-1.5 text-xs text-texto-suave hover:bg-superficie-2'
            }
          >
            {o.titulo}
          </Link>
        ))}
      </div>

      <Tarjeta className="overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Parte</TH>
              <TH>Fecha</TH>
              <TH>Taller</TH>
              <TH>Responsable</TH>
              <TH>Estado</TH>
              <TH className="text-right">Registros</TH>
              <TH className="text-right">Horas</TH>
              <TH className="text-right">Extra</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {partes.length === 0 ? (
              <SinDatos
                colSpan={8}
                titulo={estado ? 'Sin partes en ese estado' : 'Aún no hay partes diarios'}
                descripcion="Registra el parte del día para cargar las horas trabajadas a las órdenes."
              />
            ) : (
              partes.map((p) => {
                const est = ESTADOS[p.estado as keyof typeof ESTADOS] ?? ESTADOS.BORRADOR
                const sede = p.sede as unknown as { nombre: string }
                const responsable = p.responsable as unknown as { nombres: string; apellidos: string } | null
                const registros = (p.detalle as unknown as { count: number }[])?.[0]?.count ?? 0

                return (
                  <TR key={p.id}>
                    <TD className="whitespace-nowrap">
                      <Link
                        href={`/produccion/${p.id}`}
                        className="font-medium text-acento hover:underline"
                      >
                        {p.numero}
                      </Link>
                    </TD>
                    <TD className="whitespace-nowrap">{fecha(p.fecha)}</TD>
                    <TD className="text-texto-suave">{sede.nombre}</TD>
                    <TD className="text-texto-suave">
                      {responsable ? `${responsable.nombres} ${responsable.apellidos}` : '—'}
                    </TD>
                    <TD>
                      <Insignia tono={est.tono}>{est.etiqueta}</Insignia>
                    </TD>
                    <TD className="tabular text-right">{registros}</TD>
                    <TD className="tabular text-right font-medium">{cantidad(p.total_horas)}</TD>
                    <TD className="tabular text-right text-texto-suave">
                      {cantidad(p.total_horas_extra)}
                    </TD>
                  </TR>
                )
              })
            )}
          </tbody>
        </Tabla>
      </Tarjeta>
    </>
  )
}
