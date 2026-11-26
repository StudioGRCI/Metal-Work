-- Administración pausa y reanuda la OT (migración 20261126337000; DKS,
-- 2026-11-26).
--
--   1. `ordenes.pausar` existe y lo tiene Administración.
--   2. Con ese permiso, Administración pausa una OT en proceso con su motivo y
--      la reanuda: el UPDATE afecta una fila (la política lo acepta) y el estado
--      cambia de verdad.
--   3. Pausar sin motivo no entra.
--   4. No abre los demás pasos: Administración no termina, no devuelve a
--      taller ni reabre una OT. (Iniciar la aprobada lo frena antes el plan de
--      etapas; la regla del permiso es la misma.)
--   5. Gerencia, que pasa la política de UPDATE por `ordenes.anular`, no pausa:
--      la base la rechaza por el permiso.
--
-- Cada escritura con la cuenta del puesto —nunca ADMIN— y `set local role
-- authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA479', 'Taller prueba de la pausa') on conflict (codigo) do nothing;

do $$
declare v text; v_id uuid;
begin
  foreach v in array array['ADMINISTRACION:adm', 'GERENTE:ger'] loop
    v_id := test.crear_usuario('Nombre' || split_part(v, ':', 2), 'Apellido479', split_part(v, ':', 2) || '.479@prueba.local',
                               split_part(v, ':', 1), (select id from public.sedes where codigo = 'QA479'));
    perform set_config('prueba.' || split_part(v, ':', 2), v_id::text, true);
  end loop;
end $$;

-- Las OT de prueba, sembradas como estaban: una en proceso, una en control de calidad y una terminada.
set local session_replication_role = replica;
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20999479011', 'CLIENTE DE PRUEBA 479 S.A.C.');
insert into public.ordenes_trabajo (numero, cliente_id, sede_id, descripcion, estado, fecha_inicio_real)
select x.numero, c.id, (select id from public.sedes where codigo = 'QA479'), 'Check 479 · ' || x.numero,
       x.estado::public.estado_ot, current_date - 3
  from public.clientes c,
       (values ('QA479-PROC', 'EN_PROCESO'), ('QA479-CAL', 'CONTROL_CALIDAD'), ('QA479-TERM', 'TERMINADA')) x(numero, estado)
 where c.numero_documento = '20999479011';
set local session_replication_role = origin;

create or replace function pg_temp.como(p_clave text) returns void language sql as $$
  select test.como_usuario(current_setting('prueba.' || p_clave)::uuid);
$$;
create or replace function pg_temp.estado(p_numero text) returns text language sql as $$
  select estado::text from public.ordenes_trabajo where numero = p_numero;
$$;

-- 1. El permiso y quién lo tiene.
select test.afirmar(
  (select string_agg(r.codigo, ' ' order by r.codigo) from public.roles_permisos rp join public.roles r on r.id = rp.rol_id
    where rp.permiso_codigo = 'ordenes.pausar') = 'ADMINISTRACION',
  'ordenes.pausar lo tiene Administración, y nadie más');

-- 2. Administración pausa con motivo y reanuda.
select pg_temp.como('adm');
set local role authenticated;
select test.afirmar(public.tiene_permiso('ordenes.pausar') and not public.tiene_permiso('ordenes.cambiar_estado'),
  'Administración tiene ordenes.pausar y no ordenes.cambiar_estado');
do $$
declare v integer;
begin
  update public.ordenes_trabajo set estado = 'PAUSADA', motivo_pausa = 'El cliente no envió el chasis (prueba 479)'
   where numero = 'QA479-PROC';
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Administración pausa la OT en proceso: una fila, no cero');
end $$;
select test.afirmar(pg_temp.estado('QA479-PROC') = 'PAUSADA', 'la OT quedó pausada');
do $$
declare v integer;
begin
  update public.ordenes_trabajo set estado = 'EN_PROCESO' where numero = 'QA479-PROC';
  get diagnostics v = row_count;
  perform test.afirmar(v = 1, 'Administración reanuda la OT pausada: una fila, no cero');
end $$;
select test.afirmar(pg_temp.estado('QA479-PROC') = 'EN_PROCESO', 'la OT volvió a estar en proceso');

-- 3. Sin motivo no se pausa.
select test.debe_fallar(
  $q$update public.ordenes_trabajo set estado = 'PAUSADA', motivo_pausa = '  ' where numero = 'QA479-PROC'$q$,
  'pausar sin motivo no entra', 'ck_ot_motivo_pausa');

-- 4. Los demás pasos siguen con ordenes.cambiar_estado.
select test.debe_fallar(
  $q$update public.ordenes_trabajo set estado = 'TERMINADA' where numero = 'QA479-PROC'$q$,
  'Administración no termina la OT', 'ordenes.cambiar_estado');
select test.debe_fallar(
  $q$update public.ordenes_trabajo set estado = 'EN_PROCESO' where numero = 'QA479-CAL'$q$,
  'Administración no devuelve a taller la OT en control de calidad', 'ordenes.cambiar_estado');
select test.debe_fallar(
  $q$update public.ordenes_trabajo set estado = 'EN_PROCESO' where numero = 'QA479-TERM'$q$,
  'Administración no reabre la OT terminada', 'ordenes.cambiar_estado');
reset role;
select test.afirmar(pg_temp.estado('QA479-CAL') = 'CONTROL_CALIDAD' and pg_temp.estado('QA479-TERM') = 'TERMINADA',
  'la de control de calidad y la terminada siguen como estaban');

-- 5. Gerencia pasa la política (ordenes.anular) pero no pausa.
select pg_temp.como('ger');
set local role authenticated;
select test.debe_fallar(
  $q$update public.ordenes_trabajo set estado = 'PAUSADA', motivo_pausa = 'Prueba 479' where numero = 'QA479-PROC'$q$,
  'Gerencia no pausa la OT', 'ordenes.cambiar_estado');
reset role;
select test.afirmar(pg_temp.estado('QA479-PROC') = 'EN_PROCESO', 'la OT sigue en proceso tras el intento de Gerencia');

-- La función del disparador no se llama a mano.
select test.afirmar(not has_function_privilege('authenticated', 'public.fn_ot_permiso_por_estado()', 'execute'),
  'fn_ot_permiso_por_estado no la ejecuta authenticated');

rollback;
