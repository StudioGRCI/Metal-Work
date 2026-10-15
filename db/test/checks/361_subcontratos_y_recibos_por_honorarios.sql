-- Subcontratos y recibos por honorarios (migraciones 20261015220000 y 221000):
-- Administración lleva el padrón y el subcontrato por código interno y sube
-- cada RxH; Tesorería lo paga con su voucher y Administración ve el pago;
-- Gerencia y Contabilidad consultan. Cada paso con el rol que lo da —nunca
-- ADMIN— y `set local role authenticated`. Termina en rollback.
begin;

-- Storage como en Supabase: con RLS y escritura para las cuentas (el shim no lo trae).
alter table storage.objects enable row level security;
grant select, insert, delete on storage.objects to authenticated;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['ADMINISTRACION:ADM', 'TESORERIA:TES', 'GERENTE:GGE', 'CONTABILIDAD:CON', 'SUPERVISOR:MTZ', 'COMPRADOR:LOG'] loop
    -- Cada área tiene una sola Supervisión activa (migración 20260929110100):
    -- si la base ya tiene la de Maestranza, el check usa esa.
    if split_part(v, ':', 1) = 'SUPERVISOR' then
      select u.id into v_id from public.usuarios u
        join public.roles r on r.id = u.rol_id and r.codigo = 'SUPERVISOR'
        join public.areas a on a.id = u.area_id and a.codigo = split_part(v, ':', 2)
       where u.activo limit 1;
      if found then
        perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
        continue;
      end if;
    end if;
    v_id := gen_random_uuid();
    insert into auth.users (id, email) values (v_id, lower(replace(v, ':', '.')) || '.360@prueba.local');
    insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
    select v_id, split_part(v, ':', 1), 'Check 360', lower(replace(v, ':', '.')) || '.360@prueba.local', r.id,
           (select id from public.areas where codigo = split_part(v, ':', 2))
      from public.roles r where r.codigo = split_part(v, ':', 1);
    perform set_config('prueba.' || lower(split_part(v, ':', 1)), v_id::text, true);
  end loop;
  -- Un RUC 10 con su dígito de control bien puesto, sacado del validador.
  perform set_config('prueba.ruc', (select '1071234567' || d from generate_series(0, 9) d
                                     where public.ruc_es_valido('1071234567' || d) limit 1), true);
  perform set_config('prueba.ruc2', (select '1040000000' || d from generate_series(0, 9) d
                                      where public.ruc_es_valido('1040000000' || d) limit 1), true);
  foreach v in array array['sub', 'sub2', 'sc', 'sc2', 'rec1', 'rec2', 'rec3', 'pago1', 'pago2'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
  perform set_config('prueba.arch1', current_setting('prueba.sc') || '/' || gen_random_uuid() || '.pdf', true);
  perform set_config('prueba.arch2', current_setting('prueba.sc') || '/' || gen_random_uuid() || '.pdf', true);
  perform set_config('prueba.voucher1', current_setting('prueba.sc') || '/' || gen_random_uuid() || '.jpg', true);
  perform set_config('prueba.voucher2', current_setting('prueba.sc') || '/' || gen_random_uuid() || '.pdf', true);
end $$;

create or replace function pg_temp.como(p_clave text) returns void language plpgsql as $$
begin
  perform test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
end $$;

-- Sube un archivo a Storage como la persona de la sesión.
create or replace function pg_temp.subir(p_ruta text, p_mime text) returns void language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, owner_id, metadata)
  values ('subcontratos', p_ruta, public.usuario_actual()::text, jsonb_build_object('mimetype', p_mime, 'size', 84000));
end $$;

-- ============================================ 1. Cada puesto con su permiso
do $$
begin
  perform pg_temp.como('administracion');
  perform test.afirmar(public.tiene_permiso('subcontratos.gestionar') and not public.tiene_permiso('subcontratos.pagar'),
    'Administración gestiona y no paga');
  perform pg_temp.como('tesoreria');
  perform test.afirmar(public.tiene_permiso('subcontratos.pagar') and not public.tiene_permiso('subcontratos.gestionar'),
    'Tesorería paga y no gestiona');
  perform pg_temp.como('gerente');
  perform test.afirmar(public.tiene_permiso('subcontratos.ver') and not public.tiene_permiso('subcontratos.pagar'),
    'Gerencia consulta');
  perform pg_temp.como('contabilidad');
  perform test.afirmar(public.tiene_permiso('subcontratos.ver'), 'Contabilidad consulta');
  perform pg_temp.como('supervisor');
  perform test.afirmar(not public.puede_ver_subcontratos(), 'un supervisor no ve los subcontratos');
end $$;

-- ============================================ 2. El padrón de subcontratistas
do $$
declare v uuid;
begin
  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform test.debe_fallar(format('select public.guardar_subcontratista(%L, %L, ''Juan Pérez'', null, null, null, null, true)',
      current_setting('prueba.sub'), current_setting('prueba.ruc')),
    'Tesorería no da de alta subcontratistas', 'subcontratos.gestionar');
  reset role;

  perform pg_temp.como('administracion');
  set local role authenticated;
  perform test.debe_fallar(format('select public.guardar_subcontratista(%L, ''20600000340'', ''Talleres SAC'', null, null, null, null, true)',
      current_setting('prueba.sub')), 'una empresa (RUC 20) no es subcontratista por honorarios', 'persona natural');
  perform test.debe_fallar(format('select public.guardar_subcontratista(%L, ''10712345670'', ''Juan Pérez'', null, null, null, null, true)',
      current_setting('prueba.sub')), 'un RUC con el dígito de control mal no entra', 'no es válido');
  perform test.debe_fallar(format('select public.guardar_subcontratista(%L, %L, ''Juan Pérez'', null, null, ''191-1234567-0-12'', null, true)',
      current_setting('prueba.sub'), current_setting('prueba.ruc')), 'una cuenta sin banco no entra', 'banco');
  v := public.guardar_subcontratista(current_setting('prueba.sub')::uuid, ' ' || current_setting('prueba.ruc') || ' ',
         'Juan  Pérez Soldador', '999 111 222', 'BCP', '191-1234567-0-12', null, true);
  perform test.afirmar((select nombre = 'Juan Pérez Soldador' and numero_cuenta = '1911234567012'
                          from public.subcontratistas where id = v), 'entra con el nombre y la cuenta limpios');
  perform test.debe_fallar(format('select public.guardar_subcontratista(%L, %L, ''Otro nombre'', null, null, null, null, true)',
      current_setting('prueba.sub2'), current_setting('prueba.ruc')), 'el mismo RUC no entra dos veces', 'ya está en el padrón');
  v := public.guardar_subcontratista(current_setting('prueba.sub2')::uuid, current_setting('prueba.ruc2'),
         'Pedro Pintor', null, null, null, null, false);
  perform test.debe_fallar('insert into public.subcontratistas (ruc, nombre) values (''10400000001'', ''Directo'')',
    'nadie escribe el padrón por fuera de la función', 'permission denied');
  reset role;
end $$;

-- ============================================ 3. El subcontrato, por código interno
do $$
declare v uuid; r public.subcontratos;
begin
  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform test.debe_fallar(format('select public.registrar_subcontrato(%L, %L, ''PLANTA'', ''Soldadura de la tolva'', ''PEN'', 3000, null, null)',
      current_setting('prueba.sc'), current_setting('prueba.sub')), 'Tesorería no registra subcontratos', 'subcontratos.gestionar');
  reset role;

  perform pg_temp.como('administracion');
  set local role authenticated;
  perform test.debe_fallar(format('select public.registrar_subcontrato(%L, %L, '' '', ''Soldadura de la tolva'', ''PEN'', 3000, null, null)',
      current_setting('prueba.sc'), current_setting('prueba.sub')), 'sin código interno no se registra', 'código interno');
  perform test.debe_fallar(format('select public.registrar_subcontrato(%L, %L, ''PLANTA'', ''Soldadura de la tolva'', ''PEN'', 3000, null, null)',
      current_setting('prueba.sc'), current_setting('prueba.sub2')), 'un subcontratista dado de baja no recibe trabajo', 'dado de baja');
  v := public.registrar_subcontrato(current_setting('prueba.sc')::uuid, current_setting('prueba.sub')::uuid,
         '  pla_sr_o4_1_26/28 ', 'Soldadura de la tolva y refuerzos del piso', 'PEN', 3000, null, null);
  -- El mismo formulario dos veces no registra otro.
  v := public.registrar_subcontrato(current_setting('prueba.sc')::uuid, current_setting('prueba.sub')::uuid,
         'PLA_SR_O4_1_26/28', 'Soldadura de la tolva y refuerzos del piso', 'PEN', 3000, null, null);
  select * into r from public.subcontratos where id = v;
  perform test.afirmar(r.codigo_interno = 'PLA_SR_O4_1_26/28' and r.numero ~ '^SC-[0-9]{4}-[0-9]{4}$' and r.estado = 'VIGENTE'
    and (select count(*) from public.subcontratos where creado_en >= now()) = 1,
    'queda uno, con número SC y el código en mayúsculas: ' || r.numero);
  perform test.debe_fallar(format('update public.subcontratos set monto = 1 where id = %L', v),
    'nadie lo cambia por fuera de la función', 'permission denied');
  perform test.afirmar('PLA_SR_O4_1_26/28' in (select codigo from public.subcontratos_codigos_internos()),
    'su código sale en la lista para elegir');
  reset role;
end $$;

-- ============================================ 4. Administración sube los recibos
do $$
declare v uuid; r public.recibos_honorarios;
begin
  -- Un supervisor no sube nada al bucket.
  perform pg_temp.como('supervisor');
  set local role authenticated;
  perform test.debe_fallar(format('select pg_temp.subir(%L, ''application/pdf'')', current_setting('prueba.arch1')),
    'un supervisor no sube archivos de subcontratos', 'row-level security');
  reset role;

  perform pg_temp.como('administracion');
  set local role authenticated;
  perform test.debe_fallar(format('select public.registrar_recibo_honorarios(%L, %L, ''E001-25'', current_date, null, 2000, true, %L)',
      current_setting('prueba.rec1'), current_setting('prueba.sc'), current_setting('prueba.arch1')),
    'sin el archivo subido no entra', 'no terminó de subir');
  perform pg_temp.subir(current_setting('prueba.arch1'), 'application/pdf');
  perform test.debe_fallar(format('select public.registrar_recibo_honorarios(%L, %L, ''25'', current_date, null, 2000, true, %L)',
      current_setting('prueba.rec1'), current_setting('prueba.sc'), current_setting('prueba.arch1')),
    'el número va con su serie', 'la serie');
  perform test.debe_fallar(format('select public.registrar_recibo_honorarios(%L, %L, ''E001-25'', current_date + 3, null, 2000, true, %L)',
      current_setting('prueba.rec1'), current_setting('prueba.sc'), current_setting('prueba.arch1')),
    'un recibo del futuro no entra', 'fecha de emisión');
  v := public.registrar_recibo_honorarios(current_setting('prueba.rec1')::uuid, current_setting('prueba.sc')::uuid,
         ' e001-25 ', (now() at time zone 'America/Lima')::date - 2, 'Primer avance: tolva', 2000, true, current_setting('prueba.arch1'));
  select * into r from public.recibos_honorarios where id = v;
  perform test.afirmar(r.numero = 'E001-25' and r.retencion_porcentaje = 8 and r.retencion_monto = 160 and r.monto_neto = 1840
    and r.moneda = 'PEN' and r.archivo_mime = 'application/pdf',
    'con retención: 2,000 brutos, 160 retenidos (8 %) y 1,840 netos');
  perform pg_temp.subir(current_setting('prueba.arch2'), 'application/pdf');
  perform test.debe_fallar(format('select public.registrar_recibo_honorarios(%L, %L, ''E001-25'', current_date, null, 900, false, %L)',
      current_setting('prueba.rec2'), current_setting('prueba.sc'), current_setting('prueba.arch2')),
    'el mismo número del mismo emisor no entra dos veces', 'ya está registrado');
  perform test.debe_fallar(format('select public.registrar_recibo_honorarios(%L, %L, ''E001-26'', current_date, null, 900, false, %L)',
      current_setting('prueba.rec2'), current_setting('prueba.sc'), current_setting('prueba.arch1')),
    'el archivo de otro recibo no se reusa', 'ya está adjunto');
  v := public.registrar_recibo_honorarios(current_setting('prueba.rec2')::uuid, current_setting('prueba.sc')::uuid,
         'E001-26', (now() at time zone 'America/Lima')::date, null, 900, false, current_setting('prueba.arch2'));
  perform test.afirmar((select retencion_monto = 0 and monto_neto = 900 from public.recibos_honorarios where id = v),
    'sin retención, el neto es el bruto');
  perform test.debe_fallar(format('update public.recibos_honorarios set monto_bruto = 1 where id = %L', v),
    'el recibo no se cambia por fuera', 'permission denied');
  reset role;

  perform test.afirmar((select count(*) from public.notificaciones
                         where usuario_id = current_setting('prueba.tesoreria')::uuid and ruta = '/tesoreria/recibos-por-honorarios') = 2,
    'a Tesorería le llegan los dos avisos para pagar');
end $$;

-- ============================================ 5. Quién lo ve
do $$
declare k text;
begin
  foreach k in array array['tesoreria', 'gerente', 'contabilidad'] loop
    perform pg_temp.como(k);
    set local role authenticated;
    -- Solo lo de este check (now() es el inicio de la transacción), aunque la base traiga otros.
    perform test.afirmar((select count(*) from public.subcontratos where creado_en >= now()) = 1
      and (select count(*) from public.recibos_honorarios where creado_en >= now()) = 2
      and (select count(*) from public.subcontratistas where creado_en >= now()) = 2
      and (select count(*) from storage.objects where bucket_id = 'subcontratos' and name like current_setting('prueba.sc') || '/%') = 2,
      k || ' ve el subcontrato, sus dos recibos, el padrón y los dos PDF');
    reset role;
  end loop;
  foreach k in array array['supervisor', 'comprador'] loop
    perform pg_temp.como(lower(k));
    set local role authenticated;
    perform test.afirmar((select count(*) from public.subcontratos) = 0 and (select count(*) from public.recibos_honorarios) = 0
      and (select count(*) from public.subcontratistas) = 0 and (select count(*) from public.pagos_recibo_honorarios) = 0
      and (select count(*) from storage.objects where bucket_id = 'subcontratos') = 0,
      lower(k) || ' NO ve subcontratos, recibos, padrón ni archivos');
    perform test.debe_fallar('select * from public.subcontratos_codigos_internos()', lower(k) || ' no lee la lista de códigos', 'subcontratos.gestionar');
    reset role;
  end loop;
end $$;

-- ============================================ 6. Tesorería paga con su voucher
do $$
declare v uuid; p public.pagos_recibo_honorarios;
begin
  perform pg_temp.como('administracion');
  set local role authenticated;
  perform test.debe_fallar(format('select public.registrar_pago_recibo_honorarios(%L, %L, current_date, null, %L)',
      current_setting('prueba.pago1'), current_setting('prueba.rec1'), current_setting('prueba.arch1')),
    'Administración no paga', 'subcontratos.pagar');
  reset role;

  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform pg_temp.subir(current_setting('prueba.voucher1'), 'image/jpeg');
  perform test.debe_fallar(format('select public.registrar_pago_recibo_honorarios(%L, %L, current_date - 10, null, %L)',
      current_setting('prueba.pago1'), current_setting('prueba.rec1'), current_setting('prueba.voucher1')),
    'no se paga antes de la fecha del recibo', 'desde la fecha del recibo');
  v := public.registrar_pago_recibo_honorarios(current_setting('prueba.pago1')::uuid, current_setting('prueba.rec1')::uuid,
         (now() at time zone 'America/Lima')::date, ' 00123456 ', current_setting('prueba.voucher1'));
  select * into p from public.pagos_recibo_honorarios where id = v;
  perform test.afirmar(p.monto = 1840 and p.operacion = '00123456' and p.voucher_mime = 'image/jpeg',
    'paga el neto, 1,840, con su voucher y su operación');
  perform pg_temp.subir(current_setting('prueba.voucher2'), 'application/pdf');
  perform test.debe_fallar(format('select public.registrar_pago_recibo_honorarios(%L, %L, current_date, null, %L)',
      current_setting('prueba.pago2'), current_setting('prueba.rec1'), current_setting('prueba.voucher2')),
    'un recibo pagado no se paga dos veces', 'ya está pagado');
  reset role;

  -- Administración ve el pago y abre su voucher.
  perform pg_temp.como('administracion');
  set local role authenticated;
  perform test.afirmar((select count(*) from public.pagos_recibo_honorarios where recibo_id = current_setting('prueba.rec1')::uuid) = 1
    and (select count(*) from storage.objects where name = current_setting('prueba.voucher1')) = 1,
    'Administración ve el pago y su voucher');
  perform test.debe_fallar(format('select public.anular_recibo_honorarios(%L, ''Se registró con el monto equivocado'')', current_setting('prueba.rec1')),
    'un recibo pagado no lo anula Administración', 'primero Tesorería anula su pago');
  reset role;
  perform test.afirmar((select count(*) from public.notificaciones
                         where usuario_id = current_setting('prueba.administracion')::uuid
                           and ruta = '/subcontratos/' || current_setting('prueba.sc')) = 1,
    'a Administración le llega el aviso del pago');

  -- Un pago mal registrado se anula y se registra otra vez.
  perform pg_temp.como('tesoreria');
  set local role authenticated;
  perform test.debe_fallar(format('select public.anular_pago_recibo_honorarios(%L, ''corto'')', v), 'anular pide motivo', 'por qué se anula');
  v := public.anular_pago_recibo_honorarios(current_setting('prueba.pago1')::uuid, 'El voucher era de otra transferencia');
  v := public.registrar_pago_recibo_honorarios(current_setting('prueba.pago2')::uuid, current_setting('prueba.rec1')::uuid,
         (now() at time zone 'America/Lima')::date, null, current_setting('prueba.voucher2'));
  perform test.afirmar((select count(*) from public.pagos_recibo_honorarios where recibo_id = current_setting('prueba.rec1')::uuid) = 2
    and (select count(*) from public.pagos_recibo_honorarios where recibo_id = current_setting('prueba.rec1')::uuid and anulado_en is null) = 1,
    'quedan los dos pagos: el anulado, como evidencia, y el vigente');
  reset role;
end $$;

-- ============================================ 7. Anular, terminar y lo que no se borra
do $$
declare v uuid;
begin
  perform pg_temp.como('administracion');
  set local role authenticated;
  v := public.anular_recibo_honorarios(current_setting('prueba.rec2')::uuid, 'El recibo vino con el monto equivocado');
  perform test.afirmar((select anulado_en is not null from public.recibos_honorarios where id = v), 'un recibo sin pago se anula');
  perform test.debe_fallar(format('select public.anular_subcontrato(%L, ''Se registró dos veces por error'')', current_setting('prueba.sc')),
    'con un recibo vigente el subcontrato no se anula', 'recibos por honorarios vigentes');
  v := public.corregir_subcontrato(current_setting('prueba.sc')::uuid, 'PLA_SR_O4_2_26/28', 'Soldadura de la tolva y refuerzos del piso',
         3500, null, null);
  perform test.afirmar((select codigo_interno = 'PLA_SR_O4_2_26/28' and monto = 3500 from public.subcontratos where id = v),
    'mientras está vigente se corrigen el código y lo pactado');
  v := public.cambiar_estado_subcontrato(current_setting('prueba.sc')::uuid, 'TERMINADO');
  perform pg_temp.subir(current_setting('prueba.sc') || '/' || current_setting('prueba.rec3') || '.pdf', 'application/pdf');
  perform test.debe_fallar(format('select public.registrar_recibo_honorarios(%L, %L, ''E001-30'', current_date, null, 500, false, %L)',
      current_setting('prueba.rec3'), current_setting('prueba.sc'), current_setting('prueba.sc') || '/' || current_setting('prueba.rec3') || '.pdf'),
    'un subcontrato terminado no recibe recibos', 'terminado');
  perform test.debe_fallar(format('select public.corregir_subcontrato(%L, ''PLANTA'', ''Soldadura de la tolva y refuerzos'', 3500, null, null)',
      current_setting('prueba.sc')), 'terminado no se corrige', 'terminado');
  v := public.cambiar_estado_subcontrato(current_setting('prueba.sc')::uuid, 'VIGENTE');
  perform test.afirmar((select estado = 'VIGENTE' and terminado_en is null from public.subcontratos where id = v), 'se reabre');

  -- Uno registrado por error, sin recibos, se anula y queda congelado.
  v := public.registrar_subcontrato(current_setting('prueba.sc2')::uuid, current_setting('prueba.sub')::uuid,
         'PLANTA', 'Pintura del portón de la planta', 'USD', 400, null, null);
  v := public.anular_subcontrato(v, 'Se registró en dólares por error');
  perform test.debe_fallar(format('select public.cambiar_estado_subcontrato(%L, ''VIGENTE'')', v), 'anulado no se reabre', 'anulado');
  perform test.debe_fallar(format('select pg_temp.subir(%L, ''application/pdf'')', v || '/' || gen_random_uuid() || '.pdf'),
    'a un subcontrato anulado no se le sube nada', 'row-level security');
  reset role;

  -- Ni el dueño de la base borra o reescribe lo registrado.
  perform test.debe_fallar(format('update public.recibos_honorarios set monto_bruto = 1 where id = %L', current_setting('prueba.rec1')),
    'el recibo no se corrige ni por debajo', 'no se corrige');
  perform test.debe_fallar(format('update public.recibos_honorarios set motivo_anulacion = ''Otra cosa distinta'' where id = %L', current_setting('prueba.rec2')),
    'un recibo anulado queda congelado', 'anulado');
  perform test.debe_fallar(format('delete from public.pagos_recibo_honorarios where id = %L', current_setting('prueba.pago1')),
    'un pago no se borra', 'no se borran');
  perform test.debe_fallar(format('delete from public.subcontratos where id = %L', current_setting('prueba.sc2')),
    'un subcontrato no se borra', 'no se borra');
  perform test.debe_fallar(format('update public.subcontratos set subcontratista_id = %L where id = %L',
      current_setting('prueba.sub2'), current_setting('prueba.sc')),
    'el subcontratista de un subcontrato no cambia', 'no cambian');
end $$;

-- ============================================ 8. Puertas
do $$
declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and p.proname in ('guardar_subcontratista', 'registrar_subcontrato', 'corregir_subcontrato', 'cambiar_estado_subcontrato',
                                'anular_subcontrato', 'registrar_recibo_honorarios', 'anular_recibo_honorarios',
                                'registrar_pago_recibo_honorarios', 'anular_pago_recibo_honorarios', 'subcontratos_codigos_internos',
                                'puede_ver_subcontratos', 'subcontrato_archivo', 'subcontrato_datos_validos',
                                'fn_subcontrato_guardia', 'fn_subcontratista_guardia', 'fn_subcontrato_documento_guardia') loop
    perform test.afirmar(not has_function_privilege('anon', f, 'execute'), 'anon no ejecuta ' || f);
  end loop;
  perform test.afirmar(not has_function_privilege('authenticated', 'public.subcontrato_archivo(uuid, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.fn_subcontrato_documento_guardia()', 'execute'),
    'los ayudantes internos no los llama la gente');
  perform test.afirmar((select bool_and(c.relrowsecurity) from pg_class c
                         where c.oid in ('public.subcontratistas'::regclass, 'public.subcontratos'::regclass,
                                         'public.recibos_honorarios'::regclass, 'public.pagos_recibo_honorarios'::regclass)),
    'las cuatro tablas tienen RLS');
  perform test.afirmar(not has_table_privilege('anon', 'public.subcontratos', 'select')
    and not has_table_privilege('authenticated', 'public.recibos_honorarios', 'insert'),
    'anon no lee y nadie inserta directo');
end $$;

rollback;
