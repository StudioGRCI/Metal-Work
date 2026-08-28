---
name: esquema
description: Convenciones del esquema y el ciclo de validación de Metal Work — cómo se escribe una migración, cómo se prueba con checks, cómo se regeneran los tipos y cómo se corre el banco local. Usar antes de tocar supabase/migrations, db/test o los datos de demostración.
---

# El esquema y su ciclo de validación

Regla de oro del proyecto: **nada se declara terminado sin haberlo visto
funcionar.** El esquema se prueba contra Postgres real, la pantalla contra el
banco local, y la interacción con clic real.

## Migraciones

- Viven en `supabase/migrations/`, numeradas `202601010000NN_nombre.sql`,
  y son **idempotentes**: `create table if not exists`, `drop policy if
  exists` antes de crearla, seeds con `on conflict`. Volver a correr la
  migración deja lo mismo.
- Cada una abre con un comentario que cuenta **por qué existe** en el
  lenguaje de la empresa, no qué hace en SQL. El «por qué» sale de los
  documentos reales (`docs/ANALISIS-ONEDRIVE.md` es la fuente de verdad de
  formatos, numeración y códigos).
- Los seeds que transcriben documentos reales (fichas técnicas, pasos de
  verificación, feriados) usan funciones sembradoras que **reemplazan** la
  lista completa (`sembrar_verificacion`), para que re-ejecutar no duplique.
- Español en todo: tablas, columnas, funciones y mensajes de error. Los
  mensajes de `raise exception` los lee el usuario final — se redactan como
  para él («La OT 2921-2026 no se puede programar sin fecha…»).
- Seguridad de cada objeto nuevo: ver la skill `seguridad`. No es opcional.

## Checks (`db/test/checks/`)

- Un archivo por dominio, `NN_nombre.sql`, dentro de `begin; … rollback;`.
- Ayudantes del shim: `test.afirmar(cond, msj)`, `test.debe_fallar(sql,
  msj)`, `test.crear_usuario(...)`, `test.como_usuario(id)`; para probar RLS
  de verdad: `set local role authenticated` y al final `reset role`.
- psql **no interpola** `:'var'` dentro de bloques `$$`: los IDs viajan con
  `set_config('prueba.x', v, true)` / `current_setting('prueba.x')`.
- Un `insert … select` que devuelve cero filas «pasa» sin evaluar la
  política — cuidado con falsos verdes en `debe_fallar`.
- Los valores esperados se derivan del catálogo, no se escriben a mano,
  para que la prueba siga valiendo cuando la empresa ajuste sus datos.
- Probar el **fracaso primero**: antes de arreglar un error reproducirlo en
  una transacción, y dejar el check que lo habría atajado.

## El ciclo completo, en orden

```bash
./scripts/db-test.sh                         # esquema + todos los checks
./scripts/generar-tipos.sh                   # regenera src/types/database.ts
BANCO_CLAVE='...' ./herramientas/banco/preparar.sh   # rehace mw_demo
node herramientas/banco/servidor.mjs         # API compatible (5599)
npx next dev -p 3111                         # con las variables del banco
BANCO_CLAVE='...' node herramientas/banco/recorrer.mjs  # todas las pantallas
npx tsc --noEmit && npx eslint && npx next build
```

- Postgres local corre en el socket `/tmp` puerto `5433`; si no responde:
  `/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main -o "-p 5433 -k /tmp" start`.
- Columna nueva en una tabla → regenerar tipos **y** agregarla al `select`
  de la consulta que la necesita (`src/lib/datos/*`): el select es explícito.
- Tabla nueva con relación → el banco (PostgREST propio en
  `herramientas/banco/`) resuelve los embeds por FK igual que Supabase; si
  hay dos FKs a la misma tabla, nombrar la constraint en el select
  (`usuarios!tabla_columna_fkey`).

## Datos de demostración (`db/demo/datos-demo.sql`)

- Idempotentes por guardas `if not exists (select 1 from …)` — elegir como
  centinela una tabla que **esta** sección llena, no una que llena otra.
- Cuentan una historia verosímil del taller (una OT en proceso a medio
  verificar, una pausada con motivo…) porque las capturas de presentación
  salen de aquí.
- No usan funciones que exigen sesión (`aplicar_plantilla_ficha`): copian a
  mano con un comentario que explica por qué.

## Numeración y datos reales

Los correlativos son los de la empresa (OT `2921-2026` global y continuo,
cotización `3568-2026`, compra `OC-5581-MW`) vía `series_documentarias`.
Jamás burlarlos insertando números a mano: `siguiente_correlativo` está
cerrado a propósito y el check lo vigila.

**Un documento numerado no se borra nunca**, ni siquiera por el administrador:
el hueco en la serie no lo puede explicar nadie después. Se anula, y la
anulación es un dato completo —motivo obligatorio, quién y cuándo, sellados
por trigger— tras el cual el documento queda congelado como evidencia. El
patrón está en `20260101000034_anular_no_borrar.sql`: trigger propio de
anulación, `fn_..._bloquear_borrado` que siempre levanta excepción, la
política `borrar_*` eliminada y el `grant delete` revocado.

## Trampas

*(Sección viva: aquí se anota lo que salió mal al tocar el esquema. Ver `aprender`.)*

- **`next typegen` antes de `tsc`.** Sin él, TypeScript reporta decenas de
  «Cannot find name 'PageProps'» que no son errores del código y hacen perder
  media hora persiguiendo un fallo inexistente.
