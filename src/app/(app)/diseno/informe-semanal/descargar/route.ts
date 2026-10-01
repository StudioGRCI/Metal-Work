import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextRequest, NextResponse } from 'next/server'

import { datosInformeDiseno } from '@/lib/datos/informe-diseno'
import { generarInformeDiseno } from '@/lib/documentos/informe-diseno'
import { numeroInforme } from '@/lib/dominio/informe-diseno'
import { inicioSemanaDiseno } from '@/lib/dominio/semana-diseno'
import { exigirPermiso } from '@/lib/sesion'

/** El logo de la cabecera; si no se pudo leer, la cabecera lleva el nombre en texto. */
async function leerLogo() {
  try {
    return await readFile(path.join(process.cwd(), 'public', 'marca', 'logo-metal-work.png'))
  } catch {
    return null
  }
}

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
  const archivo = await generarInformeDiseno(datos, await leerLogo())
  return new NextResponse(new Uint8Array(archivo), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="MW-IF-DI-01-Informe-${numeroInforme(datos.informe.numero)}-${inicio}.docx"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
