# Metal-Work

Sistema de gestión para una empresa de fabricación y reparación de carrocerías:
tolvas de volquete, plataformas, furgones, cisternas, camas bajas y
repotenciaciones.

Cubre el circuito que la empresa presentó y usa: la cotización de venta, la
cotización de trabajo, la aprobación de Gerencia, la orden con el desglose de
Diseño —actividades y materiales— y el avance del taller, con foto, unidad por
unidad. Lo que no era de ese circuito (almacén, servicios, partes diarios,
costos, calidad, documentos, garantías, informes) se retiró el 2026-09-09.

## Qué resuelve

| Pregunta del día a día | Dónde se responde |
| --- | --- |
| ¿En qué va la tolva del cliente X? | Tablero y detalle de la orden, con avance por etapa |
| ¿Por qué está parada esa orden? | Bitácora de la OT, con el motivo y quién la pausó |
| ¿Qué reportó cada área hoy, y quién no reportó? | El día en el taller |
| ¿Qué lleva esta unidad y a qué plano va? | El desglose de materiales de Diseño en la orden |
| ¿Qué le hicieron a la unidad que entró sin orden? | Unidades sin orden, con su reporte diario y sus fotos |
| ¿Quién aprobó este cambio y cuándo? | Historial de auditoría de cada registro |

## Arquitectura

```
Next.js 16 (App Router, Server Components)
        │
        ├── Server Actions ──┐
        │                    │
        └── @supabase/ssr ───┤
                             ▼
                    Supabase (Postgres 16)
                    ├── RLS por rol y permiso
                    ├── Reglas de negocio en triggers y funciones
                    ├── Auth
                    └── Storage (fotos de avance)
```

**Las reglas de negocio viven en la base de datos.** Una orden no se cierra con
etapas abiertas, no se entrega sin acta de conformidad ni sin la liberación de
Tesorería, las actividades de un área no pesan más de 100 % y un reporte de
avance no pasa del 100 % de su actividad. Se cumplen venga el cambio de la
aplicación, de un script o del panel de Supabase.

**Trazabilidad por diseño.** Cada cambio queda en `audit_log` con los campos que
realmente cambiaron; los eventos de negocio, en `ot_bitacora`. Ninguna de las
dos admite modificación ni borrado.

## Puesta en marcha

### Requisitos

- Node.js 20 o superior
- Un proyecto de Supabase (plan gratuito basta para empezar)
- `psql` si quieres ejecutar las pruebas del esquema en local

### Instalación

```bash
npm install
cp .env.example .env.local     # completa las claves de tu proyecto Supabase
```

Las claves están en el panel de Supabase, en **Project Settings → API**:

| Variable | Dónde se usa |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Navegador y servidor |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Navegador y servidor |
| `SUPABASE_SERVICE_ROLE_KEY` | Solo servidor: alta de usuarios y tareas de administración |
| `CRON_SECRET` | Solo servidor: la eliges tú y la manda Vercel al llamar `/api/tipo-cambio` (ver `vercel.json`) |

`SUPABASE_SERVICE_ROLE_KEY` ignora RLS. Nunca debe llegar al navegador ni
subirse al repositorio.

### Crear el esquema

```bash
npx supabase login
npx supabase link --project-ref <ref-de-tu-proyecto>
./scripts/db-push.sh
```

`db-push.sh` verifica primero el esquema contra un Postgres local y solo
entonces lo aplica en Supabase.

### Primer usuario

Los usuarios no se registran solos: los crea el administrador. Para el primero,
crea la cuenta en **Authentication → Users** del panel de Supabase y luego
inserta su perfil desde el editor SQL:

```sql
insert into public.usuarios (id, nombres, apellidos, correo, rol_id)
select '<uuid-de-auth-users>', 'Nombre', 'Apellido', 'correo@empresa.com.pe', id
  from public.roles where codigo = 'ADMIN';
```

Y registra los datos de la empresa:

```sql
insert into public.empresa (ruc, razon_social, igv_porcentaje)
values ('20xxxxxxxxx', 'RAZÓN SOCIAL S.A.C.', 18);

insert into public.sedes (codigo, nombre) values ('PRIN', 'Planta principal');
```

### Datos de demostración

Para recorrer el sistema antes de cargar la información real:

```bash
psql "$DATABASE_URL" -f db/demo/datos-demo.sql
```

Carga un taller de ejemplo: cinco clientes con sus unidades, dieciocho
materiales con existencia valorizada y cinco órdenes de trabajo en distintos
estados —una en proceso con material consumido y horas registradas, otra pausada
por falta de material, una urgente programada, una ya entregada con su acta de
conformidad y una en borrador—. El script es idempotente y no toca nada de lo
que ya exista.

### Desarrollo

```bash
npm run dev          # http://localhost:3000
npm run build        # compilación de producción
npx eslint .         # análisis estático
npx tsc --noEmit     # comprobación de tipos
```

## Despliegue en Vercel

1. Importa el repositorio en Vercel.
2. Define las tres variables de entorno de Supabase y `CRON_SECRET`, la que Vercel
   manda al llamar `/api/tipo-cambio`. Sin ella el cron contesta 401 y el tipo de
   cambio deja de actualizarse solo, sin avisar a nadie.
3. Añade el dominio de Vercel en **Authentication → URL Configuration** de
   Supabase, tanto en *Site URL* como en *Redirect URLs*.

El proyecto no necesita configuración adicional: Next.js detecta el App Router
y las Server Actions automáticamente.

## Base de datos

Las migraciones están en `supabase/migrations/` y se aplican en orden:

| Migración | Contenido |
| --- | --- |
| `0001_nucleo` | Empresa, sedes, usuarios, roles, permisos, correlativos, auditoría |
| `0002_comercial` | Clientes, unidades, tipos de carrocería, cotizaciones |
| `0003_ordenes_trabajo` | Órdenes, etapas, partes diarios, calidad, entregas, bitácora |
| `0004_almacen` | Materiales, kardex valorizado, requerimientos, compras |
| `0005_costos` | Presupuesto, tarifas, servicios, indirectos, vistas de costeo |
| `0006_documentos` | Repositorio documental versionado y línea de tiempo |
| `0007_rls` | Políticas de seguridad a nivel de fila |
| `0008_seed_base` | Roles, permisos, series, catálogos del rubro |
| `0009_storage` | Políticas de Supabase Storage para los archivos |

### Pruebas del esquema

Las reglas de negocio se prueban contra un Postgres real, no contra dobles:

```bash
# Levantar un Postgres de pruebas (una sola vez)
initdb -D /var/lib/pgtest -U postgres --auth=trust
pg_ctl -D /var/lib/pgtest -o "-p 5433 -k /tmp" start

./scripts/db-test.sh
```

El script recrea la base, aplica el shim de Supabase, todas las migraciones y
después las comprobaciones de `db/test/checks/`. Cubren el ciclo de vida de una
orden, el costeo por promedio ponderado del almacén, el costeo de una OT y las
políticas de seguridad ejecutando con el rol `authenticated` real.

### Tipos de TypeScript

```bash
./scripts/generar-tipos.sh                              # desde la base local
PGURL="postgresql://..." ./scripts/generar-tipos.sh      # desde Supabase
```

Genera `src/types/database.ts` leyendo el catálogo de Postgres. No necesita
Docker, a diferencia de `supabase gen types`.

## Roles

| Rol | Qué puede hacer |
| --- | --- |
| Administrador | Todo, incluida la configuración y el historial de auditoría |
| Gerencia | Consulta total; aprueba cotizaciones, órdenes y compras |
| Jefe de taller | Planifica, libera y controla la ejecución de las órdenes |
| Jefe de producción | Recibe el avance diario de las tres áreas, arma sus listas y programa |
| Supervisor | Arma la lista de actividades de su área y reporta su avance; hay uno por área |
| Diseño e ingeniería | Cotización de trabajo, ficha técnica, planos y desglose de materiales |
| Administración | Emite la orden de trabajo y registra los pagos |
| Comercial | Clientes, unidades y cotizaciones de venta |
| Operario | Reporta el avance de su área |
| Solo consulta | Lectura sin poder modificar nada |

Los roles de almacén, compras, calidad y costos siguen en el catálogo, sin
cuentas activas: sus módulos se retiraron.

Los permisos se editan por rol en `roles_permisos`, sin tocar código.

## Módulos

| Módulo | Qué permite hacer |
| --- | --- |
| **Tablero** | Estado del taller: órdenes abiertas, en proceso, pausadas, atrasadas y urgentes |
| **Cotización de venta** | Lo que se le ofrece al cliente y a qué precio; el circuito hasta la aprobación de Gerencia |
| **Cotización de trabajo** | Las partidas, la ficha técnica y el tiempo por área, que arma Diseño |
| **Carrocerías y materiales** | Lo que la casa ya fabricó con su ficha lista, y el catálogo del que Diseño arma el desglose |
| **Órdenes de trabajo** | Alta desde la cotización, ficha de taller, etapas y plazos por área, hoja de Diseño, materiales, actividades por área, avance y trazabilidad |
| **Control de plazos** | En qué va cada área y qué la trabó |
| **Avance en taller** | Una tarjeta por unidad: dónde está, hace cuánto no se toca, qué la traba y las fotos del día; y las unidades que entraron sin orden |
| **El día en el taller** | Lo que reportó cada área ese día, y quién no reportó |
| **Clientes y unidades** | Ficha del cliente con su flota, contactos e historial de órdenes |
| **Personal** | Altas con su acceso, puestos, áreas y costo hora |
| **Configuración** | Días de taller, feriados con siembra nacional, y los catálogos a la vista |

## Estructura del proyecto

```
src/
├── app/
│   ├── (app)/              Pantallas con sesión iniciada
│   │   ├── page.tsx        Tablero del taller
│   │   ├── ordenes/        Órdenes de trabajo
│   │   ├── plazos/         Control de plazos por área
│   │   ├── clientes/       Clientes y sus unidades
│   │   ├── cotizaciones/   Cotización de venta y de trabajo, conversión a orden
│   │   ├── carrocerias/    Las carrocerías de la casa con su ficha
│   │   ├── materiales/     El catálogo chico de Diseño
│   │   ├── avance/         Tablero por unidad, el día en el taller, unidades sin orden
│   │   └── personal/       Altas de personal y sus accesos
│   ├── ingresar/           Inicio de sesión
│   └── auth/               Cierre de sesión
├── components/
│   ├── avance/             Línea de avance de una unidad y selector de fotos
│   ├── estructura/         Navegación y encabezados
│   └── ui/                 Componentes base
├── lib/
│   ├── acciones.ts         Traducción de errores de Postgres
│   ├── datos/              Consultas a la base
│   ├── dominio/            Estados y etiquetas del negocio
│   └── supabase/           Clientes de navegador y servidor
└── types/database.ts       Generado desde el esquema

supabase/migrations/        Esquema de la base de datos
db/demo/                    Datos de demostración
db/test/                    Shim de Supabase y pruebas del esquema
scripts/                    Utilidades de desarrollo
```

## Convenciones

- El esquema y la interfaz están en español, igual que el vocabulario del
  taller: una tolva es una tolva y una OT es una OT.
- Los importes usan el dominio `monto` (2 decimales) y las cantidades de almacén
  el dominio `cantidad` (4 decimales), porque una plancha se pesa en kilos con
  fracción.
- Los documentos no se borran: se anulan, dejando constancia del motivo.
- La cotización impresa dice **qué se va a hacer y cuánto cuesta**: una sola
  línea con el concepto, la cantidad, la unidad y el precio. El desglose por
  partida —acero, mano de obra, servicios— es la cocina del taller, sirve para
  el presupuesto de la OT y las compras, y no sale en el papel del cliente.
- Toda tabla nueva debe declarar sus políticas RLS; la migración `0007` falla si
  alguna queda sin protección, y también si alguna queda con RLS activo pero sin
  políticas, que la volvería inaccesible sin avisar.
- Los campos que rellena un trigger (correlativos, tipo de cambio, número de
  versión) se declaran anulables con un `CHECK` que los exige. Postgres evalúa
  los `CHECK` después de los triggers `BEFORE`, así que la garantía se mantiene
  y la aplicación no tiene que inventar valores.
- Los archivos se suben directo del navegador a Storage. Un documento colgado de
  una orden se guarda bajo `ot/{orden_id}/…`, y las políticas de Storage se
  apoyan en esa ruta para heredar la visibilidad de la orden.
- Los plazos se cuentan en días de taller, no en días de calendario: la empresa
  declara qué días de la semana trabaja y la tabla `feriados` guarda el resto.
  El Jueves y el Viernes Santo se calculan, porque se mueven cada año.
- Las fechas se muestran en hora de Lima, corra donde corra el servidor. Una
  fecha sin hora —la de una factura— se muestra tal cual, sin convertirla: es un
  día del calendario, no un instante.
- Una función nueva nace abierta a todo el mundo, y en Supabase eso significa
  abierta a internet. Hay que cerrarla; `db/test/checks/98_puertas_cerradas.sql`
  falla si alguna queda suelta.
- La firma de un documento es de quien firma: entra por `firmar_documento()` y
  la política de `aprobaciones` mira el nombre, no el permiso.
