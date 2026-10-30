---
name: diseno
description: Convenciones de interfaz de Metal Work — componentes, tema claro/oscuro, formato de fechas y moneda, patrones de formulario con useActionState y las trampas de hidratación. Usar antes de crear o tocar cualquier pantalla o componente.
---

# Diseño de interfaz en Metal Work

La aplicación la usa gente de taller con el teléfono en la mano y gente de
oficina con dos monitores. Cada pantalla se diseña para marcar y consultar
rápido, no para admirarla.

## Componentes que ya existen — no reinventarlos

En `src/components/ui/`:

- `Tarjeta`, `TarjetaCabecera` (con `titulo`, `descripcion`, `ayuda`,
  `acciones`), `TarjetaCuerpo`
- `Tabla`, `TablaCabecera`, `TH`, `TD`, `TR`, `SinDatos` (estado vacío con
  título y descripción)
- `Campo` (etiqueta + ayuda + requerido), `Entrada`, `Seleccion`, `AreaTexto`
- `ElegirArchivo` para todo archivo que se elige en un formulario, nunca
  `Entrada type="file"`: el botón del navegador sale en su idioma («Choose
  File»), corta el nombre y no dice qué pide. Saca del `accept` qué pide
  («Elegir el PDF o la foto») y con `hastaMb` dice el tope y avisa si el
  archivo pasa; el tope ya no se repite en la `ayuda`. Es el mismo en todo
  lugar que pide un documento (DKS, 2026-10-21), también donde se lee o se
  sube apenas se elige: la pantalla le pasa `archivo` (el que guarda),
  `aviso` (por qué no sirvió: no se pudo leer, el rechazo de la subida, o
  «Falta…» al enviar sin él, con el foco en el campo) y `estado` («Leyendo
  el Excel…», «Subiendo…»). Con `archivo` el campo se vacía solo al tocarlo,
  para poder elegir el mismo otra vez: la pantalla no vacía `value`. Antes
  de guardarlo en el estado, `await revisarArchivo(...)` dice si sirve (tipo,
  vacío, tope y la firma de PDF, Excel o Word por dentro), con las mismas
  palabras que el campo; se calcula antes del `setArchivo` para que no
  parpadee el aviso del anterior. Dice «toca» en el teléfono y «haz clic»
  con ratón (`pointer-fine:`): una prueba con Chromium sin `hasTouch` lee
  «haz clic». Donde el documento ya está puesto, el campo no aparece vacío
  como si faltara: «Cambiar el PDF» en la cabecera lo abre, y «No cambiarlo»
  lo cierra. Con `archivo` y `required`, el campo traba el envío también si
  el archivo no sirve: el navegador revisa en el orden en que se ven y no
  salta al primer campo vacío de abajo con el rojo fuera de la vista. Con dos
  documentos del mismo nombre, se distinguen por la hora (la nota, el
  `aria-label` de «Quitar» y su confirmación), y al quitar uno el foco vuelve
  a la tarjeta. Un campo opcional sin `archivo` lleva «Quitar» con el elegido
  (la OC directa decía «Quítalo» y no había cómo): vacía el campo, la
  pantalla se entera por su `onChange` con «nada» y vacía lo que leyó; el
  obligatorio no lo lleva, se cambia eligiendo otro. Lo único aparte es `SelectorFotos` (avance, vehículos,
  reportes, trabajos): varias fotos a la vez, cada una con su miniatura, su
  subida y su «Reintentar», HEIC y achicadas en el teléfono, cámara y
  galería. Habla igual: formatos y tope antes de elegir, el motivo con las
  mismas palabras, y con ratón una sola entrada («Elegir fotos»).
- `Boton` (`variante` primario/secundario/peligro, `tamano`, `cargando`)
- `Insignia` y `Punto` con `tono` (exito/aviso/peligro/neutro), `Progreso`

Estructura: `EncabezadoPagina` (migas, título, descripción, ayuda, acciones) arriba
de toda pantalla; las secciones de un detalle van por pestañas con
`?vista=` en la URL (ver `ordenes/[id]/pestanas.tsx`), y cada pestaña carga
**solo sus datos** en el server component.

## Jerarquía de las pestañas de la OT

Toda pestaña de la OT se lee de arriba abajo en el mismo orden, para que la
gente sepa dónde mirar sin aprender cada pantalla:

1. **La cabecera de la OT, idéntica en todas**: `CabeceraDeOrden`
   (`ordenes/[id]/cabecera-orden.tsx`) con número, estado, cliente, acciones,
   avisos y franja de avance. Una ruta aparte (como `/planos`) la usa igual; no
   se arma otra.
2. **Dónde está y qué falta**: el siguiente paso, lo observado que le toca a
   quien mira y las cifras de la pestaña.
3. **El trabajo de la pestaña**: la acción principal y la lista con la que se
   trabaja.
4. **Para consultar**: datos de referencia, configuración que se toca poco
   («Personas que elaboran los planos», la merma), historial
   y notas. Siempre al final.

Una sola columna de lectura. Dos columnas solo para bloques del mismo nivel
(Cliente | Datos del trabajo), nunca para mezclar niveles: la rejilla de dos
columnas del Resumen dejaba las etapas al fondo y con un hueco al lado, debajo
de los datos del cliente (2026-10-01). Crear lo que todavía no existe es el
trabajo de la pestaña y va arriba; corregirlo cuando ya existe se ofrece como
botón en la cabecera de su tarjeta y cambia la lista por el formulario (las
etapas: «Editar o agregar etapa»), no como otro bloque metido en la lista. Si un
aviso remite a otro bloque, lo enlaza con un ancla en vez de decir «arriba» o
«abajo».

## El tema

Tres reglas y nada más, en `globals.css`:

1. Los colores son variables (`--texto`, `--superficie`, `--borde`,
   `--acento`, `--exito`, `--peligro`, `--aviso`, cada uno con su `-suave`).
   Ningún componente escribe un color hexadecimal.
2. El modo se decide por `data-theme` en `<html>` más `prefers-color-scheme`;
   el interruptor tiene tres estados (claro/oscuro/sistema).
3. La marca tiene dos variantes de logo (`logo-metal-work.png` para fondo
   claro, `-claro.png` para fondo oscuro) y el CSS las intercambia con
   `.marca-en-fondo-claro`/`.marca-en-fondo-oscuro` — no duplicar la lógica.

## Fechas, números y moneda — la trampa de hidratación

**Todo formateo pasa por `src/lib/format.ts`.** Nunca `toLocaleDateString`
suelto. Razones aprendidas a golpes:

- La zona está clavada a `America/Lima`; sin eso el servidor y el navegador
  discrepan y React marca error de hidratación en cada pantalla con fechas.
- `espaciosNormales()` normaliza U+202F/U+00A0 que Intl mete antes de
  «a. m.» y que también rompen la hidratación.
- Una fecha `YYYY-MM-DD` (sin hora) se reordena **como texto**
  (`SOLO_FECHA`), no se convierte a Date — convertirla la corre un día.
- Moneda con `moneda(valor, 'PEN' | 'USD')`; cantidades con `cantidad()`;
  números tabulares llevan la clase `tabular`.

Los enums no se muestran crudos: cada uno tiene su mapa de etiquetas en
`src/lib/dominio/estados.ts` (`definir(ESTADO_OT, valor)` devuelve etiqueta
y tono). Si aparece un texto `CREDITO_30` en pantalla, falta su mapa.

## Formularios

- **Un formulario que escribe se envía con `useEnvio`** (`src/lib/envio.ts`):
  `<form onSubmit={alEnviar}>` y `<Boton type="submit" cargando={enviando}>`.
  El resultado es `ResultadoAccion<T>` de `src/lib/acciones.ts`; el error va
  en un `<p role="alert">` local, y lo que pasa al salir bien —cerrar la
  ventana, avisar, navegar— en el `alTerminar`, que es un evento.
- **Prohibido `<form action={fn}>` con un `useState` para «enviando».** La
  función de un `<form action>` corre dentro de una transición, y React 19 no
  pinta lo que cambia adentro hasta que la acción termina: el botón no se
  desactiva, cada toque de más queda en cola y el registro entra dos o tres
  veces. Pasó con dos contactos iguales y con un reporte de flota que entró tres
  veces con un segundo de diferencia (2026-09-09). La primera vez se culpó al
  tiempo entre el clic y el repintado, y el `if (enviando) return` que se puso
  no sirvió de nada: diecinueve formularios tenían el mismo defecto. Tampoco
  sirve el `isPending` de una transición que solo se prende para el refresco,
  después de la acción. Y React vacía un `<form action>` al terminar aunque
  haya fallado: lo escrito se perdía con el primer rechazo.
- **Se comprueba tocando, no leyendo:** `herramientas/recorrido/doble-toque.mjs`
  (en la nube, la misma prueba dentro de un `probar-*.mjs`) toca «Registrar»
  tres veces con un texto que el servidor rechaza, y tiene que dar un envío, el
  botón desactivado y el texto todavía en el campo.
- `useActionState` sí desactiva su botón a tiempo, pero también vacía el
  formulario tras un rechazo. En formularios largos o del taller, `useEnvio`.
- **El cursor vuelve a donde está el problema después del rechazo**, con
  `useCursorAlRechazo` (`src/lib/envio.ts`): al campo que lo causó, o al aviso
  (`tabIndex={-1}`) si no es de un campo. No se llama a `focus()` dentro del
  `alEnviar`: mientras envía, el `<fieldset disabled>` no acepta el foco y se
  pierde sin aviso (el banco de Administración lo vio el 2026-10-22). Por lo
  mismo, `Ventana` da por enfocable solo lo que no está `:disabled` —un campo
  dentro de un `fieldset disabled` no lleva el atributo propio— y, si ningún
  campo toma el cursor al abrir, se lo queda ella: la que se abría trabada
  dejaba el cursor detrás, sin Escape y con el tabulador por la página
  (vigesimoctava).
  El error de un campo (un número que ya existe) va en el `error` de su
  `Campo`, que lo marca `aria-invalid`, y no se repite en el aviso de abajo; el
  de un archivo («Falta el PDF»), en el `aviso` de su `ElegirArchivo`. Llevar
  el cursor a un campo que no dice nada deja a la persona sin el porqué.
  Tras un envío bien hecho que rehace el formulario sin ventana (el documento
  del tablero de la OT), el cursor va al primer campo del siguiente cuando
  deja de estar trabado, no dentro del `alTerminar`: el botón que lo tenía
  desaparece y caía a la página. Si lo que se rehace es el botón que abrió la
  ventana (otra llave, como el pago de la planilla), ponle
  `data-cursor-vuelve="<nombre>"` y `Ventana` lleva el cursor al único que
  quede con esa marca. Solo al que se rehace igual: un «Anular pago» por fila
  con esa marca mandaba el cursor al de otra persona (decimonovena). Un aviso
  de «listo» de un formulario que se rehace (`key`) va fuera de él y siempre
  puesto (`role="status"` vacío): el que nace ya con su texto no se anuncia.
  Se vacía en el `onSubmit`, antes de `alEnviar`, no dentro de la acción: ahí
  corre en la transición, no se pinta, y el segundo «Documento adjuntado»
  idéntico no se anunciaba (vigésima). Su `<p>` lleva `key` del envío.
- **Una pantalla que ya no es de la sesión queda entera debajo de una traba**
  (vigésima a vigesimosegunda): si en otra pestaña entró otra cuenta,
  `CuentaDeLaPestana` abre un `<dialog>` modal por encima de todo —también de
  la `Ventana` abierta—, con el puesto de las dos cuentas (y el nombre si son
  del mismo puesto), el cursor en el aviso y solo «Recargar la pantalla». Dice
  primero lo que conserva lo escrito (volver a entrar con la primera en la otra
  pestaña) y que recargar lo pierde. Escape no la cierra. El aviso no lleva
  `aria-describedby`: ya tiene el cursor, y con los dos se leía dos veces. Ni
  pinta anillo: es texto donde la traba pone el cursor, no un mando, y la regla
  global de `:focus-visible` respeta `outline-none` (`globals.css`,
  vigesimotercera). Lo de detrás no se
  toca ni se pierde: si la primera cuenta vuelve, se destraba con lo escrito,
  el cursor vuelve donde estaba y se anuncia («Volvió la cuenta de…»). Lo de
  detrás que cambió con la traba puesta —el aviso de una cadena que terminó en
  ese rato— no lo leyó nadie: si el cursor vuelve donde estaba, el anuncio lo
  suma («Mientras tanto: …»); si no puede —la ventana se cerró, el botón tocado
  sigue apagado—, el cursor va a ese aviso, como `AvisoEnfocado`, y el anuncio
  no dice «puedes seguir donde estabas» (vigesimocuarta). Los otros que
  cambiaron (hasta tres: la OS emitida, cuando el que falló es su contrato) los
  suma el anuncio sin repetir el que lee el cursor. Un aviso solo para el
  lector (`sr-only`, un píxel al fondo) no recibe el cursor —la página saltaba
  al fondo—: dice dónde se ve con `data-se-ve-en`, el id del mando visible (el
  botón de la caja), y el cursor va ahí. Si lo enviado lleva a la pantalla que
  sigue, el anuncio dice «Se abre la pantalla que sigue a lo que enviaste.» en
  vez de mandar al cursor a lo que se va (vigesimoquinta). Antes la
  traba iba en el pie de cada ventana: dejaba fuera las que no lo usan, los
  botones de la pantalla y la ventana de una pregunta. Mientras dure, la
  pantalla no se refresca sola (`RefrescoAlVolver`), ni tras un envío que salió
  antes del cambio, ni lleva a la pantalla que sigue: lo hace cuando vuelve la
  cuenta (`refrescarSiEsDeLaPestana`, `navegarSiEsDeLaPestana`). Refrescar con
  la otra sesión pintaba su pantalla y se llevaba la traba sin que nadie
  recargara (vigesimotercera). Recargar con una cuenta
  sin permiso lleva a `/sin-permiso`, que dice con qué cuenta está la sesión y
  ofrece «Salir y entrar con otra cuenta».
- **Las notas de lo que entró se dicen una vez** (`contarLoQueEntro`): varias de
  la misma clase van en una frase con su plural; lo que salió de esta pestaña a
  nombre de otra cuenta, con su número y el puesto de quien tenía la sesión, y
  su nombre si es del mismo puesto que quien lee (`comoSeNombra`), como en la
  traba: «a nombre de Logística», dicho a otra persona de Logística, no decía
  quién fue (vigesimoquinta).
- **Una cola de fotos se corta con la traba** (`SelectorFotos`): cada foto mira
  la sesión antes de subir, no solo la primera. La que se cortó y las que
  esperaban quedan en la lista con «Reintentar» y su vista previa, y se achican
  al reintentar; antes, las que seguían en la cola subían a nombre de la cuenta
  que entró y volvían con «No tienes permiso», que no era cierto. Quitar con ✕
  una foto que todavía sube, o cerrar la ventana mientras sube, la quita en
  cuanto termina: quedaba en Storage sin fila que la nombrara (reporte diario,
  «Reportar» de un trabajo sin orden, «Reportar día», vigesimotercera).
- **Una foto subida se quita solo cuando se sabe que nadie la va a nombrar**
  (`useFotosDelEnvio`, en toda ventana que sube fotos al elegirlas: «Reportar»,
  «Registrar avance», «Reportar día», el ingreso y la salida del vehículo). Se
  quita al cerrar sin enviar, tras un rechazo de la base con la ventana ya
  cerrada, y si el registro entró sin ella o ya había entrado la primera vez.
  **Si no se sabe cómo terminó** —no llegó la respuesta, el servidor cayó—, **se
  queda**, también al cerrar después: el registro pudo entrar con ella, y
  Storage solo protege la que una fila ya nombra. Una pausa ciega antes de
  quitarla borraba la foto de un reporte que sí entró si el servidor tardaba;
  una foto suelta no la ve nadie, un reporte con su foto borrada sí
  (vigesimosexta). Cerrar mientras se envía deja las fotos con ese envío: quitarlas
  en el acto hacía que la base rechazara el ingreso del vehículo («La foto 1 no
  terminó de subir…») sin que nada lo dijera. Lo de cada envío va con él, no con
  la ventana —volver a abrirla mientras el anterior seguía en camino lo
  soltaba—. **Mientras siga en camino, el botón que abre la ventana gira y no
  la abre** (`Boton ocupado`, que no suelta el cursor: apagado, la ventana no
  podía devolvérselo al cerrarse), y al lado se dice que sigue enviándose
  (`EstadoDelEnvio`): la ventana vuelta a abrir salía vacía, con «Registrar»
  girando sin decir por qué, y tapaba el «Reporte registrado.» del primero
  (vigesimoséptima). Ese «sigue» es el `sigue` del hook, que se apaga cuando la
  acción contesta, no el `enviando` de `useEnvio`: ese sigue encendido mientras
  la página se pone al día tras el ok, y «se sigue enviando» asomaba junto al
  verde (vigesimoctava). El botón sí gira, sin texto al lado, mientras dura esa
  puesta al día (`ocupado={sigue || (enviando && !abierto)}`): la ventana abierta
  entonces salía trabada y girando. Mientras `sigue`, el botón lleva
  `aria-describedby` con el `idDelEstado` del hook, y la región de
  `EstadoDelEnvio` está siempre montada (vacía, `sr-only`): la que nace con su
  texto no se anuncia, y al llegar al botón el lector decía «no disponible» sin
  el porqué. En una fila con varios botones que abren ventanas (el vehículo:
  salida, arenado y anular), cada envío lleva su hook y su `EstadoDelEnvio`, y
  todos los botones giran mientras cualquiera siga: la anulación cerrada en
  vuelo cerraba al contestar la ventana de la salida abierta entretanto. Si la
  misma ventana se pinta dos veces (la tarjeta del teléfono y la fila del
  monitor de la orden), las dos comparten el envío con una `clave`
  (`useFotosDelEnvio(bucket, clave)`, y el aviso verde con
  `useEstadoCompartido`): al girar el teléfono, el botón a la vista no sabía del
  envío en camino (vigesimoctava). El verde de esas ventanas («Reporte
  registrado.», «Ingreso registrado…», «Avance del día reportado.») también está
  siempre montado (`className={aviso ? '…' : 'sr-only'}`): cerrada en vuelo, es
  lo único que dice que entró, y el que nacía con su texto no se oía. En
  «Reportar día» el aviso es de la actividad (`reportar-dia:<id>:aviso`), no del
  día: al entrar el de hoy, la página cambia el botón por «Corregir el de hoy» y
  «Otro día», y `useEstadoCompartido` le deja el valor al que monta en la misma
  pintada; el verde duraba 0,3 s (vigesimonovena). Cómo terminó se dice ahí mismo: «El reporte que se estaba
  enviando no se registró: …», o, si no se sabe, «…: No llegó la respuesta…»;
  si ya había quedado la primera vez, sin rojo y diciendo que lo cambiado al
  reenviar no se guardó. Desde una pestaña de antes del último despliegue (la
  acción ya no existe en el servidor), «no se registró» y que hay que recargar,
  no «revisa la conexión»; sus fotos se quitan, también las de la ventana
  abierta, y la ventana pide elegirlas otra vez (lo de toda la pestaña, en el
  punto que sigue). **Mientras se envía, la ventana traba sus campos y el
  selector de fotos** (`fieldset disabled`, con el pie fuera para que
  «Cancelar» siga): una foto elegida entonces no iba con el registro y se
  quitaba sin aviso, y la ✕ quitaba de Storage la que el envío nombraba. El
  envío vive con la ventana, no dentro: la `Ventana` desmonta lo suyo al
  cerrarse, y un `useEnvio` adentro se llevaba el rechazo con él. Ningún
  borrado de Storage sale del navegador con la sesión de otra cuenta, que
  vuelve vacío y sin error: `quitarConLaCuenta` lo deja para cuando vuelva, y
  donde el vacío se lee (`quitarSiSuelto`, `quitarConEstaCuenta`) la cuenta se
  mira antes.
- **Una pestaña de antes del último despliegue no se recarga sola, y lo dice
  arriba** (vigesimonovena a trigesimosegunda). En esa pestaña `router.refresh()` no
  repinta: recarga el documento entero (Next ve otra compilación), y se llevaba
  lo escrito y dejaba suelta la foto ya subida del reporte diario. Las acciones
  **casi siempre conservan su id** entre despliegues (la clave dura 14 días en
  `.next/cache` y Vercel la conserva), así que no basta con esperar un 404: la
  pregunta por los avisos (`contarAvisosYDespliegue`, al volver tras 30 s y cada
  minuto) trae de qué despliegue es el servidor (`compilacionDelServidor`) y
  `RefrescoAlVolver` la compara con la de la pantalla. La pestaña queda en uno de
  tres estados (`useVersionDeLaPestana`): `al-dia`; `nueva`, otro despliegue con
  las acciones vivas, que dice arriba «El sistema se actualizó… Lo que envíes
  todavía entra, pero al enviarlo la pantalla se vuelve a cargar y se pierde lo
  que tengas a medio escribir en otra parte de ella. Envía una cosa a la vez…»
  (no «Termina lo que estás haciendo»: terminar una cosa se llevaba la otra); y `vieja`,
  la acción ya no existe (el primer `UnrecognizedActionError` pasa por
  `esDeLaVersionAnterior`, el único camino: nunca la función de Next directo),
  «…lo que envíes desde aquí no va a entrar…». En los dos deja de repintar.
  Sin respuesta a la pregunta, tampoco: sin red Next pedía la pantalla entera
  al navegador y salía la página sin conexión. El aviso de arriba se monta solo
  entonces, vacío y con el texto en la pintada siguiente (uno fijo en toda
  pantalla quedaba delante de la región de estado de cada una); si lo descubrió
  un envío que ya lo dice junto a su botón, sin región: se oía dos veces. Una
  `Ventana` abierta o que se abre en la pestaña vieja lo dice arriba de su
  contenido (`data-ventana-vieja`), en una región si llega con ella abierta y
  en su `aria-describedby` si ya se sabía al abrirla; con una ventana abierta,
  el aviso de arriba sale sin región, para que se oiga una vez. Si el aviso
  queda fuera de la vista, una franja fija bajo la cabecera lo dice corto, con
  el mismo botón (`data-franja-pestana-vieja`; su `top` se mide de
  `[data-barra-superior]`): en el teléfono, abajo de un formulario largo, nadie
  lo veía (D12 de la trigesimosegunda). «Volver a cargar» espera a que vuelva
  lo que está en camino (`mientrasSeEnvia`) y quita antes lo que la pantalla
  subió y nadie va a nombrar (`alVolverACargar`, hasta 4 s): sin esperar,
  borraba la foto del reporte que el servidor estaba guardando. Cada envío dice
  cuándo entró (`entro()`); si alguno volvió rechazado, sin respuesta o con un
  error, no recarga encima de su aviso (se llevaba «Pon al menos a una
  persona…» a los 90 ms): dice arriba que se lea el aviso junto a su botón, y
  el botón pasa a «Volver a cargar igual», que ya no espera lo que estaba en
  camino ni lo que no entró, pero sí lo que se envíe después (`cuentaDeEnvios`,
  con sus pruebas en `envios-en-camino.test.mjs`): tras un «no entró», el
  reenvío corregido recargaba a los 160 ms y dejaba su PDF suelto (F3 de la
  trigesimocuarta). Un envío nuevo devuelve el aviso a «Volver a cargar»
  (`alEmpezarUnEnvio`), fuera de la transición que envía: dentro, React lo
  pintaba cuando el envío ya había vuelto. A los 10 s
  sin respuesta, lo mismo, diciendo que si entra la pantalla se recarga sola. Si
  lo que entró lleva a otra pantalla, no recarga encima: la cortaba y dejaba la
  de antes, vacía, con el reporte ya dentro (D13 e Importante 2). Si a los 15 s
  esa pantalla no abrió, lo dice («Lo que enviaste ya entró… ya está guardado,
  no lo envíes de nuevo») y el toque siguiente va a ella (`anotarQueSeVa(destino)`,
  o adonde redirigió la acción), no a la de antes, que ofrecía enviarlo otra
  vez (F2 de la trigesimotercera). Toda cadena escrita a mano que envía por su
  cuenta, fuera de `useAccion` (subir y anotar, una planilla fila por fila, un
  conteo por tandas, el PDF de la orden que sube al elegirlo), va dentro de
  `mientrasSeEnvia(async (entro) => …)` y llama a `entro()` solo si todo entró:
  si no, «Volver a cargar» recargaba en el acto con la cotización, el Excel del
  cronograma o el PDF de la orden subidos y sin anotar (D17; C, H5 y R1 de la
  trigesimocuarta). Si esa cadena envía desde una ventana, lleva
  `useEnvioDeLaVentana`, lo de `useFotosDelEnvio` sin fotos: cerrada en vuelo,
  el botón que la abre gira y `EstadoDelEnvio` dice a su lado que sigue y, si no
  entró, por qué («La cotización que se estaba enviando no se registró: …»). Su
  rechazo se quedaba dentro de la ventana cerrada, y arriba se mandaba a leer
  «el aviso junto a su botón», que no estaba (A, H7 y R2). Ese motivo no se
  borra al reabrir la ventana; lo cambia la vuelta del envío siguiente, no su
  salida, que va en la transición y se pintaba tarde, junto al verde nuevo.
  Lo de cada ventana va por su `clave` (`useEnvioDeLaVentana(clave)`, con
  `useEstadoCompartido(…, { guardar: true })`) y sobrevive a que su botón se
  desmonte: «Nueva tarea», una búsqueda, las pastillas de estado o una pestaña
  de la orden se llevaban el botón con el desenlace, y lo que contestaba no se
  decía en ningún lado (diseño H1 y X2 de la trigesimoquinta). «Cancelar» y la
  ✕ cierran por el mismo `cerrar()` del hook: «Cancelar» en vuelo dejaba el
  botón sin girar y el rechazo sin decir (realización H1); por eso el pie de
  la ventana va fuera del `fieldset` trabado (D2 de la trigesimosexta). Si lo
  que entró se dice en la página y no en la ventana, `alEntrar` lo dice en
  verde junto al botón («La corrección que se estaba enviando quedó
  guardada…»): la corrección cerrada en vuelo que sí entraba no lo decía en
  ningún lado. Si ese verde afirma cómo está algo que otro puede cambiar
  («Gerencia revisa esta versión»), lleva `mientras` y el hook `ahora`: se
  calla en cuanto la pantalla dice otra cosa (la cotización ya rechazada
  seguía con el verde; D1 de la trigesimosexta). Donde el botón está en el
  encabezado de la página (subir cotización, registrar avance, reportar un
  trabajo), su estado va en la fila `estado` de `EncabezadoPagina`, debajo, no
  al lado: el texto que aparecía junto al botón lo corría de sitio con el dedo
  encima (H3). Lo mismo en la cabecera de una tarjeta: el estado del
  cronograma va en su renglón arriba del cuerpo (`EstadoDelCronograma`), que
  además sigue a la vista con «Nueva tarea» abierta (D3 y D4). Si el rechazo
  de una ventana cerrada en vuelo no se dice en ningún otro lado, va al aviso
  de arriba («Lo que enviaste no entró, o no se sabe si entró: …»), en vez de
  mandar a leer un aviso que no está: `noEntro(motivo)` en `useAccion`
  (funcionalidad H1), y en las cadenas a mano `empezar(decirArriba)`, con el
  `noEntro` de `mientrasSeEnvia` (D4). La ida a la tarjeta de la OT recién
  cargada sale en el acto o no sale, y nunca recarga: va con `router.push` y
  el resaltado (`target:`) se pone cambiando lo de después de «#»
  (`irALaTarjeta`). Si no puede ir sin llevarse otra cosa (otro envío en
  camino, otra pantalla), el
  encabezado lo dice con «Ver su tarjeta» (Y1, F1 y D6). Tampoco sale si la
  persona tocó algo después de cerrar la ventana: lo que pidió después manda
  (funcionalidad H2 de la trigesimoséptima). «Ver su tarjeta» está apagado,
  con su motivo dicho, mientras haya algo en camino: React junta su ida con
  la transición del otro envío y salía «#A#B», sin resaltar ninguna (Z2).
  Cambiar lo de después de «#» deja la entrada del historial sin el estado de
  Next, y «Atrás» cambiaba la dirección sin cambiar la pantalla: se guarda
  `history.state` antes y se repone después (H1 de los tres auditores). El
  encabezado dice lo que pasó, «Se cargó el código y la OT de la cotización
  N.», no cómo está ahora: «ya tiene su OT» seguía después de que Gerencia la
  anulara (H3). El
  aviso de arriba es una región no atómica (`aria-atomic="false"`): al cambiar
  por qué no recargó, el lector releía sus 53 palabras antes de la frase nueva
  (E de la trigesimocuarta). Ya
  sabida vieja, nada sube a Storage: los ayudantes del navegador
  (`subirArchivoPrivado`, adjuntos, subcontratos, planilla, finanzas), la orden
  nueva, la cotización, el plano por área, la salida de la planilla y las fotos
  miran `laPestanaEsDeLaVersionAnterior()` antes de tocarlo. La foto que se
  elige dice «No se subió: el sistema se actualizó. Vuelve a cargar la pantalla y
  elígela otra vez.», sin «Reintentar», y las ya subidas se quitan en el acto
  (`quitarAlSaberseVieja`): quedan en la lista con su miniatura del disco y
  «Se quitó» encima, sin «Reintentar», con una sola alerta para todas, y debajo
  «Vuelve a cargar la pantalla para subir el reporte.» en vez de «Quita o
  vuelve a subir». El reporte diario, que no pasa por `conFotos`, al enviar
  quita sus fotos y pide elegirlas otra vez (`SE_ACTUALIZO_CON_FOTOS`); las de
  un envío en camino o en duda no se quitan nunca (`esDeUnEnvio`), y si el
  último quedó en duda dice «No se sabe si entró el reporte que enviaste:
  búscalo en Reportes diarios…» en vez de pedirlas otra vez. Una tanda cortada (el conteo inicial, la planilla)
  dice la causa una vez, en el resumen que recibe el cursor; cada fila, «No
  salió: el sistema se actualizó.» sin alerta propia (eran N alertas iguales a
  la vez), y en vez de «Registrar», que fallaría igual, «Volver a cargar la
  pantalla». Una cadena por áreas (el plano) se corta en la primera y no pide a
  la vez recargar y «vuelve a enviar sin cambiar el archivo». Un `catch` con su
  propio «Vuelve a intentar» pasa por `motivoDelFallo`: reintentar desde esa
  pestaña no entra nunca (la cotización con cliente nuevo). En `nueva`, un envío
  que revalida entra y después Next recarga el documento: lo guardado está, y
  se pierden el verde y lo que hubiera a medio escribir en otra parte de la
  pantalla; solo Skew Protection de Vercel lo evita. Por eso lo que se envía
  por partes no revalida en `nueva`: la planilla del kardex y el conteo inicial
  mandan `compilacion` y, si el servidor es de otro despliegue, ponen al día el
  kardex al cerrar su ventana (cortaban la planilla en la primera fila); en la
  pestaña al día revalidan cada fila, porque sin eso «Atrás» al stock con la
  ventana abierta traía el saldo de antes (trigesimosegunda). La campana y la
  lista de avisos, en `nueva`, pintan lo leído desde el navegador (`useAvisos`,
  la acción le dice `otroDespliegue`), y la pastilla «Sin leer» de /avisos
  también (`useSinLeer`). Una acción que no revalida también recargaba si el
  proxy refrescaba la sesión durante ella: Next cuenta esas cookies como de la
  acción y la responde revalidada (X8). Por eso, antes de cada acción, la sesión
  que vence en menos de 10 min se refresca en `/auth/sesion`, un GET que no
  repinta nada (`refrescarLaSesionAntesDeCadaAccion`, que monta
  `RefrescoAlVolver`, ver la skill `seguridad`).
- **Una cadena cortada por la traba dice qué falta.** Si el paso cortado sigue a
  uno que ya quedó (el comprobante tras la OC, el contrato tras la OS o el
  subcontrato, el Excel tras el cronograma), la ventana se cierra con lo que
  quedó y dice qué falta y dónde hacerlo: «…no se adjuntó: en otra pestaña
  entró otra cuenta. Adjúntala desde la lista.» (`pasoTrasLoQueQuedo`):
  callado, la ventana seguiría abierta como si nada hubiera entrado. En lo que sale fila
  por fila (planilla y conteo del kardex, planos por área) lo que no salió se
  queda con su motivo y su botón para enviarlo cuando vuelva la cuenta, y el
  resumen de lo que queda recibe el cursor (`AvisoEnfocado` con `key` por
  intento; en el conteo faltaba hasta la vigesimosexta, y tras «Registrar 1
  material» el cursor caía a la página). Si no quedó nada, la ventana lo dice
  con `NO_SE_GUARDO_OTRA_CUENTA` («No se guardó: en otra pestaña entró otra
  cuenta. Cuando vuelva la tuya, vuelve a enviarlo.»): callada, al volver la
  cuenta nadie sabía si lo enviado había salido (vigesimoquinta). `useAccion`
  lo dice solo cuando la cadena lanza `OtraCuentaEnLaPestana` a medias: el pago
  de Tesorería cortado mientras subía el voucher quedaba con la ventana llena y
  muda (vigesimosexta).
- **La pantalla que se abre tras un envío dice qué pasó.** Su franja
  (`?creada=1` en la orden nueva) es un `AvisoEnfocado`: un `<p>` sin rol no se
  anunciaba y el cursor quedaba en la página (vigesimosexta).
- **El anuncio al volver la cuenta lee lo que se ve** (`innerText`, no
  `textContent`): con `textContent` sumaba «tocahaz clic» de los dos textos por
  puntero de `ElegirArchivo`. El pie de un campo que solo dice su estado
  («1 KB · toca para cambiarlo») lleva `data-no-anunciar`: el cursor ya lo
  tiene delante (vigesimosexta).
- **Lo que se lee de un archivo no pisa lo que la persona escribió.** La
  lectura tarda (un escaneo, segundos): quien escribe el número mientras tanto
  lo perdía al terminar. Se guarda qué campos tocó (un `useRef` con un `Set`,
  vaciado al abrir) y la lectura llena solo los demás; si lo escrito no calza
  con lo leído, se avisa bajo el campo en una línea ámbar con `role="status"`
  («El PDF dice la OT …», «El documento dice US$ 1,180.00: revisa el total»),
  no en su ayuda gris, que se lee como un dato más. «Detectado en el
  documento» se dice solo mientras es lo que se leyó (`ayudaDelMonto`). Lo que el
  documento no trae no pisa lo que sí trae lo escrito: «390-2025» no pasa a
  «390» porque el PDF no dice el año. Al quitar el archivo se va lo que puso
  él, no lo escrito.
- **Prohibido cerrar o resetear con `useEffect` sobre el resultado** — la
  regla `react-hooks/set-state-in-effect` lo rechaza y ya nos pasó tres
  veces. Se cierra en el `alTerminar` de `useEnvio`, o se muestra «Cerrar» en
  lugar de «Cancelar» tras el éxito.
- **Un rechazo que deja el registro creado** (el comprobante que entró en
  borrador y su PDF no subió) vacía el formulario como al registrar, con el
  aviso donde estaba y el cursor en él, hasta que se empieza el siguiente: lo
  escrito ya está en el borrador, y volver a enviarlo choca con su propio
  número. Lleno, invitaba a «Registrar» otra vez después de completarlo en la
  lista (`adquisiciones/formulario.tsx`). Se detecta envolviendo la acción que
  recibe `useEnvio`, no con un efecto sobre el resultado.
- Marcar de a uno (un check, un V°B°) es un `<form>` mínimo por casilla con
  campos ocultos — sin modal, sin recargar el formulario entero (ver
  `ficha-taller.tsx`).
- Todo botón-icono lleva `aria-label`; los iconos decorativos, `aria-hidden`.
  Los estados marcables llevan `aria-pressed`.

## Descargas

Nunca `window.open` después de un `await`: al volver del servidor el clic ya
no cuenta como acción del usuario, el navegador bloquea la ventana en
silencio y el botón «no hace nada» (nos pasó con la descarga de documentos).
Lo que sí funciona:

- Archivo del mismo dominio → un `<a href download>` de verdad, o crear el
  enlace y hacerle `click()` (ver `lista-documentos.tsx`).
- Archivo del almacenamiento de Supabase → **otro dominio**, donde el
  atributo `download` no vale: hay que pedir el enlace firmado ya marcado
  como descarga (`createSignedUrl(ruta, 300, { download: nombre })`).
- Contenido armado en el servidor → una ruta `route.ts` que devuelve el
  archivo con `content-disposition: attachment`; una acción de servidor
  devuelve datos, no adjuntos (ver `cotizaciones/[id]/pdf/route.ts`).

## Subidas

El archivo va primero al almacenamiento y **después** una acción lo anota en su
tabla. Entre las dos cosas hay un hueco: si la acción devuelve error, el archivo
se queda donde ninguna fila lo nombra, y ahí solo lo ve quien lo subió (en
`adjuntos-ot`, por `owner_id` desde la migración `20261017402000`; antes no lo
veía nadie y hubo que sacar a mano el Excel de un cronograma).

La forma correcta es anotar con `anotarSinDejarloSuelto`
(`src/lib/subida-privada.ts`), como ya hacen `subirArchivoPrivado`,
`adjuntos.ts` y las demás: si la anotación devuelve `!ok`, quita el archivo. Si
**no llega la respuesta**, no lo quita a ciegas —la fila pudo entrar, y quitarlo
deja una orden que nombra un archivo que no existe; el banco lo mostró el
2026-10-19 con «Subir PDF»—: pregunta otra vez con la misma ruta y el mismo id.
Para eso **la acción tiene que contestar `ok` cuando es el mismo pedido otra
vez**: o por id (`if exists … then return p_id` en la función), o, ante el
duplicado, releyendo la fila por su ruta —un uuid de esa subida— y comparando
quién y para qué documento (`registrarAdjunto`, `crearOrden`, las tres de la
cotización, `registrarDocumentoCompra`). Si contesta «duplicado» o «ya quedó
registrada», la pantalla dice en rojo «mira si quedó» aunque quedó (lo vio la
auditoría del 2026-10-22). Si ni la segunda vez hay un sí, intenta quitarlo: la
política del bucket deja quitar solo el que ninguna fila nombra. Lo que queda sin
saber se dice: «mira si quedó antes de volver a subirlo». Y si la subida es
opcional —el Excel que acompaña a un cronograma ya cargado—, su fallo no puede
tragarse el aviso de lo que sí entró.

Para que el archivo pueda viajar a `ot/{orden}/…` antes de que la orden exista,
el identificador se decide en el navegador con `crypto.randomUUID()` y la base
crea las dos cosas en la misma transacción (ver `emitir_orden_de_cotizacion`).

**La acción que anota el archivo no llama a `redirect()`.** En Next 16, una
acción de servidor que termina en `redirect()` hace que la promesa que espera el
navegador se **rechace** con el error de redirección: el `catch` que limpia el
huérfano corre también cuando todo salió bien, y borra el archivo de una fila que
ya existe. Pasó con la orden sin cotización el 2026-10-19: se registraba y quedaba
sin PDF, y solo lo vio el banco consultando `storage.objects` después del clic.
La acción devuelve `{ ok: true, datos: { id } }` y el formulario navega con
`router.push` (ver `ordenes/nueva/formulario-orden.tsx`).

## PDF de documentos de la empresa

Se arman con `@react-pdf/renderer` en el servidor (`src/lib/pdf/`), con la
paleta del manual y el logo oficial leído del disco. Dos trampas ya pagadas:
el `lineHeight` puesto en el estilo de `<Page>` lo heredan los elementos
`fixed` y **el pie desaparece de la hoja sin avisar** —va en cada estilo de
texto, y nunca dentro del pie: ni en su caja ni en sus textos, que también lo
borran (pasó con la evaluación de desempeño, 2026-10-01)—; y un `fontSize` grande necesita su `lineHeight` explícito o pisa la
línea siguiente.

## Texto

Castellano peruano de taller, sin anglicismos de oficina: «dar de alta»,
«visto bueno», «no se pudo». Los títulos dicen qué es la cosa. Para qué sirve
va en `ayuda`, detrás del botón «i» (`TituloConAyuda`); la `descripcion`, a la
vista, es solo para lo que cambia: la fecha, el total, cuántos hay, la regla
vigente. Un aviso que pide algo dice su motivo a la vista. Los estados vacíos
siempre dicen cuál es el siguiente paso («Da de alta el primero con el botón de
arriba»).

## Skills de diseño de terceros

`impeccable` y `ui-ux-pro-max` (origen y cambios en `docs/SKILLS-DE-TERCEROS.md`)
sirven para **revisar** lo que se construye con esta skill, no para reemplazarla:

- Esta skill manda. Componentes, tema, marca (logo, letra, íconos Lucide),
  formularios y formatos no se cambian desde ellas; una sugerencia de otra letra,
  otra paleta u otros íconos va a DKS como sugerencia, no al código.
- Toda pantalla de la aplicación es modo **Operate** de `impeccable`: sirven
  `critique`, `audit`, `harden`, `clarify`, `adapt`, `layout`, `distill`,
  `quieter` y `polish`. Se marca y se consulta rápido; no se admira.
- La revisión con ojos frescos la hace `auditor-diseno` (skill `auditar`).

## Comprobación visual

Dónde se mira depende de la máquina. En las dos, con la cuenta del puesto que
usa la pantalla, nunca ADMIN.

**En la nube** (contenedor Linux con Postgres 16 y Chromium en `/opt/pw-browsers/`)
el banco local corre (`herramientas/banco/README.md`) y es donde se mira, antes
del PR. `BANCO_CORREO='<puesto>.local@metalwork.test' BANCO_CLAVE=… node
herramientas/banco/recorrer.mjs` visita cada pantalla con sesión iniciada, junta
los errores de consola y guarda captura —pantalla nueva → sumarla a `RUTAS`—;
sin `BANCO_CORREO` entra como ADMIN y no prueba nada. Los botones se prueban con
clic real contra `localhost:3111` en un `herramientas/banco/probar-*.mjs`:
interacción nueva de peso → su `probar-*.mjs`, que consulta la base después del
clic, con el arranque de `probar-caja-diaria.mjs` (`BANCO_CHROMIUM`,
`--no-sandbox`, cuentas `*.local@metalwork.test`). Los scripts de
`herramientas/recorrido/` aquí no arrancan: buscan Chrome de Windows.

**En el equipo Windows** el banco no corre (no hay Postgres ni `psql`). Las vistas
previas de cada rama en Vercel piden iniciar sesión en Vercel antes de abrir, así
que `mirar.mjs` no entra; el único despliegue que abre es **metalworkperu.app**,
que es producción y solo cambia al unir a `main`. Ahí se mira después de unir:

```bash
MSYS_NO_PATHCONV=1 URL=https://metalworkperu.app USUARIO='<cuenta del puesto>' \
CLAVE='<su clave>' CAPTURAS="<carpeta del scratchpad>" \
"/c/Program Files/nodejs/node.exe" herramientas/recorrido/mirar.mjs /carrocerias carrocerias 'h1' 'tbody tr'
```

La clave la pone quien corre el mando; nunca va al repositorio ni a la memoria,
y **nunca es la clave temporal común**: las cuentas de producción son de gente
real. Si DKS no le dio al hilo una cuenta propia para ese puesto, el mando lo
corre DKS o se dice que la pantalla no se vio. El PR dice que esta mirada queda
para después de unir; si al mirar algo falla, se arregla o se revierte en el
acto y se avisa en el hilo.

Los selectores que se le pasan **se cuentan y se listan por texto**, y eso es la
prueba: cuántas filas trajo la tabla y qué dicen. La captura PNG no vale como
comprobación —no siempre se puede abrir—, así que una pantalla no se da por vista
sin el conteo y el texto. Sin selectores, `mirar.mjs` solo dice que la página
cargó, que es casi nada. Pantalla nueva → mirarla con los selectores que la
delatan si viene vacía (`tbody tr`, el `h1`, el estado vacío). Lo mismo vale para
los scripts del banco.

**El banco aplica las políticas de Storage desde el 2026-10-20**, pero no el
tamaño máximo ni los tipos permitidos de cada cubeta (`herramientas/banco/README.md`
› Lo que respeta y lo que no). Antes firmaba y servía cualquier archivo, y una
pantalla podía mostrar un PDF que Supabase habría rechazado. Igual, toda subida o
quitada de archivo se comprueba en el `probar-*.mjs` consultando `storage.objects`
después del clic, y lo que dependa de una política de Storage se prueba también
en un check con `set local role authenticated`.

## Trampas

*(Sección viva: aquí se anota lo que salió mal al construir pantallas. Ver `aprender`.)*

- **Lo que solo explica no va a la vista, y nada flota sin que lo pidan.** El
  2026-10-19 DKS lo corrigió por segunda vez: «cuadros flotantes que no dan o
  aportan… puede ser un botón de una información para que no ocupe mucho
  espacio». Había un párrafo de «para qué sirve» bajo cada título y cada
  tarjeta, y un aviso con sombra que se quedaba flotando en Tesorería después
  de cada pago. La explicación va en `ayuda` (botón «i», se abre en su lugar) y
  el aviso de la caja, en un botón de la barra que se abre al tocarlo
  (`AvisoDeLaCaja`), salvo lo que pide atención («La caja no se movió»), que
  se abre solo: en el teléfono, una alerta arriba de la página queda miles de
  píxeles por encima de la factura que se acaba de pagar. Antes de
  escribir un párrafo bajo un título o un cuadro `fixed`, preguntarse si cambia
  con los datos: si no cambia, es `ayuda`. Ojo al partir: la cifra o la regla
  vigente se quedan en `descripcion`, o la tarjeta sale vacía para quien no
  edita (pasó con «La regla de tardanza»).

- **Una OT manual y una OT histórica comparten rutas, pero no responsables.**
  En el flujo nuevo Diseño define etapas y planos; Supervisión crea las tareas
  de su área y reporta cada avance con foto. Al reordenar la pantalla, revisar
  `TeToca`, botones, acciones de servidor y políticas de `ot_actividades` con
  los dos tipos de OT. Ocultar un botón no revoca la edición por URL o API.

- **Quien crea un plano y el área de la etapa son cosas distintas.** Diseño e
  Ingeniería crea el plano, pero lo vincula a la etapa del área que lo utilizará
  (por ejemplo Maestranza). Al mostrar etapas elegibles para un plano, filtrar
  por la OT, no por el área Diseño; de lo contrario una OT con etapa válida
  muestra «primero crea la etapa» y bloquea a la propia cuenta de Diseño.

- **Una función nueva debe tener salida para las OT existentes.** Antes de
  ocultar edición con un indicador introducido por migración, consultar cuántas
  OT activas conservan el valor histórico y si tienen trabajo vinculado. Si una
  necesita el flujo nuevo, ofrecer conversión comprobada en la pantalla; de lo
  contrario la función parece terminada, pero el usuario no puede usarla en su OT.

- **El PDF extraído no es todavía una vista previa.** Un `iframe` con una URL
  local puede quedar blanco en el navegador integrado aunque la lectura del
  archivo y el formulario funcionen. Para PDF elegido por la persona, reutilizar
  `VistaPreviaPdf` y comprobar visualmente al menos dos páginas en el despliegue.
  Contar el elemento o verificar solo el texto extraído no prueba que se vea.

- **El menú no es el límite de acceso.** Los permisos de lectura amplios de
  Gerencia o Tesorería pueden llenar el menú de enlaces ajenos a su trabajo.
  Verificar el menú por puesto en escritorio y móvil; comprobar aparte que
  servidor y RLS rechacen una URL directa sin permiso. Ocultar el enlace no
  sustituye esa protección.

- **El menú se ordena por el área que lo usa, no por el módulo que lo construyó.**
  El 2026-10-13 DKS vio «muy desordenado» el menú de Logística, Requerimientos y
  Almacén: cada hilo había colgado su pantalla donde cayó («Abastecimiento» tenía
  compras, recojos, kardex y valorización mezclados, y «Requerimientos» mandaba
  a Logística). Y ordenar el catálogo no bastó: el 2026-10-14, entrando con
  cada cuenta, a Requerimientos le salían los cuatro almacenes de Almacén bajo
  «Almacén» y a Contabilidad «Logística › Proveedores», porque cada permiso de
  lectura colgaba la pantalla bajo el área que la lleva; y las pestañas del
  teléfono salían de un orden único (a Requerimientos le tocaban Kardex, Gastos
  y Precios, y no su lista de RQ). Desde entonces `NAVEGACION` es solo el
  catálogo y **cada puesto tiene su menú en `MENU_POR_PUESTO`**: su trabajo en
  orden (primero lo que espera por él), después «Consultas», y sus cuatro
  pestañas. Una pantalla compartida está en el catálogo una vez por área, con
  el permiso de cada una. **Al agregar una pantalla, sumarla al menú del puesto
  que la usa: no entra sola**, y mirar ese menú completo con su cuenta, en
  escritorio y en teléfono.

- **Una lista de «lo que puede escribir» no sirve para decidir «lo que ve».**
  El 2026-09-14 la pestaña Actividades pasó a recibir solo las áreas cuya hoja
  la persona puede *armar*, y el mismo arreglo decidía qué tablas se pintaban:
  el operario, que reporta pero no arma, se quedó sin su hoja y sin «Reportar
  día» un día entero, y la prueba —hecha solo con Diseño— salió llena. Al
  cambiar qué calcula una prop de permisos, buscar **todos** sus usos en el
  componente y separar en dos props lo que se muestra de lo que se ofrece
  para escribir; y mirar la pantalla con cada rol que la usa, no solo con el
  que motivó el cambio.

- **Una función de un archivo `'use client'` no se llama desde el servidor.**
  Exportar un ayudante puro (un resumen, un formateo) junto a un componente de
  cliente y llamarlo desde una página de servidor compila, pasa TypeScript y
  ESLint, y en la pantalla tumba la página entera: «Attempted to call X() from
  the server but X is on the client». Le pasó a `resumenMedidas` en Carrocerías
  (2026-10-01) y solo se vio al abrirla con la cuenta de Diseño. Las funciones
  puras que usan los dos lados van en `src/lib/dominio/`.

- **Toda `.grid` lleva por base una columna `minmax(0, 1fr)`** (`globals.css`).
  Sin eso, `grid sm:grid-cols-2` en el teléfono tenía una columna `auto` que
  crecía con el texto más largo: Gestión de compras medía 493 px en un teléfono
  de 390 (2026-10-19). Cualquier `grid-cols-*` le gana. Para centrar se usa
  `place-items-center`, no `place-content-center`, y una rejilla dentro de un
  `flex`, un `absolute` o una celda necesita su ancho o su `grid-cols-*`: ya no
  toma el de su contenido. Un `whitespace-nowrap` largo dentro de una rejilla
  ahora se sale de su columna en vez de ensanchar la página: va con `truncate`.

- **Una columna nueva no aparece sola.** Aunque esté en la base y en los tipos,
  la pantalla la ignora hasta que se agrega al `select` explícito de
  `src/lib/datos/*`. El síntoma es un campo vacío sin ningún error.

- **Dos documentos son dos pantallas, no una con condiciones.** La cotización de
  venta y la cotización de trabajo son documentos distintos, los hace gente
  distinta y llevan datos que la otra parte no debe ver: el vendedor no tiene
  por qué mirar el costo del acero. Se intentó dos veces meter las partidas, la
  ficha técnica y los accesorios en la pantalla de venta escondiéndolos con
  condiciones —primero por permiso, después por estado— y la empresa lo devolvió
  las dos veces: una condición tapa el bloque en el estado que se pensó y lo
  deja asomar en el siguiente. Hoy viven en `/cotizaciones/trabajo/[id]`.

  **La regla:** cuando el negocio dice que son dos cosas, se separan por ruta y
  por permiso, no con un `&&`. Si aparece la tentación de añadir una condición
  más para esconder un bloque de otra área, esa es la señal de que falta una
  pantalla. Lo que no se separa se vuelve a colar, y quien lo descubre es el
  cliente mirando por encima del hombro de alguien.

- **Las cantidades se suman y restan redondeadas a sus tres decimales.** La base
  rechaza una cantidad con más, y en el navegador 5.3 − 2.1 da
  3.1999999999999997. La salida del kardex lo proponía como cantidad y como
  `max` (2026-10-21): la base la rechazaba con «Indica material, cantidad…», que
  no era el motivo, no dejaba escribir 3.2, y con 0.1 + 0.2 separados de 0.3 la
  ficha avisaba «Se separó 0 M más de lo que hay». Lo que se puede lo cuenta la
  capa de datos (`stock-almacen.ts` da `disponible` y `de_mas`), y lo que la
  pantalla tenga que componer pasa por `redondearCantidad`
  (`src/lib/dominio/almacen.ts`). Las pruebas con unidades enteras no lo ven: el
  `probar-*.mjs` de una cantidad lleva un material en metros.

- **En una sonda, después del clic que cierra una ventana se espera lo que cambia,
  no a la red.** La ventana se cierra con el resultado de la acción, unos 230 ms
  después del clic, y la pantalla repintada llega entre 0,4 y 1 s más tarde.
  `waitForLoadState('networkidle')` no espera nada: la página ya llegó a ese
  estado al abrirse y la llamada vuelve en el acto. `probar-anular-oc` leyó así
  la fila de la OC antes de que se fuera y falló en todas sus corridas, también
  en `main`, hasta el 2026-10-23. Se espera el localizador del estado esperado
  —`waitFor({ state: 'detached' })` de la fila que se va, o la que aparece con
  `hasText`— con su `timeout`, y la comprobación va después: si a los 15 s no
  cambió, falla, que es lo correcto. Hay unos 58 `networkidle` más en las sondas
  que pueden esconder la misma carrera.
