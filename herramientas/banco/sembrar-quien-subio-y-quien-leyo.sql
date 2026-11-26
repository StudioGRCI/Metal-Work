-- Siembra del banco para la entrega 6.3 del plan 6: las versiones de los planos
-- y los DXF de SR-101, con quién las subió y si el taller leyó su aviso. Solo
-- para el banco local, sobre mw_demo recién preparado.
--
--   psql -h /tmp -p 5433 -U postgres -d mw_demo -f herramientas/banco/sembrar-quien-subio-y-quien-leyo.sql
--
-- Cada paso lo da la cuenta de Diseño con sus funciones, que son las que mandan
-- el aviso; al final se corren las fechas hacia atrás sin disparadores, la
-- revisión y su aviso juntos, para que sigan siendo del mismo momento.
--   P-01 (Maestranza): R1 hace 3 días, que el supervisor leyó y recibió;
--                      R2 ayer, que todavía no lee.
--   P-02 (Producción): R1 hace 2 días, sin leer.
--   Un envío de dos DXF hace 1 día: Maestranza lo leyó, Producción no.
\set ON_ERROR_STOP on

do $$
declare
  v_diseno uuid := (select id from public.usuarios where correo = 'diseno.local@metalwork.test');
  v_sup_mtz uuid := (select id from public.usuarios where correo = 'sup.mtz.local@metalwork.test');
  v_mtz    uuid := (select id from public.areas where codigo = 'MTZ');
  v_prd    uuid := (select id from public.areas where codigo = 'PRD');
  v_p1 uuid := gen_random_uuid(); v_r1 uuid := gen_random_uuid();
  v_p2 uuid := gen_random_uuid(); v_r2 uuid := gen_random_uuid();
  v_d1 uuid := gen_random_uuid(); v_d2 uuid := gen_random_uuid(); v_env uuid := gen_random_uuid();
begin
  if v_diseno is null or v_sup_mtz is null then
    raise exception 'Faltan las cuentas locales: corre antes preparar.sh.';
  end if;
  if exists (select 1 from public.codigo_planos where codigo_interno = 'SR-101') then
    raise exception 'SR-101 ya tiene planos: rehaz mw_demo para sembrar la entrega 6.3.';
  end if;
  update public.unidades set codigo_interno = 'SR-101' where placa = 'V2G-841' and codigo_interno is null;
  if not exists (select 1 from public.unidades where codigo_interno = 'SR-101') then
    raise exception 'La unidad V2G-841 ya tiene otro código interno: rehaz mw_demo.';
  end if;

  -- Diseño sube: lo que hace Storage al subir, y su función, que avisa al área.
  perform set_config('request.jwt.claim.sub', v_diseno::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_diseno, 'role', 'authenticated')::text, true);
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
    ('planos-codigo', v_p1 || '/' || v_r1 || '.pdf', v_diseno, v_diseno::text, '{"mimetype":"application/pdf","size":81234}'),
    ('planos-codigo', v_p2 || '/' || v_r2 || '.pdf', v_diseno, v_diseno::text, '{"mimetype":"application/pdf","size":64000}');
  perform public.registrar_plano_codigo(v_p1, v_r1, 'SR-101', 'P-01', 'Habilitado de largueros y travesaños', v_mtz, null, 'SR-101 P-01 habilitado.pdf', 40);
  perform public.registrar_plano_codigo(v_p2, v_r2, 'SR-101', 'P-02', 'Ensamble de piso y cajón', v_prd, null, 'SR-101 P-02 ensamble.pdf', 35);

  insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
    ('dxf-codigo', v_d1 || '.dxf', v_diseno, v_diseno::text, '{"mimetype":"application/dxf","size":512000}'),
    ('dxf-codigo', v_d2 || '.zip', v_diseno, v_diseno::text, '{"mimetype":"application/zip","size":2048000}');
  perform public.registrar_dxf_codigo(v_d1, 'SR-101', 'Corte de planchas del chasis', 'largueros.dxf', v_env);
  perform public.registrar_dxf_codigo(v_d2, 'SR-101', 'Corte de planchas del chasis', 'travesanos.zip', v_env);

  -- El supervisor de Maestranza recibe la R1 (su función, con su cuenta).
  perform set_config('request.jwt.claim.sub', v_sup_mtz::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_sup_mtz, 'role', 'authenticated')::text, true);
  perform public.recibir_plano_codigo(v_r1);

  -- Las fechas, hacia atrás: la revisión y su aviso, del mismo momento.
  set local session_replication_role = replica;
  update public.codigo_plano_revisiones set subido_en = now() - interval '3 days', creado_en = now() - interval '3 days',
         recibido_en = now() - interval '3 days' + interval '4 hours'
   where id = v_r1;
  update public.codigo_planos set creado_en = now() - interval '3 days' where id = v_p1;
  update public.notificaciones set creado_en = now() - interval '3 days'
   where origen_tabla = 'codigo_planos' and origen_id = v_p1 and titulo like 'Plano nuevo%';
  update public.codigo_plano_revisiones set subido_en = now() - interval '2 days', creado_en = now() - interval '2 days' where id = v_r2;
  update public.codigo_planos set creado_en = now() - interval '2 days' where id = v_p2;
  update public.notificaciones set creado_en = now() - interval '2 days'
   where origen_tabla = 'codigo_planos' and origen_id = v_p2;
  update public.codigo_dxf set subido_en = now() - interval '1 day' where envio = v_env;
  update public.notificaciones set creado_en = now() - interval '1 day'
   where origen_tabla = 'codigo_dxf' and origen_id in (v_d1, v_d2);
  -- El supervisor de Maestranza leyó el aviso de la R1 y el de los DXF.
  update public.notificaciones set leida_en = now() - interval '3 days' + interval '2 hours'
   where usuario_id = v_sup_mtz and origen_tabla = 'codigo_planos' and origen_id = v_p1;
  update public.notificaciones set leida_en = now() - interval '1 day' + interval '3 hours'
   where usuario_id = v_sup_mtz and origen_tabla = 'codigo_dxf' and origen_id in (v_d1, v_d2);
  set local session_replication_role = origin;
end $$;

-- La R2 de P-01, ayer: la sube Diseño con su función, que avisa otra vez a Maestranza.
do $$
declare
  v_diseno uuid := (select id from public.usuarios where correo = 'diseno.local@metalwork.test');
  v_p1 uuid := (select id from public.codigo_planos where codigo_interno = 'SR-101' and numero = 'P-01');
  v_r uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claim.sub', v_diseno::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_diseno, 'role', 'authenticated')::text, true);
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
    ('planos-codigo', v_p1 || '/' || v_r || '.pdf', v_diseno, v_diseno::text, '{"mimetype":"application/pdf","size":82000}');
  perform public.subir_revision_plano(v_p1, v_r, 'Se alargaron los travesaños 20 mm', 'SR-101 P-01 habilitado R2.pdf');
  set local session_replication_role = replica;
  update public.codigo_plano_revisiones set subido_en = now() - interval '1 day', creado_en = now() - interval '1 day' where id = v_r;
  update public.notificaciones set creado_en = now() - interval '1 day'
   where origen_tabla = 'codigo_planos' and origen_id = v_p1 and titulo like 'Revisión R2%';
  set local session_replication_role = origin;
end $$;

-- Lo que ve Diseño.
select set_config('request.jwt.claim.sub', id::text, false) as a,
       set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, false) as b
  from public.usuarios where correo = 'diseno.local@metalwork.test' \gset
set role authenticated;
select tipo, area, subido_por, subido_en::date, destinatarios, leidos, primera_lectura::date
  from public.quien_subio_y_quien_leyo('SR-101');
reset role;
