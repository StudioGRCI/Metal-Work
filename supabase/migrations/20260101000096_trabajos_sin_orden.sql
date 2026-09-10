-- =============================================================================
-- TRABAJOS SIN ORDEN
-- -----------------------------------------------------------------------------
-- «El reporte no es por algo puntual: es para reportar cosas del taller que se
-- están implementando.» Lo que la 093 armó para las unidades de flota que
-- llegan sin orden de trabajo sirve también para lo que el propio taller
-- implementa —una cabina de pintura, una mesa de corte, una pieza—: se registra
-- una vez y se reporta cada día, con foto, hasta que termina.
--
-- La base ya lo admitía: la placa nunca fue obligatoria, y el trabajo se nombra
-- con la placa o con «qué es». Cambia cómo se llaman las cosas:
--
--   · la unidad sin orden pasa a ser el trabajo sin orden;
--   · EN_TALLER se lee «en curso», LISTA «terminado» y SALIO «cerrado».
--
-- Las tablas se quedan con su nombre (`flota_*`) y los estados con sus valores:
-- renombrarlos no le cambia nada a nadie y mueve políticas, vistas y tipos. Lo
-- que sí lee la gente —el mensaje del disparador— se reescribe, y los
-- comentarios dicen qué guarda cada tabla hoy.
-- =============================================================================

-- ------------------------------------------ el mensaje al tocar uno cerrado
-- Igual que en la 093, salvo el texto: un trabajo del taller no «sale», se
-- cierra, y no tiene placa que nombrar.
create or replace function public.fn_flota_cambia_estado()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if old.estado = 'SALIO' then
    raise exception '«%» se cerró el %: si hay que retomarlo, regístralo de nuevo.',
      coalesce(old.placa, old.descripcion), to_char(old.salio_en, 'DD/MM/YYYY');
  end if;

  -- Lo que no cambia por pantalla se copia de lo que había.
  new.ingreso        := old.ingreso;
  new.registrado_por := old.registrado_por;

  if new.estado = old.estado then
    new.lista_en := old.lista_en;
    new.salio_en := old.salio_en;
    new.salio_por := old.salio_por;
    return new;
  end if;

  if new.estado = 'LISTA' then
    new.lista_en := coalesce(new.lista_en, now());
    new.salio_en := null;
    new.salio_por := null;
  elsif new.estado = 'SALIO' then
    new.lista_en := old.lista_en;
    new.salio_en := coalesce(new.salio_en, now());
    new.salio_por := public.usuario_actual();
  else
    -- Vuelve a estar en curso: se le quita el «terminado».
    new.lista_en := null;
    new.salio_en := null;
    new.salio_por := null;
  end if;

  return new;
end;
$$;

revoke all on function public.fn_flota_cambia_estado() from public, anon, authenticated;

-- ----------------------------------------------------- lo que dice cada cosa
comment on type public.estado_flota is
  'En qué va un trabajo sin orden: EN_TALLER se lee «en curso», LISTA «terminado» (si es una unidad, espera que la recojan) y SALIO «cerrado». De cerrado no se vuelve.';

comment on table public.flota_unidades is
  'Los trabajos sin orden: una unidad de un cliente que entró sin orden de trabajo, o algo que el taller está implementando. Se registran una vez y se reportan cada día. El nombre «flota» es de cuando solo eran unidades.';

comment on column public.flota_unidades.placa is
  'Solo si el trabajo es una unidad. Texto libre, como está en la tarjeta; sin placa el trabajo se nombra con su descripción.';

comment on column public.flota_unidades.descripcion is
  'Qué es: la unidad («Volquete Volvo FMX») o lo que se implementa («Cabina de pintura nueva»).';

comment on column public.flota_unidades.cliente is
  'De quién es, como lo dice quien lo trae: la empresa del cliente, o Metal Work si es del taller. Texto libre a propósito: el taller no ve la lista de clientes.';

comment on column public.flota_unidades.trabajo is
  'Qué se va a hacer, en palabras del supervisor.';

comment on column public.flota_unidades.retiro is
  'Si era una unidad: quién se la llevó al cerrarla, como lo apunta el vigilante.';

comment on table public.flota_avances is
  'El reporte del día de un trabajo sin orden: qué se hizo, de qué área, cuánto va a ojo y qué lo traba. Un trabajo pasa por varias áreas y cada reporte dice la suya.';
