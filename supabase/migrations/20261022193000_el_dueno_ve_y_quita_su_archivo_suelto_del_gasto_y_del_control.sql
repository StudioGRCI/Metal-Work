-- El dueño ve y quita su archivo suelto en `gastos-ot` y `control-ot`.
--
-- El comprobante de un gasto del área y el escaneo del control vehicular se
-- suben antes de anotarlos. Si la subida llega a Storage y la respuesta no
-- (un corte, un 504 de la pasarela), la pantalla lo quita en el acto
-- (`subirARutaNueva`): esa ruta no la nombra ninguna fila y nadie lo
-- encontraría después. Aquí no lo quitaba. La política de borrar sí lo deja
-- (el dueño, mientras ninguna fila lo nombra), pero Postgres aplica también la
-- de leer a las filas que un DELETE con WHERE o RETURNING tiene que leer, y la
-- de leer pedía que una fila lo nombrara: el borrado afectaba cero filas, sin
-- error. El gasto, cuya ruta es la de su id, chocaba después con «Ese archivo
-- ya estaba subido» en cada reintento, y el PDF quedaba suelto para siempre
-- (duodécima pasada del PR #148).
--
-- Igual que en las demás cubetas: el dueño ve lo suyo mientras ninguna fila lo
-- nombra. Va como una política más, no reemplazando la de leer, y se crea solo
-- si falta: se puede pegar dos veces.
--
-- «Ninguna fila lo nombra» se pregunta sin la seguridad por fila, como
-- `archivo_plano_vinculado` en los planos. Con un `not exists` en la política,
-- la fila que el dueño ya no ve (cambió de área, o la OT dejó de estar a su
-- alcance) contaría como que no existe: vería su comprobante anotado y,
-- con la política de borrar, lo podría quitar.

create or replace function public.comprobante_de_gasto_anotado(p_ruta text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.ot_gastos_areas where comprobante_ruta = p_ruta);
$$;
comment on function public.comprobante_de_gasto_anotado(text) is
  'Si algún gasto del área nombra ese archivo de gastos-ot, lo vea o no quien pregunta (migración 20261022193000).';
revoke all on function public.comprobante_de_gasto_anotado(text) from public, anon;
grant execute on function public.comprobante_de_gasto_anotado(text) to authenticated;

create or replace function public.escaneo_de_control_anotado(p_ruta text)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.ot_control_vehicular where escaneo_ruta = p_ruta);
$$;
comment on function public.escaneo_de_control_anotado(text) is
  'Si alguna ficha de control vehicular nombra ese archivo de control-ot, la vea o no quien pregunta (migración 20261022193000).';
revoke all on function public.escaneo_de_control_anotado(text) from public, anon;
grant execute on function public.escaneo_de_control_anotado(text) to authenticated;

-- Se vuelven a crear al pegar otra vez: una que se cambió a mano queda como aquí.
drop policy if exists mw_leer_gastos_ot_suelto_propio on storage.objects;
create policy mw_leer_gastos_ot_suelto_propio on storage.objects for select to authenticated using (
  bucket_id = 'gastos-ot'
  and owner_id = (select auth.uid())::text
  and not public.comprobante_de_gasto_anotado(name)
);
drop policy if exists mw_leer_control_ot_suelto_propio on storage.objects;
create policy mw_leer_control_ot_suelto_propio on storage.objects for select to authenticated using (
  bucket_id = 'control-ot'
  and owner_id = (select auth.uid())::text
  and not public.escaneo_de_control_anotado(name)
);
