-- =============================================================================
-- EL ÁREA DE REQUERIMIENTOS: EL RQ DE INSUMOS Y EL REGISTRO DE VEHÍCULOS
-- -----------------------------------------------------------------------------
-- El ciclo real de la empresa (logistica-almacen-ingenieria.md §2) es: el área
-- pide → Requerimientos lo anota → Logística cotiza → Gerencia aprueba → OC →
-- Almacén recibe. Hasta hoy el paso de Requerimientos vive en
-- REQUERIMIENTOS DIARIOS.xlsx: 886 pedidos sin número, el área escrita de tres
-- maneras («MANTENIIMIENTO»), y 645 sin fecha de cierre. Desde aquí ese paso
-- nace en el sistema:
--
--   * El REQUERIMIENTO (RQ-0001-2026…) lo registra Requerimientos. Lleva el área
--     que lo necesita, el código interno de la unidad (texto libre por ahora:
--     cuando la OT lo use, ahí se vinculan), la justificación, y una línea por
--     insumo con su descripción, cantidad, unidad y categoría. Nace POR ATENDER
--     y le llega a Logística, que lo atiende vinculándole la orden de compra.
--     No depende de ninguna OT: después, los materiales de la OT pasarán por
--     aquí en lugar de ir directo a Logística.
--   * El REGISTRO DE VEHÍCULOS reemplaza a SEGUIMIENTO PORTERIA.xlsx
--     (MW-FOR-VIG-01 y JM-FOR-VIG-01: placa, unidad, empresa, motivo, fecha y
--     hora de ingreso y de salida, observaciones) y a la hoja «VEHICULOS» de
--     Requerimientos, que en realidad era el mismo registro. Una fila por cada
--     vez que un vehículo entra a la planta; la salida se marca en la misma.
--
-- Ninguno de los dos se borra: el RQ se anula con motivo y el registro de un
-- vehículo mal anotado también. En los registros no van nombres de personas:
-- el sistema guarda la cuenta que lo hizo y las pantallas muestran el área.
--
-- Las tablas se escriben solo por las funciones de abajo. Sin DROP: el conector
-- de producción no deja pasar ninguno.
-- =============================================================================

-- 1. Permisos y el puesto de Requerimientos ----------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('requerimientos.emitir', 'Requerimientos', 'Registrar un requerimiento (RQ) de insumos y mandarlo a Logística'),
  ('vehiculos.registrar', 'Vehículos', 'Registrar el ingreso y la salida de vehículos de la planta'),
  ('vehiculos.ver', 'Vehículos', 'Consultar el registro de ingreso y salida de vehículos')
on conflict (codigo) do nothing;

insert into public.roles (codigo, nombre, descripcion, nivel, es_sistema) values
  ('REQUERIMIENTOS', 'Requerimientos',
   'Registra los requerimientos de insumos para Logística y el ingreso y salida de vehículos', 45, true)
on conflict (codigo) do update set nombre = excluded.nombre, descripcion = excluded.descripcion;

-- La cuenta que pasa a Requerimientos era la de Costos y Materiales: se lleva
-- lo que ya veía para que no pierda ninguna pantalla con el cambio.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, rp.permiso_codigo
  from public.roles r
  cross join public.roles_permisos rp
  join public.roles origen on origen.id = rp.rol_id and origen.codigo = 'COSTOS_MATERIALES'
 where r.codigo = 'REQUERIMIENTOS'
on conflict do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where (r.codigo = 'REQUERIMIENTOS'
        and p.codigo in ('requerimientos.emitir', 'requerimientos.ver', 'vehiculos.registrar', 'vehiculos.ver'))
    or (r.codigo in ('GERENTE', 'ADMINISTRACION', 'SUPERVISOR_GENERAL') and p.codigo = 'vehiculos.ver')
on conflict do nothing;

-- 2. La serie del requerimiento --------------------------------------------------
-- No hay numeración anterior que continuar: el Excel no numera. El formato
-- administrativo usa R-n-2026; el de la casa queda RQ-0001-2026.
insert into public.series_documentarias (tipo, serie, prefijo, correlativo_actual, longitud, formato)
select 'REQUERIMIENTO', '001', 'RQ', 0, 4, 'RQ-{numero}-{anio}'
 where not exists (select 1 from public.series_documentarias where tipo = 'REQUERIMIENTO' and serie = '001');

-- 3. El requerimiento ------------------------------------------------------------
create table if not exists public.requerimientos (
  id                uuid primary key default gen_random_uuid(),
  numero            text not null,
  area_id           uuid not null references public.areas(id) on delete restrict,
  codigo_interno    text not null,
  justificacion     text not null,
  fecha_requerida   date,
  estado            text not null default 'POR_ATENDER',
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_por        uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint uq_requerimiento_numero unique (numero),
  constraint ck_rq_textos check (
    char_length(btrim(codigo_interno)) between 2 and 60
    and char_length(btrim(justificacion)) between 10 and 1000),
  constraint ck_rq_estado check (
    estado in ('POR_ATENDER', 'EN_ATENCION', 'ATENDIDO', 'ANULADO')
    and (estado <> 'ANULADO' or (anulado_por is not null and anulado_en is not null
                                 and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500)))
);
comment on table public.requerimientos is
  'Requerimientos de insumos (RQ-0001-2026…) que registra Requerimientos y atiende Logística. No se borran: se anulan.';
comment on column public.requerimientos.area_id is 'El área que necesita los insumos.';
comment on column public.requerimientos.codigo_interno is
  'Código interno de la unidad (PLA_SR_O4_1_26/28…), o PLANTA si no es para una unidad. Texto libre: servirá para vincular con la OT.';
comment on column public.requerimientos.estado is
  'POR_ATENDER al registrarse; EN_ATENCION y ATENDIDO los marca Logística; ANULADO con motivo.';

-- El listado va del más nuevo al más viejo.
create index if not exists ix_rq_creado on public.requerimientos (creado_en desc);

create table if not exists public.requerimiento_lineas (
  id                uuid primary key default gen_random_uuid(),
  requerimiento_id  uuid not null references public.requerimientos(id) on delete restrict,
  item              smallint not null,
  descripcion       text not null,
  cantidad          numeric(14, 3) not null,
  unidad_medida_id  uuid not null references public.unidades_medida(id) on delete restrict,
  categoria_id      uuid not null references public.categorias_material(id) on delete restrict,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  -- También es el índice de la llave hacia el requerimiento.
  constraint uq_rq_linea_item unique (requerimiento_id, item),
  constraint ck_rq_linea check (
    item between 1 and 100
    and char_length(btrim(descripcion)) between 3 and 300
    and cantidad > 0 and cantidad <= 999999999)
);
comment on table public.requerimiento_lineas is 'Un insumo del requerimiento: qué, cuánto, en qué unidad y de qué categoría.';

select public.activar_timestamps('requerimientos');
select public.activar_auditoria('requerimientos');
select public.activar_registro_de_prueba('requerimientos');
select public.activar_timestamps('requerimiento_lineas');
select public.activar_auditoria('requerimiento_lineas');
select public.activar_registro_de_prueba('requerimiento_lineas');

create or replace function public.fn_rq_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un requerimiento no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if row(new.numero, new.area_id, new.codigo_interno, new.justificacion, new.fecha_requerida, new.creado_por, new.creado_en)
     is distinct from row(old.numero, old.area_id, old.codigo_interno, old.justificacion, old.fecha_requerida, old.creado_por, old.creado_en) then
    raise exception 'El requerimiento % ya se registró: si cambió, anúlalo y registra otro.', old.numero
      using errcode = 'check_violation';
  end if;
  if old.estado in ('ATENDIDO', 'ANULADO') and new.estado is distinct from old.estado then
    raise exception 'El requerimiento % ya está %: queda como evidencia.', old.numero,
      case old.estado when 'ATENDIDO' then 'atendido' else 'anulado' end using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_rq_guardia() from public, anon, authenticated;

create or replace trigger trg_rq_guardia
  before update or delete on public.requerimientos
  for each row execute function public.fn_rq_guardia();

create or replace function public.fn_rq_linea_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un insumo del requerimiento no se borra: se anula el requerimiento.' using errcode = 'check_violation';
  end if;
  if row(new.requerimiento_id, new.item, new.descripcion, new.cantidad, new.unidad_medida_id, new.categoria_id)
     is distinct from row(old.requerimiento_id, old.item, old.descripcion, old.cantidad, old.unidad_medida_id, old.categoria_id) then
    raise exception 'Lo que se pidió en el requerimiento no cambia: si cambió, anúlalo y registra otro.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_rq_linea_guardia() from public, anon, authenticated;

create or replace trigger trg_rq_linea_guardia
  before update or delete on public.requerimiento_lineas
  for each row execute function public.fn_rq_linea_guardia();

-- Lo ve quien registra requerimientos, quien los consulta y Logística, que los atiende.
create or replace function public.puede_ver_requerimientos()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.es_admin() or public.tiene_permiso('requerimientos.emitir')
      or public.tiene_permiso('requerimientos.ver') or public.tiene_permiso('compras.crear');
$$;
revoke all on function public.puede_ver_requerimientos() from public, anon;
grant execute on function public.puede_ver_requerimientos() to authenticated;

alter table public.requerimientos enable row level security;
alter table public.requerimiento_lineas enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'requerimientos'
                   and policyname = 'ver_requerimientos') then
    create policy ver_requerimientos on public.requerimientos for select to authenticated
      using ((select public.puede_ver_requerimientos()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'requerimiento_lineas'
                   and policyname = 'ver_requerimiento_lineas') then
    create policy ver_requerimiento_lineas on public.requerimiento_lineas for select to authenticated
      using ((select public.puede_ver_requerimientos()));
  end if;
end $$;
revoke all on public.requerimientos from public, anon, authenticated;
revoke all on public.requerimiento_lineas from public, anon, authenticated;
grant select on public.requerimientos to authenticated;
grant select on public.requerimiento_lineas to authenticated;

-- Registrar --------------------------------------------------------------------
-- p_lineas: [{descripcion, cantidad, unidad_medida_id, categoria_id}, …]
create or replace function public.emitir_requerimiento(
  p_id uuid, p_area_id uuid, p_codigo_interno text, p_justificacion text, p_fecha_requerida date, p_lineas jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_actual   public.requerimientos%rowtype;
  v_numero   text;
  v_area     text;
  v_linea    jsonb;
  v_item     int := 0;
  v_desc     text;
  v_cant     numeric;
  v_unidad   uuid;
  v_cat      uuid;
  v_hoy      date := (now() at time zone 'America/Lima')::date;
begin
  perform public.exigir_permiso('requerimientos.emitir');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del requerimiento.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_codigo_interno, ''))) not between 2 and 60 then
    raise exception 'Escribe el código interno de la unidad (de 2 a 60 caracteres). Si no es para una unidad, escribe PLANTA.'
      using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_justificacion, ''))) not between 10 and 1000 then
    raise exception 'Explica para qué se necesita, en al menos 10 caracteres: Logística lo lee para priorizar.'
      using errcode = 'check_violation';
  end if;
  if p_fecha_requerida is not null and p_fecha_requerida < v_hoy then
    raise exception 'La fecha en que se necesita no puede ser anterior a hoy.' using errcode = 'check_violation';
  end if;
  select nombre into v_area from public.areas where id = p_area_id and activo;
  if v_area is null then
    raise exception 'Elige el área que necesita los insumos.' using errcode = 'check_violation';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agrega al menos un insumo al requerimiento.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_lineas) > 100 then
    raise exception 'Un requerimiento lleva hasta 100 insumos. Divídelo en dos.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_actual from public.requerimientos where id = p_id;
  if found then
    -- Un reintento del mismo formulario no duplica el requerimiento.
    if v_actual.creado_por = public.usuario_actual() and v_actual.area_id = p_area_id
       and v_actual.codigo_interno = btrim(p_codigo_interno) and v_actual.justificacion = btrim(p_justificacion) then
      return p_id;
    end if;
    raise exception 'Este requerimiento ya existe con otros datos. Recarga antes de intentar de nuevo.';
  end if;

  v_numero := public.siguiente_correlativo('REQUERIMIENTO', '001', null);
  insert into public.requerimientos (id, numero, area_id, codigo_interno, justificacion, fecha_requerida, creado_por)
  values (p_id, v_numero, p_area_id, btrim(p_codigo_interno), btrim(p_justificacion), p_fecha_requerida,
          public.usuario_actual());

  for v_linea in select value from jsonb_array_elements(p_lineas) loop
    v_item := v_item + 1;
    v_desc := btrim(coalesce(v_linea->>'descripcion', ''));
    if char_length(v_desc) not between 3 and 300 then
      raise exception 'Describe el insumo % en 3 a 300 caracteres.', v_item using errcode = 'check_violation';
    end if;
    begin
      v_cant := (v_linea->>'cantidad')::numeric;
      v_unidad := (v_linea->>'unidad_medida_id')::uuid;
      v_cat := (v_linea->>'categoria_id')::uuid;
    exception when others then
      raise exception 'Revisa la cantidad, la unidad y la categoría del insumo %.', v_item using errcode = 'check_violation';
    end;
    if v_cant is null or v_cant <= 0 or v_cant > 999999999 or v_cant <> round(v_cant, 3) then
      raise exception 'La cantidad del insumo % debe ser mayor que cero, con hasta tres decimales.', v_item
        using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.unidades_medida where id = v_unidad and activo) then
      raise exception 'Elige la unidad del insumo %.', v_item using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.categorias_material
                    where id = v_cat and activo and codigo <> 'ALM_POR_CLASIFICAR') then
      raise exception 'Elige la categoría del insumo %.', v_item using errcode = 'check_violation';
    end if;
    insert into public.requerimiento_lineas (requerimiento_id, item, descripcion, cantidad, unidad_medida_id, categoria_id)
    values (p_id, v_item, v_desc, v_cant, v_unidad, v_cat);
  end loop;

  -- Le llega a Logística, que lo atiende.
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, 'Requerimiento por atender: ' || v_numero,
         v_area || ' · ' || btrim(p_codigo_interno) || ' · ' || v_item || case when v_item = 1 then ' insumo' else ' insumos' end,
         '/requerimientos', 'requerimientos', p_id
    from public.usuarios u
    join public.areas a on a.id = u.area_id and a.codigo = 'LOG'
   where u.activo
     and u.id is distinct from public.usuario_actual()
     and exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id and rp.permiso_codigo = 'compras.crear');
  return p_id;
end;
$$;
revoke all on function public.emitir_requerimiento(uuid, uuid, text, text, date, jsonb) from public, anon;
grant execute on function public.emitir_requerimiento(uuid, uuid, text, text, date, jsonb) to authenticated;

-- Anular -----------------------------------------------------------------------
-- Mientras Logística no lo empieza a atender, Requerimientos lo anula con motivo.
create or replace function public.anular_requerimiento(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_rq public.requerimientos%rowtype;
begin
  perform public.exigir_permiso('requerimientos.emitir');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_rq from public.requerimientos where id = p_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  if v_rq.estado = 'ANULADO' then return p_id; end if;
  if v_rq.estado <> 'POR_ATENDER' then
    raise exception 'Logística ya está atendiendo el requerimiento %: pídele que lo detenga.', v_rq.numero
      using errcode = 'check_violation';
  end if;
  update public.requerimientos
     set estado = 'ANULADO', anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;

  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, 'Requerimiento anulado: ' || v_rq.numero, btrim(p_motivo), '/requerimientos', 'requerimientos', p_id
    from public.usuarios u
    join public.areas a on a.id = u.area_id and a.codigo = 'LOG'
   where u.activo
     and u.id is distinct from public.usuario_actual()
     and exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id and rp.permiso_codigo = 'compras.crear');
  return p_id;
end;
$$;
revoke all on function public.anular_requerimiento(uuid, text) from public, anon;
grant execute on function public.anular_requerimiento(uuid, text) to authenticated;

-- 4. El registro de vehículos ------------------------------------------------------
create table if not exists public.registro_vehiculos (
  id                   uuid primary key default gen_random_uuid(),
  placa                text,
  chasis               text,
  codigo_interno       text,
  unidad               text not null,
  empresa              text not null,
  motivo               text not null,
  ingreso_en           timestamptz not null,
  observacion_ingreso  text,
  ingreso_por          uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  salida_en            timestamptz,
  observacion_salida   text,
  salida_por           uuid references public.usuarios(id) on delete restrict,
  anulado_por          uuid references public.usuarios(id) on delete restrict,
  anulado_en           timestamptz,
  motivo_anulacion     text,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),
  constraint ck_vehiculo_identidad check (coalesce(placa, chasis, codigo_interno) is not null),
  constraint ck_vehiculo_textos check (
    (placa is null or char_length(placa) between 3 and 15)
    and (chasis is null or char_length(chasis) between 3 and 40)
    and (codigo_interno is null or char_length(btrim(codigo_interno)) between 2 and 60)
    and char_length(btrim(unidad)) between 2 and 120
    and char_length(btrim(empresa)) between 2 and 160
    and (observacion_ingreso is null or char_length(observacion_ingreso) <= 500)
    and (observacion_salida is null or char_length(observacion_salida) <= 500)),
  constraint ck_vehiculo_motivo check (motivo in ('FABRICACION', 'MANTENIMIENTO', 'GARANTIA', 'ARENADO', 'COCHERA', 'OTRO')),
  constraint ck_vehiculo_salida check (
    (salida_en is null and salida_por is null)
    or (salida_en is not null and salida_por is not null and salida_en >= ingreso_en)),
  constraint ck_vehiculo_anulado check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.registro_vehiculos is
  'Ingreso y salida de vehículos de la planta (MW-FOR-VIG-01 / JM-FOR-VIG-01). Una fila por cada ingreso; no se borra: se anula.';
comment on column public.registro_vehiculos.codigo_interno is 'Código interno de la unidad. Texto libre: servirá para vincular con la OT.';
comment on column public.registro_vehiculos.empresa is 'El cliente o dueño del vehículo, como lo dice la portería.';

-- Un vehículo no puede estar dos veces en la planta.
create unique index if not exists uq_vehiculo_placa_en_planta on public.registro_vehiculos (placa)
  where salida_en is null and anulado_en is null and placa is not null;
create unique index if not exists uq_vehiculo_chasis_en_planta on public.registro_vehiculos (chasis)
  where salida_en is null and anulado_en is null and chasis is not null;
-- El listado va por fecha de ingreso, del más nuevo al más viejo.
create index if not exists ix_vehiculo_ingreso on public.registro_vehiculos (ingreso_en desc);

select public.activar_timestamps('registro_vehiculos');
select public.activar_auditoria('registro_vehiculos');
select public.activar_registro_de_prueba('registro_vehiculos');

create or replace function public.fn_vehiculo_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un registro de vehículo no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'Ese registro de vehículo está anulado: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if row(new.placa, new.chasis, new.codigo_interno, new.unidad, new.empresa, new.motivo, new.ingreso_en,
         new.observacion_ingreso, new.ingreso_por, new.creado_en)
     is distinct from row(old.placa, old.chasis, old.codigo_interno, old.unidad, old.empresa, old.motivo, old.ingreso_en,
         old.observacion_ingreso, old.ingreso_por, old.creado_en) then
    raise exception 'El ingreso del vehículo ya quedó registrado: si está mal, anúlalo y regístralo de nuevo.'
      using errcode = 'check_violation';
  end if;
  if old.salida_en is not null
     and row(new.salida_en, new.salida_por, new.observacion_salida) is distinct from row(old.salida_en, old.salida_por, old.observacion_salida) then
    raise exception 'La salida del vehículo ya quedó registrada y no se corrige.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_vehiculo_guardia() from public, anon, authenticated;

create or replace trigger trg_vehiculo_guardia
  before update or delete on public.registro_vehiculos
  for each row execute function public.fn_vehiculo_guardia();

alter table public.registro_vehiculos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'registro_vehiculos'
                   and policyname = 'ver_registro_vehiculos') then
    create policy ver_registro_vehiculos on public.registro_vehiculos for select to authenticated using (
      (select public.es_admin())
      or (select public.tiene_permiso('vehiculos.ver'))
      or (select public.tiene_permiso('vehiculos.registrar'))
    );
  end if;
end $$;
revoke all on public.registro_vehiculos from public, anon, authenticated;
grant select on public.registro_vehiculos to authenticated;

-- La placa se guarda de una sola forma —mayúsculas, sin espacios ni guion—
-- para que «abc-123» y «ABC 123» sean el mismo vehículo al buscarlo.
create or replace function public.normalizar_placa(p text)
returns text language sql immutable set search_path to 'public' as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')), '');
$$;
revoke all on function public.normalizar_placa(text) from public, anon;
grant execute on function public.normalizar_placa(text) to authenticated;

create or replace function public.registrar_ingreso_vehiculo(
  p_id uuid, p_placa text, p_chasis text, p_codigo_interno text, p_unidad text, p_empresa text,
  p_motivo text, p_ingreso_en timestamptz, p_observacion text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_placa  text := public.normalizar_placa(p_placa);
  v_chasis text := nullif(upper(btrim(coalesce(p_chasis, ''))), '');
  v_codigo text := nullif(btrim(coalesce(p_codigo_interno, '')), '');
  v_cuando timestamptz := coalesce(p_ingreso_en, now());
  v_actual public.registro_vehiculos%rowtype;
begin
  perform public.exigir_permiso('vehiculos.registrar');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del ingreso.' using errcode = 'check_violation';
  end if;
  if coalesce(v_placa, v_chasis, v_codigo) is null then
    raise exception 'Anota la placa, el número de chasis o el código interno: sin eso no se sabe qué vehículo entró.'
      using errcode = 'check_violation';
  end if;
  if v_placa is not null and char_length(v_placa) not between 3 and 15 then
    raise exception 'La placa % no parece válida.', v_placa using errcode = 'check_violation';
  end if;
  if v_chasis is not null and char_length(v_chasis) not between 3 and 40 then
    raise exception 'El número de chasis va de 3 a 40 caracteres.' using errcode = 'check_violation';
  end if;
  if v_codigo is not null and char_length(v_codigo) not between 2 and 60 then
    raise exception 'El código interno va de 2 a 60 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_unidad, ''))) not between 2 and 120 then
    raise exception 'Describe el vehículo: tipo, marca o carrocería.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_empresa, ''))) not between 2 and 160 then
    raise exception 'Anota la empresa o el dueño del vehículo.' using errcode = 'check_violation';
  end if;
  if p_motivo is null or p_motivo not in ('FABRICACION', 'MANTENIMIENTO', 'GARANTIA', 'ARENADO', 'COCHERA', 'OTRO') then
    raise exception 'Elige el motivo del ingreso.' using errcode = 'check_violation';
  end if;
  if v_cuando > now() + interval '5 minutes' then
    raise exception 'La hora de ingreso no puede ser futura.' using errcode = 'check_violation';
  end if;
  if v_cuando < now() - interval '30 days' then
    raise exception 'Solo se registran ingresos de los últimos 30 días.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(p_observacion, '')) > 500 then
    raise exception 'La observación pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_actual from public.registro_vehiculos where id = p_id;
  if found then
    if v_actual.ingreso_por = public.usuario_actual() and v_actual.placa is not distinct from v_placa
       and v_actual.chasis is not distinct from v_chasis then
      return p_id;
    end if;
    raise exception 'Este ingreso ya existe con otros datos. Recarga antes de intentar de nuevo.';
  end if;
  if v_placa is not null and exists (select 1 from public.registro_vehiculos
                                       where placa = v_placa and salida_en is null and anulado_en is null) then
    raise exception 'El vehículo de placa % ya está en la planta: marca primero su salida.', v_placa
      using errcode = 'unique_violation';
  end if;
  if v_chasis is not null and exists (select 1 from public.registro_vehiculos
                                        where chasis = v_chasis and salida_en is null and anulado_en is null) then
    raise exception 'El chasis % ya está en la planta: marca primero su salida.', v_chasis
      using errcode = 'unique_violation';
  end if;

  insert into public.registro_vehiculos
    (id, placa, chasis, codigo_interno, unidad, empresa, motivo, ingreso_en, observacion_ingreso, ingreso_por)
  values
    (p_id, v_placa, v_chasis, v_codigo, btrim(p_unidad), btrim(p_empresa), p_motivo, v_cuando,
     nullif(btrim(coalesce(p_observacion, '')), ''), public.usuario_actual());
  return p_id;
end;
$$;
revoke all on function public.registrar_ingreso_vehiculo(uuid, text, text, text, text, text, text, timestamptz, text) from public, anon;
grant execute on function public.registrar_ingreso_vehiculo(uuid, text, text, text, text, text, text, timestamptz, text) to authenticated;

create or replace function public.registrar_salida_vehiculo(p_id uuid, p_salida_en timestamptz, p_observacion text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_reg    public.registro_vehiculos%rowtype;
  v_cuando timestamptz := coalesce(p_salida_en, now());
begin
  perform public.exigir_permiso('vehiculos.registrar');
  select * into v_reg from public.registro_vehiculos where id = p_id for update;
  if not found then raise exception 'El registro del vehículo no existe.'; end if;
  if v_reg.anulado_en is not null then
    raise exception 'Ese ingreso está anulado.' using errcode = 'check_violation';
  end if;
  if v_reg.salida_en is not null then return p_id; end if;
  if v_cuando > now() + interval '5 minutes' then
    raise exception 'La hora de salida no puede ser futura.' using errcode = 'check_violation';
  end if;
  if v_cuando < v_reg.ingreso_en then
    raise exception 'La salida no puede ser anterior al ingreso (%).',
      to_char(v_reg.ingreso_en at time zone 'America/Lima', 'DD/MM/YYYY HH24:MI') using errcode = 'check_violation';
  end if;
  if char_length(coalesce(p_observacion, '')) > 500 then
    raise exception 'La observación pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;
  update public.registro_vehiculos
     set salida_en = v_cuando, salida_por = public.usuario_actual(),
         observacion_salida = nullif(btrim(coalesce(p_observacion, '')), '')
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.registrar_salida_vehiculo(uuid, timestamptz, text) from public, anon;
grant execute on function public.registrar_salida_vehiculo(uuid, timestamptz, text) to authenticated;

create or replace function public.anular_registro_vehiculo(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_reg public.registro_vehiculos%rowtype;
begin
  perform public.exigir_permiso('vehiculos.registrar');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_reg from public.registro_vehiculos where id = p_id for update;
  if not found then raise exception 'El registro del vehículo no existe.'; end if;
  if v_reg.anulado_en is not null then return p_id; end if;
  update public.registro_vehiculos
     set anulado_en = now(), anulado_por = public.usuario_actual(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.anular_registro_vehiculo(uuid, text) from public, anon;
grant execute on function public.anular_registro_vehiculo(uuid, text) to authenticated;
