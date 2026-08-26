/**
 * Traducción de las peticiones de datos a SQL.
 *
 * La aplicación habla con Supabase por HTTP: pide `/ordenes_trabajo?select=
 * numero,clientes!inner(razon_social)&estado=eq.EN_PROCESO&order=numero.desc`.
 * Este módulo convierte esa petición en la consulta SQL equivalente contra la
 * base local, para poder abrir el sistema completo sin salir de la máquina.
 *
 * Regla de oro: ante cualquier cosa que no sepa traducir, error. Devolver una
 * lista vacía sería peor que fallar, porque una pantalla vacía se parece
 * demasiado a una pantalla correcta sin datos.
 */

import { ErrorNoSoportado, resolverRelacion } from './esquema.mjs'

const OPERADORES = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'like',
  ilike: 'ilike',
}

const PARAMETROS_RESERVADOS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])

// ---------------------------------------------------------------- selección

/**
 * Parte la cadena `select` en un árbol. Cada nodo es una columna o una
 * incrustación con sus propios hijos.
 */
export function parsearSeleccion(texto) {
  if (!texto || texto.trim() === '') return [{ tipo: 'columna', nombre: '*' }]

  let i = 0
  const s = texto

  const espacios = () => {
    while (i < s.length && /\s/.test(s[i])) i += 1
  }

  const identificador = () => {
    const inicio = i
    while (i < s.length && /[A-Za-z0-9_*]/.test(s[i])) i += 1
    if (i === inicio) {
      throw new ErrorNoSoportado(`No se entiende la selección cerca de «${s.slice(inicio, inicio + 20)}»`)
    }
    return s.slice(inicio, i)
  }

  const lista = () => {
    const nodos = []
    for (;;) {
      espacios()
      if (i >= s.length || s[i] === ')') break

      let alias = null
      let nombre = identificador()
      espacios()

      if (s[i] === ':') {
        i += 1
        espacios()
        alias = nombre
        nombre = identificador()
        espacios()
      }

      let pista = null
      if (s[i] === '!') {
        i += 1
        pista = identificador()
        espacios()
      }

      if (s[i] === '(') {
        i += 1
        const hijos = lista()
        espacios()
        if (s[i] !== ')') throw new ErrorNoSoportado('Falta cerrar un paréntesis en la selección')
        i += 1
        const soloConteo = hijos.length === 1 && hijos[0].tipo === 'columna' && hijos[0].nombre === 'count'
        nodos.push({
          tipo: 'incrustacion',
          alias: alias ?? nombre,
          nombre,
          interno: pista === 'inner',
          pista: pista && pista !== 'inner' ? pista : null,
          conteo: soloConteo,
          hijos: soloConteo ? [] : hijos,
        })
      } else {
        nodos.push({ tipo: 'columna', alias, nombre })
      }

      espacios()
      if (s[i] === ',') {
        i += 1
        continue
      }
      break
    }
    return nodos
  }

  const nodos = lista()
  espacios()
  if (i < s.length) {
    throw new ErrorNoSoportado(`Sobra texto en la selección: «${s.slice(i, i + 25)}»`)
  }
  return nodos
}

// ------------------------------------------------------------------ filtros

/** Convierte `estado=eq.EN_PROCESO` en `estado = $1`. */
function condicionSimple(columna, expresion, ctx, tabla) {
  const punto = expresion.indexOf('.')
  if (punto === -1) throw new ErrorNoSoportado(`Filtro sin operador: «${columna}=${expresion}»`)

  let operador = expresion.slice(0, punto)
  let valor = expresion.slice(punto + 1)
  let negado = false

  if (operador === 'not') {
    negado = true
    const segundo = valor.indexOf('.')
    if (segundo === -1) throw new ErrorNoSoportado(`Filtro «not» incompleto en «${columna}»`)
    operador = valor.slice(0, segundo)
    valor = valor.slice(segundo + 1)
  }

  const col = `${tabla}.${comillas(columna)}`
  let sql

  if (operador === 'is') {
    const literales = { null: 'null', true: 'true', false: 'false', unknown: 'unknown' }
    if (!(valor in literales)) throw new ErrorNoSoportado(`Valor no soportado en «is»: ${valor}`)
    sql = `${col} is ${literales[valor]}`
  } else if (operador === 'in') {
    const cuerpo = valor.replace(/^\(/, '').replace(/\)$/, '')
    const partes = cuerpo === '' ? [] : dividirLista(cuerpo)
    if (partes.length === 0) {
      sql = 'false'
    } else {
      const marcas = partes.map((p) => ctx.parametro(desentrecomillar(p)))
      sql = `${col} in (${marcas.join(', ')})`
    }
  } else if (operador === 'like' || operador === 'ilike') {
    sql = `${col}::text ${OPERADORES[operador]} ${ctx.parametro(desentrecomillar(valor).replace(/\*/g, '%'))}`
  } else if (operador in OPERADORES) {
    sql = `${col} ${OPERADORES[operador]} ${ctx.parametro(desentrecomillar(valor))}`
  } else {
    throw new ErrorNoSoportado(`Operador no soportado: «${operador}»`)
  }

  return negado ? `not (${sql})` : sql
}

/** Divide `a,b,"c,d"` respetando las comillas. */
function dividirLista(texto) {
  const partes = []
  let actual = ''
  let dentro = false
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i]
    if (c === '"') {
      dentro = !dentro
      actual += c
    } else if (c === ',' && !dentro) {
      partes.push(actual)
      actual = ''
    } else {
      actual += c
    }
  }
  partes.push(actual)
  return partes
}

function desentrecomillar(valor) {
  if (valor.startsWith('"') && valor.endsWith('"')) return valor.slice(1, -1)
  return valor
}

/** `or=(a.ilike.%x%,b.ilike.%x%)` → `(a::text ilike $1 or b::text ilike $2)`. */
function condicionCompuesta(union, expresion, ctx, tabla) {
  const cuerpo = expresion.replace(/^\(/, '').replace(/\)$/, '')
  const partes = dividirParentesis(cuerpo)
  const condiciones = partes.map((parte) => {
    const punto = parte.indexOf('.')
    if (punto === -1) throw new ErrorNoSoportado(`Condición mal formada en «${union}»: ${parte}`)
    const columna = parte.slice(0, punto)
    if (columna === 'or' || columna === 'and') {
      return `(${condicionCompuesta(columna, parte.slice(punto + 1), ctx, tabla)})`
    }
    return condicionSimple(columna, parte.slice(punto + 1), ctx, tabla)
  })
  return condiciones.join(union === 'or' ? ' or ' : ' and ')
}

/** Divide por comas de primer nivel, respetando paréntesis y comillas. */
function dividirParentesis(texto) {
  const partes = []
  let actual = ''
  let nivel = 0
  let dentro = false
  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i]
    if (c === '"') dentro = !dentro
    if (!dentro && c === '(') nivel += 1
    if (!dentro && c === ')') nivel -= 1
    if (!dentro && c === ',' && nivel === 0) {
      partes.push(actual)
      actual = ''
    } else {
      actual += c
    }
  }
  if (actual !== '') partes.push(actual)
  return partes
}

/**
 * Reparte los parámetros de la petición entre filtros de la tabla principal y
 * filtros que caen sobre una incrustación (`ot_etapas.estado=eq.X`).
 */
function repartirFiltros(busqueda) {
  const propios = []
  const incrustados = new Map()

  for (const [clave, valor] of busqueda.entries()) {
    if (PARAMETROS_RESERVADOS.has(clave)) continue
    if (clave === 'or' || clave === 'and') {
      propios.push({ clave, valor })
      continue
    }
    const punto = clave.indexOf('.')
    if (punto === -1) {
      propios.push({ clave, valor })
    } else {
      const alias = clave.slice(0, punto)
      const columna = clave.slice(punto + 1)
      if (columna.includes('.')) {
        throw new ErrorNoSoportado(`Filtro sobre una incrustación anidada: «${clave}»`)
      }
      if (!incrustados.has(alias)) incrustados.set(alias, [])
      incrustados.get(alias).push({ clave: columna, valor })
    }
  }

  return { propios, incrustados }
}

function construirDonde(filtros, ctx, tabla) {
  return filtros.map(({ clave, valor }) =>
    clave === 'or' || clave === 'and'
      ? `(${condicionCompuesta(clave, valor, ctx, tabla)})`
      : condicionSimple(clave, valor, ctx, tabla),
  )
}

// ------------------------------------------------------------------- orden

function construirOrden(texto, tabla) {
  if (!texto) return []
  return texto.split(',').map((parte) => {
    const trozos = parte.trim().split('.')
    const columna = trozos[0]
    if (columna.includes('(')) {
      throw new ErrorNoSoportado(`Orden por una columna incrustada: «${parte}»`)
    }
    let sql = `${tabla}.${comillas(columna)}`
    if (trozos.includes('desc')) sql += ' desc'
    else if (trozos.includes('asc')) sql += ' asc'
    if (trozos.includes('nullsfirst')) sql += ' nulls first'
    else if (trozos.includes('nullslast')) sql += ' nulls last'
    return sql
  })
}

// -------------------------------------------------------------- selección SQL

function comillas(identificador) {
  if (identificador === '*') return '*'
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identificador)) {
    throw new ErrorNoSoportado(`Nombre no válido: «${identificador}»`)
  }
  return `"${identificador}"`
}

/**
 * Arma la lista de columnas de un `select`, resolviendo las incrustaciones
 * como subconsultas que devuelven jsonb: es lo mismo que hace Supabase y
 * mantiene el resultado con la forma que la aplicación espera.
 */
function construirSeleccion(esquema, relacion, alias, nodos, ctx, filtrosIncrustados, condicionesExtra) {
  const piezas = []

  for (const nodo of nodos) {
    if (nodo.tipo === 'columna') {
      if (nodo.nombre === '*') {
        piezas.push(`${alias}.*`)
      } else if (nodo.alias) {
        piezas.push(`${alias}.${comillas(nodo.nombre)} as ${comillas(nodo.alias)}`)
      } else {
        piezas.push(`${alias}.${comillas(nodo.nombre)}`)
      }
      continue
    }

    const vinculo = resolverRelacion(esquema, relacion, nodo.nombre, nodo.pista)
    const hijo = `h${ctx.siguienteAlias()}`
    const enlaces = vinculo.columnasOrigen.map(
      (col, indice) => `${hijo}.${comillas(vinculo.columnasDestino[indice])} = ${alias}.${comillas(col)}`,
    )

    const filtrosDelHijo = filtrosIncrustados.get(nodo.alias) ?? []
    const condicionesHijo = [...enlaces, ...construirDonde(filtrosDelHijo, ctx, hijo)]

    if (nodo.conteo) {
      piezas.push(
        `(select jsonb_build_array(jsonb_build_object('count', count(*))) ` +
          `from public.${comillas(nodo.nombre)} ${hijo} where ${condicionesHijo.join(' and ')}) as ${comillas(nodo.alias)}`,
      )
    } else {
      const interior = construirSeleccion(
        esquema,
        nodo.nombre,
        hijo,
        nodo.hijos,
        ctx,
        new Map(),
        [],
      )
      const subconsulta =
        `select ${interior.join(', ')} from public.${comillas(nodo.nombre)} ${hijo} ` +
        `where ${condicionesHijo.join(' and ')}`

      if (vinculo.clase === 'una') {
        piezas.push(`(select to_jsonb(x) from (${subconsulta} limit 1) x) as ${comillas(nodo.alias)}`)
      } else {
        piezas.push(
          `coalesce((select jsonb_agg(x) from (${subconsulta}) x), '[]'::jsonb) as ${comillas(nodo.alias)}`,
        )
      }
    }

    if (nodo.interno) {
      condicionesExtra.push(
        `exists (select 1 from public.${comillas(nodo.nombre)} ${hijo}i ` +
          `where ${vinculo.columnasOrigen
            .map(
              (col, indice) =>
                `${hijo}i.${comillas(vinculo.columnasDestino[indice])} = ${alias}.${comillas(col)}`,
            )
            .join(' and ')}` +
          `${filtrosDelHijo.length ? ` and ${construirDonde(filtrosDelHijo, ctx, `${hijo}i`).join(' and ')}` : ''})`,
      )
    }
  }

  return piezas
}

// ------------------------------------------------------------------ consulta

/** Contexto de parámetros: acumula los valores para pasarlos aparte del SQL. */
function crearContexto() {
  const valores = []
  let alias = 0
  return {
    valores,
    parametro(valor) {
      valores.push(valor)
      return `$${valores.length}`
    },
    siguienteAlias() {
      alias += 1
      return alias
    },
  }
}

/** Traduce una lectura (`GET`) a SQL. */
export function construirLectura(esquema, relacion, busqueda, { limite, desplazamiento }) {
  if (!esquema.relaciones.has(relacion)) {
    throw new ErrorNoSoportado(`No existe la tabla o vista «${relacion}»`)
  }

  const ctx = crearContexto()
  const nodos = parsearSeleccion(busqueda.get('select'))
  const { propios, incrustados } = repartirFiltros(busqueda)
  const condicionesExtra = []
  const columnas = construirSeleccion(esquema, relacion, 't', nodos, ctx, incrustados, condicionesExtra)

  const aliasIncrustados = new Set(
    nodos.filter((n) => n.tipo === 'incrustacion').map((n) => n.alias),
  )
  for (const alias of incrustados.keys()) {
    if (!aliasIncrustados.has(alias)) {
      throw new ErrorNoSoportado(`Filtro sobre «${alias}», que no está en la selección`)
    }
  }

  const donde = [...construirDonde(propios, ctx, 't'), ...condicionesExtra]
  const orden = construirOrden(busqueda.get('order'), 't')

  let texto = `select ${columnas.join(', ')} from public.${comillas(relacion)} t`
  if (donde.length) texto += ` where ${donde.join(' and ')}`
  if (orden.length) texto += ` order by ${orden.join(', ')}`

  const tope = limite ?? (busqueda.get('limit') ? Number(busqueda.get('limit')) : null)
  const salto = desplazamiento ?? (busqueda.get('offset') ? Number(busqueda.get('offset')) : null)
  if (tope !== null && tope !== undefined) texto += ` limit ${Number(tope)}`
  if (salto) texto += ` offset ${Number(salto)}`

  // El conteo va aparte porque no debe verse afectado por el límite.
  const ctxConteo = crearContexto()
  const condicionesConteo = []
  construirSeleccion(esquema, relacion, 't', nodos, ctxConteo, incrustados, condicionesConteo)
  const dondeConteo = [...construirDonde(propios, ctxConteo, 't'), ...condicionesConteo]
  let textoConteo = `select count(*)::int as total from public.${comillas(relacion)} t`
  if (dondeConteo.length) textoConteo += ` where ${dondeConteo.join(' and ')}`

  return {
    texto,
    valores: ctx.valores,
    conteo: { texto: textoConteo, valores: ctxConteo.valores },
  }
}

/** Traduce una escritura (`POST`, `PATCH`, `DELETE`) a SQL. */
export function construirEscritura(esquema, relacion, metodo, cuerpo, busqueda) {
  if (!esquema.relaciones.has(relacion)) {
    throw new ErrorNoSoportado(`No existe la tabla «${relacion}»`)
  }

  const ctx = crearContexto()
  const nodos = parsearSeleccion(busqueda.get('select'))
  const { propios } = repartirFiltros(busqueda)

  if (metodo === 'POST') {
    const filas = Array.isArray(cuerpo) ? cuerpo : [cuerpo]
    if (filas.length === 0) throw new ErrorNoSoportado('Inserción sin filas')
    const columnas = [...new Set(filas.flatMap((f) => Object.keys(f)))]

    const valores = filas.map(
      (fila) => `(${columnas.map((c) => ctx.parametro(fila[c] ?? null)).join(', ')})`,
    )
    const texto =
      `insert into public.${comillas(relacion)} (${columnas.map(comillas).join(', ')}) ` +
      `values ${valores.join(', ')} returning *`
    return { texto, valores: ctx.valores, seleccion: nodos, relacion }
  }

  if (metodo === 'PATCH') {
    const columnas = Object.keys(cuerpo)
    if (columnas.length === 0) throw new ErrorNoSoportado('Actualización sin columnas')
    const asignaciones = columnas.map((c) => `${comillas(c)} = ${ctx.parametro(cuerpo[c])}`)
    const donde = construirDonde(propios, ctx, 't')
    if (donde.length === 0) throw new ErrorNoSoportado('Actualización sin filtro: se negó por seguridad')
    const texto =
      `update public.${comillas(relacion)} t set ${asignaciones.join(', ')} ` +
      `where ${donde.join(' and ')} returning *`
    return { texto, valores: ctx.valores, seleccion: nodos, relacion }
  }

  if (metodo === 'DELETE') {
    const donde = construirDonde(propios, ctx, 't')
    if (donde.length === 0) throw new ErrorNoSoportado('Borrado sin filtro: se negó por seguridad')
    const texto = `delete from public.${comillas(relacion)} t where ${donde.join(' and ')} returning *`
    return { texto, valores: ctx.valores, seleccion: nodos, relacion }
  }

  throw new ErrorNoSoportado(`Método no soportado: ${metodo}`)
}

/** Llamada a función (`/rpc/nombre`). */
export function construirLlamada(nombre, argumentos) {
  const ctx = crearContexto()
  const claves = Object.keys(argumentos ?? {})
  const parametros = claves.map((c) => `${comillas(c)} => ${ctx.parametro(argumentos[c])}`)
  return {
    texto: `select * from public.${comillas(nombre)}(${parametros.join(', ')})`,
    valores: ctx.valores,
  }
}

export { comillas }
