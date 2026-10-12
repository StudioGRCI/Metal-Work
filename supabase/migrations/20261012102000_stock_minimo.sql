-- =============================================================================
-- EL STOCK MÍNIMO
-- -----------------------------------------------------------------------------
-- El procedimiento de Almacén pide avisar cuando un material baja de su mínimo,
-- pero ningún archivo de la empresa define ese mínimo, y el kardex en Excel no
-- avisa de nada: la soldadura o los discos de corte se acaban un viernes y el
-- taller se entera por WhatsApp.
--
-- Desde aquí cada material puede llevar su stock mínimo, que fija Almacén. El
-- kardex marca los que están por debajo y, cuando una salida o un conteo deja un
-- material bajo su mínimo, el sistema avisa una sola vez a Almacén y a Logística
-- (no en cada salida siguiente: el aviso es al cruzar la línea).
--
-- Un material sin mínimo no avisa nunca. La empresa los irá fijando; no se
-- inventa ninguno.
-- =============================================================================

alter table public.materiales add column if not exists stock_minimo numeric(14, 3);
do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.materiales'::regclass
                   and conname = 'ck_materiales_stock_minimo') then
    alter table public.materiales add constraint ck_materiales_stock_minimo
      check (stock_minimo is null or stock_minimo >= 0);
  end if;
end $$;
comment on column public.materiales.stock_minimo is
  'Cantidad por debajo de la cual Almacén y Logística reciben aviso. Vacío: el material no avisa. Lo fija Almacén.';

-- La tabla de materiales la corrige Diseño (`diseno.planos`); el mínimo lo pone
-- Almacén, que no tiene ese permiso. Va por función, con el permiso de Almacén,
-- en vez de abrirle a Almacén la edición del catálogo entero.
create or replace function public.fijar_stock_minimo(p_material uuid, p_minimo numeric)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  perform public.exigir_permiso('almacen.recibir');
  if p_minimo is not null and (p_minimo < 0 or p_minimo > 99999999999 or p_minimo <> round(p_minimo, 3)) then
    raise exception 'El stock mínimo es una cantidad de 0 en adelante, con hasta tres decimales.' using errcode = 'check_violation';
  end if;
  update public.materiales set stock_minimo = p_minimo
   where id = p_material and activo
  returning id into v_id;
  if v_id is null then
    raise exception 'El material no existe o está dado de baja.';
  end if;
  return v_id;
end;
$$;
revoke all on function public.fijar_stock_minimo(uuid, numeric) from public, anon;
grant execute on function public.fijar_stock_minimo(uuid, numeric) to authenticated;

-- El saldo sin exigir permiso: lo usa el aviso, que corre dentro de la salida de
-- quien sea. Es el mismo cálculo que `saldo_registrado_material`.
create or replace function public.saldo_material_interno(p_material uuid)
returns numeric language sql stable security definer set search_path to 'public' as $$
  select coalesce((select sum(case when mov.tipo = 'INGRESO' then mov.cantidad else -mov.cantidad end)
                     from public.movimientos_materiales mov
                     left join public.requerimiento_material_detalles d on d.id = mov.requerimiento_detalle_id
                     left join public.ot_materiales om on om.id = d.ot_material_id
                    where coalesce(mov.material_id, om.material_id) = p_material), 0)
       + coalesce((select sum(c.ajuste) from public.conteos_inventario c where c.material_id = p_material), 0);
$$;
revoke all on function public.saldo_material_interno(uuid) from public, anon, authenticated;

create or replace function public.fn_avisar_stock_minimo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_material uuid;
  v_baja     numeric;
  v_saldo    numeric;
  v_mat      public.materiales%rowtype;
  v_titulo   text;
  v_cuerpo   text;
begin
  if tg_table_name = 'conteos_inventario' then
    v_material := new.material_id;
    v_baja := -new.ajuste;
  else
    if new.tipo not in ('DESPACHO', 'SALIDA') then
      return null;
    end if;
    v_material := coalesce(new.material_id, (
      select om.material_id from public.requerimiento_material_detalles d
        join public.ot_materiales om on om.id = d.ot_material_id
       where d.id = new.requerimiento_detalle_id));
    v_baja := new.cantidad;
  end if;
  if v_material is null or v_baja <= 0 then
    return null;
  end if;
  select * into v_mat from public.materiales where id = v_material;
  if v_mat.stock_minimo is null then
    return null;
  end if;
  v_saldo := public.saldo_material_interno(v_material);
  -- Solo al cruzar la línea: antes de este movimiento estaba en el mínimo o
  -- por encima, y ahora quedó por debajo.
  if v_saldo >= v_mat.stock_minimo or v_saldo + v_baja < v_mat.stock_minimo then
    return null;
  end if;
  v_titulo := 'Stock bajo: ' || v_mat.codigo;
  -- 12.500 se lee 12.5 y 3.000 se lee 3: sin ceros que no dicen nada.
  v_cuerpo := v_mat.descripcion || '. Quedan '
              || rtrim(rtrim(to_char(v_saldo, 'FM99999999990.000'), '0'), '.')
              || '; el mínimo es '
              || rtrim(rtrim(to_char(v_mat.stock_minimo, 'FM99999999990.000'), '0'), '.') || '.';
  -- Un solo aviso por persona aunque tenga los dos permisos, y con un enlace que
  -- pueda abrir: Logística no entra al kardex (`almacen.ver`), así que el suyo
  -- lleva a Compras, donde hace el pedido.
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id)
  select u.id, v_titulo, v_cuerpo,
         case when r.codigo = 'ADMIN' or exists (
                     select 1 from public.roles_permisos rp
                      where rp.rol_id = r.id and rp.permiso_codigo = 'almacen.ver')
              then '/almacen/kardex?material=' || v_material
              else '/compras' end,
         'materiales', v_material
    from public.usuarios u
    join public.roles r on r.id = u.rol_id
   where u.activo
     and (r.codigo = 'ADMIN' or exists (
            select 1 from public.roles_permisos rp
             where rp.rol_id = r.id and rp.permiso_codigo in ('almacen.recibir', 'compras.crear')));
  return null;
end;
$$;
revoke all on function public.fn_avisar_stock_minimo() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_avisar_stock_minimo'
                   and tgrelid = 'public.movimientos_materiales'::regclass) then
    create trigger trg_avisar_stock_minimo after insert on public.movimientos_materiales
      for each row execute function public.fn_avisar_stock_minimo();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_avisar_stock_minimo'
                   and tgrelid = 'public.conteos_inventario'::regclass) then
    create trigger trg_avisar_stock_minimo after insert on public.conteos_inventario
      for each row execute function public.fn_avisar_stock_minimo();
  end if;
end $$;
