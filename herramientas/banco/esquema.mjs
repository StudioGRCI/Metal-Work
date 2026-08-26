/**
 * Lectura del esquema de la base para poder resolver las incrustaciones.
 *
 * La API de datos de Supabase deduce las relaciones a partir de las claves
 * foráneas: cuando la aplicación pide `clientes(razon_social)` colgando de
 * `ordenes_trabajo`, lo que hace es seguir `ordenes_trabajo.cliente_id`. Aquí
 * se lee lo mismo del catálogo de Postgres para poder hacer esa deducción.
 */

/** Columnas, claves primarias y claves foráneas del esquema `public`. */
export async function leerEsquema(cliente) {
  const columnas = await cliente.query(`
    select c.relname as tabla, a.attname as columna
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
     order by c.relname, a.attnum
  `)

  const primarias = await cliente.query(`
    select c.relname as tabla, a.attname as columna
      from pg_constraint k
      join pg_class c on c.oid = k.conrelid
      join pg_namespace n on n.oid = c.relnamespace
      join unnest(k.conkey) as ck(num) on true
      join pg_attribute a on a.attrelid = c.oid and a.attnum = ck.num
     where k.contype = 'p' and n.nspname = 'public'
  `)

  const foraneas = await cliente.query(`
    select k.conname                     as nombre,
           co.relname                    as origen,
           cd.relname                    as destino,
           array_agg(ao.attname::text order by o.ord) as columnas_origen,
           array_agg(ad.attname::text order by o.ord) as columnas_destino
      from pg_constraint k
      join pg_class co on co.oid = k.conrelid
      join pg_class cd on cd.oid = k.confrelid
      join pg_namespace n on n.oid = co.relnamespace
      join unnest(k.conkey)  with ordinality as o(num, ord) on true
      join unnest(k.confkey) with ordinality as d(num, ord) on d.ord = o.ord
      join pg_attribute ao on ao.attrelid = co.oid and ao.attnum = o.num
      join pg_attribute ad on ad.attrelid = cd.oid and ad.attnum = d.num
     where k.contype = 'f' and n.nspname = 'public'
     group by k.conname, co.relname, cd.relname
  `)

  const relaciones = new Map()
  for (const fila of columnas.rows) {
    if (!relaciones.has(fila.tabla)) {
      relaciones.set(fila.tabla, { nombre: fila.tabla, columnas: [], primaria: [] })
    }
    relaciones.get(fila.tabla).columnas.push(fila.columna)
  }
  for (const fila of primarias.rows) {
    relaciones.get(fila.tabla)?.primaria.push(fila.columna)
  }

  return { relaciones, foraneas: foraneas.rows }
}

/**
 * Resuelve cómo se cuelga `destino` de `origen`.
 *
 * Devuelve `{ clase, columnasOrigen, columnasDestino }`, donde clase es
 * `una` cuando el origen apunta al destino (un cliente por orden) y `varias`
 * cuando es el destino el que apunta al origen (muchas etapas por orden).
 *
 * Si hay más de un camino posible hace falta la pista explícita
 * (`usuarios!nombre_de_la_clave`), igual que en Supabase. Elegir uno por
 * nuestra cuenta escondería aquí un error que en producción sí ocurre.
 */
export function resolverRelacion(esquema, origen, destino, pista) {
  const haciaDestino = esquema.foraneas.filter(
    (f) => f.origen === origen && f.destino === destino,
  )
  const haciaOrigen = esquema.foraneas.filter(
    (f) => f.origen === destino && f.destino === origen,
  )

  const filtrarPorPista = (candidatas) => {
    if (candidatas.length <= 1) return candidatas
    if (pista) {
      const porNombre = candidatas.filter((f) => f.nombre === pista)
      if (porNombre.length === 1) return porNombre
      const porColumna = candidatas.filter((f) => f.columnas_origen.includes(pista))
      if (porColumna.length === 1) return porColumna
    }
    return candidatas
  }

  const unas = filtrarPorPista(haciaDestino)
  const varias = filtrarPorPista(haciaOrigen)

  if (unas.length === 1 && varias.length === 0) {
    return {
      clase: 'una',
      columnasOrigen: unas[0].columnas_origen,
      columnasDestino: unas[0].columnas_destino,
    }
  }
  if (varias.length === 1 && unas.length === 0) {
    return {
      clase: 'varias',
      columnasOrigen: varias[0].columnas_destino,
      columnasDestino: varias[0].columnas_origen,
    }
  }

  const total = unas.length + varias.length
  if (total === 0) {
    throw new ErrorNoSoportado(
      `No hay clave foránea entre «${origen}» y «${destino}»: no se puede resolver la incrustación`,
    )
  }
  throw new ErrorNoSoportado(
    `La incrustación de «${destino}» en «${origen}» es ambigua (${total} caminos posibles); ` +
      'hace falta una pista, por ejemplo destino!nombre_de_la_clave',
  )
}

/** Algo que el banco de pruebas no sabe traducir. Nunca se responde en vacío. */
export class ErrorNoSoportado extends Error {
  constructor(mensaje) {
    super(mensaje)
    this.name = 'ErrorNoSoportado'
  }
}
