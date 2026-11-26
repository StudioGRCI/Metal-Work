-- El recorrido del reporte diario (migración 20261126331000; Plan 1, entrega 1.1).
--
--   1. Dice, en orden, quién hizo cada paso y cuándo: lo subió Supervisión, el
--      visto de Recursos Humanos, el de Gerencia, la observación y su
--      corrección, la anulación; y quién lo tiene ahora y hace cuántos días.
--   2. Lo lee quien ve el reporte y nadie más: devuelve exactamente los que la
--      política `ver_reportes_diarios` deja ver a cada puesto. El supervisor de
--      Acabados no ve el reporte de Maestranza; Ventas no entra.
--   3. Solo el puesto de quien hizo cada paso, nunca su nombre.
--   4. Cuando Gerencia observa el reporte, al supervisor que lo subió le llega
--      el aviso por la campana, y lo lee con su cuenta.
--
-- Cada lectura con la cuenta del puesto —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA473', 'Taller prueba del reporte') on conflict (codigo) do nothing;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['SUPERVISOR:MTZ:sup_mtz', 'SUPERVISOR:ACB:sup_acb', 'RECURSOS_HUMANOS:RRH:rrhh',
                           'GERENTE_PRODUCCION:GOP:gpr', 'GERENTE:GGE:gge', 'VENDEDOR:GCO:ven'] loop
    v_id := test.crear_usuario('Nombre' || split_part(v, ':', 3), 'Apellido473', split_part(v, ':', 3) || '.473@prueba.local',
                               split_part(v, ':', 1), (select id from public.sedes where codigo = 'QA473'));
    perform set_config('prueba.area_' || split_part(v, ':', 3), split_part(v, ':', 2), true);
    perform set_config('prueba.' || split_part(v, ':', 3), v_id::text, true);
  end loop;
  foreach v in array array['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'racb'] loop
    perform set_config('prueba.' || v, gen_random_uuid()::text, true);
  end loop;
end $$;

-- El área de cada cuenta, sin el disparador que solo deja cambiarla a Administración.
set local session_replication_role = replica;
update public.usuarios u set area_id = a.id
  from public.areas a
 where u.correo like '%.473@prueba.local'
   and a.codigo = current_setting('prueba.area_' || split_part(u.correo, '.473@', 1));
set local session_replication_role = origin;

create or replace function pg_temp.id(p_clave text) returns uuid language sql as $$
  select current_setting('prueba.' || p_clave)::uuid;
$$;
create or replace function pg_temp.como(p_clave text) returns void language sql as $$
  select test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
$$;
-- El recorrido de un reporte en una línea: «ENVIO:HECHO > VALIDACION:AHORA».
create or replace function pg_temp.camino(p_rep text) returns text language sql as $$
  select string_agg(paso || ':' || situacion, ' > ' order by orden)
    from public.recorrido_de_reportes_diarios(array[current_setting('prueba.' || p_rep)::uuid]);
$$;
create or replace function pg_temp.paso(p_rep text, p_paso text, p_situacion text)
returns table (puesto text, en timestamptz, dias integer, espera text, detalle text) language sql as $$
  select r.puesto, r.en, r.dias, r.espera, r.detalle
    from public.recorrido_de_reportes_diarios(array[current_setting('prueba.' || p_rep)::uuid]) r
   where r.paso = p_paso and r.situacion = p_situacion;
$$;

-- Los reportes, sin pasar por sus disparadores: cada uno en un punto del circuito.
set local session_replication_role = replica;
insert into public.reportes_diarios (id, fecha, codigo_interno, asunto, descripcion, area_id, registrado_por, creado_en,
                                     visto_rrhh_por, visto_rrhh_en, visto_gerencia_por, visto_gerencia_en,
                                     observado_por, observado_en, observacion_area, observacion,
                                     anulado_por, anulado_en, motivo_anulacion, reemplaza_a)
select x.id, (x.creado_en at time zone 'America/Lima')::date, 'CHK473', x.asunto, 'Armado del cajón de prueba',
       (select area_id from public.usuarios where id = x.autor), x.autor, x.creado_en,
       x.vrrhh, case when x.vrrhh is not null then x.creado_en + interval '2 hours' end,
       x.vger, case when x.vger is not null then x.creado_en + interval '3 hours' end,
       x.obs, case when x.obs is not null then x.creado_en + interval '4 hours' end,
       case when x.obs is not null then 'GERENCIA' end, case when x.obs is not null then 'Falta la foto del cajón armado.' end,
       x.anu, case when x.anu is not null then x.creado_en + interval '5 hours' end,
       case when x.anu is not null then 'Se subió dos veces el mismo código.' end, x.reemplaza
  from (values
    -- r1: recién subido hace tres días, sin vistos
    (pg_temp.id('r1'), pg_temp.id('sup_mtz'), now() - interval '3 days', 'Recién subido', null::uuid, null::uuid, null::uuid, null::uuid, null::uuid),
    -- r2: con el visto de RR. HH.; falta Gerencia
    (pg_temp.id('r2'), pg_temp.id('sup_mtz'), now() - interval '2 days', 'Falta Gerencia', pg_temp.id('rrhh'), null, null, null, null),
    -- r3: validado por las dos
    (pg_temp.id('r3'), pg_temp.id('sup_mtz'), now() - interval '4 days', 'Validado', pg_temp.id('rrhh'), pg_temp.id('gpr'), null, null, null),
    -- r4: observado por Gerencia y ya corregido con r5
    (pg_temp.id('r4'), pg_temp.id('sup_mtz'), now() - interval '5 days', 'Observado y corregido', pg_temp.id('rrhh'), null, pg_temp.id('gpr'), pg_temp.id('sup_mtz'), null),
    (pg_temp.id('r5'), pg_temp.id('sup_mtz'), now() - interval '1 day', 'La corrección', null, null, null, null, pg_temp.id('r4')),
    -- r6: anulado a mano por quien lo subió
    (pg_temp.id('r6'), pg_temp.id('sup_mtz'), now() - interval '6 days', 'Anulado', null, null, null, pg_temp.id('sup_mtz'), null),
    -- r7: Gerencia dio su visto primero; falta RR. HH.
    (pg_temp.id('r7'), pg_temp.id('sup_mtz'), now() - interval '2 days', 'Falta RR. HH.', null, pg_temp.id('gpr'), null, null, null),
    -- racb: el de Acabados
    (pg_temp.id('racb'), pg_temp.id('sup_acb'), now() - interval '1 day', 'De Acabados', null, null, null, null, null)
  ) as x(id, autor, creado_en, asunto, vrrhh, vger, obs, anu, reemplaza);
-- El observado que se corrige queda anulado con la observación como motivo, como hace `registrar_reporte_corregido`.
update public.reportes_diarios set anulado_por = pg_temp.id('sup_mtz'), anulado_en = now() - interval '1 day',
       motivo_anulacion = 'Observado por Gerencia: Falta la foto del cajón armado.'
 where id = pg_temp.id('r4');
set local session_replication_role = origin;

-- 1. Los pasos, con la cuenta del supervisor que los subió ----------------------
select pg_temp.como('sup_mtz');
set local role authenticated;

select test.afirmar(pg_temp.camino('r1') = 'ENVIO:HECHO > VALIDACION:AHORA',
  'recién subido, lo tienen Gerencia y RR. HH.: ' || coalesce(pg_temp.camino('r1'), '(nada)'));
select test.afirmar((select puesto = 'Gerencia y Recursos Humanos' and dias = 3 and espera = 'VALIDACION' from pg_temp.paso('r1', 'VALIDACION', 'AHORA')),
  'lo tienen las dos áreas hace 3 días, contados por fecha de Lima');
select test.afirmar((select puesto from pg_temp.paso('r1', 'ENVIO', 'HECHO'))
                    = (select coalesce(nullif(btrim(u.cargo), ''), r.nombre) from public.usuarios u join public.roles r on r.id = u.rol_id where u.id = pg_temp.id('sup_mtz')),
  'el envío lo hizo el puesto de quien lo subió');

select test.afirmar(pg_temp.camino('r2') = 'ENVIO:HECHO > VISTO_RRHH:HECHO > VISTO_GERENCIA:AHORA',
  'con el visto de RR. HH., lo tiene Gerencia: ' || coalesce(pg_temp.camino('r2'), '(nada)'));
select test.afirmar((select puesto = 'Gerencia' and dias = 2 from pg_temp.paso('r2', 'VISTO_GERENCIA', 'AHORA')),
  'Gerencia lo tiene desde que se subió');

select test.afirmar(pg_temp.camino('r7') = 'ENVIO:HECHO > VISTO_GERENCIA:HECHO > VISTO_RRHH:AHORA',
  'con el visto de Gerencia, lo tiene RR. HH.: ' || coalesce(pg_temp.camino('r7'), '(nada)'));
select test.afirmar((select puesto = 'Recursos Humanos' and dias = 2 from pg_temp.paso('r7', 'VISTO_RRHH', 'AHORA')),
  'RR. HH. lo tiene desde que se subió');

select test.afirmar(pg_temp.camino('r3') = 'ENVIO:HECHO > VISTO_RRHH:HECHO > VISTO_GERENCIA:HECHO > VALIDACION:HECHO',
  'validado por las dos, ya no lo tiene nadie: ' || coalesce(pg_temp.camino('r3'), '(nada)'));
select test.afirmar((select puesto from pg_temp.paso('r3', 'VALIDACION', 'HECHO')) = 'Gerencia de Producción'
                    and (select en from pg_temp.paso('r3', 'VALIDACION', 'HECHO')) = (select en from pg_temp.paso('r3', 'VISTO_GERENCIA', 'HECHO')),
  'lo valida el último visto, a su hora');
select test.afirmar((select puesto from pg_temp.paso('r3', 'VISTO_GERENCIA', 'HECHO')) = 'Gerencia de Producción',
  'el visto de Gerencia dice qué Gerencia lo dio');

select test.afirmar(pg_temp.camino('r4') = 'ENVIO:HECHO > VISTO_RRHH:HECHO > OBSERVACION:HECHO > CORRECCION:HECHO',
  'observado y corregido: la anulación automática no se repite como paso: ' || coalesce(pg_temp.camino('r4'), '(nada)'));
select test.afirmar((select detalle from pg_temp.paso('r4', 'OBSERVACION', 'HECHO')) = 'GERENCIA',
  'la observación dice qué área observó');
select test.afirmar((select detalle from pg_temp.paso('r5', 'ENVIO', 'HECHO')) = 'CORRIGE'
                    and pg_temp.camino('r5') = 'ENVIO:HECHO > VALIDACION:AHORA',
  'la corrección empieza su propio recorrido y dice que corrige a otro');

select test.afirmar(pg_temp.camino('r6') = 'ENVIO:HECHO > ANULACION:HECHO',
  'anulado a mano, no espera a nadie: ' || coalesce(pg_temp.camino('r6'), '(nada)'));

-- 2. Lo que la política deja ver, ni uno más ------------------------------------
select test.afirmar(pg_temp.camino('racb') is null, 'el supervisor de Maestranza no ve el recorrido del reporte de Acabados');
reset role;

do $$
declare v_clave text; v_funcion text[]; v_politica text[];
begin
  foreach v_clave in array array['sup_mtz', 'sup_acb', 'rrhh', 'gpr', 'gge'] loop
    perform pg_temp.como(v_clave);
    set local role authenticated;
    select array_agg(distinct r.documento::text order by r.documento::text) into v_funcion
      from public.recorrido_de_reportes_diarios(array[pg_temp.id('r1'), pg_temp.id('r2'), pg_temp.id('r3'), pg_temp.id('r4'),
                                                      pg_temp.id('r5'), pg_temp.id('r6'), pg_temp.id('racb')]) r;
    select array_agg(d.id::text order by d.id::text) into v_politica
      from public.reportes_diarios d
     where d.id in (pg_temp.id('r1'), pg_temp.id('r2'), pg_temp.id('r3'), pg_temp.id('r4'), pg_temp.id('r5'), pg_temp.id('r6'), pg_temp.id('racb'));
    reset role;
    perform test.afirmar(v_funcion is not distinct from v_politica,
      format('%s: la función da los mismos reportes que la política (%s contra %s)', v_clave,
             coalesce(cardinality(v_funcion), 0), coalesce(cardinality(v_politica), 0)));
  end loop;
end $$;

select pg_temp.como('sup_acb');
set local role authenticated;
select test.afirmar(pg_temp.camino('racb') = 'ENVIO:HECHO > VALIDACION:AHORA', 'el de Acabados ve el suyo');
reset role;

select pg_temp.como('ven');
set local role authenticated;
select test.debe_fallar($q$select * from public.recorrido_de_reportes_diarios(array[gen_random_uuid()])$q$,
  'Ventas, que no ve reportes diarios, no lee su recorrido');
reset role;

-- 3. Solo el puesto, nunca el nombre --------------------------------------------
select pg_temp.como('gpr');
set local role authenticated;
select test.afirmar(not exists (
    select 1 from public.recorrido_de_reportes_diarios(array[pg_temp.id('r1'), pg_temp.id('r2'), pg_temp.id('r3'), pg_temp.id('r4'),
                                                             pg_temp.id('r5'), pg_temp.id('r6'), pg_temp.id('racb')]) r
     where coalesce(r.puesto, '') ilike '%Apellido473%' or coalesce(r.puesto, '') ilike '%Nombre%'
        or coalesce(r.detalle, '') ilike '%Apellido473%' or coalesce(r.detalle, '') ilike '%foto del cajón%'),
  'ningún paso nombra a la persona ni copia el texto de la observación');
reset role;

-- 4. El aviso por la campana cuando Gerencia observa ------------------------------
select pg_temp.como('gpr');
set local role authenticated;
select public.observar_reporte_diario(pg_temp.id('r1'), 'GERENCIA', 'Revisa el avance del cajón: no cuadra con las fotos.');
reset role;

select pg_temp.como('sup_mtz');
set local role authenticated;
select test.afirmar((select count(*) from public.notificaciones n
                      where n.usuario_id = pg_temp.id('sup_mtz') and n.origen_id = pg_temp.id('r1')
                        and n.ruta = '/reportes-diarios/' || pg_temp.id('r1')
                        and n.titulo like 'Reporte observado por Gerencia:%') = 1,
  'al supervisor le llega por la campana el aviso de que Gerencia observó su reporte, y lo lee con su cuenta');
select test.afirmar(pg_temp.camino('r1') = 'ENVIO:HECHO > OBSERVACION:HECHO > CORRECCION:AHORA > VALIDACION:PENDIENTE',
  'observado, lo tiene quien lo subió para corregirlo: ' || coalesce(pg_temp.camino('r1'), '(nada)'));
select test.afirmar((select puesto is not null and dias = 0 and espera = 'CORRECCION' from pg_temp.paso('r1', 'CORRECCION', 'AHORA')),
  'la corrección espera desde hoy');
reset role;

select pg_temp.como('sup_acb');
set local role authenticated;
select test.afirmar((select count(*) from public.notificaciones n where n.origen_id = pg_temp.id('r1')) = 0,
  'el aviso no le llega al supervisor de otra área');
reset role;

rollback;
