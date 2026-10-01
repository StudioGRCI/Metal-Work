\set ON_ERROR_STOP on
-- Control de plazos con las etapas que define Diseño.
--
-- Desde el 28/09 toda OT nueva lleva etapas libres (sin fila en
-- etapas_catalogo), y las vistas del control hacían INNER JOIN al catálogo: la
-- pantalla decía «Todavía no hay etapas que controlar» con las tres órdenes de
-- producción en curso, y el tablero no contaba ninguna etapa vencida. Se prueba
-- con la mirada de Gerencia, que es quien pregunta «¿qué está vencido?».
begin;

select test.crear_usuario('QA','Diseño','qa-plazos-diseno@demo.pe','DISENO',
  (select id from public.sedes order by nombre limit 1)) as diseno_id \gset
select test.crear_usuario('QA','Oficina','qa-plazos-oficina@demo.pe','ADMINISTRACION',
  (select id from public.sedes order by nombre limit 1)) as oficina_id \gset
select test.crear_usuario('QA','Gerencia','qa-plazos-gerencia@demo.pe','GERENTE',
  (select id from public.sedes order by nombre limit 1)) as gerencia_id \gset
select gen_random_uuid() as orden_id \gset
select gen_random_uuid() as etapa_dis \gset
select gen_random_uuid() as etapa_prd \gset

insert into public.clientes(tipo_documento,numero_documento,razon_social)
values ('RUC','20990000311','QA plazos');
insert into public.ordenes_trabajo(id,numero,cliente_id,sede_id,tipo_trabajo,
  prioridad,descripcion,estado)
select :'orden_id','9311-2099',c.id,s.id,'FABRICACION','NORMAL',
  'Orden QA para el control de plazos','APROBADA'
from public.clientes c cross join public.sedes s
where c.numero_documento='20990000311' order by s.nombre limit 1;

select set_config('prueba.plazos.orden',:'orden_id',true);
select set_config('prueba.plazos.etapa_dis',:'etapa_dis',true);
select set_config('prueba.plazos.etapa_prd',:'etapa_prd',true);
select set_config('prueba.plazos.diseno',:'diseno_id',true);
select set_config('prueba.plazos.oficina',:'oficina_id',true);
select set_config('prueba.plazos.gerencia',:'gerencia_id',true);

do $test$
declare
  v_orden uuid := current_setting('prueba.plazos.orden')::uuid;
  v_dis uuid := current_setting('prueba.plazos.etapa_dis')::uuid;
  v_prd uuid := current_setting('prueba.plazos.etapa_prd')::uuid;
  v_fila record;
  v_vencidas integer;
begin
  -- Diseño define dos etapas libres; Administración les pone fecha. Una ya
  -- venció ayer y la otra vence en tres días.
  perform test.como_usuario(current_setting('prueba.plazos.diseno')::uuid);
  set local role authenticated;
  perform public.guardar_etapas_libres(v_orden, jsonb_build_array(
    jsonb_build_object('id', v_dis, 'nombre', 'Planos de la unidad',
      'area_id', (select id from public.areas where codigo = 'DIS'), 'peso_pct', 20),
    jsonb_build_object('id', v_prd, 'nombre', 'Armado y soldadura',
      'area_id', (select id from public.areas where codigo = 'PRD'), 'peso_pct', 80)), null);
  reset role;

  perform test.como_usuario(current_setting('prueba.plazos.oficina')::uuid);
  set local role authenticated;
  perform public.programar_etapa_administracion(v_dis, current_date - 5, current_date - 1);
  perform public.programar_etapa_administracion(v_prd, current_date, current_date + 3);
  reset role;

  if exists (select 1 from public.ot_etapas where orden_id = v_orden and etapa_catalogo_id is not null) then
    raise exception 'FALLO: el armazón debía dejar solo etapas libres';
  end if;

  -- Gerencia mira el control de plazos con su rol de verdad.
  perform test.como_usuario(current_setting('prueba.plazos.gerencia')::uuid);
  set local role authenticated;

  select * into v_fila from public.v_plazos_por_area where etapa_id = v_dis;
  if v_fila.etapa_id is null then
    raise exception 'FALLO: la etapa libre de Diseño no aparece en el control de plazos';
  end if;
  if v_fila.area_codigo is distinct from 'DIS' or v_fila.etapa_nombre is distinct from 'Planos de la unidad' then
    raise exception 'FALLO: la etapa libre salió con área % y nombre %', v_fila.area_codigo, v_fila.etapa_nombre;
  end if;
  if v_fila.plazo is distinct from 'VENCIDO' then
    raise exception 'FALLO: la etapa vencida ayer salió como %', v_fila.plazo;
  end if;

  select * into v_fila from public.v_plazos_por_area where etapa_id = v_prd;
  if v_fila.area_codigo is distinct from 'PRD' or v_fila.plazo is distinct from 'POR_VENCER' then
    raise exception 'FALLO: la etapa de Producción salió con área % y plazo %', v_fila.area_codigo, v_fila.plazo;
  end if;

  select coalesce(sum(cantidad), 0) into v_vencidas
    from public.v_plazos_resumen where area_codigo = 'DIS' and plazo = 'VENCIDO';
  if v_vencidas < 1 then
    raise exception 'FALLO: el resumen del tablero no cuenta la etapa libre vencida';
  end if;

  reset role;
  raise notice '  ok · el control de plazos ve las etapas libres, con su área y su semáforo';
end;
$test$;

rollback;
