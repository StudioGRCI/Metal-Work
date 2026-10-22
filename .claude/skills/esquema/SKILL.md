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

- Postgres local corre en el socket `/tmp` puerto `5433`; si no responde (en la
  nube, `pg_ctl` no corre como root y sin `config_file` no encuentra su
  configuración; `jit=off`, como Supabase, ver la skill `datos` › Rendimiento):
  `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/16/main -o '-c config_file=/etc/postgresql/16/main/postgresql.conf -c jit=off -p 5433 -k /tmp' -l /var/lib/postgresql/pg-5433.log -w -t 120 start"`.
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
  Volvió a pasar con el stock (sección 8 de la `20261020196000`): una salida con
  un RQ de PLANTA hacia una unidad se le descontaba al RQ por su línea y a la
  unidad por su código, y sacar 2 bajaba lo separado en 4. Un movimiento que
  lleva dos llaves de dueño se reparte entre ellos una sola vez; el check 416 lo
  prueba con la existencia, lo libre y lo de cada código escritos a mano antes
  y después.
  Y el reparto **se anota en el movimiento al registrarlo**
  (`movimientos_materiales.de_la_unidad`), no se recalcula al leer. La primera
  versión lo deducía después con lo que el RQ es hoy, y una revisión dio seis
  contraejemplos: marcar el RQ «Listo», corregir su código o devolver parte
  cambiaba lo ya descontado sin ningún movimiento, y el orden de dos salidas de
  la misma línea dependía del alfabeto. Si una cuenta depende del estado de otro
  documento en el momento del movimiento, ese estado se congela en el movimiento.
  **Y las filas de antes de esa columna se anotan una vez, en la misma
  migración, no se estiman al leer.** Con `de_la_unidad` se estimó al leer tres
  vueltas seguidas y las tres fallaron: cada función que la usaba daba otra
  cifra (lo libre subía), y la estimación cambiaba con lo que pasaba después
  (un ingreso para la unidad, el código del RQ corregido). Se arregló con
  `anotar_salidas_de_antes()`, que es idempotente. La condición de qué filas
  anotar se mira **con el estado que tenían al moverse**, no con el de hoy: un
  RQ cuyo código se corrigió después quedaba fuera, y el historial de
  `audit_log` dice qué código tenía (la octava vuelta lo encontró). Si la regla
  no se puede reconstruir exacta, se dice en qué casos difiere y hacia dónde,
  sin prometer un sentido que no se probó («lo libre menor, nunca mayor» salió
  falso dos vueltas seguidas), y se prueba con los datos que de verdad hay:
  buscar quién escribe las columnas de las que depende (`grep` en las
  migraciones) y poner en el check el caso común, el raro y el límite conocido.

- **Dos caminos que se excluyen se cierran desde los dos lados, en cada entrada.**
  En la `20261020210000` la OC con boleta empezó a pagarse directo, y la función
  del pago rechazaba la OC con factura registrada; pero nada impedía lo inverso:
  registrar la factura de una OC que Tesorería ya había pagado directo, y pagarla
  otra vez por Cuentas por pagar. Los checks pasaban porque solo probaban el
  sentido que se había escrito; lo vieron los dos auditores. Cuando una regla dice
  «o esto o lo otro», listar **cada** sentencia que puede crear la segunda mitad
  (insertar, devolver una fila quitada, cambiar la llave, pasar a REGISTRADA,
  pagar) y poner la guarda en un disparador propio de cada tabla, sin lista de
  columnas; y en el check, una prueba que falle por cada una de esas puertas.

- **Una función que la aplicación llama por `rpc` devuelve columnas con nombre.**
  Con `returns setof uuid`, Supabase entrega una lista de valores y el banco una
  lista de objetos: `new Set(data)` funcionaba en uno y en el otro no encontraba
  nada, y el desplegable «Factura que anexó Logística» volvía a ofrecer una
  factura ya registrada (2026-10-21, lo cazó `probar-oc-de-varios-rq.mjs`). Se
  escribe `returns table (documento uuid)` y se lee `fila.documento`, como
  `rrhh_codigos_internos`: igual en los dos.

- **Una función que va en un índice se escribe distinto que las demás.** En la
  `20261020210000` las claves `clave_proveedor` y `clave_numero_comprobante` van
  en índices de expresión, y la revisión de la sexta vuelta cazó dos fallos que
  ningún check veía:
  - Se les quitó el `execute` a `authenticated`, como a todo ayudante interno, y
    Postgres evalúa la expresión del índice **con el rol que escribe**: Logística
    no podía anexar una factura ni Contabilidad dar de alta un comprobante
    («permission denied for function»). Los checks que escribían sin `set local
    role authenticated` pasaban. A esas funciones (y a las que ellas llaman) no
    se les revoca el `execute` del rol que escribe en la tabla.
  - Son `immutable`, y Postgres guarda en el índice lo que devolvían al
    escribirse cada fila: si otra migración les cambia el cuerpo con `create or
    replace`, el índice sigue con los valores viejos y la búsqueda por la clave
    no encuentra la fila, sin error. La migración que cambia el cuerpo hace
    `reindex index` de cada índice que la usa.

- **Un `check … not valid` no perdona a las filas viejas: se vuelve a mirar en
  cada `update`.** `not valid` solo se salta la comprobación al crearlo; la
  primera vez que una fila de antes se toca, tiene que cumplirla. En la
  `20261020210000` la factura anexada antes de pedir número no se podía anular
  (el `update` que pone `anulado_en` caía en la regla del número). Al poner una
  regla nueva sobre filas que ya existen, preguntarse qué `update` legítimo les
  queda (anular, corregir) y dejarlo fuera de la regla en la misma expresión
  (`anulado_en is not null or …`), con su prueba en el check sobre una fila
  insertada como era antes.
  Y cuando todo `update` de la fila vieja es legítimo, no hay qué dejar fuera:
  en la `20261022141500` el «archivo de 0 bytes no entra» como CHECK dejó la
  cotización vieja con PDF vacío sin poder rechazarse, aprobarse ni corregirse,
  aunque el UPDATE no tocara esa columna (lo vieron los auditores el
  2026-10-22). Entonces va como disparador `before insert or update of
  <columnas>` que juzga solo el valor nuevo o el que cambió
  (`fn_archivo_no_vacio`), y el check prueba con una fila vieja sembrada con
  `session_replication_role = replica`. El tamaño que juzga es el que guardó
  Storage (`storage.objects.metadata->>'size'`), no el que manda el navegador:
  quien llama a la función puede declarar 4096 bytes de un archivo vacío, o no
  declarar nada. El disparador anota el tamaño real encima del declarado.

- **Una línea de RQ no es de un solo material.** `requerimiento_lineas.material_id`
  es lo que se pidió, pero Logística puede comprar otro
  (`orden_compra_material_detalles.material_id`, otra marca u otra medida) y
  Almacén puede entregar otro del mismo almacén (`registrar_salida_material` solo
  exige el almacén). Todo cálculo de stock por línea —lo separado, lo que llegó,
  lo entregado— cuenta lo comprado en el material comprado y descuenta lo
  entregado de la línea entera, sea del material que sea. Si se filtra por el
  material pedido, lo comprado queda libre y lo pedido separado de más, o lo que
  no salió queda separado para siempre en un RQ ya atendido. En
  `stock_libre_en_almacen` (migración `20261020195000`) el auditor lo encontró
  dos veces, una por cada lado; el check 414 tiene los dos casos: compra de otra
  marca y entrega con otro material. Al escribir el check de algo por línea de
  RQ, incluir siempre una línea comprada y entregada con un material distinto
  del pedido.

- **Redefinir una función que producción pudo cambiar a mano.** Una migración
  que lleva la función entera pisa sin aviso un arreglo pegado en el editor de
  Supabase. Antes de reemplazarla, mirar `md5(replace(prosrc, E'\r', ''))`
  contra el texto que el repositorio conoce (antes o después del cambio) y
  detenerse con un mensaje si no es ninguno (`20261022160000`). `prosrc` se
  guarda tal cual, y `create or replace` conserva los permisos.
