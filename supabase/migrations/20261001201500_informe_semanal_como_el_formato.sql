-- =============================================================================
-- EL INFORME SEMANAL DE DISEÑO CON LOS DATOS DEL FORMATO MW-IF-DI-01
-- -----------------------------------------------------------------------------
-- El informe semanal lo llena el colaborador de Diseño y la empresa pidió
-- comprobar que el sistema le pida los mismos datos que su formato de Word
-- «Informe semanal – Área de Ingeniería» (MW-IF-DI-01, versión 1.0, revisado
-- el 30/05/2026). Al compararlo con el informe N.º 021 faltaban cuatro cosas:
--
-- 1. Las tareas del formato. Diseño registra «modelado 3D», «creación de plano
--    de corte DXF», «inicio de ensamble 3D», «modificación de modelo» y
--    «modificación de planos»; el sistema solo tenía modelado, ploteo, creación
--    de plano, revisión, soporte y otra.
-- 2. El avance de planos. Cada fila del formato es un entregable con su
--    número de planos, su número de piezas, el tipo de plano, la fecha, el
--    estado y el responsable, y la conclusión suma los planos entregados a
--    cada área («160 planos entregados a Maestranza»). El sistema solo listaba
--    versiones de PDF aprobadas, con «1» plano y sin piezas. Ahora el
--    colaborador lo registra en `diseno_entregas_planos`, por semana.
-- 3. El código interno y el tipo de carrocería. El formato identifica cada
--    trabajo por el código interno de la unidad y la OT
--    («COM_CM_N2_1_26/43/2922») y por CM (carrocería montada) o SR
--    (semirremolque). El colaborador no lee `unidades`; la función
--    `identificacion_ot_diseno` le da solo eso, de las OT que ya puede ver.
-- 4. El número. La serie es la de la empresa: el último informe en Word fue el
--    N.º 021, de la semana del 21/09/2026. El sistema empezaba en el 1; ahora
--    sigue en el 022, y no abre semanas que ya se hicieron en papel.
--
-- Además, lo que el colaborador registró se puede corregir mientras el informe
-- de esa semana no se haya enviado: quitar una tarea o una entrega mal
-- cargada. Enviado, la semana queda cerrada; la copia que recibe Diseño (y
-- Administración) lleva ahora también el código, el tipo y las entregas.
--
-- En producción no había tareas ni informes (0 filas): nada que migrar.
-- =============================================================================

-- 1. Las tareas que usa el formato --------------------------------------------
alter table public.diseno_tareas drop constraint if exists diseno_tareas_tipo_check;
alter table public.diseno_tareas add constraint diseno_tareas_tipo_check check (tipo in (
  'MODELADO', 'MODELADO_3D', 'PLOTEO', 'MODELADO_Y_PLOTEO', 'CREACION_PLANO', 'PLANO_CORTE_DXF',
  'ENSAMBLE_3D', 'MODIFICACION_MODELO', 'MODIFICACION_PLANO', 'REVISION', 'SOPORTE', 'OTRA'));
alter table public.diseno_tareas add column if not exists actualizado_en timestamptz not null default now();

select public.activar_timestamps('diseno_tareas');
select public.activar_auditoria('diseno_tareas');
select public.activar_registro_de_prueba('diseno_tareas');

-- El colaborador corrige lo suyo: quitar o cambiar una tarea que cargó mal. Si
-- la semana ya se envió, el disparador de abajo lo impide.
drop policy if exists diseno_tareas_editar on public.diseno_tareas;
create policy diseno_tareas_editar on public.diseno_tareas
  for update to authenticated
  using ((select public.es_admin()) or (creado_por = (select auth.uid()) and (select public.tiene_permiso('diseno.preparar_informe'))))
  with check (
    (select public.es_admin())
    or (creado_por = (select auth.uid()) and (select public.tiene_permiso('diseno.preparar_informe'))
        and exists (select 1 from public.ot_equipo_diseno e
                     where e.id = integrante_id and e.orden_id = diseno_tareas.orden_id and e.funcion = 'COLABORADOR'))
  );
drop policy if exists diseno_tareas_borrar on public.diseno_tareas;
create policy diseno_tareas_borrar on public.diseno_tareas
  for delete to authenticated
  using ((select public.es_admin()) or (creado_por = (select auth.uid()) and (select public.tiene_permiso('diseno.preparar_informe'))));
grant update, delete on public.diseno_tareas to authenticated;

-- 2. Avance de planos o culminación -------------------------------------------
-- Una fila por entregable, como en el formato. `entregado_a` son las áreas que
-- recibieron los planos (Maestranza, Producción, Acabados) por su código de
-- `areas`; la conclusión del informe suma `n_planos` por área.
create table if not exists public.diseno_entregas_planos (
  id             uuid primary key default gen_random_uuid(),
  semana_inicio  date not null check (extract(isodow from semana_inicio) = 1),
  orden_id       uuid not null references public.ordenes_trabajo(id) on delete restrict,
  integrante_id  uuid not null,
  tipo_plano     text not null check (length(btrim(tipo_plano)) between 2 and 200),
  n_planos       integer not null check (n_planos between 1 and 999),
  n_piezas       integer not null default 0 check (n_piezas between 0 and 9999),
  fecha_entrega  date,
  estado         text not null default 'CULMINADO' check (estado in ('CULMINADO', 'EN_PROCESO')),
  entregado_a    text[] not null default '{}' check (entregado_a <@ array['MTZ', 'PRD', 'ACB']::text[]),
  creado_por     uuid not null default public.usuario_actual() references public.usuarios(id),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint fk_diseno_entrega_integrante_orden foreign key (integrante_id, orden_id)
    references public.ot_equipo_diseno(id, orden_id) on delete restrict,
  constraint ck_diseno_entrega_fecha check (fecha_entrega is null or fecha_entrega between semana_inicio and semana_inicio + 6),
  constraint ck_diseno_entrega_culminada check (estado = 'EN_PROCESO' or cardinality(entregado_a) >= 1)
);
-- La pantalla y el informe leen por semana. El de integrante cumple (c): un
-- integrante se puede quitar del equipo de la OT y la llave con `restrict` lo
-- busca aquí. Ni la OT ni el autor se borran en ningún flujo: sin índice.
create index if not exists ix_diseno_entregas_semana on public.diseno_entregas_planos(semana_inicio, creado_en);
create index if not exists ix_diseno_entregas_integrante on public.diseno_entregas_planos(integrante_id);

alter table public.diseno_entregas_planos enable row level security;
select public.activar_timestamps('diseno_entregas_planos');
select public.activar_auditoria('diseno_entregas_planos');
select public.activar_registro_de_prueba('diseno_entregas_planos');

-- Quien ve las tareas ve las entregas; quien registra tareas registra entregas.
drop policy if exists diseno_entregas_ver on public.diseno_entregas_planos;
create policy diseno_entregas_ver on public.diseno_entregas_planos
  for select to authenticated
  using (((select public.tiene_permiso('diseno.planos')) or (select public.tiene_permiso('diseno.subir_pdf'))
          or (select public.tiene_permiso('supervision.general')))
         and public.puede_ver_orden(orden_id));
drop policy if exists diseno_entregas_crear on public.diseno_entregas_planos;
create policy diseno_entregas_crear on public.diseno_entregas_planos
  for insert to authenticated
  with check (creado_por = (select auth.uid()) and (select public.tiene_permiso('diseno.preparar_informe'))
              and public.puede_ver_orden(orden_id)
              and exists (select 1 from public.ot_equipo_diseno e
                           where e.id = integrante_id and e.orden_id = diseno_entregas_planos.orden_id and e.funcion = 'COLABORADOR'));
drop policy if exists diseno_entregas_editar on public.diseno_entregas_planos;
create policy diseno_entregas_editar on public.diseno_entregas_planos
  for update to authenticated
  using ((select public.es_admin()) or (creado_por = (select auth.uid()) and (select public.tiene_permiso('diseno.preparar_informe'))))
  with check (
    (select public.es_admin())
    or (creado_por = (select auth.uid()) and (select public.tiene_permiso('diseno.preparar_informe'))
        and exists (select 1 from public.ot_equipo_diseno e
                     where e.id = integrante_id and e.orden_id = diseno_entregas_planos.orden_id and e.funcion = 'COLABORADOR'))
  );
drop policy if exists diseno_entregas_borrar on public.diseno_entregas_planos;
create policy diseno_entregas_borrar on public.diseno_entregas_planos
  for delete to authenticated
  using ((select public.es_admin()) or (creado_por = (select auth.uid()) and (select public.tiene_permiso('diseno.preparar_informe'))));

revoke all on public.diseno_entregas_planos from public, anon, authenticated;
grant select, insert, update, delete on public.diseno_entregas_planos to authenticated;

-- 3. Una semana enviada queda cerrada -----------------------------------------
-- Lo que se registra después de enviar no entraría en la copia enviada y
-- quedaría como si nada: se rechaza con el motivo. Para corregir, Diseño
-- devuelve el informe (OBSERVADO) y la semana se vuelve a abrir.
create or replace function public.proteger_semana_informe_diseno()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_semanas date[] := '{}';
  v_cerrada date;
begin
  if tg_table_name = 'diseno_tareas' then
    if tg_op in ('UPDATE', 'DELETE') then
      v_semanas := v_semanas || array(select generate_series(date_trunc('week', old.fecha_inicio::timestamp), date_trunc('week', old.fecha_entrega::timestamp), interval '7 days')::date);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      v_semanas := v_semanas || array(select generate_series(date_trunc('week', new.fecha_inicio::timestamp), date_trunc('week', new.fecha_entrega::timestamp), interval '7 days')::date);
    end if;
  else
    if tg_op in ('UPDATE', 'DELETE') then v_semanas := v_semanas || old.semana_inicio; end if;
    if tg_op in ('INSERT', 'UPDATE') then v_semanas := v_semanas || new.semana_inicio; end if;
  end if;

  select i.semana_inicio into v_cerrada
    from public.diseno_informes i
   where i.semana_inicio = any(v_semanas)
     and i.estado in ('EN_REVISION', 'APROBADO', 'RECIBIDO')
   order by i.semana_inicio
   limit 1;
  if v_cerrada is not null then
    raise exception 'El informe de la semana del % ya se envió: lo registrado queda como se envió. Si falta o sobra algo, Diseño tiene que devolver el informe.',
      to_char(v_cerrada, 'DD/MM/YYYY');
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.proteger_semana_informe_diseno() from public, anon, authenticated;

drop trigger if exists trg_proteger_semana_tarea on public.diseno_tareas;
create trigger trg_proteger_semana_tarea
  before insert or update or delete on public.diseno_tareas
  for each row execute function public.proteger_semana_informe_diseno();
drop trigger if exists trg_proteger_semana_entrega on public.diseno_entregas_planos;
create trigger trg_proteger_semana_entrega
  before insert or update or delete on public.diseno_entregas_planos
  for each row execute function public.proteger_semana_informe_diseno();

-- 4. Lo que identifica a cada OT en el formato --------------------------------
-- El código interno de la unidad y si es CM o SR, de las OT que quien pregunta
-- ya puede ver. Nada más de la unidad ni del cliente.
create or replace function public.identificacion_ot_diseno(p_ordenes uuid[])
returns table (orden_id uuid, numero text, codigo_interno text, tipo_unidad text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select o.id, o.numero, nullif(btrim(u.codigo_interno), ''), o.tipo_unidad::text
    from public.ordenes_trabajo o
    left join public.unidades u on u.id = o.unidad_id
   where o.id = any(p_ordenes)
     and (public.es_admin() or public.tiene_permiso('diseno.planos') or public.tiene_permiso('diseno.subir_pdf')
          or public.tiene_permiso('supervision.general'))
     and public.puede_ver_orden(o.id)
$$;

revoke all on function public.identificacion_ot_diseno(uuid[]) from public, anon;
grant execute on function public.identificacion_ot_diseno(uuid[]) to authenticated;

-- 5. La copia enviada lleva el código, el tipo y las entregas -----------------
create or replace function public.controlar_revision_informe_diseno()
returns trigger language plpgsql security definer set search_path='public' as $$
declare v_cuerpo_nuevo jsonb; v_cuerpo_anterior jsonb;
begin
 if tg_op='INSERT' then
   perform public.exigir_permiso('diseno.preparar_informe');
   new.estado:='BORRADOR';new.contenido_enviado:=null;new.enviado_en:=null;new.revisado_por:=null;new.revisado_en:=null;new.recibido_por:=null;new.recibido_en:=null;new.observacion_revision:=null;
   return new;
 end if;
 v_cuerpo_nuevo:=to_jsonb(new)-array['estado','observacion_revision','enviado_en','revisado_por','revisado_en','recibido_por','recibido_en','contenido_enviado','actualizado_por','actualizado_en'];
 v_cuerpo_anterior:=to_jsonb(old)-array['estado','observacion_revision','enviado_en','revisado_por','revisado_en','recibido_por','recibido_en','contenido_enviado','actualizado_por','actualizado_en'];
 if v_cuerpo_nuevo is distinct from v_cuerpo_anterior then
   perform public.exigir_permiso('diseno.preparar_informe');
   if old.estado not in('BORRADOR','OBSERVADO') then raise exception 'El informe enviado está cerrado a edición. Diseño debe observarlo antes de corregirlo.'; end if;
 end if;
 new.contenido_enviado:=old.contenido_enviado;new.enviado_en:=old.enviado_en;new.revisado_por:=old.revisado_por;new.revisado_en:=old.revisado_en;new.recibido_por:=old.recibido_por;new.recibido_en:=old.recibido_en;
 if new.estado is distinct from old.estado then
   if new.estado='EN_REVISION' and old.estado in('BORRADOR','OBSERVADO') then
     perform public.exigir_permiso('diseno.preparar_informe');
     if length(btrim(new.resumen))<10 then raise exception 'Completa el resumen antes de enviar el informe.'; end if;
     new.enviado_en:=now();new.observacion_revision:=null;
     new.contenido_enviado:=jsonb_build_object(
       'tareas',coalesce((select jsonb_agg(jsonb_build_object(
         'id',t.id,'orden_id',t.orden_id,'integrante_id',t.integrante_id,'tipo',t.tipo,'componente',t.componente,
         'fecha_inicio',t.fecha_inicio,'fecha_entrega',t.fecha_entrega,'observacion',t.observacion,'ot',o.numero,
         'codigo_interno',nullif(btrim(u.codigo_interno),''),'tipo_unidad',o.tipo_unidad,'responsable',e.nombre) order by t.fecha_inicio,t.creado_en)
         from public.diseno_tareas t join public.ordenes_trabajo o on o.id=t.orden_id
         left join public.unidades u on u.id=o.unidad_id
         join public.ot_equipo_diseno e on e.id=t.integrante_id
        where t.fecha_inicio<=new.semana_inicio+6 and t.fecha_entrega>=new.semana_inicio),'[]'::jsonb),
       'entregas',coalesce((select jsonb_agg(jsonb_build_object(
         'id',d.id,'orden_id',d.orden_id,'integrante_id',d.integrante_id,'tipo_plano',d.tipo_plano,'n_planos',d.n_planos,
         'n_piezas',d.n_piezas,'fecha_entrega',d.fecha_entrega,'estado',d.estado,'entregado_a',to_jsonb(d.entregado_a),
         'ot',o.numero,'codigo_interno',nullif(btrim(u.codigo_interno),''),'tipo_unidad',o.tipo_unidad,'responsable',e.nombre)
         order by d.fecha_entrega nulls last,d.creado_en)
         from public.diseno_entregas_planos d join public.ordenes_trabajo o on o.id=d.orden_id
         left join public.unidades u on u.id=o.unidad_id
         join public.ot_equipo_diseno e on e.id=d.integrante_id
        where d.semana_inicio=new.semana_inicio),'[]'::jsonb));
   elsif old.estado='EN_REVISION' and new.estado in('APROBADO','OBSERVADO') then
     perform public.exigir_permiso('diseno.revisar_informe');
     if new.estado='OBSERVADO' and length(btrim(coalesce(new.observacion_revision,'')))<10 then raise exception 'Explica la observación con al menos 10 caracteres.'; end if;
     new.revisado_por:=public.usuario_actual();new.revisado_en:=now();
   elsif old.estado='APROBADO' and new.estado='RECIBIDO' then
     perform public.exigir_permiso('administracion.recibir_informe');
     new.recibido_por:=public.usuario_actual();new.recibido_en:=now();new.observacion_revision:=old.observacion_revision;
   else raise exception 'Esa transición no corresponde al estado actual del informe.';
   end if;
 else new.observacion_revision:=old.observacion_revision;
 end if;
 return new;
end $$;
revoke all on function public.controlar_revision_informe_diseno() from public,anon,authenticated;

-- 6. La numeración sigue la serie de la empresa -------------------------------
-- El último informe en Word fue el N.º 021, de la semana del 21/09/2026: el
-- primero del sistema es el 022. Las semanas hasta esa no se abren aquí,
-- porque tendrían otro número que el que ya circuló en papel.
create or replace function public.numerar_informe_diseno()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.semana_inicio <= date '2026-09-21' then
    raise exception 'Hasta la semana del 21/09/2026 los informes se hicieron en Word (el último fue el N.º 021). En el sistema la serie sigue desde la semana del 28/09/2026.'
      using errcode = 'check_violation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(38747, 1001);
  select greatest(coalesce(max(i.numero), 0), 21) + 1 into new.numero
    from public.diseno_informes i;
  return new;
end;
$$;
revoke all on function public.numerar_informe_diseno() from public, anon, authenticated;
