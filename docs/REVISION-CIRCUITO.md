# Revisión del circuito — 21/09/2026

## Procedimiento vigente

1. Ventas carga el PDF o Word de la cotización, con cliente y carrocería.
2. Gerencia revisa. Si rechaza, Ventas carga una corrección sobre la misma
   cotización; el historial conserva cada versión y su observación.
3. Administración emite la OT desde la cotización aprobada: número del papel,
   identificación de la unidad, fecha comprometida y PDF. La OT nace aprobada.
4. Diseño y Taller preparan planos, piezas, materiales, actividades y plazos.
   Cada área reporta y el responsable revisa. Las etapas deben terminarse u
   omitirse antes de marcar la OT terminada.
5. Administración o Gerencia registra la liberación de tesorería.
6. El responsable con `ordenes.entregar` registra un acta de conformidad.
7. Quien coordina la entrega registra el aviso a portería. La factura es un
   estado administrativo y no sustituye el aviso.

El aviso a portería autoriza la salida. **No hay un registro separado de la
salida física del vehículo.** Se consultó al usuario si desea incorporarlo;
no se infiere ese hecho de una factura o del aviso.

## Fallo reproducido y corrección

La base aceptaba dos actas de una misma OT. La pantalla de salida consulta
una sola con `maybeSingle()`, por lo que el duplicado rompía además la lectura.
La migración `113` agrega `UNIQUE (orden_id)`, comprobando antes que no existan
duplicados. No elimina datos ni cambia permisos. La acción informa del acta
existente si se repite la entrega y verifica el registro devuelto al insertar.

## Revisión de la decisión

| Perspectiva | Objeción y resolución |
| --- | --- |
| Arquitectura | Evitar un segundo mecanismo de entrega: se conserva el acta y se restringe su cardinalidad. |
| Seguridad | Un usuario podría saltarse el botón: la unicidad se aplica en Postgres, con los mismos permisos y RLS. |
| Base de datos | El índice puede bloquear al crearse: no había actas ni duplicados al aplicar; no se borra evidencia para forzar el cambio. |
| Usuario | Un reintento no debe producir otra acta: recibe una indicación de recargar el resumen y consultar la existente. |
| QA | ADMIN ocultaría errores: el ensayo usa seis roles reales con `set local role authenticated`. |

Riesgo aceptado: esta corrección no constituye una verificación completa de
dos solicitudes simultáneas desde el navegador; la restricción única es la
garantía de integridad para ese caso.

## Evidencia y límites

- `scripts/verificar.sh`: tipos de Next, TypeScript y ESLint pasan.
- `herramientas/recorrido/comprobar-circuito.sql`: primero reprodujo el
  duplicado; después pasó con la migración, tanto en ensayo revertido como
  tras aplicarla. También rechaza terminar con etapas abiertas, entregar por
  UPDATE sin acta, liberar como operario y reabrir una OT facturada.
- Cada ensayo termina en `ROLLBACK OK`. Consulta posterior: cero documentos
  de ensayo persistidos.
- Navegador: Ventas accede a la cotización y a los catálogos de carga;
  Administración accede al pendiente, al formulario de emisión y al detalle
  de la OT; el jefe de Producción accede al tablero con los menús de su área.
- Guía desplegable verificada en la vista previa de Vercel. Estados de salida
  pendiente y completada comprobados con ejemplos locales a 400 px, en claro
  y oscuro, sin desbordamiento horizontal ni errores de consola.
- Se corrige el vacío de etapas en órdenes cerradas: el tablero excluye esas
  órdenes, por lo que no corresponde mostrar «0 de 0» ni pedir aprobarlas.
- La carga de cronogramas se oculta en órdenes entregadas, facturadas o anuladas,
  con una explicación visible, de acuerdo con el rechazo existente en la base.
- No se emitió la cotización real ni se subieron documentos ficticios a
  producción. Falta el recorrido de escritura con archivos en un entorno de
  prueba aislado, y la comprobación de todas las pantallas con cada rol.
- Advisors: siguen los avisos de extensiones en public, funciones definer
  ejecutables por authenticated y protección de claves filtradas desactivada.
  La mera presencia de un aviso definer no demuestra acceso indebido. Los
  avisos de índices requieren medición antes de cambiar el esquema.

Para próximas revisiones: probar los reintentos y estados imposibles junto
con el camino correcto permitió encontrar el duplicado que el ensayo inicial
no detectaba.
