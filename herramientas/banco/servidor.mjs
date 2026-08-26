/**
 * Banco de pruebas: levanta en la máquina local los mismos servicios que la
 * aplicación usa de Supabase —ingreso de sesión, datos y archivos— apoyados en
 * la base Postgres local.
 *
 * Sirve para abrir el sistema completo y comprobarlo de punta a punta sin
 * depender de la nube: útil cuando la red del entorno no llega a Supabase, y
 * útil siempre para probar sin tocar los datos del cliente.
 *
 *   node herramientas/banco/servidor.mjs
 *
 * Variables: BANCO_PUERTO (5599), BANCO_BASE (mw_demo), PGHOST, PGPORT, PGUSER.
 */

import { createServer } from 'node:http'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import pg from 'pg'

// PostgREST entrega los date como texto «YYYY-MM-DD». El driver de node, en
// cambio, los convierte a Date de medianoche UTC, y la aplicación —que formatea
// en hora de Lima— los corría un día hacia atrás. El banco imita a PostgREST:
// la fecha sin hora viaja como texto y no se toca. (1082 date, 1114 timestamp
// sin zona, 1182/1115 sus arreglos.)
pg.types.setTypeParser(1082, (v) => v)
pg.types.setTypeParser(1182, (v) => v)

import { ErrorNoSoportado, leerEsquema } from './esquema.mjs'
import { construirEscritura, construirLectura, construirLlamada } from './rest.mjs'

const PUERTO = Number(process.env.BANCO_PUERTO ?? 5599)
const SECRETO = process.env.BANCO_SECRETO ?? 'banco-de-pruebas-local-metal-work'
const ARCHIVOS = process.env.BANCO_ARCHIVOS ?? '/tmp/banco-archivos'

const grupo = new pg.Pool({
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.BANCO_BASE ?? 'mw_demo',
  max: 10,
})

// ------------------------------------------------------------- credenciales

const base64url = (dato) => Buffer.from(dato).toString('base64url')

function firmar(carga) {
  const cabecera = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const cuerpo = base64url(JSON.stringify(carga))
  const firma = createHmac('sha256', SECRETO).update(`${cabecera}.${cuerpo}`).digest('base64url')
  return `${cabecera}.${cuerpo}.${firma}`
}

function verificar(credencial) {
  const partes = credencial.split('.')
  if (partes.length !== 3) return null
  const esperada = createHmac('sha256', SECRETO).update(`${partes[0]}.${partes[1]}`).digest('base64url')
  const a = Buffer.from(partes[2])
  const b = Buffer.from(esperada)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const carga = JSON.parse(Buffer.from(partes[1], 'base64url').toString())
    if (carga.exp && carga.exp * 1000 < Date.now()) return null
    return carga
  } catch {
    return null
  }
}

const CLAVE_ANONIMA = firmar({ iss: 'banco', role: 'anon', exp: 4102444800 })
const CLAVE_SERVICIO = firmar({ iss: 'banco', role: 'service_role', exp: 4102444800 })

const refrescos = new Map()

// ------------------------------------------------------------------ ayudas

function responder(res, estado, cuerpo, cabeceras = {}) {
  const texto = cuerpo === null || cuerpo === undefined ? '' : JSON.stringify(cuerpo)
  res.writeHead(estado, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'content-range, content-length',
    ...cabeceras,
  })
  res.end(texto)
}

function errorSql(res, fallo) {
  // Los errores de Postgres se devuelven con la misma forma que usa Supabase,
  // porque la aplicación distingue por `code` (por ejemplo 23505 duplicado).
  const estado = fallo.code === '42501' || fallo.code === 'insufficient_privilege' ? 403 : 400
  responder(res, estado, {
    code: fallo.code ?? 'PGRST000',
    message: fallo.message,
    details: fallo.detail ?? null,
    hint: fallo.hint ?? null,
  })
}

async function leerCuerpo(req) {
  const trozos = []
  for await (const trozo of req) trozos.push(trozo)
  return Buffer.concat(trozos)
}

/** Ejecuta dentro de una transacción con el rol y los claims de la sesión. */
async function conSesion(sesion, tarea) {
  const cliente = await grupo.connect()
  try {
    await cliente.query('begin')
    const rol = sesion.rol === 'authenticated' ? 'authenticated' : sesion.rol === 'service_role' ? 'service_role' : 'anon'
    await cliente.query(`set local role ${rol}`)
    if (sesion.sub) {
      const claims = JSON.stringify({ sub: sesion.sub, role: rol, email: sesion.email ?? '' })
      await cliente.query('select set_config($1, $2, true)', ['request.jwt.claims', claims])
      await cliente.query('select set_config($1, $2, true)', ['request.jwt.claim.sub', sesion.sub])
      await cliente.query('select set_config($1, $2, true)', ['request.jwt.claim.role', rol])
      await cliente.query('select set_config($1, $2, true)', ['request.jwt.claim.email', sesion.email ?? ''])
    }
    const resultado = await tarea(cliente)
    await cliente.query('commit')
    return resultado
  } catch (fallo) {
    await cliente.query('rollback').catch(() => {})
    throw fallo
  } finally {
    cliente.release()
  }
}

function sesionDe(req) {
  const cabecera = req.headers.authorization ?? ''
  const credencial = cabecera.startsWith('Bearer ') ? cabecera.slice(7) : null
  const carga = credencial ? verificar(credencial) : null
  if (!carga) return { rol: 'anon' }
  return { rol: carga.role ?? 'anon', sub: carga.sub ?? null, email: carga.email ?? null }
}

// ------------------------------------------------------------------ sesión

function usuarioDeFila(fila) {
  return {
    id: fila.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: fila.email,
    email_confirmed_at: fila.created_at,
    phone: '',
    confirmed_at: fila.created_at,
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: fila.raw_user_meta_data ?? {},
    identities: [],
    created_at: fila.created_at,
    updated_at: fila.created_at,
  }
}

function sesionParaUsuario(usuario) {
  const ahora = Math.floor(Date.now() / 1000)
  const acceso = firmar({
    aud: 'authenticated',
    exp: ahora + 3600,
    iat: ahora,
    iss: 'banco',
    sub: usuario.id,
    email: usuario.email,
    role: 'authenticated',
    session_id: randomUUID(),
  })
  const refresco = randomUUID().replace(/-/g, '')
  refrescos.set(refresco, usuario.id)
  return {
    access_token: acceso,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: ahora + 3600,
    refresh_token: refresco,
    user: usuario,
  }
}

async function manejarSesion(req, res, url) {
  const ruta = url.pathname.replace('/auth/v1', '')

  if (ruta === '/token' && req.method === 'POST') {
    const tipo = url.searchParams.get('grant_type')
    const cuerpo = JSON.parse((await leerCuerpo(req)).toString() || '{}')

    if (tipo === 'password') {
      const { rows } = await grupo.query(
        `select id, email, raw_user_meta_data, created_at
           from auth.users
          where lower(email) = lower($1)
            and encrypted_password = crypt($2, encrypted_password)`,
        [cuerpo.email ?? '', cuerpo.password ?? ''],
      )
      if (rows.length === 0) {
        return responder(res, 400, {
          error: 'invalid_grant',
          error_description: 'Invalid login credentials',
          message: 'Invalid login credentials',
          code: 'invalid_credentials',
        })
      }
      return responder(res, 200, sesionParaUsuario(usuarioDeFila(rows[0])))
    }

    if (tipo === 'refresh_token') {
      const cuenta = refrescos.get(cuerpo.refresh_token)
      if (!cuenta) {
        return responder(res, 400, { error: 'invalid_grant', message: 'Invalid Refresh Token' })
      }
      refrescos.delete(cuerpo.refresh_token)
      const { rows } = await grupo.query(
        'select id, email, raw_user_meta_data, created_at from auth.users where id = $1',
        [cuenta],
      )
      return responder(res, 200, sesionParaUsuario(usuarioDeFila(rows[0])))
    }

    return responder(res, 400, { error: 'unsupported_grant_type', message: `Tipo no soportado: ${tipo}` })
  }

  if (ruta === '/user' && req.method === 'GET') {
    const sesion = sesionDe(req)
    if (!sesion.sub) return responder(res, 401, { message: 'invalid claim: missing sub claim' })
    const { rows } = await grupo.query(
      'select id, email, raw_user_meta_data, created_at from auth.users where id = $1',
      [sesion.sub],
    )
    if (rows.length === 0) return responder(res, 401, { message: 'User from sub claim in JWT does not exist' })
    return responder(res, 200, usuarioDeFila(rows[0]))
  }

  if (ruta === '/logout' && req.method === 'POST') {
    return responder(res, 204, null)
  }

  if (ruta === '/settings') {
    return responder(res, 200, { external: {}, disable_signup: true, mailer_autoconfirm: true })
  }

  if (ruta === '/.well-known/jwks.json') {
    // Sin claves publicadas, la biblioteca verifica contra el servidor.
    return responder(res, 200, { keys: [] })
  }

  return responder(res, 404, { message: `Ruta de sesión no soportada: ${ruta}` })
}

// ------------------------------------------------------------------- datos

let esquemaCache = null
const funcionesCache = new Map()

async function esquema() {
  if (!esquemaCache) esquemaCache = await leerEsquema(grupo)
  return esquemaCache
}

async function formaDeFuncion(nombre) {
  if (funcionesCache.has(nombre)) return funcionesCache.get(nombre)
  const { rows } = await grupo.query(
    `select p.proretset, t.typtype, t.typname
       from pg_proc p join pg_type t on t.oid = p.prorettype
      where p.pronamespace = 'public'::regnamespace and p.proname = $1
      limit 1`,
    [nombre],
  )
  const forma = rows[0] ?? null
  funcionesCache.set(nombre, forma)
  return forma
}

/** Vuelve a leer las filas escritas para poder devolverlas con incrustaciones. */
async function releerEscritura(cliente, esq, relacion, filas, busqueda) {
  const seleccion = busqueda.get('select')
  if (!seleccion || seleccion === '*' || filas.length === 0) return filas
  const primaria = esq.relaciones.get(relacion)?.primaria ?? []
  if (primaria.length !== 1) return filas

  const claves = filas.map((f) => f[primaria[0]])
  const busquedaRelectura = new URLSearchParams()
  busquedaRelectura.set('select', seleccion)
  busquedaRelectura.set(primaria[0], `in.(${claves.map((c) => `"${c}"`).join(',')})`)
  const consulta = construirLectura(esq, relacion, busquedaRelectura, {})
  const { rows } = await cliente.query(consulta.texto, consulta.valores)
  return rows
}

async function manejarDatos(req, res, url) {
  const esq = await esquema()
  const sesion = sesionDe(req)
  const partes = url.pathname.replace('/rest/v1/', '').split('/')
  const prefiere = req.headers.prefer ?? ''

  // Llamada a función
  if (partes[0] === 'rpc') {
    const nombre = partes[1]
    const argumentos = req.method === 'POST' ? JSON.parse((await leerCuerpo(req)).toString() || '{}') : {}
    const consulta = construirLlamada(nombre, argumentos)
    const forma = await formaDeFuncion(nombre)
    if (!forma) return responder(res, 404, { message: `No existe la función «${nombre}»` })

    return conSesion(sesion, async (cliente) => {
      const { rows, fields } = await cliente.query(consulta.texto, consulta.valores)
      if (forma.proretset) return responder(res, 200, rows)
      if (forma.typtype === 'c') return responder(res, 200, rows[0] ?? null)
      const columna = fields[0]?.name
      return responder(res, 200, rows[0] ? rows[0][columna] : null)
    })
  }

  const relacion = partes[0]

  if (req.method === 'GET' || req.method === 'HEAD') {
    let limite = null
    let desplazamiento = null
    const rango = req.headers.range
    if (rango) {
      const [desde, hasta] = rango.replace('bytes=', '').split('-').map(Number)
      desplazamiento = desde
      if (!Number.isNaN(hasta)) limite = hasta - desde + 1
    }

    const consulta = construirLectura(esq, relacion, url.searchParams, { limite, desplazamiento })
    const quiereConteo = prefiere.includes('count=exact')
    const soloCabecera = req.method === 'HEAD' || prefiere.includes('head=true')
    const objeto = (req.headers.accept ?? '').includes('vnd.pgrst.object')

    return conSesion(sesion, async (cliente) => {
      const filas = soloCabecera ? [] : (await cliente.query(consulta.texto, consulta.valores)).rows
      let total = null
      if (quiereConteo) {
        const conteo = await cliente.query(consulta.conteo.texto, consulta.conteo.valores)
        total = conteo.rows[0].total
      }

      const cabeceras = {}
      if (total !== null) {
        const desde = desplazamiento ?? 0
        const hasta = filas.length ? desde + filas.length - 1 : desde
        cabeceras['content-range'] = soloCabecera ? `*/${total}` : `${desde}-${hasta}/${total}`
      }

      if (objeto) {
        if (filas.length !== 1) {
          return responder(res, 406, {
            code: 'PGRST116',
            message: `JSON object requested, multiple (or no) rows returned`,
            details: `Results contain ${filas.length} rows`,
            hint: null,
          }, cabeceras)
        }
        return responder(res, 200, filas[0], cabeceras)
      }

      return responder(res, 200, soloCabecera ? null : filas, cabeceras)
    })
  }

  if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') {
    const crudo = (await leerCuerpo(req)).toString()
    const cuerpo = crudo ? JSON.parse(crudo) : {}
    const escritura = construirEscritura(esq, relacion, req.method, cuerpo, url.searchParams)
    const devuelve = prefiere.includes('return=representation')
    const objeto = (req.headers.accept ?? '').includes('vnd.pgrst.object')

    return conSesion(sesion, async (cliente) => {
      const { rows } = await cliente.query(escritura.texto, escritura.valores)
      if (!devuelve) return responder(res, req.method === 'DELETE' ? 204 : 201, null)

      const filas =
        req.method === 'DELETE'
          ? rows
          : await releerEscritura(cliente, esq, relacion, rows, url.searchParams)

      if (objeto) {
        if (filas.length !== 1) {
          return responder(res, 406, {
            code: 'PGRST116',
            message: 'JSON object requested, multiple (or no) rows returned',
            details: `Results contain ${filas.length} rows`,
            hint: null,
          })
        }
        return responder(res, req.method === 'POST' ? 201 : 200, filas[0])
      }
      return responder(res, req.method === 'POST' ? 201 : 200, filas)
    })
  }

  return responder(res, 405, { message: `Método no soportado: ${req.method}` })
}

// ---------------------------------------------------------------- archivos

async function manejarArchivos(req, res, url) {
  const ruta = url.pathname.replace('/storage/v1', '')
  const sesion = sesionDe(req)

  // Subida: POST /object/<cubeta>/<camino>
  if (req.method === 'POST' && ruta.startsWith('/object/') && !ruta.startsWith('/object/sign/')) {
    const camino = ruta.replace('/object/', '')
    const contenido = await leerCuerpo(req)
    const destino = join(ARCHIVOS, camino)
    await mkdir(dirname(destino), { recursive: true })
    await writeFile(destino, contenido)

    const [cubeta, ...resto] = camino.split('/')
    await grupo.query(
      `insert into storage.objects (bucket_id, name, owner)
       values ($1, $2, $3)
       on conflict do nothing`,
      [cubeta, resto.join('/'), sesion.sub],
    ).catch(() => {})

    return responder(res, 200, { Key: camino, Id: randomUUID() })
  }

  // Enlace firmado: POST /object/sign/<cubeta>/<camino>
  if (req.method === 'POST' && ruta.startsWith('/object/sign/')) {
    const camino = ruta.replace('/object/sign/', '')
    const ficha = firmar({ camino, exp: Math.floor(Date.now() / 1000) + 3600 })
    return responder(res, 200, { signedURL: `/storage/v1/object/sign/${camino}?token=${ficha}` })
  }

  // Descarga por enlace firmado
  if (req.method === 'GET' && ruta.startsWith('/object/')) {
    const camino = ruta.replace(/^\/object\/(sign\/|authenticated\/|public\/)?/, '')
    try {
      const contenido = await readFile(join(ARCHIVOS, camino))
      res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'access-control-allow-origin': '*',
      })
      return res.end(contenido)
    } catch {
      return responder(res, 404, { message: 'No existe el archivo' })
    }
  }

  // Borrado: DELETE /object/<cubeta> con {prefixes: [...]}
  if (req.method === 'DELETE' && ruta.startsWith('/object/')) {
    const cubeta = ruta.replace('/object/', '')
    const cuerpo = JSON.parse((await leerCuerpo(req)).toString() || '{}')
    for (const prefijo of cuerpo.prefixes ?? []) {
      await grupo
        .query('delete from storage.objects where bucket_id = $1 and name = $2', [cubeta, prefijo])
        .catch(() => {})
    }
    return responder(res, 200, [])
  }

  return responder(res, 404, { message: `Ruta de archivos no soportada: ${ruta}` })
}

// ------------------------------------------------------------------ arranque

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PUERTO}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PATCH, DELETE, HEAD, OPTIONS',
      'access-control-allow-headers':
        'authorization, apikey, content-type, prefer, range, x-client-info, accept, accept-profile, content-profile, x-supabase-api-version',
      'access-control-max-age': '3600',
    })
    return res.end()
  }

  try {
    if (url.pathname.startsWith('/auth/v1')) return await manejarSesion(req, res, url)
    if (url.pathname.startsWith('/rest/v1')) return await manejarDatos(req, res, url)
    if (url.pathname.startsWith('/storage/v1')) return await manejarArchivos(req, res, url)
    if (url.pathname === '/salud') return responder(res, 200, { estado: 'bien' })
    return responder(res, 404, { message: `Ruta desconocida: ${url.pathname}` })
  } catch (fallo) {
    if (fallo instanceof ErrorNoSoportado) {
      console.error(`✗ ${req.method} ${req.url}\n  ${fallo.message}`)
      return responder(res, 501, { code: 'BANCO001', message: fallo.message, details: null, hint: null })
    }
    if (fallo.code) {
      console.error(`✗ ${req.method} ${req.url}\n  [${fallo.code}] ${fallo.message}`)
      return errorSql(res, fallo)
    }
    console.error(`✗ ${req.method} ${req.url}\n  ${fallo.stack}`)
    return responder(res, 500, { message: fallo.message })
  }
})

servidor.listen(PUERTO, '127.0.0.1', () => {
  console.log(`banco de pruebas en http://127.0.0.1:${PUERTO}`)
  console.log(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:${PUERTO}`)
  console.log(`NEXT_PUBLIC_SUPABASE_ANON_KEY=${CLAVE_ANONIMA}`)
  console.log(`SUPABASE_SERVICE_ROLE_KEY=${CLAVE_SERVICIO}`)
})
