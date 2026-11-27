/**
 * Lo que pasa fuera de cámara para «Cómo responder una nota de entrega», con
 * la sesión de cada puesto (nunca como dueño de las tablas):
 *
 *   - El supervisor de Maestranza pide 6 discos de corte para SR-101.
 *   - Almacén los tiene, y registra la salida de los 6 con su foto (una
 *     imagen inventada, guardada en el Storage del banco).
 *   - El supervisor anota en la tarjeta del RQ que llegó incompleto: 4 de 6.
 *
 * Todo es inventado y del banco local.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'

export const PEDIDO = {
  unidad: 'SR-101',
  justificacion: 'Armado del chasis: discos para cortar los perfiles.',
  codigo: 'DIS-CORTE',
  pide: 6,
  llego: 4,
  nota: 'Llegaron 4 discos; en la caja faltaban 2.',
  recibe: 'Soldador de Maestranza',
}
const ARCHIVOS = process.env.BANCO_ARCHIVOS ?? '/tmp/banco-archivos'
const cuenta = (puesto) => `${puesto}.local@metalwork.test`

export async function sembrar() {
  const base = new pg.Client({
    host: process.env.PGHOST ?? '/tmp',
    port: Number(process.env.PGPORT ?? 5433),
    user: process.env.PGUSER ?? 'postgres',
    database: process.env.BANCO_BASE ?? 'mw_demo',
  })
  await base.connect()
  const consulta = async (sql, valores = []) => (await base.query(sql, valores)).rows
  const idDe = async (puesto) => {
    const [u] = await consulta('select id::text from public.usuarios where correo = $1', [cuenta(puesto)])
    if (!u) throw new Error(`Falta la cuenta ${cuenta(puesto)}: corre antes preparar.sh.`)
    return u.id
  }
  /** `sql` con la sesión del puesto, con su rol y su permiso. */
  async function como(puesto, sql, valores = []) {
    const yo = await idDe(puesto)
    await base.query('begin')
    try {
      await base.query(
        `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [yo],
      )
      await base.query('set local role authenticated')
      const filas = await consulta(sql, valores)
      await base.query('commit')
      return filas
    } catch (e) {
      await base.query('rollback')
      throw e
    }
  }

  const [mat] = await consulta('select id::text from public.materiales where codigo = $1', [PEDIDO.codigo])
  if (!mat) throw new Error(`No está el material ${PEDIDO.codigo} en el banco.`)
  const [{ n: unidades }] = await consulta('select count(*)::int as n from public.unidades where codigo_interno = $1', [PEDIDO.unidad])
  if (unidades !== 1) throw new Error(`Falta la unidad ${PEDIDO.unidad}: corre sembrar-diseno-por-codigo.sql.`)
  const [{ n: antes }] = await consulta('select count(*)::int as n from public.requerimientos')
  if (antes > 0) throw new Error('El banco ya tiene requerimientos: rehazlo con preparar.sh para que el número salga igual.')

  const almacen = await idDe('almacen')
  await consulta(
    `insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
     values (gen_random_uuid(), 'INGRESO', $1::uuid, 20, 'INGRESO_GENERAL', 'Conteo del banco', $2::uuid)`,
    [mat.id, almacen],
  )

  const rq = crypto.randomUUID()
  const [{ id: mtz }] = await consulta(`select id::text from public.areas where codigo = 'MTZ'`)
  await como('sup.mtz', `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, $4, null, $5::jsonb)`, [
    rq, mtz, PEDIDO.unidad, PEDIDO.justificacion, JSON.stringify([{ material_id: mat.id, cantidad: PEDIDO.pide }]),
  ])
  await como('almacen', `select public.rq_revisar_stock($1, $2::jsonb, null)`, [rq, JSON.stringify([{ item: 1, en_stock: PEDIDO.pide }])])
  const [{ numero }] = await consulta('select numero from public.requerimientos where id = $1', [rq])
  const [{ id: linea }] = await consulta('select id::text from public.requerimiento_lineas where requerimiento_id = $1 and item = 1', [rq])

  // La foto de la salida: una imagen inventada, en el Storage del banco.
  const salida = crypto.randomUUID()
  const ruta = `${almacen}/${salida}.jpg`
  const archivo = join(ARCHIVOS, 'evidencias-almacen', ruta)
  mkdirSync(join(ARCHIVOS, 'evidencias-almacen', almacen), { recursive: true })
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x9aa3ad:s=800x600', '-frames:v', '1', archivo])
  await consulta(
    `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
     values ('evidencias-almacen', $1, $2::uuid, $2, jsonb_build_object('size', $3::int, 'mimetype', 'image/jpeg'))`,
    [ruta, almacen, statSync(archivo).size],
  )
  await como('almacen', `select public.registrar_salida_material($1, $2, $3, null, $4, $5, $6, $7, $8)`, [
    salida, mat.id, PEDIDO.pide, PEDIDO.unidad, `${numero} · ítem 1`, PEDIDO.recibe, ruta, linea,
  ])
  await como('sup.mtz', `select public.anotar_conformidad_salida($1, $2, 'LLEGO_INCOMPLETO', $3, $4)`, [
    crypto.randomUUID(), salida, PEDIDO.llego, PEDIDO.nota,
  ])

  return { rq, numero, cerrar: () => base.end(), consulta }
}
