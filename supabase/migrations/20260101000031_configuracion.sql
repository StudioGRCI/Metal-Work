-- =============================================================================
-- LA CONFIGURACIÓN SE EDITA DESDE EL SISTEMA
-- -----------------------------------------------------------------------------
-- El calendario laboral y los feriados existían en la base desde la migración
-- 018, pero editarlos exigía a alguien con psql. Esta migración no crea casi
-- nada: cierra un permiso que quedó abierto y deja el terreno listo para la
-- pantalla de Configuración.
--
-- Lo que se cierra: sembrar_feriados() estaba concedida a cualquier usuario
-- con sesión. Escribe feriados como dueña, así que saltaba la política que
-- reserva esa tabla a quien tiene configuracion.editar. Ahora lo exige ella
-- misma, que es la regla de la casa: la función comprueba su permiso, no
-- confía en quién la llama.
-- =============================================================================

create or replace function public.sembrar_feriados(p_anio int)
returns int
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_pascua date := public.pascua(p_anio);
  v_nuevos int;
begin
  -- Sembrar feriados es editar el calendario de toda la empresa.
  perform public.exigir_permiso('configuracion.editar');

  if p_anio not between 2020 and 2100 then
    raise exception 'El año % está fuera del rango del calendario', p_anio;
  end if;

  with nacionales(fecha, nombre) as (
    values
      (make_date(p_anio,  1,  1), 'Año Nuevo'),
      (v_pascua - 3,               'Jueves Santo'),
      (v_pascua - 2,               'Viernes Santo'),
      (make_date(p_anio,  5,  1), 'Día del Trabajo'),
      (make_date(p_anio,  6,  7), 'Batalla de Arica y Día de la Bandera'),
      (make_date(p_anio,  6, 29), 'San Pedro y San Pablo'),
      (make_date(p_anio,  7, 23), 'Día de la Fuerza Aérea del Perú'),
      (make_date(p_anio,  7, 28), 'Fiestas Patrias'),
      (make_date(p_anio,  7, 29), 'Fiestas Patrias'),
      (make_date(p_anio,  8,  6), 'Batalla de Junín'),
      (make_date(p_anio,  8, 30), 'Santa Rosa de Lima'),
      (make_date(p_anio, 10,  8), 'Combate de Angamos'),
      (make_date(p_anio, 11,  1), 'Todos los Santos'),
      (make_date(p_anio, 12,  8), 'Inmaculada Concepción'),
      (make_date(p_anio, 12,  9), 'Batalla de Ayacucho'),
      (make_date(p_anio, 12, 25), 'Navidad')
  )
  insert into public.feriados (fecha, nombre, ambito)
  select fecha, nombre, 'NACIONAL' from nacionales
  on conflict (fecha) do nothing;

  get diagnostics v_nuevos = row_count;
  return v_nuevos;
end;
$$;

comment on function public.sembrar_feriados(int) is
  'Carga los feriados nacionales del año indicado, exigiendo configuracion.editar. No pisa lo ya cargado.';

-- -----------------------------------------------------------------------------
-- La revisión encontró que el candado de los días laborables dejaba pasar el
-- arreglo vacío: array_length('{}') es nulo y un check nulo no rechaza nada.
-- Con la empresa sin días de taller, es_laborable() jamás es verdadero y todo
-- cálculo de plazos se cae. Se cierra el hueco.
-- -----------------------------------------------------------------------------
alter table public.empresa drop constraint if exists ck_empresa_dias_laborables;
alter table public.empresa add constraint ck_empresa_dias_laborables check (
  coalesce(array_length(dias_laborables, 1), 0) between 1 and 7
  and dias_laborables <@ array[1,2,3,4,5,6,7]::smallint[]
);
