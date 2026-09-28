/** Datos que Administración puede contrastar con la OT antes de emitirla. */
export type DatosOrdenPdf = {
  numero: string | null
  fechaEntrega: string | null
  tipoUnidad: 'SEMIRREMOLQUE' | 'CARROCERIA_MONTADA' | null
  cliente: string | null
  producto: string | null
}

const MESES: Record<string, string> = {
  enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
  julio: '07', agosto: '08', septiembre: '09', setiembre: '09', octubre: '10',
  noviembre: '11', diciembre: '12',
}

export function leerDatosOrdenPdf(texto: string, nombreArchivo: string): DatosOrdenPdf {
  const numeroTexto = texto.match(/(?:ORDEN\s+DE\s+TRABAJO|\bOT\b)\s*(?:C[OÓ]DIGO\s*:\s*)?(?:N[°º.]?\s*)?(\d{1,6})(?:\s*[-/]\s*(\d{4}))?/i)
  const numeroArchivo = nombreArchivo.match(/\bOT\s*[-_ ]+\s*(\d{1,6})(?:\s*[-_]\s*(\d{4}))?/i)
  const numero = numeroTexto?.[1] ?? numeroArchivo?.[1] ?? null
  const anioNumero = numeroTexto?.[2] ?? numeroArchivo?.[2]
  const fecha = texto.match(/FECHA\s+DE\s+ENTREGA\s+(?:DE\s+)?(?:LA\s+)?UNIDAD\s*:\s*(?:[a-záéíóú]+,?\s*)?(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})/i)
    ?? texto.match(/FECHA\s+DE\s+(?:T[EÉ]RMINO|ENTREGA)\s*:\s*(\d{1,2})[/-](\d{1,2})[/-](\d{4})/i)
  const mes = fecha ? (MESES[fecha[2].toLowerCase()] ?? (/^\d{1,2}$/.test(fecha[2]) ? fecha[2].padStart(2, '0') : null)) : null
  const fechaEntrega = fecha && mes && Number(fecha[1]) >= 1 && Number(fecha[1]) <= 31
    ? `${fecha[3]}-${mes}-${fecha[1].padStart(2, '0')}` : null
  const productos = [...texto.matchAll(/(?:^|\n)PRODUCTO\s*:\s*([^\n]+)/gi)].map((m) => m[1].trim())
  const producto = productos.find((p) => /SEMIRREMOLQUE|CARROCER[IÍ]A|FURG[OÓ]N|TOLVA|CISTERNA/i.test(p)) ?? null
  const cliente = texto.match(/(?:^|\n)CLIENTE\s*:\s*([^\n]+)/i)?.[1]?.trim() ?? null
  const tipoUnidad = /SEMIRREMOLQUE/i.test(producto ?? nombreArchivo) ? 'SEMIRREMOLQUE'
    : /CARROCER[IÍ]A\s+MONTADA/i.test(producto ?? nombreArchivo) ? 'CARROCERIA_MONTADA' : null
  return { numero: numero ? `${numero}${anioNumero ? `-${anioNumero}` : ''}` : null, fechaEntrega, tipoUnidad, cliente, producto }
}
