import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { ReactNode } from 'react'

import { igvCompra, importeCompra, totalCompra } from '@/lib/dominio/compra-materiales'
import { EMPRESA } from '@/lib/dominio/empresa'
import { cantidad, fecha, moneda, numero } from '@/lib/format'

export type LineaCompraPdf = {
  id: string
  codigo: string
  material: string
  unidad: string
  cantidad: number
  precio: number | null
  /** Para qué es la línea: la OT y la unidad, o PLANTA / ALMACÉN. */
  destino: string
}

export type CompraPdf = {
  numero: string
  referenciaProveedor: string | null
  /** Cuándo se emitió (ISO). */
  emitida: string
  entrega: string | null
  condicion: string
  dias: number
  divisa: 'PEN' | 'USD'
  conFactura: boolean
  motivo: string | null
  /** Gerencia la aprobó; las de antes de la regla no pasaron por aprobación. */
  aprobada: boolean
  /** Va con el conductor: recojo en la tienda del proveedor. */
  recojo: boolean
  proveedor: {
    nombre: string
    documento: string | null
    direccion: string | null
    direccionRecojo: string | null
    telefono: string | null
    contacto: string | null
  }
  /** La cuenta en la moneda de la compra. Null si no tiene, o si quien descarga no ve cuentas. */
  cuenta: { banco: string; titular: string; numero: string; moneda: string } | null
}

const AZUL = '#13467f'
const ROJO = '#fd0002'
const TINTA = '#16283d'
const SUAVE = '#526174'
const LINEA = '#aab6c4'
const FONDO = '#eef2f7'

// El `lineHeight` va en cada estilo de texto y nunca en la página ni en nada del
// pie: el pie es `fixed`, y con un `lineHeight` heredado, en su caja o en sus
// textos, desaparece de la hoja sin avisar (pasó con la evaluación, 2026-10-01).
const s = StyleSheet.create({
  pagina: { paddingTop: 24, paddingBottom: 42, paddingHorizontal: 28, fontFamily: 'Helvetica', fontSize: 8, color: TINTA },
  cabecera: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  logo: { width: 110, height: 46, objectFit: 'contain' },
  marcaTexto: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: AZUL, lineHeight: 1.2 },
  titulo: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: AZUL, textAlign: 'right', lineHeight: 1.25 },
  numero: { fontSize: 10, fontFamily: 'Helvetica-Bold', textAlign: 'right', lineHeight: 1.35 },
  emision: { fontSize: 8, textAlign: 'right', color: SUAVE, lineHeight: 1.35 },
  filete: { flexDirection: 'row', height: 3, marginBottom: 8 },
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
  textoSuave: { fontSize: 7, lineHeight: 1.3, color: SUAVE },
  tabla: { borderWidth: 0.75, borderColor: TINTA },
  filaCab: { flexDirection: 'row', backgroundColor: AZUL },
  fila: { flexDirection: 'row', borderTopWidth: 0.5, borderColor: LINEA },
  cab: { paddingHorizontal: 3, paddingVertical: 3, fontSize: 6.8, fontFamily: 'Helvetica-Bold', color: '#ffffff', lineHeight: 1.2 },
  celda: { paddingHorizontal: 3, paddingVertical: 3, fontSize: 7.5, lineHeight: 1.3 },
  celdaSuave: { fontSize: 6.5, lineHeight: 1.25, color: SUAVE },
  cItem: { width: '6%', textAlign: 'center' },
  cDesc: { width: '31%' },
  cCant: { width: '9%', textAlign: 'right' },
  cUm: { width: '7%', textAlign: 'center' },
  cMon: { width: '8%', textAlign: 'center' },
  cPrecio: { width: '10%', textAlign: 'right' },
  cTotal: { width: '12%', textAlign: 'right' },
  cDestino: { width: '17%' },
  totales: { alignSelf: 'flex-end', width: 200, marginTop: 6, borderWidth: 0.75, borderColor: TINTA },
  totalFila: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 5, paddingVertical: 2.5 },
  totalFinal: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 5, paddingVertical: 3, backgroundColor: FONDO, borderTopWidth: 0.75, borderColor: TINTA },
  totalRotulo: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', lineHeight: 1.3 },
  totalValor: { fontSize: 8, lineHeight: 1.3 },
  totalValorFinal: { fontSize: 9, fontFamily: 'Helvetica-Bold', lineHeight: 1.3 },
  firmas: { flexDirection: 'row', marginTop: 10, gap: 8 },
  firma: { flex: 1, borderWidth: 0.75, borderColor: TINTA, flexDirection: 'row' },
  firmaRotulo: { backgroundColor: FONDO, borderRightWidth: 0.75, borderColor: TINTA, paddingHorizontal: 5, paddingVertical: 4, fontSize: 7.5, fontFamily: 'Helvetica-Bold', lineHeight: 1.25 },
  firmaValor: { paddingHorizontal: 5, paddingVertical: 4, fontSize: 8, fontFamily: 'Helvetica-Bold', lineHeight: 1.25 },
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

/** Cierra la frase con un punto, sin duplicarlo cuando ya termina en uno («S.A.C.»). */
const conPunto = (frase: string) => (frase.trimEnd().endsWith('.') ? frase.trimEnd() : `${frase.trimEnd()}.`)

/**
 * La orden de compra que se le manda al proveedor, con la forma de la OC-5572
 * que usa la empresa: datos del proveedor con su cuenta, condiciones de pago, a
 * quién facturar y adónde mandar la factura, la tabla con el destino de cada
 * línea, subtotal, IGV y total, el método de envío y quién la pidió y aprobó.
 * Sin factura no lleva IGV y pide el comprobante que sí va. `logo` es la imagen
 * ya leída; sin ella va el nombre en texto.
 */
export function DocumentoCompraMateriales({ compra: c, lineas, logo }: { compra: CompraPdf; lineas: LineaCompraPdf[]; logo: Buffer | null }) {
  const subtotal = totalCompra(lineas)
  const igv = c.conFactura ? igvCompra(subtotal) : 0
  const pendiente = lineas.some((l) => l.precio === null)
  const pago = c.condicion === 'CREDITO' ? `CRÉDITO A ${c.dias} DÍAS` : 'CONTADO'
  const contacto = [c.proveedor.telefono, c.proveedor.contacto].filter(Boolean).join(' · ')
  const observaciones = [
    c.referenciaProveedor && c.referenciaProveedor !== c.numero ? `Según su cotización ${c.referenciaProveedor}.` : null,
    c.motivo,
    c.conFactura
      ? `Emitir la factura a nombre de ${EMPRESA.razonSocial} y enviarla a los correos indicados, con el número ${c.numero}.`
      : 'Compra sin factura: entregar boleta, nota de venta o recibo junto con la mercadería.',
    pendiente ? 'Hay líneas con precio pendiente: el total es parcial.' : null,
  ].filter(Boolean)

  return (
    <Document title={`Orden de compra ${c.numero}`} author={EMPRESA.razonSocial}>
      <Page size="A4" style={s.pagina}>
        <View style={s.cabecera}>
          {logo ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- el Image de react-pdf no es una etiqueta HTML
            <Image src={logo} style={s.logo} />
          ) : (
            <Text style={s.marcaTexto}>{EMPRESA.razonSocial}</Text>
          )}
          <View>
            <Text style={s.titulo}>ORDEN DE COMPRA</Text>
            <Text style={s.numero}>N°: {c.numero}</Text>
            <Text style={s.emision}>FECHA DE EMISIÓN: {fecha(c.emitida)}</Text>
          </View>
        </View>
        <View style={s.filete}>
          <View style={{ flex: 3, backgroundColor: AZUL }} />
          <View style={{ flex: 1, backgroundColor: ROJO }} />
        </View>

        <View style={s.fila2}>
          <Caja titulo="Datos del proveedor" flex={3}>
            <Dato titulo="Proveedor:" valor={c.proveedor.nombre} />
            <Dato titulo={c.proveedor.documento?.startsWith('RUC') ? 'Ruc:' : 'Documento:'} valor={c.proveedor.documento?.replace(/^RUC\s+/, '')} />
            <Dato titulo="Dirección:" valor={c.proveedor.direccion ?? c.proveedor.direccionRecojo} />
            <Dato titulo="Número de contacto:" valor={contacto} />
            <Dato titulo="Banco:" valor={c.cuenta ? `${c.cuenta.banco} (${c.cuenta.moneda === 'USD' ? 'dólares' : 'soles'})` : null} />
            <Dato titulo="Titular de la cuenta:" valor={c.cuenta?.titular} />
            <Dato titulo="Nro de cuenta:" valor={c.cuenta?.numero} />
          </Caja>
          <View style={{ flex: 2, gap: 8 }}>
            <Caja titulo="Condiciones de pago" flex={1}>
              <Text style={s.destacado}>{pago}</Text>
              <Text style={s.texto}>Moneda: {nombreMoneda(c.divisa)}</Text>
              <Text style={s.texto}>{c.conFactura ? 'Con factura' : 'Sin factura: con boleta, nota de venta o recibo'}</Text>
            </Caja>
            <Caja titulo="Fecha de entrega" flex={1}>
              <Text style={s.destacado}>{c.entrega ? fecha(c.entrega) : 'POR COORDINAR'}</Text>
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
          <Caja titulo={c.conFactura ? 'Enviar factura a' : 'Comprobante'} flex={2}>
            {c.conFactura ? (
              EMPRESA.correosFactura.map((correo) => (
                <Text key={correo} style={s.texto}>
                  {correo}
                </Text>
              ))
            ) : (
              <Text style={s.texto}>Sin factura. Entregar boleta, nota de venta o recibo junto con la mercadería.</Text>
            )}
          </Caja>
        </View>

        <View style={s.tabla}>
          <View style={s.filaCab} wrap={false}>
            <Text style={[s.cab, s.cItem]}>ITEM N°</Text>
            <Text style={[s.cab, s.cDesc]}>DESCRIPCIÓN</Text>
            <Text style={[s.cab, s.cCant]}>CANTIDAD</Text>
            <Text style={[s.cab, s.cUm]}>U.M</Text>
            <Text style={[s.cab, s.cMon]}>MONEDA</Text>
            <Text style={[s.cab, s.cPrecio]}>PRECIO</Text>
            <Text style={[s.cab, s.cTotal]}>TOTAL</Text>
            <Text style={[s.cab, s.cDestino]}>DESTINO</Text>
          </View>
          {lineas.map((l, i) => (
            <View key={l.id} style={s.fila} wrap={false}>
              <Text style={[s.celda, s.cItem]}>{i + 1}</Text>
              <View style={[s.celda, s.cDesc]}>
                <Text style={s.texto}>{l.material}</Text>
                {l.codigo ? <Text style={s.celdaSuave}>{l.codigo}</Text> : null}
              </View>
              <Text style={[s.celda, s.cCant]}>{cantidad(l.cantidad)}</Text>
              <Text style={[s.celda, s.cUm]}>{l.unidad}</Text>
              <Text style={[s.celda, s.cMon]}>{nombreMoneda(c.divisa)}</Text>
              <Text style={[s.celda, s.cPrecio]}>{l.precio === null ? 'Pendiente' : numero(l.precio, 2)}</Text>
              <Text style={[s.celda, s.cTotal]}>{l.precio === null ? 'Pendiente' : moneda(importeCompra(l.cantidad, l.precio), c.divisa)}</Text>
              <Text style={[s.celda, s.cDestino]}>{l.destino}</Text>
            </View>
          ))}
        </View>

        <View style={s.totales} wrap={false}>
          {c.conFactura ? (
            <>
              <View style={s.totalFila}>
                <Text style={s.totalRotulo}>SUBTOTAL</Text>
                <Text style={s.totalValor}>{moneda(subtotal, c.divisa)}</Text>
              </View>
              <View style={s.totalFila}>
                <Text style={s.totalRotulo}>IGV 18%</Text>
                <Text style={s.totalValor}>{moneda(igv, c.divisa)}</Text>
              </View>
              <View style={s.totalFinal}>
                <Text style={s.totalRotulo}>{pendiente ? 'TOTAL PARCIAL INCL IGV' : 'TOTAL INCL IGV'}</Text>
                <Text style={s.totalValorFinal}>{moneda(subtotal + igv, c.divisa)}</Text>
              </View>
            </>
          ) : (
            <View style={[s.totalFinal, { borderTopWidth: 0 }]}>
              <Text style={s.totalRotulo}>{pendiente ? 'TOTAL PARCIAL' : 'TOTAL'}</Text>
              <Text style={s.totalValorFinal}>{moneda(subtotal, c.divisa)}</Text>
            </View>
          )}
        </View>

        <View style={[s.fila2, { marginTop: 10 }]}>
          <Caja titulo="Método de envío" flex={1}>
            <Text style={s.destacado}>{c.recojo ? 'RECOJO DE TIENDA' : 'POR COORDINAR'}</Text>
          </Caja>
          <Caja titulo="Condiciones de envío" flex={2}>
            <Text style={s.texto}>
              {c.recojo
                ? conPunto(`Lo recoge el conductor de ${EMPRESA.razonSocial}${c.proveedor.direccionRecojo ?? c.proveedor.direccion ? ` en ${c.proveedor.direccionRecojo ?? c.proveedor.direccion}` : ''}`)
                : 'Logística coordina la entrega con el proveedor.'}
            </Text>
          </Caja>
        </View>

        <Caja titulo="Observaciones / instrucciones">
          {observaciones.map((o, i) => (
            <Text key={i} style={s.texto}>
              {o}
            </Text>
          ))}
        </Caja>

        <View style={s.firmas} wrap={false}>
          <View style={s.firma}>
            <Text style={s.firmaRotulo}>SOLICITADO POR:</Text>
            <Text style={s.firmaValor}>LOGÍSTICA</Text>
          </View>
          <View style={s.firma}>
            <Text style={s.firmaRotulo}>APROBADO POR:</Text>
            <Text style={s.firmaValor}>{c.aprobada ? 'GERENCIA' : 'SIN APROBACIÓN REQUERIDA'}</Text>
          </View>
        </View>

        <View style={s.pie} fixed>
          <Text style={s.pieTexto}>
            {`Si tiene problemas o consultas relacionados a esta orden de compra comunicarse con ${EMPRESA.consultas.area} - ${EMPRESA.consultas.telefono} - ${EMPRESA.consultas.correo}`}
          </Text>
          <Text style={s.pieTexto} render={({ pageNumber, totalPages }) => `${c.numero} · página ${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}
