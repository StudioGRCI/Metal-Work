-- Repositorio documental versionado y línea de tiempo unificada de la orden.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000006', 'PRUEBAS DOCS S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');
select test.crear_usuario('Rosa', 'Yupanqui', 'rosa@demo.pe', 'JEFE_TALLER',
         (select id from public.sedes limit 1)) as jefe \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20222222222', 'TRANSPORTES DEL CENTRO S.A.');
insert into public.ordenes_trabajo (cliente_id, sede_id, descripcion)
  select c.id, s.id, 'Tolva 20 m3 con documentación'
    from public.clientes c cross join public.sedes s limit 1;
update public.ordenes_trabajo set estado = 'APROBADA';

-- --- versionado ---------------------------------------------------------------
do $$
declare
  v_ot  uuid;
  v_doc uuid;
begin
  select id into v_ot from public.ordenes_trabajo limit 1;

  insert into public.documentos (tipo_documento_id, titulo, entidad_tabla, entidad_id, orden_id)
  select id, 'Plano de fabricación tolva 20 m3', 'ordenes_trabajo', v_ot, v_ot
    from public.tipos_documento where codigo = 'PLANO'
  returning id into v_doc;

  perform test.afirmar(
    (select version_actual from public.documentos where id = v_doc) = 0,
    'un documento sin archivo todavía no tiene versión');

  insert into public.documento_versiones
    (documento_id, ruta_storage, nombre_archivo, extension, tamano_bytes, comentario)
  values (v_doc, 'ot/' || v_ot || '/plano-v1.pdf', 'plano-v1.pdf', 'pdf', 240000, 'Primera emisión');

  perform test.afirmar(
    (select version_actual from public.documentos where id = v_doc) = 1,
    'la primera versión se numera sola y actualiza la cabecera');

  insert into public.documento_versiones
    (documento_id, ruta_storage, nombre_archivo, extension, tamano_bytes, comentario)
  values (v_doc, 'ot/' || v_ot || '/plano-v2.pdf', 'plano-v2.pdf', 'pdf', 251000,
          'Se corrigió la altura del lateral a 1.55 m');

  perform test.afirmar(
    (select version_actual from public.documentos where id = v_doc) = 2,
    'la segunda versión incrementa el correlativo del documento');
  perform test.afirmar(
    (select count(*) from public.documento_versiones where documento_id = v_doc) = 2,
    'las dos versiones conviven: la anterior no se pisa');

  perform test.debe_fallar(
    format('update public.documento_versiones set ruta_storage = ''otra.pdf''
             where documento_id = %L and version = 1', v_doc),
    'una versión ya publicada es inmutable');

  perform test.debe_fallar(
    format('insert into public.documento_versiones
              (documento_id, ruta_storage, nombre_archivo, extension, tamano_bytes)
            values (%L, ''x.exe'', ''x.exe'', ''exe'', 100)', v_doc),
    'el tipo de documento restringe las extensiones permitidas');
end $$;

-- --- la línea de tiempo reúne todo lo ocurrido en la orden -------------------
do $$
declare
  v_ot     uuid;
  v_eventos int;
begin
  select id into v_ot from public.ordenes_trabajo limit 1;

  perform public.registrar_evento_ot(
    v_ot, 'COMENTARIO', 'El cliente pide adelantar la entrega una semana');

  select count(*) into v_eventos from public.v_ot_timeline where orden_id = v_ot;

  perform test.afirmar(v_eventos > 0, format('la línea de tiempo tiene %s entradas', v_eventos));
  perform test.afirmar(
    exists (select 1 from public.v_ot_timeline
             where orden_id = v_ot and categoria = 'DOCUMENTO'),
    'los documentos adjuntos aparecen en la línea de tiempo');
  perform test.afirmar(
    exists (select 1 from public.v_ot_timeline
             where orden_id = v_ot and detalle like '%adelantar la entrega%'),
    'y también los comentarios del equipo');
  perform test.afirmar(
    (select count(*) from public.v_ot_timeline
      where orden_id = v_ot and ocurrido_en is null) = 0,
    'ninguna entrada de la línea de tiempo queda sin fecha');
end $$;

-- --- documentos obligatorios pendientes --------------------------------------
do $$
declare v_ot uuid;
begin
  select id into v_ot from public.ordenes_trabajo limit 1;

  perform test.afirmar(
    exists (select 1 from public.documentos_obligatorios_faltantes(v_ot)
             where codigo = 'ACTA_CONF'),
    'el acta de conformidad figura como documento obligatorio pendiente');
  perform test.afirmar(
    not exists (select 1 from public.documentos_obligatorios_faltantes(v_ot)
                 where codigo = 'PLANO'),
    'el plano ya no figura como pendiente porque se adjuntó');
end $$;

-- --- un documento anulado deja de contar --------------------------------------
do $$
declare v_ot uuid;
begin
  select id into v_ot from public.ordenes_trabajo limit 1;

  update public.documentos
     set estado = 'ANULADO', motivo_anulacion = 'Plano superado por una revisión posterior'
   where orden_id = v_ot;

  perform test.afirmar(
    exists (select 1 from public.documentos_obligatorios_faltantes(v_ot) where codigo = 'PLANO'),
    'al anular el plano vuelve a exigirse como documento pendiente');
end $$;

rollback;
