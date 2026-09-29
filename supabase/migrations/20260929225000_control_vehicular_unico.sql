-- Una sola ficha acompaña la unidad desde ingreso hasta salida. Los ítems
-- proceden del formato de inspección vehicular de Metal Work (SIG-FCLIV-001);
-- el PDF descargado y el escaneo firmado representan el mismo registro.
create table if not exists public.control_vehicular_items (
  codigo text primary key,
  categoria text not null check (categoria in ('CABINA_EXTERIOR','ACCESORIOS','CABINA_INTERIOR','HERRAMIENTAS')),
  nombre text not null,
  orden integer not null unique,
  actualizado_en timestamptz not null default now()
);
insert into public.control_vehicular_items(codigo,categoria,nombre,orden) values
 ('FARO_DEL_D','CABINA_EXTERIOR','Faro delantero derecho',1),
 ('FARO_DEL_I','CABINA_EXTERIOR','Faro delantero izquierdo',2),
 ('NEBLINEROS','CABINA_EXTERIOR','Faros neblineros',3),
 ('CIRCULINA','CABINA_EXTERIOR','Circulina',4),
 ('DIRECC_DEL_D','CABINA_EXTERIOR','Direccional delantero derecho',5),
 ('DIRECC_DEL_I','CABINA_EXTERIOR','Direccional delantero izquierdo',6),
 ('LUCES_ALTAS','CABINA_EXTERIOR','Luces altas',7),
 ('LUCES_MEDIAS','CABINA_EXTERIOR','Luces medias',8),
 ('LUCES_BAJAS','CABINA_EXTERIOR','Luces bajas',9),
 ('PARABRISAS','CABINA_EXTERIOR','Parabrisas',10),
 ('ESPEJO_D','CABINA_EXTERIOR','Espejo retrovisor derecho',11),
 ('ESPEJO_I','CABINA_EXTERIOR','Espejo retrovisor izquierdo',12),
 ('ESPEJO_FRONTAL','CABINA_EXTERIOR','Espejo frontal superior',13),
 ('PLUMILLAS','CABINA_EXTERIOR','Plumillas',14),
 ('ABOLLADURA','CABINA_EXTERIOR','Abolladura de cabina',15),
 ('ANTENA','CABINA_EXTERIOR','Antena',16),
 ('PERTIGA','CABINA_EXTERIOR','Pértiga',17),
 ('PARACHOQUE','CABINA_EXTERIOR','Parachoque frontal',18),
 ('TAPA_COMBUSTIBLE','ACCESORIOS','Tapa de llenado de combustible',19),
 ('TAPA_ACEITE_BATERIA','ACCESORIOS','Tapa de aceite y tapa de baterías',20),
 ('TACOS','ACCESORIOS','Tacos neumáticos',21),
 ('CONOS','ACCESORIOS','Conos de seguridad',22),
 ('EXTINTOR','ACCESORIOS','Extintor',23),
 ('ALARMA_RETROCESO','ACCESORIOS','Alarma de retroceso',24),
 ('FARO_POST_D','ACCESORIOS','Faro posterior derecho',25),
 ('FARO_POST_I','ACCESORIOS','Faro posterior izquierdo',26),
 ('DIRECC_POST_D','ACCESORIOS','Direccional posterior derecho',27),
 ('DIRECC_POST_I','ACCESORIOS','Direccional posterior izquierdo',28),
 ('LLANTA_REPUESTO','ACCESORIOS','Llanta de repuesto',29),
 ('DOC_VEHICULAR','CABINA_INTERIOR','Documentación vehicular',30),
 ('ASIENTOS','CABINA_INTERIOR','Asientos',31),
 ('CINTURONES','CABINA_INTERIOR','Cinturones de seguridad',32),
 ('ESPEJO_INTERIOR','CABINA_INTERIOR','Espejo retrovisor interior',33),
 ('AIRE_ACONDICIONADO','CABINA_INTERIOR','Aire acondicionado',34),
 ('GUANTERA','CABINA_INTERIOR','Guantera',35),
 ('PISO_JEBE','CABINA_INTERIOR','Piso de jebe',36),
 ('MANIVELA','CABINA_INTERIOR','Manivela',37),
 ('MANIJAS','CABINA_INTERIOR','Manijas',38),
 ('PASAMANOS','CABINA_INTERIOR','Pasamanos',39),
 ('RADIO','CABINA_INTERIOR','Radio',40),
 ('BOTIQUIN','CABINA_INTERIOR','Botiquín de primeros auxilios',41),
 ('CLAXON','CABINA_INTERIOR','Claxon',42),
 ('GATA','HERRAMIENTAS','Gata hidráulica',43),
 ('LLAVE_RUEDAS','HERRAMIENTAS','Llave de ruedas',44),
 ('KIT_ANTIDERRAME','HERRAMIENTAS','Kit antiderrame',45),
 ('ESTUCHE_LLAVES','HERRAMIENTAS','Estuche de llaves',46),
 ('MANGUERA_AIRE','HERRAMIENTAS','Manguera de aire',47),
 ('PICO_PATO','HERRAMIENTAS','Pico de pato',48),
 ('COMBO','HERRAMIENTAS','Combo',49)
on conflict(codigo) do update set categoria=excluded.categoria,nombre=excluded.nombre,orden=excluded.orden;
alter table public.control_vehicular_items enable row level security;
revoke all on public.control_vehicular_items from public, anon, authenticated;
grant select on public.control_vehicular_items to authenticated;
drop policy if exists ver_control_vehicular_items on public.control_vehicular_items;
create policy ver_control_vehicular_items on public.control_vehicular_items for select to authenticated
  using (public.tiene_permiso('costos.ver') or public.tiene_permiso('costos.controlar_ot'));
select public.activar_timestamps('control_vehicular_items');
select public.activar_auditoria('control_vehicular_items');

create table if not exists public.ot_control_vehicular (
  id uuid primary key default gen_random_uuid(),
  orden_id uuid not null unique references public.ordenes_trabajo(id) on delete restrict,
  placa text not null default '' check (length(placa)<=30),
  marca text not null default '' check (length(marca)<=80),
  conductor_ingreso text not null default '' check (length(conductor_ingreso)<=120),
  dni_ingreso text not null default '' check (length(dni_ingreso)<=20),
  fecha_ingreso date,
  combustible_ingreso text not null default '' check (length(combustible_ingreso)<=40),
  conductor_salida text not null default '' check (length(conductor_salida)<=120),
  dni_salida text not null default '' check (length(dni_salida)<=20),
  fecha_salida date,
  combustible_salida text not null default '' check (length(combustible_salida)<=40),
  adicionales text not null default '' check (length(adicionales)<=2000),
  trabajos text not null default '' check (length(trabajos)<=2000),
  observacion_ingreso text not null default '' check (length(observacion_ingreso)<=2000),
  observacion_salida text not null default '' check (length(observacion_salida)<=2000),
  items jsonb not null default '{}'::jsonb check (jsonb_typeof(items)='object'),
  ingreso_cerrado_en timestamptz,
  salida_cerrada_en timestamptz,
  escaneo_ruta text unique,
  escaneo_nombre text,
  registrado_por uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  actualizado_por uuid references public.usuarios(id) on delete set null,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint ck_control_escaneo_ruta check (escaneo_ruta is null or
    (salida_cerrada_en is not null and escaneo_ruta like 'ot/' || orden_id::text || '/control/%.pdf'))
);
alter table public.ot_control_vehicular enable row level security;
revoke all on public.ot_control_vehicular from public, anon, authenticated;
grant select,insert,update on public.ot_control_vehicular to authenticated;
drop policy if exists ver_ot_control_vehicular on public.ot_control_vehicular;
create policy ver_ot_control_vehicular on public.ot_control_vehicular for select to authenticated
  using (public.puede_ver_orden(orden_id) and
    (public.tiene_permiso('costos.ver') or public.tiene_permiso('costos.controlar_ot')));
drop policy if exists crear_ot_control_vehicular on public.ot_control_vehicular;
create policy crear_ot_control_vehicular on public.ot_control_vehicular for insert to authenticated
  with check (public.tiene_permiso('costos.controlar_ot') and public.puede_ver_orden(orden_id)
    and registrado_por=public.usuario_actual());
drop policy if exists editar_ot_control_vehicular on public.ot_control_vehicular;
create policy editar_ot_control_vehicular on public.ot_control_vehicular for update to authenticated
  using (public.tiene_permiso('costos.controlar_ot') and public.puede_ver_orden(orden_id))
  with check (public.tiene_permiso('costos.controlar_ot') and public.puede_ver_orden(orden_id));

create or replace function public.fn_proteger_control_vehicular() returns trigger
language plpgsql security definer set search_path='public' as $$
declare v_codigo text; v_estado text; v_entrada text; v_salida text;
begin
  if not public.tiene_permiso('costos.controlar_ot') then
    raise exception 'Solo Costos y Materiales registra el control vehicular.' using errcode='insufficient_privilege';
  end if;
  if not exists (select 1 from public.ordenes_trabajo o where o.id=new.orden_id
    and o.estado not in ('ANULADA','ENTREGADA','FACTURADA')) then
    raise exception 'Esta OT está cerrada; el control vehicular ya no se modifica.';
  end if;
  if tg_op='UPDATE' then
    if old.salida_cerrada_en is not null and
      (to_jsonb(new)-array['escaneo_ruta','escaneo_nombre','actualizado_en','actualizado_por'])
        is distinct from
      (to_jsonb(old)-array['escaneo_ruta','escaneo_nombre','actualizado_en','actualizado_por']) then
      raise exception 'La ficha completada solo admite adjuntar el escaneo firmado.';
    end if;
    if old.escaneo_ruta is not null and new.escaneo_ruta is distinct from old.escaneo_ruta then
      raise exception 'El escaneo ya registrado no se reemplaza; deja una observación en la OT.';
    end if;
    if old.ingreso_cerrado_en is not null then
      if new.placa is distinct from old.placa or new.marca is distinct from old.marca
         or new.conductor_ingreso is distinct from old.conductor_ingreso
         or new.dni_ingreso is distinct from old.dni_ingreso
         or new.fecha_ingreso is distinct from old.fecha_ingreso
         or new.combustible_ingreso is distinct from old.combustible_ingreso
         or new.observacion_ingreso is distinct from old.observacion_ingreso then
        raise exception 'El ingreso completado queda fijo; registra una observación si hay un error.';
      end if;
      for v_codigo in select codigo from public.control_vehicular_items loop
        if new.items->v_codigo->>'ingreso' is distinct from old.items->v_codigo->>'ingreso' then
          raise exception 'Los ítems del ingreso completado ya no se modifican.';
        end if;
      end loop;
      new.ingreso_cerrado_en := old.ingreso_cerrado_en;
    end if;
    new.orden_id := old.orden_id;
    new.registrado_por := old.registrado_por;
    new.creado_en := old.creado_en;
  end if;
  for v_codigo in select key from jsonb_each(new.items) loop
    if not exists (select 1 from public.control_vehicular_items where codigo=v_codigo) then
      raise exception 'La ficha contiene un ítem que no pertenece al formato de Metal Work.';
    end if;
    v_entrada := new.items->v_codigo->>'ingreso';
    v_salida := new.items->v_codigo->>'salida';
    if (v_entrada is not null and v_entrada not in ('CONFORME','NO_TIENE','OBSERVADO'))
       or (v_salida is not null and v_salida not in ('CONFORME','NO_TIENE','OBSERVADO')) then
      raise exception 'Un estado de la ficha no es válido.';
    end if;
  end loop;
  if new.ingreso_cerrado_en is not null and (tg_op='INSERT' or old.ingreso_cerrado_en is null) then
    if btrim(new.conductor_ingreso)='' or new.fecha_ingreso is null or
       exists (select 1 from public.control_vehicular_items i
         where new.items->i.codigo->>'ingreso' is null) then
      raise exception 'Completa el conductor, la fecha y todos los ítems de ingreso antes de cerrar.';
    end if;
    new.ingreso_cerrado_en := now();
  end if;
  if new.salida_cerrada_en is not null and (tg_op='INSERT' or old.salida_cerrada_en is null) then
    if new.ingreso_cerrado_en is null or btrim(new.conductor_salida)='' or new.fecha_salida is null
       or exists (select 1 from public.control_vehicular_items i
         where new.items->i.codigo->>'salida' is null) then
      raise exception 'Completa el ingreso, conductor, fecha y todos los ítems de salida antes de cerrar.';
    end if;
    new.salida_cerrada_en := now();
  end if;
  new.actualizado_por := public.usuario_actual();
  return new;
end $$;
revoke all on function public.fn_proteger_control_vehicular() from public, anon, authenticated;
drop trigger if exists proteger_control_vehicular on public.ot_control_vehicular;
create trigger proteger_control_vehicular before insert or update on public.ot_control_vehicular
  for each row execute function public.fn_proteger_control_vehicular();
select public.activar_timestamps('ot_control_vehicular');
select public.activar_auditoria('ot_control_vehicular');
select public.activar_registro_de_prueba('ot_control_vehicular');

-- La liberación para salida exige la misma ficha, ya cerrada y escaneada.
create or replace function public.fn_proteger_solicitud_tesoreria() returns trigger
language plpgsql set search_path='public' as $$
begin
  if tg_op='INSERT' then
    if new.tipo='SALIDA_OT' and not exists (
      select 1 from public.ot_control_vehicular c where c.orden_id=new.orden_id
        and c.salida_cerrada_en is not null and c.escaneo_ruta is not null
    ) then
      raise exception 'Completa la ficha de ingreso y salida y adjunta el escaneo firmado antes de solicitar la liberación.';
    end if;
    return new;
  end if;
  if old.estado<>'PENDIENTE' or
    (to_jsonb(new)-array['estado','respuesta','atendido_por','atendido_en','actualizado_en'])
      is distinct from
    (to_jsonb(old)-array['estado','respuesta','atendido_por','atendido_en','actualizado_en']) then
    raise exception 'Tesorería solo puede responder una solicitud pendiente; el pedido original queda en el historial.';
  end if;
  new.atendido_por := public.usuario_actual();
  new.atendido_en := now();
  return new;
end $$;
revoke all on function public.fn_proteger_solicitud_tesoreria() from public, anon, authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('control-ot','control-ot',false,15728640,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists mw_subir_control_ot on storage.objects;
create policy mw_subir_control_ot on storage.objects for insert to authenticated
  with check (bucket_id='control-ot' and public.orden_de_ruta(name) is not null
    and name like 'ot/' || public.orden_de_ruta(name)::text || '/control/%.pdf'
    and public.puede_ver_orden(public.orden_de_ruta(name))
    and public.tiene_permiso('costos.controlar_ot'));
drop policy if exists mw_leer_control_ot on storage.objects;
create policy mw_leer_control_ot on storage.objects for select to authenticated
  using (bucket_id='control-ot' and exists (
    select 1 from public.ot_control_vehicular c where c.escaneo_ruta=objects.name));
drop policy if exists mw_borrar_control_ot on storage.objects;
create policy mw_borrar_control_ot on storage.objects for delete to authenticated
  using (bucket_id='control-ot' and owner_id=(auth.uid())::text
    and not exists (select 1 from public.ot_control_vehicular c where c.escaneo_ruta=objects.name));
