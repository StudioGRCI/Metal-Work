-- =============================================================================
-- EL CLIENTE DE LA UNIDAD LO CAMBIA VENTAS, NO DISEÑO
-- -----------------------------------------------------------------------------
-- Lo dejó abierto la 20261127183500 (PR 298) y StudioGRCI pidió cerrarlo en otro
-- PR («Sí, en otro PR», 2026-11-27):
--
--   Diseño e Ingeniería corrigen los datos del vehículo de una unidad (placa,
--   marca, modelo, chasis, medidas) con `diseno.unidades`, y la política
--   `editar_unidades` acepta ese permiso para toda la fila. Así, con un UPDATE
--   directo por la API, Diseño podía cambiar también el cliente de una unidad
--   que todavía no tiene OT: la unidad pasaba a otro cliente sin que Ventas lo
--   supiera. La pantalla no lo hace (la ficha de la unidad no manda el cliente
--   al corregir), pero la base lo dejaba.
--
-- Desde aquí, por la API (el rol `authenticated`, con sesión), el cliente de una
-- unidad lo cambia solo quien lleva los clientes (`clientes.editar`, Ventas) o
-- el administrador. Diseño e Ingeniería siguen corrigiendo todo lo demás.
--
-- No cambia nada de lo que ya funciona:
--   - Los caminos del sistema que le ponen o le cambian el cliente a la unidad
--     («Poner cliente», «Editar OT / cambiar cliente», la carga y la emisión de
--     la OT, el resumen de Administración) son funciones `security definer`
--     que exigen su propio permiso y corren como su dueño, no como
--     `authenticated`: este disparador no las mira. Las seis que hoy escriben
--     en `unidades` se revisaron en producción el 2026-11-27: las seis son
--     `security definer` de `postgres`.
--   - El alta de la unidad (INSERT) sigue con la política `crear_unidades`.
--   - Lo que corre sin sesión (una migración, la conexión directa), igual.
--   - La unidad que ya tiene OT sigue además con la regla de la 20261127183500
--     (`trg_unidad_con_ot_conserva_su_cliente`). Este disparador se llama de
--     modo que corre antes que aquel: a Diseño le dice que no es de su puesto,
--     en vez de mandarlo a «Editar OT», que tampoco tiene.
--
-- Quién tiene cada permiso, en producción el 2026-11-27: `diseno.unidades`,
-- DISENO y DISENO_LIDER; `clientes.editar`, VENDEDOR.
--
-- Nada se borra ni cambia en los datos. Sin DROP: el conector de producción no
-- deja pasar ninguno.
-- =============================================================================

-- No lee tablas: corre como quien escribe, y así distingue el UPDATE directo
-- por la API (`authenticated`) del que hace una función del sistema (su dueño).
create or replace function public.fn_unidad_cliente_lo_cambia_ventas()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $$
begin
  if new.cliente_id is not distinct from old.cliente_id then
    return new;
  end if;
  if current_user <> 'authenticated' or public.usuario_actual() is null then
    return new;  -- una función del sistema, una migración o la conexión directa
  end if;
  if public.es_admin() or public.tiene_permiso('clientes.editar') then
    return new;
  end if;
  raise exception 'El cliente de la unidad % no se cambia desde tu puesto: eso lo ve Ventas. Los datos del vehículo sí los puedes corregir.',
    coalesce(nullif(btrim(old.codigo_interno), ''), nullif(btrim(old.placa), ''), 'sin placa')
    using errcode = 'insufficient_privilege';
end;
$$;

revoke all on function public.fn_unidad_cliente_lo_cambia_ventas() from public, anon, authenticated;

-- Sin lista de columnas: un BEFORE que cambiara el cliente no aparece en el SET.
-- «trg_unidad_cl…» va antes que «trg_unidad_co…» (los BEFORE corren por nombre).
create or replace trigger trg_unidad_cliente_lo_cambia_ventas
  before update on public.unidades
  for each row execute function public.fn_unidad_cliente_lo_cambia_ventas();

comment on function public.fn_unidad_cliente_lo_cambia_ventas() is
  'Por la API, el cliente de una unidad lo cambia solo clientes.editar o el administrador (20261127200000). Las funciones del sistema, que corren como su dueño, no pasan por aquí.';
