import type { ReactNode } from 'react'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
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

  // «No hay nadie» y «no hay nadie con este filtro» piden pasos distintos: soltar
  // el filtro en un caso, dar de alta en el otro.
  const filtrando = Boolean(busqueda) || estado !== 'todos'
  let accionSinDatos: ReactNode = null
  if (filtrando) {
    accionSinDatos = (
      <EnlaceBoton href="/personal?estado=todos" variante="contorno">
        Ver a todo el personal
      </EnlaceBoton>
    )
  } else if (gestiona) {
    accionSinDatos = <AltaDePersona catalogos={catalogos} />
  }

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
        {/* Antes cada pastilla era un <a> que rearmaba la URL a mano y solo se
            acordaba de `q`. PastillaFiltro conserva todos los parámetros y navega
            sin recargar la pantalla entera. */}
        <PastillaFiltro
          ruta="/personal"
          clave="estado"
          opciones={FILTROS}
          params={params}
          activo={estado}
          etiqueta="Filtrar por estado"
        />
      </div>

      <Tarjeta className="mt-4 overflow-hidden">
        <Tabla>
          <TablaCabecera>
            <tr>
              <TH>Persona</TH>
              {/* En el teléfono quedan persona, puesto, alcance y acciones; correo,
                  área y costo bajan a la celda de al lado en letra chica. */}
              <TH className="hidden sm:table-cell">Correo</TH>
              <TH>Puesto</TH>
              <TH className="hidden sm:table-cell">Área</TH>
              <TH>Alcance</TH>
              <TH className="hidden text-right sm:table-cell">Costo hora</TH>
              {gestiona && <TH className="text-right">Acciones</TH>}
            </tr>
          </TablaCabecera>
          <tbody>
            {personal.length === 0 && (
              <SinDatos
                colSpan={gestiona ? 7 : 6}
                titulo={filtrando ? 'Nadie coincide con lo que se pidió' : 'Aún no hay personal'}
                descripcion={
                  filtrando
                    ? 'Con esa búsqueda y ese estado no queda nadie en la lista.'
                    : 'Da de alta a la primera persona: se crea su ficha y su acceso al sistema en un solo paso.'
                }
                accion={accionSinDatos}
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

