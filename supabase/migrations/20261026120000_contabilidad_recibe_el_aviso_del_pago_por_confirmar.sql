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
-- Desde aquí, cada factura que empieza a esperar deja un aviso a cada cuenta
-- activa con `adquisiciones.registrar`, también a la que la registró: es lo que
-- queda por hacer, no la noticia de lo que hizo (como los avisos de
-- `avisar_pago_directo` a Tesorería). El aviso es de la OC por la que espera, la
-- misma que la pestaña «Pago por confirmar» pregunta
-- (`compra_pagada_fuera_de_la_factura`): si la factura es de dos OC dadas por
-- pagadas fuera, se pregunta por una y, cuando Contabilidad la responde, llega el
-- aviso de la otra. Así la campana y el globo cuentan lo mismo.
--
-- Uno por OC y por persona: no se repite mientras diga lo mismo, aunque ya se
-- haya leído; si cambia (la factura se corrigió con otro número), el de antes se
-- da por leído y entra el nuevo. Cuando la OC deja de esperar (Contabilidad dijo
-- «Ya se pagó» o «Falta pagarla», Tesorería la pasó a su lista, o la factura se
-- anuló o dejó de ser de esa OC), el aviso que siga sin leer se da por leído: ya
-- no hay nada que hacer.
--
-- Una OC empieza a esperar cuando su factura queda registrada y es suya: por la
-- cabecera, por un vínculo o por el anexo de Logística que alcanza
-- (`facturas_de_la_compra`, que mira también la moneda y el proveedor de la OC).
-- Esas son las tablas que miran los disparadores, los mismos tres de
-- `fn_conciliar_pago_directo`, y la OC misma. Corren al confirmar la transacción
-- (`deferrable initially deferred`): la corrección de una factura escribe la
-- cabecera y después sus vínculos, y a medio camino la OC podía parecer que
-- espera o que ya no.
--
-- Las OC que ya esperan reciben su aviso al aplicar esta migración.
--
-- Idempotente: volver a correrla no repite ningún aviso. Sin `drop`.
-- =============================================================================

-- 1. El aviso de cada OC ------------------------------------------------------------
-- Recibe las OC que cambiaron y mira también las que comparten factura con ellas:
-- responder por una puede hacer que la factura pase a preguntar por otra.
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
  for v_oc in select c.id, public.nombre_de_oc(c.numero, c.referencia) as nombre
                from public.ordenes_compra_materiales c
               where c.id in (select x.id from unnest(p_compras) x(id)
                              union
                              select o.id
                                from unnest(p_compras) x(id)
                               cross join lateral public.facturas_de_la_compra(x.id) f
                                join public.adquisiciones a on a.id = f.adquisicion_id
                               cross join lateral unnest(public.compras_de_la_factura(a)) o(id))
                 and not c.con_factura loop
    v_titulo := 'Pago por confirmar: ' || v_oc.nombre;
    -- La primera factura registrada de la OC que espera por ella.
    select a.numero_documento into v_fact
      from public.facturas_de_la_compra(v_oc.id) f
      join public.adquisiciones a on a.id = f.adquisicion_id
     where (select e.orden_compra_id from public.compra_pagada_fuera_de_la_factura(a) e) = v_oc.id
     order by a.fecha_emision, a.creado_en
     limit 1;
    v_cuerpo := case when v_fact is not null then
                  'La factura ' || v_fact || ' es de la ' || v_oc.nombre
                  || ', que va con boleta y se dio por pagada fuera del sistema: no se paga hasta que digas, en Adquisiciones, '
                  || 'si esa OC ya se pagó o si falta pagarla.' end;
    -- El que ya no corre, o cambió, se da por leído; el nuevo entra abajo.
    update public.notificaciones set leida_en = now()
     where origen_tabla = 'ordenes_compra_materiales' and origen_id = v_oc.id
       and titulo = v_titulo and leida_en is null
       and cuerpo is distinct from v_cuerpo;
    continue when v_fact is null;
    insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
    select u.id, v_titulo, v_cuerpo, '/adquisiciones?vista=por-confirmar', 'ordenes_compra_materiales', v_oc.id
      from public.usuarios u
      join public.roles_permisos rp on rp.rol_id = u.rol_id and rp.permiso_codigo = 'adquisiciones.registrar'
     where u.activo
       and not exists (select 1 from public.notificaciones n
                        where n.usuario_id = u.id and n.origen_id = v_oc.id and n.titulo = v_titulo and n.cuerpo = v_cuerpo);
  end loop;
end;
$$;
comment on function public.avisar_pago_por_confirmar(uuid[]) is
  'Avisa a quien tiene adquisiciones.registrar de cada una de esas OC con boleta (y de las que comparten factura con ellas) por la que una factura espera que diga si ya se pagó (migración 20261022175000), uno por persona mientras diga lo mismo, y da por leído el aviso de la que ya no espera o cambió. La llaman los disparadores de la factura, el vínculo, el anexo y la OC. Ayudante interno.';
revoke all on function public.avisar_pago_por_confirmar(uuid[]) from public, anon, authenticated;

-- 2. Quién la llama ------------------------------------------------------------------
-- La factura que se registra, se corrige o se anula, con sus OC de antes y las
-- de después (solo si cambia algo que decide de qué OC es o qué dice el aviso);
-- el vínculo que se agrega, se quita o cambia; el anexo de factura que se agrega
-- o se anula; y la OC que cambia algo que decide si espera o si la factura
-- anexada alcanza para ella.
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
      if 'REGISTRADA' not in (new.estado, old.estado)
         or (new.estado, new.total, new.moneda, new.numero_documento, new.proveedor, new.ruc_proveedor, new.documento_compra_id,
             new.orden_compra_id, new.tipo, new.fecha_emision)
            is not distinct from (old.estado, old.total, old.moneda, old.numero_documento, old.proveedor, old.ruc_proveedor,
                                  old.documento_compra_id, old.orden_compra_id, old.tipo, old.fecha_emision) then
        return null;
      end if;
      v_compras := public.compras_de_la_factura(old) || public.compras_de_la_factura(new);
    end if;
  elsif tg_table_name = 'adquisiciones_ordenes_compra' then
    v_compras := array[new.orden_compra_id]
              || case when tg_op = 'UPDATE' then array[old.orden_compra_id] else '{}'::uuid[] end;
  elsif tg_table_name = 'documentos_compra_material' then
    if new.tipo <> 'FACTURA' then return null; end if;
    v_compras := array[new.orden_compra_id];
  else
    -- El número y la referencia, separados: dicen cómo se nombra la OC en el aviso.
    if (new.numero, new.con_factura, new.pago_en_tesoreria, new.aprobacion, new.moneda, new.proveedor_id, new.proveedor,
        new.referencia)
       is not distinct from (old.numero, old.con_factura, old.pago_en_tesoreria, old.aprobacion, old.moneda, old.proveedor_id,
                             old.proveedor, old.referencia) then
      return null;
    end if;
    v_compras := array[new.id];
  end if;
  perform public.avisar_pago_por_confirmar(v_compras);
  return null;
end;
$$;
revoke all on function public.fn_avisar_pago_por_confirmar() from public, anon, authenticated;

do $$
declare
  v record;
begin
  for v in select * from (values
             ('trg_avisar_pago_por_confirmar_adquisicion', 'public.adquisiciones', 'insert or update'),
             ('trg_avisar_pago_por_confirmar_vinculo', 'public.adquisiciones_ordenes_compra', 'insert or update'),
             ('trg_avisar_pago_por_confirmar_documento', 'public.documentos_compra_material', 'insert or update'),
             ('trg_avisar_pago_por_confirmar_compra', 'public.ordenes_compra_materiales', 'update')) t(nombre, tabla, cuando) loop
    if not exists (select 1 from pg_trigger where tgname = v.nombre and tgrelid = v.tabla::regclass) then
      execute format('create constraint trigger %I after %s on %s deferrable initially deferred '
                     'for each row execute function public.fn_avisar_pago_por_confirmar()', v.nombre, v.cuando, v.tabla);
    end if;
  end loop;
end $$;

-- 3. Las que ya esperan ---------------------------------------------------------------
-- Las mismas OC desde las que busca `facturas_en_espera`; las que no tienen
-- factura registrada no dejan aviso.
select public.avisar_pago_por_confirmar(array(
  select c.id from public.ordenes_compra_materiales c
   where not c.con_factura and not c.pago_en_tesoreria and c.aprobacion in ('APROBADA', 'NO_REQUERIDA')));
