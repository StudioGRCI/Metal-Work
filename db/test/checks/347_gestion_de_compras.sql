-- Gestión de compras (migración 20261015140000): Logística programa qué OC
-- recoge el conductor, en qué orden y con qué peso; Contabilidad carga la guía
-- de remisión, desde Adquisiciones desde la migración 20261020171000, que deja
-- la gestión para Logística y el conductor; el conductor sale solo con lo
-- programado y ve su guía. Cada paso con el rol que lo da —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
begin;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['REQUERIMIENTOS:REQ', 'COMPRADOR:LOG', 'ALMACENERO:ALM', 'GERENTE:GER',
                           'CONDUCTOR:LOG', 'CONTABILIDAD:CON', 'TESORERIA:TES', 'SUPERVISOR:MTZ'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.347@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 347', lower(replace(v, ':', '.')) || '.347@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.area_mtz', (select id::text from public.areas where codigo = 'MTZ'), true);
  perform set_config('prueba.und', (select id::text from public.unidades_medida where codigo = 'UND'), true);
  perform set_config('prueba.cat', (select id::text from public.categorias_material
                                     where activo and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1), true);
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK347-PLA', 'Plancha LAF 2 mm 4x8 (347)', current_setting('prueba.cat')::uuid, current_setting('prueba.und')::uuid)
  returning id::text into v;
  perform set_config('prueba.mat', v, true);
  insert into public.proveedores (numero_documento, razon_social, direccion, telefono)
  values ('20600000340', 'Proveedor de prueba 347', 'Av. Argentina 347, Lima', '999 347 347')
  returning id::text into v;
  perform set_config('prueba.proveedor', v, true);
  perform set_config('prueba.rq', gen_random_uuid()::text, true);
  perform set_config('prueba.oc1', gen_random_uuid()::text, true);
  perform set_config('prueba.oc2', gen_random_uuid()::text, true);
  perform set_config('prueba.oc3', gen_random_uuid()::text, true);
  perform set_config('prueba.guia', gen_random_uuid()::text, true);
  perform set_config('prueba.guia2', gen_random_uuid()::text, true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp.generar(p_oc text, p_items smallint[]) returns uuid language sql as $$
  select public.emitir_compra_del_requerimiento(current_setting('prueba.' || p_oc)::uuid, current_setting('prueba.rq')::uuid, p_items,
    current_setting('prueba.proveedor')::uuid, null,
    jsonb_build_array(jsonb_build_object('material_id', current_setting('prueba.mat'), 'cantidad', 3, 'precio', 120.50)),
    null, 'CONTADO', 0, 'PEN', true);
$$;

-- El lugar de una OC en la lista del conductor, leído con la sesión puesta.
create or replace function pg_temp.lugar(p_oc text) returns integer language sql as $$
  select g.lugar from public.compras_en_gestion() g where g.id = current_setting('prueba.' || p_oc)::uuid;
$$;
create or replace function pg_temp.avisos(p_clave text, p_titulo text) returns integer language sql as $$
  select count(*)::integer from public.notificaciones
   where usuario_id = current_setting('prueba.' || p_clave)::uuid and titulo like p_titulo || '%';
$$;
-- Lo que hace Storage al subir: anota el objeto con su dueño, tipo y tamaño.
create or replace function pg_temp.subir_pdf(p_oc text, p_guia text, p_dueno text) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata)
  values ('guias-remision',
          'compra/' || current_setting('prueba.' || p_oc) || '/' || current_setting('prueba.' || p_guia) || '.pdf',
          current_setting('prueba.' || p_dueno)::uuid, current_setting('prueba.' || p_dueno),
          jsonb_build_object('mimetype', 'application/pdf', 'size', 48211));
$$;

-- ============================================ 1. Un RQ sin stock con tres OC, aprobadas
select pg_temp.como('requerimientos');
set local role authenticated;
select public.emitir_requerimiento(current_setting('prueba.rq')::uuid, current_setting('prueba.area_mtz')::uuid,
  'PLA_SR_O4_1_26/28', 'Armado del chasis de la plataforma 28', null,
  (select jsonb_agg(jsonb_build_object('descripcion', d, 'cantidad', 3,
          'unidad_medida_id', current_setting('prueba.und'), 'categoria_id', current_setting('prueba.cat')))
     from unnest(array['Plancha LAF 2 mm 4x8', 'Tubo LAC 2x2', 'Ángulo 1/8 x 1']) d));
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select public.rq_marcar_sin_stock(current_setting('prueba.rq')::uuid, 'No hay nada de esto');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select pg_temp.generar('oc1', array[1]::smallint[]);
select pg_temp.generar('oc2', array[2]::smallint[]);
select pg_temp.generar('oc3', array[3]::smallint[]);
set constraints all immediate;
reset role;
select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(current_setting('prueba.oc1')::uuid);
select public.aprobar_compra(current_setting('prueba.oc2')::uuid);
select public.aprobar_compra(current_setting('prueba.oc3')::uuid);
reset role;

select test.afirmar(
  (select count(*) from public.ordenes_compra_materiales
    where id in (current_setting('prueba.oc1')::uuid, current_setting('prueba.oc2')::uuid, current_setting('prueba.oc3')::uuid)
      and recojo = 'POR_RECOGER') = 3,
  'aprobadas, las tres quedan pendientes de recojo, como antes');
select test.afirmar(
  (select count(*) from public.notificaciones where usuario_id = current_setting('prueba.comprador')::uuid
      and titulo like 'Compra aprobada%' and ruta = '/compras/gestion') = 3
  and pg_temp.avisos('comprador', 'Programa el recojo') = 0 and pg_temp.avisos('conductor', 'Recojo') = 0,
  'a quien las emitió le llega un solo aviso por OC, el de aprobada, que lo lleva a programarla; al conductor, nada');

-- ============================================ 2. Sin programar, el conductor no sale
select pg_temp.como('conductor');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.compras_en_gestion() g where g.recojo = 'POR_RECOGER' and not g.en_lista and g.lugar is null
     and g.id in (current_setting('prueba.oc1')::uuid, current_setting('prueba.oc2')::uuid, current_setting('prueba.oc3')::uuid)) = 3,
  'el conductor las ve fuera de su lista');
select test.debe_fallar($q$select public.marcar_compra_en_recojo(current_setting('prueba.oc1')::uuid)$q$,
  'no sale a recoger lo que Logística no programó', 'todavía no programa');
select test.debe_fallar($q$select public.marcar_compra_recogida(current_setting('prueba.oc1')::uuid)$q$,
  'ni la marca recogida directo', 'todavía no programa');
select test.debe_fallar($q$select public.programar_recojo(current_setting('prueba.oc1')::uuid, 100, null)$q$,
  'el conductor no se programa solo');
reset role;

select pg_temp.como('contabilidad');
set local role authenticated;
select test.debe_fallar($q$select public.programar_recojo(current_setting('prueba.oc1')::uuid, 100, null)$q$,
  'Contabilidad no programa el recojo');
reset role;
select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar($q$select count(*) from public.compras_en_gestion()$q$, 'Almacén no ve la gestión', 'No tienes permiso para ver la gestión de compras');
select test.afirmar((select count(*) from public.programacion_recojo) = 0, 'ni lee la lista del conductor');
reset role;
select pg_temp.como('supervisor');
set local role authenticated;
select test.debe_fallar($q$select count(*) from public.compras_en_gestion()$q$, 'Supervisión tampoco', 'No tienes permiso para ver la gestión de compras');
reset role;

-- ============================================ 3. Logística programa: peso y lugar
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($q$select public.programar_recojo(current_setting('prueba.oc1')::uuid, 0, null)$q$,
  'sin peso no se programa', 'peso');
select test.afirmar(public.programar_recojo(current_setting('prueba.oc1')::uuid, 350.456, null) = 1, 'la primera va 1.ª');
select test.afirmar(public.programar_recojo(current_setting('prueba.oc2')::uuid, 120, null) = 2, 'la segunda, al final: 2.ª');
select test.afirmar(public.programar_recojo(current_setting('prueba.oc3')::uuid, 80, 1) = 1, 'la tercera, puesta primera');
select test.afirmar(pg_temp.lugar('oc3') = 1 and pg_temp.lugar('oc1') = 2 and pg_temp.lugar('oc2') = 3,
  'y las demás se corren: 3.ª, 1.ª, 2.ª pasan a 1, 2 y 3');
select public.programar_recojo(current_setting('prueba.oc2')::uuid, 120, 1);
select test.afirmar(pg_temp.lugar('oc2') = 1 and pg_temp.lugar('oc3') = 2 and pg_temp.lugar('oc1') = 3, 'subir la última a primera');
select public.programar_recojo(current_setting('prueba.oc2')::uuid, 120, 99);
select test.afirmar(pg_temp.lugar('oc3') = 1 and pg_temp.lugar('oc1') = 2 and pg_temp.lugar('oc2') = 3, 'un lugar de más la deja al final');
select public.programar_recojo(current_setting('prueba.oc2')::uuid, 120, 1);
select test.afirmar((select peso_kg from public.compras_en_gestion() where id = current_setting('prueba.oc1')::uuid) = 350.46,
  'el peso se guarda en kilos con dos decimales');
reset role;

select test.afirmar(pg_temp.avisos('conductor', 'Recojo programado') = 3,
  'al conductor le llega un aviso por OC, solo la primera vez que se programa');
select test.afirmar(pg_temp.avisos('contabilidad', 'Guía de remisión por emitir') = 3
    and (select count(*) from public.notificaciones where usuario_id = current_setting('prueba.contabilidad')::uuid
          and titulo like 'Guía de remisión por emitir%' and ruta = '/adquisiciones?situacion=guia') = 3,
  'y a Contabilidad, para emitir la guía desde Adquisiciones');
select test.afirmar(pg_temp.avisos('comprador', 'Recojo programado') = 0, 'a quien programa no le llega su propio aviso');

-- Quitar de la lista: el peso se queda y las demás se corren.
select pg_temp.como('comprador');
set local role authenticated;
select public.quitar_recojo_de_la_lista(current_setting('prueba.oc3')::uuid);
select public.quitar_recojo_de_la_lista(current_setting('prueba.oc3')::uuid);  -- el segundo toque no cambia nada
select test.afirmar(pg_temp.lugar('oc2') = 1 and pg_temp.lugar('oc1') = 2 and pg_temp.lugar('oc3') is null, 'fuera de la lista y las demás se corren');
select test.afirmar((select not en_lista and peso_kg = 80 from public.compras_en_gestion() where id = current_setting('prueba.oc3')::uuid),
  'la que salió conserva su peso');
reset role;
select test.afirmar(pg_temp.avisos('conductor', 'Recojo retirado') = 1, 'al conductor le avisan que salió de su lista');
select pg_temp.como('conductor');
set local role authenticated;
select test.debe_fallar($q$select public.marcar_compra_en_recojo(current_setting('prueba.oc3')::uuid)$q$,
  'lo que salió de la lista ya no se sale a recoger', 'todavía no programa');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(public.programar_recojo(current_setting('prueba.oc3')::uuid, 80, null) = 3, 'vuelve a la lista, al final');
reset role;
select test.afirmar(pg_temp.avisos('conductor', 'Recojo programado') = 4, 'volver a la lista cuenta como programarla de nuevo');

-- ============================================ 4. Contabilidad carga la guía
-- Storage en el banco no tiene RLS: se enciende aquí para probar sus políticas.
alter table storage.objects enable row level security;
grant select, insert on storage.objects to authenticated;

select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($q$select pg_temp.subir_pdf('oc2', 'guia', 'comprador')$q$, 'Logística no sube guías de remisión', 'row-level security');
reset role;
select pg_temp.como('contabilidad');
set local role authenticated;
select pg_temp.subir_pdf('oc2', 'guia', 'contabilidad');
select test.afirmar(
  (select count(*) from storage.objects where bucket_id = 'guias-remision'
      and name like 'compra/' || current_setting('prueba.oc2') || '/%') = 1,
  'Contabilidad sube el PDF y lo ve para comprobarlo');
select test.debe_fallar($q$select public.cargar_guia_remision(current_setting('prueba.guia')::uuid, current_setting('prueba.oc2')::uuid,
    'T001-123', (now() at time zone 'America/Lima')::date + 1, 'guia.pdf')$q$,
  'la fecha de emisión no va al futuro', 'posterior a hoy');
select test.debe_fallar($q$select public.cargar_guia_remision(current_setting('prueba.guia')::uuid, current_setting('prueba.oc2')::uuid,
    'guía 123', (now() at time zone 'America/Lima')::date, 'guia.pdf')$q$,
  'el número va con serie y número', 'serie y número');
select test.debe_fallar($q$select public.cargar_guia_remision(current_setting('prueba.guia2')::uuid, current_setting('prueba.oc2')::uuid,
    'T001-123', (now() at time zone 'America/Lima')::date, 'guia.pdf')$q$,
  'sin el PDF subido no se registra', 'no terminó de subir');
select public.cargar_guia_remision(current_setting('prueba.guia')::uuid, current_setting('prueba.oc2')::uuid,
  ' t001-00000123 ', (now() at time zone 'America/Lima')::date, 'guia-t001-123.pdf');
select public.cargar_guia_remision(current_setting('prueba.guia')::uuid, current_setting('prueba.oc2')::uuid,
  'T001-00000123', (now() at time zone 'America/Lima')::date, 'guia-t001-123.pdf');  -- respuesta perdida: no duplica
-- Con otra fecha o con el PDF de otro nombre ya no es el mismo envío: se cambió
-- antes de volver a pulsar, y la ventana no puede cerrarse como si hubiera
-- entrado (migración 20261022180000).
select test.debe_fallar($q$select public.cargar_guia_remision(current_setting('prueba.guia')::uuid, current_setting('prueba.oc2')::uuid,
    'T001-00000123', (now() at time zone 'America/Lima')::date - 1, 'guia-t001-123.pdf')$q$,
  'con otra fecha y el mismo id, la guía no se da por cargada', 'ya quedó cargada la primera vez que la enviaste');
select test.debe_fallar($q$select public.cargar_guia_remision(current_setting('prueba.guia')::uuid, current_setting('prueba.oc2')::uuid,
    'T001-00000123', (now() at time zone 'America/Lima')::date, 'otra-guia.pdf')$q$,
  'ni con el PDF de otro nombre', 'ya quedó cargada la primera vez que la enviaste');
select test.afirmar(
  (select numero = 'T001-00000123' from public.guias_remision_compra
    where orden_compra_id = current_setting('prueba.oc2')::uuid and anulada_en is null and id = current_setting('prueba.guia')::uuid)
  and (select count(*) from public.guias_remision_compra where orden_compra_id = current_setting('prueba.oc2')::uuid) = 1,
  'la guía queda en la OC, con el número en mayúsculas y sin espacios');
select pg_temp.subir_pdf('oc2', 'guia2', 'contabilidad');
select test.debe_fallar($q$select public.cargar_guia_remision(current_setting('prueba.guia2')::uuid, current_setting('prueba.oc2')::uuid,
    'T001-00000124', (now() at time zone 'America/Lima')::date, 'otra.pdf')$q$,
  'una OC, una guía vigente', 'ya tiene la guía');
reset role;
select test.afirmar(pg_temp.avisos('conductor', 'Guía de remisión lista') = 1, 'al conductor le avisan que su guía está lista');

-- La ven el conductor y Logística, con el PDF, y quien lee Adquisiciones; Supervisión no.
select pg_temp.como('conductor');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.guias_remision_compra where id = current_setting('prueba.guia')::uuid) = 1
  and (select count(*) from storage.objects where bucket_id = 'guias-remision'
         and name = 'compra/' || current_setting('prueba.oc2') || '/' || current_setting('prueba.guia') || '.pdf') = 1,
  'el conductor ve la guía y su PDF');
select test.afirmar(
  (select count(*) from storage.objects where bucket_id = 'guias-remision'
         and name = 'compra/' || current_setting('prueba.oc2') || '/' || current_setting('prueba.guia2') || '.pdf') = 0,
  'pero no el PDF suelto que nadie registró');
reset role;
select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar(
  (select count(*) from public.guias_remision_compra) = 0
  and (select count(*) from storage.objects where bucket_id = 'guias-remision') = 0,
  'Supervisión no ve guías ni sus PDF');
reset role;
select pg_temp.como('tesoreria');
set local role authenticated;
select test.afirmar((select count(*) from public.guias_remision_compra where id = current_setting('prueba.guia')::uuid) = 1,
  'Tesorería la ve en Adquisiciones');
reset role;

-- Con la guía emitida, el peso ya no cambia; el lugar sí.
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar($q$select public.programar_recojo(current_setting('prueba.oc2')::uuid, 150, 1)$q$,
  'con la guía emitida el peso no cambia', 'anularla primero');
select test.afirmar(public.programar_recojo(current_setting('prueba.oc2')::uuid, 120, 2) = 2, 'el lugar sí se cambia');
select test.debe_fallar($q$select public.anular_guia_remision(current_setting('prueba.guia')::uuid, 'Peso mal escrito')$q$,
  'Logística no anula la guía');
reset role;

-- ============================================ 5. El conductor sale con lo programado
select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_en_recojo(current_setting('prueba.oc2')::uuid);
reset role;
select test.afirmar((select recojo from public.ordenes_compra_materiales where id = current_setting('prueba.oc2')::uuid) = 'EN_RECOJO',
  'programada, el conductor sale a recogerla');
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(pg_temp.lugar('oc2') is null and pg_temp.lugar('oc1') = 1 and pg_temp.lugar('oc3') = 2,
  'en recojo ya no cuenta en la lista: las pendientes suben');
select test.debe_fallar($q$select public.programar_recojo(current_setting('prueba.oc2')::uuid, 120, 1)$q$,
  'en recojo ya no se reprograma', 'ya salió');
select test.debe_fallar($q$select public.quitar_recojo_de_la_lista(current_setting('prueba.oc2')::uuid)$q$,
  'ni se saca de la lista', 'ya salió');
reset role;

-- ============================================ 6. Anular la guía: con motivo, y queda
select pg_temp.como('contabilidad');
set local role authenticated;
select test.debe_fallar($q$select public.anular_guia_remision(current_setting('prueba.guia')::uuid, 'mal')$q$,
  'sin motivo no se anula', 'por qué');
select public.anular_guia_remision(current_setting('prueba.guia')::uuid, 'Se emitió con el punto de llegada equivocado');
select test.afirmar(
  (select count(*) filter (where anulada_en is null) = 0 and count(*) filter (where anulada_en is not null) = 1
     from public.guias_remision_compra where orden_compra_id = current_setting('prueba.oc2')::uuid),
  'anulada, la OC queda sin guía vigente y cuenta la anulada');
select public.cargar_guia_remision(current_setting('prueba.guia2')::uuid, current_setting('prueba.oc2')::uuid,
  'T001-00000124', (now() at time zone 'America/Lima')::date, 'guia-t001-124.pdf');
select test.afirmar(
  (select numero = 'T001-00000124' from public.guias_remision_compra
    where orden_compra_id = current_setting('prueba.oc2')::uuid and anulada_en is null),
  'y se carga la buena');
reset role;
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(
  (select guia_numero = 'T001-00000124' and guias_anuladas = 1 from public.compras_en_gestion()
    where id = current_setting('prueba.oc2')::uuid),
  'y Logística la ve en la gestión, con la anulada contada');
reset role;
select test.afirmar(pg_temp.avisos('conductor', 'Guía de remisión anulada') = 1, 'al conductor le avisan que la guía ya no vale');
select test.debe_fallar(
  $q$update public.guias_remision_compra set numero = 'T001-00000999' where id = current_setting('prueba.guia2')::uuid$q$,
  'una guía cargada no se corrige', 'no se corrige');
select test.debe_fallar(
  $q$update public.guias_remision_compra set motivo_anulacion = 'otro motivo' where id = current_setting('prueba.guia')::uuid$q$,
  'la anulada queda como evidencia', 'evidencia');
select test.debe_fallar(
  $q$delete from public.guias_remision_compra where id = current_setting('prueba.guia')::uuid$q$,
  'una guía no se borra', 'no se borra');

-- ============================================ 7. El avance del RQ sigue igual
select pg_temp.como('supervisor');
set local role authenticated;
select test.afirmar(
  (select l->>'etapa' from public.avance_de_requerimientos(array[current_setting('prueba.rq')::uuid]) a,
          jsonb_array_elements(a.lineas) l where (l->>'item')::int = 2) = 'EN_RECOJO'
  and (select l->>'etapa' from public.avance_de_requerimientos(array[current_setting('prueba.rq')::uuid]) a,
          jsonb_array_elements(a.lineas) l where (l->>'item')::int = 1) = 'PENDIENTE_RECOJO',
  'el RQ sigue mostrando pendiente de recojo y en recojo, como antes');
reset role;

do $$ begin raise notice 'OK 347: Logística programa el recojo, Contabilidad carga la guía y el conductor sale con ella'; end $$;
rollback;
