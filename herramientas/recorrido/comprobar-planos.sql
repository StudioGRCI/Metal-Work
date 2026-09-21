-- Bloque de regresión para insertar en el paso 4 de comprobar-circuito.sql.
-- Hereda v_ot (OT aprobada). Todo el circuito termina en ROLLBACK OK.
declare
  t_plano uuid:=gen_random_uuid();
  t_version uuid:=gen_random_uuid();
  t_segunda uuid:=gen_random_uuid();
  t_area uuid;
  t_diseno uuid;
  t_cuentas jsonb;
  t_uid uuid;
  t_paso integer;
  t_negado boolean;
  t_filas integer;
begin
  reset role;
  select id into strict t_area from public.areas where codigo='MTZ';
  select jsonb_object_agg(clave,id) into t_cuentas from (
    select distinct on (r.codigo,coalesce(a.codigo,''))
      r.codigo||':'||coalesce(a.codigo,'') clave,u.id
    from public.usuarios u join public.roles r on r.id=u.rol_id
    left join public.areas a on a.id=u.area_id where u.activo order by r.codigo,coalesce(a.codigo,''),u.id
  ) q;
  t_diseno:=(t_cuentas->>'DISENO:DIS')::uuid;
  if t_diseno is null then raise exception 'FALLO: falta cuenta de Diseño'; end if;
  -- Solo metadatos dentro de rollback. No crea un PDF en el servicio Storage.
  insert into storage.objects(bucket_id,name,owner_id,metadata) values
    ('planos-privados',t_diseno::text||'/'||t_version::text||'.pdf',t_diseno::text,'{"mimetype":"application/pdf","size":100}'::jsonb),
    ('planos-privados',t_diseno::text||'/'||t_segunda::text||'.pdf',t_diseno::text,'{"mimetype":"application/pdf","size":100}'::jsonb);
  for t_paso in 1..11 loop
    t_uid:=(t_cuentas->>case t_paso
      when 1 then 'DISENO:DIS' when 2 then 'VENDEDOR:GCO' when 3 then 'ADMINISTRACION:ADM'
      when 4 then 'SUPERVISOR:MTZ' when 5 then 'DISENO:DIS' when 6 then 'GERENTE:GGE'
      when 7 then 'SUPERVISOR:MTZ' when 8 then 'SUPERVISOR:PRD' when 9 then 'DISENO:DIS'
      when 10 then 'GERENTE:GGE' else 'SUPERVISOR:MTZ' end)::uuid;
    if t_uid is null then raise exception 'FALLO: falta cuenta para paso %',t_paso; end if;
    perform set_config('request.jwt.claim.sub',t_uid::text,true);
    perform set_config('request.jwt.claims',json_build_object('sub',t_uid,'role','authenticated')::text,true);
    set local role authenticated;
    case t_paso
    when 1 then
      insert into public.ot_planos(id,orden_id,numero_plano,nombre,peso_pct) values(t_plano,v_ot,'ENS-001','Plano de ensayo',100) returning id into t_plano;
      if t_plano is null then raise exception 'FALLO: Diseño no creó plano'; end if;
      insert into public.ot_piezas(plano_id,orden_id,numero_pieza,nombre,cantidad) values(t_plano,v_ot,'001','Pieza de ensayo',2);
      perform public.registrar_version_plano(t_version,t_plano,t_area,'ensayo.pdf');
      perform public.registrar_version_plano(t_version,t_plano,t_area,'ensayo.pdf');
      if (select count(*) from public.ot_plano_versiones where plano_id=t_plano)<>1 then raise exception 'FALLO: reintento duplicó versión'; end if;
    when 2,3,4,8 then
      if exists(select 1 from public.ot_plano_versiones where plano_id=t_plano)
        or exists(select 1 from public.ot_planos where id=t_plano)
        or exists(select 1 from public.ot_piezas where plano_id=t_plano)
        or exists(select 1 from public.v_cumplimiento_planos where plano_id=t_plano)
        or exists(select 1 from storage.objects where bucket_id='planos-privados' and name=t_diseno::text||'/'||t_version::text||'.pdf') then
        raise exception 'FALLO: lectura fuera de alcance en paso %',t_paso;
      end if;
      t_negado:=false;
      begin perform public.recibir_version_plano(t_version); exception when insufficient_privilege then t_negado:=true; end;
      if not t_negado then raise exception 'FALLO: recibió sin permiso en paso %',t_paso; end if;
    when 5 then
      t_negado:=false;
      begin perform public.revisar_version_plano(t_version,true,null); exception when insufficient_privilege then t_negado:=true; end;
      if not t_negado then raise exception 'FALLO: Diseño aprobó su archivo'; end if;
      t_negado:=false;
      begin update public.ot_plano_versiones set estado='APROBADO' where id=t_version; exception when insufficient_privilege then t_negado:=true; end;
      if not t_negado then raise exception 'FALLO: UPDATE directo saltó revisión'; end if;
    when 6 then
      perform public.revisar_version_plano(t_version,true,null);
      perform public.revisar_version_plano(t_version,true,null);
    when 7 then
      if not exists(select 1 from public.ot_plano_versiones where id=t_version and vigente)
        or not exists(select 1 from public.v_cumplimiento_planos where plano_id=t_plano)
        or not exists(select 1 from storage.objects where bucket_id='planos-privados' and name=t_diseno::text||'/'||t_version::text||'.pdf') then
        raise exception 'FALLO: Maestranza no ve su plano aprobado';
      end if;
      perform public.recibir_version_plano(t_version);
      perform public.recibir_version_plano(t_version);
      if not exists(select 1 from public.ot_plano_versiones where id=t_version and recibido_por=t_uid and estado='RECIBIDO') then raise exception 'FALLO: recepción sin firma'; end if;
      t_negado:=false;
      begin
        update public.ot_piezas set prd_observacion='ESCRITURA DE OTRA AREA' where plano_id=t_plano;
      exception when insufficient_privilege then t_negado:=true;
      end;
      if not t_negado then raise exception 'FALLO: Maestranza escribió el bloque de Producción'; end if;
      update public.ot_piezas set mtz_observacion='RECEPCION COMPROBADA' where plano_id=t_plano;
      get diagnostics t_filas=row_count;
      if t_filas<>1 then raise exception 'FALLO: Maestranza no pudo escribir su propio bloque'; end if;
    when 9 then
      perform public.registrar_version_plano(t_segunda,t_plano,t_area,'correccion.pdf');
      if not exists(select 1 from public.ot_plano_versiones where id=t_segunda and revision=2 and not vigente) then raise exception 'FALLO: numeración de revisión'; end if;
      if not exists(select 1 from public.ot_plano_versiones where id=t_version and vigente) then raise exception 'FALLO: subir borrador retiró aprobado'; end if;
      t_negado:=false;
      begin delete from public.ot_plano_versiones where id=t_version; exception when insufficient_privilege then t_negado:=true; end;
      if not t_negado then raise exception 'FALLO: se borró evidencia'; end if;
    when 10 then
      perform public.revisar_version_plano(t_segunda,false,'Corregir las cotas.');
    when 11 then
      select count(*) into t_filas from public.ot_plano_versiones where plano_id=t_plano;
      if t_filas<>1 then raise exception 'FALLO: área ve borrador observado'; end if;
    end case;
    reset role;
  end loop;
  if has_table_privilege('anon','public.ot_plano_versiones','SELECT')
    or has_function_privilege('anon','public.revisar_version_plano(uuid,boolean,text)','EXECUTE') then raise exception 'FALLO: acceso anónimo'; end if;
  -- Restituir a Producción para continuar el circuito de la OT.
  perform set_config('request.jwt.claim.sub',v_uid::text,true);
  perform set_config('request.jwt.claims',json_build_object('sub',v_uid,'role','authenticated')::text,true);
  set local role authenticated;
end;
