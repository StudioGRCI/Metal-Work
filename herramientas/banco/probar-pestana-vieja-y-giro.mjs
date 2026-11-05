/**
 * Lo que dejó la vigesimoctava pasada del PR #148, con clic real y la cuenta de
 * cada puesto (nunca ADMIN):
 *
 *   1. La pestaña de antes del último despliegue. Cada compilación cambia el id
 *      de cada acción de servidor, y el servidor contesta 404 con
 *      `x-nextjs-action-not-found` al id viejo (aquí, la cabecera `next-action`
 *      se cambia por CDP por uno que no existe; la respuesta es la del servidor
 *      de verdad). La acción no corrió: se dice que hay que recargar, no
 *      «revisa la conexión», no se reintenta, y nada queda suelto en Storage.
 *      a. «Reportar» un trabajo sin orden (Supervisión de Maestranza) con la
 *         ventana abierta: la foto se quita y la ventana pide elegirla otra vez.
 *         Antes quedaba «en duda», suelta para siempre.
 *      b. Lo mismo cerrada en vuelo: «… no se registró: el sistema se
 *         actualizó…» junto al botón. Mientras sigue, el botón apunta con
 *         `aria-describedby` a una región que ya estaba montada (la que nace con
 *         su texto no la lee el lector).
 *      c. Otra versión del contrato de un subcontrato (Administración): una
 *         sola llamada, sin la pausa ni el segundo intento, y el archivo se
 *         quita. Antes decía «No quedó registrado: no llegó la respuesta».
 *      d. El conteo inicial del kardex (Almacén): al leer el Excel y al
 *         registrar, el motivo es recargar.
 *   2. La anulación de un vehículo (Requerimientos) cerrada en vuelo: la fila
 *      entera gira y no abre otra ventana; lo que conteste se dice en la fila.
 *      Antes «Anular» no era parte del estado de la fila, y al contestar cerraba
 *      la ventana de la salida abierta entretanto.
 *   3. «Reportar día» de una OT al girar el teléfono (una cuenta OPERARIO del
 *      banco, sembrada como las de probar-administracion): la orden pinta cada
 *      actividad dos veces, y la que aparece al girar sabe del envío en camino
 *      y de su desenlace. Y el reporte entra: el banco mandaba `[]` como `{}` a
 *      la columna jsonb y ck_materiales_usados_array lo rechazaba.
 *
 * Y lo que dejó la vigesimonovena:
 *
 *   1b. El «Reporte registrado» que llega con la ventana ya cerrada sale en una
 *       región montada desde antes: la que nace con su texto no la lee el lector.
 *   1d. El conteo inicial cortado por la pestaña vieja dice la causa una vez, en
 *       el resumen; las filas dicen «No salió» sin una alerta cada una, y en
 *       vez de «Registrar», que volvería a fallar, ofrece volver a cargar.
 *   1e. El reporte diario a medio llenar en la pestaña vieja: al volver tras
 *       31 s ya no se recarga solo (Next recarga el documento entero si
 *       `router.refresh()` ve otra compilación, y se perdía lo escrito y la foto
 *       quedaba suelta); arriba se dice que el sistema se actualizó. Al «Subir
 *       reporte», la foto se quita y se pide elegirla otra vez. Sin despliegue,
 *       al volver se repinta como siempre y sin aviso.
 *   1f. La planilla sin internet del kardex, como el conteo.
 *   1g. La cotización con cliente nuevo dice que hay que recargar, no «Vuelve a
 *       intentar», que nunca entraría.
 *   1h. El plano a dos áreas: una sola acción, una subida y un borrado, y un
 *       mensaje que no pide a la vez recargar y reenviar.
 *   3.  La parte se arma sola en un banco nuevo (antes dependía de que hubiera
 *       corrido probar-documentos-al-elegir), dice «Avance del día reportado» en
 *       la copia a la vista y en la otra al girar, y deja al OPERARIO
 *       desactivado.
 *
 * Y lo que se cerró antes de la trigésima: una vez que la pestaña se sabe
 * vieja, lo que se elija o se envíe desde ella ni sube a Storage, porque al
 * recargar, como pide el aviso de arriba, quedaría suelto.
 *
 *   1c. El segundo «Adjuntar» del contrato no sube el archivo ni llama a la acción.
 *   1e. La foto que se elige después de «Subir reporte» no sube, lo dice y no
 *       ofrece «Reintentar».
 *   El aviso de arriba solo está montado en la pestaña vieja (fijo en toda
 *   pantalla quedaba delante de la región de estado de cada una) y nace vacío,
 *   para que el lector lo oiga.
 *
 * Y lo que dejó la trigésima:
 *
 *   1c. Si el banco no tiene ningún subcontrato, registra uno con la sesión de
 *       Administración: antes dependía de SC-0001-2026 y en un banco nuevo
 *       tumbaba la suite entera.
 *   1e. Al saberse vieja la pestaña al volver, la foto ya subida se quita en el
 *       acto, queda sin miniatura con una sola alerta, y debajo se pide volver
 *       a cargar, no «Quita o vuelve a subir». Descubierta al enviar, el aviso
 *       de arriba está sin región: el del botón ya lo dice.
 *   1i. El despliegue de todos los días: la acción conserva su id (Next guarda
 *       la clave en .next/cache y Vercel la conserva) y solo cambia la
 *       compilación de las respuestas. Antes la pestaña no se enteraba y se
 *       recargaba sola. Ahora, al volver y en el sondeo, lo dice arriba sin
 *       recargar ni repintar; la foto sigue; «Volver a cargar» la quita antes
 *       de recargar; sin señal al volver no sale la página sin conexión; y el
 *       reporte entra con su foto.
 *   1j. La ventana que pregunta al abrirse por su envío anterior descubre la
 *       pestaña vieja y lo dice dentro; abierta otra vez, nace con el aviso.
 *   1k. El PDF de la orden: la segunda vez, ya sabida vieja, ni sube.
 *
 * Y lo que dejó la trigesimoprimera, también en el despliegue que conserva los
 * ids (la pestaña «nueva»), donde casi todo envío repinta y Next recarga el
 * documento entero:
 *
 *   1e. La foto quitada al saberse vieja la pestaña conserva su miniatura, con
 *       «Se quitó» encima: con tres eran tres cuadros iguales.
 *   1f-conserva. La planilla del kardex con un ingreso y dos salidas entra
 *       entera: cada fila repintaba, y Next recargaba a mitad de la planilla.
 *   1j. Con la ventana abierta, solo la ventana lo anuncia; arriba, sin región.
 *   1l. «Marcar todos leídos» y un aviso de la campana no recargan la pantalla
 *       ni se llevan el reporte a medio llenar, se sepa o no todavía que hubo
 *       un despliegue; la campana los pinta leídos.
 *   1m. «Volver a cargar» con el reporte en camino lo espera: el reporte entra
 *       con su foto y lleva a él. Antes quitaba la foto y el reporte no entraba.
 *   1n. El reporte que no se sabe si entró, en la pestaña que se sabe vieja:
 *       su foto no se quita ni dice «Se quitó», y debajo se pide buscarlo antes
 *       de subirlo otra vez.
 *
 * Y lo que dejó la trigesimosegunda:
 *
 *   1o. Con la sesión vencida (la cookie dice que vence ya), la acción no la
 *       refresca: antes pregunta `/auth/sesion`. Si el proxy la refrescaba en
 *       la acción, Next la respondía revalidada y la pestaña «nueva» se
 *       recargaba al descubrir el despliegue y al tocar un aviso. Con la
 *       sesión al día, la acción siguiente no pregunta otra vez.
 *   1o-conteo. El conteo inicial en «nueva», con la sesión vencida, entra sin
 *       recargar.
 *   1p. «Volver a cargar» no recarga encima de lo que no entró: el reporte en
 *       camino que vuelve rechazado (1p-rechazo) o sin respuesta
 *       (1p-sin-respuesta) deja su aviso y lo escrito, arriba se dice por qué
 *       y el botón pasa a «Volver a cargar igual»; el que no contesta en 10 s
 *       (1p-colgado) lo dice y deja recargar igual, también desde la franja
 *       que queda fija bajo la cabecera al bajar a 390; y el que entró y lleva
 *       a otra pantalla que tarda (1p-destino-lento, sin service worker) no se
 *       corta con otra recarga.
 *   1q. «Atrás» al stock con la ventana de la planilla abierta (Almacén a
 *       1440) trae el saldo nuevo: sin revalidar, Next lo traía de su
 *       historial.
 *   1r. La pastilla «Sin leer» de /avisos baja con lo marcado leído en
 *       «nueva»: seguía en el número de antes.
 *
 * Y lo que dejó la trigesimotercera:
 *
 *   1p-se-va. El reporte entró y su pantalla tarda más de 15 s: arriba se dice
 *       que ya está guardado, y el toque siguiente va a esa pantalla con su
 *       foto, no al formulario de antes, que ofrecía subirlo otra vez.
 *   1s. «Volver a cargar» espera también lo que va por su cuenta, fuera de
 *       `useAccion`, con la ventana cerrada en vuelo: «Subir cotización»
 *       (1s-cotizacion, Ventas) y el Excel del cronograma (1s-cronograma,
 *       Diseño). Antes recargaba en el acto y el archivo quedaba subido sin
 *       anotar; ahora, cuando entra, recarga, y nada queda suelto.
 *
 * Y lo que dejó la trigesimocuarta:
 *
 *   1s-reenvio. La cotización con un número que ya existe, cerrada en vuelo
 *       (Ventas): el botón que abre la ventana gira, y el rechazo se dice a su
 *       lado y en el aviso de arriba; reabrir no lo borra.
 *       Después el reenvío corregido, otra vez cerrado en vuelo: el aviso de
 *       arriba vuelve a «Volver a cargar» y el toque lo espera. Antes se
 *       quedaba en «igual», recargaba a los 160 ms y dejaba su PDF suelto.
 *   1s-cronograma-sin-respuesta. El cronograma cerrado en vuelo cuya respuesta
 *       no llega (Diseño, a 390): junto a «Subir cronograma», que no se sabe si
 *       quedó.
 *   1s-orden-pdf. El PDF de la orden, que sube al elegirlo (Administración):
 *       «Volver a cargar» espera a que quede anotado. Recargaba a los 180 ms.
 *
 * Y lo que dejó la trigesimoquinta:
 *
 *   1s-reenvio, además: el estado de «Subir cotización» va bajo el
 *       encabezado, y el botón no se mueve cuando aparece.
 *   1t-cronograma. «Cancelar» con el cronograma en camino (Diseño): el botón
 *       gira y dice que sigue; «Nueva tarea» se lleva el botón y su
 *       «Cancelar» lo devuelve girando; el rechazo se dice a su lado, y otra
 *       «Nueva tarea» no lo borra. Antes el envío y su desenlace se perdían.
 *   1t-correccion. La corrección cerrada en vuelo que entra (Ventas): lo dice
 *       en verde junto a su botón. Antes la tarjeta cambiaba callada.
 *   1t-dos-tarjetas. «Dar código y cargar la OT» de una cotización entra con
 *       la ventana de otra abierta y escrita (Administración): no recarga ni
 *       se va; el encabezado dice que ya tiene su OT, con «Ver su tarjeta».
 *       Cuando la otra entra con su ventana abierta, va a su tarjeta,
 *       resaltada y sin recargar, con las dos OT y nada suelto. Antes
 *       recargaba y se perdía lo escrito o la otra OT.
 *   1t-motivo-arriba. Una ventana de `useEnvio` cerrada en vuelo y rechazada
 *       en «nueva» (Ventas, la unidad con una placa que ya está): arriba se
 *       dice por qué, no se manda a leer un aviso que no existe.
 *
 * Y lo que dejó la trigesimosexta:
 *
 *   1t-cronograma, además: lo que dice va en el renglón de la tarjeta, y
 *       «Subir cronograma» no se mueve cuando aparece; con «Nueva tarea»
 *       abierta y el botón fuera, el renglón dice que sigue y después el
 *       rechazo. 1t-correccion, además: «Cancelar» cierra en vuelo, y el verde
 *       se calla cuando Gerencia la rechaza. 1t-dos-tarjetas, además:
 *       «Cancelar» cierra en vuelo.
 *   1u-cronograma-arriba. El cronograma rechazado con la ventana cerrada y
 *       «Nueva tarea» abierta, en «nueva» (Diseño): arriba dice por qué.
 *   1u-rechazo-se-queda. La OT que entra con su ventana cerrada va a su
 *       tarjeta sin recargar, y el «Ya hay una OT» de la otra sigue dicho
 *       (Administración). Antes la recarga se lo llevaba.
 *   1u-ida-otra-pantalla. La OT que entra con el PDF de una orden todavía
 *       subiendo no se va a su tarjeta: lo dice el encabezado, y cuando la
 *       subida termina nada se lleva la orden nueva a medio escribir
 *       (Administración). Antes la ida salía después, desde ahí.
 *   1u-pdf-aviso. «PDF corregido guardado.» y «Se quitó…» se dicen en la
 *       orden y se van al salir de ella (Administración). Antes volvían.
 *
 * Y lo que dejó la trigesimoséptima:
 *
 *   1t-dos-tarjetas y 1u-rechazo-se-queda, además: desde la tarjeta a la que
 *       se fue (sola o con «Ver su tarjeta»), al menú y «Atrás» vuelve a
 *       Cotización en un paso, y «Adelante» y «Atrás» siguen. Antes la
 *       dirección cambiaba y la pantalla no. En 1u-rechazo-se-queda la OT que
 *       va detrás se detiene hasta que la rechazada quitó su PDF: si
 *       contestara antes, habría dos en camino y no iría sola.
 *   1v-ver-su-tarjeta-en-camino. Con otra OT en camino, «Ver su tarjeta» está
 *       apagado y dice por qué; cuando vuelve, lleva a la tarjeta con un solo
 *       «#» (Administración). Antes la línea se iba y no llevaba a ningún lado.
 *   1v-ver-su-tarjeta-nueva. En «nueva», «Ver su tarjeta» y después «Volver a
 *       cargar»: recarga, sin decir que algo enviado ya entró (Administración).
 *   1v-ida-no-pisa-el-menu. La OT cerrada en vuelo entra después de tocar el
 *       menú: abre Órdenes, no la tarjeta, y al volver a Cotización la línea
 *       que lo decía ya no está (Administración).
 *   1v-cronograma-se-va. Lo que entró del cronograma se va al salir de la
 *       orden; el Excel que no quedó sigue dicho (Diseño).
 *   1v-subida-se-va. «Cotización subida y enviada a Gerencia…» se va al salir
 *       de Cotización (Ventas).
 *
 * Y lo que dejó la trigesimoctava:
 *
 *   1v-ver-su-tarjeta-en-camino, además: el botón no se mueve al encenderse.
 *   1w-ida-no-pisa-otra-ventana. «Nuevo subcontrato» cerrado en vuelo entra
 *       con el siguiente abierto y escrito: no se lo lleva, y la línea de
 *       arriba dice que quedó, con «Ver el subcontrato» (Administración).
 *   1w-ida-no-pisa-el-menu. El subcontrato que entra después de tocar el menú
 *       abre Órdenes, y arriba lo dice; la ✕ quita la línea.
 *   1w-ida-sigue. Con la ventana abierta y nada tocado, el subcontrato va a su
 *       pantalla; el cliente nuevo va a su ficha, o lo dice arriba si se tocó
 *       el menú (antes, un `redirect()` del servidor iba igual).
 *   1w-atras-cerrada y 1w-atras-abierta. La OT que entra después de «Atrás»,
 *       con su ventana cerrada o abierta, no se lleva la lista pedida: lo dice
 *       el encabezado con «Ver su tarjeta».
 *   1w-cronograma-entro y 1w-subida-entro. El cronograma (Diseño) y la
 *       cotización (Ventas) cerrados en vuelo que entran con la persona en
 *       otra pestaña o pantalla: al volver se dice, en pasado, que entraron.
 *   1x-la-que-sale-se-lleva-la-linea. La ida que sí sale se lleva la línea de
 *       la que no salió antes (Administración, subcontratos).
 *   1x-trabajo-con-mas y 1x-orden-con-mas. En el teléfono, el trabajo
 *       (Supervisión) y la orden (Administración) que entran con «Más»
 *       abierta: el formulario se traba y lo dice junto al botón, un segundo
 *       toque no manda nada, en otra pantalla lo dice la línea, y llegar a la
 *       orden por la lista se la lleva.
 *   1x-trabajo-atras-con-mas y 1x-orden-atras-con-mas. El trabajo y la orden
 *       que entran con el formulario vuelto a montar por Atrás y Adelante,
 *       vacío, y «Más» abierta: lo dice arriba.
 *   1x-clic-derecho y 1x-dedo-que-desplaza. Ni el clic derecho en el menú ni
 *       el dedo que desplaza desde un enlace son pedir otra pantalla: el
 *       cliente nuevo va a su ficha.
 *   1x-enter-y-lector. El menú pedido con Enter o con el clic de un lector de
 *       pantalla sí lo es: abre Órdenes y la línea lo dice.
 *   1y-aviso-mientras-entra. Abrir un aviso de la campana mientras entra el
 *       trabajo (Supervisión, a 1280 y a 390) también es pedir su pantalla:
 *       lleva a ella, y la línea dice que el trabajo quedó, con su enlace.
 *   1y-reporte-que-entro. El reporte que entra con «Más» abierta se queda
 *       trabado con su foto; al saberse vieja la pestaña, la foto no se quita
 *       ni dice «Se quitó», y «Volver a cargar» tampoco la toca.
 *   1y-la-ot-se-lleva-la-linea. La OT de «Dar código y cargar la OT» va a su
 *       tarjeta sin la línea de otro documento encima (Administración).
 *   1z-rechazo-de-la-orden, 1z-rechazo-con-un-aviso, 1z-rechazo-del-trabajo y
 *       1z-rechazo-del-reporte. El rechazo que vuelve cuando la persona ya pidió
 *       otra pantalla (el menú, un aviso, «Más») lo dice arriba, en rojo y con
 *       el camino de vuelta al formulario; ahí sigue el motivo, y al enviar otra
 *       vez se va. 1z-rechazo-que-se-queda: sin pedir otra, va en el formulario.
 *   1z-la-ot-y-la-linea. La OT que no va a su tarjeta porque la persona pidió
 *       Órdenes deja la línea de otro documento; si se queda en Cotización, el
 *       encabezado la dice y la línea se va.
 *   1za-502-con-la-persona-fuera. El trabajo que entra y cuya respuesta llega
 *       como un 502 de la pasarela, con la persona ya en otra pantalla: arriba
 *       dice que no se sabe si se guardó, no que no se guardó.
 *   1za-la-ventana-de-la-orden. «Registrar unidad» en la orden nueva registra
 *       la unidad y no la orden; y el envío de esa ventana, rechazado o no, no
 *       se lleva el rechazo de la orden que dice la línea de arriba.
 *   1za-ya-habia-quedado. El reporte que ya había quedado la primera vez, con
 *       la persona en otra pantalla: arriba lo dice, con el enlace al reporte.
 *   1za-gasto-ya-habia-quedado. El gasto de área, que no tiene adónde verlo:
 *       con el formulario vuelto a montar por Atrás y Adelante, el menú o la
 *       otra pestaña de la OT, arriba lo dice y se queda hasta su envío
 *       siguiente (Diseño).
 *   1za-tipo-de-cambio y 1za-lo-que-enviaste. El rechazo de un formulario de
 *       pantalla (el tipo de cambio, Contabilidad) y el «no se sabe» de uno sin
 *       nombre (la regla de tardanzas, RR. HH.) también se dicen arriba.
 *   1zb. Lo que vuelve a medias o se resuelve en otro lado: el plano que
 *       llega a un área y no a otra (la versión de otro plano no se lleva su
 *       línea; reenviado y otra vez a medias, con la persona ahí lo dice el
 *       formulario, y con el formulario plegado mientras sube, arriba; el
 *       que vuelve a fallar entero, plegado o fuera, no la cambia), el
 *       comprobante en borrador (completarlo en su fila la quita, y
 *       registrar otro desde el mismo formulario no),
 *       el PDF de la orden (de vuelta lo dice el campo, y el segundo rechazo
 *       también sube a la vista), la sub-vista, dos formularios sin nombre, el
 *       reenvío con otra casilla y el que vuelve por otra pestaña de su lista
 *       con otros campos: los dos entran y se llevan su línea. Y la fila de
 *       una lista: quitar otra fila no se lleva su línea, y su propio envío sí.
 *   1zc. Lo que elige la búsqueda en la misma ruta (?codigo=, ?material=): el
 *       plano de un código que no se guarda con la persona ya en otro código,
 *       al que llegó por la campana (el otro empieza vacío, y arriba se dice
 *       el rechazo con su camino de vuelta), y el mínimo de otro material, que
 *       entra sin llevarse la línea del primero.
 *   1zd. El plano de Diseño: «Editar el plano» guarda, y el motivo con que la
 *       base rechaza una versión se dice sin doble punto, junto al botón y arriba.
 *       Las correcciones se cierran con la pantalla ya al día, con la página
 *       lenta en ponerse al día: el plano, la actividad y el material de la OT
 *       (Diseño), lo pactado de un subcontrato (Administración) y una cuenta de
 *       la caja (Tesorería); mientras guardan siguen abiertas con «Cancelar»
 *       apagado, las ventanas sin X ni Escape y el pie dice que ya entró, y
 *       vueltas a abrir enseguida traen lo guardado. Al cerrarse la del plano,
 *       el cursor no salta si la persona ya escribía en otro plano. La ventana
 *       trabada dice que ya entró aunque su pie sea propio, y Ctrl+Enter no la
 *       manda otra vez; si tarda más de 8 s, lo dice y ofrece «Volver a cargar»
 *       (o espera al otro envío de la pestaña que va en camino). Tras «No llegó
 *       la respuesta» o el 502 de una corrección que entró, se pone al día
 *       trabada. En línea, mientras una nota de verificación o unas fechas de
 *       etapa se guardan, las demás filas no se abren; las etapas corregidas
 *       vuelven con lo guardado, y las altas (material, subcontratista; la
 *       caja chica, en 1zd-cuenta-tarda) se siguen cancelando en vuelo. En la
 *       orden nueva, la unidad y el cliente cancelados en vuelo entran a la
 *       lista sin elegirse, y junto a su campo se dice; la unidad que entra
 *       después de cambiar el cliente no va a la lista del nuevo. La corrección
 *       que no se sabe si entró no recarga la pantalla en una pestaña de otro
 *       despliegue (sepa la pestaña que lo es o se lo diga el servidor al
 *       preguntar), sin conexión ni sin sesión: la ventana sigue abierta con lo
 *       escrito; mientras pregunta lo dice, y a los 3 s se suelta. La que no
 *       vuelve nunca lo dice a los 15 s, con «Volver a cargar», que no la espera.
 *   En las 1z, las 1za, las 1zb y las 1zc, la línea dicha en otra pantalla llega a la vista.
 *   Las vueltas «al menú y Atrás» esperan a ver la otra pantalla
 *       (`irYVolver`): pegadas a su commit, React dejaba montado lo que se
 *       olvida al salir, algo que nadie alcanza con el dedo (R4).
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE.
 * SOLO=1a,2 corre solo esas partes, y las que empiezan así (1i son 1i-volver,
 * 1i-sondeo y 1i-sin-senal; 1f también corre 1f-conserva; 1o, 1o-conteo; 1p,
 * las cinco de arriba; 1s, las cinco; 1t, las cuatro; 1u, las cuatro; 1v, las cinco;
 * 1x, las ocho; 1y, las tres; 1z, las seis, las seis 1za, las nueve 1zb,
 * las dos 1zc y las quince 1zd).
 */
import ExcelJS from 'exceljs'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { escribirCodigo } from './campo-codigo.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  mtz: process.env.SUPERVISOR_MTZ ?? 'sup.mtz.local@metalwork.test',
  administracion: process.env.ADMINISTRACION ?? 'administracion.local@metalwork.test',
  almacen: process.env.ALMACEN ?? 'almacen.local@metalwork.test',
  requerimientos: process.env.REQUERIMIENTOS ?? 'requerimientos.local@metalwork.test',
  diseno: process.env.DISENO ?? 'diseno.local@metalwork.test',
  rrhh: process.env.RRHH ?? 'rrhh.local@metalwork.test',
  ventas: process.env.VENTAS ?? 'ventas.local@metalwork.test',
  gerencia: process.env.GERENCIA ?? 'gerencia.local@metalwork.test',
  contabilidad: process.env.CONTABILIDAD ?? 'contabilidad.local@metalwork.test',
  colaborador: process.env.COLABORADOR ?? 'colaborador.local@metalwork.test',
  operario: 'operario.giro@banco.test',
  tesoreria: process.env.TESORERIA ?? 'tesoreria.local@metalwork.test',
}
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const base = new pg.Client({
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.BANCO_BASE ?? 'mw_demo',
})
await base.connect()
const consulta = async (sql, valores = []) => (await base.query(sql, valores)).rows
const existe = async (bucket, ruta) =>
  (await consulta(`select 1 from storage.objects where bucket_id = $1 and name = $2`, [bucket, ruta ?? ''])).length === 1

/** Lo que haría `correo` desde la pantalla, con su sesión y su permiso: `set local role authenticated`. */
async function comoLaCuenta(correo, hacer) {
  await base.query('begin')
  try {
    await base.query(`select set_config('request.jwt.claims', json_build_object('sub', (select id from usuarios where correo = $1), 'role', 'authenticated')::text, true)`, [correo])
    await base.query('set local role authenticated')
    await hacer()
    await base.query('commit')
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}
const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const quieta = (pagina) => pagina.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})
async function ir(pagina, url) {
  await pagina.goto(url, { waitUntil: 'load' })
  await quieta(pagina)
}
async function hasta(leer, cumple, ms = 20000) {
  const fin = Date.now() + ms
  let ultimo = await Promise.resolve().then(leer).catch(() => null)
  while (!cumple(ultimo) && Date.now() < fin) {
    await new Promise((r) => setTimeout(r, 250))
    ultimo = await Promise.resolve().then(leer).catch(() => null)
  }
  return ultimo
}
// La OT de un formulario del informe semanal con colaboradores en su equipo.
// Recién vuelta a pintar, la pantalla puede no tener todavía sus OT en la
// lista, o no haber despertado: se leen y se eligen otra vez.
async function elegirOtConColaboradores(pagina, prefijo) {
  for (let vez = 0; vez < 3; vez++) {
    const ots = await hasta(() => pagina.locator(`#${prefijo}-ot option`).evaluateAll((l) => l.map((o) => o.value).filter(Boolean)), (l) => l?.length > 0, 10000)
    for (const ot of ots ?? []) {
      await pagina.locator(`#${prefijo}-ot`).selectOption('')
      await pagina.locator(`#${prefijo}-ot`).selectOption(ot)
      if ((await hasta(() => pagina.locator(`#${prefijo}-persona option`).count(), (n) => n > 1, 2000)) > 1) return ot
    }
  }
  return null
}
const esperarSubidas = (pagina) => pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })

const SE_ACTUALIZO = 'El sistema se actualizó mientras tenías la pantalla abierta'
const SIN_RESPUESTA = /No llegó la respuesta|Revisa la conexión|revisa la conexión/
const ID_VIEJO = 'f'.repeat(42)

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const CELULAR = { width: 390, height: 844 }
const GIRADO = { width: 844, height: 390 }

async function entrar(correo, viewport = { width: 1280, height: 900 }, { compilacion = false, sinSw = false } = {}) {
  const movil = viewport.width < 500
  // `sinSw`: sin el service worker, el documento también pasa por CDP y se puede demorar (`lento`).
  const contexto = await navegador.newContext({ viewport, isMobile: movil, hasTouch: movil, timezoneId: 'America/Lima', ...(sinSw ? { serviceWorkers: 'block' } : {}) })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    const t = m.text()
    // El 404 de la acción vieja y el error que Next anota por él son lo que se prueba.
    if (m.type() === 'error' && !/Failed to fetch|net::|404|UnrecognizedActionError|Server Action/.test(t)) errores.push(t.slice(0, 300))
  })
  // Lo que nadie atrapó: la consola lo anota con el texto de arriba, que se deja
  // pasar, y una acción desconocida sin atrapar se lleva la pantalla.
  pagina.on('pageerror', (e) => errores.push(`sin atrapar: ${String(e?.message ?? e).slice(0, 300)}`))
  await ir(pagina, `${BASE}/ingresar`)
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  await quieta(pagina)

  // `despliegue`: desde ahora cada acción sale con un id que el servidor no
  // conoce, como desde una pestaña vieja. `marca`: la acción cuyo cuerpo la
  // lleva se detiene antes de salir hasta `soltar()`; sale con el id que diga
  // `despliegue` en ese momento. Con `compilacion`, además, las respuestas RSC
  // llegan con otro x-nextjs-deployment-id mientras dure `despliegue`, como las
  // de otra compilación: con eso Next recarga el documento entero.
  //
  // `conservaIds`, con `despliegue`: el despliegue de todos los días. Next
  // guarda la clave de los ids en .next/cache y Vercel conserva esa carpeta,
  // así que el servidor nuevo conoce las acciones de la pestaña: no se cambia
  // el id, y lo que cambia es la compilación que dicen sus respuestas (la
  // cabecera, y en el cuerpo la `b` de Next y la que contesta
  // contarAvisosYDespliegue). La de la pantalla se lee de la página al entrar,
  // y la que la pestaña manda (la campana) sale como la de antes.
  //
  // `perder`: la respuesta de la acción cuyo cuerpo lo lleva no llega, como
  // con la señal que se corta después de que el servidor guardó. `romper`:
  // llega como un 502 de la pasarela, en HTML, como cuando Vercel corta
  // después de que el servidor guardó.
  //
  // `lento`: { patron, ms }, los pedidos (no acciones) cuya dirección calza se
  // demoran `ms` antes de salir, como la pantalla de destino con poca señal.
  // `sesion` cuenta los pedidos a /auth/sesion, donde la pantalla refresca la
  // sesión antes de una acción. `sinSesion`: la pregunta de si la pantalla
  // llegaría (/auth/sesion?comprobar) no llega al servidor, como sin conexión.
  // Con `compilacion` y `despliegue`, la respuesta a esa pregunta dice la
  // compilación nueva (`x-compilacion`), como la diría el servidor nuevo.
  //
  // `contar`: cuántas acciones salen con eso en el cuerpo (`contadas`); las de
  // la campana también son acciones y no cuentan.
  //
  // `cortarSubida`: la subida a Storage cuya ruta lo lleva se detiene como la
  // `marca`, y al soltarla se corta sin llegar, como la señal que se va.
  // `saltarSubidas`: cuántas de las que calzan pasan antes de la que se corta.
  // `soltarLa(marca)` suelta solo la detenida con esa marca (o esa ruta).
  const cdp = await contexto.newCDPSession(pagina)
  const patrones = [{ urlPattern: '*', requestStage: 'Request' }]
  if (compilacion) patrones.push({ urlPattern: '*', requestStage: 'Response' })
  await cdp.send('Fetch.enable', { patterns: patrones })
  const corte = { despliegue: false, conservaIds: false, marca: null, retenidas: 0, esperan: [], acciones: 0, documentos: 0, rsc: 0, storage: [], reescritas: 0, perder: null, perdidas: 0, romper: null, rotas: 0, lento: null, demorados: 0, sesion: 0, sinSesion: false, preguntasCortadas: 0, cortarSubida: null, saltarSubidas: 0, contar: null, contadas: 0 }
  corte.compilacion = (await pagina.content()).match(/\\"compilacion\\":\\"([^\\"]+)\\"/)?.[1] ?? null
  corte.soltar = () => {
    for (const listo of corte.esperan.splice(0)) listo()
  }
  corte.soltarLa = (marca) => {
    const i = corte.esperan.findIndex((listo) => listo.marca?.includes(marca))
    if (i >= 0) corte.esperan.splice(i, 1)[0]()
    return i >= 0
  }
  const cuerpo = (r) =>
    r.postDataEntries?.length ? r.postDataEntries.map((x) => Buffer.from(x.bytes ?? '', 'base64').toString()).join('') : (r.postData ?? '')
  cdp.on('Fetch.requestPaused', async (e) => {
    const seguir = (extra = {}) => cdp.send('Fetch.continueRequest', { requestId: e.requestId, ...extra }).catch(() => {})
    const h = Object.fromEntries(Object.entries(e.request.headers).map(([k, v]) => [k.toLowerCase(), v]))
    if (e.responseStatusCode !== undefined || e.responseErrorReason !== undefined) {
      const responder = (extra = {}) => cdp.send('Fetch.continueResponse', { requestId: e.requestId, ...extra }).catch(() => seguir())
      if (h['next-action'] && corte.perder && !e.responseErrorReason) {
        const enviado = cuerpo(e.request)
        if (!enviado || enviado.includes(corte.perder)) {
          corte.perder = null
          corte.perdidas++
          return cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'ConnectionReset' }).catch(() => responder())
        }
      }
      if (h['next-action'] && corte.romper && !e.responseErrorReason) {
        const enviado = cuerpo(e.request)
        if (!enviado || enviado.includes(corte.romper)) {
          corte.romper = null
          corte.rotas++
          return cdp
            .send('Fetch.fulfillRequest', {
              requestId: e.requestId,
              responseCode: 502,
              responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }],
              body: Buffer.from('<html><body><h1>502 Bad Gateway</h1></body></html>').toString('base64'),
            })
            .catch(() => responder())
        }
      }
      if (!corte.despliegue || e.responseErrorReason) return responder()
      if (new URL(e.request.url).pathname === '/auth/sesion') {
        const conLaNueva = (e.responseHeaders ?? []).map((x) => (x.name.toLowerCase() === 'x-compilacion' && x.value ? { name: x.name, value: 'compilacion-nueva' } : x))
        return responder({ responseCode: e.responseStatusCode, responseHeaders: conLaNueva })
      }
      const responseHeaders = [...(e.responseHeaders ?? []).filter((x) => x.name.toLowerCase() !== 'x-nextjs-deployment-id'), { name: 'x-nextjs-deployment-id', value: 'compilacion-nueva' }]
      if (h['next-action']) {
        if (!corte.conservaIds || !corte.compilacion) return responder()
        // Lo que contesta el servidor nuevo a una acción que conoce: dice su compilación.
        const leido = await cdp.send('Fetch.getResponseBody', { requestId: e.requestId }).catch(() => null)
        if (!leido) return responder()
        const texto = Buffer.from(leido.body, leido.base64Encoded ? 'base64' : 'utf8').toString('utf8').split(corte.compilacion).join('compilacion-nueva')
        corte.reescritas++
        return cdp
          .send('Fetch.fulfillRequest', {
            requestId: e.requestId,
            responseCode: e.responseStatusCode,
            responseHeaders: responseHeaders.filter((x) => !/^(content-length|content-encoding|transfer-encoding)$/i.test(x.name)),
            body: Buffer.from(texto).toString('base64'),
          })
          .catch(() => responder())
      }
      if (h.rsc !== '1') return responder()
      return responder({ responseCode: e.responseStatusCode, responseHeaders })
    }
    if (e.resourceType === 'Document') corte.documentos++
    if (new URL(e.request.url).pathname === '/auth/sesion') {
      corte.sesion++
      if (corte.sinSesion && new URL(e.request.url).searchParams.has('comprobar')) {
        corte.preguntasCortadas++
        return cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'ConnectionRefused' }).catch(() => {})
      }
    }
    if (corte.lento && !h['next-action'] && corte.lento.patron.test(e.request.url)) {
      corte.demorados++
      await new Promise((listo) => setTimeout(listo, corte.lento.ms))
    }
    // El repintado, no lo que Next pide por adelantado de los enlaces.
    if (h.rsc === '1' && !h['next-action'] && !h['next-router-prefetch']) corte.rsc++
    const objeto = e.request.url.match(/\/storage\/v1\/object\/([^?]+)/)?.[1]
    if (objeto && e.request.method !== 'GET' && e.request.method !== 'OPTIONS') corte.storage.push(`${e.request.method} ${objeto}`)
    if (objeto && e.request.method === 'POST' && corte.cortarSubida && objeto.includes(corte.cortarSubida)) {
      if (corte.saltarSubidas > 0) {
        corte.saltarSubidas--
        return seguir()
      }
      corte.cortarSubida = null
      corte.retenidas++
      await new Promise((listo) => corte.esperan.push(Object.assign(listo, { marca: objeto })))
      return cdp.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'ConnectionReset' }).catch(() => {})
    }
    if (e.request.method !== 'POST' || !h['next-action']) return seguir()
    corte.acciones++
    if (corte.contar && cuerpo(e.request).includes(corte.contar)) corte.contadas++
    if (corte.marca && cuerpo(e.request).includes(corte.marca)) {
      const marca = corte.marca
      corte.marca = null
      corte.retenidas++
      await new Promise((listo) => corte.esperan.push(Object.assign(listo, { marca })))
    }
    if (!corte.despliegue) return seguir()
    if (corte.conservaIds) {
      // La compilación que manda la pestaña (la campana) es la de antes del despliegue.
      const enviado = cuerpo(e.request)
      if (!corte.compilacion || !enviado.includes(corte.compilacion)) return seguir()
      return seguir({ postData: Buffer.from(enviado.split(corte.compilacion).join('compilacion-vieja')).toString('base64') })
    }
    const headers = Object.entries(e.request.headers).map(([name, value]) => ({ name, value: name.toLowerCase() === 'next-action' ? ID_VIEJO : value }))
    return seguir({ headers })
  })
  return { pagina, contexto, errores, corte }
}

/** Las regiones `role="status"` montadas ahora, por id: la del botón tiene que estar desde antes. */
const regionesMontadas = (pagina) =>
  pagina.evaluate(() => [...document.querySelectorAll('[role="status"][id]')].map((e) => e.id))
/** El texto de lo que nombra `aria-describedby` del botón, o null. */
const loQueDescribe = (boton) =>
  boton.evaluate((b) => {
    const ids = b.getAttribute('aria-describedby')
    if (!ids) return null
    return ids.split(' ').map((id) => document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? `(${id} no existe)`).join(' | ')
  })
const idsQueDescribe = (boton) => boton.evaluate((b) => (b.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean))

/**
 * Anota, para cada región `role="status"` donde aparece `texto`, si ya estaba
 * montada al llamar: la que nace con su texto el lector no la anuncia.
 * `leer()` da la lista, en el orden en que aparecieron.
 */
async function vigilarElVerde(pagina, texto) {
  await pagina.evaluate((texto) => {
    for (const e of document.querySelectorAll('[role="status"]')) e.dataset.deAntes = '1'
    window.__verdes = []
    const mirar = () => {
      for (const e of document.querySelectorAll('[role="status"]')) {
        if (!e.dataset.vistoVerde && (e.textContent ?? '').includes(texto)) {
          e.dataset.vistoVerde = '1'
          window.__verdes.push(e.dataset.deAntes === '1')
        }
      }
    }
    new MutationObserver(mirar).observe(document.body, { subtree: true, childList: true, characterData: true })
  }, texto)
  return { leer: () => pagina.evaluate(() => window.__verdes ?? []) }
}

/** Lo que hace el teléfono al cambiar de aplicación y volver `ms` después: blur, y focus con el reloj adelantado. */
const salirYVolver = (pagina, ms = 31_000) =>
  pagina.evaluate((ms) => {
    window.dispatchEvent(new Event('blur'))
    const real = Date.now.bind(Date)
    Date.now = () => real() + ms
    window.dispatchEvent(new Event('focus'))
  }, ms)
/**
 * La sesión vence a la hora de entrar (el banco firma por 3600 s, como Supabase):
 * se adelanta `expires_at` de la sesión guardada en la cookie, y el token sigue
 * firmado como estaba. Devuelve cuándo vencía, en segundos.
 */
async function vencerLaSesion(contexto) {
  const partes = (await contexto.cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name))
  if (partes.length === 0) throw new Error('No hay cookie de sesión')
  const nombre = partes[0].name.replace(/\.\d+$/, '')
  let valor = decodeURIComponent(partes.map((c) => c.value).join(''))
  if (valor.startsWith('base64-')) valor = Buffer.from(valor.slice(7), 'base64url').toString('utf8')
  const sesion = JSON.parse(valor)
  const nueva = 'base64-' + Buffer.from(JSON.stringify({ ...sesion, expires_at: Math.floor(Date.now() / 1000) - 30 }), 'utf8').toString('base64url')
  // Una sola cookie basta; los trozos que hubiera se borran para que no se mezclen.
  await contexto.addCookies([
    { ...partes[0], name: nombre, value: nueva },
    ...partes.filter((c) => c.name !== nombre).map((c) => ({ ...c, value: '', expires: Math.floor(Date.now() / 1000) - 10 })),
  ])
  return sesion.expires_at
}
/** Cuándo vence la sesión que tiene ahora la cookie, en segundos (0 si no se lee). */
async function venceLaSesion(contexto) {
  const partes = (await contexto.cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name) && c.value).sort((a, b) => a.name.localeCompare(b.name))
  try {
    let valor = decodeURIComponent(partes.map((c) => c.value).join(''))
    if (valor.startsWith('base64-')) valor = Buffer.from(valor.slice(7), 'base64url').toString('utf8')
    return Number(JSON.parse(valor).expires_at) || 0
  } catch {
    return 0
  }
}
/** El reloj de la página, `ms` más tarde (sin salir ni volver). */
const adelantarElReloj = (pagina, ms) =>
  pagina.evaluate((ms) => {
    const antes = Date.now.bind(Date)
    Date.now = () => antes() + ms
  }, ms)
/** Una marca en `window` que solo una recarga del documento borra. */
const marcarDocumento = (pagina) => pagina.evaluate(() => { window.__mismoDocumento = 1 })
const mismoDocumento = (pagina) => pagina.evaluate(() => window.__mismoDocumento === 1).catch(() => false)
const avisoDeArriba = async (pagina) => limpio(await pagina.locator('[data-pestana-vieja]').innerText().catch(() => ''))
/** Lo que dice junto al botón el formulario de página entera que ya entró (`YaQuedo`). */
const yaQuedo = (pagina) => pagina.locator('[data-ya-quedo]').innerText().then(limpio).catch(() => '')
/** La línea de arriba (`IdaQueNoSalio`): lo que entró y no llevó a su pantalla, o el rechazo que volvió con la persona ya en otra. */
const idaQueNoSalio = (pagina) => pagina.locator('[data-ida-que-no-salio]').innerText().then(limpio).catch(() => '')
/**
 * Si la línea de arriba se ve entera sin desplazar: no flota, y la que llega
 * fuera de la vista no la lee nadie. Debajo de la barra pegada de arriba
 * tampoco se ve: se mira qué hay en su centro y que empiece donde la barra
 * termina (E de la crítica, cuadragésima tercera pasada).
 */
const lineaALaVista = (pagina) =>
  pagina
    .locator('[data-ida-que-no-salio]')
    .evaluate((e) => {
      const r = e.getBoundingClientRect()
      const barra = document.querySelector('[data-barra-superior]')?.getBoundingClientRect().bottom ?? 0
      const enSuCentro = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return r.height > 0 && r.top >= barra - 1 && r.bottom <= window.innerHeight && Boolean(enSuCentro && e.contains(enSuCentro))
    })
    .catch(() => false)
/** Lo que pasa al volver a la pestaña después del despliegue de todos los días: queda «nueva». */
const hastaLaPestanaNueva = async (pagina, corte) => {
  corte.despliegue = true
  corte.conservaIds = true
  await salirYVolver(pagina)
  await hasta(() => pagina.locator('[data-pestana-vieja="nueva"]').count(), (n) => n === 1, 15000)
}
/** Por qué «Volver a cargar» no recargó, como lo dice arriba la región que el lector oye. */
const sinRecargar = (pagina) => pagina.locator('[data-pestana-vieja] [data-sin-recargar]').innerText().then(limpio).catch(() => '')
const NO_ENTRO = 'Lo que enviaste no entró, o no se sabe si entró: lee el aviso junto a su botón antes de volver a cargar la pantalla.'
const EN_CAMINO = 'Lo que enviaste todavía no contesta. Si entra, la pantalla se vuelve a cargar sola; si la vuelves a cargar antes, no vas a saber si entró.'
const SE_VA = 'Lo que enviaste ya entró, y la pantalla a la que lleva tarda en abrir. Si no abre, vuelve a cargar: ya está guardado, no lo envíes de nuevo.'
const botonDeArriba = (pagina, nombre) => pagina.locator('[data-pestana-vieja]').getByRole('button', { name: nombre, exact: true })
/** Por el menú, como la persona: el enlace a `href` (si está plegado, se toca igual) y Next lleva sin recargar. */
async function porElMenu(pagina, href) {
  const enlaces = pagina.locator(`a[href="${href}"]`)
  await enlaces.first().waitFor({ state: 'attached', timeout: 15000 })
  const visible = await enlaces.evaluateAll((l) => l.findIndex((a) => a.checkVisibility()))
  if (visible >= 0) await enlaces.nth(visible).click()
  else await enlaces.first().evaluate((a) => a.click())
  await pagina.waitForURL((u) => u.pathname === href, { timeout: 30000 })
  await quieta(pagina)
}
/** La tarjeta que el navegador resalta (`:target`), por su id. */
const resaltada = (pagina) => pagina.evaluate(() => document.querySelector('li:target')?.id ?? null).catch(() => null)
const TEXTO_VIEJA =
  'El sistema se actualizó mientras tenías la pantalla abierta: lo que envíes desde aquí no va a entrar. Copia lo que tengas escrito y vuelve a cargar la pantalla.'
const TEXTO_NUEVA =
  'El sistema se actualizó mientras tenías la pantalla abierta. Lo que envíes todavía entra, pero al enviarlo la pantalla se vuelve a cargar y se pierde lo que tengas a medio escribir en otra parte de ella. Envía una cosa a la vez y vuelve a cargar la pantalla para ver lo nuevo.'
const TEXTO_VENTANA =
  'El sistema se actualizó mientras tenías la pantalla abierta: lo que envíes desde esta ventana no va a entrar. Copia lo que tengas escrito y vuelve a cargar la pantalla.'
/** Anota si la región del aviso de arriba nació vacía: la que nace con su texto el lector no la lee. */
const vigilarLaRegionDeArriba = (pagina) =>
  pagina.evaluate(() => {
    window.__regionVaciaPrimero = undefined
    new MutationObserver(() => {
      const r = document.querySelector('[data-region-pestana-vieja]')
      if (r && window.__regionVaciaPrimero === undefined) window.__regionVaciaPrimero = !r.textContent
    }).observe(document.body, { subtree: true, childList: true })
  })
const regionDeArriba = (pagina) =>
  pagina.evaluate(() => ({ rol: document.querySelector('[data-region-pestana-vieja]')?.getAttribute('role') ?? null, vacia: window.__regionVaciaPrimero }))

async function elegir(pagina, etiqueta, texto) {
  await pagina.getByRole('combobox', { name: etiqueta }).click()
  // Como en probar-reporte-diario: se escribe cuando la caja de búsqueda ya
  // tiene el foco, o las letras se pierden en el botón.
  const caja = pagina.locator('input[type="search"]:focus')
  await caja.waitFor({ timeout: 10000 })
  await caja.fill(texto)
  await pagina.getByRole('option', { name: new RegExp(texto) }).first().click()
}

function pdfConTexto(lineas) {
  const texto = lineas.map((l, i) => `BT /F1 11 Tf 50 ${780 - i * 18} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n')
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(texto, 'latin1')} >>\nstream\n${texto}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ]
  let pdf = '%PDF-1.4\n'
  const posiciones = []
  objetos.forEach((o, i) => {
    posiciones.push(Buffer.byteLength(pdf, 'latin1'))
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf, 'latin1')
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`
  pdf += posiciones.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf, 'latin1')
}

/** Un material propio con 5 en stock, como en probar-fotos-al-cerrar: contar o sacar uno del catálogo le quitaría la salida a otras suites. */
async function materialPropio(codigo, descripcion) {
  const [{ id }] = await consulta(
    `insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
     values ($1, $2, (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1),
             (select id from public.unidades_medida where codigo = 'UND')) returning id`,
    [codigo, descripcion],
  )
  await consulta(
    `insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, precio_unitario, moneda, registrado_en)
     select gen_random_uuid(), 'INGRESO', $1, 5, 'INGRESO_GENERAL', 'Compra de banco', u.id, 2, 'PEN', now() - interval '1 hour'
     from public.usuarios u where u.correo = $2`,
    [id, CUENTAS.almacen],
  )
  return id
}

const sello = Date.now().toString().slice(-6)
const archivos = join(CAPTURAS, 'pestana-vieja')
mkdirSync(archivos, { recursive: true })

/**
 * La orden donde Diseño carga un cronograma: de las de antes del plan manual,
 * como en probar-documentos-al-elegir. En el banco, y solo aquí, vuelve a ser
 * «de antes» con los disparadores apagados.
 */
async function ordenParaElCronograma() {
  const [orden] = await consulta(`select id, plan_etapas_manual from ordenes_trabajo
                                  where cotizacion_pdf_id is null and estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA', 'BORRADOR') order by numero limit 1`)
  if (orden.plan_etapas_manual) {
    await base.query('begin')
    await base.query(`set local session_replication_role = replica`)
    await base.query(`update ordenes_trabajo set plan_etapas_manual = false where id = $1`, [orden.id])
    await base.query('commit')
  }
  return orden
}
/** Un Excel con dos actividades de 60 % en Acabados: la pantalla lo marca en rojo y deja cargarlo, y la base lo rechaza porque suman más de 100. */
async function cronogramaQuePasaDeCien(actividad, nombre) {
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet('Cronograma')
  hoja.addRow(['Área', 'Actividad', 'Referencia', 'Peso (%)', 'Inicio', 'Fin'])
  hoja.addRow(['Acabados', actividad, null, 60, null, null])
  hoja.addRow(['Acabados', `${actividad} B`, null, 60, null, null])
  const ruta = join(archivos, nombre)
  await libro.xlsx.writeFile(ruta)
  return ruta
}
const fotos = {}
{
  const p = await (await navegador.newContext()).newPage()
  for (const [n, color] of [['a', '#7a4b2a'], ['b', '#3a3f44'], ['c', '#2a5a7a'], ['d', '#5a7a2a'], ['e', '#7a2a5a']]) {
    const b64 = await p.evaluate(async (color) => {
      const c = document.createElement('canvas')
      c.width = 640
      c.height = 480
      const g = c.getContext('2d')
      g.fillStyle = color
      g.fillRect(0, 0, 640, 480)
      g.fillStyle = '#fff'
      g.fillText(String(Math.random()), 20, 40)
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
      const b = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
      return btoa(s)
    }, color)
    fotos[n] = join(archivos, `vieja-${n}-${sello}.jpg`)
    writeFileSync(fotos[n], Buffer.from(b64, 'base64'))
  }
  await p.context().close()
}
const SOLO = process.env.SOLO?.split(',')
const corre = (parte) => !SOLO || SOLO.some((s) => parte === s || parte.startsWith(s))

// ------------------------------------------- 1a y 1b. «Reportar» un trabajo sin orden (Maestranza)
if (corre('1a') || corre('1b')) {
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz)
  await ir(pagina, `${BASE}/avance/trabajos/nueva`)
  await pagina.fill('#descripcion', `Tolva de la pestaña vieja ${sello}`)
  await pagina.fill('#trabajo', 'Cambio de compuerta')
  await Promise.all([
    pagina.waitForURL((u) => /^\/avance\/trabajos\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 }),
    pagina.getByRole('button', { name: 'Registrar el trabajo' }).click(),
  ])
  await quieta(pagina)
  const flotaId = new URL(pagina.url()).pathname.split('/').pop()
  const enStorage = async () =>
    (await consulta(`select name from storage.objects where bucket_id = 'fotos-avance' and name like $1 order by created_at`, [`flota/${flotaId}/%`])).map((x) => x.name)
  const reportes = async () => Number((await consulta(`select count(*) n from flota_avances where flota_id = $1`, [flotaId]))[0].n)
  const ventana = pagina.locator('[role="dialog"]', { has: pagina.locator('#rf-descripcion') })
  const reportar = pagina.getByRole('button', { name: 'Reportar', exact: true })
  const abrir = async (foto) => {
    await reportar.click()
    await ventana.waitFor({ timeout: 10000 })
    await ventana.locator('input[type="file"]:not([capture])').setInputFiles(foto)
    await esperarSubidas(pagina)
  }

  if (corre('1a')) {
    await abrir(fotos.a)
    const [ruta] = await enStorage()
    await ventana.locator('#rf-descripcion').fill(`1a ${sello}: se cortó la compuerta`)
    const a0 = corte.acciones
    corte.despliegue = true
    await ventana.getByRole('button', { name: 'Registrar', exact: true }).click()
    const dice = limpio(await hasta(() => ventana.getByRole('alert').allInnerTexts().then((t) => t.join(' ')), (t) => t?.includes(SE_ACTUALIZO)))
    const quitada = !(await hasta(() => existe('fotos-avance', ruta), (v) => v === false, 10000))
    const miniaturas = await ventana.locator('img').count()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1a-ventana.png') })
    comprobar(dice.includes(SE_ACTUALIZO) && dice.includes('elige las fotos otra vez') && !SIN_RESPUESTA.test(dice) && corte.acciones - a0 === 1,
      `[Maestranza 1280] 1a. ventana abierta, pestaña vieja: dice que hay que recargar y elegir las fotos otra vez, sin «revisa la conexión», en una sola llamada («${dice}», ${corte.acciones - a0} llamada)`)
    comprobar(Boolean(ruta) && quitada && miniaturas === 0 && (await reportes()) === 0,
      `[Maestranza 1280] 1a. la foto se quita de Storage y de la ventana, sin esperar a «Cancelar», y no hay reporte (quitada ${quitada}, miniaturas ${miniaturas})`)
    await ventana.getByRole('button', { name: 'Cancelar' }).click()
    await hasta(() => ventana.count(), (n) => n === 0, 5000)
    corte.despliegue = false
  }

  if (corre('1b')) {
    // Las regiones de antes se leen con la pantalla del trabajo ya pintada:
    // sola, la parte llegaba aquí con la dirección cambiada y la pantalla
    // nueva todavía sin montar.
    await reportar.waitFor({ timeout: 10000 })
    const antes = new Set(await regionesMontadas(pagina))
    await abrir(fotos.b)
    const [ruta] = (await enStorage()).slice(-1)
    const marca = `1b ${sello}`
    await ventana.locator('#rf-descripcion').fill(`${marca}: se soldaron los refuerzos`)
    corte.marca = marca
    await ventana.getByRole('button', { name: 'Registrar', exact: true }).click()
    const retenido = (await hasta(() => corte.retenidas, (n) => n >= 1)) >= 1
    await ventana.getByRole('button', { name: 'Cancelar' }).click()
    const cerro = (await hasta(() => ventana.count(), (n) => n === 0, 5000)) === 0
    const ocupado = (await reportar.getAttribute('aria-disabled')) === 'true'
    const describe = await hasta(() => loQueDescribe(reportar), (t) => Boolean(t), 5000)
    const [idEstado] = await idsQueDescribe(reportar)
    comprobar(retenido && cerro && ocupado && describe === 'El reporte se sigue enviando: lo que conteste se dice aquí.' && antes.has(idEstado),
      `[Maestranza 1280] 1b. cerrada en vuelo, «Reportar» gira y su aria-describedby nombra «se sigue enviando», en una región montada desde antes (retenido ${retenido}, ocupado ${ocupado}, «${describe}», de antes ${antes.has(idEstado)}: ${idEstado} en [${[...antes].join(' ')}])`)
    corte.despliegue = true
    corte.soltar()
    const desenlace = limpio(await hasta(() => pagina.getByRole('alert').filter({ hasText: 'que se estaba enviando' }).allInnerTexts().then((t) => t.join(' ')), Boolean))
    const libre = await hasta(() => reportar.getAttribute('aria-disabled'), (v) => v === null, 5000)
    const quitada = !(await hasta(() => existe('fotos-avance', ruta), (v) => v === false, 10000))
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1b-fila.png') })
    comprobar(desenlace === 'El reporte que se estaba enviando no se registró: el sistema se actualizó mientras tenías la pantalla abierta. Vuelve a cargar la pantalla y envíalo otra vez.',
      `[Maestranza 1280] 1b. al contestar el servidor que la acción no existe, junto al botón: «${desenlace}»`)
    comprobar(libre === null && (await reportar.getAttribute('aria-describedby')) === null && quitada && (await reportes()) === 0,
      `[Maestranza 1280] 1b. el botón se libera y deja de nombrar el estado, la foto se quita y no hay reporte (quitada ${quitada})`)
    corte.despliegue = false

    // Y el que sí entra con la ventana ya cerrada: su verde sale en una región
    // que estaba montada (vigesimonovena pasada).
    await abrir(fotos.e)
    const marcaOk = `1b-ok ${sello}`
    await ventana.locator('#rf-descripcion').fill(`${marcaOk}: se pintó la compuerta`)
    corte.marca = marcaOk
    await ventana.getByRole('button', { name: 'Registrar', exact: true }).click()
    await hasta(() => corte.retenidas, (n) => n >= 2)
    await ventana.getByRole('button', { name: 'Cancelar' }).click()
    await hasta(() => ventana.count(), (n) => n === 0, 5000)
    const verde = await vigilarElVerde(pagina, 'Reporte registrado')
    corte.soltar()
    const verdes = await hasta(verde.leer, (v) => v?.length > 0, 20000)
    const dice = limpio(await pagina.getByRole('status').filter({ hasText: 'Reporte registrado' }).first().innerText().catch(() => ''))
    comprobar(verdes?.[0] === true && dice.startsWith('Reporte registrado') && (await reportes()) === 1,
      `[Maestranza 1280] 1b. cerrada en vuelo, «${dice}» sale en una región montada desde antes, que el lector anuncia (${JSON.stringify(verdes)})`)
  }
  comprobar(errores.length === 0, `[Maestranza 1280] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1c. Otra versión del contrato de un subcontrato (Administración)
if (corre('1c')) {
  const vigente = () => consulta(`select id, numero from subcontratos where estado <> 'ANULADO' order by numero limit 1`)
  let [sc] = await vigente()
  if (!sc) {
    // En un banco nuevo no hay ninguno: se registra uno con la sesión y el
    // permiso de Administración, como lo haría ella (nunca ADMIN).
    await comoLaCuenta(CUENTAS.administracion, async () => {
      const [{ id: quien }] = await consulta(`select gen_random_uuid() as id`)
      await consulta(`select public.guardar_subcontratista($1::uuid, '10043200017', 'Subcontratista de la pestaña vieja', null, null, null, null, true)`, [quien])
      await consulta(`select public.registrar_subcontrato(gen_random_uuid(), $1::uuid, 'PLANTA', $2, 'PEN', 1000, null, null, 'MTZ')`, [quien, `Pintura de la tolva ${sello}`])
    })
    ;[sc] = await vigente()
  }
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'subcontratos' and o.name like $1
        and not exists (select 1 from subcontrato_contratos c where c.archivo_ruta = o.name)
        and not exists (select 1 from recibos_honorarios r where r.archivo_ruta = o.name)`, [`${sc?.id}/%`])).length
  const contratos = async () => Number((await consulta(`select count(*) n from subcontrato_contratos where subcontrato_id = $1`, [sc?.id]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion)
  await ir(pagina, `${BASE}/subcontratos/${sc?.id}`)
  const sueltosAntes = await sueltos()
  const n0 = await contratos()
  await pagina.locator('[data-adjuntar-contrato]').first().click()
  const v = pagina.locator('[role="dialog"]').filter({ hasText: `contrato de ${sc?.numero}` })
  await v.waitFor({ timeout: 30000 })
  const pdf = Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n%vieja ${sello} ${'x'.repeat(1500)}\ntrailer<</Root 1 0 R>>\n%%EOF\n`)
  await v.locator('input[type=file]').first().setInputFiles({ name: `contrato-vieja-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdf })
  await pagina.waitForTimeout(1200)
  const a0 = corte.acciones
  corte.despliegue = true
  const t0 = Date.now()
  await v.getByRole('button', { name: 'Adjuntar', exact: true }).click()
  const dice = limpio(await hasta(() => v.getByRole('alert').allInnerTexts().then((t) => t.join(' ')), (t) => t?.includes(SE_ACTUALIZO) || SIN_RESPUESTA.test(t ?? ''), 30000))
  const tardo = Date.now() - t0
  const sueltosDespues = await hasta(sueltos, (n) => n === sueltosAntes, 10000)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1c-contrato.png') })
  comprobar(dice.includes(SE_ACTUALIZO) && !SIN_RESPUESTA.test(dice) && corte.acciones - a0 === 1,
    `[Administración 1280] 1c. el contrato desde la pestaña vieja dice que hay que recargar, en una sola llamada, sin la pausa (${tardo} ms; «${dice}»; ${corte.acciones - a0} llamada)`)
  comprobar(sueltosDespues === sueltosAntes && (await contratos()) === n0,
    `[Administración 1280] 1c. el archivo subido se quita y no hay contrato nuevo (sueltos ${sueltosAntes} → ${sueltosDespues})`)
  // Ya se sabe vieja: el segundo intento ni sube el archivo ni llama a la acción.
  const s1 = corte.storage.length
  const a1 = corte.acciones
  await v.getByRole('button', { name: 'Adjuntar', exact: true }).click()
  await pagina.waitForTimeout(2000)
  const otraVez = limpio(await v.getByRole('alert').allInnerTexts().then((t) => t.join(' ')))
  comprobar(otraVez.includes(SE_ACTUALIZO) && corte.storage.length === s1 && corte.acciones === a1 && (await sueltos()) === sueltosAntes,
    `[Administración 1280] 1c. el segundo «Adjuntar», con la pestaña ya sabida vieja, no sube nada ni llama a la acción (${corte.storage.length - s1} pedidos a Storage, ${corte.acciones - a1} llamadas)`)
  corte.despliegue = false
  await v.getByRole('button', { name: 'Cancelar' }).click().catch(() => {})
  comprobar(errores.length === 0, `[Administración 1280] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1d. El conteo inicial del kardex (Almacén)
if (corre('1d')) {
  // Un material propio, como en probar-fotos-al-cerrar: contar uno del catálogo le quitaría la salida a otras suites.
  const codigo = `QA-VIEJA-${sello}`
  const [{ id: materialId }] = await consulta(
    `insert into public.materiales (codigo, descripcion, categoria_id, unidad_medida_id)
     values ($1, $2, (select id from public.categorias_material where activo and almacen = 'CONSUMIBLES' and codigo <> 'ALM_POR_CLASIFICAR' order by codigo limit 1),
             (select id from public.unidades_medida where codigo = 'UND')) returning id`,
    [codigo, `Trapo de la pestaña vieja ${sello}`],
  )
  await consulta(
    `insert into public.movimientos_materiales (id, tipo, material_id, cantidad, origen, documento_referencia, registrado_por, precio_unitario, moneda, registrado_en)
     select gen_random_uuid(), 'INGRESO', $1, 5, 'INGRESO_GENERAL', 'Compra de banco', u.id, 2, 'PEN', now() - interval '1 hour'
     from public.usuarios u where u.correo = $2`,
    [materialId, CUENTAS.almacen],
  )
  const movimientos = async () => Number((await consulta(`select count(*) n from movimientos_materiales where material_id = $1`, [materialId]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.almacen)
  await ir(pagina, `${BASE}/almacen/kardex`)
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(await (await pagina.request.get(`${BASE}/almacen/kardex/conteo-inicial`)).body())
  const hoja = libro.getWorksheet('Conteo')
  let encabezado = 0
  hoja.eachRow((f, n) => {
    if (!encabezado && f.values.includes('Cantidad contada')) encabezado = n
  })
  for (let n = encabezado + 1; n <= hoja.rowCount; n++) {
    if (String(hoja.getCell(n, 1).value) === codigo) hoja.getCell(n, 5).value = Number(hoja.getCell(n, 4).value) + 1
    else hoja.getCell(n, 5).value = null
  }
  const lleno = join(archivos, `conteo-vieja-${sello}.xlsx`)
  await libro.xlsx.writeFile(lleno)
  await pagina.getByRole('button', { name: 'Conteo inicial' }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor()
  // Al leer el Excel.
  corte.despliegue = true
  await v.locator('#conteo-inicial-archivo').setInputFiles(lleno)
  const alLeer = limpio(await hasta(() => v.innerText(), (t) => t?.includes(SE_ACTUALIZO) || /No se pudo leer/.test(t ?? ''), 20000))
  comprobar(alLeer.includes(SE_ACTUALIZO) && !/revisa la conexión/.test(alLeer),
    `[Almacén 1280] 1d. leer el conteo desde la pestaña vieja dice que hay que recargar, no «revisa la conexión y elígelo otra vez»`)
  // Al registrar: la ventana otra vez, con el mismo Excel.
  corte.despliegue = false
  await pagina.keyboard.press('Escape')
  await hasta(() => v.count(), (n) => n === 0, 5000)
  await pagina.getByRole('button', { name: 'Conteo inicial' }).click()
  await v.waitFor()
  await v.locator('#conteo-inicial-archivo').setInputFiles(lleno)
  const boton = v.getByRole('button', { name: 'Registrar 1 material' })
  await boton.waitFor({ timeout: 30000 })
  const m0 = await movimientos()
  const a0 = corte.acciones
  corte.despliegue = true
  await boton.click()
  const alRegistrar = limpio(await hasta(() => v.innerText(), (t) => /el sistema se actualizó|No se confirmó/i.test(t ?? ''), 20000))
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1d-conteo.png') })
  comprobar(/el sistema se actualizó mientras tenías la pantalla abierta/i.test(alRegistrar) && !/No se confirmó/.test(alRegistrar) && corte.acciones - a0 === 1 && (await movimientos()) === m0,
    `[Almacén 1280] 1d. registrar el conteo desde la pestaña vieja dice que hay que recargar, en una sola llamada, y no registra nada (${corte.acciones - a0} llamada)`)
  // La causa una vez, en el resumen que recibe el cursor; las filas sin alerta
  // propia; y en vez de «Registrar», que fallaría igual, volver a cargar.
  const resumen = limpio(await pagina.evaluate(() => document.activeElement?.textContent ?? ''))
  const alertas = await v.getByRole('alert').filter({ hasText: /actualizó/ }).count()
  const fila = limpio(await v.getByText('No salió: el sistema se actualizó.').first().innerText().catch(() => ''))
  const registrarOtraVez = await v.getByRole('button', { name: /^Registrar \d/ }).count()
  const recargar = v.getByRole('button', { name: 'Volver a cargar la pantalla' })
  comprobar(resumen === 'No se registró ningún material; 1 no salió porque el sistema se actualizó mientras tenías la pantalla abierta. Vuelve a cargar la pantalla y elige el archivo otra vez: lo registrado no se duplica.',
    `[Almacén 1280] 1d. el resumen enfocado dice la causa y qué hacer («${resumen}»)`)
  comprobar(alertas === 0 && fila === 'No salió: el sistema se actualizó.' && registrarOtraVez === 0 && (await recargar.count()) === 1,
    `[Almacén 1280] 1d. la fila dice «${fila}» sin alerta propia (${alertas}); no queda «Registrar» (${registrarOtraVez}) y sí «Volver a cargar la pantalla»`)
  comprobar((await avisoDeArriba(pagina)).startsWith(SE_ACTUALIZO), `[Almacén 1280] 1d. y arriba de la pantalla lo dice también («${await avisoDeArriba(pagina)}»)`)
  corte.despliegue = false
  await marcarDocumento(pagina)
  if (await recargar.count()) await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}), recargar.click()])
  comprobar(!(await mismoDocumento(pagina)) && (await pagina.locator('[data-pestana-vieja]').count()) === 0,
    `[Almacén 1280] 1d. «Volver a cargar la pantalla» la recarga, y ya sin el aviso de arriba`)
  comprobar(errores.length === 0, `[Almacén 1280] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1e y 1i. El reporte diario a medio llenar (Maestranza, a 390)
if (['1e', '1i-volver', '1i-sondeo', '1i-sin-senal', '1l', '1m', '1n', '1o', '1p-rechazo', '1p-sin-respuesta', '1p-colgado', '1p-destino-lento', '1p-se-va', '1r', '1y-reporte-que-entro', '1z-rechazo-del-reporte', '1za-ya-habia-quedado'].some(corre)) {
  // Una persona de Maestranza para el trabajo, como la dejaría RR. HH.; al
  // final se le pone su costo y se da de baja. Para enviar no hace falta.
  const persona = `Pedro ${sello}`
  // 1y-reporte-que-entro va con otra: con la suite entera, Pedro ya llegaba a
  // las 16 h del día y su reporte no entraba (R2 de realización, cuadragésima
  // primera pasada).
  const personaY = `Pablo ${sello}`
  // Y 1za-ya-habia-quedado, con la suya (cuadragésima segunda pasada).
  const personaZ = `Paco ${sello}`
  for (const [nombre, dni] of [[persona, '01'], [personaY, '02'], [personaZ, '03']]) {
    await consulta(
      `insert into trabajadores (nombres, apellidos, dni, cargo, area_id, creado_por)
       select $1, 'Prueba Pestaña Vieja', '5' || $2 || $4, 'Soldador', (select id from areas where codigo = 'MTZ'), (select id from usuarios where correo = $3)`,
      [nombre, sello.slice(-5), CUENTAS.rrhh, dni],
    )
  }
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.mtz])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const subidas = async () =>
    (await consulta(`select name from storage.objects where bucket_id = 'fotos-reporte-diario' and owner_id = $1 and created_at >= $2 order by created_at`, [yo, desde])).map((o) => o.name)
  const asunto = `Pestaña vieja ${sello}`
  const reportes = async () => Number((await consulta(`select count(*) n from reportes_diarios where asunto = $1`, [asunto]))[0].n)
  // `sinPersona`: nadie elegido, y la acción lo rechaza («Pon al menos a una persona…»).
  // `quien`: la persona del trabajo. `sinIr`: en el formulario que ya está abierto.
  const llenar = async (pagina, conFoto, { sinPersona = false, quien = persona, sinIr = false } = {}) => {
    if (!sinIr) await ir(pagina, `${BASE}/reportes-diarios/nuevo`)
    await pagina.fill('#rd-codigo', 'PLANTA')
    await pagina.fill('#rd-asunto', asunto)
    await pagina.fill('#rd-descripcion', 'Se ordenó la planta y se soldaron los soportes.')
    const t1 = pagina.locator('fieldset[data-trabajo="1"]')
    await elegir(pagina, 'Trabajo 1: sobre qué', 'Tarea nueva')
    await t1.locator('textarea').fill('Soportes de la tolva')
    await t1.locator('input[type="number"]').first().fill('30')
    if (!sinPersona) {
      await elegir(pagina, 'Personal del trabajo 1: persona 1', quien)
      await pagina.getByRole('spinbutton', { name: 'Personal del trabajo 1: horas de la persona 1' }).fill('2')
    }
    if (conFoto) {
      await pagina.locator('input[type="file"]:not([capture])').first().setInputFiles(fotos.d)
      await esperarSubidas(pagina)
    }
    // El último toque fuera de un campo, como al cerrar el teclado tocando el
    // título: con el cursor en un campo, RefrescoAlVolver espera de todos modos.
    await pagina.locator('main h1').first().click()
  }
  // La foto a la vista: su miniatura. Al quitarla por la pestaña vieja queda
  // en la lista con su miniatura y «Se quitó» encima.
  const miniaturas = (pagina) => pagina.locator('main img[alt^="vieja-d-"]').count()
  const subirReporte = (pagina) => pagina.getByRole('button', { name: 'Subir reporte' })

  // Sin despliegue: al volver se repinta, sin recargar el documento y sin aviso.
  if (corre('1e')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, false)
    await marcarDocumento(pagina)
    const r0 = corte.rsc
    const d0 = corte.documentos
    await salirYVolver(pagina)
    const repinto = await hasta(() => corte.rsc - r0, (n) => n > 0, 10000)
    await quieta(pagina)
    comprobar(repinto > 0 && corte.documentos === d0 && (await mismoDocumento(pagina)) && (await pagina.inputValue('#rd-asunto')) === asunto && (await pagina.locator('[data-region-pestana-vieja]').count()) === 0,
      `[Maestranza 390] 1e. sin despliegue, al volver tras 31 s se repinta sin recargar, lo escrito sigue y arriba no hay aviso ni su región (${repinto} pedidos RSC, ${corte.documentos - d0} documentos)`)
    comprobar(errores.length === 0, `[Maestranza 390] 1e. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // Un despliegue que cambia los ids: al volver no se recarga sola, lo dice
  // arriba, y la foto ya subida se quita en el acto (trigésima pasada: antes
  // se quedaba hasta «Subir reporte», y al recargar como pedía el aviso quedaba suelta).
  if (corre('1e')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await marcarDocumento(pagina)
    await vigilarLaRegionDeArriba(pagina)
    const d0 = corte.documentos
    corte.despliegue = true
    await salirYVolver(pagina)
    const arriba = limpio(await hasta(() => avisoDeArriba(pagina), Boolean, 15000))
    const quitada = !(await hasta(() => existe('fotos-reporte-diario', ruta), (v) => v === false, 10000))
    await pagina.waitForTimeout(1500)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1e-al-volver.png'), fullPage: true })
    const mismo = await mismoDocumento(pagina)
    const escrito = await pagina.inputValue('#rd-asunto')
    comprobar(corte.documentos === d0 && mismo && escrito === asunto,
      `[Maestranza 390] 1e. con despliegue, al volver tras 31 s la pantalla no se recarga sola: lo escrito sigue (mismo documento ${mismo}, asunto «${escrito}»)`)
    comprobar(arriba === `${TEXTO_VIEJA} Volver a cargar` && (await pagina.locator('[data-pestana-vieja="vieja"]').count()) === 1,
      `[Maestranza 390] 1e. y arriba lo dice, con «Volver a cargar» («${arriba}»)`)
    const region = await regionDeArriba(pagina)
    comprobar(region.rol === 'status' && region.vacia === true,
      `[Maestranza 390] 1e. el aviso de arriba nace en una región role=status montada antes que su texto (role ${region.rol}, vacía primero ${region.vacia})`)
    const alerta = limpio(await pagina.locator('[data-fotos-quitadas]').innerText().catch(() => ''))
    const alertas = await pagina.locator('main [role="alert"]').filter({ hasText: /se quitó|se quitaron/ }).count()
    const tarjeta = limpio(await pagina.locator('main').getByText('Se quitó', { exact: true }).first().innerText().catch(() => ''))
    comprobar(Boolean(ruta) && quitada && (await miniaturas(pagina)) === 1 && tarjeta === 'Se quitó'
      && alerta === 'La foto ya subida se quitó: el sistema se actualizó. Vuelve a cargar la pantalla y elígela otra vez.' && alertas === 1,
      `[Maestranza 390] 1e. la foto ya subida se quita de Storage en el acto y queda con su miniatura y «Se quitó» encima, con una sola alerta que pide elegirla otra vez («${alerta}»; quitada ${quitada}, ${alertas} alerta)`)
    const ayuda = await pagina.getByText('Vuelve a cargar la pantalla para subir el reporte.', { exact: true }).count()
    comprobar(ayuda === 1 && (await pagina.getByText(/Quita o vuelve a subir/).count()) === 0 && (await subirReporte(pagina).isDisabled()) && (await reportes()) === 0,
      `[Maestranza 390] 1e. debajo dice «Vuelve a cargar la pantalla para subir el reporte.», no «Quita o vuelve a subir», y «Subir reporte» no se deja tocar`)
    // Ya se sabe vieja: la foto que se elija ahora ni sube. Al recargar, como
    // pide el aviso, quedaría suelta.
    const s1 = corte.storage.length
    await pagina.locator('input[type="file"]:not([capture])').first().setInputFiles(fotos.a)
    const noSubio = limpio(await hasta(() => pagina.getByRole('alert').filter({ hasText: 'No se subió' }).allInnerTexts().then((t) => t.join(' ')), Boolean, 15000))
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1e-otra-foto.png'), fullPage: true })
    comprobar(noSubio.endsWith(': No se subió: el sistema se actualizó. Vuelve a cargar la pantalla y elígela otra vez.') && corte.storage.length === s1
      && (await pagina.getByRole('button', { name: /^Volver a subir/ }).count()) === 0 && (await subidas()).length === 0,
      `[Maestranza 390] 1e. la foto elegida después no sube, lo dice y no ofrece «Reintentar» («${noSubio}»; ${corte.storage.length - s1} pedidos a Storage)`)
    corte.despliegue = false
    comprobar(errores.length === 0, `[Maestranza 390] 1e. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // Descubierta al enviar: lo dice el aviso junto al botón; el de arriba está,
  // pero sin región que lo anuncie otra vez, y la foto no suma otra alerta
  // (trigésima pasada: el lector lo oía dos veces seguidas).
  if (corre('1e')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    corte.despliegue = true
    await subirReporte(pagina).click()
    const dice = limpio(await hasta(() => pagina.locator('main [role="alert"]').filter({ hasText: SE_ACTUALIZO }).allInnerTexts().then((t) => t.join(' ')), Boolean))
    const quitada = !(await hasta(() => existe('fotos-reporte-diario', ruta), (v) => v === false, 10000))
    const arriba = limpio(await hasta(() => avisoDeArriba(pagina), Boolean, 5000))
    await pagina.waitForTimeout(800)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1e-enviar.png'), fullPage: true })
    comprobar(dice === 'El sistema se actualizó mientras tenías la pantalla abierta: no se registró. Copia lo escrito, vuelve a cargar la pantalla y elige las fotos otra vez.',
      `[Maestranza 390] 1e. «Subir reporte» desde la pestaña vieja pide elegir las fotos otra vez («${dice}»)`)
    comprobar(quitada && (await miniaturas(pagina)) === 0 && (await reportes()) === 0 && (await pagina.inputValue('#rd-asunto')) === asunto,
      `[Maestranza 390] 1e. la foto se quita de Storage y de la pantalla, no hay reporte y lo escrito sigue para copiarlo (quitada ${quitada})`)
    comprobar(arriba === `${TEXTO_VIEJA} Volver a cargar` && (await pagina.locator('[data-region-pestana-vieja]').count()) === 0 && (await pagina.locator('[data-fotos-quitadas]').count()) === 0,
      `[Maestranza 390] 1e. arriba lo dice sin región que lo anuncie otra vez, y la foto no suma su propia alerta («${arriba}»)`)
    corte.despliegue = false
    comprobar(errores.length === 0, `[Maestranza 390] 1e. al enviar, sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1i. El despliegue de todos los días: el servidor nuevo conoce las acciones
  // de la pestaña (la clave de sus ids dura 14 días y Vercel la conserva), así
  // que nada vuelve 404. Antes la pestaña no se enteraba, `router.refresh()`
  // recargaba el documento entero y se perdía lo escrito y la foto (X3 de la
  // crítica de la trigésima). Ahora la pregunta por los avisos trae de qué
  // despliegue es el servidor.
  if (corre('1i-volver')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    comprobar(Boolean(corte.compilacion), `[Maestranza 390] 1i. la pantalla trae de qué compilación es («${corte.compilacion}»)`)
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await marcarDocumento(pagina)
    await vigilarLaRegionDeArriba(pagina)
    const d0 = corte.documentos
    const r0 = corte.rsc
    corte.despliegue = true
    corte.conservaIds = true
    await salirYVolver(pagina)
    const arriba = limpio(await hasta(() => avisoDeArriba(pagina), Boolean, 15000))
    await pagina.waitForTimeout(2000)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1i-al-volver.png'), fullPage: true })
    const mismo = await mismoDocumento(pagina)
    const escrito = await pagina.inputValue('#rd-asunto')
    comprobar(corte.reescritas > 0 && corte.documentos === d0 && corte.rsc === r0 && mismo && escrito === asunto,
      `[Maestranza 390] 1i. el servidor nuevo contesta la pregunta (${corte.reescritas} respuestas de otra compilación) y la pantalla no se recarga ni se repinta: lo escrito sigue (${corte.rsc - r0} pedidos RSC, ${corte.documentos - d0} documentos)`)
    comprobar(arriba === `${TEXTO_NUEVA} Volver a cargar` && (await pagina.locator('[data-pestana-vieja="nueva"]').count()) === 1,
      `[Maestranza 390] 1i. arriba dice que el sistema se actualizó: lo que envíe entra, pero la pantalla se vuelve a cargar («${arriba}»)`)
    const region = await regionDeArriba(pagina)
    comprobar(region.rol === 'status' && region.vacia === true,
      `[Maestranza 390] 1i. en una región role=status montada antes que su texto (role ${region.rol}, vacía primero ${region.vacia})`)
    comprobar(Boolean(ruta) && (await miniaturas(pagina)) === 1 && (await existe('fotos-reporte-diario', ruta)) && (await pagina.locator('[data-fotos-quitadas]').count()) === 0 && !(await subirReporte(pagina).isDisabled()),
      `[Maestranza 390] 1i. la foto sigue y «Subir reporte» también: con la acción viva el reporte todavía entra`)
    // «Volver a cargar»: antes de recargar, quita la foto que nadie va a nombrar
    // (X4 de la crítica). La recarga se ve en la marca de `window`: el pedido del
    // documento lo hace el service worker, y no pasa por esta sesión de CDP.
    await Promise.all([
      pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}),
      pagina.locator('[data-pestana-vieja]').getByRole('button', { name: 'Volver a cargar' }).click(),
    ])
    corte.despliegue = false
    corte.conservaIds = false
    await quieta(pagina)
    const quitada = !(await existe('fotos-reporte-diario', ruta))
    const recargo = !(await mismoDocumento(pagina))
    const avisos = await pagina.locator('[data-pestana-vieja]').count()
    comprobar(recargo && quitada && avisos === 0,
      `[Maestranza 390] 1i. «Volver a cargar» quita la foto ya subida y recién después recarga; la pantalla nueva sale sin aviso (quitada ${quitada}, recargó ${recargo}, ${avisos} avisos)`)
    comprobar(errores.length === 0, `[Maestranza 390] 1i. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1i. Lo mismo sin salir de la pantalla: el sondeo de cada minuto.
  if (corre('1i-sondeo')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, false)
    await marcarDocumento(pagina)
    const d0 = corte.documentos
    const r0 = corte.rsc
    corte.despliegue = true
    corte.conservaIds = true
    const arriba = limpio(await hasta(() => avisoDeArriba(pagina), Boolean, 75000))
    const mismo = await mismoDocumento(pagina)
    comprobar(arriba.startsWith(TEXTO_NUEVA) && mismo && corte.documentos === d0 && corte.rsc === r0 && (await pagina.inputValue('#rd-asunto')) === asunto,
      `[Maestranza 390] 1i. sin salir, el sondeo de cada minuto lo dice arriba sin recargar ni repintar (${corte.rsc - r0} pedidos RSC, mismo documento ${mismo})`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1i. sondeo, sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1i. Sin señal al volver: la pregunta no llega y no se repinta. Antes Next
  // pedía la pantalla entera al navegador, salía la página sin conexión y se
  // llevaba lo escrito (D1 de diseño y H2 de funcionamiento, de main). Y al
  // volver la señal, con la acción viva, el reporte entra desde la pestaña
  // del despliegue anterior.
  if (corre('1i-sin-senal')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await marcarDocumento(pagina)
    const d0 = corte.documentos
    await contexto.setOffline(true)
    await salirYVolver(pagina)
    await pagina.waitForTimeout(4000)
    const mismo = await mismoDocumento(pagina)
    const escrito = await pagina.inputValue('#rd-asunto').catch(() => '')
    const titulo = await pagina.title().catch(() => '')
    const fotoSigue = await miniaturas(pagina)
    await contexto.setOffline(false)
    comprobar(mismo && corte.documentos === d0 && escrito === asunto && fotoSigue === 1 && (await pagina.locator('[data-pestana-vieja]').count()) === 0,
      `[Maestranza 390] 1i. sin señal, al volver tras 31 s no sale la página sin conexión: lo escrito y la foto siguen y arriba no dice nada («${titulo}», mismo documento ${mismo})`)

    corte.despliegue = true
    corte.conservaIds = true
    await salirYVolver(pagina)
    await hasta(() => avisoDeArriba(pagina), Boolean, 15000)
    const n0 = await reportes()
    await Promise.all([
      pagina.waitForURL((u) => /^\/reportes-diarios\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 }).catch(() => {}),
      subirReporte(pagina).click(),
    ])
    await quieta(pagina)
    const [rd] = await consulta(
      `select r.id, (select count(*)::int from reporte_diario_fotos f where f.reporte_id = r.id and f.ruta = $2) as fotos
       from reportes_diarios r where r.asunto = $1 order by r.creado_en desc limit 1`,
      [asunto, ruta],
    )
    const llego = new URL(pagina.url()).pathname
    corte.despliegue = false
    corte.conservaIds = false
    comprobar((await reportes()) === n0 + 1 && rd?.fotos === 1 && llego === `/reportes-diarios/${rd?.id}`,
      `[Maestranza 390] 1i. con la acción viva, «Subir reporte» desde la pestaña del despliegue anterior entra con su foto y lleva al reporte (${llego})`)
    comprobar(errores.length === 0, `[Maestranza 390] 1i. sin señal y al enviar, sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }
  // 1l. La campana en la pestaña de otro despliegue: marcar lo leído no
  // revalida, así que Next no recarga. Antes «Marcar todos leídos» se llevaba el
  // reporte a medio llenar y dejaba suelta su foto (D7 de la trigesimoprimera).
  // Los avisos los dejan los disparadores; aquí se siembran.
  const sinLeer = async () => Number((await consulta(`select count(*) n from notificaciones where usuario_id = $1 and leida_en is null`, [yo]))[0].n)
  const sembrarAvisos = (n, de) =>
    consulta(`insert into notificaciones (usuario_id, titulo, cuerpo) select $1, $2 || ' ' || g, 'Sembrado por probar-pestana-vieja-y-giro' from generate_series(1, $3) g`, [yo, de, n])
  const campana = (pagina) => pagina.getByRole('button', { name: /^Avisos/ })
  if (corre('1l')) {
    const titulo = `Aviso de la pestaña nueva ${sello}`
    await sembrarAvisos(2, titulo)
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await marcarDocumento(pagina)
    const d0 = corte.documentos
    corte.despliegue = true
    corte.conservaIds = true
    await salirYVolver(pagina)
    await hasta(() => pagina.locator('[data-pestana-vieja="nueva"]').count(), (n) => n === 1, 15000)
    const n0 = await sinLeer()
    // Un aviso sin pantalla a la que ir: se marca, la campana se cierra y nada se recarga.
    await campana(pagina).click()
    await pagina.locator('#panel-avisos').getByRole('button', { name: new RegExp(`^${titulo} 1`) }).click()
    await hasta(sinLeer, (n) => n === n0 - 1, 10000)
    await pagina.waitForTimeout(1500)
    const etiqueta1 = await campana(pagina).getAttribute('aria-label')
    comprobar((await mismoDocumento(pagina)) && corte.documentos === d0 && (await pagina.inputValue('#rd-asunto')) === asunto && etiqueta1 === `Avisos, ${n0 - 1} sin leer`,
      `[Maestranza 390] 1l. en la pestaña «nueva», tocar un aviso lo marca leído sin recargar: lo escrito sigue y la campana baja a ${n0 - 1} («${etiqueta1}»)`)
    await campana(pagina).click()
    await pagina.locator('#panel-avisos').getByRole('button', { name: 'Marcar todos leídos' }).click()
    await hasta(sinLeer, (n) => n === 0, 10000)
    await pagina.waitForTimeout(1500)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1l-campana.png'), fullPage: true })
    const mismo = await mismoDocumento(pagina)
    const etiqueta = await campana(pagina).getAttribute('aria-label')
    const negritas = await pagina.locator('#panel-avisos p.font-semibold').count()
    comprobar(mismo && corte.documentos === d0 && (await pagina.inputValue('#rd-asunto')) === asunto && (await miniaturas(pagina)) === 1 && (await existe('fotos-reporte-diario', ruta)),
      `[Maestranza 390] 1l. «Marcar todos leídos» no recarga: lo escrito y la foto siguen (mismo documento ${mismo}, ${corte.documentos - d0} documentos)`)
    comprobar(etiqueta === 'Avisos' && negritas === 0 && (await pagina.locator('#panel-avisos').getByRole('button', { name: 'Marcar todos leídos' }).count()) === 0,
      `[Maestranza 390] 1l. y la campana los pinta leídos sin repintar la pantalla («${etiqueta}», ${negritas} sin leer en la lista)`)
    await pagina.getByRole('button', { name: 'Cerrar notificaciones' }).click()
    // Y el reporte todavía entra, con su foto.
    await Promise.all([
      pagina.waitForURL((u) => /^\/reportes-diarios\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 }).catch(() => {}),
      subirReporte(pagina).click(),
    ])
    const [rd] = await consulta(`select count(*)::int n from reporte_diario_fotos where ruta = $1`, [ruta])
    comprobar(rd?.n === 1, `[Maestranza 390] 1l. después, el reporte entra con su foto (${new URL(pagina.url()).pathname})`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1l. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }
  // 1l. Lo mismo antes de que la pestaña sepa del despliegue (sigue «al día»):
  // la respuesta de la acción lo dice, y arriba aparece el aviso.
  if (corre('1l')) {
    await sembrarAvisos(1, `Aviso sin saberlo ${sello}`)
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, false)
    await marcarDocumento(pagina)
    const d0 = corte.documentos
    corte.despliegue = true
    corte.conservaIds = true
    await campana(pagina).click()
    await pagina.locator('#panel-avisos').getByRole('button', { name: 'Marcar todos leídos' }).click()
    await hasta(sinLeer, (n) => n === 0, 10000)
    const arriba = limpio(await hasta(() => avisoDeArriba(pagina), Boolean, 10000))
    await pagina.waitForTimeout(1500)
    const mismo = await mismoDocumento(pagina)
    comprobar(mismo && corte.documentos === d0 && (await pagina.inputValue('#rd-asunto')) === asunto && arriba.startsWith(TEXTO_NUEVA) && (await campana(pagina).getAttribute('aria-label')) === 'Avisos',
      `[Maestranza 390] 1l. sin saberse todavía del despliegue, «Marcar todos leídos» no recarga, la campana queda en cero y arriba lo dice (mismo documento ${mismo})`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1l. sin saberlo, sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1m. «Volver a cargar» con el reporte en camino: espera a que vuelva, y como
  // entró, lleva a él. Antes quitaba la foto que el envío nombraba, el servidor
  // no la encontraba y la pantalla recargaba vacía (Importante 1 de la
  // trigesimoprimera). La acción se retiene antes de salir, como el servidor en frío.
  if (corre('1m')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    corte.despliegue = true
    corte.conservaIds = true
    await salirYVolver(pagina)
    await hasta(() => pagina.locator('[data-pestana-vieja="nueva"]').count(), (n) => n === 1, 15000)
    await marcarDocumento(pagina)
    const n0 = await reportes()
    corte.marca = asunto
    await subirReporte(pagina).click()
    await hasta(() => corte.retenidas, (n) => n > 0, 15000)
    await pagina.locator('[data-pestana-vieja]').getByRole('button', { name: 'Volver a cargar' }).click()
    await pagina.waitForTimeout(2000)
    const esperando = (await mismoDocumento(pagina)) && (await existe('fotos-reporte-diario', ruta))
    await Promise.all([
      pagina.waitForURL((u) => /^\/reportes-diarios\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 }).catch(() => {}),
      corte.soltar(),
    ])
    await quieta(pagina)
    const [rd] = await consulta(
      `select r.id, (select count(*)::int from reporte_diario_fotos f where f.reporte_id = r.id and f.ruta = $2) as fotos
       from reportes_diarios r where r.asunto = $1 order by r.creado_en desc limit 1`,
      [asunto, ruta],
    )
    const llego = new URL(pagina.url()).pathname
    comprobar(esperando, `[Maestranza 390] 1m. «Volver a cargar» con el reporte en camino espera: ni recarga ni quita la foto mientras tanto`)
    comprobar((await reportes()) === n0 + 1 && rd?.fotos === 1 && (await existe('fotos-reporte-diario', ruta)) && llego === `/reportes-diarios/${rd?.id}`,
      `[Maestranza 390] 1m. cuando vuelve, el reporte entró con su foto y la pantalla lleva a él (${llego})`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1m. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1n. El reporte que no se sabe si entró (la respuesta no llegó, y sí entró),
  // en la pestaña que después se sabe vieja: su foto no se quita ni dice «Se
  // quitó… elígela otra vez», que llevaba a subirlo dos veces con sus horas (F2
  // de la trigesimoprimera). Debajo se pide buscarlo antes de subirlo otra vez.
  if (corre('1n')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    const n0 = await reportes()
    corte.perder = asunto
    await subirReporte(pagina).click()
    const sinRespuesta = limpio(await hasta(() => pagina.locator('main [role="alert"]').filter({ hasText: SIN_RESPUESTA }).allInnerTexts().then((t) => t.join(' ')), Boolean))
    const entro = (await hasta(reportes, (n) => n === n0 + 1, 10000)) === n0 + 1
    comprobar(corte.perdidas === 1 && Boolean(sinRespuesta) && entro, `[Maestranza 390] 1n. la respuesta no llega y el reporte sí entró («${sinRespuesta}»)`)
    corte.despliegue = true
    await salirYVolver(pagina)
    await hasta(() => pagina.locator('[data-pestana-vieja="vieja"]').count(), (n) => n === 1, 15000)
    await pagina.waitForTimeout(2000)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1n-en-duda.png'), fullPage: true })
    const enDuda = await pagina.getByText('No se sabe si entró el reporte que enviaste: búscalo en Reportes diarios antes de volver a cargar la pantalla y subirlo otra vez.', { exact: true }).count()
    comprobar((await existe('fotos-reporte-diario', ruta)) && (await pagina.locator('[data-fotos-quitadas]').count()) === 0 && (await pagina.locator('main').getByText('Se quitó', { exact: true }).count()) === 0 && enDuda === 1,
      `[Maestranza 390] 1n. al saberse vieja, la foto del reporte en duda no se quita ni dice «Se quitó», y debajo se pide buscarlo antes de subirlo otra vez`)
    await subirReporte(pagina).click()
    const dice = limpio(await hasta(() => pagina.locator('main [role="alert"]').filter({ hasText: SE_ACTUALIZO }).allInnerTexts().then((t) => t.join(' ')), Boolean))
    comprobar(dice === 'El sistema se actualizó mientras tenías la pantalla abierta. Copia lo escrito y vuelve a cargar la pantalla.' && (await existe('fotos-reporte-diario', ruta)) && (await reportes()) === n0 + 1,
      `[Maestranza 390] 1n. «Subir reporte» otra vez no pide elegir las fotos de nuevo, y la foto del que entró sigue («${dice}»)`)
    corte.despliegue = false
    comprobar(errores.length === 0, `[Maestranza 390] 1n. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1o. La sesión que vence (X8 de la crítica de la trigesimoprimera): el proxy
  // la refrescaba durante la acción, Next la respondía revalidada y, en la
  // pestaña de otro despliegue, recargaba el documento sin que nadie enviara
  // nada. Ahora se refresca antes, en un GET a /auth/sesion.
  if (corre('1o')) {
    const titulo = `Aviso de la sesión vencida ${sello}`
    await sembrarAvisos(2, titulo)
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await marcarDocumento(pagina)
    const d0 = corte.documentos
    // La primera pregunta tras el despliegue, al volver, con la sesión vencida:
    // todavía no se sabe «nueva».
    corte.despliegue = true
    corte.conservaIds = true
    let s0 = corte.sesion
    let vencia = await vencerLaSesion(contexto)
    await salirYVolver(pagina)
    const arriba = limpio(await hasta(() => avisoDeArriba(pagina), Boolean, 15000))
    await pagina.waitForTimeout(2000)
    let mismo = await mismoDocumento(pagina)
    comprobar(arriba.startsWith(TEXTO_NUEVA) && mismo && corte.documentos === d0 && (await pagina.inputValue('#rd-asunto')) === asunto && (await miniaturas(pagina)) === 1,
      `[Maestranza 390] 1o. con la sesión vencida, la pregunta al volver descubre el despliegue sin recargar: arriba lo dice y lo escrito y la foto siguen (mismo documento ${mismo})`)
    let ahora = await venceLaSesion(contexto)
    comprobar(corte.sesion > s0 && ahora > vencia && ahora * 1000 > Date.now() + 50 * 60_000,
      `[Maestranza 390] 1o. la sesión se refrescó antes de la pregunta, en /auth/sesion (${corte.sesion - s0} pedidos; vence en ${Math.round((ahora * 1000 - Date.now()) / 60_000)} min)`)
    // Ya «nueva», otra vez vencida: lo leído de la campana. El reloj de la
    // página se adelanta medio minuto: recién preguntada, la sesión no se
    // vuelve a preguntar, y aquí venció de golpe.
    s0 = corte.sesion
    vencia = await vencerLaSesion(contexto)
    await adelantarElReloj(pagina, 31_000)
    const n0 = await sinLeer()
    await campana(pagina).click()
    await pagina.locator('#panel-avisos').getByRole('button', { name: new RegExp(`^${titulo} 1`) }).click()
    await hasta(sinLeer, (n) => n === n0 - 1, 10000)
    await campana(pagina).click()
    await pagina.locator('#panel-avisos').getByRole('button', { name: 'Marcar todos leídos' }).click()
    await hasta(sinLeer, (n) => n === 0, 10000)
    await pagina.waitForTimeout(2000)
    mismo = await mismoDocumento(pagina)
    ahora = await venceLaSesion(contexto)
    comprobar(mismo && corte.documentos === d0 && (await pagina.inputValue('#rd-asunto')) === asunto && (await existe('fotos-reporte-diario', ruta)) && corte.sesion > s0 && ahora > vencia,
      `[Maestranza 390] 1o. en «nueva» y con la sesión vencida, tocar un aviso y «Marcar todos leídos» no recargan: la sesión se refrescó antes (${corte.sesion - s0} pedidos, mismo documento ${mismo})`)
    await pagina.getByRole('button', { name: 'Cerrar notificaciones' }).click().catch(() => {})
    // Y con la sesión al día no se pregunta en cada acción: una vez cada cinco
    // minutos. Un aviso ya leído, tocado otra vez, también llama a la acción.
    s0 = corte.sesion
    const a0 = corte.acciones
    await campana(pagina).click()
    await pagina.locator('#panel-avisos').getByRole('button', { name: new RegExp(`^${titulo} 2`) }).click()
    await hasta(() => corte.acciones, (n) => n > a0, 10000)
    await pagina.waitForTimeout(1000)
    comprobar(corte.acciones > a0 && corte.sesion === s0 && (await mismoDocumento(pagina)),
      `[Maestranza 390] 1o. con la sesión al día, la acción siguiente no pregunta otra vez (${corte.acciones - a0} acciones, ${corte.sesion - s0} pedidos a /auth/sesion)`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1o. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1p. «Volver a cargar» con el reporte en camino, en sus otros desenlaces
  // (D13 e Importante 2 de la trigesimosegunda): antes recargaba igual y el
  // formulario volvía vacío con el reporte rechazado, sin respuesta, colgado o
  // con la pantalla del reporte lenta.
  const alertaDelFormulario = (pagina) => pagina.locator('main [role="alert"]').allInnerTexts().then((t) => limpio(t.join(' ')))

  if (corre('1p-rechazo')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true, { sinPersona: true })
    const [ruta] = (await subidas()).slice(-1)
    await hastaLaPestanaNueva(pagina, corte)
    await marcarDocumento(pagina)
    const n0 = await reportes()
    corte.marca = asunto
    await subirReporte(pagina).click()
    await hasta(() => corte.retenidas, (n) => n > 0, 15000)
    await botonDeArriba(pagina, 'Volver a cargar').click()
    corte.soltar()
    const rechazo = await hasta(() => alertaDelFormulario(pagina), (t) => t?.includes('Pon al menos a una persona'), 15000)
    const dice = await hasta(() => sinRecargar(pagina), (t) => t === NO_ENTRO, 10000)
    await pagina.waitForTimeout(2000)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1p-rechazo.png'), fullPage: true })
    const mismo = await mismoDocumento(pagina)
    comprobar(mismo && rechazo?.includes('Pon al menos a una persona') && (await pagina.inputValue('#rd-asunto')) === asunto && (await existe('fotos-reporte-diario', ruta)) && (await reportes()) === n0,
      `[Maestranza 390] 1p. «Volver a cargar» con el reporte en camino que vuelve rechazado no recarga: el rechazo y lo escrito siguen, y la foto también (mismo documento ${mismo}, «${rechazo}»)`)
    comprobar(dice === NO_ENTRO && (await botonDeArriba(pagina, 'Volver a cargar igual').count()) === 1 && !(await botonDeArriba(pagina, 'Volver a cargar igual').isDisabled()),
      `[Maestranza 390] 1p. arriba dice por qué no recargó, y el botón pasa a «Volver a cargar igual» («${dice}»)`)
    await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}), botonDeArriba(pagina, 'Volver a cargar igual').click()])
    corte.despliegue = false
    corte.conservaIds = false
    await quieta(pagina)
    comprobar(!(await mismoDocumento(pagina)) && !(await existe('fotos-reporte-diario', ruta)),
      `[Maestranza 390] 1p. «Volver a cargar igual» recarga, y antes quita la foto que ningún reporte nombra`)
    comprobar(errores.length === 0, `[Maestranza 390] 1p-rechazo. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  if (corre('1p-sin-respuesta')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await hastaLaPestanaNueva(pagina, corte)
    await marcarDocumento(pagina)
    const n0 = await reportes()
    corte.marca = asunto
    corte.perder = asunto
    await subirReporte(pagina).click()
    await hasta(() => corte.retenidas, (n) => n > 0, 15000)
    await botonDeArriba(pagina, 'Volver a cargar').click()
    corte.soltar()
    const sinRespuesta = await hasta(() => alertaDelFormulario(pagina), (t) => SIN_RESPUESTA.test(t ?? ''), 15000)
    const dice = await hasta(() => sinRecargar(pagina), (t) => t === NO_ENTRO, 10000)
    await pagina.waitForTimeout(2000)
    const mismo = await mismoDocumento(pagina)
    const entro = (await hasta(reportes, (n) => n === n0 + 1, 10000)) === n0 + 1
    comprobar(corte.perdidas === 1 && mismo && SIN_RESPUESTA.test(sinRespuesta ?? '') && dice === NO_ENTRO && (await pagina.inputValue('#rd-asunto')) === asunto && (await existe('fotos-reporte-diario', ruta)) && entro,
      `[Maestranza 390] 1p. sin respuesta (y sí entró) tampoco recarga: «No llegó la respuesta…» sigue junto al botón y la pantalla no invita a subirlo otra vez (mismo documento ${mismo})`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1p-sin-respuesta. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // Desde abajo, junto a «Subir reporte»: arriba queda fuera de la vista, y la
  // franja de una línea bajo la cabecera dice lo mismo (D12).
  if (corre('1p-colgado')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await subirReporte(pagina).scrollIntoViewIfNeeded()
    comprobar((await pagina.locator('[data-franja-pestana-vieja]').count()) === 0, `[Maestranza 390] 1p. sin despliegue no hay franja`)
    await hastaLaPestanaNueva(pagina, corte)
    await subirReporte(pagina).scrollIntoViewIfNeeded()
    const franja = pagina.locator('[data-franja-pestana-vieja="nueva"]')
    await franja.waitFor({ timeout: 5000 }).catch(() => {})
    const medida = await pagina.evaluate(() => {
      const f = document.querySelector('[data-franja-pestana-vieja]')?.getBoundingClientRect()
      const c = document.querySelector('[data-barra-superior]')?.getBoundingClientRect()
      return { arriba: f?.top ?? null, alto: f?.height ?? null, cabecera: c?.bottom ?? null, ancho: document.documentElement.scrollWidth }
    })
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1p-franja.png') })
    const textoFranja = limpio(await franja.innerText().catch(() => ''))
    comprobar(textoFranja === 'El sistema se actualizó: al enviar algo, la pantalla se vuelve a cargar. Volver a cargar' && Math.abs(medida.arriba - medida.cabecera) < 1 && medida.alto <= 60 && medida.ancho <= CELULAR.width,
      `[Maestranza 390] 1p. con la pantalla bajada, la franja queda a la vista bajo la cabecera, baja y sin correr la pantalla de lado («${textoFranja}», arriba ${medida.arriba} y cabecera ${medida.cabecera}, alto ${medida.alto}, ancho ${medida.ancho})`)
    await marcarDocumento(pagina)
    const n0 = await reportes()
    corte.marca = asunto
    await subirReporte(pagina).click()
    await hasta(() => corte.retenidas, (n) => n > 0, 15000)
    await franja.getByRole('button', { name: 'Volver a cargar', exact: true }).click()
    await pagina.waitForTimeout(11_000)
    const enLaFranja = limpio(await franja.locator('p').innerText().catch(() => ''))
    const igual = franja.getByRole('button', { name: 'Volver a cargar igual', exact: true })
    const mismo = await mismoDocumento(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1p-colgado.png') })
    comprobar(mismo && enLaFranja === EN_CAMINO && (await igual.count()) === 1 && !(await igual.isDisabled()) && (await existe('fotos-reporte-diario', ruta)) && (await pagina.inputValue('#rd-asunto')) === asunto,
      `[Maestranza 390] 1p. con el reporte colgado más de 10 s no recarga: la franja dice que todavía no contesta y ofrece «Volver a cargar igual» («${enLaFranja}», mismo documento ${mismo})`)
    comprobar((await sinRecargar(pagina)) === EN_CAMINO, `[Maestranza 390] 1p. y arriba, en la región que el lector oye, lo mismo`)
    await Promise.all([
      pagina.waitForURL((u) => /^\/reportes-diarios\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 30000 }).catch(() => {}),
      corte.soltar(),
    ])
    await quieta(pagina)
    const llego = new URL(pagina.url()).pathname
    const [rd] = await consulta(`select r.id from reportes_diarios r join reporte_diario_fotos f on f.reporte_id = r.id and f.ruta = $2 where r.asunto = $1`, [asunto, ruta])
    comprobar((await reportes()) === n0 + 1 && llego === `/reportes-diarios/${rd?.id}`, `[Maestranza 390] 1p. cuando contesta, el reporte entró con su foto y la pantalla lleva a él (${llego})`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1p-colgado. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // La pantalla del reporte tarda (poca señal): «Volver a cargar» no la corta.
  // Sin el service worker, para que el documento también pase por aquí.
  if (corre('1p-destino-lento')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true, sinSw: true })
    await llenar(pagina, false)
    await hastaLaPestanaNueva(pagina, corte)
    const n0 = await reportes()
    corte.marca = asunto
    await subirReporte(pagina).click()
    await hasta(() => corte.retenidas, (n) => n > 0, 15000)
    await botonDeArriba(pagina, 'Volver a cargar').click()
    corte.lento = { patron: /\/reportes-diarios\/[0-9a-f-]{36}/, ms: 6000 }
    await Promise.all([
      pagina.waitForURL((u) => /^\/reportes-diarios\/[0-9a-f-]{36}$/.test(u.pathname), { timeout: 40000 }).catch(() => {}),
      corte.soltar(),
    ])
    await quieta(pagina)
    await pagina.waitForTimeout(2000)
    const llego = new URL(pagina.url()).pathname
    const [rd] = await consulta(`select id from reportes_diarios where asunto = $1 order by creado_en desc limit 1`, [asunto])
    comprobar((await reportes()) === n0 + 1 && corte.demorados > 0 && llego === `/reportes-diarios/${rd?.id}`,
      `[Maestranza 390] 1p. con la pantalla del reporte lenta (${corte.demorados} pedidos de 6 s), «Volver a cargar» no la corta: termina en el reporte (${llego})`)
    corte.lento = null
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1p-destino-lento. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // Y si tarda más de 15 s, arriba se dice que ya está guardado, y el toque
  // siguiente va a la pantalla del reporte: recargaba el formulario, que
  // ofrecía subirlo otra vez (F2 de la trigesimotercera). Con su foto, que
  // «Volver a cargar» no quita: la nombra el reporte.
  if (corre('1p-se-va')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true, sinSw: true })
    await llenar(pagina, true)
    const [ruta] = (await subidas()).slice(-1)
    await hastaLaPestanaNueva(pagina, corte)
    const n0 = await reportes()
    corte.marca = asunto
    await subirReporte(pagina).click()
    await hasta(() => corte.retenidas, (n) => n > 0, 15000)
    await botonDeArriba(pagina, 'Volver a cargar').click()
    // La pantalla del reporte tarda 40 s, desde lo que Next pide antes del
    // documento: mientras, la pestaña sigue en el formulario, con su aviso.
    corte.lento = { patron: /\/reportes-diarios\/[0-9a-f-]{36}/, ms: 40_000 }
    corte.soltar()
    const dice = await hasta(() => sinRecargar(pagina), (t) => t === SE_VA, 30000)
    const donde = new URL(pagina.url()).pathname
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1p-se-va.png'), fullPage: true })
    comprobar((await reportes()) === n0 + 1 && corte.demorados > 0 && dice === SE_VA && (await botonDeArriba(pagina, 'Volver a cargar igual').count()) === 1,
      `[Maestranza 390] 1p. el reporte entró y su pantalla tarda más de 15 s: arriba dice que ya está guardado y ofrece «Volver a cargar igual» («${dice}», en ${donde})`)
    corte.lento = null
    // Por lo que muestra, no solo por la dirección.
    await pagina.locator('[data-pestana-vieja] button').first().click()
    const enElReporte = await hasta(
      () => pagina.evaluate((asunto) => !document.querySelector('#rd-asunto') && (document.querySelector('main')?.innerText ?? '').includes(asunto), asunto).catch(() => false),
      Boolean,
      15000,
    )
    await quieta(pagina)
    const llego = new URL(pagina.url()).pathname
    const [rd] = await consulta(`select r.id from reportes_diarios r join reporte_diario_fotos f on f.reporte_id = r.id and f.ruta = $2 where r.asunto = $1`, [asunto, ruta])
    comprobar(enElReporte && llego === `/reportes-diarios/${rd?.id}` && (await reportes()) === n0 + 1 && (await existe('fotos-reporte-diario', ruta)),
      `[Maestranza 390] 1p. el toque siguiente va al reporte, no al formulario, y su foto sigue (${llego}, en el reporte ${enElReporte})`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 390] 1p-se-va. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1r. La pastilla «Sin leer (N)» de /avisos en la pestaña «nueva»: lo leído
  // lo pinta la pestaña, y la pastilla seguía con el número del servidor (D11).
  if (corre('1r')) {
    const titulo = `Aviso de la pastilla ${sello}`
    await sembrarAvisos(3, titulo)
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, { width: 1440, height: 900 }, { compilacion: true })
    await ir(pagina, `${BASE}/avisos`)
    await marcarDocumento(pagina)
    const d0 = corte.documentos
    await hastaLaPestanaNueva(pagina, corte)
    const pastilla = () => pagina.getByRole('group', { name: 'Filtrar avisos' }).getByRole('link', { name: /^Sin leer/ }).innerText().then(limpio)
    const n0 = await sinLeer()
    const antes = await pastilla()
    await pagina.locator('main').getByRole('button', { name: new RegExp(`^${titulo} 1`) }).click()
    await hasta(sinLeer, (n) => n === n0 - 1, 10000)
    const tras1 = await hasta(pastilla, (t) => t === `Sin leer (${n0 - 1})`, 5000)
    await pagina.locator('main').getByRole('button', { name: `Marcar los ${n0 - 1} como leídos` }).click()
    await hasta(sinLeer, (n) => n === 0, 10000)
    const tras2 = await hasta(pastilla, (t) => t === 'Sin leer (0)', 5000)
    const mismo = await mismoDocumento(pagina)
    comprobar(antes === `Sin leer (${n0})` && tras1 === `Sin leer (${n0 - 1})` && tras2 === 'Sin leer (0)' && mismo && corte.documentos === d0,
      `[Maestranza 1440] 1r. en /avisos de la pestaña «nueva», la pastilla baja con lo leído sin recargar («${antes}» → «${tras1}» → «${tras2}»)`)
    corte.despliegue = false
    corte.conservaIds = false
    comprobar(errores.length === 0, `[Maestranza 1440] 1r. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1y. El reporte que entra con «Más» abierta queda en el formulario, trabado
  // y con su foto a la vista. Al saberse vieja la pestaña, la foto se daba por
  // suelta: decía «Se quitó» y abajo se pedía volver a cargar para subir el
  // reporte, junto a «El reporte quedó registrado» (H3 de funcionalidad,
  // cuadragésima pasada).
  if (corre('1y-reporte-que-entro')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, true, { quien: personaY })
    const [ruta] = (await subidas()).slice(-1)
    await marcarDocumento(pagina)
    const n0 = await reportes()
    const subir = subirReporte(pagina)
    corte.marca = asunto
    await subir.evaluate((b) => b.scrollIntoView({ block: 'center' }))
    await subir.tap()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await pagina.locator('[data-barra-inferior] button').filter({ hasText: 'Más' }).tap()
    const mas = pagina.getByRole('dialog', { name: 'Tus secciones' })
    await mas.waitFor({ timeout: 10000 })
    corte.soltar()
    await hasta(reportes, (n) => n === n0 + 1, 40000)
    const junto = await hasta(() => yaQuedo(pagina), (t) => t.includes('El reporte quedó registrado.'), 15000)
    await pagina.waitForTimeout(1500)
    await mas.getByRole('button', { name: 'Cerrar', exact: true }).tap()
    await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    const donde = pagina.url().replace(BASE, '')
    const trabado = (await subir.isDisabled()) && (await pagina.locator('#rd-asunto').isDisabled())
    comprobar(donde === '/reportes-diarios/nuevo' && junto === 'El reporte quedó registrado. Ver el reporte' && trabado && (await miniaturas(pagina)) === 1 && (await mismoDocumento(pagina)),
      `[Maestranza 390] 1y-reporte-que-entro. el reporte entra con «Más» abierta: se queda, trabado, con su foto y lo dice junto al botón (${donde}, «${junto}», trabado ${trabado})`)
    // La pestaña se sabe vieja: la foto es del reporte que entró, y no se toca.
    const s0 = corte.storage.length
    corte.despliegue = true
    await salirYVolver(pagina)
    await hasta(() => pagina.locator('[data-pestana-vieja="vieja"]').count(), (n) => n === 1, 20000)
    await pagina.waitForTimeout(4000)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1y-reporte-que-entro.png'), fullPage: true })
    const borrados = () => corte.storage.slice(s0).filter((s) => s.startsWith('DELETE'))
    const seQuito = await pagina.locator('main').getByText('Se quitó', { exact: true }).count()
    const quitadas = limpio(await pagina.locator('[data-fotos-quitadas]').innerText({ timeout: 500 }).catch(() => ''))
    const recargar = await pagina.getByText('Vuelve a cargar la pantalla para subir el reporte.', { exact: true }).count()
    const sigue = await yaQuedo(pagina)
    comprobar(Boolean(ruta) && borrados().length === 0 && seQuito === 0 && quitadas === '' && recargar === 0 && sigue === junto && (await miniaturas(pagina)) === 1,
      `[Maestranza 390] 1y-reporte-que-entro. al saberse vieja, la foto del reporte que entró no se quita ni dice «Se quitó», y abajo no pide volver a cargar para subirlo (${borrados().length} borrados, «Se quitó» ${seQuito}, «${quitadas}», volver a cargar ${recargar}, junto al botón «${sigue}»)`)
    // «Volver a cargar», como pide el aviso de arriba: tampoco la toca. La
    // recarga pasa por el service worker y no por CDP: se ve en la marca, que
    // se va con el documento.
    await botonDeArriba(pagina, 'Volver a cargar').click()
    const recargo = !(await hasta(() => mismoDocumento(pagina), (v) => v === false, 20000))
    await quieta(pagina)
    const nombrada = Number((await consulta(`select count(*) n from reporte_diario_fotos f join reportes_diarios r on r.id = f.reporte_id where r.asunto = $1 and f.ruta = $2`, [asunto, ruta]))[0].n)
    comprobar(recargo && borrados().length === 0 && (await existe('fotos-reporte-diario', ruta)) && nombrada === 1,
      `[Maestranza 390] 1y-reporte-que-entro. «Volver a cargar» recarga sin pedir que se quite la foto, que sigue con su reporte (recargó ${recargo}, ${borrados().length} borrados, nombrada ${nombrada})`)
    corte.despliegue = false
    comprobar(errores.length === 0, `[Maestranza 390] 1y-reporte-que-entro. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1z. El rechazo del reporte que vuelve cuando la persona ya pidió otra
  // pantalla: Next deja esa ida en cola, y el rechazo se pintaba en el
  // formulario unos milisegundos antes de irse con él. En la pantalla pedida
  // nada decía que el reporte no había entrado (Y1 de la crítica, cuadragésima
  // primera pasada). Arriba lo dice, en rojo y con el camino de vuelta.
  if (corre('1z-rechazo-del-reporte')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR)
    await llenar(pagina, false, { sinPersona: true })
    await marcarDocumento(pagina)
    const n0 = await reportes()
    const subir = subirReporte(pagina)
    corte.marca = asunto
    await subir.evaluate((b) => b.scrollIntoView({ block: 'center' }))
    await subir.tap()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    // Mientras va, «Más» y otra sección: Next la deja en cola detrás del envío.
    await pagina.locator('[data-barra-inferior] button').filter({ hasText: 'Más' }).tap()
    const mas = pagina.getByRole('dialog', { name: 'Tus secciones' })
    await mas.waitFor({ timeout: 10000 })
    await mas.locator('a[href="/reportes-diarios"]').first().tap()
    await pagina.waitForTimeout(800)
    corte.soltar()
    await pagina.waitForURL((u) => u.pathname === '/reportes-diarios', { timeout: 20000 }).catch(() => {})
    const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('no se guardó'), 15000)
    await pagina.waitForTimeout(1500)
    const donde = pagina.url().replace(BASE, '')
    const tono = await pagina.locator('[data-ida-que-no-salio]').getAttribute('data-ida-que-no-salio').catch(() => null)
    const aLaVista = await lineaALaVista(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1z-rechazo-del-reporte.png') })
    comprobar(donde === '/reportes-diarios' && dice.startsWith('El reporte no se guardó. Pon al menos a una persona') && dice.endsWith('Volver al reporte') && tono === 'rechazo' && aLaVista && (await reportes()) === n0 && (await mismoDocumento(pagina)),
      `[Maestranza 390] 1z-rechazo-del-reporte. el rechazo que vuelve después de pedir otra sección lo dice arriba, a la vista, en rojo y con el camino de vuelta (${donde}, «${dice}», ${tono}, a la vista ${aLaVista}, ${(await reportes()) - n0} reportes)`)
    // «Volver al reporte»: en el formulario vacío sigue el motivo, sin el enlace.
    await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver al reporte' }).tap({ timeout: 5000 }).catch(() => {})
    await pagina.waitForURL((u) => u.pathname === '/reportes-diarios/nuevo', { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    const alVolver = await idaQueNoSalio(pagina)
    const enlaces = await pagina.locator('[data-ida-que-no-salio] a').count()
    comprobar(pagina.url().replace(BASE, '') === '/reportes-diarios/nuevo' && alVolver === dice.replace(/ Volver al reporte$/, '') && enlaces === 0 && (await mismoDocumento(pagina)),
      `[Maestranza 390] 1z-rechazo-del-reporte. de vuelta en el formulario, arriba sigue el motivo y ya no el enlace (${pagina.url().replace(BASE, '')}, «${alVolver}», ${enlaces} enlaces)`)
    // Se envía otra vez, sin irse: el rechazo nuevo lo dice el formulario y el de arriba se va.
    if (pagina.url().replace(BASE, '') === '/reportes-diarios/nuevo') {
      await llenar(pagina, false, { sinPersona: true, sinIr: true })
      await subir.evaluate((b) => b.scrollIntoView({ block: 'center' }))
      await subir.tap()
      const abajo = await hasta(() => alertaDelFormulario(pagina), (t) => t?.includes('Pon al menos a una persona'), 15000)
      const arriba = await idaQueNoSalio(pagina)
      comprobar(abajo?.includes('Pon al menos a una persona') && arriba === '' && (await reportes()) === n0,
        `[Maestranza 390] 1z-rechazo-del-reporte. al enviar otra vez desde el formulario, el rechazo nuevo va junto al botón y el de arriba se va («${abajo}», arriba «${arriba}»)`)
    } else {
      comprobar(false, `[Maestranza 390] 1z-rechazo-del-reporte. al enviar otra vez desde el formulario, el rechazo nuevo va junto al botón y el de arriba se va (no se volvió al formulario: ${pagina.url().replace(BASE, '')})`)
    }
    comprobar(errores.length === 0, `[Maestranza 390] 1z-rechazo-del-reporte. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // 1za. El reporte que ya había quedado la primera vez (la respuesta no
  // llegó), corregido y enviado otra vez con la persona yéndose por «Más»: el
  // formulario decía «ya quedó… Ver el reporte» y se iba con él, y lo cambiado
  // se perdía sin que nada lo dijera (H3 de funcionalidad, cuadragésima segunda
  // pasada). Arriba lo dice, con el enlace al reporte.
  if (corre('1za-ya-habia-quedado')) {
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, CELULAR, { compilacion: true })
    await llenar(pagina, false, { quien: personaZ })
    await marcarDocumento(pagina)
    const n0 = await reportes()
    const subir = subirReporte(pagina)
    corte.perder = asunto
    await subir.evaluate((b) => b.scrollIntoView({ block: 'center' }))
    await subir.tap()
    const sinRespuesta = await hasta(() => alertaDelFormulario(pagina), (t) => SIN_RESPUESTA.test(t ?? ''), 15000)
    const entro = (await hasta(reportes, (n) => n === n0 + 1, 10000)) === n0 + 1
    comprobar(corte.perdidas === 1 && SIN_RESPUESTA.test(sinRespuesta ?? '') && entro,
      `[Maestranza 390] 1za-ya-habia-quedado. la respuesta no llega y el reporte sí entró («${sinRespuesta}»)`)
    // Lo corrige y lo envía otra vez; mientras va, «Más» y Reportes diarios.
    await pagina.fill('#rd-descripcion', 'Se ordenó la planta, se soldaron los soportes y se pintó la tolva.')
    corte.marca = asunto
    await subir.evaluate((b) => b.scrollIntoView({ block: 'center' }))
    await subir.tap()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await pagina.locator('[data-barra-inferior] button').filter({ hasText: 'Más' }).tap()
    const mas = pagina.getByRole('dialog', { name: 'Tus secciones' })
    await mas.waitFor({ timeout: 10000 })
    await mas.locator('a[href="/reportes-diarios"]').first().tap()
    await pagina.waitForTimeout(800)
    corte.soltar()
    await pagina.waitForURL((u) => u.pathname === '/reportes-diarios', { timeout: 20000 }).catch(() => {})
    const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('ya había quedado'), 15000)
    await pagina.waitForTimeout(1500)
    const donde = pagina.url().replace(BASE, '')
    const tono = await pagina.locator('[data-ida-que-no-salio]').getAttribute('data-ida-que-no-salio').catch(() => null)
    const enlace = await pagina.locator('[data-ida-que-no-salio] a').getAttribute('href').catch(() => null)
    const aLaVista = await lineaALaVista(pagina)
    const [rd] = await consulta(`select id from reportes_diarios where asunto = $1 order by creado_en desc limit 1`, [asunto])
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1za-ya-habia-quedado.png') })
    comprobar(donde === '/reportes-diarios' && dice === 'El reporte ya había quedado la primera vez que lo enviaste; lo que cambiaste después no se guardó. Ver el reporte' && tono === 'ya-habia-quedado' && enlace === `/reportes-diarios/${rd?.id}` && aLaVista && (await reportes()) === n0 + 1 && (await mismoDocumento(pagina)),
      `[Maestranza 390] 1za-ya-habia-quedado. lo enviado otra vez después de pedir otra sección dice arriba que el reporte ya había quedado y lo cambiado no, con el enlace al reporte (${donde}, «${dice}», tono «${tono}», ${enlace}, a la vista ${aLaVista}, ${(await reportes()) - n0} reportes)`)
    // «Ver el reporte» lleva a lo que quedó, y la línea se va.
    await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Ver el reporte' }).tap({ timeout: 5000 }).catch(() => {})
    await pagina.waitForURL((u) => u.pathname === `/reportes-diarios/${rd?.id}`, { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    const alLlegar = await idaQueNoSalio(pagina)
    comprobar(pagina.url().replace(BASE, '') === `/reportes-diarios/${rd?.id}` && alLlegar === '' && (await reportes()) === n0 + 1,
      `[Maestranza 390] 1za-ya-habia-quedado. «Ver el reporte» lleva al que quedó y la línea se va (${pagina.url().replace(BASE, '')}, «${alLlegar}»)`)
    comprobar(errores.length === 0, `[Maestranza 390] 1za-ya-habia-quedado. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }

  // Su costo, como se lo pondría RR. HH.: las horas del reporte que entró pasan
  // al costeo, y el aviso de «Horas… que esperan su costo» no queda prendido
  // para probar-reporte-diario.
  for (const nombre of [persona, personaY, personaZ]) {
    await consulta(
      `insert into trabajador_costos (trabajador_id, costo_mensual) select id, 1680 from trabajadores where nombres = $1
        and not exists (select 1 from trabajador_costos c where c.trabajador_id = trabajadores.id)`,
      [nombre],
    )
    await consulta(`update trabajadores set activo = false where nombres = $1`, [nombre])
  }
}

// ------------------------------------------- 1f. La planilla sin internet del kardex (Almacén)
if (corre('1f')) {
  const codigo = `QA-VIEJA-P-${sello}`
  const materialId = await materialPropio(codigo, `Disco de corte de la pestaña vieja ${sello}`)
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.almacen])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const movimientos = async () => Number((await consulta(`select count(*) n from movimientos_materiales where material_id = $1`, [materialId]))[0].n)
  const sueltas = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'evidencias-almacen' and o.owner_id = $1 and o.created_at >= $2
        and not exists (select 1 from movimientos_materiales m where m.foto_ruta = o.name)`, [yo, desde])).map((o) => o.name)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.almacen)
  await ir(pagina, `${BASE}/almacen/kardex`)
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(await (await pagina.request.get(`${BASE}/almacen/kardex/planilla`)).body())
  let unidad = null
  libro.getWorksheet('Unidades')?.eachRow((f, n) => {
    if (n > 1 && !unidad && f.getCell(1).value) unidad = String(f.getCell(1).value)
  })
  const [a, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }).split('-').map(Number)
  const salidas = libro.getWorksheet('Salidas')
  salidas.getCell(5, 1).value = new Date(Date.UTC(a, m - 1, d))
  salidas.getCell(5, 3).value = codigo
  salidas.getCell(5, 6).value = 1
  salidas.getCell(5, 7).value = `Vale de la pestaña vieja ${sello}`
  salidas.getCell(5, 8).value = unidad
  salidas.getCell(5, 9).value = 'Soldador de banco'
  const llena = join(archivos, `planilla-vieja-${sello}.xlsx`)
  await libro.xlsx.writeFile(llena)
  await pagina.getByRole('button', { name: /sin internet/i }).first().click()
  await pagina.getByRole('button', { name: /Cargar planilla/ }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor()
  await v.locator('#planilla-archivo').setInputFiles(llena)
  const foto = v.locator('input[type=file][aria-label^="Elegir la foto de la salida"]').first()
  await foto.waitFor({ state: 'attached', timeout: 30000 })
  await foto.setInputFiles(fotos.e)
  const boton = v.getByRole('button', { name: /^Registrar 1 movimiento/ })
  await boton.waitFor({ timeout: 30000 })
  const m0 = await movimientos()
  const a0 = corte.acciones
  const s0 = corte.storage.length
  corte.despliegue = true
  await boton.click()
  const resumen = limpio(await hasta(() => pagina.evaluate(() => (document.activeElement?.getAttribute('role') === 'status' ? document.activeElement.textContent : '')), Boolean, 30000))
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1f-planilla.png') })
  const alertas = await v.getByRole('alert').filter({ hasText: /actualizó/ }).count()
  const fila = limpio(await v.getByText('No salió: el sistema se actualizó.').first().innerText().catch(() => ''))
  const registrarOtraVez = await v.getByRole('button', { name: /^Registrar/ }).count()
  const enStorage = corte.storage.slice(s0).filter((x) => x.includes('evidencias-almacen'))
  comprobar(resumen === 'No se registró ninguno; 1 no salió porque el sistema se actualizó mientras tenías la pantalla abierta. Vuelve a cargar la pantalla y elige la planilla y sus fotos otra vez: lo registrado no se duplica.',
    `[Almacén 1280] 1f. la planilla desde la pestaña vieja: el resumen enfocado dice la causa y qué hacer («${resumen}»)`)
  comprobar(alertas === 0 && fila === 'No salió: el sistema se actualizó.' && registrarOtraVez === 0 && (await v.getByRole('button', { name: 'Volver a cargar la pantalla' }).count()) === 1,
    `[Almacén 1280] 1f. la fila dice «${fila}» sin alerta propia (${alertas}); no queda «Registrar» (${registrarOtraVez}) y sí «Volver a cargar la pantalla»`)
  comprobar(corte.acciones - a0 === 1 && (await movimientos()) === m0 && (await hasta(sueltas, (l) => l.length === 0, 10000)).length === 0,
    `[Almacén 1280] 1f. una sola llamada, ningún movimiento y ninguna foto suelta (${corte.acciones - a0} llamada; Storage: ${enStorage.join(', ') || 'nada'})`)
  corte.despliegue = false
  comprobar(errores.length === 0, `[Almacén 1280] 1f. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1f-conserva. La planilla, tras el despliegue de todos los días
// Un ingreso y dos salidas con su foto, en la pestaña que se sabe «nueva». Cada
// fila repintaba el kardex, y Next, que veía otra compilación, recargaba el
// documento a mitad de la planilla: la segunda salida no salía nunca, sin aviso
// (trigesimoprimera pasada). Ahora se pone al día al cerrar.
if (corre('1f-conserva')) {
  const codigo = `QA-NUEVA-P-${sello}`
  await materialPropio(codigo, `Disco de corte de la pestaña nueva ${sello}`)
  const marca = `Planilla nueva ${sello}`
  const movimientos = async () =>
    (await consulta(`select tipo, foto_ruta from movimientos_materiales where documento_referencia like $1 order by registrado_en`, [`${marca}%`]))
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.almacen, undefined, { compilacion: true })
  await ir(pagina, `${BASE}/almacen/kardex`)
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(await (await pagina.request.get(`${BASE}/almacen/kardex/planilla`)).body())
  let unidad = null
  libro.getWorksheet('Unidades')?.eachRow((f, n) => {
    if (n > 1 && !unidad && f.getCell(1).value) unidad = String(f.getCell(1).value)
  })
  const [a, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }).split('-').map(Number)
  const fecha = new Date(Date.UTC(a, m - 1, d))
  const ingresos = libro.getWorksheet('Ingresos')
  ingresos.getCell(5, 1).value = fecha
  ingresos.getCell(5, 3).value = codigo
  ingresos.getCell(5, 6).value = 3
  ingresos.getCell(5, 7).value = 'Ingreso general'
  ingresos.getCell(5, 8).value = `${marca} I1`
  const salidas = libro.getWorksheet('Salidas')
  for (const fila of [5, 6]) {
    salidas.getCell(fila, 1).value = fecha
    salidas.getCell(fila, 3).value = codigo
    salidas.getCell(fila, 6).value = 1
    salidas.getCell(fila, 7).value = `${marca} S${fila - 4}`
    salidas.getCell(fila, 8).value = unidad
    salidas.getCell(fila, 9).value = 'Soldador de banco'
  }
  const llena = join(archivos, `planilla-nueva-${sello}.xlsx`)
  await libro.xlsx.writeFile(llena)
  await pagina.getByRole('button', { name: /sin internet/i }).first().click()
  await pagina.getByRole('button', { name: /Cargar planilla/ }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor()
  await v.locator('#planilla-archivo').setInputFiles(llena)
  for (const [fila, foto] of [[5, fotos.a], [6, fotos.b]]) {
    const campo = v.getByLabel(`Elegir la foto de la salida de la fila ${fila}`)
    await campo.waitFor({ state: 'attached', timeout: 30000 })
    await campo.setInputFiles(foto)
  }
  const boton = v.getByRole('button', { name: /^Registrar 3 movimientos/ })
  await boton.waitFor({ timeout: 30000 })
  await marcarDocumento(pagina)
  const d0 = corte.documentos
  // La pestaña se sabe «nueva», con el aviso de arriba que invita a terminar.
  corte.despliegue = true
  corte.conservaIds = true
  await salirYVolver(pagina)
  await hasta(() => pagina.locator('[data-pestana-vieja="nueva"]').count(), (n) => n === 1, 15000)
  await boton.click()
  const resumen = limpio(await hasta(() => pagina.evaluate(() => (document.activeElement?.getAttribute('role') === 'status' ? document.activeElement.textContent : '')), Boolean, 45000))
  await pagina.waitForTimeout(3000)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1f-conserva.png') })
  const entraron = await movimientos()
  const mismo = await mismoDocumento(pagina)
  comprobar(entraron.length === 3 && entraron.filter((x) => x.foto_ruta).length === 2 && mismo && corte.documentos === d0 && resumen === 'Se registraron 3 movimientos.',
    `[Almacén 1280] 1f-conserva. tras el despliegue que conserva los ids, la planilla entra entera sin recargar la pantalla («${resumen}»; ${entraron.length} de 3, mismo documento ${mismo})`)
  // Al cerrar, el kardex se pone al día: aquí Next recarga, como dice el aviso de arriba.
  await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}), v.locator('button', { hasText: /^Cerrar$/ }).click()])
  await quieta(pagina)
  comprobar(!(await mismoDocumento(pagina)), `[Almacén 1280] 1f-conserva. al cerrar, la pantalla se vuelve a cargar con lo registrado`)
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Almacén 1280] 1f-conserva. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1q. «Atrás» con la planilla registrada (Almacén, sin despliegue)
// Las filas de la planilla no revalidaban (trigesimoprimera pasada), y Next
// solo olvida las pantallas del historial cuando una acción revalida: «Atrás»
// al stock, con la ventana todavía abierta, mostraba el saldo de antes (H-e1
// de la trigesimosegunda). Ahora revalidan, salvo en una pestaña de otro despliegue.
if (corre('1q')) {
  const codigo = `QA-ATRAS-${sello}`
  await materialPropio(codigo, `Perno del historial ${sello}`)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.almacen, { width: 1440, height: 900 })
  await ir(pagina, `${BASE}/almacen/kardex`)
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(await (await pagina.request.get(`${BASE}/almacen/kardex/planilla`)).body())
  const [a, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }).split('-').map(Number)
  const ingresos = libro.getWorksheet('Ingresos')
  ingresos.getCell(5, 1).value = new Date(Date.UTC(a, m - 1, d))
  ingresos.getCell(5, 3).value = codigo
  ingresos.getCell(5, 6).value = 3
  ingresos.getCell(5, 7).value = 'Ingreso general'
  ingresos.getCell(5, 8).value = `Planilla del historial ${sello}`
  const llena = join(archivos, `planilla-atras-${sello}.xlsx`)
  await libro.xlsx.writeFile(llena)
  await ir(pagina, `${BASE}/almacen/stock?q=${codigo}`)
  const fila = () => pagina.locator('main tr', { hasText: codigo }).first().innerText().then(limpio).catch(() => '')
  const antes = await fila()
  // Al kardex por el menú, como Almacén: el stock queda en el historial del navegador.
  await Promise.all([
    pagina.waitForURL((u) => u.pathname === '/almacen/kardex', { timeout: 30000 }),
    pagina.locator('aside').getByRole('link', { name: /^Kardex/ }).click(),
  ])
  await quieta(pagina)
  await pagina.getByRole('button', { name: /sin internet/i }).first().click()
  await pagina.getByRole('button', { name: /Cargar planilla/ }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor()
  await v.locator('#planilla-archivo').setInputFiles(llena)
  const boton = v.getByRole('button', { name: /^Registrar 1 movimiento/ })
  await boton.waitFor({ timeout: 30000 })
  await boton.click()
  const resumen = limpio(await hasta(() => pagina.evaluate(() => (document.activeElement?.getAttribute('role') === 'status' ? document.activeElement.textContent : '')), Boolean, 30000))
  const r0 = corte.rsc
  await Promise.all([pagina.waitForURL((u) => u.pathname === '/almacen/stock', { timeout: 30000 }), pagina.goBack()])
  await quieta(pagina)
  // La fila del stock, no la del kardex que sigue a la vista mientras vuelve.
  const delStock = (t) => Boolean(t) && t.startsWith(`Perno del historial ${sello} ${codigo} ·`)
  const alVolver = await hasta(fila, (t) => delStock(t) && t !== antes, 10000)
  const pidio = corte.rsc - r0
  await ir(pagina, `${BASE}/almacen/stock?q=${codigo}`)
  const recargada = await fila()
  comprobar(resumen === 'Se registró 1 movimiento.' && delStock(antes) && recargada !== antes && alVolver === recargada && pidio > 0,
    `[Almacén 1440] 1q. «Atrás» al stock con la ventana de la planilla abierta trae el saldo nuevo, como la pantalla recargada («${antes}» → «${alVolver}»; ${pidio} pedidos al volver)`)
  comprobar(errores.length === 0, `[Almacén 1440] 1q. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1o-conteo. El conteo inicial con la sesión vencida, en «nueva» (Almacén)
// La acción del conteo no revalida en «nueva», pero el proxy refrescaba la
// sesión dentro de ella y Next la respondía revalidada: el conteo entraba y la
// pantalla se recargaba, sin la ventana ni su resumen (X8 de la crítica).
if (corre('1o-conteo')) {
  const codigo = `QA-SESION-${sello}`
  const materialId = await materialPropio(codigo, `Trapo de la sesión vencida ${sello}`)
  const movimientos = async () => Number((await consulta(`select count(*) n from conteos_inventario where material_id = $1`, [materialId]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.almacen, undefined, { compilacion: true })
  await ir(pagina, `${BASE}/almacen/kardex`)
  const libro = new ExcelJS.Workbook()
  await libro.xlsx.load(await (await pagina.request.get(`${BASE}/almacen/kardex/conteo-inicial`)).body())
  const hoja = libro.getWorksheet('Conteo')
  let encabezado = 0
  hoja.eachRow((f, n) => {
    if (!encabezado && f.values.includes('Cantidad contada')) encabezado = n
  })
  for (let n = encabezado + 1; n <= hoja.rowCount; n++) {
    if (String(hoja.getCell(n, 1).value) === codigo) hoja.getCell(n, 5).value = Number(hoja.getCell(n, 4).value) + 1
    else hoja.getCell(n, 5).value = null
  }
  const lleno = join(archivos, `conteo-sesion-${sello}.xlsx`)
  await libro.xlsx.writeFile(lleno)
  await marcarDocumento(pagina)
  const d0 = corte.documentos
  corte.despliegue = true
  corte.conservaIds = true
  await salirYVolver(pagina)
  await hasta(() => pagina.locator('[data-pestana-vieja="nueva"]').count(), (n) => n === 1, 15000)
  await pagina.getByRole('button', { name: 'Conteo inicial' }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor()
  await v.locator('#conteo-inicial-archivo').setInputFiles(lleno)
  const boton = v.getByRole('button', { name: 'Registrar 1 material' })
  await boton.waitFor({ timeout: 30000 })
  const m0 = await movimientos()
  const s0 = corte.sesion
  await vencerLaSesion(contexto)
  await adelantarElReloj(pagina, 31_000)
  await boton.click()
  const resumen = limpio(await hasta(() => pagina.evaluate(() => (document.activeElement?.getAttribute('role') === 'status' ? document.activeElement.textContent : '')), Boolean, 30000))
  await pagina.waitForTimeout(2000)
  const mismo = await mismoDocumento(pagina)
  comprobar(mismo && corte.documentos === d0 && (await v.count()) === 1 && /^Se registró 1 material/.test(resumen) && (await movimientos()) === m0 + 1 && corte.sesion > s0,
    `[Almacén 1280] 1o. el conteo inicial con la sesión vencida, en «nueva», entra sin recargar: la ventana sigue con su resumen y la sesión se refrescó antes («${resumen}», ${corte.sesion - s0} pedidos a /auth/sesion, mismo documento ${mismo})`)
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Almacén 1280] 1o-conteo. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1g. La cotización con cliente nuevo (Ventas)
if (corre('1g')) {
  // Un RUC válido que nadie tiene: el cliente nuevo no llega a crearse.
  const [{ n: ruc }] = await consulta(`select n from (select '209' || lpad($1::text, 7, '0') || d as n from generate_series(0, 9) d) x
                                       where public.ruc_es_valido(n) and not exists (select 1 from clientes c where c.numero_documento = x.n) limit 1`, [sello])
  const numero = `QA-VIEJA-COT-${sello}`
  const razon = `Transportes de la pestaña vieja ${sello}`
  const clientes = async () => Number((await consulta(`select count(*) n from clientes where razon_social = $1`, [razon]))[0].n)
  const cotizaciones = async () => Number((await consulta(`select count(*) n from cotizaciones_pdf where numero = $1`, [numero]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.ventas)
  await ir(pagina, `${BASE}/cotizaciones/pdf`)
  await pagina.getByRole('button', { name: 'Subir cotización' }).first().click()
  const d = pagina.getByRole('dialog').first()
  await d.waitFor({ timeout: 20000 })
  await d.locator('#cot-archivo').setInputFiles({ name: `${numero}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`COTIZACION ${numero}`, 'Semirremolque de banco']) })
  const subir = d.getByRole('button', { name: 'Subir y mandar a Gerencia' })
  await pagina.waitForTimeout(1500)
  await hasta(async () => !/Leyendo/.test(await d.innerText()) && (await subir.isEnabled()), Boolean, 30000)
  await d.locator('#cot-numero').fill(numero)
  await d.locator('#cot-monto').fill('1000')
  await d.locator('#cot-moneda').selectOption('USD')
  await d.locator('#cot-igv').selectOption('no')
  if (!(await d.locator('#cot-razon').count())) await d.getByRole('button', { name: 'Es un cliente nuevo' }).click()
  await d.locator('#cot-tipo-doc').selectOption('RUC')
  await d.locator('#cot-num-doc').fill(ruc)
  await d.locator('#cot-razon').fill(razon)
  if (await d.locator('#cot-carroceria').count()) await d.locator('#cot-carroceria').selectOption({ index: 1 })
  const a0 = corte.acciones
  corte.despliegue = true
  for (const vez of [1, 2]) {
    await subir.click()
    await hasta(() => corte.acciones - a0, (n) => n >= vez, 20000)
    const dice = limpio(await hasta(() => d.getByRole('alert').allInnerTexts().then((t) => t.join(' ')), (t) => /actualizó|Vuelve a intentar/.test(t ?? ''), 20000))
    comprobar(dice.startsWith(SE_ACTUALIZO) && !/Vuelve a intentar/.test(dice),
      `[Ventas 1280] 1g. cotización con cliente nuevo desde la pestaña vieja, intento ${vez}: dice que hay que recargar, no «Vuelve a intentar» («${dice}»)`)
  }
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1g-cotizacion.png') })
  comprobar(corte.acciones - a0 === 2 && (await clientes()) === 0 && (await cotizaciones()) === 0,
    `[Ventas 1280] 1g. una llamada por intento, sin cliente ni cotización nuevos (${corte.acciones - a0} llamadas)`)
  corte.despliegue = false
  comprobar(errores.length === 0, `[Ventas 1280] 1g. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1h. El plano a dos áreas (Diseño)
if (corre('1h')) {
  // Un plano va en una etapa de su orden, como en probar-archivo-sin-dejarlo-suelto;
  // en la orden con plan propio la base pide quién lo elaboró.
  const [orden] = await consulta(`select o.id, e.id as etapa_id, o.plan_etapas_manual from ordenes_trabajo o join ot_etapas e on e.orden_id = o.id
                                  where o.estado not in ('BORRADOR', 'ENTREGADA', 'FACTURADA', 'ANULADA') order by o.numero limit 1`)
  const integrante = orden.plan_etapas_manual
    ? (await consulta(`insert into ot_equipo_diseno (orden_id, nombre, funcion) values ($1, 'QA banco Diseño', 'COLABORADOR')
                       on conflict (orden_id, lower(btrim(nombre))) do update set nombre = excluded.nombre returning id`, [orden.id]))[0].id
    : null
  const [plano] = await consulta(`insert into ot_planos (orden_id, numero_plano, nombre, etapa_id, integrante_diseno_id)
                                  values ($1, $2, 'Plano de la pestaña vieja', $3, $4) returning id`, [orden.id, `QA-VIEJA-PL-${sello}`, orden.etapa_id, integrante])
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.diseno])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'planos-privados' and o.name like $1 and o.created_at >= $2
        and not exists (select 1 from ot_plano_versiones v where v.ruta_storage = o.name)`, [`${yo}/%`, desde])).map((o) => o.name)
  const versiones = async () => Number((await consulta(`select count(*) n from ot_plano_versiones where plano_id = $1`, [plano.id]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno)
  await ir(pagina, `${BASE}/ordenes/${orden.id}/planos?plano=${plano.id}`)
  const archivo = pagina.locator(`#version-archivo-${plano.id}`)
  await archivo.waitFor({ state: 'attached', timeout: 30000 })
  const formulario = archivo.locator('xpath=ancestor::form')
  await formulario.getByLabel('Maestranza', { exact: true }).check()
  await formulario.getByLabel('Producción', { exact: true }).check()
  await archivo.setInputFiles({ name: `QA-VIEJA-PL-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`PLANO QA-VIEJA-PL-${sello}`]) })
  const a0 = corte.acciones
  const s0 = corte.storage.length
  corte.despliegue = true
  await formulario.getByRole('button', { name: 'Enviar a revisión' }).click()
  const dice = limpio(await hasta(() => formulario.locator('[role="alert"]').allInnerTexts().then((t) => t.join(' ')), (t) => /actualizó|Falta/.test(t ?? ''), 30000))
  await pagina.waitForTimeout(1500)
  const enStorage = corte.storage.slice(s0).filter((x) => x.includes('planos-privados'))
  const subidasPl = enStorage.filter((x) => x.startsWith('POST')).length
  const borrados = enStorage.filter((x) => x.startsWith('DELETE')).length
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1h-plano.png') })
  comprobar(dice === 'El sistema se actualizó mientras tenías la pantalla abierta. Copia lo escrito y vuelve a cargar la pantalla.',
    `[Diseño 1280] 1h. el plano a Maestranza y Producción desde la pestaña vieja dice solo que hay que recargar, sin «Vuelve a enviar sin cambiar el archivo» («${dice}»)`)
  comprobar(corte.acciones - a0 === 1 && subidasPl === 1 && borrados === 1 && (await versiones()) === 0 && (await hasta(sueltos, (l) => l.length === 0, 10000)).length === 0,
    `[Diseño 1280] 1h. una sola llamada, una subida y su borrado, ninguna versión y ningún PDF suelto (${corte.acciones - a0} llamada; Storage: ${enStorage.join(', ')})`)
  corte.despliegue = false
  comprobar(errores.length === 0, `[Diseño 1280] 1h. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1s. Lo que va por su cuenta, fuera de useAccion (Ventas, Diseño)
// «Volver a cargar» esperaba solo lo que iba por `useAccion`: con «Subir
// cotización» o el Excel del cronograma en camino recargaba en el acto, y el
// archivo quedaba subido sin anotar (D17 de la trigesimotercera pasada). Ahora
// espera a que vuelva y, cuando entra, recarga. Con la ventana cerrada en vuelo:
// abierta, tapa el aviso de arriba. La acción que anota se detiene antes de
// salir, como un envío lento.
if (corre('1s-cotizacion')) {
  const numero = `QA-ESPERA-COT-${sello}`
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.ventas])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'cotizaciones-pdf' and o.owner_id = $1 and o.created_at >= $2
        and not exists (select 1 from cotizaciones_pdf c where c.ruta_storage = o.name)`, [yo, desde])).map((o) => o.name)
  const cotizaciones = async () => Number((await consulta(`select count(*) n from cotizaciones_pdf where numero = $1`, [numero]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.ventas, { width: 1280, height: 900 }, { compilacion: true })
  await ir(pagina, `${BASE}/cotizaciones/pdf`)
  await hastaLaPestanaNueva(pagina, corte)
  await marcarDocumento(pagina)
  await pagina.getByRole('button', { name: 'Subir cotización' }).first().click()
  const d = pagina.getByRole('dialog').first()
  await d.waitFor({ timeout: 20000 })
  await d.locator('#cot-archivo').setInputFiles({ name: `${numero}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`COTIZACION ${numero}`, 'Semirremolque de banco']) })
  const subir = d.getByRole('button', { name: 'Subir y mandar a Gerencia' })
  await pagina.waitForTimeout(1500)
  await hasta(async () => !/Leyendo/.test(await d.innerText()) && (await subir.isEnabled()), Boolean, 30000)
  await d.locator('#cot-numero').fill(numero)
  await d.locator('#cot-monto').fill('1000')
  await d.locator('#cot-moneda').selectOption('USD')
  await d.locator('#cot-igv').selectOption('no')
  // Un cliente y una carrocería que ya están: crearlos sería otra acción, que en «nueva» recarga.
  if (await d.locator('#cot-cliente').count()) await d.locator('#cot-cliente').selectOption({ index: 1 })
  if (await d.locator('#cot-carroceria').count()) await d.locator('#cot-carroceria').selectOption({ index: 1 })
  corte.marca = numero
  await subir.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await d.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await botonDeArriba(pagina, 'Volver a cargar').click()
  await pagina.waitForTimeout(3000)
  const esperaba = await mismoDocumento(pagina)
  const enCamino = (await sueltos()).length
  await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}), corte.soltar()])
  await quieta(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1s-cotizacion.png') })
  comprobar(esperaba && enCamino === 1,
    `[Ventas 1280] 1s. con «Subir cotización» en camino y la ventana cerrada, «Volver a cargar» espera (mismo documento ${esperaba}, PDF subido y sin anotar todavía: ${enCamino})`)
  const quedan = await hasta(sueltos, (l) => l.length === 0, 10000)
  comprobar(!(await mismoDocumento(pagina)) && (await cotizaciones()) === 1 && quedan.length === 0,
    `[Ventas 1280] 1s. cuando entra, recarga: la cotización quedó y su PDF no queda suelto (${await cotizaciones()} cotización, ${quedan.length} sueltos)`)
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Ventas 1280] 1s-cotizacion. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

if (corre('1s-cronograma')) {
  // El cronograma es de las órdenes de antes del plan manual, como en
  // probar-documentos-al-elegir: en el banco, y solo aquí, la orden vuelve a
  // ser «de antes» con los disparadores apagados.
  const [orden] = await consulta(`select id, plan_etapas_manual from ordenes_trabajo
                                  where cotizacion_pdf_id is null and estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA', 'BORRADOR') order by numero limit 1`)
  if (orden.plan_etapas_manual) {
    await base.query('begin')
    await base.query(`set local session_replication_role = replica`)
    await base.query(`update ordenes_trabajo set plan_etapas_manual = false where id = $1`, [orden.id])
    await base.query('commit')
  }
  const nombre = `cronograma-espera-${sello}.xlsx`
  const actividad = `Espera del cronograma ${sello}`
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet('Cronograma')
  hoja.addRow(['Área', 'Actividad', 'Referencia', 'Peso (%)', 'Inicio', 'Fin'])
  hoja.addRow(['Acabados', actividad, null, 0, null, null])
  const excel = join(archivos, nombre)
  await libro.xlsx.writeFile(excel)
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.diseno])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'adjuntos-ot' and o.owner_id = $1 and o.created_at >= $2
        and not exists (select 1 from ot_adjuntos a where a.ruta_storage = o.name)`, [yo, desde])).map((o) => o.name)
  const anotados = async () => Number((await consulta(`select count(*) n from ot_adjuntos where orden_id = $1 and tipo = 'CRONOGRAMA' and nombre_archivo = $2`, [orden.id, nombre]))[0].n)
  const actividades = async () => Number((await consulta(`select count(*) n from ot_actividades where orden_id = $1 and nombre = $2`, [orden.id, actividad]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, { width: 1280, height: 900 }, { compilacion: true })
  await ir(pagina, `${BASE}/ordenes/${orden.id}?vista=actividades`)
  await hastaLaPestanaNueva(pagina, corte)
  await marcarDocumento(pagina)
  await pagina.getByRole('button', { name: 'Subir cronograma' }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor({ timeout: 20000 })
  await v.locator(`#cronograma-${orden.id}`).setInputFiles(excel)
  const cargar = v.getByRole('button', { name: 'Cargar 1 actividad' })
  await cargar.waitFor({ timeout: 15000 })
  // Se detiene la que anota el Excel: el cronograma ya entró y el Excel ya subió.
  corte.marca = nombre
  await cargar.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await v.getByRole('button', { name: 'Cerrar', exact: true }).click().catch(() => {})
  await botonDeArriba(pagina, 'Volver a cargar').click()
  await pagina.waitForTimeout(3000)
  const esperaba = await mismoDocumento(pagina)
  const enCamino = (await sueltos()).length
  await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}), corte.soltar()])
  await quieta(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1s-cronograma.png') })
  comprobar(esperaba && enCamino === 1,
    `[Diseño 1280] 1s. con el Excel del cronograma subido y sin anotar todavía, «Volver a cargar» espera (mismo documento ${esperaba}, sin anotar: ${enCamino})`)
  const quedan = await hasta(sueltos, (l) => l.length === 0, 10000)
  comprobar(!(await mismoDocumento(pagina)) && (await actividades()) === 1 && (await anotados()) === 1 && quedan.length === 0,
    `[Diseño 1280] 1s. cuando entra, recarga: la actividad y el Excel quedaron en la orden, y nada suelto (${await anotados()} Excel, ${quedan.length} sueltos)`)
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Diseño 1280] 1s-cronograma. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1s-reenvio. «No entró», y el reenvío corregido en camino (Ventas)
// La cotización con un número que ya existe, cerrada en vuelo: el rechazo se
// quedaba dentro de la ventana cerrada, y arriba se mandaba a leer «el aviso
// junto a su botón», que no estaba (A, H7 y R2 de la trigesimocuarta pasada).
// Ahora va junto al botón, y arriba se dice el motivo mismo: con el botón
// desmontado, mandar a leerlo no servía (D4 de la trigesimosexta).
// Después, la persona corrige y la sube otra vez: «Volver a cargar igual» se
// quedaba puesto, recargaba a los 160 ms con el reenvío en camino y dejaba su
// PDF suelto (F3 de la crítica).
if (corre('1s-reenvio')) {
  const [{ numero: usado }] = await consulta(`select numero from cotizaciones_pdf order by creado_en limit 1`)
  const numero = `QA-REENVIO-COT-${sello}`
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.ventas])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'cotizaciones-pdf' and o.owner_id = $1 and o.created_at >= $2
        and not exists (select 1 from cotizaciones_pdf c where c.ruta_storage = o.name)`, [yo, desde])).map((o) => o.name)
  const cotizaciones = async () => Number((await consulta(`select count(*) n from cotizaciones_pdf where numero = $1`, [numero]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.ventas, { width: 1280, height: 900 }, { compilacion: true })
  await ir(pagina, `${BASE}/cotizaciones/pdf`)
  await hastaLaPestanaNueva(pagina, corte)
  await marcarDocumento(pagina)
  const abrirla = pagina.getByRole('button', { name: 'Subir cotización' }).first()
  // Lo que dice cómo va está en el renglón de estado del encabezado, no al
  // lado: junto al botón lo corría de sitio (diseño H3 de la trigesimoquinta).
  const junto = pagina.locator('[data-estado-del-encabezado]')
  // Respecto del título: el aviso de arriba crece con su frase y baja la página
  // entera. Con la rueda el botón es 2 px más angosto: eso no es correrse.
  const titulo = pagina.locator('main h1').first()
  const donde = async () => {
    const [caja, h1] = [await abrirla.boundingBox(), await titulo.boundingBox()]
    return caja && h1 && { x: Math.round(caja.x + caja.width), y: Math.round(caja.y - h1.y) }
  }
  const quieto = (a, b) => a !== null && b !== null && Math.abs(a.x - b.x) <= 4 && a.y === b.y
  const dondeAntes = await donde()
  const llenar = async (n) => {
    await abrirla.click()
    const d = pagina.getByRole('dialog').first()
    await d.waitFor({ timeout: 20000 })
    await d.locator('#cot-archivo').setInputFiles({ name: `reenvio-${sello}-${n.length}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`COTIZACION ${n}`, 'Semirremolque de banco']) })
    const subir = d.getByRole('button', { name: 'Subir y mandar a Gerencia' })
    await pagina.waitForTimeout(1500)
    await hasta(async () => !/Leyendo/.test(await d.innerText()) && (await subir.isEnabled()), Boolean, 30000)
    await d.locator('#cot-numero').fill(n)
    await d.locator('#cot-monto').fill('1000')
    await d.locator('#cot-moneda').selectOption('USD')
    await d.locator('#cot-igv').selectOption('no')
    if (await d.locator('#cot-cliente').count()) await d.locator('#cot-cliente').selectOption({ index: 1 })
    if (await d.locator('#cot-carroceria').count()) await d.locator('#cot-carroceria').selectOption({ index: 1 })
    return { d, subir }
  }

  // A. El número repetido, con la ventana cerrada mientras va.
  let { d, subir } = await llenar(usado)
  corte.marca = usado
  await subir.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await d.getByRole('button', { name: 'Cerrar', exact: true }).click()
  const ocupadoEnVuelo = (await abrirla.getAttribute('aria-disabled')) === 'true'
  const sigue = await loQueDescribe(abrirla)
  const dondeEnVuelo = await donde()
  await botonDeArriba(pagina, 'Volver a cargar').click()
  await pagina.waitForTimeout(1000)
  corte.soltar()
  const conMotivo = (t) => t.startsWith('Lo que enviaste no entró, o no se sabe si entró: ') && t !== NO_ENTRO
  const porque = await hasta(() => sinRecargar(pagina), conMotivo, 20000)
  const alerta = limpio(await hasta(() => junto.locator('[role="alert"]').innerText().catch(() => ''), Boolean, 10000))
  const dondeConAlerta = await donde()
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1s-reenvio-rechazo.png') })
  comprobar(quieto(dondeAntes, dondeEnVuelo) && quieto(dondeAntes, dondeConAlerta),
    `[Ventas 1280] 1s-reenvio. «Subir cotización» no se mueve cuando aparece su estado (borde derecho y alto desde el título: antes ${JSON.stringify(dondeAntes)}, en vuelo ${JSON.stringify(dondeEnVuelo)}, con el rechazo ${JSON.stringify(dondeConAlerta)})`)
  comprobar(ocupadoEnVuelo && sigue === 'La cotización se sigue enviando: lo que conteste se dice aquí.',
    `[Ventas 1280] 1s-reenvio. cerrada en vuelo, «Subir cotización» gira y dice que sigue (ocupado ${ocupadoEnVuelo}, «${sigue}»)`)
  comprobar(conMotivo(porque) && porque.includes('Ya hay una cotización con el número') && alerta.startsWith('La cotización que se estaba enviando no se registró: Ya hay una cotización con el número') && (await mismoDocumento(pagina)),
    `[Ventas 1280] 1s-reenvio. arriba dice por qué no entró, y junto a su botón también: «${porque}» / «${alerta}»`)
  comprobar((await hasta(sueltos, (l) => l.length === 0, 10000)).length === 0,
    `[Ventas 1280] 1s-reenvio. el PDF del rechazo no queda suelto`)

  // B. Reabrir no lo borra; el reenvío corregido, otra vez cerrado en vuelo.
  ;({ d, subir } = await llenar(numero))
  const sigueAlReabrir = await junto.locator('[role="alert"]').count()
  corte.marca = numero
  await subir.click()
  await hasta(() => corte.retenidas, (n) => n > 1, 30000)
  await d.getByRole('button', { name: 'Cerrar', exact: true }).click()
  const boton = pagina.locator('[data-pestana-vieja]').getByRole('button').first()
  const dice = limpio(await boton.innerText())
  const porqueAhora = await sinRecargar(pagina)
  await boton.click()
  await pagina.waitForTimeout(3000)
  const esperaba = await mismoDocumento(pagina)
  const enCamino = (await sueltos()).length
  await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}), corte.soltar()])
  await quieta(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1s-reenvio.png') })
  comprobar(sigueAlReabrir === 1, `[Ventas 1280] 1s-reenvio. reabrir la ventana no borra el motivo (${sigueAlReabrir} aviso junto al botón)`)
  comprobar(dice === 'Volver a cargar' && porqueAhora === '',
    `[Ventas 1280] 1s-reenvio. con el reenvío en camino, el aviso de arriba ya no dice «no entró» y el botón vuelve a esperar («${dice}», «${porqueAhora}»)`)
  comprobar(esperaba && enCamino === 1,
    `[Ventas 1280] 1s-reenvio. el toque espera el reenvío (mismo documento ${esperaba}, PDF subido y sin anotar todavía: ${enCamino})`)
  const quedan = await hasta(sueltos, (l) => l.length === 0, 10000)
  comprobar(!(await mismoDocumento(pagina)) && (await cotizaciones()) === 1 && quedan.length === 0,
    `[Ventas 1280] 1s-reenvio. cuando entra, recarga: la cotización quedó y nada suelto (${await cotizaciones()} cotización, ${quedan.length} sueltos)`)
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Ventas 1280] 1s-reenvio. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1s-cronograma-sin-respuesta. Cerrada en vuelo, la respuesta no llega (Diseño, a 390)
// El mismo hallazgo en otra de las cuatro cadenas: sin respuesta, lo que dice
// cómo terminó estaba dentro de la ventana cerrada. Ahora va en el renglón de
// la tarjeta, bajo «Subir cronograma», sin «no se registró»: pudo entrar.
if (corre('1s-cronograma-sin-respuesta')) {
  const [orden] = await consulta(`select id, plan_etapas_manual from ordenes_trabajo
                                  where cotizacion_pdf_id is null and estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA', 'BORRADOR') order by numero desc limit 1`)
  if (orden.plan_etapas_manual) {
    await base.query('begin')
    await base.query(`set local session_replication_role = replica`)
    await base.query(`update ordenes_trabajo set plan_etapas_manual = false where id = $1`, [orden.id])
    await base.query('commit')
  }
  const actividad = `Sin respuesta del cronograma ${sello}`
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet('Cronograma')
  hoja.addRow(['Área', 'Actividad', 'Referencia', 'Peso (%)', 'Inicio', 'Fin'])
  hoja.addRow(['Acabados', actividad, null, 0, null, null])
  const excel = join(archivos, `cronograma-sin-respuesta-${sello}.xlsx`)
  await libro.xlsx.writeFile(excel)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, CELULAR, { compilacion: true })
  await ir(pagina, `${BASE}/ordenes/${orden.id}?vista=actividades`)
  const abrirla = pagina.getByRole('button', { name: 'Subir cronograma' })
  const junto = pagina.locator(`#estado-del-cronograma-${orden.id}`).locator('xpath=..')
  await abrirla.click()
  const v = pagina.getByRole('dialog')
  await v.waitFor({ timeout: 20000 })
  await v.locator(`#cronograma-${orden.id}`).setInputFiles(excel)
  const cargar = v.getByRole('button', { name: 'Cargar 1 actividad' })
  await cargar.waitFor({ timeout: 15000 })
  await v.getByRole('checkbox').uncheck().catch(() => {})
  corte.marca = actividad
  corte.perder = actividad
  await cargar.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await v.getByRole('button', { name: 'Cerrar', exact: true }).click()
  const ocupadoEnVuelo = (await abrirla.getAttribute('aria-disabled')) === 'true'
  const sigue = await loQueDescribe(abrirla)
  corte.soltar()
  const alerta = limpio(await hasta(() => junto.locator('[role="alert"]').innerText().catch(() => ''), Boolean, 20000))
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1s-cronograma-sin-respuesta-390.png') })
  comprobar(ocupadoEnVuelo && sigue === 'El cronograma se sigue enviando: lo que conteste se dice aquí.',
    `[Diseño 390] 1s-cronograma-sin-respuesta. cerrada en vuelo, «Subir cronograma» gira y dice que sigue (ocupado ${ocupadoEnVuelo}, «${sigue}»)`)
  comprobar(corte.perdidas === 1 && alerta.startsWith('El cronograma que se estaba enviando: No llegó la respuesta'),
    `[Diseño 390] 1s-cronograma-sin-respuesta. sin respuesta, el renglón de su tarjeta dice que no se sabe si quedó, sin «no se registró»: «${alerta}»`)
  comprobar((await abrirla.getAttribute('aria-disabled')) !== 'true',
    `[Diseño 390] 1s-cronograma-sin-respuesta. ya contestó: el botón vuelve a abrir la ventana`)
  // El envío siguiente, con la ventana abierta y la respuesta a tiempo: el motivo de antes se va.
  hoja.getRow(2).getCell(2).value = `${actividad} otra vez`
  await libro.xlsx.writeFile(excel)
  await abrirla.click()
  await v.waitFor({ timeout: 20000 })
  const sigueAlReabrir = await junto.locator('[role="alert"]').count()
  await v.locator(`#cronograma-${orden.id}`).setInputFiles(excel)
  await cargar.waitFor({ timeout: 15000 })
  await v.getByRole('checkbox').uncheck().catch(() => {})
  await cargar.click()
  const verde = limpio(await hasta(() => junto.locator('[role="status"]').allInnerTexts().then((l) => l.join(' ')), (t) => /Cronograma cargado|actividad/i.test(t), 30000))
  const alertaDespues = await junto.locator('[role="alert"]').count()
  comprobar(sigueAlReabrir === 1 && alertaDespues === 0 && verde !== '',
    `[Diseño 390] 1s-cronograma-sin-respuesta. reabrir no borra el motivo; el envío siguiente, al entrar, sí (al reabrir ${sigueAlReabrir}, después ${alertaDespues}; «${verde}»)`)
  comprobar(errores.length === 0, `[Diseño 390] 1s-cronograma-sin-respuesta. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1s-orden-pdf. El PDF de la orden, que sube al elegirlo (Administración)
// Iba fuera de `mientrasSeEnvia`: «Volver a cargar» recargaba a los 180 ms, y
// el PDF quedaba cortado o subido sin anotar (C, H5 y R1 de la trigesimocuarta).
// Ahora espera a que quede anotado. Se detiene la acción que lo anota.
if (corre('1s-orden-pdf')) {
  const [ot] = await consulta(
    `select o.id, o.numero from ordenes_trabajo o
     where o.cotizacion_pdf_id is null and o.estado <> 'ANULADA'
       and not exists (select 1 from ot_adjuntos a where a.orden_id = o.id and a.tipo = 'ORDEN') order by o.numero desc limit 1`,
  )
  const nombre = `orden-espera-${sello}.pdf`
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.administracion])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'adjuntos-ot' and o.owner_id = $1 and o.created_at >= $2
        and not exists (select 1 from ot_adjuntos a where a.ruta_storage = o.name)`, [yo, desde])).map((o) => o.name)
  const anotados = async () => Number((await consulta(`select count(*) n from ot_adjuntos where orden_id = $1 and tipo = 'ORDEN' and nombre_archivo = $2`, [ot?.id, nombre]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 }, { compilacion: true })
  await ir(pagina, `${BASE}/ordenes/${ot?.id}`)
  const campo = pagina.locator(`input[type="file"]#subir-pdf-${ot?.id}, #subir-pdf-${ot?.id} input[type="file"]`).first()
  if (!ot || (await campo.count()) === 0) {
    comprobar(false, `[Administración 1280] 1s-orden-pdf. hay una orden sin PDF que ofrezca «Subir el PDF de la orden» (${ot?.numero ?? 'ninguna'})`)
  } else {
    await hastaLaPestanaNueva(pagina, corte)
    await marcarDocumento(pagina)
    corte.marca = nombre
    await campo.setInputFiles({ name: nombre, mimeType: 'application/pdf', buffer: pdfConTexto([`Orden ${ot.numero}`, `Espera ${sello}`]) })
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await botonDeArriba(pagina, 'Volver a cargar').click()
    await pagina.waitForTimeout(3000)
    const esperaba = await mismoDocumento(pagina)
    const enCamino = (await sueltos()).length
    await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}), corte.soltar()])
    await quieta(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1s-orden-pdf.png') })
    comprobar(esperaba && enCamino === 1,
      `[Administración 1280] 1s-orden-pdf. con el PDF de la orden subido y sin anotar todavía, «Volver a cargar» espera (mismo documento ${esperaba}, sin anotar: ${enCamino})`)
    const quedan = await hasta(sueltos, (l) => l.length === 0, 10000)
    comprobar(!(await mismoDocumento(pagina)) && (await anotados()) === 1 && quedan.length === 0,
      `[Administración 1280] 1s-orden-pdf. cuando queda anotado, recarga: la orden tiene su PDF y nada suelto (${await anotados()} anotado, ${quedan.length} sueltos)`)
  }
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Administración 1280] 1s-orden-pdf. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1t-cronograma. «Cancelar» en vuelo, y «Nueva tarea» se lleva el botón (Diseño)
// «Cancelar» cerraba la ventana del cronograma sin decirle al envío que iba
// sin ella: el botón no giraba y el rechazo no se decía (realización H1 de la
// trigesimoquinta pasada). Y «Nueva tarea» desmonta «Subir cronograma»: el
// envío en camino y su desenlace se iban con él (diseño H1). Ahora lo del
// envío vive con la orden, no con el botón: al volver, gira si sigue.
//
// Lo que dice va en su renglón, arriba del cuerpo de la tarjeta: junto al
// botón lo corría 346 px y lo bajaba de línea (D3 de la trigesimosexta), y con
// «Nueva tarea» abierta no se veía (D4). El Excel pasa de 100 % en Acabados:
// la pantalla lo marca en rojo y deja cargar, y la base lo rechaza.
if (corre('1t-cronograma')) {
  const orden = await ordenParaElCronograma()
  const actividad = `Pasa de cien ${sello}`
  const excel = await cronogramaQuePasaDeCien(actividad, `cronograma-pasa-de-cien-${sello}.xlsx`)
  const actividades = async () => Number((await consulta(`select count(*) n from ot_actividades where orden_id = $1 and nombre like $2`, [orden.id, `${actividad}%`]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/ordenes/${orden.id}?vista=actividades`)
  const abrirla = pagina.getByRole('button', { name: 'Subir cronograma' })
  const renglon = pagina.locator(`#estado-del-cronograma-${orden.id}`).locator('xpath=..')
  const nuevaTarea = pagina.getByRole('button', { name: 'Nueva tarea', exact: true })
  const cancelarTarea = pagina.locator('form').filter({ has: pagina.getByRole('button', { name: 'Agregar a la lista' }) }).getByRole('button', { name: 'Cancelar', exact: true })
  // Respecto del título de la pantalla; con la rueda el botón cambia 2 px de ancho.
  const titulo = pagina.locator('main h1').first()
  const donde = async () => {
    const [caja, h1] = [await abrirla.boundingBox(), await titulo.boundingBox()]
    return caja && h1 && { x: Math.round(caja.x), derecha: Math.round(caja.x + caja.width), y: Math.round(caja.y - h1.y) }
  }
  const quieto = (a, b) => Boolean(a && b) && (Math.abs(a.x - b.x) <= 4 || Math.abs(a.derecha - b.derecha) <= 4) && a.y === b.y
  const dondeAntes = await donde()
  await abrirla.click()
  const v = pagina.getByRole('dialog')
  await v.waitFor({ timeout: 20000 })
  await v.locator(`#cronograma-${orden.id}`).setInputFiles(excel)
  const cargar = v.getByRole('button', { name: 'Cargar 2 actividades' })
  await cargar.waitFor({ timeout: 15000 })
  await v.getByRole('checkbox').uncheck().catch(() => {})
  corte.marca = actividad
  await cargar.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  // «Cancelar», no la X: es el que no avisaba.
  await v.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await hasta(() => v.count(), (n) => n === 0, 5000)
  const ocupadoAlCancelar = (await abrirla.getAttribute('aria-disabled')) === 'true'
  const sigueAlCancelar = await loQueDescribe(abrirla)
  const dondeEnVuelo = await donde()
  // «Nueva tarea» se lleva «Subir cronograma»; su «Cancelar» lo devuelve.
  await nuevaTarea.click()
  await cancelarTarea.waitFor({ timeout: 10000 })
  const sinBoton = (await abrirla.count()) === 0
  const sigueSinBoton = limpio(await renglon.innerText().catch(() => ''))
  await cancelarTarea.click()
  await abrirla.waitFor({ timeout: 10000 })
  const ocupadoAlVolver = (await abrirla.getAttribute('aria-disabled')) === 'true'
  const sigueAlVolver = await loQueDescribe(abrirla)
  // Otra vez «Nueva tarea», y el rechazo llega con el botón fuera.
  await nuevaTarea.click()
  await cancelarTarea.waitFor({ timeout: 10000 })
  corte.soltar()
  const alertaSinBoton = limpio(await hasta(() => renglon.locator('[role="alert"]').innerText().catch(() => ''), Boolean, 20000))
  const visibleSinBoton = await renglon.locator('[role="alert"]').isVisible().catch(() => false)
  const botonSinBoton = await abrirla.count()
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1t-cronograma-nueva-tarea.png') })
  await cancelarTarea.click()
  await abrirla.waitFor({ timeout: 10000 })
  const alerta = limpio(await renglon.locator('[role="alert"]').innerText().catch(() => ''))
  const dondeConAlerta = await donde()
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1t-cronograma.png') })
  const SIGUE = 'El cronograma se sigue enviando: lo que conteste se dice aquí.'
  comprobar(ocupadoAlCancelar && sigueAlCancelar === SIGUE,
    `[Diseño 1280] 1t-cronograma. «Cancelar» en vuelo: «Subir cronograma» gira y dice que sigue (ocupado ${ocupadoAlCancelar}, «${sigueAlCancelar}»)`)
  comprobar(sinBoton && sigueSinBoton.includes(SIGUE),
    `[Diseño 1280] 1t-cronograma. con «Nueva tarea» abierta el botón no está, y el renglón de la tarjeta dice que sigue (se fue ${sinBoton}, «${sigueSinBoton}»)`)
  comprobar(ocupadoAlVolver && sigueAlVolver === SIGUE,
    `[Diseño 1280] 1t-cronograma. tras «Nueva tarea» y su «Cancelar», el botón vuelve girando y dice que sigue (ocupado ${ocupadoAlVolver}, «${sigueAlVolver}»)`)
  comprobar(botonSinBoton === 0 && visibleSinBoton && alertaSinBoton.startsWith('El cronograma que se estaba enviando no se registró: ') && alertaSinBoton.includes('suman'),
    `[Diseño 1280] 1t-cronograma. el rechazo que llega con «Nueva tarea» abierta se ve en el renglón, sin el botón: «${alertaSinBoton}»`)
  comprobar(alerta === alertaSinBoton && (await actividades()) === 0,
    `[Diseño 1280] 1t-cronograma. al volver el botón, el rechazo sigue dicho, y no entró nada (${await actividades()} actividades)`)
  comprobar(quieto(dondeAntes, dondeEnVuelo) && quieto(dondeAntes, dondeConAlerta),
    `[Diseño 1280] 1t-cronograma. «Subir cronograma» no se mueve cuando aparece lo que dice (antes ${JSON.stringify(dondeAntes)}, en vuelo ${JSON.stringify(dondeEnVuelo)}, con el rechazo ${JSON.stringify(dondeConAlerta)})`)
  // Con el desenlace ya a la vista, «Nueva tarea» y «Cancelar» no lo borran.
  await nuevaTarea.click()
  await cancelarTarea.waitFor({ timeout: 10000 })
  await cancelarTarea.click()
  await abrirla.waitFor({ timeout: 10000 })
  const alertaDespues = limpio(await renglon.locator('[role="alert"]').innerText().catch(() => ''))
  comprobar(alertaDespues !== '' && alertaDespues === alerta, `[Diseño 1280] 1t-cronograma. «Nueva tarea» y «Cancelar» no borran el rechazo ya dicho («${alertaDespues}»)`)
  comprobar(errores.length === 0, `[Diseño 1280] 1t-cronograma. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1t-correccion. La corrección cerrada en vuelo que entra (Ventas)
// «Lo que conteste se dice aquí», y cuando entraba no se decía nada: la
// tarjeta cambiaba callada (diseño H2 y funcionalidad H4 de la trigesimoquinta).
// «Cancelar» quedaba trabado con lo demás mientras se enviaba (D2 de la
// trigesimosexta), y el verde «Gerencia revisa esta versión» seguía junto a la
// cotización que Gerencia ya había rechazado (D1).
if (corre('1t-correccion')) {
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.ventas])
  const [cot] = await consulta(`select id, numero, version from cotizaciones_pdf where registrado_por = $1 and estado = 'POR_REVISAR' order by creado_en desc limit 1`, [yo])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'cotizaciones-pdf' and o.owner_id = $1 and o.created_at >= $2
        and not exists (select 1 from cotizaciones_pdf c where c.ruta_storage = o.name)
        and not exists (select 1 from cotizaciones_pdf_versiones v where v.ruta_storage = o.name)`, [yo, desde])).map((o) => o.name)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.ventas, { width: 1280, height: 900 })
  if (!cot) {
    comprobar(false, '[Ventas 1280] 1t-correccion. hay una cotización de Ventas por revisar para corregir')
  } else {
    await ir(pagina, `${BASE}/cotizaciones/pdf`)
    const abrirla = pagina.locator(`li[id="${cot.id}"]`).getByRole('button', { name: /Editar cotización|Subir corrección/ })
    const junto = abrirla.locator('xpath=..')
    await abrirla.click()
    const e = pagina.getByRole('dialog').first()
    await e.waitFor({ timeout: 20000 })
    const motivo = `Corrección en vuelo ${sello}`
    await e.locator(`#corregir-motivo-${cot.id}`).fill(motivo)
    await e.locator(`#corregir-archivo-${cot.id}`).setInputFiles({ name: `${cot.numero}-en-vuelo.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`COTIZACION ${cot.numero}`, `En vuelo ${sello}`]) })
    const guardar = e.getByRole('button', { name: 'Guardar versión y enviar a Gerencia' })
    await pagina.waitForTimeout(1500)
    await hasta(async () => !/Leyendo/.test(await e.innerText()) && (await guardar.isEnabled()), Boolean, 30000)
    await e.locator('#corregir-monto').fill('1200')
    await e.locator('#corregir-moneda').selectOption('USD')
    await e.locator('#corregir-igv').selectOption('no')
    corte.marca = motivo
    await guardar.click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    const cancelar = e.getByRole('button', { name: 'Cancelar', exact: true })
    const cancelarSeUsa = await cancelar.isEnabled()
    if (cancelarSeUsa) await cancelar.click()
    else await e.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    comprobar(cancelarSeUsa, `[Ventas 1280] 1t-correccion. mientras se envía, «Cancelar» cierra como la X: no queda trabado con lo demás`)
    const ocupado = (await abrirla.getAttribute('aria-disabled')) === 'true'
    const sigue = await loQueDescribe(abrirla)
    corte.soltar()
    const verde = limpio(await hasta(() => junto.locator('[role="status"]').allInnerTexts().then((l) => l.join(' ')), (t) => t.includes('quedó guardada'), 20000))
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1t-correccion.png') })
    const [ahora] = await consulta(`select version from cotizaciones_pdf where id = $1`, [cot.id])
    comprobar(ocupado && sigue === 'La corrección se sigue enviando: lo que conteste se dice aquí.',
      `[Ventas 1280] 1t-correccion. cerrada en vuelo, el botón gira y dice que sigue (ocupado ${ocupado}, «${sigue}»)`)
    comprobar(verde === 'La corrección que se estaba enviando quedó guardada: Gerencia revisa esta versión.' && (await junto.locator('[role="alert"]').count()) === 0 && ahora.version === cot.version + 1,
      `[Ventas 1280] 1t-correccion. cuando entra, lo dice en verde junto al botón, sin alerta («${verde}», versión ${cot.version} → ${ahora.version})`)
    comprobar((await hasta(sueltos, (l) => l.length === 0, 10000)).length === 0, `[Ventas 1280] 1t-correccion. nada suelto`)
    // Gerencia la rechaza, con su cuenta y su permiso; Ventas va a «Rechazadas».
    let filas = 0
    await comoLaCuenta(CUENTAS.gerencia, async () => {
      filas = (await base.query(`update cotizaciones_pdf set estado = 'RECHAZADA', observacion = $2 where id = $1`, [cot.id, `Rechazada en el banco ${sello}`])).rowCount
    })
    await marcarDocumento(pagina)
    await pagina.getByRole('link', { name: /^Rechazadas/ }).first().click()
    await pagina.waitForURL((u) => u.searchParams.get('estado') === 'RECHAZADA', { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    const tarjeta = pagina.locator(`li[id="${cot.id}"]`)
    await tarjeta.waitFor({ timeout: 15000 }).catch(() => {})
    const dice = limpio(await tarjeta.innerText().catch(() => ''))
    const estadoAhora = limpio(await junto.locator('[role="status"]').allInnerTexts().then((l) => l.join(' ')).catch(() => ''))
    const nombre = limpio(await abrirla.innerText().catch(() => ''))
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1t-correccion-rechazada.png') })
    comprobar(filas === 1 && dice.includes('Rechazada') && nombre === 'Subir corrección' && (await mismoDocumento(pagina)) && !estadoAhora.includes('quedó guardada'),
      `[Ventas 1280] 1t-correccion. ya rechazada por Gerencia, junto a «${nombre}» no sigue diciendo que Gerencia la revisa (${filas} fila, «${estadoAhora}»)`)
  }
  comprobar(errores.length === 0, `[Ventas 1280] 1t-correccion. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1t-dos-tarjetas. «Dar código y cargar la OT» de una, con la otra en su ventana (Administración)
// La que entraba recargaba la pantalla para ir a su tarjeta: la ventana de la
// otra cotización se cerraba con lo escrito, y si ya iba, su OT no entraba y
// su PDF quedaba suelto (X1 de la crítica de la trigesimoquinta). Esperar a
// que no quedara nada abierto dejaba la ida armada, y salía minutos después
// desde otra pantalla (Y1 de la trigesimosexta): ahora va en el acto, sin
// recargar, o no va, y el encabezado dice que entró con el camino a su tarjeta.
/**
 * Las `n` cotizaciones aprobadas sin OT más nuevas. Cada corrida les carga OT a
 * algunas: si el banco ya no tiene tantas, se siembran copiando una aprobada,
 * con los disparadores apagados. Lo que se prueba aquí es la OT; la aprobación
 * la prueba probar-gerencia-aprueba-y-administracion-carga-la-ot por su pantalla.
 */
let sembradas = 0
async function aprobadasSinOt(n) {
  const hay = () =>
    consulta(`select c.id, c.numero from cotizaciones_pdf c where c.estado = 'APROBADA'
                and not exists (select 1 from ordenes_trabajo o where o.cotizacion_pdf_id = c.id) order by c.creado_en desc limit $1`, [n])
  const ya = await hay()
  const [modelo] = await consulta(`select id from cotizaciones_pdf where estado = 'APROBADA' order by creado_en limit 1`)
  if (ya.length >= n || !modelo) return ya
  await consulta('begin')
  try {
    await consulta('set local session_replication_role = replica')
    for (let i = ya.length; i < n; i++) {
      // La ruta va dentro de la carpeta de su id (ck_cotizacion_pdf_ruta).
      await consulta(`with nueva as (select gen_random_uuid() id)
                      insert into cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, estado, revisado_por, revisado_en, nombre_archivo, ruta_storage, mime_type, tamano_bytes, registrado_por, monto_venta, moneda)
                      select nueva.id, $2, c.cliente_id, c.tipo_carroceria_id, 'APROBADA', c.revisado_por, now(), c.nombre_archivo, 'cot/' || nueva.id || '/sembrada.pdf', c.mime_type, c.tamano_bytes, c.registrado_por, c.monto_venta, c.moneda
                      from cotizaciones_pdf c, nueva where c.id = $1`, [modelo.id, `QA-SEMBRADA-${sello}-${sembradas++}`])
    }
    await consulta('commit')
  } catch (e) {
    await consulta('rollback')
    throw e
  }
  return hay()
}
const anioDeLima = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric' }).format(new Date())
const numerosLibres = async (n) =>
  (await consulta(`select n from generate_series(9100, 9999) n
                   where not exists (select 1 from ordenes_trabajo o where o.numero = n || '-' || $1) order by n desc limit $2`, [anioDeLima(), n])).map((x) => x.n)
const otDe = async (id) => Number((await consulta(`select count(*) n from ordenes_trabajo where cotizacion_pdf_id = $1`, [id]))[0].n)
/** Abre «Dar código y cargar la OT» de la tarjeta `id` y la deja lista para guardar. */
async function llenarLaOt(pagina, id, codigo, n) {
  const anio = anioDeLima()
  const boton = pagina.locator(`li[id="${id}"]`).getByRole('button', { name: 'Dar código y cargar la OT' })
  await boton.scrollIntoViewIfNeeded().catch(() => {})
  await boton.click()
  const d = pagina.getByRole('dialog').first()
  await d.waitFor({ timeout: 20000 })
  await d.locator('#eo-codigo-interno').fill(codigo)
  await d.locator(`#aprobar-pdf-${id}`).setInputFiles({ name: `OT-${n}.pdf`, mimeType: 'application/pdf',
    buffer: pdfConTexto([`ORDEN DE TRABAJO N ${n}-${anio}`, `FECHA DE ENTREGA: 15/12/${anio}`]) })
  const guardar = d.getByRole('button', { name: 'Guardar código y OT' })
  await pagina.waitForTimeout(1500)
  await hasta(async () => !/Leyendo/.test(await d.innerText()) && (await guardar.isEnabled()), Boolean, 30000)
  await d.locator('#eo-numero').fill(String(n))
  await d.locator('#eo-fecha').fill(`${anio}-12-15`)
  await d.locator('#eo-tipo').selectOption('SEMIRREMOLQUE')
  return { d, guardar }
}
/**
 * Desde la tarjeta `id`, ya en /cotizaciones/pdf#id: al menú de Órdenes, y
 * «Atrás» vuelve a Cotización en un paso; «Adelante» va a Órdenes y otro
 * «Atrás» vuelve. Ir al ancla dejaba la entrada sin el estado de Next: la
 * dirección cambiaba y la pantalla no (H1 de los tres auditores, trigesimoséptima).
 */
async function atrasDesdeLaTarjeta(pagina, id) {
  const titulo = () => pagina.locator('main h1').first().innerText().then(limpio).catch(() => '')
  const conEstado = await pagina.evaluate(() => window.history.state?.__NA === true)
  await porElMenu(pagina, '/ordenes')
  const pasos = []
  for (const [mover, camino, h1] of [['back', `/cotizaciones/pdf#${id}`, 'Cotización'], ['forward', '/ordenes', 'Órdenes de trabajo'], ['back', `/cotizaciones/pdf#${id}`, 'Cotización']]) {
    await pagina.evaluate((m) => window.history[m](), mover)
    const visto = await hasta(titulo, (t) => t === h1, 10000)
    const donde = pagina.url().replace(BASE, '')
    pasos.push({ donde, visto, bien: donde === camino && visto === h1 })
  }
  const quieto = await mismoDocumento(pagina)
  return {
    bien: conEstado && quieto && pasos.every((p) => p.bien),
    detalle: `estado de Next en la entrada ${conEstado}, ${pasos.map((p) => `${p.donde} «${p.visto}»`).join(' → ')}, mismo documento ${quieto}`,
  }
}
/** Lo que Administración subió desde `desde` y ninguna fila de la orden nombra. */
const sueltosDeLaOt = async (desde) =>
  (await consulta(`select o.name from storage.objects o where o.bucket_id = 'adjuntos-ot' and o.owner_id = (select id::text from usuarios where correo = $1) and o.created_at >= $2
      and not exists (select 1 from ot_adjuntos a where a.ruta_storage = o.name)`, [CUENTAS.administracion, desde])).map((o) => o.name)

if (corre('1t-dos-tarjetas')) {
  const dos = await aprobadasSinOt(2)
  const libres = await numerosLibres(2)
  const [{ t: desde }] = await consulta(`select now() as t`)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  if (dos.length < 2 || libres.length < 2) {
    comprobar(false, `[Administración 1280] 1t-dos-tarjetas. hay dos cotizaciones aprobadas sin OT (${dos.length}) y dos números libres`)
  } else {
    const [a, b] = dos
    const encabezado = pagina.locator('[data-estado-del-encabezado]')
    const LINEA_A = `Se cargó el código y la OT de la cotización ${a.numero}.`
    await ir(pagina, `${BASE}/cotizaciones/pdf?estado=APROBADA_SIN_OT`)
    await marcarDocumento(pagina)
    // A: va, y la ventana se cierra en vuelo con «Cancelar».
    const codigoA = `QA_X1A_${sello}/26`
    const ventanaA = await llenarLaOt(pagina, a.id, codigoA, libres[0])
    corte.marca = `QA_X1A_${sello}`
    await ventanaA.guardar.click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    const cancelar = ventanaA.d.getByRole('button', { name: 'Cancelar', exact: true })
    const cancelarSeUsa = await cancelar.isEnabled()
    if (cancelarSeUsa) await cancelar.click()
    else await ventanaA.d.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    comprobar(cancelarSeUsa, `[Administración 1280] 1t-dos-tarjetas. mientras se envía, «Cancelar» cierra como la X`)
    // B: su ventana abierta y escrita mientras A vuelve.
    const codigoB = `QA_X1B_${sello}/26`
    const ventanaB = await llenarLaOt(pagina, b.id, codigoB, libres[1])
    corte.soltar()
    await hasta(() => otDe(a.id), (n) => n === 1, 20000)
    const linea = limpio(await hasta(() => encabezado.innerText(), (t) => limpio(t).includes(LINEA_A), 15000))
    await pagina.waitForTimeout(2000)
    const quieto = await mismoDocumento(pagina)
    const dondeA = pagina.url().replace(BASE, '')
    const escrito = await ventanaB.d.locator('#eo-codigo-interno').inputValue().catch(() => '')
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1t-dos-tarjetas-b-abierta.png') })
    comprobar((await otDe(a.id)) === 1 && quieto && dondeA === '/cotizaciones/pdf?estado=APROBADA_SIN_OT' && escrito === codigoB,
      `[Administración 1280] 1t-dos-tarjetas. A entra con la ventana de B abierta: no se recarga ni se va (OT de A ${await otDe(a.id)}, mismo documento ${quieto}, ${dondeA}, B dice «${escrito}»)`)
    comprobar(linea.includes(LINEA_A) && (await encabezado.getByRole('button', { name: 'Ver su tarjeta' }).count()) === 1,
      `[Administración 1280] 1t-dos-tarjetas. el encabezado dice que se cargó la OT de A, con «Ver su tarjeta» («${linea}»)`)
    // B entra con su ventana abierta: va a su tarjeta, resaltada, sin recargar.
    if (quieto && escrito === codigoB) {
      await ventanaB.guardar.click()
      await hasta(() => otDe(b.id), (n) => n === 1, 30000)
      await pagina.waitForURL((u) => u.pathname === '/cotizaciones/pdf' && u.search === '' && u.hash === `#${b.id}`, { timeout: 20000 }).catch(() => {})
      const marcadaB = await hasta(() => resaltada(pagina), (id) => id === b.id, 15000)
      const dondeB = pagina.url().replace(BASE, '')
      await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1t-dos-tarjetas-b.png') })
      comprobar((await otDe(b.id)) === 1 && marcadaB === b.id && dondeB === `/cotizaciones/pdf#${b.id}` && (await mismoDocumento(pagina)),
        `[Administración 1280] 1t-dos-tarjetas. B entra con su ventana abierta y va a su tarjeta, resaltada, sin recargar (resaltada ${marcadaB === b.id ? 'B' : marcadaB}, ${dondeB})`)
      // «Ver su tarjeta» lleva a la de A, y la línea se va.
      await encabezado.getByRole('button', { name: 'Ver su tarjeta' }).click().catch(() => {})
      const marcadaA = await hasta(() => resaltada(pagina), (id) => id === a.id, 15000)
      const dondeVer = pagina.url().replace(BASE, '')
      const lineaDespues = limpio(await encabezado.innerText().catch(() => ''))
      await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1t-dos-tarjetas-a.png') })
      comprobar(marcadaA === a.id && dondeVer === `/cotizaciones/pdf#${a.id}` && (await mismoDocumento(pagina)) && !lineaDespues.includes(LINEA_A),
        `[Administración 1280] 1t-dos-tarjetas. «Ver su tarjeta» lleva a la de A, resaltada, y la línea se va (resaltada ${marcadaA === a.id ? 'A' : marcadaA}, ${dondeVer}, «${lineaDespues}»)`)
      const atras = await atrasDesdeLaTarjeta(pagina, a.id)
      comprobar(atras.bien, `[Administración 1280] 1t-dos-tarjetas. desde la tarjeta de «Ver su tarjeta», al menú y «Atrás» vuelve a Cotización en un paso, y «Adelante» y «Atrás» siguen (${atras.detalle})`)
    }
    const quedan = await hasta(() => sueltosDeLaOt(desde), (l) => l.length === 0, 10000)
    comprobar((await otDe(a.id)) === 1 && (await otDe(b.id)) === 1 && quedan.length === 0,
      `[Administración 1280] 1t-dos-tarjetas. las dos OT y nada suelto (OT de B ${await otDe(b.id)}, ${quedan.length} sueltos)`)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1t-dos-tarjetas. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1t-motivo-arriba. El rechazo de una ventana de useEnvio cerrada en vuelo, en «nueva» (Ventas)
// Nada lo pinta fuera de la ventana, y el aviso de arriba mandaba a leer «el
// aviso junto a su botón», que no existía (funcionalidad H1 de la
// trigesimoquinta): ahora dice el motivo. La placa repetida la rechaza la base.
if (corre('1t-motivo-arriba')) {
  const [unidad] = await consulta(`select u.cliente_id, u.placa from unidades u join clientes c on c.id = u.cliente_id
                                   where u.placa is not null and u.activo and c.activo order by u.creado_en limit 1`)
  const unidades = async () => Number((await consulta(`select count(*) n from unidades where cliente_id = $1`, [unidad.cliente_id]))[0].n)
  const antes = await unidades()
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.ventas, { width: 1280, height: 900 }, { compilacion: true })
  await ir(pagina, `${BASE}/clientes/${unidad.cliente_id}`)
  await hastaLaPestanaNueva(pagina, corte)
  await marcarDocumento(pagina)
  await pagina.getByRole('button', { name: 'Nueva unidad', exact: true }).first().click()
  const d = pagina.getByRole('dialog').first()
  await d.waitFor({ timeout: 20000 })
  const modelo = `QA-MOTIVO ${sello}`
  await d.locator('#nu-marca').fill('QA')
  await d.locator('#nu-modelo').fill(modelo)
  await d.locator('#nu-anio').fill('2020')
  await d.locator('#nu-placa').fill(unidad.placa)
  corte.marca = modelo
  await d.getByRole('button', { name: 'Registrar unidad' }).click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await d.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await botonDeArriba(pagina, 'Volver a cargar').click()
  await pagina.waitForTimeout(1000)
  corte.soltar()
  const porque = await hasta(() => sinRecargar(pagina), (t) => t.startsWith('Lo que enviaste no entró'), 20000)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1t-motivo-arriba.png') })
  comprobar(porque.startsWith('Lo que enviaste no entró, o no se sabe si entró: ') && porque !== NO_ENTRO && /ya tiene una unidad con la placa/.test(porque) && (await mismoDocumento(pagina)) && (await unidades()) === antes,
    `[Ventas 1280] 1t-motivo-arriba. la unidad rechazada con la ventana cerrada: arriba dice por qué, sin mandar a un aviso que no está, y no recarga («${porque}»)`)
  const igual = botonDeArriba(pagina, 'Volver a cargar igual')
  await Promise.all([pagina.waitForEvent('load', { timeout: 30000 }).catch(() => {}), igual.click()])
  comprobar(!(await mismoDocumento(pagina)), `[Ventas 1280] 1t-motivo-arriba. «Volver a cargar igual» recarga`)
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Ventas 1280] 1t-motivo-arriba. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1u-cronograma-arriba. El rechazo con «Nueva tarea» abierta, en «nueva» (Diseño)
// Con la ventana cerrada en vuelo, el rechazo del cronograma lo decía solo su
// renglón, y arriba se mandaba a leer «el aviso junto a su botón» con el botón
// desmontado por «Nueva tarea» (D4 de la trigesimosexta): ahora arriba dice
// por qué, como con la unidad de 1t-motivo-arriba.
if (corre('1u-cronograma-arriba')) {
  const orden = await ordenParaElCronograma()
  const actividad = `Arriba del cronograma ${sello}`
  const excel = await cronogramaQuePasaDeCien(actividad, `cronograma-arriba-${sello}.xlsx`)
  const actividades = async () => Number((await consulta(`select count(*) n from ot_actividades where orden_id = $1 and nombre like $2`, [orden.id, `${actividad}%`]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, { width: 1280, height: 900 }, { compilacion: true })
  await ir(pagina, `${BASE}/ordenes/${orden.id}?vista=actividades`)
  await hastaLaPestanaNueva(pagina, corte)
  await marcarDocumento(pagina)
  await pagina.getByRole('button', { name: 'Subir cronograma' }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor({ timeout: 20000 })
  await v.locator(`#cronograma-${orden.id}`).setInputFiles(excel)
  const cargar = v.getByRole('button', { name: 'Cargar 2 actividades' })
  await cargar.waitFor({ timeout: 15000 })
  await v.getByRole('checkbox').uncheck().catch(() => {})
  corte.marca = actividad
  await cargar.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await v.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await pagina.getByRole('button', { name: 'Nueva tarea', exact: true }).click()
  await pagina.getByRole('button', { name: 'Agregar a la lista' }).waitFor({ timeout: 10000 })
  const sinBoton = (await pagina.getByRole('button', { name: 'Subir cronograma' }).count()) === 0
  await botonDeArriba(pagina, 'Volver a cargar').click()
  await pagina.waitForTimeout(1000)
  corte.soltar()
  const porque = await hasta(() => sinRecargar(pagina), (t) => t.startsWith('Lo que enviaste no entró'), 20000)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1u-cronograma-arriba.png') })
  comprobar(sinBoton && porque.startsWith('Lo que enviaste no entró, o no se sabe si entró: ') && porque !== NO_ENTRO && porque.includes('suman') && (await mismoDocumento(pagina)) && (await actividades()) === 0,
    `[Diseño 1280] 1u-cronograma-arriba. el cronograma rechazado con «Nueva tarea» abierta y sin su botón: arriba dice por qué, y no recarga («${porque}»)`)
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Diseño 1280] 1u-cronograma-arriba. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1u-rechazo-se-queda. La ida a la tarjeta no se lleva el rechazo de otra OT (Administración)
// La OT que entraba con su ventana cerrada recargaba la pantalla para ir a su
// tarjeta, y se llevaba el «Ya hay una OT» que otra acababa de decir junto a
// su botón (F1 de la trigesimosexta). Ahora va sin recargar. Next manda las
// acciones de a una: B, con el número de una OT que ya existe, se detiene, y
// A sale cuando B vuelve rechazada.
if (corre('1u-rechazo-se-queda')) {
  const dos = await aprobadasSinOt(2)
  const [libre] = await numerosLibres(1)
  const [usada] = await consulta(`select split_part(numero, '-', 1) n, numero from ordenes_trabajo where numero like '%-' || $1 order by numero limit 1`, [anioDeLima()])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  if (dos.length < 2 || !libre || !usada) {
    comprobar(false, `[Administración 1280] 1u-rechazo-se-queda. hay dos cotizaciones aprobadas sin OT (${dos.length}), un número libre y una OT de este año`)
  } else {
    const [a, b] = dos
    const marcaB = `QA_F1B_${sello}`
    await ir(pagina, `${BASE}/cotizaciones/pdf?estado=APROBADA_SIN_OT`)
    await marcarDocumento(pagina)
    // B va con el número repetido y se detiene; su ventana se cierra en vuelo.
    const ventanaB = await llenarLaOt(pagina, b.id, `${marcaB}/26`, usada.n)
    corte.marca = marcaB
    await ventanaB.guardar.click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await ventanaB.d.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    // A va detrás, con su PDF ya subido, y su ventana también se cierra.
    const subidas = corte.storage.length
    const marcaA = `QA_F1A_${sello}`
    const ventanaA = await llenarLaOt(pagina, a.id, `${marcaA}/26`, libre)
    await ventanaA.guardar.click()
    await hasta(() => corte.storage.slice(subidas).some((x) => x.startsWith('POST adjuntos-ot/')), Boolean, 20000)
    await pagina.waitForTimeout(500)
    await ventanaA.d.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    const alertaDeB = () =>
      pagina.locator(`li[id="${b.id}"] [role="alert"]`).filter({ hasText: 'La OT que se estaba enviando' }).innerText().then(limpio).catch(() => '')
    // A también se detiene cuando sale, detrás de B: vuelve cuando B ya quitó
    // su PDF. Si A contestara antes, B seguiría en camino y A no iría sola
    // (lo dice el encabezado), que no es lo que se mide aquí.
    corte.marca = marcaA
    const borrados = corte.storage.filter((x) => x.startsWith('DELETE')).length
    corte.soltar()
    const rechazo = await hasta(alertaDeB, (t) => t.includes('Ya hay una OT'), 20000)
    await hasta(() => corte.retenidas, (n) => n >= 2, 20000)
    await hasta(() => corte.storage.filter((x) => x.startsWith('DELETE')).length, (n) => n > borrados, 20000)
    await pagina.waitForTimeout(500)
    corte.soltar()
    await hasta(() => otDe(a.id), (n) => n === 1, 20000)
    await pagina.waitForURL((u) => u.pathname === '/cotizaciones/pdf' && u.search === '' && u.hash === `#${a.id}`, { timeout: 20000 }).catch(() => {})
    const marcada = await hasta(() => resaltada(pagina), (id) => id === a.id, 15000)
    await pagina.waitForTimeout(1000)
    const donde = pagina.url().replace(BASE, '')
    const sigue = await alertaDeB()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1u-rechazo-se-queda.png') })
    comprobar(rechazo.startsWith(`La OT que se estaba enviando no se registró: Ya hay una OT ${usada.numero}`),
      `[Administración 1280] 1u-rechazo-se-queda. B, cerrada en vuelo con un número que ya existe: el rechazo se dice junto a su botón («${rechazo}»)`)
    comprobar(marcada === a.id && donde === `/cotizaciones/pdf#${a.id}` && (await mismoDocumento(pagina)) && sigue === rechazo,
      `[Administración 1280] 1u-rechazo-se-queda. A entra después y va a su tarjeta, resaltada, sin recargar, y el rechazo de B sigue dicho (resaltada ${marcada === a.id ? 'A' : marcada}, ${donde}, «${sigue}»)`)
    const atras = await atrasDesdeLaTarjeta(pagina, a.id)
    comprobar(atras.bien, `[Administración 1280] 1u-rechazo-se-queda. desde la tarjeta a la que fue sola, al menú y «Atrás» vuelve a Cotización en un paso, y «Adelante» y «Atrás» siguen (${atras.detalle})`)
    const quedan = await hasta(() => sueltosDeLaOt(desde), (l) => l.length === 0, 10000)
    comprobar((await otDe(a.id)) === 1 && (await otDe(b.id)) === 0 && quedan.length === 0,
      `[Administración 1280] 1u-rechazo-se-queda. A con su OT, B sin ella, y nada suelto (${quedan.length} sueltos)`)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1u-rechazo-se-queda. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1u-ida-otra-pantalla. La OT que entra con otro envío en camino no se va después (Administración)
// La ida a la tarjeta esperaba a que no quedara nada en camino ni otra ventana
// abierta, y salía minutos después desde la pantalla donde se estuviera:
// aquí, la orden nueva a medio escribir (Y1 de la trigesimosexta). Ahora sale
// en el acto o no sale, y el encabezado dice que entró. El otro envío es el
// PDF de una orden, que se corta sin llegar.
if (corre('1u-ida-otra-pantalla')) {
  const [ot] = await consulta(`select o.id, o.numero from ordenes_trabajo o
                               where o.cotizacion_pdf_id is null and o.estado not in ('ANULADA', 'ENTREGADA', 'FACTURADA')
                                 and not exists (select 1 from ot_adjuntos a where a.orden_id = o.id and a.tipo = 'ORDEN') order by o.numero desc limit 1`)
  const [cot] = await aprobadasSinOt(1)
  const [libre] = await numerosLibres(1)
  const [{ t: desde }] = await consulta(`select now() as t`)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  if (!ot || !cot || !libre) {
    comprobar(false, `[Administración 1280] 1u-ida-otra-pantalla. hay una orden sin PDF (${ot?.numero ?? 'ninguna'}), una cotización aprobada sin OT y un número libre`)
  } else {
    await ir(pagina, `${BASE}/ordenes/${ot.id}`)
    await marcarDocumento(pagina)
    corte.cortarSubida = `adjuntos-ot/ot/${ot.id}/`
    await pagina.locator(`input[type="file"]#subir-pdf-${ot.id}, #subir-pdf-${ot.id} input[type="file"]`).first()
      .setInputFiles({ name: `orden-en-camino-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`Orden ${ot.numero}`, `En camino ${sello}`]) })
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    // Con el PDF subiendo, a Cotización: la OT entra con su ventana abierta.
    await porElMenu(pagina, '/cotizaciones/pdf')
    const LINEA = `Se cargó el código y la OT de la cotización ${cot.numero}.`
    const ventana = await llenarLaOt(pagina, cot.id, `QA_Y1_${sello}/26`, libre)
    await ventana.guardar.click()
    await hasta(() => otDe(cot.id), (n) => n === 1, 30000)
    const linea = limpio(await hasta(() => pagina.locator('[data-estado-del-encabezado]').innerText(), (t) => limpio(t).includes(LINEA), 15000))
    await pagina.waitForTimeout(1500)
    const enCotizacion = pagina.url().replace(BASE, '')
    const quietoEnCotizacion = await mismoDocumento(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1u-ida-otra-pantalla-cotizacion.png') })
    comprobar(linea.includes(LINEA) && enCotizacion === '/cotizaciones/pdf' && quietoEnCotizacion,
      `[Administración 1280] 1u-ida-otra-pantalla. con el PDF de una orden todavía subiendo, la OT que entra no se va a su tarjeta: lo dice el encabezado (${enCotizacion}, «${linea}»)`)
    // A otra pantalla, a escribir; la subida termina mientras tanto.
    await porElMenu(pagina, '/ordenes')
    await porElMenu(pagina, '/ordenes/nueva')
    const texto = `Orden a medio escribir ${sello}`
    await pagina.locator('[name="descripcion"]').fill(texto)
    corte.soltar()
    await pagina.waitForTimeout(3000)
    const dondeAhora = pagina.url().replace(BASE, '')
    const sigueEscrito = await pagina.locator('[name="descripcion"]').inputValue().catch(() => '')
    const quieto = await mismoDocumento(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1u-ida-otra-pantalla-nueva.png') })
    comprobar(dondeAhora === '/ordenes/nueva' && quieto && sigueEscrito === texto,
      `[Administración 1280] 1u-ida-otra-pantalla. cuando la subida termina, nada se lleva la orden nueva a medio escribir (${dondeAhora}, mismo documento ${quieto}, «${sigueEscrito}»)`)
    // De vuelta en la orden, la subida cortada se dice, y nada quedó suelto.
    await pagina.evaluate(() => window.history.go(-3))
    await pagina.waitForURL((u) => u.pathname === `/ordenes/${ot.id}`, { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    const dice = limpio(await hasta(() => pagina.locator('main').innerText(), (t) => /No se pudo subir el archivo/.test(t ?? ''), 15000))
    const quedan = await hasta(() => sueltosDeLaOt(desde), (l) => l.length === 0, 10000)
    comprobar(/No se pudo subir el archivo/.test(dice) && quedan.length === 0,
      `[Administración 1280] 1u-ida-otra-pantalla. de vuelta en la orden, dice que el PDF no subió, y nada suelto (${quedan.length} sueltos)`)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1u-ida-otra-pantalla. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1u-pdf-aviso. Lo hecho con el PDF de la orden se va al salir (Administración)
// «PDF corregido guardado.» y «Se quitó…; vuelve a valer…» quedaban guardados:
// volvían horas después diciendo qué PDF vale, aunque otro ya hubiera subido
// uno (Y2 de la trigesimosexta). Ahora se dicen mientras se está en la orden.
if (corre('1u-pdf-aviso')) {
  // Una con un PDF o ninguno, y si lo tiene, subido por Administración: el de otra cuenta no lo ve, y no lo cambia.
  const [ot] = await consulta(`select o.id, o.numero, (select count(*) from ot_adjuntos a where a.orden_id = o.id and a.tipo = 'ORDEN')::int n
                               from ordenes_trabajo o where o.cotizacion_pdf_id is null and o.estado not in ('ANULADA', 'ENTREGADA', 'FACTURADA')
                                 and not exists (select 1 from ot_adjuntos a where a.orden_id = o.id and a.subido_por is distinct from (select id from usuarios where correo = $1))
                               order by case (select count(*) from ot_adjuntos a where a.orden_id = o.id and a.tipo = 'ORDEN') when 1 then 0 when 0 then 1 else 2 end, o.numero desc limit 1`, [CUENTAS.administracion])
  const pdfs = async () => Number((await consulta(`select count(*) n from ot_adjuntos where orden_id = $1 and tipo = 'ORDEN'`, [ot.id]))[0].n)
  const { pagina, contexto, errores } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  if (!ot || ot.n > 1) {
    comprobar(false, `[Administración 1280] 1u-pdf-aviso. hay una orden sin cotización con un PDF o ninguno (${ot?.numero ?? 'ninguna'}, ${ot?.n} PDF)`)
  } else {
    await ir(pagina, `${BASE}/ordenes/${ot.id}`)
    const campo = pagina.locator(`input[type="file"]#subir-pdf-${ot.id}, #subir-pdf-${ot.id} input[type="file"]`).first()
    const avisos = () => pagina.locator('main [role="status"]').allInnerTexts().then((l) => limpio(l.join(' | '))).catch(() => '')
    if (ot.n === 0) {
      await campo.setInputFiles({ name: `orden-primera-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`Orden ${ot.numero}`, `Primera ${sello}`]) })
      await hasta(pdfs, (n) => n === 1, 30000)
      await quieta(pagina)
    }
    const fuera = async () => {
      await irYVolver(pagina, '/ordenes')
      await pagina.waitForURL((u) => u.pathname === `/ordenes/${ot.id}`, { timeout: 20000 }).catch(() => {})
      await quieta(pagina)
      await pagina.getByRole('button', { name: 'Cambiar el PDF' }).waitFor({ timeout: 15000 }).catch(() => {})
    }
    await marcarDocumento(pagina)
    await pagina.getByRole('button', { name: 'Cambiar el PDF' }).click()
    await campo.setInputFiles({ name: `orden-corregida-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`Orden ${ot.numero}`, `Corregida ${sello}`]) })
    const dicho = await hasta(avisos, (t) => t.includes('PDF corregido guardado.'), 30000)
    await fuera()
    const alVolver = await avisos()
    comprobar(dicho.includes('PDF corregido guardado.') && (await pdfs()) === 2 && !alVolver.includes('PDF corregido guardado.') && (await mismoDocumento(pagina)),
      `[Administración 1280] 1u-pdf-aviso. «PDF corregido guardado.» se dice, y al salir de la orden y volver ya no («${alVolver}»)`)
    // Se quita el anterior, el que no es el vigente.
    const tachos = pagina.getByRole('button', { name: /^Quitar .*, del / })
    const nombres = await tachos.evaluateAll((l) => l.map((b) => b.getAttribute('aria-label')))
    const anterior = nombres.findIndex((n) => !n.endsWith(', el vigente'))
    if (anterior >= 0) {
      await tachos.nth(anterior).click()
      await pagina.getByRole('button', { name: 'Sí, quitar' }).click()
    }
    const quitado = await hasta(avisos, (t) => t.includes('Se quitó'), 20000)
    await fuera()
    const alVolverDeQuitar = await avisos()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1u-pdf-aviso.png') })
    comprobar(anterior >= 0 && quitado.includes('Se quitó') && (await pdfs()) === 1 && !alVolverDeQuitar.includes('Se quitó') && (await mismoDocumento(pagina)),
      `[Administración 1280] 1u-pdf-aviso. «Se quitó…» se dice, y al salir y volver ya no (${await pdfs()} PDF, «${alVolverDeQuitar}»)`)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1u-pdf-aviso. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1v-ver-su-tarjeta-en-camino. «Ver su tarjeta» con otra OT en camino (Administración)
// La navegación de Next espera a lo que va en transición: «Ver su tarjeta»
// quitaba la línea y no llevaba a ningún lado mientras la otra OT subía su PDF,
// y si esa entraba y se iba a su tarjeta, las dos idas salían juntas a
// «#A#B» (Z2 de la crítica de la trigesimoséptima). Ahora está apagado y dice
// por qué mientras algo va en camino. A entra con B todavía subiendo: no va
// sola, porque no es lo único en camino.
if (corre('1v-ver-su-tarjeta-en-camino')) {
  const dos = await aprobadasSinOt(2)
  const libres = await numerosLibres(2)
  const [{ t: desde }] = await consulta(`select now() as t`)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  if (dos.length < 2 || libres.length < 2) {
    comprobar(false, `[Administración 1280] 1v-ver-su-tarjeta-en-camino. hay dos cotizaciones aprobadas sin OT (${dos.length}) y dos números libres`)
  } else {
    const [a, b] = dos
    const encabezado = pagina.locator('[data-estado-del-encabezado]')
    const LINEA_A = `Se cargó el código y la OT de la cotización ${a.numero}.`
    await ir(pagina, `${BASE}/cotizaciones/pdf?estado=APROBADA_SIN_OT`)
    await marcarDocumento(pagina)
    // A se detiene antes de anotar; su ventana se cierra en vuelo.
    const marcaA = `QA_Z2A_${sello}`
    const ventanaA = await llenarLaOt(pagina, a.id, `${marcaA}/26`, libres[0])
    corte.marca = marcaA
    await ventanaA.guardar.click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await ventanaA.d.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    // B se detiene subiendo su PDF, como con poca señal; su ventana también se cierra.
    const ventanaB = await llenarLaOt(pagina, b.id, `QA_Z2B_${sello}/26`, libres[1])
    corte.cortarSubida = 'adjuntos-ot/ot/'
    await ventanaB.guardar.click()
    await hasta(() => corte.retenidas, (n) => n > 1, 30000)
    await ventanaB.d.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    // A entra con B en camino: lo dice el encabezado, y su botón está apagado.
    corte.soltarLa(marcaA)
    await hasta(() => otDe(a.id), (n) => n === 1, 30000)
    const linea = limpio(await hasta(() => encabezado.innerText(), (t) => limpio(t).includes(LINEA_A), 15000))
    const ver = encabezado.getByRole('button', { name: 'Ver su tarjeta' })
    await pagina.waitForTimeout(1500)
    const apagado = await ver.isDisabled().catch(() => false)
    const porque = await loQueDescribe(ver).catch(() => null)
    const dondeEnCamino = pagina.url().replace(BASE, '')
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1v-ver-su-tarjeta-en-camino.png') })
    comprobar(linea.includes(LINEA_A) && apagado && porque === 'Se puede ver cuando vuelva lo que se está enviando.' && dondeEnCamino === '/cotizaciones/pdf?estado=APROBADA_SIN_OT',
      `[Administración 1280] 1v-ver-su-tarjeta-en-camino. A entra con B subiendo: el encabezado lo dice, y «Ver su tarjeta» está apagado y dice por qué (apagado ${apagado}, «${porque}», ${dondeEnCamino})`)
    // B vuelve sin su PDF: el botón se enciende sin moverse (el motivo va en su
    // renglón; al lado, el botón saltaba al encenderse; D2 de la trigesimoctava)
    // y lleva a la tarjeta de A, con un solo «#».
    const cajaApagado = await ver.boundingBox()
    corte.soltarLa('adjuntos-ot/ot/')
    const encendido = await hasta(() => ver.isEnabled().catch(() => false), Boolean, 20000)
    await pagina.waitForTimeout(300)
    const cajaEncendido = await ver.boundingBox()
    comprobar(Boolean(cajaApagado && cajaEncendido) && Math.abs(cajaApagado.x - cajaEncendido.x) < 1 && Math.abs(cajaApagado.y - cajaEncendido.y) < 1,
      `[Administración 1280] 1v-ver-su-tarjeta-en-camino. «Ver su tarjeta» no se mueve al encenderse (x ${cajaApagado?.x} → ${cajaEncendido?.x}, y ${cajaApagado?.y} → ${cajaEncendido?.y})`)
    await ver.click().catch(() => {})
    const marcada = await hasta(() => resaltada(pagina), (id) => id === a.id, 15000)
    const donde = pagina.url().replace(BASE, '')
    const lineaDespues = limpio(await encabezado.innerText().catch(() => ''))
    comprobar(encendido && marcada === a.id && donde === `/cotizaciones/pdf#${a.id}` && !lineaDespues.includes(LINEA_A) && (await mismoDocumento(pagina)),
      `[Administración 1280] 1v-ver-su-tarjeta-en-camino. cuando B vuelve, «Ver su tarjeta» se enciende y lleva a la de A, resaltada, con un solo «#» (resaltada ${marcada === a.id ? 'A' : marcada}, ${donde}, «${lineaDespues}»)`)
    const quedan = await hasta(() => sueltosDeLaOt(desde), (l) => l.length === 0, 10000)
    comprobar((await otDe(a.id)) === 1 && (await otDe(b.id)) === 0 && quedan.length === 0,
      `[Administración 1280] 1v-ver-su-tarjeta-en-camino. A con su OT, B sin ella, y nada suelto (${quedan.length} sueltos)`)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1v-ver-su-tarjeta-en-camino. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1v-ver-su-tarjeta-nueva. «Ver su tarjeta» no anota una ida, en «nueva» (Administración)
// «Ver su tarjeta» anotaba la ida como la de un envío que entró: en la pestaña
// de otro despliegue, «Volver a cargar» giraba 15 s y decía «Lo que enviaste
// ya entró…» sin que se hubiera enviado nada (Z1 de la crítica de la
// trigesimoséptima). La OT se cierra en vuelo y la persona toca otra cosa: no
// va sola a su tarjeta, y el encabezado lo dice.
if (corre('1v-ver-su-tarjeta-nueva')) {
  const [cot] = await aprobadasSinOt(1)
  const [libre] = await numerosLibres(1)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 }, { compilacion: true })
  if (!cot || !libre) {
    comprobar(false, `[Administración 1280] 1v-ver-su-tarjeta-nueva. hay una cotización aprobada sin OT y un número libre`)
  } else {
    const encabezado = pagina.locator('[data-estado-del-encabezado]')
    const LINEA = `Se cargó el código y la OT de la cotización ${cot.numero}.`
    await ir(pagina, `${BASE}/cotizaciones/pdf`)
    await marcarDocumento(pagina)
    const marca = `QA_Z1_${sello}`
    const ventana = await llenarLaOt(pagina, cot.id, `${marca}/26`, libre)
    corte.marca = marca
    await ventana.guardar.click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await ventana.d.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    // Lo que la persona toca después de cerrar: la búsqueda, como en la crítica.
    await pagina.getByRole('searchbox', { name: 'Buscar cotizaciones' }).click()
    corte.soltar()
    await hasta(() => otDe(cot.id), (n) => n === 1, 30000)
    const linea = limpio(await hasta(() => encabezado.innerText(), (t) => limpio(t).includes(LINEA), 15000))
    const sinIr = pagina.url().replace(BASE, '')
    comprobar(linea.includes(LINEA) && sinIr === '/cotizaciones/pdf',
      `[Administración 1280] 1v-ver-su-tarjeta-nueva. cerrada en vuelo y tocada otra cosa, la OT no va sola a su tarjeta: lo dice el encabezado (${sinIr}, «${linea}»)`)
    // El despliegue de todos los días: la pestaña queda «nueva», y la línea sigue.
    await hastaLaPestanaNueva(pagina, corte)
    const ver = encabezado.getByRole('button', { name: 'Ver su tarjeta' })
    if (!(await ver.count())) {
      comprobar(false, `[Administración 1280] 1v-ver-su-tarjeta-nueva. en «nueva», el encabezado ofrece «Ver su tarjeta» (no está: la OT se fue sola a ${limpio(pagina.url().replace(BASE, ''))})`)
    } else {
      await ver.click()
      const marcada = await hasta(() => resaltada(pagina), (id) => id === cot.id, 15000)
      const quieto = await mismoDocumento(pagina)
      const dichos = []
      const mirar = setInterval(() => sinRecargar(pagina).then((t) => t && dichos.push(t)), 250)
      const [cargo] = await Promise.all([
        pagina.waitForEvent('load', { timeout: 10000 }).then(() => true).catch(() => false),
        botonDeArriba(pagina, 'Volver a cargar').click(),
      ])
      clearInterval(mirar)
      await quieta(pagina)
      await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1v-ver-su-tarjeta-nueva.png') })
      comprobar(marcada === cot.id && quieto,
        `[Administración 1280] 1v-ver-su-tarjeta-nueva. en «nueva», «Ver su tarjeta» lleva a la tarjeta, resaltada, sin recargar (resaltada ${marcada === cot.id ? 'la tarjeta' : marcada}, mismo documento ${quieto})`)
      comprobar(cargo && !(await mismoDocumento(pagina)) && !dichos.includes(SE_VA),
        `[Administración 1280] 1v-ver-su-tarjeta-nueva. después, «Volver a cargar» recarga: «Ver su tarjeta» no envió nada (recargó ${cargo}${dichos.length ? `, dijo «${dichos.at(-1)}»` : ''})`)
    }
  }
  corte.despliegue = false
  corte.conservaIds = false
  comprobar(errores.length === 0, `[Administración 1280] 1v-ver-su-tarjeta-nueva. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1v-ida-no-pisa-el-menu. La OT cerrada en vuelo no se lleva lo que la persona pidió después (Administración)
// Con la OT en camino, el menú o la búsqueda que se tocaban quedaban en cola
// detrás de su transición, y la ida a la tarjeta los reemplazaba: Órdenes no se
// abría nunca (funcionalidad H2 de la trigesimoséptima). Ahora, si la ventana
// se cerró y la persona tocó algo después, la OT no va sola.
if (corre('1v-ida-no-pisa-el-menu')) {
  const [cot] = await aprobadasSinOt(1)
  const [libre] = await numerosLibres(1)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  if (!cot || !libre) {
    comprobar(false, `[Administración 1280] 1v-ida-no-pisa-el-menu. hay una cotización aprobada sin OT y un número libre`)
  } else {
    await ir(pagina, `${BASE}/cotizaciones/pdf?estado=APROBADA_SIN_OT`)
    await marcarDocumento(pagina)
    const marca = `QA_H2_${sello}`
    const ventana = await llenarLaOt(pagina, cot.id, `${marca}/26`, libre)
    corte.marca = marca
    await ventana.guardar.click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await ventana.d.getByRole('button', { name: 'Cerrar', exact: true }).click()
    await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    // El menú, con la OT todavía en camino: Next lo deja en cola.
    const enlaces = pagina.locator('a[href="/ordenes"]')
    const visible = await enlaces.evaluateAll((l) => l.findIndex((a) => a.checkVisibility()))
    await enlaces.nth(Math.max(visible, 0)).click()
    await pagina.waitForTimeout(1000)
    corte.soltar()
    await hasta(() => otDe(cot.id), (n) => n === 1, 30000)
    await pagina.waitForURL((u) => u.pathname === '/ordenes', { timeout: 20000 }).catch(() => {})
    await pagina.waitForTimeout(3000)
    const donde = pagina.url().replace(BASE, '')
    const titulo = limpio(await pagina.locator('main h1').first().innerText().catch(() => ''))
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1v-ida-no-pisa-el-menu.png') })
    comprobar(donde === '/ordenes' && titulo === 'Órdenes de trabajo' && (await mismoDocumento(pagina)) && (await otDe(cot.id)) === 1,
      `[Administración 1280] 1v-ida-no-pisa-el-menu. la OT entra después de tocar el menú: abre Órdenes y no la tarjeta (${donde}, «${titulo}», OT ${await otDe(cot.id)})`)
    // Lo que la línea del encabezado decía se fue con la pantalla: de vuelta
    // en Cotización por el menú, no dice que se cargó (sin `guardar`).
    await porElMenu(pagina, '/cotizaciones/pdf')
    const encabezado = limpio(await pagina.locator('[data-estado-del-encabezado]').innerText().catch(() => ''))
    comprobar(!encabezado.includes('Se cargó el código y la OT') && !encabezado.includes(cot.numero),
      `[Administración 1280] 1v-ida-no-pisa-el-menu. de vuelta en Cotización por el menú, el encabezado ya no dice que se cargó («${encabezado}»)`)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1v-ida-no-pisa-el-menu. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1v-cronograma-se-va. Lo que entró del cronograma se va al salir de la orden (Diseño)
// «Cronograma cargado… El Excel quedó guardado en la orden» se guardaba: seguía
// después de quitar ese Excel en Resumen (funcionalidad H4 y realización H2
// de la trigesimoséptima). Ahora se va al salir; el Excel que no quedó, que es
// lo que falta hacer, sigue dicho.
if (corre('1v-cronograma-se-va')) {
  const orden = await ordenParaElCronograma()
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, { width: 1280, height: 900 })
  const renglon = () => pagina.locator('main [role="status"]').allInnerTexts().then((l) => limpio(l.join(' | '))).catch(() => '')
  const fuera = async () => {
    await irYVolver(pagina, '/ordenes')
    await pagina.waitForURL((u) => u.pathname === `/ordenes/${orden.id}`, { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    await pagina.getByRole('button', { name: 'Subir cronograma' }).waitFor({ timeout: 15000 }).catch(() => {})
  }
  const subir = async (actividad) => {
    const libro = new ExcelJS.Workbook()
    const hoja = libro.addWorksheet('Cronograma')
    hoja.addRow(['Área', 'Actividad', 'Referencia', 'Peso (%)', 'Inicio', 'Fin'])
    hoja.addRow(['Acabados', actividad, null, 0, null, null])
    const excel = join(archivos, `${actividad}.xlsx`)
    await libro.xlsx.writeFile(excel)
    await pagina.getByRole('button', { name: 'Subir cronograma' }).click()
    const v = pagina.getByRole('dialog')
    await v.waitFor({ timeout: 20000 })
    await v.locator(`#cronograma-${orden.id}`).setInputFiles(excel)
    const cargar = v.getByRole('button', { name: 'Cargar 1 actividad' })
    await cargar.waitFor({ timeout: 15000 })
    await cargar.click()
    await hasta(() => v.count(), (n) => n === 0, 30000)
  }
  await ir(pagina, `${BASE}/ordenes/${orden.id}?vista=actividades`)
  await marcarDocumento(pagina)
  // El Excel se corta subiendo: el cronograma entró y el Excel no.
  corte.cortarSubida = `adjuntos-ot/ot/${orden.id}/`
  const subida = subir(`Se va el cronograma A ${sello}`)
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  corte.soltar()
  await subida
  const sinExcel = await hasta(renglon, (t) => t.includes('El Excel no quedó guardado en la orden.'), 20000)
  await fuera()
  const sinExcelAlVolver = await renglon()
  comprobar(sinExcel.includes('Cronograma cargado') && sinExcelAlVolver.includes('El Excel no quedó guardado en la orden.') && !sinExcelAlVolver.includes('Cronograma cargado') && (await mismoDocumento(pagina)),
    `[Diseño 1280] 1v-cronograma-se-va. el Excel que no quedó sigue dicho al salir de la orden y volver, y lo que entró ya no («${sinExcelAlVolver}»)`)
  // Ahora entra con su Excel: al salir y volver, nada lo repite.
  await subir(`Se va el cronograma B ${sello}`)
  const conExcel = await hasta(renglon, (t) => t.includes('El Excel quedó guardado en la orden'), 20000)
  await fuera()
  const conExcelAlVolver = await renglon()
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1v-cronograma-se-va.png') })
  comprobar(conExcel.includes('Cronograma cargado') && !conExcelAlVolver.includes('Cronograma cargado') && !conExcelAlVolver.includes('El Excel quedó guardado') && (await mismoDocumento(pagina)),
    `[Diseño 1280] 1v-cronograma-se-va. «Cronograma cargado… El Excel quedó guardado en la orden» se dice, y al salir de la orden y volver ya no («${conExcelAlVolver}»)`)
  comprobar(errores.length === 0, `[Diseño 1280] 1v-cronograma-se-va. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1v-subida-se-va. «Cotización subida…» se va al salir de Cotización (Ventas)
// Se guardaba y decía «Gerencia ya la tiene para revisar» junto a la cotización
// que Gerencia ya había rechazado (funcionalidad H5 de la trigesimoséptima).
// Ahora dice lo que pasó, y se va al salir.
if (corre('1v-subida-se-va')) {
  const numero = `QA-SE-VA-COT-${sello}`
  const { pagina, contexto, errores } = await entrar(CUENTAS.ventas, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/cotizaciones/pdf`)
  await marcarDocumento(pagina)
  const encabezado = () => pagina.locator('[data-estado-del-encabezado]').innerText().then(limpio).catch(() => '')
  await pagina.getByRole('button', { name: 'Subir cotización' }).first().click()
  const d = pagina.getByRole('dialog').first()
  await d.waitFor({ timeout: 20000 })
  await d.locator('#cot-archivo').setInputFiles({ name: `${numero}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`COTIZACION ${numero}`, 'Semirremolque de banco']) })
  const subir = d.getByRole('button', { name: 'Subir y mandar a Gerencia' })
  await pagina.waitForTimeout(1500)
  await hasta(async () => !/Leyendo/.test(await d.innerText()) && (await subir.isEnabled()), Boolean, 30000)
  await d.locator('#cot-numero').fill(numero)
  await d.locator('#cot-monto').fill('1000')
  await d.locator('#cot-moneda').selectOption('USD')
  await d.locator('#cot-igv').selectOption('no')
  if (await d.locator('#cot-cliente').count()) await d.locator('#cot-cliente').selectOption({ index: 1 })
  if (await d.locator('#cot-carroceria').count()) await d.locator('#cot-carroceria').selectOption({ index: 1 })
  await subir.click()
  const dicho = await hasta(encabezado, (t) => t.includes('Cotización subida'), 30000)
  await irYVolver(pagina, '/clientes')
  await pagina.waitForURL((u) => u.pathname === '/cotizaciones/pdf', { timeout: 20000 }).catch(() => {})
  await quieta(pagina)
  const alVolver = await encabezado()
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1v-subida-se-va.png') })
  comprobar(dicho.includes('Cotización subida y enviada a Gerencia para que la revise.') && !dicho.includes('ya la tiene'),
    `[Ventas 1280] 1v-subida-se-va. dice lo que pasó, no cómo está la cotización («${dicho}»)`)
  comprobar(!alVolver.includes('Cotización subida') && (await mismoDocumento(pagina)),
    `[Ventas 1280] 1v-subida-se-va. al salir de Cotización y volver, ya no lo dice («${alVolver}»)`)
  comprobar(errores.length === 0, `[Ventas 1280] 1v-subida-se-va. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1w. La ida que la aplicación hace sola tras un envío no pisa lo que la persona hizo después
// «Nuevo subcontrato» cerrado en vuelo iba solo al subcontrato al entrar: se
// llevaba la segunda ventana con lo escrito, o la pantalla que la persona había
// pedido en el menú (W1 de la crítica de la trigesimoctava). Toda ida tras un
// envío sigue la regla de la OT (`navegarSiEsDeLaPestana` con
// `laIdaSigueEnPie`): si la persona está en otra cosa, no va, y la línea de
// arriba lo dice con su enlace. Y la ida a la tarjeta de la OT tampoco sale
// tras «Atrás», con su ventana cerrada (F1 de funcionalidad) o abierta (W2).
async function subcontratistaActivo() {
  const activo = () => consulta(`select id, nombre from subcontratistas where activo order by nombre limit 1`)
  const [hay] = await activo()
  if (hay) return hay
  await comoLaCuenta(CUENTAS.administracion, () =>
    consulta(`select public.guardar_subcontratista(gen_random_uuid(), '10043200017', 'Subcontratista de la pestaña vieja', null, null, null, null, true)`))
  return (await activo())[0]
}
const subcontratoDe = (marca) => consulta(`select id, numero from subcontratos where descripcion like $1`, [`${marca}%`])
/** Abre «Nuevo subcontrato» y lo deja listo para registrar, con `marca` al empezar el trabajo. */
async function llenarElSubcontrato(pagina, quien, marca) {
  await pagina.locator('[data-nuevo-subcontrato]').click()
  const v = pagina.getByRole('dialog').first()
  await v.waitFor({ timeout: 20000 })
  await v.getByRole('combobox', { name: 'Subcontratista' }).click()
  await pagina.keyboard.type(quien.nombre.slice(0, 14))
  await pagina.getByRole('option', { name: quien.nombre }).first().click()
  await v.locator('textarea[name="descripcion"]').fill(`${marca} trabajo de prueba del banco`)
  await escribirCodigo(v.locator('input[name="codigo_interno"]'), 'PLANTA')
  await v.locator('select[name="area"]').selectOption('PRD')
  await v.locator('input[name="monto"]').fill('100')
  return { v, registrar: v.getByRole('button', { name: 'Registrar subcontrato' }) }
}
/**
 * Al menú `href` y «Atrás», como lo hace una persona: después de ver la otra
 * pantalla. Pegado al commit de la otra, React vaciaba sus efectos en la misma
 * microtarea del «Atrás», y lo que se olvida al salir seguía montado (R4 de la
 * trigesimoctava: una carrera de la herramienta con la máquina cargada, que
 * nadie alcanza con el dedo).
 */
async function irYVolver(pagina, href) {
  const antes = await pagina.locator('main h1').first().innerText().catch(() => '')
  await porElMenu(pagina, href)
  await hasta(() => pagina.locator('main h1').first().innerText(), (t) => Boolean(t) && t !== antes, 15000)
  await pagina.waitForTimeout(400)
  await pagina.evaluate(() => window.history.back())
}

if (corre('1w-ida-no-pisa-otra-ventana')) {
  const quien = await subcontratistaActivo()
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/subcontratos`)
  await marcarDocumento(pagina)
  const marca = `QA_W1V_${sello}`
  const primero = await llenarElSubcontrato(pagina, quien, marca)
  corte.marca = marca
  await primero.registrar.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  // Se cierra con Escape mientras va, y se empieza a escribir el siguiente.
  await pagina.keyboard.press('Escape')
  await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
  await pagina.locator('[data-nuevo-subcontrato]').click()
  const segunda = pagina.getByRole('dialog').first()
  await segunda.waitFor({ timeout: 20000 })
  const texto = `Lo que escribí para el siguiente subcontrato ${sello}`
  await segunda.locator('textarea[name="descripcion"]').fill(texto)
  corte.soltar()
  await hasta(() => subcontratoDe(marca), (l) => l.length === 1, 30000)
  const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('El subcontrato quedó registrado.'), 15000)
  await pagina.waitForTimeout(2000)
  const donde = pagina.url().replace(BASE, '')
  const sigue = await segunda.locator('textarea[name="descripcion"]').inputValue().catch(() => '')
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1w-ida-no-pisa-otra-ventana.png') })
  comprobar(donde === '/subcontratos' && sigue === texto && (await mismoDocumento(pagina)) && dice === 'El subcontrato quedó registrado. Ver el subcontrato',
    `[Administración 1280] 1w-ida-no-pisa-otra-ventana. el subcontrato cerrado en vuelo entra con otra ventana abierta y escrita: no se la lleva, y arriba lo dice con su enlace (${donde}, «${sigue.slice(0, 40)}», «${dice}»)`)
  // La segunda se cierra sin enviar, y el enlace lleva al que entró.
  await pagina.keyboard.press('Escape')
  await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
  const [sc] = await subcontratoDe(marca)
  await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Ver el subcontrato' }).click().catch(() => {})
  await pagina.waitForURL((u) => u.pathname === `/subcontratos/${sc?.id}`, { timeout: 20000 }).catch(() => {})
  const despues = await hasta(() => pagina.locator('[data-ida-que-no-salio]').count(), (n) => n === 0, 5000)
  comprobar(pagina.url().replace(BASE, '') === `/subcontratos/${sc?.id}` && despues === 0 && (await mismoDocumento(pagina)),
    `[Administración 1280] 1w-ida-no-pisa-otra-ventana. «Ver el subcontrato» lleva a ${sc?.numero}, y la línea se va (${pagina.url().replace(BASE, '')})`)
  comprobar(errores.length === 0, `[Administración 1280] 1w-ida-no-pisa-otra-ventana. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

if (corre('1w-ida-no-pisa-el-menu')) {
  const quien = await subcontratistaActivo()
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/subcontratos`)
  await marcarDocumento(pagina)
  const marca = `QA_W1M_${sello}`
  const { registrar } = await llenarElSubcontrato(pagina, quien, marca)
  corte.marca = marca
  await registrar.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await pagina.keyboard.press('Escape')
  await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
  // El menú, con el subcontrato todavía en camino: Next lo deja en cola.
  const enlaces = pagina.locator('a[href="/ordenes"]')
  const visible = await enlaces.evaluateAll((l) => l.findIndex((a) => a.checkVisibility()))
  await enlaces.nth(Math.max(visible, 0)).click()
  await pagina.waitForTimeout(1000)
  corte.soltar()
  await hasta(() => subcontratoDe(marca), (l) => l.length === 1, 30000)
  await pagina.waitForURL((u) => u.pathname === '/ordenes', { timeout: 20000 }).catch(() => {})
  await pagina.waitForTimeout(3000)
  const donde = pagina.url().replace(BASE, '')
  const titulo = limpio(await pagina.locator('main h1').first().innerText().catch(() => ''))
  const dice = await idaQueNoSalio(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1w-ida-no-pisa-el-menu.png') })
  comprobar(donde === '/ordenes' && titulo === 'Órdenes de trabajo' && (await mismoDocumento(pagina)) && dice === 'El subcontrato quedó registrado. Ver el subcontrato',
    `[Administración 1280] 1w-ida-no-pisa-el-menu. el subcontrato entra después de tocar el menú: abre Órdenes, no el subcontrato, y arriba lo dice con su enlace (${donde}, «${titulo}», «${dice}»)`)
  // Quitarla con la ✕.
  await pagina.locator('[data-ida-que-no-salio]').getByRole('button', { name: 'Quitar este aviso' }).click().catch(() => {})
  const quitada = await hasta(() => pagina.locator('[data-ida-que-no-salio]').count(), (n) => n === 0, 5000)
  comprobar(quitada === 0, `[Administración 1280] 1w-ida-no-pisa-el-menu. la ✕ quita la línea`)
  comprobar(errores.length === 0, `[Administración 1280] 1w-ida-no-pisa-el-menu. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// Lo de siempre sigue: con la ventana abierta y nada tocado, el subcontrato va
// a su pantalla; y el cliente nuevo, que antes iba con un `redirect()` del
// servidor, va a su ficha, o lo dice arriba si se tocó el menú.
if (corre('1w-ida-sigue')) {
  const quien = await subcontratistaActivo()
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/subcontratos`)
  await marcarDocumento(pagina)
  const marca = `QA_W1S_${sello}`
  const { registrar } = await llenarElSubcontrato(pagina, quien, marca)
  await registrar.click()
  await hasta(() => subcontratoDe(marca), (l) => l.length === 1, 30000)
  const [sc] = await subcontratoDe(marca)
  await pagina.waitForURL((u) => u.pathname === `/subcontratos/${sc?.id}`, { timeout: 20000 }).catch(() => {})
  comprobar(pagina.url().replace(BASE, '') === `/subcontratos/${sc?.id}` && (await pagina.locator('[data-ida-que-no-salio]').count()) === 0 && (await mismoDocumento(pagina)),
    `[Administración 1280] 1w-ida-sigue. el subcontrato con su ventana abierta y nada tocado va a su pantalla (${pagina.url().replace(BASE, '')})`)
  // El cliente nuevo, quieto: va a su ficha.
  const ruc = (n) => `20${String(Number(sello) * 7 + n).padStart(9, '0').slice(-9)}`
  const clienteDe = (razon) => consulta(`select id from clientes where razon_social = $1`, [razon])
  const nuevoCliente = async (razon, numero) => {
    await porElMenu(pagina, '/clientes')
    await porElMenu(pagina, '/clientes/nuevo')
    await pagina.locator('[name="numero_documento"]').fill(numero)
    await pagina.locator('[name="razon_social"]').fill(razon)
    return pagina.getByRole('button', { name: 'Registrar cliente' })
  }
  const quieto = `QA_W1C_QUIETO_${sello}`
  await (await nuevoCliente(quieto, ruc(1))).click()
  await hasta(() => clienteDe(quieto), (l) => l.length === 1, 30000)
  const [cq] = await clienteDe(quieto)
  await pagina.waitForURL((u) => u.pathname === `/clientes/${cq?.id}`, { timeout: 20000 }).catch(() => {})
  comprobar(pagina.url().replace(BASE, '') === `/clientes/${cq?.id}` && (await mismoDocumento(pagina)),
    `[Administración 1280] 1w-ida-sigue. el cliente nuevo va a su ficha (${pagina.url().replace(BASE, '')})`)
  // Con el menú tocado mientras se guarda: abre Órdenes y lo dice arriba.
  const conMenu = `QA_W1C_MENU_${sello}`
  const boton = await nuevoCliente(conMenu, ruc(2))
  corte.marca = conMenu
  await boton.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  const enlaces = pagina.locator('a[href="/ordenes"]')
  const visible = await enlaces.evaluateAll((l) => l.findIndex((a) => a.checkVisibility()))
  await enlaces.nth(Math.max(visible, 0)).click()
  await pagina.waitForTimeout(1000)
  corte.soltar()
  await hasta(() => clienteDe(conMenu), (l) => l.length === 1, 30000)
  await pagina.waitForURL((u) => u.pathname === '/ordenes', { timeout: 20000 }).catch(() => {})
  await pagina.waitForTimeout(3000)
  const donde = pagina.url().replace(BASE, '')
  const dice = await idaQueNoSalio(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1w-ida-sigue-cliente.png') })
  comprobar(donde === '/ordenes' && dice === 'El cliente quedó registrado. Ver el cliente' && (await mismoDocumento(pagina)),
    `[Administración 1280] 1w-ida-sigue. el cliente que entra después de tocar el menú no se lleva Órdenes, y arriba lo dice (${donde}, «${dice}»)`)
  comprobar(errores.length === 0, `[Administración 1280] 1w-ida-sigue. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// «Atrás» con la OT en camino cambia la lista sin que Next lo detenga: la ida
// a la tarjeta salía igual y se llevaba la lista pedida (F1, con la ventana
// cerrada; W2, con la ventana abierta, que se va con su tarjeta).
for (const [parte, cerrada] of [['1w-atras-cerrada', true], ['1w-atras-abierta', false]]) {
  if (!corre(parte)) continue
  const [cot] = await aprobadasSinOt(1)
  const [libre] = await numerosLibres(1)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  if (!cot || !libre) {
    comprobar(false, `[Administración 1280] ${parte}. hay una cotización aprobada sin OT y un número libre`)
  } else {
    const LINEA = `Se cargó el código y la OT de la cotización ${cot.numero}.`
    await ir(pagina, `${BASE}/cotizaciones/pdf?estado=POR_REVISAR`)
    await marcarDocumento(pagina)
    await pagina.getByRole('link', { name: /Aprobadas sin código/ }).first().click()
    await pagina.waitForURL((u) => u.search === '?estado=APROBADA_SIN_OT', { timeout: 15000 })
    await quieta(pagina)
    const marca = `QA_W2${cerrada ? 'C' : 'A'}_${sello}`
    const ventana = await llenarLaOt(pagina, cot.id, `${marca}/26`, libre)
    corte.marca = marca
    await ventana.guardar.click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    if (cerrada) {
      await ventana.d.getByRole('button', { name: 'Cerrar', exact: true }).click()
      await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
    }
    await pagina.evaluate(() => window.history.back())
    await pagina.waitForURL((u) => u.search === '?estado=POR_REVISAR', { timeout: 15000 }).catch(() => {})
    await pagina.waitForTimeout(1500)
    corte.soltar()
    await hasta(() => otDe(cot.id), (n) => n === 1, 30000)
    const linea = limpio(await hasta(() => pagina.locator('[data-estado-del-encabezado]').innerText(), (t) => limpio(t).includes(LINEA), 15000))
    await pagina.waitForTimeout(2000)
    const donde = pagina.url().replace(BASE, '')
    const marcada = await resaltada(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, `pestana-vieja-${parte}.png`) })
    comprobar(donde === '/cotizaciones/pdf?estado=POR_REVISAR' && marcada === null && linea.includes(LINEA) && linea.includes('Ver su tarjeta') && (await mismoDocumento(pagina)) && (await otDe(cot.id)) === 1,
      `[Administración 1280] ${parte}. la OT entra después de «Atrás» con su ventana ${cerrada ? 'cerrada' : 'abierta'}: se queda en la lista pedida, y el encabezado lo dice con «Ver su tarjeta» (${donde}, resaltada ${marcada}, «${linea}»)`)
  }
  comprobar(errores.length === 0, `[Administración 1280] ${parte}. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// Su éxito ya no se guarda (1v-cronograma-se-va, 1v-subida-se-va): con la
// ventana cerrada en vuelo y la persona en otra pestaña o pantalla al
// contestar, al volver nada decía que entró, y el cronograma subido otra vez
// dejaba su Excel dos veces (F3 de funcionalidad, trigesimoctava). Ahora lo
// dice en pasado.
if (corre('1w-cronograma-entro')) {
  const orden = await ordenParaElCronograma()
  const actividad = `Entró con la ventana cerrada ${sello}`
  const actividades = async () => Number((await consulta(`select count(*) n from ot_actividades where orden_id = $1 and nombre = $2`, [orden.id, actividad]))[0].n)
  const libro = new ExcelJS.Workbook()
  const hoja = libro.addWorksheet('Cronograma')
  hoja.addRow(['Área', 'Actividad', 'Referencia', 'Peso (%)', 'Inicio', 'Fin'])
  hoja.addRow(['Acabados', actividad, null, 0, null, null])
  const excel = join(archivos, `cronograma-entro-${sello}.xlsx`)
  await libro.xlsx.writeFile(excel)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, { width: 1280, height: 900 })
  const renglon = () => pagina.locator('main [role="status"]').allInnerTexts().then((l) => limpio(l.join(' | '))).catch(() => '')
  const pestana = async (vista) => {
    const enlaces = pagina.locator(`a[href="/ordenes/${orden.id}?vista=${vista}"]`)
    const visible = await enlaces.evaluateAll((l) => l.findIndex((a) => a.checkVisibility()))
    await enlaces.nth(Math.max(visible, 0)).click()
  }
  await ir(pagina, `${BASE}/ordenes/${orden.id}?vista=actividades`)
  await marcarDocumento(pagina)
  await pagina.getByRole('button', { name: 'Subir cronograma' }).click()
  const v = pagina.getByRole('dialog')
  await v.waitFor({ timeout: 20000 })
  await v.locator(`#cronograma-${orden.id}`).setInputFiles(excel)
  const cargar = v.getByRole('button', { name: 'Cargar 1 actividad' })
  await cargar.waitFor({ timeout: 15000 })
  corte.marca = actividad
  await cargar.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await v.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await hasta(() => v.count(), (n) => n === 0, 5000)
  // A Resumen con el cronograma en camino; entra con la persona allí.
  await pestana('resumen')
  await pagina.waitForTimeout(1000)
  corte.soltar()
  await hasta(actividades, (n) => n === 1, 30000)
  await pagina.waitForURL((u) => u.searchParams.get('vista') === 'resumen', { timeout: 20000 }).catch(() => {})
  await quieta(pagina)
  await pagina.waitForTimeout(1500)
  await pestana('actividades')
  await pagina.waitForURL((u) => u.searchParams.get('vista') === 'actividades', { timeout: 20000 }).catch(() => {})
  await pagina.getByRole('button', { name: 'Subir cronograma' }).waitFor({ timeout: 15000 }).catch(() => {})
  const dice = await hasta(renglon, (t) => t.includes('El cronograma que se estaba enviando se cargó.'), 15000)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1w-cronograma-entro.png') })
  comprobar(dice.includes('El cronograma que se estaba enviando se cargó.') && !dice.includes('Cronograma cargado') && (await mismoDocumento(pagina)) && (await actividades()) === 1,
    `[Diseño 1280] 1w-cronograma-entro. el cronograma cerrado en vuelo entra con la persona en Resumen: de vuelta en su pestaña lo dice en pasado («${dice}»)`)
  comprobar(errores.length === 0, `[Diseño 1280] 1w-cronograma-entro. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

if (corre('1w-subida-entro')) {
  const numero = `QA-ENTRO-COT-${sello}`
  const subida = async () => Number((await consulta(`select count(*) n from cotizaciones_pdf where numero = $1`, [numero]))[0].n)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.ventas, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/cotizaciones/pdf`)
  await marcarDocumento(pagina)
  const encabezado = () => pagina.locator('[data-estado-del-encabezado]').innerText().then(limpio).catch(() => '')
  await pagina.getByRole('button', { name: 'Subir cotización' }).first().click()
  const d = pagina.getByRole('dialog').first()
  await d.waitFor({ timeout: 20000 })
  await d.locator('#cot-archivo').setInputFiles({ name: `${numero}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`COTIZACION ${numero}`, 'Semirremolque de banco']) })
  const subir = d.getByRole('button', { name: 'Subir y mandar a Gerencia' })
  await pagina.waitForTimeout(1500)
  await hasta(async () => !/Leyendo/.test(await d.innerText()) && (await subir.isEnabled()), Boolean, 30000)
  await d.locator('#cot-numero').fill(numero)
  await d.locator('#cot-monto').fill('1000')
  await d.locator('#cot-moneda').selectOption('USD')
  await d.locator('#cot-igv').selectOption('no')
  if (await d.locator('#cot-cliente').count()) await d.locator('#cot-cliente').selectOption({ index: 1 })
  if (await d.locator('#cot-carroceria').count()) await d.locator('#cot-carroceria').selectOption({ index: 1 })
  corte.marca = numero
  await subir.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await d.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
  // A Clientes con la subida en camino; entra con la persona allí, y vuelve.
  const enlaces = pagina.locator('a[href="/clientes"]')
  const visible = await enlaces.evaluateAll((l) => l.findIndex((a) => a.checkVisibility()))
  await enlaces.nth(Math.max(visible, 0)).click()
  await pagina.waitForTimeout(1000)
  corte.soltar()
  await hasta(subida, (n) => n === 1, 30000)
  await pagina.waitForURL((u) => u.pathname === '/clientes', { timeout: 20000 }).catch(() => {})
  await hasta(() => pagina.locator('main h1').first().innerText(), (t) => t === 'Clientes', 15000)
  await pagina.waitForTimeout(400)
  await pagina.evaluate(() => window.history.back())
  await pagina.waitForURL((u) => u.pathname === '/cotizaciones/pdf', { timeout: 20000 }).catch(() => {})
  await quieta(pagina)
  const dice = await hasta(encabezado, (t) => t.includes('La cotización que se estaba enviando se subió y se envió a Gerencia.'), 15000)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1w-subida-entro.png') })
  comprobar(dice.includes('La cotización que se estaba enviando se subió y se envió a Gerencia.') && !dice.includes('Cotización subida') && (await mismoDocumento(pagina)) && (await subida()) === 1,
    `[Ventas 1280] 1w-subida-entro. la cotización cerrada en vuelo entra con la persona en Clientes: de vuelta en Cotización lo dice en pasado («${dice}»)`)
  comprobar(errores.length === 0, `[Ventas 1280] 1w-subida-entro. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1x. La ida que no sale, del lado de quien la ve (trigesimonovena pasada)
// La línea de arriba hablaba de A después de que B sí saliera (H1 de diseño),
// y seguía al llegar a la orden por la lista, sin «?creada=1» (H2). Un
// formulario de página entera quedaba lleno y con el botón vivo, y un segundo
// toque registraba otro igual (X1 de la crítica). Y pedir otra pantalla era
// cualquier `pointerdown` en un enlace: el dedo que desplaza o el clic derecho
// dejaban la ida sin salir, y el clic de Enter o de un lector de pantalla no
// contaba (H2 de funcionalidad, X1b y R1).
const clientePor = (razon) => consulta(`select id from clientes where razon_social = $1`, [razon])
const rucDe1x = (n) => `20${String(Number(sello) * 11 + n).padStart(9, '0').slice(-9)}`
/** «Nuevo cliente» por el menú, lleno y sin enviar: su botón. */
async function clienteLleno(pagina, razon, numero) {
  await porElMenu(pagina, '/clientes')
  await porElMenu(pagina, '/clientes/nuevo')
  await pagina.locator('[name="numero_documento"]').fill(numero)
  await pagina.locator('[name="razon_social"]').fill(razon)
  return pagina.getByRole('button', { name: 'Registrar cliente' })
}
/** El enlace a `href` que se ve (el menú lateral o la barra de abajo). */
async function enlaceVisible(pagina, href) {
  const enlaces = pagina.locator(`a[href="${href}"]`)
  const visible = await enlaces.evaluateAll((l) => l.findIndex((a) => a.checkVisibility()))
  return enlaces.nth(Math.max(visible, 0))
}

if (corre('1x-la-que-sale-se-lleva-la-linea')) {
  const quien = await subcontratistaActivo()
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/subcontratos`)
  await marcarDocumento(pagina)
  const [marcaA, marcaB] = [`QA_X1A_${sello}`, `QA_X1B_${sello}`]
  const a = await llenarElSubcontrato(pagina, quien, marcaA)
  corte.marca = marcaA
  await a.registrar.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await pagina.keyboard.press('Escape')
  await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
  // A entra con B abierta: no se la lleva, lo dice arriba.
  const b = await llenarElSubcontrato(pagina, quien, marcaB)
  corte.soltar()
  await hasta(() => subcontratoDe(marcaA), (l) => l.length === 1, 30000)
  const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('El subcontrato quedó registrado.'), 15000)
  comprobar(dice === 'El subcontrato quedó registrado. Ver el subcontrato',
    `[Administración 1280] 1x-la-que-sale-se-lleva-la-linea. A entra con B abierta: arriba lo dice («${dice}»)`)
  // B, con su ventana abierta y nada tocado, sí sale: la línea de A no la sigue.
  await b.registrar.click()
  await hasta(() => subcontratoDe(marcaB), (l) => l.length === 1, 30000)
  const [scB] = await subcontratoDe(marcaB)
  await pagina.waitForURL((u) => u.pathname === `/subcontratos/${scB?.id}`, { timeout: 20000 }).catch(() => {})
  await pagina.waitForTimeout(1500)
  const donde = pagina.url().replace(BASE, '')
  const queda = await idaQueNoSalio(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1x-la-que-sale-se-lleva-la-linea.png') })
  comprobar(donde === `/subcontratos/${scB?.id}` && queda === '' && (await mismoDocumento(pagina)),
    `[Administración 1280] 1x-la-que-sale-se-lleva-la-linea. B sale a su pantalla y la línea de A se va con su salida (${donde}, «${queda}»)`)
  comprobar(errores.length === 0, `[Administración 1280] 1x-la-que-sale-se-lleva-la-linea. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// La crítica, X1a: Supervisión registra un trabajo en el teléfono y abre «Más»
// mientras va. Antes, al cerrarla, el formulario seguía lleno y vivo, y el
// segundo toque registraba otro trabajo igual.
if (corre('1x-trabajo-con-mas')) {
  const marca = `QA_X1T_${sello}`
  const trabajos = () => consulta(`select id from flota_unidades where trabajo like $1`, [`${marca}%`])
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, { width: 390, height: 844 })
  await ir(pagina, `${BASE}/avance/trabajos/nueva`)
  await marcarDocumento(pagina)
  await pagina.locator('#descripcion').fill(`Cabina de pintura ${sello}`)
  await pagina.locator('#trabajo').fill(`${marca} trabajo de prueba del banco`)
  const boton = pagina.getByRole('button', { name: 'Registrar el trabajo' })
  corte.marca = marca
  await boton.tap()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await pagina.locator('[data-barra-inferior] button').filter({ hasText: 'Más' }).tap()
  const mas = pagina.getByRole('dialog', { name: 'Tus secciones' })
  await mas.waitFor({ timeout: 10000 })
  corte.soltar()
  await hasta(trabajos, (l) => l.length === 1, 30000)
  const junto = await hasta(() => yaQuedo(pagina), (t) => t.includes('El trabajo quedó registrado.'), 15000)
  await pagina.waitForTimeout(1500)
  await mas.getByRole('button', { name: 'Cerrar', exact: true }).tap()
  await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
  const donde = pagina.url().replace(BASE, '')
  const arriba = await idaQueNoSalio(pagina)
  const trabado = (await boton.isDisabled()) && (await pagina.locator('#trabajo').isDisabled())
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1x-trabajo-con-mas.png') })
  comprobar(donde === '/avance/trabajos/nueva' && junto === 'El trabajo quedó registrado. Ver el trabajo' && arriba === '' && trabado && (await mismoDocumento(pagina)),
    `[Supervisión 390] 1x-trabajo-con-mas. el trabajo entra con «Más» abierta: no se la lleva, junto al botón dice que quedó, el formulario se traba y arriba no lo repite (${donde}, «${junto}», arriba «${arriba}», trabado ${trabado})`)
  // El segundo toque no manda nada.
  const antes = corte.acciones
  // Al centro: abajo, la barra de secciones lo tapa, y el toque forzado caía en ella.
  await boton.evaluate((b) => b.scrollIntoView({ block: 'center' }))
  await boton.tap({ force: true, timeout: 3000 }).catch(() => {})
  await pagina.waitForTimeout(4000)
  const sigue = await yaQuedo(pagina)
  comprobar(corte.acciones === antes && (await trabajos()).length === 1 && sigue === junto,
    `[Supervisión 390] 1x-trabajo-con-mas. un segundo toque no manda nada ni registra otro, y lo de junto al botón sigue (${corte.acciones - antes} acciones, ${(await trabajos()).length} trabajo, ${pagina.url().replace(BASE, '')}, «${sigue}»)`)
  const [t] = await trabajos()
  await pagina.locator('[data-ya-quedo]').getByRole('link', { name: 'Ver el trabajo' }).tap()
  await pagina.waitForURL((u) => u.pathname === `/avance/trabajos/${t?.id}`, { timeout: 20000 }).catch(() => {})
  comprobar(pagina.url().replace(BASE, '') === `/avance/trabajos/${t?.id}` && (await idaQueNoSalio(pagina)) === '',
    `[Supervisión 390] 1x-trabajo-con-mas. «Ver el trabajo» lleva al trabajo, sin línea arriba (${pagina.url().replace(BASE, '')})`)
  comprobar(errores.length === 0, `[Supervisión 390] 1x-trabajo-con-mas. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// El trabajo que entra con el formulario vuelto a montar (Atrás y Adelante
// mientras va) y «Más» abierta: la ida no sale, y la línea callaba en la
// dirección del formulario como si él lo dijera junto a su botón. El de ahora
// está vacío y sin trabar: nada decía que el trabajo había entrado, y escrito
// otra vez quedaba doble (T1 de la crítica, quincuagésima pasada).
if (corre('1x-trabajo-atras-con-mas')) {
  const marca = `QA_X1TA_${sello}`
  const trabajos = () => consulta(`select id from flota_unidades where trabajo like $1`, [`${marca}%`])
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, { width: 390, height: 844 })
  await ir(pagina, `${BASE}/avance/trabajos`)
  await marcarDocumento(pagina)
  // Por el enlace de la lista: así Atrás y Adelante no recargan la pantalla.
  await (await enlaceVisible(pagina, '/avance/trabajos/nueva')).tap()
  await pagina.waitForURL((u) => u.pathname === '/avance/trabajos/nueva', { timeout: 20000 })
  await quieta(pagina)
  await pagina.locator('#descripcion').fill(`Cabina de pintura ${sello}`)
  await pagina.locator('#trabajo').fill(`${marca} trabajo de prueba del banco`)
  corte.marca = marca
  await pagina.getByRole('button', { name: 'Registrar el trabajo' }).tap()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await pagina.goBack({ waitUntil: 'commit' }).catch(() => {})
  await pagina.waitForURL((u) => u.pathname === '/avance/trabajos', { timeout: 20000 }).catch(() => {})
  await pagina.waitForTimeout(1500)
  await pagina.goForward({ waitUntil: 'commit' }).catch(() => {})
  await pagina.waitForURL((u) => u.pathname === '/avance/trabajos/nueva', { timeout: 20000 }).catch(() => {})
  await pagina.locator('#trabajo').waitFor({ timeout: 20000 })
  await pagina.waitForTimeout(1500)
  const vacio = (await pagina.locator('#trabajo').inputValue()) === ''
  await pagina.locator('[data-barra-inferior] button').filter({ hasText: 'Más' }).tap()
  const mas = pagina.getByRole('dialog', { name: 'Tus secciones' })
  await mas.waitFor({ timeout: 10000 })
  corte.soltar()
  await hasta(trabajos, (l) => l.length === 1, 30000)
  await pagina.waitForTimeout(3000)
  await mas.getByRole('button', { name: 'Cerrar', exact: true }).tap()
  await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
  const arriba = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('El trabajo quedó registrado.'), 10000)
  const donde = pagina.url().replace(BASE, '')
  const junto = await yaQuedo(pagina)
  const aLaVista = await lineaALaVista(pagina)
  const n = (await trabajos()).length
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1x-trabajo-atras-con-mas.png') })
  comprobar(vacio && donde === '/avance/trabajos/nueva' && arriba === 'El trabajo quedó registrado. Ver el trabajo' && junto === '' && aLaVista && n === 1 && (await mismoDocumento(pagina)),
    `[Supervisión 390] 1x-trabajo-atras-con-mas. el trabajo entra con el formulario vuelto a montar, vacío, y «Más» abierta: al cerrarla, arriba dice que quedó, con su enlace (vacío ${vacio}, ${donde}, arriba «${arriba}», a la vista ${aLaVista}, junto al botón «${junto}», ${n} trabajo)`)
  // «Ver el trabajo» lleva a él, y la línea se va.
  const [t] = await trabajos()
  await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Ver el trabajo' }).tap()
  await pagina.waitForURL((u) => u.pathname === `/avance/trabajos/${t?.id}`, { timeout: 20000 }).catch(() => {})
  await pagina.waitForTimeout(1000)
  comprobar(pagina.url().replace(BASE, '') === `/avance/trabajos/${t?.id}` && (await idaQueNoSalio(pagina)) === '' && (await trabajos()).length === 1,
    `[Supervisión 390] 1x-trabajo-atras-con-mas. «Ver el trabajo» lleva al trabajo, sin línea arriba ni otro trabajo (${pagina.url().replace(BASE, '')})`)
  comprobar(errores.length === 0, `[Supervisión 390] 1x-trabajo-atras-con-mas. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// La orden, igual, y lo que pasa al irse: en otra pantalla la línea sí lo dice,
// y llegar a la orden por la lista, sin «?creada=1», también es llegar.
if (corre('1x-orden-con-mas')) {
  const [libre] = await numerosLibres(1)
  const marca = `QA_X1O_${sello}`
  const ordenes = () => consulta(`select id from ordenes_trabajo where descripcion like $1`, [`${marca}%`])
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 390, height: 844 })
  await ir(pagina, `${BASE}/ordenes/nueva`)
  await marcarDocumento(pagina)
  await pagina.locator('#cliente_id').click()
  await pagina.getByRole('option').first().click()
  await pagina.locator('textarea[name="descripcion"]').fill(`${marca} orden de prueba del banco`)
  await pagina.locator('input[type="file"]').first().setInputFiles({ name: `${marca}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`ORDEN DE TRABAJO N ${libre}-${anioDeLima()}`, marca]) })
  await pagina.waitForTimeout(1500)
  await pagina.locator('input[name="numero"], #numero').first().fill(String(libre))
  const boton = pagina.getByRole('button', { name: 'Registrar orden' })
  corte.marca = marca
  await boton.tap()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await pagina.locator('[data-barra-inferior] button').filter({ hasText: 'Más' }).tap()
  const mas = pagina.getByRole('dialog', { name: 'Tus secciones' })
  await mas.waitFor({ timeout: 10000 })
  corte.soltar()
  await hasta(ordenes, (l) => l.length === 1, 30000)
  const junto = await hasta(() => yaQuedo(pagina), (t) => t.includes('La orden quedó registrada.'), 15000)
  await pagina.waitForTimeout(1500)
  await mas.getByRole('button', { name: 'Cerrar', exact: true }).tap()
  await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
  const donde = pagina.url().replace(BASE, '')
  const arriba = await idaQueNoSalio(pagina)
  const trabado = (await boton.isDisabled()) && (await pagina.locator('textarea[name="descripcion"]').isDisabled())
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1x-orden-con-mas.png') })
  comprobar(donde === '/ordenes/nueva' && junto === 'La orden quedó registrada. Ver la orden' && arriba === '' && trabado && (await mismoDocumento(pagina)),
    `[Administración 390] 1x-orden-con-mas. la orden entra con «Más» abierta: junto al botón dice que quedó y el formulario se traba (${donde}, «${junto}», arriba «${arriba}», trabado ${trabado})`)
  const antes = corte.acciones
  // Al centro: abajo, la barra de secciones lo tapa, y el toque forzado caía en ella.
  await boton.evaluate((b) => b.scrollIntoView({ block: 'center' }))
  await boton.tap({ force: true, timeout: 3000 }).catch(() => {})
  await pagina.waitForTimeout(4000)
  comprobar(corte.acciones === antes && (await ordenes()).length === 1,
    `[Administración 390] 1x-orden-con-mas. un segundo toque no manda nada (${corte.acciones - antes} acciones, ${(await ordenes()).length} orden)`)
  // En otra pantalla, la línea de arriba sí lo dice.
  await porElMenu(pagina, '/ordenes')
  const enLista = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('La orden quedó registrada.'), 10000)
  comprobar(enLista === 'La orden quedó registrada. Ver la orden' && (await mismoDocumento(pagina)),
    `[Administración 390] 1x-orden-con-mas. fuera del formulario, arriba lo dice con su enlace (${pagina.url().replace(BASE, '')}, «${enLista}»${enLista ? '' : `, regiones: ${limpio((await pagina.locator('[role="status"]').allInnerTexts()).join(' | ')).slice(0, 200)}, mismo documento ${await mismoDocumento(pagina)}`})`)
  // Y llegar por la lista, sin «?creada=1», se la lleva. El banco tiene muchas
  // órdenes de prueba: se busca por su número, como lo haría la persona.
  const [o] = await ordenes()
  await pagina.getByRole('searchbox', { name: 'Buscar órdenes' }).fill(`${libre}-${anioDeLima()}`)
  await pagina.locator(`a[href="/ordenes/${o?.id}"]`).first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {})
  const enBusqueda = await idaQueNoSalio(pagina)
  await (await enlaceVisible(pagina, `/ordenes/${o?.id}`)).tap()
  await pagina.waitForURL((u) => u.pathname === `/ordenes/${o?.id}`, { timeout: 20000 }).catch(() => {})
  await quieta(pagina)
  const queda = await hasta(() => idaQueNoSalio(pagina), (t) => t === '', 5000)
  comprobar(enBusqueda === 'La orden quedó registrada. Ver la orden' && pagina.url().replace(BASE, '') === `/ordenes/${o?.id}` && queda === '' && (await mismoDocumento(pagina)),
    `[Administración 390] 1x-orden-con-mas. la línea sigue mientras se busca, y llegar a la orden por la lista se la lleva (${pagina.url().replace(BASE, '')}, buscando «${enBusqueda}», en la orden «${queda}»)`)
  comprobar(errores.length === 0, `[Administración 390] 1x-orden-con-mas. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// La orden, como el trabajo: entra con el formulario vuelto a montar por Atrás
// y Adelante y «Más» abierta. El formulario arma su partida a mano y no decía
// cuál la envió: la línea callaba, el de ahora estaba vacío y sin trabar, y
// escrita otra vez volvía con «Ya hay una orden de trabajo…: revisa el número
// del papel», que culpa al papel (T1 de la crítica, quincuagésima pasada).
if (corre('1x-orden-atras-con-mas')) {
  const [libre] = await numerosLibres(1)
  const marca = `QA_X1OA_${sello}`
  const ordenes = () => consulta(`select id from ordenes_trabajo where descripcion like $1`, [`${marca}%`])
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 390, height: 844 })
  await ir(pagina, `${BASE}/ordenes`)
  await marcarDocumento(pagina)
  // Por el enlace de la lista: así Atrás y Adelante no recargan la pantalla.
  await (await enlaceVisible(pagina, '/ordenes/nueva')).tap()
  await pagina.waitForURL((u) => u.pathname === '/ordenes/nueva', { timeout: 20000 })
  await quieta(pagina)
  await pagina.locator('#cliente_id').click()
  await pagina.getByRole('option').first().click()
  await pagina.locator('textarea[name="descripcion"]').fill(`${marca} orden de prueba del banco`)
  await pagina.locator('input[type="file"]').first().setInputFiles({ name: `${marca}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`ORDEN DE TRABAJO N ${libre}-${anioDeLima()}`, marca]) })
  await pagina.waitForTimeout(1500)
  await pagina.locator('input[name="numero"], #numero').first().fill(String(libre))
  corte.marca = marca
  await pagina.getByRole('button', { name: 'Registrar orden' }).tap()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await pagina.goBack({ waitUntil: 'commit' }).catch(() => {})
  await pagina.waitForURL((u) => u.pathname === '/ordenes', { timeout: 20000 }).catch(() => {})
  await pagina.waitForTimeout(1500)
  await pagina.goForward({ waitUntil: 'commit' }).catch(() => {})
  await pagina.waitForURL((u) => u.pathname === '/ordenes/nueva', { timeout: 20000 }).catch(() => {})
  await pagina.locator('textarea[name="descripcion"]').waitFor({ timeout: 20000 })
  await pagina.waitForTimeout(1500)
  const vacio = (await pagina.locator('textarea[name="descripcion"]').inputValue()) === ''
  await pagina.locator('[data-barra-inferior] button').filter({ hasText: 'Más' }).tap()
  const mas = pagina.getByRole('dialog', { name: 'Tus secciones' })
  await mas.waitFor({ timeout: 10000 })
  corte.soltar()
  await hasta(ordenes, (l) => l.length === 1, 30000)
  await pagina.waitForTimeout(3000)
  await mas.getByRole('button', { name: 'Cerrar', exact: true }).tap()
  await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
  const arriba = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('La orden quedó registrada.'), 10000)
  const donde = pagina.url().replace(BASE, '')
  const junto = await yaQuedo(pagina)
  const n = (await ordenes()).length
  // El formulario de la orden es largo, y Adelante devuelve la página abajo,
  // junto al botón: la línea no mueve la página de quien está lejos de ella
  // (ida-que-no-salio.tsx). Se ve al subir, entera, y no debajo de la barra.
  const bajada = await pagina.evaluate(() => window.scrollY)
  await pagina.evaluate(() => window.scrollTo({ top: 0 }))
  await pagina.waitForTimeout(300)
  const aLaVista = await lineaALaVista(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1x-orden-atras-con-mas.png') })
  comprobar(vacio && donde === '/ordenes/nueva' && arriba === 'La orden quedó registrada. Ver la orden' && junto === '' && aLaVista && n === 1 && (await mismoDocumento(pagina)),
    `[Administración 390] 1x-orden-atras-con-mas. la orden entra con el formulario vuelto a montar, vacío, y «Más» abierta: al cerrarla, arriba dice que quedó, con su enlace (vacío ${vacio}, ${donde}, arriba «${arriba}», bajada ${bajada} px y al subir a la vista ${aLaVista}, junto al botón «${junto}», ${n} orden)`)
  // «Ver la orden» lleva a ella, y la línea se va.
  const [o] = await ordenes()
  await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Ver la orden' }).tap()
  await pagina.waitForURL((u) => u.pathname === `/ordenes/${o?.id}`, { timeout: 20000 }).catch(() => {})
  await quieta(pagina)
  const queda = await hasta(() => idaQueNoSalio(pagina), (t) => t === '', 5000)
  comprobar(pagina.url().replace(BASE, '').startsWith(`/ordenes/${o?.id}`) && queda === '' && (await ordenes()).length === 1,
    `[Administración 390] 1x-orden-atras-con-mas. «Ver la orden» lleva a la orden, sin línea arriba ni otra orden (${pagina.url().replace(BASE, '')}, «${queda}»)`)
  comprobar(errores.length === 0, `[Administración 390] 1x-orden-atras-con-mas. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// Lo que no es pedir otra pantalla: el clic derecho en el menú (para abrirlo
// en otra pestaña) y el dedo que empieza a desplazar sobre un enlace. La ida
// sale igual.
if (corre('1x-clic-derecho')) {
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/clientes`)
  await marcarDocumento(pagina)
  const razon = `QA_X1D_${sello}`
  const boton = await clienteLleno(pagina, razon, rucDe1x(1))
  corte.marca = razon
  await boton.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await (await enlaceVisible(pagina, '/ordenes')).click({ button: 'right' })
  await pagina.keyboard.press('Escape')
  await pagina.waitForTimeout(500)
  corte.soltar()
  await hasta(() => clientePor(razon), (l) => l.length === 1, 30000)
  const [c] = await clientePor(razon)
  await pagina.waitForURL((u) => u.pathname === `/clientes/${c?.id}`, { timeout: 20000 }).catch(() => {})
  await pagina.waitForTimeout(1500)
  const donde = pagina.url().replace(BASE, '')
  comprobar(donde === `/clientes/${c?.id}` && (await idaQueNoSalio(pagina)) === '' && (await mismoDocumento(pagina)),
    `[Administración 1280] 1x-clic-derecho. un clic derecho en el menú mientras se guarda no es irse: el cliente va a su ficha (${donde})`)
  comprobar(errores.length === 0, `[Administración 1280] 1x-clic-derecho. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

if (corre('1x-dedo-que-desplaza')) {
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 390, height: 844 })
  await ir(pagina, `${BASE}/clientes`)
  await marcarDocumento(pagina)
  const razon = `QA_X1P_${sello}`
  const boton = await clienteLleno(pagina, razon, rucDe1x(2))
  // Lo que el navegador manda con el gesto: tiene que apoyar en el enlace y no ser clic.
  await pagina.evaluate(() => {
    window.__gesto = []
    window.addEventListener('pointerdown', (e) => window.__gesto.push(`apoya:${e.target.closest?.('a[href]')?.getAttribute('href') ?? '-'}`), true)
    window.addEventListener('click', () => window.__gesto.push('clic'), true)
  })
  corte.marca = razon
  await boton.tap()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  // El dedo apoya en «Cancelar», que lleva a Clientes, y desplaza la pantalla.
  await pagina.evaluate(() => { window.__gesto = [] })
  const cancelar = pagina.getByRole('link', { name: 'Cancelar' })
  const caja = await cancelar.boundingBox()
  const toque = await contexto.newCDPSession(pagina)
  const x = caja.x + caja.width / 2
  const y = caja.y + caja.height / 2
  await toque.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let i = 1; i <= 10; i++) {
    await toque.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 30 }] })
    await pagina.waitForTimeout(16)
  }
  await toque.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await pagina.waitForTimeout(500)
  const gesto = await pagina.evaluate(() => window.__gesto.join(' '))
  corte.soltar()
  await hasta(() => clientePor(razon), (l) => l.length === 1, 30000)
  const [c] = await clientePor(razon)
  await pagina.waitForURL((u) => u.pathname === `/clientes/${c?.id}`, { timeout: 20000 }).catch(() => {})
  await pagina.waitForTimeout(1500)
  const donde = pagina.url().replace(BASE, '')
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1x-dedo-que-desplaza.png') })
  comprobar(gesto.includes('apoya:/clientes') && !gesto.includes('clic') && donde === `/clientes/${c?.id}` && (await idaQueNoSalio(pagina)) === '' && (await mismoDocumento(pagina)),
    `[Administración 390] 1x-dedo-que-desplaza. el dedo que desplaza desde un enlace mientras se guarda no es irse: el cliente va a su ficha (${donde}, gesto «${gesto}»)`)
  comprobar(errores.length === 0, `[Administración 390] 1x-dedo-que-desplaza. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// Y lo que sí es: el clic en el menú con Enter, o el de un lector de pantalla
// (`element.click()`, sin `pointerdown`). Antes la ida se llevaba la pantalla
// pedida.
if (corre('1x-enter-y-lector')) {
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/clientes`)
  await marcarDocumento(pagina)
  const modos = [
    ['enter', async (enlace) => { await enlace.focus(); await pagina.keyboard.press('Enter') }],
    ['lector', (enlace) => enlace.evaluate((a) => a.click())],
  ]
  for (const [modo, pedir] of modos) {
    const razon = `QA_X1${modo === 'enter' ? 'E' : 'L'}_${sello}`
    const boton = await clienteLleno(pagina, razon, rucDe1x(modo === 'enter' ? 3 : 4))
    const antes = corte.retenidas
    corte.marca = razon
    await boton.click()
    await hasta(() => corte.retenidas, (n) => n > antes, 30000)
    await pedir(await enlaceVisible(pagina, '/ordenes'))
    await pagina.waitForTimeout(1000)
    corte.soltar()
    await hasta(() => clientePor(razon), (l) => l.length === 1, 30000)
    await pagina.waitForURL((u) => u.pathname === '/ordenes', { timeout: 20000 }).catch(() => {})
    await pagina.waitForTimeout(3000)
    const donde = pagina.url().replace(BASE, '')
    const dice = await idaQueNoSalio(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, `pestana-vieja-1x-${modo}.png`) })
    comprobar(donde === '/ordenes' && dice === 'El cliente quedó registrado. Ver el cliente' && (await mismoDocumento(pagina)),
      `[Administración 1280] 1x-enter-y-lector. el menú pedido con ${modo === 'enter' ? 'Enter' : 'el clic de un lector de pantalla'} mientras se guarda abre Órdenes, y arriba lo dice (${donde}, «${dice}»)`)
    await pagina.locator('[data-ida-que-no-salio]').getByRole('button', { name: 'Quitar este aviso' }).click().catch(() => {})
    await hasta(() => pagina.locator('[data-ida-que-no-salio]').count(), (n) => n === 0, 5000)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1x-enter-y-lector. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1y. Lo que la cuadragésima pasada dejó en pie de la ida
// Un aviso de la campana es un botón: abrirlo mientras el formulario entraba no
// contaba como pedir otra pantalla, la ida del formulario salía y la del aviso
// la pisaba, y la persona terminaba en el aviso sin saber que lo suyo había
// entrado (X2 de la crítica). Y «Dar código y cargar la OT» iba a su tarjeta
// con la línea de otro documento encima (R2 de realización).
if (corre('1y-aviso-mientras-entra')) {
  for (const viewport of [{ width: 1280, height: 900 }, CELULAR]) {
    const ancho = viewport.width
    const marca = `QA_Y1A_${ancho}_${sello}`
    const titulo = `Aviso que lleva a Reportes diarios ${ancho} ${sello}`
    const trabajos = () => consulta(`select id from flota_unidades where trabajo like $1`, [`${marca}%`])
    // Los avisos los dejan los disparadores; este se siembra, con su pantalla.
    await consulta(
      `insert into notificaciones (usuario_id, titulo, cuerpo, ruta) select id, $2, 'Sembrado por probar-pestana-vieja-y-giro', '/reportes-diarios' from usuarios where correo = $1`,
      [CUENTAS.mtz, titulo],
    )
    const leido = async () => (await consulta(`select leida_en from notificaciones where titulo = $1`, [titulo]))[0]?.leida_en ?? null
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, viewport)
    await ir(pagina, `${BASE}/avance/trabajos/nueva`)
    await marcarDocumento(pagina)
    await pagina.locator('#descripcion').fill(`Cabina de pintura ${sello}`)
    await pagina.locator('#trabajo').fill(`${marca} trabajo de prueba del banco`)
    corte.marca = marca
    await pagina.getByRole('button', { name: 'Registrar el trabajo' }).click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    // Mientras va, la campana y el aviso, que esperan detrás del trabajo.
    await pagina.getByRole('button', { name: /^Avisos/ }).first().click()
    await pagina.locator('#panel-avisos').waitFor({ timeout: 10000 })
    await pagina.locator('#panel-avisos li button').filter({ hasText: titulo }).first().click()
    await pagina.waitForTimeout(800)
    corte.soltar()
    await hasta(trabajos, (l) => l.length === 1, 30000)
    await pagina.waitForURL((u) => u.pathname === '/reportes-diarios', { timeout: 20000 }).catch(() => {})
    const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('El trabajo quedó registrado.'), 15000)
    await pagina.waitForTimeout(1500)
    const donde = pagina.url().replace(BASE, '')
    await pagina.screenshot({ path: join(CAPTURAS, `pestana-vieja-1y-aviso-mientras-entra-${ancho}.png`) })
    comprobar(donde === '/reportes-diarios' && dice === 'El trabajo quedó registrado. Ver el trabajo' && Boolean(await leido()) && (await mismoDocumento(pagina)),
      `[Supervisión ${ancho}] 1y-aviso-mientras-entra. el aviso abierto mientras entra el trabajo lleva a su pantalla, y arriba dice que el trabajo quedó (${donde}, «${dice}», aviso leído ${Boolean(await leido())})`)
    // El enlace de la línea lleva al trabajo, y la línea se va.
    const [t] = await trabajos()
    await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Ver el trabajo' }).click().catch(() => {})
    await pagina.waitForURL((u) => u.pathname === `/avance/trabajos/${t?.id}`, { timeout: 20000 }).catch(() => {})
    const queda = await hasta(() => idaQueNoSalio(pagina), (x) => x === '', 5000)
    comprobar(pagina.url().replace(BASE, '') === `/avance/trabajos/${t?.id}` && queda === '' && (await mismoDocumento(pagina)),
      `[Supervisión ${ancho}] 1y-aviso-mientras-entra. «Ver el trabajo» lleva al trabajo y la línea se va (${pagina.url().replace(BASE, '')}, «${queda}»)`)
    comprobar(errores.length === 0, `[Supervisión ${ancho}] 1y-aviso-mientras-entra. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  }
}

// La línea de otro documento, de pie, y la OT que se carga después: se la lleva
// al ir a su tarjeta.
if (corre('1y-la-ot-se-lleva-la-linea')) {
  const [cot] = await aprobadasSinOt(1)
  const [libre] = await numerosLibres(1)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  if (!cot || !libre) {
    comprobar(false, `[Administración 1280] 1y-la-ot-se-lleva-la-linea. hay una cotización aprobada sin OT y un número libre`)
  } else {
    await ir(pagina, `${BASE}/clientes`)
    await marcarDocumento(pagina)
    // La línea: el cliente entra después de pedir Órdenes.
    const razon = `QA_Y1C_${sello}`
    const boton = await clienteLleno(pagina, razon, rucDe1x(5))
    corte.marca = razon
    await boton.click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await (await enlaceVisible(pagina, '/ordenes')).click()
    await pagina.waitForTimeout(1000)
    corte.soltar()
    await hasta(() => clientePor(razon), (l) => l.length === 1, 30000)
    await pagina.waitForURL((u) => u.pathname === '/ordenes', { timeout: 20000 }).catch(() => {})
    const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('El cliente quedó registrado.'), 15000)
    // A Cotización por el menú y a «Aprobadas sin código» por su pastilla: sigue.
    await porElMenu(pagina, '/cotizaciones/pdf')
    await pagina.locator('a[href="/cotizaciones/pdf?estado=APROBADA_SIN_OT"]').first().click()
    await pagina.waitForURL((u) => u.search === '?estado=APROBADA_SIN_OT', { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    const enCotizacion = await idaQueNoSalio(pagina)
    comprobar(dice === 'El cliente quedó registrado. Ver el cliente' && enCotizacion === dice && (await mismoDocumento(pagina)),
      `[Administración 1280] 1y-la-ot-se-lleva-la-linea. la línea del cliente sigue en Cotización («${dice}», en Cotización «${enCotizacion}», ${pagina.url().replace(BASE, '')})`)
    const ventana = await llenarLaOt(pagina, cot.id, `QA_Y1C_${sello}/26`, libre)
    await ventana.guardar.click()
    await hasta(() => otDe(cot.id), (n) => n === 1, 30000)
    const marcada = await hasta(() => resaltada(pagina), (id) => id === cot.id, 20000)
    await pagina.waitForTimeout(1500)
    const donde = pagina.url().replace(BASE, '')
    const queda = await idaQueNoSalio(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1y-la-ot-se-lleva-la-linea.png') })
    comprobar((await otDe(cot.id)) === 1 && marcada === cot.id && donde === `/cotizaciones/pdf#${cot.id}` && queda === '' && (await mismoDocumento(pagina)),
      `[Administración 1280] 1y-la-ot-se-lleva-la-linea. la OT entra y va a su tarjeta, resaltada, sin la línea del cliente encima (${donde}, resaltada ${marcada === cot.id}, «${queda}»)`)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1y-la-ot-se-lleva-la-linea. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1z. Lo que la cuadragésima primera pasada dejó en pie de la ida
// El rechazo de un formulario de página entera que vuelve cuando la persona ya
// pidió otra pantalla se pintaba en el formulario unos milisegundos y se iba
// con él: en la pantalla pedida nada decía que no había entrado (Y1 de la
// crítica). Y la OT que no iba a su tarjeta porque la persona se fue de
// Cotización borraba la línea de otro documento sin poner nada en su lugar
// (H1 de funcionalidad).
/** Un número de OT de este año que ya está tomado: la base rechaza otra con él. */
const numeroTomado = async () =>
  (await consulta(`select split_part(numero, '-', 1) n from ordenes_trabajo where numero like '%-' || $1 order by creado_en limit 1`, [anioDeLima()]))[0]?.n
/** La orden sin cotización llena con `numero`, sin enviar: su botón. */
async function ordenLlena(pagina, marca, numero) {
  await pagina.locator('#cliente_id').click()
  await pagina.getByRole('option').first().click()
  await pagina.locator('textarea[name="descripcion"]').fill(`${marca} orden de prueba del banco`)
  await pagina.locator('input[type="file"]').first().setInputFiles({ name: `${marca}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`ORDEN DE TRABAJO N ${numero}-${anioDeLima()}`, marca]) })
  await pagina.waitForTimeout(1500)
  await pagina.locator('input[name="numero"], #numero').first().fill(String(numero))
  return pagina.getByRole('button', { name: 'Registrar orden' })
}
const tonoDeLaLinea = (pagina) => pagina.locator('[data-ida-que-no-salio]').getAttribute('data-ida-que-no-salio').catch(() => null)

if (corre('1z-rechazo-de-la-orden')) {
  const tomado = await numeroTomado()
  const marca = `QA_Z1O_${sello}`
  const ordenes = () => consulta(`select id from ordenes_trabajo where descripcion like $1`, [`${marca}%`])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  if (!tomado) {
    comprobar(false, `[Administración 1280] 1z-rechazo-de-la-orden. hay una OT de este año para repetir su número`)
  } else {
    await ir(pagina, `${BASE}/ordenes/nueva`)
    await marcarDocumento(pagina)
    const boton = await ordenLlena(pagina, marca, tomado)
    corte.marca = marca
    await boton.click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    // Mientras va, el menú: Next lo deja en cola detrás de la orden.
    await (await enlaceVisible(pagina, '/clientes')).click()
    await pagina.waitForTimeout(800)
    corte.soltar()
    await pagina.waitForURL((u) => u.pathname === '/clientes', { timeout: 20000 }).catch(() => {})
    const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('no se guardó'), 15000)
    await pagina.waitForTimeout(1500)
    const donde = pagina.url().replace(BASE, '')
    const tono = await tonoDeLaLinea(pagina)
    const aLaVista = await lineaALaVista(pagina)
    const sueltos = await sueltosDeLaOt(desde)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1z-rechazo-de-la-orden.png') })
    comprobar(donde === '/clientes' && dice === `La orden no se guardó. Ya hay una orden de trabajo ${tomado}-${anioDeLima()}: revisa el número del papel. Volver a la orden nueva` && tono === 'rechazo' && aLaVista && (await ordenes()).length === 0 && sueltos.length === 0 && (await mismoDocumento(pagina)),
      `[Administración 1280] 1z-rechazo-de-la-orden. la orden rechazada después de tocar el menú lo dice arriba, a la vista, en rojo, con el camino de vuelta, y su PDF no queda suelto (${donde}, «${dice}», ${tono}, a la vista ${aLaVista}, ${(await ordenes()).length} órdenes, ${sueltos.length} sueltos)`)
    // La línea sigue mientras la persona anda por otras pantallas.
    await porElMenu(pagina, '/ordenes')
    const enOrdenes = await idaQueNoSalio(pagina)
    // «Volver a la orden nueva»: el formulario, con el motivo arriba y sin el enlace.
    await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver a la orden nueva' }).click({ timeout: 5000 }).catch(() => {})
    await pagina.waitForURL((u) => u.pathname === '/ordenes/nueva', { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    const alVolver = await idaQueNoSalio(pagina)
    comprobar(enOrdenes === dice && pagina.url().replace(BASE, '') === '/ordenes/nueva' && alVolver === dice.replace(/ Volver a la orden nueva$/, '') && (await mismoDocumento(pagina)),
      `[Administración 1280] 1z-rechazo-de-la-orden. sigue en Órdenes, y de vuelta en el formulario dice el motivo sin el enlace (en Órdenes «${enOrdenes}», ${pagina.url().replace(BASE, '')}, «${alVolver}»)`)
    // Otra vez el mismo número, sin irse: el rechazo va junto al número y el de arriba se va.
    if (pagina.url().replace(BASE, '') === '/ordenes/nueva') {
      const otra = await ordenLlena(pagina, marca, tomado)
      await otra.click()
      const junto = await hasta(() => pagina.locator('main [role="alert"]').allInnerTexts().then((l) => limpio(l.join(' '))), (t) => t.includes('Ya hay una orden de trabajo'), 20000)
      const arriba = await idaQueNoSalio(pagina)
      comprobar(junto.includes(`Ya hay una orden de trabajo ${tomado}-${anioDeLima()}`) && arriba === '' && (await ordenes()).length === 0,
        `[Administración 1280] 1z-rechazo-de-la-orden. al enviar otra vez desde el formulario, el rechazo va en el formulario y el de arriba se va («${junto}», arriba «${arriba}»)`)
    } else {
      comprobar(false, `[Administración 1280] 1z-rechazo-de-la-orden. al enviar otra vez desde el formulario, el rechazo va en el formulario y el de arriba se va (no se volvió al formulario: ${pagina.url().replace(BASE, '')})`)
    }
  }
  comprobar(errores.length === 0, `[Administración 1280] 1z-rechazo-de-la-orden. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// El cliente de Ventas en el teléfono, rechazado después de abrir un aviso, y
// el trabajo de Supervisión, después de tocar el menú: los dos por `useEnvio`.
if (corre('1z-rechazo-con-un-aviso')) {
  const razon = `QA_Z1C_${sello}`
  const titulo = `Aviso que lleva a Cotización ${sello}`
  await consulta(
    `insert into notificaciones (usuario_id, titulo, cuerpo, ruta) select id, $2, 'Sembrado por probar-pestana-vieja-y-giro', '/cotizaciones/pdf' from usuarios where correo = $1`,
    [CUENTAS.ventas, titulo],
  )
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.ventas, CELULAR)
  await ir(pagina, `${BASE}/clientes`)
  await marcarDocumento(pagina)
  // Un RUC de diez dígitos: la acción lo rechaza.
  const boton = await clienteLleno(pagina, razon, rucDe1x(6).slice(0, 10))
  corte.marca = razon
  await boton.evaluate((b) => b.scrollIntoView({ block: 'center' }))
  await boton.tap()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await pagina.getByRole('button', { name: /^Avisos/ }).first().tap()
  await pagina.locator('#panel-avisos').waitFor({ timeout: 10000 })
  await pagina.locator('#panel-avisos li button').filter({ hasText: titulo }).first().tap()
  await pagina.waitForTimeout(800)
  corte.soltar()
  await pagina.waitForURL((u) => u.pathname === '/cotizaciones/pdf', { timeout: 20000 }).catch(() => {})
  const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('no se guardó'), 15000)
  await pagina.waitForTimeout(1500)
  const donde = pagina.url().replace(BASE, '')
  const tono = await tonoDeLaLinea(pagina)
  const aLaVista = await lineaALaVista(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1z-rechazo-con-un-aviso.png') })
  comprobar(donde === '/cotizaciones/pdf' && dice === 'El cliente no se guardó. El RUC debe tener 11 dígitos. Volver al cliente nuevo' && tono === 'rechazo' && aLaVista && (await clientePor(razon)).length === 0 && (await mismoDocumento(pagina)),
    `[Ventas 390] 1z-rechazo-con-un-aviso. el cliente rechazado después de abrir un aviso lo dice arriba, a la vista, en la pantalla del aviso (${donde}, «${dice}», ${tono}, a la vista ${aLaVista})`)
  await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver al cliente nuevo' }).tap({ timeout: 5000 }).catch(() => {})
  await pagina.waitForURL((u) => u.pathname === '/clientes/nuevo', { timeout: 20000 }).catch(() => {})
  await quieta(pagina)
  const alVolver = await idaQueNoSalio(pagina)
  // «Quitar este aviso» se lo lleva.
  await pagina.locator('[data-ida-que-no-salio]').getByRole('button', { name: 'Quitar este aviso' }).tap().catch(() => {})
  const quitado = await hasta(() => idaQueNoSalio(pagina), (t) => t === '', 5000)
  comprobar(pagina.url().replace(BASE, '') === '/clientes/nuevo' && alVolver === 'El cliente no se guardó. El RUC debe tener 11 dígitos.' && quitado === '',
    `[Ventas 390] 1z-rechazo-con-un-aviso. de vuelta en el cliente nuevo dice el motivo, y «Quitar este aviso» se lo lleva («${alVolver}», después «${quitado}»)`)
  comprobar(errores.length === 0, `[Ventas 390] 1z-rechazo-con-un-aviso. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

if (corre('1z-rechazo-del-trabajo')) {
  const marca = `QA_Z1T_${sello}`
  const trabajos = () => consulta(`select id from flota_unidades where trabajo like $1`, [`${marca}%`])
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/avance/trabajos/nueva`)
  await marcarDocumento(pagina)
  // Sin qué es ni placa: la acción lo rechaza.
  await pagina.locator('#trabajo').fill(`${marca} trabajo de prueba del banco`)
  corte.marca = marca
  await pagina.getByRole('button', { name: 'Registrar el trabajo' }).click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await (await enlaceVisible(pagina, '/reportes-diarios')).click()
  await pagina.waitForTimeout(800)
  corte.soltar()
  await pagina.waitForURL((u) => u.pathname === '/reportes-diarios', { timeout: 20000 }).catch(() => {})
  const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('no se guardó'), 15000)
  await pagina.waitForTimeout(1500)
  const donde = pagina.url().replace(BASE, '')
  const tono = await tonoDeLaLinea(pagina)
  const aLaVista = await lineaALaVista(pagina)
  comprobar(donde === '/reportes-diarios' && dice === 'El trabajo no se guardó. Escribe qué es el trabajo, o la placa si es una unidad. Volver al trabajo nuevo' && tono === 'rechazo' && aLaVista && (await trabajos()).length === 0 && (await mismoDocumento(pagina)),
    `[Supervisión 1280] 1z-rechazo-del-trabajo. el trabajo rechazado después de tocar el menú lo dice arriba, a la vista (${donde}, «${dice}», ${tono}, a la vista ${aLaVista})`)
  // De vuelta por su enlace y enviado bien: entra, va a su pantalla y el rechazo de arriba ya no está.
  await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver al trabajo nuevo' }).click({ timeout: 5000 }).catch(() => {})
  await pagina.waitForURL((u) => u.pathname === '/avance/trabajos/nueva', { timeout: 20000 }).catch(() => {})
  await quieta(pagina)
  // Sin el enlace (la versión de antes no lo pone), por la dirección: lo que importa aquí es lo de después.
  if (pagina.url().replace(BASE, '') !== '/avance/trabajos/nueva') await ir(pagina, `${BASE}/avance/trabajos/nueva`)
  await pagina.locator('#descripcion').fill(`Cabina de pintura ${sello}`)
  await pagina.locator('#trabajo').fill(`${marca} trabajo de prueba del banco`)
  await pagina.getByRole('button', { name: 'Registrar el trabajo' }).click()
  await hasta(trabajos, (l) => l.length === 1, 30000)
  const [t] = await trabajos()
  await pagina.waitForURL((u) => u.pathname === `/avance/trabajos/${t?.id}`, { timeout: 20000 }).catch(() => {})
  await quieta(pagina)
  const queda = await idaQueNoSalio(pagina)
  comprobar(pagina.url().replace(BASE, '') === `/avance/trabajos/${t?.id}` && queda === '' && (await mismoDocumento(pagina)),
    `[Supervisión 1280] 1z-rechazo-del-trabajo. el trabajo que sí entra va a su pantalla y el rechazo de arriba ya no está (${pagina.url().replace(BASE, '')}, «${queda}»)`)
  comprobar(errores.length === 0, `[Supervisión 1280] 1z-rechazo-del-trabajo. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// La condición de partida: la persona se queda en el formulario y el rechazo
// va junto a su botón, como siempre; arriba no se dice.
if (corre('1z-rechazo-que-se-queda')) {
  const razon = `QA_Z1Q_${sello}`
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/clientes`)
  await marcarDocumento(pagina)
  const boton = await clienteLleno(pagina, razon, rucDe1x(7).slice(0, 10))
  corte.marca = razon
  await boton.click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await pagina.waitForTimeout(800)
  corte.soltar()
  const junto = await hasta(() => pagina.locator('main [role="alert"]').allInnerTexts().then((l) => limpio(l.join(' '))), (t) => t.includes('El RUC debe tener 11 dígitos.'), 15000)
  await pagina.waitForTimeout(1500)
  const arriba = await idaQueNoSalio(pagina)
  comprobar(pagina.url().replace(BASE, '') === '/clientes/nuevo' && junto.includes('El RUC debe tener 11 dígitos.') && arriba === '' && (await pagina.inputValue('[name="razon_social"]')) === razon && (await mismoDocumento(pagina)),
    `[Administración 1280] 1z-rechazo-que-se-queda. sin pedir otra pantalla, el rechazo va en el formulario, con lo escrito, y arriba nada («${junto}», arriba «${arriba}»)`)
  comprobar(errores.length === 0, `[Administración 1280] 1z-rechazo-que-se-queda. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// La línea de otro documento y la OT cerrada en vuelo: si la persona pidió
// Órdenes, la OT no va a su tarjeta y la línea se queda; si se queda en
// Cotización y solo tocó la pantalla, el encabezado dice la OT y la línea se va.
if (corre('1z-la-ot-y-la-linea')) {
  const cots = await aprobadasSinOt(2)
  const libres = await numerosLibres(2)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  if (cots.length < 2 || libres.length < 2) {
    comprobar(false, `[Administración 1280] 1z-la-ot-y-la-linea. hay dos cotizaciones aprobadas sin OT y dos números libres`)
  } else {
    await ir(pagina, `${BASE}/clientes`)
    await marcarDocumento(pagina)
    for (const [i, pide] of [[0, 'ordenes'], [1, 'nada']]) {
      const cot = cots[i]
      // La línea: el cliente entra después de pedir Órdenes.
      const razon = `QA_Z1L${i}_${sello}`
      const boton = await clienteLleno(pagina, razon, rucDe1x(8 + i))
      corte.marca = razon
      await boton.click()
      await hasta(() => corte.retenidas, (n) => n > 0, 30000)
      await (await enlaceVisible(pagina, '/ordenes')).click()
      await pagina.waitForTimeout(1000)
      corte.soltar()
      await hasta(() => clientePor(razon), (l) => l.length === 1, 30000)
      await pagina.waitForURL((u) => u.pathname === '/ordenes', { timeout: 20000 }).catch(() => {})
      const linea = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('El cliente quedó registrado.'), 15000)
      await porElMenu(pagina, '/cotizaciones/pdf')
      await pagina.locator('a[href="/cotizaciones/pdf?estado=APROBADA_SIN_OT"]').first().click()
      await pagina.waitForURL((u) => u.search === '?estado=APROBADA_SIN_OT', { timeout: 20000 }).catch(() => {})
      await quieta(pagina)
      // La OT va retenida, su ventana se cierra y la persona pide Órdenes, o solo toca la pantalla.
      const marca = `QA_Z1L${i}O_${sello}`
      const ventana = await llenarLaOt(pagina, cot.id, `${marca}/26`, libres[i])
      corte.marca = marca
      await ventana.guardar.click()
      await hasta(() => corte.retenidas, (n) => n > 0, 30000)
      await ventana.d.getByRole('button', { name: 'Cerrar', exact: true }).click()
      await hasta(() => pagina.getByRole('dialog').count(), (n) => n === 0, 5000)
      if (pide === 'ordenes') await (await enlaceVisible(pagina, '/ordenes')).click()
      else await pagina.locator('main h1').first().click()
      await pagina.waitForTimeout(1000)
      corte.soltar()
      await hasta(() => otDe(cot.id), (n) => n === 1, 30000)
      if (pide === 'ordenes') await pagina.waitForURL((u) => u.pathname === '/ordenes', { timeout: 20000 }).catch(() => {})
      await pagina.waitForTimeout(3000)
      const donde = pagina.url().replace(BASE, '')
      const queda = await idaQueNoSalio(pagina)
      const encabezado = limpio(await pagina.locator('[data-estado-del-encabezado]').innerText().catch(() => ''))
      await pagina.screenshot({ path: join(CAPTURAS, `pestana-vieja-1z-la-ot-y-la-linea-${pide}.png`) })
      if (pide === 'ordenes') {
        comprobar(linea === 'El cliente quedó registrado. Ver el cliente' && donde === '/ordenes' && queda === linea && (await otDe(cot.id)) === 1 && (await mismoDocumento(pagina)),
          `[Administración 1280] 1z-la-ot-y-la-linea. la OT entra después de pedir Órdenes: abre Órdenes y la línea del cliente se queda, porque nada la reemplaza (${donde}, «${queda}», OT ${await otDe(cot.id)})`)
      } else {
        comprobar(donde === '/cotizaciones/pdf?estado=APROBADA_SIN_OT' && encabezado.includes(`Se cargó el código y la OT de la cotización ${cot.numero}.`) && queda === '' && (await mismoDocumento(pagina)),
          `[Administración 1280] 1z-la-ot-y-la-linea. la OT entra con la persona en Cotización: el encabezado la dice y la línea del cliente se va (${donde}, «${encabezado}», «${queda}»)`)
      }
    }
  }
  comprobar(errores.length === 0, `[Administración 1280] 1z-la-ot-y-la-linea. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1za. Lo que la cuadragésima segunda pasada dejó en pie de la ida
// El trabajo que entra y cuya respuesta llega como un 502 de la pasarela, con
// la persona ya en otra pantalla: arriba decía «El trabajo no se guardó»
// aunque la base lo tenía, y «Volver al trabajo nuevo» llevaba a registrarlo
// dos veces (H1 de funcionalidad). Dice que no se sabe, como sin respuesta.
const FALLO_DEL_SERVIDOR = 'El servidor no pudo completar el envío. Mira si quedó guardado; si se repite, vuelve a cargar la pantalla o avisa al administrador.'
if (corre('1za-502-con-la-persona-fuera')) {
  const marca = `QA_ZA5_${sello}`
  const trabajos = () => consulta(`select id from flota_unidades where trabajo like $1`, [`${marca}%`])
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.mtz, { width: 1280, height: 900 }, { compilacion: true })
  await ir(pagina, `${BASE}/avance/trabajos/nueva`)
  await marcarDocumento(pagina)
  await pagina.locator('#descripcion').fill(`Cabina de pintura ${sello}`)
  await pagina.locator('#trabajo').fill(`${marca} trabajo de prueba del banco`)
  corte.marca = marca
  await pagina.getByRole('button', { name: 'Registrar el trabajo' }).click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await (await enlaceVisible(pagina, '/reportes-diarios')).click()
  await pagina.waitForTimeout(800)
  // Entra en la base, y la respuesta llega como un 502.
  corte.romper = marca
  corte.soltar()
  await pagina.waitForURL((u) => u.pathname === '/reportes-diarios', { timeout: 20000 }).catch(() => {})
  const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('se guardó'), 15000)
  await pagina.waitForTimeout(1500)
  const donde = pagina.url().replace(BASE, '')
  const tono = await tonoDeLaLinea(pagina)
  const aLaVista = await lineaALaVista(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1za-502-con-la-persona-fuera.png') })
  comprobar(corte.rotas === 1 && donde === '/reportes-diarios' && dice === `No se sabe si el trabajo se guardó. ${FALLO_DEL_SERVIDOR} Volver al trabajo nuevo` && tono === 'rechazo' && aLaVista && (await trabajos()).length === 1 && (await mismoDocumento(pagina)),
    `[Supervisión 1280] 1za-502-con-la-persona-fuera. el trabajo entra y su respuesta llega como un 502 después de tocar el menú: arriba dice que no se sabe si se guardó, no que no se guardó (${donde}, «${dice}», ${tono}, a la vista ${aLaVista}, ${(await trabajos()).length} trabajos, ${corte.rotas} rotas)`)
  // Lo que el 502 anota en la consola es lo que se prueba.
  const propios = errores.filter((e) => !/502|Bad Gateway|unexpected response/i.test(e))
  comprobar(propios.length === 0, `[Supervisión 1280] 1za-502-con-la-persona-fuera. sin otros errores de consola${propios.length ? `: ${propios[0]}` : ''}`)
  await contexto.close()
}

// «Registrar unidad» en la orden nueva: React dejaba subir el envío de la
// ventana por el portal hasta el formulario de la orden, y la orden entraba
// con ella, sin su unidad y con el número del papel gastado (R3 de
// realización). Y el envío de esa ventana, salga bien o no, no se lleva el
// rechazo de la orden que dice la línea de arriba: solo el de la orden (H2 de
// funcionalidad y R2 de realización).
if (corre('1za-la-ventana-de-la-orden')) {
  const tomado = await numeroTomado()
  const [libre] = await numerosLibres(1)
  const marca = `QA_ZAV_${sello}`
  const placa = `ZV${sello.slice(-4)}`
  const ordenes = () => consulta(`select id from ordenes_trabajo where descripcion like $1`, [`${marca}%`])
  const unidades = () => consulta(`select id from unidades where replace(placa, '-', '') = $1`, [placa])
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  if (!tomado || !libre) {
    comprobar(false, `[Administración 1280] 1za-la-ventana-de-la-orden. hay una OT de este año para repetir su número y un número libre`)
  } else {
    await ir(pagina, `${BASE}/ordenes/nueva`)
    await marcarDocumento(pagina)
    // La orden rechazada con la persona en Clientes: la línea roja.
    const boton = await ordenLlena(pagina, marca, tomado)
    corte.marca = marca
    await boton.click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await (await enlaceVisible(pagina, '/clientes')).click()
    await pagina.waitForTimeout(800)
    corte.soltar()
    await pagina.waitForURL((u) => u.pathname === '/clientes', { timeout: 20000 }).catch(() => {})
    const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('no se guardó'), 15000)
    const motivo = dice.replace(/ Volver a la orden nueva$/, '')
    await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver a la orden nueva' }).click({ timeout: 5000 }).catch(() => {})
    await pagina.waitForURL((u) => u.pathname === '/ordenes/nueva', { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    // La orden llena otra vez, con un número libre y su PDF, y la unidad desde su ventana.
    const registrar = await ordenLlena(pagina, marca, libre)
    const v = pagina.getByRole('dialog')
    const unidadNueva = async () => {
      await pagina.getByRole('button', { name: 'Nueva unidad', exact: true }).click()
      await v.waitFor()
      await v.locator('#nu-marca').fill('VOLVO')
      await v.locator('#nu-modelo').fill('FMX 440')
      await v.locator('#nu-anio').fill('2020')
      await v.locator('#nu-placa').fill(placa)
      await v.getByRole('button', { name: 'Registrar unidad' }).click()
    }
    await unidadNueva()
    await hasta(unidades, (l) => l.length === 1, 20000)
    await hasta(() => v.count(), (n) => n === 0, 10000)
    await pagina.waitForTimeout(2000)
    const trasLaUnidad = await idaQueNoSalio(pagina)
    const n1 = (await ordenes()).length
    const vivo = await registrar.isEnabled().catch(() => false)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1za-la-ventana-de-la-orden.png') })
    comprobar((await unidades()).length === 1 && n1 === 0 && vivo && trasLaUnidad === motivo && pagina.url().replace(BASE, '') === '/ordenes/nueva' && (await mismoDocumento(pagina)),
      `[Administración 1280] 1za-la-ventana-de-la-orden. «Registrar unidad» registra la unidad y no la orden, que sigue por enviar, y el rechazo de la orden sigue arriba (${(await unidades()).length} unidades, ${n1} órdenes, botón vivo ${vivo}, «${trasLaUnidad}», ${pagina.url().replace(BASE, '')})`)
    // La misma placa otra vez: la ventana la rechaza, y arriba sigue el de la orden.
    if (n1 === 0) {
      await unidadNueva()
      const enLaVentana = await hasta(() => v.locator('[role="alert"]').allInnerTexts().then((l) => limpio(l.join(' '))), Boolean, 15000)
      const trasElRechazo = await idaQueNoSalio(pagina)
      // Dice cuál placa, no «Ya existe un registro con esos datos» (cuadragésima
      // tercera pasada), en el campo de la placa, con el cursor ahí y dónde está
      // la que ya existe: en «Unidad», detrás de la ventana (D5 de diseño,
      // cuadragésima cuarta pasada).
      const [{ placa: guardada } = {}] = await unidades().then((l) => consulta(`select placa from unidades where id = $1`, [l[0]?.id ?? null]))
      const campoPlaca = await v.locator('#nu-placa').evaluate((e) => ({ invalido: e.getAttribute('aria-invalid'), cursor: document.activeElement === e }))
      comprobar(enLaVentana === `Este cliente ya tiene una unidad con la placa ${guardada}. Elígela en «Unidad», detrás de esta ventana.` && campoPlaca.invalido === 'true' && campoPlaca.cursor && trasElRechazo === motivo && (await unidades()).length === 1 && (await ordenes()).length === 0,
        `[Administración 1280] 1za-la-ventana-de-la-orden. la ventana rechazada dice en el campo de la placa cuál tiene ya el cliente y dónde está, con el cursor ahí, y no se lleva el rechazo de la orden («${enLaVentana}», campo ${JSON.stringify(campoPlaca)}, arriba «${trasElRechazo}»)`)
      await v.getByRole('button', { name: 'Cerrar', exact: true }).click()
      await hasta(() => v.count(), (n) => n === 0, 5000)
      // La orden misma, enviada: entra con su unidad, y el rechazo de arriba se va.
      await registrar.click()
      await hasta(ordenes, (l) => l.length === 1, 30000)
      const [ot] = await ordenes()
      await pagina.waitForURL((u) => u.pathname === `/ordenes/${ot?.id}`, { timeout: 20000 }).catch(() => {})
      await quieta(pagina)
      const alFinal = await idaQueNoSalio(pagina)
      const [conUnidad] = await consulta(`select replace(u.placa, '-', '') placa from ordenes_trabajo o join unidades u on u.id = o.unidad_id where o.id = $1`, [ot?.id ?? null])
      comprobar(new URL(pagina.url()).pathname === `/ordenes/${ot?.id}` && alFinal === '' && conUnidad?.placa === placa,
        `[Administración 1280] 1za-la-ventana-de-la-orden. la orden enviada entra con la unidad nueva y el rechazo de arriba se va (${pagina.url().replace(BASE, '')}, «${alFinal}», unidad ${conUnidad?.placa ?? 'ninguna'})`)
    }
  }
  comprobar(errores.length === 0, `[Administración 1280] 1za-la-ventana-de-la-orden. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// El rechazo de un formulario de pantalla, ni de página entera ni en una
// ventana, con la persona ya en otra: el tipo de cambio de Contabilidad, con
// la venta menor que la compra, no lo decía en ningún lado y lo escrito se
// perdía (Z1 de la crítica). Arriba lo dice, con su nombre.
if (corre('1za-tipo-de-cambio')) {
  const compra = `3.${sello.slice(-4)}`
  const filas = () => consulta(`select id from tipos_de_cambio where compra = $1`, [compra])
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.contabilidad, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/tesoreria/tipo-de-cambio`)
  await marcarDocumento(pagina)
  await pagina.locator('#tc-compra').fill(compra)
  await pagina.locator('#tc-venta').fill('1.0001')
  corte.marca = compra
  await pagina.getByRole('button', { name: 'Guardar cambio' }).click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await (await enlaceVisible(pagina, '/adquisiciones')).click()
  await pagina.waitForTimeout(800)
  corte.soltar()
  await pagina.waitForURL((u) => u.pathname === '/adquisiciones', { timeout: 20000 }).catch(() => {})
  const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('no se guardó'), 15000)
  await pagina.waitForTimeout(1500)
  const donde = pagina.url().replace(BASE, '')
  const tono = await tonoDeLaLinea(pagina)
  const aLaVista = await lineaALaVista(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1za-tipo-de-cambio.png') })
  comprobar(donde === '/adquisiciones' && dice === 'El tipo de cambio no se guardó. El cambio de venta no puede ser menor que el de compra. Volver al tipo de cambio' && tono === 'rechazo' && aLaVista && (await filas()).length === 0 && (await mismoDocumento(pagina)),
    `[Contabilidad 1280] 1za-tipo-de-cambio. el tipo de cambio rechazado después de tocar el menú lo dice arriba, a la vista, en rojo y con el camino de vuelta (${donde}, «${dice}», ${tono}, a la vista ${aLaVista})`)
  await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver al tipo de cambio' }).click({ timeout: 5000 }).catch(() => {})
  await pagina.waitForURL((u) => u.pathname === '/tesoreria/tipo-de-cambio', { timeout: 20000 }).catch(() => {})
  await quieta(pagina)
  const alVolver = await idaQueNoSalio(pagina)
  comprobar(pagina.url().replace(BASE, '') === '/tesoreria/tipo-de-cambio' && alVolver === dice.replace(/ Volver al tipo de cambio$/, ''),
    `[Contabilidad 1280] 1za-tipo-de-cambio. de vuelta en el tipo de cambio dice el motivo, sin el enlace (${pagina.url().replace(BASE, '')}, «${alVolver}»)`)
  comprobar(errores.length === 0, `[Contabilidad 1280] 1za-tipo-de-cambio. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// Uno sin nombre propio: la regla de tardanzas de RR. HH., guardada como
// estaba, cuya respuesta no llega con la persona ya en otra pantalla. Arriba
// se dice que no se sabe si lo que envió se guardó, con el camino de vuelta
// (`SI_SE_VA_DE_LA_PANTALLA`).
if (corre('1za-lo-que-enviaste')) {
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.rrhh, { width: 1280, height: 900 }, { compilacion: true })
  await ir(pagina, `${BASE}/rrhh/tardanzas`)
  await marcarDocumento(pagina)
  corte.marca = 'tolerancia_minutos'
  await pagina.getByRole('button', { name: 'Guardar la regla' }).click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await (await enlaceVisible(pagina, '/rrhh/horas-extras')).click()
  await pagina.waitForTimeout(800)
  corte.perder = 'tolerancia_minutos'
  corte.soltar()
  await pagina.waitForURL((u) => u.pathname === '/rrhh/horas-extras', { timeout: 20000 }).catch(() => {})
  const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('se guardó'), 15000)
  await pagina.waitForTimeout(1500)
  const donde = pagina.url().replace(BASE, '')
  const tono = await tonoDeLaLinea(pagina)
  const aLaVista = await lineaALaVista(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1za-lo-que-enviaste.png') })
  comprobar(corte.perdidas === 1 && donde === '/rrhh/horas-extras' && dice === 'No se sabe si lo que enviaste se guardó. No llegó la respuesta. Revisa la conexión y mira si quedó guardado antes de volver a intentar. Volver adonde lo enviaste' && tono === 'rechazo' && aLaVista && (await mismoDocumento(pagina)),
    `[RR. HH. 1280] 1za-lo-que-enviaste. la regla cuya respuesta no llega después de tocar el menú dice arriba que no se sabe si se guardó, con el camino de vuelta (${donde}, «${dice}», ${tono}, a la vista ${aLaVista}, ${corte.perdidas} perdidas)`)
  await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver adonde lo enviaste' }).click({ timeout: 5000 }).catch(() => {})
  await pagina.waitForURL((u) => u.pathname === '/rrhh/tardanzas', { timeout: 20000 }).catch(() => {})
  await quieta(pagina)
  const alVolver = await idaQueNoSalio(pagina)
  comprobar(pagina.url().replace(BASE, '') === '/rrhh/tardanzas' && alVolver === dice.replace(/ Volver adonde lo enviaste$/, ''),
    `[RR. HH. 1280] 1za-lo-que-enviaste. de vuelta en la regla dice el motivo, sin el enlace (${pagina.url().replace(BASE, '')}, «${alVolver}»)`)
  comprobar(errores.length === 0, `[RR. HH. 1280] 1za-lo-que-enviaste. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1zb. Lo que la cuadragésima tercera pasada dejó en pie de la ida
const diaDeLima = (dias = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date(Date.now() + dias * 86400000))
/** El enlace a `href` que se ve dentro de la ventana, como el que la persona toca. */
async function enlaceALaVista(pagina, href) {
  const enlaces = pagina.locator(`a[href="${href}"]`)
  const i = await enlaces.evaluateAll((l) => l.findIndex((a) => a.checkVisibility() && a.getBoundingClientRect().top >= 0 && a.getBoundingClientRect().bottom <= window.innerHeight))
  return enlaces.nth(Math.max(i, 0))
}

// El gasto de área que ya había quedado la primera vez (la respuesta llegó
// como un 502) y se reenvía con otro importe, con la persona fuera del
// formulario: Atrás y Adelante lo vuelven a montar vacío en la misma
// dirección, o el menú o la otra pestaña de la OT se van con el reenvío en
// camino. El gasto no tiene adónde verlo: la línea volvía al formulario, se
// iba al nacer como lo que llega a su pantalla, y nada decía que lo cambiado
// no se guardó (H1 de funcionalidad, quincuagésima pasada). Ahora se porta
// como el rechazo: en el formulario, sin enlace, y se va con su envío
// siguiente; fuera, con «Volver al gasto».
if (corre('1za-gasto-ya-habia-quedado')) {
  const [ot] = await consulta(`select id from ordenes_trabajo where numero = '0001-2026'`)
  const direccion = `/ordenes/${ot.id}?vista=costos`
  const YA = 'El gasto ya había quedado la primera vez que lo enviaste; lo que cambiaste después no se guardó.'
  const gastos = async (marca) => (await consulta(`select monto::text from ot_gastos_areas where descripcion like $1 order by creado_en`, [`${marca}%`])).map((g) => g.monto)
  // Con `compilacion` se ven las respuestas, y `romper` las vuelve un 502.
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, { width: 1280, height: 900 }, { compilacion: true })
  const abrir = async () => {
    const pliegue = pagina.locator('details').filter({ has: pagina.locator('summary', { hasText: 'Registrar gasto de mi área' }) })
    await pliegue.waitFor({ timeout: 20000 })
    if (!(await pliegue.evaluate((d) => d.open))) await pliegue.locator('summary').click()
    const form = pliegue.locator('form')
    await form.waitFor({ timeout: 10000 })
    return form
  }
  const llenar = async (form, marca, monto) => {
    await form.locator('#gasto-fecha').fill(diaDeLima())
    await form.locator('#gasto-monto').fill(monto)
    await form.locator('#gasto-descripcion').fill(`${marca} gasto de prueba del banco`)
    await form.locator('#gasto-pdf').setInputFiles({ name: `${marca}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`COMPROBANTE ${marca}`, 'Gasto de prueba del banco']) })
  }
  const delFormulario = async (form) => limpio((await form.locator('[role="status"], [role="alert"]').allInnerTexts().catch(() => [])).join(' '))
  // Entra con la respuesta rota y se reenvía con otro importe; el reenvío, retenido.
  const reenviarRetenido = async (marca) => {
    const form = await abrir()
    await llenar(form, marca, '10.00')
    const rotas = corte.rotas
    corte.romper = marca
    await form.getByRole('button', { name: 'Enviar para revisión' }).click()
    await hasta(() => corte.rotas, (n) => n > rotas, 30000)
    const dijo = await hasta(() => delFormulario(form), (t) => t.length > 0, 20000)
    await form.locator('#gasto-monto').fill('11.00')
    const retenidas = corte.retenidas
    corte.marca = marca
    await form.getByRole('button', { name: 'Enviar para revisión' }).click()
    await hasta(() => corte.retenidas, (n) => n > retenidas, 20000)
    return dijo
  }
  try {
    // Atrás y Adelante: la OT por su pestaña, para que no recarguen.
    await ir(pagina, `${BASE}/ordenes/${ot.id}`)
    await marcarDocumento(pagina)
    await (await enlaceVisible(pagina, direccion)).click()
    await pagina.waitForURL((u) => u.pathname + u.search === direccion, { timeout: 20000 })
    await quieta(pagina)
    const marcaA = `QA_ZAG_A_${sello}`
    const primero = await reenviarRetenido(marcaA)
    await pagina.goBack().catch(() => {})
    await pagina.waitForURL((u) => u.pathname + u.search === `/ordenes/${ot.id}`, { timeout: 20000 }).catch(() => {})
    await pagina.waitForTimeout(1500)
    await pagina.goForward().catch(() => {})
    await pagina.waitForURL((u) => u.pathname + u.search === direccion, { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    let form = await abrir()
    const vacio = (await form.locator('#gasto-monto').inputValue()) === ''
    corte.soltar()
    const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.startsWith(YA), 15000)
    await pagina.waitForTimeout(1500)
    const sigue = await idaQueNoSalio(pagina)
    const tono = await tonoDeLaLinea(pagina)
    const aLaVista = await lineaALaVista(pagina)
    const montos = await gastos(marcaA)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1za-gasto-ya-habia-quedado.png') })
    comprobar(primero === FALLO_DEL_SERVIDOR && vacio && dice === YA && sigue === YA && tono === 'ya-habia-quedado' && aLaVista && montos.join() === '10.00' && pagina.url().replace(BASE, '') === direccion && (await mismoDocumento(pagina)),
      `[Diseño 1280] 1za-gasto-ya-habia-quedado. el reenvío cambiado que vuelve con el formulario vuelto a montar por Atrás y Adelante: arriba dice que el primero ya había quedado y lo cambiado no, sin enlace, y no se va sola (primero «${primero}»; vacío ${vacio}; «${sigue}», ${tono}, a la vista ${aLaVista}; ${montos.join(', ')})`)
    // Otro gasto desde el formulario de ahora: entra, y se lleva la línea.
    const marcaB = `QA_ZAG_B_${sello}`
    form = await abrir()
    await llenar(form, marcaB, '12.00')
    await form.getByRole('button', { name: 'Enviar para revisión' }).click()
    const otro = await hasta(() => gastos(marcaB), (l) => l.length === 1, 20000)
    await pagina.waitForTimeout(1500)
    const trasOtro = await idaQueNoSalio(pagina)
    comprobar(otro.join() === '12.00' && trasOtro === '',
      `[Diseño 1280] 1za-gasto-ya-habia-quedado. el gasto siguiente del mismo formulario entra y se lleva la línea (${otro.join(', ')}, línea «${trasOtro}»)`)
    // El menú, con el reenvío en camino: la ida queda en cola hasta que vuelve.
    for (const [cual, irse, adonde] of [
      ['el menú', async () => (await enlaceVisible(pagina, '/')).click(), '/'],
      ['otra pestaña de la OT', async () => (await enlaceVisible(pagina, `/ordenes/${ot.id}?vista=resumen`)).click(), `/ordenes/${ot.id}?vista=resumen`],
    ]) {
      await ir(pagina, `${BASE}${direccion}`)
      const marca = `QA_ZAG_${adonde === '/' ? 'M' : 'P'}_${sello}`
      await reenviarRetenido(marca)
      await irse()
      await pagina.waitForTimeout(800)
      corte.soltar()
      await pagina.waitForURL((u) => u.pathname + u.search === adonde, { timeout: 30000 }).catch(() => {})
      await quieta(pagina)
      const fuera = await hasta(() => idaQueNoSalio(pagina), (t) => t.startsWith(YA), 15000)
      await pagina.waitForTimeout(1000)
      const tonoFuera = await tonoDeLaLinea(pagina)
      const enlace = await pagina.locator('[data-ida-que-no-salio] a').getAttribute('href').catch(() => null)
      const donde = pagina.url().replace(BASE, '')
      comprobar(donde === adonde && fuera === `${YA} Volver al gasto` && tonoFuera === 'ya-habia-quedado' && enlace === direccion && (await gastos(marca)).join() === '10.00',
        `[Diseño 1280] 1za-gasto-ya-habia-quedado. con ${cual} pedido mientras va, arriba lo dice con «Volver al gasto» (${donde}, «${fuera}», ${tonoFuera}, ${enlace})`)
      // Siguiéndolo, en el formulario sigue, sin enlace.
      await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver al gasto' }).click()
      await pagina.waitForURL((u) => u.pathname + u.search === direccion, { timeout: 20000 }).catch(() => {})
      await quieta(pagina)
      await pagina.waitForTimeout(1000)
      const deVuelta = await idaQueNoSalio(pagina)
      comprobar(pagina.url().replace(BASE, '') === direccion && deVuelta === YA,
        `[Diseño 1280] 1za-gasto-ya-habia-quedado. con ${cual}, «Volver al gasto» lleva al formulario y ahí la línea sigue, sin enlace («${deVuelta}»)`)
    }
    // Lo que los 502 anotan en la consola es lo que se prueba.
    const propios = errores.filter((e) => !/502|Bad Gateway|unexpected response/i.test(e))
    comprobar(propios.length === 0, `[Diseño 1280] 1za-gasto-ya-habia-quedado. sin otros errores de consola${propios.length ? `: ${propios[0]}` : ''}`)
  } finally {
    await contexto.close()
  }
}

// «Sin definir», lo que trae la ventana «Nuevo tipo de carrocería», llegaba
// vacío y el enum lo rechazaba con «Invalid input» (H4 de diseño). Entra sin tipo.
if (corre('1zb-carroceria-sin-definir')) {
  const nombre = `QA_ZBC carrocería ${sello}`
  const filas = () => consulta(`select tipo_unidad from tipos_carroceria where nombre = $1`, [nombre])
  const { pagina, contexto, errores } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/ordenes/nueva`)
  await pagina.getByRole('button', { name: 'Nuevo tipo de carrocería' }).click()
  const v = pagina.getByRole('dialog').filter({ hasText: 'Nuevo tipo de carrocería' })
  await v.waitFor({ timeout: 10000 })
  const alAbrir = await v.locator('#ncar-tipo_unidad option:checked').innerText().then(limpio).catch(() => '')
  await v.locator('#ncar-nombre').fill(nombre)
  await v.getByRole('button', { name: 'Agregar al catálogo' }).click()
  const entro = await hasta(filas, (l) => l?.length === 1, 15000)
  await pagina.waitForTimeout(1000)
  const dice = limpio((await v.locator('[role="alert"]').allInnerTexts().catch(() => [])).join(' '))
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zb-carroceria-sin-definir.png') })
  comprobar(alAbrir === 'Sin definir' && entro?.length === 1 && entro[0].tipo_unidad === null && dice === '',
    `[Administración 1280] 1zb-carroceria-sin-definir. el tipo nuevo con «Sin definir», como abre la ventana, entra sin tipo y sin «Invalid input» (abre en «${alAbrir}», ${entro?.length ?? 0} filas, tipo ${entro?.[0]?.tipo_unidad ?? '—'}, «${dice}»)`)
  comprobar(errores.length === 0, `[Administración 1280] 1zb-carroceria-sin-definir. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

/**
 * Una orden en curso con una etapa, y `nuevoPlano(numero, nombre)` para
 * sembrarle planos. Si la orden lleva su equipo de Diseño, el plano lo elaboró
 * uno del banco (`integrante`).
 */
async function ordenParaPlanos() {
  const [orden] = await consulta(`select o.id, e.id as etapa_id, o.plan_etapas_manual from ordenes_trabajo o join ot_etapas e on e.orden_id = o.id
                                  where o.estado not in ('BORRADOR', 'ENTREGADA', 'FACTURADA', 'ANULADA') order by o.numero limit 1`)
  const integrante = orden.plan_etapas_manual
    ? (await consulta(`insert into ot_equipo_diseno (orden_id, nombre, funcion) values ($1, 'QA banco Diseño', 'COLABORADOR')
                       on conflict (orden_id, lower(btrim(nombre))) do update set nombre = excluded.nombre returning id`, [orden.id]))[0].id
    : null
  const nuevoPlano = async (numero, nombre) =>
    (await consulta(`insert into ot_planos (orden_id, numero_plano, nombre, etapa_id, integrante_diseno_id)
                     values ($1, $2, $3, $4, $5) returning id`, [orden.id, numero, nombre, orden.etapa_id, integrante]))[0]
  return { orden, integrante, nuevoPlano }
}

// El plano a dos áreas cuyo PDF llega a una y a la otra no, con la persona ya
// en otra pantalla: arriba decía «La versión del plano no se guardó» y «vuelve
// a enviar sin cambiar el archivo», que ya no se podía, y con las dos marcadas
// otra vez la primera lo recibía repetido (N2 de funcionalidad). Dice, en
// ámbar, a cuál llegó y a cuál volver a enviarla, y haciéndolo no se duplica.
// Es de su plano: la versión de otro plano de la misma orden, enviada antes,
// se la llevaba (F2 de funcionalidad, cuadragésima cuarta pasada).
if (corre('1zb-plano-a-medias')) {
  const { orden, nuevoPlano } = await ordenParaPlanos()
  const plano = await nuevoPlano(`QA-ZBP-${sello}`, 'Plano a medias del banco')
  const otro = await nuevoPlano(`QA-ZBP-B-${sello}`, 'Otro plano de la misma orden')
  const porArea = async (id = plano.id) =>
    Object.fromEntries((await consulta(`select a.nombre, count(*)::int n from ot_plano_versiones v join areas a on a.id = v.area_id where v.plano_id = $1 group by a.nombre`, [id])).map((x) => [x.nombre, x.n]))
  const pdf = { name: `QA-ZBP-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`PLANO QA-ZBP-${sello}`, 'Plano a medias del banco']) }
  const direccion = `/ordenes/${orden.id}/planos?plano=${plano.id}`
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}${direccion}`)
  await marcarDocumento(pagina)
  const archivo = (id = plano.id) => pagina.locator(`#version-archivo-${id}`)
  const formulario = (id = plano.id) => archivo(id).locator('xpath=ancestor::form')
  await archivo().waitFor({ state: 'attached', timeout: 30000 })
  await formulario().getByLabel('Maestranza', { exact: true }).check()
  await formulario().getByLabel('Producción', { exact: true }).check()
  // La primera que sale es la que no llega: la que va primero en la lista.
  const [primera, segunda] = await formulario().locator('input[name="area_id"]:checked').evaluateAll((l) => l.map((c) => c.parentElement.textContent.trim()))
  await archivo().setInputFiles(pdf)
  corte.cortarSubida = 'planos-privados'
  await formulario().getByRole('button', { name: 'Enviar a revisión' }).click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await (await enlaceVisible(pagina, '/')).click()
  await pagina.waitForURL((u) => u.pathname === '/', { timeout: 20000 }).catch(() => {})
  await pagina.waitForTimeout(800)
  corte.soltar()
  await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('llegó a') || t.includes('no se guardó'), 30000)
  await quieta(pagina)
  await pagina.waitForTimeout(1500)
  // Se lee ya en la pantalla pedida: en la del plano, con la ida en cola, la
  // línea nace sin su enlace.
  const dice = await idaQueNoSalio(pagina)
  const donde = pagina.url().replace(BASE, '')
  const tono = await tonoDeLaLinea(pagina)
  const aLaVista = await lineaALaVista(pagina)
  const antes = await porArea()
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zb-plano-a-medias.png') })
  comprobar(donde === '/' && dice === `La versión del plano llegó a ${segunda}. Falta ${primera}: no se pudo cargar el PDF. Vuelve y envíala solo a ${primera}. Volver al plano` && tono === 'a-medias' && aLaVista && antes[segunda] === 1 && !antes[primera] && (await mismoDocumento(pagina)),
    `[Diseño 1280] 1zb-plano-a-medias. el PDF que llega a ${segunda} y no a ${primera} después de tocar el menú lo dice arriba en ámbar, sin «no se guardó», con a cuál volver a enviarla (${donde}, «${dice}», ${tono}, a la vista ${aLaVista}, ${JSON.stringify(antes)})`)
  // Hace lo que dice: vuelve y la envía solo a la que faltó.
  await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver al plano' }).click({ timeout: 5000 }).catch(() => {})
  await pagina.waitForURL((u) => u.pathname + u.search === direccion, { timeout: 20000 }).catch(() => {})
  await archivo().waitFor({ state: 'attached', timeout: 30000 })
  await quieta(pagina)
  const alVolver = await idaQueNoSalio(pagina)
  // Antes, una versión del otro plano de la orden, a la que sí llegó: la línea
  // del primero sigue, porque a ese todavía le falta.
  const tarjetaOtro = pagina.locator(`#plano-${otro.id}`)
  if ((await archivo(otro.id).count()) === 0) await tarjetaOtro.getByRole('button', { name: /^PDF y revisiones/ }).click()
  await archivo(otro.id).waitFor({ state: 'attached', timeout: 15000 })
  await formulario(otro.id).getByLabel(segunda, { exact: true }).check()
  await archivo(otro.id).setInputFiles({ name: `QA-ZBP-B-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`PLANO QA-ZBP-B-${sello}`, 'Otro plano de la misma orden']) })
  await formulario(otro.id).getByRole('button', { name: 'Enviar a revisión' }).click()
  const delOtro = await hasta(() => porArea(otro.id), (x) => x?.[segunda] === 1, 30000)
  await pagina.waitForTimeout(1500)
  const trasElOtro = await idaQueNoSalio(pagina)
  comprobar(alVolver === dice.replace(/ Volver al plano$/, '') && delOtro?.[segunda] === 1 && trasElOtro === alVolver,
    `[Diseño 1280] 1zb-plano-a-medias. de vuelta dice lo mismo sin el enlace, y la versión de otro plano de la orden, que entra, no se lleva la línea del que sigue a medias (otro ${JSON.stringify(delOtro)}, al volver «${alVolver}», tras el otro «${trasElOtro}»)`)
  // Lo que todavía no la completa no se lleva la línea (R18 de realización,
  // cuadragésima séptima pasada): sin marcar ningún área lo frena la validación
  // antes de subir nada, y enviada a la que faltó sin llegar otra vez, con la
  // persona ahí, le sigue faltando.
  const rojoDelFormulario = async () => limpio((await formulario().locator('[role="alert"]').allInnerTexts().catch(() => [])).join(' '))
  await archivo().setInputFiles(pdf)
  await formulario().getByRole('button', { name: 'Enviar a revisión' }).click()
  await hasta(rojoDelFormulario, (t) => t.includes('Marca al menos un área'), 15000)
  await pagina.waitForTimeout(800)
  const avisoSinArea = await rojoDelFormulario()
  const sinArea = await idaQueNoSalio(pagina)
  await formulario().getByLabel(primera, { exact: true }).check()
  await archivo().setInputFiles(pdf)
  const yaRetenidas = corte.retenidas
  corte.cortarSubida = 'planos-privados'
  await formulario().getByRole('button', { name: 'Enviar a revisión' }).click()
  await hasta(() => corte.retenidas, (n) => n > yaRetenidas, 30000)
  corte.soltar()
  await hasta(rojoDelFormulario, (t) => t.startsWith('Falta'), 30000)
  await pagina.waitForTimeout(1500)
  const avisoOtraVez = await rojoDelFormulario()
  const otraVez = await idaQueNoSalio(pagina)
  const trasFallar = await porArea()
  comprobar(avisoSinArea === 'Marca al menos un área que recibirá este PDF.' && sinArea === alVolver && avisoOtraVez.startsWith(`Falta ${primera}`) && otraVez === alVolver && !trasFallar[primera] && trasFallar[segunda] === 1,
    `[Diseño 1280] 1zb-plano-a-medias. lo que todavía no la completa no se lleva la línea: sin área la frena la validación, y a ${primera} otra vez sin llegar le sigue faltando (sin área «${avisoSinArea}», línea «${sinArea}»; otra vez «${avisoOtraVez}», línea «${otraVez}», ${JSON.stringify(trasFallar)})`)
  await formulario().getByLabel(primera, { exact: true }).check()
  await archivo().setInputFiles(pdf)
  await formulario().getByRole('button', { name: 'Enviar a revisión' }).click()
  const despues = await hasta(porArea, (x) => x?.[primera] === 1, 30000)
  await pagina.waitForTimeout(1500)
  const alFinal = await idaQueNoSalio(pagina)
  const enElFormulario = limpio((await formulario().locator('[role="status"]').allInnerTexts().catch(() => [])).join(' '))
  comprobar(despues?.[primera] === 1 && despues?.[segunda] === 1 && alFinal === '' && enElFormulario.includes(`Áreas: ${primera}.`),
    `[Diseño 1280] 1zb-plano-a-medias. enviada solo a ${primera}, cada área tiene una versión, sin duplicar, y la línea se va (${JSON.stringify(despues)}, al final «${alFinal}», «${enElFormulario}»)`)
  // Reenviada a la que faltó y a otra, que llega a la que faltó y a la otra
  // no, con la persona ahí: arriba seguía «Falta ${primera}… envíala solo a
  // ${primera}», y seguirla le mandaba otra revisión. Lo de ahora lo dice el
  // formulario, y reenviado sin cambiar el archivo no se duplica (R21 de
  // realización y F1 de funcionalidad, cuadragésima octava pasada).
  const tercero = await nuevoPlano(`QA-ZBP-C-${sello}`, 'Plano a medias que vuelve a medias')
  const direccionTercero = `/ordenes/${orden.id}/planos?plano=${tercero.id}`
  await ir(pagina, `${BASE}${direccionTercero}`)
  await archivo(tercero.id).waitFor({ state: 'attached', timeout: 30000 })
  await formulario(tercero.id).getByLabel(primera, { exact: true }).check()
  await formulario(tercero.id).getByLabel(segunda, { exact: true }).check()
  const pdfTercero = { name: `QA-ZBP-C-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`PLANO QA-ZBP-C-${sello}`, 'Plano a medias que vuelve a medias']) }
  await archivo(tercero.id).setInputFiles(pdfTercero)
  let retenidasAntes = corte.retenidas
  corte.cortarSubida = 'planos-privados'
  await formulario(tercero.id).getByRole('button', { name: 'Enviar a revisión' }).click()
  await hasta(() => corte.retenidas, (n) => n > retenidasAntes, 30000)
  await (await enlaceVisible(pagina, '/')).click()
  await pagina.waitForURL((u) => u.pathname === '/', { timeout: 20000 }).catch(() => {})
  await pagina.waitForTimeout(800)
  corte.soltar()
  await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('llegó a'), 30000)
  await quieta(pagina)
  await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver al plano' }).click({ timeout: 5000 }).catch(() => {})
  await pagina.waitForURL((u) => u.pathname + u.search === direccionTercero, { timeout: 20000 }).catch(() => {})
  await archivo(tercero.id).waitFor({ state: 'attached', timeout: 30000 })
  await quieta(pagina)
  const aMedias = await idaQueNoSalio(pagina)
  // Otra área, que no es ninguna de las dos: la que se corta esta vez.
  const otra = (await formulario(tercero.id).locator('input[name="area_id"]').evaluateAll((l) => l.map((c) => c.parentElement.textContent.trim())))
    .find((nombre) => nombre !== primera && nombre !== segunda)
  await formulario(tercero.id).getByLabel(primera, { exact: true }).check()
  await formulario(tercero.id).getByLabel(otra, { exact: true }).check()
  await archivo(tercero.id).setInputFiles(pdfTercero)
  const marcadas = await formulario(tercero.id).locator('input[name="area_id"]:checked').evaluateAll((l) => l.map((c) => c.parentElement.textContent.trim()))
  const rojoDelTercero = async () => limpio((await formulario(tercero.id).locator('[role="alert"]').allInnerTexts().catch(() => [])).join(' '))
  retenidasAntes = corte.retenidas
  corte.saltarSubidas = marcadas.indexOf(otra)
  corte.cortarSubida = 'planos-privados'
  await formulario(tercero.id).getByRole('button', { name: 'Enviar a revisión' }).click()
  await hasta(() => corte.retenidas, (n) => n > retenidasAntes, 30000)
  corte.soltar()
  await hasta(rojoDelTercero, (t) => t.startsWith('Enviado a'), 30000)
  await pagina.waitForTimeout(1500)
  const avisoParte = await rojoDelTercero()
  const lineaParte = await idaQueNoSalio(pagina)
  const trasParte = await porArea(tercero.id)
  comprobar(aMedias.startsWith(`La versión del plano llegó a ${segunda}. Falta ${primera}`) && avisoParte.startsWith(`Enviado a ${primera}. Falta ${otra}`) && lineaParte === '' && trasParte[primera] === 1 && trasParte[segunda] === 1 && !trasParte[otra],
    `[Diseño 1280] 1zb-plano-a-medias. reenviada a ${primera} y a ${otra}, que llega a ${primera} y a ${otra} no, la línea de lo que faltaba se va y lo de ahora lo dice el formulario (antes «${aMedias}»; «${avisoParte}», línea «${lineaParte}», ${JSON.stringify(trasParte)})`)
  // Lo de ${primera} va otra vez a la misma ruta, y Storage dice que ya está
  // (400 «Duplicate»): es lo que lo deja sin duplicar, no un error. Se cuenta
  // aparte y sale de los de consola; cualquier otro 400 se queda.
  const yaEstaban = []
  const alResponder = (r) => {
    if (r.request().method() === 'POST' && r.status() === 400 && r.url().includes('/storage/v1/object/planos-privados/')) {
      yaEstaban.push(r.json().then((b) => b?.error ?? null).catch(() => null))
    }
  }
  pagina.on('response', alResponder)
  const erroresAntes = errores.length
  await formulario(tercero.id).getByRole('button', { name: 'Enviar a revisión' }).click()
  const completo = await hasta(() => porArea(tercero.id), (x) => x?.[otra] === 1, 30000)
  await pagina.waitForTimeout(1500)
  pagina.off('response', alResponder)
  const duplicados = (await Promise.all(yaEstaban)).filter((e) => e === 'Duplicate').length
  const delDuplicado = errores.slice(erroresAntes).filter((t) => /status of 400/.test(t)).length
  if (duplicados === 1 && delDuplicado === 1) errores.splice(errores.findIndex((t, i) => i >= erroresAntes && /status of 400/.test(t)), 1)
  const alCompletar = await idaQueNoSalio(pagina)
  comprobar(completo?.[primera] === 1 && completo?.[segunda] === 1 && completo?.[otra] === 1 && alCompletar === '' && duplicados === 1,
    `[Diseño 1280] 1zb-plano-a-medias. reenviada sin cambiar el archivo, ${otra} la recibe y ${primera} no la recibe dos veces: Storage dice que ya estaba (${JSON.stringify(completo)}, línea «${alCompletar}», ${duplicados} «Duplicate», ${delDuplicado} 400 en consola)`)
  // Lo mismo con el formulario plegado mientras sube: «PDF y revisiones» lo
  // desmonta y lo vuelve a montar vacío, en la misma dirección. La línea de lo
  // que faltaba se iba y lo nuevo no lo decía nadie; ahora lo dice arriba (W1
  // de la crítica, cuadragésima novena pasada). Y la que pone ese reenvío se
  // queda: el finally solo quita la que estaba (R22 de realización).
  const cuarto = await nuevoPlano(`QA-ZBP-D-${sello}`, 'Plano a medias que se pliega')
  const direccionCuarto = `/ordenes/${orden.id}/planos?plano=${cuarto.id}`
  await ir(pagina, `${BASE}${direccionCuarto}`)
  await archivo(cuarto.id).waitFor({ state: 'attached', timeout: 30000 })
  await formulario(cuarto.id).getByLabel(primera, { exact: true }).check()
  await formulario(cuarto.id).getByLabel(segunda, { exact: true }).check()
  const pdfCuarto = { name: `QA-ZBP-D-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`PLANO QA-ZBP-D-${sello}`, 'Plano a medias que se pliega']) }
  await archivo(cuarto.id).setInputFiles(pdfCuarto)
  retenidasAntes = corte.retenidas
  corte.cortarSubida = 'planos-privados'
  await formulario(cuarto.id).getByRole('button', { name: 'Enviar a revisión' }).click()
  await hasta(() => corte.retenidas, (n) => n > retenidasAntes, 30000)
  await (await enlaceVisible(pagina, '/')).click()
  await pagina.waitForURL((u) => u.pathname === '/', { timeout: 20000 }).catch(() => {})
  await pagina.waitForTimeout(800)
  corte.soltar()
  await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('llegó a'), 30000)
  await quieta(pagina)
  await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver al plano' }).click({ timeout: 5000 }).catch(() => {})
  await pagina.waitForURL((u) => u.pathname + u.search === direccionCuarto, { timeout: 20000 }).catch(() => {})
  await archivo(cuarto.id).waitFor({ state: 'attached', timeout: 30000 })
  await quieta(pagina)
  const aMediasCuarto = await idaQueNoSalio(pagina)
  await formulario(cuarto.id).getByLabel(primera, { exact: true }).check()
  await formulario(cuarto.id).getByLabel(otra, { exact: true }).check()
  await archivo(cuarto.id).setInputFiles(pdfCuarto)
  const marcadasCuarto = await formulario(cuarto.id).locator('input[name="area_id"]:checked').evaluateAll((l) => l.map((c) => c.parentElement.textContent.trim()))
  const pliegue = pagina.locator(`#plano-${cuarto.id}`).getByRole('button', { name: /^PDF y revisiones/ })
  retenidasAntes = corte.retenidas
  corte.saltarSubidas = marcadasCuarto.indexOf(otra)
  corte.cortarSubida = 'planos-privados'
  await formulario(cuarto.id).getByRole('button', { name: 'Enviar a revisión' }).click()
  await hasta(() => corte.retenidas, (n) => n > retenidasAntes, 30000)
  await pliegue.click()
  await archivo(cuarto.id).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  const plegado = (await archivo(cuarto.id).count()) === 0
  await pliegue.click()
  await archivo(cuarto.id).waitFor({ state: 'attached', timeout: 10000 }).catch(() => {})
  corte.soltar()
  await hasta(() => idaQueNoSalio(pagina), (t) => t.includes(`Falta ${otra}`), 30000)
  await pagina.waitForTimeout(1500)
  const lineaPlegado = await idaQueNoSalio(pagina)
  const tonoPlegado = await tonoDeLaLinea(pagina)
  const rojoReabierto = limpio((await formulario(cuarto.id).locator('[role="alert"]').allInnerTexts().catch(() => [])).join(' '))
  const trasPlegar = await porArea(cuarto.id)
  comprobar(aMediasCuarto.startsWith(`La versión del plano llegó a ${segunda}. Falta ${primera}`) && plegado && lineaPlegado.startsWith(`La versión del plano llegó a ${primera}. Falta ${otra}`) && tonoPlegado === 'a-medias' && rojoReabierto === '' && trasPlegar[primera] === 1 && trasPlegar[segunda] === 1 && !trasPlegar[otra],
    `[Diseño 1280] 1zb-plano-a-medias. reenviada a ${primera} y a ${otra} con el formulario plegado y vuelto a abrir mientras sube, lo que falta ahora lo dice arriba, en ámbar (antes «${aMediasCuarto}»; plegado ${plegado}; línea «${lineaPlegado}», ${tonoPlegado}; formulario «${rojoReabierto}», ${JSON.stringify(trasPlegar)})`)
  // Y el reenvío solo a la que falta que vuelve a fallar entero, plegado o con
  // la persona ya en otra pantalla, no cambia la línea: decía «La versión del
  // plano no se guardó… Vuelve a enviarla», sin a cuál llegó ni «solo a», y
  // con las dos marcadas la primera la recibía otra vez (control del hilo
  // sobre W1, cuadragésima novena pasada).
  const reenviarSoloAOtra = async (sigue, mientrasSube, alVolver = async () => {}) => {
    await formulario(cuarto.id).getByLabel(otra, { exact: true }).check()
    await archivo(cuarto.id).setInputFiles(pdfCuarto)
    retenidasAntes = corte.retenidas
    corte.saltarSubidas = 0
    corte.cortarSubida = 'planos-privados'
    await formulario(cuarto.id).getByRole('button', { name: 'Enviar a revisión' }).click()
    await hasta(() => corte.retenidas, (n) => n > retenidasAntes, 30000)
    await mientrasSube()
    // La subida cortada le llega a la pantalla como fallida: el envío volvió,
    // y lo que la línea diga ya es lo de él.
    const volvio = pagina
      .waitForEvent('requestfailed', { predicate: (r) => r.method() === 'POST' && r.url().includes('/storage/v1/object/planos-privados/'), timeout: 30000 })
      .then(() => true, () => false)
    corte.soltar()
    const cortada = await volvio
    await alVolver()
    // Si cambia, cambia al volver; si no, se mira a los 6 s.
    return { cortada, linea: await hasta(() => idaQueNoSalio(pagina), (t) => t !== sigue, 6000) }
  }
  const plegadaEntera = await reenviarSoloAOtra(lineaPlegado, async () => {
    await pliegue.click()
    await archivo(cuarto.id).waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
    await pliegue.click()
    await archivo(cuarto.id).waitFor({ state: 'attached', timeout: 10000 }).catch(() => {})
  })
  const tonoPlegadaEntera = await tonoDeLaLinea(pagina)
  // La ida a «/» queda en cola hasta que el envío vuelve: se mira ya en «/».
  const fueraEntera = await reenviarSoloAOtra(`${lineaPlegado} Volver al plano`, async () => {
    await (await enlaceVisible(pagina, '/')).click()
    await pagina.waitForTimeout(800)
  }, async () => {
    await pagina.waitForURL((u) => u.pathname === '/', { timeout: 30000 }).catch(() => {})
    await quieta(pagina)
  })
  const fueEnRaiz = new URL(pagina.url()).pathname === '/'
  const tonoFueraEntera = await tonoDeLaLinea(pagina)
  const trasEntera = await porArea(cuarto.id)
  comprobar(plegadaEntera.cortada && plegadaEntera.linea === lineaPlegado && tonoPlegadaEntera === 'a-medias' && fueraEntera.cortada && fueEnRaiz && fueraEntera.linea === `${lineaPlegado} Volver al plano` && tonoFueraEntera === 'a-medias' &&
    trasEntera[primera] === 1 && trasEntera[segunda] === 1 && !trasEntera[otra],
    `[Diseño 1280] 1zb-plano-a-medias. reenviada solo a ${otra} y vuelta a fallar entera, con el formulario plegado o ya en otra pantalla, la línea sigue diciendo a cuál llegó y a cuál volver a enviarla (plegado${plegadaEntera.cortada ? '' : ' (sin ver la subida cortada)'} «${plegadaEntera.linea}», ${tonoPlegadaEntera}; fuera${fueraEntera.cortada ? '' : ' (sin ver la subida cortada)'}${fueEnRaiz ? '' : ' (sin llegar a «/»)'} «${fueraEntera.linea}», ${tonoFueraEntera}; ${JSON.stringify(trasEntera)})`)
  comprobar(errores.length === 0, `[Diseño 1280] 1zb-plano-a-medias. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// El comprobante que entra en borrador porque Storage no acepta su PDF, con la
// persona ya en otra pantalla: arriba decía «El comprobante no se guardó»
// aunque había quedado (R7 de realización). Lo dice como lo dice la acción, en
// ámbar. Storage dice que no por un disparador propio, que se quita al final.
// Completado en su fila, como pide la línea, la línea se va: seguía pidiendo
// completarlo (F1 de funcionalidad y R11 de realización, cuadragésima cuarta
// pasada).
if (corre('1zb-comprobante-en-borrador')) {
  const proveedor = `QA_ZBB proveedor ${sello}`
  const numero = `F777-${sello}`
  const [{ n: ruc } = {}] = await consulta(`select n from (select '20' || lpad($1::text, 8, '0') || d as n from generate_series(0, 9) d) x where public.ruc_es_valido(n) limit 1`, [sello])
  const filas = () => consulta(`select estado from adquisiciones where proveedor = $1`, [proveedor])
  await consulta(`create or replace function public.qa_zbb_storage_dice_que_no() returns trigger language plpgsql security definer set search_path = public as $$
                    begin
                      if exists (select 1 from public.adquisiciones a
                                  where new.name = 'adquisiciones/' || a.id || '/comprobante.pdf' and a.proveedor like 'QA_ZBB proveedor %') then
                        raise exception 'QA_ZBB: Storage no acepta este archivo';
                      end if;
                      return new;
                    end $$`)
  await consulta(`drop trigger if exists qa_zbb_storage_dice_que_no on storage.objects`)
  await consulta(`create trigger qa_zbb_storage_dice_que_no before insert on storage.objects for each row
                    when (new.bucket_id = 'comprobantes-financieros') execute function public.qa_zbb_storage_dice_que_no()`)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.contabilidad, { width: 1280, height: 900 })
  try {
    await ir(pagina, `${BASE}/adquisiciones?vista=facturas`)
    await marcarDocumento(pagina)
    await pagina.locator('#adq-pdf').setInputFiles({ name: `QA-ZBB-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto(['FACTURA ELECTRONICA', numero, 'IMPORTE TOTAL: S/ 59.00']) })
    await hasta(() => pagina.getByText('Leyendo la factura…').count(), (n) => n === 0, 20000)
    await pagina.waitForTimeout(500)
    await pagina.locator('#adq-proveedor').fill(proveedor)
    await pagina.locator('#adq-ruc').fill(ruc ?? '')
    await pagina.locator('#adq-numero').fill(numero)
    await pagina.locator('#adq-emision').fill(diaDeLima())
    await pagina.locator('#adq-total').fill('59.00')
    await pagina.locator('#adq-vencimiento').fill(diaDeLima())
    corte.marca = proveedor
    await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await (await enlaceVisible(pagina, '/tesoreria/tipo-de-cambio')).click()
    await pagina.waitForTimeout(800)
    corte.soltar()
    await pagina.waitForURL((u) => u.pathname === '/tesoreria/tipo-de-cambio', { timeout: 30000 }).catch(() => {})
    const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('borrador') || t.includes('no se guardó'), 30000)
    await pagina.waitForTimeout(1500)
    const donde = pagina.url().replace(BASE, '')
    const tono = await tonoDeLaLinea(pagina)
    const aLaVista = await lineaALaVista(pagina)
    const quedo = await filas()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zb-comprobante-en-borrador.png') })
    comprobar(donde === '/tesoreria/tipo-de-cambio' && dice.startsWith(`El comprobante ${numero} quedó en borrador sin su PDF`) && dice.endsWith(' Volver al comprobante') && !dice.includes('El comprobante no se guardó') && tono === 'a-medias' && aLaVista && quedo.length === 1 && quedo[0].estado === 'BORRADOR' && (await mismoDocumento(pagina)),
      `[Contabilidad 1280] 1zb-comprobante-en-borrador. el comprobante que queda en borrador sin su PDF después de tocar el menú lo dice arriba en ámbar, como quedó, y no «no se guardó» (${donde}, «${dice}», ${tono}, a la vista ${aLaVista}, ${JSON.stringify(quedo)})`)
    // Hace lo que dice: vuelve y lo completa en su fila, ya con Storage de acuerdo.
    await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver al comprobante' }).click({ timeout: 5000 }).catch(() => {})
    await pagina.waitForURL((u) => u.pathname === '/adquisiciones', { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    const alVolver = await idaQueNoSalio(pagina)
    // Otro comprobante desde el mismo formulario, que entra: lo de a medias del
    // primero sigue, porque todavía le falta su PDF. El envío siguiente del
    // formulario se lo llevaba (Y1 de la crítica, cuadragésima quinta pasada).
    const otro = `QA_ZBM proveedor ${sello}`
    await pagina.locator('#adq-tipo').selectOption('OTRO')
    await pagina.locator('#adq-proveedor').fill(otro)
    await pagina.locator('#adq-pdf').setInputFiles({ name: `M777-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`COMPROBANTE M777-${sello}`, 'Prueba del banco']) })
    await hasta(() => pagina.getByText('Leyendo la factura…').count(), (n) => n === 0, 20000)
    await pagina.waitForTimeout(500)
    await pagina.locator('#adq-numero').fill(`M777-${sello}`)
    await pagina.locator('#adq-emision').fill(diaDeLima())
    await pagina.locator('#adq-condicion').selectOption('CREDITO')
    await pagina.locator('#adq-vencimiento').fill(diaDeLima())
    await pagina.locator('#adq-total').fill('100')
    await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
    const delOtro = await hasta(() => consulta(`select estado from adquisiciones where proveedor = $1`, [otro]), (l) => l?.length === 1, 30000)
    await pagina.waitForTimeout(1500)
    const trasElOtro = await idaQueNoSalio(pagina)
    comprobar(delOtro?.length === 1 && delOtro[0].estado === 'REGISTRADA' && trasElOtro === alVolver && alVolver !== '',
      `[Contabilidad 1280] 1zb-comprobante-en-borrador. otro comprobante del mismo formulario, que entra, no se lleva lo de a medias del primero (${JSON.stringify(delOtro)}, al volver «${alVolver}», tras el otro «${trasElOtro}»)`)
    await consulta(`drop trigger if exists qa_zbb_storage_dice_que_no on storage.objects`)
    const fila = pagina.locator('tr, li, article').filter({ hasText: numero }).filter({ has: pagina.getByRole('button', { name: 'Completar comprobante' }) }).filter({ visible: true }).first()
    await fila.locator('input[type="file"][name="pdf"]').setInputFiles({ name: `QA-ZBB-${sello}-b.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto(['FACTURA ELECTRONICA', numero, 'IMPORTE TOTAL: S/ 59.00']) })
    await hasta(() => fila.getByText('Leyendo la factura…').count(), (n) => n === 0, 20000)
    await fila.getByRole('button', { name: 'Completar comprobante' }).click()
    const completo = await hasta(filas, (l) => l?.[0]?.estado !== 'BORRADOR', 30000)
    await pagina.waitForTimeout(1500)
    const alFinal = await idaQueNoSalio(pagina)
    comprobar(alVolver === dice.replace(/ Volver al comprobante$/, '') && completo?.[0]?.estado === 'REGISTRADA' && alFinal === '',
      `[Contabilidad 1280] 1zb-comprobante-en-borrador. de vuelta lo sigue diciendo, y completado en su fila la línea se va (${pagina.url().replace(BASE, '')}, al volver «${alVolver}», ${JSON.stringify(completo)}, al final «${alFinal}»)`)
    comprobar(errores.length === 0, `[Contabilidad 1280] 1zb-comprobante-en-borrador. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  } finally {
    await consulta(`drop trigger if exists qa_zbb_storage_dice_que_no on storage.objects`)
    await consulta(`drop function if exists public.qa_zbb_storage_dice_que_no()`)
    await contexto.close()
  }
}

// El formulario que sigue en pantalla cuando la persona cambia solo la
// búsqueda de la dirección («Por pagar», la sub-vista de Facturas): arriba
// salía su rechazo aunque el formulario seguía a la vista diciéndolo, y como
// era de la dirección de antes, su siguiente envío no lo quitaba (W1 de la
// crítica). Lo dice el formulario, y arriba nada.
if (corre('1zb-subvista')) {
  const numero = `QA-ZBS-${sello}`
  const filas = () => consulta(`select estado from adquisiciones where numero_documento = $1`, [numero])
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.contabilidad, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/adquisiciones?vista=facturas`)
  await marcarDocumento(pagina)
  await pagina.locator('#adq-tipo').selectOption('OTRO')
  await pagina.locator('#adq-proveedor').fill(`QA_ZBS proveedor ${sello}`)
  await pagina.locator('#adq-pdf').setInputFiles({ name: `${numero}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`COMPROBANTE ${numero}`, 'Prueba del banco']) })
  await hasta(() => pagina.getByText('Leyendo la factura…').count(), (n) => n === 0, 20000)
  await pagina.waitForTimeout(500)
  // Lo que el detector haya llenado no importa: se pone lo nuestro. A crédito, con el vencimiento antes de la emisión.
  await pagina.locator('#adq-numero').fill(numero)
  await pagina.locator('#adq-emision').fill(diaDeLima())
  await pagina.locator('#adq-condicion').selectOption('CREDITO')
  await pagina.locator('#adq-vencimiento').fill(diaDeLima(-1))
  await pagina.locator('#adq-total').fill('100')
  corte.marca = numero
  await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await pagina.locator('a[href^="/adquisiciones?vista=por-pagar"]').first().click()
  await pagina.waitForTimeout(800)
  corte.soltar()
  await pagina.waitForURL((u) => u.search.includes('por-pagar'), { timeout: 20000 }).catch(() => {})
  const enElFormulario = () => pagina.locator('#nuevo-comprobante [role="alert"]').allInnerTexts().then((l) => limpio(l.join(' '))).catch(() => '')
  const suAviso = await hasta(enElFormulario, Boolean, 20000)
  await pagina.waitForTimeout(1500)
  const donde = pagina.url().replace(BASE, '')
  const arriba = await idaQueNoSalio(pagina)
  const aLaVista = await pagina.locator('#adq-numero').isVisible()
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zb-subvista.png') })
  comprobar(donde.startsWith('/adquisiciones?vista=por-pagar') && aLaVista && Boolean(suAviso) && arriba === '' && (await filas()).length === 0 && (await mismoDocumento(pagina)),
    `[Contabilidad 1280] 1zb-subvista. el comprobante rechazado después de tocar «Por pagar» lo dice el formulario, que sigue a la vista, y arriba nada (${donde}, formulario «${suAviso}», arriba «${arriba}»)`)
  // Corregido y enviado otra vez desde ahí: entra, y arriba sigue sin nada.
  await pagina.locator('#adq-vencimiento').fill(diaDeLima())
  await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
  const entro = await hasta(filas, (l) => l?.length === 1, 30000)
  await pagina.waitForTimeout(2500)
  const alFinal = await idaQueNoSalio(pagina)
  comprobar(entro?.length === 1 && alFinal === '',
    `[Contabilidad 1280] 1zb-subvista. corregido y registrado desde «Por pagar» entra, y arriba no queda ningún «no se guardó» (${entro?.length ?? 0} comprobantes, arriba «${alFinal}»)`)
  comprobar(errores.length === 0, `[Contabilidad 1280] 1zb-subvista. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// Dos formularios sin nombre propio en la misma pantalla (el informe semanal
// del colaborador de Diseño): el rechazo de la tarea dicho arriba se iba con el
// envío de la entrega (R8 de realización); y con la página bajada, la línea
// llegaba tapada por la barra de arriba (E de la crítica). Cada línea es de su
// formulario, y la que cae bajo la barra sube a la vista.
if (corre('1zb-dos-sin-nombre')) {
  const componente = `QA_ZBD tarea ${sello}`
  const entrega = `QA_ZBD entrega ${sello}`
  const tareas = async () => (await consulta(`select count(*)::int n from diseno_tareas where componente = $1`, [componente]))[0].n
  const entregas = async () => (await consulta(`select count(*)::int n from diseno_entregas_planos where tipo_plano = $1`, [entrega]))[0].n
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.colaborador, { width: 1280, height: 1100 })
  await ir(pagina, `${BASE}/diseno/informe-semanal`)
  await marcarDocumento(pagina)
  // Una OT con colaboradores en su equipo, y la tarea con la entrega antes del inicio: la acción la rechaza sin escribir.
  const tarea = pagina.locator('form', { has: pagina.locator('#tarea-componente') })
  const llenarLaTarea = async () => {
    await elegirOtConColaboradores(pagina, 'tarea')
    await pagina.locator('#tarea-persona').selectOption({ index: 1 })
    await pagina.locator('#tarea-tipo').selectOption({ index: 1 })
    await pagina.locator('#tarea-componente').fill(componente)
    await pagina.locator('#tarea-inicio').fill(diaDeLima())
    await pagina.locator('#tarea-fin').fill(diaDeLima(-1))
    return pagina.locator('#tarea-ot').inputValue()
  }
  const ot = await llenarLaTarea()
  corte.marca = componente
  await tarea.getByRole('button', { name: 'Registrar tarea' }).click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  // La página bajada hasta el final, y el menú.
  await pagina.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await pagina.waitForTimeout(300)
  const bajada = await pagina.evaluate(() => Math.round(window.scrollY))
  await (await enlaceALaVista(pagina, '/')).click()
  await pagina.waitForTimeout(800)
  corte.soltar()
  await pagina.waitForURL((u) => u.pathname === '/', { timeout: 20000 }).catch(() => {})
  const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('no se guardó'), 15000)
  await quieta(pagina)
  await pagina.waitForTimeout(1200)
  const aLaVista = await lineaALaVista(pagina)
  const enY = await pagina.evaluate(() => Math.round(window.scrollY))
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zb-dos-sin-nombre-bajo-la-barra.png') })
  comprobar(/^Lo que enviaste no se guardó\. .+ Volver adonde lo enviaste$/.test(dice) && (await tonoDeLaLinea(pagina)) === 'rechazo' && aLaVista && bajada > 0 && (await mismoDocumento(pagina)),
    `[Diseño colaborador 1280×1100] 1zb-dos-sin-nombre. la tarea rechazada después de tocar el menú con la página bajada (${bajada} px) lo dice arriba, a la vista y no bajo la barra («${dice}», a la vista ${aLaVista}, en ${enY} px)`)
  await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver adonde lo enviaste' }).click({ timeout: 5000 }).catch(() => {})
  await pagina.waitForURL((u) => u.pathname === '/diseno/informe-semanal', { timeout: 20000 }).catch(() => {})
  await quieta(pagina)
  const motivo = dice.replace(/ Volver adonde lo enviaste$/, '')
  const alVolver = await idaQueNoSalio(pagina)
  // La otra: la entrega sin ningún área marcada, que también se rechaza.
  const a0 = corte.acciones
  await pagina.locator('#entrega-ot').selectOption(ot)
  await pagina.locator('#entrega-persona').selectOption({ index: 1 })
  await pagina.locator('#entrega-tipo').fill(entrega)
  await pagina.locator('#entrega-planos').fill('1')
  for (const c of await pagina.locator('input[name="entregado_a"]').all()) if (await c.isChecked()) await c.uncheck()
  const formEntrega = pagina.locator('form', { has: pagina.locator('#entrega-tipo') })
  await formEntrega.getByRole('button', { name: 'Registrar entrega' }).click()
  const suAviso = await hasta(() => formEntrega.locator('[role="alert"]').allInnerTexts().then((l) => limpio(l.join(' '))), Boolean, 20000)
  await pagina.waitForTimeout(1000)
  const trasLaEntrega = await idaQueNoSalio(pagina)
  comprobar(alVolver === motivo && Boolean(suAviso) && trasLaEntrega === motivo && (await entregas()) === 0,
    `[Diseño colaborador 1280×1100] 1zb-dos-sin-nombre. la entrega rechazada en la misma pantalla no se lleva el rechazo de la tarea (${corte.acciones - a0} acciones, entrega «${suAviso}», arriba «${trasLaEntrega}»)`)
  // La tarea misma, enviada otra vez: su línea se va, y su rechazo lo dice el formulario.
  await llenarLaTarea()
  await tarea.getByRole('button', { name: 'Registrar tarea' }).click()
  const suyo = await hasta(() => tarea.locator('[role="alert"]').allInnerTexts().then((l) => limpio(l.join(' '))), Boolean, 20000)
  await pagina.waitForTimeout(1000)
  const alFinal = await idaQueNoSalio(pagina)
  comprobar(Boolean(suyo) && alFinal === '' && (await tareas()) === 0,
    `[Diseño colaborador 1280×1100] 1zb-dos-sin-nombre. la tarea enviada otra vez se lleva su línea y su rechazo va en el formulario (tarea «${suyo}», arriba «${alFinal}»)`)
  comprobar(errores.length === 0, `[Diseño colaborador 1280×1100] 1zb-dos-sin-nombre. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// El PDF de la orden se sube al elegirlo, fuera de `useAccion`: si Storage no
// lo recibe con la persona ya en otra pantalla, no lo decía nadie hasta volver
// a la orden (N3 de funcionalidad). Arriba lo dice, con el camino de vuelta.
// De vuelta en la orden lo dice el campo, y arriba ya no: era el mismo motivo
// dos veces (F5 de funcionalidad). Y el segundo rechazo del mismo PDF, el del
// reintento, con la página bajada, sube a la vista como el primero: quedaba
// debajo de la barra (V1 de la crítica, cuadragésima cuarta pasada).
if (corre('1zb-pdf-de-la-orden')) {
  const [ot] = await consulta(
    `select o.id, o.numero from ordenes_trabajo o
     where not exists (select 1 from ot_adjuntos a where a.orden_id = o.id and a.tipo = 'ORDEN') order by o.numero limit 1`,
  )
  const pdfs = async () => (await consulta(`select count(*)::int n from ot_adjuntos where orden_id = $1 and tipo = 'ORDEN'`, [ot?.id ?? null]))[0].n
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/ordenes/${ot?.id}`)
  const campo = pagina.locator(`input[type="file"]#subir-pdf-${ot?.id}, #subir-pdf-${ot?.id} input[type="file"]`).first()
  if (!ot || (await campo.count()) === 0) {
    comprobar(false, `[Administración 1280] 1zb-pdf-de-la-orden. hay una orden sin PDF que ofrezca subirlo (${ot?.numero ?? 'ninguna'})`)
  } else {
    await marcarDocumento(pagina)
    corte.cortarSubida = 'adjuntos-ot'
    await campo.setInputFiles({ name: `QA-ZBO-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`Orden ${ot.numero}`, `QA_ZBO ${sello}`]) })
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await (await enlaceVisible(pagina, '/clientes')).click()
    await pagina.waitForURL((u) => u.pathname === '/clientes', { timeout: 20000 }).catch(() => {})
    await pagina.waitForTimeout(800)
    corte.soltar()
    const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('no se guardó'), 20000)
    await pagina.waitForTimeout(1500)
    const donde = pagina.url().replace(BASE, '')
    const tono = await tonoDeLaLinea(pagina)
    const aLaVista = await lineaALaVista(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zb-pdf-de-la-orden.png') })
    comprobar(donde === '/clientes' && dice.startsWith('El PDF de la orden no se guardó. ') && dice.endsWith(' Volver a la orden') && tono === 'rechazo' && aLaVista && (await pdfs()) === 0 && (await mismoDocumento(pagina)),
      `[Administración 1280] 1zb-pdf-de-la-orden. el PDF que Storage no recibe después de tocar el menú lo dice arriba, en rojo, a la vista y con el camino de vuelta (${donde}, «${dice}», ${tono}, a la vista ${aLaVista})`)
    await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver a la orden' }).click({ timeout: 5000 }).catch(() => {})
    await pagina.waitForURL((u) => u.pathname === `/ordenes/${ot.id}`, { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    await pagina.waitForTimeout(800)
    const motivo = dice.replace(/^El PDF de la orden no se guardó\. /, '').replace(/ Volver a la orden$/, '')
    const alVolver = await idaQueNoSalio(pagina)
    const enElCampo = limpio(await campo.locator('xpath=..').innerText().catch(() => ''))
    comprobar(new URL(pagina.url()).pathname === `/ordenes/${ot.id}` && alVolver === '' && enElCampo.includes(motivo),
      `[Administración 1280] 1zb-pdf-de-la-orden. de vuelta en la orden el motivo lo dice el campo, y arriba ya no (${pagina.url().replace(BASE, '')}, arriba «${alVolver}», campo «${enElCampo}»)`)
    // Otra vez, como pide el campo, y otra vez se va; ahora baja un poco la lista antes de que vuelva el rechazo.
    const r0 = corte.retenidas
    corte.cortarSubida = 'adjuntos-ot'
    await campo.setInputFiles({ name: `QA-ZBO-${sello}-2.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`Orden ${ot.numero}`, `QA_ZBO ${sello} 2`]) })
    await hasta(() => corte.retenidas, (n) => n > r0, 30000)
    await (await enlaceVisible(pagina, '/ordenes')).click()
    await pagina.waitForURL((u) => u.pathname === '/ordenes', { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    // Next sube la pantalla nueva al llegar: la rueda, antes, se perdía.
    await pagina.waitForTimeout(1500)
    await pagina.mouse.move(640, 500)
    await pagina.mouse.wheel(0, 60)
    await pagina.waitForTimeout(800)
    const bajada = await pagina.evaluate(() => Math.round(window.scrollY))
    corte.soltar()
    const otraVez = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('no se guardó'), 20000)
    await pagina.waitForTimeout(1500)
    const otraVezALaVista = await lineaALaVista(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zb-pdf-de-la-orden-otra-vez.png') })
    comprobar(otraVez === dice && bajada > 0 && otraVezALaVista && (await pdfs()) === 0,
      `[Administración 1280] 1zb-pdf-de-la-orden. el segundo rechazo del mismo PDF, con la lista bajada ${bajada} px, sube a la vista como el primero («${otraVez}», a la vista ${otraVezALaVista})`)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1zb-pdf-de-la-orden. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// El mismo formulario enviado otra vez con otra casilla marcada: se lo
// reconocía por las claves del envío, y una casilla de más lo hacía otro; el
// reenvío entraba y arriba seguía «no se guardó» (R10 de realización,
// cuadragésima cuarta pasada).
if (corre('1zb-otra-casilla')) {
  const entrega = `QA_ZBC entrega ${sello}`
  const entregas = async () => (await consulta(`select count(*)::int n from diseno_entregas_planos where tipo_plano = $1`, [entrega]))[0].n
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.colaborador, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/diseno/informe-semanal`)
  await marcarDocumento(pagina)
  const formEntrega = pagina.locator('form', { has: pagina.locator('#entrega-tipo') })
  const casillas = formEntrega.locator('input[name="entregado_a"]')
  // Una OT con colaboradores en su equipo.
  const llenar = async () => {
    await elegirOtConColaboradores(pagina, 'entrega')
    await pagina.locator('#entrega-persona').selectOption({ index: 1 })
    await pagina.locator('#entrega-tipo').fill(entrega)
    await pagina.locator('#entrega-planos').fill('1')
  }
  // Sin ninguna área marcada: la acción la rechaza sin escribir.
  await llenar()
  for (const c of await casillas.all()) if (await c.isChecked()) await c.uncheck()
  corte.marca = entrega
  await formEntrega.getByRole('button', { name: 'Registrar entrega' }).click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await (await enlaceVisible(pagina, '/')).click()
  await pagina.waitForTimeout(800)
  corte.soltar()
  await pagina.waitForURL((u) => u.pathname === '/', { timeout: 20000 }).catch(() => {})
  const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('no se guardó'), 15000)
  await quieta(pagina)
  const aLaVista = await lineaALaVista(pagina)
  await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver adonde lo enviaste' }).click({ timeout: 5000 }).catch(() => {})
  await pagina.waitForURL((u) => u.pathname === '/diseno/informe-semanal', { timeout: 20000 }).catch(() => {})
  await quieta(pagina)
  const alVolver = await idaQueNoSalio(pagina)
  // Otra vez, ahora con un área: las que vuelvan marcadas o, si no vuelve ninguna, la primera.
  await llenar()
  const marcadas = await casillas.evaluateAll((l) => l.filter((c) => c.checked).length)
  if (marcadas === 0) await casillas.first().check()
  await formEntrega.getByRole('button', { name: 'Registrar entrega' }).click()
  const entro = await hasta(entregas, (n) => n === 1, 30000)
  await pagina.waitForTimeout(1500)
  const alFinal = await idaQueNoSalio(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zb-otra-casilla.png') })
  comprobar(/^Lo que enviaste no se guardó\. .+ Volver adonde lo enviaste$/.test(dice) && aLaVista && alVolver === dice.replace(/ Volver adonde lo enviaste$/, '') && entro === 1 && alFinal === '' && (await mismoDocumento(pagina)),
    `[Diseño colaborador 1280] 1zb-otra-casilla. la entrega rechazada sin áreas, enviada otra vez con ${Math.max(marcadas, 1)} marcada(s), entra y se lleva su línea («${dice}», al volver «${alVolver}», ${entro} entregas, al final «${alFinal}»)`)
  comprobar(errores.length === 0, `[Diseño colaborador 1280] 1zb-otra-casilla. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// Una fila de una lista con su propio envío, rechazado con la persona ya en
// otra pantalla: todas las filas mandan los mismos campos, y quitar otra fila
// se llevaba la línea de la primera, que seguía sin quitarse (la clase de F2
// de funcionalidad, cuadragésima cuarta pasada). Cada fila dice cuál es, y
// solo su propio envío se la lleva. La A se rechaza porque, mientras tanto,
// pasó a ser de otra persona; vuelve a ser suya antes de quitarla otra vez.
if (corre('1zb-otra-fila')) {
  const [a, b] = [`QA_ZBF A ${sello}`, `QA_ZBF B ${sello}`]
  const tarea = (componente) => consulta(`select id, creado_por from diseno_tareas where componente = $1`, [componente])
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.colaborador, { width: 1280, height: 900 })
  try {
    await ir(pagina, `${BASE}/diseno/informe-semanal`)
    const formTarea = pagina.locator('form', { has: pagina.locator('#tarea-componente') })
    // Dos tareas de la semana, registradas por la misma persona.
    for (const componente of [a, b]) {
      await elegirOtConColaboradores(pagina, 'tarea')
      await pagina.locator('#tarea-persona').selectOption({ index: 1 })
      await pagina.locator('#tarea-tipo').selectOption({ index: 1 })
      await pagina.locator('#tarea-componente').fill(componente)
      await pagina.locator('#tarea-inicio').fill(diaDeLima())
      await pagina.locator('#tarea-fin').fill(diaDeLima())
      await formTarea.getByRole('button', { name: 'Registrar tarea' }).click()
      await hasta(() => tarea(componente), (l) => l?.length === 1, 30000)
    }
    const quitar = (componente) => pagina.getByRole('button', { name: `Quitar la tarea ${componente}` })
    await quitar(b).waitFor({ timeout: 20000 })
    await quieta(pagina)
    await marcarDocumento(pagina)
    const [filaA] = await tarea(a)
    await consulta(`update diseno_tareas set creado_por = (select id from usuarios where id <> $2 order by id limit 1) where id = $1`, [filaA.id, filaA.creado_por])
    corte.marca = filaA.id
    await quitar(a).click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await (await enlaceVisible(pagina, '/')).click()
    await pagina.waitForTimeout(800)
    corte.soltar()
    await pagina.waitForURL((u) => u.pathname === '/', { timeout: 20000 }).catch(() => {})
    const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('no se guardó'), 15000)
    await quieta(pagina)
    const aLaVista = await lineaALaVista(pagina)
    await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver adonde lo enviaste' }).click({ timeout: 5000 }).catch(() => {})
    await pagina.waitForURL((u) => u.pathname === '/diseno/informe-semanal', { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    const alVolver = await idaQueNoSalio(pagina)
    // La A vuelve a ser suya. Quitar la B entra y no se lleva la línea de la A.
    await consulta(`update diseno_tareas set creado_por = $2 where id = $1`, [filaA.id, filaA.creado_por])
    await quitar(b).click()
    const sinB = await hasta(() => tarea(b), (l) => l?.length === 0, 30000)
    await quitar(a).waitFor({ timeout: 20000 })
    await pagina.waitForTimeout(1500)
    const trasLaOtra = await idaQueNoSalio(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zb-otra-fila.png') })
    comprobar(/^Lo que enviaste no se guardó\. No se quitó: .+ Volver adonde lo enviaste$/.test(dice) && aLaVista && alVolver === dice.replace(/ Volver adonde lo enviaste$/, '') && sinB?.length === 0 && trasLaOtra === alVolver,
      `[Diseño colaborador 1280] 1zb-otra-fila. quitar otra fila de la lista, que entra, no se lleva la línea de la fila rechazada («${dice}», al volver «${alVolver}», tras la otra «${trasLaOtra}»)`)
    // La A, quitada otra vez: entra y se lleva su línea.
    await quitar(a).click()
    const sinA = await hasta(() => tarea(a), (l) => l?.length === 0, 30000)
    await pagina.waitForTimeout(1500)
    const alFinal = await idaQueNoSalio(pagina)
    comprobar(sinA?.length === 0 && alFinal === '' && (await mismoDocumento(pagina)),
      `[Diseño colaborador 1280] 1zb-otra-fila. la fila rechazada, quitada otra vez, entra y se lleva su línea (${sinA?.length ?? '?'} filas, al final «${alFinal}»)`)
    comprobar(errores.length === 0, `[Diseño colaborador 1280] 1zb-otra-fila. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  } finally {
    await consulta(`delete from diseno_tareas where componente = any($1)`, [[a, b]])
    await contexto.close()
  }
}

// El comprobante rechazado en una pestaña de Facturas, con la persona ya en
// otra pantalla, y corregido de vuelta por el menú, en otra pestaña de la
// lista y sin la OC que había marcado (otros campos: sin «solo una parte»):
// entraba y arriba seguía «no se guardó» (F3 de funcionalidad, cuadragésima
// cuarta pasada). Se reconoce por su ruta y por su nombre, y su envío se la lleva.
if (corre('1zb-otra-pestana-de-la-lista')) {
  const [malo, bueno] = [`QA-ZBL-${sello}`, `QA-ZBL-B-${sello}`]
  const filas = (numero) => consulta(`select estado from adquisiciones where numero_documento = $1`, [numero])
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.contabilidad, { width: 1280, height: 900 })
  const llenar = async (numero, vencimiento) => {
    await pagina.locator('#adq-tipo').selectOption('OTRO')
    await pagina.locator('#adq-proveedor').fill(`QA_ZBL proveedor ${sello}`)
    await pagina.locator('#adq-pdf').setInputFiles({ name: `${numero}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`COMPROBANTE ${numero}`, 'Prueba del banco']) })
    await hasta(() => pagina.getByText('Leyendo la factura…').count(), (n) => n === 0, 20000)
    await pagina.waitForTimeout(500)
    await pagina.locator('#adq-numero').fill(numero)
    await pagina.locator('#adq-emision').fill(diaDeLima())
    await pagina.locator('#adq-condicion').selectOption('CREDITO')
    await pagina.locator('#adq-vencimiento').fill(vencimiento)
    await pagina.locator('#adq-total').fill('100')
  }
  await ir(pagina, `${BASE}/adquisiciones?vista=sin-factura`)
  await marcarDocumento(pagina)
  // Una OC que espera su factura, marcada: suma al formulario «solo una parte».
  const oc = pagina.locator('#nuevo-comprobante input[name="ordenes_compra"]:not([disabled])').first()
  const conOc = (await oc.count()) > 0
  if (conOc) await oc.check()
  await llenar(malo, diaDeLima(-1))
  const camposAntes = await pagina.locator('#adq-numero').evaluate((e) => [...new Set([...e.form.elements].map((x) => x.name).filter(Boolean))].sort().join(','))
  corte.marca = malo
  await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
  await hasta(() => corte.retenidas, (n) => n > 0, 30000)
  await (await enlaceVisible(pagina, '/tesoreria/tipo-de-cambio')).click()
  await pagina.waitForTimeout(800)
  corte.soltar()
  await pagina.waitForURL((u) => u.pathname === '/tesoreria/tipo-de-cambio', { timeout: 30000 }).catch(() => {})
  const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('no se guardó'), 30000)
  await quieta(pagina)
  const aLaVista = await lineaALaVista(pagina)
  // De vuelta por el menú y «Registrar factura»: otra pestaña de la lista.
  await (await enlaceVisible(pagina, '/adquisiciones')).click()
  await pagina.waitForURL((u) => u.pathname === '/adquisiciones', { timeout: 20000 }).catch(() => {})
  await quieta(pagina)
  await (await enlaceVisible(pagina, '/adquisiciones?vista=facturas#nuevo-comprobante')).click()
  await pagina.waitForURL((u) => u.search.includes('vista=facturas'), { timeout: 20000 }).catch(() => {})
  await pagina.locator('#adq-numero').waitFor({ timeout: 20000 })
  await quieta(pagina)
  const alVolver = await idaQueNoSalio(pagina)
  await llenar(bueno, diaDeLima())
  const camposDespues = await pagina.locator('#adq-numero').evaluate((e) => [...new Set([...e.form.elements].map((x) => x.name).filter(Boolean))].sort().join(','))
  await pagina.getByRole('button', { name: 'Registrar comprobante' }).click()
  const entro = await hasta(() => filas(bueno), (l) => l?.length === 1, 30000)
  await pagina.waitForTimeout(2000)
  const alFinal = await idaQueNoSalio(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zb-otra-pestana-de-la-lista.png') })
  comprobar(conOc, `[Contabilidad 1280] 1zb-otra-pestana-de-la-lista. hay una OC que espera su factura para cambiar los campos del formulario`)
  comprobar(dice.startsWith('El comprobante no se guardó. ') && dice.endsWith(' Volver al comprobante') && aLaVista && (await filas(malo)).length === 0 && alVolver === dice &&
    (!conOc || camposAntes !== camposDespues) && entro?.length === 1 && alFinal === '' && (await mismoDocumento(pagina)),
    `[Contabilidad 1280] 1zb-otra-pestana-de-la-lista. el comprobante rechazado en «Sin factura», corregido de vuelta por el menú en «Facturas» con otros campos, entra y se lleva su línea («${dice}», al volver «${alVolver}», campos ${camposAntes === camposDespues ? 'iguales' : 'distintos'}, ${entro?.length ?? 0} comprobantes, al final «${alFinal}»)`)
  comprobar(errores.length === 0, `[Contabilidad 1280] 1zb-otra-pestana-de-la-lista. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1zc. Otro documento en la misma ruta: lo elige la búsqueda
// El plano de un código que no se guarda con la persona ya en otro código, al
// que llegó por un aviso de la campana: solo cambia la búsqueda (?codigo=), y
// Next dejaba montado el formulario. Se quedaba con el N.º y el nombre del
// plano del primero, su rechazo salía junto al botón del otro, y arriba nada
// (X1 de la crítica, cuadragésima quinta pasada). Con otro código todo se
// monta de nuevo: empieza vacío, arriba se dice el rechazo con su camino de
// vuelta, y el plano del otro código, que entra, no se lo lleva (H1 de
// funcionalidad). La subida se corta como cuando se va la señal.
if (corre('1zc-otro-codigo')) {
  const [a, b] = [`QA-ZCA-${sello}`, `QA-ZCB-${sello}`]
  const titulo = `Plano recibido en el banco ${sello}`
  const planos = (codigo) => consulta(`select numero from codigo_planos where codigo_interno = $1 and anulado_en is null`, [codigo])
  const codigoDe = (direccion) => (direccion ? new URL(direccion, BASE).searchParams.get('codigo') : null)
  // Los avisos los dejan los disparadores; este se siembra, con su pantalla.
  await consulta(
    `insert into notificaciones (usuario_id, titulo, cuerpo, ruta) select id, $2, 'Sembrado por probar-pestana-vieja-y-giro', $3 from usuarios where correo = $1`,
    [CUENTAS.diseno, titulo, `/diseno/codigo?codigo=${encodeURIComponent(b)}`],
  )
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, { width: 1280, height: 900 })
  const llenar = async (numero, nombre) => {
    await pagina.locator('#plano-numero').fill(numero)
    await pagina.locator('#plano-nombre').fill(nombre)
    await pagina.locator('#plano-area').selectOption({ index: 1 })
    await pagina.locator('#plano-peso').fill('10')
    await pagina.setInputFiles('#plano-pdf', { name: `${numero}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`PLANO ${numero}`, nombre]) })
  }
  const formPlano = pagina.locator('form', { has: pagina.locator('#plano-numero') })
  try {
    await ir(pagina, `${BASE}/diseno/codigo?codigo=${encodeURIComponent(a)}`)
    await marcarDocumento(pagina)
    await llenar(`ZCA-${sello}`, 'Plano del primer código')
    corte.cortarSubida = 'planos-codigo'
    await formPlano.getByRole('button', { name: 'Cargar plano' }).click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    // Con el PDF subiendo, el aviso de la campana lleva al otro código.
    await pagina.getByRole('button', { name: /^Avisos/ }).first().click()
    await pagina.locator('#panel-avisos').waitFor({ timeout: 10000 })
    await pagina.locator('#panel-avisos li button').filter({ hasText: titulo }).first().click()
    await pagina.waitForURL((u) => u.searchParams.get('codigo') === b, { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    corte.soltar()
    const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('no se guardó'), 30000)
    await pagina.waitForTimeout(1500)
    const donde = pagina.url().replace(BASE, '')
    const enB = [await pagina.locator('#plano-numero').inputValue().catch(() => '?'), await pagina.locator('#plano-nombre').inputValue().catch(() => '?')]
    const junto = limpio((await formPlano.locator('[role="alert"]').allInnerTexts().catch(() => [])).join(' '))
    const enlace = await pagina.locator('[data-ida-que-no-salio] a').getAttribute('href', { timeout: 2000 }).catch(() => null)
    const aLaVista = await lineaALaVista(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zc-otro-codigo.png') })
    comprobar(codigoDe(donde) === b && /^El plano no se guardó\. .+ Volver al plano$/.test(dice) && codigoDe(enlace) === a && aLaVista &&
      enB.join('|') === '|' && junto === '' && (await planos(a)).length === 0 && (await mismoDocumento(pagina)),
      `[Diseño 1280] 1zc-otro-codigo. el plano que no se guarda con la persona ya en otro código lo dice arriba, con el camino al suyo, y el otro código empieza vacío, sin el rechazo junto a su botón (${donde}, «${dice}», enlace ${enlace}, a la vista ${aLaVista}, en el otro «${enB.join('», «')}», junto al botón «${junto}»)`)
    // Un plano del otro código, que entra: no se lleva la línea del primero.
    await llenar(`ZCB-${sello}`, 'Plano del segundo código')
    await formPlano.getByRole('button', { name: 'Cargar plano' }).click()
    const deB = await hasta(() => planos(b), (l) => l?.length === 1, 30000)
    await pagina.waitForTimeout(1500)
    const trasElOtro = await idaQueNoSalio(pagina)
    comprobar(deB?.length === 1 && trasElOtro === dice && (await planos(a)).length === 0,
      `[Diseño 1280] 1zc-otro-codigo. el plano del otro código entra y no se lleva la línea del primero (${deB?.length ?? 0} planos en el otro, ${(await planos(a)).length} en el primero, tras el otro «${trasElOtro}»)`)
    // Hace lo que dice: vuelve a su código, que dice el motivo, y lo carga otra vez.
    await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver al plano' }).click({ timeout: 5000 }).catch(() => {})
    await pagina.waitForURL((u) => u.searchParams.get('codigo') === a, { timeout: 20000 }).catch(() => {})
    await quieta(pagina)
    await pagina.waitForTimeout(1000)
    const alVolver = await idaQueNoSalio(pagina)
    const enA = await pagina.locator('#plano-numero').inputValue().catch(() => '?')
    await llenar(`ZCA-${sello}`, 'Plano del primer código')
    await formPlano.getByRole('button', { name: 'Cargar plano' }).click()
    const deA = await hasta(() => planos(a), (l) => l?.length === 1, 30000)
    await pagina.waitForTimeout(1500)
    const alFinal = await idaQueNoSalio(pagina)
    comprobar(alVolver === dice.replace(/ Volver al plano$/, '') && enA === '' && deA?.length === 1 && alFinal === '' && (await mismoDocumento(pagina)),
      `[Diseño 1280] 1zc-otro-codigo. de vuelta en su código dice el motivo sin el enlace, y cargado otra vez entra y se lleva la línea (${pagina.url().replace(BASE, '')}, al volver «${alVolver}», N.º «${enA}», ${deA?.length ?? 0} planos, al final «${alFinal}»)`)
    comprobar(errores.length === 0, `[Diseño 1280] 1zc-otro-codigo. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  } finally {
    await consulta(`delete from notificaciones where titulo = $1`, [titulo])
    await contexto.close()
  }
}

// El mínimo de un material que no se guarda con la persona ya en la lista del
// kardex, y el de otro material, elegido en «bajo su stock mínimo»: la misma
// ruta con otra búsqueda (?material=), y el que entraba se llevaba la línea
// del primero (R13 de realización, cuadragésima quinta pasada). Cada material
// dice cuál es, y solo su propio envío se la lleva. La base dice que no por un
// disparador propio, que se quita al final con los mínimos de antes.
if (corre('1zc-otro-material')) {
  const [a, b] = await consulta(`select m.id, m.stock_minimo from materiales m
                                 where m.activo and exists (select 1 from v_existencias_materiales e where e.material_id = m.id) order by m.id limit 2`)
  const minimo = async (id) => (await consulta(`select stock_minimo from materiales where id = $1`, [id]))[0]?.stock_minimo ?? null
  await consulta(`create or replace function public.qa_zcm_minimo_dice_que_no() returns trigger language plpgsql set search_path = public as $$
                    begin
                      if new.stock_minimo = 7.777 then
                        raise exception 'El banco no acepta este mínimo (QA_ZCM).';
                      end if;
                      return new;
                    end $$`)
  await consulta(`drop trigger if exists qa_zcm_minimo_dice_que_no on public.materiales`)
  await consulta(`create trigger qa_zcm_minimo_dice_que_no before update of stock_minimo on public.materiales for each row
                    execute function public.qa_zcm_minimo_dice_que_no()`)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.almacen, { width: 1280, height: 900 })
  try {
    // El otro, bajo su mínimo: sale en la lista de los que hay que reponer.
    await consulta(`update materiales set stock_minimo = 99999999 where id = $1`, [b.id])
    await ir(pagina, `${BASE}/almacen/kardex?material=${a.id}`)
    await marcarDocumento(pagina)
    await pagina.locator('#stock-minimo').fill('7.777')
    corte.marca = '7.777'
    await pagina.getByRole('button', { name: 'Guardar mínimo' }).click()
    await hasta(() => corte.retenidas, (n) => n > 0, 30000)
    await (await enlaceVisible(pagina, '/almacen/kardex')).click()
    await pagina.waitForTimeout(800)
    corte.soltar()
    await pagina.waitForURL((u) => u.pathname === '/almacen/kardex' && !u.searchParams.has('material'), { timeout: 20000 }).catch(() => {})
    const dice = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('no se guardó'), 30000)
    await quieta(pagina)
    const aLaVista = await lineaALaVista(pagina)
    // El otro material, desde la lista: quitarle el mínimo entra y no se lleva la línea.
    await (await enlaceVisible(pagina, `/almacen/kardex?material=${b.id}`)).click()
    await pagina.waitForURL((u) => u.searchParams.get('material') === b.id, { timeout: 20000 }).catch(() => {})
    await pagina.locator('#stock-minimo').waitFor({ timeout: 20000 })
    await quieta(pagina)
    const alLlegar = await idaQueNoSalio(pagina)
    await pagina.locator('#stock-minimo').fill('')
    await pagina.getByRole('button', { name: 'Guardar mínimo' }).click()
    const sinMinimo = await hasta(() => minimo(b.id), (m) => m === null, 30000)
    await pagina.waitForTimeout(1500)
    const trasElOtro = await idaQueNoSalio(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zc-otro-material.png') })
    comprobar(/^Lo que enviaste no se guardó\. .+ Volver adonde lo enviaste$/.test(dice) && aLaVista && alLlegar === dice && sinMinimo === null && trasElOtro === dice && (await minimo(a.id)) === a.stock_minimo,
      `[Almacén 1280] 1zc-otro-material. el mínimo de otro material, que entra, no se lleva la línea del que no se guardó («${dice}», a la vista ${aLaVista}, al llegar «${alLlegar}», tras el otro «${trasElOtro}»)`)
    // Hace lo que dice: vuelve a su material, que dice el motivo, y lo guarda otra vez.
    await pagina.locator('[data-ida-que-no-salio]').getByRole('link', { name: 'Volver adonde lo enviaste' }).click({ timeout: 5000 }).catch(() => {})
    await pagina.waitForURL((u) => u.searchParams.get('material') === a.id, { timeout: 20000 }).catch(() => {})
    await pagina.locator('#stock-minimo').waitFor({ timeout: 20000 })
    await quieta(pagina)
    const alVolver = await idaQueNoSalio(pagina)
    await pagina.locator('#stock-minimo').fill('5')
    await pagina.getByRole('button', { name: 'Guardar mínimo' }).click()
    const conMinimo = await hasta(() => minimo(a.id), (m) => Number(m) === 5, 30000)
    await pagina.waitForTimeout(1500)
    const alFinal = await idaQueNoSalio(pagina)
    comprobar(alVolver === dice.replace(/ Volver adonde lo enviaste$/, '') && Number(conMinimo) === 5 && alFinal === '' && (await mismoDocumento(pagina)),
      `[Almacén 1280] 1zc-otro-material. de vuelta en su material dice el motivo sin el enlace, y guardado otra vez entra y se lleva la línea (al volver «${alVolver}», mínimo ${conMinimo}, al final «${alFinal}»)`)
    comprobar(errores.length === 0, `[Almacén 1280] 1zc-otro-material. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  } finally {
    await consulta(`drop trigger if exists qa_zcm_minimo_dice_que_no on public.materiales`)
    await consulta(`drop function if exists public.qa_zcm_minimo_dice_que_no()`)
    for (const m of [a, b]) await consulta(`update materiales set stock_minimo = $2 where id = $1`, [m.id, m.stock_minimo])
    await contexto.close()
  }
}

// «Editar el plano» con la cuenta de Diseño: el formulario no trae quién lo
// elaboró ni la entrega de hoy, y la corrección los pedía como si agregara
// uno: decía «Elige quién elaboró el plano.» y ningún plano se podía corregir
// (D3 de diseño, quincuagésima pasada; venía de main).
if (corre('1zd-editar-el-plano')) {
  const { orden, integrante, nuevoPlano } = await ordenParaPlanos()
  const plano = await nuevoPlano(`QA-ZDE-${sello}`, 'Plano que se corrige')
  const { pagina, contexto, errores } = await entrar(CUENTAS.diseno, { width: 1280, height: 900 })
  await ir(pagina, `${BASE}/ordenes/${orden.id}/planos?plano=${plano.id}`)
  const tarjeta = pagina.locator(`#plano-${plano.id}`)
  await tarjeta.getByRole('button', { name: 'Editar el plano' }).click({ timeout: 30000 })
  const form = tarjeta.locator('form').filter({ has: pagina.locator('input[name="numero_plano"]') })
  await form.waitFor({ timeout: 10000 })
  await form.locator('input[name="nombre"]').fill(`Plano corregido ${sello}`)
  await form.locator('input[name="observacion"]').fill(`Observación corregida ${sello}`)
  await form.getByRole('button', { name: 'Guardar el plano' }).click()
  const [despues] = await hasta(() => consulta(`select nombre, observacion, integrante_diseno_id from ot_planos where id = $1`, [plano.id]), (l) => l?.[0]?.nombre === `Plano corregido ${sello}`, 20000)
  await form.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {})
  const rojo = limpio((await form.locator('[role="alert"]').allInnerTexts().catch(() => [])).join(' '))
  const abierto = await form.count()
  // La pantalla se pinta otra vez un momento después de cerrar el formulario.
  const enLaTarjeta = await hasta(() => tarjeta.innerText().then(limpio), (t) => t.includes(`Plano corregido ${sello}`), 10000)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zd-editar-el-plano.png') })
  comprobar(despues?.nombre === `Plano corregido ${sello}` && despues?.observacion === `Observación corregida ${sello}` && despues?.integrante_diseno_id === integrante && rojo === '' && abierto === 0 && enLaTarjeta.includes(`Plano corregido ${sello}`),
    `[Diseño 1280] 1zd-editar-el-plano. corregido el nombre y la observación, se guarda, sin pedir quién lo elaboró ni cambiarlo, y la tarjeta lo muestra (${JSON.stringify(despues)}, rojo «${rojo}», formulario abierto ${abierto})`)
  comprobar(errores.length === 0, `[Diseño 1280] 1zd-editar-el-plano. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// La corrección del plano se cierra cuando la tarjeta ya muestra lo guardado.
// Se cerraba al contestar la acción, con la tarjeta todavía como antes: vuelta
// a abrir en ese segundo traía lo de antes, y guardarla, aunque fuera solo la
// observación, deshacía la corrección (D1 de diseño, quincuagésima primera
// pasada). Con la página lenta en ponerse al día: mientras guarda, el lápiz
// gira y «Cancelar» se apaga; al cerrarse, la tarjeta ya dice lo nuevo, el
// cursor está en el lápiz y el lector oye «Plano actualizado.». Una segunda
// corrección, vuelta a abrir en cuanto se cierra, trae lo guardado, y
// guardarla con solo la observación no lo deshace (con el código de antes
// volvía al código de la primera).
if (corre('1zd-corregir-y-volver-a-abrir')) {
  const { orden, nuevoPlano } = await ordenParaPlanos()
  const plano = await nuevoPlano(`QA-ZDV-${sello}`, 'Plano que se corrige y se vuelve a abrir')
  const codigo = `QA-ZDV2-${sello}`
  const nombre = `Plano corregido otra vez ${sello}`
  const codigo3 = `QA-ZDV3-${sello}`
  const nombre3 = `Plano corregido por segunda vez ${sello}`
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, { width: 1280, height: 900 })
  try {
    await ir(pagina, `${BASE}/ordenes/${orden.id}/planos?plano=${plano.id}`)
    const tarjeta = pagina.locator(`#plano-${plano.id}`)
    const lapiz = tarjeta.getByRole('button', { name: 'Editar el plano' })
    const form = tarjeta.locator('form').filter({ has: pagina.locator('input[name="numero_plano"]') })
    await lapiz.click({ timeout: 30000 })
    await form.waitFor({ timeout: 10000 })
    await form.locator('input[name="numero_plano"]').fill(codigo)
    await form.locator('input[name="nombre"]').fill(nombre)
    corte.lento = { patron: new RegExp(`/ordenes/${orden.id}/planos`), ms: 6000 }
    const demorados = corte.demorados
    const t0 = Date.now()
    await form.getByRole('button', { name: 'Guardar el plano' }).click()
    const [guardado] = await hasta(() => consulta(`select numero_plano, nombre from ot_planos where id = $1`, [plano.id]), (l) => l?.[0]?.numero_plano === codigo, 20000)
    // La acción ya entró y la página todavía no se pone al día.
    const enVuelo = {
      ms: Date.now() - t0,
      abierto: await form.count(),
      lapiz: await lapiz.getAttribute('aria-disabled', { timeout: 500 }).catch(() => null),
      cancelar: await form.getByRole('button', { name: 'Cancelar' }).isDisabled({ timeout: 500 }).catch(() => null),
    }
    await form.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    const alCerrar = limpio(await tarjeta.innerText())
    const cerro = { ms: Date.now() - t0, demorados: corte.demorados - demorados }
    const [cursor, dicho] = await hasta(
      () => Promise.all([
        pagina.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName ?? ''),
        tarjeta.locator('p[role="status"].sr-only').innerText().then(limpio),
      ]),
      (r) => r?.[0] === 'Editar el plano' && r?.[1] === 'Plano actualizado.', 1000) ?? []
    // Otra corrección, todavía con la página lenta, y vuelta a abrir en cuanto
    // se cierra: trae lo guardado, y guardar solo la observación no lo deshace.
    await lapiz.click()
    await form.waitFor({ timeout: 10000 })
    await form.locator('input[name="numero_plano"]').fill(codigo3)
    await form.locator('input[name="nombre"]').fill(nombre3)
    await form.getByRole('button', { name: 'Guardar el plano' }).click()
    await form.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    await lapiz.click()
    await form.waitFor({ timeout: 10000 })
    const reabierto = { codigo: await form.locator('input[name="numero_plano"]').inputValue(), nombre: await form.locator('input[name="nombre"]').inputValue() }
    corte.lento = null
    await form.locator('input[name="observacion"]').fill(`Solo la observación ${sello}`)
    await form.getByRole('button', { name: 'Guardar el plano' }).click()
    const [final] = await hasta(() => consulta(`select numero_plano, nombre, observacion from ot_planos where id = $1`, [plano.id]), (l) => l?.[0]?.observacion === `Solo la observación ${sello}`, 20000)
    await form.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zd-corregir-y-volver-a-abrir.png') })
    comprobar(guardado?.numero_plano === codigo && enVuelo.abierto === 1 && enVuelo.lapiz === 'true' && enVuelo.cancelar === true,
      `[Diseño 1280] 1zd-corregir-y-volver-a-abrir. con la acción ya entrada y la página sin ponerse al día, la corrección sigue abierta, el lápiz gira y «Cancelar» está apagado (${JSON.stringify(enVuelo)})`)
    comprobar(alCerrar.includes(`Plano ${codigo}`) && alCerrar.includes(nombre),
      `[Diseño 1280] 1zd-corregir-y-volver-a-abrir. al cerrarse, la tarjeta ya dice el código y el nombre nuevos (${JSON.stringify(cerro)}, «${alCerrar.slice(0, 160)}»)`)
    comprobar(cursor === 'Editar el plano' && dicho === 'Plano actualizado.',
      `[Diseño 1280] 1zd-corregir-y-volver-a-abrir. el cursor vuelve al lápiz y el lector oye que se guardó (cursor «${cursor}», dicho «${dicho}»)`)
    comprobar(reabierto.codigo === codigo3 && reabierto.nombre === nombre3 && final?.numero_plano === codigo3 && final?.nombre === nombre3,
      `[Diseño 1280] 1zd-corregir-y-volver-a-abrir. vuelta a abrir enseguida trae lo guardado, y guardar solo la observación no deshace la corrección (abierta con ${JSON.stringify(reabierto)}, en la base ${JSON.stringify(final)})`)
    comprobar(errores.length === 0, `[Diseño 1280] 1zd-corregir-y-volver-a-abrir. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  } finally {
    corte.lento = null
    await contexto.close()
  }
}

// Al cerrarse la corrección de un plano, el cursor vuelve a su lápiz solo si
// quedó sin lugar. Quien ya escribía en otro plano mientras el primero se
// guardaba perdía lo escrito: el cursor saltaba al lápiz del primero, la página
// se movía y cada espacio abría y cerraba su formulario (D1 de diseño,
// quincuagésima segunda pasada). Con la página lenta en ponerse al día: se
// corrige A, se abre B y se escribe en su observación; al cerrarse A, el cursor
// sigue en B, lo escrito está entero y lo que se escribe después también va a B.
if (corre('1zd-cursor-en-otro-plano')) {
  const { orden, nuevoPlano } = await ordenParaPlanos()
  const a = await nuevoPlano(`QA-ZDC-A-${sello}`, 'Plano A que se corrige')
  const b = await nuevoPlano(`QA-ZDC-B-${sello}`, 'Plano B donde se escribe')
  const corregido = `Plano A corregido ${sello}`
  const escrito = `Escrito en B mientras A se guarda ${sello}`
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, { width: 1280, height: 900 })
  try {
    await ir(pagina, `${BASE}/ordenes/${orden.id}/planos?plano=${a.id}`)
    const tarjeta = (p) => pagina.locator(`#plano-${p.id}`)
    const lapiz = (p) => tarjeta(p).getByRole('button', { name: 'Editar el plano' })
    const form = (p) => tarjeta(p).locator('form').filter({ has: pagina.locator('input[name="numero_plano"]') })
    await lapiz(a).click({ timeout: 30000 })
    await form(a).waitFor({ timeout: 10000 })
    await form(a).locator('input[name="nombre"]').fill(corregido)
    corte.lento = { patron: new RegExp(`/ordenes/${orden.id}/planos`), ms: 5000 }
    await form(a).getByRole('button', { name: 'Guardar el plano' }).click()
    await hasta(() => consulta(`select nombre from ot_planos where id = $1`, [a.id]), (l) => l?.[0]?.nombre === corregido, 20000)
    // A ya entró y la página todavía no se pone al día: se pasa a B y se escribe.
    await lapiz(b).click()
    await form(b).waitFor({ timeout: 10000 })
    const observacion = form(b).locator('input[name="observacion"]')
    await observacion.click()
    await observacion.pressSequentially(escrito, { delay: 15 })
    const aSeguiaAbierto = await form(a).count()
    await form(a).waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    await pagina.waitForTimeout(400)
    const cursor = await pagina.evaluate((id) => {
      const e = document.activeElement
      return { nombre: e?.getAttribute('name') ?? e?.getAttribute('aria-label') ?? e?.tagName ?? '', enB: Boolean(e?.closest(`#plano-${id}`)) }
    }, b.id)
    await pagina.keyboard.type(' y sigue', { delay: 15 })
    await pagina.waitForTimeout(300)
    const enB = await observacion.inputValue({ timeout: 2000 }).catch(() => null)
    const aAbierto = await form(a).count()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zd-cursor-en-otro-plano.png') })
    comprobar(aSeguiaAbierto === 1 && cursor.enB && cursor.nombre === 'observacion',
      `[Diseño 1280] 1zd-cursor-en-otro-plano. al cerrarse la corrección de A con la persona escribiendo en B, el cursor se queda en B (A abierto mientras se escribía: ${aSeguiaAbierto}, cursor ${JSON.stringify(cursor)})`)
    comprobar(enB === `${escrito} y sigue` && aAbierto === 0,
      `[Diseño 1280] 1zd-cursor-en-otro-plano. lo escrito en B está entero, lo que sigue también va a B y A no se vuelve a abrir (B «${enB}», A abierto ${aAbierto})`)
    comprobar(errores.length === 0, `[Diseño 1280] 1zd-cursor-en-otro-plano. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  } finally {
    corte.lento = null
    await contexto.close()
  }
}

// Las demás correcciones se cierran con la pantalla ya al día, como el plano:
// `useEnvio` corre su `alTerminar` en la transición que pone la página al día.
// Se cerraban al contestar la acción, con la fila o la cifra de antes; vueltas
// a abrir en ese segundo traían lo de antes, y guardarlas por otro campo
// devolvía a la base lo corregido (F1 de la crítica, quincuagésima segunda
// pasada). Con la página lenta en ponerse al día: mientras guarda, la
// corrección sigue abierta y «Cancelar» está apagado; al cerrarse, la pantalla
// ya dice lo nuevo; vuelta a abrir enseguida trae lo guardado, y guardarla por
// otro campo no deshace la primera. La actividad de la OT (Diseño), la línea de
// material de la OT (Diseño) y lo pactado de un subcontrato (Administración).
async function correccionAlDia({ cuenta, direccion, patron, abrir, formulario, primera, guardar, enBase, pantalla, segunda, vale, cancelar = 'Cancelar', antes, ventana = false, dice = false, retener, teclear }) {
  const { pagina, contexto, errores, corte } = await entrar(cuenta, { width: 1280, height: 900 })
  const dialogo = pagina.locator('[role="dialog"]:not([data-nextjs-dialog])').last()
  try {
    await ir(pagina, `${BASE}${direccion}`)
    await antes?.(pagina)
    const form = formulario(pagina)
    await abrir(pagina).click({ timeout: 30000 })
    await form.waitFor({ timeout: 10000 })
    await primera(form)
    corte.lento = { patron, ms: 6000 }
    const demorados = corte.demorados
    const retenidas = corte.retenidas
    if (teclear) {
      corte.contar = teclear.marca
      corte.contadas = 0
    }
    // `retener`: la acción se detiene antes de salir. La ventana ya está
    // trabada desde que se envía, no desde que contesta: cerrada en vuelo y
    // vuelta a abrir, traía lo de antes.
    if (retener) corte.marca = retener
    const t0 = Date.now()
    await form.getByRole('button', { name: guardar, exact: true }).click()
    let alSalir = null
    if (retener) {
      await hasta(() => corte.retenidas, (n) => n > retenidas, 15000)
      alSalir = {
        retenida: corte.retenidas > retenidas,
        cancelar: await form.getByRole('button', { name: cancelar, exact: true }).isDisabled({ timeout: 500 }).catch(() => null),
        x: await dialogo.getByRole('button', { name: 'Cerrar' }).first().isDisabled({ timeout: 500 }).catch(() => null),
      }
      await pagina.keyboard.press('Escape')
      await pagina.waitForTimeout(300)
      alSalir.trasEscape = await form.count()
      // El fondo, a un costado de la ventana.
      await pagina.mouse.click(5, 450)
      await pagina.waitForTimeout(300)
      alSalir.trasElFondo = await form.count()
      corte.soltar()
    }
    const entro = await hasta(enBase, (f) => f && vale.primera(f), 20000)
    // La acción ya entró y la página todavía no se pone al día.
    const enVuelo = {
      ms: Date.now() - t0,
      abierto: await form.count(),
      cancelar: await form.getByRole('button', { name: cancelar, exact: true }).isDisabled({ timeout: 500 }).catch(() => null),
    }
    // En una ventana, ni Escape ni la X la cierran mientras espera a la
    // pantalla al día; la ventana dice que ya entró (`MientrasSePoneAlDia`),
    // tenga o no `PieDeVentana`.
    if (ventana) {
      enVuelo.x = await dialogo.getByRole('button', { name: 'Cerrar' }).first().isDisabled({ timeout: 500 }).catch(() => null)
      await pagina.keyboard.press('Escape')
      await pagina.waitForTimeout(300)
      enVuelo.trasEscape = await form.count()
      if (dice) enVuelo.dice = limpio(await dialogo.locator('[role="status"]').filter({ hasText: 'Guardado' }).first().innerText({ timeout: 3000 }).catch(() => ''))
    }
    // Ctrl+Enter en un campo de texto (`requestSubmit`, que no mira el botón
    // apagado) no la manda otra vez mientras la página se pone al día.
    if (teclear) {
      await form.locator(teclear.campo).focus()
      await pagina.keyboard.press('Control+Enter')
      await pagina.waitForTimeout(500)
      enVuelo.acciones = corte.contadas
      corte.contar = null
    }
    await form.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    const alCerrar = await pantalla(pagina)
    const cerro = { ms: Date.now() - t0, demorados: corte.demorados - demorados }
    await abrir(pagina).click({ timeout: 10000 })
    await form.waitFor({ timeout: 10000 })
    const reabierto = await vale.leer(form)
    corte.lento = null
    await segunda(form)
    await form.getByRole('button', { name: guardar, exact: true }).click()
    const final = await hasta(enBase, (f) => f && vale.segunda(f), 20000)
    await form.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    return { entro, enVuelo, alSalir, alCerrar, cerro, reabierto, final, errores, pagina }
  } finally {
    corte.lento = null
    await contexto.close()
  }
}

if (corre('1zd-actividad-al-dia')) {
  const [orden] = await consulta(`select id from ordenes_trabajo where estado not in ('BORRADOR', 'ENTREGADA', 'FACTURADA', 'ANULADA') and not plan_etapas_manual order by numero limit 1`)
  const nombre = `QA-ZDA actividad ${sello}`
  // Se siembra con el rol de Diseño, el que arma las actividades.
  let act
  await comoLaCuenta(CUENTAS.diseno, async () => {
    ;[act] = (await base.query(
      `insert into ot_actividades (orden_id, area_id, orden_secuencia, nombre, referencia, peso_pct)
       select $1, a.id, coalesce((select max(orden_secuencia) from ot_actividades where orden_id = $1), 0) + 1, $2, 'QA-ZDA ref de antes', 0
         from areas a where a.codigo = 'ACB' returning id`, [orden.id, nombre])).rows
  })
  const nuevo = { nombre: `${nombre} corregida`, referencia: `QA-ZDA ref corregida ${sello}`, detalle: `QA-ZDA solo el detalle ${sello}` }
  const lapiz = (p) => p.getByRole('button', { name: new RegExp(`^Editar ${nombre}`) })
  const r = await correccionAlDia({
    cuenta: CUENTAS.diseno,
    direccion: `/ordenes/${orden.id}?vista=actividades`,
    patron: new RegExp(`/ordenes/${orden.id}`),
    abrir: lapiz,
    formulario: (p) => p.locator(`#ea-nombre-${act.id}`).locator('xpath=ancestor::form'),
    primera: async (f) => {
      await f.locator('input[name="nombre"]').fill(nuevo.nombre)
      await f.locator('input[name="referencia"]').fill(nuevo.referencia)
    },
    guardar: 'Guardar',
    enBase: async () => (await consulta(`select nombre, referencia, detalle from ot_actividades where id = $1`, [act.id]))[0],
    pantalla: async (p) => limpio(await lapiz(p).locator('xpath=ancestor::*[self::li or self::tr][1]').innerText().catch(() => '')),
    segunda: (f) => f.locator('input[name="detalle"]').fill(nuevo.detalle),
    vale: {
      primera: (f) => f.nombre === nuevo.nombre,
      segunda: (f) => f.detalle === nuevo.detalle,
      leer: async (f) => ({ nombre: await f.locator('input[name="nombre"]').inputValue(), referencia: await f.locator('input[name="referencia"]').inputValue() }),
    },
  })
  comprobar(r.entro && r.enVuelo.abierto === 1 && r.enVuelo.cancelar === true,
    `[Diseño 1280] 1zd-actividad-al-dia. con la acción ya entrada y la página sin ponerse al día, la corrección sigue abierta y «Cancelar» está apagado (${JSON.stringify(r.enVuelo)})`)
  comprobar(r.alCerrar.includes(nuevo.nombre),
    `[Diseño 1280] 1zd-actividad-al-dia. al cerrarse, la fila ya dice el nombre nuevo (${JSON.stringify(r.cerro)}, «${r.alCerrar.slice(0, 160)}»)`)
  comprobar(r.reabierto.nombre === nuevo.nombre && r.reabierto.referencia === nuevo.referencia && r.final?.nombre === nuevo.nombre && r.final?.referencia === nuevo.referencia,
    `[Diseño 1280] 1zd-actividad-al-dia. vuelta a abrir enseguida trae lo guardado, y guardar solo el detalle no deshace la corrección (abierta con ${JSON.stringify(r.reabierto)}, en la base ${JSON.stringify(r.final)})`)
  comprobar(r.errores.length === 0, `[Diseño 1280] 1zd-actividad-al-dia. sin errores de consola${r.errores.length ? `: ${r.errores[0]}` : ''}`)
}

if (corre('1zd-material-al-dia')) {
  const [orden] = await consulta(`select id from ordenes_trabajo where estado not in ('BORRADOR', 'ENTREGADA', 'FACTURADA', 'ANULADA') and not plan_etapas_manual order by numero limit 1`)
  const nota = `QA-ZDM línea ${sello}`
  // Con el rol de Diseño, que arma la lista de materiales: un material del
  // catálogo que la OT todavía no tiene (uq_ot_material).
  let linea
  await comoLaCuenta(CUENTAS.diseno, async () => {
    ;[linea] = (await base.query(
      `insert into ot_materiales (orden_id, material_id, cantidad, observacion, area_destino)
       select $1, m.id, 10, $2, 'PRD' from materiales m
        where m.activo and not exists (select 1 from ot_materiales x where x.orden_id = $1 and x.material_id = m.id)
        order by m.codigo limit 1 returning id`, [orden.id, nota])).rows
  })
  const fila = (p) => p.locator('tr, li').filter({ hasText: nota }).last()
  const r = await correccionAlDia({
    cuenta: CUENTAS.diseno,
    direccion: `/ordenes/${orden.id}?vista=materiales`,
    patron: new RegExp(`/ordenes/${orden.id}`),
    abrir: (p) => fila(p).getByRole('button', { name: /^Editar / }),
    formulario: (p) => p.locator(`#cantidad-${linea.id}`).locator('xpath=ancestor::form'),
    ventana: true,
    dice: true,
    primera: (f) => f.locator('input[name="cantidad"]').fill('12.5'),
    guardar: 'Guardar material',
    enBase: async () => (await consulta(`select cantidad::float8 as cantidad, observacion from ot_materiales where id = $1`, [linea.id]))[0],
    pantalla: async (p) => limpio(await fila(p).innerText().catch(() => '')),
    segunda: (f) => f.locator('input[name="observacion"]').fill(`${nota} con nota`),
    vale: {
      primera: (f) => f.cantidad === 12.5,
      segunda: (f) => f.observacion === `${nota} con nota`,
      leer: async (f) => ({ cantidad: await f.locator('input[name="cantidad"]').inputValue() }),
    },
  })
  comprobar(r.entro && r.enVuelo.abierto === 1 && r.enVuelo.cancelar === true && r.enVuelo.x === true && r.enVuelo.trasEscape === 1,
    `[Diseño 1280] 1zd-material-al-dia. con la acción ya entrada y la página sin ponerse al día, la ventana sigue abierta, «Cancelar» y la X están apagados y Escape no la cierra (${JSON.stringify(r.enVuelo)})`)
  // Sin `PieDeVentana`: lo dice la ventana (D2 de diseño, quincuagésima tercera pasada).
  comprobar(r.enVuelo.dice === 'Guardado. Poniendo la pantalla al día…',
    `[Diseño 1280] 1zd-material-al-dia. mientras tanto la ventana dice que ya entró, aunque su pie es propio («${r.enVuelo.dice}»)`)
  comprobar(/12[.,]5/.test(r.alCerrar),
    `[Diseño 1280] 1zd-material-al-dia. al cerrarse, la fila ya dice la cantidad nueva (${JSON.stringify(r.cerro)}, «${r.alCerrar.slice(0, 160)}»)`)
  comprobar(Number(r.reabierto.cantidad) === 12.5 && r.final?.cantidad === 12.5,
    `[Diseño 1280] 1zd-material-al-dia. vuelta a abrir enseguida trae lo guardado, y guardar solo la observación no deshace la corrección (abierta con ${JSON.stringify(r.reabierto)}, en la base ${JSON.stringify(r.final)})`)
  comprobar(r.errores.length === 0, `[Diseño 1280] 1zd-material-al-dia. sin errores de consola${r.errores.length ? `: ${r.errores[0]}` : ''}`)
}

if (corre('1zd-subcontrato-al-dia')) {
  // Se registra con la función de la base y el rol de Administración, nunca ADMIN.
  const id = randomUUID()
  const descripcion = `QA-ZDS subcontrato del banco ${sello}, no es real`
  await comoLaCuenta(CUENTAS.administracion, async () => {
    const [{ id: subcontratista }] = (await base.query(`select id from subcontratistas where activo order by nombre limit 1`)).rows
    await base.query(`select registrar_subcontrato($1, $2, 'PLANTA', $3, 'PEN', 1000, null, null, 'PRD')`, [id, subcontratista, descripcion])
  })
  const r = await correccionAlDia({
    cuenta: CUENTAS.administracion,
    direccion: `/subcontratos/${id}`,
    patron: new RegExp(`/subcontratos/${id}`),
    abrir: (p) => p.locator('[data-corregir-subcontrato]'),
    formulario: (p) => p.locator('#corregir-monto').locator('xpath=ancestor::form'),
    ventana: true,
    dice: true,
    retener: id,
    teclear: { campo: '#corregir-descripcion', marca: id },
    primera: (f) => f.locator('#corregir-monto').fill('1500'),
    guardar: 'Guardar',
    enBase: async () => (await consulta(`select monto::float8 as monto, descripcion from subcontratos where id = $1`, [id]))[0],
    pantalla: async (p) => limpio(await p.locator('main').innerText().catch(() => '')),
    segunda: (f) => f.locator('#corregir-descripcion').fill(`${descripcion}; con la descripción corregida`),
    vale: {
      primera: (f) => f.monto === 1500,
      segunda: (f) => f.descripcion.endsWith('con la descripción corregida'),
      leer: async (f) => ({ monto: await f.locator('#corregir-monto').inputValue() }),
    },
  })
  comprobar(r.entro && r.enVuelo.abierto === 1 && r.enVuelo.cancelar === true && r.enVuelo.x === true && r.enVuelo.trasEscape === 1,
    `[Administración 1280] 1zd-subcontrato-al-dia. con la acción ya entrada y la página sin ponerse al día, la ventana sigue abierta, «Cancelar» y la X están apagados y Escape no la cierra (${JSON.stringify(r.enVuelo)})`)
  comprobar(r.alSalir?.retenida && r.alSalir.cancelar === true && r.alSalir.x === true && r.alSalir.trasEscape === 1 && r.alSalir.trasElFondo === 1,
    `[Administración 1280] 1zd-subcontrato-al-dia. con la acción todavía sin salir, la ventana ya está trabada: ni «Cancelar», ni la X, ni Escape, ni el fondo (${JSON.stringify(r.alSalir)})`)
  comprobar(r.enVuelo.dice === 'Guardado. Poniendo la pantalla al día…',
    `[Administración 1280] 1zd-subcontrato-al-dia. mientras tanto la ventana dice que ya entró, aunque su pie es propio («${r.enVuelo.dice}»)`)
  comprobar(r.enVuelo.acciones === 1,
    `[Administración 1280] 1zd-subcontrato-al-dia. Ctrl+Enter en la descripción no lo manda otra vez mientras la página se pone al día (${r.enVuelo.acciones} acciones)`)
  // Lo pactado y su saldo, los dos primeros montos de la pantalla.
  const montos = r.alCerrar.match(/S\/\s?[\d.,]+/g)?.slice(0, 3) ?? []
  comprobar(montos.length >= 2 && montos.slice(0, 2).every((m) => m.endsWith('1,500.00')),
    `[Administración 1280] 1zd-subcontrato-al-dia. al cerrarse, la pantalla ya dice lo pactado nuevo (${JSON.stringify(r.cerro)}, ${JSON.stringify(montos)})`)
  comprobar(Number(r.reabierto.monto) === 1500 && r.final?.monto === 1500,
    `[Administración 1280] 1zd-subcontrato-al-dia. vuelta a abrir enseguida trae lo guardado, y corregir solo la descripción no devuelve lo pactado a 1000 (abierta con ${JSON.stringify(r.reabierto)}, en la base ${JSON.stringify(r.final)})`)
  comprobar(r.errores.length === 0, `[Administración 1280] 1zd-subcontrato-al-dia. sin errores de consola${r.errores.length ? `: ${r.errores[0]}` : ''}`)
}

// Una corrección con `PieDeVentana` (la cuenta de Tesorería): mientras espera
// a la pantalla al día, la ventana dice «Guardado. Poniendo la pantalla al
// día…» y ni «Cancelar», ni la X, ni Escape la cierran. Al cerrarse, la lista ya
// dice el nombre nuevo, y vuelta a abrir enseguida no lo devuelve al de antes.
if (corre('1zd-cuenta-al-dia')) {
  const id = randomUUID()
  const nombre = `QA-ZDC ${sello}`
  // Con la función de la base y el rol de Tesorería, nunca ADMIN.
  await comoLaCuenta(CUENTAS.tesoreria, async () => {
    await base.query(`select guardar_caja($1, $2, 'EFECTIVO', null, 'PEN', 100, current_date, true, null)`, [id, nombre])
  })
  const corregido = `${nombre} corregida`
  const r = await correccionAlDia({
    cuenta: CUENTAS.tesoreria,
    direccion: '/tesoreria/caja-diaria',
    patron: /\/tesoreria\/caja-diaria/,
    antes: async (p) => {
      const seccion = p.locator('details', { has: p.locator('summary', { hasText: 'Cuentas de Tesorería' }) })
      if (!(await seccion.evaluate((d) => d.open))) await seccion.locator('summary').click()
    },
    abrir: (p) => p.locator(`[data-editar-cuenta^="${nombre}"]`),
    formulario: (p) => p.locator(`#cuenta-${id.slice(0, 8)}-nombre`).locator('xpath=ancestor::form'),
    primera: (f) => f.locator('input[name="nombre"]').fill(corregido),
    guardar: 'Guardar',
    enBase: async () => (await consulta(`select nombre, saldo_inicial::float8 as saldo from cajas where id = $1`, [id]))[0],
    pantalla: async (p) => (await p.locator(`[data-editar-cuenta^="${nombre}"]`).getAttribute('data-editar-cuenta').catch(() => '')) ?? '',
    segunda: (f) => f.locator(`#cuenta-${id.slice(0, 8)}-saldo`).fill('250'),
    vale: {
      primera: (f) => f.nombre === corregido,
      segunda: (f) => f.saldo === 250,
      leer: async (f) => ({ nombre: await f.locator('input[name="nombre"]').inputValue() }),
    },
    ventana: true,
    dice: true,
  })
  comprobar(r.entro && r.enVuelo.abierto === 1 && r.enVuelo.cancelar === true && r.enVuelo.x === true && r.enVuelo.trasEscape === 1,
    `[Tesorería 1280] 1zd-cuenta-al-dia. con la cuenta ya guardada y la página sin ponerse al día, la ventana sigue abierta, «Cancelar» y la X están apagados y Escape no la cierra (${JSON.stringify(r.enVuelo)})`)
  comprobar(r.enVuelo.dice === 'Guardado. Poniendo la pantalla al día…',
    `[Tesorería 1280] 1zd-cuenta-al-dia. mientras tanto la ventana dice que ya entró («${r.enVuelo.dice}»)`)
  comprobar(r.alCerrar === corregido,
    `[Tesorería 1280] 1zd-cuenta-al-dia. al cerrarse, la lista ya dice el nombre nuevo (${JSON.stringify(r.cerro)}, «${r.alCerrar}»)`)
  comprobar(r.reabierto.nombre === corregido && r.final?.nombre === corregido && r.final?.saldo === 250,
    `[Tesorería 1280] 1zd-cuenta-al-dia. vuelta a abrir enseguida trae el nombre guardado, y cambiar solo el saldo no lo devuelve al de antes (abierta con ${JSON.stringify(r.reabierto)}, en la base ${JSON.stringify(r.final)})`)
  comprobar(r.errores.length === 0, `[Tesorería 1280] 1zd-cuenta-al-dia. sin errores de consola${r.errores.length ? `: ${r.errores[0]}` : ''}`)
}

// La cuenta de Tesorería, sembrada con la función de la base y su rol, y lo
// que hace falta para corregirla desde la caja.
async function cuentaDeTesoreria(nombre) {
  const id = randomUUID()
  await comoLaCuenta(CUENTAS.tesoreria, async () => {
    await base.query(`select guardar_caja($1, $2, 'EFECTIVO', null, 'PEN', 100, current_date, true, null)`, [id, nombre])
  })
  const seccion = (p) => p.locator('details', { has: p.locator('summary', { hasText: 'Cuentas de Tesorería' }) })
  const abrirla = async (p) => {
    if (!(await seccion(p).evaluate((d) => d.open))) await seccion(p).locator('summary').click()
    await p.locator(`[data-editar-cuenta^="${nombre}"]`).click({ timeout: 30000 })
    const form = p.locator(`#cuenta-${id.slice(0, 8)}-nombre`).locator('xpath=ancestor::form')
    await form.waitFor({ timeout: 10000 })
    return form
  }
  const abrirSeccion = async (p) => {
    if (!(await seccion(p).evaluate((d) => d.open))) await seccion(p).locator('summary').click()
  }
  return {
    id,
    abrirla,
    abrirSeccion,
    enBase: async () => (await consulta(`select nombre from cajas where id = $1`, [id]))[0]?.nombre ?? null,
    enLista: async (p) => (await p.locator(`[data-editar-cuenta^="${nombre}"]`).getAttribute('data-editar-cuenta', { timeout: 5000 }).catch(() => '')) ?? '',
  }
}
const laVentana = (p) => p.locator('[role="dialog"]:not([data-nextjs-dialog])').last()
const loQueDiceLaVentana = (p) => laVentana(p).locator('[role="status"]').allInnerTexts().then((t) => limpio(t.join(' '))).catch(() => '')

// Si la pantalla tarda más de 8 s en ponerse al día, la ventana trabada lo
// dice. Sin otro envío en camino, ofrece «Volver a cargar», que no pierde lo
// guardado; con otro envío de la pestaña en camino (un alta retenida), dice
// que espera a ese y no ofrece nada, y se cierra cuando ese termina (D3 y D4
// de diseño y H4 de funcionalidad, quincuagésima tercera pasada).
if (corre('1zd-cuenta-tarda')) {
  const nombre = `QA-ZDT ${sello}`
  const cuenta = await cuentaDeTesoreria(nombre)
  const corregido = `${nombre} corregida`
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.tesoreria, { width: 1280, height: 900 })
  try {
    await ir(pagina, `${BASE}/tesoreria/caja-diaria`)
    const form = await cuenta.abrirla(pagina)
    await form.locator('input[name="nombre"]').fill(corregido)
    corte.lento = { patron: /\/tesoreria\/caja-diaria/, ms: 20000 }
    const t0 = Date.now()
    await form.getByRole('button', { name: 'Guardar', exact: true }).click()
    const entro = await hasta(cuenta.enBase, (n) => n === corregido, 20000)
    const primero = await hasta(() => loQueDiceLaVentana(pagina), (t) => t.includes('Guardado'), 3000)
    const tarde = await hasta(() => loQueDiceLaVentana(pagina), (t) => t.includes('tarda en ponerse al día'), 15000)
    const visto = {
      ms: Date.now() - t0,
      abierta: await form.count(),
      cancelar: await form.getByRole('button', { name: 'Cancelar', exact: true }).isDisabled({ timeout: 500 }).catch(() => null),
      boton: await laVentana(pagina).getByRole('button', { name: 'Volver a cargar', exact: true }).isVisible().catch(() => false),
      // La línea, a la vista: debajo de los botones, sin sacarlos de la ventana (D4).
      aLaVista: await laVentana(pagina).locator('[role="status"]', { hasText: 'tarda' }).evaluate((e) => {
        const r = e.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= window.innerHeight
      }).catch(() => null),
    }
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zd-cuenta-tarda.png') })
    comprobar(entro === corregido && primero === 'Guardado. Poniendo la pantalla al día…',
      `[Tesorería 1280] 1zd-cuenta-tarda. guardada, la ventana dice primero que ya entró («${primero}»)`)
    comprobar(tarde === 'Guardado, pero la pantalla tarda en ponerse al día. Si no se cierra sola, vuelve a cargar: lo guardado no se pierde.' && visto.boton && visto.aLaVista && visto.abierta === 1 && visto.cancelar === true,
      `[Tesorería 1280] 1zd-cuenta-tarda. a los 8 s dice que tarda y ofrece «Volver a cargar», a la vista, y la ventana sigue sin cerrarse («${tarde}», ${JSON.stringify(visto)})`)
    corte.lento = null
    // Con el service worker, la recarga no pasa por CDP: se mira la marca.
    await marcarDocumento(pagina)
    await laVentana(pagina).getByRole('button', { name: 'Volver a cargar', exact: true }).click()
    const recargo = await hasta(() => mismoDocumento(pagina), (m) => !m, 15000).then((m) => !m)
    await pagina.waitForLoadState('networkidle').catch(() => {})
    const trasRecargar = await hasta(() => cuenta.enLista(pagina), (t) => t === corregido, 15000)
    comprobar(recargo && trasRecargar === corregido,
      `[Tesorería 1280] 1zd-cuenta-tarda. «Volver a cargar» recarga, y la caja ya dice el nombre guardado («${trasRecargar}»)`)

    // Con otro envío de la pestaña en camino: el alta de una caja chica con su
    // foto del conteo, retenida mientras sube (Next pone en fila las acciones,
    // y un alta retenida en la acción dejaba a la corrección sin salir), y
    // cancelada su ventana (las altas se cancelan en vuelo). Al soltarla, la
    // subida se corta: el alta no entra.
    const alta = `QA-ZDT alta ${sello}`
    await cuenta.abrirSeccion(pagina)
    await pagina.locator('[data-agregar-cuenta]').first().click({ timeout: 30000 })
    const ventanaAlta = laVentana(pagina)
    await ventanaAlta.locator('input[name="nombre"]').fill(alta)
    await ventanaAlta.locator('select[name="tipo"]').selectOption('EFECTIVO')
    await ventanaAlta.locator('input[name="saldo_inicial"]').fill('10')
    await ventanaAlta.locator('input[type="file"]:not([capture])').first().setInputFiles(fotos.a)
    const retenidas = corte.retenidas
    corte.cortarSubida = 'apertura-caja/'
    await ventanaAlta.getByRole('button', { name: 'Agregar la cuenta', exact: true }).click()
    await hasta(() => corte.retenidas, (n) => n > retenidas, 15000)
    const cancelarAlta = ventanaAlta.getByRole('button', { name: 'Cancelar', exact: true })
    const altaCancela = await cancelarAlta.isEnabled({ timeout: 1000 }).catch(() => false)
    await cancelarAlta.click({ timeout: 3000 }).catch(() => {})
    await hasta(() => pagina.locator('[role="dialog"]:not([data-nextjs-dialog])').count(), (n) => n === 0, 5000)
    const otraVez = `${corregido} otra vez`
    const form2 = await cuenta.abrirla(pagina)
    await form2.locator('input[name="nombre"]').fill(otraVez)
    await form2.getByRole('button', { name: 'Guardar', exact: true }).click()
    const entro2 = await hasta(cuenta.enBase, (n) => n === otraVez, 20000)
    const espera = await hasta(() => loQueDiceLaVentana(pagina), (t) => t.includes('otro envío'), 15000)
    const conOtro = {
      abierta: await form2.count(),
      boton: await laVentana(pagina).getByRole('button', { name: 'Volver a cargar', exact: true }).count(),
      lista: await cuenta.enLista(pagina),
    }
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zd-cuenta-tarda-otro-envio.png') })
    corte.soltar()
    await form2.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    const alCerrarse = { abierta: await form2.count(), lista: await cuenta.enLista(pagina), alta: (await consulta(`select count(*)::int n from cajas where nombre = $1`, [alta]))[0].n }
    comprobar(altaCancela && entro2 === otraVez && espera === 'Guardado. La pantalla se pone al día cuando termine el otro envío que va en camino desde esta pestaña.' && conOtro.abierta === 1 && conOtro.boton === 0,
      `[Tesorería 1280] 1zd-cuenta-tarda. con el alta subiendo su foto, la corrección dice que espera a ese envío, sin ofrecer recargar («${espera}», ${JSON.stringify(conOtro)})`)
    comprobar(alCerrarse.abierta === 0 && alCerrarse.lista === otraVez && alCerrarse.alta === 0,
      `[Tesorería 1280] 1zd-cuenta-tarda. al cortarse la subida del alta, la ventana se cierra con la caja al día, y el alta no entró (${JSON.stringify(alCerrarse)})`)
    comprobar(errores.length === 0, `[Tesorería 1280] 1zd-cuenta-tarda. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  } finally {
    corte.lento = null
    corte.soltar()
    await contexto.close()
  }
}

// Tras «No llegó la respuesta» o el 502 de una corrección que sí entró, la
// pantalla se pone al día con la ventana abierta y trabada: no se cancela
// hasta que la caja diga lo que quedó, y vuelta a abrir trae lo guardado. Se
// cancelaba y volvía a abrir con lo de antes, y guardarla por otro campo
// deshacía lo que había entrado (H1 de funcionalidad, quincuagésima tercera).
for (const modo of ['perder', 'romper']) {
  if (!corre(`1zd-cuenta-sin-respuesta-${modo}`)) continue
  const nombre = `QA-ZDR ${modo} ${sello}`
  const cuenta = await cuentaDeTesoreria(nombre)
  const corregido = `${nombre} corregida`
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.tesoreria, { width: 1280, height: 900 }, { compilacion: true })
  // `perder` y `romper` miran la respuesta: piden `compilacion`.
  try {
    await ir(pagina, `${BASE}/tesoreria/caja-diaria`)
    const form = await cuenta.abrirla(pagina)
    await form.locator('input[name="nombre"]').fill(corregido)
    corte.lento = { patron: /\/tesoreria\/caja-diaria/, ms: 6000 }
    const demorados = corte.demorados
    corte[modo] = cuenta.id
    // Con el service worker, una recarga no pasa por CDP: se mira la marca.
    await marcarDocumento(pagina)
    await form.getByRole('button', { name: 'Guardar', exact: true }).click()
    const entro = await hasta(cuenta.enBase, (n) => n === corregido, 20000)
    const aviso = await hasta(() => form.locator('[role="alert"]').allInnerTexts().then((t) => limpio(t.join(' '))), (t) => t.length > 0, 10000)
    const mirando = await hasta(() => loQueDiceLaVentana(pagina), (t) => t.includes('Poniendo la pantalla al día'), 8000)
    const mientras = {
      abierta: await form.count(),
      cancelar: await form.getByRole('button', { name: 'Cancelar', exact: true }).isDisabled({ timeout: 500 }).catch(() => null),
      x: await laVentana(pagina).getByRole('button', { name: 'Cerrar' }).first().isDisabled({ timeout: 500 }).catch(() => null),
      lista: await cuenta.enLista(pagina),
    }
    await pagina.keyboard.press('Escape')
    await pagina.waitForTimeout(300)
    mientras.trasEscape = await form.count()
    // Al ponerse al día, la ventana se suelta, con el aviso, y la caja de
    // detrás ya dice lo que entró.
    const suelta = await hasta(() => form.getByRole('button', { name: 'Cancelar', exact: true }).isEnabled({ timeout: 500 }).catch(() => false), Boolean, 20000)
    const alDia = { suelta, lista: await cuenta.enLista(pagina), demorados: corte.demorados - demorados, mismoDocumento: await mismoDocumento(pagina) }
    await form.getByRole('button', { name: 'Cancelar', exact: true }).click()
    await form.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {})
    const form2 = await cuenta.abrirla(pagina)
    const reabierta = await form2.locator('input[name="nombre"]').inputValue()
    await form2.locator(`#cuenta-${cuenta.id.slice(0, 8)}-saldo`).fill('300')
    await form2.getByRole('button', { name: 'Guardar', exact: true }).click()
    const final = await hasta(() => consulta(`select nombre, saldo_inicial::float8 saldo from cajas where id = $1`, [cuenta.id]).then((f) => f[0]), (f) => f?.saldo === 300, 20000)
    await pagina.screenshot({ path: join(CAPTURAS, `pestana-vieja-1zd-cuenta-sin-respuesta-${modo}.png`) })
    comprobar(entro === corregido && aviso.length > 0 && mirando.includes('Poniendo la pantalla al día…') && mientras.abierta === 1 && mientras.cancelar === true && mientras.x === true && mientras.trasEscape === 1,
      `[Tesorería 1280] 1zd-cuenta-sin-respuesta-${modo}. sin la respuesta, la ventana dice el aviso y que se pone al día, y no se cierra mientras tanto («${aviso}» · «${mirando}», ${JSON.stringify(mientras)})`)
    comprobar(alDia.suelta && alDia.lista === corregido && alDia.demorados > 0 && alDia.mismoDocumento,
      `[Tesorería 1280] 1zd-cuenta-sin-respuesta-${modo}. se suelta con la caja ya al día, sin recargar el documento (${JSON.stringify(alDia)})`)
    comprobar(reabierta === corregido && final?.nombre === corregido && final?.saldo === 300,
      `[Tesorería 1280] 1zd-cuenta-sin-respuesta-${modo}. cancelada y vuelta a abrir trae lo que entró, y cambiar el saldo no la devuelve al nombre de antes (abierta con «${reabierta}», en la base ${JSON.stringify(final)})`)
    // El 502 que el banco pone en la respuesta lo anota el navegador: es el corte, no un error de la pantalla.
    const propios = errores.filter((e) => !/502|Bad Gateway|unexpected response/i.test(e))
    comprobar(propios.length === 0, `[Tesorería 1280] 1zd-cuenta-sin-respuesta-${modo}. sin otros errores de consola${propios.length ? `: ${propios[0]}` : ''}`)
  } finally {
    corte.lento = null
    corte.perder = null
    corte.romper = null
    await contexto.close()
  }
}

// Lo que la corrección que no se sabe si entró mira antes de poner la pantalla
// al día con la ventana abierta (`sePuedePonerAlDia`): en una pestaña de otro
// despliegue, el refresco recarga el documento entero y se llevaba la ventana
// y lo escrito (R34 de realización, quincuagésima cuarta pasada). «vieja»: la
// acción sale con un id que el servidor no conoce, como tras un despliegue que
// cambió los ids; no entra y la pestaña ya lo sabe. «nueva»: el despliegue de
// todos los días (conserva los ids), con la respuesta perdida: la corrección
// entra y la pestaña no lo sabe hasta que el servidor se lo dice al preguntar.
// «con»: el servidor contesta la pregunta; «sin»: no llega (sin conexión), y
// la pantalla tampoco se pone al día (R36). En los cuatro la ventana sigue
// abierta con lo escrito, sin recargar, y se puede cancelar.
async function mirarUnRato(pagina, leer, ms = 8000) {
  const visto = []
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    const v = await leer().catch((e) => ({ error: String(e).slice(0, 80) }))
    visto.push({ ms: Date.now() - t0, ...v })
    await pagina.waitForTimeout(250)
  }
  return visto
}
/** Cada cambio de lo visto, con su momento. */
const cambiosDe = (visto) => {
  const cambios = []
  let antes = ''
  for (const v of visto) {
    const { ms, ...resto } = v
    const clave = JSON.stringify(resto)
    if (clave !== antes) cambios.push(v)
    antes = clave
  }
  return cambios
}
for (const despliegue of ['vieja', 'nueva']) {
  for (const modo of ['con', 'sin']) {
    const parte = `1zd-correccion-otro-despliegue-${despliegue}-${modo}`
    if (!corre(parte)) continue
    const nombre = `QA-ZDO ${despliegue} ${modo} ${sello}`
    const cuenta = await cuentaDeTesoreria(nombre)
    const corregido = `${nombre} escrita`
    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.tesoreria, { width: 1280, height: 900 }, { compilacion: true })
    try {
      await ir(pagina, `${BASE}/tesoreria/caja-diaria`)
      const form = await cuenta.abrirla(pagina)
      await form.locator('input[name="nombre"]').fill(corregido)
      await marcarDocumento(pagina)
      corte.sinSesion = modo === 'sin'
      corte.despliegue = true
      if (despliegue === 'nueva') {
        corte.conservaIds = true
        corte.perder = cuenta.id
      }
      const preguntas = corte.preguntasCortadas
      await form.getByRole('button', { name: 'Guardar', exact: true }).click()
      const visto = await mirarUnRato(pagina, async () => ({
        mismoDocumento: await mismoDocumento(pagina),
        abierta: await form.count(),
        escrito: await form.locator('input[name="nombre"]').inputValue({ timeout: 200 }).catch(() => null),
        aviso: limpio(await laVentana(pagina).locator('[role="alert"]').allInnerTexts().then((t) => t.join(' ')).catch(() => '')).slice(0, 70),
        cancelar: await form.getByRole('button', { name: 'Cancelar', exact: true }).isEnabled({ timeout: 200 }).catch(() => null),
      }))
      const enBase = await cuenta.enBase()
      const arriba = await pagina.locator('[data-pestana-vieja]').getAttribute('data-pestana-vieja').catch(() => null)
      await pagina.screenshot({ path: join(CAPTURAS, `pestana-vieja-${parte}.png`) }).catch(() => {})
      const recargo = visto.find((v) => v.mismoDocumento === false)
      const final = visto.at(-1)
      const resumen = JSON.stringify(cambiosDe(visto)).slice(0, 600)
      comprobar(!recargo && final.abierta === 1 && final.escrito === corregido && final.aviso.length > 0 && final.cancelar === true,
        `[Tesorería 1280] ${parte}. la corrección no recarga la pantalla: la ventana sigue abierta con lo escrito, dice el aviso y se puede cancelar (${resumen})`)
      if (despliegue === 'vieja') {
        comprobar(final.aviso.includes(SE_ACTUALIZO) && enBase === nombre && arriba === 'vieja',
          `[Tesorería 1280] ${parte}. la acción que el servidor ya no conoce no entra, y lo dicen la ventana y el aviso de arriba («${final.aviso}», en la base «${enBase}», arriba ${arriba})`)
      } else {
        // Con la pregunta contestada, la pestaña sabe que es de otro despliegue y lo dice arriba.
        // Si la campana ya lo supo antes, no hace falta preguntar: también vale.
        comprobar(enBase === corregido && (modo === 'con' ? arriba === 'nueva' : corte.preguntasCortadas > preguntas || arriba === 'nueva'),
          `[Tesorería 1280] ${parte}. la corrección entró, y ${modo === 'con' ? 'arriba se dice que hay una versión nueva' : 'la pregunta no llegó al servidor'} (en la base «${enBase}», arriba ${arriba}, preguntas cortadas ${corte.preguntasCortadas - preguntas})`)
      }
      comprobar(errores.length === 0, `[Tesorería 1280] ${parte}. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    } finally {
      corte.despliegue = false
      corte.conservaIds = false
      corte.perder = null
      corte.sinSesion = false
      await contexto.close()
    }
  }
}

// En línea, sin ventana: la nota del paso de la ficha de taller, desde una
// pestaña de antes del despliegue (Administración). No entra, y la nota
// escrita sigue en su campo, sin recargar.
if (corre('1zd-nota-otro-despliegue')) {
  const [orden] = await consulta(`select id from ordenes_trabajo where estado not in ('BORRADOR', 'ENTREGADA', 'FACTURADA', 'ANULADA') order by numero limit 1`)
  let paso
  await comoLaCuenta(CUENTAS.administracion, async () => {
    paso = (await base.query(`insert into ot_verificaciones (orden_id, numero, descripcion, observaciones)
      select $1, coalesce((select max(numero) from ot_verificaciones where orden_id = $1), 0) + 1,
             'QA-ZDO paso ' || $2 || ', no es real', 'QA-ZDO nota de antes'
      returning id, descripcion`, [orden.id, sello])).rows[0]
  })
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 }, { compilacion: true })
  try {
    await ir(pagina, `${BASE}/ordenes/${orden.id}?vista=ficha`)
    const fila = pagina.locator('tr').filter({ hasText: paso.descripcion }).first()
    await fila.getByRole('button', { name: /^(Anotar|Editar) observación$/ }).click({ timeout: 30000 })
    const campo = fila.locator('input[name="observaciones"]')
    await campo.waitFor({ timeout: 10000 })
    const escrita = `QA-ZDO nota larga escrita a mano ${sello}`
    await campo.fill(escrita)
    await marcarDocumento(pagina)
    corte.despliegue = true
    await fila.getByRole('button', { name: 'Guardar nota' }).click()
    const visto = await mirarUnRato(pagina, async () => ({
      mismoDocumento: await mismoDocumento(pagina),
      escrito: await campo.inputValue({ timeout: 200 }).catch(() => null),
      aviso: limpio(await fila.locator('[role="alert"]').allInnerTexts().then((t) => t.join(' ')).catch(() => '')).slice(0, 70),
    }))
    const [{ observaciones }] = await consulta(`select observaciones from ot_verificaciones where id = $1`, [paso.id])
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zd-nota-otro-despliegue.png') }).catch(() => {})
    const recargo = visto.find((v) => v.mismoDocumento === false)
    const final = visto.at(-1)
    comprobar(!recargo && final.escrito === escrita && final.aviso.includes(SE_ACTUALIZO) && observaciones === 'QA-ZDO nota de antes',
      `[Administración 1280] 1zd-nota-otro-despliegue. la nota que no entró no recarga la pantalla, sigue escrita y dice por qué (${JSON.stringify(cambiosDe(visto)).slice(0, 400)}, en la base «${observaciones}»)`)
    comprobar(errores.length === 0, `[Administración 1280] 1zd-nota-otro-despliegue. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  } finally {
    corte.despliegue = false
    await contexto.close()
  }
}

/**
 * La sesión muere con la pantalla abierta: la cookie sigue diciendo la misma
 * cuenta, pero el token venció y el de refresco no vale, como tras un refresco
 * revocado o vencido.
 */
async function matarLaSesion(contexto) {
  const partes = (await contexto.cookies()).filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name))
  if (partes.length === 0) throw new Error('No hay cookie de sesión')
  let texto = decodeURIComponent(partes.map((c) => c.value).join(''))
  if (texto.startsWith('base64-')) texto = Buffer.from(texto.slice(7), 'base64url').toString('utf8')
  const sesion = JSON.parse(texto)
  const ahora = Math.floor(Date.now() / 1000)
  const [cabeza, carga] = sesion.access_token.split('.')
  const vencida = { ...JSON.parse(Buffer.from(carga, 'base64url').toString('utf8')), exp: ahora - 60 }
  sesion.access_token = `${cabeza}.${Buffer.from(JSON.stringify(vencida)).toString('base64url')}.firma-que-no-vale`
  sesion.refresh_token = 'refresco-que-no-vale'
  sesion.expires_at = ahora - 60
  const nombre = partes[0].name.replace(/\.\d+$/, '')
  await contexto.addCookies([
    { ...partes[0], name: nombre, value: `base64-${Buffer.from(JSON.stringify(sesion)).toString('base64url')}` },
    ...partes.filter((c) => c.name !== nombre).map((c) => ({ ...c, value: '', expires: ahora - 10 })),
  ])
}

// La corrección con la sesión ya muerta: la acción no entra y, sin sesión, la
// pantalla no se pone al día con la ventana abierta. El refresco iba a
// /ingresar y se llevaba la ventana y lo escrito, sin decir nada (F1 de la
// crítica, quincuagésima cuarta pasada). Tesorería.
if (corre('1zd-correccion-sin-sesion')) {
  const nombre = `QA-ZDS ${sello}`
  const cuenta = await cuentaDeTesoreria(nombre)
  const escrito = `${nombre} corregida a mano`
  const { pagina, contexto, errores } = await entrar(CUENTAS.tesoreria, { width: 1280, height: 900 })
  try {
    await ir(pagina, `${BASE}/tesoreria/caja-diaria`)
    const form = await cuenta.abrirla(pagina)
    await form.locator('input[name="nombre"]').fill(escrito)
    await marcarDocumento(pagina)
    await matarLaSesion(contexto)
    await form.getByRole('button', { name: 'Guardar', exact: true }).click()
    const visto = await mirarUnRato(pagina, async () => ({
      direccion: new URL(pagina.url()).pathname,
      mismoDocumento: await mismoDocumento(pagina),
      abierta: await form.count(),
      escrito: await form.locator('input[name="nombre"]').inputValue({ timeout: 200 }).catch(() => null),
      aviso: limpio(await laVentana(pagina).locator('[role="alert"]').allInnerTexts().then((t) => t.join(' ')).catch(() => '')).slice(0, 90),
      cancelar: await form.getByRole('button', { name: 'Cancelar', exact: true }).isEnabled({ timeout: 200 }).catch(() => null),
    }), 10000)
    const enBase = await cuenta.enBase()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zd-correccion-sin-sesion.png') }).catch(() => {})
    const final = visto.at(-1)
    const fuera = visto.find((v) => v.direccion !== '/tesoreria/caja-diaria' || v.mismoDocumento === false)
    comprobar(!fuera && final.abierta === 1 && final.escrito === escrito && final.aviso.length > 0 && final.cancelar === true && enBase === nombre,
      `[Tesorería 1280] 1zd-correccion-sin-sesion. sin sesión, la corrección no se lleva la pantalla a /ingresar: la ventana sigue abierta con lo escrito y el aviso, y se puede cancelar (${JSON.stringify(cambiosDe(visto)).slice(0, 600)}, en la base «${enBase}»)`)
    // Lo que se ve es del navegador: la sesión que el banco dejó sin valer.
    // explicarFallo anota en la consola lo que lanzó la acción: sin sesión, la
    // redirección a /ingresar le llega a Next como «An unexpected response…».
    const propios = errores.filter((e) => !/refresco-que-no-vale|Invalid Refresh Token|AuthApiError|JWT|401|An unexpected response was received from the server/i.test(e))
    comprobar(propios.length === 0, `[Tesorería 1280] 1zd-correccion-sin-sesion. sin otros errores de consola${propios.length ? `: ${propios[0]}` : ''}`)
  } finally {
    await contexto.close()
  }
}

// Mientras se pregunta si la pantalla llegaría, la ventana lo dice: el aviso
// rojo con el botón girando y sin X parecía colgado (H4 de funcionalidad,
// quincuagésima cuarta pasada). La pregunta no espera más de 3 s: sin
// respuesta, la ventana se suelta y se pone al día al cerrarla. Tesorería.
if (corre('1zd-correccion-pregunta-lenta')) {
  const nombre = `QA-ZDP ${sello}`
  const cuenta = await cuentaDeTesoreria(nombre)
  const corregido = `${nombre} corregida`
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.tesoreria, { width: 1280, height: 900 }, { compilacion: true })
  try {
    await ir(pagina, `${BASE}/tesoreria/caja-diaria`)
    const form = await cuenta.abrirla(pagina)
    await form.locator('input[name="nombre"]').fill(corregido)
    await marcarDocumento(pagina)
    corte.lento = { patron: /\/auth\/sesion\?comprobar/, ms: 6000 }
    corte.perder = cuenta.id
    await form.getByRole('button', { name: 'Guardar', exact: true }).click()
    const pregunta = await hasta(() => loQueDiceLaVentana(pagina), (t) => t.includes('Comprobando si el servidor contesta'), 15000)
    const t0 = Date.now()
    const mientras = {
      aviso: limpio(await laVentana(pagina).locator('[role="alert"]').allInnerTexts().then((t) => t.join(' ')).catch(() => '')).slice(0, 70),
      cancelar: await form.getByRole('button', { name: 'Cancelar', exact: true }).isDisabled({ timeout: 300 }).catch(() => null),
      x: await laVentana(pagina).getByRole('button', { name: 'Cerrar' }).first().isDisabled({ timeout: 300 }).catch(() => null),
    }
    const suelta = await hasta(() => form.getByRole('button', { name: 'Cancelar', exact: true }).isEnabled({ timeout: 300 }).catch(() => false), Boolean, 8000)
    const ms = Date.now() - t0
    const despues = { suelta, ms, dice: await loQueDiceLaVentana(pagina), escrito: await form.locator('input[name="nombre"]').inputValue().catch(() => null), mismoDocumento: await mismoDocumento(pagina) }
    const enBase = await cuenta.enBase()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zd-correccion-pregunta-lenta.png') }).catch(() => {})
    comprobar(pregunta === 'Comprobando si el servidor contesta…' && mientras.aviso.length > 0 && mientras.cancelar === true && mientras.x === true,
      `[Tesorería 1280] 1zd-correccion-pregunta-lenta. tras el aviso, mientras pregunta, la ventana dice que lo comprueba y sigue trabada («${pregunta}», ${JSON.stringify(mientras)})`)
    comprobar(despues.suelta && despues.ms < 4500 && !despues.dice.includes('Comprobando') && despues.escrito === corregido && despues.mismoDocumento && enBase === corregido,
      `[Tesorería 1280] 1zd-correccion-pregunta-lenta. sin respuesta, a los 3 s se suelta con lo escrito y sin recargar (${JSON.stringify(despues)}, en la base «${enBase}»)`)
    comprobar(errores.length === 0, `[Tesorería 1280] 1zd-correccion-pregunta-lenta. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  } finally {
    corte.lento = null
    corte.perder = null
    await contexto.close()
  }
}

// La corrección cuya acción no vuelve nunca: la ventana trabada no tenía otra
// salida que Atrás o F5, y no decía nada (F2 de la crítica, quincuagésima
// cuarta pasada). Antes de los 15 s, nada más que el botón que gira; a los 15
// s lo dice, a la vista, y «Volver a cargar» recarga sin esperarla. Tesorería.
if (corre('1zd-correccion-colgada')) {
  const nombre = `QA-ZDC ${sello}`
  const cuenta = await cuentaDeTesoreria(nombre)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.tesoreria, { width: 1280, height: 900 })
  try {
    await ir(pagina, `${BASE}/tesoreria/caja-diaria`)
    const form = await cuenta.abrirla(pagina)
    await form.locator('input[name="nombre"]').fill(`${nombre} corregida`)
    const retenidas = corte.retenidas
    corte.marca = cuenta.id
    await form.getByRole('button', { name: 'Guardar', exact: true }).click()
    const t0 = Date.now()
    await hasta(() => corte.retenidas, (n) => n > retenidas, 15000)
    await pagina.waitForTimeout(Math.max(0, 5000 - (Date.now() - t0)))
    const antes = { dice: await loQueDiceLaVentana(pagina), boton: await laVentana(pagina).getByRole('button', { name: 'Volver a cargar', exact: true }).count() }
    const dice = await hasta(() => loQueDiceLaVentana(pagina), (t) => t.includes('Todavía no llega la respuesta del servidor'), 20000)
    const ms = Date.now() - t0
    const ventana = laVentana(pagina)
    const visto = {
      ms,
      abierta: await form.count(),
      cancelar: await form.getByRole('button', { name: 'Cancelar', exact: true }).isDisabled({ timeout: 300 }).catch(() => null),
      x: await ventana.getByRole('button', { name: 'Cerrar' }).first().isDisabled({ timeout: 300 }).catch(() => null),
      boton: await ventana.getByRole('button', { name: 'Volver a cargar', exact: true }).isVisible().catch(() => false),
      aLaVista: await ventana.locator('[role="status"]', { hasText: 'Todavía no llega' }).evaluate((e) => {
        const r = e.getBoundingClientRect()
        return r.top >= 0 && r.bottom <= window.innerHeight
      }).catch(() => null),
    }
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zd-correccion-colgada.png') }).catch(() => {})
    comprobar(antes.dice === '' && antes.boton === 0,
      `[Tesorería 1280] 1zd-correccion-colgada. a los 5 s, sin respuesta, la ventana todavía no dice nada: el botón que gira basta (${JSON.stringify(antes)})`)
    comprobar(dice === 'Todavía no llega la respuesta del servidor. Si sigue así, vuelve a cargar y después mira si quedó guardado antes de enviarlo otra vez.' && ms >= 14000 && visto.abierta === 1 && visto.cancelar === true && visto.x === true && visto.boton && visto.aLaVista,
      `[Tesorería 1280] 1zd-correccion-colgada. a los 15 s dice que no llega la respuesta, a la vista, con «Volver a cargar», y la ventana sigue trabada («${dice}», ${JSON.stringify(visto)})`)
    await marcarDocumento(pagina)
    await ventana.getByRole('button', { name: 'Volver a cargar', exact: true }).click()
    const recargo = await hasta(() => mismoDocumento(pagina), (m) => !m, 15000).then((m) => !m)
    await pagina.waitForLoadState('networkidle').catch(() => {})
    const trasRecargar = { recargo, ventanas: await pagina.locator('[role="dialog"]:not([data-nextjs-dialog])').count(), direccion: new URL(pagina.url()).pathname }
    comprobar(recargo && trasRecargar.ventanas === 0 && trasRecargar.direccion === '/tesoreria/caja-diaria',
      `[Tesorería 1280] 1zd-correccion-colgada. «Volver a cargar» recarga sin esperar la acción que no vuelve (${JSON.stringify(trasRecargar)})`)
    comprobar(errores.length === 0, `[Tesorería 1280] 1zd-correccion-colgada. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  } finally {
    corte.soltar()
    await contexto.close()
  }
}

// En la orden nueva, lo que se dio de alta en su ventana y se canceló en vuelo
// entra igual, pero no elige nada: la unidad cancelada reemplazaba la que la
// persona había elegido entretanto, y la orden —un documento numerado— salía
// con ella (F3 de la crítica, quincuagésima cuarta pasada). Junto al campo se
// dice que quedó registrada; en la lista está, sin elegir. Lo mismo con el
// cliente nuevo, que además borraba la unidad elegida. Y la unidad que entra
// después de cambiar el cliente es del de antes: no va en la lista del nuevo.
// Administración.
if (corre('1zd-altas-cancelan-orden-nueva')) {
  const clientes = await consulta(`with c as (select id, razon_social from clientes where activo order by razon_social, id limit 500)
                                   select c.id, c.razon_social, min(u.placa) placa from c
                                     join unidades u on u.cliente_id = c.id and u.activo and nullif(btrim(u.placa), '') is not null
                                    group by c.id, c.razon_social order by c.razon_social limit 2`)
  const [{ n: ruc }] = await consulta(`select n from (select '208' || lpad($1::text, 7, '0') || d as n from generate_series(0, 9) d) x
                                       where public.ruc_es_valido(n) and not exists (select 1 from clientes c where c.numero_documento = x.n) limit 1`, [sello])
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  const elegirEn = async (campo, texto) => {
    await pagina.locator(`#${campo}`).click()
    await pagina.locator('input[type="search"]:focus').waitFor({ timeout: 10000 })
    await pagina.keyboard.type(texto)
    await pagina.getByRole('option', { name: new RegExp(texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click()
  }
  /** Si `texto` está entre las opciones del campo: se abre, se busca y se cierra sin elegir. */
  const enLaLista = async (campo, texto) => {
    await pagina.locator(`#${campo}`).click()
    await pagina.locator('input[type="search"]:focus').waitFor({ timeout: 10000 })
    await pagina.keyboard.type(texto)
    const n = await pagina.getByRole('option', { name: new RegExp(texto) }).count()
    await pagina.keyboard.press('Escape')
    return n
  }
  // SeleccionBuscable lleva el valor en un <select> de verdad, transparente.
  const valor = (campo) => pagina.locator(`select[name="${campo}"]`).inputValue({ timeout: 3000 }).catch(() => null)
  const aparte = () => pagina.locator('[data-registrado-aparte]').allInnerTexts().then((t) => limpio(t.join(' | '))).catch(() => '')
  const altaRetenida = async (abrir, llenar, enviar, marca) => {
    await pagina.getByRole('button', { name: abrir, exact: true }).click()
    const v = laVentana(pagina)
    await v.waitFor({ timeout: 10000 })
    await llenar(v)
    const retenidas = corte.retenidas
    corte.marca = marca
    await v.getByRole('button', { name: enviar, exact: true }).click()
    const retenida = (await hasta(() => corte.retenidas, (n) => n > retenidas, 15000)) > retenidas
    const cancelar = v.getByRole('button', { name: 'Cancelar', exact: true })
    const cancela = await cancelar.isEnabled({ timeout: 1000 }).catch(() => false)
    await cancelar.click({ timeout: 3000 }).catch(() => {})
    const cerrada = (await hasta(() => pagina.locator('[role="dialog"]:not([data-nextjs-dialog])').count(), (n) => n === 0, 5000)) === 0
    return { retenida, cancela, cerrada }
  }
  const llenarUnidad = (placa) => async (v) => {
    await v.locator('#nu-marca').fill('QA')
    await v.locator('#nu-modelo').fill(`ZDU ${sello}`)
    await v.locator('#nu-anio').fill('2020')
    await v.locator('#nu-placa').fill(placa)
  }
  const unidadCon = (placa) => consulta(`select id, cliente_id from unidades where replace(placa, '-', '') = $1`, [placa]).then((f) => f[0] ?? null)
  try {
    if (clientes.length < 2 || !ruc) throw new Error('Faltan dos clientes con unidades, o un RUC libre')
    const [A, B] = clientes
    await ir(pagina, `${BASE}/ordenes/nueva`)
    await marcarDocumento(pagina)
    await elegirEn('cliente_id', A.razon_social)
    await pagina.waitForLoadState('networkidle').catch(() => {})
    const clienteA = await valor('cliente_id')

    // 1. La unidad: se cancela en vuelo, la persona elige la que ya existía y después entra el alta.
    const placa1 = `ZU${sello.slice(-4)}`
    const enVuelo1 = await altaRetenida('Nueva unidad', llenarUnidad(placa1), 'Registrar unidad', placa1)
    await elegirEn('unidad_id', A.placa)
    const elegida = await valor('unidad_id')
    corte.soltar()
    const creada1 = await hasta(() => unidadCon(placa1), Boolean, 20000)
    const dice1 = await hasta(aparte, (t) => t.includes(placa1), 5000)
    const tras1 = { unidad: await valor('unidad_id'), elegida, enLista: await enLaLista('unidad_id', placa1), dice: dice1 }
    comprobar(enVuelo1.retenida && enVuelo1.cancela && enVuelo1.cerrada && Boolean(creada1) && Boolean(elegida) && tras1.unidad === elegida && tras1.enLista === 1
      && dice1 === `La unidad ${placa1} quedó registrada aunque cerraste su ventana antes de que contestara. Está en la lista, sin elegir.`,
      `[Administración 1280] 1zd-altas-cancelan-orden-nueva. la unidad cancelada en vuelo entra a la lista sin pisar la elegida, y junto al campo se dice (${JSON.stringify({ enVuelo1, ...tras1 })})`)
    await pagina.locator('[data-registrado-aparte]').getByRole('button', { name: 'Quitar este aviso' }).click({ timeout: 3000 }).catch(() => {})

    // 2. El cliente: se cancela en vuelo y entra después; el cliente y la unidad elegidos se quedan.
    const razon = `QA-ZDU CLIENTE ${sello} S.A.C.`
    const enVuelo2 = await altaRetenida('Nuevo cliente', async (v) => {
      await v.locator('#nc-tipo').selectOption('RUC')
      await v.locator('#nc-numero').fill(ruc)
      await v.locator('#nc-razon').fill(razon)
    }, 'Registrar cliente', razon)
    corte.soltar()
    const creado2 = await hasta(() => consulta(`select id from clientes where numero_documento = $1`, [ruc]).then((f) => f[0] ?? null), Boolean, 20000)
    const dice2 = await hasta(aparte, (t) => t.includes(razon), 5000)
    const tras2 = { cliente: await valor('cliente_id'), unidad: await valor('unidad_id'), enLista: await enLaLista('cliente_id', `QA-ZDU CLIENTE ${sello}`), dice: dice2 }
    comprobar(enVuelo2.retenida && enVuelo2.cancela && enVuelo2.cerrada && Boolean(creado2) && tras2.cliente === clienteA && tras2.unidad === elegida && tras2.enLista === 1
      && dice2 === `El cliente ${razon} quedó registrado aunque cerraste su ventana antes de que contestara. Está en la lista, sin elegir.`,
      `[Administración 1280] 1zd-altas-cancelan-orden-nueva. el cliente cancelado en vuelo entra a la lista sin cambiar el cliente ni la unidad elegidos (${JSON.stringify({ enVuelo2, ...tras2 })})`)

    // 3. La unidad que entra después de cambiar el cliente: es del de antes.
    const placa3 = `ZW${sello.slice(-4)}`
    const enVuelo3 = await altaRetenida('Nueva unidad', llenarUnidad(placa3), 'Registrar unidad', placa3)
    await elegirEn('cliente_id', B.razon_social)
    await pagina.waitForLoadState('networkidle').catch(() => {})
    corte.soltar()
    const creada3 = await hasta(() => unidadCon(placa3), Boolean, 20000)
    const dice3 = await hasta(aparte, (t) => t.includes(placa3), 5000)
    await pagina.waitForTimeout(500)
    const tras3 = { cliente: await valor('cliente_id'), unidad: await valor('unidad_id'), enLista: await enLaLista('unidad_id', placa3), conLasDeB: await enLaLista('unidad_id', B.placa), dice: dice3 }
    comprobar(enVuelo3.retenida && enVuelo3.cancela && creada3?.cliente_id === clienteA && tras3.cliente !== clienteA && tras3.unidad === '' && tras3.enLista === 0 && tras3.conLasDeB >= 1
      && dice3 === `La unidad ${placa3} quedó registrada en ${A.razon_social} aunque cerraste su ventana antes de que contestara.`,
      `[Administración 1280] 1zd-altas-cancelan-orden-nueva. la unidad del cliente de antes no entra a la lista del nuevo ni se elige, y se dice de quién quedó (${JSON.stringify({ enVuelo3, ...tras3 })})`)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zd-altas-cancelan-orden-nueva.png') })
    comprobar((await mismoDocumento(pagina)) && errores.length === 0, `[Administración 1280] 1zd-altas-cancelan-orden-nueva. sin recargar y sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  } catch (e) {
    comprobar(false, `[Administración 1280] 1zd-altas-cancelan-orden-nueva. ${String(e?.message ?? e).slice(0, 300)}`)
  } finally {
    corte.soltar()
    await contexto.close()
  }
}

// En línea, mientras una nota de verificación se guarda, las demás no se abren
// y la suya no se cierra: abrir otra desmontaba la que iba en camino, y vuelta
// a abrir traía la nota de antes; guardarla así deshacía la corrección (H2 de
// funcionalidad y D1 de diseño, quincuagésima tercera pasada). Administración.
if (corre('1zd-nota-otra')) {
  const [orden] = await consulta(`select id from ordenes_trabajo where estado not in ('BORRADOR', 'ENTREGADA', 'FACTURADA', 'ANULADA') order by numero limit 1`)
  let pasos
  await comoLaCuenta(CUENTAS.administracion, async () => {
    pasos = (await base.query(`insert into ot_verificaciones (orden_id, numero, descripcion, observaciones)
      select $1, coalesce((select max(numero) from ot_verificaciones where orden_id = $1), 0) + g,
             'QA-ZDN paso ' || g || ' ' || $2 || ', no es real', 'QA-ZDN nota de antes ' || g
        from generate_series(1, 2) g returning id, descripcion`, [orden.id, sello])).rows
  })
  const [A, B] = pasos
  const nota = async (x) => (await consulta(`select observaciones from ot_verificaciones where id = $1`, [x.id]))[0]?.observaciones ?? null
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  try {
    await ir(pagina, `${BASE}/ordenes/${orden.id}?vista=ficha`)
    const fila = (x) => pagina.locator('tr').filter({ hasText: x.descripcion }).first()
    const abre = (x) => fila(x).getByRole('button', { name: /^(Anotar|Editar) observación$/ })
    const campo = (x) => fila(x).locator('input[name="observaciones"]')
    await abre(A).click({ timeout: 30000 })
    await campo(A).waitFor({ timeout: 10000 })
    const nueva = `QA-ZDN nota A corregida ${sello}`
    await campo(A).fill(nueva)
    corte.lento = { patron: new RegExp(`/ordenes/${orden.id}`), ms: 6000 }
    await fila(A).getByRole('button', { name: 'Guardar nota' }).click()
    const entro = await hasta(() => nota(A), (n) => n === nueva, 20000)
    const mientras = {
      otra: await abre(B).isDisabled({ timeout: 500 }).catch(() => null),
      cerrar: await fila(A).getByRole('button', { name: 'Cerrar', exact: true }).isDisabled({ timeout: 500 }).catch(() => null),
    }
    await abre(B).click({ timeout: 1000, force: true }).catch(() => {})
    await pagina.waitForTimeout(300)
    mientras.sigueAbierta = await campo(A).count()
    mientras.bAbierta = await campo(B).count()
    await campo(A).waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    const alCerrar = { fila: limpio(await fila(A).innerText().catch(() => '')), otra: await abre(B).isEnabled({ timeout: 2000 }).catch(() => false) }
    corte.lento = null
    await abre(A).click({ timeout: 10000 })
    await campo(A).waitFor({ timeout: 10000 })
    const reabierta = await campo(A).inputValue()
    await campo(A).fill(`${reabierta} y algo más`)
    await fila(A).getByRole('button', { name: 'Guardar nota' }).click()
    const final = await hasta(() => nota(A), (n) => n !== nueva, 20000)
    comprobar(entro === nueva && mientras.otra === true && mientras.cerrar === true && mientras.sigueAbierta === 1 && mientras.bAbierta === 0,
      `[Administración 1280] 1zd-nota-otra. mientras la nota de A se guarda, la de B no se abre y la de A no se cierra (${JSON.stringify(mientras)})`)
    comprobar(alCerrar.fila.includes(nueva) && alCerrar.otra,
      `[Administración 1280] 1zd-nota-otra. al cerrarse, la fila ya dice la nota nueva y la de B se puede abrir (${JSON.stringify(alCerrar).slice(0, 300)})`)
    comprobar(reabierta === nueva && final === `${nueva} y algo más`,
      `[Administración 1280] 1zd-nota-otra. vuelta a abrir trae la nota guardada, y lo que se le agrega no deshace la corrección (abierta con «${reabierta}», en la base «${final}»)`)
    comprobar(errores.length === 0, `[Administración 1280] 1zd-nota-otra. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  } finally {
    corte.lento = null
    await contexto.close()
  }
}

// Una orden con etapas libres para corregir: las dos QA-ZDE se siembran con la
// función de la base y el rol de Diseño. No es la del cronograma (sin
// cotización: la elige `ordenParaElCronograma`), solo tiene etapas del banco y
// Administración ve su pestaña Etapas: la de una cotización con código de
// unidad que no es PLANTA no la tiene (`acceso-orden.ts`, el criterio de
// `avance_de_ordenes`). Elegida por posición, en otra base tocaba una así y la
// parte se colgaba y cortaba la corrida (R35 de realización, quincuagésima
// cuarta pasada).
async function ordenConEtapasDelBanco() {
  const [orden] = await consulta(`select o.id from ordenes_trabajo o
                                   where o.plan_etapas_manual and o.estado not in ('BORRADOR', 'ENTREGADA', 'FACTURADA', 'ANULADA')
                                     and not (o.cotizacion_pdf_id is not null
                                              and exists (select 1 from unidades u where u.id = o.unidad_id
                                                            and nullif(btrim(u.codigo_interno), '') is not null and upper(btrim(u.codigo_interno)) <> 'PLANTA'))
                                     and o.id <> (select c.id from ordenes_trabajo c where c.cotizacion_pdf_id is null
                                                    and c.estado not in ('ENTREGADA', 'FACTURADA', 'ANULADA', 'BORRADOR') order by c.numero limit 1)
                                     and not exists (select 1 from ot_etapas e where e.orden_id = o.id and e.nombre not like 'QA-ZDE%')
                                   order by o.numero limit 1`)
  const a = randomUUID()
  const b = randomUUID()
  const nombreA = `QA-ZDE A ${sello}`
  const nombreB = `QA-ZDE B ${sello}`
  await comoLaCuenta(CUENTAS.diseno, async () => {
    const [{ id: area }] = (await base.query(`select id from areas where codigo = 'PRD' and activo`)).rows
    // Solo A y B: las QA-ZDE de vueltas anteriores, sin avance, salen de la orden.
    const config = [{ id: a, nombre: nombreA, area_id: area, peso_pct: 20 }, { id: b, nombre: nombreB, area_id: area, peso_pct: 20 }]
    await base.query(`select guardar_etapas_libres($1, $2::jsonb, null)`, [orden.id, JSON.stringify(config)])
  })
  return { orden, a, b, nombreA, nombreB }
}

// Corregir las etapas vuelve a la lista con lo guardado (`corrige`): se
// cerraba al contestar, vuelto a abrir en ese segundo traía el peso de antes y
// no la etapa recién agregada, y guardarlo por otro lado devolvía el peso y
// borraba la nueva (R30 de realización, quincuagésima tercera pasada). Diseño.
if (corre('1zd-etapas-al-dia')) {
  const { orden, a, b, nombreB } = await ordenConEtapasDelBanco()
  const nombreC = `QA-ZDE C ${sello}`
  const enBase = async () => Object.fromEntries((await consulta(`select id, nombre, peso_pct::float8 as peso from ot_etapas where orden_id = $1`, [orden.id])).map((e) => [e.id === a ? 'a' : e.id === b ? 'b' : e.nombre, { nombre: e.nombre, peso: e.peso }]))
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, { width: 1280, height: 900 })
  try {
    await ir(pagina, `${BASE}/ordenes/${orden.id}?vista=etapas`)
    const abrir = pagina.getByRole('button', { name: 'Editar o agregar etapa' })
    const form = pagina.locator('form').filter({ has: pagina.getByRole('button', { name: 'Guardar etapas' }) })
    await abrir.click({ timeout: 30000 })
    await form.waitFor({ timeout: 10000 })
    const filas = await form.locator('input[name="etapa_id"]').count()
    await form.locator(`#peso-${a}`).fill('35')
    await form.getByRole('button', { name: '+ Agregar etapa' }).click()
    await form.locator('input[id^="nombre-"]').last().fill(nombreC)
    await form.locator('select[id^="area-"]').last().selectOption({ index: 1 })
    await form.locator('input[id^="peso-"]').last().fill('5')
    corte.lento = { patron: new RegExp(`/ordenes/${orden.id}`), ms: 6000 }
    await form.getByRole('button', { name: 'Guardar etapas' }).click()
    const entro = await hasta(enBase, (f) => f?.a?.peso === 35 && f[nombreC], 20000)
    const mientras = {
      abierto: await form.count(),
      cancelar: await form.getByRole('button', { name: 'Cancelar', exact: true }).isDisabled({ timeout: 500 }).catch(() => null),
    }
    await form.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    const alCerrar = limpio(await pagina.locator('main').innerText().catch(() => ''))
    corte.lento = null
    await abrir.click({ timeout: 10000 })
    await form.waitFor({ timeout: 10000 })
    const reabierto = { filas: await form.locator('input[name="etapa_id"]').count(), pesoA: await form.locator(`#peso-${a}`).inputValue() }
    await form.locator(`#nombre-${b}`).fill(`${nombreB} renombrada`)
    await form.getByRole('button', { name: 'Guardar etapas' }).click()
    const final = await hasta(enBase, (f) => f?.b?.nombre === `${nombreB} renombrada`, 20000)
    await form.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    comprobar(entro && mientras.abierto === 1 && mientras.cancelar === true,
      `[Diseño 1280] 1zd-etapas-al-dia. con las etapas ya en la base y la página sin ponerse al día, el formulario sigue abierto y «Cancelar» está apagado (${JSON.stringify(mientras)})`)
    comprobar(alCerrar.includes(nombreC),
      `[Diseño 1280] 1zd-etapas-al-dia. al cerrarse, la lista ya trae la etapa agregada`)
    comprobar(reabierto.filas === filas + 1 && Number(reabierto.pesoA) === 35 && final?.a?.peso === 35 && final?.[nombreC],
      `[Diseño 1280] 1zd-etapas-al-dia. vuelto a abrir trae el peso y la etapa guardados, y renombrar otra no los deshace (abierto con ${JSON.stringify(reabierto)}, antes ${filas} filas; en la base ${JSON.stringify(final)})`)
    comprobar(errores.length === 0, `[Diseño 1280] 1zd-etapas-al-dia. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  } finally {
    corte.lento = null
    await contexto.close()
  }
}

// Mientras unas fechas se guardan, ninguna fila abre ni cierra las suyas: abrir
// otra desmontaba la que iba en camino, y vuelta a abrir traía el fin de antes
// y lo mandaba (H3 de funcionalidad, quincuagésima tercera pasada).
// Administración, que programa las etapas.
if (corre('1zd-programacion-otra')) {
  const { orden, a, b, nombreA, nombreB } = await ordenConEtapasDelBanco()
  const [{ inicio, fin }] = await consulta(`select (current_date + 30)::text inicio, (current_date + 45)::text fin`)
  const fechas = async () => (await consulta(`select fecha_inicio_programada::text inicio, fecha_fin_programada::text fin from ot_etapas where id = $1`, [a]))[0]
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion, { width: 1280, height: 900 })
  try {
    await ir(pagina, `${BASE}/ordenes/${orden.id}?vista=etapas`)
    const fila = (id) => pagina.locator(`#etapa-${id}`)
    const boton = (id) => fila(id).getByRole('button', { name: /^(Cerrar|Cambiar fechas|Programar fechas)$/ })
    await boton(a).click({ timeout: 30000 })
    await pagina.locator(`#inicio-${a}`).fill(inicio)
    await pagina.locator(`#fin-${a}`).fill(fin)
    corte.lento = { patron: new RegExp(`/ordenes/${orden.id}`), ms: 6000 }
    await fila(a).getByRole('button', { name: 'Guardar fechas' }).click()
    const entro = await hasta(fechas, (f) => f?.fin === fin, 20000)
    const mientras = {
      propio: await boton(a).isDisabled({ timeout: 500 }).catch(() => null),
      otro: await boton(b).isDisabled({ timeout: 500 }).catch(() => null),
      cancelar: await fila(a).getByRole('button', { name: 'Cancelar', exact: true }).isDisabled({ timeout: 500 }).catch(() => null),
    }
    await pagina.locator(`#fin-${a}`).waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
    const alCerrar = { otro: await boton(b).isEnabled({ timeout: 2000 }).catch(() => false) }
    corte.lento = null
    await boton(a).click({ timeout: 10000 })
    const reabierta = { inicio: await pagina.locator(`#inicio-${a}`).inputValue(), fin: await pagina.locator(`#fin-${a}`).inputValue() }
    await pagina.locator(`#inicio-${a}`).fill((await consulta(`select (current_date + 31)::text d`))[0].d)
    await fila(a).getByRole('button', { name: 'Guardar fechas' }).click()
    const final = await hasta(fechas, (f) => f && f.inicio !== inicio, 20000)
    comprobar(entro?.fin === fin && mientras.propio === true && mientras.otro === true && mientras.cancelar === true,
      `[Administración 1280] 1zd-programacion-otra. mientras se guardan las fechas de «${nombreA}», ni su «Cerrar» ni el de «${nombreB}» se tocan (${JSON.stringify(mientras)})`)
    comprobar(alCerrar.otro && reabierta.inicio === inicio && reabierta.fin === fin && final?.fin === fin,
      `[Administración 1280] 1zd-programacion-otra. al cerrarse se libera la otra fila, vuelta a abrir trae las fechas guardadas y cambiar el inicio no devuelve el fin (abierta con ${JSON.stringify(reabierta)}, en la base ${JSON.stringify(final)})`)
    comprobar(errores.length === 0, `[Administración 1280] 1zd-programacion-otra. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  } finally {
    corte.lento = null
    await contexto.close()
  }
}

// Las altas que comparten formulario con su corrección (`corrige` según el
// caso) se siguen cancelando en vuelo: el material nuevo del catálogo (Diseño)
// y el subcontratista nuevo (Administración). La unidad nueva, en la orden
// nueva, la prueba 1zd-altas-cancelan-orden-nueva, que mira también qué hace
// lo que entra después. Con «Cancelar» apagado en vuelo, la suite entera lo encontró.
if (corre('1zd-altas-cancelan')) {
  const casos = [
    {
      cuenta: CUENTAS.diseno,
      puesto: 'Diseño',
      que: 'el material nuevo',
      direccion: '/materiales',
      abrir: (p) => p.getByRole('button', { name: 'Nuevo material', exact: true }),
      marca: `QA-ZDX material ${sello}`,
      llenar: async (v, marca) => {
        await v.locator('#fm-descripcion, [name="descripcion"]').first().fill(marca)
        await v.locator('select[name="categoria_id"]').selectOption({ index: 1 })
        await v.locator('select[name="unidad_medida_id"]').selectOption({ index: 1 })
        const confirmar = v.locator('input[name="confirmar_unidad"]')
        if (await confirmar.count()) await confirmar.check()
      },
      enviar: 'Guardar',
    },
    {
      cuenta: CUENTAS.administracion,
      puesto: 'Administración',
      que: 'el subcontratista nuevo',
      direccion: '/subcontratos?vista=subcontratistas',
      abrir: (p) => p.locator('[data-nuevo-subcontratista]'),
      marca: `QA-ZDX subcontratista ${sello}`,
      llenar: async (v, marca) => {
        const cuerpo = String(Date.now()).slice(-8)
        const base10 = `10${cuerpo}`.slice(0, 10)
        const suma = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2].reduce((t, peso, i) => t + Number(base10[i]) * peso, 0)
        let digito = 11 - (suma % 11)
        if (digito === 10) digito = 0
        if (digito === 11) digito = 1
        await v.locator('input[name="ruc"]').fill(`${base10}${digito}`)
        await v.locator('input[name="nombre"]').fill(marca)
      },
      enviar: 'Dar de alta',
    },
  ]
  for (const caso of casos) {
    const { pagina, contexto, errores, corte } = await entrar(caso.cuenta, { width: 1280, height: 900 })
    try {
      await ir(pagina, `${BASE}${caso.direccion}`)
      await caso.abrir(pagina).first().click({ timeout: 30000 })
      const v = laVentana(pagina)
      await v.waitFor({ timeout: 10000 })
      await caso.llenar(v, caso.marca)
      const retenidas = corte.retenidas
      corte.marca = caso.marca
      await v.getByRole('button', { name: caso.enviar, exact: true }).click()
      const retenida = await hasta(() => corte.retenidas, (n) => n > retenidas, 15000)
      const cancelar = v.getByRole('button', { name: 'Cancelar', exact: true })
      const enVuelo = { retenida: retenida > retenidas, cancelar: await cancelar.isEnabled({ timeout: 1000 }).catch(() => false) }
      await cancelar.click({ timeout: 3000 }).catch(() => {})
      enVuelo.cerrada = (await hasta(() => pagina.locator('[role="dialog"]:not([data-nextjs-dialog])').count(), (n) => n === 0, 5000)) === 0
      corte.soltar()
      await pagina.waitForTimeout(1500)
      comprobar(enVuelo.retenida && enVuelo.cancelar && enVuelo.cerrada,
        `[${caso.puesto} 1280] 1zd-altas-cancelan. ${caso.que} se cancela mientras se envía, como siempre (${JSON.stringify(enVuelo)})`)
      comprobar(errores.length === 0, `[${caso.puesto} 1280] 1zd-altas-cancelan. ${caso.que}, sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    } finally {
      corte.soltar()
      await contexto.close()
    }
  }
}

// El motivo de la base llega con su punto, y detrás va «; » o «. »: decía
// «…(prueba).. Vuelve a enviarla.» (M1 de funcionalidad, quincuagésima
// pasada). Con la persona ahí lo dice el formulario; con la persona ya en otra
// pantalla, la línea de arriba. La base lo rechaza por un disparador propio,
// que se quita al final.
if (corre('1zd-motivo-de-la-base')) {
  const { orden, nuevoPlano } = await ordenParaPlanos()
  const plano = await nuevoPlano(`QA-ZDM-${sello}`, 'Plano que la base rechaza')
  const MOTIVO = 'El banco no acepta esta versión (QA_ZDM).'
  const sinPunto = MOTIVO.replace(/\.$/, '')
  await consulta(`create or replace function public.qa_zdm_version_dice_que_no() returns trigger language plpgsql set search_path = public as $$
                    begin
                      if new.plano_id = '${plano.id}'::uuid then
                        raise exception '${MOTIVO}';
                      end if;
                      return new;
                    end $$`)
  await consulta(`drop trigger if exists qa_zdm_version_dice_que_no on public.ot_plano_versiones`)
  await consulta(`create trigger qa_zdm_version_dice_que_no before insert on public.ot_plano_versiones for each row
                    execute function public.qa_zdm_version_dice_que_no()`)
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.diseno, { width: 1280, height: 900 })
  try {
    const direccion = `/ordenes/${orden.id}/planos?plano=${plano.id}`
    const archivo = pagina.locator(`#version-archivo-${plano.id}`)
    const formulario = archivo.locator('xpath=ancestor::form')
    const versiones = async () => Number((await consulta(`select count(*) n from ot_plano_versiones where plano_id = $1`, [plano.id]))[0].n)
    const pdf = { name: `QA-ZDM-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`PLANO QA-ZDM-${sello}`, 'Plano que la base rechaza']) }
    const llenar = async () => {
      await archivo.waitFor({ state: 'attached', timeout: 30000 })
      await formulario.getByLabel('Maestranza', { exact: true }).check()
      await formulario.getByLabel('Producción', { exact: true }).check()
      await archivo.setInputFiles(pdf)
      return formulario.locator('input[name="area_id"]:checked').evaluateAll((l) => l.map((c) => c.parentElement.textContent.trim()))
    }
    await ir(pagina, `${BASE}${direccion}`)
    await marcarDocumento(pagina)
    const marcadas = await llenar()
    const PORQUE = `Falta ${marcadas.map((a) => `${a}: ${sinPunto}`).join('; ')}. Vuelve a enviarla.`
    const rojo = async () => limpio((await formulario.locator('[role="alert"]').allInnerTexts().catch(() => [])).join(' '))
    await formulario.getByRole('button', { name: 'Enviar a revisión' }).click()
    const ahi = await hasta(rojo, (t) => t.startsWith('Falta'), 30000)
    comprobar(ahi === PORQUE && (await versiones()) === 0,
      `[Diseño 1280] 1zd-motivo-de-la-base. con la persona ahí, el formulario dice el motivo de cada área sin doble punto («${ahi}»)`)
    // Ya en otra pantalla: la acción de la primera área se detiene hasta que
    // la persona toca el menú, y lo que vuelve lo dice arriba.
    await ir(pagina, `${BASE}${direccion}`)
    await llenar()
    const retenidas = corte.retenidas
    corte.marca = `QA-ZDM-${sello}`
    await formulario.getByRole('button', { name: 'Enviar a revisión' }).click()
    await hasta(() => corte.retenidas, (n) => n > retenidas, 30000)
    await (await enlaceVisible(pagina, '/')).click()
    await pagina.waitForTimeout(800)
    corte.soltar()
    await pagina.waitForURL((u) => u.pathname === '/', { timeout: 30000 }).catch(() => {})
    const arriba = await hasta(() => idaQueNoSalio(pagina), (t) => t.includes('no se guardó'), 30000)
    await pagina.waitForTimeout(1000)
    const tono = await tonoDeLaLinea(pagina)
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1zd-motivo-de-la-base.png') })
    comprobar(pagina.url().replace(BASE, '') === '/' && arriba === `La versión del plano no se guardó. ${PORQUE} Volver al plano` && tono === 'rechazo' && (await versiones()) === 0,
      `[Diseño 1280] 1zd-motivo-de-la-base. con la persona ya en otra pantalla, arriba dice el motivo sin doble punto («${arriba}», ${tono})`)
    comprobar(errores.length === 0, `[Diseño 1280] 1zd-motivo-de-la-base. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  } finally {
    await consulta(`drop trigger if exists qa_zdm_version_dice_que_no on public.ot_plano_versiones`)
    await consulta(`drop function if exists public.qa_zdm_version_dice_que_no()`)
    await contexto.close()
  }
}

// ------------------------------------------- 1j. La ventana que pregunta por su envío anterior (Requerimientos)
if (corre('1j')) {
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.requerimientos)
  await ir(pagina, `${BASE}/requerimientos`)
  const boton = pagina.getByRole('button', { name: /^Nuevo requerimiento/ }).first()
  const v = pagina.getByRole('dialog')
  await vigilarLaRegionDeArriba(pagina)
  // Al abrir, la ventana pregunta si su envío anterior entró (`consultarEnvio`):
  // desde la pestaña vieja vuelve 404, y antes se callaba (H3 de funcionamiento).
  corte.despliegue = true
  await boton.click()
  await v.waitFor()
  const enVentana = limpio(await hasta(() => v.locator('[data-ventana-vieja]').innerText().catch(() => ''), Boolean, 15000))
  const enRegion = await v.locator('[role="status"] [data-ventana-vieja]').count()
  const arriba = await avisoDeArriba(pagina)
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1j-ventana.png') })
  comprobar(enVentana === TEXTO_VENTANA && enRegion === 1 && arriba.startsWith(TEXTO_VIEJA) && (await pagina.locator('[data-region-pestana-vieja]').count()) === 0,
    `[Requerimientos 1280] 1j. al abrir «Nuevo requerimiento», la pregunta por el envío anterior descubre la pestaña vieja: la ventana lo dice en una región que lo anuncia, y arriba está sin región, para que no se oiga dos veces («${enVentana}»)`)
  corte.despliegue = false
  await pagina.keyboard.press('Escape')
  await hasta(() => v.count(), (n) => n === 0, 5000)
  // Abierta otra vez, ya sabida vieja: nace con el aviso, y lo nombra su aria-describedby.
  await boton.click()
  await v.waitFor()
  const alAbrir = await v.locator('[data-ventana-vieja]').count()
  const sinRegion = (await v.locator('[role="status"] [data-ventana-vieja]').count()) === 0
  const describe = await v.evaluate((d) => (d.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean).map((id) => document.getElementById(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? '').join(' | '))
  comprobar(alAbrir === 1 && sinRegion && describe.includes(TEXTO_VENTANA),
    `[Requerimientos 1280] 1j. abierta otra vez, la ventana nace con el aviso, sin región, y su aria-describedby lo nombra («${describe}»)`)
  await pagina.keyboard.press('Escape')
  comprobar(errores.length === 0, `[Requerimientos 1280] 1j. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// 1j. El otro camino: con la ventana abierta y a medio llenar, se sale y se
// vuelve tras 31 s, y la pregunta por los avisos descubre la pestaña vieja.
// Solo la ventana lo anuncia (trigesimoprimera pasada: las dos regiones
// recibían su texto en el mismo instante).
if (corre('1j')) {
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.requerimientos)
  await ir(pagina, `${BASE}/requerimientos`)
  const v = pagina.getByRole('dialog')
  await pagina.getByRole('button', { name: /^Nuevo requerimiento/ }).first().click()
  await v.waitFor()
  await quieta(pagina)
  corte.despliegue = true
  await salirYVolver(pagina)
  const enVentana = limpio(await hasta(() => v.locator('[data-ventana-vieja]').innerText().catch(() => ''), Boolean, 15000))
  const enRegion = await v.locator('[role="status"] [data-ventana-vieja]').count()
  const arriba = await avisoDeArriba(pagina)
  comprobar(enVentana === TEXTO_VENTANA && enRegion === 1 && arriba.startsWith(TEXTO_VIEJA) && (await pagina.locator('[data-region-pestana-vieja]').count()) === 0,
    `[Requerimientos 1280] 1j. al volver tras 31 s con la ventana abierta, la ventana lo anuncia y arriba está sin región («${enVentana}»)`)
  corte.despliegue = false
  await pagina.keyboard.press('Escape')
  comprobar(errores.length === 0, `[Requerimientos 1280] 1j. al volver, sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 1k. El PDF de la orden, dos veces (Administración)
if (corre('1k')) {
  const [ot] = await consulta(
    `select o.id, o.numero from ordenes_trabajo o
     where not exists (select 1 from ot_adjuntos a where a.orden_id = o.id and a.tipo = 'ORDEN') order by o.numero limit 1`,
  )
  const [{ id: yo }] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.administracion])
  const [{ t: desde }] = await consulta(`select now() as t`)
  const sueltos = async () =>
    (await consulta(`select o.name from storage.objects o where o.bucket_id = 'adjuntos-ot' and o.owner_id = $1 and o.created_at >= $2
        and not exists (select 1 from ot_adjuntos a where a.ruta_storage = o.name)`, [yo, desde])).length
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.administracion)
  await ir(pagina, `${BASE}/ordenes/${ot?.id}`)
  const campo = pagina.locator(`input[type="file"]#subir-pdf-${ot?.id}, #subir-pdf-${ot?.id} input[type="file"]`).first()
  if (!ot || (await campo.count()) === 0) {
    comprobar(false, `[Administración 1280] 1k. hay una orden sin PDF que ofrezca «Subir el PDF de la orden» (${ot?.numero ?? 'ninguna'})`)
  } else {
    corte.despliegue = true
    const dicen = []
    const subieron = []
    for (const vez of [1, 2]) {
      const s0 = corte.storage.length
      await campo.setInputFiles({ name: `orden-vieja-${vez}-${sello}.pdf`, mimeType: 'application/pdf', buffer: pdfConTexto([`Orden ${ot.numero}`, `Pestaña vieja ${vez} ${sello}`]) })
      dicen.push(limpio(await hasta(() => pagina.locator('main').innerText().then((t) => t.match(/[^.]*se actualizó[^.]*\.[^.]*\./)?.[0] ?? ''), Boolean, 30000)))
      await pagina.waitForTimeout(1500)
      subieron.push(corte.storage.slice(s0).filter((x) => x.startsWith('POST')).length)
    }
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-1k-pdf.png') })
    corte.despliegue = false
    const [{ n }] = await consulta(`select count(*)::int n from ot_adjuntos where orden_id = $1 and tipo = 'ORDEN'`, [ot.id])
    comprobar(dicen.every((d) => d.includes(SE_ACTUALIZO)) && subieron[0] === 1 && (await hasta(sueltos, (s) => s === 0, 10000)) === 0 && n === 0,
      `[Administración 1280] 1k. la primera vez, todavía sin saberse vieja, sube el PDF, la acción vuelve 404 y se quita; la orden sigue sin PDF («${dicen[0]}»)`)
    comprobar(subieron[1] === 0,
      `[Administración 1280] 1k. la segunda, ya sabida vieja, ni lo sube (${subieron[1]} subidas a Storage; «${dicen[1]}»)`)
  }
  comprobar(errores.length === 0, `[Administración 1280] 1k. sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 2. La anulación de un vehículo, cerrada en vuelo (Requerimientos)
if (corre('2')) {
  const { pagina, contexto, errores, corte } = await entrar(CUENTAS.requerimientos)
  await ir(pagina, `${BASE}/vehiculos`)
  const ventana = pagina.locator('[role="dialog"]', { has: pagina.locator('#veh-motivo') })
  await pagina.getByRole('button', { name: 'Registrar ingreso' }).click()
  await ventana.waitFor({ timeout: 10000 })
  await ventana.locator('#veh-motivo').selectOption('COCHERA')
  await ventana.locator('#veh-placa').fill(`V${sello.slice(-1)}A-${sello.slice(0, 3)}`)
  await ventana.locator('#veh-unidad').fill('Camioneta del cliente')
  const empresa = `EMPRESA VIEJA ${sello}`
  await ventana.locator('#veh-empresa').fill(empresa)
  await ventana.locator('input[type="file"]:not([capture])').setInputFiles(fotos.c)
  await esperarSubidas(pagina)
  await ventana.getByRole('button', { name: 'Registrar ingreso' }).click()
  const [reg] = await hasta(() => consulta(`select id from registro_vehiculos where empresa = $1`, [empresa]), (r) => r.length === 1)
  await ir(pagina, `${BASE}/vehiculos/${reg?.id}`)
  const anular = pagina.getByRole('button', { name: /^Anular el ingreso de/ })
  const fila = pagina.locator('div', { has: anular }).last()
  const anulado = async () => (await consulta(`select anulado_en is not null as a from registro_vehiculos where id = $1`, [reg?.id]))[0]?.a
  const v = pagina.locator('[role="dialog"]', { has: pagina.locator('textarea[name="motivo"]') })

  await anular.click()
  await v.waitFor({ timeout: 10000 })
  const marca = `Anulada ${sello}`
  await v.locator('textarea[name="motivo"]').fill(`${marca}: se anotó la placa de otro vehículo`)
  corte.marca = marca
  await v.getByRole('button', { name: 'Anular', exact: true }).click()
  const retenido = (await hasta(() => corte.retenidas, (n) => n >= 1)) >= 1
  await pagina.keyboard.press('Escape')
  const cerro = (await hasta(() => v.count(), (n) => n === 0, 5000)) === 0
  const botones = await fila.getByRole('button').all()
  const ocupados = await Promise.all(botones.map(async (b) => `${limpio(await b.innerText())}:${(await b.getAttribute('aria-disabled')) ?? (await b.isDisabled() ? 'apagado' : 'libre')}`))
  const sigue = limpio(await hasta(() => pagina.getByRole('status').filter({ hasText: 'se sigue enviando' }).allInnerTexts().then((t) => t.join(' ')), Boolean, 5000))
  const describe = await loQueDescribe(anular)
  // Con aria-disabled, Playwright no lo da por tocable: se toca igual, como un dedo.
  await anular.click({ force: true })
  await pagina.waitForTimeout(800)
  const abrioOtra = await pagina.getByRole('dialog').count()
  await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-2-fila.png') })
  comprobar(retenido && cerro && ocupados.every((o) => /:(true|apagado)$/.test(o)) && sigue === 'La anulación se sigue enviando: lo que conteste se dice aquí.' && abrioOtra === 0,
    `[Requerimientos 1280] 2. la anulación cerrada en vuelo: la fila entera gira, dice que sigue enviándose y no abre otra ventana (${ocupados.join(', ')}; «${sigue}»; ventanas ${abrioOtra})`)
  comprobar(describe === 'La anulación se sigue enviando: lo que conteste se dice aquí.',
    `[Requerimientos 1280] 2. «Anular» nombra con aria-describedby lo que sigue («${describe}»)`)
  corte.despliegue = true
  corte.soltar()
  const desenlace = limpio(await hasta(() => pagina.getByRole('alert').filter({ hasText: 'que se estaba enviando' }).allInnerTexts().then((t) => t.join(' ')), Boolean))
  const libre = await hasta(() => anular.getAttribute('aria-disabled'), (x) => x === null, 5000)
  comprobar(desenlace === 'La anulación que se estaba enviando no se registró: el sistema se actualizó mientras tenías la pantalla abierta. Vuelve a cargar la pantalla y envíalo otra vez.' && libre === null && !(await anulado()),
    `[Requerimientos 1280] 2. desde la pestaña vieja, en la fila: «${desenlace}»; el botón se libera y el ingreso sigue sin anular`)
  corte.despliegue = false
  // Ya sin la pestaña vieja, la anulación entra y la fila deja de ofrecerla.
  await anular.click()
  await v.waitFor({ timeout: 10000 })
  await v.locator('textarea[name="motivo"]').fill(`${marca} otra vez: se anotó la placa de otro vehículo`)
  await v.getByRole('button', { name: 'Anular', exact: true }).click()
  const entro = await hasta(anulado, Boolean, 15000)
  const cerrada = (await hasta(() => v.count(), (n) => n === 0, 10000)) === 0
  comprobar(Boolean(entro) && cerrada, `[Requerimientos 1280] 2. después, la anulación entra y la ventana se cierra (anulado ${entro})`)
  comprobar(errores.length === 0, `[Requerimientos 1280] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------------------- 3. «Reportar día» al girar el teléfono (OPERARIO del banco)
if (corre('3')) {
  // «Reportar día» es de las órdenes de antes del plan de etapas propio: en las
  // demás se reporta por tarea, con produccion.reportar_tarea, que el OPERARIO
  // no tiene, y la actividad sin etapa no entra. Toda orden nueva nace con plan
  // propio y la base no deja cambiarlo: en el banco, y solo aquí, la 0001-2026
  // vuelve a ser «de antes» con los disparadores apagados, como hace
  // probar-documentos-al-elegir. Antes la parte solo pasaba si esa suite había
  // corrido (vigesimonovena pasada).
  const [orden] = await consulta(`select id, plan_etapas_manual from ordenes_trabajo where numero = '0001-2026'`)
  const sinDisparadores = async (sql, valores) => {
    await consulta('begin')
    await consulta('set local session_replication_role = replica')
    await consulta(sql, valores)
    await consulta('commit')
  }
  if (orden?.plan_etapas_manual) await sinDisparadores(`update public.ordenes_trabajo set plan_etapas_manual = false where id = $1`, [orden.id])
  // La cuenta y la actividad, como postgres lo que no tiene pantalla en el banco
  // (no hay cuentas OPERARIO) y con la sesión de Diseño la actividad, que pasa
  // por su disparador. Peso 0: no mueve el avance de la orden.
  let [yo] = await consulta(`select id from usuarios where correo = $1`, [CUENTAS.operario])
  if (!yo) {
    ;[yo] = await consulta(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [CUENTAS.operario])
    await consulta(
      `insert into public.usuarios (id, nombres, apellidos, correo, rol_id, area_id)
       select $1, 'Operario', 'Banco del giro', $2, (select id from roles where codigo = 'OPERARIO'), (select id from areas where codigo = 'PRD')`,
      [yo.id, CUENTAS.operario],
    )
  }
  await consulta(`update auth.users set encrypted_password = crypt($2, gen_salt('bf')) where email = $1`, [CUENTAS.operario, CLAVE])
  // Activa solo mientras corre esta parte: al final se desactiva, y no queda una
  // cuenta OPERARIO con la clave del banco entre una suite y otra. Cambiar el
  // estado de un usuario es de administrador (fn_usuario_proteger_rol): aquí,
  // con los disparadores apagados.
  await sinDisparadores(`update public.usuarios set activo = true where correo = $1`, [CUENTAS.operario])
  try {
    const nombre = `Soldar refuerzos ${sello}`
    await consulta('begin')
    await consulta(`select set_config('request.jwt.claims', json_build_object('sub', (select id from usuarios where correo = $1), 'role', 'authenticated')::text, true)`, [CUENTAS.diseno])
    await consulta('set local role authenticated')
    const [act] = await consulta(
      `insert into ot_actividades (orden_id, area_id, nombre, referencia, peso_pct) values ($1, (select id from areas where codigo = 'PRD'), $2, 'GIRO', 0) returning id`,
      [orden?.id, nombre],
    )
    await consulta('commit')
    const avances = async () => (await consulta(`select nota, avance_pct, materiales_usados from ot_actividad_avances where actividad_id = $1 order by creado_en`, [act.id]))

    const { pagina, contexto, errores, corte } = await entrar(CUENTAS.operario, CELULAR)
    await ir(pagina, `${BASE}/ordenes/${orden?.id}?vista=actividades`)
    const deLaActividad = (sel) => pagina.locator(`#actividad-${act.id}:visible`).locator(sel)
    const boton = () => deLaActividad('button').filter({ hasText: 'Reportar día' })
    const ventana = pagina.locator('[role="dialog"]').filter({ hasText: nombre })
    const aLaVista = async () => limpio((await deLaActividad('[role="status"], [role="alert"]').allInnerTexts()).join(' | '))
    const enDom = await pagina.locator(`[id="actividad-${act.id}"]`).count()

    await boton().click()
    await ventana.waitFor({ timeout: 10000 })
    await ventana.getByRole('button', { name: '25 %' }).click()
    const marca = `Giro ${sello}`
    await ventana.locator('input[name="nota"]').fill(marca)
    corte.marca = marca
    await ventana.getByRole('button', { name: 'Reportar', exact: true }).click()
    const retenido = (await hasta(() => corte.retenidas, (n) => n >= 1)) >= 1
    await ventana.getByRole('button', { name: 'Cancelar' }).click()
    await hasta(() => ventana.count(), (n) => n === 0, 5000)
    const ocupado390 = await boton().getAttribute('aria-disabled')
    const dice390 = await hasta(aLaVista, (t) => t.includes('se sigue enviando'), 5000)

    await pagina.setViewportSize(GIRADO)
    await pagina.waitForTimeout(800)
    const ocupadoGiro = await boton().getAttribute('aria-disabled')
    const diceGiro = await aLaVista()
    const describeGiro = await loQueDescribe(boton())
    await boton().click({ force: true })
    await pagina.waitForTimeout(800)
    const abrio = await ventana.count()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-3-girado.png') })
    comprobar(enDom === 2 && retenido && ocupado390 === 'true' && dice390.includes('El reporte se sigue enviando'),
      `[Operario 390] 3. la actividad está dos veces en la página; cerrada en vuelo, «Reportar día» gira y dice que sigue (${enDom} copias, «${dice390}»)`)
    comprobar(ocupadoGiro === 'true' && diceGiro.includes('El reporte se sigue enviando') && describeGiro === 'El reporte se sigue enviando: lo que conteste se dice aquí.' && abrio === 0,
      `[Operario girado a 844] 3. el «Reportar día» que aparece sabe del envío: gira, lo dice y no abre otra ventana (aria-disabled ${ocupadoGiro}, «${diceGiro}», describe «${describeGiro}», ventanas ${abrio})`)

    corte.despliegue = true
    corte.soltar()
    const desenlaceGiro = await hasta(aLaVista, (t) => t.includes('que se estaba enviando'))
    await pagina.setViewportSize(CELULAR)
    await pagina.waitForTimeout(800)
    const desenlace390 = await aLaVista()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-3-desenlace.png'), fullPage: true })
    corte.despliegue = false
    comprobar(desenlaceGiro.includes('El reporte que se estaba enviando no se registró: el sistema se actualizó') && desenlace390 === desenlaceGiro && (await boton().getAttribute('aria-disabled')) === null && (await avances()).length === 0,
      `[Operario] 3. el desenlace sale en la copia a la vista, girado y de vuelta, y el botón se libera («${desenlaceGiro}»; a 390 «${desenlace390}»)`)

    // Y el reporte entra: el banco ya manda `[]` a la columna jsonb.
    await ir(pagina, `${BASE}/ordenes/${orden?.id}?vista=actividades`)
    await boton().click()
    await ventana.waitFor({ timeout: 10000 })
    await ventana.getByRole('button', { name: '25 %' }).click()
    await ventana.locator('input[name="nota"]').fill(`${marca} entra`)
    const verde = await vigilarElVerde(pagina, 'Avance del día reportado')
    await ventana.getByRole('button', { name: 'Reportar', exact: true }).click()
    const [fila] = await hasta(avances, (r) => r.length === 1, 15000)
    comprobar(fila && Number(fila.avance_pct) === 25 && Array.isArray(fila.materiales_usados) && fila.materiales_usados.length === 0,
      `[Operario 390] 3. el reporte del día entra, con materiales_usados [] (${JSON.stringify(fila?.materiales_usados)})`)
    // Al ponerse al día, la página cambia el «Reportar día» de hoy por «Corregir
    // el de hoy» y «Otro día»: el verde es de la actividad y se queda; antes se
    // iba a los 300 ms (vigesimonovena pasada).
    await hasta(() => deLaActividad('button, span').allInnerTexts().then((t) => /Corregir el de hoy|Reportado hoy/.test(t.join(' '))), Boolean, 15000)
    await pagina.waitForTimeout(1500)
    const verde390 = await aLaVista()
    const verdes = await verde.leer()
    await pagina.setViewportSize(GIRADO)
    await pagina.waitForTimeout(800)
    const verdeGiro = await aLaVista()
    await pagina.screenshot({ path: join(CAPTURAS, 'pestana-vieja-3-verde-girado.png') })
    comprobar(verde390.includes('Avance del día reportado.') && verdes[0] === true,
      `[Operario 390] 3. «Avance del día reportado.» sigue a la vista tras ponerse al día, y salió primero en una región montada desde antes («${verde390}», ${JSON.stringify(verdes)})`)
    comprobar(verdeGiro.includes('Avance del día reportado.'), `[Operario girado a 844] 3. la otra copia también lo dice («${verdeGiro}»)`)
    comprobar(errores.length === 0, `[Operario] sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await contexto.close()
  } finally {
    await sinDisparadores(`update public.usuarios set activo = false where correo = $1`, [CUENTAS.operario])
  }
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} falla(s).` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
