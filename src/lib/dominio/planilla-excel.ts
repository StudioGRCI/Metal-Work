import { z } from 'zod'

/**
 * Cómo arma Recursos Humanos la planilla del mes en Excel, y cómo se lee.
 *
 * El libro trae una hoja «RESUMEN <MES> … - <AÑO>» por grupo de personas, con
 * una boleta por bloque, y una hoja «PAGOS <MES> <AÑO>» —el estado general de
 * la planilla— que dice a qué empresa pertenece cada persona: Metal Work Perú
 * y las otras empresas del libro. Una misma empresa puede tener boletas en dos
 * hojas (hay personas de Metal Work en la hoja «OTROS»), así que la empresa
 * sale de PAGOS y no del nombre de la hoja.
 *
 * Hay dos formatos de boleta:
 *  · «NOMBRES Y APELLIDOS» en B y el nombre en C; el puesto en «PUESTO DE
 *    TRABAJO»; días, horas y horas extras en la fila de abajo de sus títulos;
 *    con fila de EsSalud.
 *  · «APELLIDO Y NOMBRES:» en B y el nombre en D; «OCUPACION», «N° DE DIAS
 *    TRABAJADAS»… con su valor en D; sin EsSalud.
 * En los dos, los ingresos van en B/C y los descuentos en D/E hasta la fila
 * «TOTAL», y el neto en «NETO A RECIBIR» (D).
 *
 * Las reglas que el Excel aplica, y que aquí se comprueban: EsSalud es el 9 %
 * de sueldo más horas extras (costo de la empresa); AFP, el 10 % de aporte y
 * el 1.37 % de prima, y ONP el 13 %, sobre sueldo más horas extras menos
 * tardanzas, faltas, permisos y penalidades (descuento del trabajador).
 */

export const centimos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100

export const ESSALUD = 0.09
export const AFP_APORTE = 0.10
export const AFP_PRIMA = 0.0137
export const ONP = 0.13
const TOLERANCIA = 1 // soles: diferencias de redondeo del Excel no son avisos

const concepto = z.object({
  tipo: z.enum(['INGRESO', 'DESCUENTO']),
  clave: z.string().max(40).optional(),
  nombre: z.string().max(160),
  importe: z.number().finite().min(0).max(999999999),
})
const dinero = z.number().finite().min(0).max(999999999)

/** Lo que se guarda de cada persona en `planilla_personas.detalle`. */
export const detallePlanilla = z.object({
  puesto: z.string().max(160),
  dias: z.number().min(0).max(31),
  horas: z.number().min(0).max(744),
  horas_extras: z.number().min(0).max(744),
  ingresos: dinero,
  descuentos: dinero,
  aporte_empleador: dinero,
  neto: dinero,
  conceptos: z.array(concepto).max(60),
  empresa: z.string().max(160).nullable().optional(),
  aporte_excel: z.number().finite().nullable().optional(),
  avisos: z.array(z.string().max(300)).max(20).optional(),
})
export type DetallePlanilla = z.infer<typeof detallePlanilla>

/** Una persona leída del Excel, lista para importar. */
export const lineaPlanilla = z.object({
  nombre: z.string().trim().min(3).max(160),
  hoja: z.string().trim().min(3).max(120),
  fila: z.number().int().positive(),
  empresa: z.string().max(160).nullable(),
  detalle: detallePlanilla,
})
export type LineaPlanilla = z.infer<typeof lineaPlanilla>

/** Una boleta que no se puede importar, con el motivo. */
export type BoletaConError = { nombre: string; hoja: string; fila: number; error: string }

export const normalizar = (v: unknown) =>
  String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

/** El nombre como clave: sin tildes ni signos, con las palabras ordenadas. «Quispe Rojas, Ana Lucía» = «ANA LUCIA QUISPE ROJAS». */
export function claveNombre(nombre: unknown): string {
  return normalizar(nombre).split(/[^A-Z]+/).filter(Boolean).sort().join(' ')
}

const numero = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const esNumero = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const texto = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
const vacia = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '')

/** Los conceptos con una clave fija, para sumar y comprobar aunque cada hoja los escriba distinto. */
const INGRESOS: [RegExp, string][] = [
  [/^(SUELDO|REMUNERACION)/, 'SUELDO'],
  [/^ASIGNACION FAMILIAR/, 'ASIGNACION_FAMILIAR'],
  [/^BONO (DE )?PRODUCTIVIDAD/, 'BONO_PRODUCTIVIDAD'],
  [/^BONO (DE |POR )?CONDICI/, 'BONO_CONDICIONES'],
  [/^BONO (DE |POR )?MOVILIDAD/, 'BONO_MOVILIDAD'],
  [/^BONO POR ASIST/, 'BONO_ASISTENCIA'],
  [/^BONO/, 'BONO_OTRO'],
  [/^HORAS? EXTRA/, 'HORAS_EXTRAS'],
  [/^FERI/, 'FERIADOS'],
  [/^DOMINGO/, 'DOMINGO_LABORADO'],
]
const DESCUENTOS: [RegExp, string][] = [
  [/^TARDANZA/, 'TARDANZAS'],
  [/^FALTA/, 'FALTAS'],
  [/^PERMISO/, 'PERMISOS'],
  [/^PENALIDAD/, 'PENALIDADES'],
  [/^ADELANTO/, 'ADELANTOS'],
  [/^SIN EPP/, 'SIN_EPPS'],
  [/APORTE/, 'AFP_APORTE'],
  [/PRIMA/, 'AFP_PRIMA'],
  [/13 ?%|^ONP/, 'ONP'],
  [/RENTA/, 'RENTA_5TA'],
]
function clave(etiqueta: string, tabla: [RegExp, string][], otro: string) {
  const e = normalizar(etiqueta)
  return tabla.find(([patron]) => patron.test(e))?.[1] ?? otro
}

const suma = (conceptos: DetallePlanilla['conceptos'], ...claves: string[]) =>
  centimos(conceptos.filter((c) => c.clave && claves.includes(c.clave)).reduce((s, c) => s + c.importe, 0))

const soles = (v: number) => `S/ ${v.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** Las boletas de una hoja RESUMEN, en los dos formatos. Una boleta mal armada no detiene a las demás. */
export function leerBoletas(filas: unknown[][], hoja: string): { lineas: LineaPlanilla[]; errores: BoletaConError[] } {
  const anclas: { inicio: number; formato: 'A' | 'B' }[] = []
  filas.forEach((fila, i) => {
    const b = normalizar(fila?.[1])
    if (b === 'NOMBRES Y APELLIDOS') anclas.push({ inicio: i, formato: 'A' })
    else if (/^APELLIDOS? Y NOMBRES/.test(b)) anclas.push({ inicio: i, formato: 'B' })
  })
  const lineas: LineaPlanilla[] = []
  const errores: BoletaConError[] = []

  anclas.forEach(({ inicio, formato }, indice) => {
    const fin = anclas[indice + 1]?.inicio ?? filas.length
    const bloque = filas.slice(inicio, fin)
    const filaExcel = inicio + 1
    const nombre = texto(formato === 'A' ? filas[inicio]?.[2] : filas[inicio]?.[3])
    const buscar = (prueba: (b: string) => boolean) => bloque.findIndex((f) => prueba(normalizar(f?.[1])))
    const fallar = (error: string) => errores.push({ nombre: nombre || '(sin nombre)', hoja, fila: filaExcel, error })
    if (nombre.length < 3) return fallar('La boleta no tiene el nombre de la persona.')

    let puesto = ''
    let dias = 0
    let horas = 0
    let horasExtras = 0
    if (formato === 'A') {
      puesto = texto(bloque[buscar((b) => b.startsWith('PUESTO DE TRABAJO'))]?.[2])
      const titulo = buscar((b) => b.includes('DIAS TRABAJAD'))
      const valores = titulo >= 0 ? bloque[titulo + 1] ?? [] : []
      dias = numero(valores[1]); horas = numero(valores[2]); horasExtras = numero(valores[4])
    } else {
      puesto = texto(bloque[buscar((b) => b.startsWith('OCUPACION'))]?.[3])
      dias = numero(bloque[buscar((b) => b.includes('DIAS TRABAJAD'))]?.[3])
      horas = numero(bloque[buscar((b) => b.includes('HORAS TRABAJAD') && !b.includes('EXTRA'))]?.[3])
      horasExtras = numero(bloque[buscar((b) => b.includes('HORAS EXTRAS') && b.includes('TRABAJAD'))]?.[3])
    }

    const cabecera = buscar((b) => b === 'INGRESOS')
    const total = bloque.findIndex((f, i) => i > cabecera && normalizar(f?.[1]) === 'TOTAL' && normalizar(f?.[3]) === 'TOTAL')
    const netoFila = bloque[buscar((b) => b === 'NETO A RECIBIR')]
    if (cabecera < 0 || total < 0 || !esNumero(bloque[total]?.[2]) || !esNumero(bloque[total]?.[4])) {
      return fallar('No tiene la fila TOTAL de ingresos y descuentos.')
    }
    if (!netoFila || !esNumero(netoFila[3])) return fallar('No tiene el NETO A RECIBIR.')

    // Un importe con la celda del rótulo vacía es del último concepto conocido
    // de arriba: en agosto los PERMISOS de una boleta tenían el rótulo una
    // fila más arriba que el importe. Si la celda trae otra cosa —las fechas
    // de las horas extras con sus horas al lado—, no es un importe. Las
    // descripciones de una penalidad («no tener radio encendida») no cuentan
    // como rótulo.
    const conceptos: DetallePlanilla['conceptos'] = []
    let ultimoIngreso = ''
    let ultimoDescuento = ''
    for (const fila of bloque.slice(cabecera + 1, total)) {
      const etiquetaIngreso = texto(fila?.[1])
      if (etiquetaIngreso && clave(etiquetaIngreso, INGRESOS, '') !== '') ultimoIngreso = etiquetaIngreso
      if (esNumero(fila?.[2]) && fila[2] > 0 && (etiquetaIngreso || (vacia(fila?.[1]) && ultimoIngreso))) {
        const nombre = etiquetaIngreso || ultimoIngreso
        conceptos.push({ tipo: 'INGRESO', clave: clave(nombre, INGRESOS, 'OTRO_INGRESO'), nombre, importe: centimos(fila[2]) })
      }
      const etiquetaDescuento = texto(fila?.[3])
      if (etiquetaDescuento && clave(etiquetaDescuento, DESCUENTOS, '') !== '') ultimoDescuento = etiquetaDescuento
      if (esNumero(fila?.[4]) && fila[4] > 0 && (etiquetaDescuento || (vacia(fila?.[3]) && ultimoDescuento))) {
        const nombre = etiquetaDescuento || ultimoDescuento
        conceptos.push({ tipo: 'DESCUENTO', clave: clave(nombre, DESCUENTOS, 'OTRO_DESCUENTO'), nombre, importe: centimos(fila[4]) })
      }
    }

    const ingresos = centimos(bloque[total][2] as number)
    const descuentos = centimos(bloque[total][4] as number)
    const neto = centimos(netoFila[3] as number)
    if (Math.abs(centimos(ingresos - descuentos) - neto) > 0.02) {
      return fallar(`El neto (${soles(neto)}) no cuadra con ingresos menos descuentos (${soles(centimos(ingresos - descuentos))}).`)
    }

    const avisos: string[] = []
    const totalDe = (tipo: 'INGRESO' | 'DESCUENTO') => centimos(conceptos.filter((c) => c.tipo === tipo).reduce((s, c) => s + c.importe, 0))
    const ingresosDetalle = totalDe('INGRESO')
    const descuentosDetalle = totalDe('DESCUENTO')
    if (Math.abs(ingresosDetalle - ingresos) > 0.05) avisos.push(`Los ingresos detallados suman ${soles(ingresosDetalle)} y el TOTAL dice ${soles(ingresos)}.`)
    if (Math.abs(descuentosDetalle - descuentos) > 0.05) avisos.push(`Los descuentos detallados suman ${soles(descuentosDetalle)} y el TOTAL dice ${soles(descuentos)}.`)

    // EsSalud: costo de la empresa. Si la celda del Excel no es el 9 % de
    // sueldo + horas extras (una fórmula rota la dejó en céntimos en agosto),
    // se usa el 9 % y se avisa: el costo de la OT tiene que ser el real.
    const remuneracion = suma(conceptos, 'SUELDO', 'HORAS_EXTRAS')
    const filaEssalud = bloque.find((f) => normalizar(f?.[1]).startsWith('ESSALUD'))
    const essaludExcel = filaEssalud && esNumero(filaEssalud[4]) ? centimos(filaEssalud[4]) : null
    let aporte = 0
    if (filaEssalud) {
      const esperado = centimos(remuneracion * ESSALUD)
      aporte = essaludExcel ?? esperado
      if (essaludExcel === null || Math.abs(essaludExcel - esperado) > TOLERANCIA) {
        avisos.push(`EsSalud: el Excel dice ${essaludExcel === null ? 'nada' : soles(essaludExcel)}; el 9 % de sueldo y horas extras (${soles(remuneracion)}) es ${soles(esperado)}. Se usó el 9 %.`)
        aporte = esperado
      }
    }

    // AFP y ONP: descuento del trabajador. Solo se avisa; el neto es lo que se pagó.
    const base = centimos(remuneracion - suma(conceptos, 'TARDANZAS', 'FALTAS', 'PERMISOS', 'PENALIDADES'))
    const comprobar = (claveConcepto: string, tasa: number, nombreTasa: string) => {
      const excel = suma(conceptos, claveConcepto)
      if (!conceptos.some((c) => c.clave === claveConcepto)) return
      const esperado = centimos(base * tasa)
      if (Math.abs(excel - esperado) > TOLERANCIA) avisos.push(`${nombreTasa}: el Excel descuenta ${soles(excel)}; sobre ${soles(base)} corresponde ${soles(esperado)}.`)
    }
    comprobar('AFP_APORTE', AFP_APORTE, 'Aporte AFP 10 %')
    comprobar('AFP_PRIMA', AFP_PRIMA, 'Prima AFP 1.37 %')
    comprobar('ONP', ONP, 'AFP/ONP 13 %')

    const linea = lineaPlanilla.safeParse({
      nombre, hoja, fila: filaExcel, empresa: null,
      detalle: {
        puesto, dias, horas, horas_extras: horasExtras, ingresos, descuentos, aporte_empleador: centimos(aporte), neto,
        conceptos, empresa: null, aporte_excel: essaludExcel, avisos,
      },
    })
    if (!linea.success) return fallar('La boleta tiene datos fuera de rango (días, horas o importes).')
    lineas.push(linea.data)
  })
  return { lineas, errores }
}

/** Las empresas de la hoja PAGOS y las personas de cada una. */
export function leerPagos(filas: unknown[][]): { empresa: string; personas: { nombre: string; clave: string }[] }[] {
  const grupos: { empresa: string; personas: { nombre: string; clave: string }[] }[] = []
  let actual: (typeof grupos)[number] | null = null
  for (const fila of filas) {
    const b = normalizar(fila?.[1])
    const c = texto(fila?.[2])
    const f = normalizar(fila?.[5])
    if (c && !esNumero(fila?.[1]) && (f.startsWith('SUELDO') || f.startsWith('IMPORTE'))) {
      actual = { empresa: c, personas: [] }
      grupos.push(actual)
    } else if (b.startsWith('TOTAL')) {
      actual = null
    } else if (actual && esNumero(fila?.[1]) && c) {
      actual.personas.push({ nombre: c, clave: claveNombre(c) })
    }
  }
  return grupos.filter((g) => g.personas.length > 0)
}

/** A cada boleta, la empresa con la que figura en PAGOS. Si figura en dos, se avisa. */
export function asignarEmpresas(lineas: LineaPlanilla[], grupos: ReturnType<typeof leerPagos>): LineaPlanilla[] {
  return lineas.map((l) => {
    const claveL = claveNombre(l.nombre)
    const tokens = new Set(claveL.split(' '))
    const empresas = grupos.filter((g) => g.personas.some((p) => {
      if (p.clave === claveL) return true
      const otros = p.clave.split(' ')
      const comunes = otros.filter((t) => tokens.has(t)).length
      return comunes >= 3 || (comunes >= 2 && comunes === Math.min(otros.length, tokens.size))
    })).map((g) => g.empresa)
    const avisos = [...(l.detalle.avisos ?? [])]
    if (grupos.length && empresas.length === 0) avisos.push('No figura en la hoja PAGOS: revisa el nombre o a qué empresa pertenece.')
    if (empresas.length > 1) avisos.push(`Figura en PAGOS en más de una empresa: ${empresas.join(' y ')}.`)
    const empresa = empresas[0] ?? null
    return { ...l, empresa, detalle: { ...l.detalle, empresa, avisos } }
  })
}

/** Las hojas que se leen: las RESUMEN del mes con su año, y PAGOS. */
export function esHojaDeResumen(nombre: string) { return /^RESUMEN\b/.test(normalizar(nombre)) }
export function esHojaDePagos(nombre: string) { return /^PAGOS\b/.test(normalizar(nombre)) }
