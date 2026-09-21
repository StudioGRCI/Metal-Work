# Planos por OT, revisión y recepción

Implementado el 21/09/2026. Los originales CAD siguen en el archivo de Diseño.
El sistema conserva copias PDF privadas y relaciona cada revisión con el plano
existente de Cumplimiento y su área destinataria. No se importaron documentos
ni enlaces anónimos de OneDrive: su acceso externo no lo puede controlar RLS.

## Circuito

1. Diseño crea el plano y las piezas en Cumplimiento.
2. En Planos y revisiones selecciona plano, área y PDF (hasta 20 MB).
3. Gerencia o Jefatura de Producción revisa el archivo. Quien lo cargó no lo
   puede aprobar, aunque también tenga permiso de revisión.
4. Si se observa, Diseño carga una nueva revisión. La anterior se conserva.
5. Si se aprueba, el área destinataria ve el archivo. Su responsable confirma
   recepción. Cargar una corrección no retira el PDF vigente: aprobarla sí.
6. Cada área reporta su bloque de piezas después de recibir el PDF vigente.
   Se conserva además la fecha de entrega de Diseño que exige Cumplimiento.

## Alcance

| Usuario | Acceso |
| --- | --- |
| Diseño | Carga y consulta versiones, observaciones y recepciones. |
| Gerencia / Jefatura de Producción | Revisa versiones de otra persona. |
| Responsables con `produccion.cualquier_area` | Consulta aprobados de las áreas bajo su coordinación. |
| Usuario de un área | Consulta aprobados destinados a su área. |
| Responsable con `produccion.actividades` | Confirma recepción para su área. |
| Ventas / Administración | No consulta planos, piezas ni PDF técnicos. |
| Sin sesión | Sin acceso a tablas, funciones y archivos. |

La asignación es por área; no es asignación individual a una cuadrilla ni una
revisión global de permisos de todos los módulos. Almacén, Requerimientos y
Calidad pueden ser destinatarios de lectura; la recepción requiere el permiso
del responsable, que no se otorga automáticamente por pertenecer al área.

## Seguridad y decisiones

- Arquitectura: se reutilizan `ot_planos` y `ot_piezas`; cada versión tiene una
  sola área destinataria para que recepción y responsabilidad sean inequívocas.
  Entregar el mismo PDF a dos áreas genera registros independientes.
- Atacante: ocultar botones no protege. RLS filtra versiones, planos, piezas y
  Storage. La ruta de descarga vuelve a exigir sesión, OT y versión permitidas.
  No se envían enlaces firmados desde la pantalla; las descargas no se cachean.
- DBA: RPC con bloqueo del plano serializa revisiones; índice único evita dos
  vigentes por plano/área. No hay UPDATE/DELETE directo para authenticated.
  No se borran versiones; la limpieza de Storage solo permite huérfanos propios.
- Usuario: distingue pendiente de revisión, observado, vigente, recibido y
  anterior. La recepción no se infiere de abrir o descargar un archivo.
- QA: ensayo con `authenticated`, roles reales y rollback. Reprodujo que MTZ
  podía escribir el bloque PRD; la migración 115 cierra esa escritura.

## Verificación

`scripts/verificar.sh` pasa. Para comprobar el circuito SQL se inserta el bloque
`herramientas/recorrido/comprobar-planos.sql` al comienzo del paso 4 de
`comprobar-circuito.sql`. El resultado esperado es la excepción `ROLLBACK OK`.
Nunca retirar esa excepción. Los objetos Storage de esa prueba son metadatos
transitorios: no se suben archivos al servicio.

Comprobado: carga idempotente de metadatos; revisión y recepción; invisibilidad
de borradores y de otra área en tablas, vistas y Storage; rechazo de escritura
directa, recepción ajena y borrado; escritura válida de MTZ y rechazo del bloque
PRD. Advisors revisados: las nuevas funciones definer son intencionales y tienen
guardas internas. Las FK de autor/revisor/receptor no llevan índices adicionales:
no hay consultas por esas columnas ni borrado de usuarios en este circuito.

Límite: el ensayo SQL no prueba el transporte de un PDF real ni una revisión de
ingeniería. La verificación visual con datos ficticios comprueba presentación,
no certifica cotas, materiales ni seguridad estructural del diseño.
