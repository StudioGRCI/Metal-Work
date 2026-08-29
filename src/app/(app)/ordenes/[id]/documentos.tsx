import { AlertTriangle } from 'lucide-react'

import { ListaDocumentos } from '@/components/documentos/lista-documentos'
import { SubirDocumento, type TipoDocumento } from '@/components/documentos/subir-documento'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { listarDocumentos, documentosFaltantes, ultimasVersiones } from '@/lib/datos/documentos'
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

  // La versión vigente de cada documento, para el botón de descarga: en una
  // sola consulta, no una por documento.
  const [versionesPorDocumento, firmas, firmantes] = await Promise.all([
    ultimasVersiones(documentos.map((d) => d.id)),
    firmasDeDocumentos(documentos.map((d) => d.id)),
    puedePedirFirmas ? posiblesFirmantes() : Promise.resolve([]),
  ])

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
