-- =============================================================================
-- UNA COTIZACIÓN DE VARIAS UNIDADES: UNA OT POR CADA UNA
-- -----------------------------------------------------------------------------
-- Ventas preguntó el 2026-11-26: «hay una cotización con tres camabajas, ¿se
-- puede anexar a tres diferentes OT o se tiene que subir la cotización tres
-- veces?». Hasta aquí no se podía de ninguna de las dos maneras: la base
-- dejaba una sola OT vigente por cotización (`uq_orden_por_cotizacion_pdf`) y
-- el número de cotización no se repite (`uq_cotizacion_pdf_numero`). Había que
-- inventar tres números de cotización o hacer dos OT sin cotización.
--
-- Pero en el taller cada camabaja es una unidad: su código interno, su OT con el
-- número de su papel, sus planos, su costo y su entrega. Lo que es uno solo es
-- el papel que se le mandó al cliente. Desde aquí:
--
--   Ventas sube UNA cotización y dice cuántas unidades lleva (por omisión, 1)
--   → Gerencia la aprueba con un toque, como siempre → Administración carga
--   una OT por unidad desde la misma tarjeta, cada una con su código interno,
--   su número y su PDF, todo junto o nada. La tarjeta sigue esperando a
--   Administración hasta que estén todas.
--
-- Reglas:
--   · `cantidad_unidades` va de 1 a 50. La cotización de una unidad se porta
--     exactamente como antes: las 21 que ya existen quedan con 1.
--   · No hay más OT vigentes que unidades. Lo vigila un disparador de la OT,
--     que reemplaza al índice único y vale para cualquier camino que cree o
--     mueva una OT. Una OT anulada libera su lugar.
--   · Cada unidad lleva su propio código: dos OT vigentes de la misma
--     cotización no comparten código interno.
--   · Cada OT guarda qué unidad es (`ordenes_trabajo.numero_de_unidad`): si se
--     anula la OT de la unidad 2, la que se carga después es la unidad 2, no la
--     «unidad 3» repetida. Las OT de antes no lo tienen y valen como unidad 1.
--   · Ventas cambia la cantidad solo con una corrección (vuelve a Gerencia), y
--     nunca por debajo de las OT que ya tiene.
--   · El precio de cada unidad es el total entre las unidades: el margen de cada
--     OT y la venta de cada código interno usan su parte, no el total. Antes,
--     con tres OT, cada una habría salido con el total de las tres.
--
-- Fuera de esta entrega (van en la siguiente, con Contabilidad): la factura por
-- unidad y el recorrido con un paso por OT. Mientras tanto, una factura de una
-- cotización de varias unidades se cuelga del código de su última OT, como hoy.
--
-- Las funciones que se reescriben aquí se compararon con las de producción el
-- 2026-11-26: `cargar_codigo_y_ot_de_cotizacion`, a la de la `20261126330000`
-- (la OT se carga sin fecha; está en el PR de Administración y ya en
-- producción); `fn_cotizacion_pdf_revision`, a la de la `20261027200000`;
-- `margen_ot`, a la de la `20261001170000`; `codigos_internos_costo_calculado`,
-- a la de la `20261017300000`; y `fn_cotizacion_pdf_avisa`, a la de la
-- `20261126450000`. Cada una se reemplaza solo si sigue siendo esa (la guarda
-- de la huella, abajo). La vista `v_cotizaciones_pdf` conserva sus columnas en
-- el mismo orden y suma las nuevas al final.
--
-- Lo que ya existe —cotizaciones, OT y códigos— queda como está: nada se borra.
-- =============================================================================

-- 0. La guarda de la huella -----------------------------------------------------
-- Cinco funciones se reemplazan enteras. Si en producción alguna se cambió a
-- mano después del 2026-11-26, reemplazarla borraría ese cambio sin que nadie
-- lo note: la migración se detiene antes de tocar nada. Cada una acepta la
-- huella de la versión que conoce el repositorio y la de esta migración, para
-- que volver a correrla no falle.
do $$
declare
  f record;
  huella text;
begin
  for f in
    select * from (values
      ('public.cargar_codigo_y_ot_de_cotizacion(uuid,uuid,text,text,public.tipo_unidad_carroceria,date,text,text,bigint,text,text)',
       -- La de la 20261027200000 (el repositorio sin la 20261126330000), la de la
       -- 20261126330000 (producción) y esta.
       array['77d669c649a269f92309f2218384a0ff', '0b3b1cba7983f9dfbbb7caaf16210151', '3bdadf68ef26b720306de09e914c64a8']),
      ('public.fn_cotizacion_pdf_revision()', array['8193153f0b3a50318c24251b2a507bf8', '70b788744ae098bf2a05b19e988de199']),
      -- La de la 20261001170000 con y sin sus comentarios (producción los perdió) y esta.
      ('public.margen_ot(uuid)', array['428f4a211325f86f7ab1b25a00987245', '0a852aba120e59362ad6ba63c6ab53de', '088e295d4723fba20ca7236eb322de0d']),
      ('public.codigos_internos_costo_calculado(text)', array['e2fe09bb42d5872932489360fe533d20', '22510d6d4ab2a8494ee1488ca425f88f']),
      ('public.fn_cotizacion_pdf_avisa()', array['899ecdee38949ebf55c6c4979e53b796', '17d327b8fcd95d8d051823d840c5e34f'])
    ) as t(firma, conocidas)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into huella from pg_proc p where p.oid = to_regprocedure(f.firma);
    if huella is null then
      raise exception 'Falta la función %: esta base no tiene las migraciones anteriores.', f.firma;
    end if;
    if not (huella = any (f.conocidas)) then
      raise exception 'La función % no es la que conoce el repositorio (se cambió a mano): no se reemplaza. Avisa antes de seguir.', f.firma;
    end if;
  end loop;
end $$;

-- 1. Cuántas unidades lleva la cotización ---------------------------------------
alter table public.cotizaciones_pdf
  add column if not exists cantidad_unidades smallint not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_cotizacion_pdf_cantidad_unidades') then
    alter table public.cotizaciones_pdf
      add constraint ck_cotizacion_pdf_cantidad_unidades check (cantidad_unidades between 1 and 50);
  end if;
end $$;

comment on column public.cotizaciones_pdf.cantidad_unidades is
  'Cuántas unidades (camabajas, furgones…) lleva la cotización: Administración carga una OT por cada una (migración 20261126700000).';

-- Qué unidad de su cotización es cada OT. Sin relleno: las OT de antes son de
-- cotizaciones de una unidad y se leen como la 1 (`coalesce(…, 1)`), y una OT
-- anulada no acepta un UPDATE.
alter table public.ordenes_trabajo
  add column if not exists numero_de_unidad smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_ot_numero_de_unidad') then
    alter table public.ordenes_trabajo
      add constraint ck_ot_numero_de_unidad check (numero_de_unidad between 1 and 50);
  end if;
end $$;

comment on column public.ordenes_trabajo.numero_de_unidad is
  'Qué unidad de su cotización es (1, 2, 3…); null en las de antes, que valen como la 1 (migración 20261126700000).';

-- Dos OT vigentes no son la misma unidad de la misma cotización. Con una unidad,
-- es el mismo «una OT por cotización» de antes.
create unique index if not exists uq_ot_unidad_de_cotizacion
  on public.ordenes_trabajo (cotizacion_pdf_id, (coalesce(numero_de_unidad, 1)))
  where cotizacion_pdf_id is not null and estado <> 'ANULADA';

-- 2. Las OT vigentes de una cotización, para quien ve la cotización --------------
-- Corre como dueña: el código interno de cada OT lo ve todo el que ve la
-- cotización (como `codigo_interno_de_cotizacion`), y el número y el estado de
-- la OT, solo quien ve las órdenes. Así la cuenta de OT cargadas es la misma
-- para todos, y nadie ve «faltan 3» porque no lee las órdenes.
create or replace function public.ordenes_de_cotizacion(p_cotizacion uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', case when v.ve then o.id end,
           'numero', case when v.ve then o.numero end,
           'estado', case when v.ve then o.estado::text end,
           'codigo_interno', public.normalizar_codigo_interno(u.codigo_interno),
           'unidad', coalesce(o.numero_de_unidad, 1))
         order by coalesce(o.numero_de_unidad, 1), o.creado_en), '[]'::jsonb)
    from public.ordenes_trabajo o
    left join public.unidades u on u.id = o.unidad_id
    cross join (select public.es_admin() or public.tiene_permiso('ordenes.ver') as ve) v
   where o.cotizacion_pdf_id = p_cotizacion
     and o.estado <> 'ANULADA';
$$;

comment on function public.ordenes_de_cotizacion(uuid) is
  'Las OT vigentes de la cotización, por su número de unidad, con su código interno; el id, el número y el estado solo para quien ve las órdenes (migración 20261126700000).';

revoke all on function public.ordenes_de_cotizacion(uuid) from public, anon;
grant execute on function public.ordenes_de_cotizacion(uuid) to authenticated;

-- 3. No hay más OT vigentes que unidades ------------------------------------------
-- Reemplaza al índice único `uq_orden_por_cotizacion_pdf`. Bloquea la fila de la
-- cotización antes de contar: dos cargas a la vez de la misma cotización se
-- ponen en fila, y la segunda cuenta la primera.
create or replace function public.fn_ot_cabe_en_su_cotizacion()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cantidad  integer;
  v_numero    text;
  v_vigentes  integer;
  v_otra      text;
begin
  if new.cotizacion_pdf_id is null or new.estado = 'ANULADA' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.cotizacion_pdf_id is not distinct from new.cotizacion_pdf_id
     and old.estado <> 'ANULADA' then
    return new;
  end if;

  select c.cantidad_unidades, c.numero into v_cantidad, v_numero
    from public.cotizaciones_pdf c
   where c.id = new.cotizacion_pdf_id
     for update;
  if not found then
    return new;  -- la llave foránea lo dice
  end if;

  select count(*), min(o.numero) into v_vigentes, v_otra
    from public.ordenes_trabajo o
   where o.cotizacion_pdf_id = new.cotizacion_pdf_id
     and o.estado <> 'ANULADA'
     and o.id <> new.id;

  if v_vigentes >= v_cantidad then
    if v_cantidad = 1 then
      raise exception 'La cotización % ya tiene su OT %.', v_numero, v_otra using errcode = 'unique_violation';
    end if;
    raise exception 'La cotización % es de % unidades y ya tiene sus % OT. Si lleva otra unidad, Ventas sube la corrección con la cantidad.',
      v_numero, v_cantidad, v_vigentes using errcode = 'unique_violation';
  end if;
  -- Cada unidad, su código: también para la OT que se cuelga de la cotización
  -- por fuera de la carga (un UPDATE de `cotizacion_pdf_id`).
  select o.numero into v_otra
    from public.ordenes_trabajo o
    join public.unidades u on u.id = o.unidad_id
    join public.unidades n on n.id = new.unidad_id
   where o.cotizacion_pdf_id = new.cotizacion_pdf_id and o.estado <> 'ANULADA' and o.id <> new.id
     and public.normalizar_codigo_interno(u.codigo_interno) = public.normalizar_codigo_interno(n.codigo_interno)
   limit 1;
  if v_otra is not null then
    raise exception 'Esa unidad ya es la de la OT % de la cotización %: cada unidad lleva su propio código.', v_otra, v_numero
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_ot_cabe_en_su_cotizacion() from public, anon, authenticated;

create or replace trigger trg_ot_cabe_en_su_cotizacion
  before insert or update of cotizacion_pdf_id, estado on public.ordenes_trabajo
  for each row execute function public.fn_ot_cabe_en_su_cotizacion();

drop index if exists public.uq_orden_por_cotizacion_pdf;

-- 4. La cantidad no baja de las OT que ya tiene -----------------------------------
create or replace function public.fn_cotizacion_pdf_unidades_alcanzan()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_vigentes integer;
  v_mayor    integer;
  v_ot       text;
begin
  if new.cantidad_unidades is not distinct from old.cantidad_unidades then
    return new;
  end if;
  select count(*), max(coalesce(o.numero_de_unidad, 1)) into v_vigentes, v_mayor
    from public.ordenes_trabajo o
   where o.cotizacion_pdf_id = new.id and o.estado <> 'ANULADA';
  if new.cantidad_unidades < v_vigentes then
    raise exception 'La cotización % ya tiene % OT: no puede quedar con % %. Si sobra una unidad, Administración anula primero su OT.',
      old.numero, v_vigentes, new.cantidad_unidades,
      case when new.cantidad_unidades = 1 then 'unidad' else 'unidades' end
      using errcode = 'check_violation';
  end if;
  -- Con la 2 anulada y la 3 vigente, quedar en 2 dejaría a la 3 fuera de la cuenta.
  if new.cantidad_unidades < v_mayor then
    select o.numero into v_ot from public.ordenes_trabajo o
     where o.cotizacion_pdf_id = new.id and o.estado <> 'ANULADA' and coalesce(o.numero_de_unidad, 1) = v_mayor
     limit 1;
    raise exception 'La OT % es la unidad % de la cotización %: no puede quedar con % unidades.',
      v_ot, v_mayor, old.numero, new.cantidad_unidades using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_cotizacion_pdf_unidades_alcanzan() from public, anon, authenticated;

create or replace trigger trg_cotizacion_pdf_unidades_alcanzan
  before update of cantidad_unidades on public.cotizaciones_pdf
  for each row execute function public.fn_cotizacion_pdf_unidades_alcanzan();

-- 5. La corrección de Ventas admite la cantidad -----------------------------------
-- La misma revisión de la `20261027200000`, con `cantidad_unidades` entre los
-- datos comerciales que una corrección puede cambiar. Sin archivo nuevo, la
-- cantidad no cambia: «adjunta una nueva versión e indica el motivo».
create or replace function public.fn_cotizacion_pdf_revision()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_revisa constant boolean := public.es_admin() or public.tiene_permiso('cotizaciones.revisar');
  v_autor boolean;
  v_cambia boolean;
  v_archivo_nuevo boolean;
  v_ignorar constant text[] := array['estado','observacion','revisado_por','revisado_en','actualizado_en'];
  v_campos_correccion constant text[] := array[
    'cliente_id','tipo_carroceria_id','nombre_archivo','ruta_storage','mime_type',
    'tamano_bytes','monto_venta','moneda','motivo_correccion','estado','observacion',
    'revisado_por','revisado_en','version','archivo_subido_en','actualizado_en','cantidad_unidades'
  ];
begin
  if tg_op = 'INSERT' then
    new.estado := 'POR_REVISAR';
    new.observacion := null;
    new.revisado_por := null;
    new.revisado_en := null;
    new.version := 1;
    new.archivo_subido_en := now();
    return new;
  end if;

  v_autor := public.es_admin() or old.registrado_por = public.usuario_actual();
  v_archivo_nuevo := new.ruta_storage is distinct from old.ruta_storage;
  new.numero := old.numero;
  new.registrado_por := old.registrado_por;
  new.version := old.version;
  new.archivo_subido_en := case when v_archivo_nuevo then now() else old.archivo_subido_en end;

  if v_archivo_nuevo then
    if not v_autor or not public.tiene_permiso('cotizaciones.crear') then
      raise exception 'Solo quien registró la cotización puede subir su corrección.' using errcode = 'insufficient_privilege';
    end if;
    if old.estado = 'ANULADA' then
      raise exception 'Una cotización anulada no se puede corregir.';
    end if;
    if length(btrim(coalesce(new.motivo_correccion,''))) < 5 then
      raise exception 'Indica por qué corriges la cotización.';
    end if;
    if (to_jsonb(new) - v_campos_correccion) is distinct from (to_jsonb(old) - v_campos_correccion) then
      raise exception 'La corrección solo admite datos comerciales y el archivo; no cambia la identidad de la cotización.';
    end if;
    new.version := old.version + 1;
    new.estado := 'POR_REVISAR';
    new.observacion := null;
    new.revisado_por := null;
    new.revisado_en := null;
    return new;
  end if;

  if new.estado is distinct from old.estado or new.observacion is distinct from old.observacion then
    if not v_revisa then
      raise exception 'No tienes permiso para aprobar ni rechazar la cotización.' using errcode = 'insufficient_privilege';
    end if;
    if new.estado in ('APROBADA','RECHAZADA') and old.estado <> 'POR_REVISAR' then
      raise exception 'Gerencia solo revisa una versión pendiente; Ventas debe subir una corrección primero.';
    end if;
    if new.estado = 'POR_REVISAR' then
      new.revisado_por := null;
      new.revisado_en := null;
    else
      new.revisado_por := public.usuario_actual();
      new.revisado_en := now();
    end if;
  else
    new.revisado_por := old.revisado_por;
    new.revisado_en := old.revisado_en;
  end if;

  v_cambia := (to_jsonb(new) - v_ignorar) is distinct from (to_jsonb(old) - v_ignorar);
  if v_cambia then
    raise exception 'Para corregir la cotización %, adjunta una nueva versión e indica el motivo.', old.numero;
  end if;
  return new;
end;
$function$;

revoke all on function public.fn_cotizacion_pdf_revision() from public, anon, authenticated;

-- 6. Administración carga una OT por unidad ---------------------------------------
-- La carga de la `20261027200000`, con tres cambios: deja cargar hasta
-- `cantidad_unidades` OT (antes, una), no deja repetir en la misma cotización el
-- código de otra de sus OT, y la OT dice qué unidad es («unidad 2 de 3»).
create or replace function public.cargar_codigo_y_ot_de_cotizacion(
  p_cotizacion     uuid,
  p_orden          uuid,
  p_codigo_interno text,
  p_numero_ot      text,
  p_tipo_unidad    public.tipo_unidad_carroceria,
  p_fecha_entrega  date,
  p_ruta_pdf       text,
  p_nombre_pdf     text,
  p_tamano_pdf     bigint,
  p_marca          text default null,
  p_modelo         text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cot      record;
  v_codigo   constant text := public.normalizar_codigo_interno(p_codigo_interno);
  v_clave    constant text := upper(regexp_replace(coalesce(p_codigo_interno, ''), '[^A-Za-z0-9]', '', 'g'));
  v_crudo    constant text := btrim(coalesce(p_numero_ot, ''));
  v_cifras   text;
  v_anio     text;
  v_numero   text;
  v_otra     text;
  v_vigentes integer;
  v_unidad   uuid;
  v_ajena    text;
  v_sede     uuid;
  v_tipo     constant text := case p_tipo_unidad when 'SEMIRREMOLQUE' then 'Semirremolque'
                                                 when 'CARROCERIA_MONTADA' then 'Carrocería montada' end;
  v_enlace   text;
  v_cual     text;
  v_n        integer;
begin
  if public.usuario_actual() is not null and not (public.es_admin() or public.tiene_permiso('ordenes.crear')) then
    raise exception 'No tienes permiso para dar el código interno ni subir la OT de la cotización.'
      using errcode = 'insufficient_privilege';
  end if;

  select c.*, tc.nombre as carroceria, cl.razon_social as cliente
    into v_cot
    from public.cotizaciones_pdf c
    join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
    left join public.clientes cl on cl.id = c.cliente_id
   where c.id = p_cotizacion
     for update of c;
  if v_cot.id is null then
    raise exception 'No se encontró la cotización.' using errcode = 'foreign_key_violation';
  end if;
  if v_cot.estado = 'POR_REVISAR' then
    raise exception 'La cotización % todavía no está aprobada: su código y su OT se cargan cuando se apruebe.', v_cot.numero
      using errcode = 'check_violation';
  end if;
  if v_cot.estado = 'RECHAZADA' then
    raise exception 'La cotización % está rechazada: Ventas sube la corrección y vuelve a aprobarse.', v_cot.numero
      using errcode = 'check_violation';
  end if;
  if v_cot.estado <> 'APROBADA' then
    raise exception 'La cotización % está anulada: no lleva OT.', v_cot.numero using errcode = 'check_violation';
  end if;

  -- La misma carga otra vez (la respuesta se perdió y la pantalla pregunta de
  -- nuevo con la misma OT): con una unidad la frenaba «ya tiene su OT»; con
  -- varias, la carga siguiente cabe y la frenaría su propio código. Se dice
  -- como duplicado, y la acción reconoce que es la suya por el id, que nace en
  -- ese envío, y por quién la creó.
  if exists (select 1 from public.ordenes_trabajo where id = p_orden) then
    raise exception 'Esa OT ya quedó registrada la primera vez que la enviaste.' using errcode = 'unique_violation';
  end if;

  select count(*), min(o.numero) into v_vigentes, v_otra
    from public.ordenes_trabajo o
   where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA';
  if v_vigentes >= v_cot.cantidad_unidades then
    if v_cot.cantidad_unidades = 1 then
      raise exception 'La cotización % ya tiene su OT %.', v_cot.numero, v_otra
        using errcode = 'unique_violation';
    end if;
    raise exception 'La cotización % es de % unidades y ya tiene sus % OT.', v_cot.numero, v_cot.cantidad_unidades, v_vigentes
      using errcode = 'unique_violation';
  end if;

  -- El código interno: obligatorio, y el de una unidad, no PLANTA.
  if v_codigo is null then
    raise exception 'Escribe el código interno que tendrá la unidad.' using errcode = 'check_violation';
  end if;
  if v_clave = '' then
    raise exception 'El código interno debe tener letras o números.' using errcode = 'check_violation';
  end if;
  if char_length(v_codigo) > 40 then
    raise exception 'El código interno no pasa de 40 caracteres.' using errcode = 'check_violation';
  end if;
  if v_clave = 'PLANTA' then
    raise exception 'PLANTA no es una unidad: escribe el código interno de la unidad que se fabrica.'
      using errcode = 'check_violation';
  end if;
  -- Cada unidad de la cotización, su propio código.
  select o.numero into v_otra
    from public.ordenes_trabajo o
    join public.unidades u on u.id = o.unidad_id
   where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA'
     and upper(regexp_replace(coalesce(u.codigo_interno, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
   limit 1;
  if found then
    raise exception 'El código % ya es de la OT % de esta cotización: cada unidad lleva su propio código.', v_codigo, v_otra
      using errcode = 'check_violation';
  end if;

  -- El número de la OT es el que trae su papel: 2922, o 2922-2026.
  if v_crudo ~ '^\d{1,6}$' then
    v_cifras := v_crudo;
    v_anio := to_char((now() at time zone 'America/Lima')::date, 'YYYY');
  elsif v_crudo ~ '^\d{1,6}-\d{4}$' then
    v_cifras := split_part(v_crudo, '-', 1);
    v_anio := split_part(v_crudo, '-', 2);
  else
    raise exception 'El número de la OT es el que trae su papel: 2922 o 2922-2026.' using errcode = 'check_violation';
  end if;
  v_cifras := ltrim(v_cifras, '0');
  if v_cifras = '' then
    raise exception 'El número de la OT es el que trae su papel: 2922 o 2922-2026.' using errcode = 'check_violation';
  end if;
  v_numero := (case when char_length(v_cifras) < 4 then lpad(v_cifras, 4, '0') else v_cifras end) || '-' || v_anio;
  if exists (select 1 from public.ordenes_trabajo where numero = v_numero) then
    raise exception 'Ya hay una OT %: revisa el número de su papel.', v_numero using errcode = 'unique_violation';
  end if;

  if p_tipo_unidad is null then
    raise exception 'Elige si es un semirremolque o una carrocería montada.' using errcode = 'check_violation';
  end if;
  -- Sin fecha de entrega la OT se carga igual (migración 20261126330000): queda
  -- en «Por completar», arriba de la lista de OT, hasta que se la ponga.
  if p_ruta_pdf is null or p_ruta_pdf <> 'ot/' || p_orden::text || '/' || split_part(p_ruta_pdf, '/', 3)
     or split_part(p_ruta_pdf, '/', 3) = '' then
    raise exception 'El PDF de la OT no llegó en su sitio: vuelve a elegirlo.' using errcode = 'check_violation';
  end if;

  -- La unidad: la que ya lleva ese código y es de este cliente (o de nadie), o
  -- una nueva. Un código de otro cliente no se toma.
  select u.id into v_unidad
    from public.unidades u
   where upper(regexp_replace(coalesce(u.codigo_interno, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
     and (u.cliente_id = v_cot.cliente_id or u.cliente_id is null)
   order by (u.cliente_id is not null) desc, u.creado_en desc
   limit 1;
  if v_unidad is null then
    select coalesce(cl.razon_social, 'otro cliente') into v_ajena
      from public.unidades u
      left join public.clientes cl on cl.id = u.cliente_id
     where upper(regexp_replace(coalesce(u.codigo_interno, ''), '[^A-Za-z0-9]', '', 'g')) = v_clave
     limit 1;
    if v_ajena is not null then
      raise exception 'El código interno % ya es de una unidad de %: elige otro.', v_codigo, v_ajena
        using errcode = 'unique_violation';
    end if;
    insert into public.unidades (cliente_id, codigo_interno, tipo_vehiculo, marca, modelo)
    values (v_cot.cliente_id, v_codigo,
            case p_tipo_unidad when 'SEMIRREMOLQUE' then 'SEMIRREMOLQUE' else 'CAMION' end::public.tipo_vehiculo,
            nullif(btrim(p_marca), ''), nullif(btrim(p_modelo), ''))
    returning id into v_unidad;
  else
    update public.unidades set cliente_id = v_cot.cliente_id where id = v_unidad and cliente_id is null;
  end if;

  -- Qué unidad de la cotización es: la primera que no tiene OT vigente (si se
  -- anuló la de la 2, esta es la 2). Solo se dice cuando lleva más de una.
  select min(k) into v_n
    from generate_series(1, v_cot.cantidad_unidades) k
   where not exists (select 1 from public.ordenes_trabajo o
                      where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA'
                        and coalesce(o.numero_de_unidad, 1) = k);
  v_cual := case when v_cot.cantidad_unidades > 1
                 then format('unidad %s de %s', v_n, v_cot.cantidad_unidades) end;

  -- La OT nace aprobada, con su PDF: Gerencia ya aprobó su cotización.
  v_sede := coalesce(public.mi_sede(), (select id from public.sedes where activo order by nombre limit 1));
  insert into public.ordenes_trabajo (id, numero, cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo,
                                      prioridad, descripcion, fecha_entrega_comprometida, estado, cotizacion_pdf_id, tipo_unidad,
                                      numero_de_unidad)
  values (p_orden, v_numero, v_cot.cliente_id, v_unidad, v_cot.tipo_carroceria_id, v_sede, 'FABRICACION',
          'NORMAL', concat_ws(' · ', v_cot.carroceria, v_tipo, 'cotización ' || v_cot.numero, v_cual), p_fecha_entrega,
          'APROBADA', p_cotizacion, p_tipo_unidad, v_n);
  update public.series_documentarias
     set correlativo_actual = greatest(correlativo_actual, v_cifras::bigint)
   where tipo = 'ORDEN_TRABAJO' and (sede_id is null or sede_id = v_sede) and correlativo_actual < v_cifras::bigint;
  insert into public.ot_adjuntos (orden_id, tipo, nombre_archivo, ruta_storage, mime_type, tamano_bytes, subido_por)
  values (p_orden, 'ORDEN', coalesce(nullif(btrim(p_nombre_pdf), ''), 'orden.pdf'), p_ruta_pdf, 'application/pdf',
          p_tamano_pdf, public.usuario_actual());

  -- Los avisos: Diseño y el taller como cuando aprobaba Gerencia, y Ventas, que
  -- desde aquí recibe el código aparte de la aprobación.
  v_enlace := '/diseno/codigo?codigo='
    || replace(replace(replace(replace(replace(replace(v_codigo, '%', '%25'), '&', '%26'), '#', '%23'), '+', '%2B'), '/', '%2F'), ' ', '+');
  perform public.notificar_a_permiso(
    'diseno.codigos',
    'Código nuevo con su OT',
    format('%s: OT %s, %s (%s) de %s Entrega prometida: %s. Carga sus planos, materiales y etapas.',
           v_codigo, v_numero, v_cot.carroceria, lower(v_tipo), public.con_punto_final(coalesce(v_cot.cliente, 'un cliente')),
           coalesce(to_char(p_fecha_entrega, 'DD/MM/YYYY'), 'por definir')),
    v_enlace, 'ordenes_trabajo', p_orden, public.usuario_actual());
  perform public.notificar_a_permiso(
    'produccion.actividades',
    'Código nuevo en el taller',
    format('%s: %s, %s. Diseño cargará sus planos y etapas.', v_codigo, v_cot.carroceria, lower(v_tipo)),
    '/planos', 'ordenes_trabajo', p_orden, public.usuario_actual());
  perform public.notificar_a_usuario(
    v_cot.registrado_por,
    'Tu cotización ya tiene su código',
    case when v_cual is null
         then format('La %s de %s quedó con el código interno %s y la OT %s.',
                     v_cot.numero, coalesce(v_cot.cliente, 'un cliente'), v_codigo, v_numero)
         else format('La %s de %s: la %s quedó con el código interno %s y la OT %s.%s',
                     v_cot.numero, coalesce(v_cot.cliente, 'un cliente'), v_cual, v_codigo, v_numero,
                     case when v_cot.cantidad_unidades - v_vigentes - 1 = 0 then ' Ya están todas.'
                          when v_cot.cantidad_unidades - v_vigentes - 1 = 1 then ' Falta 1.'
                          else format(' Faltan %s.', v_cot.cantidad_unidades - v_vigentes - 1) end) end,
    '/cotizaciones/pdf', 'cotizaciones_pdf', p_cotizacion, public.usuario_actual());

  return p_orden;
end;
$$;

comment on function public.cargar_codigo_y_ot_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text) is
  'Administración (ordenes.crear) da el código interno de una unidad y sube el PDF de su OT, de una cotización ya aprobada, todo junto o nada; una OT por unidad hasta cantidad_unidades (migraciones 20261027200000 y 20261126700000).';

revoke all on function public.cargar_codigo_y_ot_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text)
  from public, anon;
grant execute on function public.cargar_codigo_y_ot_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text)
  to authenticated;

-- 7. La lista de cotizaciones dice cuántas unidades y qué OT tiene cada una -------
-- Las columnas de siempre, en su orden; al final, la cantidad, las OT vigentes
-- (`ordenes_de_cotizacion`) y cuántas faltan cargar. `orden_id`, `orden_numero`
-- y `codigo_interno` siguen siendo los de una OT, para lo que ya los lee.
create or replace view public.v_cotizaciones_pdf
with (security_invoker = on) as
select c.id,
       c.numero,
       c.estado::text as estado,
       c.observacion,
       c.cliente_id,
       cl.razon_social as cliente,
       c.tipo_carroceria_id,
       tc.nombre as carroceria,
       c.nombre_archivo,
       c.ruta_storage,
       c.tamano_bytes,
       c.creado_en,
       c.registrado_por,
       public.puesto_de(c.registrado_por) as registrado_por_nombre,
       c.revisado_en,
       public.puesto_de(c.revisado_por) as revisado_por_nombre,
       o.id as orden_id,
       o.numero as orden_numero,
       o.estado::text as orden_estado,
       (exists (select 1 from public.ordenes_trabajo t where t.cotizacion_pdf_id = c.id)) as tuvo_orden,
       c.version,
       c.mime_type,
       c.archivo_subido_en,
       c.monto_venta,
       c.moneda,
       public.codigo_interno_de_cotizacion(c.id) as codigo_interno,
       c.cantidad_unidades,
       oc.ordenes,
       jsonb_array_length(oc.ordenes) as ordenes_vigentes,
       greatest(c.cantidad_unidades - jsonb_array_length(oc.ordenes), 0) as ordenes_faltantes
  from public.cotizaciones_pdf c
  left join public.clientes cl on cl.id = c.cliente_id
  left join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
  left join lateral (
    select ot.id, ot.numero, ot.estado
      from public.ordenes_trabajo ot
     where ot.cotizacion_pdf_id = c.id and ot.estado <> 'ANULADA'::public.estado_ot
     -- Con varias, la última: la misma OT del código que da `codigo_interno_de_cotizacion`.
     order by ot.creado_en desc, ot.numero desc
     limit 1
  ) o on true
  cross join lateral (select public.ordenes_de_cotizacion(c.id) as ordenes) oc;

grant select on public.v_cotizaciones_pdf to authenticated;

-- 8. El margen de cada OT usa la parte de su unidad -------------------------------
-- El de la `20261001170000`, con el precio de la cotización entre sus unidades.
-- Con una unidad, el mismo de siempre.
create or replace function public.margen_ot(p_orden uuid)
returns table (
  moneda_venta text, precio_venta numeric, incluye_igv boolean, precio_neto numeric, cambio_venta numeric,
  precio_neto_pen numeric, costo_pen numeric, margen_pen numeric, margen_pct numeric,
  despachos_sin_precio integer, lineas_sin_cambio integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  -- La tasa del IGV en el Perú desde 2011.
  c_igv constant numeric := 0.18;
  v_moneda text;
  v_precio numeric;
  v_igv boolean;
  v_fecha date;
  v_neto numeric;
  v_cambio numeric;
  v_neto_pen numeric;
  v_costo numeric;
  v_cerrado numeric;
  v_sin_precio integer;
  v_sin_cambio integer;
begin
  perform public.exigir_permiso('costos.ver');
  if not (public.es_admin() or public.tiene_permiso('cotizaciones.ver_pdf_comercial')) then
    raise exception 'El margen se calcula con el precio de venta, que tu puesto no ve.'
      using errcode = 'insufficient_privilege';
  end if;
  if not public.puede_ver_orden(p_orden) then
    raise exception 'No tienes acceso a esta OT.' using errcode = 'insufficient_privilege';
  end if;

  -- El precio de esta unidad: el total de la cotización entre sus unidades.
  select c.moneda::text, round(c.monto_venta / greatest(c.cantidad_unidades, 1), 2),
         case when i.version = c.version then i.incluye_igv end,
         o.fecha_registro::date
    into v_moneda, v_precio, v_igv, v_fecha
    from public.ordenes_trabajo o
    left join public.cotizaciones_pdf c on c.id = o.cotizacion_pdf_id and c.estado <> 'ANULADA'
    left join public.cotizaciones_pdf_igv i on i.cotizacion_id = c.id
   where o.id = p_orden;

  select coalesce(sum(s.monto_pen), 0),
         count(*) filter (where s.fuente = 'MATERIALES_SIN_PRECIO'),
         count(*) filter (where s.moneda = 'USD' and s.monto_pen is null)
    into v_costo, v_sin_precio, v_sin_cambio
    from public.costeo_ot_en_soles(p_orden) s;

  -- Con el costo cerrado, el margen es el de ese costo.
  select c.costo_pen into v_cerrado from public.ot_cierres_costo c where c.orden_id = p_orden;
  if found then
    v_costo := v_cerrado;
    v_sin_precio := 0;
    v_sin_cambio := 0;
  end if;

  v_neto := case when v_igv then round(v_precio / (1 + c_igv), 2)
                 when v_igv = false then v_precio end;
  -- Un precio en dólares se pasa con el cambio de COMPRA del día en que se
  -- registró la OT: es cuando la venta quedó comprometida.
  v_cambio := case when v_moneda = 'USD' then public.cambio_del_dia(v_fecha, 'COMPRA') end;
  v_neto_pen := case when v_moneda = 'PEN' then v_neto
                     when v_moneda = 'USD' then round(v_neto * v_cambio, 2) end;

  return query select
    v_moneda, v_precio, v_igv, v_neto, v_cambio, v_neto_pen, v_costo,
    case when v_neto_pen is not null then v_neto_pen - v_costo end,
    case when v_neto_pen > 0 then round((v_neto_pen - v_costo) / v_neto_pen * 100, 1) end,
    v_sin_precio, v_sin_cambio;
end;
$$;

-- 9. La venta de cada código interno es la de su unidad ---------------------------
-- La de producción, con un cambio en `cotizacion`: antes la cotización entera
-- se le contaba al código de su última OT; ahora cada código vigente de la
-- cotización recibe su parte (el total entre las unidades). Con una unidad y su
-- OT, lo mismo de siempre. `ordenes_de_cotizacion` da los códigos como dueña,
-- como hacía `codigo_interno_de_cotizacion`.
create or replace function public.codigos_internos_costo_calculado(p_codigo text)
 returns table(codigo text, mano_obra numeric, recargo_extras numeric, gastos_mes_pen numeric, gastos_mes_usd numeric, caja_pen numeric, caja_usd numeric, egresos_caja integer, gastos_ot_pen numeric, gastos_ot_usd numeric, merma_pen numeric, merma_usd numeric, costo_pen numeric, usd_sin_cambio numeric, lineas_sin_cambio integer, usd_al_cambio numeric, usd_en_soles numeric, materiales_sin_precio integer, horas_sin_costo numeric, cotizaciones integer, moneda_venta text, precio_venta_pen numeric, precio_venta_usd numeric, venta_sin_igv_confirmado integer, venta_sin_cambio integer, precio_neto_pen numeric, margen_pen numeric, margen_pct numeric, presupuesto_pen numeric, presupuesto_fijado boolean, consumido_pct numeric, semaforo text, entregada_el date, cierre_id uuid, cerrado_en timestamp with time zone, cerrado_por text, costo_cerrado_pen numeric, margen_cerrado_pen numeric, margen_cerrado_pct numeric)
 language plpgsql
 stable
 set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  -- La tasa del IGV en el Perú desde 2011, y la utilidad estándar de la hoja RESUMEN.
  c_igv constant numeric := 0.18;
  c_utilidad constant numeric := 0.15;
  v_codigo text := public.normalizar_codigo_interno(p_codigo);
begin
  return query
  with linea as (
    select k.*,
           k.fuente in ('MANO_OBRA', 'RECARGO_EXTRAS', 'MATERIALES', 'SERVICIOS', 'SUBCONTRATOS',
                        'SUBCONTRATOS_POR_PAGAR', 'GASTOS_DEL_MES', 'CAJA', 'GASTOS_OT', 'MERMA') as suma,
           case when k.moneda = 'USD' then public.cambio_del_dia(k.fecha, 'VENTA') end as cambio
      from public.codigo_interno_lineas(v_codigo, true) k
     where k.codigo is not null
  ), costo as (
    select l.codigo,
           coalesce(sum(l.monto) filter (where l.fuente = 'MANO_OBRA'), 0)::numeric as mano_obra,
           coalesce(sum(l.monto) filter (where l.fuente = 'RECARGO_EXTRAS'), 0)::numeric as recargo,
           coalesce(sum(l.monto) filter (where l.fuente = 'GASTOS_DEL_MES' and l.moneda = 'PEN'), 0)::numeric as gastos_pen,
           coalesce(sum(l.monto) filter (where l.fuente = 'GASTOS_DEL_MES' and l.moneda = 'USD'), 0)::numeric as gastos_usd,
           coalesce(sum(l.monto) filter (where l.fuente = 'CAJA' and l.moneda = 'PEN'), 0)::numeric as caja_pen,
           coalesce(sum(l.monto) filter (where l.fuente = 'CAJA' and l.moneda = 'USD'), 0)::numeric as caja_usd,
           count(*) filter (where l.fuente = 'CAJA')::integer as egresos_caja,
           coalesce(sum(l.monto) filter (where l.fuente = 'GASTOS_OT' and l.moneda = 'PEN'), 0)::numeric as gastos_ot_pen,
           coalesce(sum(l.monto) filter (where l.fuente = 'GASTOS_OT' and l.moneda = 'USD'), 0)::numeric as gastos_ot_usd,
           coalesce(sum(l.monto) filter (where l.fuente = 'MERMA' and l.moneda = 'PEN'), 0)::numeric as merma_pen,
           coalesce(sum(l.monto) filter (where l.fuente = 'MERMA' and l.moneda = 'USD'), 0)::numeric as merma_usd,
           coalesce(sum(case when l.moneda = 'PEN' then l.monto else round(l.monto * l.cambio, 2) end)
                      filter (where l.suma and (l.moneda = 'PEN' or l.cambio is not null)), 0)::numeric as costo_pen,
           coalesce(sum(l.monto) filter (where l.suma and l.moneda = 'USD' and l.cambio is null), 0)::numeric as usd_sin_cambio,
           count(*) filter (where l.suma and l.moneda = 'USD' and l.cambio is null)::integer as sin_cambio,
           -- Los dólares que sí pasan a soles, y en cuánto: con eso las partes cuadran con el total.
           coalesce(sum(l.monto) filter (where l.suma and l.moneda = 'USD' and l.cambio is not null), 0)::numeric as usd_al_cambio,
           coalesce(sum(round(l.monto * l.cambio, 2)) filter (where l.suma and l.moneda = 'USD' and l.cambio is not null), 0)::numeric as usd_en_soles,
           count(*) filter (where l.fuente = 'MATERIALES_SIN_PRECIO')::integer as sin_precio,
           coalesce(sum(l.horas) filter (where l.fuente = 'MANO_OBRA_SIN_COSTO'), 0)::numeric as horas_sin_costo
      from linea l
     group by l.codigo
  ), cotizacion as (
    -- La cotización aprobada (o aprobada antes de una corrección) de las OT del
    -- código: a cada código vigente de la cotización, su parte del total.
    select x.codigo, c.moneda::text as moneda,
           round(c.monto_venta::numeric / greatest(c.cantidad_unidades, 1), 2) as monto,
           ig.incluye_igv, (coalesce(c.revisado_en, c.creado_en) at time zone 'America/Lima')::date as fecha
      from public.cotizaciones_pdf c
      -- El IGV confirmado para esta versión: una corrección sin confirmar no tiene precio.
      left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id and ig.version = c.version
      cross join lateral (
        select distinct e ->> 'codigo_interno' as codigo
          from jsonb_array_elements(public.ordenes_de_cotizacion(c.id)) e
         where e ->> 'codigo_interno' is not null
      ) x
     where c.estado::text <> 'ANULADA' and c.monto_venta is not null and public.cotizacion_fue_aprobada(c.id)
  ), venta_linea as (
    select v.*,
           case when v.incluye_igv then round(v.monto / (1 + c_igv), 2) when v.incluye_igv = false then v.monto end as neto,
           case when v.moneda = 'USD' then public.cambio_del_dia(v.fecha, 'COMPRA') end as cambio
      from cotizacion v
     where v.codigo is not null and (v_codigo is null or v.codigo = v_codigo)
  ), venta as (
    select v.codigo, count(*)::integer as cotizaciones,
           string_agg(distinct v.moneda, '+' order by v.moneda) as moneda,
           coalesce(sum(v.monto) filter (where v.moneda = 'PEN'), 0)::numeric as pen,
           coalesce(sum(v.monto) filter (where v.moneda = 'USD'), 0)::numeric as usd,
           count(*) filter (where v.incluye_igv is null)::integer as sin_igv,
           count(*) filter (where v.moneda = 'USD' and v.cambio is null)::integer as sin_cambio,
           -- Si falta saber el IGV o el cambio de alguna, el precio no se adivina.
           case when bool_and(v.neto is not null and (v.moneda = 'PEN' or v.cambio is not null))
                then sum(case when v.moneda = 'PEN' then v.neto else round(v.neto * v.cambio, 2) end) end as neto_pen
      from venta_linea v
     group by v.codigo
  ), fijado as (
    -- El presupuesto que Gerencia o Administración fijó a mano en la OT de la
    -- unidad manda sobre el de la hoja; con varias OT (una garantía), la suma.
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo, sum(p.monto_pen)::numeric as monto
      from public.ot_presupuestos p
      join public.ordenes_trabajo o on o.id = p.orden_id
      join public.unidades u on u.id = o.unidad_id
     where p.monto_pen is not null and o.estado::text <> 'ANULADA'
       and public.normalizar_codigo_interno(u.codigo_interno) is not null
       and (v_codigo is null or public.normalizar_codigo_interno(u.codigo_interno) = v_codigo)
     group by 1
  ), entrega as (
    -- El acta de entrega más reciente de las OT del código (la registra el taller).
    select public.normalizar_codigo_interno(u.codigo_interno) as codigo, max(e.fecha_entrega) as fecha
      from public.ot_entregas e
      join public.ordenes_trabajo o on o.id = e.orden_id
      join public.unidades u on u.id = o.unidad_id
     where o.estado::text <> 'ANULADA' and public.normalizar_codigo_interno(u.codigo_interno) is not null
       and (v_codigo is null or public.normalizar_codigo_interno(u.codigo_interno) = v_codigo)
     group by 1
  ), cierre as (
    select z.* from public.codigo_interno_cierres z
     where z.reabierto_en is null and (v_codigo is null or z.codigo = v_codigo)
  ), codigos as (
    select k.codigo from costo k union select v.codigo from venta v union select z.codigo from cierre z
  )
  select c.codigo,
         coalesce(k.mano_obra, 0), coalesce(k.recargo, 0),
         coalesce(k.gastos_pen, 0), coalesce(k.gastos_usd, 0),
         coalesce(k.caja_pen, 0), coalesce(k.caja_usd, 0), coalesce(k.egresos_caja, 0),
         coalesce(k.gastos_ot_pen, 0), coalesce(k.gastos_ot_usd, 0), coalesce(k.merma_pen, 0), coalesce(k.merma_usd, 0),
         coalesce(k.costo_pen, 0), coalesce(k.usd_sin_cambio, 0), coalesce(k.sin_cambio, 0),
         coalesce(k.usd_al_cambio, 0), coalesce(k.usd_en_soles, 0),
         coalesce(k.sin_precio, 0), coalesce(k.horas_sin_costo, 0),
         coalesce(v.cotizaciones, 0), v.moneda, v.pen, v.usd,
         coalesce(v.sin_igv, 0), coalesce(v.sin_cambio, 0), v.neto_pen,
         -- Sin costo todavía el margen saldría 100 %: no hay margen hasta que algo cueste.
         case when v.neto_pen is not null and k.costo_pen > 0 then v.neto_pen - k.costo_pen end,
         case when v.neto_pen > 0 and k.costo_pen > 0 then round((v.neto_pen - k.costo_pen) / v.neto_pen * 100, 1) end,
         p.presupuesto, f.monto is not null,
         case when p.presupuesto > 0 then round(coalesce(k.costo_pen, 0) / p.presupuesto * 100, 1) end,
         -- Pasado el presupuesto, excedido; del 90 % en adelante, ajustado.
         case when p.presupuesto is null then null
              when coalesce(k.costo_pen, 0) > p.presupuesto then 'EXCEDIDO'
              when coalesce(k.costo_pen, 0) >= p.presupuesto * 0.9 then 'AJUSTADO'
              else 'EN_RANGO' end,
         en.fecha,
         z.id, z.cerrado_en, public.puesto_de(z.cerrado_por), z.costo_pen, z.margen_pen, z.margen_pct
    from codigos c
    left join costo k on k.codigo = c.codigo
    left join venta v on v.codigo = c.codigo
    left join cierre z on z.codigo = c.codigo
    left join fijado f on f.codigo = c.codigo
    left join entrega en on en.codigo = c.codigo
    cross join lateral (select coalesce(f.monto, round(v.neto_pen / (1 + c_utilidad), 2)) as presupuesto) p
   where c.codigo is not null
   order by 1;
end;
$function$;

comment on function public.codigos_internos_costo_calculado(text) is
  'El costo completo de cada código interno (o de uno) en soles, con lo que falta para que esté completo, el precio de su cotización aprobada sin IGV (con varias unidades, su parte: el total entre las unidades), el margen (solo con costo), el presupuesto (el fijado a mano en su OT o el de la hoja) con su semáforo, la fecha del acta de entrega de su OT y el cierre vigente. Sin pedir permiso: la llaman codigos_internos_costo y cerrar_costeo_codigo.';
revoke all on function public.codigos_internos_costo_calculado(text) from public, anon, authenticated;

-- 10. La aprobación que deja unidades sin OT avisa a Administración -----------------
-- La de la `20261126450000`, con un cambio: avisaba solo si la cotización no
-- tenía ninguna OT. Con varias unidades, la corrección aprobada que suma una
-- unidad ya tiene OT y le falta otra: también avisa, con cuántas faltan.
create or replace function public.fn_cotizacion_pdf_avisa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cliente text;
  v_quien   text;
  v_codigo  text;
  v_con_ot  integer;
begin
  select c.razon_social into v_cliente from public.clientes c where c.id = new.cliente_id;
  v_quien := public.puesto_de(new.registrado_por);

  if tg_op = 'INSERT' then
    perform public.notificar_a_permiso(
      'cotizaciones.revisar',
      'Cotización por revisar',
      format('%s subió la %s de %s', coalesce(v_quien, 'Ventas'), new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente'))),
      '/cotizaciones/pdf', 'cotizaciones_pdf', new.id, public.usuario_actual());
    return null;
  end if;

  if new.estado is not distinct from old.estado then
    return null;
  end if;

  if new.estado = 'POR_REVISAR' then
    if new.version > old.version then
      perform public.notificar_a_permiso(
        'cotizaciones.revisar',
        'Cotización corregida',
        format('%s subió la corrección de la %s de %s (versión %s). Lo que habías observado: %s',
               coalesce(v_quien, 'Ventas'), new.numero, coalesce(v_cliente, 'un cliente'), new.version,
               coalesce(old.observacion, 'sin observación')),
        '/cotizaciones/pdf', 'cotizaciones_pdf', new.id, public.usuario_actual());
    end if;
    return null;
  end if;

  if new.estado = 'APROBADA' then
    v_codigo := public.codigo_interno_de_cotizacion(new.id);
    select count(*) into v_con_ot from public.ordenes_trabajo o
     where o.cotizacion_pdf_id = new.id and o.estado <> 'ANULADA';
    if v_con_ot = 0 and new.cantidad_unidades > 1 then
      perform public.notificar_a_permiso(
        'ordenes.crear',
        'Cotización aprobada: faltan sus códigos y sus OT',
        format('Gerencia aprobó la %s de %s Lleva %s unidades: dale a cada una su código interno y sube su OT.',
               new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente')), new.cantidad_unidades),
        '/cotizaciones/pdf?estado=APROBADA_SIN_OT#' || new.id, 'cotizaciones_pdf', new.id, public.usuario_actual());
    elsif v_con_ot > 0 and v_con_ot < new.cantidad_unidades then
      -- La corrección que sumó unidades: ya tiene OT, pero le faltan.
      perform public.notificar_a_permiso(
        'ordenes.crear',
        'Cotización aprobada: le faltan OT',
        format('Gerencia aprobó la %s de %s Lleva %s unidades y tiene %s OT: carga %s.',
               new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente')), new.cantidad_unidades, v_con_ot,
               case when new.cantidad_unidades - v_con_ot = 1 then 'la que falta' else format('las %s que faltan', new.cantidad_unidades - v_con_ot) end),
        '/cotizaciones/pdf?estado=APROBADA_SIN_OT#' || new.id, 'cotizaciones_pdf', new.id, public.usuario_actual());
    elsif v_con_ot = 0 then
      perform public.notificar_a_permiso(
        'ordenes.crear',
        'Cotización aprobada: falta su código y su OT',
        format('Gerencia aprobó la %s de %s Dale su código interno y sube su OT.',
               new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente'))),
        '/cotizaciones/pdf?estado=APROBADA_SIN_OT#' || new.id, 'cotizaciones_pdf', new.id, public.usuario_actual());
    end if;
  end if;

  -- Al vendedor que la subió: aprobada, rechazada o anulada, cada una con su
  -- frase. La anulada sale de la lista de vigentes: su tarjeta está en el
  -- filtro de anuladas (la campana le suma el #id a la que no lo trae).
  perform public.notificar_a_usuario(
    new.registrado_por,
    case new.estado when 'APROBADA' then 'Gerencia aprobó tu cotización'
                    when 'ANULADA'  then 'Gerencia anuló tu cotización'
                    else 'Gerencia rechazó tu cotización' end,
    case when new.estado = 'APROBADA' and v_codigo is not null
         then public.con_punto_final(format('La %s de %s, con el código interno %s', new.numero, coalesce(v_cliente, 'un cliente'), v_codigo))
         when new.estado = 'APROBADA'
         then format('La %s de %s Administración le da su código interno y sube su OT.',
                     new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente')))
         when new.estado = 'ANULADA'
         then format('La %s de %s Motivo: %s El número se conserva.',
                     new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente')),
                     public.con_punto_final(coalesce(nullif(btrim(new.observacion), ''), 'sin motivo')))
         else format('La %s: %s Corrígela y sube la corrección.', new.numero, public.con_punto_final(coalesce(nullif(btrim(new.observacion), ''), 'Sin motivo'))) end,
    case when new.estado = 'ANULADA' then '/cotizaciones/pdf?estado=ANULADA' else '/cotizaciones/pdf' end,
    'cotizaciones_pdf', new.id, public.usuario_actual());

  return null;
end;
$function$;

revoke all on function public.fn_cotizacion_pdf_avisa() from public, anon, authenticated;
