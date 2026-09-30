begin;
select set_config('prueba.planilla',gen_random_uuid()::text,true);
select set_config('prueba.importacion',gen_random_uuid()::text,true);
select set_config('request.jwt.claim.sub',(select u.id::text from public.usuarios u join public.roles r on r.id=u.rol_id where r.codigo='RECURSOS_HUMANOS' and u.activo limit 1),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('request.jwt.claim.sub'),'role','authenticated')::text,true);
set local role authenticated;
insert into public.planillas(id,tipo,periodo,moneda)values(current_setting('prueba.planilla')::uuid,'ADMINISTRATIVA','2099-08-01','PEN');
do $$ declare v_json jsonb;v_id uuid;begin
 v_json:=jsonb_build_array(jsonb_build_object('nombre','Persona de ensayo','fila',8,'detalle',jsonb_build_object('ingresos',1000,'descuentos',100,'aporte_empleador',90,'neto',900,'puesto','Prueba','dias',30,'horas',240,'horas_extras',0,'conceptos','[]'::jsonb)));
 begin perform public.importar_detalle_planilla(current_setting('prueba.importacion')::uuid,current_setting('prueba.planilla')::uuid,'RESUMEN AGOSTO JAMISA - 2099',v_json);raise exception 'FAIL: importó otra empresa';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;if sqlerrm not like 'Usa únicamente%' then raise;end if;end;
 v_id:=public.importar_detalle_planilla(current_setting('prueba.importacion')::uuid,current_setting('prueba.planilla')::uuid,'RESUMEN AGOSTO MWP - 2099',v_json);
 perform public.importar_detalle_planilla(v_id,current_setting('prueba.planilla')::uuid,'RESUMEN AGOSTO MWP - 2099',v_json);
 if (select count(*) from public.planilla_personas where importacion_id=v_id)<>1 or (select monto from public.planilla_personas where importacion_id=v_id)<>1090 then raise exception 'FAIL: costo o reintento de planilla incorrecto';end if;
 begin perform public.importar_detalle_planilla(gen_random_uuid(),current_setting('prueba.planilla')::uuid,'RESUMEN AGOSTO MWP - 2099',jsonb_build_array(jsonb_build_object('nombre','Persona de ensayo','fila',9,'detalle',jsonb_build_object('ingresos',1000,'descuentos',100,'aporte_empleador',90,'neto',950))));raise exception 'FAIL: neto falso';exception when others then if sqlerrm like 'FAIL:%' then raise;end if;if sqlerrm not like 'El neto%' then raise;end if;end;
end $$;
reset role;
select 'OK: solo MWP; importación idempotente; costo bruto más aporte; neto inconsistente rechazado. Ensayo revertido.' comprobacion;
rollback;
