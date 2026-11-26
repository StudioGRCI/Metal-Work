-- =============================================================================
-- La OT que se pausa o se reanuda le avisa a la supervisión del taller
-- =============================================================================
-- Desde la 20261126337000 Administración pausa y reanuda la OT desde la
-- oficina. El taller no se enteraba: `fn_ot_avisa_de_estado` (migración 111)
-- solo avisa al aprobar, terminar y entregar. DKS eligió «Avisar a los
-- supervisores» el 2026-11-26.
--
-- Quién recibe el aviso: la supervisión (quien sube el reporte diario,
-- `reporte_diario.registrar`) de cada área que tiene una etapa abierta en el
-- código interno de esa OT. Es la gente cuyo trabajo se detiene o vuelve, y la
-- que deja de ver el código en «Sin reporte de hoy» (migraciones 335000 y
-- 336000). Quien pausó no se avisa a sí mismo. Una OT sin código interno, o sin
-- etapas abiertas, no avisa a nadie: no hay área que se detenga.
--
-- El código sale igual que en el tablero de tiempos de entrega: el de la unidad,
-- o el número de la OT si es mantenimiento o garantía (migración 20261120500000).
-- Si el código tiene otra OT abierta, sigue pidiendo el reporte, y el aviso no
-- dice que deja de pedirlo.
--
-- Va en un disparador propio, como pide la skill `seguridad`: no se redefine
-- `fn_ot_avisa_de_estado`. El aviso lleva a «Planos y etapas» con el código
-- buscado: el supervisor no entra a la OT.
--
-- Sin DROP. Idempotente: `create or replace function` y `create or replace trigger`.
-- =============================================================================

create or replace function public.fn_ot_avisa_la_pausa()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yo      constant uuid := public.usuario_actual();
  v_pausa   constant boolean := old.estado = 'EN_PROCESO' and new.estado = 'PAUSADA';
  v_reanuda constant boolean := old.estado = 'PAUSADA' and new.estado = 'EN_PROCESO';
  v_codigo  text;
  v_sola    boolean;
  v_quien   text;
  v_titulo  text;
  v_cuerpo  text;
begin
  if not (v_pausa or v_reanuda) then
    return null;
  end if;

  select public.normalizar_codigo_interno(
           case when new.tipo_trabajo::text in ('MANTENIMIENTO', 'GARANTIA')
                then public.codigo_de_la_ot(new.numero) else u.codigo_interno end)
    into v_codigo
    from (select 1) x
    left join public.unidades u on u.id = new.unidad_id;
  if v_codigo is null then
    return null;
  end if;

  -- ¿Es la única OT abierta del código? Entonces deja (o vuelve a) pedir el reporte.
  select c.ots_abiertas = 1 into v_sola
    from public.tiempos_de_entrega_codigos_calculado(v_codigo) c
   limit 1;
  v_quien := coalesce(public.puesto_de(v_yo), 'la oficina');

  if v_pausa then
    v_titulo := 'Orden ' || new.numero || ' pausada · ' || v_codigo;
    v_cuerpo := 'La pausó ' || v_quien || '. Motivo: ' || left(btrim(new.motivo_pausa), 300) || '.'
             || case when coalesce(v_sola, false)
                     then ' Mientras siga pausada, el código ' || v_codigo || ' no te pide el reporte diario.'
                     else '' end;
  else
    v_titulo := 'Orden ' || new.numero || ' reanudada · ' || v_codigo;
    v_cuerpo := 'La reanudó ' || v_quien || '. El trabajo sigue'
             || case when coalesce(v_sola, false)
                     then ' y el código ' || v_codigo || ' vuelve a pedir tu reporte diario.'
                     else '.' end;
  end if;

  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, v_titulo, v_cuerpo, '/planos?q=' || v_codigo, 'ordenes_trabajo', new.id
    from public.usuarios u
   where u.activo
     and u.id is distinct from v_yo
     and u.area_id is not null
     and exists (select 1 from public.roles_permisos rp
                  where rp.rol_id = u.rol_id and rp.permiso_codigo = 'reporte_diario.registrar')
     and exists (select 1 from public.tiempos_de_entrega_etapas_calculado(v_codigo) e
                  where e.area_id = u.area_id and e.fin_real is null);

  return null;
end;
$$;

comment on function public.fn_ot_avisa_la_pausa() is
  'La OT que pasa de en proceso a pausada, o vuelve, avisa a la supervisión de cada área con una etapa abierta en su código interno, con el motivo.';

revoke all on function public.fn_ot_avisa_la_pausa() from public, anon, authenticated;

create or replace trigger trg_ot_avisa_la_pausa
  after update on public.ordenes_trabajo
  for each row execute function public.fn_ot_avisa_la_pausa();
