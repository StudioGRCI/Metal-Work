import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_MOVIMIENTO, TIPO_MOVIMIENTO } from '@/lib/dominio/almacen'
import { definir } from '@/lib/dominio/estados'
import { fecha, fechaHora, moneda } from '@/lib/format'
import {
  catalogosAlmacen,
  lineasDeMovimiento,
  obtenerMovimiento,
} from '@/lib/datos/almacen-operativo'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AccionesMovimiento } from './acciones-movimiento'
import { LineasMovimiento } from './lineas-movimiento'

export async function generateMetadata({
  params,
}: PageProps<'/almacen/movimientos/[id]'>): Promise<Metadata> {
  const { id } = await params
  const movimiento = await obtenerMovimiento(id)
  return { title: movimiento ? `Movimiento ${movimiento.numero}` : 'Movimiento no encontrado' }
}

export default async function PaginaMovimiento({
  params,
}: PageProps<'/almacen/movimientos/[id]'>) {
  const perfil = await exigirPermiso('almacen.ver')
  const { id } = await params

  const movimiento = await obtenerMovimiento(id)
  if (!movimiento) notFound()

  const editable = movimiento.estado === 'BORRADOR' && puede(perfil, 'almacen.movimientos')

  const [lineas, catalogos] = await Promise.all([
    lineasDeMovimiento(id),
    editable ? catalogosAlmacen() : Promise.resolve(null),
  ])

  const tipo = definir(TIPO_MOVIMIENTO, movimiento.tipo)
  const estado = definir(ESTADO_MOVIMIENTO, movimiento.estado)
  const almacen = movimiento.almacen as unknown as { nombre: string }
  const destino = movimiento.destino as unknown as { nombre: string } | null
  const orden = movimiento.orden as unknown as { id: string; numero: string; descripcion: string } | null
  const proveedor = movimiento.proveedor as unknown as { razon_social: string } | null
  const responsable = movimiento.responsable as unknown as { nombres: string; apellidos: string } | null

  // En una salida el costo lo fija el promedio ponderado del almacén, no el
  // documento, así que antes de confirmar solo se puede estimar.
  const esSalida = movimiento.tipo === 'SALIDA_OT' || movimiento.tipo === 'SALIDA_MERMA'

  return (
    <>
      <EncabezadoPagina
        migas={[
          { titulo: 'Almacén', ruta: '/almacen' },
          { titulo: 'Movimientos', ruta: '/almacen/movimientos' },
          { titulo: movimiento.numero },
        ]}
        titulo={
          <span className="flex flex-wrap items-center gap-3">
            {movimiento.numero}
            <Insignia tono={tipo.tono}>{tipo.etiqueta}</Insignia>
            <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
          </span>
        }
        descripcion={`${fecha(movimiento.fecha)} · ${almacen.nombre}${
          destino ? ` → ${destino.nombre}` : ''
        }`}
        acciones={
          <AccionesMovimiento
            movimiento={{ id: movimiento.id, estado: movimiento.estado }}
            permisos={perfil.permisos}
            esAdmin={perfil.rol.codigo === 'ADMIN'}
            tieneLineas={lineas.length > 0}
          />
        }
      />

      {movimiento.estado === 'CONFIRMADO' && (
        <p className="mb-4 rounded-[var(--radius-base)] bg-exito-suave px-3 py-2 text-sm text-exito">
          Confirmado el {fechaHora(movimiento.fecha_confirmacion)}. El kardex ya está actualizado y
          el documento no admite cambios: para corregirlo se registra un movimiento contrario.
        </p>
      )}
      {movimiento.estado === 'ANULADO' && movimiento.motivo_anulacion && (
        <p className="mb-4 rounded-[var(--radius-base)] bg-peligro-suave px-3 py-2 text-sm text-peligro">
          <strong>Anulado:</strong> {movimiento.motivo_anulacion}
        </p>
      )}

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Dato titulo="Orden de trabajo">
          {orden ? (
            <Link href={`/ordenes/${orden.id}`} className="text-acento hover:underline">
              {orden.numero}
            </Link>
          ) : (
            '—'
          )}
        </Dato>
        <Dato titulo="Proveedor">{proveedor?.razon_social ?? '—'}</Dato>
        <Dato titulo="Referencia">{movimiento.documento_referencia ?? '—'}</Dato>
        <Dato titulo="Registró">
          {responsable ? `${responsable.nombres} ${responsable.apellidos}` : '—'}
        </Dato>
      </div>

      {(movimiento.motivo || movimiento.observaciones) && (
        <Tarjeta className="mb-4">
          <TarjetaCuerpo className="space-y-2 text-sm">
            {movimiento.motivo && (
              <p>
                <span className="text-texto-suave">Motivo: </span>
                {movimiento.motivo}
              </p>
            )}
            {movimiento.observaciones && (
              <p>
                <span className="text-texto-suave">Observaciones: </span>
                {movimiento.observaciones}
              </p>
            )}
          </TarjetaCuerpo>
        </Tarjeta>
      )}

      <LineasMovimiento
        movimientoId={id}
        lineas={lineas}
        editable={editable}
        materiales={catalogos?.materiales ?? []}
        esSalida={esSalida}
        confirmado={movimiento.estado === 'CONFIRMADO'}
        totalValorizado={Number(movimiento.total_valorizado ?? 0)}
      />

      {esSalida && movimiento.estado === 'BORRADOR' && (
        <p className="mt-3 text-xs text-texto-suave">
          En una salida el costo lo fija el promedio ponderado del almacén al confirmar, no lo que
          se escriba aquí. Los importes mostrados son una estimación.
        </p>
      )}

      {movimiento.estado === 'CONFIRMADO' && (
        <p className="mt-3 text-right text-sm">
          <span className="text-texto-suave">Total valorizado: </span>
          <span className="tabular font-semibold">{moneda(movimiento.total_valorizado)}</span>
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
