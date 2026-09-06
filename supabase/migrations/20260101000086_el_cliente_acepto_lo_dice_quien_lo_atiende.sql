-- =============================================================================
-- QUE EL CLIENTE ACEPTÓ LO DICE QUIEN LO ATIENDE
-- -----------------------------------------------------------------------------
-- Gerencia hacía dos cosas distintas con la misma mano: dar el visto —para que
-- la cotización pueda salir al cliente— y después marcar que el cliente la
-- aceptó. Lo segundo no es suyo y lo dijo el cliente con todas sus letras:
--
--   «Gerencia aprueba, pero para que envíen a cliente. Quien confirma el
--    comienzo es Ventas con el método de desde cuándo inicia, o Administración,
--    o Tesorería, que le llegan los pagos.»
--
-- Tiene sentido: la respuesta del cliente no le llega a Gerencia. Le llega a
-- quien lo atiende —Ventas, que recibe la orden de compra—, a Administración,
-- que va a emitir la orden de trabajo, o a Tesorería, que ve entrar el adelanto.
-- Gerencia se quedaba esperando que alguien le avisara para poder marcarlo, y
-- ese rodeo no está en ningún flujograma de la casa.
--
-- El visto previo (`cotizaciones.revisar`) NO se toca: sigue siendo de Gerencia,
-- que es lo que el cliente pidió que se conservara.
--
-- Gerencia mantiene también `cotizaciones.aprobar`: quitárselo le sacaría de
-- paso el poder rechazar una cotización enviada, que no se pidió. Si se quiere
-- que Gerencia deje de marcar la aceptación, es un `delete` de una línea.
--
-- El cruce ya estaba hecho antes de repartir nada: la acción de la pantalla
-- exige `cotizaciones.aprobar`, la política de UPDATE de `cotizaciones` lo
-- acepta y el disparador de la migración 041 lo vuelve a exigir. Repartir el
-- permiso alcanza; no hay que tocar ninguna política.
-- =============================================================================

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'cotizaciones.aprobar'
  from public.roles r
 where r.codigo in ('VENDEDOR', 'ADMINISTRACION', 'COSTOS')
on conflict do nothing;

comment on column public.cotizaciones.estado is
  'BORRADOR → EN_COSTEO → EN_REVISION → REVISADA (visto de Gerencia) → ENVIADA (Ventas manda el papel) → APROBADA (el cliente aceptó: lo marca Ventas, Administración o Tesorería) → de ahí nace la orden de trabajo.';
