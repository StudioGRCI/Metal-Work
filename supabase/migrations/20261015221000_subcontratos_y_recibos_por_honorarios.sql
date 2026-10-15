-- =============================================================================
-- SUBCONTRATOS Y RECIBOS POR HONORARIOS: ADMINISTRACIÓN LOS LLEVA, TESORERÍA PAGA
-- -----------------------------------------------------------------------------
-- Gerencia lo pidió el 2026-10-15: «en Administración generaremos lo que
-- vendría a ser subcontratos y su gestión, en donde subirán los RxH y después
-- estos pasarán por Tesorería y se podrá visualizar, para adjuntar su pago y
-- que Administración pueda verlo». Y, como todo lo demás desde ese día, cada
-- cosa va vinculada al código interno de la unidad.
--
-- Un SUBCONTRATO es un trabajo que el taller le encarga a una persona de fuera
-- (un soldador, un pintor, un electricista) para una unidad, o para la planta,
-- y que esa persona cobra con RECIBOS POR HONORARIOS (RxH): uno al terminar, o
-- uno por cada avance. Así queda:
--
--   * ADMINISTRACIÓN tiene el padrón de SUBCONTRATISTAS: quien emite el RxH es
--     una persona natural con RUC (empieza con 10), y la cuenta donde se le paga.
--   * ADMINISTRACIÓN registra el SUBCONTRATO: el subcontratista, el CÓDIGO
--     INTERNO de la unidad (PLANTA si no es de una unidad, igual que en la OS),
--     qué trabajo es y cuánto se pactó. Lleva número de la casa (SC-0001-2026).
--     Mientras está vigente se corrige; cuando el trabajo acabó lo da por
--     terminado (ya no recibe recibos), y si se registró por error lo anula con
--     su motivo. No se borra.
--   * ADMINISTRACIÓN SUBE CADA RxH contra su subcontrato: número del recibo,
--     fecha, monto bruto, si lleva la retención de cuarta categoría, y el PDF.
--     A Tesorería le llega el aviso.
--   * TESORERÍA PAGA cada recibo a la cuenta del subcontratista y adjunta el
--     VOUCHER. Paga el neto: el bruto menos la retención, si el recibo la lleva.
--     A Administración le llega el aviso, y ve el pago y su voucher en el
--     subcontrato.
--   * GERENCIA y CONTABILIDAD lo consultan. Contabilidad, por la retención, que
--     se declara en el PLAME del mes.
--
-- LA RETENCIÓN DE CUARTA CATEGORÍA. Quien paga un RxH le retiene el 8 % del
-- impuesto a la renta (art. 74 de la Ley del Impuesto a la Renta y su
-- reglamento) cuando el recibo pasa de S/ 1,500 y el emisor no tiene suspensión
-- de retenciones; el propio recibo electrónico dice si lleva retención.
-- Administración copia lo que dice el recibo; la base guarda el porcentaje de
-- ese día (8 %), y el monto retenido y el neto los calcula ella, para que la
-- pantalla, Tesorería y Contabilidad digan lo mismo.
--
-- Un recibo o un pago no se corrige: se anula con su motivo y se registra otra
-- vez. Las tablas se escriben solo por las funciones de abajo. Sin DROP: el
-- conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. Permisos ------------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('subcontratos.gestionar', 'Administración',
   'Llevar el padrón de subcontratistas, registrar los subcontratos por código interno, subir sus recibos por honorarios y terminarlos o anularlos'),
  ('subcontratos.pagar', 'Tesorería',
   'Pagar los recibos por honorarios de los subcontratos: ver la cuenta del subcontratista, registrar el pago y adjuntar el voucher'),
  ('subcontratos.ver', 'Administración',
   'Consultar los subcontratos, sus recibos por honorarios, la retención y los pagos')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where (r.codigo = 'ADMINISTRACION' and p.codigo = 'subcontratos.gestionar')
    or (r.codigo = 'TESORERIA' and p.codigo = 'subcontratos.pagar')
    or (r.codigo in ('GERENTE', 'CONTABILIDAD') and p.codigo = 'subcontratos.ver')
on conflict do nothing;

-- 2. La serie del subcontrato ----------------------------------------------------------
insert into public.series_documentarias (tipo, serie, prefijo, correlativo_actual, longitud, formato)
select 'SUBCONTRATO', '001', 'SC', 0, 4, 'SC-{numero}-{anio}'
 where not exists (select 1 from public.series_documentarias where tipo = 'SUBCONTRATO' and serie = '001');

-- 3. El padrón de subcontratistas -------------------------------------------------------
create table if not exists public.subcontratistas (
  id              uuid primary key default gen_random_uuid(),
  ruc             text not null,
  nombre          text not null,
  telefono        text,
  banco           text,
  numero_cuenta   text,
  cci             text,
  activo          boolean not null default true,
  creado_por      uuid default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint uq_subcontratista_ruc unique (ruc),
  -- Quien emite un recibo por honorarios es una persona natural: RUC 10 (o 15
  -- y 17, los de no domiciliados y casos especiales).
  constraint ck_subcontratista_ruc check (ruc ~ '^1[0-9]{10}$' and public.ruc_es_valido(ruc)),
  constraint ck_subcontratista_textos check (
    char_length(btrim(nombre)) between 2 and 160
    and char_length(coalesce(telefono, '')) <= 40
    and char_length(coalesce(banco, '')) <= 80),
  constraint ck_subcontratista_cuenta check (
    (numero_cuenta is null or numero_cuenta ~ '^[0-9]{6,30}$')
    and (cci is null or cci ~ '^[0-9]{20}$')
    and (banco is not null or (numero_cuenta is null and cci is null)))
);
comment on table public.subcontratistas is
  'Las personas de fuera a las que Administración les encarga trabajos y que cobran con recibos por honorarios, con la cuenta donde Tesorería les paga. No se borran: se dan de baja.';
select public.activar_timestamps('subcontratistas');
select public.activar_auditoria('subcontratistas');
select public.activar_registro_de_prueba('subcontratistas');

-- 4. El subcontrato ------------------------------------------------------------------------
create table if not exists public.subcontratos (
  id                 uuid primary key default gen_random_uuid(),
  numero             text not null,
  -- La llave al padrón: ni (a) ni (b) ni (c). La pantalla no filtra por
  -- subcontratista y un subcontratista no se borra nunca.
  subcontratista_id  uuid not null references public.subcontratistas(id) on delete restrict,
  codigo_interno     text not null,
  descripcion        text not null,
  moneda             text not null,
  monto              numeric(14, 2) not null,
  fecha_inicio       date,
  fecha_fin          date,
  estado             text not null default 'VIGENTE',
  terminado_por      uuid references public.usuarios(id) on delete restrict,
  terminado_en       timestamptz,
  creado_por         uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por        uuid references public.usuarios(id) on delete restrict,
  anulado_en         timestamptz,
  motivo_anulacion   text,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  constraint uq_subcontrato_numero unique (numero),
  constraint ck_subcontrato_datos check (
    char_length(codigo_interno) between 2 and 60
    and char_length(btrim(descripcion)) between 10 and 1000
    and moneda in ('PEN', 'USD')
    and monto > 0 and monto <= 999999999
    and (fecha_inicio is null or fecha_fin is null or fecha_fin >= fecha_inicio)),
  constraint ck_subcontrato_estado check (
    (estado = 'VIGENTE' and terminado_en is null and anulado_en is null)
    or (estado = 'TERMINADO' and terminado_en is not null and terminado_por is not null and anulado_en is null)
    or (estado = 'ANULADO' and anulado_en is not null and anulado_por is not null
        and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.subcontratos is
  'Un trabajo que Administración le encarga a un subcontratista para un código interno (o PLANTA), con lo pactado. Lleva número SC-…; no se borra: se termina o se anula.';
comment on column public.subcontratos.codigo_interno is
  'El código interno de la unidad (PLA_SR_O4_1_26/28…), o PLANTA, en mayúsculas: el mismo dato que une el RQ, la OC y la OS con la unidad.';
comment on column public.subcontratos.monto is
  'Lo pactado con el subcontratista, en bruto: lo que suman sus recibos por honorarios antes de la retención.';
-- La lista se lee de la más reciente a la más vieja (b).
create index if not exists ix_subcontratos_creado on public.subcontratos (creado_en desc);
select public.activar_timestamps('subcontratos');
select public.activar_auditoria('subcontratos');
select public.activar_registro_de_prueba('subcontratos');

-- 5. Los recibos por honorarios --------------------------------------------------------------
create table if not exists public.recibos_honorarios (
  id                    uuid primary key default gen_random_uuid(),
  subcontrato_id        uuid not null references public.subcontratos(id) on delete restrict,
  -- El emisor, copiado del subcontrato: un número de recibo vale una vez por emisor.
  subcontratista_id     uuid not null references public.subcontratistas(id) on delete restrict,
  numero                text not null,
  fecha_emision         date not null,
  concepto              text,
  moneda                text not null,
  monto_bruto           numeric(14, 2) not null,
  -- 8 si el recibo lleva la retención de cuarta categoría (el porcentaje de ese
  -- día, que no cambia si cambia la ley); 0 si no la lleva.
  retencion_porcentaje  numeric(5, 2) not null default 0,
  retencion_monto       numeric(14, 2) generated always as (round(monto_bruto * retencion_porcentaje / 100, 2)) stored,
  monto_neto            numeric(14, 2) generated always as (monto_bruto - round(monto_bruto * retencion_porcentaje / 100, 2)) stored,
  archivo_ruta          text not null,
  archivo_mime          text not null,
  archivo_tamano        integer not null,
  registrado_por        uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por           uuid references public.usuarios(id) on delete restrict,
  anulado_en            timestamptz,
  motivo_anulacion      text,
  creado_en             timestamptz not null default now(),
  actualizado_en        timestamptz not null default now(),
  -- Un archivo, un recibo; y la política de Storage lo busca por su ruta (b).
  constraint uq_recibo_honorarios_archivo unique (archivo_ruta),
  constraint ck_recibo_honorarios_datos check (
    numero ~ '^[A-Z0-9]{1,4}-[0-9]{1,8}$'
    and char_length(coalesce(concepto, '')) <= 300
    and moneda in ('PEN', 'USD')
    and monto_bruto > 0 and monto_bruto <= 999999999
    and retencion_porcentaje >= 0 and retencion_porcentaje < 30),
  constraint ck_recibo_honorarios_archivo check (
    archivo_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    and archivo_tamano between 1 and 10485760),
  constraint ck_recibo_honorarios_anulado check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.recibos_honorarios is
  'Cada recibo por honorarios que Administración sube contra un subcontrato, con su PDF. La base calcula la retención y el neto que paga Tesorería. No se borra: se anula.';
comment on column public.recibos_honorarios.monto_neto is
  'Lo que Tesorería le paga al subcontratista: el bruto menos la retención de cuarta categoría.';
-- Los recibos de un subcontrato (b); sirve también a la llave.
create index if not exists ix_recibos_honorarios_subcontrato on public.recibos_honorarios (subcontrato_id);
-- El mismo número del mismo emisor no entra dos veces mientras esté vigente.
-- Empieza por el número: un índice parcial que empezara por el emisor pasaría
-- por índice de su llave sin poder servirle (check 190). La llave al emisor
-- no lleva índice propio: ni (a) ni (b) ni (c), un subcontratista no se borra.
create unique index if not exists uq_recibo_honorarios_numero_vigente
  on public.recibos_honorarios (numero, subcontratista_id) where anulado_en is null;
select public.activar_timestamps('recibos_honorarios');
select public.activar_auditoria('recibos_honorarios');
select public.activar_registro_de_prueba('recibos_honorarios');

-- 6. Los pagos de Tesorería --------------------------------------------------------------------
create table if not exists public.pagos_recibo_honorarios (
  id                uuid primary key default gen_random_uuid(),
  recibo_id         uuid not null references public.recibos_honorarios(id) on delete restrict,
  fecha_pago        date not null,
  -- El neto del recibo cuando se pagó.
  monto             numeric(14, 2) not null,
  operacion         text,
  voucher_ruta      text not null,
  voucher_mime      text not null,
  voucher_tamano    integer not null,
  registrado_por    uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por       uuid references public.usuarios(id) on delete restrict,
  anulado_en        timestamptz,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint uq_pago_recibo_honorarios_voucher unique (voucher_ruta),
  constraint ck_pago_recibo_honorarios check (
    monto > 0
    and (operacion is null or char_length(btrim(operacion)) between 1 and 60)
    and voucher_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    and voucher_tamano between 1 and 10485760),
  constraint ck_pago_recibo_honorarios_anulado check (
    anulado_en is null
    or (anulado_por is not null and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.pagos_recibo_honorarios is
  'El pago de Tesorería de un recibo por honorarios, con su voucher. Uno vigente por recibo. No se borra: se anula.';
-- Los pagos de un recibo, también los anulados (b); sirve también a la llave.
create index if not exists ix_pagos_recibo_honorarios_recibo on public.pagos_recibo_honorarios (recibo_id);
-- Un recibo se paga una vez: otro pago entra solo si el anterior se anuló.
create unique index if not exists uq_pago_recibo_honorarios_vigente
  on public.pagos_recibo_honorarios (recibo_id) where anulado_en is null;
select public.activar_timestamps('pagos_recibo_honorarios');
select public.activar_auditoria('pagos_recibo_honorarios');
select public.activar_registro_de_prueba('pagos_recibo_honorarios');

-- 7. Lo que no se borra ni se corrige por debajo -------------------------------------------------
create or replace function public.fn_subcontratista_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Un subcontratista no se borra: se da de baja en el padrón.' using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_subcontratista_guardia() from public, anon, authenticated;
create or replace trigger trg_subcontratista_guardia
  before delete on public.subcontratistas
  for each row execute function public.fn_subcontratista_guardia();

create or replace function public.fn_subcontrato_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un subcontrato no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.estado = 'ANULADO' then
    raise exception 'El subcontrato % está anulado: queda como evidencia.', old.numero using errcode = 'check_violation';
  end if;
  if row(new.numero, new.subcontratista_id, new.moneda, new.creado_por, new.creado_en)
     is distinct from row(old.numero, old.subcontratista_id, old.moneda, old.creado_por, old.creado_en) then
    raise exception 'El número, el subcontratista y la moneda del subcontrato % no cambian: anúlalo y registra otro.', old.numero
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_subcontrato_guardia() from public, anon, authenticated;
create or replace trigger trg_subcontrato_guardia
  before update or delete on public.subcontratos
  for each row execute function public.fn_subcontrato_guardia();

-- De un recibo o de un pago solo cambia su anulación.
create or replace function public.fn_subcontrato_documento_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  -- Las columnas calculadas del recibo también: en un disparador BEFORE todavía
  -- no tienen su valor nuevo, y salen de columnas que sí se comparan.
  v_cambian constant text[] := array['anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en',
                                     'retencion_monto', 'monto_neto'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Un recibo por honorarios y su pago no se borran: se anulan con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'Eso está anulado: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Lo que dice un recibo o un pago no se corrige: anúlalo con su motivo y regístralo de nuevo.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_subcontrato_documento_guardia() from public, anon, authenticated;
create or replace trigger trg_recibo_honorarios_guardia
  before update or delete on public.recibos_honorarios
  for each row execute function public.fn_subcontrato_documento_guardia();
create or replace trigger trg_pago_recibo_honorarios_guardia
  before update or delete on public.pagos_recibo_honorarios
  for each row execute function public.fn_subcontrato_documento_guardia();

-- 8. Quién ve qué ---------------------------------------------------------------------------------
-- Administración (los lleva), Tesorería (paga) y Gerencia y Contabilidad
-- (consultan). La cuenta del subcontratista la ven las cuatro: es la de un
-- tercero que cobra a la empresa, como la del proveedor.
create or replace function public.puede_ver_subcontratos()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.es_admin() or public.tiene_permiso('subcontratos.gestionar')
      or public.tiene_permiso('subcontratos.pagar') or public.tiene_permiso('subcontratos.ver');
$$;
revoke all on function public.puede_ver_subcontratos() from public, anon;
grant execute on function public.puede_ver_subcontratos() to authenticated;

alter table public.subcontratistas enable row level security;
alter table public.subcontratos enable row level security;
alter table public.recibos_honorarios enable row level security;
alter table public.pagos_recibo_honorarios enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subcontratistas' and policyname = 'ver_subcontratistas') then
    create policy ver_subcontratistas on public.subcontratistas for select to authenticated
      using ((select public.puede_ver_subcontratos()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subcontratos' and policyname = 'ver_subcontratos') then
    create policy ver_subcontratos on public.subcontratos for select to authenticated
      using ((select public.puede_ver_subcontratos()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'recibos_honorarios' and policyname = 'ver_recibos_honorarios') then
    create policy ver_recibos_honorarios on public.recibos_honorarios for select to authenticated
      using ((select public.puede_ver_subcontratos()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'pagos_recibo_honorarios' and policyname = 'ver_pagos_recibo_honorarios') then
    create policy ver_pagos_recibo_honorarios on public.pagos_recibo_honorarios for select to authenticated
      using ((select public.puede_ver_subcontratos()));
  end if;
end $$;
-- Se escriben solo por las funciones de abajo.
revoke all on public.subcontratistas from public, anon, authenticated;
revoke all on public.subcontratos from public, anon, authenticated;
revoke all on public.recibos_honorarios from public, anon, authenticated;
revoke all on public.pagos_recibo_honorarios from public, anon, authenticated;
grant select on public.subcontratistas to authenticated;
grant select on public.subcontratos to authenticated;
grant select on public.recibos_honorarios to authenticated;
grant select on public.pagos_recibo_honorarios to authenticated;

-- 9. Los recibos y los vouchers en Storage --------------------------------------------------------
-- Privado, hasta 10 MB, PDF o foto. La ruta es {subcontrato}/{archivo}: suben
-- Administración (el recibo) y Tesorería (el voucher), solo a un subcontrato no
-- anulado. Los ven quien lo subió y quien ve los subcontratos, si una fila los
-- nombra; uno suelto (subido y no registrado) lo retira su dueño. Las políticas
-- se crean una vez y se cambian con alter.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('subcontratos', 'subcontratos', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'subcontratos_subir') then
    create policy subcontratos_subir on storage.objects for insert to authenticated with check (
      bucket_id = 'subcontratos' and owner_id = (select auth.uid())::text
      and (select public.es_admin() or public.tiene_permiso('subcontratos.gestionar') or public.tiene_permiso('subcontratos.pagar'))
      and exists (select 1 from public.subcontratos s
                   where s.id::text = split_part(objects.name, '/', 1) and s.estado <> 'ANULADO'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'subcontratos_ver') then
    create policy subcontratos_ver on storage.objects for select to authenticated using (
      bucket_id = 'subcontratos'
      and (owner_id = (select auth.uid())::text
           or ((select public.puede_ver_subcontratos())
               and (exists (select 1 from public.recibos_honorarios r where r.archivo_ruta = objects.name)
                    or exists (select 1 from public.pagos_recibo_honorarios p where p.voucher_ruta = objects.name)))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'subcontratos_quitar_suelto') then
    create policy subcontratos_quitar_suelto on storage.objects for delete to authenticated using (
      bucket_id = 'subcontratos' and owner_id = (select auth.uid())::text
      and not exists (select 1 from public.recibos_honorarios r where r.archivo_ruta = objects.name)
      and not exists (select 1 from public.pagos_recibo_honorarios p where p.voucher_ruta = objects.name));
  end if;
end $$;

-- El archivo que esta persona subió para este subcontrato, y que ninguna fila nombra todavía.
create or replace function public.subcontrato_archivo(p_subcontrato uuid, p_ruta text)
returns storage.objects language plpgsql stable set search_path to 'public' as $$
declare v_obj storage.objects%rowtype;
begin
  if p_ruta is null or p_ruta !~ ('^' || p_subcontrato::text || '/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$') then
    raise exception 'Vuelve a adjuntar el archivo.' using errcode = 'check_violation';
  end if;
  select * into v_obj from storage.objects where bucket_id = 'subcontratos' and name = p_ruta;
  if not found or v_obj.owner_id is distinct from public.usuario_actual()::text
     or v_obj.metadata->>'mimetype' not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
     or coalesce((v_obj.metadata->>'size')::bigint, 0) not between 1 and 10485760 then
    raise exception 'El archivo no terminó de subir: vuelve a adjuntarlo.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.recibos_honorarios where archivo_ruta = p_ruta)
     or exists (select 1 from public.pagos_recibo_honorarios where voucher_ruta = p_ruta) then
    raise exception 'Ese archivo ya está adjunto a otro registro: vuelve a adjuntarlo.' using errcode = 'check_violation';
  end if;
  return v_obj;
end;
$$;
revoke all on function public.subcontrato_archivo(uuid, text) from public, anon, authenticated;

-- 10. El padrón: dar de alta, corregir y dar de baja ---------------------------------------------------
-- Con un id nuevo lo da de alta; con uno que existe, lo corrige.
create or replace function public.guardar_subcontratista(
  p_id uuid, p_ruc text, p_nombre text, p_telefono text, p_banco text, p_numero_cuenta text, p_cci text, p_activo boolean
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_ruc     text := regexp_replace(coalesce(p_ruc, ''), '\s', '', 'g');
  v_nombre  text := regexp_replace(btrim(coalesce(p_nombre, '')), '\s+', ' ', 'g');
  v_banco   text := nullif(btrim(coalesce(p_banco, '')), '');
  v_cuenta  text := nullif(regexp_replace(coalesce(p_numero_cuenta, ''), '[\s-]', '', 'g'), '');
  v_cci     text := nullif(regexp_replace(coalesce(p_cci, ''), '[\s-]', '', 'g'), '');
  v_otro    public.subcontratistas%rowtype;
begin
  perform public.exigir_permiso('subcontratos.gestionar');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del subcontratista.' using errcode = 'check_violation';
  end if;
  if v_ruc !~ '^[0-9]{11}$' or not public.ruc_es_valido(v_ruc) then
    raise exception 'Ese RUC no es válido: son 11 dígitos y el último es de control. Cópialo del recibo.' using errcode = 'check_violation';
  end if;
  if v_ruc !~ '^1' then
    raise exception 'Quien emite recibos por honorarios es una persona natural: su RUC empieza con 10. Una empresa (RUC 20) va como proveedor de Logística.'
      using errcode = 'check_violation';
  end if;
  if char_length(v_nombre) not between 2 and 160 then
    raise exception 'Escribe el nombre completo, como sale en el recibo.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(btrim(p_telefono), '')) > 40 then
    raise exception 'El teléfono pasa de 40 caracteres.' using errcode = 'check_violation';
  end if;
  if (v_cuenta is not null or v_cci is not null) and v_banco is null then
    raise exception 'Escribe el banco de la cuenta.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_banco, '')) > 80 then
    raise exception 'El nombre del banco pasa de 80 caracteres.' using errcode = 'check_violation';
  end if;
  if v_cuenta is not null and v_cuenta !~ '^[0-9]{6,30}$' then
    raise exception 'El número de cuenta va solo con dígitos (de 6 a 30).' using errcode = 'check_violation';
  end if;
  if v_cci is not null and v_cci !~ '^[0-9]{20}$' then
    raise exception 'El CCI tiene 20 dígitos.' using errcode = 'check_violation';
  end if;

  select * into v_otro from public.subcontratistas where ruc = v_ruc and id <> p_id;
  if found then
    raise exception 'El RUC % ya está en el padrón, como %.', v_ruc, v_otro.nombre using errcode = 'unique_violation';
  end if;

  insert into public.subcontratistas (id, ruc, nombre, telefono, banco, numero_cuenta, cci, activo)
  values (p_id, v_ruc, v_nombre, nullif(btrim(coalesce(p_telefono, '')), ''), v_banco, v_cuenta, v_cci, coalesce(p_activo, true))
  on conflict (id) do update
     set ruc = excluded.ruc, nombre = excluded.nombre, telefono = excluded.telefono, banco = excluded.banco,
         numero_cuenta = excluded.numero_cuenta, cci = excluded.cci, activo = excluded.activo;
  return p_id;
end;
$$;
comment on function public.guardar_subcontratista(uuid, text, text, text, text, text, text, boolean) is
  'Administración da de alta o corrige un subcontratista (RUC de persona natural, nombre y cuenta), o lo da de baja. Exige subcontratos.gestionar.';
revoke all on function public.guardar_subcontratista(uuid, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.guardar_subcontratista(uuid, text, text, text, text, text, text, boolean) to authenticated;

-- 11. El subcontrato: registrar, corregir, terminar y anular -----------------------------------------
create or replace function public.subcontrato_datos_validos(
  p_codigo_interno text, p_descripcion text, p_monto numeric, p_fecha_inicio date, p_fecha_fin date
) returns void language plpgsql immutable set search_path to 'public' as $$
begin
  if char_length(btrim(coalesce(p_codigo_interno, ''))) not between 2 and 60 then
    raise exception 'Escribe el código interno de la unidad (de 2 a 60 caracteres). Si no es para una unidad, escribe PLANTA.'
      using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_descripcion, ''))) not between 10 and 1000 then
    raise exception 'Describe el trabajo en al menos 10 caracteres: qué se hace y en qué parte de la unidad.' using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe lo pactado, mayor que cero y en dos decimales.' using errcode = 'check_violation';
  end if;
  if p_fecha_inicio is not null and p_fecha_fin is not null and p_fecha_fin < p_fecha_inicio then
    raise exception 'La fecha de término no puede ser anterior a la de inicio.' using errcode = 'check_violation';
  end if;
end;
$$;
revoke all on function public.subcontrato_datos_validos(text, text, numeric, date, date) from public, anon, authenticated;

create or replace function public.registrar_subcontrato(
  p_id uuid, p_subcontratista_id uuid, p_codigo_interno text, p_descripcion text, p_moneda text, p_monto numeric,
  p_fecha_inicio date, p_fecha_fin date
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_sub     public.subcontratistas%rowtype;
  v_actual  public.subcontratos%rowtype;
  v_codigo  text := public.normalizar_codigo_interno(p_codigo_interno);
begin
  perform public.exigir_permiso('subcontratos.gestionar');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del subcontrato.' using errcode = 'check_violation';
  end if;
  perform public.subcontrato_datos_validos(p_codigo_interno, p_descripcion, p_monto, p_fecha_inicio, p_fecha_fin);
  if p_moneda is null or p_moneda not in ('PEN', 'USD') then
    raise exception 'Elige la moneda de lo pactado.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_actual from public.subcontratos where id = p_id;
  if found then
    -- El reintento del mismo formulario no registra otro.
    if v_actual.creado_por = public.usuario_actual() and v_actual.subcontratista_id = p_subcontratista_id
       and v_actual.monto = p_monto and v_actual.moneda = p_moneda then
      return p_id;
    end if;
    raise exception 'Este subcontrato ya existe con otros datos. Recarga antes de intentar de nuevo.';
  end if;
  select * into v_sub from public.subcontratistas where id = p_subcontratista_id;
  if not found then
    raise exception 'Elige un subcontratista del padrón.' using errcode = 'check_violation';
  end if;
  if not v_sub.activo then
    raise exception '% está dado de baja en el padrón: reactívalo o elige otro.', v_sub.nombre using errcode = 'check_violation';
  end if;

  insert into public.subcontratos (id, numero, subcontratista_id, codigo_interno, descripcion, moneda, monto, fecha_inicio, fecha_fin)
  values (p_id, public.siguiente_correlativo('SUBCONTRATO', '001', null), p_subcontratista_id, v_codigo, btrim(p_descripcion),
          p_moneda, p_monto, p_fecha_inicio, p_fecha_fin);
  return p_id;
end;
$$;
comment on function public.registrar_subcontrato(uuid, uuid, text, text, text, numeric, date, date) is
  'Administración registra un subcontrato con su subcontratista, su código interno (o PLANTA) y lo pactado; el número SC-… lo pone la base. Exige subcontratos.gestionar.';
revoke all on function public.registrar_subcontrato(uuid, uuid, text, text, text, numeric, date, date) from public, anon;
grant execute on function public.registrar_subcontrato(uuid, uuid, text, text, text, numeric, date, date) to authenticated;

-- Mientras está vigente se corrigen el código, el trabajo, lo pactado y las
-- fechas. El subcontratista y la moneda no: se anula y se registra otro.
create or replace function public.corregir_subcontrato(
  p_id uuid, p_codigo_interno text, p_descripcion text, p_monto numeric, p_fecha_inicio date, p_fecha_fin date
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_sc public.subcontratos%rowtype;
begin
  perform public.exigir_permiso('subcontratos.gestionar');
  perform public.subcontrato_datos_validos(p_codigo_interno, p_descripcion, p_monto, p_fecha_inicio, p_fecha_fin);
  select * into v_sc from public.subcontratos where id = p_id for update;
  if not found then raise exception 'Ese subcontrato no existe.' using errcode = 'check_violation'; end if;
  if v_sc.estado <> 'VIGENTE' then
    raise exception 'El subcontrato % está %: ya no se corrige.', v_sc.numero,
      case when v_sc.estado = 'ANULADO' then 'anulado' else 'terminado (reábrelo si hace falta)' end using errcode = 'check_violation';
  end if;
  update public.subcontratos
     set codigo_interno = public.normalizar_codigo_interno(p_codigo_interno), descripcion = btrim(p_descripcion),
         monto = p_monto, fecha_inicio = p_fecha_inicio, fecha_fin = p_fecha_fin
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.corregir_subcontrato(uuid, text, text, numeric, date, date) from public, anon;
grant execute on function public.corregir_subcontrato(uuid, text, text, numeric, date, date) to authenticated;

-- TERMINADO: el trabajo acabó y ya no recibe recibos; los que tiene se siguen
-- pagando. VIGENTE otra vez, si se terminó antes de tiempo.
create or replace function public.cambiar_estado_subcontrato(p_id uuid, p_estado text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_sc public.subcontratos%rowtype;
begin
  perform public.exigir_permiso('subcontratos.gestionar');
  if p_estado is null or p_estado not in ('VIGENTE', 'TERMINADO') then
    raise exception 'El subcontrato se da por terminado o se reabre.' using errcode = 'check_violation';
  end if;
  select * into v_sc from public.subcontratos where id = p_id for update;
  if not found then raise exception 'Ese subcontrato no existe.' using errcode = 'check_violation'; end if;
  if v_sc.estado = 'ANULADO' then
    raise exception 'El subcontrato % está anulado: queda como evidencia.', v_sc.numero using errcode = 'check_violation';
  end if;
  if v_sc.estado = p_estado then return p_id; end if;
  if p_estado = 'TERMINADO' then
    update public.subcontratos set estado = 'TERMINADO', terminado_por = public.usuario_actual(), terminado_en = now() where id = p_id;
  else
    update public.subcontratos set estado = 'VIGENTE', terminado_por = null, terminado_en = null where id = p_id;
  end if;
  return p_id;
end;
$$;
revoke all on function public.cambiar_estado_subcontrato(uuid, text) from public, anon;
grant execute on function public.cambiar_estado_subcontrato(uuid, text) to authenticated;

-- Se anula el que se registró por error, mientras no tenga recibos vigentes.
create or replace function public.anular_subcontrato(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_sc public.subcontratos%rowtype;
begin
  perform public.exigir_permiso('subcontratos.gestionar');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_sc from public.subcontratos where id = p_id for update;
  if not found then raise exception 'Ese subcontrato no existe.' using errcode = 'check_violation'; end if;
  if v_sc.estado = 'ANULADO' then return p_id; end if;
  if exists (select 1 from public.recibos_honorarios where subcontrato_id = p_id and anulado_en is null) then
    raise exception 'El subcontrato % tiene recibos por honorarios vigentes: anúlalos primero, o dalo por terminado.', v_sc.numero
      using errcode = 'check_violation';
  end if;
  update public.subcontratos
     set estado = 'ANULADO', terminado_por = null, terminado_en = null,
         anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.anular_subcontrato(uuid, text) from public, anon;
grant execute on function public.anular_subcontrato(uuid, text) to authenticated;

-- 12. Administración sube el recibo por honorarios ------------------------------------------------------
create or replace function public.registrar_recibo_honorarios(
  p_id uuid, p_subcontrato_id uuid, p_numero text, p_fecha_emision date, p_concepto text, p_monto_bruto numeric,
  p_retencion boolean, p_ruta text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_sc      public.subcontratos%rowtype;
  v_sub     public.subcontratistas%rowtype;
  v_obj     storage.objects%rowtype;
  v_numero  text := upper(regexp_replace(coalesce(p_numero, ''), '\s', '', 'g'));
  v_neto    numeric;
begin
  perform public.exigir_permiso('subcontratos.gestionar');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del recibo.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.recibos_honorarios where id = p_id) then return p_id; end if;
  select * into v_sc from public.subcontratos where id = p_subcontrato_id for update;
  if not found then raise exception 'Ese subcontrato no existe.' using errcode = 'check_violation'; end if;
  if v_sc.estado <> 'VIGENTE' then
    raise exception 'El subcontrato % está %: no recibe recibos.', v_sc.numero,
      case when v_sc.estado = 'ANULADO' then 'anulado' else 'terminado (reábrelo si falta un recibo)' end using errcode = 'check_violation';
  end if;
  if v_numero !~ '^[A-Z0-9]{1,4}-[0-9]{1,8}$' then
    raise exception 'Escribe el número del recibo como sale en él: la serie, un guion y el número, por ejemplo E001-25.'
      using errcode = 'check_violation';
  end if;
  if p_fecha_emision is null or p_fecha_emision > v_hoy or p_fecha_emision < v_hoy - 365 then
    raise exception 'Elige la fecha de emisión del recibo: de hoy hacia atrás, dentro del último año.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(btrim(p_concepto), '')) > 300 then
    raise exception 'El concepto pasa de 300 caracteres.' using errcode = 'check_violation';
  end if;
  if p_monto_bruto is null or p_monto_bruto <= 0 or p_monto_bruto > 999999999 or p_monto_bruto <> round(p_monto_bruto, 2) then
    raise exception 'Escribe el monto bruto del recibo (el total de honorarios), en dos decimales.' using errcode = 'check_violation';
  end if;
  if p_retencion is null then
    raise exception 'Indica si el recibo lleva retención del 8 %%: lo dice el mismo recibo.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.recibos_honorarios
              where subcontratista_id = v_sc.subcontratista_id and numero = v_numero and anulado_en is null) then
    raise exception 'El recibo % de este subcontratista ya está registrado.', v_numero using errcode = 'unique_violation';
  end if;
  v_obj := public.subcontrato_archivo(p_subcontrato_id, p_ruta);

  insert into public.recibos_honorarios (id, subcontrato_id, subcontratista_id, numero, fecha_emision, concepto, moneda,
                                         monto_bruto, retencion_porcentaje, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (p_id, p_subcontrato_id, v_sc.subcontratista_id, v_numero, p_fecha_emision, nullif(btrim(coalesce(p_concepto, '')), ''),
          v_sc.moneda, p_monto_bruto, case when p_retencion then 8 else 0 end,
          p_ruta, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo)
  returning monto_neto into v_neto;

  select * into v_sub from public.subcontratistas where id = v_sc.subcontratista_id;
  perform public.notificar_a_permiso('subcontratos.pagar', 'Recibo por honorarios por pagar: ' || v_numero,
    v_sub.nombre || ' · ' || v_sc.numero || ' · ' || v_sc.codigo_interno || ' · neto '
      || case when v_sc.moneda = 'USD' then 'US$ ' else 'S/ ' end || to_char(v_neto, 'FM999G999G990D00'),
    '/tesoreria/recibos-por-honorarios', 'recibos_honorarios', p_id, v_yo);
  return p_id;
end;
$$;
comment on function public.registrar_recibo_honorarios(uuid, uuid, text, date, text, numeric, boolean, text) is
  'Administración sube un recibo por honorarios contra un subcontrato vigente, con su archivo ya en Storage; avisa a Tesorería. Exige subcontratos.gestionar.';
revoke all on function public.registrar_recibo_honorarios(uuid, uuid, text, date, text, numeric, boolean, text) from public, anon;
grant execute on function public.registrar_recibo_honorarios(uuid, uuid, text, date, text, numeric, boolean, text) to authenticated;

-- Un recibo mal registrado se anula, mientras Tesorería no lo haya pagado.
create or replace function public.anular_recibo_honorarios(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_rec public.recibos_honorarios%rowtype;
begin
  perform public.exigir_permiso('subcontratos.gestionar');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_rec from public.recibos_honorarios where id = p_id for update;
  if not found then raise exception 'Ese recibo no existe.' using errcode = 'check_violation'; end if;
  if v_rec.anulado_en is not null then return p_id; end if;
  if exists (select 1 from public.pagos_recibo_honorarios where recibo_id = p_id and anulado_en is null) then
    raise exception 'Tesorería ya pagó el recibo %: para anularlo, primero Tesorería anula su pago.', v_rec.numero
      using errcode = 'check_violation';
  end if;
  update public.recibos_honorarios
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  return p_id;
end;
$$;
revoke all on function public.anular_recibo_honorarios(uuid, text) from public, anon;
grant execute on function public.anular_recibo_honorarios(uuid, text) to authenticated;

-- 13. Tesorería paga el recibo con su voucher --------------------------------------------------------------
create or replace function public.registrar_pago_recibo_honorarios(
  p_id uuid, p_recibo_id uuid, p_fecha_pago date, p_operacion text, p_ruta text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo   uuid := public.usuario_actual();
  v_hoy  date := (now() at time zone 'America/Lima')::date;
  v_rec  public.recibos_honorarios%rowtype;
  v_sc   public.subcontratos%rowtype;
  v_sub  public.subcontratistas%rowtype;
  v_obj  storage.objects%rowtype;
  v_op   text := nullif(btrim(coalesce(p_operacion, '')), '');
begin
  perform public.exigir_permiso('subcontratos.pagar');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del pago.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.pagos_recibo_honorarios where id = p_id) then return p_id; end if;
  select * into v_rec from public.recibos_honorarios where id = p_recibo_id for update;
  if not found then raise exception 'Ese recibo no existe.' using errcode = 'check_violation'; end if;
  if v_rec.anulado_en is not null then
    raise exception 'El recibo % está anulado: no se paga.', v_rec.numero using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.pagos_recibo_honorarios where recibo_id = p_recibo_id and anulado_en is null) then
    raise exception 'El recibo % ya está pagado. Si el pago salió mal, anúlalo y regístralo de nuevo.', v_rec.numero
      using errcode = 'check_violation';
  end if;
  if p_fecha_pago is null or p_fecha_pago > v_hoy or p_fecha_pago < v_rec.fecha_emision then
    raise exception 'Elige el día del pago: desde la fecha del recibo hasta hoy.' using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  v_obj := public.subcontrato_archivo(v_rec.subcontrato_id, p_ruta);

  insert into public.pagos_recibo_honorarios (id, recibo_id, fecha_pago, monto, operacion, voucher_ruta, voucher_mime, voucher_tamano, registrado_por)
  values (p_id, p_recibo_id, p_fecha_pago, v_rec.monto_neto, v_op, p_ruta, v_obj.metadata->>'mimetype',
          (v_obj.metadata->>'size')::integer, v_yo);

  select * into v_sc from public.subcontratos where id = v_rec.subcontrato_id;
  select * into v_sub from public.subcontratistas where id = v_rec.subcontratista_id;
  perform public.notificar_a_permiso('subcontratos.gestionar', 'Recibo por honorarios pagado: ' || v_rec.numero,
    v_sub.nombre || ' · ' || v_sc.numero || ' · Tesorería adjuntó el voucher.',
    '/subcontratos/' || v_sc.id, 'recibos_honorarios', p_recibo_id, v_yo);
  return p_id;
end;
$$;
comment on function public.registrar_pago_recibo_honorarios(uuid, uuid, date, text, text) is
  'Tesorería paga el neto de un recibo por honorarios con su voucher, ya en Storage; avisa a Administración. Exige subcontratos.pagar.';
revoke all on function public.registrar_pago_recibo_honorarios(uuid, uuid, date, text, text) from public, anon;
grant execute on function public.registrar_pago_recibo_honorarios(uuid, uuid, date, text, text) to authenticated;

-- Un pago mal registrado se anula: el recibo vuelve a quedar por pagar.
create or replace function public.anular_pago_recibo_honorarios(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_pago  public.pagos_recibo_honorarios%rowtype;
  v_rec   public.recibos_honorarios%rowtype;
begin
  perform public.exigir_permiso('subcontratos.pagar');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_pago from public.pagos_recibo_honorarios where id = p_id for update;
  if not found then raise exception 'Ese pago no existe.' using errcode = 'check_violation'; end if;
  if v_pago.anulado_en is not null then return p_id; end if;
  update public.pagos_recibo_honorarios
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  select * into v_rec from public.recibos_honorarios where id = v_pago.recibo_id;
  perform public.notificar_a_permiso('subcontratos.gestionar', 'Pago anulado: recibo ' || v_rec.numero,
    'Tesorería anuló el pago: el recibo vuelve a quedar por pagar. Motivo: ' || btrim(p_motivo),
    '/subcontratos/' || v_rec.subcontrato_id, 'recibos_honorarios', v_rec.id, public.usuario_actual());
  return p_id;
end;
$$;
revoke all on function public.anular_pago_recibo_honorarios(uuid, text) from public, anon;
grant execute on function public.anular_pago_recibo_honorarios(uuid, text) to authenticated;

-- 14. Los códigos internos que ya se usan, para elegir sin escribirlos mal ----------------------------------
create or replace function public.subcontratos_codigos_internos()
returns table (codigo text) language plpgsql stable security definer set search_path to 'public' as $$
begin
  perform public.exigir_permiso('subcontratos.gestionar');
  return query
    select c from (
      select public.normalizar_codigo_interno(r.codigo_interno) as c from public.requerimientos r
      union select public.normalizar_codigo_interno(o.codigo_interno) from public.ordenes_compra_materiales o
      union select public.normalizar_codigo_interno(s.codigo_interno) from public.ordenes_servicio s
      union select public.normalizar_codigo_interno(u.codigo_interno) from public.unidades u
      union select public.normalizar_codigo_interno(v.codigo_interno) from public.registro_vehiculos v
      union select public.normalizar_codigo_interno(t.codigo_interno) from public.tareos t where t.anulado_en is null
      union select x.codigo_interno from public.subcontratos x
    ) z
    where char_length(c) between 2 and 60
    order by c
    limit 500;
end;
$$;
revoke all on function public.subcontratos_codigos_internos() from public, anon;
grant execute on function public.subcontratos_codigos_internos() to authenticated;
