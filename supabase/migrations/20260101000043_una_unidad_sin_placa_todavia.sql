-- =============================================================================
-- LA UNIDAD QUE TODAVÍA NO TIENE PLACA
-- -----------------------------------------------------------------------------
-- La placa era obligatoria y eso frenaba el trabajo justo donde empieza: al
-- cotizar. La empresa fabrica carrocerías sobre chasis que muchas veces todavía
-- no están matriculados —el cliente los acaba de comprar, o vienen en camino—, y
-- la placa aparece meses después, con la tarjeta de propiedad, que es un trámite
-- que hace la propia Metal Work al final del trabajo.
--
-- Con la placa obligatoria, el vendedor que quería cotizar una tolva para un
-- chasis sin matricular no podía ni registrar la unidad: la ventana no lo
-- dejaba pasar. Se quedaba sin cotización.
--
-- No se pone ninguna otra condición en su lugar —ni chasis ni código interno—
-- a propósito. Al cotizar, muchas veces no se tiene ninguno de los tres: se sabe
-- la marca, el modelo y qué se le va a montar, y nada más. Lo que sí cambia es
-- que la pantalla ya no puede dar por hecho que hay placa para nombrar la
-- unidad: cae al código interno, al número de chasis o a la marca y el modelo.
--
-- El índice único (cliente_id, placa) se queda como está: en Postgres dos nulos
-- no chocan entre sí, así que un cliente puede tener varios chasis sin placa sin
-- que ninguno tape al otro, y en cuanto les llegue la suya se sigue impidiendo
-- que la misma placa se registre dos veces.
-- =============================================================================

alter table public.unidades alter column placa drop not null;

comment on column public.unidades.placa is
  'La placa de rodaje, cuando la tiene. Una unidad en fabricación puede no tenerla todavía: la matriculación es un trámite del final del trabajo.';
