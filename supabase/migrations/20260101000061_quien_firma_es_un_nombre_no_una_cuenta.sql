-- =============================================================================
-- QUIEN FIRMA ES UN NOMBRE, NO UNA CUENTA
-- -----------------------------------------------------------------------------
-- Ayer se guardó al firmante como una referencia a un usuario del sistema, y se
-- dejó puesto el único que había con rol GERENTE: «Aníbal Sologuren», que es
-- dato de demostración. En la cotización real que la empresa mandó —la 3668—
-- quien firma es YHON SANDOVAL JUAREZ.
--
-- El error de fondo no fue el nombre, fue la forma: **quien firma no tiene por
-- qué tener cuenta en el sistema**. Atar la firma a la tabla de usuarios obliga
-- a crearle un acceso a alguien que a lo mejor nunca va a entrar, y deja el
-- papel sin firma el día que esa cuenta se dé de baja.
--
-- Se guarda el nombre y el cargo tal como van impresos. Dos columnas de texto en
-- la ficha de la empresa: no cambian de una cotización a otra, y la que las
-- escribe es administración desde Configuración.
-- =============================================================================

alter table public.empresa
  add column if not exists firma_nombre text,
  add column if not exists firma_cargo  text;

comment on column public.empresa.firma_nombre is
  'Quien firma las cotizaciones, tal como va impreso bajo «Atentamente». Es un nombre, no una cuenta: quien firma no tiene por qué entrar al sistema.';
comment on column public.empresa.firma_cargo is
  'El cargo que va bajo el nombre. En sus papeles, «Gerente General».';

-- El de sus cotizaciones de verdad.
update public.empresa
   set firma_nombre = coalesce(firma_nombre, 'YHON SANDOVAL JUAREZ'),
       firma_cargo  = coalesce(firma_cargo, 'Gerente General');

-- La referencia al usuario sobra: dos formas de decir lo mismo terminan
-- diciendo cosas distintas.
alter table public.empresa drop column if exists gerente_general_id;

drop function if exists public.datos_de_empresa();

create function public.datos_de_empresa()
returns table(
  razon_social text, nombre_comercial text, ruc text, direccion text,
  distrito text, provincia text, departamento text, telefono text,
  correo text, web text,
  gerente_general text, gerente_general_cargo text)
language plpgsql
stable security definer
set search_path to 'public'
as $$
begin
  if not public.es_usuario_activo() then
    raise exception 'Tu cuenta no está activa.' using errcode = 'insufficient_privilege';
  end if;

  return query
  select e.razon_social, e.nombre_comercial, e.ruc::text, e.direccion,
         e.distrito, e.provincia, e.departamento, e.telefono,
         e.correo::text, e.web,
         e.firma_nombre, e.firma_cargo
    from public.empresa e
   order by e.creado_en
   limit 1;
end;
$$;

grant execute on function public.datos_de_empresa() to authenticated;
