-- =============================================================================
-- LO QUE HALLÓ EL MANUAL DE VENTAS
-- -----------------------------------------------------------------------------
-- Al recorrer el sistema con la cuenta de Ventas para su manual (25/10) salieron
-- tres cosas de la base que DKS mandó corregir el 26/10:
--
--   1. El aviso «Gerencia rechazó tu cotización» decía «…volver a subir..
--      Corrígela…»: la observación de Gerencia casi siempre termina en punto y
--      el aviso le ponía otro.
--   2. Ventas podía subir una corrección de una cotización aprobada que
--      Contabilidad ya había facturado: la cotización volvía a «por revisar» con
--      otro monto, y la factura quedaba colgando de un papel que ya no decía lo
--      mismo. DKS: «si ya está facturada, prohibido». Y lo inverso: una
--      cotización con una corrección que Gerencia aún no aprueba no se factura,
--      porque no se sabe cuál de los dos montos vale.
--   3. La ficha del cliente decía «Vendedor: —» aunque Ventas le había subido
--      la cotización: la columna existía desde el principio, pero nada la
--      llenaba. Ahora la pone quien le da de alta al cliente o le sube su primera
--      cotización desde Ventas, y los clientes de antes la toman de su primera
--      cotización.
--   4. Al probar con la cuenta de Ventas lo que hace con clientes y unidades,
--      registrar o corregir una unidad caía con «permission denied for function
--      normalizar_codigo_interno»: desde la 20261017401000 un disparador de
--      `unidades` la llama con el rol de quien escribe, y la 20261014220000 le
--      había quitado el permiso a `authenticated`. Lo mismo esperaba a otros
--      cuatro disparadores que la llaman igual (requerimientos, salidas del
--      almacén, cierres de costo y la OT de garantía) cuando alguien escribe
--      directo en su tabla.
-- =============================================================================

-- 1. El aviso del rechazo, sin doble punto ---------------------------------------
-- Se reemplaza solo la frase dentro de la función tal como está en la base, para
-- no pisar lo que otra migración le haya cambiado. Si la observación ya termina
-- en punto, signo o puntos suspensivos, no se le agrega otro.
do $migracion$
declare
  v_def   text := pg_get_functiondef('public.fn_cotizacion_pdf_avisa()'::regprocedure);
  v_viejo constant text := $v$format('La %s: %s. Corrígela y sube la corrección.', new.numero, coalesce(new.observacion, 'sin motivo'))$v$;
  v_nuevo constant text := $v$format('La %s: %s Corrígela y sube la corrección.', new.numero,
                case when btrim(coalesce(new.observacion, '')) = '' then 'Sin motivo.'
                     when btrim(new.observacion) ~ '[.!?…]$' then btrim(new.observacion)
                     else btrim(new.observacion) || '.' end)$v$;
begin
  if position(v_nuevo in v_def) > 0 then
    return;
  end if;
  if position(v_viejo in v_def) = 0 then
    raise exception 'fn_cotizacion_pdf_avisa no tiene el texto que esta migración corrige: revisar a mano.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end
$migracion$;

revoke all on function public.fn_cotizacion_pdf_avisa() from public, anon, authenticated;

-- Los avisos que ya llegaron con el doble punto se leen bien desde hoy. Es el
-- texto de una notificación, no un documento: se corrige en el sitio.
update public.notificaciones
   set cuerpo = regexp_replace(cuerpo, '([.!?…])\. Corrígela y sube la corrección\.$', '\1 Corrígela y sube la corrección.')
 where titulo = 'Gerencia rechazó tu cotización'
   and cuerpo ~ '[.!?…]\. Corrígela y sube la corrección\.$';

-- 2. La cotización facturada no se corrige, y la que espera corrección no se factura
-- Disparadores propios, sin redefinir la revisión de la cotización ni la guardia
-- de la factura. Los dos leen la otra tabla por encima del RLS: Ventas no ve las
-- facturas y la regla tiene que valer igual.
create or replace function public.fn_cotizacion_facturada_no_se_corrige()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_factura text;
begin
  -- Una corrección es un archivo nuevo (fn_cotizacion_pdf_revision sube la
  -- versión justo por eso). Aprobar, rechazar o anular no pasan por aquí.
  if new.ruta_storage is not distinct from old.ruta_storage then
    return new;
  end if;
  select f.numero into v_factura
    from public.facturas_venta f
   where f.cotizacion_pdf_id = old.id and f.anulada_en is null
   order by f.creado_en
   limit 1;
  if v_factura is not null then
    raise exception 'La cotización % ya tiene la factura %: no se corrige. Si hay que cambiarla, Contabilidad anula primero la factura con su motivo.',
      old.numero, v_factura
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

revoke all on function public.fn_cotizacion_facturada_no_se_corrige() from public, anon, authenticated;

drop trigger if exists trg_cotizacion_pdf_facturada_no_se_corrige on public.cotizaciones_pdf;
create trigger trg_cotizacion_pdf_facturada_no_se_corrige
  before update on public.cotizaciones_pdf
  for each row execute function public.fn_cotizacion_facturada_no_se_corrige();

create or replace function public.fn_factura_venta_cotizacion_al_dia()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_numero text;
  v_estado text;
begin
  select c.numero, c.estado::text into v_numero, v_estado
    from public.cotizaciones_pdf c
   where c.id = new.cotizacion_pdf_id;
  -- registrar_factura_venta ya exige que la cotización haya sido aprobada
  -- alguna vez; aquí, además, que la versión de hoy sea la aprobada.
  if v_estado is distinct from 'APROBADA' then
    raise exception 'La cotización % tiene una corrección que Gerencia todavía no aprueba: se factura cuando la apruebe.',
      coalesce(v_numero, '')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

revoke all on function public.fn_factura_venta_cotizacion_al_dia() from public, anon, authenticated;

drop trigger if exists trg_factura_venta_cotizacion_al_dia on public.facturas_venta;
create trigger trg_factura_venta_cotizacion_al_dia
  before insert on public.facturas_venta
  for each row execute function public.fn_factura_venta_cotizacion_al_dia();

-- La pantalla de Ventas no ve las facturas, pero tiene que saber cuáles de sus
-- cotizaciones ya no se corrigen para no ofrecerle el botón. Solo dice cuáles
-- tienen factura vigente: ni el número ni el monto.
create or replace function public.cotizaciones_con_factura(p_ids uuid[])
returns table (cotizacion uuid)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select distinct f.cotizacion_pdf_id
    from public.facturas_venta f
   where f.cotizacion_pdf_id = any(p_ids)
     and f.anulada_en is null
     and (public.es_admin()
          or public.tiene_permiso('cotizaciones.ver_pdf_comercial')
          or public.tiene_permiso('cotizaciones.ver_aprobadas')
          or public.tiene_permiso('tesoreria.ver_documentos'));
$function$;

revoke all on function public.cotizaciones_con_factura(uuid[]) from public, anon;
grant execute on function public.cotizaciones_con_factura(uuid[]) to authenticated;

-- 3. El vendedor del cliente ------------------------------------------------------
-- Es quien cotiza (`cotizaciones.crear`): el que le da de alta o el que le sube
-- la primera cotización. El administrador no cuenta, aunque entre por todo. Si
-- el cliente ya tiene vendedor, no se cambia.
create or replace function public.fn_cliente_toma_su_vendedor()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.vendedor_id is null and not public.es_admin() and public.tiene_permiso('cotizaciones.crear') then
    new.vendedor_id := public.usuario_actual();
  end if;
  return new;
end;
$function$;

revoke all on function public.fn_cliente_toma_su_vendedor() from public, anon, authenticated;

drop trigger if exists trg_cliente_toma_su_vendedor on public.clientes;
create trigger trg_cliente_toma_su_vendedor
  before insert on public.clientes
  for each row execute function public.fn_cliente_toma_su_vendedor();

-- Por encima del RLS: quien sube la cotización no necesita poder editar al
-- cliente para quedar como su vendedor.
create or replace function public.fn_cotizacion_pone_vendedor_al_cliente()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.cliente_id is not null and not public.es_admin() and public.tiene_permiso('cotizaciones.crear') then
    update public.clientes
       set vendedor_id = public.usuario_actual()
     where id = new.cliente_id and vendedor_id is null;
  end if;
  return null;
end;
$function$;

revoke all on function public.fn_cotizacion_pone_vendedor_al_cliente() from public, anon, authenticated;

drop trigger if exists trg_cotizacion_pone_vendedor_al_cliente on public.cotizaciones_pdf;
create trigger trg_cotizacion_pone_vendedor_al_cliente
  after insert or update of cliente_id on public.cotizaciones_pdf
  for each row execute function public.fn_cotizacion_pone_vendedor_al_cliente();

-- Los clientes de antes: el de su primera cotización subida por alguien que
-- cotiza; si no tiene, quien lo dio de alta, si cotiza.
with que_cotizan as (
  select u.id
    from public.usuarios u
    join public.roles_permisos rp on rp.rol_id = u.rol_id
   where rp.permiso_codigo = 'cotizaciones.crear'
)
update public.clientes c
   set vendedor_id = coalesce(
         (select p.registrado_por
            from public.cotizaciones_pdf p
           where p.cliente_id = c.id and p.registrado_por in (select id from que_cotizan)
           order by p.creado_en
           limit 1),
         case when c.creado_por in (select id from que_cotizan) then c.creado_por end)
 where c.vendedor_id is null
   and (exists (select 1 from public.cotizaciones_pdf p
                 where p.cliente_id = c.id and p.registrado_por in (select id from que_cotizan))
        or c.creado_por in (select id from que_cotizan));

-- 4. Quien escribe en una unidad puede normalizar su código ----------------------
-- `normalizar_codigo_interno` solo pone en mayúsculas y quita espacios: no lee
-- ninguna tabla ni dice nada que la persona no haya escrito. Los disparadores
-- que la llaman corren con el rol de quien escribe (no son `security definer`),
-- y sin este permiso la tabla rechaza la escritura legítima. Mismo caso que la
-- función que va en un índice (skill `seguridad`): no se le quita al rol que
-- escribe.
grant execute on function public.normalizar_codigo_interno(text) to authenticated;
