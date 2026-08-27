-- =============================================================================
-- LAS COTIZACIONES NO SE ELIMINAN: SE ANULAN, Y LA ANULACIÓN DEJA RASTRO
-- -----------------------------------------------------------------------------
-- El número de cada cotización sale del correlativo de la empresa (3568-2026,
-- 3569-2026…). Si una se borrara, quedaría un hueco en la serie y nadie podría
-- explicar después qué se cotizó con ese número ni a quién. Por eso acá el
-- borrado deja de existir para todos, incluido el administrador.
--
-- El camino correcto es anular, y la anulación cuenta la historia completa:
-- qué motivo tuvo, quién la decidió y cuándo. Lo sellado no se maquilla, y una
-- cotización anulada queda congelada como evidencia.
--
-- De paso viaja aquí el membrete: los datos fiscales de la empresa que van
-- impresos en el PDF de la cotización. Los necesita cualquier vendedor, tenga
-- o no el permiso de configuración, porque salen en todo documento que emite.
-- =============================================================================

-- ------------------------------------------------- el rastro de la anulación
alter table public.cotizaciones
  add column if not exists motivo_anulacion text,
  add column if not exists anulada_por uuid references public.usuarios(id) on delete set null,
  add column if not exists anulada_en  timestamptz;

comment on column public.cotizaciones.motivo_anulacion is
  'Por qué se dejó sin efecto. Obligatorio al anular: sin motivo no hay anulación.';
comment on column public.cotizaciones.anulada_por is
  'Quién decidió la anulación. Se sella solo, al momento de anular.';

-- Las anuladas de antes de esta regla no tienen motivo; se les pone uno honesto
-- para poder exigirlo de aquí en adelante.
update public.cotizaciones
   set motivo_anulacion = 'Anulada antes de que el sistema exigiera el motivo'
 where estado = 'ANULADA' and nullif(btrim(motivo_anulacion), '') is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'ck_cotizacion_motivo_anulacion'
       and conrelid = 'public.cotizaciones'::regclass
  ) then
    alter table public.cotizaciones
      add constraint ck_cotizacion_motivo_anulacion
      check (estado <> 'ANULADA' or nullif(btrim(motivo_anulacion), '') is not null);
  end if;
end $$;

create index if not exists idx_cotizaciones_anulada_por
  on public.cotizaciones(anulada_por);

-- Trigger propio (no se toca fn_cotizacion_transicion: la lección del blindaje).
-- security definer porque necesita ver las órdenes de trabajo aunque quien
-- anula no tenga ordenes.ver: si corriera con los permisos del vendedor, el
-- RLS le escondería la orden y la guarda se saltaría sin avisar.
create or replace function public.fn_cotizacion_anular()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_orden text;
begin
  -- Una anulada es evidencia: no se retoca ni un campo.
  if old.estado = 'ANULADA' then
    raise exception
      'La cotización % está anulada y se conserva como evidencia; emite una nueva en su lugar.',
      old.numero
      using errcode = 'restrict_violation';
  end if;

  if new.estado = 'ANULADA' then
    if nullif(btrim(new.motivo_anulacion), '') is null then
      raise exception 'Indica el motivo de la anulación de la cotización %.', old.numero
        using errcode = 'check_violation';
    end if;

    -- Si ya abrió una orden de trabajo viva, primero se resuelve la orden.
    select o.numero into v_orden
      from public.ordenes_trabajo o
     where o.cotizacion_id = new.id and o.estado <> 'ANULADA'
     limit 1;

    if v_orden is not null then
      raise exception
        'La cotización % abrió la orden %; anula primero esa orden de trabajo.',
        old.numero, v_orden
        using errcode = 'restrict_violation';
    end if;

    new.anulada_por := coalesce(new.anulada_por, public.usuario_actual());
    new.anulada_en  := coalesce(new.anulada_en, now());
  else
    -- Fuera de la anulación, el rastro no se escribe a mano.
    new.motivo_anulacion := old.motivo_anulacion;
    new.anulada_por      := old.anulada_por;
    new.anulada_en       := old.anulada_en;
  end if;

  return new;
end;
$$;

comment on function public.fn_cotizacion_anular is
  'Exige motivo al anular, sella quién y cuándo, y congela la cotización anulada como evidencia.';

drop trigger if exists trg_cotizacion_anular on public.cotizaciones;
create trigger trg_cotizacion_anular
  before update on public.cotizaciones
  for each row execute function public.fn_cotizacion_anular();

revoke all on function public.fn_cotizacion_anular() from public, anon, authenticated;

-- --------------------------------------------- el borrado deja de existir
-- Antes solo protegía APROBADA y ANULADA; ahora protege la serie completa.
create or replace function public.fn_cotizacion_bloquear_borrado()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  raise exception
    'Las cotizaciones no se eliminan: la % es parte del correlativo de la empresa. Anúlala indicando el motivo.',
    old.numero
    using errcode = 'restrict_violation';
end;
$$;

comment on function public.fn_cotizacion_bloquear_borrado is
  'Ninguna cotización se borra, esté en el estado que esté: se anula con motivo. El número emitido es historia.';

-- Cinturón y tirantes: además del trigger, ni la política ni el grant.
drop policy if exists borrar_cotizaciones on public.cotizaciones;
revoke delete on table public.cotizaciones from authenticated;

-- ------------------------------------------------------------- el membrete
-- Datos fiscales que encabezan todo documento impreso. security definer porque
-- la tabla empresa exige configuracion.ver y el membrete lo necesita cualquier
-- usuario activo que emita una cotización.
create or replace function public.datos_de_empresa()
returns table (
  razon_social     text,
  nombre_comercial text,
  ruc              text,
  direccion        text,
  distrito         text,
  provincia        text,
  departamento     text,
  telefono         text,
  correo           text,
  web              text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.es_usuario_activo() then
    raise exception 'Tu cuenta no está activa.' using errcode = 'insufficient_privilege';
  end if;

  return query
  select e.razon_social, e.nombre_comercial, e.ruc::text, e.direccion,
         e.distrito, e.provincia, e.departamento, e.telefono,
         e.correo::text, e.web
    from public.empresa e
   limit 1;
end;
$$;

comment on function public.datos_de_empresa is
  'El membrete: los datos fiscales que van impresos en cotizaciones y demás documentos emitidos.';

revoke all on function public.datos_de_empresa() from public, anon;
grant execute on function public.datos_de_empresa() to authenticated;
