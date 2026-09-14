-- =============================================================================
-- LA COTIZACIÓN SE QUITA, SI NUNCA TUVO ORDEN
-- -----------------------------------------------------------------------------
-- «Permite borrar también.» Hasta ahora una cotización subida solo la quitaba
-- quien la subió, y solo mientras Gerencia no la hubiera mirado. Se quedaban
-- dos casos sin salida: la que Gerencia rechazó —que ya no va a ninguna parte y
-- ensucia la lista de Ventas— y la que subió mal alguien que no está.
--
-- Queda así:
--   · La quita quien la subió, o Gerencia (`cotizaciones.revisar`).
--   · Mientras esté por revisar o rechazada. Una aprobada es el visto bueno de
--     Gerencia a un precio: no desaparece.
--   · Nunca si alguna vez salió una orden de ella, ni aunque esa orden se haya
--     anulado. `ordenes_trabajo.cotizacion_pdf_id` se pone en nulo al borrar la
--     cotización, y la orden anulada perdería de dónde vino sin que nadie se
--     enterara.
--
-- Y el PDF se va con ella. El almacenamiento solo dejaba borrar el archivo a su
-- dueño, así que cuando la quitara Gerencia la fila se iba y el PDF se quedaba
-- donde ninguna fila lo nombra: no lo ve nadie y no lo borra nadie. Ahora el
-- archivo lo puede borrar quien quita la cotización, pero solo cuando ya no hay
-- una cotización que lo nombre: nadie deja a una cotización viva sin su papel.
-- =============================================================================

-- =============================================================================
-- 1. QUIÉN LA QUITA, Y CUÁNDO
-- =============================================================================
drop policy if exists borrar_cotizaciones_pdf on public.cotizaciones_pdf;
create policy borrar_cotizaciones_pdf on public.cotizaciones_pdf
  for delete to authenticated
  using (public.es_admin()
         or ((registrado_por = public.usuario_actual() or public.tiene_permiso('cotizaciones.revisar'))
             and estado in ('POR_REVISAR', 'RECHAZADA')));

-- =============================================================================
-- 2. LA QUE TUVO ORDEN NO SE QUITA, NI POR EL ADMINISTRADOR
-- -----------------------------------------------------------------------------
-- Va en un disparador y no en la política a propósito: la política esconde la
-- fila y el borrado afecta cero filas sin decir por qué; el disparador lo dice.
-- =============================================================================
create or replace function public.fn_cotizacion_pdf_con_orden_se_queda()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_orden text;
begin
  select o.numero into v_orden
    from public.ordenes_trabajo o
   where o.cotizacion_pdf_id = old.id
   order by o.creado_en desc
   limit 1;

  if found then
    raise exception 'La cotización % no se quita: de ella salió la orden %, y es su rastro.', old.numero, v_orden
      using errcode = 'check_violation';
  end if;

  return old;
end;
$$;

revoke all on function public.fn_cotizacion_pdf_con_orden_se_queda() from public, anon, authenticated;

drop trigger if exists trg_cotizacion_pdf_con_orden_se_queda on public.cotizaciones_pdf;
create trigger trg_cotizacion_pdf_con_orden_se_queda before delete on public.cotizaciones_pdf
  for each row execute function public.fn_cotizacion_pdf_con_orden_se_queda();

-- =============================================================================
-- 3. EL PDF SE VA CON LA COTIZACIÓN
-- -----------------------------------------------------------------------------
-- Quien sube (el dueño del archivo) y quien revisa pueden borrar el PDF, pero
-- solo el que ya no nombra ninguna cotización. La acción borra primero la fila
-- y después el archivo, así que en ese momento ya no la nombra. También cubre
-- el archivo que subió y no se llegó a anotar.
--
-- La subconsulta corre con los permisos de quien borra: los dos roles que
-- pueden borrar ven las cotizaciones (`cotizaciones.ver`), y se comprueba abajo.
-- =============================================================================
drop policy if exists mw_borrar_cotizaciones_pdf on storage.objects;
create policy mw_borrar_cotizaciones_pdf on storage.objects
  for delete to authenticated
  using (bucket_id = 'cotizaciones-pdf'
         and (public.es_admin()
              or ((owner_id = (auth.uid())::text or public.tiene_permiso('cotizaciones.revisar'))
                  and not exists (select 1 from public.cotizaciones_pdf c
                                   where c.ruta_storage = objects.name))));

-- =============================================================================
-- 4. LA LISTA SABE SI TUVO ORDEN
-- -----------------------------------------------------------------------------
-- `orden_id` es solo la orden viva. Para no ofrecer «Quitar» en una que tuvo
-- una orden anulada, la pantalla necesita saber si alguna vez salió una. Va al
-- final: una vista que ya existe solo admite columnas nuevas al final.
-- =============================================================================
create or replace view public.v_cotizaciones_pdf as
select c.id,
       c.numero,
       c.estado::text as estado,
       c.observacion,
       c.cliente_id,
       cl.razon_social as cliente,
       c.tipo_carroceria_id,
       tc.nombre as carroceria,
       c.nombre_archivo,
       c.ruta_storage,
       c.tamano_bytes,
       c.creado_en,
       c.registrado_por,
       nullif(btrim(coalesce(v.nombres, '') || ' ' || coalesce(v.apellidos, '')), '') as registrado_por_nombre,
       c.revisado_en,
       nullif(btrim(coalesce(g.nombres, '') || ' ' || coalesce(g.apellidos, '')), '') as revisado_por_nombre,
       o.id as orden_id,
       o.numero as orden_numero,
       o.estado::text as orden_estado,
       exists (select 1 from public.ordenes_trabajo t where t.cotizacion_pdf_id = c.id) as tuvo_orden
  from public.cotizaciones_pdf c
  left join public.clientes cl on cl.id = c.cliente_id
  left join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
  left join public.usuarios v on v.id = c.registrado_por
  left join public.usuarios g on g.id = c.revisado_por
  left join lateral (
    select o.id, o.numero, o.estado
      from public.ordenes_trabajo o
     where o.cotizacion_pdf_id = c.id and o.estado <> 'ANULADA'
     limit 1
  ) o on true;

alter view public.v_cotizaciones_pdf set (security_invoker = on);
grant select on public.v_cotizaciones_pdf to authenticated;

-- =============================================================================
-- 5. COMPROBACIONES
-- =============================================================================
do $$
declare
  v_ciegos text;
begin
  if coalesce((select array_to_string(reloptions, ',') from pg_class where oid = 'public.v_cotizaciones_pdf'::regclass), '')
       not similar to '%security_invoker=(on|true)%' then
    raise exception 'v_cotizaciones_pdf corre como su dueño y se salta el RLS';
  end if;

  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.cotizaciones_pdf'::regclass
                    and tgname = 'trg_cotizacion_pdf_con_orden_se_queda') then
    raise exception 'Falta el disparador que guarda la cotización que tuvo orden';
  end if;

  -- Quien puede borrar un PDF tiene que poder ver las cotizaciones: si no, la
  -- subconsulta de la política no las ve y le dejaría borrar uno que sí se usa.
  select string_agg(r.codigo, ', ') into v_ciegos
    from public.roles r
   where exists (select 1 from public.roles_permisos rp
                  where rp.rol_id = r.id and rp.permiso_codigo in ('cotizaciones.revisar', 'cotizaciones.crear'))
     and not exists (select 1 from public.roles_permisos rp
                      where rp.rol_id = r.id and rp.permiso_codigo = 'cotizaciones.ver');
  if v_ciegos is not null then
    raise exception 'Estos roles pueden borrar PDF de cotizaciones pero no ven las cotizaciones: %', v_ciegos;
  end if;
end $$;
