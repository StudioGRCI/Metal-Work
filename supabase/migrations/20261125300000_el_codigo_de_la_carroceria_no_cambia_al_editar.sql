-- =============================================================================
-- EL CÓDIGO DE LA CARROCERÍA NO CAMBIA AL EDITARLA
-- -----------------------------------------------------------------------------
-- Las carrocerías de la casa llevan el código de tres letras de la hoja COD del
-- libro de seguimiento de fabricación (VPC, CIA, FRG…), que es el primer
-- segmento del código con que el taller llama a cada unidad mientras la
-- construye (VSC_SR_O4_6_26/30). Ese código no sale del nombre: lo puso la
-- empresa.
--
-- Desde el 28/09, `editar_carroceria_ventas` volvía a armar el código a partir
-- del nombre cada vez que Ventas guardaba la carrocería, y también cuando la
-- desactivaba o la reactivaba (la acción del catálogo pasa por la misma
-- función). «Tolva volquete · piso circular» habría dejado de ser VPC para ser
-- TOLVA_VOLQUETE_PISO_CIRCULAR: a 32 de las 41 carrocerías de producción les
-- cambiaba el código con solo tocar «Editar». Revisado el 25/11 en producción:
-- ninguna se había editado desde entonces y ningún código había cambiado.
--
-- Diseño, que corrige la fila con su permiso, nunca tocó el código. Ahora Ventas
-- tampoco: cambia el nombre, la descripción y si está activa, y el código se
-- queda como está. El código solo se arma del nombre al dar de alta una
-- carrocería que el catálogo no tenía.
--
-- La función se reemplaza entera: antes se mira que la de la base sea la que
-- conoce el repositorio, para no pisar un arreglo hecho a mano.
-- =============================================================================

do $$
declare
  huella text;
begin
  select md5(replace(p.prosrc, E'\r', '')) into huella
    from pg_proc p
   where p.oid = to_regprocedure('public.editar_carroceria_ventas(uuid,text,text,boolean)');
  if huella is null then
    raise exception 'Falta la función editar_carroceria_ventas: esta base no tiene las migraciones anteriores.';
  end if;
  -- La del 28/09 (rehace el código) o esta misma, si la migración se vuelve a correr.
  if huella not in ('7867c83f4434d82169c5789f23a1bea4', '426acab86832017e692fa91762b6730e') then
    raise exception 'La función editar_carroceria_ventas no es la que conoce el repositorio (se cambió a mano): no se reemplaza. Avisa antes de seguir.';
  end if;
end $$;

create or replace function public.editar_carroceria_ventas(p_id uuid, p_nombre text, p_descripcion text, p_activo boolean)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_id uuid;
begin
  perform public.exigir_permiso('cotizaciones.crear');
  if p_nombre is null or length(btrim(p_nombre)) < 3 or length(btrim(p_nombre)) > 120 then
    raise exception 'El nombre de la carrocería debe tener entre 3 y 120 caracteres.' using errcode = '22023';
  end if;
  -- El código no se toca: es el de la empresa y lo nombran las unidades.
  update public.tipos_carroceria
     set nombre = btrim(p_nombre),
         descripcion = nullif(btrim(p_descripcion), ''),
         activo = p_activo
   where id = p_id
   returning id into v_id;
  if v_id is null then
    raise exception 'No se encontró la carrocería o tu perfil no tiene acceso.' using errcode = 'P0002';
  end if;
  return v_id;
end;
$$;

comment on function public.editar_carroceria_ventas(uuid,text,text,boolean) is
  'SECURITY DEFINER intencional: permite a Ventas editar nombre/descripcion/activo sin abrir los campos de costo; exigir_permiso limita a cotizaciones.crear. El código de la carrocería no cambia.';
revoke all on function public.editar_carroceria_ventas(uuid,text,text,boolean) from public, anon;
grant execute on function public.editar_carroceria_ventas(uuid,text,text,boolean) to authenticated;
