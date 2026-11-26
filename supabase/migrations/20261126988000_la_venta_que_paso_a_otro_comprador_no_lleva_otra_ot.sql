-- =============================================================================
-- LA VENTA QUE PASÓ A OTRO COMPRADOR YA NO LLEVA OTRA OT
-- -----------------------------------------------------------------------------
-- Con «Editar OT» una OT puede pasar a otro comprador: su cotización nueva queda
-- en la OT y la de antes se anota como su venta anterior (`ot_ventas_anteriores`).
-- La cotización de antes seguía aprobada y sin OT, así que volvía a «Por
-- completar» de Administración, el recorrido decía que la tenía ella y la
-- tarjeta le ofrecía «Dar código y cargar la OT»: se le podía cargar una OT
-- nueva a una venta que ya no existe.
--
-- DKS decidió el 2026-11-26 (plan 8, Administración): «Cerrarla: no lleva otra
-- OT». Desde aquí, la unidad cuya OT pasó a otro comprador cuenta como cargada:
--
--   · La base no deja cargarle otra OT: ni `cargar_codigo_y_ot_de_cotizacion`
--     ni ningún otro camino (`fn_ot_cabe_en_su_cotizacion`, el disparador de la
--     OT). El mensaje dice de qué OT fue la venta.
--   · Sale de «Por completar» y de lo que espera Administración.
--   · La tarjeta de la cotización ya no ofrece cargar la OT (`ordenes_faltantes`
--     la cuenta) y dice de qué OT fue la venta (`ordenes_a_otro_comprador`).
--   · El recorrido dice «Pasó a otro comprador» y ya no espera a nadie: ni a
--     Administración ni la factura ni el cobro. Una cotización de varias
--     unidades sigue esperando las OT de las otras, y su factura.
--   · En la de varias unidades, la OT que pasó conserva su número de unidad
--     (no se cambia, 20261126760000): la carga no vuelve a dar ese número y la
--     tarjeta pinta esa unidad como la que pasó (`unidades_a_otro_comprador`).
--   · Si Ventas la corrige y Gerencia la vuelve a aprobar, no se le pide otra
--     OT a Administración (`fn_cotizacion_pdf_avisa`).
--   · Facturación no la lista para facturar si no tiene facturas
--     (`cotizaciones_para_facturar`, la de la 20261126960000). Si ya tenía una,
--     sigue ahí para cobrarla o anularla, sin pedir OT a Administración
--     (`ventas_cerradas_por_otro_comprador`).
--
-- Si el traspaso fue un error y la OT vuelve a la cotización de la que venía,
-- la del medio no se cierra: vuelve a esperar su OT. Si la OT que pasó se anula
-- después, la venta de origen se reabre y espera su OT hasta que Ventas la
-- cancele (StudioGRCI, 2026-11-26: «sí se reabre hasta que el vendedor
-- intervenga y cancele la venta»); «Por completar» dice que esa OT se anuló.
-- Ventas la cancela con «Cancelar la venta» (`cancelar_venta_reabierta`): quien
-- registró la cotización la anula con su motivo, y solo esa venta: la que se
-- reabrió, aprobada, sin OT vigente y sin factura vigente. Anular cualquier
-- otra cotización sigue siendo de Gerencia. Quien la registró recibe un aviso
-- cuando se reabre (`trg_ot_anulada_reabre_la_venta`, disparador propio de la
-- OT). Ya no es una venta reabierta la que después tuvo otra OT y esa pasó a
-- otro comprador (está cerrada otra vez) o se anuló en su sitio (espera por la
-- suya, como cualquiera): esas no las cancela Ventas.
--
-- Nada se borra: la cotización sigue aprobada, con su número, y la venta
-- anterior queda anotada como estaba.
--
-- Seis de las funciones que se reemplazan son las de la 20261126760000 (PR 245,
-- ya en producción); `cotizaciones_para_facturar` es la de la 20261126960000,
-- que tiene que estar aplicada antes que esta, y `fn_cotizacion_pdf_anular`, la
-- de la 20260928143100. Cada una se reemplaza solo si
-- sigue siendo esa (la guarda de la huella, abajo), o ya es la de esta
-- migración, para que reaplicarla no falle. La vista
-- `v_cotizaciones_pdf` conserva sus columnas en el mismo orden y suma tres al
-- final.
--
-- Sin DROP: el conector de producción no deja pasar ninguno.
-- =============================================================================

-- 0. La guarda de la huella -----------------------------------------------------
do $$
declare
  f record;
  huella text;
begin
  for f in
    select * from (values
      ('public.cargar_codigo_y_ot_de_cotizacion(uuid,uuid,text,text,public.tipo_unidad_carroceria,date,text,text,bigint,text,text)',
       array['3bdadf68ef26b720306de09e914c64a8', 'ead3df8364d77d7bbb1b4b2bc68c16de']),
      ('public.fn_ot_cabe_en_su_cotizacion()', array['39011695f6218a14461d547e553541fc', '63a66599b95fbbcd7a76dc3f581a8b0b']),
      ('public.pendientes_de_las_ot()', array['718a8eb5034228fcc1d284adadff9e21', '26509c90eb1a17e298aab58d5fa726bb']),
      ('public.fn_cotizacion_pdf_avisa()', array['2239fc0bedd8f52a7dd5dd356a062a2e', 'fa125b4cec26e0104e25c6a1b6c16e79']),
      ('public.cotizaciones_para_facturar()', array['788067b4d73552ecbc9eef10d2e122a9', '68e15622e7b6a37c98a9a9e840edfb10']),
      ('public.fn_cotizacion_pdf_revision()', array['70b788744ae098bf2a05b19e988de199', 'a8ea60fee259840da5f8f43388bcd3e6']),
      ('public.fn_cotizacion_pdf_anular()', array['2ae5c60cf8eccfe0d009a0e170832285', 'f4b882cbd42c112831e248a41e5ae2cd']),
      ('public.recorrido_de_cotizaciones(uuid[])', array['693851facf796c541733982b26b70db3', 'dd8275d9fb006291102445a6d2e83a84'])
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

-- 1. Las OT que fueron la venta de una cotización y pasaron a otro comprador -----
-- Una por OT, con la última vez que salió de la cotización. Se sigue el camino
-- de la OT por sus ventas anteriores (`ot_ventas_anteriores`) hasta la de hoy,
-- como una pila: pasar a la venta de la que venía deshace el último traspaso
-- (fue un error) y la venta del medio no se cierra; pasar a otra la apila. Las
-- ventas que quedan debajo de la de hoy pasaron a otro comprador. Así, de A a B
-- y de vuelta a A, B no se cierra; de A a B, a A y otra vez a B, A sí.
-- `p_sin` deja fuera una OT: la que el disparador está moviendo. Ayudante
-- interno: lo llaman las dos de abajo, que corren como dueñas.
create or replace function public.camino_de_las_salidas(p_cotizacion uuid, p_sin uuid)
returns table (orden_id uuid, salio_en timestamptz, anulada boolean)
language plpgsql
stable
security definer
set search_path to 'public'
rows 1
as $$
declare
  o      record;
  v_c    uuid;
  v_pila uuid[];
  v_n    integer;
begin
  for o in
    select t.id, t.cotizacion_pdf_id as hoy, (t.estado = 'ANULADA') as anulada, max(va.creado_en) as salio
      from public.ot_ventas_anteriores va
      join public.ordenes_trabajo t on t.id = va.orden_id
     where va.cotizacion_pdf_id = p_cotizacion
       and t.cotizacion_pdf_id is distinct from p_cotizacion
       and t.id is distinct from p_sin
     group by t.id, t.cotizacion_pdf_id, t.estado
  loop
    v_pila := '{}';
    for v_c in
      select x.c from (
        select va.cotizacion_pdf_id as c, va.creado_en as en, 0 as orden
          from public.ot_ventas_anteriores va where va.orden_id = o.id
        union all
        select o.hoy, 'infinity'::timestamptz, 1) x
       order by x.en, x.orden
    loop
      v_n := cardinality(v_pila);
      if v_n >= 2 and v_c is not distinct from v_pila[v_n - 1] then
        v_pila := v_pila[1:v_n - 1];
      elsif v_n = 0 or v_c is distinct from v_pila[v_n] then
        v_pila := array_append(v_pila, v_c);
      end if;
    end loop;
    if p_cotizacion = any (v_pila[1:cardinality(v_pila) - 1]) then
      orden_id := o.id;
      salio_en := o.salio;
      anulada := o.anulada;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.camino_de_las_salidas(uuid, uuid) from public, anon, authenticated;

-- La OT que pasó y después se anuló ya no es venta de nadie: no cuenta como
-- salida, y la venta de origen se reabre y espera su OT hasta que Ventas la
-- cancele (StudioGRCI, 2026-11-26: «sí se reabre hasta que el vendedor
-- intervenga y cancele la venta»).
create or replace function public.salidas_de_la_cotizacion(p_cotizacion uuid, p_sin uuid)
returns table (orden_id uuid, salio_en timestamptz)
language sql
stable
security definer
set search_path to 'public'
rows 1
as $$
  select c.orden_id, c.salio_en from public.camino_de_las_salidas(p_cotizacion, p_sin) c where not c.anulada;
$$;

revoke all on function public.salidas_de_la_cotizacion(uuid, uuid) from public, anon, authenticated;

-- 1a. La venta que se reabrió: su OT pasó a otro comprador y allí se anuló, y
-- hoy no tiene ninguna OT vigente y sigue esperando alguna. La última de esas
-- OT. Dos casos que ya no son una venta reabierta:
--  · Administración le cargó otra OT y esa también pasó a otro comprador: la
--    venta está cerrada otra vez (no espera OT, con la regla de la carga).
--  · Le cargó otra OT y esa se anuló aquí: espera por la suya, que es el caso
--    de siempre (anular la cotización le toca a Gerencia).
-- La OT anulada no cambia después de anularse (20261020207000): su
-- `actualizado_en` es cuándo se anuló. Ayudante interno.
create or replace function public.ot_anulada_que_reabre_la_venta(p_cotizacion uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select x.orden_id
    from (select c.orden_id, t.actualizado_en as anulada_en
            from public.camino_de_las_salidas(p_cotizacion, null) c
            join public.ordenes_trabajo t on t.id = c.orden_id
           where c.anulada
           order by t.actualizado_en desc, c.salio_en desc
           limit 1) x
   where not exists (select 1 from public.ordenes_trabajo t
                      where t.cotizacion_pdf_id = p_cotizacion and t.estado <> 'ANULADA')
     and (select count(*) from public.camino_de_las_salidas(p_cotizacion, null) s where not s.anulada)
         < coalesce((select q.cantidad_unidades from public.cotizaciones_pdf q where q.id = p_cotizacion), 1)
     and not exists (select 1 from public.ordenes_trabajo t
                      where t.cotizacion_pdf_id = p_cotizacion and t.estado = 'ANULADA'
                        and t.actualizado_en > x.anulada_en);
$$;

revoke all on function public.ot_anulada_que_reabre_la_venta(uuid) from public, anon, authenticated;

-- La última OT anulada de la venta, para «Por completar»: la suya, o la que
-- pasó a otro comprador y allí se anuló (`paso`), con la regla de la pila: la
-- venta del medio de un traspaso que se deshizo no la cuenta. Solo para quien
-- carga las OT (la llama `pendientes_de_las_ot`, que corre como quien la pide):
-- a los demás no les devuelve nada.
create or replace function public.ultima_ot_anulada_de_la_venta(p_cotizacion uuid)
returns table (numero text, anulada_en timestamptz, paso boolean)
language sql
stable
security definer
set search_path to 'public'
rows 1
as $$
  select o.numero, o.actualizado_en, x.paso
    from (select t.id, false as paso from public.ordenes_trabajo t
           where t.cotizacion_pdf_id = p_cotizacion and t.estado = 'ANULADA'
          union all
          select c.orden_id, true from public.camino_de_las_salidas(p_cotizacion, null) c where c.anulada) x
    join public.ordenes_trabajo o on o.id = x.id
   where public.es_admin() or public.tiene_permiso('ordenes.crear')
   order by o.actualizado_en desc, x.paso desc, o.numero desc
   limit 1;
$$;

comment on function public.ultima_ot_anulada_de_la_venta(uuid) is
  'La última OT anulada de la cotización: la suya o la que pasó a otro comprador y allí se anuló (paso), con cuándo se anuló. Solo para quien carga las OT (ordenes.crear); a los demás, ninguna fila (migración 20261126988000).';

revoke all on function public.ultima_ot_anulada_de_la_venta(uuid) from public, anon;
grant execute on function public.ultima_ot_anulada_de_la_venta(uuid) to authenticated;

-- Lo que lee la tarjeta: nulo si la venta no se reabrió; si se reabrió, la OT
-- que se anuló (el número, solo para quien lee o carga las órdenes).
create or replace function public.venta_reabierta(p_cotizacion uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object('numero',
           case when public.es_admin() or public.tiene_permiso('ordenes.ver') or public.tiene_permiso('ordenes.crear')
                then o.numero end)
    from public.ordenes_trabajo o
   where o.id = public.ot_anulada_que_reabre_la_venta(p_cotizacion);
$$;

comment on function public.venta_reabierta(uuid) is
  'Nulo si la venta no se reabrió. Si su OT pasó a otro comprador, allí se anuló y la cotización no tiene ninguna OT vigente: {numero} de esa OT, solo para quien lee o carga las órdenes. La venta vuelve a esperar su OT hasta que Ventas la cancele (migración 20261126988000).';

revoke all on function public.venta_reabierta(uuid) from public, anon;
grant execute on function public.venta_reabierta(uuid) to authenticated;

-- Cuántas son lo cuenta igual para todos (la carga, la tarjeta y los
-- pendientes), aunque quien llama no lea `ot_ventas_anteriores`. El número de la
-- OT, solo a quien lee las órdenes o las carga (como `ordenes_de_cotizacion`).
create or replace function public.ordenes_que_salieron_de_la_cotizacion(p_cotizacion uuid, p_sin uuid)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(case when v.ve then o.numero end order by s.salio_en, o.numero), '{}'::text[])
    from public.salidas_de_la_cotizacion(p_cotizacion, p_sin) s
    join public.ordenes_trabajo o on o.id = s.orden_id
    cross join (select public.es_admin() or public.tiene_permiso('ordenes.ver') or public.tiene_permiso('ordenes.crear') as ve) v;
$$;

comment on function public.ordenes_que_salieron_de_la_cotizacion(uuid, uuid) is
  'Las OT que fueron la venta de la cotización y pasaron a otro comprador con «Editar OT» (ot_ventas_anteriores), una por unidad; no la que volvió a la cotización de la que venía. El número solo para quien lee o carga las órdenes. Su unidad ya no lleva OT (migración 20261126988000).';

revoke all on function public.ordenes_que_salieron_de_la_cotizacion(uuid, uuid) from public, anon;
grant execute on function public.ordenes_que_salieron_de_la_cotizacion(uuid, uuid) to authenticated;

-- 1b. Qué unidades eran: la OT conserva su número de unidad al pasar a otro
-- comprador (`fn_ot_unidad_no_cambia`, 20261126760000), así que es el de la
-- venta de antes. La carga no vuelve a dar ese número y la tarjeta pinta cada
-- una como la unidad que pasó, con su OT (el número, con la misma máscara).
create or replace function public.unidades_que_salieron_de_la_cotizacion(p_cotizacion uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object('unidad', coalesce(o.numero_de_unidad, 1), 'numero', case when v.ve then o.numero end)
                            order by coalesce(o.numero_de_unidad, 1), o.numero), '[]'::jsonb)
    from public.salidas_de_la_cotizacion(p_cotizacion, null) s
    join public.ordenes_trabajo o on o.id = s.orden_id
    cross join (select public.es_admin() or public.tiene_permiso('ordenes.ver') or public.tiene_permiso('ordenes.crear') as ve) v;
$$;

comment on function public.unidades_que_salieron_de_la_cotizacion(uuid) is
  'Cada unidad de la cotización cuya OT pasó a otro comprador: [{unidad, numero}], el número de la OT solo para quien lee o carga las órdenes (migración 20261126988000).';

revoke all on function public.unidades_que_salieron_de_la_cotizacion(uuid) from public, anon;
grant execute on function public.unidades_que_salieron_de_la_cotizacion(uuid) to authenticated;

-- 2. Lo que dice la base cuando no deja cargar la OT -----------------------------
create or replace function public.venta_que_paso_a_otro_comprador(p_numero text, p_cantidad integer, p_vigentes integer, p_salieron text[])
returns text
language sql
immutable
set search_path to 'public'
as $$
  with n as (select nullif(array_to_string(p_salieron, ', '), '') as ots, cardinality(p_salieron) as cuantas)
  select case
    when p_cantidad = 1 then
      format('La cotización %s fue la venta de la OT%s, que pasó a otro comprador: ya no lleva otra OT.',
             p_numero, coalesce(' ' || n.ots, ''))
    else
      format('La cotización %s es de %s unidades: %s%s %s a otro comprador%s. Ya no lleva otra OT.',
             p_numero, p_cantidad,
             case when p_vigentes = 0 then ''
                  when p_vigentes = 1 then '1 ya tiene su OT y '
                  else p_vigentes || ' ya tienen su OT y ' end,
             n.cuantas, case when n.cuantas = 1 then 'pasó' else 'pasaron' end,
             coalesce(' (OT ' || n.ots || ')', ''))
  end
  from n;
$$;

revoke all on function public.venta_que_paso_a_otro_comprador(text, integer, integer, text[]) from public, anon, authenticated;

-- 3. La carga de la OT ---------------------------------------------------------
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
  v_salieron text[];
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
  -- La venta que pasó a otro comprador ya no lleva otra OT (DKS, 2026-11-26):
  -- su unidad cuenta como cargada.
  v_salieron := public.ordenes_que_salieron_de_la_cotizacion(p_cotizacion, null);
  if v_vigentes + cardinality(v_salieron) >= v_cot.cantidad_unidades then
    raise exception '%', public.venta_que_paso_a_otro_comprador(v_cot.numero, v_cot.cantidad_unidades, v_vigentes, v_salieron)
      using errcode = 'check_violation';
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
  -- anuló la de la 2, esta es la 2) ni pasó a otro comprador (la OT conserva su
  -- número de unidad al pasar: 20261126988000). Solo se dice cuando lleva más de una.
  select min(k) into v_n
    from generate_series(1, v_cot.cantidad_unidades) k
   where not exists (select 1 from public.ordenes_trabajo o
                      where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA'
                        and coalesce(o.numero_de_unidad, 1) = k)
     and not exists (select 1 from jsonb_array_elements(public.unidades_que_salieron_de_la_cotizacion(p_cotizacion)) e
                      where (e->>'unidad')::integer = k);
  -- Una OT cargada antes de esta migración pudo tomar el número de la que pasó:
  -- entonces, la primera sin OT vigente, como antes.
  if v_n is null then
    select min(k) into v_n
      from generate_series(1, v_cot.cantidad_unidades) k
     where not exists (select 1 from public.ordenes_trabajo o
                        where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA'
                          and coalesce(o.numero_de_unidad, 1) = k);
  end if;
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
                     case when v_cot.cantidad_unidades - v_vigentes - cardinality(v_salieron) - 1 = 0 then ' Ya están todas.'
                          when v_cot.cantidad_unidades - v_vigentes - cardinality(v_salieron) - 1 = 1 then ' Falta 1.'
                          else format(' Faltan %s.', v_cot.cantidad_unidades - v_vigentes - cardinality(v_salieron) - 1) end) end,
    '/cotizaciones/pdf', 'cotizaciones_pdf', p_cotizacion, public.usuario_actual());

  return p_orden;
end;
$$;

comment on function public.cargar_codigo_y_ot_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text) is
  'Administración (ordenes.crear) da el código interno de una unidad y sube el PDF de su OT, de una cotización ya aprobada, todo junto o nada; una OT por unidad hasta cantidad_unidades (migraciones 20261027200000 y 20261126760000); la unidad cuya OT pasó a otro comprador cuenta como cargada (20261126988000).';

revoke all on function public.cargar_codigo_y_ot_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text)
  from public, anon;
grant execute on function public.cargar_codigo_y_ot_de_cotizacion(uuid, uuid, text, text, public.tipo_unidad_carroceria, date, text, text, bigint, text, text)
  to authenticated;

-- 4. Ninguna OT entra por otro camino ------------------------------------------
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
  v_salieron  text[];
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

  if coalesce(new.numero_de_unidad, 1) > v_cantidad then
    raise exception 'La cotización % es de % unidades: no tiene unidad %.', v_numero, v_cantidad, new.numero_de_unidad
      using errcode = 'check_violation';
  end if;
  if v_vigentes >= v_cantidad then
    if v_cantidad = 1 then
      raise exception 'La cotización % ya tiene su OT %.', v_numero, v_otra using errcode = 'unique_violation';
    end if;
    raise exception 'La cotización % es de % unidades y ya tiene sus % OT. Si lleva otra unidad, Ventas sube la corrección con la cantidad.',
      v_numero, v_cantidad, v_vigentes using errcode = 'unique_violation';
  end if;
  -- La unidad cuya OT pasó a otro comprador no lleva otra OT (20261126988000).
  v_salieron := public.ordenes_que_salieron_de_la_cotizacion(new.cotizacion_pdf_id, new.id);
  if v_vigentes + cardinality(v_salieron) >= v_cantidad then
    raise exception '%', public.venta_que_paso_a_otro_comprador(v_numero, v_cantidad, v_vigentes, v_salieron)
      using errcode = 'check_violation';
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

-- 5. La lista de cotizaciones ----------------------------------------------------
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
       (exists (select 1 from public.ordenes_trabajo t where t.cotizacion_pdf_id = c.id)
        or cardinality(ss.salieron) > 0) as tuvo_orden,
       c.version,
       c.mime_type,
       c.archivo_subido_en,
       c.monto_venta,
       c.moneda,
       public.codigo_interno_de_cotizacion(c.id) as codigo_interno,
       c.cantidad_unidades,
       oc.ordenes,
       jsonb_array_length(oc.ordenes) as ordenes_vigentes,
       greatest(c.cantidad_unidades - jsonb_array_length(oc.ordenes) - cardinality(ss.salieron), 0) as ordenes_faltantes,
       ss.salieron as ordenes_a_otro_comprador,
       public.unidades_que_salieron_de_la_cotizacion(c.id) as unidades_a_otro_comprador,
       public.venta_reabierta(c.id) as reabierta_por_ot_anulada
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
  cross join lateral (select public.ordenes_de_cotizacion(c.id) as ordenes) oc
  cross join lateral (select public.ordenes_que_salieron_de_la_cotizacion(c.id, null) as salieron) ss;

grant select on public.v_cotizaciones_pdf to authenticated;

-- 6. Los pendientes de Administración --------------------------------------------
create or replace function public.pendientes_de_las_ot()
returns table (
  clase            text,         -- COTIZACION u OT
  documento        uuid,         -- la cotización o la OT
  numero           text,
  cliente          text,
  trabajo          text,         -- la carrocería o la descripción
  falta_ot         boolean,
  falta_codigo     boolean,
  falta_fecha      boolean,
  ot_anulada       text,         -- de la cotización: el N.º de su OT anulada
  venta_anterior_de text,        -- de la cotización: la OT que pasó a otro comprador
  codigo_bloqueado text,         -- de la OT: SIN_UNIDAD o UNIDAD_COMPARTIDA
  desde            timestamptz,  -- desde cuándo espera
  dias             integer,      -- por fecha de Lima, hoy = 0
  total            integer       -- cuántas hay, aunque se muestren 500
)
language plpgsql
stable
security invoker
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if not (public.es_admin() or public.tiene_permiso('ordenes.crear')) then
    raise exception 'Los pendientes de las OT los ve quien carga las OT.' using errcode = 'insufficient_privilege';
  end if;

  return query
  with pendientes as (
    select 'COTIZACION'::text as clase, c.id as documento, c.numero, cl.razon_social as cliente,
           -- Con varias unidades, cuántas OT le faltan («Cama baja · faltan 2 de 3 OT»).
           case when coalesce(c.cantidad_unidades, 1) > 1
                then concat_ws(' · ', tc.nombre,
                       case when coalesce(c.cantidad_unidades, 1) - vi.vigentes - vi.salieron = 1 then 'falta 1'
                            else 'faltan ' || (coalesce(c.cantidad_unidades, 1) - vi.vigentes - vi.salieron) end
                       || ' de ' || c.cantidad_unidades || ' OT')
                else tc.nombre end as trabajo,
           true as falta_ot, false as falta_codigo, false as falta_fecha,
           an.numero as ot_anulada,
           -- La última OT que pasó a otro comprador, con la misma regla que la
           -- carga: la que volvió a la venta de la que venía no cuenta. Si la
           -- venta se reabrió (su OT pasó, allí se anuló y hoy no tiene ninguna
           -- vigente), es esa misma OT: la fila lleva el mismo número en las dos
           -- columnas (20261126988000).
           case when an.paso and public.venta_reabierta(c.id) is not null then an.numero
                else (select s.ots[cardinality(s.ots)]
                        from (select public.ordenes_que_salieron_de_la_cotizacion(c.id, null) as ots) s) end as venta_anterior_de,
           null::text as codigo_bloqueado,
           -- La OT anulada no cambia después de anularse (20261020207000): su
           -- `actualizado_en` es cuándo se anuló.
           greatest(coalesce(c.revisado_en, c.creado_en), an.actualizado_en) as desde
      from public.cotizaciones_pdf c
      left join public.clientes cl on cl.id = c.cliente_id
      left join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
      left join lateral (
        -- También la que pasó a otro comprador y allí se anuló: la venta se
        -- reabre hasta que Ventas la cancele (StudioGRCI, 2026-11-26). Con la
        -- regla de la pila: no la del traspaso que se deshizo.
        select u.numero, u.anulada_en as actualizado_en, u.paso
          from public.ultima_ot_anulada_de_la_venta(c.id) u
      ) an on true
      cross join lateral (
        select count(*)::integer as vigentes,
               -- La unidad cuya OT pasó a otro comprador ya no lleva OT (20261126988000).
               cardinality(public.ordenes_que_salieron_de_la_cotizacion(c.id, null))::integer as salieron
          from public.ordenes_trabajo o
         where o.cotizacion_pdf_id = c.id and o.estado <> 'ANULADA'
      ) vi
     -- Le falta alguna OT: una por unidad (cantidad_unidades), sin contar la que pasó a otro comprador.
     where c.estado = 'APROBADA'
       and vi.vigentes + vi.salieron < coalesce(c.cantidad_unidades, 1)
    union all
    select 'OT', o.id, o.numero, cl.razon_social, o.descripcion, false,
           s.sin_codigo,
           o.fecha_entrega_comprometida is null,
           null::text,
           null::text,
           case when not s.sin_codigo then null
                when o.unidad_id is null then 'SIN_UNIDAD'
                when exists (select 1 from public.ordenes_trabajo o2
                              where o2.unidad_id = o.unidad_id and o2.id <> o.id) then 'UNIDAD_COMPARTIDA'
           end,
           o.creado_en
      from public.ordenes_trabajo o
      left join public.unidades u on u.id = o.unidad_id
      left join public.clientes cl on cl.id = o.cliente_id
      cross join lateral (
        select (o.tipo_trabajo not in ('MANTENIMIENTO', 'GARANTIA')
                and nullif(btrim(coalesce(u.codigo_interno, '')), '') is null) as sin_codigo
      ) s
     where o.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA')
       and (s.sin_codigo or o.fecha_entrega_comprometida is null)
  )
  select p.clase, p.documento, p.numero, p.cliente, p.trabajo, p.falta_ot, p.falta_codigo, p.falta_fecha,
         p.ot_anulada, p.venta_anterior_de, p.codigo_bloqueado, p.desde, public.dias_en_espera(p.desde),
         (count(*) over ())::integer
    from pendientes p
   order by p.desde, p.numero
   limit 500;
end;
$$;

comment on function public.pendientes_de_las_ot() is
  'Lo que Administración tiene por completar en las OT, lo más viejo primero (hasta 500, con el total): cotización aprobada a la que le falta alguna OT vigente, una por unidad, con cuántas faltan en `trabajo` (desde su aprobación o la anulación de su OT; dice si su OT se anuló o si una de sus OT pasó a otro comprador; la que pasó cuenta como cargada y, si era la única, la cotización ya no sale), y OT abierta sin código interno (fabricación, reparación o repotenciación; mantenimiento y garantía van por su N.º; dice si no tiene unidad o si la comparte con otra OT) o sin fecha de entrega comprometida (desde que se creó). Días por fecha de Lima. Corre como quien llama y la pide ordenes.crear. Sin importes. Migraciones 20261126330000, 20261126760000 y 20261126988000.';

revoke all on function public.pendientes_de_las_ot() from public, anon;
grant execute on function public.pendientes_de_las_ot() to authenticated;

-- 7. El recorrido ya no espera a Administración --------------------------------
create or replace function public.recorrido_de_cotizaciones(p_ids uuid[])
returns table (
  documento uuid,
  orden     integer,
  paso      text,
  situacion text,
  puesto    text,
  en        timestamptz,
  dias      integer,
  espera    text,
  detalle   text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
declare
  v_admin     constant boolean := public.es_admin();
  v_comercial constant boolean := public.tiene_permiso('cotizaciones.ver_pdf_comercial');
  v_aprobadas constant boolean := public.tiene_permiso('cotizaciones.ver_aprobadas');
  v_tesoreria constant boolean := public.tiene_permiso('tesoreria.ver_documentos');
  -- El número de la OT lo lee quien lee las órdenes (`puede_ver_orden`); los demás ven el paso sin número.
  v_ordenes   constant boolean := public.es_admin() or public.tiene_permiso('ordenes.ver');
  -- El cobro lo ve quien lee los cobros: la política `ver_cobros_factura_venta`, tal cual.
  v_cobros    constant boolean := v_admin or public.tiene_permiso('contabilidad.facturar') or v_aprobadas or v_tesoreria;
begin
  if not (v_admin or v_comercial or v_aprobadas or v_tesoreria) then
    raise exception 'No tienes permiso para ver las cotizaciones.' using errcode = 'insufficient_privilege';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;
  if cardinality(p_ids) > 500 then
    raise exception 'Pide el recorrido de hasta 500 cotizaciones a la vez.' using errcode = 'check_violation';
  end if;

  return query
  with cot as (
    select c.id, c.estado::text as estado, c.registrado_por, c.creado_en, c.revisado_por, c.revisado_en,
           c.archivo_subido_en, c.version, c.anulado_por, c.anulado_en, c.moneda::text as moneda,
           coalesce(c.cantidad_unidades, 1) as unidades,
           -- Las OT que fueron su venta y pasaron a otro comprador: su unidad ya no
           -- lleva OT (20261126988000). Sin ninguna vigente y todas así, la venta se cerró.
           cardinality(public.ordenes_que_salieron_de_la_cotizacion(c.id, null)) as salieron,
           (cardinality(public.ordenes_que_salieron_de_la_cotizacion(c.id, null)) >= coalesce(c.cantidad_unidades, 1)
            and not exists (select 1 from public.ordenes_trabajo t where t.cotizacion_pdf_id = c.id and t.estado <> 'ANULADA')) as cerrada,
           -- El total con IGV, como lo cuenta Facturación (`totalConIgv`): sin IGV, se le suma el 18 %.
           case when c.monto_venta is null then null
                when ig.incluye_igv = false then round(c.monto_venta::numeric * 1.18, 2)
                else c.monto_venta::numeric end as total
      from public.cotizaciones_pdf c
      left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id
     where c.id = any(p_ids)
       -- La política `ver_cotizaciones_pdf`, tal cual.
       and (v_admin or v_comercial
            or (v_tesoreria and exists (select 1 from public.cotizaciones_pdf_liberaciones_tesoreria l
                                         where l.cotizacion_pdf_id = c.id))
            or (v_aprobadas and public.cotizacion_fue_aprobada(c.id)))
  ),
  -- Cada versión que se archivó al corregir, con cuándo se subió la siguiente.
  versiones as (
    select v.cotizacion_id as cot, v.version, v.rechazado_por, v.rechazado_en, v.estado_al_archivar,
           coalesce(lead(v.subido_en) over (partition by v.cotizacion_id order by v.version), c.archivo_subido_en) as corregida_en
      from public.cotizaciones_pdf_versiones v
      join cot c on c.id = v.cotizacion_id
  ),
  -- La primera OT vigente que salió de ella, desde cuándo tiene código interno,
  -- y cuántas vigentes tiene: con varias unidades, el paso queda hecho cuando
  -- están todas (migración 20261126760000).
  ot as (
    select distinct on (o.cotizacion_pdf_id) o.cotizacion_pdf_id as cot, o.numero, o.creado_por, o.creado_en,
           public.codigo_interno_de_cotizacion_desde(o.cotizacion_pdf_id) as con_codigo_en,
           (count(*) over (partition by o.cotizacion_pdf_id))::integer as vigentes,
           max(o.creado_en) over (partition by o.cotizacion_pdf_id) as ultima_en
      from public.ordenes_trabajo o
      join cot c on c.id = o.cotizacion_pdf_id
     where o.estado <> 'ANULADA'
     order by o.cotizacion_pdf_id, o.creado_en
  ),
  -- Su primera factura vigente: solo quién y cuándo, sin número ni monto.
  factura as (
    select distinct on (f.cotizacion_pdf_id) f.cotizacion_pdf_id as cot, f.registrado_por, f.creado_en
      from public.facturas_venta f
      join cot c on c.id = f.cotizacion_pdf_id
     where f.anulada_en is null
     order by f.cotizacion_pdf_id, f.creado_en
  ),
  -- Cada factura vigente con su cobro, como lo cuenta `v_facturas_venta`:
  -- cobrada si un cobro vigente la cancela o si lo cobrado alcanza su total.
  facturas as (
    select f.cotizacion_pdf_id as cot, f.id, f.moneda::text as moneda, f.total, f.creado_en,
           coalesce(bool_or(b.cancela) filter (where b.anulado_en is null), false)
             or coalesce(sum(b.monto) filter (where b.anulado_en is null), 0) >= f.total as cobrada,
           count(b.id) filter (where b.anulado_en is null) as cobros
      from public.facturas_venta f
      join cot c on c.id = f.cotizacion_pdf_id
      left join public.cobros_factura_venta b on b.factura_id = f.id
     where f.anulada_en is null
     group by f.id
  ),
  -- Lo facturado de cada cotización en su moneda, y si alguna factura va en otra.
  facturado as (
    select c.id as cot,
           coalesce(sum(x.total) filter (where x.moneda = c.moneda), 0) as en_su_moneda,
           bool_or(x.moneda <> c.moneda) as en_otra_moneda
      from cot c join facturas x on x.cot = c.id
     group by c.id
  ),
  -- Facturada en parte: le falta facturar lo que no cubren sus facturas, esté
  -- aprobada o en corrección. Con una factura en otra moneda no se compara, como
  -- en Facturación.
  falta_resto as (
    select c.id as cot
      from cot c
      join facturado x on x.cot = c.id
     where c.estado <> 'ANULADA' and c.total is not null
       -- La venta cerrada no se factura más: lo cobrado de su factura la deja cobrada (20261126988000).
       and not c.cerrada
       and not x.en_otra_moneda and x.en_su_moneda < c.total - 0.005
  ),
  -- El último cobro vigente, el que la dejó cobrada: quién y cuándo, sin monto.
  ultimo_cobro as (
    select distinct on (x.cot) x.cot, b.registrado_por, b.creado_en
      from facturas x
      join public.cobros_factura_venta b on b.factura_id = x.id and b.anulado_en is null
     order by x.cot, b.fecha desc, b.creado_en desc
  ),
  pasos as (
    -- `canon` desempata lo que pasó a la misma hora: cada versión con su revisión
    -- y su corrección, en ese orden, antes que la OT, la factura y el cobro.
    -- Ventas la subió
    select c.id as cot, 10 as canon, 'SUBIDA' as paso, 'HECHO' as situacion, c.registrado_por as quien, null::text as puesto_fijo,
           c.creado_en as en, null::text as espera, null::text as detalle
      from cot c
    union all
    -- La revisión de cada versión anterior
    select v.cot, v.version * 10 + 20, 'REVISION', 'HECHO', v.rechazado_por, null, v.rechazado_en, null, v.estado_al_archivar
      from versiones v where v.rechazado_en is not null
    union all
    -- La corrección que la reemplazó
    select v.cot, v.version * 10 + 25, 'CORRECCION', 'HECHO', c.registrado_por, null, v.corregida_en, null, 'versión ' || (v.version + 1)
      from versiones v join cot c on c.id = v.cot
    union all
    -- La revisión de la versión vigente. La anulada conserva quién la revisó y
    -- cuándo; cómo terminó esa revisión (aprobada o rechazada) ya no está en
    -- ninguna columna y sale de la bitácora, del estado que tenía al anularse.
    select c.id, c.version * 10 + 20, 'REVISION', 'HECHO', c.revisado_por, null, c.revisado_en, null,
           case when c.estado = 'ANULADA' then
                  (select b.datos_antes ->> 'estado' from public.audit_log b
                    where b.tabla = 'cotizaciones_pdf' and b.registro_id = c.id and b.accion = 'UPDATE'
                      and b.datos_despues ->> 'estado' = 'ANULADA'
                    order by b.creado_en desc limit 1)
                else c.estado end
      from cot c where c.estado in ('APROBADA', 'RECHAZADA', 'ANULADA') and c.revisado_en is not null
    union all
    select c.id, c.version * 10 + 20, 'REVISION', 'AHORA', null, 'Gerencia', c.archivo_subido_en, 'REVISION', null
      from cot c where c.estado = 'POR_REVISAR'
    union all
    -- Rechazada: vuelve a quien la subió, y después Gerencia revisa la corrección
    select c.id, c.version * 10 + 25, 'CORRECCION', 'AHORA', null, coalesce(public.puesto_de(c.registrado_por), 'Ventas'), c.revisado_en, 'CORRECCION', null
      from cot c where c.estado = 'RECHAZADA'
    union all
    select c.id, c.version * 10 + 30, 'REVISION', 'PENDIENTE', null, null, null, null, null
      from cot c where c.estado = 'RECHAZADA'
    union all
    -- Administración le dio el código interno y subió la OT. Con varias
    -- unidades, cuando cargó la de la última: hasta entonces la sigue teniendo.
    -- Con una sola OT, su número; con varias, cuántas.
    select o.cot, 100000, 'CODIGO_Y_OT', 'HECHO', o.creado_por, null, o.ultima_en, null,
           case when c.unidades > 1 then o.vigentes || ' OT' when v_ordenes then 'OT ' || o.numero end
      from ot o join cot c on c.id = o.cot
     where o.vigentes + c.salieron >= c.unidades or c.estado = 'ANULADA'
    union all
    -- Su OT pasó a otro comprador con «Editar OT» (20261126988000): esa unidad ya
    -- no lleva OT. El número, solo a quien lee las órdenes.
    select c.id, 99990, 'OTRO_COMPRADOR', 'HECHO', va.creado_por, null, va.creado_en, null,
           case when v_ordenes then array_to_string(public.ordenes_que_salieron_de_la_cotizacion(c.id, null), ', ') end
      from cot c
      cross join lateral (
        select v.creado_por, v.creado_en from public.ot_ventas_anteriores v
          join public.ordenes_trabajo t on t.id = v.orden_id
         where v.cotizacion_pdf_id = c.id and t.cotizacion_pdf_id is distinct from c.id
         order by v.creado_en desc limit 1
      ) va
     where c.salieron > 0
    union all
    -- Espera desde la aprobación, tenga ya algunas o ninguna. El detalle dice
    -- cuántas lleva de cuántas («1/3») cuando la cotización es de varias.
    select c.id, 100000, 'CODIGO_Y_OT', 'AHORA', null, 'Administración', c.revisado_en, 'CODIGO_Y_OT',
           -- «lleva/de», y «/pasaron» si alguna pasó a otro comprador.
           case when c.unidades > 1 then coalesce(o.vigentes, 0) || '/' || c.unidades
                || case when c.salieron > 0 then '/' || c.salieron else '' end end
      from cot c left join ot o on o.cot = c.id
     where c.estado = 'APROBADA' and coalesce(o.vigentes, 0) + c.salieron < c.unidades
    union all
    select c.id, 100000, 'CODIGO_Y_OT', 'PENDIENTE', null, null, null, null, null
      from cot c left join ot o on o.cot = c.id
     where c.estado in ('POR_REVISAR', 'RECHAZADA') and coalesce(o.vigentes, 0) + c.salieron < c.unidades
    union all
    -- Contabilidad la facturó. A quien lee las facturas le dice si fue solo una parte.
    select f.cot, 100010, 'FACTURA', 'HECHO', f.registrado_por, null, f.creado_en, null,
           case when v_cobros and exists (select 1 from falta_resto r where r.cot = f.cot) then 'EN_PARTE' end
      from factura f
    union all
    -- Espera su factura desde que la OT tiene código interno (DKS, Plan 10). Con
    -- varias unidades, cuando están todas sus OT, desde la última.
    select c.id, 100010, 'FACTURA', 'AHORA', null, 'Contabilidad',
           case when c.unidades > 1 then o.ultima_en else coalesce(o.con_codigo_en, o.creado_en) end, 'FACTURA', null
      from cot c join ot o on o.cot = c.id
     where c.estado = 'APROBADA' and o.vigentes + c.salieron >= c.unidades
       and not exists (select 1 from factura f where f.cot = c.id)
    union all
    select c.id, 100010, 'FACTURA', 'PENDIENTE', null, null, null, null, null
      from cot c
     where c.estado <> 'ANULADA' and not c.cerrada and not exists (select 1 from factura f where f.cot = c.id)
       and not (c.estado = 'APROBADA' and exists (select 1 from ot o where o.cot = c.id and o.vigentes + c.salieron >= c.unidades))
    union all
    -- Facturada en parte: espera la factura de lo que falta, desde la misma hora.
    -- Cuánto se facturó solo lo ve quien lee las facturas: Ventas no.
    select r.cot, 100015, 'FACTURA_RESTO', 'AHORA', null, 'Contabilidad', coalesce(o.con_codigo_en, o.creado_en), 'FACTURA_RESTO', null
      from falta_resto r
      join cot c on c.id = r.cot
      join ot o on o.cot = r.cot
     where v_cobros and c.estado = 'APROBADA'
    union all
    -- Tesorería la cobró: todas sus facturas vigentes quedaron cobradas y no falta
    -- facturar nada. Cobrado el adelanto, el cobro del resto sigue pendiente.
    select u.cot, 100018, 'COBRO', 'HECHO', u.registrado_por, null, u.creado_en, null, null
      from ultimo_cobro u
     where v_cobros and not exists (select 1 from facturas x where x.cot = u.cot and not x.cobrada)
       and not exists (select 1 from falta_resto r where r.cot = u.cot)
    union all
    select r.cot, 100018, 'COBRO', 'PENDIENTE', null, null, null, null, null
      from falta_resto r
     where v_cobros and not exists (select 1 from facturas x where x.cot = r.cot and not x.cobrada)
    union all
    -- Alguna factura vigente espera su cobro: desde la más vieja de las que faltan.
    select x.cot, 100018, 'COBRO', 'AHORA', null, 'Tesorería', min(x.creado_en), 'COBRO',
           case when sum(x.cobros) > 0 then 'EN_PARTE' end
      from facturas x
     where v_cobros and not x.cobrada
     group by x.cot
    union all
    select c.id, 100018, 'COBRO', 'PENDIENTE', null, null, null, null, null
      from cot c
     where v_cobros and c.estado <> 'ANULADA' and not c.cerrada and not exists (select 1 from facturas x where x.cot = c.id)
    union all
    -- Anulada
    select c.id, 100020, 'ANULACION', 'HECHO', c.anulado_por, null, c.anulado_en, null, null
      from cot c where c.estado = 'ANULADA' and c.anulado_en is not null
  )
  -- Los días de cada paso hecho: cuántas fechas de Lima pasaron desde el paso
  -- hecho anterior (la subida no tiene anterior). Así el vendedor ve cuánto
  -- tardó Gerencia en responder y cuánto tardó la OT, sin hacer la cuenta.
  select x.cot, x.n, x.paso, x.situacion, x.puesto, x.en,
         case when x.situacion = 'AHORA' then public.dias_en_espera(x.en)
              when x.situacion = 'HECHO' and x.en is not null and x.previo is not null
              then greatest((x.en at time zone 'America/Lima')::date - (x.previo at time zone 'America/Lima')::date, 0)
         end,
         x.espera, x.detalle
    from (
      select p.cot,
             (row_number() over (
                partition by p.cot
                order by case p.situacion when 'HECHO' then 0 when 'AHORA' then 1 else 2 end,
                         case when p.situacion = 'HECHO' then p.en end, p.canon))::integer as n,
             p.paso, p.situacion,
             case when p.situacion = 'HECHO' then public.puesto(u) else p.puesto_fijo end as puesto,
             p.en,
             -- El paso hecho justo antes, en el mismo orden en que se muestran.
             lag(p.en) over (partition by p.cot, p.situacion = 'HECHO' order by p.en, p.canon) as previo,
             p.espera, p.detalle
        from pasos p
        left join public.usuarios u on u.id = p.quien
       -- La anulada no espera a nadie: queda lo hecho, como evidencia.
       where p.situacion = 'HECHO'
          or (select c.estado from cot c where c.id = p.cot) <> 'ANULADA'
    ) x;
end;
$$;

comment on function public.recorrido_de_cotizaciones(uuid[]) is
  'El recorrido de cada cotización, un paso por fila, de la subida al cobro: lo hecho con el puesto de quien lo hizo y su fecha; quién la tiene ahora y hace cuántos días (fecha de Lima); y lo que falta. Devuelve solo las que la política ver_cotizaciones_pdf deja ver a quien llama; el cobro, solo a quien lee los cobros. Sin importes ni datos de RR. HH.';

revoke all on function public.recorrido_de_cotizaciones(uuid[]) from public, anon;
grant execute on function public.recorrido_de_cotizaciones(uuid[]) to authenticated;

-- 8. Volver a aprobar la venta cerrada no pide otra OT ---------------------------
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
  v_salieron integer;
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
    -- La unidad cuya OT pasó a otro comprador cuenta como cargada (20261126988000):
    -- volver a aprobar la venta cerrada no le pide otra OT a Administración.
    v_salieron := cardinality(public.ordenes_que_salieron_de_la_cotizacion(new.id, null));
    v_con_ot := v_con_ot + v_salieron;
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
        format('Gerencia aprobó la %s de %s Lleva %s unidades y tiene %s OT%s: carga %s.',
               new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente')), new.cantidad_unidades, v_con_ot - v_salieron,
               case when v_salieron > 0 then format(' (%s %s a otro comprador)', v_salieron, case when v_salieron = 1 then 'pasó' else 'pasaron' end) else '' end,
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
    -- Con varias unidades no hay un solo código que nombrar: se dice cuántas OT tiene.
    case when new.estado = 'APROBADA' and v_salieron > 0 and v_con_ot >= new.cantidad_unidades and v_con_ot = v_salieron
         then format('La %s de %s %s', new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente')),
                     case when v_salieron = 1 then 'Su OT pasó a otro comprador: ya no lleva otra OT.'
                          else 'Sus OT pasaron a otro comprador: ya no lleva otras OT.' end)
         when new.estado = 'APROBADA' and new.cantidad_unidades > 1 and v_con_ot >= new.cantidad_unidades and v_salieron > 0
         then format('La %s de %s Lleva %s unidades: %s con su OT y %s %s a otro comprador. Ya no lleva otra OT.',
                     new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente')), new.cantidad_unidades,
                     v_con_ot - v_salieron, v_salieron, case when v_salieron = 1 then 'pasó' else 'pasaron' end)
         when new.estado = 'APROBADA' and new.cantidad_unidades > 1 and v_con_ot >= new.cantidad_unidades
         then format('La %s de %s Sus %s unidades ya tienen su código interno y su OT.',
                     new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente')), new.cantidad_unidades)
         when new.estado = 'APROBADA' and new.cantidad_unidades > 1 and v_con_ot = 0
         then format('La %s de %s Lleva %s unidades: Administración le da a cada una su código interno y sube su OT.',
                     new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente')), new.cantidad_unidades)
         when new.estado = 'APROBADA' and new.cantidad_unidades > 1
         then format('La %s de %s Lleva %s unidades y tiene %s OT%s: Administración carga %s, cada una con su código interno.',
                     new.numero, public.con_punto_final(coalesce(v_cliente, 'un cliente')), new.cantidad_unidades, v_con_ot - v_salieron,
                     case when v_salieron > 0 then format(' (%s %s a otro comprador)', v_salieron, case when v_salieron = 1 then 'pasó' else 'pasaron' end) else '' end,
                     case when new.cantidad_unidades - v_con_ot = 1 then 'la que falta' else format('las %s que faltan', new.cantidad_unidades - v_con_ot) end)
         when new.estado = 'APROBADA' and v_codigo is not null
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

-- 9. Contabilidad no espera la factura de la venta cerrada -----------------------
create or replace function public.cotizaciones_para_facturar()
returns table (
  cotizacion_id uuid, numero text, codigo_interno text, cliente_id uuid, cliente text, cliente_documento text,
  cliente_direccion text, carroceria text, moneda text, monto_venta numeric, incluye_igv boolean,
  en_correccion boolean, aprobada_en timestamptz, archivo_ruta text, archivo_mime text, archivo_nombre text,
  facturas integer, facturado numeric, cobrado numeric,
  facturado_otra_moneda numeric, cobrado_otra_moneda numeric
) language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('contabilidad.facturar') or public.tiene_permiso('cotizaciones.ver_aprobadas')) then
    raise exception 'No tienes permiso para ver las cotizaciones aprobadas.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select c.id, c.numero, public.codigo_interno_de_cotizacion(c.id), c.cliente_id, cl.razon_social,
           case when cl.id is null then null else cl.tipo_documento::text || ' ' || cl.numero_documento end,
           nullif(concat_ws(', ', nullif(btrim(cl.direccion_fiscal), ''), nullif(btrim(cl.distrito), ''),
                            nullif(btrim(cl.provincia), ''), nullif(btrim(cl.departamento), '')), ''),
           tc.nombre, c.moneda::text, c.monto_venta::numeric, ig.incluye_igv,
           c.estado::text <> 'APROBADA', c.revisado_en,
           coalesce(case when c.estado::text = 'APROBADA' then c.ruta_storage end, va.ruta_storage),
           coalesce(case when c.estado::text = 'APROBADA' then c.mime_type end, va.mime_type),
           coalesce(case when c.estado::text = 'APROBADA' then c.nombre_archivo end, va.nombre_archivo),
           coalesce(fx.facturas, 0), coalesce(fx.facturado, 0), coalesce(fx.cobrado, 0),
           coalesce(fx.facturado_otra, 0), coalesce(fx.cobrado_otra, 0)
      from public.cotizaciones_pdf c
      left join public.clientes cl on cl.id = c.cliente_id
      left join public.tipos_carroceria tc on tc.id = c.tipo_carroceria_id
      left join public.cotizaciones_pdf_igv ig on ig.cotizacion_id = c.id
      left join lateral (
        select v.ruta_storage, v.mime_type, v.nombre_archivo from public.cotizaciones_pdf_versiones v
         where v.cotizacion_id = c.id and v.estado_al_archivar = 'APROBADA'
         order by v.version desc limit 1) va on true
      left join lateral (
        select count(*)::integer as facturas,
               sum(f.total) filter (where f.moneda::text = coalesce(c.moneda::text, 'PEN'))::numeric as facturado,
               sum(f.cobrado) filter (where f.moneda::text = coalesce(c.moneda::text, 'PEN'))::numeric as cobrado,
               sum(f.total) filter (where f.moneda::text <> coalesce(c.moneda::text, 'PEN'))::numeric as facturado_otra,
               sum(f.cobrado) filter (where f.moneda::text <> coalesce(c.moneda::text, 'PEN'))::numeric as cobrado_otra
          from (select f.moneda, f.total,
                       (select coalesce(sum(b.monto), 0) from public.cobros_factura_venta b
                         where b.factura_id = f.id and b.anulado_en is null) as cobrado
                  from public.facturas_venta f
                 where f.cotizacion_pdf_id = c.id and f.anulada_en is null) f) fx on true
     where c.estado::text <> 'ANULADA' and public.cotizacion_fue_aprobada(c.id)
       -- La venta cerrada (todas sus OT pasaron a otro comprador, 20261126988000)
       -- no se factura: sin facturas, no sale. Con alguna, sigue para cobrarla.
       and not (coalesce(fx.facturas, 0) = 0
                and not exists (select 1 from public.ordenes_trabajo t where t.cotizacion_pdf_id = c.id and t.estado <> 'ANULADA')
                and cardinality(public.ordenes_que_salieron_de_la_cotizacion(c.id, null)) >= coalesce(c.cantidad_unidades, 1))
     order by c.revisado_en desc nulls last
     limit 300;
end;
$$;

comment on function public.cotizaciones_para_facturar() is
  'Las cotizaciones aprobadas con su código interno, su cliente y su archivo, y lo facturado y cobrado sin las anuladas: `facturado` y `cobrado` en la moneda de la cotización, y lo de la otra moneda aparte, sin sumarlo (20261126960000). La venta cerrada, cuya OT pasó a otro comprador, queda fuera si no tiene facturas (20261126988000). Las 300 más nuevas. La leen Contabilidad, Tesorería, Gerencia y Administración.';

revoke all on function public.cotizaciones_para_facturar() from public, anon;
grant execute on function public.cotizaciones_para_facturar() to authenticated;
-- 10. Qué ventas de Facturación se cerraron ---------------------------------------
-- La venta que se facturó antes de que su OT pasara a otro comprador sigue en
-- Facturación, para cobrar o anular su factura, pero ya no espera que
-- Administración cargue su OT: la base no lo deja. Facturación pregunta aquí
-- cuáles de las que lista están así, con la misma regla que la sección 9 y el
-- mismo permiso que `cotizaciones_para_facturar` (no cambia su forma: sin DROP).
create or replace function public.ventas_cerradas_por_otro_comprador(p_ids uuid[])
returns table (cotizacion_id uuid, ordenes text[])
language plpgsql
stable
security definer
set search_path to 'public'
rows 10
as $$
begin
  if not (public.es_admin() or public.tiene_permiso('contabilidad.facturar') or public.tiene_permiso('cotizaciones.ver_aprobadas')) then
    raise exception 'No tienes permiso para ver las cotizaciones aprobadas.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select c.id, s.ordenes
      from public.cotizaciones_pdf c
      cross join lateral (select public.ordenes_que_salieron_de_la_cotizacion(c.id, null) as ordenes) s
     where c.id = any (p_ids)
       and c.estado::text <> 'ANULADA' and public.cotizacion_fue_aprobada(c.id)
       and not exists (select 1 from public.ordenes_trabajo t where t.cotizacion_pdf_id = c.id and t.estado <> 'ANULADA')
       and cardinality(s.ordenes) >= coalesce(c.cantidad_unidades, 1);
end;
$$;

comment on function public.ventas_cerradas_por_otro_comprador(uuid[]) is
  'De las cotizaciones dadas, las aprobadas cuya OT pasó a otro comprador y ya no llevan otra (todas sus unidades), con sus OT; el número, solo para quien lee o carga las órdenes. Facturación las muestra para cobrar o anular su factura, sin pedir OT (migración 20261126988000).';

revoke all on function public.ventas_cerradas_por_otro_comprador(uuid[]) from public, anon;
grant execute on function public.ventas_cerradas_por_otro_comprador(uuid[]) to authenticated;

-- 11. Ventas cancela la venta que se reabrió -------------------------------------
-- La venta cuya OT pasó a otro comprador y allí se anuló vuelve a esperar su OT
-- «hasta que el vendedor intervenga y cancele la venta» (StudioGRCI,
-- 2026-11-26). Cancelarla es anular la cotización: no se borra, queda con su
-- número, el motivo, quién y cuándo. Hasta aquí solo Gerencia podía anular
-- (`cotizaciones.revisar`); esto le abre a Ventas esa sola puerta.
--
-- Quién puede: quien registró la cotización, con `cotizaciones.crear`, y solo si
-- está aprobada, se reabrió (`ot_anulada_que_reabre_la_venta`: sin OT vigente) y
-- no tiene factura vigente (Contabilidad la anula primero). Lo preguntan los dos
-- disparadores que cuidan el cambio de estado, así que vale igual por la función
-- de abajo que por un UPDATE directo.
create or replace function public.puede_cancelar_la_venta(p_cotizacion uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.cotizaciones_pdf c
     where c.id = p_cotizacion
       and c.estado = 'APROBADA'
       and c.registrado_por = public.usuario_actual()
       and public.tiene_permiso('cotizaciones.crear')
       and public.ot_anulada_que_reabre_la_venta(c.id) is not null
       and not exists (select 1 from public.facturas_venta f
                        where f.cotizacion_pdf_id = c.id and f.anulada_en is null));
$$;

comment on function public.puede_cancelar_la_venta(uuid) is
  'Si quien llama puede cancelar esa venta: registró la cotización, está aprobada, se reabrió porque su OT pasó a otro comprador y se anuló, no tiene OT vigente ni factura vigente (migración 20261126988000).';

-- La llaman los disparadores de `cotizaciones_pdf` con el rol de quien escribe.
revoke all on function public.puede_cancelar_la_venta(uuid) from public, anon;
grant execute on function public.puede_cancelar_la_venta(uuid) to authenticated;

create or replace function public.cancelar_venta_reabierta(p_cotizacion uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yo     constant uuid := public.usuario_actual();
  v_motivo constant text := btrim(coalesce(p_motivo, ''));
  v_cot    record;
  v_ot     text;
begin
  select c.id, c.numero, c.estado::text as estado, c.registrado_por, c.anulado_por, c.motivo_anulacion
    into v_cot
    from public.cotizaciones_pdf c where c.id = p_cotizacion
     for update;
  if not found then
    raise exception 'Esa cotización no existe.' using errcode = 'check_violation';
  end if;
  if not (public.es_admin() or (public.tiene_permiso('cotizaciones.crear') and v_cot.registrado_por = v_yo)) then
    raise exception 'La venta la cancela quien registró la cotización %.', v_cot.numero using errcode = 'insufficient_privilege';
  end if;
  -- El mismo envío repetido (la respuesta se perdió) no falla. Con otro motivo,
  -- dice que ya quedó con el primero: el motivo de una anulación no se cambia.
  if v_cot.estado = 'ANULADA' and v_cot.anulado_por = v_yo and v_cot.motivo_anulacion = v_motivo then
    return;
  end if;
  if v_cot.estado = 'ANULADA' and v_cot.anulado_por = v_yo then
    raise exception 'La venta de la cotización % ya quedó cancelada la primera vez que la enviaste, con el motivo de entonces. Está en «Anuladas».', v_cot.numero
      using errcode = 'check_violation';
  end if;
  if v_cot.estado = 'ANULADA' then
    raise exception 'La cotización % ya está anulada.', v_cot.numero using errcode = 'check_violation';
  end if;
  if v_cot.estado <> 'APROBADA' then
    raise exception 'La cotización % no está aprobada: no hay venta que cancelar.', v_cot.numero using errcode = 'check_violation';
  end if;
  select o.numero into v_ot from public.ordenes_trabajo o
   where o.cotizacion_pdf_id = p_cotizacion and o.estado <> 'ANULADA'
   order by o.numero limit 1;
  if v_ot is not null then
    raise exception 'La cotización % tiene la OT % vigente: la venta sigue.', v_cot.numero, v_ot using errcode = 'check_violation';
  end if;
  if public.ot_anulada_que_reabre_la_venta(p_cotizacion) is null then
    raise exception 'La cotización % no volvió a esperar su OT por una OT anulada: anularla le toca a Gerencia.', v_cot.numero
      using errcode = 'check_violation';
  end if;
  -- Sin el número de la factura: Ventas no ve las facturas.
  if exists (select 1 from public.facturas_venta f where f.cotizacion_pdf_id = p_cotizacion and f.anulada_en is null) then
    raise exception 'La cotización % tiene una factura vigente: Contabilidad la anula primero, con su motivo.', v_cot.numero
      using errcode = 'check_violation';
  end if;
  if length(v_motivo) < 10 then
    raise exception 'Cuenta por qué se cancela la venta, en al menos 10 caracteres.' using errcode = 'check_violation';
  end if;

  update public.cotizaciones_pdf set estado = 'ANULADA', observacion = v_motivo where id = p_cotizacion;
end;
$$;

comment on function public.cancelar_venta_reabierta(uuid, text) is
  'Ventas cancela la venta que se reabrió porque su OT pasó a otro comprador y se anuló: anula la cotización con su motivo (no se borra). Solo quien la registró, aprobada, sin OT vigente ni factura vigente (migración 20261126988000).';

revoke all on function public.cancelar_venta_reabierta(uuid, text) from public, anon;
grant execute on function public.cancelar_venta_reabierta(uuid, text) to authenticated;

-- Los dos disparadores que cuidan el estado de la cotización le abren esa puerta.
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
    -- Ventas cancela la venta que se reabrió porque su OT pasó a otro comprador y
    -- se anuló: solo esa, y solo quien la registró (20261126988000).
    if not v_revisa and not (new.estado = 'ANULADA' and public.puede_cancelar_la_venta(old.id)) then
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

create or replace function public.fn_cotizacion_pdf_anular()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_orden text;
begin
  if old.estado = 'ANULADA' then
    raise exception 'La cotización % está anulada y se conserva como evidencia; crea una nueva.', old.numero;
  end if;

  if new.estado = 'ANULADA' then
    -- Anular es de Gerencia, salvo la venta que se reabrió: esa la cancela
    -- quien la registró (20261126988000).
    if not public.puede_cancelar_la_venta(old.id) then
      perform public.exigir_permiso('cotizaciones.revisar');
    elsif not (public.es_admin() or public.tiene_permiso('cotizaciones.revisar'))
          and length(btrim(coalesce(new.observacion, ''))) < 10 then
      -- La misma regla que `cancelar_venta_reabierta`, también por UPDATE directo.
      raise exception 'Cuenta por qué se cancela la venta, en al menos 10 caracteres.' using errcode = 'check_violation';
    end if;
    if nullif(btrim(new.observacion), '') is null then
      raise exception 'Indica el motivo de anulación de la cotización %.', old.numero;
    end if;
    select o.numero into v_orden from public.ordenes_trabajo o
      where o.cotizacion_pdf_id = old.id and o.estado <> 'ANULADA'
      limit 1;
    if v_orden is not null then
      raise exception 'La cotización % tiene la OT % activa; anula primero esa OT.', old.numero, v_orden;
    end if;
    new.motivo_anulacion := btrim(new.observacion);
    new.anulado_por := public.usuario_actual();
    new.anulado_en := now();
    -- La aprobación o el rechazo anteriores siguen atribuidos a quien los hizo.
    new.revisado_por := old.revisado_por;
    new.revisado_en := old.revisado_en;
  else
    new.motivo_anulacion := old.motivo_anulacion;
    new.anulado_por := old.anulado_por;
    new.anulado_en := old.anulado_en;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_cotizacion_pdf_anular() from public, anon, authenticated;

-- 12. Ventas se entera de que su venta volvió a esperar su OT ---------------------
-- La venta se reabre «hasta que el vendedor intervenga», así que el vendedor
-- tiene que saberlo: cuando se anula la OT que había pasado a otro comprador,
-- quien registró la cotización de origen recibe un aviso que lleva a su
-- tarjeta, donde está «Cancelar la venta». Disparador propio sobre la OT: no se
-- redefine ninguno de los que ya tiene. Va `after update` a secas y decide
-- adentro: el estado lo puede poner otro disparador.
create or replace function public.fn_ot_anulada_reabre_la_venta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c record;
begin
  for c in
    select q.id, q.numero, q.registrado_por, cl.razon_social
      from public.cotizaciones_pdf q
      left join public.clientes cl on cl.id = q.cliente_id
     where q.id in (select va.cotizacion_pdf_id from public.ot_ventas_anteriores va where va.orden_id = new.id)
       and q.estado = 'APROBADA'
       and public.ot_anulada_que_reabre_la_venta(q.id) = new.id
  loop
    -- Sin el número de la OT: lo dice la tarjeta, a quien puede leerlo.
    perform public.notificar_a_usuario(
      c.registrado_por,
      'Tu venta volvió a esperar su OT',
      format('La %s de %s Su OT pasó a otro comprador y allí se anuló. %s',
             c.numero, public.con_punto_final(coalesce(c.razon_social, 'un cliente')),
             -- Con una factura vigente la tarjeta no ofrece el botón: se dice qué va primero.
             case when exists (select 1 from public.facturas_venta f
                                where f.cotizacion_pdf_id = c.id and f.anulada_en is null)
                  then 'Si la venta ya no sigue, Contabilidad anula primero su factura y después la cancelas con «Cancelar la venta».'
                  else 'Si la venta ya no sigue, cancélala con «Cancelar la venta».' end),
      '/cotizaciones/pdf?estado=APROBADA_SIN_OT#' || c.id, 'cotizaciones_pdf', c.id, public.usuario_actual());
  end loop;
  return null;
end;
$$;

revoke all on function public.fn_ot_anulada_reabre_la_venta() from public, anon, authenticated;

create or replace trigger trg_ot_anulada_reabre_la_venta
  after update on public.ordenes_trabajo
  for each row
  when (old.estado is distinct from new.estado and new.estado = 'ANULADA')
  execute function public.fn_ot_anulada_reabre_la_venta();
