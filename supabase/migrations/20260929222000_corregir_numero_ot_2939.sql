-- La OT de la COT 3700-2026 quedó como 0001-2026 por el correlativo anterior.
-- Su PDF firmado dice OT 2939; se corrige una sola fila, dejando los dos
-- números y la evidencia del motivo en la bitácora y en la auditoría.
do $$
declare
  v_orden constant uuid := '23a07f91-61db-4632-a68a-385b84583456';
  v_cotizacion constant uuid := 'fa2c8cb2-8d63-4608-9173-5c0c81d1fd56';
  v_numero text;
begin
  select numero into v_numero
    from public.ordenes_trabajo
   where id = v_orden and cotizacion_pdf_id = v_cotizacion
   for update;
  if v_numero is null then
    raise exception 'No se encontró la OT de la cotización 3700-2026.';
  end if;
  if v_numero = '2939-2026' then
    return;
  end if;
  if v_numero <> '0001-2026' then
    raise exception 'La OT ya tiene otro número: %. No se corrigió.', v_numero;
  end if;
  if exists (select 1 from public.ordenes_trabajo where numero = '2939-2026') then
    raise exception 'Ya existe una OT 2939-2026. No se corrigió la numeración.';
  end if;
  if not exists (
    select 1 from public.ot_adjuntos
     where orden_id = v_orden and tipo = 'ORDEN'
       and nombre_archivo ilike 'OT - 2939 -%'
  ) then
    raise exception 'Falta el PDF de respaldo que identifica la OT 2939.';
  end if;

  -- Solo esta migración desactiva la prohibición de renumerar. El bloqueo DDL
  -- impide escrituras concurrentes hasta reactivar el disparador.
  alter table public.ordenes_trabajo disable trigger trg_ot_antes_update;
  update public.ordenes_trabajo set numero = '2939-2026'
   where id = v_orden and numero = '0001-2026';
  if not found then
    raise exception 'La OT cambió durante la corrección. No se modificó.';
  end if;
  alter table public.ordenes_trabajo enable trigger trg_ot_antes_update;

  perform public.ot_registrar_evento_interna(
    v_orden, 'DOCUMENTO',
    'Número de OT corregido de 0001-2026 a 2939-2026 según el PDF original.',
    jsonb_build_object('numero_anterior','0001-2026',
                       'numero_corregido','2939-2026',
                       'motivo','El PDF original de la orden identifica 2939; el sistema registró 0001 por error.'),
    null, null
  );
end;
$$;
