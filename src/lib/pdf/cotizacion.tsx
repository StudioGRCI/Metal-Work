import 'server-only'

import { readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'

import { cantidad, fecha, moneda, numero } from '@/lib/format'
import type { CodigoMoneda } from '@/lib/format'
import { nombreDeUnidad } from '@/lib/dominio/unidades'
import type { CotizacionImpresa } from '@/lib/datos/impresion'

// Los colores del manual de identidad. En el papel el azul es el que manda y
// el rojo se reserva para la marca, igual que en los documentos impresos.
const AZUL = '#13467F'
const ROJO = '#FD0002'
const GRIS = '#5B6470'
const BORDE = '#C9D2DC'
const FONDO = '#EEF3F9'

const estilos = StyleSheet.create({
  // El interlineado NO va acá: puesto en la página, el motor lo hereda también
  // en los elementos fijos y el pie se sale de la hoja sin dejar rastro. Va en
  // cada estilo de texto que lo necesita.
  pagina: {
    paddingTop: 28,
    paddingBottom: 54,
    paddingHorizontal: 34,
    fontSize: 8.5,
    fontFamily: 'Helvetica',
    color: '#1B2430',
  },

  // ---------------------------------------------------------------- membrete
  membrete: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  logo: { width: 150, objectFit: 'contain' },
  casa: { flex: 1, paddingLeft: 14, paddingTop: 2 },
  razonSocial: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: AZUL },
  datoCasa: { fontSize: 7.5, color: GRIS },

  recuadroNumero: {
    width: 150,
    borderWidth: 1,
    borderColor: AZUL,
    borderRadius: 3,
    overflow: 'hidden',
  },
  recuadroTitulo: {
    backgroundColor: AZUL,
    color: '#FFFFFF',
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    paddingVertical: 3,
    letterSpacing: 0.6,
  },
  recuadroCuerpo: { paddingVertical: 5, paddingHorizontal: 6, alignItems: 'center' },
  // El interlineado explícito evita que el número pise a la fecha: con la
  // altura automática la caja se queda corta para un tamaño tan grande.
  numeroGrande: {
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    color: ROJO,
    letterSpacing: 0.5,
    lineHeight: 1.25,
    marginBottom: 2,
  },
  reglaMarca: { height: 2.5, backgroundColor: AZUL, marginBottom: 10 },

  // ------------------------------------------------------------- secciones
  tituloSeccion: {
    backgroundColor: AZUL,
    color: '#FFFFFF',
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    letterSpacing: 0.8,
    paddingVertical: 3,
    paddingHorizontal: 6,
    marginTop: 10,
    marginBottom: 5,
  },

  filaDatos: { flexDirection: 'row', gap: 14 },
  columna: { flex: 1 },
  dato: { flexDirection: 'row', marginBottom: 1.5 },
  etiqueta: { width: 74, color: GRIS, fontSize: 7.5 },
  valor: { flex: 1, fontSize: 8, lineHeight: 1.35 },
  valorFuerte: { flex: 1, fontSize: 8, fontFamily: 'Helvetica-Bold', lineHeight: 1.35 },

  // ------------------------------------------------------------ ficha técnica
  fichaSeccion: { marginBottom: 4, breakInside: 'avoid' },
  fichaTitulo: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: AZUL,
    letterSpacing: 0.5,
    borderBottomWidth: 0.75,
    borderBottomColor: BORDE,
    paddingBottom: 1.5,
    marginBottom: 2.5,
  },
  fichaLinea: { flexDirection: 'row', marginBottom: 1.2 },
  vineta: { width: 9, color: AZUL, fontSize: 8 },

  // ------------------------------------------------ lo que NO va incluido
  // Va enmarcado y con su propia viñeta: metido entre los accesorios, «NO
  // INCLUYE AROS NI LLANTAS» se lee como un renglón más de lo que sí se
  // entrega, y eso se discute después, con la unidad ya en el patio.
  advertencias: {
    borderWidth: 0.75,
    borderColor: ROJO,
    borderRadius: 2,
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginTop: 6,
  },
  advertenciaTitulo: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: ROJO,
    letterSpacing: 0.5,
    marginBottom: 2.5,
  },
  vinetaNegativa: { width: 9, color: ROJO, fontSize: 8, fontFamily: 'Helvetica-Bold' },
  advertenciaLinea: { flex: 1, fontSize: 7.8, fontFamily: 'Helvetica-Bold', lineHeight: 1.35 },

  fichaEtiqueta: { width: 82, fontFamily: 'Helvetica-Bold', fontSize: 7.8, lineHeight: 1.35 },
  fichaDetalle: { flex: 1, fontSize: 7.8, lineHeight: 1.35 },

  // ------------------------------------------------------------------ tablas
  tabla: { borderWidth: 0.75, borderColor: BORDE, borderRadius: 2 },
  encabezado: { flexDirection: 'row', backgroundColor: FONDO },
  fila: { flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: BORDE },
  celdaTitulo: {
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    color: AZUL,
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  celda: { fontSize: 7.8, paddingVertical: 3, paddingHorizontal: 4, lineHeight: 1.35 },
  derecha: { textAlign: 'right' },
  centro: { textAlign: 'center' },

  // ------------------------------------------------------------------ totales
  bloqueTotales: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 6 },
  totales: { width: 210 },
  lineaTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
    paddingHorizontal: 6,
  },
  lineaTotalFuerte: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 6,
    backgroundColor: AZUL,
    borderRadius: 2,
    marginTop: 2,
  },
  textoTotal: { color: '#FFFFFF', fontSize: 9.5, fontFamily: 'Helvetica-Bold' },

  // ------------------------------------------------------- cierre y pie
  // Las condiciones van en una sola columna: son cinco renglones que se leen en
  // orden, y en dos columnas el orden de la casa deja de verse.
  etiquetaCondicion: {
    width: 104,
    color: GRIS,
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    lineHeight: 1.35,
  },
  condiciones: { marginTop: 4 },
  parrafo: { fontSize: 7.8, marginBottom: 2, lineHeight: 1.35 },
  // El bloque se separa del texto de arriba y la firma tiene su hueco: 46
  // puntos son unos dieciséis milímetros, que es lo que ocupa una firma con su
  // sello al lado. Sin ese hueco, la raya quedaba pegada a las condiciones y no
  // había dónde firmar.
  firmas: { marginTop: 40, alignItems: 'center' },
  // Poco más de un tercio de la hoja. Al 58 % la raya cruzaba media página y no
  // parecía un renglón para firmar sino un subrayado; una firma se pone en el
  // ancho de una mano, no en el de la hoja.
  firma: { width: '36%' },
  espacioFirma: { height: 46 },
  lineaFirma: { borderTopWidth: 0.75, borderTopColor: '#1B2430', width: '100%', paddingTop: 4 },
  textoFirma: { fontSize: 7.5, textAlign: 'center', color: GRIS },
  nombreFirma: { fontSize: 8.5, textAlign: 'center', color: '#1B2430' },

  sello: {
    position: 'absolute',
    top: 250,
    left: 90,
    fontSize: 60,
    fontFamily: 'Helvetica-Bold',
    color: ROJO,
    opacity: 0.16,
    transform: 'rotate(-24deg)',
  },

  pie: {
    position: 'absolute',
    bottom: 24,
    left: 34,
    right: 34,
    borderTopWidth: 0.75,
    borderTopColor: BORDE,
    paddingTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  textoPie: { fontSize: 6.8, color: GRIS },
})

/** Anchos de la tabla de partidas, en porcentaje del ancho útil. */
const COL = { item: '6%', descripcion: '50%', cantidad: '10%', unidad: '10%', precio: '24%' } as const

function Dato({ etiqueta, valor, fuerte }: { etiqueta: string; valor?: string | null; fuerte?: boolean }) {
  return (
    <View style={estilos.dato}>
      <Text style={estilos.etiqueta}>{etiqueta}</Text>
      <Text style={fuerte ? estilos.valorFuerte : estilos.valor}>{valor || '—'}</Text>
    </View>
  )
}

/** Un renglón de las condiciones comerciales, con la etiqueta de la casa. */
function Condicion({
  etiqueta,
  valor,
  fuerte,
}: Readonly<{ etiqueta: string; valor?: string | null; fuerte?: boolean }>) {
  return (
    <View style={estilos.dato}>
      <Text style={estilos.etiquetaCondicion}>{etiqueta}</Text>
      <Text style={fuerte ? estilos.valorFuerte : estilos.valor}>{valor || '—'}</Text>
    </View>
  )
}

/**
 * El plazo como lo dice la empresa: «45 días hábiles después de emitida la orden
 * de compra». Los días y el disparador van en el MISMO renglón porque uno sin el
 * otro no compromete nada —cuarenta y cinco días contados desde cuándo es la
 * llamada que llega a los quince—, y así es como está escrito en sus papeles.
 */
function textoPlazo(c: CotizacionImpresa) {
  const desde = c.plazo_desde?.trim() || null
  if (!c.plazo_entrega_dias) return desde

  const cuenta = c.plazo_en_habiles ? 'hábiles' : 'calendario'
  const dias = `${c.plazo_entrega_dias} días ${cuenta}`
  return desde ? `${dias} ${desde}` : dias
}

/**
 * La garantía tal como la escribe la casa. Cuando está escrita manda esa y no se
 * toca: se parte por sistema —«01 año fallas de fabricación / 6 meses en sistema
 * hidráulico»— y ningún número de meses dice eso. Cuando no está escrita, se
 * arma con los meses en la forma que ellos usan.
 */
function textoGarantia(c: CotizacionImpresa) {
  const escrita = c.garantia_texto?.trim()
  if (escrita) return escrita
  if (!c.garantia_meses) return 'Sin garantía'
  return `${enMesesOAnios(c.garantia_meses)} contra eventuales fallas de fabricación`
}

/** «01 año», «02 años», «06 meses»: con el cero delante que la empresa escribe. */
function enMesesOAnios(meses: number) {
  if (meses % 12 === 0) {
    const anios = meses / 12
    return `${String(anios).padStart(2, '0')} ${anios === 1 ? 'año' : 'años'}`
  }
  return `${String(meses).padStart(2, '0')} ${meses === 1 ? 'mes' : 'meses'}`
}

/** «15 días a partir de hoy», que es como la casa promete sostener el precio. */
function textoValidez(c: CotizacionImpresa) {
  if (c.validez_dias > 0) return `${c.validez_dias} días a partir de hoy`
  return c.fecha_vencimiento ? `Hasta el ${fecha(c.fecha_vencimiento)}` : null
}

/**
 * El precio como condición comercial: el mismo TOTAL del cuadro, repetido acá
 * porque es lo primero que el cliente busca. Sin partidas no hay precio que
 * prometer y el renglón se queda vacío, que es más honesto que prometer cero.
 */
function textoPrecio(c: CotizacionImpresa, mon: CodigoMoneda) {
  if (c.total <= 0) return null
  return `${moneda(c.total, mon)}${c.igv > 0 ? ' incluido el IGV' : ''}`
}

/**
 * El peso con la tolerancia que la empresa siempre escribe: «6.7 TN (+/- 5%)».
 * Un peso a secas se lee como exacto, y una carrocería no sale nunca al gramo.
 *
 * Sin tolerancia —las cotizaciones anteriores al campo— el renglón sale como
 * salía, con sus dos decimales: el papel ya emitido no cambia de forma por un
 * dato que nadie llegó a escribir.
 */
function pesoImpreso(c: CotizacionImpresa) {
  if (c.peso_neto_tn === null) return null

  const tolerancia = c.peso_tolerancia?.trim()
  if (!tolerancia) return `${numero(c.peso_neto_tn, 2)} TN`
  return `${cantidad(c.peso_neto_tn)} TN (${tolerancia})`
}

/**
 * Un texto de varios renglones, como renglones.
 *
 * La nota de cierre son promesas distintas —certificados, expediente, placas—
 * escritas una por línea. El motor arma un párrafo con todo lo que le llega en
 * un solo <Text>, así que salían pegadas en una sola frase corrida y la tercera
 * ya no se leía como un compromiso aparte. Los saltos llegan como \r\n desde
 * Windows y como \n desde el navegador: se parten los dos.
 */
function renglones(texto: string | null | undefined): string[] {
  return (texto ?? '')
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean)
}

/**
 * El renglón de la unidad tal como sale impreso: su nombre —la placa cuando la
 * tiene y, si no, lo que de verdad la identifica— seguido de la marca y el
 * modelo, unidos por un punto.
 *
 * Sin placa el nombre puede salir ya de la marca y el modelo, y entonces no se
 * repiten detrás: el papel diría «VOLVO FH, sin placa · VOLVO · FH». Así el
 * renglón se lee igual de bien con matrícula y sin ella, sin un punto suelto
 * delante ni un hueco donde va el nombre.
 */
function unidadImpresa(unidad: CotizacionImpresa['unidad']) {
  if (!unidad) return null

  const nombre = nombreDeUnidad(unidad)
  const vehiculo = [unidad.marca, unidad.modelo].filter(Boolean)
  if (vehiculo.length === 0 || nombre.startsWith(vehiculo.join(' '))) return nombre

  return [nombre, ...vehiculo].join(' · ')
}

function medidas(c: CotizacionImpresa) {
  const partes = [c.largo_m, c.ancho_m, c.alto_m].filter((m) => m !== null)
  if (partes.length === 0) return null
  return `${partes.map((m) => numero(m, 2)).join(' × ')} m`
}

/**
 * El nombre del trabajo tal como sale impreso. Lo escribe quien cotiza; si no
 * lo escribió, se arma con la carrocería y su capacidad —que es de donde salía
 * antes— para que ninguna de las cotizaciones ya emitidas quede sin decir qué
 * se cotizó.
 */
function concepto(c: CotizacionImpresa) {
  const escrito = c.concepto?.trim()
  if (escrito) return escrito

  const partes = [c.carroceria, c.capacidad, medidas(c)].filter(Boolean)
  return partes.length > 0 ? partes.join(' · ') : 'Trabajo cotizado'
}

/**
 * El precio de una unidad del concepto, tal como la casa lo promete.
 *
 * Antes salía siempre el bruto -el total repartido entre la cantidad- debajo de
 * un Subtotal sin IGV: la cuenta solo cerraba contra el TOTAL y, con la casilla
 * «el precio incluye IGV» destildada, el papel afirmaba «no incluye IGV» encima
 * de un número que sí lo llevaba. Se contradecía solo, y ese es el número que
 * el cliente lee.
 *
 * Ahora la casilla manda sobre lo impreso: si el precio incluye IGV se imprime
 * el bruto -el mismo número del TOTAL-, y si no, el neto, que es el que cuadra
 * con el Subtotal. El desglose de abajo no cambia en ningún caso.
 */
function precioDelConcepto(c: CotizacionImpresa) {
  const cantidad = Number(c.concepto_cantidad) || 1
  const base = c.subtotal - c.descuento
  return (c.incluye_igv ? c.total : base) / cantidad
}

function DocumentoCotizacion({ datos, logo }: { datos: CotizacionImpresa; logo: Buffer | null }) {
  const mon = (datos.moneda ?? 'PEN') as CodigoMoneda
  const empresa = datos.empresa
  const anulada = datos.estado === 'ANULADA'
  const domicilio = [empresa?.direccion, empresa?.distrito, empresa?.provincia, empresa?.departamento]
    .filter(Boolean)
    .join(' · ')

  // El cierre del documento: condiciones, observaciones y la nota, cada renglón
  // por su cuenta. La nota son varias promesas escritas una por línea y salían
  // pegadas en un párrafo corrido.
  const cierre = [datos.condiciones, datos.observaciones, datos.nota].flatMap(renglones)

  return (
    <Document
      title={`Cotización ${datos.numero} — ${datos.cliente.razon_social}`}
      author={empresa?.razon_social ?? 'Metal Work Perú S.A.C.'}
      subject={`Cotización ${datos.numero}`}
    >
      <Page size="A4" style={estilos.pagina}>
        {/* --------------------------------------------------------- membrete */}
        <View style={estilos.membrete} fixed>
          {/* El Image del PDF no es el del navegador: no lleva texto alternativo
              porque en el papel no hay lector de pantalla al que dárselo. */}
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          {logo ? <Image style={estilos.logo} src={logo} /> : <View style={estilos.logo} />}

          <View style={estilos.casa}>
            <Text style={estilos.razonSocial}>{empresa?.razon_social ?? 'METAL WORK PERU S.A.C.'}</Text>
            {empresa?.ruc && <Text style={estilos.datoCasa}>RUC {empresa.ruc}</Text>}
            {domicilio && <Text style={estilos.datoCasa}>{domicilio}</Text>}
            {(empresa?.telefono || empresa?.correo) && (
              <Text style={estilos.datoCasa}>
                {[empresa?.telefono, empresa?.correo].filter(Boolean).join(' · ')}
              </Text>
            )}
          </View>

          <View style={estilos.recuadroNumero}>
            <Text style={estilos.recuadroTitulo}>COTIZACIÓN</Text>
            <View style={estilos.recuadroCuerpo}>
              <Text style={estilos.numeroGrande}>N° {datos.numero}</Text>
              <Text style={estilos.datoCasa}>Emitida el {fecha(datos.fecha_emision)}</Text>
              {datos.fecha_vencimiento && (
                <Text style={estilos.datoCasa}>Válida hasta el {fecha(datos.fecha_vencimiento)}</Text>
              )}
            </View>
          </View>
        </View>
        <View style={estilos.reglaMarca} fixed />

        {anulada && <Text style={estilos.sello}>ANULADA</Text>}

        {/* ---------------------------------------------------------- cliente */}
        <Text style={estilos.tituloSeccion}>SEÑORES</Text>
        <View style={estilos.filaDatos}>
          <View style={estilos.columna}>
            <Dato etiqueta="Cliente" valor={datos.cliente.razon_social} fuerte />
            <Dato etiqueta="RUC / DNI" valor={datos.cliente.numero_documento} />
            <Dato
              etiqueta="Dirección"
              valor={[datos.cliente.direccion_fiscal, datos.cliente.distrito, datos.cliente.provincia]
                .filter(Boolean)
                .join(' · ')}
            />
          </View>
          <View style={estilos.columna}>
            <Dato etiqueta="Atención" valor={datos.contacto?.nombre} />
            <Dato
              etiqueta="Teléfono"
              valor={datos.contacto?.telefono ?? datos.cliente.telefono}
            />
            <Dato etiqueta="Correo" valor={datos.contacto?.correo} />
          </View>
        </View>

        {/* -------------------------------------------------------- la unidad */}
        {(datos.unidad || datos.carroceria || medidas(datos) || datos.capacidad) && (
          <>
            <Text style={estilos.tituloSeccion}>UNIDAD Y CARROCERÍA</Text>
            <View style={estilos.filaDatos}>
              <View style={estilos.columna}>
                <Dato etiqueta="Carrocería" valor={datos.carroceria} fuerte />
                <Dato etiqueta="Marca" valor={datos.marca} />
                <Dato etiqueta="Modelo" valor={datos.modelo} />
                {/* El año va en todas sus fichas. No es una cantidad: numero()
                    lo escribiría «2,024», así que se imprime tal cual. */}
                <Dato
                  etiqueta="Año"
                  valor={datos.unidad?.anio ? String(datos.unidad.anio) : null}
                />
                <Dato etiqueta="Tipo" valor={datos.tipo} />
              </View>
              <View style={estilos.columna}>
                <Dato etiqueta="Unidad" valor={unidadImpresa(datos.unidad)} />
                <Dato etiqueta="Medidas" valor={medidas(datos)} />
                <Dato etiqueta="Capacidad" valor={datos.capacidad} />
                <Dato etiqueta="Peso neto" valor={pesoImpreso(datos)} />
              </View>
            </View>
          </>
        )}

        {/* --------------------------------------------------- ficha técnica */}
        {datos.ficha.length > 0 && (
          <>
            <Text style={estilos.tituloSeccion}>FICHA TÉCNICA</Text>
            {/* La sección puede partirse entre hojas. Con wrap={false} una
                sección más alta que la página no se paginaba: el motor la
                recortaba y avisaba solo en el registro del servidor, así que
                el cliente recibía una cotización sin espesores y nadie se
                enteraba. Lo que no se parte es cada línea, y el título arrastra
                consigo las primeras para no quedar huérfano al pie. */}
            {datos.ficha.map((seccion) => (
              <View key={seccion.seccion} style={estilos.fichaSeccion}>
                <Text style={estilos.fichaTitulo} minPresenceAhead={28}>
                  {seccion.seccion}
                </Text>
                {seccion.lineas.map((linea) => (
                  <View key={linea.id} style={estilos.fichaLinea} wrap={false}>
                    <Text style={estilos.vineta}>•</Text>
                    {linea.etiqueta && <Text style={estilos.fichaEtiqueta}>{linea.etiqueta}</Text>}
                    <Text style={estilos.fichaDetalle}>{linea.detalle}</Text>
                  </View>
                ))}
              </View>
            ))}
          </>
        )}

        {/* ----------------------------------------------------- accesorios */}
        {datos.accesorios.length > 0 && (
          <>
            {/* El rótulo es el de sus cotizaciones, con dos puntos incluidos. */}
            <Text style={estilos.tituloSeccion}>
              INCLUYE LOS SIGUIENTES ACCESORIOS O EQUIPAMIENTO:
            </Text>
            {datos.accesorios.map((a) => (
              <View key={a.id} style={estilos.fichaLinea} wrap={false}>
                <Text style={estilos.vineta}>•</Text>
                <Text style={estilos.fichaDetalle}>
                  {`${numero(a.cantidad, 0).padStart(2, '0')} ${a.unidad}. ${a.descripcion}`}
                  {!a.incluye_el_accesorio && ' (no incluye accesorio)'}
                  {a.observacion ? ` — ${a.observacion}` : ''}
                </Text>
              </View>
            ))}
          </>
        )}

        {/* ---------------------------------------------- lo que NO se entrega */}
        {/* Aparte de los accesorios y enmarcado: son lo contrario de uno. La
            caja puede partirse entre hojas —una lista más alta que la página se
            recortaría sin avisar, como pasó con la ficha—; lo que no se parte
            es cada advertencia. */}
        {renglones(datos.no_incluye).length > 0 && (
          <View style={estilos.advertencias}>
            <Text style={estilos.advertenciaTitulo} minPresenceAhead={24}>
              LO QUE NO INCLUYE
            </Text>
            {renglones(datos.no_incluye).map((advertencia) => (
              <View key={advertencia} style={estilos.fichaLinea} wrap={false}>
                <Text style={estilos.vinetaNegativa}>×</Text>
                <Text style={estilos.advertenciaLinea}>{advertencia}</Text>
              </View>
            ))}
          </View>
        )}

        {/* ------------------------------------------- el trabajo y su precio */}
        {/* Al cliente le toca saber qué se le va a fabricar y cuánto cuesta. El
            desglose por partida es la cocina del taller —acero, mano de obra,
            servicios de terceros— y se queda adentro: de él salen el
            presupuesto de la OT y las compras de material, no el papel. */}
        {/* Se imprime siempre. La condición miraba `concepto` —la columna, no
            la función que le busca alternativa— así que una cotización con
            precio pero sin concepto escrito ni partidas salía sin su propuesta
            económica: el cliente recibía las condiciones, con un «PRECIO» suelto
            entre ellas, y ninguna línea que dijera qué se le está cotizando ni
            el desglose del IGV. La cotización sin su precio no es una
            cotización, y `concepto()` siempre devuelve un nombre. */}
            {/* Así se titula en sus cotizaciones, con los dos puntos. */}
            <Text style={estilos.tituloSeccion}>PROPUESTA ECONÓMICA:</Text>
            <View style={estilos.tabla}>
              <View style={estilos.encabezado}>
                <Text style={[estilos.celdaTitulo, estilos.centro, { width: COL.item }]}>ÍTEM</Text>
                <Text style={[estilos.celdaTitulo, { width: COL.descripcion }]}>DESCRIPCIÓN</Text>
                <Text style={[estilos.celdaTitulo, estilos.centro, { width: COL.cantidad }]}>CANT.</Text>
                <Text style={[estilos.celdaTitulo, estilos.centro, { width: COL.unidad }]}>UND.</Text>
                <Text style={[estilos.celdaTitulo, estilos.derecha, { width: COL.precio }]}>PRECIO</Text>
              </View>

              <View style={estilos.fila}>
                <Text style={[estilos.celda, estilos.centro, { width: COL.item }]}>1</Text>
                <Text style={[estilos.celda, { width: COL.descripcion }]}>{concepto(datos)}</Text>
                <Text style={[estilos.celda, estilos.centro, { width: COL.cantidad }]}>
                  {numero(datos.concepto_cantidad, 2)}
                </Text>
                <Text style={[estilos.celda, estilos.centro, { width: COL.unidad }]}>
                  {datos.concepto_unidad}
                </Text>
                <Text style={[estilos.celda, estilos.derecha, { width: COL.precio }]}>
                  {moneda(precioDelConcepto(datos), mon)}
                </Text>
              </View>
            </View>

            <View style={estilos.bloqueTotales}>
              <View style={estilos.totales}>
                <View style={estilos.lineaTotal}>
                  <Text>Subtotal</Text>
                  <Text>{moneda(datos.subtotal, mon)}</Text>
                </View>
                {datos.descuento > 0 && (
                  <View style={estilos.lineaTotal}>
                    <Text>Descuento</Text>
                    <Text>− {moneda(datos.descuento, mon)}</Text>
                  </View>
                )}
                <View style={estilos.lineaTotal}>
                  <Text>{`IGV (${numero(datos.igv_porcentaje, 0)}%)`}</Text>
                  <Text>{moneda(datos.igv, mon)}</Text>
                </View>
                <View style={estilos.lineaTotalFuerte}>
                  <Text style={estilos.textoTotal}>TOTAL</Text>
                  <Text style={estilos.textoTotal}>{moneda(datos.total, mon)}</Text>
                </View>
                <Text style={[estilos.textoPie, { textAlign: 'right', marginTop: 2 }]}>
                  {datos.incluye_igv
                    ? 'El precio indicado ya incluye el IGV'
                    : 'El precio indicado no incluye el IGV; se detalla arriba'}
                </Text>
              </View>
            </View>

        {/* ----------------------------------------------------- condiciones */}
        {/* Siempre las mismas cinco y en este orden, que es el de sus papeles:
            precio, forma de pago, validez, garantía y tiempo de entrega. Quien
            recibe la cotización las busca en ese renglón; cambiarlas de sitio
            obliga a leer el documento entero para encontrar el plazo. */}
        <Text style={estilos.tituloSeccion}>CONDICIONES COMERCIALES</Text>
        <View>
          <Condicion etiqueta="PRECIO" valor={textoPrecio(datos, mon)} fuerte />
          <Condicion etiqueta="FORMA DE PAGO" valor={datos.forma_pago} />
          <Condicion etiqueta="VALIDEZ" valor={textoValidez(datos)} />
          <Condicion etiqueta="GARANTÍA" valor={textoGarantia(datos)} />
          <Condicion etiqueta="TIEMPO DE ENTREGA" valor={textoPlazo(datos)} />
        </View>

        {cierre.length > 0 && (
          <View style={estilos.condiciones}>
            {cierre.map((texto, i) => (
              <Text key={`${i}-${texto}`} style={estilos.parrafo}>
                {texto}
              </Text>
            ))}
          </View>
        )}

        {anulada && datos.motivo_anulacion && (
          <Text style={[estilos.parrafo, { color: ROJO, marginTop: 4 }]}>
            Documento anulado: {datos.motivo_anulacion}
          </Text>
        )}

        {/* --------------------------------------------------------- firmas */}
        {/* Una sola firma, la de la casa. El recuadro de conformidad del
            cliente se quitó por decisión de Gerencia: una cotización no se
            devuelve firmada, se acepta con una orden de compra. */}
        <View style={estilos.firmas} wrap={false}>
          <View style={estilos.firma}>
            <View style={estilos.espacioFirma} />
            <View style={estilos.lineaFirma}>
              <Text style={estilos.nombreFirma}>
                {datos.vendedor
                  ? `${datos.vendedor.nombres} ${datos.vendedor.apellidos}`
                  : empresa?.razon_social ?? 'Metal Work Perú S.A.C.'}
              </Text>
              <Text style={estilos.textoFirma}>
                {[datos.vendedor?.telefono, datos.vendedor?.correo].filter(Boolean).join(' · ') ||
                  'Área Comercial'}
              </Text>
            </View>
          </View>
        </View>

        <View style={estilos.pie} fixed>
          <Text style={estilos.textoPie}>
            {`Cotización ${datos.numero} · ${datos.cliente.razon_social}`}
          </Text>
          <Text
            style={estilos.textoPie}
            fixed
            render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}

/**
 * El PDF de la cotización, listo para descargar. Se arma en el servidor porque
 * el membrete y los precios no tienen por qué viajar al navegador dos veces.
 */
export async function pdfDeCotizacion(datos: CotizacionImpresa): Promise<Buffer> {
  const logo = await leerLogo()
  return renderToBuffer(<DocumentoCotizacion datos={datos} logo={logo} />)
}

/** El logo oficial para fondo claro. Si falta, el documento sale sin él. */
async function leerLogo(): Promise<Buffer | null> {
  try {
    return await readFile(path.join(process.cwd(), 'public', 'marca', 'logo-metal-work.png'))
  } catch {
    return null
  }
}

/**
 * El nombre del archivo tal como la empresa archiva:
 * «COT. N°3571-2026 - FURGON ISOTERMICO - TRANSPORTES SANTA ROSA SAC - 12-05-26.pdf».
 *
 * Sin el producto ni la fecha el archivo no entra en el árbol de carpetas que ya
 * existe en el OneDrive de la casa, y quien lo recibe lo renombra a mano, uno
 * por uno, hasta que se cansa y los deja sueltos.
 *
 * Todo lo que entra viene de la base y sale en una cabecera HTTP, así que se
 * limpia entero —número incluido—: unas comillas metidas ahí dejan que el
 * documento se guarde con el nombre que elija quien las puso, y un salto de
 * línea rompe la cabecera y tumba la descarga de esa cotización para siempre.
 */
export function nombreArchivoCotizacion(datos: CotizacionImpresa) {
  const partes = [
    `COT. N°${aNombreDeArchivo(datos.numero, 20)}`,
    // El producto es la carrocería, que es como la casa nombra la carpeta; sin
    // ella sirve el trabajo escrito. Lo que NO entra acá es el concepto armado
    // con medidas y capacidad: «30 M3 9.50 2.60 2.80 M» no es un producto, y en
    // el nombre del archivo estorba más que un hueco.
    aNombreDeArchivo(datos.carroceria || datos.concepto || '', 40),
    aNombreDeArchivo(datos.cliente.razon_social, 40),
    fechaDeArchivo(datos.fecha_emision),
  ].filter(Boolean)

  return `${partes.join(' - ')}.pdf`
}

/**
 * La fecha como la fechan ellos: dd-mm-aa. Sale de fecha() —la única que sabe
 * que un día del calendario se lee tal cual— y le cambia las barras por guiones,
 * porque una barra en un nombre de archivo es una carpeta que no existe.
 */
function fechaDeArchivo(valor: string) {
  const [dia, mes, anio] = fecha(valor).split('/')
  if (!dia || !mes || !anio) return ''
  return `${dia}-${mes}-${anio.slice(-2)}`
}

/**
 * Un trozo de nombre que el disco admite y la cabecera no puede malinterpretar:
 * sin acentos —el nombre viaja en una cabecera HTTP, que no es UTF-8—, sin los
 * caracteres que ningún sistema de archivos acepta (\ / : * ? " < > |), sin
 * saltos de línea, y sin puntos ni espacios al final, que Windows recorta solo.
 *
 * El espacio y el guion se conservan: son la forma en que la empresa archiva y
 * cambiarlos por guiones bajos ya no es su nombre.
 */
function aNombreDeArchivo(texto: string, largo: number) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 .,()-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, largo)
    .replace(/[.\s]+$/, '')
}
