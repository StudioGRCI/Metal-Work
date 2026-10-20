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
- **Un índice de clave foránea solo se crea si la migración dice cuál de las
  tres cumple**: (a) no existe ya un índice cuya primera columna coincida, (b) la
  aplicación filtra de verdad por esa columna, (c) el padre se borra en algún
  flujo. Ninguna de las tres → no se crea, aunque `get_advisors` lo pida: solo
  añade coste de escritura y otro aviso de «índice sin usar». Está medido en la
  skill `datos`, «Lo que ya se midió»; saltárselo costó 28 índices y una
  migración para retirarlos.

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
./scripts/verificar.sh                        # tipos, TypeScript y ESLint de una vez
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
cotización `3568-2026`, compra `OC-0001-MW`, con número inventado: el de una
OC real no se escribe en el repositorio, que es público) vía `series_documentarias`.
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

- **Una tabla con permiso por columna no entrega la columna nueva.** Desde la
  migración 20261020150000, `tipos_carroceria` se lee columna por columna (el
  precio referencial queda fuera): una columna que se le agregue no la lee
  nadie hasta su `grant select (columna) on public.tipos_carroceria to
  authenticated`, y el select que la pida cae con «permission denied». Y nunca
  se cierra así una tabla que alguna función recibe entera (`puesto(usuarios)`):
  la fila entera exige leer todas las columnas, y en `usuarios` eso tumbó la
  lista de OT para todos (se probó en el banco y se deshizo).

*(Sección viva: aquí se anota lo que salió mal al tocar el esquema. Ver `aprender`.)*

- **Una OT anulada no acepta ningún UPDATE que cambie algo** (migración
  `20261020207000`), ni del administrador ni de una migración. Un backfill sobre
  `ordenes_trabajo` lleva `where estado <> 'ANULADA'` o aborta entero en
  producción; y una cuenta de Auth que figure en una OT anulada ya no se borra,
  porque su `on delete set null` es un UPDATE.

- **Cerrar una columna con permiso por columna rompe `select *` y `%rowtype`.**
  Desde la `20261020165000`, `trabajadores.dni` no se lee con `authenticated`:
  cualquier función `security invoker`, check o script que haga `select *` de
  `trabajadores`, declare `trabajadores%rowtype` o filtre `where dni = …` cae
  con «permission denied for table trabajadores» (le pasó a
  `reporte_diario_agregar_persona` y a los checks 70 y 340). Antes de cerrar una
  columna, `grep -rn "trabajadores" supabase/migrations db/ herramientas/` y
  cambiar cada lectura por columnas explícitas; el DNI se lee por
  `rrhh_dni_de_trabajadores`.

- **Una función con permiso dentro de un cálculo interno cierra el cálculo para
  todos los que la llaman.** `codigo_interno_etapas` exige ver códigos de
  diseño, y `codigo_interno_avance_calculado` la llamaba: un `security definer`
  de Requerimientos que pidiera el avance caía igual, porque `tiene_permiso` mira
  al usuario de la sesión, no al dueño de la función. La `20261020166000` separó
  el cálculo (`codigo_interno_etapas_calculado`, sin permiso y revocado a
  `authenticated`) del envoltorio con permiso. Al reutilizar un cálculo desde
  otro puesto, buscar `exigir_`/`tiene_permiso` en toda la cadena de llamadas.

- **`next typegen` antes de `tsc`.** Sin él, TypeScript reporta decenas de
  «Cannot find name 'PageProps'» que no son errores del código y hacen perder
  media hora persiguiendo un fallo inexistente.

- **Un check sin sesión no puede aprobar una orden, y varios lo intentan.**
  Desde el blindaje (migración `013`), `ot_registrar_evento` exige
  `puede_ver_orden`, y sin usuario en la sesión eso es falso: aprobar una OT
  levanta «No puede registrar eventos en una orden que no le corresponde», que
  es lo que dispara `crear_etapas_ot`. Comprobado contra la base viva el
  2026-09-02. El armazón de un check —crear la orden, aprobarla, ponerla en
  taller— se monta **con un usuario ADMIN** (`test.crear_usuario(..., 'ADMIN',
  ...)` y `test.como_usuario`), no sin sesión y no con el rol que la prueba está
  examinando: si se monta con ese rol, al primer disparador que exija un permiso
  la prueba se cae por el armazón y no por lo que quería probar. Está arreglado
  así en `150_botones_que_no_mienten.sql`; **quedan checks anteriores que
  aprueban órdenes sin sesión y hoy no pasarían** — al tocar uno, arreglarlo con
  este patrón. Que no se note es la otra mitad del problema: `db-test.sh` no
  corre en la máquina de trabajo (ver la memoria del proyecto), así que el
  conjunto se pudre sin que nadie lo vea.

- **Storage no se borra por SQL.** Supabase protege `storage.objects` y
  `storage.buckets` con un trigger (`protect_delete`) que rechaza cualquier
  `delete` directo, aunque el bucket esté vacío: «Direct deletion from storage
  tables is not allowed. Use the Storage API instead». La migración `094` cayó
  entera por eso el 2026-09-09. Un bucket que sobra se deja sin políticas —nadie
  lee ni escribe— y se retira desde el panel de Storage; la migración solo avisa
  con `raise notice`.

- **Una columna generada se suelta antes que sus fuentes.** `drop column` de
  una columna de la que depende una `generated always as (…) stored` se niega
  sin cascade («other objects depend on it»), y el orden dentro de un mismo
  `alter table … drop column a, drop column b` no lo salva. Primero la generada,
  en su propio `alter table`; después el resto. Los índices y checks que nombran
  a la columna sí caen solos con ella. Le pasó a `materiales.codigo_almacen` en
  la `094`.

- **Una segunda llave hacia la misma tabla rompe los embebidos que no la
  nombran.** Un `select('…, reportado:usuarios(nombres)')` funciona mientras la
  tabla tenga una sola llave hacia `usuarios`; al sumarle otra —`revisado_por`,
  en la `097`— PostgREST ya no sabe cuál seguir y la consulta entera falla. Si
  además el código no lanza ese error, la pantalla sale vacía y nadie se entera:
  el diario de la pestaña «Actividades» se quedó en blanco en producción hasta
  que se vio en la revisión. **Antes de sumar una llave foránea, buscar en
  `src/` los embebidos hacia esa tabla** (`grep "usuarios("`) y nombrar la llave
  (`usuarios!tabla_columna_fkey(…)`) o leer de una vista que ya traiga el nombre.

- **`after update of columna` mira el SET, no lo que cambió.** Un disparador
  `after update of corregido_en` no corre cuando esa columna la escribe otro
  disparador BEFORE (`fn_reporte_revision` pone `corregido_en := now()`): la
  lista de columnas se compara con el `SET` de la sentencia, y el UPDATE del
  supervisor solo trae `avance_pct`. La migración `111` nació así y la prueba
  con rol real dio cero avisos (2026-09-16). Cuando la columna la pone un
  BEFORE, el disparador va `after update` a secas y decide adentro con
  `new.x is distinct from old.x`.

- **`create or replace view` sin `with (security_invoker = true)` le borra la
  opción.** Postgres reemplaza las opciones de la vista por las que trae la
  sentencia, así que redefinirla para cambiar un `where` la deja corriendo como
  su dueño, por encima del RLS, sin ningún error. Le pasó a
  `v_compras_credito_sin_comprobante` en la `20261016602000` y solo lo vio
  `get_advisors` («Security Definer View») ya en producción. Al redefinir una
  vista, copiar también su `with (...)`; el check `98` falla si alguna queda sin él.

- **Cambiar qué significa una columna cambia la pantalla que la formatea.** La
  fecha de la línea del gasto del mes en `codigo_interno_lineas` pasó del 1 del
  mes al día de registro (para el tipo de cambio, migración `20261017300000`), y
  el Costeo seguía mostrándola con `periodo()`: decía «10/2026» junto a un gasto
  de setiembre. Ninguna verificación lo ve, porque el tipo no cambió. Antes de
  cambiar el valor de una columna que ya se muestra, buscar en `src/` quién la
  lee (`grep -n "l.fecha\|'GASTOS_DEL_MES'"`) y mirar esa pantalla.

- **Un avance que se mide por partes no se vuelve a contar en el promedio.** En
  la `20261020100000` el plano con peso aportaba su parte de la unidad y, además,
  su actividad entraba al promedio de su etapa, que mide el resto: ponerle 25 %
  a un plano subía la unidad de 33 a 49 sin trabajo nuevo, y los checks lo daban
  por bueno porque sus cifras esperadas se calcularon con la misma regla. Lo vio
  el auditor, no la prueba. Cuando una cifra sale de dos partes, escribir en el
  check la cuenta a mano con lo que **no** debe entrar en cada parte, y que la
  pantalla pinte las partes que da la base en vez de recalcularlas.
