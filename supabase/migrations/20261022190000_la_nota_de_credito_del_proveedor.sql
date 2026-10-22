-- Contabilidad registra la nota de crédito del proveedor contra su factura, y el costeo del código baja solo.
--
-- Decisiones de DKS del 22/10 (preguntas 9 y 10 de compras pendientes):
--
-- 1. «Almacén anota la devolución, Contabilidad la nota de crédito contra su
--    factura, y el costeo del código baja solo.» La devolución entró en la
--    migración anterior; aquí, la nota.
-- 2. «Si es por menos, se registra la devolución o se descuenta de otra factura
--    del proveedor. Tendría que adjuntar nota de crédito o documento en donde se
--    disminuyó.» La nota baja lo que se debe de su factura; si la factura ya
--    estaba pagada, lo que sobra queda a favor y Tesorería lo descuenta de otra
--    factura del mismo proveedor o registra que el proveedor devolvió el dinero.
--
-- Cómo cuenta:
-- * La nota se aplica a su factura como un abono más de `pagos_adquisicion`
--   (con `nota_credito_id`), sin mover la caja: así todo lo que ya calcula el
--   saldo de una factura (Cuentas por pagar, el descuento de una boleta, la
--   factura en espera) la ve sin cambiar. Lo anota solo el sistema.
-- * Lo que no cabe en el saldo de su factura queda a favor del proveedor. Si
--   el proveedor lo devuelve en dinero, entra a la caja como un ingreso.
-- * La nota por un descuento (sin material devuelto) baja el costo de los
--   códigos de sus OC en la misma proporción en que baja la factura. La nota
--   por lo devuelto no toca el costeo: lo devuelto salió del almacén antes de
--   llegar a ningún código.
-- * La nota ligada a una devolución que esperaba reposición deja de esperarla:
--   que el proveedor emita la nota es que no la repone. Lo que falte vuelve a
--   la lista de Logística como dice la migración anterior.
-- * Ni la nota ni su devolución en dinero se borran: se anulan con motivo.

-- 1. La nota ------------------------------------------------------------------------------------------
create table if not exists public.notas_credito_compra (
  id               uuid primary key default gen_random_uuid(),
  adquisicion_id   uuid not null references public.adquisiciones(id) on delete restrict,
  numero           text not null,
  proveedor        text not null,
  ruc_proveedor    text,
  fecha_emision    date not null,
  moneda           text not null,
  monto            numeric(14, 2) not null,
  tipo             text not null,
  devolucion_id    uuid references public.movimientos_materiales(id) on delete restrict,
  motivo           text not null,
  archivo_ruta     text not null,
  archivo_mime     text not null,
  archivo_tamano   integer not null,
  registrado_por   uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  anulado_por      uuid references public.usuarios(id) on delete restrict,
  anulado_en       timestamptz,
  motivo_anulacion text
);
alter table public.notas_credito_compra drop constraint if exists ck_nota_credito_datos;
alter table public.notas_credito_compra add constraint ck_nota_credito_datos check (
  numero ~ '^[A-Z][A-Z0-9]{3}-[0-9]{1,8}$'
  and char_length(btrim(proveedor)) between 2 and 160
  and (ruc_proveedor is null or public.ruc_es_valido(ruc_proveedor))
  and moneda in ('PEN', 'USD')
  and monto > 0
  and tipo in ('DEVOLUCION', 'DESCUENTO')
  and (tipo = 'DEVOLUCION' or devolucion_id is null)
  and char_length(btrim(motivo)) between 10 and 500
  and archivo_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  and archivo_tamano between 1 and 10485760
);
alter table public.notas_credito_compra drop constraint if exists ck_nota_credito_anulada;
alter table public.notas_credito_compra add constraint ck_nota_credito_anulada check (
  (anulado_en is null) = (anulado_por is null)
  and (anulado_en is null) = (motivo_anulacion is null)
  and (motivo_anulacion is null or char_length(btrim(motivo_anulacion)) between 10 and 500)
);
create unique index if not exists uq_nota_credito_archivo on public.notas_credito_compra (archivo_ruta);
-- La misma nota del mismo proveedor, una sola vez mientras siga vigente.
create unique index if not exists uq_nota_credito_vigente on public.notas_credito_compra
  (coalesce(ruc_proveedor, upper(btrim(proveedor))), numero) where anulado_en is null;
-- Se lee por su factura (la pestaña Facturas) y por su devolución (lo que espera la nota).
create index if not exists ix_nota_credito_factura on public.notas_credito_compra (adquisicion_id);
create index if not exists ix_nota_credito_devolucion on public.notas_credito_compra (devolucion_id)
  where devolucion_id is not null;
-- `registrado_por` y `anulado_por` sin índice: no se filtra por ellos y un usuario no se borra.

-- Lo que el proveedor devolvió en dinero de una nota que quedó a favor.
create table if not exists public.reembolsos_nota_credito (
  id               uuid primary key default gen_random_uuid(),
  nota_credito_id  uuid not null references public.notas_credito_compra(id) on delete restrict,
  fecha            date not null,
  moneda           text not null,
  monto            numeric(14, 2) not null,
  operacion        text,
  archivo_ruta     text not null,
  archivo_mime     text not null,
  archivo_tamano   integer not null,
  registrado_por   uuid not null default public.usuario_actual() references public.usuarios(id) on delete restrict,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  anulado_por      uuid references public.usuarios(id) on delete restrict,
  anulado_en       timestamptz,
  motivo_anulacion text
);
alter table public.reembolsos_nota_credito drop constraint if exists ck_reembolso_nota_datos;
alter table public.reembolsos_nota_credito add constraint ck_reembolso_nota_datos check (
  moneda in ('PEN', 'USD') and monto > 0
  and (operacion is null or char_length(btrim(operacion)) between 1 and 60)
  and archivo_mime in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
  and archivo_tamano between 1 and 10485760
  and (anulado_en is null) = (anulado_por is null)
  and (anulado_en is null) = (motivo_anulacion is null)
  and (motivo_anulacion is null or char_length(btrim(motivo_anulacion)) between 10 and 500)
);
create unique index if not exists uq_reembolso_nota_archivo on public.reembolsos_nota_credito (archivo_ruta);
create index if not exists ix_reembolso_nota on public.reembolsos_nota_credito (nota_credito_id);

-- Las dos se leen como las facturas; se escriben solo por las funciones de abajo.
alter table public.notas_credito_compra enable row level security;
alter table public.reembolsos_nota_credito enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notas_credito_compra'
                   and policyname = 'notas_credito_lectura') then
    create policy notas_credito_lectura on public.notas_credito_compra for select to authenticated
      using ((select public.tiene_permiso('adquisiciones.ver')) or (select public.tiene_permiso('tesoreria.registrar_pagos'))
             or (select public.tiene_permiso('tesoreria.ver_documentos')));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reembolsos_nota_credito'
                   and policyname = 'reembolsos_nota_lectura') then
    create policy reembolsos_nota_lectura on public.reembolsos_nota_credito for select to authenticated
      using ((select public.tiene_permiso('adquisiciones.ver')) or (select public.tiene_permiso('tesoreria.registrar_pagos'))
             or (select public.tiene_permiso('tesoreria.ver_documentos')));
  end if;
end $$;
revoke all on public.notas_credito_compra from public, anon, authenticated;
revoke all on public.reembolsos_nota_credito from public, anon, authenticated;
grant select on public.notas_credito_compra to authenticated;
grant select on public.reembolsos_nota_credito to authenticated;
select public.activar_timestamps('notas_credito_compra');
select public.activar_timestamps('reembolsos_nota_credito');
select public.activar_auditoria('notas_credito_compra');
select public.activar_auditoria('reembolsos_nota_credito');
select public.activar_registro_de_prueba('notas_credito_compra');
select public.activar_registro_de_prueba('reembolsos_nota_credito');

-- Ni se borran ni se corrigen: se anulan con su motivo, y anuladas quedan como evidencia.
create or replace function public.fn_nota_credito_guardia()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_cambian constant text[] := array['anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en'];
  v_que     text := case when tg_table_name = 'notas_credito_compra' then 'La nota de crédito' else 'La devolución' end;
begin
  if tg_op = 'DELETE' then
    raise exception '% no se borra: se anula con su motivo.', v_que using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception '% está anulada: queda como evidencia.', v_que using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Lo que dice % no se corrige: anúlala con su motivo y regístrala de nuevo.', lower(v_que) using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_nota_credito_guardia() from public, anon, authenticated;
drop trigger if exists trg_nota_credito_guardia on public.notas_credito_compra;
create trigger trg_nota_credito_guardia before update or delete on public.notas_credito_compra
  for each row execute function public.fn_nota_credito_guardia();
drop trigger if exists trg_reembolso_nota_guardia on public.reembolsos_nota_credito;
create trigger trg_reembolso_nota_guardia before update or delete on public.reembolsos_nota_credito
  for each row execute function public.fn_nota_credito_guardia();

-- 2. Lo que la nota descuenta de una factura ----------------------------------------------------------
alter table public.pagos_adquisicion add column if not exists nota_credito_id uuid
  references public.notas_credito_compra(id) on delete restrict;
-- Se suma por nota en cada saldo a favor.
create index if not exists ix_pagos_adquisicion_nota_credito on public.pagos_adquisicion (nota_credito_id)
  where nota_credito_id is not null;
alter table public.pagos_adquisicion drop constraint if exists ck_pago_adquisicion_nota_credito;
alter table public.pagos_adquisicion add constraint ck_pago_adquisicion_nota_credito check (
  nota_credito_id is null or (pago_orden_compra_id is null and archivo_ruta is null)
);

-- 3. La caja recibe lo que el proveedor devuelve de una nota ------------------------------------------
alter table public.movimientos_caja drop constraint if exists ck_movimiento_caja_origen;
alter table public.movimientos_caja add constraint ck_movimiento_caja_origen check (
  origen in ('MANUAL', 'TRANSFERENCIA', 'PAGO_ADQUISICION', 'PAGO_ORDEN_SERVICIO', 'PAGO_ORDEN_COMPRA',
             'PAGO_RECIBO_HONORARIOS', 'PAGO_PLANILLA_DIARIA', 'COBRO_FACTURA_VENTA', 'DEVOLUCION_ORDEN_COMPRA',
             'REEMBOLSO_NOTA_CREDITO')
  and ((origen = 'MANUAL') = (origen_id is null))
);

-- 4. El archivo de la nota y el de lo devuelto --------------------------------------------------------
-- La nota va en `<factura>/<id>.pdf`; la constancia de lo devuelto, en `<nota>/<id>.pdf`.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('notas-credito', 'notas-credito', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'notas_credito_subir') then
    create policy notas_credito_subir on storage.objects for insert to authenticated with check (
      bucket_id = 'notas-credito'
      and owner_id = (select auth.uid())::text
      and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|jpg|png|webp)$'
      and (((select public.tiene_permiso('adquisiciones.registrar'))
            and exists (select 1 from public.adquisiciones a
                         where a.id::text = split_part(name, '/', 1) and a.estado = 'REGISTRADA'))
           or ((select public.tiene_permiso('tesoreria.registrar_pagos'))
               and exists (select 1 from public.notas_credito_compra n
                            where n.id::text = split_part(name, '/', 1) and n.anulado_en is null))));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'notas_credito_ver') then
    create policy notas_credito_ver on storage.objects for select to authenticated using (
      bucket_id = 'notas-credito'
      and (owner_id = (select auth.uid())::text
           or (((select public.tiene_permiso('adquisiciones.ver')) or (select public.tiene_permiso('tesoreria.registrar_pagos'))
                or (select public.tiene_permiso('tesoreria.ver_documentos')))
               and (exists (select 1 from public.notas_credito_compra n where n.archivo_ruta = name)
                    or exists (select 1 from public.reembolsos_nota_credito r where r.archivo_ruta = name)))));
  end if;
  -- Lo que subió y no llegó a anotarse lo quita quien lo subió (ver `subirArchivoPrivado`).
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'notas_credito_quitar_suelto') then
    create policy notas_credito_quitar_suelto on storage.objects for delete to authenticated using (
      bucket_id = 'notas-credito'
      and owner_id = (select auth.uid())::text
      and not exists (select 1 from public.notas_credito_compra n where n.archivo_ruta = name)
      and not exists (select 1 from public.reembolsos_nota_credito r where r.archivo_ruta = name));
  end if;
end $$;

-- 5. Lo que ya cuenta el saldo de una factura deja pasar la nota --------------------------------------
-- Copias de su última versión (las tres primeras y las de la caja, de la
-- 20261020210000; la de la espera, de la 20261022175000; `codigo_interno_lineas`,
-- de la 20261020120000). Cambia solo lo que nombra la nota: su abono lo anota el
-- sistema, no espera ni choca con el pago de la boleta, y no se anula como un pago;
-- la caja reconoce el nuevo origen; y el costeo suma el descuento de la nota.
CREATE OR REPLACE FUNCTION public.fn_validar_pago_adquisicion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_total numeric; v_estado text; v_pagado numeric;
begin
  if new.nota_credito_id is not null then
    if current_setting('metalwork.aplica_nota_credito', true) is distinct from new.nota_credito_id::text then
      raise exception 'Lo que descuenta una nota de crédito lo anota el sistema solo.' using errcode = 'insufficient_privilege';
    end if;
  elsif new.pago_orden_compra_id is null then
    perform public.exigir_permiso('tesoreria.registrar_pagos');
  elsif current_setting('metalwork.aplica_pago_directo', true) is distinct from new.pago_orden_compra_id::text then
    raise exception 'El pago de la boleta que toma la factura lo anota el sistema solo.' using errcode = 'insufficient_privilege';
  end if;
  select total, estado into v_total, v_estado from public.adquisiciones where id = new.adquisicion_id for update;
  if v_estado <> 'REGISTRADA' then raise exception 'El comprobante debe estar registrado antes del pago.'; end if;
  select coalesce(sum(monto), 0) into v_pagado from public.pagos_adquisicion
   where adquisicion_id = new.adquisicion_id and anulado_en is null;
  if v_pagado + new.monto > v_total then raise exception 'El pago supera el saldo del comprobante.'; end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_factura_sin_pago_directo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_adq    public.adquisiciones%rowtype;
  v_oc     record;
begin
  if tg_table_name <> 'pagos_adquisicion' or new.anulado_en is not null or new.pago_orden_compra_id is not null
     or new.nota_credito_id is not null then
    return new;
  end if;
  select * into v_adq from public.adquisiciones where id = new.adquisicion_id;
  select coalesce(c.numero, 'OC ' || c.referencia) as nombre, c.moneda, pd.sin_tomar into v_oc
    from public.ordenes_compra_materiales c
    cross join lateral public.pago_directo_de_la_compra(c.id) pd
   where c.id = any(public.compras_de_la_factura(v_adq)) and not c.con_factura and c.moneda <> v_adq.moneda
     and exists (select 1 from public.facturas_de_la_compra(c.id) f where f.adquisicion_id = v_adq.id)
     and pd.sin_tomar >= 1
   order by c.numero
   limit 1;
  if found then
    raise exception 'Tesorería ya pagó la % por su boleta en otra moneda que esta factura, y quedan % de ese pago sin pasar a ella: el sistema no convierte. Primero, en «OC con boleta», «La factura lo toma al cambio» (o «Registrar devolución», si el proveedor lo devolvió); después se paga aquí lo que falte.',
      v_oc.nombre, case when v_oc.moneda = 'USD' then 'US$ ' else 'S/ ' end || to_char(v_oc.sin_tomar, 'FM999G999G990D00')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_pago_factura_en_espera()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_adq public.adquisiciones%rowtype;
  v_oc  record;
begin
  if new.anulado_en is not null or new.nota_credito_id is not null then return new; end if;
  select * into v_adq from public.adquisiciones where id = new.adquisicion_id;
  if not found then return new; end if;
  -- Lo que toma del pago de una de sus propias OC pasa (es el «ya se pagó» de una
  -- factura de dos OC); un descuento de lo pagado de más en otra OC, no.
  if new.pago_orden_compra_id is not null
     and exists (select 1 from public.pagos_orden_compra p
                  cross join lateral public.facturas_de_la_compra(p.orden_compra_id) f
                  where p.id = new.pago_orden_compra_id and f.adquisicion_id = v_adq.id) then
    return new;
  end if;
  select * into v_oc from public.compra_pagada_fuera_de_la_factura(v_adq);
  if found then
    raise exception 'La factura % es de la %, que va con boleta y se dio por pagada fuera del sistema: espera que Contabilidad diga en Adquisiciones si ya se pagó o si falta pagarla.',
      v_adq.numero_documento, v_oc.compra using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_pago_adquisicion_guardia()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_cambian constant text[] := array['anulado_por', 'anulado_en', 'motivo_anulacion', 'actualizado_en'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Un pago no se borra: se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if old.anulado_en is not null then
    raise exception 'Ese pago está anulado: queda como evidencia.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - v_cambian) is distinct from (to_jsonb(old) - v_cambian) then
    raise exception 'Lo que dice el pago no se corrige: anúlalo con su motivo y regístralo de nuevo.' using errcode = 'check_violation';
  end if;
  if old.pago_orden_compra_id is not null
     and current_setting('metalwork.aplica_pago_directo', true) is distinct from old.pago_orden_compra_id::text then
    raise exception 'Ese pago es el que se hizo por la boleta de la OC, y la factura lo tomó: no se anula aquí. Si se tomó a mano, se deshace con «Deshacer» en la factura; si el pago no salió, se anula en «OC con boleta»; si el proveedor lo devolvió, ahí se registra la devolución.'
      using errcode = 'check_violation';
  end if;
  if old.nota_credito_id is not null
     and current_setting('metalwork.aplica_nota_credito', true) is distinct from old.nota_credito_id::text then
    raise exception 'Ese descuento es de una nota de crédito: se quita anulando la nota en Adquisiciones o, si Tesorería la descontó de esta factura, con «Quitar» en las notas de crédito de Cuentas por pagar.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.caja_mover_por_pago(p_origen text, p_origen_id uuid, p_tipo text, p_caja uuid, p_fecha date, p_monto numeric, p_moneda text, p_monto_cuenta numeric, p_descripcion text, p_codigo text, p_operacion text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_caja    public.cajas%rowtype;
  v_monto   numeric;
  v_cambio  numeric;
  v_id      uuid;
  v_cobro   boolean := p_tipo = 'INGRESO';
  v_cosa    text := case p_origen when 'COBRO_FACTURA_VENTA' then 'el cobro'
                                  when 'DEVOLUCION_ORDEN_COMPRA' then 'la devolución'
                                  when 'REEMBOLSO_NOTA_CREDITO' then 'la devolución' else 'el pago' end;
  v_cierre  date;
begin
  -- Quien paga desde una cuenta tiene que poder verla: hoy los dos permisos
  -- son de Tesorería, y si mañana otro puesto paga, no mueve a ciegas la caja.
  perform public.exigir_permiso('tesoreria.caja');
  if p_caja is null then
    raise exception '%', case when v_cobro then 'Elige la cuenta a la que entró ' || v_cosa || '.'
                              else 'Elige la cuenta de la que salió ' || v_cosa || '.' end
      using errcode = 'check_violation';
  end if;
  select * into v_caja from public.cajas where id = p_caja for update;
  if not found then
    raise exception 'Esa cuenta no existe: vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if not v_caja.activa then
    raise exception 'La cuenta % está desactivada: elige otra.', v_caja.nombre using errcode = 'check_violation';
  end if;

  -- Antes del saldo inicial: ese dinero ya está en el saldo con que empezó la cuenta.
  if p_fecha < v_caja.fecha_inicio then return null; end if;

  -- Un día cerrado ya cuadró con el banco: el pago va con un día posterior.
  select max(fecha) into v_cierre from public.cierres_caja where caja_id = p_caja and anulado_en is null;
  if v_cierre is not null and p_fecha <= v_cierre then
    raise exception 'La cuenta % está cerrada hasta el %: registra % con un día posterior, o reabre ese cierre en Caja diaria.',
      v_caja.nombre, public.caja_texto_fecha(v_cierre), v_cosa
      using errcode = 'check_violation';
  end if;

  -- El día tiene que estar abierto (y no ser futuro).
  v_caja := public.caja_dia_abierto(p_caja, p_fecha);

  if v_caja.moneda = p_moneda then
    v_monto := p_monto;
  else
    if p_monto_cuenta is null or p_monto_cuenta <= 0 or p_monto_cuenta > 999999999
       or p_monto_cuenta <> round(p_monto_cuenta, 2) then
      raise exception 'La cuenta % es en %: escribe cuánto % en %, como dice el estado de cuenta.',
        v_caja.nombre, case when v_caja.moneda = 'USD' then 'dólares' else 'soles' end,
        case when v_cobro then 'entró' else 'salió' end,
        case when v_caja.moneda = 'USD' then 'dólares' else 'soles' end using errcode = 'check_violation';
    end if;
    v_monto := p_monto_cuenta;
    v_cambio := round(case when v_caja.moneda = 'PEN' then p_monto_cuenta / p_monto else p_monto / p_monto_cuenta end, 4);
    -- Un dólar fuera de S/ 2 a S/ 6 es un monto mal escrito, no un cambio.
    if v_cambio not between 2 and 6 then
      raise exception 'Con esos montos el dólar sale a S/ %: revisa cuánto % la cuenta.', round(v_cambio, 3),
        case when v_cobro then 'entró a' else 'salió de' end using errcode = 'check_violation';
    end if;
  end if;

  insert into public.movimientos_caja (caja_id, fecha, tipo, monto, descripcion, codigo_interno, operacion,
                                       tipo_cambio, origen, origen_id)
  values (p_caja, p_fecha, p_tipo, v_monto,
          left(regexp_replace(btrim(p_descripcion), '\s+', ' ', 'g'), 300),
          left(public.normalizar_codigo_interno(p_codigo), 60),
          nullif(left(btrim(coalesce(p_operacion, '')), 60), ''),
          v_cambio, p_origen, p_origen_id)
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.caja_anular_por_pago(p_origen text, p_origen_id uuid, p_motivo text, p_que text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_mov     public.movimientos_caja%rowtype;
  v_caja    public.cajas%rowtype;
  v_cierre  date;
  v_hoy     date := (now() at time zone 'America/Lima')::date;
  v_este    text := case when p_que = 'devolución' then 'Esta devolución' else 'Este ' || p_que end;
  v_del     text := case when p_que = 'devolución' then 'de la devolución' else 'del ' || p_que end;
begin
  for v_mov in
    select m.* from public.movimientos_caja m
     where m.origen = p_origen and m.origen_id = p_origen_id and m.anulado_en is null
       and m.tipo = case when p_origen in ('COBRO_FACTURA_VENTA', 'DEVOLUCION_ORDEN_COMPRA', 'REEMBOLSO_NOTA_CREDITO') then 'INGRESO' else 'EGRESO' end
     order by m.caja_id
  loop
    -- El mismo permiso que pide moverla: quien no lleva la caja no la toca, ni al anular.
    perform public.exigir_permiso('tesoreria.caja');
    select * into v_caja from public.cajas where id = v_mov.caja_id for update;
    if not v_caja.activa then
      raise exception '% está en la cuenta %, que está desactivada: actívala para anularlo.', v_este, v_caja.nombre
        using errcode = 'check_violation';
    end if;
    select max(fecha) into v_cierre from public.cierres_caja where caja_id = v_mov.caja_id and anulado_en is null;
    if v_cierre is null or v_mov.fecha > v_cierre then
      update public.movimientos_caja
         set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = btrim(p_motivo)
       where id = v_mov.id;
    else
      -- Su día ya cuadró con el banco y no se toca: el extorno entra hoy.
      if v_hoy <= v_cierre then
        raise exception '% está en la cuenta % el %, y la cuenta ya está cerrada hasta hoy: reabre el cierre de hoy para anularlo.',
          v_este, v_caja.nombre, public.caja_texto_fecha(v_mov.fecha) using errcode = 'check_violation';
      end if;
      insert into public.movimientos_caja (caja_id, fecha, tipo, monto, descripcion, codigo_interno, operacion,
                                           tipo_cambio, origen, origen_id)
      values (v_mov.caja_id, v_hoy, case when v_mov.tipo = 'EGRESO' then 'INGRESO' else 'EGRESO' end, v_mov.monto,
              left('Anulación ' || v_del || ' del ' || public.caja_texto_fecha(v_mov.fecha) || ': ' || v_mov.descripcion, 300),
              v_mov.codigo_interno, null, v_mov.tipo_cambio, v_mov.origen, v_mov.origen_id);
    end if;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_caja_sin_contar_dos_veces()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_otro record;
begin
  if new.operacion is null or new.origen = 'TRANSFERENCIA' then return new; end if;
  select m.fecha, m.origen into v_otro
    from public.movimientos_caja m
   where m.caja_id = new.caja_id and m.tipo = new.tipo and m.monto = new.monto and m.anulado_en is null
     and m.origen <> 'TRANSFERENCIA' and (m.origen = 'MANUAL') <> (new.origen = 'MANUAL')
     and lower(btrim(m.operacion)) = lower(btrim(new.operacion))
   limit 1;
  if not found then return new; end if;
  if new.origen = 'MANUAL' then
    raise exception 'Ese % ya está en la caja: lo dejó el % con la operación % el %. Los pagos y cobros del sistema entran solos.',
      lower(new.tipo),
      case v_otro.origen when 'PAGO_ADQUISICION' then 'pago de una factura de compra'
                         when 'PAGO_ORDEN_SERVICIO' then 'pago de una orden de servicio'
                         when 'PAGO_ORDEN_COMPRA' then 'pago de una OC con boleta'
                         when 'PAGO_RECIBO_HONORARIOS' then 'pago de un recibo por honorarios'
                         when 'PAGO_PLANILLA_DIARIA' then 'pago de la planilla diaria'
                         when 'DEVOLUCION_ORDEN_COMPRA' then 'devolución del proveedor de una OC con boleta'
                         when 'REEMBOLSO_NOTA_CREDITO' then 'devolución del proveedor por una nota de crédito'
                         else 'cobro de una factura de venta' end,
      btrim(new.operacion), public.caja_texto_fecha(v_otro.fecha) using errcode = 'check_violation';
  end if;
  if new.origen in ('DEVOLUCION_ORDEN_COMPRA', 'REEMBOLSO_NOTA_CREDITO') then
    raise exception 'En esa cuenta ya está anotado a mano un ingreso del mismo monto con la operación % el %: es esta misma devolución. Anúlalo en Caja diaria y vuelve a registrarla aquí, que la caja la toma sola.',
      btrim(new.operacion), public.caja_texto_fecha(v_otro.fecha) using errcode = 'check_violation';
  end if;
  raise exception 'En esa cuenta ya está anotado a mano un % del mismo monto con la operación % el %: es este mismo %. Anúlalo en Caja diaria y vuelve a registrarlo aquí, que la caja lo toma sola.',
    lower(new.tipo), btrim(new.operacion), public.caja_texto_fecha(v_otro.fecha),
    case when new.origen = 'COBRO_FACTURA_VENTA' then 'cobro' else 'pago' end using errcode = 'check_violation';
end;
$function$;

CREATE OR REPLACE FUNCTION public.codigo_interno_lineas(p_codigo text, p_mano_obra boolean)
 RETURNS TABLE(codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text, horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer, documento text, referencia_id uuid)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
declare
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
  -- El mes en curso todavía reparte con las horas que van: su parte es provisional.
  v_mes date := date_trunc('month', now() at time zone 'America/Lima')::date;
begin
  return query
  with tareo as (
    select public.normalizar_codigo_interno(t.codigo_interno) as codigo, t.fecha, t.horas, t.costo, t.trabajador_id,
           l.reporte_id, l.trabajo_id, case when l.id is null then t.labor end as labor
      from public.tareos t
      left join public.reporte_diario_personal l on l.id = t.reporte_linea_id
     where p_mano_obra and t.anulado_en is null
  ), espera as (
    -- Una línea de un reporte vigente que no tiene tareo: su persona no tiene costo mensual.
    select public.normalizar_codigo_interno(r.codigo_interno) as codigo, l.fecha, l.horas, l.trabajador_id,
           l.reporte_id, l.trabajo_id, null::text as labor
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where p_mano_obra and r.anulado_en is null
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
  ), horas as (
    select 'MANO_OBRA'::text as fuente, x.codigo, x.fecha, x.horas, x.costo, x.trabajador_id, x.reporte_id, x.trabajo_id, x.labor from tareo x
    union all
    select 'MANO_OBRA_SIN_COSTO', e.codigo, e.fecha, e.horas, null::numeric, e.trabajador_id, e.reporte_id, e.trabajo_id, e.labor from espera e
  ), salida_base as (
    select m.id, m.registrado_en, m.material_id, m.precio_unitario, m.moneda, m.documento_referencia, rq.numero as rq_numero,
           public.normalizar_codigo_interno(coalesce(m.codigo_interno, rq.codigo_interno, u.codigo_interno, uo.codigo_interno,
                                                     case when m.unidad_id is null then m.codigo_unidad end)) as codigo,
           greatest(m.cantidad - coalesce((select sum(x.cantidad) from public.movimientos_materiales x
                                            where x.devolucion_de = m.id), 0), 0)::numeric as cantidad,
           date_trunc('month', m.registrado_en at time zone 'America/Lima')::date as periodo
      from public.movimientos_materiales m
      left join public.requerimiento_lineas rl on rl.id = m.requerimiento_linea_id
      left join public.requerimientos rq on rq.id = rl.requerimiento_id
      left join public.unidades u on u.id = m.unidad_id
      left join public.ordenes_trabajo ot on ot.id = m.orden_id
      left join public.unidades uo on uo.id = ot.unidad_id
     where m.tipo in ('SALIDA', 'DESPACHO')
  ), trabajo as (
    -- Los códigos que trabajaron cada mes: con horas del reporte diario o de
    -- RR. HH., o con una salida del almacén. Es lo que se llama «activo» al
    -- repartir los gastos del mes y lo cargado a TODOS LOS ACTIVOS. Solo dice
    -- qué códigos y qué meses, sin horas ni costos: por eso se arma también
    -- cuando no se pide la mano de obra (el gasto por código de Requerimientos
    -- reparte igual que Gerencia).
    select distinct date_trunc('month', t.fecha)::date as periodo, public.normalizar_codigo_interno(t.codigo_interno) as codigo
      from public.tareos t
     where t.anulado_en is null
    union
    select distinct date_trunc('month', l.fecha)::date, public.normalizar_codigo_interno(r.codigo_interno)
      from public.reporte_diario_personal l
      join public.reportes_diarios r on r.id = l.reporte_id
     where r.anulado_en is null
       and not exists (select 1 from public.tareos t where t.reporte_linea_id = l.id)
    union
    select distinct s.periodo, s.codigo
      from salida_base s
     where s.cantidad > 0
  ), activo as (
    -- Entre quiénes se reparte lo cargado a todos: las unidades. PLANTA y OFICINA
    -- no lo son.
    select t.periodo, t.codigo, count(*) over (partition by t.periodo) as n
      from trabajo t
     where t.codigo is not null and t.codigo not in ('PLANTA', 'OFICINA', 'TODOS LOS ACTIVOS')
  ), movido as (
    -- Entre quiénes se reparten los gastos del mes: los mismos de la
    -- 20261017300000, todos menos PLANTA. TODOS LOS ACTIVOS no recibe: lo suyo ya
    -- está repartido.
    select t.periodo, t.codigo
      from trabajo t
     where t.codigo is not null and t.codigo not in ('PLANTA', 'TODOS LOS ACTIVOS')
  ), salida as (
    select s.id, s.registrado_en, s.material_id, s.precio_unitario, s.moneda, s.documento_referencia, s.rq_numero,
           s.codigo, s.cantidad, null::bigint as entre, false as a_todos
      from salida_base s
     where s.codigo is distinct from 'TODOS LOS ACTIVOS'
    union all
    -- Lo cargado a todos: una parte igual para cada código que trabajó el mes de
    -- la salida. Sin ninguno, la salida entera queda en TODOS LOS ACTIVOS.
    select s.id, s.registrado_en, s.material_id, s.precio_unitario, s.moneda, s.documento_referencia, s.rq_numero,
           coalesce(a.codigo, s.codigo), case when a.n is null then s.cantidad else s.cantidad / a.n end, a.n, true
      from salida_base s
      left join activo a on a.periodo = s.periodo
     where s.codigo = 'TODOS LOS ACTIVOS'
  ), valorizada as (
    -- El mismo orden que el costeo de la OT: precio congelado, último ingreso con
    -- precio hasta ese día, y el precio que fijó Logística (el vigente ese día, o
    -- el primero después).
    select s.*,
           coalesce(s.precio_unitario, ing.precio_unitario, val.precio)::numeric as precio,
           case when s.precio_unitario is not null then coalesce(s.moneda, ing.moneda, val.moneda)
                when ing.precio_unitario is not null then ing.moneda
                else val.moneda end as moneda_val
      from salida s
      left join lateral (
        select i.precio_unitario, i.moneda from public.movimientos_materiales i
         where i.material_id = s.material_id and i.tipo = 'INGRESO' and i.precio_unitario is not null
           and i.moneda in ('PEN', 'USD') and i.registrado_en <= s.registrado_en
         order by i.registrado_en desc, i.id
         limit 1) ing on true
      left join lateral (
        select v.precio, v.moneda from public.valorizaciones_material v
         where v.material_id = s.material_id
         order by (v.vigente_desde > s.registrado_en),
                  case when v.vigente_desde <= s.registrado_en then v.vigente_desde end desc nulls last,
                  v.vigente_desde, v.id
         limit 1) val on true
     where s.codigo is not null and s.cantidad > 0
       and (v_codigo is null or s.codigo = v_codigo)
  ), porcion as (
    -- Lo que faltaba de los insumos que cubre cada línea de OC, por el código de su RQ.
    select rl.orden_compra_detalle_id as detalle_id, public.normalizar_codigo_interno(rq.codigo_interno) as codigo,
           sum(greatest(rl.cantidad - coalesce(rl.cantidad_en_stock, 0), 0))::numeric as falta
      from public.requerimiento_lineas rl
      join public.requerimientos rq on rq.id = rl.requerimiento_id
     where rl.orden_compra_detalle_id is not null
     group by 1, 2
  ), reparto as (
    -- La parte de la línea que va a cada código; si nada faltaba, a partes iguales.
    select p.detalle_id, p.codigo,
           coalesce(p.falta / nullif(sum(p.falta) over (partition by p.detalle_id), 0),
                    1.0 / count(*) over (partition by p.detalle_id))::numeric as parte
      from porcion p
  ), compra_linea as (
    -- La línea sin insumos (la directa, o la OC de antes) va entera al código de la OC.
    select c.id, coalesce(r.codigo, public.normalizar_codigo_interno(c.codigo_interno)) as codigo,
           d.id as detalle_id, d.precio_unitario,
           d.cantidad * d.precio_unitario * coalesce(r.parte, 1) as importe
      from public.ordenes_compra_materiales c
      left join public.orden_compra_material_detalles d on d.orden_compra_id = c.id
      left join reparto r on r.detalle_id = d.id
     where c.aprobacion not in ('RECHAZADA', 'ANULADA')
  ), compra as (
    select l.codigo, c.id, coalesce(c.numero, c.referencia) as numero,
           (c.creado_en at time zone 'America/Lima')::date as fecha, c.proveedor, c.moneda,
           coalesce(sum(l.importe) filter (where l.precio_unitario is not null), 0)::numeric as monto,
           count(l.detalle_id) filter (where l.precio_unitario is null)::integer as sin_precio,
           count(l.detalle_id)::numeric as lineas
      from compra_linea l
      join public.ordenes_compra_materiales c on c.id = l.id
     where l.codigo is not null
     group by l.codigo, c.id
  ), por_horas as (
    -- Las horas de cada unidad en cada mes: la base del reparto POR HORAS y del
    -- sueldo de la oficina.
    select h.periodo, h.codigo, h.horas, h.total, h.codigos
      from public.horas_por_codigo_del_mes(null) h
     where p_mano_obra
  ), gasto_mes as (
    -- POR HORAS, cada unidad lleva la parte del gasto de sus horas en el mes. Los
    -- registrados antes con TASA llevan esa tasa; en partes iguales, su parte.
    -- La línea lleva el día en que se registró el gasto, no el 1 del mes: el
    -- gasto en dólares toma el cambio de Tesorería de ese día, y cambio_del_dia
    -- solo mira diez días atrás (con el día 1 quedaba sin cambio y trababa el cierre).
    select m.codigo, g.id, g.periodo, (g.creado_en at time zone 'America/Lima')::date as registrado,
           g.descripcion, g.monto, g.moneda, g.reparto, g.tasa, c.nombre,
           count(*) over (partition by g.id) as n, null::numeric as horas, null::numeric as total, null::numeric as parte
      from public.gastos_generales_mes g
      join public.conceptos_gasto_general c on c.codigo = g.concepto
      join movido m on m.periodo = g.periodo
     where p_mano_obra and g.estado = 'ACTIVO' and g.reparto <> 'HORAS'
    union all
    select h.codigo, g.id, g.periodo, (g.creado_en at time zone 'America/Lima')::date,
           g.descripcion, g.monto, g.moneda, g.reparto, g.tasa, c.nombre,
           h.codigos::bigint, h.horas, h.total,
           -- Cada parte al céntimo, y lo que el redondeo deja suelto a la unidad con
           -- más horas: el gasto entero queda repartido, ni un céntimo de más o de menos.
           round(g.monto * h.horas / h.total, 2)
           + case when row_number() over (partition by g.id order by h.horas desc, h.codigo) = 1
                  then g.monto - sum(round(g.monto * h.horas / h.total, 2)) over (partition by g.id) else 0 end as parte
      from public.gastos_generales_mes g
      join public.conceptos_gasto_general c on c.codigo = g.concepto
      join por_horas h on h.periodo = g.periodo
     where p_mano_obra and g.estado = 'ACTIVO' and g.reparto = 'HORAS'
  ), oficina as (
    -- El sueldo de la oficina de cada mes, que se reparte igual que un gasto POR
    -- HORAS, con el residuo del redondeo a la unidad con más horas.
    select o.periodo, o.monto, h.codigo, h.horas, h.total, h.codigos,
           round(o.monto * h.horas / h.total, 2)
           + case when row_number() over (partition by o.periodo order by h.horas desc, h.codigo) = 1
                  then o.monto - sum(round(o.monto * h.horas / h.total, 2)) over (partition by o.periodo) else 0 end as parte
      from public.sueldos_oficina_del_mes(null) o
      join por_horas h on h.periodo = o.periodo
     where p_mano_obra and o.monto > 0
  ), merma as (
    -- La merma que Diseño evaluó en la OT de la unidad va sobre los materiales
    -- con precio del código. Si el código tiene varias OT con merma (una
    -- garantía), manda la última evaluada: sumarlas cobraría dos veces el mismo acero.
    select distinct on (public.normalizar_codigo_interno(u.codigo_interno))
           public.normalizar_codigo_interno(u.codigo_interno) as codigo, mm.id, mm.porcentaje, mm.motivo,
           (mm.registrado_en at time zone 'America/Lima')::date as fecha, o.numero
      from public.ot_mermas mm
      join public.ordenes_trabajo o on o.id = mm.orden_id
      join public.unidades u on u.id = o.unidad_id
     where p_mano_obra and mm.porcentaje > 0 and o.estado::text <> 'ANULADA'
       and public.normalizar_codigo_interno(u.codigo_interno) is not null
     order by public.normalizar_codigo_interno(u.codigo_interno), mm.registrado_en desc, mm.id
  )
  select h.codigo, h.fuente, h.fecha,
         coalesce(tr.descripcion, case when h.reporte_id is not null then 'Personal general del reporte' end,
                  h.labor, 'Horas cargadas por Recursos Humanos')::text,
         coalesce(rd.asunto, 'Cargadas por Recursos Humanos')::text,
         count(distinct h.trabajador_id)::numeric,
         case when count(distinct h.trabajador_id) = 1 then 'persona' else 'personas' end::text,
         sum(h.horas)::numeric, null::numeric, 'PEN'::text,
         case when h.fuente = 'MANO_OBRA' then round(sum(h.costo), 2) end,
         0, null::text, h.reporte_id
    from horas h
    left join public.reporte_diario_trabajos tr on tr.id = h.trabajo_id
    left join public.reportes_diarios rd on rd.id = h.reporte_id
   where h.codigo is not null and (v_codigo is null or h.codigo = v_codigo)
   group by h.codigo, h.fuente, h.fecha, h.reporte_id, h.trabajo_id, h.labor, tr.descripcion, rd.asunto
  union all
  select v.codigo, case when v.precio is null then 'MATERIALES_SIN_PRECIO' else 'MATERIALES' end,
         (v.registrado_en at time zone 'America/Lima')::date, mat.descripcion::text,
         (case when not v.a_todos then v.documento_referencia
               when v.entre is null then concat_ws(' · ', 'Cargado a todos los activos: ningún código trabajó ese mes todavía, se reparte cuando alguno trabaje', v.documento_referencia)
               when v.entre = 1 then concat_ws(' · ', 'Cargado a todos los activos: todo a este código, el único que trabajó ese mes', v.documento_referencia)
               else concat_ws(' · ', 'Cargado a todos los activos: partes iguales entre los ' || v.entre || ' códigos que trabajaron ese mes', v.documento_referencia)
          end)::text,
         v.cantidad, um.codigo::text, null::numeric, v.precio, v.moneda_val::text,
         case when v.precio is null then null else round(v.cantidad * v.precio, 2) end,
         case when v.precio is null then 1 else 0 end, v.rq_numero::text, v.id
    from valorizada v
    join public.materiales mat on mat.id = v.material_id
    left join public.unidades_medida um on um.id = mat.unidad_medida_id
  union all
  select c.codigo, 'COMPRAS', c.fecha, c.proveedor::text, null::text, c.lineas,
         case when c.lineas = 1 then 'línea' else 'líneas' end::text, null::numeric, null::numeric, c.moneda::text,
         round(c.monto, 2), c.sin_precio, c.numero::text, c.id
    from compra c
   where c.codigo is not null and (v_codigo is null or c.codigo = v_codigo)
  union all
  select g.codigo, 'GASTOS_DEL_MES', g.registrado, (g.nombre || ' ' || to_char(g.periodo, 'MM/YYYY'))::text,
         (case when g.reparto = 'TASA' then trim(trailing '.' from to_char(g.tasa, 'FM990.999')) || ' % de ' || g.descripcion
               when g.reparto = 'HORAS' and g.periodo >= v_mes and g.n = 1 then 'Por ahora todo a este código, la única unidad con horas este mes (el mes no termina) · ' || g.descripcion
               when g.reparto = 'HORAS' and g.n = 1 then 'Todo a este código, la única unidad con horas ese mes · ' || g.descripcion
               when g.reparto = 'HORAS' then case when g.periodo >= v_mes then 'Por ahora, por horas: ' else 'Por horas: ' end || trim(trailing '.' from to_char(g.horas, 'FM999,999,990.99')) || ' de ' || trim(trailing '.' from to_char(g.total, 'FM999,999,990.99'))
                                             || ' h del mes, entre ' || g.n || ' unidades · ' || g.descripcion
               when g.n = 1 then 'Todo a este código, el único que trabajó ese mes · ' || g.descripcion
               else 'Partes iguales entre los ' || g.n || ' códigos que trabajaron ese mes · ' || g.descripcion end)::text,
         1::numeric, null::text, null::numeric, g.monto, g.moneda::text,
         case when g.reparto = 'TASA' then round(g.monto * g.tasa / 100, 2)
              when g.reparto = 'HORAS' then g.parte
              else round(g.monto / g.n, 2) end,
         0, null::text, g.id
    from gasto_mes g
   where v_codigo is null or g.codigo = v_codigo
  union all
  select o.codigo, 'GASTOS_DEL_MES', o.periodo, ('Sueldos de la oficina ' || to_char(o.periodo, 'MM/YYYY'))::text,
         (case when o.codigos = 1 and o.periodo >= v_mes then 'Por ahora todo a este código, la única unidad con horas este mes (el mes no termina)'
               when o.codigos = 1 then 'Todo a este código, la única unidad con horas ese mes'
               else case when o.periodo >= v_mes then 'Por ahora, por horas: ' else 'Por horas: ' end || trim(trailing '.' from to_char(o.horas, 'FM999,999,990.99')) || ' de ' || trim(trailing '.' from to_char(o.total, 'FM999,999,990.99'))
                    || ' h del mes, entre ' || o.codigos || ' unidades' end
          || ' · pagos de la oficina registrados por RR. HH.')::text,
         1::numeric, null::text, null::numeric, o.monto, 'PEN'::text,
         o.parte,
         0, null::text, null::uuid
    from oficina o
   where v_codigo is null or o.codigo = v_codigo
  union all
  select v.codigo, 'MERMA', mm.fecha,
         ('Merma de material ' || trim(trailing '.' from to_char(mm.porcentaje, 'FM990.99')) || ' %')::text,
         ('Evaluada por Diseño en la OT ' || mm.numero || ' · ' || mm.motivo)::text,
         1::numeric, null::text, null::numeric, null::numeric, v.moneda_val::text,
         round(sum(round(v.cantidad * v.precio, 2)) * mm.porcentaje / 100, 2),
         0, mm.numero::text, mm.id
    from valorizada v
    join merma mm on mm.codigo = v.codigo
   where v.precio is not null and v.moneda_val in ('PEN', 'USD')
   group by v.codigo, v.moneda_val, mm.id, mm.fecha, mm.porcentaje, mm.motivo, mm.numero
  union all
  select * from public.codigo_interno_lineas_servicio(v_codigo)
  union all
  select * from public.codigo_interno_lineas_subcontrato(v_codigo)
  union all
  select * from public.codigo_interno_lineas_nota_credito(v_codigo)
  union all
  select * from public.codigo_interno_lineas_caja(v_codigo) where p_mano_obra
  union all
  select * from public.codigo_interno_lineas_recargo(v_codigo) where p_mano_obra
  union all
  select * from public.codigo_interno_lineas_gastos_ot(v_codigo) where p_mano_obra
   order by 1, 3 desc, 2, 4;
end;
$function$;

-- 6. El costeo: el descuento baja el código -----------------------------------------------------------
-- Cada nota por descuento, repartida como las OC de su factura: a cada código le
-- toca la parte de la OC que va a ese código (la de su RQ, o la OC entera si es
-- directa), en la proporción de la nota sobre el total de la factura. Así la
-- base es la misma que la del material (sin IGV si la OC va sin IGV), y la suma
-- de lo que baja en los códigos es lo que la nota baja de esas OC.
create or replace function public.codigo_interno_lineas_nota_credito(p_codigo text)
returns table (codigo text, fuente text, fecha date, concepto text, detalle text, cantidad numeric, unidad text,
               horas numeric, precio_unitario numeric, moneda text, monto numeric, sin_precio integer,
               documento text, referencia_id uuid)
language sql stable set search_path to 'public' as $$
  with nota as (
    select n.id, n.numero, n.fecha_emision, n.monto, a.numero_documento, a.moneda, a.total,
           public.compras_de_la_factura(a) as compras
      from public.notas_credito_compra n
      join public.adquisiciones a on a.id = n.adquisicion_id
     where n.tipo = 'DESCUENTO' and n.anulado_en is null and a.estado = 'REGISTRADA' and a.total > 0
  ), porcion as (
    select rl.orden_compra_detalle_id as detalle_id, public.normalizar_codigo_interno(rq.codigo_interno) as codigo,
           sum(greatest(rl.cantidad - coalesce(rl.cantidad_en_stock, 0), 0))::numeric as falta
      from public.requerimiento_lineas rl
      join public.requerimientos rq on rq.id = rl.requerimiento_id
     where rl.orden_compra_detalle_id is not null
     group by 1, 2
  ), reparto as (
    select p.detalle_id, p.codigo,
           coalesce(p.falta / nullif(sum(p.falta) over (partition by p.detalle_id), 0),
                    1.0 / count(*) over (partition by p.detalle_id))::numeric as parte
      from porcion p
  ), linea as (
    select x.id, x.numero, x.fecha_emision, x.monto, x.numero_documento, x.moneda, x.total,
           coalesce(c.numero, c.referencia) as compra,
           coalesce(r.codigo, public.normalizar_codigo_interno(c.codigo_interno)) as codigo,
           sum(d.cantidad * d.precio_unitario * coalesce(r.parte, 1))::numeric as importe
      from nota x
      cross join lateral unnest(x.compras) o(id)
      join public.ordenes_compra_materiales c on c.id = o.id and c.aprobacion not in ('RECHAZADA', 'ANULADA')
      join public.orden_compra_material_detalles d on d.orden_compra_id = c.id and d.precio_unitario is not null
      left join reparto r on r.detalle_id = d.id
     group by x.id, x.numero, x.fecha_emision, x.monto, x.numero_documento, x.moneda, x.total, c.id, c.numero, c.referencia,
              coalesce(r.codigo, public.normalizar_codigo_interno(c.codigo_interno))
  )
  select l.codigo, 'MATERIALES'::text, l.fecha_emision,
         ('Nota de crédito ' || l.numero || ' (descuento)')::text,
         ('Baja ' || trim(trailing '.' from to_char(round(l.monto / l.total * 100, 2), 'FM990.99')) || ' % de la factura '
          || l.numero_documento || ' en lo de la ' || l.compra || ' que va a este código')::text,
         1::numeric, null::text, null::numeric,
         -round(l.importe * l.monto / l.total, 2), l.moneda::text, -round(l.importe * l.monto / l.total, 2),
         0, l.compra::text, l.id
    from linea l
   where l.codigo is not null and l.importe > 0
     and (public.normalizar_codigo_interno(p_codigo) is null or l.codigo = public.normalizar_codigo_interno(p_codigo))
$$;
-- La llama `codigo_interno_lineas`, que solo corre dentro de las funciones que ya exigen su permiso.
revoke all on function public.codigo_interno_lineas_nota_credito(text) from public, anon, authenticated;

-- 7. Cuánto queda a favor de una nota -----------------------------------------------------------------
create or replace function public.saldo_de_la_nota_credito(p_nota uuid)
returns numeric language sql stable set search_path to 'public' as $$
  select n.monto
         - coalesce((select sum(p.monto) from public.pagos_adquisicion p
                      where p.nota_credito_id = n.id and p.anulado_en is null), 0)
         - coalesce((select sum(r.monto) from public.reembolsos_nota_credito r
                      where r.nota_credito_id = n.id and r.anulado_en is null), 0)
    from public.notas_credito_compra n
   where n.id = p_nota and n.anulado_en is null
$$;
revoke all on function public.saldo_de_la_nota_credito(uuid) from public, anon, authenticated;

create or replace function public.texto_monto(p_moneda text, p_monto numeric)
returns text language sql immutable set search_path to 'public' as $$
  select case when p_moneda = 'USD' then 'US$ ' else 'S/ ' end || to_char(p_monto, 'FM999G999G990D00')
$$;
revoke all on function public.texto_monto(text, numeric) from public, anon;
grant execute on function public.texto_monto(text, numeric) to authenticated;

-- 8. Contabilidad registra la nota --------------------------------------------------------------------
create or replace function public.registrar_nota_credito(
  p_id uuid, p_factura uuid, p_numero text, p_fecha date, p_monto numeric, p_tipo text,
  p_devolucion uuid, p_motivo text, p_ruta text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_yo       uuid := public.usuario_actual();
  v_hoy      date := (now() at time zone 'America/Lima')::date;
  v_adq      public.adquisiciones%rowtype;
  v_num      text := upper(regexp_replace(coalesce(p_numero, ''), '\s+', '', 'g'));
  v_motivo   text := btrim(coalesce(p_motivo, ''));
  v_dev      public.movimientos_materiales%rowtype;
  v_repuesto numeric;
  v_notas    numeric;
  v_saldo    numeric;
  v_aplica   numeric;
  v_obj      storage.objects%rowtype;
  v_otra     text;
begin
  perform public.exigir_permiso('adquisiciones.registrar');
  if p_id is null then raise exception 'Vuelve a abrir el formulario de la nota de crédito.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.notas_credito_compra where id = p_id) then
    -- El mismo envío repetido (la respuesta se perdió) se reconoce por su archivo y por quién lo
    -- anotó; otro envío con el mismo id, no (como en 20261022160000).
    if exists (select 1 from public.notas_credito_compra where id = p_id and archivo_ruta = p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Esta nota de crédito ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.'
      using errcode = 'check_violation';
  end if;
  select * into v_adq from public.adquisiciones where id = p_factura for update;
  if exists (select 1 from public.notas_credito_compra where id = p_id) then
    -- El mismo envío repetido (la respuesta se perdió) se reconoce por su archivo y por quién lo
    -- anotó; otro envío con el mismo id, no (como en 20261022160000).
    if exists (select 1 from public.notas_credito_compra where id = p_id and archivo_ruta = p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Esta nota de crédito ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.'
      using errcode = 'check_violation';
  end if;
  if not found or v_adq.estado <> 'REGISTRADA' then
    raise exception 'Esa factura todavía no está registrada en Adquisiciones.' using errcode = 'check_violation';
  end if;
  if v_adq.tipo in ('RECIBO_HONORARIOS', 'OTRO') then
    raise exception 'La nota de crédito va contra una factura, y el % no lo es.', v_adq.numero_documento using errcode = 'check_violation';
  end if;
  if v_num !~ '^[A-Z][A-Z0-9]{3}-[0-9]{1,8}$' then
    raise exception 'Escribe el número de la nota como viene en ella: la serie de cuatro y el número, por ejemplo FC01-123.'
      using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha > v_hoy or p_fecha < v_adq.fecha_emision then
    raise exception 'La fecha de la nota va desde la de su factura (%) hasta hoy.', to_char(v_adq.fecha_emision, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe el total de la nota, en dos decimales.' using errcode = 'check_violation';
  end if;
  if p_tipo is null or p_tipo not in ('DEVOLUCION', 'DESCUENTO') then
    raise exception 'Di si la nota es por lo que se devolvió o por un descuento.' using errcode = 'check_violation';
  end if;
  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'Cuenta qué corrige la nota, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select n.numero into v_otra from public.notas_credito_compra n
   where n.anulado_en is null and n.numero = v_num
     and public.mismo_emisor(n.ruc_proveedor, n.proveedor, v_adq.ruc_proveedor, v_adq.proveedor)
   limit 1;
  if found then
    raise exception 'La nota % de % ya está registrada.', v_num, v_adq.proveedor using errcode = 'unique_violation';
  end if;
  select coalesce(sum(monto), 0) into v_notas from public.notas_credito_compra where adquisicion_id = p_factura and anulado_en is null;
  if v_notas + p_monto > v_adq.total then
    raise exception 'Con esta, las notas de crédito de la factura % pasarían de su total (%): ya tiene % en notas.',
      v_adq.numero_documento, public.texto_monto(v_adq.moneda, v_adq.total), public.texto_monto(v_adq.moneda, v_notas)
      using errcode = 'check_violation';
  end if;

  if p_devolucion is not null then
    if p_tipo <> 'DEVOLUCION' then
      raise exception 'Un descuento no va ligado a lo devuelto: elige «Por lo devuelto» o quita la devolución.' using errcode = 'check_violation';
    end if;
    select * into v_dev from public.movimientos_materiales where id = p_devolucion for update;
    if not found or v_dev.tipo <> 'DEVOLUCION_PROVEEDOR'
       or not exists (select 1 from public.orden_compra_material_detalles d
                       where d.id = v_dev.orden_compra_detalle_id and d.orden_compra_id = any(public.compras_de_la_factura(v_adq))) then
      raise exception 'Esa devolución no es de una OC de la factura %.', v_adq.numero_documento using errcode = 'check_violation';
    end if;
    select n.numero into v_otra from public.notas_credito_compra n where n.devolucion_id = p_devolucion and n.anulado_en is null limit 1;
    if found then
      raise exception 'Esa devolución ya tiene su nota de crédito, la %.', v_otra using errcode = 'check_violation';
    end if;
    select coalesce(sum(m.cantidad::numeric), 0) into v_repuesto from public.movimientos_materiales m where m.repone_devolucion = p_devolucion;
    if v_repuesto >= v_dev.cantidad then
      raise exception 'Esa devolución ya se repuso entera: no lleva nota de crédito.' using errcode = 'check_violation';
    end if;
  end if;

  v_obj := public.archivo_subido_por_mi('notas-credito', p_ruta, p_factura,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  insert into public.notas_credito_compra (id, adquisicion_id, numero, proveedor, ruc_proveedor, fecha_emision, moneda, monto,
                                           tipo, devolucion_id, motivo, archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (p_id, p_factura, v_num, v_adq.proveedor, v_adq.ruc_proveedor, p_fecha, v_adq.moneda, p_monto,
          p_tipo, p_devolucion, v_motivo, p_ruta, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, v_yo);

  -- Que el proveedor emita la nota es que ya no repone lo que falta de esa devolución.
  if p_devolucion is not null and v_dev.se_repone then
    perform set_config('metalwork.nota_credito', p_devolucion::text, true);
    perform public.dejar_de_esperar_reposicion(p_devolucion,
      'Contabilidad registró la nota de crédito ' || v_num || ': el proveedor no repone lo devuelto.');
    perform set_config('metalwork.nota_credito', '', true);
  end if;

  -- Baja lo que se debe de su factura; lo que no cabe queda a favor.
  select v_adq.total - coalesce(sum(p.monto), 0) into v_saldo
    from public.pagos_adquisicion p where p.adquisicion_id = p_factura and p.anulado_en is null;
  v_aplica := least(p_monto, greatest(v_saldo, 0));
  if v_aplica > 0 then
    perform set_config('metalwork.aplica_nota_credito', p_id::text, true);
    insert into public.pagos_adquisicion (adquisicion_id, fecha, monto, referencia, registrado_por, nota_credito_id)
    values (p_factura, p_fecha, v_aplica, 'Nota de crédito ' || v_num, v_yo, p_id);
    perform set_config('metalwork.aplica_nota_credito', '', true);
  end if;
  if p_monto > v_aplica then
    perform public.avisar_a_permiso('tesoreria.registrar_pagos', 'Saldo a favor: nota de crédito ' || v_num,
      format('%s emitió la nota %s contra la factura %s, que %s: quedan %s a favor. Descuéntalos de otra factura del proveedor o registra que los devolvió.',
             v_adq.proveedor, v_num, v_adq.numero_documento,
             case when v_aplica = 0 then 'ya estaba pagada' else 'debía menos' end,
             public.texto_monto(v_adq.moneda, p_monto - v_aplica)),
      '/tesoreria/por-pagar#notas-credito', 'notas_credito_compra', p_id);
  end if;
  return p_id;
end;
$$;

create or replace function public.anular_nota_credito(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_n      public.notas_credito_compra%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_otras  integer;
begin
  perform public.exigir_permiso('adquisiciones.registrar');
  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_n from public.notas_credito_compra where id = p_id;
  if not found then raise exception 'Esa nota de crédito no existe.' using errcode = 'check_violation'; end if;
  -- Primero las facturas, en el mismo orden que el pago: dos anulaciones no se cruzan.
  perform 1 from public.adquisiciones a
   where a.id in (select p.adquisicion_id from public.pagos_adquisicion p where p.nota_credito_id = p_id)
      or a.id = v_n.adquisicion_id
   order by a.id for update;
  select * into v_n from public.notas_credito_compra where id = p_id for update;
  if v_n.anulado_en is not null then return p_id; end if;
  if exists (select 1 from public.reembolsos_nota_credito r where r.nota_credito_id = p_id and r.anulado_en is null) then
    raise exception 'Tesorería registró que el proveedor devolvió dinero de la nota %: anula antes esa devolución en Cuentas por pagar.', v_n.numero
      using errcode = 'check_violation';
  end if;
  select count(*) into v_otras from public.pagos_adquisicion p
   where p.nota_credito_id = p_id and p.anulado_en is null and p.adquisicion_id <> v_n.adquisicion_id;
  perform set_config('metalwork.aplica_nota_credito', p_id::text, true);
  update public.pagos_adquisicion
     set anulado_por = public.usuario_actual(), anulado_en = now(),
         motivo_anulacion = left('Se anuló la nota de crédito ' || v_n.numero || ': ' || v_motivo, 500)
   where nota_credito_id = p_id and anulado_en is null;
  perform set_config('metalwork.aplica_nota_credito', '', true);
  update public.notas_credito_compra
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = v_motivo
   where id = p_id;
  if v_otras > 0 then
    perform public.avisar_a_permiso('tesoreria.registrar_pagos', 'Se anuló la nota de crédito ' || v_n.numero,
      'Lo que descontaba de otras facturas de ' || v_n.proveedor || ' vuelve a deberse: ' || v_motivo,
      '/tesoreria/por-pagar', 'notas_credito_compra', p_id);
  end if;
  return p_id;
end;
$$;

-- 9. Tesorería usa lo que quedó a favor ---------------------------------------------------------------
-- Las facturas del mismo proveedor, en la misma moneda, que todavía deben.
create or replace function public.facturas_para_la_nota(p_nota uuid)
returns table (factura_id uuid, numero text, fecha date, total numeric, saldo numeric)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if public.usuario_actual() is not null and not (public.es_admin() or public.tiene_permiso('tesoreria.registrar_pagos')) then
    raise exception 'Lo descuenta Tesorería.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select a.id, a.numero_documento, a.fecha_emision, a.total, s.saldo
    from public.notas_credito_compra n
    join public.adquisiciones a on a.estado = 'REGISTRADA' and a.tipo not in ('RECIBO_HONORARIOS', 'OTRO')
                               and a.moneda = n.moneda
                               and public.mismo_emisor(a.ruc_proveedor, a.proveedor, n.ruc_proveedor, n.proveedor)
    cross join lateral (
      select (a.total - coalesce(sum(p.monto), 0))::numeric(14, 2) as saldo
        from public.pagos_adquisicion p where p.adquisicion_id = a.id and p.anulado_en is null) s
   where n.id = p_nota and n.anulado_en is null and s.saldo > 0
   order by a.fecha_emision, a.numero_documento
   limit 50;
end;
$$;

create or replace function public.descontar_nota_credito(p_nota uuid, p_factura uuid, p_monto numeric)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_n     public.notas_credito_compra%rowtype;
  v_adq   public.adquisiciones%rowtype;
  v_libre numeric;
  v_saldo numeric;
  v_id    uuid := gen_random_uuid();
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  select * into v_adq from public.adquisiciones where id = p_factura for update;
  if not found or v_adq.estado <> 'REGISTRADA' then
    raise exception 'Esa factura todavía no está registrada en Adquisiciones.' using errcode = 'check_violation';
  end if;
  select * into v_n from public.notas_credito_compra where id = p_nota for update;
  if not found or v_n.anulado_en is not null then
    raise exception 'Esa nota de crédito no existe o está anulada. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if v_adq.tipo in ('RECIBO_HONORARIOS', 'OTRO') then
    raise exception 'La nota se descuenta de una factura, y el % no lo es.', v_adq.numero_documento using errcode = 'check_violation';
  end if;
  if not public.mismo_emisor(v_adq.ruc_proveedor, v_adq.proveedor, v_n.ruc_proveedor, v_n.proveedor) then
    raise exception 'La factura % es de %, y la nota de %.', v_adq.numero_documento, v_adq.proveedor, v_n.proveedor
      using errcode = 'check_violation';
  end if;
  if v_adq.moneda <> v_n.moneda then
    raise exception 'La nota es en % y la factura % en %: el sistema no convierte.',
      case when v_n.moneda = 'USD' then 'dólares' else 'soles' end, v_adq.numero_documento,
      case when v_adq.moneda = 'USD' then 'dólares' else 'soles' end using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.pagos_adquisicion p
              where p.adquisicion_id = p_factura and p.nota_credito_id = p_nota and p.anulado_en is null) then
    raise exception 'La nota % ya descuenta de la factura %: para cambiar cuánto, quita ese descuento y vuelve a hacerlo.',
      v_n.numero, v_adq.numero_documento using errcode = 'check_violation';
  end if;
  v_libre := public.saldo_de_la_nota_credito(p_nota);
  select v_adq.total - coalesce(sum(p.monto), 0) into v_saldo
    from public.pagos_adquisicion p where p.adquisicion_id = p_factura and p.anulado_en is null;
  if p_monto is null or p_monto <= 0 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe cuánto se descuenta, en dos decimales.' using errcode = 'check_violation';
  end if;
  if p_monto > v_libre then
    raise exception 'A la nota % le quedan % a favor.', v_n.numero, public.texto_monto(v_n.moneda, v_libre) using errcode = 'check_violation';
  end if;
  if p_monto > v_saldo then
    raise exception 'La factura % debe %.', v_adq.numero_documento, public.texto_monto(v_adq.moneda, greatest(v_saldo, 0))
      using errcode = 'check_violation';
  end if;
  perform set_config('metalwork.aplica_nota_credito', p_nota::text, true);
  insert into public.pagos_adquisicion (id, adquisicion_id, fecha, monto, referencia, registrado_por, nota_credito_id)
  values (v_id, p_factura, (now() at time zone 'America/Lima')::date, p_monto, 'Nota de crédito ' || v_n.numero,
          public.usuario_actual(), p_nota);
  perform set_config('metalwork.aplica_nota_credito', '', true);
  return v_id;
end;
$$;

-- Quita lo que Tesorería descontó de otra factura; lo que la nota baja de su propia factura se quita anulando la nota.
create or replace function public.quitar_descuento_nota_credito(p_pago uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_p      public.pagos_adquisicion%rowtype;
  v_n      public.notas_credito_compra%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'Cuenta por qué se quita, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_p from public.pagos_adquisicion where id = p_pago;
  if not found or v_p.nota_credito_id is null then
    raise exception 'Ese descuento no existe. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  perform 1 from public.adquisiciones where id = v_p.adquisicion_id for update;
  select * into v_p from public.pagos_adquisicion where id = p_pago for update;
  if v_p.anulado_en is not null then return p_pago; end if;
  select * into v_n from public.notas_credito_compra where id = v_p.nota_credito_id;
  if v_p.adquisicion_id = v_n.adquisicion_id then
    raise exception 'Lo que la nota % baja de su propia factura se quita anulando la nota en Adquisiciones.', v_n.numero
      using errcode = 'check_violation';
  end if;
  perform set_config('metalwork.aplica_nota_credito', v_n.id::text, true);
  update public.pagos_adquisicion
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = v_motivo
   where id = p_pago;
  perform set_config('metalwork.aplica_nota_credito', '', true);
  return p_pago;
end;
$$;

create or replace function public.registrar_reembolso_nota_credito(
  p_id uuid, p_nota uuid, p_fecha date, p_monto numeric, p_operacion text, p_ruta text, p_caja uuid, p_monto_cuenta numeric)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_n     public.notas_credito_compra%rowtype;
  v_hoy   date := (now() at time zone 'America/Lima')::date;
  v_op    text := nullif(btrim(coalesce(p_operacion, '')), '');
  v_libre numeric;
  v_obj   storage.objects%rowtype;
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  if p_id is null then raise exception 'Vuelve a abrir el formulario de la devolución.' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.reembolsos_nota_credito where id = p_id) then
    -- El mismo envío repetido (la respuesta se perdió) se reconoce por su archivo y por quién lo
    -- anotó; otro envío con el mismo id, no (como en 20261022160000).
    if exists (select 1 from public.reembolsos_nota_credito where id = p_id and archivo_ruta = p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Esta devolución ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.'
      using errcode = 'check_violation';
  end if;
  select * into v_n from public.notas_credito_compra where id = p_nota for update;
  if exists (select 1 from public.reembolsos_nota_credito where id = p_id) then
    -- El mismo envío repetido (la respuesta se perdió) se reconoce por su archivo y por quién lo
    -- anotó; otro envío con el mismo id, no (como en 20261022160000).
    if exists (select 1 from public.reembolsos_nota_credito where id = p_id and archivo_ruta = p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Esta devolución ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.'
      using errcode = 'check_violation';
  end if;
  if not found or v_n.anulado_en is not null then
    raise exception 'Esa nota de crédito no existe o está anulada. Vuelve a cargar la pantalla.' using errcode = 'check_violation';
  end if;
  if p_fecha is null or p_fecha > v_hoy or p_fecha < v_n.fecha_emision then
    raise exception 'Elige el día en que entró el dinero: desde la fecha de la nota (%) hasta hoy.', to_char(v_n.fecha_emision, 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;
  if p_monto is null or p_monto <= 0 or p_monto > 999999999 or p_monto <> round(p_monto, 2) then
    raise exception 'Escribe lo que devolvió el proveedor, en dos decimales.' using errcode = 'check_violation';
  end if;
  v_libre := public.saldo_de_la_nota_credito(p_nota);
  if p_monto > v_libre then
    raise exception 'A la nota % le quedan % a favor.', v_n.numero, public.texto_monto(v_n.moneda, v_libre) using errcode = 'check_violation';
  end if;
  if v_op is not null and char_length(v_op) > 60 then
    raise exception 'El número de operación pasa de 60 caracteres.' using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('notas-credito', p_ruta, p_nota,
                                        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
  insert into public.reembolsos_nota_credito (id, nota_credito_id, fecha, moneda, monto, operacion,
                                              archivo_ruta, archivo_mime, archivo_tamano, registrado_por)
  values (p_id, p_nota, p_fecha, v_n.moneda, p_monto, v_op,
          p_ruta, v_obj.metadata->>'mimetype', (v_obj.metadata->>'size')::integer, public.usuario_actual());
  perform public.caja_mover_por_pago('REEMBOLSO_NOTA_CREDITO', p_id, 'INGRESO', p_caja, p_fecha, p_monto, v_n.moneda, p_monto_cuenta,
    'Devolución del proveedor por la nota de crédito ' || v_n.numero || ' · ' || v_n.proveedor, null, v_op);
  return p_id;
end;
$$;

create or replace function public.anular_reembolso_nota_credito(p_id uuid, p_motivo text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare
  v_r      public.reembolsos_nota_credito%rowtype;
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  perform public.exigir_permiso('tesoreria.registrar_pagos');
  if char_length(v_motivo) not between 10 and 500 then
    raise exception 'Cuenta por qué se anula, en 10 a 500 caracteres.' using errcode = 'check_violation';
  end if;
  select * into v_r from public.reembolsos_nota_credito where id = p_id;
  if not found then raise exception 'Esa devolución no existe.' using errcode = 'check_violation'; end if;
  perform 1 from public.notas_credito_compra where id = v_r.nota_credito_id for update;
  select * into v_r from public.reembolsos_nota_credito where id = p_id for update;
  if v_r.anulado_en is not null then return p_id; end if;
  perform public.caja_anular_por_pago('REEMBOLSO_NOTA_CREDITO', p_id, v_motivo, 'devolución');
  update public.reembolsos_nota_credito
     set anulado_por = public.usuario_actual(), anulado_en = now(), motivo_anulacion = v_motivo
   where id = p_id;
  return p_id;
end;
$$;

-- 10. Lo que cada uno ve ------------------------------------------------------------------------------
-- Tesorería: las notas con algo a favor, o con algo que ya usó de ellas y se puede deshacer.
create or replace function public.notas_credito_a_favor()
returns table (nota_id uuid, numero text, proveedor text, ruc_proveedor text, factura_id uuid, factura text,
               fecha date, moneda text, monto numeric, a_favor numeric, archivo_ruta text, usado jsonb)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if public.usuario_actual() is not null and not (public.es_admin() or public.tiene_permiso('tesoreria.registrar_pagos')
                                                  or public.tiene_permiso('tesoreria.ver_documentos')) then
    raise exception 'Lo ve Tesorería.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select n.id, n.numero, n.proveedor, n.ruc_proveedor, a.id, a.numero_documento, n.fecha_emision, n.moneda, n.monto,
         public.saldo_de_la_nota_credito(n.id), n.archivo_ruta, u.usado
    from public.notas_credito_compra n
    join public.adquisiciones a on a.id = n.adquisicion_id
    cross join lateral (
      select coalesce(jsonb_agg(x order by x->>'fecha', x->>'id'), '[]'::jsonb) as usado
        from (select jsonb_build_object('id', p.id, 'que', 'DESCUENTO', 'fecha', p.fecha, 'monto', p.monto,
                                        'factura', f.numero_documento) as x
                from public.pagos_adquisicion p
                join public.adquisiciones f on f.id = p.adquisicion_id
               where p.nota_credito_id = n.id and p.anulado_en is null and p.adquisicion_id <> n.adquisicion_id
              union all
              select jsonb_build_object('id', r.id, 'que', 'DEVOLUCION', 'fecha', r.fecha, 'monto', r.monto,
                                        'operacion', r.operacion)
                from public.reembolsos_nota_credito r
               where r.nota_credito_id = n.id and r.anulado_en is null) y) u
   where n.anulado_en is null
     and (public.saldo_de_la_nota_credito(n.id) > 0 or jsonb_array_length(u.usado) > 0)
   order by public.saldo_de_la_nota_credito(n.id) = 0, n.fecha_emision desc, n.numero
   limit 100;
end;
$$;

-- Contabilidad: lo que Almacén devolvió sin reposición y todavía no tiene su nota.
create or replace function public.devoluciones_sin_nota_credito()
returns table (devolucion_id uuid, fecha timestamptz, compra text, orden_compra_id uuid, proveedor text, material text,
               unidad text, cantidad numeric, importe numeric, moneda text, documento text, facturas jsonb)
language plpgsql stable security definer set search_path to 'public' as $$
#variable_conflict use_column
begin
  if public.usuario_actual() is not null and not (public.es_admin() or public.tiene_permiso('adquisiciones.ver')) then
    raise exception 'Lo ve Contabilidad.' using errcode = 'insufficient_privilege';
  end if;
  return query
  select m.id, m.registrado_en, coalesce(c.numero, 'OC ' || c.referencia), c.id, c.proveedor, mt.descripcion::text,
         um.codigo::text, x.falta, round(x.falta * m.precio_unitario, 2), coalesce(m.moneda, c.moneda)::text,
         m.documento_referencia::text,
         coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'numero', a.numero_documento) order by a.fecha_emision)
                     from public.facturas_de_la_compra(c.id) f
                     join public.adquisiciones a on a.id = f.adquisicion_id and a.estado = 'REGISTRADA'), '[]'::jsonb)
    from public.movimientos_materiales m
    join public.orden_compra_material_detalles d on d.id = m.orden_compra_detalle_id
    join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
    join public.materiales mt on mt.id = m.material_id
    left join public.unidades_medida um on um.id = mt.unidad_medida_id
    cross join lateral (
      select m.cantidad::numeric - coalesce((select sum(r.cantidad::numeric) from public.movimientos_materiales r
                                               where r.repone_devolucion = m.id), 0) as falta) x
   where m.tipo = 'DEVOLUCION_PROVEEDOR' and not m.se_repone and x.falta > 0
     and not exists (select 1 from public.notas_credito_compra n where n.devolucion_id = m.id and n.anulado_en is null)
   order by m.registrado_en
   limit 200;
end;
$$;

-- 11. Permisos de las funciones -----------------------------------------------------------------------
do $$
declare v text;
begin
  foreach v in array array[
    'registrar_nota_credito(uuid, uuid, text, date, numeric, text, uuid, text, text)',
    'anular_nota_credito(uuid, text)',
    'facturas_para_la_nota(uuid)',
    'descontar_nota_credito(uuid, uuid, numeric)',
    'quitar_descuento_nota_credito(uuid, text)',
    'registrar_reembolso_nota_credito(uuid, uuid, date, numeric, text, text, uuid, numeric)',
    'anular_reembolso_nota_credito(uuid, text)',
    'notas_credito_a_favor()',
    'devoluciones_sin_nota_credito()'] loop
    execute format('revoke all on function public.%s from public, anon', v);
    execute format('grant execute on function public.%s to authenticated', v);
  end loop;
end $$;

notify pgrst, 'reload schema';
