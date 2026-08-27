-- =============================================================================
-- LOS CATÁLOGOS NO SON SECRETOS: SIN ELLOS NADIE PUEDE COTIZAR
-- -----------------------------------------------------------------------------
-- El peor de toda esta serie, y estaba vivo: `configuracion.ver` no lo tiene
-- **ningún rol**. Ni GERENTE, ni VENDEDOR, ni JEFE_TALLER. Y once catálogos
-- exigían ese permiso para poder leerse, así que a todo el mundo salvo al
-- administrador le llegaban vacíos, sin error y sin aviso:
--
--   · Un vendedor abre «Nueva cotización» y el desplegable «Tipo de carrocería»
--     no tiene ni una opción. Las diez que hay en el catálogo, invisibles.
--   · Aprueba la cotización, pulsa «Abrir orden de trabajo» y el desplegable
--     «Taller donde se ejecutará» también sale vacío: tampoco ve las sedes.
--   · El almacenero da de alta un material y no tiene unidades de medida ni
--     categorías que elegir.
--
-- Es decir: el trabajo diario de la empresa solo funcionaba entrando como
-- administrador. Y explica por qué no saltaba en las pruebas: la cuenta con la
-- que se recorre el sistema es ADMIN, y ADMIN pasa por `es_admin()`, nunca por
-- el permiso.
--
-- El arreglo es de fondo, no un parche de permisos: esto no es configuración
-- reservada, es el vocabulario con el que la empresa habla. Un tipo de
-- carrocería, una sede, una unidad de medida o un área del organigrama los
-- necesita cualquiera que use el sistema. Se abren a lectura para todo usuario
-- activo; **escribirlos sigue pidiendo `configuracion.editar`**, que es donde
-- de verdad hacía falta la puerta.
--
-- Quedan fuera a propósito, porque sí guardan decisiones y no vocabulario:
--   · `empresa` — lleva el IGV congelado y el costo indirecto por hora. Lo que
--     el resto necesita de ella es el membrete, y para eso está
--     `datos_de_empresa()`, que devuelve solo los datos que van impresos.
--   · `series_documentarias` — los correlativos vivos de la casa.
-- =============================================================================

do $$
declare
  v_tabla text;
begin
  foreach v_tabla in array array[
    'tipos_carroceria',     -- sin esto no se cotiza
    'sedes',                -- sin esto no se abre una orden
    'unidades_medida',
    'categorias_material',
    'etapas_catalogo',
    'centros_costo',
    'areas',
    'tipos_documento_sig',
    'tipos_cambio'
  ]
  loop
    if to_regclass(format('public.%I', v_tabla)) is null then
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I', 'ver_' || v_tabla, v_tabla);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (public.es_usuario_activo())',
      'ver_' || v_tabla, v_tabla);
  end loop;
end $$;

comment on table public.tipos_carroceria is
  'Las carrocerías que fabrica la casa. Es vocabulario comercial: lo lee cualquiera que cotice o abra una orden; darlo de alta sigue siendo de configuración.';
