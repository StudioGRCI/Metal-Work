-- =============================================================================
-- LA ORDEN DE SERVICIO LLEVA SU CÓDIGO INTERNO Y SU DETRACCIÓN
-- -----------------------------------------------------------------------------
-- Gerencia lo pidió el 2026-10-14: «las órdenes de servicio deben estar
-- vinculadas por código interno, además llevar un control de impuestos: si lleva
-- detracción y qué porcentaje según ley».
--
-- EL CÓDIGO INTERNO. El requerimiento y la orden de compra ya llevan el código
-- de la unidad (PLA_SR_O4_1_26/28, o PLANTA si no es para una unidad); la OS
-- solo decía la OT, y casi ninguna unidad del taller tiene todavía su OT en el
-- sistema. Desde aquí toda OS nueva lleva su código, escrito igual que en la OC,
-- y Gerencia la ve en «Códigos internos», en los documentos de ese código.
-- Logística lo corrige mientras la OS no tiene conformidad.
--
-- LA DETRACCIÓN (SPOT, Decreto Legislativo 940). Quien contrata un servicio
-- afecto deposita un porcentaje del total, con IGV, en la cuenta de detracciones
-- del proveedor en el Banco de la Nación, y le paga el resto. El porcentaje lo
-- fija SUNAT por tipo de servicio:
--   * Anexo 3 de la R.S. 183-2004/SUNAT (los de 12 % según la R.S. 071-2018/SUNAT),
--     cuando el total con IGV pasa de S/ 700;
--   * transporte de bienes por vía terrestre, 4 % (R.S. 073-2006/SUNAT), cuando
--     pasa de S/ 400 (la norma toma el mayor entre el total y el valor
--     referencial; aquí se mira el total).
-- El depósito va en soles enteros. Vigente así al 2026-10-14; si SUNAT cambia
-- un porcentaje, se cambia en `detracciones_servicio` con otra migración.
--
-- Al emitir la OS, Logística elige el tipo de servicio según SUNAT, o dice que
-- no está sujeta y por qué (el proveedor no cobra IGV, por ejemplo). La OS
-- guarda el porcentaje y el mínimo de ese día: si la ley cambia después, las OS
-- emitidas no se reescriben. El monto de la detracción lo calcula la base: el
-- monto sin IGV de la OS, en soles, por 1.18, y si pasa del mínimo, su
-- porcentaje redondeado al sol. En dólares se usa el tipo de cambio del día en
-- que se emitió: es una estimación, y el depósito se hace con la factura.
-- Contabilidad, con un permiso propio, corrige el tipo de detracción aunque la
-- OS ya tenga conformidad: es quien responde por los impuestos.
--
-- Sin DROP: el conector de producción no deja pasar ninguno. La emisión cambia
-- de firma: la nueva pide el código y la detracción, y la vieja deja de estar
-- disponible para las cuentas (se aplica junto con la pantalla que la usa).
-- =============================================================================

-- 1. El permiso de Contabilidad -----------------------------------------------------
insert into public.permisos (codigo, modulo, descripcion) values
  ('compras.detraccion', 'Contabilidad',
   'Corregir si una orden de servicio lleva detracción y de qué tipo según SUNAT, aunque ya tenga conformidad')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'compras.detraccion' from public.roles r where r.codigo = 'CONTABILIDAD'
on conflict do nothing;

-- 2. Los tipos de servicio con detracción, según SUNAT ------------------------------
create table if not exists public.detracciones_servicio (
  codigo          text primary key,
  descripcion     text not null,
  porcentaje      numeric(5, 2) not null,
  monto_minimo    numeric(12, 2) not null,
  ejemplos        text not null,
  base_legal      text not null,
  orden           smallint not null,
  activo          boolean not null default true,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now(),
  constraint ck_detraccion_servicio_codigo check (codigo ~ '^[0-9]{3}$'),
  constraint ck_detraccion_servicio_valores check (porcentaje > 0 and porcentaje < 100 and monto_minimo >= 0)
);
comment on table public.detracciones_servicio is
  'Los servicios sujetos a detracción (SPOT) con el código, el porcentaje y el monto mínimo de SUNAT. Se cambia por migración cuando cambia la ley.';
comment on column public.detracciones_servicio.codigo is 'El código del bien o servicio en la tabla de SUNAT (el que va en la constancia de depósito).';
comment on column public.detracciones_servicio.monto_minimo is 'La detracción aplica cuando el total con IGV PASA de este monto, en soles.';

select public.activar_timestamps('detracciones_servicio');

alter table public.detracciones_servicio enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'detracciones_servicio'
                   and policyname = 'ver_detracciones_servicio') then
    -- Quien ve las órdenes de servicio ve los tipos de detracción que eligen.
    create policy ver_detracciones_servicio on public.detracciones_servicio for select to authenticated using (
      (select public.es_admin())
      or (select public.tiene_permiso('compras.ver'))
      or (select public.tiene_permiso('compras.crear'))
      or (select public.tiene_permiso('compras.detraccion'))
      or (select public.tiene_permiso('tesoreria.ver_documentos'))
      or (select public.tiene_permiso('costos.ver'))
      or (select public.es_aprobador_compras())
    );
  end if;
end $$;
-- Se cambia solo por migración.
revoke all on public.detracciones_servicio from public, anon, authenticated;
grant select on public.detracciones_servicio to authenticated;

insert into public.detracciones_servicio (codigo, descripcion, porcentaje, monto_minimo, ejemplos, base_legal, orden) values
  ('025', 'Fabricación de bienes por encargo', 10, 700,
   'Una parte del proceso de fabricación sobre el material o la pieza que entrega Metal Work: torno, doblado, corte, arenado o pintura.',
   'R.S. 183-2004/SUNAT, Anexo 3, numeral 7', 1),
  ('020', 'Mantenimiento y reparación de bienes muebles', 12, 700,
   'Reparación o mantenimiento de una máquina, una herramienta, un motor o una unidad.',
   'R.S. 183-2004/SUNAT, Anexo 3, numeral 3; porcentaje según R.S. 071-2018/SUNAT', 2),
  ('027', 'Transporte de bienes por vía terrestre', 4, 400,
   'Flete o traslado de material o de una unidad por carretera.',
   'R.S. 073-2006/SUNAT', 3),
  ('019', 'Arrendamiento de bienes', 10, 700,
   'Alquiler de una grúa, un montacargas, andamios, equipos o un local.',
   'R.S. 183-2004/SUNAT, Anexo 3, numeral 2', 4),
  ('021', 'Movimiento de carga', 10, 700,
   'Estiba, carga y descarga de material.',
   'R.S. 183-2004/SUNAT, Anexo 3, numeral 4', 5),
  ('012', 'Intermediación laboral y tercerización', 12, 700,
   'Personal destacado por otra empresa, o una actividad del taller encargada a un tercero con su propio personal.',
   'R.S. 183-2004/SUNAT, Anexo 3, numeral 1; porcentaje según R.S. 071-2018/SUNAT', 6),
  ('022', 'Otros servicios empresariales', 12, 700,
   'Asesoría contable o legal, ingeniería, limpieza, seguridad o publicidad.',
   'R.S. 183-2004/SUNAT, Anexo 3, numeral 5; porcentaje según R.S. 071-2018/SUNAT', 7),
  ('024', 'Comisión mercantil', 10, 700,
   'Un tercero que vende o compra por cuenta de Metal Work a cambio de una comisión.',
   'R.S. 183-2004/SUNAT, Anexo 3, numeral 6', 8),
  ('026', 'Servicio de transporte de personas', 10, 700,
   'Movilidad del personal.',
   'R.S. 183-2004/SUNAT, Anexo 3, numeral 8', 9),
  ('030', 'Contratos de construcción', 4, 700,
   'Obra civil o instalaciones en la planta.',
   'R.S. 183-2004/SUNAT, Anexo 3, numeral 9', 10),
  ('037', 'Demás servicios gravados con el IGV', 12, 700,
   'Cualquier otro servicio con IGV que no calce en los anteriores.',
   'R.S. 183-2004/SUNAT, Anexo 3, numeral 10; porcentaje según R.S. 071-2018/SUNAT', 11)
on conflict (codigo) do update
   set descripcion = excluded.descripcion, porcentaje = excluded.porcentaje, monto_minimo = excluded.monto_minimo,
       ejemplos = excluded.ejemplos, base_legal = excluded.base_legal, orden = excluded.orden, activo = true;

-- 3. Las columnas de la OS ----------------------------------------------------------
alter table public.ordenes_servicio
  add column if not exists codigo_interno        text,
  add column if not exists detraccion_afecta     boolean,
  add column if not exists detraccion_codigo     text references public.detracciones_servicio(codigo) on delete restrict,
  add column if not exists detraccion_porcentaje numeric(5, 2),
  add column if not exists detraccion_minimo     numeric(12, 2),
  add column if not exists detraccion_motivo     text;

-- El total con IGV en soles y lo que se deposita, calculados por la base para
-- que la pantalla, Tesorería y cualquier reporte digan lo mismo.
alter table public.ordenes_servicio
  add column if not exists total_con_igv_pen numeric(14, 2)
    generated always as (round(monto_pen * 1.18, 2)) stored;
alter table public.ordenes_servicio
  add column if not exists detraccion_monto numeric(14, 2)
    generated always as (
      case when detraccion_afecta and monto_pen is not null and round(monto_pen * 1.18, 2) > detraccion_minimo
           then round(round(monto_pen * 1.18, 2) * detraccion_porcentaje / 100, 0) end) stored;

comment on column public.ordenes_servicio.codigo_interno is
  'Código interno de la unidad para la que se pide el servicio (PLA_SR_O4_1_26/28…), o PLANTA. Mismo formato que la OC y el RQ. Vacío solo en las OS de antes.';
comment on column public.ordenes_servicio.detraccion_afecta is
  'Verdadero si el servicio está sujeto a detracción; falso si no lo está (con su motivo); vacío si nadie lo decidió (OS de antes).';
comment on column public.ordenes_servicio.detraccion_porcentaje is
  'El porcentaje de SUNAT del día en que se eligió el tipo. No cambia si después cambia la ley.';
comment on column public.ordenes_servicio.total_con_igv_pen is
  'El monto sin IGV en soles por 1.18. En dólares, con el tipo de cambio del día de emisión: una estimación.';
comment on column public.ordenes_servicio.detraccion_monto is
  'Lo que se deposita en la cuenta de detracciones del proveedor, en soles enteros. Vacío si no lleva, si no pasa del mínimo o si falta el tipo de cambio.';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_os_codigo_interno'
                   and conrelid = 'public.ordenes_servicio'::regclass) then
    alter table public.ordenes_servicio add constraint ck_os_codigo_interno
      check (codigo_interno is null or char_length(codigo_interno) between 2 and 60);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_os_detraccion'
                   and conrelid = 'public.ordenes_servicio'::regclass) then
    alter table public.ordenes_servicio add constraint ck_os_detraccion check (
      (detraccion_afecta is null and detraccion_codigo is null and detraccion_porcentaje is null
       and detraccion_minimo is null and detraccion_motivo is null)
      or (detraccion_afecta = false and detraccion_codigo is null and detraccion_porcentaje is null
          and detraccion_minimo is null and char_length(coalesce(detraccion_motivo, '')) between 5 and 200)
      or (detraccion_afecta = true and detraccion_codigo is not null and detraccion_porcentaje > 0
          and detraccion_porcentaje < 100 and detraccion_minimo >= 0 and detraccion_motivo is null));
  end if;
end $$;

-- 4. La guardia: con conformidad, solo la detracción se corrige --------------------
create or replace function public.fn_os_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  -- Las columnas calculadas también: en un disparador BEFORE todavía no tienen
  -- su valor nuevo.
  c_detraccion constant text[] := array['detraccion_afecta', 'detraccion_codigo', 'detraccion_porcentaje',
                                        'detraccion_minimo', 'detraccion_motivo', 'detraccion_monto',
                                        'total_con_igv_pen', 'actualizado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Una orden de servicio no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if new.numero is distinct from old.numero or new.creado_por is distinct from old.creado_por
     or new.creado_en is distinct from old.creado_en then
    raise exception 'El número y el autor de la orden de servicio no cambian.' using errcode = 'check_violation';
  end if;
  if old.estado = 'ANULADA' then
    raise exception 'La orden de servicio % ya está anulada: queda como evidencia.', old.numero using errcode = 'check_violation';
  end if;
  -- Con conformidad queda como evidencia, salvo la detracción, que Contabilidad
  -- puede corregir hasta que se pague.
  if old.estado = 'CONFORME'
     and (to_jsonb(new) - c_detraccion) is distinct from (to_jsonb(old) - c_detraccion) then
    raise exception 'La orden de servicio % ya está conforme: queda como evidencia.', old.numero using errcode = 'check_violation';
  end if;
  if old.aprobacion = 'RECHAZADA' and new.estado <> 'ANULADA' then
    raise exception 'La orden de servicio % fue rechazada. Emite otra.', old.numero using errcode = 'check_violation';
  end if;
  -- Lo que Gerencia aprobó no se cambia por debajo.
  if old.aprobacion <> 'POR_APROBAR'
     and row(new.proveedor_id, new.orden_id, new.descripcion, new.moneda, new.monto, new.condicion_pago, new.dias_credito)
         is distinct from row(old.proveedor_id, old.orden_id, old.descripcion, old.moneda, old.monto, old.condicion_pago, old.dias_credito) then
    raise exception 'La orden de servicio % ya fue decidida por Gerencia: anúlala y emite otra si cambió.', old.numero
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_os_guardia() from public, anon, authenticated;

-- 5. La detracción elegida, validada ------------------------------------------------
-- p_detraccion: el código de SUNAT, o NO_SUJETA con su motivo.
create or replace function public.detraccion_elegida(
  p_detraccion text, p_motivo text,
  out afecta boolean, out codigo text, out porcentaje numeric, out minimo numeric, out motivo text
) language plpgsql stable set search_path to 'public' as $$
declare v public.detracciones_servicio%rowtype;
begin
  if nullif(btrim(coalesce(p_detraccion, '')), '') is null then
    raise exception 'Indica si el servicio lleva detracción: elige su tipo según SUNAT, o «No está sujeta» con el motivo.'
      using errcode = 'check_violation';
  end if;
  if p_detraccion = 'NO_SUJETA' then
    if char_length(btrim(coalesce(p_motivo, ''))) not between 5 and 200 then
      raise exception 'Escribe por qué no está sujeta a detracción (de 5 a 200 caracteres), por ejemplo: el proveedor no cobra IGV.'
        using errcode = 'check_violation';
    end if;
    afecta := false;
    motivo := btrim(p_motivo);
    return;
  end if;
  select * into v from public.detracciones_servicio d where d.codigo = btrim(p_detraccion) and d.activo;
  if not found then
    raise exception 'Ese tipo de detracción no está en la lista de SUNAT. Recarga la pantalla y vuelve a elegirlo.'
      using errcode = 'check_violation';
  end if;
  afecta := true;
  codigo := v.codigo;
  porcentaje := v.porcentaje;
  minimo := v.monto_minimo;
end;
$$;
revoke all on function public.detraccion_elegida(text, text) from public, anon, authenticated;

-- 6. Emitir, con el código y la detracción --------------------------------------------
create or replace function public.emitir_orden_servicio(
  p_id uuid, p_proveedor_id uuid, p_orden_id uuid, p_area_id uuid, p_codigo_interno text, p_descripcion text,
  p_referencia text, p_fecha_inicio date, p_fecha_fin date, p_moneda text, p_monto numeric, p_condicion text,
  p_dias integer, p_detraccion text, p_motivo_detraccion text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_proveedor public.proveedores%rowtype;
  v_actual    public.ordenes_servicio%rowtype;
  v_regla     public.regla_aprobacion_compras%rowtype;
  v_det       record;
  v_numero    text;
  v_tc        numeric;
  v_pen       numeric;
begin
  perform public.exigir_permiso('compras.crear');
  if p_id is null or char_length(btrim(coalesce(p_descripcion, ''))) not between 10 and 1000 then
    raise exception 'Describe el servicio en al menos 10 caracteres: qué se hace, a qué pieza o unidad.' using errcode = 'check_violation';
  end if;
  if char_length(btrim(coalesce(p_codigo_interno, ''))) not between 2 and 60 then
    raise exception 'Escribe el código interno de la unidad (de 2 a 60 caracteres). Si no es para una unidad, escribe PLANTA.'
      using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto < 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2)
     or p_moneda is null or p_moneda not in ('PEN', 'USD') then
    raise exception 'Indica el monto sin IGV y la moneda.' using errcode = 'check_violation';
  end if;
  if p_condicion is null or p_condicion not in ('CONTADO', 'CREDITO') or p_dias is null
     or (p_condicion = 'CONTADO' and p_dias <> 0) or (p_condicion = 'CREDITO' and p_dias not between 1 and 365) then
    raise exception 'Indica el plazo de pago válido.' using errcode = 'check_violation';
  end if;
  if p_fecha_inicio is not null and p_fecha_fin is not null and p_fecha_fin < p_fecha_inicio then
    raise exception 'La fecha de término no puede ser anterior a la de inicio.' using errcode = 'check_violation';
  end if;
  if nullif(btrim(p_referencia), '') is not null and char_length(btrim(p_referencia)) not between 2 and 100 then
    raise exception 'La referencia del proveedor va de 2 a 100 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_det from public.detraccion_elegida(p_detraccion, p_motivo_detraccion);
  select * into v_proveedor from public.proveedores where id = p_proveedor_id;
  if not found then
    raise exception 'Elige un proveedor del padrón.' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into v_actual from public.ordenes_servicio where id = p_id;
  if found then
    if v_actual.creado_por = public.usuario_actual() and v_actual.proveedor_id = p_proveedor_id
       and v_actual.descripcion = btrim(p_descripcion) and v_actual.monto = p_monto and v_actual.moneda = p_moneda then
      return p_id;
    end if;
    raise exception 'Esta orden de servicio ya existe con otros datos. Recarga antes de intentar de nuevo.';
  end if;
  if not v_proveedor.activo then
    raise exception 'El proveedor % está dado de baja. Reactívalo en Proveedores o elige otro.', v_proveedor.razon_social;
  end if;
  if p_orden_id is not null and not exists (
      select 1 from public.ordenes_trabajo where id = p_orden_id and estado::text not in ('ANULADA', 'BORRADOR')) then
    raise exception 'La OT elegida no está vigente. Quítala o elige otra.' using errcode = 'check_violation';
  end if;
  if p_area_id is not null and not exists (select 1 from public.areas where id = p_area_id) then
    raise exception 'El área elegida no existe.' using errcode = 'check_violation';
  end if;

  if p_moneda = 'USD' then
    v_tc := public.tipo_cambio_venta(current_date);
    v_pen := case when v_tc is null then null else round(p_monto * v_tc, 2) end;
  else
    v_pen := p_monto;
  end if;

  v_numero := public.siguiente_correlativo('ORDEN_SERVICIO', '001', null);
  insert into public.ordenes_servicio
    (id, numero, proveedor_id, proveedor, orden_id, area_id, codigo_interno, descripcion, referencia, fecha_inicio, fecha_fin,
     moneda, monto, monto_pen, condicion_pago, dias_credito, detraccion_afecta, detraccion_codigo, detraccion_porcentaje,
     detraccion_minimo, detraccion_motivo, creado_por)
  values
    (p_id, v_numero, p_proveedor_id, v_proveedor.razon_social, p_orden_id, p_area_id, btrim(p_codigo_interno),
     btrim(p_descripcion), nullif(btrim(p_referencia), ''), p_fecha_inicio, p_fecha_fin, p_moneda, p_monto, v_pen,
     p_condicion, p_dias, v_det.afecta, v_det.codigo, v_det.porcentaje, v_det.minimo, v_det.motivo,
     public.usuario_actual());

  select * into v_regla from public.regla_aprobacion_compras where unica;
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, 'Servicio por aprobar: ' || v_numero,
         v_proveedor.razon_social || ' · ' || btrim(p_codigo_interno) || ' · '
           || coalesce('S/ ' || to_char(v_pen, 'FM999G999G990D00'), p_moneda || ' sin tipo de cambio'),
         '/compras/aprobacion', 'ordenes_servicio', p_id
    from public.usuarios u
   where u.activo and u.rol_id = v_regla.rol_aprobador_id and u.id is distinct from public.usuario_actual();
  return p_id;
end;
$$;
comment on function public.emitir_orden_servicio(uuid, uuid, uuid, uuid, text, text, text, date, date, text, numeric, text, integer, text, text) is
  'Logística emite la OS con su código interno y su detracción (código de SUNAT, o NO_SUJETA con motivo). Exige compras.crear.';
revoke all on function public.emitir_orden_servicio(uuid, uuid, uuid, uuid, text, text, text, date, date, text, numeric, text, integer, text, text) from public, anon;
grant execute on function public.emitir_orden_servicio(uuid, uuid, uuid, uuid, text, text, text, date, date, text, numeric, text, integer, text, text) to authenticated;

-- La firma de antes emitía sin código ni detracción: ya no la usa nadie.
revoke all on function public.emitir_orden_servicio(uuid, uuid, uuid, uuid, text, text, date, date, text, numeric, text, integer)
  from public, anon, authenticated;

-- 7. Corregir el código o la detracción ----------------------------------------------------
-- Vacío = no se toca. El código lo corrige Logística mientras la OS no tiene
-- conformidad; la detracción, Logística o Contabilidad mientras no está anulada.
-- Elegir otra vez el mismo tipo no cambia el porcentaje guardado.
create or replace function public.corregir_orden_servicio(
  p_id uuid, p_codigo_interno text, p_detraccion text, p_motivo_detraccion text
) returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_logistica boolean := public.es_admin() or public.tiene_permiso('compras.crear');
  v_contable  boolean := public.tiene_permiso('compras.detraccion');
  v_os        public.ordenes_servicio%rowtype;
  v_det       record;
  v_codigo    text := nullif(btrim(coalesce(p_codigo_interno, '')), '');
begin
  if not (v_logistica or v_contable) then
    raise exception 'Corregir una orden de servicio corresponde a Logística, y su detracción también a Contabilidad.'
      using errcode = 'insufficient_privilege';
  end if;
  select * into v_os from public.ordenes_servicio where id = p_id for update;
  if not found then raise exception 'La orden de servicio no existe.'; end if;
  if v_os.estado = 'ANULADA' or v_os.aprobacion = 'RECHAZADA' then
    raise exception 'La orden de servicio % está %: queda como evidencia.', v_os.numero,
      case when v_os.estado = 'ANULADA' then 'anulada' else 'rechazada' end using errcode = 'check_violation';
  end if;

  if v_codigo is not null and v_codigo is distinct from v_os.codigo_interno then
    if not v_logistica then
      raise exception 'El código interno de la orden de servicio lo corrige Logística.' using errcode = 'insufficient_privilege';
    end if;
    if v_os.estado = 'CONFORME' then
      raise exception 'La orden de servicio % ya tiene conformidad: su código interno no cambia.', v_os.numero
        using errcode = 'check_violation';
    end if;
    if char_length(v_codigo) not between 2 and 60 then
      raise exception 'Escribe el código interno de la unidad (de 2 a 60 caracteres). Si no es para una unidad, escribe PLANTA.'
        using errcode = 'check_violation';
    end if;
    update public.ordenes_servicio set codigo_interno = v_codigo where id = p_id;
  end if;

  if nullif(btrim(coalesce(p_detraccion, '')), '') is not null then
    select * into v_det from public.detraccion_elegida(p_detraccion, p_motivo_detraccion);
    if v_det.afecta is distinct from v_os.detraccion_afecta or v_det.codigo is distinct from v_os.detraccion_codigo
       or v_det.motivo is distinct from v_os.detraccion_motivo then
      update public.ordenes_servicio
         set detraccion_afecta = v_det.afecta, detraccion_codigo = v_det.codigo,
             detraccion_porcentaje = case when v_det.codigo is not distinct from v_os.detraccion_codigo
                                          then v_os.detraccion_porcentaje else v_det.porcentaje end,
             detraccion_minimo = case when v_det.codigo is not distinct from v_os.detraccion_codigo
                                      then v_os.detraccion_minimo else v_det.minimo end,
             detraccion_motivo = v_det.motivo
       where id = p_id;
    end if;
  end if;
  return p_id;
end;
$$;
comment on function public.corregir_orden_servicio(uuid, text, text, text) is
  'Corrige el código interno (Logística, antes de la conformidad) o la detracción (Logística o Contabilidad, hasta que se anula) de una OS.';
revoke all on function public.corregir_orden_servicio(uuid, text, text, text) from public, anon;
grant execute on function public.corregir_orden_servicio(uuid, text, text, text) to authenticated;

-- 8. Quién ve la OS: también Contabilidad -----------------------------------------------------
do $$ begin
  alter policy ver_ordenes_servicio on public.ordenes_servicio using (
    (select public.es_admin())
    or (select public.tiene_permiso('compras.ver'))
    or (select public.tiene_permiso('compras.crear'))
    or (select public.tiene_permiso('compras.detraccion'))
    or (select public.tiene_permiso('tesoreria.ver_documentos'))
    or (select public.tiene_permiso('costos.ver'))
    or (select public.es_aprobador_compras())
  );
end $$;

-- El listado, igual que antes, también para quien solo corrige la detracción.
-- Sus columnas no cambian (cambiarlas exige borrarlo): la pantalla lee el
-- código y la detracción de la tabla.
create or replace function public.ordenes_servicio_listado()
returns table (
  id uuid, numero text, referencia text, proveedor text, proveedor_documento text,
  orden text, unidad text, area text, descripcion text, fecha_inicio date, fecha_fin date,
  moneda text, monto numeric, monto_pen numeric, condicion_pago text, dias_credito integer,
  aprobacion text, motivo_rechazo text, estado text, motivo_anulacion text, observacion_conformidad text,
  creado_en timestamptz, emitida_por text, atrasada boolean
) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('compras.ver') or public.tiene_permiso('compras.crear')
          or public.tiene_permiso('compras.detraccion')
          or public.tiene_permiso('tesoreria.ver_documentos') or public.es_aprobador_compras()) then
    raise exception 'No tienes permiso para ver las órdenes de servicio.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select s.id, s.numero, s.referencia, s.proveedor, p.numero_documento,
         o.numero, case when u.id is null then null else public.nombre_unidad_almacen(u) end, a.nombre,
         s.descripcion, s.fecha_inicio, s.fecha_fin, s.moneda, s.monto, s.monto_pen, s.condicion_pago, s.dias_credito,
         s.aprobacion, s.motivo_rechazo, s.estado, s.motivo_anulacion, s.observacion_conformidad,
         s.creado_en, public.puesto(uc),
         (s.fecha_fin is not null and s.fecha_fin < (now() at time zone 'America/Lima')::date
          and s.estado in ('EMITIDA', 'EN_EJECUCION') and s.aprobacion <> 'RECHAZADA')
    from public.ordenes_servicio s
    left join public.proveedores p on p.id = s.proveedor_id
    left join public.ordenes_trabajo o on o.id = s.orden_id
    left join public.unidades u on u.id = o.unidad_id
    left join public.areas a on a.id = s.area_id
    left join public.usuarios uc on uc.id = s.creado_por
   order by s.creado_en desc
   limit 300;
end;
$$;
revoke all on function public.ordenes_servicio_listado() from public, anon;
grant execute on function public.ordenes_servicio_listado() to authenticated;

-- 9. Gerencia ve las OS en los documentos de cada código ----------------------------------------
--   SERVICIO  las órdenes de servicio con ese código: por aprobar, rechazada, o
--             su estado (emitida, en ejecución, conforme, anulada)
create or replace function public.codigo_interno_documentos(p_codigo text default null)
returns table (codigo text, tipo text, id uuid, numero text, fecha date, estado text, detalle text)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  perform public.exigir_permiso('codigos_internos.ver');
  return query
  with unidad as (
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo, u.*
      from public.unidades u
     where u.codigo_interno is not null
       and (v_codigo is null or public.normalizar_codigo_interno(u.codigo_interno) = v_codigo)
  ), orden as (
    select u.codigo, o.* from public.ordenes_trabajo o join unidad u on u.id = o.unidad_id
  )
  select public.normalizar_codigo_interno(r.codigo_interno), 'REQUERIMIENTO'::text, r.id, r.numero::text,
         (r.creado_en at time zone 'America/Lima')::date, r.estado::text,
         (coalesce(a.nombre, 'Sin área') || ' · ' || (select count(*) from public.requerimiento_lineas l where l.requerimiento_id = r.id)
           || case when (select count(*) from public.requerimiento_lineas l where l.requerimiento_id = r.id) = 1 then ' insumo' else ' insumos' end
           || ' · ' || r.justificacion)::text
    from public.requerimientos r
    left join public.areas a on a.id = r.area_id
   where v_codigo is null or public.normalizar_codigo_interno(r.codigo_interno) = v_codigo
  union all
  select public.normalizar_codigo_interno(v.codigo_interno), 'VEHICULO', v.id,
         coalesce(nullif(btrim(v.placa), ''), nullif(btrim(v.chasis), ''), 'Sin placa')::text,
         (v.ingreso_en at time zone 'America/Lima')::date,
         case when v.salida_en is null then 'EN_PLANTA' else 'SALIO' end,
         (v.unidad || ' · ' || v.empresa)::text
    from public.registro_vehiculos v
   where v.codigo_interno is not null and v.anulado_en is null
     and (v_codigo is null or public.normalizar_codigo_interno(v.codigo_interno) = v_codigo)
  union all
  select u.codigo, 'UNIDAD', u.id,
         coalesce(nullif(btrim(u.placa), ''), nullif(btrim(u.numero_chasis), ''), 'Sin placa')::text,
         (u.creado_en at time zone 'America/Lima')::date,
         case when u.activo then 'ACTIVA' else 'INACTIVA' end,
         nullif(btrim(concat_ws(' ', u.marca, u.modelo)), '')::text
    from unidad u
  union all
  select o.codigo, 'OT', o.id, o.numero::text, o.fecha_registro, o.estado::text, o.descripcion::text
    from orden o
  union all
  select o.codigo, 'COTIZACION', c.id, c.numero::text, (c.creado_en at time zone 'America/Lima')::date, c.estado::text,
         ('De la OT ' || o.numero)::text
    from orden o
    join public.cotizaciones_pdf c on c.id = o.cotizacion_pdf_id
  union all
  select public.normalizar_codigo_interno(s.codigo_interno), 'SERVICIO', s.id, s.numero::text,
         (s.creado_en at time zone 'America/Lima')::date,
         case when s.estado = 'ANULADA' then 'ANULADA'
              when s.aprobacion = 'RECHAZADA' then 'RECHAZADA'
              when s.aprobacion = 'POR_APROBAR' then 'POR_APROBAR'
              else s.estado end,
         (s.proveedor || ' · ' || case when s.moneda = 'USD' then 'US$ ' else 'S/ ' end
           || to_char(s.monto, 'FM999G999G990D00') || ' sin IGV · ' || s.descripcion)::text
    from public.ordenes_servicio s
   where s.codigo_interno is not null
     and (v_codigo is null or public.normalizar_codigo_interno(s.codigo_interno) = v_codigo)
   order by 1, 2, 5 desc;
end;
$$;
comment on function public.codigo_interno_documentos(text) is
  'Dónde más aparece un código interno (o todos): requerimientos, ingresos de vehículos, unidades, la OT y la cotización de esas unidades, y las órdenes de servicio. Exige codigos_internos.ver.';
revoke all on function public.codigo_interno_documentos(text) from public, anon;
grant execute on function public.codigo_interno_documentos(text) to authenticated;
