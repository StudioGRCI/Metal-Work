-- Las cuentas de Mantenimiento y de SSOMA
--
-- Los puestos de Mantenimiento (padrón de equipos, plan 16) y de SSOMA (reporte
-- de incidentes, plan 15) entraron con sus permisos, pero sin ninguna cuenta: las
-- pantallas de esos puestos no las podía abrir nadie, ni para revisarlas como las
-- verá la persona que hace ese trabajo. Probar como Administrador no prueba nada,
-- porque entra por es_admin() y nunca toca el permiso.
--
-- Se crea una cuenta por puesto, en su área del organigrama (MNT y SST). Nacen
-- con una clave al azar que nadie conoce: la clave que se entrega se pone después,
-- fuera de este repositorio, que es público, y la cambia el administrador en
-- Personal › «Cambiar clave».
--
-- Idempotente: si la cuenta ya existe, no se toca.

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
      ('mantenimiento@metalworkperusac.com', 'Encargado', 'de Mantenimiento', 'Encargado de mantenimiento', 'MANTENIMIENTO', 'MNT'),
      ('ssoma@metalworkperusac.com',         'Encargado', 'de SSOMA',         'Encargado de SSOMA',         'SSOMA',         'SST')
    ) as t(correo, nombres, apellidos, cargo, rol, area)
  loop
    if exists (select 1 from auth.users where lower(email) = v_c.correo) then
      continue;
    end if;
    if not exists (select 1 from public.roles where codigo = v_c.rol) then
      raise exception 'Falta el puesto % en el sistema: la cuenta % lo necesita.', v_c.rol, v_c.correo;
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
