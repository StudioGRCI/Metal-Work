import {
  AlignmentType, BorderStyle, Document, Header, HeadingLevel, ImageRun, Packer, PageNumber, PageOrientation, Paragraph,
  ShadingType, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, VerticalMergeType, WidthType,
} from 'docx'

import type { DatosInformeDiseno } from '@/lib/datos/informe-diseno'
import {
  FORMATO_INFORME_DISENO, codigoInternoOt, fechaDelInforme, nombreTarea, numeroInforme, planosPorArea, siglaCarroceria, vinetas,
} from '@/lib/dominio/informe-diseno'
import { fecha } from '@/lib/format'

/**
 * El informe semanal en el formato de la empresa MW-IF-DI-01: hoja A4
 * horizontal, cabecera con el logo, «INFORME», código, versión, fecha de
 * revisión y página; los datos del informe; las dos tablas (planificación de
 * modelado y avance de planos, con la conclusión de planos por área) y las
 * secciones de texto en viñetas, en el orden del formato.
 */
const LINEA = { style: BorderStyle.SINGLE, size: 4, color: '8C9BAD' }
const BORDES = { top: LINEA, bottom: LINEA, left: LINEA, right: LINEA, insideHorizontal: LINEA, insideVertical: LINEA }
const ANCHO_UTIL = 15398 // A4 horizontal (16 838) menos 0.5" por lado, en twips.

function texto(valor: string, opciones: { negrita?: boolean; tamano?: number; color?: string } = {}) {
  return new TextRun({ text: valor, bold: opciones.negrita, size: opciones.tamano, color: opciones.color })
}

function celda(valor: string, opciones: { cabecera?: boolean; ancho?: number; derecha?: boolean; centro?: boolean } = {}) {
  return new TableCell({
    width: opciones.ancho ? { size: opciones.ancho, type: WidthType.DXA } : undefined,
    verticalAlign: VerticalAlign.CENTER,
    shading: opciones.cabecera ? { type: ShadingType.CLEAR, color: 'auto', fill: 'DCE6F2' } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({
      alignment: opciones.derecha ? AlignmentType.RIGHT : opciones.centro || opciones.cabecera ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [texto(valor || '—', { negrita: opciones.cabecera, tamano: 17 })],
    })],
  })
}

/** Una tabla del formato: cabecera azul y una fila por registro; vacía, lo dice. */
function tabla(columnas: { titulo: string; ancho: number; derecha?: boolean; centro?: boolean }[], filas: string[][], pie?: string[]) {
  const total = columnas.reduce((s, c) => s + c.ancho, 0)
  const anchos = columnas.map((c) => Math.round((c.ancho / total) * ANCHO_UTIL))
  const fila = (valores: string[], cabecera = false) => new TableRow({
    tableHeader: cabecera,
    cantSplit: true,
    children: valores.map((v, i) => celda(v, { cabecera, ancho: anchos[i], derecha: !cabecera && columnas[i].derecha, centro: !cabecera && columnas[i].centro })),
  })
  const cuerpo = filas.length
    ? filas.map((f) => fila(f))
    : [new TableRow({ children: [new TableCell({
        columnSpan: columnas.length,
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [texto('Sin registros esta semana', { tamano: 17, color: '5B6878' })] })],
      })] })]
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: ANCHO_UTIL, type: WidthType.DXA },
    columnWidths: anchos,
    borders: BORDES,
    rows: [fila(columnas.map((c) => c.titulo), true), ...cuerpo, ...(pie ? [new TableRow({
      children: pie.map((v, i) => new TableCell({
        width: { size: anchos[i], type: WidthType.DXA },
        margins: { top: 40, bottom: 40, left: 80, right: 80 },
        children: [new Paragraph({ alignment: columnas[i].derecha ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [texto(v, { negrita: true, tamano: 17 })] })],
      })),
    })] : [])],
  })
}

/** Los títulos van numerados del 1 al 9 y subrayados, como en el formato. */
function titulo(valor: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 },
    children: [new TextRun({ text: valor, bold: true, underline: {}, color: '13467F' })],
  })
}

function vineta(valor: string) {
  return new Paragraph({ bullet: { level: 0 }, spacing: { after: 60 }, children: [texto(valor)] })
}

/** Una sección de texto: una viñeta por línea; vacía, lo dice para que no parezca olvidada. */
function seccion(nombre: string, contenido: string | null | undefined, comoParrafo = false) {
  const lineas = vinetas(contenido)
  return [
    titulo(nombre),
    ...(lineas.length
      ? lineas.map((l) => comoParrafo ? new Paragraph({ spacing: { after: 100 }, children: [texto(l)] }) : vineta(l))
      : [new Paragraph({ children: [texto('Nada que acotar en este punto.', { color: '5B6878' })] })]),
  ]
}

function cabecera(logo: Buffer | null) {
  const etiqueta = (v: string) => new Paragraph({ children: [texto(v, { negrita: true, tamano: 16 })] })
  const valor = (hijos: TextRun[]) => new Paragraph({ children: hijos })
  const filas: [string, TextRun[]][] = [
    ['Código:', [texto(FORMATO_INFORME_DISENO.codigo, { tamano: 16 })]],
    ['Versión:', [texto(FORMATO_INFORME_DISENO.version, { tamano: 16 })]],
    ['F. de revisión:', [texto(FORMATO_INFORME_DISENO.revision, { tamano: 16 })]],
    ['Página:', [new TextRun({ children: [PageNumber.CURRENT, ' de ', PageNumber.TOTAL_PAGES], size: 16 })]],
  ]
  const anchos = [3000, 8398, 2000, 2000]
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: ANCHO_UTIL, type: WidthType.DXA },
    columnWidths: anchos,
    borders: BORDES,
    rows: filas.map(([nombre, hijos], i) => new TableRow({
      children: [
        new TableCell({
          width: { size: anchos[0], type: WidthType.DXA },
          verticalMerge: i === 0 ? VerticalMergeType.RESTART : VerticalMergeType.CONTINUE,
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: i === 0 && logo
              ? [new ImageRun({ type: 'png', data: logo, transformation: { width: 120, height: 55 } })]
              : i === 0 ? [texto('METAL WORK', { negrita: true, color: '13467F' })] : [],
          })],
        }),
        new TableCell({
          width: { size: anchos[1], type: WidthType.DXA },
          verticalMerge: i === 0 ? VerticalMergeType.RESTART : VerticalMergeType.CONTINUE,
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: i === 0 ? [texto('INFORME', { negrita: true, tamano: 28 })] : [] })],
        }),
        new TableCell({ width: { size: anchos[2], type: WidthType.DXA }, margins: { left: 80 }, children: [etiqueta(nombre)] }),
        new TableCell({ width: { size: anchos[3], type: WidthType.DXA }, margins: { left: 80 }, children: [valor(hijos)] }),
      ],
    })),
  })
}

export async function generarInformeDiseno(datos: DatosInformeDiseno, logo: Buffer | null = null): Promise<Buffer> {
  const informe = datos.informe
  if (!informe) throw new Error('Guarda el informe antes de descargarlo.')

  const disenadores = [...new Set([...datos.tareas.map((t) => t.responsable), ...datos.entregas.map((e) => e.responsable)])].sort()
  const tareas = datos.tareas.map((t, i) => [
    String(i + 1), codigoInternoOt(t.codigo_interno, t.ot), siglaCarroceria(t.tipo_unidad), nombreTarea(t.tipo).toUpperCase(),
    t.componente.toUpperCase(), fecha(t.fecha_inicio), fecha(t.fecha_entrega), t.responsable.toUpperCase(),
  ])
  const entregas = datos.entregas.map((e, i) => [
    String(i + 1), codigoInternoOt(e.codigo_interno, e.ot), siglaCarroceria(e.tipo_unidad), String(e.n_planos), String(e.n_piezas),
    e.tipo_plano.toUpperCase(), e.fecha_entrega ? fecha(e.fecha_entrega) : '', e.estado === 'CULMINADO' ? 'CULMINADO' : 'EN PROCESO',
    e.responsable.toUpperCase(),
  ])
  const totalPlanos = datos.entregas.reduce((s, e) => s + e.n_planos, 0)
  const totalPiezas = datos.entregas.reduce((s, e) => s + e.n_piezas, 0)
  const conclusion = planosPorArea(datos.entregas)

  const dato = (nombre: string, valor: string) => new Paragraph({
    spacing: { after: 40 }, children: [texto(`${nombre}: `, { negrita: true, tamano: 24 }), texto(valor, { tamano: 24 })],
  })

  const documento = new Document({
    creator: 'Metal Work Perú S.A.C.',
    title: `Informe semanal N.º ${numeroInforme(informe.numero)} – Diseño`,
    styles: { default: { document: { run: { font: 'Arial', size: 20, color: '1D2939' } } } },
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720, header: 360 } } },
      headers: { default: new Header({ children: [cabecera(logo), new Paragraph({ children: [] })] }) },
      children: [
        new Paragraph({ heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { after: 200 },
          children: [new TextRun({ text: FORMATO_INFORME_DISENO.titulo.toUpperCase(), bold: true, underline: {}, color: '13467F' })] }),
        dato('Planta', FORMATO_INFORME_DISENO.planta.toUpperCase()),
        dato('Área', FORMATO_INFORME_DISENO.area.toUpperCase()),
        dato('N° de informe', numeroInforme(informe.numero)),
        dato('Responsable', informe.responsable),
        dato('Fecha', fecha(fechaDelInforme(datos.inicio))),

        ...seccion('1. Resumen', informe.resumen, true),

        titulo('2. Planificación de Modelado'),
        new Paragraph({ spacing: { after: 100 }, children: [texto('Todas las unidades tienen Código interno para la fabricación, las unidades por garantía o mantenimiento tienen OT, se debe registrar de ese modo.')] }),
        new Paragraph({ children: [texto('Diseñadores:', { negrita: true })] }),
        ...(disenadores.length ? disenadores : ['—']).map((d, i) => new Paragraph({ children: [texto(`${i + 1}. ${d}`)] })),
        new Paragraph({ children: [] }),
        tabla([
          { titulo: 'Ítem', ancho: 5, centro: true }, { titulo: 'Código Interno / OT', ancho: 20 }, { titulo: 'Tipo de Carrocería', ancho: 9, centro: true },
          { titulo: 'Tarea a ejecutar', ancho: 16 }, { titulo: 'Componente', ancho: 26 }, { titulo: 'Fecha de inicio', ancho: 9, centro: true },
          { titulo: 'Fecha de entrega', ancho: 9, centro: true }, { titulo: 'Responsable', ancho: 14 },
        ], tareas),

        titulo('3. Avance de planos o culminación'),
        tabla([
          { titulo: 'Ítem', ancho: 5, centro: true }, { titulo: 'Código Interno / OT', ancho: 19 }, { titulo: 'Tipo de carrocería', ancho: 8, centro: true },
          { titulo: 'N° de planos', ancho: 7, derecha: true }, { titulo: 'N° de piezas', ancho: 7, derecha: true }, { titulo: 'Tipo de plano', ancho: 26 },
          { titulo: 'Fecha de entrega', ancho: 9, centro: true }, { titulo: 'Estado', ancho: 9, centro: true }, { titulo: 'Responsable', ancho: 14 },
        ], entregas, entregas.length ? ['', 'TOTAL', '', String(totalPlanos), String(totalPiezas), '', '', '', ''] : undefined),
        new Paragraph({ spacing: { before: 160 }, children: [texto('CONCLUSIÓN:', { negrita: true })] }),
        ...(conclusion.length
          ? conclusion.map((a) => vineta(`${a.planos} PLANOS ENTREGADOS A ${a.nombre.toUpperCase()}.`))
          : [vineta('No se entregaron planos esta semana.')]),

        ...seccion('4. Problemas / incidencias', informe.incidencias),
        ...seccion('5. Acciones correctivas', informe.acciones),
        ...seccion('6. Control de Cambios y No Conformidades', informe.no_conformidades),
        ...seccion('7. Indicadores de gestión', informe.indicadores),
        ...seccion('8. Plan de Trabajo – Semana Siguiente', informe.plan_siguiente),
        ...seccion('9. Conclusiones y Recomendaciones', informe.conclusiones),
      ],
    }],
  })
  return Packer.toBuffer(documento)
}
