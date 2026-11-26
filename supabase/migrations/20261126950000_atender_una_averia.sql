-- =============================================================================
-- ATENDER UNA AVERÍA
-- -----------------------------------------------------------------------------
-- DKS, Plan 16 (Mantenimiento de equipos), entrega 16.3: «bandeja de
-- Mantenimiento por gravedad y días en espera; diagnóstico, trabajo hecho,
-- repuestos pedidos enlazando el RQ que ya existe, horas parado; al cerrar, el
-- equipo vuelve a «operativo» y quien reportó confirma que quedó bien.»
--
-- El reporte de la 16.2 (AV-0001-2026) sigue su camino:
--
--   REPORTADA ──► EN ATENCIÓN ──► CERRADA ──► CONFIRMADA
--                    ▲               │
--                    └── no quedó bien (vuelve a Mantenimiento)
--
--   * ATENDER: Mantenimiento la toma y anota su diagnóstico (qué tiene el
--     equipo). Mientras la atiende, lo puede corregir.
--   * REPUESTOS: no se pide nada nuevo aquí. El repuesto se pide con el RQ de
--     siempre, y Mantenimiento lo ENLAZA al reporte: quien reportó y su área ven
--     el número y cómo va (por revisar, en compra, listo en almacén…), sin
--     precios. Un enlace puesto por error se quita, y queda quién y cuándo.
--   * CERRAR: el trabajo hecho y las horas que el equipo estuvo parado. Si el
--     equipo estaba parado por este reporte, VUELVE A «OPERATIVO» (DKS); si otro
--     reporte vigente dice que detiene el trabajo, sigue parado por ese. A quien
--     reportó le llega el aviso para que confirme.
--   * CONFIRMAR: solo quien la reportó. «Quedó bien» la termina. «No quedó
--     bien», con lo que sigue fallando, la devuelve a Mantenimiento, y si la
--     avería detiene el trabajo el equipo vuelve a quedar parado.
--   * LA BANDEJA va por gravedad (detiene y es un riesgo, detiene, es un
--     riesgo, avería, posible avería) y, dentro de cada una, por días en espera.
--
-- Cada paso queda anotado en `averia_pasos` por un disparador, no por quien
-- llama: el recorrido y la historia del equipo (16.4) salen de ahí aunque el
-- reporte vuelva a Mantenimiento dos veces. Nada se borra.
--
-- Una cerrada o anulada no se reabre por Mantenimiento: la cerrada solo la
-- devuelve quien la reportó, y la anulada queda como evidencia.
-- =============================================================================

-- 1. El permiso dice lo que ahora hace ------------------------------------------------
update public.permisos
   set descripcion = 'Atender los reportes de avería: recibir el aviso de cada uno, verlos todos, anotar el diagnóstico, enlazar los RQ de los repuestos, cerrarlos con el trabajo hecho y las horas parado, y anular el reporte mal hecho'
 where codigo = 'averias.atender'
   and descripcion is distinct from 'Atender los reportes de avería: recibir el aviso de cada uno, verlos todos, anotar el diagnóstico, enlazar los RQ de los repuestos, cerrarlos con el trabajo hecho y las horas parado, y anular el reporte mal hecho';

-- 2. Lo que se anota al atender ------------------------------------------------------
alter table public.averias add column if not exists diagnostico text;
alter table public.averias add column if not exists atendida_por uuid references public.usuarios(id) on delete restrict;
alter table public.averias add column if not exists atendida_en timestamptz;
alter table public.averias add column if not exists trabajo_hecho text;
alter table public.averias add column if not exists horas_parado numeric(6, 1);
alter table public.averias add column if not exists cerrada_por uuid references public.usuarios(id) on delete restrict;
alter table public.averias add column if not exists cerrada_en timestamptz;
alter table public.averias add column if not exists confirmada_en timestamptz;
-- Lo que dijo quien reportó al confirmar o al devolverla.
alter table public.averias add column if not exists nota_de_quien_reporto text;
alter table public.averias add column if not exists veces_reabierta integer not null default 0;
alter table public.averias add column if not exists reabierta_en timestamptz;
-- Quién escribió el diagnóstico que se ve y cuándo: lo puede corregir otra
-- persona de Mantenimiento, y la ficha no debe firmarlo con el nombre de la primera.
alter table public.averias add column if not exists diagnostico_por uuid references public.usuarios(id);
alter table public.averias add column if not exists diagnostico_en timestamptz;
-- Si la avería dejó el equipo parado al reportarla. `paro_el_equipo` dice si lo
-- tiene parado AHORA (se suelta al cerrar o al pasarle el paro a otro reporte);
-- esta queda como se reportó, para el recorrido y la historia del equipo.
alter table public.averias add column if not exists paro_al_reportar boolean not null default false;
-- Los reportes de antes: la guardia no deja tocar lo que dijo quien reportó, y
-- esta marca es de eso. Se aparta el tiempo justo de anotarla. Solo el que paró
-- el equipo al reportarse: su paro empezó con el reporte (el mismo `now()`). El
-- que heredó el paro de otro reporte anulado, o el que lo retomó al volver de
-- «no quedó bien», no lo paró al reportarse, y volver a correr esta migración
-- no lo marca.
do $$ begin
  if exists (select 1 from public.averias where paro_el_equipo and not paro_al_reportar and equipo_parado_desde = creado_en) then
    alter table public.averias disable trigger trg_averia_guardia;
    update public.averias set paro_al_reportar = true
     where paro_el_equipo and not paro_al_reportar and equipo_parado_desde = creado_en;
    alter table public.averias enable trigger trg_averia_guardia;
  end if;
end $$;

do $$ begin
  if exists (select 1 from public.averias where diagnostico is not null and diagnostico_por is null) then
    alter table public.averias disable trigger trg_averia_guardia;
    update public.averias set diagnostico_por = atendida_por, diagnostico_en = atendida_en
     where diagnostico is not null and diagnostico_por is null;
    alter table public.averias enable trigger trg_averia_guardia;
  end if;
end $$;

comment on column public.averias.paro_el_equipo is
  'Si este reporte tiene el equipo en PARADO ahora. Con equipo_estado_antes, equipo_nota_antes y equipo_parado_desde, la anulación lo devuelve a como estaba y el cierre lo deja operativo, solo si sigue parado por él. Se suelta al cerrar.';
comment on column public.averias.paro_al_reportar is
  'Si la avería dejó el equipo parado cuando se reportó. No cambia.';
comment on column public.averias.horas_parado is
  'Las horas que el equipo estuvo parado por esta avería, como las anota Mantenimiento al cerrar (la pantalla propone las del padrón).';

alter table public.averias drop constraint if exists ck_averias_estado;
alter table public.averias add constraint ck_averias_estado check (
  (estado = 'REPORTADA'
     and atendida_en is null and atendida_por is null and diagnostico is null
     and cerrada_en is null and cerrada_por is null and trabajo_hecho is null and horas_parado is null
     and confirmada_en is null
     and anulado_en is null and anulado_por is null and motivo_anulacion is null)
  or (estado = 'EN_ATENCION'
     and atendida_en is not null and atendida_por is not null
     and char_length(btrim(coalesce(diagnostico, ''))) between 10 and 2000
     and cerrada_en is null and cerrada_por is null and trabajo_hecho is null and horas_parado is null
     and confirmada_en is null
     and anulado_en is null and anulado_por is null and motivo_anulacion is null)
  or (estado in ('CERRADA', 'CONFIRMADA')
     and atendida_en is not null and atendida_por is not null
     and char_length(btrim(coalesce(diagnostico, ''))) between 10 and 2000
     and cerrada_en is not null and cerrada_por is not null
     and char_length(btrim(coalesce(trabajo_hecho, ''))) between 10 and 2000
     and horas_parado between 0 and 9999
     and (estado = 'CERRADA') = (confirmada_en is null)
     and not paro_el_equipo
     and anulado_en is null and anulado_por is null and motivo_anulacion is null)
  or (estado = 'ANULADA'
     and anulado_en is not null and anulado_por is not null
     and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500
     and cerrada_en is null and confirmada_en is null)
);
alter table public.averias drop constraint if exists ck_averias_nota_de_quien_reporto;
alter table public.averias add constraint ck_averias_nota_de_quien_reporto
  check (nota_de_quien_reporto is null or char_length(btrim(nota_de_quien_reporto)) between 1 and 500);

-- La marca de «dejó parado al reportar» la pone la base, no quien inserta.
create or replace function public.fn_averia_al_reportar()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.paro_al_reportar := new.paro_el_equipo;
  return new;
end;
$$;
revoke all on function public.fn_averia_al_reportar() from public, anon, authenticated;
create or replace trigger trg_averia_al_reportar
  before insert on public.averias
  for each row execute function public.fn_averia_al_reportar();

-- 3. Cada paso, anotado ---------------------------------------------------------------
-- Lo escribe el disparador de abajo al cambiar el estado: quien llama no lo puede
-- saltar ni inventar. De aquí sale el recorrido cuando la avería vuelve a
-- Mantenimiento, y la historia del equipo (16.4).
create table if not exists public.averia_pasos (
  id              uuid primary key default gen_random_uuid(),
  averia_id       uuid not null,
  paso            text not null,
  hecho_por       uuid not null references public.usuarios(id) on delete restrict,
  -- La hora del reloj, no la de la transacción: dos pasos en la misma quedan en orden.
  hecho_en        timestamptz not null default clock_timestamp(),
  texto           text,
  horas_parado    numeric(6, 1),
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint averia_pasos_averia_id_fkey foreign key (averia_id) references public.averias(id) on delete restrict,
  constraint ck_averia_paso check (paso in ('ATENCION', 'CIERRE', 'CONFIRMACION', 'REAPERTURA', 'ANULACION'))
);
comment on table public.averia_pasos is
  'Cada paso de un reporte de avería después de reportarlo: atención (con el diagnóstico), cierre (trabajo hecho y horas parado), confirmación, reapertura (no quedó bien) y anulación. Lo escribe el disparador de averias; nadie lo corrige ni lo borra.';
-- El recorrido y la ficha leen los pasos de cada reporte en orden (b); sirve a la llave.
create index if not exists ix_averia_pasos_averia on public.averia_pasos (averia_id, hecho_en);
select public.activar_timestamps('averia_pasos');
select public.activar_registro_de_prueba('averia_pasos');

-- 4. Los RQ de los repuestos -------------------------------------------------------------
-- El repuesto se pide con el RQ de siempre; aquí solo se enlaza. Un enlace
-- equivocado se quita (queda quién y cuándo), no se borra.
create table if not exists public.averia_requerimientos (
  id               uuid primary key default gen_random_uuid(),
  averia_id        uuid not null,
  requerimiento_id uuid not null references public.requerimientos(id) on delete restrict,
  nota             text not null,
  enlazado_por     uuid not null references public.usuarios(id) on delete restrict,
  enlazado_en      timestamptz not null default now(),
  quitado_por      uuid references public.usuarios(id) on delete restrict,
  quitado_en       timestamptz,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  constraint averia_requerimientos_averia_id_fkey foreign key (averia_id) references public.averias(id) on delete restrict,
  constraint ck_averia_rq_nota check (char_length(btrim(nota)) between 3 and 300),
  constraint ck_averia_rq_quitado check ((quitado_por is null) = (quitado_en is null))
);
comment on table public.averia_requerimientos is
  'Los RQ con que se pidieron los repuestos de una avería, enlazados por Mantenimiento. Quien ve el reporte ve el número y cómo va el RQ, sin precios. Un enlace equivocado se quita con quién y cuándo; no se borra.';
-- Un RQ se enlaza una vez a cada reporte; también es el índice de la llave hacia el reporte (b).
create unique index if not exists uq_averia_rq_vigente on public.averia_requerimientos (averia_id, requerimiento_id)
  where quitado_en is null;
-- La ficha y la lista leen los enlaces de cada reporte, también los quitados (b);
-- el índice de arriba es parcial y no sirve a la llave.
create index if not exists ix_averia_rq_averia on public.averia_requerimientos (averia_id);
select public.activar_timestamps('averia_requerimientos');
select public.activar_auditoria('averia_requerimientos');
select public.activar_registro_de_prueba('averia_requerimientos');

-- 5. El reporte cambia solo por su camino --------------------------------------------------
create or replace function public.fn_averia_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  -- Lo que dijo quien reportó: no cambia nunca.
  v_reporte constant text[] := array['id', 'numero', 'equipo_id', 'tipo', 'detiene_trabajo', 'riesgo_personas',
                                     'descripcion', 'area_id', 'registrado_por', 'creado_en', 'paro_al_reportar'];
  v_paro    constant text[] := array['paro_el_equipo', 'equipo_estado_antes', 'equipo_nota_antes', 'equipo_parado_desde'];
  v_paso    text := old.estado || '>' || new.estado;
begin
  if tg_op = 'DELETE' then
    raise exception 'Un reporte de avería no se borra: Mantenimiento lo anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.estado = 'ANULADA' then
    raise exception 'El reporte % está anulado: queda como evidencia.', old.numero using errcode = 'check_violation';
  end if;
  if old.estado = 'CONFIRMADA' then
    raise exception 'El reporte % ya está cerrado y confirmado: queda como evidencia. Si el equipo vuelve a fallar, se reporta de nuevo.', old.numero
      using errcode = 'check_violation';
  end if;
  if (select jsonb_object_agg(k, to_jsonb(new) -> k) from unnest(v_reporte) k)
     is distinct from (select jsonb_object_agg(k, to_jsonb(old) -> k) from unnest(v_reporte) k) then
    raise exception 'Lo que dice el reporte % no se corrige: si está mal, Mantenimiento lo anula con su motivo y se reporta de nuevo.', old.numero
      using errcode = 'check_violation';
  end if;
  -- El paro del equipo lo mueven solo las funciones que lo saben: el cierre, la
  -- reapertura y el traspaso al otro reporte que detiene el trabajo.
  if (select jsonb_object_agg(k, to_jsonb(new) -> k) from unnest(v_paro) k)
     is distinct from (select jsonb_object_agg(k, to_jsonb(old) -> k) from unnest(v_paro) k)
     and coalesce(current_setting('averias.cambia_el_paro', true), '') <> old.id::text then
    raise exception 'El paro del equipo no se corrige a mano en el reporte %: lo mueven el cierre y la anulación.', old.numero
      using errcode = 'check_violation';
  end if;

  -- Quién escribió el diagnóstico y cuándo los pone la base, cada vez que cambia.
  if new.diagnostico is distinct from old.diagnostico then
    new.diagnostico_por := coalesce(public.usuario_actual(), new.diagnostico_por);
    new.diagnostico_en := now();
  else
    new.diagnostico_por := old.diagnostico_por;
    new.diagnostico_en := old.diagnostico_en;
  end if;

  if new.estado = old.estado then
    -- Sin cambiar de paso, solo se corrige el diagnóstico mientras se atiende.
    if (to_jsonb(new) - v_paro - 'diagnostico' - 'diagnostico_por' - 'diagnostico_en' - 'actualizado_en')
       is distinct from (to_jsonb(old) - v_paro - 'diagnostico' - 'diagnostico_por' - 'diagnostico_en' - 'actualizado_en')
       or (new.diagnostico is distinct from old.diagnostico and old.estado <> 'EN_ATENCION') then
      raise exception 'El reporte % no se cambia así: sigue su camino (atender, cerrar, confirmar).', old.numero using errcode = 'check_violation';
    end if;
    return new;
  end if;

  if v_paso not in ('REPORTADA>EN_ATENCION', 'REPORTADA>ANULADA', 'EN_ATENCION>CERRADA', 'EN_ATENCION>ANULADA',
                    'CERRADA>CONFIRMADA', 'CERRADA>EN_ATENCION') then
    raise exception 'El reporte % está %: no pasa a %.', old.numero,
      case old.estado when 'REPORTADA' then 'reportado' when 'EN_ATENCION' then 'en atención' when 'CERRADA' then 'cerrado' else lower(old.estado) end,
      case new.estado when 'REPORTADA' then 'reportado' when 'EN_ATENCION' then 'en atención' when 'CERRADA' then 'cerrado'
                      when 'CONFIRMADA' then 'confirmado' when 'ANULADA' then 'anulado' else lower(new.estado) end
      using errcode = 'check_violation';
  end if;

  -- Quién y cuándo los pone la base, venga de donde venga el UPDATE.
  if v_paso = 'REPORTADA>EN_ATENCION' then
    new.atendida_por := coalesce(public.usuario_actual(), new.atendida_por);
    new.atendida_en := now();
  elsif v_paso = 'EN_ATENCION>CERRADA' then
    new.cerrada_por := coalesce(public.usuario_actual(), new.cerrada_por);
    new.cerrada_en := now();
  elsif v_paso = 'CERRADA>CONFIRMADA' then
    new.confirmada_en := now();
  elsif v_paso = 'CERRADA>EN_ATENCION' then
    new.veces_reabierta := old.veces_reabierta + 1;
    new.reabierta_en := now();
    new.cerrada_por := null;
    new.cerrada_en := null;
    new.trabajo_hecho := null;
    new.horas_parado := null;
  end if;
  if v_paso in ('CERRADA>CONFIRMADA', 'CERRADA>EN_ATENCION')
     and public.usuario_actual() is distinct from old.registrado_por then
    raise exception 'Si quedó bien lo confirma quien reportó la avería.' using errcode = 'insufficient_privilege';
  end if;

  -- La anulación se sella aquí y no solo en la función que anula.
  if new.estado = 'ANULADA' then
    if char_length(btrim(coalesce(new.motivo_anulacion, ''))) < 10 then
      raise exception 'Para anular el reporte % escribe el motivo (al menos 10 letras).', old.numero using errcode = 'check_violation';
    end if;
    new.motivo_anulacion := btrim(new.motivo_anulacion);
    new.anulado_por := coalesce(public.usuario_actual(), new.anulado_por);
    new.anulado_en := now();
  elsif (new.anulado_por, new.anulado_en, new.motivo_anulacion) is distinct from (old.anulado_por, old.anulado_en, old.motivo_anulacion) then
    raise exception 'El reporte % no está anulado: quién, cuándo y el motivo se anotan solo al anularlo.', old.numero using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_averia_guardia() from public, anon, authenticated;

-- Cada cambio de paso queda anotado, con quién lo hizo.
create or replace function public.fn_averia_anotar_paso()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_quien uuid := coalesce(public.usuario_actual(), new.anulado_por, new.cerrada_por, new.atendida_por, new.registrado_por);
begin
  if new.estado = old.estado then
    return null;
  end if;
  insert into public.averia_pasos (averia_id, paso, hecho_por, texto, horas_parado)
  values (new.id,
          case new.estado
            when 'EN_ATENCION' then case when old.estado = 'CERRADA' then 'REAPERTURA' else 'ATENCION' end
            when 'CERRADA' then 'CIERRE'
            when 'CONFIRMADA' then 'CONFIRMACION'
            when 'ANULADA' then 'ANULACION'
          end,
          v_quien,
          case new.estado
            when 'EN_ATENCION' then case when old.estado = 'CERRADA' then new.nota_de_quien_reporto else new.diagnostico end
            when 'CERRADA' then new.trabajo_hecho
            when 'CONFIRMADA' then new.nota_de_quien_reporto
            when 'ANULADA' then new.motivo_anulacion
          end,
          case when new.estado = 'CERRADA' then new.horas_parado end);
  return null;
end;
$$;
revoke all on function public.fn_averia_anotar_paso() from public, anon, authenticated;
create or replace trigger trg_averia_anotar_paso
  after update on public.averias
  for each row execute function public.fn_averia_anotar_paso();

-- Las anuladas de antes de esta migración: su paso, para que el recorrido lo siga diciendo.
insert into public.averia_pasos (averia_id, paso, hecho_por, hecho_en, texto)
select a.id, 'ANULACION', a.anulado_por, a.anulado_en, a.motivo_anulacion
  from public.averias a
 where a.estado = 'ANULADA'
   and not exists (select 1 from public.averia_pasos p where p.averia_id = a.id and p.paso = 'ANULACION');

create or replace function public.fn_averia_paso_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Los pasos de un reporte de avería no se cambian ni se borran: quedan como evidencia.' using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_averia_paso_guardia() from public, anon, authenticated;
create or replace trigger trg_averia_paso_guardia
  before update or delete on public.averia_pasos
  for each row execute function public.fn_averia_paso_guardia();

-- Un enlace solo se quita, una vez, y lo demás no se toca.
create or replace function public.fn_averia_rq_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'El enlace del RQ no se borra: se quita, y queda quién y cuándo.' using errcode = 'check_violation';
  end if;
  if old.quitado_en is not null
     or (to_jsonb(new) - 'quitado_por' - 'quitado_en' - 'actualizado_en') is distinct from (to_jsonb(old) - 'quitado_por' - 'quitado_en' - 'actualizado_en') then
    raise exception 'El enlace del RQ no se corrige: si está mal, se quita y se enlaza el que es.' using errcode = 'check_violation';
  end if;
  new.quitado_por := coalesce(public.usuario_actual(), new.quitado_por);
  new.quitado_en := now();
  return new;
end;
$$;
revoke all on function public.fn_averia_rq_guardia() from public, anon, authenticated;
create or replace trigger trg_averia_rq_guardia
  before update or delete on public.averia_requerimientos
  for each row execute function public.fn_averia_rq_guardia();

-- 6. Quién ve qué -------------------------------------------------------------------------
-- Los pasos y los enlaces los ve quien ve el reporte: la consulta pasa por `ver_averias`.
alter table public.averia_pasos enable row level security;
alter table public.averia_requerimientos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'averia_pasos' and policyname = 'ver_averia_pasos') then
    create policy ver_averia_pasos on public.averia_pasos for select to authenticated
      using (exists (select 1 from public.averias a where a.id = averia_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'averia_requerimientos' and policyname = 'ver_averia_requerimientos') then
    create policy ver_averia_requerimientos on public.averia_requerimientos for select to authenticated
      using (exists (select 1 from public.averias a where a.id = averia_id));
  end if;
end $$;
-- Se escriben solo por las funciones de abajo: sin políticas de escritura ni grant.
revoke all on public.averia_pasos from public, anon, authenticated;
revoke all on public.averia_requerimientos from public, anon, authenticated;
grant select on public.averia_pasos to authenticated;
grant select on public.averia_requerimientos to authenticated;

-- La política `ver_averias`, como función, para las que corren por encima del RLS.
create or replace function public.averia_la_ve(p_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from public.averias v
     where v.id = p_id
       and (public.puede_ver_todas_las_averias()
            or v.registrado_por = public.usuario_actual()
            or v.area_id = any(public.averias_areas_de_la_cuenta())
            or (v.riesgo_personas and public.averias_ve_las_de_riesgo())));
$$;
revoke all on function public.averia_la_ve(uuid) from public, anon, authenticated;

create or replace function public.averias_exigir_mantenimiento()
returns void language plpgsql stable security definer set search_path to 'public' as $$
begin
  if public.usuario_actual() is null or not public.es_usuario_activo()
     or not (public.es_admin() or public.tiene_permiso('averias.atender')) then
    raise exception 'Una avería la atiende Mantenimiento.' using errcode = 'insufficient_privilege';
  end if;
end;
$$;
revoke all on function public.averias_exigir_mantenimiento() from public, anon, authenticated;

-- 7. Soltar el equipo -------------------------------------------------------------------------
-- Al anular o al cerrar: si el equipo sigue parado por este reporte, vuelve
-- (a como estaba, al anular; a operativo, al cerrar). Si otro reporte vigente
-- dice que detiene el trabajo, ese se queda con el paro y el equipo sigue parado.
create or replace function public.averias_soltar_el_equipo(p_id uuid, p_vuelve_a text)
returns table (vuelve_a text, sigue_parado_por text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_av     public.averias%rowtype;
  v_equipo public.equipos%rowtype;
  v_otro   public.averias%rowtype;
  v_estado text;
begin
  select * into v_av from public.averias where id = p_id;
  if not found or not v_av.paro_el_equipo then
    return query select null::text, null::text;
    return;
  end if;
  select * into v_equipo from public.equipos where id = v_av.equipo_id for update;
  if not (v_equipo.activo and v_equipo.estado = 'PARADO' and v_equipo.estado_desde = v_av.equipo_parado_desde) then
    -- Alguien lo cambió después en el padrón: lo que dijo esa persona manda.
    perform set_config('averias.cambia_el_paro', p_id::text, true);
    update public.averias
       set paro_el_equipo = false, equipo_estado_antes = null, equipo_nota_antes = null, equipo_parado_desde = null
     where id = p_id and estado <> 'ANULADA';
    perform set_config('averias.cambia_el_paro', '', true);
    return query select null::text, null::text;
    return;
  end if;
  select o.* into v_otro
    from public.averias o
   where o.equipo_id = v_av.equipo_id and o.id <> p_id and o.estado in ('REPORTADA', 'EN_ATENCION') and o.detiene_trabajo
   order by o.creado_en
   limit 1
     for update;
  if v_otro.id is null then
    v_estado := coalesce(p_vuelve_a, v_av.equipo_estado_antes);
    update public.equipos
       set estado = v_estado, estado_nota = case when p_vuelve_a is null then v_av.equipo_nota_antes end
     where id = v_av.equipo_id;
    if v_av.estado <> 'ANULADA' then
      perform set_config('averias.cambia_el_paro', p_id::text, true);
      update public.averias
         set paro_el_equipo = false, equipo_estado_antes = null, equipo_nota_antes = null, equipo_parado_desde = null
       where id = p_id;
      perform set_config('averias.cambia_el_paro', '', true);
    end if;
    return query select v_estado, null::text;
    return;
  end if;
  -- El otro reporte se queda con el paro y con cómo estaba el equipo antes.
  perform set_config('averias.cambia_el_paro', v_otro.id::text, true);
  update public.averias
     set paro_el_equipo = true, equipo_estado_antes = v_av.equipo_estado_antes,
         equipo_nota_antes = v_av.equipo_nota_antes, equipo_parado_desde = v_av.equipo_parado_desde
   where id = v_otro.id;
  if v_av.estado <> 'ANULADA' then
    perform set_config('averias.cambia_el_paro', p_id::text, true);
    update public.averias
       set paro_el_equipo = false, equipo_estado_antes = null, equipo_nota_antes = null, equipo_parado_desde = null
     where id = p_id;
  end if;
  perform set_config('averias.cambia_el_paro', '', true);
  update public.equipos
     set estado_nota = left('Avería ' || v_otro.numero || ': ' || v_otro.descripcion, 300)
   where id = v_av.equipo_id;
  return query select null::text, v_otro.numero;
end;
$$;
revoke all on function public.averias_soltar_el_equipo(uuid, text) from public, anon, authenticated;

-- 8. Anular: ahora también la que se está atendiendo; la cerrada, no --------------------------
create or replace function public.averias_anular(p_id uuid, p_motivo text)
returns table (averia uuid, equipo_vuelve_a text, sigue_parado_por text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo uuid := public.usuario_actual();
  v_av public.averias%rowtype;
  r    record;
begin
  if v_yo is null or not public.es_usuario_activo() or not (public.es_admin() or public.tiene_permiso('averias.atender')) then
    raise exception 'Un reporte de avería lo anula Mantenimiento.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_av from public.averias where id = p_id for update;
  if not found then raise exception 'Ese reporte no existe.' using errcode = 'check_violation'; end if;
  if v_av.estado = 'ANULADA' then
    -- El mismo pedido repetido (se perdió la respuesta) entra; con otro motivo se dice, no se finge.
    if v_av.motivo_anulacion = btrim(p_motivo) and v_av.anulado_por = v_yo then
      return query select p_id, null::text, null::text;
      return;
    end if;
    raise exception 'El reporte % ya estaba anulado, con este motivo: «%». No se cambia.', v_av.numero, v_av.motivo_anulacion
      using errcode = 'check_violation';
  end if;
  if v_av.estado in ('CERRADA', 'CONFIRMADA') then
    raise exception 'El reporte % ya se cerró con el trabajo hecho: queda como evidencia, no se anula.', v_av.numero
      using errcode = 'check_violation';
  end if;

  update public.averias
     set estado = 'ANULADA', anulado_por = v_yo, anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  select * into r from public.averias_soltar_el_equipo(p_id, null);

  if v_av.registrado_por is distinct from v_yo then
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    values (v_av.registrado_por, 'Mantenimiento anuló tu reporte ' || v_av.numero, left(btrim(p_motivo), 500),
            '/averias/' || p_id::text, 'averias', p_id);
  end if;
  return query select p_id, r.vuelve_a, r.sigue_parado_por;
end;
$$;
comment on function public.averias_anular(uuid, text) is
  'Mantenimiento anula un reporte de avería reportado o en atención, con su motivo; si el equipo sigue parado por él, vuelve a como estaba, y avisa a quien lo reportó. El cerrado no se anula. Exige averias.atender.';
revoke all on function public.averias_anular(uuid, text) from public, anon;
grant execute on function public.averias_anular(uuid, text) to authenticated;

-- 9. Atender: el diagnóstico ---------------------------------------------------------------------
-- La primera vez la toma (REPORTADA → EN ATENCIÓN); mientras la atiende, corrige
-- el diagnóstico. El mismo texto otra vez (un reintento) no cambia nada.
create or replace function public.averias_atender(p_id uuid, p_diagnostico text)
returns table (averia uuid, estado text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_que text := btrim(coalesce(p_diagnostico, ''));
  v_av  public.averias%rowtype;
begin
  perform public.averias_exigir_mantenimiento();
  if char_length(v_que) not between 10 and 2000 then
    raise exception 'Escribe el diagnóstico: qué tiene el equipo, en 10 a 2000 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_av from public.averias v where v.id = p_id for update;
  if not found then raise exception 'Ese reporte no existe.' using errcode = 'check_violation'; end if;
  if v_av.estado = 'REPORTADA' then
    update public.averias set estado = 'EN_ATENCION', diagnostico = v_que where id = p_id;
  elsif v_av.estado = 'EN_ATENCION' then
    if v_av.diagnostico is distinct from v_que then
      update public.averias set diagnostico = v_que where id = p_id;
    end if;
  else
    raise exception 'El reporte % está %: el diagnóstico ya no se cambia.', v_av.numero,
      case v_av.estado when 'CERRADA' then 'cerrado, esperando que quien lo reportó confirme' when 'CONFIRMADA' then 'cerrado y confirmado' else 'anulado' end
      using errcode = 'check_violation';
  end if;
  return query select p_id, 'EN_ATENCION'::text;
end;
$$;
comment on function public.averias_atender(uuid, text) is
  'Mantenimiento toma un reporte de avería con su diagnóstico (REPORTADA → EN_ATENCION) o lo corrige mientras lo atiende. Exige averias.atender.';
revoke all on function public.averias_atender(uuid, text) from public, anon;
grant execute on function public.averias_atender(uuid, text) to authenticated;

-- 10. Los RQ de los repuestos -----------------------------------------------------------------
-- Para elegir cuál enlazar: los RQ vivos de los últimos seis meses, con lo
-- justo para reconocerlos y sin precios. Mantenimiento no lee los RQ por su
-- cuenta (no tiene `requerimientos.ver`).
create or replace function public.averias_rq_para_enlazar()
returns table (id uuid, numero text, tipo text, area text, codigo_interno text, estado text, justificacion text, creado_en timestamptz)
language plpgsql stable security definer set search_path to 'public' rows 300 as $$
begin
  perform public.averias_exigir_mantenimiento();
  return query
    select r.id, r.numero, r.tipo, a.nombre, r.codigo_interno,
           case when r.estado = 'ENTREGADO' and r.faltante_al_entregar is not null then 'ENTREGADO_CON_FALTANTE' else r.estado end,
           left(r.justificacion, 160), r.creado_en
      from public.requerimientos r
      join public.areas a on a.id = r.area_id
     where r.estado <> 'ANULADO'
       and r.creado_en >= now() - interval '180 days'
     order by r.creado_en desc
     limit 300;
end;
$$;
comment on function public.averias_rq_para_enlazar() is
  'Los RQ vivos de los últimos 180 días, para que Mantenimiento enlace el de los repuestos de una avería: número, tipo, área, código, estado y la justificación corta. Sin precios. Exige averias.atender.';
revoke all on function public.averias_rq_para_enlazar() from public, anon;
grant execute on function public.averias_rq_para_enlazar() to authenticated;

-- p_enlace: el id del enlace, que pone la pantalla. El mismo envío otra vez
-- (se perdió la respuesta) no lo enlaza dos veces.
create or replace function public.averias_enlazar_rq(p_enlace uuid, p_averia uuid, p_requerimiento uuid, p_nota text)
returns table (enlace uuid, numero_rq text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo   uuid := public.usuario_actual();
  v_nota text := btrim(coalesce(p_nota, ''));
  v_av   public.averias%rowtype;
  v_rq   public.requerimientos%rowtype;
  v_ya   public.averia_requerimientos%rowtype;
begin
  perform public.averias_exigir_mantenimiento();
  if p_enlace is null then
    raise exception 'Vuelve a abrir la ventana del RQ.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('averias_enlazar_rq:' || p_averia::text, 0));
  select * into v_ya from public.averia_requerimientos where id = p_enlace;
  if found then
    if v_ya.averia_id = p_averia and v_ya.requerimiento_id = p_requerimiento and v_ya.nota = v_nota and v_ya.enlazado_por = v_yo then
      return query select v_ya.id, (select r.numero from public.requerimientos r where r.id = v_ya.requerimiento_id);
      return;
    end if;
    raise exception 'Ese enlace ya quedó con otros datos: vuelve a abrir la ventana.' using errcode = 'unique_violation';
  end if;
  if char_length(v_nota) not between 3 and 300 then
    raise exception 'Di qué repuesto se pidió con ese RQ, en 3 a 300 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_av from public.averias where id = p_averia for update;
  if not found then raise exception 'Ese reporte no existe.' using errcode = 'check_violation'; end if;
  if v_av.estado <> 'EN_ATENCION' then
    raise exception 'El RQ de los repuestos se enlaza mientras se atiende la avería: %',
      case v_av.estado when 'REPORTADA' then 'primero anota el diagnóstico.' else 'el reporte ' || v_av.numero || ' ya no está en atención.' end
      using errcode = 'check_violation';
  end if;
  select * into v_rq from public.requerimientos where id = p_requerimiento;
  if not found then
    raise exception 'Elige el RQ de la lista.' using errcode = 'check_violation';
  end if;
  if v_rq.estado = 'ANULADO' then
    raise exception 'El RQ % está anulado: enlaza el que lo reemplaza.', v_rq.numero using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.averia_requerimientos e
              where e.averia_id = p_averia and e.requerimiento_id = p_requerimiento and e.quitado_en is null) then
    raise exception 'El RQ % ya está enlazado a este reporte.', v_rq.numero using errcode = 'unique_violation';
  end if;
  insert into public.averia_requerimientos (id, averia_id, requerimiento_id, nota, enlazado_por)
  values (p_enlace, p_averia, p_requerimiento, v_nota, v_yo);
  return query select p_enlace, v_rq.numero;
end;
$$;
comment on function public.averias_enlazar_rq(uuid, uuid, uuid, text) is
  'Mantenimiento enlaza a una avería en atención el RQ con que se pidieron los repuestos, diciendo cuál. El mismo envío repetido no lo enlaza dos veces. Exige averias.atender.';
revoke all on function public.averias_enlazar_rq(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.averias_enlazar_rq(uuid, uuid, uuid, text) to authenticated;

create or replace function public.averias_quitar_rq(p_enlace uuid)
returns table (enlace uuid, numero_rq text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_e  public.averia_requerimientos%rowtype;
  v_av public.averias%rowtype;
begin
  perform public.averias_exigir_mantenimiento();
  select * into v_e from public.averia_requerimientos where id = p_enlace for update;
  if not found then raise exception 'Ese enlace no existe.' using errcode = 'check_violation'; end if;
  -- Ya quitado (un reintento): está bien.
  if v_e.quitado_en is null then
    select * into v_av from public.averias where id = v_e.averia_id;
    if v_av.estado <> 'EN_ATENCION' then
      raise exception 'El reporte % ya no está en atención: sus RQ quedan como están.', v_av.numero using errcode = 'check_violation';
    end if;
    update public.averia_requerimientos set quitado_en = now() where id = p_enlace;
  end if;
  return query select p_enlace, (select r.numero from public.requerimientos r where r.id = v_e.requerimiento_id);
end;
$$;
comment on function public.averias_quitar_rq(uuid) is
  'Mantenimiento quita un RQ enlazado por error a una avería en atención. No se borra: queda quién y cuándo. Exige averias.atender.';
revoke all on function public.averias_quitar_rq(uuid) from public, anon;
grant execute on function public.averias_quitar_rq(uuid) to authenticated;

-- Los RQ enlazados, para quien ve el reporte: el número y cómo va, sin precios.
-- `puede_abrir`: si quien mira lee los RQ y puede ir a la pantalla del RQ.
create or replace function public.averias_rq_enlazados(p_averias uuid[])
returns table (enlace uuid, averia uuid, requerimiento uuid, numero text, estado text, nota text, enlazado_en timestamptz, puede_abrir boolean)
language sql stable security definer set search_path to 'public' as $$
  select e.id, e.averia_id, r.id, r.numero,
         case when r.estado = 'ENTREGADO' and r.faltante_al_entregar is not null then 'ENTREGADO_CON_FALTANTE' else r.estado end,
         e.nota, e.enlazado_en, public.puede_ver_requerimientos()
    from public.averia_requerimientos e
    join public.requerimientos r on r.id = e.requerimiento_id
   where e.averia_id = any(p_averias)
     and e.quitado_en is null
     and cardinality(p_averias) <= 500
     and public.averia_la_ve(e.averia_id)
   order by e.enlazado_en;
$$;
comment on function public.averias_rq_enlazados(uuid[]) is
  'Los RQ enlazados a cada reporte de avería que ve quien pregunta: número, estado y qué repuesto, sin precios.';
revoke all on function public.averias_rq_enlazados(uuid[]) from public, anon;
grant execute on function public.averias_rq_enlazados(uuid[]) to authenticated;

-- 11. Cerrar -----------------------------------------------------------------------------------
-- Cambia lo que devuelve (cómo quedó el equipo): se quita y se vuelve a crear.
drop function if exists public.averias_cerrar(uuid, text, numeric);
create or replace function public.averias_cerrar(p_id uuid, p_trabajo text, p_horas numeric)
returns table (averia uuid, equipo_vuelve_a text, sigue_parado_por text, avisada boolean, equipo_estado text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_trabajo text := btrim(coalesce(p_trabajo, ''));
  v_av      public.averias%rowtype;
  r         record;
  v_activo  boolean;
  v_otro    text;
begin
  perform public.averias_exigir_mantenimiento();
  if char_length(v_trabajo) not between 10 and 2000 then
    raise exception 'Cuenta el trabajo hecho, en 10 a 2000 caracteres.' using errcode = 'check_violation';
  end if;
  if p_horas is null or p_horas < 0 or p_horas > 9999 then
    raise exception 'Anota las horas que el equipo estuvo parado (0 si no se paró).' using errcode = 'check_violation';
  end if;
  select * into v_av from public.averias v where v.id = p_id for update;
  if not found then raise exception 'Ese reporte no existe.' using errcode = 'check_violation'; end if;
  if v_av.estado = 'CERRADA' and v_av.trabajo_hecho = v_trabajo and v_av.horas_parado = round(p_horas, 1) and v_av.cerrada_por = v_yo then
    -- El mismo cierre otra vez: ya quedó.
    return query select p_id, null::text, null::text,
                        v_av.registrado_por <> v_yo and exists (select 1 from public.usuarios u where u.id = v_av.registrado_por and u.activo),
                        (select e.estado from public.equipos e where e.id = v_av.equipo_id);
    return;
  end if;
  if v_av.estado = 'REPORTADA' then
    raise exception 'Antes de cerrar el reporte % anota el diagnóstico: qué tenía el equipo.', v_av.numero using errcode = 'check_violation';
  end if;
  if v_av.estado <> 'EN_ATENCION' then
    raise exception 'El reporte % ya está %.', v_av.numero,
      case v_av.estado when 'CERRADA' then 'cerrado, esperando que quien lo reportó confirme' when 'CONFIRMADA' then 'cerrado y confirmado' else 'anulado' end
      using errcode = 'check_violation';
  end if;

  -- Primero se suelta el equipo (sigue en atención: el paro todavía es suyo).
  select * into r from public.averias_soltar_el_equipo(p_id, 'OPERATIVO');
  -- Si esta no tenía el paro, puede tenerlo otra vigente del mismo equipo: se
  -- dice cuál, para que nadie lo pase a operativo a mano con ese reporte abierto.
  if r.vuelve_a is null and r.sigue_parado_por is null then
    select a2.numero into v_otro
      from public.averias a2
     where a2.equipo_id = v_av.equipo_id and a2.id <> p_id and a2.paro_el_equipo
       and a2.estado in ('REPORTADA', 'EN_ATENCION')
     order by a2.creado_en
     limit 1;
  end if;
  update public.averias
     set estado = 'CERRADA', trabajo_hecho = v_trabajo, horas_parado = round(p_horas, 1), nota_de_quien_reporto = null
   where id = p_id;

  -- A quien la reportó, si su cuenta sigue activa: si no, nadie lo va a leer y la
  -- pantalla no dice «le avisamos».
  select u.activo into v_activo from public.usuarios u where u.id = v_av.registrado_por;
  if v_av.registrado_por <> v_yo and coalesce(v_activo, false) then
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    values (v_av.registrado_por, left('Mantenimiento cerró tu reporte ' || v_av.numero || ': confirma si quedó bien', 200),
            left(v_trabajo, 500), '/averias/' || p_id::text, 'averias', p_id);
  end if;
  return query select p_id, r.vuelve_a, coalesce(r.sigue_parado_por, v_otro), v_av.registrado_por <> v_yo and coalesce(v_activo, false),
                      (select e.estado from public.equipos e where e.id = v_av.equipo_id);
end;
$$;
comment on function public.averias_cerrar(uuid, text, numeric) is
  'Mantenimiento cierra una avería en atención con el trabajo hecho y las horas parado; si el equipo sigue parado por ella vuelve a operativo (o sigue parado por el otro reporte que detiene el trabajo) y avisa a quien la reportó para que confirme, si su cuenta sigue activa (avisada). equipo_estado: cómo quedó el equipo en el padrón. Exige averias.atender.';
revoke all on function public.averias_cerrar(uuid, text, numeric) from public, anon;
grant execute on function public.averias_cerrar(uuid, text, numeric) to authenticated;

-- 12. Confirmar ----------------------------------------------------------------------------------
-- Solo quien la reportó. «No quedó bien» la devuelve a Mantenimiento con lo que
-- sigue fallando; si la avería detiene el trabajo, el equipo vuelve a quedar parado.
-- Cambia lo que devuelve (a quién le llegó el aviso): se quita y se vuelve a crear.
drop function if exists public.averias_confirmar(uuid, boolean, text);
create or replace function public.averias_confirmar(p_id uuid, p_quedo_bien boolean, p_nota text)
returns table (averia uuid, estado text, equipo_parado boolean, avisado_a text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_nota   text := nullif(btrim(coalesce(p_nota, '')), '');
  v_av     public.averias%rowtype;
  v_equipo public.equipos%rowtype;
  v_desde  timestamptz;
  v_paro   boolean := false;
  v_titulo text;
  v_a_quien text;
begin
  if v_yo is null or not public.es_usuario_activo() then
    raise exception 'Entra con tu cuenta para confirmar.' using errcode = 'insufficient_privilege';
  end if;
  if p_quedo_bien is null then
    raise exception 'Elige si el equipo quedó bien.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_nota, '')) > 500 then
    raise exception 'La nota pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;
  if not p_quedo_bien and char_length(coalesce(v_nota, '')) < 10 then
    raise exception 'Cuenta qué sigue fallando, en al menos 10 caracteres: vuelve a Mantenimiento con eso.' using errcode = 'check_violation';
  end if;
  select * into v_av from public.averias v where v.id = p_id for update;
  if not found or v_av.registrado_por <> v_yo then
    raise exception 'Si quedó bien lo confirma quien reportó la avería.' using errcode = 'insufficient_privilege';
  end if;
  -- El mismo pedido otra vez (se perdió la respuesta): ya quedó.
  if p_quedo_bien and v_av.estado = 'CONFIRMADA' and v_av.nota_de_quien_reporto is not distinct from v_nota then
    return query select p_id, v_av.estado, false, null::text;
    return;
  end if;
  if not p_quedo_bien and v_av.estado = 'EN_ATENCION' and v_av.veces_reabierta > 0
     and v_av.nota_de_quien_reporto is not distinct from v_nota then
    -- A quién le llegó la primera vez (o, si quien la devolvió es de Mantenimiento, a su propia bandeja).
    return query select p_id, v_av.estado, v_av.paro_el_equipo,
      case when public.tiene_permiso('averias.atender') then 'SU_BANDEJA' else
      (select case when n.titulo like '% (%' then 'GERENCIA' else 'MANTENIMIENTO' end
         from public.notificaciones n
        where n.origen_tabla = 'averias' and n.origen_id = p_id and n.titulo like 'No quedó bien: %' and n.creado_en >= v_av.reabierta_en
        order by n.creado_en desc limit 1) end;
    return;
  end if;
  if v_av.estado <> 'CERRADA' then
    raise exception 'El reporte % %.', v_av.numero,
      case v_av.estado when 'REPORTADA' then 'todavía no lo atiende Mantenimiento: se confirma cuando lo cierre'
                       when 'EN_ATENCION' then 'todavía lo atiende Mantenimiento: se confirma cuando lo cierre'
                       when 'CONFIRMADA' then 'ya está confirmado'
                       else 'está anulado' end
      using errcode = 'check_violation';
  end if;

  if p_quedo_bien then
    update public.averias set estado = 'CONFIRMADA', nota_de_quien_reporto = v_nota where id = p_id;
    return query select p_id, 'CONFIRMADA'::text, false, null::text;
    return;
  end if;

  -- No quedó bien: vuelve a Mantenimiento. La avería que detiene el trabajo
  -- vuelve a dejar el equipo parado, como al reportarla.
  select * into v_equipo from public.equipos where id = v_av.equipo_id for update;
  if v_av.detiene_trabajo and v_equipo.activo and v_equipo.estado <> 'PARADO' then
    update public.equipos
       set estado = 'PARADO', estado_nota = left('Avería ' || v_av.numero || ': sigue fallando. ' || v_nota, 300)
     where id = v_av.equipo_id
     returning estado_desde into v_desde;
    v_paro := true;
  end if;
  perform set_config('averias.cambia_el_paro', p_id::text, true);
  update public.averias
     set estado = 'EN_ATENCION', nota_de_quien_reporto = v_nota,
         paro_el_equipo = v_paro,
         equipo_estado_antes = case when v_paro then v_equipo.estado end,
         equipo_nota_antes = case when v_paro then v_equipo.estado_nota end,
         equipo_parado_desde = case when v_paro then v_desde end
   where id = p_id;
  perform set_config('averias.cambia_el_paro', '', true);

  -- A Mantenimiento; sin nadie de Mantenimiento con cuenta activa, a Gerencia,
  -- para que no se pierda (como al reportar). La pantalla dice a quién llegó.
  v_titulo := 'No quedó bien: ' || v_av.numero || ' vuelve a Mantenimiento';
  perform public.avisar_a_permiso('averias.atender', v_titulo, v_nota, '/averias/' || p_id::text, 'averias', p_id);
  if exists (select 1 from public.notificaciones n
              where n.origen_tabla = 'averias' and n.origen_id = p_id and n.titulo = v_titulo and n.creado_en = now()) then
    v_a_quien := 'MANTENIMIENTO';
  elsif public.tiene_permiso('averias.atender') then
    -- Quien la devuelve es de Mantenimiento (reportó la suya): vuelve a su
    -- bandeja, y no es que falte nadie que la reciba.
    v_a_quien := 'SU_BANDEJA';
  else
    perform public.avisar_a_permiso('averias.ver', v_titulo || ' (no hay cuenta de Mantenimiento que la reciba)', v_nota,
                                    '/averias/' || p_id::text, 'averias', p_id);
    v_a_quien := case when exists (select 1 from public.notificaciones n
                                    where n.origen_tabla = 'averias' and n.origen_id = p_id and n.creado_en = now()
                                      and n.titulo like v_titulo || ' (%') then 'GERENCIA' end;
  end if;
  return query select p_id, 'EN_ATENCION'::text, v_paro, v_a_quien;
end;
$$;
comment on function public.averias_confirmar(uuid, boolean, text) is
  'Quien reportó la avería confirma que quedó bien (CERRADA → CONFIRMADA) o dice qué sigue fallando y vuelve a Mantenimiento (→ EN_ATENCION, y el equipo parado otra vez si la avería detiene el trabajo).';
revoke all on function public.averias_confirmar(uuid, boolean, text) from public, anon;
grant execute on function public.averias_confirmar(uuid, boolean, text) to authenticated;

-- 13. Lo que cada quien lee ---------------------------------------------------------------------
-- Cambia lo que devuelve: se quita y se vuelve a crear (las columnas de antes
-- siguen igual y en el mismo orden; las nuevas van al final).
--   gravedad: 1 detiene y es un riesgo, 2 detiene, 3 es un riesgo, 4 avería, 5 posible avería.
--   espera_de: quién la tiene ahora (MANTENIMIENTO o QUIEN_REPORTO); espera_desde, desde cuándo.
drop function if exists public.averias_visibles(uuid);
create or replace function public.averias_visibles(p_id uuid)
returns table (
  id uuid, numero text, tipo text, detiene_trabajo boolean, riesgo_personas boolean, descripcion text,
  estado text, creado_en timestamptz, dias_en_espera integer, alcance text,
  equipo_id uuid, equipo_codigo text, equipo_descripcion text, equipo_ubicacion text, equipo_estado text,
  area_id uuid, area text, paro_el_equipo boolean,
  reporto text, reporto_puesto text, fotos integer,
  anulado_en timestamptz, anulo text, motivo_anulacion text,
  gravedad integer, espera_de text, espera_desde timestamptz, es_mia boolean,
  diagnostico text, atendida_en timestamptz, atendio text,
  trabajo_hecho text, horas_parado numeric, cerrada_en timestamptz, cerro text,
  confirmada_en timestamptz, nota_de_quien_reporto text, veces_reabierta integer,
  paro_al_reportar boolean, equipo_parado_desde timestamptz, rq_enlazados integer,
  diagnostico_de text, diagnostico_en timestamptz)
language sql stable security definer set search_path to 'public' rows 200 as $$
  with yo as (
    select u.id, public.averias_areas_de_la_cuenta() as areas, public.puede_ver_todas_las_averias() as todo,
           public.averias_ve_las_de_riesgo() as riesgo
      from public.usuarios u
     where u.id = public.usuario_actual() and u.activo
  ), visibles as (
    select v.*, case when yo.todo then 'TODAS' when v.registrado_por = yo.id then 'PROPIA'
                     when v.area_id = any(yo.areas) then 'AREA' else 'RIESGO' end as alcance,
           v.registrado_por = yo.id as mia,
           -- Desde cuándo espera, lo mismo que cuentan los días: a Mantenimiento,
           -- desde que se reportó o desde que volvió; a quien reportó, desde el cierre.
           case when v.estado in ('REPORTADA', 'EN_ATENCION') then coalesce(v.reabierta_en, v.creado_en)
                when v.estado = 'CERRADA' then v.cerrada_en end as desde
      from public.averias v
      cross join yo
     where (p_id is null or v.id = p_id)
       -- La política `ver_averias`, tal cual.
       and (yo.todo or v.registrado_por = yo.id or v.area_id = any(yo.areas) or (v.riesgo_personas and yo.riesgo))
  )
  select v.id, v.numero, v.tipo, v.detiene_trabajo, v.riesgo_personas, v.descripcion,
         v.estado, v.creado_en,
         -- Lo que espera a Mantenimiento cuenta desde que se reportó (o desde que volvió);
         -- lo que espera la confirmación, desde que se cerró. Con la fecha de Lima.
         case when v.estado in ('REPORTADA', 'EN_ATENCION')
              then (now() at time zone 'America/Lima')::date - (coalesce(v.reabierta_en, v.creado_en) at time zone 'America/Lima')::date
              when v.estado = 'CERRADA'
              then (now() at time zone 'America/Lima')::date - (v.cerrada_en at time zone 'America/Lima')::date end,
         v.alcance,
         e.id, e.codigo, e.descripcion, e.ubicacion, e.estado,
         v.area_id, a.nombre, v.paro_el_equipo,
         btrim(u.nombres || ' ' || u.apellidos), ro.nombre,
         (select count(*)::integer from public.averia_fotos f where f.averia_id = v.id),
         v.anulado_en, btrim(an.nombres || ' ' || an.apellidos), v.motivo_anulacion,
         case when v.detiene_trabajo and v.riesgo_personas then 1
              when v.detiene_trabajo then 2
              when v.riesgo_personas then 3
              when v.tipo = 'AVERIA' then 4
              else 5 end,
         case when v.estado in ('REPORTADA', 'EN_ATENCION') then 'MANTENIMIENTO' when v.estado = 'CERRADA' then 'QUIEN_REPORTO' end,
         v.desde, v.mia,
         v.diagnostico, v.atendida_en, btrim(ate.nombres || ' ' || ate.apellidos),
         v.trabajo_hecho, v.horas_parado, v.cerrada_en, btrim(ce.nombres || ' ' || ce.apellidos),
         v.confirmada_en, v.nota_de_quien_reporto, v.veces_reabierta,
         v.paro_al_reportar,
         -- Desde cuándo está parado el equipo por este reporte, para proponer las horas al cerrar.
         case when v.paro_el_equipo and e.estado = 'PARADO' and e.estado_desde = v.equipo_parado_desde then v.equipo_parado_desde end,
         (select count(*)::integer from public.averia_requerimientos q where q.averia_id = v.id and q.quitado_en is null),
         btrim(dg.nombres || ' ' || dg.apellidos), v.diagnostico_en
    from visibles v
    join public.equipos e on e.id = v.equipo_id
    left join public.areas a on a.id = v.area_id
    join public.usuarios u on u.id = v.registrado_por
    left join public.roles ro on ro.id = u.rol_id
    left join public.usuarios an on an.id = v.anulado_por
    left join public.usuarios ate on ate.id = v.atendida_por
    left join public.usuarios ce on ce.id = v.cerrada_por
    left join public.usuarios dg on dg.id = v.diagnostico_por
   order by v.creado_en desc;
$$;
comment on function public.averias_visibles(uuid) is
  'Los reportes de avería que ve quien pregunta (uno, o todos con p_id vacío), con su equipo y su atención: todos (Mantenimiento, Gerencia), los suyos, los del área donde trabaja o que tiene a cargo, y SSOMA los que son un riesgo. gravedad 1 (detiene y es un riesgo) a 5 (posible avería); dias_en_espera con la fecha de Lima, de quien la tiene ahora (espera_de).';
revoke all on function public.averias_visibles(uuid) from public, anon;
grant execute on function public.averias_visibles(uuid) to authenticated;

-- 14. El recorrido, con la atención --------------------------------------------------------------
-- Reportada → Mantenimiento la atiende (diagnóstico) → la cierra → quien la
-- reportó confirma. Si no quedó bien, el paso se ve y vuelve a Mantenimiento.
-- Lo hecho sale de `averia_pasos`; lo que falta, del estado.
create or replace function public.recorrido_de_averias(p_ids uuid[])
returns table (
  documento uuid,
  orden     integer,
  paso      text,
  situacion text,
  puesto    text,
  en        timestamptz,
  dias      integer,
  espera    text,
  detalle   text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_yo   constant uuid := public.usuario_actual();
  v_todo constant boolean := public.puede_ver_todas_las_averias();
  v_areas  constant uuid[] := public.averias_areas_de_la_cuenta();
  v_riesgo constant boolean := public.averias_ve_las_de_riesgo();
begin
  if v_yo is null or not public.es_usuario_activo() then
    raise exception 'Entra con tu cuenta para ver el recorrido.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el recorrido de hasta 500 reportes a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with av as (
    select v.id, v.estado, v.registrado_por, v.creado_en, v.paro_al_reportar,
           v.atendida_en, v.reabierta_en, v.cerrada_en
      from public.averias v
     where v.id = any(p_ids)
       -- La política `ver_averias`, tal cual.
       and (v_todo or v.registrado_por = v_yo or v.area_id = any(v_areas) or (v.riesgo_personas and v_riesgo))
  ),
  pasos as (
    select a.id as av, 10 as canon, 'REPORTE' as paso, 'HECHO' as situacion, a.registrado_por as quien, null::text as puesto_fijo,
           a.creado_en as en, null::text as espera, case when a.paro_al_reportar then 'PARADO' end as detalle
      from av a
    union all
    -- Lo hecho después, en el orden en que pasó. El cierre dice las horas parado;
    -- la reapertura, que no quedó bien.
    select p.averia_id, 20, p.paso, 'HECHO', p.hecho_por, null, p.hecho_en, null,
           -- El cierre: las horas parado y el trabajo hecho, «26.5|Se cambió…».
           case when p.paso = 'CIERRE' then trim(to_char(p.horas_parado, 'FM9999990.0')) || coalesce('|' || left(p.texto, 300), '')
                -- Lo que dijo quien la reportó al devolverla: la ficha solo guarda la última.
                when p.paso = 'REAPERTURA' then left(p.texto, 300) end
      from public.averia_pasos p
      join av a on a.id = p.averia_id
    union all
    -- Quién la tiene ahora.
    select a.id, 30,
           case a.estado when 'REPORTADA' then 'ATENCION' when 'EN_ATENCION' then 'CIERRE' else 'CONFIRMACION' end,
           'AHORA', null,
           case when a.estado = 'CERRADA' then null else 'Mantenimiento' end,
           -- El mismo origen que los días en espera de la bandeja.
           case when a.estado in ('REPORTADA', 'EN_ATENCION') then coalesce(a.reabierta_en, a.creado_en)
                else a.cerrada_en end,
           case a.estado when 'REPORTADA' then 'ATENCION' when 'EN_ATENCION' then 'CIERRE' else 'CONFIRMACION' end,
           null
      from av a where a.estado in ('REPORTADA', 'EN_ATENCION', 'CERRADA')
    union all
    -- Lo que falta.
    select a.id, 40, 'CIERRE', 'PENDIENTE', null, null, null, null, null
      from av a where a.estado = 'REPORTADA'
    union all
    select a.id, 50, 'CONFIRMACION', 'PENDIENTE', null, null, null, null, null
      from av a where a.estado in ('REPORTADA', 'EN_ATENCION')
  )
  select p.av,
         (row_number() over (
            partition by p.av
            order by case p.situacion when 'HECHO' then 0 when 'AHORA' then 1 else 2 end,
                     case when p.situacion = 'HECHO' then p.en end, p.canon))::integer,
         p.paso, p.situacion,
         case when p.situacion = 'HECHO' then public.puesto(u)
              -- La confirmación la tiene quien reportó: su puesto, no su nombre.
              when p.situacion = 'AHORA' and p.paso = 'CONFIRMACION' then public.puesto(r)
              else p.puesto_fijo end,
         p.en,
         case when p.situacion = 'AHORA' then public.dias_en_espera(p.en) end,
         p.espera, p.detalle
    from pasos p
    left join public.usuarios u on u.id = p.quien
    left join av a2 on a2.id = p.av
    left join public.usuarios r on r.id = a2.registrado_por;
end;
$$;
comment on function public.recorrido_de_averias(uuid[]) is
  'El recorrido de cada reporte de avería, un paso por fila: lo hecho (de averia_pasos) con el puesto de quien lo hizo y su fecha; quién lo tiene ahora (Mantenimiento o quien la reportó, para confirmar) y hace cuántos días (fecha de Lima); y lo que falta. Devuelve solo los que la política ver_averias deja ver a quien llama.';
revoke all on function public.recorrido_de_averias(uuid[]) from public, anon;
grant execute on function public.recorrido_de_averias(uuid[]) to authenticated;
