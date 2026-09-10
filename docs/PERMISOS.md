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

Foto de la base de producción del **2026-09-09**. Se regenera con las consultas
del final: los datos cambian, este archivo no se edita a mano.

## Los roles

| Código | Nombre | Nivel | Usuarios activos | Permisos |
| --- | --- | ---: | ---: | ---: |
| `ADMINISTRACION` | Administración | 0 | 1 | 10 |
| `CONSULTA` | Solo consulta | 10 | 0 | 5 |
| `OPERARIO` | Operario | 20 | 2 | 4 |
| `COSTOS` | Costos | 45 | 0 | 9 |
| `VENDEDOR` | Comercial | 45 | 1 | 9 |
| `DISENO` | Diseño e ingeniería | 48 | 1 | 8 |
| `ALMACENERO` | Almacenero | 50 | 0 | 2 |
| `COMPRADOR` | Compras | 50 | 0 | 2 |
| `CALIDAD` | Control de calidad | 55 | 0 | 3 |
| `SUPERVISOR` | Supervisor | 60 | 3 | 6 |
| `JEFE_PRODUCCION` | Jefe de producción | 65 | 1 | 8 |
| `JEFE_TALLER` | Jefe de taller | 70 | 1 | 13 |
| `GERENTE` | Gerencia | 90 | 1 | 20 |
| `ADMIN` | Administrador | 100 | 1 | 0 → por `es_admin()` |

`CONSULTA` no tiene hoy ningún usuario activo: una pantalla que solo
ese rol pueda usar no la está mirando nadie todavía. `DISENO` estrenó cuenta el
2026-09-05, para el recorrido de venta → trabajo → gerencia → orden → planos.
`COSTOS`, `ALMACENERO`, `COMPRADOR` y `CALIDAD` se quedaron sin cuentas activas
el 2026-09-09, cuando se retiraron sus módulos (migración `094`): los roles
siguen en el catálogo, con lo poco que les queda, por decisión del cliente.

**Hay una tercera cosa que decide el acceso, además del rol y de `es_admin()`:
el área.** `SUPERVISOR` tiene tres cuentas —Producción, Acabados y Maestranza—
con exactamente el mismo permiso, y lo que las separa es
`usuarios.area_id`: desde la migración `091`, la hoja de actividades de un área
solo la escribe quien pertenece a esa área. Quien responde por el taller entero
—`JEFE_PRODUCCION`, `JEFE_TALLER` y Gerencia— pasa por encima con
`produccion.cualquier_area`. Corolario para depurar: **un supervisor con
`produccion.actividades` y sin área no puede escribir nada**, y el UPDATE
afectará cero filas sin dar error.

## Qué tiene cada rol

**`ADMINISTRACION` — Administración** (10)
`clientes.ver`, `cotizaciones.aprobar`, `cotizaciones.costear`,
`cotizaciones.ver`, `ordenes.crear`, `ordenes.editar`, `ordenes.listar`,
`ordenes.ver`, `pagos.registrar`, `pagos.ver`

**`CONSULTA` — Solo consulta** (5)
`clientes.ver`, `cotizaciones.ver`, `ordenes.listar`, `ordenes.ver`,
`produccion.ver`

**`OPERARIO` — Operario** (4)
`ordenes.listar`, `ordenes.ver`, `produccion.registrar`, `produccion.ver`

**`COSTOS` — Costos** (9)
`clientes.ver`, `cotizaciones.aprobar`, `cotizaciones.ver`, `ordenes.listar`,
`ordenes.ver`, `pagos.registrar`, `pagos.ver`, `produccion.ver`,
`tesoreria.liberar`

**`VENDEDOR` — Comercial** (9)
`clientes.crear`, `clientes.editar`, `clientes.ver`, `cotizaciones.aprobar`,
`cotizaciones.crear`, `cotizaciones.editar`, `cotizaciones.ver`, `ordenes.ver`,
`pagos.ver`

**`DISENO` — Diseño e ingeniería** (8)
`clientes.ver`, `configuracion.ver`, `cotizaciones.costear`,
`cotizaciones.ver`, `diseno.planos`, `ordenes.listar`, `ordenes.ver`,
`produccion.ver`

**`ALMACENERO` — Almacenero** (2)
`ordenes.listar`, `ordenes.ver`

**`COMPRADOR` — Compras** (2)
`ordenes.listar`, `ordenes.ver`

**`CALIDAD` — Control de calidad** (3)
`ordenes.listar`, `ordenes.ver`, `produccion.ver`

**`SUPERVISOR` — Supervisor** (6)
`ordenes.cambiar_estado`, `ordenes.listar`, `ordenes.ver`,
`produccion.actividades`, `produccion.registrar`, `produccion.ver`

**`JEFE_PRODUCCION` — Jefe de producción** (8)
`ordenes.cambiar_estado`, `ordenes.listar`, `ordenes.ver`,
`produccion.actividades`, `produccion.cualquier_area`, `produccion.planificar`,
`produccion.registrar`, `produccion.ver`

Es el supervisor más las tres áreas y programar. Sin `clientes.ver`, como el
resto del taller: a él le llegan los avances, no los clientes.

**`JEFE_TALLER` — Jefe de taller** (13)
`clientes.ver`, `cotizaciones.ver`, `ordenes.cambiar_estado`, `ordenes.crear`,
`ordenes.editar`, `ordenes.entregar`, `ordenes.listar`, `ordenes.ver`,
`produccion.actividades`, `produccion.cualquier_area`, `produccion.planificar`,
`produccion.registrar`, `produccion.ver`

**`GERENTE` — Gerencia** (20)
`auditoria.ver`, `clientes.ver`, `configuracion.editar`, `configuracion.ver`,
`cotizaciones.anular`, `cotizaciones.aprobar`, `cotizaciones.costear`,
`cotizaciones.revisar`, `cotizaciones.ver`, `diseno.planos`, `ordenes.anular`,
`ordenes.aprobar`, `ordenes.listar`, `ordenes.ver`, `pagos.ver`,
`produccion.actividades`, `produccion.cualquier_area`, `produccion.ver`,
`tesoreria.liberar`, `usuarios.gestionar`

**`ADMIN` — Administrador** (0 en `roles_permisos`)
Ninguno asignado. Pasa por `es_admin()`.

## El catálogo, al revés: quién tiene cada permiso

Esta es la dirección que sirve para revisar una política: se busca el permiso que
la política exige y se mira quién lo tiene de verdad.

| Módulo | Permiso | Para qué | Lo tienen |
| --- | --- | --- | --- |
| Comercial | `clientes.crear` | Registrar clientes y unidades | `VENDEDOR` |
| Comercial | `clientes.editar` | Modificar clientes y unidades | `VENDEDOR` |
| Comercial | `clientes.ver` | Ver clientes y unidades | `ADMINISTRACION`, `CONSULTA`, `COSTOS`, `VENDEDOR`, `DISENO`, `JEFE_TALLER`, `GERENTE` |
| Comercial | `cotizaciones.aprobar` | Aprobar o rechazar una cotización | `ADMINISTRACION`, `COSTOS`, `VENDEDOR`, `GERENTE` |
| Comercial | `cotizaciones.costear` | Armar la cotización de trabajo: partidas, ficha técnica y accesorios | `ADMINISTRACION`, `DISENO`, `GERENTE` |
| Comercial | `cotizaciones.crear` | Elaborar cotizaciones | `VENDEDOR` |
| Comercial | `cotizaciones.editar` | Modificar cotizaciones en borrador | `VENDEDOR` |
| Comercial | `cotizaciones.revisar` | Dar el visto de Gerencia a una cotización antes de que salga al cliente | `GERENTE` |
| Comercial | `cotizaciones.ver` | Ver cotizaciones | `ADMINISTRACION`, `CONSULTA`, `COSTOS`, `VENDEDOR`, `DISENO`, `JEFE_TALLER`, `GERENTE` |
| Configuración | `auditoria.ver` | Consultar el historial de auditoría | `GERENTE` |
| Configuración | `configuracion.editar` | Modificar catálogos, series y parámetros | `GERENTE` |
| Configuración | `configuracion.ver` | Ver la configuración del sistema | `DISENO`, `GERENTE` |
| Configuración | `usuarios.gestionar` | Crear usuarios y asignar roles | `GERENTE` |
| Configuración | `usuarios.ver` | Ver usuarios | **(ninguno)** |
| cotizaciones | `cotizaciones.anular` | Anular una cotización que el cliente ya aprobó | `GERENTE` |
| Órdenes de trabajo | `ordenes.anular` | Anular una orden de trabajo | `GERENTE` |
| Órdenes de trabajo | `ordenes.aprobar` | Aprobar una orden y liberarla a producción | `GERENTE` |
| Órdenes de trabajo | `ordenes.cambiar_estado` | Iniciar, pausar, reanudar o terminar una orden | `SUPERVISOR`, `JEFE_PRODUCCION`, `JEFE_TALLER` |
| Órdenes de trabajo | `ordenes.crear` | Registrar nuevas órdenes de trabajo | `ADMINISTRACION`, `JEFE_TALLER` |
| Órdenes de trabajo | `ordenes.editar` | Modificar datos de una orden de trabajo | `ADMINISTRACION`, `JEFE_TALLER` |
| Órdenes de trabajo | `ordenes.entregar` | Registrar la entrega y el acta de conformidad | `JEFE_TALLER` |
| Órdenes de trabajo | `ordenes.listar` | Entrar al módulo de órdenes de trabajo y al control de plazos | todos menos `ADMIN` y `VENDEDOR` (12 roles) |
| Órdenes de trabajo | `ordenes.ver` | Ver órdenes de trabajo y su detalle | todos menos `ADMIN` (13 roles) |
| Producción | `diseno.planos` | Armar la lista de planos y piezas de una orden y dar por entregado cada plano | `DISENO`, `GERENTE` |
| Producción | `produccion.actividades` | Armar la lista de actividades de su área en una orden y ponerles su peso | `SUPERVISOR`, `JEFE_PRODUCCION`, `JEFE_TALLER`, `GERENTE` |
| Producción | `produccion.cualquier_area` | Armar y reportar la hoja de cualquier área, no solo la propia | `JEFE_PRODUCCION`, `JEFE_TALLER`, `GERENTE` |
| Producción | `produccion.planificar` | Programar las fechas de las etapas de una orden | `JEFE_PRODUCCION`, `JEFE_TALLER` |
| Producción | `produccion.registrar` | Reportar el avance del día: etapas, actividades, unidades sin orden y sus fotos | `OPERARIO`, `SUPERVISOR`, `JEFE_PRODUCCION`, `JEFE_TALLER` |
| Producción | `produccion.ver` | Ver etapas, avances y el día en el taller | `CONSULTA`, `OPERARIO`, `COSTOS`, `DISENO`, `CALIDAD`, `SUPERVISOR`, `JEFE_PRODUCCION`, `JEFE_TALLER`, `GERENTE` |
| tesoreria | `pagos.registrar` | Registrar un pago del cliente y arrancar el plazo | `ADMINISTRACION`, `COSTOS` |
| tesoreria | `pagos.ver` | Ver los pagos que hizo el cliente | `ADMINISTRACION`, `COSTOS`, `VENDEDOR`, `GERENTE` |
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

El 2026-09-09 la migración `094` retiró 24 permisos con sus módulos —almacén,
requerimientos, compras, costos, calidad, documentos, garantías, reportes y el
parte diario— y comprobó al final que ninguna política ni función viva los
siguiera citando: un permiso citado y retirado es la misma puerta tapiada, solo
que sin fila en el catálogo que la delate. `documentos.eliminar`, de la lista de
arriba, se fue con ellos.

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
