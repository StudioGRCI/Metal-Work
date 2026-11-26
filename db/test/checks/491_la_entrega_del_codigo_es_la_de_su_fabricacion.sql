-- «Se entregó el…» del código interno (cierre del costeo y Por decidir) es el
-- acta de la OT que fabricó la unidad, no la de una garantía o un mantenimiento
-- que volvió a la misma unidad después (migración 20261126980000). Lo mira
-- Gerencia, con su cuenta y `set local role authenticated`. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA91', 'Taller prueba de entregas') on conflict (codigo) do nothing;
select test.crear_usuario('Gina', 'Gerente', 'gerencia491@demo.pe', 'GERENTE', (select id from public.sedes where codigo = 'QA91')) as gerente_id \gset
select set_config('prueba.gerente', :'gerente_id', false);

-- El armazón se escribe directo, sin los disparadores del circuito de la OT: lo
-- que se prueba es de dónde sale la fecha, no cómo se llega a entregar.
set local session_replication_role = replica;
do $$
declare
  v_sede uuid := (select id from public.sedes where codigo = 'QA91');
  v_unidad uuid := gen_random_uuid();
  v_fab uuid := gen_random_uuid();
  v_gar uuid := gen_random_uuid();
  v_man uuid := gen_random_uuid();
begin
  insert into public.unidades (id, codigo_interno, placa) values (v_unidad, 'CHK491_A_26/01', 'CHK-491');
  insert into public.ordenes_trabajo (id, numero, sede_id, unidad_id, descripcion, tipo_trabajo, estado, abierta_en_taller)
  values (v_fab, '9491-2026', v_sede, v_unidad, 'Fabricación de prueba', 'FABRICACION', 'ENTREGADA', true),
         (v_gar, '9492-2026', v_sede, v_unidad, 'Garantía de prueba', 'GARANTIA', 'ENTREGADA', true),
         (v_man, '9493-2026', v_sede, v_unidad, 'Mantenimiento de prueba', 'MANTENIMIENTO', 'ENTREGADA', true);
  insert into public.ot_entregas (orden_id, numero, recibe_nombre, fecha_entrega)
  values (v_fab, 'AE-9491', 'Cliente de prueba', date '2026-03-10'),
         (v_gar, 'AE-9492', 'Cliente de prueba', date '2026-08-20'),
         (v_man, 'AE-9493', 'Cliente de prueba', date '2026-10-05');
  -- Un cierre hace que el código salga en el costo aunque no tenga líneas.
  insert into public.codigo_interno_cierres (codigo, costo_pen, por_fuente, cerrado_por)
  values ('CHK491_A_26/01', 0, '{}'::jsonb, current_setting('prueba.gerente')::uuid);
end $$;
set local session_replication_role = origin;

do $$
declare
  v_fecha date;
  v_filas int;
begin
  perform test.como_usuario(current_setting('prueba.gerente')::uuid);
  set local role authenticated;
  select count(*), max(k.entregada_el) into v_filas, v_fecha
    from public.codigos_internos_costo('CHK491_A_26/01') k;
  reset role;
  perform test.afirmar(v_filas = 1, 'Gerencia ve el código de la prueba en el costo');
  perform test.afirmar(v_fecha = date '2026-03-10',
    format('la entrega del código es la de su fabricación (10/03), no la de su garantía ni su mantenimiento: salió %s', v_fecha));
end $$;

rollback;
