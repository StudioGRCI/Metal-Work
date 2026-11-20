-- =============================================================================
-- EL REQUERIMIENTO SE SUSTENTA CON EL METRADO DE DISEÑO
-- -----------------------------------------------------------------------------
-- Almacén entregó el 20/11/2026 «Mejoras en el proceso de requerimientos y
-- control de Almacén». Su conclusión: un requerimiento no se aprueba sin
-- sustento técnico, cada unidad responde por las cantidades que pide y Almacén
-- no carga con los errores de planificación de otras áreas. Pide solicitar
-- planos y metrados antes de aprobar un RQ y verificar que las cantidades
-- correspondan a lo que de verdad necesita la unidad, para que no se pida de
-- más ni se compre lo que no hace falta.
--
-- El metrado ya existe: es la lista de materiales que Diseño carga por código
-- interno (`codigo_materiales`, migración 20261015200000), con su cantidad y el
-- plano del que sale. Hasta hoy nadie la cruzaba con el RQ: cada área pedía lo
-- que creía y Almacén lo atendía.
--
-- Desde aquí, cada insumo de un RQ de unidad se mide contra ese metrado:
--
--   · Lo que Diseño metró para el código, menos lo que ya pidieron los RQ
--     anteriores de ese código (los no anulados), es lo que queda por pedir.
--   · El insumo que pide más de lo que queda, o que no está en el metrado, se
--     pasa. Quien lo pidió escribe por qué (el sustento), y Diseño lo autoriza o
--     no (DKS, 20/11/2026: «Sustento y visto de Diseño»). Si Diseño amplía el
--     metrado, el insumo deja de pasarse solo.
--   · Almacén no revisa el stock de un RQ mientras alguno de sus insumos se pase
--     sin autorizar; Logística no lo pone en una OC ni Almacén lo entrega.
--
-- Qué se mide: la materia prima y los accesorios, que son lo que lleva la
-- unidad, y cualquier otro material que Diseño haya puesto en el metrado del
-- código (si metró la pintura, la pintura se mide). Los consumibles y el EPP que
-- no están en el metrado se controlan con el stock mínimo, no con esto.
-- No se mide: PLANTA, OFICINA y TODOS LOS ACTIVOS, que no son una unidad; las
-- OT de garantía y de mantenimiento («OT 2939-2026»), que no tienen metrado; la
-- recompra de lo que el proveedor no repuso, que ya se pidió una vez; y los RQ
-- registrados antes de esta migración (`con_metrado` falso), para no frenar lo
-- que ya está en curso.
--
-- Quién autoriza es un permiso (`requerimientos.autorizar_metrado`), no un
-- puesto escrito en el código: hoy lo tiene Diseño; si Gerencia decide que el
-- visto lo dé otro puesto, se cambia el rol.
--
-- Idempotente. Sin `drop`. No reescribe ninguna función de otro hilo: las
-- puertas son disparadores propios.
-- =============================================================================

-- 1. El permiso -------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('requerimientos.autorizar_metrado', 'Requerimientos',
   'Autorizar, o no, el insumo de un requerimiento de unidad que pide más de lo que dice el metrado de Diseño o algo que no está en él')
on conflict (codigo) do update set descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'requerimientos.autorizar_metrado'
  from public.roles r
 where r.codigo in ('DISENO', 'DISENO_LIDER')
on conflict do nothing;

-- 2. Qué RQ van con el metrado ------------------------------------------------------
-- Las filas que ya existen quedan en falso (lo que ya estaba en curso sigue como
-- iba); las nuevas nacen en verdadero.
alter table public.requerimientos add column if not exists con_metrado boolean not null default false;
alter table public.requerimientos alter column con_metrado set default true;
comment on column public.requerimientos.con_metrado is
  'El RQ se registró con la regla del metrado de Diseño (migración 20261120400000). Los de antes van sin ella. No cambia.';

-- 3. El sustento y el visto de cada insumo -----------------------------------------
create table if not exists public.requerimiento_sustentos (
  id                     uuid primary key default gen_random_uuid(),
  requerimiento_linea_id uuid not null,
  -- Lo que era el insumo al sustentarlo: el visto vale para ese material y hasta
  -- esa cantidad. Si después se corrige hacia arriba o cambia de material, se
  -- vuelve a sustentar.
  material_id            uuid,
  cantidad               numeric(14,3) not null,
  -- Cuánto se pasaba y cuánto decía el metrado en ese momento (vacío: no estaba).
  exceso                 numeric(14,3) not null,
  metrado                numeric(14,3),
  sustento               text not null,
  sustentado_por         uuid not null default public.usuario_actual(),
  sustentado_en          timestamptz not null default now(),
  decision               text,
  nota_decision          text,
  decidido_por           uuid,
  decidido_en            timestamptz,
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),
  constraint requerimiento_sustentos_linea_fkey foreign key (requerimiento_linea_id)
    references public.requerimiento_lineas(id) on delete restrict,
  constraint requerimiento_sustentos_material_fkey foreign key (material_id)
    references public.materiales(id) on delete restrict,
  constraint requerimiento_sustentos_sustentado_por_fkey foreign key (sustentado_por)
    references public.usuarios(id) on delete restrict,
  constraint requerimiento_sustentos_decidido_por_fkey foreign key (decidido_por)
    references public.usuarios(id) on delete restrict,
  constraint ck_requerimiento_sustento check (
    char_length(btrim(sustento)) between 10 and 500
    and cantidad > 0 and exceso > 0 and exceso <= cantidad
    and (metrado is null or metrado >= 0)
    and (decision is null or decision in ('AUTORIZADO', 'RECHAZADO'))
    and (decision is null) = (decidido_en is null) and (decision is null) = (decidido_por is null)
    and (nota_decision is null or char_length(btrim(nota_decision)) between 1 and 500)
    and (decision is distinct from 'RECHAZADO' or char_length(btrim(coalesce(nota_decision, ''))) >= 10))
);
comment on table public.requerimiento_sustentos is
  'Por qué un insumo de un RQ de unidad se pasa del metrado de Diseño, y si Diseño lo autorizó. No se borra: un sustento rechazado queda y el siguiente va aparte.';

-- Un solo sustento esperando el visto por insumo.
create unique index if not exists uq_requerimiento_sustento_abierto
  on public.requerimiento_sustentos (requerimiento_linea_id) where decision is null;
-- (b) La tarjeta del RQ y las puertas leen el último sustento de cada insumo.
create index if not exists ix_requerimiento_sustentos_linea
  on public.requerimiento_sustentos (requerimiento_linea_id, sustentado_en desc);

select public.activar_timestamps('requerimiento_sustentos');
select public.activar_auditoria('requerimiento_sustentos');
select public.activar_registro_de_prueba('requerimiento_sustentos');

-- Se escribe solo por `sustentar_insumos` y `autorizar_insumos`. El visto dado
-- queda: no se cambia ni se borra.
create or replace function public.fn_requerimiento_sustento_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un sustento no se borra: queda como evidencia de lo que se pidió.' using errcode = 'check_violation';
  end if;
  if old.decision is not null then
    raise exception 'Diseño ya dio su visto a este sustento: queda como está.' using errcode = 'check_violation';
  end if;
  if new.requerimiento_linea_id is distinct from old.requerimiento_linea_id then
    raise exception 'El sustento es de su insumo: no se pasa a otro.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_requerimiento_sustento_guardia() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_requerimiento_sustento_guardia'
                   and tgrelid = 'public.requerimiento_sustentos'::regclass) then
    create trigger trg_requerimiento_sustento_guardia before update or delete on public.requerimiento_sustentos
      for each row execute function public.fn_requerimiento_sustento_guardia();
  end if;
end $$;

alter table public.requerimiento_sustentos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'requerimiento_sustentos'
                   and policyname = 'ver_requerimiento_sustentos') then
    create policy ver_requerimiento_sustentos on public.requerimiento_sustentos for select to authenticated
      using ((select public.puede_ver_requerimientos()) or (select public.tiene_permiso('requerimientos.autorizar_metrado')));
  end if;
end $$;
revoke all on public.requerimiento_sustentos from public, anon, authenticated;
grant select on public.requerimiento_sustentos to authenticated;

-- 4. Qué código no lleva metrado ------------------------------------------------------
-- PLANTA, OFICINA y TODOS LOS ACTIVOS se comparan solo por sus letras, como en la
-- salida del almacén (un espacio duro pegado desde Excel no los vuelve otro
-- código). La OT de garantía o mantenimiento es «OT » y su número.
create or replace function public.codigo_sin_metrado(p_codigo text)
returns boolean language sql immutable set search_path to 'public' as $$
  select coalesce(public.normalizar_codigo_interno(p_codigo), '') = ''
      or regexp_replace(upper(public.normalizar_codigo_interno(p_codigo)), '[^A-Z0-9]', '', 'g')
           in ('PLANTA', 'OFICINA', 'TODOSLOSACTIVOS')
      or public.normalizar_codigo_interno(p_codigo) ~ '^OT [0-9]+-[0-9]{4}$';
$$;
revoke all on function public.codigo_sin_metrado(text) from public, anon;
grant execute on function public.codigo_sin_metrado(text) to authenticated;

-- 5. Cada insumo contra el metrado ----------------------------------------------------
-- El cálculo, sin permiso: lo usan las puertas, que corren dentro de la revisión
-- de Almacén, de la OC de Logística y de la salida, cada una con el permiso de
-- quien la hace. Almacén y Logística no leen el metrado de Diseño por su RLS.
--
-- Lo ya pedido antes de un insumo son los insumos del mismo material y del mismo
-- código en RQ no anulados registrados antes que él (por fecha; a la misma hora,
-- por número y por ítem), sin las recompras. Se pasa por lo que lo pedido antes
-- más lo suyo supere el metrado, nunca por más de lo suyo. El insumo que no está
-- en el metrado (o que es un material nuevo, que el metrado no puede tener) se
-- pasa entero.
--
-- Estados: NO_APLICA (no se mide), EN_METRADO, SIN_SUSTENTO, POR_AUTORIZAR,
-- AUTORIZADO, RECHAZADO. El insumo está en regla en NO_APLICA, EN_METRADO y
-- AUTORIZADO. El visto vale para el material y la cantidad que tenía al
-- sustentarlo: corregido hacia arriba o con otro material, se sustenta de nuevo.
-- El que se pidió sin material sigue autorizado cuando Almacén le pone el suyo.
create or replace function public.metrado_por_linea(p_requerimientos uuid[])
returns table (linea_id uuid, requerimiento_id uuid, item smallint, aplica boolean, metrado numeric,
               pedido_antes numeric, exceso numeric, sustento_id uuid, estado text)
language sql stable security definer set search_path to 'public' as $$
  with l as (
    select l.id, l.requerimiento_id, l.item, l.cantidad, l.material_id, l.recompra_de,
           r.creado_en as rq_en, r.numero, r.estado as rq_estado, r.con_metrado,
           public.normalizar_codigo_interno(r.codigo_interno) as codigo,
           coalesce(cm.almacen, cl.almacen) as almacen
      from public.requerimiento_lineas l
      join public.requerimientos r on r.id = l.requerimiento_id
      left join public.materiales m on m.id = l.material_id
      left join public.categorias_material cm on cm.id = m.categoria_id
      left join public.categorias_material cl on cl.id = l.categoria_id
     where l.requerimiento_id = any(p_requerimientos)
  ), medido as (
    select l.*,
           (select sum(c.cantidad) from public.codigo_materiales c
             where c.codigo_interno = l.codigo and c.material_id = l.material_id and c.quitado_en is null) as metrado,
           coalesce((select sum(o.cantidad)
                       from public.requerimiento_lineas o
                       join public.requerimientos ro on ro.id = o.requerimiento_id
                      where o.material_id = l.material_id and o.recompra_de is null and o.id <> l.id
                        and ro.estado <> 'ANULADO'
                        and public.normalizar_codigo_interno(ro.codigo_interno) = l.codigo
                        and (ro.creado_en, ro.numero, o.item) < (l.rq_en, l.numero, l.item)), 0) as pedido_antes
      from l
  ), con_regla as (
    select m.*,
           m.con_metrado and m.rq_estado <> 'ANULADO' and m.recompra_de is null
             and not public.codigo_sin_metrado(m.codigo)
             and (m.almacen in ('MATERIA_PRIMA', 'ACCESORIOS') or m.metrado is not null) as aplica
      from medido m
  ), con_exceso as (
    select c.*,
           case when not c.aplica then 0
                when c.metrado is null or c.material_id is null then c.cantidad
                else least(c.cantidad, greatest(c.pedido_antes + c.cantidad - c.metrado, 0)) end as exceso
      from con_regla c
  )
  select e.id, e.requerimiento_id, e.item, e.aplica, e.metrado, e.pedido_antes, e.exceso, s.id,
         case when not e.aplica then 'NO_APLICA'
              when e.exceso <= 0 then 'EN_METRADO'
              when s.id is null then 'SIN_SUSTENTO'
              -- El insumo pedido sin material (uno nuevo) lo asocia Almacén al
              -- revisar: el visto que se dio por su descripción sigue valiendo.
              when s.material_id is not null and s.material_id is distinct from e.material_id then 'SIN_SUSTENTO'
              when s.decision = 'AUTORIZADO' and s.cantidad >= e.cantidad then 'AUTORIZADO'
              when s.decision = 'AUTORIZADO' then 'SIN_SUSTENTO'
              when s.cantidad <> e.cantidad then 'SIN_SUSTENTO'
              when s.decision = 'RECHAZADO' then 'RECHAZADO'
              else 'POR_AUTORIZAR' end
    from con_exceso e
    left join lateral (
      select x.id, x.material_id, x.cantidad, x.decision
        from public.requerimiento_sustentos x
       where x.requerimiento_linea_id = e.id
       order by x.sustentado_en desc, x.creado_en desc
       limit 1) s on true;
$$;
revoke all on function public.metrado_por_linea(uuid[]) from public, anon, authenticated;

-- Lo mismo para la pantalla, con quién sustentó y quién decidió, y de qué planos
-- sale el material en el código (la documentación vigente: el número del plano
-- y su última revisión, sin los anulados). Lo ve quien ve los requerimientos y
-- quien autoriza.
create or replace function public.metrado_de_requerimientos(p_requerimientos uuid[])
returns table (linea_id uuid, requerimiento_id uuid, item smallint, estado text, metrado numeric,
               pedido_antes numeric, exceso numeric, planos text, sustento text, sustentado_por text,
               sustentado_en timestamptz, decision text, nota_decision text, decidido_por text, decidido_en timestamptz)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.puede_ver_requerimientos() or public.tiene_permiso('requerimientos.autorizar_metrado')) then
    raise exception 'No tienes permiso para ver los requerimientos.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select m.linea_id, m.requerimiento_id, m.item, m.estado, m.metrado, m.pedido_antes, m.exceso,
         (select string_agg(distinct p.numero || coalesce(' R' || (select max(v.revision) from public.codigo_plano_revisiones v
                                                                     where v.plano_id = p.id), ''), ', ')
            from public.codigo_materiales c
            join public.codigo_planos p on p.id = c.plano_id and p.anulado_en is null
            join public.requerimiento_lineas l on l.id = m.linea_id
            join public.requerimientos r on r.id = l.requerimiento_id
           where c.quitado_en is null and c.material_id = l.material_id
             and c.codigo_interno = public.normalizar_codigo_interno(r.codigo_interno)),
         s.sustento, nullif(btrim(concat_ws(' ', us.nombres, us.apellidos)), ''), s.sustentado_en,
         s.decision, s.nota_decision, nullif(btrim(concat_ws(' ', ud.nombres, ud.apellidos)), ''), s.decidido_en
    from public.metrado_por_linea(p_requerimientos) m
    left join public.requerimiento_sustentos s on s.id = m.sustento_id
    left join public.usuarios us on us.id = s.sustentado_por
    left join public.usuarios ud on ud.id = s.decidido_por
   order by m.requerimiento_id, m.item;
end;
$$;
revoke all on function public.metrado_de_requerimientos(uuid[]) from public, anon;
grant execute on function public.metrado_de_requerimientos(uuid[]) to authenticated;

-- Los insumos que esperan el visto de Diseño, para su bandeja y su globo.
create or replace function public.requerimientos_por_autorizar()
returns table (requerimiento_id uuid)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('requerimientos.autorizar_metrado')) then
    return;
  end if;
  return query
  select distinct m.requerimiento_id
    from public.metrado_por_linea(array(
           select distinct l.requerimiento_id
             from public.requerimiento_sustentos s
             join public.requerimiento_lineas l on l.id = s.requerimiento_linea_id
             join public.requerimientos r on r.id = l.requerimiento_id
            where s.decision is null and r.estado not in ('ANULADO', 'ENTREGADO'))) m
   where m.estado = 'POR_AUTORIZAR';
end;
$$;
revoke all on function public.requerimientos_por_autorizar() from public, anon;
grant execute on function public.requerimientos_por_autorizar() to authenticated;

-- 6. El sustento de quien pidió --------------------------------------------------------
-- Lo escribe quien puede registrar ese tipo de RQ (`rq_exigir`), uno por insumo
-- que se pasa. Si ya esperaba el visto, se reemplaza: la última palabra de quien
-- pidió es la que lee Diseño. A Diseño le llega el aviso.
create or replace function public.sustentar_insumos(p_requerimiento uuid, p_lineas jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_rq      public.requerimientos%rowtype;
  v_x       record;
  v_m       record;
  v_linea   public.requerimiento_lineas%rowtype;
  v_items   text := '';
  v_n       integer := 0;
begin
  select * into v_rq from public.requerimientos where id = p_requerimiento for update;
  if not found then
    raise exception 'El requerimiento no existe.';
  end if;
  perform public.rq_exigir(v_rq.tipo, 'REGISTRAR');
  if v_rq.estado in ('ANULADO', 'ENTREGADO') then
    raise exception 'El requerimiento % ya está %: no se sustenta.', v_rq.numero,
      case v_rq.estado when 'ANULADO' then 'anulado' else 'entregado' end using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_lineas) is distinct from 'array' or jsonb_array_length(p_lineas) not between 1 and 100 then
    raise exception 'Escribe el sustento de cada insumo que se pasa del metrado.' using errcode = 'check_violation';
  end if;
  if (select count(distinct x.item) from jsonb_to_recordset(p_lineas) x(item smallint)) <> jsonb_array_length(p_lineas) then
    raise exception 'Escribe un solo sustento por insumo.' using errcode = 'check_violation';
  end if;

  for v_x in select * from jsonb_to_recordset(p_lineas) x(item smallint, sustento text) order by x.item loop
    if v_x.item is null or char_length(btrim(coalesce(v_x.sustento, ''))) not between 10 and 500 then
      raise exception 'Cuenta en cada insumo por qué hace falta más de lo que dice el metrado, de 10 a 500 caracteres.'
        using errcode = 'check_violation';
    end if;
    select * into v_linea from public.requerimiento_lineas
     where requerimiento_id = p_requerimiento and item = v_x.item for update;
    if not found then
      raise exception 'El requerimiento % no tiene el insumo %.', v_rq.numero, v_x.item using errcode = 'check_violation';
    end if;
    select * into v_m from public.metrado_por_linea(array[p_requerimiento]) m where m.linea_id = v_linea.id;
    if v_m.estado in ('NO_APLICA', 'EN_METRADO') then
      raise exception 'El insumo % entra en el metrado de Diseño: no necesita sustento. Recarga la pantalla.', v_x.item
        using errcode = 'check_violation';
    end if;
    if v_m.estado = 'AUTORIZADO' then
      raise exception 'Diseño ya autorizó el insumo %: no hace falta sustentarlo otra vez.', v_x.item
        using errcode = 'check_violation';
    end if;
    update public.requerimiento_sustentos
       set sustento = btrim(v_x.sustento), material_id = v_linea.material_id, cantidad = v_linea.cantidad,
           exceso = v_m.exceso, metrado = v_m.metrado,
           sustentado_por = public.usuario_actual(), sustentado_en = now()
     where requerimiento_linea_id = v_linea.id and decision is null;
    if not found then
      insert into public.requerimiento_sustentos
        (requerimiento_linea_id, material_id, cantidad, exceso, metrado, sustento)
      values (v_linea.id, v_linea.material_id, v_linea.cantidad, v_m.exceso, v_m.metrado, btrim(v_x.sustento));
    end if;
    v_n := v_n + 1;
    v_items := v_items || case when v_items = '' then '' else ', ' end || v_x.item;
  end loop;

  -- A quien autoriza, salvo a quien lo escribió.
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, 'Por autorizar: ' || v_rq.numero,
         case when v_n = 1 then 'El insumo ' || v_items else 'Los insumos ' || v_items end
           || ' de ' || public.normalizar_codigo_interno(v_rq.codigo_interno)
           || case when v_n = 1 then ' se pasa' else ' se pasan' end
           || ' del metrado. Quien pidió escribió por qué: revísalo y autorízalo o no.',
         '/requerimientos/metrado', 'requerimientos', v_rq.id
    from public.usuarios u
    join public.roles r on r.id = u.rol_id
   where u.activo and u.id is distinct from public.usuario_actual()
     and exists (select 1 from public.roles_permisos rp
                  where rp.rol_id = r.id and rp.permiso_codigo = 'requerimientos.autorizar_metrado');
  return p_requerimiento;
end;
$$;
revoke all on function public.sustentar_insumos(uuid, jsonb) from public, anon;
grant execute on function public.sustentar_insumos(uuid, jsonb) to authenticated;

-- 7. El visto de Diseño ---------------------------------------------------------------
-- Autoriza o no los insumos que esperan su visto. No autorizar pide una nota de
-- 10 caracteres o más: quien pidió tiene que saber qué corregir. Si con esto el
-- RQ queda en regla y sigue por revisar, a Almacén le llega el aviso.
create or replace function public.autorizar_insumos(p_requerimiento uuid, p_items smallint[], p_autoriza boolean, p_nota text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_rq      public.requerimientos%rowtype;
  v_item    smallint;
  v_m       record;
  v_nota    text := nullif(btrim(coalesce(p_nota, '')), '');
  v_items   text := '';
  v_n       integer := 0;
begin
  perform public.exigir_permiso('requerimientos.autorizar_metrado');
  select * into v_rq from public.requerimientos where id = p_requerimiento for update;
  if not found then
    raise exception 'El requerimiento no existe.';
  end if;
  if v_rq.estado in ('ANULADO', 'ENTREGADO') then
    raise exception 'El requerimiento % ya está %: no espera tu visto.', v_rq.numero,
      case v_rq.estado when 'ANULADO' then 'anulado' else 'entregado' end using errcode = 'check_violation';
  end if;
  if p_autoriza is null or p_items is null or cardinality(p_items) = 0 then
    raise exception 'Elige qué insumos autorizas o no.' using errcode = 'check_violation';
  end if;
  if v_nota is not null and char_length(v_nota) > 500 then
    raise exception 'La nota pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;
  if not p_autoriza and char_length(coalesce(v_nota, '')) < 10 then
    raise exception 'Cuenta por qué no lo autorizas, en al menos 10 caracteres: quien pidió tiene que saber qué corregir.'
      using errcode = 'check_violation';
  end if;

  foreach v_item in array (select array_agg(distinct x order by x) from unnest(p_items) x) loop
    select * into v_m from public.metrado_por_linea(array[p_requerimiento]) m where m.item = v_item;
    if not found then
      raise exception 'El requerimiento % no tiene el insumo %.', v_rq.numero, v_item using errcode = 'check_violation';
    end if;
    if v_m.estado <> 'POR_AUTORIZAR' then
      raise exception 'El insumo % ya no espera tu visto%. Recarga la pantalla.', v_item,
        case v_m.estado when 'EN_METRADO' then ': ya entra en el metrado'
                        when 'AUTORIZADO' then ': ya está autorizado'
                        when 'RECHAZADO' then ': ya dijiste que no'
                        when 'SIN_SUSTENTO' then ': cambió y quien pidió tiene que sustentarlo de nuevo'
                        else '' end
        using errcode = 'check_violation';
    end if;
    update public.requerimiento_sustentos
       set decision = case when p_autoriza then 'AUTORIZADO' else 'RECHAZADO' end,
           nota_decision = v_nota, decidido_por = public.usuario_actual(), decidido_en = now()
     where id = v_m.sustento_id and decision is null;
    if not found then
      raise exception 'El insumo % ya no espera tu visto. Recarga la pantalla.', v_item using errcode = 'check_violation';
    end if;
    v_n := v_n + 1;
    v_items := v_items || case when v_items = '' then '' else ', ' end || v_item;
  end loop;

  perform public.fn_rq_avisar(v_rq,
    case when p_autoriza then 'Autorizado: ' else 'No autorizado: ' end || v_rq.numero,
    case when v_n = 1 then 'Diseño ' || case when p_autoriza then 'autorizó' else 'no autorizó' end || ' el insumo ' || v_items
         else 'Diseño ' || case when p_autoriza then 'autorizó' else 'no autorizó' end || ' los insumos ' || v_items end
      || ' que se pasaban del metrado.'
      || case when p_autoriza then '' else ' Corrige la cantidad o el material con su justificante, o anula el requerimiento.' end
      || coalesce(' Nota: ' || v_nota, ''),
    'EMISOR');

  if p_autoriza and v_rq.estado = 'POR_ATENDER'
     and not exists (select 1 from public.metrado_por_linea(array[p_requerimiento]) m
                      where m.estado not in ('NO_APLICA', 'EN_METRADO', 'AUTORIZADO')) then
    perform public.fn_rq_avisar(v_rq, 'Ya puedes revisar: ' || v_rq.numero,
      'Diseño autorizó lo que se pasaba del metrado. Revisa el stock del requerimiento.', 'ALMACEN');
  end if;
  return p_requerimiento;
end;
$$;
revoke all on function public.autorizar_insumos(uuid, smallint[], boolean, text) from public, anon;
grant execute on function public.autorizar_insumos(uuid, smallint[], boolean, text) to authenticated;

-- 8. Las puertas --------------------------------------------------------------------
-- Los insumos de un RQ que se pasan sin autorizar, como «2 y 5».
create or replace function public.insumos_fuera_de_metrado(p_requerimiento uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select string_agg(m.item::text, ', ' order by m.item)
    from public.metrado_por_linea(array[p_requerimiento]) m
   where m.estado in ('SIN_SUSTENTO', 'POR_AUTORIZAR', 'RECHAZADO');
$$;
revoke all on function public.insumos_fuera_de_metrado(uuid) from public, anon, authenticated;

-- Almacén no revisa el stock (ni lo da listo ni lo manda a comprar) de un RQ con
-- insumos que se pasan sin autorizar. Va en el cambio de estado: así vale para
-- la revisión por insumo y para las dos de antes (`rq_marcar_sin_stock`,
-- `rq_marcar_listo_en_almacen`). Y la marca `con_metrado` no cambia.
create or replace function public.fn_rq_metrado_al_revisar()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_items text;
begin
  if new.con_metrado is distinct from old.con_metrado then
    raise exception 'Si el requerimiento % va con el metrado de Diseño no cambia.', old.numero using errcode = 'check_violation';
  end if;
  if old.estado = 'POR_ATENDER' and new.estado in ('SIN_STOCK', 'LISTO_EN_ALMACEN') then
    v_items := public.insumos_fuera_de_metrado(new.id);
    if v_items is not null then
      raise exception 'El requerimiento % pide más de lo que dice el metrado de Diseño (insumo %) y Diseño todavía no lo autoriza: lo revisas cuando lo autorice.',
        old.numero, v_items using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_rq_metrado_al_revisar() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_rq_metrado_al_revisar'
                   and tgrelid = 'public.requerimientos'::regclass) then
    create trigger trg_rq_metrado_al_revisar before update on public.requerimientos
      for each row execute function public.fn_rq_metrado_al_revisar();
  end if;
end $$;

-- Logística no pone en una OC el insumo que se pasa sin autorizar (corregido
-- hacia arriba después de la revisión, por ejemplo).
create or replace function public.fn_rq_linea_metrado_al_comprar()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_estado text; v_numero text;
begin
  if old.orden_compra_id is null and new.orden_compra_id is not null then
    select m.estado into v_estado from public.metrado_por_linea(array[new.requerimiento_id]) m where m.linea_id = new.id;
    if v_estado in ('SIN_SUSTENTO', 'POR_AUTORIZAR', 'RECHAZADO') then
      select numero into v_numero from public.requerimientos where id = new.requerimiento_id;
      raise exception 'El insumo % del requerimiento % pide más de lo que dice el metrado de Diseño y Diseño todavía no lo autoriza: no va en la orden de compra.',
        new.item, v_numero using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_rq_linea_metrado_al_comprar() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_rq_linea_metrado_al_comprar'
                   and tgrelid = 'public.requerimiento_lineas'::regclass) then
    create trigger trg_rq_linea_metrado_al_comprar before update on public.requerimiento_lineas
      for each row execute function public.fn_rq_linea_metrado_al_comprar();
  end if;
end $$;
