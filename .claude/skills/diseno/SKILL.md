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

- Acción de servidor + `useActionState`; el resultado es
  `ResultadoAccion<T>` de `src/lib/acciones.ts` y se muestra con un
  componente `Aviso` local (rol `alert`/`status`).
- **Prohibido cerrar o resetear con `useEffect` sobre el resultado** — la
  regla `react-hooks/set-state-in-effect` lo rechaza y ya nos pasó tres
  veces. Alternativas que usamos: mostrar «Cerrar» en lugar de «Cancelar»
  tras el éxito, o llamar la acción directo con `useState` + `useTransition`
  (ver `nuevo-proveedor.tsx`).
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

## PDF de documentos de la empresa

Se arman con `@react-pdf/renderer` en el servidor (`src/lib/pdf/`), con la
paleta del manual y el logo oficial leído del disco. Dos trampas ya pagadas:
el `lineHeight` puesto en el estilo de `<Page>` lo heredan los elementos
`fixed` y **el pie desaparece de la hoja sin avisar** —va en cada estilo de
texto—; y un `fontSize` grande necesita su `lineHeight` explícito o pisa la
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
