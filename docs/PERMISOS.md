# Accesos del flujo vigente

Los permisos se validan en las acciones del servidor y en las políticas RLS.
La navegación solo oculta módulos: no concede acceso. La cuenta `ADMIN` pasa
por `public.es_admin()`; sus resultados no sirven para probar permisos de los
roles de trabajo.

La base de producción METAL WORK (`usnbwnemfqyjjkzdizgv`) se revisó el
2026-09-29. La migración `20260928021551_administracion_gestiona_sistema_y_tesoreria`
trasladó Personal y Configuración a Administración y creó el puesto de
Tesorería. Los permisos siguientes se comprobaron en producción.

## Quién hace cada parte

| Puesto | Permisos relevantes | Qué ve o hace |
| --- | --- | --- |
| Vendedor | `cotizaciones.crear`, `cotizaciones.ver_pdf_comercial` | Registra el PDF enviado al cliente y consulta su seguimiento. Al subirlo dice si el monto incluye IGV (`confirmar_igv_cotizacion`). |
| Gerencia | `cotizaciones.revisar`, `cotizaciones.ver_pdf_comercial`, `costos.ver` | Aprueba o devuelve la cotización PDF con observaciones. Ve el costo de cada OT en el tablero, el expediente y la pestaña Costos, sin registrar ni aprobar gastos (migración `20261001090000`). Ve el margen de cada carrocería en soles y sin IGV (`margen_ot`) y confirma si una cotización incluye IGV. Ve el precio del almacén y la merma de cada OT, pero no los fija: esos permisos (`almacen.valorizar`, `diseno.merma`) son solo de Logística y Diseño (migración `20261001120000`). Ve y fija el presupuesto de costo de cada OT (`fijar_presupuesto_ot`, migración `20261001170000`): por defecto el precio sin IGV ÷ 1.15, la utilidad estándar de la casa. Su menú muestra Tablero, Cotización y Órdenes de trabajo. |
| Administración | `cotizaciones.ver_pdf_comercial`, `cotizaciones.liberar_tesoreria`, `ordenes.crear`, `ordenes.editar`, `usuarios.gestionar`, `produccion.aprobar_reportes`, `ordenes.revisar_taller`, `costos.gastos_generales` | Carga la OT en PDF, la libera a Tesorería, administra Personal y revisa reportes y OT abiertas por el taller. Registra los gastos del mes (`/costos/gastos-generales`) y, en la pestaña Costos de la OT, los trámites de placas y la comisión de venta. Con `costos.ver` y `tesoreria.tipo_cambio` ve el costo y el margen, registra el tipo de cambio y cierra el costo de una OT terminada. También fija el presupuesto de costo de una OT, con motivo. |
| Tesorería | `tesoreria.ver_documentos`, `tesoreria.liberar`, `tesoreria.tipo_cambio`, `ordenes.listar`, `ordenes.ver` | Consulta cotizaciones liberadas y documentos de compra; confirma la liberación financiera de una OT. Registra el tipo de cambio del día (`/tesoreria/tipo-de-cambio`), con el que el costo en dólares pasa a soles. Su menú muestra Tablero, Órdenes, Tesorería y Tipo de cambio. |
| Contabilidad | `tesoreria.tipo_cambio` | Registra y corrige el tipo de cambio del día (migración `20261001150000`). |
| Diseño e ingeniería | `diseno.planos`, `diseno.merma`, `ordenes.listar`, `ordenes.ver` | Prepara la ficha técnica, guía de planos y desglose de materiales. Evalúa y fija el % de merma de material de cada OT abierta (pestaña Materiales). No consulta importes ni PDF comerciales. |
| Supervisión de Producción, Maestranza y Acabados | `ordenes.listar`, `ordenes.ver`, `produccion.actividades`, `produccion.reportar_tarea` | Cada cuenta crea las actividades y reporta fotos y avance de su área. Producción y Maestranza marcan sus respectivos vistos buenos en la ficha. No aprueban sus propios reportes. |
| Supervisión general | `costos.ver`, `cotizaciones.ver_pdf_comercial` | Ve el costo, el margen y el presupuesto de cada OT con su semáforo; no fija el presupuesto ni cierra el costo. Comprobado con el rol real en producción el 2026-10-01. |
| Operario | `ordenes.listar`, `ordenes.ver`, `produccion.registrar` | Registra el avance operativo autorizado. No ve la cotización comercial. |
| Almacenero | `almacen.ver`, `almacen.recibir`, `almacen.despachar`, `requerimientos.ver` | Lleva el kardex (`/almacen/kardex`): registra ingresos y salidas. Toda salida va vinculada a un vehículo registrado o al código de su unidad, con foto y nombre de quien recibe. Comprobado con el rol real el 2026-10-01 (check 314). |
| Costos y Materiales | `almacen.ver`, `costos.ver`, `costos.controlar_ot` | Lee el kardex y el historial de movimientos; no registra ingresos ni salidas. Consulta la valorización del almacén, los gastos del mes y la merma, sin modificarlos. Ve el costo de cada OT en soles y lo cierra cuando la OT terminó (`cerrar_costo_ot`, migración `20261001152000`): el cierre no se edita ni se borra. No ve el precio de venta ni el margen. Comprobado con los roles reales en producción el 2026-10-01. |
| Logística (Comprador) | `compras.crear`, `almacen.valorizar` | Fija el precio de los materiales del almacén que nunca se compraron por el sistema (`/compras/valorizacion`). Cada precio es uno nuevo, vigente desde ese momento; el anterior queda en el historial. |
| Recursos Humanos | `rrhh.ver_planillas`, `rrhh.gestionar_planillas` | Sube la mano de obra de terceros como planilla de subcontratos y el personal que no es de taller como planilla administrativa; las dos se reparten por OT como la de taller. |

## Quién pone cada parte del costo de una OT

Migración `20261001110000_costeo_por_responsable`, comprobada con los roles
reales el 2026-10-01 (check 315 y ensayo de las pantallas, revertidos).

| Parte del costo | Quién la pone | Dónde |
| --- | --- | --- |
| Material | Almacén lo saca; el precio es el de la compra o, si nunca se compró, el que fija Logística (`almacen.valorizar`) | Kardex, `/compras/valorizacion` |
| Merma | Diseño e Ingeniería (`diseno.merma`) fija el % sobre el material valorizado | Pestaña Materiales de la OT |
| Mano de obra de taller, administrativa y de terceros | RR. HH., en la planilla del mes repartida por OT | `/rrhh` |
| Gastos de área (servicios, transporte, viáticos) | Cada área; Administración revisa | Pestaña Costos de la OT |
| Trámites de placas y comisión de venta | Administración | Pestaña Costos de la OT |
| Servicios del local y gastos de operación | Administración, por mes, con tasa por OT o partes iguales entre las OT de la planilla cerrada de ese mes | `/costos/gastos-generales` |
| Servicios de terceros (fletes y otros) | Pendiente de definir responsable | — |

Una salida por unidad se carga a la OT abierta de esa unidad si tiene una sola;
con dos o más OT abiertas queda en el kardex sin OT.

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
