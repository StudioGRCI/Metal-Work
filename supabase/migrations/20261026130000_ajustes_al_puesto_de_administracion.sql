-- =============================================================================
-- AJUSTES AL PUESTO DE ADMINISTRACIÓN
-- -----------------------------------------------------------------------------
-- Lo que DKS decidió el 2026-10-26 al leer los puntos para revisar del manual
-- de Administración:
--
--   1. «Dejalo en ambos puedan»: el tipo de cambio lo registran Contabilidad y
--      Administración. No cambia ningún permiso; cambia cómo se describe.
--   2. «Quitar el botón para su puesto, quitar accesos»: Administración tiene
--      `compras.crear` desde la 20261015162000 solo para hacer la orden de
--      compra de lo que pide en su RQA. Con él podía emitir una OC directa,
--      una OC de un RQ de operación por otra puerta, o una orden de servicio, y
--      mover las de Logística. Desde aquí la base solo le acepta la OC que
--      compra insumos de un RQA y no le deja tocar las órdenes de servicio.
--   3. «Revisar si deben llegarle, no»: los avisos de pago de las OS y de las
--      OC («Pago a cuenta de un servicio: OS-…», «OC pagada: …») se mandaban a
--      todo el que tuviera `compras.crear`, y así le llegaban a Administración.
--      Son de Logística.
--   5. «Dale permiso»: en la orden sin cotización Administración ve «Nuevo
--      cliente», y la base le contestaba «No tienes permiso para registrar
--      clientes». Recibe `clientes.crear`.
--   6. «Corrige»: Diseño envía la evaluación de desempeño y a Administración no
--      le llegaba nada. Ahora le llega un aviso (el globo del menú lo cuenta la
--      aplicación).
--   7. «Corrige»: la OT 2935-2026 decía 0 % y su código interno iba en 40 %.
--      Desde el 15/10 el avance se lleva por código (Diseño marca las etapas,
--      el supervisor reporta por código) y las etapas de la OT ya no las mueve
--      nadie. `avance_de_ordenes` da el avance que la pantalla muestra en cada
--      OT: el de su código interno, el mismo que ve Códigos internos.
--   9. «Los reportes ya están en Supervisión»: Administración deja de aprobar
--      los reportes del taller dentro de la OT (`produccion.aprobar_reportes`)
--      y pasa a aprobar solo los de los trabajos sin orden, como Gerencia
--      (`produccion.aprobar_sin_orden`). La ficha de taller y las etapas pasan
--      a verse desde el código interno; eso es de la aplicación.
--
-- El punto 4 (liberar la salida y la revisión del vehículo) queda como está.
-- Sin DROP ni DELETE: el permiso que sale se cambia por el que entra.
-- Volver a correrla deja lo mismo.
-- =============================================================================

-- 1. El tipo de cambio, de los dos ----------------------------------------------------------
update public.permisos
   set descripcion = 'Registrar y corregir el tipo de cambio del día (lo registran Contabilidad o Administración)'
 where codigo = 'tesoreria.tipo_cambio';

-- 2. Administración compra solo lo de su RQA --------------------------------------------------
-- La administradora: tiene `requerimientos.administracion` y no es ADMIN. Es
-- la misma regla con que `rq_exigir` le niega el RQ de operación.
create or replace function public.compra_solo_su_rqa()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select not public.es_admin() and public.tiene_permiso('requerimientos.administracion');
$$;
comment on function public.compra_solo_su_rqa() is
  'La cuenta de la sesión es la de Administración: compra solo lo de su RQA (no OC directas ni de operación, ni órdenes de servicio).';
revoke all on function public.compra_solo_su_rqa() from public, anon;
grant execute on function public.compra_solo_su_rqa() to authenticated;

-- La OC se mira al cerrar la transacción: la que nace de un RQA se crea primero
-- y sus insumos se le enlazan después, en la misma llamada.
create or replace function public.fn_compra_de_administracion_es_de_su_rqa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_nombre text;
begin
  if not public.compra_solo_su_rqa() then
    return null;
  end if;
  if not exists (select 1 from public.ordenes_compra_materiales where id = new.id) then
    return null;
  end if;
  if exists (select 1
               from public.requerimiento_lineas l
               join public.requerimientos r on r.id = l.requerimiento_id
              where l.orden_compra_id = new.id
                and r.tipo = 'ADMINISTRACION') then
    return null;
  end if;
  v_nombre := public.nombre_de_oc(new.numero, new.referencia);
  if tg_op = 'INSERT' then
    raise exception 'Administración hace solo la orden de compra de su RQA. Las OC directas y las de los requerimientos de operación las emite Logística.'
      using errcode = 'insufficient_privilege';
  end if;
  raise exception 'La % no nace de un RQA: la lleva Logística.', v_nombre
    using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function public.fn_compra_de_administracion_es_de_su_rqa() from public, anon, authenticated;

drop trigger if exists trg_compra_de_administracion_es_de_su_rqa on public.ordenes_compra_materiales;
create constraint trigger trg_compra_de_administracion_es_de_su_rqa
  after insert or update on public.ordenes_compra_materiales
  deferrable initially deferred
  for each row execute function public.fn_compra_de_administracion_es_de_su_rqa();

-- La orden de servicio es de Logística: Administración no la emite ni la mueve.
create or replace function public.fn_servicio_no_es_de_administracion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if public.compra_solo_su_rqa() then
    raise exception 'Las órdenes de servicio las lleva Logística.'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_servicio_no_es_de_administracion() from public, anon, authenticated;

drop trigger if exists trg_servicio_no_es_de_administracion on public.ordenes_servicio;
create trigger trg_servicio_no_es_de_administracion
  before insert or update on public.ordenes_servicio
  for each row execute function public.fn_servicio_no_es_de_administracion();

-- Ni le adjunta documentos.
create or replace function public.puede_adjuntar_documento_servicio()
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select public.es_admin()
      or (public.tiene_permiso('compras.crear') and not public.compra_solo_su_rqa())
      or public.tiene_permiso('tesoreria.pagar_servicios');
$$;

-- 3. Los avisos de compras son de Logística ----------------------------------------------------
-- Los únicos avisos que van a `compras.crear` son los de los pagos de una OS,
-- de una OC y de la boleta de una parte: son de quien compra para el taller.
-- `compras.crear` de Administración es solo para la OC de su RQA, así que no
-- los recibe. Un aviso nuevo que sí deba llegarle va a `requerimientos.administracion`.
create or replace function public.notificar_a_permiso(p_permiso text, p_titulo text, p_cuerpo text, p_ruta text, p_tabla text, p_id uuid, p_excepto uuid default null::uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_filas integer;
begin
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, p_titulo, p_cuerpo, p_ruta, p_tabla, p_id
    from public.usuarios u
    join public.roles r on r.id = u.rol_id
   where u.activo
     and (u.id is distinct from p_excepto)
     and (
       r.codigo = 'ADMIN'
       or (
         exists (
           select 1 from public.roles_permisos rp
            where rp.rol_id = r.id and rp.permiso_codigo = p_permiso
         )
         and not (
           p_permiso = 'compras.crear'
           and exists (
             select 1 from public.roles_permisos rp
              where rp.rol_id = r.id and rp.permiso_codigo = 'requerimientos.administracion'
           )
         )
       )
     );

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

-- 5 y 9. Los permisos del puesto ---------------------------------------------------------------
do $$
declare
  v_administracion uuid := (select id from public.roles where codigo = 'ADMINISTRACION');
begin
  if v_administracion is null then
    raise notice 'No hay puesto ADMINISTRACION: nada que ajustar.';
    return;
  end if;

  insert into public.roles_permisos (rol_id, permiso_codigo)
  values (v_administracion, 'clientes.crear')
  on conflict (rol_id, permiso_codigo) do nothing;

  -- Aprobar los reportes del taller dentro de la OT pasa a aprobar los de los
  -- trabajos sin orden: el permiso se cambia en su fila, sin borrar.
  update public.roles_permisos
     set permiso_codigo = 'produccion.aprobar_sin_orden'
   where rol_id = v_administracion
     and permiso_codigo = 'produccion.aprobar_reportes'
     and not exists (select 1 from public.roles_permisos x
                      where x.rol_id = v_administracion and x.permiso_codigo = 'produccion.aprobar_sin_orden');
  if exists (select 1 from public.roles_permisos
              where rol_id = v_administracion and permiso_codigo = 'produccion.aprobar_reportes') then
    raise exception 'Administración sigue con produccion.aprobar_reportes y ya tenía produccion.aprobar_sin_orden: quítaselo a mano en el SQL Editor.';
  end if;
end;
$$;

-- 5b. Registrar un cliente pide el permiso que exige la pantalla ---------------------------------
-- La pantalla deja registrar clientes, sus unidades y sus contactos con
-- `clientes.crear` (`crearClienteRapido`, `guardarCliente`, la ficha del
-- cliente), y las políticas de alta pedían `clientes.editar`: con solo el
-- primero, el alta caía por el RLS. Ventas tiene los dos y no se notaba. Ahora
-- el alta acepta cualquiera de los dos; corregir sigue pidiendo `clientes.editar`.
drop policy if exists crear_clientes on public.clientes;
create policy crear_clientes on public.clientes for insert to authenticated
  with check ((select public.es_admin()) or (select public.tiene_permiso('clientes.crear')) or (select public.tiene_permiso('clientes.editar')));

drop policy if exists crear_unidades on public.unidades;
create policy crear_unidades on public.unidades for insert to authenticated
  with check ((select public.es_admin()) or (select public.tiene_permiso('clientes.crear')) or (select public.tiene_permiso('clientes.editar')));

drop policy if exists crear_contactos_cliente on public.contactos_cliente;
create policy crear_contactos_cliente on public.contactos_cliente for insert to authenticated
  with check ((select public.es_admin()) or (select public.tiene_permiso('clientes.crear')) or (select public.tiene_permiso('clientes.editar')));

-- 6. La evaluación enviada le avisa a Administración ------------------------------------------
create or replace function public.fn_evaluacion_diseno_avisa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.estado = 'ENVIADA' and (tg_op = 'INSERT' or old.estado is distinct from 'ENVIADA') then
    perform public.notificar_a_permiso(
      'administracion.recibir_evaluacion',
      'Evaluación de desempeño por recibir: ' || new.evaluado_nombre,
      new.puesto || ' · ' || new.area_servicio || ' · ' || to_char(new.fecha_evaluacion, 'DD/MM/YYYY'),
      '/diseno/evaluaciones/' || new.id,
      'diseno_evaluaciones', new.id, public.usuario_actual());
  end if;
  return null;
end;
$$;
revoke all on function public.fn_evaluacion_diseno_avisa() from public, anon, authenticated;

drop trigger if exists trg_evaluacion_diseno_avisa on public.diseno_evaluaciones;
create trigger trg_evaluacion_diseno_avisa
  after insert or update on public.diseno_evaluaciones
  for each row execute function public.fn_evaluacion_diseno_avisa();

-- 7. El avance de la OT es el de su código interno ---------------------------------------------
-- La OT que nació de una cotización es la de su código: su avance es el del
-- código, calculado igual que en Códigos internos (`codigos_internos_avance`).
-- La orden sin cotización (una garantía, una reparación sobre una unidad que
-- ya tiene código) y la OT sin código siguen con el suyo. Quien no ve la OT no
-- recibe nada.
create or replace function public.avance_de_ordenes(p_ordenes uuid[])
returns table (orden_id uuid, avance numeric, codigo_interno text, del_codigo boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if p_ordenes is null or cardinality(p_ordenes) = 0 then
    return;
  end if;
  if cardinality(p_ordenes) > 500 then
    raise exception 'Se pide el avance de hasta 500 órdenes a la vez.' using errcode = 'check_violation';
  end if;
  if not (public.es_admin() or public.tiene_permiso('ordenes.ver')) then
    return;
  end if;

  return query
  with ots as (
    select o.id, o.avance_porcentaje,
           case when o.cotizacion_pdf_id is not null then nullif(btrim(u.codigo_interno), '') end as codigo
      from public.ordenes_trabajo o
      left join public.unidades u on u.id = o.unidad_id
     where o.id = any (p_ordenes)
  ), codigos as (
    select c.codigo, k.de_planos, k.peso, k.resto
      from (select distinct codigo from ots where codigo is not null) c
      cross join lateral public.codigo_interno_avance_calculado(c.codigo) k
     where k.codigo = c.codigo
  )
  select ots.id,
         coalesce(round(k.de_planos + (100 - k.peso) / 100 * k.resto, 0), ots.avance_porcentaje),
         ots.codigo,
         k.codigo is not null
    from ots
    left join codigos k on k.codigo = ots.codigo;
end;
$$;
comment on function public.avance_de_ordenes(uuid[]) is
  'El avance que se muestra en cada OT: el de su código interno si nació de una cotización (el mismo de codigos_internos_avance), si no el de sus etapas.';
revoke all on function public.avance_de_ordenes(uuid[]) from public, anon;
grant execute on function public.avance_de_ordenes(uuid[]) to authenticated;
