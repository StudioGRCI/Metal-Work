-- =============================================================================
-- LO QUE QUEDABA ABIERTO
-- -----------------------------------------------------------------------------
-- Las consultas de `db/auditoria/`, escritas hoy para no volver a revisar esto
-- de memoria, encontraron tres cosas en su primera pasada. Ninguna se estaba
-- explotando; las tres estaban a una línea de descuido de poder explotarse.
-- =============================================================================

-- =============================================================================
-- 1. QUIEN NO ENTRÓ NO TIENE NADA QUE HACER EN ESTAS TABLAS
-- -----------------------------------------------------------------------------
-- 41 de las 122 tablas y vistas de `public` tenían concedido TODO —leer, escribir,
-- borrar y hasta vaciar— al rol anónimo, el de quien no ha iniciado sesión. No
-- había fuga: todas las políticas del proyecto son `to authenticated`, así que
-- la seguridad por fila lo frenaba igual. Pero el permiso estaba dado, y hacen
-- falta las dos vallas: el día que una tabla nazca sin RLS, o que alguien
-- escriba una política sin `to authenticated`, esa tabla queda pública en
-- internet. El repositorio lo es, y la clave anónima viaja al navegador.
--
-- Viene de fábrica: Supabase deja un `alter default privileges … to anon`, así
-- que toda tabla nueva nacía así. Se quita lo dado y se quita también la regla
-- que lo daba, para que la próxima tabla no lo herede.
-- =============================================================================
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all routines  in schema public from anon;

alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on routines  from anon;

-- El rol `authenticated` conserva lo suyo: sobre él sí actúan las políticas.
-- `service_role` y `postgres` tampoco se tocan.

-- =============================================================================
-- 2. UNA FOTO NO SE CAMBIA DE ORDEN
-- -----------------------------------------------------------------------------
-- La política de edición de las fotos de avance comprobaba quién entra (`using`)
-- pero no qué deja escrito (`with check = true`). Con eso, quien puede editar
-- una foto podía moverla al avance de otra orden —incluso de una que no ve—, y
-- la prueba fotográfica del taller quedaba colgando de la orden equivocada.
-- El `with check` pasa a decir lo mismo que el `using`, que es lo que dice el
-- resto de las políticas del proyecto.
-- =============================================================================
drop policy if exists editar_ot_avance_fotos on public.ot_avance_fotos;
create policy editar_ot_avance_fotos on public.ot_avance_fotos
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('produccion.planificar'))
  with check (public.es_admin() or public.tiene_permiso('produccion.planificar'));

-- =============================================================================
-- 3. LA LÍNEA DE TIEMPO DE LA ORDEN NO SE VACÍA POR EL NOMBRE DE UN CATÁLOGO
-- -----------------------------------------------------------------------------
-- Es la misma trampa que la 077 arregló con `clientes`, una vuelta más allá:
-- `v_ot_timeline` cruzaba por dentro con `almacenes` y con `tipos_documento`
-- solo para poner su nombre, y esos catálogos exigen `almacen.ver` y
-- `documentos.ver`. Quien no los tiene no perdía el nombre: perdía el
-- acontecimiento entero. Calidad miraba la historia de una orden y no veía que
-- se le había entregado material.
--
-- El movimiento y el documento siguen protegidos por su propia política, que es
-- donde tiene que estar la puerta. Aquí solo se deja de esconder la fila por no
-- poder leer una etiqueta.
-- =============================================================================
do $$
declare v_def text; v_nuevo text;
begin
  v_def := pg_get_viewdef('public.v_ot_timeline'::regclass, true);
  v_nuevo := regexp_replace(v_def, '(?<!LEFT )JOIN tipos_documento ', 'LEFT JOIN tipos_documento ', 'g');
  v_nuevo := regexp_replace(v_nuevo, '(?<!LEFT )JOIN almacenes ',     'LEFT JOIN almacenes ',     'g');

  if v_nuevo is distinct from v_def then
    execute format('create or replace view public.v_ot_timeline with (security_invoker = true) as %s', v_nuevo);
    raise notice 'v_ot_timeline: el catálogo ya no esconde el acontecimiento';
  end if;
end $$;

-- =============================================================================
-- Comprobación: que no quede nada concedido al rol anónimo.
-- =============================================================================
do $$
declare v_cuantas int;
begin
  select count(*) into v_cuantas
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon';

  if v_cuantas > 0 then
    raise exception 'Quedan % permisos concedidos a quien no ha entrado', v_cuantas;
  end if;
end $$;
