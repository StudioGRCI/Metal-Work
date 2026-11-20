-- El supervisor pide el material de cada unidad de su área.
--
-- Pedido de supervisión de Acabados (DKS, 20/11/2026): «El ingreso de
-- requerimiento debería ser por unidad, asimismo una vista previa de todas las
-- unidades en mi área, para poder ingresar el requerimiento para cada una de
-- ellas». Hasta hoy el RQ de operación lo registraba solo el área de
-- Requerimientos (`requerimientos.emitir`); el supervisor lo veía, pero tenía
-- que pedírselo a ella unidad por unidad.
--
-- Ahora el supervisor registra el RQ de operación de su propia área, uno por
-- unidad (o PLANTA), con el permiso nuevo `requerimientos.area`. No es el
-- permiso de Requerimientos: con ese pediría para cualquier área. Con el suyo:
--   · registra solo RQ de operación y solo para el área de su cuenta;
--   · corrige y anula solo los que él registró, con las mismas reglas que
--     Requerimientos (anular solo mientras Almacén no los atiende).
-- Almacén lo revisa igual que cualquier otro RQ: el circuito no cambia.
--
-- La regla vive en `rq_exigir_del_area`, que llaman las tres funciones que
-- escriben el RQ. Para quien no tiene `requerimientos.area` es exactamente la
-- regla de antes (`rq_exigir`). Las tres funciones no se copian enteras: se
-- cambia su línea del permiso sobre pg_get_functiondef, que conserva security
-- definer, su search_path y sus permisos. Si no está ni la línea vieja ni la
-- nueva, la función cambió por otro lado y la migración se detiene sin tocar
-- nada.

-- ============================================================ 1. El permiso
insert into public.permisos (codigo, modulo, descripcion) values
  ('requerimientos.area', 'Requerimientos',
   'Registrar el requerimiento de operación de su propia área, por unidad, y corregir o anular los suyos')
on conflict (codigo) do nothing;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'requerimientos.area'
  from public.roles r
 where r.codigo = 'SUPERVISOR'
on conflict do nothing;

-- ===================================================== 2. La regla del área
-- No es security definer: no escribe, y solo la llaman las tres funciones que
-- ya lo son. Nadie más la ejecuta (revoke abajo).
create or replace function public.rq_exigir_del_area(p_tipo text, p_paso text, p_area_id uuid, p_creado_por uuid)
returns void
language plpgsql
stable
set search_path to 'public'
as $$
declare
  v_mia    uuid;
  v_nombre text;
begin
  -- Quien ya lleva el RQ de ese tipo (Requerimientos, la administradora, el
  -- administrador) sigue con su regla de siempre; quien no tiene el permiso del
  -- área, también: `rq_exigir` le dice que no.
  if public.es_admin()
     or p_tipo <> 'OPERACION'
     or p_paso not in ('REGISTRAR', 'CORREGIR', 'ANULAR')
     or public.tiene_permiso('requerimientos.emitir')
     or not public.tiene_permiso('requerimientos.area') then
    perform public.rq_exigir(p_tipo, p_paso);
    return;
  end if;

  select u.area_id, a.nombre into v_mia, v_nombre
    from public.usuarios u
    left join public.areas a on a.id = u.area_id
   where u.id = public.usuario_actual() and u.activo;
  if v_mia is null then
    raise exception 'Tu cuenta no tiene área: sin ella no puedes registrar requerimientos.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_area_id is distinct from v_mia then
    raise exception 'No tienes permiso para % requerimientos de otra área: solo los de %.',
      case p_paso when 'ANULAR' then 'anular' when 'CORREGIR' then 'corregir' else 'registrar' end, v_nombre
      using errcode = 'insufficient_privilege';
  end if;
  if p_paso in ('CORREGIR', 'ANULAR') and p_creado_por is distinct from public.usuario_actual() then
    raise exception 'No tienes permiso para % un requerimiento que registró otra persona.',
      case p_paso when 'ANULAR' then 'anular' else 'corregir' end
      using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke all on function public.rq_exigir_del_area(text, text, uuid, uuid) from public, anon, authenticated;

comment on function public.rq_exigir_del_area(text, text, uuid, uuid) is
  'El permiso para registrar, corregir o anular un RQ: con `requerimientos.area` (el supervisor), solo de operación, solo de su área y, al corregir o anular, solo los suyos; para los demás, `rq_exigir`. La llaman emitir_requerimiento, corregir_requerimiento y anular_requerimiento.';

-- ====================================== 3. Las tres funciones que escriben el RQ
do $$
declare
  v_def   text;
  v_cambio record;
begin
  for v_cambio in
    select * from (values
      ('public.emitir_requerimiento(uuid, text, uuid, text, text, date, jsonb)',
       $v$perform public.rq_exigir(p_tipo, 'REGISTRAR');$v$,
       $v$perform public.rq_exigir_del_area(p_tipo, 'REGISTRAR', p_area_id, null);$v$),
      ('public.corregir_requerimiento(uuid, uuid, text, text, text, jsonb)',
       $v$perform public.rq_exigir(v_rq.tipo, 'CORREGIR');$v$,
       $v$perform public.rq_exigir_del_area(v_rq.tipo, 'CORREGIR', v_rq.area_id, v_rq.creado_por);$v$),
      ('public.anular_requerimiento(uuid, text)',
       $v$perform public.rq_exigir(v_rq.tipo, 'ANULAR');$v$,
       $v$perform public.rq_exigir_del_area(v_rq.tipo, 'ANULAR', v_rq.area_id, v_rq.creado_por);$v$),
      -- La puerta de entrada de anular, antes de leer el RQ.
      ('public.anular_requerimiento(uuid, text)',
       $v$if not (public.es_admin() or public.tiene_permiso('requerimientos.emitir') or public.tiene_permiso('requerimientos.administracion')) then$v$,
       $v$if not (public.es_admin() or public.tiene_permiso('requerimientos.emitir') or public.tiene_permiso('requerimientos.administracion') or public.tiene_permiso('requerimientos.area')) then$v$)
    ) as x(funcion, viejo, nuevo)
  loop
    v_def := replace(pg_get_functiondef(v_cambio.funcion::regprocedure), E'\r', '');
    if position(v_cambio.nuevo in v_def) > 0 then
      continue;
    end if;
    if position(v_cambio.viejo in v_def) = 0 then
      raise exception '% cambió: no tiene «%» como la conoce el repositorio. Revisarla a mano antes de seguir.',
        v_cambio.funcion, v_cambio.viejo;
    end if;
    execute replace(v_def, v_cambio.viejo, v_cambio.nuevo);
  end loop;
end $$;

-- ================================== 4. El justificante de la corrección del supervisor
-- Corregir un RQ pide su justificante, que el navegador sube primero al bucket
-- `justificantes-correccion`. La política de subida aceptaba solo a quien
-- registraba RQ hasta hoy: sin `requerimientos.area`, el supervisor tendría el
-- botón «Corregir» en sus RQ y la subida le diría que no.
drop policy if exists justificantes_subir on storage.objects;
create policy justificantes_subir on storage.objects for insert to authenticated with check (
  bucket_id = 'justificantes-correccion' and owner_id = (select auth.uid())::text
  and ((select public.es_admin()) or (select public.tiene_permiso('requerimientos.emitir'))
       or (select public.tiene_permiso('requerimientos.administracion')) or (select public.tiene_permiso('requerimientos.area'))
       or (select public.tiene_permiso('compras.crear')) or (select public.tiene_permiso('adquisiciones.registrar'))));

-- ================================== 5. Un solo aviso al supervisor que lo pidió
-- Cuando el supervisor registra el RQ, es a la vez quien lo pidió (EMISOR) y el
-- del área (AREA): «Listo en almacén», «Ya no está listo» y «Por comprar otra
-- vez» le llegaban dos veces. Todo aviso al AREA va con uno al EMISOR, así que
-- el del área se salta a quien registró el RQ.
do $$
declare
  v_def   text;
  v_viejo text := $v$when 'AREA'      then u.area_id = p_rq.area_id and exists$v$;
  v_nuevo text := $v$when 'AREA'      then u.area_id = p_rq.area_id and u.id is distinct from p_rq.creado_por and exists$v$;
begin
  v_def := replace(pg_get_functiondef('public.fn_rq_avisar(public.requerimientos, text, text, text)'::regprocedure), E'\r', '');
  if position(v_nuevo in v_def) > 0 then
    return;
  end if;
  if position(v_viejo in v_def) = 0 then
    raise exception 'public.fn_rq_avisar cambió: no tiene «%» como la conoce el repositorio. Revisarla a mano antes de seguir.', v_viejo;
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $$;
