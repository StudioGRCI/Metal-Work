-- =============================================================================
-- LAS TREINTA CARROCERÍAS QUE LA EMPRESA FABRICA DE VERDAD
-- -----------------------------------------------------------------------------
-- El catálogo traía diez tipos genéricos —«Cisterna», «Furgón», «Tanque»— que no
-- salen de ningún documento de la empresa: se inventaron al arrancar el sistema.
-- Los suyos están escritos en la hoja COD de su libro de seguimiento de
-- fabricación, son treinta, y cada uno tiene su código de tres letras, que es el
-- primer segmento del código con el que el taller llama a cada unidad mientras
-- la construye (VSC_SR_O4_6_26/30).
--
-- La diferencia no es cosmética: «Cisterna» no dice si es de agua, de GLP o de
-- combustible, y son tres carrocerías distintas, con otro acero, otra prueba de
-- presión y otro precio.
--
-- Las genéricas no se borran. Cinco están apuntadas por cotizaciones, órdenes o
-- plantillas de ficha ya emitidas, y borrar un catálogo que un documento
-- referencia deja el documento hablando de algo que no existe. Se marcan como
-- del catálogo anterior y se mandan al final de la lista, para que nadie las
-- elija para un trabajo nuevo; las cinco que no usa nadie se desactivan.
-- =============================================================================

insert into public.tipos_carroceria (codigo, nombre, orden_secuencia, activo) values
  -- Tolva volquete: cinco pisos distintos, y el piso es media carrocería.
  ('VPC', 'Tolva volquete · piso circular',        10, true),
  ('VPP', 'Tolva volquete · piso plano',           11, true),
  ('VSC', 'Tolva volquete · piso semicircular',    12, true),
  ('VOM', 'Tolva volquete · metalero',             13, true),
  ('VOG', 'Tolva volquete · granelero',            14, true),

  -- Cisterna: lo que transporta manda sobre el acero y sobre la prueba.
  ('CIA', 'Cisterna · agua',                       20, true),
  ('CCO', 'Cisterna · corrosivo',                  21, true),
  ('CIP', 'Cisterna · GLP',                        22, true),
  ('COM', 'Cisterna · combustible',                23, true),
  ('GIV', 'Cisterna · GNV',                        24, true),
  ('CIV', 'Cisterna · vacío',                      25, true),

  ('FRG', 'Furgón · frigorífico',                  30, true),
  ('FUL', 'Furgón · liso',                         31, true),
  ('FUA', 'Furgón · acanalado',                    32, true),
  ('FUR', 'Furgón · lubricador',                   33, true),
  ('FUM', 'Furgón · con malla',                    34, true),

  ('ABR', 'Ambulancia · rural tipo I',             40, true),
  ('ABU', 'Ambulancia · urbana tipo II',           41, true),

  ('COS', 'Compactador · simple',                  50, true),
  ('COA', 'Compactador · con alza contenedores',   51, true),

  ('PZ',  'Planta · de zarandeo',                  60, true),
  ('PT',  'Planta · trituradora',                  61, true),

  ('BAR', 'Baranda',                               70, true),
  ('BOB', 'Bombona',                               71, true),
  ('CB',  'Cama baja',                             72, true),
  ('CIG', 'Cigüeña',                               73, true),
  ('PC',  'Contenedor',                            74, true),
  ('PLA', 'Plataforma',                            75, true),
  ('MA',  'Madrina',                               76, true),
  ('HOR', 'Hormigonera',                           77, true)
on conflict (codigo) do nothing;

-- Las genéricas que no usa ningún documento salen de los desplegables.
update public.tipos_carroceria
   set activo = false
 where codigo in ('CAMA_BAJA', 'CISTERNA', 'FURGON_FRIGORIFICO', 'PORTACONTENEDOR', 'TANQUE')
   and not exists (select 1 from public.cotizaciones c where c.tipo_carroceria_id = tipos_carroceria.id)
   and not exists (select 1 from public.ordenes_trabajo o where o.tipo_carroceria_id = tipos_carroceria.id)
   and not exists (select 1 from public.unidades u where u.tipo_carroceria_id = tipos_carroceria.id)
   and not exists (select 1 from public.plantillas_ficha p where p.tipo_carroceria_id = tipos_carroceria.id);

-- Las que sí están apuntadas se quedan, pero dicen lo que son y van al final:
-- el documento que las referencia sigue teniendo sentido y nadie las elige para
-- un trabajo nuevo sin darse cuenta.
update public.tipos_carroceria
   set nombre = nombre || ' (catálogo anterior)',
       orden_secuencia = 900 + orden_secuencia
 where codigo in ('BARANDA', 'FURGON', 'PLATAFORMA', 'TOLVA_VOLQUETE')
   and nombre not like '%(catálogo anterior)';

comment on table public.tipos_carroceria is
  'Las carrocerías que la empresa fabrica, con el código de tres letras de su hoja COD. Ese código es el primer segmento del código interno de cada unidad (VSC_SR_O4_6_26/30).';
