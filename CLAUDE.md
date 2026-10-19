# Metal Work — cómo trabajar en este repositorio

Sistema de gestión para un taller de carrocerías: órdenes de trabajo, almacén,
costeo real, cotizaciones y avance de producción. Next.js 16 (App Router, Server
Components) sobre Supabase/Postgres. **Las reglas de negocio viven en la base de
datos**, no en la aplicación: triggers, funciones y RLS. La aplicación las
obedece, no las reimplementa.

Todo se escribe en español: rutas, tablas, columnas, funciones, componentes y
mensajes de error. Los `raise exception` los lee el usuario final.

## Antes de escribir, cargar la skill del dominio

No son documentación opcional: cada una lleva las trampas que ya costaron caro
aquí. Cargarla **antes** de escribir sale más barato que descubrirlo después.

| Vas a tocar | Carga la skill |
| --- | --- |
| `supabase/migrations/`, `db/test/`, `db/demo/` | `esquema` |
| RLS, permisos, funciones SQL, acciones de servidor, revisar un diff | `seguridad` |
| Pantallas, componentes, formularios | `diseno` |
| Consultar o diagnosticar la base viva | `datos` |
| Índices, rendimiento, avisos de `get_advisors`, políticas | `datos` |
| El usuario te corrigió | `aprender` |
| Revisar o pulir una pantalla | `diseno`, después `impeccable` y `ui-ux-pro-max` |
| Algo falla o no cuadra | `systematic-debugging` |
| Rendimiento de pantallas en React y Next | `react-best-practices` |
| Antes de decir «terminado» o abrir el PR | `verification-before-completion` y `auditar` |

Las de terceros llevan arriba un bloque «Metal Work» que manda sobre el resto, y
las propias ganan siempre (`docs/SKILLS-DE-TERCEROS.md`).

## Mapa

```
src/app/(app)/<modulo>/       pantalla (server component) + acciones.ts (server actions)
src/lib/datos/<modulo>.ts     las consultas; el select es explícito
src/lib/dominio/              estados y reglas que no son consulta
src/lib/supabase/server.ts    server-only — la clave de servicio nunca llega al navegador
src/components/ui/            Tarjeta, Tabla, Campo, Boton, Insignia… no reinventarlos
src/types/database.ts         generado por ./scripts/generar-tipos.sh
supabase/migrations/          idempotentes, 202601010000NN_nombre.sql
db/test/checks/               checks en begin/rollback
docs/ANALISIS-ONEDRIVE.md     fuente de verdad de formatos, numeración y códigos reales
docs/PERMISOS.md              qué permiso tiene cada rol, sacado de la base
herramientas/banco/           PostgREST propio para probar pantallas sin Supabase
.claude/agents/               los tres auditores; cómo se lanzan, en la skill auditar
docs/SKILLS-DE-TERCEROS.md    origen, licencia y cambios de cada skill de terceros
```

Una columna nueva no se ve en la pantalla hasta que se agrega **también** al
`select` de `src/lib/datos/*` y se regeneran los tipos. El select es explícito a
propósito.

## Las tres que más caro han costado

1. **El permiso que exige la acción y el que acepta la política tienen que ser el
   mismo.** Si no coinciden, el UPDATE afecta cero filas **sin error** —una fila
   que el RLS esconde no es un error para Postgres—, la acción devuelve `ok` y la
   pantalla dice «listo» sin haber hecho nada. No se cae: miente. Apareció once
   veces. Cruzar siempre el permiso de la acción con el de la política de esa tabla.
2. **Probar como ADMIN no prueba nada.** ADMIN entra por `es_admin()` y nunca toca
   el permiso: las pantallas salen llenas en la prueba y vacías para la gente.
   Comprobar con el rol que hace ese trabajo.
3. **Un documento numerado no se borra nunca**, ni por el administrador: el hueco
   en la serie no lo puede explicar nadie después. Se anula, con motivo, quién y
   cuándo, y queda congelado como evidencia.

## Verificar

Regla de oro: **nada se declara terminado sin haberlo visto funcionar.** No vale
«debería funcionar». Si algo no se pudo comprobar, se dice cuál y por qué —
declarar terminado lo que no se probó es el fallo más caro que se puede cometer
aquí, porque la base tiene datos reales de la empresa.

El código se comprueba con una sola orden, que resuelve `node` sola aunque no
esté en el PATH y da los tres pasos en el orden correcto:

```bash
./scripts/verificar.sh    # tipos de Next, TypeScript, ESLint
```

Su veredicto es su código de salida: no se lee por `| tail` encadenado con `&&`
a un commit, porque el código que vale es el de `tail` y el commit sale aunque
diga «1 de 3 fallan» (pasó el 2026-10-19). Con `next dev` corriendo, o recién
parado, TypeScript puede fallar en `.next/dev/types/validator.ts` a medio
escribir: parar `next dev`, borrar `.next/dev` y volver a correrlo.

Eso no ve la pantalla ni la base. **Terminado aquí son seis cosas:**

1. `./scripts/verificar.sh` en verde.
2. La base probada en SQL, en una transacción que termina en `raise exception`,
   **con el rol real y `set local role authenticated`** — nunca como ADMIN, que
   entra por `es_admin()` y no toca el permiso. La receta, en la skill `datos`.
3. `get_advisors`, si se tocó el esquema.
4. La pantalla vista con la cuenta del puesto: en la nube, en el banco local
   (`herramientas/banco/`) antes del PR; en el equipo Windows, donde el banco no
   corre, en metalworkperu.app con `herramientas/recorrido/mirar.mjs` después de
   unir (el PR lo dice y nunca con la clave temporal común). Los mandos, en la
   skill `diseno` › Comprobación visual.
5. Los auditores que pida la skill `auditar` según lo que cambió revisaron con
   ojos frescos, y lo grave que encontraron está arreglado.
6. Dicho en voz alta qué de eso **no** se pudo comprobar, y por qué.

**Los bloques largos se escriben con `Write`, no con heredoc de bash.** Un
`cat <<'EOF'` de doscientas líneas con `$$` y comillas muere con «unexpected EOF»
y deja el archivo sin escribir, sin que nada avise. El heredoc, para tres líneas.

## Documentación de Next.js 16, sin salir del disco

`node_modules/next/dist/docs/` trae la documentación de la versión instalada,
con la misma estructura que el sitio. Consultarla ahí antes que tirar de memoria:
Next 16 y React 19 cambiaron cosas que el entrenamiento puede tener viejas.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
