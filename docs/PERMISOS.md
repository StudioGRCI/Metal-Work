# Quién puede qué — roles y permisos

Este documento existe para poder cruzar **qué permiso exige una acción** con
**qué permiso acepta la política** de esa tabla, sin abrir la base. Ese cruce es
el fallo más caro que ha tenido el proyecto y ya apareció once veces: si la
acción exige `x.aprobar` y la política solo acepta `x.editar`, el UPDATE afecta
**cero filas sin error**, la acción devuelve `ok` y la pantalla dice «listo» sin
haber hecho nada. No se cae: miente.

Dos advertencias antes de leer la tabla:

- **ADMIN no aparece en `roles_permisos` y no le hace falta.** Entra por
  `public.es_admin()`, que las políticas comprueban aparte. Por eso sale con
  cero permisos aquí abajo y lo ve todo igual. Corolario: **probar con ADMIN no
  prueba ninguna política.** La receta para probar con el rol real está en la
  skill `datos`, sección «Probar con el rol real».
- **Un permiso que no tiene ningún rol es una puerta tapiada.** La política es
  correcta, la tabla está llena y todo el mundo ve el vacío. Están listados al
  final; hoy queda uno, `usuarios.ver`, y está sin repartir a propósito.

Foto de la base de producción del **2026-09-05**. Se regenera con las consultas
del final: los datos cambian, este archivo no se edita a mano.

## Los roles

| Código | Nombre | Nivel | Usuarios activos | Permisos |
| --- | --- | ---: | ---: | ---: |
| `ADMINISTRACION` | Administración | 0 | 1 | 8 |
| `CONSULTA` | Solo consulta | 10 | 0 | 9 |
| `OPERARIO` | Operario | 20 | 2 | 6 |
| `COSTOS` | Costos | 45 | 1 | 12 |
| `VENDEDOR` | Comercial | 45 | 1 | 10 |
| `DISENO` | Diseño e ingeniería | 48 | 0 | 8 |
| `ALMACENERO` | Almacenero | 50 | 1 | 13 |
| `COMPRADOR` | Compras | 50 | 1 | 9 |
| `CALIDAD` | Control de calidad | 55 | 1 | 9 |
| `SUPERVISOR` | Supervisor | 60 | 1 | 13 |
| `JEFE_TALLER` | Jefe de taller | 70 | 1 | 23 |
| `GERENTE` | Gerencia | 90 | 1 | 29 |
| `ADMIN` | Administrador | 100 | 1 | 0 → por `es_admin()` |

`CONSULTA` y `DISENO` no tienen hoy ningún usuario activo: una pantalla que solo
ellos pueden usar no la está mirando nadie todavía.

## Qué tiene cada rol

**`ADMINISTRACION` — Administración** (8)
`clientes.ver`, `costos.ver`, `cotizaciones.costear`, `cotizaciones.ver`,
`ordenes.crear`, `ordenes.editar`, `ordenes.listar`, `ordenes.ver`

**`CONSULTA` — Solo consulta** (9)
`almacen.ver`, `clientes.ver`, `cotizaciones.ver`, `documentos.ver`,
`garantias.ver`, `ordenes.listar`, `ordenes.ver`, `produccion.ver`,
`reportes.ver`

**`OPERARIO` — Operario** (6)
`documentos.ver`, `ordenes.listar`, `ordenes.ver`, `produccion.registrar`,
`produccion.ver`, `requerimientos.crear`

**`COSTOS` — Costos** (12)
`almacen.ver`, `compras.ver`, `costos.cerrar`, `costos.editar`, `costos.ver`,
`cotizaciones.ver`, `documentos.ver`, `ordenes.listar`, `ordenes.ver`,
`produccion.ver`, `reportes.ver`, `tesoreria.liberar`

**`VENDEDOR` — Comercial** (10)
`clientes.crear`, `clientes.editar`, `clientes.ver`, `cotizaciones.crear`,
`cotizaciones.editar`, `cotizaciones.ver`, `documentos.subir`, `documentos.ver`,
`garantias.ver`, `ordenes.ver`

**`DISENO` — Diseño e ingeniería** (8)
`clientes.ver`, `configuracion.ver`, `cotizaciones.costear`, `cotizaciones.ver`,
`diseno.planos`, `ordenes.listar`, `ordenes.ver`, `produccion.ver`

**`ALMACENERO` — Almacenero** (13)
`almacen.confirmar`, `almacen.inventario`, `almacen.maestros`,
`almacen.movimientos`, `almacen.ver`, `compras.recibir`, `compras.ver`,
`documentos.subir`, `documentos.ver`, `ordenes.listar`, `ordenes.ver`,
`requerimientos.aprobar`, `requerimientos.ver`

**`COMPRADOR` — Compras** (9)
`almacen.ver`, `compras.crear`, `compras.recibir`, `compras.ver`,
`documentos.subir`, `documentos.ver`, `ordenes.listar`, `ordenes.ver`,
`requerimientos.ver`

**`CALIDAD` — Control de calidad** (9)
`calidad.inspeccionar`, `calidad.ver`, `documentos.subir`, `documentos.ver`,
`garantias.gestionar`, `garantias.ver`, `ordenes.listar`, `ordenes.ver`,
`produccion.ver`

**`SUPERVISOR` — Supervisor** (13)
`almacen.ver`, `calidad.ver`, `documentos.subir`, `documentos.ver`,
`garantias.ver`, `ordenes.cambiar_estado`, `ordenes.listar`, `ordenes.ver`,
`produccion.aprobar_parte`, `produccion.registrar`, `produccion.ver`,
`requerimientos.crear`, `requerimientos.ver`

**`JEFE_TALLER` — Jefe de taller** (23)
`almacen.ver`, `calidad.ver`, `clientes.ver`, `costos.ver`, `cotizaciones.ver`,
`documentos.subir`, `documentos.ver`, `garantias.gestionar`, `garantias.ver`,
`ordenes.cambiar_estado`, `ordenes.crear`, `ordenes.editar`, `ordenes.entregar`,
`ordenes.listar`, `ordenes.ver`, `produccion.aprobar_parte`,
`produccion.planificar`, `produccion.registrar`, `produccion.ver`, `reportes.ver`,
`requerimientos.aprobar`, `requerimientos.crear`, `requerimientos.ver`

**`GERENTE` — Gerencia** (29)
`almacen.ver`, `auditoria.ver`, `calidad.ver`, `clientes.ver`,
`compras.aprobar`, `compras.ver`, `configuracion.editar`, `configuracion.ver`,
`costos.cerrar`, `costos.ver`,
`cotizaciones.anular`, `cotizaciones.aprobar`, `cotizaciones.costear`,
`cotizaciones.revisar`, `cotizaciones.ver`, `diseno.planos`,
`documentos.eliminar`, `documentos.ver`,
`garantias.gestionar`, `garantias.ver`, `usuarios.gestionar`,
`ordenes.anular`, `ordenes.aprobar`, `ordenes.listar`, `ordenes.ver`,
`produccion.ver`, `reportes.ver`, `requerimientos.ver`, `tesoreria.liberar`

**`ADMIN` — Administrador** (0 en `roles_permisos`)
Ninguno asignado. Pasa por `es_admin()`.

## El catálogo, al revés: quién tiene cada permiso

Esta es la dirección que sirve para revisar una política: se busca el permiso que
la política exige y se mira quién lo tiene de verdad.

| Módulo | Permiso | Para qué | Lo tienen |
| --- | --- | --- | --- |
| Almacén | `almacen.confirmar` | Confirmar movimientos y afectar el kardex | `ALMACENERO` |
| Almacén | `almacen.inventario` | Realizar inventarios y ajustes de existencias | `ALMACENERO` |
| Almacén | `almacen.maestros` | Administrar el catálogo de materiales y almacenes | `ALMACENERO` |
| Almacén | `almacen.movimientos` | Registrar ingresos, salidas y devoluciones | `ALMACENERO` |
| Almacén | `almacen.ver` | Consultar stock, kardex y movimientos | `CONSULTA`, `COSTOS`, `ALMACENERO`, `COMPRADOR`, `SUPERVISOR`, `JEFE_TALLER`, `GERENTE` |
| Almacén | `requerimientos.aprobar` | Aprobar requerimientos y reservar stock | `ALMACENERO`, `JEFE_TALLER` |
| Almacén | `requerimientos.crear` | Solicitar material para una orden de trabajo | `OPERARIO`, `SUPERVISOR`, `JEFE_TALLER` |
| Almacén | `requerimientos.ver` | Ver requerimientos de material | `ALMACENERO`, `COMPRADOR`, `SUPERVISOR`, `JEFE_TALLER`, `GERENTE` |
| Calidad | `calidad.inspeccionar` | Registrar inspecciones y levantar observaciones | `CALIDAD` |
| Calidad | `calidad.ver` | Ver inspecciones de calidad | `CALIDAD`, `SUPERVISOR`, `JEFE_TALLER`, `GERENTE` |
| Comercial | `clientes.crear` | Registrar clientes y unidades | `VENDEDOR` |
| Comercial | `clientes.editar` | Modificar clientes y unidades | `VENDEDOR` |
| Comercial | `clientes.ver` | Ver clientes y unidades | `ADMINISTRACION`, `CONSULTA`, `VENDEDOR`, `DISENO`, `JEFE_TALLER`, `GERENTE` |
| Comercial | `cotizaciones.aprobar` | Aprobar o rechazar una cotización | `GERENTE` |
| Comercial | `cotizaciones.costear` | Armar la cotización de trabajo: partidas, ficha técnica y accesorios | `ADMINISTRACION`, `DISENO`, `GERENTE` |
| Comercial | `cotizaciones.crear` | Elaborar cotizaciones | `VENDEDOR` |
| Comercial | `cotizaciones.editar` | Modificar cotizaciones en borrador | `VENDEDOR` |
| Comercial | `cotizaciones.revisar` | Dar el visto de Gerencia antes de que salga al cliente | `GERENTE` |
| Comercial | `cotizaciones.ver` | Ver cotizaciones | `ADMINISTRACION`, `CONSULTA`, `COSTOS`, `VENDEDOR`, `DISENO`, `JEFE_TALLER`, `GERENTE` |
| cotizaciones | `cotizaciones.anular` | Anular una cotización que el cliente ya aprobó | `GERENTE` |
| Compras | `compras.aprobar` | Aprobar órdenes de compra | `GERENTE` |
| Compras | `compras.crear` | Generar órdenes de compra | `COMPRADOR` |
| Compras | `compras.recibir` | Registrar la recepción de mercadería | `ALMACENERO`, `COMPRADOR` |
| Compras | `compras.ver` | Ver órdenes de compra y proveedores | `COSTOS`, `ALMACENERO`, `COMPRADOR`, `GERENTE` |
| Configuración | `auditoria.ver` | Consultar el historial de auditoría | `GERENTE` |
| Configuración | `configuracion.editar` | Modificar catálogos, series y parámetros | `GERENTE` |
| Configuración | `configuracion.ver` | Ver la configuración del sistema | `DISENO`, `GERENTE` |
| Configuración | `usuarios.gestionar` | Crear usuarios y asignar roles | `GERENTE` |
| Configuración | `usuarios.ver` | Ver usuarios | **(ninguno)** |
| Costos | `costos.cerrar` | Cerrar el costeo de una orden | `COSTOS`, `GERENTE` |
| Costos | `costos.editar` | Registrar presupuestos, servicios de terceros y gastos | `COSTOS` |
| Costos | `costos.ver` | Ver el costeo y el margen de las órdenes | `ADMINISTRACION`, `COSTOS`, `JEFE_TALLER`, `GERENTE` |
| Documentos | `documentos.eliminar` | Anular documentos | `GERENTE` |
| Documentos | `documentos.subir` | Adjuntar documentos y nuevas versiones | `VENDEDOR`, `ALMACENERO`, `COMPRADOR`, `CALIDAD`, `SUPERVISOR`, `JEFE_TALLER` |
| Documentos | `documentos.ver` | Ver y descargar documentos | `CONSULTA`, `OPERARIO`, `COSTOS`, `VENDEDOR`, `ALMACENERO`, `COMPRADOR`, `CALIDAD`, `SUPERVISOR`, `JEFE_TALLER`, `GERENTE` |
| garantias | `garantias.gestionar` | Registrar reclamos, evaluarlos y cerrarlos | `CALIDAD`, `JEFE_TALLER`, `GERENTE` |
| garantias | `garantias.ver` | Ver las garantías vigentes y sus reclamos | `CONSULTA`, `VENDEDOR`, `CALIDAD`, `SUPERVISOR`, `JEFE_TALLER`, `GERENTE` |
| Órdenes de trabajo | `ordenes.anular` | Anular una orden de trabajo | `GERENTE` |
| Órdenes de trabajo | `ordenes.aprobar` | Aprobar una orden y liberarla a producción | `GERENTE` |
| Órdenes de trabajo | `ordenes.cambiar_estado` | Iniciar, pausar, reanudar o terminar una orden | `SUPERVISOR`, `JEFE_TALLER` |
| Órdenes de trabajo | `ordenes.crear` | Registrar nuevas órdenes de trabajo | `ADMINISTRACION`, `JEFE_TALLER` |
| Órdenes de trabajo | `ordenes.editar` | Modificar datos de una orden de trabajo | `ADMINISTRACION`, `JEFE_TALLER` |
| Órdenes de trabajo | `ordenes.entregar` | Registrar la entrega y el acta de conformidad | `JEFE_TALLER` |
| Órdenes de trabajo | `ordenes.listar` | Entrar al módulo de órdenes de trabajo y al control de plazos | todos menos `ADMIN` y `VENDEDOR` (11 roles) |
| Órdenes de trabajo | `ordenes.ver` | Ver órdenes de trabajo y su detalle | todos menos `ADMIN` (12 roles) |
| Producción | `diseno.planos` | Armar la lista de planos y piezas y dar por entregado cada plano | `DISENO`, `GERENTE` |
| Producción | `produccion.aprobar_parte` | Aprobar el parte diario y cargar las horas a la orden | `SUPERVISOR`, `JEFE_TALLER` |
| Producción | `produccion.planificar` | Programar fechas y asignar personal a las órdenes | `JEFE_TALLER` |
| Producción | `produccion.registrar` | Registrar avance de etapas y horas trabajadas | `OPERARIO`, `SUPERVISOR`, `JEFE_TALLER` |
| Producción | `produccion.ver` | Ver etapas, avances y partes diarios | `CONSULTA`, `OPERARIO`, `COSTOS`, `DISENO`, `CALIDAD`, `SUPERVISOR`, `JEFE_TALLER`, `GERENTE` |
| Reportes | `reportes.ver` | Ver reportes e indicadores de gestión | `CONSULTA`, `COSTOS`, `JEFE_TALLER`, `GERENTE` |
| tesoreria | `tesoreria.liberar` | Confirmar que el cliente está al día y liberar la salida de su unidad | `COSTOS`, `GERENTE` |

## Puertas tapiadas: las que había y la que queda

Un permiso que no tiene ningún rol es una puerta tapiada: la política está bien
escrita, la tabla está llena, y todo el mundo salvo el administrador ve que el
botón no hace nada. Como el sistema se recorre siempre con ADMIN —que entra por
`es_admin()` y nunca toca el permiso—, el vacío no se ve hasta que lo ve la gente.

El 2026-09-02 se encontraron cuatro y se cerraron tres (migración `079`):

- `configuracion.editar` lo exigían **35 políticas** y una función. Sin él nadie
  fuera del administrador podía tocar un catálogo, una serie, un feriado ni el
  tipo de cambio. Fue a Gerencia.
- `usuarios.gestionar` lo exigían 2 políticas y las cuatro funciones de personal:
  dar de alta a alguien, cambiarle la clave o darlo de baja. Fue a Gerencia.
- `documentos.eliminar` lo exige la política de borrado; sin él el «deshacer» de
  una subida fallida no borraba nada y devolvía éxito. Fue a Gerencia.
- `usuarios.ver` **no lo exige nadie**: se queda sin repartir a propósito. Quien
  necesita ver a la gente del taller entra por `es_usuario_activo()`, que es lo
  que pide la política de `usuarios`.

Y una trampa que salió de ahí y conviene no olvidar: **editar sin ver no sirve**.
Dar `configuracion.editar` a Gerencia no bastaba, porque un
`update … where id = …` tiene que leer esa columna, y leer hace que la política
de lectura también se evalúe. Sin `configuracion.ver` el UPDATE afectaba cero
filas y no daba error. Medido con el rol de Gerencia: 0 filas con el `where`,
1 sin él. Por eso todo rol con `x.editar` lleva también `x.ver`, y la migración
`079` lo comprueba al final.

Nota menor de datos: la columna `permisos.modulo` no está normalizada
—conviven `Comercial` con `cotizaciones`, `garantias` y `tesoreria` en
minúscula—, y ese texto es el que agrupa la pantalla de configuración.

## Cómo se regenera

Con el conector de Supabase sobre el proyecto `usnbwnemfqyjjkzdizgv`, solo
lectura. Primero los roles:

```sql
select r.codigo,
       r.nombre,
       r.nivel,
       (select count(*) from public.usuarios u
         where u.rol_id = r.id and u.activo) as usuarios_activos,
       (select count(*) from public.roles_permisos rp
         where rp.rol_id = r.id) as n_permisos,
       coalesce((select string_agg(rp.permiso_codigo, ', ' order by rp.permiso_codigo)
                   from public.roles_permisos rp
                  where rp.rol_id = r.id), '—') as permisos
  from public.roles r
 order by r.nivel, r.codigo;
```

Y el catálogo al revés, que es el que delata las puertas tapiadas:

```sql
select p.modulo,
       p.codigo,
       p.descripcion,
       coalesce((select string_agg(r.codigo, ', ' order by r.nivel, r.codigo)
                   from public.roles_permisos rp
                   join public.roles r on r.id = rp.rol_id
                  where rp.permiso_codigo = p.codigo), '(ninguno)') as roles
  from public.permisos p
 order by p.modulo, p.codigo;
```
