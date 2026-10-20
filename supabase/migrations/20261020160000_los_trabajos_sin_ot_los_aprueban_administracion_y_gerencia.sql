-- =============================================================================
-- LOS TRABAJOS SIN OT LOS APRUEBAN ADMINISTRACIÓN Y GERENCIA
-- -----------------------------------------------------------------------------
-- DKS decidió (2026-10-20) que los reportes de las unidades que entran sin
-- orden de trabajo los aprueba Administración, «aparte también debe poder
-- Gerencia».
--
-- Administración ya tenía el permiso de aprobar (`produccion.aprobar_reportes`)
-- y la política de UPDATE de `flota_avances` lo aceptaba, pero las de lectura
-- pedían `produccion.ver`, que Administración no tiene: la fila le quedaba
-- oculta, el UPDATE afectaba cero filas sin error y la pantalla decía «no se
-- tocó nada». Lo cazó el check 230. Aquí la lectura de la unidad, del reporte
-- y de sus fotos acepta también a quien aprueba, que es lo mínimo para
-- aprobar: no se le abre el resto de Producción.
--
-- Gerencia recibe un permiso propio, `produccion.aprobar_sin_orden`, y no el
-- de aprobar todos los reportes: DKS habló de los trabajos sin OT. Con el
-- ancho, Gerencia habría aprobado también las hojas de cada OT, resuelto sus
-- observaciones y recibido el aviso de cada una. El permiso angosto vale solo
-- en `flota_avances`: lo reconocen sus políticas y el disparador de revisión.
--
-- Todo es aditivo salvo el último apartado, que cierra el borrado de lo
-- aprobado. No borra ni cambia ningún dato.
-- =============================================================================

insert into public.permisos (codigo, modulo, descripcion) values
  ('produccion.aprobar_sin_orden', 'Producción',
   'Aprobar u observar los reportes de los trabajos sin orden de trabajo')
on conflict (codigo) do update set descripcion = excluded.descripcion;

insert into public.roles_permisos (rol_id, permiso_codigo)
select r.id, 'produccion.aprobar_sin_orden'
  from public.roles r
 where r.codigo = 'GERENTE'
on conflict do nothing;

alter policy ver_flota_unidades on public.flota_unidades using (
  public.es_admin() or public.tiene_permiso('produccion.ver')
  or public.tiene_permiso('produccion.aprobar_reportes')
  or public.tiene_permiso('produccion.aprobar_sin_orden')
);

alter policy ver_flota_avances on public.flota_avances using (
  public.es_admin() or public.tiene_permiso('produccion.ver')
  or public.tiene_permiso('produccion.aprobar_reportes')
  or public.tiene_permiso('produccion.aprobar_sin_orden')
);

alter policy ver_flota_avance_fotos on public.flota_avance_fotos using (
  public.es_admin() or public.tiene_permiso('produccion.ver')
  or public.tiene_permiso('produccion.aprobar_reportes')
  or public.tiene_permiso('produccion.aprobar_sin_orden')
);

-- La foto en el almacenamiento: la de una unidad sin orden no tiene OT en la
-- ruta, así que `puede_ver_orden` no entra en juego para ella.
alter policy mw_leer_fotos_avance on storage.objects using (
  bucket_id = 'fotos-avance'
  and (public.es_admin() or public.tiene_permiso('produccion.ver')
       or public.tiene_permiso('produccion.aprobar_reportes')
       or public.tiene_permiso('produccion.aprobar_sin_orden'))
  and (public.orden_de_ruta(name) is null or public.puede_ver_orden(public.orden_de_ruta(name)))
);

-- Aprobar u observar es un UPDATE: la política lo deja entrar y el disparador
-- de revisión decide si quien lo hace puede dar el visto.
alter policy editar_flota_avances on public.flota_avances
  using (public.es_admin()
         or public.tiene_permiso('produccion.cualquier_area')
         or public.tiene_permiso('produccion.aprobar_reportes')
         or public.tiene_permiso('produccion.aprobar_sin_orden')
         or (registrado_por = public.usuario_actual()
             and (fecha >= current_date - 1 or revision = 'OBSERVADO')
             and public.puede_hoja_de_area(area_id)))
  with check (public.es_admin()
              or public.tiene_permiso('produccion.cualquier_area')
              or public.tiene_permiso('produccion.aprobar_reportes')
              or public.tiene_permiso('produccion.aprobar_sin_orden')
              or (registrado_por = public.usuario_actual() and public.puede_hoja_de_area(area_id)));

-- El disparador de revisión, igual al de la migración 20260929110000 salvo
-- `v_aprueba`.
create or replace function public.fn_reporte_revision()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  -- Gerencia aprueba solo los trabajos sin orden (migración 20261020160000):
  -- su permiso vale en la tabla de esos reportes y en ninguna otra.
  v_aprueba   constant boolean := public.es_admin() or public.tiene_permiso('produccion.aprobar_reportes')
                                  or (tg_table_name = 'flota_avances'
                                      and public.tiene_permiso('produccion.aprobar_sin_orden'));
  v_ignorar   constant text[] := array['revision', 'revisado_por', 'revisado_en', 'observacion',
                                       'corregido_en', 'actualizado_en'];
  v_revisa    boolean;
  v_corrige   boolean;
begin
  if tg_op = 'INSERT' then
    -- Lo que escribe quien aprueba nace aprobado: no tiene a quién pedirle el
    -- visto. Lo que manda el formulario en estas columnas no vale.
    if v_aprueba then
      new.revision := 'APROBADO';
      new.revisado_por := public.usuario_actual();
      new.revisado_en := now();
    else
      new.revision := 'PENDIENTE';
      new.revisado_por := null;
      new.revisado_en := null;
    end if;
    new.observacion := null;
    new.corregido_en := null;
    return new;
  end if;

  v_revisa  := new.revision is distinct from old.revision
            or new.observacion is distinct from old.observacion;
  v_corrige := (to_jsonb(new) - v_ignorar) is distinct from (to_jsonb(old) - v_ignorar);

  if v_revisa then
    if not v_aprueba then
      raise exception 'Administración revisa los reportes de Supervisión.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.revision = 'PENDIENTE' then
      new.revisado_por := null;
      new.revisado_en := null;
    else
      new.revisado_por := public.usuario_actual();
      new.revisado_en := now();
    end if;
  else
    new.revisado_por := old.revisado_por;
    new.revisado_en := old.revisado_en;
  end if;

  if v_corrige then
    -- Aprobado queda firme. Solo quien aprueba lo puede tocar: el visto es suyo.
    if old.revision = 'APROBADO' and not v_aprueba then
      raise exception 'Ese reporte ya fue aprobado: queda como está.'
        using errcode = 'check_violation';
    end if;
    -- En el avance con foto de la orden, el porcentaje mueve la etapa y eso
    -- pasa solo al registrarlo (fn_avance_mueve_etapa): corregirlo aquí dejaría
    -- la etapa diciendo otra cosa. El porcentaje bueno va en un avance nuevo.
    if tg_table_name = 'ot_avances'
       and ((to_jsonb(new) -> 'avance_porcentaje') is distinct from (to_jsonb(old) -> 'avance_porcentaje')
            or (to_jsonb(new) -> 'etapa_id') is distinct from (to_jsonb(old) -> 'etapa_id')) then
      raise exception 'El porcentaje de la etapa no se corrige: registra un avance nuevo con el que va.'
        using errcode = 'check_violation';
    end if;
    new.corregido_en := now();
    -- Corregido un observado, vuelve a pedir el visto: el jefe tiene que ver
    -- lo nuevo. La observación se queda como historia.
    if not v_revisa and old.revision = 'OBSERVADO' then
      new.revision := 'PENDIENTE';
      new.revisado_por := null;
      new.revisado_en := null;
    end if;
  else
    new.corregido_en := old.corregido_en;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- LO APROBADO QUEDA FIRME, TAMBIÉN PARA QUIEN APRUEBA
-- -----------------------------------------------------------------------------
-- Desde la 099, quien aprueba reportes podía borrar cualquiera, aprobado o no,
-- con sus fotos y sin vuelta atrás. Con más puestos aprobando, eso dejaba a
-- varios borrando la evidencia que otro ya firmó con «Aprobado». Desde aquí,
-- el reporte aprobado solo lo quita el administrador; mientras está pendiente
-- u observado, lo borra quien aprueba o su autor, como antes.
-- -----------------------------------------------------------------------------
alter policy borrar_flota_avances on public.flota_avances
  using (public.es_admin()
         or (revision <> 'APROBADO'
             and (public.tiene_permiso('produccion.aprobar_reportes')
                  or public.tiene_permiso('produccion.aprobar_sin_orden')
                  or registrado_por = public.usuario_actual())));

alter policy borrar_ot_avances on public.ot_avances
  using (public.es_admin()
         or (revision <> 'APROBADO'
             and (public.tiene_permiso('produccion.aprobar_reportes') or registrado_por = public.usuario_actual())));

alter policy borrar_ot_actividad_avances on public.ot_actividad_avances
  using (public.es_admin()
         or (revision <> 'APROBADO'
             and (public.tiene_permiso('produccion.aprobar_reportes') or reportado_por = public.usuario_actual())));
