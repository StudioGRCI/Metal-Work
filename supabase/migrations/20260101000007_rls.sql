-- =============================================================================
-- 0007 · SEGURIDAD A NIVEL DE FILA
-- -----------------------------------------------------------------------------
-- Toda tabla de public queda con RLS activo. El acceso se decide por los
-- permisos del rol del usuario (public.tiene_permiso), y ADMIN pasa siempre.
--
-- Principios:
--   · nada es visible sin sesión activa: no hay política para el rol anon
--   · el historial no se edita ni se borra desde la aplicación (audit_log,
--     kardex, ot_bitacora): solo se consulta
--   · el operario ve únicamente las órdenes en las que participa
--   · las funciones SECURITY DEFINER del esquema siguen escribiendo el
--     historial aunque el usuario no tenga permiso directo sobre esas tablas
-- =============================================================================

-- -----------------------------------------------------------------------------
-- El usuario del sistema es un usuario de Supabase Auth. La FK se declara aquí
-- y no en el núcleo para que las migraciones puedan probarse contra un Postgres
-- sin el esquema auth completo.
-- -----------------------------------------------------------------------------

do $$
begin
  if to_regclass('auth.users') is not null
     and not exists (
       select 1 from pg_constraint where conname = 'fk_usuarios_auth'
     ) then
    alter table public.usuarios
      add constraint fk_usuarios_auth foreign key (id)
      references auth.users(id) on delete cascade;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Alcance del operario
-- -----------------------------------------------------------------------------

-- Verdadero si el usuario actual puede ver una orden concreta. Los perfiles de
-- oficina ven todas; el operario solo aquellas en las que está asignado o en las
-- que ha registrado horas.
create or replace function public.puede_ver_orden(p_orden_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.es_admin() then true
    when not exists (
      select 1 from public.usuarios u where u.id = public.usuario_actual() and u.es_operario
    ) then public.tiene_permiso('ordenes.ver')
    else exists (
      select 1 from public.ot_personal p
       where p.orden_id = p_orden_id and p.usuario_id = public.usuario_actual()
    ) or exists (
      select 1 from public.parte_detalle d
       where d.orden_id = p_orden_id and d.usuario_id = public.usuario_actual()
    )
  end;
$$;

comment on function public.puede_ver_orden is
  'Decide si el usuario actual puede ver una OT. El operario solo ve las suyas; el resto de perfiles ven todas si tienen el permiso ordenes.ver.';

-- =============================================================================
-- POLÍTICAS GENERADAS
-- Cada tabla declara qué permiso exige para leer y cuál para escribir. Generar
-- las políticas a partir de esta tabla mantiene el criterio uniforme y hace
-- evidente, de un vistazo, quién puede tocar qué.
-- =============================================================================

do $$
declare
  r record;
begin
  for r in
    select * from (values
      -- tabla,                    permiso de lectura,     permiso de escritura
      ('empresa',                  'configuracion.ver',    'configuracion.editar'),
      ('sedes',                    'configuracion.ver',    'configuracion.editar'),
      ('series_documentarias',     'configuracion.ver',    'configuracion.editar'),
      ('tipos_cambio',             'configuracion.ver',    'configuracion.editar'),
      ('etapas_catalogo',          'configuracion.ver',    'configuracion.editar'),
      ('tipos_carroceria',         'configuracion.ver',    'configuracion.editar'),
      ('unidades_medida',          'configuracion.ver',    'configuracion.editar'),
      ('categorias_material',      'configuracion.ver',    'configuracion.editar'),
      ('centros_costo',            'configuracion.ver',    'configuracion.editar'),
      ('tarifas_mano_obra',        'costos.ver',           'configuracion.editar'),

      ('clientes',                 'clientes.ver',         'clientes.editar'),
      ('contactos_cliente',        'clientes.ver',         'clientes.editar'),
      ('unidades',                 'clientes.ver',         'clientes.editar'),

      ('cotizaciones',             'cotizaciones.ver',     'cotizaciones.editar'),
      ('cotizacion_partidas',      'cotizaciones.ver',     'cotizaciones.editar'),

      ('ot_tareas',                'produccion.ver',       'produccion.registrar'),
      ('ot_personal',              'produccion.ver',       'produccion.planificar'),
      ('partes_diarios',           'produccion.ver',       'produccion.registrar'),
      ('parte_detalle',            'produccion.ver',       'produccion.registrar'),

      ('ot_inspecciones',          'calidad.ver',          'calidad.inspeccionar'),
      ('ot_inspeccion_items',      'calidad.ver',          'calidad.inspeccionar'),
      ('ot_entregas',              'ordenes.ver',          'ordenes.entregar'),

      ('almacenes',                'almacen.ver',          'almacen.maestros'),
      ('materiales',               'almacen.ver',          'almacen.maestros'),
      ('lotes_material',           'almacen.ver',          'almacen.movimientos'),
      ('almacen_stock',            'almacen.ver',          'almacen.confirmar'),
      ('movimientos_almacen',      'almacen.ver',          'almacen.movimientos'),
      ('movimiento_detalle',       'almacen.ver',          'almacen.movimientos'),
      ('requerimientos',           'requerimientos.ver',   'requerimientos.crear'),
      ('requerimiento_detalle',    'requerimientos.ver',   'requerimientos.crear'),

      ('proveedores',              'compras.ver',          'compras.crear'),
      ('proveedor_materiales',     'compras.ver',          'compras.crear'),
      ('ordenes_compra',           'compras.ver',          'compras.crear'),
      ('orden_compra_detalle',     'compras.ver',          'compras.crear'),
      ('recepciones',              'compras.ver',          'compras.recibir'),
      ('recepcion_detalle',        'compras.ver',          'compras.recibir'),

      ('ot_presupuesto',           'costos.ver',           'costos.editar'),
      ('servicios_terceros',       'costos.ver',           'costos.editar'),
      ('gastos_indirectos',        'costos.ver',           'costos.editar'),
      ('prorrateo_indirectos',     'costos.ver',           'costos.editar'),
      ('ot_costos_adicionales',    'costos.ver',           'costos.editar')
    ) as t(tabla, permiso_ver, permiso_escribir)
  loop
    -- Puede que una tabla aún no exista si se ejecuta una migración parcial.
    if to_regclass(format('public.%I', r.tabla)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', r.tabla);

    execute format(
      'drop policy if exists %I on public.%I', 'ver_' || r.tabla, r.tabla);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.es_admin() or public.tiene_permiso(%L))',
      'ver_' || r.tabla, r.tabla, r.permiso_ver);

    execute format(
      'drop policy if exists %I on public.%I', 'crear_' || r.tabla, r.tabla);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.es_admin() or public.tiene_permiso(%L))',
      'crear_' || r.tabla, r.tabla, r.permiso_escribir);

    execute format(
      'drop policy if exists %I on public.%I', 'editar_' || r.tabla, r.tabla);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.es_admin() or public.tiene_permiso(%L))
         with check (public.es_admin() or public.tiene_permiso(%L))',
      'editar_' || r.tabla, r.tabla, r.permiso_escribir, r.permiso_escribir);

    -- Borrar es siempre exclusivo de ADMIN: el resto anula, no elimina.
    execute format(
      'drop policy if exists %I on public.%I', 'borrar_' || r.tabla, r.tabla);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.es_admin())',
      'borrar_' || r.tabla, r.tabla);
  end loop;
end;
$$;

-- =============================================================================
-- POLÍTICAS ESPECÍFICAS
-- =============================================================================

-- --- Órdenes de trabajo: el operario solo ve las suyas ------------------------

alter table public.ordenes_trabajo enable row level security;

create policy ver_ordenes_trabajo on public.ordenes_trabajo
  for select to authenticated
  using (public.puede_ver_orden(id));

create policy crear_ordenes_trabajo on public.ordenes_trabajo
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('ordenes.crear'));

-- Editar cubre tanto los datos como los cambios de estado; qué transiciones son
-- válidas lo sigue decidiendo el trigger, no la política.
create policy editar_ordenes_trabajo on public.ordenes_trabajo
  for update to authenticated
  using (
    public.es_admin()
    or public.tiene_permiso('ordenes.editar')
    or public.tiene_permiso('ordenes.cambiar_estado')
    or public.tiene_permiso('ordenes.aprobar')
    or public.tiene_permiso('ordenes.anular')
    or public.tiene_permiso('ordenes.entregar')
  )
  with check (
    public.es_admin()
    or public.tiene_permiso('ordenes.editar')
    or public.tiene_permiso('ordenes.cambiar_estado')
    or public.tiene_permiso('ordenes.aprobar')
    or public.tiene_permiso('ordenes.anular')
    or public.tiene_permiso('ordenes.entregar')
  );

create policy borrar_ordenes_trabajo on public.ordenes_trabajo
  for delete to authenticated
  using (public.es_admin());

-- --- Etapas: se ven con la orden y las edita quien registra producción --------

alter table public.ot_etapas enable row level security;

create policy ver_ot_etapas on public.ot_etapas
  for select to authenticated
  using (public.puede_ver_orden(orden_id));

create policy crear_ot_etapas on public.ot_etapas
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('produccion.planificar'));

create policy editar_ot_etapas on public.ot_etapas
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('produccion.registrar'))
  with check (public.es_admin() or public.tiene_permiso('produccion.registrar'));

create policy borrar_ot_etapas on public.ot_etapas
  for delete to authenticated
  using (public.es_admin());

-- --- Bitácora de la OT: se lee con la orden, se escribe solo por función ------

alter table public.ot_bitacora enable row level security;

create policy ver_ot_bitacora on public.ot_bitacora
  for select to authenticated
  using (public.puede_ver_orden(orden_id));

comment on table public.ot_bitacora is
  'Trazabilidad de la orden. Sin política de INSERT a propósito: solo se escribe a través de public.ot_registrar_evento, que es SECURITY DEFINER. Así ningún usuario puede fabricar historial a mano.';

-- --- Kardex: consulta para quien ve almacén, escritura solo por función -------

alter table public.kardex enable row level security;

create policy ver_kardex on public.kardex
  for select to authenticated
  using (public.es_admin() or public.tiene_permiso('almacen.ver') or public.tiene_permiso('costos.ver'));

comment on table public.kardex is
  'Movimientos valorizados de almacén. Sin política de escritura: solo lo alimentan las funciones de confirmación de movimientos, que son SECURITY DEFINER.';

-- --- Auditoría: la ve quien tiene el permiso, nadie la modifica ---------------

alter table public.audit_log enable row level security;

create policy ver_audit_log on public.audit_log
  for select to authenticated
  using (public.es_admin() or public.tiene_permiso('auditoria.ver'));

-- --- Usuarios, roles y permisos ----------------------------------------------

alter table public.usuarios enable row level security;

-- Todo usuario activo necesita leer la lista de personas para ver responsables,
-- inspectores y operarios en las pantallas; no es información sensible.
create policy ver_usuarios on public.usuarios
  for select to authenticated
  using (public.es_usuario_activo());

create policy crear_usuarios on public.usuarios
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('usuarios.gestionar'));

-- Cada quien puede corregir sus propios datos de contacto; cambiar rol, sede o
-- costo por hora exige el permiso de gestión.
create policy editar_usuarios on public.usuarios
  for update to authenticated
  using (
    public.es_admin()
    or public.tiene_permiso('usuarios.gestionar')
    or id = public.usuario_actual()
  )
  with check (
    public.es_admin()
    or public.tiene_permiso('usuarios.gestionar')
    or id = public.usuario_actual()
  );

create policy borrar_usuarios on public.usuarios
  for delete to authenticated
  using (public.es_admin());

-- Un usuario no debe poder ascenderse a sí mismo cambiando su rol_id.
create or replace function public.fn_usuario_proteger_rol()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.es_admin() or public.tiene_permiso('usuarios.gestionar') then
    return new;
  end if;

  if new.rol_id is distinct from old.rol_id
     or new.activo is distinct from old.activo
     or new.costo_hora is distinct from old.costo_hora
     or new.sede_id is distinct from old.sede_id then
    raise exception 'Solo un administrador puede cambiar el rol, la sede, el costo por hora o el estado de un usuario'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

create trigger trg_usuario_proteger_rol
  before update on public.usuarios
  for each row execute function public.fn_usuario_proteger_rol();

alter table public.roles enable row level security;
alter table public.permisos enable row level security;
alter table public.roles_permisos enable row level security;

-- El catálogo de roles y permisos se lee para pintar la interfaz según el perfil.
create policy ver_roles on public.roles
  for select to authenticated using (public.es_usuario_activo());
create policy ver_permisos on public.permisos
  for select to authenticated using (public.es_usuario_activo());
create policy ver_roles_permisos on public.roles_permisos
  for select to authenticated using (public.es_usuario_activo());

create policy gestionar_roles on public.roles
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());
create policy gestionar_permisos on public.permisos
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());
create policy gestionar_roles_permisos on public.roles_permisos
  for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- =============================================================================
-- PERMISOS DE ROL
-- Con RLS activo el GRANT amplio es seguro: las políticas son las que deciden
-- fila por fila. Se declaran de forma explícita para no depender de los
-- privilegios por defecto del proyecto.
-- =============================================================================

grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- El rol anónimo no tiene nada que hacer aquí: no hay parte pública del sistema.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

-- Las funciones que instalan triggers son de mantenimiento del esquema y no
-- forman parte de la API de la aplicación.
revoke execute on function public.activar_auditoria(text) from authenticated;
revoke execute on function public.activar_timestamps(text) from authenticated;

-- Las vistas se ejecutan con los permisos de quien consulta, de modo que
-- heredan las políticas de las tablas que hay debajo.
do $$
declare v record;
begin
  for v in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('alter view public.%I set (security_invoker = on)', v.relname);
    execute format('grant select on public.%I to authenticated', v.relname);
  end loop;
end;
$$;

-- =============================================================================
-- COMPROBACIÓN: ninguna tabla de public debe quedar sin RLS
-- =============================================================================

do $$
declare v_faltantes text[];
begin
  select coalesce(array_agg(c.relname order by c.relname), '{}')
    into v_faltantes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity;

  if array_length(v_faltantes, 1) is not null then
    raise exception 'Estas tablas quedaron sin RLS: %', array_to_string(v_faltantes, ', ')
      using errcode = 'raise_exception';
  end if;
end;
$$;
