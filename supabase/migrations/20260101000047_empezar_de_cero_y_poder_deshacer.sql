-- =============================================================================
-- EMPEZAR DE CERO, Y PODER DESHACER UN BORRADOR
-- -----------------------------------------------------------------------------
-- Dos cosas que pidió la empresa y que este asistente había entendido al revés.
--
-- 1. LA NUMERACIÓN ARRANCA DE CERO. Se dijo «la numeración se va a reiniciar con
--    el sistema» y se interpretó como «no toques las series». Era lo contrario:
--    el sistema empieza su propia cuenta, y los números del talonario viejo se
--    quedan en el talonario viejo. La primera cotización que se emita será la
--    1-2026 y la primera orden, la 1-2026.
--
--    Las tres cotizaciones de prueba que ya existen conservan su número —3568,
--    3569 y 3570— porque un documento emitido no se renumera nunca: se anula o
--    se borra, y para eso está lo de abajo.
--
-- 2. UN BORRADOR SE PUEDE BORRAR. La regla de la casa es que un documento
--    numerado no se borra, y sigue en pie: una cotización que salió al cliente,
--    que Gerencia revisó o que el cliente aprobó se anula con su motivo y queda
--    como evidencia. Pero un BORRADOR no es un documento: es una hoja a medio
--    escribir que nunca salió de la oficina. Obligar a anularla llena la lista de
--    papeles anulados que nadie emitió, y eso ensucia el archivo en vez de
--    cuidarlo.
-- =============================================================================

-- --------------------------------------------------- la cuenta vuelve a empezar
update public.series_documentarias
   set correlativo_actual = 0
 where tipo::text in ('COTIZACION', 'ORDEN_TRABAJO');

-- ------------------------------------------- borrar solo lo que nunca salió
-- El trigger que impedía todo borrado sigue existiendo y sigue defendiendo lo
-- que importa; lo único que cambia es que reconoce el borrador.
create or replace function public.fn_cotizacion_bloquear_borrado()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if old.estado <> 'BORRADOR' then
    raise exception
      'La cotización % ya salió de borrador y no se borra: anúlala con su motivo y queda como evidencia.',
      old.numero
      using errcode = 'restrict_violation';
  end if;

  -- Un borrador que ya generó una orden no es un borrador: algo se hizo con él.
  if exists (select 1 from public.ordenes_trabajo o where o.cotizacion_id = old.id) then
    raise exception
      'La cotización % tiene una orden de trabajo abierta y no se puede borrar.',
      old.numero
      using errcode = 'restrict_violation';
  end if;

  return old;
end;
$$;

comment on function public.fn_cotizacion_bloquear_borrado is
  'Un documento numerado no se borra: se anula. La excepción es el borrador, que nunca salió de la oficina y no tiene nada que atestiguar.';

-- La política de borrado se había quitado entera en la migración 034. Vuelve,
-- acotada a quien escribe cotizaciones; el trigger de arriba decide el resto.
drop policy if exists borrar_cotizaciones on public.cotizaciones;
create policy borrar_cotizaciones on public.cotizaciones
  for delete to authenticated
  using (
    public.es_admin()
    or public.tiene_permiso('cotizaciones.editar')
    or public.tiene_permiso('cotizaciones.anular'));

grant delete on public.cotizaciones to authenticated;
