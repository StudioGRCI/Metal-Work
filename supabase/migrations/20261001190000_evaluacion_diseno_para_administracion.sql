-- =============================================================================
-- LA EVALUACIÓN DE DESEMPEÑO DE DISEÑO: LA HACE DISEÑO, LA RECIBE ADMINISTRACIÓN
-- -----------------------------------------------------------------------------
-- El «Formato para evaluación del desempeño laboral del personal de la empresa
-- Metal Work Perú SAC» lo llena la jefatura de Diseño e Ingeniería (el
-- supervisor de diseño): veinte comportamientos de 1 a 5, el puntaje total
-- sobre 100 % y sus comentarios. La empresa lo dijo así el 2026-10-01: la
-- evaluación la realiza Diseño e Ingeniería para envío a Administración, y no
-- la ve Recursos Humanos, solo Administración.
--
-- Hasta hoy la escribía quien tuviera `diseno.planos` —también Gerencia— y la
-- leían Recursos Humanos y Supervisión General; no había envío ni acuse. Ahora:
--   · `diseno.evaluar` (Diseño e ingeniería y Líder de Diseño) escribe las
--     suyas, las corrige mientras no salgan y las envía.
--   · `administracion.recibir_evaluacion` (Administración) ve solo las
--     enviadas, y las recibe o las devuelve con una observación.
--   · Nadie más la lee: ni Recursos Humanos, ni Supervisión General, ni
--     Gerencia. El administrador del sistema, como en todo.
--
-- Enviada, queda cerrada: lo que Administración recibe es lo que firmó el
-- evaluador. Si hay que corregirla, Administración la devuelve y el evaluador
-- la vuelve a enviar. Un borrador que nunca salió se puede borrar; una que ya
-- salió, nunca: queda como constancia.
--
-- Sin auditoría genérica, a propósito: `audit_log` lo leen Gerencia y
-- Supervisión General (`auditoria.ver`) y copiaría ahí la evaluación entera.
-- La fila guarda su propia historia: quién la hizo, cuándo salió, quién la
-- devolvió y por qué, quién la recibió y cuándo.
--
-- En producción no había ninguna evaluación registrada (0 filas).
-- =============================================================================

insert into public.permisos (codigo, modulo, descripcion) values
  ('diseno.evaluar', 'Diseño', 'Evaluar el desempeño del personal de Diseño e Ingeniería y enviarlo a Administración'),
  ('administracion.recibir_evaluacion', 'Administración', 'Recibir o devolver las evaluaciones de desempeño de Diseño')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, v.permiso
  from public.roles r
  join (values
    ('DISENO', 'diseno.evaluar'),
    ('DISENO_LIDER', 'diseno.evaluar'),
    ('ADMINISTRACION', 'administracion.recibir_evaluacion')
  ) v(rol, permiso) on v.rol = r.codigo
on conflict do nothing;

-- Quién firmó y quién recibió van con llave a `usuarios` pero sin índice: la
-- aplicación nunca filtra por ellas y un usuario no se borra, se desactiva
-- (ver «Lo que ya se midió» en la skill `datos`).
alter table public.diseno_evaluaciones
  add column if not exists area_servicio    text not null default 'Ingeniería',
  add column if not exists evaluador_nombre text,
  add column if not exists evaluador_cargo  text,
  add column if not exists estado           text not null default 'BORRADOR',
  add column if not exists enviada_en       timestamptz,
  add column if not exists observacion      text,
  add column if not exists observada_por    uuid references public.usuarios(id),
  add column if not exists observada_en     timestamptz,
  add column if not exists recibida_por     uuid references public.usuarios(id),
  add column if not exists recibida_en      timestamptz,
  add column if not exists actualizado_en   timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'diseno_evaluaciones_estado_check') then
    alter table public.diseno_evaluaciones add constraint diseno_evaluaciones_estado_check
      check (estado in ('BORRADOR', 'ENVIADA', 'OBSERVADA', 'RECIBIDA'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'diseno_evaluaciones_textos_check') then
    alter table public.diseno_evaluaciones add constraint diseno_evaluaciones_textos_check
      check (length(btrim(area_servicio)) between 2 and 60
         and (evaluador_cargo is null or length(evaluador_cargo) <= 100)
         and (observacion is null or length(observacion) <= 1000));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Las reglas de la evaluación, en un disparador: quién escribe, en qué estado
-- y qué transición le toca a cada uno. Los sellos (envío, devolución, recibo)
-- los pone el disparador; lo que mande la aplicación en esas columnas no vale.
-- -----------------------------------------------------------------------------
create or replace function public.controlar_evaluacion_diseno()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_usuario     uuid := public.usuario_actual();
  v_observacion text;
  v_nombre      text;
  v_cargo       text;
  c_sellos constant text[] := array['estado', 'enviada_en', 'observacion', 'observada_por', 'observada_en',
                                    'recibida_por', 'recibida_en', 'actualizado_en'];
begin
  if tg_op = 'INSERT' then
    perform public.exigir_permiso('diseno.evaluar');
    -- Sin sesión (una migración, la clave de servicio) se respeta lo que viene.
    if v_usuario is not null then
      new.evaluador_id := v_usuario;
    end if;
    -- El nombre del evaluador queda copiado: es el que va en la firma, y
    -- Administración no tiene por qué poder leer la ficha de usuarios.
    select nullif(btrim(coalesce(u.nombres, '') || ' ' || coalesce(u.apellidos, '')), ''), nullif(btrim(u.cargo), '')
      into v_nombre, v_cargo
      from public.usuarios u
     where u.id = new.evaluador_id;
    new.evaluador_nombre := v_nombre;
    new.evaluador_cargo := coalesce(nullif(btrim(new.evaluador_cargo), ''), v_cargo);
    new.estado := 'BORRADOR';
    new.enviada_en := null; new.observacion := null; new.observada_por := null; new.observada_en := null;
    new.recibida_por := null; new.recibida_en := null;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.estado <> 'BORRADOR' or old.enviada_en is not null then
      raise exception 'Esta evaluación ya salió hacia Administración: queda como constancia y no se borra.';
    end if;
    if v_usuario is not null and v_usuario is distinct from old.evaluador_id and not public.es_admin() then
      raise exception 'Solo quien hizo la evaluación puede borrar su borrador.';
    end if;
    return old;
  end if;

  -- UPDATE. Quién la hizo y cuándo no cambia nunca.
  v_observacion := nullif(btrim(coalesce(new.observacion, '')), '');
  new.id := old.id;
  new.evaluador_id := old.evaluador_id;
  new.evaluador_nombre := old.evaluador_nombre;
  new.creado_en := old.creado_en;

  if (to_jsonb(new) - c_sellos) is distinct from (to_jsonb(old) - c_sellos) then
    perform public.exigir_permiso('diseno.evaluar');
    if v_usuario is not null and v_usuario is distinct from old.evaluador_id and not public.es_admin() then
      raise exception 'Solo quien hizo la evaluación puede corregirla.';
    end if;
    if old.estado not in ('BORRADOR', 'OBSERVADA') then
      raise exception 'La evaluación ya se envió a Administración y está cerrada. Para corregirla, Administración tiene que devolverla.';
    end if;
  end if;

  new.enviada_en := old.enviada_en;
  new.observacion := old.observacion; new.observada_por := old.observada_por; new.observada_en := old.observada_en;
  new.recibida_por := old.recibida_por; new.recibida_en := old.recibida_en;

  if new.estado is distinct from old.estado then
    if new.estado = 'ENVIADA' and old.estado in ('BORRADOR', 'OBSERVADA') then
      perform public.exigir_permiso('diseno.evaluar');
      if v_usuario is not null and v_usuario is distinct from old.evaluador_id and not public.es_admin() then
        raise exception 'Solo quien hizo la evaluación puede enviarla.';
      end if;
      new.enviada_en := now();
    elsif new.estado = 'OBSERVADA' and old.estado = 'ENVIADA' then
      perform public.exigir_permiso('administracion.recibir_evaluacion');
      if length(coalesce(v_observacion, '')) < 10 then
        raise exception 'Explica en al menos 10 caracteres qué hay que corregir en la evaluación.';
      end if;
      new.observacion := v_observacion; new.observada_por := v_usuario; new.observada_en := now();
    elsif new.estado = 'RECIBIDA' and old.estado = 'ENVIADA' then
      perform public.exigir_permiso('administracion.recibir_evaluacion');
      new.recibida_por := v_usuario; new.recibida_en := now();
    else
      raise exception 'Una evaluación % no puede pasar a %.',
        lower(case old.estado when 'BORRADOR' then 'en borrador' when 'OBSERVADA' then 'devuelta' else old.estado end),
        lower(case new.estado when 'BORRADOR' then 'borrador' when 'OBSERVADA' then 'devuelta' else new.estado end);
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.controlar_evaluacion_diseno() from public, anon, authenticated;

drop trigger if exists trg_evaluacion_diseno on public.diseno_evaluaciones;
create trigger trg_evaluacion_diseno
  before insert or update or delete on public.diseno_evaluaciones
  for each row execute function public.controlar_evaluacion_diseno();

select public.activar_timestamps('diseno_evaluaciones');
select public.activar_registro_de_prueba('diseno_evaluaciones');

-- -----------------------------------------------------------------------------
-- Quién la ve. El evaluador ve las suyas en cualquier estado —para que un
-- cambio fuera de lugar le devuelva el motivo del disparador y no un «no se
-- guardó nada»—; Administración, las que ya le llegaron.
-- -----------------------------------------------------------------------------
drop policy if exists diseno_evaluaciones_ver on public.diseno_evaluaciones;
create policy diseno_evaluaciones_ver on public.diseno_evaluaciones
  for select to authenticated
  using (
    (select public.es_admin())
    or ((select public.tiene_permiso('diseno.evaluar')) and evaluador_id = (select auth.uid()))
    or ((select public.tiene_permiso('administracion.recibir_evaluacion')) and estado in ('ENVIADA', 'OBSERVADA', 'RECIBIDA'))
  );

drop policy if exists diseno_evaluaciones_crear on public.diseno_evaluaciones;
create policy diseno_evaluaciones_crear on public.diseno_evaluaciones
  for insert to authenticated
  with check (
    (select public.es_admin())
    or ((select public.tiene_permiso('diseno.evaluar')) and evaluador_id = (select auth.uid()))
  );

drop policy if exists diseno_evaluaciones_editar on public.diseno_evaluaciones;
create policy diseno_evaluaciones_editar on public.diseno_evaluaciones
  for update to authenticated
  using (
    (select public.es_admin())
    or ((select public.tiene_permiso('diseno.evaluar')) and evaluador_id = (select auth.uid()))
    or ((select public.tiene_permiso('administracion.recibir_evaluacion')) and estado in ('ENVIADA', 'OBSERVADA', 'RECIBIDA'))
  )
  with check (
    (select public.es_admin())
    or ((select public.tiene_permiso('diseno.evaluar')) and evaluador_id = (select auth.uid()))
    or ((select public.tiene_permiso('administracion.recibir_evaluacion')) and estado in ('OBSERVADA', 'RECIBIDA'))
  );

drop policy if exists diseno_evaluaciones_borrar on public.diseno_evaluaciones;
create policy diseno_evaluaciones_borrar on public.diseno_evaluaciones
  for delete to authenticated
  using (
    (select public.es_admin())
    or ((select public.tiene_permiso('diseno.evaluar')) and evaluador_id = (select auth.uid()))
  );

revoke all on public.diseno_evaluaciones from public, anon, authenticated;
grant select, insert, update, delete on public.diseno_evaluaciones to authenticated;
