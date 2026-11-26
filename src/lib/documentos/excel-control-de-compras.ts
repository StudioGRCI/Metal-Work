import 'server-only'

import ExcelJS from 'exceljs'

import type { FilaControlDeCompras } from '@/lib/datos/control-de-compras'
import { nombreDeOc } from '@/lib/dominio/adquisiciones'

const AZUL = 'FF13467F'
const AZUL_SUAVE = 'FFE8EEF6'
const BORDE = 'FFC9D1DC'

/** Las columnas del CONTROL DE FACTURAS 2026, en su orden. */
const COLUMNAS = [
  { titulo: 'FECHA', ancho: 12 },
  { titulo: 'DESCRIPCIÓN', ancho: 44 },
  { titulo: 'DETALLE (OC-OS)', ancho: 16 },
  { titulo: 'PROVEEDOR / CLIENTE', ancho: 30 },
  { titulo: 'DESTINO', ancho: 22 },
  { titulo: 'COMPROBANTE (Factura - RXH)', ancho: 16 },
  { titulo: 'N° DE COMPROBANTE', ancho: 18 },
  { titulo: 'EGRESO', ancho: 13 },
  { titulo: 'PESO (KG)', ancho: 10 },
  { titulo: 'RECEPCIÓN DE ALMACÉN', ancho: 14 },
  { titulo: 'RECEPCIÓN DE TESORERÍA', ancho: 14 },
  { titulo: 'OBSERVACIONES (Devoluciones u otros)', ancho: 36 },
] as const

/**
 * Qué comprobante es por su serie: F factura, B boleta. La serie E la usan el
 * recibo por honorarios y la factura electrónica del emisor del SUNAT, y por
 * la serie no se distinguen: queda «COMPROBANTE».
 */
function tipoDeComprobante(numero: string | null): string {
  if (!numero) return ''
  return ({ F: 'FACTURA', B: 'BOLETA' } as Record<string, string>)[numero[0]] ?? 'COMPROBANTE'
}

function borde(celda: ExcelJS.Cell) {
  const linea = { style: 'thin' as const, color: { argb: BORDE } }
  celda.border = { top: linea, left: linea, bottom: linea, right: linea }
}

/** `YYYY-MM-DD` a la celda de fecha, sin pasar por el huso: Excel no lo tiene. */
const diaExcel = (dia: string) => new Date(`${dia}T00:00:00Z`)
const diaTexto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`

function hoja(libro: ExcelJS.Workbook, nombre: string, titulo: string, filas: FilaControlDeCompras[], moneda: 'PEN' | 'USD') {
  const h = libro.addWorksheet(nombre, {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  h.columns = COLUMNAS.map((c) => ({ width: c.ancho }))
  h.mergeCells(1, 1, 1, COLUMNAS.length)
  const cabeza = h.getCell(1, 1)
  cabeza.value = titulo
  cabeza.font = { bold: true, size: 14, color: { argb: AZUL } }
  h.getRow(1).height = 24

  // Un bloque por día, como el Excel de Almacén: el día y sus encabezados.
  const dias = [...new Set(filas.map((f) => f.fecha))].sort()
  for (const dia of dias) {
    h.addRow([])
    const r = h.addRow([`DÍA ${diaTexto(dia)}`])
    r.font = { bold: true, color: { argb: AZUL } }
    const e = h.addRow(COLUMNAS.map((c) => c.titulo))
    e.height = 30
    e.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
      borde(c)
    })
    const delDia = filas.filter((f) => f.fecha === dia)
    for (const f of delDia) {
      const fila = h.addRow([
        diaExcel(f.fecha),
        f.descripcion ?? '',
        f.tipo === 'OC' ? nombreDeOc(f) : (f.numero ?? ''),
        f.proveedor ?? '',
        f.destino ?? 'STOCK',
        tipoDeComprobante(f.factura_numero ?? f.comprobante_registrado),
        f.factura_numero ?? f.comprobante_registrado ?? '',
        f.total,
        f.peso_kg,
        // Como en el Excel de Almacén: llegó el material y recibió la factura.
        f.factura_numero && (f.material === 'LLEGO' || f.material === 'NO_APLICA') ? 'SÍ' : 'NO',
        f.comprobante_registrado ? 'SÍ' : 'NO',
        [f.material === 'POR_APROBAR' && 'POR APROBAR (no suma al egreso)', f.guia_numero && `Guía ${f.guia_numero}`, f.observacion]
          .filter(Boolean)
          .join(' · '),
      ])
      fila.getCell(1).numFmt = 'dd/mm/yyyy'
      fila.getCell(8).numFmt = moneda === 'USD' ? '"US$" #,##0.00' : '"S/" #,##0.00'
      fila.getCell(9).numFmt = '#,##0.0'
      fila.eachCell({ includeEmpty: true }, (c, n) => {
        borde(c)
        c.alignment = { vertical: 'top', wrapText: n === 2 || n === 12 }
      })
    }
    // La que Gerencia no aprobó todavía no es egreso: sale en su fila, sin sumar.
    const total = h.addRow(['', '', '', '', '', '', 'EGRESOS DEL DÍA', delDia.filter((f) => f.material !== 'POR_APROBAR').reduce((s, f) => s + (f.total ?? 0), 0)])
    total.getCell(7).font = { bold: true }
    total.getCell(8).font = { bold: true }
    total.getCell(8).numFmt = moneda === 'USD' ? '"US$" #,##0.00' : '"S/" #,##0.00'
    total.getCell(8).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_SUAVE } }
  }
  if (dias.length === 0) h.addRow(['No hay compras en este periodo.'])
}

/**
 * El CONTROL DE FACTURAS con el formato de Almacén: una hoja en soles y otra en
 * dólares, un bloque por día con sus encabezados y el egreso del día. «Recepción
 * de Almacén» es SÍ cuando llegó el material y Almacén anotó la factura; «de
 * Tesorería», cuando el comprobante está registrado en el sistema.
 */
export async function generarControlDeCompras({ filas, periodo }: { filas: FilaControlDeCompras[]; periodo: string }) {
  const libro = new ExcelJS.Workbook()
  libro.creator = 'Metal Work Perú'
  hoja(libro, 'MW Soles', `CONTROL DE FACTURAS MW - SOLES · ${periodo}`, filas.filter((f) => f.moneda === 'PEN'), 'PEN')
  hoja(libro, 'MW Dolares', `CONTROL DE FACTURAS MW - DÓLARES · ${periodo}`, filas.filter((f) => f.moneda === 'USD'), 'USD')
  return Buffer.from(await libro.xlsx.writeBuffer())
}
