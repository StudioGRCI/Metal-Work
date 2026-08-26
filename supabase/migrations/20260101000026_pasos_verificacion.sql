-- =============================================================================
-- LOS PASOS DE VERIFICACIÓN QUE EL TALLER YA RECORRE
-- -----------------------------------------------------------------------------
-- La sección 11 de la OT en papel es una lista numerada de pasos con dos
-- avances y un responsable. La de la OT 2925 —una plataforma semirremolque—
-- tiene dieciocho, y se transcribe tal cual, con el orden en que está escrita:
-- primero se habilita material y se arma la viga, y recién después figura
-- «solicitar el material», porque en el taller el pedido se hace mientras ya
-- se está trabajando con lo que hay.
--
-- Cada tipo de carrocería recorre pasos distintos: una tolva no lleva king pin
-- ni patas de apoyo, y en cambio hay que probarle el levante. Por eso la lista
-- va por tipo, y la que no tiene lista propia usa la genérica (tipo nulo).
-- =============================================================================

-- Una sola lista genérica: sin esto Postgres deja meter dos, porque los nulos
-- no se comparan entre sí.
create unique index if not exists uq_plantilla_verif_generica
  on public.plantillas_verificacion (numero)
  where tipo_carroceria_id is null;

comment on index public.uq_plantilla_verif_generica is
  'La lista genérica es una sola: la que se usa cuando la carrocería no tiene la suya.';

-- -----------------------------------------------------------------------------
-- Sembrar una lista de pasos para un tipo de carrocería.
-- Se pasa el arreglo en el orden del formato y la función numera. Reemplaza la
-- lista anterior, para que volver a correr la migración deje lo mismo.
-- -----------------------------------------------------------------------------
create or replace function public.sembrar_verificacion(p_codigo text, p_pasos text[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tipo uuid;
begin
  if p_codigo is not null then
    select id into v_tipo from public.tipos_carroceria where codigo = p_codigo;
    if v_tipo is null then
      return 0;  -- El tipo no existe en esta base; no es motivo para fallar.
    end if;
  end if;

  delete from public.plantillas_verificacion
   where tipo_carroceria_id is not distinct from v_tipo;

  insert into public.plantillas_verificacion (tipo_carroceria_id, numero, descripcion)
  select v_tipo, p.orden::smallint, p.paso
    from unnest(p_pasos) with ordinality as p(paso, orden);

  return array_length(p_pasos, 1);
end;
$$;

comment on function public.sembrar_verificacion(text, text[]) is
  'Deja la lista de pasos de verificación de un tipo de carrocería igual al arreglo que se le pasa.';

revoke all on function public.sembrar_verificacion(text, text[]) from public, anon;

-- =============================================================================
-- LAS LISTAS
-- =============================================================================

-- Los dieciocho pasos de la OT 2925, en su orden.
select public.sembrar_verificacion('PLATAFORMA', array[
  'Habilitación de material',
  'Armado de viga principal',
  'Solicitar el material',
  'Ingreso a planta del material',
  'Verificación de soldadura y acabado de estructura',
  'Instalación de suspensiones y ejes',
  'Armado de estructura',
  'Verificación de soldadura y acabado de viga',
  'Verificación de accesorios',
  'Instalación de sistema de aire',
  'Instalación de king pin',
  'Instalación de patas',
  'Instalación de placa',
  'Colocación de stickers',
  'Sistema de luces',
  'Pintura',
  'Colocación de cinta reflectiva',
  'Final al 100%'
]);

-- La cama baja y el portacontenedor son semirremolques como la plataforma:
-- mismo recorrido, con la salvedad de lo que se les monta encima.
select public.sembrar_verificacion('CAMA_BAJA', array[
  'Habilitación de material',
  'Armado de viga principal',
  'Solicitar el material',
  'Ingreso a planta del material',
  'Verificación de soldadura y acabado de estructura',
  'Instalación de suspensiones y ejes',
  'Armado de estructura',
  'Armado de rampas',
  'Verificación de soldadura y acabado de viga',
  'Verificación de accesorios',
  'Instalación de sistema de aire',
  'Instalación de king pin',
  'Instalación de patas',
  'Instalación de placa',
  'Colocación de stickers',
  'Sistema de luces',
  'Pintura',
  'Colocación de cinta reflectiva',
  'Final al 100%'
]);

select public.sembrar_verificacion('PORTACONTENEDOR', array[
  'Habilitación de material',
  'Armado de viga principal',
  'Solicitar el material',
  'Ingreso a planta del material',
  'Verificación de soldadura y acabado de estructura',
  'Instalación de suspensiones y ejes',
  'Armado de estructura',
  'Instalación y prueba de twist locks',
  'Verificación de soldadura y acabado de viga',
  'Verificación de accesorios',
  'Instalación de sistema de aire',
  'Instalación de king pin',
  'Instalación de patas',
  'Instalación de placa',
  'Colocación de stickers',
  'Sistema de luces',
  'Pintura',
  'Colocación de cinta reflectiva',
  'Final al 100%'
]);

-- La tolva se monta sobre un chasis: no tiene viga, ni ejes, ni king pin, y en
-- cambio hay que probarle el levante antes de soltarla.
select public.sembrar_verificacion('TOLVA_VOLQUETE', array[
  'Habilitación de material',
  'Solicitar el material',
  'Ingreso a planta del material',
  'Armado de estructura: durmientes y postes',
  'Forrado de piso, laterales y frontal',
  'Verificación de soldadura y acabado de estructura',
  'Armado de la compuerta posterior',
  'Verificación de la apertura mecánica de la compuerta',
  'Instalación del sistema hidráulico: tanque, válvula y pistón',
  'Instalación del toma fuerza',
  'Prueba de levante de la tolva',
  'Verificación de accesorios',
  'Montaje sobre el chasis',
  'Sistema de luces',
  'Arenado y pintura',
  'Colocación de stickers',
  'Colocación de cinta reflectiva',
  'Final al 100%'
]);

-- Baranda y furgón van montados sobre chasis, sin sistema hidráulico.
select public.sembrar_verificacion('BARANDA', array[
  'Habilitación de material',
  'Solicitar el material',
  'Ingreso a planta del material',
  'Armado de estructura: durmientes y largueros',
  'Forrado de piso',
  'Armado de barandas laterales',
  'Verificación de soldadura y acabado de estructura',
  'Verificación del abatimiento de las barandas',
  'Armado de la compuerta posterior',
  'Verificación de accesorios',
  'Montaje sobre el chasis',
  'Sistema de luces',
  'Arenado y pintura',
  'Colocación de stickers',
  'Colocación de cinta reflectiva',
  'Final al 100%'
]);

select public.sembrar_verificacion('FURGON', array[
  'Habilitación de material',
  'Solicitar el material',
  'Ingreso a planta del material',
  'Armado de la estructura del furgón',
  'Forrado de piso',
  'Forrado de laterales y techo',
  'Verificación de soldadura y acabado de estructura',
  'Armado e instalación de puertas posteriores',
  'Verificación del cierre y hermeticidad de las puertas',
  'Verificación de accesorios',
  'Montaje sobre el chasis',
  'Sistema de luces',
  'Arenado y pintura',
  'Colocación de stickers',
  'Colocación de cinta reflectiva',
  'Final al 100%'
]);

-- El frigorífico es el furgón más el panel y el equipo de frío.
select public.sembrar_verificacion('FURGON_FRIGORIFICO', array[
  'Habilitación de material',
  'Solicitar el material',
  'Ingreso a planta del material',
  'Armado de la estructura del furgón',
  'Instalación del panel térmico',
  'Forrado interior y sellado de juntas',
  'Verificación de soldadura y acabado de estructura',
  'Armado e instalación de puertas con burletes',
  'Instalación del equipo de frío',
  'Prueba de temperatura y hermeticidad',
  'Verificación de accesorios',
  'Montaje sobre el chasis',
  'Sistema de luces',
  'Arenado y pintura',
  'Colocación de stickers',
  'Colocación de cinta reflectiva',
  'Final al 100%'
]);

-- Cisterna y tanque llevan prueba de hermeticidad antes de pintar: después ya
-- no se puede tocar la soldadura sin rehacer el acabado.
select public.sembrar_verificacion('CISTERNA', array[
  'Habilitación de material',
  'Solicitar el material',
  'Ingreso a planta del material',
  'Rolado de virolas',
  'Armado del tanque y rompeolas',
  'Soldadura de costuras longitudinales y circunferenciales',
  'Verificación de soldadura y acabado del tanque',
  'Prueba de hermeticidad del tanque',
  'Instalación de válvulas, bocas y tuberías',
  'Instalación del sistema de descarga',
  'Verificación de accesorios',
  'Montaje sobre el chasis',
  'Sistema de luces',
  'Arenado y pintura',
  'Colocación de stickers y rombos de seguridad',
  'Colocación de cinta reflectiva',
  'Final al 100%'
]);

select public.sembrar_verificacion('TANQUE', array[
  'Habilitación de material',
  'Solicitar el material',
  'Ingreso a planta del material',
  'Rolado de virolas',
  'Armado del tanque',
  'Soldadura de costuras longitudinales y circunferenciales',
  'Verificación de soldadura y acabado del tanque',
  'Prueba de hermeticidad del tanque',
  'Instalación de válvulas y bocas',
  'Verificación de accesorios',
  'Arenado y pintura',
  'Colocación de stickers',
  'Final al 100%'
]);

-- Repotenciar empieza por ver qué se recibe y termina por devolverlo mejor de
-- lo que entró; el primer paso es el informe de lo que hay.
select public.sembrar_verificacion('REPOTENCIACION', array[
  'Recepción de la unidad e informe del estado en que llega',
  'Desmontaje de lo que se reemplaza',
  'Solicitar el material',
  'Ingreso a planta del material',
  'Habilitación de material',
  'Refuerzo y reparación de la estructura',
  'Verificación de soldadura y acabado de estructura',
  'Verificación de accesorios',
  'Sistema de luces',
  'Arenado y pintura',
  'Colocación de stickers',
  'Colocación de cinta reflectiva',
  'Final al 100%'
]);

-- La genérica, para la carrocería que no tiene lista propia y para la OT que
-- se abre sin tipo.
select public.sembrar_verificacion(null, array[
  'Habilitación de material',
  'Solicitar el material',
  'Ingreso a planta del material',
  'Armado de estructura',
  'Verificación de soldadura y acabado de estructura',
  'Verificación de accesorios',
  'Sistema de luces',
  'Arenado y pintura',
  'Colocación de stickers',
  'Colocación de cinta reflectiva',
  'Final al 100%'
]);

-- =============================================================================
-- ARMAR LA FICHA: AHORA CON LISTA GENÉRICA DE RESPALDO
-- =============================================================================
create or replace function public.armar_ficha_ot(p_orden uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cotizacion uuid;
  v_tipo       uuid;
  v_fuente     uuid;
begin
  select cotizacion_id, tipo_carroceria_id into v_cotizacion, v_tipo
    from public.ordenes_trabajo where id = p_orden;

  -- Los accesorios prometidos en la cotización son los que hay que montar.
  if v_cotizacion is not null
     and not exists (select 1 from public.ot_accesorios where orden_id = p_orden) then
    insert into public.ot_accesorios
      (orden_id, orden, cantidad, unidad, descripcion, incluye_el_accesorio)
    select p_orden, a.orden, a.cantidad, a.unidad, a.descripcion, a.incluye_el_accesorio
      from public.cotizacion_accesorios a
     where a.cotizacion_id = v_cotizacion;
  end if;

  -- Y los pasos de verificación de su carrocería. Si esa carrocería no tiene
  -- lista propia se usa la genérica: es preferible a dejar la sección vacía.
  if not exists (select 1 from public.ot_verificaciones where orden_id = p_orden) then
    if v_tipo is not null
       and exists (select 1 from public.plantillas_verificacion where tipo_carroceria_id = v_tipo) then
      v_fuente := v_tipo;
    end if;

    insert into public.ot_verificaciones (orden_id, numero, descripcion)
    select p_orden, v.numero, v.descripcion
      from public.plantillas_verificacion v
     where v.tipo_carroceria_id is not distinct from v_fuente;
  end if;
end;
$$;

-- =============================================================================
-- Y QUE SE ARME SOLA AL APROBAR LA ORDEN
-- -----------------------------------------------------------------------------
-- Al aprobar ya se instanciaban las etapas del catálogo. La ficha de taller es
-- lo mismo un paso más abajo: los accesorios que hay que montar y los pasos que
-- hay que verificar. Se baja en el mismo momento y por la misma razón —antes de
-- aprobar todavía puede cambiar—.
--
-- Va en su propio disparador y no dentro de fn_ot_despues_update a propósito:
-- ese cuerpo lo reescribió el blindaje para que llame a la bitácora interna, y
-- volver a escribirlo acá reabriría esa puerta sin que se note.
-- =============================================================================
create or replace function public.fn_ot_armar_ficha()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Una OT que nace aprobada también necesita su ficha; una en borrador, no,
  -- porque todavía puede cambiar de carrocería.
  if new.estado in ('BORRADOR', 'ANULADA') then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.estado is not distinct from old.estado then
    return null;
  end if;

  perform public.armar_ficha_ot(new.id);
  return null;
end;
$$;

comment on function public.fn_ot_armar_ficha is
  'Baja la ficha de taller cuando la orden deja de ser un borrador.';

drop trigger if exists trg_ot_armar_ficha_insert on public.ordenes_trabajo;
create trigger trg_ot_armar_ficha_insert after insert on public.ordenes_trabajo
  for each row execute function public.fn_ot_armar_ficha();

drop trigger if exists trg_ot_armar_ficha_update on public.ordenes_trabajo;
create trigger trg_ot_armar_ficha_update after update of estado on public.ordenes_trabajo
  for each row execute function public.fn_ot_armar_ficha();

revoke all on function public.fn_ot_armar_ficha() from public, anon, authenticated;
