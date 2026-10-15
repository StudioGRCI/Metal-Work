-- El detector de la factura de compra (DKS, 15/10: «agrega un detector
-- invisible en donde en la factura detecte el total y las órdenes de compra
-- para que no haya error en la orden de compra»).
--
-- Al adjuntar la factura, el navegador de Contabilidad lee lo que dice el
-- papel —el XML de SUNAT si lo tiene, si no el PDF, y si es un escaneo, con
-- OCR— sin mandarlo a ningún servicio de afuera: el importe total, la moneda,
-- la serie y número y las OC que menciona. Con eso llena lo que falta y avisa
-- si no calza con lo que se registra o con las OC marcadas. Nunca frena nada
-- (decisión 12, 14/10).
--
-- Aquí se guarda lo que leyó, con la factura, para que el aviso siga a la vista
-- en Adquisiciones y en Cuentas por pagar después de registrarla: el total que
-- dice el papel frente al registrado, y las OC que nombra frente a las que se
-- enlazaron. Lo leído no reemplaza a lo registrado: es la evidencia de lo que
-- decía el documento.

alter table public.adquisiciones
  add column if not exists lectura_fuente text,
  add column if not exists lectura_total numeric(14, 2),
  add column if not exists lectura_moneda text,
  add column if not exists lectura_numero text,
  add column if not exists lectura_ordenes text[],
  add column if not exists lectura_en timestamptz;

comment on column public.adquisiciones.lectura_fuente is
  'De dónde leyó el detector la factura: XML de SUNAT, texto del PDF u OCR de un escaneo. Vacío si no se pudo leer.';
comment on column public.adquisiciones.lectura_total is 'El importe total que dice la factura, con IGV.';
comment on column public.adquisiciones.lectura_ordenes is
  'Los números de las OC que menciona la factura, sin prefijo ni ceros: 5583 de OC-5583-MW.';

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_adquisicion_lectura'
                  and conrelid = 'public.adquisiciones'::regclass) then
    alter table public.adquisiciones add constraint ck_adquisicion_lectura check (
      (lectura_fuente is null or lectura_fuente in ('XML', 'PDF', 'OCR'))
      and (lectura_fuente is not null or (lectura_total is null and lectura_moneda is null
                                          and lectura_numero is null and lectura_ordenes is null))
      and (lectura_total is null or lectura_total > 0)
      and (lectura_moneda is null or lectura_moneda in ('PEN', 'USD'))
      and (lectura_numero is null or lectura_numero ~ '^[A-Z][A-Z0-9]{3}-[0-9]{1,8}$')
      and (lectura_ordenes is null or (cardinality(lectura_ordenes) <= 40
                                       and array_to_string(lectura_ordenes, ',') ~ '^([1-9][0-9]{0,6}(,|$))*$')));
  end if;
end $$;

-- Cuándo se leyó lo pone la base, no el navegador.
create or replace function public.fn_adquisicion_sella_lectura()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.lectura_fuente is null then
    new.lectura_en := null;
  elsif tg_op = 'INSERT'
     or (new.lectura_fuente, new.lectura_total, new.lectura_moneda, new.lectura_numero, new.lectura_ordenes)
        is distinct from (old.lectura_fuente, old.lectura_total, old.lectura_moneda, old.lectura_numero, old.lectura_ordenes) then
    new.lectura_en := now();
  else
    new.lectura_en := old.lectura_en;
  end if;
  return new;
end $$;
revoke all on function public.fn_adquisicion_sella_lectura() from public, anon, authenticated;

create or replace trigger trg_adquisicion_sella_lectura
  before insert or update on public.adquisiciones
  for each row execute function public.fn_adquisicion_sella_lectura();
