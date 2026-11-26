-- =============================================================================
-- LA FACTURA DICE DE QUÉ UNIDAD ES
-- -----------------------------------------------------------------------------
-- Desde la 20261126760000 una cotización de tres camabajas se sube una vez y
-- cada camabaja tiene su OT y su código interno. La factura se quedó atrás:
-- `registrar_factura_venta` la colgaba del código de la OT más nueva, así que
-- las tres facturas de las tres unidades caían en el código de la última. La
-- ficha de las otras dos decía «Contabilidad aún no la factura», y cuando una
-- de esas pedía salir del taller, Tesorería y Costos veían un código «sin
-- facturas» aunque el cliente ya hubiera pagado.
--
-- DKS decidió el 2026-11-26:
--   · La factura es de UNA unidad, o de TODA la cotización. El anticipo que el
--     cliente paga por las tres («pago a cuenta», que es como hoy se factura la
--     mayoría) es una sola factura de SUNAT: se registra una vez y se reparte
--     en partes iguales entre sus unidades.
--   · La unidad se factura apenas tiene su OT con código, sin esperar a las
--     demás. La factura de toda la cotización espera a que estén todas las OT.
--
-- Cómo queda:
--   · `facturas_venta_unidades` guarda, al registrar, qué unidades cubre cada
--     factura, con qué código y cuánto de su total va a cada una. Se anota una
--     vez y no se recalcula al leer: si después cambia una OT, lo facturado de
--     cada código no se mueve solo. Los céntimos que sobran del reparto quedan
--     en alguna de las partes, y las partes suman siempre el total.
--   · Las facturas que ya existen quedan con una sola parte, por su total, en
--     la unidad de su código. En producción todas son de cotizaciones de una
--     unidad (se miró el 26/11: ninguna cotización de varias).
--   · Toda factura nace con su parte. La que registra Contabilidad la trae
--     dicha; la que entra directo a la tabla (una carga, la siembra de una
--     prueba) recibe sola su única parte, entera. Sin su parte, lo facturado
--     de su código no la contaría y la unidad se volvería a pedir por facturar.
--   · `registrar_factura_venta_de_unidad` es el registro de antes más la
--     unidad: un número (1, 2, 3…) o 0 para toda la cotización. Va con nombre
--     nuevo y sin valor por omisión, para que la pestaña de antes del
--     despliegue no la confunda con la vieja. La vieja queda: registra la de
--     una unidad como siempre y, si la cotización es de varias, pide recargar.
--   · `v_facturas_venta` suma al final cuántas unidades cubre y cuál.
--     `v_facturas_venta_por_unidad` da una fila por parte, con lo cobrado y el
--     saldo que le tocan: es lo que leen Cuentas por cobrar, la ficha del
--     código y la revisión de salida.
--   · `facturacion_por_unidad` da, de cada cotización aprobada, una fila por
--     unidad: su código, desde cuándo espera, lo que le toca y lo que lleva
--     facturado y cobrado. La bandeja de Contabilidad se arma con eso.
--   · `facturacion_pendientes` cuenta unidades por facturar, como la lista.
--   · `codigo_interno_lo_vendido` da lo vendido y lo facturado de la unidad de
--     ese código, no de toda la cotización.
--
-- La cotización de una unidad se porta exactamente como antes.
--
-- Sin auditoría genérica en la tabla nueva: `audit_log` se lee con
-- `auditoria.ver` y sus filas de `facturas_venta` piden además el permiso de
-- la factura (20261020150000); una tabla nueva quedaría fuera de esa lista. La
-- factura sigue auditada y su reparto no cambia nunca.
--
-- Guarda de huella: tres funciones se reemplazan enteras. Cada una se
-- reemplaza solo si su cuerpo es el que conoce el repositorio (el mismo que
-- tiene producción, comparado el 26/11) o el de esta migración.
-- Idempotente.
-- =============================================================================

-- 0. Lo que producción pudo cambiar a mano no se pisa -------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.proname, md5(replace(p.prosrc, E'\r', '')) as huella
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and ((p.proname = 'registrar_factura_venta' and pg_get_function_identity_arguments(p.oid) =
               'p_id uuid, p_cotizacion uuid, p_numero text, p_fecha_emision date, p_fecha_vencimiento date, p_moneda text, p_total numeric, p_concepto text, p_ruta text, p_nombre_archivo text')
            or p.proname in ('facturacion_pendientes', 'codigo_interno_lo_vendido'))
  loop
    if r.huella not in (
         -- registrar_factura_venta: la de la 20261022160000, y la de esta migración
         'fb6522dbed0662933c896540bad089da', '87854295605d73b9bf8775f53292147d',
         -- facturacion_pendientes: la de la 20261126470000, y la de esta
         '3d3540342785bc9757f912d140e84bdf', 'f2efed16de051fe76a88b95270a58171',
         -- codigo_interno_lo_vendido: la de la 20261126640000, y la de esta
         '27f4e4aa99f96e828a2d8a60ee25c9bf', '043e0d1a3af3344c82682960b743b71f') then
      raise exception '% no está como la conoce el repositorio (huella %): revísala antes de aplicar esta migración.', r.proname, r.huella;
    end if;
  end loop;
end $$;

-- 1. La parte de cada unidad ----------------------------------------------------------
-- El total entre las unidades: la parte de la unidad k es lo acumulado hasta k
-- menos lo acumulado hasta k-1, cada acumulado redondeado al céntimo. Así las
-- partes suman siempre el total (100 entre 3: 33.33, 33.34 y 33.33). Sirve igual para
-- repartir una factura que para saber cuánto le toca facturar a cada unidad.
create or replace function public.parte_de_unidad(p_total numeric, p_unidades integer, p_unidad integer)
returns numeric
language sql
immutable
set search_path to 'public'
as $$
  select case when p_total is null or p_unidades is null or p_unidad is null
                   or p_unidades < 1 or p_unidad < 1 or p_unidad > p_unidades then null
              else round(p_total * p_unidad / p_unidades, 2) - round(p_total * (p_unidad - 1) / p_unidades, 2) end;
$$;

comment on function public.parte_de_unidad(numeric, integer, integer) is
  'La parte de la unidad k al repartir un total entre n unidades iguales: las partes suman el total, céntimo por céntimo. Ayudante interno (migración 20261126998000).';

revoke all on function public.parte_de_unidad(numeric, integer, integer) from public, anon, authenticated;

-- 2. Qué unidades cubre cada factura ---------------------------------------------------
create table if not exists public.facturas_venta_unidades (
  id                uuid primary key default gen_random_uuid(),
  factura_id        uuid not null references public.facturas_venta(id) on delete restrict,
  numero_de_unidad  smallint not null,
  -- Cuántas unidades tenía la cotización cuando se registró la factura: «unidad 2 de 3».
  de_unidades       smallint not null,
  codigo_interno    text not null,
  monto             numeric(14, 2) not null,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),
  constraint uq_factura_venta_unidad unique (factura_id, numero_de_unidad),
  constraint ck_factura_venta_unidad_valores check (
    numero_de_unidad between 1 and 50 and de_unidades between 1 and 50 and numero_de_unidad <= de_unidades
    and monto > 0 and monto <= 999999999
    and char_length(btrim(codigo_interno)) between 1 and 60)
);

comment on table public.facturas_venta_unidades is
  'Qué unidades de su cotización cubre cada factura de venta, con el código interno de cada una y cuánto del total le toca. Se anota al registrar la factura y no cambia: se anula la factura. Migración 20261126998000.';

-- (b) Cuentas por cobrar, la ficha del código y la revisión de salida filtran por
-- el código. La llave hacia la factura ya la cubre el índice único, que empieza por ella.
create index if not exists ix_facturas_venta_unidades_codigo on public.facturas_venta_unidades (codigo_interno);

select public.activar_timestamps('facturas_venta_unidades');
select public.activar_registro_de_prueba('facturas_venta_unidades');

-- El reparto no se corrige ni se borra: es parte de lo que dice la factura.
create or replace function public.fn_factura_venta_unidades_guardia()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'El reparto de una factura no se borra: la factura se anula con su motivo.' using errcode = 'check_violation';
  end if;
  if (to_jsonb(new) - 'actualizado_en') is distinct from (to_jsonb(old) - 'actualizado_en') then
    raise exception 'El reparto de una factura no se corrige: anula la factura con su motivo y regístrala de nuevo.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_factura_venta_unidades_guardia() from public, anon, authenticated;

create or replace trigger trg_factura_venta_unidades_guardia
  before update or delete on public.facturas_venta_unidades
  for each row execute function public.fn_factura_venta_unidades_guardia();

-- Guarda un código: lleva la misma regla que las demás tablas que lo guardan (20261120500000).
create or replace trigger trg_facturas_venta_unidades_codigo_de_ot
  before insert or update of codigo_interno on public.facturas_venta_unidades
  for each row execute function public.fn_el_codigo_de_ot_es_de_su_ot();

-- Lo ve quien ve la factura: la misma política. Nadie escribe por la API: entra
-- con la factura, por `registrar_factura_venta_de_unidad`.
alter table public.facturas_venta_unidades enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'facturas_venta_unidades' and policyname = 'ver_facturas_venta_unidades') then
    create policy ver_facturas_venta_unidades on public.facturas_venta_unidades for select to authenticated
      using ((select public.es_admin()) or (select public.tiene_permiso('contabilidad.facturar'))
             or (select public.tiene_permiso('cotizaciones.ver_aprobadas'))
             or (select public.tiene_permiso('tesoreria.ver_documentos')));
  end if;
end $$;
revoke all on public.facturas_venta_unidades from public, anon, authenticated;
grant select on public.facturas_venta_unidades to authenticated;

-- 3. Toda factura nace con su unidad, y las de antes reciben la suya ------------------
-- La unidad que le toca a una factura entera por su código: la de la OT de su
-- cotización que lleva ese código (la vigente antes que la anulada) y, si no hay
-- ninguna, la 1.
create or replace function public.unidad_de_la_factura_por_su_codigo(p_cotizacion uuid, p_codigo text)
returns integer
language sql
stable
set search_path to 'public'
as $$
  select least(coalesce((select coalesce(o.numero_de_unidad, 1)
                           from public.ordenes_trabajo o
                           join public.unidades u on u.id = o.unidad_id
                          where o.cotizacion_pdf_id = c.id
                            and public.normalizar_codigo_interno(u.codigo_interno) = p_codigo
                          order by (o.estado <> 'ANULADA') desc, o.creado_en desc
                          limit 1), 1), c.cantidad_unidades)::integer
    from public.cotizaciones_pdf c
   where c.id = p_cotizacion
$$;

revoke all on function public.unidad_de_la_factura_por_su_codigo(uuid, text) from public, anon, authenticated;

-- Lo facturado de un código se suma por estas partes: una factura sin la suya no
-- contaría como facturada y se volvería a pedir. Por eso la que entra sin decir
-- su reparto (una carga, una prueba) recibe aquí su única parte, entera. La que
-- registra Contabilidad lo trae dicho: la función avisa con su id y lo anota ella.
create or replace function public.fn_factura_venta_nace_con_su_unidad()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if current_setting('metalwork.factura_con_su_reparto', true) = new.id::text then
    return null;
  end if;
  insert into public.facturas_venta_unidades (factura_id, numero_de_unidad, de_unidades, codigo_interno, monto, creado_en, actualizado_en)
  select new.id, public.unidad_de_la_factura_por_su_codigo(c.id, new.codigo_interno), c.cantidad_unidades,
         new.codigo_interno, new.total, new.creado_en, new.creado_en
    from public.cotizaciones_pdf c
   where c.id = new.cotizacion_pdf_id
  on conflict (factura_id, numero_de_unidad) do nothing;
  return null;
end;
$$;

revoke all on function public.fn_factura_venta_nace_con_su_unidad() from public, anon, authenticated;

create or replace trigger trg_factura_venta_nace_con_su_unidad
  after insert on public.facturas_venta
  for each row execute function public.fn_factura_venta_nace_con_su_unidad();

-- Las de antes, con la misma regla. También las anuladas, que siguen a la vista
-- como evidencia.
insert into public.facturas_venta_unidades (factura_id, numero_de_unidad, de_unidades, codigo_interno, monto, creado_en, actualizado_en)
select f.id, public.unidad_de_la_factura_por_su_codigo(c.id, f.codigo_interno), c.cantidad_unidades,
       f.codigo_interno, f.total, f.creado_en, f.creado_en
  from public.facturas_venta f
  join public.cotizaciones_pdf c on c.id = f.cotizacion_pdf_id
 where not exists (select 1 from public.facturas_venta_unidades p where p.factura_id = f.id);

-- 4. La factura con sus unidades, y cada parte con lo suyo ------------------------------
-- Las columnas nuevas van al final: las de antes no se mueven. La vista sigue
-- mirando con el rol de quien consulta.
create or replace view public.v_facturas_venta with (security_invoker = true) as
select f.id, f.codigo_interno, f.cotizacion_pdf_id, f.cotizacion_numero, f.cliente_id, f.cliente, f.numero,
       f.fecha_emision, f.fecha_vencimiento, f.moneda, f.total, f.concepto, f.ruta_storage, f.nombre_archivo,
       f.registrado_por, public.puesto_de(f.registrado_por) as registrado_por_puesto, f.creado_en,
       f.anulada_en, f.motivo_anulacion,
       coalesce(sum(b.monto) filter (where b.anulado_en is null), 0)::numeric(14, 2) as cobrado,
       coalesce(bool_or(b.cancela) filter (where b.anulado_en is null), false) as cancelada,
       case when f.anulada_en is not null or coalesce(bool_or(b.cancela) filter (where b.anulado_en is null), false) then 0
            else greatest(f.total - coalesce(sum(b.monto) filter (where b.anulado_en is null), 0), 0)
       end::numeric(14, 2) as saldo,
       max(b.fecha) filter (where b.anulado_en is null) as ultimo_cobro,
       -- Cuántas unidades cubre; cuál, si es una sola; y cuántas tenía su cotización.
       (select count(*)::integer from public.facturas_venta_unidades p where p.factura_id = f.id) as unidades_cubiertas,
       (select case when count(*) = 1 then min(p.numero_de_unidad)::integer end
          from public.facturas_venta_unidades p where p.factura_id = f.id) as numero_de_unidad,
       (select max(p.de_unidades)::integer from public.facturas_venta_unidades p where p.factura_id = f.id) as unidades_de_la_cotizacion
  from public.facturas_venta f
  left join public.cobros_factura_venta b on b.factura_id = f.id
 group by f.id;
revoke all on public.v_facturas_venta from public, anon, authenticated;
grant select on public.v_facturas_venta to authenticated;

-- Una fila por parte. Lo cobrado y el saldo de la factura se reparten como su
-- total, con la misma cuenta de acumulados: las partes suman lo de la factura.
create or replace view public.v_facturas_venta_por_unidad with (security_invoker = true) as
select p.id, p.factura_id, p.numero_de_unidad::integer as numero_de_unidad, p.de_unidades::integer as de_unidades,
       p.codigo_interno, p.monto,
       f.cotizacion_pdf_id, f.cotizacion_numero, f.cliente, f.numero, f.fecha_emision, f.fecha_vencimiento,
       f.moneda, f.total, f.concepto, f.creado_en, f.anulada_en, f.cancelada,
       (round(f.cobrado * p.acumulado / f.total, 2) - round(f.cobrado * (p.acumulado - p.monto) / f.total, 2))::numeric(14, 2) as cobrado,
       (round(f.saldo * p.acumulado / f.total, 2) - round(f.saldo * (p.acumulado - p.monto) / f.total, 2))::numeric(14, 2) as saldo,
       f.unidades_cubiertas
  from (select u.id, u.factura_id, u.numero_de_unidad, u.de_unidades, u.codigo_interno, u.monto,
               sum(u.monto) over (partition by u.factura_id order by u.numero_de_unidad) as acumulado
          from public.facturas_venta_unidades u) p
  join public.v_facturas_venta f on f.id = p.factura_id;

comment on view public.v_facturas_venta_por_unidad is
  'Cada factura de venta partida por unidad: el código de la unidad, lo que le toca del total y, en la misma proporción, lo cobrado y el saldo. La ve quien ve las facturas. Migración 20261126998000.';

revoke all on public.v_facturas_venta_por_unidad from public, anon, authenticated;
grant select on public.v_facturas_venta_por_unidad to authenticated;

-- 5. Registrar la factura, diciendo de qué unidad es ------------------------------------
-- La de la 20261022160000 (con el aviso de la 20261022195000) más `p_unidad`: 1, 2, 3… es esa unidad; 0 es toda la
-- cotización. Sin valor por omisión y con nombre propio: la llamada vieja no se
-- vuelve ambigua (PGRST203).
create or replace function public.registrar_factura_venta_de_unidad(
  p_id uuid, p_cotizacion uuid, p_numero text, p_fecha_emision date, p_fecha_vencimiento date, p_moneda text,
  p_total numeric, p_concepto text, p_ruta text, p_nombre_archivo text, p_unidad integer)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yo       uuid := public.usuario_actual();
  v_hoy      date := (now() at time zone 'America/Lima')::date;
  v_cot      public.cotizaciones_pdf%rowtype;
  v_unidades integer;
  v_unidad   integer := p_unidad;
  v_codigo   text;
  v_codigos  text[];
  v_con_ot   integer;
  v_numero   text := public.normalizar_numero_factura(p_numero);
  v_obj      storage.objects%rowtype;
  v_cli      text;
  v_otra     text;
  v_concepto text := nullif(btrim(coalesce(p_concepto, '')), '');
begin
  perform public.exigir_permiso('contabilidad.facturar');
  if p_id is null then raise exception 'Vuelve a abrir el formulario de la factura.' using errcode = 'check_violation'; end if;
  -- El mismo envío repetido (la respuesta se perdió) se reconoce por su
  -- archivo y por quién lo anotó; otro envío con el mismo id, no.
  if exists (select 1 from public.facturas_venta where id = p_id) then
    if exists (select 1 from public.facturas_venta
               where id = p_id and ruta_storage = p_ruta and registrado_por = public.usuario_actual()) then
      return p_id;
    end if;
    raise exception 'Esta factura ya quedó registrada la primera vez que la enviaste: recarga la pantalla para ver cómo quedó.' using errcode = 'check_violation';
  end if;
  select * into v_cot from public.cotizaciones_pdf where id = p_cotizacion for share;
  if not found then raise exception 'Esa cotización no existe.' using errcode = 'check_violation'; end if;
  if v_cot.estado::text = 'ANULADA' or not public.cotizacion_fue_aprobada(p_cotizacion) then
    raise exception 'La cotización % no está aprobada por Gerencia: no se factura.', v_cot.numero using errcode = 'check_violation';
  end if;

  -- De qué unidad es. Con una sola unidad no hay nada que elegir.
  v_unidades := v_cot.cantidad_unidades;
  if v_unidades = 1 and coalesce(v_unidad, 0) = 0 then v_unidad := 1; end if;
  if v_unidad is null then
    raise exception 'La cotización % es de % unidades: elige de cuál es la factura, o toda la cotización.', v_cot.numero, v_unidades
      using errcode = 'check_violation';
  end if;
  if v_unidad < 0 or v_unidad > v_unidades then
    raise exception 'La cotización % tiene %: la unidad % no existe.', v_cot.numero,
      case when v_unidades = 1 then 'una sola unidad' else v_unidades || ' unidades' end, v_unidad
      using errcode = 'check_violation';
  end if;
  -- El código de cada unidad: el de su OT vigente.
  select array_agg(x.codigo order by k.unidad), count(x.codigo)::integer
    into v_codigos, v_con_ot
    from generate_series(1, v_unidades) as k(unidad)
    left join lateral (
      select public.normalizar_codigo_interno(u.codigo_interno) as codigo
        from public.ordenes_trabajo o
        join public.unidades u on u.id = o.unidad_id
       where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA'
         and coalesce(o.numero_de_unidad, 1) = k.unidad
         and public.normalizar_codigo_interno(u.codigo_interno) is not null
       order by o.creado_en desc
       limit 1) x on true;
  if v_unidad >= 1 then
    v_codigo := v_codigos[v_unidad];
    if v_codigo is null and v_unidades = 1 then
      raise exception 'La cotización % todavía no tiene código interno: lo pone Administración al cargar la OT.', v_cot.numero
        using errcode = 'check_violation';
    end if;
    if v_codigo is null then
      raise exception 'La unidad % de la cotización % todavía no tiene su OT con código interno: la carga Administración.', v_unidad, v_cot.numero
        using errcode = 'check_violation';
    end if;
  else
    -- Toda la cotización: se reparte entre todas, así que todas tienen que tener su código.
    if v_con_ot < v_unidades then
      raise exception 'La cotización % tiene % de sus % OT: la factura de toda la cotización se registra cuando estén todas. Mientras tanto se factura la unidad que ya tiene su OT.',
        v_cot.numero, v_con_ot, v_unidades using errcode = 'check_violation';
    end if;
    v_codigo := v_codigos[1];
  end if;

  if v_numero is null then
    raise exception 'Escribe el número de la factura como sale en SUNAT: la serie, un guion y el número (E001-626).' using errcode = 'check_violation';
  end if;
  select codigo_interno into v_otra from public.facturas_venta where numero = v_numero and anulada_en is null;
  if found then
    raise exception 'La factura % ya está registrada en el código %.', v_numero, v_otra using errcode = 'unique_violation';
  end if;
  if p_fecha_emision is null or p_fecha_emision > v_hoy or p_fecha_emision < v_hoy - 730 then
    raise exception 'Elige la fecha de emisión de la factura: de hoy hacia atrás.' using errcode = 'check_violation';
  end if;
  if p_fecha_vencimiento is null or p_fecha_vencimiento < p_fecha_emision or p_fecha_vencimiento > p_fecha_emision + 730 then
    raise exception 'El vencimiento va desde la fecha de emisión hasta dos años después.' using errcode = 'check_violation';
  end if;
  if p_moneda is null or p_moneda not in ('PEN', 'USD') then
    raise exception 'Elige la moneda de la factura: soles o dólares.' using errcode = 'check_violation';
  end if;
  if p_total is null or p_total <= 0 or p_total > 999999999 or p_total <> round(p_total, 2) then
    raise exception 'Escribe el total de la factura, con IGV, en dos decimales.' using errcode = 'check_violation';
  end if;
  if v_unidad = 0 and p_total < v_unidades * 0.01 then
    raise exception 'El total no alcanza para repartirlo entre las % unidades de la cotización.', v_unidades using errcode = 'check_violation';
  end if;
  if v_concepto is not null and char_length(v_concepto) not between 2 and 200 then
    raise exception 'El concepto va de 2 a 200 caracteres (por ejemplo, «Inicial 50 %%»).' using errcode = 'check_violation';
  end if;
  v_obj := public.archivo_subido_por_mi('facturas-venta', p_ruta, p_id, array['application/pdf']);

  select razon_social into v_cli from public.clientes where id = v_cot.cliente_id;
  -- Esta factura trae dicho su reparto: el disparador no le pone la parte por omisión.
  perform set_config('metalwork.factura_con_su_reparto', p_id::text, true);
  insert into public.facturas_venta (id, codigo_interno, cotizacion_pdf_id, cotizacion_numero, cliente_id, cliente, numero,
                                     fecha_emision, fecha_vencimiento, moneda, total, concepto, ruta_storage,
                                     nombre_archivo, tamano_bytes, registrado_por)
  values (p_id, v_codigo, p_cotizacion, v_cot.numero, v_cot.cliente_id, coalesce(v_cli, 'Cliente sin registrar'), v_numero,
          p_fecha_emision, p_fecha_vencimiento, p_moneda, p_total, v_concepto, p_ruta,
          left(coalesce(nullif(btrim(p_nombre_archivo), ''), v_numero || '.pdf'), 200),
          (v_obj.metadata->>'size')::integer, v_yo);

  -- El reparto se anota aquí y no se recalcula después.
  if v_unidad >= 1 then
    insert into public.facturas_venta_unidades (factura_id, numero_de_unidad, de_unidades, codigo_interno, monto)
    values (p_id, v_unidad, v_unidades, v_codigo, p_total);
  else
    insert into public.facturas_venta_unidades (factura_id, numero_de_unidad, de_unidades, codigo_interno, monto)
    select p_id, k, v_unidades, v_codigos[k], public.parte_de_unidad(p_total, v_unidades, k)
      from generate_series(1, v_unidades) k;
  end if;

  perform public.notificar_a_permiso('tesoreria.registrar_cobros', 'Factura por cobrar: ' || v_numero,
    coalesce(v_cli, 'Cliente sin registrar') || ' · '
      || case when v_unidad = 0 then 'toda la cotización ' || v_cot.numero || ', ' || v_unidades || ' unidades'
              when v_unidades > 1 then 'código ' || v_codigo || ', unidad ' || v_unidad || ' de ' || v_unidades
              else 'código ' || v_codigo end
      || ' · ' || case when p_moneda = 'USD' then 'US$ ' else 'S/ ' end || to_char(p_total, 'FM999G999G990D00'),
    '/tesoreria/por-cobrar#' || p_id, 'facturas_venta', p_id, v_yo);
  return p_id;
end;
$$;

comment on function public.registrar_factura_venta_de_unidad(uuid, uuid, text, date, date, text, numeric, text, text, text, integer) is
  'Contabilidad registra la factura de venta de una unidad de la cotización (p_unidad = 1, 2, 3…) o de toda la cotización (p_unidad = 0), que se reparte en partes iguales entre sus unidades. Pide contabilidad.facturar. Migración 20261126998000.';

revoke all on function public.registrar_factura_venta_de_unidad(uuid, uuid, text, date, date, text, numeric, text, text, text, integer) from public, anon;
grant execute on function public.registrar_factura_venta_de_unidad(uuid, uuid, text, date, date, text, numeric, text, text, text, integer) to authenticated;

-- La de antes queda para la pestaña abierta desde antes del despliegue: con una
-- unidad registra igual; con varias no sabe de cuál es y pide recargar.
create or replace function public.registrar_factura_venta(p_id uuid, p_cotizacion uuid, p_numero text, p_fecha_emision date, p_fecha_vencimiento date, p_moneda text, p_total numeric, p_concepto text, p_ruta text, p_nombre_archivo text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_numero   text;
  v_unidades integer;
begin
  perform public.exigir_permiso('contabilidad.facturar');
  select c.numero, c.cantidad_unidades into v_numero, v_unidades from public.cotizaciones_pdf c where c.id = p_cotizacion;
  if v_unidades > 1 and not exists (select 1 from public.facturas_venta f where f.id = p_id) then
    raise exception 'La cotización % es de % unidades y ahora la factura dice de cuál es: recarga la pantalla y regístrala de nuevo.', v_numero, v_unidades
      using errcode = 'check_violation';
  end if;
  return public.registrar_factura_venta_de_unidad(p_id, p_cotizacion, p_numero, p_fecha_emision, p_fecha_vencimiento,
                                                  p_moneda, p_total, p_concepto, p_ruta, p_nombre_archivo, 1);
end;
$$;

revoke all on function public.registrar_factura_venta(uuid, uuid, text, date, date, text, numeric, text, text, text) from public, anon;
grant execute on function public.registrar_factura_venta(uuid, uuid, text, date, date, text, numeric, text, text, text) to authenticated;

-- 6. Desde cuándo una OT tiene su código interno --------------------------------------
-- Lo mismo que `codigo_interno_de_cotizacion_desde` (20261126470000), por OT: lo
-- último entre la OT y el código de su unidad, que sale de la bitácora. Ayudante
-- interno: lo llama `facturacion_por_unidad`, que ya exige su permiso.
create or replace function public.codigo_interno_de_ot_desde(p_orden uuid)
returns timestamptz
language sql
stable
security invoker
set search_path to 'public'
as $$
  select greatest(o.creado_en,
                  coalesce((select min(b.creado_en) from public.audit_log b
                             where b.tabla = 'unidades' and b.registro_id = u.id
                               and public.normalizar_codigo_interno(b.datos_despues ->> 'codigo_interno') is not null
                               and (b.accion = 'INSERT'
                                    or public.normalizar_codigo_interno(b.datos_antes ->> 'codigo_interno') is null)),
                           u.creado_en))
    from public.ordenes_trabajo o
    join public.unidades u on u.id = o.unidad_id
   where o.id = p_orden and o.estado <> 'ANULADA'
     and public.normalizar_codigo_interno(u.codigo_interno) is not null;
$$;

comment on function public.codigo_interno_de_ot_desde(uuid) is
  'Desde cuándo una OT vigente tiene código interno: lo último entre la OT y el código de su unidad (bitácora). Ayudante interno.';

revoke all on function public.codigo_interno_de_ot_desde(uuid) from public, anon, authenticated;

-- 7. Lo que Contabilidad tiene por facturar, unidad por unidad -----------------------
-- Una fila por unidad de cada cotización aprobada que se pide. `codigo_interno`
-- y `desde` vienen vacíos mientras la unidad no tenga su OT. `parte` es lo que
-- le toca del total con IGV. Lo facturado y lo cobrado, como en
-- `cotizaciones_para_facturar`: en la moneda de la cotización, y lo de la otra
-- moneda aparte. La misma puerta que esa función.
create or replace function public.facturacion_por_unidad(p_ids uuid[])
returns table (
  cotizacion            uuid,
  unidades              integer,
  numero_de_unidad      integer,
  codigo_interno        text,
  desde                 timestamptz,
  dias                  integer,
  parte                 numeric,
  facturas              integer,
  facturado             numeric,
  cobrado               numeric,
  facturado_otra_moneda numeric,
  cobrado_otra_moneda   numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
rows 100
as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('contabilidad.facturar') or public.tiene_permiso('cotizaciones.ver_aprobadas')) then
    raise exception 'No tienes permiso para ver las cotizaciones aprobadas.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide lo que falta facturar de hasta 500 cotizaciones a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with cot as (
    select c.id, c.cantidad_unidades::integer as unidades, coalesce(c.moneda::text, 'PEN') as moneda,
           case when c.monto_venta is null then null
                when ig.incluye_igv = false then round(c.monto_venta::numeric * 1.18, 2)
                else c.monto_venta::numeric end as total
      from public.cotizaciones_pdf c
      left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id
     where c.id = any(p_ids)
       and c.estado::text <> 'ANULADA' and public.cotizacion_fue_aprobada(c.id)
  ),
  -- Lo facturado vigente de cada unidad, por moneda.
  partes as (
    select p.cotizacion_pdf_id as cot, p.numero_de_unidad as unidad, p.moneda::text as moneda,
           count(*)::integer as facturas, sum(p.monto)::numeric as facturado, sum(p.cobrado)::numeric as cobrado
      from public.v_facturas_venta_por_unidad p
     where p.cotizacion_pdf_id = any(p_ids) and p.anulada_en is null
     group by p.cotizacion_pdf_id, p.numero_de_unidad, p.moneda
  )
  select c.id, c.unidades, k.unidad, ot.codigo, ot.desde, public.dias_en_espera(ot.desde),
         public.parte_de_unidad(c.total, c.unidades, k.unidad),
         coalesce(fx.facturas, 0), coalesce(fx.facturado, 0), coalesce(fx.cobrado, 0),
         coalesce(fx.facturado_otra, 0), coalesce(fx.cobrado_otra, 0)
    from cot c
    cross join lateral generate_series(1, c.unidades) as k(unidad)
    left join lateral (
      select public.normalizar_codigo_interno(u.codigo_interno) as codigo,
             public.codigo_interno_de_ot_desde(o.id) as desde
        from public.ordenes_trabajo o
        join public.unidades u on u.id = o.unidad_id
       where o.cotizacion_pdf_id = c.id and o.estado <> 'ANULADA'
         and coalesce(o.numero_de_unidad, 1) = k.unidad
         and public.normalizar_codigo_interno(u.codigo_interno) is not null
       order by o.creado_en desc
       limit 1) ot on true
    left join lateral (
      select sum(p.facturas)::integer as facturas,
             sum(p.facturado) filter (where p.moneda = c.moneda) as facturado,
             sum(p.cobrado) filter (where p.moneda = c.moneda) as cobrado,
             sum(p.facturado) filter (where p.moneda <> c.moneda) as facturado_otra,
             sum(p.cobrado) filter (where p.moneda <> c.moneda) as cobrado_otra
        from partes p
       where p.cot = c.id and p.unidad = k.unidad) fx on true
   order by c.id, k.unidad;
end;
$$;

comment on function public.facturacion_por_unidad(uuid[]) is
  'De cada cotización aprobada que se pide, una fila por unidad: su código interno y desde cuándo lo tiene su OT (vacíos sin OT), lo que le toca del total con IGV, y lo facturado y cobrado de esa unidad, en la moneda de la cotización y en la otra. Lo lee quien lee las cotizaciones aprobadas. Migración 20261126998000.';

revoke all on function public.facturacion_por_unidad(uuid[]) from public, anon;
grant execute on function public.facturacion_por_unidad(uuid[]) to authenticated;

-- 8. El globo del menú cuenta lo mismo que la lista -----------------------------------
-- «Por facturar» contaba cotizaciones. La lista de Facturación pasa a tener una
-- fila por unidad con su OT, porque cada una lleva su factura: el globo cuenta
-- las mismas. Con una unidad por cotización da lo de antes. La cotización sin
-- moneda cuenta como en soles, igual que `cotizaciones_para_facturar` y la
-- pantalla (antes aquí se comparaba con la moneda vacía). Lo de Tesorería queda igual.
create or replace function public.facturacion_pendientes()
returns table (por_facturar integer, por_cobrar integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  return query select
    case when public.es_admin() or public.tiene_permiso('contabilidad.facturar') then
      (select count(*)::integer
         from public.cotizaciones_pdf c
         left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id
         -- Cada unidad que ya tiene su OT con código interno.
         join lateral (
           select distinct coalesce(o.numero_de_unidad, 1) as unidad
             from public.ordenes_trabajo o
             join public.unidades u on u.id = o.unidad_id
            where o.cotizacion_pdf_id = c.id and o.estado <> 'ANULADA'
              and public.normalizar_codigo_interno(u.codigo_interno) is not null) ot on true
         left join lateral (
           select count(*) as facturas,
                  coalesce(sum(p.monto) filter (where f.moneda::text = coalesce(c.moneda::text, 'PEN')), 0) as en_su_moneda,
                  coalesce(bool_or(f.moneda::text <> coalesce(c.moneda::text, 'PEN')), false) as en_otra_moneda
             from public.facturas_venta_unidades p
             join public.facturas_venta f on f.id = p.factura_id
            where f.cotizacion_pdf_id = c.id and f.anulada_en is null
              and p.numero_de_unidad = ot.unidad) fx on true
        where c.estado::text <> 'ANULADA' and public.cotizacion_fue_aprobada(c.id)
          and (fx.facturas = 0
               or (c.monto_venta is not null and not fx.en_otra_moneda
                   and fx.en_su_moneda < public.parte_de_unidad(
                         case when ig.incluye_igv = false then round(c.monto_venta::numeric * 1.18, 2)
                              else c.monto_venta::numeric end,
                         c.cantidad_unidades::integer, ot.unidad) - 0.005)))
    end,
    case when public.es_admin() or public.tiene_permiso('tesoreria.registrar_cobros') then
      (select count(*)::integer from public.facturas_venta f
        where f.anulada_en is null
          and not exists (select 1 from public.cobros_factura_venta b
                           where b.factura_id = f.id and b.anulado_en is null and b.cancela))
    end;
end;
$$;

-- 9. Lo vendido y lo facturado de un código: lo de su unidad --------------------------
-- Tomaba la cotización solo si su OT más nueva era de este código, y daba el
-- total y lo facturado de toda la cotización: con tres unidades, dos códigos
-- salían sin cotización y el tercero con la venta de las tres. Ahora toma la
-- cotización si alguna de sus OT vigentes es de este código, y da lo de esa
-- unidad: su parte de la venta y lo facturado que le toca.
-- Con varias unidades y el monto sin IGV, `monto_venta` ya trae la parte con
-- IGV y `incluye_igv` viene en verdadero: partir primero y sumar el 18 % después
-- podía dejar un centavo de diferencia con lo facturado. Con una unidad, todo
-- sale como antes.
create or replace function public.codigo_interno_lo_vendido(p_codigo text)
returns table (
  cotizacion_id          uuid,
  numero                 text,
  moneda                 text,
  monto_venta            numeric,
  incluye_igv            boolean,
  facturas               integer,  -- las vigentes
  facturado_en_su_moneda numeric,  -- lo facturado en la moneda de la cotización
  en_otra_moneda         boolean   -- alguna factura vigente va en otra moneda
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_codigo constant text := public.normalizar_codigo_interno(p_codigo);
begin
  if not (public.es_admin() or public.tiene_permiso('contabilidad.facturar') or public.tiene_permiso('cotizaciones.ver_aprobadas')) then
    raise exception 'No tienes permiso para ver las cotizaciones aprobadas.' using errcode = 'insufficient_privilege';
  end if;
  if v_codigo is null then
    return;
  end if;

  return query
  select c.id, c.numero::text, c.moneda::text,
         case when c.cantidad_unidades = 1 or c.monto_venta is null then c.monto_venta::numeric
              else public.parte_de_unidad(
                     case when ig.incluye_igv = false then round(c.monto_venta::numeric * 1.18, 2) else c.monto_venta::numeric end,
                     c.cantidad_unidades::integer, ot.unidad) end,
         case when c.cantidad_unidades > 1 and ig.incluye_igv = false then true else ig.incluye_igv end,
         coalesce(fx.facturas, 0), coalesce(fx.en_su_moneda, 0), coalesce(fx.otra, false)
    from public.cotizaciones_pdf c
    left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id
    -- La unidad de la cotización que lleva este código: la de su OT vigente.
    join lateral (
      select coalesce(o.numero_de_unidad, 1) as unidad
        from public.ordenes_trabajo o
        join public.unidades u on u.id = o.unidad_id
       where o.cotizacion_pdf_id = c.id and o.estado <> 'ANULADA'
         and public.normalizar_codigo_interno(u.codigo_interno) = v_codigo
       order by o.creado_en desc
       limit 1) ot on true
    left join lateral (
      select count(*)::integer as facturas,
             sum(p.monto) filter (where f.moneda::text = c.moneda::text)::numeric as en_su_moneda,
             bool_or(f.moneda::text <> c.moneda::text) as otra
        from public.facturas_venta_unidades p
        join public.facturas_venta f on f.id = p.factura_id
       where f.cotizacion_pdf_id = c.id and f.anulada_en is null
         and p.numero_de_unidad = ot.unidad) fx on true
   where c.estado::text <> 'ANULADA'
     and public.cotizacion_fue_aprobada(c.id)
   order by c.creado_en;
end;
$$;

comment on function public.codigo_interno_lo_vendido(text) is
  'Lo vendido y lo facturado de cada cotización aprobada de un código: la parte de la unidad que lleva ese código y lo facturado de esa unidad. Sin tope. La misma puerta que cotizaciones_para_facturar. Plan 12, entrega 12.3; por unidad desde la 20261126998000.';

revoke all on function public.codigo_interno_lo_vendido(text) from public, anon;
grant execute on function public.codigo_interno_lo_vendido(text) to authenticated;
