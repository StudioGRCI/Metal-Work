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
| Administración | `cotizaciones.ver_pdf_comercial`, `cotizaciones.liberar_tesoreria`, `ordenes.crear`, `ordenes.editar`, `usuarios.gestionar`, `produccion.aprobar_reportes`, `ordenes.revisar_taller`, `costos.gastos_generales` | Carga la OT en PDF, la libera a Tesorería, administra Personal y revisa reportes y OT abiertas por el taller. Registra los gastos del mes (`/costos/gastos-generales`) y, en la pestaña Costos de la OT, los trámites de placas y la comisión de venta. Con `costos.ver` y `tesoreria.tipo_cambio` ve el costo y el margen, registra el tipo de cambio y cierra el costo de una OT terminada. También fija el presupuesto de costo de una OT, con motivo. Recibe la evaluación de desempeño que le envía Diseño (`administracion.recibir_evaluacion`): la marca como recibida o la devuelve con su observación; nunca la corrige. Recursos Humanos, Supervisión General y Gerencia no la ven. Comprobado con los roles reales en producción el 2026-10-01. Desde el 2026-10-01 (migración `20261001213000`), de Preparación técnica solo le llega la evaluación: el informe semanal de Diseño ya no le llega. Su menú tampoco lleva Valorización del almacén (es de Logística; la pantalla tampoco la acepta) ni Unidades ni Carrocerías, que lleva Diseño e Ingeniería (`FUERA_DEL_MENU` en `src/lib/navegacion.ts`). Ya no corrige el catálogo de carrocerías ni sus medidas; sí da de alta la carrocería que falta al cargar una OT (`ordenes.crear`). Llena la ficha de taller de cada OT —medidas, accesorios, repuestos y pasos de verificación— con `ordenes.editar` (migración `20261001222000`); los vistos buenos de los pasos siguen siendo de Supervisión. Comprobado con el rol real en producción el 2026-10-02. |
| Tesorería | `tesoreria.ver_documentos`, `tesoreria.liberar`, `tesoreria.tipo_cambio`, `ordenes.listar`, `ordenes.ver` | Consulta cotizaciones liberadas y documentos de compra; confirma la liberación financiera de una OT. Registra el tipo de cambio del día (`/tesoreria/tipo-de-cambio`), con el que el costo en dólares pasa a soles. Su menú muestra Tablero, Órdenes, Tesorería y Tipo de cambio. |
| Contabilidad | `tesoreria.tipo_cambio` | Registra y corrige el tipo de cambio del día (migración `20261001150000`). |
| Diseño e ingeniería | `diseno.planos`, `diseno.merma`, `diseno.evaluar`, `diseno.carrocerias`, `diseno.unidades`, `ordenes.listar`, `ordenes.ver` | Prepara la ficha técnica, guía de planos y desglose de materiales. Evalúa y fija el % de merma de material de cada OT abierta (pestaña Materiales). No consulta importes ni PDF comerciales. Hace la evaluación de desempeño de su personal (`/diseno/evaluaciones`, migración `20261001190000`): la ve solo él mientras es borrador, la envía a Administración y, enviada, ya no la corrige salvo que Administración la devuelva. El Líder de Diseño tiene el mismo permiso y ve solo las suyas. Ve y corrige Carrocerías (`diseno.carrocerias`: nombre, descripción, medidas técnicas y si está activa) y Unidades (`diseno.unidades`: los datos del vehículo y si está activa; el cliente de la unidad lo sigue cambiando Ventas), migración `20261001213000`. Ve las fichas técnicas de cada carrocería: las escondía `cotizaciones.ver`, que no tenía ningún puesto, y con la cuenta real se veían 0 de 38. Aprueba u observa el informe semanal del colaborador y ahí termina. Comprobado con el rol real en producción el 2026-10-01. Ve la ficha de taller de la OT pero no la llena: desde el 2026-10-02 la llena Administración (migración `20261001222000`). Agrega material a la OT aunque todavía no haya planos y corrige la línea entera mientras nadie la haya pedido al almacén (migración `20261001221000`); guarda las etapas por partes hasta llegar al 100 % (migración `20261001220000`). |
| Colaborador de Diseño | `diseno.preparar_informe`, `diseno.subir_pdf`, `ordenes.listar`, `ordenes.ver` | Llena el informe semanal en el formato MW-IF-DI-01 (`/diseno/informe-semanal`, migración `20261001201500`): las tareas de la planificación de modelado (modelado 3D, ploteo, plano de corte DXF, ensamble 3D, modificaciones…) y el avance de planos (N.º de planos, N.º de piezas, tipo de plano, estado y a qué área se entregó), solo a nombre de los colaboradores del equipo de cada OT. Ve el código interno y si es CM o SR de esas OT (`identificacion_ot_diseno`) sin leer `unidades`. Corrige y quita lo suyo mientras el informe de la semana no se envía; enviado, la semana queda cerrada hasta que Diseño lo devuelve. Diseño lo aprueba y ahí termina: desde la migración `20261001213000` no pasa a Administración, y al aprobarse el aviso le llega al colaborador. La serie sigue la de papel: el primero del sistema es el N.º 022 (semana del 28/09/2026) y las semanas hasta el 21/09/2026 no se abren. Comprobado con el rol real en producción el 2026-10-01. |
| Supervisión de Producción, Maestranza y Acabados | `ordenes.listar`, `ordenes.ver`, `produccion.actividades`, `produccion.reportar_tarea` | Cada cuenta crea las actividades y reporta fotos y avance de su área. Producción y Maestranza marcan sus respectivos vistos buenos en la ficha. No aprueban sus propios reportes. |
| Supervisión general | `costos.ver`, `cotizaciones.ver_pdf_comercial` | Ve el costo, el margen y el presupuesto de cada OT con su semáforo; no fija el presupuesto ni cierra el costo. Comprobado con el rol real en producción el 2026-10-01. |
| Operario | `ordenes.listar`, `ordenes.ver`, `produccion.registrar` | Registra el avance operativo autorizado. No ve la cotización comercial. |
| Almacenero | `almacen.ver`, `almacen.recibir`, `almacen.despachar`, `requerimientos.ver` | Lleva el kardex (`/almacen/kardex`): registra ingresos, salidas y el conteo físico. Toda salida va vinculada a un vehículo registrado o al código de su unidad, con foto y nombre de quien recibe. Comprobado con el rol real el 2026-10-01 (check 314). La pantalla Stock de Almacén se retiró: `/almacen/stock` lleva al kardex. En una OT solo ve la pestaña Materiales; las demás pestañas, el expediente y el PDF de los planos le devuelven «sin permiso» (`seccionesDeOrden`). Sin internet, anota en la planilla de Excel que baja del kardex (`/almacen/kardex/planilla`, con `almacen.recibir` o `almacen.despachar`) y la carga al volver: cada fila entra con su fecha real, como máximo de 31 días atrás y no antes del último conteo del material (`registrar_ingreso_planilla` exige `almacen.recibir`; `registrar_salida_planilla`, `almacen.despachar`; migración `20261001200000`). Cargar la misma planilla otra vez no duplica nada. Comprobado con el rol real en producción el 2026-10-01 (check 316). |
| Costos y Materiales | `almacen.ver`, `costos.ver`, `costos.controlar_ot` | Lee el kardex y el historial de movimientos, y lo baja en Excel con los filtros de la pantalla (`/almacen/kardex/excel`, `almacen.ver`); no registra ingresos ni salidas ni carga la planilla. Consulta la valorización del almacén, los gastos del mes y la merma, sin modificarlos. Ve el costo de cada OT en soles y lo cierra cuando la OT terminó (`cerrar_costo_ot`, migración `20261001152000`): el cierre no se edita ni se borra. No ve el precio de venta ni el margen. Comprobado con los roles reales en producción el 2026-10-01. |
| Logística (Comprador) | `compras.crear`, `almacen.valorizar` | Fija el precio de los materiales del almacén que nunca se compraron por el sistema (`/compras/valorizacion`). Cada precio es uno nuevo, vigente desde ese momento; el anterior queda en el historial. La valorización es suya: desde el 2026-10-01 Administración no la ve en su menú ni la abre; la consultan quienes llevan el almacén (`almacen.ver`). |
| Recursos Humanos | `rrhh.ver_planillas`, `rrhh.gestionar_planillas` | Arma las tres planillas del mes (taller, administrativa y subcontratos) importando el Excel de planilla tal como lo saca (`/rrhh`, migración `20261001203000`): se leen todas las hojas RESUMEN del mes y año de la planilla, con sus dos formatos de boleta, y la empresa de cada persona sale de la hoja PAGOS. EsSalud se recalcula al 9 % de sueldo más horas extras y, si el Excel difiere en más de S/ 1, se usa el 9 % y queda un aviso; AFP y ONP solo avisan. Una boleta cuyo neto no cuadra no entra y se lista. RR. HH. elige a quién importa en cada planilla; una persona se cuenta una sola vez en el mes entre las tres (`importar_planilla_excel`), y reenviar la misma importación no duplica. Reparte el costo de varias personas en partes iguales entre varias OT (`repartir_planilla_en_partes_iguales`: dos decimales, la última OT lleva el resto) y cierra la planilla con el 100 % repartido. Comprobado con el rol real en producción el 2026-10-01 (revertido). No ve las evaluaciones de desempeño de Diseño (decisión de la empresa, 2026-10-01). |

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
