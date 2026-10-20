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
--     los checks); cambia el módulo con que se lista. El cierre del costeo, que
--     mandaba a Tesorería a cargarlo cuando faltaba, ahora remite a
--     Contabilidad (punto 4).
--   * «No tiene por qué ver requerimientos: no entra en la parte
--     administrativa, solo visualiza lo que entra de Logística en
--     Adquisiciones.» Contabilidad pierde `requerimientos.ver`: la lista de
--     RQ y la bandeja de atención la rechazan también por su dirección, y la
--     tabla `requerimientos` deja de leerse con su cuenta. El número de RQ
--     sigue saliendo en la lista de Adquisiciones, que lo lee de
--     `insumos_de_compras`; en el kardex y en el formato de salida del almacén,
--     que lo leen de `requerimientos`, ya no. Lo que entra de Logística sigue entero: las OC de antes, las que
--     salieron de la solicitud de materiales de una OT, se ven solo si se lee
--     esa solicitud, y esa lectura pedía `requerimientos.ver`. Sin el punto 2b
--     esas OC, sus líneas y su PDF se le escondían sin error.
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

-- 2b. Las OC de antes las sigue viendo entera quien ve Adquisiciones ---------------------------
-- La solicitud de materiales de una OT (el circuito de antes del RQ) y sus
-- líneas: las lee también quien tiene `adquisiciones.ver`, con el mismo
-- alcance por área de siempre. Así la OC que salió de ella, sus líneas y su PDF
-- le siguen llegando a Contabilidad. Los demás que tienen `adquisiciones.ver`
-- (Tesorería, Logística, Gerencia) ya la leían por `requerimientos.ver`.
alter policy ver_requerimientos_materiales on public.requerimientos_materiales using (
  (public.tiene_permiso('requerimientos.ver') or public.tiene_permiso('adquisiciones.ver'))
  and public.puede_ver_area_material(area_destino)
);
alter policy ver_requerimiento_material_detalles on public.requerimiento_material_detalles using (exists (
  select 1 from public.requerimientos_materiales r
   where r.id = requerimiento_material_detalles.requerimiento_id
     and (public.tiene_permiso('requerimientos.ver') or public.tiene_permiso('adquisiciones.ver'))
     and public.puede_ver_area_material(r.area_destino)
));

-- 3. El puesto y su cuenta se llaman Contabilidad -------------------------------------------
update public.roles set nombre = 'Contabilidad'
 where codigo = 'CONTABILIDAD' and nombre is distinct from 'Contabilidad';

-- Solo cambia la palabra «Adquisición» o «Adquisiciones»; lo demás de cada campo
-- queda como está y un campo que no la dice no se toca. Si el campo ya dice
-- «Contabilidad», la palabra sale con lo que la une: los paréntesis que la
-- envuelven, o «y», «e», «o», «y/o», «de», «del», «la», «las», «los», «el» o un
-- signo («-», «–», «—», «,», «/», «&», «|», «·», «:», «+») delante o detrás.
-- «Contabilidad (Adquisiciones)», «Contabilidad de Adquisiciones» y
-- «Adquisiciones – Contabilidad» → «Contabilidad». Si no la dice, en el nombre y
-- el cargo pasa a decirla («Jefa de Adquisiciones» → «Jefa de Contabilidad»); en
-- los apellidos solo sale. Al final no queda un «( )» vacío ni un signo colgando.
-- La «Ó» va escrita aparte porque con la intercalación «C» el ~* no la iguala a
-- la «ó». Cada campo se decide por sí solo: el select del final muestra lo que
-- quedó, y si algo se lee raro se corrige en Usuarios.
-- La función es temporal: muere con la sesión.
create or replace function pg_temp.sin_adquisiciones(p text, p_poner boolean) returns text language sql immutable as $f$
  select regexp_replace(regexp_replace(btrim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
    case when p_poner and p !~* 'contabilidad'
      then regexp_replace(p, '\yadquisici[oóÓ]n(es)?\y', 'Contabilidad', 'gi')
      else regexp_replace(regexp_replace(regexp_replace(regexp_replace(p,
        '\(\s*adquisici[oóÓ]n(es)?\s*\)', '', 'gi'),
        '\yadquisici[oóÓ]n(es)?(\s*(\yy/o\y|\y[yeo]\y|[-–—,/&|·:+]))+\s*', '', 'gi'),
        '(\s*(\yy/o\y|\y[yeo]\y|\ydel?\y|\yl[ao]s?\y|\yel\y|[-–—,/&|·:+]))+\s*adquisici[oóÓ]n(es)?\y', '', 'gi'),
        '\yadquisici[oóÓ]n(es)?\y', '', 'gi')
    end,
    '\(\s*\)', '', 'g'),
    '\(\s+', '(', 'g'),
    '\s+\)', ')', 'g'),
    '\s+', ' ', 'g')),
    '^[-–—,/&|·:+\s]+|[-–—,/&|·:+\s]+$', '', 'g'),
    '^\(([^()]*)\)$', '\1');
$f$;

update public.usuarios u
   set cargo = coalesce(nullif(pg_temp.sin_adquisiciones(u.cargo, true), ''), 'Contabilidad')
  from public.roles r
 where r.id = u.rol_id and r.codigo = 'CONTABILIDAD'
   and u.cargo ~* 'adquisici[oóÓ]n';

update public.usuarios u
   set nombres = coalesce(nullif(pg_temp.sin_adquisiciones(u.nombres, true), ''), 'Contabilidad')
  from public.roles r
 where r.id = u.rol_id and r.codigo = 'CONTABILIDAD'
   and u.nombres ~* 'adquisici[oóÓ]n';

update public.usuarios u
   set apellidos = pg_temp.sin_adquisiciones(u.apellidos, false)
  from public.roles r
 where r.id = u.rol_id and r.codigo = 'CONTABILIDAD'
   and u.apellidos ~* 'adquisici[oóÓ]n';

-- 4. El cierre del costeo ya no manda a Tesorería por el tipo de cambio ---------------------
-- `cerrar_costeo_codigo` (vigente desde la 20261020120000) dice «(lo carga
-- Tesorería)» cuando falta el cambio de una línea en dólares o el del día en que
-- se aprobó la cotización, y Tesorería ya no entra a registrarlo. Se cambia solo
-- esa frase sobre la definición que está en la base, sin copiar la función
-- entera: así no se pisa la versión vigente. Correrlo otra vez no hace nada.
do $$
declare v_def text;
begin
  for v_def in
    select pg_get_functiondef(p.oid)
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'cerrar_costeo_codigo'
  loop
    if v_def like '%(lo carga Tesorería)%' then
      execute replace(v_def, '(lo carga Tesorería)', '(lo registra Contabilidad)');
    end if;
  end loop;
end $$;

-- Lo que quedó, para leerlo en el SQL Editor al pegarlo.
select r.nombre as puesto, u.nombres, u.apellidos, u.cargo
  from public.usuarios u join public.roles r on r.id = u.rol_id
 where r.codigo = 'CONTABILIDAD' and u.activo;
