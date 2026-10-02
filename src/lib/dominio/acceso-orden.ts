import type { PerfilSesion } from '../sesion'

/** Un mismo criterio para los enlaces de la OT y la entrada por URL.
 * La lectura de filas y archivos continúa sometida a RLS y al área asignada.
 */
export function seccionesDeOrden(perfil: Pick<PerfilSesion, 'permisos' | 'rol'>): string[] {
  const tiene = (...permisos: string[]) =>
    perfil.rol.codigo === 'ADMIN' || permisos.some(p => perfil.permisos.includes(p))
  if (!tiene('ordenes.ver')) return []
  // Almacén entra a la OT solo a atender sus materiales: revisar stock,
  // despachar y recibir. Lo demás de la orden no es su trabajo (2026-10-01).
  if (perfil.rol.codigo === 'ALMACENERO') return ['materiales']
  const tecnico = tiene('diseno.planos', 'diseno.revisar', 'diseno.subir_pdf', 'produccion.registrar', 'produccion.cualquier_area', 'supervision.general')
    || ['ALMACENERO', 'COMPRADOR', 'CALIDAD'].includes(perfil.rol.codigo)
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
