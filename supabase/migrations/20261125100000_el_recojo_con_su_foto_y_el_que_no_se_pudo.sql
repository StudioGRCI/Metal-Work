-- El conductor hace su ruta sin llamar a Logística, y cada recojo queda con su
-- evidencia (Plan 5 «Conductor de Logística», entrega 5.2; decisiones de DKS
-- del 25/11/2026).
--
-- Hasta hoy el conductor solo podía avanzar: «Salgo a recoger», «Ya la recogí»,
-- «La dejé en almacén». Si llegaba al proveedor y no había nada que recoger
-- —cerrado, el material no estaba listo, faltaba un papel—, la compra se
-- quedaba «En recojo» para siempre y lo arreglaba por teléfono con Logística.
-- Y de lo que sí recogía no quedaba más que la hora.
--
--   * Al marcar «Ya la recogí» puede sumar hasta tres fotos: la guía firmada
--     o el bulto. Son opcionales (decisión de DKS). Van a un bucket privado;
--     las ven el conductor y Logística, y ya anotadas no se cambian ni se
--     borran: son la evidencia.
--   * «No se pudo recoger», con su motivo obligatorio: la compra vuelve a «Por
--     programar» de Logística, sale de la lista del conductor y a Logística le
--     llega el aviso por la campana con el motivo. Queda anotado quién lo
--     dijo, cuándo, y a qué hora había salido a recogerla.
--   * No se sigue la ubicación del conductor (decisión de DKS).
--
-- Las dos van por función, con `compras.recojo`, y solo sobre lo que Logística
-- le puso en su lista: la compra programada, o la que esa misma cuenta ya salió
-- a recoger. El mismo envío repetido (la respuesta que no llegó, el segundo
-- toque) no entra dos veces: devuelve lo de la primera vez, y si trae otra cosa
-- lo dice. El conductor sigue sin leer las tablas y sin ver precios.

-- 0. La función del disparador es la que conoce el repositorio ----------------------------
-- La sección 6 reemplaza `fn_compra_recojo` entera. Si producción la cambió a
-- mano, se detiene aquí en vez de pisar ese arreglo (skill `esquema` › Trampas).
do $$
declare
  conocidas constant text[] := array['079ed4a2bebd449d921d0e634aa4f667', '90d66eab42654f6e371fdea30c979e73'];
  huella text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into huella
    from pg_proc p where p.oid = to_regprocedure('public.fn_compra_recojo()');
  if huella is null then
    raise exception 'Falta la función fn_compra_recojo(): esta base no tiene las migraciones anteriores.';
  end if;
  if huella <> all (conocidas) then
    raise exception 'La función fn_compra_recojo() no es la que conoce el repositorio (se cambió a mano): no se reemplaza. Avisa antes de seguir.';
  end if;
end $$;

-- 1. Las fotos del recojo -----------------------------------------------------------------
create table if not exists public.recojo_fotos (
  id               uuid primary key default gen_random_uuid(),
  orden_compra_id  uuid not null,
  orden            smallint not null,
  ruta             text not null,
  mime_type        text not null,
  tamano_bytes     integer not null,
  subida_por       uuid not null default public.usuario_actual(),
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  constraint recojo_fotos_orden_compra_id_fkey foreign key (orden_compra_id)
    references public.ordenes_compra_materiales(id) on delete restrict,
  -- Sin índice: nadie filtra por quién la subió y la cuenta no se borra (se desactiva).
  constraint recojo_fotos_subida_por_fkey foreign key (subida_por)
    references public.usuarios(id) on delete restrict,
  -- También es el índice de la llave hacia la OC.
  constraint uq_recojo_foto_orden unique (orden_compra_id, orden),
  -- Una foto, un recojo; y la política de Storage la busca por su ruta.
  constraint uq_recojo_foto_ruta unique (ruta),
  constraint ck_recojo_foto check (
    orden between 1 and 3
    and mime_type in ('image/jpeg', 'image/png', 'image/webp')
    and tamano_bytes between 1 and 5242880)
);
comment on table public.recojo_fotos is
  'Hasta tres fotos que el conductor suma al marcar «Ya la recogí» (la guía firmada, el bulto), en el bucket fotos-recojo con la ruta {cuenta}/{oc}/{foto}. Opcionales. No se cambian ni se borran: son la evidencia del recojo. Las escribe marcar_compra_recogida_con_fotos; las pantallas las leen por recojo_fotos_en_gestion.';

select public.activar_timestamps('recojo_fotos');
select public.activar_auditoria('recojo_fotos');
select public.activar_registro_de_prueba('recojo_fotos');

-- 2. Los recojos que no se pudieron hacer ----------------------------------------------------
-- El id lo pone la pantalla: es el del envío, para reconocer el mismo otra vez.
create table if not exists public.recojos_no_logrados (
  id               uuid primary key,
  orden_compra_id  uuid not null,
  motivo           text not null,
  salio_en         timestamptz,
  programado_en    timestamptz,
  registrado_por   uuid not null default public.usuario_actual(),
  registrado_en    timestamptz not null default now(),
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  constraint recojos_no_logrados_orden_compra_id_fkey foreign key (orden_compra_id)
    references public.ordenes_compra_materiales(id) on delete restrict,
  -- Sin índice: nadie filtra por quién lo registró y la cuenta no se borra (se desactiva).
  constraint recojos_no_logrados_registrado_por_fkey foreign key (registrado_por)
    references public.usuarios(id) on delete restrict,
  constraint ck_recojo_no_logrado_motivo check (char_length(motivo) between 10 and 500)
);
-- (b) de la regla de índices: la gestión de compras filtra por la OC en cada carga.
create index if not exists idx_recojos_no_logrados_compra on public.recojos_no_logrados (orden_compra_id, registrado_en desc);
comment on table public.recojos_no_logrados is
  'Cada vez que el conductor fue por una compra y no la pudo recoger: su motivo, quién y cuándo. La compra vuelve a «Por programar» de Logística. No se cambia ni se borra. La escribe marcar_recojo_no_logrado; las pantallas la leen por recojos_no_logrados_en_gestion.';
comment on column public.recojos_no_logrados.salio_en is
  'A qué hora había marcado «Salgo a recoger», si ya había salido. La compra pierde esa hora al volver a la lista de Logística; queda aquí.';
comment on column public.recojos_no_logrados.programado_en is
  'Cuándo Logística la había puesto en la lista del conductor: dice de cuál de sus programaciones es este intento.';

select public.activar_timestamps('recojos_no_logrados');
select public.activar_auditoria('recojos_no_logrados');
select public.activar_registro_de_prueba('recojos_no_logrados');

-- Lo anotado es evidencia: ni se cambia ni se borra, tampoco por el administrador.
create or replace function public.fn_recojo_evidencia_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'Lo anotado de un recojo (sus fotos y los intentos que no se pudieron) no se cambia ni se borra: queda como evidencia.'
    using errcode = 'check_violation';
end;
$$;
revoke all on function public.fn_recojo_evidencia_guardia() from public, anon, authenticated;

drop trigger if exists trg_recojo_foto_guardia on public.recojo_fotos;
create trigger trg_recojo_foto_guardia
  before update or delete on public.recojo_fotos
  for each row execute function public.fn_recojo_evidencia_guardia();
drop trigger if exists trg_recojo_no_logrado_guardia on public.recojos_no_logrados;
create trigger trg_recojo_no_logrado_guardia
  before update or delete on public.recojos_no_logrados
  for each row execute function public.fn_recojo_evidencia_guardia();

-- 3. Quién ve qué -------------------------------------------------------------------------
-- Las tablas las lee Logística (y el administrador). El conductor no lee
-- tablas: ve lo suyo por las funciones de la sección 8, como el resto de su
-- pantalla. Escribir, solo por las funciones.
alter table public.recojo_fotos enable row level security;
alter table public.recojos_no_logrados enable row level security;
drop policy if exists ver_recojo_fotos on public.recojo_fotos;
create policy ver_recojo_fotos on public.recojo_fotos for select to authenticated
  using ((select public.es_admin()) or (select public.tiene_permiso('compras.programar_recojo')));
drop policy if exists ver_recojos_no_logrados on public.recojos_no_logrados;
create policy ver_recojos_no_logrados on public.recojos_no_logrados for select to authenticated
  using ((select public.es_admin()) or (select public.tiene_permiso('compras.programar_recojo')));
revoke all on public.recojo_fotos from public, anon, authenticated;
revoke all on public.recojos_no_logrados from public, anon, authenticated;
grant select on public.recojo_fotos to authenticated;
grant select on public.recojos_no_logrados to authenticated;

-- 4. Las fotos en Storage -----------------------------------------------------------------
-- Ya achicadas en el teléfono pesan unos cientos de KB: 5 MB es de sobra.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-recojo', 'fotos-recojo', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- «Algún recojo nombra esta foto»: lo preguntan las políticas de abajo con el
-- rol de quien mira, y el conductor no lee la tabla. Por eso es `security
-- definer` y `authenticated` la puede ejecutar: solo dice sí o no de una ruta.
create or replace function public.foto_de_recojo_anotada(p_ruta text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.recojo_fotos f where f.ruta = p_ruta);
$$;
revoke all on function public.foto_de_recojo_anotada(text) from public, anon;
grant execute on function public.foto_de_recojo_anotada(text) to authenticated;
comment on function public.foto_de_recojo_anotada(text) is
  'Si algún recojo nombra la foto de esa ruta. La usan las políticas del bucket fotos-recojo (migración 20261125100000).';

-- La ruta es {cuenta}/{oc}/{foto}: cada cuenta sube solo a su carpeta y solo
-- quien marca recojos. La foto la ve quien la subió (para quitarla del
-- formulario: Storage quita con un DELETE … RETURNING y le aplica también esta
-- política) y, ya anotada, el conductor y Logística. Una suelta (subida y
-- quitada, o de una ventana que se cerró) la retira su dueño mientras ningún
-- recojo la nombre; la anotada no la quita nadie.
drop policy if exists recojo_subir_foto on storage.objects;
create policy recojo_subir_foto on storage.objects for insert to authenticated with check (
  bucket_id = 'fotos-recojo' and owner_id = (select auth.uid())::text
  and split_part(name, '/', 1) = (select auth.uid())::text
  and (select public.tiene_permiso('compras.recojo')));
drop policy if exists recojo_ver_foto on storage.objects;
create policy recojo_ver_foto on storage.objects for select to authenticated using (
  bucket_id = 'fotos-recojo'
  and (owner_id = (select auth.uid())::text
       or (((select public.es_admin()) or (select public.tiene_permiso('compras.recojo'))
            or (select public.tiene_permiso('compras.programar_recojo')))
           and public.foto_de_recojo_anotada(name))));
drop policy if exists recojo_quitar_foto_suelta on storage.objects;
create policy recojo_quitar_foto_suelta on storage.objects for delete to authenticated using (
  bucket_id = 'fotos-recojo' and owner_id = (select auth.uid())::text
  and not public.foto_de_recojo_anotada(name));

-- 5. Anotar las fotos de un recojo -----------------------------------------------------------
-- p_fotos: ["{cuenta}/{oc}/{foto}.jpg", …], ya subidas a fotos-recojo. La llama
-- marcar_compra_recogida_con_fotos, nadie más. El tipo y el tamaño son los que
-- guardó Storage, no los que diga el navegador.
create or replace function public.recojo_anotar_fotos(p_compra uuid, p_fotos jsonb)
returns void language plpgsql set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_ruta   text;
  v_objeto storage.objects%rowtype;
  v_n      int := 0;
begin
  if jsonb_array_length(p_fotos) > 3 then
    raise exception 'Van hasta 3 fotos del recojo: quita las que sobran.' using errcode = 'check_violation';
  end if;
  for v_ruta in select jsonb_array_elements_text(p_fotos) loop
    v_n := v_n + 1;
    if v_yo is null or v_ruta !~ ('^' || v_yo::text || '/' || p_compra::text || '/[0-9a-f-]{36}\.(jpg|png|webp)$') then
      raise exception 'Vuelve a poner las fotos del recojo.' using errcode = 'check_violation';
    end if;
    select * into v_objeto from storage.objects where bucket_id = 'fotos-recojo' and name = v_ruta;
    if not found or v_objeto.owner_id is distinct from v_yo::text
       or v_objeto.metadata->>'mimetype' not in ('image/jpeg', 'image/png', 'image/webp')
       or coalesce((v_objeto.metadata->>'size')::bigint, 0) not between 1 and 5242880 then
      raise exception 'La foto % no terminó de subir: quítala y vuelve a ponerla.', v_n using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.recojo_fotos where ruta = v_ruta) then
      raise exception 'La foto % está repetida: quítala.', v_n using errcode = 'check_violation';
    end if;
    insert into public.recojo_fotos (orden_compra_id, orden, ruta, mime_type, tamano_bytes)
    values (p_compra, v_n, v_ruta, v_objeto.metadata->>'mimetype', (v_objeto.metadata->>'size')::integer);
  end loop;
end;
$$;
revoke all on function public.recojo_anotar_fotos(uuid, jsonb) from public, anon, authenticated;

-- 6. El disparador deja volver a Logística la compra que no se pudo recoger ---------------
-- Igual que la vigente (20261015140000 con los textos de 20261022220000), con
-- una sola puerta nueva: de EN_RECOJO a POR_RECOGER, soltando la hora de
-- «Salgo a recoger», cuando lo hace marcar_recojo_no_logrado para esa misma
-- compra (la señal `metalwork.recojo_no_logrado`, como `metalwork.anulando_oc`
-- en la anulación). Esa hora no se pierde: queda en recojos_no_logrados. Ese
-- camino manda su propio aviso a Logística, con el motivo; por eso no pasa por
-- el de «Programa el recojo».
create or replace function public.fn_compra_recojo()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_orden constant text[] := array['POR_RECOGER', 'EN_RECOJO', 'RECOGIDO', 'DEJADO'];
  v_antes int; v_ahora int;
  -- El conductor avisó que no se pudo recoger: la función puso la señal para esta compra.
  -- Sin la señal, current_setting da null: el coalesce lo vuelve falso, o el
  -- «not v_no_logrado» de abajo saltaría todas las guardas.
  v_no_logrado constant boolean := coalesce(old.recojo = 'EN_RECOJO' and new.recojo = 'POR_RECOGER'
    and current_setting('metalwork.recojo_no_logrado', true) = new.id::text, false);
begin
  -- La compra aprobada sale sola hacia el recojo.
  if new.aprobacion = 'APROBADA' and old.aprobacion is distinct from 'APROBADA'
     and new.recojo is null and new.entregado_almacen_en is null then
    new.recojo := 'POR_RECOGER';
    new.recojo_pedido_en := now();
    new.recojo_pedido_por := coalesce(new.aprobado_por, public.usuario_actual());
  end if;

  if new.recojo is distinct from old.recojo
     and not v_no_logrado
     and not (new.recojo is null and new.aprobacion = 'ANULADA' and old.recojo in ('POR_RECOGER', 'EN_RECOJO')
              and current_setting('metalwork.anulando_oc', true) = new.id::text) then
    v_antes := coalesce(array_position(v_orden, old.recojo), 0);
    v_ahora := coalesce(array_position(v_orden, new.recojo), 0);
    -- Un paso adelante; o de POR_RECOGER a RECOGIDO si no marcó la salida.
    if not (v_ahora = v_antes + 1 or (old.recojo = 'POR_RECOGER' and new.recojo = 'RECOGIDO')) then
      raise exception 'El recojo de la % no puede pasar de % a %.',
        public.nombre_de_oc(new.numero, new.referencia), coalesce(old.recojo, 'sin recojo'), coalesce(new.recojo, 'sin recojo')
        using errcode = 'check_violation';
    end if;
    if new.recojo = 'POR_RECOGER' then
      if new.aprobacion in ('POR_APROBAR', 'RECHAZADA', 'ANULADA') then
        raise exception '%', public.mensaje_compra_sin_aprobar(new) using errcode = 'check_violation';
      end if;
      perform public.avisar_a_quien_tiene('compras.programar_recojo',
        'Programa el recojo: ' || public.nombre_de_oc(new.numero, new.referencia),
        new.proveedor || '. Ponle su peso y su lugar en la lista del conductor.',
        '/compras/gestion', new.id,
        case when new.aprobacion = 'APROBADA' and old.aprobacion is distinct from 'APROBADA' then new.creado_por end);
    end if;
    -- El conductor sale a recoger lo que Logística le puso en su lista.
    if old.recojo = 'POR_RECOGER' and new.recojo in ('EN_RECOJO', 'RECOGIDO')
       and not exists (select 1 from public.programacion_recojo p
                        where p.orden_compra_id = new.id and p.posicion is not null) then
      raise exception 'Logística todavía no programa el recojo de la %: espera a que la ponga en tu lista.',
        public.nombre_de_oc(new.numero, new.referencia) using errcode = 'check_violation';
    end if;
  end if;

  -- Lo que el conductor marcó queda como evidencia. La hora de «Salgo a
  -- recoger» de un recojo que no se pudo hacer se suelta aquí y queda en
  -- recojos_no_logrados: la compra tiene que poder salir otra vez.
  if (old.recogido_en is not null and (new.recogido_en is distinct from old.recogido_en or new.recogido_por is distinct from old.recogido_por))
     or (old.dejado_en is not null and (new.dejado_en is distinct from old.dejado_en or new.dejado_por is distinct from old.dejado_por))
     or (old.en_recojo_en is not null and (new.en_recojo_en is distinct from old.en_recojo_en or new.en_recojo_por is distinct from old.en_recojo_por)
         and not (v_no_logrado and new.en_recojo_en is null and new.en_recojo_por is null))
     or (old.recojo_pedido_en is not null and new.recojo_pedido_en is distinct from old.recojo_pedido_en) then
    raise exception 'El recojo de la % ya quedó registrado y no se corrige.', public.nombre_de_oc(new.numero, new.referencia)
      using errcode = 'check_violation';
  end if;

  -- Mientras está con el conductor, la entrega a Almacén la marca él al dejarla.
  if new.entregado_almacen_en is not null and old.entregado_almacen_en is null
     and new.recojo in ('POR_RECOGER', 'EN_RECOJO', 'RECOGIDO') then
    raise exception 'La % está con el conductor: la entrega a Almacén se marca cuando él la deja.',
      public.nombre_de_oc(new.numero, new.referencia) using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;
revoke all on function public.fn_compra_recojo() from public, anon, authenticated;

-- 7. Lo que marca el conductor ----------------------------------------------------------------
-- «Ya la recogí», con sus fotos si las tomó. Las mismas reglas de
-- marcar_compra_recogida (20261013121000) y dos más: la compra tiene que estar
-- en la lista que Logística programó, y si ya salieron a recogerla, la marca la
-- cuenta que salió. La función de antes, sin fotos, se queda para la pestaña
-- abierta antes del despliegue.
create or replace function public.marcar_compra_recogida_con_fotos(p_compra uuid, p_fotos jsonb)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo     uuid := public.usuario_actual();
  v_compra public.ordenes_compra_materiales%rowtype;
  v_fotos  jsonb := coalesce(p_fotos, '[]'::jsonb);
  v_nombre text;
begin
  perform public.exigir_permiso('compras.recojo');
  if jsonb_typeof(v_fotos) <> 'array' then
    raise exception 'Vuelve a poner las fotos del recojo.' using errcode = 'check_violation';
  end if;
  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.' using errcode = 'foreign_key_violation';
  end if;
  v_nombre := public.nombre_de_oc(v_compra.numero, v_compra.referencia);

  if v_compra.recojo in ('RECOGIDO', 'DEJADO') then
    -- El mismo envío otra vez (no llegó la respuesta, un segundo toque): lo de la primera vez.
    if v_compra.recogido_por = v_yo and public.mismo_envio(p_compra, 'RECOJO', jsonb_build_array(v_fotos)) then
      return p_compra;
    end if;
    if v_compra.recogido_por = v_yo then
      raise exception 'La % ya quedó marcada como recogida la primera vez que lo enviaste: lo que cambiaste en las fotos no se guardó. Recarga la pantalla para ver cómo quedó.',
        v_nombre using errcode = 'check_violation';
    end if;
    raise exception 'La % ya figura recogida por otra cuenta: las fotos de ahora no se guardaron. Recarga la pantalla.',
      v_nombre using errcode = 'check_violation';
  end if;
  if v_compra.recojo is null or v_compra.recojo not in ('POR_RECOGER', 'EN_RECOJO') then
    raise exception 'La % no está mandada a recojo.', v_nombre using errcode = 'check_violation';
  end if;
  if v_compra.recojo = 'POR_RECOGER' and not exists (
       select 1 from public.programacion_recojo p where p.orden_compra_id = p_compra and p.posicion is not null) then
    raise exception 'Logística todavía no programa el recojo de la %: espera a que la ponga en tu lista.', v_nombre
      using errcode = 'check_violation';
  end if;
  if v_compra.recojo = 'EN_RECOJO' and v_compra.en_recojo_por is distinct from v_yo then
    raise exception 'A recoger la % salió otra cuenta: la marca recogida quien salió por ella.', v_nombre
      using errcode = 'check_violation';
  end if;

  update public.ordenes_compra_materiales
     set recojo = 'RECOGIDO', recogido_en = now(), recogido_por = v_yo
   where id = p_compra;
  perform public.recojo_anotar_fotos(p_compra, v_fotos);
  perform public.anotar_envio(p_compra, 'RECOJO', jsonb_build_array(v_fotos));
  return p_compra;
end;
$$;
revoke all on function public.marcar_compra_recogida_con_fotos(uuid, jsonb) from public, anon;
grant execute on function public.marcar_compra_recogida_con_fotos(uuid, jsonb) to authenticated;
comment on function public.marcar_compra_recogida_con_fotos(uuid, jsonb) is
  '«Ya la recogí» del conductor, con hasta tres fotos opcionales ya subidas a fotos-recojo. Exige compras.recojo y que la compra esté en la lista que programó Logística. El mismo envío repetido devuelve lo de la primera vez (migración 20261125100000).';

-- «No se pudo recoger»: la compra vuelve a «Por programar» de Logística con su
-- motivo. p_id es el id del envío: el mismo otra vez devuelve lo de antes.
create or replace function public.marcar_recojo_no_logrado(p_id uuid, p_compra uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo       uuid := public.usuario_actual();
  v_motivo   text := btrim(regexp_replace(coalesce(p_motivo, ''), '\s+', ' ', 'g'));
  v_antes    public.recojos_no_logrados%rowtype;
  v_compra   public.ordenes_compra_materiales%rowtype;
  v_prog     public.programacion_recojo%rowtype;
  v_nombre   text;
  v_con_guia boolean;
  v_cola     uuid[];
  i          integer;
begin
  perform public.exigir_permiso('compras.recojo');
  if p_id is null then
    raise exception 'Vuelve a cargar la pantalla y avisa otra vez que no se pudo recoger.' using errcode = 'check_violation';
  end if;
  -- La lista es una: quien la reordena espera a quien la está cambiando.
  perform pg_advisory_xact_lock(hashtext('programacion_recojo'));

  select * into v_compra from public.ordenes_compra_materiales where id = p_compra for update;
  if not found then
    raise exception 'La compra no existe.' using errcode = 'foreign_key_violation';
  end if;
  v_nombre := public.nombre_de_oc(v_compra.numero, v_compra.referencia);
  select * into v_prog from public.programacion_recojo where orden_compra_id = p_compra;

  select * into v_antes from public.recojos_no_logrados where id = p_id;
  if found then
    -- El mismo envío otra vez: la misma compra, la misma cuenta, el mismo motivo,
    -- y la compra sigue como la dejó aquel aviso. Si Logística ya la volvió a
    -- programar, lo de ahora es otro intento y lleva otro id.
    if v_antes.orden_compra_id = p_compra and v_antes.registrado_por = v_yo and v_antes.motivo = v_motivo
       and v_compra.recojo = 'POR_RECOGER' and v_prog.posicion is null then
      return p_id;
    end if;
    if v_antes.registrado_por = v_yo then
      raise exception 'Ese aviso de que no se pudo recoger ya quedó registrado la primera vez que lo enviaste: lo que cambiaste después no se guardó. Recarga la pantalla para ver cómo quedó.'
        using errcode = 'check_violation';
    end if;
    raise exception 'Ese aviso ya existe con otros datos: recarga la pantalla y vuelve a enviarlo.' using errcode = 'unique_violation';
  end if;

  if char_length(v_motivo) < 10 then
    raise exception 'Escribe por qué no se pudo recoger la %, con al menos 10 letras: Logística lo lee para volver a programarla.', v_nombre
      using errcode = 'check_violation';
  end if;
  if char_length(v_motivo) > 500 then
    raise exception 'El motivo pasa de 500 letras: acórtalo.' using errcode = 'check_violation';
  end if;

  if v_compra.recojo = 'POR_RECOGER' then
    if v_prog.posicion is null then
      raise exception 'La % no está en tu lista: Logística todavía no la programa.', v_nombre using errcode = 'check_violation';
    end if;
  elsif v_compra.recojo = 'EN_RECOJO' then
    if v_compra.en_recojo_por is distinct from v_yo then
      raise exception 'A recoger la % salió otra cuenta: avisa que no se pudo quien salió por ella.', v_nombre
        using errcode = 'check_violation';
    end if;
  elsif v_compra.recojo in ('RECOGIDO', 'DEJADO') then
    raise exception 'La % ya figura recogida: «No se pudo recoger» es para antes de tenerla.', v_nombre using errcode = 'check_violation';
  else
    raise exception 'La % no está mandada a recojo.', v_nombre using errcode = 'check_violation';
  end if;

  insert into public.recojos_no_logrados (id, orden_compra_id, motivo, salio_en, programado_en, registrado_por)
  values (p_id, p_compra, v_motivo, v_compra.en_recojo_en, v_prog.programado_en, v_yo);

  -- Vuelve a Logística: sin la hora de la salida (queda arriba) y fuera de la lista.
  if v_compra.recojo = 'EN_RECOJO' then
    perform set_config('metalwork.recojo_no_logrado', p_compra::text, true);
    update public.ordenes_compra_materiales
       set recojo = 'POR_RECOGER', en_recojo_en = null, en_recojo_por = null
     where id = p_compra;
    perform set_config('metalwork.recojo_no_logrado', '', true);
  end if;
  update public.programacion_recojo set posicion = null where orden_compra_id = p_compra and posicion is not null;

  -- Las que quedan en la lista, 1, 2, 3… en su orden.
  select coalesce(array_agg(p.orden_compra_id order by p.posicion, p.programado_en, p.orden_compra_id), '{}')
    into v_cola
    from public.programacion_recojo p
    join public.ordenes_compra_materiales c on c.id = p.orden_compra_id
   where c.recojo = 'POR_RECOGER' and p.posicion is not null;
  for i in 1 .. coalesce(array_length(v_cola, 1), 0) loop
    update public.programacion_recojo set posicion = i where orden_compra_id = v_cola[i] and posicion <> i;
  end loop;

  v_con_guia := exists (select 1 from public.guias_remision_compra g where g.orden_compra_id = p_compra and g.anulada_en is null);
  perform public.avisar_a_quien_tiene('compras.programar_recojo',
    'No se pudo recoger: ' || v_nombre,
    v_compra.proveedor || '. El conductor dice: «' || v_motivo || '». Volvió a «Por programar»: ponla otra vez en su lista cuando se pueda recoger.'
      || case when v_con_guia then ' Su guía de remisión sigue cargada.' else '' end,
    '/compras/gestion', p_compra);
  return p_id;
end;
$$;
revoke all on function public.marcar_recojo_no_logrado(uuid, uuid, text) from public, anon;
grant execute on function public.marcar_recojo_no_logrado(uuid, uuid, text) to authenticated;
comment on function public.marcar_recojo_no_logrado(uuid, uuid, text) is
  '«No se pudo recoger» del conductor, con su motivo: la compra programada o a la que ya salió vuelve a «Por programar» de Logística, que recibe el aviso. Exige compras.recojo. El mismo envío (p_id) repetido devuelve lo de la primera vez (migración 20261125100000).';

-- 8. Lo que leen las pantallas ----------------------------------------------------------------
-- Las mismas compras que compras_en_gestion y el mismo permiso: Logística y el
-- conductor. Sin precios. Van aparte para no cambiar las columnas de aquella.
create or replace function public.recojo_fotos_en_gestion()
returns table (orden_compra_id uuid, orden smallint, ruta text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('compras.programar_recojo') or public.tiene_permiso('compras.recojo')) then
    raise exception 'No tienes permiso para ver los recojos.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select f.orden_compra_id, f.orden, f.ruta
    from public.recojo_fotos f
    join public.ordenes_compra_materiales c on c.id = f.orden_compra_id
   where c.recojo = 'RECOGIDO' or (c.recojo = 'DEJADO' and c.dejado_en > now() - interval '7 days')
   order by f.orden_compra_id, f.orden;
end;
$$;
revoke all on function public.recojo_fotos_en_gestion() from public, anon;
grant execute on function public.recojo_fotos_en_gestion() to authenticated;
comment on function public.recojo_fotos_en_gestion() is
  'Las fotos de los recojos que hoy muestra la gestión de compras (lo recogido y lo dejado esta semana): la OC, el orden y la ruta en fotos-recojo. Para Logística y el conductor (migración 20261125100000).';

-- Los intentos de las compras que siguen en la gestión, el más reciente primero.
create or replace function public.recojos_no_logrados_en_gestion()
returns table (id uuid, orden_compra_id uuid, motivo text, registrado_en timestamptz, salio_en timestamptz, registrado_por_nombre text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('compras.programar_recojo') or public.tiene_permiso('compras.recojo')) then
    raise exception 'No tienes permiso para ver los recojos.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select n.id, n.orden_compra_id, n.motivo, n.registrado_en, n.salio_en,
         nullif(btrim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')), '')
    from public.recojos_no_logrados n
    join public.ordenes_compra_materiales c on c.id = n.orden_compra_id
    left join public.usuarios u on u.id = n.registrado_por
   where c.recojo in ('POR_RECOGER', 'EN_RECOJO', 'RECOGIDO')
      or (c.recojo = 'DEJADO' and c.dejado_en > now() - interval '7 days')
   order by n.registrado_en desc
   limit 500;
end;
$$;
revoke all on function public.recojos_no_logrados_en_gestion() from public, anon;
grant execute on function public.recojos_no_logrados_en_gestion() to authenticated;
comment on function public.recojos_no_logrados_en_gestion() is
  'Los recojos que no se pudieron hacer, de las compras que siguen en la gestión: el motivo, cuándo, a qué hora había salido y quién lo registró. Para Logística y el conductor (migración 20261125100000).';
