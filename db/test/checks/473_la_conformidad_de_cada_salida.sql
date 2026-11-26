-- La conformidad de cada salida (plan 2, entrega 2.2): quien pidió el RQ anota
-- «no llegó» o «llegó incompleto», Almacén la cierra, y nadie más escribe.
-- Todo con el rol real (`set local role authenticated`), nunca como ADMIN.
begin;

-- Armazón: un RQ de Maestranza registrado por Requerimientos, con una salida de
-- 4 UND contra su insumo. Se monta como dueño de las tablas, sin sesión.
do $$
declare
  v_req  uuid := test.crear_usuario('Rita', 'Requerimientos', 'req.conf473@demo.pe', 'REQUERIMIENTOS');
  v_sup  uuid := test.crear_usuario('Saúl', 'Maestranza', 'sup.conf473@demo.pe', 'SUPERVISOR');
  v_otro uuid := test.crear_usuario('Otilia', 'Producción', 'sup.otro.conf473@demo.pe', 'SUPERVISOR');
  v_alm  uuid := test.crear_usuario('Alan', 'Almacén', 'alm.conf473@demo.pe', 'ALMACENERO');
  v_log  uuid := test.crear_usuario('Lía', 'Logística', 'log.conf473@demo.pe', 'COMPRADOR');
  v_ven  uuid := test.crear_usuario('Vito', 'Ventas', 'ven.conf473@demo.pe', 'VENDEDOR');
  v_col  uuid := test.crear_usuario('Celia', 'Diseño', 'col.conf473@demo.pe', 'DISENO_COLABORADOR');
  v_mat  uuid;
  v_rq   uuid := gen_random_uuid();
  v_lin  uuid := gen_random_uuid();
  v_mov  uuid := gen_random_uuid();
begin
  -- El armazón va sin disparadores: el área de cada cuenta la pone quien
  -- gestiona usuarios, y el RQ llega listo y con su salida sin recorrer el
  -- circuito, que tiene sus propios checks. Lo que se prueba va con ellos.
  perform set_config('session_replication_role', 'replica', true);
  update public.usuarios u set area_id = a.id
    from (values (v_req, 'REQ'), (v_sup, 'MTZ'), (v_otro, 'PRD'), (v_alm, 'ALM'), (v_log, 'LOG'), (v_ven, 'GCO')) as x(usuario, area)
    join public.areas a on a.codigo = x.area
   where u.id = x.usuario;
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CONF-473', 'Disco de corte del check 473',
          (select id from public.categorias_material where activo order by codigo limit 1),
          (select id from public.unidades_medida where codigo = 'UND'))
  returning id into v_mat;
  insert into public.requerimientos (id, numero, area_id, codigo_interno, justificacion, estado, creado_por, tipo, listo_en_almacen_en)
  values (v_rq, 'RQ-9473-2026', (select id from public.areas where codigo = 'MTZ'), 'CI-473', 'Discos de corte para el check 473 de la conformidad', 'LISTO_EN_ALMACEN', v_req, 'OPERACION', now());
  insert into public.requerimiento_lineas (id, requerimiento_id, item, descripcion, cantidad, unidad_medida_id, material_id, categoria_id)
  values (v_lin, v_rq, 1, 'Disco de corte del check 473', 4, (select id from public.unidades_medida where codigo = 'UND'), v_mat,
          (select categoria_id from public.materiales where id = v_mat));
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, recibido_por_nombre, registrado_por, requerimiento_linea_id, codigo_unidad, codigo_interno)
  values (v_mov, 'SALIDA', v_mat, 4, 'SALIDA_GENERAL', 'Check 473', 'Saúl Maestranza', v_alm, v_lin, 'CI-473', 'CI-473');
  perform set_config('session_replication_role', 'origin', true);
  perform set_config('prueba.req', v_req::text, false);
  perform set_config('prueba.sup', v_sup::text, false);
  perform set_config('prueba.otro', v_otro::text, false);
  perform set_config('prueba.alm', v_alm::text, false);
  perform set_config('prueba.log', v_log::text, false);
  perform set_config('prueba.ven', v_ven::text, false);
  perform set_config('prueba.col', v_col::text, false);
  perform set_config('prueba.rq', v_rq::text, false);
  perform set_config('prueba.mov', v_mov::text, false);
end $$;

-- 1. Quien no pidió no anota: Almacén, Logística, el supervisor de otra área.
select test.como_usuario(current_setting('prueba.alm')::uuid);
set local role authenticated;
select test.debe_fallar(format($q$select public.anotar_conformidad_salida(gen_random_uuid(), %L, 'NO_LLEGO', null, 'No llegó nada al taller')$q$,
  current_setting('prueba.mov')), 'Almacén no anota la conformidad de lo que entregó');
reset role;
select test.como_usuario(current_setting('prueba.log')::uuid);
set local role authenticated;
select test.debe_fallar(format($q$select public.anotar_conformidad_salida(gen_random_uuid(), %L, 'NO_LLEGO', null, 'No llegó nada al taller')$q$,
  current_setting('prueba.mov')), 'Logística no anota');
reset role;
select test.como_usuario(current_setting('prueba.otro')::uuid);
set local role authenticated;
select test.debe_fallar(format($q$select public.anotar_conformidad_salida(gen_random_uuid(), %L, 'NO_LLEGO', null, 'No llegó nada al taller')$q$,
  current_setting('prueba.mov')), 'El supervisor de otra área no anota');
reset role;
-- El colaborador de Diseño pide con requerimientos.emitir, pero responde solo por los suyos.
select test.como_usuario(current_setting('prueba.col')::uuid);
set local role authenticated;
select test.debe_fallar(format($q$select public.anotar_conformidad_salida(gen_random_uuid(), %L, 'NO_LLEGO', null, 'No llegó nada al taller')$q$,
  current_setting('prueba.mov')), 'El colaborador de Diseño no anota en un RQ que no registró');
select test.afirmar((select not bool_or(puede_anotar) from public.salidas_de_requerimientos(array[current_setting('prueba.rq')::uuid])),
  'Y la pantalla no le ofrece anotar');
reset role;

-- 2. Nadie escribe la tabla directo.
select test.como_usuario(current_setting('prueba.req')::uuid);
set local role authenticated;
select test.debe_fallar(format($q$insert into public.conformidad_salidas (movimiento_id, requerimiento_id, requerimiento_linea_id, tipo, nota, registrado_por)
  select %L, %L, l.id, 'NO_LLEGO', 'Escrita sin la función', %L from public.requerimiento_lineas l where l.requerimiento_id = %L$q$,
  current_setting('prueba.mov'), current_setting('prueba.rq'), current_setting('prueba.req'), current_setting('prueba.rq')),
  'La tabla no se escribe sin la función');

-- 3. «Llegó incompleto» pide cuánto llegó, menos de lo que salió.
select test.debe_fallar(format($q$select public.anotar_conformidad_salida(gen_random_uuid(), %L, 'LLEGO_INCOMPLETO', 4, 'Llegaron menos discos')$q$,
  current_setting('prueba.mov')), 'Llegó incompleto con lo mismo que salió no pasa');
select test.debe_fallar(format($q$select public.anotar_conformidad_salida(gen_random_uuid(), %L, 'LLEGO_INCOMPLETO', 3.9999, 'Llegaron casi todos los discos')$q$,
  current_setting('prueba.mov')), 'Ni con una cifra que guardada a tres decimales es lo mismo que salió');

-- 4. Requerimientos lo anota, y el mismo envío repetido no anota dos veces.
do $$
declare v_id uuid := gen_random_uuid();
begin
  perform public.anotar_conformidad_salida(v_id, current_setting('prueba.mov')::uuid, 'LLEGO_INCOMPLETO', 3, 'Llegaron tres discos, faltó uno');
  perform public.anotar_conformidad_salida(v_id, current_setting('prueba.mov')::uuid, 'LLEGO_INCOMPLETO', 3, 'Llegaron tres discos, faltó uno');
  perform test.afirmar((select count(*) from public.conformidad_salidas where movimiento_id = current_setting('prueba.mov')::uuid) = 1,
    'El envío repetido anota una sola vez');
  perform set_config('prueba.nota', v_id::text, false);
end $$;
-- El mismo id con otro contenido no es el mismo envío: no se da por anotado.
select test.debe_fallar(format($q$select public.anotar_conformidad_salida(%L, %L, 'NO_LLEGO', null, 'Al final no llegó ninguno')$q$,
  current_setting('prueba.nota'), current_setting('prueba.mov')), 'El mismo id con otra cosa no pasa por anotado', 'la primera vez que la enviaste');

-- 5. Una abierta por salida: el supervisor del área no anota otra mientras tanto.
reset role;
select test.afirmar((select count(*) from public.notificaciones
                      where usuario_id = current_setting('prueba.alm')::uuid and origen_id = current_setting('prueba.rq')::uuid
                        and titulo = 'Llegó incompleto: RQ-9473-2026') = 1,
  'A Almacén le llega el aviso de la nota');
select test.como_usuario(current_setting('prueba.sup')::uuid);
set local role authenticated;
select test.debe_fallar(format($q$select public.anotar_conformidad_salida(gen_random_uuid(), %L, 'NO_LLEGO', null, 'Tampoco llegó lo otro')$q$,
  current_setting('prueba.mov')), 'Una nota abierta por salida');
-- …pero la ve, con su salida, sin precio.
select test.afirmar((select count(*) from public.notas_de_conformidad(array[current_setting('prueba.rq')::uuid])) = 1,
  'El supervisor del área ve la nota de su RQ');
select test.afirmar((select bool_and(puede_anotar) from public.salidas_de_requerimientos(array[current_setting('prueba.rq')::uuid])),
  'El supervisor del área puede anotar en su RQ');

-- 6. Quien no ve requerimientos ni el kardex no lee nada.
reset role;
select test.como_usuario(current_setting('prueba.ven')::uuid);
set local role authenticated;
select test.afirmar((select count(*) from public.conformidad_salidas) = 0, 'Ventas no lee las notas');
select test.debe_fallar(format($q$select * from public.salidas_de_requerimientos(array[%L]::uuid[])$q$, current_setting('prueba.rq')),
  'Ventas no lee las salidas de un RQ');

-- 7. Logística (ve requerimientos, no despacha) no la cierra; Almacén sí, una vez.
reset role;
select test.como_usuario(current_setting('prueba.log')::uuid);
set local role authenticated;
select test.debe_fallar(format($q$select public.atender_conformidad_salida(%L, 'Lo repuse con otra salida')$q$, current_setting('prueba.nota')),
  'Logística no cierra la nota');
reset role;
select test.como_usuario(current_setting('prueba.alm')::uuid);
set local role authenticated;
select test.afirmar((select count(*) from public.notas_de_conformidad(null, true) where id = current_setting('prueba.nota')::uuid) = 1,
  'Almacén ve la nota abierta');
select public.atender_conformidad_salida(current_setting('prueba.nota')::uuid, 'Repuse el disco que faltó con otra salida');
select test.afirmar((select atendido_en is not null and atendido_por = current_setting('prueba.alm')::uuid
                       from public.conformidad_salidas where id = current_setting('prueba.nota')::uuid),
  'La cierra Almacén, con quién y cuándo');
select test.debe_fallar(format($q$select public.atender_conformidad_salida(%L, 'Otra respuesta distinta a la primera')$q$, current_setting('prueba.nota')),
  'Lo que respondió Almacén no se cambia');
reset role;
select test.afirmar((select count(*) from public.notificaciones
                      where usuario_id = current_setting('prueba.req')::uuid and origen_id = current_setting('prueba.nota')::uuid) = 1,
  'A quien la anotó le llega el aviso');

-- 8. Ni el dueño de las tablas corrige lo anotado.
select test.debe_fallar(format($q$update public.conformidad_salidas set nota = 'Otra nota cualquiera' where id = %L$q$, current_setting('prueba.nota')),
  'Lo anotado no se corrige');
select test.debe_fallar(format($q$delete from public.conformidad_salidas where id = %L$q$, current_setting('prueba.nota')),
  'Ni se borra');

rollback;
