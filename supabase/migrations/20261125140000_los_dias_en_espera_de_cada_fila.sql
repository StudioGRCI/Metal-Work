-- =============================================================================
-- LOS DÍAS EN ESPERA DE CADA FILA
-- -----------------------------------------------------------------------------
-- En cada bandeja (lo que Almacén tiene por atender, lo que Gerencia tiene por
-- aprobar) lo primero que se pregunta es cuánto lleva esperando. La fecha estaba,
-- pero había que restarla de cabeza, y la lista ponía arriba lo más nuevo: lo que
-- más esperaba quedaba al fondo.
--
-- La cuenta la hace la base, con la fecha de Lima, igual que el recorrido de la
-- migración 20261125130000 (`dias_en_espera`): «desde hoy», «hace 1 día», «hace 3
-- días». Un documento que entró a las 11:50 p. m. lleva un día a las 12:05 a. m.,
-- aunque hayan pasado quince minutos. Hacerla en la aplicación con el reloj del
-- servidor (en UTC) corría el día a las 7 p. m. de Lima.
--
-- Esta función recibe las horas de una lista y devuelve los días de cada una, en
-- el mismo orden: cada pantalla sabe desde cuándo espera su fila (la OC desde que
-- se pidió su aprobación, el RQ desde que lo tiene quien lo tiene) y la base solo
-- cuenta. No lee ninguna tabla, así que no abre nada: la fila ya la leyó la
-- pantalla con su propio permiso.
--
-- Todavía sin colores por demora (decisión del plan 0): solo el número.
-- =============================================================================

-- Va después de la 20261125130000, que crea `dias_en_espera`: plpgsql no revisa
-- el cuerpo al crear la función, y sola entraría sin error y fallaría en cada uso.
do $$
begin
  if to_regprocedure('public.dias_en_espera(timestamptz)') is null then
    raise exception 'Aplica antes la migración 20261125130000 (el recorrido de cada documento): esta usa su dias_en_espera.';
  end if;
end $$;

create or replace function public.dias_en_espera_de(p_desde timestamptz[])
returns table (posicion integer, desde timestamptz, dias integer)
language plpgsql
stable
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if cardinality(p_desde) > 1000 then
    raise exception 'Pide los días en espera de hasta 1000 filas a la vez.' using errcode = 'check_violation';
  end if;
  return query
  select t.posicion::integer, t.desde, public.dias_en_espera(t.desde)
    from unnest(coalesce(p_desde, array[]::timestamptz[])) with ordinality as t(desde, posicion)
   order by t.posicion;
end;
$$;

comment on function public.dias_en_espera_de(timestamptz[]) is
  'Los días en espera de cada hora de la lista, por fecha de Lima (hoy = 0), en el mismo orden (posicion desde 1). Hasta 1000 a la vez. No lee tablas.';

revoke all on function public.dias_en_espera_de(timestamptz[]) from public, anon;
grant execute on function public.dias_en_espera_de(timestamptz[]) to authenticated;
