import { NextRequest, NextResponse } from 'next/server'

import { datosInformeDiseno } from '@/lib/datos/informe-diseno'
import { generarInformeDiseno } from '@/lib/documentos/informe-diseno'
import { inicioSemanaDiseno } from '@/lib/dominio/semana-diseno'
import { exigirPermiso } from '@/lib/sesion'

export async function GET(request: NextRequest) {
  await exigirPermiso(['diseno.planos', 'diseno.subir_pdf', 'supervision.general'])
  const parametro = request.nextUrl.searchParams.get('semana')
  if (!parametro) return NextResponse.json({ error: 'Indica la semana del informe.' }, { status: 400 })
  let inicio: string
  try { inicio = inicioSemanaDiseno(parametro) } catch {
    return NextResponse.json({ error: 'La semana indicada no es válida.' }, { status: 400 })
  }
  const datos = await datosInformeDiseno(inicio)
  if (!datos.informe) return NextResponse.json({ error: 'Primero guarda el informe semanal.' }, { status: 404 })
  const archivo = await generarInformeDiseno(datos)
  return new NextResponse(new Uint8Array(archivo), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="MW-Informe-Diseno-${datos.informe.numero}-${inicio}.docx"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
