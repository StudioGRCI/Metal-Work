-- =============================================================================
-- EL CONTRATO DEL SUBCONTRATO
-- -----------------------------------------------------------------------------
-- DKS lo pidió el 2026-10-20: «para servicios y para subcontratos debes dejar
-- adjuntar contratos al crearlos, o que se quede opcional para que después lo
-- adjunten».
--
-- El contrato firmado con el subcontratista vivía fuera del sistema. Desde aquí
-- se adjunta al registrar el subcontrato o después, cuando llega firmado. Es
-- opcional: sin contrato todo sigue como antes. El de la orden de servicio va
-- con los demás documentos de la OS (factura, boleta, recibo), en la tabla que
-- trae el PR de Adquisiciones: una sola tabla por documento de la OS.
--
-- Un contrato adjunto no se borra ni se cambia: si llega otra versión (una
-- adenda, el firmado que reemplaza al borrador), se adjunta encima y la
-- pantalla muestra el último, con los anteriores debajo como evidencia.
--
-- Quién: lo adjunta Administración (`subcontratos.gestionar`) y lo ve quien ve
-- los subcontratos (Administración, Tesorería, Gerencia); el supervisor del área
-- no, porque el contrato lleva el monto.
-- =============================================================================

-- 1. La tabla -----------------------------------------------------------------------------
create table if not exists public.subcontrato_contratos (
  id              uuid primary key,
  -- Índice (b): el detalle del subcontrato los lee por subcontrato.
  subcontrato_id  uuid not null constraint subcontrato_contratos_subcontrato_id_fkey references public.subcontratos(id) on delete restrict,
  archivo_ruta    text not null,
  archivo_nombre  text,
  archivo_mime    text not null,
  archivo_tamano  integer not null,
  -- Sin índice: ni (a) ni (b) ni (c). Nadie filtra por quién subió y un usuario no se borra.
  subido_por      uuid not null default public.usuario_actual() constraint subcontrato_contratos_subido_por_fkey references public.usuarios(id) on delete restrict,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint uq_subcontrato_contrato_ruta unique (archivo_ruta),
  constraint ck_subcontrato_contrato_nombre check (archivo_nombre is null or char_length(archivo_nombre) between 1 and 200)
);
create index if not exists ix_subcontrato_contratos_subcontrato on public.subcontrato_contratos (subcontrato_id, creado_en desc);
comment on table public.subcontrato_contratos is
  'Los contratos adjuntos a cada subcontrato, en el bucket subcontratos. El vigente es el último; los anteriores quedan como evidencia. No se borran ni se cambian.';

select public.activar_timestamps('subcontrato_contratos');
select public.activar_auditoria('subcontrato_contratos');
select public.activar_registro_de_prueba('subcontrato_contratos');

-- Un contrato adjunto queda como evidencia: ni se cambia ni se borra.
create or replace function public.fn_contrato_adjunto_no_se_toca()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Un contrato adjunto no se cambia ni se borra: si hay otra versión, adjúntala encima.' using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_contrato_adjunto_no_se_toca() from public, anon, authenticated;
create or replace trigger trg_subcontrato_contrato_no_se_toca
  before update or delete on public.subcontrato_contratos
  for each row execute function public.fn_contrato_adjunto_no_se_toca();

-- 2. Quién los lee --------------------------------------------------------------------------
-- Se escriben solo por las funciones de abajo: sin grant de insert, update ni delete.
alter table public.subcontrato_contratos enable row level security;
revoke all on public.subcontrato_contratos from public, anon, authenticated;
grant select on public.subcontrato_contratos to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subcontrato_contratos'
                   and policyname = 'ver_subcontrato_contratos') then
    create policy ver_subcontrato_contratos on public.subcontrato_contratos for select to authenticated
      using ((select public.puede_ver_subcontratos()));
  end if;
end $$;

-- 3. El archivo del subcontrato: el contrato va en el mismo bucket -------------------------
-- La ruta es la de siempre, {subcontrato}/{archivo}. Lo ve quien ve los
-- subcontratos si una fila lo nombra, y uno suelto lo retira su dueño.
-- Si una fila nombra ese archivo, mirado por encima del RLS: quien subió un
-- archivo y después perdió el permiso ya no ve el recibo o el contrato que lo
-- nombra, y sin esto la política lo dejaba borrarlo como si estuviera suelto.
create or replace function public.subcontrato_ruta_adjunta(p_ruta text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.recibos_honorarios r where r.archivo_ruta = p_ruta)
      or exists (select 1 from public.pagos_recibo_honorarios p where p.voucher_ruta = p_ruta)
      or exists (select 1 from public.subcontrato_contratos c where c.archivo_ruta = p_ruta);
$$;
revoke all on function public.subcontrato_ruta_adjunta(text) from public, anon;
grant execute on function public.subcontrato_ruta_adjunta(text) to authenticated;
comment on function public.subcontrato_ruta_adjunta(text) is
  'Si un recibo, un voucher o un contrato de subcontrato nombra esa ruta del bucket subcontratos. Solo responde sí o no: la usa la política que deja quitar un archivo suelto.';

do $$ begin
  alter policy subcontratos_ver on storage.objects using (
    bucket_id = 'subcontratos'
    and (owner_id = (select auth.uid())::text
         or ((select public.puede_ver_subcontratos())
             and (exists (select 1 from public.recibos_honorarios r where r.archivo_ruta = objects.name)
                  or exists (select 1 from public.pagos_recibo_honorarios p where p.voucher_ruta = objects.name)
                  or exists (select 1 from public.subcontrato_contratos c where c.archivo_ruta = objects.name)))));
  alter policy subcontratos_quitar_suelto on storage.objects using (
    bucket_id = 'subcontratos' and owner_id = (select auth.uid())::text
    and not public.subcontrato_ruta_adjunta(objects.name));
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
     or exists (select 1 from public.pagos_recibo_honorarios where voucher_ruta = p_ruta)
     or exists (select 1 from public.subcontrato_contratos where archivo_ruta = p_ruta) then
    raise exception 'Ese archivo ya está adjunto a otro registro: vuelve a adjuntarlo.' using errcode = 'check_violation';
  end if;
  return v_obj;
end;
$$;
revoke all on function public.subcontrato_archivo(uuid, text) from public, anon, authenticated;

-- 4. Adjuntar el contrato --------------------------------------------------------------------
create or replace function public.adjuntar_contrato_subcontrato(p_id uuid, p_subcontrato_id uuid, p_ruta text, p_nombre text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_sc     public.subcontratos%rowtype;
  v_obj    storage.objects%rowtype;
  v_nombre text := nullif(left(btrim(coalesce(p_nombre, '')), 200), '');
begin
  perform public.exigir_permiso('subcontratos.gestionar');
  if p_id is null then
    raise exception 'Vuelve a adjuntar el contrato.' using errcode = 'check_violation';
  end if;
  -- El reintento del mismo contrato devuelve el que ya entró.
  if exists (select 1 from public.subcontrato_contratos where id = p_id) then return p_id; end if;
  select * into v_sc from public.subcontratos where id = p_subcontrato_id for update;
  if not found then raise exception 'Ese subcontrato no existe. Recarga la pantalla.' using errcode = 'check_violation'; end if;
  if v_sc.estado = 'ANULADO' then
    raise exception 'El subcontrato % está anulado: queda como evidencia y ya no recibe contratos.', v_sc.numero using errcode = 'check_violation';
  end if;
  v_obj := public.subcontrato_archivo(p_subcontrato_id, p_ruta);
  insert into public.subcontrato_contratos (id, subcontrato_id, archivo_ruta, archivo_nombre, archivo_mime, archivo_tamano)
  values (p_id, p_subcontrato_id, p_ruta, v_nombre, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer);
  return p_id;
end;
$$;
revoke all on function public.adjuntar_contrato_subcontrato(uuid, uuid, text, text) from public, anon;
grant execute on function public.adjuntar_contrato_subcontrato(uuid, uuid, text, text) to authenticated;
comment on function public.adjuntar_contrato_subcontrato(uuid, uuid, text, text) is
  'Administración adjunta el contrato de un subcontrato no anulado, con el archivo ya en Storage. Si ya tenía uno, el nuevo pasa a ser el vigente. Exige subcontratos.gestionar.';
