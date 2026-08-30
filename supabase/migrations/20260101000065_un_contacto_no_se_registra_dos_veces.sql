-- Un contacto no se registra dos veces.
--
-- En producción entraron dos «pepito» del mismo cliente con **1,1 segundos** de
-- diferencia: el mismo formulario enviado dos veces. El botón se deshabilita
-- mientras guarda, pero entre el clic y el repintado cabe otro clic —o un Enter
-- en el campo y después el clic— y cada envío insertaba su fila.
--
-- La pantalla ya no deja mandar dos veces, pero eso es un parche del navegador:
-- la misma acción se puede llamar desde otra pantalla, desde el móvil con la red
-- lenta o desde un reintento. La regla vive acá.
--
-- Dos personas distintas del mismo cliente no se llaman igual; si alguna vez
-- pasa, se distinguen por el cargo, que es lo que sale impreso al lado del
-- nombre. Y el índice normaliza —sin espacios de sobra y sin distinguir
-- mayúsculas— porque «pepito», «Pepito» y «pepito » son la misma persona
-- escrita con distinta prisa.

-- Los dos «pepito» se van enteros, no deduplicados: no eran un contacto de
-- MENBER. Quien los cargó buscaba dar de alta un cliente nuevo, encontró el
-- botón «Nuevo» que estaba al lado del campo «Cliente» —que en este formulario
-- es la persona, no la empresa— y registró lo que creía una empresa como
-- contacto de otra. Los botones ya dicen qué crean.
delete from public.contactos_cliente
 where lower(btrim(nombre)) = 'pepito'
   and cargo is null and telefono is null and correo is null;

-- Y los duplicados que quedaran, si no el índice no se puede crear.
-- Se conserva el más viejo: es el que ya puede estar elegido en una cotización.
delete from public.contactos_cliente c
 where exists (
   select 1 from public.contactos_cliente otro
    where otro.cliente_id = c.cliente_id
      and lower(btrim(otro.nombre)) = lower(btrim(c.nombre))
      and (otro.creado_en < c.creado_en
        or (otro.creado_en = c.creado_en and otro.id < c.id))
 );

create unique index if not exists uq_contacto_por_cliente
  on public.contactos_cliente (cliente_id, lower(btrim(nombre)));

comment on index public.uq_contacto_por_cliente is
  'Un cliente no tiene dos contactos con el mismo nombre. Nació de un doble envío del formulario que registró dos veces la misma persona.';
