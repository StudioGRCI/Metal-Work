-- =============================================================================
-- GERENCIA COMERCIAL Y GERENCIA DE PRODUCCIÓN
-- -----------------------------------------------------------------------------
-- StudioGRCI, 2026-11-25: «Gerencia comercial con vinculacion de ventas y
-- gerencia de produccion quien valida el avance».
--
-- En el organigrama, Gerencia Comercial (área GCO) tenía solo al Agente de
-- Ventas, y Gerencia de Operaciones (área GOP) se quedó sin puesto cuando se
-- retiraron Jefe de producción y Supervisión general (2026-10-19). Este cambio
-- crea los dos puestos, con la regla de la casa: cada puesto ve solo lo suyo,
-- y Gerencia consulta y aprueba, no registra.
--
-- GERENTE_COMERCIAL — sigue el trabajo de Ventas: los clientes y sus unidades,
--   cada cotización con su precio y el visto de Gerencia General, y las OT que
--   salen de ellas. No registra ni corrige clientes ni cotizaciones (eso es
--   del Agente de Ventas) y no aprueba cotizaciones: eso sigue siendo de
--   Gerencia General (decisión 1 del plan, con el «ok» del 2026-11-25).
--
-- GERENTE_PRODUCCION — valida el avance: da el visto de Gerencia al reporte
--   diario de cada supervisor (`reporte_diario.validar_gerencia`, que sigue
--   teniendo Gerencia General: vale el primero que lo da, decisión 3), y
--   sigue cada código interno por sus etapas, planos y avance
--   (`codigos_internos.seguimiento`, `produccion.ver`), sin costos, precios ni
--   márgenes, que siguen con Gerencia General (decisión 2). Ve además, en
--   lectura, el tablero «Tiempos de entrega» de RR. HH. cuando exista su
--   permiso (`rrhh.tiempos_entrega`, de la migración 20261125100000, que
--   puede entrar antes o después de esta).
--
-- Las dos cuentas son del puesto, como las demás (gerencia@, ventas@…), para
-- que no se pierdan cuando cambia la persona. Nacen sin clave usable: la clave
-- la pone el administrador del sistema en Personal › «Cambiar clave», nunca
-- por el repositorio ni por el chat.
--
-- Idempotente: los puestos y los permisos van con `on conflict`, y la cuenta
-- que ya existe no se toca.
-- =============================================================================

-- 1. Los dos puestos ----------------------------------------------------------
insert into public.roles (codigo, nombre, descripcion, nivel, es_sistema)
values
  ('GERENTE_COMERCIAL', 'Gerencia Comercial',
   'Sigue a Ventas: clientes, unidades, cotizaciones con su precio y sus OT. Consulta, no registra.', 80, true),
  ('GERENTE_PRODUCCION', 'Gerencia de Producción',
   'Valida el avance: da el visto de Gerencia al reporte diario y sigue cada código por sus etapas. Sin costos.', 80, true)
on conflict (codigo) do update
  set nombre = excluded.nombre,
      descripcion = excluded.descripcion;

-- 2. Sus permisos ---------------------------------------------------------------
-- Todos de lectura, salvo el visto del reporte diario. Cada uno ya existe y ya
-- lo tiene otro puesto: ninguna puerta nueva.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo
  from public.roles r
  join public.permisos p on p.codigo = any (case r.codigo
    when 'GERENTE_COMERCIAL' then array[
      'clientes.ver',                    -- clientes y unidades (Agente de Ventas, Gerencia)
      'cotizaciones.ver_pdf_comercial',  -- cada cotización con su precio y su visto (Ventas, Gerencia)
      'ordenes.listar',                  -- la lista de OT (Gerencia, Administración)
      'ordenes.ver'                      -- cada OT (Ventas, Gerencia)
    ]
    when 'GERENTE_PRODUCCION' then array[
      'reporte_diario.ver',              -- todos los reportes diarios (Gerencia, RR. HH.)
      'reporte_diario.validar_gerencia', -- el visto de Gerencia (Gerencia)
      'codigos_internos.seguimiento',    -- cada código por etapas, planos y avance, sin costo
      'produccion.ver'                   -- el avance y sus fotos (Gerencia)
    ]
  end)
 where r.codigo in ('GERENTE_COMERCIAL', 'GERENTE_PRODUCCION')
on conflict do nothing;

-- El tablero de RR. HH. «Tiempos de entrega», en lectura. Su permiso lo crea
-- otra migración: si todavía no está, aquí no se inserta nada, y esa migración
-- se lo da a este puesto cuando entre.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'rrhh.tiempos_entrega'
  from public.roles r
 where r.codigo = 'GERENTE_PRODUCCION'
   and exists (select 1 from public.permisos where codigo = 'rrhh.tiempos_entrega')
on conflict do nothing;

-- 3. Las dos cuentas del puesto ----------------------------------------------
do $$
declare
  v_sede uuid;
  v_c    record;
  v_id   uuid;
begin
  select id into v_sede from public.sedes order by creado_en limit 1;
  if v_sede is null then
    raise exception 'No hay ninguna sede registrada: la ficha de una persona necesita su taller.';
  end if;

  for v_c in
    select * from (values
      ('gerencia.comercial@metalworkperusac.com', 'Gerencia', 'Comercial', 'Gerente comercial', 'GERENTE_COMERCIAL', 'GCO'),
      ('gerencia.produccion@metalworkperusac.com', 'Gerencia', 'de Producción', 'Gerente de producción', 'GERENTE_PRODUCCION', 'GOP')
    ) as t(correo, nombres, apellidos, cargo, rol, area)
  loop
    if exists (select 1 from auth.users where lower(email) = v_c.correo) then
      continue;
    end if;
    if not exists (select 1 from public.areas where codigo = v_c.area) then
      raise exception 'Falta el área % en el organigrama: la cuenta % la necesita.', v_c.area, v_c.correo;
    end if;

    v_id := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
    values (v_id, v_c.correo,
            public.cifrar_clave(gen_random_uuid()::text || gen_random_uuid()::text),
            jsonb_build_object('nombres', v_c.nombres, 'apellidos', v_c.apellidos));
    perform public.completar_cuenta_acceso(v_id);

    insert into public.usuarios (id, nombres, apellidos, correo, cargo, rol_id, sede_id, area_id)
    values (v_id, v_c.nombres, v_c.apellidos, v_c.correo, v_c.cargo,
            (select id from public.roles where codigo = v_c.rol),
            v_sede,
            (select id from public.areas where codigo = v_c.area));
  end loop;
end;
$$;
