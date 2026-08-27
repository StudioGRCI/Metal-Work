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

Ninguna pantalla se da por lista sin pasar por el banco:
`node herramientas/banco/recorrer.mjs` la visita con sesión iniciada, junta
los errores de consola y guarda captura. Pantalla nueva → sumarla a `RUTAS`
en ese archivo. Interacción nueva → probarla con clic real vía
`playwright-core` contra `localhost:3111` (patrón en
`herramientas/presentacion/capturar.mjs`).
