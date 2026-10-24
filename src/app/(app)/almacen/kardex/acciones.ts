'use server'

import { createHash } from 'node:crypto'

import { unzipSync } from 'fflate'
import { revalidatePath } from 'next/cache'
import readXlsxFile from 'read-excel-file/node'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { catalogoDeAlmacen } from '@/lib/datos/atencion-materiales'
import { materialesDelKardex, materialesParaPlanilla, type MaterialParaPlanilla } from '@/lib/datos/kardex'
import { normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { DIAS_DEL_CONTEO, leerHojaConteo, motivoConteoInicial, motivoDeFechaDeConteo, TANDA_CONTEO } from '@/lib/dominio/conteo-inicial'
import { leerHoja, normalizarNombre, similitud, type Celda, type FilaLeida } from '@/lib/dominio/planilla-almacen'
import { cantidad, fechaHora, hoyLima, sumarDias } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'

/**
 * La foto ya está en el almacenamiento: se comprueba que de verdad sea una
 * imagen antes de dejarla como evidencia. Devuelve el error, o null si sirve.
 */
async function comprobarFoto(supabase: Awaited<ReturnType<typeof createClient>>, ruta: string): Promise<string | null> {
  const { data: objeto, error: lectura } = await supabase.storage.from('evidencias-almacen').download(ruta)
  if (lectura || !objeto || objeto.size > 10485760) return 'No se pudo verificar la foto. Vuelve a cargarla.'
  const cabecera = new Uint8Array(await objeto.slice(0, 12).arrayBuffer())
  const jpg = cabecera[0] === 255 && cabecera[1] === 216 && cabecera[2] === 255
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => cabecera[i] === n)
  const webp = new TextDecoder().decode(cabecera.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(cabecera.slice(8, 12)) === 'WEBP'
  return jpg || png || webp ? null : 'El archivo debe ser una foto JPG, PNG o WebP válida.'
}

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor : ''
}

/** Con un RQ de PLANTA hacia una unidad, cuánto se le descontó a lo que entró para ella, ya dicho. */
export type SalidaRegistrada = { deLaUnidad: string }

/**
 * Salida de almacén sin solicitud de OT: lo que el taller retira para una
 * unidad. La base exige el destino —vehículo registrado o código de la unidad—,
 * la foto y que haya saldo libre; aquí solo se filtra lo que ni siquiera tiene
 * forma de salida antes de tocarla.
 */
export async function registrarSalidaAlmacen(_previo: unknown, formulario: FormData): Promise<ResultadoAccion<SalidaRegistrada>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.despachar')) return { ok: false, error: 'No tienes permiso para registrar salidas de material.' }

  const destino = dato(formulario, 'destino')
  const v = z.object({
    operacion_id: z.guid(),
    material_id: z.guid(),
    cantidad: z.coerce.number().positive().multipleOf(0.001),
    destino: z.enum(['UNIDAD', 'CODIGO']),
    unidad_id: z.guid().optional(),
    // De 2 a 60, como el código interno de un RQ y como la base (migración 20261020196000).
    codigo_unidad: z.string().trim().min(2).max(60).optional(),
    motivo: z.string().trim().min(3).max(200),
    recibido_por_nombre: z.string().trim().min(3).max(160),
    foto_ruta: z.string().min(40).max(200),
    requerimiento_linea_id: z.guid().optional(),
  }).safeParse({
    operacion_id: dato(formulario, 'operacion_id'),
    material_id: dato(formulario, 'material_id'),
    cantidad: dato(formulario, 'cantidad'),
    destino,
    unidad_id: destino === 'UNIDAD' ? dato(formulario, 'unidad_id') || undefined : undefined,
    codigo_unidad: destino === 'CODIGO' ? dato(formulario, 'codigo_unidad') || undefined : undefined,
    motivo: dato(formulario, 'motivo'),
    recibido_por_nombre: dato(formulario, 'recibido_por_nombre'),
    foto_ruta: dato(formulario, 'foto_ruta'),
    requerimiento_linea_id: dato(formulario, 'requerimiento_linea_id') || undefined,
  })
  if (!v.success) return { ok: false, error: 'Revisa material, cantidad, motivo y quién recibe.' }
  // Si la salida atiende un requerimiento, el destino lo pone el propio RQ y aquí puede venir vacío.
  const porRq = Boolean(v.data.requerimiento_linea_id)
  if (!porRq && v.data.destino === 'UNIDAD' && !v.data.unidad_id) return { ok: false, error: 'Elige el vehículo que recibe el material.' }
  if (!porRq && v.data.destino === 'CODIGO' && !v.data.codigo_unidad) return { ok: false, error: 'Elige el código de la unidad (de 2 a 60 caracteres).' }

  const supabase = await createClient()
  const foto = await comprobarFoto(supabase, v.data.foto_ruta)
  if (foto) return { ok: false, error: foto }

  const { data, error } = await supabase.rpc('registrar_salida_material', {
    p_id: v.data.operacion_id,
    p_material: v.data.material_id,
    p_cantidad: v.data.cantidad,
    p_unidad: v.data.destino === 'UNIDAD' ? v.data.unidad_id ?? null : null,
    p_codigo: v.data.destino === 'CODIGO' ? v.data.codigo_unidad ?? null : null,
    p_motivo: v.data.motivo,
    p_recibe: v.data.recibido_por_nombre,
    p_foto: v.data.foto_ruta,
    p_requerimiento_linea: v.data.requerimiento_linea_id ?? null,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== v.data.operacion_id) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/almacen/kardex')
  revalidatePath('/requerimientos')
  // PLANTA o un código sin unidad registrada no son «su unidad»: se dice el
  // código. Se lee el que puso la base, que con la placa de una unidad
  // registrada es el código de esa unidad y no lo escrito; y, con un RQ de
  // PLANTA hacia una unidad, cuánto se le descontó a lo que entró para ella.
  // La salida ya entró: si la lectura falla, el mensaje no dice el código.
  const { data: salida, error: alLeer } = await supabase.from('movimientos_materiales')
    .select('codigo_interno, de_la_unidad, material:materiales(unidad:unidades_medida(codigo))').eq('id', data).maybeSingle()
  if (alLeer) console.error('registrarSalidaAlmacen: no se pudo leer la salida registrada', alLeer)
  if (porRq) {
    const deLaUnidad = Number(salida?.de_la_unidad ?? 0)
    const medida = salida?.material?.unidad?.codigo
    // La ventana lo repite al seguir con el ítem siguiente del RQ, donde no se ve este mensaje.
    const frase = deLaUnidad > 0 && salida?.codigo_interno
      ? `${cantidad(deLaUnidad)}${medida ? ` ${medida}` : ''} ${deLaUnidad === 1 ? 'salió' : 'salieron'} de lo que entró para ${salida.codigo_interno}`
      : null
    return {
      ok: true,
      mensaje: frase ? `Salida registrada y descontada del requerimiento: ${frase}.` : 'Salida registrada y descontada del requerimiento.',
      datos: frase ? { deLaUnidad: frase } : undefined,
    }
  }
  let destinoDicho = 'con su unidad'
  if (v.data.codigo_unidad) {
    const codigo = salida ? salida.codigo_interno : alLeer ? null : normalizarCodigo(v.data.codigo_unidad)
    if (codigo) destinoDicho = `para ${codigo}`
    else if (alLeer) destinoDicho = ''
  }
  return { ok: true, mensaje: `Salida registrada en el kardex${destinoDicho ? ` ${destinoDicho}` : ''}.` }
}

/**
 * La materia prima y los EPP salen en dos pasos: primero la salida con su
 * foto, y la salida se cierra solo cuando Almacén carga el escaneo del formato
 * firmado por el almacenero y por quien recibe. El archivo ya está en el
 * almacenamiento; aquí se comprueba que sea un PDF o una foto antes de
 * enlazarlo, y la base vuelve a comprobar dueño, tipo y tamaño.
 */
export async function cerrarSalidaConFormato(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.despachar')) return { ok: false, error: 'No tienes permiso para cerrar salidas con el formato firmado.' }

  const v = z.object({
    movimiento_id: z.guid(),
    formato_ruta: z.string().min(40).max(200),
  }).safeParse({ movimiento_id: dato(formulario, 'movimiento_id'), formato_ruta: dato(formulario, 'formato_ruta') })
  if (!v.success) return { ok: false, error: 'No se reconoció la salida o el archivo del formato.' }
  if (!v.data.formato_ruta.endsWith(`/${v.data.movimiento_id}-formato.pdf`) && !/-formato\.(jpg|png|webp)$/.test(v.data.formato_ruta)) {
    return { ok: false, error: 'El formato firmado tiene que ser un PDF o una foto JPG, PNG o WebP.' }
  }

  const supabase = await createClient()
  const esPdf = v.data.formato_ruta.endsWith('.pdf')
  if (esPdf) {
    const { data: objeto, error: lectura } = await supabase.storage.from('evidencias-almacen').download(v.data.formato_ruta)
    if (lectura || !objeto || objeto.size > 10485760) return { ok: false, error: 'No se pudo verificar el formato. Vuelve a cargarlo.' }
    const cabecera = new TextDecoder().decode(new Uint8Array(await objeto.slice(0, 5).arrayBuffer()))
    if (cabecera !== '%PDF-') return { ok: false, error: 'El archivo no es un PDF válido.' }
  } else {
    const foto = await comprobarFoto(supabase, v.data.formato_ruta)
    if (foto) return { ok: false, error: foto }
  }

  const { data, error } = await supabase.rpc('cerrar_salida_con_formato', { p_id: v.data.movimiento_id, p_ruta: v.data.formato_ruta })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== v.data.movimiento_id) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/almacen/kardex')
  return { ok: true, mensaje: 'Salida cerrada con su formato firmado.' }
}

// ------------------------------------------------------- planilla sin internet

/** Un material del catálogo que se parece a lo escrito, para que Almacén elija. */
export type SugerenciaPlanilla = {
  id: string
  codigo: string
  descripcion: string
  unidad: string | null
  /** Cómo entraría si se elige este: saldo inicial si no tiene saldo, ingreso general si ya tiene. */
  origen: 'INGRESO_GENERAL' | 'SALDO_INICIAL'
}

export type FilaPlanilla = {
  id: string
  hoja: 'Ingresos' | 'Salidas'
  fila: number
  /** Cuándo pasó, en ISO con el huso de Lima: la base lo guarda como fecha del movimiento. */
  fecha: string | null
  fechaTexto: string
  materialId: string | null
  codigo: string
  /** La descripción del material del catálogo que se usará. */
  descripcion: string | null
  /** Lo que escribió Almacén cuando no puso el código. */
  descripcionEscrita: string
  unidadMedida: string | null
  /** La unidad escrita en la planilla, ya reconocida; null si no escribió ninguna. */
  unidadId: string | null
  /** Si no está con ese nombre: el material que se dará de alta en «Por clasificar». */
  nuevo: { id: string; unidadId: string; unidad: string } | null
  /** Los del catálogo con un nombre parecido: Almacén elige uno o lo da de alta. */
  sugerencias: SugerenciaPlanilla[]
  cantidad: number | null
  origen: 'INGRESO_GENERAL' | 'SALDO_INICIAL'
  documento: string
  precio: number | null
  moneda: 'PEN' | 'USD'
  unidad: string
  /** El nombre de la unidad registrada a la que se vinculará; null si el código es nuevo. */
  unidadRegistrada: string | null
  recibe: string
  /** ELEGIR: no está con ese nombre y hay parecidos; se registra cuando Almacén elige. */
  estado: 'LISTA' | 'ELEGIR' | 'CARGADA' | 'ERROR'
  errores: string[]
  avisos: string[]
}

const MAX_FILAS_PLANILLA = 600
/** Desde cuánto parecido se ofrece un material del catálogo en vez de darlo de alta. */
const PARECIDO_MINIMO = 0.45

/** Un identificador fijo para un mismo contenido: volver a cargar el mismo archivo no duplica. */
function uuidDe(contenido: string) {
  const hex = createHash('sha256').update(contenido).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/**
 * Un identificador fijo por fila escrita: volver a cargar la misma planilla no
 * duplica. Sin código entra la descripción escrita; con código, y con el tipo
 * vacío como ingreso general, queda como siempre: las planillas ya cargadas
 * dan el mismo identificador.
 */
async function idDeFila(usuario: string, f: FilaLeida) {
  const material = f.codigo ? f.codigo.toUpperCase() : `DESCRIPCION:${normalizarNombre(f.descripcion)}:${normalizarNombre(f.unidadEscrita)}`
  return uuidDe([usuario, f.hoja, f.fecha, f.hora ?? '', material, f.cantidad, f.origen ?? 'INGRESO_GENERAL', f.documento, f.precio ?? '', f.moneda, f.unidad, f.recibe].join('|'))
}

type Hojas = Awaited<ReturnType<typeof readXlsxFile>>

const DEMASIADOS_DATOS = 'El archivo tiene demasiados datos.'

/** Abre el Excel subido sin dejar que un archivo chico se expanda a cientos de MB. */
async function abrirLibro(archivo: FormDataEntryValue | null, queEs: string): Promise<{ hojas: Hojas } | { error: string }> {
  if (!(archivo instanceof File) || archivo.size === 0 || archivo.size > 8 * 1024 * 1024) {
    return { error: `Elige ${queEs} en Excel (.xlsx) de hasta 8 MB.` }
  }
  try {
    const bytes = new Uint8Array(await archivo.arrayBuffer())
    if (bytes[0] !== 80 || bytes[1] !== 75) return { error: 'El archivo no es un Excel .xlsx. Guárdalo como «Libro de Excel».' }
    let descomprimido = 0, entradas = 0
    // Mirar el directorio del ZIP sin extraer: un XLSX chico no puede expandirse a cientos de MB.
    unzipSync(bytes, { filter: (e) => { descomprimido += e.originalSize; entradas++; if (descomprimido > 60 * 1024 * 1024 || entradas > 3000) throw new Error(DEMASIADOS_DATOS); return false } })
    return { hojas: await readXlsxFile(Buffer.from(bytes), { trim: false }) }
  } catch (e) {
    // Lo propio se dice tal cual; lo de la librería sale en inglés («invalid zip
    // data») y a Almacén no le dice qué hacer.
    const propio = e instanceof Error && e.message === DEMASIADOS_DATOS
    return { error: propio ? DEMASIADOS_DATOS : 'No se pudo leer el Excel: ábrelo y guárdalo de nuevo como «Libro de Excel» (.xlsx).' }
  }
}

/**
 * Lee la planilla llenada sin internet y la contrasta con la base: material
 * por código o por descripción, unidad registrada o código nuevo, fechas que
 * la base acepta, filas repetidas, lo que ya se cargó y si alcanza el saldo.
 * No registra nada.
 */
export async function leerPlanillaAlmacen(_previo: unknown, datos: FormData): Promise<ResultadoAccion<{ filas: FilaPlanilla[] }>> {
  const perfil = await exigirSesion()
  const ingresa = puede(perfil, 'almacen.recibir')
  const despacha = puede(perfil, 'almacen.despachar')
  if (!ingresa && !despacha) return { ok: false, error: 'No tienes permiso para cargar la planilla.' }

  const abierto = await abrirLibro(datos.get('archivo'), 'la planilla')
  if ('error' in abierto) return { ok: false, error: abierto.error }
  const hoy = hoyLima()
  let leidas: FilaLeida[]
  try {
    const libro = abierto.hojas
    const ingresos = libro.find((h) => h.sheet === 'Ingresos')
    const salidas = libro.find((h) => h.sheet === 'Salidas')
    if (!ingresos || !salidas) {
      return { ok: false, error: 'No es la planilla de almacén: faltan las hojas «Ingresos» y «Salidas». Descárgala de nuevo desde el kardex.' }
    }
    leidas = [
      ...leerHoja('Ingresos', ingresos.data as unknown as Celda[][], hoy),
      ...leerHoja('Salidas', salidas.data as unknown as Celda[][]),
    ]
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo leer la planilla.' }
  }
  if (leidas.length === 0) return { ok: false, error: 'La planilla está vacía: anota los movimientos debajo de los encabezados.' }
  if (leidas.length > MAX_FILAS_PLANILLA) return { ok: false, error: `La planilla tiene ${leidas.length} filas; carga hasta ${MAX_FILAS_PLANILLA} por vez.` }

  const db = await createClient()
  const [catalogo, existencias, unidades, medidas] = await Promise.all([
    materialesParaPlanilla(),
    materialesDelKardex(),
    db.rpc('unidades_para_salida_almacen'),
    db.from('unidades_medida').select('id,codigo,nombre').eq('activo', true),
  ])
  if (unidades.error) return { ok: false, error: mensajeDeError(unidades.error) }
  if (medidas.error) return { ok: false, error: 'No se pudieron cargar las unidades de medida. Vuelve a intentar.' }
  const materialPorCodigo = new Map(catalogo.map((m) => [m.codigo.trim().toUpperCase(), m]))
  const materialesPorNombre = new Map<string, MaterialParaPlanilla[]>()
  for (const m of catalogo) {
    const clave = normalizarNombre(m.descripcion)
    materialesPorNombre.set(clave, [...(materialesPorNombre.get(clave) ?? []), m])
  }
  const medidaPorTexto = new Map<string, { id: string; codigo: string }>()
  for (const u of medidas.data ?? []) for (const clave of [u.codigo, u.nombre]) medidaPorTexto.set(normalizarNombre(clave), { id: u.id, codigo: u.codigo })
  const porDefecto = medidaPorTexto.get('UND') ?? null
  const libre = new Map(existencias.map((m) => [m.material_id, m.disponible]))
  const saldo = new Map(existencias.map((m) => [m.material_id, Number(m.existencia ?? 0)]))
  const origenSegunSaldo = (id: string | null | undefined) => ((id && (saldo.get(id) ?? 0) > 0) ? 'INGRESO_GENERAL' : 'SALDO_INICIAL') as FilaPlanilla['origen']
  // La misma regla que registrar_salida_almacen: placa o código interno, si es de una sola unidad.
  const porIdentificador = new Map<string, string[]>()
  for (const u of unidades.data ?? []) {
    for (const clave of [u.placa, u.codigo_interno]) {
      const k = clave?.trim().toUpperCase()
      if (k) porIdentificador.set(k, [...(porIdentificador.get(k) ?? []), u.nombre ?? k])
    }
  }

  // Cada fila con su material: por código, por el mismo nombre o, si no está, con los parecidos para elegir.
  const resueltas = leidas.map((f) => {
    const errores: string[] = []
    const avisos: string[] = []
    let material: MaterialParaPlanilla | null = null
    let unidadId: string | null = null
    let nuevo: FilaPlanilla['nuevo'] = null
    let sugerencias: SugerenciaPlanilla[] = []
    if (f.codigo) {
      material = materialPorCodigo.get(f.codigo.toUpperCase()) ?? null
      if (!material) errores.push(`El código ${f.codigo} no está en el catálogo activo de Almacén.`)
    } else if (f.descripcion) {
      if (f.unidadEscrita) {
        const medida = medidaPorTexto.get(normalizarNombre(f.unidadEscrita))
        if (medida) unidadId = medida.id
        else errores.push(`La unidad «${f.unidadEscrita}» no está registrada: escribe UND, KG, GAL… o déjala vacía.`)
      }
      const iguales = materialesPorNombre.get(normalizarNombre(f.descripcion)) ?? []
      const conSuUnidad = unidadId ? iguales.filter((m) => m.unidad_id === unidadId) : []
      const candidatos = conSuUnidad.length > 0 ? conSuUnidad : iguales
      if (candidatos.length > 0) {
        // Con nombres repetidos en el catálogo se usa el que ya tiene saldo; si ninguno, el primero por código.
        const ordenados = [...candidatos].sort((a, b) => a.codigo.localeCompare(b.codigo, 'es'))
        material = ordenados.find((m) => (saldo.get(m.id) ?? 0) > 0) ?? ordenados[0]
        if (candidatos.length > 1) {
          avisos.push(`Hay ${candidatos.length} materiales con este nombre (${ordenados.map((m) => m.codigo).join(', ')}): se usa ${material.codigo}${(saldo.get(material.id) ?? 0) > 0 ? ', que ya tiene saldo' : ''}.`)
        }
      } else {
        sugerencias = catalogo
          .map((m) => ({ m, parecido: similitud(f.descripcion, m.descripcion) }))
          .filter((x) => x.parecido >= PARECIDO_MINIMO)
          .sort((a, b) => b.parecido - a.parecido)
          .slice(0, 4)
          .map(({ m }) => ({ id: m.id, codigo: m.codigo, descripcion: m.descripcion, unidad: m.unidad, origen: origenSegunSaldo(m.id) }))
        const medida = unidadId ? { id: unidadId, codigo: (medidas.data ?? []).find((u) => u.id === unidadId)?.codigo ?? '' } : porDefecto
        if (!medida) errores.push('No está registrada la unidad UND: escribe la unidad del material en la planilla.')
        else nuevo = { id: uuidDe([perfil.id, 'MATERIAL_NUEVO', normalizarNombre(f.descripcion), medida.id].join('|')), unidadId: medida.id, unidad: medida.codigo }
      }
    }
    if (material && unidadId && unidadId !== material.unidad_id && !material.unidad_pendiente) {
      errores.push(`${material.codigo} se cuenta en ${material.unidad ?? 'otra unidad'}: corrige la unidad o déjala vacía.`)
    } else if (material?.unidad_pendiente && f.hoja === 'Ingresos') {
      const queda = unidadId ? (medidas.data ?? []).find((u) => u.id === unidadId)?.codigo : material.unidad
      avisos.push(`Su unidad seguía provisional en el catálogo: al registrarlo queda en ${queda ?? 'UND'} y ya aparece en salidas.`)
    }
    return { errores, avisos, material, unidadId, nuevo, sugerencias }
  })

  const ids = await Promise.all(leidas.map((f) => idDeFila(perfil.id, f)))
  const materiales = [...new Set(resueltas.map((r) => r.material?.id).filter((x): x is string => Boolean(x)))]
  const [cargadas, conteos] = await Promise.all([
    db.from('movimientos_materiales').select('id').in('id', ids),
    materiales.length ? db.from('conteos_inventario').select('material_id,registrado_en').in('material_id', materiales) : Promise.resolve({ data: [], error: null }),
  ])
  if (cargadas.error || conteos.error) return { ok: false, error: 'No se pudo revisar lo que ya está en el kardex. Vuelve a intentar.' }
  const yaCargadas = new Set((cargadas.data ?? []).map((m) => m.id))
  const ultimoConteo = new Map<string, string>()
  for (const c of conteos.data ?? []) if (!ultimoConteo.has(c.material_id) || c.registrado_en > ultimoConteo.get(c.material_id)!) ultimoConteo.set(c.material_id, c.registrado_en)

  const ahora = Date.now()
  const limite = sumarDias(hoy, -31)
  const porDia = new Map<string, number>()
  const vistas = new Map<string, number>()
  const filas: FilaPlanilla[] = leidas.map((f, i) => {
    const { avisos, material, unidadId, nuevo, sugerencias } = resueltas[i]
    const errores = [...f.errores, ...resueltas[i].errores]
    if (f.hoja === 'Ingresos' && !ingresa) errores.push('Tu puesto no registra ingresos.')
    if (f.hoja === 'Salidas' && !despacha) errores.push('Tu puesto no registra salidas.')

    // Sin hora, se ordenan como están en la planilla: desde las 08:00, un minuto cada una.
    let fecha: string | null = null
    if (f.fecha) {
      const orden = porDia.get(f.fecha) ?? 0
      porDia.set(f.fecha, orden + 1)
      const hora = f.hora ?? `${String(8 + Math.floor(orden / 60)).padStart(2, '0')}:${String(orden % 60).padStart(2, '0')}`
      // Sin fecha ni hora, entra en el momento en que se carga, en el orden de la planilla.
      const instante = f.fechaSupuesta && !f.hora ? ahora - 60000 + orden : new Date(`${f.fecha}T${hora}:00-05:00`).getTime()
      fecha = new Date(f.hora || instante <= ahora ? instante : ahora - 60000).toISOString()
      if (f.fecha > hoy || (f.hora && instante > ahora + 5 * 60000)) errores.push('La fecha es posterior a hoy.')
      else if (f.fecha < limite) errores.push('Es de hace más de 31 días: regularízalo con un conteo físico.')
      const conteo = material ? ultimoConteo.get(material.id) : undefined
      if (conteo && fecha < new Date(conteo).toISOString()) errores.push(`Este material se contó el ${fechaHora(conteo)}: lo de antes ya está en ese saldo.`)
    }

    const repetida = vistas.get(ids[i])
    if (repetida !== undefined) errores.push(`Repite la fila ${leidas[repetida].fila} de ${leidas[repetida].hoja}: si son dos movimientos, distínguelos en el vale o la hora.`)
    else vistas.set(ids[i], i)

    const registradas = f.unidad ? porIdentificador.get(f.unidad) : undefined
    const fechaTexto = f.fecha ? `${f.fecha.slice(8, 10)}/${f.fecha.slice(5, 7)}/${f.fecha.slice(0, 4)}` : ''
    let estado: FilaPlanilla['estado'] = yaCargadas.has(ids[i]) ? 'CARGADA' : errores.length ? 'ERROR' : 'LISTA'
    if (estado === 'LISTA' && f.hoja === 'Ingresos' && !material && sugerencias.length > 0) estado = 'ELEGIR'
    return {
      id: ids[i], hoja: f.hoja, fila: f.fila, fecha,
      fechaTexto: !f.fecha ? '—' : f.fechaSupuesta ? `${fechaTexto} (hoy: la fila no tenía fecha)` : `${fechaTexto}${f.hora ? ` ${f.hora}` : ''}`,
      materialId: material?.id ?? null, codigo: material?.codigo ?? f.codigo, descripcion: material?.descripcion ?? null,
      descripcionEscrita: f.descripcion, unidadMedida: material?.unidad ?? nuevo?.unidad ?? null, unidadId, nuevo, sugerencias,
      cantidad: f.cantidad,
      origen: f.origen ?? (f.hoja === 'Ingresos' ? origenSegunSaldo(material?.id) : 'INGRESO_GENERAL'),
      documento: f.documento || (f.hoja === 'Ingresos' && f.fecha ? `Planilla de Almacén del ${fechaTexto}` : f.documento),
      precio: f.precio, moneda: f.moneda,
      unidad: f.unidad, unidadRegistrada: registradas?.length === 1 ? registradas[0] : null, recibe: f.recibe,
      estado, errores, avisos,
    }
  })

  // ¿Alcanza el saldo libre? Se cargan primero todos los ingresos y después las salidas.
  const proyectado = new Map(libre)
  for (const f of filas) if (f.estado === 'LISTA' && f.hoja === 'Ingresos' && f.materialId) proyectado.set(f.materialId, (proyectado.get(f.materialId) ?? 0) + (f.cantidad ?? 0))
  for (const f of filas) {
    if (f.estado !== 'LISTA' || f.hoja !== 'Salidas' || !f.materialId) continue
    const queda = (proyectado.get(f.materialId) ?? 0) - (f.cantidad ?? 0)
    if (queda < -0.0005) {
      f.estado = 'ERROR'
      f.errores.push(`No alcanza el saldo libre: hay ${cantidad(proyectado.get(f.materialId) ?? 0)} ${f.unidadMedida ?? ''}.`.replace(/ \.$/, '.'))
    } else proyectado.set(f.materialId, queda)
  }
  return { ok: true, datos: { filas } }
}

/**
 * Registra una fila de la planilla con la fecha en que pasó. Un ingreso puede
 * traer el material del catálogo o, si no está, la descripción y la unidad con
 * que se dará de alta. La base vuelve a comprobarlo todo: permiso, fecha,
 * material, saldo, unidad y foto.
 */
export async function registrarFilaPlanilla(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  const hoja = dato(formulario, 'hoja')
  if (hoja === 'Ingresos' && !puede(perfil, 'almacen.recibir')) return { ok: false, error: 'Tu puesto no registra ingresos.' }
  if (hoja === 'Salidas' && !puede(perfil, 'almacen.despachar')) return { ok: false, error: 'Tu puesto no registra salidas.' }
  const comun = z.object({
    id: z.guid(),
    cantidad: z.coerce.number().positive().multipleOf(0.001),
    fecha: z.string().datetime({ offset: true }),
  }).safeParse({ id: dato(formulario, 'id'), cantidad: dato(formulario, 'cantidad'), fecha: dato(formulario, 'fecha') })
  if (!comun.success) return { ok: false, error: 'La fila no tiene cantidad o fecha válidas.' }
  const db = await createClient()

  if (hoja === 'Ingresos') {
    const v = z.object({
      material_id: z.guid().optional(),
      material_nuevo: z.guid().optional(),
      descripcion: z.string().trim().max(200),
      unidad_id: z.guid().optional(),
      origen: z.enum(['INGRESO_GENERAL', 'SALDO_INICIAL']),
      documento: z.string().trim().min(2).max(100),
      precio: z.union([z.literal(''), z.coerce.number().min(0).multipleOf(0.0001)]),
      moneda: z.enum(['PEN', 'USD']),
    }).safeParse({
      material_id: dato(formulario, 'material_id') || undefined,
      material_nuevo: dato(formulario, 'material_nuevo') || undefined,
      descripcion: dato(formulario, 'descripcion'),
      unidad_id: dato(formulario, 'unidad_id') || undefined,
      origen: dato(formulario, 'origen'), documento: dato(formulario, 'documento'), precio: dato(formulario, 'precio'), moneda: dato(formulario, 'moneda'),
    })
    if (!v.success) return { ok: false, error: 'Revisa el material, el tipo de ingreso, el documento y el precio.' }
    if (!v.data.material_id && (!v.data.material_nuevo || v.data.descripcion.length < 3 || !v.data.unidad_id)) {
      return { ok: false, error: 'Elige el material del catálogo o dalo de alta como nuevo.' }
    }
    const { data, error } = await db.rpc('registrar_ingreso_planilla_libre', {
      p_id: comun.data.id,
      p_material: v.data.material_id ?? null,
      p_material_nuevo: v.data.material_id ? null : v.data.material_nuevo ?? null,
      p_descripcion: v.data.descripcion,
      p_unidad: v.data.unidad_id ?? null,
      p_cantidad: comun.data.cantidad, p_origen: v.data.origen,
      p_documento: v.data.documento, p_precio: v.data.precio === '' ? null : v.data.precio, p_moneda: v.data.moneda, p_fecha: comun.data.fecha,
    })
    if (error) return { ok: false, error: mensajeDeError(error) }
    if (data !== comun.data.id) return { ok: false, error: NO_TOCO_NADA }
  } else if (hoja === 'Salidas') {
    const v = z.object({
      material_id: z.guid(),
      unidad: z.string().trim().min(3).max(60),
      motivo: z.string().trim().min(3).max(200),
      recibe: z.string().trim().min(3).max(160),
      foto_ruta: z.string().min(40).max(200),
    }).safeParse({ material_id: dato(formulario, 'material_id'), unidad: dato(formulario, 'unidad'), motivo: dato(formulario, 'motivo'), recibe: dato(formulario, 'recibe'), foto_ruta: dato(formulario, 'foto_ruta') })
    if (!v.success) return { ok: false, error: 'Revisa el material, la unidad, el vale, quién recibe y la foto.' }
    const foto = await comprobarFoto(db, v.data.foto_ruta)
    if (foto) return { ok: false, error: foto }
    const { data, error } = await db.rpc('registrar_salida_planilla', {
      p_id: comun.data.id, p_material: v.data.material_id, p_cantidad: comun.data.cantidad, p_codigo: v.data.unidad,
      p_motivo: v.data.motivo, p_recibe: v.data.recibe, p_foto: v.data.foto_ruta, p_fecha: comun.data.fecha,
    })
    if (error) return { ok: false, error: mensajeDeError(error) }
    if (data !== comun.data.id) return { ok: false, error: NO_TOCO_NADA }
  } else {
    return { ok: false, error: 'La fila no es de Ingresos ni de Salidas.' }
  }
  revalidatePath('/almacen/kardex')
  return { ok: true }
}

// ------------------------------------------------------------ conteo inicial

export type FilaConteo = {
  id: string
  fila: number
  codigo: string
  materialId: string | null
  descripcion: string | null
  unidadMedida: string | null
  contado: number | null
  /** Lo que el sistema tenía al revisar el archivo. */
  saldo: number
  precio: number | null
  moneda: 'PEN' | 'USD'
  /** Sin saldo en el sistema entra como saldo inicial; con saldo, como ajuste por la diferencia. */
  via: 'SALDO_INICIAL' | 'AJUSTE'
  estado: 'LISTA' | 'CARGADA' | 'SIN_CAMBIO' | 'ERROR'
  errores: string[]
  aviso: string | null
}

const MAX_FILAS_CONTEO = 5000

/** Qué identificadores de la lista ya están en el kardex, como ingreso o como conteo. */
async function yaEnElKardex(db: Awaited<ReturnType<typeof createClient>>, ids: string[]) {
  const hallados = new Set<string>()
  for (let i = 0; i < ids.length; i += 150) {
    const tanda = ids.slice(i, i + 150)
    const [movimientos, conteos] = await Promise.all([
      db.from('movimientos_materiales').select('id').in('id', tanda),
      db.from('conteos_inventario').select('id').in('id', tanda),
    ])
    if (movimientos.error || conteos.error) throw new Error('No se pudo revisar lo que ya está en el kardex. Vuelve a intentar.')
    for (const m of [...(movimientos.data ?? []), ...(conteos.data ?? [])]) hallados.add(m.id)
  }
  return hallados
}

const esquemaFecha = z.iso.date('Indica la fecha del conteo.')

/**
 * Lee el formato del conteo inicial y lo contrasta con la base: material por
 * código, filas repetidas, lo que ya se cargó y cómo entra cada fila. No
 * registra nada.
 */
export async function leerConteoInicial(_previo: unknown, datos: FormData): Promise<ResultadoAccion<{ filas: FilaConteo[] }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.recibir')) return { ok: false, error: 'No tienes permiso para cargar el conteo inicial.' }

  const fecha = esquemaFecha.safeParse(dato(datos, 'fecha'))
  if (!fecha.success) return { ok: false, error: 'Indica la fecha en que se hizo el conteo.' }
  const hoy = hoyLima()
  const fueraDeFecha = motivoDeFechaDeConteo(fecha.data, hoy, sumarDias(hoy, -DIAS_DEL_CONTEO))
  if (fueraDeFecha) return { ok: false, error: fueraDeFecha }

  const abierto = await abrirLibro(datos.get('archivo'), 'el formato del conteo')
  if ('error' in abierto) return { ok: false, error: abierto.error }
  const hoja = abierto.hojas.find((h) => h.sheet === 'Conteo')
  if (!hoja) return { ok: false, error: 'No es el formato del conteo inicial: falta la hoja «Conteo». Descárgalo de nuevo desde el kardex.' }
  let leidas
  try {
    leidas = leerHojaConteo(hoja.data as unknown as Celda[][])
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo leer el conteo.' }
  }
  if (leidas.length === 0) return { ok: false, error: 'No hay cantidades contadas: anótalas en la columna «Cantidad contada».' }
  if (leidas.length > MAX_FILAS_CONTEO) return { ok: false, error: `El conteo tiene ${leidas.length} filas; carga hasta ${MAX_FILAS_CONTEO} por vez.` }

  const db = await createClient()
  const [catalogo, existencias] = await Promise.all([catalogoDeAlmacen(), materialesDelKardex()])
  const materialPorCodigo = new Map(catalogo.map((m) => [m.codigo.trim().toUpperCase(), m]))
  const saldoDe = new Map(existencias.map((m) => [m.material_id, m.existencia]))
  const ids = leidas.map((f) => uuidDe([perfil.id, 'CONTEO_INICIAL', fecha.data, f.codigo.toUpperCase(), f.contado ?? '', f.precio ?? '', f.moneda].join('|')))
  let cargadas: Set<string>
  try {
    cargadas = await yaEnElKardex(db, ids)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo revisar el kardex.' }
  }

  const vistas = new Map<string, number>()
  const filas: FilaConteo[] = leidas.map((f, i) => {
    const errores = [...f.errores]
    const material = materialPorCodigo.get(f.codigo.toUpperCase()) ?? null
    if (f.codigo && !material) errores.push(`El código ${f.codigo} no está en el catálogo activo de Almacén.`)
    if (material) {
      const previa = vistas.get(material.id)
      if (previa !== undefined) errores.push(`Este material ya está en la fila ${leidas[previa].fila}: deja una sola fila por material, con el total contado.`)
      else vistas.set(material.id, i)
    }
    const saldo = material ? saldoDe.get(material.id) ?? 0 : 0
    const via = saldo === 0 ? 'SALDO_INICIAL' : 'AJUSTE'
    let estado: FilaConteo['estado'] = errores.length ? 'ERROR' : 'LISTA'
    if (cargadas.has(ids[i])) estado = 'CARGADA'
    else if (estado === 'LISTA' && via === 'SALDO_INICIAL' && f.contado === 0) estado = 'SIN_CAMBIO'
    return {
      id: ids[i], fila: f.fila, codigo: f.codigo,
      materialId: material?.id ?? null, descripcion: material?.descripcion ?? null, unidadMedida: material?.unidad ?? null,
      contado: f.contado, saldo, precio: f.precio, moneda: f.moneda, via, estado, errores,
      aviso: via === 'AJUSTE' && f.precio !== null && estado === 'LISTA'
        ? 'Ya tiene saldo: entra como ajuste y el precio no se usa. Si hace falta, Logística lo fija en Valorización.'
        : null,
    }
  })
  return { ok: true, datos: { filas } }
}

/**
 * Registra una tanda del conteo inicial. Sin saldo, un ingreso de saldo
 * inicial con su precio; con saldo, un conteo que deja el ajuste por la
 * diferencia. La base vuelve a comprobar permiso, material y área.
 */
export async function registrarConteoInicial(
  _previo: unknown,
  datos: FormData,
): Promise<ResultadoAccion<{ resultados: { id: string; error: string | null }[] }>> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.recibir')) return { ok: false, error: 'No tienes permiso para cargar el conteo inicial.' }

  const fecha = esquemaFecha.safeParse(dato(datos, 'fecha'))
  let crudas: unknown
  try {
    crudas = JSON.parse(dato(datos, 'filas'))
  } catch {
    crudas = null
  }
  const filas = z.array(z.object({
    id: z.guid(),
    material_id: z.guid(),
    contado: z.number().min(0).multipleOf(0.001),
    precio: z.number().min(0).multipleOf(0.0001).nullable(),
    moneda: z.enum(['PEN', 'USD']),
    via: z.enum(['SALDO_INICIAL', 'AJUSTE']),
  })).min(1).max(TANDA_CONTEO).safeParse(crudas)
  if (!fecha.success || !filas.success) return { ok: false, error: 'La tanda no se entiende. Vuelve a cargar el archivo.' }

  const db = await createClient()
  const motivo = motivoConteoInicial(fecha.data)
  // Entre revisar y registrar alguien pudo mover el saldo: un saldo inicial
  // sobre un material que ya tiene saldo lo sumaría dos veces.
  const iniciales = filas.data.filter((f) => f.via === 'SALDO_INICIAL')
  let cargadas = new Set<string>()
  const saldoAhora = new Map<string, number>()
  if (iniciales.length > 0) {
    try {
      cargadas = await yaEnElKardex(db, iniciales.map((f) => f.id))
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'No se pudo revisar el kardex.' }
    }
    const { data, error } = await db.from('v_existencias_materiales').select('material_id,existencia').in('material_id', iniciales.map((f) => f.material_id))
    if (error) return { ok: false, error: 'No se pudo revisar el saldo actual. Vuelve a intentar.' }
    for (const m of data ?? []) if (m.material_id) saldoAhora.set(m.material_id, Number(m.existencia ?? 0))
  }

  const resultados: { id: string; error: string | null }[] = []
  for (const f of filas.data) {
    if (f.via === 'SALDO_INICIAL' && !cargadas.has(f.id) && (saldoAhora.get(f.material_id) ?? 0) !== 0) {
      resultados.push({ id: f.id, error: 'El material recibió movimientos desde que revisaste el archivo. Vuelve a cargarlo: entrará como ajuste.' })
      continue
    }
    const { data, error } = f.via === 'SALDO_INICIAL'
      ? await db.rpc('registrar_ingreso_almacen', {
          p_id: f.id, p_material: f.material_id, p_cantidad: f.contado, p_origen: 'SALDO_INICIAL',
          p_documento: motivo, p_precio: f.precio, p_moneda: f.moneda,
        })
      : await db.rpc('registrar_conteo_almacen', { p_id: f.id, p_material: f.material_id, p_cantidad_fisica: f.contado, p_motivo: motivo })
    if (error) resultados.push({ id: f.id, error: mensajeDeError(error) })
    else if (data !== f.id) resultados.push({ id: f.id, error: NO_TOCO_NADA })
    else resultados.push({ id: f.id, error: null })
  }
  revalidatePath('/almacen/kardex')
  return { ok: true, datos: { resultados } }
}

// ---------------------------------------------------------------- stock mínimo

/**
 * El mínimo lo fija Almacén, con el mismo permiso que exige
 * `fijar_stock_minimo` en la base. Vacío quita el mínimo: el material deja de
 * avisar.
 */
export async function fijarStockMinimo(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.recibir')) return { ok: false, error: 'No tienes permiso para fijar el stock mínimo.' }

  const texto = dato(datos, 'minimo').trim()
  const v = z.object({
    material_id: z.guid(),
    minimo: z.number({ message: 'El mínimo es un número, como 12 o 2.5.' }).min(0, 'El mínimo va de 0 en adelante.').max(99999999999).multipleOf(0.001, 'El mínimo admite hasta 3 decimales.').nullable(),
  }).safeParse({ material_id: dato(datos, 'material_id'), minimo: texto === '' ? null : Number(texto.replace(',', '.')) })
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? 'Revisa el stock mínimo.' }

  const db = await createClient()
  const { data, error } = await db.rpc('fijar_stock_minimo', { p_material: v.data.material_id, p_minimo: v.data.minimo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== v.data.material_id) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/almacen/kardex')
  return { ok: true, mensaje: v.data.minimo === null ? 'Mínimo quitado: este material ya no avisa.' : 'Stock mínimo guardado.' }
}

// ------------------------------------------------- lo que dejó el conductor

/**
 * Valida lo que el conductor de Logística dejó en almacén: cada línea de la
 * compra con lo que de verdad llegó. Si llegó todo basta un toque; si llegó
 * menos, la línea queda observada con su motivo y lo que sí llegó entra igual
 * al kardex. La base lo hace en una sola transacción (`validar_ingresos_compra`).
 */
export async function validarIngresosCompra(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.recibir')) return { ok: false, error: 'No tienes permiso para validar los ingresos.' }

  const compra = z.guid().safeParse(dato(formulario, 'compra_id'))
  const ids = formulario.getAll('linea').map(String)
  if (!compra.success || ids.length === 0 || ids.length > 200 || ids.some((id) => !z.guid().safeParse(id).success)) {
    return { ok: false, error: 'Vuelve a cargar el kardex: la compra ya no está como se ve.' }
  }
  const lineas = []
  for (const id of ids) {
    const texto = dato(formulario, `cantidad_${id}`).trim()
    const llego = Number(texto)
    if (texto === '' || !Number.isFinite(llego) || llego < 0 || Math.round(llego * 1000) !== llego * 1000) {
      return { ok: false, error: 'Escribe cuánto llegó de cada material (cero si no llegó nada).' }
    }
    const observacion = dato(formulario, `observacion_${id}`).trim()
    if (observacion.length > 500) return { ok: false, error: 'La observación puede tener hasta 500 letras.' }
    lineas.push({ id, movimiento_id: llego > 0 ? crypto.randomUUID() : null, cantidad: llego, observacion: observacion || null })
  }
  const documento = dato(formulario, 'documento').trim()
  if (documento.length > 100) return { ok: false, error: 'La guía puede tener hasta 100 letras.' }

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('validar_ingresos_compra', {
    p_compra: compra.data,
    p_lineas: lineas,
    p_documento: documento || undefined,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== lineas.length) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/almacen/kardex')
  revalidatePath('/compras')
  const observadas = lineas.filter((l) => l.observacion || l.cantidad === 0).length
  return {
    ok: true,
    mensaje: observadas > 0
      ? 'Ingreso validado. Lo observado le llegó a Logística para que lo resuelva.'
      : 'Ingreso validado: ya está en el kardex con su saldo.',
  }
}

const DEVOLVER = z.object({
  id: z.guid(),
  ingreso: z.guid('Elige el ingreso de la compra que se devuelve.'),
  cantidad: z.coerce.number('Escribe cuánto vuelve al proveedor.').positive('Escribe cuánto vuelve al proveedor.')
    .refine((n) => Math.round(n * 1000) === n * 1000, 'La cantidad lleva hasta tres decimales.'),
  documento: z.string().trim().min(2, 'Escribe la guía o el documento con que sale lo devuelto.').max(100),
  motivo: z.string().trim().min(10, 'Cuenta por qué se devuelve (de 10 a 500 letras).').max(500, 'El motivo puede tener hasta 500 letras.'),
  se_repone: z.enum(['si', 'no'], 'Di si el proveedor lo repone.'),
})

/**
 * Lo que llegó malo de una compra vuelve al proveedor (decisión de DKS del
 * 22/10). Sale del kardex; si el proveedor lo repone, la OC lo vuelve a esperar,
 * y si no, lo que falte vuelve a la lista de Logística (`devolver_al_proveedor`).
 */
export async function devolverAlProveedor(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.recibir')) return { ok: false, error: 'No tienes permiso para devolver al proveedor.' }
  const v = DEVOLVER.safeParse(Object.fromEntries(formulario))
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? 'Revisa lo que se devuelve.' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('devolver_al_proveedor', {
    p_id: v.data.id,
    p_ingreso: v.data.ingreso,
    p_cantidad: v.data.cantidad,
    p_documento: v.data.documento,
    p_motivo: v.data.motivo,
    p_se_repone: v.data.se_repone === 'si',
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== v.data.id) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath('/almacen/kardex')
  revalidatePath('/compras')
  revalidatePath('/requerimientos')
  return {
    ok: true,
    mensaje: v.data.se_repone === 'si'
      ? 'Devuelto al proveedor: la OC vuelve a esperar lo que repone.'
      : 'Devuelto al proveedor: lo que falte vuelve a la lista de Logística y Contabilidad espera la nota de crédito.',
  }
}

const REPOSICION = z.object({
  id: z.guid(),
  devolucion: z.guid(),
  cantidad: z.coerce.number('Escribe cuánto llegó.').positive('Escribe cuánto llegó.')
    .refine((n) => Math.round(n * 1000) === n * 1000, 'La cantidad lleva hasta tres decimales.'),
  documento: z.string().trim().min(2, 'Escribe la guía o el documento con que llegó.').max(100),
})

/** Llegó lo que el proveedor repone: entra al kardex contra su devolución (`recibir_reposicion`). */
export async function recibirReposicion(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.recibir')) return { ok: false, error: 'No tienes permiso para recibir la reposición.' }
  const v = REPOSICION.safeParse(Object.fromEntries(formulario))
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? 'Revisa lo que llegó.' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('recibir_reposicion', {
    p_id: v.data.id, p_devolucion: v.data.devolucion, p_cantidad: v.data.cantidad, p_documento: v.data.documento,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== v.data.id) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath('/almacen/kardex')
  revalidatePath('/compras')
  revalidatePath('/requerimientos')
  return { ok: true, mensaje: 'La reposición entró al kardex.' }
}

const YA_NO = z.object({
  devolucion: z.guid(),
  motivo: z.string().trim().min(10, 'Cuenta por qué ya no se espera (de 10 a 500 letras).').max(500, 'El motivo puede tener hasta 500 letras.'),
})

/** El proveedor no repone lo devuelto: lo que falte vuelve a la lista de Logística (`dejar_de_esperar_reposicion`). */
export async function dejarDeEsperarReposicion(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.recibir') && !puede(perfil, 'compras.crear')) {
    return { ok: false, error: 'No tienes permiso para dejar de esperar la reposición.' }
  }
  const v = YA_NO.safeParse(Object.fromEntries(formulario))
  if (!v.success) return { ok: false, error: v.error.issues[0]?.message ?? 'Revisa el motivo.' }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('dejar_de_esperar_reposicion', { p_devolucion: v.data.devolucion, p_motivo: v.data.motivo })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== v.data.devolucion) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath('/almacen/kardex')
  revalidatePath('/compras')
  revalidatePath('/requerimientos')
  return { ok: true, mensaje: 'Ya no se espera: lo que falte vuelve a la lista de Logística y Contabilidad espera la nota de crédito.' }
}
