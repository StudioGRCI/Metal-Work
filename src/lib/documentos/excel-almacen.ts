import 'server-only'

import ExcelJS from 'exceljs'

import type { FilaKardex } from '@/lib/datos/kardex'
import { MOVIMIENTO_KARDEX, ORIGEN_KARDEX } from '@/lib/dominio/almacen'

const AZUL = 'FF13467F'
const AZUL_SUAVE = 'FFE8EEF6'
const GRIS = 'FFF1F3F6'
const ROJO = 'FFC8121A'
const BORDE = 'FFC9D1DC'

/** Filas de cada hoja de la planilla: suficientes para varios días sin señal. */
export const FILAS_PLANILLA = 300
/** Fila donde están los encabezados de Ingresos y Salidas; lo anotado empieza debajo. */
export const FILA_ENCABEZADO_PLANILLA = 4

const ZONA = 'America/Lima'

/**
 * Excel no tiene husos: guarda la hora tal cual. Se le da la hora de Lima
 * como si fuera UTC, para que la celda diga lo mismo que la pantalla.
 */
function horaDeLima(valor: string | Date): Date {
  const d = typeof valor === 'string' ? new Date(valor) : valor
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(d).map((p) => [p.type, p.value]))
  return new Date(Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day), Number(partes.hour) % 24, Number(partes.minute), Number(partes.second)))
}

/**
 * Una validación para todo un rango. exceljs la tiene (`worksheet.dataValidations`)
 * pero sus tipos no la declaran; la alternativa tipada, una por celda, multiplica
 * el archivo por cada fila de la planilla.
 */
function validar(hoja: ExcelJS.Worksheet, rango: string, regla: ExcelJS.DataValidation) {
  (hoja as unknown as { dataValidations: { add(r: string, v: ExcelJS.DataValidation): void } }).dataValidations.add(rango, regla)
}

function borde(celda: ExcelJS.Cell) {
  const linea = { style: 'thin' as const, color: { argb: BORDE } }
  celda.border = { top: linea, left: linea, bottom: linea, right: linea }
}

function encabezado(fila: ExcelJS.Row) {
  fila.height = 30
  fila.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    borde(c)
  })
}

function titulo(hoja: ExcelJS.Worksheet, texto: string, subtitulo: string, columnas: number) {
  hoja.mergeCells(1, 1, 1, columnas)
  hoja.mergeCells(2, 1, 2, columnas)
  const t = hoja.getCell(1, 1)
  t.value = texto
  t.font = { bold: true, size: 16, color: { argb: AZUL } }
  hoja.getRow(1).height = 26
  const s = hoja.getCell(2, 1)
  s.value = subtitulo
  s.font = { size: 10, color: { argb: 'FF4B5563' } }
  s.alignment = { wrapText: true, vertical: 'top' }
  hoja.getRow(2).height = 30
}

// ------------------------------------------------------------------ planilla

export type MaterialDePlanilla = { codigo: string; descripcion: string; unidad: string | null; saldo: number; libre: number }
export type UnidadDePlanilla = { identificador: string; placa: string | null; vehiculo: string | null; ordenes: string | null }

/**
 * La planilla para anotar sin internet. Las listas desplegables y las
 * fórmulas funcionan sin conexión: el código del material trae su
 * descripción y su unidad, y la unidad se elige de las registradas o se
 * escribe su código de fabricación.
 */
export async function generarPlanillaAlmacen({ materiales, unidades, generadoEn, generadoPor }: {
  materiales: MaterialDePlanilla[]
  unidades: UnidadDePlanilla[]
  generadoEn: Date
  generadoPor: string
}): Promise<Buffer> {
  const libro = new ExcelJS.Workbook()
  libro.creator = 'Metal Work'
  libro.created = generadoEn
  libro.calcProperties.fullCalcOnLoad = true
  const hoy = horaDeLima(generadoEn)
  const fechaTexto = `${String(hoy.getUTCDate()).padStart(2, '0')}/${String(hoy.getUTCMonth() + 1).padStart(2, '0')}/${hoy.getUTCFullYear()}`
  const ultimaMaterial = Math.max(2, materiales.length + 1)
  const ultimaUnidad = Math.max(2, unidades.length + 1)
  const listaMateriales = `Materiales!$A$2:$A$${ultimaMaterial}`
  const listaUnidades = `Unidades!$A$2:$A$${ultimaUnidad}`
  const minimo = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), hoy.getUTCDate() - 31))

  // Cómo llenar -------------------------------------------------------------
  const guia = libro.addWorksheet('Cómo llenar', { properties: { tabColor: { argb: ROJO } } })
  guia.getColumn(1).width = 6
  guia.getColumn(2).width = 110
  titulo(guia, 'Planilla de almacén sin conexión', `Descargada el ${fechaTexto} por ${generadoPor}. Anota aquí lo que entra y sale mientras no hay internet y cárgala en el Kardex de Almacén al volver la señal.`, 2)
  const pasos = [
    'Anota cada ingreso en la hoja «Ingresos» y cada salida en «Salidas»: una fila por movimiento, de arriba abajo.',
    'Escribe o elige el código del material: la descripción y la unidad aparecen solas. Todos los códigos están en la hoja «Materiales».',
    'Fecha: el día en que pasó (dd/mm/aaaa). La hora es opcional; sin hora, se ordenan como están en la planilla.',
    'Toda salida va a una unidad: elige su código de la hoja «Unidades» o, si todavía no está registrada, escribe su código de fabricación o su placa.',
    'Toma con el teléfono la foto de cada salida, como siempre. Al cargar la planilla adjuntas la foto de cada una.',
    'Al volver la señal: Kardex de Almacén → «Cargar planilla». Revisa lo que se va a registrar y confirma. Lo que ya se cargó no se registra dos veces.',
    'Se cargan movimientos de los últimos 31 días y posteriores al último conteo físico de cada material.',
    'Las devoluciones y los conteos físicos se registran directamente en el sistema, no en la planilla.',
    'No cambies los encabezados ni el nombre de las hojas: el sistema los busca por su nombre.',
  ]
  pasos.forEach((paso, i) => {
    const fila = guia.getRow(4 + i)
    fila.getCell(1).value = i + 1
    fila.getCell(1).font = { bold: true, color: { argb: ROJO }, size: 12 }
    fila.getCell(1).alignment = { vertical: 'top', horizontal: 'center' }
    fila.getCell(2).value = paso
    fila.getCell(2).alignment = { wrapText: true, vertical: 'top' }
    fila.getCell(2).font = { size: 12 }
    fila.height = 34
  })

  // Ingresos y Salidas ----------------------------------------------------------
  const H = FILA_ENCABEZADO_PLANILLA
  const primera = H + 1
  const ultima = H + FILAS_PLANILLA

  function hojaDeMovimientos(nombre: string, color: string, descripcion: string,
    columnas: { titulo: string; ancho: number; formula?: (fila: number) => string; formato?: string }[]) {
    const hoja = libro.addWorksheet(nombre, {
      properties: { tabColor: { argb: color } },
      views: [{ state: 'frozen', ySplit: H, xSplit: 0 }],
      pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    })
    titulo(hoja, nombre, descripcion, columnas.length)
    columnas.forEach((c, i) => {
      hoja.getColumn(i + 1).width = c.ancho
      hoja.getCell(H, i + 1).value = c.titulo
    })
    encabezado(hoja.getRow(H))
    for (let f = primera; f <= ultima; f++) {
      columnas.forEach((c, i) => {
        const celda = hoja.getCell(f, i + 1)
        borde(celda)
        if (c.formato) celda.numFmt = c.formato
        if (c.formula) {
          celda.value = { formula: c.formula(f) }
          celda.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } }
          celda.font = { color: { argb: 'FF374151' } }
        }
      })
    }
    return hoja
  }

  const descripcionDe = (f: number) => `IF(C${f}="","",IFERROR(VLOOKUP(C${f},Materiales!$A:$C,2,FALSE),"Código no existe"))`
  const unidadDe = (f: number) => `IF(C${f}="","",IFERROR(VLOOKUP(C${f},Materiales!$A:$C,3,FALSE),""))`

  const ingresos = hojaDeMovimientos('Ingresos', 'FF15803D',
    'Lo que entra al almacén sin orden de compra del sistema: compras directas, saldos iniciales. Las columnas grises se llenan solas.', [
      { titulo: 'Fecha', ancho: 13, formato: 'dd/mm/yyyy' },
      { titulo: 'Hora (opcional)', ancho: 10, formato: 'hh:mm' },
      { titulo: 'Código de material', ancho: 18 },
      { titulo: 'Material', ancho: 44, formula: descripcionDe },
      { titulo: 'Unidad', ancho: 9, formula: unidadDe },
      { titulo: 'Cantidad', ancho: 11, formato: '#,##0.###' },
      { titulo: 'Tipo de ingreso', ancho: 16 },
      { titulo: 'Guía o documento', ancho: 30 },
      { titulo: 'Precio unitario (opcional)', ancho: 14, formato: '#,##0.00##' },
      { titulo: 'Moneda', ancho: 10 },
    ])

  const salidas = hojaDeMovimientos('Salidas', ROJO,
    'Todo lo que sale va a una unidad, con quién lo recibe y su foto (la foto se adjunta al cargar). Las columnas grises se llenan solas.', [
      { titulo: 'Fecha', ancho: 13, formato: 'dd/mm/yyyy' },
      { titulo: 'Hora (opcional)', ancho: 10, formato: 'hh:mm' },
      { titulo: 'Código de material', ancho: 18 },
      { titulo: 'Material', ancho: 44, formula: descripcionDe },
      { titulo: 'Unidad', ancho: 9, formula: unidadDe },
      { titulo: 'Cantidad', ancho: 11, formato: '#,##0.###' },
      { titulo: 'Vale o motivo', ancho: 30 },
      { titulo: 'Placa o código de unidad', ancho: 24 },
      { titulo: 'Quién recibe', ancho: 24 },
      { titulo: 'Libre al descargar', ancho: 12, formato: '#,##0.###', formula: (f) => `IF(C${f}="","",IFERROR(VLOOKUP(C${f},Materiales!$A:$E,5,FALSE),""))` },
    ])

  const rango = (columna: string) => `${columna}${primera}:${columna}${ultima}`
  for (const hoja of [ingresos, salidas]) {
    validar(hoja, rango('A'), {
      type: 'date', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [minimo],
      showErrorMessage: true, errorTitle: 'Fecha', error: 'Escribe la fecha como dd/mm/aaaa. Se cargan los últimos 31 días.',
    })
    validar(hoja, rango('C'), {
      type: 'list', allowBlank: true, formulae: [listaMateriales],
      showErrorMessage: true, errorTitle: 'Material', error: 'Ese código no está en la hoja «Materiales».',
    })
    validar(hoja, rango('F'), {
      type: 'decimal', operator: 'greaterThan', allowBlank: true, formulae: [0],
      showErrorMessage: true, errorTitle: 'Cantidad', error: 'La cantidad tiene que ser mayor que cero.',
    })
  }
  validar(ingresos, rango('G'), {
    type: 'list', allowBlank: true, formulae: ['"Ingreso general,Saldo inicial"'],
    showErrorMessage: true, errorTitle: 'Tipo de ingreso', error: 'Elige «Ingreso general» o «Saldo inicial». Vacío cuenta como ingreso general.',
  })
  validar(ingresos, rango('I'), {
    type: 'decimal', operator: 'greaterThanOrEqual', allowBlank: true, formulae: [0],
    showErrorMessage: true, errorTitle: 'Precio', error: 'El precio no puede ser negativo. Déjalo vacío si no lo sabes.',
  })
  validar(ingresos, rango('J'), {
    type: 'list', allowBlank: true, formulae: ['"Soles,Dólares"'],
    showErrorMessage: true, errorTitle: 'Moneda', error: 'Elige Soles o Dólares. Vacío cuenta como soles.',
  })
  // La unidad puede no estar registrada todavía: la lista ayuda, pero se puede escribir otra.
  validar(salidas, rango('H'), {
    type: 'list', allowBlank: true, formulae: [listaUnidades],
    showErrorMessage: true, errorStyle: 'information', errorTitle: 'Unidad',
    error: 'No está en la lista de unidades registradas. Si es su código de fabricación o su placa, puedes dejarlo.',
  })

  // Materiales y Unidades ----------------------------------------------------
  const hojaMateriales = libro.addWorksheet('Materiales', {
    properties: { tabColor: { argb: AZUL } }, views: [{ state: 'frozen', ySplit: 1 }],
  })
  hojaMateriales.columns = [
    { header: 'Código', key: 'codigo', width: 18 },
    { header: 'Descripción', key: 'descripcion', width: 52 },
    { header: 'Unidad', key: 'unidad', width: 9 },
    { header: `Saldo al ${fechaTexto}`, key: 'saldo', width: 14, style: { numFmt: '#,##0.###' } },
    { header: `Libre al ${fechaTexto}`, key: 'libre', width: 14, style: { numFmt: '#,##0.###' } },
  ]
  materiales.forEach((m) => hojaMateriales.addRow({ ...m, unidad: m.unidad ?? '' }))
  encabezado(hojaMateriales.getRow(1))
  hojaMateriales.autoFilter = { from: 'A1', to: `E${ultimaMaterial}` }

  const hojaUnidades = libro.addWorksheet('Unidades', {
    properties: { tabColor: { argb: AZUL } }, views: [{ state: 'frozen', ySplit: 1 }],
  })
  hojaUnidades.columns = [
    { header: 'Código o placa', key: 'identificador', width: 24 },
    { header: 'Placa', key: 'placa', width: 12 },
    { header: 'Vehículo', key: 'vehiculo', width: 34 },
    { header: 'OT abiertas', key: 'ordenes', width: 20 },
  ]
  unidades.forEach((u) => hojaUnidades.addRow({ ...u, placa: u.placa ?? '', vehiculo: u.vehiculo ?? '', ordenes: u.ordenes ?? '' }))
  encabezado(hojaUnidades.getRow(1))
  hojaUnidades.autoFilter = { from: 'A1', to: `D${ultimaUnidad}` }

  libro.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 1, visibility: 'visible' }]
  return Buffer.from(await libro.xlsx.writeBuffer())
}

// -------------------------------------------------------------------- kardex

/** El kardex en Excel, con los mismos filtros que la pantalla y el saldo de cada línea. */
export async function generarKardexExcel({ filas, filtrosTexto, porMaterial, truncado, generadoEn, generadoPor }: {
  filas: FilaKardex[]
  filtrosTexto: string
  porMaterial: boolean
  truncado: boolean
  generadoEn: Date
  generadoPor: string
}): Promise<Buffer> {
  const libro = new ExcelJS.Workbook()
  libro.creator = 'Metal Work'
  libro.created = generadoEn
  const columnas = [
    { titulo: 'Fecha', ancho: 17 },
    { titulo: 'Código', ancho: 14 },
    { titulo: 'Material', ancho: 40 },
    { titulo: 'U. M.', ancho: 7 },
    { titulo: 'Movimiento', ancho: 15 },
    { titulo: 'Origen', ancho: 18 },
    { titulo: 'Documento o motivo', ancho: 36 },
    { titulo: 'Unidad / código', ancho: 26 },
    { titulo: 'OT', ancho: 11 },
    { titulo: 'Recibió', ancho: 20 },
    { titulo: 'Registró', ancho: 20 },
    { titulo: 'Cargado desde planilla', ancho: 17 },
    { titulo: 'Entrada', ancho: 11 },
    { titulo: 'Salida', ancho: 11 },
    { titulo: 'Saldo', ancho: 12 },
  ]
  const hoja = libro.addWorksheet('Kardex', {
    views: [{ state: 'frozen', ySplit: 4 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
  })
  const hecho = horaDeLima(generadoEn)
  const cuando = `${String(hecho.getUTCDate()).padStart(2, '0')}/${String(hecho.getUTCMonth() + 1).padStart(2, '0')}/${hecho.getUTCFullYear()} ${String(hecho.getUTCHours()).padStart(2, '0')}:${String(hecho.getUTCMinutes()).padStart(2, '0')}`
  titulo(hoja, 'Metal Work · Kardex de Almacén', `${filtrosTexto}. Descargado el ${cuando} por ${generadoPor}.${truncado ? ' Son las primeras 20 000 líneas: acota las fechas para ver el resto.' : ''}`, columnas.length)
  columnas.forEach((c, i) => {
    hoja.getColumn(i + 1).width = c.ancho
    hoja.getCell(4, i + 1).value = c.titulo
  })
  encabezado(hoja.getRow(4))
  hoja.autoFilter = { from: 'A4', to: `O${Math.max(5, filas.length + 5)}` }

  let fila = 5
  if (porMaterial && filas[0]) {
    const primera = filas[0]
    const anterior = Number(primera.saldo ?? 0) - Number(primera.entrada ?? 0) + Number(primera.salida ?? 0)
    hoja.getCell(fila, 3).value = 'Saldo anterior'
    hoja.getCell(fila, 15).value = anterior
    hoja.getRow(fila).font = { italic: true, color: { argb: 'FF4B5563' } }
    fila++
  }
  for (const f of filas) {
    const r = hoja.getRow(fila++)
    r.values = [
      f.fecha ? horaDeLima(f.fecha) : null,
      f.material_codigo ?? '',
      f.material ?? '',
      f.unidad_medida ?? '',
      MOVIMIENTO_KARDEX[f.movimiento ?? '']?.etiqueta ?? f.movimiento ?? '',
      ORIGEN_KARDEX[f.origen ?? ''] ?? f.origen ?? '',
      f.documento ?? '',
      f.codigo_unidad ?? '',
      f.orden_numero ?? '',
      f.recibido_por_nombre ?? '',
      f.registrado_por_nombre ?? '',
      f.desde_planilla && f.cargado_en ? horaDeLima(f.cargado_en) : null,
      Number(f.entrada ?? 0) || null,
      Number(f.salida ?? 0) || null,
      Number(f.saldo ?? 0),
    ]
    r.getCell(1).numFmt = 'dd/mm/yyyy hh:mm'
    r.getCell(12).numFmt = 'dd/mm/yyyy hh:mm'
    for (const c of [13, 14, 15]) r.getCell(c).numFmt = '#,##0.###'
    r.getCell(13).font = { color: { argb: 'FF15803D' } }
    r.getCell(14).font = { color: { argb: ROJO } }
    r.getCell(15).font = { bold: true }
    if (f.desde_planilla) r.getCell(12).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_SUAVE } }
  }
  if (porMaterial && filas.length > 0) {
    const total = hoja.getRow(fila)
    total.getCell(12).value = 'Totales'
    total.getCell(13).value = filas.reduce((s, f) => s + Number(f.entrada ?? 0), 0)
    total.getCell(14).value = filas.reduce((s, f) => s + Number(f.salida ?? 0), 0)
    total.getCell(15).value = Number(filas[filas.length - 1].saldo ?? 0)
    for (const c of [13, 14, 15]) total.getCell(c).numFmt = '#,##0.###'
    total.font = { bold: true }
    total.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } } })
  }
  if (filas.length === 0) hoja.getCell(5, 1).value = 'Ningún movimiento con esos filtros.'
  return Buffer.from(await libro.xlsx.writeBuffer())
}
