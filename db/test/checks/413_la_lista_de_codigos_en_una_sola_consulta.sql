-- La lista de Códigos internos en una sola lectura (migración 20261021100000).
-- Con la cuenta de Gerencia y `set local role authenticated`:
-- codigos_internos_lista trae, en cada arreglo y en su mismo orden, exactamente
-- lo que devuelven las seis funciones por separado; y quien no ve los códigos
-- (Recursos Humanos) tampoco los ve por aquí. El armazón lo pone el
-- administrador. Termina en rollback.
\set ON_ERROR_STOP on
begin;

insert into public.sedes (codigo, nombre) values ('QA413', 'Taller prueba 413') on conflict (codigo) do nothing;
select id as sede_id from public.sedes where codigo = 'QA413' \gset
select test.crear_usuario('Ada', 'Admin', 'admin413@demo.pe', 'ADMIN', :'sede_id') as admin_id \gset
select test.crear_usuario('Gema', 'Gerente', 'gerencia413@demo.pe', 'GERENTE', :'sede_id') as gerente_id \gset
select test.crear_usuario('Rita', 'Personal', 'rrhh413@demo.pe', 'RECURSOS_HUMANOS', :'sede_id') as rrhh_id \gset

-- Un código con su OT, para que la lista no salga vacía.
select test.como_usuario(:'admin_id');
insert into public.clientes (tipo_documento, numero_documento, razon_social)
values ('RUC', '20990000413', 'QA CLIENTE 413') returning id as cliente_id \gset
select id as carroceria_id from public.tipos_carroceria where activo order by orden_secuencia limit 1 \gset
insert into public.unidades (cliente_id, codigo_interno, tipo_vehiculo)
values (:'cliente_id', 'CHK413_26/43', 'CAMION') returning id as unidad_id \gset
insert into public.ordenes_trabajo (numero, cliente_id, unidad_id, tipo_carroceria_id, sede_id, tipo_trabajo, prioridad, descripcion, estado)
values ('8414-2026', :'cliente_id', :'unidad_id', :'carroceria_id', :'sede_id', 'FABRICACION', 'NORMAL', 'Tolva 413', 'APROBADA');
-- Y una salida con precio, para que el costo tenga algo que comparar: 4 planchas
-- de S/ 25 (se arma como dueño: lo que se prueba es la lista, no la salida).
select set_config('prueba.admin', :'admin_id', true);
do $$
declare
  v_m uuid;
begin
  insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
  values ('CHK413-1', 'Plancha de prueba 413', (select id from public.categorias_material order by 1 limit 1),
          (select id from public.unidades_medida order by 1 limit 1)) returning id into v_m;
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             precio_unitario, moneda, registrado_en)
  values (gen_random_uuid(), 'INGRESO', v_m, 10, 'INGRESO_GENERAL', 'Compra en tienda', current_setting('prueba.admin')::uuid,
          25, 'PEN', now() - interval '2 days');
  insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por,
                                             recibido_por_nombre, codigo_unidad, codigo_interno, cantidad_de_stock)
  values (gen_random_uuid(), 'SALIDA', v_m, 4, 'SALIDA_GENERAL', 'Para la tolva', current_setting('prueba.admin')::uuid,
          'Área de Maestranza', 'CHK413_26/43', 'CHK413_26/43', 4);
end $$;

set local role authenticated;
select test.como_usuario(:'gerente_id');
do $$
declare
  v jsonb := public.codigos_internos_lista();
begin
  perform test.afirmar(
    (select array_agg(k order by k) from jsonb_object_keys(v) k) = array['avance', 'costo', 'diseno', 'resumen', 'servicios', 'subcontratos'],
    'Gerencia recibe los seis arreglos de la pantalla');
  perform test.afirmar(v -> 'resumen' = (select coalesce(jsonb_agg(to_jsonb(r) order by r.ultima_actividad desc nulls last, r.codigo), '[]')
                                           from public.codigos_internos_resumen() r),
    'el resumen es el de codigos_internos_resumen, en su orden');
  perform test.afirmar(v -> 'servicios' = (select coalesce(jsonb_agg(to_jsonb(s) order by s.codigo), '[]') from public.codigos_internos_servicios() s),
    'las órdenes de servicio son las de codigos_internos_servicios');
  perform test.afirmar(v -> 'subcontratos' = (select coalesce(jsonb_agg(to_jsonb(s) order by s.codigo), '[]') from public.codigos_internos_subcontratos() s),
    'los subcontratos son los de codigos_internos_subcontratos');
  perform test.afirmar(v -> 'costo' = (select coalesce(jsonb_agg(to_jsonb(k) order by k.codigo), '[]') from public.codigos_internos_costo() k),
    'el costo es el de codigos_internos_costo, con el precio que Gerencia ve');
  perform test.afirmar(v -> 'avance' = (select coalesce(jsonb_agg(to_jsonb(a) order by a.codigo), '[]') from public.codigos_internos_avance() a),
    'el avance es el de codigos_internos_avance');
  perform test.afirmar(v -> 'diseno' = (select coalesce(jsonb_agg(to_jsonb(d) order by d.ultimo_cambio desc nulls last, d.codigo), '[]')
                                          from public.codigos_internos_de_diseno() d),
    'lo de Diseño es lo de codigos_internos_de_diseno, en su orden');
  -- Que no se comparen dos vacíos: el código de la prueba está en el resumen, en
  -- Diseño y en el costo, con sus S/ 100. Servicios, subcontratos y avance
  -- pueden venir vacíos aquí; se comparan igual con su función.
  perform test.afirmar(exists (select 1 from jsonb_array_elements(v -> 'resumen') r
                                where r ->> 'codigo' = 'CHK413_26/43' and (r ->> 'materiales_pen')::numeric = 100),
    'el resumen trae el código de la prueba con sus S/ 100 de materiales');
  perform test.afirmar(exists (select 1 from jsonb_array_elements(v -> 'costo') k
                                where k ->> 'codigo' = 'CHK413_26/43' and (k ->> 'costo_pen')::numeric = 100),
    'el costo trae el código de la prueba con sus S/ 100');
  perform test.afirmar(exists (select 1 from jsonb_array_elements(v -> 'diseno') d where d ->> 'codigo' = 'CHK413_26/43'),
    'y Diseño también');
end $$;

-- Quien no ve los códigos internos tampoco los ve juntos.
select test.como_usuario(:'rrhh_id');
select test.debe_fallar($$select public.codigos_internos_lista()$$, 'Recursos Humanos no lee la lista de códigos', 'codigos_internos.ver');

-- Nadie sin sesión.
reset role;
select test.afirmar(not has_function_privilege('anon', 'public.codigos_internos_lista()', 'execute'), 'anon no la ejecuta');

rollback;
