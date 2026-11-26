import 'server-only'

import ExcelJS from 'exceljs'

import type { CompraTrazada } from '@/lib/datos/trazabilidad-compras'
import {
  ESTADO_PAGO,
  TIPO_DOCUMENTO_COMPRA,
  TIPO_DOCUMENTO_SERVICIO,
  documentosQueFaltan,
  textoDelDocumento,
  type DocumentoDeLaCompra,
} from '@/lib/dominio/adquisiciones'
import { definir } from '@/lib/dominio/estados'
import { ESTADO_SERVICIO, situacionCompra } from '@/lib/dominio/logistica'
import { APROBACION_COMPRA, compraDetenida, condicionDePago } from '@/lib/dominio/proveedores'
import { fecha, fechaHora } from '@/lib/format'

const AZUL = 'FF13467F'
const AVISO = 'FFFEF3C7'
const BORDE = 'FFC9D1DC'

export type CompraParaExcel = CompraTrazada & { papeles: DocumentoDeLaCompra[] }

/** Una celda por documento: lo que está con su número; lo que falta, desde cuándo y cuántos días. */
function celdaDelDocumento(d: DocumentoDeLaCompra | undefined): string {
  if (!d) return '—'
  const texto = textoDelDocumento(d)
  if (d.situacion === 'ESTA') return texto
  const desde = d.desde ? ` desde el ${fecha(d.desde)}` : ''
  const dias = d.dias === null ? '' : d.dias === 1 ? ' (1 día)' : ` (${d.dias} días)`
  return d.situacion === 'FALTA' ? `Falta${desde}${dias}` : `${texto}; lo demás falta${desde}${dias}`
}

/** «En qué va», como la columna de la pantalla: la aprobación de Gerencia y el avance. */
function enQueVa(f: CompraTrazada): string {
  const partes = [definir(APROBACION_COMPRA, f.aprobacion).etiqueta]
  if (f.aprobado_en && f.aprobacion === 'APROBADA') partes[0] += ` el ${fecha(f.aprobado_en)}`
  const avance =
    f.tipo === 'OS'
      ? f.estado && f.estado !== 'EMITIDA'
        ? definir(ESTADO_SERVICIO, f.estado)
        : null
      : compraDetenida(f.aprobacion)
        ? null
        : situacionCompra({ aprobacion: f.aprobacion, recojo: f.recojo, entregado_almacen_en: f.entregado_almacen_en, validacion: f.ingreso })
  if (avance) partes.push(avance.etiqueta)
  if (f.anulado_en) partes.push(`Anulada el ${fecha(f.anulado_en)}${f.motivo_anulacion ? `: ${f.motivo_anulacion}` : ''}`)
  if (f.aprobacion === 'RECHAZADA' && f.motivo_rechazo) partes.push(f.motivo_rechazo)
  return partes.join(' · ')
}

/** «De dónde sale», como la pantalla: los RQ, el código interno y el área. */
function origen(f: CompraTrazada): string {
  const partes = [
    f.requerimientos.map((r) => r.numero).join(', ') ||
      (f.tipo === 'OS' ? 'Sin RQ: servicio' : f.origen !== 'REQUERIMIENTO' ? 'Compra directa' : 'Requerimiento del código interno'),
    f.codigos.join(', '),
    f.areas.join(', '),
  ]
  return partes.filter(Boolean).join(' · ')
}

/** Lo demás que adjuntó Logística (la cotización, el contrato…), sin los comprobantes, que van en su columna. */
function otrosDocumentos(f: CompraTrazada): string {
  const tipos = f.tipo === 'OS' ? TIPO_DOCUMENTO_SERVICIO : TIPO_DOCUMENTO_COMPRA
  const comprobantes = new Set(['FACTURA', 'COMPROBANTE', 'BOLETA', 'RECIBO'])
  return f.documentos
    .filter((d) => !d.anulado_en && !comprobantes.has(d.tipo))
    .map((d) => `${tipos[d.tipo] ?? d.tipo}${d.numero ? ` ${d.numero}` : ''}`)
    .join(', ')
}

/**
 * Las OC y OS emitidas en un mes, con las columnas que Contabilidad ve en
 * Adquisiciones (Plan 10, entrega 10.2): la orden, de dónde sale, el proveedor,
 * el total, en qué va, sus documentos —uno por columna, con lo que falta y desde
 * cuándo— y el pago. No lleva nada que la pantalla no muestre.
 */
export async function generarAdquisicionesExcel({
  filas,
  mes,
  generadoEn,
  generadoPor,
}: {
  filas: CompraParaExcel[]
  mes: string
  generadoEn: Date
  generadoPor: string
}): Promise<Buffer> {
  const libro = new ExcelJS.Workbook()
  libro.creator = 'Metal Work'
  libro.created = generadoEn
  const columnas = [
    { titulo: 'Tipo', ancho: 6 },
    { titulo: 'Orden', ancho: 16 },
    { titulo: 'Emitida', ancho: 11 },
    { titulo: 'Emitida por', ancho: 20 },
    { titulo: 'De dónde sale', ancho: 30 },
    { titulo: 'Proveedor', ancho: 32 },
    { titulo: 'Moneda', ancho: 8 },
    { titulo: 'Total', ancho: 13 },
    { titulo: 'Condición de pago', ancho: 16 },
    { titulo: 'En qué va', ancho: 30 },
    { titulo: 'Factura o comprobante', ancho: 30 },
    { titulo: 'Guía de remisión', ancho: 26 },
    { titulo: 'Detracción', ancho: 26 },
    { titulo: 'Nota de crédito', ancho: 26 },
    { titulo: 'Otros documentos', ancho: 28 },
    { titulo: 'Qué falta', ancho: 34 },
    { titulo: 'Días de la espera más larga', ancho: 12 },
    { titulo: 'Pago', ancho: 18 },
  ]
  const [anio, numeroMes] = mes.split('-').map(Number)
  const nombreMes = new Intl.DateTimeFormat('es-PE', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(anio, numeroMes - 1, 1)))
  const hoja = libro.addWorksheet('Adquisiciones', {
    views: [{ state: 'frozen', ySplit: 4, xSplit: 2 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  })

  hoja.mergeCells(1, 1, 1, columnas.length)
  hoja.mergeCells(2, 1, 2, columnas.length)
  const t = hoja.getCell(1, 1)
  t.value = `Metal Work · Adquisiciones de ${nombreMes} de ${anio}`
  t.font = { bold: true, size: 16, color: { argb: AZUL } }
  hoja.getRow(1).height = 26
  const s = hoja.getCell(2, 1)
  s.value = `Las OC y OS emitidas en el mes, con qué documento tiene cada una, cuál falta y desde cuándo. «—»: no lo lleva. Descargado el ${fechaHora(generadoEn)} por ${generadoPor}.`
  s.font = { size: 10, color: { argb: 'FF4B5563' } }
  s.alignment = { wrapText: true, vertical: 'top' }
  hoja.getRow(2).height = 30

  const linea = { style: 'thin' as const, color: { argb: BORDE } }
  columnas.forEach((c, i) => {
    hoja.getColumn(i + 1).width = c.ancho
    const celda = hoja.getCell(4, i + 1)
    celda.value = c.titulo
    celda.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
    celda.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    celda.border = { top: linea, left: linea, bottom: linea, right: linea }
  })
  hoja.getRow(4).height = 32
  hoja.autoFilter = { from: 'A4', to: { row: Math.max(5, filas.length + 4), column: columnas.length } }

  let n = 5
  for (const f of filas) {
    const de = (documento: string) => f.papeles.find((p) => p.documento === documento)
    const faltan = documentosQueFaltan(f.papeles)
    const comprobante = de('FACTURA') ?? de('BOLETA') ?? de('COMPROBANTE')
    const r = hoja.getRow(n++)
    r.values = [
      f.tipo,
      f.numero ?? (f.tipo === 'OC' ? 'OC sin número' : 'OS sin número'),
      fecha(f.creado_en),
      f.emitido_por ?? '',
      origen(f),
      f.proveedor,
      f.moneda === 'USD' ? 'USD' : 'PEN',
      f.total === null || f.sin_precio ? null : f.total,
      condicionDePago(f.condicion_pago, f.dias_credito),
      enQueVa(f),
      celdaDelDocumento(comprobante),
      celdaDelDocumento(de('GUIA')),
      celdaDelDocumento(de('DETRACCION')),
      celdaDelDocumento(de('NOTA_CREDITO')),
      otrosDocumentos(f),
      faltan.map((d) => textoDelDocumento(d)).join('; '),
      faltan.reduce<number | null>((max, d) => (d.dias !== null && (max === null || d.dias > max) ? d.dias : max), null),
      definir(ESTADO_PAGO, f.pago).etiqueta,
    ]
    r.getCell(8).numFmt = '#,##0.00'
    r.alignment = { vertical: 'top', wrapText: true }
    if (faltan.length > 0) r.getCell(16).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AVISO } }
  }
  if (filas.length === 0) hoja.getCell(5, 1).value = 'Ninguna OC ni OS emitida en ese mes.'
  return Buffer.from(await libro.xlsx.writeBuffer())
}
