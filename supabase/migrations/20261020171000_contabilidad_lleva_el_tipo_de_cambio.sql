-- =============================================================================
-- CONTABILIDAD LLEVA EL TIPO DE CAMBIO Y NO MIRA LOS REQUERIMIENTOS
-- -----------------------------------------------------------------------------
-- Lo que DKS dijo el 2026-10-20 al revisar los menús de Tesorería y de
-- Contabilidad:
--
--   * «El tipo de cambio lo coloca Contabilidad; en Tesorería no influye.»
--     Tesorería deja de registrarlo (`tesoreria.tipo_cambio` sale de su
--     puesto). Lo sigue leyendo como todos —la política de lectura de
--     `tipos_de_cambio` es de cualquier cuenta activa—, así que la caja diaria
--     sigue pasando sus dólares a soles con el cambio que registró
--     Contabilidad. Administración lo conserva: nadie dijo de quitárselo.
--     El código del permiso no cambia (lo nombran la pantalla, las políticas y
--     los checks); cambia el módulo con que se lista.
--   * «No tiene por qué ver requerimientos: no entra en la parte
--     administrativa, solo visualiza lo que entra de Logística en
--     Adquisiciones.» Contabilidad pierde `requerimientos.ver`: la lista de
--     RQ y la bandeja de atención la rechazan también por su dirección, y la
--     tabla `requerimientos` deja de leerse con su cuenta. El número de RQ
--     sigue saliendo en Adquisiciones, que lo lee de `insumos_de_compras`.
--   * «El nombre solo debe ser Contabilidad, no Adquisiciones.» El puesto se
--     llamaba «Contabilidad y Adquisiciones» (migración 20260929190000) y así
--     salía bajo el nombre de la cuenta. Pasa a «Contabilidad», y la cuenta de
--     ese puesto que diga «Adquisiciones» en su nombre o en su cargo pasa a
--     decir «Contabilidad». La pantalla Adquisiciones no cambia de nombre.
--
-- Lleva DELETE: el conector de producción no lo deja pasar y va en el archivo
-- que se pega en el SQL Editor. Volver a correrlo no cambia nada más.
-- =============================================================================

-- 1. El tipo de cambio es de Contabilidad -----------------------------------------------------
delete from public.roles_permisos rp
 using public.roles r
 where r.id = rp.rol_id
   and r.codigo = 'TESORERIA'
   and rp.permiso_codigo = 'tesoreria.tipo_cambio';

update public.permisos
   set modulo = 'Contabilidad',
       descripcion = 'Registrar y corregir el tipo de cambio del día (lo lleva Contabilidad)'
 where codigo = 'tesoreria.tipo_cambio';

-- 2. Contabilidad no lee los requerimientos ---------------------------------------------------
delete from public.roles_permisos rp
 using public.roles r
 where r.id = rp.rol_id
   and r.codigo = 'CONTABILIDAD'
   and rp.permiso_codigo = 'requerimientos.ver';

-- 3. El puesto y su cuenta se llaman Contabilidad -------------------------------------------
update public.roles set nombre = 'Contabilidad'
 where codigo = 'CONTABILIDAD' and nombre is distinct from 'Contabilidad';

-- Solo se quita la palabra «Adquisición» o «Adquisiciones» (con su «y» delante);
-- el resto de cada campo queda como está, y un nombre que se queda vacío pasa a
-- «Contabilidad». Un campo que no la dice no se toca.
update public.usuarios u
   set cargo = coalesce(nullif(btrim(regexp_replace(u.cargo, '\s*(y\s+|/\s*)?adquisici[oó]n(es)?\s*', ' ', 'gi')), ''), 'Contabilidad')
  from public.roles r
 where r.id = u.rol_id and r.codigo = 'CONTABILIDAD'
   and u.cargo ~* 'adquisici[oó]n';

update public.usuarios u
   set nombres = coalesce(nullif(btrim(regexp_replace(u.nombres, '\s*(y\s+|/\s*)?adquisici[oó]n(es)?\s*', ' ', 'gi')), ''), 'Contabilidad')
  from public.roles r
 where r.id = u.rol_id and r.codigo = 'CONTABILIDAD'
   and u.nombres ~* 'adquisici[oó]n';

update public.usuarios u
   set apellidos = btrim(regexp_replace(u.apellidos, '\s*(y\s+|/\s*)?adquisici[oó]n(es)?\s*', ' ', 'gi'))
  from public.roles r
 where r.id = u.rol_id and r.codigo = 'CONTABILIDAD'
   and u.apellidos ~* 'adquisici[oó]n';

-- Lo que quedó, para leerlo en el SQL Editor al pegarlo.
select r.nombre as puesto, u.nombres, u.apellidos, u.cargo
  from public.usuarios u join public.roles r on r.id = u.rol_id
 where r.codigo = 'CONTABILIDAD' and u.activo;
