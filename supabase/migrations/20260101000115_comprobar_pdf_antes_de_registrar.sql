-- El servidor comprueba la firma del PDF con la sesión de quien lo cargó,
-- antes de registrar la versión. Solo su autor lee un archivo todavía huérfano.
drop policy if exists planos_leer on storage.objects;
create policy planos_leer on storage.objects for select to authenticated using (
  bucket_id='planos-privados' and (
    exists(select 1 from public.ot_plano_versiones v where v.ruta_storage=name)
    or (owner_id=public.usuario_actual()::text and public.tiene_permiso('diseno.planos')
      and not public.archivo_plano_vinculado(name))
  )
);

-- Los botones por área no bastan: se comprobó que MTZ podía escribir el bloque
-- PRD mediante UPDATE directo. La guarda aplica también a la API y al INSERT.
create or replace function public.fn_pieza_area_y_plano_recibido()
returns trigger language plpgsql security definer set search_path='public' as $$
declare v_codigo text; v_area uuid; v_cambia boolean;
begin
  if tg_op='INSERT' then
    if new.mtz_inicio is not null or new.mtz_habilitado or new.mtz_culminacion is not null or new.mtz_entregado or new.mtz_observacion is not null
      or new.prd_recepcion is not null or new.prd_recibido or new.prd_inicio is not null or new.prd_armado or new.prd_observacion is not null then
      raise exception 'Crea la pieza sin avance. Cada área reporta después de recibir el plano.';
    end if;
    return new;
  end if;
  foreach v_codigo in array array['MTZ','PRD'] loop
    v_cambia:=case when v_codigo='MTZ' then
      (new.mtz_inicio,new.mtz_habilitado,new.mtz_culminacion,new.mtz_entregado,new.mtz_observacion)
        is distinct from (old.mtz_inicio,old.mtz_habilitado,old.mtz_culminacion,old.mtz_entregado,old.mtz_observacion)
      else (new.prd_recepcion,new.prd_recibido,new.prd_inicio,new.prd_armado,new.prd_observacion)
        is distinct from (old.prd_recepcion,old.prd_recibido,old.prd_inicio,old.prd_armado,old.prd_observacion) end;
    if v_cambia then
      select id into v_area from public.areas where codigo=v_codigo;
      if not public.tiene_permiso('produccion.registrar') or not public.puede_hoja_de_area(v_area) then
        raise exception 'Solo el área correspondiente puede modificar este bloque de la pieza.' using errcode='42501';
      end if;
      if not exists(select 1 from public.ot_plano_versiones where plano_id=new.plano_id and area_id=v_area and vigente and estado='RECIBIDO') then
        raise exception 'El responsable del área debe recibir el plano aprobado antes de reportar sus piezas.';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.fn_pieza_area_y_plano_recibido() from public,anon,authenticated;
drop trigger if exists trg_pieza_area_y_plano_recibido on public.ot_piezas;
create trigger trg_pieza_area_y_plano_recibido before insert or update on public.ot_piezas
for each row execute function public.fn_pieza_area_y_plano_recibido();
