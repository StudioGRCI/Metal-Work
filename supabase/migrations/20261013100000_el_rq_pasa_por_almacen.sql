-- =============================================================================
-- EL REQUERIMIENTO PASA PRIMERO POR ALMACÉN
-- -----------------------------------------------------------------------------
-- Gerencia (2026-10-13) corrigió el circuito del RQ: no va directo a Logística.
-- Primero lo revisa Almacén: si tiene stock, queda listo en almacén y el
-- supervisor del área va a recogerlo. Si no tiene stock, recién pasa a
-- Logística, que hace la orden de compra; el conductor la recoge y la deja en
-- almacén, Almacén la recepciona y el RQ vuelve a quedar listo en almacén. La
-- salida de Almacén se hace por ese mismo RQ, porque el RQ ya dice qué área
-- recibe y para qué unidad.
--
-- Así queda el estado del RQ (quién lo marca):
--   POR_ATENDER       Requerimientos lo emitió; Almacén revisa el stock.
--   SIN_STOCK         Almacén dijo que no hay; le toca a Logística comprar.
--   EN_ATENCION       Logística ya está comprando (la OC la vincula su hilo).
--   LISTO_EN_ALMACEN  Almacén lo tiene (había stock, o ya llegó la compra);
--                     Supervisión del área va a recogerlo.
--   ENTREGADO         Almacén lo entregó al área: el RQ se cierra.
--   ANULADO           Requerimientos lo anuló con motivo, antes de que
--                     Logística empiece.
--
-- ATENDIDO desaparece: lo que cerraba Logística ahora lo cierra Almacén al
-- entregar. No hay filas con ese estado en producción (el circuito se estrenó
-- el 2026-10-12 sin ningún RQ emitido).
-- =============================================================================

-- 1. Los estados y la huella de cada paso ------------------------------------
alter table public.requerimientos
  add column if not exists revision_stock_en     timestamptz,
  add column if not exists revision_stock_por    uuid references public.usuarios(id) on delete restrict,
  add column if not exists nota_almacen          text,
  add column if not exists en_atencion_en        timestamptz,
  add column if not exists en_atencion_por       uuid references public.usuarios(id) on delete restrict,
  add column if not exists nota_logistica        text,
  add column if not exists listo_en_almacen_en   timestamptz,
  add column if not exists listo_en_almacen_por  uuid references public.usuarios(id) on delete restrict,
  add column if not exists entregado_en          timestamptz,
  add column if not exists entregado_por         uuid references public.usuarios(id) on delete restrict,
  add column if not exists nota_entrega          text;

comment on column public.requerimientos.estado is
  'POR_ATENDER (Almacén revisa stock) → SIN_STOCK (Logística compra) → EN_ATENCION → LISTO_EN_ALMACEN (Supervisión recoge) → ENTREGADO. O LISTO_EN_ALMACEN directo si había stock. ANULADO con motivo.';
comment on column public.requerimientos.nota_almacen is 'Lo que Almacén anotó al revisar el stock o al recepcionar la compra.';
comment on column public.requerimientos.nota_entrega is 'Quién del área recogió, según Almacén; el formato firmado lo lleva el hilo de Almacén.';

alter table public.requerimientos drop constraint if exists ck_rq_estado;
alter table public.requerimientos add constraint ck_rq_estado check (
  estado in ('POR_ATENDER', 'SIN_STOCK', 'EN_ATENCION', 'LISTO_EN_ALMACEN', 'ENTREGADO', 'ANULADO')
  and (estado <> 'ANULADO' or (anulado_por is not null and anulado_en is not null
                               and char_length(btrim(coalesce(motivo_anulacion, ''))) between 10 and 500))
  and (estado <> 'LISTO_EN_ALMACEN' or listo_en_almacen_en is not null)
  and (estado <> 'ENTREGADO' or (listo_en_almacen_en is not null and entregado_en is not null and entregado_por is not null))
);

-- Lo que ya se entregó o se anuló queda congelado como evidencia.
create or replace function public.fn_rq_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Un requerimiento no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if row(new.numero, new.area_id, new.codigo_interno, new.justificacion, new.fecha_requerida, new.creado_por, new.creado_en)
     is distinct from row(old.numero, old.area_id, old.codigo_interno, old.justificacion, old.fecha_requerida, old.creado_por, old.creado_en) then
    raise exception 'El requerimiento % ya se registró: si cambió, anúlalo y registra otro.', old.numero
      using errcode = 'check_violation';
  end if;
  if old.estado in ('ENTREGADO', 'ANULADO') and new.estado is distinct from old.estado then
    raise exception 'El requerimiento % ya está %: queda como evidencia.', old.numero,
      case old.estado when 'ENTREGADO' then 'entregado' else 'anulado' end using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- 2. Quién lo ve ----------------------------------------------------------------
-- Almacén lo revisa y lo entrega; Supervisión lo ve para saber qué recoger.
create or replace function public.puede_ver_requerimientos()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select public.es_admin() or public.tiene_permiso('requerimientos.emitir')
      or public.tiene_permiso('requerimientos.ver') or public.tiene_permiso('compras.crear')
      or public.tiene_permiso('almacen.recibir') or public.tiene_permiso('almacen.despachar');
$$;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'requerimientos.ver' from public.roles r
 where r.codigo in ('SUPERVISOR', 'JEFE_PRODUCCION', 'SUPERVISOR_GENERAL', 'ALMACENERO')
on conflict do nothing;

-- Los avisos van a cuentas, no a nombres: quien en Logística compra, quien en
-- Almacén recibe, quien supervisa el área que pidió.
create or replace function public.fn_rq_avisar(p_rq public.requerimientos, p_titulo text, p_cuerpo text, p_a text)
returns void language plpgsql security definer set search_path to 'public' as $$
begin
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, p_titulo, p_cuerpo,
         case when p_a in ('LOGISTICA', 'ALMACEN') then '/requerimientos/atencion' else '/requerimientos' end,
         'requerimientos', p_rq.id
    from public.usuarios u
    left join public.areas a on a.id = u.area_id
   where u.activo
     and u.id is distinct from public.usuario_actual()
     and case p_a
           when 'LOGISTICA' then a.codigo = 'LOG' and exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id and rp.permiso_codigo = 'compras.crear')
           when 'ALMACEN'   then exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id and rp.permiso_codigo = 'almacen.recibir')
           when 'AREA'      then u.area_id = p_rq.area_id and exists (select 1 from public.roles_permisos rp where rp.rol_id = u.rol_id and rp.permiso_codigo = 'produccion.actividades')
           when 'EMISOR'    then u.id = p_rq.creado_por
           else false
         end;
end;
$$;
revoke all on function public.fn_rq_avisar(public.requerimientos, text, text, text) from public, anon, authenticated;

-- 3. Almacén revisa el stock -----------------------------------------------------
create or replace function public.rq_marcar_sin_stock(p_id uuid, p_nota text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_rq public.requerimientos%rowtype;
begin
  perform public.exigir_permiso('almacen.recibir');
  select * into v_rq from public.requerimientos where id = p_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  if v_rq.estado = 'SIN_STOCK' then return p_id; end if;
  if v_rq.estado <> 'POR_ATENDER' then
    raise exception 'El requerimiento % ya pasó la revisión de stock.', v_rq.numero using errcode = 'check_violation';
  end if;
  if char_length(coalesce(p_nota, '')) > 500 then
    raise exception 'La nota pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;
  update public.requerimientos
     set estado = 'SIN_STOCK', revision_stock_en = now(), revision_stock_por = public.usuario_actual(),
         nota_almacen = nullif(btrim(coalesce(p_nota, '')), '')
   where id = p_id;
  perform public.fn_rq_avisar(v_rq, 'Requerimiento sin stock: ' || v_rq.numero,
    'Almacén no lo tiene. Hay que comprarlo: ' || v_rq.codigo_interno
      || coalesce(' · ' || nullif(btrim(coalesce(p_nota, '')), ''), ''), 'LOGISTICA');
  return p_id;
end;
$$;
revoke all on function public.rq_marcar_sin_stock(uuid, text) from public, anon;
grant execute on function public.rq_marcar_sin_stock(uuid, text) to authenticated;

-- Con stock, o cuando llegó lo comprado: queda en almacén para que el área lo recoja.
create or replace function public.rq_marcar_listo_en_almacen(p_id uuid, p_nota text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_rq public.requerimientos%rowtype; v_area text;
begin
  perform public.exigir_permiso('almacen.recibir');
  select * into v_rq from public.requerimientos where id = p_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  if v_rq.estado = 'LISTO_EN_ALMACEN' then return p_id; end if;
  if v_rq.estado not in ('POR_ATENDER', 'SIN_STOCK', 'EN_ATENCION') then
    raise exception 'El requerimiento % ya está %.', v_rq.numero, lower(replace(v_rq.estado, '_', ' '))
      using errcode = 'check_violation';
  end if;
  if char_length(coalesce(p_nota, '')) > 500 then
    raise exception 'La nota pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;
  update public.requerimientos
     set estado = 'LISTO_EN_ALMACEN',
         revision_stock_en = coalesce(revision_stock_en, now()),
         revision_stock_por = coalesce(revision_stock_por, public.usuario_actual()),
         listo_en_almacen_en = now(), listo_en_almacen_por = public.usuario_actual(),
         nota_almacen = coalesce(nullif(btrim(coalesce(p_nota, '')), ''), nota_almacen)
   where id = p_id;
  select nombre into v_area from public.areas where id = v_rq.area_id;
  perform public.fn_rq_avisar(v_rq, 'Listo en almacén: ' || v_rq.numero,
    coalesce(v_area, 'El área') || ' puede recogerlo · ' || v_rq.codigo_interno, 'AREA');
  perform public.fn_rq_avisar(v_rq, 'Listo en almacén: ' || v_rq.numero,
    coalesce(v_area, 'El área') || ' ya puede recogerlo.', 'EMISOR');
  return p_id;
end;
$$;
revoke all on function public.rq_marcar_listo_en_almacen(uuid, text) from public, anon;
grant execute on function public.rq_marcar_listo_en_almacen(uuid, text) to authenticated;

-- 4. Logística lo compra ---------------------------------------------------------
-- Marca que ya está en ello; la OC se le vincula desde el hilo de Logística.
create or replace function public.rq_marcar_en_atencion(p_id uuid, p_nota text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_rq public.requerimientos%rowtype;
begin
  perform public.exigir_permiso('compras.crear');
  select * into v_rq from public.requerimientos where id = p_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  if v_rq.estado = 'EN_ATENCION' then return p_id; end if;
  if v_rq.estado = 'POR_ATENDER' then
    raise exception 'Almacén todavía no revisó el stock del requerimiento %.', v_rq.numero using errcode = 'check_violation';
  end if;
  if v_rq.estado <> 'SIN_STOCK' then
    raise exception 'El requerimiento % ya está %.', v_rq.numero, lower(replace(v_rq.estado, '_', ' '))
      using errcode = 'check_violation';
  end if;
  if char_length(coalesce(p_nota, '')) > 500 then
    raise exception 'La nota pasa de 500 caracteres.' using errcode = 'check_violation';
  end if;
  update public.requerimientos
     set estado = 'EN_ATENCION', en_atencion_en = now(), en_atencion_por = public.usuario_actual(),
         nota_logistica = nullif(btrim(coalesce(p_nota, '')), '')
   where id = p_id;
  perform public.fn_rq_avisar(v_rq, 'Logística está comprando: ' || v_rq.numero,
    'Cuando el conductor lo deje, recepciónalo y márcalo listo en almacén.', 'ALMACEN');
  return p_id;
end;
$$;
revoke all on function public.rq_marcar_en_atencion(uuid, text) from public, anon;
grant execute on function public.rq_marcar_en_atencion(uuid, text) to authenticated;

-- 5. Almacén lo entrega al área ---------------------------------------------------
create or replace function public.rq_marcar_entregado(p_id uuid, p_nota text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_rq public.requerimientos%rowtype;
begin
  perform public.exigir_permiso('almacen.despachar');
  select * into v_rq from public.requerimientos where id = p_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  if v_rq.estado = 'ENTREGADO' then return p_id; end if;
  if v_rq.estado <> 'LISTO_EN_ALMACEN' then
    raise exception 'El requerimiento % todavía no está listo en almacén.', v_rq.numero using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_nota, ''))) not between 3 and 500 then
    raise exception 'Anota quién del área lo recogió.' using errcode = 'check_violation';
  end if;
  update public.requerimientos
     set estado = 'ENTREGADO', entregado_en = now(), entregado_por = public.usuario_actual(),
         nota_entrega = btrim(p_nota)
   where id = p_id;
  perform public.fn_rq_avisar(v_rq, 'Entregado: ' || v_rq.numero, 'Almacén lo entregó: ' || btrim(p_nota), 'EMISOR');
  return p_id;
end;
$$;
revoke all on function public.rq_marcar_entregado(uuid, text) from public, anon;
grant execute on function public.rq_marcar_entregado(uuid, text) to authenticated;

-- 6. Anular: mientras Logística no empieza a comprar -----------------------------
create or replace function public.anular_requerimiento(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_rq public.requerimientos%rowtype;
begin
  perform public.exigir_permiso('requerimientos.emitir');
  if char_length(btrim(coalesce(p_motivo, ''))) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_rq from public.requerimientos where id = p_id for update;
  if not found then raise exception 'El requerimiento no existe.'; end if;
  if v_rq.estado = 'ANULADO' then return p_id; end if;
  if v_rq.estado not in ('POR_ATENDER', 'SIN_STOCK') then
    raise exception 'El requerimiento % ya está %: ya no se anula.', v_rq.numero, lower(replace(v_rq.estado, '_', ' '))
      using errcode = 'check_violation';
  end if;
  update public.requerimientos
     set estado = 'ANULADO', anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
   where id = p_id;
  perform public.fn_rq_avisar(v_rq, 'Requerimiento anulado: ' || v_rq.numero, btrim(p_motivo), 'LOGISTICA');
  perform public.fn_rq_avisar(v_rq, 'Requerimiento anulado: ' || v_rq.numero, btrim(p_motivo), 'ALMACEN');
  return p_id;
end;
$$;

-- El aviso al emitir ahora va a Almacén, que es quien revisa primero.
create or replace function public.emitir_requerimiento(
  p_id uuid, p_area_id uuid, p_codigo_interno text, p_justificacion text, p_fecha_requerida date, p_lineas jsonb
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_actual   public.requerimientos%rowtype;
  v_numero   text;
  v_area     text;
  v_linea    jsonb;
  v_item     int := 0;
  v_desc     text;
  v_cant     numeric;
  v_unidad   uuid;
  v_cat      uuid;
  v_hoy      date := (now() at time zone 'America/Lima')::date;
begin
  perform public.exigir_permiso('requerimientos.emitir');
  if p_id is null then
    raise exception 'Vuelve a abrir el formulario del requerimiento.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_codigo_interno, ''))) not between 2 and 60 then
    raise exception 'Escribe el código interno de la unidad (de 2 a 60 caracteres). Si no es para una unidad, escribe PLANTA.'
      using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_justificacion, ''))) not between 10 and 1000 then
    raise exception 'Explica para qué se necesita, en al menos 10 caracteres: Almacén y Logística lo leen para priorizar.'
      using errcode = 'check_violation';
  end if;
  if p_fecha_requerida is not null and p_fecha_requerida < v_hoy then
    raise exception 'La fecha en que se necesita no puede ser anterior a hoy.' using errcode = 'check_violation';
  end if;
  select nombre into v_area from public.areas where id = p_area_id and activo;
  if v_area is null then
    raise exception 'Elige el área que necesita los insumos.' using errcode = 'check_violation';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agrega al menos un insumo al requerimiento.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_lineas) > 100 then
    raise exception 'Un requerimiento lleva hasta 100 insumos. Divídelo en dos.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_actual from public.requerimientos where id = p_id;
  if found then
    if v_actual.creado_por = public.usuario_actual() and v_actual.area_id = p_area_id
       and v_actual.codigo_interno = btrim(p_codigo_interno) and v_actual.justificacion = btrim(p_justificacion) then
      return p_id;
    end if;
    raise exception 'Este requerimiento ya existe con otros datos. Recarga antes de intentar de nuevo.';
  end if;

  v_numero := public.siguiente_correlativo('REQUERIMIENTO', '001', null);
  insert into public.requerimientos (id, numero, area_id, codigo_interno, justificacion, fecha_requerida, creado_por)
  values (p_id, v_numero, p_area_id, btrim(p_codigo_interno), btrim(p_justificacion), p_fecha_requerida,
          public.usuario_actual());

  for v_linea in select value from jsonb_array_elements(p_lineas) loop
    v_item := v_item + 1;
    v_desc := btrim(coalesce(v_linea->>'descripcion', ''));
    if char_length(v_desc) not between 3 and 300 then
      raise exception 'Describe el insumo % en 3 a 300 caracteres.', v_item using errcode = 'check_violation';
    end if;
    begin
      v_cant := (v_linea->>'cantidad')::numeric;
      v_unidad := (v_linea->>'unidad_medida_id')::uuid;
      v_cat := (v_linea->>'categoria_id')::uuid;
    exception when others then
      raise exception 'Revisa la cantidad, la unidad y la categoría del insumo %.', v_item using errcode = 'check_violation';
    end;
    if v_cant is null or v_cant <= 0 or v_cant > 999999999 or v_cant <> round(v_cant, 3) then
      raise exception 'La cantidad del insumo % debe ser mayor que cero, con hasta tres decimales.', v_item
        using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.unidades_medida where id = v_unidad and activo) then
      raise exception 'Elige la unidad del insumo %.', v_item using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.categorias_material
                    where id = v_cat and activo and codigo <> 'ALM_POR_CLASIFICAR') then
      raise exception 'Elige la categoría del insumo %.', v_item using errcode = 'check_violation';
    end if;
    insert into public.requerimiento_lineas (requerimiento_id, item, descripcion, cantidad, unidad_medida_id, categoria_id)
    values (p_id, v_item, v_desc, v_cant, v_unidad, v_cat);
  end loop;

  select * into v_actual from public.requerimientos where id = p_id;
  perform public.fn_rq_avisar(v_actual, 'Requerimiento por revisar: ' || v_numero,
    v_area || ' · ' || btrim(p_codigo_interno) || ' · ' || v_item || case when v_item = 1 then ' insumo' else ' insumos' end
      || '. Revisa si hay stock.', 'ALMACEN');
  return p_id;
end;
$$;
