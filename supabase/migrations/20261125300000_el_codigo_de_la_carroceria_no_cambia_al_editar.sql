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
  if huella not in ('7867c83f4434d82169c5789f23a1bea4', '2c6f10ded8063e616853f103f57a6d16') then
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
  if regexp_replace(upper(public.unaccent(btrim(p_nombre))), '[^A-Z0-9]+', '', 'g') = '' then
    raise exception 'El nombre debe incluir letras o números.' using errcode = '22023';
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

-- -----------------------------------------------------------------------------
-- Dos carrocerías no se llaman igual
-- -----------------------------------------------------------------------------
-- Antes lo atajaba, de rebote, el código armado del nombre («Ya existe una
-- carrocería con un nombre parecido»). Sin eso, renombrar una con el nombre de
-- otra dejaba dos iguales en el desplegable de la cotización. Se compara el
-- nombre como se arma un código en el alta (mayúsculas, sin tildes ni signos:
-- `codigoDeCarroceria`), por Ventas
-- y por Diseño, y solo cuando el nombre cambia: producción ya tiene «Cama baja»
-- y «Plataforma» dos veces (una de cada una desactivada) y tocar la
-- descripción o reactivarla no tiene por qué fallar. El alta ya devuelve la que
-- había con el mismo nombre en vez de repetirla.
create or replace function public.fn_carroceria_nombre_sin_repetir()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_igual text;
  v_clave text := trim(both '_' from regexp_replace(upper(public.unaccent(btrim(new.nombre))), '[^A-Z0-9]+', '_', 'g'));
begin
  if v_clave = trim(both '_' from regexp_replace(upper(public.unaccent(btrim(old.nombre))), '[^A-Z0-9]+', '_', 'g')) then
    return new;
  end if;
  select t.nombre into v_igual
    from public.tipos_carroceria t
   where t.id <> new.id
     and trim(both '_' from regexp_replace(upper(public.unaccent(btrim(t.nombre))), '[^A-Z0-9]+', '_', 'g')) = v_clave
   limit 1;
  if v_igual is not null then
    raise exception 'Ya hay otra carrocería con ese nombre: «%». Usa otro nombre.', v_igual using errcode = '23505';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_carroceria_nombre_sin_repetir() from public, anon, authenticated;

create or replace trigger carroceria_nombre_sin_repetir
  before update of nombre on public.tipos_carroceria
  for each row execute function public.fn_carroceria_nombre_sin_repetir();
