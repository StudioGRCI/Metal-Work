-- =============================================================================
-- NO SE MANDA A GERENCIA SIN FICHA TÉCNICA
-- -----------------------------------------------------------------------------
-- La ficha técnica es contra lo que el cliente reclama: lo que el taller va a
-- fabricar, escrito. Sale impresa en el papel, y una cotización que llega al
-- cliente sin ella promete un precio por algo que no está descrito.
--
-- Se podía terminar el costeo con la ficha vacía y el papel salía igual, con la
-- sección entera ausente. Nadie se enteraba hasta que el cliente preguntaba qué
-- espesor de plancha lleva.
--
-- La escribe Administración durante el costeo —eso no cambia—, así que la puerta
-- se pone justo donde termina su trabajo: para pasar la cotización a Gerencia
-- hace falta al menos una línea de ficha. El mensaje dice qué falta y a quién le
-- toca, porque el que lo va a leer es quien tiene que arreglarlo.
--
-- No se exige nada más: ni accesorios —hay trabajos que no llevan— ni medidas,
-- que ahora las trae el catálogo al elegir el tipo de carrocería.
-- =============================================================================

create or replace function public.fn_cotizacion_exigir_ficha_para_revision()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.estado = 'EN_REVISION' and old.estado is distinct from 'EN_REVISION' then
    if not exists (
      select 1 from public.cotizacion_especificaciones e where e.cotizacion_id = new.id
    ) then
      raise exception
        'La cotización % no tiene ficha técnica y sin ella no puede pasar a Gerencia: es lo que el taller va a fabricar y contra lo que el cliente reclama. La escribe Administración durante el costeo.',
        new.numero
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.fn_cotizacion_exigir_ficha_para_revision is
  'Una cotización no sale de costeo sin ficha técnica: es lo que se imprime y contra lo que el cliente reclama.';

drop trigger if exists trg_cotizacion_exigir_ficha_para_revision on public.cotizaciones;

-- Después del que calcula y del que valida la transición: si el paso no es
-- válido o no hay permiso, ese error es el que hay que ver primero.
create trigger trg_cotizacion_exigir_ficha_para_revision
  before update on public.cotizaciones
  for each row execute function public.fn_cotizacion_exigir_ficha_para_revision();
