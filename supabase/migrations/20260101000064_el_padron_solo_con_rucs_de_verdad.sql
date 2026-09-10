-- El padrón, solo con RUC de verdad.
--
-- De los seis clientes que había, cinco eran inventados y se notaba: los RUC
-- iban en fila —20512345671, …72, …73, …74— y el sexto era un DNI de relleno.
-- Sirvieron para probar las pantallas.
--
-- Un cliente con RUC falso no es un dato incompleto, es un dato que miente: se
-- le cotiza, se le imprime el papel con ese número y la factura rebota. Y quien
-- entra por primera vez no tiene cómo saber cuál de los seis es de verdad.
--
-- Se queda MENBER INGENIERIA CONSTRUCCION Y SERVICIOS S.R.L., RUC 20526331762,
-- que es el cliente real de la cotización 3668-2026 que pasó la empresa.
--
-- El único contacto cargado era de AGROINDUSTRIAS LA JOYA y se va con ella; el
-- borrado en cascada lo hace la clave foránea.
--
-- Va acotado por número de documento y no por «todos menos uno»: si mañana
-- alguien vuelve a correr esta migración con clientes de verdad cargados, borra
-- exactamente estos cinco y ninguno más.

delete from public.clientes
 where numero_documento in (
   '20512345671',  -- TRANSPORTES ANDINOS S.A.C.
   '20512345672',  -- MINERA CERRO VERDE CONTRATISTAS
   '20512345673',  -- CONSTRUCTORA DEL SUR E.I.R.L.
   '20512345674',  -- AGROINDUSTRIAS LA JOYA S.A.
   '45678912'      -- CARLOS MENDOZA QUISPE
 );
