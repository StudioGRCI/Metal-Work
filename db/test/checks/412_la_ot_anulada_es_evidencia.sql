-- Una OT anulada es evidencia (migración 20261020207000). Con las cuentas de
-- Administración y Gerencia y `set local role authenticated`: anulan una OT con
-- su motivo, y después no le cambian la descripción ni el motivo. Una OT viva
-- se sigue corrigiendo, y un UPDATE que no cambia nada pasa. El armazón lo pone
-- el administrador. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA412', 'Taller prueba 412') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA412' \gset
select test.crear_usuario('Ada', 'Admin', 'admin412@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Olga', 'Oficina', 'administracion412@demo.pe', 'ADMINISTRACION', :'sede_id') as oficina_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia412@demo.pe', 'GERENTE', :'sede_id') as gerente_id \gset

select test.como_usuario(:'admin_id');
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000412', 'QA CLIENTE 412') returning id as cliente_id \gset
select id as carroceria_id from public.tipos_carroceria where activo order by orden_secuencia limit 1 \gset
insert into public.unidades (cliente_id, codigo_interno, tipo_vehiculo)
values (:'cliente_id', 'CHK412_A_26/41', 'CAMION') returning id as unidad_a \gset
insert into public.unidades (cliente_id, codigo_interno, tipo_vehiculo)
values (:'cliente_id', 'CHK412_B_26/42', 'CAMION') returning id as unidad_b \gset
insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
values ('8412-2026', :'cliente_id', :'unidad_a', :'carroceria_id', :'sede_id', 'FABRICACION', 'NORMAL', 'Tolva 412', 'APROBADA')
returning id as orden_anulada \gset
insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
values ('8413-2026', :'cliente_id', :'unidad_b', :'carroceria_id', :'sede_id', 'FABRICACION', 'NORMAL', 'Furgón 413', 'APROBADA')
returning id as orden_viva \gset
select set_config('prueba.anulada', :'orden_anulada', true);
select set_config('prueba.viva', :'orden_viva', true);

-- Gerencia la anula con su motivo.
set local role authenticated;
select test.como_usuario(:'gerente_id');
do $$
declare v int;
begin
  update public.ordenes_trabajo set estado = 'ANULADA', motivo_anulacion = 'Prueba 412: el cliente desistió'
   where id = current_setting('prueba.anulada')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Gerencia anula la OT con su motivo');
end $$;

-- Ya anulada, nadie le cambia nada.
select test.debe_fallar(
  $$update public.ordenes_trabajo set motivo_anulacion = 'otro motivo' where id = current_setting('prueba.anulada')::uuid$$,
  'Gerencia no le cambia el motivo a la OT anulada', 'evidencia');
select test.como_usuario(:'oficina_id');
select test.debe_fallar(
  $$update public.ordenes_trabajo set descripcion = 'Tolva corregida' where id = current_setting('prueba.anulada')::uuid$$,
  'Administración no le cambia la descripción a la OT anulada', 'evidencia');
select test.como_usuario(:'admin_id');
select test.debe_fallar(
  $$update public.ordenes_trabajo set descripcion = 'Tolva corregida' where id = current_setting('prueba.anulada')::uuid$$,
  'ni el administrador', 'evidencia');

do $$
declare v int;
begin
  -- Un UPDATE que deja todo igual pasa: un recálculo que da lo mismo no revienta.
  update public.ordenes_trabajo set descripcion = descripcion where id = current_setting('prueba.anulada')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'un UPDATE que no cambia nada pasa sobre la anulada');
  perform test.afirmar(
    (select descripcion = 'Tolva 412' and motivo_anulacion = 'Prueba 412: el cliente desistió'
       from public.ordenes_trabajo where id = current_setting('prueba.anulada')::uuid),
    'la OT anulada quedó como estaba');
end $$;

-- La viva se sigue corrigiendo.
select test.como_usuario(:'oficina_id');
do $$
declare v int;
begin
  update public.ordenes_trabajo set descripcion = 'Furgón 413 corregido' where id = current_setting('prueba.viva')::uuid;
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Administración sigue corrigiendo una OT viva');
end $$;

reset role;
rollback;
