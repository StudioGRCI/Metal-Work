# Metal-Work

Sistema de gestión para una empresa de fabricación y reparación de carrocerías:
tolvas de volquete, plataformas, furgones, cisternas, camas bajas y
repotenciaciones.

Cubre el ciclo completo del trabajo en taller: la orden de trabajo, la
trazabilidad de todo documento, el almacén de materiales, el costo real de cada
orden y el seguimiento de la elaboración.

## Qué resuelve

| Pregunta del día a día | Dónde se responde |
| --- | --- |
| ¿En qué va la tolva del cliente X? | Tablero y detalle de la orden, con avance por etapa |
| ¿Por qué está parada esa orden? | Bitácora de la OT, con el motivo y quién la pausó |
| ¿Cuánto llevo gastado en esta OT? | Costeo real: materiales, mano de obra, servicios e indirectos |
| ¿Voy a perder plata con este trabajo? | Vista de margen: valor de venta contra costo acumulado |
| ¿Tengo plancha de 6 mm para empezar? | Stock por almacén, con disponible y comprometido |
| ¿Qué acero entró en esta carrocería? | Trazabilidad de lotes y coladas |
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
                    └── Storage (documentos y fotos de avance)
```

**Las reglas de negocio viven en la base de datos.** Una orden no se cierra con
etapas abiertas, una etapa crítica no cierra sin inspección de calidad
conforme, no se entrega sin acta de conformidad, el kardex es inmutable y el
stock no puede quedar negativo. Se cumplen venga el cambio de la aplicación, de
un script o del panel de Supabase.

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
2. Define las tres variables de entorno de Supabase.
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
| Supervisor | Supervisa etapas y aprueba los partes diarios |
| Control de calidad | Registra inspecciones y levanta observaciones |
| Almacenero | Ingresos, salidas, inventarios y catálogo de materiales |
| Compras | Proveedores y órdenes de compra |
| Comercial | Clientes, unidades y cotizaciones |
| Costos | Presupuestos, gastos y cierre del costeo |
| Operario | Registra su avance y sus horas; **solo ve sus propias órdenes** |
| Solo consulta | Lectura sin poder modificar nada |

Los permisos se editan por rol en `roles_permisos`, sin tocar código.

## Estructura del proyecto

```
src/
├── app/
│   ├── (app)/              Pantallas con sesión iniciada
│   │   ├── page.tsx        Tablero del taller
│   │   └── ordenes/        Módulo de órdenes de trabajo
│   ├── ingresar/           Inicio de sesión
│   └── auth/               Cierre de sesión
├── components/
│   ├── estructura/         Navegación y encabezados
│   └── ui/                 Componentes base
├── lib/
│   ├── datos/              Consultas a la base
│   ├── dominio/            Estados y etiquetas del negocio
│   └── supabase/           Clientes de navegador y servidor
└── types/database.ts       Generado desde el esquema

supabase/migrations/        Esquema de la base de datos
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
- Toda tabla nueva debe declarar sus políticas RLS; la migración `0007` falla si
  alguna queda sin protección.
