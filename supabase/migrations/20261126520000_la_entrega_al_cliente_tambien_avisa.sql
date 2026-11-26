-- =============================================================================
-- LA FECHA DE ENTREGA AL CLIENTE TAMBIÉN AVISA; LA OT ANULADA SALE DEL TABLERO
-- -----------------------------------------------------------------------------
-- DKS lo decidió el 2026-11-26, después de unir los avisos de las 7:00 a. m.
-- (20261126315000):
--
--   1. «Sí, que los avisos de las 7:00 a. m. también avisen cuando se acerca la
--      fecha de entrega al cliente.» Hasta ahora avisaban solo las etapas; el
--      tablero ya pintaba el código en rojo por esa fecha, pero nadie se
--      enteraba sin entrar. Ahora la revisión diaria avisa la fecha
--      comprometida de la OT igual que una etapa: una vez al pasar a ámbar (a
--      Recursos Humanos), otra al vencer (también a Gerencia) y un recordatorio
--      cada 2 días hábiles mientras siga vencida, juntado en un aviso.
--
--   2. «Sí, un código cuya única OT está anulada sale del tablero y deja de
--      mandar recordatorios.» El tablero dejaba un código con etapas sin
--      terminar aunque su única OT se hubiera anulado, y la revisión lo
--      recordaba sin fin. Ahora sale. El código con etapas que todavía no
--      tiene OT (Diseño trabaja antes de la orden) sigue en el tablero; el que
--      tiene una OT anulada y otra viva, también.
--
-- Va en una migración aparte porque la 20261126315000 ya está en producción.
-- =============================================================================

-- 1. Lo avisado de una entrega se anota por código -------------------------------
alter table public.tiempos_entrega_avisos add column if not exists codigo text;
comment on column public.tiempos_entrega_avisos.codigo is
  'El código interno del aviso de la fecha de entrega al cliente (ENTREGA_*). Vacío en los avisos de etapa, que van por etapa_id.';

alter table public.tiempos_entrega_avisos drop constraint if exists ck_tiempos_entrega_aviso_tipo;
alter table public.tiempos_entrega_avisos add constraint ck_tiempos_entrega_aviso_tipo check (tipo in (
  'POR_VENCER', 'VENCIDA', 'RECORDATORIO', 'RESUMEN_SEMANAL', 'REVISION',
  'ENTREGA_POR_VENCER', 'ENTREGA_VENCIDA', 'ENTREGA_RECORDATORIO'));
-- La etapa va en los avisos de etapa; el código, en los de la entrega; ninguno
-- en el resumen y la anotación de la revisión.
alter table public.tiempos_entrega_avisos drop constraint if exists ck_tiempos_entrega_aviso_etapa;
alter table public.tiempos_entrega_avisos add constraint ck_tiempos_entrega_aviso_etapa check (
  case when tipo in ('POR_VENCER', 'VENCIDA', 'RECORDATORIO') then etapa_id is not null and codigo is null
       when tipo in ('ENTREGA_POR_VENCER', 'ENTREGA_VENCIDA', 'ENTREGA_RECORDATORIO') then etapa_id is null and codigo is not null
       else etapa_id is null and codigo is null end);

-- Un aviso de cada tipo por código y fecha comprometida; un recordatorio por día.
create unique index if not exists uq_tiempos_entrega_aviso_entrega
  on public.tiempos_entrega_avisos (codigo, tipo, fin_plan) where tipo in ('ENTREGA_POR_VENCER', 'ENTREGA_VENCIDA');
create unique index if not exists uq_tiempos_entrega_aviso_entrega_del_dia
  on public.tiempos_entrega_avisos (codigo, fecha) where tipo = 'ENTREGA_RECORDATORIO';

comment on table public.tiempos_entrega_avisos is
  'Cada aviso de tiempos de entrega que salió: de qué etapa o subetapa (un aviso por etapa de arriba anota cada una de las que cubre) o de qué código (la fecha de entrega al cliente, ENTREGA_*), de qué tipo, por qué fecha comprometida y a cuántas cuentas (en el recordatorio, las del aviso agrupado del día). Y cada revisión diaria que corrió (REVISION), para que el tablero diga cuándo fue la última. Lo escribe solo la revisión diaria. Migraciones 20261126315000 y 20261126520000.';

-- 2. El tablero sin los códigos de una OT anulada -----------------------------------
create or replace function public.tiempos_de_entrega_codigos_calculado(p_codigo text default null)
returns table (codigo text, ot_numero text, ot_estado text, cliente text, unidad text,
               fecha_entrega date, dias_habiles_entrega integer, semaforo_entrega text,
               etapas integer, etapas_terminadas integer, etapas_vencidas integer, etapas_por_vencer integer,
               etapas_sin_fecha integer, etapa_en_curso text, area_en_curso text,
               proxima_fecha date, semaforo text, ots_abiertas integer)
language sql stable set search_path to 'public' as $$
  with pedido as (
    select public.normalizar_codigo_interno(p_codigo) as codigo
  ), todas_las_ot as (
    select c.codigo, o.numero::text as numero, o.estado::text as estado, o.fecha_registro,
           cl.razon_social::text as cliente,
           nullif(concat_ws(' · ', nullif(btrim(coalesce(u.placa::text, '')), ''), tc.nombre::text), '') as unidad,
           o.fecha_entrega_comprometida as fecha_entrega
      from public.ordenes_trabajo o
      left join public.unidades u on u.id = o.unidad_id
      -- El mantenimiento y la garantía van por el número de su OT, no por el
      -- código de la unidad, que es el de su fabricación (migración 20261120500000).
      cross join lateral (select public.normalizar_codigo_interno(
                                   case when o.tipo_trabajo::text in ('MANTENIMIENTO', 'GARANTIA')
                                        then public.codigo_de_la_ot(o.numero) else u.codigo_interno end) as codigo) c
      cross join pedido q
      left join public.clientes cl on cl.id = o.cliente_id
      left join public.tipos_carroceria tc on tc.id = u.tipo_carroceria_id
     where c.codigo is not null
       and (q.codigo is null or c.codigo = q.codigo)
  ), de_ot as (
    select * from todas_las_ot t where t.estado <> 'ANULADA'
  ), anulado as (
    -- Todas sus OT están anuladas: el código sale del tablero aunque le queden
    -- etapas sin terminar (DKS, 2026-11-26). Sin ninguna OT no es anulado: Diseño
    -- trabaja antes de la orden.
    select t.codigo from todas_las_ot t group by t.codigo having bool_and(t.estado = 'ANULADA')
  ), ot as (
    -- Con dos OT abiertas para el mismo código manda la que se entrega antes.
    select distinct on (d.codigo) d.codigo, d.numero, d.estado, d.cliente, d.unidad, d.fecha_entrega,
           count(*) over (partition by d.codigo)::integer as abiertas
      from de_ot d
     where d.estado not in ('ENTREGADA', 'FACTURADA')
     order by d.codigo, d.fecha_entrega nulls last, d.fecha_registro nulls last, d.numero
  ), entregado as (
    -- Ya se entregó o facturó y no le queda ninguna OT abierta.
    select distinct d.codigo
      from de_ot d
     where d.estado in ('ENTREGADA', 'FACTURADA')
       and not exists (select 1 from ot o where o.codigo = d.codigo)
  ), etapa as (
    select e.id, e.codigo, e.orden, e.nombre, e.area, e.padre_id, e.fin_plan, e.inicio_real, e.fin_real, e.semaforo
      from public.tiempos_de_entrega_etapas_calculado(p_codigo) e
  ), por_codigo as (
    select e.codigo,
           count(*) filter (where e.padre_id is null)::integer as etapas,
           count(*) filter (where e.padre_id is null and e.fin_real is not null)::integer as terminadas,
           count(*) filter (where e.padre_id is null and e.semaforo = 'SIN_FECHA')::integer as sin_fecha,
           count(*) filter (where e.fin_real is null)::integer as pendientes,
           min(e.fin_plan) filter (where e.fin_real is null) as proxima
      from etapa e
     group by e.codigo
  ), por_etapa as (
    -- Cada etapa de arriba con lo peor de ella y de sus subetapas.
    select e.codigo, coalesce(e.padre_id, e.id) as raiz,
           bool_or(e.semaforo = 'ROJO') as rojo, bool_or(e.semaforo = 'AMBAR') as ambar
      from etapa e
     group by e.codigo, coalesce(e.padre_id, e.id)
  ), plazos as (
    select g.codigo,
           count(*) filter (where g.rojo)::integer as vencidas,
           count(*) filter (where g.ambar and not g.rojo)::integer as por_vencer
      from por_etapa g
     group by g.codigo
  ), en_curso as (
    -- La etapa de arriba en que va: la empezada sin terminar; si ninguna, la primera sin terminar.
    select distinct on (e.codigo) e.codigo, e.nombre, e.area
      from etapa e
     where e.padre_id is null and e.fin_real is null
     order by e.codigo, (e.inicio_real is null), e.orden
  ), codigos as (
    select o.codigo from ot o
    union
    select p.codigo from por_codigo p
     where p.pendientes > 0
       and not exists (select 1 from entregado x where x.codigo = p.codigo)
       and not exists (select 1 from anulado x where x.codigo = p.codigo)
  )
  select c.codigo, o.numero, o.estado, o.cliente, o.unidad,
         o.fecha_entrega,
         case when o.fecha_entrega is not null then public.dias_habiles_entre(current_date, o.fecha_entrega) end,
         public.semaforo_de_fecha(o.fecha_entrega),
         coalesce(p.etapas, 0), coalesce(p.terminadas, 0), coalesce(z.vencidas, 0), coalesce(z.por_vencer, 0),
         coalesce(p.sin_fecha, 0), k.nombre, k.area,
         p.proxima,
         case
           when coalesce(z.vencidas, 0) > 0 or public.semaforo_de_fecha(o.fecha_entrega) = 'ROJO' then 'ROJO'
           when coalesce(z.por_vencer, 0) > 0 or public.semaforo_de_fecha(o.fecha_entrega) = 'AMBAR' then 'AMBAR'
           when p.proxima is not null or o.fecha_entrega is not null then 'VERDE'
           else 'SIN_FECHA'
         end,
         coalesce(o.abiertas, 0)
    from codigos c
    left join ot o on o.codigo = c.codigo
    left join por_codigo p on p.codigo = c.codigo
    left join plazos z on z.codigo = c.codigo
    left join en_curso k on k.codigo = c.codigo
   order by c.codigo;
$$;
comment on function public.tiempos_de_entrega_codigos_calculado(text) is
  'El cálculo de tiempos_de_entrega_codigos, sin permiso: lo llaman el envoltorio y la revisión diaria de avisos. Cerrado a authenticated.';
revoke all on function public.tiempos_de_entrega_codigos_calculado(text) from public, anon, authenticated;

-- 3. La fecha de entrega al cliente --------------------------------------------------
-- La fecha comprometida de la OT que manda en el código (la que el tablero
-- muestra). Avisa a Recursos Humanos al pasar a ámbar; al vencer, también a
-- Gerencia. La entrega no es de un área: el supervisor ya se entera por sus
-- etapas. La OT de un lote de prueba no avisa.
create or replace function public.revisar_entregas_al_cliente(p_hoy date)
returns table (tipo text, avisos integer, cuentas integer)
language plpgsql security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_hoy date := coalesce(p_hoy, current_date);
  c record;
  v_de text;
  v_n integer;
  v_ultimo date;
  v_recordar text[] := '{}';
  v_por_vencer integer := 0; v_c_por_vencer integer := 0;
  v_vencidas integer := 0;   v_c_vencidas integer := 0;
  v_c_record integer := 0;
begin
  for c in
    select x.codigo, x.ot_numero, x.cliente, x.fecha_entrega, x.dias_habiles_entrega, x.semaforo_entrega, o.id as ot_id
      from public.tiempos_de_entrega_codigos_calculado(null) x
      join public.ordenes_trabajo o on o.numero = x.ot_numero
     where x.semaforo_entrega in ('AMBAR', 'ROJO')
       and not exists (select 1 from public.pruebas_filas f where f.tabla = 'ordenes_trabajo' and f.fila_id = o.id)
     order by x.codigo
  loop
    v_de := 'La entrega' || coalesce(' a ' || c.cliente, '') || ' (OT ' || c.ot_numero || ')';

    if c.semaforo_entrega = 'AMBAR' then
      continue when exists (select 1 from public.tiempos_entrega_avisos a
                             where a.codigo = c.codigo and a.tipo = 'ENTREGA_POR_VENCER' and a.fin_plan = c.fecha_entrega);
      v_n := public.avisar_tiempos_de_entrega(null, c.codigo,
               'Entrega por vencer: ' || c.codigo,
               v_de || case when c.fecha_entrega = v_hoy then ' es hoy.'
                            when c.fecha_entrega = v_hoy + 1 then ' es mañana.'
                            else ' es el ' || to_char(c.fecha_entrega, 'DD/MM/YYYY') || ', en ' || c.dias_habiles_entrega
                                 || case when c.dias_habiles_entrega = 1 then ' día hábil.' else ' días hábiles.' end end,
               'ordenes_trabajo', c.ot_id, false);
      insert into public.tiempos_entrega_avisos (codigo, tipo, fin_plan, fecha, avisados)
      values (c.codigo, 'ENTREGA_POR_VENCER', c.fecha_entrega, v_hoy, v_n)
      on conflict do nothing;
      v_por_vencer := v_por_vencer + 1; v_c_por_vencer := v_c_por_vencer + v_n;

    elsif not exists (select 1 from public.tiempos_entrega_avisos a
                       where a.codigo = c.codigo and a.tipo = 'ENTREGA_VENCIDA' and a.fin_plan = c.fecha_entrega) then
      v_n := public.avisar_tiempos_de_entrega(null, c.codigo,
               'Entrega vencida: ' || c.codigo,
               v_de || ' venció el ' || to_char(c.fecha_entrega, 'DD/MM/YYYY') || ' y la unidad no se ha entregado.',
               'ordenes_trabajo', c.ot_id, true);
      insert into public.tiempos_entrega_avisos (codigo, tipo, fin_plan, fecha, avisados)
      values (c.codigo, 'ENTREGA_VENCIDA', c.fecha_entrega, v_hoy, v_n)
      on conflict do nothing;
      v_vencidas := v_vencidas + 1; v_c_vencidas := v_c_vencidas + v_n;

    else
      select max(a.fecha) into v_ultimo from public.tiempos_entrega_avisos a
       where a.codigo = c.codigo and a.fin_plan = c.fecha_entrega and a.tipo in ('ENTREGA_VENCIDA', 'ENTREGA_RECORDATORIO');
      continue when public.sumar_dias_habiles(v_ultimo, 2) > v_hoy;
      insert into public.tiempos_entrega_avisos (codigo, tipo, fin_plan, fecha, avisados)
      values (c.codigo, 'ENTREGA_RECORDATORIO', c.fecha_entrega, v_hoy, 0)
      on conflict do nothing;
      v_recordar := v_recordar || c.codigo;
    end if;
  end loop;

  -- Las que siguen vencidas, en un solo aviso a Recursos Humanos (quien lleva los
  -- tiempos), con el tablero en «Vencidos». No a Gerencia: ya supo al vencer.
  if cardinality(v_recordar) > 0 then
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id, creado_en)
    select u.id,
           case when cardinality(v_recordar) = 1 then 'Sigue vencida la entrega: ' || v_recordar[1]
                else 'Siguen vencidas ' || cardinality(v_recordar) || ' entregas' end,
           case when cardinality(v_recordar) = 1 then 'La entrega al cliente de ' || v_recordar[1] || ' sigue vencida'
                else 'Las entregas al cliente de ' || array_to_string(v_recordar, ', ') || ' siguen vencidas' end
             || '. Se recuerda cada 2 días hábiles hasta que se entregue la unidad o cambie la fecha comprometida.',
           '/rrhh/tiempos-de-entrega?ver=vencidos', 'tiempos_entrega_avisos', null, clock_timestamp()
      from public.usuarios u
     where u.activo
       and exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id
                     and rp.permiso_codigo = 'rrhh.tiempos_entrega_asignar');
    get diagnostics v_c_record = row_count;
    update public.tiempos_entrega_avisos a set avisados = v_c_record
     where a.tipo = 'ENTREGA_RECORDATORIO' and a.fecha = v_hoy and a.codigo = any (v_recordar);
  end if;

  return query values
    ('ENTREGA_POR_VENCER', v_por_vencer, v_c_por_vencer),
    ('ENTREGA_VENCIDA', v_vencidas, v_c_vencidas),
    ('ENTREGA_RECORDATORIO', cardinality(v_recordar), v_c_record);
end;
$$;
comment on function public.revisar_entregas_al_cliente(date) is
  'La parte de la revisión diaria que avisa la fecha de entrega al cliente: al pasar a ámbar (a Recursos Humanos), al vencer (también a Gerencia) y cada 2 días hábiles mientras siga vencida, en un solo aviso. La llama solo revisar_tiempos_de_entrega. Migración 20261126520000.';
revoke all on function public.revisar_entregas_al_cliente(date) from public, anon, authenticated;

-- 4. La revisión diaria, con la entrega ---------------------------------------------
-- La misma de la 20261126315000; solo suma la fecha de entrega al cliente
-- (después de las etapas, el mismo día laborable) y la cuenta en lo que
-- devuelve y en la anotación de la corrida.
create or replace function public.revisar_tiempos_de_entrega(p_hoy date default current_date)
returns table (tipo text, avisos integer, cuentas integer)
language plpgsql security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_hoy date := coalesce(p_hoy, current_date);
  e record;
  v_quien text;
  v_lleva text;
  v_nuevas text;
  v_cuando text;
  v_ultimo date;
  v_n integer;
  v_recordar uuid[] := '{}';
  v_recordar_cubre uuid[] := '{}';
  v_por_vencer integer := 0; v_c_por_vencer integer := 0;
  v_vencidas integer := 0;   v_c_vencidas integer := 0;
  v_record integer := 0;     v_c_record integer := 0;
  v_resumen integer := 0;    v_c_resumen integer := 0;
  r_vencidos integer; r_por_vencer integer; r_sin_persona integer;
  v_ent record;
  v_entrega_por_vencer integer := 0; v_c_entrega_por_vencer integer := 0;
  v_entrega_vencidas integer := 0;   v_c_entrega_vencidas integer := 0;
  v_entrega_record integer := 0;     v_c_entrega_record integer := 0;
begin
  -- Dos corridas a la vez (la de pg_cron y una a mano) no se duplican: la
  -- segunda espera a la primera y ya encuentra todo anotado.
  perform pg_advisory_xact_lock(hashtext('revisar_tiempos_de_entrega'));

  -- Cada corrida queda anotada, avise o no: el tablero dice cuándo fue la última.
  insert into public.tiempos_entrega_avisos (etapa_id, tipo, fin_plan, fecha, avisados)
  values (null, 'REVISION', null, v_hoy, 0)
  on conflict (fecha) where tipo = 'REVISION' do update set actualizado_en = now();

  -- Solo en día laborable: el domingo y el feriado no hay a quién llamar.
  if not public.es_laborable(v_hoy) then
    return;
  end if;

  for e in
    with por_entregar as materialized (
      select c.codigo from public.tiempos_de_entrega_codigos_calculado(null) c
    ), pendientes as (
      select t.*, coalesce(t.padre_id, t.id) as raiz
        from public.tiempos_de_entrega_etapas_calculado(null) t
        join por_entregar pe on pe.codigo = t.codigo
       where t.fin_real is null and t.semaforo in ('AMBAR', 'ROJO')
         -- La etapa de un lote de prueba no avisa: su aviso colgaría de ella y
         -- `pruebas_limpiar` ya no podría llevársela.
         and not exists (select 1 from public.pruebas_filas f where f.tabla = 'codigo_etapas' and f.fila_id = t.id)
    ), peor as (
      -- Por etapa de arriba, la que vence antes entre ella y sus subetapas.
      -- Y cuáles cubre el aviso: todas las del mismo color que la peor. Lo ya
      -- avisado se anota por cada una con su fecha, no por la de arriba: si la
      -- peor se termina, la que queda ya estaba avisada y no vuelve a salir.
      select distinct on (p.raiz) p.*,
             (select array_agg(q.id order by q.id) from pendientes q
               where q.raiz = p.raiz and q.semaforo = p.semaforo) as cubre,
             (select array_agg(q.fin_plan order by q.id) from pendientes q
               where q.raiz = p.raiz and q.semaforo = p.semaforo) as cubre_fin
        from pendientes p
       order by p.raiz, p.fin_plan, p.orden
    )
    select w.raiz as id, w.codigo, r.nombre as etapa, r.orden,
           case when w.id <> w.raiz then w.nombre end as subetapa,
           w.area_id, w.area, w.fin_plan, w.semaforo, w.dias_habiles, w.cubre, w.cubre_fin,
           coalesce(
             (select tr.apellidos || ', ' || tr.nombres from public.etapa_responsables er
                join public.trabajadores tr on tr.id = er.trabajador_id and tr.activo
               where er.etapa_id = w.id and er.quitado_en is null),
             (select tr.apellidos || ', ' || tr.nombres from public.etapa_responsables er
                join public.trabajadores tr on tr.id = er.trabajador_id and tr.activo
               where er.etapa_id = w.raiz and er.quitado_en is null)) as lleva
      from peor w
      join public.codigo_etapas r on r.id = w.raiz
     order by w.codigo, r.orden
  loop
    -- «y N más» cuenta solo las del mismo color: en un aviso de vencida, las vencidas.
    v_lleva := coalesce('La lleva ' || e.lleva || '.', 'Nadie la tiene a cargo todavía.');
    v_quien := v_lleva
      || case when e.subetapa is not null
              then ' Por la subetapa «' || e.subetapa || '»'
                   || case when cardinality(e.cubre) > 1 then ' y ' || (cardinality(e.cubre) - 1) || ' más' else '' end || '.'
              else '' end;

    if e.semaforo = 'AMBAR' then
      -- Ya avisada si cada una de las que cubre ya se avisó con su fecha.
      continue when not exists (select 1 from unnest(e.cubre, e.cubre_fin) c(id, fin)
                                 where not exists (select 1 from public.tiempos_entrega_avisos a
                                                    where a.etapa_id = c.id and a.tipo = 'POR_VENCER' and a.fin_plan = c.fin));
      v_cuando := case when e.fin_plan = v_hoy then 'Vence hoy'
                       when e.fin_plan = v_hoy + 1 then 'Vence mañana'
                       else 'Vence el ' || to_char(e.fin_plan, 'DD/MM/YYYY') || ', en ' || e.dias_habiles
                            || case when e.dias_habiles = 1 then ' día hábil' else ' días hábiles' end end;
      v_n := public.avisar_tiempos_de_entrega(e.area_id, e.codigo,
               'Por vencer: ' || e.codigo || ' · ' || e.etapa,
               v_cuando || coalesce(' (' || e.area || ')', '') || '. ' || v_quien,
               'codigo_etapas', e.id, false);
      insert into public.tiempos_entrega_avisos (etapa_id, tipo, fin_plan, fecha, avisados)
      select c.id, 'POR_VENCER', c.fin, v_hoy, v_n from unnest(e.cubre, e.cubre_fin) c(id, fin)
      on conflict do nothing;
      v_por_vencer := v_por_vencer + 1; v_c_por_vencer := v_c_por_vencer + v_n;

    elsif exists (select 1 from unnest(e.cubre, e.cubre_fin) c(id, fin)
                   where not exists (select 1 from public.tiempos_entrega_avisos a
                                      where a.etapa_id = c.id and a.tipo = 'VENCIDA' and a.fin_plan = c.fin)) then
      -- Recién vencida (ella o una subetapa que no se había avisado): también a
      -- Gerencia. Si la etapa ya estaba avisada por otra, el aviso nombra la que
      -- es noticia, no repite el texto del anterior.
      select string_agg('«' || s.nombre || '» el ' || to_char(c.fin, 'DD/MM/YYYY'), ', ' order by c.fin, s.orden)
        into v_nuevas
        from unnest(e.cubre, e.cubre_fin) c(id, fin)
        join public.codigo_etapas s on s.id = c.id
       where not exists (select 1 from public.tiempos_entrega_avisos a
                          where a.etapa_id = c.id and a.tipo = 'VENCIDA' and a.fin_plan = c.fin);
      v_n := public.avisar_tiempos_de_entrega(e.area_id, e.codigo,
               'Vencida: ' || e.codigo || ' · ' || e.etapa,
               case when exists (select 1 from unnest(e.cubre, e.cubre_fin) c(id, fin)
                                   join public.tiempos_entrega_avisos a
                                     on a.etapa_id = c.id and a.tipo = 'VENCIDA' and a.fin_plan = c.fin)
                    then 'También venció ' || v_nuevas || coalesce(' (' || e.area || ')', '') || '. ' || v_lleva
                    else 'Venció el ' || to_char(e.fin_plan, 'DD/MM/YYYY') || coalesce(' (' || e.area || ')', '') || '. ' || v_quien
               end,
               'codigo_etapas', e.id, true);
      insert into public.tiempos_entrega_avisos (etapa_id, tipo, fin_plan, fecha, avisados)
      select c.id, 'VENCIDA', c.fin, v_hoy, v_n from unnest(e.cubre, e.cubre_fin) c(id, fin)
      on conflict do nothing;
      v_vencidas := v_vencidas + 1; v_c_vencidas := v_c_vencidas + v_n;

    else
      -- Sigue vencida: toca recordarla cada 2 días hábiles desde el último aviso.
      select max(a.fecha) into v_ultimo
        from public.tiempos_entrega_avisos a
        join unnest(e.cubre, e.cubre_fin) c(id, fin) on c.id = a.etapa_id and c.fin = a.fin_plan
       where a.tipo in ('VENCIDA', 'RECORDATORIO');
      continue when public.sumar_dias_habiles(v_ultimo, 2) > v_hoy;
      insert into public.tiempos_entrega_avisos (etapa_id, tipo, fin_plan, fecha, avisados)
      select c.id, 'RECORDATORIO', c.fin, v_hoy, 0 from unnest(e.cubre, e.cubre_fin) c(id, fin)
      on conflict do nothing;
      v_recordar := v_recordar || e.id;
      v_recordar_cubre := v_recordar_cubre || e.cubre;
    end if;
  end loop;

  -- Los recordatorios, uno por cuenta: a Recursos Humanos todos, con el
  -- tablero en «Vencidos»; al supervisor, los de su área, con «Planos».
  if cardinality(v_recordar) > 0 then
    with recordadas as (
      select r.id, r.codigo_interno as codigo, coalesce(
               (select s.area_id from public.codigo_etapas s
                 where (s.id = r.id or s.padre_id = r.id) and s.quitada_en is null and s.fin_real is null
                 order by s.fin_plan nulls last limit 1), r.area_id) as area_id
        from public.codigo_etapas r where r.id = any (v_recordar)
    ), destino as (
      select u.id as usuario_id, x.asigna, d.id as etapa_id, d.codigo
        from public.usuarios u
        cross join lateral (
          select exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id
                            and rp.permiso_codigo = 'rrhh.tiempos_entrega_asignar') as asigna,
                 exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id
                            and rp.permiso_codigo = 'codigos_internos.area') as supervisa,
                 exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id
                            and rp.permiso_codigo = 'produccion.cualquier_area') as todas
        ) x
        join recordadas d on x.asigna or (x.supervisa and (x.todas or u.area_id = d.area_id))
       where u.activo
    )
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    select d.usuario_id,
           case when count(*) = 1 then 'Sigue vencida: ' || min(d.codigo)
                else 'Siguen vencidas: ' || count(*) || ' etapas' end,
           count(*) || case when count(*) = 1 then ' etapa sigue vencida' else ' etapas siguen vencidas' end
             || case when count(distinct d.codigo) = 1 then ', en ' || min(d.codigo)
                     else ' en ' || count(distinct d.codigo) || ' códigos: ' || string_agg(distinct d.codigo, ', ') end
             || '. Se recuerda cada 2 días hábiles hasta que se marque o Diseño cambie la fecha.',
           case when bool_or(d.asigna) then '/rrhh/tiempos-de-entrega?ver=vencidos' else '/planos' end,
           'tiempos_entrega_avisos', null
      from destino d
     group by d.usuario_id;
    get diagnostics v_c_record = row_count;
    v_record := cardinality(v_recordar);
    update public.tiempos_entrega_avisos a set avisados = v_c_record
     where a.tipo = 'RECORDATORIO' and a.fecha = v_hoy and a.etapa_id = any (v_recordar_cubre);
  end if;

  -- La fecha de entrega al cliente de cada código (migración 20261126520000).
  for v_ent in select * from public.revisar_entregas_al_cliente(v_hoy) loop
    if v_ent.tipo = 'ENTREGA_POR_VENCER' then v_entrega_por_vencer := v_ent.avisos; v_c_entrega_por_vencer := v_ent.cuentas;
    elsif v_ent.tipo = 'ENTREGA_VENCIDA' then v_entrega_vencidas := v_ent.avisos; v_c_entrega_vencidas := v_ent.cuentas;
    else v_entrega_record := v_ent.avisos; v_c_entrega_record := v_ent.cuentas; end if;
  end loop;

  -- El resumen de la semana, a Gerencia (quien consulta los tiempos sin
  -- asignar): el primer día laborable de la semana, el lunes si no es feriado.
  if not exists (select 1 from generate_series((v_hoy - (extract(isodow from v_hoy)::int - 1))::timestamp, v_hoy - 1, interval '1 day') d
                  where public.es_laborable(d::date))
     and not exists (select 1 from public.tiempos_entrega_avisos a
                      where a.tipo = 'RESUMEN_SEMANAL' and a.fecha = v_hoy) then
    select count(*) filter (where c.semaforo = 'ROJO'), count(*) filter (where c.semaforo = 'AMBAR')
      into r_vencidos, r_por_vencer
      from public.tiempos_de_entrega_codigos_calculado(null) c;
    select count(*) into r_sin_persona
      from public.tiempos_de_entrega_etapas_calculado(null) t
      join public.tiempos_de_entrega_codigos_calculado(null) c on c.codigo = t.codigo
     where t.fin_real is null and t.padre_id is null
       and not exists (select 1 from public.pruebas_filas f where f.tabla = 'codigo_etapas' and f.fila_id = t.id)
       and not exists (select 1 from public.etapa_responsables r
                         join public.trabajadores tr on tr.id = r.trabajador_id and tr.activo
                        where r.etapa_id = t.id and r.quitado_en is null);

    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    select u.id, 'Resumen de la semana: tiempos de entrega',
           case when r_vencidos + r_por_vencer = 0 then 'Ningún código vencido ni por vencer.'
                else r_vencidos || case when r_vencidos = 1 then ' código vencido' else ' códigos vencidos' end
                     || ' y ' || r_por_vencer || ' por vencer.' end
           || case when r_sin_persona > 0
                   then ' ' || r_sin_persona || case when r_sin_persona = 1 then ' etapa sigue' else ' etapas siguen' end || ' sin nadie a cargo.'
                   else '' end,
           '/rrhh/tiempos-de-entrega', 'tiempos_entrega_avisos', null
      from public.usuarios u
     where u.activo
       and exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id and rp.permiso_codigo = 'rrhh.tiempos_entrega')
       and not exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id and rp.permiso_codigo = 'rrhh.tiempos_entrega_asignar');
    get diagnostics v_n = row_count;
    insert into public.tiempos_entrega_avisos (etapa_id, tipo, fin_plan, fecha, avisados)
    values (null, 'RESUMEN_SEMANAL', null, v_hoy, v_n);
    v_resumen := 1; v_c_resumen := v_n;
  end if;

  update public.tiempos_entrega_avisos a
     set avisados = v_c_por_vencer + v_c_vencidas + v_c_record + v_c_resumen
                  + v_c_entrega_por_vencer + v_c_entrega_vencidas + v_c_entrega_record
   where a.tipo = 'REVISION' and a.fecha = v_hoy;

  return query values
    ('POR_VENCER', v_por_vencer, v_c_por_vencer),
    ('VENCIDA', v_vencidas, v_c_vencidas),
    ('RECORDATORIO', v_record, v_c_record),
    ('RESUMEN_SEMANAL', v_resumen, v_c_resumen),
    ('ENTREGA_POR_VENCER', v_entrega_por_vencer, v_c_entrega_por_vencer),
    ('ENTREGA_VENCIDA', v_entrega_vencidas, v_c_entrega_vencidas),
    ('ENTREGA_RECORDATORIO', v_entrega_record, v_c_entrega_record);
end;
$$;
comment on function public.revisar_tiempos_de_entrega(date) is
  'La revisión diaria de los tiempos de entrega (7:00 a. m. de Lima, día laborable): por cada etapa de arriba, con lo peor de ella y de sus subetapas, avisa cuando pasa a ámbar y cuando vence (también a Gerencia); recuerda cada 2 días hábiles las que siguen vencidas, en un solo aviso por cuenta; avisa igual la fecha de entrega al cliente (revisar_entregas_al_cliente); y el primer día laborable de la semana manda el resumen a Gerencia. No repite: anota cada aviso, y cada corrida, en tiempos_entrega_avisos. La corre pg_cron; cerrada a la gente.';
revoke all on function public.revisar_tiempos_de_entrega(date) from public, anon, authenticated;
