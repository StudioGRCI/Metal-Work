'use server'

import { createHash } from 'node:crypto'

import { unzipSync } from 'fflate'
import { revalidatePath } from 'next/cache'
import readXlsxFile from 'read-excel-file/node'
import { z } from 'zod'

import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import { catalogoDeAlmacen } from '@/lib/datos/atencion-materiales'
import { materialesDelKardex } from '@/lib/datos/kardex'
import { leerHoja, type Celda, type FilaLeida } from '@/lib/dominio/planilla-almacen'
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

/**
 * Salida de almacén sin solicitud de OT: lo que el taller retira para una
 * unidad. La base exige el destino —vehículo registrado o código de la unidad—,
 * la foto y que haya saldo libre; aquí solo se filtra lo que ni siquiera tiene
 * forma de salida antes de tocarla.
 */
export async function registrarSalidaAlmacen(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  if (!puede(perfil, 'almacen.despachar')) return { ok: false, error: 'Solo Almacén registra salidas de material.' }

  const destino = dato(formulario, 'destino')
  const v = z.object({
    operacion_id: z.string().uuid(),
    material_id: z.string().uuid(),
    cantidad: z.coerce.number().positive().multipleOf(0.001),
    destino: z.enum(['UNIDAD', 'CODIGO']),
    unidad_id: z.string().uuid().optional(),
    codigo_unidad: z.string().trim().min(3).max(60).optional(),
    motivo: z.string().trim().min(3).max(200),
    recibido_por_nombre: z.string().trim().min(3).max(160),
    foto_ruta: z.string().min(40).max(200),
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
  })
  if (!v.success) return { ok: false, error: 'Revisa material, cantidad, motivo y quién recibe.' }
  if (v.data.destino === 'UNIDAD' && !v.data.unidad_id) return { ok: false, error: 'Elige el vehículo que recibe el material.' }
  if (v.data.destino === 'CODIGO' && !v.data.codigo_unidad) return { ok: false, error: 'Escribe el código de la unidad (de 3 a 60 caracteres).' }

  const supabase = await createClient()
  const foto = await comprobarFoto(supabase, v.data.foto_ruta)
  if (foto) return { ok: false, error: foto }

  const { data, error } = await supabase.rpc('registrar_salida_almacen', {
    p_id: v.data.operacion_id,
    p_material: v.data.material_id,
    p_cantidad: v.data.cantidad,
    p_unidad: v.data.destino === 'UNIDAD' ? v.data.unidad_id ?? null : null,
    p_codigo: v.data.destino === 'CODIGO' ? v.data.codigo_unidad ?? null : null,
    p_motivo: v.data.motivo,
    p_recibe: v.data.recibido_por_nombre,
    p_foto: v.data.foto_ruta,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== v.data.operacion_id) return { ok: false, error: NO_TOCO_NADA }

  revalidatePath('/almacen/kardex')
  return { ok: true, mensaje: 'Salida registrada en el kardex con su unidad.' }
}

// ------------------------------------------------------- planilla sin internet

export type FilaPlanilla = {
  id: string
  hoja: 'Ingresos' | 'Salidas'
  fila: number
  /** Cuándo pasó, en ISO con el huso de Lima: la base lo guarda como fecha del movimiento. */
  fecha: string | null
  fechaTexto: string
  materialId: string | null
  codigo: string
  descripcion: string | null
  unidadMedida: string | null
  cantidad: number | null
  origen: 'INGRESO_GENERAL' | 'SALDO_INICIAL'
  documento: string
  precio: number | null
  moneda: 'PEN' | 'USD'
  unidad: string
  /** El nombre de la unidad registrada a la que se vinculará; null si el código es nuevo. */
  unidadRegistrada: string | null
  recibe: string
  estado: 'LISTA' | 'CARGADA' | 'ERROR'
  errores: string[]
}

const MAX_FILAS_PLANILLA = 600

/** Un identificador fijo por fila escrita: volver a cargar la misma planilla no duplica. */
async function idDeFila(usuario: string, f: FilaLeida) {
  const contenido = [usuario, f.hoja, f.fecha, f.hora ?? '', f.codigo.toUpperCase(), f.cantidad, f.origen, f.documento, f.precio ?? '', f.moneda, f.unidad, f.recibe].join('|')
  const hex = createHash('sha256').update(contenido).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/**
 * Lee la planilla llenada sin internet y la contrasta con la base: material
 * por código, unidad registrada o código nuevo, fechas que la base acepta,
 * filas repetidas, lo que ya se cargó y si alcanza el saldo. No registra nada.
 */
export async function leerPlanillaAlmacen(_previo: unknown, datos: FormData): Promise<ResultadoAccion<{ filas: FilaPlanilla[] }>> {
  const perfil = await exigirSesion()
  const ingresa = puede(perfil, 'almacen.recibir')
  const despacha = puede(perfil, 'almacen.despachar')
  if (!ingresa && !despacha) return { ok: false, error: 'Solo Almacén carga la planilla.' }

  const archivo = datos.get('archivo')
  if (!(archivo instanceof File) || archivo.size === 0 || archivo.size > 8 * 1024 * 1024) {
    return { ok: false, error: 'Elige la planilla de Excel (.xlsx) de hasta 8 MB.' }
  }
  let leidas: FilaLeida[]
  try {
    const bytes = new Uint8Array(await archivo.arrayBuffer())
    if (bytes[0] !== 80 || bytes[1] !== 75) return { ok: false, error: 'El archivo no es un Excel .xlsx. Guárdalo como «Libro de Excel».' }
    let descomprimido = 0, entradas = 0
    // Mirar el directorio del ZIP sin extraer: un XLSX chico no puede expandirse a cientos de MB.
    unzipSync(bytes, { filter: (e) => { descomprimido += e.originalSize; entradas++; if (descomprimido > 60 * 1024 * 1024 || entradas > 3000) throw new Error('La planilla tiene demasiados datos.'); return false } })
    const libro = await readXlsxFile(Buffer.from(bytes), { trim: false })
    const ingresos = libro.find((h) => h.sheet === 'Ingresos')
    const salidas = libro.find((h) => h.sheet === 'Salidas')
    if (!ingresos || !salidas) {
      return { ok: false, error: 'No es la planilla de almacén: faltan las hojas «Ingresos» y «Salidas». Descárgala de nuevo desde el kardex.' }
    }
    leidas = [
      ...leerHoja('Ingresos', ingresos.data as unknown as Celda[][]),
      ...leerHoja('Salidas', salidas.data as unknown as Celda[][]),
    ]
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'No se pudo leer la planilla.' }
  }
  if (leidas.length === 0) return { ok: false, error: 'La planilla está vacía: anota los movimientos debajo de los encabezados.' }
  if (leidas.length > MAX_FILAS_PLANILLA) return { ok: false, error: `La planilla tiene ${leidas.length} filas; carga hasta ${MAX_FILAS_PLANILLA} por vez.` }

  const db = await createClient()
  const [catalogo, existencias, unidades] = await Promise.all([
    catalogoDeAlmacen(),
    materialesDelKardex(),
    db.rpc('unidades_para_salida_almacen'),
  ])
  if (unidades.error) return { ok: false, error: mensajeDeError(unidades.error) }
  const materialPorCodigo = new Map(catalogo.map((m) => [m.codigo.trim().toUpperCase(), m]))
  const libre = new Map(existencias.map((m) => [m.material_id, m.disponible]))
  // La misma regla que registrar_salida_almacen: placa o código interno, si es de una sola unidad.
  const porIdentificador = new Map<string, string[]>()
  for (const u of unidades.data ?? []) {
    for (const clave of [u.placa, u.codigo_interno]) {
      const k = clave?.trim().toUpperCase()
      if (k) porIdentificador.set(k, [...(porIdentificador.get(k) ?? []), u.nombre ?? k])
    }
  }

  const ids = await Promise.all(leidas.map((f) => idDeFila(perfil.id, f)))
  const materiales = [...new Set(leidas.map((f) => materialPorCodigo.get(f.codigo.toUpperCase())?.id).filter((x): x is string => Boolean(x)))]
  const [cargadas, conteos] = await Promise.all([
    db.from('movimientos_materiales').select('id').in('id', ids),
    materiales.length ? db.from('conteos_inventario').select('material_id,registrado_en').in('material_id', materiales) : Promise.resolve({ data: [], error: null }),
  ])
  if (cargadas.error || conteos.error) return { ok: false, error: 'No se pudo revisar lo que ya está en el kardex. Vuelve a intentar.' }
  const yaCargadas = new Set((cargadas.data ?? []).map((m) => m.id))
  const ultimoConteo = new Map<string, string>()
  for (const c of conteos.data ?? []) if (!ultimoConteo.has(c.material_id) || c.registrado_en > ultimoConteo.get(c.material_id)!) ultimoConteo.set(c.material_id, c.registrado_en)

  const ahora = Date.now()
  const hoy = hoyLima()
  const limite = sumarDias(hoy, -31)
  const porDia = new Map<string, number>()
  const vistas = new Map<string, number>()
  const filas: FilaPlanilla[] = leidas.map((f, i) => {
    const errores = [...f.errores]
    const material = materialPorCodigo.get(f.codigo.toUpperCase()) ?? null
    if (f.codigo && !material) errores.push(`El código ${f.codigo} no está en el catálogo activo de Almacén.`)
    if (f.hoja === 'Ingresos' && !ingresa) errores.push('Tu puesto no registra ingresos.')
    if (f.hoja === 'Salidas' && !despacha) errores.push('Tu puesto no registra salidas.')

    // Sin hora, se ordenan como están en la planilla: desde las 08:00, un minuto cada una.
    let fecha: string | null = null
    if (f.fecha) {
      const orden = porDia.get(f.fecha) ?? 0
      porDia.set(f.fecha, orden + 1)
      const hora = f.hora ?? `${String(8 + Math.floor(orden / 60)).padStart(2, '0')}:${String(orden % 60).padStart(2, '0')}`
      const instante = new Date(`${f.fecha}T${hora}:00-05:00`).getTime()
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
    return {
      id: ids[i], hoja: f.hoja, fila: f.fila, fecha,
      fechaTexto: f.fecha ? `${f.fecha.slice(8, 10)}/${f.fecha.slice(5, 7)}/${f.fecha.slice(0, 4)}${f.hora ? ` ${f.hora}` : ''}` : '—',
      materialId: material?.id ?? null, codigo: f.codigo, descripcion: material?.descripcion ?? null, unidadMedida: material?.unidad ?? null,
      cantidad: f.cantidad, origen: f.origen, documento: f.documento, precio: f.precio, moneda: f.moneda,
      unidad: f.unidad, unidadRegistrada: registradas?.length === 1 ? registradas[0] : null, recibe: f.recibe,
      estado: yaCargadas.has(ids[i]) ? 'CARGADA' : errores.length ? 'ERROR' : 'LISTA',
      errores,
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
 * Registra una fila de la planilla con la fecha en que pasó. La base vuelve a
 * comprobarlo todo: permiso, fecha, material, saldo, unidad y foto.
 */
export async function registrarFilaPlanilla(_previo: unknown, formulario: FormData): Promise<ResultadoAccion> {
  const perfil = await exigirSesion()
  const hoja = dato(formulario, 'hoja')
  if (hoja === 'Ingresos' && !puede(perfil, 'almacen.recibir')) return { ok: false, error: 'Tu puesto no registra ingresos.' }
  if (hoja === 'Salidas' && !puede(perfil, 'almacen.despachar')) return { ok: false, error: 'Tu puesto no registra salidas.' }
  const comun = z.object({
    id: z.string().uuid(),
    material_id: z.string().uuid(),
    cantidad: z.coerce.number().positive().multipleOf(0.001),
    fecha: z.string().datetime({ offset: true }),
  }).safeParse({ id: dato(formulario, 'id'), material_id: dato(formulario, 'material_id'), cantidad: dato(formulario, 'cantidad'), fecha: dato(formulario, 'fecha') })
  if (!comun.success) return { ok: false, error: 'La fila no tiene material, cantidad o fecha válidos.' }
  const db = await createClient()

  if (hoja === 'Ingresos') {
    const v = z.object({
      origen: z.enum(['INGRESO_GENERAL', 'SALDO_INICIAL']),
      documento: z.string().trim().min(2).max(100),
      precio: z.union([z.literal(''), z.coerce.number().min(0).multipleOf(0.0001)]),
      moneda: z.enum(['PEN', 'USD']),
    }).safeParse({ origen: dato(formulario, 'origen'), documento: dato(formulario, 'documento'), precio: dato(formulario, 'precio'), moneda: dato(formulario, 'moneda') })
    if (!v.success) return { ok: false, error: 'Revisa el tipo de ingreso, el documento y el precio.' }
    const { data, error } = await db.rpc('registrar_ingreso_planilla', {
      p_id: comun.data.id, p_material: comun.data.material_id, p_cantidad: comun.data.cantidad, p_origen: v.data.origen,
      p_documento: v.data.documento, p_precio: v.data.precio === '' ? null : v.data.precio, p_moneda: v.data.moneda, p_fecha: comun.data.fecha,
    })
    if (error) return { ok: false, error: mensajeDeError(error) }
    if (data !== comun.data.id) return { ok: false, error: NO_TOCO_NADA }
  } else if (hoja === 'Salidas') {
    const v = z.object({
      unidad: z.string().trim().min(3).max(60),
      motivo: z.string().trim().min(3).max(200),
      recibe: z.string().trim().min(3).max(160),
      foto_ruta: z.string().min(40).max(200),
    }).safeParse({ unidad: dato(formulario, 'unidad'), motivo: dato(formulario, 'motivo'), recibe: dato(formulario, 'recibe'), foto_ruta: dato(formulario, 'foto_ruta') })
    if (!v.success) return { ok: false, error: 'Revisa la unidad, el vale, quién recibe y la foto.' }
    const foto = await comprobarFoto(db, v.data.foto_ruta)
    if (foto) return { ok: false, error: foto }
    const { data, error } = await db.rpc('registrar_salida_planilla', {
      p_id: comun.data.id, p_material: comun.data.material_id, p_cantidad: comun.data.cantidad, p_codigo: v.data.unidad,
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
