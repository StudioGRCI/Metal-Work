-- =============================================================================
-- GESTIÓN DE COMPRAS: LOGÍSTICA PROGRAMA EL RECOJO Y CONTABILIDAD CARGA LA GUÍA
-- -----------------------------------------------------------------------------
-- Gerencia pidió (2026-10-14) que Logística tenga un módulo de gestión de
-- compras para ordenar qué órdenes de compra tiene que recoger el conductor e
-- indicar el peso de cada una. Esa misma gestión la ve Contabilidad: con el
-- peso emite la guía de remisión del traslado y la carga ahí, y el conductor la
-- ve en su teléfono antes de salir.
--
-- Hasta aquí la OC aprobada pasaba sola a la lista del conductor y le llegaba
-- el aviso: él recogía lo que veía, en el orden que quería, sin peso y sin la
-- guía que el traslado necesita.
--
-- Desde aquí:
--   * la OC aprobada sigue quedando «pendiente de recojo» (el avance del RQ no
--     cambia), pero el aviso le llega a Logística, no al conductor;
--   * Logística la PROGRAMA: le pone su peso en kilos y su lugar en la lista
--     del conductor (1.º, 2.º…). Puede subirla, bajarla, cambiarle el peso o
--     sacarla de la lista mientras el conductor no haya salido a recogerla;
--   * el conductor solo sale a recoger lo que Logística le programó. Lo que ya
--     llevaba encima (en recojo o recogido) sigue como estaba;
--   * Contabilidad ve la misma lista con el peso y carga la GUÍA DE REMISIÓN de
--     cada OC (número, fecha y PDF). Una guía no se borra: si salió mal se anula
--     con su motivo y se carga otra. Con la guía cargada, el peso ya no cambia:
--     se emitió con ese peso;
--   * el conductor ve en su lista el lugar, el peso y la guía de cada OC.
--
-- Contabilidad no necesita el permiso de Logística para nada de esto: tiene uno
-- propio, `compras.guia_remision`. Todo se escribe por funciones security
-- definer; las tablas nuevas solo se leen.
--
-- Sin DROP ni borrados: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 1. El permiso de Contabilidad -----------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('compras.guia_remision', 'Compras',
   'Ver las compras que recoge el conductor con su peso y cargar o anular su guía de remisión')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'compras.guia_remision' from public.roles r where r.codigo = 'CONTABILIDAD'
on conflict do nothing;

-- 2. La lista del conductor: lugar y peso de cada OC -----------------------------------
-- Una fila por OC programada. `posicion` vacía = Logística la sacó de la lista
-- (el peso se queda). El lugar que se muestra (1.º, 2.º…) se cuenta entre las
-- que siguen pendientes de recojo; esta columna solo las ordena.
create table if not exists public.programacion_recojo (
  id               uuid primary key default gen_random_uuid(),
  orden_compra_id  uuid not null,
  posicion         smallint,
  peso_kg          numeric(10, 2) not null,
  programado_por   uuid not null default public.usuario_actual(),
  programado_en    timestamptz not null default now(),
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  constraint programacion_recojo_orden_compra_id_fkey foreign key (orden_compra_id)
    references public.ordenes_compra_materiales(id) on delete restrict,
  -- Sin índice: nadie filtra por quién programó y el usuario no se borra (se desactiva).
  constraint programacion_recojo_programado_por_fkey foreign key (programado_por)
    references public.usuarios(id) on delete restrict,
  -- Una OC, una fila. También es el índice de la llave hacia la OC.
  constraint uq_programacion_recojo_compra unique (orden_compra_id),
  constraint ck_programacion_recojo check (
    (posicion is null or posicion between 1 and 999)
    and peso_kg > 0 and peso_kg <= 100000)
);
comment on table public.programacion_recojo is
  'Qué OC recoge el conductor, en qué orden y con qué peso. La escribe Logística con programar_recojo; la leen el conductor y Contabilidad.';
comment on column public.programacion_recojo.posicion is
  'Orden en la lista del conductor. Vacía: Logística la sacó de la lista.';

select public.activar_timestamps('programacion_recojo');
select public.activar_auditoria('programacion_recojo');
select public.activar_registro_de_prueba('programacion_recojo');

-- 3. La guía de remisión ----------------------------------------------------------------
create table if not exists public.guias_remision_compra (
  id                uuid primary key default gen_random_uuid(),
  orden_compra_id   uuid not null,
  numero            text not null,
  fecha_emision     date not null,
  nombre_archivo    text not null,
  ruta              text not null,
  tamano_bytes      integer not null,
  cargada_por       uuid not null default public.usuario_actual(),
  cargada_en        timestamptz not null default now(),
  anulada_en        timestamptz,
  anulada_por       uuid,
  motivo_anulacion  text,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint guias_remision_compra_orden_compra_id_fkey foreign key (orden_compra_id)
    references public.ordenes_compra_materiales(id) on delete restrict,
  -- Sin índice: nadie filtra por quién la cargó o la anuló, y el usuario no se borra.
  constraint guias_remision_compra_cargada_por_fkey foreign key (cargada_por)
    references public.usuarios(id) on delete restrict,
  constraint guias_remision_compra_anulada_por_fkey foreign key (anulada_por)
    references public.usuarios(id) on delete restrict,
  -- La política de Storage la busca por su ruta.
  constraint uq_guia_remision_ruta unique (ruta),
  constraint ck_guia_remision check (
    numero ~ '^[A-Z0-9]{1,4}-[0-9]{1,10}$'
    and char_length(btrim(nombre_archivo)) between 1 and 200
    and tamano_bytes between 1 and 10485760
    and (anulada_en is null) = (anulada_por is null)
    and (anulada_en is null) = (motivo_anulacion is null)
    and (motivo_anulacion is null or char_length(btrim(motivo_anulacion)) >= 5))
);
comment on table public.guias_remision_compra is
  'La guía de remisión que Contabilidad emite para el traslado de una OC que recoge el conductor. Se anula, no se borra; el PDF va en el bucket guias-remision con la ruta compra/{oc}/{guía}.pdf.';

-- Una sola guía vigente por OC: para cargar otra se anula la anterior.
create unique index if not exists uq_guia_remision_vigente
  on public.guias_remision_compra (orden_compra_id) where anulada_en is null;
-- La llave hacia la OC, también para las anuladas: la gestión cuenta las de
-- cada OC (b).
create index if not exists idx_guias_remision_compra_oc
  on public.guias_remision_compra (orden_compra_id, cargada_en desc);

select public.activar_timestamps('guias_remision_compra');
select public.activar_auditoria('guias_remision_compra');
select public.activar_registro_de_prueba('guias_remision_compra');

-- Lo que dice una guía no se cambia ni se borra; solo se anula, una vez.
create or replace function public.fn_guia_remision_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Una guía de remisión no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulada_en is not null then
    raise exception 'La guía % está anulada: queda como evidencia.', old.numero using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - array['anulada_en', 'anulada_por', 'motivo_anulacion', 'actualizado_en'])
     is distinct from (to_jsonb(old) - array['anulada_en', 'anulada_por', 'motivo_anulacion', 'actualizado_en']) then
    raise exception 'Una guía cargada no se corrige: anúlala con su motivo y carga la buena.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_guia_remision_guardia() from public, anon, authenticated;
create or replace trigger trg_guia_remision_guardia
  before update or delete on public.guias_remision_compra
  for each row execute function public.fn_guia_remision_guardia();

-- 4. Quién ve qué -------------------------------------------------------------------------
-- Logística, Contabilidad y el conductor. Escribir, solo por las funciones.
alter table public.programacion_recojo enable row level security;
alter table public.guias_remision_compra enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'programacion_recojo' and policyname = 'ver_programacion_recojo') then
    create policy ver_programacion_recojo on public.programacion_recojo for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('compras.crear'))
             or (select public.tiene_permiso('compras.guia_remision')) or (select public.tiene_permiso('compras.recojo')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'guias_remision_compra' and policyname = 'ver_guias_remision_compra') then
    create policy ver_guias_remision_compra on public.guias_remision_compra for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('compras.crear'))
             or (select public.tiene_permiso('compras.guia_remision')) or (select public.tiene_permiso('compras.recojo')));
  end if;
end $$;
revoke all on public.programacion_recojo from public, anon, authenticated;
revoke all on public.guias_remision_compra from public, anon, authenticated;
grant select on public.programacion_recojo to authenticated;
grant select on public.guias_remision_compra to authenticated;

-- 5. El PDF de la guía en Storage ---------------------------------------------------------
-- La guía electrónica sale en PDF; 10 MB es de sobra.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('guias-remision', 'guias-remision', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- La ruta es compra/{oc}/{guía}.pdf. La sube Contabilidad; la ve quien la subió
-- (para comprobarla antes de registrarla) y quien ve la guía que la nombra. Un
-- PDF suelto (subido y no registrado) lo retira su dueño mientras ninguna guía
-- lo nombre. Las políticas se crean una vez y se cambian con alter.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'guia_remision_subir') then
    create policy guia_remision_subir on storage.objects for insert to authenticated with check (
      bucket_id = 'guias-remision' and owner_id = (select auth.uid())::text
      and (select public.tiene_permiso('compras.guia_remision'))
      and public.orden_compra_de_ruta(name) is not null);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'guia_remision_ver') then
    create policy guia_remision_ver on storage.objects for select to authenticated using (
      bucket_id = 'guias-remision'
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.guias_remision_compra g where g.ruta = objects.name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'guia_remision_quitar_suelta') then
    create policy guia_remision_quitar_suelta on storage.objects for delete to authenticated using (
      bucket_id = 'guias-remision' and owner_id = (select auth.uid())::text
      and not exists (select 1 from public.guias_remision_compra g where g.ruta = objects.name));
  end if;
end $$;

-- 6. Avisar a un puesto por su permiso --------------------------------------------------
-- A todas las cuentas activas cuyo rol tiene el permiso, menos a quien lo hizo
-- y a quien ya recibió otro aviso por lo mismo (`p_excepto`).
create or replace function public.avisar_a_quien_tiene(
  p_permiso text, p_titulo text, p_cuerpo text, p_ruta text, p_compra uuid, p_excepto uuid default null)
returns void language sql security definer set search_path to 'public' as $$
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, p_titulo, p_cuerpo, p_ruta, 'ordenes_compra_materiales', p_compra
    from public.usuarios u
    join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = p_permiso
   where u.activo and u.id is distinct from public.usuario_actual() and u.id is distinct from p_excepto;
$$;
revoke all on function public.avisar_a_quien_tiene(text, text, text, text, uuid, uuid) from public, anon, authenticated;

-- 7. El recojo: el aviso va a Logística y el conductor sale solo con lo programado -----
-- Igual que en 20261013121000, con dos cambios: al quedar pendiente de recojo
-- el aviso le llega a Logística para que la programe (al conductor le llega
-- cuando la programa), y salir a recoger o marcar recogida una OC que estaba
-- pendiente exige que esté en la lista del conductor. Quien emitió la OC no
-- recibe este aviso al aprobarse: ya le llega el de «Compra aprobada», que
-- desde aquí le dice que la programe (ver aprobar_compra, abajo).
create or replace function public.fn_compra_recojo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_orden constant text[] := array['POR_RECOGER', 'EN_RECOJO', 'RECOGIDO', 'DEJADO'];
  v_antes int; v_ahora int;
begin
  -- La compra aprobada sale sola hacia el recojo.
  if new.aprobacion = 'APROBADA' and old.aprobacion is distinct from 'APROBADA'
     and new.recojo is null and new.entregado_almacen_en is null then
    new.recojo := 'POR_RECOGER';
    new.recojo_pedido_en := now();
    new.recojo_pedido_por := coalesce(new.aprobado_por, public.usuario_actual());
  end if;

  if new.recojo is distinct from old.recojo then
    v_antes := coalesce(array_position(v_orden, old.recojo), 0);
    v_ahora := coalesce(array_position(v_orden, new.recojo), 0);
    -- Un paso adelante; o de POR_RECOGER a RECOGIDO si no marcó la salida.
    if not (v_ahora = v_antes + 1 or (old.recojo = 'POR_RECOGER' and new.recojo = 'RECOGIDO')) then
      raise exception 'El recojo de la compra % no puede pasar de % a %.',
        coalesce(new.numero, new.referencia), coalesce(old.recojo, 'sin recojo'), coalesce(new.recojo, 'sin recojo')
        using errcode = 'check_violation';
    end if;
    if new.recojo = 'POR_RECOGER' then
      if new.aprobacion in ('POR_APROBAR', 'RECHAZADA') then
        raise exception '%', public.mensaje_compra_sin_aprobar(new) using errcode = 'check_violation';
      end if;
      perform public.avisar_a_quien_tiene('compras.crear',
        'Programa el recojo: ' || coalesce(new.numero, new.referencia),
        new.proveedor || '. Ponle su peso y su lugar en la lista del conductor.',
        '/compras/gestion', new.id,
        case when new.aprobacion = 'APROBADA' and old.aprobacion is distinct from 'APROBADA' then new.creado_por end);
    end if;
    -- El conductor sale a recoger lo que Logística le puso en su lista.
    if old.recojo = 'POR_RECOGER' and new.recojo in ('EN_RECOJO', 'RECOGIDO')
       and not exists (select 1 from public.programacion_recojo p
                        where p.orden_compra_id = new.id and p.posicion is not null) then
      raise exception 'Logística todavía no programa el recojo de la compra %: espera a que la ponga en tu lista.',
        coalesce(new.numero, new.referencia) using errcode = 'check_violation';
    end if;
  end if;

  -- Lo que el conductor marcó queda como evidencia.
  if (old.recogido_en is not null and (new.recogido_en is distinct from old.recogido_en or new.recogido_por is distinct from old.recogido_por))
     or (old.dejado_en is not null and (new.dejado_en is distinct from old.dejado_en or new.dejado_por is distinct from old.dejado_por))
     or (old.en_recojo_en is not null and (new.en_recojo_en is distinct from old.en_recojo_en or new.en_recojo_por is distinct from old.en_recojo_por))
     or (old.recojo_pedido_en is not null and new.recojo_pedido_en is distinct from old.recojo_pedido_en) then
    raise exception 'El recojo de la compra % ya quedó registrado y no se corrige.', coalesce(new.numero, new.referencia)
      using errcode = 'check_violation';
  end if;

  -- Mientras está con el conductor, la entrega a Almacén la marca él al dejarla.
  if new.entregado_almacen_en is not null and old.entregado_almacen_en is null
     and new.recojo in ('POR_RECOGER', 'EN_RECOJO', 'RECOGIDO') then
    raise exception 'La compra % está con el conductor: la entrega a Almacén se marca cuando él la deja.',
      coalesce(new.numero, new.referencia) using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_compra_recojo() from public, anon, authenticated;

-- El aviso de «Compra aprobada» a quien la emitió: si sale hacia el conductor,
-- le dice que la programe y lo lleva a la gestión. Lo demás, igual que en
-- 20261012101000.
create or replace function public.aprobar_compra(p_compra uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_compra public.ordenes_compra_materiales%rowtype;
  v_recojo text;
begin
  if not public.es_aprobador_compras() then
    raise exception 'Solo el puesto que aprueba las compras puede aprobarlas.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.';
  end if;
  if v_compra.aprobacion = 'APROBADA' then
    return p_compra;
  end if;
  if v_compra.aprobacion <> 'POR_APROBAR' then
    raise exception 'La compra % no está esperando aprobación.', v_compra.referencia using errcode = 'check_violation';
  end if;
  update public.ordenes_compra_materiales
     set aprobacion = 'APROBADA', aprobado_por = public.usuario_actual(), aprobado_en = now(),
         monto_aprobado_pen = monto_pen
   where id = p_compra
  returning recojo into v_recojo;
  if v_recojo = 'POR_RECOGER' then
    perform public.notificar_a_usuario(v_compra.creado_por, 'Compra aprobada: ' || coalesce(v_compra.numero, v_compra.referencia),
      v_compra.proveedor || '. Prográmala en Gestión de compras: su peso y su lugar en la lista del conductor.',
      '/compras/gestion', 'ordenes_compra_materiales', p_compra, public.usuario_actual());
  else
    perform public.notificar_a_usuario(v_compra.creado_por, 'Compra aprobada: ' || coalesce(v_compra.numero, v_compra.referencia),
      v_compra.proveedor || '. Ya puedes enviarla al proveedor y entregarla a Almacén cuando llegue.',
      '/compras', 'ordenes_compra_materiales', p_compra, public.usuario_actual());
  end if;
  return p_compra;
end;
$$;
revoke all on function public.aprobar_compra(uuid) from public, anon;
grant execute on function public.aprobar_compra(uuid) to authenticated;

-- 8. Programar: peso y lugar en la lista ----------------------------------------------------
-- Pone la OC en el lugar pedido (o al final) y corre las demás. Sirve también
-- para cambiarle el peso o el lugar a una ya programada. La primera vez avisa
-- al conductor y a Contabilidad. Devuelve el lugar que le tocó.
create or replace function public.programar_recojo(p_compra uuid, p_peso numeric, p_posicion integer default null)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_compra  public.ordenes_compra_materiales%rowtype;
  v_antes   public.programacion_recojo%rowtype;
  v_guia    public.guias_remision_compra%rowtype;
  v_cola    uuid[];
  v_n       integer;
  v_lugar   integer;
  v_nombre  text;
  i         integer;
begin
  perform public.exigir_permiso('compras.crear');
  -- Una lista, un orden: dos personas programando a la vez se esperan.
  perform pg_advisory_xact_lock(hashtext('programacion_recojo'));

  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.' using errcode = 'foreign_key_violation';
  end if;
  v_nombre := coalesce(v_compra.numero, v_compra.referencia);
  if v_compra.recojo is null then
    raise exception 'La compra % no va con el conductor.', v_nombre using errcode = 'check_violation';
  end if;
  if v_compra.recojo <> 'POR_RECOGER' then
    raise exception 'El conductor ya salió a recoger la compra %: su lugar y su peso ya no se cambian.', v_nombre
      using errcode = 'check_violation';
  end if;
  if p_peso is null or p_peso <= 0 or p_peso > 100000 then
    raise exception 'Escribe el peso de la compra % en kilos: más de cero.', v_nombre using errcode = 'check_violation';
  end if;
  p_peso := round(p_peso, 2);

  select * into v_antes from public.programacion_recojo where orden_compra_id = p_compra;
  select * into v_guia from public.guias_remision_compra where orden_compra_id = p_compra and anulada_en is null;
  if v_guia.id is not null and v_antes.peso_kg is distinct from p_peso then
    raise exception 'La guía de remisión % ya se emitió con % kg: para cambiar el peso, Contabilidad tiene que anularla primero.',
      v_guia.numero, trim(to_char(v_antes.peso_kg, 'FM999G990D00')) using errcode = 'check_violation';
  end if;

  -- La lista sin esta OC, en su orden; se reescribe 1, 2, 3… con esta en su lugar.
  select coalesce(array_agg(p.orden_compra_id order by p.posicion, p.programado_en, p.orden_compra_id), '{}')
    into v_cola
    from public.programacion_recojo p
    join public.ordenes_compra_materiales c on c.id = p.orden_compra_id
   where c.recojo = 'POR_RECOGER' and p.posicion is not null and p.orden_compra_id <> p_compra;
  v_n := coalesce(array_length(v_cola, 1), 0);
  v_lugar := least(greatest(coalesce(p_posicion, v_n + 1), 1), v_n + 1);

  for i in 1 .. v_n loop
    update public.programacion_recojo
       set posicion = case when i < v_lugar then i else i + 1 end
     where orden_compra_id = v_cola[i]
       and posicion is distinct from (case when i < v_lugar then i else i + 1 end);
  end loop;

  insert into public.programacion_recojo (orden_compra_id, posicion, peso_kg)
  values (p_compra, v_lugar, p_peso)
  on conflict (orden_compra_id) do update
     set posicion = excluded.posicion,
         peso_kg = excluded.peso_kg,
         -- Volver a la lista cuenta como programarla de nuevo.
         programado_por = case when programacion_recojo.posicion is null then public.usuario_actual() else programacion_recojo.programado_por end,
         programado_en = case when programacion_recojo.posicion is null then now() else programacion_recojo.programado_en end
   where programacion_recojo.posicion is distinct from excluded.posicion
      or programacion_recojo.peso_kg is distinct from excluded.peso_kg;

  if v_antes.posicion is null then
    perform public.avisar_a_quien_tiene('compras.recojo',
      'Recojo programado: ' || v_nombre,
      v_compra.proveedor || '. Va ' || v_lugar || '.º en tu lista, ' || trim(to_char(p_peso, 'FM999G990D00')) || ' kg.',
      '/recojos', p_compra);
    if v_guia.id is null then
      perform public.avisar_a_quien_tiene('compras.guia_remision',
        'Guía de remisión por emitir: ' || v_nombre,
        v_compra.proveedor || ', ' || trim(to_char(p_peso, 'FM999G990D00')) || ' kg. Cárgala en Gestión de compras para que el conductor la lleve.',
        '/compras/gestion', p_compra);
    end if;
  end if;
  return v_lugar;
end;
$$;
revoke all on function public.programar_recojo(uuid, numeric, integer) from public, anon;
grant execute on function public.programar_recojo(uuid, numeric, integer) to authenticated;

-- Sacarla de la lista: el conductor deja de verla para salir. El peso se queda.
create or replace function public.quitar_recojo_de_la_lista(p_compra uuid)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_compra public.ordenes_compra_materiales%rowtype;
  v_cola   uuid[];
  i        integer;
begin
  perform public.exigir_permiso('compras.crear');
  perform pg_advisory_xact_lock(hashtext('programacion_recojo'));
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.' using errcode = 'foreign_key_violation';
  end if;
  if v_compra.recojo is distinct from 'POR_RECOGER' then
    raise exception 'El conductor ya salió a recoger la compra %: ya no se saca de su lista.',
      coalesce(v_compra.numero, v_compra.referencia) using errcode = 'check_violation';
  end if;
  -- Un segundo toque no cambia nada.
  if not exists (select 1 from public.programacion_recojo where orden_compra_id = p_compra and posicion is not null) then
    return p_compra;
  end if;
  update public.programacion_recojo set posicion = null where orden_compra_id = p_compra;

  select coalesce(array_agg(p.orden_compra_id order by p.posicion, p.programado_en, p.orden_compra_id), '{}')
    into v_cola
    from public.programacion_recojo p
    join public.ordenes_compra_materiales c on c.id = p.orden_compra_id
   where c.recojo = 'POR_RECOGER' and p.posicion is not null;
  for i in 1 .. coalesce(array_length(v_cola, 1), 0) loop
    update public.programacion_recojo set posicion = i where orden_compra_id = v_cola[i] and posicion <> i;
  end loop;

  perform public.avisar_a_quien_tiene('compras.recojo',
    'Recojo retirado de tu lista: ' || coalesce(v_compra.numero, v_compra.referencia),
    v_compra.proveedor || '. Logística la sacó de tu lista: no salgas a recogerla.',
    '/recojos', p_compra);
  return p_compra;
end;
$$;
revoke all on function public.quitar_recojo_de_la_lista(uuid) from public, anon;
grant execute on function public.quitar_recojo_de_la_lista(uuid) to authenticated;

-- 9. La guía de remisión: cargar y anular ----------------------------------------------------
-- El PDF ya subió a compra/{oc}/{guía}.pdf; aquí se comprueba y se registra.
-- Idempotente con el mismo id: una respuesta perdida no duplica la guía.
create or replace function public.cargar_guia_remision(
  p_id uuid, p_compra uuid, p_numero text, p_fecha date, p_nombre_archivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_compra  public.ordenes_compra_materiales%rowtype;
  v_existe  public.guias_remision_compra%rowtype;
  v_otra    public.guias_remision_compra%rowtype;
  v_objeto  storage.objects%rowtype;
  v_ruta    text := 'compra/' || p_compra::text || '/' || p_id::text || '.pdf';
  v_numero  text := upper(regexp_replace(btrim(coalesce(p_numero, '')), '\s+', '', 'g'));
  v_nombre  text;
  v_hoy     date := (now() at time zone 'America/Lima')::date;
begin
  perform public.exigir_permiso('compras.guia_remision');

  select * into v_existe from public.guias_remision_compra where id = p_id;
  if found then
    if v_existe.orden_compra_id = p_compra and v_existe.numero = v_numero and v_existe.cargada_por = v_yo then
      return p_id;
    end if;
    raise exception 'Esa guía ya se cargó con otros datos. Vuelve a cargar la pantalla.' using errcode = 'unique_violation';
  end if;

  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.' using errcode = 'foreign_key_violation';
  end if;
  v_nombre := coalesce(v_compra.numero, v_compra.referencia);
  if v_compra.recojo is null then
    raise exception 'La compra % no va con el conductor: no lleva guía de remisión de recojo.', v_nombre using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.programacion_recojo where orden_compra_id = p_compra) then
    raise exception 'Logística todavía no pone el peso de la compra %: la guía de remisión se emite con ese peso.', v_nombre
      using errcode = 'check_violation';
  end if;
  select * into v_otra from public.guias_remision_compra where orden_compra_id = p_compra and anulada_en is null;
  if found then
    raise exception 'La compra % ya tiene la guía %: anúlala con su motivo para cargar otra.', v_nombre, v_otra.numero
      using errcode = 'check_violation';
  end if;
  if v_numero !~ '^[A-Z0-9]{1,4}-[0-9]{1,10}$' then
    raise exception 'Escribe el número de la guía como figura en ella: serie y número, por ejemplo T001-00000123.'
      using errcode = 'check_violation';
  end if;
  if p_fecha is null then
    raise exception 'Escribe la fecha de emisión de la guía.' using errcode = 'check_violation';
  end if;
  if p_fecha > v_hoy then
    raise exception 'La fecha de emisión de la guía no puede ser posterior a hoy.' using errcode = 'check_violation';
  end if;
  if p_fecha < (v_compra.creado_en at time zone 'America/Lima')::date then
    raise exception 'La guía no puede ser anterior a la compra %: revisa la fecha.', v_nombre using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_nombre_archivo, ''))) not between 1 and 200 then
    raise exception 'Vuelve a elegir el PDF de la guía.' using errcode = 'check_violation';
  end if;

  select * into v_objeto from storage.objects where bucket_id = 'guias-remision' and name = v_ruta;
  if not found or v_objeto.owner_id is distinct from v_yo::text
     or v_objeto.metadata->>'mimetype' is distinct from 'application/pdf'
     or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 10485760 then
    raise exception 'El PDF de la guía no terminó de subir: vuelve a elegirlo.' using errcode = 'check_violation';
  end if;

  insert into public.guias_remision_compra (id, orden_compra_id, numero, fecha_emision, nombre_archivo, ruta, tamano_bytes, cargada_por)
  values (p_id, p_compra, v_numero, p_fecha, btrim(p_nombre_archivo), v_ruta, (v_objeto.metadata->>'size')::integer, v_yo);

  -- Al conductor, si todavía no la dejó en almacén.
  if v_compra.recojo <> 'DEJADO' then
    perform public.avisar_a_quien_tiene('compras.recojo',
      'Guía de remisión lista: ' || v_nombre,
      v_compra.proveedor || '. Guía ' || v_numero || ': ábrela desde tu lista y llévala en el teléfono.',
      '/recojos', p_compra);
  end if;
  return p_id;
end;
$$;
revoke all on function public.cargar_guia_remision(uuid, uuid, text, date, text) from public, anon;
grant execute on function public.cargar_guia_remision(uuid, uuid, text, date, text) to authenticated;

create or replace function public.anular_guia_remision(p_guia uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_guia   public.guias_remision_compra%rowtype;
  v_compra public.ordenes_compra_materiales%rowtype;
begin
  perform public.exigir_permiso('compras.guia_remision');
  select * into v_guia from public.guias_remision_compra where id = p_guia for update;
  if not found then
    raise exception 'La guía no existe.' using errcode = 'foreign_key_violation';
  end if;
  if v_guia.anulada_en is not null then
    return p_guia;
  end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 5 then
    raise exception 'Escribe por qué se anula la guía %.', v_guia.numero using errcode = 'check_violation';
  end if;
  update public.guias_remision_compra
     set anulada_en = now(), anulada_por = public.usuario_actual(), motivo_anulacion = btrim(p_motivo)
   where id = p_guia;

  select * into v_compra from public.ordenes_compra_materiales where id = v_guia.orden_compra_id;
  if v_compra.recojo <> 'DEJADO' then
    perform public.avisar_a_quien_tiene('compras.recojo',
      'Guía de remisión anulada: ' || coalesce(v_compra.numero, v_compra.referencia),
      'La guía ' || v_guia.numero || ' ya no vale. Espera la nueva antes de salir.',
      '/recojos', v_compra.id);
  end if;
  return p_guia;
end;
$$;
revoke all on function public.anular_guia_remision(uuid, text) from public, anon;
grant execute on function public.anular_guia_remision(uuid, text) to authenticated;

-- 10. La gestión: lo que ven Logística, Contabilidad y el conductor ----------------------
-- Las OC con el conductor (pendientes, en recojo y recogidas) y las que dejó en
-- almacén esta semana, con su lugar, su peso, su guía vigente y lo que lleva.
-- Sin precios. `lugar` es el 1.º, 2.º… entre las pendientes programadas;
-- `en_lista` dice si Logística la programó.
create or replace function public.compras_en_gestion()
returns table (
  id uuid, numero text, referencia text, origen text, proveedor text, proveedor_documento text,
  proveedor_direccion text, proveedor_telefono text, proveedor_contacto text,
  codigo_interno text, con_factura boolean, comprobante_adjunto boolean,
  recojo text, pedido_en timestamptz, en_recojo_en timestamptz, recogido_en timestamptz, dejado_en timestamptz,
  fecha_estimada date, creado_en timestamptz, ordenes text[], requerimientos text[], lineas jsonb,
  en_lista boolean, lugar integer, peso_kg numeric, programado_en timestamptz,
  guia_id uuid, guia_numero text, guia_fecha date, guia_nombre_archivo text, guia_cargada_en timestamptz,
  guias_anuladas integer
) language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('compras.crear')
          or public.tiene_permiso('compras.guia_remision') or public.tiene_permiso('compras.recojo')) then
    raise exception 'No tienes permiso para ver la gestión de compras.' using errcode = 'insufficient_privilege';
  end if;
  return query
  with lista as (
    select p.orden_compra_id,
           row_number() over (order by p.posicion, p.programado_en, p.orden_compra_id)::integer as lugar
      from public.programacion_recojo p
      join public.ordenes_compra_materiales c on c.id = p.orden_compra_id
     where c.recojo = 'POR_RECOGER' and p.posicion is not null
  )
  select c.id, coalesce(c.numero, c.referencia), c.referencia, c.origen, c.proveedor, pv.numero_documento,
         coalesce(pv.direccion_recojo, pv.direccion), pv.telefono, pv.contacto,
         c.codigo_interno, c.con_factura, public.compra_tiene_comprobante(c),
         c.recojo, c.recojo_pedido_en, c.en_recojo_en, c.recogido_en, c.dejado_en,
         c.fecha_estimada, c.creado_en,
         coalesce(l.ordenes, array[]::text[]),
         coalesce(rq.numeros, array[]::text[]),
         coalesce(l.lineas, '[]'::jsonb),
         pr.posicion is not null, li.lugar, pr.peso_kg, pr.programado_en,
         g.id, g.numero, g.fecha_emision, g.nombre_archivo, g.cargada_en,
         coalesce(ga.n, 0)
    from public.ordenes_compra_materiales c
    left join public.proveedores pv on pv.id = c.proveedor_id
    left join public.programacion_recojo pr on pr.orden_compra_id = c.id
    left join lista li on li.orden_compra_id = c.id
    left join public.guias_remision_compra g on g.orden_compra_id = c.id and g.anulada_en is null
    left join lateral (
      select count(*)::integer as n from public.guias_remision_compra a
       where a.orden_compra_id = c.id and a.anulada_en is not null
    ) ga on true
    left join lateral (
      select array_agg(distinct r.numero order by r.numero) as numeros
        from public.requerimiento_lineas rl
        join public.requerimientos r on r.id = rl.requerimiento_id
       where rl.orden_compra_id = c.id
    ) rq on true
    left join lateral (
      select array_remove(array_agg(distinct o.numero), null) as ordenes,
             jsonb_agg(jsonb_build_object(
               'material_codigo', m.codigo, 'material', m.descripcion, 'unidad', um.codigo,
               'cantidad', d.cantidad, 'orden', o.numero) order by m.descripcion) as lineas
        from public.orden_compra_material_detalles d
        left join public.requerimientos_materiales r on r.id = d.requerimiento_id
        left join public.ordenes_trabajo o on o.id = r.orden_id
        left join public.requerimiento_material_detalles rd on rd.id = d.requerimiento_detalle_id
        left join public.ot_materiales om on om.id = rd.ot_material_id
        left join public.materiales m on m.id = coalesce(d.material_id, om.material_id)
        left join public.unidades_medida um on um.id = m.unidad_medida_id
       where d.orden_compra_id = c.id
    ) l on true
   where c.recojo in ('POR_RECOGER', 'EN_RECOJO', 'RECOGIDO')
      or (c.recojo = 'DEJADO' and c.dejado_en > now() - interval '7 days')
   order by case c.recojo when 'RECOGIDO' then 0 when 'EN_RECOJO' then 1 when 'POR_RECOGER' then 2 else 3 end,
            li.lugar nulls last,
            coalesce(c.dejado_en, c.recojo_pedido_en) desc
   limit 200;
end;
$$;
revoke all on function public.compras_en_gestion() from public, anon;
grant execute on function public.compras_en_gestion() to authenticated;
