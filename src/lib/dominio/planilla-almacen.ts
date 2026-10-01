/**
 * Lectura de la planilla de almacén que se llena sin internet. Solo da forma
 * a lo escrito y marca lo que no se puede leer; si el material existe, si la
 * unidad está registrada y si alcanza el saldo lo decide quien la carga,
 * contra la base.
 */

export type Celda = string | number | boolean | Date | null | undefined

export type FilaLeida = {
  hoja: 'Ingresos' | 'Salidas'
  /** La fila de Excel, para que la almacenera la encuentre en su archivo. */
  fila: number
  fecha: string | null
  hora: string | null
  codigo: string
  cantidad: number | null
  origen: 'INGRESO_GENERAL' | 'SALDO_INICIAL'
  documento: string
  precio: number | null
  moneda: 'PEN' | 'USD'
  unidad: string
  recibe: string
  errores: string[]
}

const texto = (v: Celda) => (v === null || v === undefined ? '' : v instanceof Date ? '' : String(v)).replace(/\s+/g, ' ').trim()

function numero(v: Celda): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const t = texto(v).replace(/\s/g, '')
  if (!t) return null
  // 1.234,5 o 1,234.5 o 12,5: el último separador es el decimal.
  const normal = t.includes(',') && t.lastIndexOf(',') > t.lastIndexOf('.')
    ? t.replace(/\./g, '').replace(',', '.')
    : t.replace(/,/g, '')
  const n = Number(normal)
  return Number.isFinite(n) ? n : null
}

const dos = (n: number) => String(n).padStart(2, '0')

/** Fecha de la celda como YYYY-MM-DD. Excel guarda las fechas sin huso: se leen en UTC tal cual. */
export function leerFecha(v: Celda): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${dos(v.getUTCMonth() + 1)}-${dos(v.getUTCDate())}`
  }
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
    return `${d.getUTCFullYear()}-${dos(d.getUTCMonth() + 1)}-${dos(d.getUTCDate())}`
  }
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(texto(v))
  if (!m) return null
  const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  const d = new Date(Date.UTC(anio, Number(m[2]) - 1, Number(m[1])))
  if (d.getUTCDate() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1) return null
  return `${anio}-${dos(Number(m[2]))}-${dos(Number(m[1]))}`
}

/** Hora de la celda como HH:MM, o null si está vacía. `undefined` si está escrita pero no se entiende. */
export function leerHora(v: Celda): string | null | undefined {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${dos(v.getUTCHours())}:${dos(v.getUTCMinutes())}`
  if (typeof v === 'number' && v >= 0 && v < 1) {
    const minutos = Math.round(v * 1440)
    return `${dos(Math.floor(minutos / 60) % 24)}:${dos(minutos % 60)}`
  }
  const m = /^(\d{1,2})[:.h](\d{2})/.exec(texto(v))
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return undefined
  return `${dos(Number(m[1]))}:${m[2]}`
}

/** Las filas anotadas de una hoja: debajo del encabezado que empieza en «Fecha». */
export function leerHoja(hoja: 'Ingresos' | 'Salidas', filas: Celda[][]): FilaLeida[] {
  const inicio = filas.findIndex((f) => texto(f[0]).toLowerCase() === 'fecha')
  if (inicio < 0) throw new Error(`La hoja «${hoja}» no tiene el encabezado de la planilla. Descárgala de nuevo desde el kardex.`)
  const salida: FilaLeida[] = []
  filas.slice(inicio + 1).forEach((f, i) => {
    // Las columnas grises (material, unidad, libre) se llenan solas: no cuentan como anotadas.
    const escritas = hoja === 'Ingresos' ? [0, 1, 2, 5, 6, 7, 8, 9] : [0, 1, 2, 5, 6, 7, 8]
    if (escritas.every((c) => texto(f[c]) === '' && !(f[c] instanceof Date))) return
    const errores: string[] = []
    const fecha = leerFecha(f[0])
    if (!fecha) errores.push('La fecha no se entiende: escríbela como dd/mm/aaaa.')
    const hora = leerHora(f[1])
    if (hora === undefined) errores.push('La hora no se entiende: escríbela como 10:30.')
    const codigo = texto(f[2])
    if (!codigo) errores.push('Falta el código del material.')
    const cantidad = numero(f[5])
    if (cantidad === null || cantidad <= 0) errores.push('La cantidad tiene que ser mayor que cero.')
    else if (Math.round(cantidad * 1000) !== cantidad * 1000) errores.push('La cantidad admite hasta 3 decimales.')

    const base = { hoja, fila: inicio + i + 2, fecha, hora: hora ?? null, codigo, cantidad, errores }
    if (hoja === 'Ingresos') {
      const tipo = texto(f[6]).toLowerCase()
      const documento = texto(f[7])
      const precio = numero(f[8])
      const moneda = texto(f[9]).toLowerCase()
      if (tipo && !['ingreso general', 'saldo inicial'].includes(tipo)) errores.push('Tipo de ingreso: «Ingreso general» o «Saldo inicial».')
      if (documento.length < 2 || documento.length > 100) errores.push('Escribe la guía o documento (de 2 a 100 caracteres).')
      if (texto(f[8]) && (precio === null || precio < 0)) errores.push('El precio no se entiende: déjalo vacío si no lo sabes.')
      if (moneda && !['soles', 'dólares', 'dolares', 'pen', 'usd'].includes(moneda)) errores.push('Moneda: Soles o Dólares.')
      salida.push({
        ...base,
        origen: tipo === 'saldo inicial' ? 'SALDO_INICIAL' : 'INGRESO_GENERAL',
        documento, precio: precio !== null && precio >= 0 ? Math.round(precio * 10000) / 10000 : null,
        moneda: ['dólares', 'dolares', 'usd'].includes(moneda) ? 'USD' : 'PEN',
        unidad: '', recibe: '',
      })
    } else {
      const documento = texto(f[6])
      const unidad = texto(f[7]).toUpperCase()
      const recibe = texto(f[8])
      if (documento.length < 3 || documento.length > 200) errores.push('Escribe el vale o motivo (de 3 a 200 caracteres).')
      if (unidad.length < 3 || unidad.length > 60) errores.push('Toda salida va a una unidad: escribe su placa o código (de 3 a 60 caracteres).')
      if (recibe.length < 3 || recibe.length > 160) errores.push('Escribe el nombre de quien recibe.')
      salida.push({ ...base, origen: 'INGRESO_GENERAL', documento, precio: null, moneda: 'PEN', unidad, recibe })
    }
  })
  return salida
}
