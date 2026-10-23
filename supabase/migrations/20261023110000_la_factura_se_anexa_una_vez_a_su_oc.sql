-- La misma factura no se anexa dos veces a la misma OC.
--
-- Logística anexó la F018-228173 a la OC-5593 desde dos ventanas, con el mismo
-- PDF bajo dos nombres, y las dos quedaron vigentes (auditoría del 22/10). La
-- aplicación solo atajaba «el mismo PDF», y lo miraba por nombre y tamaño; la
-- base no miraba el número. No se paga dos veces —Adquisiciones no registra la
-- misma factura del mismo proveedor dos veces—, pero Contabilidad veía dos
-- «F018-228173 · OC-5593-MW» y tenía que adivinar cuál PDF era el bueno.
--
-- Las reglas hermanas ya lo hacían: la boleta de una parte no entra si la OC ya
-- la tiene (20261022200000) y la factura de una OS no se adjunta dos veces
-- (20261022177000). Esta pone la misma regla en la factura de la OC.
--
-- Solo dentro de la misma OC: que una factura cubra varias OC del mismo
-- proveedor es lo previsto (20261015122000), y que una OC lleve varias facturas
-- con números distintos también (20261016701000). Un anexo con el PDF mal se
-- anula con su motivo y la factura se vuelve a anexar.
--
-- Disparador y no índice único: si ya hay pares, son evidencia y se quedan;
-- Logística anula uno con su motivo. Va en el INSERT: la tabla no tiene
-- política de UPDATE y anular un anexo no crea otro. `security definer` para que
-- el anexo vigente no se le esconda a quien anexa por el RLS de lectura.

create or replace function public.fn_documento_compra_factura_una_vez()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_clave text := public.clave_numero_comprobante(new.numero_documento);
  v_otro  record;
begin
  if new.tipo is distinct from 'FACTURA' or v_clave is null or new.anulado_en is not null then
    return new;
  end if;
  -- Dos anexos a la vez de la misma factura en la misma OC no se cruzan.
  perform pg_advisory_xact_lock(hashtextextended('anexo-factura|' || new.orden_compra_id::text || '|' || v_clave, 0));
  select d.numero_documento, d.creado_en, coalesce(c.numero, 'orden de compra') as compra
    into v_otro
    from public.documentos_compra_material d
    join public.ordenes_compra_materiales c on c.id = d.orden_compra_id
   where d.orden_compra_id = new.orden_compra_id
     and d.tipo = 'FACTURA'
     and d.anulado_en is null
     and d.id <> new.id
     and public.clave_numero_comprobante(d.numero_documento) = v_clave
   limit 1;
  if found then
    raise exception 'La factura % ya está anexada a la % desde el %: no se anexa otra vez. Si el PDF de antes está mal, anula ese anexo con su motivo y vuelve a anexarla.',
      v_otro.numero_documento, v_otro.compra, to_char(v_otro.creado_en at time zone 'America/Lima', 'DD/MM/YYYY')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.fn_documento_compra_factura_una_vez() from public, anon, authenticated;

drop trigger if exists trg_documento_compra_factura_una_vez on public.documentos_compra_material;
create trigger trg_documento_compra_factura_una_vez
  before insert on public.documentos_compra_material
  for each row execute function public.fn_documento_compra_factura_una_vez();
