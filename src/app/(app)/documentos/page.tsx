import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { ListaDocumentos } from '@/components/documentos/lista-documentos'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { listarDocumentos, tiposDocumento, versionesDeDocumento } from '@/lib/datos/documentos'
import { firmasDeDocumentos, posiblesFirmantes } from '@/lib/datos/firmas'
import { exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Documentos' }

export default async function PaginaDocumentos({ searchParams }: PageProps<'/documentos'>) {
  const perfil = await exigirPermiso('documentos.ver')
  const params = await searchParams
  const tipoFiltro = typeof params.tipo === 'string' ? params.tipo : undefined

  const [documentos, tipos] = await Promise.all([
    listarDocumentos({ tipo: tipoFiltro }),
    tiposDocumento(),
  ])

  const pideFirmas = puede(perfil, ['documentos.subir', 'documentos.aprobar'])

  const [versiones, firmas, firmantes] = await Promise.all([
    Promise.all(
      documentos.map(async (d) => ({ id: d.id, versiones: await versionesDeDocumento(d.id) })),
    ),
    firmasDeDocumentos(documentos.map((d) => d.id)),
    pideFirmas ? posiblesFirmantes() : Promise.resolve([]),
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

  return (
    <>
      <EncabezadoPagina
        titulo="Documentos"
        descripcion="Repositorio documental del taller. Cada archivo nuevo de un documento es una versión: la anterior se conserva."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/documentos"
          className={
            !tipoFiltro
              ? 'rounded-[var(--radius-base)] bg-acento-suave px-3 py-1.5 text-xs font-medium text-acento'
              : 'rounded-[var(--radius-base)] border border-borde px-3 py-1.5 text-xs text-texto-suave hover:bg-superficie-2'
          }
        >
          Todos
        </Link>
        {tipos.map((t) => (
          <Link
            key={t.id}
            href={`/documentos?tipo=${t.id}`}
            className={
              tipoFiltro === t.id
                ? 'rounded-[var(--radius-base)] bg-acento-suave px-3 py-1.5 text-xs font-medium text-acento'
                : 'rounded-[var(--radius-base)] border border-borde px-3 py-1.5 text-xs text-texto-suave hover:bg-superficie-2'
            }
          >
            {t.nombre}
          </Link>
        ))}
      </div>

      <Tarjeta>
        <TarjetaCuerpo className="p-0">
          <ListaDocumentos
            documentos={documentos}
            versionesPorDocumento={versionesPorDocumento}
            vacio="Todavía no se ha adjuntado ningún documento. Se suben desde la orden de trabajo correspondiente."
            firmas={firmas}
            firmantes={firmantes}
            usuarioId={perfil.id}
            puedePedirFirmas={pideFirmas}
          />
        </TarjetaCuerpo>
      </Tarjeta>

      <p className="mt-3 text-xs text-texto-suave">
        Los enlaces de descarga caducan a los cinco minutos y cada descarga queda registrada en el
        historial de accesos del documento.
      </p>
    </>
  )
}
