-- Siembra del banco para «Insumos por autorizar» (plan 6, entrega 6.2): RQ de
-- unidad que se pasan del metrado de Diseño, cada uno en un punto del circuito,
-- para ver los días en espera, quién pidió y el recorrido tras autorizar.
-- Se corre sobre mw_demo recién preparado: si SR-101 no tiene metrado, lo carga
-- (24 angulares y 6 bisagras). Cada paso lo da la cuenta del puesto; las fechas
-- se corren hacia atrás al final, sin disparadores, para que haya días que contar.
--   A · RQ de Maestranza que espera el visto de Diseño hace 3 días.
--   B · RQ de Producción que lo espera desde ayer.
--   C · RQ que todavía espera el sustento de quien pidió.
--   D · RQ de SR-102 que Diseño ya autorizó: lo tiene Almacén.
--   E · RQ con un insumo que espera el visto y otro sin sustento: el recorrido
--       dice que lo tiene quien pidió, aunque espere a Diseño.
\set ON_ERROR_STOP on

create or replace function pg_temp.como(p_correo text) returns void language plpgsql as $$
declare v uuid := (select id from public.usuarios where correo = p_correo);
begin
  if v is null then raise exception 'No está la cuenta %', p_correo; end if;
  perform set_config('request.jwt.claim.sub', v::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
  perform set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, false);
end $$;
create or replace function pg_temp.linea(p_codigo text, p_cantidad numeric) returns jsonb language sql as $$
  select jsonb_build_object('material_id', (select id from public.materiales where codigo = p_codigo), 'cantidad', p_cantidad);
$$;
create or replace function pg_temp.area(p_codigo text) returns uuid language sql as $$
  select id from public.areas where codigo = p_codigo;
$$;
grant execute on all functions in schema pg_temp to authenticated;

do $$ begin
  if exists (select 1 from public.requerimientos where justificacion like '%(banco 6.2)') then
    raise exception 'El banco ya tiene los RQ de la entrega 6.2: rehaz mw_demo para sembrarlos otra vez.';
  end if;
end $$;

-- Diseño carga el metrado (SR-101, si no lo tiene: 24 y 6; SR-102: 10) ------------
select pg_temp.como('diseno.local@metalwork.test');
set role authenticated;
select public.guardar_material_codigo(null, 'SR-101', (select id from public.materiales where codigo = x.codigo), x.cantidad, null, null)
  from (values ('AE-ET-AC-AM-00017', 24), ('AE-ET-AC-BI-00011', 6)) x(codigo, cantidad)
 where not exists (select 1 from public.codigo_materiales where codigo_interno = 'SR-101' and quitado_en is null);
select public.guardar_material_codigo(null, 'SR-102', (select id from public.materiales where codigo = 'AE-ET-AC-AM-00017'), 10, null,
                                      'Metrado del plano de piso');
reset role;

-- Los supervisores piden de más ---------------------------------------------------
create temp table rq_banco (clave text primary key, id uuid not null default gen_random_uuid());
insert into rq_banco (clave) values ('a'), ('b'), ('c'), ('d'), ('e');
grant select on rq_banco to authenticated;

select pg_temp.como('sup.mtz.local@metalwork.test');
set role authenticated;
-- A: 30 de 24 → se pasa en 6; lo sustenta y espera a Diseño desde hace 3 días.
select public.emitir_requerimiento((select id from rq_banco where clave = 'a'), 'OPERACION', pg_temp.area('MTZ'), 'SR-101',
  'Angulares para el piso y los largueros (banco 6.2)', null, jsonb_build_array(pg_temp.linea('AE-ET-AC-AM-00017', 30)));
select public.sustentar_insumos((select id from rq_banco where clave = 'a'),
  '[{"item":1,"sustento":"El plano de piso no cuenta los refuerzos de las cuatro esquinas: van 6 más."}]');
-- C: 5 más del mismo angular, sin sustento todavía.
select public.emitir_requerimiento((select id from rq_banco where clave = 'c'), 'OPERACION', pg_temp.area('MTZ'), 'SR-101',
  'Angulares de reposición por corte mal hecho (banco 6.2)', null, jsonb_build_array(pg_temp.linea('AE-ET-AC-AM-00017', 5)));
-- D: 14 de 10 en SR-102; lo sustenta y Diseño lo autoriza.
select public.emitir_requerimiento((select id from rq_banco where clave = 'd'), 'OPERACION', pg_temp.area('MTZ'), 'SR-102',
  'Angulares para el chasis de la cisterna (banco 6.2)', null, jsonb_build_array(pg_temp.linea('AE-ET-AC-AM-00017', 14)));
select public.sustentar_insumos((select id from rq_banco where clave = 'd'),
  '[{"item":1,"sustento":"La cisterna lleva dos travesaños más que el modelo del metrado."}]');
-- E: 2 angulares más (se pasa) y 3 bisagras (se pasa); sustenta solo los angulares.
select public.emitir_requerimiento((select id from rq_banco where clave = 'e'), 'OPERACION', pg_temp.area('MTZ'), 'SR-101',
  'Angulares y bisagras para la compuerta (banco 6.2)', null,
  jsonb_build_array(pg_temp.linea('AE-ET-AC-AM-00017', 2), pg_temp.linea('AE-ET-AC-BI-00011', 3)));
select public.sustentar_insumos((select id from rq_banco where clave = 'e'),
  '[{"item":1,"sustento":"La compuerta trasera lleva dos angulares de refuerzo que no están en el plano."}]');
reset role;

select pg_temp.como('sup.prd.local@metalwork.test');
set role authenticated;
-- B: 10 de 6 → se pasa en 4; lo sustenta Producción y espera a Diseño desde ayer.
select public.emitir_requerimiento((select id from rq_banco where clave = 'b'), 'OPERACION', pg_temp.area('PRD'), 'SR-101',
  'Bisagras para las puertas laterales (banco 6.2)', null, jsonb_build_array(pg_temp.linea('AE-ET-AC-BI-00011', 10)));
select public.sustentar_insumos((select id from rq_banco where clave = 'b'),
  '[{"item":1,"sustento":"Las puertas laterales llevan tres bisagras cada una, no dos."}]');
reset role;

select pg_temp.como('diseno.local@metalwork.test');
set role authenticated;
select public.autorizar_insumos((select id from rq_banco where clave = 'd'), '{1}', true, 'Conforme: los travesaños están en el plano P-03.');
reset role;

-- Las fechas, hacia atrás: sin disparadores, para que nada más cambie --------------
set session_replication_role = replica;
-- El metrado se cargó antes que los RQ: lo pedido antes del metrado no se mide.
update public.codigo_materiales set creado_en = now() - interval '10 days' where codigo_interno in ('SR-101', 'SR-102');
update public.requerimientos q set creado_en = now() - (x.dias || ' days')::interval
  from rq_banco b join (values ('a', 5), ('b', 2), ('c', 2), ('d', 6), ('e', 1)) x(clave, dias) on x.clave = b.clave
 where q.id = b.id;
update public.requerimiento_sustentos s set sustentado_en = now() - (x.dias || ' days')::interval, creado_en = now() - (x.dias || ' days')::interval
  from public.requerimiento_lineas l
  join rq_banco b on b.id = l.requerimiento_id
  join (values ('a', 3), ('b', 1), ('d', 4), ('e', 2)) x(clave, dias) on x.clave = b.clave
 where s.requerimiento_linea_id = l.id;
update public.requerimiento_sustentos s set decidido_en = now() - interval '2 days'
  from public.requerimiento_lineas l join rq_banco b on b.id = l.requerimiento_id and b.clave = 'd'
 where s.requerimiento_linea_id = l.id;
set session_replication_role = origin;

select q.numero, q.codigo_interno, m.estado, m.sustentado_en::date, m.decidido_en::date
  from rq_banco b join public.requerimientos q on q.id = b.id
  join public.metrado_de_requerimientos(array[b.id]) m on true
 order by b.clave;
