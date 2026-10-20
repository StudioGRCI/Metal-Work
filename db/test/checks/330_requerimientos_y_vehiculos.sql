-- El área de Requerimientos registra el RQ de insumos (sin OT) y el ingreso y
-- salida de vehículos. Probado con el rol que hace cada trabajo —nunca como
-- ADMIN— y `set local role authenticated`. Termina en rollback.
begin;

-- ----------------------------------------------------------------- armazón
-- Una cuenta por puesto, cada una en su área, como en producción.
do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'COMPRADOR:LOG', 'SUPERVISOR:PRD', 'VENDEDOR:GCO', 'GERENTE:GGE'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(split_part(v, ':', 1)) || '.330@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 330', lower(split_part(v, ':', 1)) || '.330@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;

  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.kg', (select id::text from public.unidades_medida where codigo = 'KG'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  perform set_config('prueba.por_clasificar', coalesce((select id::text from public.categorias_material
                                                        where codigo = 'ALM_POR_CLASIFICAR'), ''), true);
  perform set_config('prueba.rq', gen_random_uuid()::text, true);
  perform set_config('prueba.rq2', gen_random_uuid()::text, true);
  perform set_config('prueba.v1', gen_random_uuid()::text, true);
  perform set_config('prueba.v2', gen_random_uuid()::text, true);
  perform set_config('prueba.v3', gen_random_uuid()::text, true);
  if current_setting('prueba.area_mtz') = '' or current_setting('prueba.und') = '' or current_setting('prueba.cat') = '' then
    raise exception 'FALLA: faltan el área MTZ, la unidad UND o una categoría activa para probar';
  end if;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.lineas() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('descripcion', 'Plancha LAF 2 mm 4x8', 'cantidad', 3,
                       'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')),
    jsonb_build_object('descripcion', 'Soldadura MIG 0.9 mm', 'cantidad', 12.5,
                       'unidad_medida_id', coalesce(nullif(current_setting('prueba.kg'), ''), current_setting('prueba.und')),
                       'categoria_id', current_setting('prueba.cat')));
$$;

-- ======================================================= 1. EL REQUERIMIENTO
-- Un supervisor de taller no registra RQ (los pide; lo anota Requerimientos).
select pg_temp.como('supervisor');
set local role authenticated;
select test.debe_fallar(
  format($q$select public.emitir_requerimiento('%s', '%s', 'PLA_SR_O4_1_26/28', 'Para armar la plataforma de la unidad 28', null, pg_temp.lineas())$q$,
         current_setting('prueba.rq'), current_setting('prueba.area_mtz')),
  'un supervisor no registra requerimientos', 'permiso');
reset role;

select pg_temp.como('requerimientos');
set local role authenticated;
select test.debe_fallar(
  format($q$select public.emitir_requerimiento('%s', '%s', 'PLA_SR_O4_1_26/28', 'corta', null, pg_temp.lineas())$q$,
         current_setting('prueba.rq'), current_setting('prueba.area_mtz')),
  'sin justificación no hay requerimiento', 'para qué se necesita');
select test.debe_fallar(
  format($q$select public.emitir_requerimiento('%s', '%s', 'PLA_SR_O4_1_26/28', 'Para armar la plataforma de la unidad 28', null, '[]'::jsonb)$q$,
         current_setting('prueba.rq'), current_setting('prueba.area_mtz')),
  'sin insumos no hay requerimiento', 'al menos un insumo');
select test.debe_fallar(
  format($q$select public.emitir_requerimiento('%s', '%s', 'PLA_SR_O4_1_26/28', 'Para armar la plataforma de la unidad 28', current_date - 3, pg_temp.lineas())$q$,
         current_setting('prueba.rq'), current_setting('prueba.area_mtz')),
  'no se pide para una fecha que ya pasó', 'anterior a hoy');

select public.emitir_requerimiento(current_setting('prueba.rq')::uuid, current_setting('prueba.area_mtz')::uuid,
  ' PLA_SR_O4_1_26/28 ', 'Para armar la plataforma de la unidad 28', current_date + 5, pg_temp.lineas());
-- Un reintento del mismo formulario no duplica.
select public.emitir_requerimiento(current_setting('prueba.rq')::uuid, current_setting('prueba.area_mtz')::uuid,
  'PLA_SR_O4_1_26/28', 'Para armar la plataforma de la unidad 28', current_date + 5, pg_temp.lineas());

select test.afirmar(
  (select numero ~ '^(RQ-[0-9]{4,}-[0-9]{4}|PRUEBA-[0-9]+)$' and estado = 'POR_ATENDER' and codigo_interno = 'PLA_SR_O4_1_26/28'
          and creado_por = current_setting('prueba.requerimientos')::uuid
     from public.requerimientos where id = current_setting('prueba.rq')::uuid),
  'el RQ nace con número de la casa, por atender, con el código interno limpio');
select test.afirmar(
  (select count(*) = 2 and min(item) = 1 and max(item) = 2 and sum(cantidad) = 15.5
     from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.rq')::uuid),
  'el reintento no duplicó: dos insumos con su cantidad');

-- Lo emitido no se toca por fuera de las funciones.
select test.debe_fallar(
  format($q$update public.requerimientos set justificacion = 'Otra justificación cualquiera' where id = '%s'$q$, current_setting('prueba.rq')),
  'Requerimientos no edita el RQ por debajo', 'permission denied');
select test.debe_fallar(
  format($q$delete from public.requerimiento_lineas where requerimiento_id = '%s'$q$, current_setting('prueba.rq')),
  'ni borra sus insumos', 'permission denied');
reset role;

do $$ begin
  if current_setting('prueba.por_clasificar') <> '' then
    perform pg_temp.como('requerimientos');
    set local role authenticated;
    perform test.debe_fallar(
      format($q$select public.emitir_requerimiento('%s', '%s', 'PLANTA', 'Reposición de consumibles de planta', null,
        jsonb_build_array(jsonb_build_object('descripcion', 'Disco de corte', 'cantidad', 1,
          'unidad_medida_id', '%s', 'categoria_id', '%s')))$q$,
        current_setting('prueba.rq2'), current_setting('prueba.area_mtz'), current_setting('prueba.und'),
        current_setting('prueba.por_clasificar')),
      'un insumo «por clasificar» no entra: el RQ pide la categoría', 'categoría');
    reset role;
  end if;
end $$;

-- Primero lo revisa Almacén (check 331): a Logística no le llega el aviso
-- todavía, pero lo ve con su permiso; Ventas no lo ve.
select test.afirmar(
  not exists (select 1 from public.notificaciones where usuario_id = current_setting('prueba.comprador')::uuid
                 and origen_id = current_setting('prueba.rq')::uuid),
  'a Logística no le llega el aviso hasta que Almacén diga que no hay stock');

select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.requerimientos where id = current_setting('prueba.rq')::uuid) = 1
  and (select count(*) from public.requerimiento_lineas where requerimiento_id = current_setting('prueba.rq')::uuid) = 2,
  'Logística ve el requerimiento y sus insumos');
reset role;

select pg_temp.como('vendedor');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.requerimientos where id = current_setting('prueba.rq')::uuid) = 0,
  'Ventas no ve los requerimientos');
reset role;

-- Anular: con motivo, y una sola vez.
select pg_temp.como('requerimientos');
set local role authenticated;
select test.debe_fallar(
  format($q$select public.anular_requerimiento('%s', 'corto')$q$, current_setting('prueba.rq')),
  'sin motivo no se anula', 'por qué se anula');
select public.anular_requerimiento(current_setting('prueba.rq')::uuid, 'Se pidió dos veces por error');
reset role;
select test.afirmar(
  (select estado = 'ANULADO' and anulado_por = current_setting('prueba.requerimientos')::uuid
     from public.requerimientos where id = current_setting('prueba.rq')::uuid),
  'el RQ queda anulado con quién y cuándo');
-- Ni el dueño de las tablas lo revive ni lo borra.
select test.debe_fallar(
  format($q$update public.requerimientos set estado = 'POR_ATENDER' where id = '%s'$q$, current_setting('prueba.rq')),
  'un RQ anulado queda congelado', 'queda como evidencia');
select test.debe_fallar(
  format($q$delete from public.requerimientos where id = '%s'$q$, current_setting('prueba.rq')),
  'un RQ no se borra nunca', 'no se borra');

-- ================================================ 2. EL REGISTRO DE VEHÍCULOS
-- Cada ingreso y cada salida llevan sus fotos (check 346 prueba sus reglas).
-- Storage local no trae RLS: aquí se prende, como en Supabase. Se deshace con el rollback.
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- Sube una foto a la carpeta de la cuenta actual y devuelve la lista que va a la función.
create or replace function pg_temp.foto(p_registro text, p_momento text) returns jsonb language plpgsql as $$
declare v_ruta text := auth.uid()::text || '/' || p_registro || '/' || p_momento || '/' || gen_random_uuid() || '.jpg';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('fotos-vehiculos', v_ruta, auth.uid()::text, '{"mimetype": "image/jpeg", "size": 150000}');
  return jsonb_build_array(v_ruta);
end $$;

-- Motivo «otro» o «cochera»: desde 20261020166000 el trabajo del taller entra con
-- el código de una unidad con OT y sale con el 100 %; eso lo prueba el check 405.
select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar(
  format($q$select public.registrar_ingreso_vehiculo('%s', 'ABC-123', null, null, 'Tolva 18 m3', 'INCOAC', 'OTRO', null, null, '[]')$q$,
         current_setting('prueba.v1')),
  'Ventas no registra vehículos', 'permiso');
reset role;

select pg_temp.como('requerimientos');
set local role authenticated;
select test.debe_fallar(
  format($q$select public.registrar_ingreso_vehiculo('%s', ' ', ' ', '', 'Tolva 18 m3', 'INCOAC', 'OTRO', null, null, pg_temp.foto('%s', 'ingreso'))$q$,
         current_setting('prueba.v1'), current_setting('prueba.v1')),
  'sin placa, chasis ni código no se sabe qué entró', 'placa');
select public.registrar_ingreso_vehiculo(current_setting('prueba.v1')::uuid, ' abc 123 ', null, 'VSC_CM_N3_6_26/18',
  'Tolva 18 m3 Volvo', 'ING. Y CONST. ACOSTA', 'OTRO', now() - interval '2 hours', 'Ingresa con llanta baja',
  pg_temp.foto(current_setting('prueba.v1'), 'ingreso'));
select test.afirmar(
  (select placa = 'ABC123' and salida_en is null from public.registro_vehiculos where id = current_setting('prueba.v1')::uuid),
  'la placa se guarda en mayúsculas y sin espacios, y el vehículo queda en planta');
select test.debe_fallar(
  format($q$select public.registrar_ingreso_vehiculo('%s', 'ABC123', null, null, 'Tolva', 'INCOAC', 'OTRO', null, null, pg_temp.foto('%s', 'ingreso'))$q$,
         current_setting('prueba.v2'), current_setting('prueba.v2')),
  'el mismo vehículo no entra dos veces sin haber salido', 'ya está en la planta');
select test.debe_fallar(
  format($q$select public.registrar_salida_vehiculo('%s', now() - interval '3 hours', null, pg_temp.foto('%s', 'salida'))$q$,
         current_setting('prueba.v1'), current_setting('prueba.v1')),
  'la salida no puede ser anterior al ingreso', 'anterior al ingreso');
select public.registrar_salida_vehiculo(current_setting('prueba.v1')::uuid, null, 'Sale al arenado externo',
  pg_temp.foto(current_setting('prueba.v1'), 'salida'));
-- Vuelve del arenado: es otro ingreso.
select public.registrar_ingreso_vehiculo(current_setting('prueba.v2')::uuid, 'ABC123', null, 'VSC_CM_N3_6_26/18',
  'Tolva 18 m3 Volvo', 'ING. Y CONST. ACOSTA', 'COCHERA', null, null, pg_temp.foto(current_setting('prueba.v2'), 'ingreso'));
-- Un chasis nuevo de fabricación entra sin placa.
select public.registrar_ingreso_vehiculo(current_setting('prueba.v3')::uuid, null, '9BM958074KB123456', null,
  'Chasis Mercedes-Benz Atego', 'MAT CENTER', 'OTRO', null, null, pg_temp.foto(current_setting('prueba.v3'), 'ingreso'));
select test.debe_fallar(
  format($q$update public.registro_vehiculos set empresa = 'Otra' where id = '%s'$q$, current_setting('prueba.v1')),
  'el registro no se edita por debajo', 'permission denied');
select public.anular_registro_vehiculo(current_setting('prueba.v3')::uuid, 'Se anotó un chasis que no era');
select test.debe_fallar(
  format($q$select public.registrar_salida_vehiculo('%s', null, null, pg_temp.foto('%s', 'salida'))$q$,
         current_setting('prueba.v3'), current_setting('prueba.v3')),
  'un ingreso anulado no tiene salida', 'anulado');
reset role;

select test.afirmar(
  (select salida_en is not null and salida_por = current_setting('prueba.requerimientos')::uuid
     from public.registro_vehiculos where id = current_setting('prueba.v1')::uuid),
  'la salida queda con la cuenta que la marcó');
select test.debe_fallar(
  format($q$update public.registro_vehiculos set salida_en = now() + interval '1 minute' where id = '%s'$q$, current_setting('prueba.v1')),
  'la salida ya marcada no se corrige', 'no se corrige');
select test.debe_fallar(
  format($q$delete from public.registro_vehiculos where id = '%s'$q$, current_setting('prueba.v1')),
  'un registro de vehículo no se borra', 'no se borra');

select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.registro_vehiculos
    where id in (current_setting('prueba.v1')::uuid, current_setting('prueba.v2')::uuid, current_setting('prueba.v3')::uuid)) = 3,
  'Gerencia consulta el registro de vehículos');
select test.afirmar(
  (select count(*) from public.registro_vehiculo_fotos
    where registro_id in (current_setting('prueba.v1')::uuid, current_setting('prueba.v2')::uuid, current_setting('prueba.v3')::uuid)) = 4,
  'y sus fotos: el ingreso y la salida del primero, y el ingreso de los otros dos');
reset role;

select pg_temp.como('vendedor');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.registro_vehiculos) = 0,
  'Ventas no ve el registro de vehículos');
reset role;

do $$ begin raise notice 'OK 330: requerimientos y vehículos'; end $$;
rollback;
