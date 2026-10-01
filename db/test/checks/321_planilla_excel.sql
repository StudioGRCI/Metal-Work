-- La planilla del mes como la arma Recursos Humanos.
--
-- RR. HH. importa en la planilla de taller dos personas de Metal Work Perú: una
-- de la hoja MWP y otra de la hoja OTROS, cada una con su hoja, fila y empresa.
-- El costo es ingresos más aporte. El mismo envío otra vez no duplica; con
-- otros datos, se rechaza. Una hoja de otro mes no entra. La misma persona
-- —con el nombre en otro orden— no entra otra vez en la planilla
-- administrativa del mismo mes, ni dos veces en un mismo envío. El reparto en
-- partes iguales entre tres OT deja 33.33 + 33.33 + 33.34 a cada persona, y
-- con eso la planilla cierra; cerrada, el reparto ya no cambia. Quien no es de
-- RR. HH. no importa.
begin;

select id as sede_id from public.sedes order by nombre limit 1 \gset
select test.crear_usuario('QA','Personal','qa-321-rrhh@demo.pe','RECURSOS_HUMANOS', :'sede_id') as rrhh_id \gset
select test.crear_usuario('QA','Ventas','qa-321-ventas@demo.pe','VENDEDOR', :'sede_id') as ventas_id \gset

select set_config('prueba.p.taller', gen_random_uuid()::text, true);
select set_config('prueba.p.admin', gen_random_uuid()::text, true);
select set_config('prueba.p.import', gen_random_uuid()::text, true);
select set_config('prueba.p.ot1', gen_random_uuid()::text, true);
select set_config('prueba.p.ot2', gen_random_uuid()::text, true);
select set_config('prueba.p.ot3', gen_random_uuid()::text, true);
select set_config('prueba.p.rrhh', :'rrhh_id', true);

-- Armazón: dos planillas de agosto y tres OT, sin pasar por sus reglas.
set local session_replication_role = replica;
do $armazon$
declare
  v_cliente uuid := gen_random_uuid();
  v_sede uuid := (select id from public.sedes order by nombre limit 1);
  v_rrhh uuid := current_setting('prueba.p.rrhh')::uuid;
begin
  insert into public.planillas (id, tipo, periodo, moneda, estado, registrado_por) values
    (current_setting('prueba.p.taller')::uuid, 'TALLER', '2099-08-01', 'PEN', 'BORRADOR', v_rrhh),
    (current_setting('prueba.p.admin')::uuid, 'ADMINISTRATIVA', '2099-08-01', 'PEN', 'BORRADOR', v_rrhh);
  insert into public.clientes (id, tipo_documento, numero_documento, razon_social) values (v_cliente, 'RUC', '20990000321', 'QA planilla');
  insert into public.ordenes_trabajo (id, numero, cliente_id, sede_id, tipo_trabajo, prioridad, descripcion, estado, fecha_registro)
  select o.id, o.numero, v_cliente, v_sede, 'FABRICACION', 'NORMAL', 'Orden QA de planilla', 'EN_PROCESO', current_date
    from (values (current_setting('prueba.p.ot1')::uuid, '9321-2099'), (current_setting('prueba.p.ot2')::uuid, '9322-2099'),
                 (current_setting('prueba.p.ot3')::uuid, '9323-2099')) o(id, numero);
end;
$armazon$;
set local session_replication_role = origin;

-- Dos boletas de Metal Work Perú, una de cada hoja.
select set_config('prueba.p.lineas', $j$[
  {"nombre": "Huamán Flores, Rosa Elena", "hoja": "RESUMEN AGOSTO MWP - 2099", "fila": 8, "empresa": "METAL WORK PERU S.A.C.",
   "detalle": {"puesto": "Asistente QA", "dias": 30, "horas": 240, "horas_extras": 0, "ingresos": 2500, "descuentos": 325,
               "aporte_empleador": 225, "neto": 2175, "conceptos": [{"tipo": "INGRESO", "clave": "SUELDO", "nombre": "SUELDO", "importe": 2500}],
               "aporte_excel": 225, "avisos": []}},
  {"nombre": "Vilchez Paredes, Mario", "hoja": "RESUMEN AGOSTO OTROS - 2099 ", "fila": 120, "empresa": "METAL WORK PERU S.A.C.",
   "detalle": {"puesto": "Proyectista QA", "dias": 30, "horas": 240, "horas_extras": 6, "ingresos": 2800, "descuentos": 364,
               "aporte_empleador": 0, "neto": 2436, "conceptos": [], "aporte_excel": null, "avisos": []}}
]$j$, true);

set local role authenticated;

select test.como_usuario(:'ventas_id');
select test.debe_fallar($$select public.importar_planilla_excel(current_setting('prueba.p.import')::uuid, current_setting('prueba.p.taller')::uuid, current_setting('prueba.p.lineas')::jsonb)$$,
  'quien no es de RR. HH. no importa la planilla', 'rrhh.gestionar_planillas');

select test.como_usuario(:'rrhh_id');
select public.importar_planilla_excel(current_setting('prueba.p.import')::uuid, current_setting('prueba.p.taller')::uuid, current_setting('prueba.p.lineas')::jsonb);
select test.afirmar(
  (select count(*) = 2 and sum(monto) = 5525.00 from public.planilla_personas where planilla_id = current_setting('prueba.p.taller')::uuid),
  'entran las dos personas de Metal Work, de dos hojas, con costo = ingresos + aporte (2,725 + 2,800)');
select test.afirmar(
  (select origen_hoja = 'RESUMEN AGOSTO OTROS - 2099' and fila_origen = 120 and detalle->>'empresa' = 'METAL WORK PERU S.A.C.'
     from public.planilla_personas where planilla_id = current_setting('prueba.p.taller')::uuid and nombre like 'Vilchez%'),
  'cada persona guarda su hoja, su fila y su empresa');

-- Otra vez el mismo envío: no duplica.
select public.importar_planilla_excel(current_setting('prueba.p.import')::uuid, current_setting('prueba.p.taller')::uuid, current_setting('prueba.p.lineas')::jsonb);
select test.afirmar((select count(*) = 2 from public.planilla_personas where planilla_id = current_setting('prueba.p.taller')::uuid),
  'el mismo envío otra vez no duplica');
select test.debe_fallar($$select public.importar_planilla_excel(current_setting('prueba.p.import')::uuid, current_setting('prueba.p.taller')::uuid,
  jsonb_set(current_setting('prueba.p.lineas')::jsonb, '{0,detalle,ingresos}', '3100'))$$,
  'el mismo envío con otros datos se rechaza', 'otros datos');

-- Otro mes, la misma persona en otra planilla del mes, o dos veces en un envío.
select test.debe_fallar($$select public.importar_planilla_excel(gen_random_uuid(), current_setting('prueba.p.admin')::uuid,
  '[{"nombre": "Persona Nueva QA", "hoja": "RESUMEN JULIO MWP - 2099", "fila": 8, "empresa": null,
     "detalle": {"puesto": "", "dias": 30, "horas": 240, "horas_extras": 0, "ingresos": 1000, "descuentos": 0, "aporte_empleador": 90, "neto": 1000, "conceptos": []}}]'::jsonb)$$,
  'una hoja de otro mes no entra', 'mes y año');
select test.debe_fallar($$select public.importar_planilla_excel(gen_random_uuid(), current_setting('prueba.p.admin')::uuid,
  '[{"nombre": "ROSA ELENA HUAMAN FLORES", "hoja": "RESUMEN AGOSTO -2099", "fila": 40, "empresa": "METAL WORK PERU S.A.C.",
     "detalle": {"puesto": "", "dias": 30, "horas": 240, "horas_extras": 0, "ingresos": 1000, "descuentos": 0, "aporte_empleador": 90, "neto": 1000, "conceptos": []}}]'::jsonb)$$,
  'la misma persona, con el nombre en otro orden, no entra en otra planilla del mes', 'ya está en la planilla de taller');
select test.debe_fallar($$select public.importar_planilla_excel(gen_random_uuid(), current_setting('prueba.p.admin')::uuid,
  '[{"nombre": "Quispe Ramos, Ana", "hoja": "RESUMEN AGOSTO -2099", "fila": 10, "empresa": null,
     "detalle": {"puesto": "", "dias": 30, "horas": 240, "horas_extras": 0, "ingresos": 1000, "descuentos": 0, "aporte_empleador": 90, "neto": 1000, "conceptos": []}},
    {"nombre": "ANA QUISPE RAMOS", "hoja": "RESUMEN AGOSTO OTROS - 2099", "fila": 50, "empresa": null,
     "detalle": {"puesto": "", "dias": 30, "horas": 240, "horas_extras": 0, "ingresos": 1000, "descuentos": 0, "aporte_empleador": 90, "neto": 1000, "conceptos": []}}]'::jsonb)$$,
  'la misma persona dos veces en un envío no entra', 'aparece dos veces');

-- Reparto en partes iguales y cierre.
select test.debe_fallar($$select public.repartir_planilla_en_partes_iguales(current_setting('prueba.p.taller')::uuid,
  array(select id from public.planilla_personas where planilla_id = current_setting('prueba.p.taller')::uuid),
  array[current_setting('prueba.p.ot1')::uuid, current_setting('prueba.p.ot1')::uuid])$$,
  'no se reparte dos veces en la misma OT', 'repetidas');
select public.repartir_planilla_en_partes_iguales(current_setting('prueba.p.taller')::uuid,
  array(select id from public.planilla_personas where planilla_id = current_setting('prueba.p.taller')::uuid),
  array[current_setting('prueba.p.ot1')::uuid, current_setting('prueba.p.ot2')::uuid, current_setting('prueba.p.ot3')::uuid]);
select test.afirmar(
  (select bool_and(total = 100 and n = 3 and mayor = 33.34 and menor = 33.33)
     from (select d.persona_id, sum(d.porcentaje) total, count(*) n, max(d.porcentaje) mayor, min(d.porcentaje) menor
             from public.planilla_distribuciones d join public.planilla_personas p on p.id = d.persona_id
            where p.planilla_id = current_setting('prueba.p.taller')::uuid group by d.persona_id) r),
  'cada persona queda con 33.33 + 33.33 + 33.34 en las tres OT');
select public.cerrar_planilla(current_setting('prueba.p.taller')::uuid);
select test.afirmar((select estado = 'CERRADA' from public.planillas where id = current_setting('prueba.p.taller')::uuid),
  'con el 100 % repartido la planilla cierra');
select test.debe_fallar($$select public.repartir_planilla_en_partes_iguales(current_setting('prueba.p.taller')::uuid,
  array(select id from public.planilla_personas where planilla_id = current_setting('prueba.p.taller')::uuid),
  array[current_setting('prueba.p.ot1')::uuid])$$,
  'cerrada, el reparto ya no cambia', 'cerrada');

reset role;
select 'OK: planilla desde varias hojas con su empresa, sin duplicados en el mes y con reparto en partes iguales. Ensayo revertido.' as comprobacion;
rollback;
