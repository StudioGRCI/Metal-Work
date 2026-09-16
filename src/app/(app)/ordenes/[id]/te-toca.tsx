import Link from 'next/link'

import { Punto } from '@/components/ui/etiqueta-estado'
import type { Tono } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import type { PendientesOrden } from '@/lib/datos/pendientes-ot'
import { puede, type PerfilSesion } from '@/lib/sesion'

export type Pendiente = { texto: string; vista: string; tono: Tono }

const CERRADOS = ['ENTREGADA', 'FACTURADA', 'ANULADA']

function plural(n: number, uno: string, varios: string) {
  return `${n} ${n === 1 ? uno : varios}`
}

/**
 * Qué le toca a quien mira, según su puesto, y cuántos pendientes lleva cada
 * pestaña. Es la misma lógica de permisos que decide qué botones se ven: a
 * quien no puede resolver algo no se le cuenta como suyo.
 */
export function queMeToca(
  perfil: PerfilSesion,
  p: PendientesOrden,
  orden: { estado: string; abierta_en_taller: boolean | null; cliente_id: string | null },
): { items: Pendiente[]; contadores: Record<string, number> } {
  const items: Pendiente[] = []
  const viva = orden.estado !== 'BORRADOR' && !CERRADOS.includes(orden.estado)
  const disena = puede(perfil, 'diseno.planos')
  const aprueba = puede(perfil, 'produccion.aprobar_reportes')
  const reporta = puede(perfil, 'produccion.registrar')
  const todoElTaller = aprueba || puede(perfil, 'produccion.cualquier_area')

  // Las observaciones van a un área: el jefe las ve todas, cada área la suya.
  const obs = todoElTaller
    ? p.observacionesAbiertas.length
    : p.observacionesAbiertas.filter((o) => o.area_id === perfil.area_id).length
  if (obs > 0) {
    items.push({
      texto: `${plural(obs, 'observación abierta', 'observaciones abiertas')}${todoElTaller ? '' : ' para tu área'}`,
      vista: 'resumen',
      tono: 'aviso',
    })
  }

  let cumplimiento = 0
  let materiales = 0
  if (viva && disena) {
    if (p.planos === 0) {
      items.push({ texto: 'Arma los planos y las piezas de la unidad', vista: 'cumplimiento', tono: 'acento' })
    } else if (p.planos > p.planosEntregados) {
      cumplimiento = p.planos - p.planosEntregados
      items.push({ texto: plural(cumplimiento, 'plano sin entregar', 'planos sin entregar'), vista: 'cumplimiento', tono: 'aviso' })
    }
    if (p.planos > 0 && p.materiales === 0) {
      materiales = 1
      items.push({ texto: 'La lista de materiales está vacía', vista: 'materiales', tono: 'aviso' })
    }
    if (p.areas.length === 0) {
      items.push({ texto: 'Arma las actividades de cada área', vista: 'actividades', tono: 'acento' })
    }
  }

  let actividades = 0
  if (aprueba) {
    const porAprobar = p.reportes.filter((r) => r.revision === 'PENDIENTE').length
    if (porAprobar > 0) {
      actividades = porAprobar
      items.push({ texto: plural(porAprobar, 'reporte por aprobar', 'reportes por aprobar'), vista: 'actividades', tono: 'aviso' })
    }
  } else if (reporta) {
    const observados = p.reportes.filter((r) => r.revision === 'OBSERVADO' && r.reportado_por === perfil.id).length
    if (observados > 0) {
      actividades = observados
      items.push({
        texto: `${plural(observados, 'reporte tuyo observado', 'reportes tuyos observados')}: corrígelo${observados === 1 ? '' : 's'}`,
        vista: 'actividades',
        tono: 'peligro',
      })
    }
  }

  // El peso sin repartir lo arregla quien arma la hoja: Diseño, o el jefe de
  // cada área sobre la suya.
  if (viva && (disena || puede(perfil, 'produccion.actividades'))) {
    const sinRepartir = p.areas.filter(
      (a) => a.peso_repartido < 100 && (disena || todoElTaller || a.area_id === perfil.area_id),
    )
    for (const a of sinRepartir) {
      items.push({
        texto: `${a.area}: falta repartir ${Math.round(100 - a.peso_repartido)} % del peso`,
        vista: 'actividades',
        tono: 'neutro',
      })
    }
  }

  if (orden.cliente_id === null && puede(perfil, 'ordenes.editar') && puede(perfil, 'clientes.ver')) {
    items.push({ texto: 'La orden no tiene cliente: pónselo', vista: 'resumen', tono: 'aviso' })
  }

  return { items, contadores: { resumen: obs, cumplimiento, materiales, actividades } }
}

/** La franja de arriba: lo que le toca hacer a quien mira, con el enlace a su pestaña. */
export function TeToca({ ordenId, items }: { ordenId: string; items: Pendiente[] }) {
  if (items.length === 0) return null

  return (
    <Tarjeta className="mb-4 border-acento/40">
      <TarjetaCuerpo className="py-3">
        <p className="text-[11px] font-medium tracking-wide text-texto-suave uppercase">Te toca</p>
        <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
          {items.map((i) => (
            <li key={`${i.vista}-${i.texto}`}>
              <Link
                href={`/ordenes/${ordenId}?vista=${i.vista}`}
                className="inline-flex min-h-11 items-center gap-1.5 text-sm text-texto hover:text-acento hover:underline sm:min-h-0"
              >
                <Punto tono={i.tono} />
                {i.texto}
              </Link>
            </li>
          ))}
        </ul>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
