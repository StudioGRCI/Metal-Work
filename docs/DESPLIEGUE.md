# Guía de despliegue

Pasos para poner Metal-Work en marcha desde cero. Cada paso se puede hacer sin
conocimientos de programación salvo donde se indica.

---

## 1. Crear el proyecto de Supabase

Supabase cobra el cómputo de cada proyecto en las organizaciones de plan **Pro**.
En una organización de plan **Free** los proyectos no tienen costo.

**Si quieres que Metal-Work no cueste nada:**

1. Entra a [supabase.com/dashboard](https://supabase.com/dashboard).
2. Arriba a la izquierda, abre el selector de organización → **New organization**.
3. Ponle un nombre (por ejemplo `Metal-Work`) y elige el plan **Free**.
4. Dentro de esa organización nueva → **New project**.
   - Nombre: `Metal-Work`
   - Región: `South America (São Paulo)` o `East US`, la que responda mejor
   - Contraseña de base de datos: **guárdala**, se necesita más abajo
5. Espera a que el proyecto termine de aprovisionarse (unos minutos).

El **project ref** es la cadena que aparece en la URL del panel:
`https://supabase.com/dashboard/project/`**`xxxxxxxxxxxxxxxxxxxx`**

---

## 2. Aplicar el esquema

Con el project ref y la contraseña de la base de datos:

```bash
npm install
npx supabase login
npx supabase link --project-ref <tu-project-ref>
./scripts/db-push.sh
```

`db-push.sh` verifica el esquema contra un Postgres local antes de aplicarlo, así
que si algo está mal no llega a tocar el proyecto real.

Esto crea las 56 tablas, las 23 vistas, las 204 políticas de seguridad, los
catálogos del rubro (tipos de carrocería, etapas de fabricación, unidades de
medida, categorías de material, tipos de documento) y los buckets de archivos.

---

## 3. Configurar la aplicación

En el panel de Supabase, **Project Settings → API**, copia los tres valores:

```bash
cp .env.example .env.local
```

Y complétalo:

| Variable | De dónde sale |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key — **nunca se comparte ni se sube al repositorio** |

---

## 4. Crear la empresa y el primer usuario

En el panel de Supabase → **Authentication → Users → Add user**:
crea la cuenta con el correo y la contraseña del administrador, y **copia su
User UID**.

Después, en **SQL Editor**, ejecuta esto reemplazando los valores:

```sql
-- Datos de la empresa
insert into public.empresa (ruc, razon_social, nombre_comercial, direccion, telefono, correo)
values ('20xxxxxxxxx', 'RAZÓN SOCIAL S.A.C.', 'Nombre comercial',
        'Dirección del taller', '01xxxxxxx', 'contacto@empresa.com.pe');

-- Taller principal
insert into public.sedes (codigo, nombre, direccion)
values ('PRIN', 'Planta principal', 'Dirección de la planta');

-- Perfil del administrador (pega el User UID copiado arriba)
insert into public.usuarios (id, nombres, apellidos, correo, rol_id, sede_id)
select '<USER-UID-COPIADO>', 'Nombre', 'Apellido', 'correo@empresa.com.pe',
       r.id, s.id
  from public.roles r, public.sedes s
 where r.codigo = 'ADMIN'
 limit 1;
```

Ya puedes entrar al sistema con ese correo y contraseña.

---

## 5. Cargar datos de ejemplo (opcional)

Para recorrer el sistema antes de meter información real:

```bash
psql "$DATABASE_URL" -f db/demo/datos-demo.sql
```

Carga cinco clientes con su flota, dieciocho materiales con existencia
valorizada y cinco órdenes en distintos estados. No toca nada de lo que ya
exista y se puede ejecutar varias veces.

Para borrar la demo antes de arrancar en producción, elimina esas órdenes desde
el panel o pide que se prepare un script de limpieza.

---

## 6. Publicar en Vercel

1. En [vercel.com](https://vercel.com) → **Add New → Project** → importa el
   repositorio de GitHub.
2. En **Environment Variables**, carga las tres variables del paso 3.
3. **Deploy**.
4. Copia la URL que te da Vercel y regístrala en Supabase, en
   **Authentication → URL Configuration**, tanto en *Site URL* como en
   *Redirect URLs*. Sin esto el inicio de sesión no funciona en producción.

---

## 7. Dar de alta al resto del equipo

Por cada persona, en **Authentication → Users → Add user**, y luego en el
SQL Editor:

```sql
insert into public.usuarios
  (id, nombres, apellidos, correo, rol_id, sede_id, es_operario, costo_hora)
select '<USER-UID>', 'Nombre', 'Apellido', 'correo@empresa.com.pe',
       r.id, s.id, false, 0
  from public.roles r, public.sedes s
 where r.codigo = 'JEFE_TALLER'      -- ver la tabla de roles del README
   and s.codigo = 'PRIN';
```

Para un operario: `es_operario = true` y `costo_hora` con su costo real por
hora, que es lo que alimenta el costeo de mano de obra.

Los códigos de rol disponibles son `ADMIN`, `GERENTE`, `JEFE_TALLER`,
`SUPERVISOR`, `CALIDAD`, `ALMACENERO`, `COMPRADOR`, `VENDEDOR`, `COSTOS`,
`OPERARIO` y `CONSULTA`. El README explica qué puede hacer cada uno.

---

## Orden recomendado para empezar a usarlo

1. **Configuración**: empresa, sedes y usuarios (pasos 4 y 7).
2. **Catálogos**: revisar tipos de carrocería y etapas de fabricación, y
   ajustar las horas estándar a la realidad del taller.
3. **Materiales**: cargar el catálogo y hacer un ingreso inicial de almacén con
   las existencias actuales, para que el kardex arranque cuadrado.
4. **Clientes y unidades**: los clientes activos con sus vehículos.
5. **Órdenes de trabajo**: abrir las órdenes en curso, indicando el avance de
   cada etapa para que el sistema refleje el estado real del taller.
6. **Partes diarios**: desde el primer día, para que las horas empiecen a
   valorizarse.
