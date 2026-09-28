# Accesos del flujo vigente

Los permisos se validan en las acciones del servidor y en las políticas RLS.
La navegación solo oculta módulos: no concede acceso. La cuenta `ADMIN` pasa
por `public.es_admin()`; sus resultados no sirven para probar permisos de los
roles de trabajo.

La base de producción METAL WORK (`usnbwnemfqyjjkzdizgv`) se revisó el
2026-09-27. La migración `20260927234131_retirar_cotizaciones_estructuradas`
se aplicó después del despliegue del código y retiró los permisos del costeo
beta. El esquema y los permisos siguientes se comprobaron en producción.

## Quién hace cada parte

| Puesto | Permisos relevantes | Qué ve o hace |
| --- | --- | --- |
| Vendedor | `cotizaciones.crear`, `cotizaciones.ver_pdf_comercial` | Registra el PDF enviado al cliente y consulta su seguimiento. |
| Gerencia | `cotizaciones.revisar`, `cotizaciones.ver_pdf_comercial` | Aprueba o devuelve la cotización PDF con observaciones. |
| Administración | `cotizaciones.ver_pdf_comercial`, `cotizaciones.liberar_tesoreria`, `ordenes.crear`, `ordenes.editar` | Carga la OT en PDF, emite la OT desde una cotización aprobada y la libera a Tesorería. |
| Diseño e ingeniería | `diseno.planos`, `ordenes.listar`, `ordenes.ver` | Prepara la ficha técnica, guía de planos y desglose de materiales. No consulta importes ni PDF comerciales. |
| Jefe de taller | `ordenes.crear`, `ordenes.editar`, `ordenes.listar`, `ordenes.ver`, `produccion.registrar` | Atiende las órdenes operativas; no ve la cotización comercial. |
| Jefe de producción | `ordenes.listar`, `ordenes.ver`, `produccion.actividades`, `produccion.registrar` | Organiza y revisa el avance del taller. No ve la cotización comercial. |
| Supervisor | `ordenes.listar`, `ordenes.ver`, `produccion.actividades`, `produccion.registrar` | Reporta el avance de su área, limitado por su área asignada. No ve la cotización comercial. |
| Operario | `ordenes.listar`, `ordenes.ver`, `produccion.registrar` | Registra el avance operativo autorizado. No ve la cotización comercial. |

## Visibilidad de documentos

- El PDF de cotización queda en `cotizaciones_pdf`; sus observaciones,
  versiones y liberaciones a Tesorería conservan su historial.
- `cotizaciones.ver_pdf_comercial` permite ver el expediente comercial. La
  política RLS de `tesoreria.ver_documentos` limita Tesorería a documentos ya
  liberados por Administración.
- La OT conserva `cotizacion_pdf_id` para trazar de qué cotización aprobada
  salió. El personal del taller no recibe ese documento ni su importe.
- `ordenes_trabajo` no guarda un monto de cotización. Tesorería consulta por
  separado los documentos liberados.
- La cotización de venta no se arma ni se costea dentro de la aplicación. Se
  carga el documento existente como PDF; el flujo anterior de cotización,
  partidas y pagos se elimina.

## Verificación

La comprobación se ejecutó contra producción después de aplicar la migración,
con `set role authenticated` y perfiles reales:

- Ventas conservó `cotizaciones.crear` y lectura del expediente PDF.
- Jefatura de taller no obtuvo `cotizaciones.ver_pdf_comercial` ni filas de
  `cotizaciones_pdf`.
- La migración quitó las tablas, columnas, tipos y permisos beta; preservó
  `cotizaciones_pdf`, su vista, un registro PDF, y el vínculo PDF de la OT.
- La tabla del bucket `cotizaciones-pdf` sigue disponible; los demás recursos
  del circuito de prueba ya no existen.

Después de aplicar una migración, repetir pruebas con los roles que realizan la
acción. ADMIN no sustituye esa comprobación porque atraviesa RLS por una ruta
privilegiada.
