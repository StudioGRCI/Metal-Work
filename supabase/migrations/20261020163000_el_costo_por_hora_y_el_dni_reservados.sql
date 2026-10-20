-- =============================================================================
-- EL COSTO POR HORA Y EL DNI, RESERVADOS
-- -----------------------------------------------------------------------------
-- La tabla `usuarios` la lee toda cuenta activa (`ver_usuarios`), y tiene que
-- ser así: el nombre de quien reportó, aprobó o firmó sale en todas las
-- pantallas, y `puesto(usuarios)` recibe la fila entera. Pero en esa misma
-- fila vivían el costo por hora y el DNI de cada persona: la pantalla de
-- Personal los mostraba solo a quien administra el personal, y cualquier
-- cuenta podía pedirlos directo a la base. Cerrarlos por columna rompe la
-- lista de OT (se probó el 2026-10-20 y se deshizo; skill `esquema`).
--
-- DKS decidió (2026-10-20) moverlos a una tabla aparte que solo leen
-- Recursos Humanos y quien administra el personal. Esta migración:
--
--   * crea `usuario_datos_reservados` (una fila por persona) con su RLS;
--   * copia ahí el costo por hora y el DNI de cada persona que los tenga, y
--     los deja vacíos en `usuarios` (costo 0, DNI nulo);
--   * desde ahora, lo que se escriba en esas dos columnas de `usuarios` (el
--     alta de personal, una pantalla vieja todavía abierta) se pasa solo a la
--     tabla reservada y la columna queda vacía: el dato no vuelve a quedar a
--     la vista aunque alguien lo escriba en el sitio de antes.
--
-- Las columnas se quedan, vacías, para que una pantalla de la versión anterior
-- no se caiga mientras se publica la nueva; se pueden retirar más adelante.
--
-- El costo de la mano de obra no sale de aquí: el tareo y la planilla diaria
-- toman el costo de `trabajadores` (Recursos Humanos). Este costo por hora es
-- el de la ficha de Personal.
--
-- El historial de la auditoría guarda las filas de `usuarios` tal como
-- estaban, con su costo y su DNI (14 de 54 en producción al 2026-10-20). No se
-- reescribe, porque es evidencia: las filas que llevan alguno de los dos dejan
-- de verse con `auditoria.ver` solo y piden lo mismo que la tabla reservada.
-- La tabla reservada lleva su propia auditoría por la misma razón, cerrada con
-- ese mismo permiso: así un cambio de costo deja rastro sin que Gerencia lo lea.
-- =============================================================================

create table if not exists public.usuario_datos_reservados (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null unique references public.usuarios(id) on delete cascade,
  documento      text,
  costo_hora     public.monto not null default 0,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint ck_usuario_reservado_costo check (costo_hora >= 0)
);

comment on table public.usuario_datos_reservados is
  'El DNI y el costo por hora de cada persona, fuera de `usuarios` porque esa tabla la lee toda cuenta activa. La leen Recursos Humanos (rrhh.personal) y quien administra el personal (usuarios.gestionar); la escribe quien administra el personal.';

alter table public.usuario_datos_reservados enable row level security;

drop policy if exists ver_usuario_datos_reservados on public.usuario_datos_reservados;
create policy ver_usuario_datos_reservados on public.usuario_datos_reservados
  for select to authenticated
  using (public.es_admin() or public.tiene_permiso('usuarios.gestionar') or public.tiene_permiso('rrhh.personal'));

drop policy if exists crear_usuario_datos_reservados on public.usuario_datos_reservados;
create policy crear_usuario_datos_reservados on public.usuario_datos_reservados
  for insert to authenticated
  with check (public.es_admin() or public.tiene_permiso('usuarios.gestionar'));

drop policy if exists editar_usuario_datos_reservados on public.usuario_datos_reservados;
create policy editar_usuario_datos_reservados on public.usuario_datos_reservados
  for update to authenticated
  using (public.es_admin() or public.tiene_permiso('usuarios.gestionar'))
  with check (public.es_admin() or public.tiene_permiso('usuarios.gestionar'));

-- No se borra por la API: se va con la persona (on delete cascade).
drop policy if exists borrar_usuario_datos_reservados on public.usuario_datos_reservados;

revoke all on public.usuario_datos_reservados from public, anon;
grant select, insert, update on public.usuario_datos_reservados to authenticated;

select public.activar_timestamps('usuario_datos_reservados');
select public.activar_auditoria('usuario_datos_reservados');
select public.activar_registro_de_prueba('usuario_datos_reservados');

-- La copia en la auditoría pide lo mismo que la tabla.
alter policy ver_audit_log on public.audit_log using (
  public.es_admin() or (
    public.tiene_permiso('auditoria.ver')
    and (tabla <> all (array['cajas', 'movimientos_caja', 'cierres_caja'])
         or public.tiene_permiso('tesoreria.caja'))
    and (tabla <> all (array['trabajador_remuneraciones', 'trabajador_costos', 'tareos',
                             'trabajador_cuentas'])
         or public.tiene_permiso('rrhh.personal'))
    and (tabla <> 'usuario_datos_reservados'
         or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('usuarios.gestionar'))
    -- La auditoría de `usuarios` de antes de la mudanza copió la fila entera,
    -- con el DNI y el costo. Esas filas no se reescriben (son evidencia): las
    -- que llevan alguno de los dos se ven solo con el mismo permiso que la
    -- tabla reservada. Las demás, y todas las de después, siguen a la vista.
    and (tabla <> 'usuarios'
         or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('usuarios.gestionar')
         or (nullif(datos_antes ->> 'documento', '') is null
             and nullif(datos_despues ->> 'documento', '') is null
             and coalesce((datos_antes ->> 'costo_hora')::numeric, 0) = 0
             and coalesce((datos_despues ->> 'costo_hora')::numeric, 0) = 0))
    and (tabla <> all (array['planillas', 'planilla_personas', 'planilla_distribuciones'])
         or public.tiene_permiso('rrhh.ver_planillas'))
    and (tabla <> all (array['cotizaciones_pdf', 'cotizaciones_pdf_versiones', 'cotizaciones_pdf_igv',
                             'ot_presupuestos', 'ot_ventas_anteriores'])
         or public.tiene_permiso('cotizaciones.ver_pdf_comercial'))
    -- Cada tabla, con lo mismo que pide su política de lectura.
    and (tabla <> all (array['facturas_venta', 'cobros_factura_venta'])
         or public.tiene_permiso('contabilidad.facturar') or public.tiene_permiso('cotizaciones.ver_aprobadas')
         or public.tiene_permiso('tesoreria.ver_documentos'))
    and (tabla <> 'cuentas_cobrar_ot'
         or public.tiene_permiso('tesoreria.ver_documentos') or public.tiene_permiso('adquisiciones.ver'))
    and (tabla <> 'proveedor_cuentas' or public.tiene_permiso('proveedores.ver_cuentas'))
    and (tabla <> 'subcontratistas' or public.puede_ver_subcontratos())
    and (tabla <> all (array['planilla_diaria_personas', 'planilla_diaria_detalle'])
         or public.puede_ver_planilla_diaria())
    and (tabla <> 'trabajadores' or public.puede_ver_trabajadores())
  )
);

-- ------------------------------------------------- lo de `usuarios` se pasa
-- Corre después de `trg_usuario_proteger_rol` (orden alfabético): quien no
-- administra el personal sigue sin poder cambiarse su costo ni su DNI, porque
-- ese disparador lo rechaza antes de que este lo mueva.
create or replace function public.fn_usuario_reservar_datos()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare
  v_documento text := nullif(btrim(coalesce(new.documento, '')), '');
  v_costo numeric := coalesce(new.costo_hora, 0);
  v_trae_documento boolean;
  v_trae_costo boolean;
begin
  if tg_op = 'INSERT' then
    v_trae_documento := v_documento is not null;
    v_trae_costo := v_costo <> 0;
  else
    v_trae_documento := new.documento is distinct from old.documento and v_documento is not null;
    v_trae_costo := new.costo_hora is distinct from old.costo_hora and v_costo <> 0;
  end if;

  if v_trae_documento or v_trae_costo then
    insert into public.usuario_datos_reservados (usuario_id, documento, costo_hora)
    values (new.id, case when v_trae_documento then v_documento end, case when v_trae_costo then v_costo else 0 end)
    on conflict (usuario_id) do update
      set documento  = case when v_trae_documento then excluded.documento else usuario_datos_reservados.documento end,
          costo_hora = case when v_trae_costo then excluded.costo_hora else usuario_datos_reservados.costo_hora end;
  end if;

  new.documento := null;
  new.costo_hora := 0;
  return new;
end;
$$;
revoke all on function public.fn_usuario_reservar_datos() from public, anon, authenticated;

-- En el alta la fila reservada no puede ir antes que la de `usuarios` (la
-- llave): el BEFORE INSERT vacía las columnas y guarda lo que traían en la
-- transacción, y el AFTER INSERT lo escribe ya con la persona creada.
create or replace function public.fn_usuario_reservar_datos_alta()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare
  v_documento text := nullif(btrim(coalesce(new.documento, '')), '');
  v_costo numeric := coalesce(new.costo_hora, 0);
  v_guardado jsonb;
begin
  if tg_when = 'BEFORE' then
    if v_documento is not null or v_costo <> 0 then
      perform set_config('mw.reservado_' || replace(new.id::text, '-', ''),
                         jsonb_build_object('documento', v_documento, 'costo_hora', v_costo)::text, true);
    end if;
    new.documento := null;
    new.costo_hora := 0;
    return new;
  end if;

  v_guardado := nullif(current_setting('mw.reservado_' || replace(new.id::text, '-', ''), true), '')::jsonb;
  if v_guardado is not null then
    insert into public.usuario_datos_reservados (usuario_id, documento, costo_hora)
    values (new.id, v_guardado->>'documento', (v_guardado->>'costo_hora')::numeric)
    on conflict (usuario_id) do update
      set documento = excluded.documento, costo_hora = excluded.costo_hora;
    perform set_config('mw.reservado_' || replace(new.id::text, '-', ''), '', true);
  end if;
  return null;
end;
$$;
revoke all on function public.fn_usuario_reservar_datos_alta() from public, anon, authenticated;

create or replace trigger trg_usuario_reservar_datos
  before update of documento, costo_hora on public.usuarios
  for each row execute function public.fn_usuario_reservar_datos();

create or replace trigger trg_usuario_reservar_datos_alta
  before insert on public.usuarios
  for each row execute function public.fn_usuario_reservar_datos_alta();

create or replace trigger trg_usuario_reservar_datos_alta_despues
  after insert on public.usuarios
  for each row execute function public.fn_usuario_reservar_datos_alta();

-- ------------------------------------------------------------ la mudanza
insert into public.usuario_datos_reservados (usuario_id, documento, costo_hora)
select u.id, nullif(btrim(u.documento), ''), coalesce(u.costo_hora, 0)
  from public.usuarios u
 where nullif(btrim(coalesce(u.documento, '')), '') is not null or coalesce(u.costo_hora, 0) <> 0
on conflict (usuario_id) do nothing;

-- Vaciar no pasa por la protección de `usuarios` (la migración no tiene sesión
-- y la rechazaría) ni por la auditoría (dejaría otra copia del costo y del DNI
-- en `audit_log`): se apagan solo esos dos disparadores, solo para esto.
alter table public.usuarios disable trigger trg_usuario_proteger_rol;
alter table public.usuarios disable trigger trg_auditoria;

update public.usuarios
   set documento = null, costo_hora = 0
 where documento is not null or costo_hora <> 0;

alter table public.usuarios enable trigger trg_usuario_proteger_rol;
alter table public.usuarios enable trigger trg_auditoria;
