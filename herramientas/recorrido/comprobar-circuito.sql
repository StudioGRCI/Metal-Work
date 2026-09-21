-- Metal Work: ejecutar solo en usnbwnemfqyjjkzdizgv, como postgres.
-- Ensayo de las reglas SQL con roles reales; no prueba la subida de archivos.
-- El resultado correcto es una excepción ROLLBACK OK. Nunca quitarla:
-- revierte documentos, avisos, auditoría y correlativos de este ensayo.
do $prueba$
declare
  v_cot uuid := gen_random_uuid();
  v_ot uuid := gen_random_uuid();
  v_acta uuid;
  v_cliente uuid;
  v_tipo uuid;
  v_uid uuid;
  v_roles jsonb;
  v_paso integer;
  v_rol text;
  v_filas integer;
  v_numero text := '999999-2099';
  v_negado boolean;
begin
  select jsonb_object_agg(codigo, id) into v_roles from (
    select distinct on (r.codigo) r.codigo, u.id
      from public.usuarios u join public.roles r on r.id = u.rol_id
     where u.activo and r.codigo in ('VENDEDOR', 'GERENTE', 'ADMINISTRACION', 'JEFE_PRODUCCION', 'JEFE_TALLER', 'OPERARIO')
     order by r.codigo, u.id
  ) cuentas;
  if not (v_roles ?& array['VENDEDOR','GERENTE','ADMINISTRACION','JEFE_PRODUCCION','JEFE_TALLER','OPERARIO']) then
    raise exception 'FALLO: faltan cuentas activas de los roles del circuito';
  end if;
  select id into strict v_cliente from public.clientes order by id limit 1;
  select id into strict v_tipo from public.tipos_carroceria order by id limit 1;
  if exists (select 1 from public.ordenes_trabajo where numero=v_numero) then
    raise exception 'FALLO: el número reservado para el ensayo ya existe';
  end if;

  for v_paso in 1..10 loop
    v_rol := case v_paso when 1 then 'VENDEDOR' when 2 then 'GERENTE'
      when 3 then 'ADMINISTRACION' when 4 then 'JEFE_PRODUCCION'
      when 5 then 'OPERARIO' when 6 then 'JEFE_TALLER' when 7 then 'ADMINISTRACION'
      when 8 then 'JEFE_TALLER' when 9 then 'ADMINISTRACION' else 'JEFE_PRODUCCION' end;
    v_uid := (v_roles ->> v_rol)::uuid;
    perform set_config('request.jwt.claim.sub', v_uid::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    perform set_config('request.jwt.claims', json_build_object('sub',v_uid,'role','authenticated')::text, true);
    set local role authenticated;

    case v_paso
    when 1 then
      insert into public.cotizaciones_pdf
        (id,numero,cliente_id,tipo_carroceria_id,nombre_archivo,ruta_storage,mime_type)
      values (v_cot,'ENSAYO-'||v_cot,v_cliente,v_tipo,'ensayo.pdf','cot/'||v_cot||'/ensayo.pdf','application/pdf');
      v_negado := false;
      begin
        update public.cotizaciones_pdf set estado='APROBADA' where id=v_cot;
        get diagnostics v_filas = row_count;
        v_negado := v_filas=0;
      exception when insufficient_privilege or check_violation then v_negado := true;
      end;
      if not v_negado then raise exception 'FALLO: Ventas aprobó su propia cotización'; end if;
    when 2 then
      update public.cotizaciones_pdf set estado='APROBADA' where id=v_cot;
      get diagnostics v_filas = row_count;
      if v_filas<>1 then raise exception 'FALLO: Gerencia no aprobó una fila'; end if;
    when 3 then
      perform public.emitir_orden_de_cotizacion(v_cot,v_ot,v_numero,'ENSAYO-'||v_ot,
        'SEMIRREMOLQUE',null,null,current_date+30,'ot/'||v_ot||'/ensayo.pdf','ensayo.pdf',100);
      if not exists(select 1 from public.ordenes_trabajo where id=v_ot and estado='APROBADA') then
        raise exception 'FALLO: Administración no emitió la OT aprobada';
      end if;
      if not exists(select 1 from public.ot_etapas where orden_id=v_ot) then
        raise exception 'FALLO: la OT nació sin etapas';
      end if;
    when 4 then
      update public.ordenes_trabajo set estado='EN_PROCESO' where id=v_ot;
      get diagnostics v_filas = row_count;
      if v_filas<>1 then raise exception 'FALLO: Producción no inició la OT'; end if;
      update public.ot_etapas set avance_porcentaje=100,estado='TERMINADA'
       where orden_id=v_ot and estado<>'OMITIDA';
      get diagnostics v_filas = row_count;
      if v_filas=0 then raise exception 'FALLO: Producción no completó las etapas'; end if;
      update public.ordenes_trabajo set estado='TERMINADA' where id=v_ot;
      get diagnostics v_filas = row_count;
      if v_filas<>1 then raise exception 'FALLO: Producción no terminó la OT'; end if;
    when 5 then
      v_negado := false;
      begin
        insert into public.liberaciones_tesoreria(orden_id) values(v_ot);
      exception when insufficient_privilege then v_negado := true;
      end;
      if not v_negado then raise exception 'FALLO: un operario liberó la salida'; end if;
    when 6 then
      v_negado := false;
      begin
        insert into public.ot_entregas(orden_id,recibe_nombre) values(v_ot,'RECEPTOR DE ENSAYO');
      exception when check_violation then v_negado := true;
      end;
      if not v_negado then raise exception 'FALLO: se entregó sin liberación'; end if;
    when 7 then
      insert into public.liberaciones_tesoreria(orden_id,observacion) values(v_ot,'ENSAYO EN ROLLBACK');
    when 8 then
      insert into public.ot_entregas(orden_id,recibe_nombre,garantia_meses)
        values(v_ot,'RECEPTOR DE ENSAYO',12) returning id into v_acta;
      if not exists(select 1 from public.ordenes_trabajo where id=v_ot and estado='ENTREGADA') then
        raise exception 'FALLO: el acta no entregó la OT';
      end if;
    when 9 then
      update public.ordenes_trabajo set estado='FACTURADA' where id=v_ot;
      get diagnostics v_filas = row_count;
      if v_filas<>1 then raise exception 'FALLO: Administración no pudo facturar'; end if;
    when 10 then
      perform public.confirmar_salida_porteria(v_acta);
      if not exists(select 1 from public.ot_entregas where id=v_acta and salida_confirmada_en is not null) then
        raise exception 'FALLO: no quedó confirmado el aviso a portería';
      end if;
    end case;
    reset role;
  end loop;
  raise exception 'ROLLBACK OK: cotización, aprobación, OT, producción, liberación, acta, factura y portería; Ventas y Operario rechazados donde corresponde';
end;
$prueba$;
