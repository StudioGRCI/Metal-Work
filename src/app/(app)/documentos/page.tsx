import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro, type OpcionFiltro } from '@/components/estructura/pastilla-filtro'
import { ListaDocumentos } from '@/components/documentos/lista-documentos'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import {
  documentosPorTipo,
  listarDocumentos,
  tiposDocumento,
  ultimasVersiones,
} from '@/lib/datos/documentos'
import { firmasDeDocumentos, posiblesFirmantes } from '@/lib/datos/firmas'
import { exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Documentos' }

export default async function PaginaDocumentos({ searchParams }: PageProps<'/documentos'>) {
  const perfil = await exigirPermiso('documentos.ver')
  const params = await searchParams
  const tipoFiltro = typeof params.tipo === 'string' ? params.tipo : undefined

  const [documentos, tipos, cuentaPorTipo] = await Promise.all([
    listarDocumentos({ tipo: tipoFiltro }),
    tiposDocumento(),
    documentosPorTipo(),
  ])

  const pideFirmas = puede(perfil, ['documentos.subir', 'documentos.aprobar'])

  const [versionesPorDocumento, firmas, firmantes] = await Promise.all([
    ultimasVersiones(documentos.map((d) => d.id)),
    firmasDeDocumentos(documentos.map((d) => d.id)),
    pideFirmas ? posiblesFirmantes() : Promise.resolve([]),
  ])

  // Solo los tipos que tienen algo guardado, con su cuenta al lado. El
  // catálogo entero eran dieciocho pastillas en cuatro líneas —quince de ellas
  // llevando a una pantalla vacía— y en el teléfono empujaban la lista fuera de
  // la vista antes de mostrar un solo documento. El tipo que se está filtrando
  // se queda aunque su cuenta sea cero: si no, la pastilla encendida desaparece
  // debajo del dedo que la acaba de tocar.
  const opciones: OpcionFiltro[] = [
    { valor: null, etiqueta: 'Todos' },
    ...tipos
      .filter((t) => (cuentaPorTipo[t.id] ?? 0) > 0 || t.id === tipoFiltro)
      .map((t) => ({
        valor: t.id,
        etiqueta: `${t.nombre} (${cuentaPorTipo[t.id] ?? 0})`,
      })),
  ]

  // El nombre del tipo puesto, para poder decirlo en el vacío: «no hay ninguna
  // Ficha técnica» se entiende; «no hay documentos» con un filtro encendido
  // hace pensar que el repositorio está vacío y manda a buscar a otro lado.
  const nombreDelTipo = tipos.find((t) => t.id === tipoFiltro)?.nombre
  const filtradoYVacio = Boolean(tipoFiltro) && documentos.length === 0

  return (
    <>
      <EncabezadoPagina
        titulo="Documentos"
        descripcion="Repositorio documental del taller. Cada archivo nuevo de un documento es una versión: la anterior se conserva."
      />

      <PastillaFiltro
        className="mb-4"
        ruta="/documentos"
        clave="tipo"
        opciones={opciones}
        params={params}
        activo={tipoFiltro ?? null}
        etiqueta="Filtrar por tipo de documento"
      />

      <Tarjeta>
        <TarjetaCuerpo className="p-0">
          <ListaDocumentos
            documentos={documentos}
            versionesPorDocumento={versionesPorDocumento}
            vacio={
              filtradoYVacio
                ? `Ningún documento de tipo «${nombreDelTipo ?? 'ese tipo'}». Quita el filtro para ver el resto.`
                : 'Todavía no se ha adjuntado ningún documento. Se suben desde la orden de trabajo correspondiente.'
            }
            firmas={firmas}
            firmantes={firmantes}
            usuarioId={perfil.id}
            puedePedirFirmas={pideFirmas}
          />

          {/* El vacío por filtro tiene salida propia: quien llegó por una pastilla
              necesita el camino de vuelta, no volver a leer la fila de arriba. */}
          {filtradoYVacio && (
            <div className="flex justify-center px-4 pb-6">
              <EnlaceBoton href="/documentos" variante="secundario">
                Ver todos los documentos
              </EnlaceBoton>
            </div>
          )}
        </TarjetaCuerpo>
      </Tarjeta>

      <p className="mt-3 text-xs text-texto-suave">
        Los enlaces de descarga caducan a los cinco minutos y cada descarga queda registrada en el
        historial de accesos del documento.
      </p>
    </>
  )
}
