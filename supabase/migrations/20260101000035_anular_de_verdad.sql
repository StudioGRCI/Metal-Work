-- =============================================================================
-- LA ANULACIÓN, BIEN HECHA: EL SELLO NO SE FIRMA A NOMBRE DE OTRO
-- -----------------------------------------------------------------------------
-- La migración 034 dejó tres puertas abiertas que una revisión adversaria
-- encontró, y las tres tocan justo lo que la anulación existe para dar:
--
--   1. El sello era falsificable. `coalesce(new.anulada_por, usuario_actual())`
--      acepta lo que mande el cliente, así que cualquiera podía anular una
--      cotización firmando con el nombre de un colega y con fecha inventada,
--      y la fila quedaba congelada con esa mentira dentro. Un rastro que se
--      puede escribir a mano no es un rastro: es un adorno.
--
--   2. Anular una cotización APROBADA pedía el mismo permiso que corregir un
--      borrador. Una aprobada es el compromiso que el cliente aceptó; dejarla
--      sin efecto es una decisión comercial, no una corrección de redacción.
--      Ahora tiene su propio permiso, como ya lo tiene anular una orden.
--
--   3. La guarda de «tiene una orden viva» trataba como viva a una orden ya
--      ENTREGADA o FACTURADA, que por diseño no se puede anular. Resultado:
--      una cotización antigua no se podía anular nunca, y el mensaje mandaba
--      al usuario a hacer algo imposible.
--
-- De paso, el número deja de poder cambiarse después de emitido: es el
-- correlativo de la empresa, no un campo de texto.
-- =============================================================================

-- ------------------------------------------------- el permiso de anular
-- Espeja ordenes.anular: dejar sin efecto un documento que el cliente ya
-- aceptó es cosa de Gerencia, no de quien lo redactó.
insert into public.permisos (codigo, modulo, descripcion) values
  ('cotizaciones.anular', 'cotizaciones',
   'Anular una cotización que el cliente ya aprobó')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'cotizaciones.anular'
  from public.roles r
 where r.codigo = 'GERENTE'
on conflict do nothing;

-- ---------------------------------------- el botón que decía que sí y no
-- Buscando dónde encajaba el permiso de anular apareció algo peor, y vivo: la
-- política de escritura de cotizaciones solo acepta `cotizaciones.editar`, que
-- tiene el VENDEDOR. GERENTE tiene `cotizaciones.aprobar` y no tiene editar, así
-- que al pulsar «Marcar aprobada» el UPDATE afectaba cero filas, Supabase no
-- devuelve error por una fila que el RLS esconde, la pantalla decía «Estado
-- actualizado» y la cotización seguía ENVIADA. Nadie podía aprobar nada.
--
-- Es el mismo fallo mudo de la numeración (033): un permiso que la aplicación
-- exige y la política no reconoce. La política pasa a aceptar los tres permisos
-- que gobiernan el ciclo del documento; qué puede hacer cada uno lo siguen
-- decidiendo la máquina de estados y las guardas de acá abajo.
drop policy if exists editar_cotizaciones on public.cotizaciones;
create policy editar_cotizaciones on public.cotizaciones
  for update to authenticated
  using (
    public.es_admin()
    or public.tiene_permiso('cotizaciones.editar')
    or public.tiene_permiso('cotizaciones.aprobar')
    or public.tiene_permiso('cotizaciones.anular'))
  with check (
    public.es_admin()
    or public.tiene_permiso('cotizaciones.editar')
    or public.tiene_permiso('cotizaciones.aprobar')
    or public.tiene_permiso('cotizaciones.anular'));

-- ------------------------------------------------------- la anulación
create or replace function public.fn_cotizacion_anular()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_orden text;
begin
  -- Una anulada es evidencia: no se retoca ni un campo.
  if old.estado = 'ANULADA' then
    raise exception
      'La cotización % está anulada y se conserva como evidencia; emite una nueva en su lugar.',
      old.numero
      using errcode = 'restrict_violation';
  end if;

  if new.estado = 'ANULADA' then
    -- Lo que el cliente ya aceptó no lo deshace quien redacta borradores.
    if old.estado = 'APROBADA' then
      perform public.exigir_permiso('cotizaciones.anular');
    else
      perform public.exigir_permiso('cotizaciones.editar');
    end if;

    if nullif(btrim(new.motivo_anulacion), '') is null then
      raise exception 'Indica el motivo de la anulación de la cotización %.', old.numero
        using errcode = 'check_violation';
    end if;

    -- Viva es la que todavía puede pararse. Una ENTREGADA o FACTURADA ya no
    -- vuelve a producción —ot_transicion_valida no admite anularlas—, así que
    -- exigir que se anule primero era mandar a una puerta tapiada.
    select o.numero into v_orden
      from public.ordenes_trabajo o
     where o.cotizacion_id = new.id
       and o.estado not in ('ANULADA', 'ENTREGADA', 'FACTURADA')
     order by o.numero
     limit 1;

    if v_orden is not null then
      raise exception
        'La cotización % abrió la orden %, que sigue en curso; anula primero esa orden de trabajo.',
        old.numero, v_orden
        using errcode = 'restrict_violation';
    end if;

    -- El sello lo pone la base, no quien llama: sin esto, cualquiera anula
    -- firmando con el nombre de otro y con la fecha que se le antoje.
    new.anulada_por := public.usuario_actual();
    new.anulada_en  := now();
  else
    -- Fuera de la anulación, el rastro no se escribe a mano.
    new.motivo_anulacion := old.motivo_anulacion;
    new.anulada_por      := old.anulada_por;
    new.anulada_en       := old.anulada_en;
  end if;

  return new;
end;
$$;

comment on function public.fn_cotizacion_anular is
  'Exige el permiso que corresponde al estado, pide motivo, sella quién y cuándo sin aceptar lo que mande el cliente, y congela la cotización anulada como evidencia.';

revoke all on function public.fn_cotizacion_anular() from public, anon, authenticated;

-- --------------------------------------------------- el número es historia
-- El correlativo se asigna una vez y se acabó. Sin esta guarda, quien puede
-- editar una cotización puede reescribirle el número: se rompe la serie de la
-- empresa y el número viaja además al nombre del archivo que se descarga.
create or replace function public.fn_cotizacion_numero_inmutable()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.numero is distinct from old.numero and nullif(btrim(old.numero), '') is not null then
    raise exception
      'El número de la cotización % no se cambia: es el correlativo de la empresa.',
      old.numero
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

comment on function public.fn_cotizacion_numero_inmutable is
  'El correlativo emitido no se reescribe. Corre después de fn_cotizacion_calcular, que es quien lo asigna al emitir.';

drop trigger if exists trg_cotizacion_numero_inmutable on public.cotizaciones;
create trigger trg_cotizacion_numero_inmutable
  before update on public.cotizaciones
  for each row execute function public.fn_cotizacion_numero_inmutable();

revoke all on function public.fn_cotizacion_numero_inmutable() from public, anon, authenticated;

-- --------------------------------------------------------- el membrete
-- La misma fila que usa fn_cotizacion_calcular para congelar el IGV. Sin el
-- orden explícito, el papel podía encabezarse con el RUC de una fila y llevar
-- el IGV de otra.
create or replace function public.datos_de_empresa()
returns table (
  razon_social     text,
  nombre_comercial text,
  ruc              text,
  direccion        text,
  distrito         text,
  provincia        text,
  departamento     text,
  telefono         text,
  correo           text,
  web              text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public.es_usuario_activo() then
    raise exception 'Tu cuenta no está activa.' using errcode = 'insufficient_privilege';
  end if;

  return query
  select e.razon_social, e.nombre_comercial, e.ruc::text, e.direccion,
         e.distrito, e.provincia, e.departamento, e.telefono,
         e.correo::text, e.web
    from public.empresa e
   order by e.creado_en
   limit 1;
end;
$$;

revoke all on function public.datos_de_empresa() from public, anon;
grant execute on function public.datos_de_empresa() to authenticated;
