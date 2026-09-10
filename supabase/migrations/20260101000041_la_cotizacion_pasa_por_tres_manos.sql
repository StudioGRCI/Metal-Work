-- =============================================================================
-- LA COTIZACIÓN PASA POR TRES MANOS, Y EL PRECIO ES DE VENTAS
-- -----------------------------------------------------------------------------
-- En la empresa cotizar no es un acto, son tres, y hasta hoy el sistema los
-- metía todos en una sola pantalla con un solo estado:
--
--   1. VENTAS abre la cotización. Habla con el cliente, sabe qué unidad es, qué
--      quiere y por cuánto se la ofrece. El precio sale de acá y manda.
--   2. ADMINISTRACIÓN la recibe y arma la cotización de trabajo: las partidas,
--      los ejes, la ficha técnica. Es el detalle con el que después se compra el
--      material y se programa el taller, y es la misma área que luego emite la
--      orden de trabajo.
--   3. GERENCIA revisa antes de que el papel salga. Puede dar el visto o
--      devolverla con una observación.
--
-- Un solo documento y un solo número, tres etapas. Lo que cambia es quién puede
-- tocar qué y en qué momento, y eso lo tiene que defender la base: la pantalla
-- esconde botones, pero quien entra por otra puerta no ve pantallas.
--
-- El precio manda, y eso cambia la aritmética. Hasta hoy el total salía de sumar
-- las partidas: el vendedor prometía un número y el papel imprimía otro. Ahora
-- el precio ofrecido es el que se imprime, y la suma de las partidas pasa a
-- llamarse por su nombre —costo estimado— y sirve para lo que de verdad sirve:
-- comprar, programar y medir el margen.
-- =============================================================================

-- ------------------------------------------------- los estados que faltaban
-- Van en su sitio dentro del orden del enum para que cualquier listado ordenado
-- por estado cuente la historia en el orden en que ocurre.
alter type public.estado_cotizacion add value if not exists 'EN_COSTEO' after 'BORRADOR';
alter type public.estado_cotizacion add value if not exists 'EN_REVISION' after 'EN_COSTEO';
alter type public.estado_cotizacion add value if not exists 'OBSERVADA' after 'EN_REVISION';
alter type public.estado_cotizacion add value if not exists 'REVISADA' after 'OBSERVADA';

-- ------------------------------------------------------- el precio y el costo
alter table public.cotizaciones
  add column if not exists precio_venta        public.monto,
  add column if not exists costo_estimado      public.monto not null default 0,
  add column if not exists costeo_pedido_en    timestamptz,
  add column if not exists costeo_pedido_por   uuid references public.usuarios(id) on delete set null,
  add column if not exists costeo_listo_en     timestamptz,
  add column if not exists costeo_listo_por    uuid references public.usuarios(id) on delete set null,
  add column if not exists revisada_en         timestamptz,
  add column if not exists revisada_por        uuid references public.usuarios(id) on delete set null,
  add column if not exists motivo_observacion  text;

-- Las cotizaciones que ya existen no tenían precio propio: el suyo era el total
-- que salía de las partidas. Se lo damos, para que ninguna cambie de importe al
-- aplicar esto.
update public.cotizaciones set precio_venta = total where precio_venta is null;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cotizaciones'::regclass
                    and conname = 'cotizaciones_precio_venta_positivo') then
    alter table public.cotizaciones
      add constraint cotizaciones_precio_venta_positivo
      check (precio_venta is null or precio_venta >= 0);
  end if;

  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.cotizaciones'::regclass
                    and conname = 'cotizaciones_observacion_no_vacia') then
    alter table public.cotizaciones
      add constraint cotizaciones_observacion_no_vacia
      check (motivo_observacion is null or btrim(motivo_observacion) <> '');
  end if;
end;
$$;

comment on column public.cotizaciones.precio_venta is
  'Lo que Ventas le ofrece al cliente. Manda sobre el papel: el total impreso sale de acá, no de la suma de las partidas.';
comment on column public.cotizaciones.costo_estimado is
  'La suma de las partidas de la cotización de trabajo. Es con lo que se compra, se programa y se mide el margen; no es lo que paga el cliente.';
comment on column public.cotizaciones.motivo_observacion is
  'Por qué Gerencia la devolvió. Lo lee quien tiene que corregirla, así que se escribe para él.';

-- ----------------------------------------- quién hace la cotización de trabajo
-- Administración es un área de la empresa, no el administrador del sistema. Se
-- escribe entero para que nadie confunda el rol ADMIN -que salta todos los
-- permisos por es_admin()- con la gente de Administración, que tiene los suyos
-- y solo esos.
insert into public.roles (codigo, nombre, descripcion)
values ('ADMINISTRACION', 'Administración',
        'Arma la cotización de trabajo y emite la orden de trabajo.')
on conflict (codigo) do nothing;

insert into public.permisos (codigo, modulo, descripcion) values
  ('cotizaciones.costear', 'Comercial',
   'Armar la cotización de trabajo: partidas, ficha técnica y accesorios'),
  ('cotizaciones.revisar', 'Comercial',
   'Dar el visto de Gerencia a una cotización antes de que salga al cliente')
on conflict (codigo) do nothing;

-- Un permiso que no tiene ningún rol es una puerta tapiada: se reparten en la
-- misma migración que los crea.
insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, p.codigo
  from public.roles r
  join (values
    -- Administración: ve la cotización, la costea, y abre la orden de trabajo.
    ('ADMINISTRACION', 'cotizaciones.ver'),
    ('ADMINISTRACION', 'cotizaciones.costear'),
    ('ADMINISTRACION', 'clientes.ver'),
    ('ADMINISTRACION', 'ordenes.ver'),
    ('ADMINISTRACION', 'ordenes.crear'),
    ('ADMINISTRACION', 'ordenes.editar'),
    ('ADMINISTRACION', 'costos.ver'),
    -- Gerencia revisa. Y el costeo también lo puede tocar: cuando devuelve una
    -- cotización con observaciones, muchas veces la corrige ella misma.
    ('GERENTE', 'cotizaciones.revisar'),
    ('GERENTE', 'cotizaciones.costear')
  ) as x(rol, codigo) on x.rol = r.codigo
  join public.permisos p on p.codigo = x.codigo
on conflict do nothing;

-- ----------------------------------------------------------- la aritmética
-- Se reescribe entera y hay que devolverle a mano lo que la migración 033 le
-- puso: `create or replace` no conserva `security definer` ni el search_path, y
-- esta función asigna correlativos llamando a siguiente_correlativo(), que está
-- cerrada a los usuarios a propósito.
create or replace function public.fn_cotizacion_calcular()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_base numeric;
  v_tasa numeric;
  v_igv_incluido numeric;
begin
  if tg_op = 'INSERT' then
    if nullif(btrim(new.numero), '') is null then
      -- La serie puede estar registrada por sede o ser global; se intenta
      -- primero la de la sede del documento y se cae a la global.
      begin
        new.numero := public.siguiente_correlativo('COTIZACION', null, new.sede_id);
      exception when no_data_found then
        new.numero := public.siguiente_correlativo('COTIZACION', null, null);
      end;
    end if;

    if new.vendedor_id is null then
      select c.vendedor_id into new.vendedor_id
        from public.clientes c where c.id = new.cliente_id;
    end if;

    if new.creado_por is null then
      new.creado_por := public.usuario_actual();
    end if;

    if new.tipo_cambio is null then
      new.tipo_cambio := public.tipo_cambio_vigente(new.fecha_emision);
    end if;
  end if;

  -- El IGV se congela al emitir; el 18 final solo actúa si aún no se ha
  -- registrado la fila de empresa (p. ej. durante las pruebas del esquema).
  if new.igv_porcentaje is null then
    new.igv_porcentaje := coalesce(
      (select e.igv_porcentaje from public.empresa e order by e.creado_en limit 1),
      18);
  end if;

  -- El costo estimado SIEMPRE se reconstruye desde las partidas: es la única
  -- fuente de verdad de lo que cuesta hacer el trabajo. Antes esto se guardaba
  -- en `subtotal` y se le cobraba al cliente; ahora sirve para comprar y para
  -- medir el margen, que es para lo que la empresa lo usa.
  new.costo_estimado := coalesce(
    (select sum(p.subtotal) from public.cotizacion_partidas p where p.cotizacion_id = new.id),
    0);

  -- Mientras Ventas no escriba su precio se propone el costo, para que una
  -- cotización recién abierta no muestre un cero que nadie ofreció.
  if new.precio_venta is null then
    new.precio_venta := new.costo_estimado;
  end if;

  new.descuento := coalesce(new.descuento, 0);
  v_tasa := new.igv_porcentaje::numeric;

  if new.incluye_igv then
    -- El precio ofrecido ya trae el IGV dentro: se abre para el papel, sacando
    -- el impuesto de adentro en vez de sumarlo por fuera.
    v_igv_incluido := round(new.precio_venta::numeric * v_tasa / (100 + v_tasa), 2);
    new.subtotal   := round(new.precio_venta::numeric - v_igv_incluido, 2);
  else
    new.subtotal := new.precio_venta::numeric;
  end if;

  if new.descuento::numeric > new.subtotal::numeric then
    raise exception
      'El descuento de la cotización % es mayor que el precio ofrecido. Corrige uno de los dos.',
      new.numero
      using errcode = 'check_violation';
  end if;

  v_base := new.subtotal::numeric - new.descuento::numeric;

  if new.incluye_igv and new.descuento::numeric = 0 then
    -- Sin descuento, el número que se le prometió al cliente se imprime tal
    -- cual: rehacer la cuenta hacia atrás lo movía un céntimo, y ese céntimo lo
    -- ve el cliente en el papel.
    new.igv   := round(new.precio_venta::numeric - new.subtotal::numeric, 2);
    new.total := new.precio_venta;
  else
    new.igv   := round(v_base * v_tasa / 100, 2);
    new.total := round(v_base + new.igv::numeric, 2);
  end if;

  -- Quién y cuándo aprobó queda sellado por la base, no por la aplicación.
  if new.estado = 'APROBADA' then
    new.fecha_aprobacion := coalesce(new.fecha_aprobacion, now());
    new.aprobada_por     := coalesce(new.aprobada_por, public.usuario_actual());
  end if;

  return new;
end;
$$;

comment on function public.fn_cotizacion_calcular is
  'Asigna correlativo, tipo de cambio, vendedor e IGV; recalcula el costo estimado desde las partidas y abre el precio de venta en subtotal, IGV y total.';

revoke all on function public.fn_cotizacion_calcular() from public, anon, authenticated;

-- --------------------------------------------------- el circuito de tres manos
create or replace function public.fn_cotizacion_transicion()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_permitido boolean;
begin
  if old.estado = new.estado then
    return new;
  end if;

  v_permitido := case old.estado
    -- Ventas la escribe y la manda a costear. También puede anularla.
    when 'BORRADOR'    then new.estado in ('EN_COSTEO', 'ANULADA')
    -- Administración arma la cotización de trabajo y la manda a Gerencia; si le
    -- falta información del cliente, se la devuelve a Ventas.
    when 'EN_COSTEO'   then new.estado in ('EN_REVISION', 'BORRADOR', 'ANULADA')
    -- Gerencia da el visto o la devuelve con el motivo.
    when 'EN_REVISION' then new.estado in ('REVISADA', 'OBSERVADA', 'ANULADA')
    -- Devuelta: vuelve a la mano que corresponda según lo observado.
    when 'OBSERVADA'   then new.estado in ('EN_COSTEO', 'BORRADOR', 'ANULADA')
    -- Con el visto puesto, el papel sale al cliente. Gerencia puede arrepentirse
    -- mientras no haya salido.
    when 'REVISADA'    then new.estado in ('ENVIADA', 'OBSERVADA', 'ANULADA')
    -- Ya en manos del cliente: responde, se vence, o el vendedor la corrige y
    -- vuelve a empezar el circuito.
    when 'ENVIADA'     then new.estado in ('BORRADOR', 'APROBADA', 'RECHAZADA', 'VENCIDA', 'ANULADA')
    -- Una cotización vencida se reenvía tal cual o se anula.
    when 'VENCIDA'     then new.estado in ('ENVIADA', 'ANULADA')
    when 'RECHAZADA'   then new.estado in ('ANULADA')
    -- Aprobada solo puede anularse, y solo mientras no exista una OT que la use;
    -- esa validación adicional vive en el módulo de producción.
    when 'APROBADA'    then new.estado in ('ANULADA')
    when 'ANULADA'     then false
  end;

  if not v_permitido then
    raise exception 'Transición de estado no permitida en la cotización %: % → %',
      new.numero, old.estado, new.estado
      using errcode = 'check_violation';
  end if;

  -- El permiso lo exige la base, no la pantalla. La pantalla esconde botones;
  -- quien entra por otra puerta no ve pantallas, y este proyecto ya tuvo once
  -- casos de una acción que decía «listo» sin haber pasado por el permiso.
  if new.estado = 'EN_REVISION' then
    perform public.exigir_permiso('cotizaciones.costear');
  elsif new.estado in ('REVISADA', 'OBSERVADA') then
    perform public.exigir_permiso('cotizaciones.revisar');
  elsif new.estado in ('APROBADA', 'RECHAZADA') then
    perform public.exigir_permiso('cotizaciones.aprobar');
  end if;

  -- Quién y cuándo, sellado por la base en cada paso del circuito.
  if new.estado = 'EN_COSTEO' and old.estado = 'BORRADOR' then
    new.costeo_pedido_en  := now();
    new.costeo_pedido_por := public.usuario_actual();
  elsif new.estado = 'EN_REVISION' then
    new.costeo_listo_en  := now();
    new.costeo_listo_por := public.usuario_actual();
  elsif new.estado = 'REVISADA' then
    new.revisada_en  := now();
    new.revisada_por := public.usuario_actual();
    new.motivo_observacion := null;
  end if;

  -- Devolverla sin decir por qué es mandar a alguien a adivinar.
  if new.estado = 'OBSERVADA' and nullif(btrim(coalesce(new.motivo_observacion, '')), '') is null then
    raise exception
      'Para devolver la cotización % hay que escribir qué es lo que hay que corregir.',
      new.numero
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.fn_cotizacion_transicion is
  'Circuito de la cotización: Ventas la escribe, Administración la costea, Gerencia la revisa. Exige el permiso de cada paso y sella quién lo dio.';

-- --------------------------------------- las partidas, hasta que Gerencia mire
-- Una cotización revisada es la que Gerencia miró: cambiarle las partidas por
-- detrás dejaría el visto puesto sobre otro documento. Para tocarlas hay que
-- devolverla, que es justamente lo que existe ahora.
create or replace function public.fn_partida_bloquear_cerrada()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_cotizacion uuid;
  v_estado     public.estado_cotizacion;
  v_numero     text;
begin
  if tg_op = 'DELETE' then
    v_cotizacion := old.cotizacion_id;
  else
    v_cotizacion := new.cotizacion_id;
  end if;

  select c.estado, c.numero into v_estado, v_numero
    from public.cotizaciones c where c.id = v_cotizacion;

  if v_estado in ('REVISADA', 'ENVIADA', 'APROBADA', 'ANULADA') then
    raise exception
      'La cotización % está en estado % y sus partidas ya no pueden modificarse. Devuélvela a costeo o emite una nueva.',
      v_numero, v_estado
      using errcode = 'restrict_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------------- las rejas
-- Administración escribe la cotización de trabajo: si la política solo acepta
-- `cotizaciones.editar`, su INSERT afecta cero filas, Postgres no da error y la
-- pantalla dice «partida agregada» sin haber agregado nada. Es el fallo mudo de
-- las migraciones 036 y 037; acá se evita antes de que ocurra.
do $$
declare
  t text;
begin
  foreach t in array array[
    'cotizacion_partidas', 'cotizacion_especificaciones', 'cotizacion_accesorios'
  ] loop
    execute format('drop policy if exists %I on public.%I', 'crear_' || t, t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (public.es_admin()
                     or public.tiene_permiso(''cotizaciones.editar'')
                     or public.tiene_permiso(''cotizaciones.costear''))',
      'crear_' || t, t);

    execute format('drop policy if exists %I on public.%I', 'editar_' || t, t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (public.es_admin()
                or public.tiene_permiso(''cotizaciones.editar'')
                or public.tiene_permiso(''cotizaciones.costear''))
         with check (public.es_admin()
                     or public.tiene_permiso(''cotizaciones.editar'')
                     or public.tiene_permiso(''cotizaciones.costear''))',
      'editar_' || t, t);

    execute format('drop policy if exists %I on public.%I', 'borrar_' || t, t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (public.es_admin()
                or public.tiene_permiso(''cotizaciones.editar'')
                or public.tiene_permiso(''cotizaciones.costear''))',
      'borrar_' || t, t);
  end loop;
end;
$$;

-- La cabecera la tocan cuatro manos, cada una en su momento: Ventas mientras es
-- borrador, Administración mientras costea, Gerencia al revisar y al anular.
-- Qué puede cambiar cada una en cada estado lo decide la máquina de estados de
-- arriba; la política solo dice quién tiene derecho a intentarlo.
drop policy if exists editar_cotizaciones on public.cotizaciones;
create policy editar_cotizaciones on public.cotizaciones
  for update to authenticated
  using (
    public.es_admin()
    or public.tiene_permiso('cotizaciones.editar')
    or public.tiene_permiso('cotizaciones.costear')
    or public.tiene_permiso('cotizaciones.revisar')
    or public.tiene_permiso('cotizaciones.aprobar')
    or public.tiene_permiso('cotizaciones.anular'))
  with check (
    public.es_admin()
    or public.tiene_permiso('cotizaciones.editar')
    or public.tiene_permiso('cotizaciones.costear')
    or public.tiene_permiso('cotizaciones.revisar')
    or public.tiene_permiso('cotizaciones.aprobar')
    or public.tiene_permiso('cotizaciones.anular'));
