-- =============================================================================
-- CONTABILIDAD RECIBE EL AVISO DE CADA PAGO POR CONFIRMAR
-- -----------------------------------------------------------------------------
-- Desde la 20261022175000, la factura de una OC con boleta que se dio por pagada
-- fuera del sistema espera a que Contabilidad diga si esa OC ya se pagó o si
-- falta pagarla; mientras tanto Tesorería no la paga. Eso solo lo contaba el
-- globo del menú de Adquisiciones («Pago por confirmar»): la campana no decía
-- nada. DKS (26/10): «Contabilidad no recibe un aviso por cada pago por
-- confirmar: que reciba».
--
-- Desde aquí, cada OC que empieza a esperar deja un aviso a cada cuenta activa
-- con `adquisiciones.registrar`, también a la que registró la factura: es lo que
-- queda por hacer, no la noticia de lo que hizo (como los avisos de
-- `avisar_pago_directo` a Tesorería). Uno por OC y por persona mientras no lo lea.
-- Cuando la OC deja de esperar (Contabilidad dijo «Ya se pagó» o «Falta
-- pagarla», Tesorería la pasó a su lista, o la factura se anuló o dejó de ser de
-- esa OC), el aviso que siga sin leer se da por leído: ya no hay nada que hacer.
--
-- Una OC empieza a esperar cuando su factura queda registrada y es suya: por la
-- cabecera, por un vínculo o por el anexo de Logística que alcanza
-- (`facturas_de_la_compra`). Esas son las tablas que miran los disparadores, los
-- mismos tres de `fn_conciliar_pago_directo` y, para cuando deja de esperar, la
-- OC misma. Los disparadores corren al confirmar la transacción
-- (`deferrable initially deferred`): la corrección de una factura escribe la
-- cabecera y después sus vínculos, y a medio camino la OC podía parecer que
-- espera o que ya no.
--
-- Las OC que ya esperan reciben su aviso al aplicar esta migración.
--
-- Idempotente. Sin `drop` de funciones ni de políticas (los disparadores de
-- restricción no admiten `create or replace`: se sueltan y se crean).
-- =============================================================================

-- 1. El aviso de cada OC ------------------------------------------------------------
create or replace function public.avisar_pago_por_confirmar(p_compras uuid[])
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_oc     record;
  v_fact   text;
  v_titulo text;
  v_cuerpo text;
begin
  for v_oc in select c.id, public.nombre_de_oc(c.numero, c.referencia) as nombre,
                     (not c.con_factura and not c.pago_en_tesoreria and c.aprobacion in ('APROBADA', 'NO_REQUERIDA')) as dada_por_pagada
                from public.ordenes_compra_materiales c
               where c.id = any(p_compras) loop
    v_titulo := 'Pago por confirmar: ' || v_oc.nombre;
    v_fact := null;
    -- Lo mismo que mira `compra_pagada_fuera_de_la_factura`: una OC con boleta,
    -- aprobada, dada por pagada fuera, con una factura registrada que es suya.
    if v_oc.dada_por_pagada then
      select a.numero_documento into v_fact
        from public.facturas_de_la_compra(v_oc.id) f
        join public.adquisiciones a on a.id = f.adquisicion_id
       order by a.fecha_emision, a.creado_en
       limit 1;
    end if;
    if v_fact is null then
      update public.notificaciones set leida_en = now()
       where origen_tabla = 'ordenes_compra_materiales' and origen_id = v_oc.id
         and titulo = v_titulo and leida_en is null;
      continue;
    end if;
    v_cuerpo := 'La factura ' || v_fact || ' es de la ' || v_oc.nombre
             || ', que va con boleta y se dio por pagada fuera del sistema: no se paga hasta que digas, en Adquisiciones, '
             || 'si esa OC ya se pagó o si falta pagarla.';
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    select u.id, v_titulo, v_cuerpo, '/adquisiciones?vista=por-confirmar', 'ordenes_compra_materiales', v_oc.id
      from public.usuarios u
      join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'adquisiciones.registrar'
     where u.activo
       and not exists (select 1 from public.notificaciones n
                        where n.usuario_id = u.id and n.origen_id = v_oc.id and n.titulo = v_titulo and n.leida_en is null);
  end loop;
end;
$$;
comment on function public.avisar_pago_por_confirmar(uuid[]) is
  'Avisa a quien tiene adquisiciones.registrar de cada una de esas OC con boleta que espera que diga si ya se pagó (la factura de la OC dada por pagada fuera, migración 20261022175000), uno por persona mientras no lo lea, y da por leído el aviso de la que ya no espera. La llaman los disparadores de la factura, el vínculo, el anexo y la OC. Ayudante interno.';
revoke all on function public.avisar_pago_por_confirmar(uuid[]) from public, anon, authenticated;

-- 2. Quién la llama ------------------------------------------------------------------
-- La fila de la factura que se registra, se corrige o se anula, con sus OC de
-- antes y las de después; el vínculo que se agrega, se quita o cambia; el anexo
-- de factura que se agrega o se anula; y la OC que cambia lo que la hace esperar.
create or replace function public.fn_avisar_pago_por_confirmar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_compras uuid[];
begin
  if tg_table_name = 'adquisiciones' then
    if tg_op = 'INSERT' then
      if new.estado <> 'REGISTRADA' then return null; end if;
      v_compras := public.compras_de_la_factura(new);
    else
      if 'REGISTRADA' not in (new.estado, old.estado) then return null; end if;
      v_compras := public.compras_de_la_factura(old) || public.compras_de_la_factura(new);
    end if;
  elsif tg_table_name = 'adquisiciones_ordenes_compra' then
    v_compras := array[new.orden_compra_id]
              || case when tg_op = 'UPDATE' then array[old.orden_compra_id] else '{}'::uuid[] end;
  elsif tg_table_name = 'documentos_compra_material' then
    if new.tipo <> 'FACTURA' then return null; end if;
    v_compras := array[new.orden_compra_id];
  else
    if tg_op = 'UPDATE' and (new.con_factura, new.pago_en_tesoreria, new.aprobacion)
                            is not distinct from (old.con_factura, old.pago_en_tesoreria, old.aprobacion) then
      return null;
    end if;
    v_compras := array[new.id];
  end if;
  perform public.avisar_pago_por_confirmar(v_compras);
  return null;
end;
$$;
revoke all on function public.fn_avisar_pago_por_confirmar() from public, anon, authenticated;

drop trigger if exists trg_avisar_pago_por_confirmar_adquisicion on public.adquisiciones;
create constraint trigger trg_avisar_pago_por_confirmar_adquisicion
  after insert or update on public.adquisiciones
  deferrable initially deferred
  for each row execute function public.fn_avisar_pago_por_confirmar();
drop trigger if exists trg_avisar_pago_por_confirmar_vinculo on public.adquisiciones_ordenes_compra;
create constraint trigger trg_avisar_pago_por_confirmar_vinculo
  after insert or update on public.adquisiciones_ordenes_compra
  deferrable initially deferred
  for each row execute function public.fn_avisar_pago_por_confirmar();
drop trigger if exists trg_avisar_pago_por_confirmar_documento on public.documentos_compra_material;
create constraint trigger trg_avisar_pago_por_confirmar_documento
  after insert or update on public.documentos_compra_material
  deferrable initially deferred
  for each row execute function public.fn_avisar_pago_por_confirmar();
drop trigger if exists trg_avisar_pago_por_confirmar_compra on public.ordenes_compra_materiales;
create constraint trigger trg_avisar_pago_por_confirmar_compra
  after update on public.ordenes_compra_materiales
  deferrable initially deferred
  for each row execute function public.fn_avisar_pago_por_confirmar();

-- 3. Las que ya esperan ---------------------------------------------------------------
-- Las mismas OC desde las que busca `facturas_en_espera`; las que no tienen
-- factura registrada no dejan aviso.
select public.avisar_pago_por_confirmar(array(
  select c.id from public.ordenes_compra_materiales c
   where not c.con_factura and not c.pago_en_tesoreria and c.aprobacion in ('APROBADA', 'NO_REQUERIDA')));
