import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { SinDatos, TH, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { catalogosDePersonal, listarPersonal } from '@/lib/datos/personal'
import { exigirPermiso, puede } from '@/lib/sesion'

import { AltaDePersona, FilaDePersona } from './acciones-personal'

export const metadata = { title: 'Personal' }

const FILTROS = [
  { valor: 'activos', etiqueta: 'Activos' },
  { valor: 'bajas', etiqueta: 'Dados de baja' },
  { valor: 'todos', etiqueta: 'Todos' },
]

export default async function PaginaPersonal({ searchParams }: PageProps<'/personal'>) {
  const perfil = await exigirPermiso('usuarios.ver')
  const params = await searchParams

  const busqueda = typeof params.q === 'string' ? params.q : undefined
  const estado = typeof params.estado === 'string' ? params.estado : 'activos'

  const [personal, catalogos] = await Promise.all([
    listarPersonal({ busqueda, estado }),
    catalogosDePersonal(),
  ])

  const gestiona = puede(perfil, 'usuarios.gestionar')
  const operarios = personal.filter((p) => p.es_operario).length

  return (
    <>
      <EncabezadoPagina
        titulo="Personal"
        descripcion={
          personal.length === 1
            ? '1 persona'
            : `${personal.length} personas · ${operarios} en el taller`
        }
        acciones={gestiona && <AltaDePersona catalogos={catalogos} />}
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-64 flex-1">
          <BuscadorSimple
            ruta="/personal"
            etiqueta="Buscar personal"
            marcador="Buscar por nombre, correo o documento"
          />
        </div>
        <div className="flex gap-1">
          {FILTROS.map((f) => (
            <a
              key={f.valor}
              href={`/personal?estado=${f.valor}${busqueda ? `&q=${encodeURIComponent(busqueda)}` : ''}`}
              aria-current={estado === f.valor ? 'page' : undefined}
              className={
                estado === f.valor
                  ? 'rounded-[var(--radius-base)] bg-acento-suave px-3 py-1.5 text-sm font-medium text-acento'
                  : 'rounded-[var(--radius-base)] px-3 py-1.5 text-sm text-texto-suave hover:bg-superficie-2'
              }
            >
              {f.etiqueta}
            </a>
          ))}
        </div>
      </div>

      <Tarjeta className="mt-4 overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Persona</TH>
              <TH>Correo</TH>
              <TH>Puesto</TH>
              <TH>Área</TH>
              <TH>Alcance</TH>
              <TH className="text-right">Costo hora</TH>
              {gestiona && <TH className="text-right">Acciones</TH>}
            </tr>
          </TablaCabecera>
          <tbody>
            {personal.length === 0 && (
              <SinDatos
                colSpan={gestiona ? 7 : 6}
                titulo="No hay personal que coincida"
                descripcion="Prueba con otra búsqueda o cambia el filtro de estado."
              />
            )}

            {personal.map((persona) => (
              <FilaDePersona
                key={persona.id}
                persona={persona}
                catalogos={catalogos}
                gestiona={gestiona}
              />
            ))}
          </tbody>
        </Tabla>
      </Tarjeta>

      <p className="mt-3 text-xs text-texto-tenue">
        Quien está marcado como operario solo alcanza las órdenes donde está asignado o donde cargó
        horas. Los jefes y supervisores no llevan esa marca, porque necesitan ver todo el taller.
      </p>
    </>
  )
}

