-- La cotización como ficha técnica: las plantillas de la empresa y cómo se
-- aplican a una cotización nueva.
\set ON_ERROR_STOP on
begin;

insert into public.empresa (ruc, razon_social) values ('20100000013', 'PRUEBAS FICHA S.A.C.');
insert into public.sedes (codigo, nombre) values ('T1', 'Taller principal');

select test.crear_usuario('Ana',   'Torres', 'ana@demo.pe',   'ADMIN',    (select id from public.sedes limit 1)) as admin_id \gset
select test.crear_usuario('Diego', 'Quispe', 'diego@demo.pe', 'OPERARIO', (select id from public.sedes limit 1), true, 14) as operario_id \gset

insert into public.clientes (tipo_documento, numero_documento, razon_social)
  values ('RUC', '20607761907', 'TRANSPORTES VEGA PIUNDO S.A.C');

select test.como_usuario(:'admin_id');

-- ------------------------------------------------- las plantillas están cargadas
do $$
declare
  v_lineas int;
  v_acc    int;
begin
  select count(*) into v_lineas
    from public.plantilla_ficha_lineas l
    join public.plantillas_ficha p on p.id = l.plantilla_id
    join public.tipos_carroceria t on t.id = p.tipo_carroceria_id
   where t.codigo = 'TOLVA_VOLQUETE';

  if v_lineas < 25 then
    raise exception 'FALLA: la ficha de la tolva quedó con solo % líneas', v_lineas;
  end if;
  raise notice '  ok · la ficha de la tolva viene escrita, con % líneas', v_lineas;

  -- Lo que hace útil la ficha es el detalle: el espesor tiene que estar.
  if not exists (
    select 1 from public.plantilla_ficha_lineas l
     where l.etiqueta = 'Durmientes' and l.detalle like '%A-36 de 6 mm%'
  ) then
    raise exception 'FALLA: se perdió el espesor de los durmientes';
  end if;
  raise notice '  ok · con sus espesores, no como texto suelto';

  select count(*) into v_acc
    from public.plantilla_ficha_accesorios a
    join public.plantillas_ficha p on p.id = a.plantilla_id
    join public.tipos_carroceria t on t.id = p.tipo_carroceria_id
   where t.codigo = 'PLATAFORMA';

  if v_acc < 12 then
    raise exception 'FALLA: la plataforma quedó con solo % accesorios', v_acc;
  end if;
  raise notice '  ok · la plataforma trae sus % accesorios', v_acc;

  -- El paréntesis que dice «no incluye accesorio» es plata: tiene que ser dato.
  if not exists (
    select 1 from public.plantilla_ficha_accesorios a
     where a.descripcion like 'Porta conos%' and a.incluye_el_accesorio = false
  ) then
    raise exception 'FALLA: se perdió la distinción entre el porta y lo que va adentro';
  end if;
  raise notice '  ok · el porta que no trae el accesorio queda marcado como tal';
end $$;

-- ------------------------------------------------- aplicar la ficha a una cotización
do $$
declare
  v_cot       uuid;
  v_plantilla uuid;
  v_lineas    int;
  v_copiadas  int;
begin
  insert into public.cotizaciones (cliente_id, sede_id, tipo_carroceria_id, fecha_emision)
  select (select id from public.clientes limit 1),
         (select id from public.sedes limit 1),
         t.id, current_date
    from public.tipos_carroceria t where t.codigo = 'TOLVA_VOLQUETE'
  returning id into v_cot;

  select p.id into v_plantilla
    from public.plantillas_ficha p
    join public.tipos_carroceria t on t.id = p.tipo_carroceria_id
   where t.codigo = 'TOLVA_VOLQUETE' limit 1;

  v_copiadas := public.aplicar_plantilla_ficha(v_cot, v_plantilla);

  select count(*) into v_lineas from public.cotizacion_especificaciones where cotizacion_id = v_cot;
  if v_lineas <> v_copiadas or v_lineas = 0 then
    raise exception 'FALLA: se copiaron % líneas y la cotización tiene %', v_copiadas, v_lineas;
  end if;
  raise notice '  ok · la cotización nace con su ficha completa: % líneas', v_lineas;

  if (select count(*) from public.cotizacion_accesorios where cotizacion_id = v_cot) <> 8 then
    raise exception 'FALLA: los accesorios no se copiaron';
  end if;
  raise notice '  ok · y con sus accesorios';

  -- Cambiar de carrocería tiene que dejar la ficha nueva, no las dos mezcladas.
  select p.id into v_plantilla
    from public.plantillas_ficha p
    join public.tipos_carroceria t on t.id = p.tipo_carroceria_id
   where t.codigo = 'PLATAFORMA' limit 1;

  perform public.aplicar_plantilla_ficha(v_cot, v_plantilla);

  if exists (
    select 1 from public.cotizacion_especificaciones
     where cotizacion_id = v_cot and seccion = 'SISTEMA HIDRÁULICO'
  ) then
    raise exception 'FALLA: quedaron mezcladas las dos fichas';
  end if;
  if not exists (
    select 1 from public.cotizacion_especificaciones
     where cotizacion_id = v_cot and seccion = 'KING PIN'
  ) then
    raise exception 'FALLA: no se aplicó la ficha de la plataforma';
  end if;
  raise notice '  ok · cambiar de carrocería reemplaza la ficha, no la suma';
end $$;

-- ------------------------------------------- la cabecera guarda lo que cambia
do $$
declare v_cot uuid;
begin
  select id into v_cot from public.cotizaciones limit 1;

  update public.cotizaciones
     set largo_m = 4.60, ancho_m = 2.20, alto_m = 2.00,
         capacidad = '10 M3', garantia_meses = 12, incluye_igv = true
   where id = v_cot;

  if not exists (
    select 1 from public.cotizaciones
     where id = v_cot and largo_m = 4.60 and capacidad = '10 M3' and plazo_en_habiles
  ) then
    raise exception 'FALLA: las medidas no quedaron guardadas';
  end if;
  raise notice '  ok · las medidas y la garantía viven en la cotización, no en un texto';

  -- El plazo de esta empresa se cuenta en días de taller, y así viene por defecto.
  if not (select plazo_en_habiles from public.cotizaciones where id = v_cot) then
    raise exception 'FALLA: el plazo dejó de contarse en días hábiles';
  end if;
  raise notice '  ok · y el plazo se ofrece en días de taller, como lo escribe la empresa';
end $$;

-- --------------------------------------------------- quién puede tocar la ficha
select test.como_usuario(:'operario_id');
set role authenticated;

do $$
begin
  perform test.afirmar(
    (select count(*) from public.cotizacion_especificaciones) = 0,
    'un operario no ve la ficha técnica de las cotizaciones');
end $$;

reset role;

select test.como_usuario(:'operario_id');

do $$
declare
  v_cot uuid;
  v_pl  uuid;
begin
  select id into v_cot from public.cotizaciones limit 1;
  select id into v_pl  from public.plantillas_ficha limit 1;

  begin
    perform public.aplicar_plantilla_ficha(v_cot, v_pl);
    raise exception 'FALLA: un operario aplicó una plantilla a una cotización';
  exception when insufficient_privilege then
    raise notice '  ok · aplicar una ficha exige el permiso de cotizaciones';
  end;
end $$;

rollback;
