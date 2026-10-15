import { z } from 'zod'

/**
 * Lo que toda acción de corrección recibe del formulario además de sus cambios:
 * el id de la corrección (lo decide el navegador, así un reintento no anota dos
 * veces), el motivo y la ruta del justificante ya subido. La base vuelve a
 * comprobar todo; esto solo evita llamarla con datos que seguro rechaza.
 */
const ESQUEMA = z.object({
  correccion_id: z.guid('Vuelve a abrir la corrección.'),
  motivo: z
    .string()
    .trim()
    .min(10, 'Cuenta por qué se corrige, en al menos 10 caracteres.')
    .max(500, 'El motivo pasa de 500 caracteres.'),
  justificante_ruta: z.string().min(1, 'Adjunta el justificante de la corrección.').max(200),
  justificante_nombre: z.string().trim().min(1).max(200),
})

export type DatosDeCorreccion = z.infer<typeof ESQUEMA>

function dato(formulario: FormData, nombre: string) {
  const valor = formulario.get(nombre)
  return typeof valor === 'string' ? valor : ''
}

export function datosDeCorreccion(formulario: FormData): { ok: true; datos: DatosDeCorreccion } | { ok: false; error: string } {
  const r = ESQUEMA.safeParse({
    correccion_id: dato(formulario, 'correccion_id'),
    motivo: dato(formulario, 'motivo'),
    justificante_ruta: dato(formulario, 'justificante_ruta'),
    justificante_nombre: dato(formulario, 'justificante_nombre') || 'justificante',
  })
  return r.success ? { ok: true, datos: r.data } : { ok: false, error: r.error.issues[0]?.message ?? 'Revisa la corrección.' }
}

/** Los cambios viajan como JSON en un campo oculto `cambios`. */
export function cambiosDelFormulario(formulario: FormData): Record<string, unknown> | null {
  try {
    const valor = JSON.parse(dato(formulario, 'cambios') || '{}')
    return valor && typeof valor === 'object' && !Array.isArray(valor) ? valor : null
  } catch {
    return null
  }
}
