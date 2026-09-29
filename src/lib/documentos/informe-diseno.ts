import { AlignmentType, BorderStyle, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'

import type { datosInformeDiseno } from '@/lib/datos/informe-diseno'
import { fecha, fechaHora } from '@/lib/format'

type Datos = Awaited<ReturnType<typeof datosInformeDiseno>>

function parrafo(texto: string, negrita = false) {
  return new Paragraph({ children: [new TextRun({ text: texto || '—', bold: negrita })], spacing: { after: 120 } })
}

function titulo(texto: string) {
  return new Paragraph({ text: texto, heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 } })
}

function tabla(cabeceras: string[], filas: string[][]) {
  const celdas = (valores: string[], cabecera = false) => new TableRow({
    children: valores.map(valor => new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text: valor || '—', bold: cabecera, size: 18 })] })],
      shading: cabecera ? { fill: 'DDE8F5' } : undefined,
    })),
  })
  return new Table({
    rows: [celdas(cabeceras, true), ...(filas.length ? filas.map(fila => celdas(fila)) : [celdas(['Sin registros esta semana', ...cabeceras.slice(1).map(() => '—')])])],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'C6D1DD' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'C6D1DD' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'C6D1DD' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'C6D1DD' },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: 'C6D1DD' },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: 'C6D1DD' },
    },
  })
}

export async function generarInformeDiseno(datos: Datos): Promise<Buffer> {
  const informe = datos.informe
  if (!informe) throw new Error('Guarda el informe antes de descargarlo.')
  const tareas = datos.tareas.map(t => [
    t.ot, t.tipo.replaceAll('_', ' '), t.componente, fecha(t.fecha_inicio), fecha(t.fecha_entrega), t.responsable, t.observacion ?? '—',
  ])
  const planos = datos.planos.map(p => [
    p.ot, String(p.numero), p.nombre, '1', '—', p.area, fechaHora(p.entregado_en), p.estado, p.responsable,
  ])
  const secciones: [string, string | null][] = [
    ['1. Resumen', informe.resumen],
    ['4. Problemas e incidencias', informe.incidencias],
    ['5. Acciones correctivas', informe.acciones],
    ['6. Cambios y no conformidades', informe.no_conformidades],
    ['7. Indicadores de gestión', informe.indicadores],
    ['8. Plan de la semana siguiente', informe.plan_siguiente],
    ['9. Conclusiones y recomendaciones', informe.conclusiones],
  ]
  const documento = new Document({
    styles: { default: { document: { run: { font: 'Aptos', size: 20, color: '1D2939' } } } },
    sections: [{ properties: { page: { margin: { top: 900, bottom: 900, left: 700, right: 700 } } }, children: [
      new Paragraph({ text: 'METAL WORK PERÚ S.A.C.', heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }),
      new Paragraph({ text: 'ÁREA DE DISEÑO E INGENIERÍA', alignment: AlignmentType.CENTER }),
      new Paragraph({ text: `INFORME SEMANAL N.º ${informe.numero}`, alignment: AlignmentType.CENTER, spacing: { before: 180, after: 300 } }),
      parrafo(`Responsable: ${informe.responsable}`),
      parrafo(`Semana: ${fecha(datos.inicio)} al ${fecha(datos.fin)}`),
      titulo(secciones[0][0]), parrafo(secciones[0][1] ?? ''),
      titulo('2. Planificación y modelado'),
      tabla(['OT', 'Tarea', 'Componente', 'Inicio', 'Entrega', 'Responsable', 'Observación'], tareas),
      titulo('3. Planos aprobados por Diseño'),
      tabla(['OT', 'Plano', 'Descripción', 'N.º planos', 'N.º piezas', 'Área', 'Aprobado', 'Estado', 'Responsable'], planos),
      ...secciones.slice(1).flatMap(([nombre, contenido]) => [titulo(nombre), parrafo(contenido ?? '')]),
    ] }],
  })
  return Packer.toBuffer(documento)
}
