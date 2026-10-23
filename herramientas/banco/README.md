# Banco de pruebas

Levanta el sistema completo en la máquina, sin nube: una base Postgres con el
esquema y los datos de demostración, y un servicio que responde lo mismo que
Supabase —ingreso de sesión, datos y archivos— para que la aplicación funcione
igual que en producción.

Sirve para dos cosas:

1. **Comprobar de punta a punta antes de subir.** Se entra a la aplicación, se
   recorren las pantallas y se contrasta lo que muestran contra la base.
2. **Trabajar sin tocar los datos del cliente.** Nada de lo que se pruebe acá
   llega al proyecto real.

## Cómo se usa

```bash
BANCO_CLAVE='la-que-quieras' ./herramientas/banco/preparar.sh   # rehace la base local
node herramientas/banco/servidor.mjs                            # levanta el servicio (puerto 5599)
```

El servicio imprime al arrancar las tres variables que hay que darle a la
aplicación. Con ellas:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:5599 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<la que imprimió> \
SUPABASE_SERVICE_ROLE_KEY=<la que imprimió> \
npx next dev -p 3111
```

Con `next start` en vez de `next dev`, antes va `next build` con las mismas
variables: `next start` sirve el último build, no el código. El 2026-10-20 un
`next start` que sobrevivió a un cambio de rama sirvió un build de horas antes
y los recorridos dieron por buenas pantallas que ya no existían así. Y si el
banco viene de otra rama, `preparar.sh` otra vez: una base sin las últimas
migraciones hace caer pantallas que en producción abren.

Y para el recorrido automático de todas las pantallas:

```bash
BANCO_CLAVE='la-que-quieras' node herramientas/banco/recorrer.mjs
```

Entra con la cuenta de demostración, visita las rutas principales de todos los
módulos y los detalles disponibles en la propia base, comprueba un estado vacío,
anota el estado y el título de cada pantalla, recoge los errores de consola y
guarda las capturas. Termina con código distinto de cero si alguna pantalla
falló, así que sirve tal cual en una comprobación automática.

Y para lo que no se ve mirando pantallas —lo que pasa al apretar los botones—:

```bash
BANCO_CLAVE='la-que-quieras' node herramientas/banco/probar-aprobar-con-codigo-y-ot.mjs
```

Ventas sube la cotización en PDF, Gerencia la aprueba con su código interno y
su OT en una sola ventana, y Diseño recibe el aviso y abre el PDF de la OT. Hay
uno así por cada circuito, en la tabla de abajo. (El de la cotización que se
emitía en borrador se retiró el 2026-10-20: esa pantalla ya no existe y la
cotización se sube en PDF.)

La preparación local crea además una cuenta por puesto (ver «Las cuentas de
cada puesto»). Usan el valor local de `BANCO_CLAVE`; no son cuentas de la empresa
ni se crean en Supabase.

Para recorrer todas las pantallas con la cuenta de cada puesto, en monitor y en
teléfono, y ver qué pantallas fuera de su menú le dejan entrar:

```bash
BANCO_CLAVE='la-que-quieras' node herramientas/banco/recorrer-puestos.mjs [gerencia tesoreria …]
```

## Las cuentas de cada puesto

`preparar.sh` deja una cuenta `<puesto>.local@metalwork.test` por cada puesto que
tiene acceso en producción, con la clave de `BANCO_CLAVE`: `gerencia`,
`administracion`, `almacen`, `logistica`, `conductor`, `contabilidad`, `diseno`,
`colaborador`, `porteria`, `rrhh`, `requerimientos`, `sup.prd`, `sup.mtz`,
`sup.acb`, `tesoreria` y `ventas`. Son las que usan los `probar-*.mjs` y los
auditores. La supervisión es una por área: la de la demostración pasa a llamarse
`sup.prd.local` y conserva su historia.

## Si `preparar.sh` se cae

Desde el 2026-10-20 llega al final sola y `db-test.sh` rehace el esquema desde
cero. Cada migración corre en su transacción (`psql -1`), como las aplica
Supabase, y las tres que arreglan datos de producción
(`20260929110100_cuentas_solo_supervision`, `20260929180000_importar_catalogo_almacen`
y `20260929222000_corregir_numero_ot_2939`) no hacen nada en una base que no
tiene esas cuentas ni esa OT. Si vuelve a caerse, es que una migración nueva o
`db/demo/datos-demo.sql` quedó atrás del flujo: arreglarlo ahí, no saltarlo.

## Qué hay dentro

| Archivo | Qué hace |
| --- | --- |
| `preparar.sh` | Rehace la base: esquema, migraciones, empresa, cuenta de administración y datos de demostración. |
| `servidor.mjs` | El servicio: sesión, datos y archivos, en un solo puerto. |
| `rest.mjs` | Traduce las peticiones de datos a SQL. |
| `esquema.mjs` | Lee las claves foráneas para resolver las incrustaciones. |
| `recorrer.mjs` | Recorre la aplicación con un navegador y deja el informe y las capturas. |
| `recorrer-puestos.mjs` | Lo mismo con la cuenta de cada puesto: cada pantalla de su menú en monitor y en teléfono (sin permiso, error, consola, 5xx, tiempo, desborde) y las pantallas fuera de su menú que le dejan entrar. |
| `probar-reporte-diario.mjs` | El reporte diario de supervisión con la cuenta de cada puesto: el supervisor lo sube desde el celular con fotos que se achican, el tope de 16 horas, RR. HH. ve las horas en el costeo y las que esperan su costo, Gerencia consulta y la portería no entra. Crea su propio personal inventado; las cuentas `*.local@metalwork.test` se crean aparte. |
| `probar-planilla-diaria.mjs` | Del reporte diario a la planilla diaria, con la cuenta de cada puesto: Gerencia y RR. HH. validan (cada una solo con su botón), Gerencia observa y el supervisor corrige y sube de nuevo, RR. HH. paga o reserva las horas que pasan de 8 y usa el saldo, manda la planilla, Tesorería ve las cuentas, paga en lote con comprobante y adjunta boletas, RR. HH. las entrega; Gerencia consulta sin cuentas y el supervisor y la portería no entran. Crea su propio personal inventado. |
| `probar-reimportar-planilla.mjs` | RR. HH. importa el Excel de la planilla y vuelve a cargar en la misma planilla el libro corregido, con las filas corridas: la persona nueva cae en la fila que ya tenía otra de la primera carga y entra igual; las de antes salen como «ya está»; la del nombre corregido se avisa; a mano en otra planilla del mes no entra, y RR. HH. quita de la planilla en borrador a quien entró por error. Crea su propia planilla en un mes de 2090 en adelante. |
| `probar-subcontratos.mjs` | Un subcontrato de punta a punta, con la cuenta de cada puesto: Administración da de alta al subcontratista (un RUC de empresa no entra), registra el subcontrato con su código interno y sube un recibo por honorarios con la retención del 8 %; Tesorería lo paga desde el teléfono con su voucher; Administración ve el pago; Contabilidad y Gerencia consultan sin botones y Logística no entra. Crea su propio subcontratista inventado; las cuentas `*.local@metalwork.test` se crean aparte. |
| `probar-pagos-mueven-la-caja.mjs` | Los pagos y cobros que mueven la caja diaria, con la cuenta de Tesorería: cada pago (factura de compra, orden de servicio, recibo por honorarios, planilla diaria) y el cobro de una factura de venta piden la cuenta, dejan un solo movimiento aunque se toque tres veces, piden lo que salió de la cuenta si es de otra moneda, y al anular el pago se anula su egreso; la caja los muestra con dónde se anulan y Gerencia no paga. Arma sus documentos y dos cuentas de prueba. |
| `probar-archivos-con-politicas.mjs` | Los archivos piden lo mismo que en Supabase Storage: quien subió una foto la firma y la descarga, una ficha falsa o de otro archivo no abre nada, Ventas no firma, descarga, sube ni quita lo que su política le tapa, y sin sesión no sale nada. Usa archivos que el banco ya tiene. |
| `probar-captura-del-saldo.mjs` | La captura del saldo con que se abre cada cuenta de la caja, y los menús que DKS ordenó el 2026-10-20, con las cuentas de Tesorería, Contabilidad y Gerencia: un banco nuevo no entra sin su captura, la cuenta la nombra y «Ver la captura del saldo» la abre; la caja chica la adjunta después; con movimientos ya no se cambia. Contabilidad registra el tipo de cambio y no entra a los requerimientos; Tesorería ya no entra al tipo de cambio. Mira `storage.objects` después de cada clic. |
| `probar-gerencia-consulta-y-no-registra.mjs` | Gerencia consulta y no registra (decisión del 2026-10-20): el almacén y Logística ven sus botones en el kardex y en las compras, Gerencia abre las mismas pantallas sin ninguno, aprueba un trabajo sin orden pero no registra uno, sigue con «Anular» en una OT, y el catálogo de materiales, la gestión de recojos y el alta de un trabajo sin orden la mandan a «sin permiso». |
| `probar-elegir-archivo.mjs` | El campo para elegir un archivo, con la cuenta de RR. HH. en «Importar del Excel», en teléfono y monitor: dice qué pide y su tope sin el botón del navegador, sin archivo no envía, un .txt muestra su nombre entero y avisa que no es Excel —y el servidor lo recibe y lo rechaza—, uno de 6 MB avisa su peso y al reabrir queda como nuevo. Crea una planilla en preparación si no hay. |
| `probar-documentos-al-elegir.mjs` | El mismo campo donde el archivo se lee o se sube apenas se elige, con la cuenta de cada puesto, en teléfono y monitor: Ventas al subir y al corregir la cotización, Gerencia con el PDF de la OT al aprobar, Administración con el PDF de una orden sin cotización (el falso no se sube; el bueno queda en la orden), Diseño con el Excel del cronograma (.xls, dañado y la plantilla) y Almacén con la foto de cada salida de la planilla sin internet. Arma una cotización QA-DOC-… y, solo en el banco, vuelve «de antes» una orden de demostración para que ofrezca el cronograma. |
| `probar-documentos-en-el-borde.mjs` | Los bordes del mismo campo, con la cuenta de cada puesto, en teléfono y monitor: la foto de una salida que no sube deja «Registrar lo que falta» y la salida entra sin duplicar el ingreso; el conteo con el reloj del equipo adelantado se rechaza en la fecha, con el día del sistema y el foco ahí; el PDF corregido con el mismo nombre se distingue por la hora y al quitar el foco vuelve a «Cambiar el PDF»; con un archivo que no sirve, el envío se queda en el archivo; el Excel del cronograma sin señal o sin respuesta dice lo que de verdad pasó. Correr después de `probar-documentos-al-elegir.mjs`, que deja la cotización y la orden. |
| `probar-archivo-sin-dejarlo-suelto.mjs` | El archivo que se elige o se sube y no queda, en teléfono y monitor y con la cuenta de cada puesto: con Logística, el comprobante opcional de la OC directa se quita con «Quitar» (lo nombra, llega con el teclado, vacía el campo y deja el foco en él) y el obligatorio de RR. HH. no lo ofrece; lo leído se va con el archivo: el número y la fecha en la OC directa, y en el registro de Contabilidad el total, el número, la emisión y la OC que marcó la lectura, con el proveedor, la condición y la moneda que puso; lo escrito o marcado a mano se queda, y la OC de la factura de Logística que sigue elegida también, y con ella un PDF vacío no se registra; sin PDF ni factura de Logística lo dice el campo del PDF, como lo que dice el servidor del PDF, que se va al quitarlo, y el borrador que quedó sin su PDF se dice abajo con su número, la lista lo muestra sin recargar, el formulario vuelve vacío, se completa desde su fila y el aviso se va solo; el borrador al que no se le pudo marcar la OC como parcial nombra la OC y lo que queda por hacer con «Corregir» (si lo frenó una regla de la base, solo su motivo; si faltó el permiso, avisar al administrador; si chocó con otra escritura, el motivo en castellano), y al completarlo el cursor va al «listo», que lo recuerda, sin que la página salte si se rodó mientras esperaba; la moneda tocada antes de elegir nada no le gana a la fuente que la pisó; la factura vacía de la OC directa se dice sin llamar al servidor, la que no sube por un permiso dice por qué, el segundo documento de la misma OC entra sin recargar, y si la subida de otro archivo llega sin respuesta, volver al primero no anota su nombre con el otro adentro, y si el primero sí quedó, se confirma; con Administración, el PDF de una orden cuando se pierde la conexión al anotarlo (el pedido no llegó, se perdió la respuesta, sin señal las dos veces: una sola fila y ningún archivo suelto; sin el tamaño, el rechazo en castellano), la orden nueva con la respuesta perdida, el contrato que no se da por adjunto si después se elige otro archivo (y que lo reemplaza si el primero no quedó, también con una foto en vez del PDF, sin dejar el PDF suelto; y si el PDF quedó, después de la foto otro PDF tampoco se da por adjunto) y el recibo vacío; con Tesorería, la captura de una cuenta nueva que pasa de JPG a PNG tras una respuesta perdida, también con la primera subida de la PNG cortada, sin dejar la JPG suelta, y tras el rechazo el cursor en el aviso, con el botón a la vista; y si el contrato quedó con una foto y el PDF siguiente no llega, no se dice «No quedó registrado»; si Storage rechazó el PDF o su subida se cortó y la foto siguiente no llega, sí, sin nombrar el PDF; y si Storage guardó el PDF pero la pasarela contestó 504, al entrar la foto el PDF no queda suelto; con Ventas y Gerencia, la cotización subida, corregida y aprobada con OT con la respuesta perdida, lo escrito antes de que termine la lectura que se queda (con el año de la OT, y la fecha, que avisa si el PDF dice otra), el monto distinto del leído que se avisa en ámbar, el número repetido que se dice junto a su campo y el pedido sin el tamaño del archivo; con Diseño, el PDF de un plano. Cada segunda vuelta reconoce lo suyo y no duplica. Al terminar quita sus comprobantes «QA proveedor …» (con su PDF y el enlace a su OC), sus adjuntos y documentos QA-SUELTO-… y sus disparadores de prueba, y desactiva sus cuentas «QA CAJA …» (una cuenta no se borra), que quedan con su captura; la orden, la cotización, el plano de banco, la OC directa emitida y los contratos QA-OTRO-… del subcontrato se quedan (un documento no se borra). Si el proceso muere por una señal, la corrida siguiente quita al empezar los comprobantes y los disparadores que dejó, de cualquier sello, y desactiva sus cuentas; sus adjuntos QA-SUELTO se quedan. Dos corridas a la vez sobre la misma base se pisan: no se lanzan juntas. |
| `probar-pdf-de-la-os.mjs` | El PDF de la orden de servicio, con la cuenta de cada puesto: Logística ve «PDF» solo en la aprobada y en la anulada después de aprobarse (también en el teléfono); el clic descarga, no abre otra ventana, y el texto del PDF trae número, contratista con RUC, OT, código, montos, detracción y firmas, y en la anulada la marca, el motivo y quién la anuló; la por aprobar y la rechazada dan 409; Almacén descarga con la OT aunque no lea las OT, y un supervisor va a «sin permiso». Necesita `pdftotext` |
| `caja-de-prueba.mjs` | Ayudante de las pruebas que pagan o cobran: da de alta una cuenta de prueba y la elige en la ventana, porque desde la migración `20261019100000` cada pago pide su cuenta. |
| `con-react.mjs` | Ayudante: `esperarReactAlNavegar(pagina)` hace que cada `goto` y `reload` espere a que React tome cada control de la pantalla. `networkidle` llega antes en una lista larga, y el primer clic se perdía. |
| `consulta-del-envio.mjs` | Ayudante: reconoce la pregunta que hace la ventana al volver a abrirse (`consultarEnvio(clave, id, cuenta)`), para las suites que la detienen y comprueban que de verdad se detuvo. |

## Lo que respeta y lo que no

**Respeta las reglas de seguridad.** Cada petición corre dentro de una
transacción con `set local role` y los datos de la sesión, así que las políticas
de la base se aplican igual que en Supabase: si una política tapa una fila, acá
también la tapa. Es lo que permite probar de verdad qué ve cada rol.

**Los archivos también.** Subir, firmar un enlace, descargar con sesión y quitar
le preguntan a las políticas de `storage.objects` con el rol de la sesión, como
Supabase Storage. Lo que la política tapa vuelve como «Object not found», la
subida que no le corresponde da «new row violates row-level security policy»
y el borrado ajeno no quita nada. El enlace firmado se entrega solo con su
ficha, que no abre otro archivo. Hasta el 2026-10-20 el banco firmaba y servía
cualquier archivo sin preguntar: una pantalla podía abrir un PDF que Supabase
habría rechazado. Lo que no imita es el tamaño máximo y los tipos permitidos
de cada cubeta, ni las transformaciones de imagen.

**Las funciones devuelven lo mismo que en Supabase.** Una `returns table
(codigo text)` sale como `[{"codigo": "…"}]`, y una `returns setof text`, sin
columnas con nombre, como `["…"]`. Hasta el 2026-10-21 el banco entregaba las
dos como objetos; hoy ninguna función es de la segunda forma, pero la primera que
lo fuera habría salido bien en el banco y rota en producción.

**Falla en voz alta.** Ante cualquier cosa que no sepa traducir responde 501 con
el motivo, nunca una lista vacía. Una pantalla vacía se parece demasiado a una
pantalla correcta sin datos, y esa confusión es justamente lo que haría inútil
la comprobación.

**No adivina relaciones.** Cuando hay más de un camino entre dos tablas exige la
pista explícita (`usuarios!nombre_de_la_clave`), igual que Supabase. Elegir uno
por cuenta propia escondería acá un error que en producción sí ocurre: así se
encontró que la pantalla de cotizaciones se rompía, porque `cotizaciones` apunta
dos veces a `unidades`.

**Traduce lo que la aplicación usa, no todo lo que existe.** Selección con
incrustaciones y conteos, filtros, orden, rango, conteo exacto, altas, cambios,
bajas y llamadas a función. Lo demás —vistas materializadas de la API, formatos
distintos de JSON, `upsert`, filtros sobre incrustaciones anidadas— no está: si
la aplicación empieza a usarlo, el banco lo dirá con un 501 y habrá que
agregarlo acá.

**Las contraseñas se pasan al ejecutar, nunca escritas acá.** La de la cuenta de
administración local es la que reciba `preparar.sh` en `BANCO_CLAVE`, y el resto
del personal de demostración se crea sin contraseña: existe como ficha pero no
puede entrar hasta que se le asigne una con `db/demo/claves-demo.sql`. Lo que se
escribe en el repositorio deja de ser secreto, y este repositorio es público.
