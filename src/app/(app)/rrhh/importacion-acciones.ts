'use server'
import readXlsxFile from 'read-excel-file/node'
import { unzipSync } from 'fflate'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { exigirPermiso } from '@/lib/sesion'
import { createClient } from '@/lib/supabase/server'
import { mensajeDeError, NO_TOCO_NADA, type ResultadoAccion } from '@/lib/acciones'
import {
  asignarEmpresas, claveNombre, esHojaDePagos, esHojaDeResumen, leerBoletas, leerPagos, lineaPlanilla, normalizar,
  type BoletaConError, type LineaPlanilla,
} from '@/lib/dominio/planilla-excel'
import { TIPO_PLANILLA, definir } from '@/lib/dominio/estados'

const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SE(P)?TIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']

export type LecturaPlanilla = {
  /** Las personas por empresa, en el orden de la hoja PAGOS; las que no figuran ahí, al final. */
  empresas: { empresa: string | null; lineas: LineaPlanilla[] }[]
  errores: BoletaConError[]
  hojas: string[]
  omitidas: string[]
  conPagos: boolean
  /** Las que ya están en alguna planilla de este mes, por su clave de nombre. */
  yaEn: Record<string, string>
}

/**
 * Lee el libro entero: todas las hojas RESUMEN del mes y año de la planilla
 * y la hoja PAGOS, que dice la empresa de cada persona. Nada se guarda aquí:
 * Recursos Humanos ve lo leído, con sus avisos, y elige a quién importar.
 */
export async function leerExcelPlanilla(_previo: unknown, datos: FormData): Promise<ResultadoAccion<LecturaPlanilla>> {
  await exigirPermiso('rrhh.gestionar_planillas')
  const archivo = datos.get('archivo')
  const planillaId = z.string().uuid().safeParse(datos.get('planilla_id'))
  if (!(archivo instanceof File) || archivo.size === 0 || archivo.size > 5 * 1024 * 1024 || !planillaId.success) {
    return { ok: false, error: 'Elige el Excel de la planilla del mes, de hasta 5 MB.' }
  }
  const db = await createClient()
  const planilla = await db.from('planillas').select('periodo').eq('id', planillaId.data).maybeSingle()
  if (planilla.error) return { ok: false, error: mensajeDeError(planilla.error) }
  if (!planilla.data) return { ok: false, error: 'La planilla no está disponible.' }
  const mes = new RegExp(`^RESUMEN ${MESES[Number(planilla.data.periodo.slice(5, 7)) - 1]}\\b`)
  const anio = planilla.data.periodo.slice(0, 4)

  try {
    const bytes = new Uint8Array(await archivo.arrayBuffer())
    if (bytes[0] !== 80 || bytes[1] !== 75) return { ok: false, error: 'El archivo no es un libro de Excel (.xlsx) válido.' }
    let descomprimido = 0
    let entradas = 0
    // Mirar el directorio del ZIP sin extraer: un XLSX chico no puede inflarse a cientos de MB.
    unzipSync(bytes, { filter: (entrada) => {
      descomprimido += entrada.originalSize
      entradas++
      if (descomprimido > 60 * 1024 * 1024 || entradas > 3000) throw new Error('El Excel trae demasiados datos. Usa solamente el libro de la planilla del mes.')
      return false
    } })
    const hojas = await readXlsxFile(Buffer.from(bytes))
    const resumen = hojas.filter((h) => esHojaDeResumen(h.sheet))
    const delMes = resumen.filter((h) => mes.test(normalizar(h.sheet)) && h.sheet.trim().endsWith(anio))
    const omitidas = resumen.filter((h) => !delMes.includes(h)).map((h) => h.sheet.trim())
    if (!delMes.length) {
      return { ok: false, error: `El libro no tiene hojas RESUMEN de ${planilla.data.periodo.slice(5, 7)}/${anio}. Revisa que sea el Excel de este mes.` }
    }
    const pagos = hojas.find((h) => esHojaDePagos(h.sheet))
    const grupos = pagos ? leerPagos(pagos.data) : []
    const lineas: LineaPlanilla[] = []
    const errores: BoletaConError[] = []
    for (const h of delMes) {
      const r = leerBoletas(h.data, h.sheet.trim())
      lineas.push(...r.lineas)
      errores.push(...r.errores)
    }
    const conEmpresa = asignarEmpresas(lineas, grupos)
    const empresas = [...grupos.map((g) => g.empresa), null]
      .map((empresa) => ({ empresa, lineas: conEmpresa.filter((l) => l.empresa === empresa) }))
      .filter((g) => g.lineas.length > 0)

    // Quién ya está en alguna planilla de este mes, para no ofrecerlo dos veces.
    const yaEn: Record<string, string> = {}
    const delPeriodo = await db.from('planillas').select('id,tipo').eq('periodo', planilla.data.periodo)
    if (delPeriodo.error) return { ok: false, error: mensajeDeError(delPeriodo.error) }
    const ids = (delPeriodo.data ?? []).map((p) => p.id)
    if (ids.length) {
      const personas = await db.from('planilla_personas').select('nombre,planilla_id').in('planilla_id', ids).limit(2000)
      if (personas.error) return { ok: false, error: mensajeDeError(personas.error) }
      const tipoDe = new Map((delPeriodo.data ?? []).map((p) => [p.id, definir(TIPO_PLANILLA, p.tipo).etiqueta]))
      for (const p of personas.data ?? []) yaEn[claveNombre(p.nombre)] = tipoDe.get(p.planilla_id) ?? 'otra planilla'
    }

    return { ok: true, datos: { empresas, errores, hojas: delMes.map((h) => h.sheet.trim()), omitidas, conPagos: Boolean(pagos), yaEn } }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'No se pudo leer el Excel de la planilla.' }
  }
}

export async function confirmarImportacion(_previo: unknown, datos: FormData): Promise<ResultadoAccion> {
  await exigirPermiso('rrhh.gestionar_planillas')
  const cab = z.object({ planilla_id: z.string().uuid(), importacion_id: z.string().uuid(), lineas: z.string().max(1500000) })
    .safeParse(Object.fromEntries(datos))
  if (!cab.success) return { ok: false, error: 'Revisa la planilla y las personas elegidas.' }
  let crudo: unknown
  try { crudo = JSON.parse(cab.data.lineas) } catch { return { ok: false, error: 'El detalle no se pudo leer. Vuelve a cargar el Excel.' } }
  const lineas = z.array(lineaPlanilla).min(1).max(300).safeParse(crudo)
  if (!lineas.success) return { ok: false, error: 'Elige al menos una persona; el detalle trae importes inválidos.' }

  const db = await createClient()
  const { data, error } = await db.rpc('importar_planilla_excel', {
    p_id: cab.data.importacion_id, p_planilla: cab.data.planilla_id, p_lineas: lineas.data,
  })
  if (error) return { ok: false, error: mensajeDeError(error) }
  if (data !== cab.data.importacion_id) return { ok: false, error: NO_TOCO_NADA }
  revalidatePath('/rrhh')
  const n = lineas.data.length
  return { ok: true, mensaje: `${n} ${n === 1 ? 'persona importada' : 'personas importadas'}. Reparte su costo entre las OT antes de cerrar la planilla.` }
}
