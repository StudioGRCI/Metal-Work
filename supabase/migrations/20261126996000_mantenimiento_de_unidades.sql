-- =============================================================================
-- MANTENIMIENTO DE UNIDADES: SUS OT, SU RQ Y SU REPORTE DIARIO
-- -----------------------------------------------------------------------------
-- DKS, plan «Las demás áreas», entrega A.3: «Mantenimiento de unidades: en el
-- menú del puesto de Mantenimiento, sus OT, su RQ por el N.º de su OT y su
-- reporte diario. Un solo puesto de Mantenimiento: si el hilo de Mantenimiento
-- de equipos ya lo creó, úsalo.» Aprobó la propuesta el 2026-11-26 («Sí, con
-- tus recomendaciones»).
--
-- El puesto ya existe (rol MANTENIMIENTO, área MNT, migración 20261125160000) y
-- su cuenta también (20261126600000). Y el mantenimiento de la unidad de un
-- cliente ya se sigue por el N.º de su OT, «OT 2921-2026», que hace de código
-- en el RQ, el reporte diario, las compras, la salida del almacén y el costeo
-- (20261120500000, por lo que observó Requerimientos: «En cuanto a
-- mantenimiento se registra por N.º OT, no tenemos código interno»). Lo que
-- faltaba era dárselo al puesto. No se inventa ningún formato ni numeración:
--
--   * SUS OT: `mantenimiento_ots()` da las OT de mantenimiento ya aprobadas,
--     con el cliente, la unidad, lo que hay que hacer, la fecha comprometida,
--     si el vehículo ya entró a la planta, si Administración ya dio el trabajo
--     por terminado y su último reporte diario. SIN MONTOS, y sin abrir la OT:
--     el puesto no recibe `ordenes.ver`. Permiso nuevo `mantenimiento.ots`.
--   * SU RQ: el requerimiento de operación de su área, con el permiso que ya
--     tienen los supervisores (`requerimientos.area`, 20261120300000): registra
--     para su área, corrige y anula solo los suyos. Para eso el área MNT pasa a
--     pedir por el requerimiento de operación (`areas.requerimiento`), que hasta
--     aquí no pedía por ninguno. Es el mismo RQ con que se piden los repuestos
--     de una avería (20261126950000), que Mantenimiento enlaza a su reporte.
--     Y LEE SOLO LOS RQ DE SU ÁREA. Hasta aquí `requerimientos.area` dejaba
--     leer los de todas (`puede_ver_requerimientos`), y no se notaba porque el
--     único puesto que lo tenía, el supervisor de área, tiene además
--     `requerimientos.ver`. Mantenimiento es el primero que lo recibe solo: con
--     la regla de antes habría leído los RQ de Maestranza, Producción, Acabados
--     y Almacén, que nadie pidió («cada puesto ve y registra solo lo suyo»).
--     Las cinco políticas de lectura del RQ pasan a mirar el área (sección 3).
--   * SU REPORTE DIARIO: el de los supervisores (`reporte_diario.registrar`,
--     20261014180000), por el N.º de la OT, con personal, horas y fotos. Lo
--     validan Gerencia y RR. HH. como a los demás. Para que pueda poner a su
--     propia gente, el reporte acepta también a la de planilla de taller del
--     área de Mantenimiento (hasta aquí, solo Maestranza, Producción y
--     Acabados): sin eso sus horas no llegaban al costeo de la OT.
--
-- Lo que NO cambia: Administración sigue dando la OT por terminada
-- (`dar_por_terminada_la_garantia`) y Requerimientos registra el ingreso del
-- vehículo. La garantía sigue con Producción. Gerencia consulta estas OT en
-- Órdenes, como hoy.
--
-- No se crea ninguna cuenta ni se asigna a nadie. Sin DROP: el conector de
-- producción no deja pasar ninguno (las políticas se cambian con `alter
-- policy`). Idempotente.
-- =============================================================================

-- 0. Lo que esta migración reescribe es lo que el repositorio conoce ------------------------
-- Cuatro funciones y seis políticas que ya existen, y la función de la que se copia una lista. Valen la huella de la
-- migración que las dejó y la de esta (volver a correrla). Si alguien las
-- cambió a mano, se detiene sin tocar nada.
do $$
declare
  v record;
begin
  for v in
    select f.firma, f.huellas, md5(replace(p.prosrc, E'\r', '')) as huella
      from (values
        ('public.reporte_diario_personal_disponible()',      array['cb9d7c1c218e463141b53bbbafb300bd', '137769e860c1b9875485388cd4c60a0e']),
        ('public.fn_reporte_diario_solo_gente_del_taller()', array['ae593b8c0f900c62d376a02c49a966bd', '0ad87bd0ea8e5d065f3ab4febf4cb9b1']),
        ('public.averias_rq_enlazados(uuid[])',              array['bcdbf9dfcddba96dc6727970a29f2cb4', '2d4e50050d685587e40a9fec53a723d9']),
        ('public.notas_de_conformidad(uuid[], boolean)',     array['d4e20147ccc04c27c47a02a2e2c7fba3', 'bdf5083931ef285d42376514b5287a1b']),
        -- Esta no se reescribe: `puede_ver_todos_los_requerimientos()` es su lista sin
        -- requerimientos.area. Si en esta base le sumaron un permiso a mano, copiarla
        -- de memoria dejaría a ese puesto sin leer ningún RQ, y sin ningún error.
        ('public.puede_ver_requerimientos()',                array['31388a8d544d0bea148b40e253d7ed02'])
      ) as f(firma, huellas)
      left join pg_proc p on p.oid = to_regprocedure(f.firma)
  loop
    if v.huella is null then
      raise exception 'Falta %: esta base no tiene el reporte diario o las averías de los equipos.', v.firma;
    end if;
    if not (v.huella = any (v.huellas)) then
      raise exception '% no es la que conoce el repositorio (se cambió a mano, huella %): no se reemplaza. Avisa antes de seguir.', v.firma, v.huella;
    end if;
  end loop;

  -- Las políticas: la expresión de antes (la misma huella en Postgres 16 y 17) o
  -- la de esta migración, que se reconoce por la función nueva que nombra. No por
  -- su huella: Postgres guarda la expresión ya analizada y la devuelve escrita a
  -- su manera, que entre el 16 local y el 17 de producción no se pudo comparar
  -- antes de aplicarla.
  for v in
    select f.tabla, f.politica, f.huella as conocida, f.nueva, md5(p.qual) as huella, p.qual
      from (values
        ('public',  'requerimientos',          'ver_requerimientos',          'db2103859eccc1e43a5cb2351176529e', 'puede_ver_todos_los_requerimientos'),
        ('public',  'requerimiento_lineas',    'ver_requerimiento_lineas',    'db2103859eccc1e43a5cb2351176529e', 'puede_ver_todos_los_requerimientos'),
        ('public',  'requerimiento_sustentos', 'ver_requerimiento_sustentos', '35da350cfd4fec826785d03832ac3adf', 'puede_ver_todos_los_requerimientos'),
        ('public',  'correcciones',            'ver_correcciones',            'ff933c85524746d00c9897a15ff3ca7e', 'puede_ver_todos_los_requerimientos'),
        ('public',  'conformidad_salidas',     'ver_conformidad_salidas',     '9d8229738fc52cc8b2fb2cb9305e9714', 'puede_ver_todos_los_requerimientos'),
        ('storage', 'objects',                 'justificantes_quitar_suelto', 'c26be4b56ec9f6005cd6665b9a0d59ec', 'justificante_anotado')
      ) as f(esquema, tabla, politica, huella, nueva)
      left join pg_policies p on p.schemaname = f.esquema and p.tablename = f.tabla and p.policyname = f.politica
  loop
    if v.huella is null then
      raise exception 'Falta la política % de %: no hay qué acotar.', v.politica, v.tabla;
    end if;
    if v.huella <> v.conocida and position(v.nueva in v.qual) = 0 then
      raise exception 'La política % de % no es la que conoce el repositorio (huella %): no se cambia. Avisa antes de seguir.',
        v.politica, v.tabla, v.huella;
    end if;
  end loop;
end $$;

-- 1. Permisos ---------------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('mantenimiento.ots', 'Mantenimiento',
   'Ver las OT de mantenimiento de las unidades de los clientes: qué hay que hacer, si el vehículo ya entró, si el trabajo ya se dio por terminado y su último reporte diario. Sin montos')
on conflict (codigo) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo
  from public.roles r
  cross join (values ('mantenimiento.ots'), ('requerimientos.area'), ('reporte_diario.registrar')) as p(codigo)
 where r.codigo = 'MANTENIMIENTO'
on conflict do nothing;

-- 2. El área pide por el requerimiento de operación ---------------------------------------
-- Solo si todavía no pide por ninguno: si alguien ya le puso otro, se respeta,
-- y se dice, porque entonces el puesto no puede pedir con su permiso.
do $$
declare
  v_tipo text;
begin
  update public.areas set requerimiento = 'OPERACION'
   where codigo = 'MNT' and requerimiento is null;
  select a.requerimiento into v_tipo from public.areas a where a.codigo = 'MNT';
  if v_tipo is null then
    raise notice 'No existe el área MNT: Mantenimiento no tiene con qué área pedir.';
  elsif v_tipo <> 'OPERACION' then
    raise notice 'El área MNT ya pide por el requerimiento %: se respeta, y con él Mantenimiento no puede pedir con requerimientos.area, que es solo del de operación.', v_tipo;
  end if;
end $$;

-- 3. Cada área lee sus RQ ----------------------------------------------------------------
-- `puede_ver_requerimientos()` se queda como está: sigue diciendo quién trabaja
-- con RQ, y de ella cuelgan las funciones que dan el avance, lo entregado, el
-- metrado, el recorrido y las salidas de los RQ QUE SE LES PASAN POR SU ID. Esas
-- no se tocan aquí: no listan nada, y siguen contestando por el id a quien
-- trabaja con RQ (queda dicho en docs/PERMISOS.md). Lo que cambia es la LECTURA
-- DE LAS TABLAS y la única función que lista sin ids (las notas de las salidas):
--
--   * `puede_ver_todos_los_requerimientos()`: la misma lista sin
--     `requerimientos.area`. Requerimientos, Administración, Logística, Almacén,
--     Gerencia y los supervisores (por `requerimientos.ver`) leen todo, como hoy.
--   * `area_de_mis_requerimientos()`: el área de la cuenta, si tiene
--     `requerimientos.area`. Quien solo tiene ese permiso lee los RQ de esa área.
--
-- Las dos no dependen de la fila: van envueltas en `(select …)` y Postgres las
-- evalúa una vez por consulta. Lo que sí depende de la fila es una comparación
-- de columnas, o un `exists` por la llave del RQ.
create or replace function public.puede_ver_todos_los_requerimientos()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.es_admin() or public.tiene_permiso('requerimientos.emitir')
      or public.tiene_permiso('requerimientos.administracion')
      or public.tiene_permiso('requerimientos.ver') or public.tiene_permiso('compras.crear')
      or public.tiene_permiso('almacen.recibir') or public.tiene_permiso('almacen.despachar');
$$;
revoke all on function public.puede_ver_todos_los_requerimientos() from public, anon;
grant execute on function public.puede_ver_todos_los_requerimientos() to authenticated;
comment on function public.puede_ver_todos_los_requerimientos() is
  'Quién lee los RQ de todas las áreas: la lista de puede_ver_requerimientos() sin requerimientos.area, que solo da los de la propia. Si una cambia, cambia la otra (lo vigila el check 497).';

create or replace function public.area_de_mis_requerimientos()
returns uuid language sql stable security definer set search_path to 'public' as $$
  select u.area_id
    from public.usuarios u
   where u.id = public.usuario_actual() and u.activo
     and public.tiene_permiso('requerimientos.area');
$$;
revoke all on function public.area_de_mis_requerimientos() from public, anon;
grant execute on function public.area_de_mis_requerimientos() to authenticated;
comment on function public.area_de_mis_requerimientos() is
  'El área cuyos RQ lee quien pide con requerimientos.area: la de su cuenta. Nulo si no tiene el permiso o la cuenta no tiene área.';

alter policy ver_requerimientos on public.requerimientos using (
  (select public.puede_ver_todos_los_requerimientos())
  or area_id = (select public.area_de_mis_requerimientos())
);

alter policy ver_requerimiento_lineas on public.requerimiento_lineas using (
  (select public.puede_ver_todos_los_requerimientos())
  or exists (select 1 from public.requerimientos r
              where r.id = requerimiento_lineas.requerimiento_id
                and r.area_id = (select public.area_de_mis_requerimientos()))
);

-- El sustento del exceso sobre el metrado: lo sigue leyendo quien lo autoriza.
alter policy ver_requerimiento_sustentos on public.requerimiento_sustentos using (
  (select public.puede_ver_todos_los_requerimientos())
  or (select public.tiene_permiso('requerimientos.autorizar_metrado'))
  or exists (select 1 from public.requerimiento_lineas l
               join public.requerimientos r on r.id = l.requerimiento_id
              where l.id = requerimiento_sustentos.requerimiento_linea_id
                and r.area_id = (select public.area_de_mis_requerimientos()))
);

-- Las correcciones: solo cambia la rama del RQ; la de la OC y la de la factura,
-- tal cual estaban.
alter policy ver_correcciones on public.correcciones using (
  (select public.es_admin())
  or (documento = 'REQUERIMIENTO'
      and ((select public.puede_ver_todos_los_requerimientos())
           or exists (select 1 from public.requerimientos r
                       where r.id = correcciones.documento_id
                         and r.area_id = (select public.area_de_mis_requerimientos()))))
  or (documento = 'ORDEN_COMPRA'
      and ((select public.tiene_permiso('compras.ver'))
           or (select public.tiene_permiso('compras.crear'))
           or (select public.tiene_permiso('tesoreria.ver_documentos'))))
  or (documento = 'FACTURA_COMPRA' and (select public.tiene_permiso('adquisiciones.ver')))
);

-- La nota de conformidad de una salida: Almacén la sigue leyendo entera.
alter policy ver_conformidad_salidas on public.conformidad_salidas using (
  (select public.tiene_permiso('almacen.ver'))
  or (select public.puede_ver_todos_los_requerimientos())
  or exists (select 1 from public.requerimientos r
              where r.id = conformidad_salidas.requerimiento_id
                and r.area_id = (select public.area_de_mis_requerimientos()))
);

-- El justificante de una corrección se quita de Storage solo si ninguna
-- corrección lo nombra, y la política lo preguntaba leyendo `correcciones` CON
-- EL RLS de quien pregunta. Ahora que esa lectura depende del área, a una
-- cuenta que cambia de área se le escondería su corrección y podría quitar un
-- justificante ya anotado. «Ninguna fila lo nombra» se pregunta por encima del
-- RLS, con una función propia (como `archivo_plano_vinculado`). Quién puede
-- VERLO no cambia: sigue pidiendo leer la corrección.
create or replace function public.justificante_anotado(p_ruta text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.correcciones c where c.justificante_ruta = p_ruta);
$$;
revoke all on function public.justificante_anotado(text) from public, anon;
grant execute on function public.justificante_anotado(text) to authenticated;
comment on function public.justificante_anotado(text) is
  'Si alguna corrección nombra ese justificante de Storage, la vea o no quien pregunta: lo usa la política que deja quitar solo el archivo suelto.';

alter policy justificantes_quitar_suelto on storage.objects using (
  bucket_id = 'justificantes-correccion'
  and owner_id = (select auth.uid())::text
  and not public.justificante_anotado(name)
);

-- El RQ enlazado a una avería se abre si quien mira puede leer ESE RQ: antes
-- bastaba con trabajar con RQ, y a Mantenimiento se le habría ofrecido abrir el
-- de otra área para caer en «no existe». La función es la de la 20261126950000
-- con esa columna por fila; nada más cambia.
create or replace function public.averias_rq_enlazados(p_averias uuid[])
returns table (enlace uuid, averia uuid, requerimiento uuid, numero text, estado text, nota text,
               enlazado_en timestamptz, puede_abrir boolean)
language sql stable security definer set search_path to 'public' as $$
  select e.id, e.averia_id, r.id, r.numero,
         case when r.estado = 'ENTREGADO' and r.faltante_al_entregar is not null then 'ENTREGADO_CON_FALTANTE' else r.estado end,
         e.nota, e.enlazado_en,
         public.puede_ver_todos_los_requerimientos()
           or coalesce(r.area_id = public.area_de_mis_requerimientos(), false)
    from public.averia_requerimientos e
    join public.requerimientos r on r.id = e.requerimiento_id
   where e.averia_id = any(p_averias)
     and e.quitado_en is null
     and cardinality(p_averias) <= 500
     and public.averia_la_ve(e.averia_id)
   order by e.enlazado_en;
$$;
revoke all on function public.averias_rq_enlazados(uuid[]) from public, anon;
grant execute on function public.averias_rq_enlazados(uuid[]) to authenticated;

-- Las notas de conformidad de las salidas, la única función de los RQ que
-- LISTA sin que le pasen ids (las abiertas, para la tarjeta de Almacén): con la
-- regla de antes le habría dado a Mantenimiento las de todas las áreas. Es la de
-- la 20261126521000 con el área en el `where`; nada más cambia. Almacén
-- (`almacen.ver`) las sigue leyendo todas.
create or replace function public.notas_de_conformidad(p_requerimientos uuid[] default null, p_solo_abiertas boolean default false)
returns table (
  id                 uuid,
  movimiento_id      uuid,
  requerimiento_id   uuid,
  requerimiento      text,
  item               smallint,
  material           text,
  unidad             text,
  salio              numeric,
  numero_salida      text,
  salio_en           timestamptz,
  tipo               text,
  cantidad_recibida  numeric,
  nota               text,
  anotado_por        text,
  anotado_en         timestamptz,
  respuesta          text,
  atendido_por       text,
  atendido_en        timestamptz,
  puede_atender      boolean
)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_todas boolean := public.tiene_permiso('almacen.ver') or public.puede_ver_todos_los_requerimientos();
  v_area  uuid := public.area_de_mis_requerimientos();
begin
  if not (public.tiene_permiso('almacen.ver') or public.puede_ver_requerimientos()) then
    raise exception 'No tienes permiso para ver las notas de las salidas.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select c.id, c.movimiento_id, r.id, r.numero, l.item, mat.descripcion::text, um.codigo::text, m.cantidad::numeric,
           m.numero_salida, m.registrado_en, c.tipo, c.cantidad_recibida::numeric, c.nota,
           nullif(btrim(concat_ws(' ', ua.nombres, ua.apellidos)), ''), c.registrado_en,
           c.respuesta, nullif(btrim(concat_ws(' ', ut.nombres, ut.apellidos)), ''), c.atendido_en,
           public.tiene_permiso('almacen.despachar')
      from public.conformidad_salidas c
      join public.movimientos_materiales m on m.id = c.movimiento_id
      join public.requerimientos r on r.id = c.requerimiento_id
      join public.requerimiento_lineas l on l.id = c.requerimiento_linea_id
      left join public.materiales mat on mat.id = m.material_id
      left join public.unidades_medida um on um.id = mat.unidad_medida_id
      left join public.usuarios ua on ua.id = c.registrado_por
      left join public.usuarios ut on ut.id = c.atendido_por
     where (p_requerimientos is null or c.requerimiento_id = any(p_requerimientos))
       and (not p_solo_abiertas or c.atendido_en is null)
       and (v_todas or r.area_id = v_area)
     order by c.atendido_en is not null, c.registrado_en, c.id;
end;
$$;
revoke all on function public.notas_de_conformidad(uuid[], boolean) from public, anon;
grant execute on function public.notas_de_conformidad(uuid[], boolean) to authenticated;

-- 4. Las OT de mantenimiento ------------------------------------------------------------
-- Desde que Gerencia la aprueba (la que sigue en borrador todavía no es trabajo
-- del taller) y sin la anulada. `abierta`: el trabajo todavía no se dio por
-- terminado (`orden_garantia_terminada`: lo anotó Administración, o la OT está
-- Terminada, Entregada o Facturada). De las terminadas, las 30 últimas.
-- La OT de mantenimiento muchas veces no tiene su unidad registrada: entonces
-- la placa y el vehículo son los que Requerimientos anotó al registrar su
-- ingreso, para que el puesto reconozca el vehículo que tiene delante.
-- El último reporte y la cuenta son los DEL ÁREA DE QUIEN MIRA (todas, para el
-- administrador): otra área puede reportar horas en el mismo código, y contarlas
-- aquí le diría a Mantenimiento que ya reportó un día que no reportó.
-- Las abiertas, por la fecha comprometida; las terminadas, de la última a la
-- más antigua.
create or replace function public.mantenimiento_ots()
returns table (
  orden uuid, numero text, codigo text, estado text, prioridad text,
  cliente text, placa text, vehiculo text, descripcion text,
  entrega date, motivo_pausa text,
  en_planta boolean, ingreso_en timestamptz, salida_en timestamptz,
  abierta boolean, terminada_en timestamptz,
  ultimo_reporte date, reportes integer
)
language plpgsql stable security definer set search_path to 'public' rows 60 as $$
#variable_conflict use_column
declare
  v_todas boolean := public.es_admin();
  v_area  uuid;
begin
  if not (v_todas or public.tiene_permiso('mantenimiento.ots')) then
    raise exception 'No tienes permiso para ver las OT de mantenimiento.' using errcode = 'insufficient_privilege';
  end if;
  select u.area_id into v_area from public.usuarios u where u.id = public.usuario_actual();
  return query
  with ot as (
    select o.id, o.numero::text as numero, public.codigo_de_la_ot(o.numero) as codigo,
           o.estado::text as estado, o.prioridad::text as prioridad,
           coalesce(nullif(btrim(cl.razon_social), ''), 'Sin cliente') as cliente,
           nullif(btrim(coalesce(u.placa, '')), '') as placa,
           case when u.id is not null then public.vehiculo_descripcion_de_unidad(u.id) end as vehiculo,
           o.descripcion, o.fecha_entrega_comprometida::date as entrega,
           case when o.estado = 'PAUSADA' then nullif(btrim(coalesce(o.motivo_pausa, '')), '') end as motivo_pausa,
           not public.orden_garantia_terminada(o.id) as abierta,
           (select max(t.terminada_en) from public.ot_garantia_terminada t where t.orden_id = o.id) as terminada_en,
           o.creado_en
      from public.ordenes_trabajo o
      left join public.unidades u on u.id = o.unidad_id
      left join public.clientes cl on cl.id = coalesce(o.cliente_id, u.cliente_id)
     where o.tipo_trabajo = 'MANTENIMIENTO' and o.estado not in ('BORRADOR', 'ANULADA')
  ), elegidas as (
    select * from ot where abierta
    union all
    (select * from ot where not abierta order by coalesce(terminada_en, creado_en) desc limit 30)
  ), reportados as (
    -- Los reportes diarios de esos códigos, de una sola pasada.
    select public.normalizar_codigo_interno(d.codigo_interno) as codigo,
           max(d.fecha) as ultimo, count(*) as cuantos
      from public.reportes_diarios d
     where d.anulado_en is null
       and (v_todas or d.area_id = v_area)
       and public.normalizar_codigo_interno(d.codigo_interno) in (select e.codigo from elegidas e)
     group by 1
  )
  select e.id, e.numero, e.codigo, e.estado, e.prioridad, e.cliente,
         coalesce(e.placa, nullif(btrim(coalesce(v.placa, '')), '')),
         coalesce(e.vehiculo, nullif(btrim(coalesce(v.unidad, '')), '')),
         e.descripcion,
         e.entrega, e.motivo_pausa,
         coalesce(v.ingreso_en is not null and v.salida_en is null, false), v.ingreso_en, v.salida_en,
         e.abierta, e.terminada_en,
         r.ultimo, coalesce(r.cuantos, 0)::integer
    from elegidas e
    -- El último ingreso del vehículo por esta OT.
    left join lateral (
      select rv.ingreso_en, rv.salida_en, rv.placa, rv.unidad
        from public.registro_vehiculos rv
       where rv.orden_id = e.id and rv.anulado_en is null
       order by rv.ingreso_en desc
       limit 1
    ) v on true
    left join reportados r on r.codigo = e.codigo
   order by e.abierta desc,
            case when e.abierta then e.entrega end nulls last,
            case when not e.abierta then coalesce(e.terminada_en, e.creado_en) end desc nulls last,
            e.creado_en desc;
end;
$$;
revoke all on function public.mantenimiento_ots() from public, anon;
grant execute on function public.mantenimiento_ots() to authenticated;
comment on function public.mantenimiento_ots() is
  'Las OT de mantenimiento de las unidades de los clientes, desde que se aprueban: las abiertas (por fecha comprometida) y las 30 últimas terminadas, con el cliente, la unidad (o la placa y el vehículo de su ingreso, si la OT no tiene unidad), lo que hay que hacer, la prioridad, si el vehículo está en la planta, si el trabajo ya se dio por terminado y el último reporte diario de su código («OT 2921-2026») que subió el área de quien mira. Sin montos. Exige mantenimiento.ots.';

-- 5. La gente de Mantenimiento va en el reporte diario --------------------------------------
-- El reporte diario ofrecía y aceptaba solo a la gente de planilla de taller de
-- Maestranza, Producción y Acabados (20261020181000): con eso Mantenimiento no
-- podía poner a su propia gente en su reporte, y sus horas no llegaban al
-- costeo de la OT. Se suma su área, con la misma condición: activa y de
-- planilla de taller, que la decide RR. HH. Las dos funciones son las de esa
-- migración con el área de más; nada más cambia.
create or replace function public.reporte_diario_personal_disponible()
returns table (id uuid, nombres text, apellidos text, cargo text, area_id uuid, area text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('reporte_diario.registrar');
  return query
    select t.id, t.nombres, t.apellidos, t.cargo, t.area_id, a.nombre
      from public.trabajadores t
      join public.areas a on a.id = t.area_id
     where t.activo
       and t.planilla = 'TALLER'
       and a.codigo in ('MTZ', 'PRD', 'ACB', 'MNT')
     order by t.apellidos, t.nombres;
end;
$$;
revoke all on function public.reporte_diario_personal_disponible() from public, anon;
grant execute on function public.reporte_diario_personal_disponible() to authenticated;
comment on function public.reporte_diario_personal_disponible() is
  'La gente que se puede poner en el reporte diario: activa, de planilla de taller y de Maestranza, Producción, Acabados o Mantenimiento. Sin DNI, cuenta ni costo. Exige reporte_diario.registrar.';

create or replace function public.fn_reporte_diario_solo_gente_del_taller()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_reemplaza uuid;
begin
  if exists (select 1 from public.trabajadores t
               join public.areas a on a.id = t.area_id
              where t.id = new.trabajador_id and t.planilla = 'TALLER' and a.codigo in ('MTZ', 'PRD', 'ACB', 'MNT')) then
    return new;
  end if;
  -- Al corregir, quien ya iba en el observado se queda.
  select r.reemplaza_a into v_reemplaza from public.reportes_diarios r where r.id = new.reporte_id;
  if v_reemplaza is not null and exists (select 1 from public.reporte_diario_personal p
                                          where p.reporte_id = v_reemplaza and p.trabajador_id = new.trabajador_id) then
    return new;
  end if;
  raise exception '% no es de la planilla de taller de Maestranza, Producción, Acabados o Mantenimiento, y no va en el reporte diario. Si trabaja en el taller, pídele a Recursos Humanos que corrija su ficha.',
    new.nombre using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_reporte_diario_solo_gente_del_taller() from public, anon, authenticated;
comment on function public.fn_reporte_diario_solo_gente_del_taller() is
  'En el reporte diario va solo la gente de planilla de taller de Maestranza, Producción, Acabados o Mantenimiento; al corregir un observado, también quien ya iba en él.';
