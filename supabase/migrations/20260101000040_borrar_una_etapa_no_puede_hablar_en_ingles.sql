-- =============================================================================
-- BORRAR UNA ETAPA NO PUEDE HABLAR EN INGLÉS
-- -----------------------------------------------------------------------------
-- El avance diario cuelga de la etapa por la pareja (etapa_id, orden_id), y esa
-- llave decía «on delete set null». En una llave de dos columnas, Postgres anula
-- LAS DOS: al replanificar una OT y borrar una etapa intentaría dejar el avance
-- sin orden, y `orden_id` no admite nulos. El borrado revienta con «null value
-- in column "orden_id" violates not-null constraint» —en inglés, del motor, sin
-- que nadie lo pueda leer en el taller— cuando lo que se quería decir era que el
-- avance sobrevive aunque la etapa desaparezca.
--
-- Postgres 17 admite decir cuál de las dos columnas se anula. Se arregla ahora
-- que `ot_avances` está vacía: con partes diarios cargados, cambiar una llave
-- cuesta mucho más.
--
-- Y de paso se cierra un punto ciego. El tablero de Supabase da por indexada
-- `usuarios.area_id` porque existe `ix_usuarios_area`, pero ese índice es
-- PARCIAL (`where activo`): la comprobación de integridad que dispara borrar un
-- área mira a todos los usuarios, también a los inactivos, y no puede usarlo.
-- Es la única llave del esquema que nadie vigila —ni el tablero, que no la ve,
-- ni nosotros, que confiábamos en el tablero—. El parcial se queda: la
-- aplicación lo usa de verdad (147 lecturas).
--
-- No se crea ningún otro índice. Las 19 llaves que el tablero reporta se
-- revisaron una por una contra el plan de ejecución: las de etapa y unidad ya
-- resuelven por índice —`Index Scan using idx_kardex_etapa`, con la segunda
-- columna como filtro—, y el resto apuntan a catálogos acotados o a columnas de
-- «quién firmó» que nadie consulta y cuyo padre esta aplicación no borra nunca.
-- Crearlos sería sumar coste de escritura en las tablas más calientes del taller
-- a cambio de nada, sobre los 219 avisos de «índice sin usar» que ya arrastra.
-- =============================================================================

-- Postgres no admite cambiar la acción de una llave foránea en sitio, y la
-- migración tiene que poder volver a correr: la guarda mira si la llave ya
-- nombra la columna que se anula (`confdelsetcols`), y si ya está, no toca nada.
do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conname  = 'fk_avance_etapa_de_la_orden'
       and conrelid = 'public.ot_avances'::regclass
       and confdelsetcols is null
  ) then
    alter table public.ot_avances
      drop constraint fk_avance_etapa_de_la_orden;

    alter table public.ot_avances
      add constraint fk_avance_etapa_de_la_orden
      foreign key (etapa_id, orden_id)
      references public.ot_etapas (id, orden_id)
      on delete set null (etapa_id);
  end if;
end $$;

comment on constraint fk_avance_etapa_de_la_orden on public.ot_avances is
  'Si se borra la etapa, el avance se queda sin etapa pero no sin orden: por eso el set null nombra solo etapa_id.';

-- ------------------------------------- la llave que el tablero no sabe mirar
create index if not exists idx_usuarios_area_id on public.usuarios (area_id);

comment on index public.idx_usuarios_area_id is
  'Pleno a propósito: ix_usuarios_area es parcial (where activo) y la integridad referencial no puede usarlo.';
