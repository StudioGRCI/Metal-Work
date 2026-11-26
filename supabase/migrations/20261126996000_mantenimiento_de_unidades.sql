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
-- producción no deja pasar ninguno. Idempotente.
-- =============================================================================

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
-- Solo si todavía no pide por ninguno: si alguien ya le puso otro, se respeta.
update public.areas set requerimiento = 'OPERACION'
 where codigo = 'MNT' and requerimiento is null;

-- 3. Las OT de mantenimiento ------------------------------------------------------------
-- Desde que Gerencia la aprueba (la que sigue en borrador todavía no es trabajo
-- del taller) y sin la anulada. `abierta`: el trabajo todavía no se dio por
-- terminado (`orden_garantia_terminada`: lo anotó Administración, o la OT está
-- Terminada, Entregada o Facturada). De las terminadas, las 30 últimas.
-- La OT de mantenimiento muchas veces no tiene su unidad registrada: entonces
-- la placa y el vehículo son los que Requerimientos anotó al registrar su
-- ingreso, para que el puesto reconozca el vehículo que tiene delante.
create or replace function public.mantenimiento_ots()
returns table (
  orden uuid, numero text, codigo text, estado text, prioridad text,
  cliente text, placa text, vehiculo text, descripcion text,
  registrada date, entrega date, motivo_pausa text,
  en_planta boolean, ingreso_en timestamptz, salida_en timestamptz,
  abierta boolean, terminada_en timestamptz,
  ultimo_reporte date, reportes integer
)
language plpgsql stable security definer set search_path to 'public' rows 60 as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('mantenimiento.ots')) then
    raise exception 'No tienes permiso para ver las OT de mantenimiento.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with ot as (
    select o.id, o.numero::text as numero, public.codigo_de_la_ot(o.numero) as codigo,
           o.estado::text as estado, o.prioridad::text as prioridad,
           coalesce(nullif(btrim(cl.razon_social), ''), 'Sin cliente') as cliente,
           nullif(btrim(coalesce(u.placa, '')), '') as placa,
           case when u.id is not null then public.vehiculo_descripcion_de_unidad(u.id) end as vehiculo,
           o.descripcion, o.fecha_registro::date as registrada, o.fecha_entrega_comprometida::date as entrega,
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
  )
  select e.id, e.numero, e.codigo, e.estado, e.prioridad, e.cliente,
         coalesce(e.placa, nullif(btrim(coalesce(v.placa, '')), '')),
         coalesce(e.vehiculo, nullif(btrim(coalesce(v.unidad, '')), '')),
         e.descripcion,
         e.registrada, e.entrega, e.motivo_pausa,
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
    -- Los reportes diarios de su código, de cualquier área.
    left join lateral (
      select max(d.fecha) as ultimo, count(*) as cuantos
        from public.reportes_diarios d
       where d.anulado_en is null and public.normalizar_codigo_interno(d.codigo_interno) = e.codigo
    ) r on true
   order by e.abierta desc, e.entrega nulls last, e.creado_en desc;
end;
$$;
revoke all on function public.mantenimiento_ots() from public, anon;
grant execute on function public.mantenimiento_ots() to authenticated;
comment on function public.mantenimiento_ots() is
  'Las OT de mantenimiento de las unidades de los clientes, desde que se aprueban: las abiertas y las 30 últimas terminadas, con el cliente, la unidad (o la placa y el vehículo de su ingreso, si la OT no tiene unidad), lo que hay que hacer, la fecha comprometida, si el vehículo está en la planta, si el trabajo ya se dio por terminado y el último reporte diario de su código («OT 2921-2026»). Sin montos. Exige mantenimiento.ots.';

-- 4. La gente de Mantenimiento va en el reporte diario --------------------------------------
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
