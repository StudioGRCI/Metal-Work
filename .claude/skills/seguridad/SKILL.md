---
name: seguridad
description: Convenciones de seguridad de Metal Work — RLS, revokes, secretos y cómo comprobar que una puerta quedó cerrada. Usar antes de escribir cualquier migración, política, función SQL o acción de servidor, y al revisar un diff por seguridad.
---

# Seguridad en Metal Work

El repositorio es **público**. La base tiene los datos reales de una empresa.
Esas dos frases juntas gobiernan todo lo demás.

## Lo que nunca entra al repositorio

- Contraseñas, claves de servicio, cadenas de conexión, correos de cuentas
  reales con su clave. `SUPABASE_SERVICE_ROLE_KEY` no se imprime, no se copia
  a documentos, no se pega en un commit ni en un PR.
- Documentos internos de la empresa (los del OneDrive). Se transcriben a
  migraciones o a `docs/` solo los datos que el sistema necesita, nunca el
  archivo entero.
- Identificadores de sesión o material de autenticación en capturas: revisar
  las capturas antes de subirlas.

## Toda tabla nueva paga el mismo peaje

En la misma migración que la crea, sin excepción:

1. `alter table ... enable row level security`
2. Políticas `select / insert / update / delete` explícitas. La de lectura
   respeta el alcance (`puede_ver_orden`, sede, o permiso); las de escritura
   exigen el permiso del módulo con `public.tiene_permiso('x.y')` o
   `public.es_admin()`.
3. `grant` solo a `authenticated`. **Nunca** a `anon` ni a `public`.
4. `perform public.activar_timestamps(tabla)` — y la tabla debe tener
   `actualizado_en`, porque el trigger se crea igual y revienta después si
   no está (nos pasó con `plantilla_ficha_lineas`).
5. `perform public.activar_auditoria(tabla)` si guarda datos de negocio.
6. `perform public.activar_registro_de_prueba(tabla)` si tiene `id uuid`
   (migración `105`). Sin él, lo que un lote de prueba crea en esa tabla no
   queda anotado y `pruebas_limpiar` no se lo lleva: queda suelto entre los
   datos reales sin que nada avise.

## Toda función nueva

- `set search_path to 'public'` siempre (evita el secuestro de esquema).
- `security definer` solo si de verdad escribe por encima de RLS, y entonces:
  `revoke all on function ... from public, anon;` y `grant execute` solo a
  quien corresponda. Una función de trigger se revoca también a
  `authenticated` — la llama el sistema, no la gente.
- Dentro, el permiso se exige con `public.exigir_permiso('x.y')`, no se
  asume por quién la llama.
- Las vistas que agregan datos llevan `alter view ... set (security_invoker = on)`
  o filtran por sí mismas; una vista sin `security_invoker` corre como dueño
  y salta el RLS de sus tablas.

## Trampas que ya nos mordieron (no repetir)

- **El permiso que la aplicación exige y la política no reconoce.** Es el fallo
  más caro que ha tenido este proyecto y apareció once veces. Si `puede(perfil,
  'x.aprobar')` deja pasar pero la política de la tabla solo acepta `x.editar`,
  el UPDATE o el DELETE afecta **cero filas sin error** —una fila que el RLS
  esconde no es un error para Postgres—, la acción devuelve `ok` y la pantalla
  dice «listo» sin haber hecho nada. No se cae: miente. Antes de cerrar
  cualquier acción de escritura, cruzar el permiso que exige con el que pide la
  política de esa tabla, y comprobarlo **con el rol que va a usarla**. Qué
  permiso tiene cada rol está en `docs/PERMISOS.md`, sacado de la base: cruzarlo
  ahí cuesta un vistazo. Cómo se prueba con el rol real, en la skill `datos`.
- **Un permiso que no tiene ningún rol es una puerta tapiada.** `configuracion.
  ver` no estaba asignado a nadie y once catálogos lo exigían para leerse: el
  desplegable de carrocerías llegaba vacío a todo el mundo salvo al
  administrador, y sin él no se puede cotizar. Al crear un permiso, asignarlo
  en la misma migración; al exigir uno, comprobar que alguien lo tiene.
- **Probar como ADMIN no prueba nada.** ADMIN entra por `es_admin()` y nunca
  toca el permiso, así que las pantallas salen llenas en la prueba y vacías
  para la gente. Todo check y todo recorrido mira al menos una vez con los ojos
  del rol que hace ese trabajo.
- **La tabla deja ver lo que la función tapa.** Si una función devuelve una
  columna en `null` sin cierto permiso (el precio y el margen sin
  `cotizaciones.ver_pdf_comercial`), la tabla donde esa columna se guarda pide
  **el mismo permiso** en su política de lectura, o no tiene `grant select`, y
  **no lleva `activar_auditoria`**: la auditoría genérica copia la fila entera
  a `audit_log`, que se lee con `auditoria.ver` y nada más. Si no, quien tiene
  el permiso más ancho lee la tabla, o su copia en la auditoría, directo por la
  API y ve lo que la pantalla le esconde. Pasó con `codigo_interno_cierres`
  (migración `20261017300000`): `costos.ver` bastaba para leer el margen
  congelado que `codigos_internos_costo` le tapaba al Supervisor General, y
  después la misma fila salía por `audit_log`; las dos las cazó el auditor de
  realización antes del PR. El check de la tabla prueba con un rol que tiene el
  permiso ancho y no el angosto, y espera cero filas en la tabla y en
  `audit_log`. La misma puerta sigue abierta desde antes en `cotizaciones_pdf`,
  que está auditada y guarda el monto de venta.

- **`es_admin() or` delante de una política de «quitar suelto».** Las de
  borrado de Storage dejan quitar solo el archivo que ninguna fila nombra, y la
  pantalla se apoya en eso para limpiar sin miedo. En `cotizaciones-pdf` el
  administrador saltaba la condición y podía borrar el PDF de una cotización
  registrada; la `20261022141500` la puso para todos. El permiso va dentro del
  paréntesis y el «ninguna fila lo nombra», fuera.
- **El blindaje reescribe funciones.** `20260101000013_blindaje.sql` reescribe
  `fn_ot_despues_update` para que use la bitácora interna. Si otra migración
  vuelve a definir esa función con el texto original, reabre la guarda sin
  que nada avise. Regla: para engancharse a un evento de OT se crea un
  **trigger propio**, no se redefine el existente.
- **Revocar y devolver a ciegas.** Al barrer permisos con `revoke`, registrar
  antes `has_function_privilege` y devolver solo lo que existía
  (`20260101000022`): la primera versión reabrió `siguiente_correlativo`.
- **Funciones de extensión.** `unaccent`, `pg_trgm` y `btree_gist` viven en
  `public` pero no son nuestras: excluirlas por `pg_depend deptype 'e'` antes
  de tocar sus privilegios.
- **`test.debe_fallar` con INSERT…SELECT.** Si el `select` devuelve cero filas
  el insert «pasa» sin evaluar la política. Pasar los IDs por
  `set_config`/`current_setting` (psql no interpola `:'var'` dentro de `$$`).

## Cómo se comprueba

- `./scripts/db-test.sh` corre todos los checks; los de seguridad viven en
  `db/test/checks/40_seguridad.sql` y `98_puertas_cerradas.sql`.
- Cada módulo nuevo agrega a su check al menos: un usuario sin permiso que
  **no** ve y **no** escribe, y la escritura legítima que sí entra.
- La pauta del check de puertas: ninguna función ejecutable por `anon`,
  ninguna tabla con RLS apagado, ninguna vista `security definer` sin querer.

## Acciones de servidor (Next.js)

- Validar la entrada con `zod` antes de tocar la base; los identificadores con
  `z.guid()`, **nunca** `z.uuid()` ni `z.string().uuid()`. Desde zod 4 esos dos
  exigen versión y variante RFC 9562 y rechazan ids que Postgres sí acepta, como
  los `md5(...)::uuid` de la carga del inventario del 12/10: la salida de Almacén
  decía «Revisa material, cantidad, motivo y quién recibe» con todo lleno
  (2026-10-13, PR #73). Por lo mismo, una carga por SQL genera sus ids con
  `gen_random_uuid()`, no con `md5()::uuid`.
- Exigir permiso con `exigirPermiso`/`puede` **al principio** de la acción,
  no confiar en que la pantalla escondió el botón.
- Los errores de Postgres pasan por `mensajeDeError` — no filtrar el mensaje
  crudo del motor al usuario.
- Un archivo que el navegador sube a Storage se anota con
  `anotarSinDejarloSuelto` (`src/lib/subida-privada.ts`), no con un `try/catch`
  propio: si la respuesta se pierde, pregunta otra vez con la misma ruta y solo
  quita el archivo si ninguna fila lo nombra. Antes unas pantallas lo dejaban
  suelto para siempre y otras lo quitaban a ciegas diciendo «No se pudo»
  aunque hubiera quedado. La acción que anota contesta `ok` al mismo pedido
  repetido —en la función, por su id **con la misma ruta y la misma persona**;
  en la acción, releyendo la fila por su ruta y quién la anotó—, nunca a uno
  parecido: comparar solo el id, o solo la orden, daría `ok` a otro archivo y
  lo dejaría suelto. Los ocho cobros y pagos que devolvían el id existente sin
  mirar la ruta confirmaban un voucher que ninguna fila nombra
  (`20261022160000`); el check `417` falla si vuelve a aparecer una así.
  La misma ruta sirve para un solo archivo: si la respuesta se perdió y la
  persona elige otro antes de reintentar, Storage contesta «ya existe» con el
  primero adentro, y darlo por subido anotaría el archivo que no eligió.
  `subirArchivoPrivado` recuerda qué archivo subió con cada ruta; si es otro,
  intenta quitar el de antes —la política solo deja quitar el que ninguna fila
  nombra— y sube el elegido. Si no se puede quitar, dice cuál se subió y si
  quedó registrado (`otroArchivoEnLaRuta`), sin llamar a la base. La ruta fija
  vale **por envío**, no por ventana: el id que nace en un componente que la
  `Ventana` desmonta vuelve al del padre al reabrirla, y el segundo documento
  de la misma OC chocaba con la ruta del primero. El padre que guarda el id lo
  cambia cuando uno entró (`alAdjuntar`).
- **Un archivo vacío no es «sin archivo».** En el navegador, el campo que nadie
  tocó llega como un `File` con nombre vacío; uno de 0 bytes es un archivo
  elegido, y se rechaza diciendo que está vacío. Separarlos por `size === 0`
  dejaba de lado, callado, el que la persona sí eligió. **En la acción de
  servidor no vale el nombre:** el campo sin tocar llega sin tipo
  (`application/octet-stream`) y con un nombre que pone el servidor («blob»,
  «undefined»); lo que dice que se eligió un PDF es su tipo. Un `name !== ''`
  en `registrarAdquisicion` rechazó toda factura de Logística sin PDF propio
  con «El PDF está vacío», y solo lo vio el banco (2026-10-22). La base lo
  rechaza igual (`fn_archivo_no_vacio`), pero el aviso sale antes de subirlo.
- El navegador nunca recibe la clave de servicio: `src/lib/supabase/server.ts`
  es `server-only`.

## Cuentas y datos

- Las cuentas de demostración comparten clave: antes de uso real se cambian o
  desactivan, y se activa la protección de contraseñas filtradas en Supabase
  Auth. Esto está anotado en el PDF de pendientes del cliente.
