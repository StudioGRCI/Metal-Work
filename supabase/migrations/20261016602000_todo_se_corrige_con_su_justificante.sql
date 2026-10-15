-- Todo se puede corregir, pero con su justificante (DKS, 15/10: «recuerda todo
-- se puede corregir pero siempre debe anexar el justificante de la corrección»).
--
-- Hasta hoy el requerimiento registrado no cambiaba («anúlalo y registra
-- otro»), la factura registrada tampoco («registra una corrección», que no
-- existía) y la OC se corregía sin dejar rastro de por qué. Desde aquí los tres
-- se corrigen, y cada corrección deja:
--   · el motivo, quién y cuándo, sellados por la base;
--   · lo que decía antes y lo que dice después;
--   · el justificante: el PDF o la foto que respalda el cambio (el correo del
--     proveedor, la nota de crédito, la factura correcta, el visto bueno del área).
-- Sin justificante no hay corrección. El historial no se edita ni se borra: es
-- la evidencia, como la anulación de un documento numerado.
--
-- Lo que no se corrige, y por qué:
--   · Un insumo que ya va en una OC viva, o del que ya salió material: se corrige
--     la OC, o lo que salió queda en el kardex.
--   · La cantidad y el precio de una OC cuyo material ya entró al almacén: el
--     ingreso quedó valorizado en el kardex con ese precio.
--   · Agregar o quitar insumos de un RQ: sigue siendo anular y registrar otro.
-- La factura sí puede cambiar sus OC: la que sale queda marcada como quitada,
-- con su fecha y quién, no se borra.

-- 1. El historial ------------------------------------------------------------------------
create table if not exists public.correcciones (
  id uuid primary key default gen_random_uuid(),
  documento text not null check (documento in ('REQUERIMIENTO', 'ORDEN_COMPRA', 'FACTURA_COMPRA')),
  documento_id uuid not null,
  numero text not null check (char_length(btrim(numero)) between 1 and 80),
  motivo text not null check (char_length(btrim(motivo)) between 10 and 500),
  antes jsonb not null,
  despues jsonb not null,
  justificante_ruta text not null unique,
  justificante_nombre text not null check (char_length(btrim(justificante_nombre)) between 1 and 200),
  justificante_mime text not null check (justificante_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  justificante_tamano integer not null check (justificante_tamano between 1 and 10485760),
  corregido_por uuid not null references public.usuarios(id) on delete restrict,
  corregido_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
comment on table public.correcciones is
  'Cada corrección de un RQ, una OC o una factura de compra: motivo, antes y después, quién, cuándo y su justificante. No se edita ni se borra.';
-- (b) Cada documento muestra su historial: la pantalla filtra por documento_id.
create index if not exists ix_correcciones_documento on public.correcciones (documento_id, corregido_en);

alter table public.correcciones enable row level security;
revoke all on public.correcciones from anon, public;
grant select on public.correcciones to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'correcciones' and policyname = 'ver_correcciones') then
    -- Quien ve el documento ve sus correcciones. Escribir, solo las funciones de abajo.
    create policy ver_correcciones on public.correcciones for select to authenticated using (
      (select public.es_admin())
      or (documento = 'REQUERIMIENTO' and (select public.puede_ver_requerimientos()))
      or (documento = 'ORDEN_COMPRA' and ((select public.tiene_permiso('compras.ver')) or (select public.tiene_permiso('compras.crear'))
                                          or (select public.tiene_permiso('tesoreria.ver_documentos'))))
      or (documento = 'FACTURA_COMPRA' and (select public.tiene_permiso('adquisiciones.ver'))));
  end if;
end $$;

create or replace function public.fn_correccion_inmutable()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  -- La limpieza de un lote de prueba apaga este candado solo para lo suyo (migración 105).
  raise exception 'Una corrección no se cambia ni se borra: queda como evidencia. Si hay que corregir otra vez, registra otra corrección.'
    using errcode = 'check_violation';
end $$;
revoke all on function public.fn_correccion_inmutable() from public, anon, authenticated;
create or replace trigger trg_correccion_inmutable
  before update or delete on public.correcciones
  for each row execute function public.fn_correccion_inmutable();

select public.activar_timestamps('correcciones');
select public.activar_auditoria('correcciones');
select public.activar_registro_de_prueba('correcciones');

-- 2. El justificante: bucket privado, una carpeta por documento ------------------------------
-- Ruta: <id del documento>/<id de la corrección>.(pdf|jpg|png|webp), la que exige
-- `archivo_subido_por_mi`. Se ve si se ve la corrección que lo nombra.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('justificantes-correccion', 'justificantes-correccion', false, 10485760,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'justificantes_subir') then
    create policy justificantes_subir on storage.objects for insert to authenticated with check (
      bucket_id = 'justificantes-correccion' and owner_id = (select auth.uid())::text
      and ((select public.es_admin()) or (select public.tiene_permiso('requerimientos.emitir'))
           or (select public.tiene_permiso('requerimientos.administracion')) or (select public.tiene_permiso('compras.crear'))
           or (select public.tiene_permiso('adquisiciones.registrar'))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'justificantes_ver') then
    create policy justificantes_ver on storage.objects for select to authenticated using (
      bucket_id = 'justificantes-correccion'
      and (owner_id = (select auth.uid())::text
           or exists (select 1 from public.correcciones c where c.justificante_ruta = objects.name)));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'justificantes_quitar_suelto') then
    create policy justificantes_quitar_suelto on storage.objects for delete to authenticated using (
      bucket_id = 'justificantes-correccion' and owner_id = (select auth.uid())::text
      and not exists (select 1 from public.correcciones c where c.justificante_ruta = objects.name));
  end if;
end $$;

-- El PDF corregido de una factura registrada: adquisiciones/<id>/correccion-<uuid>.pdf.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'comprobantes_financieros_corregir') then
    create policy comprobantes_financieros_corregir on storage.objects for insert to authenticated with check (
      bucket_id = 'comprobantes-financieros' and owner_id = (select auth.uid())::text
      and (select public.tiene_permiso('adquisiciones.registrar'))
      and name ~ '^adquisiciones/[0-9a-f-]{36}/correccion-[0-9a-f-]{36}\.pdf$'
      and exists (select 1 from public.adquisiciones a
                   where a.id::text = split_part(objects.name, '/', 2) and a.estado = 'REGISTRADA'));
  end if;
  -- Si la corrección no entra, quien lo subió retira el PDF que nadie nombra.
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'comprobantes_financieros_quitar_suelto') then
    create policy comprobantes_financieros_quitar_suelto on storage.objects for delete to authenticated using (
      bucket_id = 'comprobantes-financieros' and owner_id = (select auth.uid())::text
      and name ~ '^adquisiciones/[0-9a-f-]{36}/correccion-[0-9a-f-]{36}\.pdf$'
      and not exists (select 1 from public.adquisiciones a where a.ruta_storage = objects.name)
      and not exists (select 1 from public.correcciones c where c.documento = 'FACTURA_COMPRA'
                         and objects.name in (c.antes->>'ruta_storage', c.despues->>'ruta_storage')));
  end if;
end $$;

-- Anota la corrección con su justificante. La llaman las funciones de abajo,
-- después de exigir el permiso del documento.
create or replace function public.registrar_correccion(
  p_id uuid, p_documento text, p_documento_id uuid, p_numero text, p_motivo text, p_ruta text, p_nombre text,
  p_antes jsonb, p_despues jsonb
) returns void language plpgsql security definer set search_path to 'public' as $$
declare v_obj storage.objects%rowtype;
begin
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se corrige, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  if p_ruta is null or p_ruta !~ ('^' || p_documento_id::text || '/' || p_id::text || '\.(pdf|jpg|png|webp)$') then
    raise exception 'Adjunta el justificante de la corrección: el PDF o la foto que la respalda.' using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('justificantes-correccion', p_ruta, p_documento_id,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  if p_antes = p_despues then
    raise exception 'No hay nada que corregir: cambia algún dato.' using errcode = 'check_violation';
  end if;
  insert into public.correcciones (id, documento, documento_id, numero, motivo, antes, despues, justificante_ruta,
                                   justificante_nombre, justificante_mime, justificante_tamano, corregido_por)
  values (p_id, p_documento, p_documento_id, p_numero, btrim(p_motivo), p_antes, p_despues, p_ruta,
          left(coalesce(nullif(btrim(p_nombre), ''), 'justificante'), 200), v_obj.metadata->>'mimetype',
          (v_obj.metadata->>'size')::integer, public.usuario_actual());
end $$;
revoke all on function public.registrar_correccion(uuid, text, uuid, text, text, text, text, jsonb, jsonb) from public, anon, authenticated;

-- 3. El requerimiento ---------------------------------------------------------------------
-- La cabecera la guardaba `fn_rq_guardia`; los insumos, `fn_rq_linea_guardia`
-- (migración 20261016600000). Las dos dejan pasar solo a `corregir_requerimiento`.
create or replace function public.fn_rq_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un requerimiento no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if row(new.numero, new.tipo, new.area_id, new.creado_por, new.creado_en)
     is distinct from row(old.numero, old.tipo, old.area_id, old.creado_por, old.creado_en)
     or (row(new.codigo_interno, new.justificacion, new.fecha_requerida)
         is distinct from row(old.codigo_interno, old.justificacion, old.fecha_requerida)
         and current_setting('metalwork.corrigiendo', true) is distinct from 'requerimiento') then
    raise exception 'El requerimiento % ya se registró: si cambió, corrígelo con su justificante.', old.numero
      using errcode = 'check_violation';
  end if;
  if old.estado in ('ENTREGADO', 'ANULADO') and new.estado is distinct from old.estado then
    raise exception 'El requerimiento % ya está %: queda como evidencia.', old.numero,
      case old.estado when 'ENTREGADO' then 'entregado' else 'anulado' end using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_rq_guardia() from public, anon, authenticated;

-- p_cambios: {codigo_interno?, justificacion?, fecha_requerida?, lineas?: [{item, cantidad?, material_id?}]}
create or replace function public.corregir_requerimiento(
  p_correccion uuid, p_id uuid, p_motivo text, p_justificante text, p_nombre text, p_cambios jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_rq       public.requerimientos%rowtype;
  v_hoy      date := (now() at time zone 'America/Lima')::date;
  v_antes    jsonb;
  v_despues  jsonb;
  v_x        jsonb;
  v_linea    public.requerimiento_lineas%rowtype;
  v_material public.materiales%rowtype;
  v_cant     numeric;
  v_mat      uuid;
  v_codigo   text;
  v_just     text;
  v_fecha    date;
  v_oc       text;
begin
  select * into v_rq from public.requerimientos where id = p_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  perform public.rq_exigir(v_rq.tipo, 'CORREGIR');
  if exists (select 1 from public.correcciones where id = p_correccion and documento_id = p_id) then
    return p_id;  -- un reintento de la misma corrección
  end if;
  if v_rq.estado in ('ENTREGADO', 'ANULADO') then
    raise exception 'El requerimiento % ya está %: queda como evidencia.', v_rq.numero,
      case v_rq.estado when 'ENTREGADO' then 'entregado' else 'anulado' end using errcode = 'check_violation';
  end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' then
    raise exception 'Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;

  v_antes := jsonb_build_object('codigo_interno', v_rq.codigo_interno, 'justificacion', v_rq.justificacion,
                                'fecha_requerida', v_rq.fecha_requerida, 'lineas',
    (select coalesce(jsonb_agg(jsonb_build_object('item', l.item, 'descripcion', l.descripcion, 'cantidad', l.cantidad,
                                                  'material_id', l.material_id) order by l.item), '[]'::jsonb)
       from public.requerimiento_lineas l where l.requerimiento_id = p_id));

  v_codigo := coalesce(btrim(p_cambios->>'codigo_interno'), v_rq.codigo_interno);
  v_just := coalesce(btrim(p_cambios->>'justificacion'), v_rq.justificacion);
  begin
    v_fecha := case when p_cambios ? 'fecha_requerida' then nullif(p_cambios->>'fecha_requerida', '')::date else v_rq.fecha_requerida end;
  exception when others then
    raise exception 'Revisa la fecha en que se necesita.' using errcode = 'check_violation';
  end;
  if char_length(v_codigo) not between 2 and 60 then
    raise exception 'Escribe el código interno de la unidad (de 2 a 60 caracteres). Si no es para una unidad, escribe PLANTA u OFICINA.'
      using errcode = 'check_violation';
  end if;
  if char_length(v_just) not between 10 and 1000 then
    raise exception 'La justificación va de 10 a 1000 caracteres.' using errcode = 'check_violation';
  end if;
  if v_fecha is distinct from v_rq.fecha_requerida and v_fecha < v_hoy then
    raise exception 'La fecha en que se necesita no puede ser anterior a hoy.' using errcode = 'check_violation';
  end if;

  perform set_config('metalwork.corrigiendo', 'requerimiento', true);
  update public.requerimientos set codigo_interno = v_codigo, justificacion = v_just, fecha_requerida = v_fecha
   where id = p_id
     and row(codigo_interno, justificacion, fecha_requerida) is distinct from row(v_codigo, v_just, v_fecha);

  for v_x in select value from jsonb_array_elements(coalesce(p_cambios->'lineas', '[]'::jsonb)) loop
    begin
      select * into v_linea from public.requerimiento_lineas
       where requerimiento_id = p_id and item = (v_x->>'item')::int for update;
      v_cant := nullif(v_x->>'cantidad', '')::numeric;
      v_mat := nullif(v_x->>'material_id', '')::uuid;
    exception when others then
      raise exception 'Revisa los insumos que corriges.' using errcode = 'check_violation';
    end;
    if v_linea.id is null then
      raise exception 'Ese insumo no es de este requerimiento. Recarga la pantalla.' using errcode = 'check_violation';
    end if;
    if v_linea.orden_compra_id is not null then
      select coalesce(c.numero, c.referencia) into v_oc from public.ordenes_compra_materiales c
       where c.id = v_linea.orden_compra_id and c.aprobacion <> 'RECHAZADA';
      if v_oc is not null then
        raise exception 'El insumo % ya va en la %: corrige la orden de compra.', v_linea.item, v_oc using errcode = 'check_violation';
      end if;
    end if;
    if exists (select 1 from public.movimientos_materiales m where m.requerimiento_linea_id = v_linea.id) then
      raise exception 'Del insumo % ya salió material del almacén: lo que salió queda en el kardex.', v_linea.item
        using errcode = 'check_violation';
    end if;
    if v_cant is not null and (v_cant <= 0 or v_cant > 999999999 or v_cant <> round(v_cant, 3)) then
      raise exception 'La cantidad del insumo % debe ser mayor que cero, con hasta tres decimales.', v_linea.item
        using errcode = 'check_violation';
    end if;
    if v_mat is not null and v_mat is distinct from v_linea.material_id then
      if v_rq.estado <> 'POR_ATENDER' then
        raise exception 'Almacén ya revisó el stock del requerimiento %: el material del insumo % ya no cambia. Corrige la cantidad, o anúlalo y registra otro.',
          v_rq.numero, v_linea.item using errcode = 'check_violation';
      end if;
      select * into v_material from public.materiales where id = v_mat and activo;
      if not found then
        raise exception 'El material del insumo % ya no está en el catálogo de Almacén. Elige otro.', v_linea.item using errcode = 'check_violation';
      end if;
      update public.requerimiento_lineas
         set material_id = v_material.id, descripcion = left(btrim(v_material.descripcion), 300),
             categoria_id = v_material.categoria_id,
             unidad_medida_id = case when v_material.unidad_pendiente then unidad_medida_id else v_material.unidad_medida_id end
       where id = v_linea.id;
    end if;
    if v_cant is not null and v_cant <> v_linea.cantidad then
      -- Lo que Almacén anotó que tenía no puede pasar de lo pedido.
      update public.requerimiento_lineas
         set cantidad = v_cant,
             cantidad_en_stock = case when cantidad_en_stock is null then null else least(cantidad_en_stock, v_cant) end
       where id = v_linea.id;
    end if;
    v_linea := null;
    v_oc := null;
  end loop;
  perform set_config('metalwork.corrigiendo', '', true);

  if exists (select 1 from public.requerimiento_lineas l where l.requerimiento_id = p_id and l.material_id is not null
              group by l.material_id having count(*) > 1) then
    raise exception 'Un material quedaría dos veces en el requerimiento %: suma las cantidades en un solo insumo.', v_rq.numero
      using errcode = 'check_violation';
  end if;

  select * into v_rq from public.requerimientos where id = p_id;
  v_despues := jsonb_build_object('codigo_interno', v_rq.codigo_interno, 'justificacion', v_rq.justificacion,
                                  'fecha_requerida', v_rq.fecha_requerida, 'lineas',
    (select coalesce(jsonb_agg(jsonb_build_object('item', l.item, 'descripcion', l.descripcion, 'cantidad', l.cantidad,
                                                  'material_id', l.material_id) order by l.item), '[]'::jsonb)
       from public.requerimiento_lineas l where l.requerimiento_id = p_id));
  perform public.registrar_correccion(p_correccion, 'REQUERIMIENTO', p_id, v_rq.numero, p_motivo, p_justificante, p_nombre,
                                      v_antes, v_despues);
  -- A Almacén y a quien compra les llega que cambió, con el motivo.
  perform public.fn_rq_avisar(v_rq, 'Requerimiento corregido: ' || v_rq.numero, left(btrim(p_motivo), 200),
                              case when v_rq.estado = 'POR_ATENDER' then 'ALMACEN' else 'LOGISTICA' end);
  return p_id;
end $$;
revoke all on function public.corregir_requerimiento(uuid, uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.corregir_requerimiento(uuid, uuid, text, text, text, jsonb) to authenticated;

-- 4. La orden de compra ---------------------------------------------------------------------
-- p_cambios: {con_factura?, codigo_interno?, lineas?: [{detalle_id, cantidad?, precio_unitario?}]}
-- Si el precio sube, la aprobación se vuelve a pedir sola (evaluar_aprobacion_compra).
create or replace function public.corregir_orden_compra(
  p_correccion uuid, p_id uuid, p_motivo text, p_justificante text, p_nombre text, p_cambios jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_oc      public.ordenes_compra_materiales%rowtype;
  v_antes   jsonb;
  v_despues jsonb;
  v_x       jsonb;
  v_det     public.orden_compra_material_detalles%rowtype;
  v_cant    numeric;
  v_precio  numeric;
  v_factura boolean;
  v_codigo  text;
  v_tiene_precio boolean;
begin
  perform public.exigir_permiso('compras.crear');
  select * into v_oc from public.ordenes_compra_materiales where id = p_id for update;
  if not found then raise exception 'La compra no existe.'; end if;
  if exists (select 1 from public.correcciones where id = p_correccion and documento_id = p_id) then
    return p_id;
  end if;
  if v_oc.aprobacion = 'RECHAZADA' then
    raise exception 'La orden % está rechazada: no se corrige. Genera otra.', coalesce(v_oc.numero, v_oc.referencia)
      using errcode = 'check_violation';
  end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' then
    raise exception 'Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;

  v_antes := jsonb_build_object('con_factura', v_oc.con_factura, 'codigo_interno', v_oc.codigo_interno, 'lineas',
    (select coalesce(jsonb_agg(jsonb_build_object('detalle_id', d.id, 'material_id', d.material_id, 'cantidad', d.cantidad,
                                                  'precio_unitario', d.precio_unitario) order by d.creado_en, d.id), '[]'::jsonb)
       from public.orden_compra_material_detalles d where d.orden_compra_id = p_id));

  v_factura := coalesce((p_cambios->>'con_factura')::boolean, v_oc.con_factura);
  v_codigo := coalesce(btrim(p_cambios->>'codigo_interno'), v_oc.codigo_interno);
  perform public.validar_datos_de_compra(v_factura, v_codigo);
  if v_factura is distinct from v_oc.con_factura and public.compra_tiene_comprobante(v_oc) then
    raise exception 'La compra % ya tiene su comprobante adjunto: ya no se cambia si viene con factura.',
      coalesce(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
  end if;
  update public.ordenes_compra_materiales set con_factura = v_factura, codigo_interno = v_codigo
   where id = p_id and (con_factura is distinct from v_factura or codigo_interno is distinct from v_codigo);

  for v_x in select value from jsonb_array_elements(coalesce(p_cambios->'lineas', '[]'::jsonb)) loop
    begin
      select * into v_det from public.orden_compra_material_detalles
       where id = (v_x->>'detalle_id')::uuid and orden_compra_id = p_id for update;
      v_cant := nullif(v_x->>'cantidad', '')::numeric;
      v_tiene_precio := v_x ? 'precio_unitario';
      v_precio := nullif(v_x->>'precio_unitario', '')::numeric;
    exception when others then
      raise exception 'Revisa las líneas que corriges.' using errcode = 'check_violation';
    end;
    if v_det.id is null then
      raise exception 'Esa línea no es de esta orden. Recarga la pantalla.' using errcode = 'check_violation';
    end if;
    if (v_cant is not null and v_cant is distinct from v_det.cantidad)
       or (v_tiene_precio and v_precio is distinct from v_det.precio_unitario) then
      if exists (select 1 from public.movimientos_materiales m where m.orden_compra_detalle_id = v_det.id) then
        raise exception 'Una línea de la % ya entró al almacén: su cantidad y su precio quedaron en el kardex.',
          coalesce(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
      end if;
      if v_cant is not null and (v_cant <= 0 or v_cant > 999999999 or v_cant <> round(v_cant, 3)) then
        raise exception 'Cada cantidad debe ser mayor que cero, con hasta tres decimales.' using errcode = 'check_violation';
      end if;
      if v_tiene_precio and (v_precio is null or v_precio < 0 or v_precio > 999999999 or v_precio <> round(v_precio, 2)) then
        raise exception 'Cada precio va en soles o dólares sin IGV, de 0 en adelante, con hasta dos decimales.' using errcode = 'check_violation';
      end if;
      update public.orden_compra_material_detalles
         set cantidad = coalesce(v_cant, cantidad),
             precio_unitario = case when v_tiene_precio then v_precio else precio_unitario end
       where id = v_det.id;
    end if;
    v_det := null;
  end loop;

  select * into v_oc from public.ordenes_compra_materiales where id = p_id;
  v_despues := jsonb_build_object('con_factura', v_oc.con_factura, 'codigo_interno', v_oc.codigo_interno, 'lineas',
    (select coalesce(jsonb_agg(jsonb_build_object('detalle_id', d.id, 'material_id', d.material_id, 'cantidad', d.cantidad,
                                                  'precio_unitario', d.precio_unitario) order by d.creado_en, d.id), '[]'::jsonb)
       from public.orden_compra_material_detalles d where d.orden_compra_id = p_id));
  perform public.registrar_correccion(p_correccion, 'ORDEN_COMPRA', p_id, coalesce(v_oc.numero, v_oc.referencia), p_motivo,
                                      p_justificante, p_nombre, v_antes, v_despues);
  return p_id;
end $$;
revoke all on function public.corregir_orden_compra(uuid, uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.corregir_orden_compra(uuid, uuid, text, text, text, jsonb) to authenticated;

-- 5. La factura de compra -------------------------------------------------------------------
-- La OC que sale de una factura queda marcada como quitada, no se borra.
alter table public.adquisiciones_ordenes_compra
  add column if not exists quitada_en timestamptz,
  add column if not exists quitada_por uuid references public.usuarios(id) on delete restrict;
comment on column public.adquisiciones_ordenes_compra.quitada_en is
  'La factura se corrigió y esta OC ya no es suya. Queda como evidencia de que lo fue.';

create or replace function public.fn_adquisicion_oc_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  -- Solo la corrección de la factura quita una OC (o la devuelve), y nada más cambia.
  if tg_op = 'UPDATE' and current_setting('metalwork.corrigiendo', true) = 'factura'
     and (to_jsonb(new) - 'actualizado_en' - 'quitada_en' - 'quitada_por')
         = (to_jsonb(old) - 'actualizado_en' - 'quitada_en' - 'quitada_por') then
    return new;
  end if;
  if tg_op = 'DELETE' or (to_jsonb(new) - 'actualizado_en') is distinct from (to_jsonb(old) - 'actualizado_en') then
    raise exception 'Las OC de una factura registrada no se cambian ni se quitan sin una corrección con su justificante.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_adquisicion_oc_guardia() from public, anon, authenticated;

create or replace function public.fn_adquisicion_oc_valida()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_adq  public.adquisiciones%rowtype;
  v_oc   public.ordenes_compra_materiales%rowtype;
  v_base public.ordenes_compra_materiales%rowtype;
begin
  select * into v_adq from public.adquisiciones where id = new.adquisicion_id;
  if not found or (v_adq.estado <> 'BORRADOR' and current_setting('metalwork.corrigiendo', true) is distinct from 'factura') then
    raise exception 'Las OC de una factura se eligen al registrarla; registrada, ya no cambian sin una corrección con su justificante.' using errcode = 'check_violation';
  end if;
  select * into v_oc from public.ordenes_compra_materiales where id = new.orden_compra_id;
  if not found then raise exception 'Esa orden de compra no existe.' using errcode = 'check_violation'; end if;
  if v_oc.aprobacion = 'RECHAZADA' then
    raise exception 'La orden de compra % está rechazada: no se factura.', coalesce(v_oc.numero, v_oc.referencia) using errcode = 'check_violation';
  end if;
  if v_oc.condicion_pago <> v_adq.condicion_pago then
    raise exception 'La orden de compra % es al %: la factura tiene que ir igual.', coalesce(v_oc.numero, v_oc.referencia),
      case when v_oc.condicion_pago = 'CREDITO' then 'crédito' else 'contado' end using errcode = 'check_violation';
  end if;
  if v_adq.orden_compra_id is not null and v_adq.orden_compra_id <> new.orden_compra_id then
    select * into v_base from public.ordenes_compra_materiales where id = v_adq.orden_compra_id;
    if coalesce(v_base.proveedor_id::text, upper(btrim(v_base.proveedor)))
       is distinct from coalesce(v_oc.proveedor_id::text, upper(btrim(v_oc.proveedor))) then
      raise exception 'Una factura es de un solo proveedor: la orden de compra % es de %.', coalesce(v_oc.numero, v_oc.referencia), v_oc.proveedor
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_adquisicion_oc_valida() from public, anon, authenticated;

-- La factura registrada no se edita, salvo por su corrección.
create or replace function public.fn_proteger_adquisicion()
returns trigger language plpgsql set search_path to 'public' as $$
declare v_orden uuid; v_condicion text; v_directa boolean;
begin
  if tg_op = 'UPDATE' then
    if old.estado <> 'BORRADOR' and current_setting('metalwork.corrigiendo', true) is distinct from 'factura' then
      raise exception 'El comprobante registrado no se edita: corrígelo con su justificante.';
    end if;
    new.id := old.id; new.registrado_por := old.registrado_por; new.creado_en := old.creado_en;
  end if;
  if new.orden_compra_id is not null then
    select r.orden_id, c.condicion_pago, c.origen = 'DIRECTA' into v_orden, v_condicion, v_directa
      from public.ordenes_compra_materiales c
      left join public.requerimientos_materiales r on r.id = c.requerimiento_id
     where c.id = new.orden_compra_id;
    if not coalesce(v_directa, false) and (v_orden is null or (new.orden_id is not null and new.orden_id <> v_orden)) then
      raise exception 'El comprobante debe pertenecer a la misma OT que la compra.';
    end if;
    if v_condicion <> new.condicion_pago then
      raise exception 'La condición de pago debe coincidir con la registrada por Logística.';
    end if;
    new.orden_id := coalesce(new.orden_id, v_orden);
  end if;
  if new.documento_compra_id is not null and not exists (
    select 1 from public.documentos_compra_material d
     where d.id = new.documento_compra_id and d.orden_compra_id = new.orden_compra_id
       and d.tipo = 'FACTURA'
  ) then
    raise exception 'La factura adjunta debe pertenecer a esta compra.';
  end if;
  if new.orden_id is not null and new.unidad_id is not null and not exists (
    select 1 from public.ordenes_trabajo o where o.id = new.orden_id and o.unidad_id = new.unidad_id
  ) then
    raise exception 'La unidad del comprobante debe ser la de la OT.';
  end if;
  if new.estado = 'REGISTRADA' and new.ruta_storage is not null
     and (tg_op = 'INSERT' or new.ruta_storage is distinct from old.ruta_storage) and not exists (
    select 1 from storage.objects s where s.bucket_id = 'comprobantes-financieros' and s.name = new.ruta_storage
      and s.name like 'adquisiciones/' || new.id::text || '/%' and s.metadata->>'mimetype' = 'application/pdf'
  ) then
    raise exception 'Adjunta primero el PDF del comprobante.';
  end if;
  return new;
end $$;
revoke all on function public.fn_proteger_adquisicion() from public, anon, authenticated;

-- Las que leen las OC de una factura ya no cuentan las quitadas.
create or replace function public.fn_compra_con_factura_no_cambia_pago()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if (new.condicion_pago, new.dias_credito, new.moneda) is distinct from (old.condicion_pago, old.dias_credito, old.moneda)
     and exists (select 1 from public.adquisiciones_ordenes_compra where orden_compra_id = new.id and quitada_en is null) then
    raise exception 'La orden de compra % ya tiene factura en Adquisiciones: su condición de pago y su moneda no cambian.',
      coalesce(new.numero, new.referencia) using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_compra_con_factura_no_cambia_pago() from public, anon, authenticated;

create or replace function public.adquisiciones_control(p_ids uuid[])
returns table (adquisicion_id uuid, ordenes jsonb, total_oc numeric, diferencia numeric, control text)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('adquisiciones.ver')) then
    raise exception 'Adquisiciones la ven Contabilidad, Tesorería y Logística.' using errcode = 'insufficient_privilege';
  end if;
  return query
    with oc as (
      select l.adquisicion_id as adq, c.id, c.numero, c.referencia, c.moneda, c.con_factura,
             public.total_orden_compra(c.id) as total,
             exists (select 1 from public.orden_compra_material_detalles d
                      where d.orden_compra_id = c.id and d.precio_unitario is null) as sin_precio,
             o.numero as numero_ot
        from public.adquisiciones_ordenes_compra l
        join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
        left join public.requerimientos_materiales r on r.id = c.requerimiento_id
        left join public.ordenes_trabajo o on o.id = r.orden_id
       where l.adquisicion_id = any (p_ids) and l.quitada_en is null
    )
    select a.id,
           coalesce(jsonb_agg(jsonb_build_object('id', oc.id, 'numero', oc.numero, 'referencia', oc.referencia,
                                                 'moneda', oc.moneda, 'total', oc.total, 'sin_precio', oc.sin_precio,
                                                 'con_factura', oc.con_factura, 'numero_ot', oc.numero_ot)
                              order by oc.numero) filter (where oc.id is not null), '[]'::jsonb),
           case when count(oc.id) = 0 or bool_or(oc.sin_precio) or bool_or(oc.moneda <> a.moneda) then null
                else sum(oc.total)::numeric(14, 2) end,
           case when count(oc.id) = 0 or bool_or(oc.sin_precio) or bool_or(oc.moneda <> a.moneda) then null
                else (a.total - sum(oc.total))::numeric(14, 2) end,
           case when count(oc.id) = 0 then 'SIN_OC'
                when bool_or(oc.moneda <> a.moneda) then 'OTRA_MONEDA'
                when bool_or(oc.sin_precio) then 'SIN_PRECIO'
                when abs(a.total - sum(oc.total)) <= 1 then 'CALZA'
                else 'NO_CALZA' end
      from public.adquisiciones a
      left join oc on oc.adq = a.id
     where a.id = any (p_ids)
     group by a.id;
end;
$$;
revoke all on function public.adquisiciones_control(uuid[]) from public, anon;
grant execute on function public.adquisiciones_control(uuid[]) to authenticated;

create or replace function public.compras_sin_factura()
returns table (orden_compra_id uuid, numero text, proveedor text, referencia text, moneda text, total numeric,
               sin_precio boolean, condicion_pago text, numero_ot text, creado_en timestamptz, en_borrador boolean,
               orden_id uuid)
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('adquisiciones.ver')) then
    raise exception 'Adquisiciones la ven Contabilidad, Tesorería y Logística.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select c.id, c.numero, c.proveedor, c.referencia, c.moneda, public.total_orden_compra(c.id),
           exists (select 1 from public.orden_compra_material_detalles d
                    where d.orden_compra_id = c.id and d.precio_unitario is null),
           c.condicion_pago, o.numero, c.creado_en,
           exists (select 1 from public.adquisiciones_ordenes_compra l
                     join public.adquisiciones a on a.id = l.adquisicion_id
                    where l.orden_compra_id = c.id and a.estado = 'BORRADOR' and l.quitada_en is null),
           r.orden_id
      from public.ordenes_compra_materiales c
      left join public.requerimientos_materiales r on r.id = c.requerimiento_id
      left join public.ordenes_trabajo o on o.id = r.orden_id
     where c.con_factura and c.aprobacion in ('NO_REQUERIDA', 'APROBADA')
       and not exists (select 1 from public.adquisiciones_ordenes_compra l
                         join public.adquisiciones a on a.id = l.adquisicion_id
                        where l.orden_compra_id = c.id and a.estado = 'REGISTRADA' and l.quitada_en is null)
     order by c.creado_en desc
     limit 200;
end;
$$;
revoke all on function public.compras_sin_factura() from public, anon;
grant execute on function public.compras_sin_factura() to authenticated;

create or replace view public.v_compras_credito_sin_comprobante with (security_invoker = true) as
 select c.id as orden_compra_id, r.orden_id, o.numero as numero_ot, c.proveedor, c.referencia,
        c.creado_en::date as fecha_compra, c.creado_en::date + c.dias_credito as fecha_vencimiento,
        case when bool_or(d.precio_unitario is null) then null::numeric
             else round(sum(d.cantidad::numeric * d.precio_unitario), 2)::numeric(14, 2) end as total_estimado,
        c.moneda, c.numero
   from public.ordenes_compra_materiales c
   left join public.requerimientos_materiales r on r.id = c.requerimiento_id
   left join public.ordenes_trabajo o on o.id = r.orden_id
   join public.orden_compra_material_detalles d on d.orden_compra_id = c.id
  where c.condicion_pago = 'CREDITO' and (c.requerimiento_id is null or o.id is not null)
    and not exists (select 1 from public.adquisiciones_ordenes_compra l
                      join public.adquisiciones a on a.id = l.adquisicion_id
                     where l.orden_compra_id = c.id and a.estado = 'REGISTRADA' and l.quitada_en is null)
  group by c.id, r.orden_id, o.numero;

-- p_cambios: {proveedor?, numero_documento?, fecha_emision?, fecha_vencimiento?, moneda?, total?,
--             condicion_pago?, observacion?, ordenes?: [uuid…] (todas las de la factura),
--             pdf_ruta?, lectura?: {fuente, total, moneda, numero, ordenes}}
create or replace function public.corregir_factura_compra(
  p_correccion uuid, p_id uuid, p_motivo text, p_justificante text, p_nombre text, p_cambios jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_adq       public.adquisiciones%rowtype;
  v_nueva     public.adquisiciones%rowtype;
  v_antes     jsonb;
  v_despues   jsonb;
  v_pagado    numeric;
  v_ordenes   uuid[];
  v_actuales  uuid[];
  v_oc        uuid;
  v_otra      text;
  v_principal uuid;
  v_doc_oc    uuid;
  v_lectura   jsonb;
begin
  perform public.exigir_permiso('adquisiciones.registrar');
  select * into v_adq from public.adquisiciones where id = p_id for update;
  if not found then raise exception 'El comprobante no existe.'; end if;
  if exists (select 1 from public.correcciones where id = p_correccion and documento_id = p_id) then
    return p_id;
  end if;
  if v_adq.estado <> 'REGISTRADA' then
    raise exception 'El comprobante % está en borrador: complétalo, no hace falta corregirlo.', v_adq.numero_documento
      using errcode = 'check_violation';
  end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' then
    raise exception 'Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  select coalesce(sum(monto), 0) into v_pagado from public.pagos_adquisicion where adquisicion_id = p_id and anulado_en is null;
  v_actuales := array(select l.orden_compra_id from public.adquisiciones_ordenes_compra l
                       where l.adquisicion_id = p_id and l.quitada_en is null order by l.creado_en);
  v_antes := to_jsonb(v_adq) - 'actualizado_en' - 'lectura_en' || jsonb_build_object('ordenes', to_jsonb(v_actuales));

  v_nueva := v_adq;
  begin
    v_nueva.proveedor := coalesce(btrim(p_cambios->>'proveedor'), v_adq.proveedor);
    v_nueva.numero_documento := coalesce(btrim(p_cambios->>'numero_documento'), v_adq.numero_documento);
    v_nueva.fecha_emision := coalesce((p_cambios->>'fecha_emision')::date, v_adq.fecha_emision);
    v_nueva.fecha_vencimiento := coalesce((p_cambios->>'fecha_vencimiento')::date, v_adq.fecha_vencimiento);
    v_nueva.moneda := coalesce(p_cambios->>'moneda', v_adq.moneda);
    v_nueva.total := coalesce((p_cambios->>'total')::numeric, v_adq.total);
    v_nueva.condicion_pago := coalesce(p_cambios->>'condicion_pago', v_adq.condicion_pago);
    v_nueva.observacion := coalesce(p_cambios->>'observacion', v_adq.observacion);
    v_nueva.ruta_storage := coalesce(nullif(p_cambios->>'pdf_ruta', ''), v_adq.ruta_storage);
    v_ordenes := case when p_cambios ? 'ordenes'
                      then array(select distinct x::uuid from jsonb_array_elements_text(p_cambios->'ordenes') x)
                      else v_actuales end;
  exception when others then
    raise exception 'Revisa los datos de la corrección.' using errcode = 'check_violation';
  end;
  if v_nueva.total <= 0 or v_nueva.total <> round(v_nueva.total, 2) then
    raise exception 'El total va con IGV, mayor que cero, con hasta dos decimales.' using errcode = 'check_violation';
  end if;
  if v_nueva.total < v_pagado then
    raise exception 'Tesorería ya pagó % de esta factura: el total no puede quedar por debajo.', v_pagado using errcode = 'check_violation';
  end if;
  if v_nueva.moneda is distinct from v_adq.moneda and v_pagado > 0 then
    raise exception 'La factura ya tiene pagos: su moneda no cambia. Anula primero los pagos.' using errcode = 'check_violation';
  end if;
  if v_nueva.condicion_pago = 'CONTADO' and v_nueva.fecha_vencimiento <> v_nueva.fecha_emision then
    v_nueva.fecha_vencimiento := v_nueva.fecha_emision;
  end if;
  if cardinality(v_ordenes) > 40 then
    raise exception 'Una factura cubre hasta 40 OC.' using errcode = 'check_violation';
  end if;
  if v_nueva.ruta_storage is distinct from v_adq.ruta_storage
     and v_nueva.ruta_storage !~ ('^adquisiciones/' || p_id::text || '/correccion-[0-9a-f-]{36}\.pdf$') then
    raise exception 'Vuelve a adjuntar el PDF corregido de la factura.' using errcode = 'check_violation';
  end if;

  -- Cada OC nueva espera su factura: no está en otra factura registrada.
  foreach v_oc in array v_ordenes loop
    if v_oc = any (v_actuales) then continue; end if;
    select a.numero_documento into v_otra
      from public.adquisiciones_ordenes_compra l join public.adquisiciones a on a.id = l.adquisicion_id
     where l.orden_compra_id = v_oc and l.quitada_en is null and a.estado = 'REGISTRADA' and a.id <> p_id limit 1;
    if v_otra is not null then
      raise exception 'Una de las OC ya está en la factura %: corrige esa factura primero.', v_otra using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.ordenes_compra_materiales c where c.id = v_oc and c.con_factura) then
      raise exception 'Una de las OC no existe o va sin factura.' using errcode = 'check_violation';
    end if;
  end loop;

  -- La principal fija la OT y el PDF de Logística: si sale, otra de las que quedan.
  v_principal := case when v_adq.orden_compra_id = any (v_ordenes) then v_adq.orden_compra_id else v_ordenes[1] end;
  if v_nueva.documento_compra_id is not null then
    select d.orden_compra_id into v_doc_oc from public.documentos_compra_material d where d.id = v_nueva.documento_compra_id;
    if v_doc_oc = any (v_ordenes) then
      v_principal := v_doc_oc;
    elsif v_nueva.ruta_storage is not null then
      v_nueva.documento_compra_id := null;
    else
      raise exception 'Esta factura usa el PDF que Logística subió a una OC que quitas: adjunta el PDF de la factura.'
        using errcode = 'check_violation';
    end if;
  end if;
  v_nueva.orden_compra_id := v_principal;
  if v_principal is null then v_nueva.orden_id := null; end if;

  v_lectura := p_cambios->'lectura';
  perform set_config('metalwork.corrigiendo', 'factura', true);
  update public.adquisiciones
     set proveedor = v_nueva.proveedor, numero_documento = v_nueva.numero_documento,
         fecha_emision = v_nueva.fecha_emision, fecha_vencimiento = v_nueva.fecha_vencimiento,
         moneda = v_nueva.moneda, total = v_nueva.total, condicion_pago = v_nueva.condicion_pago,
         observacion = v_nueva.observacion, ruta_storage = v_nueva.ruta_storage,
         documento_compra_id = v_nueva.documento_compra_id, orden_compra_id = v_nueva.orden_compra_id,
         orden_id = case when v_nueva.orden_compra_id is distinct from v_adq.orden_compra_id then null else orden_id end,
         lectura_fuente = case when jsonb_typeof(v_lectura) = 'object' then v_lectura->>'fuente' else lectura_fuente end,
         lectura_total = case when jsonb_typeof(v_lectura) = 'object' then (v_lectura->>'total')::numeric else lectura_total end,
         lectura_moneda = case when jsonb_typeof(v_lectura) = 'object' then v_lectura->>'moneda' else lectura_moneda end,
         lectura_numero = case when jsonb_typeof(v_lectura) = 'object' then v_lectura->>'numero' else lectura_numero end,
         lectura_ordenes = case when jsonb_typeof(v_lectura) = 'object'
                                then array(select jsonb_array_elements_text(coalesce(v_lectura->'ordenes', '[]'::jsonb)))
                                else lectura_ordenes end
   where id = p_id;
  -- Las que salen quedan quitadas; las que vuelven se reactivan; las nuevas se enlazan.
  update public.adquisiciones_ordenes_compra set quitada_en = now(), quitada_por = public.usuario_actual()
   where adquisicion_id = p_id and quitada_en is null and not (orden_compra_id = any (v_ordenes));
  update public.adquisiciones_ordenes_compra set quitada_en = null, quitada_por = null
   where adquisicion_id = p_id and quitada_en is not null and orden_compra_id = any (v_ordenes);
  insert into public.adquisiciones_ordenes_compra (adquisicion_id, orden_compra_id)
  select p_id, o from unnest(v_ordenes) o
  on conflict (adquisicion_id, orden_compra_id) do nothing;
  perform set_config('metalwork.corrigiendo', '', true);

  -- Que todas las OC que quedan sean del mismo proveedor y la misma condición que la factura.
  if exists (select 1 from public.adquisiciones_ordenes_compra l
               join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
              where l.adquisicion_id = p_id and l.quitada_en is null and c.condicion_pago <> v_nueva.condicion_pago) then
    raise exception 'Las OC de la factura tienen que ir con la misma condición de pago que ella.' using errcode = 'check_violation';
  end if;
  if (select count(distinct coalesce(c.proveedor_id::text, upper(btrim(c.proveedor))))
        from public.adquisiciones_ordenes_compra l join public.ordenes_compra_materiales c on c.id = l.orden_compra_id
       where l.adquisicion_id = p_id and l.quitada_en is null) > 1 then
    raise exception 'Una factura es de un solo proveedor: sus OC tienen que ser del mismo.' using errcode = 'check_violation';
  end if;

  select * into v_nueva from public.adquisiciones where id = p_id;
  v_despues := to_jsonb(v_nueva) - 'actualizado_en' - 'lectura_en'
    || jsonb_build_object('ordenes', to_jsonb(array(select l.orden_compra_id from public.adquisiciones_ordenes_compra l
                                                     where l.adquisicion_id = p_id and l.quitada_en is null order by l.creado_en)));
  perform public.registrar_correccion(p_correccion, 'FACTURA_COMPRA', p_id, v_nueva.numero_documento, p_motivo, p_justificante,
                                      p_nombre, v_antes, v_despues);
  return p_id;
end $$;
revoke all on function public.corregir_factura_compra(uuid, uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.corregir_factura_compra(uuid, uuid, text, text, text, jsonb) to authenticated;
