import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import type { Json } from '@/types/database'

type Item = { codigo: string; categoria: string; nombre: string; orden: number }
type Control = {
  placa: string; marca: string; conductor_ingreso: string; dni_ingreso: string
  fecha_ingreso: string | null; combustible_ingreso: string
  conductor_salida: string; dni_salida: string; fecha_salida: string | null
  combustible_salida: string; adicionales: string; trabajos: string
  observacion_ingreso: string; observacion_salida: string; items: Json
}

const s = StyleSheet.create({
  page: { padding: 14, fontFamily: 'Helvetica', fontSize: 8, color: '#16283d' },
  title: { fontSize: 14, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  small: { fontSize: 7, color: '#526174' },
  row: { flexDirection: 'row', gap: 8 },
  box: { borderWidth: 1, borderColor: '#aab6c4', padding: 5, flexGrow: 1 },
  label: { fontSize: 6, color: '#526174', marginBottom: 2 },
  value: { fontFamily: 'Helvetica-Bold', minHeight: 12 },
  section: { marginTop: 8, marginBottom: 4, fontFamily: 'Helvetica-Bold', fontSize: 9 },
  itemColumns: { flexDirection: 'row', gap: 8 },
  itemColumn: { width: '50%' },
  item: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: '#d6dce4', minHeight: 11, alignItems: 'center' },
  itemName: { flexGrow: 1, width: '66%' },
  itemStatus: { width: '17%', textAlign: 'center', fontSize: 6 },
  group: { marginTop: 4, fontFamily: 'Helvetica-Bold', fontSize: 7, color: '#174b83' },
  signature: { width: '33%', paddingTop: 17, borderTopWidth: 1, borderColor: '#8894a2', textAlign: 'center', fontSize: 7 },
})

function textoFecha(valor: string | null) {
  return valor ? valor.slice(8, 10) + '/' + valor.slice(5, 7) + '/' + valor.slice(0, 4) : '—'
}
function estado(items: Json, codigo: string, fase: 'ingreso' | 'salida') {
  if (!items || typeof items !== 'object' || Array.isArray(items)) return '—'
  const punto = Reflect.get(items, codigo)
  if (!punto || typeof punto !== 'object' || Array.isArray(punto)) return '—'
  const valor = Reflect.get(punto, fase)
  return valor === 'CONFORME' ? 'C' : valor === 'NO_TIENE' ? 'N' : valor === 'OBSERVADO' ? 'O' : '—'
}
function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return <View style={s.box}><Text style={s.label}>{titulo}</Text><Text style={s.value}>{valor || '—'}</Text></View>
}
function Columna({ items, control }: { items: Item[]; control: Control | null }) {
  return <View style={s.itemColumn}>
    <View style={s.item}><Text style={s.itemName}>PUNTO DE INSPECCIÓN</Text><Text style={s.itemStatus}>ING.</Text><Text style={s.itemStatus}>SAL.</Text></View>
    {items.map((item, index) => {
      const cabecera = index === 0 || item.categoria !== items[index - 1].categoria
      return <View key={item.codigo} wrap={false}>
        {cabecera && <Text style={s.group}>{({ CABINA_EXTERIOR: 'CABINA EXTERIOR', ACCESORIOS: 'ACCESORIOS', CABINA_INTERIOR: 'CABINA INTERIOR', HERRAMIENTAS: 'HERRAMIENTAS' } as Record<string, string>)[item.categoria]}</Text>}
        <View style={s.item}><Text style={s.itemName}>{item.nombre}</Text><Text style={s.itemStatus}>{control ? estado(control.items, item.codigo, 'ingreso') : '—'}</Text><Text style={s.itemStatus}>{control ? estado(control.items, item.codigo, 'salida') : '—'}</Text></View>
      </View>
    })}
  </View>
}

export function DocumentoControlVehicular({ numeroOt, cliente, items, control }: {
  numeroOt: string; cliente: string; items: Item[]; control: Control | null
}) {
  const mitad = Math.ceil(items.length / 2)
  return <Document title={'Ficha de ingreso y salida OT ' + numeroOt}>
    <Page size="A4" orientation="landscape" style={s.page}>
      <Text style={s.title}>METAL WORK · CHECK LIST DE INSPECCIÓN VEHICULAR</Text>
      <Text style={s.small}>SIG-FCLIV-001 · Ficha única de ingreso y salida · OT {numeroOt} · C: Conforme, N: No tiene, O: Observado</Text>
      <View style={[s.row, { marginTop: 8 }]}>
        <Dato titulo="CLIENTE" valor={cliente} /><Dato titulo="OT" valor={numeroOt} />
        <Dato titulo="PLACA" valor={control?.placa ?? ''} /><Dato titulo="MARCA" valor={control?.marca ?? ''} />
      </View>
      <View style={[s.row, { marginTop: 4 }]}>
        <Dato titulo="CONDUCTOR AL INGRESO / DNI" valor={(control?.conductor_ingreso ?? '') + ' · ' + (control?.dni_ingreso ?? '')} />
        <Dato titulo="FECHA / COMBUSTIBLE DE INGRESO" valor={textoFecha(control?.fecha_ingreso ?? null) + ' · ' + (control?.combustible_ingreso ?? '')} />
        <Dato titulo="CONDUCTOR A LA SALIDA / DNI" valor={(control?.conductor_salida ?? '') + ' · ' + (control?.dni_salida ?? '')} />
        <Dato titulo="FECHA / COMBUSTIBLE DE SALIDA" valor={textoFecha(control?.fecha_salida ?? null) + ' · ' + (control?.combustible_salida ?? '')} />
      </View>
      <Text style={s.section}>Inspección de la unidad</Text>
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
      <View style={[s.row, { marginTop: 23 }]}>
        <Text style={s.signature}>Entrega la unidad · Nombre, DNI y firma</Text>
        <Text style={s.signature}>Recibe en Metal Work · Nombre y firma</Text>
        <Text style={s.signature}>Conformidad de salida · Nombre, DNI y firma</Text>
      </View>
    </Page>
  </Document>
}
