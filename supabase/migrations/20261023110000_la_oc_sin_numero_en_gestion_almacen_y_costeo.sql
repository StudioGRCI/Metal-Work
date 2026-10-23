-- La OC sin número tampoco pasa por un número de OC en Gestión de compras, Almacén y Costeo.
--
-- La 20261022220000 nombró la OC de antes de la serie OC-…-MW con `nombre_de_oc`
-- en lo que la base arma como frase, y dejó para cada pantalla lo que la base
-- devuelve como dato suelto. Pero diez funciones no lo devolvían suelto: daban
-- `coalesce(numero, referencia)`, la referencia del proveedor en el lugar del
-- número, y la pantalla no tenía cómo saber que no lo era. En la gestión de
-- compras, el número y la referencia son el mismo texto en casi todas las OC
-- (184 de 200 en una copia como producción), y el conductor y Supervisión no
-- leen la tabla de compras para averiguarlo. Así:
--   * Gestión de compras, Recojos y Órdenes de compra decían «OC-0621 · Proveedor»
--     de una OC que no tiene número;
--   * Almacén validaba su ingreso con «OC-0621» en la cabecera, y si dejaba la
--     guía en blanco el kardex guardaba «OC-0621» como documento, para siempre;
--   * el Costeo del código y el gasto por código ponían «OC-0621» en la columna
--     OC y delante de la línea del IGV de la boleta de una parte y de la nota de
--     crédito, y el avance de cada RQ decía «· OC-0621 · Pendiente de recojo».
-- Lo que dice la cabecera de la 20261022220000 («Gestión de compras,
-- Requerimientos, Almacén y Costeo reciben la referencia aparte… y se arreglan
-- con sus pantallas») solo era cierto para algunas: esta migración hace el resto.
--
-- Dos maneras, según quién lee:
--   * `compras_en_gestion`, `compras_para_recojo` y `ordenes_compra_listado` ya
--     traen la referencia aparte. Pasan el número tal cual (vacío en la OC de
--     antes de la serie), como `documentos_por_aprobar` en la 20261022220000, y
--     la pantalla la nombra con `nombreDeOc` y muestra «Ref. del proveedor: …».
--   * Las demás no traen la referencia aparte, y darles otra columna obliga a
--     soltar la función. Pasan el nombre armado con `nombre_de_oc`: el número, o
--     «OC sin número (ref. del proveedor OC-0621)». Son `guias_por_emitir`
--     (numero), `ingresos_por_validar` (referencia), `validar_ingresos_compra`
--     (el documento del kardex cuando la guía va en blanco), `avance_de_requerimientos`
--     (orden_compra de cada insumo, solo si tiene OC), `codigo_interno_lineas`
--     (el documento de la línea de compras, que `codigo_interno_compras` da como
--     numero) y las líneas del IGV de la boleta de una parte y de la nota de crédito.
-- La OC con número sale igual que antes. Lo ya guardado en el kardex no se
-- reescribe: queda como evidencia de lo que se escribió.
--
-- El orden importa: con la aplicación de antes, las tres primeras mostrarían un
-- número vacío. Se aplica después de publicar la aplicación que la lee.
--
-- En la nota de crédito no se cambia la línea `coalesce(c.numero, c.referencia)
-- as compra`: la 20261022220000 la deja así y la reconoce como suya, y cambiarla
-- haría que esa migración se detuviera si se vuelve a correr. Se cambia lo que
-- sale: el documento de la línea pasa a ser `nombre_oc`, y `compra` queda sin usar.
--
-- Cómo cambia cada función: como en la 20261022220000, solo el fragmento exacto;
-- si no está y tampoco su reemplazo, la función cambió por otro lado y la
-- migración se detiene sin tocar nada. Al final se comprueba, sobre todas las
-- funciones de la base, que ninguna dé ya `coalesce(numero, referencia)`.

do $$
declare
  v_c       record;
  v_funcion text;
  v_def     text;
  v_antes   text;
  v_quedan  text;
begin
  for v_c in
    select * from (values
      -- Gestión de compras, Recojos y Órdenes de compra: el número tal cual.
      (1, 'compras_en_gestion()',
       $v$select c.id, coalesce(c.numero, c.referencia), c.referencia, c.origen, c.proveedor, pv.numero_documento,$v$,
       $v$select c.id, c.numero, c.referencia, c.origen, c.proveedor, pv.numero_documento,$v$),
      (2, 'compras_para_recojo()',
       $v$select c.id, coalesce(c.numero, c.referencia), c.referencia, c.origen, c.proveedor, p.numero_documento,$v$,
       $v$select c.id, c.numero, c.referencia, c.origen, c.proveedor, p.numero_documento,$v$),
      (3, 'ordenes_compra_listado()',
       $v$select c.id, coalesce(c.numero, c.referencia), c.referencia, c.origen, c.proveedor, p.numero_documento,$v$,
       $v$select c.id, c.numero, c.referencia, c.origen, c.proveedor, p.numero_documento,$v$),
      -- Almacén: el nombre, y el documento del kardex cuando la guía va en blanco.
      (4, 'guias_por_emitir()',
       $v$select c.id, coalesce(c.numero, c.referencia), c.proveedor, pr.peso_kg, c.recojo$v$,
       $v$select c.id, public.nombre_de_oc(c.numero, c.referencia), c.proveedor, pr.peso_kg, c.recojo$v$),
      (5, 'ingresos_por_validar()',
       $v$select p.id, p.orden_compra_id, coalesce(c.numero, c.referencia), c.proveedor, c.requerimiento_id is null,$v$,
       $v$select p.id, p.orden_compra_id, public.nombre_de_oc(c.numero, c.referencia), c.proveedor, c.requerimiento_id is null,$v$),
      (6, 'validar_ingresos_compra(uuid,jsonb,text)',
       $v$v_documento := left(coalesce(nullif(btrim(p_documento), ''), v_compra.numero, v_compra.referencia), 100);$v$,
       $v$v_documento := left(coalesce(nullif(btrim(p_documento), ''), public.nombre_de_oc(v_compra.numero, v_compra.referencia)), 100);$v$),
      -- Requerimientos y Costeo: el nombre. El insumo sin OC sigue sin OC:
      -- nombre_de_oc de dos vacíos dice «OC sin número» y lo daría por comprado.
      (7, 'avance_de_requerimientos(uuid[])',
       $v$           coalesce(c.numero, c.referencia) as compra,$v$,
       $v$           case when c.id is not null then public.nombre_de_oc(c.numero, c.referencia) end as compra,$v$),
      (8, 'codigo_interno_lineas(text,boolean)',
       $v$    select l.codigo, c.id, coalesce(c.numero, c.referencia) as numero,$v$,
       $v$    select l.codigo, c.id, public.nombre_de_oc(c.numero, c.referencia) as numero,$v$),
      (9, 'codigo_interno_lineas_igv_de_parte(text)',
       $v$           coalesce(c.numero, c.referencia) as compra,$v$,
       $v$           public.nombre_de_oc(c.numero, c.referencia) as compra,$v$),
      (10, 'codigo_interno_lineas_nota_credito(text)',
       $v$0, l.compra::text, l.id$v$,
       $v$0, l.nombre_oc::text, l.id$v$)
    ) as c(orden, funcion, viejo, nuevo)
    union all
    select null::integer, null, null, null  -- cierra la última función
    order by 1 nulls last
  loop
    if v_funcion is distinct from v_c.funcion then
      if v_funcion is not null and v_def <> v_antes then
        execute v_def;
      end if;
      exit when v_c.funcion is null;
      v_funcion := v_c.funcion;
      -- Sin los `\r` de un pegado desde Windows: el texto se compara línea por línea.
      v_def := replace(pg_get_functiondef(('public.' || v_funcion)::regprocedure), E'\r', '');
      v_antes := v_def;
    end if;
    if position(v_c.viejo in v_def) > 0 then
      v_def := replace(v_def, v_c.viejo, v_c.nuevo);
    elsif position(v_c.nuevo in v_def) = 0 then
      raise exception '% cambió: no tiene «%» como lo conoce el repositorio. Revisarla a mano antes de seguir.',
        v_funcion, left(v_c.viejo, 120);
    end if;
  end loop;

  -- Ninguna función de la base da ya la referencia en el lugar del número: ni
  -- coalesce(numero, referencia), con alias o sin él, en una línea o en dos, ni
  -- coalesce(…, x.numero, x.referencia). Las llamadas a nombre_de_oc se quitan
  -- antes de buscar. La línea `as compra` de la nota de crédito se perdona solo
  -- mientras nadie use `l.compra`.
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_quedan
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and regexp_replace(p.prosrc, 'nombre_de_oc\(\s*([a-z_]+\.)?\mnumero\s*,\s*([a-z_]+\.)?\mreferencia\s*\)', '', 'g')
         ~ ('coalesce\(\s*([a-z_]+\.)?\mnumero\s*,\s*([a-z_]+\.)?\mreferencia\s*[,)]'
            '|,\s*([a-z_]+\.)?\mnumero\s*,\s*([a-z_]+\.)?\mreferencia\s*\)')
     and not (p.proname = 'codigo_interno_lineas_nota_credito' and p.prosrc !~ 'l\.compra\M');
  if v_quedan is not null then
    raise exception 'Todavía dan la referencia del proveedor como número de OC: %. Revisarlas a mano.', v_quedan;
  end if;
end $$;

-- Qué trae cada columna, para que la próxima pantalla no la lea al revés: el
-- nombre de la columna no se puede cambiar sin soltar la función. Se suma al
-- comentario que ya tenga, una sola vez.
do $$
declare
  v_c     record;
  v_antes text;
begin
  for v_c in
    select * from (values
      ('compras_en_gestion()', 'numero: el número de la OC, vacío en la de antes de la serie; referencia: la del proveedor. Para nombrarla, nombreDeOc.'),
      ('compras_para_recojo()', 'numero: el número de la OC, vacío en la de antes de la serie; referencia: la del proveedor. Para nombrarla, nombreDeOc.'),
      ('ordenes_compra_listado()', 'numero: el número de la OC, vacío en la de antes de la serie; referencia: la del proveedor. Para nombrarla, nombreDeOc.'),
      ('guias_por_emitir()', 'numero: el nombre de la OC armado por nombre_de_oc; no sirve para buscarla.'),
      ('ingresos_por_validar()', 'referencia: el nombre de la OC armado por nombre_de_oc, no la referencia del proveedor; no sirve para buscarla.'),
      ('avance_de_requerimientos(uuid[])', 'orden_compra de cada insumo: el nombre de su OC armado por nombre_de_oc, o vacío si no tiene OC.'),
      ('codigo_interno_lineas(text,boolean)', 'documento de las líneas de compras, del IGV de la boleta de una parte y de la nota de crédito: el nombre de la OC armado por nombre_de_oc.'),
      ('codigo_interno_compras(text)', 'numero: el nombre de la OC armado por nombre_de_oc; no sirve para buscarla.')
    ) as c(funcion, frase)
  loop
    v_antes := obj_description(('public.' || v_c.funcion)::regprocedure, 'pg_proc');
    if v_antes is null or position(v_c.frase in v_antes) = 0 then
      execute format('comment on function public.%s is %L', v_c.funcion,
                     coalesce(v_antes || ' ', '') || v_c.frase);
    end if;
  end loop;
end $$;
