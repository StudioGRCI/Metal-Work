-- =============================================================================
-- Gerencia también cancela la venta que se reabrió, y Facturación sabe cuántas
-- unidades de una cotización pasaron a otro comprador.
--
-- Son las dos decisiones que quedaron abiertas al cerrar la venta cuya OT pasó
-- a otro comprador (migración 20261126988000, PR #271). StudioGRCI, 2026-11-26:
--
-- 1. «Sí, también Gerencia». La venta que se reabrió (su OT pasó a otro
--    comprador y allí se anuló) la cancela quien registró la cotización. Si esa
--    persona ya no trabaja aquí, la venta se quedaba esperando su OT sin que
--    nadie tuviera el botón: Gerencia podía anular la cotización en la base,
--    pero no por esta puerta. Ahora «Cancelar la venta» también es de Gerencia
--    (`cotizaciones.revisar`), con las mismas condiciones: aprobada, reabierta,
--    sin OT vigente ni factura vigente, y con su motivo. La cotización queda
--    anulada, no borrada. Y si quien la registró ya no puede cancelarla (no
--    tiene cuenta activa, o cambió a un puesto que no registra cotizaciones),
--    el aviso de «volvió a esperar su OT» le llega a Gerencia, que es quien
--    puede decidir: al reabrirse la venta, o cuando esa cuenta se da de baja o
--    cambia de puesto con la venta ya reabierta. La tarjeta se lo dice a
--    Gerencia y sube entre lo que le toca. Cancelada la venta, esos avisos se
--    dan por leídos.
--
-- 2. «Avisar a Contabilidad». Cuando una unidad de una cotización de varias pasó
--    a otro comprador, a Contabilidad se le sigue mostrando el total de la
--    cotización entera. La cotización guarda un solo monto, no el precio de cada
--    unidad, así que el sistema no descuenta nada: Facturación dice cuántas
--    unidades pasaron y Contabilidad decide cuánto factura.
--
-- No borra nada: reemplaza cuatro funciones de la 20261126988000, cada una solo
-- si sigue siendo la que se conoce (la guarda de la huella), y crea una función
-- de lectura, dos ayudantes internos y dos disparadores propios (uno en
-- `usuarios`, otro en `cotizaciones_pdf`). El único dato que toca es `leida_en`
-- de un aviso que ya no pide nada, y solo al anularse su cotización. Idempotente. Se aplica después de la
-- 20261126988000, y antes de desplegar la aplicación: Facturación llama a la
-- función nueva y sin ella no carga.
-- =============================================================================

-- 0. La guarda de la huella -----------------------------------------------------
do $$
declare
  f record;
  huella text;
begin
  for f in
    select * from (values
      ('public.puede_cancelar_la_venta(uuid)', array['ff1f5d71eae2f7b04df64bb9d027654f', '277c5917c2fa37dc1a88afa3c0e1cc04']),
      ('public.cancelar_venta_reabierta(uuid,text)', array['b66c7f01befd3d68d6d67f01ee81053e', '7a20f4a55d0a7acbb4b00712f03d9079']),
      ('public.fn_ot_anulada_reabre_la_venta()', array['cc63f1120fa58f6909f4e44c5e53b822', '96108089eeb6278f15b74ac8cae87c6f']),
      ('public.venta_reabierta(uuid)', array['356a867a5b631eb26b9cbc5a004890ef', 'b799409c70d2a16e29eb6d04416758cd'])
    ) as t(firma, conocidas)
  loop
    select md5(replace(p.prosrc, E'\r', '')) into huella from pg_proc p where p.oid = to_regprocedure(f.firma);
    if huella is null then
      raise exception 'Falta la función %: esta base no tiene la migración 20261126988000.', f.firma;
    end if;
    if not (huella = any (f.conocidas)) then
      raise exception 'La función % no es la que conoce el repositorio (se cambió a mano): no se reemplaza. Avisa antes de seguir.', f.firma;
    end if;
  end loop;
end $$;

-- 0b. Si quien registró la cotización la puede cancelar todavía --------------------
-- La puede cancelar mientras tenga cuenta activa y su puesto registre
-- cotizaciones (`cotizaciones.crear`, o administrador del sistema): lo mismo que
-- le pide `puede_cancelar_la_venta`. Con la cuenta de baja, o pasada a otro
-- puesto, el aviso le pediría algo que ya no puede hacer. Son ayudantes internos:
-- los llaman las funciones de abajo, no la gente.
create or replace function public.cuenta_que_registra_cotizaciones(p_activo boolean, p_rol uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(p_activo, false)
     and exists (select 1 from public.roles r
                  where r.id = p_rol
                    and (r.codigo = 'ADMIN'
                         or exists (select 1 from public.roles_permisos rp
                                     where rp.rol_id = r.id and rp.permiso_codigo = 'cotizaciones.crear')));
$$;

comment on function public.cuenta_que_registra_cotizaciones(boolean, uuid) is
  'Si una cuenta con ese estado y ese rol registra cotizaciones: activa y con cotizaciones.crear, o administrador del sistema. Ayudante interno (migración 20261126998600).';

revoke all on function public.cuenta_que_registra_cotizaciones(boolean, uuid) from public, anon, authenticated;

create or replace function public.quien_registro_la_puede_cancelar(p_cotizacion uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.cotizaciones_pdf c
                   join public.usuarios u on u.id = c.registrado_por
                  where c.id = p_cotizacion and public.cuenta_que_registra_cotizaciones(u.activo, u.rol_id));
$$;

comment on function public.quien_registro_la_puede_cancelar(uuid) is
  'Si quien registró esa cotización sigue con cuenta activa en un puesto que registra cotizaciones. Ayudante interno (migración 20261126998600).';

revoke all on function public.quien_registro_la_puede_cancelar(uuid) from public, anon, authenticated;

-- 1. Quién puede cancelar la venta que se reabrió --------------------------------
-- Quien registró la cotización, con `cotizaciones.crear`, o Gerencia
-- (`cotizaciones.revisar`). Lo demás no cambia: aprobada, reabierta y sin
-- factura vigente. Los dos disparadores de `cotizaciones_pdf` siguen preguntando
-- aquí; para Gerencia no cambia nada en ellos, porque ya anulaba por su permiso.
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
       and (public.es_admin()
            or public.tiene_permiso('cotizaciones.revisar')
            or (c.registrado_por = public.usuario_actual() and public.tiene_permiso('cotizaciones.crear')))
       and public.ot_anulada_que_reabre_la_venta(c.id) is not null
       and not exists (select 1 from public.facturas_venta f
                        where f.cotizacion_pdf_id = c.id and f.anulada_en is null));
$$;

comment on function public.puede_cancelar_la_venta(uuid) is
  'Si quien llama puede cancelar esa venta: registró la cotización o es Gerencia (cotizaciones.revisar), está aprobada, se reabrió porque su OT pasó a otro comprador y se anuló, no tiene OT vigente ni factura vigente (migraciones 20261126988000 y 20261126998600).';

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
  v_revisa constant boolean := public.es_admin() or public.tiene_permiso('cotizaciones.revisar');
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
  -- Quien la registró, o Gerencia: si esa persona ya no está, alguien tiene que poder cerrarla.
  if not (v_revisa or (public.tiene_permiso('cotizaciones.crear') and v_cot.registrado_por = v_yo)) then
    raise exception 'La venta la cancela quien registró la cotización %, o Gerencia General.', v_cot.numero using errcode = 'insufficient_privilege';
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
    if v_revisa then
      raise exception 'La cotización % no volvió a esperar su OT por una OT anulada: «Cancelar la venta» es solo para la venta que se reabrió.', v_cot.numero
        using errcode = 'check_violation';
    end if;
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
  'Cancela la venta que se reabrió porque su OT pasó a otro comprador y se anuló: anula la cotización con su motivo (no se borra). Quien la registró o Gerencia (cotizaciones.revisar), aprobada, sin OT vigente ni factura vigente (migraciones 20261126988000 y 20261126998600).';

revoke all on function public.cancelar_venta_reabierta(uuid, text) from public, anon;
grant execute on function public.cancelar_venta_reabierta(uuid, text) to authenticated;

-- 2. El aviso llega a quien puede decidir ----------------------------------------
-- A quien registró la cotización, como hasta ahora. Si esa persona ya no tiene
-- cuenta activa, el aviso no le llegaba a nadie, y si cambió a un puesto que no
-- registra cotizaciones le pedía algo que no puede hacer: va a Gerencia, que
-- ahora tiene el botón. A Gerencia se le avisa aunque sea ella quien anuló la OT: anuló la
-- OT del otro comprador, y que eso reabre una venta de antes no lo dice nada más.
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
    select q.id, q.numero, q.registrado_por, cl.razon_social,
           public.quien_registro_la_puede_cancelar(q.id) as con_vendedor,
           exists (select 1 from public.facturas_venta f
                    where f.cotizacion_pdf_id = q.id and f.anulada_en is null) as facturada
      from public.cotizaciones_pdf q
      left join public.clientes cl on cl.id = q.cliente_id
     where q.id in (select va.cotizacion_pdf_id from public.ot_ventas_anteriores va where va.orden_id = new.id)
       and q.estado = 'APROBADA'
       and public.ot_anulada_que_reabre_la_venta(q.id) = new.id
  loop
    if c.con_vendedor then
      -- Sin el número de la OT: lo dice la tarjeta, a quien puede leerlo.
      perform public.notificar_a_usuario(
        c.registrado_por,
        'Tu venta volvió a esperar su OT',
        format('La %s de %s Su OT pasó a otro comprador y allí se anuló. %s',
               c.numero, public.con_punto_final(coalesce(c.razon_social, 'un cliente')),
               -- Con una factura vigente la tarjeta no ofrece el botón: se dice qué va primero.
               case when c.facturada
                    then 'Si la venta ya no sigue, Contabilidad anula primero su factura y después la cancelas con «Cancelar la venta».'
                    else 'Si la venta ya no sigue, cancélala con «Cancelar la venta».' end),
        '/cotizaciones/pdf?estado=APROBADA_SIN_OT#' || c.id, 'cotizaciones_pdf', c.id, public.usuario_actual());
    else
      perform public.notificar_a_permiso(
        'cotizaciones.revisar',
        'Una venta volvió a esperar su OT',
        format('La %s de %s Su OT pasó a otro comprador y allí se anuló, y quien registró la cotización ya no tiene cuenta activa o cambió de puesto. %s',
               c.numero, public.con_punto_final(coalesce(c.razon_social, 'un cliente')),
               case when c.facturada
                    then 'Si la venta ya no sigue, Contabilidad anula primero su factura y después la cancelas con «Cancelar la venta».'
                    else 'Si la venta ya no sigue, cancélala con «Cancelar la venta».' end),
        '/cotizaciones/pdf?estado=APROBADA_SIN_OT#' || c.id, 'cotizaciones_pdf', c.id, null);
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.fn_ot_anulada_reabre_la_venta() from public, anon, authenticated;

-- 2b. La cuenta que se va con una venta reabierta ---------------------------------
-- Si la venta se reabrió con quien la registró todavía aquí, el aviso salió para
-- esa persona. Cuando después su cuenta se da de baja, o pasa a un puesto que no
-- registra cotizaciones, nadie más sabía que esa venta esperaba una decisión:
-- en ese momento se le avisa a Gerencia. Disparador propio, que no impide nada.
create or replace function public.fn_usuario_deja_su_venta_reabierta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c record;
begin
  if not public.cuenta_que_registra_cotizaciones(old.activo, old.rol_id)
     or public.cuenta_que_registra_cotizaciones(new.activo, new.rol_id) then
    return null;
  end if;
  for c in
    select q.id, q.numero, cl.razon_social,
           exists (select 1 from public.facturas_venta f
                    where f.cotizacion_pdf_id = q.id and f.anulada_en is null) as facturada
      from public.cotizaciones_pdf q
      left join public.clientes cl on cl.id = q.cliente_id
     where q.registrado_por = new.id
       and q.estado = 'APROBADA'
       and public.ot_anulada_que_reabre_la_venta(q.id) is not null
  loop
    perform public.notificar_a_permiso(
      'cotizaciones.revisar',
      'Una venta volvió a esperar su OT',
      format('La %s de %s Su OT pasó a otro comprador y allí se anuló, y quien registró la cotización ya no tiene cuenta activa o cambió de puesto. %s',
             c.numero, public.con_punto_final(coalesce(c.razon_social, 'un cliente')),
             case when c.facturada
                  then 'Si la venta ya no sigue, Contabilidad anula primero su factura y después la cancelas con «Cancelar la venta».'
                  else 'Si la venta ya no sigue, cancélala con «Cancelar la venta».' end),
      '/cotizaciones/pdf?estado=APROBADA_SIN_OT#' || c.id, 'cotizaciones_pdf', c.id, null);
  end loop;
  return null;
end;
$$;

comment on function public.fn_usuario_deja_su_venta_reabierta() is
  'Cuando una cuenta deja de poder registrar cotizaciones (baja o cambio de puesto) y tiene ventas reabiertas, avisa a Gerencia, que las puede cancelar (migración 20261126998600).';

revoke all on function public.fn_usuario_deja_su_venta_reabierta() from public, anon, authenticated;

-- Sin lista de columnas: decide con lo que cambió, no con lo que nombra el SET.
create or replace trigger trg_usuario_deja_su_venta_reabierta
  after update on public.usuarios
  for each row
  when (old.activo is distinct from new.activo or old.rol_id is distinct from new.rol_id)
  execute function public.fn_usuario_deja_su_venta_reabierta();

-- 2c. Cancelada la venta, sus avisos ya no piden nada -----------------------------
-- El aviso de Gerencia llega a todas sus cuentas. Cuando una la cancelaba, a las
-- otras les quedaba sin leer «cancélala…», con un enlace a una tarjeta que ya no
-- está entre las aprobadas. Anulada la cotización, por esta puerta o por la de
-- Gerencia, los avisos de la reapertura se dan por leídos.
create or replace function public.fn_cotizacion_anulada_cierra_sus_avisos()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.notificaciones
     set leida_en = now()
   where origen_tabla = 'cotizaciones_pdf' and origen_id = new.id
     and titulo in ('Tu venta volvió a esperar su OT', 'Una venta volvió a esperar su OT')
     and leida_en is null;
  return null;
end;
$$;

comment on function public.fn_cotizacion_anulada_cierra_sus_avisos() is
  'Al anularse una cotización, da por leídos los avisos de que su venta volvió a esperar su OT: ya no piden nada (migración 20261126998600).';

revoke all on function public.fn_cotizacion_anulada_cierra_sus_avisos() from public, anon, authenticated;

create or replace trigger trg_cotizacion_anulada_cierra_sus_avisos
  after update on public.cotizaciones_pdf
  for each row
  when (new.estado = 'ANULADA' and old.estado is distinct from new.estado)
  execute function public.fn_cotizacion_anulada_cierra_sus_avisos();

-- 3. Facturación sabe cuántas unidades pasaron a otro comprador -------------------
-- La cotización de varias unidades de la que alguna pasó a otro comprador sigue
-- en Facturación con su total entero. De las cotizaciones dadas, las que están
-- así: al menos una unidad pasó y todavía queda alguna que es de esta venta (la
-- que las perdió todas es la «venta cerrada», que ya se dice aparte). Sin el
-- número de las OT: Contabilidad no las necesita para decidir el monto. Con el
-- mismo permiso que `cotizaciones_para_facturar`, cuya forma no cambia (sin DROP).
create or replace function public.unidades_que_pasaron_a_otro_comprador(p_ids uuid[])
returns table (cotizacion_id uuid, pasaron integer, unidades integer)
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
    select c.id, s.pasaron, coalesce(c.cantidad_unidades, 1)::integer
      from public.cotizaciones_pdf c
      cross join lateral (select cardinality(public.ordenes_que_salieron_de_la_cotizacion(c.id, null))::integer as pasaron) s
     where c.id = any (p_ids)
       and c.estado::text <> 'ANULADA' and public.cotizacion_fue_aprobada(c.id)
       and s.pasaron >= 1
       and s.pasaron < coalesce(c.cantidad_unidades, 1);
end;
$$;

comment on function public.unidades_que_pasaron_a_otro_comprador(uuid[]) is
  'De las cotizaciones dadas, las aprobadas de varias unidades de las que alguna pasó a otro comprador y otra sigue siendo de esta venta: cuántas pasaron y de cuántas. Facturación lo avisa junto al total, que sigue siendo el de la cotización entera (migración 20261126998600).';

revoke all on function public.unidades_que_pasaron_a_otro_comprador(uuid[]) from public, anon;
grant execute on function public.unidades_que_pasaron_a_otro_comprador(uuid[]) to authenticated;

-- 4. Gerencia sabe si quien registró la cotización la puede cancelar todavía --------
-- La tarjeta de la venta reabierta le dice a Gerencia que la cancela quien la
-- registró. Si esa persona ya no tiene cuenta activa o cambió de puesto, eso no
-- va a pasar: la tarjeta se lo dice y sube entre lo que le toca. Solo a quien
-- revisa cotizaciones: a los demás la lista no les cuenta quién sigue y quién
-- no. La forma de la vista no cambia.
create or replace function public.venta_reabierta(p_cotizacion uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
           'numero',
           case when public.es_admin() or public.tiene_permiso('ordenes.ver') or public.tiene_permiso('ordenes.crear')
                then o.numero end,
           'sin_quien_la_registro',
           (public.es_admin() or public.tiene_permiso('cotizaciones.revisar'))
           and not public.quien_registro_la_puede_cancelar(p_cotizacion))
    from public.ordenes_trabajo o
   where o.id = public.ot_anulada_que_reabre_la_venta(p_cotizacion);
$$;

comment on function public.venta_reabierta(uuid) is
  'Si la venta de esa cotización se reabrió (su OT pasó a otro comprador y allí se anuló): el número de esa OT, a quien lee las órdenes, y si quien registró la cotización ya no la puede cancelar (sin cuenta activa o en otro puesto), a quien revisa cotizaciones. NULL si no se reabrió (migraciones 20261126988000 y 20261126998600).';

revoke all on function public.venta_reabierta(uuid) from public, anon;
grant execute on function public.venta_reabierta(uuid) to authenticated;
