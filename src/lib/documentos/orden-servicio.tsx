import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { ReactNode } from 'react'

import { igvCompra } from '@/lib/dominio/compra-materiales'
import type { DetraccionDeServicio } from '@/lib/dominio/detraccion'
import { CabeceraDocumento, PALETA_DOCUMENTO } from '@/lib/documentos/cabecera-documento'
import { EMPRESA } from '@/lib/dominio/empresa'
import { fecha, fechaHora, moneda, numero } from '@/lib/format'

export type ServicioPdf = {
  numero: string
  /** La cotización o el presupuesto del contratista. */
  referenciaProveedor: string | null
  /** Cuándo se emitió (ISO). */
  emitida: string
  inicio: string | null
  fin: string | null
  condicion: string
  dias: number
  divisa: 'PEN' | 'USD'
  /** Sin IGV, en la moneda de la orden. */
  monto: number
  /** Qué se hace, a qué pieza o unidad: el alcance del servicio. */
  descripcion: string
  codigoInterno: string | null
  orden: string | null
  unidad: string | null
  area: string | null
  detraccion: DetraccionDeServicio
  /** Quién la emitió y quién la aprobó, con su nombre: lo que firma de verdad, no el área. */
  emitidaPor: string | null
  aprobadaPor: string | null
  /** Cuándo se aprobó (ISO). */
  aprobadaEn: string | null
  /** Si se anuló después de aprobada: sale con su marca, el motivo, quién y cuándo. */
  anulacion: { motivo: string; por: string | null; en: string } | null
  proveedor: {
    nombre: string
    documento: string | null
    direccion: string | null
    telefono: string | null
    contacto: string | null
  }
}

const { azul: AZUL, rojo: ROJO, tinta: TINTA, suave: SUAVE, linea: LINEA, fondo: FONDO } = PALETA_DOCUMENTO

// El `lineHeight` va en cada estilo de texto y nunca en la página ni en nada
// `fixed`: el pie y la marca de anulada son `fixed`, y con un `lineHeight`
// heredado, en su caja o en sus textos, desaparecen de la hoja sin avisar (pasó
// con la evaluación, 2026-10-01; skill `diseno` › PDF).
const s = StyleSheet.create({
  pagina: { paddingTop: 24, paddingBottom: 42, paddingHorizontal: 28, fontFamily: 'Helvetica', fontSize: 8, color: TINTA },
  fila2: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  caja: { borderWidth: 0.75, borderColor: TINTA },
  cajaTitulo: {
    backgroundColor: FONDO,
    borderBottomWidth: 0.75,
    borderColor: TINTA,
    paddingHorizontal: 5,
    paddingVertical: 2.5,
    fontSize: 7.5,
    fontFamily: 'Helvetica-Bold',
    textTransform: 'uppercase',
    lineHeight: 1.25,
  },
  cajaCuerpo: { paddingHorizontal: 5, paddingVertical: 3 },
  dato: { flexDirection: 'row', marginBottom: 1.5 },
  datoTitulo: { width: 92, fontSize: 7.5, fontFamily: 'Helvetica-Bold', lineHeight: 1.3 },
  datoValor: { flex: 1, fontSize: 7.5, lineHeight: 1.3 },
  destacado: { fontSize: 10, fontFamily: 'Helvetica-Bold', lineHeight: 1.3, textTransform: 'uppercase', marginBottom: 2 },
  texto: { fontSize: 7.5, lineHeight: 1.35 },
  anulada: { borderWidth: 1.25, borderColor: ROJO, marginBottom: 8, paddingHorizontal: 6, paddingVertical: 4 },
  anuladaTitulo: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: ROJO, lineHeight: 1.3, marginBottom: 2 },
  anuladaTexto: { fontSize: 7.5, lineHeight: 1.35 },
  // La marca de agua: `fixed` para que salga en cada hoja, sin `lineHeight`.
  marcaAgua: { position: 'absolute', top: 360, left: 0, right: 0, textAlign: 'center', fontSize: 96, fontFamily: 'Helvetica-Bold', color: ROJO, opacity: 0.14, transform: 'rotate(-28deg)' },
  tabla: { borderWidth: 0.75, borderColor: TINTA },
  tablaTitulo: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: FONDO, borderBottomWidth: 0.75, borderColor: TINTA, paddingHorizontal: 5, paddingVertical: 2.5 },
  tablaTituloTexto: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', lineHeight: 1.25 },
  filaCab: { flexDirection: 'row', backgroundColor: AZUL },
  fila: { flexDirection: 'row', borderTopWidth: 0.5, borderColor: LINEA },
  cab: { paddingHorizontal: 3, paddingVertical: 3, fontSize: 6.8, fontFamily: 'Helvetica-Bold', color: '#ffffff', lineHeight: 1.2 },
  celda: { paddingHorizontal: 3, paddingVertical: 3, fontSize: 7.5, lineHeight: 1.3 },
  celdaSuave: { fontSize: 6.5, lineHeight: 1.25, color: SUAVE },
  cItem: { width: '7%', textAlign: 'center' },
  cDesc: { width: '73%' },
  cImporte: { width: '20%', textAlign: 'right' },
  totales: { alignSelf: 'flex-end', width: 200, marginTop: 6, marginBottom: 8, borderWidth: 0.75, borderColor: TINTA },
  totalFila: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 5, paddingVertical: 2.5 },
  totalFinal: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 5, paddingVertical: 3, backgroundColor: FONDO, borderTopWidth: 0.75, borderColor: TINTA },
  totalRotulo: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', lineHeight: 1.3 },
  totalValor: { fontSize: 8, lineHeight: 1.3 },
  totalValorFinal: { fontSize: 9, fontFamily: 'Helvetica-Bold', lineHeight: 1.3 },
  firmas: { flexDirection: 'row', marginTop: 10, gap: 8 },
  firma: { flex: 1, borderWidth: 0.75, borderColor: TINTA, flexDirection: 'row' },
  firmaRotulo: { backgroundColor: FONDO, borderRightWidth: 0.75, borderColor: TINTA, paddingHorizontal: 5, paddingVertical: 4, fontSize: 7.5, fontFamily: 'Helvetica-Bold', lineHeight: 1.25 },
  firmaValor: { flex: 1, paddingHorizontal: 5, paddingVertical: 4, fontSize: 8, fontFamily: 'Helvetica-Bold', lineHeight: 1.25 },
  pie: { position: 'absolute', bottom: 14, left: 28, right: 28, borderTopWidth: 0.5, borderColor: LINEA, paddingTop: 4 },
  pieTexto: { fontSize: 6.8, color: SUAVE, textAlign: 'center' },
})

function Dato({ titulo, valor }: { titulo: string; valor: string | null | undefined }) {
  return (
    <View style={s.dato}>
      <Text style={s.datoTitulo}>{titulo}</Text>
      <Text style={s.datoValor}>{valor?.trim() ? valor : '—'}</Text>
    </View>
  )
}

// `flex` solo para las cajas que van lado a lado: en la columna de la página, una
// caja con flex se estira hasta el pie.
function Caja({ titulo, children, flex }: { titulo: string; children: ReactNode; flex?: number }) {
  return (
    <View style={flex ? [s.caja, { flex }] : s.caja} wrap={false}>
      <Text style={s.cajaTitulo}>{titulo}</Text>
      <View style={s.cajaCuerpo}>{children}</View>
    </View>
  )
}

const nombreMoneda = (divisa: 'PEN' | 'USD') => (divisa === 'USD' ? 'DÓLARES' : 'SOLES')

/** Lo que la OS dice de la detracción, para el contratista: si va, cuánto se deposita y sobre qué. */
function lineasDetraccion(d: DetraccionDeServicio): { titulo: string; detalle: string[] } {
  if (d.afecta === null) return { titulo: 'POR DEFINIR', detalle: ['Logística confirma si el servicio está sujeto a detracción antes del pago.'] }
  if (!d.afecta) return { titulo: 'NO SUJETO A DETRACCIÓN', detalle: d.motivo ? [d.motivo] : [] }
  const tipo = [d.codigo, d.descripcion].filter(Boolean).join(' · ')
  const porcentaje = `${numero(d.porcentaje ?? 0, 0)} %`
  const titulo = `SUJETO A DETRACCIÓN ${porcentaje}`
  if (d.total_con_igv_pen === null) {
    return { titulo, detalle: [tipo, 'El monto a depositar se calcula en soles con el tipo de cambio, al pagar.'].filter(Boolean) }
  }
  if (d.monto === null) {
    return {
      titulo,
      detalle: [tipo, `El total con IGV (${moneda(d.total_con_igv_pen)}) no pasa de ${moneda(d.minimo ?? 0)}: no se detrae.`].filter(Boolean),
    }
  }
  return {
    titulo,
    detalle: [
      tipo,
      `Se deposita ${moneda(d.monto)} en su cuenta de detracciones del Banco de la Nación (${porcentaje} de ${moneda(d.total_con_igv_pen)} con IGV); el saldo se paga a su cuenta.`,
    ].filter(Boolean),
  }
}

/**
 * La orden de servicio que se le entrega al contratista, con la forma de la
 * orden de compra (`compra-materiales.tsx`): sus datos, condiciones de pago y
 * plazo, a quién facturar y adónde mandar la factura, para qué unidad es, el
 * alcance del servicio con el monto sin IGV, el IGV y el total, la detracción, y
 * quién la emitió y la aprobó. La anulada después de aprobada sale con la marca
 * ANULADA, su motivo, quién y cuándo. `logo` es la imagen ya leída; sin ella va
 * el nombre en texto.
 */
export function DocumentoOrdenServicio({ servicio: o, logo }: { servicio: ServicioPdf; logo: Buffer | null }) {
  const igv = igvCompra(o.monto)
  const pago = o.condicion === 'CREDITO' ? `CRÉDITO A ${o.dias} ${o.dias === 1 ? 'DÍA' : 'DÍAS'}` : 'CONTADO'
  const contacto = [o.proveedor.telefono, o.proveedor.contacto].filter(Boolean).join(' · ')
  const detraccion = lineasDetraccion(o.detraccion)
  const observaciones = [
    o.referenciaProveedor ? `Según su cotización ${o.referenciaProveedor}.` : null,
    `Emitir la factura a nombre de ${EMPRESA.razonSocial} y enviarla a los correos indicados, con el número ${o.numero}.`,
  ].filter(Boolean)

  return (
    <Document title={`Orden de servicio ${o.numero}${o.anulacion ? ' (anulada)' : ''}`} author={EMPRESA.razonSocial}>
      <Page size="A4" style={s.pagina}>
        {o.anulacion ? (
          <Text style={s.marcaAgua} fixed>
            ANULADA
          </Text>
        ) : null}

        <CabeceraDocumento logo={logo} titulo="ORDEN DE SERVICIO" numero={`N°: ${o.numero}`} lineas={[`FECHA DE EMISIÓN: ${fecha(o.emitida)}`]} />

        {o.anulacion ? (
          <View style={s.anulada} wrap={false}>
            <Text style={s.anuladaTitulo}>ORDEN DE SERVICIO ANULADA</Text>
            <Text style={s.anuladaTexto}>No vale para ejecutar ni para cobrar el servicio. Queda como constancia.</Text>
            <Text style={s.anuladaTexto}>Motivo: {o.anulacion.motivo}</Text>
            <Text style={s.anuladaTexto}>
              Anulada por {o.anulacion.por ?? 'LOGÍSTICA'} · {fechaHora(o.anulacion.en)}
            </Text>
          </View>
        ) : null}

        <View style={s.fila2}>
          <Caja titulo="Datos del contratista" flex={3}>
            <Dato titulo="Contratista:" valor={o.proveedor.nombre} />
            <Dato titulo={o.proveedor.documento?.startsWith('RUC') ? 'Ruc:' : 'Documento:'} valor={o.proveedor.documento?.replace(/^RUC\s+/, '')} />
            <Dato titulo="Dirección:" valor={o.proveedor.direccion} />
            <Dato titulo="Número de contacto:" valor={contacto} />
          </Caja>
          {/* Sin `flex` en estas dos: con cuatro datos del contratista, la fila es baja y
              repartirla a medias encimaba el título de cada caja con su texto. */}
          <View style={{ flex: 2, gap: 8 }}>
            <Caja titulo="Condiciones de pago">
              <Text style={s.destacado}>{pago}</Text>
              <Text style={s.texto}>Moneda: {nombreMoneda(o.divisa)}</Text>
            </Caja>
            <Caja titulo="Plazo del servicio">
              <Text style={s.destacado}>{o.fin ? `HASTA EL ${fecha(o.fin)}` : 'POR COORDINAR'}</Text>
              {o.inicio ? <Text style={s.texto}>Inicio: {fecha(o.inicio)}</Text> : null}
            </Caja>
          </View>
        </View>

        <View style={s.fila2}>
          <Caja titulo="Facturar a" flex={3}>
            <Text style={[s.texto, { fontFamily: 'Helvetica-Bold' }]}>{EMPRESA.razonSocial}</Text>
            <Dato titulo="Ruc:" valor={EMPRESA.ruc} />
            <Dato titulo="Dirección:" valor={EMPRESA.direccion} />
            <Dato titulo="Números de contacto:" valor={EMPRESA.telefonos} />
          </Caja>
          <Caja titulo="Enviar factura a" flex={2}>
            {EMPRESA.correosFactura.map((correo) => (
              <Text key={correo} style={s.texto}>
                {correo}
              </Text>
            ))}
          </Caja>
        </View>

        <View style={{ marginBottom: 8 }}>
          <Caja titulo="Destino del servicio">
            <Dato titulo="Código interno:" valor={o.codigoInterno} />
            {/* Las OS nuevas van por código interno; la OT sale solo en las de antes que la tenían. */}
            {o.orden ? <Dato titulo="OT:" valor={o.orden} /> : null}
            {o.unidad ? <Dato titulo="Unidad:" valor={o.unidad} /> : null}
            <Dato titulo="Área que lo pide:" valor={o.area} />
          </Caja>
        </View>

        <View style={s.tabla}>
          <View style={s.tablaTitulo} wrap={false}>
            <Text style={s.tablaTituloTexto}>DETALLE DEL SERVICIO</Text>
            <Text style={s.tablaTituloTexto}>IMPORTES EN {nombreMoneda(o.divisa)}, SIN IGV</Text>
          </View>
          <View style={s.filaCab} wrap={false}>
            <Text style={[s.cab, s.cItem]}>ITEM N°</Text>
            <Text style={[s.cab, s.cDesc]}>DESCRIPCIÓN Y ALCANCE</Text>
            <Text style={[s.cab, s.cImporte]}>IMPORTE</Text>
          </View>
          <View style={s.fila} wrap={false}>
            <Text style={[s.celda, s.cItem]}>1</Text>
            <View style={[s.celda, s.cDesc]}>
              <Text style={s.texto}>{o.descripcion}</Text>
              {o.referenciaProveedor ? <Text style={s.celdaSuave}>Ref. {o.referenciaProveedor}</Text> : null}
            </View>
            <Text style={[s.celda, s.cImporte]}>{numero(o.monto, 2)}</Text>
          </View>
        </View>

        <View style={s.totales} wrap={false}>
          <View style={s.totalFila}>
            <Text style={s.totalRotulo}>SUBTOTAL</Text>
            <Text style={s.totalValor}>{moneda(o.monto, o.divisa)}</Text>
          </View>
          <View style={s.totalFila}>
            <Text style={s.totalRotulo}>IGV 18%</Text>
            <Text style={s.totalValor}>{moneda(igv, o.divisa)}</Text>
          </View>
          <View style={s.totalFinal}>
            <Text style={s.totalRotulo}>TOTAL INCL IGV</Text>
            <Text style={s.totalValorFinal}>{moneda(o.monto + igv, o.divisa)}</Text>
          </View>
        </View>

        <View style={{ marginBottom: 8 }}>
          <Caja titulo="Detracción (SPOT)">
            <Text style={s.destacado}>{detraccion.titulo}</Text>
            {detraccion.detalle.map((d, i) => (
              <Text key={i} style={s.texto}>
                {d}
              </Text>
            ))}
          </Caja>
        </View>

        <Caja titulo="Observaciones / instrucciones">
          {observaciones.map((t, i) => (
            <Text key={i} style={s.texto}>
              {t}
            </Text>
          ))}
        </Caja>

        <View style={s.firmas} wrap={false}>
          <View style={s.firma}>
            <Text style={s.firmaRotulo}>EMITIDO POR:</Text>
            <Text style={s.firmaValor}>{o.emitidaPor ?? 'LOGÍSTICA'}</Text>
          </View>
          <View style={s.firma}>
            <Text style={s.firmaRotulo}>APROBADO POR:</Text>
            <Text style={s.firmaValor}>{`${o.aprobadaPor ?? 'GERENCIA'}${o.aprobadaEn ? ` · ${fecha(o.aprobadaEn)}` : ''}`}</Text>
          </View>
        </View>

        <View style={s.pie} fixed>
          <Text style={s.pieTexto}>
            {`Si tiene problemas o consultas relacionados a esta orden de servicio comunicarse con ${EMPRESA.consultas.area} - ${EMPRESA.consultas.telefono} - ${EMPRESA.consultas.correo}`}
          </Text>
          <Text
            style={s.pieTexto}
            render={({ pageNumber, totalPages }) => `${o.numero}${o.anulacion ? ' · ANULADA' : ''} · página ${pageNumber} de ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}
