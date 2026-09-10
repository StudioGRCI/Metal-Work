-- =============================================================================
-- EL CIRCUITO AVISA A QUIEN LE TOCA
-- -----------------------------------------------------------------------------
-- La cotización pasa por tres manos y hasta ahora ninguna se enteraba de que le
-- había llegado: Ventas la mandaba a costeo y Administración solo la veía si se
-- le ocurría entrar a mirar su bandeja. En una empresa donde el cuello de
-- botella es el tiempo —dieciséis días de promedio en «aprobación de
-- cotizaciones», según sus propios registros— una cotización parada porque nadie
-- supo que había llegado es plata quieta.
--
-- El aviso lo genera la base, no la aplicación. Es la única forma de que se
-- emita siempre: la pantalla se puede olvidar de llamar a una función, pero un
-- documento no cambia de estado sin pasar por acá.
--
-- Se reparte por permiso, no por persona: quien tiene que costear es «el que
-- puede costear», y si mañana entra otra persona a Administración le llegan sus
-- avisos sin tocar nada. Se guarda una fila por destinatario —la empresa tiene
-- doce usuarios, no doce mil— porque así el «leído» es una columna y no una
-- tabla aparte.
-- =============================================================================

create table if not exists public.notificaciones (
  id           uuid primary key default gen_random_uuid(),
  usuario_id   uuid not null references public.usuarios(id) on delete cascade,
  titulo       text not null,
  cuerpo       text,
  /** A dónde lleva al tocarla. Sin esto un aviso obliga a ir a buscar la cosa. */
  ruta         text,
  origen_tabla text,
  origen_id    uuid,
  leida_en     timestamptz,
  creado_en    timestamptz not null default now()
);

comment on table public.notificaciones is
  'Lo que a cada persona le toca saber. Una fila por destinatario: el «leído» es suyo, no del aviso.';

-- El índice que de verdad se usa: los sin leer de una persona, y su lista.
create index if not exists ix_notificaciones_usuario
  on public.notificaciones (usuario_id, creado_en desc);
create index if not exists ix_notificaciones_sin_leer
  on public.notificaciones (usuario_id) where leida_en is null;

alter table public.notificaciones enable row level security;

-- Cada quien ve las suyas y solo las suyas. No hay política de INSERT: los
-- avisos los escribe la base desde `security definer`, nunca el navegador; una
-- persona que pudiera crearse avisos podría también creárselos a otro.
drop policy if exists ver_notificaciones on public.notificaciones;
create policy ver_notificaciones on public.notificaciones
  for select to authenticated
  using (usuario_id = public.usuario_actual());

drop policy if exists marcar_notificaciones on public.notificaciones;
create policy marcar_notificaciones on public.notificaciones
  for update to authenticated
  using (usuario_id = public.usuario_actual())
  with check (usuario_id = public.usuario_actual());

grant select, update on public.notificaciones to authenticated;

-- ------------------------------------------------------------ el repartidor
/**
 * Deja un aviso a todos los que pueden hacer ese trabajo.
 *
 * `p_excepto` es quien provocó el cambio: avisarle a uno mismo de lo que acaba
 * de hacer es ruido, y el ruido enseña a ignorar los avisos.
 *
 * El rol ADMIN entra siempre porque no tiene permisos escritos —pasa por
 * `es_admin()`— y sin esta línea el administrador no se enteraría de nada.
 */
create or replace function public.notificar_a_permiso(
  p_permiso text,
  p_titulo  text,
  p_cuerpo  text,
  p_ruta    text,
  p_tabla   text,
  p_id      uuid,
  p_excepto uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_filas integer;
begin
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, p_titulo, p_cuerpo, p_ruta, p_tabla, p_id
    from public.usuarios u
    join public.roles r on r.id = u.rol_id
   where u.activo
     and (u.id is distinct from p_excepto)
     and (
       r.codigo = 'ADMIN'
       or exists (
         select 1 from public.roles_permisos rp
          where rp.rol_id = r.id and rp.permiso_codigo = p_permiso
       )
     );

  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;

comment on function public.notificar_a_permiso is
  'Deja un aviso a todo el que puede hacer ese trabajo, menos a quien lo provocó.';

/** Un aviso para una persona concreta —el vendedor de la cotización, por ejemplo—. */
create or replace function public.notificar_a_usuario(
  p_usuario uuid,
  p_titulo  text,
  p_cuerpo  text,
  p_ruta    text,
  p_tabla   text,
  p_id      uuid,
  p_excepto uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_usuario is null or p_usuario is not distinct from p_excepto then
    return 0;
  end if;

  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select p_usuario, p_titulo, p_cuerpo, p_ruta, p_tabla, p_id
   where exists (select 1 from public.usuarios u where u.id = p_usuario and u.activo);

  return 1;
end;
$$;

-- ------------------------------------------- el circuito de la cotización avisa
create or replace function public.fn_cotizacion_avisar()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_yo      uuid := public.usuario_actual();
  v_ruta    text := '/cotizaciones/' || new.id;
  v_cliente text;
  v_quien   text;
begin
  if new.estado is not distinct from old.estado then
    return new;
  end if;

  select c.razon_social into v_cliente from public.clientes c where c.id = new.cliente_id;
  v_quien := coalesce(v_cliente, 'un cliente');

  if new.estado = 'EN_COSTEO' then
    perform public.notificar_a_permiso(
      'cotizaciones.costear',
      'Cotización ' || new.numero || ' para costear',
      'Ventas la pasó a cotización de trabajo. Falta cargar las partidas y la ficha técnica. Cliente: ' || v_quien || '.',
      '/cotizaciones/trabajo', 'cotizaciones', new.id, v_yo);

  elsif new.estado = 'EN_REVISION' then
    perform public.notificar_a_permiso(
      'cotizaciones.revisar',
      'Cotización ' || new.numero || ' esperando tu visto',
      'Administración terminó el costeo. Cliente: ' || v_quien || '.',
      v_ruta, 'cotizaciones', new.id, v_yo);

  elsif new.estado = 'REVISADA' then
    -- Aprobada por Gerencia: se enteran los dos lados, que es lo que pidió la
    -- empresa. Ventas porque ya puede mandarla, Administración porque su
    -- trabajo pasó.
    perform public.notificar_a_permiso(
      'cotizaciones.costear',
      'Cotización ' || new.numero || ' aprobada por Gerencia',
      'Ya tiene el visto. Cliente: ' || v_quien || '.',
      v_ruta, 'cotizaciones', new.id, v_yo);
    perform public.notificar_a_permiso(
      'cotizaciones.crear',
      'Cotización ' || new.numero || ' aprobada por Gerencia',
      'Lista para enviar al cliente. Cliente: ' || v_quien || '.',
      v_ruta, 'cotizaciones', new.id, v_yo);
    perform public.notificar_a_usuario(
      new.vendedor_id,
      'Cotización ' || new.numero || ' aprobada por Gerencia',
      'Lista para enviar a ' || v_quien || '.',
      v_ruta, 'cotizaciones', new.id, v_yo);

  elsif new.estado = 'OBSERVADA' then
    -- Devuelta: le toca a quien la costeó, y el motivo va en el aviso para no
    -- obligar a abrir la cotización solo para saber qué corregir.
    perform public.notificar_a_permiso(
      'cotizaciones.costear',
      'Cotización ' || new.numero || ' devuelta por Gerencia',
      coalesce(new.motivo_observacion, 'Sin motivo escrito.'),
      v_ruta, 'cotizaciones', new.id, v_yo);

  elsif new.estado in ('APROBADA', 'RECHAZADA') then
    perform public.notificar_a_permiso(
      'cotizaciones.costear',
      'Cotización ' || new.numero || ' ' || lower(new.estado::text) || ' por el cliente',
      case when new.estado = 'APROBADA'
           then 'Ya se puede abrir la orden de trabajo. Cliente: ' || v_quien || '.'
           else coalesce(new.motivo_rechazo, 'Sin motivo escrito.') end,
      v_ruta, 'cotizaciones', new.id, v_yo);
    perform public.notificar_a_usuario(
      new.vendedor_id,
      'Cotización ' || new.numero || ' ' || lower(new.estado::text) || ' por el cliente',
      'Cliente: ' || v_quien || '.',
      v_ruta, 'cotizaciones', new.id, v_yo);
  end if;

  return new;
end;
$$;

comment on function public.fn_cotizacion_avisar is
  'Deja el aviso en cada mano del circuito. En la base y no en la pantalla: un documento no cambia de estado sin pasar por acá.';

drop trigger if exists trg_cotizacion_avisar on public.cotizaciones;

-- AFTER: el aviso se emite cuando el cambio ya está guardado. En BEFORE se
-- avisaría también de lo que después falla y se revierte.
create trigger trg_cotizacion_avisar
  after update of estado on public.cotizaciones
  for each row execute function public.fn_cotizacion_avisar();
