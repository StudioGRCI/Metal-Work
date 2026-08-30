# Análisis del OneDrive de Metal Work Perú

Lo que sigue no es una propuesta: es lo que la empresa ya hace, leído de sus
propios archivos en `metalworkperusac-my.sharepoint.com`. Sirve para dos cosas
—justificar los cambios de la migración `20260101000012` y dejar anotado lo que
todavía falta contrastar.

**Alcance.** Solo Metal Work Perú S.A.C. JAMISA S.A.C. comparte el mismo
OneDrive y aparece en varios formatos compartidos, pero queda fuera por
indicación expresa.

---

## 1. La empresa

| Dato | Valor | Fuente |
| --- | --- | --- |
| Razón social | METAL WORK PERÚ S.A.C. | `ORDEN DE SERVICIO - 2026.xlsm` |
| RUC | 20601538840 | idem |
| Dirección | Covicorti Mz. T Lt. 7 Dpto. 401, Trujillo — La Libertad | idem |
| Celular | 957994729 | idem |

---

## 2. Numeración real

Esto era lo más urgente de corregir: el sistema numeraba `OT-001-02920` y la
empresa numera de otra forma. Los últimos números emitidos que se encontraron:

| Documento | Formato real | Último visto |
| --- | --- | --- |
| Orden de trabajo | `2909-2026` — correlativo global y año | **2920** |
| Cotización | `3567 – 2025` — correlativo global y año | **3567** |
| Orden de compra | `OC-5580-MW` — prefijo, número y sigla | **5580** |

El correlativo de OT es **global y continuo**, no se reinicia cada año: la OT
2879 es de enero de 2026 y la 2920 de junio de 2026.

Las órdenes de compra tienen una carpeta por número en
`7. ALMACEN/1. CONTROL DE RECEPCION - ALMACEN/COMPRAS 2026/1. METAL WORK PERU/OC-5580-MW`,
con la evidencia de recepción dentro.

Las cotizaciones se archivan por mes: `1. COTIZACIONES METAL WORK/8.AGOSTO`.

> Implementado: `series_documentarias.formato` con plantilla
> (`{prefijo} {serie} {numero} {anio}`) y los correlativos puestos al día. El
> sistema ya emite `2921-2026`, `3568-2026` y `OC-5581-MW`.

---

## 3. Organigrama y códigos de área

De `PROYECTO SIG - MWP/CODIFICACION DE AREAS.xlsx`, hoja **Organigrama**.
Los códigos de tres letras no son decorativos: son el segmento central de todo
código documental de la empresa.

| Código | Área | Encargado | | Código | Área | Encargado |
| --- | --- | --- | --- | --- | --- | --- |
| GGE | Gerencia General | | | REQ | Requerimientos | Fernando |
| GCO | Gerencia Comercial | | | ING | Ingeniería | Ingenieros de diseño |
| GOP | Gerencia de Operaciones | | | DIS | Diseño | Frank |
| ADM | Administración | | | MTZ | Maestranza | Edson |
| RRH | Recursos Humanos | Shantal | | PRD | Producción | Santiago |
| MKT | Marketing | | | ACB | Acabados | Santiago |
| CON | Contabilidad | Greys | | MNT | Mantenimiento | Diego |
| TES | Tesorería | Margarita | | GRT | Garantías | Diego |
| LOG | Logística | Viviana | | CAL | Calidad | |
| ALM | Almacén | Jesús | | SST | SSOMA | |
| | | | | TIC | TI / Soporte | |

> Implementado: tabla `areas` con las 21 filas y `usuarios.area_id`. El área no
> sustituye al rol: el rol otorga permisos, el área agrupa el trabajo en el
> tablero de unidades.

---

## 4. Codificación documental (SIG)

Todo documento se codifica **`MW-{TIPO}-{ÁREA}-{N°}`**. Ejemplos reales
encontrados: `MW-FOR-ADM-7`, `MW-PRO-ING-1`, `MW-FOR-DIS-3`, `MW-FOR-MTZ-2`,
`MW-MAN-RRH-01`.

Los 13 tipos del estándar: `MAN` manual · `PRO` procedimiento · `INS`
instructivo · `PLN` plan · `POL` política · `ESP` especificación · `FOR`
formato (plantilla) · `REG` registro (evidencia) · `MAT` matriz · `PRG`
programa · `IRG` instructivo de registro · `DEX` documento externo · `DOC`
documento.

La distinción **FOR / REG** es la que importa para el sistema: el *formato* es
la plantilla en blanco, el *registro* es esa plantilla ya llena, que es la
evidencia. Es exactamente la relación `tipos_documento` → `documentos` que ya
existía.

> Implementado: catálogo `tipos_documento_sig`, y en `tipos_documento` las
> columnas `tipo_sig`, `area_codigo`, `correlativo_sig` más `codigo_sig`
> **generada**. El código no se escribe a mano: se arma de la misma fila, así
> que nunca puede haber un `MW-FOR-ADM-7` colgando del área de diseño.

Formatos ya identificados, pendientes de cargar cuando se complete la lista:

| Código | Documento |
| --- | --- |
| `MW-FOR-ADM-7` | Implementación de control de unidades |
| `MW-PRO-DIS-1` | Procedimiento del área de diseño |
| `MW-FOR-DIS-1` | Control de cambios de diseño |
| `MW-FOR-DIS-2` | Control dimensional de unidades |
| `MW-FOR-DIS-3` | Check list de revisión y entrega de planos |
| `MW-FOR-DIS-4` | Planos generales culminados |
| `MW-FOR-DIS-5` | Plano de distribución de cargas |
| `MW-PRO-ING-1/2/3` | Procedimiento de fabricación / carrocería montada / modificación |
| `MW-FOR-ING-1/2/3` | Informe de ingeniería / evaluación de personal / de contratistas |
| `MW-FOR-MTZ-2` | Control de calidad en la recepción de materias primas |
| `MW-MAN-ACB-1` | Manual de operatividad del área de acabados |
| `MW-MAN-RRH-01` | Manual de Organización y Funciones |

---

## 5. Etapas reales de fabricación

De `1. METAL WORK PERU S.A.C/FECHAS DE LOS PROCESOS DE FABRICACIÓN- ACTUAL.xlsx`
(85 hojas: una por OT, más la hoja `MODELO`).

Las etapas que traía el sistema eran las de un taller de soldadura genérico
—habilitado, armado, soldadura, esmerilado, masillado—. Las de Metal Work son
otras, y la diferencia es de fondo: **su cuello de botella no está en el taller,
está en conseguir el material a tiempo.** Cinco de sus catorce etapas
(requerimientos ×2, logística, aprobación de cotizaciones, almacén) ocurren
antes de que alguien encienda una máquina.

| # | Etapa | Días |
| --- | --- | --- |
| 1 | Emisión de orden de trabajo | 1 |
| 2 | Diseño | 13 |
| 3 | Requerimientos · Maestranza | 10 |
| 4 | Requerimientos · Producción | 12 |
| 5 | Logística | 17 |
| 6 | Aprobación de cotizaciones | 16 |
| 7 | Almacén | 17 |
| 8 | Habilitado de materia prima | 12 |
| 9 | Producción · Ensamblado | 15 |
| 10 | Arenado | 1 |
| 11 | Pintura | 6 |
| 12 | Sistema eléctrico y neumático | 1 |
| 13 | Pruebas de la unidad · Control de calidad | 1 |
| 14 | Trámite documentario · Entrega · Check list | 1 |

Los días suman 123 pero el plan maestro es de **45 días**, porque las etapas se
solapan: `DISEÑO 15 + MAESTRANZA 20 + PRODUCCIÓN Y ACABADOS 10 = 45`. Por eso
casi todas van marcadas como `permite_paralelo`.

### Reglas de plazo que la empresa tiene escritas

- La **OS de producción** se genera **3 días después** de emitida la OT, con precio cerrado.
- La **OS de acabados** se genera **1 día antes del arenado**, con precio.
- **Diseño de unidad**: 4 días desde la OT.
- **Certificados**: 2 días hábiles. **Tarjeta de propiedad y placas**: 15 días hábiles.
- Las fechas se cuentan en **días hábiles saltando domingos** (la hoja usa
  `IF(WEEKDAY(fecha)=7, fecha+3, fecha+1)`).

> Implementado: las 14 etapas con su `dias_estandar`, y el catálogo anterior
> apartado (`activo = false`) en lugar de borrado, por si alguna OT histórica
> llegara a referenciarlo. **Las cinco reglas de plazo de arriba todavía no
> están automatizadas** — ver §8.

---

## 6. Control de unidades — formato MW-FOR-ADM-7

De `1. ADMINISTRACION/7. CONTROL DE PRODUCCION/CONTROL DE AREAS - ADMI.xlsx`.
Una hoja por unidad (`30-TRAMINCSA`), con cabecera:

```
Carrocería: TOLVA VOLQUETE DE 23 M3 03 EJES - CON TIRO SUSPENSIÓN MECÁNICA
Cliente: TRAMINCSA S.A.C          Código interno: VSC_SR_O4_6_26/30
Orden de Trabajo: 2909-2026       Inicio: 01/07/2026   Término: 14/07/2026
```

Y un cuadro por área **A–F** con sub-ítems:

| | Área | Sub-ítems |
| --- | --- | --- |
| A | Diseño | 6 |
| B | Requerimientos | parte estructural y materia prima · accesorios estructurales · sistema mecánico · neumático · eléctrico · hidráulico · pintura y logueado |
| C | Maestranza | 6 |
| D | Producción | + arenado |
| E | Acabados | + enllantado |
| F | Diseño, trámites y placas | diseño (5 d) · certificado · tarjeta · placas |

Columnas por fila: cantidad de días, fecha de inicio, fecha de finalización,
**estado**, **controles de calidad**, **estado final**, y un diagrama de barras
con `P` (planificado) y `T` (real) por día hábil.

### Estados

La lista desplegable del archivo tiene seis: *Sin iniciar · En curso ·
Completado · En espera · Atrasada · Necesita revisión*.

| Suyo | En el sistema |
| --- | --- |
| Sin iniciar | `PENDIENTE` |
| En curso | `EN_PROCESO` |
| En espera | `PAUSADA` |
| Completado | `TERMINADA` |
| Necesita revisión | `REQUIERE_REVISION` — **agregado** |
| Atrasada | *derivado*, no se guarda |

«Atrasada» no se agrega como estado a propósito: es una condición que depende
de la fecha de hoy. Guardarla obligaría a alguien a repasar el tablero cada
mañana cambiando estados a mano, y el día que no lo haga el tablero miente. Se
calcula.

---

## 7. Flujo real del documento

Del flujograma de mantenimiento y del `PROCESO DE SIG -MWP.vsdx`:

```
Ingresa la unidad
  └ Requerimientos hace el check list (¿garantía o mantenimiento?)
      └ Requerimientos coordina con Producción → emite cotización o informe
          └ Gerencia de Operaciones aprueba  ─── no aprueba → vuelve a Requerimientos
              └ Administración emite la ORDEN DE TRABAJO
                  ├ la registra en «Avance de Unidades» y en «Fechas de los procesos»
                  └ si es mantenimiento, avisa a Cuentas por Cobrar
                      └ Diseño coordina y pide material a Requerimientos
                          └ Maestranza recibe planos y entrega material habilitado
                              └ Requerimientos registra materiales; Logística descarga
                                  └ Administración emite la ORDEN DE SERVICIO al contratista
                                      └ Producción ejecuta
                                          └ Calidad revisa  ─── no conforme → Maestranza corrige
                                              └ Requerimientos verifica contra la OT
                                                  └ TESORERÍA confirma que el cliente NO tiene deuda
                                                      └ Contabilidad emite guía si corresponde
                                                          └ CHECK LIST DE SALIDA → Portería
```

Dos reglas del flujo que el sistema debe hacer cumplir y hoy no:

1. **La unidad no sale si el cliente tiene deuda.** Tesorería libera; recién
   entonces Requerimientos coordina la salida.
2. **Portería no deja salir sin check list de salida** firmado por
   Requerimientos.

---

## 8. Lo que falta

Ordenado por lo que más duele:

1. **Liberación de tesorería antes de la entrega.** Hoy `ot_entregas` exige
   acta de conformidad y documentos obligatorios, pero no comprueba deuda del
   cliente. Es una regla que la empresa ya tiene escrita y que el sistema
   debería imponer, no recordar.
2. **Check list de salida** como documento obligatorio de cierre, con la
   confirmación a portería.
3. **Las cinco reglas de plazo del §5** (OS de producción a los 3 días, OS de
   acabados 1 día antes del arenado, etc.) calculadas automáticamente en días
   hábiles saltando domingos, al crear la OT.
4. **Sub-ítems por área** del formato MW-FOR-ADM-7. Hoy una etapa es atómica;
   ellos llevan hasta 7 sub-ítems por área con estado propio.
5. **Órdenes de servicio (OS) a contratistas.** Aparecen en todo el flujo y no
   existen como entidad: hoy se aproximan con `servicios_terceros`.
6. **Lista completa de formatos codificados.** Se leyeron las hojas GCO, ING y
   DIS de `CODIFICACION DE AREAS.xlsx`; faltan MTZ, PRD, ACB, ALM, REQ, LOG,
   ADM y RRH para cargar el catálogo documental entero.
7. **Los 30 accesorios y los 18 pasos de verificación** del formato de OT
   (§«Accesorios» y §«Verificación y funcionamiento»), que hoy no tienen dónde
   registrarse con su V°B°.
8. **Reglas del código interno de unidad.** Se guarda el campo, pero no se ha
   descifrado qué significa cada segmento de `VSC_SR_O4_6_26/30` — hace falta
   que alguien de la empresa lo explique para poder validarlo o generarlo.

---

## 9. Codificación de almacén

De `PROYECTO SIG - MWP/PROYECTO DE CODIFICACION DE ALMACEN 2026/PROYECTO
CODIFICACION ALMACEN -MWP.xlsx` (20 hojas, una por persona del área más las de
catálogo). Es un proyecto en curso de 2026, no un documento histórico.

**El código de material tiene cinco segmentos:**

```
FAMILIA - SUBFAMILIA - MATERIAL - TIPO - CORRELATIVO
```

Ejemplos reales del archivo: `MP-PL-AC-HX-0001`, `MP-BR-AS-RS-0001`,
`MP-PR-AL-PT-0001`, `MP-TB-AC-RD-0001`.

| Familia | Código | Qué agrupa |
| --- | --- | --- |
| Materia prima | `MP` | Planchas, perfiles, tubos, ángulos, aluminio, acero, FRP |
| Materiales de producción | `MT` | Lijas, discos, abrasivos, adhesivos, tornillería |
| Repuestos mecánicos | `RP` | Frenos, suspensión, motor, transmisión |
| Repuestos eléctricos | `RE` | Baterías, cableado, luces, alternadores |
| Pintura y químicos | `PQ` | Pinturas, primers, solventes, catalizadores |
| Accesorios | `AC` | Cierres, bisagras, burletes, emblemas |
| Equipos y maquinaria | `EQ` | Cortadora, plasma, compresores, taladros |
| Herramientas | `HE` | Llaves, alicates, taladros, esmeriles |
| Consumibles e insumos | `CO` | Guantes, trapos, EPP, silicona, lubricantes |
| Instrumentos | `IN` | Los que requieren calibración |
| Sistema hidráulico | `SH` | Bombas, válvulas, cilindros, mangueras, racores, filtros, sellos |
| Sistema neumático | `SN` | Válvulas, bolsas de aire, muelles, conectores |

**Subfamilias de materia prima:** `PL` planchas · `PR` perfiles · `TB` tubos ·
`BR` barras · `FB` FRP y fibra.

**Material:** `AC` acero ASTM A36 · `IN` inoxidable · `AL` aluminio · `AN` acero
negro · `AG` galvanizado · `AS` SAE 1045.

**Tipo**, que depende de la subfamilia:

| Subfamilia | Tipos |
| --- | --- |
| Planchas | `ET` estriada · `ST` Strenx · `HX` Hardox |
| Tubos | `RD` redondos · `RT` rectangulares · `CO` cuadrados |
| Perfiles | `PT` platinas · `VG` vigas · `CN` canales · `AG` ángulos |
| Barras | `RS` redonda sólida · `RP` redonda perforada · `RO` roscada · `CD` cuadrada |

**La descripción también está normalizada:**
`[Tipo] [Material/Parte] [Medida] [Norma/Grado] [Uso]`, por ejemplo
`PLANCHA ACERO A36 6.0MM 1500X6000`.

**El producto terminado usa su propio esquema**, `FAMILIA-SUBFAMILIA-MEDIDA-CORRELATIVO`
(`VO-SM-STD-0001` = volquete estándar): `VO` volquetes · `TO` tolvas ·
`CI` cisternas · `MX` mixers · `CO` compactadoras · `PL` plataformas ·
`CB` cama baja; subfamilia `SM` semirremolque o `RE` remolque.

**Ubicaciones físicas (LOC):** pasillo–rack–nivel–posición.

### Qué le falta a la ficha de material

El archivo enumera lo que el área espera de cada producto. Contrastado con la
tabla `materiales` actual, faltan:

- los cinco segmentos del código como campos estructurados, para poder armarlo
  y validarlo en vez de escribirlo a mano
- **criticidad A/B/C** — es lo que decide qué se compra primero cuando falta plata
- ubicación por defecto y el mapa de ubicaciones
- código del proveedor, distinto del código interno
- costo de reposición, además del promedio ponderado que ya se calcula
- control por lote, serie o caducidad como banderas por material

> Nada de esto está implementado todavía.

---

## 10. Los formatos del área de almacén

`PROYECTO SIG - MWP/9) Almacén ( ALM)` tiene siete formatos, y varios son
justamente los que el sistema da por existentes:

| Formato | Relación con el sistema |
| --- | --- |
| Control de calidad de materia prima | Es la inspección que la etapa `ALMACEN` exige y que la aplicación no tiene |
| Recepción por unidad | Recepción de compra ligada a la OT |
| Inventario según kardex | El kardex ya existe en base; falta contrastar columnas |
| Entrega de consumibles por unidad | Salida de almacén imputada a la OT |
| Entrega de herramientas | No modelado: herramienta prestada, no consumida |
| EPP | No modelado |
| Mapa de ubicación de productos | Ubicaciones físicas, no modeladas |

El área de almacén también mantiene su matriz IPERC, que pertenece a SSOMA y
queda fuera del alcance de este sistema.

---

## 11. Mapa del sistema documental

`PROYECTO SIG - MWP` tiene una carpeta numerada por área, y ese número es el
orden del proceso, no un capricho alfabético:

```
8)  Logística (LOG)        11) Ingeniería (ING)     14) Producción (PRD)
9)  Almacén (ALM)          12) Diseño (DIS)         15) Acabados (ACB)
10) Requerimientos (REQ)   13) Maestranza (MTZ)     16) Mantenimiento (MNT)
                                                    18) SSOMA (SST) — vacía
```

Más `FORMATOS GENERALES`, `CODIFICACION DE AREAS.xlsx`, el flujograma
`PROCESO DE SIG -MWP.vsdx` y `1. CRONOGRAMA DE AVANCE - SIG.xlsx`.

La numeración empieza en 8 porque las áreas 1 a 7 —las administrativas— viven
fuera de esta carpeta, en `1. ADMINISTRACION`, `3. TESORERIA`, `5. INGENIERIA`
y `7. ALMACEN` en la raíz del OneDrive.

---

## 12. Cómo costea la empresa

Lo que sigue no estaba en este documento hasta el 2026-08-30 y es la pieza que
más lejos deja al sistema de la realidad: las `cotizacion_partidas` se diseñaron
sin haber visto un solo costeo suyo.

### Quién y cuándo

El costeo es **posterior a la fabricación, no previo a la cotización**. Lo dice
`4. LOGISTICA 2026/ESTRUCTURA LOGISTICA - 2026.pdf`: «se registran los costeos de
forma mensual por unidades que ya se culminaron compras». Lo lleva **una sola
persona** —Fernando, en todos los registros de 2026— y se controla en
`6. REQUERIMIENTOS/COSTEOS DE EMPRESAS/SEGUIMIENTO DE COSTEOS.xlsx`, con tres
hojas separadas —MWP, JAMISA y GARANTÍAS— y tres estados: **NO INICIA · EN
PROCESO · CULMINADO**, con su fecha de culminación.

El archivo se nombra `COSTOS - OT N° - UNIDAD - CLIENTE - MW - FECHA DE
CULMINACIÓN`, y los de garantía `COSTOS - GT - OT N° - …`.

### La hoja de detalle

Una fila por compra, en `4. LOGISTICA 2026/1. COSTEOS/<mes>/<empresa>/`:

| Columna | Qué es |
| --- | --- |
| CLASIFICACIÓN | El grupo del oficio. Se escribe una vez y las filas siguientes van en blanco |
| FECHA DE REQUERIMIENTO | Cuándo se pidió; una misma clasificación tiene varias fechas |
| DESCRIPCIÓN | El material con su medida exacta: «PLANCHA A36 3/8" x 1500 x 6000 mm» |
| REQUERIDO | Cantidad, con decimales: 0,2 de una plancha es lo que se consumió |
| U.M | UND, METROS, GL, BALDES, JUEGO, BOLSA |
| VALOR VENTA S/ | Precio del proveedor, sin IGV |
| VALOR VENTA $ | = VALOR VENTA S/ ÷ T.C. |
| SUBTOTAL | = REQUERIDO × VALOR VENTA $ |

Al pie: SUBTOTAL, IGV (18 %) y TOTAL. El tipo de cambio va en la cabecera junto
al cliente, y de ahí salen todas las conversiones. Cuando el precio del
proveedor viene con IGV, la celda lo divide entre 1,18 a mano.

**La clasificación no es un enum de cuatro valores.** En una sola tolva
aparecieron: ESTRUCTURA · PINES Y BOCINAS · ACCESORIO ESTRUCTURAL · COMPUERTA DE
TOLVA · SISTEMA ELÉCTRICO · ACCESORIOS · ACCESORIOS SISTEMA HIDRÁULICO · SISTEMA
NEUMÁTICO · CONECTORES SISTEMA HIDRÁULICO · SISTEMA DE LEVANTE DE PORTA LLANTAS ·
PERNERÍA · SISTEMA DE ENGRASE · ACABADOS · STICKERS · FIN DE CARRERA · SISTEMA DE
COMPUERTA POSTERIOR · MANGUERAS HIDRÁULICAS · CONEXIONES HIDRÁULICAS · CONEXIONES
NEUMÁTICAS · TAPÓN · LOGEADO. Son etiquetas del oficio, se inventan sobre la
marcha y algunas se repiten con distinta escritura. El `tipo_costo_partida` del
sistema —MATERIAL, MANO_OBRA, SERVICIO, OTRO— no las representa.

Los servicios entran como una fila más: SERVICIO DE ARENADO, SERVICIO DE
REDUCCIÓN DE MANGUERAS, ENCOMIENDA.

### La hoja RESUMEN — la estructura de costo real

Esto es lo que el sistema no tiene en ninguna parte. Cada línea lleva un importe
**mensual del área** y una **tasa aplicada**: el porcentaje de ese gasto que
carga esta unidad. La base del prorrateo está escrita arriba a la derecha:
**«ESTÁNDAR 9 A 10 UNIDADES»**.

```
COSTOS DE PRODUCCIÓN
  COSTOS DIRECTOS                              con IGV   tasa
    MATERIA PRIMA        una línea por clasificación      100 %
    MANO DE OBRA TERCERA armado / pintura / arenado       100 %
    MANO DE OBRA         Producción                        10 %
                         Transporte (conductor)             5 %
  COSTOS INDIRECTOS
    MANO DE OBRA         Ingeniería                        10 %
                         Almacén                           10 %
    OTROS                Seguros                            5 %
                         Sistema de seguridad               5 %
                         Electricidad                       8 %
                         Celulares                         10 %
                         Correos e internet                10 %
                         Agua                              10 %
  = TOTAL COSTOS DE PRODUCCIÓN

GASTOS DE OPERACIÓN
  VENTAS                 Comisiones por ventas            100 %
  ADMINISTRATIVOS        Administración                    10 %
                         Logística                         10 %
                         Contabilidad                      10 %
                         Tesorería                         10 %
                         Vendedores                        10 %
                         Trámites de placas y documentación 100 %
  DEPRECIACIÓN           Maquinaria empleada                2 %
                         Equipos de cómputo y otros        0,2 %
  = TOTAL GASTOS DE OPERACIÓN

= TOTAL EGRESOS Y EROGACIONES PARA FABRICACIÓN
+ UTILIDAD CALCULADA                                      15,0 %
= PRECIO DE VENTA SIN IGV (US$)
× 1,18 = PRECIO DE VENTA CON IGV (US$), y su equivalente en S/ al T.C.
```

La hoja de detalle alimenta a la de RESUMEN por clasificación: al pie del
detalle hay un cuadro «COSTO POR CLASIFICACIÓN» y el RESUMEN lo referencia
celda a celda.

### Las tres consecuencias para el sistema

1. **El precio sale del costo, no al revés.** La hoja calcula el precio de venta
   sumando egresos y agregando 15 % de utilidad. Hoy el sistema hace lo
   contrario: Ventas escribe el precio y Administración costea después. Las dos
   cosas pueden convivir —el costeo diría cuál *debería* ser el precio y Gerencia
   compara las dos cifras antes de aprobar— pero hoy esa comparación no existe.
2. **Falta el prorrateo de indirectos entero.** No hay dónde guardar el gasto
   mensual de cada área ni la tasa que carga cada unidad, y sin eso el «costo»
   del sistema es solo material: se queda corto en todo lo que la empresa sí
   suma.
3. **La clasificación tiene que ser un catálogo abierto**, no un enum de cuatro
   valores.

---

## 13. Fuentes

| Archivo | Qué aportó |
| --- | --- |
| `OT - 2920 - MULTISERVICIOS ACOSTA S.A.C - TOLVA DE 15M3.pdf` | Estructura completa de la OT y su cotización |
| `OT - 2879 - ... ELKY S.A.C. - CISTERNA DE 15 M3` | Confirmación del formato |
| `FECHAS DE LOS PROCESOS DE FABRICACIÓN- ACTUAL.xlsx` | Las 14 etapas, sus días y las reglas de plazo |
| `CONTROL DE AREAS - ADMI.xlsx` | Formato MW-FOR-ADM-7, áreas A–F y estados |
| `PROYECTO SIG - MWP/CODIFICACION DE AREAS.xlsx` | Organigrama, tipos SIG y codificación documental |
| `FLUJOGRAMA DE JAMISA (1).pdf` | Flujo del documento y responsables |
| `ORDEN DE SERVICIO - 2026.xlsm` | Datos fiscales de la empresa |
| `.../COMPRAS 2026/1. METAL WORK PERU/OC-5580-MW` | Numeración de órdenes de compra |
| `SEGUIMIENTO DE FABRICACIÓN - MWP.xlsx` | Codificación de unidades fabricadas |
| `PROYECTO CODIFICACION ALMACEN -MWP.xlsx` | Codificación de materiales y de producto terminado |
| `PROYECTO SIG - MWP/9) Almacén ( ALM)` | Los siete formatos del área de almacén |
| `4. LOGISTICA 2026/1. COSTEOS/AGOSTO/METAL WORK/40- TOLVA 17 M3 -TRINCO.xlsx` | La hoja de detalle del costeo y sus clasificaciones |
| `.../COSTEOS DE EMPRESAS/6. COSTOS JUNIO/JAMISA/38-COSTEO-GARANTIA CISTERNA INCOAC.xlsx` | La hoja RESUMEN: prorrateo de indirectos y cálculo del precio |
| `6. REQUERIMIENTOS/COSTEOS DE EMPRESAS/SEGUIMIENTO DE COSTEOS.xlsx` | Quién costea, en qué estados y con qué fechas |
| `4. LOGISTICA 2026/ESTRUCTURA LOGISTICA - 2026.pdf` | Cuándo se costea y cómo se archiva |
