import { Plus } from 'lucide-react'

import { TarjetaTrabajo } from '@/components/avance/tarjeta-trabajo'
import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { areasDelTaller } from '@/lib/datos/actividades'
import { listarFlota, porAprobarDeFlota, type EstadoFlota } from '@/lib/datos/flota'
import { apruebaSinOrden, areasDeSuMano, exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Trabajos sin orden' }

const FILTROS = [
  { valor: null, etiqueta: 'En curso' },
  { valor: 'LISTA', etiqueta: 'Terminados' },
  { valor: 'SALIO', etiqueta: 'Cerrados' },
]

/**
 * Todos los trabajos sin orden, también los cerrados: es el historial que el
 * supervisor busca cuando la misma tolva vuelve la semana siguiente, o cuando
 * alguien pregunta en qué quedó la cabina de pintura. Van en tarjetas y no en
 * tabla: se miran desde el teléfono, parado al lado de la unidad.
 */
export default async function PaginaTrabajos({ searchParams }: PageProps<'/avance/trabajos'>) {
  const perfil = await exigirPermiso(['produccion.ver', 'produccion.aprobar_reportes', 'produccion.aprobar_sin_orden'])
  const params = await searchParams

  const estado =
    params.estado === 'LISTA' || params.estado === 'SALIO' ? (params.estado as EstadoFlota) : null
  const buscar = typeof params.buscar === 'string' ? params.buscar.trim() : ''

  // Quien aprueba viene a eso: el trabajo con reportes por aprobar va primero y
  // lo dice en su tarjeta, para no tener que abrirlos todos a buscarlos.
  const aprueba = apruebaSinOrden(perfil)
  const [lista, areas, porAprobar] = await Promise.all([
    listarFlota({ estado, buscar }),
    areasDelTaller(),
    aprueba ? porAprobarDeFlota() : Promise.resolve(new Map<string, number>()),
  ])
  const puedeRegistrar = puede(perfil, 'produccion.actividades') && areasDeSuMano(perfil, areas).length > 0

  const trabajos = aprueba
    ? [...lista].sort((a, b) => Number(porAprobar.has(b.id)) - Number(porAprobar.has(a.id)))
    : lista

  return (
    <>
      <EncabezadoPagina
        titulo="Trabajos sin orden"
        ayuda="Lo que se hace en el taller sin orden de trabajo: unidades de clientes que entraron sin orden, o lo que el propio taller está implementando. Se reportan igual, para que Supervisión y Administración sepan cómo va."
        acciones={
          puedeRegistrar && (
            <EnlaceBoton href="/avance/trabajos/nueva">
              <Plus aria-hidden className="size-4" />
              Nuevo trabajo sin orden
            </EnlaceBoton>
          )
        }
      />

      {/* El buscador de toda lista, que sigue a la búsqueda: era un formulario
          con la caja sin control, y una pastilla —que cambia solo la búsqueda,
          sin volver a montar la pantalla— dejaba en la caja lo escrito sin
          buscar, o la vaciada, sobre una lista con otro filtro (D4 de diseño,
          cuadragésima séptima pasada). Las pastillas se llevan lo escrito. */}
      <div className="mb-3">
        <BuscadorSimple
          ruta="/avance/trabajos"
          clave="buscar"
          etiqueta="Buscar un trabajo"
          marcador="Placa, qué es o de quién…"
        />
      </div>

      <PastillaFiltro
        ruta="/avance/trabajos"
        clave="estado"
        opciones={FILTROS}
        params={params}
        activo={estado}
        etiqueta="Filtrar por estado"
        className="mb-4"
      />

      {trabajos.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo className="p-0">
            <SinDatos
              enTabla={false}
              titulo={
                buscar
                  ? `Ningún trabajo con «${buscar}»`
                  : estado === 'SALIO'
                    ? 'Todavía no se cerró ningún trabajo'
                    : estado === 'LISTA'
                      ? 'No hay trabajos terminados esperando'
                      : 'Ningún trabajo sin orden en curso'
              }
              descripcion={
                buscar
                  ? 'La búsqueda mira solo la pestaña elegida: prueba en «Cerrados».'
                  : puedeRegistrar
                    ? 'Cuando empiece uno, regístralo con el botón de arriba.'
                    : 'Los registra el supervisor de cada área.'
              }
            />
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {trabajos.map((t) => (
            <TarjetaTrabajo key={t.id} trabajo={t} porAprobar={porAprobar.get(t.id) ?? 0} />
          ))}
        </div>
      )}
    </>
  )
}
