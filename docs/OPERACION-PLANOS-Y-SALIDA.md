# Operar planos y salida

## Documentos de OneDrive

Diseño conserva CAD y originales en OneDrive. Para cada OT confirma el número
del papel y el código de la unidad; crea el plano en Cumplimiento y carga su
PDF en Planos y revisiones, eligiendo el área destinataria. No se infiere una
OT por el mes de la carpeta ni por similitud del nombre.

Una entrega a dos áreas requiere dos registros, para conservar quién recibió
cada una. La corrección se carga como otra revisión; la anterior sigue vigente
hasta aprobar el reemplazo. El responsable revisa el contenido técnico antes
de aprobar. El programa gestiona documentos: no certifica cálculos ni cotas.

No hay sincronización automática con Microsoft. Los enlaces anónimos externos
conservan sus permisos de OneDrive; el acceso por rol se aplica a las copias
privadas del sistema. Nunca pegar enlaces públicos como sustituto del PDF.

## Quién trabaja en cada paso

| Paso | Responsable | Evidencia |
| --- | --- | --- |
| Cotización cargada | Ventas | Archivo y versión |
| Revisión comercial | Gerencia | Aprobación u observación |
| Emisión de OT | Administración | Número del papel, unidad y PDF |
| Preparación técnica | Diseño | Planos, piezas y materiales |
| Revisión técnica | Gerencia / Jefatura de Producción | Revisor distinto del autor |
| Recepción técnica | Responsable del área | Versión y fecha recibida |
| Fabricación | Área del taller | Actividades y avance |
| Liberación | Administración / Gerencia | Constancia de tesorería |
| Acta | Responsable de entrega | Conformidad y receptor |
| Aviso a portería | Coordinador de entrega | Fecha del aviso |
| Salida física | Responsable con `ordenes.entregar` | Constancia, persona y fecha |

La salida física se registra después de observarla, con acta conforme,
liberación y aviso previos. Se conserva una sola constancia por acta y los
reintentos devuelven la existente. No se modifica ni elimina desde la API.
Facturar no sustituye esta constancia.

## Verificación del 21/09/2026

- Migraciones 116 y 117 ensayadas con roles reales y rollback antes de aplicar.
- La prueba de hojas reprodujo que Ventas podía leer actividades internas.
  Tras corregir, todos los roles activos distintos de ADMIN se comprobaron:
  Diseño y jefaturas ven ambas hojas; cada área ve la suya; oficina no las ve.
- Salida física: responsable autorizado, rechazo al operario, rechazo sin
  aviso a portería e idempotencia. Pruebas reproducibles en
  `herramientas/recorrido/comprobar-salida-fisica.sql` y
  `herramientas/recorrido/comprobar-alcance-hojas.sql`.
- Todas las tablas públicas tienen RLS y las 26 vistas usan security_invoker.
  Los avisos de advisors se revisaron; las funciones definer nuevas verifican
  permisos. No se añadieron índices de autor sin una consulta que los necesite.
- PDF ficticio cargado por la interfaz y revisado desde otra cuenta.
  Descarga HTTP contra el mismo código local conectado a Supabase real:
  200, application/pdf, private/no-store y hash idéntico al original;
  otra área recibe 404. El dominio preview requiere además sesión de Vercel.

## Decisiones y límites

Arquitectura: la constancia va en tabla propia para no reescribir disparadores
de actas. Seguridad: solo RPC autorizada escribe; SELECT respeta la OT.
DBA: UNIQUE por acta y bloqueo serializan el doble envío. Usuario: aviso y
salida física se ven como pasos distintos. QA: el éxito exige una fila y el
fallo exige el rechazo esperado, no cualquier excepción.

La lectura por área se aplica a planos, piezas y hojas de actividades; no
equivale a asignar individualmente cada OT a una cuadrilla. Los resúmenes de
coordinación conservan los permisos del sistema. Una auditoría de permisos
no certifica la ausencia de cualquier vulnerabilidad.
