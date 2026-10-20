\set ON_ERROR_STOP on
begin;
-- El check crea su propia cuenta de Recursos Humanos: antes tomaba la primera
-- de la base y, en una base vacía, la planilla quedaba sin quién la registra y
-- el RLS la rechazaba.
insert into public.empresa (ruc, razon_social) values ('20100000304', 'PRUEBAS PLANILLA S.A.C.');
insert into public.sedes (codigo, nombre) values ('QA304', 'Sede planilla');
select test.crear_usuario('QA', 'Rrhh', 'qa-304-rrhh@demo.pe', 'RECURSOS_HUMANOS', (select id from public.sedes where codigo = 'QA304')) as rrhh_id \gset
select set_config('prueba.planilla',gen_random_uuid()::text,true);
select set_config('prueba.importacion',gen_random_uuid()::text,true);
select test.como_usuario(:'rrhh_id');
set local role authenticated;
insert into public.planillas(id,tipo,periodo,moneda)values(current_setting('prueba.planilla')::uuid,'ADMINISTRATIVA','2099-08-01','PEN');
-- Desde la migración 20261001203000 la planilla se importa con
-- `importar_planilla_excel`: cada persona trae su hoja, su fila y la empresa
-- que le paga, y entra de cualquier hoja «RESUMEN <MES> … - <AÑO>» del mes de
-- la planilla. La regla vieja «solo el resumen MWP» se retiró a propósito; lo
-- que sigue cerrado es una hoja de otro mes.
do $$ declare v_json jsonb;v_id uuid;begin
 v_json:=jsonb_build_array(jsonb_build_object('nombre','Persona de ensayo','hoja','RESUMEN AGOSTO MWP - 2099','fila',8,'empresa','METAL WORK PERU','detalle',jsonb_build_object('ingresos',1000,'descuentos',100,'aporte_empleador',90,'neto',900,'puesto','Prueba','dias',30,'horas',240,'horas_extras',0,'conceptos','[]'::jsonb)));
 begin perform public.importar_planilla_excel(current_setting('prueba.importacion')::uuid,current_setting('prueba.planilla')::uuid,jsonb_set(v_json,'{0,hoja}','"RESUMEN JULIO MWP - 2099"'));raise exception 'FAIL: importó la hoja de otro mes';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;if sqlerrm not like 'Las boletas tienen que salir de las hojas RESUMEN%' then raise;end if;end;
 v_id:=public.importar_planilla_excel(current_setting('prueba.importacion')::uuid,current_setting('prueba.planilla')::uuid,v_json);
 perform public.importar_planilla_excel(v_id,current_setting('prueba.planilla')::uuid,v_json);
 if (select count(*) from public.planilla_personas where importacion_id=v_id)<>1 or (select monto from public.planilla_personas where importacion_id=v_id)<>1090 then raise exception 'FAIL: costo o reintento de planilla incorrecto';end if;
 if (select detalle->>'empresa' from public.planilla_personas where importacion_id=v_id) is distinct from 'METAL WORK PERU' then raise exception 'FAIL: la persona no guarda la empresa que le paga';end if;
 begin perform public.importar_planilla_excel(gen_random_uuid(),current_setting('prueba.planilla')::uuid,jsonb_build_array(jsonb_build_object('nombre','Otra persona de ensayo','hoja','RESUMEN AGOSTO MWP - 2099','fila',9,'empresa','METAL WORK PERU','detalle',jsonb_build_object('ingresos',1000,'descuentos',100,'aporte_empleador',90,'neto',950))));raise exception 'FAIL: neto falso';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;if sqlerrm not like 'El neto%' then raise;end if;end;
end $$;
reset role;
select 'OK: solo hojas del mes; importación idempotente; empresa guardada; costo bruto más aporte; neto inconsistente rechazado. Ensayo revertido.' comprobacion;
rollback;
