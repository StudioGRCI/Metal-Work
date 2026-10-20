-- Supervisión, Almacén y Requerimientos trabajan por código interno (migración
-- 20261016110000). Supervisión general y Almacén ven, sin cambiar nada, lo que
-- Diseño lleva en cada código: los planos de todas las áreas, la lista de
-- materiales con lo pedido, y las etapas. Requerimientos llena la ficha única
-- de ingreso y salida en el registro del vehículo, adjunta el escaneo firmado y
-- le pide a Tesorería la revisión para la salida; Tesorería la atiende u
-- observa. Cada paso con el rol que lo da —nunca ADMIN— y
-- `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

do $$
declare v text; v_id uuid;
begin
  -- Sin jefatura de taller (la migración 20260929110100 no deja activarlas) y con
  -- una sola Supervisión activa por área: si la base ya trae la de Maestranza, se usa esa.
  foreach v in array array['DISENO:DIS', 'SUPERVISOR:MTZ', 'SUPERVISOR_GENERAL:GOP', 'ALMACENERO:ALM',
                           'REQUERIMIENTOS:REQ', 'TESORERIA:TES', 'VENDEDOR:GCO', 'GERENTE:GGE'] loop
    if split_part(v, ':', 1) = 'SUPERVISOR' then
      select u.id into v_id from public.usuarios u
        join public.roles r on r.id = u.rol_id and r.codigo = 'SUPERVISOR'
        join public.areas a on a.id = u.area_id and a.codigo = split_part(v, ':', 2)
       where u.activo limit 1;
      if found then
        perform set_config('prueba.' || lower(replace(v, ':', '_')), v_id::text, true);
        continue;
      end if;
    end if;
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.363@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 363', lower(replace(v, ':', '.')) || '.363@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(replace(v, ':', '_')), v_id::text, true);
  end loop;
  perform set_config('prueba.mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.prd', (select id::text from public.areas where codigo = 'PRD'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK363-PLA', 'Plancha LAF 3 mm (363)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat1', v, true);
  foreach v in array array['p1', 'r1', 'p2', 'r2', 'rq', 'v1', 'v2', 'rev1', 'rev2', 'rev3', 'pdf', 'pdf_otro', 'pdf_falta'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.codigo', 'CHK363_SR_O4_1_26/31', true);
  perform set_config('prueba.puntos', (select count(*)::text from public.control_vehicular_items), true);
  -- Todos los puntos del formato, para cerrar el ingreso y la salida.
  perform set_config('prueba.todo_ingreso', (select jsonb_object_agg(codigo, jsonb_build_object('ingreso', 'CONFORME'))::text
                                               from public.control_vehicular_items), true);
  perform set_config('prueba.todo_salida', (select jsonb_object_agg(codigo, jsonb_build_object('salida',
                                               case when orden = 1 then 'OBSERVADO' else 'CONFORME' end))::text
                                              from public.control_vehicular_items), true);
  perform set_config('prueba.un_punto', (select codigo from public.control_vehicular_items order by orden limit 1), true);
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
create or replace function pg_temp.ruta_plano(p_plano text, p_rev text) returns text language sql as $$
  select current_setting('prueba.' || p_plano) || '/' || current_setting('prueba.' || p_rev) || '.pdf';
$$;
create or replace function pg_temp.ruta_ficha(p_registro text, p_archivo text) returns text language sql as $$
  select current_setting('prueba.' || p_registro) || '/' || current_setting('prueba.' || p_archivo) || '.pdf';
$$;
create or replace function pg_temp.foto(p_registro text, p_momento text) returns text language sql as $$
  select current_setting('prueba.requerimientos_req') || '/' || current_setting('prueba.' || p_registro) || '/' || p_momento
         || '/' || md5(p_registro || p_momento)::uuid || '.jpg';
$$;
create or replace function pg_temp.avisos(p_clave text, p_titulo text) returns integer language sql as $$
  select count(*)::integer from public.notificaciones
   where usuario_id = pg_temp.id(p_clave) and titulo like p_titulo || '%' and creado_en >= now();
$$;
-- La ficha que ve quien mira (RLS), para el ingreso de prueba.
create or replace function pg_temp.ficha(p_registro text) returns public.registro_vehiculo_fichas language sql as $$
  select * from public.registro_vehiculo_fichas where registro_id = pg_temp.id(p_registro);
$$;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

-- ======================================================= 1. Lo que Diseño lleva en el código
-- Diseño carga un plano para Maestranza y otro para Producción, una línea de
-- materiales y las seis etapas; Requerimientos emite el RQ del código.
select pg_temp.como('diseno_dis');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
  ('planos-codigo', pg_temp.ruta_plano('p1', 'r1'), pg_temp.id('diseno_dis'), pg_temp.txt('diseno_dis'),
   '{"mimetype": "application/pdf", "size": 81234}'),
  ('planos-codigo', pg_temp.ruta_plano('p2', 'r2'), pg_temp.id('diseno_dis'), pg_temp.txt('diseno_dis'),
   '{"mimetype": "application/pdf", "size": 64000}');
select public.registrar_plano_codigo(pg_temp.id('p1'), pg_temp.id('r1'), pg_temp.txt('codigo'), '001', 'Estructura del cajón',
  pg_temp.id('mtz'), null, 'cajon.pdf', 40);
select public.registrar_plano_codigo(pg_temp.id('p2'), pg_temp.id('r2'), pg_temp.txt('codigo'), '002', 'Bastidor',
  pg_temp.id('prd'), null, 'bastidor.pdf', 30);
select public.guardar_material_codigo(null, pg_temp.txt('codigo'), pg_temp.id('mat1'), 4.5, pg_temp.id('p1'), 'Para el piso');
select test.afirmar(public.etapas_de_siempre_codigo(pg_temp.txt('codigo')) = 6, 'Diseño arma las seis etapas del código');
reset role;

select pg_temp.como('requerimientos_req');
set local role authenticated;
select public.emitir_requerimiento(pg_temp.id('rq'), pg_temp.id('mtz'), lower(pg_temp.txt('codigo')), 'Armado del cajón', null,
  jsonb_build_array(jsonb_build_object('descripcion', 'Plancha LAF 3 mm', 'cantidad', 5,
    'unidad_medida_id', pg_temp.txt('und'), 'categoria_id', pg_temp.txt('cat'))));
reset role;

-- ======================================================= 2. Supervisión general y Almacén lo siguen
do $$
declare v_clave text;
begin
  foreach v_clave in array array['supervisor_general_gop', 'almacenero_alm'] loop
    perform pg_temp.como(v_clave);
    set local role authenticated;
    perform test.afirmar(
      (select planos from public.codigos_internos_de_diseno() where codigo = pg_temp.txt('codigo')) = 2
      and (select materiales from public.codigos_internos_de_diseno() where codigo = pg_temp.txt('codigo')) = 1
      and (select etapas from public.codigos_internos_de_diseno() where codigo = pg_temp.txt('codigo')) = 6,
      v_clave || ' ve el código en la lista, con sus dos planos, su material y sus seis etapas');
    perform test.afirmar(
      (select count(*) from public.codigo_interno_planos(pg_temp.txt('codigo'))) = 2
      and (select count(*) from public.codigo_planos where codigo_interno = pg_temp.txt('codigo')) = 2
      and (select count(*) from public.codigo_plano_revisiones where plano_id in (pg_temp.id('p1'), pg_temp.id('p2'))) = 2
      and (select count(*) from public.codigo_plano_historial(pg_temp.id('p2'))) = 1
      and (select count(*) from storage.objects where bucket_id = 'planos-codigo'
             and name in (pg_temp.ruta_plano('p1', 'r1'), pg_temp.ruta_plano('p2', 'r2'))) = 2,
      v_clave || ' ve los planos de Maestranza y de Producción, su historial y sus PDF');
    perform test.afirmar(
      (select count(*) from public.codigo_interno_materiales(pg_temp.txt('codigo'))) = 1
      and (select disenado from public.codigo_interno_materiales_comparados(pg_temp.txt('codigo'))
            where material_id = pg_temp.id('mat1')) = 4.5
      and (select count(*) from public.codigo_interno_lo_pedido(pg_temp.txt('codigo'))) = 1
      and (select count(*) from public.codigo_interno_etapas(pg_temp.txt('codigo'))) = 6
      and (select count(*) from public.codigo_etapas where codigo_interno = pg_temp.txt('codigo')) = 6,
      v_clave || ' ve la lista de materiales comparada, lo pedido por RQ y las etapas');

    -- Mira, no cambia nada.
    perform test.debe_fallar(format('select public.recibir_plano_codigo(%L)', pg_temp.txt('r1')),
      v_clave || ' no recibe planos', 'codigos_internos.area');
    perform test.debe_fallar(format($q$select public.marcar_etapa_codigo(%L, 'INICIO', current_date, null)$q$,
        (select id from public.codigo_etapas where codigo_interno = pg_temp.txt('codigo') and nombre = 'Habilitado')),
      v_clave || ' no marca etapas', 'la marca Diseño');
    perform test.debe_fallar(format('select public.guardar_material_codigo(null, %L, %L, 3, null, null)',
        pg_temp.txt('codigo'), pg_temp.txt('mat1')),
      v_clave || ' no toca la lista de materiales', 'diseno.codigos');
    perform test.debe_fallar(format($q$select public.guardar_etapa_codigo(null, %L, 'Otra', null, null, null)$q$, pg_temp.txt('codigo')),
      v_clave || ' no arma etapas', 'diseno.codigos');
    reset role;
  end loop;
end $$;

-- El supervisor de Maestranza sigue viendo solo lo de su área.
select pg_temp.como('supervisor_mtz');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.codigo_interno_planos(pg_temp.txt('codigo'))) = 1
  and (select count(*) from public.codigo_planos where codigo_interno = pg_temp.txt('codigo')) = 1,
  'el supervisor de Maestranza sigue viendo solo el plano de su área');
reset role;

-- Ventas no ve nada de Diseño.
select pg_temp.como('vendedor_gco');
set local role authenticated;
select test.afirmar((select count(*) from public.codigo_planos where codigo_interno = pg_temp.txt('codigo')) = 0
  and (select count(*) from public.codigo_etapas where codigo_interno = pg_temp.txt('codigo')) = 0,
  'Ventas no ve planos ni etapas');
select test.debe_fallar($q$select * from public.codigos_internos_de_diseno()$q$, 'ni la lista de códigos', 'No tienes permiso');
select test.debe_fallar($q$select * from public.codigo_interno_materiales_comparados(current_setting('prueba.codigo'))$q$,
  'ni los materiales del código', 'No tienes permiso');
reset role;

-- ======================================================= 3. El vehículo entra con su ficha
select pg_temp.como('requerimientos_req');
set local role authenticated;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('fotos-vehiculos', pg_temp.foto('v1', 'ingreso'), pg_temp.txt('requerimientos_req'), '{"mimetype": "image/jpeg", "size": 240000}'),
  ('fotos-vehiculos', pg_temp.foto('v1', 'salida'), pg_temp.txt('requerimientos_req'), '{"mimetype": "image/jpeg", "size": 200000}'),
  ('fotos-vehiculos', pg_temp.foto('v2', 'ingreso'), pg_temp.txt('requerimientos_req'), '{"mimetype": "image/jpeg", "size": 220000}');
select public.registrar_ingreso_vehiculo(pg_temp.id('v1'), 'CHK 363', null, lower(pg_temp.txt('codigo')), 'Tolva de prueba',
  'EMPRESA DE PRUEBA', 'FABRICACION', null, null, jsonb_build_array(pg_temp.foto('v1', 'ingreso')));
select public.registrar_ingreso_vehiculo(pg_temp.id('v2'), 'CHK 364', null, null, 'Furgón de prueba',
  'EMPRESA DE PRUEBA', 'MANTENIMIENTO', null, null, jsonb_build_array(pg_temp.foto('v2', 'ingreso')));
select test.afirmar((select count(*) from public.control_vehicular_items) = pg_temp.txt('puntos')::integer,
  'Requerimientos lee los puntos del formato de la ficha');

-- Guarda a medias: la ficha nace, sin cerrar.
select public.guardar_ficha_vehiculo(pg_temp.id('v1'), 'GUARDAR', jsonb_build_object(
  'marca', ' Volvo ', 'conductor_ingreso', 'Juan Prueba', 'dni_ingreso', '00000000', 'combustible_ingreso', '1/2',
  'items', jsonb_build_object(pg_temp.txt('un_punto'), jsonb_build_object('ingreso', 'CONFORME'))));
select public.guardar_ficha_vehiculo(pg_temp.id('v1'), 'GUARDAR', jsonb_build_object(
  'marca', 'Volvo', 'conductor_ingreso', 'Juan Prueba', 'dni_ingreso', '00000000', 'combustible_ingreso', '1/2',
  'items', jsonb_build_object(pg_temp.txt('un_punto'), jsonb_build_object('ingreso', 'OBSERVADO'))));
select test.afirmar(
  (select count(*) from public.registro_vehiculo_fichas where registro_id = pg_temp.id('v1')) = 1
  and (pg_temp.ficha('v1')).marca = 'Volvo'
  and (pg_temp.ficha('v1')).ingreso_cerrado_en is null
  and (pg_temp.ficha('v1')).items -> pg_temp.txt('un_punto') ->> 'ingreso' = 'OBSERVADO'
  and (pg_temp.ficha('v1')).registrado_por = pg_temp.id('requerimientos_req'),
  'la ficha queda una sola, con lo último guardado, sin cerrar y a nombre de Requerimientos');

select test.debe_fallar(format($q$select public.guardar_ficha_vehiculo(%L, 'CERRAR_INGRESO', '{"conductor_ingreso": "Juan Prueba", "fecha_ingreso": "%s"}')$q$,
    pg_temp.txt('v1'), current_date),
  'sin todos los puntos no se cierra el ingreso', 'faltan el conductor, la fecha o algún punto');
select test.debe_fallar(format($q$select public.guardar_ficha_vehiculo(%L, 'GUARDAR', '{"items": {"NO_EXISTE": {"ingreso": "CONFORME"}}}')$q$,
    pg_temp.txt('v1')),
  'un punto que no es del formato no se guarda', 'no es del formato');
select test.debe_fallar(format($q$select public.guardar_ficha_vehiculo(%L, 'GUARDAR', %L)$q$,
    pg_temp.txt('v1'), jsonb_build_object('items', jsonb_build_object(pg_temp.txt('un_punto'), jsonb_build_object('ingreso', 'BIEN')))),
  'un estado que no es del formato tampoco', 'no se reconoce');
select test.debe_fallar(format($q$select public.guardar_ficha_vehiculo(%L, 'GUARDAR', '{"precio": 10}')$q$, pg_temp.txt('v1')),
  'ni un dato ajeno al formato', 'no son del formato');
select test.debe_fallar(format($q$select public.guardar_ficha_vehiculo(%L, 'BORRAR', '{}')$q$, pg_temp.txt('v1')),
  'ni otra acción', 'No se reconoce qué se quiere hacer');
select test.debe_fallar(format($q$select public.guardar_ficha_vehiculo(%L, 'CERRAR_SALIDA', %L)$q$,
    pg_temp.txt('v2'), jsonb_build_object('conductor_salida', 'Ana', 'fecha_salida', current_date, 'items', pg_temp.txt('todo_salida')::jsonb)),
  'la salida no se cierra en una ficha sin el ingreso cerrado', 'Cierra primero el ingreso');
select test.afirmar((select count(*) from public.registro_vehiculo_fichas where registro_id = pg_temp.id('v2')) = 0,
  'ese intento no dejó una ficha a medias');
select test.debe_fallar(format($q$update public.registro_vehiculo_fichas set marca = 'Otra' where registro_id = %L$q$, pg_temp.txt('v1')),
  'la ficha no se escribe por fuera de la función', 'permission denied');
select test.debe_fallar(format($q$select public.adjuntar_ficha_vehiculo_firmada(%L, %L, 'ficha.pdf')$q$,
    pg_temp.txt('v1'), pg_temp.ruta_ficha('v1', 'pdf')),
  'el escaneo va después de cerrar la salida', 'Cierra la salida de la ficha');
select test.debe_fallar(format($q$select public.solicitar_revision_salida(%L, %L, 'Revisar el pago del cliente')$q$,
    pg_temp.txt('rev1'), pg_temp.txt('v1')),
  'la revisión de Tesorería espera la ficha cerrada y escaneada', 'Cierra la salida de la ficha y adjunta');

-- Cierra el ingreso con todos los puntos.
select public.guardar_ficha_vehiculo(pg_temp.id('v1'), 'CERRAR_INGRESO', jsonb_build_object(
  'marca', 'Volvo', 'conductor_ingreso', 'Juan Prueba', 'dni_ingreso', '00000000', 'fecha_ingreso', current_date,
  'combustible_ingreso', '1/2', 'observacion_ingreso', 'Llega con el parachoques rayado', 'items', pg_temp.txt('todo_ingreso')::jsonb));
-- Una pestaña vieja manda otro conductor y otros puntos de ingreso: se conserva lo cerrado.
select public.guardar_ficha_vehiculo(pg_temp.id('v1'), 'GUARDAR', jsonb_build_object(
  'marca', 'Scania', 'conductor_ingreso', 'Otro', 'fecha_ingreso', current_date - 1,
  'items', jsonb_build_object(pg_temp.txt('un_punto'), jsonb_build_object('ingreso', 'NO_TIENE', 'salida', 'CONFORME')),
  'conductor_salida', 'Ana Prueba'));
select test.afirmar(
  (pg_temp.ficha('v1')).ingreso_cerrado_en is not null
  and (pg_temp.ficha('v1')).marca = 'Volvo' and (pg_temp.ficha('v1')).conductor_ingreso = 'Juan Prueba'
  and (pg_temp.ficha('v1')).fecha_ingreso = current_date
  and (pg_temp.ficha('v1')).items -> pg_temp.txt('un_punto') ->> 'ingreso' = 'CONFORME'
  and (pg_temp.ficha('v1')).items -> pg_temp.txt('un_punto') ->> 'salida' = 'CONFORME'
  and (pg_temp.ficha('v1')).conductor_salida = 'Ana Prueba',
  'el ingreso cerrado queda fijo aunque llegue otra cosa; la salida sí se guarda');
select test.debe_fallar(format($q$select public.guardar_ficha_vehiculo(%L, 'CERRAR_SALIDA', %L)$q$,
    pg_temp.txt('v1'), jsonb_build_object('conductor_salida', 'Ana Prueba', 'fecha_salida', current_date)),
  'sin todos los puntos de salida no se cierra', 'todos los puntos de salida');
select public.guardar_ficha_vehiculo(pg_temp.id('v1'), 'CERRAR_SALIDA', jsonb_build_object(
  'conductor_salida', 'Ana Prueba', 'dni_salida', '11111111', 'fecha_salida', current_date, 'combustible_salida', '1/4',
  'trabajos', 'Fabricación de tolva', 'observacion_salida', 'Sale conforme', 'items', pg_temp.txt('todo_salida')::jsonb));
select test.afirmar(
  (pg_temp.ficha('v1')).salida_cerrada_en is not null
  and (pg_temp.ficha('v1')).items -> pg_temp.txt('un_punto') ->> 'salida' = 'OBSERVADO'
  and (select count(*) from jsonb_object_keys((pg_temp.ficha('v1')).items)) = pg_temp.txt('puntos')::integer,
  'la salida queda cerrada con todos los puntos');
select test.debe_fallar(format($q$select public.guardar_ficha_vehiculo(%L, 'GUARDAR', '{}')$q$, pg_temp.txt('v1')),
  'con la salida cerrada ya no se cambia', 'solo falta adjuntar el escaneo');

-- El escaneo firmado.
select test.debe_fallar(format($q$select public.adjuntar_ficha_vehiculo_firmada(%L, %L, 'ficha.pdf')$q$,
    pg_temp.txt('v1'), pg_temp.ruta_ficha('v1', 'pdf_falta')),
  'un escaneo que no terminó de subir no se anota', 'no terminó de subir');
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('fichas-vehiculos', pg_temp.ruta_ficha('v1', 'pdf'), pg_temp.txt('requerimientos_req'), '{"mimetype": "application/pdf", "size": 350000}'),
  ('fichas-vehiculos', pg_temp.ruta_ficha('v1', 'pdf_otro'), pg_temp.txt('requerimientos_req'), '{"mimetype": "application/pdf", "size": 1000}');
select test.debe_fallar(format($q$select public.adjuntar_ficha_vehiculo_firmada(%L, %L, 'ficha.pdf')$q$,
    pg_temp.txt('v1'), pg_temp.ruta_ficha('v2', 'pdf')),
  'ni uno con la ruta de otro vehículo', 'Vuelve a adjuntar');
select public.adjuntar_ficha_vehiculo_firmada(pg_temp.id('v1'), pg_temp.ruta_ficha('v1', 'pdf'), ' ficha-firmada.pdf ');
select public.adjuntar_ficha_vehiculo_firmada(pg_temp.id('v1'), pg_temp.ruta_ficha('v1', 'pdf'), 'ficha-firmada.pdf');
select test.debe_fallar(format($q$select public.adjuntar_ficha_vehiculo_firmada(%L, %L, 'otra.pdf')$q$,
    pg_temp.txt('v1'), pg_temp.ruta_ficha('v1', 'pdf_otro')),
  'el escaneo adjunto no se reemplaza', 'ya tiene su escaneo');
select test.afirmar((pg_temp.ficha('v1')).escaneo_ruta = pg_temp.ruta_ficha('v1', 'pdf')
  and (pg_temp.ficha('v1')).escaneo_nombre = 'ficha-firmada.pdf',
  'el escaneo queda anotado una vez, aunque se reintente');
-- El PDF suelto lo retira su dueño; el que nombra la ficha, no.
delete from storage.objects where bucket_id = 'fichas-vehiculos' and name in (pg_temp.ruta_ficha('v1', 'pdf'), pg_temp.ruta_ficha('v1', 'pdf_otro'));
select test.afirmar((select count(*) from storage.objects where bucket_id = 'fichas-vehiculos'
                      and name like pg_temp.txt('v1') || '/%') = 1,
  'el PDF que la ficha nombra no se puede retirar; el suelto sí');
reset role;

-- Ventas no sube escaneos ni ve fichas.
select pg_temp.como('vendedor_gco');
set local role authenticated;
select test.debe_fallar(format($q$insert into storage.objects (bucket_id, name, owner_id, metadata)
                                  values ('fichas-vehiculos', %L, %L, '{"mimetype": "application/pdf", "size": 10}')$q$,
    pg_temp.txt('v2') || '/' || gen_random_uuid() || '.pdf', pg_temp.txt('vendedor_gco')),
  'Ventas no sube escaneos de fichas', 'row-level security');
select test.afirmar((select count(*) from public.registro_vehiculo_fichas where registro_id = pg_temp.id('v1')) = 0
  and (select count(*) from storage.objects where bucket_id = 'fichas-vehiculos' and name like pg_temp.txt('v1') || '/%') = 0,
  'ni ve la ficha ni su escaneo');
select test.debe_fallar(format($q$select public.guardar_ficha_vehiculo(%L, 'GUARDAR', '{}')$q$, pg_temp.txt('v2')),
  'ni la llena', 'vehiculos.registrar');
reset role;

-- ======================================================= 4. La revisión de Tesorería para la salida
select pg_temp.como('requerimientos_req');
set local role authenticated;
select test.debe_fallar(format($q$select public.solicitar_revision_salida(%L, %L, 'ok')$q$, pg_temp.txt('rev1'), pg_temp.txt('v1')),
  'el pedido dice qué revisar', 'de 3 a 2000');
select public.solicitar_revision_salida(pg_temp.id('rev1'), pg_temp.id('v1'), '  Revisar   si el cliente pagó el adelanto  ');
select public.solicitar_revision_salida(pg_temp.id('rev1'), pg_temp.id('v1'), 'Revisar si el cliente pagó el adelanto');
select test.debe_fallar(format($q$select public.solicitar_revision_salida(%L, %L, 'Otra vez')$q$, pg_temp.txt('rev2'), pg_temp.txt('v1')),
  'un solo pedido esperando por vehículo', 'Ya hay un pedido');
select test.debe_fallar(format($q$select public.responder_revision_salida(%L, 'ATENDIDA', 'Me lo respondo')$q$, pg_temp.txt('rev1')),
  'Requerimientos no se responde a sí misma', 'tesoreria.liberar');
select test.debe_fallar(format($q$update public.registro_vehiculo_revisiones set estado = 'ATENDIDA' where id = %L$q$, pg_temp.txt('rev1')),
  'ni escribe el pedido por debajo', 'permission denied');
reset role;
select test.afirmar(
  (select count(*) from public.registro_vehiculo_revisiones where registro_id = pg_temp.id('v1')) = 1
  and (select concepto from public.registro_vehiculo_revisiones where id = pg_temp.id('rev1')) = 'Revisar si el cliente pagó el adelanto'
  and pg_temp.avisos('tesoreria_tes', 'Revisar la salida de CHK363') = 1
  and pg_temp.avisos('requerimientos_req', 'Revisar la salida') = 0
  and pg_temp.avisos('gerente_gge', 'Revisar la salida') = 0,
  'el pedido entra una vez, con el texto limpio, y le avisa a Tesorería: no a quien lo pidió ni a Gerencia');

select pg_temp.como('tesoreria_tes');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.revisiones_de_salida_pendientes() where id = pg_temp.id('rev1')) = 1
  and (select codigo_interno from public.revisiones_de_salida_pendientes() where id = pg_temp.id('rev1')) = lower(pg_temp.txt('codigo'))
  and (select escaneo_ruta from public.revisiones_de_salida_pendientes() where id = pg_temp.id('rev1')) = pg_temp.ruta_ficha('v1', 'pdf')
  and (select solicitante from public.revisiones_de_salida_pendientes() where id = pg_temp.id('rev1')) = 'REQUERIMIENTOS Check 363',
  'Tesorería ve lo que la espera: el vehículo, su código, quién lo pidió y el escaneo');
select test.afirmar(
  (select count(*) from public.registro_vehiculo_fichas where registro_id = pg_temp.id('v1')) = 1
  and (select count(*) from storage.objects where bucket_id = 'fichas-vehiculos' and name = pg_temp.ruta_ficha('v1', 'pdf')) = 1
  and (select count(*) from public.control_vehicular_items) = pg_temp.txt('puntos')::integer,
  'y abre la ficha con sus puntos y el escaneo firmado');
select test.debe_fallar(format($q$select public.responder_revision_salida(%L, 'OBSERVADA', 'no')$q$, pg_temp.txt('rev1')),
  'la respuesta dice algo', 'de 3 a 2000');
select test.debe_fallar(format($q$select public.responder_revision_salida(%L, 'PENDIENTE', 'Sigue')$q$, pg_temp.txt('rev1')),
  'queda atendida u observada', 'atendida u observada');
select test.debe_fallar($q$select public.solicitar_revision_salida(gen_random_uuid(), gen_random_uuid(), 'Algo')$q$,
  'Tesorería no pide revisiones', 'vehiculos.registrar');
select public.responder_revision_salida(pg_temp.id('rev1'), 'OBSERVADA', 'Falta el segundo adelanto');
select public.responder_revision_salida(pg_temp.id('rev1'), 'OBSERVADA', 'Falta el segundo adelanto');
select test.debe_fallar(format($q$select public.responder_revision_salida(%L, 'ATENDIDA', 'Ya pagó')$q$, pg_temp.txt('rev1')),
  'un pedido respondido no se vuelve a responder', 'ya tiene respuesta');
select test.afirmar((select count(*) from public.revisiones_de_salida_pendientes() where registro_id = pg_temp.id('v1')) = 0,
  'lo observado sale de la lista de Tesorería');
reset role;
select test.afirmar(
  (select estado = 'OBSERVADA' and atendido_por = pg_temp.id('tesoreria_tes') and atendido_en is not null
     from public.registro_vehiculo_revisiones where id = pg_temp.id('rev1'))
  and pg_temp.avisos('requerimientos_req', 'Tesorería observó la salida de CHK363') = 1,
  'queda observada por Tesorería y Requerimientos se entera');
select test.debe_fallar(format($q$update public.registro_vehiculo_revisiones set respuesta = 'Otra' where id = %L$q$, pg_temp.txt('rev1')),
  'la respuesta no se corrige, ni por el dueño de la tabla', 'ya respondió');
select test.debe_fallar(format($q$delete from public.registro_vehiculo_revisiones where id = %L$q$, pg_temp.txt('rev1')),
  'el pedido no se borra', 'no se borra');
select test.debe_fallar(format($q$delete from public.registro_vehiculo_fichas where registro_id = %L$q$, pg_temp.txt('v1')),
  'la ficha no se borra', 'no se borra');
select test.debe_fallar(format($q$update public.registro_vehiculo_fichas set trabajos = 'Otro' where registro_id = %L$q$, pg_temp.txt('v1')),
  'la ficha con la salida cerrada no cambia, ni por el dueño de la tabla', 'solo admite adjuntar');

-- Observada, Requerimientos la vuelve a pedir y Tesorería la atiende.
select pg_temp.como('requerimientos_req');
set local role authenticated;
select public.solicitar_revision_salida(pg_temp.id('rev2'), pg_temp.id('v1'), 'Ya pagó el segundo adelanto');
reset role;
select pg_temp.como('tesoreria_tes');
set local role authenticated;
select public.responder_revision_salida(pg_temp.id('rev2'), 'ATENDIDA', 'Conforme, puede salir');
reset role;
select test.afirmar(
  (select array_agg(estado order by creado_en, estado) from public.registro_vehiculo_revisiones where registro_id = pg_temp.id('v1'))
    = array['ATENDIDA', 'OBSERVADA']
  and pg_temp.avisos('requerimientos_req', 'Tesorería revisó la salida de CHK363') = 1,
  'el historial del vehículo guarda los dos pedidos, y Requerimientos sabe que puede salir');

-- El vehículo sale: ya no se pide revisión.
select pg_temp.como('requerimientos_req');
set local role authenticated;
select public.registrar_salida_vehiculo(pg_temp.id('v1'), null, 'Sale terminado', jsonb_build_array(pg_temp.foto('v1', 'salida')));
select test.debe_fallar(format($q$select public.solicitar_revision_salida(%L, %L, 'Revisar otra vez')$q$, pg_temp.txt('rev3'), pg_temp.txt('v1')),
  'con el vehículo fuera no se pide revisión', 'ya salió de la planta');
reset role;

-- Supervisión general (vehiculos.ver) consulta la ficha y el historial, sin escribir.
select pg_temp.como('supervisor_general_gop');
set local role authenticated;
select test.afirmar((select count(*) from public.registro_vehiculo_fichas where registro_id = pg_temp.id('v1')) = 1
  and (select count(*) from public.registro_vehiculo_revisiones where registro_id = pg_temp.id('v1')) = 2
  and (select count(*) from public.control_vehicular_items) = pg_temp.txt('puntos')::integer,
  'Supervisión general ve la ficha, sus puntos y el historial de revisiones');
select test.debe_fallar(format($q$select public.guardar_ficha_vehiculo(%L, 'GUARDAR', '{}')$q$, pg_temp.txt('v2')),
  'pero no llena fichas', 'vehiculos.registrar');
select test.debe_fallar('select * from public.revisiones_de_salida_pendientes()', 'ni ve la bandeja de Tesorería', 'tesoreria.liberar');
reset role;

select pg_temp.como('vendedor_gco');
set local role authenticated;
select test.afirmar((select count(*) from public.registro_vehiculo_revisiones where registro_id = pg_temp.id('v1')) = 0,
  'Ventas no ve las revisiones');
reset role;

rollback;
