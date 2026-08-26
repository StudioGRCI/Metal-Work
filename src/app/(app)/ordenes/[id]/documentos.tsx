import { AlertTriangle } from 'lucide-react'

import { ListaDocumentos } from '@/components/documentos/lista-documentos'
import { SubirDocumento, type TipoDocumento } from '@/components/documentos/subir-documento'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { listarDocumentos, documentosFaltantes, versionesDeDocumento } from '@/lib/datos/documentos'
import { firmasDeDocumentos, posiblesFirmantes } from '@/lib/datos/firmas'

export async function DocumentosOrden({
  ordenId,
  tipos,
  puedeSubir,
  usuarioId,
  puedePedirFirmas,
}: {
  ordenId: string
  tipos: TipoDocumento[]
  puedeSubir: boolean
  usuarioId: string
  puedePedirFirmas: boolean
}) {
  const [documentos, faltantes] = await Promise.all([
    listarDocumentos({ ordenId }),
    documentosFaltantes(ordenId),
  ])

  // Se resuelve la versión vigente de cada documento para el botón de descarga.
  const versiones = await Promise.all(
    documentos.map(async (d) => ({ id: d.id, versiones: await versionesDeDocumento(d.id) })),
  )

  const [firmas, firmantes] = await Promise.all([
    firmasDeDocumentos(documentos.map((d) => d.id)),
    puedePedirFirmas ? posiblesFirmantes() : Promise.resolve([]),
  ])

  const versionesPorDocumento: Record<
    string,
    { bucket: string; ruta_storage: string; nombre_archivo: string }
  > = {}

  for (const { id, versiones: lista } of versiones) {
    const ultima = lista[0]
    if (ultima) {
      versionesPorDocumento[id] = {
        bucket: ultima.bucket,
        ruta_storage: ultima.ruta_storage,
        nombre_archivo: ultima.nombre_archivo,
      }
    }
  }

  const pendientes = faltantes as unknown as { codigo: string; nombre: string }[]

  return (
    <div className="space-y-4">
      {pendientes.length > 0 && (
        <p className="flex items-start gap-2 rounded-[var(--radius-base)] bg-aviso-suave px-3 py-2 text-sm text-aviso">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            Falta la documentación obligatoria para cerrar esta orden:{' '}
            <strong>{pendientes.map((f) => f.nombre).join(', ')}</strong>.
          </span>
        </p>
      )}

      <Tarjeta>
        <TarjetaCabecera
          titulo="Documentos de la orden"
          descripcion="Planos, fotos de avance, actas y todo lo que respalda el trabajo. Cada archivo nuevo es una versión: nada se sobrescribe."
          acciones={
            puedeSubir ? (
              <SubirDocumento
                tipos={tipos}
                entidadTabla="ordenes_trabajo"
                entidadId={ordenId}
                ordenId={ordenId}
              />
            ) : null
          }
        />
        <TarjetaCuerpo className="p-0">
          <ListaDocumentos
            documentos={documentos}
            versionesPorDocumento={versionesPorDocumento}
            vacio="Esta orden todavía no tiene documentos adjuntos."
            firmas={firmas}
            firmantes={firmantes}
            usuarioId={usuarioId}
            puedePedirFirmas={puedePedirFirmas}
          />
        </TarjetaCuerpo>
      </Tarjeta>
    </div>
  )
}
