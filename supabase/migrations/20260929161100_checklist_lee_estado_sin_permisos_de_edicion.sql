-- SELECT FOR SHARE sobre la OT exige facultades que Costos no tiene.
-- El disparador corre como dueño solo para comprobar el estado de la OT;
-- la política de la tabla sigue exigiendo costos.controlar_ot al usuario real.
alter function public.fn_proteger_checklist_ot() security definer;
