import type { Tono } from '@/components/ui/etiqueta-estado'
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
 *
 * Los contadores numeran las pestañas de la OT. La franja «Siguiente paso para
 * ti» que pintaba los `items` arriba del resumen se retiró el 2026-10-01: la
 * empresa la encontró invasiva, y lo pendiente ya lo dicen esos números.
 */
export function queMeToca(
  perfil: PerfilSesion,
  p: PendientesOrden,
  orden: { estado: string; abierta_en_taller: boolean | null; cliente_id: string | null; plan_etapas_manual: boolean },
  etapasDefinidas: number,
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

  let planos = 0
  let materiales = 0
  const tramites = [
    { permiso: 'diseno.planos', cantidad: p.abastecimiento.aprobar, singular: 'material propuesto por revisar', plural: 'materiales propuestos por revisar' },
    { permiso: 'almacen.recibir', cantidad: p.abastecimiento.stock, singular: 'solicitud por comprobar en stock', plural: 'solicitudes por comprobar en stock' },
    { permiso: 'compras.crear', cantidad: p.abastecimiento.comprar, singular: 'insumo por incluir en una compra', plural: 'insumos por incluir en una compra' },
    { permiso: 'almacen.recibir', cantidad: p.abastecimiento.recibir, singular: 'insumo comprado por recibir', plural: 'insumos comprados por recibir' },
    { permiso: 'almacen.despachar', cantidad: p.abastecimiento.despachar, singular: 'material por entregar con foto', plural: 'materiales por entregar con foto' },
  ]
  for (const tramite of tramites) {
    if (viva && tramite.cantidad > 0 && puede(perfil, tramite.permiso)) {
      materiales += tramite.cantidad
      items.push({ texto: plural(tramite.cantidad, tramite.singular, tramite.plural), vista: 'materiales', tono: 'acento' })
    }
  }
  if (viva && disena) {
    if (orden.plan_etapas_manual && etapasDefinidas === 0) {
      items.push({ texto: 'Define las etapas de esta OT para poder crear planos', vista: 'etapas', tono: 'acento' })
    } else if (p.planos === 0) {
      items.push({ texto: 'Crea los planos vinculados a sus etapas', vista: 'planos', tono: 'acento' })
    } else if (p.planos > p.planosEntregados) {
      planos = p.planos - p.planosEntregados
      items.push({ texto: plural(planos, 'plano sin entregar', 'planos sin entregar'), vista: 'planos', tono: 'aviso' })
    }
    if (p.planos > 0 && p.materiales === 0) {
      materiales = 1
      items.push({ texto: 'La lista de materiales está vacía', vista: 'materiales', tono: 'aviso' })
    }
    if (!orden.plan_etapas_manual && p.areas.length === 0) {
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

  // En las OT nuevas Supervisión arma y reporta las tareas de su área.
  if (viva && (puede(perfil, 'produccion.actividades') || (!orden.plan_etapas_manual && disena))) {
    const sinRepartir = p.areas.filter(
      (a) => a.peso_repartido < 100 && ((!orden.plan_etapas_manual && disena) || todoElTaller || a.area_id === perfil.area_id),
    )
    for (const a of sinRepartir) {
      items.push({
        texto: `${a.area}: falta repartir ${Math.round(100 - a.peso_repartido)} % del peso`,
        vista: 'actividades',
        tono: 'neutro',
      })
    }
  }

  if (viva && orden.plan_etapas_manual && reporta && etapasDefinidas > 0 && p.areas.length === 0) {
    items.push({ texto: 'Crea la primera tarea de taller de tu área', vista: 'actividades', tono: 'acento' })
  }

  if (orden.cliente_id === null && puede(perfil, 'ordenes.editar') && puede(perfil, 'clientes.ver')) {
    items.push({ texto: 'La orden no tiene cliente: pónselo', vista: 'resumen', tono: 'aviso' })
  }

  return { items, contadores: { resumen: obs, planos, materiales, actividades } }
}
