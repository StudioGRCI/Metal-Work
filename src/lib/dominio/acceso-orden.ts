import type { PerfilSesion } from '../sesion'

/** Un mismo criterio para los enlaces de la OT y la entrada por URL.
 * La lectura de filas y archivos continúa sometida a RLS y al área asignada.
 */
export function seccionesDeOrden(perfil: Pick<PerfilSesion, 'permisos' | 'rol'>): string[] {
  const tiene = (...permisos: string[]) =>
    perfil.rol.codigo === 'ADMIN' || permisos.some(p => perfil.permisos.includes(p))
  if (!tiene('ordenes.ver')) return []
  const tecnico = tiene('diseno.planos', 'diseno.revisar', 'produccion.registrar', 'produccion.cualquier_area')
    || ['ALMACENERO', 'COMPRADOR', 'CALIDAD'].includes(perfil.rol.codigo)
  return [
    'resumen',
    ...(tiene('ordenes.editar', 'produccion.ver', 'diseno.planos') ? ['ficha'] : []),
    ...(tiene('ordenes.listar', 'produccion.ver') ? ['etapas'] : []),
    ...(tecnico ? ['cumplimiento', 'planos'] : []),
    ...(tiene('diseno.planos', 'cotizaciones.costear', 'produccion.ver') || tecnico ? ['materiales'] : []),
    ...(tiene('produccion.ver', 'diseno.planos') ? ['actividades'] : []),
    ...(tiene('produccion.ver') ? ['avance'] : []),
    'bitacora',
  ]
}
