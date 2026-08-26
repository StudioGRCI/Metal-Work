-- La orden de trabajo en su formato de taller: medidas, accesorios con V°B°,
-- repuestos y los pasos de verificación.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000014', 'PRUEBAS FICHA OT S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Ana',   'Torres', 'ana@demo.pe',   'ADMIN',    (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Diego', 'Quispe', 'diego@demo.pe', 'OPERARIO', (select id from public.sedes limit 1), true, 14) as operario_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C');
insert into public.unidades (cliente_id, placa, tipo_vehiculo, marca, modelo)
  select id, 'F2K-908', 'SEMIRREMOLQUE', 'RANDON', 'SR' from public.clientes limit 1;

select test.como_usuario(:'admin_id');

-- ------------------------------------------- las listas de pasos están cargadas
do $$
declare
  v_plataforma int;
  v_tolva      int;
  v_generica   int;
begin
  select count(*) into v_plataforma
    from public.plantillas_verificacion v
    join public.tipos_carroceria t on t.id = v.tipo_carroceria_id
   where t.codigo = 'PLATAFORMA';

  select count(*) into v_tolva
    from public.plantillas_verificacion v
    join public.tipos_carroceria t on t.id = v.tipo_carroceria_id
   where t.codigo = 'TOLVA_VOLQUETE';

  select count(*) into v_generica
    from public.plantillas_verificacion where tipo_carroceria_id is null;

  -- Los dieciocho de la OT 2925, ni uno menos.
  perform test.afirmar(v_plataforma = 18,
    format('la plataforma trae sus 18 pasos de verificación: %s', v_plataforma));
  perform test.afirmar(v_tolva = 18,
    format('la tolva trae los suyos: %s', v_tolva));
  perform test.afirmar(v_generica > 0, 'hay una lista genérica de respaldo');

  -- Una tolva no lleva king pin; si las listas fueran iguales sobraría el tipo.
  perform test.afirmar(
    exists (select 1 from public.plantillas_verificacion v
              join public.tipos_carroceria t on t.id = v.tipo_carroceria_id
             where t.codigo = 'PLATAFORMA' and v.descripcion ilike '%king pin%'),
    'la plataforma verifica el king pin');
  perform test.afirmar(
    not exists (select 1 from public.plantillas_verificacion v
                  join public.tipos_carroceria t on t.id = v.tipo_carroceria_id
                 where t.codigo = 'TOLVA_VOLQUETE' and v.descripcion ilike '%king pin%'),
    'la tolva no, porque va montada sobre un chasis');
  perform test.afirmar(
    exists (select 1 from public.plantillas_verificacion v
              join public.tipos_carroceria t on t.id = v.tipo_carroceria_id
             where t.codigo = 'TOLVA_VOLQUETE' and v.descripcion ilike '%levante%'),
    'y en cambio se le prueba el levante');

  -- Todas terminan igual: la unidad se da por entregada cuando está al 100%.
  perform test.afirmar(
    not exists (
      select 1 from public.plantillas_verificacion v
       where v.numero = (select max(x.numero) from public.plantillas_verificacion x
                          where x.tipo_carroceria_id is not distinct from v.tipo_carroceria_id)
         and v.descripcion not ilike '%100%'),
    'toda lista termina en el paso final al 100%');
end $$;

-- ------------------------------------- la ficha se arma sola al aprobar la OT
insert into public.cotizaciones (cliente_id, unidad_id, tipo_carroceria_id, fecha_emision)
  select c.id, u.id, t.id, current_date
    from public.clientes c
    join public.unidades u on u.cliente_id = c.id
    cross join public.tipos_carroceria t
   where t.codigo = 'PLATAFORMA' limit 1;

-- Se cotizó con la ficha de la empresa, que es de donde salen los accesorios.
select public.aplicar_plantilla_ficha(
  (select id from public.cotizaciones limit 1),
  (select p.id from public.plantillas_ficha p
     join public.tipos_carroceria t on t.id = p.tipo_carroceria_id
    where t.codigo = 'PLATAFORMA' limit 1));

insert into public.ordenes_trabajo
  (cliente_id, unidad_id, sede_id, tipo_carroceria_id, cotizacion_id, descripcion, tipo_trabajo)
  select c.id, u.id, s.id, t.id, q.id,
         'Plataforma semirremolque de 3 ejes con suspensión neumática', 'FABRICACION'
    from public.clientes c
    join public.unidades u on u.cliente_id = c.id
    cross join public.sedes s
    join public.tipos_carroceria t on t.codigo = 'PLATAFORMA'
    join public.cotizaciones q on q.cliente_id = c.id
   limit 1;

do $$
declare
  v_ot         uuid;
  v_cot        uuid;
  v_acc_cot    int;
  v_acc_ot     int;
  v_pasos      int;
begin
  select id, cotizacion_id into v_ot, v_cot from public.ordenes_trabajo limit 1;

  perform test.afirmar(
    not exists (select 1 from public.ot_verificaciones where orden_id = v_ot),
    'una OT en borrador todavía no tiene ficha de taller');

  select count(*) into v_acc_cot from public.cotizacion_accesorios where cotizacion_id = v_cot;

  update public.ordenes_trabajo set estado = 'APROBADA' where id = v_ot;

  select count(*) into v_acc_ot from public.ot_accesorios     where orden_id = v_ot;
  select count(*) into v_pasos  from public.ot_verificaciones where orden_id = v_ot;

  -- Lo que se prometió en la cotización es lo que hay que montar: la lista de
  -- accesorios de la OT no se vuelve a escribir a mano.
  perform test.afirmar(v_acc_cot > 0, format('la cotización trajo sus accesorios: %s', v_acc_cot));
  perform test.afirmar(v_acc_ot = v_acc_cot,
    format('al aprobar, los accesorios cotizados bajan a la OT: %s de %s', v_acc_ot, v_acc_cot));
  perform test.afirmar(v_pasos = 18,
    format('y los 18 pasos de verificación de su carrocería: %s', v_pasos));
  perform test.afirmar(
    not exists (select 1 from public.ot_accesorios where orden_id = v_ot and verificado),
    'ninguno nace con el visto bueno puesto');

  -- El «no incluye el accesorio» de la cotización viaja con el accesorio: es
  -- justo lo que evita el reclamo en la entrega.
  perform test.afirmar(
    (select count(*) from public.ot_accesorios where orden_id = v_ot and not incluye_el_accesorio)
      = (select count(*) from public.cotizacion_accesorios
          where cotizacion_id = v_cot and not incluye_el_accesorio),
    'y el «no incluye el accesorio» viaja con ellos');

  -- Corregir la orden y volver a aprobarla no duplica la ficha ni borra lo ya
  -- verificado: el taller no vuelve a marcar lo que ya marcó.
  update public.ordenes_trabajo set estado = 'BORRADOR' where id = v_ot;
  update public.ordenes_trabajo set estado = 'APROBADA' where id = v_ot;
  perform test.afirmar(
    (select count(*) from public.ot_verificaciones where orden_id = v_ot) = v_pasos,
    'volver a pasar por aprobada no duplica los pasos');
  perform test.afirmar(
    (select count(*) from public.ot_accesorios where orden_id = v_ot) = v_acc_ot,
    'ni los accesorios');
end $$;

-- ------------------------------------------------------ la lista de respaldo
do $$
declare
  v_ot       uuid;
  v_generica int;
  v_pasos    int;
begin
  select count(*) into v_generica
    from public.plantillas_verificacion where tipo_carroceria_id is null;

  -- Una orden sin tipo de carrocería —una reparación que entra sin clasificar—
  -- igual tiene que llegar con pasos que marcar.
  insert into public.ordenes_trabajo
    (cliente_id, unidad_id, sede_id, descripcion, tipo_trabajo, estado)
    select c.id, u.id, s.id, 'Reparación de estructura sin clasificar', 'REPARACION', 'APROBADA'
      from public.clientes c
      join public.unidades u on u.cliente_id = c.id
      cross join public.sedes s
     limit 1
  returning id into v_ot;

  select count(*) into v_pasos from public.ot_verificaciones where orden_id = v_ot;
  perform test.afirmar(v_pasos = v_generica,
    format('la orden sin carrocería usa la lista genérica: %s pasos', v_pasos));
end $$;

-- --------------------------------------------- las reglas del papel se cumplen
do $$
declare v_ot uuid;
begin
  select id into v_ot from public.ordenes_trabajo where cotizacion_id is not null limit 1;
  perform set_config('prueba.ot', v_ot::text, true);
end $$;

select test.debe_fallar($$
  update public.ot_verificaciones set avance_2 = true, avance_2_en = now()
   where orden_id = current_setting('prueba.ot')::uuid and numero = 5
$$, 'no se marca la segunda pasada sin haber hecho la primera');

select test.debe_fallar($$
  update public.ot_accesorios set verificado = true
   where orden_id = current_setting('prueba.ot')::uuid
     and id = (select id from public.ot_accesorios
                where orden_id = current_setting('prueba.ot')::uuid limit 1)
$$, 'un visto bueno sin fecha queda a medias');

select test.debe_fallar($$
  insert into public.ot_verificaciones (orden_id, numero, descripcion)
  values (current_setting('prueba.ot')::uuid, 1, 'Paso repetido')
$$, 'no hay dos pasos con el mismo número en una orden');

select test.debe_fallar($$
  insert into public.plantillas_verificacion (tipo_carroceria_id, numero, descripcion)
  values (null, 5, 'Segunda lista genérica')
$$, 'la lista genérica es una sola');

-- ----------------------------------------------- el V°B° y el avance sí entran
do $$
declare
  v_ot  uuid := current_setting('prueba.ot')::uuid;
  v_acc uuid;
begin
  select id into v_acc from public.ot_accesorios where orden_id = v_ot limit 1;

  update public.ot_accesorios
     set verificado = true, verificado_en = now(),
         verificado_por = (select id from public.usuarios where correo = 'ana@demo.pe')
   where id = v_acc;

  update public.ot_verificaciones
     set avance_1 = true, avance_1_en = now()
   where orden_id = v_ot and numero <= 4;

  update public.ot_verificaciones
     set avance_2 = true, avance_2_en = now()
   where orden_id = v_ot and numero <= 2;

  perform test.afirmar(
    (select accesorios_verificados from public.ot_ficha_resumen where orden_id = v_ot) = 1,
    'el resumen cuenta los accesorios con visto bueno');
  perform test.afirmar(
    (select pasos_avance_1 from public.ot_ficha_resumen where orden_id = v_ot) = 4
    and (select pasos_avance_2 from public.ot_ficha_resumen where orden_id = v_ot) = 2,
    'y las dos pasadas de verificación por separado');
end $$;

-- ------------------------------------------------------ quién ve qué
select test.como_usuario(:'operario_id');
set local role authenticated;

do $$
declare v_ot uuid := current_setting('prueba.ot')::uuid;
begin
  -- El operario ve las órdenes en las que está asignado. En esta no lo está.
  perform test.afirmar(
    (select count(*) from public.ot_verificaciones where orden_id = v_ot) = 0,
    'un operario no ve la ficha de una orden que no le tocó');
end $$;

reset role;
select test.como_usuario(:'admin_id');

rollback;
