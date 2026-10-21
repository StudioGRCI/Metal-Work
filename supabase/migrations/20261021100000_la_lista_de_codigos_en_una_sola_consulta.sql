-- La lista de Códigos internos se cortaba por tiempo.
--
-- Desde el 20/10 la pantalla de Gerencia salía con «No se pudo leer el costo de
-- los códigos: canceling statement due to statement timeout» (25 veces, 4
-- personas, en una tarde). No es el volumen: en producción hay 7 unidades y 69
-- movimientos. La misma lectura que se cortaba a los 8 s tardó 16 ms otras veces.
-- Tampoco es la compilación JIT, que en producción está apagada (ninguna
-- consulta compiló una sola función).
--
-- Lo que cuesta es arrancar. La lista pedía cuatro lecturas a la vez (el resumen,
-- las órdenes de servicio, los subcontratos y el costo completo), y la página dos
-- más (Diseño y el avance): seis conexiones al mismo tiempo. Cada conexión nueva
-- de la base carga desde cero todo lo que toca: tablas, índices, políticas,
-- disparadores y el plan de cada función. En producción eso es unas quince veces
-- más lento que en la máquina de pruebas (28 ms contra 1,8 ms para juntar dos
-- tablas). Y el resumen y el costo arman, cada uno por su lado, todas las líneas
-- del costeo de todos los códigos (codigo_interno_lineas), que desde las
-- migraciones 20261020110000 y 20261020120000 tocan además las horas del mes y
-- el sueldo de la oficina. Seis arranques en frío a la vez sobre una base chica
-- se pisan, y quien recargaba la pantalla porque falló sumaba seis más.
--
-- Ahora la pantalla sale de una sola lectura: las seis funciones, una detrás de
-- otra, en la misma conexión. El costo completo vuelve a armar las líneas, pero
-- ya con todo cargado por el resumen (en la máquina de pruebas, 35 ms en frío y
-- 16 ms después). Cada función sigue exigiendo su propio permiso: esta no salta
-- ninguno, por eso no es security definer.
--
-- A tener presente: lo que eran seis sentencias es ahora una, bajo el mismo
-- límite de 8 s. Con 23 000 horas cargadas (en pruebas) tarda 1,5 s; hoy no hay
-- ninguna. Si el tareo crece mucho, lo que sigue es armar las líneas del costeo
-- una sola vez para el resumen y el costo: hoy las horas de cada mes se cuentan
-- seis veces por lectura.

create or replace function public.codigos_internos_lista()
returns jsonb
language sql stable set search_path to 'public' as $$
  select jsonb_build_object(
    'resumen', (select coalesce(jsonb_agg(to_jsonb(r) order by r.ultima_actividad desc nulls last, r.codigo), '[]'::jsonb)
                  from public.codigos_internos_resumen() r),
    'servicios', (select coalesce(jsonb_agg(to_jsonb(s) order by s.codigo), '[]'::jsonb)
                    from public.codigos_internos_servicios() s),
    'subcontratos', (select coalesce(jsonb_agg(to_jsonb(s) order by s.codigo), '[]'::jsonb)
                       from public.codigos_internos_subcontratos() s),
    'costo', (select coalesce(jsonb_agg(to_jsonb(k) order by k.codigo), '[]'::jsonb)
                from public.codigos_internos_costo() k),
    'avance', (select coalesce(jsonb_agg(to_jsonb(a) order by a.codigo), '[]'::jsonb)
                 from public.codigos_internos_avance() a),
    'diseno', (select coalesce(jsonb_agg(to_jsonb(d) order by d.ultimo_cambio desc nulls last, d.codigo), '[]'::jsonb)
                 from public.codigos_internos_de_diseno() d)
  )
$$;
comment on function public.codigos_internos_lista() is
  'La lista de Códigos internos en una sola lectura: lo que devuelven codigos_internos_resumen, codigos_internos_servicios, codigos_internos_subcontratos, codigos_internos_costo, codigos_internos_avance y codigos_internos_de_diseno, cada uno en su arreglo y en su orden. Cada una exige su permiso (todas dejan pasar codigos_internos.ver); pedirlas juntas en la misma conexión evita los seis arranques en frío que cortaban la pantalla por tiempo (migración 20261021100000).';
revoke all on function public.codigos_internos_lista() from public, anon;
grant execute on function public.codigos_internos_lista() to authenticated;
