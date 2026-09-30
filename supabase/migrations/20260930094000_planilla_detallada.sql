-- RR. HH. importa únicamente el resumen de Metal Work. El costo de la empresa
-- es ingreso bruto más aporte patronal; descuentos y adelantos no reducen ese costo.
alter table public.planilla_personas
 add column if not exists detalle jsonb,
 add column if not exists origen_hoja text,
 add column if not exists fila_origen integer,
 add column if not exists importacion_id uuid;
create unique index if not exists idx_planilla_fila_origen on public.planilla_personas(planilla_id,origen_hoja,fila_origen) where fila_origen is not null;
-- Consulta real del reintento de importación, no existe índice con esta columna.
create index if not exists idx_planilla_importacion on public.planilla_personas(importacion_id) where importacion_id is not null;

create or replace function public.calcular_detalle_planilla()
returns trigger language plpgsql set search_path='public' as $$
declare v_ingresos numeric; v_descuentos numeric; v_aporte numeric; v_neto numeric;
begin
 if new.detalle is null then return new; end if;
 if jsonb_typeof(new.detalle)<>'object' or jsonb_typeof(new.detalle->'ingresos') is distinct from 'number'
 or jsonb_typeof(new.detalle->'descuentos') is distinct from 'number' or jsonb_typeof(new.detalle->'aporte_empleador') is distinct from 'number'
 or jsonb_typeof(new.detalle->'neto') is distinct from 'number' then raise exception 'El detalle necesita ingresos, descuentos, aporte del empleador y neto.'; end if;
 v_ingresos:=round((new.detalle->>'ingresos')::numeric,2);v_descuentos:=round((new.detalle->>'descuentos')::numeric,2);
 v_aporte:=round((new.detalle->>'aporte_empleador')::numeric,2);v_neto:=round((new.detalle->>'neto')::numeric,2);
 if least(v_ingresos,v_descuentos,v_aporte,v_neto)<0 or greatest(v_ingresos,v_descuentos,v_aporte,v_neto)>999999999
 or abs(v_ingresos-v_descuentos-v_neto)>0.02 then raise exception 'El neto de la planilla no cuadra con ingresos menos descuentos. Revisa el Excel.'; end if;
 new.monto:=v_ingresos+v_aporte;
 return new;
end $$;
revoke all on function public.calcular_detalle_planilla() from public,anon,authenticated;
drop trigger if exists trg_calcular_detalle_planilla on public.planilla_personas;
create trigger trg_calcular_detalle_planilla before insert or update on public.planilla_personas for each row execute function public.calcular_detalle_planilla();

create or replace function public.importar_detalle_planilla(p_id uuid,p_planilla uuid,p_hoja text,p_lineas jsonb)
returns uuid language plpgsql security definer set search_path='public' as $$
declare v_actual jsonb; v_estado text; v_periodo date; v_moneda text; v_meses text[]:=array['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO','JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];
begin
 perform public.exigir_permiso('rrhh.gestionar_planillas');
 if p_id is null or p_hoja is null or p_hoja !~* '^RESUMEN .+ MWP - [0-9]{4}$' or jsonb_typeof(p_lineas) is distinct from 'array'
 then raise exception 'Usa únicamente el resumen MWP de la planilla de Metal Work.'; end if;
 if jsonb_array_length(p_lineas) not between 1 and 300 or octet_length(p_lineas::text)>1000000 then raise exception 'Selecciona entre una y trescientas personas de Metal Work.'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
 select estado,periodo,moneda into v_estado,v_periodo,v_moneda from public.planillas where id=p_planilla for update;
 if not found then raise exception 'La planilla no existe.'; end if;
 if v_moneda<>'PEN' or upper(p_hoja)<>('RESUMEN '||v_meses[extract(month from v_periodo)::integer]||' MWP - '||extract(year from v_periodo)::integer::text)
 then raise exception 'La hoja debe corresponder al mes de esta planilla en soles.'; end if;
 select jsonb_agg(jsonb_build_object('nombre',nombre,'fila',fila_origen,'detalle',detalle) order by fila_origen)
 into v_actual from public.planilla_personas where importacion_id=p_id and planilla_id=p_planilla;
 if v_actual is not null then
   if v_actual=(select jsonb_agg(jsonb_build_object('nombre',btrim(x.nombre),'fila',x.fila,'detalle',x.detalle) order by x.fila) from jsonb_to_recordset(p_lineas)x(nombre text,fila integer,detalle jsonb)) then return p_id; end if;
   raise exception 'La importación ya existe con otros datos. Recarga la planilla.';
 end if;
 if v_estado<>'BORRADOR' then raise exception 'Solo se importa en una planilla en borrador.'; end if;
 if (select count(distinct x.fila) from jsonb_to_recordset(p_lineas)x(fila integer))<>jsonb_array_length(p_lineas)
 or exists(select 1 from jsonb_to_recordset(p_lineas)x(nombre text,fila integer) where length(btrim(coalesce(nombre,''))) not between 3 and 160 or fila is null or fila<1)
 then raise exception 'Revisa nombres y filas; no se pueden repetir.'; end if;
 insert into public.planilla_personas(planilla_id,nombre,monto,detalle,origen_hoja,fila_origen,importacion_id,registrado_por)
 select p_planilla,btrim(x.nombre),0,x.detalle,p_hoja,x.fila,p_id,public.usuario_actual() from jsonb_to_recordset(p_lineas)x(nombre text,fila integer,detalle jsonb);
 return p_id;
end $$;
revoke all on function public.importar_detalle_planilla(uuid,uuid,text,jsonb) from public,anon;
grant execute on function public.importar_detalle_planilla(uuid,uuid,text,jsonb) to authenticated;
