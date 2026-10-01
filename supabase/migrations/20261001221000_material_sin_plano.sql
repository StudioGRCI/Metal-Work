-- El jefe de Diseño carga el material de la unidad apenas recibe la OT, y los
-- planos llegan después: obligarlo a tener un plano antes de agregar una sola
-- línea lo dejaba sin poder empezar la lista. Desde aquí el plano del material es
-- opcional y se vincula después, al editar la línea.
--
-- Las propuestas de las áreas siguen naciendo de un plano liberado: eso lo
-- exigen `proponer_material_de_area` y `proponer_material_nuevo_de_area` por su
-- cuenta, no este disparador.
--
-- El disparador `trg_material_nuevo_exige_plano` se deja en su sitio con la
-- función vacía: un DROP TRIGGER no se puede aplicar desde la consola de
-- migraciones del proyecto (se queda esperando una confirmación que no llega).
create or replace function public.fn_material_nuevo_exige_plano()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  -- El plano es opcional desde el 2026-10-01. La llave compuesta
  -- `fk_ot_material_plano` sigue comprobando que, si viene, sea de esta OT.
  return new;
end;
$$;
