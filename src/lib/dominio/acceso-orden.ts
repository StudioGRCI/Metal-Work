import type { PerfilSesion } from '../sesion'

/**
 * Los puestos que desde el 2026-10-15 trabajan por código interno y ya no abren
 * la OT, que queda como documento de Diseño (decisión de Gerencia, migración
 * 20261016110000): Supervisión sube su reporte diario y ve los planos y las
 * etapas de su área; Supervisión general y Almacén siguen cada código en
 * «Seguimiento por código»; Requerimientos lleva la ficha del vehículo y la
 * revisión de Tesorería en Vehículos. Desde la migración 20261016120000 la
 * base tampoco les da ningún permiso de la OT; aquí se decide adónde van si
 * llegan a una por un aviso o un enlace viejo.
 */
export const PUESTOS_POR_CODIGO = ['SUPERVISOR', 'SUPERVISOR_GENERAL', 'ALMACENERO', 'REQUERIMIENTOS'] as const

export function trabajaPorCodigo(perfil: Pick<PerfilSesion, 'rol'>): boolean {
  return (PUESTOS_POR_CODIGO as readonly string[]).includes(perfil.rol.codigo)
}

/** Adónde va quien trabaja por código si llega a una OT: lo que la reemplaza para su puesto. */
export function reemplazoDeLaOrden(perfil: Pick<PerfilSesion, 'rol'>): string {
  switch (perfil.rol.codigo) {
    case 'SUPERVISOR':
      return '/planos'
    case 'ALMACENERO':
      return '/seguimiento?vista=materiales'
    case 'REQUERIMIENTOS':
      return '/vehiculos'
    default:
      return '/seguimiento'
  }
}

/** Un mismo criterio para los enlaces de la OT y la entrada por URL.
 * La lectura de filas y archivos continúa sometida a RLS y al área asignada.
 */
export function seccionesDeOrden(perfil: Pick<PerfilSesion, 'permisos' | 'rol'>): string[] {
  const tiene = (...permisos: string[]) =>
    perfil.rol.codigo === 'ADMIN' || permisos.some(p => perfil.permisos.includes(p))
  if (!tiene('ordenes.ver') || trabajaPorCodigo(perfil)) return []
  const tecnico = tiene('diseno.planos', 'diseno.revisar', 'diseno.subir_pdf', 'produccion.registrar', 'produccion.cualquier_area', 'supervision.general')
    || ['COMPRADOR', 'CALIDAD'].includes(perfil.rol.codigo)
  return [
    'resumen',
    // El expediente lo ve quien ve la orden: cada bloque se lee con su propio
    // RLS, y el costo solo se pide con `costos.ver`.
    'expediente',
    ...(tiene('ordenes.editar', 'produccion.ver', 'diseno.planos') ? ['ficha'] : []),
    ...(tiene('ordenes.listar', 'produccion.ver') ? ['etapas'] : []),
    ...(tecnico ? ['planos'] : []),
    ...(tiene('diseno.planos', 'cotizaciones.costear', 'produccion.ver', 'requerimientos.ver') || tecnico ? ['materiales'] : []),
    ...(tiene('costos.ver', 'costos.registrar_gasto') ? ['costos'] : []),
    // Administración revisa los reportes del taller (`produccion.aprobar_reportes`)
    // y los revisa aquí: sin la pestaña, el aviso de «reportes por aprobar» no
    // tenía adónde llevarla.
    ...(tiene('produccion.ver', 'diseno.planos', 'produccion.aprobar_reportes') ? ['actividades'] : []),
    'entrega',
    ...(tiene('produccion.ver') ? ['avance'] : []),
    'bitacora',
  ]
}
