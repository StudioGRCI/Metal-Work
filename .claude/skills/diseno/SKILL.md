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

- `Tarjeta`, `TarjetaCabecera` (con `titulo`, `descripcion`, `acciones`),
  `TarjetaCuerpo`
- `Tabla`, `TablaCabecera`, `TH`, `TD`, `TR`, `SinDatos` (estado vacío con
  título y descripción)
- `Campo` (etiqueta + ayuda + requerido), `Entrada`, `Seleccion`, `AreaTexto`
- `Boton` (`variante` primario/secundario/peligro, `tamano`, `cargando`)
- `Insignia` y `Punto` con `tono` (exito/aviso/peligro/neutro), `Progreso`

Estructura: `EncabezadoPagina` (migas, título, descripción, acciones) arriba
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
   («Editar etapas», «Personas que elaboran los planos», la merma), historial
   y notas. Siempre al final.

Una sola columna de lectura. Dos columnas solo para bloques del mismo nivel
(Cliente | Datos del trabajo), nunca para mezclar niveles: la rejilla de dos
columnas del Resumen dejaba las etapas al fondo y con un hueco al lado, debajo
de los datos del cliente (2026-10-01). Crear lo que todavía no existe es el
trabajo de la pestaña y va arriba; corregirlo cuando ya existe es
mantenimiento y va al final (las etapas: «Definir» arriba, «Editar» bajo la
lista). Si un aviso remite a otro bloque, lo enlaza con un ancla en vez de
decir «arriba» o «abajo».

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
  toca «Registrar» tres veces con un texto que el servidor rechaza, y tiene que
  dar un envío, el botón desactivado y el texto todavía en el campo.
- `useActionState` sí desactiva su botón a tiempo, pero también vacía el
  formulario tras un rechazo. En formularios largos o del taller, `useEnvio`.
- **Prohibido cerrar o resetear con `useEffect` sobre el resultado** — la
  regla `react-hooks/set-state-in-effect` lo rechaza y ya nos pasó tres
  veces. Se cierra en el `alTerminar` de `useEnvio`, o se muestra «Cerrar» en
  lugar de «Cancelar» tras el éxito.
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
tabla. Entre las dos cosas hay un hueco: si la acción devuelve error, o levanta
excepción, o el usuario pierde la señal, el archivo se queda donde ninguna fila
lo nombra. Ahí **no lo ve nadie y no lo borra nadie**, porque las políticas de
Storage deducen de la ruta a qué orden pertenece y ese archivo ya no pertenece a
ninguna. Pasó con el Excel de un cronograma y hubo que sacarlo a mano, con la
sesión del que lo subió.

La forma correcta es la de `src/lib/adjuntos.ts`: `try`/`catch` alrededor de la
anotación y `storage.remove([ruta])` en **las dos** salidas malas, la del `!ok` y
la de la excepción. Un `if (!r.ok)` solo no basta: es la excepción la que deja el
huérfano. Y si la subida es opcional —el Excel que acompaña a un cronograma ya
cargado—, su fallo no puede tragarse el aviso de lo que sí entró.

Para que el archivo pueda viajar a `ot/{orden}/…` antes de que la orden exista,
el identificador se decide en el navegador con `crypto.randomUUID()` y la base
crea las dos cosas en la misma transacción (ver `emitir_orden_de_cotizacion`).

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
«visto bueno», «no se pudo». Los títulos dicen qué es la cosa; las
descripciones, para qué sirve. Los estados vacíos siempre dicen cuál es el
siguiente paso («Da de alta el primero con el botón de arriba»).

## Comprobación visual

**En esta máquina el banco local no corre** —no hay Postgres ni `psql`—, así que
`recorrer.mjs` y `probar-cotizacion.mjs` no son una opción aquí. La comprobación
que sí funciona es mirar la pantalla **en el despliegue**, después de `git push`
(Vercel tarda 2–3 min):

```bash
MSYS_NO_PATHCONV=1 URL=https://metal-work-sandy.vercel.app USUARIO=studiogrci@gmail.com \
CLAVE='<la clave de prueba>' CAPTURAS="<carpeta del scratchpad>" \
"/c/Program Files/nodejs/node.exe" herramientas/recorrido/mirar.mjs /carrocerias carrocerias 'h1' 'tbody tr'
```

Los selectores que se le pasan **se cuentan y se listan por texto**, y eso es la
prueba: cuántas filas trajo la tabla y qué dicen. La captura PNG no vale como
comprobación —no siempre se puede abrir—, así que una pantalla no se da por vista
sin el conteo y el texto. Sin selectores, `mirar.mjs` solo dice que la página
cargó, que es casi nada. Pantalla nueva → mirarla con los selectores que la
delatan si viene vacía (`tbody tr`, el `h1`, el estado vacío).

Donde el banco sí corre (Linux con Postgres local) el recorrido sigue siendo el
bueno: `node herramientas/banco/recorrer.mjs` visita cada pantalla con sesión
iniciada, junta los errores de consola y guarda captura —pantalla nueva →
sumarla a `RUTAS`—, y `node herramientas/banco/probar-cotizacion.mjs` cubre las
interacciones con botones (emitir, descargar, anular); interacción nueva de peso
→ sumarle sus comprobaciones ahí, con clic real vía `playwright-core` contra
`localhost:3111` (patrón en `herramientas/presentacion/capturar.mjs`).

## Trampas

*(Sección viva: aquí se anota lo que salió mal al construir pantallas. Ver `aprender`.)*

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

- **Una lista de «lo que puede escribir» no sirve para decidir «lo que ve».**
  El 2026-09-14 la pestaña Actividades pasó a recibir solo las áreas cuya hoja
  la persona puede *armar*, y el mismo arreglo decidía qué tablas se pintaban:
  el operario, que reporta pero no arma, se quedó sin su hoja y sin «Reportar
  día» un día entero, y la prueba —hecha solo con Diseño— salió llena. Al
  cambiar qué calcula una prop de permisos, buscar **todos** sus usos en el
  componente y separar en dos props lo que se muestra de lo que se ofrece
  para escribir; y mirar la pantalla con cada rol que la usa, no solo con el
  que motivó el cambio.

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
