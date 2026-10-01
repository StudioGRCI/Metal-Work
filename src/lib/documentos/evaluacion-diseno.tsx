import { Document, Image, Page, StyleSheet, Text, View } from '@react-pdf/renderer'
import {
  ESCALA_DISENO,
  INSTRUCCIONES_EVALUACION,
  PREGUNTA_EVALUACION,
  TITULO_FORMATO_EVALUACION,
  criteriosPorGrupo,
  puntajeDiseno,
} from '@/lib/dominio/evaluacion-diseno'
import { fecha, fechaHora, mesLargo } from '@/lib/format'

export type EvaluacionPdf = {
  evaluado_nombre: string
  puesto: string
  area_servicio: string
  fecha_ingreso: string | null
  fecha_evaluacion: string
  respuestas: number[]
  comentarios: string
  estado: string
  evaluador_nombre: string | null
  evaluador_cargo: string | null
  enviada_en: string | null
  recibida_en: string | null
}

const AZUL = '#13467f'
const ROJO = '#fd0002'
const TINTA = '#16283d'
const SUAVE = '#526174'
const LINEA = '#aab6c4'
const FONDO = '#eef2f7'

// El `lineHeight` va en cada estilo de texto y nunca en la página ni en nada del
// pie: el pie es `fixed`, y con un `lineHeight` heredado, en su caja o en sus
// textos, desaparece de la hoja sin avisar (comprobado el 2026-10-01).
const s = StyleSheet.create({
  pagina: { paddingTop: 22, paddingBottom: 30, paddingHorizontal: 32, fontFamily: 'Helvetica', fontSize: 8, color: TINTA },
  cabecera: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 },
  logo: { width: 80, height: 36, objectFit: 'contain' },
  marcaTexto: { fontSize: 12, fontFamily: 'Helvetica-Bold', color: AZUL, lineHeight: 1.2 },
  ruc: { fontSize: 7.5, color: SUAVE, lineHeight: 1.3, textAlign: 'right' },
  filete: { flexDirection: 'row', height: 3, marginBottom: 7 },
  titulo: { fontSize: 10, fontFamily: 'Helvetica-Bold', textAlign: 'center', lineHeight: 1.3, textTransform: 'uppercase' },
  borrador: { marginTop: 4, padding: 3, borderWidth: 1, borderColor: ROJO, color: ROJO, fontSize: 7.5, fontFamily: 'Helvetica-Bold', textAlign: 'center', lineHeight: 1.2 },
  pregunta: { marginTop: 4, fontSize: 7.2, textAlign: 'center', lineHeight: 1.3, color: SUAVE },
  instTitulo: { marginTop: 5, fontSize: 7.2, fontFamily: 'Helvetica-Bold', lineHeight: 1.3 },
  instColumnas: { flexDirection: 'row', gap: 14 },
  instColumna: { flex: 1 },
  inst: { flexDirection: 'row', marginTop: 1 },
  instNumero: { width: 9, fontSize: 6.6, lineHeight: 1.25, color: SUAVE },
  instTexto: { flex: 1, fontSize: 6.6, lineHeight: 1.25, color: SUAVE },
  escala: { flexDirection: 'row', marginTop: 4, borderWidth: 0.5, borderColor: LINEA },
  escalaCelda: { flex: 1, padding: 2.5, borderRightWidth: 0.5, borderColor: LINEA },
  escalaNivel: { fontSize: 7, fontFamily: 'Helvetica-Bold', lineHeight: 1.2 },
  escalaTexto: { fontSize: 6.2, lineHeight: 1.2, color: SUAVE },
  datos: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 7, marginBottom: 5 },
  dato: { width: '50%', flexDirection: 'row', marginBottom: 2 },
  datoTitulo: { width: 92, fontSize: 7.5, fontFamily: 'Helvetica-Bold', lineHeight: 1.3 },
  datoValor: { flex: 1, fontSize: 7.5, lineHeight: 1.3, textTransform: 'uppercase' },
  tabla: { borderWidth: 0.75, borderColor: TINTA },
  filaCab: { flexDirection: 'row', backgroundColor: FONDO, borderBottomWidth: 0.75, borderColor: TINTA },
  fila: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: LINEA, minHeight: 11.5, alignItems: 'center' },
  filaGrupo: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: LINEA, backgroundColor: FONDO },
  colCriterio: { flex: 1, paddingHorizontal: 4, paddingVertical: 1.5 },
  colNivel: { width: 40, borderLeftWidth: 0.5, borderColor: LINEA, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', paddingVertical: 1 },
  colPuntaje: { width: 44, borderLeftWidth: 0.75, borderColor: TINTA, alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', paddingVertical: 1 },
  cabTexto: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', textAlign: 'center', lineHeight: 1.2, textTransform: 'uppercase' },
  cabNumero: { fontSize: 8, fontFamily: 'Helvetica-Bold', textAlign: 'center', lineHeight: 1.2 },
  grupo: { fontSize: 6.8, fontFamily: 'Helvetica-Bold', lineHeight: 1.3, color: AZUL, textTransform: 'uppercase', paddingHorizontal: 4, paddingVertical: 1.5 },
  criterio: { fontSize: 7.4, lineHeight: 1.2 },
  equis: { fontSize: 8.5, fontFamily: 'Helvetica-Bold', lineHeight: 1 },
  puntaje: { fontSize: 8, fontFamily: 'Helvetica-Bold', lineHeight: 1.2 },
  filaTotal: { flexDirection: 'row', borderBottomWidth: 0.5, borderColor: LINEA, minHeight: 13, alignItems: 'center' },
  total: { flex: 1, paddingHorizontal: 4, fontSize: 8, fontFamily: 'Helvetica-Bold', textAlign: 'right', lineHeight: 1.3 },
  pie: { flexDirection: 'row', marginTop: 8, gap: 10 },
  caja: { borderWidth: 0.75, borderColor: TINTA, padding: 5 },
  cajaTitulo: { fontSize: 7, fontFamily: 'Helvetica-Bold', lineHeight: 1.3, textTransform: 'uppercase' },
  rendimiento: { fontSize: 16, fontFamily: 'Helvetica-Bold', textAlign: 'center', lineHeight: 1.2, marginTop: 4 },
  comentario: { fontSize: 7.5, lineHeight: 1.35, marginTop: 2 },
  firmas: { flexDirection: 'row', marginTop: 32, gap: 40, paddingHorizontal: 30 },
  firma: { flex: 1, borderTopWidth: 0.75, borderColor: TINTA, paddingTop: 3 },
  firmaRol: { fontSize: 7, fontFamily: 'Helvetica-Bold', textAlign: 'center', lineHeight: 1.3, textTransform: 'uppercase' },
  firmaNombre: { fontSize: 7.5, textAlign: 'center', lineHeight: 1.3 },
  piePagina: { position: 'absolute', bottom: 14, left: 32, right: 32, fontSize: 6.5, color: SUAVE, flexDirection: 'row', justifyContent: 'space-between' },
})

const GRUPOS = criteriosPorGrupo()

function constancia(e: EvaluacionPdf) {
  if (e.recibida_en) return `Enviada a Administración el ${fechaHora(e.enviada_en)} · recibida el ${fechaHora(e.recibida_en)}`
  if (e.estado === 'ENVIADA') return `Enviada a Administración el ${fechaHora(e.enviada_en)}`
  return 'Borrador: todavía no se envió a Administración'
}

/**
 * La evaluación impresa en el formato de la empresa, para firmar en duplicado
 * por el evaluador y el ratificador (su jefe), como piden las instrucciones.
 * `logo` es la imagen del logo ya leída; sin ella va el nombre en texto.
 */
export function DocumentoEvaluacionDiseno({ e, logo }: { e: EvaluacionPdf; logo: Buffer | null }) {
  const total = puntajeDiseno(e.respuestas)
  const sinEnviar = e.estado === 'BORRADOR' || e.estado === 'OBSERVADA'
  return (
    <Document title={`Evaluación de desempeño · ${e.evaluado_nombre}`} author="Metal Work Perú S.A.C.">
      <Page size="A4" style={s.pagina}>
        <View style={s.cabecera}>
          {logo
            // eslint-disable-next-line jsx-a11y/alt-text -- el Image de react-pdf no es una etiqueta HTML
            ? <Image src={logo} style={s.logo} />
            : <Text style={s.marcaTexto}>METAL WORK PERÚ S.A.C.</Text>}
          <View>
            <Text style={s.ruc}>RUC: 20601538840</Text>
            <Text style={s.ruc}>Diseño e Ingeniería</Text>
          </View>
        </View>
        <View style={s.filete}>
          <View style={{ flex: 3, backgroundColor: AZUL }} />
          <View style={{ flex: 1, backgroundColor: ROJO }} />
        </View>

        <Text style={s.titulo}>{TITULO_FORMATO_EVALUACION}</Text>
        {sinEnviar && <Text style={s.borrador}>BORRADOR · TODAVÍA NO SE ENVIÓ A ADMINISTRACIÓN</Text>}
        <Text style={s.pregunta}>{PREGUNTA_EVALUACION}</Text>

        <Text style={s.instTitulo}>INSTRUCCIONES</Text>
        <View style={s.instColumnas}>
          {[INSTRUCCIONES_EVALUACION.slice(0, 5), INSTRUCCIONES_EVALUACION.slice(5)].map((columna, c) => (
            <View key={c} style={s.instColumna}>
              {columna.map((texto, i) => (
                <View key={i} style={s.inst}>
                  <Text style={s.instNumero}>{c * 5 + i + 1}.</Text>
                  <Text style={s.instTexto}>{texto}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
        <View style={s.escala}>
          {ESCALA_DISENO.map((n, i) => (
            <View key={n.valor} style={[s.escalaCelda, i === ESCALA_DISENO.length - 1 ? { borderRightWidth: 0 } : {}]}>
              <Text style={s.escalaNivel}>{n.nivel}: {n.valor}</Text>
              <Text style={s.escalaTexto}>{n.rendimiento}</Text>
            </View>
          ))}
        </View>

        <View style={s.datos}>
          <Dato titulo="ÁREA / SERV." valor={e.area_servicio} />
          <Dato titulo="EVALUADO" valor={e.evaluado_nombre} />
          <Dato titulo="PUESTO" valor={e.puesto} />
          <Dato titulo="FECHA DE INGRESO" valor={e.fecha_ingreso ? mesLargo(e.fecha_ingreso) : '—'} />
          <Dato titulo="EVALUADOR" valor={e.evaluador_nombre ?? '—'} />
          <Dato titulo="FECHA DE EVALUACIÓN" valor={fecha(e.fecha_evaluacion)} />
        </View>

        <View style={s.tabla}>
          <View style={s.filaCab}>
            <View style={s.colCriterio}><Text style={[s.cabTexto, { textAlign: 'left' }]}>Área del desempeño</Text></View>
            {ESCALA_DISENO.map((n) => (
              <View key={n.valor} style={s.colNivel}>
                <Text style={s.cabTexto}>{n.nivel}</Text>
                <Text style={s.cabNumero}>{n.valor}</Text>
              </View>
            ))}
            <View style={s.colPuntaje}><Text style={s.cabTexto}>Puntaje</Text></View>
          </View>
          {GRUPOS.map((g) => (
            <View key={g.grupo} wrap={false}>
              <View style={s.filaGrupo}><Text style={s.grupo}>{g.grupo}</Text></View>
              {g.criterios.map(({ indice, nombre }) => (
                <View key={indice} style={s.fila}>
                  <View style={s.colCriterio}><Text style={s.criterio}>{nombre}</Text></View>
                  {ESCALA_DISENO.map((n) => (
                    <View key={n.valor} style={s.colNivel}>
                      <Text style={s.equis}>{e.respuestas[indice] === n.valor ? 'X' : ''}</Text>
                    </View>
                  ))}
                  <View style={s.colPuntaje}><Text style={s.puntaje}>{e.respuestas[indice]}</Text></View>
                </View>
              ))}
            </View>
          ))}
          <View style={s.filaTotal}>
            <Text style={s.total}>PUNTAJE TOTAL:</Text>
            <View style={s.colPuntaje}><Text style={s.puntaje}>{total} %</Text></View>
          </View>
          <View style={[s.filaTotal, { borderBottomWidth: 0 }]}>
            <Text style={s.total}>RENDIMIENTO DESEADO</Text>
            <View style={s.colPuntaje}><Text style={s.puntaje}>100 %</Text></View>
          </View>
        </View>

        <View style={s.pie} wrap={false}>
          <View style={[s.caja, { width: 92 }]}>
            <Text style={[s.cajaTitulo, { textAlign: 'center' }]}>Rendimiento</Text>
            <Text style={s.rendimiento}>{total} %</Text>
          </View>
          <View style={[s.caja, { flex: 1, minHeight: 52 }]}>
            <Text style={s.cajaTitulo}>Comentarios:</Text>
            <Text style={s.comentario}>{e.comentarios || ' '}</Text>
          </View>
        </View>

        <View style={s.firmas} wrap={false}>
          <View style={s.firma}>
            <Text style={s.firmaRol}>Evaluador{e.evaluador_cargo ? ` (${e.evaluador_cargo})` : ''}</Text>
            <Text style={s.firmaNombre}>{e.evaluador_nombre ?? ' '}</Text>
          </View>
          <View style={s.firma}>
            <Text style={s.firmaRol}>Ratificador</Text>
            <Text style={s.firmaNombre}>Jefe del evaluador</Text>
          </View>
        </View>

        <View style={s.piePagina} fixed>
          <Text>Metal Work · Evaluación de desempeño · {constancia(e)}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} de ${totalPages}`} />
        </View>
      </Page>
    </Document>
  )
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <View style={s.dato}>
      <Text style={s.datoTitulo}>{titulo}</Text>
      <Text style={s.datoValor}>: {valor}</Text>
    </View>
  )
}
