-- =============================================================================
-- EL RECLAMO DE GARANTÍA
-- -----------------------------------------------------------------------------
-- DKS, 2026-11-26, «Plan aparte. Las demás áreas», entrega A.2: «reclamo
-- numerado del cliente, que no se borra nunca (se anula con motivo), lleva a su
-- OT de garantía y se cierra con su causa. Sin puesto nuevo: Ventas lo
-- registra, Administración abre la OT, Calidad anota la causa». El mínimo que
-- DKS aprobó el 2026-11-26, porque el SIG no trae formato de Garantías:
--
--   * EL RECLAMO (RG-0001-2026): la unidad que vuelve (su cliente sale de ella
--     y queda congelado), qué reclama, quién lo trae y su contacto, y hasta
--     cuatro fotos. LO REGISTRA VENTAS (`garantias.registrar`: Agente de
--     Ventas y Gerencia Comercial). Le avisa a Administración y al responsable
--     del área de Garantías (GRT); si nadie de Administración lo recibe, a
--     Gerencia.
--   * ADMINISTRACIÓN (`garantias.atender`) ABRE SU OT DE GARANTÍA con el flujo
--     de siempre (la OT sin cotización, que Gerencia aprueba) y la enlaza al
--     reclamo; o lo cierra como «No procede», con su motivo. Si la OT enlazada
--     se anula, enlaza otra.
--   * CALIDAD (`garantias.causa`) ANOTA LA CAUSA cuando la garantía de la OT
--     está terminada (`orden_garantia_terminada`, la misma que deja salir al
--     vehículo): fabricación, material, montaje, uso del cliente, desgaste u
--     otra, con su detalle. Con eso se cierra.
--   * QUIÉN VE QUÉ: Ventas, Administración, Calidad y el área de Garantías (sus
--     cuentas y su responsable) ven todos los reclamos; Gerencia los consulta
--     (`garantias.ver`). Los demás, ninguno.
--   * NO SE BORRA: mientras no tiene OT, quien lo registra (Ventas) o
--     Administración lo anulan con su motivo, y queda como evidencia. Con OT no
--     se anula: se anula la OT y se enlaza otra, o se cierra con su causa.
--
-- No restaura `garantia_reclamos` como lo retiró la 094 («lo que no es del
-- circuito se va»): aquel colgaba de la entrega de la OT (`ot_entregas`, que
-- ya no se usa), tenía cinco estados y lo evaluaba un área sin cuenta. Este va
-- por la unidad y la OT de garantía, que sí existen y ya se usan
-- (migraciones 20261021120000 y 20261120500000).
--
-- Las tablas se escriben solo por las funciones de abajo. Sin DROP: el conector
-- de producción no deja pasar ninguno.
-- =============================================================================

-- 1. Permisos -------------------------------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('garantias.registrar', 'Garantías',
   'Registrar el reclamo de garantía de un cliente (la unidad que vuelve, qué reclama y sus fotos), verlos todos y anular uno que todavía no tiene OT'),
  ('garantias.atender', 'Garantías',
   'Recibir cada reclamo de garantía, enlazarle su OT de garantía o cerrarlo como «No procede» con su motivo, y anular uno que todavía no tiene OT'),
  ('garantias.causa', 'Garantías',
   'Anotar la causa del reclamo de garantía cuando su OT está terminada, y cerrarlo'),
  ('garantias.ver', 'Garantías',
   'Consultar todos los reclamos de garantía, sin registrar ni cerrar')
on conflict (codigo) do update set modulo = excluded.modulo, descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where (r.codigo in ('VENDEDOR', 'GERENTE_COMERCIAL') and p.codigo = 'garantias.registrar')
    or (r.codigo = 'ADMINISTRACION' and p.codigo = 'garantias.atender')
    or (r.codigo = 'CALIDAD' and p.codigo = 'garantias.causa')
    or (r.codigo = 'GERENTE' and p.codigo = 'garantias.ver')
on conflict do nothing;

-- 2. La serie del reclamo -------------------------------------------------------------
insert into public.series_documentarias (tipo, serie, prefijo, correlativo_actual, longitud, formato)
select 'RECLAMO_GARANTIA', '001', 'RG', 0, 4, 'RG-{numero}-{anio}'
 where not exists (select 1 from public.series_documentarias where tipo = 'RECLAMO_GARANTIA' and serie = '001');

-- 3. El reclamo -----------------------------------------------------------------------
create table if not exists public.garantia_reclamos (
  id                  uuid primary key default gen_random_uuid(),
  numero              text not null,
  -- La unidad que vuelve. El cliente sale de ella al registrar y queda
  -- congelado: si la unidad cambia de dueño, el reclamo sigue siendo de quien
  -- reclamó. El historial de la unidad se lee por aquí (b).
  unidad_id           uuid not null references public.unidades(id) on delete restrict,
  cliente_id          uuid not null references public.clientes(id) on delete restrict,
  descripcion         text not null,
  trae                text,
  contacto            text,
  estado              text not null default 'REGISTRADO',
  -- Su OT de garantía, cuando Administración la enlaza. «El reclamo de esta
  -- OT» se busca por aquí (b), con el índice único de abajo.
  orden_id            uuid references public.ordenes_trabajo(id) on delete restrict,
  ot_enlazada_por     uuid references public.usuarios(id) on delete restrict,
  ot_enlazada_en      timestamptz,
  no_procede_motivo   text,
  causa               text,
  causa_detalle       text,
  -- Quién lo cerró y cuándo: con la causa (Calidad) o como «No procede» (Administración).
  cerrado_por         uuid references public.usuarios(id) on delete restrict,
  cerrado_en          timestamptz,
  registrado_por      uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  anulado_por         uuid references public.usuarios(id) on delete restrict,
  anulado_en          timestamptz,
  motivo_anulacion    text,
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  constraint uq_garantia_reclamos_numero unique (numero),
  constraint ck_garantia_reclamo_datos check (
    char_length(btrim(descripcion)) between 10 and 2000
    and (trae is null or char_length(trae) between 1 and 120)
    and (contacto is null or char_length(contacto) between 1 and 60)
    and estado in ('REGISTRADO', 'CON_OT', 'NO_PROCEDE', 'CERRADO', 'ANULADO')
    and (causa is null or causa in ('FABRICACION', 'MATERIAL', 'MONTAJE', 'USO_DEL_CLIENTE', 'DESGASTE', 'OTRA'))),
  constraint ck_garantia_reclamo_estado check (
    (estado = 'REGISTRADO' and orden_id is null and ot_enlazada_por is null and ot_enlazada_en is null
       and no_procede_motivo is null and causa is null and causa_detalle is null and cerrado_por is null and cerrado_en is null
       and anulado_en is null and anulado_por is null and motivo_anulacion is null)
    or (estado = 'CON_OT' and orden_id is not null and ot_enlazada_por is not null and ot_enlazada_en is not null
       and no_procede_motivo is null and causa is null and causa_detalle is null and cerrado_por is null and cerrado_en is null
       and anulado_en is null)
    or (estado = 'CERRADO' and orden_id is not null and causa is not null
       and char_length(btrim(coalesce(causa_detalle, ''))) between 10 and 1000
       and no_procede_motivo is null and cerrado_por is not null and cerrado_en is not null and anulado_en is null)
    -- Sin OT, o con la suya anulada (la guarda de cada función lo exige): la
    -- OT anulada queda nombrada como evidencia.
    or (estado = 'NO_PROCEDE' and causa is null
       and char_length(btrim(coalesce(no_procede_motivo, ''))) between 10 and 500
       and cerrado_por is not null and cerrado_en is not null and anulado_en is null)
    or (estado = 'ANULADO' and causa is null and anulado_en is not null and anulado_por is not null
       and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
);
comment on table public.garantia_reclamos is
  'El reclamo de garantía de un cliente (RG-…): la unidad que vuelve, qué reclama y sus fotos. Lo registra Ventas (garantias.registrar), Administración le enlaza su OT de garantía o lo cierra como «No procede» (garantias.atender) y Calidad lo cierra con su causa cuando la garantía está terminada (garantias.causa). Lo ven esos tres, el área de Garantías y Gerencia (garantias.ver). No se borra: sin OT, se anula con su motivo.';
comment on column public.garantia_reclamos.cliente_id is
  'El cliente de la unidad cuando se registró el reclamo, congelado.';
-- Una OT de garantía atiende un solo reclamo. También es el índice de su llave.
create unique index if not exists uq_garantia_reclamos_orden on public.garantia_reclamos (orden_id) where orden_id is not null;
-- La lista se lee de la más reciente a la más vieja (b).
create index if not exists ix_garantia_reclamos_creado on public.garantia_reclamos (creado_en desc);
-- El historial de cada unidad (b); sirve también a su llave.
create index if not exists ix_garantia_reclamos_unidad on public.garantia_reclamos (unidad_id, creado_en desc);
select public.activar_timestamps('garantia_reclamos');
select public.activar_auditoria('garantia_reclamos');
select public.activar_registro_de_prueba('garantia_reclamos');

-- 4. Sus fotos ------------------------------------------------------------------------
create table if not exists public.garantia_reclamo_fotos (
  id              uuid primary key default gen_random_uuid(),
  reclamo_id      uuid not null,
  orden           smallint not null,
  ruta            text not null,
  mime_type       text not null,
  tamano_bytes    integer not null,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint garantia_reclamo_fotos_reclamo_id_fkey foreign key (reclamo_id) references public.garantia_reclamos(id) on delete restrict,
  -- También es el índice de la llave hacia el reclamo.
  constraint uq_garantia_reclamo_foto_orden unique (reclamo_id, orden),
  -- Una foto, un reclamo; y la política de Storage la busca por su ruta.
  constraint uq_garantia_reclamo_foto_ruta unique (ruta),
  constraint ck_garantia_reclamo_foto check (
    orden between 1 and 4
    and mime_type in ('image/jpeg', 'image/png', 'image/webp')
    and tamano_bytes between 1 and 5242880)
);
comment on table public.garantia_reclamo_fotos is
  'Hasta 4 fotos de un reclamo de garantía, en el bucket privado fotos-garantias con la ruta {cuenta}/{reclamo}/…. Las ve quien ve el reclamo. No se cambian ni se borran.';
select public.activar_timestamps('garantia_reclamo_fotos');
select public.activar_registro_de_prueba('garantia_reclamo_fotos');

-- 5. Lo que no se borra ni se corrige por debajo ---------------------------------------
create or replace function public.fn_garantia_reclamo_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  -- Lo que fija quien registra: no cambia nunca.
  v_fijo constant text[] := array['id', 'numero', 'unidad_id', 'cliente_id', 'descripcion', 'trae', 'contacto', 'registrado_por', 'creado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Un reclamo de garantía no se borra: sin OT, se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.estado in ('ANULADO', 'CERRADO', 'NO_PROCEDE') then
    raise exception 'El reclamo % ya está cerrado: queda como evidencia.', old.numero using errcode = 'check_violation';
  end if;
  if (select jsonb_object_agg(k, to_jsonb(new) -> k) from unnest(v_fijo) k)
     is distinct from (select jsonb_object_agg(k, to_jsonb(old) -> k) from unnest(v_fijo) k) then
    raise exception 'Lo que dice el reclamo % no se corrige: si está mal, se anula con su motivo y se registra de nuevo.', old.numero
      using errcode = 'check_violation';
  end if;
  -- Quién y cuándo los pone la base, venga de donde venga el UPDATE.
  if new.estado = 'ANULADO' then
    if char_length(btrim(coalesce(new.motivo_anulacion, ''))) < 10 then
      raise exception 'Para anular el reclamo % escribe el motivo (al menos 10 letras).', old.numero using errcode = 'check_violation';
    end if;
    new.motivo_anulacion := btrim(new.motivo_anulacion);
    new.anulado_por := coalesce(public.usuario_actual(), new.anulado_por);
    new.anulado_en := now();
  elsif (new.anulado_por, new.anulado_en, new.motivo_anulacion) is distinct from (old.anulado_por, old.anulado_en, old.motivo_anulacion) then
    raise exception 'El reclamo % no está anulado: quién, cuándo y el motivo se anotan solo al anularlo.', old.numero using errcode = 'check_violation';
  end if;
  if new.estado in ('CERRADO', 'NO_PROCEDE') then
    new.cerrado_por := coalesce(public.usuario_actual(), new.cerrado_por);
    new.cerrado_en := now();
  end if;
  if new.orden_id is distinct from old.orden_id then
    new.ot_enlazada_por := coalesce(public.usuario_actual(), new.ot_enlazada_por);
    new.ot_enlazada_en := now();
  end if;
  return new;
end;
$$;
revoke all on function public.fn_garantia_reclamo_guardia() from public, anon, authenticated;
create or replace trigger trg_garantia_reclamo_guardia
  before update or delete on public.garantia_reclamos
  for each row execute function public.fn_garantia_reclamo_guardia();

create or replace function public.fn_garantia_reclamo_foto_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Las fotos de un reclamo de garantía no se cambian ni se borran: quedan como evidencia.'
    using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_garantia_reclamo_foto_guardia() from public, anon, authenticated;
create or replace trigger trg_garantia_reclamo_foto_guardia
  before update or delete on public.garantia_reclamo_fotos
  for each row execute function public.fn_garantia_reclamo_foto_guardia();

-- 6. Quién ve qué -----------------------------------------------------------------------
-- Ventas, Administración, Calidad y Gerencia, por su permiso; y el área de
-- Garantías: sus cuentas activas y su responsable (`areas.jefe_id`), que puede
-- ser de otra área.
--
-- Nunca devuelve null: `garantias_reclamos_visibles` corta con `if not …`, y un
-- null ahí no corta. Con el área sin responsable, «responsable = yo» era null y
-- cualquier cuenta veía todos los reclamos (lo encontró el banco, con Tesorería).
create or replace function public.puede_ver_los_reclamos_de_garantia()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce(
    public.usuario_actual() is not null and public.es_usuario_activo()
     and (public.es_admin()
          or public.tiene_permiso('garantias.registrar') or public.tiene_permiso('garantias.atender')
          or public.tiene_permiso('garantias.causa') or public.tiene_permiso('garantias.ver')
          or exists (select 1 from public.usuarios u
                       join public.areas a on a.codigo = 'GRT'
                      where u.id = public.usuario_actual() and u.activo
                        and (u.area_id = a.id or a.jefe_id = u.id))),
    false);
$$;
revoke all on function public.puede_ver_los_reclamos_de_garantia() from public, anon;
grant execute on function public.puede_ver_los_reclamos_de_garantia() to authenticated;

alter table public.garantia_reclamos enable row level security;
alter table public.garantia_reclamo_fotos enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'garantia_reclamos' and policyname = 'ver_garantia_reclamos') then
    create policy ver_garantia_reclamos on public.garantia_reclamos for select to authenticated
      using ((select public.puede_ver_los_reclamos_de_garantia()));
  end if;
  -- Quien ve el reclamo ve sus fotos: la consulta pasa por la política de arriba.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'garantia_reclamo_fotos' and policyname = 'ver_garantia_reclamo_fotos') then
    create policy ver_garantia_reclamo_fotos on public.garantia_reclamo_fotos for select to authenticated
      using (exists (select 1 from public.garantia_reclamos r where r.id = reclamo_id));
  end if;
end $$;
-- Se escriben solo por las funciones de abajo: sin políticas de escritura ni grant.
revoke all on public.garantia_reclamos from public, anon, authenticated;
revoke all on public.garantia_reclamo_fotos from public, anon, authenticated;
grant select on public.garantia_reclamos to authenticated;
grant select on public.garantia_reclamo_fotos to authenticated;

-- 7. Las fotos en Storage ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-garantias', 'fotos-garantias', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- «Ningún reclamo la nombra» se pregunta por encima del RLS.
create or replace function public.garantias_foto_anotada(p_ruta text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.garantia_reclamo_fotos f where f.ruta = p_ruta);
$$;
revoke all on function public.garantias_foto_anotada(text) from public, anon;
grant execute on function public.garantias_foto_anotada(text) to authenticated;

-- La ruta es {cuenta}/{reclamo}/{foto}: cada cuenta sube solo a su carpeta, y
-- solo quien registra reclamos. La ve quien la subió y quien ve el reclamo que
-- la nombra; una suelta la retira su dueño mientras ningún reclamo la nombre.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'garantias_subir_foto') then
    create policy garantias_subir_foto on storage.objects for insert to authenticated with check (
      bucket_id = 'fotos-garantias' and owner_id = (select auth.uid())::text
      and split_part(name, '/', 1) = (select auth.uid())::text
      and (select public.es_usuario_activo())
      and ((select public.es_admin()) or (select public.tiene_permiso('garantias.registrar'))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'garantias_ver_foto') then
    create policy garantias_ver_foto on storage.objects for select to authenticated using (
      bucket_id = 'fotos-garantias'
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.garantia_reclamo_fotos f where f.ruta = objects.name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'garantias_quitar_foto_suelta') then
    create policy garantias_quitar_foto_suelta on storage.objects for delete to authenticated using (
      bucket_id = 'fotos-garantias' and owner_id = (select auth.uid())::text
      and not public.garantias_foto_anotada(objects.name));
  end if;
end $$;

-- p_fotos: ["{cuenta}/{reclamo}/{foto}.jpg", …], ya subidas a fotos-garantias. De 0 a 4.
-- La llama solo garantias_registrar.
create or replace function public.garantias_anotar_fotos(p_reclamo uuid, p_fotos jsonb)
returns void language plpgsql set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_fotos  jsonb := coalesce(p_fotos, '[]'::jsonb);
  v_ruta   text;
  v_objeto storage.objects%rowtype;
  v_n      int := 0;
begin
  if jsonb_typeof(v_fotos) <> 'array' then
    raise exception 'Vuelve a poner las fotos del reclamo.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_fotos) > 4 then
    raise exception 'Van hasta 4 fotos por reclamo.' using errcode = 'check_violation';
  end if;
  for v_ruta in select jsonb_array_elements_text(v_fotos) loop
    v_n := v_n + 1;
    if v_yo is null or v_ruta !~ ('^' || v_yo::text || '/' || p_reclamo::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
      raise exception 'Vuelve a poner las fotos del reclamo.' using errcode = 'check_violation';
    end if;
    select * into v_objeto from storage.objects where bucket_id = 'fotos-garantias' and name = v_ruta;
    if not found or v_objeto.owner_id is distinct from v_yo::text
       or v_objeto.metadata->>'mimetype' not in ('image/jpeg', 'image/png', 'image/webp')
       or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 5242880 then
      raise exception 'La foto % no terminó de subir: quítala y vuelve a ponerla.', v_n using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.garantia_reclamo_fotos where ruta = v_ruta) then
      raise exception 'La foto % está repetida: quítala.', v_n using errcode = 'check_violation';
    end if;
    insert into public.garantia_reclamo_fotos (reclamo_id, orden, ruta, mime_type, tamano_bytes)
    values (p_reclamo, v_n, v_ruta, v_objeto.metadata->>'mimetype', (v_objeto.metadata->>'size')::integer);
  end loop;
end;
$$;
revoke all on function public.garantias_anotar_fotos(uuid, jsonb) from public, anon, authenticated;

-- 8. Las unidades para elegir ----------------------------------------------------------------
-- Ventas ya lee clientes y unidades con su permiso; esta da en una sola lectura
-- lo que hace falta para reconocer la unidad que vuelve, con su cliente, y si
-- ya tiene un reclamo abierto.
create or replace function public.garantias_unidades_para_elegir()
returns table (id uuid, placa text, codigo_interno text, carroceria text, marca text, cliente_id uuid, cliente text, reclamo_abierto text)
language plpgsql stable security definer set search_path to 'public' rows 200 as $$
#variable_conflict use_column
begin
  if public.usuario_actual() is null or not public.es_usuario_activo()
     or not (public.es_admin() or public.tiene_permiso('garantias.registrar')) then
    raise exception 'El reclamo de garantía lo registra Ventas.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select u.id, u.placa::text, u.codigo_interno::text, tc.nombre::text, u.marca::text, c.id, c.razon_social::text,
           (select r.numero from public.garantia_reclamos r
             where r.unidad_id = u.id and r.estado in ('REGISTRADO', 'CON_OT')
             order by r.creado_en desc limit 1)
      from public.unidades u
      join public.clientes c on c.id = u.cliente_id
      left join public.tipos_carroceria tc on tc.id = u.tipo_carroceria_id
     where u.activo
     order by c.razon_social, u.placa nulls last, u.codigo_interno nulls last;
end;
$$;
comment on function public.garantias_unidades_para_elegir() is
  'Las unidades activas con su cliente, para elegir cuál vuelve por garantía, y el número del reclamo abierto que ya tenga. Exige garantias.registrar.';
revoke all on function public.garantias_unidades_para_elegir() from public, anon;
grant execute on function public.garantias_unidades_para_elegir() to authenticated;

-- 9. A quién le llegó el aviso -----------------------------------------------------------------
create or replace function public.garantias_a_quien_se_aviso(p_reclamo uuid)
returns table (administracion boolean, garantias boolean, gerencia boolean)
language sql stable security definer set search_path to 'public' as $$
  with avisados as (
    select n.usuario_id, u.rol_id
      from public.notificaciones n
      join public.usuarios u on u.id = n.usuario_id
     where n.origen_tabla = 'garantia_reclamos' and n.origen_id = p_reclamo
  )
  select
    exists (select 1 from avisados a join public.roles_permisos rp on rp.rol_id = a.rol_id and rp.permiso_codigo = 'garantias.atender'),
    exists (select 1 from avisados a
             where a.usuario_id = (select ar.jefe_id from public.areas ar where ar.codigo = 'GRT')
                or exists (select 1 from public.usuarios u join public.areas ar on ar.id = u.area_id
                            where u.id = a.usuario_id and ar.codigo = 'GRT')),
    exists (select 1 from avisados a join public.roles_permisos rp on rp.rol_id = a.rol_id and rp.permiso_codigo = 'garantias.ver');
$$;
revoke all on function public.garantias_a_quien_se_aviso(uuid) from public, anon, authenticated;

-- 10. Registrar -------------------------------------------------------------------------------
-- Un reintento con el mismo p_id y lo mismo devuelve el reclamo que ya entró.
create or replace function public.garantias_registrar(
  p_id uuid, p_unidad uuid, p_descripcion text, p_trae text, p_contacto text, p_fotos jsonb
) returns table (reclamo uuid, numero_reclamo text, aviso_administracion boolean, aviso_garantias boolean, aviso_gerencia boolean)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_envio   constant jsonb := jsonb_build_array(p_unidad, p_descripcion, p_trae, p_contacto, p_fotos);
  v_que     text := btrim(coalesce(p_descripcion, ''));
  v_trae    text := nullif(btrim(coalesce(p_trae, '')), '');
  v_contacto text := nullif(btrim(coalesce(p_contacto, '')), '');
  v_actual  public.garantia_reclamos%rowtype;
  v_unidad  public.unidades%rowtype;
  v_cliente text;
  v_numero  text;
  v_jefe    uuid;
  v_titulo  text;
  v_cuerpo  text;
  v_ruta    text := '/garantias/' || p_id::text;
begin
  if v_yo is null or not public.es_usuario_activo()
     or not (public.es_admin() or public.tiene_permiso('garantias.registrar')) then
    raise exception 'El reclamo de garantía lo registra Ventas.' using errcode = 'insufficient_privilege';
  end if;
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del reclamo.' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('garantias_registrar:' || p_id::text, 0));
  select * into v_actual from public.garantia_reclamos where id = p_id;
  if found then
    if v_actual.registrado_por = v_yo and public.mismo_envio(p_id, 'RECLAMO_GARANTIA', v_envio) then
      return query select v_actual.id, v_actual.numero, q.administracion, q.garantias, q.gerencia
                     from public.garantias_a_quien_se_aviso(v_actual.id) q;
      return;
    end if;
    if v_actual.registrado_por = v_yo then
      raise exception 'El reclamo % ya quedó registrado la primera vez que lo enviaste: lo que cambiaste después no se guardó. Si está mal, anúlalo con su motivo y regístralo de nuevo.', v_actual.numero
        using errcode = 'check_violation';
    end if;
    raise exception 'Ese reclamo ya existe con otros datos: vuelve a abrir el formulario.' using errcode = 'unique_violation';
  end if;

  select * into v_unidad from public.unidades where id = p_unidad;
  if not found or not v_unidad.activo then
    raise exception 'Elige la unidad de la lista: si no está, regístrala primero en Unidades.' using errcode = 'check_violation';
  end if;
  if v_unidad.cliente_id is null then
    raise exception 'La unidad no tiene cliente: corrígela en Unidades antes de registrar el reclamo.' using errcode = 'check_violation';
  end if;
  if char_length(v_que) not between 10 and 2000 then
    raise exception 'Cuenta qué reclama el cliente, en 10 a 2000 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_trae, '')) > 120 then
    raise exception 'Quién lo trae pasa de 120 caracteres.' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_contacto, '')) > 60 then
    raise exception 'El contacto pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;

  v_numero := public.siguiente_correlativo('RECLAMO_GARANTIA', '001', null);
  insert into public.garantia_reclamos (id, numero, unidad_id, cliente_id, descripcion, trae, contacto, registrado_por)
  values (p_id, v_numero, p_unidad, v_unidad.cliente_id, v_que, v_trae, v_contacto, v_yo);
  perform public.garantias_anotar_fotos(p_id, p_fotos);
  perform public.anotar_envio(p_id, 'RECLAMO_GARANTIA', v_envio);

  select c.razon_social into v_cliente from public.clientes c where c.id = v_unidad.cliente_id;
  v_titulo := 'Reclamo de garantía ' || v_numero || ': ' || upper(coalesce(v_cliente, ''))
              || coalesce(' · ' || nullif(btrim(coalesce(v_unidad.placa, v_unidad.codigo_interno, '')), ''), '');
  v_cuerpo := left(v_que, 300);
  -- A Administración, que abre la OT.
  perform public.avisar_a_permiso('garantias.atender', v_titulo, v_cuerpo, v_ruta, 'garantia_reclamos', p_id);
  -- Al responsable de Garantías, si tiene cuenta activa y no lo recibió ya.
  v_jefe := public.responsable_del_area('GRT');
  if v_jefe is not null and v_jefe <> v_yo
     and not exists (select 1 from public.notificaciones n where n.origen_tabla = 'garantia_reclamos' and n.origen_id = p_id and n.usuario_id = v_jefe) then
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    values (v_jefe, left(v_titulo, 200), v_cuerpo, v_ruta, 'garantia_reclamos', p_id);
  end if;
  -- Sin nadie de Administración que lo reciba, no se pierde: le llega a Gerencia.
  if not exists (select 1 from public.notificaciones n
                   join public.usuarios u on u.id = n.usuario_id
                   join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'garantias.atender'
                  where n.origen_tabla = 'garantia_reclamos' and n.origen_id = p_id) then
    perform public.avisar_a_permiso('garantias.ver', v_titulo || ' (no hay cuenta de Administración que lo reciba)',
                                    v_cuerpo, v_ruta, 'garantia_reclamos', p_id);
  end if;

  return query select p_id, v_numero, q.administracion, q.garantias, q.gerencia
                 from public.garantias_a_quien_se_aviso(p_id) q;
end;
$$;
comment on function public.garantias_registrar(uuid, uuid, text, text, text, jsonb) is
  'Ventas (garantias.registrar) registra el reclamo de garantía de una unidad, con sus fotos ya en Storage; da el número RG-… y avisa a Administración y al responsable de Garantías (o a Gerencia si Administración no tiene cuenta).';
revoke all on function public.garantias_registrar(uuid, uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.garantias_registrar(uuid, uuid, text, text, text, jsonb) to authenticated;

-- 11. Las OT de garantía que se pueden enlazar ---------------------------------------------------
-- Las de la misma unidad, sin anular, que no atienden ya otro reclamo.
create or replace function public.garantias_ots_para_enlazar(p_reclamo uuid)
returns table (orden uuid, numero text, estado text, creada date)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if public.usuario_actual() is null or not public.es_usuario_activo()
     or not (public.es_admin() or public.tiene_permiso('garantias.atender')) then
    raise exception 'La OT de garantía la enlaza Administración.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select o.id, o.numero::text, o.estado::text, (o.creado_en at time zone 'America/Lima')::date
      from public.garantia_reclamos r
      join public.ordenes_trabajo o on o.unidad_id = r.unidad_id
     where r.id = p_reclamo
       and o.tipo_trabajo = 'GARANTIA' and o.estado <> 'ANULADA'
       and not exists (select 1 from public.garantia_reclamos x where x.orden_id = o.id)
     order by o.creado_en desc;
end;
$$;
comment on function public.garantias_ots_para_enlazar(uuid) is
  'Las OT de garantía de la unidad del reclamo que se le pueden enlazar: sin anular y sin otro reclamo. Exige garantias.atender.';
revoke all on function public.garantias_ots_para_enlazar(uuid) from public, anon;
grant execute on function public.garantias_ots_para_enlazar(uuid) to authenticated;

-- 11b. El aviso a Calidad de que ya puede anotar la causa ----------------------------------------
-- Lo usan el disparador de la garantía terminada (sección 17) y el enlace de
-- una OT cuya garantía ya estaba terminada. Si no hay cuenta de Calidad, a Gerencia.
create or replace function public.garantias_avisar_la_causa(p_reclamo uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  v_r public.garantia_reclamos%rowtype;
  v_titulo text;
begin
  select * into v_r from public.garantia_reclamos where id = p_reclamo and estado = 'CON_OT';
  if not found then
    return;
  end if;
  v_titulo := 'Anota la causa del reclamo ' || v_r.numero || ': su garantía está terminada';
  perform public.avisar_a_permiso('garantias.causa', v_titulo, left(v_r.descripcion, 300),
                                  '/garantias/' || v_r.id::text, 'garantia_reclamos', v_r.id);
  if not exists (select 1 from public.usuarios u
                   join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'garantias.causa'
                  where u.activo) then
    perform public.avisar_a_permiso('garantias.ver', v_titulo || ' (no hay cuenta de Calidad que la anote)', left(v_r.descripcion, 300),
                                    '/garantias/' || v_r.id::text, 'garantia_reclamos', v_r.id);
  end if;
end;
$$;
revoke all on function public.garantias_avisar_la_causa(uuid) from public, anon, authenticated;

-- 12. Enlazar su OT ----------------------------------------------------------------------------
-- Administración enlaza la OT de garantía que abrió para el reclamo. Si la que
-- tenía se anuló, enlaza otra.
create or replace function public.garantias_enlazar_ot(p_reclamo uuid, p_orden uuid)
returns table (reclamo uuid, numero_ot text)
language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo   uuid := public.usuario_actual();
  v_r    public.garantia_reclamos%rowtype;
  v_o    public.ordenes_trabajo%rowtype;
  v_otro text;
begin
  if v_yo is null or not public.es_usuario_activo() or not (public.es_admin() or public.tiene_permiso('garantias.atender')) then
    raise exception 'La OT de garantía la enlaza Administración.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_r from public.garantia_reclamos where id = p_reclamo for update;
  if not found then raise exception 'Ese reclamo no existe.' using errcode = 'check_violation'; end if;
  select * into v_o from public.ordenes_trabajo where id = p_orden;
  if not found then raise exception 'Esa OT no existe.' using errcode = 'check_violation'; end if;
  -- El mismo pedido repetido (se perdió la respuesta) entra.
  if v_r.orden_id = p_orden then
    return query select p_reclamo, v_o.numero::text;
    return;
  end if;
  if v_r.estado not in ('REGISTRADO', 'CON_OT') then
    raise exception 'El reclamo % ya está cerrado: no se le enlaza otra OT.', v_r.numero using errcode = 'check_violation';
  end if;
  if v_r.estado = 'CON_OT' and exists (select 1 from public.ordenes_trabajo o where o.id = v_r.orden_id and o.estado <> 'ANULADA') then
    raise exception 'El reclamo % ya tiene su OT %: se cambia solo si esa OT se anula.', v_r.numero,
      (select o.numero from public.ordenes_trabajo o where o.id = v_r.orden_id) using errcode = 'check_violation';
  end if;
  if v_o.tipo_trabajo <> 'GARANTIA' then
    raise exception 'La OT % no es de garantía: el reclamo va con una OT de garantía.', v_o.numero using errcode = 'check_violation';
  end if;
  if v_o.estado = 'ANULADA' then
    raise exception 'La OT % está anulada.', v_o.numero using errcode = 'check_violation';
  end if;
  if v_o.unidad_id is distinct from v_r.unidad_id then
    raise exception 'La OT % es de otra unidad: el reclamo % va con una OT de su unidad.', v_o.numero, v_r.numero using errcode = 'check_violation';
  end if;
  select x.numero into v_otro from public.garantia_reclamos x where x.orden_id = p_orden;
  if v_otro is not null then
    raise exception 'La OT % ya atiende el reclamo %.', v_o.numero, v_otro using errcode = 'unique_violation';
  end if;

  update public.garantia_reclamos set estado = 'CON_OT', orden_id = p_orden where id = p_reclamo;
  -- Si la garantía de esa OT ya estaba terminada, el reclamo espera la causa
  -- desde ya: el aviso del disparador de `ot_garantia_terminada` ya pasó.
  if public.orden_garantia_terminada(p_orden) then
    perform public.garantias_avisar_la_causa(p_reclamo);
  end if;

  if v_r.registrado_por is distinct from v_yo then
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    values (v_r.registrado_por, 'Tu reclamo ' || v_r.numero || ' ya tiene su OT de garantía ' || v_o.numero,
            'Administración la abrió; Gerencia la aprueba y el taller la atiende.', '/garantias/' || p_reclamo::text,
            'garantia_reclamos', p_reclamo);
  end if;
  return query select p_reclamo, v_o.numero::text;
end;
$$;
comment on function public.garantias_enlazar_ot(uuid, uuid) is
  'Administración (garantias.atender) enlaza al reclamo su OT de garantía, de la misma unidad, sin anular y sin otro reclamo; si la que tenía se anuló, enlaza otra. Avisa a quien lo registró.';
revoke all on function public.garantias_enlazar_ot(uuid, uuid) from public, anon;
grant execute on function public.garantias_enlazar_ot(uuid, uuid) to authenticated;

-- 13. No procede ---------------------------------------------------------------------------------
create or replace function public.garantias_no_procede(p_reclamo uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo uuid := public.usuario_actual();
  v_r  public.garantia_reclamos%rowtype;
begin
  if v_yo is null or not public.es_usuario_activo() or not (public.es_admin() or public.tiene_permiso('garantias.atender')) then
    raise exception 'Si un reclamo no procede lo dice Administración.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué no procede, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_r from public.garantia_reclamos where id = p_reclamo for update;
  if not found then raise exception 'Ese reclamo no existe.' using errcode = 'check_violation'; end if;
  if v_r.estado = 'NO_PROCEDE' and v_r.no_procede_motivo = btrim(p_motivo) and v_r.cerrado_por = v_yo then
    return p_reclamo;
  end if;
  -- Sin OT, o con su OT anulada (Gerencia la anuló porque no era garantía): si
  -- no, el reclamo se quedaba sin salida en el globo de Administración.
  if v_r.estado <> 'REGISTRADO'
     and not (v_r.estado = 'CON_OT' and exists (select 1 from public.ordenes_trabajo o where o.id = v_r.orden_id and o.estado = 'ANULADA')) then
    raise exception 'El reclamo % ya no espera su OT: %.', v_r.numero,
      case v_r.estado when 'CON_OT' then 'tiene su OT de garantía' when 'ANULADO' then 'está anulado' else 'ya está cerrado' end
      using errcode = 'check_violation';
  end if;
  update public.garantia_reclamos set estado = 'NO_PROCEDE', no_procede_motivo = btrim(p_motivo) where id = p_reclamo;
  if v_r.registrado_por is distinct from v_yo then
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    values (v_r.registrado_por, 'Tu reclamo ' || v_r.numero || ' no procede', left(btrim(p_motivo), 500),
            '/garantias/' || p_reclamo::text, 'garantia_reclamos', p_reclamo);
  end if;
  return p_reclamo;
end;
$$;
comment on function public.garantias_no_procede(uuid, text) is
  'Administración (garantias.atender) cierra como «No procede», con su motivo, un reclamo sin OT o con su OT anulada. Avisa a quien lo registró.';
revoke all on function public.garantias_no_procede(uuid, text) from public, anon;
grant execute on function public.garantias_no_procede(uuid, text) to authenticated;

-- 14. La causa -----------------------------------------------------------------------------------
create or replace function public.garantias_anotar_causa(p_reclamo uuid, p_causa text, p_detalle text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo uuid := public.usuario_actual();
  v_r  public.garantia_reclamos%rowtype;
  v_detalle text := btrim(coalesce(p_detalle, ''));
begin
  if v_yo is null or not public.es_usuario_activo() or not (public.es_admin() or public.tiene_permiso('garantias.causa')) then
    raise exception 'La causa del reclamo la anota Calidad.' using errcode = 'insufficient_privilege';
  end if;
  if p_causa is null or p_causa not in ('FABRICACION', 'MATERIAL', 'MONTAJE', 'USO_DEL_CLIENTE', 'DESGASTE', 'OTRA') then
    raise exception 'Elige la causa de la lista.' using errcode = 'check_violation';
  end if;
  if char_length(v_detalle) not between 10 and 1000 then
    raise exception 'Cuenta la causa, en 10 a 1000 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_r from public.garantia_reclamos where id = p_reclamo for update;
  if not found then raise exception 'Ese reclamo no existe.' using errcode = 'check_violation'; end if;
  if v_r.estado = 'CERRADO' and v_r.causa = p_causa and v_r.causa_detalle = v_detalle and v_r.cerrado_por = v_yo then
    return p_reclamo;
  end if;
  if v_r.estado <> 'CON_OT' then
    raise exception 'El reclamo % %.', v_r.numero,
      case v_r.estado when 'REGISTRADO' then 'todavía no tiene su OT de garantía' when 'CERRADO' then 'ya se cerró con su causa'
                      when 'NO_PROCEDE' then 'se cerró como «No procede»' else 'está anulado' end
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.ordenes_trabajo o where o.id = v_r.orden_id and o.estado = 'ANULADA') then
    raise exception 'La OT del reclamo % está anulada: Administración le enlaza otra.', v_r.numero using errcode = 'check_violation';
  end if;
  if not public.orden_garantia_terminada(v_r.orden_id) then
    raise exception 'La garantía del reclamo % todavía no está terminada: la causa se anota cuando Administración la da por terminada.', v_r.numero
      using errcode = 'check_violation';
  end if;
  update public.garantia_reclamos set estado = 'CERRADO', causa = p_causa, causa_detalle = v_detalle where id = p_reclamo;
  if v_r.registrado_por is distinct from v_yo then
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    values (v_r.registrado_por, 'Tu reclamo ' || v_r.numero || ' se cerró con su causa', left(v_detalle, 500),
            '/garantias/' || p_reclamo::text, 'garantia_reclamos', p_reclamo);
  end if;
  return p_reclamo;
end;
$$;
comment on function public.garantias_anotar_causa(uuid, text, text) is
  'Calidad (garantias.causa) anota la causa del reclamo cuando la garantía de su OT está terminada, y lo cierra. Avisa a quien lo registró.';
revoke all on function public.garantias_anotar_causa(uuid, text, text) from public, anon;
grant execute on function public.garantias_anotar_causa(uuid, text, text) to authenticated;

-- 15. Anular ---------------------------------------------------------------------------------------
create or replace function public.garantias_anular(p_reclamo uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo uuid := public.usuario_actual();
  v_r  public.garantia_reclamos%rowtype;
begin
  if v_yo is null or not public.es_usuario_activo()
     or not (public.es_admin() or public.tiene_permiso('garantias.registrar') or public.tiene_permiso('garantias.atender')) then
    raise exception 'Un reclamo de garantía lo anulan Ventas o Administración.' using errcode = 'insufficient_privilege';
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_r from public.garantia_reclamos where id = p_reclamo for update;
  if not found then raise exception 'Ese reclamo no existe.' using errcode = 'check_violation'; end if;
  if v_r.estado = 'ANULADO' then
    if v_r.motivo_anulacion = btrim(p_motivo) and v_r.anulado_por = v_yo then
      return p_reclamo;
    end if;
    raise exception 'El reclamo % ya estaba anulado, con este motivo: «%». No se cambia.', v_r.numero, v_r.motivo_anulacion
      using errcode = 'check_violation';
  end if;
  if v_r.estado <> 'REGISTRADO'
     and not (v_r.estado = 'CON_OT' and exists (select 1 from public.ordenes_trabajo o where o.id = v_r.orden_id and o.estado = 'ANULADA')) then
    raise exception 'El reclamo % %: ya no se anula.', v_r.numero,
      case v_r.estado when 'CON_OT' then 'tiene su OT de garantía' else 'ya está cerrado' end
      using errcode = 'check_violation';
  end if;
  update public.garantia_reclamos set estado = 'ANULADO', anulado_por = v_yo, anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_reclamo;
  if v_r.registrado_por is distinct from v_yo then
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    values (v_r.registrado_por, 'Se anuló tu reclamo ' || v_r.numero, left(btrim(p_motivo), 500),
            '/garantias/' || p_reclamo::text, 'garantia_reclamos', p_reclamo);
  end if;
  return p_reclamo;
end;
$$;
comment on function public.garantias_anular(uuid, text) is
  'Ventas (garantias.registrar) o Administración (garantias.atender) anulan con su motivo un reclamo sin OT o con su OT anulada. No se borra.';
revoke all on function public.garantias_anular(uuid, text) from public, anon;
grant execute on function public.garantias_anular(uuid, text) to authenticated;

-- 16. Lo que cada quien lee -------------------------------------------------------------------------
-- Una sola lectura para la lista (p_id vacío) y el detalle, con la unidad, el
-- cliente y la OT: quien ve los reclamos no siempre lee esas tablas. `situacion`
-- dice qué espera: POR_ABRIR_OT (Administración), OT_ANULADA (Administración
-- enlaza otra), EN_TALLER, POR_CAUSA (Calidad), CERRADO, NO_PROCEDE, ANULADO.
-- Los `puede_*` repiten la regla de cada función que escribe, para que la
-- pantalla no ofrezca lo que la base va a rechazar.
create or replace function public.garantias_reclamos_visibles(p_id uuid)
returns table (
  id uuid, numero text, estado text, situacion text, creado_en timestamptz, dias_en_espera integer,
  descripcion text, trae text, contacto text,
  unidad_id uuid, placa text, codigo_interno text, carroceria text, cliente text,
  orden_id uuid, orden_numero text, orden_estado text, ot_enlazada_en timestamptz, enlazo text,
  no_procede_motivo text, causa text, causa_detalle text, cerrado_en timestamptz, cerro text, cerro_puesto text,
  registro text, registro_puesto text, fotos integer,
  anulado_en timestamptz, anulo text, motivo_anulacion text,
  puede_enlazar boolean, puede_no_procede boolean, puede_causa boolean, puede_anular boolean,
  garantia_terminada_en timestamptz, garantia_termino text)
language plpgsql stable security definer set search_path to 'public' rows 200 as $$
#variable_conflict use_column
declare
  v_atiende  boolean;
  v_causa    boolean;
  v_registra boolean;
begin
  if not coalesce(public.puede_ver_los_reclamos_de_garantia(), false) then
    return;
  end if;
  v_atiende  := public.es_admin() or public.tiene_permiso('garantias.atender');
  v_causa    := public.es_admin() or public.tiene_permiso('garantias.causa');
  v_registra := public.es_admin() or public.tiene_permiso('garantias.registrar');
  return query
  with base as (
    select r.*, o.numero::text as o_numero, o.estado::text as o_estado,
           (r.orden_id is not null and public.orden_garantia_terminada(r.orden_id)) as terminada
      from public.garantia_reclamos r
      left join public.ordenes_trabajo o on o.id = r.orden_id
     where p_id is null or r.id = p_id
  ), con_situacion as (
    select b.*,
           case b.estado
             when 'REGISTRADO' then 'POR_ABRIR_OT'
             when 'CON_OT' then case when b.o_estado = 'ANULADA' then 'OT_ANULADA' when b.terminada then 'POR_CAUSA' else 'EN_TALLER' end
             else b.estado end as sit
      from base b
  )
  select s.id, s.numero, s.estado, s.sit, s.creado_en,
         case when s.estado in ('REGISTRADO', 'CON_OT')
              then (now() at time zone 'America/Lima')::date - (s.creado_en at time zone 'America/Lima')::date end,
         s.descripcion, s.trae, s.contacto,
         s.unidad_id, u.placa::text, u.codigo_interno::text, tc.nombre::text, c.razon_social::text,
         s.orden_id, s.o_numero, s.o_estado, s.ot_enlazada_en, btrim(en.nombres || ' ' || en.apellidos),
         s.no_procede_motivo, s.causa, s.causa_detalle, s.cerrado_en,
         btrim(ce.nombres || ' ' || ce.apellidos), rce.nombre::text,
         btrim(re.nombres || ' ' || re.apellidos), rre.nombre::text,
         (select count(*)::integer from public.garantia_reclamo_fotos f where f.reclamo_id = s.id),
         s.anulado_en, btrim(an.nombres || ' ' || an.apellidos), s.motivo_anulacion,
         v_atiende and s.sit in ('POR_ABRIR_OT', 'OT_ANULADA'),
         v_atiende and s.sit in ('POR_ABRIR_OT', 'OT_ANULADA'),
         v_causa and s.sit = 'POR_CAUSA',
         (v_atiende or v_registra) and s.sit in ('POR_ABRIR_OT', 'OT_ANULADA'),
         -- Cuándo y quién dio la garantía por terminada: la OT sigue «Aprobada»
         -- y, sin esto, la ficha decía «terminada» junto a esa insignia.
         gt.terminada_en, btrim(tu.nombres || ' ' || tu.apellidos)
    from con_situacion s
    join public.unidades u on u.id = s.unidad_id
    left join public.tipos_carroceria tc on tc.id = u.tipo_carroceria_id
    join public.clientes c on c.id = s.cliente_id
    join public.usuarios re on re.id = s.registrado_por
    left join public.roles rre on rre.id = re.rol_id
    left join public.usuarios en on en.id = s.ot_enlazada_por
    left join public.usuarios ce on ce.id = s.cerrado_por
    left join public.roles rce on rce.id = ce.rol_id
    left join public.usuarios an on an.id = s.anulado_por
    left join public.ot_garantia_terminada gt on gt.orden_id = s.orden_id
    left join public.usuarios tu on tu.id = gt.terminada_por
   order by s.creado_en desc;
end;
$$;
comment on function public.garantias_reclamos_visibles(uuid) is
  'Los reclamos de garantía (uno, o todos con p_id vacío) para quien puede verlos, con su unidad, su cliente, su OT, qué espera y lo que quien pregunta puede hacer en cada uno. dias_en_espera se cuenta con la fecha de Lima.';
revoke all on function public.garantias_reclamos_visibles(uuid) from public, anon;
grant execute on function public.garantias_reclamos_visibles(uuid) to authenticated;

-- 17. Cuando la garantía se da por terminada, Calidad se entera ---------------------------------
-- Disparador propio sobre `ot_garantia_terminada` (no se redefine
-- `dar_por_terminada_la_garantia`): si la OT atiende un reclamo, a Calidad le
-- llega que ya puede anotar su causa; si no hay cuenta de Calidad, a Gerencia.
create or replace function public.fn_garantia_terminada_avisa_a_calidad()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_id uuid;
begin
  select r.id into v_id from public.garantia_reclamos r where r.orden_id = new.orden_id and r.estado = 'CON_OT';
  if found then
    perform public.garantias_avisar_la_causa(v_id);
  end if;
  return new;
end;
$$;
revoke all on function public.fn_garantia_terminada_avisa_a_calidad() from public, anon, authenticated;
create or replace trigger trg_garantia_terminada_avisa_a_calidad
  after insert on public.ot_garantia_terminada
  for each row execute function public.fn_garantia_terminada_avisa_a_calidad();
