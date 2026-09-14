#!/usr/bin/env node
/**
 * Respaldo de la base viva de Metal Work a una carpeta fuera del repositorio.
 *
 * El proyecto está en el plan Free de Supabase: no hay backups ni PITR. Si se
 * borra algo, lo único que hay es lo que este script haya bajado antes.
 *
 * Qué baja:
 *   datos/<esquema>.<tabla>.jsonl   todas las tablas de public, auth.users,
 *                                   auth.identities y storage.objects
 *   archivos/<bucket>/<ruta>        los archivos de Storage (PDF, fotos, Excel)
 *   manifiesto.json                 filas por tabla, archivos, última migración
 *
 * El esquema no se respalda aquí: vive en supabase/migrations/.
 *
 * Toda la lectura va en UNA transacción REPEATABLE READ READ ONLY: las tablas
 * salen de la misma foto (una OT no aparece sin sus etapas) y el script no
 * puede escribir aunque quisiera.
 *
 * Lee DATABASE_URL y, para los archivos, NEXT_PUBLIC_SUPABASE_URL y
 * SUPABASE_SERVICE_ROLE_KEY de .env.local. La carpeta resultante lleva hashes
 * de contraseña y datos personales: no se sube a ningún sitio.
 *
 *   node scripts/respaldar.mjs                    → ~/Respaldos/metal-work/<fecha>
 *   node scripts/respaldar.mjs --destino D:\copia
 *   node scripts/respaldar.mjs --sin-archivos     solo la base
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, createWriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argumentos = process.argv.slice(2)
const valorDe = (bandera) => {
  const i = argumentos.indexOf(bandera)
  return i >= 0 ? argumentos[i + 1] : undefined
}

// --- Entorno -----------------------------------------------------------------
// Sin dotenv: se lee .env.local a mano. Lo que ya venga en el entorno manda.
function cargarEntorno() {
  const archivo = join(raiz, '.env.local')
  if (!existsSync(archivo)) return
  for (const linea of readFileSync(archivo, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (!m || process.env[m[1]] !== undefined) continue
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
}
cargarEntorno()

const urlBase = process.env.DATABASE_URL
if (!urlBase) {
  console.error('Falta DATABASE_URL (en .env.local o en el entorno). Sin ella no hay respaldo.')
  process.exit(1)
}

const sello = new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '')
const destino = resolve(valorDe('--destino') ?? join(homedir(), 'Respaldos', 'metal-work', sello))
const conArchivos = !argumentos.includes('--sin-archivos')

// --- Tipos -------------------------------------------------------------------
// Fechas y numéricos salen como el texto de Postgres. Convertir un `date` a
// Date de JavaScript lo corre de día según la zona horaria, y un numeric a
// Number pierde decimales: en un respaldo, ni lo uno ni lo otro.
for (const oid of [1082, 1083, 1114, 1184, 1266, 1700, 20]) {
  pg.types.setTypeParser(oid, (v) => v)
}

// Supabase exige TLS. El sslmode de la cadena se quita para que pg no intente
// verificar la cadena de certificados completa, que en Windows falla.
const cadena = urlBase.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '')
const esLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(cadena)
const cliente = new pg.Client({
  connectionString: cadena,
  ssl: esLocal ? false : { rejectUnauthorized: false },
})

const LOTE = 5000

async function volcarTabla(esquema, tabla, carpeta) {
  const nombre = `${esquema}.${tabla}`
  const flujo = createWriteStream(join(carpeta, `${nombre}.jsonl`), { encoding: 'utf8' })
  const ident = `"${esquema.replaceAll('"', '""')}"."${tabla.replaceAll('"', '""')}"`
  let filas = 0
  for (let desde = 0; ; desde += LOTE) {
    // ctid es estable dentro de la transacción: paginar por él no repite ni
    // salta filas, y no exige saber cuál es la clave de cada tabla.
    const { rows } = await cliente.query(
      `select * from ${ident} order by ctid limit ${LOTE} offset ${desde}`,
    )
    for (const fila of rows) flujo.write(JSON.stringify(fila) + '\n')
    filas += rows.length
    if (rows.length < LOTE) break
  }
  await new Promise((ok, mal) => flujo.end((e) => (e ? mal(e) : ok())))
  return filas
}

async function main() {
  const carpetaDatos = join(destino, 'datos')
  mkdirSync(carpetaDatos, { recursive: true })
  console.log(`Respaldo en ${destino}`)

  await cliente.connect()
  await cliente.query('begin isolation level repeatable read read only')

  const { rows: [foto] } = await cliente.query('select now()::text as momento')
  const { rows: tablas } = await cliente.query(`
    select table_schema as esquema, table_name as tabla
      from information_schema.tables
     where table_type = 'BASE TABLE'
       and (table_schema = 'public'
            or (table_schema = 'auth' and table_name in ('users', 'identities'))
            or (table_schema = 'storage' and table_name = 'objects'))
     order by 1, 2`)

  // Se pregunta antes si existe: un error dentro de la transacción la aborta,
  // y abrir otra rompería la foto única. En la base local de pruebas no está.
  let ultimaMigracion = null
  const { rows: [hayLedger] } = await cliente.query(
    `select to_regclass('supabase_migrations.schema_migrations') is not null as hay`,
  )
  if (hayLedger.hay) {
    const { rows } = await cliente.query(
      'select max(version) as v from supabase_migrations.schema_migrations',
    )
    ultimaMigracion = rows[0]?.v ?? null
  }

  const conteo = {}
  for (const { esquema, tabla } of tablas) {
    conteo[`${esquema}.${tabla}`] = await volcarTabla(esquema, tabla, carpetaDatos)
    console.log(`  ${esquema}.${tabla}: ${conteo[`${esquema}.${tabla}`]}`)
  }

  const { rows: objetos } = await cliente.query(
    `select bucket_id, name from storage.objects order by bucket_id, name`,
  )
  await cliente.query('commit')
  await cliente.end()

  // --- Archivos de Storage ---------------------------------------------------
  const archivos = { bajados: 0, fallidos: [] }
  if (conArchivos && objetos.length > 0) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const clave = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !clave) {
      console.warn('Sin NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY: no se bajan los archivos.')
      archivos.omitidos = 'faltan credenciales'
    } else {
      const supabase = createClient(url, clave, { auth: { persistSession: false } })
      for (const { bucket_id: bucket, name } of objetos) {
        const { data, error } = await supabase.storage.from(bucket).download(name)
        if (error || !data) {
          archivos.fallidos.push({ bucket, name, error: error?.message ?? 'sin datos' })
          continue
        }
        const ruta = join(destino, 'archivos', bucket, ...name.split('/'))
        mkdirSync(dirname(ruta), { recursive: true })
        writeFileSync(ruta, Buffer.from(await data.arrayBuffer()))
        archivos.bajados++
      }
      console.log(`  archivos: ${archivos.bajados} de ${objetos.length}`)
    }
  }

  const manifiesto = {
    proyecto: 'METAL WORK',
    foto_de_la_base: foto.momento,
    ultima_migracion: ultimaMigracion,
    filas: conteo,
    total_filas: Object.values(conteo).reduce((a, b) => a + b, 0),
    objetos_en_storage: objetos.length,
    archivos,
  }
  writeFileSync(join(destino, 'manifiesto.json'), JSON.stringify(manifiesto, null, 2))

  if (archivos.fallidos.length > 0) {
    console.error(`Quedaron ${archivos.fallidos.length} archivos sin bajar: ver manifiesto.json.`)
    process.exit(2)
  }
  console.log(`Listo: ${manifiesto.total_filas} filas en ${tablas.length} tablas.`)
}

main().catch(async (e) => {
  console.error('El respaldo no terminó:', e.message)
  try { await cliente.end() } catch {}
  process.exit(1)
})
