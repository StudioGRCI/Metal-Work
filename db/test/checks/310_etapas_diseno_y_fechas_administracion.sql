\set ON_ERROR_STOP on
-- Diseño escoge etapas; Administración programa fechas; Producción no puede
-- alterarlas. El fixture y todos sus cambios se revierten al terminar.
begin;

select test.crear_usuario('QA','Diseño','qa-etapas-diseno@demo.pe','DISENO',
  (select id from public.sedes order by nombre limit 1)) as diseno_id \gset
select test.crear_usuario('QA','Oficina','qa-etapas-oficina@demo.pe','ADMINISTRACION',
  (select id from public.sedes order by nombre limit 1)) as oficina_id \gset
select test.crear_usuario('QA','Operario','qa-etapas-operario@demo.pe','OPERARIO',
  (select id from public.sedes order by nombre limit 1),true,10) as operario_id \gset
select gen_random_uuid() as orden_id \gset
insert into public.clientes(tipo_documento,numero_documento,razon_social)
values ('RUC','20990000310','QA etapas');
insert into public.ordenes_trabajo(id,numero,cliente_id,sede_id,tipo_trabajo,
  prioridad,descripcion,estado)
select :'orden_id','9310-2099',c.id,s.id,'FABRICACION','NORMAL',
  'Orden QA para distribuir las etapas','APROBADA'
from public.clientes c cross join public.sedes s
where c.numero_documento='20990000310' order by s.nombre limit 1;

select set_config('prueba.etapas.orden',:'orden_id',true);
select set_config('prueba.etapas.diseno',:'diseno_id',true);
select set_config('prueba.etapas.oficina',:'oficina_id',true);
select set_config('prueba.etapas.operario',:'operario_id',true);

do $test$
declare
  v_orden uuid := current_setting('prueba.etapas.orden')::uuid;
  v_primera uuid;
  v_segunda uuid;
  v_etapa uuid;
  v_fallo boolean := false;
begin
  select id into v_primera from public.etapas_catalogo where activo
   order by orden_secuencia limit 1;
  select id into v_segunda from public.etapas_catalogo where activo
   order by orden_secuencia offset 1 limit 1;
  if v_primera is null or v_segunda is null then
    raise exception 'FALLO: el catálogo necesita dos etapas activas para este check';
  end if;
  perform public.crear_etapas_ot(v_orden);
  perform public.programar_etapas_ot(v_orden);
  if exists (select 1 from public.ot_etapas where orden_id=v_orden) then
    raise exception 'FALLO: la OT nueva recibió etapas automáticas';
  end if;
  perform test.como_usuario(current_setting('prueba.etapas.diseno')::uuid);
  set local role authenticated;
  perform public.definir_etapas_ponderadas(v_orden,jsonb_build_array(
    jsonb_build_object('catalogo_id',v_segunda,'area_id',(select id from public.areas where codigo='DIS'),'peso_pct',60),
    jsonb_build_object('catalogo_id',v_primera,'area_id',(select id from public.areas where codigo='PRD'),'peso_pct',40)));
  if (select count(*) from public.ot_etapas where orden_id=v_orden) <> 2 then
    raise exception 'FALLO: Diseño no pudo elegir las dos etapas';
  end if;
  if (select orden_secuencia from public.ot_etapas
       where orden_id=v_orden and etapa_catalogo_id=v_segunda) <> 1 then
    raise exception 'FALLO: no respetó el orden de Diseño';
  end if;
  if (select sum(peso_pct) from public.ot_etapas where orden_id=v_orden) <> 100 then
    raise exception 'FALLO: las etapas no pesan 100 por ciento';
  end if;
  perform public.definir_etapas_ponderadas(v_orden,jsonb_build_array(
    jsonb_build_object('catalogo_id',v_segunda,'area_id',(select id from public.areas where codigo='DIS'),'peso_pct',60),
    jsonb_build_object('catalogo_id',v_primera,'area_id',(select id from public.areas where codigo='PRD'),'peso_pct',40)));
  if (select count(*) from public.ot_etapas where orden_id=v_orden) <> 2 then
    raise exception 'FALLO: el reintento duplicó etapas';
  end if;
  select id into v_etapa from public.ot_etapas
   where orden_id=v_orden and etapa_catalogo_id=v_segunda;
  begin
    perform public.programar_etapa_administracion(v_etapa,current_date,current_date+2);
  exception when others then v_fallo := true;
  end;
  if not v_fallo then raise exception 'FALLO: Diseño pudo programar fechas'; end if;

  reset role;
  perform test.como_usuario(current_setting('prueba.etapas.oficina')::uuid);
  set local role authenticated;
  perform public.programar_etapa_administracion(v_etapa,current_date,current_date+2);
  if not exists (select 1 from public.ot_etapas where id=v_etapa
      and fecha_inicio_programada=current_date and fecha_fin_programada=current_date+2) then
    raise exception 'FALLO: Administración no programó las fechas';
  end if;
  v_fallo := false;
  begin
    perform public.definir_etapas_ponderadas(v_orden,jsonb_build_array(
      jsonb_build_object('catalogo_id',v_primera,'area_id',(select id from public.areas where codigo='DIS'),'peso_pct',60),
      jsonb_build_object('catalogo_id',v_segunda,'area_id',(select id from public.areas where codigo='PRD'),'peso_pct',40)));
  exception when others then v_fallo := true;
  end;
  if not v_fallo then raise exception 'FALLO: Administración reordenó Diseño'; end if;

  reset role;
  perform test.como_usuario(current_setting('prueba.etapas.operario')::uuid);
  set local role authenticated;
  v_fallo := false;
  begin
    update public.ot_etapas set fecha_fin_programada=current_date+4 where id=v_etapa;
  exception when others then v_fallo := true;
  end;
  reset role;
  if exists (select 1 from public.ot_etapas where id=v_etapa
      and fecha_fin_programada=current_date+4) then
    raise exception 'FALLO: Producción cambió fechas directamente';
  end if;
end;
$test$;

rollback;
