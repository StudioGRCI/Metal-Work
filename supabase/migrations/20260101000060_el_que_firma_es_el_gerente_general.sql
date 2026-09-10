-- =============================================================================
-- EL QUE FIRMA LA COTIZACIÓN ES EL GERENTE GENERAL
-- -----------------------------------------------------------------------------
-- El papel cerraba con «Atentamente,» y el nombre del vendedor, porque este
-- sistema dio por hecho que quien atiende es quien firma. La empresa lo
-- corrigió: el vendedor sale como vendedor —es un dato, no una rúbrica— y el
-- único que firma una cotización es el gerente general.
--
-- Se guarda quién es, en la ficha de la empresa, y no se adivina al imprimir.
-- Adivinarlo —«el usuario con rol GERENTE»— funcionaría hoy, que hay uno solo,
-- y el día que entre un segundo gerente el papel saldría firmado por quien
-- tocara en el orden de la consulta. Un documento que sale del taller con el
-- nombre equivocado debajo de «Atentamente» no se arregla después.
-- =============================================================================

alter table public.empresa
  add column if not exists gerente_general_id uuid references public.usuarios(id) on delete set null;

comment on column public.empresa.gerente_general_id is
  'Quien firma las cotizaciones. Es una elección, no una deducción del rol: con dos gerentes, deducirlo firmaría con el que tocara.';

-- Se deja puesto el que hay. Si mañana hay dos, esto ya no lo toca nadie: la
-- condición exige que sea el único.
update public.empresa e
   set gerente_general_id = (
     select u.id
       from public.usuarios u
       join public.roles r on r.id = u.rol_id
      where u.activo and r.codigo = 'GERENTE'
   )
 where e.gerente_general_id is null
   and (select count(*)
          from public.usuarios u
          join public.roles r on r.id = u.rol_id
         where u.activo and r.codigo = 'GERENTE') = 1;
