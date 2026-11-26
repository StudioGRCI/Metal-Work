-- =============================================================================
-- LOS DÍAS CERRADOS LOS VE QUIEN VE LA CAJA, NO COSTOS
-- -----------------------------------------------------------------------------
-- Plan 11 (Tesorería), entrega 11.3. La 20261126100000 abrió la historia de los
-- cierres a `tesoreria.ver_documentos` para que Gerencia la consultara, y ese
-- permiso lo tiene también Costos. StudioGRCI decidió el 2026-11-26, en una
-- tarjeta del chat del proyecto, que Costos no la vea.
--
-- Ese mismo día la 20261126310000 le dio a Gerencia `tesoreria.ver_caja`:
-- consulta la caja diaria, sus cierres y la captura del saldo de apertura de
-- cada cuenta, por las políticas de `cajas`, `cierres_caja` y del bucket
-- `apertura-caja`. Con eso la historia ya no necesita una puerta propia:
--
--   * `historia_cierres_caja` pide `tesoreria.caja` o `tesoreria.ver_caja`
--     (Tesorería y Gerencia) y lee con los permisos de quien la llama
--     (`security invoker`): las políticas de las tablas deciden lo mismo.
--   * Se retiran la política `apertura_caja_ver_documentos` y las funciones
--     `es_captura_de_caja` y `captura_de_caja`: la captura la abre la ruta con
--     la política `apertura_caja_ver` de la 20261126310000.
--
-- Nada borra datos: solo se retiran una política y dos funciones de esta misma
-- entrega. Idempotente: `if exists` y `create or replace` con la misma firma.
-- =============================================================================

-- 1. La captura: queda solo la política de quien ve la caja ----------------------------
drop policy if exists apertura_caja_ver_documentos on storage.objects;
drop function if exists public.captura_de_caja(uuid);
drop function if exists public.es_captura_de_caja(text);

-- 2. La historia de los cierres, con el permiso de la caja ------------------------------
create or replace function public.historia_cierres_caja(p_desde date, p_hasta date)
returns table (
  id uuid, caja_id uuid, cuenta text, tipo text, banco text, moneda text, cuenta_activa boolean, con_captura boolean,
  fecha date, saldo_inicial numeric, ingresos numeric, egresos numeric, saldo_final numeric, saldo_banco numeric, diferencia numeric,
  observaciones text, cerrado_por text, cerrado_en timestamptz,
  reabierto_por text, reabierto_en timestamptz, motivo_reapertura text
)
language plpgsql stable security invoker set search_path to 'public' as $$
begin
  if not (public.es_admin() or public.tiene_permiso('tesoreria.caja') or public.tiene_permiso('tesoreria.ver_caja')) then
    raise exception 'No tienes permiso para ver los días cerrados de la caja.' using errcode = 'insufficient_privilege';
  end if;
  if p_desde is null or p_hasta is null or p_desde > p_hasta then
    raise exception 'Elige desde qué día y hasta qué día ver los cierres.' using errcode = 'check_violation';
  end if;
  if p_hasta - p_desde > 366 then
    raise exception 'Se ven hasta 366 días a la vez: acorta las fechas.' using errcode = 'check_violation';
  end if;
  return query
    select k.id, k.caja_id, c.nombre, c.tipo, c.banco, c.moneda, c.activa, c.apertura_ruta is not null,
           k.fecha, k.saldo_inicial, k.ingresos, k.egresos, k.saldo_final, k.saldo_banco, k.diferencia,
           k.observaciones, uc.nombres, k.creado_en,
           ua.nombres, k.anulado_en, k.motivo_anulacion
      from public.cierres_caja k
      join public.cajas c on c.id = k.caja_id
      left join public.usuarios uc on uc.id = k.cerrado_por
      left join public.usuarios ua on ua.id = k.anulado_por
     where k.fecha between p_desde and p_hasta
     order by k.fecha desc, c.nombre, k.creado_en desc;
end;
$$;
comment on function public.historia_cierres_caja(date, date) is
  'Los días cerrados de cada cuenta de la caja entre dos fechas (hasta 366 días), con quién cerró, a qué hora, el saldo del sistema, el del estado de cuenta y la diferencia, y los reabiertos con su motivo. Solo lectura. Pide tesoreria.caja o tesoreria.ver_caja (Tesorería y Gerencia; Costos no, decisión de StudioGRCI del 2026-11-26).';
revoke all on function public.historia_cierres_caja(date, date) from public, anon;
grant execute on function public.historia_cierres_caja(date, date) to authenticated;
