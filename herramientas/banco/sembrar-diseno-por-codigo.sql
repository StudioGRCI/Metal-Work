-- Siembra en el banco lo que Diseño lleva en tres unidades, para mirar las
-- pantallas del plan 6 (lo que debe Diseño a cada código, las versiones con su
-- visto del taller) con las cuentas de cada puesto. Solo para el banco local.
--
--   psql -h /tmp -p 5433 -U postgres -d mw_demo -f herramientas/banco/sembrar-diseno-por-codigo.sql
--
-- Se puede correr otra vez: si SR-101 ya tiene planos, no hace nada.
--   SR-101 (OT 0001): ficha técnica, planos de Maestranza (subido 3 días tarde)
--                     y de Producción (con fecha por venir), lista de
--                     materiales, el par de etapas y un envío de DXF. El
--                     supervisor de Maestranza ya leyó el aviso del plano.
--   SR-102 (OT 0002): solo las etapas; el plano de Maestranza ya venció.
--   SR-103 (OT 0003): la OT y nada más: Diseño le debe los cinco puntos.
\set ON_ERROR_STOP on

do $$
declare
  v_diseno uuid := (select id from public.usuarios where correo = 'diseno.local@metalwork.test');
  v_mtz    uuid := (select id from public.areas where codigo = 'MTZ');
  v_prd    uuid := (select id from public.areas where codigo = 'PRD');
  v_hoy    date := (now() at time zone 'America/Lima')::date;
  v_p1 uuid := gen_random_uuid(); v_r1 uuid := gen_random_uuid();
  v_p2 uuid := gen_random_uuid(); v_r2 uuid := gen_random_uuid();
  v_r1b uuid := gen_random_uuid();
  v_d1 uuid := gen_random_uuid(); v_d2 uuid := gen_random_uuid(); v_env uuid := gen_random_uuid();
  v_mat uuid[];
  v_orden uuid;
begin
  if v_diseno is null then
    raise exception 'Falta la cuenta diseno.local: corre antes preparar.sh.';
  end if;
  if exists (select 1 from public.codigo_planos where codigo_interno = 'SR-101') then
    raise notice 'SR-101 ya tiene planos: no se siembra otra vez.';
    return;
  end if;

  update public.unidades set codigo_interno = 'SR-101' where placa = 'V2G-841';
  update public.unidades set codigo_interno = 'SR-102' where placa = 'C4L-118';
  update public.unidades set codigo_interno = 'SR-103' where placa = 'F3P-772';

  perform set_config('request.jwt.claim.sub', v_diseno::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_diseno, 'role', 'authenticated')::text, true);

  -- Las etapas de Diseño: el par de cada juego, con su fecha comprometida.
  perform public.par_de_etapas_codigo('SR-101', 'Chasis y piso');
  perform public.par_de_etapas_codigo('SR-102', 'Chasis y piso');
  update public.codigo_etapas set inicio_plan = v_hoy - 3, fin_plan = v_hoy + 4
   where codigo_interno = 'SR-101' and area_id = v_mtz;
  update public.codigo_etapas set inicio_plan = v_hoy + 5, fin_plan = v_hoy + 12
   where codigo_interno = 'SR-101' and area_id = v_prd;
  update public.codigo_etapas set inicio_plan = v_hoy - 2, fin_plan = v_hoy + 6
   where codigo_interno = 'SR-102' and area_id = v_mtz;
  update public.codigo_etapas set inicio_plan = v_hoy + 3, fin_plan = v_hoy + 10
   where codigo_interno = 'SR-102' and area_id = v_prd;

  -- Los planos de SR-101: lo que hace Storage al subir, y la función de Diseño.
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
    ('planos-codigo', v_p1 || '/' || v_r1 || '.pdf', v_diseno, v_diseno::text, '{"mimetype":"application/pdf","size":81234}'),
    ('planos-codigo', v_p2 || '/' || v_r2 || '.pdf', v_diseno, v_diseno::text, '{"mimetype":"application/pdf","size":64000}');
  perform public.registrar_plano_codigo(v_p1, v_r1, 'SR-101', 'P-01', 'Habilitado de largueros y travesaños', v_mtz, null, 'SR-101 P-01 habilitado.pdf', 40);
  perform public.registrar_plano_codigo(v_p2, v_r2, 'SR-101', 'P-02', 'Ensamble de piso y cajón', v_prd, null, 'SR-101 P-02 ensamble.pdf', 35);

  -- El supervisor de Maestranza leyó su aviso del P-01; el de Producción todavía no.
  update public.notificaciones n set leida_en = now()
    from public.usuarios u join public.areas a on a.id = u.area_id and a.codigo = 'MTZ'
   where n.usuario_id = u.id and n.origen_tabla = 'codigo_planos' and n.origen_id = v_p1;

  -- La revisión 2 del P-01, con su propio aviso, todavía sin leer.
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
    ('planos-codigo', v_p1 || '/' || v_r1b || '.pdf', v_diseno, v_diseno::text, '{"mimetype":"application/pdf","size":82000}');

  -- La lista de materiales: dos líneas del catálogo.
  select array_agg(id) into v_mat from (select id from public.materiales where activo order by codigo limit 2) m;
  perform public.guardar_material_codigo(null, 'SR-101', v_mat[1], 24, v_p1, null);
  perform public.guardar_material_codigo(null, 'SR-101', v_mat[2], 6, null, null);

  -- Un envío de dos DXF para el corte.
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
    ('dxf-codigo', v_d1 || '.dxf', v_diseno, v_diseno::text, '{"mimetype":"application/dxf","size":512000}'),
    ('dxf-codigo', v_d2 || '.zip', v_diseno, v_diseno::text, '{"mimetype":"application/zip","size":2048000}');
  perform public.registrar_dxf_codigo(v_d1, 'SR-101', 'Corte de planchas del chasis', 'largueros.dxf', v_env);
  perform public.registrar_dxf_codigo(v_d2, 'SR-101', 'Corte de planchas del chasis', 'travesanos.zip', v_env);

  -- La ficha técnica del camión, adjunta a la OT de SR-101.
  select o.id into v_orden from public.ordenes_trabajo o join public.unidades u on u.id = o.unidad_id where u.codigo_interno = 'SR-101' limit 1;
  insert into storage.objects (bucket_id, name, owner, owner_id, metadata) values
    ('adjuntos-ot', 'ot/' || v_orden || '/ficha-sr-101.pdf', v_diseno, v_diseno::text, '{"mimetype":"application/pdf","size":120000}');
  insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, subido_por)
  values (v_orden, 'FICHA_VEHICULO', 'Ficha técnica Volvo FH.pdf', 'ot/' || v_orden || '/ficha-sr-101.pdf', v_diseno);

  perform set_config('banco.p1', v_p1::text, false);
  perform set_config('banco.r1b', v_r1b::text, false);
end $$;

-- La revisión 2 en otra transacción: así su hora y su aviso son otros que los de la primera.
do $$
declare
  v_diseno uuid := (select id from public.usuarios where correo = 'diseno.local@metalwork.test');
  v_p1 uuid := nullif(current_setting('banco.p1', true), '')::uuid;
  v_r1b uuid := nullif(current_setting('banco.r1b', true), '')::uuid;
begin
  if v_p1 is null then return; end if;
  perform set_config('request.jwt.claim.sub', v_diseno::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_diseno, 'role', 'authenticated')::text, true);
  perform public.subir_revision_plano(v_p1, v_r1b, 'Se alargaron los travesaños 20 mm', 'SR-101 P-01 habilitado R2.pdf');
end $$;
