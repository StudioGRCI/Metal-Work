-- =============================================================================
-- EL PADRÓN DE PROVEEDORES
-- -----------------------------------------------------------------------------
-- Logística escribe el proveedor a mano en cada orden de compra. En el Excel de
-- compras eso dejó 669 nombres para 264 proveedores reales: «PROBINSE» y
-- «PROBINSE IMPORT S.A.C.» cuentan como dos, y nadie puede sumar cuánto se le
-- compró a uno ni a quién se le debe. El sistema heredó el mismo campo de texto.
--
-- Desde aquí hay una sola lista, con su RUC comprobado, y la orden de compra
-- elige de ella en vez de escribir. El RUC se valida con el dígito de control de
-- SUNAT: un número mal copiado se rechaza al darlo de alta, no meses después en
-- la conciliación.
--
-- Lo que no cambia:
--   · Las compras ya registradas conservan el texto que se escribió. No se
--     adivina a qué proveedor del padrón corresponde cada una.
--   · `ordenes_compra_materiales.proveedor` sigue existiendo: lo leen el PDF de
--     la compra, Tesorería y el costeo. Cuando la compra viene del padrón, la
--     base copia ahí la razón social, así que todo eso sigue igual.
--   · Un proveedor no se borra: se da de baja y deja de ofrecerse.
--
-- Quién hace qué:
--   proveedores.ver     Logística, Contabilidad, Tesorería, Almacén, Gerencia,
--                       Costos y Materiales, Supervisión general.
--   proveedores.editar  Logística, Contabilidad y Gerencia.
--
-- Los datos de cuentas bancarias no entran todavía: son de Tesorería y van con
-- su módulo, detrás de su propio permiso.
-- =============================================================================

-- 1. El RUC se comprueba de verdad ---------------------------------------------
-- Once dígitos, prefijo de contribuyente (10 persona natural, 15/16/17 otros
-- regímenes, 20 empresa) y el dígito verificador de SUNAT: pesos 5,4,3,2,7,6,
-- 5,4,3,2; once menos el residuo; 10 se escribe 0 y 11 se escribe 1.
create or replace function public.ruc_es_valido(p_ruc text)
returns boolean language plpgsql immutable set search_path to 'public' as $$
declare
  v_pesos constant int[] := array[5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  v_suma  int := 0;
  v_dv    int;
begin
  if p_ruc is null or p_ruc !~ '^(10|15|16|17|20)[0-9]{9}$' then
    return false;
  end if;
  for i in 1..10 loop
    v_suma := v_suma + substr(p_ruc, i, 1)::int * v_pesos[i];
  end loop;
  v_dv := 11 - (v_suma % 11);
  if v_dv = 10 then v_dv := 0; elsif v_dv = 11 then v_dv := 1; end if;
  return v_dv = substr(p_ruc, 11, 1)::int;
end;
$$;
comment on function public.ruc_es_valido(text) is
  'Comprueba un RUC peruano: once dígitos, prefijo de contribuyente y dígito verificador de SUNAT.';
revoke all on function public.ruc_es_valido(text) from public, anon;
grant execute on function public.ruc_es_valido(text) to authenticated;

-- 2. Los permisos y a quién se dan ---------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('proveedores.ver', 'Logística', 'Consultar el padrón de proveedores'),
  ('proveedores.editar', 'Logística', 'Dar de alta, corregir y dar de baja proveedores del padrón')
on conflict (codigo) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, a.permiso
  from (values
    ('COMPRADOR', 'proveedores.ver'), ('COMPRADOR', 'proveedores.editar'),
    ('CONTABILIDAD', 'proveedores.ver'), ('CONTABILIDAD', 'proveedores.editar'),
    ('GERENTE', 'proveedores.ver'), ('GERENTE', 'proveedores.editar'),
    ('TESORERIA', 'proveedores.ver'),
    ('ALMACENERO', 'proveedores.ver'),
    ('COSTOS_MATERIALES', 'proveedores.ver'),
    ('SUPERVISOR_GENERAL', 'proveedores.ver')
  ) as a(rol, permiso)
  join public.roles r on r.codigo = a.rol
on conflict do nothing;

-- 3. La tabla -------------------------------------------------------------------
create table if not exists public.proveedores (
  id               uuid primary key default gen_random_uuid(),
  tipo_documento   public.tipo_documento_cliente not null default 'RUC',
  numero_documento text not null,
  razon_social     text not null,
  nombre_comercial text,
  rubro            text,
  contacto         text,
  telefono         text,
  correo           text,
  direccion        text,
  condicion_pago   text not null default 'CONTADO',
  dias_credito     integer not null default 0,
  observaciones    text,
  activo           boolean not null default true,
  creado_por       uuid default public.usuario_actual() references public.usuarios(id) on delete set null,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  constraint uq_proveedores_documento unique (tipo_documento, numero_documento),
  constraint ck_proveedores_documento check (
    case tipo_documento
      when 'RUC' then public.ruc_es_valido(numero_documento)
      when 'DNI' then numero_documento ~ '^[0-9]{8}$'
      else char_length(numero_documento) between 6 and 20
    end),
  constraint ck_proveedores_razon_social check (char_length(btrim(razon_social)) between 2 and 160),
  constraint ck_proveedores_textos check (
    char_length(coalesce(nombre_comercial, '')) <= 160
    and char_length(coalesce(rubro, '')) <= 120
    and char_length(coalesce(contacto, '')) <= 120
    and char_length(coalesce(telefono, '')) <= 40
    and char_length(coalesce(correo, '')) <= 160
    and char_length(coalesce(direccion, '')) <= 250
    and char_length(coalesce(observaciones, '')) <= 1000),
  constraint ck_proveedores_pago check (
    (condicion_pago = 'CONTADO' and dias_credito = 0)
    or (condicion_pago = 'CREDITO' and dias_credito between 1 and 365))
);

comment on table public.proveedores is
  'Padrón único de proveedores de Metal Work. La orden de compra elige de aquí; el RUC lleva su dígito verificador comprobado. No se borra: se da de baja.';
comment on column public.proveedores.rubro is
  'Qué le compra la empresa, en palabras de Logística: acero, pintura, pernos, servicios de torno…';
comment on column public.proveedores.condicion_pago is
  'La condición habitual con este proveedor. La orden de compra la propone y Logística la puede cambiar en cada compra.';

-- Mismo nombre en mayúsculas y sin espacios de más: evita «Probinse» y
-- «PROBINSE » como dos filas distintas en la pantalla.
create or replace function public.fn_proveedor_normalizar()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.numero_documento := upper(regexp_replace(coalesce(new.numero_documento, ''), '\s', '', 'g'));
  new.razon_social     := upper(regexp_replace(btrim(coalesce(new.razon_social, '')), '\s+', ' ', 'g'));
  new.nombre_comercial := nullif(regexp_replace(btrim(coalesce(new.nombre_comercial, '')), '\s+', ' ', 'g'), '');
  new.rubro            := nullif(btrim(coalesce(new.rubro, '')), '');
  new.contacto         := nullif(btrim(coalesce(new.contacto, '')), '');
  new.telefono         := nullif(btrim(coalesce(new.telefono, '')), '');
  new.correo           := nullif(lower(btrim(coalesce(new.correo, ''))), '');
  new.direccion        := nullif(btrim(coalesce(new.direccion, '')), '');
  new.observaciones    := nullif(btrim(coalesce(new.observaciones, '')), '');
  if tg_op = 'UPDATE' then
    new.creado_por := old.creado_por;
    new.creado_en  := old.creado_en;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_proveedor_normalizar() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_proveedor_normalizar'
                   and tgrelid = 'public.proveedores'::regclass) then
    create trigger trg_proveedor_normalizar before insert or update on public.proveedores
      for each row execute function public.fn_proveedor_normalizar();
  end if;
end $$;

select public.activar_timestamps('proveedores');
select public.activar_auditoria('proveedores');
select public.activar_registro_de_prueba('proveedores');

-- 4. Quién ve y quién escribe ---------------------------------------------------
-- La lectura también la tiene quien registra compras o comprobantes, aunque su
-- rol todavía no tenga el permiso del padrón: sin la lista no puede elegir.
alter table public.proveedores enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'proveedores' and policyname = 'ver_proveedores') then
    create policy ver_proveedores on public.proveedores for select to authenticated using (
      (select public.es_admin())
      or (select public.tiene_permiso('proveedores.ver'))
      or (select public.tiene_permiso('compras.crear'))
      or (select public.tiene_permiso('adquisiciones.registrar'))
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'proveedores' and policyname = 'crear_proveedores') then
    create policy crear_proveedores on public.proveedores for insert to authenticated with check (
      (select public.es_admin()) or (select public.tiene_permiso('proveedores.editar'))
    );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'proveedores' and policyname = 'editar_proveedores') then
    create policy editar_proveedores on public.proveedores for update to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('proveedores.editar')))
      with check ((select public.es_admin()) or (select public.tiene_permiso('proveedores.editar')));
  end if;
end $$;

-- Sin política de borrado y sin el privilegio: un proveedor con historia no se
-- borra, se da de baja.
revoke all on public.proveedores from public, anon, authenticated;
grant select, insert, update on public.proveedores to authenticated;

-- 5. La compra elige del padrón -------------------------------------------------
alter table public.ordenes_compra_materiales
  add column if not exists proveedor_id uuid references public.proveedores(id) on delete restrict;
comment on column public.ordenes_compra_materiales.proveedor_id is
  'Proveedor del padrón. Las compras anteriores al padrón lo tienen vacío y conservan el nombre escrito en `proveedor`.';
-- Sin índice: el padrón no se borra (no hay barrido de llave foránea que
-- acelerar) y ninguna pantalla filtra todavía las compras por proveedor. Ver
-- la skill `datos`, «Lo que ya se midió».

-- Cuando la compra nombra un proveedor del padrón, el texto lo pone la base: el
-- PDF, Tesorería y el costeo leen `proveedor` y siguen viendo lo mismo.
create or replace function public.fn_compra_nombre_del_padron()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_nombre text; v_activo boolean;
begin
  if new.proveedor_id is null then
    if tg_op = 'UPDATE' and old.proveedor_id is not null then
      raise exception 'Una compra del padrón no puede quedarse sin proveedor.' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  select razon_social, activo into v_nombre, v_activo from public.proveedores where id = new.proveedor_id;
  if not found then
    raise exception 'El proveedor elegido no está en el padrón.';
  end if;
  if tg_op = 'INSERT' and not v_activo then
    raise exception 'El proveedor % está dado de baja. Reactívalo en Proveedores o elige otro.', v_nombre
      using errcode = 'check_violation';
  end if;
  new.proveedor := v_nombre;
  return new;
end;
$$;
revoke all on function public.fn_compra_nombre_del_padron() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_compra_nombre_del_padron'
                   and tgrelid = 'public.ordenes_compra_materiales'::regclass) then
    create trigger trg_compra_nombre_del_padron
      before insert or update of proveedor_id on public.ordenes_compra_materiales
      for each row execute function public.fn_compra_nombre_del_padron();
  end if;
end $$;

-- 6. Emitir la compra con un proveedor del padrón -------------------------------
-- La misma compra agrupada de siempre (`crear_compra_agrupada` sigue haciendo
-- todas sus comprobaciones), pero el proveedor se elige por su id. Desde aquí
-- la aplicación ya no puede llamar a la versión que recibe el nombre escrito:
-- la orden de compra elige, no escribe.
create or replace function public.emitir_compra_agrupada(
  p_id uuid, p_proveedor_id uuid, p_referencia text, p_detalles jsonb,
  p_fecha date, p_condicion text, p_dias integer, p_moneda text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_proveedor public.proveedores%rowtype; v_actual uuid;
begin
  perform public.exigir_permiso('compras.crear');
  select * into v_proveedor from public.proveedores where id = p_proveedor_id;
  if not found then
    raise exception 'Elige un proveedor del padrón.';
  end if;
  -- Un reintento de la misma compra no choca con su propio proveedor.
  select proveedor_id into v_actual from public.ordenes_compra_materiales where id = p_id;
  if found and v_actual is distinct from p_proveedor_id then
    raise exception 'Esta compra ya existe con otro proveedor. Recarga antes de intentar de nuevo.';
  end if;
  if not found and not v_proveedor.activo then
    raise exception 'El proveedor % está dado de baja. Reactívalo en Proveedores o elige otro.', v_proveedor.razon_social;
  end if;

  perform public.crear_compra_agrupada(p_id, v_proveedor.razon_social, p_referencia, p_detalles,
                                       p_fecha, p_condicion, p_dias, p_moneda);
  update public.ordenes_compra_materiales set proveedor_id = p_proveedor_id
   where id = p_id and proveedor_id is null;
  return p_id;
end;
$$;
revoke all on function public.emitir_compra_agrupada(uuid, uuid, text, jsonb, date, text, integer, text) from public, anon;
grant execute on function public.emitir_compra_agrupada(uuid, uuid, text, jsonb, date, text, integer, text) to authenticated;

revoke execute on function public.crear_compra_agrupada(uuid, text, text, jsonb, date, text, integer, text) from authenticated;
-- La primera versión de la compra (una solicitud, sin precio) tampoco: ninguna
-- pantalla la usa desde que la compra se agrupa, y dejarla abierta sería la
-- puerta trasera del proveedor escrito a mano.
revoke execute on function public.crear_orden_compra_material(uuid, uuid, text, text, jsonb, date) from authenticated;
-- Ni su envoltura con condición de pago: es security definer y llama a la de
-- arriba como dueña, así que cerrar solo aquella no la cierra.
revoke execute on function public.crear_orden_compra_material_con_pago(uuid, uuid, text, text, jsonb, date, text, integer, text) from authenticated;
