import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ALMACENES, almacenEnFrase, esAlmacen, exigeFormato } from '@/lib/dominio/almacen'
import { cantidad, fechaHora } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

import { BotonImprimir } from '../../../../ordenes/[id]/expediente/imprimir'
import { esGuid } from '@/lib/guid'

export const metadata = { title: 'Formato de salida de almacén' }

/**
 * La hoja que se imprime, se firma y se escanea para cerrar una salida de
 * materia prima o de EPP: qué salió, para qué unidad, quién lo entregó y quién
 * lo recibió, con el espacio de las dos firmas. Lo que se imprime es lo que
 * la persona ve, con sus mismos permisos.
 */
export default async function PaginaFormato({ params }: PageProps<'/almacen/movimientos/[id]/formato'>) {
  await exigirPermiso('almacen.ver')
  const { id } = await params
  if (!esGuid(id)) notFound()
  const db = await createClient()
  const { data: m, error } = await db.from('v_kardex_almacen')
    .select('id,fecha,material,material_codigo,unidad_medida,salida,codigo_unidad,documento,recibido_por_nombre,registrado_por_nombre,almacen,requerimiento_numero,con_formato,orden_numero')
    .eq('id', id).eq('movimiento', 'SALIDA').maybeSingle()
  if (error) throw new Error('No se pudo cargar la salida.')
  if (!m) notFound()

  const almacen = esAlmacen(m.almacen) ? m.almacen : null
  const def = almacen ? ALMACENES[almacen] : null
  const titulo = def?.formato ?? 'Formato de salida de almacén'
  const corto = id.slice(0, 8).toUpperCase()

  return (
    <div className="mx-auto max-w-3xl print:max-w-none">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href="/almacen/kardex" className="text-sm text-acento hover:underline">← Volver al kardex</Link>
        <BotonImprimir />
      </div>
      {!exigeFormato(almacen) && (
        <p className="mb-4 rounded-[var(--radius-base)] border border-borde px-3 py-2 text-sm text-texto-suave print:hidden">
          Esta salida no necesita formato para cerrarse; se imprime solo como constancia.
        </p>
      )}
      {m.con_formato && (
        <p className="mb-4 rounded-[var(--radius-base)] border border-exito px-3 py-2 text-sm text-exito print:hidden">
          Esta salida ya está cerrada con su formato firmado.
        </p>
      )}

      <article className="rounded-[var(--radius-base)] border border-borde bg-superficie p-6 text-texto print:border-0 print:p-0">
        <header className="mb-6 flex items-start justify-between gap-4 border-b border-borde pb-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-texto-suave">Metal Work Perú S.A.C. · Almacén</p>
            <h1 className="mt-1 text-xl font-semibold">{titulo}</h1>
            {almacen && <p className="text-sm text-texto-suave">Almacén de {almacenEnFrase(almacen)}</p>}
          </div>
          <div className="text-right text-sm">
            <p className="font-mono">N.º {corto}</p>
            <p className="text-texto-suave">{fechaHora(m.fecha)}</p>
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
          <Dato etiqueta="Material" valor={m.material ?? '—'} ancho />
          <Dato etiqueta="Código" valor={m.material_codigo ?? '—'} mono />
          <Dato etiqueta="Cantidad entregada" valor={`${cantidad(m.salida)} ${m.unidad_medida ?? ''}`} />
          <Dato etiqueta="Unidad o destino" valor={m.codigo_unidad ?? '—'} />
          <Dato etiqueta="Requerimiento" valor={m.requerimiento_numero ?? (m.orden_numero ? `OT ${m.orden_numero}` : '—')} />
          <Dato etiqueta="Motivo o vale" valor={m.documento ?? '—'} ancho />
          <Dato etiqueta="Entregó (Almacén)" valor={m.registrado_por_nombre ?? '—'} />
          <Dato etiqueta="Recibe" valor={m.recibido_por_nombre ?? '—'} />
        </dl>

        <div className="mt-8 grid gap-6 text-sm sm:grid-cols-2">
          <Firma titulo="Almacenero" nombre={m.registrado_por_nombre} />
          <Firma titulo="Quien recibe" nombre={m.recibido_por_nombre} />
        </div>

        <p className="mt-8 border-t border-borde pt-3 text-xs text-texto-suave">
          Con las dos firmas, Almacén escanea o fotografía esta hoja y la carga en «Salidas por cerrar» del kardex. Hasta entonces la salida queda abierta.
        </p>
      </article>
    </div>
  )
}

function Dato({ etiqueta, valor, ancho, mono }: { etiqueta: string; valor: string; ancho?: boolean; mono?: boolean }) {
  return (
    <div className={ancho ? 'col-span-2' : undefined}>
      <dt className="text-[11px] uppercase tracking-wide text-texto-suave">{etiqueta}</dt>
      <dd className={`mt-0.5 font-medium ${mono ? 'font-mono' : ''}`}>{valor}</dd>
    </div>
  )
}

function Firma({ titulo, nombre }: { titulo: string; nombre: string | null }) {
  return (
    <div>
      <div className="h-20 border-b border-texto" aria-hidden />
      <p className="mt-2 font-medium">{titulo}</p>
      <p className="text-texto-suave">{nombre ?? 'Nombre: ______________________'}</p>
      <p className="text-texto-suave">DNI: ______________________ · Fecha: ____ / ____ / ______</p>
    </div>
  )
}
