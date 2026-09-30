-- Aplicar después de desplegar el formulario que usa despachar_material_con_foto.
-- Se conserva la lectura histórica; las nuevas entregas requieren su evidencia.
revoke execute on function public.despachar_material(uuid,uuid,public.cantidad,uuid)
  from public, anon, authenticated;
