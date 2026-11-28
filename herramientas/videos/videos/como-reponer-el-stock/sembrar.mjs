/**
 * Lo que pasa fuera de cámara para «Cómo reponer el stock», con la sesión de
 * cada puesto:
 *
 *   - En el almacén entran 30 discos de corte y 15 KG de electrodos.
 *   - Los discos no tienen mínimo. Salen 22 en tres salidas a SR-101: quedan 8.
 *   - Los electrodos tienen mínimo 10 y compra por mayor 20. Sale una de 8 y
 *     quedan 7: cruzan el mínimo y el sistema avisa a Almacén y a Logística.
 *   - Logística compra los 20 KG de electrodos en una OC directa, que Gerencia
 *     aprueba: ya vienen en camino.
 *
 * Las salidas llevan su foto, una imagen inventada en el Storage del banco.
 * Todo es inventado y del banco local.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'

export const STOCK = {
  discos: { codigo: 'DIS-CORTE', hay: 30, salidas: [6, 8, 8] },
  electrodos: { codigo: 'ELE-7018', hay: 15, salidas: [8], minimo: 10, porMayor: 20 },
}
/** Lo que Almacén fija en cámara para los discos. */
export const DISCOS = { minimo: 15, porMayor: 50 }
const UNIDAD = 'SR-101'
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
  const [{ n: antes }] = await consulta('select count(*)::int as n from public.ordenes_compra_materiales')
  if (antes > 0) throw new Error('El banco ya tiene compras: rehazlo con preparar.sh para que los números salgan iguales.')
  const [{ n: unidades }] = await consulta('select count(*)::int as n from public.unidades where codigo_interno = $1', [UNIDAD])
  if (unidades !== 1) throw new Error(`Falta la unidad ${UNIDAD}: corre sembrar-diseno-por-codigo.sql.`)

  const almacen = await idDe('almacen')
  const [{ id: unidad }] = await consulta('select id::text from public.unidades where codigo_interno = $1', [UNIDAD])

  /** Una salida con su foto, como la registra Almacén. */
  async function salida(material, cantidad) {
    const id = crypto.randomUUID()
    const ruta = `${almacen}/${id}.jpg`
    const archivo = join(ARCHIVOS, 'evidencias-almacen', ruta)
    mkdirSync(join(ARCHIVOS, 'evidencias-almacen', almacen), { recursive: true })
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x9aa3ad:s=800x600', '-frames:v', '1', archivo])
    await consulta(
      `insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
       values ('evidencias-almacen', $1, $2::uuid, $2, jsonb_build_object('size', $3::int, 'mimetype', 'image/jpeg'))`,
      [ruta, almacen, statSync(archivo).size],
    )
    await como('almacen', `select public.registrar_salida_material($1, $2, $3, $4, null, $5, $6, $7, null)`, [
      id, material, cantidad, unidad, 'Armado del chasis', 'Soldador de Maestranza', ruta,
    ])
  }

  const ids = {}
  for (const [clave, m] of Object.entries(STOCK)) {
    const [mat] = await consulta('select id::text from public.materiales where codigo = $1', [m.codigo])
    if (!mat) throw new Error(`No está el material ${m.codigo} en el banco.`)
    ids[clave] = mat.id
    await consulta(
      `insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
       values (gen_random_uuid(), 'INGRESO', $1::uuid, $2, 'INGRESO_GENERAL', 'Conteo del banco', $3::uuid)`,
      [mat.id, m.hay, almacen],
    )
    if (m.minimo) await como('almacen', 'select public.fijar_stock_de_seguridad($1, $2, $3)', [mat.id, m.minimo, m.porMayor])
    for (const c of m.salidas) await salida(mat.id, c)
  }

  await consulta(
    `insert into public.proveedores (numero_documento, razon_social)
     select r, 'PROVEEDOR DEL BANCO'
       from (select '2069' || lpad(n::text, 6, '0') || d::text as r from generate_series(100000, 100200) n, generate_series(0, 9) d) x
      where public.ruc_es_valido(r) and not exists (select 1 from public.proveedores where activo)
      order by r limit 1
     on conflict do nothing`,
  )
  const [prov] = await consulta('select id::text from public.proveedores where activo order by razon_social limit 1')
  const [{ id: compra }] = await como('logistica',
    `select public.emitir_compra_directa(gen_random_uuid(), $1, 'COT-BANCO-1', 'Reposición del almacén', $2::jsonb,
                                         current_date + 2, 'CONTADO', 0, 'PEN', false, 'PLANTA') as id`,
    [prov.id, JSON.stringify([{ material_id: ids.electrodos, cantidad: STOCK.electrodos.porMayor, precio: 1 }])])
  const [{ aprobacion }] = await consulta('select aprobacion from public.ordenes_compra_materiales where id = $1', [compra])
  if (aprobacion !== 'APROBADA' && aprobacion !== 'NO_REQUIERE') await como('gerencia', 'select public.aprobar_compra($1)', [compra])
  const [{ numero: oc }] = await consulta('select numero from public.ordenes_compra_materiales where id = $1', [compra])
  return { ids, oc, cerrar: () => base.end(), consulta, como }
}
