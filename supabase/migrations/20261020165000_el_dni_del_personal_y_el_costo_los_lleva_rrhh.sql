-- =============================================================================
-- EL DNI DEL PERSONAL, SOLO PARA RECURSOS HUMANOS; EL COSTO Y EL DNI DE LAS
-- CUENTAS LOS CAMBIA RECURSOS HUMANOS
-- -----------------------------------------------------------------------------
-- DKS decidió el 2026-10-20:
--
--   «¿El DNI de la ficha de trabajadores también se esconde? Hoy lo ven
--    Gerencia y Administración, y Portería en el marcador.» — Sí, y Portería
--    busca por DNI sin verlo: «realiza lo que recomiendas para que le sea más
--    fácil a portería».
--
--   «Quien realiza el costeo y ve el personal y hace ediciones o cambios debe
--    ser RR. HH., no Administración; en todo caso el administrador solo
--    visualizaría.»
--
-- Lo primero. `trabajadores` la leen Gerencia y Administración (consultan la
-- asistencia y las tardanzas) y la portería (marca la asistencia), y con la
-- fila iba el DNI de cada persona. La tabla no se parte: el DNI es único, lo
-- escribe una función de RR. HH. y nada la recibe entera desde la API, así que
-- se cierra por columna. Toda cuenta sigue leyendo nombre, cargo, área y
-- horario; el DNI deja de salir por la API. Quien lo necesita lo lee por una
-- función que pide el permiso:
--
--   * RR. HH. (y el administrador), con `rrhh_dni_de_trabajadores()`, para su
--     ficha;
--   * la portería escribe los 8 dígitos y `asistencia_buscar_por_dni()` le
--     devuelve a la persona, sin mostrarle el número de nadie;
--   * las tardanzas del mes lo traen solo para RR. HH.;
--   * la copia de la ficha en la auditoría, con el mismo permiso que el DNI.
--
-- Una función que recibiera la fila entera (`%rowtype`, `select *`) caería con
-- el cierre por columna (skill `esquema`): la única que lo hace,
-- `reporte_diario_agregar_persona`, corre siempre dentro de una función del
-- sistema y no con los permisos de quien llama; se reescribe igual con las
-- columnas a la vista para que no dependa de eso.
--
-- Lo segundo. El DNI y el costo por hora de cada cuenta se mudaron a
-- `usuario_datos_reservados` en la migración 20261020163000, y ahí los escribía
-- el administrador. Desde ahora los cambia solo RR. HH.; el administrador y
-- quien administra el personal los siguen viendo.
-- =============================================================================

-- ------------------------------------------------------------ 1. por columna
revoke select on public.trabajadores from authenticated;
grant select (id, nombres, apellidos, cargo, area_id, hora_entrada, hora_salida, activo,
              creado_por, creado_en, actualizado_en, fecha_ingreso, fecha_baja)
  on public.trabajadores to authenticated;

comment on column public.trabajadores.dni is
  'Fuera del permiso de lectura por columna (migración 20261020165000): lo leen RR. HH. por rrhh_dni_de_trabajadores() y la portería busca por él con asistencia_buscar_por_dni(), sin verlo.';

-- ----------------------------------------------- 2. el DNI, para RR. HH.
create or replace function public.rrhh_dni_de_trabajadores()
returns table (trabajador_id uuid, dni text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('rrhh.personal')) then
    raise exception 'El DNI del personal lo ve Recursos Humanos.' using errcode = 'insufficient_privilege';
  end if;
  return query select t.id, t.dni from public.trabajadores t;
end;
$$;
revoke all on function public.rrhh_dni_de_trabajadores() from public, anon;
grant execute on function public.rrhh_dni_de_trabajadores() to authenticated;

-- ------------------------------------- 3. la portería busca sin ver el número
-- Solo coincidencia exacta de los 8 dígitos y solo personal activo: con un
-- pedazo del número no se puede ir adivinando el de los demás.
create or replace function public.asistencia_buscar_por_dni(p_dni text)
returns uuid
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_dni text := regexp_replace(coalesce(p_dni, ''), '\s', '', 'g');
  v_id  uuid;
begin
  if not (public.es_admin() or public.tiene_permiso('asistencia.marcar') or public.tiene_permiso('rrhh.personal')) then
    raise exception 'La búsqueda por DNI es de la portería y de Recursos Humanos.' using errcode = 'insufficient_privilege';
  end if;
  if v_dni !~ '^[0-9]{8}$' then
    raise exception 'Escribe los 8 dígitos del DNI.' using errcode = 'check_violation';
  end if;
  select t.id into v_id from public.trabajadores t where t.dni = v_dni and t.activo;
  return v_id;
end;
$$;
revoke all on function public.asistencia_buscar_por_dni(text) from public, anon;
grant execute on function public.asistencia_buscar_por_dni(text) to authenticated;

-- ------------------------------------------ 4. las tardanzas, sin el DNI
-- Igual que en 20261015100000, salvo el DNI: Gerencia y Administración ven las
-- veces y el porcentaje; RR. HH. además el DNI, la remuneración y el monto.
create or replace function public.rrhh_tardanzas_del_mes(p_mes date)
returns table (trabajador_id uuid, nombres text, apellidos text, dni text, cargo text, activo boolean,
               dias_con_ingreso integer, tardanzas integer, minutos integer, grupos integer,
               porcentaje numeric, remuneracion_mensual numeric, descuento numeric)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_ve_sueldo boolean := public.es_admin() or public.tiene_permiso('rrhh.personal') or public.tiene_permiso('planilla_diaria.preparar');
  v_ve_dni    boolean := public.es_admin() or public.tiene_permiso('rrhh.personal');
  v_por       int;
  v_pct       numeric;
  v_desde     date;
begin
  if not (v_ve_sueldo or public.tiene_permiso('asistencia.ver')) then
    raise exception 'No tiene permiso para consultar las tardanzas.' using errcode = 'insufficient_privilege';
  end if;
  if p_mes is null then
    raise exception 'Elige el mes.' using errcode = 'check_violation';
  end if;
  v_desde := date_trunc('month', p_mes)::date;
  select greatest(coalesce(g.tardanzas_por_descuento, 3), 1), coalesce(g.porcentaje_descuento, 5)
    into v_por, v_pct
    from public.rrhh_regla_tardanza g where g.id;
  v_por := coalesce(v_por, 3);
  v_pct := coalesce(v_pct, 5);

  return query
    with m as (
      select a.trabajador_id as tid, count(*)::int as dias,
             (count(*) filter (where a.es_tardanza))::int as veces,
             coalesce(sum(a.tardanza_minutos) filter (where a.es_tardanza), 0)::int as mins
        from public.asistencias a
       where a.tipo = 'INGRESO' and a.anulado_en is null
         and a.fecha >= v_desde and a.fecha < (v_desde + interval '1 month')::date
       group by a.trabajador_id
    ), c as (
      select t.id as tid, t.nombres, t.apellidos, t.dni, t.cargo, t.activo,
             coalesce(m.dias, 0) as dias, coalesce(m.veces, 0) as veces, coalesce(m.mins, 0) as mins,
             coalesce(m.veces, 0) / v_por as grp,
             r.remuneracion_mensual as rem
        from public.trabajadores t
        left join m on m.tid = t.id
        left join public.trabajador_remuneraciones r on r.trabajador_id = t.id
       where t.activo or m.tid is not null
    )
    select c.tid, c.nombres, c.apellidos, case when v_ve_dni then c.dni end, c.cargo, c.activo, c.dias, c.veces, c.mins, c.grp,
           least(c.grp * v_pct, 100)::numeric,
           case when v_ve_sueldo then c.rem end,
           case when v_ve_sueldo and c.rem is not null then round(c.rem * least(c.grp * v_pct, 100) / 100, 2) end
      from c
     order by c.grp desc, c.veces desc, c.apellidos, c.nombres;
end;
$$;
revoke all on function public.rrhh_tardanzas_del_mes(date) from public, anon;
grant execute on function public.rrhh_tardanzas_del_mes(date) to authenticated;

-- -------------------------- 5. el reporte diario, con las columnas a la vista
create or replace function public.reporte_diario_agregar_persona(
  p_reporte public.reportes_diarios, p_trabajo_id uuid, p_labor text, p_persona jsonb
) returns void language plpgsql set search_path to 'public' as $$
declare
  v_id       uuid;
  v_nombres  text;
  v_apellidos text;
  v_cargo    text;
  v_activo   boolean;
  v_nombre   text;
  v_horas    numeric;
  v_ya       numeric;
  v_costo    numeric(10, 2);
  v_hora     numeric(10, 4);
  v_linea    uuid;
begin
  begin
    v_id := (p_persona->>'trabajador_id')::uuid;
    v_horas := round((p_persona->>'horas')::numeric, 2);
  exception when others then
    raise exception 'Revisa el personal: cada persona va con sus horas.' using errcode = 'check_violation';
  end;
  select t.nombres, t.apellidos, t.cargo, t.activo into v_nombres, v_apellidos, v_cargo, v_activo
    from public.trabajadores t where t.id = v_id;
  if not found then
    raise exception 'Elige al personal de la lista de Recursos Humanos.' using errcode = 'check_violation';
  end if;
  v_nombre := v_nombres || ' ' || v_apellidos;
  if not v_activo then
    raise exception '% ya no está en el personal activo.', v_nombre using errcode = 'check_violation';
  end if;
  if v_horas is null or v_horas < 0.25 or v_horas > 16 then
    raise exception 'Las horas de % van de 0,25 a 16.', v_nombre using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.reporte_diario_personal
              where reporte_id = p_reporte.id and trabajador_id = v_id and trabajo_id is not distinct from p_trabajo_id) then
    raise exception '% está dos veces en el mismo %.', v_nombre,
      case when p_trabajo_id is null then 'personal general' else 'trabajo' end using errcode = 'check_violation';
  end if;

  -- El mismo candado que el tareo a mano: las dos cosas suman al tope del día.
  perform pg_advisory_xact_lock(hashtextextended('tareo:' || v_id::text, 0));
  v_ya := public.rrhh_horas_del_dia(v_id, p_reporte.fecha);
  if v_ya + v_horas > 16 then
    raise exception '% ya tiene % h el %: con estas pasaría de 16 horas en el día.',
      v_nombre, rtrim(rtrim(to_char(v_ya, 'FM990.00'), '0'), '.'), to_char(p_reporte.fecha, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;

  insert into public.reporte_diario_personal (reporte_id, trabajo_id, trabajador_id, nombre, cargo, fecha, horas)
  values (p_reporte.id, p_trabajo_id, v_id, v_nombre, v_cargo, p_reporte.fecha, v_horas)
  returning id into v_linea;

  -- Sin costo mensual la línea espera: entra al tareo cuando RR. HH. lo ponga.
  select costo_mensual into v_costo from public.trabajador_costos where trabajador_id = v_id;
  if v_costo is not null then
    v_hora := round(v_costo / 240, 4);
    insert into public.tareos (trabajador_id, fecha, codigo_interno, horas, labor, costo_hora, costo, registrado_por, reporte_linea_id)
    values (v_id, p_reporte.fecha, p_reporte.codigo_interno, v_horas, left(p_labor, 200), v_hora, round(v_horas * v_hora, 2),
            p_reporte.registrado_por, v_linea);
  end if;
end;
$$;
revoke all on function public.reporte_diario_agregar_persona(public.reportes_diarios, uuid, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------- 6. la auditoría de la ficha
-- Igual que en 20261020163000, salvo `trabajadores`: su copia lleva el DNI y
-- se ve con el mismo permiso que él, no con el de consultar la asistencia.
alter policy ver_audit_log on public.audit_log using (
  public.es_admin() or (
    public.tiene_permiso('auditoria.ver')
    and (tabla <> all (array['cajas', 'movimientos_caja', 'cierres_caja'])
         or public.tiene_permiso('tesoreria.caja'))
    and (tabla <> all (array['trabajador_remuneraciones', 'trabajador_costos', 'tareos',
                             'trabajador_cuentas', 'trabajadores'])
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
  )
);

-- ------------------- 7. el costo y el DNI de las cuentas los cambia RR. HH.
-- El administrador los ve (la lectura no cambia) pero ya no los escribe: ni
-- en la tabla reservada ni por el camino viejo de `usuarios`, que los pasaba
-- a ella.
drop policy if exists crear_usuario_datos_reservados on public.usuario_datos_reservados;
create policy crear_usuario_datos_reservados on public.usuario_datos_reservados
  for insert to authenticated
  with check (public.tiene_permiso('rrhh.personal'));

drop policy if exists editar_usuario_datos_reservados on public.usuario_datos_reservados;
create policy editar_usuario_datos_reservados on public.usuario_datos_reservados
  for update to authenticated
  using (public.tiene_permiso('rrhh.personal'))
  with check (public.tiene_permiso('rrhh.personal'));

comment on table public.usuario_datos_reservados is
  'El DNI y el costo por hora de cada cuenta, fuera de `usuarios` porque esa tabla la lee toda cuenta activa. Los leen Recursos Humanos (rrhh.personal), el administrador y quien administra el personal (usuarios.gestionar); los cambia solo Recursos Humanos (migración 20261020165000).';

-- Sin sesión (una migración, los datos de demostración) no hay a quién
-- preguntarle: pasa como antes.
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

  if (v_trae_documento or v_trae_costo)
     and public.usuario_actual() is not null and not public.tiene_permiso('rrhh.personal') then
    raise exception 'El DNI y el costo por hora de una cuenta los cambia Recursos Humanos.'
      using errcode = 'insufficient_privilege';
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
      if public.usuario_actual() is not null and not public.tiene_permiso('rrhh.personal') then
        raise exception 'El DNI y el costo por hora de una cuenta los pone Recursos Humanos: da de alta la cuenta sin ellos.'
          using errcode = 'insufficient_privilege';
      end if;
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
