/**
 * Lo que pasa fuera de cámara para «Cómo validar un ingreso y contar el
 * stock», con la sesión de cada puesto (nunca como dueño de las tablas):
 *
 *   - En el almacén hay 20 discos de corte y 10 KG de electrodos.
 *   - Logística compra 10 discos y 5 KG de electrodos, cada uno en su OC;
 *     Gerencia aprueba y el conductor las deja en almacén. La de electrodos
 *     se dejó hace 3 días (se corre la hora sin disparadores, como en
 *     `herramientas/banco/probar-ingresos-y-conteos.mjs`).
 *
 * Todo es inventado y del banco local.
 */
import pg from 'pg'

export const STOCK = { discos: { codigo: 'DIS-CORTE', hay: 20, compra: 10 }, electrodos: { codigo: 'ELE-7018', hay: 10, compra: 5 } }
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

  const almacen = await idDe('almacen')
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
  const compras = {}
  for (const [i, clave] of ['electrodos', 'discos'].entries()) {
    const [{ id }] = await como('logistica',
      `select public.emitir_compra_directa(gen_random_uuid(), $1, $2, 'Reposición del almacén', $3::jsonb,
                                           current_date + 2, 'CONTADO', 0, 'PEN', false, 'PLANTA') as id`,
      [prov.id, `COT-BANCO-${i + 1}`, JSON.stringify([{ material_id: ids[clave], cantidad: STOCK[clave].compra, precio: 1 }])])
    compras[clave] = id
    const [{ aprobacion }] = await consulta('select aprobacion from public.ordenes_compra_materiales where id = $1', [id])
    if (aprobacion !== 'APROBADA' && aprobacion !== 'NO_REQUIERE') await como('gerencia', 'select public.aprobar_compra($1)', [id])
    await como('logistica', 'select public.programar_recojo($1, $2)', [id, 10])
    await como('conductor', 'select public.marcar_compra_en_recojo($1)', [id])
    await como('conductor', 'select public.marcar_compra_recogida($1)', [id])
    await como('conductor', 'select public.marcar_compra_dejada_almacen($1)', [id])
  }
  await base.query('begin')
  await base.query('set local session_replication_role = replica')
  await consulta(`update public.ordenes_compra_materiales set dejado_en = dejado_en - interval '3 days' where id = $1`, [compras.electrodos])
  await consulta(`update public.ingresos_pendientes_almacen set dejado_en = dejado_en - interval '3 days' where orden_compra_id = $1`, [compras.electrodos])
  await base.query('commit')
  const numero = async (id) => (await consulta('select numero from public.ordenes_compra_materiales where id = $1', [id]))[0].numero
  const oc = { electrodos: await numero(compras.electrodos), discos: await numero(compras.discos) }
  return { ids, compras, oc, cerrar: () => base.end(), consulta }
}
