-- El vehículo de garantía entra con su OT de garantía y sale cuando
-- Administración da por terminada la garantía, con el visto de Tesorería
-- (migración 20261021120000). El avance del código no decide nada: aquí va en
-- 0 % y aun así sale. Cada paso con su puesto —Requerimientos registra,
-- Administración termina la garantía, Tesorería revisa— y `set local role
-- authenticated`. El armazón lo pone el administrador. Termina en rollback.
\set ON_ERROR_STOP on
begin;

alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

insert into public.sedes (codigo, nombre) values ('QA416', 'Taller prueba 416') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA416' \gset
select test.crear_usuario('Ada', 'Admin', 'admin416@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Reni', 'Requerimientos', 'req416@demo.pe', 'REQUERIMIENTOS', :'sede_id') as req_id \gset
select test.crear_usuario('Teo', 'Tesoro', 'tesoreria416@demo.pe', 'TESORERIA', :'sede_id') as tes_id \gset
select test.crear_usuario('Alma', 'Administración', 'adm416@demo.pe', 'ADMINISTRACION', :'sede_id') as adm_id \gset
select test.crear_usuario('Vico', 'Ventas', 'ventas416@demo.pe', 'VENDEDOR', :'sede_id') as ventas_id \gset

-- Armazón: tres unidades con su OT de fabricación. La G tiene además su OT de
-- garantía abierta; la H, ninguna; la K, una de garantía ya terminada.
select test.como_usuario(:'admin_id');
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000416', 'QA CLIENTE 416') returning id as cliente_id \gset
select set_config('prueba.cliente', :'cliente_id', true);
select set_config('prueba.sede', :'sede_id', true);
create or replace function pg_temp.unidad(p_codigo text) returns uuid language sql as $$
  insert into public.unidades (cliente_id, codigo_interno, tipo_vehiculo)
  values (current_setting('prueba.cliente')::uuid, p_codigo, 'CAMION') returning id;
$$;
create or replace function pg_temp.orden(p_numero text, p_unidad uuid, p_tipo text) returns uuid language sql as $$
  insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
  values (p_numero, current_setting('prueba.cliente')::uuid, p_unidad, current_setting('prueba.sede')::uuid,
          p_tipo::public.tipo_trabajo_ot, 'NORMAL', 'Prueba 416 ' || p_tipo, 'APROBADA') returning id;
$$;
select pg_temp.unidad('CHK416_G_26/50') as unidad_g \gset
select pg_temp.unidad('CHK416_H_26/51') as unidad_h \gset
select pg_temp.unidad('CHK416_K_26/52') as unidad_k \gset
select pg_temp.unidad('CHK416_M_26/53') as unidad_m \gset
select pg_temp.orden('8416-2026', :'unidad_g', 'FABRICACION');
select pg_temp.orden('8417-2026', :'unidad_h', 'FABRICACION');
select pg_temp.orden('8418-2026', :'unidad_k', 'FABRICACION');
select pg_temp.orden('8419-2026', :'unidad_m', 'FABRICACION');
-- Las de garantía se crean después, como en la vida real. Dentro de una sola
-- transacción `now()` no avanza: la de fabricación se fecha antes a mano.
update public.ordenes_trabajo set creado_en = now() - interval '30 days'
 where numero in ('8416-2026', '8417-2026', '8418-2026', '8419-2026');
select pg_temp.orden('9416-2026', :'unidad_g', 'GARANTIA') as garantia_g \gset
select pg_temp.orden('9418-2026', :'unidad_k', 'GARANTIA') as garantia_k \gset
select pg_temp.orden('9419-2026', :'unidad_m', 'GARANTIA') as garantia_m \gset
-- La de K ya la dio por terminada Administración otra vez.
insert into public.ot_garantia_terminada (orden_id, terminada_por) values (:'garantia_k', :'adm_id');
-- Una OT de garantía todavía en borrador, de la unidad H.
insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
values ('9417-2026', :'cliente_id', :'unidad_h', :'sede_id', 'GARANTIA', 'NORMAL', 'Prueba 416 sin aprobar', 'BORRADOR')
returning id as garantia_h \gset
select set_config('prueba.garantia_h', :'garantia_h', true);
select pg_temp.orden('8420-2026', null, 'FABRICACION') as fabricacion \gset
select set_config('prueba.fabricacion', :'fabricacion', true);

select set_config('prueba.req', :'req_id', true);
select set_config('prueba.garantia_g', :'garantia_g', true);
do $$
declare v text;
begin
  foreach v in array array['g', 'h', 'k', 'm', 'rev', 'pdf'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.todo_ingreso', (select jsonb_object_agg(codigo, jsonb_build_object('ingreso', 'CONFORME'))::text
                                               from public.control_vehicular_items), true);
  perform set_config('prueba.todo_salida', (select jsonb_object_agg(codigo, jsonb_build_object('salida', 'CONFORME'))::text
                                              from public.control_vehicular_items), true);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.txt(p_clave text) returns text language sql as $$
  select current_setting('prueba.' || p_clave);
$$;
create or replace function pg_temp.foto(p_registro text, p_momento text) returns jsonb language plpgsql as $$
declare v_ruta text := current_setting('prueba.req') || '/' || current_setting('prueba.' || p_registro) || '/' || p_momento
                       || '/' || gen_random_uuid() || '.jpg';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('fotos-vehiculos', v_ruta, current_setting('prueba.req'), '{"mimetype": "image/jpeg", "size": 150000}');
  return jsonb_build_array(v_ruta);
end $$;
create or replace function pg_temp.ingreso_sql(p_registro text, p_codigo text, p_motivo text) returns text language sql as $$
  select format($q$select public.registrar_ingreso_vehiculo(%L, null, null, %L, '', '', %L, null, null, pg_temp.foto(%L, 'ingreso'))$q$,
                current_setting('prueba.' || p_registro), p_codigo, p_motivo, p_registro);
$$;
create or replace function pg_temp.salida_sql(p_registro text) returns text language sql as $$
  select format($q$select public.registrar_salida_vehiculo(%L, null, 'Sale', pg_temp.foto(%L, 'salida'))$q$,
                current_setting('prueba.' || p_registro), p_registro);
$$;
create or replace function pg_temp.estado(p_registro text) returns jsonb language sql as $$
  select to_jsonb(e) from public.vehiculos_estado_de_salida(array[current_setting('prueba.' || p_registro)::uuid]) e;
$$;

-- ===================================================== 1. El ingreso por garantía
select test.como_usuario(:'req_id');
set local role authenticated;
-- La ventana del ingreso ofrece por garantía solo el código con su OT de
-- garantía abierta, y muestra esa OT.
select test.afirmar((select string_agg(codigo_interno || '=' || coalesce(garantia_numero, '-'), ' ' order by codigo_interno)
                       from public.vehiculos_codigos_para_ingreso() where codigo_interno like 'CHK416%')
                    = 'CHK416_G_26/50=9416-2026 CHK416_H_26/51=9417-2026 CHK416_K_26/52=- CHK416_M_26/53=9419-2026',
  'la ventana sabe qué código tiene su OT de garantía abierta (la terminada de K no cuenta)');
select test.debe_fallar(pg_temp.ingreso_sql('h', 'CHK416_G_26/99', 'GARANTIA'),
  'con un código que no existe no entra', 'no es de ninguna unidad');
select test.debe_fallar(pg_temp.ingreso_sql('k', 'CHK416_K_26/52', 'GARANTIA'),
  'ni con la OT de garantía ya terminada', 'no tiene una OT de garantía abierta');
select public.registrar_ingreso_vehiculo(pg_temp.id('g'), null, null, 'chk416_g_26/50', '', '', 'GARANTIA', null,
  'Vuelve por la compuerta', pg_temp.foto('g', 'ingreso'));
reset role;
select test.afirmar((select orden_id = :'garantia_g'::uuid and empresa = 'QA CLIENTE 416'
                       from public.registro_vehiculos where id = pg_temp.id('g')),
  'el ingreso por garantía queda atado a su OT de garantía, no a la de fabricación');

-- ===================================================== 2. La salida espera la OT
select test.como_usuario(:'req_id');
set local role authenticated;
select test.afirmar(
  (pg_temp.estado('g') ->> 'exige')::boolean
  and pg_temp.estado('g') ->> 'avance' is null
  and pg_temp.estado('g') ->> 'garantia_ot' = '9416-2026'
  and pg_temp.estado('g') ->> 'garantia_estado' = 'APROBADA',
  'la pantalla recibe la OT de garantía y su estado, sin el avance del código');
select test.afirmar(pg_temp.estado('g') ->> 'falta_para_pedir'
                    = 'Administración todavía no da por terminada la garantía de la OT 9416-2026: la salida se habilita cuando la marque.',
  format('y dice qué falta: %s', pg_temp.estado('g') ->> 'falta_para_pedir'));
select test.debe_fallar(pg_temp.salida_sql('g'), 'con su garantía sin terminar no sale', 'garantía de la OT 9416-2026');
select test.debe_fallar(format($q$select public.solicitar_revision_salida(%L, %L, 'Revisar el pago')$q$, pg_temp.txt('rev'), pg_temp.txt('g')),
  'ni se le pide la revisión a Tesorería', 'Tesorería revisa la salida de un vehículo terminado');

-- Quién no la termina: Requerimientos y Ventas no tienen `ordenes.editar`.
select test.debe_fallar(format($q$select public.dar_por_terminada_la_garantia(%L, null)$q$, pg_temp.txt('garantia_g')),
  'Requerimientos no da por terminada la garantía', 'ordenes.editar');
reset role;
select test.como_usuario(:'ventas_id');
set local role authenticated;
select test.debe_fallar(format($q$select public.dar_por_terminada_la_garantia(%L, null)$q$, pg_temp.txt('garantia_g')),
  'ni Ventas', 'ordenes.editar');
select test.debe_fallar(format($q$insert into public.ot_garantia_terminada (orden_id, terminada_por) values (%L, %L)$q$,
  pg_temp.txt('garantia_g'), :'ventas_id'), 'ni nadie la anota directo en la tabla', 'permission denied');
reset role;

-- Administración la da por terminada cuando el taller avisa.
select test.como_usuario(:'adm_id');
set local role authenticated;
select test.debe_fallar(format($q$select public.dar_por_terminada_la_garantia(%L, null)$q$, pg_temp.txt('fabricacion')),
  'una OT de fabricación no se termina así', 'no es de garantía');
select test.debe_fallar(format($q$select public.dar_por_terminada_la_garantia(%L, null)$q$, pg_temp.txt('garantia_h')),
  'ni una de garantía que Gerencia todavía no aprueba', 'espera la aprobación de Gerencia');
select public.dar_por_terminada_la_garantia(pg_temp.id('garantia_g'), '  Compuerta   cambiada ');
select test.afirmar(public.dar_por_terminada_la_garantia(pg_temp.id('garantia_g'), 'otra vez') = pg_temp.id('garantia_g'),
  'repetirla no hace otra');
select test.afirmar((select count(*) = 1 and min(nota) = 'Compuerta cambiada' and bool_and(terminada_por = :'adm_id'::uuid)
                       from public.ot_garantia_terminada where orden_id = pg_temp.id('garantia_g')),
  'Administración dio por terminada la garantía, con su nota y su nombre');
reset role;
select test.afirmar((select estado = 'APROBADA' from public.ordenes_trabajo where id = :'garantia_g'),
  'sin tocar el estado de la OT ni sus etapas');
select test.afirmar(exists (select 1 from public.notificaciones
                             where usuario_id = :'req_id' and origen_id = pg_temp.id('g')
                               and titulo = 'La garantía de la OT 9416-2026 está terminada'),
  'y a Requerimientos le llega el aviso, con su vehículo en la planta');

-- ===================================================== 3. Terminada, con Tesorería
select test.como_usuario(:'req_id');
set local role authenticated;
select test.afirmar(pg_temp.estado('g') ->> 'falta_para_pedir' is null and pg_temp.estado('g') ->> 'garantia_estado' = 'TERMINADA',
  'con la garantía terminada ya se le pide la revisión a Tesorería, aunque el código vaya en 0 %');
select test.debe_fallar(pg_temp.salida_sql('g'), 'pero sin Tesorería no sale', 'pídele la revisión');
select public.guardar_ficha_vehiculo(pg_temp.id('g'), 'CERRAR_INGRESO', jsonb_build_object(
  'marca', 'Volvo', 'conductor_ingreso', 'Juan Prueba', 'dni_ingreso', '00000000', 'fecha_ingreso', current_date,
  'combustible_ingreso', '1/2', 'items', pg_temp.txt('todo_ingreso')::jsonb));
select public.guardar_ficha_vehiculo(pg_temp.id('g'), 'CERRAR_SALIDA', jsonb_build_object(
  'conductor_salida', 'Ana Prueba', 'dni_salida', '11111111', 'fecha_salida', current_date, 'combustible_salida', '1/4',
  'items', pg_temp.txt('todo_salida')::jsonb));
insert into storage.objects (bucket_id, name, owner_id, metadata)
values ('fichas-vehiculos', pg_temp.txt('g') || '/' || pg_temp.txt('pdf') || '.pdf', pg_temp.txt('req'),
        '{"mimetype": "application/pdf", "size": 350000}');
select public.adjuntar_ficha_vehiculo_firmada(pg_temp.id('g'), pg_temp.txt('g') || '/' || pg_temp.txt('pdf') || '.pdf', 'ficha.pdf');
select public.solicitar_revision_salida(pg_temp.id('rev'), pg_temp.id('g'), 'Revisar la garantía');
reset role;
select test.como_usuario(:'tes_id');
set local role authenticated;
select public.responder_revision_salida(pg_temp.id('rev'), 'ATENDIDA', 'Garantía sin cobro');
reset role;
select test.como_usuario(:'req_id');
set local role authenticated;
select public.registrar_salida_vehiculo(pg_temp.id('g'), null, 'Sale con la garantía hecha', pg_temp.foto('g', 'salida'));
reset role;
select test.afirmar((select salida_en is not null from public.registro_vehiculos where id = pg_temp.id('g')),
  'con la garantía terminada y Tesorería, el vehículo sale');

-- ===================================================== 4. Por otro motivo, la misma regla
-- El código con una OT de garantía abierta que entra por mantenimiento queda
-- atado a ella (es su OT más reciente) y espera lo mismo.
select test.como_usuario(:'req_id');
set local role authenticated;
select public.registrar_ingreso_vehiculo(pg_temp.id('m'), null, null, 'CHK416_M_26/53', '', '', 'MANTENIMIENTO', null, null,
  pg_temp.foto('m', 'ingreso'));
select test.afirmar(pg_temp.estado('m') ->> 'garantia_ot' = '9419-2026'
                    and pg_temp.estado('m') ->> 'falta_para_salir' like '%garantía de la OT 9419-2026%',
  'entrando por mantenimiento, su salida también espera la OT de garantía');
-- La de garantía en borrador: entra por garantía y dice que espera a Gerencia.
select public.registrar_ingreso_vehiculo(pg_temp.id('h'), null, null, 'CHK416_H_26/51', '', '', 'GARANTIA', null, null,
  pg_temp.foto('h', 'ingreso'));
select test.afirmar(pg_temp.estado('h') ->> 'falta_para_salir' like 'La OT de garantía 9417-2026 espera la aprobación de Gerencia%',
  'la garantía en borrador espera la aprobación de Gerencia');
reset role;
-- Y la fabricación sigue esperando el 100 % del avance de su código.
select pg_temp.unidad('CHK416_F_26/54') as unidad_f \gset
select pg_temp.orden('8421-2026', :'unidad_f', 'FABRICACION');
select set_config('prueba.f', gen_random_uuid()::text, true);
select test.como_usuario(:'req_id');
set local role authenticated;
select public.registrar_ingreso_vehiculo(pg_temp.id('f'), null, null, 'CHK416_F_26/54', '', '', 'FABRICACION', null, null,
  pg_temp.foto('f', 'ingreso'));
select test.afirmar(pg_temp.estado('f') ->> 'garantia_ot' is null and (pg_temp.estado('f') ->> 'avance')::integer = 0
                    and pg_temp.estado('f') ->> 'falta_para_salir' like 'El código CHK416_F_26/54 va en 0 %%',
  'la fabricación sigue esperando el 100 % del avance de su código');
reset role;

-- Si la OT de garantía se anula con el vehículo adentro, se dice qué hacer en
-- vez de esperar a Administración para siempre.
select pg_temp.unidad('CHK416_N_26/55') as unidad_n \gset
select pg_temp.orden('9422-2026', :'unidad_n', 'GARANTIA') as garantia_n \gset
select set_config('prueba.n', gen_random_uuid()::text, true);
select test.como_usuario(:'req_id');
set local role authenticated;
select public.registrar_ingreso_vehiculo(pg_temp.id('n'), null, null, 'CHK416_N_26/55', '', '', 'GARANTIA', null, null,
  pg_temp.foto('n', 'ingreso'));
reset role;
select test.como_usuario(:'admin_id');
update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'Se registró en otra OT (prueba 416)' where id = :'garantia_n';
select test.como_usuario(:'req_id');
set local role authenticated;
select test.afirmar(pg_temp.estado('n') ->> 'garantia_estado' = 'ANULADA'
                    and pg_temp.estado('n') ->> 'falta_para_salir'
                        = 'La OT de garantía 9422-2026 está anulada: anula este ingreso y regístralo con la OT que corresponda.',
  format('con su OT de garantía anulada, dice qué hacer: %s', pg_temp.estado('n') ->> 'falta_para_salir'));
reset role;

-- La función interna no la llama nadie desde la API.
select test.como_usuario(:'req_id');
set local role authenticated;
select test.debe_fallar(format($q$select public.vehiculo_ot_de_garantia_abierta(%L)$q$, :'unidad_g'),
  'la OT de garantía abierta no se pide por la API', 'permission denied');
reset role;

rollback;
