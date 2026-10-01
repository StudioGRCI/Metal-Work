import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { renderToBuffer } from '@react-pdf/renderer'
import { NextResponse } from 'next/server'
import { obtenerEvaluacionDiseno } from '@/lib/datos/evaluaciones-diseno'
import { DocumentoEvaluacionDiseno } from '@/lib/documentos/evaluacion-diseno'
import { exigirPermiso } from '@/lib/sesion'

/** El logo va dentro del PDF; si no se pudo leer, el documento sale igual con el nombre en texto. */
async function leerLogo() {
  try {
    return await readFile(path.join(process.cwd(), 'public', 'marca', 'logo-metal-work.png'))
  } catch {
    return null
  }
}

export async function GET(_request: Request, context: RouteContext<'/diseno/evaluaciones/[id]/pdf'>) {
  await exigirPermiso(['diseno.evaluar', 'administracion.recibir_evaluacion'])
  const { id } = await context.params
  // El RLS decide: quien no la puede ver recibe «no está disponible», igual que si no existiera.
  const e = await obtenerEvaluacionDiseno(id)
  if (!e) return NextResponse.json({ error: 'La evaluación no está disponible.' }, { status: 404 })

  const buffer = await renderToBuffer(<DocumentoEvaluacionDiseno e={e} logo={await leerLogo()} />)
  const nombre = e.evaluado_nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '')
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="MW-Evaluacion-${nombre || 'personal'}-${e.fecha_evaluacion}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
