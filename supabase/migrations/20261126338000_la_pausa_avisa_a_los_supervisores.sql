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
-- «No te pide el reporte» es la regla de las migraciones 335000 y 336000
-- (`codigos_pausados_de_mi_area`): el código cuya única OT abierta está pausada
-- sale de «Sin reporte de hoy». Por eso esta migración va después de ellas. Si
-- el código tiene otra OT abierta, sigue pidiendo el reporte, y el aviso no
-- dice que deja de pedirlo. Tampoco se lo dice a quien la bandeja no se lo pide
-- hoy: el área cuya etapa todavía no empieza.
--
-- Va en un disparador propio, como pide la skill `seguridad`: no se redefine
-- `fn_ot_avisa_de_estado`. El aviso lleva a «Planos y etapas» con el código
-- buscado: el supervisor no entra a la OT. El código va escapado en la ruta.
--
-- El disparador corre solo cuando cambia el estado (`when`), no en cada
-- corrección de la OT.
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

  -- ¿El código deja de pedir el reporte? La misma condición que
  -- `codigos_pausados_de_mi_area` (336000): su única OT abierta está pausada.
  -- Al reanudar, la condición es que esa OT sea la única abierta.
  select case when v_pausa then c.ot_estado = 'PAUSADA' and c.ots_abiertas = 1
              else c.ots_abiertas = 1 end
    into v_sola
    from public.tiempos_de_entrega_codigos_calculado(v_codigo) c
   limit 1;
  v_quien := coalesce(public.puesto_de(v_yo), 'la oficina');
  v_titulo := 'Orden ' || new.numero || case when v_pausa then ' pausada · ' else ' reanudada · ' end || v_codigo;
  v_cuerpo := case when v_pausa
                   then 'La pausó ' || v_quien || '. Motivo: ' || rtrim(left(btrim(new.motivo_pausa), 300), '. ') || '.'
                   else 'La reanudó ' || v_quien || '. El trabajo sigue.' end;

  -- La frase del reporte va solo a quien la bandeja se lo pide: un área con una
  -- etapa que ya empezó, o cuya fecha de inicio ya llegó (`pideReporteHoy` de
  -- `src/lib/dominio/tiempos-entrega.ts`), y sin `produccion.cualquier_area`,
  -- que no ve la bandeja. A la etapa que empieza en dos semanas no se le dice
  -- que «vuelve a pedir» un reporte que todavía no pide.
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select d.id, v_titulo,
         v_cuerpo || case when coalesce(v_sola, false) and d.pide_hoy and not d.cualquier_area
                          then case when v_pausa
                                    then ' Mientras siga pausada, el código ' || v_codigo || ' no te pide el reporte diario.'
                                    else ' El código ' || v_codigo || ' vuelve a pedir tu reporte diario.' end
                          else '' end,
         -- Escapado como en `avisar_tiempos_de_entrega` (315000): «OT 2921-2026»
         -- lleva espacio, y la campana no abre una ruta con espacios.
         '/planos?q=' || replace(replace(replace(replace(replace(replace(v_codigo,
           '%', '%25'), '&', '%26'), '#', '%23'), '+', '%2B'), '/', '%2F'), ' ', '+'),
         'ordenes_trabajo', new.id
    from (select u.id,
                 exists (select 1 from public.tiempos_de_entrega_etapas_calculado(v_codigo) e
                          where e.area_id = u.area_id and e.fin_real is null
                            and (e.inicio_real is not null
                                 or coalesce(e.inicio_plan, e.fin_plan) <= (now() at time zone 'America/Lima')::date)) as pide_hoy,
                 exists (select 1 from public.roles_permisos rp
                          where rp.rol_id = u.rol_id and rp.permiso_codigo = 'produccion.cualquier_area') as cualquier_area
            from public.usuarios u
           where u.activo
             and u.id is distinct from v_yo
             and u.area_id is not null
             and exists (select 1 from public.roles_permisos rp
                          where rp.rol_id = u.rol_id and rp.permiso_codigo = 'reporte_diario.registrar')
             and exists (select 1 from public.tiempos_de_entrega_etapas_calculado(v_codigo) e
                          where e.area_id = u.area_id and e.fin_real is null)) d;

  return null;
end;
$$;

comment on function public.fn_ot_avisa_la_pausa() is
  'La OT que pasa de en proceso a pausada, o vuelve, avisa a la supervisión de cada área con una etapa abierta en su código interno, con el motivo.';

revoke all on function public.fn_ot_avisa_la_pausa() from public, anon, authenticated;

create or replace trigger trg_ot_avisa_la_pausa
  after update on public.ordenes_trabajo
  for each row when (old.estado is distinct from new.estado)
  execute function public.fn_ot_avisa_la_pausa();
