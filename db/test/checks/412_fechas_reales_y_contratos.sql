-- Las fechas reales del subcontrato y su contrato (migraciones 20261020201000 y 20261020202000). DKS, 2026-10-20:
-- «también, pero referencial… para servicios y para subcontratos debes dejar
-- adjuntar contratos al crearlos o que se quede opcional para que después lo
-- adjunten».
--
--   1. El supervisor de Maestranza marca cuándo empezó y terminó de verdad un
--      subcontrato de su área; las fechas del contrato no cambian. No marca en
--      otra área, ni en el futuro, ni el fin antes del inicio, ni en uno anulado.
--   2. Administración adjunta el contrato del subcontrato, y otra versión
--      encima; Tesorería lo ve, el supervisor no. Nadie lo cambia ni lo borra.
--
-- Cada paso con el rol que lo da —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

-- Storage como en Supabase: con RLS y escritura para las cuentas (el shim no lo trae).
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_clave text; v_id uuid;
begin
  -- Una sola Supervisión activa por área (20260929110100): si la base ya tiene la del área, se usa esa.
  foreach v in array array['sup_mtz:SUPERVISOR:MTZ', 'administracion:ADMINISTRACION:ADM', 'tesoreria:TESORERIA:TES'] loop
    v_clave := split_part(v, ':', 1);
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
    insert into auth.users (id, email) values (v_id, v_clave || '.412@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 2), 'Check 412', v_clave || '.412@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 3))
      from public.roles r where r.codigo = split_part(v, ':', 2);
    perform set_config('prueba.' || v_clave, v_id::text, true);
  end loop;
  foreach v in array array['sub', 'sc_mtz', 'sc_prd', 'sc_anulado', 'c1', 'c2'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.ruc', (select '1071234120' || d from generate_series(0, 9) d
                                     where public.ruc_es_valido('1071234120' || d) limit 1), true);
  perform set_config('prueba.hoy', ((now() at time zone 'America/Lima')::date)::text, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.txt(p_clave text) returns text language sql as $$
  select current_setting('prueba.' || p_clave);
$$;
create or replace function pg_temp.dia(n integer) returns date language sql as $$
  select current_setting('prueba.hoy')::date - n;
$$;
-- La ruta de un archivo: {carpeta}/{id}.pdf.
create or replace function pg_temp.ruta(p_carpeta text, p_archivo text) returns text language sql as $$
  select current_setting('prueba.' || p_carpeta) || '/' || current_setting('prueba.' || p_archivo) || '.pdf';
$$;
-- Sube un archivo a Storage como la persona de la sesión.
create or replace function pg_temp.subir(p_bucket text, p_ruta text) returns void language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values (p_bucket, p_ruta, public.usuario_actual()::text, jsonb_build_object('mimetype', 'application/pdf', 'size', 84000));
end $$;
-- Lo que el supervisor ve de un subcontrato, como lo ve él.
create or replace function pg_temp.del_area(p_sub text) returns jsonb language sql as $$
  select to_jsonb(s) from public.subcontratos_del_area_con_fechas_reales() s where s.id = current_setting('prueba.' || p_sub)::uuid;
$$;
create or replace function pg_temp.marcar_sql(p_sub text, p_inicio date, p_fin date) returns text language sql as $$
  select format('select public.marcar_fechas_reales_subcontrato(%L, %L, %L)', current_setting('prueba.' || p_sub), p_inicio, p_fin);
$$;

-- ======================================================= 0. Administración registra los subcontratos
select pg_temp.como('administracion');
set local role authenticated;
select public.guardar_subcontratista(pg_temp.id('sub'), pg_temp.txt('ruc'), 'Soldador de prueba 412', null, null, null, null, true);
select public.registrar_subcontrato(pg_temp.id('sc_mtz'), pg_temp.id('sub'), 'CHK412_SR_A_26/40',
  'Soldadura del piso del cajón', 'PEN', 2000, pg_temp.dia(10), pg_temp.dia(-10), 'MTZ');
select public.registrar_subcontrato(pg_temp.id('sc_prd'), pg_temp.id('sub'), 'CHK412_SR_A_26/40',
  'Montaje del bastidor', 'PEN', 3000, pg_temp.dia(10), pg_temp.dia(-20), 'PRD');
select public.registrar_subcontrato(pg_temp.id('sc_anulado'), pg_temp.id('sub'), 'CHK412_SR_A_26/40',
  'Pintura registrada por error', 'PEN', 500, null, null, 'MTZ');
select public.anular_subcontrato(pg_temp.id('sc_anulado'), 'Se registró dos veces por error');
reset role;

-- ======================================================= 1. Las fechas reales
select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar(pg_temp.del_area('sc_mtz')->>'inicio_real' is null, 'sin marcar, el supervisor no ve fechas reales');
select public.marcar_fechas_reales_subcontrato(pg_temp.id('sc_mtz'), pg_temp.dia(8), null);
select test.afirmar(pg_temp.del_area('sc_mtz')->>'inicio_real' = pg_temp.dia(8)::text
                    and pg_temp.del_area('sc_mtz')->>'fin_real' is null
                    and pg_temp.del_area('sc_mtz')->>'fecha_inicio' = pg_temp.dia(10)::text,
  'el supervisor marca que empezó dos días después del contrato, y la fecha del contrato no cambia');
select test.debe_fallar(pg_temp.marcar_sql('sc_prd', pg_temp.dia(8), null),
  'no marca en un subcontrato de Producción', 'no es de tu área');
select test.debe_fallar(pg_temp.marcar_sql('sc_mtz', pg_temp.dia(-1), null),
  'no marca un inicio en el futuro', 'de hoy hacia atrás');
select test.debe_fallar(pg_temp.marcar_sql('sc_mtz', pg_temp.dia(8), pg_temp.dia(9)),
  'el fin no va antes del inicio', 'antes de empezar');
select test.debe_fallar(pg_temp.marcar_sql('sc_mtz', null, pg_temp.dia(1)),
  'sin inicio no hay fin', 'Marca primero');
select test.debe_fallar(pg_temp.marcar_sql('sc_anulado', pg_temp.dia(1), null),
  'a uno anulado ya no se le marcan fechas', 'anulado');
select public.marcar_fechas_reales_subcontrato(pg_temp.id('sc_mtz'), pg_temp.dia(8), pg_temp.dia(0));
select test.afirmar(pg_temp.del_area('sc_mtz')->>'fin_real' = pg_temp.dia(0)::text and pg_temp.del_area('sc_mtz')->>'estado' = 'VIGENTE',
  'marca que terminó hoy, y el subcontrato sigue vigente: terminarlo es de Administración');
select test.afirmar((select count(*) from public.subcontratos_del_area() s where s.id = pg_temp.id('sc_mtz')) = 1,
  'la lista de antes, sin las fechas reales, sigue respondiendo');
select test.afirmar((select count(*) from public.subcontratos) = 0, 'el supervisor no lee la tabla de subcontratos');
reset role;

select pg_temp.como('administracion');
set local role authenticated;
select test.afirmar((select inicio_real = pg_temp.dia(8) and fin_real = pg_temp.dia(0) and fechas_reales_por = pg_temp.id('sup_mtz')
                       and fecha_inicio = pg_temp.dia(10) and fecha_fin = pg_temp.dia(-10)
                       from public.subcontratos where id = pg_temp.id('sc_mtz')),
  'Administración ve las fechas reales, quién las marcó y las del contrato intactas');
select test.debe_fallar(pg_temp.marcar_sql('sc_mtz', pg_temp.dia(5), null),
  'Administración no marca las fechas reales: son del supervisor', 'subcontratos.area');

-- ======================================================= 2. El contrato del subcontrato
select test.debe_fallar(format('select public.adjuntar_contrato_subcontrato(%L, %L, %L, ''Contrato.pdf'')',
    pg_temp.txt('c1'), pg_temp.txt('sc_mtz'), pg_temp.ruta('sc_mtz', 'c1')),
  'sin el archivo subido no se adjunta', 'no terminó de subir');
select pg_temp.subir('subcontratos', pg_temp.ruta('sc_mtz', 'c1'));
select public.adjuntar_contrato_subcontrato(pg_temp.id('c1'), pg_temp.id('sc_mtz'), pg_temp.ruta('sc_mtz', 'c1'), 'Contrato firmado.pdf');
select test.afirmar(public.adjuntar_contrato_subcontrato(pg_temp.id('c1'), pg_temp.id('sc_mtz'), pg_temp.ruta('sc_mtz', 'c1'), 'Contrato firmado.pdf') = pg_temp.id('c1')
                    and (select count(*) from public.subcontrato_contratos where subcontrato_id = pg_temp.id('sc_mtz')) = 1,
  'el reintento del mismo contrato no lo duplica');
-- Otro archivo con el mismo id ya no es el mismo envío (migración 20261022160000).
select set_config('prueba.c1b', gen_random_uuid()::text, true);
select pg_temp.subir('subcontratos', pg_temp.ruta('sc_mtz', 'c1b'));
select test.debe_fallar(format('select public.adjuntar_contrato_subcontrato(%L, %L, %L, ''Contrato otra vez.pdf'')',
    pg_temp.txt('c1'), pg_temp.txt('sc_mtz'), pg_temp.ruta('sc_mtz', 'c1b')),
  'el mismo id con otro archivo no se da por adjuntado', 'ya quedó adjuntado con otro archivo');
do $$
declare
  v integer;
begin
  delete from storage.objects where bucket_id = 'subcontratos' and name = pg_temp.ruta('sc_mtz', 'c1b');
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'y ese archivo, que ninguna fila nombra, la pantalla lo quita');
end $$;
select test.debe_fallar(format('select public.adjuntar_contrato_subcontrato(%L, %L, %L, null)',
    gen_random_uuid(), pg_temp.txt('sc_mtz'), pg_temp.ruta('sc_mtz', 'c1')),
  'el mismo archivo no se adjunta dos veces', 'ya está adjunto');
-- Llega la adenda: va encima, y el primero queda.
select pg_temp.subir('subcontratos', pg_temp.ruta('sc_mtz', 'c2'));
select public.adjuntar_contrato_subcontrato(pg_temp.id('c2'), pg_temp.id('sc_mtz'), pg_temp.ruta('sc_mtz', 'c2'), 'Adenda.pdf');
select test.afirmar((select count(*) from public.subcontrato_contratos where subcontrato_id = pg_temp.id('sc_mtz')) = 2,
  'la adenda se adjunta encima y el primer contrato queda como evidencia');
select test.debe_fallar(format('select public.adjuntar_contrato_subcontrato(%L, %L, %L, null)',
    gen_random_uuid(), pg_temp.txt('sc_anulado'), pg_temp.txt('sc_anulado') || '/' || gen_random_uuid() || '.pdf'),
  'a un subcontrato anulado no se le adjunta contrato', 'anulado');
-- Quitar un archivo adjunto no hace nada: la política de Storage solo deja quitar uno suelto.
delete from storage.objects where bucket_id = 'subcontratos' and name = pg_temp.ruta('sc_mtz', 'c1');
select test.debe_fallar(format('delete from public.subcontrato_contratos where id = %L', pg_temp.txt('c1')),
  'Administración no borra un contrato adjunto', 'permission denied');
reset role;
select test.afirmar((select count(*) from storage.objects where bucket_id = 'subcontratos' and name = pg_temp.ruta('sc_mtz', 'c1')) = 1,
  'el archivo del contrato sigue en Storage');
select test.debe_fallar(format('delete from public.subcontrato_contratos where id = %L', pg_temp.txt('c1')),
  'ni el dueño de la base borra un contrato adjunto', 'no se cambia ni se borra');

-- Quien subió el contrato y después cambió de puesto ya no ve el contrato que
-- nombra su archivo, pero tampoco puede quitarlo como si estuviera suelto. El
-- cambio de puesto lo hace el administrador del sistema.
select set_config('prueba.admin', test.crear_usuario('Ada', 'Admin', 'admin412@demo.pe', 'ADMIN', (select id from public.sedes limit 1))::text, true);
select test.como_usuario(pg_temp.id('admin'));
update public.usuarios set rol_id = (select id from public.roles where codigo = 'VENDEDOR')
 where id = pg_temp.id('administracion');
select pg_temp.como('administracion');
set local role authenticated;
select test.afirmar((select count(*) from storage.objects where bucket_id = 'subcontratos') = 0,
  'quien subió el contrato y cambió de puesto ya no lo ve: lleva el monto');
delete from storage.objects where bucket_id = 'subcontratos' and name = pg_temp.ruta('sc_mtz', 'c1');
reset role;
select test.afirmar((select count(*) from storage.objects where bucket_id = 'subcontratos' and name = pg_temp.ruta('sc_mtz', 'c1')) = 1,
  'ni lo quita');
select test.como_usuario(pg_temp.id('admin'));
update public.usuarios set rol_id = (select id from public.roles where codigo = 'ADMINISTRACION')
 where id = pg_temp.id('administracion');

select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select count(*) from public.subcontrato_contratos where subcontrato_id = pg_temp.id('sc_mtz')) = 2
                    and (select count(*) from storage.objects where bucket_id = 'subcontratos'
                          and name in (pg_temp.ruta('sc_mtz', 'c1'), pg_temp.ruta('sc_mtz', 'c2'))) = 2,
  'Tesorería ve los contratos y sus archivos');
select test.debe_fallar(format('select public.adjuntar_contrato_subcontrato(%L, %L, %L, null)',
    gen_random_uuid(), pg_temp.txt('sc_mtz'), pg_temp.ruta('sc_mtz', 'c2')),
  'Tesorería no adjunta contratos', 'subcontratos.gestionar');
reset role;

select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar((select count(*) from public.subcontrato_contratos) = 0
                    and (select count(*) from storage.objects where bucket_id = 'subcontratos') = 0,
  'el supervisor no ve el contrato: lleva el monto');
reset role;

select test.afirmar(not has_function_privilege('anon', 'public.marcar_fechas_reales_subcontrato(uuid, date, date)', 'execute')
                    and not has_function_privilege('anon', 'public.adjuntar_contrato_subcontrato(uuid, uuid, text, text)', 'execute')
                    and not has_function_privilege('anon', 'public.subcontratos_del_area_con_fechas_reales()', 'execute')
                    and not has_function_privilege('anon', 'public.subcontrato_ruta_adjunta(text)', 'execute'),
  'anon no ejecuta nada de esto');

select 'CHECK 412 OK' as resultado;
rollback;
