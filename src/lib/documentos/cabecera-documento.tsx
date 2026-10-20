import { Image, StyleSheet, Text, View } from '@react-pdf/renderer'

import { EMPRESA } from '@/lib/dominio/empresa'

/**
 * La paleta del manual para los documentos impresos. Un documento nuevo la toma
 * de aquí en lugar de copiar los hexadecimales.
 */
export const PALETA_DOCUMENTO = {
  azul: '#13467f',
  rojo: '#fd0002',
  tinta: '#16283d',
  suave: '#526174',
  linea: '#aab6c4',
  fondo: '#eef2f7',
} as const

const { azul, rojo, suave, tinta } = PALETA_DOCUMENTO

// Cada texto lleva su `lineHeight`: con un `fontSize` grande y sin él, el título
// pisa la línea siguiente. La cabecera no es `fixed`; un pie sí lo es, y ese no
// lleva `lineHeight` en ninguna parte (ver la skill `diseno`).
const s = StyleSheet.create({
  cabecera: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 6 },
  marca: { maxWidth: '55%' },
  // Con la proporción del logo (3116 × 1438): así no queda margen y la razón social
  // de abajo se alinea con su borde.
  logo: { width: 100, height: 46, objectFit: 'contain' },
  marcaTexto: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: azul, lineHeight: 1.2 },
  razonSocial: { marginTop: 3, fontSize: 7.5, fontFamily: 'Helvetica-Bold', lineHeight: 1.3 },
  ruc: { fontSize: 7.5, color: suave, lineHeight: 1.3 },
  documento: { flexShrink: 1, alignItems: 'flex-end' },
  titulo: { fontSize: 15, fontFamily: 'Helvetica-Bold', color: azul, textAlign: 'right', lineHeight: 1.25 },
  numero: { fontSize: 10, fontFamily: 'Helvetica-Bold', textAlign: 'right', lineHeight: 1.35 },
  linea: { fontSize: 8, color: suave, textAlign: 'right', lineHeight: 1.35 },
  codigo: { marginTop: 2, fontSize: 7, color: suave, textAlign: 'right', lineHeight: 1.3 },
  filete: { flexDirection: 'row', height: 3, marginBottom: 8 },
  // La compacta, para la hoja que tiene que caber entera en una cara (la ficha
  // vehicular apaisada): el logo más bajo con la razón social al lado, y todo lo
  // que identifica al documento en un solo renglón bajo el título.
  marcaCompacta: { maxWidth: '50%', flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoCompacto: { width: 61, height: 28, objectFit: 'contain' },
  marcaTextoCompacto: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: azul, lineHeight: 1.2 },
  tituloCompacto: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: azul, textAlign: 'right', lineHeight: 1.25 },
  lineaCompacta: { fontSize: 7.5, color: suave, textAlign: 'right', lineHeight: 1.35 },
  numeroCompacto: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: tinta, lineHeight: 1.35 },
  fileteCompacto: { flexDirection: 'row', height: 3, marginBottom: 6 },
})

/**
 * La cabecera común de los documentos que salen de la empresa: el logo (o el
 * nombre en texto si no se pudo leer), la razón social y el RUC a la izquierda;
 * a la derecha qué documento es, su número, lo que lo identifica y el código
 * del formato, y debajo el filete azul y rojo del manual.
 *
 * Los datos de la empresa salen de `EMPRESA` (`src/lib/dominio/empresa.ts`).
 * Todavía hay documentos que los escriben a mano —la evaluación de desempeño,
 * el formato de salida de almacén—: unificarlos está pendiente (P2-5 de la
 * revisión de formatos, 2026-10-20) y pide que Administración confirme antes la
 * razón social y la dirección fiscal.
 */
export function CabeceraDocumento({
  logo,
  titulo,
  numero,
  lineas = [],
  codigo,
  compacta = false,
}: {
  /** El logo ya leído del disco; sin él va la razón social en letra grande. */
  logo: Buffer | null
  /** Qué documento es, en mayúsculas: «ORDEN DE COMPRA». */
  titulo: string
  /** El número o la referencia que lo identifica, en negrita bajo el título. */
  numero?: string
  /** Lo que acompaña al número: la fecha de emisión, de qué es la ficha. */
  lineas?: string[]
  /** El código del formato de la empresa (SIG-FCLIV-001). Sin él no se imprime nada. */
  codigo?: string
  /** Para la hoja que tiene que caber en una cara: menos alto, con los datos en un renglón. */
  compacta?: boolean
}) {
  if (compacta) {
    const detalle = [...lineas, codigo ? `Código del formato: ${codigo}` : null].filter(Boolean).join(' · ')
    return (
      <>
        <View style={s.cabecera}>
          <View style={s.marcaCompacta}>
            {logo ? (
              // eslint-disable-next-line jsx-a11y/alt-text -- el Image de react-pdf no es una etiqueta HTML
              <Image src={logo} style={s.logoCompacto} />
            ) : null}
            <View>
              <Text style={logo ? s.razonSocial : s.marcaTextoCompacto}>{EMPRESA.razonSocial}</Text>
              <Text style={s.ruc}>RUC {EMPRESA.ruc}</Text>
            </View>
          </View>
          <View style={s.documento}>
            <Text style={s.tituloCompacto}>{titulo}</Text>
            <Text style={s.lineaCompacta}>
              {numero ? <Text style={s.numeroCompacto}>{numero}</Text> : null}
              {numero && detalle ? ' · ' : ''}
              {detalle}
            </Text>
          </View>
        </View>
        <View style={s.fileteCompacto}>
          <View style={{ flex: 3, backgroundColor: azul }} />
          <View style={{ flex: 1, backgroundColor: rojo }} />
        </View>
      </>
    )
  }

  return (
    <>
      <View style={s.cabecera}>
        <View style={s.marca}>
          {logo ? (
            // eslint-disable-next-line jsx-a11y/alt-text -- el Image de react-pdf no es una etiqueta HTML
            <Image src={logo} style={s.logo} />
          ) : (
            <Text style={s.marcaTexto}>{EMPRESA.razonSocial}</Text>
          )}
          {logo && <Text style={s.razonSocial}>{EMPRESA.razonSocial}</Text>}
          <Text style={s.ruc}>RUC {EMPRESA.ruc}</Text>
        </View>
        <View style={s.documento}>
          <Text style={s.titulo}>{titulo}</Text>
          {numero ? <Text style={s.numero}>{numero}</Text> : null}
          {lineas.map((linea) => (
            <Text key={linea} style={s.linea}>
              {linea}
            </Text>
          ))}
          {codigo ? <Text style={s.codigo}>Código del formato: {codigo}</Text> : null}
        </View>
      </View>
      <View style={s.filete}>
        <View style={{ flex: 3, backgroundColor: azul }} />
        <View style={{ flex: 1, backgroundColor: rojo }} />
      </View>
    </>
  )
}
