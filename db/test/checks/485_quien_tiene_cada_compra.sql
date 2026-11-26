-- Quién tiene cada compra y por qué se atrasó (migración 20261126462000, Plan
-- 4.2). Con la cuenta de cada puesto —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
--
-- Logística emite tres OC directas y una OS; Gerencia las aprueba.
--   1. El recorrido de la OC dice quién la tiene en cada paso: Gerencia,
--      Logística (programar), Contabilidad (la guía) a la par del conductor,
--      Almacén (validar) y, al final, completa.
--   2. Logística anota el motivo de la OC atrasada. El mismo envío repetido da
--      lo mismo; con otro contenido, el primero queda. Almacén no anota; la OC
--      que no está atrasada tampoco; «Otro» lleva nota.
--   3. Logística corrige la fecha prometida de la OC que no llegó: el plazo
--      cuenta contra la nueva, la anterior queda en el recorrido y la OC no
--      cambia. La OC completa, o la que llegó entera y espera la validación de
--      Almacén, ya no se corrige.
--   4. Lo anotado no se corrige ni se borra, ni como dueño; nadie inserta directo.
--   5. La OS: el proveedor la tiene; su motivo y su fecha, igual.
--   6. Lo leen Logística y Gerencia; Ventas no; sin sesión, nadie.
\set ON_ERROR_STOP on
begin;
set local timezone = 'UTC';

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['COMPRADOR:LOG', 'GERENTE:GGE', 'CONDUCTOR:LOG', 'ALMACENERO:ALM', 'VENDEDOR:VEN'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.485@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 485', lower(replace(v, ':', '.')) || '.485@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform test.afirmar((select count(*) from public.usuarios where apellidos = 'Check 485') = 5,
    'se crearon los cinco usuarios del check, uno por puesto');
  foreach v in array array['oc1', 'oc2', 'oc3', 'os1', 'mot1', 'mot2', 'fec1', 'fec2', 'mov3'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', current_setting('prueba.' || p_clave), true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', current_setting('prueba.' || p_clave), 'role', 'authenticated')::text, true);
end $$;
create or replace function pg_temp.id(p text) returns uuid language sql as $$ select current_setting('prueba.' || p)::uuid $$;
create or replace function pg_temp.hoy() returns date language sql as $$ select (now() at time zone 'America/Lima')::date $$;
-- Quién tiene la OC ahora (el primer paso que espera) y qué se espera de él.
create or replace function pg_temp.ahora(p text, p_os boolean default false) returns text language sql as $$
  select string_agg(r.paso || ':' || r.puesto || ':' || r.espera, ' + ' order by r.orden)
    from (select * from public.recorrido_de_ordenes_compra(array[pg_temp.id(p)]) where not p_os
          union all
          select * from public.recorrido_de_ordenes_servicio(array[pg_temp.id(p)]) where p_os) r
   where r.situacion = 'AHORA'
$$;

-- Armazón, como dueño: un material y un proveedor con un RUC inventado.
do $$
declare
  v_cat uuid := (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1);
  v_um  uuid := (select id from public.unidades_medida where codigo = 'UND');
  v_m uuid;
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK485-1', 'Disco de corte de prueba 485', v_cat, v_um) returning id into v_m;
  perform set_config('prueba.disco', v_m::text, true);
  insert into public.proveedores (id, numero_documento, razon_social)
  select gen_random_uuid(), r, 'PROVEEDOR DE PRUEBA 485'
    from (select '2069' || lpad(n::text, 6, '0') || d::text as r from generate_series(485000, 485200) n, generate_series(0, 9) d) x
   where public.ruc_es_valido(r)
   order by r limit 1
  on conflict (tipo_documento, numero_documento) do update set activo = true;
  perform set_config('prueba.proveedor', (select id::text from public.proveedores where razon_social = 'PROVEEDOR DE PRUEBA 485'), true);
end $$;

select pg_temp.como('comprador');
set local role authenticated;
do $$
declare v text;
begin
  foreach v in array array['oc1', 'oc2', 'oc3'] loop
    perform public.emitir_compra_directa(pg_temp.id(v), pg_temp.id('proveedor'), 'COT-485-' || v, 'Discos para el almacén',
      jsonb_build_array(jsonb_build_object('material_id', pg_temp.id('disco'), 'cantidad', 5, 'precio', 8)),
      pg_temp.hoy() + 3, 'CONTADO', 0, 'PEN', true, 'PLANTA');
  end loop;
  perform public.emitir_orden_servicio(pg_temp.id('os1'), pg_temp.id('proveedor'), null, (select id from public.areas where codigo = 'ACB'),
    'PLANTA', 'Torneado de ejes, prueba 485', null, pg_temp.hoy(), pg_temp.hoy() + 5, 'PEN', 500, 'CONTADO', 0, '025', null);
end $$;
reset role;
set constraints all immediate;
set constraints all deferred;

-- Las fechas pasan: como dueño se corren hacia atrás, como si se hubieran emitido antes.
update public.ordenes_compra_materiales set fecha_estimada = pg_temp.hoy() - 3, creado_en = now() - interval '10 days'
 where id in (pg_temp.id('oc1'), pg_temp.id('oc3'));
update public.ordenes_servicio set fecha_inicio = pg_temp.hoy() - 10, fecha_fin = pg_temp.hoy() - 2
 where id = pg_temp.id('os1');

-- ============================================ 1. Quién la tiene, paso a paso
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(pg_temp.ahora('oc1') = 'APROBACION:Gerencia:APROBACION',
  format('la OC por aprobar la tiene Gerencia (dice %s)', pg_temp.ahora('oc1')));
select test.afirmar(pg_temp.ahora('os1', true) = 'APROBACION:Gerencia:APROBACION',
  format('la OS por aprobar la tiene Gerencia (dice %s)', pg_temp.ahora('os1', true)));
reset role;

select pg_temp.como('gerente');
set local role authenticated;
select public.aprobar_compra(pg_temp.id('oc1'));
select public.aprobar_compra(pg_temp.id('oc2'));
select public.aprobar_compra(pg_temp.id('oc3'));
select public.aprobar_orden_servicio(pg_temp.id('os1'));
reset role;

select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(pg_temp.ahora('oc1') = 'PROGRAMACION:Logística:PROGRAMAR',
  format('aprobada, la OC la tiene Logística para programar el recojo (dice %s)', pg_temp.ahora('oc1')));
select test.afirmar(not exists (select 1 from public.recorrido_de_ordenes_compra(array[pg_temp.id('oc1')]) r where r.paso = 'MANDADA_A_RECOJO'),
  'al aprobarla queda mandada a recojo sola: no es un paso aparte');
select test.afirmar(pg_temp.ahora('os1', true) = 'INICIO:Logística:INICIAR',
  format('aprobada, la OS la tiene Logística para iniciarla (dice %s)', pg_temp.ahora('os1', true)));
select public.programar_recojo(pg_temp.id('oc1'), 25, null);
select public.programar_recojo(pg_temp.id('oc3'), 10, null);
select test.afirmar(pg_temp.ahora('oc1') = 'GUIA:Contabilidad:GUIA + SALIDA:Conductor de Logística:SALIR',
  format('programada, la tienen Contabilidad (la guía) y el conductor, la guía primero (dice %s)', pg_temp.ahora('oc1')));
select public.avanzar_orden_servicio(pg_temp.id('os1'), 'EN_EJECUCION', null);
select test.afirmar(pg_temp.ahora('os1', true) = 'EJECUCION:el proveedor:EJECUTAR',
  format('en ejecución, la OS la tiene el proveedor (dice %s)', pg_temp.ahora('os1', true)));
select test.afirmar((select r.puesto from public.recorrido_de_ordenes_servicio(array[pg_temp.id('os1')]) r where r.paso = 'INICIO')
                    = (select public.puesto_de(pg_temp.id('comprador'))),
  'quién inició la OS sale de la bitácora: Logística');
reset role;

select pg_temp.como('conductor');
set local role authenticated;
select public.marcar_compra_recogida(pg_temp.id('oc1'));
select public.marcar_compra_dejada_almacen(pg_temp.id('oc1'));
select public.marcar_compra_recogida(pg_temp.id('oc3'));
select public.marcar_compra_dejada_almacen(pg_temp.id('oc3'));
reset role;

select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(pg_temp.ahora('oc1') = 'VALIDACION:Almacén:VALIDAR',
  format('dejada, la OC la tiene Almacén para validar (dice %s)', pg_temp.ahora('oc1')));
select test.afirmar((select r.dias from public.recorrido_de_ordenes_compra(array[pg_temp.id('oc1')]) r where r.situacion = 'AHORA') = 0,
  'lleva 0 días esperando a Almacén');
reset role;

-- La tercera la valida Almacén entera: completa, con 3 días de atraso.
select set_config('prueba.ingresos3', (
  select jsonb_agg(jsonb_build_object('id', i.id, 'movimiento_id', pg_temp.id('mov3'), 'cantidad', i.cantidad))
    from public.ingresos_pendientes_almacen i where i.orden_compra_id = pg_temp.id('oc3'))::text, true);
select pg_temp.como('almacenero');
set local role authenticated;
select public.validar_ingresos_compra(pg_temp.id('oc3'), current_setting('prueba.ingresos3')::jsonb, null);
reset role;

select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(pg_temp.ahora('oc3') is null, 'la OC completa ya no la tiene nadie');
select test.afirmar((select string_agg(r.paso, ',' order by r.orden) from public.recorrido_de_ordenes_compra(array[pg_temp.id('oc3')]) r)
                    = 'EMISION,APROBACION,PROGRAMACION,RECOGIDA,DEJADA,VALIDACION,COMPLETA',
  format('el recorrido de la OC completa (dice %s)',
         (select string_agg(r.paso, ',' order by r.orden) from public.recorrido_de_ordenes_compra(array[pg_temp.id('oc3')]) r)));
select test.afirmar((select r.puesto from public.recorrido_de_ordenes_compra(array[pg_temp.id('oc3')]) r where r.paso = 'VALIDACION')
                    = public.puesto_de(pg_temp.id('almacenero'))
                    and (select r.puesto from public.recorrido_de_ordenes_compra(array[pg_temp.id('oc3')]) r where r.paso = 'COMPLETA') = 'Almacén',
  'la validación lleva el puesto de quien validó, y la completa es de Almacén');
reset role;

-- ============================================ 2. El motivo del atraso
select pg_temp.como('comprador');
set local role authenticated;
select test.afirmar(public.anotar_motivo_atraso(pg_temp.id('mot1'), 'OC', pg_temp.id('oc1'), 'PROVEEDOR', '  El proveedor no tenía stock  ')
                    = pg_temp.id('mot1'), 'Logística anota el motivo de la OC atrasada');
select test.afirmar(public.anotar_motivo_atraso(pg_temp.id('mot1'), 'OC', pg_temp.id('oc1'), 'PROVEEDOR', 'El proveedor no tenía stock')
                    = pg_temp.id('mot1'), 'el mismo envío repetido da lo mismo');
select test.debe_fallar(format('select public.anotar_motivo_atraso(%L, ''OC'', %L, ''PAGO'', null)', pg_temp.id('mot1'), pg_temp.id('oc1')),
  'el mismo id con otro contenido no se guarda: el primero queda', 'primera vez');
select test.debe_fallar(format('select public.anotar_motivo_atraso(%L, ''OC'', %L, ''PROVEEDOR'', null)', gen_random_uuid(), pg_temp.id('oc2')),
  'la OC que no está atrasada no lleva motivo', 'no está atrasada');
select test.debe_fallar(format('select public.anotar_motivo_atraso(%L, ''OC'', %L, ''OTRO'', ''corto'')', gen_random_uuid(), pg_temp.id('oc1')),
  '«Otro» lleva su nota', 'Otro');
select test.debe_fallar(format('select public.anotar_motivo_atraso(%L, ''OC'', %L, ''CLIMA'', null)', gen_random_uuid(), pg_temp.id('oc1')),
  'el motivo sale de la lista corta', 'Elige el motivo');
-- La OC que llegó tarde también lleva su motivo.
select test.afirmar(public.anotar_motivo_atraso(pg_temp.id('mot2'), 'OC', pg_temp.id('oc3'), 'TRANSPORTE', null) = pg_temp.id('mot2'),
  'la OC que llegó con atraso también lleva motivo');
select test.afirmar((select count(*) from public.seguimiento_de_compras where orden_compra_id = pg_temp.id('oc1')) = 1,
  'el envío repetido dejó una sola fila');
select test.afirmar((select s.nota = 'El proveedor no tenía stock' and s.registrado_por = pg_temp.id('comprador') and s.registrado_en is not null
                       from public.seguimiento_de_compras s where s.id = pg_temp.id('mot1')),
  'el motivo guarda la nota sin espacios de más, quién y cuándo');
select test.afirmar((select r.detalle from public.recorrido_de_ordenes_compra(array[pg_temp.id('oc1')]) r where r.paso = 'MOTIVO_ATRASO')
                    = 'PROVEEDOR|El proveedor no tenía stock', 'el motivo sale en el recorrido, con su nota');
reset role;

select pg_temp.como('almacenero');
set local role authenticated;
select test.debe_fallar(format('select public.anotar_motivo_atraso(%L, ''OC'', %L, ''PROVEEDOR'', null)', gen_random_uuid(), pg_temp.id('oc1')),
  'Almacén, que solo consulta las compras, no anota el motivo', 'permiso');
reset role;

-- ============================================ 3. La fecha corregida
select pg_temp.como('comprador');
set local role authenticated;
select public.corregir_fecha_esperada(pg_temp.id('fec1'), 'OC', pg_temp.id('oc2'), pg_temp.hoy() + 2, 'PROVEEDOR', 'Avisó que llega el lunes');
select test.afirmar(public.corregir_fecha_esperada(pg_temp.id('fec1'), 'OC', pg_temp.id('oc2'), pg_temp.hoy() + 2, 'PROVEEDOR', 'Avisó que llega el lunes')
                    = pg_temp.id('fec1'), 'la misma corrección repetida da lo mismo');
do $$
declare r record;
begin
  select * into r from public.plazos_de_compras(array[pg_temp.id('oc2')]);
  perform test.afirmar(r.esperada = pg_temp.hoy() + 2 and not r.atrasada and r.dias_atraso = 0,
    format('el plazo cuenta contra la fecha nueva (esperada %s, %s días)', r.esperada, r.dias_atraso));
end $$;
select test.afirmar((select fecha_estimada from public.ordenes_compra_materiales where id = pg_temp.id('oc2')) = pg_temp.hoy() + 3,
  'la OC no cambia: su fecha de emisión queda como salió en el documento');
select public.corregir_fecha_esperada(pg_temp.id('fec2'), 'OC', pg_temp.id('oc2'), pg_temp.hoy() + 4, 'TRANSPORTE', null);
select test.afirmar((select s.fecha_anterior from public.seguimiento_de_compras s where s.id = pg_temp.id('fec2')) = pg_temp.hoy() + 2,
  'la segunda corrección guarda como anterior la primera corregida');
select test.afirmar((select string_agg(r.detalle, ' ; ' order by r.orden) from public.recorrido_de_ordenes_compra(array[pg_temp.id('oc2')]) r
                      where r.paso = 'FECHA_CORREGIDA')
                    = format('%s>%s|PROVEEDOR|Avisó que llega el lunes ; %s>%s|TRANSPORTE|',
                             pg_temp.hoy() + 3, pg_temp.hoy() + 2, pg_temp.hoy() + 2, pg_temp.hoy() + 4),
  'las dos fechas anteriores quedan en el recorrido');
select test.debe_fallar(format('select public.corregir_fecha_esperada(%L, ''OC'', %L, %L, ''PROVEEDOR'', null)',
                               gen_random_uuid(), pg_temp.id('oc2'), pg_temp.hoy() + 4),
  'la misma fecha que ya tiene no se corrige', 'ya tiene esa fecha');
select test.debe_fallar(format('select public.corregir_fecha_esperada(%L, ''OC'', %L, %L, ''PROVEEDOR'', null)',
                               gen_random_uuid(), pg_temp.id('oc2'), pg_temp.hoy() - 30),
  'no antes de emitirla', 'anterior al');
select test.debe_fallar(format('select public.corregir_fecha_esperada(%L, ''OC'', %L, %L, ''PROVEEDOR'', null)',
                               gen_random_uuid(), pg_temp.id('oc2'), pg_temp.hoy() + 400),
  'como mucho a un año', 'un año');
select test.debe_fallar(format('select public.corregir_fecha_esperada(%L, ''OC'', %L, %L, ''PROVEEDOR'', null)',
                               gen_random_uuid(), pg_temp.id('oc3'), pg_temp.hoy() + 1),
  'la OC que llegó completa ya no se corrige', 'llegó completa');
select test.debe_fallar(format('select public.corregir_fecha_esperada(%L, ''OC'', %L, %L, ''PROVEEDOR'', null)',
                               gen_random_uuid(), pg_temp.id('oc1'), pg_temp.hoy() + 1),
  'la OC que llegó entera y espera la validación de Almacén ya no se corrige: borraría su atraso', 'llegó completa');
reset role;

-- ============================================ 4. Lo anotado queda
select pg_temp.como('comprador');
set local role authenticated;
select test.debe_fallar(format('insert into public.seguimiento_de_compras (orden_compra_id, tipo, motivo) values (%L, ''MOTIVO_ATRASO'', ''PAGO'')',
                               pg_temp.id('oc1')),
  'nadie inserta directo: se anota con las funciones', 'permission denied');
select test.debe_fallar(format('update public.seguimiento_de_compras set nota = ''otra'' where id = %L', pg_temp.id('mot1')),
  'Logística no lo corrige directo', 'permission denied');
reset role;
select test.debe_fallar(format('update public.seguimiento_de_compras set nota = ''otra'' where id = %L', pg_temp.id('mot1')),
  'ni el dueño corrige lo anotado', 'evidencia');
select test.debe_fallar(format('delete from public.seguimiento_de_compras where id = %L', pg_temp.id('mot1')),
  'ni el dueño lo borra', 'evidencia');

-- ============================================ 5. La OS
select pg_temp.como('comprador');
set local role authenticated;
select public.anotar_motivo_atraso(gen_random_uuid(), 'OS', pg_temp.id('os1'), 'PAGO', 'Falta el adelanto');
select public.corregir_fecha_esperada(gen_random_uuid(), 'OS', pg_temp.id('os1'), pg_temp.hoy() + 1, 'PAGO', null);
do $$
declare r record;
begin
  select * into r from public.plazos_de_servicios(array[pg_temp.id('os1')]);
  perform test.afirmar(r.esperada = pg_temp.hoy() + 1 and not r.atrasada, 'la OS cuenta contra su fecha corregida');
end $$;
select test.afirmar((select count(*) from public.recorrido_de_ordenes_servicio(array[pg_temp.id('os1')]) r
                      where r.paso in ('MOTIVO_ATRASO', 'FECHA_CORREGIDA')) = 2,
  'el motivo y la fecha corregida de la OS salen en su recorrido');
select test.debe_fallar(format('select public.corregir_fecha_esperada(%L, ''OS'', %L, %L, ''PAGO'', null)',
                               gen_random_uuid(), pg_temp.id('os1'), pg_temp.hoy() - 15),
  'la OS no vuelve antes de su inicio', 'anterior al');
reset role;

-- ============================================ 6. Quién lo lee
select pg_temp.como('gerente');
set local role authenticated;
select test.afirmar((select count(*) from public.recorrido_de_ordenes_compra(array[pg_temp.id('oc1')]) r where r.paso = 'MOTIVO_ATRASO') = 1,
  'Gerencia, que consulta las compras, lee el recorrido con el motivo');
select test.afirmar((select count(*) from public.seguimiento_de_compras where orden_compra_id in (pg_temp.id('oc1'), pg_temp.id('oc2'))) = 3,
  'Gerencia lee el seguimiento de la OC que ve');
select test.debe_fallar(format('select public.anotar_motivo_atraso(%L, ''OC'', %L, ''PAGO'', null)', gen_random_uuid(), pg_temp.id('oc1')),
  'Gerencia no anota el motivo', 'permiso');
reset role;
select pg_temp.como('vendedor');
set local role authenticated;
select test.debe_fallar(format('select * from public.recorrido_de_ordenes_compra(array[%L::uuid])', pg_temp.id('oc1')),
  'Ventas no lee el recorrido de las OC', 'permiso');
select test.debe_fallar(format('select * from public.recorrido_de_ordenes_servicio(array[%L::uuid])', pg_temp.id('os1')),
  'Ventas no lee el recorrido de las OS', 'permiso');
select test.afirmar((select count(*) from public.seguimiento_de_compras) = 0,
  'Ventas no ve ninguna fila del seguimiento: no ve las compras');
reset role;
do $$
begin
  perform test.afirmar(not has_function_privilege('anon', 'public.recorrido_de_ordenes_compra(uuid[])', 'execute')
                   and not has_function_privilege('anon', 'public.recorrido_de_ordenes_servicio(uuid[])', 'execute')
                   and not has_function_privilege('anon', 'public.anotar_motivo_atraso(uuid, text, uuid, text, text)', 'execute')
                   and not has_function_privilege('anon', 'public.corregir_fecha_esperada(uuid, text, uuid, date, text, text)', 'execute')
                   and not has_function_privilege('authenticated', 'public.fecha_prometida_de_compra(uuid, uuid)', 'execute')
                   and not has_table_privilege('anon', 'public.seguimiento_de_compras', 'select'),
    'sin sesión no se ejecutan, y el ayudante interno no es de nadie');
end $$;

rollback;
