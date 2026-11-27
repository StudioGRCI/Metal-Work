-- =============================================================================
-- LOS TRÁMITES AVISAN SOLOS
-- -----------------------------------------------------------------------------
-- Plan «El puesto de Tramitador», entrega 3 de 4. DKS pidió, además del
-- registro y del expediente, «que le notifique cuando vence algo o cuando fue
-- agregar». El plan aprobado lo dejó así: el Tramitador recibe aviso cuando se
-- agrega un trámite (lo pida otro puesto o lo cree el sistema) y cuando uno
-- está por vencer; lo vencido también le llega a Gerencia. Con la decisión
-- «Días propios por tipo»: cada tipo del catálogo trae sus días de aviso (30,
-- 15 y 7 para lo que se renueva, 5 para lo demás) y el Tramitador los ajusta.
--
--   · El trámite nuevo avisa en el acto a quien lleva los trámites, salvo a
--     quien lo registró: hoy, al otro Tramitador; en la entrega 4, cuando la
--     OT cree su trámite sola, al Tramitador.
--   · Una revisión diaria a las 7:00 a. m. de Lima, en día laborable, mira dos
--     fechas: la fecha límite del trámite que se lleva, y hasta cuándo vale el
--     documento del concluido que se renueva (el SOAT, la revisión técnica).
--     Al llegar a cada uno de los días de aviso de su tipo avisa una vez al
--     Tramitador («Vence en 7 días»); el día que la fecha límite pasa, avisa
--     una vez al Tramitador y a Gerencia (la vigencia vencida, solo al
--     Tramitador hasta la entrega 4). No es un aviso diario: cada uno queda
--     anotado y no se repite. Si la fecha cambia, se avisa por la fecha nueva.
--   · Si la revisión no corrió un día (feriado, domingo), al día siguiente da
--     solo el aviso que corresponde a ese día, no los que se pasaron.
--
-- Los días son corridos, como los cuenta la entidad: «vence el 15» es el 15.
-- El trámite que espera el visto de Gerencia para anularse no avisa.
-- =============================================================================

-- 1. Lo que ya se avisó -------------------------------------------------------------
create table if not exists public.tramite_avisos (
  id             uuid primary key default gen_random_uuid(),
  -- Vacío en la anotación de cada revisión, que no es de un trámite.
  tramite_id     uuid constraint tramite_avisos_tramite_id_fkey references public.tramites(id) on delete restrict,
  tipo           text not null,
  -- La fecha que se avisó (límite o vigencia): si cambia, se avisa de nuevo.
  fecha          date,
  -- En POR_VENCER y POR_RENOVAR, el día de aviso del tipo que se cumplió.
  dias           integer,
  -- El día de la revisión que lo dio.
  dia_revision   date not null,
  avisados       integer not null default 0,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  constraint ck_tramite_aviso_tipo check (tipo in ('POR_VENCER', 'VENCIDO', 'POR_RENOVAR', 'VIGENCIA_VENCIDA', 'REVISION')),
  constraint ck_tramite_aviso_forma check (
    (tipo = 'REVISION' and tramite_id is null and fecha is null and dias is null)
    or (tipo in ('POR_VENCER', 'POR_RENOVAR') and tramite_id is not null and fecha is not null and dias is not null)
    or (tipo in ('VENCIDO', 'VIGENCIA_VENCIDA') and tramite_id is not null and fecha is not null and dias is null))
);
comment on table public.tramite_avisos is
  'Cada aviso de vencimiento de un trámite que salió (de qué trámite, de qué tipo, por qué fecha y por cuál de los días de aviso de su tipo, a cuántas cuentas) y cada revisión diaria que corrió (REVISION). Lo escribe solo la revisión diaria. Migración 20261127003000.';

-- Uno por trámite, tipo, fecha y día de aviso; una anotación por día de
-- revisión. Así la revisión se puede correr dos veces sin repetir.
create unique index if not exists uq_tramite_aviso_unico
  on public.tramite_avisos (tramite_id, tipo, fecha, coalesce(dias, -1)) where tipo <> 'REVISION';
create unique index if not exists uq_tramite_aviso_revision
  on public.tramite_avisos (dia_revision) where tipo = 'REVISION';
-- La llave hacia el trámite, con índice pleno: el único que empieza por ella
-- es parcial y la integridad no lo puede usar (check 190). Cumple (a) y (b):
-- no hay otro índice pleno que empiece por la columna, y la revisión busca
-- por trámite.
create index if not exists ix_tramite_avisos_tramite on public.tramite_avisos (tramite_id);

alter table public.tramite_avisos enable row level security;
revoke all on public.tramite_avisos from public, anon, authenticated;
grant select on public.tramite_avisos to authenticated;
-- Lo lee quien ve todos los trámites. Nadie escribe: solo la revisión.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tramite_avisos'
                    and policyname = 'ver_tramite_avisos') then
    create policy ver_tramite_avisos on public.tramite_avisos for select to authenticated
      using ((select public.tramites_ve_todos()));
  end if;
end $$;

do $$ begin
  perform public.activar_timestamps('tramite_avisos');
  perform public.activar_registro_de_prueba('tramite_avisos');
end $$;

-- 2. De qué trámite habla un aviso ------------------------------------------------
-- «Tarjeta de propiedad · ABC-123 · CLIENTE SAC: Tarjeta de la unidad», o
-- «SOAT · de la empresa: SOAT de la camioneta». La razón social, en mayúsculas.
create or replace function public.tramite_en_texto(p_tramite uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select left(t.tipo_nombre
              || case when t.ambito = 'EMPRESA' then ' · de la empresa'
                      else coalesce(' · ' || nullif(u.placa::text, ''), coalesce(' · ' || u.codigo_interno::text, ''))
                           || coalesce(' · ' || upper(c.razon_social::text), '') end
              || ': ' || t.asunto, 400)
    from public.tramites t
    left join public.unidades u on u.id = t.unidad_id
    left join public.clientes c on c.id = t.cliente_id
   where t.id = p_tramite
$$;
comment on function public.tramite_en_texto(uuid) is
  'El trámite dicho en una línea para un aviso: su tipo, la placa (o el código) y el cliente de la unidad, o «de la empresa», y qué se tramita. Ayudante interno de los avisos.';
revoke all on function public.tramite_en_texto(uuid) from public, anon, authenticated;

-- 3. El trámite nuevo -------------------------------------------------------------
-- A quien lleva los trámites, salvo a quien lo registró (`avisar_a_permiso`).
-- Quién lo registró va con su puesto: en la entrega 4 lo registrará el sistema.
create or replace function public.fn_tramite_avisa_al_registrarse()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  v_quien text;
begin
  select btrim(u.nombres || ' ' || u.apellidos) || coalesce(' (' || r.nombre || ')', '')
    into v_quien
    from public.usuarios u left join public.roles r on r.id = u.rol_id
   where u.id = new.registrado_por;
  perform public.avisar_a_permiso(
    'tramites.gestionar',
    'Trámite nuevo: ' || new.numero,
    public.tramite_en_texto(new.id)
      || coalesce('. Lo registró ' || v_quien, '')
      || case when new.fecha_limite is not null then '. Fecha límite: ' || to_char(new.fecha_limite, 'DD/MM/YYYY') else '' end
      || '.',
    '/tramites/' || new.id, 'tramites', new.id);
  return null;
end;
$$;
comment on function public.fn_tramite_avisa_al_registrarse() is
  'Al registrarse un trámite, avisa a quien tiene tramites.gestionar, salvo a quien lo registró. Migración 20261127003000.';
revoke all on function public.fn_tramite_avisa_al_registrarse() from public, anon, authenticated;

create or replace trigger trg_tramite_avisa_al_registrarse
  after insert on public.tramites
  for each row execute function public.fn_tramite_avisa_al_registrarse();

-- 4. A quién le llega un vencimiento --------------------------------------------
-- A quien lleva los trámites; si `p_gerencia`, también a quien aprueba sus
-- anulaciones (Gerencia General). Sin el administrador: no los lleva. Con la
-- hora de cada aviso, para que la campana los ordene como salieron.
create or replace function public.avisar_tramite(p_tramite uuid, p_titulo text, p_cuerpo text, p_gerencia boolean)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare
  v_filas integer;
begin
  insert into public.notificaciones (usuario_id, titulo, cuerpo, ruta, origen_tabla, origen_id, creado_en)
  select u.id, left(p_titulo, 200), left(p_cuerpo, 500), '/tramites/' || p_tramite, 'tramites', p_tramite, clock_timestamp()
    from public.usuarios u
   where u.activo
     and exists (select 1 from public.roles_permisos rp
                  where rp.rol_id = u.rol_id
                    and (rp.permiso_codigo = 'tramites.gestionar'
                         or (p_gerencia and rp.permiso_codigo = 'tramites.aprobar_anulacion')));
  get diagnostics v_filas = row_count;
  return v_filas;
end;
$$;
comment on function public.avisar_tramite(uuid, text, text, boolean) is
  'Deja el aviso de un trámite a quien los lleva y, si se pide, a Gerencia (quien aprueba sus anulaciones). La llama solo la revisión diaria.';
revoke all on function public.avisar_tramite(uuid, text, text, boolean) from public, anon, authenticated;

-- 5. La revisión diaria -----------------------------------------------------------
-- `p_hoy` es el día de la revisión (por omisión, hoy en Lima). Los checks lo
-- usan para probar sin esperar.
--
-- Por cada trámite y su fecha (la límite mientras se lleva; la vigencia del
-- concluido que se renueva): con `d` días por delante, el día de aviso que
-- toca es el menor de su tipo que sea `>= d`. Si ya salió, nada; si no, sale.
-- Así, con 30, 15 y 7: a los 30 días avisa el de 30, a los 15 el de 15; y si la
-- revisión no corrió unos días y encuentra 5 por delante, da solo el de 7.
-- Con la fecha pasada, un solo aviso de vencido; el de la fecha límite, también a Gerencia.
--
-- Límite conocido hasta la entrega 4: la revisión no sabe todavía qué trámite
-- renueva a cuál. Si el SOAT se renueva con un TR nuevo, el concluido viejo
-- sigue avisando por su vigencia al Tramitador. Por eso la vigencia vencida no
-- va a Gerencia todavía, y el documento cargado ya vencido no avisa. La
-- entrega 4 enlaza la renovación con el trámite que renueva y lo saca de aquí.
create or replace function public.revisar_tramites(p_hoy date default null)
returns table (tipo text, avisos integer, cuentas integer)
language plpgsql security definer set search_path to 'public' as $$
#variable_conflict use_column
declare
  v_hoy constant date := coalesce(p_hoy, (now() at time zone 'America/Lima')::date);
  r record;
  v_dia integer;
  v_cuentas integer;
  v_titulo text;
  v_cuerpo text;
  v_por_vencer integer := 0;  v_c_por_vencer integer := 0;
  v_vencidos integer := 0;    v_c_vencidos integer := 0;
  v_renovar integer := 0;     v_c_renovar integer := 0;
  v_vigencias integer := 0;   v_c_vigencias integer := 0;
  v_hay_tramitador boolean;
begin
  -- Dos corridas a la vez (la de pg_cron y una a mano) no se duplican: la
  -- segunda espera a la primera y ya encuentra todo anotado.
  perform pg_advisory_xact_lock(hashtext('revisar_tramites'));

  insert into public.tramite_avisos (tramite_id, tipo, fecha, dias, dia_revision, avisados)
  values (null, 'REVISION', null, null, v_hoy, 0)
  on conflict (dia_revision) where tipo = 'REVISION' do update set actualizado_en = now();

  -- Solo en día laborable: lo que cae el domingo o el feriado sale el día siguiente.
  if not public.es_laborable(v_hoy) then
    return query values ('POR_VENCER', 0, 0), ('VENCIDO', 0, 0), ('POR_RENOVAR', 0, 0), ('VIGENCIA_VENCIDA', 0, 0);
    return;
  end if;

  -- Sin ningún Tramitador activo ese día (quien atiende el aviso), el aviso
  -- no se anota: si se anotara, no le llegaría nunca, sin que nada lo dijera. Sale
  -- en la primera revisión en que haya a quién.
  select exists (select 1 from public.usuarios u join public.roles_permisos rp on rp.rol_id = u.rol_id
                  where u.activo and rp.permiso_codigo = 'tramites.gestionar')
    into v_hay_tramitador;

  for r in
    select t.id, t.numero, x.que, x.fecha, x.fecha - v_hoy as d, tt.dias_aviso
      from public.tramites t
      join public.tramite_tipos tt on tt.id = t.tipo_id
      cross join lateral (
        select 'LIMITE'::text as que, t.fecha_limite as fecha
         where t.estado in ('POR_INICIAR', 'EN_TRAMITE', 'OBSERVADO') and t.fecha_limite is not null
        union all
        select 'VIGENCIA', t.vigente_hasta
         where t.estado = 'CONCLUIDO' and t.se_renueva and t.vigente_hasta is not null
           -- El documento de antes que se carga ya vencido es historia: no avisa.
           and t.vigente_hasta >= (t.concluido_en at time zone 'America/Lima')::date
      ) x
     where not (t.anulacion_pedida_en is not null and t.anulacion_rechazada_en is null)
       -- Lo de un lote de prueba no avisa a nadie ni deja filas que impidan limpiarlo.
       and not exists (select 1 from public.pruebas_filas f where f.tabla = 'tramites' and f.fila_id = t.id)
     -- Lo más lejano primero: la campana muestra lo último arriba, y así lo
     -- vencido queda a la vista aunque la corrida sea larga.
     order by x.fecha desc, t.numero desc
  loop
    if r.d < 0 then
      -- Venció: una vez; el de la fecha límite, también a Gerencia.
      -- Sin Tramitador activo espera: quien lo atiende es él.
      continue when not v_hay_tramitador;
      insert into public.tramite_avisos (tramite_id, tipo, fecha, dias, dia_revision)
      values (r.id, case r.que when 'LIMITE' then 'VENCIDO' else 'VIGENCIA_VENCIDA' end, r.fecha, null, v_hoy)
      on conflict do nothing;
      continue when not found;
      if r.que = 'LIMITE' then
        v_titulo := 'Venció el trámite ' || r.numero;
        v_cuerpo := public.tramite_en_texto(r.id) || '. Su fecha límite era el ' || to_char(r.fecha, 'DD/MM/YYYY') || '.';
      else
        v_titulo := 'Venció ' || r.numero || ': hay que renovarlo';
        v_cuerpo := public.tramite_en_texto(r.id) || '. El documento valía hasta el ' || to_char(r.fecha, 'DD/MM/YYYY') || '.';
      end if;
      -- La vigencia vencida, solo al Tramitador hasta la entrega 4: sin saber
      -- todavía qué trámite renueva a cuál, a Gerencia le llegaría «hay que
      -- renovarlo» de un SOAT ya renovado.
      v_cuentas := public.avisar_tramite(r.id, v_titulo, v_cuerpo, r.que = 'LIMITE');
      update public.tramite_avisos set avisados = v_cuentas
       where tramite_id = r.id and tipo = case r.que when 'LIMITE' then 'VENCIDO' else 'VIGENCIA_VENCIDA' end
         and fecha = r.fecha and dias is null;
      if r.que = 'LIMITE' then v_vencidos := v_vencidos + 1; v_c_vencidos := v_c_vencidos + v_cuentas;
      else v_vigencias := v_vigencias + 1; v_c_vigencias := v_c_vigencias + v_cuentas; end if;
      continue;
    end if;

    -- Por vencer: el menor día de aviso que ya se cumplió.
    select min(a) into v_dia from unnest(r.dias_aviso) a where a >= r.d;
    continue when v_dia is null or not v_hay_tramitador;
    -- Si los días del tipo cambiaron a medio camino, no se manda un día de aviso
    -- mayor que uno que ya salió para esta misma fecha: sería casi repetido.
    continue when exists (select 1 from public.tramite_avisos a
                           where a.tramite_id = r.id and a.fecha = r.fecha and a.dias <= v_dia
                             and a.tipo = case r.que when 'LIMITE' then 'POR_VENCER' else 'POR_RENOVAR' end);
    insert into public.tramite_avisos (tramite_id, tipo, fecha, dias, dia_revision)
    values (r.id, case r.que when 'LIMITE' then 'POR_VENCER' else 'POR_RENOVAR' end, r.fecha, v_dia, v_hoy)
    on conflict do nothing;
    continue when not found;
    v_titulo := case r.que when 'LIMITE' then 'Por vencer: ' else 'Por renovar: ' end || r.numero || ' · '
                || case r.d when 0 then 'vence hoy' when 1 then 'vence mañana' else 'vence en ' || r.d || ' días' end;
    v_cuerpo := public.tramite_en_texto(r.id) || '. '
                || case r.que when 'LIMITE' then 'Su fecha límite es el ' else 'El documento vale hasta el ' end
                || to_char(r.fecha, 'DD/MM/YYYY') || '.';
    v_cuentas := public.avisar_tramite(r.id, v_titulo, v_cuerpo, false);
    update public.tramite_avisos set avisados = v_cuentas
     where tramite_id = r.id and tipo = case r.que when 'LIMITE' then 'POR_VENCER' else 'POR_RENOVAR' end
       and fecha = r.fecha and dias = v_dia;
    if r.que = 'LIMITE' then v_por_vencer := v_por_vencer + 1; v_c_por_vencer := v_c_por_vencer + v_cuentas;
    else v_renovar := v_renovar + 1; v_c_renovar := v_c_renovar + v_cuentas; end if;
  end loop;

  return query values
    ('POR_VENCER', v_por_vencer, v_c_por_vencer),
    ('VENCIDO', v_vencidos, v_c_vencidos),
    ('POR_RENOVAR', v_renovar, v_c_renovar),
    ('VIGENCIA_VENCIDA', v_vigencias, v_c_vigencias);
end;
$$;
comment on function public.revisar_tramites(date) is
  'La revisión diaria de los trámites (7:00 a. m. de Lima, día laborable): por la fecha límite de los que se llevan y por la vigencia de los concluidos que se renuevan, avisa al Tramitador al cumplirse cada día de aviso de su tipo, y al pasar la fecha límite avisa una vez al Tramitador y a Gerencia (la vigencia vencida, solo al Tramitador hasta la entrega 4). No repite: anota cada aviso, y cada corrida, en tramite_avisos. La corre pg_cron; cerrada a la gente.';
revoke all on function public.revisar_tramites(date) from public, anon, authenticated;

-- 6. La hora ------------------------------------------------------------------------
-- pg_cron corre en UTC: las 12:00 UTC son las 7:00 en Lima (sin horario de
-- verano), como la revisión de los tiempos de entrega. Volver a programar con
-- el mismo nombre reemplaza el horario. Donde no hay pg_cron, solo se avisa.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('revisar-tramites', '0 12 * * *', 'select public.revisar_tramites()');
  else
    raise notice 'Sin pg_cron en esta base: la revisión diaria de los trámites no queda programada.';
  end if;
end $$;
