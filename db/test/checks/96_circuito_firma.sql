-- El circuito de la firma: quién la pide, quién la da y qué pasa si alguien
-- intenta firmar en lugar de otro.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000011', 'PRUEBAS FIRMA S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Rosa',  'Yupanqui', 'rosa@demo.pe',  'JEFE_TALLER', (select id from public.sedes limit 1)) as jefe_id \gset
select test.crear_usuario('Lucía', 'Ferrer',   'lucia@demo.pe', 'CALIDAD',     (select id from public.sedes limit 1)) as calidad_id \gset
select test.crear_usuario('Gabriel','Rojas',   'gabriel@demo.pe','GERENTE',    (select id from public.sedes limit 1)) as gerente_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20222222223', 'TRANSPORTES DEL ORIENTE S.A.');
insert into public.ordenes_trabajo (cliente_id, sede_id, descripcion)
  select c.id, s.id, 'Furgón con plano por firmar'
    from public.clientes c cross join public.sedes s limit 1;
update public.ordenes_trabajo set estado = 'APROBADA';

-- Un plano con su archivo: sin archivo no hay nada que firmar.
do $$
declare v_doc uuid; v_ot uuid;
begin
  select id into v_ot from public.ordenes_trabajo limit 1;

  insert into public.documentos (tipo_documento_id, titulo, entidad_tabla, entidad_id, orden_id)
  select id, 'Plano de fabricación del furgón', 'ordenes_trabajo', v_ot, v_ot
    from public.tipos_documento where codigo = 'PLANO'
  returning id into v_doc;

  perform set_config('prueba.documento', v_doc::text, false);
end $$;

-- Los identificadores viajan por parámetros de sesión: psql no sustituye sus
-- variables dentro de un bloque entre dólares.
select set_config('prueba.calidad', :'calidad_id', false);
select set_config('prueba.gerente', :'gerente_id', false);

-- ------------------------------------------- no se firma lo que no está
select test.como_usuario(:'jefe_id');

do $$
declare v_doc uuid := current_setting('prueba.documento')::uuid;
begin
  begin
    perform public.solicitar_firmas(v_doc, array[current_setting('prueba.calidad')::uuid]);
    raise exception 'FALLA: pidió la firma de un documento sin archivo';
  exception when check_violation then
    raise notice '  ok · no se pide la firma de un documento que todavía no tiene archivo';
  end;
end $$;

-- Ahora sí, el archivo.
insert into public.documento_versiones (documento_id, ruta_storage, nombre_archivo, extension, tamano_bytes)
values (current_setting('prueba.documento')::uuid,
        'ot/plano-furgon-r0.pdf', 'plano-furgon-r0.pdf', 'pdf', 184320);

-- ---------------------------------------------------------- la cadena
do $$
declare
  v_doc uuid := current_setting('prueba.documento')::uuid;
  v_n   int;
begin
  v_n := public.solicitar_firmas(
    v_doc,
    array[current_setting('prueba.calidad')::uuid, current_setting('prueba.gerente')::uuid]);

  if v_n <> 2 then
    raise exception 'FALLA: se armaron % firmas en vez de 2', v_n;
  end if;
  if (select orden_firma from public.aprobaciones
       where documento_id = v_doc and aprobador_id = current_setting('prueba.calidad')::uuid) <> 1 then
    raise exception 'FALLA: la cadena no respetó el orden de la lista';
  end if;
  raise notice '  ok · la cadena de firmas queda en el orden en que se pidió';

  if (select estado_aprobacion from public.documentos where id = v_doc) <> 'PENDIENTE' then
    raise exception 'FALLA: el documento no quedó marcado como pendiente de firma';
  end if;
  raise notice '  ok · el documento queda pendiente de firma';
end $$;

-- ------------------------------------------------- nadie firma por otro
select test.como_usuario(:'gerente_id');

do $$
declare
  v_doc uuid := current_setting('prueba.documento')::uuid;
  v_firma_calidad uuid;
begin
  select id into v_firma_calidad from public.aprobaciones
   where documento_id = v_doc and orden_firma = 1;

  begin
    perform public.firmar_documento(v_firma_calidad, 'APROBADO');
    raise exception 'FALLA: el gerente firmó en lugar de calidad';
  exception when insufficient_privilege then
    raise notice '  ok · nadie firma en lugar de otro, ni con el permiso de aprobar';
  end;
end $$;

-- --------------------------------------------- ni se saltea la cadena
do $$
declare
  v_doc uuid := current_setting('prueba.documento')::uuid;
  v_firma_gerencia uuid;
begin
  select id into v_firma_gerencia from public.aprobaciones
   where documento_id = v_doc and orden_firma = 2;

  begin
    perform public.firmar_documento(v_firma_gerencia, 'APROBADO');
    raise exception 'FALLA: la segunda firma pasó antes que la primera';
  exception when check_violation then
    raise notice '  ok · la segunda firma espera a la primera';
  end;
end $$;

-- ---------------------------------------- observar exige decir qué está mal
select test.como_usuario(:'calidad_id');

do $$
declare
  v_doc uuid := current_setting('prueba.documento')::uuid;
  v_firma uuid;
begin
  select id into v_firma from public.aprobaciones where documento_id = v_doc and orden_firma = 1;

  begin
    perform public.firmar_documento(v_firma, 'OBSERVADO');
    raise exception 'FALLA: dejó observar un plano sin decir qué está mal';
  exception when check_violation then
    raise notice '  ok · observar un documento exige explicar qué está mal';
  end;

  perform public.firmar_documento(v_firma, 'OBSERVADO', 'La compuerta no tiene el detalle de los seguros');

  if (select estado_aprobacion from public.documentos where id = v_doc) <> 'OBSERVADO' then
    raise exception 'FALLA: la observación no subió a la cabecera del documento';
  end if;
  raise notice '  ok · la observación queda en la cabecera del documento';

  -- Rectificar la propia firma sí se puede: es la misma persona.
  perform public.firmar_documento(v_firma, 'APROBADO', 'Corregido en la revisión B');

  if (select fecha from public.aprobaciones where id = v_firma) is null then
    raise exception 'FALLA: la firma quedó sin fecha';
  end if;
  if (select version_aprobada from public.aprobaciones where id = v_firma) <> 1 then
    raise exception 'FALLA: la firma no anotó sobre qué versión se decidió';
  end if;
  raise notice '  ok · la firma queda con su fecha y sobre qué versión se dio';
end $$;

-- ------------------------------------------------- la bandeja de cada quien
select test.como_usuario(:'gerente_id');
set role authenticated;

do $$
begin
  perform test.afirmar(
    (select count(*) from public.mis_firmas_pendientes) = 1,
    'el gerente ve en su bandeja el documento que espera su firma');
  perform test.afirmar(
    (select le_toca from public.mis_firmas_pendientes limit 1),
    'y ahora sí le toca, porque calidad ya firmó');
end $$;

reset role;

select test.como_usuario(:'calidad_id');
set role authenticated;

do $$
begin
  perform test.afirmar(
    (select count(*) from public.mis_firmas_pendientes) = 0,
    'calidad ya firmó, así que su bandeja quedó vacía');
end $$;

reset role;

-- ---------------------------------- con todas las firmas, el documento vale
select test.como_usuario(:'gerente_id');

do $$
declare
  v_doc uuid := current_setting('prueba.documento')::uuid;
  v_ot  uuid;
begin
  perform public.firmar_documento(
    (select id from public.aprobaciones where documento_id = v_doc and orden_firma = 2),
    'APROBADO');

  if (select estado_aprobacion from public.documentos where id = v_doc) <> 'APROBADO' then
    raise exception 'FALLA: con todas las firmas el documento debería quedar aprobado';
  end if;
  raise notice '  ok · con todas las firmas el documento queda aprobado';

  select id into v_ot from public.ordenes_trabajo limit 1;
  if exists (
    select 1 from public.documentos_obligatorios_faltantes(v_ot) where codigo = 'PLANO'
  ) then
    raise exception 'FALLA: el plano firmado sigue figurando como pendiente de la OT';
  end if;
  raise notice '  ok · firmado, el plano deja de faltarle a la orden';
end $$;

-- ---------------------------- una versión nueva vuelve a pedir las firmas
do $$
declare v_doc uuid := current_setting('prueba.documento')::uuid;
begin
  insert into public.documento_versiones (documento_id, ruta_storage, nombre_archivo, extension, tamano_bytes)
  values (v_doc, 'ot/plano-furgon-r1.pdf', 'plano-furgon-r1.pdf', 'pdf', 190000);

  if (select estado_aprobacion from public.documentos where id = v_doc) <> 'PENDIENTE' then
    raise exception 'FALLA: subir una revisión nueva no devolvió las firmas a pendiente';
  end if;
  raise notice '  ok · una revisión nueva invalida lo firmado y vuelve a pedir la cadena';
end $$;

rollback;
