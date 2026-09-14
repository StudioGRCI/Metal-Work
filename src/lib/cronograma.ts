/**
 * Leer el cronograma de un Excel: una fila por actividad, con su área, qué es,
 * cuánto pesa y desde cuándo hasta cuándo se trabaja (migración 099).
 *
 * Es código puro —ni pantalla ni base— para poder probarlo con un archivo de
 * verdad. La pantalla lo usa para mostrar lo que va a cargar antes de cargarlo;
 * la base vuelve a validar todo al recibirlo (`cargar_cronograma`), porque lo
 * que manda es ella.
 *
 * Los títulos se buscan por nombre y no por posición: «Área» o «Especialidad»,
 * «Actividad», «Referencia», «Peso (%)», «Inicio», «Fin», en cualquier orden y
 * con o sin tildes. La plantilla trae esos seis.
 */

export type AreaDelTaller = { id: string; codigo: string; nombre: string }

export type FilaCronograma = {
  /** La fila del Excel, para decir dónde está lo que falla. */
  fila: number
  area_id: string | null
  area: string
  nombre: string
  referencia: string | null
  peso_pct: number
  inicio: string | null
  fin: string | null
  errores: string[]
}

export type LecturaCronograma = { filas: FilaCronograma[]; error: string | null }

type Columna = 'area' | 'nombre' | 'referencia' | 'peso' | 'inicio' | 'fin'

const TITULOS: Record<Columna, string[]> = {
  area: ['area', 'especialidad'],
  nombre: ['actividad', 'tarea'],
  referencia: ['referencia', 'pieza', 'ref'],
  peso: ['peso', 'ponderacion', '%'],
  inicio: ['inicio', 'fechainicio', 'fechadeinicio', 'desde', 'comienzo'],
  fin: ['fin', 'fechafin', 'fechadefin', 'hasta', 'termino', 'final'],
}

const MAXIMO_FILAS = 500

/** Sin tildes, sin mayúsculas, sin espacios ni signos: «Peso (%)» → «peso%». */
export function normalizar(valor: unknown): string {
  return String(valor ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]/g, '')
}

function columnaDe(titulo: unknown): Columna | null {
  const t = normalizar(titulo)
  if (!t) return null
  for (const [columna, nombres] of Object.entries(TITULOS) as [Columna, string[]][]) {
    if (nombres.some((n) => t === n || t.startsWith(n))) return columna
  }
  return null
}

const dos = (n: number) => String(n).padStart(2, '0')

function fechaValida(anio: number, mes: number, dia: number): string | null {
  const d = new Date(Date.UTC(anio, mes - 1, dia))
  if (d.getUTCFullYear() !== anio || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null
  if (anio < 2000 || anio > 2100) return null
  return `${anio}-${dos(mes)}-${dos(dia)}`
}

/**
 * Una fecha del Excel a «YYYY-MM-DD». El Excel la guarda como número de días y
 * la librería la entrega como fecha en UTC: se lee en UTC, porque en hora de
 * Lima la medianoche de un día cae en la tarde del anterior y la fecha se
 * correría uno. También se aceptan escritas: 15/09/2026, 15-9-26, 2026-09-15.
 */
export function fechaDeCelda(valor: unknown): { fecha: string | null; mala: boolean } {
  if (valor === null || valor === undefined || valor === '') return { fecha: null, mala: false }

  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return { fecha: null, mala: true }
    const f = fechaValida(valor.getUTCFullYear(), valor.getUTCMonth() + 1, valor.getUTCDate())
    return { fecha: f, mala: f === null }
  }

  if (typeof valor === 'number') {
    // El número de serie del Excel: días desde el 30/12/1899.
    if (valor < 36526 || valor > 73415) return { fecha: null, mala: true }
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(valor) * 86_400_000)
    const f = fechaValida(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
    return { fecha: f, mala: f === null }
  }

  const texto = String(valor).trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(texto)
  if (m) {
    const f = fechaValida(Number(m[1]), Number(m[2]), Number(m[3]))
    return { fecha: f, mala: f === null }
  }
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(texto)
  if (m) {
    const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const f = fechaValida(anio, Number(m[2]), Number(m[1]))
    return { fecha: f, mala: f === null }
  }
  return { fecha: null, mala: true }
}

function pesoDeCelda(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return 0
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : null
  const n = Number(String(valor).replace('%', '').replace(',', '.').trim())
  return Number.isFinite(n) ? n : null
}

const texto = (valor: unknown) => (valor === null || valor === undefined ? '' : String(valor).trim())

/**
 * Las filas del Excel —como las entrega `readSheet`— a las filas del
 * cronograma, cada una con lo que le falla. `areas` son las áreas en que quien
 * carga puede escribir: una fila de otra área se marca, no se cuela.
 */
export function leerCronograma(datos: unknown[][], areas: AreaDelTaller[]): LecturaCronograma {
  // La fila de títulos: la primera, entre las quince de arriba, que nombre al
  // menos el área y la actividad. Arriba puede haber un título o un logo.
  let encabezado = -1
  let columnas: Partial<Record<Columna, number>> = {}
  for (let i = 0; i < Math.min(datos.length, 15); i++) {
    const mapa: Partial<Record<Columna, number>> = {}
    datos[i]?.forEach((celda, j) => {
      const c = columnaDe(celda)
      if (c && mapa[c] === undefined) mapa[c] = j
    })
    if (mapa.area !== undefined && mapa.nombre !== undefined) {
      encabezado = i
      columnas = mapa
      break
    }
  }

  if (encabezado < 0) {
    return {
      filas: [],
      error:
        'No encontré la fila de títulos. Arriba tiene que decir Área, Actividad, Peso, Inicio y Fin: usa la plantilla.',
    }
  }

  const porNombre = new Map<string, AreaDelTaller>()
  for (const a of areas) {
    porNombre.set(normalizar(a.nombre), a)
    porNombre.set(normalizar(a.codigo), a)
  }

  const valor = (fila: unknown[], c: Columna) => (columnas[c] === undefined ? null : fila[columnas[c] as number])

  const filas: FilaCronograma[] = []
  const vistas = new Set<string>()

  for (let i = encabezado + 1; i < datos.length; i++) {
    const fila = datos[i] ?? []
    if (fila.every((celda) => texto(celda) === '')) continue

    const errores: string[] = []
    const nombreArea = texto(valor(fila, 'area'))
    const area = porNombre.get(normalizar(nombreArea)) ?? null
    if (!nombreArea) errores.push('falta el área')
    else if (!area) errores.push(`«${nombreArea}» no es un área que puedas cargar`)

    const nombre = texto(valor(fila, 'nombre'))
    if (!nombre) errores.push('falta la actividad')

    const peso = pesoDeCelda(valor(fila, 'peso'))
    if (peso === null) errores.push('el peso no es un número')

    const inicio = fechaDeCelda(valor(fila, 'inicio'))
    const fin = fechaDeCelda(valor(fila, 'fin'))
    if (inicio.mala) errores.push('la fecha de inicio no se entiende')
    if (fin.mala) errores.push('la fecha de fin no se entiende')
    if (inicio.fecha && fin.fecha && fin.fecha < inicio.fecha) errores.push('termina antes de empezar')

    if (area && nombre) {
      const clave = `${area.id}|${normalizar(nombre)}`
      if (vistas.has(clave)) errores.push('está dos veces en el archivo')
      vistas.add(clave)
    }

    filas.push({
      fila: i + 1,
      area_id: area?.id ?? null,
      area: area?.nombre ?? nombreArea,
      nombre,
      referencia: texto(valor(fila, 'referencia')) || null,
      peso_pct: peso ?? 0,
      inicio: inicio.fecha,
      fin: fin.fecha,
      errores,
    })
  }

  if (filas.length === 0) return { filas, error: 'El archivo no trae actividades debajo de los títulos.' }
  if (filas.length > MAXIMO_FILAS) {
    return { filas: [], error: `El archivo trae ${filas.length} actividades; el máximo es ${MAXIMO_FILAS}. Pártelo por área.` }
  }

  // Un peso con formato de porcentaje llega como fracción: 25 % es 0,25. Si
  // todos los pesos son de 0 a 1, se leen así; si no, son ya porcentajes.
  const conPeso = filas.filter((f) => f.peso_pct > 0)
  if (conPeso.length > 0 && conPeso.every((f) => f.peso_pct <= 1)) {
    for (const f of filas) f.peso_pct = Math.round(f.peso_pct * 10000) / 100
  }
  for (const f of filas) {
    if (f.peso_pct < 0 || f.peso_pct > 100) f.errores.push('el peso va de 0 a 100')
  }

  return { filas, error: null }
}
