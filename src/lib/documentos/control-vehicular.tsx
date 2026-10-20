import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'

import { CabeceraDocumento, PALETA_DOCUMENTO } from '@/lib/documentos/cabecera-documento'
import { EMPRESA } from '@/lib/dominio/empresa'
import { fecha } from '@/lib/format'
import type { Json } from '@/types/database'

type Item = { codigo: string; categoria: string; nombre: string; orden: number }
type Control = {
  placa: string; marca: string; conductor_ingreso: string; dni_ingreso: string
  fecha_ingreso: string | null; combustible_ingreso: string
  conductor_salida: string; dni_salida: string; fecha_salida: string | null
  combustible_salida: string; adicionales: string; trabajos: string
  observacion_ingreso: string; observacion_salida: string; items: Json
}

const { azul, tinta, suave, linea, lineaSuave, firma } = PALETA_DOCUMENTO

// El `lineHeight` va en cada estilo de texto y nunca en la página (ver la skill
// `diseno`), y siempre junto a su `fontSize`: sin él, react-pdf multiplica por su
// tamaño por omisión (18) y no por el 8 que hereda de la página; cada fila de
// puntos salía del doble de alto (comprobado al generar la ficha, 2026-10-20).
const s = StyleSheet.create({
  page: { padding: 14, fontFamily: 'Helvetica', fontSize: 8, color: tinta },
  row: { flexDirection: 'row', gap: 8 },
  // Base 0: todas parten del mismo ancho y un texto largo se parte en renglones.
  // Con solo `flexGrow`, la casilla crecía con su texto, pisaba la vecina y se
  // cortaba en el borde de la hoja.
  box: { borderWidth: 1, borderColor: linea, padding: 5, flexGrow: 1, flexBasis: 0, minWidth: 0 },
  label: { fontSize: 6, color: suave, marginBottom: 2, lineHeight: 1.2 },
  value: { fontSize: 8, fontFamily: 'Helvetica-Bold', minHeight: 12, lineHeight: 1.3 },
  filaSeccion: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 8, marginBottom: 4 },
  section: { fontFamily: 'Helvetica-Bold', fontSize: 9, lineHeight: 1.25 },
  leyenda: { fontSize: 7, color: suave, lineHeight: 1.25 },
  itemColumns: { flexDirection: 'row', gap: 8 },
  itemColumn: { width: '50%' },
  item: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: lineaSuave, minHeight: 10, alignItems: 'center' },
  itemName: { flexGrow: 1, width: '66%', fontSize: 8, lineHeight: 1.2 },
  itemStatus: { width: '17%', textAlign: 'center', fontSize: 6, lineHeight: 1.2 },
  group: { marginTop: 4, fontFamily: 'Helvetica-Bold', fontSize: 7, color: azul, lineHeight: 1.25 },
  // Se firma en el espacio de arriba de la raya (el `marginTop` de su fila); bajo
  // la raya, solo el rótulo. Con la cabecera de la empresa, la hoja entra justa en
  // una cara con los 49 puntos del catálogo.
  signature: { width: '33%', paddingTop: 5, borderTopWidth: 1, borderColor: firma, textAlign: 'center', fontSize: 7, lineHeight: 1.25 },
})

const CATEGORIAS: Record<string, string> = {
  CABINA_EXTERIOR: 'CABINA EXTERIOR',
  ACCESORIOS: 'ACCESORIOS',
  CABINA_INTERIOR: 'CABINA INTERIOR',
  HERRAMIENTAS: 'HERRAMIENTAS',
}

/**
 * Dos datos en una casilla («conductor / DNI»). Vacíos los dos, la casilla dice
 * «—» —antes imprimía un « · » suelto—; si falta uno, ese lleva su «—».
 */
function par(a: string | null | undefined, b: string | null | undefined) {
  const x = a?.trim() ?? ''
  const y = b?.trim() ?? ''
  if (!x && !y) return ''
  return `${x || '—'} · ${y || '—'}`
}

function estado(items: Json, codigo: string, fase: 'ingreso' | 'salida') {
  if (!items || typeof items !== 'object' || Array.isArray(items)) return '—'
  const punto = Reflect.get(items, codigo)
  if (!punto || typeof punto !== 'object' || Array.isArray(punto)) return '—'
  const valor = Reflect.get(punto, fase)
  return valor === 'CONFORME' ? 'C' : valor === 'NO_TIENE' ? 'N' : valor === 'OBSERVADO' ? 'O' : '—'
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <View style={s.box}>
      <Text style={s.label}>{titulo}</Text>
      <Text style={s.value}>{valor.trim() || '—'}</Text>
    </View>
  )
}

function Columna({ items, control }: { items: Item[]; control: Control | null }) {
  return (
    <View style={s.itemColumn}>
      <View style={s.item}>
        <Text style={s.itemName}>PUNTO DE INSPECCIÓN</Text>
        <Text style={s.itemStatus}>ING.</Text>
        <Text style={s.itemStatus}>SAL.</Text>
      </View>
      {items.map((item, index) => {
        const cabecera = index === 0 || item.categoria !== items[index - 1].categoria
        return (
          <View key={item.codigo} wrap={false}>
            {cabecera && <Text style={s.group}>{CATEGORIAS[item.categoria] ?? item.categoria}</Text>}
            <View style={s.item}>
              <Text style={s.itemName}>{item.nombre}</Text>
              <Text style={s.itemStatus}>{control ? estado(control.items, item.codigo, 'ingreso') : '—'}</Text>
              <Text style={s.itemStatus}>{control ? estado(control.items, item.codigo, 'salida') : '—'}</Text>
            </View>
          </View>
        )
      })}
    </View>
  )
}

/**
 * La ficha única de ingreso y salida (SIG-FCLIV-001). `referencia` es de qué
 * cuelga: la OT en las fichas viejas, el código interno del vehículo desde el
 * 2026-10-15 (migración 20261016110000). `logo` es la imagen ya leída; sin ella
 * va la razón social en texto.
 */
export function DocumentoControlVehicular({ referencia, cliente, items, control, logo, unidad }: {
  referencia: { etiqueta: string; valor: string }; cliente: string; items: Item[]; control: Control | null; logo: Buffer | null
  /** La placa y la marca que ya conoce el sistema, para la ficha que todavía no se llenó. */
  unidad?: { placa: string | null; marca: string | null } | null
}) {
  const mitad = Math.ceil(items.length / 2)
  const ref = referencia.valor ? referencia.etiqueta + ' ' + referencia.valor : ''
  return (
    <Document title={'Ficha de ingreso y salida' + (ref ? ' ' + ref : '')} author={EMPRESA.razonSocial}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <CabeceraDocumento
          logo={logo}
          titulo="CHECK LIST DE INSPECCIÓN VEHICULAR"
          numero={ref || undefined}
          lineas={['Ficha única de ingreso y salida']}
          codigo="SIG-FCLIV-001"
          compacta
        />
        <View style={s.row}>
          <Dato titulo="CLIENTE" valor={cliente} />
          <Dato titulo={referencia.etiqueta.toUpperCase()} valor={referencia.valor} />
          <Dato titulo="PLACA" valor={control?.placa || unidad?.placa || ''} />
          <Dato titulo="MARCA" valor={control?.marca || unidad?.marca || ''} />
        </View>
        <View style={[s.row, { marginTop: 4 }]}>
          <Dato titulo="CONDUCTOR AL INGRESO / DNI" valor={par(control?.conductor_ingreso, control?.dni_ingreso)} />
          <Dato
            titulo="FECHA / COMBUSTIBLE DE INGRESO"
            valor={par(control?.fecha_ingreso ? fecha(control.fecha_ingreso) : '', control?.combustible_ingreso)}
          />
          <Dato titulo="CONDUCTOR A LA SALIDA / DNI" valor={par(control?.conductor_salida, control?.dni_salida)} />
          <Dato
            titulo="FECHA / COMBUSTIBLE DE SALIDA"
            valor={par(control?.fecha_salida ? fecha(control.fecha_salida) : '', control?.combustible_salida)}
          />
        </View>
        <View style={s.filaSeccion}>
          <Text style={s.section}>Inspección de la unidad</Text>
          <Text style={s.leyenda}>C: Conforme · N: No tiene · O: Observado</Text>
        </View>
        <View style={s.itemColumns}>
          <Columna items={items.slice(0, mitad)} control={control} />
          <Columna items={items.slice(mitad)} control={control} />
        </View>
        <View style={[s.row, { marginTop: 8 }]}>
          <Dato titulo="ADICIONALES" valor={control?.adicionales ?? ''} />
          <Dato titulo="TRABAJOS REALIZADOS" valor={control?.trabajos ?? ''} />
        </View>
        <View style={[s.row, { marginTop: 4 }]}>
          <Dato titulo="OBSERVACIÓN AL INGRESO" valor={control?.observacion_ingreso ?? ''} />
          <Dato titulo="OBSERVACIÓN A LA SALIDA" valor={control?.observacion_salida ?? ''} />
        </View>
        <View style={[s.row, { marginTop: 23 }]} wrap={false}>
          <Text style={s.signature}>Entrega la unidad · Nombre, DNI y firma</Text>
          <Text style={s.signature}>Recibe en Metal Work · Nombre y firma</Text>
          <Text style={s.signature}>Conformidad de salida · Nombre, DNI y firma</Text>
        </View>
      </Page>
    </Document>
  )
}
