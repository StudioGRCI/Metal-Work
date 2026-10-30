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
- **La función que va en la expresión de un índice** (y las que ella llama) no
  se revoca al rol que escribe en esa tabla, aunque sea un ayudante interno:
  Postgres la evalúa con ese rol, y sin `execute` la tabla deja de aceptar las
  escrituras de la gente (skill `esquema` › Trampas).
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
  quita el archivo si ninguna fila lo nombra. Si el servidor no conoce la acción
  (una pestaña de antes del último despliegue, `UnrecognizedActionError`), no
  corrió: quita el archivo en el acto y dice `SE_ACTUALIZO_EL_SISTEMA`, sin
  pausa ni reintento, que darían lo mismo (vigesimoctava). Ese caso se reconoce
  siempre con `esDeLaVersionAnterior` (`src/lib/envio.ts`), no con la función de
  Next: además anota la pestaña como vieja, para que no se recargue sola al
  volver (se perdía lo escrito y la foto quedaba suelta) y para que nada suba
  antes de su acción: todo lo que sube desde el navegador (`subirArchivoPrivado`,
  `subirAdjunto`, los archivos de subcontratos, planilla y finanzas, la orden
  nueva, la cotización, el plano, la salida de la planilla y las fotos) mira
  `laPestanaEsDeLaVersionAnterior()` antes de tocar Storage (vigesimonovena y
  trigésima). Toda cadena que sube y anota desde el navegador, también el PDF
  de la orden que sube al elegirlo, va dentro de `mientrasSeEnvia` y llama a
  `entro()` solo cuando quedó anotado: si no, «Volver a cargar», el del aviso de
  la pestaña de otro despliegue, la cortaba y dejaba el archivo subido sin
  anotar (D17; C, H5 y R1 de la trigesimocuarta). «Volver a cargar igual» deja
  de esperar solo lo que ofreció no esperar, nunca lo que salió después
  (`cuentaDeEnvios`, F3). Que el id de la acción cambie no es lo de siempre: la clave dura
  14 días y Vercel la conserva, así que el despliegue de todos los días se
  reconoce por la compilación que contesta el servidor
  (`compilacionDelServidor`, en `contarAvisosYDespliegue`), no por un 404. Antes unas pantallas lo dejaban
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
  `subirArchivoPrivado` recuerda qué archivo subió con cada ruta **según la
  última respuesta de Storage**; si es otro, intenta quitar el de antes —la
  política solo deja quitar el que ninguna fila nombra— y sube el elegido.
  Mientras una subida no contesta, lo recordado no coincide con ningún archivo:
  si se recordaba el primero y la del segundo llegaba sin respuesta, volver al
  primero anotaba su nombre con el segundo adentro (pasó dos veces, por el
  reemplazo y por la primera subida). Si no se puede quitar porque una fila lo
  nombra y es el último que Storage dio por subido ahí (`confirmados`) y el
  elegido, es el mismo envío y se anota; si es otro, dice cuál quedó
  (`otroArchivoEnLaRuta`), sin llamar a la base. Lo recordado es por ruta, y
  aparte va la última ruta de cada documento (la ruta sin su extensión): el
  mismo contrato en PDF y después en foto va a otra ruta, y el PDF que no
  quedó se quita de la suya en vez de quedar suelto. Si quedó, lo recordado
  de su ruta sigue ahí: con la memoria solo por documento, volver a la ruta
  del PDF con otro PDF lo daba por adjunto con el primero adentro (pasó en la
  séptima pasada del PR #148). Si la acción cambia la ruta del documento (la
  caja reemplaza su captura), la de antes se vuelve a quitar después del `ok`,
  cuando ya nadie la nombra, aunque el `ok` llegue en otro envío
  (`porQuitarTrasOk`). Y «No quedó registrado» habla solo del archivo de este
  envío: si una fila nombraba la ruta de otro tipo del mismo documento, se
  dice cuál se subió y que no se sabe si quedó. Pero `remove` vuelve vacío
  igual cuando una fila nombra el archivo que cuando no hay nada: la ruta
  cuenta solo si Storage la había dado por subida (`confirmados`), y la
  pestaña recuerda las que sabe vacías (`vacias`: las quitó ella, o Storage
  rechazó la subida a una ruta que estaba vacía). Sin eso, tras un PDF que
  Storage rechazó (413) o cuya subida se cortó, la foto sin respuesta decía
  «ya se subió el PDF» de un archivo que nunca llegó (novena pasada del PR
  #148). Rechazó es un 4xx que no es el 409: un 5xx de la pasarela (502,
  504) puede llegar con el archivo ya guardado, y contarlo como vacía dejaba
  ese archivo suelto tras el `ok` del de otro tipo (décima pasada). La ruta fija
  vale **por envío**, no por ventana: el id que nace en un componente que la
  `Ventana` desmonta vuelve al del padre al reabrirla, y el segundo documento
  de la misma OC chocaba con la ruta del primero. El padre que guarda el id lo
  cambia cuando uno entró (`alAdjuntar`).
- **La sesión se refresca antes de una acción, no durante ella.** El proxy
  (`src/lib/supabase/sesion-proxy.ts`) llama a `getUser` en cada pedido y, a
  90 s de vencer, refresca la sesión y escribe cookies nuevas; si eso pasa en
  una acción, Next las cuenta como de la acción y la responde revalidada, y en
  una pestaña de otro despliegue eso recarga el documento entero aunque la
  acción no revalide (X8 de la trigesimosegunda). `refrescarLaSesionAntesDeCadaAccion`
  (`src/lib/envio.ts`, la monta `RefrescoAlVolver`) envuelve `window.fetch`:
  antes de un POST con cabecera `next-action`, si a la sesión de la cookie le
  quedan menos de 10 min (o cada 5 min, por si la cookie no se lee), pide
  `/auth/sesion` con 4 s de tope, y la acción sale igual si no contesta. No
  toca la cabecera ni el cuerpo de la acción. `/auth/sesion` es un GET que
  refresca solo la sesión de quien llama, con su propio token de refresco, y
  devuelve 204 sin cuerpo; de `getSession` mira solo cuándo vence: quién es lo
  sigue diciendo `getUser`, en el proxy y en cada acción. Lo que el navegador
  lee de la cookie (`sesionEnLaCookie`) sirve para decidir cuándo preguntar,
  nunca para decidir permisos. Si esperó a `/auth/sesion` y en ese rato la
  cookie pasó a ser de otra cuenta, la acción no sale (`OtraCuentaEnLaPestana`):
  quien envía miró la cuenta antes de la espera, y saldría a nombre de la otra.
  La pregunta de la traba, que sale ya sabiendo que es otra, no se corta.
- **La compilación que manda el navegador decide solo si se revalida.** La
  planilla del kardex, el conteo inicial y los avisos mandan `compilacion`
  (`laCompilacionDeLaPestana`) y el servidor no revalida si es de otro
  despliegue (`esDeOtroDespliegue`). Un navegador que mienta ahí consigue, a lo
  sumo, una pantalla sin poner al día o una recarga: el permiso, el RLS y lo
  que se guarda no la miran.
- **«El mismo envío» es todo lo que el envío lleva, no solo su id y su ruta.**
  Con la ruta fija de la ventana (corrección, guía, plano), tras una respuesta
  perdida la persona puede cambiar la cantidad, el motivo o la fecha y volver a
  pulsar con el mismo archivo: id, ruta y persona coinciden y la función
  devolvía `ok` sin haber guardado lo nuevo. La función compara también lo que
  el envío trae (la guía, su fecha y su nombre de archivo; la corrección, una
  huella de su motivo y sus cambios en `correcciones.huella_del_envio`; la toma
  al cambio, sus montos), y si no coincide lo dice: «… ya quedó registrada la
  primera vez que la enviaste: recarga…» (`20261022180000`, `20261022177000`;
  undécima pasada del PR #148). Con ruta nueva en cada envío (finanzas,
  planilla, subcontratos) la ruta ya distingue un envío de otro, y el aviso no
  dice «con otro voucher», que sería falso si eligió el mismo archivo. Lo que
  lleva mucho (el reporte diario con sus trabajos, su gente y sus fotos; el
  ingreso y la salida del vehículo) deja la huella de su envío en
  `huellas_de_envio` (`anotar_envio` al registrar, `mismo_envio` al
  reconocerlo; `20261022194000`, check 432). Las fotos también son archivos:
  `p_fotos jsonb` va en la huella. El detector del check `417` busca funciones
  que reciben una ruta o fotos y devuelven el id existente sin comparar el
  envío, también leyendo la fila (`if v.registrado_por = v_yo then return`) o
  mirando otra cosa (`if salida_en is not null then return`).
- **La subida a una ruta nueva que falla sin un 4xx se quita en el acto**
  (`subirARutaNueva`, `src/lib/ruta-nueva.ts`): un 5xx o un corte pueden llegar
  con el archivo ya guardado, y esa ruta no la vuelve a usar nadie. El voucher
  del pago de la OC con boleta quedaba suelto así aunque el segundo intento
  entrara. **Quitarlo pide que su dueño lo vea:** Storage quita con un
  `DELETE … RETURNING`, y Postgres le aplica también la política de leer. En
  `gastos-ot` y `control-ot` la de leer pedía una fila que lo nombrara, y el
  borrado afectaba cero archivos sin error (duodécima pasada; migración
  `20261022193000`, check 431). «Ninguna fila lo nombra» se pregunta con una
  función `security definer` (`archivo_plano_vinculado`,
  `comprobante_de_gasto_anotado`): un `not exists` bajo RLS cuenta como
  inexistente la fila que el dueño ya no ve, y le dejaría ver y quitar su
  archivo anotado.
- **«Ya quedó registrado la primera vez» no es un rechazo.** La ventana solo
  se cierra (`PieDeVentana`, sin rojo y sin el botón que envía), y la pantalla
  de detrás se pone al día **al cerrarla** (`useAccion` con
  `ventanas-abiertas.ts`; sin ventana abierta, en el acto). En rojo y con el
  botón activo, se cancelaba y se pagaba otra vez desde la tarjeta vieja
  (duodécima pasada); refrescando con la ventana abierta, la página dejaba de
  pintar el botón que la abrió (el vehículo ya salió, la factura quedó pagada)
  y la ventana se desmontaba sola con el aviso a medio leer (decimotercera).
  Al cerrarla, el aviso se va —cualquier aviso de una ventana, también si se
  cerró mientras se enviaba—: un envío que vive fuera de su ventana la volvía
  a abrir con el «ya quedó» y sin botón (decimocuarta). Mientras, los campos
  quedan trabados y el aviso dice que lo cambiado no se guardó.
- **El id de un envío se conserva hasta saber cómo terminó**: se renueva con un
  ok o con un «ya quedó» (`alYaEntrar` de `useEnvio`, que corre al cerrar la
  ventana), nunca al abrir ni al cancelar. Con «No llegó la respuesta»,
  cancelar y volver a abrir, la ventana del pago traía otro id y el mismo pago
  entraba dos veces; ahora el repetido dice que ya quedó, y la tarjeta se pone
  al día al cerrar (decimocuarta, P1). El que no se renueva tras el «ya quedó»
  se queda pegado: cada documento siguiente de la compra lo repetía hasta
  recargar. `alYaEntrar` pone un id nuevo, no lo borra: si la respuesta llega
  tarde, la ventana que se volvió a abrir se quedaba sin id para enviar. Y el
  aviso de una ventana ya cerrada se suelta fuera de la transición del
  refresco, o la ventana nueva sale trabada mientras la señal tarda. Ojo donde la función devuelve el id existente sin comparar el
  envío (la caja diaria): conservar el id ahí haría que lo distinto se diera
  por guardado. Primero la función compara; después se conserva el id.
  **Al volver a abrir, se pregunta a la base** (`useIdDelEnvio(clave)` con
  `consultarEnvio`, en `src/app/(app)/acciones-envio.ts`): si aquel envío
  entró, la ventana lo dice con su número (`EnvioAnterior`) y lleva otro id.
  Sin preguntar, la OS, el RQ o el SC siguiente decía «ya quedó» y no se
  guardaba aunque la lista ya mostrara el primero; y adivinarlo por la
  pantalla (el saldo había bajado) dejaba entrar el mismo pago dos veces en
  cuanto la tarjeta se ponía al día (decimosexta). Una ventana nueva que pide
  documento o dinero lleva su clave en `src/lib/dominio/envios.ts` y su caso en
  `consultarEnvio`; el id que sale con el documento (su factura, su contrato)
  se renueva con él (`alEntrar`). **Lo pendiente vive también en la pestaña**
  (`sessionStorage`): si la puesta al día al cerrar no llega, Next carga la
  página entera, la memoria se va y el mismo pago entraba dos veces
  (decimoctava). Por eso cada llamada lleva su `donde` —la fila de la ventana:
  la OC que se paga, el recibo, la OT del tablero—, o el pendiente de una fila
  lo tomaba la ventana de otra; y el id acompañante lleva el suyo, para que su
  archivo vuelva a la misma ruta. La llave lleva la cuenta con que se pintó la
  pantalla (`CuentaDeLaPestana`, en el layout, con `useLayoutEffect` para que
  esté antes del primer clic): otra cuenta no reusa ese id y, si la primera
  vuelve, lo suyo sigue pendiente —borrarlo al cambiar de cuenta dejaba entrar
  dos veces su pago (decimonovena)—. **Pero lo juzga quien lo registró, no la
  cuenta pintada** (vigésima): al abrir se pregunta por lo pendiente de ese
  lugar con todas las cuentas de la pestaña, y `consultarEnvio(clave, ids)`
  contesta la cuenta y el puesto de la sesión y, de cada id que está, lo que
  quedó y, si la fila no es suya (`creado_por`, `subido_por` o
  `registrado_por`), el puesto de quien la registró. Lo que la sesión mandó
  desde la pantalla de otra cuenta se le dice; mirar solo la cuenta pintada
  dejaba entrar dos veces la OC. Lo que otra cuenta registró con el pendiente
  de otra llave no se le cuenta ni se toca; el de la llave de esta pantalla sí,
  con su número y el puesto de quien tenía la sesión, porque salió de aquí.
  **La pestaña que ya no es de la sesión no envía nada** (vigesimoprimera y
  vigesimosegunda). Quién tiene la sesión lo dice su cookie
  (`sb-…-auth-token`, que `@supabase/ssr` deja legible para su cliente del
  navegador): `laPestanaEsDeOtraCuenta()` la lee en el acto, y la llaman
  `useAccion`, `salio()` y los formularios que suben por su cuenta (conteo
  inicial, planilla, cotización, orden nueva, cronograma, PDF de la orden)
  antes de enviar.
  Esperar el aviso de la otra pestaña (`BroadcastChannel`) dejaba un hueco de
  segundos —llega cuando esa termina de pintarse— en que la OC entraba a nombre
  de la otra cuenta. La traba es una sola para toda la pantalla
  (`CuentaDeLaPestana`, un `<dialog>` modal que vuelve inerte lo demás): la del
  pie de cada ventana dejaba fuera las que no lo usan y los botones de la
  pantalla. Se pone con el cambio de la cookie (`cookieStore`), al volver a la
  pestaña, con el aviso de la otra y al enviar; un aviso no se cree si la
  cookie se puede leer —uno viejo destrababa una pestaña que ya era de otra—.
  Sin la cookie a la vista quedan el aviso y la pregunta al abrir
  (`consultarEnvio` contesta la cuenta de la sesión), y vale la respuesta de la
  última pregunta. Lo que queda: lo que se envíe antes de que la base
  conteste y, aun con la cookie a la vista, lo que ya esperaba en la cola de
  acciones de Next cuando cambió la sesión. Cerrarlo del todo es que el
  servidor compare la cuenta pintada con la de la sesión: pendiente. Se destraba al pintarse con la sesión o si la primera
  cuenta vuelve a entrar; la pestaña no cambia de cuenta por la respuesta, solo
  por el layout —cambiarla escondía lo pendiente de la primera cuando volvía y
  el egreso entraba dos veces—. Un formulario nuevo que envía sin `useAccion`
  llama a `laPestanaEsDeOtraCuenta()` antes de salir. **Cada paso de una
  cadena mira la sesión, no solo el primero** (vigesimotercera): `useAccion` y
  `salio()` miran el toque, pero lo que sigue sale con la sesión de ese
  momento, y el comprobante de la OC quedaba subido por la cuenta que entró a
  media subida. `seguirConLaCuentaDeLaPestana()` lanza `OtraCuentaEnLaPestana`
  antes de cada subida (`subirArchivoPrivado`, `subirAdjunto`,
  `subirArchivoFinanzas`, `subirArchivoSubcontrato`, `subirArchivoPlanilla`),
  antes de anotar lo subido (`anotarSinDejarloSuelto`) y cuando Storage
  rechaza con la sesión cambiada, que no es «No tienes permiso». Lo que sale
  por partes (las fotos de `SelectorFotos`, la planilla y el conteo del
  kardex, los planos por área, la cotización con cliente nuevo) mira antes de
  cada parte y para ahí. El paso que sigue a uno que ya quedó va en
  `pasoTrasLoQueQuedo`, que no lanza: devuelve `ENTRO_OTRA_CUENTA` para que la
  ventana diga qué falta. El archivo que una cadena cortada dejó subido no se
  anota ni se quita con la otra sesión —Storage no la deja—: se quita cuando
  vuelve la cuenta de la pantalla (`cuandoVuelvaLaCuenta`); si en vez de
  volver se recarga, se queda suelto, visible solo para quien lo subió. Lo
  mismo si la otra cuenta entra en la pausa antes de volver a preguntar, tras
  una respuesta perdida: no se pregunta con ella, y el archivo se mira cuando
  vuelva la cuenta (antes se quedaba suelto para siempre, vigesimoquinta).
  **Un borrado con la sesión de otra cuenta vuelve vacío y sin error**, como si
  una fila lo nombrara: ningún borrado de Storage sale del navegador con esa
  sesión. Lo que solo se quita va por `quitarConLaCuenta`, que lo deja para
  cuando vuelva la cuenta, y `subirARutaNueva` lo pide como argumento para que
  nadie lo olvide (el servidor pasa `quitarEnElActo`). Donde el vacío se lee,
  la cuenta se mira antes: `quitarSiSuelto` (en `anotarSinDejarloSuelto`) con
  la traba no pide nada, se deja para la vuelta y entretanto no se sabe —tras un
  rechazo con la traba, el archivo quedaba suelto sin que nadie lo quitara
  (vigesimoséptima)—; `quitarConEstaCuenta` (el 409 y el otro tipo de archivo en
  otra ruta, en `subirArchivoPrivado`) la mira antes y después y, si cambió,
  corta la cadena: con la traba, el vacío decía «quedó registrado la primera
  vez» sin que quedara nada (vigesimosexta). La caja diaria copia la misma
  regla en línea al cambiar la captura. El
  refresco y la navegación tras un envío también esperan
  (`refrescarSiEsDeLaPestana`, `navegarSiEsDeLaPestana`): con la otra sesión
  pintaban su pantalla y se llevaban la traba.
  Una clave nueva en
  `consultarEnvio` compara la columna del autor de su tabla.
  Una migración ya aplicada en producción no se reescribe: su cambio va en
  otra (`20261022195000` lleva el texto que la 160000 cambió después de
  pegarse). Un aviso nuevo de «mismo envío» lleva
  «la primera vez que lo enviaste» para que `yaEntroLaPrimeraVez` lo
  reconozca. **Las fotos nuevas de ese envío no las nombra nadie: se quitan al
  recibir el aviso**, en el envoltorio de la acción (`useFotosDelEnvio`, o
  `quitarFotosSueltas` en el formulario de página; la base no deja quitar las
  de la primera vez), no al pulsar «Cerrar», que puede no llegar. **Sin
  respuesta no se quita nada:** la política de Storage solo protege la foto que
  una fila ya nombra, y la del reporte que todavía está entrando se borraba
  (vigesimosexta). El formulario de página (el reporte diario) además se traba y
  lleva al registro, y el que fija su id al abrirse (el gasto del área) lo
  cambia tras el aviso, o el próximo envío chocaría con el mismo. El aviso dice
  qué quedó y cómo se corrige; «recarga la pantalla» con el formulario vacío se
  leía como que el cambio había entrado.
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
