-- =============================================================================
-- LA FACTURA QUE SE ANEXA A LA OC LLEVA SU NÚMERO Y SU FECHA
-- -----------------------------------------------------------------------------
-- Gerencia, el 2026-10-15: «al anexar una factura a la orden de compra se debe
-- agregar el número de factura y la fecha de la factura, con la factura en PDF;
-- también se tiene que gestionar». Hasta hoy Logística subía el PDF de la
-- factura a la OC sin más dato que el nombre del archivo: Contabilidad la
-- buscaba por ese nombre y volvía a escribir el número y la fecha a mano.
--
-- Desde aquí la factura anexada a una OC lleva su número (F001-123, como lo
-- guarda la base) y su fecha de emisión. Contabilidad la elige al registrar el
-- comprobante con esos datos ya puestos, y la lista dice cuáles esperan todavía
-- su registro. Las facturas que ya estaban subidas quedan como están: la regla
-- vale para las nuevas.
-- Sin DROP ni borrados: el conector de producción no deja pasar ninguno.
-- =============================================================================

alter table public.documentos_compra_material
  add column if not exists numero_documento text,
  add column if not exists fecha_emision date;
comment on column public.documentos_compra_material.numero_documento is
  'El número del comprobante anexado (F001-123 en una factura, sin los ceros de relleno). Obligatorio en las facturas subidas desde el 2026-10-16.';
comment on column public.documentos_compra_material.fecha_emision is
  'La fecha de emisión del comprobante anexado. Obligatoria en las facturas subidas desde el 2026-10-16.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_documento_compra_numero'
                    and conrelid = 'public.documentos_compra_material'::regclass) then
    alter table public.documentos_compra_material add constraint ck_documento_compra_numero
      check (numero_documento is null or char_length(btrim(numero_documento)) between 3 and 40);
  end if;
  -- NOT VALID: las facturas de antes no se revisan; las nuevas sí.
  if not exists (select 1 from pg_constraint where conname = 'ck_documento_compra_factura_con_numero'
                    and conrelid = 'public.documentos_compra_material'::regclass) then
    alter table public.documentos_compra_material add constraint ck_documento_compra_factura_con_numero
      check (tipo <> 'FACTURA' or (numero_documento is not null and fecha_emision is not null
                                   and numero_documento = public.normalizar_numero_factura(numero_documento))) not valid;
  end if;
end $$;

-- La fecha de una factura no es de mañana: la de Lima, que es la del taller.
create or replace function public.fn_documento_compra_fecha()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.fecha_emision is not null and new.fecha_emision > (now() at time zone 'America/Lima')::date then
    raise exception 'La fecha de la factura no puede ser posterior a hoy.' using errcode = 'check_violation';
  end if;
  if new.tipo = 'FACTURA' and new.numero_documento is not null
     and public.normalizar_numero_factura(new.numero_documento) is null then
    raise exception 'El número de la factura va con su serie y su número, como F001-123.' using errcode = 'check_violation';
  end if;
  new.numero_documento := coalesce(public.normalizar_numero_factura(new.numero_documento), nullif(btrim(new.numero_documento), ''));
  return new;
end;
$$;
revoke all on function public.fn_documento_compra_fecha() from public, anon, authenticated;
create or replace trigger trg_documento_compra_fecha
  before insert on public.documentos_compra_material
  for each row execute function public.fn_documento_compra_fecha();
