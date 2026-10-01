-- Gerencia ve lo que cuesta cada carrocería.
--
-- El sistema existe para saber el avance y el costo de cada unidad que sale de
-- planta, y quien más necesita esa cifra es Gerencia: aprueba la cotización,
-- decide el precio de la siguiente y responde por el margen. Hasta hoy el
-- permiso de costos lo tenían Administración, Costos y Materiales y Supervisión
-- General; Gerencia veía el avance de cada OT sin su costo, en el tablero y en
-- el expediente de fabricación.
--
-- `costos.ver` abre la lectura del resumen y el detalle del costeo, los gastos
-- de las áreas, las solicitudes a Tesorería y el control vehicular. No da
-- ninguna escritura: registrar o aprobar gastos y pedir pagos siguen con sus
-- propios permisos.

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'costos.ver'
  from public.roles r
 where r.codigo = 'GERENTE'
on conflict do nothing;
