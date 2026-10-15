-- Subcontratos por área (migración 20261017100000): Administración elige si el
-- subcontrato va a Producción o a Acabados, y el supervisor de esa área lo ve
-- en solo lectura y sin montos; el de la otra área y el de Maestranza, no. Cada
-- paso con el rol que lo da —nunca ADMIN— y `set local role authenticated`.
-- Termina en rollback.
begin;

-- Storage como en Supabase: con RLS y escritura para las cuentas (el shim no lo trae).
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_clave text; v_id uuid;
begin
  foreach v in array array['administracion:ADMINISTRACION:ADM', 'tesoreria:TESORERIA:TES',
                           'sup_prd:SUPERVISOR:PRD', 'sup_acb:SUPERVISOR:ACB', 'sup_mtz:SUPERVISOR:MTZ'] loop
    v_clave := split_part(v, ':', 1);
    -- Cada área tiene una sola Supervisión activa (migración 20260929110100):
    -- si la base ya tiene la de esa área, el check usa esa.
    if split_part(v, ':', 2) = 'SUPERVISOR' then
      select u.id into v_id from public.usuarios u
        join public.roles r on r.id = u.rol_id and r.codigo = 'SUPERVISOR'
        join public.areas a on a.id = u.area_id and a.codigo = split_part(v, ':', 3)
       where u.activo limit 1;
      if found then
        perform set_config('prueba.' || v_clave, v_id::text, true);
        continue;
      end if;
    end if;
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, v_clave || '.365@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 2), 'Check 365', v_clave || '.365@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 3))
      from public.roles r where r.codigo = split_part(v, ':', 2);
    perform set_config('prueba.' || v_clave, v_id::text, true);
  end loop;
  perform set_config('prueba.ruc', (select '1071234568' || d from generate_series(0, 9) d
                                     where public.ruc_es_valido('1071234568' || d) limit 1), true);
  foreach v in array array['sub', 'sc_prd', 'sc_acb', 'sc_anulado', 'sc_viejo', 'rec1', 'rec2', 'pago1'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.arch1', current_setting('prueba.sc_prd') || '/' || gen_random_uuid() || '.pdf', true);
  perform set_config('prueba.arch2', current_setting('prueba.sc_prd') || '/' || gen_random_uuid() || '.pdf', true);
  perform set_config('prueba.voucher1', current_setting('prueba.sc_prd') || '/' || gen_random_uuid() || '.jpg', true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
end $$;

create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;

create or replace function pg_temp.subir(p_ruta text, p_mime text) returns void language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('subcontratos', p_ruta, public.usuario_actual()::text, jsonb_build_object('mimetype', p_mime, 'size', 84000));
end $$;

-- Cuántos avisos de subcontratos le llegaron a alguien por un subcontrato.
create or replace function pg_temp.avisos(p_clave text, p_sc text) returns bigint language sql as $$
  select count(*) from public.notificaciones
   where usuario_id = pg_temp.id(p_clave) and ruta = '/subcontratos/area' and origen_id = pg_temp.id(p_sc);
$$;

-- ============================================ 1. Administración elige el área
do $$
declare v uuid;
begin
  perform pg_temp.como('administracion');
  set local role authenticated;
  perform public.guardar_subcontratista(pg_temp.id('sub'), current_setting('prueba.ruc'), 'Pintor de prueba 365',
                                        null, null, null, null, true);
  perform test.debe_fallar(format('select public.registrar_subcontrato(%L, %L, ''PLANTA'', ''Pintura de la cabina completa'', ''PEN'', 1200, null, null, null)',
      pg_temp.id('sc_prd'), pg_temp.id('sub')), 'sin área no se registra', 'Producción o Acabados');
  perform test.debe_fallar(format('select public.registrar_subcontrato(%L, %L, ''PLANTA'', ''Pintura de la cabina completa'', ''PEN'', 1200, null, null)',
      pg_temp.id('sc_prd'), pg_temp.id('sub')), 'la pantalla de antes, sin área, tampoco', 'recarga la página');
  v := public.registrar_subcontrato(pg_temp.id('sc_prd'), pg_temp.id('sub'), 'PLA_SR_O4_1_26/28',
         'Soldadura de refuerzos del piso', 'PEN', 3000, null, null, 'PRD');
  v := public.registrar_subcontrato(pg_temp.id('sc_acb'), pg_temp.id('sub'), 'PLA_SR_O4_1_26/28',
         'Pintura de la cabina completa', 'PEN', 1200, null, null, ' acb ');
  v := public.registrar_subcontrato(pg_temp.id('sc_anulado'), pg_temp.id('sub'), 'PLANTA',
         'Pintura del portón de la planta', 'PEN', 400, null, null, 'PRD');
  perform public.anular_subcontrato(v, 'Se registró dos veces por error');
  v := public.registrar_subcontrato(pg_temp.id('sc_viejo'), pg_temp.id('sub'), 'PLANTA',
         'Instalación eléctrica de la planta', 'PEN', 800, null, null, 'PRD');

  -- Un recibo pagado y otro por pagar en el de Producción.
  perform pg_temp.subir(current_setting('prueba.arch1'), 'application/pdf');
  perform public.registrar_recibo_honorarios(pg_temp.id('rec1'), pg_temp.id('sc_prd'), 'E001-41',
         (now() at time zone 'America/Lima')::date - 2, 'Primer avance', 2000, true, current_setting('prueba.arch1'));
  perform pg_temp.subir(current_setting('prueba.arch2'), 'application/pdf');
  perform public.registrar_recibo_honorarios(pg_temp.id('rec2'), pg_temp.id('sc_prd'), 'E001-42',
         (now() at time zone 'America/Lima')::date, null, 900, false, current_setting('prueba.arch2'));
  reset role;

  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform pg_temp.subir(current_setting('prueba.voucher1'), 'image/jpeg');
  perform public.registrar_pago_recibo_honorarios(pg_temp.id('pago1'), pg_temp.id('rec1'),
         (now() at time zone 'America/Lima')::date, null, current_setting('prueba.voucher1'));
  reset role;

  perform test.afirmar((select area_id = (select id from public.areas where codigo = 'PRD') from public.subcontratos where id = pg_temp.id('sc_prd'))
    and (select area_id = (select id from public.areas where codigo = 'ACB') from public.subcontratos where id = pg_temp.id('sc_acb')),
    'cada subcontrato queda con su área');
  perform test.afirmar(pg_temp.avisos('sup_prd', 'sc_prd') = 1 and pg_temp.avisos('sup_acb', 'sc_prd') = 0
    and pg_temp.avisos('sup_acb', 'sc_acb') = 1 and pg_temp.avisos('sup_prd', 'sc_acb') = 0
    and (select count(*) from public.notificaciones where usuario_id = pg_temp.id('sup_mtz') and ruta = '/subcontratos/area' and creado_en >= now()) = 0,
    'el aviso le llega al supervisor del área, no al de la otra ni al de Maestranza');
end $$;

-- ============================================ 2. El supervisor ve lo suyo, sin montos
do $$
declare v_filas integer; v_recibos jsonb;
begin
  perform pg_temp.como('sup_prd');
  set local role authenticated;
  select count(*) into v_filas from public.subcontratos_de_mi_area() s where s.creado_en >= now();
  perform test.afirmar(v_filas = 2, format('Producción ve sus dos subcontratos vigentes, sin el anulado ni el de Acabados (vio %s)', v_filas));
  select s.recibos into v_recibos from public.subcontratos_de_mi_area() s where s.id = pg_temp.id('sc_prd');
  perform test.afirmar(jsonb_array_length(v_recibos) = 2
    and (v_recibos -> 0 ->> 'numero') = 'E001-41' and (v_recibos -> 0 ->> 'pagado')::boolean
    and (v_recibos -> 1 ->> 'numero') = 'E001-42' and not (v_recibos -> 1 ->> 'pagado')::boolean,
    've sus dos recibos, el primero pagado y el segundo por pagar');
  perform test.afirmar(v_recibos::text !~* 'monto|neto|retencion|bruto|voucher|archivo', 'los recibos no traen montos ni archivos');
  perform test.afirmar((select area_codigo = 'PRD' and subcontratista = 'Pintor de prueba 365' and codigo_interno = 'PLA_SR_O4_1_26/28'
                          from public.subcontratos_de_mi_area() where id = pg_temp.id('sc_prd')),
    'trae el área, quién hace el trabajo y el código interno');
  -- Y las tablas siguen cerradas para él.
  perform test.afirmar((select count(*) from public.subcontratos) = 0 and (select count(*) from public.recibos_honorarios) = 0
    and (select count(*) from public.pagos_recibo_honorarios) = 0 and (select count(*) from storage.objects where bucket_id = 'subcontratos') = 0,
    'el supervisor no lee las tablas ni los PDF: solo la lista sin montos');
  perform test.debe_fallar(format('select public.corregir_subcontrato(%L, ''PLANTA'', ''Pintura de la cabina completa'', 1200, null, null, ''PRD'')',
      pg_temp.id('sc_acb')), 'el supervisor no corrige', 'subcontratos.gestionar');
  reset role;

  perform pg_temp.como('sup_acb');
  set local role authenticated;
  perform test.afirmar((select count(*) from public.subcontratos_de_mi_area() s where s.creado_en >= now()) = 1
    and (select jsonb_array_length(recibos) from public.subcontratos_de_mi_area() where id = pg_temp.id('sc_acb')) = 0,
    'Acabados ve solo el suyo');
  reset role;

  perform pg_temp.como('sup_mtz');
  set local role authenticated;
  perform test.afirmar((select count(*) from public.subcontratos_de_mi_area() s where s.creado_en >= now()) = 0,
    'Maestranza no ve ninguno');
  reset role;

  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform test.debe_fallar('select * from public.subcontratos_de_mi_area()', 'sin subcontratos.area no se lee la lista del área', 'subcontratos.area');
  reset role;

  perform test.afirmar(pg_get_function_result('public.subcontratos_de_mi_area()'::regprocedure) !~* 'monto|neto|retencion',
    'la lista del área no tiene columnas de montos');
end $$;

-- ============================================ 3. Cambiar el área y el subcontrato sin área
do $$
declare v uuid;
begin
  perform pg_temp.como('administracion');
  set local role authenticated;
  v := public.corregir_subcontrato(pg_temp.id('sc_acb'), 'PLA_SR_O4_1_26/28', 'Pintura de la cabina completa', 1200, null, null, 'PRD');
  reset role;
  perform test.afirmar(pg_temp.avisos('sup_prd', 'sc_acb') = 1, 'al pasarlo a Producción, a Producción le llega el aviso');

  perform pg_temp.como('sup_acb');
  set local role authenticated;
  perform test.afirmar((select count(*) from public.subcontratos_de_mi_area() s where s.creado_en >= now()) = 0, 'Acabados ya no lo ve');
  reset role;
  perform pg_temp.como('sup_prd');
  set local role authenticated;
  perform test.afirmar((select count(*) from public.subcontratos_de_mi_area() s where s.creado_en >= now()) = 3, 'Producción sí');
  reset role;

  -- Uno de antes de esta migración, sin área: nadie del taller lo ve.
  update public.subcontratos set area_id = null where id = pg_temp.id('sc_viejo');
  perform pg_temp.como('sup_prd');
  set local role authenticated;
  perform test.afirmar(not exists (select 1 from public.subcontratos_de_mi_area() where id = pg_temp.id('sc_viejo')),
    'un subcontrato sin área no le sale a ningún supervisor');
  reset role;

  perform pg_temp.como('administracion');
  set local role authenticated;
  -- Corregirlo sin área lo deja sin área: no se obliga a lo viejo.
  v := public.corregir_subcontrato(pg_temp.id('sc_viejo'), 'PLANTA', 'Instalación eléctrica de la planta', 850, null, null, null);
  perform test.afirmar((select area_id is null and monto = 850 from public.subcontratos where id = v), 'el viejo se corrige sin área');
  v := public.corregir_subcontrato(pg_temp.id('sc_viejo'), 'PLANTA', 'Instalación eléctrica de la planta', 850, null, null, 'ACB');
  -- Y una vez con área, corregir sin área no se la quita.
  v := public.corregir_subcontrato(pg_temp.id('sc_viejo'), 'PLANTA', 'Instalación eléctrica de la planta', 900, null, null);
  perform test.afirmar((select area_id = (select id from public.areas where codigo = 'ACB') and monto = 900 from public.subcontratos where id = v),
    'Administración le pone el área, y la firma de antes la conserva');
  reset role;
  perform test.afirmar(pg_temp.avisos('sup_acb', 'sc_viejo') = 1, 'a Acabados le llega el aviso cuando se le asigna');
end $$;

-- ============================================ 4. Puertas
do $$
begin
  perform test.afirmar(not has_function_privilege('anon', 'public.subcontratos_de_mi_area()', 'execute')
    and not has_function_privilege('authenticated', 'public.subcontrato_area(text)', 'execute')
    and not has_function_privilege('authenticated', 'public.avisar_area_del_subcontrato(uuid, text, text, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.registrar_subcontrato(uuid, uuid, text, text, text, numeric, date, date, text)', 'execute')
    and not has_function_privilege('anon', 'public.corregir_subcontrato(uuid, text, text, numeric, date, date, text)', 'execute'),
    'anon no ejecuta nada nuevo, y los ayudantes internos no los llama nadie');
  perform test.afirmar((select count(*) from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
                         where rp.permiso_codigo = 'subcontratos.area' and r.codigo = 'SUPERVISOR') = 1,
    'el supervisor tiene subcontratos.area');
end $$;

rollback;
