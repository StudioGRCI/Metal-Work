\set ON_ERROR_STOP on
-- Comprueba corrección de OT, cambio de comprador con trazabilidad y el acceso
-- de Diseño a su ficha. Todo se crea aquí y se deshace al final.
begin;

select test.crear_usuario('QA', 'Admin', 'qa-ot-admin@demo.pe', 'ADMIN',
  (select id from public.sedes order by nombre limit 1)) as admin_id \gset
select test.crear_usuario('QA', 'Oficina', 'qa-ot-oficina@demo.pe', 'ADMINISTRACION',
  (select id from public.sedes order by nombre limit 1)) as oficina_id \gset
select test.crear_usuario('QA', 'Diseno', 'qa-ot-diseno@demo.pe', 'DISENO',
  (select id from public.sedes order by nombre limit 1)) as diseno_id \gset
select test.crear_usuario('QA', 'Operario', 'qa-ot-operario@demo.pe', 'OPERARIO',
  (select id from public.sedes order by nombre limit 1), true, 10) as operario_id \gset

insert into public.clientes(tipo_documento, numero_documento, razon_social)
  values ('RUC','20990000001','QA Cliente anterior'),('RUC','20990000002','QA Cliente nuevo');
select id as cliente_anterior from public.clientes where numero_documento='20990000001' \gset
select id as cliente_nuevo from public.clientes where numero_documento='20990000002' \gset
select id as carroceria_id from public.tipos_carroceria where activo order by orden_secuencia limit 1 \gset
select gen_random_uuid() as cotizacion_anterior \gset
select gen_random_uuid() as cotizacion_nueva \gset
select gen_random_uuid() as cotizacion_emision \gset
select gen_random_uuid() as unidad_id \gset
select gen_random_uuid() as orden_id \gset
select gen_random_uuid() as orden_emision_id \gset

insert into public.unidades(id, cliente_id, tipo_vehiculo, codigo_interno, numero_fmi, marca, modelo)
  values (:'unidad_id', :'cliente_anterior', 'CAMION', 'MW-QA-290', 'FMI-HISTORICO-290', 'Volvo', 'FMX 8x4');

-- Los PDFs aprobados son datos de preparación aislados; no alteran el flujo de revisión.
insert into public.cotizaciones_pdf(id, numero, cliente_id, tipo_carroceria_id, estado,
  nombre_archivo, ruta_storage, registrado_por)
values
  (:'cotizacion_anterior','QA-PDF-290-A',:'cliente_anterior',:'carroceria_id','APROBADA',
   'anterior.pdf','cot/'||:'cotizacion_anterior'||'/anterior.pdf',:'admin_id'),
  (:'cotizacion_nueva','QA-PDF-290-B',:'cliente_nuevo',:'carroceria_id','APROBADA',
   'nueva.pdf','cot/'||:'cotizacion_nueva'||'/nueva.pdf',:'admin_id'),
  (:'cotizacion_emision','QA-PDF-290-C',:'cliente_anterior',:'carroceria_id','APROBADA',
   'emision.pdf','cot/'||:'cotizacion_emision'||'/emision.pdf',:'admin_id');

-- La base obliga a que toda cotización pase por revisión; aprobar con cuenta
-- ADMIN hace que el fixture también recorra esa guarda en vez de saltársela.
select test.como_usuario(:'admin_id');
update public.cotizaciones_pdf set estado='APROBADA'
where id in (:'cotizacion_anterior',:'cotizacion_nueva',:'cotizacion_emision');

select test.como_usuario(:'admin_id');
set local role authenticated;
insert into public.ordenes_trabajo(id, numero, cliente_id, unidad_id, tipo_carroceria_id, sede_id,
  tipo_trabajo, prioridad, descripcion, estado, cotizacion_pdf_id, monto_presupuestado)
select :'orden_id','9900-2099',:'cliente_anterior',:'unidad_id',:'carroceria_id',s.id,
  'FABRICACION','NORMAL','Fabricación QA para validar trazabilidad','APROBADA',
  :'cotizacion_anterior',125000
from public.sedes s order by s.nombre limit 1;
insert into public.ot_verificaciones(orden_id, numero, descripcion)
select :'orden_id',1,'QA funcionamiento'
where not exists(select 1 from public.ot_verificaciones where orden_id=:'orden_id');

select set_config('prueba.admin_id', :'admin_id', true);
select set_config('prueba.oficina_id', :'oficina_id', true);
select set_config('prueba.diseno_id', :'diseno_id', true);
select set_config('prueba.operario_id', :'operario_id', true);
select set_config('prueba.cliente_anterior', :'cliente_anterior', true);
select set_config('prueba.cliente_nuevo', :'cliente_nuevo', true);
select set_config('prueba.cotizacion_anterior', :'cotizacion_anterior', true);
select set_config('prueba.cotizacion_nueva', :'cotizacion_nueva', true);
select set_config('prueba.cotizacion_emision', :'cotizacion_emision', true);
select set_config('prueba.orden_id', :'orden_id', true);
select set_config('prueba.orden_emision_id', :'orden_emision_id', true);

do $test$
declare
  oid uuid := current_setting('prueba.orden_id',true)::uuid;
  v timestamptz; d jsonb; d_nueva jsonb;
  n int; fallo boolean; acc uuid;
begin
  perform test.como_usuario(current_setting('prueba.oficina_id')::uuid);
  select o.actualizado_en,
    jsonb_build_object('descripcion',o.descripcion||' QA editada','prioridad',o.prioridad,
      'fecha_entrega_comprometida',current_date+30,'codigo_interno',u.codigo_interno,
      'marca',u.marca,'modelo',u.modelo,'unidad_version',u.actualizado_en,'cotizacion_nueva_id','')
    into v,d from public.ordenes_trabajo o join public.unidades u on u.id=o.unidad_id where o.id=oid;
  if v is null then raise exception 'FALLO: Oficina no ve la OT de prueba'; end if;
  perform public.editar_ot_con_historial(oid,v,d,'QA: corregir datos de la orden');
  if not exists(select 1 from public.ot_bitacora where orden_id=oid and datos->>'edicion_ot'='true'
      and datos->>'motivo'='QA: corregir datos de la orden') then
    raise exception 'FALLO: la edición no quedó en la bitácora';
  end if;
  fallo:=false;
  begin
    perform public.editar_ot_con_historial(oid,v - interval '1 second',d,'QA: intento con versión vieja');
  exception when others then
    if sqlerrm not like '%cambió mientras%' then raise; end if;
    fallo:=true;
  end;
  if not fallo then raise exception 'FALLO: aceptó una versión obsoleta de la OT'; end if;

  -- Cambiar la venta reemplaza cliente y cotización en la misma transacción,
  -- conserva la venta anterior y no toca los identificadores FMI históricos.
  select o.actualizado_en,jsonb_build_object('descripcion',o.descripcion,'prioridad',o.prioridad,
    'fecha_entrega_comprometida',o.fecha_entrega_comprometida,'codigo_interno',u.codigo_interno,
    'marca',u.marca,'modelo',u.modelo,'unidad_version',u.actualizado_en,
    'cotizacion_nueva_id',current_setting('prueba.cotizacion_nueva'))
    into v,d_nueva from public.ordenes_trabajo o join public.unidades u on u.id=o.unidad_id where o.id=oid;
  if not exists(select 1 from public.cotizaciones_pdf
      where id=current_setting('prueba.cotizacion_nueva')::uuid and estado='APROBADA') then
    raise exception 'FALLO: la cotización de reemplazo aprobada no está visible para Oficina';
  end if;
  perform public.editar_ot_con_historial(oid,v,d_nueva,'QA: cliente incumplió; nueva venta aprobada');
  if not exists(select 1 from public.ot_ventas_anteriores
      where orden_id=oid and cliente_id=current_setting('prueba.cliente_anterior')::uuid
        and cotizacion_pdf_id=current_setting('prueba.cotizacion_anterior')::uuid) then
    raise exception 'FALLO: no quedó el cliente y PDF de la venta anterior';
  end if;
  if not exists(select 1 from public.ordenes_trabajo o join public.unidades u on u.id=o.unidad_id
      where o.id=oid and o.cliente_id=current_setting('prueba.cliente_nuevo')::uuid
        and o.cotizacion_pdf_id=current_setting('prueba.cotizacion_nueva')::uuid
        and o.cotizacion_id is null and o.monto_presupuestado=0
        and u.cliente_id=o.cliente_id and u.codigo_interno='MW-QA-290'
        and u.numero_fmi='FMI-HISTORICO-290') then
    raise exception 'FALLO: el cambio de cliente no quedó coherente o alteró el FMI histórico';
  end if;
  select count(*) into n from public.ot_ventas_anteriores where orden_id=oid;
  if n<>1 then raise exception 'FALLO: el cambio de cliente duplicó su historial'; end if;

  -- La emisión nueva recibe el valor de la caja «Código interno» por el
  -- argumento legado p_numero_fmi; debe guardarlo en su columna propia.
  perform test.como_usuario(current_setting('prueba.oficina_id')::uuid);
  perform public.emitir_orden_de_cotizacion(
    current_setting('prueba.cotizacion_emision')::uuid,
    current_setting('prueba.orden_emision_id')::uuid,
    '9901-2099','MW-EMISION-290','CARROCERIA_MONTADA'::public.tipo_unidad_carroceria,
    'Volvo','FMX 8x4',current_date+30,
    'ot/'||current_setting('prueba.orden_emision_id')||'/qa.pdf','qa.pdf',100
  );
  if not exists(select 1 from public.ordenes_trabajo o join public.unidades u on u.id=o.unidad_id
      where o.id=current_setting('prueba.orden_emision_id')::uuid
        and u.codigo_interno='MW-EMISION-290' and u.numero_fmi is null) then
    raise exception 'FALLO: emisión guardó el código interno en FMI o no creó la unidad';
  end if;

  perform test.como_usuario(current_setting('prueba.diseno_id')::uuid);
  perform public.guardar_ficha_diseno(oid,'{"colores":"QA rollback","largo_m":4.5}'::jsonb);
  if not exists(select 1 from public.ordenes_trabajo where id=oid and colores='QA rollback' and largo_m=4.5) then
    raise exception 'FALLO: Diseño no guardó la ficha';
  end if;
  insert into public.ot_accesorios(orden_id,orden,cantidad,unidad,descripcion)
    values(oid,999,1,'unid','QA rollback accesorio') returning id into acc;
  update public.ot_accesorios set verificado=true,verificado_por=auth.uid(),verificado_en=now() where id=acc;
  get diagnostics n=row_count;
  if n<>1 then raise exception 'FALLO: Diseño no verifica accesorios'; end if;
  update public.ot_verificaciones set observaciones='QA rollback' where orden_id=oid;
  get diagnostics n=row_count;
  if n<1 then raise exception 'FALLO: Diseño no verifica funcionamiento'; end if;
  fallo:=false;
  begin perform public.guardar_ficha_diseno(oid,'{"cliente_id":null}'::jsonb);
  exception when others then fallo:=true; end;
  if not fallo then raise exception 'FALLO: la ficha permitió cambiar cliente'; end if;

  perform test.como_usuario(current_setting('prueba.operario_id')::uuid);
  update public.ot_accesorios set verificado=false where id=acc;
  get diagnostics n=row_count;
  if n<>0 then raise exception 'FALLO: operario modificó una ficha reservada a Diseño'; end if;
  fallo:=false;
  begin perform public.editar_ot_con_historial(oid,v,d,'QA: edición sin permiso');
  exception when others then fallo:=true; end;
  if not fallo then raise exception 'FALLO: operario editó la OT'; end if;
  raise notice 'OK: código interno al emitir, historial, cambio de comprador, ficha de Diseño y límites por rol';
end $test$;

reset role;
rollback;
