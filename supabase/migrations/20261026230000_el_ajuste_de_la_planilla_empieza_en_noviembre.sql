-- =============================================================================
-- EL AJUSTE DE LA PLANILLA DE TALLER EMPIEZA EN NOVIEMBRE DE 2026
-- -----------------------------------------------------------------------------
-- DKS, 2026-10-26, al responder las preguntas del PR #170: el ajuste de la
-- planilla de taller por horas corre «desde noviembre», no desde octubre.
--
-- La planilla de taller de octubre de 2026, y las de antes, quedan como
-- registro: se importan y se cierran, pero su diferencia con lo que entró por
-- horas no se reparte entre los códigos. Los códigos de esos meses se quedan
-- con la mano de obra por las horas que tarearon los supervisores. Tampoco
-- hacen esperar al cierre del costeo: `meses_sin_planilla_taller` ya cuenta
-- desde `planilla_ajuste_desde()`.
--
-- Lo que se resta del pago (tardanzas y permisos descontados) sigue desde
-- octubre de 2026 (`rrhh_descuentos_desde()`): eso no cambia.
--
-- Cambia la fecha de la función y los comentarios que la nombran, y la fecha
-- pasa a leerse desde la pantalla: Planillas y su globo la necesitan para saber
-- qué planilla de taller queda como registro, sin repetirla en la aplicación.
-- Es una fecha fija, sin datos de nadie. Volver a correrla deja lo mismo.
-- =============================================================================

create or replace function public.planilla_ajuste_desde()
returns date language sql stable set search_path to 'public' as $$ select date '2026-11-01' $$;
comment on function public.planilla_ajuste_desde() is
  'El primer mes cuya planilla de taller ajusta la mano de obra de los códigos por horas: noviembre de 2026 (DKS, 2026-10-26). Las de antes quedan como registro. La lee la pantalla de Planillas; no pide permiso porque es una fecha fija.';
revoke all on function public.planilla_ajuste_desde() from public, anon;
grant execute on function public.planilla_ajuste_desde() to authenticated;

comment on function public.planilla_al_costo(uuid) is
  'Por persona de la planilla de taller (las cerradas, o la de p_planilla): su ficha, cómo entra al costeo (HORAS: el ajuste por sus horas; SIN_COSTO: tiene horas en el reporte pero su ficha no tiene costo mensual, y su costo se reparte por esas horas; SIN_FICHA o SIN_HORAS: su costo entero por las horas de todos en el mes; OFICINA: no entra, va por los pagos de la oficina; ANTES: de antes de noviembre de 2026, queda como registro), su costo real, sus horas, su costo por horas y el recargo de sus extras que ya entraron, el ajuste y si el mes tiene horas en algún código. No pide permiso.';

comment on function public.codigo_interno_lineas_planilla(text) is
  'El ajuste de cada planilla de taller cerrada desde noviembre de 2026 (costo real menos lo que entró por horas y por el recargo de las extras), repartido entre los códigos internos por las horas de cada persona ese mes, o por las de todos para quien no tiene ficha o no cargó horas, como líneas de mano de obra sin horas, en soles. No pide permiso: la llama codigo_interno_lineas.';

comment on function public.meses_sin_planilla_taller(text) is
  'Los meses ya terminados (desde noviembre de 2026, planilla_ajuste_desde) en que el código interno tuvo horas y la planilla de taller todavía no está cerrada: su ajuste no entró. El cierre del costeo los espera. Exige codigos_internos.ver, codigos_internos.cerrar o costos.ver.';
