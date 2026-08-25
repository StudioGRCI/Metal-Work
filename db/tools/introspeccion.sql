-- Vuelca el esquema public como un único JSON, para que scripts/generar-tipos.mjs
-- produzca src/types/database.ts sin depender de Docker ni de servicios externos.

create or replace function pg_temp.tipo_ts(p_oid oid)
returns text
language plpgsql
stable
as $$
declare r record;
begin
  select t.typtype, t.typname, t.typbasetype, t.typelem, t.typcategory, n.nspname
    into r
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where t.oid = p_oid;

  if r.typcategory = 'A' and r.typelem <> 0 then
    return pg_temp.tipo_ts(r.typelem) || '[]';
  end if;

  -- Los dominios del proyecto (monto, cantidad, placa...) se exponen como su tipo base.
  if r.typtype = 'd' then
    return pg_temp.tipo_ts(r.typbasetype);
  end if;

  if r.typtype = 'e' then
    return 'enum:' || r.typname;
  end if;

  return case r.typname
    when 'bool' then 'boolean'
    when 'int2' then 'number'
    when 'int4' then 'number'
    when 'int8' then 'number'
    when 'float4' then 'number'
    when 'float8' then 'number'
    when 'numeric' then 'number'
    when 'json' then 'Json'
    when 'jsonb' then 'Json'
    else 'string'
  end;
end;
$$;

select json_build_object(
  'tablas', (
    select coalesce(json_agg(x order by x->>'nombre'), '[]'::json) from (
      select json_build_object(
        'nombre', c.relname,
        'tipo', case c.relkind when 'v' then 'vista' when 'm' then 'vista' else 'tabla' end,
        'columnas', (
          select json_agg(json_build_object(
            'nombre', a.attname,
            'tipo', pg_temp.tipo_ts(a.atttypid),
            'nullable', not a.attnotnull,
            -- Una columna con default, identidad o generada puede omitirse al insertar.
            'opcional_insert', (a.atthasdef or a.attidentity <> '' or a.attgenerated <> ''),
            'generada', a.attgenerated <> ''
          ) order by a.attnum)
          from pg_attribute a
          where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
        ),
        'relaciones', (
          select coalesce(json_agg(json_build_object(
            'nombre', con.conname,
            'columnas', (
              select json_agg(att.attname order by u.ord)
              from unnest(con.conkey) with ordinality as u(attnum, ord)
              join pg_attribute att on att.attrelid = con.conrelid and att.attnum = u.attnum
            ),
            'tabla_referida', cf.relname,
            'columnas_referidas', (
              select json_agg(attf.attname order by uf.ord)
              from unnest(con.confkey) with ordinality as uf(attnum, ord)
              join pg_attribute attf on attf.attrelid = con.confrelid and attf.attnum = uf.attnum
            ),
            -- Es uno a uno si las columnas de origen forman por sí solas un índice único.
            'uno_a_uno', exists (
              select 1 from pg_index i
               where i.indrelid = con.conrelid and i.indisunique
                 and i.indnatts = array_length(con.conkey, 1)
                 and i.indkey::int2[] @> con.conkey and con.conkey @> i.indkey::int2[]
            )
          ) order by con.conname), '[]'::json)
          from pg_constraint con
          join pg_class cf on cf.oid = con.confrelid
          where con.conrelid = c.oid and con.contype = 'f'
        )
      ) as x
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind in ('r', 'v', 'm', 'p')
        and c.relname not like 'pg_%'
    ) t
  ),
  'enums', (
    select coalesce(json_agg(json_build_object(
      'nombre', t.typname,
      'valores', (select json_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid = t.oid)
    ) order by t.typname), '[]'::json)
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typtype = 'e'
  ),
  'funciones', (
    select coalesce(json_agg(json_build_object(
      'nombre', p.proname,
      'argumentos', (
        select coalesce(json_agg(json_build_object(
          'nombre', coalesce(p.proargnames[u.ord], 'arg' || u.ord),
          'tipo', pg_temp.tipo_ts(u.oid),
          'opcional', u.ord > (p.pronargs - p.pronargdefaults)
        ) order by u.ord), '[]'::json)
        from unnest(p.proargtypes) with ordinality as u(oid, ord)
      ),
      'retorna', pg_temp.tipo_ts(p.prorettype),
      'retorna_conjunto', p.proretset
    ) order by p.proname), '[]'::json)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      -- Se excluyen las funciones que solo existen para los triggers.
      and p.prorettype <> 'trigger'::regtype::oid
      -- y las que instalan las extensiones (pg_trgm, unaccent, pgcrypto):
      -- no forman parte de la API del proyecto.
      and not exists (
        select 1 from pg_depend d
         where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
      )
  )
) as esquema \gset

\echo :esquema
