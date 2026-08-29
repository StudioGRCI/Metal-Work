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

import { fecha, moneda, numero } from '@/lib/format'
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
  condiciones: { marginTop: 4 },
  parrafo: { fontSize: 7.8, marginBottom: 2, lineHeight: 1.35 },
  firmas: { flexDirection: 'row', gap: 40, marginTop: 26 },
  firma: { flex: 1, alignItems: 'center' },
  lineaFirma: { borderTopWidth: 0.75, borderTopColor: '#1B2430', width: '100%', paddingTop: 3 },
  textoFirma: { fontSize: 7.5, textAlign: 'center', color: GRIS },

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

/** El plazo como lo dice la empresa: «45 días hábiles», no una fecha. */
function textoPlazo(c: CotizacionImpresa) {
  if (!c.plazo_entrega_dias) return null
  return `${c.plazo_entrega_dias} días ${c.plazo_en_habiles ? 'hábiles' : 'calendario'}`
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
                <Dato etiqueta="Tipo" valor={datos.tipo} />
              </View>
              <View style={estilos.columna}>
                <Dato etiqueta="Unidad" valor={unidadImpresa(datos.unidad)} />
                <Dato etiqueta="Medidas" valor={medidas(datos)} />
                <Dato etiqueta="Capacidad" valor={datos.capacidad} />
                <Dato
                  etiqueta="Peso neto"
                  valor={datos.peso_neto_tn ? `${numero(datos.peso_neto_tn, 2)} TN` : null}
                />
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
            <Text style={estilos.tituloSeccion}>ACCESORIOS QUE INCLUYE</Text>
            {datos.accesorios.map((a) => (
              <View key={a.id} style={estilos.fichaLinea}>
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

        {/* ------------------------------------------- el trabajo y su precio */}
        {/* Al cliente le toca saber qué se le va a fabricar y cuánto cuesta. El
            desglose por partida es la cocina del taller —acero, mano de obra,
            servicios de terceros— y se queda adentro: de él salen el
            presupuesto de la OT y las compras de material, no el papel. */}
        {(datos.partidas.length > 0 || datos.concepto) && (
          <>
            <Text style={estilos.tituloSeccion}>TRABAJO A REALIZAR</Text>
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
          </>
        )}

        {/* ----------------------------------------------------- condiciones */}
        <Text style={estilos.tituloSeccion}>CONDICIONES COMERCIALES</Text>
        <View style={estilos.filaDatos}>
          <View style={estilos.columna}>
            <Dato etiqueta="Plazo de entrega" valor={textoPlazo(datos)} fuerte />
            <Dato etiqueta="Forma de pago" valor={datos.forma_pago} />
          </View>
          <View style={estilos.columna}>
            <Dato
              etiqueta="Garantía"
              valor={datos.garantia_meses ? `${datos.garantia_meses} meses` : 'Sin garantía'}
              fuerte
            />
            <Dato etiqueta="Validez" valor={datos.fecha_vencimiento ? `Hasta el ${fecha(datos.fecha_vencimiento)}` : null} />
          </View>
        </View>

        {(datos.condiciones || datos.observaciones || datos.nota) && (
          <View style={estilos.condiciones}>
            {[datos.condiciones, datos.observaciones, datos.nota]
              .filter(Boolean)
              .map((texto, i) => (
                <Text key={i} style={estilos.parrafo}>
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
        <View style={estilos.firmas} wrap={false}>
          <View style={estilos.firma}>
            <View style={estilos.lineaFirma}>
              <Text style={estilos.textoFirma}>
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
          <View style={estilos.firma}>
            <View style={estilos.lineaFirma}>
              <Text style={estilos.textoFirma}>Conformidad del cliente</Text>
              <Text style={estilos.textoFirma}>Firma, sello y fecha</Text>
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
 * El nombre del archivo tal como lo espera quien lo recibe por correo.
 *
 * Todo lo que entra viene de la base y sale en una cabecera HTTP, as\u00ed que se
 * limpia entero -n\u00famero incluido-: unas comillas metidas ah\u00ed dejan que el
 * documento se guarde con el nombre que elija quien las puso, y un salto de
 * l\u00ednea rompe la cabecera y tumba la descarga de esa cotizaci\u00f3n para siempre.
 */
export function nombreArchivoCotizacion(datos: CotizacionImpresa) {
  return `COT-${aNombreDeArchivo(datos.numero)}-${aNombreDeArchivo(datos.cliente.razon_social)}.pdf`
}

function aNombreDeArchivo(texto: string) {
  return (
    texto
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toUpperCase()
      .slice(0, 60) || 'SIN-NOMBRE'
  )
}
