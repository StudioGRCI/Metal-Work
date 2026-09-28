-- La anulación deja motivo, quién y cuándo, y congela el documento PDF.
-- Una cotización que aún tiene una OT activa solo se anula después de esa OT.
alter table public.cotizaciones_pdf
  add column if not exists motivo_anulacion text,
  add column if not exists anulado_por uuid references public.usuarios(id),
  add column if not exists anulado_en timestamptz;

alter table public.cotizaciones_pdf drop constraint if exists ck_cotizacion_pdf_anulacion_completa;
alter table public.cotizaciones_pdf add constraint ck_cotizacion_pdf_anulacion_completa
  check (estado <> 'ANULADA' or
    (nullif(btrim(motivo_anulacion), '') is not null and anulado_por is not null and anulado_en is not null));

create or replace function public.fn_cotizacion_pdf_anular()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_orden text;
begin
  if old.estado = 'ANULADA' then
    raise exception 'La cotización % está anulada y se conserva como evidencia; crea una nueva.', old.numero;
  end if;

  if new.estado = 'ANULADA' then
    perform public.exigir_permiso('cotizaciones.revisar');
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
-- Corre después de la validación de Gerencia para sellar los campos de anulación.
drop trigger if exists trg_zz_cotizacion_pdf_anular on public.cotizaciones_pdf;
create trigger trg_zz_cotizacion_pdf_anular before update on public.cotizaciones_pdf
  for each row execute function public.fn_cotizacion_pdf_anular();

-- La notificación de rechazo existente no debe llamarse para una anulación.
drop trigger if exists trg_cotizacion_pdf_avisa_update on public.cotizaciones_pdf;
create trigger trg_cotizacion_pdf_avisa_update
  after update of estado on public.cotizaciones_pdf
  for each row when (new.estado <> 'ANULADA')
  execute function public.fn_cotizacion_pdf_avisa();
