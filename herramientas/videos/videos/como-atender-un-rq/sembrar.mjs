/**
 * Lo que otros puestos hacen fuera de cámara para «Cómo atender un RQ», con la
 * sesión de cada uno (nunca como dueño de las tablas): el stock que hay en el
 * almacén y los dos RQ que llegan a Atención.
 *
 *   - El supervisor de Maestranza pide para la unidad SR-101 10 KG de
 *     electrodos y 6 discos de corte. En el almacén hay 4 KG y 20 discos.
 *   - El supervisor de Producción pide 4 discos de corte para su área:
 *     gasto operativo, sin unidad ni OT.
 *
 * Todo es inventado y del banco local. Devuelve el id y el número de cada RQ,
 * y `comprar(id)`: Logística emite la OC de lo que faltó, con su fecha.
 */
import pg from 'pg'

export const RQ_UNIDAD = {
  unidad: 'SR-101',
  justificacion: 'Armado del chasis: se acabaron los electrodos y los discos del área.',
  electrodos: { codigo: 'ELE-7018', pide: 10, hay: 4 },
  discos: { codigo: 'DIS-CORTE', pide: 6, hay: 20 },
}
export const RQ_AREA = {
  justificacion: 'Discos para las amoladoras del área de Producción.',
  discos: { codigo: 'DIS-CORTE', pide: 4 },
}

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

  /** `sql` con la sesión del puesto, con su rol y su permiso. */
  async function como(puesto, sql, valores = []) {
    await base.query('begin')
    try {
      const [u] = await consulta('select id::text from public.usuarios where correo = $1', [cuenta(puesto)])
      if (!u) throw new Error(`Falta la cuenta ${cuenta(puesto)}: corre antes preparar.sh.`)
      await base.query(
        `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [u.id],
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

  const material = async (codigo) => {
    const [m] = await consulta('select id::text from public.materiales where codigo = $1', [codigo])
    if (!m) throw new Error(`No está el material ${codigo} en el banco.`)
    return m.id
  }
  const ele = await material(RQ_UNIDAD.electrodos.codigo)
  const dis = await material(RQ_UNIDAD.discos.codigo)
  
  const [{ n: unidades }] = await consulta(`select count(*)::int as n from public.unidades where codigo_interno = $1`, [RQ_UNIDAD.unidad])
  if (unidades !== 1) throw new Error(`Falta la unidad ${RQ_UNIDAD.unidad}: corre sembrar-diseno-por-codigo.sql.`)

  // El stock del almacén: que haya exactamente lo que el video dice.
  for (const [id, quiere] of [[ele, RQ_UNIDAD.electrodos.hay], [dis, RQ_UNIDAD.discos.hay]]) {
    const [{ hay }] = await consulta('select coalesce(disponible, 0)::float as hay from public.v_existencias_materiales where material_id = $1', [id]).then(
      (f) => (f.length ? f : [{ hay: 0 }]),
    )
    if (hay > quiere) throw new Error(`Ya hay ${hay} de un material del video: rehaz el banco con preparar.sh.`)
    if (hay < quiere) {
      await consulta(
        `insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por)
         select gen_random_uuid(), 'INGRESO', $1::uuid, $2, 'INGRESO_GENERAL', 'Conteo del banco', u.id from public.usuarios u where u.correo = $3`,
        [id, quiere - hay, cuenta('almacen')],
      )
    }
  }

  const area = async (codigo) => (await consulta('select id::text from public.areas where codigo = $1', [codigo]))[0].id
  const unidad = { id: crypto.randomUUID() }
  await como('sup.mtz', `select public.emitir_requerimiento($1, 'OPERACION', $2, $3, $4, null, $5::jsonb)`, [
    unidad.id,
    await area('MTZ'),
    RQ_UNIDAD.unidad,
    RQ_UNIDAD.justificacion,
    JSON.stringify([
      { material_id: ele, cantidad: RQ_UNIDAD.electrodos.pide },
      { material_id: dis, cantidad: RQ_UNIDAD.discos.pide },
    ]),
  ])
  const delArea = { id: crypto.randomUUID() }
  await como('sup.prd', `select public.emitir_requerimiento_del_area($1, $2, $3, null, $4::jsonb)`, [
    delArea.id,
    await area('PRD'),
    RQ_AREA.justificacion,
    JSON.stringify([{ material_id: dis, cantidad: RQ_AREA.discos.pide }]),
  ])
  const numero = async (id) => (await consulta('select numero from public.requerimientos where id = $1', [id]))[0].numero
  unidad.numero = await numero(unidad.id)
  delArea.numero = await numero(delArea.id)

  /** Logística compra lo que faltó del RQ de la unidad: una OC con la fecha en que llega. */
  async function comprar(dias = 3) {
    await consulta(
      `insert into public.proveedores (numero_documento, razon_social)
       select r, 'PROVEEDOR DEL BANCO'
         from (select '2069' || lpad(n::text, 6, '0') || d::text as r from generate_series(100000, 100200) n, generate_series(0, 9) d) x
        where public.ruc_es_valido(r) and not exists (select 1 from public.proveedores where activo)
        order by r limit 1
       on conflict do nothing`,
    )
    const [prov] = await consulta('select id::text from public.proveedores where activo order by razon_social limit 1')
    const [{ fecha }] = await consulta(`select to_char((now() at time zone 'America/Lima')::date + $1::int, 'YYYY-MM-DD') as fecha`, [dias])
    const [linea] = await consulta('select id::text from public.requerimiento_lineas where requerimiento_id = $1 and item = 1', [unidad.id])
    const oc = crypto.randomUUID()
    const falta = RQ_UNIDAD.electrodos.pide - RQ_UNIDAD.electrodos.hay
    await como('logistica', `select public.emitir_compra_de_requerimientos($1, $2::jsonb, $3, 'Cotización del banco', $4::date, 'CONTADO', 0, 'PEN', true)`, [
      oc,
      JSON.stringify([{ material_id: ele, cantidad: falta, precio: 1, insumos: [linea.id] }]),
      prov.id,
      fecha,
    ])
    const [{ aprobacion }] = await consulta('select aprobacion from public.ordenes_compra_materiales where id = $1', [oc])
    if (aprobacion !== 'APROBADA' && aprobacion !== 'NO_REQUIERE') await como('gerencia', 'select public.aprobar_compra($1)', [oc])
    return fecha
  }

  return { unidad, delArea, comprar, cerrar: () => base.end(), consulta }
}
