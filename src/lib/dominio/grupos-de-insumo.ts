/**
 * Los grupos con que se busca un insumo al pedirlo en el requerimiento
 * (observaciones del área de Requerimientos, 2026-11-20: «falta que agreguen
 * accesorios como niplería, sistema eléctrico y otros más»). Los accesorios ya
 * están en el catálogo de Almacén, repartidos en sus categorías; lo que faltaba
 * era dar con ellos. Al elegir el grupo salen todos sus insumos.
 *
 * Cada categoría del catálogo es un grupo (SISTEMA ELECTRICO, SISTEMA
 * NEUMATICO…), y la niplería es uno más que cruza categorías: sus conectores,
 * codos, tees y bushings están en el sistema hidráulico y en el neumático, y
 * los niples soldables, en accesorios estructurales.
 */

type MaterialConGrupo = { codigo: string | null; descripcion: string; categoria: string }

/** El grupo de la niplería, aparte de las categorías. */
export const GRUPO_NIPLERIA = 'NIPLERIA'
const NOMBRE_NIPLERIA = 'NIPLERÍA'
/** La categoría de lo que Almacén todavía no clasifica: va al final de la lista. */
const POR_CLASIFICAR = 'POR CLASIFICAR'

/**
 * Si el material es de niplería. En el código del catálogo, el segundo tramo
 * dice la familia: «SH-NI-…» y «SN-NI-…» son la niplería del sistema hidráulico
 * y del neumático. Los niples soldables de accesorios estructurales
 * («AE-ET-AC-SD-…») no lo llevan y se reconocen por el nombre.
 */
export function esNipleria(m: MaterialConGrupo): boolean {
  const tramo = (m.codigo ?? '').trim().toUpperCase().split('-')[1]
  return tramo === 'NI' || /^\s*NIPLES?\b/i.test(m.descripcion)
}

export type GrupoDeInsumo = { clave: string; nombre: string; cuantos: number }

/** Los grupos que tienen algún insumo, por nombre, con la niplería entre ellos y «Por clasificar» al final. */
export function gruposDeInsumo(materiales: MaterialConGrupo[]): GrupoDeInsumo[] {
  const cuenta = new Map<string, number>()
  let niples = 0
  for (const m of materiales) {
    if (m.categoria) cuenta.set(m.categoria, (cuenta.get(m.categoria) ?? 0) + 1)
    if (esNipleria(m)) niples += 1
  }
  const grupos: GrupoDeInsumo[] = [...cuenta.entries()].map(([nombre, cuantos]) => ({ clave: `CAT:${nombre}`, nombre, cuantos }))
  if (niples > 0) grupos.push({ clave: GRUPO_NIPLERIA, nombre: NOMBRE_NIPLERIA, cuantos: niples })
  return grupos.sort((a, b) =>
    a.nombre === POR_CLASIFICAR ? 1 : b.nombre === POR_CLASIFICAR ? -1 : a.nombre.localeCompare(b.nombre, 'es'),
  )
}

/** Si el material es del grupo elegido; sin grupo, todos lo son. */
export function delGrupo(m: MaterialConGrupo, grupo: string): boolean {
  if (!grupo) return true
  if (grupo === GRUPO_NIPLERIA) return esNipleria(m)
  return grupo === `CAT:${m.categoria}`
}

/**
 * La segunda línea del material en el buscador: código, unidad y categoría, y
 * «NIPLERÍA» si lo es, para que escribir «niplería» también lo encuentre.
 */
export function detalleDelMaterial(m: MaterialConGrupo & { unidad: string; unidad_pendiente: boolean }): string {
  return [m.codigo, m.unidad_pendiente ? 'unidad por confirmar' : m.unidad, m.categoria, esNipleria(m) ? NOMBRE_NIPLERIA : null]
    .filter(Boolean)
    .join(' · ')
}
