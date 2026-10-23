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
  pierde sin aviso (el banco de Administración lo vio el 2026-10-22).
  El error de un campo (un número que ya existe) va en el `error` de su
  `Campo`, que lo marca `aria-invalid`, y no se repite en el aviso de abajo; el
  de un archivo («Falta el PDF»), en el `aviso` de su `ElegirArchivo`. Llevar
  el cursor a un campo que no dice nada deja a la persona sin el porqué.
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
