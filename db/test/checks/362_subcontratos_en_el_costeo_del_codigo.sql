-- Los subcontratos entran al costeo de su código interno (migración
-- 20261016100000): cada recibo por honorarios vigente suma por su bruto, pagado
-- o por pagar; el anulado no aparece; Gerencia lo ve en el costeo y en la
-- lista, y Requerimientos, Contabilidad y Administración no lo ven por esa
-- puerta. Cada paso con el rol que lo da —nunca ADMIN— y
-- `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

-- Storage como en Supabase: con RLS y escritura para las cuentas (el shim no lo trae).
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['ADMINISTRACION:ADM', 'TESORERIA:TES', 'GERENTE:GGE', 'CONTABILIDAD:CON', 'REQUERIMIENTOS:REQ'] loop
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.362@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 362', lower(replace(v, ':', '.')) || '.362@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  perform set_config('prueba.ruc', (select '1071234567' || d from generate_series(0, 9) d
                                     where public.ruc_es_valido('1071234567' || d) limit 1), true);
  foreach v in array array['sub', 'sc', 'sc2', 'rec1', 'rec2', 'rec3', 'rec4', 'pago1', 'pago2'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.codigo', 'CHK362_SR_O4_1_26/28', true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
end $$;
create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
-- Sube un archivo a Storage como la persona de la sesión y devuelve su ruta.
create or replace function pg_temp.subir(p_subcontrato text, p_mime text) returns text language plpgsql as $$
declare v_ruta text := current_setting('prueba.' || p_subcontrato) || '/' || gen_random_uuid() || '.pdf';
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('subcontratos', v_ruta, public.usuario_actual()::text, jsonb_build_object('mimetype', p_mime, 'size', 84000));
  return v_ruta;
end $$;
-- ============================================ 1. Administración registra y sube; Tesorería paga
do $$
declare v_hoy date := (now() at time zone 'America/Lima')::date;
begin
  perform pg_temp.como('administracion');
  set local role authenticated;
  perform public.guardar_subcontratista(pg_temp.id('sub'), current_setting('prueba.ruc'), 'Soldador de prueba 362',
                                        null, null, null, null, true);
  perform public.registrar_subcontrato(pg_temp.id('sc'), pg_temp.id('sub'), ' ' || lower(current_setting('prueba.codigo')) || ' ',
                                       'Soldadura de la tolva y refuerzos del piso', 'PEN', 3500, null, null);
  perform public.registrar_subcontrato(pg_temp.id('sc2'), pg_temp.id('sub'), current_setting('prueba.codigo'),
                                       'Instalación eléctrica de la cabina', 'USD', 400, null, null);
  -- Con retención: 2,000 brutos, 1,840 netos.
  perform public.registrar_recibo_honorarios(pg_temp.id('rec1'), pg_temp.id('sc'), 'E001-31', v_hoy - 3, 'Primer avance: tolva',
                                             2000, true, pg_temp.subir('sc', 'application/pdf'));
  perform public.registrar_recibo_honorarios(pg_temp.id('rec2'), pg_temp.id('sc'), 'E001-32', v_hoy - 1, null,
                                             900, false, pg_temp.subir('sc', 'application/pdf'));
  perform public.registrar_recibo_honorarios(pg_temp.id('rec3'), pg_temp.id('sc'), 'E001-33', v_hoy, 'Se subió dos veces',
                                             500, false, pg_temp.subir('sc', 'application/pdf'));
  perform public.anular_recibo_honorarios(pg_temp.id('rec3'), 'Era el mismo trabajo del recibo E001-32');
  perform public.registrar_recibo_honorarios(pg_temp.id('rec4'), pg_temp.id('sc2'), 'E001-34', v_hoy, 'Cableado',
                                             300, false, pg_temp.subir('sc2', 'application/pdf'));
  reset role;

  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform public.registrar_pago_recibo_honorarios(pg_temp.id('pago1'), pg_temp.id('rec1'), v_hoy, '00123456',
                                                  pg_temp.subir('sc', 'application/pdf'));
  -- El segundo se paga y el pago se anula: vuelve a esperar.
  perform public.registrar_pago_recibo_honorarios(pg_temp.id('pago2'), pg_temp.id('rec2'), v_hoy, null,
                                                  pg_temp.subir('sc', 'application/pdf'));
  perform public.anular_pago_recibo_honorarios(pg_temp.id('pago2'), 'Se pagó a otra cuenta por error');
  reset role;
end $$;

-- ============================================ 2. Gerencia lo ve en el costeo del código
do $$
declare v_lineas integer; r record;
begin
  perform pg_temp.como('gerente');
  set local role authenticated;
  select count(*) into v_lineas from public.codigo_interno_costeo(current_setting('prueba.codigo')) k
   where k.fuente like 'SUBCONTRATOS%';
  perform test.afirmar(v_lineas = 3, 'tres recibos vigentes en el costeo; el anulado no aparece (salieron ' || v_lineas || ')');

  select * into r from public.codigo_interno_costeo(current_setting('prueba.codigo')) k where k.referencia_id = pg_temp.id('rec1');
  perform test.afirmar(r.fuente = 'SUBCONTRATOS' and r.monto = 2000 and r.moneda = 'PEN' and r.documento = 'E001-31'
      and r.concepto = 'Primer avance: tolva' and r.detalle ~ '^SC-[0-9]{4}-[0-9]{4} · Soldador de prueba 362$',
    'el recibo pagado suma por su bruto (2,000, no los 1,840 netos), con su subcontrato y su subcontratista: ' || coalesce(r.detalle, '—'));

  select * into r from public.codigo_interno_costeo(current_setting('prueba.codigo')) k where k.referencia_id = pg_temp.id('rec2');
  perform test.afirmar(r.fuente = 'SUBCONTRATOS_POR_PAGAR' and r.monto = 900 and r.concepto = 'Soldadura de la tolva y refuerzos del piso',
    'el recibo cuyo pago se anuló espera otra vez, y sin concepto propio lleva el del subcontrato');

  select * into r from public.codigo_interno_costeo(current_setting('prueba.codigo')) k where k.referencia_id = pg_temp.id('rec4');
  perform test.afirmar(r.fuente = 'SUBCONTRATOS_POR_PAGAR' and r.monto = 300 and r.moneda = 'USD',
    'el recibo en dólares va en dólares, sin cambio');

  perform test.afirmar(
    (select count(*) from public.codigo_interno_costeo(' ' || lower(current_setting('prueba.codigo')) || ' ') k
      where k.fuente like 'SUBCONTRATOS%') = 3,
    'el código se busca escrito como sea');

  -- La lista: el código aparece aunque solo tenga subcontratos.
  select * into r from public.codigos_internos_subcontratos() s where s.codigo = current_setting('prueba.codigo');
  perform test.afirmar(r.recibos = 3 and r.subcontratos_pen = 2900 and r.subcontratos_usd = 300
      and r.por_pagar = 2 and r.por_pagar_pen = 900 and r.por_pagar_usd = 300,
    'la lista suma lo mismo: S/ 2,900 y US$ 300 en tres recibos, dos por pagar');
  perform test.afirmar(
    (select count(*) from public.codigos_internos_resumen() s where s.codigo = current_setting('prueba.codigo')) = 1,
    'el código entra a la lista de Gerencia aunque solo tenga subcontratos');
  reset role;
end $$;

-- ============================================ 3. Nadie más lo ve por esta puerta
do $$
begin
  perform pg_temp.como('requerimientos');
  set local role authenticated;
  perform test.afirmar(
    (select count(*) from public.codigo_interno_gasto(current_setting('prueba.codigo'))) = 0
    and (select count(*) from public.codigos_internos_gasto() g where g.codigo = current_setting('prueba.codigo')) = 0,
    'el gasto por código de Requerimientos sigue sin los subcontratos');
  perform test.debe_fallar('select * from public.codigos_internos_subcontratos()', 'Requerimientos no lee la lista de Gerencia', 'codigos_internos.ver');
  reset role;

  perform pg_temp.como('contabilidad');
  set local role authenticated;
  perform test.debe_fallar('select * from public.codigos_internos_subcontratos()',
    'Contabilidad consulta los subcontratos en su pantalla, no el costeo de Gerencia', 'codigos_internos.ver');
  perform test.debe_fallar(format('select * from public.codigo_interno_costeo(%L)', current_setting('prueba.codigo')),
    'ni el costeo del código', 'codigos_internos.ver');
  reset role;

  perform pg_temp.como('administracion');
  set local role authenticated;
  perform test.debe_fallar(format('select * from public.codigo_interno_lineas_subcontrato(%L)', current_setting('prueba.codigo')),
    'la función interna no la llama nadie', 'permission denied');
  perform test.debe_fallar('select * from public.codigos_internos_subcontratos()', 'Administración tampoco lee la lista de Gerencia', 'codigos_internos.ver');
  reset role;
end $$;

rollback;
